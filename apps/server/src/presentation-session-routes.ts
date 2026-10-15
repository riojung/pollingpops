import { workspaceFeatureEnabled } from "./feature-policy.js";
import { createHash } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  AdvancePresentationSessionSchema,
  CreatePresentationSessionSchema,
  JoinPresentationSessionSchema,
  PresentationCommandSchema,
  PresentationHostSnapshotSchema,
  PresentationRestV1CreateSessionResponseSchema,
  PresentationRestV1HostSnapshotResponseSchema,
  PresentationRestV1HostSnapshotSchema,
  PresentationRestV1JoinSessionResponseSchema,
  PresentationRestV1ParticipantSnapshotResponseSchema,
  PresentationRestV1ParticipantSnapshotSchema,
  PresentationRestV1ResponseAckSchema,
  PresentationRestV1SessionListItemSchema,
  PresentationRestV1SessionListResponseSchema,
  PresentationRestResponseSubmitSchema,
} from "@openround/contracts";
import type {
  CreatorContext,
  PresentationRepository,
  PresentationSessionRepository,
  Repository,
} from "@openround/db";
import type { AuthService } from "./auth.js";
import { createRecoveryPackRepository } from "@openround/db";
import type { AppConfig } from "./config.js";
import type { MetricsService } from "./metrics.js";
import { registerPresentationCompanionRoutes } from "./presentation-companion-routes.js";
import { presentationRecoveryPackLiveInsertionEnabled } from "./presentation-live-recovery-packs.js";
import { presentationLiveInsertionEnabled } from "./presentation-live-insertion.js";
import {
  PresentationSessionService,
  PresentationSessionServiceError,
} from "./presentation-session-service.js";
import type { StorageService } from "./storage.js";
import { professionalFeatureUnavailable } from "./workspace-rollout.js";

const IdParamsSchema = z.object({ id: z.string().uuid() });
const SessionMediaParamsSchema = z.object({
  id: z.string().uuid(),
  mediaId: z.string().uuid(),
});
const ControlPassParamsSchema = z.object({
  id: z.string().uuid(),
  credentialId: z.string().uuid(),
});
const PresentationReportQuerySchema = z
  .object({
    includeSessionContext: z.literal("true").optional(),
    includeQuickChecks: z.literal("true").optional(),
  })
  .strict();

function apiError(
  reply: FastifyReply,
  status: number,
  code: string,
  message: string,
  requestId: string,
  details?: Record<string, unknown>,
) {
  return reply
    .code(status)
    .send({ error: { code, message, requestId, ...(details ? { details } : {}) } });
}

function sendServiceError(
  error: unknown,
  reply: FastifyReply,
  requestId: string,
): ReturnType<typeof apiError> | never {
  if (error instanceof PresentationSessionServiceError) {
    return apiError(reply, error.status, error.code, error.message, requestId, error.details);
  }
  throw error;
}

function requireEditor(creator: CreatorContext, reply: FastifyReply, requestId: string) {
  return creator.role === "owner" || creator.role === "editor"
    ? true
    : apiError(
        reply,
        403,
        "UNAUTHORIZED",
        "Your workspace role does not allow this action",
        requestId,
      );
}

function bearerToken(request: FastifyRequest) {
  const authorization = request.headers.authorization;
  return authorization?.startsWith("Bearer ") ? authorization.slice(7) : null;
}

function noStore(reply: FastifyReply) {
  return reply.header("cache-control", "private, no-store").header("pragma", "no-cache");
}

function presentationJoinRateLimitKey(request: FastifyRequest) {
  const body = request.body as { code?: unknown; nickname?: unknown } | null;
  const code = typeof body?.code === "string" ? body.code : "invalid";
  const nickname =
    typeof body?.nickname === "string" ? body.nickname.trim().toLocaleLowerCase() : "";
  const participantKey = createHash("sha256").update(nickname).digest("hex").slice(0, 16);
  return `presentation-join:${code}:${participantKey}`;
}

function presentationCredentialRateLimitKey(
  request: FastifyRequest,
  operation: "snapshot" | "media" | "response",
  token: string,
) {
  const params = request.params as { id?: unknown } | null;
  const sessionId = typeof params?.id === "string" ? params.id : "invalid";
  const credentialKey = createHash("sha256").update(token).digest("hex").slice(0, 24);
  return `presentation-participant:${operation}:${sessionId}:${credentialKey}`;
}

function presentationSnapshotRateLimitKey(request: FastifyRequest) {
  return presentationCredentialRateLimitKey(request, "snapshot", bearerToken(request) ?? "invalid");
}

function presentationMediaRateLimitKey(request: FastifyRequest) {
  return presentationCredentialRateLimitKey(request, "media", bearerToken(request) ?? "invalid");
}

function presentationResponseRateLimitKey(request: FastifyRequest) {
  const body = request.body as { participantToken?: unknown } | null;
  const token = typeof body?.participantToken === "string" ? body.participantToken : "invalid";
  return presentationCredentialRateLimitKey(request, "response", token);
}

function restCompatibleCurrentBlock(currentBlock: unknown) {
  const block = currentBlock as
    { kind?: unknown; question?: Record<string, unknown> } | null | undefined;
  const rating =
    block?.kind === "question" &&
    block.question?.rating &&
    typeof block.question.rating === "object"
      ? (block.question.rating as Record<string, unknown>)
      : null;
  return rating
    ? {
        ...block,
        question: { ...(block?.question ?? {}), ...rating },
      }
    : currentBlock;
}

function restCompatibleSnapshot<
  T extends {
    sessionId: string;
    seq: number;
    settings: { trustMode: "learning" | "verified" };
    projection: "host" | "participant";
    participants?: unknown;
    currentBlock?: unknown;
    createdAt?: string | Date;
    updatedAt?: string | Date;
  },
>(snapshot: T) {
  const compatible = {
    ...snapshot,
    // Keep the original REST aliases while Socket.IO and new clients use the canonical contract.
    id: snapshot.sessionId,
    eventSeq: snapshot.seq,
    trustMode: snapshot.settings.trustMode,
    ...(snapshot.participants ? { leaderboard: snapshot.participants } : {}),
    currentBlock: restCompatibleCurrentBlock(snapshot.currentBlock),
    ...(snapshot.createdAt
      ? {
          createdAt:
            snapshot.createdAt instanceof Date
              ? snapshot.createdAt.toISOString()
              : snapshot.createdAt,
        }
      : {}),
    ...(snapshot.updatedAt
      ? {
          updatedAt:
            snapshot.updatedAt instanceof Date
              ? snapshot.updatedAt.toISOString()
              : snapshot.updatedAt,
        }
      : {}),
  };
  return snapshot.projection === "host"
    ? PresentationRestV1HostSnapshotSchema.parse(compatible)
    : PresentationRestV1ParticipantSnapshotSchema.parse(compatible);
}

function restCompatibleListItem(snapshot: unknown) {
  const candidate = snapshot as { currentBlock?: unknown };
  return PresentationRestV1SessionListItemSchema.parse({
    ...candidate,
    currentBlock: restCompatibleCurrentBlock(candidate.currentBlock),
  });
}

export async function registerPresentationSessionRoutes(
  app: FastifyInstance,
  dependencies: {
    repository: Repository;
    presentations: PresentationRepository;
    presentationSessions: PresentationSessionRepository;
    auth: AuthService;
    config: AppConfig;
    storage: StorageService;
    workspaceEnabled: (workspaceId: string) => boolean | Promise<boolean>;
    metrics?: Pick<MetricsService, "recordPresentationAdmission" | "observePresentationResponse">;
    consumeAdmission?: (key: string, maximum: number, windowMs: number) => Promise<boolean>;
    service?: PresentationSessionService;
  },
) {
  const { auth, workspaceEnabled } = dependencies;
  const joinIngressTimes = new WeakMap<FastifyRequest, number>();
  const responseIngressTimes = new WeakMap<
    FastifyRequest,
    { receivedAt: Date; startedAt: number }
  >();
  const service =
    dependencies.service ??
    new PresentationSessionService({
      workspaceEnabled: (workspaceId, planOverride) =>
        workspaceFeatureEnabled(
          dependencies.repository,
          dependencies.config,
          workspaceId,
          "presentationRealtime",
          planOverride,
        ),
      liveFlexModeEnabled: (workspaceId, planOverride) =>
        workspaceFeatureEnabled(
          dependencies.repository,
          dependencies.config,
          workspaceId,
          "liveFlexMode",
          planOverride,
        ),
      repository: dependencies.repository,
      presentations: dependencies.presentations,
      sessions: dependencies.presentationSessions,
      packs: createRecoveryPackRepository(dependencies.repository),
      config: dependencies.config,
      storage: dependencies.storage,
      recoveryPackCardsEnabled: (workspaceId, planOverride) =>
        workspaceFeatureEnabled(
          dependencies.repository,
          dependencies.config,
          workspaceId,
          "recoveryPackLiveCards",
          planOverride,
        ),
      recoveryPackLiveInsertionEnabled: (workspaceId, sessionId) =>
        presentationRecoveryPackLiveInsertionEnabled(
          dependencies.config,
          workspaceId,
          dependencies.repository,
          sessionId,
        ),
      quickCheckLiveInsertionEnabled: (workspaceId, sessionId) =>
        presentationLiveInsertionEnabled(
          dependencies.config,
          workspaceId,
          dependencies.repository,
          sessionId,
        ),
      publishedQuestionLiveInsertionEnabled: (workspaceId, sessionId) =>
        presentationLiveInsertionEnabled(
          dependencies.config,
          workspaceId,
          dependencies.repository,
          sessionId,
        ),
    });
  const enforceSharedAdmission = async (
    request: FastifyRequest,
    reply: FastifyReply,
    key: string,
    maximum: number,
    onExceeded?: () => void,
  ) => {
    if (!dependencies.consumeAdmission) return true;
    if (await dependencies.consumeAdmission(key, maximum, 60_000)) return true;
    onExceeded?.();
    apiError(reply, 429, "RATE_LIMITED", "Too many requests", request.id);
    return false;
  };
  const requirePresentationWorkspace = async (
    workspaceId: string,
    reply: FastifyReply,
    requestId: string,
  ) =>
    (await workspaceEnabled(workspaceId))
      ? true
      : professionalFeatureUnavailable(reply, requestId, "Presentation session not found");

  app.get("/v1/presentation-sessions", async (request, reply) => {
    noStore(reply);
    const creator = await auth.requireCreator(request, reply);
    if (!creator) return;
    const snapshots = await service.listHostSnapshots(creator.workspaceId);
    return PresentationRestV1SessionListResponseSchema.parse({
      sessions: snapshots.map(restCompatibleListItem),
    });
  });

  app.post("/v1/presentation-sessions", async (request, reply) => {
    const creator = await auth.requireCreator(request, reply);
    if (!creator) return;
    if (requireEditor(creator, reply, request.id) !== true) return;
    const input = CreatePresentationSessionSchema.parse(request.body);
    try {
      const created = await service.createSession({
        workspaceId: creator.workspaceId,
        userId: creator.userId,
        presentationId: input.presentationId,
        timeMode: input.timeMode,
        requestId: request.id,
        useEventCredit: input.useEventCredit,
        joinPassword: input.joinPassword,
        idempotencyKey:
          typeof request.headers["x-idempotency-key"] === "string"
            ? request.headers["x-idempotency-key"]
            : undefined,
      });
      const response = PresentationRestV1CreateSessionResponseSchema.parse({
        ...created,
        snapshot: restCompatibleSnapshot(created.snapshot),
      });
      return reply
        .header("cache-control", "private, no-store")
        .header("pragma", "no-cache")
        .code(201)
        .send(response);
    } catch (error) {
      return sendServiceError(error, reply, request.id);
    }
  });

  app.get("/v1/presentation-sessions/:id", async (request, reply) => {
    noStore(reply);
    const creator = await auth.requireCreator(request, reply);
    if (!creator) return;
    const { id } = IdParamsSchema.parse(request.params);
    try {
      return PresentationRestV1HostSnapshotResponseSchema.parse({
        snapshot: restCompatibleSnapshot(await service.getHostSnapshot(creator.workspaceId, id)),
      });
    } catch (error) {
      return sendServiceError(error, reply, request.id);
    }
  });

  app.delete("/v1/presentation-sessions/:id", async (request, reply) => {
    const creator = await auth.requireCreator(request, reply);
    if (!creator) return;
    if ((await requirePresentationWorkspace(creator.workspaceId, reply, request.id)) !== true)
      return;
    if (creator.role !== "owner") {
      return apiError(
        reply,
        403,
        "UNAUTHORIZED",
        "Your workspace role does not allow this action",
        request.id,
      );
    }
    const { id } = IdParamsSchema.parse(request.params);
    try {
      await service.deleteSession({
        workspaceId: creator.workspaceId,
        userId: creator.userId,
        sessionId: id,
        requestId: request.id,
      });
      return reply.code(204).send();
    } catch (error) {
      return sendServiceError(error, reply, request.id);
    }
  });

  app.post("/v1/presentation-sessions/:id/advance", async (request, reply) => {
    const creator = await auth.requireCreator(request, reply);
    if (!creator) return;
    if (requireEditor(creator, reply, request.id) !== true) return;
    const { id } = IdParamsSchema.parse(request.params);
    const input = AdvancePresentationSessionSchema.parse(request.body);
    try {
      const snapshot = await service.advance({
        workspaceId: creator.workspaceId,
        userId: creator.userId,
        sessionId: id,
        expectedRevision: input.expectedRevision,
        requestId: request.id,
      });
      return PresentationRestV1HostSnapshotResponseSchema.parse({
        snapshot: restCompatibleSnapshot(snapshot),
      });
    } catch (error) {
      return sendServiceError(error, reply, request.id);
    }
  });

  app.post(
    "/v1/presentation-sessions/:id/command",
    {
      config: {
        rateLimit: {
          max: 30,
          timeWindow: "1 minute",
          keyGenerator: (request: FastifyRequest) => {
            const body = request.body as { controlToken?: unknown } | null;
            const token = typeof body?.controlToken === "string" ? body.controlToken : "invalid";
            return `presentation-command:${createHash("sha256").update(token).digest("hex")}`;
          },
        },
      },
    },
    async (request, reply) => {
      noStore(reply);
      const { id } = IdParamsSchema.parse(request.params);
      const input = PresentationCommandSchema.parse(request.body);
      if (input.sessionId !== id) {
        return apiError(
          reply,
          422,
          "VALIDATION_ERROR",
          "Command session must match its route",
          request.id,
        );
      }
      if (
        !(await enforceSharedAdmission(
          request,
          reply,
          `presentation:command:${id}:${createHash("sha256").update(input.controlToken).digest("hex")}`,
          30,
        ))
      )
        return;
      try {
        return { snapshot: PresentationHostSnapshotSchema.parse(await service.command(input)) };
      } catch (error) {
        return sendServiceError(error, reply, request.id);
      }
    },
  );

  registerPresentationCompanionRoutes(app, {
    repository: dependencies.repository,
    auth,
    config: dependencies.config,
    service,
    requirePresentationWorkspace,
    enforceSharedAdmission,
    requireEditor,
    noStore,
    bearerToken,
    apiError,
    sendServiceError,
  });

  app.post("/v1/presentation-sessions/:id/control-pass", async (request, reply) => {
    const creator = await auth.requireCreator(request, reply);
    if (!creator) return;
    if (requireEditor(creator, reply, request.id) !== true) return;
    const { id } = IdParamsSchema.parse(request.params);
    try {
      const controlPass = await service.createControlPass({
        workspaceId: creator.workspaceId,
        userId: creator.userId,
        sessionId: id,
        requestId: request.id,
      });
      return reply
        .header("cache-control", "private, no-store")
        .header("pragma", "no-cache")
        .code(201)
        .send(controlPass);
    } catch (error) {
      return sendServiceError(error, reply, request.id);
    }
  });

  app.delete(
    "/v1/presentation-sessions/:id/control-passes/:credentialId",
    async (request, reply) => {
      const creator = await auth.requireCreator(request, reply);
      if (!creator) return;
      if (requireEditor(creator, reply, request.id) !== true) return;
      const { id, credentialId } = ControlPassParamsSchema.parse(request.params);
      try {
        await service.revokeControlPass({
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

  app.post(
    "/v1/presentation-sessions/join",
    {
      onRequest: async (request) => {
        joinIngressTimes.set(request, performance.now());
      },
      preHandler: async (request, reply) => {
        const parsed = JoinPresentationSessionSchema.safeParse(request.body);
        if (!parsed.success || !dependencies.consumeAdmission) return;
        const startedAt = joinIngressTimes.get(request) ?? performance.now();
        const recordExceeded = () =>
          dependencies.metrics?.recordPresentationAdmission(
            "rest",
            "rate_limited",
            (performance.now() - startedAt) / 1_000,
          );
        const aliasKey = presentationJoinRateLimitKey(request).replace(
          "presentation-join:",
          "presentation:join:alias:",
        );
        if (!(await enforceSharedAdmission(request, reply, aliasKey, 10, recordExceeded))) return;
        if (
          !(await enforceSharedAdmission(
            request,
            reply,
            `presentation:join:room:${parsed.data.code}`,
            600,
            recordExceeded,
          ))
        )
          return reply;
      },
      config: {
        // Classrooms commonly share one public IP. Bound retries to the intended room/alias rather
        // than treating a whole campus NAT as one participant.
        rateLimit: {
          max: 10,
          timeWindow: "1 minute",
          // The default onRequest hook runs before Fastify parses JSON, which would collapse every
          // classroom participant into the same empty-alias bucket. Parse first so the limiter is
          // participant/session-aware without falling back to a campus NAT address.
          hook: "preHandler",
          keyGenerator: presentationJoinRateLimitKey,
          onExceeded: (request) =>
            dependencies.metrics?.recordPresentationAdmission(
              "rest",
              "rate_limited",
              (performance.now() - (joinIngressTimes.get(request) ?? performance.now())) / 1_000,
            ),
        },
      },
    },
    async (request, reply) => {
      const startedAt = joinIngressTimes.get(request) ?? performance.now();
      const recordAdmission = (
        outcome: "accepted" | "duplicate" | "rate_limited" | "full" | "invalid" | "error",
      ) =>
        dependencies.metrics?.recordPresentationAdmission(
          "rest",
          outcome,
          (performance.now() - startedAt) / 1_000,
        );
      try {
        const input = JoinPresentationSessionSchema.parse(request.body);
        const joined = await service.join(input.code, input.nickname, input.password);
        recordAdmission("accepted");
        const response = PresentationRestV1JoinSessionResponseSchema.parse({
          participantToken: joined.participantToken,
          snapshot: restCompatibleSnapshot(joined.snapshot),
        });
        return reply
          .header("cache-control", "private, no-store")
          .header("pragma", "no-cache")
          .code(201)
          .send(response);
      } catch (error) {
        const code = (error as { code?: string }).code;
        recordAdmission(
          error instanceof z.ZodError ? "invalid" : code === "PARTICIPANT_LIMIT" ? "full" : "error",
        );
        return sendServiceError(error, reply, request.id);
      }
    },
  );

  app.get(
    "/v1/presentation-sessions/:id/participant",
    {
      preHandler: async (request, reply) => {
        if (
          !(await enforceSharedAdmission(
            request,
            reply,
            presentationSnapshotRateLimitKey(request),
            120,
          ))
        )
          return reply;
      },
      config: {
        // REST recovery polls every 1.5 seconds. Keying this route by credential keeps a campus
        // NAT from pooling hundreds of active learners into the global IP budget.
        rateLimit: {
          max: 120,
          timeWindow: "1 minute",
          keyGenerator: presentationSnapshotRateLimitKey,
        },
      },
    },
    async (request, reply) => {
      noStore(reply);
      const { id } = IdParamsSchema.parse(request.params);
      const token = bearerToken(request);
      if (!token) {
        return apiError(reply, 401, "UNAUTHORIZED", "Participant credential required", request.id);
      }
      try {
        const result = await service.getParticipantSnapshot(id, token);
        return PresentationRestV1ParticipantSnapshotResponseSchema.parse({
          snapshot: restCompatibleSnapshot(result.snapshot),
        });
      } catch (error) {
        return sendServiceError(error, reply, request.id);
      }
    },
  );

  app.get("/v1/presentation-sessions/:id/host-media/:mediaId", async (request, reply) => {
    noStore(reply);
    const creator = await auth.requireCreator(request, reply);
    if (!creator) return;
    const { id, mediaId } = SessionMediaParamsSchema.parse(request.params);
    try {
      const result = await service.getHostMedia(creator.workspaceId, id, mediaId);
      return { media: result.media, downloadUrl: result.downloadUrl };
    } catch (error) {
      return sendServiceError(error, reply, request.id);
    }
  });

  app.get(
    "/v1/presentation-sessions/:id/media/:mediaId",
    {
      preHandler: async (request, reply) => {
        if (
          !(await enforceSharedAdmission(
            request,
            reply,
            presentationMediaRateLimitKey(request),
            120,
          ))
        )
          return reply;
      },
      config: {
        rateLimit: {
          max: 120,
          timeWindow: "1 minute",
          keyGenerator: presentationMediaRateLimitKey,
        },
      },
    },
    async (request, reply) => {
      noStore(reply);
      const { id, mediaId } = SessionMediaParamsSchema.parse(request.params);
      const token = bearerToken(request);
      if (!token) {
        return apiError(reply, 401, "UNAUTHORIZED", "Participant credential required", request.id);
      }
      try {
        const result = await service.getParticipantMedia(id, mediaId, token);
        return { media: result.media, downloadUrl: result.downloadUrl };
      } catch (error) {
        return sendServiceError(error, reply, request.id);
      }
    },
  );

  app.post(
    "/v1/presentation-sessions/:id/responses",
    {
      onRequest: async (request) => {
        responseIngressTimes.set(request, { receivedAt: new Date(), startedAt: performance.now() });
      },
      preHandler: async (request, reply) => {
        const ingress = responseIngressTimes.get(request);
        if (
          !(await enforceSharedAdmission(
            request,
            reply,
            presentationResponseRateLimitKey(request),
            30,
            () =>
              dependencies.metrics?.observePresentationResponse(
                "rest",
                "rate_limited",
                (performance.now() - (ingress?.startedAt ?? performance.now())) / 1_000,
              ),
          ))
        )
          return reply;
      },
      config: {
        rateLimit: {
          max: 30,
          timeWindow: "1 minute",
          hook: "preHandler",
          keyGenerator: presentationResponseRateLimitKey,
          onExceeded: (request) => {
            const ingress = responseIngressTimes.get(request);
            dependencies.metrics?.observePresentationResponse(
              "rest",
              "rate_limited",
              (performance.now() - (ingress?.startedAt ?? performance.now())) / 1_000,
            );
          },
        },
      },
    },
    async (request, reply) => {
      const ingress = responseIngressTimes.get(request) ?? {
        receivedAt: new Date(),
        startedAt: performance.now(),
      };
      const recordResponse = (
        outcome: "accepted" | "duplicate" | "rejected" | "rate_limited" | "error",
      ) =>
        dependencies.metrics?.observePresentationResponse(
          "rest",
          outcome,
          (performance.now() - ingress.startedAt) / 1_000,
        );
      try {
        const { id } = IdParamsSchema.parse(request.params);
        const input = PresentationRestResponseSubmitSchema.parse(request.body);
        const acceptance =
          "blockId" in input
            ? await service.submitResponse({
                sessionId: id,
                participantToken: input.participantToken,
                blockId: input.blockId,
                expectedRevision: input.expectedRevision,
                idempotencyKey: input.idempotencyKey,
                response: input.response,
                receivedAt: ingress.receivedAt,
              })
            : await service.submitLegacyResponse({
                sessionId: id,
                participantToken: input.participantToken,
                response: input.response,
                receivedAt: ingress.receivedAt,
              });
        recordResponse(acceptance.duplicate ? "duplicate" : "accepted");
        const restAcknowledgement = PresentationRestV1ResponseAckSchema.parse({
          ...acceptance,
          snapshot: restCompatibleSnapshot(acceptance.snapshot),
          revision:
            "expectedRevision" in input ? input.expectedRevision : acceptance.snapshot.revision,
          submittedAt: acceptance.acceptedAt,
        });
        return reply
          .header("cache-control", "private, no-store")
          .header("pragma", "no-cache")
          .code(202)
          .send(restAcknowledgement);
      } catch (error) {
        const code = (error as { code?: string }).code;
        recordResponse(
          error instanceof z.ZodError
            ? "rejected"
            : code && code !== "INTERNAL_ERROR"
              ? "rejected"
              : "error",
        );
        return sendServiceError(error, reply, request.id);
      }
    },
  );

  app.get("/v1/presentation-sessions/:id/report", async (request, reply) => {
    noStore(reply);
    const creator = await auth.requireCreator(request, reply);
    if (!creator) return;
    const { id } = IdParamsSchema.parse(request.params);
    const { includeSessionContext, includeQuickChecks } = PresentationReportQuerySchema.parse(
      request.query,
    );
    try {
      const result = await service.getReport(
        creator.workspaceId,
        id,
        includeSessionContext === "true",
        includeQuickChecks === "true",
      );
      return reply
        .code(result.reportStatus === "pending" && !result.report ? 202 : 200)
        .send(result);
    } catch (error) {
      return sendServiceError(error, reply, request.id);
    }
  });
}
