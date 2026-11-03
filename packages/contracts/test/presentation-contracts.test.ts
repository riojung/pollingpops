import { createHash, randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  ContentSlideDraftSchema,
  ContentSlideFrameSchema,
  PresentationContentSchema,
  PresentationDraftMutationSchema,
  PresentationDraftSchema,
  migratePresentationV1,
  type ContentSlideDraft,
} from "../src/index";

function questionBlock() {
  return {
    id: randomUUID(),
    kind: "question" as const,
    question: {
      id: randomUUID(),
      type: "single_select" as const,
      prompt: "Which evidence should guide the decision?",
      choices: [
        { id: randomUUID(), label: "Observed behaviour", isCorrect: true },
        { id: randomUUID(), label: "Volume alone", isCorrect: false },
      ],
      purpose: "diagnostic" as const,
      confidence: "optional" as const,
      delivery: "main" as "main" | "recheck",
      conceptKeys: ["evidence"],
      linkedRecheckQuestionId: null as string | null,
      timeLimitSeconds: 20,
      basePoints: 1000,
      explanation: "Observed behaviour is direct evidence.",
      mediaId: null,
      mediaAlt: null,
    },
  };
}

function contentBlock(title = "", body = ""): ContentSlideDraft {
  const id = randomUUID();
  return {
    id,
    kind: "content" as const,
    layout: "title_body" as const,
    textElements: [
      {
        id: `${id}:title`,
        role: "title" as const,
        text: title,
        region: "top_center" as const,
        order: 0,
      },
      {
        id: `${id}:body`,
        role: "body" as const,
        text: body,
        region: "middle_center" as const,
        order: 0,
      },
    ],
    mediaId: null,
    mediaAlt: null,
    speakerNotes: "",
  };
}

function compatibilityDeck(schemaVersion: 2 | 3) {
  const id = (value: number) =>
    `00000000-0000-4000-8000-${String(value).padStart(12, "0")}` as const;
  const checkpoint = (offset: number) => {
    const block = questionBlock();
    block.id = id(offset);
    block.question.id = id(offset + 1);
    block.question.choices.forEach((choice, index) => {
      choice.id = id(offset + 2 + index);
    });
    return block;
  };
  const diagnostic = checkpoint(10);
  const recheck = checkpoint(20);
  recheck.question.delivery = "recheck";
  diagnostic.question.linkedRecheckQuestionId = recheck.question.id;
  const slide = contentBlock("Context", "Use the evidence before choosing.");
  slide.id = id(1);
  slide.textElements[0]!.id = "compatibility:title";
  slide.textElements[1]!.id = "compatibility:body";
  slide.speakerNotes = "Keep the notes private.";
  return PresentationDraftSchema.parse({
    title: "Compatibility deck",
    description: "Frozen mixed recovery fixture",
    schemaVersion,
    blocks: [slide, diagnostic, recheck],
  });
}

describe("presentation contracts", () => {
  it("retains optional bounded text frames in draft mutations and published content", () => {
    const slide = contentBlock("Positioned title", "Positioned body");
    slide.textElements[0]!.frame = { x: 8, y: 20, width: 84, height: 22 };
    slide.textElements[1]!.frame = { x: 8, y: 48, width: 84, height: 40 };
    const mutation = PresentationDraftMutationSchema.parse({
      schemaVersion: 2,
      mutationId: randomUUID(),
      expectedRevision: 0,
      draft: {
        title: "Bounded geometry",
        schemaVersion: 2,
        blocks: [slide, questionBlock()],
      },
    });
    const content = PresentationContentSchema.parse(mutation.draft);
    const publishedSlide = content.blocks[0];
    expect(publishedSlide?.kind).toBe("content");
    if (publishedSlide?.kind !== "content") throw new Error("Expected the content slide");
    expect(publishedSlide.textElements).toEqual(slide.textElements);
    expect(ContentSlideFrameSchema.parse({ x: 88, y: 94, width: 12, height: 6 })).toEqual({
      x: 88,
      y: 94,
      width: 12,
      height: 6,
    });
  });

  it.each([
    { x: -1, y: 0, width: 12, height: 6 },
    { x: 0, y: -1, width: 12, height: 6 },
    { x: 0, y: 0, width: 11, height: 6 },
    { x: 0, y: 0, width: 12, height: 5 },
    { x: 89, y: 0, width: 12, height: 6 },
    { x: 0, y: 95, width: 12, height: 6 },
    { x: 0, y: 0, width: 101, height: 6 },
    { x: 0, y: 0, width: 12, height: 101 },
    { x: Number.NaN, y: 0, width: 12, height: 6 },
    { x: 0, y: Number.POSITIVE_INFINITY, width: 12, height: 6 },
    { x: 0, y: 0, width: Number.POSITIVE_INFINITY, height: 6 },
    { x: 0, y: 0, width: 12, height: Number.NEGATIVE_INFINITY },
  ])("rejects unbounded text frame %j", (frame) => {
    const slide = contentBlock("Bounded title", "");
    slide.textElements[0]!.frame = frame;
    expect(ContentSlideDraftSchema.safeParse(slide).success).toBe(false);
  });

  it("keeps legacy slides valid without frames and preserves frames during migration", () => {
    const legacySlide = {
      id: randomUUID(),
      kind: "content",
      layout: "quote",
      title: "Recovered title",
      body: "Recovered body",
      mediaId: null,
      mediaAlt: null,
      speakerNotes: "Recovered note",
    };
    const migrated = PresentationDraftSchema.parse(
      migratePresentationV1({
        title: "Recovered presentation",
        schemaVersion: 1,
        blocks: [legacySlide],
      }),
    );
    const migratedSlide = migrated.blocks[0];
    if (migratedSlide?.kind !== "content") throw new Error("Expected the recovered slide");
    expect(migratedSlide.textElements.every((element) => element.frame === undefined)).toBe(true);
    const frame = { x: 8, y: 20, width: 84, height: 22 };
    migratedSlide.textElements[0]!.frame = frame;
    const retained = PresentationDraftSchema.parse(migratePresentationV1(migrated));
    expect(retained).toEqual(migrated);
  });

  it("bounds text elements and requires unique IDs and positions", () => {
    const block = contentBlock("Title", "Body");
    const duplicateId = structuredClone(block);
    duplicateId.textElements[1]!.id = duplicateId.textElements[0]!.id;
    expect(ContentSlideDraftSchema.safeParse(duplicateId).success).toBe(false);

    const duplicatePosition = structuredClone(block);
    duplicatePosition.textElements[1]!.region = "top_center";
    expect(ContentSlideDraftSchema.safeParse(duplicatePosition).success).toBe(false);

    const invalidRegion = structuredClone(block);
    invalidRegion.textElements[0]!.region = "outside" as never;
    expect(ContentSlideDraftSchema.safeParse(invalidRegion).success).toBe(false);

    const tooMany = structuredClone(block);
    tooMany.textElements = [
      ...tooMany.textElements,
      ...Array.from({ length: 7 }, (_, index) => ({
        id: `${block.id}:extra-${index}`,
        role: "body" as const,
        text: "",
        region: "bottom_center" as const,
        order: index,
      })),
    ];
    expect(ContentSlideDraftSchema.safeParse(tooMany).success).toBe(false);
  });

  it("stores incomplete structured authoring states", () => {
    expect(
      PresentationDraftSchema.safeParse({
        title: "",
        description: "",
        schemaVersion: 2,
        blocks: [contentBlock()],
      }).success,
    ).toBe(true);
  });

  it.each([2, 3] as const)(
    "publishes a nonempty content-only v%s deck without manufacturing an assessment",
    (schemaVersion) => {
      const draft = PresentationDraftSchema.parse({
        title: "Project update",
        schemaVersion,
        blocks: [
          contentBlock("Context", "Our next project milestone."),
          contentBlock("Next steps"),
        ],
      });
      const published = PresentationContentSchema.parse(draft);
      expect(published).toEqual(draft);
      expect(published.schemaVersion).toBe(schemaVersion);
      expect(published.blocks.every((block) => block.kind === "content")).toBe(true);
    },
  );

  it("still rejects empty decks, incomplete content and missing media descriptions", () => {
    const base = { title: "Project update", schemaVersion: 2 };
    expect(PresentationDraftSchema.safeParse({ ...base, blocks: [] }).success).toBe(true);
    for (const blocks of [
      [],
      [contentBlock()],
      [{ ...contentBlock(), mediaId: randomUUID(), mediaAlt: null }],
    ]) {
      expect(PresentationContentSchema.safeParse({ ...base, blocks }).success).toBe(false);
    }
    expect(
      PresentationContentSchema.safeParse({ ...base, title: "", blocks: [contentBlock("Context")] })
        .success,
    ).toBe(false);
  });

  it("keeps content-only block IDs unique", () => {
    const first = contentBlock("Context");
    const second = { ...contentBlock("Next steps"), id: first.id };
    const parsed = PresentationContentSchema.safeParse({
      title: "Duplicate slides",
      schemaVersion: 2,
      blocks: [first, second],
    });
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues.map(({ message }) => message)).toContain(
      "Every presentation block needs a unique ID",
    );
  });

  it("requires a main question whenever any question is present, including mixed recheck-only decks", () => {
    const recheck = questionBlock();
    recheck.question.delivery = "recheck";
    for (const blocks of [[recheck], [contentBlock("Context"), recheck]]) {
      const parsed = PresentationContentSchema.safeParse({
        title: "Recheck without a main checkpoint",
        schemaVersion: 2,
        blocks,
      });
      expect(parsed.success).toBe(false);
      expect(parsed.error?.issues.map(({ message }) => message)).toEqual(
        expect.arrayContaining([
          "Add at least one main interactive question before publishing",
          "Every recheck must be linked from one earlier diagnostic question",
        ]),
      );
    }
  });

  it.each([
    [2, "d0742a94fcdcea8de5f76f55aa8ff60fe048c22f539272ae1ff4ff5f656bbbba"],
    [3, "67292e9b3620b1867f8f7517974741eb41eb60ae121720e8b25d81350cbd8290"],
  ] as const)(
    "preserves pre-change mixed/recovery v%s content and serialized hash",
    (version, hash) => {
      const draft = compatibilityDeck(version);
      const published = PresentationContentSchema.parse(draft);
      expect(published).toEqual(draft);
      expect(migratePresentationV1(published)).toEqual(published);
      expect(createHash("sha256").update(JSON.stringify(published)).digest("hex")).toBe(hash);
    },
  );

  it("keeps the existing v1 upcast readable without changing current mixed content", () => {
    const draft = compatibilityDeck(2);
    const slide = draft.blocks[0];
    if (slide?.kind !== "content") throw new Error("Expected the compatibility content slide");
    const legacy = {
      ...draft,
      schemaVersion: 1,
      blocks: [
        {
          id: slide.id,
          kind: "content",
          layout: slide.layout,
          title: "Context",
          body: "Use the evidence before choosing.",
          mediaId: slide.mediaId,
          mediaAlt: slide.mediaAlt,
          speakerNotes: slide.speakerNotes,
        },
        ...draft.blocks.slice(1),
      ],
    };
    const before = structuredClone(legacy);
    const published = PresentationContentSchema.parse(migratePresentationV1(legacy));
    expect(published.schemaVersion).toBe(2);
    expect(published.blocks.slice(1)).toEqual(draft.blocks.slice(1));
    expect(legacy).toEqual(before);
  });

  it("rejects duplicate question and choice IDs", () => {
    const first = questionBlock();
    const second = questionBlock();
    second.question.id = first.question.id;
    second.question.choices[0]!.id = first.question.choices[0]!.id;
    const parsed = PresentationContentSchema.safeParse({
      title: "Broken IDs",
      description: "",
      experiencePreset: { id: "focus", version: 1 },
      schemaVersion: 2,
      blocks: [first, second],
    });
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues.map((issue) => issue.message)).toEqual(
      expect.arrayContaining([
        "Every presentation question needs a unique ID",
        "Every answer choice needs a unique ID",
      ]),
    );
  });

  it("keeps recovery topology sequential, owned, and publishable", () => {
    const first = questionBlock();
    const second = questionBlock();
    const recheck = questionBlock();
    recheck.question.delivery = "recheck";
    first.question.linkedRecheckQuestionId = recheck.question.id;
    second.question.linkedRecheckQuestionId = recheck.question.id;
    const shared = {
      title: "Shared recovery",
      description: "",
      experiencePreset: { id: "focus" as const, version: 1 as const },
      schemaVersion: 2 as const,
      blocks: [first, second, recheck],
    };
    const sharedResult = PresentationContentSchema.safeParse(shared);
    expect(sharedResult.success).toBe(false);
    expect(sharedResult.error?.issues.map(({ message }) => message)).toContain(
      "A recheck cannot be shared by multiple diagnostic questions",
    );

    const misordered = structuredClone(shared);
    misordered.blocks = [misordered.blocks[2]!, misordered.blocks[0]!];
    const orderResult = PresentationContentSchema.safeParse(misordered);
    expect(orderResult.success).toBe(false);
    expect(orderResult.error?.issues.map(({ message }) => message)).toContain(
      "Place the linked recheck after its diagnostic question",
    );

    const orphanMain = questionBlock();
    const orphanRecheck = questionBlock();
    orphanRecheck.question.delivery = "recheck";
    const orphan = { ...shared, blocks: [orphanMain, orphanRecheck] };
    expect(PresentationDraftSchema.safeParse(orphan).success).toBe(true);
    const orphanResult = PresentationContentSchema.safeParse(orphan);
    expect(orphanResult.success).toBe(false);
    expect(orphanResult.error?.issues.map(({ message }) => message)).toContain(
      "Every recheck must be linked from one earlier diagnostic question",
    );
  });
});
