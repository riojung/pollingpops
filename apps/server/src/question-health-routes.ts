import { requiresExtendedRoundResponses } from "@openround/contracts";
import { workspaceFeatureEnabled } from "./feature-policy.js";
import { createHash } from "node:crypto";
import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import {
  QuestionHealthDismissalInputSchema,
  QuestionHealthDismissalSchema,
  QuestionHealthRevisionAppliedSchema,
  QuestionHealthRevisionApplyInputSchema,
  QuestionHealthRevisionPreviewInputSchema,
  QuestionHealthRevisionPreviewSchema,
  QuestionHealthRevisionUndoInputSchema,
  QuestionHealthRevisionUndoneSchema,
  QuestionHealthPublishedResultSchema,
  QuestionHealthPostUseResultSchema,
  QuestionHealthResultSchema,
  QuizDraftSchema,
} from "@openround/contracts";
import type { QuestionHealthFinding } from "@openround/contracts";
import { roundArtifactSchemaVersion, type Repository } from "@openround/db";
import { evaluateQuestionHealth } from "@openround/insights";
import { proposeQuestionHealthRevision } from "./question-health-revisions.js";
import { buildQuestionHealthPostUseResult } from "./question-health-post-use.js";
import type { AuthService } from "./auth.js";
import type { AppConfig } from "./config.js";
import { EXTENDED_ROUND_RESPONSE_UNAVAILABLE_MESSAGE } from "./round-response-rollout.js";

const IdParamsSchema = z.object({ id: z.string().uuid() });
const VersionParamsSchema = IdParamsSchema.extend({ versionId: z.string().uuid() });
const DismissalParamsSchema = IdParamsSchema.extend({
  findingId: z.string().min(1).max(500),
});
const ApplicationParamsSchema = IdParamsSchema.extend({ applicationId: z.string().uuid() });
const DismissalRemovalBodySchema = QuestionHealthDismissalInputSchema.omit({ reason: true });

function apiError(
  reply: FastifyReply,
  status: number,
  code: "NOT_FOUND" | "VALIDATION_ERROR" | "FORBIDDEN" | "CONFLICT",
  message: string,
  requestId: string,
) {
  return reply.code(status).send({ error: { code, message, requestId } });
}

async function currentQuestionHealth(
  repository: Repository,
  workspaceId: string,
  quizId: string,
  includeFindingIds?: ReadonlySet<string>,
): Promise<
  | {
      status: "ok";
      draftRevision: number;
      draft: ReturnType<typeof QuizDraftSchema.parse>;
      result: Awaited<ReturnType<typeof evaluateQuestionHealth>>;
    }
  | { status: "not_found" }
  | { status: "invalid_draft" }
> {
  const quiz = await repository.getQuiz(workspaceId, quizId);
  if (!quiz) return { status: "not_found" };
  const draft = QuizDraftSchema.safeParse(quiz.draft);
  if (!draft.success) return { status: "invalid_draft" };
  const draftRevision = quiz.draftRevision ?? 0;
  const result = await evaluateQuestionHealth(draft.data, {
    quizId: quiz.id,
    draftRevision,
    includeFindingIds,
  });
  return { status: "ok", draftRevision, draft: draft.data, result };
}

function applicationRequestHash(
  quizId: string,
  findingId: string,
  input: z.infer<typeof QuestionHealthRevisionPreviewInputSchema>,
) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        quizId,
        findingId,
        draftRevision: input.draftRevision,
        ruleVersion: input.ruleVersion,
        rulesetVersion: input.rulesetVersion,
        contentHash: input.contentHash,
        action: input.action,
      }),
    )
    .digest("hex");
}

function dismissalMatchesFinding(
  dismissal: {
    findingId: string;
    ruleVersion: number;
    rulesetVersion: string;
    contentHash: string;
  },
  finding: QuestionHealthFinding,
) {
  return (
    dismissal.findingId === finding.id &&
    dismissal.ruleVersion === finding.ruleVersion &&
    dismissal.rulesetVersion === finding.rulesetVersion &&
    dismissal.contentHash === finding.contentHash
  );
}

export async function registerQuestionHealthRoutes(
  app: FastifyInstance,
  dependencies: {
    config: AppConfig;
    repository: Repository;
    auth: AuthService;
  },
) {
  const { config, repository, auth } = dependencies;

  app.get("/v1/quizzes/:id/question-health", async (request, reply) => {
    reply.header("cache-control", "private, no-store").header("pragma", "no-cache");
    const creator = await auth.requireCreator(request, reply);
    if (!creator) return;
    const enabled = await workspaceFeatureEnabled(
      repository,
      config,
      creator.workspaceId,
      "questionHealth",
    );

    const { id } = IdParamsSchema.parse(request.params);
    const stored = await repository.listQuestionHealthDismissals(creator.workspaceId, id);
    if (!enabled && stored.length === 0) {
      return apiError(reply, 404, "NOT_FOUND", "Question Health is not available", request.id);
    }
    const current = await currentQuestionHealth(
      repository,
      creator.workspaceId,
      id,
      new Set(stored.map((dismissal) => dismissal.findingId)),
    );
    if (current.status === "not_found") {
      return apiError(reply, 404, "NOT_FOUND", "Round not found", request.id);
    }
    if (current.status === "invalid_draft") {
      if (!enabled) {
        return apiError(reply, 404, "NOT_FOUND", "Question Health is not available", request.id);
      }
      return apiError(
        reply,
        422,
        "VALIDATION_ERROR",
        "The Round draft cannot be evaluated until its content is valid.",
        request.id,
      );
    }

    const dismissals = stored
      .filter((dismissal) =>
        current.result.findings.some((finding) => dismissalMatchesFinding(dismissal, finding)),
      )
      .map((dismissal) =>
        QuestionHealthDismissalSchema.parse({
          findingId: dismissal.findingId,
          ruleVersion: dismissal.ruleVersion,
          rulesetVersion: dismissal.rulesetVersion,
          contentHash: dismissal.contentHash,
          reason: dismissal.reason,
          createdAt: dismissal.createdAt.toISOString(),
        }),
      );
    if (!enabled && dismissals.length === 0) {
      return apiError(reply, 404, "NOT_FOUND", "Question Health is not available", request.id);
    }
    const visibleFindings = enabled
      ? current.result.findings
      : current.result.findings.filter((finding) =>
          dismissals.some((dismissal) => dismissalMatchesFinding(dismissal, finding)),
        );
    reply.header("etag", `"draft-${current.draftRevision}"`);
    return QuestionHealthResultSchema.parse({
      ...current.result,
      findings: visibleFindings,
      dismissals,
    });
  });

  app.get("/v1/quizzes/:id/versions/:versionId/question-health", async (request, reply) => {
    reply.header("cache-control", "private, no-store").header("pragma", "no-cache");
    const creator = await auth.requireCreator(request, reply);
    if (!creator) return;
    if (
      !(await workspaceFeatureEnabled(repository, config, creator.workspaceId, "questionHealth"))
    ) {
      return apiError(reply, 404, "NOT_FOUND", "Question Health is not available", request.id);
    }

    const { id, versionId } = VersionParamsSchema.parse(request.params);
    const version = await repository.getQuizVersion(creator.workspaceId, versionId);
    // The version lookup is workspace-scoped, but the URL must also identify its source Round.
    if (!version || version.quizId !== id) {
      return apiError(reply, 404, "NOT_FOUND", "Published Round version not found", request.id);
    }

    // Repository reads upcast legacy published content using its recorded schema version.
    // Evaluate that immutable snapshot, never the editable draft or its dismissals.
    const result = await evaluateQuestionHealth(version.content, {
      quizId: id,
      draftRevision: version.sourceDraftRevision ?? 0,
    });
    return QuestionHealthPublishedResultSchema.parse({
      ...result,
      source: "published",
      version: {
        id: version.id,
        number: version.version,
        contentHash: version.contentHash,
        publishedAt: version.publishedAt.toISOString(),
        sourceDraftRevision: version.sourceDraftRevision ?? null,
      },
    });
  });

  app.get(
    "/v1/quizzes/:id/versions/:versionId/question-health/observations",
    async (request, reply) => {
      reply.header("cache-control", "private, no-store").header("pragma", "no-cache");
      const creator = await auth.requireCreator(request, reply);
      if (!creator) return;
      if (
        !(await workspaceFeatureEnabled(repository, config, creator.workspaceId, "questionHealth"))
      ) {
        return apiError(reply, 404, "NOT_FOUND", "Question Health is not available", request.id);
      }

      const { id, versionId } = VersionParamsSchema.parse(request.params);
      const version = await repository.getQuizVersion(creator.workspaceId, versionId);
      if (!version || version.quizId !== id) {
        return apiError(reply, 404, "NOT_FOUND", "Published Round version not found", request.id);
      }
      const reportPage = await repository.listQuestionHealthObservationReports(
        creator.workspaceId,
        id,
        versionId,
        new Date(),
      );
      const result = buildQuestionHealthPostUseResult({
        quizId: id,
        content: version.content,
        reports: reportPage.reports,
        hasMoreReports: reportPage.hasMoreReports,
        version: {
          id: version.id,
          number: version.version,
          contentHash: version.contentHash,
          publishedAt: version.publishedAt.toISOString(),
          sourceDraftRevision: version.sourceDraftRevision ?? null,
        },
      });
      return QuestionHealthPostUseResultSchema.parse(result);
    },
  );

  app.put("/v1/quizzes/:id/question-health/dismissals/:findingId", async (request, reply) => {
    reply.header("cache-control", "private, no-store").header("pragma", "no-cache");
    const creator = await auth.requireCreator(request, reply);
    if (!creator) return;
    if (creator.role === "viewer") {
      return apiError(reply, 403, "FORBIDDEN", "An editor role is required", request.id);
    }
    if (
      !(await workspaceFeatureEnabled(repository, config, creator.workspaceId, "questionHealth"))
    ) {
      return apiError(reply, 404, "NOT_FOUND", "Question Health is not available", request.id);
    }

    const { id, findingId } = DismissalParamsSchema.parse(request.params);
    const input = QuestionHealthDismissalInputSchema.parse(request.body);
    const current = await currentQuestionHealth(repository, creator.workspaceId, id);
    if (current.status === "not_found") {
      return apiError(reply, 404, "NOT_FOUND", "Round not found", request.id);
    }
    if (current.status === "invalid_draft") {
      return apiError(
        reply,
        422,
        "VALIDATION_ERROR",
        "The Round draft cannot be evaluated until its content is valid.",
        request.id,
      );
    }
    const finding = current.result.findings.find(
      (candidate) =>
        candidate.id === findingId &&
        candidate.ruleVersion === input.ruleVersion &&
        candidate.rulesetVersion === input.rulesetVersion &&
        candidate.contentHash === input.contentHash,
    );
    if (current.draftRevision !== input.draftRevision || !finding) {
      return apiError(
        reply,
        409,
        "CONFLICT",
        "This finding is stale. Review the current saved draft before dismissing it.",
        request.id,
      );
    }

    const saved = await repository.putQuestionHealthDismissal({
      actorId: creator.userId,
      workspaceId: creator.workspaceId,
      quizId: id,
      findingId,
      ruleVersion: input.ruleVersion,
      rulesetVersion: input.rulesetVersion,
      contentHash: input.contentHash,
      reason: input.reason,
      expectedDraftRevision: input.draftRevision,
      requestId: request.id,
    });
    if (saved.status === "not_found") {
      return apiError(reply, 404, "NOT_FOUND", "Round not found", request.id);
    }
    if (saved.status === "revision_conflict") {
      return apiError(
        reply,
        409,
        "CONFLICT",
        "The Round changed while this dismissal was being saved; review it again.",
        request.id,
      );
    }
    return QuestionHealthDismissalSchema.parse({
      findingId: saved.dismissal.findingId,
      ruleVersion: saved.dismissal.ruleVersion,
      rulesetVersion: saved.dismissal.rulesetVersion,
      contentHash: saved.dismissal.contentHash,
      reason: saved.dismissal.reason,
      createdAt: saved.dismissal.createdAt.toISOString(),
    });
  });

  app.delete("/v1/quizzes/:id/question-health/dismissals/:findingId", async (request, reply) => {
    reply.header("cache-control", "private, no-store").header("pragma", "no-cache");
    const creator = await auth.requireCreator(request, reply);
    if (!creator) return;
    if (creator.role === "viewer") {
      return apiError(reply, 403, "FORBIDDEN", "An editor role is required", request.id);
    }
    const enabled = await workspaceFeatureEnabled(
      repository,
      config,
      creator.workspaceId,
      "questionHealth",
    );

    const { id, findingId } = DismissalParamsSchema.parse(request.params);
    const input = DismissalRemovalBodySchema.parse(request.body);
    const current = await currentQuestionHealth(
      repository,
      creator.workspaceId,
      id,
      new Set([findingId]),
    );
    if (current.status === "not_found") {
      return apiError(reply, 404, "NOT_FOUND", "Round not found", request.id);
    }
    if (current.status === "invalid_draft") {
      if (!enabled) {
        return apiError(reply, 404, "NOT_FOUND", "Question Health is not available", request.id);
      }
      return apiError(
        reply,
        422,
        "VALIDATION_ERROR",
        "The Round draft cannot be evaluated until its content is valid.",
        request.id,
      );
    }
    const finding = current.result.findings.find(
      (candidate) =>
        candidate.id === findingId &&
        candidate.ruleVersion === input.ruleVersion &&
        candidate.rulesetVersion === input.rulesetVersion &&
        candidate.contentHash === input.contentHash,
    );
    if (!enabled) {
      const stored = await repository.listQuestionHealthDismissals(creator.workspaceId, id);
      if (!finding || !stored.some((dismissal) => dismissalMatchesFinding(dismissal, finding))) {
        return apiError(reply, 404, "NOT_FOUND", "Question Health dismissal not found", request.id);
      }
    }
    if (current.draftRevision !== input.draftRevision || !finding) {
      return apiError(
        reply,
        409,
        "CONFLICT",
        "This finding is stale. Review the current saved draft before reopening it.",
        request.id,
      );
    }

    const removed = await repository.deleteQuestionHealthDismissal({
      actorId: creator.userId,
      workspaceId: creator.workspaceId,
      quizId: id,
      findingId,
      ruleVersion: input.ruleVersion,
      rulesetVersion: input.rulesetVersion,
      contentHash: input.contentHash,
      expectedDraftRevision: input.draftRevision,
      requestId: request.id,
    });
    if (removed.status === "not_found") {
      return apiError(reply, 404, "NOT_FOUND", "Round not found", request.id);
    }
    if (removed.status === "revision_conflict") {
      return apiError(
        reply,
        409,
        "CONFLICT",
        "The Round changed while this dismissal was being removed; review it again.",
        request.id,
      );
    }
    return { removed: removed.removed };
  });

  async function proposedRevision(
    workspaceId: string,
    quizId: string,
    findingId: string,
    input: z.infer<typeof QuestionHealthRevisionPreviewInputSchema>,
  ) {
    const current = await currentQuestionHealth(repository, workspaceId, quizId);
    if (current.status !== "ok") return { status: current.status } as const;
    const finding = current.result.findings.find(
      (candidate) =>
        candidate.id === findingId &&
        candidate.ruleVersion === input.ruleVersion &&
        candidate.rulesetVersion === input.rulesetVersion &&
        candidate.contentHash === input.contentHash,
    );
    if (current.draftRevision !== input.draftRevision || !finding) {
      return { status: "stale" } as const;
    }
    const proposal = proposeQuestionHealthRevision(current.draft, finding, input.action);
    if (!proposal) return { status: "unsupported" } as const;
    const after = await evaluateQuestionHealth(proposal.draft, {
      quizId,
      draftRevision: current.draftRevision + 1,
      includeFindingIds: new Set([finding.id]),
      includeQuestionIds: new Set([finding.questionId]),
    });
    if (
      after.findings.some(
        (candidate) =>
          candidate.ruleId === finding.ruleId && candidate.fieldPath === finding.fieldPath,
      )
    ) {
      return { status: "unresolved" } as const;
    }
    return { status: "ok", finding, proposal, draftRevision: current.draftRevision } as const;
  }

  function proposalError(reply: FastifyReply, status: string, requestId: string) {
    if (status === "not_found") {
      return apiError(reply, 404, "NOT_FOUND", "Round not found", requestId);
    }
    if (status === "invalid_draft") {
      return apiError(reply, 422, "VALIDATION_ERROR", "The Round draft is invalid", requestId);
    }
    if (status === "stale") {
      return apiError(reply, 409, "CONFLICT", "This finding or draft revision is stale", requestId);
    }
    return apiError(
      reply,
      422,
      "VALIDATION_ERROR",
      status === "unresolved"
        ? "The proposed edit does not resolve this finding"
        : "This finding does not support the requested edit",
      requestId,
    );
  }

  app.post(
    "/v1/quizzes/:id/question-health/findings/:findingId/preview",
    async (request, reply) => {
      reply.header("cache-control", "private, no-store").header("pragma", "no-cache");
      const creator = await auth.requireCreator(request, reply);
      if (!creator) return;
      if (creator.role === "viewer") {
        return apiError(reply, 403, "FORBIDDEN", "An editor role is required", request.id);
      }
      if (
        !(await workspaceFeatureEnabled(repository, config, creator.workspaceId, "questionHealth"))
      ) {
        return apiError(reply, 404, "NOT_FOUND", "Question Health is not available", request.id);
      }
      const { id, findingId } = DismissalParamsSchema.parse(request.params);
      const input = QuestionHealthRevisionPreviewInputSchema.parse(request.body);
      const proposal = await proposedRevision(creator.workspaceId, id, findingId, input);
      if (proposal.status !== "ok") return proposalError(reply, proposal.status, request.id);
      return QuestionHealthRevisionPreviewSchema.parse({
        findingId,
        draftRevision: proposal.draftRevision,
        contentHash: proposal.finding.contentHash,
        changes: proposal.proposal.changes,
      });
    },
  );

  app.post("/v1/quizzes/:id/question-health/findings/:findingId/apply", async (request, reply) => {
    reply.header("cache-control", "private, no-store").header("pragma", "no-cache");
    const creator = await auth.requireCreator(request, reply);
    if (!creator) return;
    if (creator.role === "viewer") {
      return apiError(reply, 403, "FORBIDDEN", "An editor role is required", request.id);
    }
    const { id, findingId } = DismissalParamsSchema.parse(request.params);
    const input = QuestionHealthRevisionApplyInputSchema.parse(request.body);
    const requestHash = applicationRequestHash(id, findingId, input);

    // Resolve a committed request before checking current findings or feature rollout. A retry
    // must not be rejected merely because its own accepted edit removed the original finding.
    const prior = await repository.getQuestionHealthApplication(
      creator.workspaceId,
      id,
      input.mutationId,
    );
    if (prior) {
      if (prior.requestHash !== requestHash) {
        return apiError(
          reply,
          409,
          "CONFLICT",
          "Mutation ID was reused for a different edit",
          request.id,
        );
      }
      const quiz = await repository.getQuiz(creator.workspaceId, id);
      if (!quiz) return apiError(reply, 404, "NOT_FOUND", "Round not found", request.id);
      reply.header("etag", `"draft-${quiz.draftRevision ?? 0}"`);
      return QuestionHealthRevisionAppliedSchema.parse({
        quiz,
        applicationId: prior.applicationId,
        appliedRevision: prior.appliedRevision,
        changes: prior.changes,
      });
    }
    if (
      !(await workspaceFeatureEnabled(repository, config, creator.workspaceId, "questionHealth"))
    ) {
      return apiError(reply, 404, "NOT_FOUND", "Question Health is not available", request.id);
    }
    const proposal = await proposedRevision(creator.workspaceId, id, findingId, input);
    if (proposal.status !== "ok") return proposalError(reply, proposal.status, request.id);
    if (
      requiresExtendedRoundResponses(proposal.proposal.draft) &&
      !(await workspaceFeatureEnabled(
        repository,
        config,
        creator.workspaceId,
        "roundClientProtocol",
      ))
    ) {
      return apiError(
        reply,
        404,
        "NOT_FOUND",
        EXTENDED_ROUND_RESPONSE_UNAVAILABLE_MESSAGE,
        request.id,
      );
    }
    const quiz = await repository.updateQuizDraft({
      workspaceId: creator.workspaceId,
      quizId: id,
      draft: proposal.proposal.draft,
      expectedRevision: input.draftRevision,
      mutationId: input.mutationId,
      editorId: creator.userId,
      schemaVersion: roundArtifactSchemaVersion(proposal.proposal.draft),
      draftHash: createHash("sha256").update(JSON.stringify(proposal.proposal.draft)).digest("hex"),
      questionHealthApplication: {
        workspaceId: creator.workspaceId,
        quizId: id,
        applicationId: input.mutationId,
        findingId,
        ruleVersion: input.ruleVersion,
        rulesetVersion: input.rulesetVersion,
        contentHash: input.contentHash,
        sourceRevision: input.draftRevision,
        requestHash,
        changes: proposal.proposal.changes,
        requestId: request.id,
      },
    });
    if (!quiz) return apiError(reply, 404, "NOT_FOUND", "Round not found", request.id);
    const application = await repository.getQuestionHealthApplication(
      creator.workspaceId,
      id,
      input.mutationId,
    );
    if (!application)
      throw new Error("Accepted Question Health edit has no application provenance");
    reply.header("etag", `"draft-${quiz.draftRevision ?? 0}"`);
    return QuestionHealthRevisionAppliedSchema.parse({
      quiz,
      applicationId: application.applicationId,
      appliedRevision: application.appliedRevision,
      changes: application.changes,
    });
  });

  app.post(
    "/v1/quizzes/:id/question-health/applications/:applicationId/undo",
    async (request, reply) => {
      reply.header("cache-control", "private, no-store").header("pragma", "no-cache");
      const creator = await auth.requireCreator(request, reply);
      if (!creator) return;
      if (creator.role === "viewer") {
        return apiError(reply, 403, "FORBIDDEN", "An editor role is required", request.id);
      }
      const { id, applicationId } = ApplicationParamsSchema.parse(request.params);
      const input = QuestionHealthRevisionUndoInputSchema.parse(request.body);
      const application = await repository.getQuestionHealthApplication(
        creator.workspaceId,
        id,
        applicationId,
      );
      if (!application) {
        return apiError(
          reply,
          404,
          "NOT_FOUND",
          "Question Health application not found",
          request.id,
        );
      }
      if (input.expectedRevision !== application.appliedRevision) {
        return apiError(
          reply,
          409,
          "CONFLICT",
          "Undo must target the applied revision",
          request.id,
        );
      }
      const restored = await repository.restoreQuizDraftHistory({
        workspaceId: creator.workspaceId,
        quizId: id,
        historyRevision: application.sourceRevision,
        expectedRevision: application.appliedRevision,
        mutationId: input.mutationId,
        editorId: creator.userId,
        questionHealthUndo: { applicationId, requestId: request.id },
      });
      if (!restored) {
        return apiError(
          reply,
          404,
          "NOT_FOUND",
          "The original draft snapshot is no longer available",
          request.id,
        );
      }
      // A receipt replay can return its historical snapshot even after another editor has saved
      // a newer draft. Never present that old state as the authoritative current Round.
      const quiz = await repository.getQuiz(creator.workspaceId, id);
      if (!quiz) return apiError(reply, 404, "NOT_FOUND", "Round not found", request.id);
      reply.header("etag", `"draft-${quiz.draftRevision ?? 0}"`);
      return QuestionHealthRevisionUndoneSchema.parse({ quiz, applicationId });
    },
  );
}
