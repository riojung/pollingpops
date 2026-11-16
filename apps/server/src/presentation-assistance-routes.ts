import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import {
  CreatePresentationAssistanceJobSchema,
  InsertPresentationAssistanceProposalsSchema,
} from "@openround/contracts";
import {
  PresentationAssistanceError,
  PresentationDraftConflictError,
  PresentationMutationConflictError,
  type Repository,
} from "@openround/db";
import type { AuthService } from "./auth.js";
import type { AppConfig } from "./config.js";
import { workspaceEntitlements } from "./entitlements.js";
import {
  PresentationAssistanceServiceError,
  type PresentationAssistanceService,
} from "./presentation-assistance-service.js";

const Id = z
  .string()
  .uuid()
  .transform((value) => value.toLowerCase());
const Query = z.object({ presentationId: Id }).strict();
const Params = z.object({ id: Id });
function failure(
  reply: FastifyReply,
  status: number,
  code: string,
  message: string,
  requestId: string,
) {
  return reply.code(status).send({ error: { code, message, requestId } });
}

export async function registerPresentationAssistanceRoutes(
  app: FastifyInstance,
  deps: {
    repository: Repository;
    auth: AuthService;
    config: AppConfig;
    service: PresentationAssistanceService;
  },
) {
  const { repository, auth, config, service } = deps;
  const safe = async (reply: FastifyReply, requestId: string, run: () => Promise<unknown>) => {
    reply.header("cache-control", "private, no-store").header("pragma", "no-cache");
    try {
      return await run();
    } catch (error) {
      if (error instanceof PresentationAssistanceServiceError)
        return failure(reply, error.status, error.code, error.message, requestId);
      if (error instanceof PresentationAssistanceError)
        return failure(
          reply,
          error.code === "NOT_FOUND"
            ? 404
            : error.code === "LIMIT_REACHED" || error.code === "ACTIVE_LIMIT_REACHED"
              ? 429
              : 409,
          error.code,
          error.code === "LIMIT_REACHED"
            ? "The workspace monthly authoring allowance has been used"
            : error.code === "ACTIVE_LIMIT_REACHED"
              ? "Two assistance jobs are already active. Wait for one to finish"
              : error.code === "NOT_FOUND"
                ? "Presentation assistance job not found"
                : "This request belongs to a different outline or presentation",
          requestId,
        );
      if (error instanceof PresentationDraftConflictError)
        return failure(
          reply,
          409,
          "STALE_DRAFT",
          "This presentation changed. Reload before inserting reviewed slides",
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
      app.log.error(
        { requestId, errorType: error instanceof Error ? error.name : "unknown" },
        "presentation assistance operation deferred",
      );
      return failure(
        reply,
        503,
        "DEPENDENCY_UNAVAILABLE",
        "Presentation assistance could not finish. Retry this request later",
        requestId,
      );
    }
  };

  app.get("/v1/presentation-assistance/status", async (request, reply) => {
    const actor = await auth.requireCreator(request, reply);
    if (!actor) return;
    const { presentationId } = Query.parse(request.query);
    return safe(reply, request.id, async () => {
      const entitlements = await workspaceEntitlements(
        repository,
        config,
        actor.workspaceId,
        actor.plan,
      );
      return {
        status: await service.status(actor, presentationId, entitlements.authoringJobsPerMonth),
      };
    });
  });
  app.post(
    "/v1/presentation-assistance/jobs",
    { bodyLimit: 80_000, config: { rateLimit: { max: 10, timeWindow: "5 minutes" } } },
    async (request, reply) => {
      const actor = await auth.requireCreator(request, reply);
      if (!actor) return;
      const input = CreatePresentationAssistanceJobSchema.parse(request.body);
      return safe(reply, request.id, async () => {
        const entitlements = await workspaceEntitlements(
          repository,
          config,
          actor.workspaceId,
          actor.plan,
        );
        const result = await service.create(actor, input, entitlements.authoringJobsPerMonth);
        return reply.code(result.status === "created" ? 202 : 200).send({ job: result.job });
      });
    },
  );
  app.get("/v1/presentation-assistance/jobs", async (request, reply) => {
    const actor = await auth.requireCreator(request, reply);
    if (!actor) return;
    const { presentationId } = Query.parse(request.query);
    return safe(reply, request.id, async () => ({
      jobs: await service.list(actor, presentationId),
    }));
  });
  app.get("/v1/presentation-assistance/jobs/:id", async (request, reply) => {
    const actor = await auth.requireCreator(request, reply);
    if (!actor) return;
    const { presentationId } = Query.parse(request.query),
      { id } = Params.parse(request.params);
    return safe(reply, request.id, async () => ({
      job: await service.get(actor, presentationId, id),
    }));
  });
  app.post(
    "/v1/presentations/:id/blocks/assistance-proposals",
    { bodyLimit: 16_000 },
    async (request, reply) => {
      const actor = await auth.requireCreator(request, reply);
      if (!actor) return;
      const { id } = Params.parse(request.params);
      const input = InsertPresentationAssistanceProposalsSchema.parse(request.body);
      return safe(reply, request.id, async () => {
        const result = await service.insert(actor, id, input);
        return reply.header("etag", `"draft-${result.presentation.draftRevision}"`).send(result);
      });
    },
  );
}
