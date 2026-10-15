import { workspaceFeatureEnabled } from "./feature-policy.js";
import { createHash, randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  ApplySourceRecoveryPackSchema,
  ApproveRecoveryPackSourceSchema,
  recoveryPackContentHash,
} from "@openround/contracts";
import {
  RecoveryPackDraftConflictError,
  RecoveryPackMutationConflictError,
  RecoveryPackNotFoundError,
  RecoveryPackMediaValidationError,
  RecoveryPackSourceReviewConflictError,
  RecoveryPackSourceReviewRequiredError,
  RecoveryPackSourceCitationValidationError,
  WorkspaceDeletionInProgressError,
  type CreatorContext,
  type RecoveryPackRepository,
  type Repository,
} from "@openround/db";
import type { AuthService } from "./auth.js";
import type { AppConfig } from "./config.js";
import { RECOVERY_PACK_BODY_LIMIT } from "./draft-limits.js";
import {
  RecoveryPackSourceProposalError,
  sourceRecoveryPackProposal,
} from "./recovery-pack-source-authoring.js";

const Params = z.object({ id: z.string().uuid() });

function apiError(reply: FastifyReply, status: number, code: string, message: string, id: string) {
  return reply.code(status).send({ error: { code, message, requestId: id } });
}

export async function registerRecoveryPackSourceRoutes(
  app: FastifyInstance,
  dependencies: {
    config: AppConfig;
    repository: Repository;
    packs: RecoveryPackRepository;
    auth: AuthService;
  },
) {
  const { config, repository, packs, auth } = dependencies;
  const authorize = async (request: FastifyRequest, reply: FastifyReply, write = false) => {
    reply.header("cache-control", "private, no-store");
    const creator = await auth.requireCreator(request, reply);
    if (!creator) return null;
    if (write && creator.role === "viewer") {
      apiError(
        reply,
        403,
        "UNAUTHORIZED",
        "Your workspace role does not allow this action",
        request.id,
      );
      return null;
    }
    return creator;
  };
  const enabled = async (creator: CreatorContext, request: FastifyRequest, reply: FastifyReply) => {
    if (await workspaceFeatureEnabled(repository, config, creator.workspaceId, "recoveryPacks"))
      return true;
    apiError(
      reply,
      404,
      "NOT_FOUND",
      "Recovery Pack authoring is not enabled in this workspace",
      request.id,
    );
    return false;
  };
  const audit = (
    creator: CreatorContext,
    request: FastifyRequest,
    action: string,
    targetId: string,
  ) =>
    repository.recordAudit({
      workspaceId: creator.workspaceId,
      actorId: creator.userId,
      action,
      targetType: "recovery_pack",
      targetId,
      requestId: request.id,
      metadata: {},
    });
  const failure = (error: unknown, request: FastifyRequest, reply: FastifyReply) => {
    if (error instanceof RecoveryPackNotFoundError)
      return apiError(reply, 404, "NOT_FOUND", "Pack not found", request.id);
    if (
      error instanceof RecoveryPackSourceCitationValidationError ||
      error instanceof RecoveryPackMediaValidationError
    )
      return apiError(reply, 422, "VALIDATION_ERROR", error.message, request.id);
    if (
      error instanceof WorkspaceDeletionInProgressError ||
      error instanceof RecoveryPackDraftConflictError ||
      error instanceof RecoveryPackMutationConflictError ||
      error instanceof RecoveryPackSourceReviewConflictError ||
      error instanceof RecoveryPackSourceReviewRequiredError ||
      error instanceof RecoveryPackSourceProposalError
    )
      return apiError(reply, 409, "CONFLICT", error.message, request.id);
    throw error;
  };
  const source = async (
    creator: CreatorContext,
    id: string,
    request: FastifyRequest,
    reply: FastifyReply,
  ) => {
    const job = await repository.getAuthoringJob(creator.workspaceId, id);
    if (!job || job.expiresAt <= new Date()) {
      apiError(reply, 404, "NOT_FOUND", "Authoring source not found or expired", request.id);
      return null;
    }
    return { job, ...sourceRecoveryPackProposal(job) };
  };

  app.get("/v1/authoring/jobs/:id/recovery-pack-proposal", async (request, reply) => {
    const creator = await authorize(request, reply);
    if (!creator) return;
    const { id } = Params.parse(request.params);
    try {
      const result = await source(creator, id, request, reply);
      return result ? { proposal: result.proposal } : undefined;
    } catch (error) {
      return failure(error, request, reply);
    }
  });
  app.post(
    "/v1/authoring/jobs/:id/apply-recovery-pack",
    { bodyLimit: RECOVERY_PACK_BODY_LIMIT },
    async (request, reply) => {
      const creator = await authorize(request, reply, true);
      if (!creator) return;
      const { id } = Params.parse(request.params);
      const input = ApplySourceRecoveryPackSchema.parse(request.body);
      const requestHash = createHash("sha256")
        .update(JSON.stringify({ kind: "source-recovery-pack-create", authoringJobId: id, input }))
        .digest("hex");
      try {
        // Recover an accepted creation before source retention or rollout checks.
        const existing = await packs.replaySourceRecoveryPack(
          creator.workspaceId,
          input.mutationId,
          requestHash,
        );
        if (existing) return reply.code(201).send({ pack: existing });
        if (!(await enabled(creator, request, reply))) return;
        const result = await source(creator, id, request, reply);
        if (!result) return;
        if (
          input.sourceOutputHash !== result.proposal.sourceOutputHash ||
          input.expectedContentHash !== result.proposal.contentHash ||
          input.expectedContentHash !== recoveryPackContentHash(input.draft)
        )
          return apiError(
            reply,
            409,
            "CONFLICT",
            "The reviewed source or Pack content changed. Reload the proposal before creating a draft.",
            request.id,
          );
        const now = new Date();
        const pack = await packs.createSourceRecoveryPack(
          {
            id: randomUUID(),
            workspaceId: creator.workspaceId,
            title: input.draft.title,
            description: input.draft.description,
            draft: input.draft,
            draftRevision: 0,
            draftSchemaVersion: 1,
            currentVersionId: null,
            publishedDraftRevision: null,
            lastEditedBy: creator.userId,
            createdAt: now,
            updatedAt: now,
          },
          {
            authoringJobId: id,
            sourceName: result.proposal.sourceName,
            sourceDigest: result.proposal.sourceDigest,
            sourceOutputHash: result.proposal.sourceOutputHash,
            citationCatalog: result.citationCatalog,
          },
          input.mutationId,
          requestHash,
        );
        await audit(creator, request, "recovery_pack.source.create", pack.id);
        return reply.code(201).send({ pack });
      } catch (error) {
        return failure(error, request, reply);
      }
    },
  );
  app.post(
    "/v1/recovery-packs/:id/source-review",
    { bodyLimit: RECOVERY_PACK_BODY_LIMIT },
    async (request, reply) => {
      const creator = await authorize(request, reply, true);
      if (!creator || !(await enabled(creator, request, reply))) return;
      const { id } = Params.parse(request.params);
      const input = ApproveRecoveryPackSourceSchema.parse(request.body);
      try {
        const pack = await packs.approveRecoveryPackSource({
          workspaceId: creator.workspaceId,
          packId: id,
          editorId: creator.userId,
          ...input,
        });
        await audit(creator, request, "recovery_pack.source.approve", id);
        return { pack };
      } catch (error) {
        return failure(error, request, reply);
      }
    },
  );
}
