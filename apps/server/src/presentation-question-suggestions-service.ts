import { createHash } from "node:crypto";
import {
  InsertPresentationQuestionSuggestionSchema,
  CreatePresentationQuestionSuggestionsJobSchema,
  PRESENTATION_QUESTION_SUGGESTIONS_MAX_ACTIVE_JOBS,
  presentationQuestionSuggestionsProposalHash,
  presentationQuestionSuggestionSource,
  presentationQuestionSuggestionInsertionIds,
  type InsertPresentationQuestionSuggestion,
  type CreatePresentationQuestionSuggestionsJob,
  type PresentationDraft,
} from "@openround/contracts";
import {
  createPresentationQuestionSuggestionsRepository,
  assertPresentationQuestionSuggestionsSource,
  buildPresentationQuestionSuggestionsDraft,
  type CreatorContext,
  type PresentationRecord,
  type PresentationRepository,
  type Repository,
} from "@openround/db";

export class PresentationQuestionSuggestionsServiceError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "PresentationQuestionSuggestionsServiceError";
  }
}

export class PresentationQuestionSuggestionsService {
  readonly jobs;
  constructor(
    private readonly repository: Repository,
    private readonly presentations: PresentationRepository,
    readonly enabled: boolean,
    private readonly featureEnabled: (workspaceId: string) => Promise<boolean>,
  ) {
    this.jobs = createPresentationQuestionSuggestionsRepository(repository);
  }

  private context(
    actor: Pick<CreatorContext, "userId" | "workspaceId">,
    presentationId: string,
    now?: Date,
  ) {
    return {
      workspaceId: actor.workspaceId,
      presentationId: presentationId.toLowerCase(),
      actorId: actor.userId,
      ...(now ? { now } : {}),
    };
  }

  async authorize(actor: Pick<CreatorContext, "userId" | "workspaceId">, presentationId: string) {
    const current = await this.repository.getCreatorByUserId(actor.userId, actor.workspaceId);
    if (!current || !["owner", "editor"].includes(current.role))
      throw new PresentationQuestionSuggestionsServiceError(
        "UNAUTHORIZED",
        403,
        "An owner or editor is required for question suggestions",
      );
    if (
      (await this.repository.workspaceDeletionStarted(actor.workspaceId)) ||
      !(await this.featureEnabled(actor.workspaceId))
    )
      throw new PresentationQuestionSuggestionsServiceError(
        "NOT_FOUND",
        404,
        "Presentation not found",
      );
    const presentation = await this.presentations.getPresentation(
      actor.workspaceId,
      presentationId.toLowerCase(),
    );
    if (!presentation)
      throw new PresentationQuestionSuggestionsServiceError(
        "NOT_FOUND",
        404,
        "Presentation not found",
      );
    if (presentation.status === "archived")
      throw new PresentationQuestionSuggestionsServiceError(
        "CONFLICT",
        409,
        "Restore this presentation before using question suggestions",
      );
    return presentation;
  }

  async status(
    actor: CreatorContext,
    presentationId: string,
    monthlyLimit: number | null,
    now = new Date(),
  ) {
    await this.authorize(actor, presentationId);
    const since = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const usage = await this.jobs.usage({ ...this.context(actor, presentationId, now), since });
    return {
      enabled: this.enabled,
      monthlyLimit,
      used: usage.used,
      remaining: monthlyLimit === null ? null : Math.max(0, monthlyLimit - usage.used),
      active: usage.active,
      maxActiveJobs: PRESENTATION_QUESTION_SUGGESTIONS_MAX_ACTIVE_JOBS,
    };
  }

  async create(
    actor: CreatorContext,
    value: CreatePresentationQuestionSuggestionsJob,
    monthlyLimit: number | null,
    now = new Date(),
  ) {
    const request = CreatePresentationQuestionSuggestionsJobSchema.parse(value);
    const current = await this.authorize(actor, request.presentationId);
    const context = this.context(actor, request.presentationId, now);
    const prior = await this.jobs.get({ ...context, jobId: request.requestId });
    if (!this.enabled && !prior)
      throw new PresentationQuestionSuggestionsServiceError(
        "AUTHORING_DISABLED",
        503,
        "Presentation question suggestions is not configured on this deployment",
      );
    // Exact admitted retries remain recoverable after the selected object changes or is removed.
    // The repository compares the canonical request before validating new source input under lock.
    const source = prior ? null : this.source(current.draft, request.blockId);
    return this.jobs.create({
      ...context,
      request,
      source,
      monthlyLimit,
      since: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)),
    });
  }

  private source(draft: PresentationDraft, blockId: string) {
    const block = draft.blocks.find(
      (candidate) => candidate.id.toLowerCase() === blockId.toLowerCase(),
    );
    const result = block ? presentationQuestionSuggestionSource(block) : null;
    if (!result?.supported)
      throw new PresentationQuestionSuggestionsServiceError(
        "VALIDATION_ERROR",
        422,
        "Choose a visible native slide with a nonblank title and body text",
      );
    return result.source;
  }

  async authorizeSource(
    actor: Pick<CreatorContext, "userId" | "workspaceId">,
    presentationId: string,
    blockId: string,
    sourceDigest: string,
  ) {
    const current = await this.authorize(actor, presentationId);
    return assertPresentationQuestionSuggestionsSource(current.draft, blockId, sourceDigest);
  }

  async get(actor: CreatorContext, presentationId: string, jobId: string) {
    await this.authorize(actor, presentationId);
    const job = await this.jobs.get({
      ...this.context(actor, presentationId),
      jobId: jobId.toLowerCase(),
    });
    if (!job)
      throw new PresentationQuestionSuggestionsServiceError(
        "NOT_FOUND",
        404,
        "Text assistance job not found or expired",
      );
    return job;
  }

  async list(actor: CreatorContext, presentationId: string) {
    await this.authorize(actor, presentationId);
    return this.jobs.list(this.context(actor, presentationId));
  }

  private identities(input: InsertPresentationQuestionSuggestion) {
    const ids = presentationQuestionSuggestionInsertionIds({
      jobId: input.jobId,
      suggestionId: input.suggestionId,
      mutationId: input.mutationId,
    });
    return { insertedBlockId: ids.blockId, insertedQuestionId: ids.questionId };
  }

  private result(presentation: PresentationRecord, input: InsertPresentationQuestionSuggestion) {
    const ids = this.identities(input);
    const block = presentation.draft.blocks.find(
      (candidate) => candidate.id === ids.insertedBlockId,
    );
    if (block?.kind !== "question" || block.question.id !== ids.insertedQuestionId)
      throw new PresentationQuestionSuggestionsServiceError(
        "CONFLICT",
        409,
        "This reviewed insertion could not be recovered",
      );
    return {
      presentation: {
        ...presentation,
        hasUnpublishedChanges:
          presentation.currentVersionId === null ||
          presentation.publishedDraftRevision !== presentation.draftRevision,
      },
      ...ids,
      jobId: input.jobId,
      proposalHash: input.proposalHash,
      suggestionId: input.suggestionId,
      sourceDigest: input.sourceDigest,
      sourceBlockId: input.blockId,
    };
  }

  async insert(
    actor: CreatorContext,
    presentationId: string,
    value: InsertPresentationQuestionSuggestion,
  ) {
    const input = InsertPresentationQuestionSuggestionSchema.parse(value);
    presentationId = presentationId.toLowerCase();
    const current = await this.authorize(actor, presentationId);
    const draftHash = createHash("sha256")
      .update(
        JSON.stringify({
          kind: "presentation-question-suggestions-insert",
          actorId: actor.userId.toLowerCase(),
          presentationId,
          ...input,
        }),
      )
      .digest("hex");
    const receipt = await this.presentations.recoverPresentationDraftMutation({
      workspaceId: actor.workspaceId,
      presentationId,
      expectedRevision: input.expectedRevision,
      mutationId: input.mutationId,
      draftHash,
    });
    if (receipt) return this.result(receipt, input);
    const job = await this.jobs.get({ ...this.context(actor, presentationId), jobId: input.jobId });
    if (
      !job ||
      job.status !== "ready" ||
      !job.proposal ||
      !job.proposalHash ||
      job.proposalHash !== input.proposalHash ||
      presentationQuestionSuggestionsProposalHash(job.proposal) !== input.proposalHash ||
      job.blockId !== input.blockId ||
      job.sourceDigest !== input.sourceDigest
    )
      throw new PresentationQuestionSuggestionsServiceError(
        "CONFLICT",
        409,
        "This reviewed proposal is no longer ready to insert",
      );
    const suggestion = job.proposal.suggestions.find(
      (candidate) => candidate.id === input.suggestionId,
    );
    if (!suggestion)
      throw new PresentationQuestionSuggestionsServiceError(
        "CONFLICT",
        409,
        "Review the complete proposal before choosing one question",
      );
    assertPresentationQuestionSuggestionsSource(
      current.draft,
      input.blockId,
      input.sourceDigest,
      job.proposal.source,
    );
    if (current.draft.blocks.length >= 200)
      throw new PresentationQuestionSuggestionsServiceError(
        "VALIDATION_ERROR",
        422,
        "A presentation supports at most 200 slides and activities",
      );
    const ids = this.identities(input);
    const existing = new Set(
      current.draft.blocks
        .flatMap((block) => [
          block.id,
          ...(block.kind === "question"
            ? [
                block.question.id,
                ...("choices" in block.question
                  ? block.question.choices.map((choice) => choice.id)
                  : []),
              ]
            : []),
        ])
        .map((id) => id.toLowerCase()),
    );
    if (existing.has(ids.insertedBlockId) || existing.has(ids.insertedQuestionId))
      throw new PresentationQuestionSuggestionsServiceError(
        "CONFLICT",
        409,
        "This insertion identity is already in use",
      );
    const draft = buildPresentationQuestionSuggestionsDraft({
      draft: current.draft,
      proposal: job.proposal,
      jobId: job.id,
      suggestionId: input.suggestionId,
      mutationId: input.mutationId,
    });
    await this.authorize(actor, presentationId);
    const updated = await this.presentations.updatePresentationDraft({
      workspaceId: actor.workspaceId,
      presentationId,
      draft,
      expectedRevision: input.expectedRevision,
      mutationId: input.mutationId,
      editorId: actor.userId,
      draftHash,
      questionSuggestionsJobId: input.jobId,
      questionSuggestionsProposalHash: input.proposalHash,
      questionSuggestionsSourceDigest: input.sourceDigest,
      questionSuggestionsBlockId: input.blockId,
      questionSuggestionsSuggestionId: input.suggestionId,
    });
    if (!updated)
      throw new PresentationQuestionSuggestionsServiceError(
        "NOT_FOUND",
        404,
        "Presentation not found",
      );
    return this.result(updated, input);
  }
}
