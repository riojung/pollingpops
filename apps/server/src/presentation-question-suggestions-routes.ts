import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import {
  InsertPresentationQuestionSuggestionSchema,
  CreatePresentationQuestionSuggestionsJobSchema,
} from "@openround/contracts";
import {
  PresentationQuestionSuggestionsError,
  PresentationDraftConflictError,
  PresentationMutationConflictError,
  type Repository,
} from "@openround/db";
import type { AuthService } from "./auth.js";
import type { AppConfig } from "./config.js";
import type { SessionCache } from "./cache.js";
import { workspaceEntitlements } from "./entitlements.js";
import {
  PresentationQuestionSuggestionsServiceError,
  type PresentationQuestionSuggestionsService,
} from "./presentation-question-suggestions-service.js";

const Id = z
  .string()
  .uuid()
  .transform((value) => value.toLowerCase());
const Query = z.object({ presentationId: Id }).strict();
const Params = z.object({ id: Id });
const failure = (
  reply: FastifyReply,
  status: number,
  code: string,
  message: string,
  requestId: string,
) => reply.code(status).send({ error: { code, message, requestId } });

export async function registerPresentationQuestionSuggestionsRoutes(
  app: FastifyInstance,
  deps: {
    repository: Repository;
    auth: AuthService;
    config: AppConfig;
    service: PresentationQuestionSuggestionsService;
    consumeAdmission: SessionCache["consumeRateLimit"];
  },
) {
  const { repository, auth, config, service } = deps;
  const safe = async (reply: FastifyReply, requestId: string, run: () => Promise<unknown>) => {
    reply.header("cache-control", "private, no-store").header("pragma", "no-cache");
    try {
      return await run();
    } catch (error) {
      if (error instanceof PresentationQuestionSuggestionsServiceError)
        return failure(reply, error.status, error.code, error.message, requestId);
      if (error instanceof PresentationQuestionSuggestionsError)
        return failure(
          reply,
          error.code === "NOT_FOUND"
            ? 404
            : ["LIMIT_REACHED", "ACTIVE_LIMIT_REACHED"].includes(error.code)
              ? 429
              : 409,
          error.code,
          error.code === "LIMIT_REACHED"
            ? "The workspace monthly authoring allowance has been used"
            : error.code === "ACTIVE_LIMIT_REACHED"
              ? "Two assistance jobs are already active. Wait for one to finish"
              : error.code === "NOT_FOUND"
                ? "Question suggestions job not found"
                : "This request no longer matches the selected source or presentation",
          requestId,
        );
      if (error instanceof PresentationDraftConflictError)
        return failure(
          reply,
          409,
          "STALE_DRAFT",
          "This presentation changed. Reload before inserting the reviewed question",
          requestId,
        );
      if (error instanceof PresentationMutationConflictError)
        return failure(
          reply,
          409,
          "CONFLICT",
          "This mutation ID belongs to a different presentation change",
          requestId,
        );
      if (error instanceof z.ZodError) throw error;
      app.log.error({ requestId }, "presentation question suggestions operation deferred");
      return failure(
        reply,
        503,
        "DEPENDENCY_UNAVAILABLE",
        "Question suggestions could not finish. Retry this request later",
        requestId,
      );
    }
  };
  const allowance = async (actor: {
    workspaceId: string;
    plan: Parameters<typeof workspaceEntitlements>[3];
  }) =>
    (await workspaceEntitlements(repository, config, actor.workspaceId, actor.plan))
      .authoringJobsPerMonth;
  const admit = async (workspaceId: string, userId: string) => {
    if (
      !(await deps.consumeAdmission(
        `presentation-question-suggestions:${workspaceId}:${userId}`,
        10,
        5 * 60_000,
      ))
    )
      throw new PresentationQuestionSuggestionsServiceError(
        "RATE_LIMITED",
        429,
        "Too many question suggestions changes. Retry later",
      );
  };

  app.get("/v1/presentation-question-suggestions/status", async (request, reply) => {
    const actor = await auth.requireCreator(request, reply);
    if (!actor) return;
    const { presentationId } = Query.parse(request.query);
    return safe(reply, request.id, async () => ({
      status: await service.status(actor, presentationId, await allowance(actor)),
    }));
  });
  app.post(
    "/v1/presentation-question-suggestions/jobs",
    { bodyLimit: 8_000, config: { rateLimit: { max: 10, timeWindow: "5 minutes" } } },
    async (request, reply) => {
      const actor = await auth.requireCreator(request, reply);
      if (!actor) return;
      const input = CreatePresentationQuestionSuggestionsJobSchema.parse(request.body);
      return safe(reply, request.id, async () => {
        await admit(actor.workspaceId, actor.userId);
        const result = await service.create(actor, input, await allowance(actor));
        return reply.code(result.status === "created" ? 202 : 200).send({ job: result.job });
      });
    },
  );
  app.get("/v1/presentation-question-suggestions/jobs", async (request, reply) => {
    const actor = await auth.requireCreator(request, reply);
    if (!actor) return;
    const { presentationId } = Query.parse(request.query);
    return safe(reply, request.id, async () => ({
      jobs: await service.list(actor, presentationId),
    }));
  });
  app.get("/v1/presentation-question-suggestions/jobs/:id", async (request, reply) => {
    const actor = await auth.requireCreator(request, reply);
    if (!actor) return;
    const { presentationId } = Query.parse(request.query),
      { id } = Params.parse(request.params);
    return safe(reply, request.id, async () => ({
      job: await service.get(actor, presentationId, id),
    }));
  });
  app.post(
    "/v1/presentations/:id/question-suggestions/insert",
    { bodyLimit: 8_000, config: { rateLimit: { max: 10, timeWindow: "5 minutes" } } },
    async (request, reply) => {
      const actor = await auth.requireCreator(request, reply);
      if (!actor) return;
      const { id } = Params.parse(request.params),
        input = InsertPresentationQuestionSuggestionSchema.parse(request.body);
      return safe(reply, request.id, async () => {
        await admit(actor.workspaceId, actor.userId);
        const result = await service.insert(actor, id, input);
        return reply.header("etag", `"draft-${result.presentation.draftRevision}"`).send(result);
      });
    },
  );
}
