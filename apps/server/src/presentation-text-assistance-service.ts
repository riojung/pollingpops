import { createHash } from "node:crypto";
import {
  ApplyPresentationTextAssistanceSchema,
  CreatePresentationTextAssistanceJobSchema,
  PRESENTATION_TEXT_ASSISTANCE_MAX_ACTIVE_JOBS,
  PresentationDraftSchema,
  presentationTextAssistanceProposalHash,
  presentationTextAssistanceSourceDigest,
  type ApplyPresentationTextAssistance,
  type CreatePresentationTextAssistanceJob,
  type PresentationDraft,
} from "@openround/contracts";
import {
  createPresentationTextAssistanceRepository,
  type CreatorContext,
  type PresentationRecord,
  type PresentationRepository,
  type Repository,
} from "@openround/db";

export class PresentationTextAssistanceServiceError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "PresentationTextAssistanceServiceError";
  }
}

/** Node IDs are arbitrary and case-sensitive, unlike presentation and block UUIDs. */
export function selectedPresentationPlainText(
  draft: PresentationDraft,
  blockId: string,
  nodeId: string,
) {
  const block = draft.blocks.find(
    (candidate) => candidate.id.toLowerCase() === blockId.toLowerCase(),
  );
  const node =
    block?.kind === "content"
      ? block.scene?.nodes.find((candidate) => candidate.id === nodeId)
      : undefined;
  if (
    !node ||
    node.type !== "text" ||
    node.richText !== undefined ||
    !node.text.trim() ||
    node.text.length > (node.role === "title" ? 160 : 4_000)
  )
    throw new PresentationTextAssistanceServiceError(
      "VALIDATION_ERROR",
      422,
      "Select one nonblank plain native title or body text object",
    );
  return node;
}

export class PresentationTextAssistanceService {
  readonly jobs;
  constructor(
    private readonly repository: Repository,
    private readonly presentations: PresentationRepository,
    readonly enabled: boolean,
    private readonly featureEnabled: (workspaceId: string) => Promise<boolean>,
  ) {
    this.jobs = createPresentationTextAssistanceRepository(repository);
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
      throw new PresentationTextAssistanceServiceError(
        "UNAUTHORIZED",
        403,
        "An owner or editor is required for text assistance",
      );
    if (
      (await this.repository.workspaceDeletionStarted(actor.workspaceId)) ||
      !(await this.featureEnabled(actor.workspaceId))
    )
      throw new PresentationTextAssistanceServiceError("NOT_FOUND", 404, "Presentation not found");
    const presentation = await this.presentations.getPresentation(
      actor.workspaceId,
      presentationId.toLowerCase(),
    );
    if (!presentation)
      throw new PresentationTextAssistanceServiceError("NOT_FOUND", 404, "Presentation not found");
    if (presentation.status === "archived")
      throw new PresentationTextAssistanceServiceError(
        "CONFLICT",
        409,
        "Restore this presentation before using text assistance",
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
      maxActiveJobs: PRESENTATION_TEXT_ASSISTANCE_MAX_ACTIVE_JOBS,
    };
  }

  async create(
    actor: CreatorContext,
    value: CreatePresentationTextAssistanceJob,
    monthlyLimit: number | null,
    now = new Date(),
  ) {
    const request = CreatePresentationTextAssistanceJobSchema.parse(value);
    const current = await this.authorize(actor, request.presentationId);
    const context = this.context(actor, request.presentationId, now);
    const prior = await this.jobs.get({ ...context, jobId: request.requestId });
    if (!this.enabled && !prior)
      throw new PresentationTextAssistanceServiceError(
        "AUTHORING_DISABLED",
        503,
        "Presentation text assistance is not configured on this deployment",
      );
    // Exact admitted retries remain recoverable after the selected object changes or is removed.
    // The repository compares the canonical request before validating new source input under lock.
    const target = prior
      ? null
      : selectedPresentationPlainText(current.draft, request.blockId, request.nodeId);
    return this.jobs.create({
      ...context,
      request,
      originalText: target?.text ?? "",
      role: target?.role ?? prior!.role,
      monthlyLimit,
      since: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)),
    });
  }

  async get(actor: CreatorContext, presentationId: string, jobId: string) {
    await this.authorize(actor, presentationId);
    const job = await this.jobs.get({
      ...this.context(actor, presentationId),
      jobId: jobId.toLowerCase(),
    });
    if (!job)
      throw new PresentationTextAssistanceServiceError(
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

  private result(presentation: PresentationRecord, input: ApplyPresentationTextAssistance) {
    const block = presentation.draft.blocks.find(
      (candidate) => candidate.id.toLowerCase() === input.blockId,
    );
    const metadata = block?.kind === "content" ? block.textAssistance : undefined;
    if (
      !metadata ||
      metadata.nodeId !== input.nodeId ||
      metadata.sourceDigest !== input.sourceDigest ||
      metadata.targetLanguage !== input.targetLanguage ||
      metadata.sourceLanguage !== input.sourceLanguage
    )
      throw new PresentationTextAssistanceServiceError(
        "CONFLICT",
        409,
        "This reviewed edit could not be recovered",
      );
    return {
      presentation: {
        ...presentation,
        hasUnpublishedChanges:
          presentation.currentVersionId === null ||
          presentation.publishedDraftRevision !== presentation.draftRevision,
      },
      jobId: input.jobId,
      blockId: input.blockId,
      nodeId: input.nodeId,
      proposalHash: input.proposalHash,
      sourceDigest: input.sourceDigest,
      outputDigest: metadata.outputDigest,
      ...(metadata.operation === "translate"
        ? { targetLanguage: metadata.targetLanguage, sourceLanguage: metadata.sourceLanguage }
        : {}),
    };
  }

  async apply(
    actor: CreatorContext,
    presentationId: string,
    value: ApplyPresentationTextAssistance,
  ) {
    const input = ApplyPresentationTextAssistanceSchema.parse(value);
    presentationId = presentationId.toLowerCase();
    const current = await this.authorize(actor, presentationId);
    const draftHash = createHash("sha256")
      .update(
        JSON.stringify({
          kind: "presentation-text-assistance-apply",
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
    if (!job || job.status !== "ready" || !job.proposal || !job.proposalHash)
      throw new PresentationTextAssistanceServiceError(
        "CONFLICT",
        409,
        "This text proposal is not ready or has expired",
      );
    const proposal = job.proposal;
    if (
      job.proposalHash !== input.proposalHash ||
      presentationTextAssistanceProposalHash(proposal) !== input.proposalHash ||
      job.blockId !== input.blockId ||
      job.nodeId !== input.nodeId ||
      job.sourceDigest !== input.sourceDigest ||
      proposal.blockId !== input.blockId ||
      proposal.nodeId !== input.nodeId ||
      proposal.sourceDigest !== input.sourceDigest ||
      proposal.targetLanguage !== input.targetLanguage ||
      proposal.sourceLanguage !== input.sourceLanguage ||
      job.targetLanguage !== input.targetLanguage ||
      job.sourceLanguage !== input.sourceLanguage
    )
      throw new PresentationTextAssistanceServiceError(
        "CONFLICT",
        409,
        "The complete text proposal changed. Review it again before applying",
      );
    let target;
    try {
      target = selectedPresentationPlainText(current.draft, input.blockId, input.nodeId);
    } catch (error) {
      if (!(error instanceof PresentationTextAssistanceServiceError)) throw error;
      throw new PresentationTextAssistanceServiceError(
        "CONFLICT",
        409,
        "The selected text changed. Generate and review a new proposal",
      );
    }
    if (
      target.role !== proposal.role ||
      target.text !== proposal.originalText ||
      presentationTextAssistanceSourceDigest(target.text) !== input.sourceDigest ||
      (proposal.operation === "translate" && (target.lang ?? null) !== proposal.sourceLanguage)
    )
      throw new PresentationTextAssistanceServiceError(
        "CONFLICT",
        409,
        "The selected text changed. Generate and review a new proposal",
      );
    const draft = structuredClone(current.draft);
    const block = draft.blocks.find((candidate) => candidate.id.toLowerCase() === input.blockId);
    if (!block || block.kind !== "content" || !block.scene)
      throw new PresentationTextAssistanceServiceError(
        "CONFLICT",
        409,
        "The selected text is no longer available",
      );
    const node = block.scene.nodes.find((candidate) => candidate.id === input.nodeId);
    if (!node || node.type !== "text")
      throw new PresentationTextAssistanceServiceError(
        "CONFLICT",
        409,
        "The selected text is no longer available",
      );
    node.text = proposal.text;
    if (proposal.operation === "translate") {
      node.lang = proposal.targetLanguage!;
      block.scene.schemaVersion = 7;
    }
    block.textAssistance = {
      schemaVersion: 1,
      nodeId: input.nodeId,
      role: proposal.role,
      operation: proposal.operation,
      sourceDigest: proposal.sourceDigest,
      outputDigest: proposal.outputDigest,
      provider: proposal.provider,
      model: proposal.model,
      generatedAt: proposal.generatedAt,
      reviewWarning: proposal.reviewWarning,
      ...(proposal.operation === "translate"
        ? { targetLanguage: proposal.targetLanguage, sourceLanguage: proposal.sourceLanguage }
        : {}),
    };
    const validated = PresentationDraftSchema.parse({
      ...draft,
      schemaVersion: Math.max(proposal.operation === "translate" ? 16 : 15, draft.schemaVersion),
    });
    await this.authorize(actor, presentationId);
    const updated = await this.presentations.updatePresentationDraft({
      workspaceId: actor.workspaceId,
      presentationId,
      draft: validated,
      expectedRevision: input.expectedRevision,
      mutationId: input.mutationId,
      editorId: actor.userId,
      draftHash,
      textAssistanceJobId: job.id,
      textAssistanceProposalHash: input.proposalHash,
      textAssistanceSourceDigest: input.sourceDigest,
      textAssistanceBlockId: input.blockId,
      textAssistanceNodeId: input.nodeId,
      ...(proposal.operation === "translate"
        ? {
            textAssistanceTargetLanguage: input.targetLanguage,
            textAssistanceSourceLanguage: input.sourceLanguage,
          }
        : {}),
    });
    if (!updated)
      throw new PresentationTextAssistanceServiceError("NOT_FOUND", 404, "Presentation not found");
    return this.result(updated, input);
  }
}
