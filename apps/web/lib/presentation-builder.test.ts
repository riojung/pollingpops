import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { recoveryPackDraftFromPair } from "./recovery-packs";
import {
  addContentTextElement,
  applyContentSlideLayout,
  changePresentationQuestionType,
  contentSlideTitle,
  createContentBlock,
  createContentTextElement,
  createPresentationQuestion,
  createQuestionBlock,
  duplicatePresentationBlock,
  movePresentationBlock,
  moveContentTextElement,
  normalizePresentationRecoveryDraft,
  presentationReadiness,
  removeContentTextElement,
  reorderContentTextElement,
  removePresentationBlock,
  setContentTextElementFrame,
  setContentSlideMedia,
} from "./presentation-builder";
import {
  RecoveryPackContentSchema,
  recoveryPackContentHash,
  resolveContentSlideFrames,
  regionForContentSlideFrame,
  contentSlideMediaFrame,
  type ContentSlideFrame,
  type ContentSlideLayout,
  type PresentationDraft,
} from "@openround/contracts";

function draft(): PresentationDraft {
  const content = createContentBlock();
  content.textElements[0] = { ...content.textElements[0]!, text: "Welcome" };
  const question = createQuestionBlock();
  if (question.kind === "question") {
    question.question.prompt = "Which signal matters?";
    if ("choices" in question.question) {
      question.question.choices = question.question.choices.slice(0, 2).map((choice, index) => ({
        ...choice,
        label: index === 0 ? "Evidence" : "Volume",
        isCorrect: index === 0,
      }));
    }
  }
  return {
    title: "Facilitator deck",
    description: "",
    experiencePreset: { id: "focus", version: 1 },
    schemaVersion: 2,
    blocks: [content, question],
  };
}

describe("presentation builder model", () => {
  it("rejects text and cloud formats rather than silently creating ratings", () => {
    for (const type of ["open_text", "word_cloud"] as const)
      expect(() => createPresentationQuestion(type)).toThrow("live Rounds only");
  });
  it("explicitly rejects ranking insertion into the unsupported Presentation builder", () => {
    expect(() => createPresentationQuestion("ranking")).toThrow(
      "Ranking polls currently support live Rounds only.",
    );
    const source = draft();
    const block = source.blocks.find((candidate) => candidate.kind === "question")!;
    if (block.kind !== "question" || !("choices" in block.question)) return;
    block.question = {
      ...block.question,
      type: "ranking",
      purpose: "opinion",
      confidence: "off",
      basePoints: 0,
      maxSelections: undefined,
      rankCount: 2,
      choices: block.question.choices.map((choice) => ({ ...choice, isCorrect: false })),
    };
    expect(
      presentationReadiness(source).some((issue) => issue.message.includes("live Rounds only")),
    ).toBe(true);
  });
  function expectClearOfImage(frame: ContentSlideFrame) {
    expect(
      frame.x + frame.width <= contentSlideMediaFrame.x ||
        frame.x >= contentSlideMediaFrame.x + contentSlideMediaFrame.width ||
        frame.y + frame.height <= contentSlideMediaFrame.y ||
        frame.y >= contentSlideMediaFrame.y + contentSlideMediaFrame.height,
    ).toBe(true);
  }

  it.each<ContentSlideLayout>(["title", "title_body", "media", "quote", "section", "callout"])(
    "reserves image space when attaching, adding text, resetting, and removing media in %s",
    (layout) => {
      const original = createContentBlock(layout);
      const attached = setContentSlideMedia(original, original.id, "Evidence diagram");
      expect(attached.layout).toBe(layout);
      expect(attached.mediaId).toBe(original.id);
      expect(
        attached.textElements.map(({ frame, ...element }) => {
          expect(frame).toBeDefined();
          return element;
        }),
      ).toEqual(
        original.textElements.map(({ frame, ...element }) => {
          expect(frame).toBeDefined();
          return element;
        }),
      );
      expect(attached.textElements[1]!.frame!.height).toBe(22);
      attached.textElements.forEach((element) => expectClearOfImage(element.frame!));
      const added = addContentTextElement(attached, createContentTextElement());
      expect(added.textElements[2]!.frame!.width).toBe(84);
      added.textElements.forEach((element) => expectClearOfImage(element.frame!));
      const reset = applyContentSlideLayout(added, layout);
      reset.textElements.forEach((element) => expectClearOfImage(element.frame!));
      expect(setContentSlideMedia(attached, null, null)).toEqual(original);
      // Attaching and its reflow are a single immutable model change for Undo/Redo.
      expect(original.mediaId).toBeNull();
      expect(original.textElements[1]!.frame!.height).toBe(layout === "media" ? 22 : 40);
    },
  );

  it("preserves safe custom text and fits colliding text for attachment, movement, and resizing", () => {
    const original = createContentBlock();
    const titleId = original.textElements[0]!.id;
    const bodyId = original.textElements[1]!.id;
    const customized = setContentTextElementFrame(
      setContentTextElementFrame(original, titleId, { x: 4, y: 4, width: 80, height: 20 }),
      bodyId,
      { x: 55, y: 76, width: 40, height: 20 },
    );
    const attached = setContentSlideMedia(customized, original.id, "Evidence diagram");
    expect(attached.textElements[0]).toEqual(customized.textElements[0]);
    expect(attached.textElements[1]!.frame).toEqual({ x: 55, y: 52, width: 40, height: 20 });
    const resized = setContentTextElementFrame(attached, bodyId, {
      x: 52,
      y: 50,
      width: 40,
      height: 45,
    });
    expect(resized.textElements[1]!.frame).toEqual({ x: 52, y: 50, width: 40, height: 22 });
    const moved = moveContentTextElement(resized, bodyId, "bottom_right");
    moved.textElements.forEach((element) => expectClearOfImage(element.frame!));
    const removed = setContentSlideMedia(attached, null, null);
    expect(removed.textElements).toEqual(attached.textElements);
    expect(removed.mediaId).toBeNull();
    expect(removed.mediaAlt).toBeNull();
  });

  it("keeps region shortcut groups stacked when the requested region contains an image", () => {
    const base = addContentTextElement(createContentBlock(), createContentTextElement());
    const attached = setContentSlideMedia(base, base.id, "Evidence diagram");
    const first = attached.textElements[1]!;
    const second = attached.textElements[2]!;
    const moved = moveContentTextElement(
      moveContentTextElement(attached, first.id, "bottom_right"),
      second.id,
      "bottom_right",
    );
    const firstFrame = moved.textElements[1]!.frame!;
    const secondFrame = moved.textElements[2]!.frame!;
    expectClearOfImage(firstFrame);
    expectClearOfImage(secondFrame);
    expect(firstFrame.y + firstFrame.height).toBeLessThanOrEqual(secondFrame.y);
    expect(firstFrame.x).toBe(secondFrame.x);
    expect(reorderContentTextElement(moved, second.id, -1).textElements[1]!.frame).toEqual(
      secondFrame,
    );
  });

  it("keeps region shortcuts in their requested cell even when it is a starter's metadata region", () => {
    const original = createContentBlock();
    const bodyId = original.textElements[1]!.id;
    const moved = moveContentTextElement(original, bodyId, "top_center");
    const returned = moveContentTextElement(moved, bodyId, "middle_center");
    expect(regionForContentSlideFrame(returned.textElements[1]!.frame!)).toBe("middle_center");
    const title = moveContentTextElement(original, original.textElements[0]!.id, "middle_center");
    expect(regionForContentSlideFrame(title.textElements[0]!.frame!)).toBe("middle_center");
  });
  it("creates wide starter frames and preserves bounded geometry through recovery and duplication", () => {
    const block = createContentBlock();
    const title = block.textElements[0]!;
    expect(title.frame).toEqual({ x: 8, y: 20, width: 84, height: 22 });
    const changed = setContentTextElementFrame(block, title.id, {
      x: 95,
      y: -4,
      width: 40,
      height: 18,
    });
    expect(changed.textElements[0]!.frame).toEqual({ x: 60, y: 0, width: 40, height: 18 });
    expect(changed.textElements[0]!.region).toBe("top_right");
    expect(changed.textElements[1]!.frame).toEqual(block.textElements[1]!.frame);
    expect(block.textElements[0]!.frame).toEqual(title.frame);
    expect(setContentTextElementFrame(block, "missing", title.frame!)).toBe(block);
    const duplicate = duplicatePresentationBlock(changed);
    expect(duplicate.kind === "content" && duplicate.textElements[0]!.frame).toEqual(
      changed.textElements[0]!.frame,
    );
    expect(normalizePresentationRecoveryDraft({ ...draft(), blocks: [changed] }).blocks[0]).toEqual(
      changed,
    );
    expect(applyContentSlideLayout(changed, "title_body").textElements[0]!.frame).toEqual(
      title.frame,
    );
  });

  it("materializes legacy frames without moving other text and swaps positions when reordering", () => {
    const legacy = createContentBlock();
    legacy.textElements = legacy.textElements.map(({ frame, ...element }) => {
      expect(frame).toBeDefined();
      return element;
    });
    const frames = resolveContentSlideFrames(legacy);
    const moved = setContentTextElementFrame(legacy, legacy.textElements[0]!.id, {
      x: 4,
      y: 4,
      width: 70,
      height: 20,
    });
    expect(moved.textElements[1]!.frame).toEqual(frames[legacy.textElements[1]!.id]);
    const stacked = moveContentTextElement(
      addContentTextElement(legacy, createContentTextElement()),
      legacy.textElements[0]!.id,
      "top_left",
    );
    const extra = stacked.textElements[2]!;
    const together = moveContentTextElement(stacked, extra.id, "top_left");
    const first = together.textElements[0]!;
    const second = together.textElements[2]!;
    const reordered = reorderContentTextElement(together, second.id, -1);
    expect(reordered.textElements[0]!.frame).toEqual(second.frame);
    expect(reordered.textElements[2]!.frame).toEqual(first.frame);
  });

  it("packs added starter text into wide rows and preserves a customized arrangement", () => {
    const original = createContentBlock();
    const added = addContentTextElement(original, createContentTextElement());
    expect(added.textElements[2]!.frame!.width).toBe(84);
    expect(added.textElements[2]!.frame!.y).toBeGreaterThan(added.textElements[1]!.frame!.y);
    const customized = setContentTextElementFrame(original, original.textElements[0]!.id, {
      x: 4,
      y: 8,
      width: 72,
      height: 20,
    });
    const withExtra = addContentTextElement(customized, createContentTextElement());
    expect(withExtra.textElements.slice(0, 2)).toEqual(customized.textElements);
  });

  it("upcasts cached v1 slide content before it can be restored", () => {
    const slide = createContentBlock("quote");
    const legacy = {
      title: "Recovered presentation",
      description: "Unsaved local changes",
      schemaVersion: 1,
      blocks: [
        {
          id: slide.id,
          kind: "content",
          layout: "quote",
          title: "Recovered title",
          body: "Recovered body",
          mediaId: slide.id,
          mediaAlt: "Source image",
          speakerNotes: "Unsaved notes",
          citations: [{ locator: "Page 2", excerpt: "Source excerpt" }],
        },
      ],
    };
    const recovered = normalizePresentationRecoveryDraft(legacy);

    expect(recovered.schemaVersion).toBe(2);
    expect(recovered.blocks[0]).toMatchObject({
      id: slide.id,
      layout: "quote",
      mediaId: slide.id,
      mediaAlt: "Source image",
      speakerNotes: "Unsaved notes",
      citations: legacy.blocks[0]!.citations,
      textElements: [
        {
          id: `${slide.id}:title`,
          role: "title",
          text: "Recovered title",
          region: "middle_center",
          order: 0,
        },
        {
          id: `${slide.id}:body`,
          role: "body",
          text: "Recovered body",
          region: "bottom_center",
          order: 0,
        },
      ],
    });
    expect(normalizePresentationRecoveryDraft(legacy)).toEqual(recovered);
    const { schemaVersion, ...unversioned } = legacy;
    expect(schemaVersion).toBe(1);
    expect(normalizePresentationRecoveryDraft(unversioned)).toEqual(recovered);
    expect(legacy.blocks[0]).not.toHaveProperty("textElements");
  });

  it("preserves v2 recovery placement and rejects unsupported or invalid cached drafts", () => {
    const current = draft();
    const slide = current.blocks[0]!;
    if (slide.kind !== "content") throw new Error("Expected a content slide");
    slide.textElements[0]!.region = "bottom_left";

    expect(normalizePresentationRecoveryDraft(current)).toEqual(current);
    expect(normalizePresentationRecoveryDraft({ ...current, schemaVersion: 3 }).schemaVersion).toBe(
      3,
    );
    expect(() => normalizePresentationRecoveryDraft({ ...current, schemaVersion: 4 })).toThrow();
    expect(() =>
      normalizePresentationRecoveryDraft({ schemaVersion: 1, blocks: "invalid" }),
    ).toThrow();
  });

  it("preserves schema3 frozen Pack baselines through local recovery, type changes, duplication and deletion", () => {
    const current = draft();
    const diagnostic = current.blocks[1]!;
    if (diagnostic.kind !== "question") throw new Error("Expected a question");
    diagnostic.question.explanation = "Review the evidence before deciding.";
    diagnostic.question.conceptKeys = ["evidence"];
    const recheck = {
      id: randomUUID(),
      kind: "question" as const,
      question: {
        ...structuredClone(diagnostic.question),
        id: randomUUID(),
        prompt: "Which signal explains this new case?",
        delivery: "recheck" as const,
        linkedRecheckQuestionId: null,
      },
    };
    if ("choices" in recheck.question) {
      recheck.question.choices = recheck.question.choices.map((choice) => ({
        ...choice,
        id: randomUUID(),
      }));
    }
    diagnostic.question.linkedRecheckQuestionId = recheck.question.id;
    const content = RecoveryPackContentSchema.parse(
      recoveryPackDraftFromPair(
        "Evidence recovery",
        diagnostic.question,
        recheck.question,
        randomUUID(),
      ),
    );
    const baseline = {
      id: randomUUID(),
      packId: randomUUID(),
      packVersionId: randomUUID(),
      packVersion: 1,
      contentHash: recoveryPackContentHash(content),
      diagnosticQuestionId: diagnostic.question.id,
      recheckQuestionId: recheck.question.id,
      originalContent: content,
    };
    diagnostic.question.recoveryPackSource = {
      artifactType: "recovery_pack",
      packId: baseline.packId,
      packVersionId: baseline.packVersionId,
      packVersion: baseline.packVersion,
      contentHash: baseline.contentHash,
      sourceItemId: content.diagnostic.id,
      role: "diagnostic",
    };
    const withPack: PresentationDraft = {
      ...current,
      schemaVersion: 3,
      blocks: [...current.blocks, recheck],
      recoveryPackInsertions: [baseline],
    };
    expect(normalizePresentationRecoveryDraft(withPack).recoveryPackInsertions).toEqual([baseline]);
    const changed = changePresentationQuestionType(withPack, diagnostic.id, "numeric");
    const changedDiagnostic = changed.blocks.find((block) => block.id === diagnostic.id);
    expect(
      changedDiagnostic?.kind === "question" && changedDiagnostic.question.recoveryPackSource,
    ).toEqual(diagnostic.question.recoveryPackSource);
    expect(changed.recoveryPackInsertions).toEqual([baseline]);
    const duplicated = {
      ...withPack,
      blocks: [...withPack.blocks, duplicatePresentationBlock(diagnostic)],
    };
    expect(normalizePresentationRecoveryDraft(duplicated).recoveryPackInsertions).toEqual([
      baseline,
    ]);
    const removed = removePresentationBlock(
      removePresentationBlock(withPack, recheck.id),
      diagnostic.id,
    );
    expect(normalizePresentationRecoveryDraft(removed).recoveryPackInsertions).toEqual([baseline]);
    expect(removed.schemaVersion).toBe(3);
  });

  it("creates response-specific defaults without conflating opinion and diagnostic blocks", () => {
    const poll = createPresentationQuestion("poll");
    const numeric = createPresentationQuestion("numeric");
    const rating = createPresentationQuestion("rating");

    expect(poll).toMatchObject({ purpose: "opinion", basePoints: 0, confidence: "off" });
    expect("choices" in poll && poll.choices).toHaveLength(4);
    expect(numeric).toMatchObject({
      purpose: "diagnostic",
      basePoints: 1_000,
      correctValue: "",
      tolerance: "0",
    });
    expect(rating).toMatchObject({ purpose: "opinion", basePoints: 0, min: 1, max: 5 });
  });

  it("reports a publish-ready structured deck", () => {
    expect(presentationReadiness(draft())).toEqual([]);
  });

  it("returns actionable readiness issues for an incomplete or inaccessible deck", () => {
    const content = createContentBlock("media");
    content.mediaId = "media-1";
    const question = createQuestionBlock("numeric");
    question.question.mediaId = "media-2";
    const incomplete: PresentationDraft = {
      title: "",
      description: "",
      experiencePreset: { id: "focus", version: 1 },
      schemaVersion: 2,
      blocks: [content, question],
    };

    expect(presentationReadiness(incomplete).map((issue) => issue.message)).toEqual(
      expect.arrayContaining([
        "Give this presentation a title.",
        "Add alternative text for the slide image.",
        "Write the question prompt.",
        "Enter the correct numeric value.",
        "Add alternative text for the question image.",
      ]),
    );
  });

  it("moves and removes blocks without mutating the source", () => {
    const source = draft();
    const second = source.blocks[1]!;
    const moved = movePresentationBlock(source, second.id, -1);
    expect(moved.blocks[0]?.id).toBe(second.id);
    expect(source.blocks[0]?.id).not.toBe(second.id);
    expect(removePresentationBlock(moved, second.id).blocks).toHaveLength(1);
  });

  it("treats invalid and boundary moves as stable no-ops", () => {
    const source = draft();
    expect(movePresentationBlock(source, source.blocks[0]!.id, -1)).toBe(source);
    expect(movePresentationBlock(source, "missing-block", 1)).toBe(source);
    expect(movePresentationBlock(source, source.blocks.at(-1)!.id, 1)).toBe(source);
  });

  it("clears a diagnostic link when its recheck block is removed", () => {
    const main = createQuestionBlock();
    const recheck = createQuestionBlock();
    main.question.linkedRecheckQuestionId = recheck.question.id;
    recheck.question.delivery = "recheck";
    const source: PresentationDraft = {
      title: "Recovery pair",
      description: "",
      experiencePreset: { id: "focus", version: 1 },
      schemaVersion: 2,
      blocks: [main, recheck],
    };

    const updated = removePresentationBlock(source, recheck.id);
    expect(updated.blocks).toHaveLength(1);
    expect(updated.blocks[0]?.kind).toBe("question");
    if (updated.blocks[0]?.kind === "question") {
      expect(updated.blocks[0].question.linkedRecheckQuestionId).toBeNull();
    }
    expect(main.question.linkedRecheckQuestionId).toBe(recheck.question.id);
  });

  it("duplicates questions with independent IDs", () => {
    const source = draft().blocks[1]!;
    const copy = duplicatePresentationBlock(source);
    expect(copy.id).not.toBe(source.id);
    if (source.kind === "question" && copy.kind === "question") {
      expect(copy.question.id).not.toBe(source.question.id);
      if ("choices" in source.question && "choices" in copy.question) {
        expect(copy.question.choices[0]?.id).not.toBe(source.question.choices[0]?.id);
      }
      expect(copy.question.linkedRecheckQuestionId).toBeNull();
    }
  });

  it("duplicates content without sharing its block identity", () => {
    const source = createContentBlock("callout");
    source.textElements[0] = { ...source.textElements[0]!, text: "Remember" };
    source.textElements[1] = {
      ...source.textElements[1]!,
      text: "Use the evidence before choosing an intervention.",
    };
    const copy = duplicatePresentationBlock(source);

    expect(copy).toEqual({
      ...source,
      id: expect.any(String),
      textElements: source.textElements.map((element) => ({ ...element, id: expect.any(String) })),
    });
    expect(copy.id).not.toBe(source.id);
    if (copy.kind === "content") {
      expect(copy.textElements.map((element) => element.id)).not.toEqual(
        source.textElements.map((element) => element.id),
      );
    }
  });

  it("adds, moves, reorders, removes, and lays out text elements without overlap", () => {
    const original = createContentBlock("title_body");
    const title = original.textElements.find((element) => element.role === "title")!;
    const firstBody = original.textElements.find((element) => element.role === "body")!;
    const secondBody = createContentTextElement();
    const withSecond = addContentTextElement(original, secondBody);

    expect(withSecond.textElements).toHaveLength(3);
    expect(withSecond.textElements.map((element) => element.id)).toEqual([
      ...original.textElements.map((element) => element.id),
      secondBody.id,
    ]);
    let atLimit = withSecond;
    while (atLimit.textElements.length < 8) {
      atLimit = addContentTextElement(atLimit, createContentTextElement());
    }
    expect(atLimit.textElements).toHaveLength(8);
    expect(addContentTextElement(atLimit, createContentTextElement()).textElements).toHaveLength(8);

    const moved = moveContentTextElement(withSecond, title.id, "bottom_left");
    expect(moved.textElements.find((element) => element.id === title.id)?.region).toBe(
      "bottom_left",
    );
    const stacked = moveContentTextElement(moved, secondBody.id, "middle_center");
    expect(
      stacked.textElements
        .filter((element) => element.region === "middle_center")
        .map((element) => element.order)
        .sort(),
    ).toEqual([0, 1]);

    const reordered = reorderContentTextElement(stacked, secondBody.id, -1);
    expect(reordered.textElements.find((element) => element.id === secondBody.id)?.order).toBe(0);
    expect(removeContentTextElement(reordered, secondBody.id).textElements).toHaveLength(2);
    expect(removeContentTextElement(original, title.id)).toBe(original);

    const section = applyContentSlideLayout(withSecond, "section");
    expect(section.layout).toBe("section");
    expect(section.textElements.find((element) => element.role === "title")?.region).toBe(
      "middle_center",
    );
    expect(section.textElements.find((element) => element.role === "body")?.region).toBe(
      "bottom_center",
    );
    expect(contentSlideTitle(section)).toBe("");
    expect(firstBody.role).toBe("body");
  });

  it("preserves question identity when changing response type", () => {
    const source = draft();
    const question = source.blocks.find((block) => block.kind === "question");
    expect(question?.kind).toBe("question");
    if (question?.kind !== "question") return;

    const updated = changePresentationQuestionType(source, question.id, "numeric");
    const changed = updated.blocks.find((block) => block.id === question.id);
    expect(changed?.kind).toBe("question");
    if (changed?.kind === "question") {
      expect(changed.question.id).toBe(question.question.id);
      expect(changed.question.type).toBe("numeric");
    }
  });

  it("rejects multiple-selection poll publication and clears its limit when changing formats", () => {
    const source = draft();
    const block = source.blocks.find((candidate) => candidate.kind === "question")!;
    if (block.kind !== "question" || !("choices" in block.question)) return;
    block.question = {
      ...block.question,
      type: "poll",
      purpose: "opinion",
      confidence: "off",
      basePoints: 0,
      maxSelections: 2,
      choices: block.question.choices.map((choice) => ({ ...choice, isCorrect: false })),
    };
    expect(
      presentationReadiness(source).some((issue) => issue.message.includes("live Rounds only")),
    ).toBe(true);
    const changed = changePresentationQuestionType(source, block.id, "rating");
    const updated = changed.blocks.find((candidate) => candidate.id === block.id)!;
    expect(updated.kind === "question" && "maxSelections" in updated.question).toBe(false);
  });

  it("clears inbound recovery links when a recheck becomes an opinion question", () => {
    const main = createQuestionBlock();
    const recheck = createQuestionBlock();
    main.question.linkedRecheckQuestionId = recheck.question.id;
    recheck.question.delivery = "recheck";
    const source: PresentationDraft = {
      title: "Recovery pair",
      description: "",
      experiencePreset: { id: "focus", version: 1 },
      schemaVersion: 2,
      blocks: [main, recheck],
    };

    const updated = changePresentationQuestionType(source, recheck.id, "poll");
    const updatedMain = updated.blocks[0];
    const updatedRecheck = updated.blocks[1];
    expect(updatedMain?.kind).toBe("question");
    expect(updatedRecheck?.kind).toBe("question");
    if (updatedMain?.kind === "question" && updatedRecheck?.kind === "question") {
      expect(updatedMain.question.linkedRecheckQuestionId).toBeNull();
      expect(updatedRecheck.question.id).toBe(recheck.question.id);
      expect(updatedRecheck.question.delivery).toBe("main");
      expect(updatedRecheck.question.linkedRecheckQuestionId).toBeNull();
    }
    expect(main.question.linkedRecheckQuestionId).toBe(recheck.question.id);
  });

  it("promotes a detached recheck when its diagnostic becomes an opinion question", () => {
    const main = createQuestionBlock();
    const recheck = createQuestionBlock();
    main.question.linkedRecheckQuestionId = recheck.question.id;
    recheck.question.delivery = "recheck";
    const source: PresentationDraft = {
      title: "Recovery pair",
      description: "",
      experiencePreset: { id: "focus", version: 1 },
      schemaVersion: 2,
      blocks: [main, recheck],
    };

    const updated = changePresentationQuestionType(source, main.id, "rating");
    const updatedMain = updated.blocks[0];
    const updatedRecheck = updated.blocks[1];
    expect(updatedMain?.kind).toBe("question");
    expect(updatedRecheck?.kind).toBe("question");
    if (updatedMain?.kind === "question" && updatedRecheck?.kind === "question") {
      expect(updatedMain.question.id).toBe(main.question.id);
      expect(updatedMain.question.linkedRecheckQuestionId).toBeNull();
      expect(updatedRecheck.question.delivery).toBe("main");
    }
  });

  it("rejects a recovery link that does not target a recheck", () => {
    const source = draft();
    const questions = source.blocks.filter((block) => block.kind === "question");
    const main = questions[0];
    expect(main?.kind).toBe("question");
    if (main?.kind !== "question") return;
    main.question.linkedRecheckQuestionId = main.question.id;

    expect(presentationReadiness(source)).toContainEqual({
      blockId: main.id,
      field: "linkedRecheckQuestionId",
      message: "Choose a valid recheck question.",
    });
  });
});
