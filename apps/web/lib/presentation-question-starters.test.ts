import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  supportedLocales,
  PRESENTATION_NATIVE_DOCUMENT_MAX_BYTES,
  PresentationContentSchema,
  PresentationDraftSchema,
  plainTextToPresentationRichText,
  presentationQuestionSuggestionSource,
  presentationQuestionSuggestionsSourceFingerprint,
  type ContentSlideDraft,
  type PresentationDraft,
} from "@openround/contracts";
import {
  createPresentationQuestionStarters,
  insertPresentationQuestionStarter,
  presentationQuestionStarterAvailability,
  type PresentationQuestionStarter,
  type PresentationQuestionStarterIds,
} from "./presentation-question-starters";
import { createQuestionBlock } from "./presentation-builder";
import { nativeSceneDocumentVersion } from "./presentation-deck-design";

const uuid = (value: number) => `00000000-0000-4000-8000-${value.toString(16).padStart(12, "0")}`;
function slide(body = "Customer interviews\nPrototype testing"): ContentSlideDraft {
  return {
    id: uuid(1),
    kind: "content",
    layout: "title_body",
    textElements: [],
    mediaId: null,
    mediaAlt: null,
    speakerNotes: "PRIVATE NOTES: do not use in a question.",
    citations: [{ locator: "Private imported source", excerpt: "PRIVATE IMPORTED EXCERPT" }],
    sourceDisclosure: {
      sourceName: "Imported report",
      sourceDigest: "a".repeat(64),
      provider: "old-provider",
      model: "old-model",
    },
    scene: {
      schemaVersion: 1,
      aspectRatio: "16:9",
      nodes: [
        {
          id: "Title:Exact",
          type: "text",
          role: "title",
          text: "Research priorities",
          frame: { x: 5, y: 5, width: 90, height: 20 },
        },
        {
          id: "Body:Exact",
          type: "text",
          role: "body",
          text: body,
          frame: { x: 5, y: 30, width: 90, height: 60 },
        },
      ],
      readingOrder: ["Title:Exact", "Body:Exact"],
    },
  };
}
function deck(source = slide()): PresentationDraft {
  return PresentationDraftSchema.parse({
    schemaVersion: source.scene
      ? nativeSceneDocumentVersion(source.hidden ? 6 : 4, source.scene)
      : source.hidden
        ? 6
        : 4,
    title: "Research review",
    blocks: [source],
  });
}
function ids(starter: PresentationQuestionStarter, start = 100): PresentationQuestionStarterIds {
  return {
    blockId: uuid(start),
    questionId: uuid(start + 1),
    choiceIds: starter.choices?.map((_, index) => uuid(start + index + 2)),
  };
}
function starter(source = slide(), kind: PresentationQuestionStarter["id"] = "discussion") {
  const candidate = createPresentationQuestionStarters(source).find((item) => item.id === kind);
  if (!candidate) throw new Error("Expected a supported starter");
  return candidate;
}
function freeze<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}
function inserted(
  current: PresentationDraft,
  candidate: PresentationQuestionStarter,
  prepared = ids(candidate),
) {
  const result = insertPresentationQuestionStarter(current, candidate, prepared);
  if (!result.ok) throw new Error(result.reason);
  const block = result.draft.blocks.find((item) => item.id === result.blockId);
  if (block?.kind !== "question") throw new Error("Expected inserted question");
  return { ...result, block };
}

describe("local reviewed presentation question starters", () => {
  it("retains exact PR209 source fingerprint bytes when delegating to the shared authoritative getter", () => {
    for (const body of [" First point\r\nSecond point 😀 ", "x".repeat(4_000)]) {
      const original = slide(body),
        candidate = starter(original),
        shared = presentationQuestionSuggestionSource(original);
      if (!shared.supported) throw new Error(shared.reason);
      const legacyProjection = {
        blockId: original.id.toLowerCase(),
        title: { nodeId: "Title:Exact", text: "Research priorities", lang: null },
        body: [
          {
            nodeId: "Body:Exact",
            text: body,
            lang: null,
            paragraphs: body.split(/\r\n?|\n/u).map((text) => ({ kind: "paragraph", text })),
          },
        ],
        readingOrder: ["Title:Exact", "Body:Exact"],
      };
      expect(candidate.source.fingerprint).toBe(JSON.stringify(legacyProjection));
      expect(presentationQuestionSuggestionsSourceFingerprint(shared.source)).toBe(
        candidate.source.fingerprint,
      );
      expect(candidate.source.sourceDigest).toBe(
        createHash("sha256").update(JSON.stringify(legacyProjection)).digest("hex"),
      );
    }
  });

  it("offers deterministic discussion, subjective clarity and all-point priority starters without mutating source", () => {
    const source = freeze(slide()),
      before = JSON.stringify(source);
    const candidates = createPresentationQuestionStarters(source);
    expect(candidates.map((item) => [item.id, item.type])).toEqual([
      ["discussion", "open_text"],
      ["clarity", "rating"],
      ["priority", "poll"],
    ]);
    expect(candidates).toEqual(createPresentationQuestionStarters(source));
    expect(candidates[0]!.prompt).toBe(
      "What questions or comments do you have about “Research priorities”?",
    );
    expect(candidates[1]!.rating).toEqual({
      min: 1,
      max: 5,
      minLabel: "Not clear yet",
      maxLabel: "Very clear",
    });
    expect(candidates[2]!.choices).toEqual(["Customer interviews", "Prototype testing"]);
    expect(candidates[0]!.source.sourceDigest).toBe(
      createHash("sha256").update(candidates[0]!.source.fingerprint).digest("hex"),
    );
    expect(JSON.parse(candidates[0]!.source.fingerprint)).toEqual({
      blockId: source.id,
      title: candidates[0]!.source.title,
      body: candidates[0]!.source.body,
      readingOrder: source.scene!.readingOrder,
    });
    expect(JSON.stringify(candidates)).not.toContain("PRIVATE");
    expect(JSON.stringify(candidates)).not.toContain("old-provider");
    expect(JSON.stringify(source)).toBe(before);
  });

  it("uses only visible title/body text in mixed native scenes and keeps authored URLs as plain wording", () => {
    const source = slide("https://example.com/option\nContact the support team");
    source.scene!.schemaVersion = 6;
    source.scene!.nodes.push(
      {
        id: "Image",
        type: "image",
        mediaId: uuid(30),
        altText: "PRIVATE IMAGE DESCRIPTION",
        frame: { x: 5, y: 5, width: 20, height: 20 },
      },
      {
        id: "Closed",
        type: "dialog",
        scope: "local",
        label: "Details",
        detailTitle: "PRIVATE CLOSED TITLE",
        body: "PRIVATE CLOSED BODY",
        frame: { x: 80, y: 80, width: 10, height: 10 },
      },
    );
    source.scene!.readingOrder.push("Image", "Closed");
    const candidates = createPresentationQuestionStarters(source);
    expect(candidates).toHaveLength(3);
    expect(candidates[2]!.choices).toEqual([
      "https://example.com/option",
      "Contact the support team",
    ]);
    expect(JSON.stringify(candidates)).not.toContain("PRIVATE");
    expect(candidates[0]!.source.readingOrder).toEqual(source.scene!.readingOrder);
  });

  it("reads exact rich-text paragraphs and independently marked language without hrefs or formatting attribution", () => {
    const source = slide("Entrevistas\nPruebas de prototipo");
    source.scene!.schemaVersion = 7;
    const body = source.scene!.nodes[1]!;
    if (body.type !== "text") throw new Error("Expected text");
    body.lang = "es";
    body.richText = {
      paragraphs: [
        {
          kind: "bullet",
          runs: [{ text: "Entrevistas", bold: true, href: "https://private.example/secret" }],
        },
        { kind: "numbered", runs: [{ text: "Pruebas de prototipo" }] },
      ],
    };
    const candidate = starter(source, "priority");
    expect(candidate.choices).toEqual(["Entrevistas", "Pruebas de prototipo"]);
    expect(candidate.source.body[0]!.lang).toBe("es");
    expect(candidate.source.body[0]!.paragraphs.map((item) => item.kind)).toEqual([
      "bullet",
      "numbered",
    ]);
    expect(JSON.stringify(candidate)).not.toContain("private.example");
    expect(candidate.prompt).toContain("Which point");
  });

  it.each([
    ["one point", "Only one"],
    ["too many points", "One\nTwo\nThree\nFour\nFive\nSix\nSeven"],
    ["oversized point", `${"x".repeat(181)}\nOther`],
    ["UTF-16 oversized point", `${"😀".repeat(91)}\nOther`],
    ["duplicate points", "Evidence\nＥＶＩＤＥＮＣＥ"],
    ["whitespace-changing point", " Evidence\nOther"],
  ])(
    "declines the whole priority poll for %s while retaining discussion/clarity",
    (_label, body) => {
      expect(createPresentationQuestionStarters(slide(body)).map((item) => item.id)).toEqual([
        "discussion",
        "clarity",
      ]);
    },
  );

  it("keeps all six exact points, including punctuation and emoji, without sentence splitting or dropping blanks into choices", () => {
    const points = [
      "- Evidence",
      "2. Timing",
      "Costs? Benefits?",
      "Safety: review",
      "Community 👩‍💻",
      "Next steps",
    ];
    expect(starter(slide(points.join("\n\n")), "priority").choices).toEqual(points);
  });

  it("declines hidden, classic, incomplete and invalid source shapes without throwing", () => {
    for (const source of [
      { ...slide(), hidden: true as const },
      { ...slide(), scene: undefined },
      slide("  "),
      (() => {
        const block = slide();
        block.scene!.nodes[0] = { ...block.scene!.nodes[0]!, text: "" } as never;
        return block;
      })(),
      (() => {
        const block = slide();
        block.scene!.readingOrder = ["missing"];
        return block;
      })(),
      (() => {
        const block = slide();
        block.scene!.nodes[1] = { ...block.scene!.nodes[1]!, text: "x".repeat(4_001) } as never;
        return block;
      })(),
    ]) {
      expect(presentationQuestionStarterAvailability(source).supported).toBe(false);
      expect(presentationQuestionStarterAvailability(source).reason).toBeTruthy();
      expect(createPresentationQuestionStarters(source)).toEqual([]);
    }
    expect(createPresentationQuestionStarters(createQuestionBlock())).toEqual([]);
  });

  it("supports the full4,000-character body and case-sensitive long node IDs without a hash-input overflow", () => {
    const source = slide("x".repeat(4_000));
    source.scene!.nodes[1]!.id = "Body:" + "X".repeat(195);
    source.scene!.readingOrder[1] = source.scene!.nodes[1]!.id;
    expect(presentationQuestionStarterAvailability(source)).toEqual({
      supported: true,
      reason: null,
    });
    const candidate = starter(source);
    expect(candidate.source.fingerprint.length).toBeGreaterThan(4_000);
    expect(candidate.source.body[0]!.text).toHaveLength(4_000);
    expect(
      inserted(deck(source), candidate)
        .block.citations!.map((item) => item.excerpt)
        .join(""),
    ).toBe("Research priorities" + "x".repeat(4_000));
  });

  it("uses every body object in semantic order and retains independent source languages privately", () => {
    const source = slide("First body point");
    source.scene!.schemaVersion = 7;
    Object.assign(source.scene!.nodes[1]!, { lang: "fr" });
    source.scene!.nodes.push({
      ...source.scene!.nodes[1]!,
      id: "Body:Second",
      text: "Second body point",
      lang: "ja",
    } as never);
    source.scene!.readingOrder = ["Title:Exact", "Body:Second", "Body:Exact"];
    const candidate = starter(source, "priority");
    expect(candidate.choices).toEqual(["Second body point", "First body point"]);
    expect(candidate.source.body.map((body) => [body.nodeId, body.lang])).toEqual([
      ["Body:Second", "ja"],
      ["Body:Exact", "fr"],
    ]);
    const saved = inserted(deck(source), candidate).block;
    expect(saved.sourceDisclosure!.conversionNotes!.slice(2)).toEqual([
      "Body 1 node Body:Second; language: ja.",
      "Body 2 node Body:Exact; language: fr.",
    ]);
  });

  it("keeps complete astral wording across private excerpt boundaries without splitting surrogate pairs", () => {
    const body = "x".repeat(499) + "😀" + "y".repeat(501),
      source = slide(body);
    const saved = inserted(deck(source), starter(source)).block;
    const excerpts = saved.citations!.slice(1).map((citation) => citation.excerpt);
    expect(excerpts.join("")).toBe(body);
    expect(
      excerpts.every(
        (excerpt) =>
          excerpt.length <= 500 &&
          !/[\uD800-\uDBFF]$/u.test(excerpt) &&
          !/^[\uDC00-\uDFFF]/u.test(excerpt),
      ),
    ).toBe(true);
  });

  it("matches uppercase UUID source identities while preserving exact node identity and existing saved bytes", () => {
    const original = slide();
    original.id = uuid(0xabc);
    const candidate = starter(original, "priority"),
      savedSource = structuredClone(original);
    savedSource.id = original.id.toUpperCase();
    const current = deck(savedSource),
      result = inserted(current, candidate);
    expect(result.draft.blocks[0]).toBe(current.blocks[0]);
    expect(result.draft.blocks[0]!.id).toBe(savedSource.id);
    expect(result.block.sourceDisclosure!.sourceDigest).toBe(candidate.source.sourceDigest);
    expect(
      insertPresentationQuestionStarter(current, candidate, {
        ...ids(candidate),
        blockId: original.id,
      }).ok,
    ).toBe(false);
  });

  it.each(["discussion", "clarity", "priority"] as const)(
    "inserts one complete unscored %s question and preserves all prior content",
    (kind) => {
      const source = slide(),
        current = freeze(deck(source)),
        before = JSON.stringify(current),
        candidate = starter(source, kind);
      const result = inserted(current, candidate);
      expect(result.draft.blocks).toHaveLength(2);
      expect(result.draft.blocks[0]).toBe(current.blocks[0]);
      expect(result.block.question).toMatchObject({
        purpose: "opinion",
        confidence: "off",
        basePoints: 0,
        delivery: "main",
        linkedRecheckQuestionId: null,
        timeLimitSeconds: 20,
      });
      if ("choices" in result.block.question)
        expect(result.block.question.choices.every((choice) => !choice.isCorrect)).toBe(true);
      expect(result.block.provenance).toBeUndefined();
      expect(result.block.question.sourceCitations).toBeUndefined();
      expect(result.block.sourceDisclosure).toMatchObject({
        provider: "local",
        model: "question-starters-v1",
        sourceDigest: candidate.source.sourceDigest,
      });
      expect(result.block.sourceDisclosure!.conversionNotes!.join("\n")).toContain("Body:Exact");
      expect(result.block.citations!.map((citation) => citation.excerpt)).toEqual([
        "Research priorities",
        "Customer interviews\nPrototype testing",
      ]);
      expect(JSON.stringify(result.block)).not.toContain("PRIVATE");
      expect(JSON.stringify(result.block)).not.toContain("old-provider");
      expect(PresentationContentSchema.safeParse(result.draft).success).toBe(true);
      expect(result.draft.schemaVersion).toBe(kind === "discussion" ? 10 : 4);
      expect(JSON.stringify(current)).toBe(before);
      expect(insertPresentationQuestionStarter(result.draft, candidate, ids(candidate)).ok).toBe(
        false,
      );
    },
  );

  it("inherits the source section, allocates a spatial frame and retains document16 and original provenance", () => {
    const current = deck();
    current.schemaVersion = 16;
    current.sections = [{ id: uuid(60), title: "Research", blockIds: [uuid(1)] }];
    current.spatial = {
      schemaVersion: 1,
      frames: [{ blockId: uuid(1), x: 100, y: 100, width: 1280, height: 720 }],
    };
    const result = inserted(
      freeze(current),
      starter(current.blocks[0] as ContentSlideDraft, "priority"),
    );
    expect(result.draft.schemaVersion).toBe(16);
    expect(result.draft.sections![0]!.blockIds).toEqual([uuid(1), uuid(100)]);
    expect(result.draft.spatial!.frames[0]).toBe(current.spatial.frames[0]);
    expect(result.draft.spatial!.frames.some((frame) => frame.blockId === uuid(100))).toBe(true);
    expect(result.draft.blocks[0]).toBe(current.blocks[0]);
    expect(PresentationDraftSchema.safeParse(result.draft).success).toBe(true);
  });

  it("rejects title/body/identity/language/list-kind/reading-order changes rather than silently regenerating", () => {
    const original = slide(),
      candidate = starter(original, "priority");
    const changes = [
      (block: ContentSlideDraft) => {
        block.id = uuid(2);
      },
      (block: ContentSlideDraft) => {
        (block.scene!.nodes[0] as { text: string }).text += "!";
      },
      (block: ContentSlideDraft) => {
        (block.scene!.nodes[1] as { text: string }).text += "!";
      },
      (block: ContentSlideDraft) => {
        block.scene!.nodes[1]!.id = "body:exact";
        block.scene!.readingOrder[1] = "body:exact";
      },
      (block: ContentSlideDraft) => {
        block.scene!.schemaVersion = 7;
        Object.assign(block.scene!.nodes[1]!, { lang: "fr" });
      },
      (block: ContentSlideDraft) => {
        block.scene!.readingOrder.reverse();
      },
      (block: ContentSlideDraft) => {
        block.scene!.schemaVersion = 2;
        Object.assign(block.scene!.nodes[1]!, {
          richText: plainTextToPresentationRichText("Customer interviews\nPrototype testing"),
        });
        const body = block.scene!.nodes[1]!;
        if (body.type === "text") body.richText!.paragraphs[0]!.kind = "bullet";
      },
      (block: ContentSlideDraft) => {
        block.hidden = true;
      },
    ];
    for (const change of changes) {
      const source = structuredClone(original);
      change(source);
      expect(insertPresentationQuestionStarter(deck(source), candidate, ids(candidate)).ok).toBe(
        false,
      );
    }
  });

  it("permits geometry, paint, private-note and prior-citation edits that do not change the reviewed source", () => {
    const original = slide(),
      candidate = starter(original),
      updated = structuredClone(original);
    updated.scene!.schemaVersion = 3;
    updated.scene!.design = { theme: "ocean", font: "serif", spacing: "compact" };
    const body = updated.scene!.nodes[1]!;
    if (body.type !== "text") throw new Error("Expected text");
    body.frame = { x: 10, y: 35, width: 80, height: 50 };
    updated.speakerNotes = "A newer private note";
    updated.citations = [{ locator: "Another private source", excerpt: "Do not copy" }];
    expect(inserted(deck(updated), candidate).draft.blocks[0]).toEqual(updated);
  });

  it("rejects modified proposal contents and fabricated source hashes", () => {
    const source = slide(),
      candidate = starter(source, "priority"),
      current = deck(source);
    for (const altered of [
      { ...candidate, prompt: "An invented question" },
      { ...candidate, choices: ["An invented option", "Other"] },
      { ...candidate, source: { ...candidate.source, sourceDigest: "b".repeat(64) } },
      { ...candidate, source: { ...candidate.source, fingerprint: "fabricated" } },
    ])
      expect(insertPresentationQuestionStarter(current, altered, ids(candidate)).ok).toBe(false);
  });

  it("rejects duplicate or invalid UUIDs and wrong choice counts, including case variants", () => {
    const current = deck(),
      candidate = starter(current.blocks[0] as ContentSlideDraft, "priority");
    for (const prepared of [
      { ...ids(candidate), blockId: uuid(1).toUpperCase() },
      { ...ids(candidate), questionId: uuid(100) },
      { ...ids(candidate), blockId: "not-a-uuid" },
      { ...ids(candidate), choiceIds: [uuid(102), uuid(102)] },
      { ...ids(candidate), choiceIds: [uuid(102)] },
    ])
      expect(insertPresentationQuestionStarter(current, candidate, prepared).ok).toBe(false);
  });

  it("enforces existing total-slide and text-question limits without changing the input", () => {
    const full = deck();
    for (let index = 1; index < 200; index++)
      full.blocks.push({ ...slide(), id: uuid(1_000 + index) });
    expect(PresentationDraftSchema.safeParse(full).success).toBe(true);
    expect(insertPresentationQuestionStarter(full, starter(), ids(starter())).ok).toBe(false);
    let current = deck();
    const discussion = starter();
    for (let index = 0; index < 10; index++)
      current = inserted(current, discussion, ids(discussion, 2_000 + index * 3)).draft;
    expect(PresentationDraftSchema.safeParse(current).success).toBe(true);
    expect(insertPresentationQuestionStarter(current, discussion, ids(discussion)).ok).toBe(false);
    expect(
      insertPresentationQuestionStarter(
        current,
        starter(slide(), "clarity"),
        ids(starter(slide(), "clarity")),
      ).ok,
    ).toBe(true);
  });

  it("refuses an otherwise valid insertion that would exceed the existing document byte budget", () => {
    const source = slide("x".repeat(4_000)),
      current = deck(source),
      candidate = starter(source);
    const bytes = () => new TextEncoder().encode(JSON.stringify(current)).length;
    const target = PRESENTATION_NATIVE_DOCUMENT_MAX_BYTES - 1_000;
    let index = 3_000;
    while (true) {
      const filler = slide();
      filler.id = uuid(index++);
      filler.scene!.nodes = Array.from(
        { length: 29 },
        (_, nodeIndex) =>
          ({
            ...slide().scene!.nodes[1]!,
            id: `Body${nodeIndex}`,
            text: "x".repeat(4_000),
          }) as never,
      );
      filler.scene!.nodes.unshift({ ...slide().scene!.nodes[0]! });
      filler.scene!.readingOrder = filler.scene!.nodes.map((node) => node.id);
      current.blocks.push(filler);
      if (bytes() <= target) continue;
      for (const node of filler.scene!.nodes)
        if (node.type === "text" && node.role === "body") node.text = "";
      for (const node of filler.scene!.nodes)
        if (node.type === "text" && node.role === "body")
          node.text = "x".repeat(Math.min(4_000, Math.max(0, target - bytes())));
      break;
    }
    expect(bytes()).toBe(target);
    expect(PresentationDraftSchema.safeParse(current).success).toBe(true);
    const before = JSON.stringify(current);
    expect(insertPresentationQuestionStarter(current, candidate, ids(candidate)).ok).toBe(false);
    expect(JSON.stringify(current)).toBe(before);
  });
});

describe("captured question-starter creation language", () => {
  it.each(supportedLocales)(
    "preserves exact source and inserts the reviewed %s scaffold",
    (locale) => {
      const source = slide("Original alpha\nOriginal beta");
      const draft = deck(source);
      const original = structuredClone(draft);
      const candidates = createPresentationQuestionStarters(source, locale);
      expect(candidates).toHaveLength(3);
      for (const candidate of candidates) {
        expect(candidate.prompt).toContain("Research priorities");
        expect(candidate.source).toEqual(createPresentationQuestionStarters(source)[0]!.source);
        const result = insertPresentationQuestionStarter(
          draft,
          structuredClone(candidate),
          ids(candidate),
        );
        expect(result.ok).toBe(true);
        if (!result.ok) throw new Error(result.reason);
        expect(result.draft.blocks[1]).toMatchObject({
          kind: "question",
          question: { prompt: candidate.prompt, basePoints: 0, purpose: "opinion" },
        });
        if (locale !== "en-CA") {
          expect(candidate.prompt).not.toBe(
            createPresentationQuestionStarters(source).find((item) => item.id === candidate.id)!
              .prompt,
          );
          const tampered = { ...candidate, creationLocale: "en-CA" as const };
          expect(insertPresentationQuestionStarter(draft, tampered, ids(candidate)).ok).toBe(false);
        }
      }
      expect(candidates[2]!.choices).toEqual(["Original alpha", "Original beta"]);
      expect(draft).toEqual(original);
    },
  );
});
