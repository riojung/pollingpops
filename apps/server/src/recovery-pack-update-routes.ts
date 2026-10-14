import { createHash } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  ApplyRecoveryPackUpdateSchema,
  RecoveryPackUpdateError,
  RecoveryPackUpdatePreviewRequestSchema,
  RecoveryPackUpdatePreviewSchema,
  applyRecoveryPackUpdate,
  buildRecoveryPackUpdatePreview,
} from "@openround/contracts";
import {
  roundArtifactSchemaVersion,
  type CreatorContext,
  type RecoveryPackRepository,
  type Repository,
} from "@openround/db";
import { ROUND_PACK_INSERTION_DRAFT_LIMIT } from "./draft-limits.js";
import type { AppConfig } from "./config.js";
import {
  extendedRoundResponseWriteAllowed,
  EXTENDED_ROUND_RESPONSE_UNAVAILABLE_MESSAGE,
} from "./round-response-rollout.js";

/** Pack changes are proposals for one Round draft, never mutations of published content. */
export function registerRecoveryPackUpdateRoutes(
  app: FastifyInstance,
  dependencies: {
    config: AppConfig;
    repository: Repository;
    packs: RecoveryPackRepository;
    authorize: (
      request: FastifyRequest,
      reply: FastifyReply,
      write?: boolean,
    ) => Promise<CreatorContext | null>;
    conflict: (error: unknown, reply: FastifyReply, requestId: string) => unknown;
  },
) {
  const { config, repository, packs, authorize, conflict } = dependencies;
  const error = (reply: FastifyReply, status: number, message: string, requestId: string) =>
    reply.code(status).send({
      error: { code: status === 404 ? "NOT_FOUND" : "CONFLICT", message, requestId },
    });
  const failure = (cause: unknown, reply: FastifyReply, requestId: string) => {
    if (cause instanceof RecoveryPackUpdateError)
      return error(reply, 409, cause.message, requestId);
    return conflict(cause, reply, requestId);
  };

  app.post("/v1/recovery-packs/update-review", async (request, reply) => {
    // Existing copies and comparisons remain readable when authoring is disabled.
    const creator = await authorize(request, reply);
    if (!creator) return;
    const input = RecoveryPackUpdatePreviewRequestSchema.parse(request.body);
    const quiz = await repository.getQuiz(creator.workspaceId, input.quizId);
    if (!quiz) return error(reply, 404, "Round not found", request.id);
    const insertion = quiz.draft.recoveryPackInsertions?.find(
      (copy) => copy.id === input.insertionId,
    );
    if (!insertion) return error(reply, 404, "Pack insertion not found", request.id);
    const pack = await packs.getRecoveryPack(creator.workspaceId, insertion.packId);
    const version = pack?.currentVersionId
      ? await packs.getRecoveryPackVersion(creator.workspaceId, pack.currentVersionId)
      : null;
    if (!version)
      return error(
        reply,
        404,
        "The source Pack is no longer available; your copies are unchanged",
        request.id,
      );
    try {
      return {
        review: RecoveryPackUpdatePreviewSchema.parse({
          ...buildRecoveryPackUpdatePreview(quiz.draft, insertion, version),
          quizId: quiz.id,
          draftRevision: quiz.draftRevision ?? 0,
        }),
      };
    } catch (cause) {
      return failure(cause, reply, request.id);
    }
  });

  app.post("/v1/recovery-packs/update", async (request, reply) => {
    const creator = await authorize(request, reply, true);
    if (!creator) return;
    const input = ApplyRecoveryPackUpdateSchema.parse(request.body);
    const quiz = await repository.getQuiz(creator.workspaceId, input.quizId);
    if (!quiz) return error(reply, 404, "Round not found", request.id);
    const draftHash = createHash("sha256")
      .update(
        JSON.stringify({
          kind: "recovery-pack-update",
          quizId: input.quizId,
          insertionId: input.insertionId,
          packVersionId: input.packVersionId,
          choices: [...input.choices].sort((left, right) => left.role.localeCompare(right.role)),
        }),
      )
      .digest("hex");
    const save = (draft: typeof quiz.draft) =>
      repository.updateQuizDraft({
        workspaceId: creator.workspaceId,
        quizId: quiz.id,
        draft,
        expectedRevision: input.expectedRevision,
        mutationId: input.mutationId,
        editorId: creator.userId,
        schemaVersion: roundArtifactSchemaVersion(draft),
        draftHash,
        recoveryPackUpdateSourceRevision: input.expectedRevision,
      });
    const response = (updated: NonNullable<Awaited<ReturnType<typeof save>>>) => ({
      quiz: updated,
      undo: { sourceRevision: input.expectedRevision, appliedRevision: updated.draftRevision ?? 0 },
    });
    try {
      // Resolve the durable Round receipt before source, conflict, and size validation. A lost
      // acknowledgement can be recovered even after deletion or subsequent destination edits.
      if ((quiz.draftRevision ?? 0) !== input.expectedRevision) {
        const replayed = await save(quiz.draft);
        if (!replayed)
          return error(reply, 409, "The Round is no longer available for updating", request.id);
        return response(replayed);
      }
      const insertion = quiz.draft.recoveryPackInsertions?.find(
        (copy) => copy.id === input.insertionId,
      );
      if (!insertion) return error(reply, 404, "Pack insertion not found", request.id);
      const version = await packs.getRecoveryPackVersion(creator.workspaceId, input.packVersionId);
      if (!version || version.packId !== insertion.packId)
        return error(reply, 404, "Published source Pack version not found", request.id);
      const baselineVersionId = insertion.updateBaseline?.packVersionId ?? insertion.packVersionId;
      if (version.id === baselineVersionId)
        return error(reply, 409, "This Pack version is already reviewed", request.id);
      // Apply the exact immutable version reviewed by the author, not an unreviewed version
      // published concurrently. Republishing restored content can make an older immutable
      // version current again. The Round revision fence protects the local side of the merge.
      const preview = buildRecoveryPackUpdatePreview(quiz.draft, insertion, version);
      const draft = applyRecoveryPackUpdate(quiz.draft, preview, version, input.choices);
      if (Buffer.byteLength(JSON.stringify(draft), "utf8") > ROUND_PACK_INSERTION_DRAFT_LIMIT)
        return reply.code(422).send({
          error: {
            code: "VALIDATION_ERROR",
            message: "This update would make the Round too large to safely edit",
            requestId: request.id,
          },
        });
      if (!extendedRoundResponseWriteAllowed(config, creator.workspaceId, draft))
        return error(reply, 404, EXTENDED_ROUND_RESPONSE_UNAVAILABLE_MESSAGE, request.id);
      const updated = await save(draft);
      if (!updated)
        return error(reply, 409, "Archived Rounds cannot accept a Pack update", request.id);
      await repository.recordAudit({
        workspaceId: creator.workspaceId,
        actorId: creator.userId,
        action: "recovery_pack.update.apply",
        targetType: "recovery_pack",
        targetId: insertion.packId,
        requestId: request.id,
        metadata: {
          quizId: quiz.id,
          insertionId: insertion.id,
          packVersionId: version.id,
          sourceRevision: input.expectedRevision,
          appliedRevision: updated.draftRevision ?? 0,
          choices: input.choices,
        },
      });
      return response(updated);
    } catch (cause) {
      return failure(cause, reply, request.id);
    }
  });
}
