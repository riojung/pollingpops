import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  ApplyPresentationTextAssistanceSchema,
  CreatePresentationTextAssistanceJobSchema,
  PresentationTextAssistanceJobSchema,
  PresentationTextAssistanceProposalSchema,
  PresentationTextAssistanceProvenanceSchema,
  PresentationTextLanguageSchema,
  PRESENTATION_TEXT_LANGUAGES,
  presentationTextLanguageLabel,
  PRESENTATION_TEXT_ASSISTANCE_REVIEW_WARNING,
  PresentationContentSchema,
  PresentationDraftSchema,
  PresentationSceneDraftSchema,
  PresentationSceneSchema,
  PresentationDeliveredSceneSchema,
  presentationTextAssistanceRequestHash,
  presentationTextAssistanceProposalHash,
  presentationTextAssistanceSourceDigest,
} from "../src/index.js";
const id = (n: number) => `00000000-0000-4000-8000-${n.toString().padStart(12, "0")}`;
const original = "OpenAI",
  edited = "Reviewed wording";
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const legacyRequest = {
  schemaVersion: 1,
  requestId: id(1),
  presentationId: id(2),
  blockId: id(3),
  nodeId: "Native:Body",
  operation: "rewrite",
  expectedRevision: 4,
  sourceDigest: digest(original),
};
const legacyProvenance = {
  schemaVersion: 1,
  nodeId: "Native:Body",
  role: "body",
  operation: "rewrite",
  sourceDigest: digest(original),
  outputDigest: digest(edited),
  provider: "approved",
  model: "bounded-text",
  generatedAt: "2026-11-01T00:00:00.000Z",
  reviewWarning: PRESENTATION_TEXT_ASSISTANCE_REVIEW_WARNING,
};
const legacyProposal = {
  ...legacyProvenance,
  blockId: id(3),
  originalText: original,
  text: edited,
};
const legacyApply = {
  schemaVersion: 1,
  jobId: id(1),
  proposalHash: digest(JSON.stringify(legacyProposal)),
  blockId: id(3),
  nodeId: "Native:Body",
  sourceDigest: digest(original),
  reviewed: true,
  expectedRevision: 4,
  mutationId: id(4),
};
const translation = () => ({
  ...legacyProposal,
  operation: "translate",
  text: original,
  outputDigest: digest(original),
  targetLanguage: "fr",
  sourceLanguage: null,
});
function job(proposal = translation()) {
  return {
    schemaVersion: 1,
    id: id(1),
    requestId: id(1),
    presentationId: id(2),
    blockId: proposal.blockId,
    nodeId: proposal.nodeId,
    operation: proposal.operation,
    sourceRevision: 4,
    role: proposal.role,
    sourceDigest: proposal.sourceDigest,
    status: "ready",
    attempts: 1,
    proposal,
    proposalHash: presentationTextAssistanceProposalHash(proposal),
    error: null,
    createdAt: "2026-11-01T00:00:00.000Z",
    updatedAt: "2026-11-01T00:00:01.000Z",
    expiresAt: "2026-11-02T00:00:00.000Z",
    targetLanguage: proposal.targetLanguage,
    sourceLanguage: proposal.sourceLanguage,
  };
}
const scene = (version = 7) => ({
  schemaVersion: version,
  aspectRatio: "16:9",
  nodes: [
    {
      id: "Title",
      type: "text",
      role: "title",
      text: "Evidence",
      frame: { x: 7, y: 5, width: 86, height: 18 },
    },
    {
      id: "Native:Body",
      type: "text",
      role: "body",
      text: original,
      lang: "fr",
      frame: { x: 7, y: 30, width: 86, height: 60 },
    },
  ],
  readingOrder: ["Title", "Native:Body"],
});
function deck(version = 16) {
  return {
    schemaVersion: version,
    title: "Multilingual deck",
    blocks: [
      {
        id: id(3),
        kind: "content",
        layout: "title_body",
        textElements: [],
        mediaId: null,
        mediaAlt: null,
        speakerNotes: "Private notes",
        citations: [{ locator: "Page 1", excerpt: "Original source" }],
        sourceDisclosure: {
          sourceName: "Original",
          sourceDigest: "a".repeat(64),
          provider: "source",
          model: "original",
        },
        scene: scene(),
      },
    ],
  };
}

describe("reviewed selected-text translation contracts", () => {
  it("keeps exact legacy request, proposal, provenance and Apply wire bytes/hashes without new defaults", () => {
    // Explicit pre-translation key order is independent of the current parser definitions.
    for (const [schema, value] of [
      [CreatePresentationTextAssistanceJobSchema, legacyRequest],
      [PresentationTextAssistanceProposalSchema, legacyProposal],
      [PresentationTextAssistanceProvenanceSchema, legacyProvenance],
      [ApplyPresentationTextAssistanceSchema, legacyApply],
    ] as const) {
      expect(JSON.stringify(schema.parse(value))).toBe(JSON.stringify(value));
      expect(schema.parse(value)).not.toHaveProperty("targetLanguage");
      expect(schema.parse(value)).not.toHaveProperty("sourceLanguage");
    }
    expect(presentationTextAssistanceRequestHash(legacyRequest)).toBe(
      digest(JSON.stringify(legacyRequest)),
    );
    expect(presentationTextAssistanceProposalHash(legacyProposal)).toBe(
      digest(JSON.stringify(legacyProposal)),
    );
    expect(legacyApply.proposalHash).toBe(presentationTextAssistanceProposalHash(legacyProposal));
    const legacyJob = {
      schemaVersion: 1,
      id: id(1),
      requestId: id(1),
      presentationId: id(2),
      blockId: id(3),
      nodeId: "Native:Body",
      operation: "rewrite",
      sourceRevision: 4,
      role: "body",
      sourceDigest: digest(original),
      status: "ready",
      attempts: 1,
      proposal: legacyProposal,
      proposalHash: digest(JSON.stringify(legacyProposal)),
      error: null,
      createdAt: "2026-11-01T00:00:00.000Z",
      updatedAt: "2026-11-01T00:00:01.000Z",
      expiresAt: "2026-11-02T00:00:00.000Z",
    };
    expect(JSON.stringify(PresentationTextAssistanceJobSchema.parse(legacyJob))).toBe(
      JSON.stringify(legacyJob),
    );
  });
  it("accepts only the twelve exact canonical language tags without case/alias/direction guesses", () => {
    expect(PresentationTextLanguageSchema.options).toEqual([
      "en",
      "fr",
      "es",
      "de",
      "it",
      "pt",
      "nl",
      "pl",
      "ja",
      "ko",
      "zh-Hans",
      "zh-Hant",
    ]);
    expect(PRESENTATION_TEXT_LANGUAGES.map(({ code }) => code)).toEqual(
      PresentationTextLanguageSchema.options,
    );
    for (const { code, label } of PRESENTATION_TEXT_LANGUAGES) {
      expect(PresentationTextLanguageSchema.parse(code)).toBe(code);
      expect(presentationTextLanguageLabel(code)).toBe(label);
      expect(label.trim()).not.toBe("");
    }
    for (const value of [
      "EN",
      " fr",
      "fr ",
      "en-CA",
      "zh",
      "zh-hans",
      "zh-HANS",
      "pt-BR",
      "ar",
      "he",
      "",
      null,
    ])
      expect(PresentationTextLanguageSchema.safeParse(value).success).toBe(false);
  });
  it("requires an explicit target/source pair only for translation across all intent and output shapes", () => {
    const request = {
      ...legacyRequest,
      operation: "translate",
      targetLanguage: "fr",
      sourceLanguage: null,
    };
    const value = translation(),
      state = job(value);
    const metadata = PresentationTextAssistanceProvenanceSchema.parse(
      Object.fromEntries(
        Object.entries(value).filter(([key]) => !["blockId", "originalText", "text"].includes(key)),
      ),
    );
    for (const [schema, intent] of [
      [CreatePresentationTextAssistanceJobSchema, request],
      [PresentationTextAssistanceProposalSchema, value],
      [PresentationTextAssistanceProvenanceSchema, metadata],
      [PresentationTextAssistanceJobSchema, state],
    ] as const) {
      expect(schema.safeParse(intent).success).toBe(true);
      for (const fields of [
        { targetLanguage: undefined },
        { sourceLanguage: undefined },
        { targetLanguage: "ar" },
        { sourceLanguage: "en-CA" },
        { targetLanguage: "FR" },
        { sourceLanguage: "fr" },
      ])
        expect(schema.safeParse({ ...intent, ...fields }).success).toBe(false);
      for (const operation of ["rewrite", "shorten"])
        expect(schema.safeParse({ ...intent, operation }).success).toBe(false);
    }
    for (const fields of [
      { targetLanguage: "fr" },
      { sourceLanguage: null },
      { targetLanguage: undefined },
      { sourceLanguage: undefined },
    ])
      expect(
        CreatePresentationTextAssistanceJobSchema.safeParse({ ...legacyRequest, ...fields })
          .success,
      ).toBe(false);
  });
  it("binds both language instructions to complete canonical request/proposal hashes and appends them last", () => {
    const request = {
      ...legacyRequest,
      operation: "translate",
      targetLanguage: "fr",
      sourceLanguage: null,
    };
    const value = translation();
    expect(Object.keys(CreatePresentationTextAssistanceJobSchema.parse(request)).slice(-2)).toEqual(
      ["targetLanguage", "sourceLanguage"],
    );
    expect(Object.keys(PresentationTextAssistanceProposalSchema.parse(value)).slice(-2)).toEqual([
      "targetLanguage",
      "sourceLanguage",
    ]);
    for (const patch of [{ targetLanguage: "es" }, { sourceLanguage: "en" }]) {
      expect(presentationTextAssistanceRequestHash({ ...request, ...patch })).not.toBe(
        presentationTextAssistanceRequestHash(request),
      );
      expect(presentationTextAssistanceProposalHash({ ...value, ...patch })).not.toBe(
        presentationTextAssistanceProposalHash(value),
      );
    }
    const reversed = Object.fromEntries(Object.entries(value).reverse());
    expect(presentationTextAssistanceProposalHash(reversed)).toBe(
      presentationTextAssistanceProposalHash(value),
    );
  });
  it("accepts unchanged translated proper names when the declared language changes, retaining old no-op/shorten rules", () => {
    expect(PresentationTextAssistanceProposalSchema.parse(translation()).text).toBe(original);
    expect(
      PresentationTextAssistanceProposalSchema.safeParse({ ...translation(), sourceLanguage: "fr" })
        .success,
    ).toBe(false);
    expect(
      PresentationTextAssistanceProposalSchema.safeParse({
        ...legacyProposal,
        text: original,
        outputDigest: digest(original),
      }).success,
    ).toBe(false);
    expect(
      PresentationTextAssistanceProposalSchema.safeParse({
        ...legacyProposal,
        operation: "shorten",
        text: original,
        outputDigest: digest(original),
      }).success,
    ).toBe(false);
    expect(presentationTextAssistanceSourceDigest(` ${original}\n`)).toBe(digest(` ${original}\n`));
  });
  it("retains title/body UTF-16 limits and exact source/output digests for translation", () => {
    const text = "🌱".repeat(80),
      valid = {
        ...translation(),
        role: "title",
        originalText: text,
        text,
        sourceDigest: digest(text),
        outputDigest: digest(text),
      };
    expect(PresentationTextAssistanceProposalSchema.safeParse(valid).success).toBe(true);
    for (const patch of [
      { text: text + "🌱", outputDigest: digest(text + "🌱") },
      { sourceDigest: "a".repeat(64) },
      { outputDigest: "a".repeat(64) },
    ])
      expect(
        PresentationTextAssistanceProposalSchema.safeParse({ ...valid, ...patch }).success,
      ).toBe(false);
    expect(
      PresentationTextAssistanceProposalSchema.safeParse({
        ...translation(),
        text: "x".repeat(4001),
        outputDigest: digest("x".repeat(4001)),
      }).success,
    ).toBe(false);
  });
  it("binds ready job languages to the reviewed proposal", () => {
    const state = job();
    expect(PresentationTextAssistanceJobSchema.safeParse(state).success).toBe(true);
    for (const patch of [
      { targetLanguage: "es" },
      { sourceLanguage: "en" },
      { proposalHash: "a".repeat(64) },
    ])
      expect(PresentationTextAssistanceJobSchema.safeParse({ ...state, ...patch }).success).toBe(
        false,
      );
  });
  it("adds a complete language pair to Apply without changing legacy operation-free Apply envelopes", () => {
    expect(JSON.stringify(ApplyPresentationTextAssistanceSchema.parse(legacyApply))).toBe(
      JSON.stringify(legacyApply),
    );
    const value = { ...legacyApply, targetLanguage: "fr", sourceLanguage: null };
    expect(ApplyPresentationTextAssistanceSchema.parse(value)).toEqual(value);
    expect(Object.keys(ApplyPresentationTextAssistanceSchema.parse(value)).slice(-2)).toEqual([
      "targetLanguage",
      "sourceLanguage",
    ]);
    for (const patch of [
      { targetLanguage: undefined },
      { sourceLanguage: undefined },
      { sourceLanguage: "fr" },
      { sourceLanguage: "EN" },
      { operation: "translate" },
    ])
      expect(ApplyPresentationTextAssistanceSchema.safeParse({ ...value, ...patch }).success).toBe(
        false,
      );
  });
  it("persists per-node canonical pronunciation only in scene7/document16, with no language defaults for old scenes", () => {
    for (const schema of [
      PresentationSceneDraftSchema,
      PresentationSceneSchema,
      PresentationDeliveredSceneSchema,
    ]) {
      expect(schema.parse(scene())).toEqual(scene());
      for (const version of [1, 2, 3, 4, 5, 6])
        expect(schema.safeParse(scene(version)).success).toBe(false);
      expect(schema.safeParse(scene(8)).success).toBe(false);
      for (const lang of ["fr-CA", "FR", "ar", null, ""])
        expect(
          schema.safeParse({
            ...scene(),
            nodes: scene().nodes.map((node) =>
              node.id === "Native:Body" ? { ...node, lang } : node,
            ),
          }).success,
        ).toBe(false);
    }
    const old = {
      ...scene(1),
      nodes: scene(1).nodes.map((node) => {
        const { lang, ...plain } = node;
        void lang;
        return plain;
      }),
    };
    const legacyCanonical = {
      ...old,
      nodes: old.nodes.map(({ id, frame, ...rest }) => ({ id, frame, ...rest })),
    };
    expect(JSON.stringify(PresentationSceneDraftSchema.parse(old))).toBe(
      JSON.stringify(legacyCanonical),
    );
    for (const schema of [PresentationDraftSchema, PresentationContentSchema]) {
      const valid = deck();
      expect(schema.safeParse(valid).success).toBe(true);
      for (const version of [13, 14, 15, 17])
        expect(schema.safeParse({ ...valid, schemaVersion: version }).success).toBe(false);
    }
  });
  it("keeps scene6 composition, groups and interactive publication rules under scene7/document16", () => {
    const source = deck(),
      destination = {
        ...source.blocks[0]!,
        id: id(10),
        scene: {
          schemaVersion: 1,
          aspectRatio: "16:9",
          nodes: [{ ...scene().nodes[0]!, text: "Destination" }],
          readingOrder: ["Title"],
        },
      };
    const additions = [
      {
        id: "Shape",
        type: "shape",
        shape: "rectangle",
        color: "blue",
        label: "Evidence",
        frame: { x: 5, y: 20, width: 20, height: 15 },
      },
      {
        id: "Table",
        type: "table",
        caption: "Recorded evidence",
        headers: ["Case", "Count"],
        rows: [["A", "2"]],
        frame: { x: 5, y: 40, width: 35, height: 20 },
      },
      {
        id: "Chart",
        type: "chart",
        chartType: "bar",
        title: "Counts",
        summary: "Two cases",
        categories: ["A"],
        series: [{ name: "Count", values: [2] }],
        frame: { x: 50, y: 40, width: 35, height: 20 },
      },
      {
        id: "Edge",
        type: "connector",
        from: { nodeId: "Shape", anchor: "bottom" },
        to: { nodeId: "Table", anchor: "top" },
        label: "supports",
        color: "blue",
      },
      {
        id: "Local",
        type: "reveal",
        scope: "local",
        label: "Read detail",
        body: "Public detail",
        frame: { x: 5, y: 65, width: 25, height: 15 },
      },
      {
        id: "Broadcast",
        type: "reveal",
        scope: "broadcast",
        label: "Reveal detail",
        body: "Private until broadcast",
        frame: { x: 35, y: 65, width: 25, height: 15 },
      },
      {
        id: "Navigation",
        type: "navigation",
        label: "Continue",
        targetBlockId: destination.id,
        frame: { x: 65, y: 65, width: 25, height: 15 },
      },
    ];
    const mixed = {
      ...scene(),
      groups: [{ id: "Data group", nodeIds: ["Table", "Chart"] }],
      nodes: [...scene().nodes, ...additions],
      readingOrder: [...scene().readingOrder, ...additions.map(({ id }) => id)],
    };
    expect(PresentationSceneSchema.safeParse(mixed).success).toBe(true);
    const content = { ...source, blocks: [{ ...source.blocks[0]!, scene: mixed }, destination] };
    expect(PresentationContentSchema.safeParse(content).success).toBe(true);
    const redacted = {
      ...mixed,
      nodes: mixed.nodes.map((node) =>
        node.type === "reveal" && "scope" in node && node.scope === "broadcast"
          ? { ...node, body: "" }
          : node,
      ),
    };
    expect(PresentationDeliveredSceneSchema.safeParse(redacted).success).toBe(true);
    const invalid = {
      ...content,
      blocks: [
        {
          ...source.blocks[0]!,
          scene: {
            ...mixed,
            nodes: mixed.nodes.map((node) =>
              node.type === "navigation" ? { ...node, targetBlockId: id(99) } : node,
            ),
          },
        },
        destination,
      ],
    };
    expect(PresentationContentSchema.safeParse(invalid).success).toBe(false);
  });
  it("keeps translated latest-edit provenance independent from later manual language corrections", () => {
    const value = translation(),
      metadata = PresentationTextAssistanceProvenanceSchema.parse(
        Object.fromEntries(
          Object.entries(value).filter(
            ([key]) => !["blockId", "originalText", "text"].includes(key),
          ),
        ),
      );
    const source = deck(),
      content = {
        ...source,
        blocks: source.blocks.map((block) => ({ ...block, textAssistance: metadata })),
      };
    expect(PresentationContentSchema.safeParse(content).success).toBe(true);
    const corrected = {
      ...content,
      blocks: content.blocks.map((block) => ({
        ...block,
        scene: {
          ...block.scene,
          nodes: block.scene.nodes.map((node) =>
            node.id === "Native:Body" ? { ...node, lang: "es" } : node,
          ),
        },
      })),
    };
    expect(PresentationContentSchema.safeParse(corrected).success).toBe(true);
    const scene6 = {
      ...content,
      blocks: content.blocks.map((block) => ({
        ...block,
        scene: {
          ...block.scene,
          schemaVersion: 6,
          nodes: block.scene.nodes.map((node) => {
            const { lang, ...plain } = node;
            void lang;
            return plain;
          }),
        },
      })),
    };
    expect(PresentationContentSchema.safeParse({ ...scene6, schemaVersion: 15 }).success).toBe(
      false,
    );
    expect(PresentationContentSchema.safeParse(scene6).success).toBe(true);
  });
});
