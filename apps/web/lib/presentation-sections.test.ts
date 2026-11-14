import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  PresentationDraftSchema,
  preparePresentationPublication,
  type PresentationDraft,
  type PresentationSection,
} from "@openround/contracts";
import {
  createContentBlock,
  createQuestionBlock,
  removePresentationSection,
} from "./presentation-builder";
import {
  addPresentationSectionAtBlock,
  canMovePresentationSection,
  movePresentationSection,
  presentationSectionRuns,
} from "./presentation-sections";
import { enablePresentationSpatial } from "./presentation-spatial-authoring";

function deck(count = 5): PresentationDraft {
  return {
    schemaVersion: 14,
    title: "Authored",
    description: "",
    experiencePreset: { id: "focus", version: 1 },
    blocks: Array.from({ length: count }, () => createContentBlock()),
    sections: [],
  };
}
function section(draft: PresentationDraft, title: string, indexes: number[]): PresentationSection {
  return { id: randomUUID(), title, blockIds: indexes.map((index) => draft.blocks[index]!.id) };
}

describe("Canonical section navigator runs", () => {
  it("reads noncontiguous legacy memberships in actual playback order, including unsectioned and empty runs", () => {
    const draft = deck();
    draft.sections = [
      section(draft, "Second listed", [3, 1]),
      section(draft, "First listed", [4, 0]),
      section(draft, "Empty", []),
    ];
    const before = structuredClone(draft);
    const runs = presentationSectionRuns(draft.blocks, draft.sections);
    expect(
      runs.map((run) => [run.section?.title ?? "Unsectioned", run.startIndex, run.continued]),
    ).toEqual([
      ["First listed", 0, false],
      ["Second listed", 1, false],
      ["Unsectioned", 2, false],
      ["Second listed", 3, true],
      ["First listed", 4, true],
      ["Empty", 5, false],
    ]);
    expect(runs.flatMap((run) => run.blocks)).toEqual(draft.blocks);
    expect(new Set(runs.map((run) => run.key)).size).toBe(runs.length);
    expect(draft).toEqual(before);
  });
  it("matches UUID casing while rendering contiguous runs", () => {
    const draft = deck(2);
    draft.sections = [
      {
        id: randomUUID(),
        title: "Same",
        blockIds: draft.blocks.map((block) => block.id.toUpperCase()).reverse(),
      },
    ];
    expect(presentationSectionRuns(draft.blocks, draft.sections)).toMatchObject([
      { startIndex: 0, continued: false, blocks: draft.blocks },
    ]);
  });
  it("starts a new section at the selected slide and splits only the selected contiguous run", () => {
    const draft = deck();
    draft.sections = [section(draft, "Original", [0, 1, 3, 4]), section(draft, "Boundary", [2])];
    const before = structuredClone(draft);
    const id = randomUUID();
    const next = addPresentationSectionAtBlock(draft, id, "  New section  ", draft.blocks[1]!.id);
    expect(next.sections).toEqual([
      {
        ...draft.sections[0],
        blockIds: [draft.blocks[0]!.id, draft.blocks[3]!.id, draft.blocks[4]!.id],
      },
      draft.sections[1],
      { id, title: "New section", blockIds: [draft.blocks[1]!.id] },
    ]);
    expect(next.blocks).toBe(draft.blocks);
    expect(PresentationDraftSchema.safeParse(next).success).toBe(true);
    expect(
      preparePresentationPublication(next).sections?.find((item) => item.id === id)?.blockIds,
    ).toEqual([draft.blocks[1]!.id]);
    expect(draft).toEqual(before);
  });
  it("includes the remaining unsectioned slides up to the next actual section boundary", () => {
    const draft = deck();
    draft.sections = [section(draft, "Next", [3, 4])];
    const id = randomUUID();
    const next = addPresentationSectionAtBlock(
      draft,
      id,
      "Here",
      draft.blocks[1]!.id.toUpperCase(),
    );
    expect(next.sections?.at(-1)?.blockIds).toEqual([draft.blocks[1]!.id, draft.blocks[2]!.id]);
    expect(next.blocks).toBe(draft.blocks);
    expect(removePresentationSection(next, id).blocks).toBe(draft.blocks);
  });
  it("supports empty drafts, the section cap, and duplicate identities without altering slides", () => {
    const draft = deck(0);
    const id = randomUUID();
    const empty = addPresentationSectionAtBlock(draft, id, "", null);
    expect(empty.sections).toEqual([{ id, title: "", blockIds: [] }]);
    expect(addPresentationSectionAtBlock(empty, id.toUpperCase(), "Duplicate", null)).toBe(empty);
    const full = {
      ...draft,
      sections: Array.from({ length: 50 }, () => section(draft, "Empty", [])),
    };
    expect(addPresentationSectionAtBlock(full, randomUUID(), "Beyond cap", null)).toBe(full);
  });
});

describe("Whole section moves", () => {
  it("moves complete contiguous runs while preserving exact blocks, members, spatial references and metadata", () => {
    const draft = enablePresentationSpatial(deck(5));
    draft.sections = [
      section(draft, "Opening", [0, 1]),
      section(draft, "Middle", [2, 3]),
      section(draft, "Closing", [4]),
    ];
    const before = structuredClone(draft);
    const moved = movePresentationSection(draft, draft.sections[1]!.id, -1);
    expect(moved.blocks.map((block) => block.id)).toEqual(
      [2, 3, 0, 1, 4].map((index) => draft.blocks[index]!.id),
    );
    expect(moved.sections).toBe(draft.sections);
    expect(moved.spatial).toBe(draft.spatial);
    moved.blocks.forEach((block) =>
      expect(block).toBe(draft.blocks.find((source) => source.id === block.id)),
    );
    expect(movePresentationSection(moved, draft.sections[1]!.id, 1)).toEqual(draft);
    expect(PresentationDraftSchema.safeParse(moved).success).toBe(true);
    expect(draft).toEqual(before);
  });
  it("offers a stable no-op for boundaries, empty sections, and noncontiguous sections or neighbors", () => {
    const draft = deck();
    draft.sections = [
      section(draft, "Separated", [0, 3]),
      section(draft, "Middle", [1, 2]),
      section(draft, "Empty", []),
    ];
    expect(canMovePresentationSection(draft, draft.sections[0]!.id, 1)).toBe(false);
    expect(movePresentationSection(draft, draft.sections[1]!.id, -1)).toBe(draft);
    expect(movePresentationSection(draft, draft.sections[2]!.id, 1)).toBe(draft);
    expect(movePresentationSection(draft, randomUUID(), 1)).toBe(draft);
    const simple = deck(2);
    simple.sections = [section(simple, "Only", [0, 1])];
    expect(movePresentationSection(simple, simple.sections[0]!.id, -1)).toBe(simple);
    expect(movePresentationSection(simple, simple.sections[0]!.id, 1)).toBe(simple);
  });
  it("does not reverse a source checkpoint and its linked recheck", () => {
    const draft = deck(0);
    const source = createQuestionBlock("single_select"),
      recheck = createQuestionBlock("single_select");
    recheck.question.delivery = "recheck";
    source.question.linkedRecheckQuestionId = recheck.question.id;
    draft.blocks = [source, recheck];
    draft.sections = [section(draft, "Question", [0]), section(draft, "Recheck", [1])];
    expect(PresentationDraftSchema.safeParse(draft).success).toBe(true);
    expect(movePresentationSection(draft, draft.sections[1]!.id, -1)).toBe(draft);
  });
  it("preserves a valid forward branch rather than moving its target before the question", () => {
    const draft = deck(1);
    const source = createQuestionBlock("single_select");
    source.branches = [
      {
        id: randomUUID(),
        label: "Next",
        targetBlockId: draft.blocks[0]!.id,
        condition: { kind: "correct_share", minPercent: 50, minResponses: 1 },
      },
    ];
    draft.blocks.unshift(source);
    draft.sections = [section(draft, "Question", [0]), section(draft, "Target", [1])];
    expect(PresentationDraftSchema.safeParse(draft).success).toBe(true);
    expect(movePresentationSection(draft, draft.sections[1]!.id, -1)).toBe(draft);
  });
});
