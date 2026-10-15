import { workspaceFeatureEnabled } from "./feature-policy.js";
import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import {
  InsertRecoveryPackIntoPresentationSchema,
  PresentationDraftSchema,
  type PresentationDraft,
} from "@openround/contracts";
import {
  PresentationDraftConflictError,
  PresentationMutationConflictError,
  WorkspaceDeletionInProgressError,
  type PresentationRepository,
  type RecoveryPackRepository,
  type Repository,
} from "@openround/db";
import type { AuthService } from "./auth.js";
import type { AppConfig } from "./config.js";
import { PRESENTATION_PACK_INSERTION_DRAFT_LIMIT } from "./draft-limits.js";
import {
  recoveryPackCopyId,
  recoveryPackHash,
  recoveryPackQuestions,
} from "./recovery-pack-copies.js";

const IdParams = z.object({ id: z.string().uuid() });

function apiError(
  reply: FastifyReply,
  status: number,
  code: string,
  message: string,
  requestId: string,
) {
  return reply.code(status).send({ error: { code, message, requestId } });
}

export async function registerRecoveryPackPresentationRoutes(
  app: FastifyInstance,
  dependencies: {
    config: AppConfig;
    repository: Repository;
    presentations: PresentationRepository;
    packs: RecoveryPackRepository;
    auth: AuthService;
    workspaceEnabled: (workspaceId: string) => boolean | Promise<boolean>;
  },
) {
  const { config, repository, presentations, packs, auth, workspaceEnabled } = dependencies;
  app.post("/v1/presentations/:id/recovery-packs/insert", async (request, reply) => {
    reply.header("cache-control", "private, no-store");
    const creator = await auth.requireCreator(request, reply);
    if (!creator) return;
    if (creator.role !== "owner" && creator.role !== "editor")
      return apiError(
        reply,
        403,
        "UNAUTHORIZED",
        "Your workspace role does not allow this action",
        request.id,
      );
    const { id } = IdParams.parse(request.params);
    const input = InsertRecoveryPackIntoPresentationSchema.parse(request.body);
    const presentation = await presentations.getPresentation(creator.workspaceId, id);
    if (!presentation)
      return apiError(reply, 404, "NOT_FOUND", "Presentation not found", request.id);
    const insertedBlockIds = (["diagnostic", "recheck"] as const).map((role) =>
      recoveryPackCopyId(`${input.mutationId}:presentation-block:${role}:${input.packVersionId}`),
    );
    const draftHash = recoveryPackHash({
      kind: "presentation-recovery-pack-insert",
      presentationId: id,
      packVersionId: input.packVersionId,
      afterBlockId: input.afterBlockId,
    });
    const save = (draft: PresentationDraft) =>
      presentations.updatePresentationDraft({
        workspaceId: creator.workspaceId,
        presentationId: id,
        draft,
        expectedRevision: input.expectedRevision,
        mutationId: input.mutationId,
        editorId: creator.userId,
        draftHash,
      });
    try {
      let updated;
      // Receipts precede rollout/stale/source/capacity checks, including retries after a pause
      // or source deletion. Missing receipts still fail the revision fence without writing.
      if (presentation.draftRevision !== input.expectedRevision) {
        updated = await save(presentation.draft);
      } else {
        if (
          !(await workspaceEnabled(creator.workspaceId)) ||
          !(await workspaceFeatureEnabled(repository, config, creator.workspaceId, "recoveryPacks"))
        )
          return apiError(
            reply,
            404,
            "NOT_FOUND",
            "Presentation Pack insertion is not enabled in this workspace",
            request.id,
          );
        const version = await packs.getRecoveryPackVersion(
          creator.workspaceId,
          input.packVersionId,
        );
        if (!version)
          return apiError(reply, 404, "NOT_FOUND", "Published Pack version not found", request.id);
        const blocks = [...presentation.draft.blocks];
        let insertionIndex = blocks.length;
        if (input.afterBlockId) {
          const anchorIndex = blocks.findIndex((block) => block.id === input.afterBlockId);
          if (anchorIndex === -1)
            return apiError(
              reply,
              422,
              "VALIDATION_ERROR",
              "The selected insertion point is not in this Presentation",
              request.id,
            );
          insertionIndex = anchorIndex + 1;
        }
        const questions = recoveryPackQuestions(version, input.mutationId);
        blocks.splice(
          insertionIndex,
          0,
          ...questions.map((question, index) => ({
            id: insertedBlockIds[index]!,
            kind: "question" as const,
            question,
          })),
        );
        const draft = PresentationDraftSchema.parse({
          ...presentation.draft,
          schemaVersion: 3,
          blocks,
          recoveryPackInsertions: [
            ...(presentation.draft.recoveryPackInsertions ?? []),
            {
              id: input.mutationId,
              packId: version.packId,
              packVersionId: version.id,
              packVersion: version.version,
              contentHash: version.contentHash,
              diagnosticQuestionId: questions[0]!.id,
              recheckQuestionId: questions[1]!.id,
              originalContent: version.content,
            },
          ],
        });
        if (
          Buffer.byteLength(JSON.stringify(draft), "utf8") > PRESENTATION_PACK_INSERTION_DRAFT_LIMIT
        )
          return apiError(
            reply,
            422,
            "VALIDATION_ERROR",
            "This Pack would make the Presentation too large to safely edit. Use a smaller Pack or another Presentation.",
            request.id,
          );
        updated = await save(draft);
        if (updated)
          await repository.recordAudit({
            workspaceId: creator.workspaceId,
            actorId: creator.userId,
            action: "presentation.recovery_pack_insert",
            targetType: "presentation",
            targetId: id,
            requestId: request.id,
            metadata: {
              packId: version.packId,
              packVersionId: version.id,
              insertionId: input.mutationId,
            },
          });
      }
      if (!updated)
        return apiError(
          reply,
          409,
          "CONFLICT",
          "Archived Presentations cannot accept a Pack",
          request.id,
        );
      reply.header("etag", `"draft-${updated.draftRevision}"`);
      return {
        presentation: {
          ...updated,
          hasUnpublishedChanges:
            updated.currentVersionId === null ||
            updated.publishedDraftRevision !== updated.draftRevision,
        },
        insertedBlockIds,
      };
    } catch (error) {
      if (error instanceof PresentationDraftConflictError)
        return reply.code(409).send({
          error: {
            code: "STALE_DRAFT",
            message: "This Presentation changed since you opened it. Reload before inserting.",
            requestId: request.id,
            details: {
              presentationId: id,
              expectedDraftRevision: error.expectedRevision,
              currentDraftRevision: error.currentRevision,
              currentEditorId: error.currentEditorId,
            },
          },
        });
      if (error instanceof PresentationMutationConflictError)
        return apiError(
          reply,
          409,
          "CONFLICT",
          "This mutation ID was already used for a different change",
          request.id,
        );
      if (error instanceof WorkspaceDeletionInProgressError)
        return apiError(
          reply,
          409,
          "CONFLICT",
          "Workspace deletion is in progress. New Presentation changes are blocked.",
          request.id,
        );
      throw error;
    }
  });
}
