import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  LibraryShareCopySchema,
  LibraryShareCreateSchema,
  LibraryShareProgressSchema,
  type LibraryShareSummary,
} from "@openround/contracts";
import { LibrarySharingError, type LibrarySharingRepository, type Repository } from "@openround/db";
import type { AuthService } from "./auth.js";
import type { AppConfig } from "./config.js";
import type { StorageService } from "./storage.js";
import {
  LibrarySharingCopyBusyError,
  LibrarySharingMediaBusyError,
  LibrarySharingService,
} from "./library-sharing-service.js";

const Id = z.object({ id: z.string().uuid() });
const Query = z
  .object({
    scope: z.enum(["organization", "shared", "managed"]).default("organization"),
    organizationId: z.string().uuid().optional(),
    cursor: z.string().max(200).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict();

export async function registerLibrarySharingRoutes(
  app: FastifyInstance,
  deps: {
    repository: Repository;
    shares: LibrarySharingRepository;
    auth: Pick<AuthService, "requireUser" | "requireCreator" | "creatorFromRequest">;
    storage: Pick<StorageService, "readImage" | "cloneLibraryImage" | "deleteLibraryImageClone">;
    config: AppConfig;
    consumeAdmission: (key: string, maximum: number, windowMs: number) => Promise<boolean>;
    featureEnabled?: (
      workspaceId: string,
      artifactType: LibraryShareSummary["artifactType"],
    ) => Promise<boolean>;
  },
) {
  const service = new LibrarySharingService(deps);
  await app.register(async (scoped) => {
    scoped.addHook("onRequest", async (_request, reply) => {
      reply
        .header("cache-control", "private, no-store")
        .header("vary", "Cookie, Origin")
        .header("x-robots-tag", "noindex, nofollow, noarchive")
        .header("referrer-policy", "no-referrer")
        .header("x-content-type-options", "nosniff");
    });
    scoped.setErrorHandler((error, request, reply) => {
      if (error instanceof LibrarySharingCopyBusyError)
        return reply
          .header("retry-after", "1")
          .code(503)
          .send({
            error: { code: "LIBRARY_COPY_BUSY", message: error.message, requestId: request.id },
          });
      if (error instanceof LibrarySharingMediaBusyError)
        return reply
          .header("retry-after", "1")
          .code(503)
          .send({
            error: { code: "LIBRARY_MEDIA_BUSY", message: error.message, requestId: request.id },
          });
      if (error instanceof z.ZodError)
        return reply.code(422).send({
          error: {
            code: "VALIDATION_ERROR",
            message: "Check the Library sharing request",
            requestId: request.id,
          },
        });
      if (error instanceof LibrarySharingError) {
        const status =
          error.code === "NOT_FOUND"
            ? 404
            : error.code === "FORBIDDEN"
              ? 403
              : error.code === "IDEMPOTENCY_CONFLICT"
                ? 409
                : 422;
        return reply
          .code(status)
          .send({ error: { code: error.code, message: error.message, requestId: request.id } });
      }
      throw error;
    });
    scoped.get("/v1/library/share-recipients", async (request, reply) => {
      const actor = await deps.auth.requireCreator(request, reply);
      if (!actor) return;
      if (actor.role === "viewer")
        throw new LibrarySharingError(
          "FORBIDDEN",
          "Your workspace role does not allow sharing content.",
        );
      if (deps.featureEnabled && !(await deps.featureEnabled(actor.workspaceId, "round")))
        throw new LibrarySharingError("NOT_FOUND", "Library sharing is unavailable");
      const { search } = z
        .object({ search: z.string().trim().max(200).optional() })
        .strict()
        .parse(request.query);
      return {
        recipients: await deps.shares.recipients({
          actorId: actor.userId,
          workspaceId: actor.workspaceId,
          search,
        }),
      };
    });
    scoped.get("/v1/library/shares", async (request, reply) => {
      const actor = await deps.auth.requireUser(request, reply);
      if (!actor) return;
      const query = Query.parse(request.query);
      const result = await deps.shares.list({ actorId: actor.userId, ...query });
      const creator = await deps.auth.creatorFromRequest(request);
      return {
        ...result,
        shares: await Promise.all(result.shares.map((share) => service.summary(share, creator))),
      };
    });
    scoped.post("/v1/library/shares", async (request, reply) => {
      const actor = await deps.auth.requireCreator(request, reply);
      if (!actor) return;
      if (actor.role === "viewer")
        throw new LibrarySharingError(
          "FORBIDDEN",
          "Your workspace role does not allow sharing content.",
        );
      if (!(await deps.consumeAdmission(`library-share:create:${actor.userId}`, 20, 60_000)))
        return reply.code(429).send({
          error: {
            code: "RATE_LIMITED",
            message: "Too many sharing requests. Try again shortly.",
          },
        });
      const input = LibraryShareCreateSchema.parse(request.body);
      if (
        deps.featureEnabled &&
        !(await deps.featureEnabled(actor.workspaceId, input.artifactType))
      )
        throw new LibrarySharingError("NOT_FOUND", "Sharing this content type is unavailable");
      const result = await deps.shares.create({
        actorId: actor.userId,
        workspaceId: actor.workspaceId,
        input,
        now: new Date(),
      });
      await deps.repository.recordAudit({
        workspaceId: actor.workspaceId,
        actorId: actor.userId,
        action: "library.share.create",
        targetType: result.share.artifactType,
        targetId: result.share.artifactId,
        requestId: request.id,
        metadata: {
          shareId: result.share.id,
          versionId: result.share.versionId,
          replayed: result.replayed,
        },
      });
      return reply
        .code(result.replayed ? 200 : 201)
        .send({ ...result, share: await service.summary(result.share, actor) });
    });
    scoped.get("/v1/library/shares/:id", async (request, reply) => {
      const actor = await deps.auth.requireUser(request, reply);
      if (!actor) return;
      return service.reader(
        actor.userId,
        Id.parse(request.params).id,
        await deps.auth.creatorFromRequest(request),
      );
    });
    scoped.put("/v1/library/shares/:id/progress", async (request, reply) => {
      const actor = await deps.auth.requireUser(request, reply);
      if (!actor) return;
      const { id } = Id.parse(request.params);
      const { status } = LibraryShareProgressSchema.parse(request.body);
      const share = await deps.shares.progress({
        actorId: actor.userId,
        id,
        status,
        now: new Date(),
      });
      if (!share) throw new LibrarySharingError("NOT_FOUND", "Library item is unavailable");
      return { share: await service.summary(share, await deps.auth.creatorFromRequest(request)) };
    });
    scoped.delete("/v1/library/shares/:id", async (request, reply) => {
      const actor = await deps.auth.requireUser(request, reply);
      if (!actor) return;
      const { id } = Id.parse(request.params);
      const share = await deps.shares.read({ actorId: actor.userId, id, now: new Date() });
      if (!(await deps.shares.revoke({ actorId: actor.userId, id, now: new Date() })))
        throw new LibrarySharingError("NOT_FOUND", "Library item is unavailable");
      if (share)
        await deps.repository.recordAudit({
          workspaceId: share.sourceWorkspaceId,
          actorId: actor.userId,
          action: "library.share.revoke",
          targetType: share.artifactType,
          targetId: share.artifactId,
          requestId: request.id,
          metadata: { shareId: id },
        });
      return reply.code(204).send();
    });
    scoped.get("/v1/library/shares/:id/media/:mediaId", async (request, reply) => {
      const actor = await deps.auth.requireUser(request, reply);
      if (!actor) return;
      // One valid Round can render 200 question images, with room for bounded retries.
      if (!(await deps.consumeAdmission(`library-share:media:${actor.userId}`, 256, 60_000)))
        return reply.code(429).send({
          error: { code: "RATE_LIMITED", message: "Too many image requests. Try again shortly." },
        });
      const { id, mediaId } = Id.extend({ mediaId: z.string().uuid() }).parse(request.params);
      const media = await service.media(actor.userId, id, mediaId);
      return reply.header("content-type", media.contentType).send(media.bytes);
    });
    scoped.post("/v1/library/shares/:id/copy", async (request, reply) => {
      const actor = await deps.auth.requireCreator(request, reply);
      if (!actor) return;
      if (!(await deps.consumeAdmission(`library-share:copy:${actor.userId}`, 5, 60_000)))
        return reply.code(429).send({
          error: { code: "RATE_LIMITED", message: "Too many copy requests. Try again shortly." },
        });
      const { id } = Id.parse(request.params);
      const { requestId } = LibraryShareCopySchema.parse(request.body);
      const result = await service.copy(actor, id, requestId);
      await deps.repository.recordAudit({
        workspaceId: actor.workspaceId,
        actorId: actor.userId,
        action: "library.share.copy",
        targetType: result.artifactType,
        targetId: result.artifactId,
        requestId: request.id,
        metadata: { shareId: id, replayed: result.replayed },
      });
      return reply.code(result.replayed ? 200 : 201).send(result);
    });
  });
  return service;
}
