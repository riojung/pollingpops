import { z } from "zod";
import type { FastifyInstance } from "fastify";
import type {
  PresentationRepository,
  PresentationSessionRepository,
  Repository,
  ScopedQnaRepository,
} from "@openround/db";
import type { AuthService } from "./auth.js";
import type { MetricsService } from "./metrics.js";
import {
  PresentationInsightsService,
  PresentationInsightsServiceError,
} from "./presentation-insights-service.js";
import { PresentationInsightsProjectionError } from "./presentation-insights-projection.js";
export async function registerPresentationInsightsRoutes(
  app: FastifyInstance,
  deps: {
    repository: Repository;
    presentations: PresentationRepository;
    sessions: PresentationSessionRepository;
    qna: ScopedQnaRepository;
    auth: Pick<AuthService, "requireCreator" | "creatorFromRequest">;
    consumeAdmission: (key: string, maximum: number, windowMs: number) => Promise<boolean>;
    metrics?: Pick<MetricsService, "observePresentationInsights">;
  },
) {
  const service = new PresentationInsightsService(deps);
  app.get("/v1/presentation-sessions/:id/insights", async (request, reply) => {
    const started = performance.now();
    let outcome: Parameters<MetricsService["observePresentationInsights"]>[0] = "error",
      bytes = 0;
    reply
      .header("cache-control", "private, no-store")
      .header("pragma", "no-cache")
      .header("vary", "Cookie, Authorization, Origin")
      .header("x-content-type-options", "nosniff")
      .header("referrer-policy", "no-referrer");
    try {
      const actor = await deps.auth.requireCreator(request, reply);
      if (!actor) {
        outcome = "denied";
        return;
      }
      const { id } = z
        .object({
          id: z
            .string()
            .uuid()
            .transform((value) => value.toLowerCase()),
        })
        .strict()
        .parse(request.params);
      z.object({}).strict().parse(request.query);
      if (
        !(await deps.consumeAdmission(
          `presentation-insights:${actor.workspaceId}:${actor.userId}`,
          60,
          60_000,
        ))
      ) {
        outcome = "rate_limited";
        return reply
          .code(429)
          .header("retry-after", "60")
          .send({
            error: {
              code: "RATE_LIMITED",
              message: "Too many insights requests. Wait a minute and retry.",
            },
          });
      }
      const result = await service.get(actor, id, () => deps.auth.creatorFromRequest(request));
      outcome = result.status;
      bytes = Buffer.byteLength(JSON.stringify(result));
      return reply.code(result.status === "pending" ? 202 : 200).send(result);
    } catch (error) {
      if (error instanceof z.ZodError) {
        outcome = "unavailable";
        return reply.code(422).send({
          error: {
            code: "VALIDATION_ERROR",
            message: "Invalid insights request or unavailable report evidence",
          },
        });
      }
      if (error instanceof PresentationInsightsServiceError) {
        outcome = "unavailable";
        return reply
          .code(error.statusCode)
          .send({ error: { code: error.code, message: error.message } });
      }
      if (
        error instanceof PresentationInsightsProjectionError ||
        (error as { code?: string }).code === "NOT_FOUND"
      ) {
        outcome = "unavailable";
        return reply.code(404).send({
          error: {
            code: "INSIGHTS_UNAVAILABLE",
            message: "Presentation session insights are unavailable",
          },
        });
      }
      throw error;
    } finally {
      deps.metrics?.observePresentationInsights(
        outcome,
        (performance.now() - started) / 1000,
        bytes,
      );
    }
  });
  return service;
}
