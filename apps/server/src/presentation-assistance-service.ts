import { createHash } from "node:crypto";
import {
  CreatePresentationAssistanceJobSchema,
  InsertPresentationAssistanceProposalsSchema,
  PRESENTATION_ASSISTANCE_MAX_ACTIVE_JOBS,
  PresentationDraftSchema,
  presentationAssistanceProposalHash,
  type CreatePresentationAssistanceJob,
  type InsertPresentationAssistanceProposals,
  type PresentationBlockDraft,
  type PresentationAssistanceProposal,
  type PresentationSceneDesign,
} from "@openround/contracts";
import {
  createPresentationAssistanceRepository,
  type CreatorContext,
  type PresentationRepository,
  type Repository,
} from "@openround/db";

export class PresentationAssistanceServiceError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "PresentationAssistanceServiceError";
  }
}

function uuid(seed: string) {
  const hex = createHash("sha256").update(seed).digest("hex").slice(0, 32).split("");
  hex[12] = "5";
  hex[16] = (8 + (Number.parseInt(hex[16]!, 16) & 3)).toString(16);
  const value = hex.join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

export class PresentationAssistanceService {
  readonly jobs;
  constructor(
    private readonly repository: Repository,
    private readonly presentations: PresentationRepository,
    readonly enabled: boolean,
    private readonly featureEnabled: (workspaceId: string) => Promise<boolean>,
  ) {
    this.jobs = createPresentationAssistanceRepository(repository);
  }

  private context(actor: CreatorContext, presentationId: string, now?: Date) {
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
      throw new PresentationAssistanceServiceError(
        "UNAUTHORIZED",
        403,
        "An owner or editor is required for presentation assistance",
      );
    if (
      (await this.repository.workspaceDeletionStarted(actor.workspaceId)) ||
      !(await this.featureEnabled(actor.workspaceId))
    )
      throw new PresentationAssistanceServiceError("NOT_FOUND", 404, "Presentation not found");
    const presentation = await this.presentations.getPresentation(
      actor.workspaceId,
      presentationId.toLowerCase(),
    );
    if (!presentation)
      throw new PresentationAssistanceServiceError("NOT_FOUND", 404, "Presentation not found");
    if (presentation.status === "archived")
      throw new PresentationAssistanceServiceError(
        "CONFLICT",
        409,
        "Restore this presentation before using assistance",
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
      maxActiveJobs: PRESENTATION_ASSISTANCE_MAX_ACTIVE_JOBS,
      minimumSlides: 3,
      maximumSlides: 8,
    };
  }

  async create(
    actor: CreatorContext,
    value: CreatePresentationAssistanceJob,
    monthlyLimit: number | null,
    now = new Date(),
  ) {
    const request = CreatePresentationAssistanceJobSchema.parse(value);
    await this.authorize(actor, request.presentationId);
    const context = this.context(actor, request.presentationId, now);
    const prior = await this.jobs.get({ ...context, jobId: request.requestId });
    if (!this.enabled && !prior)
      throw new PresentationAssistanceServiceError(
        "AUTHORING_DISABLED",
        503,
        "Presentation assistance is not configured on this deployment",
      );
    return this.jobs.create({
      ...context,
      request,
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
      throw new PresentationAssistanceServiceError(
        "NOT_FOUND",
        404,
        "Presentation assistance job not found or expired",
      );
    return job;
  }

  async list(actor: CreatorContext, presentationId: string) {
    await this.authorize(actor, presentationId);
    return this.jobs.list(this.context(actor, presentationId));
  }

  private blocks(
    proposal: PresentationAssistanceProposal,
    selectedIds: string[],
    mutationId: string,
    design: PresentationSceneDesign | undefined,
  ): PresentationBlockDraft[] {
    if (selectedIds.some((id) => !proposal.slides.some((slide) => slide.id === id)))
      throw new PresentationAssistanceServiceError(
        "VALIDATION_ERROR",
        422,
        "Select slides from this reviewed proposal",
      );
    return proposal.slides
      .filter((slide) => selectedIds.includes(slide.id))
      .map((slide): PresentationBlockDraft => {
        const id = uuid(`${mutationId}:assistance:${slide.id}`);
        return {
          id,
          kind: "content",
          layout: "title_body",
          textElements: [],
          mediaId: null,
          mediaAlt: null,
          speakerNotes: "",
          citations: slide.citations,
          sourceDisclosure: {
            sourceName: proposal.sourceName,
            sourceDigest: proposal.sourceDigest,
            provider: proposal.provider,
            model: proposal.model,
            conversionNotes: [proposal.reviewWarning],
          },
          scene: {
            schemaVersion: 6,
            aspectRatio: "16:9",
            ...(design ? { design } : {}),
            nodes: [
              {
                id: `${id}:title`,
                type: "text",
                role: "title",
                text: slide.title,
                frame: { x: 7, y: 8, width: 86, height: 18 },
              },
              {
                id: `${id}:body`,
                type: "text",
                role: "body",
                text: slide.body,
                frame: { x: 7, y: 31, width: 86, height: 59 },
              },
            ],
            readingOrder: [`${id}:title`, `${id}:body`],
          },
        };
      });
  }

  async insert(
    actor: CreatorContext,
    presentationId: string,
    value: InsertPresentationAssistanceProposals,
  ) {
    const input = InsertPresentationAssistanceProposalsSchema.parse(value);
    presentationId = presentationId.toLowerCase();
    const current = await this.authorize(actor, presentationId);
    const draftHash = createHash("sha256")
      .update(
        JSON.stringify({
          kind: "presentation-assistance-insert",
          actorId: actor.userId,
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
    const insertedBlockIds = input.selectedSlideIds.map((id) =>
      uuid(`${input.mutationId}:assistance:${id}`),
    );
    if (receipt)
      return {
        presentation: {
          ...receipt,
          hasUnpublishedChanges:
            receipt.currentVersionId === null ||
            receipt.publishedDraftRevision !== receipt.draftRevision,
        },
        insertedBlockIds: receipt.draft.blocks
          .filter((block) => insertedBlockIds.includes(block.id))
          .map((block) => block.id),
      };
    const job = await this.jobs.get({ ...this.context(actor, presentationId), jobId: input.jobId });
    if (!job || job.status !== "ready" || !job.proposal || !job.proposalHash)
      throw new PresentationAssistanceServiceError(
        "CONFLICT",
        409,
        "This proposal is not ready or has expired",
      );
    if (
      job.proposalHash !== input.proposalHash ||
      presentationAssistanceProposalHash(job.proposal) !== input.proposalHash
    )
      throw new PresentationAssistanceServiceError(
        "CONFLICT",
        409,
        "The complete proposal changed. Review it again before inserting",
      );
    const design = current.draft.blocks.find(
      (block) => block.kind === "content" && block.scene?.design,
    );
    const inserted = this.blocks(
      job.proposal,
      input.selectedSlideIds,
      input.mutationId,
      design?.kind === "content" ? design.scene?.design : undefined,
    );
    const blocks = [...current.draft.blocks];
    const anchor =
      input.afterBlockId === null
        ? blocks.length - 1
        : blocks.findIndex((block) => block.id === input.afterBlockId);
    if (input.afterBlockId !== null && anchor < 0)
      throw new PresentationAssistanceServiceError(
        "VALIDATION_ERROR",
        422,
        "Choose an insertion point in this presentation",
      );
    const starter = blocks[0];
    const replaceEmpty =
      blocks.length === 1 &&
      starter?.kind === "content" &&
      !starter.scene &&
      !starter.hidden &&
      !starter.mediaId &&
      !starter.speakerNotes &&
      !starter.sourceDisclosure &&
      !starter.citations?.length &&
      !starter.textElements.some((element) => element.text.trim());
    if (blocks.length + inserted.length - (replaceEmpty ? 1 : 0) > 200)
      throw new PresentationAssistanceServiceError(
        "VALIDATION_ERROR",
        422,
        "The presentation would exceed its 200-slide limit",
      );
    let sections = current.draft.sections,
      spatial = current.draft.spatial;
    if (replaceEmpty) {
      blocks.splice(0, 1, ...inserted);
      sections = sections?.map((section) => ({
        ...section,
        blockIds: section.blockIds.flatMap((id) =>
          id === starter.id ? inserted.map((block) => block.id) : [id],
        ),
      }));
      if (spatial)
        spatial = {
          ...spatial,
          frames: spatial.frames.map((frame) =>
            frame.blockId === starter.id ? { ...frame, blockId: inserted[0]!.id } : frame,
          ),
        };
    } else blocks.splice(anchor + 1, 0, ...inserted);
    const draft = PresentationDraftSchema.parse({
      ...current.draft,
      schemaVersion: Math.max(13, current.draft.schemaVersion),
      blocks,
      ...(sections ? { sections } : {}),
      ...(spatial ? { spatial } : {}),
    });
    // Recheck current permissions after reading the reviewed output, before committing a draft.
    await this.authorize(actor, presentationId);
    const updated = await this.presentations.updatePresentationDraft({
      workspaceId: actor.workspaceId,
      presentationId,
      draft,
      expectedRevision: input.expectedRevision,
      mutationId: input.mutationId,
      editorId: actor.userId,
      draftHash,
      assistanceJobId: job.id,
      assistanceProposalHash: input.proposalHash,
    });
    if (!updated)
      throw new PresentationAssistanceServiceError("NOT_FOUND", 404, "Presentation not found");
    return {
      presentation: {
        ...updated,
        hasUnpublishedChanges:
          updated.currentVersionId === null ||
          updated.publishedDraftRevision !== updated.draftRevision,
      },
      insertedBlockIds: inserted.map((block) => block.id),
    };
  }
}
