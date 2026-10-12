import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { FeedbackSubmissionSchema } from "@openround/contracts";
import {
  createFeedbackRepository,
  FeedbackConflictError,
  FeedbackCursorError,
  feedbackCursor,
  parseFeedbackCursor,
  type Repository,
} from "@openround/db";
import type { AuthService } from "./auth.js";
import type { AppConfig } from "./config.js";
import { safeHashEqual } from "./security.js";

export async function registerFeedbackRoutes(
  app: FastifyInstance,
  deps: {
    repository: Repository;
    auth: AuthService;
    config: AppConfig;
    consumeAdmission: (
      key: string,
      intent: string,
      maximum: number,
      windowMs: number,
    ) => Promise<boolean>;
  },
) {
  const feedback = createFeedbackRepository(deps.repository);
  app.post("/v1/feedback", { bodyLimit: 20_000 }, async (request, reply) => {
    reply.header("cache-control", "private, no-store");
    const actor = await deps.auth.requireCreator(request, reply);
    if (!actor) return;
    const validated = FeedbackSubmissionSchema.safeParse(request.body);
    if (!validated.success)
      return reply.code(422).send({
        error: {
          code: "VALIDATION_ERROR",
          requestId: request.id,
          message:
            "Choose a feedback type and enter 10–4,000 characters of plain text. Remove unsupported control characters and retry.",
        },
      });
    const input = validated.data;
    const previous = await feedback.find(actor.workspaceId, actor.userId, input.idempotencyKey);
    if (
      !previous &&
      !(await deps.consumeAdmission(
        `feedback:${actor.userId}`,
        `${actor.workspaceId}:${input.idempotencyKey}`,
        5,
        600_000,
      ))
    )
      return reply.code(429).send({
        error: {
          code: "RATE_LIMITED",
          message:
            "You have sent several reports. Wait ten minutes before sending new feedback; your draft is still here.",
          requestId: request.id,
        },
      });
    try {
      const receipt = await feedback.submit(actor.workspaceId, actor.userId, input, new Date());
      return reply
        .code(previous ? 200 : 201)
        .send({ feedbackId: receipt.id, receivedAt: receipt.createdAt.toISOString() });
    } catch (error) {
      if (error instanceof FeedbackConflictError)
        return reply.code(409).send({
          error: { code: "IDEMPOTENCY_CONFLICT", message: error.message, requestId: request.id },
        });
      throw error;
    }
  });
  app.get("/v1/admin/feedback", async (request, reply) => {
    reply.header("cache-control", "private, no-store");
    const token = request.headers.authorization?.replace(/^Bearer\s+/i, "");
    if (!deps.config.ADMIN_TOKEN || !token || !safeHashEqual(token, deps.config.ADMIN_TOKEN))
      return reply
        .code(401)
        .send({ error: { code: "UNAUTHORIZED", message: "Administrator token required" } });
    const query = z
      .object({
        cursor: z.string().min(1).max(256).optional(),
        limit: z.coerce.number().int().min(1).max(50).default(50),
      })
      .strict()
      .parse(request.query);
    try {
      const rows = await feedback.list(
        query.cursor ? parseFeedbackCursor(query.cursor) : undefined,
        query.limit + 1,
      );
      return {
        feedback: rows
          .slice(0, query.limit)
          .map(({ userId: _userId, idempotencyKey: _key, ...row }) => row),
        nextCursor: rows.length > query.limit ? feedbackCursor(rows[query.limit - 1]!) : null,
      };
    } catch (error) {
      if (error instanceof FeedbackCursorError)
        return reply.code(422).send({
          error: { code: "INVALID_CURSOR", message: error.message, requestId: request.id },
        });
      throw error;
    }
  });
}
