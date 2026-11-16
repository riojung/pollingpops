import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  CreatePresentationQuestionSuggestionsJobSchema,
  InsertPresentationQuestionSuggestionSchema,
  PresentationContentSchema,
  PresentationDraftSchema,
  PresentationQuestionSuggestionSourceSchema,
  PresentationQuestionSuggestionInsertedBlockSchema,
  PresentationQuestionSuggestionCitationSchema,
  PresentationQuestionSuggestionsJobSchema,
  PresentationQuestionSuggestionsProposalSchema,
  PRESENTATION_QUESTION_SUGGESTIONS_ERROR_MESSAGES,
  PRESENTATION_QUESTION_SUGGESTIONS_REVIEW_WARNING,
  buildPresentationQuestionSuggestionBlock,
  presentationQuestionSuggestionInsertedBlockHash,
  presentationQuestionSuggestionInsertionIds,
  presentationQuestionSuggestionSource,
  presentationQuestionSuggestionSourceSections,
  presentationQuestionSuggestionsProposalHash,
  presentationQuestionSuggestionsRequestHash,
  presentationQuestionSuggestionsSourceDigest,
  presentationQuestionSuggestionsSourceFingerprint,
  type ContentSlideDraft,
  type PresentationQuestionSuggestionSource,
  type PresentationQuestionSuggestionsProposal,
} from "../src/index";

const id = (n: number) => `00000000-0000-4000-8000-${n.toString().padStart(12, "0")}`;
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
function block(body = "Compare customer interviews.\nTest a prototype."): ContentSlideDraft {
  return {
    id: id(1),
    kind: "content",
    layout: "title_body",
    textElements: [],
    mediaId: null,
    mediaAlt: null,
    speakerNotes: "PRIVATE NOTES",
    citations: [{ locator: "PRIVATE IMPORT", excerpt: "PRIVATE EXTERNAL EVIDENCE" }],
    sourceDisclosure: {
      sourceName: "PRIVATE SOURCE",
      sourceDigest: "a".repeat(64),
      provider: "PRIVATE ORIGINAL PROVIDER",
      model: "private-original-model",
    },
    scene: {
      schemaVersion: 1,
      aspectRatio: "16:9",
      nodes: [
        {
          id: "Title:Exact",
          type: "text",
          role: "title",
          text: "Research choices",
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
function source(current = block()): PresentationQuestionSuggestionSource {
  const result = presentationQuestionSuggestionSource(current);
  if (!result.supported) throw new Error(result.reason);
  return result.source;
}
function proposal(current = source()): PresentationQuestionSuggestionsProposal {
  return PresentationQuestionSuggestionsProposalSchema.parse({
    schemaVersion: 1,
    blockId: current.blockId,
    source: current,
    sourceDigest: presentationQuestionSuggestionsSourceDigest(current),
    outputLanguage: "en",
    suggestions: [
      {
        id: id(12),
        kind: "discussion",
        type: "open_text",
        prompt: "What would you want to learn from customer interviews?",
        citations: [{ locator: "body 1 paragraph 1", excerpt: "customer interviews" }],
      },
      {
        id: id(13),
        kind: "reflection",
        type: "open_text",
        prompt: "How might testing a prototype change your next step?",
        citations: [{ locator: "body 1 paragraph 2", excerpt: "Test a prototype." }],
      },
    ],
    provider: "approved",
    model: "bounded-questions",
    generatedAt: "2026-11-07T00:00:00.000Z",
    reviewWarning: PRESENTATION_QUESTION_SUGGESTIONS_REVIEW_WARNING,
  });
}
function job(value = proposal()) {
  return {
    schemaVersion: 1,
    id: id(10),
    requestId: id(10),
    presentationId: id(2),
    blockId: value.blockId,
    sourceRevision: 4,
    sourceDigest: value.sourceDigest,
    outputLanguage: "en",
    status: "ready",
    attempts: 1,
    proposal: value,
    proposalHash: presentationQuestionSuggestionsProposalHash(value),
    error: null,
    createdAt: "2026-11-07T00:00:00.000Z",
    updatedAt: "2026-11-07T00:00:01.000Z",
    expiresAt: "2026-11-08T00:00:00.000Z",
  };
}
const request = () => ({
  schemaVersion: 1,
  requestId: id(10),
  presentationId: id(2),
  blockId: id(1),
  expectedRevision: 4,
  sourceDigest: presentationQuestionSuggestionsSourceDigest(source()),
  outputLanguage: "en",
});
const insert = () => ({
  schemaVersion: 1,
  jobId: id(10),
  proposalHash: presentationQuestionSuggestionsProposalHash(proposal()),
  blockId: id(1),
  sourceDigest: proposal().sourceDigest,
  suggestionId: id(12),
  reviewed: true,
  expectedRevision: 4,
  mutationId: id(11),
});
function built(value = proposal(), suggestionId = id(12)) {
  return buildPresentationQuestionSuggestionBlock({
    proposal: value,
    jobId: id(10),
    suggestionId,
    mutationId: id(11),
  });
}
function freeze<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

describe("source-grounded presentation question suggestion contracts", () => {
  it("preserves the exact PR209 source fingerprint bytes and canonical SHA256 without importing private context", () => {
    const current = freeze(block()),
      before = JSON.stringify(current),
      projected = source(current);
    const expected = {
      blockId: id(1),
      title: { nodeId: "Title:Exact", text: "Research choices", lang: null },
      body: [
        {
          nodeId: "Body:Exact",
          text: "Compare customer interviews.\nTest a prototype.",
          lang: null,
          paragraphs: [
            { kind: "paragraph", text: "Compare customer interviews." },
            { kind: "paragraph", text: "Test a prototype." },
          ],
        },
      ],
      readingOrder: ["Title:Exact", "Body:Exact"],
    };
    expect(projected).toEqual(expected);
    expect(presentationQuestionSuggestionsSourceFingerprint(projected)).toBe(
      JSON.stringify(expected),
    );
    expect(presentationQuestionSuggestionsSourceDigest(projected)).toBe(
      hash(JSON.stringify(expected)),
    );
    expect(JSON.stringify(projected)).not.toContain("PRIVATE");
    expect(JSON.stringify(current)).toBe(before);
  });

  it("keeps CRLF, whitespace, emoji and a full4,000-character source exact without another domain's hash limit", () => {
    for (const text of [
      " Evidence 😀\r\n\r\n Next step ",
      "x".repeat(4_000),
      "\n".repeat(3_999) + "x",
    ]) {
      const value = source(block(text));
      expect(value.body[0]!.text).toBe(text);
      expect(value.body[0]!.paragraphs.map((paragraph) => paragraph.text)).toEqual(
        text.split(/\r\n?|\n/u),
      );
      expect(presentationQuestionSuggestionsSourceDigest(value)).toBe(hash(JSON.stringify(value)));
    }
  });

  it("uses visible rich text/list kinds and independent languages in semantic order, ignoring linked destinations and other objects", () => {
    const current = block();
    current.scene!.schemaVersion = 7;
    const body = current.scene!.nodes[1]!;
    if (body.type !== "text") throw new Error("Expected text");
    body.lang = "fr";
    body.richText = {
      paragraphs: [
        {
          kind: "bullet",
          runs: [
            {
              text: "Compare customer interviews.",
              bold: true,
              href: "https://private.example/destination",
            },
          ],
        },
        { kind: "numbered", runs: [{ text: "Test a prototype." }] },
      ],
    };
    current.scene!.nodes.push(
      { ...body, id: "Body:Second", text: "その他", lang: "ja", richText: undefined },
      {
        id: "Dialog",
        type: "dialog",
        scope: "local",
        label: "Details",
        detailTitle: "PRIVATE DETAIL",
        body: "PRIVATE CLOSED WORDING",
        frame: { x: 80, y: 80, width: 10, height: 10 },
      },
    );
    current.scene!.readingOrder = ["Body:Second", "Title:Exact", "Dialog", "Body:Exact"];
    const projected = source(current);
    expect(projected.body.map((body) => [body.nodeId, body.lang])).toEqual([
      ["Body:Second", "ja"],
      ["Body:Exact", "fr"],
    ]);
    expect(projected.body[1]!.paragraphs.map((paragraph) => paragraph.kind)).toEqual([
      "bullet",
      "numbered",
    ]);
    expect(projected.readingOrder).toEqual(current.scene!.readingOrder);
    expect(JSON.stringify(projected)).not.toMatch(/PRIVATE|private.example|bold/u);
  });

  it("binds case-sensitive node identities, visible text, language, list structure and reading order while ignoring geometry/style/notes", () => {
    const current = block(),
      original = source(current),
      originalHash = presentationQuestionSuggestionsSourceDigest(original);
    const painted = structuredClone(current);
    painted.scene!.schemaVersion = 3;
    painted.scene!.design = { theme: "ocean", font: "serif", spacing: "compact" };
    Object.assign(painted.scene!.nodes[1]!, { frame: { x: 10, y: 35, width: 80, height: 50 } });
    painted.speakerNotes = "Changed note";
    expect(presentationQuestionSuggestionsSourceDigest(source(painted))).toBe(originalHash);
    const mutations: ((value: PresentationQuestionSuggestionSource) => void)[] = [
      (value) => {
        value.title.text += "!";
      },
      (value) => {
        value.body[0]!.text += "!";
        value.body[0]!.paragraphs[1]!.text += "!";
      },
      (value) => {
        value.body[0]!.lang = "fr";
      },
      (value) => {
        value.body[0]!.nodeId = "body:exact";
        value.readingOrder[1] = "body:exact";
      },
      (value) => {
        value.body[0]!.paragraphs[0]!.kind = "bullet";
      },
      (value) => {
        value.readingOrder.reverse();
      },
    ];
    for (const change of mutations) {
      const modified = structuredClone(original);
      change(modified);
      expect(presentationQuestionSuggestionsSourceDigest(modified)).not.toBe(originalHash);
    }
  });

  it("declines hidden/classic/blank/invalid sources and binds up to eight nonblank bodies within the shared4k bound", () => {
    for (const current of [
      { ...block(), hidden: true as const },
      { ...block(), scene: undefined },
      block(" "),
      (() => {
        const current = block();
        current.scene!.readingOrder = ["missing"];
        return current;
      })(),
      (() => {
        const current = block();
        for (let n = 1; n < 9; n++) {
          current.scene!.nodes.push({ ...current.scene!.nodes[1]!, id: `Body:${n}` });
          current.scene!.readingOrder.push(`Body:${n}`);
        }
        return current;
      })(),
      (() => {
        const current = block("x".repeat(3_000));
        current.scene!.nodes.push({ ...current.scene!.nodes[1]!, id: "Other" });
        current.scene!.readingOrder.push("Other");
        return current;
      })(),
    ]) {
      const result = presentationQuestionSuggestionSource(current);
      expect(result.supported).toBe(false);
      if (!result.supported) expect(result.reason).toBeTruthy();
    }
  });

  it("rejects forged source projections, ordering, aliases, controls and unaccounted paragraph wording without throwing safeParse", () => {
    const valid = source();
    for (const value of [
      { ...valid, surprise: "private" },
      { ...valid, readingOrder: ["Title:Exact", "Title:Exact"] },
      { ...valid, title: { ...valid.title, lang: "en-CA" } },
      { ...valid, title: { ...valid.title, nodeId: "bad\u0000" } },
      {
        ...valid,
        body: [{ ...valid.body[0]!, paragraphs: [{ kind: "paragraph", text: "Invented source" }] }],
      },
    ])
      expect(PresentationQuestionSuggestionSourceSchema.safeParse(value).success).toBe(false);
    const invalid = { ...proposal(), source: { ...valid, readingOrder: [] } };
    expect(PresentationQuestionSuggestionsProposalSchema.safeParse(invalid).success).toBe(false);
    expect(
      PresentationQuestionSuggestionsJobSchema.safeParse({ ...job(), proposal: invalid }).success,
    ).toBe(false);
  });

  it("exposes exact stable title/body-paragraph locators without source notes, IDs or link destinations", () => {
    expect(presentationQuestionSuggestionSourceSections(source())).toEqual([
      { locator: "title", text: "Research choices" },
      { locator: "body 1 paragraph 1", text: "Compare customer interviews." },
      { locator: "body 1 paragraph 2", text: "Test a prototype." },
    ]);
  });

  it("requires a strict explicit English request and hashes complete canonical intent independent of JSON key order", () => {
    const valid = request(),
      parsed = CreatePresentationQuestionSuggestionsJobSchema.parse(valid);
    expect(presentationQuestionSuggestionsRequestHash(valid)).toBe(hash(JSON.stringify(parsed)));
    expect(
      presentationQuestionSuggestionsRequestHash(
        Object.fromEntries(Object.entries(valid).reverse()),
      ),
    ).toBe(presentationQuestionSuggestionsRequestHash(valid));
    for (const patch of [
      { outputLanguage: "fr" },
      { outputLanguage: undefined },
      { expectedRevision: -1 },
      { sourceDigest: "invalid" },
      { source: source() },
    ])
      expect(
        CreatePresentationQuestionSuggestionsJobSchema.safeParse({ ...valid, ...patch }).success,
      ).toBe(false);
    for (const patch of [
      { requestId: id(20) },
      { presentationId: id(20) },
      { blockId: id(20) },
      { expectedRevision: 5 },
      { sourceDigest: "b".repeat(64) },
    ])
      expect(presentationQuestionSuggestionsRequestHash({ ...valid, ...patch })).not.toBe(
        presentationQuestionSuggestionsRequestHash(valid),
      );
  });

  it("requires exactly two distinct ordered discussion/reflection open-text proposals and exact body citations", () => {
    const valid = proposal();
    expect(PresentationQuestionSuggestionsProposalSchema.safeParse(valid).success).toBe(true);
    for (const suggestions of [
      valid.suggestions.slice(0, 1),
      [...valid.suggestions, valid.suggestions[0]!],
      [...valid.suggestions].reverse(),
      [{ ...valid.suggestions[0]!, type: "single_select", choices: [] }, valid.suggestions[1]!],
      [
        {
          ...valid.suggestions[0]!,
          citations: [{ locator: "title", excerpt: "Research choices" }],
        },
        valid.suggestions[1]!,
      ],
      [
        {
          ...valid.suggestions[0]!,
          citations: [{ locator: "body 1 paragraph 2", excerpt: "customer interviews" }],
        },
        valid.suggestions[1]!,
      ],
      [
        {
          ...valid.suggestions[0]!,
          citations: [{ locator: "body 1 paragraph 1", excerpt: "a fabricated claim" }],
        },
        valid.suggestions[1]!,
      ],
      [{ ...valid.suggestions[0]!, citations: [] }, valid.suggestions[1]!],
      [valid.suggestions[0]!, { ...valid.suggestions[1]!, id: valid.suggestions[0]!.id }],
      [
        valid.suggestions[0]!,
        { ...valid.suggestions[1]!, prompt: valid.suggestions[0]!.prompt.toUpperCase() },
      ],
    ])
      expect(
        PresentationQuestionSuggestionsProposalSchema.safeParse({ ...valid, suggestions }).success,
      ).toBe(false);
  });

  it("rejects forged source identities/digests and binds the entire canonical proposal including metadata", () => {
    const valid = proposal(),
      expected = presentationQuestionSuggestionsProposalHash(valid);
    expect(expected).toBe(hash(JSON.stringify(valid)));
    expect(
      presentationQuestionSuggestionsProposalHash(
        Object.fromEntries(Object.entries(valid).reverse()),
      ),
    ).toBe(expected);
    for (const patch of [
      { blockId: id(5) },
      { sourceDigest: "b".repeat(64) },
      { outputLanguage: "fr" },
      { reviewWarning: "Verified" },
      { provider: "x".repeat(81) },
      { model: "x".repeat(121) },
    ])
      expect(
        PresentationQuestionSuggestionsProposalSchema.safeParse({ ...valid, ...patch }).success,
      ).toBe(false);
    for (const patch of [
      { provider: "other" },
      { model: "other" },
      { generatedAt: "2026-11-07T00:01:00.000Z" },
    ])
      expect(presentationQuestionSuggestionsProposalHash({ ...valid, ...patch })).not.toBe(
        expected,
      );
  });

  it("rejects interior NUL, unsupported C0 and DEL in generated wording and identities instead of creating proposals PostgreSQL cannot retain", () => {
    const valid = proposal(),
      created = built(valid);
    const forbidden = [...Array.from({ length: 32 }, (_, code) => code), 127].filter(
      (code) => ![9, 10, 13].includes(code),
    );
    for (const code of forbidden) {
      const text = `before${String.fromCharCode(code)}after`;
      const invalidPrompt = {
        ...valid,
        suggestions: [{ ...valid.suggestions[0]!, prompt: text }, valid.suggestions[1]!],
      };
      expect(PresentationQuestionSuggestionsProposalSchema.safeParse(invalidPrompt).success).toBe(
        false,
      );
      expect(
        PresentationQuestionSuggestionsJobSchema.safeParse({
          ...job(valid),
          proposal: invalidPrompt,
        }).success,
      ).toBe(false);
      expect(
        PresentationQuestionSuggestionInsertedBlockSchema.safeParse({
          ...created,
          question: { ...created.question, prompt: text },
        }).success,
      ).toBe(false);
      for (const field of ["provider", "model"] as const) {
        expect(
          PresentationQuestionSuggestionsProposalSchema.safeParse({ ...valid, [field]: text })
            .success,
        ).toBe(false);
        expect(
          PresentationQuestionSuggestionInsertedBlockSchema.safeParse({
            ...created,
            sourceDisclosure: { ...created.sourceDisclosure!, [field]: text },
          }).success,
        ).toBe(false);
      }
    }
  });

  it("preserves canonical bytes and hashes for SQL-permitted interior tabs, line breaks and Unicode", () => {
    const valid = proposal();
    const unchanged = {
      ...valid,
      provider: "approved\tprovider\u00a0é😀",
      model: "model\nline\rcarriage\u0085\u2028\u2029end",
      suggestions: [
        {
          ...valid.suggestions[0]!,
          prompt: "How do A\tB\nC\rD\u00a0é😀\u0085\u2028\u2029 relate to the interview choice?",
        },
        valid.suggestions[1]!,
      ],
    };
    const parsed = PresentationQuestionSuggestionsProposalSchema.parse(unchanged);
    expect(JSON.stringify(parsed)).toBe(JSON.stringify(unchanged));
    expect(presentationQuestionSuggestionsProposalHash(parsed)).toBe(
      hash(JSON.stringify(unchanged)),
    );
    const created = built(parsed);
    expect(created.question.prompt).toBe(unchanged.suggestions[0]!.prompt);
    expect(created.sourceDisclosure).toMatchObject({
      provider: unchanged.provider,
      model: unchanged.model,
    });
    expect(presentationQuestionSuggestionInsertedBlockHash(created)).toBe(
      hash(JSON.stringify(created)),
    );
  });

  it("rejects lone high and low surrogates in generated prompts, provider identities and citation strings", () => {
    const valid = proposal(),
      created = built(valid);
    for (const lone of ["\ud800", "\ud83d", "\udc00", "\ude00"]) {
      const text = `before${lone}after`;
      expect(
        PresentationQuestionSuggestionsProposalSchema.safeParse({
          ...valid,
          suggestions: [{ ...valid.suggestions[0]!, prompt: text }, valid.suggestions[1]!],
        }).success,
      ).toBe(false);
      expect(
        PresentationQuestionSuggestionInsertedBlockSchema.safeParse({
          ...created,
          question: { ...created.question, prompt: text },
        }).success,
      ).toBe(false);
      for (const field of ["provider", "model"] as const) {
        expect(
          PresentationQuestionSuggestionsProposalSchema.safeParse({ ...valid, [field]: text })
            .success,
        ).toBe(false);
        expect(
          PresentationQuestionSuggestionInsertedBlockSchema.safeParse({
            ...created,
            sourceDisclosure: { ...created.sourceDisclosure!, [field]: text },
          }).success,
        ).toBe(false);
      }
      expect(
        PresentationQuestionSuggestionCitationSchema.safeParse({
          locator: text,
          excerpt: "Valid words",
        }).success,
      ).toBe(false);
      expect(
        PresentationQuestionSuggestionCitationSchema.safeParse({
          locator: "body 1 paragraph 1",
          excerpt: text,
        }).success,
      ).toBe(false);
      expect(
        PresentationQuestionSuggestionInsertedBlockSchema.safeParse({
          ...created,
          citations: [{ locator: "body 1 paragraph 1", excerpt: text }],
        }).success,
      ).toBe(false);
    }
  });

  it("rejects a citation matching only half a source emoji while preserving valid pairs and exact canonical Unicode bytes", () => {
    const raw = structuredClone(proposal());
    raw.source.body[0]!.text = "Compare customer interviews 😀.\nTest a prototype.";
    raw.source.body[0]!.paragraphs[0]!.text = "Compare customer interviews 😀.";
    raw.sourceDigest = presentationQuestionSuggestionsSourceDigest(raw.source);
    raw.suggestions[0]!.prompt = "How could 👩‍💻 interviews inform an e\u0301 prototype?";
    raw.suggestions[0]!.citations[0]!.excerpt = "😀";
    raw.provider = "approved😀";
    raw.model = "bounded👩‍💻";
    const valid = PresentationQuestionSuggestionsProposalSchema.parse(raw);
    expect(JSON.stringify(valid)).toBe(JSON.stringify(raw));
    expect(presentationQuestionSuggestionsProposalHash(valid)).toBe(hash(JSON.stringify(raw)));
    const created = built(valid);
    expect(created.citations![0]!.excerpt).toBe("😀");
    expect(presentationQuestionSuggestionInsertedBlockHash(created)).toBe(
      hash(JSON.stringify(created)),
    );
    for (const half of ["\ud83d", "\ude00"]) {
      expect(valid.source.body[0]!.text.includes(half)).toBe(true);
      const invalid = structuredClone(valid);
      invalid.suggestions[0]!.citations[0]!.excerpt = half;
      expect(PresentationQuestionSuggestionsProposalSchema.safeParse(invalid).success).toBe(false);
      expect(
        PresentationQuestionSuggestionsJobSchema.safeParse({ ...job(valid), proposal: invalid })
          .success,
      ).toBe(false);
    }
  });

  it("binds ready job identity and proposal, and keeps nonready/failed/expired private bodies erased", () => {
    const valid = job();
    expect(PresentationQuestionSuggestionsJobSchema.safeParse(valid).success).toBe(true);
    for (const patch of [
      { requestId: id(99) },
      { blockId: id(99) },
      { sourceDigest: "b".repeat(64) },
      { proposalHash: "b".repeat(64) },
      { proposal: null },
      { status: "pending" },
      { attempts: 4 },
    ])
      expect(
        PresentationQuestionSuggestionsJobSchema.safeParse({ ...valid, ...patch }).success,
      ).toBe(false);
    const pending = {
      ...valid,
      status: "pending",
      attempts: 0,
      proposal: null,
      proposalHash: null,
    };
    expect(PresentationQuestionSuggestionsJobSchema.safeParse(pending).success).toBe(true);
    const failed = {
      ...pending,
      status: "failed",
      error: {
        code: "INVALID_OUTPUT",
        message: PRESENTATION_QUESTION_SUGGESTIONS_ERROR_MESSAGES.INVALID_OUTPUT,
      },
    };
    expect(PresentationQuestionSuggestionsJobSchema.safeParse(failed).success).toBe(true);
    expect(
      PresentationQuestionSuggestionsJobSchema.safeParse({
        ...failed,
        error: { ...failed.error, message: "provider detail" },
      }).success,
    ).toBe(false);
    expect(
      PresentationQuestionSuggestionsJobSchema.safeParse({
        ...pending,
        status: "expired",
        error: {
          code: "EXPIRED",
          message: PRESENTATION_QUESTION_SUGGESTIONS_ERROR_MESSAGES.EXPIRED,
        },
      }).success,
    ).toBe(true);
    expect(
      PresentationQuestionSuggestionsJobSchema.safeParse({ ...pending, status: "expired" }).success,
    ).toBe(false);
  });

  it("accepts only one reviewed suggestion identity with exact source and revision fences, without a fallback anchor", () => {
    expect(InsertPresentationQuestionSuggestionSchema.safeParse(insert()).success).toBe(true);
    for (const patch of [
      { reviewed: false },
      { suggestionId: undefined },
      { selectedSuggestionIds: [id(12), id(13)] },
      { afterBlockId: id(99) },
      { expectedRevision: -1 },
    ])
      expect(
        InsertPresentationQuestionSuggestionSchema.safeParse({ ...insert(), ...patch }).success,
      ).toBe(false);
  });

  it("derives stable lowercase separate block/question UUIDs from exact job, mutation and suggestion identities", () => {
    const identity = { jobId: id(10), mutationId: id(11), suggestionId: id(12) };
    expect(presentationQuestionSuggestionInsertionIds(identity)).toEqual({
      blockId: "ed05f4f9-0a5a-5e63-b8e8-808312342372",
      questionId: "778952d6-07ae-58e7-b747-8e83f18da098",
    });
    for (const patch of [{ jobId: id(20) }, { mutationId: id(20) }, { suggestionId: id(20) }])
      expect(presentationQuestionSuggestionInsertionIds({ ...identity, ...patch })).not.toEqual(
        presentationQuestionSuggestionInsertionIds(identity),
      );
    expect(() =>
      presentationQuestionSuggestionInsertionIds({ ...identity, jobId: "invalid" }),
    ).toThrow();
  });

  it("builds one independently editable unscored question with truthful AI attribution and preserves all source inputs", () => {
    const value = freeze(proposal()),
      before = JSON.stringify(value),
      created = built(value);
    expect(created.question).toMatchObject({
      type: "open_text",
      prompt: value.suggestions[0]!.prompt,
      purpose: "opinion",
      confidence: "off",
      delivery: "main",
      basePoints: 0,
      timeLimitSeconds: 20,
      linkedRecheckQuestionId: null,
    });
    expect(created.question.sourceCitations).toBeUndefined();
    expect(created.provenance).toBeUndefined();
    expect(created.citations).toEqual(value.suggestions[0]!.citations);
    expect(created.sourceDisclosure).toMatchObject({
      sourceName: "Research choices",
      sourceDigest: value.sourceDigest,
      provider: "approved",
      model: "bounded-questions",
    });
    expect(created.sourceDisclosure!.conversionNotes![0]).toContain(
      PRESENTATION_QUESTION_SUGGESTIONS_REVIEW_WARNING,
    );
    expect(JSON.stringify(created)).not.toContain("PRIVATE");
    expect(JSON.stringify(value)).toBe(before);
    const draft = PresentationDraftSchema.parse({
      schemaVersion: 10,
      title: "Existing deck",
      blocks: [block(), created],
    });
    expect(PresentationContentSchema.safeParse(draft).success).toBe(true);
    expect(draft.schemaVersion).toBe(10);
    expect(() => built(value, id(99))).toThrow();
  });

  it("supports a full-length source title without prefix overflow and keeps separate source language notes within existing bounds", () => {
    const current = block(),
      title = current.scene!.nodes[0]!;
    Object.assign(title, { text: "x".repeat(160) });
    const value = proposal(source(current)),
      created = built(value);
    expect(created.sourceDisclosure!.sourceName).toHaveLength(160);
    expect(PresentationQuestionSuggestionInsertedBlockSchema.safeParse(created).success).toBe(true);
  });

  it("hashes the entire generated block canonically for exact lost-ack recovery without retaining its text", () => {
    const created = built(),
      expected = presentationQuestionSuggestionInsertedBlockHash(created);
    expect(expected).toBe(
      hash(JSON.stringify(PresentationQuestionSuggestionInsertedBlockSchema.parse(created))),
    );
    expect(
      presentationQuestionSuggestionInsertedBlockHash(
        Object.fromEntries(Object.entries(created).reverse()),
      ),
    ).toBe(expected);
    for (const modified of [
      { ...created, id: id(90) },
      { ...created, question: { ...created.question, prompt: "Changed after acceptance" } },
      { ...created, citations: [{ locator: "body 1 paragraph 1", excerpt: "Different wording" }] },
      { ...created, sourceDisclosure: { ...created.sourceDisclosure!, provider: "different" } },
    ])
      expect(presentationQuestionSuggestionInsertedBlockHash(modified)).not.toBe(expected);
    expect(() =>
      presentationQuestionSuggestionInsertedBlockHash({
        ...created,
        question: { ...created.question, basePoints: 1000 },
      }),
    ).toThrow();
    expect(() =>
      presentationQuestionSuggestionInsertedBlockHash({
        ...created,
        provenance: { sourceQuizVersionId: id(70), sourceQuestionId: id(71) },
      }),
    ).toThrow();
  });
});
