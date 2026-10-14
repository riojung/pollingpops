import { createHash, randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import {
  ApplyPresentationAuthoringJobSchema,
  CopyRoundQuestionsToPresentationSchema,
  CreatePresentationSchema,
  InsertAuthoringProposalsIntoPresentationSchema,
  PresentationContentSchema,
  PresentationDraftSchema,
  PresentationDraftMutationSchema,
  PublishPresentationSchema,
  type AuthoringDraft,
  type ContentSlideRegion,
  type PresentationBlockDraft,
  type PresentationDraft,
  type QuestionDraft,
} from "@openround/contracts";
import {
  PresentationArchivedError,
  PresentationDraftConflictError,
  PresentationMutationConflictError,
  type CreatorContext,
  type PresentationRecord,
  type PresentationRepository,
  type PresentationSummaryRecord,
  type Repository,
} from "@openround/db";
import type { AuthService } from "./auth.js";
import type { ProductEventDispatcher } from "./product-events.js";
import { professionalFeatureUnavailable } from "./workspace-rollout.js";

const IdParamsSchema = z.object({ id: z.string().uuid() });
const HistoryParamsSchema = z.object({
  id: z.string().uuid(),
  revision: z.coerce.number().int().nonnegative(),
});
const PresentationListQuerySchema = z.object({
  archived: z.enum(["true", "false"]).optional(),
});
const RestoreHistorySchema = z.object({
  expectedRevision: z.number().int().nonnegative(),
  mutationId: z.string().uuid(),
});
const ApplySourceJobParamsSchema = z.object({ jobId: z.string().uuid() });

function apiError(
  reply: FastifyReply,
  status: number,
  code: string,
  message: string,
  requestId: string,
) {
  return reply.code(status).send({ error: { code, message, requestId } });
}

function initialTextElements(id: string, layout: string, title: string, body: string) {
  const titleRegion: ContentSlideRegion =
    layout === "title" || layout === "quote" || layout === "section"
      ? "middle_center"
      : layout === "title_body"
        ? "middle_center"
        : "top_center";
  const bodyRegion: ContentSlideRegion =
    layout === "quote" || layout === "section" || layout === "title"
      ? "bottom_center"
      : "middle_center";
  return [
    { id: `${id}:title`, role: "title" as const, text: title, region: titleRegion, order: 0 },
    {
      id: `${id}:body`,
      role: "body" as const,
      text: body,
      region: bodyRegion,
      order: titleRegion === bodyRegion ? 1 : 0,
    },
  ];
}

interface PresentationPublishIssue {
  artifactType: "presentation";
  artifactId: string;
  blockId: string | null;
  questionId?: string;
  field: string;
  path: string;
  message: string;
}

function presentationPublishIssue(
  presentationId: string,
  draft: PresentationDraft,
  path: readonly PropertyKey[],
  message: string,
): PresentationPublishIssue {
  const blockIndex = path[0] === "blocks" && typeof path[1] === "number" ? path[1] : -1;
  const block = blockIndex >= 0 ? draft.blocks[blockIndex] : undefined;
  const field = [...path].reverse().find((part) => typeof part === "string");
  return {
    artifactType: "presentation",
    artifactId: presentationId,
    blockId: block?.id ?? null,
    ...(block?.kind === "question" ? { questionId: block.question.id } : {}),
    field: typeof field === "string" ? field : "artifact",
    path: path.map(String).join("."),
    message,
  };
}

function publishValidationError(
  reply: FastifyReply,
  requestId: string,
  issues: PresentationPublishIssue[],
) {
  return reply.code(422).send({
    error: {
      code: "VALIDATION_ERROR",
      message: "This presentation has publish blockers. Review every issue and try again.",
      requestId,
      details: { issues },
    },
    validation: { issues },
  });
}

function requireEditor(creator: CreatorContext, reply: FastifyReply, requestId: string) {
  return creator.role === "owner" || creator.role === "editor"
    ? true
    : apiError(
        reply,
        403,
        "UNAUTHORIZED",
        "Your workspace role does not allow this action",
        requestId,
      );
}

function presentationView(presentation: PresentationRecord) {
  return {
    ...presentation,
    hasUnpublishedChanges:
      presentation.currentVersionId === null ||
      presentation.publishedDraftRevision !== presentation.draftRevision,
  };
}

function presentationSummaryView(presentation: PresentationSummaryRecord) {
  return {
    ...presentation,
    hasUnpublishedChanges:
      presentation.currentVersionId === null ||
      presentation.publishedDraftRevision !== presentation.draftRevision,
  };
}

function conflict(
  reply: FastifyReply,
  requestId: string,
  presentationId: string,
  error: PresentationDraftConflictError,
) {
  return reply.code(409).send({
    error: {
      code: "STALE_DRAFT",
      message: "This presentation changed since you opened it. Reload before saving or publishing.",
      requestId,
      details: {
        presentationId,
        expectedDraftRevision: error.expectedRevision,
        currentDraftRevision: error.currentRevision,
        currentEditorId: error.currentEditorId,
      },
    },
  });
}

function mutationConflict(
  reply: FastifyReply,
  requestId: string,
  presentationId: string,
  error: PresentationMutationConflictError,
) {
  return reply.code(409).send({
    error: {
      code: "CONFLICT",
      message: "This mutation ID was already used for another presentation change.",
      requestId,
      details: { presentationId, mutationId: error.mutationId },
    },
  });
}

function archivedConflict(reply: FastifyReply, requestId: string) {
  return apiError(
    reply,
    409,
    "CONFLICT",
    "Restore this presentation before publishing it.",
    requestId,
  );
}

function deterministicUuid(seed: string) {
  const characters = createHash("sha256").update(seed).digest("hex").slice(0, 32).split("");
  characters[12] = "5";
  characters[16] = (8 + (Number.parseInt(characters[16]!, 16) & 3)).toString(16);
  const value = characters.join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

function jsonHash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function freshQuestionCopy(
  source: QuestionDraft,
  questionIdMap: Map<string, string>,
  mutationId: string,
): QuestionDraft {
  const copied = structuredClone(source);
  copied.id = questionIdMap.get(source.id) ?? randomUUID();
  copied.linkedRecheckQuestionId = source.linkedRecheckQuestionId
    ? (questionIdMap.get(source.linkedRecheckQuestionId) ?? null)
    : null;
  if ("choices" in copied) {
    copied.choices = copied.choices.map((choice) => ({
      ...choice,
      id: deterministicUuid(`${mutationId}:choice:${source.id}:${choice.id}`),
    }));
  }
  return copied;
}

type AuthoringProposalSelection = {
  selectedContentSlideIds?: string[];
  selectedQuestionIds?: string[];
};

type SelectedSourceProposals = {
  contentSlides: NonNullable<AuthoringDraft["contentSlideProposals"]>;
  questions: QuestionDraft[];
};

function sourceDisclosure(output: AuthoringDraft) {
  return {
    sourceName: output.sourceName,
    sourceDigest: output.sourceDigest,
    provider: output.provider,
    model: output.model,
    conversionNotes: output.conversionNotes,
  };
}

function selectedSourceProposals(
  output: AuthoringDraft,
  input: AuthoringProposalSelection,
): SelectedSourceProposals | { error: string } {
  const proposals = output.contentSlideProposals ?? [];
  const proposalById = new Map(proposals.map((proposal) => [proposal.id, proposal]));
  const questions = output.checkpointSet.questions;
  const questionById = new Map(questions.map((question) => [question.id, question]));
  const requestedContentIds = input.selectedContentSlideIds ?? proposals.map(({ id }) => id);
  const requestedQuestionIds =
    input.selectedQuestionIds ?? questions.map((question) => question.id);
  const unknownContentId = requestedContentIds.find((id) => !proposalById.has(id));
  if (unknownContentId) {
    return {
      error: "One or more selected content slides are not in this source proposal",
    };
  }
  const unknownQuestionId = requestedQuestionIds.find((id) => !questionById.has(id));
  if (unknownQuestionId) {
    return { error: "One or more selected questions are not in this source proposal" };
  }

  // A Recovery pair is one reviewable unit. Expanding either half preserves a complete topology
  // while still allowing a facilitator to select content-only proposals.
  const selectedQuestionIds = new Set(requestedQuestionIds);
  for (const question of questions) {
    if (selectedQuestionIds.has(question.id) && question.linkedRecheckQuestionId) {
      selectedQuestionIds.add(question.linkedRecheckQuestionId);
    }
    if (
      question.linkedRecheckQuestionId &&
      selectedQuestionIds.has(question.linkedRecheckQuestionId)
    ) {
      selectedQuestionIds.add(question.id);
    }
  }

  return {
    contentSlides: proposals.filter((proposal) => requestedContentIds.includes(proposal.id)),
    questions: questions.filter((question) => selectedQuestionIds.has(question.id)),
  };
}

function sourceProposalBlocks(
  output: AuthoringDraft,
  selection: SelectedSourceProposals,
  mutationId: string,
  deterministic: boolean,
): PresentationBlockDraft[] {
  const disclosure = sourceDisclosure(output);
  const blockId = (kind: string, sourceId: string) =>
    deterministic
      ? deterministicUuid(`${mutationId}:source-block:${kind}:${sourceId}`)
      : randomUUID();
  const contentBlocks: PresentationBlockDraft[] = selection.contentSlides.map((proposal) => {
    const id = blockId("content", proposal.id);
    return {
      id,
      kind: "content",
      layout: proposal.layout,
      textElements: initialTextElements(id, proposal.layout, proposal.title, proposal.body),
      mediaId: null,
      mediaAlt: null,
      speakerNotes: "",
      citations: proposal.citations.map((citation) => ({ ...citation })),
      sourceDisclosure: disclosure,
    };
  });
  const questionIdMap = new Map(
    selection.questions.map((question) => [
      question.id,
      deterministic
        ? deterministicUuid(`${mutationId}:source-question:${question.id}`)
        : randomUUID(),
    ]),
  );
  const questionBlocks: PresentationBlockDraft[] = selection.questions.map((question) => ({
    id: blockId("question", question.id),
    kind: "question",
    question: freshQuestionCopy(question, questionIdMap, mutationId),
    citations: output.citations
      .filter((citation) => citation.checkpointId === question.id)
      .map(({ locator, excerpt }) => ({ locator, excerpt })),
    sourceDisclosure: disclosure,
  }));

  if (!contentBlocks.length) return questionBlocks;
  if (!questionBlocks.length) return contentBlocks;
  const main = questionBlocks.filter(
    (block) => block.kind === "question" && (block.question.delivery ?? "main") !== "recheck",
  );
  const rechecks = questionBlocks.filter(
    (block) => block.kind === "question" && (block.question.delivery ?? "main") === "recheck",
  );
  return [contentBlocks[0]!, ...main, ...contentBlocks.slice(1), ...rechecks];
}

function legacyIntroductionBlock(
  output: AuthoringDraft,
  mutationId: string,
  deterministic: boolean,
): PresentationBlockDraft {
  const id = deterministic
    ? deterministicUuid(`${mutationId}:source-block:legacy-introduction`)
    : randomUUID();
  return {
    id,
    kind: "content",
    layout: "title_body",
    textElements: initialTextElements(
      id,
      "title_body",
      output.checkpointSet.title,
      output.checkpointSet.description,
    ),
    mediaId: null,
    mediaAlt: null,
    speakerNotes: "",
    citations: output.citations.slice(0, 6).map(({ locator, excerpt }) => ({ locator, excerpt })),
    sourceDisclosure: sourceDisclosure(output),
  };
}

export async function registerPresentationRoutes(
  app: FastifyInstance,
  dependencies: {
    repository: Repository;
    presentations: PresentationRepository;
    auth: AuthService;
    workspaceEnabled: (workspaceId: string) => boolean;
    productEvents?: ProductEventDispatcher;
    productEventsEnabled?: (workspaceId: string) => boolean;
  },
) {
  const { repository, presentations, auth, workspaceEnabled, productEvents, productEventsEnabled } =
    dependencies;
  const requirePresentationWorkspace = (
    creator: CreatorContext,
    reply: FastifyReply,
    requestId: string,
  ) =>
    workspaceEnabled(creator.workspaceId)
      ? true
      : professionalFeatureUnavailable(reply, requestId, "Presentation not found");

  app.get("/v1/presentations", async (request, reply) => {
    reply.header("cache-control", "private, no-store").header("pragma", "no-cache");
    const creator = await auth.requireCreator(request, reply);
    if (!creator) return;
    const query = PresentationListQuerySchema.parse(request.query);
    const list = await presentations.listPresentations(
      creator.workspaceId,
      query.archived === "true",
    );
    return { presentations: list.map(presentationSummaryView) };
  });

  app.post("/v1/presentations", async (request, reply) => {
    const creator = await auth.requireCreator(request, reply);
    if (!creator) return;
    if (requirePresentationWorkspace(creator, reply, request.id) !== true) return;
    if (requireEditor(creator, reply, request.id) !== true) return;
    const input = CreatePresentationSchema.parse(request.body);
    const now = new Date();
    const firstBlockId = randomUUID();
    const draft: PresentationDraft = {
      title: input.title,
      description: input.description,
      experiencePreset: { id: "pops", version: 1 },
      schemaVersion: 2,
      blocks: [
        {
          id: firstBlockId,
          kind: "content",
          layout: "title_body",
          textElements: initialTextElements(firstBlockId, "title_body", "", ""),
          mediaId: null,
          mediaAlt: null,
          speakerNotes: "",
        },
      ],
    };
    const presentation = await presentations.createPresentation({
      id: randomUUID(),
      workspaceId: creator.workspaceId,
      title: input.title,
      description: input.description,
      status: "draft",
      draft,
      draftRevision: 0,
      draftSchemaVersion: 2,
      currentVersionId: null,
      folderId: null,
      publishedDraftRevision: null,
      lastEditedBy: creator.userId,
      createdAt: now,
      updatedAt: now,
    });
    await repository.recordAudit({
      workspaceId: creator.workspaceId,
      actorId: creator.userId,
      action: "presentation.create",
      targetType: "presentation",
      targetId: presentation.id,
      requestId: request.id,
    });
    return reply.code(201).send({ presentation: presentationView(presentation) });
  });

  app.get("/v1/presentations/:id", async (request, reply) => {
    reply.header("cache-control", "private, no-store").header("pragma", "no-cache");
    const creator = await auth.requireCreator(request, reply);
    if (!creator) return;
    const { id } = IdParamsSchema.parse(request.params);
    const presentation = await presentations.getPresentation(creator.workspaceId, id);
    if (!presentation) {
      return apiError(reply, 404, "NOT_FOUND", "Presentation not found", request.id);
    }
    reply.header("etag", `"draft-${presentation.draftRevision}"`);
    return { presentation: presentationView(presentation) };
  });

  app.put("/v1/presentations/:id/draft", { bodyLimit: 4_000_000 }, async (request, reply) => {
    const creator = await auth.requireCreator(request, reply);
    if (!creator) return;
    if (requirePresentationWorkspace(creator, reply, request.id) !== true) return;
    if (requireEditor(creator, reply, request.id) !== true) return;
    const { id } = IdParamsSchema.parse(request.params);
    const input = PresentationDraftMutationSchema.parse(request.body);
    try {
      const presentation = await presentations.updatePresentationDraft({
        workspaceId: creator.workspaceId,
        presentationId: id,
        draft: input.draft,
        expectedRevision: input.expectedRevision,
        mutationId: input.mutationId,
        editorId: creator.userId,
        draftHash: jsonHash(input.draft),
      });
      if (!presentation) {
        return apiError(reply, 404, "NOT_FOUND", "Presentation not found", request.id);
      }
      reply.header("etag", `"draft-${presentation.draftRevision}"`);
      return { presentation: presentationView(presentation) };
    } catch (error) {
      if (error instanceof PresentationDraftConflictError) {
        return conflict(reply, request.id, id, error);
      }
      if (error instanceof PresentationMutationConflictError) {
        return mutationConflict(reply, request.id, id, error);
      }
      throw error;
    }
  });

  app.post("/v1/presentations/:id/publish", async (request, reply) => {
    const creator = await auth.requireCreator(request, reply);
    if (!creator) return;
    if (requirePresentationWorkspace(creator, reply, request.id) !== true) return;
    if (requireEditor(creator, reply, request.id) !== true) return;
    const { id } = IdParamsSchema.parse(request.params);
    const input = PublishPresentationSchema.parse(request.body);
    const presentation = await presentations.getPresentation(creator.workspaceId, id);
    if (!presentation) {
      return apiError(reply, 404, "NOT_FOUND", "Presentation not found", request.id);
    }
    if (presentation.status === "archived") return archivedConflict(reply, request.id);
    if (presentation.draftRevision !== input.expectedDraftRevision) {
      return conflict(
        reply,
        request.id,
        id,
        new PresentationDraftConflictError(
          input.expectedDraftRevision,
          presentation.draftRevision,
          presentation.lastEditedBy,
        ),
      );
    }
    const parsedContent = PresentationContentSchema.safeParse(presentation.draft);
    const validationIssues = parsedContent.success
      ? []
      : parsedContent.error.issues.map((issue) =>
          presentationPublishIssue(id, presentation.draft, issue.path, issue.message),
        );
    const mediaReferences: Array<{ mediaId: string; fieldPath: readonly PropertyKey[] }> =
      presentation.draft.blocks.flatMap((block, blockIndex) => {
        const mediaId = block.kind === "content" ? block.mediaId : block.question.mediaId;
        if (!mediaId) return [];
        const fieldPath =
          block.kind === "content"
            ? (["blocks", blockIndex, "mediaId"] as const)
            : (["blocks", blockIndex, "question", "mediaId"] as const);
        return [{ mediaId, fieldPath }];
      });
    // Frozen authoring references are retained/exported too, even after their local copies change.
    for (const [index, insertion] of (presentation.draft.recoveryPackInsertions ?? []).entries()) {
      const baselines = [
        {
          content: insertion.originalContent,
          path: ["recoveryPackInsertions", index, "originalContent"],
        },
        ...(insertion.updateBaseline
          ? [
              {
                content: insertion.updateBaseline.content,
                path: ["recoveryPackInsertions", index, "updateBaseline", "content"],
              },
            ]
          : []),
      ];
      for (const { content, path } of baselines) {
        for (const role of ["diagnostic", "recheck", "delayedProbe"] as const) {
          const mediaId = content[role]?.mediaId;
          if (mediaId) mediaReferences.push({ mediaId, fieldPath: [...path, role, "mediaId"] });
        }
      }
    }
    const mediaById = new Map(
      await Promise.all(
        [...new Set(mediaReferences.map((reference) => reference.mediaId))].map(
          async (mediaId) =>
            [mediaId, await repository.getMediaAsset(creator.workspaceId, mediaId)] as const,
        ),
      ),
    );
    for (const reference of mediaReferences) {
      const media = mediaById.get(reference.mediaId);
      if (media?.scanStatus === "clean") continue;
      validationIssues.push(
        presentationPublishIssue(
          id,
          presentation.draft,
          reference.fieldPath,
          media
            ? "This image must finish security scanning before publishing"
            : "This image is unavailable or does not belong to this workspace",
        ),
      );
    }
    if (!parsedContent.success || validationIssues.length > 0) {
      return publishValidationError(reply, request.id, validationIssues);
    }
    const content = parsedContent.data;
    const current = presentation.currentVersionId
      ? await presentations.getPresentationVersion(
          creator.workspaceId,
          presentation.currentVersionId,
        )
      : null;
    const contentHash = jsonHash(content);
    try {
      const candidateVersionId = randomUUID();
      const publishedAt = new Date();
      const version = await presentations.publishPresentation(
        {
          id: candidateVersionId,
          workspaceId: creator.workspaceId,
          presentationId: id,
          version: (current?.version ?? 0) + 1,
          content,
          contentHash,
          sourceDraftRevision: input.expectedDraftRevision,
          publishedAt,
        },
        input.expectedDraftRevision,
      );
      if (
        version.id === candidateVersionId &&
        productEvents &&
        productEventsEnabled?.(creator.workspaceId)
      ) {
        productEvents.enqueue({
          workspaceId: creator.workspaceId,
          segment: creator.segment,
          events: [
            {
              name: "round_published",
              occurredAt: publishedAt.toISOString(),
              dimensions: { artifactType: "presentation" },
            },
          ],
        });
      }
      const updated = await presentations.getPresentation(creator.workspaceId, id);
      await repository.recordAudit({
        workspaceId: creator.workspaceId,
        actorId: creator.userId,
        action: "presentation.publish",
        targetType: "presentation_version",
        targetId: version.id,
        requestId: request.id,
        metadata: { version: version.version, contentHash },
      });
      reply.header("etag", `"draft-${input.expectedDraftRevision}"`);
      return { version, presentation: updated ? presentationView(updated) : undefined };
    } catch (error) {
      if (error instanceof PresentationDraftConflictError) {
        return conflict(reply, request.id, id, error);
      }
      if (error instanceof PresentationArchivedError) {
        return archivedConflict(reply, request.id);
      }
      throw error;
    }
  });

  app.post("/v1/presentations/:id/blocks/import", async (request, reply) => {
    const creator = await auth.requireCreator(request, reply);
    if (!creator) return;
    if (requirePresentationWorkspace(creator, reply, request.id) !== true) return;
    if (requireEditor(creator, reply, request.id) !== true) return;
    const { id } = IdParamsSchema.parse(request.params);
    const input = CopyRoundQuestionsToPresentationSchema.parse(request.body);
    const [presentation, source] = await Promise.all([
      presentations.getPresentation(creator.workspaceId, id),
      repository.getQuizVersion(creator.workspaceId, input.sourceQuizVersionId),
    ]);
    if (!presentation || !source) {
      return apiError(
        reply,
        404,
        "NOT_FOUND",
        "Presentation or source Round version not found",
        request.id,
      );
    }
    const sourceQuestions = new Map(
      source.content.questions.map((question) => [question.id, question]),
    );
    const selectedQuestionIds = new Set(input.questionIds);
    for (const questionId of input.questionIds) {
      if (!sourceQuestions.has(questionId)) {
        return apiError(
          reply,
          422,
          "VALIDATION_ERROR",
          "One or more selected questions are not in the source Round version",
          request.id,
        );
      }
    }
    // Recovery questions are a single authoring unit. Selecting either side copies the complete
    // pair, then the immutable source version determines insertion order so a recheck can never
    // be placed before its diagnostic question because of UI selection order.
    for (const question of source.content.questions) {
      if (selectedQuestionIds.has(question.id) && question.linkedRecheckQuestionId) {
        selectedQuestionIds.add(question.linkedRecheckQuestionId);
      }
      if (
        question.linkedRecheckQuestionId &&
        selectedQuestionIds.has(question.linkedRecheckQuestionId)
      ) {
        selectedQuestionIds.add(question.id);
      }
    }
    const selected: QuestionDraft[] = source.content.questions.filter((question) =>
      selectedQuestionIds.has(question.id),
    );
    if (
      selected.some(
        (question) =>
          ["ranking", "open_text", "word_cloud"].includes(question.type) ||
          (question.type === "poll" && (question.maxSelections ?? 1) > 1),
      )
    ) {
      return apiError(
        reply,
        422,
        "VALIDATION_ERROR",
        "This response format currently supports live Rounds only",
        request.id,
      );
    }
    const questionIdMap = new Map(
      selected.map((question) => [
        question.id,
        deterministicUuid(`${input.mutationId}:question:${question.id}`),
      ]),
    );
    const imported = selected.map((question) => ({
      id: deterministicUuid(`${input.mutationId}:block:${question.id}`),
      kind: "question" as const,
      question: freshQuestionCopy(question, questionIdMap, input.mutationId),
      provenance: {
        sourceQuizVersionId: source.id,
        sourceQuestionId: question.id,
      },
    }));
    const existingBlockIds = new Set(presentation.draft.blocks.map((block) => block.id));
    const retryCandidate = imported.some((block) => existingBlockIds.has(block.id));
    const blocks = [...presentation.draft.blocks];
    if (!retryCandidate) {
      let insertionIndex = blocks.length;
      if (input.afterBlockId) {
        const anchorIndex = blocks.findIndex((block) => block.id === input.afterBlockId);
        if (anchorIndex === -1) {
          return apiError(
            reply,
            422,
            "VALIDATION_ERROR",
            "The selected insertion point is not in this presentation",
            request.id,
          );
        }
        insertionIndex = anchorIndex + 1;
      }
      blocks.splice(insertionIndex, 0, ...imported);
    }
    const nextDraft = PresentationDraftSchema.parse({ ...presentation.draft, blocks });
    const draftHash = jsonHash({
      kind: "round-question-import",
      sourceQuizVersionId: input.sourceQuizVersionId,
      questionIds: selected.map((question) => question.id),
      afterBlockId: input.afterBlockId,
    });
    try {
      const updated = await presentations.updatePresentationDraft({
        workspaceId: creator.workspaceId,
        presentationId: id,
        draft: nextDraft,
        expectedRevision: input.expectedRevision,
        mutationId: input.mutationId,
        editorId: creator.userId,
        draftHash,
      });
      if (!updated) return apiError(reply, 404, "NOT_FOUND", "Presentation not found", request.id);
      await repository.recordAudit({
        workspaceId: creator.workspaceId,
        actorId: creator.userId,
        action: "presentation.questions_import",
        targetType: "presentation",
        targetId: id,
        requestId: request.id,
        metadata: { sourceQuizVersionId: source.id, count: imported.length },
      });
      reply.header("etag", `"draft-${updated.draftRevision}"`);
      return {
        presentation: presentationView(updated),
        insertedBlockIds: imported.map((block) => block.id),
      };
    } catch (error) {
      if (error instanceof PresentationDraftConflictError) {
        return conflict(reply, request.id, id, error);
      }
      if (error instanceof PresentationMutationConflictError) {
        return mutationConflict(reply, request.id, id, error);
      }
      throw error;
    }
  });

  app.post("/v1/presentations/:id/blocks/source-proposals", async (request, reply) => {
    const creator = await auth.requireCreator(request, reply);
    if (!creator) return;
    if (requirePresentationWorkspace(creator, reply, request.id) !== true) return;
    if (requireEditor(creator, reply, request.id) !== true) return;
    const { id } = IdParamsSchema.parse(request.params);
    const input = InsertAuthoringProposalsIntoPresentationSchema.parse(request.body);
    const [presentation, job] = await Promise.all([
      presentations.getPresentation(creator.workspaceId, id),
      repository.getAuthoringJob(creator.workspaceId, input.authoringJobId),
    ]);
    if (!presentation || !job) {
      return apiError(
        reply,
        404,
        "NOT_FOUND",
        "Presentation or source proposal not found",
        request.id,
      );
    }
    if (presentation.status === "archived") return archivedConflict(reply, request.id);
    if (job.status !== "ready" || !job.output) {
      return apiError(
        reply,
        409,
        "CONFLICT",
        "The source-grounded proposal is not ready to review",
        request.id,
      );
    }
    const selection = selectedSourceProposals(job.output, input);
    if ("error" in selection) {
      return apiError(reply, 422, "VALIDATION_ERROR", selection.error, request.id);
    }
    const inserted = sourceProposalBlocks(job.output, selection, input.mutationId, true);
    if (!job.output.contentSlideProposals?.length && input.selectedContentSlideIds === undefined) {
      inserted.unshift(legacyIntroductionBlock(job.output, input.mutationId, true));
    }
    const existingBlockIds = new Set(presentation.draft.blocks.map((block) => block.id));
    const retryCandidate = inserted.some((block) => existingBlockIds.has(block.id));
    const blocks = [...presentation.draft.blocks];
    if (!retryCandidate) {
      let insertionIndex = blocks.length;
      if (input.afterBlockId) {
        const anchorIndex = blocks.findIndex((block) => block.id === input.afterBlockId);
        if (anchorIndex === -1) {
          return apiError(
            reply,
            422,
            "VALIDATION_ERROR",
            "The selected insertion point is not in this presentation",
            request.id,
          );
        }
        insertionIndex = anchorIndex + 1;
      }
      blocks.splice(insertionIndex, 0, ...inserted);
    }
    const nextDraft = PresentationDraftSchema.parse({
      ...presentation.draft,
      sourceDisclosure: presentation.draft.sourceDisclosure ?? sourceDisclosure(job.output),
      blocks,
    });
    const draftHash = jsonHash({
      kind: "source-proposal-import",
      authoringJobId: job.id,
      selectedContentSlideIds: input.selectedContentSlideIds,
      selectedQuestionIds: input.selectedQuestionIds,
      afterBlockId: input.afterBlockId,
    });
    try {
      const updated = await presentations.updatePresentationDraft({
        workspaceId: creator.workspaceId,
        presentationId: id,
        draft: nextDraft,
        expectedRevision: input.expectedRevision,
        mutationId: input.mutationId,
        editorId: creator.userId,
        draftHash,
      });
      if (!updated) return apiError(reply, 404, "NOT_FOUND", "Presentation not found", request.id);
      await repository.recordAudit({
        workspaceId: creator.workspaceId,
        actorId: creator.userId,
        action: "presentation.source_proposal.insert",
        targetType: "presentation",
        targetId: id,
        requestId: request.id,
        metadata: {
          authoringJobId: job.id,
          sourceType: job.sourceType,
          sourceDigest: job.sourceDigest,
          count: inserted.length,
        },
      });
      reply.header("etag", `"draft-${updated.draftRevision}"`);
      return {
        presentation: presentationView(updated),
        insertedBlockIds: inserted.map((block) => block.id),
      };
    } catch (error) {
      if (error instanceof PresentationDraftConflictError) {
        return conflict(reply, request.id, id, error);
      }
      if (error instanceof PresentationMutationConflictError) {
        return mutationConflict(reply, request.id, id, error);
      }
      if (error instanceof PresentationArchivedError) {
        return archivedConflict(reply, request.id);
      }
      throw error;
    }
  });

  app.get("/v1/presentations/:id/history", async (request, reply) => {
    reply.header("cache-control", "private, no-store").header("pragma", "no-cache");
    const creator = await auth.requireCreator(request, reply);
    if (!creator) return;
    const { id } = IdParamsSchema.parse(request.params);
    const presentation = await presentations.getPresentation(creator.workspaceId, id);
    if (!presentation)
      return apiError(reply, 404, "NOT_FOUND", "Presentation not found", request.id);
    const history = await presentations.listPresentationHistory(creator.workspaceId, id, 20);
    return {
      history: history.map(({ id: historyId, revision, savedBy, createdAt }) => ({
        id: historyId,
        revision,
        savedBy,
        createdAt,
      })),
    };
  });

  app.post("/v1/presentations/:id/history/:revision/restore", async (request, reply) => {
    const creator = await auth.requireCreator(request, reply);
    if (!creator) return;
    // Recovery of existing drafts remains available when new Presentation authoring is paused.
    if (requireEditor(creator, reply, request.id) !== true) return;
    const { id, revision } = HistoryParamsSchema.parse(request.params);
    const input = RestoreHistorySchema.parse(request.body);
    try {
      const restored = await presentations.restorePresentationHistory({
        workspaceId: creator.workspaceId,
        presentationId: id,
        historyRevision: revision,
        expectedRevision: input.expectedRevision,
        mutationId: input.mutationId,
        editorId: creator.userId,
      });
      if (!restored) {
        return apiError(reply, 404, "NOT_FOUND", "Presentation revision not found", request.id);
      }
      await repository.recordAudit({
        workspaceId: creator.workspaceId,
        actorId: creator.userId,
        action: "presentation.restore",
        targetType: "presentation",
        targetId: id,
        requestId: request.id,
        metadata: { restoredRevision: revision, resultingRevision: restored.draftRevision },
      });
      reply.header("etag", `"draft-${restored.draftRevision}"`);
      return { presentation: presentationView(restored) };
    } catch (error) {
      if (error instanceof PresentationDraftConflictError) {
        return conflict(reply, request.id, id, error);
      }
      if (error instanceof PresentationMutationConflictError) {
        return mutationConflict(reply, request.id, id, error);
      }
      throw error;
    }
  });

  app.post("/v1/authoring/jobs/:jobId/apply-presentation", async (request, reply) => {
    const creator = await auth.requireCreator(request, reply);
    if (!creator) return;
    if (requirePresentationWorkspace(creator, reply, request.id) !== true) return;
    if (requireEditor(creator, reply, request.id) !== true) return;
    const { jobId } = ApplySourceJobParamsSchema.parse(request.params);
    const input = ApplyPresentationAuthoringJobSchema.parse(request.body ?? {});
    const job = await repository.getAuthoringJob(creator.workspaceId, jobId);
    if (!job) return apiError(reply, 404, "NOT_FOUND", "Authoring proposal not found", request.id);
    if (job.status !== "ready" || !job.output) {
      return apiError(
        reply,
        409,
        "CONFLICT",
        "The source-grounded proposal is not ready to review",
        request.id,
      );
    }
    const selection = selectedSourceProposals(job.output, input);
    if ("error" in selection) {
      return apiError(reply, 422, "VALIDATION_ERROR", selection.error, request.id);
    }
    const mutationId = randomUUID();
    const title = input.title ?? job.output.checkpointSet.title;
    const blocks = sourceProposalBlocks(job.output, selection, mutationId, false);
    // Existing schema-v1 jobs remain applicable even though they predate structured slide
    // proposals. New jobs never need this compatibility introduction.
    if (!job.output.contentSlideProposals?.length && input.selectedContentSlideIds === undefined) {
      blocks.unshift(legacyIntroductionBlock(job.output, mutationId, false));
    }
    const draft = PresentationDraftSchema.parse({
      title,
      description: job.output.checkpointSet.description,
      experiencePreset: job.output.checkpointSet.experiencePreset ?? { id: "focus", version: 1 },
      schemaVersion: 2,
      sourceDisclosure: sourceDisclosure(job.output),
      blocks,
    });
    const now = new Date();
    const presentation = await presentations.createPresentation({
      id: randomUUID(),
      workspaceId: creator.workspaceId,
      title,
      description: draft.description,
      status: "draft",
      draft,
      draftRevision: 0,
      draftSchemaVersion: 2,
      currentVersionId: null,
      folderId: null,
      publishedDraftRevision: null,
      lastEditedBy: creator.userId,
      createdAt: now,
      updatedAt: now,
    });
    await repository.recordAudit({
      workspaceId: creator.workspaceId,
      actorId: creator.userId,
      action: "presentation.source_proposal.apply",
      targetType: "presentation",
      targetId: presentation.id,
      requestId: request.id,
      metadata: {
        authoringJobId: job.id,
        sourceType: job.sourceType,
        sourceDigest: job.sourceDigest,
      },
    });
    return reply.code(201).send({ presentation: presentationView(presentation) });
  });
}
