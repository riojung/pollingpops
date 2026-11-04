import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  PresentationContentSchema,
  PresentationDraftMutationSchema,
  PresentationDraftSchema,
  PresentationLiveContentBlockSchema,
  PresentationRichTextSchema,
  PresentationSceneDraftSchema,
  PresentationSceneSchema,
  RecoveryPackContentSchema,
  isSafePresentationLink,
  migratePresentationV1,
  plainTextToPresentationRichText,
  presentationRichTextToPlainText,
  recoveryPackContentHash,
  type PresentationRichText,
  type PresentationScene,
} from "../src/index";

const uuid = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
const frame = { x: 8, y: 8, width: 84, height: 20 };

function richText(): PresentationRichText {
  return {
    paragraphs: [
      {
        kind: "paragraph",
        runs: [
          { text: "Review ", bold: true },
          { text: "the evidence", italic: true, href: "https://example.com/evidence?q=1#result" },
        ],
      },
      { kind: "bullet", runs: [{ text: "Choose an owner", bold: true, italic: true }] },
      { kind: "numbered", runs: [{ text: "Review next week" }] },
    ],
  };
}

function scene(): PresentationScene {
  const content = richText();
  return {
    schemaVersion: 2,
    aspectRatio: "16:9",
    nodes: [
      { id: "title", frame, type: "text", role: "title", text: "Project decision" },
      {
        id: "body",
        frame: { x: 8, y: 35, width: 84, height: 50 },
        type: "text",
        role: "body",
        text: presentationRichTextToPlainText(content),
        richText: content,
      },
    ],
    readingOrder: ["title", "body"],
  };
}

function slide(input = scene()) {
  return {
    id: uuid(1),
    kind: "content" as const,
    layout: "title_body" as const,
    textElements: [],
    mediaId: null,
    mediaAlt: null,
    speakerNotes: "Private delivery cue",
    scene: input,
  };
}

function deck(schemaVersion = 5, input = scene()) {
  return {
    title: "Project decision",
    description: "",
    experiencePreset: { id: "focus", version: 1 },
    schemaVersion,
    blocks: [slide(input)],
  };
}

describe("bounded Presentation rich text", () => {
  it("round-trips only closed paragraphs, list kinds, inline emphasis and explicit links", () => {
    const input = richText();
    expect(PresentationRichTextSchema.parse(input)).toEqual(input);
    expect(presentationRichTextToPlainText(input)).toBe(
      "Review the evidence\nChoose an owner\nReview next week",
    );
    expect(plainTextToPresentationRichText("First\r\nSecond\rThird\n\tFourth")).toEqual({
      paragraphs: ["First", "Second", "Third", "\tFourth"].map((text) => ({
        kind: "paragraph",
        runs: [{ text }],
      })),
    });
    expect(plainTextToPresentationRichText("")).toEqual({
      paragraphs: [{ kind: "paragraph", runs: [{ text: "" }] }],
    });
    expect(PresentationSceneDraftSchema.parse(scene())).toEqual(scene());
    expect(PresentationSceneSchema.parse(scene())).toEqual(scene());
  });

  it.each([
    "https://example.com/path?query=1#fragment",
    "http://example.com:8080/path",
    "HTTPS://EXAMPLE.COM/Case",
    "https://例え.テスト/evidence",
  ])("retains safe absolute link spelling %s", (href) => {
    const input = { paragraphs: [{ kind: "paragraph", runs: [{ text: "Reference", href }] }] };
    expect(isSafePresentationLink(href)).toBe(true);
    expect(PresentationRichTextSchema.parse(input)).toEqual(input);
  });

  it.each([
    "javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "file:///etc/passwd",
    "mailto:person@example.com",
    "//example.com/path",
    "/relative/path",
    "https:example.com",
    "https:\\example.com",
    "https://example.com\\path",
    "https://user@example.com",
    "https://user:password@example.com",
    "https://example.com/path with spaces",
    " https://example.com",
    "https://example.com\n/path",
    "https://example.com/\u0000path",
    "https://example.com/\u0085path",
    "https://",
  ])("rejects executable, ambiguous or credential-bearing links %j", (href) => {
    expect(isSafePresentationLink(href)).toBe(false);
    expect(
      PresentationRichTextSchema.safeParse({
        paragraphs: [{ kind: "paragraph", runs: [{ text: "Reference", href }] }],
      }).success,
    ).toBe(false);
  });

  it("rejects arbitrary HTML/style/nesting, false marks, control characters and run line breaks", () => {
    for (const patch of [
      { html: "<strong>Unsafe</strong>" },
      { style: { color: "red" } },
      { bold: false },
      { text: "First\nSecond" },
      { text: "First\rSecond" },
      { text: "First\u0000Second" },
    ]) {
      expect(
        PresentationRichTextSchema.safeParse({
          paragraphs: [{ kind: "paragraph", runs: [{ text: "Text", ...patch }] }],
        }).success,
      ).toBe(false);
    }
    expect(PresentationRichTextSchema.safeParse({ ...richText(), html: "markup" }).success).toBe(
      false,
    );
    expect(
      PresentationRichTextSchema.safeParse({
        paragraphs: [{ kind: "heading", runs: [{ text: "Text" }] }],
      }).success,
    ).toBe(false);
    expect(
      PresentationRichTextSchema.safeParse({
        paragraphs: [{ kind: "bullet", runs: [{ text: "Text" }], children: [] }],
      }).success,
    ).toBe(false);
    // Literal angle brackets remain ordinary escaped text, not parsed markup.
    expect(
      presentationRichTextToPlainText(plainTextToPresentationRichText("<script>text</script>")),
    ).toBe("<script>text</script>");
  });

  it("bounds paragraphs, runs, canonical text and link length independently", () => {
    const paragraph = { kind: "paragraph", runs: [{ text: "" }] };
    expect(PresentationRichTextSchema.safeParse({ paragraphs: [] }).success).toBe(false);
    expect(
      PresentationRichTextSchema.safeParse({
        paragraphs: Array.from({ length: 100 }, () => paragraph),
      }).success,
    ).toBe(true);
    expect(
      PresentationRichTextSchema.safeParse({
        paragraphs: Array.from({ length: 101 }, () => paragraph),
      }).success,
    ).toBe(false);
    const runs = Array.from({ length: 100 }, () => ({ text: "a" }));
    expect(
      PresentationRichTextSchema.safeParse({
        paragraphs: Array.from({ length: 5 }, () => ({ kind: "paragraph", runs })),
      }).success,
    ).toBe(true);
    expect(
      PresentationRichTextSchema.safeParse({
        paragraphs: Array.from({ length: 6 }, () => ({ kind: "paragraph", runs })),
      }).success,
    ).toBe(false);
    expect(
      PresentationRichTextSchema.safeParse({
        paragraphs: [{ kind: "paragraph", runs: [...runs, { text: "a" }] }],
      }).success,
    ).toBe(false);
    expect(
      PresentationRichTextSchema.safeParse({ paragraphs: [{ kind: "paragraph", runs: [] }] })
        .success,
    ).toBe(false);
    expect(plainTextToPresentationRichText("a".repeat(4_000))).toBeDefined();
    expect(() => plainTextToPresentationRichText("a".repeat(4_001))).toThrow();
    expect(() =>
      plainTextToPresentationRichText(`${"a".repeat(2_000)}\n${"b".repeat(2_000)}`),
    ).toThrow();
    expect(
      PresentationRichTextSchema.safeParse({
        paragraphs: [
          {
            kind: "paragraph",
            runs: [{ text: "Ref", href: `https://example.com/${"a".repeat(2_048)}` }],
          },
        ],
      }).success,
    ).toBe(false);
  });

  it("requires the exact canonical fallback and keeps titles bounded and free of lists", () => {
    const input = scene();
    const body = input.nodes[1]!;
    if (body.type !== "text") throw new Error("fixture");
    body.text = "Different fallback";
    expect(PresentationSceneDraftSchema.safeParse(input).success).toBe(false);
    const title = input.nodes[0]!;
    if (title.type !== "text") throw new Error("fixture");
    body.text = presentationRichTextToPlainText(body.richText!);
    title.richText = { paragraphs: [{ kind: "bullet", runs: [{ text: title.text }] }] };
    expect(PresentationSceneDraftSchema.safeParse(input).success).toBe(false);
    title.richText = plainTextToPresentationRichText(title.text);
    expect(PresentationSceneDraftSchema.safeParse(input).success).toBe(true);
    title.text = "a".repeat(161);
    title.richText = plainTextToPresentationRichText(title.text);
    expect(PresentationSceneDraftSchema.safeParse(input).success).toBe(false);
  });
});

describe("Presentation v5 compatibility", () => {
  it("gates rich scenes behind v5 while retaining scene1 and the existing mutation envelope", () => {
    for (const schemaVersion of [2, 3, 4]) {
      expect(PresentationDraftSchema.safeParse(deck(schemaVersion)).success).toBe(false);
      expect(PresentationContentSchema.safeParse(deck(schemaVersion)).success).toBe(false);
    }
    expect(PresentationDraftSchema.parse(deck()).schemaVersion).toBe(5);
    expect(PresentationContentSchema.parse(deck()).schemaVersion).toBe(5);
    expect(
      PresentationDraftMutationSchema.parse({
        schemaVersion: 2,
        draft: deck(),
        expectedRevision: 0,
        mutationId: uuid(2),
      }).draft.schemaVersion,
    ).toBe(5);
    const legacy = scene();
    legacy.schemaVersion = 1;
    const body = legacy.nodes[1]!;
    if (body.type !== "text") throw new Error("fixture");
    expect(PresentationSceneDraftSchema.safeParse(legacy).success).toBe(false);
    body.richText = undefined;
    expect(PresentationSceneDraftSchema.safeParse(legacy).success).toBe(false);
    delete body.richText;
    for (const schemaVersion of [4, 5]) {
      expect(PresentationDraftSchema.parse(deck(schemaVersion, legacy)).blocks[0]).toEqual(
        slide(legacy),
      );
    }
    expect(migratePresentationV1(deck())).toEqual(deck());
    expect(
      PresentationLiveContentBlockSchema.parse({
        id: uuid(1),
        kind: "content",
        layout: "title_body",
        textElements: [],
        mediaId: null,
        mediaAlt: null,
        scene: scene(),
      }).scene,
    ).toEqual(scene());
  });

  it("keeps plain v4 JSON and hashes unchanged rather than implicitly formatting it", () => {
    const plain = scene();
    plain.schemaVersion = 1;
    const body = plain.nodes[1]!;
    if (body.type !== "text") throw new Error("fixture");
    delete body.richText;
    const input = deck(4, plain);
    const serialized = JSON.stringify(input);
    const parsed = PresentationContentSchema.parse(input);
    expect(JSON.stringify(parsed)).toBe(serialized);
    expect(createHash("sha256").update(JSON.stringify(parsed)).digest("hex")).toBe(
      createHash("sha256").update(serialized).digest("hex"),
    );
  });

  it("preserves frozen Recovery Pack baselines and includes them in the v5 byte budget", () => {
    const question = (id: number) => ({
      id: uuid(id),
      type: "single_select",
      prompt: `Checkpoint ${id}`,
      purpose: "diagnostic",
      delivery: "main",
      conceptKeys: ["safe"],
      linkedRecheckQuestionId: null,
      timeLimitSeconds: 30,
      basePoints: 1_000,
      explanation: "Explanation",
      mediaId: null,
      mediaAlt: null,
      choices: [
        { id: uuid(id + 10), label: "First", isCorrect: true },
        { id: uuid(id + 20), label: "Second", isCorrect: false },
      ],
    });
    const pack = RecoveryPackContentSchema.parse({
      schemaVersion: 1,
      title: "Safety",
      diagnostic: { ...question(10), linkedRecheckQuestionId: uuid(11) },
      recheck: { ...question(11), delivery: "recheck" },
      interventions: Array.from({ length: 5 }, (_, index) => ({
        id: uuid(index + 50),
        title: "Context",
        body: "界".repeat(2_000),
      })),
      conceptKeys: ["safe"],
    });
    const contentHash = recoveryPackContentHash(pack);
    const insertion = (index: number) => ({
      id: uuid(index + 100),
      packId: uuid(4),
      packVersionId: uuid(5),
      packVersion: 1,
      contentHash,
      diagnosticQuestionId: uuid(index + 200),
      recheckQuestionId: uuid(index + 300),
      originalContent: pack,
      updateBaseline: { packVersionId: uuid(6), packVersion: 2, contentHash, content: pack },
    });
    const input = { ...deck(), recoveryPackInsertions: [insertion(0)] };
    const parsed = PresentationContentSchema.parse(input);
    expect(parsed.recoveryPackInsertions).toEqual(input.recoveryPackInsertions);
    expect(recoveryPackContentHash(parsed.recoveryPackInsertions![0]!.originalContent)).toBe(
      contentHash,
    );
    const oversized = {
      ...deck(),
      recoveryPackInsertions: Array.from({ length: 60 }, (_, index) => insertion(index)),
    };
    expect(() => PresentationDraftSchema.parse(oversized)).toThrow("3 MiB");
    expect(() => PresentationContentSchema.parse(oversized)).toThrow("3 MiB");
  });

  it("continues bounding the whole rich scene including duplicated formatted content", () => {
    const input = scene();
    const body = input.nodes[1]!;
    if (body.type !== "text") throw new Error("fixture");
    body.text = "界".repeat(3_000);
    body.richText = plainTextToPresentationRichText(body.text);
    input.nodes.push(
      ...Array.from({ length: 8 }, (_, index) => ({ ...body, id: `large-${index}` })),
    );
    input.readingOrder = input.nodes.map((node) => node.id);
    expect(() => PresentationSceneDraftSchema.parse(input)).toThrow("128 KiB");
  });
});
