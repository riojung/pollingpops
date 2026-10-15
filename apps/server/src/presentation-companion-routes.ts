import { roomFeatureEnabled } from "./feature-policy.js";
import { createHash } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  PresentationCompanionCommandSchema,
  PresentationCompanionPassResponseSchema,
  PresentationCompanionSnapshotSchema,
  PresentationCompanionRecoveryPackCatalogSchema,
  PresentationCompanionPublishedQuestionCatalogSchema,
  type PresentationCompanionSnapshot,
} from "@openround/contracts";
import type { CreatorContext, Repository } from "@openround/db";
import type { AuthService } from "./auth.js";
import type { AppConfig } from "./config.js";
import type { PresentationSessionService } from "./presentation-session-service.js";
import { professionalFeatureUnavailable } from "./workspace-rollout.js";

const IdParamsSchema = z.object({ id: z.string().uuid() });
const CompanionPassParamsSchema = z.object({
  id: z.string().uuid(),
  credentialId: z.string().uuid(),
});
const CompanionFeatureQuerySchema = z
  .object({
    includeQuickChecks: z.literal("true").optional(),
    includePublishedQuestions: z.literal("true").optional(),
  })
  .strict();
const PublishedQuestionQuerySchema = z
  .object({ search: z.string().trim().max(100).optional() })
  .strict();

function restCompanionSnapshot(
  value: PresentationCompanionSnapshot,
  includeQuickChecks: boolean,
  includePublishedQuestions: boolean,
) {
  const snapshot = PresentationCompanionSnapshotSchema.parse(value);
  const legacy = { ...snapshot };
  if (!includeQuickChecks) delete legacy.canInsertQuickCheck;
  if (!includePublishedQuestions) delete legacy.canInsertPublishedQuestion;
  return legacy;
}

interface PresentationCompanionRouteDependencies {
  auth: Pick<AuthService, "requireCreator">;
  config: AppConfig;
  repository: Repository;
  service: Pick<
    PresentationSessionService,
    | "createCompanionPass"
    | "revokeCompanionPass"
    | "getCompanionSnapshot"
    | "companionCommand"
    | "getCompanionRecoveryPacks"
    | "getCompanionPublishedQuestions"
  >;
  requirePresentationWorkspace(
    workspaceId: string,
    reply: FastifyReply,
    requestId: string,
  ): boolean | FastifyReply | Promise<boolean | FastifyReply>;
  enforceSharedAdmission(
    request: FastifyRequest,
    reply: FastifyReply,
    key: string,
    maximum: number,
  ): Promise<boolean>;
  requireEditor(
    creator: CreatorContext,
    reply: FastifyReply,
    requestId: string,
  ): boolean | FastifyReply | Promise<boolean | FastifyReply>;
  noStore(reply: FastifyReply): FastifyReply;
  bearerToken(request: FastifyRequest): string | null;
  apiError(
    reply: FastifyReply,
    status: number,
    code: string,
    message: string,
    requestId: string,
    details?: Record<string, unknown>,
  ): FastifyReply;
  sendServiceError(error: unknown, reply: FastifyReply, requestId: string): FastifyReply;
}

function presentationCompanionRateLimitKey(
  request: FastifyRequest,
  operation: "snapshot" | "command" | "catalog" | "published-questions",
  bearerToken: PresentationCompanionRouteDependencies["bearerToken"],
) {
  const body = request.body as { companionToken?: unknown } | null;
  const token =
    operation !== "command"
      ? (bearerToken(request) ?? "invalid")
      : typeof body?.companionToken === "string"
        ? body.companionToken
        : "invalid";
  const params = request.params as { id?: unknown } | null;
  const sessionId = typeof params?.id === "string" ? params.id : "invalid";
  return `presentation-companion:${operation}:${sessionId}:${createHash("sha256").update(token).digest("hex")}`;
}

export function registerPresentationCompanionRoutes(
  app: FastifyInstance,
  dependencies: PresentationCompanionRouteDependencies,
) {
  const {
    auth,
    config,
    repository,
    service,
    enforceSharedAdmission,
    requireEditor,
    noStore,
    bearerToken,
    apiError,
    sendServiceError,
  } = dependencies;
  const rateLimitKey = (
    request: FastifyRequest,
    operation: "snapshot" | "command" | "catalog" | "published-questions",
  ) => presentationCompanionRateLimitKey(request, operation, bearerToken);

  app.post("/v1/presentation-sessions/:id/companion-pass", async (request, reply) => {
    noStore(reply);
    const creator = await auth.requireCreator(request, reply);
    if (!creator) return;
    if (requireEditor(creator, reply, request.id) !== true) return;
    if (
      !(await roomFeatureEnabled(
        repository,
        config,
        "presentation",
        IdParamsSchema.parse(request.params).id,
        creator.workspaceId,
        "presentationCompanion",
        true,
      ))
    ) {
      return professionalFeatureUnavailable(reply, request.id, "Presentation companion not found");
    }
    const { id } = IdParamsSchema.parse(request.params);
    try {
      const pass = await service.createCompanionPass({
        workspaceId: creator.workspaceId,
        userId: creator.userId,
        sessionId: id,
        requestId: request.id,
      });
      return reply.code(201).send(PresentationCompanionPassResponseSchema.parse(pass));
    } catch (error) {
      return sendServiceError(error, reply, request.id);
    }
  });

  app.delete(
    "/v1/presentation-sessions/:id/companion-passes/:credentialId",
    async (request, reply) => {
      noStore(reply);
      const creator = await auth.requireCreator(request, reply);
      if (!creator) return;
      if (requireEditor(creator, reply, request.id) !== true) return;
      const { id, credentialId } = CompanionPassParamsSchema.parse(request.params);
      try {
        await service.revokeCompanionPass({
          workspaceId: creator.workspaceId,
          userId: creator.userId,
          sessionId: id,
          credentialId,
          requestId: request.id,
        });
        return reply.code(204).send();
      } catch (error) {
        return sendServiceError(error, reply, request.id);
      }
    },
  );

  app.get(
    "/v1/presentation-sessions/:id/companion",
    {
      onRequest: async (_request, reply) => {
        noStore(reply);
      },
      preHandler: async (request, reply) => {
        if (!(await enforceSharedAdmission(request, reply, rateLimitKey(request, "snapshot"), 120)))
          return reply;
      },
      config: {
        rateLimit: {
          max: 120,
          timeWindow: "1 minute",
          keyGenerator: (request: FastifyRequest) => rateLimitKey(request, "snapshot"),
        },
      },
    },
    async (request, reply) => {
      const { id } = IdParamsSchema.parse(request.params);
      const token = bearerToken(request);
      if (!token)
        return apiError(reply, 401, "UNAUTHORIZED", "Companion credential required", request.id);
      const { includeQuickChecks, includePublishedQuestions } = CompanionFeatureQuerySchema.parse(
        request.query,
      );
      try {
        return {
          snapshot: restCompanionSnapshot(
            await service.getCompanionSnapshot(id, token),
            includeQuickChecks === "true",
            includePublishedQuestions === "true",
          ),
        };
      } catch (error) {
        return sendServiceError(error, reply, request.id);
      }
    },
  );

  app.get(
    "/v1/presentation-sessions/:id/companion-recovery-packs",
    {
      onRequest: async (_request, reply) => {
        noStore(reply);
      },
      preHandler: async (request, reply) => {
        if (!(await enforceSharedAdmission(request, reply, rateLimitKey(request, "catalog"), 30)))
          return reply;
      },
      config: {
        rateLimit: {
          max: 30,
          timeWindow: "1 minute",
          keyGenerator: (request: FastifyRequest) => rateLimitKey(request, "catalog"),
        },
      },
    },
    async (request, reply) => {
      const { id } = IdParamsSchema.parse(request.params);
      const token = bearerToken(request);
      if (!token)
        return apiError(reply, 401, "UNAUTHORIZED", "Companion credential required", request.id);
      try {
        return PresentationCompanionRecoveryPackCatalogSchema.parse(
          await service.getCompanionRecoveryPacks(id, token),
        );
      } catch (error) {
        return sendServiceError(error, reply, request.id);
      }
    },
  );

  app.post(
    "/v1/presentation-sessions/:id/companion-command",
    {
      onRequest: async (_request, reply) => {
        noStore(reply);
      },
      config: {
        rateLimit: {
          max: 30,
          timeWindow: "1 minute",
          hook: "preHandler",
          keyGenerator: (request: FastifyRequest) => rateLimitKey(request, "command"),
        },
      },
    },
    async (request, reply) => {
      const { id } = IdParamsSchema.parse(request.params);
      const input = PresentationCompanionCommandSchema.parse(request.body);
      const { includeQuickChecks, includePublishedQuestions } = CompanionFeatureQuerySchema.parse(
        request.query,
      );
      if (input.sessionId !== id)
        return apiError(
          reply,
          422,
          "VALIDATION_ERROR",
          "Command session must match its route",
          request.id,
        );
      if (!(await enforceSharedAdmission(request, reply, rateLimitKey(request, "command"), 30)))
        return;
      try {
        return {
          snapshot: restCompanionSnapshot(
            await service.companionCommand(input),
            includeQuickChecks === "true",
            includePublishedQuestions === "true",
          ),
        };
      } catch (error) {
        return sendServiceError(error, reply, request.id);
      }
    },
  );

  app.get(
    "/v1/presentation-sessions/:id/companion-published-questions",
    {
      onRequest: async (_request, reply) => {
        noStore(reply);
      },
      preHandler: async (request, reply) => {
        if (
          !(await enforceSharedAdmission(
            request,
            reply,
            rateLimitKey(request, "published-questions"),
            30,
          ))
        )
          return reply;
      },
      config: {
        rateLimit: {
          max: 30,
          timeWindow: "1 minute",
          keyGenerator: (request: FastifyRequest) => rateLimitKey(request, "published-questions"),
        },
      },
    },
    async (request, reply) => {
      const { id } = IdParamsSchema.parse(request.params);
      const token = bearerToken(request);
      if (!token)
        return apiError(reply, 401, "UNAUTHORIZED", "Companion credential required", request.id);
      const { search } = PublishedQuestionQuerySchema.parse(request.query);
      try {
        return PresentationCompanionPublishedQuestionCatalogSchema.parse(
          await service.getCompanionPublishedQuestions(id, token, search),
        );
      } catch (error) {
        return sendServiceError(error, reply, request.id);
      }
    },
  );
}
