import { workspaceFeatureEnabled } from "./feature-policy.js";
import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import {
  ApplyPresentationRecoveryPackUpdateSchema,
  PresentationRecoveryPackUpdatePreviewRequestSchema,
  PresentationRecoveryPackUpdatePreviewSchema,
  RecoveryPackUpdateError,
  applyPresentationRecoveryPackUpdate,
  buildPresentationRecoveryPackUpdatePreview,
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
import { recoveryPackHash } from "./recovery-pack-copies.js";

const IdParams = z.object({ id: z.string().uuid() });

/** Updates are reviewed draft proposals; published Presentations and live sessions stay frozen. */
export async function registerRecoveryPackPresentationUpdateRoutes(
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
  const error = (
    reply: FastifyReply,
    status: number,
    code: string,
    message: string,
    requestId: string,
  ) => reply.code(status).send({ error: { code, message, requestId } });
  const failure = (cause: unknown, reply: FastifyReply, id: string, requestId: string) => {
    if (cause instanceof PresentationDraftConflictError)
      return reply.code(409).send({
        error: {
          code: "STALE_DRAFT",
          message: "This Presentation changed since you reviewed it. Reload before updating.",
          requestId,
          details: {
            presentationId: id,
            expectedDraftRevision: cause.expectedRevision,
            currentDraftRevision: cause.currentRevision,
            currentEditorId: cause.currentEditorId,
          },
        },
      });
    if (cause instanceof PresentationMutationConflictError)
      return error(
        reply,
        409,
        "CONFLICT",
        "This mutation ID was already used for a different change",
        requestId,
      );
    if (cause instanceof RecoveryPackUpdateError)
      return error(reply, 409, "CONFLICT", cause.message, requestId);
    if (cause instanceof WorkspaceDeletionInProgressError)
      return error(
        reply,
        409,
        "CONFLICT",
        "Workspace deletion is in progress. New Presentation changes are blocked.",
        requestId,
      );
    throw cause;
  };

  app.post("/v1/presentations/:id/recovery-packs/update-review", async (request, reply) => {
    reply.header("cache-control", "private, no-store");
    const creator = await auth.requireCreator(request, reply);
    if (!creator) return;
    // Existing copies and comparisons remain readable when either rollout is paused.
    const { id } = IdParams.parse(request.params);
    const input = PresentationRecoveryPackUpdatePreviewRequestSchema.parse(request.body);
    const presentation = await presentations.getPresentation(creator.workspaceId, id);
    if (!presentation) return error(reply, 404, "NOT_FOUND", "Presentation not found", request.id);
    const insertion = presentation.draft.recoveryPackInsertions?.find(
      (copy) => copy.id === input.insertionId,
    );
    if (!insertion) return error(reply, 404, "NOT_FOUND", "Pack insertion not found", request.id);
    const pack = await packs.getRecoveryPack(creator.workspaceId, insertion.packId);
    const version = pack?.currentVersionId
      ? await packs.getRecoveryPackVersion(creator.workspaceId, pack.currentVersionId)
      : null;
    if (!version)
      return error(
        reply,
        404,
        "NOT_FOUND",
        "The source Pack is no longer available; your copies are unchanged",
        request.id,
      );
    try {
      return {
        review: PresentationRecoveryPackUpdatePreviewSchema.parse({
          ...buildPresentationRecoveryPackUpdatePreview(presentation.draft, insertion, version),
          presentationId: id,
          draftRevision: presentation.draftRevision,
        }),
      };
    } catch (cause) {
      return failure(cause, reply, id, request.id);
    }
  });

  app.post("/v1/presentations/:id/recovery-packs/update", async (request, reply) => {
    reply.header("cache-control", "private, no-store");
    const creator = await auth.requireCreator(request, reply);
    if (!creator) return;
    if (creator.role !== "owner" && creator.role !== "editor")
      return error(
        reply,
        403,
        "UNAUTHORIZED",
        "Your workspace role does not allow this action",
        request.id,
      );
    const { id } = IdParams.parse(request.params);
    const input = ApplyPresentationRecoveryPackUpdateSchema.parse(request.body);
    const presentation = await presentations.getPresentation(creator.workspaceId, id);
    if (!presentation) return error(reply, 404, "NOT_FOUND", "Presentation not found", request.id);
    const draftHash = recoveryPackHash({
      kind: "presentation-recovery-pack-update",
      presentationId: id,
      insertionId: input.insertionId,
      packVersionId: input.packVersionId,
      choices: [...input.choices].sort((left, right) => left.role.localeCompare(right.role)),
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
        recoveryPackUpdateSourceRevision: input.expectedRevision,
      });
    const response = (updated: NonNullable<Awaited<ReturnType<typeof save>>>) => {
      reply.header("etag", `"draft-${updated.draftRevision}"`);
      return {
        presentation: {
          ...updated,
          hasUnpublishedChanges:
            updated.currentVersionId === null ||
            updated.publishedDraftRevision !== updated.draftRevision,
        },
        undo: { sourceRevision: input.expectedRevision, appliedRevision: updated.draftRevision },
      };
    };
    try {
      // Durable receipts precede stale-state/source/capacity rejection, including lost ACKs
      // recovered after later local edits or source deletion.
      if (presentation.draftRevision !== input.expectedRevision) {
        const replayed = await save(presentation.draft);
        if (!replayed)
          return error(
            reply,
            409,
            "CONFLICT",
            "The Presentation is no longer available for updating",
            request.id,
          );
        return response(replayed);
      }
      if (
        !(await workspaceEnabled(creator.workspaceId)) ||
        !(await workspaceFeatureEnabled(repository, config, creator.workspaceId, "recoveryPacks"))
      )
        return error(
          reply,
          404,
          "NOT_FOUND",
          "Presentation Pack updates are not enabled in this workspace",
          request.id,
        );
      const insertion = presentation.draft.recoveryPackInsertions?.find(
        (copy) => copy.id === input.insertionId,
      );
      if (!insertion) return error(reply, 404, "NOT_FOUND", "Pack insertion not found", request.id);
      const version = await packs.getRecoveryPackVersion(creator.workspaceId, input.packVersionId);
      if (!version || version.packId !== insertion.packId)
        return error(
          reply,
          404,
          "NOT_FOUND",
          "Published source Pack version not found",
          request.id,
        );
      if (version.id === (insertion.updateBaseline?.packVersionId ?? insertion.packVersionId))
        return error(reply, 409, "CONFLICT", "This Pack version is already reviewed", request.id);
      // Accept the exact immutable reviewed version, never silently substitute a newer publish.
      const preview = buildPresentationRecoveryPackUpdatePreview(
        presentation.draft,
        insertion,
        version,
      );
      const draft = applyPresentationRecoveryPackUpdate(
        presentation.draft,
        preview,
        version,
        input.choices,
      );
      if (
        Buffer.byteLength(JSON.stringify(draft), "utf8") > PRESENTATION_PACK_INSERTION_DRAFT_LIMIT
      )
        return error(
          reply,
          422,
          "VALIDATION_ERROR",
          "This update would make the Presentation too large to safely edit",
          request.id,
        );
      const updated = await save(draft);
      if (!updated)
        return error(
          reply,
          409,
          "CONFLICT",
          "Archived Presentations cannot accept a Pack update",
          request.id,
        );
      await repository.recordAudit({
        workspaceId: creator.workspaceId,
        actorId: creator.userId,
        action: "presentation.recovery_pack_update",
        targetType: "presentation",
        targetId: id,
        requestId: request.id,
        metadata: {
          packId: insertion.packId,
          insertionId: insertion.id,
          packVersionId: version.id,
          sourceRevision: input.expectedRevision,
          appliedRevision: updated.draftRevision,
          choices: input.choices,
        },
      });
      return response(updated);
    } catch (cause) {
      return failure(cause, reply, id, request.id);
    }
  });
}
