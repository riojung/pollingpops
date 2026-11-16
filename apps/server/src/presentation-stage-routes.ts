import { createHash } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  PresentationStagePassResponseSchema,
  PresentationStageSnapshotSchema,
} from "@openround/contracts";
import type { CreatorContext, Repository } from "@openround/db";
import type { AuthService } from "./auth.js";
import type { AppConfig } from "./config.js";
import { roomFeatureEnabled } from "./feature-policy.js";
import type { PresentationSessionService } from "./presentation-session-service.js";
import { professionalFeatureUnavailable } from "./workspace-rollout.js";

const IdParamsSchema = z.object({ id: z.string().uuid() });
const PassParamsSchema = IdParamsSchema.extend({ credentialId: z.string().uuid() });
const MediaParamsSchema = IdParamsSchema.extend({ mediaId: z.string().uuid() });

interface StageRouteDependencies {
  auth: Pick<AuthService, "requireCreator">;
  repository: Repository;
  config: AppConfig;
  service: Pick<
    PresentationSessionService,
    "createStagePass" | "revokeStagePass" | "getStageSnapshot" | "getStageMedia"
  >;
  requireEditor(
    creator: CreatorContext,
    reply: FastifyReply,
    requestId: string,
  ): boolean | FastifyReply;
  noStore(reply: FastifyReply): FastifyReply;
  bearerToken(request: FastifyRequest): string | null;
  enforceSharedAdmission(
    request: FastifyRequest,
    reply: FastifyReply,
    key: string,
    maximum: number,
  ): Promise<boolean>;
  apiError(
    reply: FastifyReply,
    status: number,
    code: string,
    message: string,
    requestId: string,
  ): FastifyReply;
  sendServiceError(error: unknown, reply: FastifyReply, requestId: string): FastifyReply;
}

export function registerPresentationStageRoutes(
  app: FastifyInstance,
  dependencies: StageRouteDependencies,
) {
  const { auth, service, requireEditor, noStore, bearerToken, apiError, sendServiceError } =
    dependencies;
  app.post("/v1/presentation-sessions/:id/stage-pass", async (request, reply) => {
    noStore(reply);
    const creator = await auth.requireCreator(request, reply);
    if (!creator || requireEditor(creator, reply, request.id) !== true) return;
    const { id } = IdParamsSchema.parse(request.params);
    if (
      !(await roomFeatureEnabled(
        dependencies.repository,
        dependencies.config,
        "presentation",
        id,
        creator.workspaceId,
        "presentationRealtime",
        true,
      ))
    ) {
      return professionalFeatureUnavailable(reply, request.id, "Presentation stage not found");
    }
    try {
      return reply.code(201).send(
        PresentationStagePassResponseSchema.parse(
          await service.createStagePass({
            workspaceId: creator.workspaceId,
            userId: creator.userId,
            sessionId: id,
            requestId: request.id,
          }),
        ),
      );
    } catch (error) {
      return sendServiceError(error, reply, request.id);
    }
  });
  app.delete("/v1/presentation-sessions/:id/stage-passes/:credentialId", async (request, reply) => {
    noStore(reply);
    const creator = await auth.requireCreator(request, reply);
    if (!creator || requireEditor(creator, reply, request.id) !== true) return;
    const { id, credentialId } = PassParamsSchema.parse(request.params);
    try {
      await service.revokeStagePass({
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
  });

  const rateLimitKey = (request: FastifyRequest, operation: "snapshot" | "media") => {
    const { id } = request.params as { id: string };
    const hash = createHash("sha256")
      .update(bearerToken(request) ?? "invalid")
      .digest("hex");
    return `presentation-stage:${operation}:${id}:${hash}`;
  };
  for (const operation of ["snapshot", "media"] as const) {
    app.get(
      operation === "snapshot"
        ? "/v1/presentation-sessions/:id/stage"
        : "/v1/presentation-sessions/:id/stage-media/:mediaId",
      {
        onRequest: async (_request, reply) => {
          noStore(reply);
        },
        preHandler: async (request, reply) => {
          if (
            !(await dependencies.enforceSharedAdmission(
              request,
              reply,
              rateLimitKey(request, operation),
              120,
            ))
          )
            return reply;
        },
        config: {
          rateLimit: {
            max: 120,
            timeWindow: "1 minute",
            keyGenerator: (request: FastifyRequest) => rateLimitKey(request, operation),
          },
        },
      },
      async (request, reply) => {
        const { id } = IdParamsSchema.parse(request.params);
        const token = bearerToken(request);
        if (!token)
          return apiError(reply, 401, "UNAUTHORIZED", "Stage credential required", request.id);
        try {
          if (operation === "snapshot") {
            return {
              snapshot: PresentationStageSnapshotSchema.parse(
                await service.getStageSnapshot(id, token),
              ),
            };
          }
          const { mediaId } = MediaParamsSchema.parse(request.params);
          const result = await service.getStageMedia(id, mediaId, token);
          return { media: result.media, downloadUrl: result.downloadUrl };
        } catch (error) {
          return sendServiceError(error, reply, request.id);
        }
      },
    );
  }
}
