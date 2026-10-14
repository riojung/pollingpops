import { createHash, randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  CreateRecoveryPackSchema,
  InsertRecoveryPackSchema,
  PublishRecoveryPackSchema,
  QuizDraftSchema,
  RecoveryPackContentSchema,
  RecoveryPackJsonSchema,
  UpdateRecoveryPackSchema,
  type RecoveryPackDraft,
} from "@openround/contracts";
import {
  QuizDraftMutationConflictError,
  QuizDraftRevisionConflictError,
  RecoveryPackDraftConflictError,
  RecoveryPackMutationConflictError,
  RecoveryPackNotFoundError,
  RecoveryPackMediaValidationError,
  RecoveryPackSourceReviewRequiredError,
  roundArtifactSchemaVersion,
  WorkspaceDeletionInProgressError,
  type CreatorContext,
  type RecoveryPackRepository,
  type Repository,
} from "@openround/db";
import type { AuthService } from "./auth.js";
import type { AppConfig } from "./config.js";
import { evidenceWorkspaceFeatureEnabled } from "./workspace-rollout.js";
import { RECOVERY_PACK_BODY_LIMIT, ROUND_PACK_INSERTION_DRAFT_LIMIT } from "./draft-limits.js";
import { registerRecoveryPackUpdateRoutes } from "./recovery-pack-update-routes.js";
import { recoveryPackQuestions } from "./recovery-pack-copies.js";
import {
  extendedRoundResponseWriteAllowed,
  EXTENDED_ROUND_RESPONSE_UNAVAILABLE_MESSAGE,
} from "./round-response-rollout.js";
export { recoveryPackQuestions } from "./recovery-pack-copies.js";

const IdParams = z.object({ id: z.string().uuid() });
const VersionParams = z.object({ versionId: z.string().uuid() });
const RestoreInput = z.object({
  historyRevision: z.number().int().nonnegative(),
  expectedRevision: z.number().int().nonnegative(),
  mutationId: z.string().uuid(),
});

function hash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function apiError(
  reply: FastifyReply,
  status: number,
  code: string,
  message: string,
  requestId: string,
) {
  return reply.code(status).send({ error: { code, message, requestId } });
}

export async function registerRecoveryPackRoutes(
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
    if (write && !evidenceWorkspaceFeatureEnabled(config, creator.workspaceId, "recoveryPacks")) {
      apiError(
        reply,
        404,
        "NOT_FOUND",
        "Recovery Pack authoring is not enabled in this workspace",
        request.id,
      );
      return null;
    }
    return creator;
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
  const conflict = (error: unknown, reply: FastifyReply, requestId: string) => {
    if (error instanceof RecoveryPackNotFoundError)
      return apiError(reply, 404, "NOT_FOUND", "Pack not found", requestId);
    if (error instanceof WorkspaceDeletionInProgressError)
      return apiError(
        reply,
        409,
        "CONFLICT",
        "Workspace deletion is in progress. New Pack changes are blocked.",
        requestId,
      );
    if (error instanceof RecoveryPackMediaValidationError)
      return apiError(reply, 422, "VALIDATION_ERROR", error.message, requestId);
    if (error instanceof RecoveryPackSourceReviewRequiredError)
      return apiError(reply, 409, "CONFLICT", error.message, requestId);
    if (
      error instanceof RecoveryPackDraftConflictError ||
      error instanceof QuizDraftRevisionConflictError
    ) {
      return reply.code(409).send({
        error: {
          code: "CONFLICT",
          message: "This draft changed in another editor. Reload before saving.",
          requestId,
          details: {
            expectedRevision: error.expectedRevision,
            currentRevision: error.currentRevision,
          },
        },
      });
    }
    if (
      error instanceof RecoveryPackMutationConflictError ||
      error instanceof QuizDraftMutationConflictError
    )
      return apiError(
        reply,
        409,
        "CONFLICT",
        "This mutation ID was already used for a different change",
        requestId,
      );
    throw error;
  };
  const create = async (
    creator: CreatorContext,
    request: FastifyRequest,
    reply: FastifyReply,
    draft: RecoveryPackDraft,
  ) => {
    const now = new Date();
    try {
      const pack = await packs.createRecoveryPack({
        id: randomUUID(),
        workspaceId: creator.workspaceId,
        title: draft.title,
        description: draft.description,
        draft,
        draftRevision: 0,
        draftSchemaVersion: 1,
        currentVersionId: null,
        publishedDraftRevision: null,
        lastEditedBy: creator.userId,
        createdAt: now,
        updatedAt: now,
      });
      await audit(creator, request, "recovery_pack.create", pack.id);
      return reply.code(201).send({ pack });
    } catch (error) {
      return conflict(error, reply, request.id);
    }
  };

  app.get("/v1/recovery-packs", async (request, reply) => {
    const creator = await authorize(request, reply);
    if (!creator) return;
    return { packs: await packs.listRecoveryPacks(creator.workspaceId) };
  });
  app.post(
    "/v1/recovery-packs",
    { bodyLimit: RECOVERY_PACK_BODY_LIMIT },
    async (request, reply) => {
      const creator = await authorize(request, reply, true);
      if (!creator) return;
      return create(creator, request, reply, CreateRecoveryPackSchema.parse(request.body).draft);
    },
  );
  app.post(
    "/v1/recovery-packs/import",
    { bodyLimit: RECOVERY_PACK_BODY_LIMIT },
    async (request, reply) => {
      const creator = await authorize(request, reply, true);
      if (!creator) return;
      const input = RecoveryPackJsonSchema.parse(request.body);
      // Source IDs and workspace-local media references are lossless. Import never publishes.
      return create(creator, request, reply, input.content);
    },
  );
  app.get("/v1/recovery-packs/versions/:versionId", async (request, reply) => {
    const creator = await authorize(request, reply);
    if (!creator) return;
    const { versionId } = VersionParams.parse(request.params);
    const version = await packs.getRecoveryPackVersion(creator.workspaceId, versionId);
    return version
      ? { version }
      : apiError(reply, 404, "NOT_FOUND", "Pack version not found", request.id);
  });
  app.get("/v1/recovery-packs/versions/:versionId/export", async (request, reply) => {
    const creator = await authorize(request, reply);
    if (!creator) return;
    const { versionId } = VersionParams.parse(request.params);
    const version = await packs.getRecoveryPackVersion(creator.workspaceId, versionId);
    if (!version) return apiError(reply, 404, "NOT_FOUND", "Pack version not found", request.id);
    reply.header(
      "content-disposition",
      `attachment; filename="polling-pops-recovery-pack-${versionId}.json"`,
    );
    return RecoveryPackJsonSchema.parse({
      format: "openround-recovery-pack",
      schemaVersion: 1,
      content: version.content,
    });
  });
  app.get("/v1/recovery-packs/:id", async (request, reply) => {
    const creator = await authorize(request, reply);
    if (!creator) return;
    const { id } = IdParams.parse(request.params);
    const pack = await packs.getRecoveryPack(creator.workspaceId, id);
    return pack ? { pack } : apiError(reply, 404, "NOT_FOUND", "Pack not found", request.id);
  });
  app.get("/v1/recovery-packs/:id/history", async (request, reply) => {
    const creator = await authorize(request, reply);
    if (!creator) return;
    const { id } = IdParams.parse(request.params);
    if (!(await packs.getRecoveryPack(creator.workspaceId, id)))
      return apiError(reply, 404, "NOT_FOUND", "Pack not found", request.id);
    return { history: await packs.listRecoveryPackHistory(creator.workspaceId, id, 20) };
  });
  app.put(
    "/v1/recovery-packs/:id/draft",
    { bodyLimit: RECOVERY_PACK_BODY_LIMIT },
    async (request, reply) => {
      const creator = await authorize(request, reply, true);
      if (!creator) return;
      const { id } = IdParams.parse(request.params);
      const input = UpdateRecoveryPackSchema.parse(request.body);
      try {
        const pack = await packs.updateRecoveryPackDraft({
          ...input,
          workspaceId: creator.workspaceId,
          packId: id,
          editorId: creator.userId,
          draftHash: hash({ kind: "save", draft: input.draft }),
        });
        if (!pack) return apiError(reply, 404, "NOT_FOUND", "Pack not found", request.id);
        await audit(creator, request, "recovery_pack.draft.save", id);
        reply.header("etag", `"draft-${pack.draftRevision}"`);
        return { pack };
      } catch (error) {
        return conflict(error, reply, request.id);
      }
    },
  );
  app.post("/v1/recovery-packs/:id/restore", async (request, reply) => {
    const creator = await authorize(request, reply, true);
    if (!creator) return;
    const { id } = IdParams.parse(request.params);
    const input = RestoreInput.parse(request.body);
    const current = await packs.getRecoveryPack(creator.workspaceId, id);
    if (!current) return apiError(reply, 404, "NOT_FOUND", "Pack not found", request.id);
    try {
      const draftHash = hash({ kind: "restore", historyRevision: input.historyRevision });
      const receipt = await packs.replayRecoveryPackMutation({
        ...input,
        workspaceId: creator.workspaceId,
        packId: id,
        draftHash,
      });
      if (receipt) return { pack: receipt };
      // Resolve a saved restore receipt before accessing possibly expired history.
      if (current.draftRevision !== input.expectedRevision) {
        const pack = await packs.updateRecoveryPackDraft({
          ...input,
          workspaceId: creator.workspaceId,
          packId: id,
          editorId: creator.userId,
          draft: current.draft,
          draftHash,
        });
        if (!pack) return apiError(reply, 404, "NOT_FOUND", "Pack not found", request.id);
        return { pack };
      }
      const history = await packs.listRecoveryPackHistory(creator.workspaceId, id, 20);
      const snapshot = history.find((item) => item.revision === input.historyRevision);
      if (!snapshot)
        return apiError(
          reply,
          404,
          "NOT_FOUND",
          "Draft history has expired or does not exist",
          request.id,
        );
      const pack = await packs.updateRecoveryPackDraft({
        ...input,
        workspaceId: creator.workspaceId,
        packId: id,
        editorId: creator.userId,
        draft: snapshot.draft,
        draftHash,
      });
      if (!pack) return apiError(reply, 404, "NOT_FOUND", "Pack not found", request.id);
      await audit(creator, request, "recovery_pack.draft.restore", id);
      return { pack };
    } catch (error) {
      return conflict(error, reply, request.id);
    }
  });
  app.post("/v1/recovery-packs/:id/publish", async (request, reply) => {
    const creator = await authorize(request, reply, true);
    if (!creator) return;
    const { id } = IdParams.parse(request.params);
    const input = PublishRecoveryPackSchema.parse(request.body);
    const pack = await packs.getRecoveryPack(creator.workspaceId, id);
    if (!pack) return apiError(reply, 404, "NOT_FOUND", "Pack not found", request.id);
    const parsed = RecoveryPackContentSchema.safeParse(pack.draft);
    if (!parsed.success)
      return reply.code(422).send({
        error: {
          code: "VALIDATION_ERROR",
          message: "Resolve the Pack publish blockers first",
          requestId: request.id,
          details: {
            issues: parsed.error.issues.map(({ path, message }) => ({
              path: path.join("."),
              message,
            })),
          },
        },
      });
    try {
      const current = pack.currentVersionId
        ? await packs.getRecoveryPackVersion(creator.workspaceId, pack.currentVersionId)
        : null;
      const version = await packs.publishRecoveryPack(
        {
          id: randomUUID(),
          workspaceId: creator.workspaceId,
          packId: id,
          version: (current?.version ?? 0) + 1,
          content: parsed.data,
          contentSchemaVersion: 1,
          contentHash: hash(parsed.data),
          sourceDraftRevision: input.expectedDraftRevision,
          publishedAt: new Date(),
        },
        input.expectedDraftRevision,
      );
      await audit(creator, request, "recovery_pack.publish", id);
      return { version, pack: await packs.getRecoveryPack(creator.workspaceId, id) };
    } catch (error) {
      return conflict(error, reply, request.id);
    }
  });
  app.delete("/v1/recovery-packs/:id", async (request, reply) => {
    // Removal remains available after a rollout is disabled.
    const creator = await authorize(request, reply);
    if (!creator) return;
    if (creator.role === "viewer")
      return apiError(
        reply,
        403,
        "UNAUTHORIZED",
        "Your workspace role does not allow this action",
        request.id,
      );
    const { id } = IdParams.parse(request.params);
    if (!(await packs.deleteRecoveryPack(creator.workspaceId, id)))
      return apiError(reply, 404, "NOT_FOUND", "Pack not found", request.id);
    await audit(creator, request, "recovery_pack.delete", id);
    return reply.code(204).send();
  });
  app.post("/v1/recovery-packs/insert", async (request, reply) => {
    const creator = await authorize(request, reply, true);
    if (!creator) return;
    const input = InsertRecoveryPackSchema.parse(request.body);
    const quiz = await repository.getQuiz(creator.workspaceId, input.quizId);
    if (!quiz) return apiError(reply, 404, "NOT_FOUND", "Round not found", request.id);
    const draftHash = hash({
      kind: "recovery-pack-insert",
      packVersionId: input.packVersionId,
      quizId: input.quizId,
    });
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
      });
    try {
      // A retry can succeed after source deletion, destination edits, or capacity changes.
      if ((quiz.draftRevision ?? 0) !== input.expectedRevision) {
        const replayed = await save(quiz.draft);
        if (!replayed)
          return apiError(
            reply,
            409,
            "CONFLICT",
            "The Round is no longer available for insertion",
            request.id,
          );
        return { quiz: replayed };
      }
      const version = await packs.getRecoveryPackVersion(creator.workspaceId, input.packVersionId);
      if (!version)
        return apiError(reply, 404, "NOT_FOUND", "Published Pack version not found", request.id);
      const questions = recoveryPackQuestions(version, input.mutationId);
      const draft = QuizDraftSchema.parse({
        ...quiz.draft,
        questions: [...quiz.draft.questions, ...questions],
        recoveryPackInsertions: [
          ...(quiz.draft.recoveryPackInsertions ?? []),
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
      if (Buffer.byteLength(JSON.stringify(draft), "utf8") > ROUND_PACK_INSERTION_DRAFT_LIMIT)
        return apiError(
          reply,
          422,
          "VALIDATION_ERROR",
          "This Pack would make the Round too large to safely edit. Use a smaller Pack or another Round.",
          request.id,
        );
      if (!extendedRoundResponseWriteAllowed(config, creator.workspaceId, draft))
        return apiError(
          reply,
          404,
          "NOT_FOUND",
          EXTENDED_ROUND_RESPONSE_UNAVAILABLE_MESSAGE,
          request.id,
        );
      const updated = await save(draft);
      if (!updated)
        return apiError(reply, 409, "CONFLICT", "Archived Rounds cannot accept a Pack", request.id);
      await audit(creator, request, "recovery_pack.insert", version.packId);
      return { quiz: updated };
    } catch (error) {
      return conflict(error, reply, request.id);
    }
  });
  registerRecoveryPackUpdateRoutes(app, { config, repository, packs, authorize, conflict });
}
