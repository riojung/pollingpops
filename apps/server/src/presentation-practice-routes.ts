import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  CreatePresentationPracticeAssignmentSchema,
  StartPresentationPracticeAttemptSchema,
  PresentationPracticeProgressSchema,
  PresentationPracticeAssignmentCreatedSchema,
  PresentationPracticeAssignmentListSchema,
  PresentationPracticePreviewSchema,
  PresentationPracticeAssignmentAccessSchema,
  PresentationPracticeAttemptSnapshotSchema,
  PresentationPracticeMutationResultSchema,
  PresentationPracticeInsightsSchema,
} from "@openround/contracts";
import {
  PresentationPracticeAssignmentError,
  type PresentationPracticeAssignmentRepository,
  type Repository,
} from "@openround/db";
import type { AuthService } from "./auth.js";
import type { AppConfig } from "./config.js";
import type { StorageService } from "./storage.js";
import { workspaceFeatureEnabled } from "./feature-policy.js";
import {
  PresentationPracticeService,
  PresentationPracticeMediaBusyError,
} from "./presentation-practice-service.js";

const id = z
  .string()
  .uuid()
  .transform((value) => value.toLowerCase());
const params = z.object({ id }).strict();
const assignmentParams = params.extend({ assignmentId: id });
const attemptParams = params.extend({ attemptId: id });
const mediaParams = params.extend({ mediaId: id });
const bearer = (request: FastifyRequest) =>
  /^Bearer ([A-Za-z0-9_-]{43})$/.exec(request.headers.authorization ?? "")?.[1] ?? "";
const failure = (reply: FastifyReply, status: number, code: string, message: string) =>
  reply.code(status).send({ error: { code, message } });

export async function registerPresentationPracticeRoutes(
  app: FastifyInstance,
  deps: {
    auth: Pick<AuthService, "requireCreator">;
    repository: Repository;
    assignments: PresentationPracticeAssignmentRepository;
    storage: Pick<StorageService, "readImage">;
    config: AppConfig;
    consumeAdmission: (key: string, maximum: number, windowMs: number) => Promise<boolean>;
    featureEnabled?: (workspaceId: string) => Promise<boolean>;
  },
) {
  const service = new PresentationPracticeService({
    repository: deps.repository,
    assignments: deps.assignments,
    storage: deps.storage,
    webOrigin: deps.config.WEB_ORIGIN,
    featureEnabled:
      deps.featureEnabled ??
      ((workspaceId) =>
        workspaceFeatureEnabled(deps.repository, deps.config, workspaceId, "presentations")),
  });
  async function budget(
    request: FastifyRequest,
    reply: FastifyReply,
    operation: string,
    resourceId: string,
    maximum: number,
  ) {
    if (
      (await deps.consumeAdmission(
        `presentation-practice:${operation}:ip:${request.ip}`,
        maximum * 2,
        60_000,
      )) &&
      (await deps.consumeAdmission(
        `presentation-practice:${operation}:${resourceId}:${request.ip}`,
        maximum,
        60_000,
      ))
    )
      return true;
    reply.header("retry-after", "60");
    failure(reply, 429, "RATE_LIMITED", "Too many practice requests. Try again in a minute.");
    return false;
  }
  await app.register(async (scoped) => {
    scoped.addHook("onRequest", async (_request, reply) => {
      reply
        .header("cache-control", "private, no-store")
        .header("pragma", "no-cache")
        .header("vary", "Authorization, Cookie, Origin")
        .header("x-robots-tag", "noindex, nofollow, noarchive")
        .header("referrer-policy", "no-referrer")
        .header("x-content-type-options", "nosniff");
    });
    scoped.setErrorHandler((error, _request, reply) => {
      if (error instanceof z.ZodError)
        return failure(
          reply,
          422,
          "PRESENTATION_PRACTICE_INVALID",
          "Check the practice request and try again.",
        );
      if (error instanceof PresentationPracticeMediaBusyError)
        return reply
          .header("retry-after", "1")
          .code(503)
          .send({
            error: {
              code: "PRESENTATION_MEDIA_BUSY",
              message: "Images are busy. Try again shortly.",
            },
          });
      if (error instanceof PresentationPracticeAssignmentError) {
        if (error.code === "REQUEST_EXPIRED")
          return failure(
            reply,
            410,
            "PRESENTATION_PRACTICE_REQUEST_EXPIRED",
            "This request expired before it was accepted. Create a fresh practice assignment.",
          );
        if (error.code === "UNAVAILABLE")
          return failure(
            reply,
            404,
            "PRESENTATION_PRACTICE_UNAVAILABLE",
            "This practice assignment or private attempt is unavailable or has expired.",
          );
        const validation = ["INVALID_BLOCK", "INVALID_RESPONSE", "UNSUPPORTED_CONTENT"].includes(
          error.code,
        );
        return failure(
          reply,
          validation ? 422 : 409,
          `PRESENTATION_PRACTICE_${error.code}`,
          error.message,
        );
      }
      if (
        ["23503", "23505", "23514", "40001", "40P01", "55P03", "57014"].includes(
          (error as { code?: string }).code ?? "",
        )
      )
        return reply
          .header("retry-after", "1")
          .code(503)
          .send({
            error: {
              code: "PRESENTATION_PRACTICE_BUSY",
              message: "Practice progress is busy. Retry the same request shortly.",
            },
          });
      throw error;
    });
    const author = "/v1/presentations/:id/practice-assignments";
    scoped.get(author, async (request, reply) => {
      const actor = await deps.auth.requireCreator(request, reply);
      if (!actor) return;
      const { id } = params.parse(request.params);
      if (!(await budget(request, reply, "list", actor.userId, 60))) return;
      return PresentationPracticeAssignmentListSchema.parse(await service.list(actor, id));
    });
    scoped.post(author, async (request, reply) => {
      const actor = await deps.auth.requireCreator(request, reply);
      if (!actor) return;
      const { id } = params.parse(request.params);
      if (!(await budget(request, reply, "create", actor.userId, 20))) return;
      const result = await service.create(
        actor,
        id,
        CreatePresentationPracticeAssignmentSchema.parse(request.body),
      );
      await deps.repository.recordAudit({
        workspaceId: actor.workspaceId,
        actorId: actor.userId,
        action: "presentation.practice.create",
        targetType: "presentation",
        targetId: id,
        requestId: request.id,
        metadata: {
          assignmentId: result.assignment.id,
          versionId: result.assignment.versionId,
          replayed: result.replayed,
        },
      });
      return reply
        .code(result.replayed ? 200 : 201)
        .send(PresentationPracticeAssignmentCreatedSchema.parse(result));
    });
    scoped.get(`${author}/:assignmentId/insights`, async (request, reply) => {
      const actor = await deps.auth.requireCreator(request, reply);
      if (!actor) return;
      const { id, assignmentId } = assignmentParams.parse(request.params);
      if (!(await budget(request, reply, "insights", actor.userId, 30))) return;
      return PresentationPracticeInsightsSchema.parse(
        await service.insights(actor, id, assignmentId),
      );
    });
    scoped.delete(`${author}/:assignmentId`, async (request, reply) => {
      const actor = await deps.auth.requireCreator(request, reply);
      if (!actor) return;
      const { id, assignmentId } = assignmentParams.parse(request.params);
      if (!(await budget(request, reply, "revoke", actor.userId, 30))) return;
      await service.revoke(actor, id, assignmentId);
      await deps.repository.recordAudit({
        workspaceId: actor.workspaceId,
        actorId: actor.userId,
        action: "presentation.practice.revoke",
        targetType: "presentation",
        targetId: id,
        requestId: request.id,
        metadata: { assignmentId },
      });
      return reply.code(204).send();
    });
    const recipient = "/v1/presentation-practice/:id";
    scoped.get(recipient, async (request, reply) => {
      const { id } = params.parse(request.params);
      if (!(await budget(request, reply, "preview", id, 120))) return;
      return PresentationPracticePreviewSchema.parse(await service.read(id, bearer(request)));
    });
    scoped.get(`${recipient}/access`, async (request, reply) => {
      const { id } = params.parse(request.params);
      if (!(await budget(request, reply, "access", id, 120))) return;
      return PresentationPracticeAssignmentAccessSchema.parse(
        await service.access(id, bearer(request)),
      );
    });
    scoped.post(`${recipient}/attempts`, async (request, reply) => {
      const { id } = params.parse(request.params);
      if (!(await budget(request, reply, "start", id, 120))) return;
      const result = await service.start(
        id,
        bearer(request),
        StartPresentationPracticeAttemptSchema.parse(request.body),
      );
      return reply
        .code(result.replayed ? 200 : 201)
        .send(PresentationPracticeMutationResultSchema.parse(result));
    });
    scoped.get(`${recipient}/attempts/:attemptId`, async (request, reply) => {
      const { id, attemptId } = attemptParams.parse(request.params);
      if (!(await budget(request, reply, "resume", id, 120))) return;
      return PresentationPracticeAttemptSnapshotSchema.parse(
        await service.attempt(id, attemptId, bearer(request)),
      );
    });
    scoped.post(`${recipient}/attempts/:attemptId/progress`, async (request, reply) => {
      const { id, attemptId } = attemptParams.parse(request.params);
      if (!(await budget(request, reply, "progress", id, 120))) return;
      const result = await service.progress(
        id,
        attemptId,
        bearer(request),
        PresentationPracticeProgressSchema.parse(request.body),
      );
      return PresentationPracticeMutationResultSchema.parse(result);
    });
    scoped.get(`${recipient}/media/:mediaId`, async (request, reply) => {
      const { id, mediaId } = mediaParams.parse(request.params);
      if (!(await budget(request, reply, "media", id, 120))) return;
      const value = await service.media(id, bearer(request), mediaId);
      return reply.header("content-type", value.contentType).send(value.bytes);
    });
  });
  return service;
}
