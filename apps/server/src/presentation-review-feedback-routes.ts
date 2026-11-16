import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  EnablePresentationReviewSchema,
  PresentationReviewFeedbackMutationSchema,
} from "@openround/contracts";
import {
  PresentationReviewFeedbackError,
  type PresentationReviewFeedbackRepository,
  type Repository,
} from "@openround/db";
import type { AuthService } from "./auth.js";
import type { AppConfig } from "./config.js";
import { workspaceFeatureEnabled } from "./feature-policy.js";
import { PresentationReviewFeedbackService } from "./presentation-review-feedback-service.js";

const id = z
  .string()
  .uuid()
  .transform((value) => value.toLowerCase());
const params = z.object({ id }).strict();
const authorParams = params.extend({ shareId: id });
const bearer = (request: FastifyRequest) =>
  /^Bearer ([A-Za-z0-9_-]{43})$/.exec(request.headers.authorization ?? "")?.[1] ?? "";
const safeDatabaseCodes = new Set(["23503", "23505", "23514", "40001", "40P01", "55P03", "57014"]);
function failure(reply: FastifyReply, status: number, code: string, message: string) {
  return reply.code(status).send({ error: { code, message } });
}

export async function registerPresentationReviewFeedbackRoutes(
  app: FastifyInstance,
  deps: {
    auth: Pick<
      AuthService,
      "requireCreator" | "requireUser" | "creatorFromRequest" | "userFromRequest"
    >;
    repository: Repository;
    feedback: PresentationReviewFeedbackRepository;
    config: AppConfig;
    consumeAdmission: (key: string, maximum: number, windowMs: number) => Promise<boolean>;
    featureEnabled?: (workspaceId: string) => Promise<boolean>;
  },
) {
  const service = new PresentationReviewFeedbackService({
    feedback: deps.feedback,
    featureEnabled:
      deps.featureEnabled ??
      ((workspaceId) =>
        workspaceFeatureEnabled(deps.repository, deps.config, workspaceId, "presentations")),
  });
  async function budget(
    request: FastifyRequest,
    reply: FastifyReply,
    operation: "access" | "read" | "write",
    shareId: string,
    actorId?: string,
  ) {
    const maximum = operation === "write" ? 30 : 120;
    if (
      (await deps.consumeAdmission(
        `presentation-review:${operation}:ip:${request.ip}`,
        maximum * 2,
        60_000,
      )) &&
      (await deps.consumeAdmission(
        `presentation-review:${operation}:share:${shareId}:${actorId ? `user:${actorId}` : `ip:${request.ip}`}`,
        maximum,
        60_000,
      ))
    )
      return true;
    reply.header("retry-after", "60");
    failure(reply, 429, "RATE_LIMITED", "Too many review requests. Try again in a minute.");
    return false;
  }
  await app.register(async (scoped) => {
    scoped.addHook("onRequest", async (_request, reply) => {
      reply
        .header("cache-control", "private, no-store")
        .header("pragma", "no-cache")
        .header("vary", "Authorization, Cookie, Origin")
        .header("referrer-policy", "no-referrer")
        .header("x-content-type-options", "nosniff")
        .header("x-robots-tag", "noindex, nofollow, noarchive");
    });
    scoped.setErrorHandler((error, request, reply) => {
      if (error instanceof z.ZodError)
        return failure(
          reply,
          422,
          "PRESENTATION_REVIEW_INVALID",
          "Check the review action and refresh before trying again.",
        );
      if (error instanceof PresentationReviewFeedbackError) {
        const statuses = {
          UNAVAILABLE: 404,
          CONFLICT: 409,
          IDEMPOTENCY_CONFLICT: 409,
          REVIEW_LIMIT: 409,
          VALIDATION_ERROR: 422,
        } as const;
        const codes = {
          UNAVAILABLE: "PRESENTATION_REVIEW_UNAVAILABLE",
          CONFLICT: "PRESENTATION_REVIEW_CONFLICT",
          IDEMPOTENCY_CONFLICT: "PRESENTATION_REVIEW_IDEMPOTENCY_CONFLICT",
          REVIEW_LIMIT: "PRESENTATION_REVIEW_LIMIT",
          VALIDATION_ERROR: "PRESENTATION_REVIEW_INVALID",
        } as const;
        return failure(reply, statuses[error.code], codes[error.code], error.message);
      }
      const candidate = (error as { code?: unknown }).code;
      if (candidate === "FST_ERR_CTP_BODY_TOO_LARGE")
        return failure(
          reply,
          413,
          "PRESENTATION_REVIEW_INVALID",
          "This review request is too large.",
        );
      if (
        candidate === "FST_ERR_CTP_INVALID_JSON_BODY" ||
        candidate === "FST_ERR_CTP_EMPTY_JSON_BODY"
      )
        return failure(
          reply,
          400,
          "PRESENTATION_REVIEW_INVALID",
          "Review requests must contain valid JSON.",
        );
      const databaseCode =
        typeof candidate === "string" && safeDatabaseCodes.has(candidate) ? candidate : undefined;
      request.log.error(
        { requestId: request.id, ...(databaseCode ? { databaseCode } : {}) },
        "Presentation review operation deferred",
      );
      reply.header("retry-after", "1");
      return failure(
        reply,
        503,
        "DEPENDENCY_UNAVAILABLE",
        "Review feedback is temporarily unavailable. Retry the same action shortly.",
      );
    });
    const authorPath = "/v1/presentations/:id/shares/:shareId/feedback";
    scoped.get(authorPath, async (request, reply) => {
      const actor = await deps.auth.requireCreator(request, reply);
      if (!actor) return;
      const { id, shareId } = authorParams.parse(request.params);
      if (!(await budget(request, reply, "read", shareId, actor.userId))) return;
      return service.authorReview(actor, id, shareId, {
        reauthorize: () => deps.auth.creatorFromRequest(request),
      });
    });
    scoped.post(authorPath, { bodyLimit: 1024 }, async (request, reply) => {
      const actor = await deps.auth.requireCreator(request, reply);
      if (!actor) return;
      const { id, shareId } = authorParams.parse(request.params);
      if (!(await budget(request, reply, "write", shareId, actor.userId))) return;
      const result = await service.enable(
        actor,
        id,
        shareId,
        EnablePresentationReviewSchema.parse(request.body),
        { reauthorize: () => deps.auth.creatorFromRequest(request) },
      );
      return reply.code(result.replayed ? 200 : 201).send(result);
    });
    scoped.post(`${authorPath}/commands`, { bodyLimit: 16 * 1024 }, async (request, reply) => {
      const actor = await deps.auth.requireCreator(request, reply);
      if (!actor) return;
      const { id, shareId } = authorParams.parse(request.params);
      if (!(await budget(request, reply, "write", shareId, actor.userId))) return;
      return service.authorMutation(
        actor,
        id,
        shareId,
        PresentationReviewFeedbackMutationSchema.parse(request.body),
        { reauthorize: () => deps.auth.creatorFromRequest(request) },
      );
    });
    const recipientPath = "/v1/shared-presentations/:id/feedback";
    scoped.get(`${recipientPath}/access`, async (request, reply) => {
      const { id } = params.parse(request.params);
      if (!(await budget(request, reply, "access", id))) return;
      return service.access(id, bearer(request));
    });
    scoped.get(recipientPath, async (request, reply) => {
      const actor = await deps.auth.requireUser(request, reply);
      if (!actor) return;
      const { id } = params.parse(request.params);
      if (!(await budget(request, reply, "read", id, actor.userId))) return;
      return service.reviewerReview(actor, id, bearer(request), {
        reauthorize: () => deps.auth.userFromRequest(request),
      });
    });
    scoped.post(`${recipientPath}/commands`, { bodyLimit: 16 * 1024 }, async (request, reply) => {
      const actor = await deps.auth.requireUser(request, reply);
      if (!actor) return;
      const { id } = params.parse(request.params);
      if (!(await budget(request, reply, "write", id, actor.userId))) return;
      return service.reviewerMutation(
        actor,
        id,
        bearer(request),
        PresentationReviewFeedbackMutationSchema.parse(request.body),
        { reauthorize: () => deps.auth.userFromRequest(request) },
      );
    });
  });
  return service;
}
