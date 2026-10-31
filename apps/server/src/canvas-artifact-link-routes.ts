import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  CanvasArtifactLinkCreateSchema,
  CanvasArtifactLinkDeleteSchema,
  type ProductFeatureKey,
} from "@openround/contracts";
import {
  CanvasBoardError,
  createCanvasArtifactLinkRepository,
  type Repository,
  type CanvasArtifactTarget,
} from "@openround/db";
import type { AuthService } from "./auth.js";
import type { AppConfig } from "./config.js";
import type { SessionCache } from "./cache.js";

interface Actor {
  userId: string;
}
interface Guards {
  user(request: FastifyRequest): Promise<Actor>;
  sameUser(request: FastifyRequest, userId: string): Promise<Actor>;
  requireFeature(workspaceId: string, key: ProductFeatureKey): Promise<void>;
  imageBytes(
    mediaId: string,
    authorize: () => Promise<{ workspaceId: string }>,
    reply: FastifyReply,
  ): Promise<unknown>;
}
const Id = z.object({ id: z.string().uuid() }).strict();
const Link = Id.extend({ linkId: z.string().uuid() });
const Image = Link.extend({ mediaId: z.string().uuid() });
const options = { config: { rateLimit: { max: 120, timeWindow: 60_000 } } };

/** Inside the canvas HTTP boundary: cookie identity, no-store headers and private image delivery. */
export async function registerCanvasArtifactLinkRoutes(
  routes: FastifyInstance,
  deps: { repository: Repository; auth: AuthService; config: AppConfig; cache: SessionCache },
  guards: Guards,
) {
  const links = createCanvasArtifactLinkRepository(deps.repository, {
    communityMode: deps.config.COMMUNITY_MODE,
  });
  async function scope(
    request: FastifyRequest,
    kind: CanvasArtifactTarget["kind"],
    id: string,
    expected?: { userId: string; workspaceId: string },
  ) {
    const actor = expected
      ? await guards.sameUser(request, expected.userId)
      : await guards.user(request);
    const creator = await deps.auth.creatorFromRequest(request);
    if (
      !creator ||
      creator.userId !== actor.userId ||
      (expected && creator.workspaceId !== expected.workspaceId)
    )
      throw new CanvasBoardError("UNAUTHORIZED", "Sign in to the destination workspace");
    await guards.requireFeature(creator.workspaceId, "canvasBoards");
    return {
      actor,
      target: { workspaceId: creator.workspaceId, kind, id },
      userId: actor.userId,
      workspaceId: creator.workspaceId,
    };
  }
  async function rate(actor: Actor) {
    if (!(await deps.cache.consumeRateLimit(`canvas-artifact-links:${actor.userId}`, 60, 60_000)))
      throw new CanvasBoardError("RATE_LIMITED", "Wait before changing more canvas links");
  }
  for (const [prefix, kind] of [
    ["quizzes", "round"],
    ["presentations", "presentation"],
  ] as const) {
    const path = `/v1/${prefix}/:id/canvas-snapshot-links`;
    routes.get(path, options, async (request) => {
      const { id } = Id.parse(request.params),
        initial = await scope(request, kind, id);
      await links.list(initial.actor, initial.target);
      const fresh = await scope(request, kind, id, initial);
      return links.list(fresh.actor, fresh.target);
    });
    routes.get(`${path}/eligible`, options, async (request) => {
      const { id } = Id.parse(request.params),
        initial = await scope(request, kind, id);
      await links.eligible(initial.actor, initial.target);
      const fresh = await scope(request, kind, id, initial);
      return links.eligible(fresh.actor, fresh.target);
    });
    routes.post(path, options, async (request) => {
      const { id } = Id.parse(request.params),
        initial = await scope(request, kind, id);
      const input = CanvasArtifactLinkCreateSchema.parse(request.body);
      await rate(initial.actor);
      const fresh = await scope(request, kind, id, initial);
      const result = await links.create(fresh.actor, fresh.target, input);
      const final = await scope(request, kind, id, initial);
      await links.list(final.actor, final.target);
      return result;
    });
    routes.delete(`${path}/:linkId`, options, async (request) => {
      const { id, linkId } = Link.parse(request.params),
        initial = await scope(request, kind, id);
      const input = CanvasArtifactLinkDeleteSchema.parse(request.body);
      await rate(initial.actor);
      const fresh = await scope(request, kind, id, initial);
      const result = await links.delete(fresh.actor, fresh.target, linkId, input);
      const final = await scope(request, kind, id, initial);
      await links.list(final.actor, final.target);
      return result;
    });
    routes.get(`${path}/:linkId/preview`, options, async (request) => {
      const { id, linkId } = Link.parse(request.params),
        initial = await scope(request, kind, id);
      await links.preview(initial.actor, initial.target, linkId);
      const fresh = await scope(request, kind, id, initial);
      return links.preview(fresh.actor, fresh.target, linkId);
    });
    routes.get(`${path}/:linkId/media/:mediaId`, options, async (request, reply) => {
      const { id, linkId, mediaId } = Image.parse(request.params),
        initial = await scope(request, kind, id);
      return guards.imageBytes(
        mediaId,
        async () => {
          const fresh = await scope(request, kind, id, initial);
          return links.authorizeMedia(fresh.actor, fresh.target, linkId, mediaId);
        },
        reply,
      );
    });
  }
}
