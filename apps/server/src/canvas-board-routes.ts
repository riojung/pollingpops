import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z, ZodError } from "zod";
import {
  CanvasBoardCreateSchema,
  CanvasBoardInviteSchema,
  CanvasBoardMutationSchema,
  MediaUploadRequestSchema,
  type ProductFeatureKey,
} from "@openround/contracts";
import {
  CanvasBoardError,
  IdeaBoardError,
  type CanvasBoardRepository,
  type Repository,
} from "@openround/db";
import type { AuthService } from "./auth.js";
import type { AppConfig } from "./config.js";
import type { SessionCache } from "./cache.js";
import type { StorageService } from "./storage.js";
import type { MetricsService } from "./metrics.js";
import { workspaceFeatureEnabled } from "./feature-policy.js";
import { cleanPlainText, hashToken } from "./security.js";
import { completeMediaFinalization, MediaFinalizationConflictError } from "./media-finalization.js";
import { CanvasBoardLive } from "./canvas-board-live.js";
import { registerCanvasFacilitationRoutes } from "./canvas-facilitation-routes.js";

const clock = () => new Date();
const Id = z.object({ id: z.string().uuid() }).strict();
const SourceId = z.object({ sourceBoardId: z.string().uuid() }).strict();
const InvitationId = z.object({ invitationId: z.string().uuid() }).strict();
const GrantParams = Id.extend({ userId: z.string().uuid() });
const InvitationParams = Id.extend({ invitationId: z.string().uuid() });
const MediaParams = Id.extend({ mediaId: z.string().uuid() });
const GuestMediaParams = SourceId.extend({ mediaId: z.string().uuid() });
const CreateEnvelope = z
  .object({
    setupContext: z
      .object({ userId: z.string().uuid(), workspaceId: z.string().uuid() })
      .strict()
      .optional(),
  })
  .passthrough();
const Page = z
  .object({
    scope: z.enum(["all", "owned", "shared", "archived"]).default("all"),
    search: z.string().trim().max(160).default(""),
    cursor: z.string().uuid().optional(),
    limit: z.coerce.number().int().min(1).max(50).default(50),
  })
  .strict();
const Presence = z
  .object({
    cursor: z
      .object({
        x: z.number().finite().min(-100_000).max(100_000),
        y: z.number().finite().min(-100_000).max(100_000),
      })
      .strict()
      .nullable(),
  })
  .strict();
const routeOptions = { config: { rateLimit: { max: 10_000, timeWindow: 60_000 } } };
function metricAction(request: FastifyRequest) {
  const route = request.routeOptions.url ?? "";
  if (route.includes("/facilitation")) return "facilitation";
  if (route.includes("/versions/")) return "version";
  if (route.endsWith("/presenter")) return "presenter";
  if (route.endsWith("/export")) return "export";
  if (route.endsWith("/events")) return null;
  if (route.endsWith("/commands")) return "command";
  if (route.endsWith("/presence")) return "presence";
  if (route.endsWith("/media/:mediaId")) return "media";
  if (route.endsWith("/media/:mediaId/complete")) return "media_finalize";
  if (route.endsWith("/media")) return "media_upload";
  if (route.endsWith("/accept")) return "accept";
  if (route.endsWith("/grants/:userId")) return "revoke";
  if (route.endsWith("/invitations/:invitationId")) return "revoke_invitation";
  if (route.endsWith("/invitations")) return "invite";
  if (route.endsWith("/guest")) return "guest_snapshot";
  if (route === "/v1/canvas-boards") return request.method === "POST" ? "create" : "list";
  return request.method === "DELETE" ? "delete" : "snapshot";
}

export async function registerCanvasBoardRoutes(
  app: FastifyInstance,
  deps: {
    auth: AuthService;
    repository: Repository;
    config: AppConfig;
    canvases: CanvasBoardRepository;
    cache: SessionCache;
    storage: StorageService;
    metrics: MetricsService;
  },
) {
  const live = new CanvasBoardLive(deps.canvases, 150, 250, 5 * 60_000, deps.metrics);
  // onClose occurs after HTTP connections drain. End long-lived responses first.
  app.addHook("preClose", async () => live.close());
  await app.register(async (routes) => {
    const observations = new WeakMap<
      FastifyRequest,
      { action: string | null; started: number; conflict?: boolean }
    >();
    routes.addHook("onResponse", async (request, reply) => {
      const observation = observations.get(request);
      if (!observation?.action) return;
      const outcome = observation.conflict
        ? "conflict"
        : reply.statusCode >= 500
          ? "failed"
          : reply.statusCode >= 400
            ? "rejected"
            : "accepted";
      deps.metrics.observeCanvasOperation(
        observation.action,
        outcome,
        (performance.now() - observation.started) / 1_000,
      );
    });
    routes.setErrorHandler((error, request, reply) => {
      if (error instanceof ZodError)
        return reply.code(400).send({
          error: {
            code: "VALIDATION_ERROR",
            message: "Check the submitted canvas values",
            requestId: request.id,
          },
        });
      const parseStatus = (error as { statusCode?: number }).statusCode;
      if (parseStatus === 400 || parseStatus === 413 || parseStatus === 415)
        return reply.code(parseStatus).send({
          error: {
            code: "VALIDATION_ERROR",
            message: "Send a bounded JSON canvas request",
            requestId: request.id,
          },
        });
      if (error instanceof CanvasBoardError || error instanceof IdeaBoardError) {
        const observation = observations.get(request);
        if (observation)
          observation.conflict =
            error.code === "STALE_DRAFT" || error.code === "IDEMPOTENCY_CONFLICT";
        const status =
          error.code === "NOT_FOUND"
            ? 404
            : error.code === "UNAUTHORIZED"
              ? 401
              : error.code === "FORBIDDEN"
                ? 403
                : error.code === "RATE_LIMITED"
                  ? 429
                  : error.code === "ENTITLEMENT_LIMIT"
                    ? 402
                    : error.code === "VALIDATION_ERROR"
                      ? 422
                      : 409;
        if (status === 429) reply.header("retry-after", "60");
        return reply
          .code(status)
          .send({ error: { code: error.code, message: error.message, requestId: request.id } });
      }
      throw error;
    });
    routes.addHook("onRequest", async (request, reply) => {
      observations.set(request, { action: metricAction(request), started: performance.now() });
      reply.header("cache-control", "private, no-store");
      if (!(await deps.cache.consumeRateLimit(`canvas-ip:${request.ip}`, 10_000, 60_000)))
        throw new CanvasBoardError(
          "RATE_LIMITED",
          "Too many canvas requests. Wait a minute and retry",
        );
    });
    const user = async (request: FastifyRequest) => {
      const actor = await deps.auth.userFromRequest(request);
      if (!actor) throw new CanvasBoardError("UNAUTHORIZED", "Sign in required");
      return actor;
    };
    const sameUser = async (request: FastifyRequest, userId: string) => {
      const actor = await user(request);
      if (actor.userId !== userId) throw new CanvasBoardError("UNAUTHORIZED", "Sign in required");
      return actor;
    };
    const requireFeature = async (workspaceId: string, key: ProductFeatureKey) => {
      if (!(await workspaceFeatureEnabled(deps.repository, deps.config, workspaceId, key)))
        throw new CanvasBoardError(
          "NOT_FOUND",
          "This canvas capability is not enabled for the owning workspace",
        );
    };
    // Coalesce identical operator-policy reads for connections on this node.
    // This cache never contains an actor grant, seat, or authorization decision.
    const livePolicies = new Map<string, { until: number; promise: Promise<void> }>();
    const liveFeature = (workspaceId: string) => {
      const cached = livePolicies.get(workspaceId);
      if (cached && cached.until > Date.now()) return cached.promise;
      if (livePolicies.size > 1_000) {
        for (const [id, entry] of livePolicies)
          if (entry.until <= Date.now()) livePolicies.delete(id);
      }
      const promise = requireFeature(workspaceId, "canvasBoardRealtime");
      livePolicies.set(workspaceId, { until: Date.now() + 250, promise });
      return promise;
    };
    const livePolicyAvailable = async (workspaceId: string) => {
      try {
        await liveFeature(workspaceId);
        return true;
      } catch {
        return false;
      }
    };
    const liveUnavailable = () =>
      Object.assign(
        new Error(
          "Live canvas updates are temporarily unavailable; authorized refresh remains available",
        ),
        { code: "DEPENDENCY_UNAVAILABLE", statusCode: 503 },
      );
    const guestToken = async (request: FastifyRequest) => {
      const authorization = request.headers.authorization;
      if (!authorization || !/^Bearer [a-f0-9]{64}$/.test(authorization))
        throw new CanvasBoardError("UNAUTHORIZED", "Join the workshop to view its canvas");
      const tokenHash = hashToken(authorization.slice(7));
      if (!(await deps.cache.consumeRateLimit(`canvas-guest:${tokenHash}`, 120, 60_000)))
        throw new CanvasBoardError(
          "RATE_LIMITED",
          "Too many canvas requests. Wait a minute and retry",
        );
      return tokenHash;
    };
    const uploadsAvailable = async () =>
      deps.storage.mediaUploadsEnabled &&
      (await deps.repository.getOperationalFeatures()).mediaUploads;
    const uploadUnavailable = (request: FastifyRequest, reply: FastifyReply) =>
      reply.code(503).send({
        error: {
          code: "DEPENDENCY_UNAVAILABLE",
          message:
            "Image uploads are unavailable. The operator must enable media storage and malware scanning.",
          requestId: request.id,
        },
      });
    const freshBoard = async (request: FastifyRequest, userId: string, boardId: string) => {
      const imageUploadsAvailable = await uploadsAvailable();
      const actor = await sameUser(request, userId);
      const board = await deps.canvases.get(actor, boardId, clock);
      if (Date.parse(board.expiresAt) <= Date.now())
        throw new CanvasBoardError("NOT_FOUND", "This canvas has expired");
      return { ...board, imageUploadsAvailable: imageUploadsAvailable && board.capabilities.edit };
    };
    const clearPresence = async (boardId: string, userId?: string) => {
      try {
        if (userId) await deps.cache.removeCanvasPresence?.(boardId, userId);
        else await deps.cache.clearCanvasPresence?.(boardId);
      } catch {
        deps.metrics.canvasStreamEvent("presence_cleanup_failed");
      }
    };
    const sharing = async (request: FastifyRequest, userId: string, boardId: string) => {
      const actor = await sameUser(request, userId);
      const access = await deps.canvases.authorize(actor, boardId, clock);
      await requireFeature(access.workspaceId, "canvasBoardSharing");
      return sameUser(request, userId);
    };

    routes.get("/v1/canvas-boards", routeOptions, async (request) => {
      const actor = await user(request);
      const query = Page.parse(request.query);
      const boards = await deps.canvases.list(actor, { scope: query.scope }, clock);
      const visible = boards
        .filter(
          (board) =>
            Date.parse(board.expiresAt) > Date.now() &&
            (!query.cursor || board.id > query.cursor) &&
            board.title.toLocaleLowerCase().includes(query.search.toLocaleLowerCase()),
        )
        .sort((a, b) => a.id.localeCompare(b.id));
      const page = visible.slice(0, query.limit);
      return { boards: page, nextCursor: visible.length > query.limit ? page.at(-1)!.id : null };
    });
    routes.post(
      "/v1/canvas-boards",
      { ...routeOptions, bodyLimit: 8 * 1024 },
      async (request, reply) => {
        const actor = await user(request);
        const { setupContext, ...body } = CreateEnvelope.parse(request.body);
        const input = CanvasBoardCreateSchema.parse(body);
        if (
          setupContext &&
          (setupContext.userId !== actor.userId || setupContext.workspaceId !== input.workspaceId)
        )
          return reply.code(409).send({
            error: {
              code: "SETUP_CONTEXT_CHANGED",
              message:
                "Your account or workspace changed. Return to the account and workspace where this setup began, then retry.",
              requestId: request.id,
            },
          });
        if (
          !(await deps.cache.consumeIdempotentRateLimit(
            `canvas-create:${actor.userId}`,
            input.operationId,
            20,
            60_000,
          ))
        )
          throw new CanvasBoardError(
            "RATE_LIMITED",
            "Too many canvas creations. Wait a minute and retry",
          );
        const previous = await deps.canvases.getCreation(actor, input, clock);
        if (previous)
          return reply
            .code(201)
            .send({ board: await freshBoard(request, actor.userId, previous.id) });
        await requireFeature(input.workspaceId, "canvasBoards");
        if (!(await deps.repository.getOperationalFeatures()).sessionCreation)
          throw new CanvasBoardError("FORBIDDEN", "New canvas creation is temporarily paused");
        const current = await sameUser(request, actor.userId);
        const created = await deps.canvases.create(current, input, clock);
        await deps.repository.recordAudit({
          workspaceId: created.workspaceId,
          actorId: actor.userId,
          action: "canvas_board.created",
          targetType: "canvas_board",
          targetId: created.id,
          requestId: request.id,
          metadata: { boardType: created.boardType },
        });
        return reply.code(201).send({ board: await freshBoard(request, actor.userId, created.id) });
      },
    );
    routes.get("/v1/canvas-boards/:id", routeOptions, async (request) => {
      const actor = await user(request);
      return { board: await freshBoard(request, actor.userId, Id.parse(request.params).id) };
    });
    routes.get("/v1/canvas-boards/workshop/:sourceBoardId", routeOptions, async (request) => {
      const actor = await user(request);
      const { sourceBoardId } = SourceId.parse(request.params);
      const attached = await deps.canvases.getWorkshop(actor, sourceBoardId, clock);
      return { board: await freshBoard(request, actor.userId, attached.id) };
    });
    routes.post(
      "/v1/canvas-boards/:id/commands",
      { ...routeOptions, bodyLimit: 64 * 1024 },
      async (request) => {
        const actor = await user(request);
        const { id } = Id.parse(request.params);
        const input = CanvasBoardMutationSchema.parse(request.body);
        const observation = observations.get(request);
        if (observation) observation.action = input.command.type;
        if (input.command.type === "grant") await sharing(request, actor.userId, id);
        if (input.command.type === "workshop" && input.command.command.type === "collect") {
          const board = await freshBoard(request, actor.userId, id);
          if (board.sourceBoard?.status === "draft") {
            await requireFeature(board.workspaceId, "ideaBoards");
            if (!(await deps.repository.getOperationalFeatures()).sessionCreation)
              throw new CanvasBoardError(
                "FORBIDDEN",
                "New workshop collection is temporarily paused",
              );
          }
        }
        if (
          !(await deps.cache.consumeIdempotentRateLimit(
            `canvas-write:${actor.userId}`,
            `${id}:${input.operationId}`,
            120,
            60_000,
          ))
        )
          throw new CanvasBoardError(
            "RATE_LIMITED",
            "Too many canvas operations. Wait a minute and retry",
          );
        const current = await sameUser(request, actor.userId);
        const result = await deps.canvases.command(current, id, input, clock);
        if (input.command.type === "revoke") await clearPresence(id, input.command.userId);
        return { receipt: result.receipt, board: await freshBoard(request, actor.userId, id) };
      },
    );
    routes.delete("/v1/canvas-boards/:id", routeOptions, async (request, reply) => {
      const actor = await user(request);
      const { id } = Id.parse(request.params);
      await deps.canvases.delete(actor, id, clock);
      await clearPresence(id);
      return reply.code(204).send();
    });
    routes.post(
      "/v1/canvas-boards/:id/invitations",
      { ...routeOptions, bodyLimit: 2048 },
      async (request, reply) => {
        const actor = await user(request);
        const { id } = Id.parse(request.params);
        const input = CanvasBoardInviteSchema.parse(request.body);
        if (
          !(await deps.cache.consumeIdempotentRateLimit(
            `canvas-invite:${actor.userId}`,
            `${id}:${input.operationId}`,
            30,
            60_000,
          ))
        )
          throw new CanvasBoardError(
            "RATE_LIMITED",
            "Too many canvas invitations. Wait a minute and retry",
          );
        const current = await sharing(request, actor.userId, id);
        const invitation = await deps.canvases.invite(current, id, input, clock);
        await freshBoard(request, actor.userId, id);
        return reply.code(201).send({ invitation });
      },
    );
    routes.post(
      "/v1/canvas-boards/invitations/:invitationId/accept",
      { ...routeOptions, bodyLimit: 1024 },
      async (request) => {
        const actor = await user(request);
        const { invitationId } = InvitationId.parse(request.params);
        z.object({})
          .strict()
          .parse(request.body ?? {});
        // Acceptance itself only grants board-scoped access; the repository verifies the
        // invitation's mailbox, organization, expiry, and current creator seat for writes.
        const workspaceId = await deps.canvases.invitationWorkspace(actor, invitationId, clock);
        await requireFeature(workspaceId, "canvasBoardSharing");
        const current = await sameUser(request, actor.userId);
        const accepted = await deps.canvases.acceptInvitation(current, invitationId, clock);
        return { board: await freshBoard(request, actor.userId, accepted.id) };
      },
    );
    routes.delete(
      "/v1/canvas-boards/:id/invitations/:invitationId",
      routeOptions,
      async (request, reply) => {
        const actor = await user(request);
        const { id, invitationId } = InvitationParams.parse(request.params);
        await deps.canvases.revokeInvitation(actor, id, invitationId, clock);
        return reply.code(204).send();
      },
    );
    routes.delete("/v1/canvas-boards/:id/grants/:userId", routeOptions, async (request, reply) => {
      const actor = await user(request);
      const { id, userId } = GrantParams.parse(request.params);
      await deps.canvases.revokeGrant(actor, id, userId, clock);
      await clearPresence(id, userId);
      return reply.code(204).send();
    });

    routes.get("/v1/canvas-boards/workshop/:sourceBoardId/guest", routeOptions, async (request) => {
      const tokenHash = await guestToken(request);
      const { sourceBoardId } = SourceId.parse(request.params);
      // Deliberately never consult creator cookies on an audience endpoint.
      const board = await deps.canvases.getGuest(sourceBoardId, tokenHash, clock);
      if (!board) throw new CanvasBoardError("NOT_FOUND", "This workshop has no available canvas");
      if (Date.parse(board.sourceBoard.expiresAt) <= Date.now())
        throw new CanvasBoardError("NOT_FOUND", "This workshop has expired");
      return { board };
    });
    routes.get("/v1/canvas-boards/:id/events", routeOptions, async (request, reply) => {
      const actor = await user(request);
      const { id } = Id.parse(request.params);
      let workspaceId: string | undefined;
      return live.connect(request, reply, `user:${actor.userId}`, async () => {
        if (!workspaceId) {
          const access = await deps.canvases.authorize(
            await sameUser(request, actor.userId),
            id,
            clock,
          );
          workspaceId = access.workspaceId;
        }
        const available = await livePolicyAvailable(workspaceId!);
        const rechecked = await sameUser(request, actor.userId);
        const access = await deps.canvases.authorize(rechecked, id, clock);
        if (!available) throw liveUnavailable();
        return access;
      });
    });
    routes.get(
      "/v1/canvas-boards/workshop/:sourceBoardId/guest/events",
      routeOptions,
      async (request, reply) => {
        const tokenHash = await guestToken(request);
        const { sourceBoardId } = SourceId.parse(request.params);
        let workspaceId: string | undefined;
        return live.connect(
          request,
          reply,
          `guest:${tokenHash}`,
          async () => {
            if (!workspaceId) {
              const access = await deps.canvases.authorizeGuest(sourceBoardId, tokenHash, clock);
              workspaceId = access.workspaceId;
            }
            const available = await livePolicyAvailable(workspaceId!);
            const access = await deps.canvases.authorizeGuest(sourceBoardId, tokenHash, clock);
            if (!available) throw liveUnavailable();
            return access;
          },
          1_000,
        );
      },
    );

    routes.put(
      "/v1/canvas-boards/:id/presence",
      { ...routeOptions, bodyLimit: 1024 },
      async (request, reply) => {
        const actor = await user(request);
        const { id } = Id.parse(request.params);
        const input = Presence.parse(request.body);
        const access = await deps.canvases.authorize(actor, id, clock);
        await requireFeature(access.workspaceId, "canvasBoardRealtime");
        if (!(await deps.cache.consumeRateLimit(`canvas-presence:${actor.userId}`, 180, 60_000)))
          throw new CanvasBoardError("RATE_LIMITED", "Presence is updating too quickly");
        await deps.canvases.authorize(await sameUser(request, actor.userId), id, clock);
        await deps.cache.setCanvasPresence?.(id, {
          userId: actor.userId,
          name: actor.email,
          cursor: input.cursor,
          expiresAt: Date.now() + 10_000,
        });
        try {
          await deps.canvases.authorize(await sameUser(request, actor.userId), id, clock);
        } catch (error) {
          await deps.cache.removeCanvasPresence?.(id, actor.userId);
          throw error;
        }
        return reply.code(204).send();
      },
    );
    routes.get("/v1/canvas-boards/:id/presence", routeOptions, async (request) => {
      const actor = await user(request);
      const { id } = Id.parse(request.params);
      const access = await deps.canvases.authorize(actor, id, clock);
      await requireFeature(access.workspaceId, "canvasBoardRealtime");
      const members = (await deps.cache.listCanvasPresence?.(id)) ?? [];
      // A cached cursor is not proof that its author still belongs to this board.
      const eligible = await Promise.all(
        members.slice(0, 100).map(async (member) => {
          try {
            await deps.canvases.authorize({ userId: member.userId }, id, clock);
            return member;
          } catch {
            await deps.cache.removeCanvasPresence?.(id, member.userId);
            return null;
          }
        }),
      );
      await deps.canvases.authorize(await sameUser(request, actor.userId), id, clock);
      return {
        members: eligible
          .filter((member) => member !== null)
          .map(({ userId, name, cursor }) => ({ userId, name, cursor })),
      };
    });
    routes.delete("/v1/canvas-boards/:id/presence", routeOptions, async (request, reply) => {
      const actor = await user(request);
      await deps.cache.removeCanvasPresence?.(Id.parse(request.params).id, actor.userId);
      return reply.code(204).send();
    });

    routes.post(
      "/v1/canvas-boards/:id/media",
      { ...routeOptions, bodyLimit: 2048 },
      async (request, reply) => {
        const actor = await user(request);
        const { id } = Id.parse(request.params);
        const context = await deps.canvases.getUploadContext(actor, id, clock);
        if (!(await uploadsAvailable())) return uploadUnavailable(request, reply);
        if (!(await deps.cache.consumeRateLimit(`canvas-media-create:${actor.userId}`, 20, 60_000)))
          throw new CanvasBoardError(
            "RATE_LIMITED",
            "Too many image uploads. Wait a minute and retry",
          );
        const supplied = MediaUploadRequestSchema.strict().parse(request.body);
        const input = MediaUploadRequestSchema.parse({
          ...supplied,
          altText: cleanPlainText(supplied.altText.normalize("NFC"), 300),
        });
        const upload = await deps.storage.createUpload({
          workspaceId: context.workspaceId,
          ...input,
        });
        await deps.canvases.reserveMedia(
          await sameUser(request, actor.userId),
          id,
          upload.media,
          clock,
        );
        await deps.repository.recordAudit({
          workspaceId: context.workspaceId,
          actorId: actor.userId,
          action: "canvas_board.media_upload_requested",
          targetType: "canvas_board",
          targetId: id,
          requestId: request.id,
          metadata: {
            mediaId: upload.media.id,
            mimeType: upload.media.mimeType,
            sizeBytes: upload.media.sizeBytes,
          },
        });
        await deps.canvases.getUpload(
          await sameUser(request, actor.userId),
          id,
          upload.media.id,
          clock,
        );
        return reply.code(201).send({
          mediaId: upload.media.id,
          uploadUrl: upload.uploadUrl,
          expiresInSeconds: upload.expiresInSeconds,
          scanStatus: upload.media.scanStatus,
        });
      },
    );
    routes.post(
      "/v1/canvas-boards/:id/media/:mediaId/complete",
      { ...routeOptions, bodyLimit: 1024 },
      async (request, reply) => {
        const actor = await user(request);
        const { id, mediaId } = MediaParams.parse(request.params);
        z.object({})
          .strict()
          .parse(request.body ?? {});
        const access = async () =>
          deps.canvases.getUpload(await sameUser(request, actor.userId), id, mediaId, clock);
        const asset = await access();
        if (asset.scanStatus === "clean" || asset.scanStatus === "rejected")
          return { media: { id: asset.id, scanStatus: asset.scanStatus, altText: asset.altText } };
        if (!(await uploadsAvailable())) return uploadUnavailable(request, reply);
        try {
          return await completeMediaFinalization(
            {
              workspaceId: asset.workspaceId,
              asset,
              actorId: actor.userId,
              requestId: request.id,
              log: request.log,
              repository: deps.repository,
              storage: deps.storage,
              metrics: deps.metrics,
            },
            async (updated) => {
              const current = await access();
              if (
                current.scanStatus !== updated.scanStatus ||
                current.objectKey !== updated.objectKey
              )
                throw new CanvasBoardError("NOT_FOUND", "Image not found");
              return {
                media: { id: updated.id, scanStatus: updated.scanStatus, altText: updated.altText },
              };
            },
          );
        } catch (error) {
          if (!(error instanceof MediaFinalizationConflictError)) throw error;
          return reply
            .code(409)
            .send({ error: { code: "CONFLICT", message: error.message, requestId: request.id } });
        }
      },
    );
    async function imageBytes(
      mediaId: string,
      authorize: () => Promise<{ workspaceId: string }>,
      reply: FastifyReply,
    ) {
      const access = await authorize();
      const asset = await deps.repository.getMediaAsset(access.workspaceId, mediaId);
      if (!asset || asset.scanStatus !== "clean")
        throw new CanvasBoardError("NOT_FOUND", "Image not found");
      let content: Buffer;
      try {
        content = await deps.storage.readImage(asset);
      } catch {
        return reply.code(503).send({
          error: {
            code: "DEPENDENCY_UNAVAILABLE",
            message: "This image is temporarily unavailable",
          },
        });
      }
      const current = await deps.repository.getMediaAsset(access.workspaceId, mediaId);
      if (current?.scanStatus !== "clean" || current.objectKey !== asset.objectKey)
        throw new CanvasBoardError("NOT_FOUND", "Image not found");
      const rechecked = await authorize();
      if (rechecked.workspaceId !== access.workspaceId)
        throw new CanvasBoardError("NOT_FOUND", "Image not found");
      return reply
        .header("cache-control", "private, no-store")
        .header("referrer-policy", "no-referrer")
        .header("x-content-type-options", "nosniff")
        .type(asset.mimeType)
        .send(content);
    }
    routes.get(
      "/v1/canvas-boards/workshop/:sourceBoardId/guest/media/:mediaId",
      routeOptions,
      async (request, reply) => {
        const tokenHash = await guestToken(request);
        const { sourceBoardId, mediaId } = GuestMediaParams.parse(request.params);
        return imageBytes(
          mediaId,
          () => deps.canvases.authorizeGuestMedia(sourceBoardId, tokenHash, mediaId, clock),
          reply,
        );
      },
    );
    routes.get("/v1/canvas-boards/:id/media/:mediaId", routeOptions, async (request, reply) => {
      const actor = await user(request);
      const { id, mediaId } = MediaParams.parse(request.params);
      const authorize = async () =>
        deps.canvases.authorizeMedia(await sameUser(request, actor.userId), id, mediaId, clock);
      return imageBytes(mediaId, authorize, reply);
    });
    await registerCanvasFacilitationRoutes(routes, deps, {
      user,
      sameUser,
      guestToken,
      requireFeature,
      imageBytes,
    });
  });
  return live;
}
