import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  ApplyPresentationRecoveryPackUpdateSchema,
  PresentationContentSchema,
  PresentationDraftSchema,
  PresentationRecoveryPackUpdatePreviewRequestSchema,
  PresentationRecoveryPackUpdatePreviewSchema,
  RecoveryPackContentSchema,
  RecoveryPackInsertionSchema,
  RecoveryPackUpdateError,
  applyPresentationRecoveryPackUpdate,
  buildPresentationRecoveryPackUpdatePreview,
  buildRecoveryPackUpdatePreview,
  presentationRecoveryPackUpdateLinkIssue,
  recoveryPackContentHash,
  type ContentSlideDraft,
  type InteractiveQuestionBlockDraft,
  type PresentationDraft,
  type RecoveryPackUpdateErrorCode,
  type RecoveryPackUpdateTarget,
} from "../src/index.js";

function question(prompt: string) {
  return {
    id: randomUUID(),
    type: "single_select" as const,
    prompt,
    purpose: "diagnostic" as const,
    confidence: "off" as const,
    delivery: "main" as const,
    conceptKeys: ["evidence"],
    linkedRecheckQuestionId: null as string | null,
    timeLimitSeconds: 30,
    basePoints: 100,
    explanation: "Use observed evidence",
    mediaId: null,
    mediaAlt: null,
    choices: [
      { id: randomUUID(), label: "Observation", isCorrect: true },
      { id: randomUUID(), label: "Assumption", isCorrect: false },
    ],
  };
}

function slide(title: string): ContentSlideDraft {
  return {
    id: randomUUID(),
    kind: "content",
    layout: "title_body",
    textElements: [
      {
        id: randomUUID(),
        role: "title",
        text: title,
        region: "top_center",
        order: 0,
        frame: { x: 8, y: 10, width: 84, height: 20 },
      },
    ],
    mediaId: null,
    mediaAlt: null,
    speakerNotes: `Keep ${title} notes`,
    citations: [{ locator: "p. 2", excerpt: "Keep this source excerpt" }],
  };
}

function fixture() {
  const recheck = {
    ...question("What evidence supports a different scenario?"),
    delivery: "recheck",
  };
  const content = RecoveryPackContentSchema.parse({
    schemaVersion: 1,
    title: "Evidence Pack",
    description: "Original facilitator context",
    diagnostic: {
      ...question("Which evidence supports this conclusion?"),
      linkedRecheckQuestionId: recheck.id,
    },
    recheck,
    interventions: [
      {
        id: randomUUID(),
        title: "Compare signals",
        body: "Observation versus assumption",
        citations: [],
      },
    ],
    conceptKeys: ["evidence"],
  });
  const insertion = RecoveryPackInsertionSchema.parse({
    id: randomUUID(),
    packId: randomUUID(),
    packVersionId: randomUUID(),
    packVersion: 1,
    contentHash: recoveryPackContentHash(content),
    diagnosticQuestionId: randomUUID(),
    recheckQuestionId: randomUUID(),
    originalContent: content,
  });
  const copies = (["diagnostic", "recheck"] as const).map((role): InteractiveQuestionBlockDraft => {
    const copied = structuredClone(content[role]);
    copied.id =
      role === "diagnostic" ? insertion.diagnosticQuestionId : insertion.recheckQuestionId;
    copied.linkedRecheckQuestionId = role === "diagnostic" ? insertion.recheckQuestionId : null;
    if ("choices" in copied)
      copied.choices = copied.choices.map((choice) => ({ ...choice, id: randomUUID() }));
    copied.recoveryPackSource = {
      artifactType: "recovery_pack",
      packId: insertion.packId,
      packVersionId: insertion.packVersionId,
      packVersion: 1,
      sourceItemId: content[role].id,
      role,
      contentHash: "a".repeat(64),
    };
    return {
      id: randomUUID(),
      kind: "question",
      question: copied,
      provenance: { sourceQuizVersionId: randomUUID(), sourceQuestionId: randomUUID() },
      citations: [{ locator: `${role} source`, excerpt: "Retain block citation" }],
      sourceDisclosure: {
        sourceName: "Source document",
        sourceDigest: "b".repeat(64),
        provider: "local",
        model: "none",
      },
    };
  });
  const draft = PresentationDraftSchema.parse({
    title: "Lecture with recovery",
    description: "Do not add Round defaults",
    schemaVersion: 3,
    sourceDisclosure: {
      sourceName: "Lecture source",
      sourceDigest: "c".repeat(64),
      provider: "local",
      model: "none",
    },
    blocks: [
      slide("Before"),
      copies[0]!,
      slide("Between"),
      copies[1]!,
      slide("After"),
      {
        id: randomUUID(),
        kind: "question",
        question: question("Unrelated local checkpoint?"),
      },
    ],
    recoveryPackInsertions: [insertion],
  });
  const target: RecoveryPackUpdateTarget = {
    id: randomUUID(),
    version: 2,
    content: structuredClone(content),
  };
  return { draft, insertion, target };
}

function block(draft: PresentationDraft, questionId: string): InteractiveQuestionBlockDraft {
  const result = draft.blocks.find(
    (item) => item.kind === "question" && item.question.id === questionId,
  );
  if (result?.kind !== "question") throw new Error("Expected checkpoint block");
  return result;
}

function expectCode(work: () => unknown, code: RecoveryPackUpdateErrorCode) {
  try {
    work();
  } catch (error) {
    expect(error).toBeInstanceOf(RecoveryPackUpdateError);
    expect((error as RecoveryPackUpdateError).code).toBe(code);
    expect((error as Error).message).not.toMatch(/\bRound\b/);
    return;
  }
  throw new Error(`Expected ${code}`);
}

describe("Presentation Pack update contracts and comparison", () => {
  it("keeps route IDs out of request bodies and shares role choice/revision fences", () => {
    const { insertion, target } = fixture();
    expect(
      PresentationRecoveryPackUpdatePreviewRequestSchema.parse({ insertionId: insertion.id }),
    ).toEqual({ insertionId: insertion.id });
    const input = {
      insertionId: insertion.id,
      packVersionId: target.id,
      expectedRevision: 4,
      mutationId: randomUUID(),
      choices: [],
    };
    expect(ApplyPresentationRecoveryPackUpdateSchema.parse(input)).toEqual(input);
    expect(
      ApplyPresentationRecoveryPackUpdateSchema.safeParse({ ...input, expectedRevision: -1 })
        .success,
    ).toBe(false);
    expect(
      ApplyPresentationRecoveryPackUpdateSchema.safeParse({
        ...input,
        choices: [
          { role: "diagnostic", action: "keep_local" },
          { role: "diagnostic", action: "use_latest" },
        ],
      }).success,
    ).toBe(false);
    expect(
      ApplyPresentationRecoveryPackUpdateSchema.safeParse({ ...input, draft: fixture().draft })
        .success,
    ).toBe(false);
    expect(
      PresentationRecoveryPackUpdatePreviewRequestSchema.safeParse({
        insertionId: insertion.id,
        presentationId: randomUUID(),
      }).success,
    ).toBe(false);
  });

  it("returns the same merge comparison as Rounds with a Presentation-facing preview envelope", () => {
    const { draft, insertion, target } = fixture();
    target.content.diagnostic.prompt = "Updated source diagnostic?";
    block(draft, insertion.recheckQuestionId).question.prompt = "Locally adapted recheck?";
    const preview = buildPresentationRecoveryPackUpdatePreview(draft, insertion, target);
    const round = buildRecoveryPackUpdatePreview(
      {
        title: draft.title,
        description: draft.description,
        questions: draft.blocks.flatMap((item) =>
          item.kind === "question" ? [item.question] : [],
        ),
        recoveryPackInsertions: draft.recoveryPackInsertions,
      },
      insertion,
      target,
    );
    expect(preview).toEqual(round);
    expect(preview.items.map((item) => item.status)).toEqual(["source_changed", "local_changed"]);
    const response = { ...preview, presentationId: randomUUID(), draftRevision: 4 };
    expect(PresentationRecoveryPackUpdatePreviewSchema.parse(response)).toEqual(response);
    expect(
      PresentationRecoveryPackUpdatePreviewSchema.safeParse({
        ...preview,
        quizId: randomUUID(),
        draftRevision: 4,
      }).success,
    ).toBe(false);
  });

  it("leaves legacy v2 provenance-only documents valid but does not invent insertion ownership", () => {
    const { draft, insertion, target } = fixture();
    const legacy = { ...draft, schemaVersion: 2 as const, recoveryPackInsertions: undefined };
    expect(PresentationContentSchema.parse(legacy).schemaVersion).toBe(2);
    expectCode(
      () => buildPresentationRecoveryPackUpdatePreview(legacy, insertion, target),
      "INSERTION_NOT_FOUND",
    );
  });
});

describe("Presentation Pack update block adapter", () => {
  it("replaces source-only questions in place while preserving slides, block IDs, metadata and unrelated content", () => {
    const { draft, insertion, target } = fixture();
    target.content.diagnostic.prompt = "Updated source diagnostic?";
    target.content.interventions[0]!.body = "Accepted revised facilitator card";
    const before = structuredClone(draft);
    const updated = applyPresentationRecoveryPackUpdate(
      draft,
      buildPresentationRecoveryPackUpdatePreview(draft, insertion, target),
      target,
      [],
    );
    expect(updated.schemaVersion).toBe(3);
    expect(updated).not.toHaveProperty("category");
    expect(updated.blocks.map((item) => item.id)).toEqual(draft.blocks.map((item) => item.id));
    const diagnostic = block(updated, insertion.diagnosticQuestionId);
    expect({ ...diagnostic, question: undefined }).toEqual({
      ...block(draft, insertion.diagnosticQuestionId),
      question: undefined,
    });
    expect(diagnostic.question).toMatchObject({
      id: insertion.diagnosticQuestionId,
      prompt: target.content.diagnostic.prompt,
      linkedRecheckQuestionId: insertion.recheckQuestionId,
      recoveryPackSource: { packVersionId: target.id, sourceItemId: target.content.diagnostic.id },
    });
    expect(updated.blocks.filter((item) => item.id !== diagnostic.id)).toEqual(
      draft.blocks.filter((item) => item.id !== diagnostic.id),
    );
    expect(updated.sourceDisclosure).toEqual(draft.sourceDisclosure);
    expect(updated.recoveryPackInsertions![0]!.originalContent).toEqual(insertion.originalContent);
    expect(updated.recoveryPackInsertions![0]!.updateBaseline!.content).toEqual(target.content);
    expect(PresentationContentSchema.safeParse(updated).success).toBe(true);
    expect(draft).toEqual(before);
  });

  it("preserves kept local questions exactly and advances accepted context after an explicit conflict choice", () => {
    const { draft, insertion, target } = fixture();
    block(draft, insertion.diagnosticQuestionId).question.prompt = "Keep this local diagnostic?";
    target.content.diagnostic.prompt = "Divergent source diagnostic?";
    target.content.interventions[0]!.body = "New accepted context";
    const preview = buildPresentationRecoveryPackUpdatePreview(draft, insertion, target);
    expectCode(
      () => applyPresentationRecoveryPackUpdate(draft, preview, target, []),
      "CONFLICT_CHOICE_REQUIRED",
    );
    const kept = applyPresentationRecoveryPackUpdate(draft, preview, target, [
      { role: "diagnostic", action: "keep_local" },
    ]);
    expect(kept.blocks).toEqual(draft.blocks);
    expect(kept.recoveryPackInsertions![0]!.updateBaseline!.content).toEqual(target.content);
    expect(kept.recoveryPackInsertions![0]!.originalContent).toEqual(insertion.originalContent);
  });

  it("keeps omitted and explicitly undefined local fields identical when choosing keep_local", () => {
    const { draft, insertion, target } = fixture();
    const local = block(draft, insertion.diagnosticQuestionId).question;
    delete local.purpose;
    delete local.confidence;
    delete local.delivery;
    local.sourceCitations = undefined;
    if (!("choices" in local)) throw new Error("Expected choices");
    local.choices[0]!.feedback = undefined;
    local.prompt = "Local optional-field adaptation?";
    target.content.diagnostic.prompt = "Divergent source question?";
    const before = structuredClone(local);
    const updated = applyPresentationRecoveryPackUpdate(
      draft,
      buildPresentationRecoveryPackUpdatePreview(draft, insertion, target),
      target,
      [{ role: "diagnostic", action: "keep_local" }],
    );
    const kept = block(updated, insertion.diagnosticQuestionId).question;
    expect(kept).toStrictEqual(before);
    expect(JSON.stringify(kept)).toBe(JSON.stringify(before));
    expect(kept).not.toHaveProperty("purpose");
    expect(kept).not.toHaveProperty("confidence");
    expect(kept).not.toHaveProperty("delivery");
  });

  it("uses the accepted context as the next baseline and supports republished older immutable versions", () => {
    const { draft, insertion, target } = fixture();
    target.content.diagnostic.prompt = "Version two?";
    const accepted = applyPresentationRecoveryPackUpdate(
      draft,
      buildPresentationRecoveryPackUpdatePreview(draft, insertion, target),
      target,
      [],
    );
    const next = { id: randomUUID(), version: 3, content: structuredClone(target.content) };
    next.content.diagnostic.prompt = "Version three?";
    const preview = buildPresentationRecoveryPackUpdatePreview(
      accepted,
      accepted.recoveryPackInsertions![0]!,
      next,
    );
    expect(preview.baselineContent).toEqual(target.content);
    expect(preview.items[0]!.status).toBe("source_changed");
    const rollback = {
      id: insertion.packVersionId,
      version: 1,
      content: insertion.originalContent,
    };
    const reverted = applyPresentationRecoveryPackUpdate(
      accepted,
      buildPresentationRecoveryPackUpdatePreview(
        accepted,
        accepted.recoveryPackInsertions![0]!,
        rollback,
      ),
      rollback,
      [],
    );
    expect(block(reverted, insertion.diagnosticQuestionId).question.prompt).toBe(
      insertion.originalContent.diagnostic.prompt,
    );
    expect(reverted.recoveryPackInsertions![0]!.packVersionId).toBe(insertion.packVersionId);
    expect(reverted.recoveryPackInsertions![0]!.updateBaseline!.packVersionId).toBe(
      insertion.packVersionId,
    );
  });

  it("keeps context-only unfinished drafts intact rather than silently repairing their links", () => {
    const { draft, insertion, target } = fixture();
    block(draft, insertion.diagnosticQuestionId).question.linkedRecheckQuestionId = null;
    draft.blocks = draft.blocks.filter(
      (item) => item.kind !== "question" || item.question.id !== insertion.recheckQuestionId,
    );
    target.content.interventions[0]!.body = "Revised facilitator context";
    const updated = applyPresentationRecoveryPackUpdate(
      draft,
      buildPresentationRecoveryPackUpdatePreview(draft, insertion, target),
      target,
      [{ role: "recheck", action: "keep_local" }],
    );
    expect(updated.blocks).toEqual(draft.blocks);
    expect(updated.recoveryPackInsertions![0]!.updateBaseline!.content).toEqual(target.content);
  });

  it.each(["diagnostic", "recheck"] as const)(
    "restores a deleted %s only explicitly, immediately next to its sibling",
    (role) => {
      const { draft, insertion, target } = fixture();
      const id =
        role === "diagnostic" ? insertion.diagnosticQuestionId : insertion.recheckQuestionId;
      draft.blocks = draft.blocks.filter(
        (item) => item.kind !== "question" || item.question.id !== id,
      );
      const preview = buildPresentationRecoveryPackUpdatePreview(draft, insertion, target);
      expectCode(
        () => applyPresentationRecoveryPackUpdate(draft, preview, target, []),
        "CONFLICT_CHOICE_REQUIRED",
      );
      const kept = applyPresentationRecoveryPackUpdate(draft, preview, target, [
        { role, action: "keep_local" },
      ]);
      expect(kept.blocks).toEqual(draft.blocks);
      const restored = applyPresentationRecoveryPackUpdate(draft, preview, target, [
        { role, action: "use_latest" },
      ]);
      const diagnosticIndex = restored.blocks.findIndex(
        (item) => item.kind === "question" && item.question.id === insertion.diagnosticQuestionId,
      );
      const recheckIndex = restored.blocks.findIndex(
        (item) => item.kind === "question" && item.question.id === insertion.recheckQuestionId,
      );
      expect(recheckIndex).toBe(diagnosticIndex + 1);
      expect(restored.blocks.filter((item) => item.kind === "content")).toEqual(
        draft.blocks.filter((item) => item.kind === "content"),
      );
      expect(restored.blocks.filter((item) => item.id !== block(restored, id).id)).toEqual(
        draft.blocks,
      );
      expect(
        applyPresentationRecoveryPackUpdate(draft, preview, target, [
          { role, action: "use_latest" },
        ]),
      ).toEqual(restored);
      expect(PresentationContentSchema.safeParse(restored).success).toBe(true);
    },
  );

  it("appends both deleted checkpoints as a deterministic pair after all existing blocks", () => {
    const { draft, insertion, target } = fixture();
    draft.blocks = draft.blocks.filter(
      (item) =>
        item.kind !== "question" ||
        ![insertion.diagnosticQuestionId, insertion.recheckQuestionId].includes(item.question.id),
    );
    const preview = buildPresentationRecoveryPackUpdatePreview(draft, insertion, target);
    const choices = [
      { role: "diagnostic" as const, action: "use_latest" as const },
      { role: "recheck" as const, action: "use_latest" as const },
    ];
    const updated = applyPresentationRecoveryPackUpdate(draft, preview, target, choices);
    expect(updated.blocks.slice(0, draft.blocks.length)).toEqual(draft.blocks);
    expect(
      updated.blocks.slice(-2).map((item) => (item.kind === "question" ? item.question.id : null)),
    ).toEqual([insertion.diagnosticQuestionId, insertion.recheckQuestionId]);
    expect(applyPresentationRecoveryPackUpdate(draft, preview, target, choices)).toEqual(updated);
  });

  it("requires the linked diagnostic choice after ordinary recheck deletion, with Presentation wording", () => {
    const { draft, insertion, target } = fixture();
    draft.blocks = draft.blocks.filter(
      (item) => item.kind !== "question" || item.question.id !== insertion.recheckQuestionId,
    );
    block(draft, insertion.diagnosticQuestionId).question.linkedRecheckQuestionId = null;
    const preview = buildPresentationRecoveryPackUpdatePreview(draft, insertion, target);
    const choice = [{ role: "recheck" as const, action: "use_latest" as const }];
    expect(presentationRecoveryPackUpdateLinkIssue(preview, choice)).toContain(
      "repair its recheck link in the Presentation",
    );
    expectCode(
      () => applyPresentationRecoveryPackUpdate(draft, preview, target, choice),
      "INVALID_LINKED_PAIR",
    );
    const updated = applyPresentationRecoveryPackUpdate(draft, preview, target, [
      { role: "diagnostic", action: "use_latest" },
      ...choice,
    ]);
    expect(PresentationContentSchema.safeParse(updated).success).toBe(true);
  });

  it.each(["order", "shared", "delivery"])(
    "rejects replacing a %s-invalid linked pair without touching content blocks",
    (kind) => {
      const { draft, insertion, target } = fixture();
      if (kind === "order") {
        const diagnostic = block(draft, insertion.diagnosticQuestionId);
        const recheck = block(draft, insertion.recheckQuestionId);
        draft.blocks[1] = recheck;
        draft.blocks[3] = diagnostic;
      } else if (kind === "shared") {
        const unrelated = draft.blocks.at(-1)!;
        if (unrelated.kind !== "question") throw new Error("Expected question");
        unrelated.question.linkedRecheckQuestionId = insertion.recheckQuestionId;
      } else block(draft, insertion.recheckQuestionId).question.delivery = "main";
      const before = structuredClone(draft);
      const preview = buildPresentationRecoveryPackUpdatePreview(draft, insertion, target);
      expectCode(
        () =>
          applyPresentationRecoveryPackUpdate(draft, preview, target, [
            { role: kind === "delivery" ? "diagnostic" : "recheck", action: "use_latest" },
          ]),
        "INVALID_LINKED_PAIR",
      );
      expect(draft).toEqual(before);
    },
  );

  it("shares deterministic choice remapping and exact reviewed targets without altering local destination IDs", () => {
    const { draft, insertion, target } = fixture();
    target.content.diagnostic.prompt = "Updated source question?";
    const preview = buildPresentationRecoveryPackUpdatePreview(draft, insertion, target);
    const first = applyPresentationRecoveryPackUpdate(draft, preview, target, []);
    expect(applyPresentationRecoveryPackUpdate(draft, preview, target, [])).toEqual(first);
    const copied = block(first, insertion.diagnosticQuestionId).question;
    if (!("choices" in copied) || !("choices" in target.content.diagnostic))
      throw new Error("Expected choices");
    expect(copied.choices.map((choice) => choice.id)).not.toEqual(
      target.content.diagnostic.choices.map((choice) => choice.id),
    );
    expect(copied.id).toBe(insertion.diagnosticQuestionId);
    expectCode(
      () =>
        applyPresentationRecoveryPackUpdate(draft, preview, { ...target, id: randomUUID() }, []),
      "REVIEW_STALE",
    );
  });

  it("does not copy Quiz defaults into unrelated Presentation questions or metadata", () => {
    const { draft, insertion, target } = fixture();
    const unrelated = draft.blocks.at(-1)!;
    if (unrelated.kind !== "question") throw new Error("Expected question");
    unrelated.question.confidence = undefined;
    unrelated.question.delivery = undefined;
    target.content.interventions[0]!.body = "Only facilitator context changes";
    const expected = PresentationDraftSchema.parse(draft);
    const updated = applyPresentationRecoveryPackUpdate(
      draft,
      buildPresentationRecoveryPackUpdatePreview(draft, insertion, target),
      target,
      [],
    );
    expect(updated.blocks).toEqual(expected.blocks);
    expect(updated).not.toHaveProperty("category");
    expect(updated.experiencePreset).toEqual(draft.experiencePreset);
  });

  it("preserves unrelated current slide edits when applying an otherwise unchanged Pack comparison", () => {
    const { draft, insertion, target } = fixture();
    target.content.diagnostic.prompt = "Updated source diagnostic?";
    const preview = buildPresentationRecoveryPackUpdatePreview(draft, insertion, target);
    const content = draft.blocks[0]!;
    if (content.kind !== "content") throw new Error("Expected content slide");
    content.speakerNotes = "A current local note that must not be lost.";
    content.textElements[0]!.text = "A current locally edited slide title";
    const updated = applyPresentationRecoveryPackUpdate(draft, preview, target, []);
    expect(updated.blocks[0]).toEqual(content);
  });

  it("retains designed document7 scenes and immutable original Pack snapshots through updates", () => {
    const { draft, insertion, target } = fixture();
    draft.schemaVersion = 7;
    const content = draft.blocks[0]!;
    if (content.kind !== "content") throw new Error("Expected content slide");
    content.textElements = [];
    content.scene = {
      schemaVersion: 3,
      aspectRatio: "16:9",
      design: { theme: "midnight", font: "mono", spacing: "compact" },
      nodes: [
        {
          id: "title",
          type: "text",
          role: "title",
          text: "Retain design",
          frame: { x: 8, y: 8, width: 84, height: 20 },
        },
        {
          id: "image",
          type: "image",
          mediaId: randomUUID(),
          altText: "Evidence",
          fit: "cover",
          focalPoint: { x: 15, y: 85 },
          frame: { x: 8, y: 35, width: 84, height: 50 },
        },
      ],
      readingOrder: ["title", "image"],
    };
    const original = JSON.stringify(insertion.originalContent);
    const retainedScene = JSON.stringify(PresentationDraftSchema.parse(draft).blocks[0]);
    target.content.diagnostic.prompt = "Updated source question?";
    const updated = applyPresentationRecoveryPackUpdate(
      draft,
      buildPresentationRecoveryPackUpdatePreview(draft, insertion, target),
      target,
      [],
    );
    expect(updated.schemaVersion).toBe(7);
    expect(JSON.stringify(updated.blocks[0])).toBe(retainedScene);
    expect(JSON.stringify(updated.recoveryPackInsertions![0]!.originalContent)).toBe(original);
    expect(updated.recoveryPackInsertions![0]!.updateBaseline!.content).toEqual(target.content);
    const next = { id: randomUUID(), version: 3, content: structuredClone(target.content) };
    next.content.interventions[0]!.body = "Third immutable facilitator card";
    const acceptedInsertion = updated.recoveryPackInsertions![0]!;
    const baseline = JSON.stringify(acceptedInsertion.updateBaseline);
    const updatedAgain = applyPresentationRecoveryPackUpdate(
      updated,
      buildPresentationRecoveryPackUpdatePreview(updated, acceptedInsertion, next),
      next,
      [],
    );
    expect(updatedAgain.schemaVersion).toBe(7);
    expect(JSON.stringify(updatedAgain.blocks[0])).toBe(retainedScene);
    expect(JSON.stringify(updatedAgain.recoveryPackInsertions![0]!.originalContent)).toBe(original);
    expect(JSON.stringify(acceptedInsertion.updateBaseline)).toBe(baseline);
    expect(PresentationContentSchema.parse(updatedAgain).schemaVersion).toBe(7);
  });
});

describe("Presentation Pack update validation", () => {
  it.each([198, 199, 200])("counts all %i content blocks toward restoration capacity", (count) => {
    const { draft, insertion, target } = fixture();
    draft.blocks = Array.from({ length: count }, (_, index) => slide(`Slide ${index}`));
    const before = structuredClone(draft);
    const preview = buildPresentationRecoveryPackUpdatePreview(draft, insertion, target);
    const choices = [
      { role: "diagnostic" as const, action: "use_latest" as const },
      { role: "recheck" as const, action: "use_latest" as const },
    ];
    if (count === 198)
      expect(
        applyPresentationRecoveryPackUpdate(draft, preview, target, choices).blocks,
      ).toHaveLength(200);
    else
      expectCode(
        () => applyPresentationRecoveryPackUpdate(draft, preview, target, choices),
        "QUESTION_CAPACITY_EXCEEDED",
      );
    expect(draft).toEqual(before);
  });

  it("replaces in place at full block capacity", () => {
    const { draft, insertion, target } = fixture();
    draft.blocks = [
      block(draft, insertion.diagnosticQuestionId),
      block(draft, insertion.recheckQuestionId),
      ...Array.from({ length: 198 }, (_, index) => slide(`Slide ${index}`)),
    ];
    target.content.diagnostic.prompt = "Replacement at full capacity?";
    const updated = applyPresentationRecoveryPackUpdate(
      draft,
      buildPresentationRecoveryPackUpdatePreview(draft, insertion, target),
      target,
      [],
    );
    expect(updated.blocks).toHaveLength(200);
  });

  it.each(["local", "preview"])("rejects stale %s review content", (kind) => {
    const { draft, insertion, target } = fixture();
    const preview = buildPresentationRecoveryPackUpdatePreview(draft, insertion, target);
    if (kind === "local")
      block(draft, insertion.diagnosticQuestionId).question.prompt = "Edit after review?";
    else preview.items[0]!.latest.prompt = "Forged source payload?";
    expectCode(
      () => applyPresentationRecoveryPackUpdate(draft, preview, target, []),
      "REVIEW_STALE",
    );
  });

  it("rejects invalid choices without mutating Presentation state", () => {
    const { draft, insertion, target } = fixture();
    const preview = buildPresentationRecoveryPackUpdatePreview(draft, insertion, target);
    expectCode(
      () =>
        applyPresentationRecoveryPackUpdate(draft, preview, target, [
          { role: "diagnostic", action: "keep_local" },
          { role: "diagnostic", action: "use_latest" },
        ]),
      "INVALID_CHOICES",
    );
  });

  it("validates Presentation-wide question, block and answer-choice uniqueness", () => {
    for (const kind of ["block", "question", "choice", "insertion"] as const) {
      const { draft, insertion, target } = fixture();
      if (kind === "block") draft.blocks[2]!.id = draft.blocks[0]!.id;
      else if (kind === "question")
        block(draft, insertion.recheckQuestionId).question.id = insertion.diagnosticQuestionId;
      else if (kind === "choice") {
        const first = block(draft, insertion.diagnosticQuestionId).question;
        const second = block(draft, insertion.recheckQuestionId).question;
        if (!("choices" in first) || !("choices" in second)) throw new Error("Expected choices");
        second.choices[0]!.id = first.choices[0]!.id;
      } else draft.recoveryPackInsertions!.push({ ...insertion, id: randomUUID() });
      expect(() => buildPresentationRecoveryPackUpdatePreview(draft, insertion, target)).toThrow();
    }
  });

  it("fails closed if a deterministic restored block ID is already owned by another block", () => {
    const { draft, insertion, target } = fixture();
    draft.blocks = [];
    const choices = [
      { role: "diagnostic" as const, action: "use_latest" as const },
      { role: "recheck" as const, action: "use_latest" as const },
    ];
    const restored = applyPresentationRecoveryPackUpdate(
      draft,
      buildPresentationRecoveryPackUpdatePreview(draft, insertion, target),
      target,
      choices,
    );
    draft.blocks = [{ ...slide("Existing conflicting block"), id: restored.blocks[0]!.id }];
    expectCode(
      () =>
        applyPresentationRecoveryPackUpdate(
          draft,
          buildPresentationRecoveryPackUpdatePreview(draft, insertion, target),
          target,
          choices,
        ),
      "INVALID_INSERTION",
    );
  });
});
