import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { recoveryPackDraftFromPair } from "./recovery-packs";
import {
  addContentTextElement,
  addPresentationSection,
  applyContentSlideLayout,
  assignPresentationBlockToSection,
  canMovePresentationBlock,
  changePresentationQuestionType,
  contentSlideTitle,
  createContentBlock,
  createContentTextElement,
  createPresentationQuestion,
  createQuestionBlock,
  duplicatePresentationBlock,
  enablePresentationSections,
  insertPresentationBlockDuplicate,
  movePresentationBlock,
  moveContentTextElement,
  normalizePresentationRecoveryDraft,
  presentationReadiness,
  presentationSectionForBlock,
  promotePresentationOpinionFormats,
  removeContentTextElement,
  reorderContentTextElement,
  removePresentationBlock,
  removePresentationSection,
  renamePresentationSection,
  setContentTextElementFrame,
  setContentSlideMedia,
  setPresentationSlideHidden,
  updatePresentationQuestion,
} from "./presentation-builder";
import { createNativeContentBlock } from "./presentation-native-scene";
import { removeQuestionChoice, type ChoiceQuestionDraft } from "../components/editor/types";
import {
  PresentationContentSchema,
  PresentationDraftSchema,
  preparePresentationPublication,
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
  it("accepts a complete content-only deck while retaining empty-slide validation", () => {
    const source = draft();
    source.blocks = source.blocks.filter((block) => block.kind === "content");
    expect(presentationReadiness(source)).toEqual([]);

    source.blocks = [];
    expect(presentationReadiness(source)).toContainEqual({
      blockId: null,
      field: "blocks",
      message: "Add at least one slide.",
    });

    const emptySlide = createContentBlock();
    source.blocks = [emptySlide];
    expect(presentationReadiness(source)).toContainEqual({
      blockId: emptySlide.id,
      field: "textElements",
      message: "Add content to this slide.",
    });
  });

  it("still rejects an orphan recheck in a deck with content slides", () => {
    const source = draft();
    const question = source.blocks.find((block) => block.kind === "question")!;
    question.question.delivery = "recheck";
    expect(
      presentationReadiness(source).some((issue) =>
        issue.message.includes("main interactive question"),
      ),
    ).toBe(true);
    expect(
      presentationReadiness(source).some((issue) =>
        issue.message.includes("Every recheck must be linked"),
      ),
    ).toBe(true);
  });

  it.each(["open_text", "word_cloud"] as const)(
    "creates %s opinions without incompatible answer fields and opts into document v10",
    (type) => {
      const original = draft();
      const block = original.blocks[1]!;
      const next = changePresentationQuestionType(original, block.id, type);
      expect(next.schemaVersion).toBe(10);
      const question = next.blocks[1]!;
      if (question.kind !== "question") throw new Error("Expected text question");
      expect(question.question).toMatchObject({
        id: block.kind === "question" ? block.question.id : "",
        type,
        purpose: "opinion",
        confidence: "off",
        basePoints: 0,
        delivery: "main",
        linkedRecheckQuestionId: null,
      });
      expect(question.question).not.toHaveProperty("choices");
      expect(question.question).not.toHaveProperty("correctValue");
      expect(presentationReadiness(next)).toEqual([]);
      expect(original.schemaVersion).toBe(2);
      const duplicate = duplicatePresentationBlock(question);
      expect(duplicate.id).not.toBe(question.id);
      if (duplicate.kind !== "question") throw new Error("Expected duplicate question");
      expect(duplicate.question.id).not.toBe(question.question.id);
      expect(duplicate.question).toMatchObject({ type, purpose: "opinion" });
      const restored = promotePresentationOpinionFormats(original, next.schemaVersion);
      expect(restored.schemaVersion).toBe(10);
      expect(normalizePresentationRecoveryDraft(next)).toEqual(next);
      const removed = removePresentationBlock(next, question.id);
      expect(removed.schemaVersion).toBe(10);
      expect(promotePresentationOpinionFormats(removed)).toBe(removed);
    },
  );
  it("creates full rankings as unscored opinions and requires their explicit document opt-in", () => {
    const ranking = createPresentationQuestion("ranking");
    expect(ranking).toMatchObject({
      type: "ranking",
      purpose: "opinion",
      confidence: "off",
      basePoints: 0,
      delivery: "main",
      linkedRecheckQuestionId: null,
    });
    expect(ranking).not.toHaveProperty("rankCount");
    expect("choices" in ranking && ranking.choices.every((choice) => !choice.isCorrect)).toBe(true);
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
      presentationReadiness(source).some((issue) => issue.message.includes("schema version 9")),
    ).toBe(true);
    expect(presentationReadiness(promotePresentationOpinionFormats(source))).toEqual([]);
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
    expect(normalizePresentationRecoveryDraft({ ...current, schemaVersion: 5 }).schemaVersion).toBe(
      5,
    );
    expect(normalizePresentationRecoveryDraft({ ...current, schemaVersion: 6 }).schemaVersion).toBe(
      6,
    );
    expect(normalizePresentationRecoveryDraft({ ...current, schemaVersion: 7 }).schemaVersion).toBe(
      7,
    );
    expect(normalizePresentationRecoveryDraft({ ...current, schemaVersion: 8 }).schemaVersion).toBe(
      8,
    );
    expect(normalizePresentationRecoveryDraft({ ...current, schemaVersion: 9 }).schemaVersion).toBe(
      9,
    );
    expect(
      normalizePresentationRecoveryDraft({ ...current, schemaVersion: 10 }).schemaVersion,
    ).toBe(10);
    expect(
      normalizePresentationRecoveryDraft({ ...current, schemaVersion: 11 }).schemaVersion,
    ).toBe(11);
    expect(
      normalizePresentationRecoveryDraft({ ...current, schemaVersion: 12 }).schemaVersion,
    ).toBe(12);
    expect(
      normalizePresentationRecoveryDraft({ ...current, schemaVersion: 13 }).schemaVersion,
    ).toBe(13);
    expect(() => normalizePresentationRecoveryDraft({ ...current, schemaVersion: 14 })).toThrow();
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

  it("opts into sections explicitly and retains document v12 when restoring earlier history", () => {
    const original = draft();
    expect(promotePresentationOpinionFormats(original)).toBe(original);
    const enabled = enablePresentationSections(original);
    expect(enabled).toMatchObject({ schemaVersion: 12, sections: [] });
    expect(enabled.blocks).toBe(original.blocks);
    expect(original).not.toHaveProperty("sections");
    expect(enablePresentationSections(enabled)).toBe(enabled);
    const restored = promotePresentationOpinionFormats(original, enabled.schemaVersion);
    expect(restored).toMatchObject({ schemaVersion: 12, sections: [] });
    expect(restored.blocks).toBe(original.blocks);
    expect(PresentationContentSchema.safeParse(restored).success).toBe(true);
    expect(normalizePresentationRecoveryDraft(restored)).toEqual(restored);
  });

  it("adds, renames and removes sections without moving or deleting their blocks", () => {
    const original = draft();
    const id = randomUUID();
    const added = addPresentationSection(original, id, "  Evidence  ");
    expect(added.sections).toEqual([{ id, title: "Evidence", blockIds: [] }]);
    expect(added.blocks).toBe(original.blocks);
    const assigned = assignPresentationBlockToSection(added, original.blocks[0]!.id, id);
    const renamed = renamePresentationSection(assigned, id, "  Discuss\n\t\u007f  ");
    expect(renamed.sections?.[0]).toEqual({
      id,
      title: "Discuss",
      blockIds: [original.blocks[0]!.id],
    });
    expect(renamePresentationSection(renamed, id, "Discuss")).toBe(renamed);
    const longTitle = renamePresentationSection(renamed, id, "a".repeat(121));
    expect(longTitle.sections?.[0]?.title).toHaveLength(120);
    const removed = removePresentationSection(renamed, id);
    expect(removed.sections).toEqual([]);
    expect(removed.blocks).toBe(original.blocks);
    expect(removed.schemaVersion).toBe(12);
    expect(assigned.sections?.[0]?.title).toBe("Evidence");
    expect(PresentationDraftSchema.safeParse(renamed).success).toBe(true);
  });

  it("moves section membership atomically while the numbered sequence remains authoritative", () => {
    const first = randomUUID();
    const second = randomUUID();
    const source = addPresentationSection(addPresentationSection(draft(), first), second);
    const block = source.blocks[0]!;
    const assigned = assignPresentationBlockToSection(source, block.id, first);
    expect(assignPresentationBlockToSection(assigned, block.id, first)).toBe(assigned);
    const moved = assignPresentationBlockToSection(assigned, block.id, second);
    expect(moved.sections?.map((section) => section.blockIds)).toEqual([[], [block.id]]);
    expect(moved.blocks).toBe(source.blocks);
    const reordered = movePresentationBlock(moved, block.id, 1);
    expect(reordered.sections).toBe(moved.sections);
    expect(reordered.blocks.map((block) => block.id)).toEqual([source.blocks[1]!.id, block.id]);
    expect(normalizePresentationRecoveryDraft(reordered)).toEqual(reordered);
    const unsectioned = assignPresentationBlockToSection(reordered, block.id, null);
    expect(unsectioned.sections?.map((section) => section.blockIds)).toEqual([[], []]);
    expect(PresentationDraftSchema.safeParse(unsectioned).success).toBe(true);
  });

  it("duplicates sectioned blocks with fresh identities and prunes membership on deletion", () => {
    const sectionId = randomUUID();
    const original = draft();
    const block = original.blocks[0]!;
    const source = assignPresentationBlockToSection(
      addPresentationSection(original, sectionId),
      block.id,
      sectionId,
    );
    const copy = duplicatePresentationBlock(block);
    const duplicated = insertPresentationBlockDuplicate(source, block.id, copy);
    expect(duplicated.blocks.map((block) => block.id)).toEqual([
      block.id,
      copy.id,
      original.blocks[1]!.id,
    ]);
    expect(duplicated.sections).toEqual([
      { id: sectionId, title: "New section", blockIds: [block.id, copy.id] },
    ]);
    expect(insertPresentationBlockDuplicate(duplicated, block.id, copy)).toBe(duplicated);
    const removed = removePresentationBlock(duplicated, block.id);
    expect(removed.sections?.[0]?.blockIds).toEqual([copy.id]);
    expect(PresentationDraftSchema.safeParse(removed).success).toBe(true);
    expect(source.sections?.[0]?.blockIds).toEqual([block.id]);
    const empty = removePresentationBlock(removed, copy.id);
    expect(empty.sections?.[0]?.blockIds).toEqual([]);
    expect(PresentationDraftSchema.safeParse(empty).success).toBe(true);
    expect(preparePresentationPublication(empty).sections).toEqual([]);
  });

  it("preserves hidden memberships in history while readiness only validates published sections", () => {
    const original = draft();
    const sectionId = randomUUID();
    const block = original.blocks[0]!;
    const assigned = assignPresentationBlockToSection(
      addPresentationSection(original, sectionId, ""),
      block.id,
      sectionId,
    );
    expect(presentationReadiness(assigned).some((issue) => issue.field === "sections")).toBe(true);
    const hidden = setPresentationSlideHidden(assigned, block.id, true);
    expect(hidden.schemaVersion).toBe(12);
    expect(hidden.sections?.[0]?.blockIds).toEqual([block.id]);
    expect(presentationReadiness(hidden)).toEqual([]);
    expect(preparePresentationPublication(hidden).sections).toEqual([]);
    expect(normalizePresentationRecoveryDraft(hidden)).toEqual(hidden);
    const shown = setPresentationSlideHidden(hidden, block.id, false);
    expect(shown.sections).toBe(hidden.sections);
    expect(presentationReadiness(shown).some((issue) => issue.field === "sections")).toBe(true);
  });

  it("resolves valid UUID membership casing consistently when assigning, copying and deleting", () => {
    const original = draft();
    const block = original.blocks[0]!;
    const sectionId = randomUUID();
    const source: PresentationDraft = {
      ...original,
      schemaVersion: 12,
      sections: [{ id: sectionId, title: "Evidence", blockIds: [block.id.toUpperCase()] }],
    };
    expect(presentationSectionForBlock(source.sections, block.id)?.id).toBe(sectionId);
    expect(assignPresentationBlockToSection(source, block.id, sectionId.toUpperCase())).toBe(
      source,
    );
    const copy = duplicatePresentationBlock(block);
    const duplicated = insertPresentationBlockDuplicate(source, block.id, copy);
    expect(duplicated.sections?.[0]?.blockIds).toEqual([block.id.toUpperCase(), copy.id]);
    expect(removePresentationBlock(duplicated, block.id).sections?.[0]?.blockIds).toEqual([
      copy.id,
    ]);
    expect(
      assignPresentationBlockToSection(source, block.id, null).sections?.[0]?.blockIds,
    ).toEqual([]);
  });

  it("keeps invalid section edits and capacity boundaries as stable no-ops", () => {
    const source = enablePresentationSections(draft());
    const missing = randomUUID();
    expect(renamePresentationSection(source, missing, "Evidence")).toBe(source);
    expect(removePresentationSection(source, missing)).toBe(source);
    expect(assignPresentationBlockToSection(source, source.blocks[0]!.id, missing)).toBe(source);
    expect(assignPresentationBlockToSection(source, missing, null)).toBe(source);
    expect(assignPresentationBlockToSection(source, source.blocks[0]!.id, null)).toBe(source);
    const full = {
      ...source,
      sections: Array.from({ length: 50 }, () => ({
        id: randomUUID(),
        title: "Section",
        blockIds: [],
      })),
    };
    expect(addPresentationSection(full, randomUUID())).toBe(full);
    expect(addPresentationSection(full, full.sections[0]!.id)).toBe(full);
    const one = addPresentationSection(source, missing);
    expect(addPresentationSection(one, missing.toUpperCase())).toBe(one);
    expect(
      insertPresentationBlockDuplicate(
        source,
        missing,
        duplicatePresentationBlock(source.blocks[0]!),
      ),
    ).toBe(source);
    const fullDeck = { ...source, blocks: Array.from({ length: 200 }, () => createContentBlock()) };
    expect(
      insertPresentationBlockDuplicate(fullDeck, fullDeck.blocks[0]!.id, createContentBlock()),
    ).toBe(fullDeck);
  });

  function linkedDraft(): PresentationDraft {
    const main = createQuestionBlock("numeric");
    const recheck = createQuestionBlock("numeric");
    for (const block of [main, recheck]) {
      block.question.prompt = "How much evidence?";
      if (block.question.type === "numeric") block.question.correctValue = "2";
    }
    main.question.linkedRecheckQuestionId = recheck.question.id;
    recheck.question.delivery = "recheck";
    const hidden = createContentBlock();
    return {
      ...draft(),
      schemaVersion: 6,
      blocks: [main, { ...hidden, hidden: true }, recheck],
    };
  }

  it("keeps linked question order while permitting moves across hidden visual slides", () => {
    const source = linkedDraft();
    const [main, hidden, recheck] = source.blocks;
    expect(
      PresentationContentSchema.safeParse({ ...source, blocks: [main, recheck] }).success,
    ).toBe(true);
    expect(canMovePresentationBlock(source, main!.id, 1)).toBe(true);
    const adjacent = movePresentationBlock(source, main!.id, 1);
    expect(adjacent.blocks.map((block) => block.id)).toEqual([hidden!.id, main!.id, recheck!.id]);
    expect(canMovePresentationBlock(adjacent, main!.id, 1)).toBe(false);
    expect(canMovePresentationBlock(adjacent, recheck!.id, -1)).toBe(false);
    expect(movePresentationBlock(adjacent, main!.id, 1)).toBe(adjacent);
    expect(movePresentationBlock(adjacent, recheck!.id, -1)).toBe(adjacent);
    expect(presentationReadiness(adjacent)).toEqual([]);
    expect(source.blocks[0]).toBe(main);
  });

  it("keeps valid question delivery after duplicating or deleting either end of a linked pair", () => {
    const source = linkedDraft();
    const main = source.blocks[0]!;
    const recheck = source.blocks[2]!;
    const duplicate = duplicatePresentationBlock(recheck);
    expect(duplicate.kind === "question" && duplicate.question.delivery).toBe("main");
    expect(presentationReadiness({ ...source, blocks: [...source.blocks, duplicate] })).toEqual([]);
    const withoutMain = removePresentationBlock(source, main.id);
    expect(
      withoutMain.blocks[1]?.kind === "question" && withoutMain.blocks[1].question.delivery,
    ).toBe("main");
    expect(presentationReadiness(withoutMain)).toEqual([]);
    const withoutRecheck = removePresentationBlock(source, recheck.id);
    expect(
      withoutRecheck.blocks[0]?.kind === "question" &&
        withoutRecheck.blocks[0].question.linkedRecheckQuestionId,
    ).toBeNull();
    expect(presentationReadiness(withoutRecheck)).toEqual([]);
    expect(recheck.kind === "question" && recheck.question.delivery).toBe("recheck");
  });

  it("only demotes an orphaned recheck after its final diagnostic is removed", () => {
    const source = linkedDraft();
    const first = source.blocks[0]!;
    const second = duplicatePresentationBlock(first);
    if (first.kind !== "question" || second.kind !== "question")
      throw new Error("Expected questions");
    second.question.linkedRecheckQuestionId = first.question.linkedRecheckQuestionId;
    const withTwoSources = { ...source, blocks: [first, second, ...source.blocks.slice(1)] };
    const oneSource = removePresentationBlock(withTwoSources, first.id);
    const stillPaired = oneSource.blocks.at(-1);
    expect(stillPaired?.kind === "question" && stillPaired.question.delivery).toBe("recheck");
    const noSources = removePresentationBlock(oneSource, second.id);
    const standalone = noSources.blocks.at(-1);
    expect(standalone?.kind === "question" && standalone.question.delivery).toBe("main");
  });

  it("atomically hides legacy and native slides without lowering document versions when restored", () => {
    for (const block of [createContentBlock(), createNativeContentBlock()]) {
      const source = {
        ...draft(),
        schemaVersion: block.scene ? (4 as const) : (2 as const),
        blocks: [block],
      };
      const hidden = setPresentationSlideHidden(source, block.id, true);
      expect(hidden.schemaVersion).toBe(6);
      expect(hidden.blocks[0]).toHaveProperty("hidden", true);
      expect(PresentationDraftSchema.safeParse(hidden).success).toBe(true);
      expect(setPresentationSlideHidden(hidden, block.id, true)).toBe(hidden);
      const restored = setPresentationSlideHidden(hidden, block.id, false);
      expect(restored.schemaVersion).toBe(6);
      expect(restored.blocks[0]).not.toHaveProperty("hidden");
      expect(block).not.toHaveProperty("hidden");
      expect(duplicatePresentationBlock(hidden.blocks[0]!)).toHaveProperty("hidden", true);
    }
    const source = draft();
    expect(setPresentationSlideHidden(source, source.blocks[1]!.id, true)).toBe(source);
  });

  it("validates only visible slides and maps compacted publication errors to their original IDs", () => {
    const hidden = { ...createContentBlock(), hidden: true as const };
    const invalid = createNativeContentBlock();
    const source: PresentationDraft = { ...draft(), schemaVersion: 6, blocks: [hidden, invalid] };
    const issues = presentationReadiness(source);
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.every((issue) => issue.blockId !== hidden.id)).toBe(true);
    expect(issues.some((issue) => issue.blockId === invalid.id)).toBe(true);
    expect(
      presentationReadiness({ ...source, blocks: [hidden] }).some((issue) =>
        issue.message.includes("Show a slide or add an activity"),
      ),
    ).toBe(true);
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

  it("opts multiple-selection polls into v9 and clears their limit when changing formats", () => {
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
      presentationReadiness(source).some((issue) => issue.message.includes("schema version 9")),
    ).toBe(true);
    const optedIn = promotePresentationOpinionFormats(source);
    expect(optedIn.schemaVersion).toBe(9);
    expect(presentationReadiness(optedIn)).toEqual([]);
    const changed = changePresentationQuestionType(optedIn, block.id, "rating");
    expect(changed.schemaVersion).toBe(9);
    const updated = changed.blocks.find((candidate) => candidate.id === block.id)!;
    expect(updated.kind === "question" && "maxSelections" in updated.question).toBe(false);
  });

  it("keeps old defaults unchanged until an actual new format is written and retains v9 history", () => {
    const original = draft();
    expect(promotePresentationOpinionFormats(original)).toBe(original);
    const block = original.blocks[1]!;
    const poll = changePresentationQuestionType(original, block.id, "poll");
    expect(poll.schemaVersion).toBe(2);
    const ranked = changePresentationQuestionType(original, block.id, "ranking");
    expect(ranked.schemaVersion).toBe(9);
    const checkpoint = promotePresentationOpinionFormats(original, ranked.schemaVersion);
    expect(checkpoint.schemaVersion).toBe(9);
    expect(checkpoint.blocks).toBe(original.blocks);
    expect(normalizePresentationRecoveryDraft(checkpoint)).toEqual(checkpoint);
    const withoutQuestion = removePresentationBlock(ranked, block.id);
    expect(withoutQuestion.schemaVersion).toBe(9);
    expect(promotePresentationOpinionFormats(withoutQuestion)).toBe(withoutQuestion);
    const slide = original.blocks[0]!;
    expect(setPresentationSlideHidden(checkpoint, slide.id, true).schemaVersion).toBe(9);
  });

  it("clears hidden legacy poll answers and recovery settings when enabling multiple selections", () => {
    const source = draft();
    const poll = source.blocks[1]!;
    if (poll.kind !== "question" || !("choices" in poll.question))
      throw new Error("Expected choices");
    const recheck = createQuestionBlock();
    recheck.question.delivery = "recheck";
    poll.question = {
      ...poll.question,
      type: "poll",
      linkedRecheckQuestionId: recheck.question.id,
    };
    source.blocks.push(recheck);
    const changed = updatePresentationQuestion(source, poll.id, (question) =>
      question.type === "poll" ? { ...question, maxSelections: 2 } : question,
    );
    expect(changed.schemaVersion).toBe(9);
    const updated = changed.blocks[1]!;
    if (updated.kind !== "question" || updated.question.type !== "poll")
      throw new Error("Expected poll");
    expect(updated.question).toMatchObject({
      purpose: "opinion",
      confidence: "off",
      basePoints: 0,
      delivery: "main",
      linkedRecheckQuestionId: null,
      maxSelections: 2,
    });
    expect(updated.question.choices.every((choice) => !choice.isCorrect)).toBe(true);
    const target = changed.blocks[2]!;
    expect(target.kind === "question" && target.question.delivery).toBe("main");
    expect(PresentationDraftSchema.safeParse(changed).success).toBe(true);
    expect(poll.question.choices.some((choice) => choice.isCorrect)).toBe(true);
  });

  it("retains choice IDs and labels through compatible type changes while clearing opinion answers", () => {
    const original = draft();
    const block = original.blocks[1]!;
    if (block.kind !== "question" || !("choices" in block.question))
      throw new Error("Expected choices");
    block.question.confidence = "required";
    const originalChoices = block.question.choices.map(({ id, label }) => ({ id, label }));
    const ranked = changePresentationQuestionType(original, block.id, "ranking");
    const ranking = ranked.blocks[1]!;
    if (ranking.kind !== "question" || ranking.question.type !== "ranking")
      throw new Error("Expected ranking");
    expect(ranking.question.choices.map(({ id, label }) => ({ id, label }))).toEqual(
      originalChoices,
    );
    expect(ranking.question.choices.every((choice) => !choice.isCorrect)).toBe(true);
    expect(ranking.question).toMatchObject({
      purpose: "opinion",
      confidence: "off",
      basePoints: 0,
      delivery: "main",
      linkedRecheckQuestionId: null,
    });
    expect(presentationReadiness(ranked)).toEqual([]);
    const polled = changePresentationQuestionType(ranked, block.id, "poll");
    expect(polled.schemaVersion).toBe(9);
    const poll = polled.blocks[1]!;
    if (poll.kind !== "question" || poll.question.type !== "poll") throw new Error("Expected poll");
    expect(poll.question.choices.map(({ id, label }) => ({ id, label }))).toEqual(originalChoices);
    expect(poll.question.choices.every((choice) => !choice.isCorrect)).toBe(true);
    const diagnostic = changePresentationQuestionType(polled, block.id, "single_select");
    expect(diagnostic.schemaVersion).toBe(9);
    expect(presentationReadiness(diagnostic)).toEqual([]);
    const restored = diagnostic.blocks[1]!;
    expect(restored.kind === "question" && restored.question.purpose).toBe("diagnostic");
  });

  it.each(["poll", "ranking"] as const)(
    "keeps %s limits valid when choices are removed and retains the limit in independent copies",
    (type) => {
      const block = createQuestionBlock(type);
      if (block.question.type !== "poll" && block.question.type !== "ranking")
        throw new Error("Expected an opinion");
      let question: ChoiceQuestionDraft = {
        ...block.question,
        prompt: "Choose your preferred direction",
        choices: block.question.choices.map((choice, index) => ({
          ...choice,
          label: `Choice ${index + 1}`,
        })),
      };
      if (question.type === "poll") question.maxSelections = 4;
      else if (question.type === "ranking") question.rankCount = 4;
      for (const length of [3, 2]) {
        question = removeQuestionChoice(question, question.choices.at(-1)!.id);
        expect(question.choices).toHaveLength(length);
        expect(type === "poll" ? question.maxSelections : question.rankCount).toBe(length);
        const source = { ...draft(), schemaVersion: 9 as const, blocks: [{ ...block, question }] };
        expect(PresentationContentSchema.safeParse(source).success).toBe(true);
        const copied = duplicatePresentationBlock(source.blocks[0]!);
        if (copied.kind !== "question" || !("choices" in copied.question))
          throw new Error("Expected copied choices");
        expect(copied.question.id).not.toBe(question.id);
        expect(copied.question.choices.map((choice) => choice.label)).toEqual(
          question.choices.map((choice) => choice.label),
        );
        expect(
          copied.question.choices.some((choice) =>
            question.choices.some((original) => original.id === choice.id),
          ),
        ).toBe(false);
        expect(type === "poll" ? copied.question.maxSelections : copied.question.rankCount).toBe(
          length,
        );
      }
    },
  );

  it.each(["poll", "ranking", "open_text", "word_cloud"] as const)(
    "clears inbound recovery links when a recheck becomes a %s opinion",
    (type) => {
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

      const updated = changePresentationQuestionType(source, recheck.id, type);
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
    },
  );

  it.each(["rating", "ranking", "open_text", "word_cloud"] as const)(
    "promotes a detached recheck when its diagnostic becomes a %s opinion",
    (type) => {
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

      const updated = changePresentationQuestionType(source, main.id, type);
      const updatedMain = updated.blocks[0];
      const updatedRecheck = updated.blocks[1];
      expect(updatedMain?.kind).toBe("question");
      expect(updatedRecheck?.kind).toBe("question");
      if (updatedMain?.kind === "question" && updatedRecheck?.kind === "question") {
        expect(updatedMain.question.id).toBe(main.question.id);
        expect(updatedMain.question.linkedRecheckQuestionId).toBeNull();
        expect(updatedRecheck.question.delivery).toBe("main");
      }
    },
  );

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
