import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  CreatePresentationShareSchema,
  PresentationReviewSchema,
  PresentationShareCreatedSchema,
  PresentationShareListSchema,
  PresentationShareAccessSchema,
} from "@openround/contracts";
import {
  PresentationShareError,
  type PresentationShareRepository,
  type Repository,
} from "@openround/db";
import type { AuthService } from "./auth.js";
import type { AppConfig } from "./config.js";
import type { StorageService } from "./storage.js";
import { workspaceFeatureEnabled } from "./feature-policy.js";
import {
  PresentationSharingService,
  PresentationShareMediaBusyError,
} from "./presentation-sharing-service.js";
const params = z.object({ id: z.string().uuid() });
const shareParams = params.extend({ shareId: z.string().uuid() });
const mediaParams = params.extend({ mediaId: z.string().uuid() });
const failure = (reply: FastifyReply, status = 404) =>
  reply.code(status).send({
    error: {
      code: status === 429 ? "RATE_LIMITED" : "PRESENTATION_UNAVAILABLE",
      message:
        status === 429
          ? "Too many requests. Try again shortly."
          : "This presentation link is unavailable or has expired",
    },
  });
export async function registerPresentationSharingRoutes(
  app: FastifyInstance,
  deps: {
    auth: Pick<AuthService, "requireCreator">;
    repository: Repository;
    shares: PresentationShareRepository;
    storage: Pick<StorageService, "readImage">;
    config: AppConfig;
    consumeAdmission: (key: string, maximum: number, windowMs: number) => Promise<boolean>;
    featureEnabled?: (workspaceId: string) => Promise<boolean>;
  },
) {
  const service = new PresentationSharingService({
    repository: deps.repository,
    shares: deps.shares,
    storage: deps.storage,
    webOrigin: deps.config.WEB_ORIGIN,
    featureEnabled:
      deps.featureEnabled ??
      ((workspaceId) =>
        workspaceFeatureEnabled(deps.repository, deps.config, workspaceId, "presentations")),
  });
  const budget = async (
    request: FastifyRequest,
    reply: FastifyReply,
    operation: string,
    max: number,
  ) => {
    if (await deps.consumeAdmission(`presentation-share:${operation}:${request.ip}`, max, 60_000))
      return true;
    failure(reply, 429);
    return false;
  };
  const bearer = (request: FastifyRequest) =>
    /^Bearer ([A-Za-z0-9_-]{43})$/.exec(request.headers.authorization ?? "")?.[1] ?? "";
  await app.register(async (scoped) => {
    scoped.addHook("onRequest", async (_request, reply) => {
      reply
        .header("cache-control", "private, no-store")
        .header("vary", "Authorization, Cookie, Origin")
        .header("x-robots-tag", "noindex, nofollow, noarchive")
        .header("referrer-policy", "no-referrer")
        .header("x-content-type-options", "nosniff");
    });
    scoped.setErrorHandler((error, _request, reply) => {
      if (error instanceof PresentationShareError && error.code === "REQUEST_EXPIRED")
        return reply
          .code(410)
          .send({ error: { code: "PRESENTATION_SHARE_REQUEST_EXPIRED", message: error.message } });
      if (error instanceof PresentationShareMediaBusyError)
        return reply
          .header("retry-after", "1")
          .code(503)
          .send({ error: { code: "PRESENTATION_MEDIA_BUSY", message: error.message } });
      if (error instanceof PresentationShareError)
        return failure(
          reply,
          error.code === "IDEMPOTENCY_CONFLICT" || error.code === "LINK_LIMIT" ? 409 : 404,
        );
      if (error instanceof z.ZodError) return failure(reply, 422);
      throw error;
    });
    const base = "/v1/presentations/:id/shares";
    scoped.get(base, async (request, reply) => {
      const actor = await deps.auth.requireCreator(request, reply);
      if (!actor) return;
      const { id } = params.parse(request.params);
      return PresentationShareListSchema.parse(await service.list(actor, id));
    });
    scoped.post(base, async (request, reply) => {
      const actor = await deps.auth.requireCreator(request, reply);
      if (
        !actor ||
        !(await budget(request, reply, `create:${actor.workspaceId}:${actor.userId}`, 20))
      )
        return;
      const { id } = params.parse(request.params);
      const result = await service.create(
        actor,
        id,
        CreatePresentationShareSchema.parse(request.body),
      );
      await deps.repository.recordAudit({
        workspaceId: actor.workspaceId,
        actorId: actor.userId,
        action: "presentation.share.create",
        targetType: "presentation",
        targetId: id,
        requestId: request.id,
        metadata: {
          shareId: result.share.id,
          versionId: result.share.versionId,
          replayed: result.replayed,
        },
      });
      return reply
        .code(result.replayed ? 200 : 201)
        .send(PresentationShareCreatedSchema.parse(result));
    });
    scoped.delete(`${base}/:shareId`, async (request, reply) => {
      const actor = await deps.auth.requireCreator(request, reply);
      if (!actor) return;
      const { id, shareId } = shareParams.parse(request.params);
      await service.revoke(actor, id, shareId);
      await deps.repository.recordAudit({
        workspaceId: actor.workspaceId,
        actorId: actor.userId,
        action: "presentation.share.revoke",
        targetType: "presentation",
        targetId: id,
        requestId: request.id,
        metadata: { shareId },
      });
      return reply.code(204).send();
    });
    scoped.get("/v1/shared-presentations/:id", async (request, reply) => {
      if (!(await budget(request, reply, "read", 60))) return;
      const { id } = params.parse(request.params);
      return PresentationReviewSchema.parse(await service.review(id, bearer(request)));
    });
    scoped.get("/v1/shared-presentations/:id/access", async (request, reply) => {
      if (!(await budget(request, reply, "access", 120))) return;
      const { id } = params.parse(request.params);
      return PresentationShareAccessSchema.parse(await service.access(id, bearer(request)));
    });
    scoped.get("/v1/shared-presentations/:id/media/:mediaId", async (request, reply) => {
      if (!(await budget(request, reply, "media", 120))) return;
      const { id, mediaId } = mediaParams.parse(request.params);
      const value = await service.media(id, bearer(request), mediaId);
      return reply.header("content-type", value.contentType).send(value.bytes);
    });
  });
  return service;
}
