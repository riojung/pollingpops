import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  ContentSlideDraftSchema,
  InteractiveQuestionBlockDraftSchema,
  PresentationContentSchema,
  PresentationDraftMutationSchema,
  PresentationDraftSchema,
  PresentationLiveContentBlockSchema,
  RecoveryPackContentSchema,
  migratePresentationV1,
  plainTextToPresentationRichText,
  preparePresentationPublication,
  recoveryPackContentHash,
  type ContentSlideDraft,
  type PresentationDraft,
  type PresentationScene,
} from "../src/index";

const uuid = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;

function legacySlide(id = 1): ContentSlideDraft {
  return {
    id: uuid(id),
    kind: "content",
    layout: "title_body",
    textElements: [
      { id: `title-${id}`, role: "title", text: "Project context", region: "top_center", order: 0 },
    ],
    mediaId: null,
    mediaAlt: null,
    speakerNotes: "Presenter cue",
  };
}

function nativeSlide(id = 2, rich = false): ContentSlideDraft {
  const scene: PresentationScene = {
    schemaVersion: rich ? 2 : 1,
    aspectRatio: "16:9",
    nodes: [
      {
        id: "title",
        type: "text",
        role: "title",
        text: "Native context",
        frame: { x: 8, y: 8, width: 84, height: 20 },
        ...(rich ? { richText: plainTextToPresentationRichText("Native context") } : {}),
      },
    ],
    readingOrder: ["title"],
  };
  return { ...legacySlide(id), textElements: [], scene };
}

function question(id: number, delivery: "main" | "recheck" = "main") {
  return {
    id: uuid(id),
    type: "numeric" as const,
    prompt: `Checkpoint ${id}`,
    purpose: "diagnostic" as const,
    confidence: "off" as const,
    delivery,
    conceptKeys: ["evidence"],
    linkedRecheckQuestionId: null as string | null,
    correctValue: "7",
    tolerance: "0",
    unit: null,
    timeLimitSeconds: 30,
    basePoints: 1000,
    explanation: "Use the evidence",
    mediaId: null,
    mediaAlt: null,
  };
}

function questionBlock(id: number, delivery: "main" | "recheck" = "main") {
  return { id: uuid(id + 100), kind: "question" as const, question: question(id, delivery) };
}

function deck(
  blocks: PresentationDraft["blocks"],
  schemaVersion: PresentationDraft["schemaVersion"] = 6,
): PresentationDraft {
  return PresentationDraftSchema.parse({ title: "Visible publication", schemaVersion, blocks });
}

describe("Presentation slide visibility contract", () => {
  it.each([2, 3, 4, 5] as const)(
    "rejects hidden slides under old document v%s",
    (schemaVersion) => {
      const input = {
        title: "Version fence",
        schemaVersion,
        blocks: [{ ...legacySlide(), hidden: true }],
      };
      const parsed = PresentationDraftSchema.safeParse(input);
      expect(parsed.success).toBe(false);
      expect(parsed.error?.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: ["blocks", 0, "hidden"],
            message: "Hidden slides require Presentation schema version 6",
          }),
        ]),
      );
      expect(PresentationContentSchema.safeParse(input).success).toBe(false);
    },
  );

  it("admits hidden legacy and both native scene versions only as authoring data", () => {
    const blocks = [legacySlide(), nativeSlide(), nativeSlide(3, true)].map((block) => ({
      ...block,
      hidden: true as const,
    }));
    const draft = deck(blocks);
    expect(draft.blocks).toEqual(blocks);
    expect(draft.schemaVersion).toBe(6);
    expect(migratePresentationV1(draft)).toBe(draft);
    expect(
      PresentationDraftMutationSchema.parse({
        draft,
        expectedRevision: 0,
        mutationId: uuid(999),
        schemaVersion: 2,
      }).draft,
    ).toEqual(draft);
    expect(PresentationContentSchema.safeParse(draft).success).toBe(false);
    for (const invalid of [false, "true", 1, null]) {
      expect(ContentSlideDraftSchema.safeParse({ ...legacySlide(), hidden: invalid }).success).toBe(
        false,
      );
    }
  });

  it("rejects hide flags on activities rather than stripping an unsupported operation", () => {
    for (const hidden of [true, false]) {
      const block = { ...questionBlock(10), hidden };
      expect(InteractiveQuestionBlockDraftSchema.safeParse(block).success).toBe(false);
      expect(
        PresentationDraftSchema.safeParse({ title: "Activity", schemaVersion: 6, blocks: [block] })
          .success,
      ).toBe(false);
      expect(
        PresentationContentSchema.safeParse({
          title: "Activity",
          schemaVersion: 6,
          blocks: [block],
        }).success,
      ).toBe(false);
    }
  });

  it("does not turn hiding into permission to persist malformed draft geometry or topology", () => {
    const block = nativeSlide();
    block.hidden = true;
    const title = block.scene!.nodes[0]!;
    if (title.type !== "text") throw new Error("fixture");
    title.frame.width = 0;
    expect(
      PresentationDraftSchema.safeParse({
        title: "Malformed hidden slide",
        schemaVersion: 6,
        blocks: [block],
      }).success,
    ).toBe(false);
    const duplicate = legacySlide();
    expect(
      PresentationDraftSchema.safeParse({
        title: "Duplicate identity",
        schemaVersion: 6,
        blocks: [duplicate, { ...duplicate, hidden: true }],
      }).success,
    ).toBe(false);
  });

  it("compiles whole hidden blocks out without mutating draft metadata, IDs or assessment links", () => {
    const visible = legacySlide();
    const diagnostic = questionBlock(10);
    const recheck = questionBlock(11, "recheck");
    diagnostic.question.linkedRecheckQuestionId = recheck.question.id;
    const hidden = nativeSlide(3, true);
    hidden.hidden = true;
    hidden.speakerNotes = "PRIVATE hidden-only speaker note";
    hidden.citations = [{ locator: "PRIVATE hidden source", excerpt: "PRIVATE hidden excerpt" }];
    hidden.scene!.nodes.push({
      id: "private-image",
      type: "image",
      mediaId: uuid(777),
      altText: null,
      frame: { x: 8, y: 35, width: 84, height: 50 },
    });
    hidden.scene!.readingOrder.push("private-image");
    const input = deck([visible, diagnostic, hidden, recheck]);
    const before = JSON.stringify(input);
    const prepared = preparePresentationPublication(input);
    expect(prepared).not.toBe(input);
    expect(prepared.schemaVersion).toBe(6);
    expect(prepared.blocks).toEqual([input.blocks[0], input.blocks[1], input.blocks[3]]);
    expect(prepared.blocks[0]).toBe(input.blocks[0]);
    expect(prepared.blocks[1]).toBe(input.blocks[1]);
    expect(prepared.blocks[2]).toBe(input.blocks[3]);
    expect(JSON.stringify(input)).toBe(before);
    expect(JSON.stringify(prepared)).not.toContain("PRIVATE hidden");
    expect(JSON.stringify(prepared)).not.toContain(uuid(777));
    expect(PresentationContentSchema.parse(prepared)).toEqual(prepared);
    expect(preparePresentationPublication(prepared)).toBe(prepared);
  });

  it("validates only visible publication readiness while keeping hidden drafts structurally valid", () => {
    const hidden = legacySlide(3);
    hidden.textElements[0]!.text = "";
    hidden.hidden = true;
    hidden.mediaId = uuid(777);
    hidden.mediaAlt = null;
    const draft = deck([hidden, nativeSlide()]);
    expect(ContentSlideDraftSchema.safeParse(draft.blocks[0]).success).toBe(true);
    expect(PresentationContentSchema.safeParse(draft).success).toBe(false);
    expect(PresentationContentSchema.parse(preparePresentationPublication(draft)).blocks).toEqual([
      draft.blocks[1],
    ]);
  });

  it("keeps hidden slides out of the strict live block projection", () => {
    const { speakerNotes: _notes, ...block } = legacySlide();
    void _notes;
    expect(PresentationLiveContentBlockSchema.safeParse({ ...block, hidden: true }).success).toBe(
      false,
    );
  });

  it("allows an all-hidden draft but gives a useful error for its empty publication candidate", () => {
    const draft = deck([{ ...legacySlide(), hidden: true }]);
    const prepared = preparePresentationPublication(draft);
    expect(prepared.blocks).toEqual([]);
    const published = PresentationContentSchema.safeParse(prepared);
    expect(published.success).toBe(false);
    expect(published.error?.issues.map(({ message }) => message)).toContain(
      "Show a slide or add an activity before publishing",
    );
    const oldEmpty = PresentationContentSchema.safeParse({ ...prepared, schemaVersion: 5 });
    expect(oldEmpty.success).toBe(false);
    expect(oldEmpty.error?.issues.map(({ message }) => message)).not.toContain(
      "Show a slide or add an activity before publishing",
    );
  });

  it("keeps document v6 when a slide is shown again without serializing hidden:false", () => {
    const hidden = { ...legacySlide(), hidden: true as const };
    const draft = deck([hidden]);
    const { hidden: _hidden, ...shown } = hidden;
    void _hidden;
    draft.blocks = [shown];
    expect(preparePresentationPublication(draft)).toBe(draft);
    const content = PresentationContentSchema.parse(draft);
    expect(content.schemaVersion).toBe(6);
    expect(content.blocks[0]).not.toHaveProperty("hidden");
  });

  it.each([2, 3, 4, 5] as const)(
    "retains v%s parsed JSON and hashes without adding visibility fields",
    (schemaVersion) => {
      const blocks =
        schemaVersion < 4
          ? [legacySlide(), questionBlock(10)]
          : [nativeSlide(2, schemaVersion === 5), questionBlock(10)];
      const input = deck(blocks, schemaVersion);
      const serialized = JSON.stringify(input);
      const hash = createHash("sha256").update(serialized).digest("hex");
      expect(preparePresentationPublication(input)).toBe(input);
      const content = PresentationContentSchema.parse(input);
      expect(JSON.stringify(content)).toBe(serialized);
      expect(createHash("sha256").update(JSON.stringify(content)).digest("hex")).toBe(hash);
      for (const block of content.blocks) expect(block).not.toHaveProperty("hidden");
    },
  );

  it("preserves complete immutable Pack baselines while excluding hidden visual slides", () => {
    const recheck = question(11, "recheck");
    const diagnostic = { ...question(10), linkedRecheckQuestionId: recheck.id };
    const originalContent = RecoveryPackContentSchema.parse({
      title: "Frozen evidence Pack",
      diagnostic,
      recheck,
      interventions: [{ id: uuid(200), title: "Repair", body: "Observe the evidence" }],
      conceptKeys: ["evidence"],
    });
    const contentHash = recoveryPackContentHash(originalContent);
    const insertion = {
      id: uuid(300),
      packId: uuid(301),
      packVersionId: uuid(302),
      packVersion: 1,
      contentHash,
      diagnosticQuestionId: diagnostic.id,
      recheckQuestionId: recheck.id,
      originalContent,
      updateBaseline: {
        packVersionId: uuid(303),
        packVersion: 2,
        contentHash,
        content: originalContent,
      },
    };
    const input = PresentationDraftSchema.parse({
      ...deck([
        { ...legacySlide(), hidden: true },
        { id: uuid(100), kind: "question", question: diagnostic },
        nativeSlide(),
        { id: uuid(101), kind: "question", question: recheck },
      ]),
      recoveryPackInsertions: [insertion],
    });
    const baseline = JSON.stringify(input.recoveryPackInsertions);
    const prepared = preparePresentationPublication(input);
    expect(prepared.recoveryPackInsertions).toBe(input.recoveryPackInsertions);
    const content = PresentationContentSchema.parse(prepared);
    expect(JSON.stringify(content.recoveryPackInsertions)).toBe(baseline);
    expect(recoveryPackContentHash(content.recoveryPackInsertions![0]!.originalContent)).toBe(
      contentHash,
    );
  });

  it("counts hidden scene bytes in the complete v6 draft budget", () => {
    const large = nativeSlide();
    large.hidden = true;
    large.scene!.nodes.push(
      ...Array.from({ length: 8 }, (_, index) => ({
        id: `body-${index}`,
        type: "text" as const,
        role: "body" as const,
        text: "界".repeat(4000),
        frame: { x: 8, y: 35, width: 84, height: 50 },
      })),
    );
    large.scene!.readingOrder = large.scene!.nodes.map(({ id }) => id);
    expect(ContentSlideDraftSchema.safeParse(large).success).toBe(true);
    const input = {
      title: "Oversized retained draft",
      schemaVersion: 6,
      blocks: Array.from({ length: 40 }, (_, index) => ({ ...large, id: uuid(400 + index) })),
    };
    expect(() => PresentationDraftSchema.parse(input)).toThrow("3 MiB");
  });

  it("retains legacy slides under document 9 and continues rejecting future document formats", () => {
    for (const schema of [PresentationDraftSchema, PresentationContentSchema]) {
      expect(schema.parse({ ...deck([legacySlide()]), schemaVersion: 9 }).schemaVersion).toBe(9);
      expect(schema.parse({ ...deck([legacySlide()]), schemaVersion: 12 }).schemaVersion).toBe(12);
      expect(schema.parse({ ...deck([legacySlide()]), schemaVersion: 13 }).schemaVersion).toBe(13);
      expect(schema.safeParse({ ...deck([legacySlide()]), schemaVersion: 14 }).success).toBe(true);
      expect(schema.safeParse({ ...deck([legacySlide()]), schemaVersion: 15 }).success).toBe(true);
      expect(schema.safeParse({ ...deck([legacySlide()]), schemaVersion: 17 }).success).toBe(false);
    }
  });
});
