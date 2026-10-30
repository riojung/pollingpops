import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  CanvasExportRequestSchema,
  CanvasFacilitationMutationSchema,
  type ProductFeatureKey,
} from "@openround/contracts";
import { CanvasBoardError, type CanvasBoardRepository, type Repository } from "@openround/db";
import type { SessionCache } from "./cache.js";
import type { StorageService } from "./storage.js";
import { renderCanvasSvg, CanvasExportError } from "./canvas-export.js";
import { CanvasPresenterService } from "./canvas-presenter.js";

interface Actor {
  userId: string;
}
interface Dependencies {
  canvases: CanvasBoardRepository;
  repository: Repository;
  cache: SessionCache;
  storage: StorageService;
}
interface Guards {
  user(request: FastifyRequest): Promise<Actor>;
  sameUser(request: FastifyRequest, userId: string): Promise<Actor>;
  guestToken(request: FastifyRequest): Promise<string>;
  requireFeature(workspaceId: string, feature: ProductFeatureKey): Promise<void>;
  imageBytes(
    mediaId: string,
    authorize: () => Promise<{ workspaceId: string }>,
    reply: FastifyReply,
  ): Promise<unknown>;
}
const Id = z.object({ id: z.string().uuid() }).strict();
const Source = z.object({ sourceBoardId: z.string().uuid() }).strict();
const Version = Id.extend({ versionId: z.string().uuid() });
const VersionMedia = Version.extend({ mediaId: z.string().uuid() });
const options = { config: { rateLimit: { max: 10_000, timeWindow: 60_000 } } };
function assertCurrentSnapshot(
  initial: { canvasSeq: number; sourceRevision: number | null },
  final: { canvasSeq: number; sourceRevision: number | null },
  expectedCanvasSeq = initial.canvasSeq,
) {
  if (final.canvasSeq !== expectedCanvasSeq || final.sourceRevision !== initial.sourceRevision)
    throw new CanvasBoardError("STALE_DRAFT", "This canvas changed. Refresh before continuing");
}

/** Registered inside the canvas route boundary so auth errors, cache headers and metrics agree. */
export async function registerCanvasFacilitationRoutes(
  routes: FastifyInstance,
  deps: Dependencies,
  guards: Guards,
) {
  const presenters = new CanvasPresenterService(deps.canvases, deps.cache);
  const feature = async (actor: Actor, id: string, realtime = false) => {
    const access = await deps.canvases.authorize(actor, id);
    await guards.requireFeature(
      access.workspaceId,
      realtime ? "canvasBoardRealtime" : "canvasBoards",
    );
    return access;
  };
  routes.get("/v1/canvas-boards/:id/facilitation", options, async (request) => {
    const actor = await guards.user(request),
      { id } = Id.parse(request.params);
    const initial = await feature(actor, id);
    const facilitation = await deps.canvases.getFacilitation(actor, id);
    const final = await deps.canvases.authorize(await guards.sameUser(request, actor.userId), id);
    assertCurrentSnapshot(initial, final, facilitation.canvasSeq);
    return { facilitation };
  });
  routes.post("/v1/canvas-boards/:id/facilitation/commands", options, async (request) => {
    const actor = await guards.user(request),
      { id } = Id.parse(request.params);
    const initial = await feature(actor, id);
    const input = CanvasFacilitationMutationSchema.parse(request.body);
    if (!(await deps.cache.consumeRateLimit(`canvas-facilitation:${actor.userId}`, 120, 60_000)))
      throw new CanvasBoardError("RATE_LIMITED", "Wait before updating this canvas again");
    const response = await deps.canvases.facilitate(
      await guards.sameUser(request, actor.userId),
      id,
      input,
    );
    const final = await deps.canvases.authorize(await guards.sameUser(request, actor.userId), id);
    assertCurrentSnapshot(initial, final, response.facilitation.canvasSeq);
    return response;
  });
  routes.get("/v1/canvas-boards/:id/versions/:versionId", options, async (request) => {
    const actor = await guards.user(request),
      { id, versionId } = Version.parse(request.params);
    const initial = await feature(actor, id);
    const version = await deps.canvases.getVersion(actor, id, versionId);
    const final = await deps.canvases.authorize(await guards.sameUser(request, actor.userId), id);
    assertCurrentSnapshot(initial, final);
    return version;
  });
  routes.get(
    "/v1/canvas-boards/:id/versions/:versionId/media/:mediaId",
    options,
    async (request, reply) => {
      const actor = await guards.user(request),
        { id, versionId, mediaId } = VersionMedia.parse(request.params);
      await feature(actor, id);
      return guards.imageBytes(
        mediaId,
        async () =>
          deps.canvases.authorizeVersionMedia(
            await guards.sameUser(request, actor.userId),
            id,
            versionId,
            mediaId,
          ),
        reply,
      );
    },
  );
  routes.get(
    "/v1/canvas-boards/workshop/:sourceBoardId/guest/facilitation",
    options,
    async (request) => {
      const token = await guards.guestToken(request),
        { sourceBoardId } = Source.parse(request.params);
      const access = await deps.canvases.authorizeGuest(sourceBoardId, token);
      await guards.requireFeature(access.workspaceId, "canvasBoards");
      const facilitation = await deps.canvases.getGuestFacilitation(sourceBoardId, token);
      await deps.canvases.authorizeGuest(sourceBoardId, token);
      return { facilitation };
    },
  );
  routes.get("/v1/canvas-boards/:id/presenter", options, async (request) => {
    const actor = await guards.user(request),
      { id } = Id.parse(request.params);
    await feature(actor, id, true);
    const presenter = await presenters.get(actor, id);
    await deps.canvases.authorize(await guards.sameUser(request, actor.userId), id);
    return { presenter };
  });
  routes.post("/v1/canvas-boards/:id/presenter", options, async (request) => {
    const actor = await guards.user(request),
      { id } = Id.parse(request.params);
    await feature(actor, id, true);
    if (!(await deps.cache.consumeRateLimit(`canvas-presentation:${actor.userId}`, 150, 60_000)))
      throw new CanvasBoardError("RATE_LIMITED", "Presentation is updating too quickly");
    const presenter = await presenters.command(
      await guards.sameUser(request, actor.userId),
      id,
      request.body,
    );
    await deps.canvases.authorize(await guards.sameUser(request, actor.userId), id);
    return { presenter };
  });
  routes.get(
    "/v1/canvas-boards/workshop/:sourceBoardId/guest/presenter",
    options,
    async (request) => {
      const token = await guards.guestToken(request),
        { sourceBoardId } = Source.parse(request.params);
      const access = await deps.canvases.authorizeGuest(sourceBoardId, token);
      await guards.requireFeature(access.workspaceId, "canvasBoardRealtime");
      return { presenter: await presenters.getGuest(sourceBoardId, token) };
    },
  );

  routes.post("/v1/canvas-boards/:id/export", options, async (request, reply) => {
    const actor = await guards.user(request),
      { id } = Id.parse(request.params);
    await feature(actor, id);
    const input = CanvasExportRequestSchema.parse(request.body);
    if (
      !(await deps.cache.consumeRateLimit(`canvas-export:${actor.userId}`, 3, 60_000)) ||
      !(await deps.cache.consumeRateLimit(`canvas-export-board:${id}`, 12, 60_000))
    )
      throw new CanvasBoardError("RATE_LIMITED", "Wait before downloading another export");
    const board = await deps.canvases.get(actor, id);
    const controller = new AbortController();
    const cancel = () => controller.abort();
    request.raw.once("aborted", cancel);
    reply.raw.once("close", cancel);
    const retained = new Map<string, { workspaceId: string; objectKey: string }>();
    try {
      const exported = await renderCanvasSvg({
        objects: board.objects,
        title: board.title,
        region: input.region,
        background: input.background,
        signal: controller.signal,
        loadImage: async (mediaId, signal) => {
          if (signal.aborted) throw new DOMException("Export cancelled", "AbortError");
          const scope = await deps.canvases.authorizeMedia(
            await guards.sameUser(request, actor.userId),
            id,
            mediaId,
          );
          const asset = await deps.repository.getMediaAsset(scope.workspaceId, mediaId);
          if (!asset || asset.scanStatus !== "clean")
            throw new CanvasBoardError("NOT_FOUND", "Image unavailable");
          const mime = asset.mimeType;
          if (mime !== "image/png" && mime !== "image/jpeg" && mime !== "image/webp")
            throw new CanvasBoardError("NOT_FOUND", "Image unavailable");
          const bytes = await deps.storage.readImage(asset);
          if (signal.aborted) throw new DOMException("Export cancelled", "AbortError");
          const fresh = await deps.repository.getMediaAsset(scope.workspaceId, mediaId);
          if (!fresh || fresh.scanStatus !== "clean" || fresh.objectKey !== asset.objectKey)
            throw new CanvasBoardError("NOT_FOUND", "Image unavailable");
          await deps.canvases.authorizeMedia(
            await guards.sameUser(request, actor.userId),
            id,
            mediaId,
          );
          retained.set(mediaId, { workspaceId: scope.workspaceId, objectKey: asset.objectKey });
          return { bytes, mime };
        },
      });
      for (const [mediaId, asset] of retained) {
        const fresh = await deps.repository.getMediaAsset(asset.workspaceId, mediaId);
        if (!fresh || fresh.scanStatus !== "clean" || fresh.objectKey !== asset.objectKey)
          throw new CanvasBoardError("NOT_FOUND", "Image unavailable");
        await deps.canvases.authorizeMedia(
          await guards.sameUser(request, actor.userId),
          id,
          mediaId,
        );
      }
      const current = await deps.canvases.get(await guards.sameUser(request, actor.userId), id);
      if (
        current.canvasSeq !== board.canvasSeq ||
        current.sourceBoard?.revision !== board.sourceBoard?.revision
      )
        throw new CanvasBoardError(
          "STALE_DRAFT",
          "This canvas changed. Review it before downloading again",
        );
      if (controller.signal.aborted) return reply;
      return reply
        .header("content-disposition", 'attachment; filename="canvas-export.svg"')
        .header("x-content-type-options", "nosniff")
        .header("referrer-policy", "no-referrer")
        .header(
          "access-control-expose-headers",
          "X-Canvas-Export-Width, X-Canvas-Export-Height, Content-Disposition",
        )
        .header("x-canvas-export-width", exported.width)
        .header("x-canvas-export-height", exported.height)
        .type("image/svg+xml; charset=utf-8")
        .send(exported.svg);
    } catch (error) {
      if (reply.raw.destroyed) return reply;
      if (!(error instanceof CanvasExportError)) throw error;
      return reply
        .code(
          error.code === "EXPORT_TIMEOUT" || error.code === "EXPORT_MEDIA_UNAVAILABLE" ? 503 : 422,
        )
        .send({
          error: {
            code: error.code,
            message: "The export could not finish. Try a smaller region or retry",
            requestId: request.id,
          },
        });
    } finally {
      request.raw.removeListener("aborted", cancel);
      reply.raw.removeListener("close", cancel);
    }
  });
}
