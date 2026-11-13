import { createHash, randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  ApplyPresentationTextAssistanceSchema,
  CreatePresentationTextAssistanceJobSchema,
  PresentationTextAssistanceJobSchema,
  PresentationTextAssistanceProposalSchema,
  PresentationTextAssistanceProvenanceSchema,
  PRESENTATION_TEXT_ASSISTANCE_REVIEW_WARNING,
  PresentationDraftSchema,
  PresentationContentSchema,
  createPresentationDesignScene,
  presentationTextAssistanceRequestHash,
  presentationTextAssistanceSourceDigest,
  presentationTextAssistanceProposalHash,
} from "../src/index.js";

const originalText =
  "Review the current launch plan together before sharing the approved presentation.";
const revisedText = "Review the launch plan before sharing the approved presentation.";
const proposal = () => ({
  schemaVersion: 1 as const,
  operation: "shorten" as const,
  blockId: randomUUID(),
  nodeId: "MixedCase:Object:body",
  role: "body" as const,
  originalText,
  text: revisedText,
  sourceDigest: presentationTextAssistanceSourceDigest(originalText),
  outputDigest: presentationTextAssistanceSourceDigest(revisedText),
  provider: "approved-fixture",
  model: "bounded-text",
  generatedAt: "2026-11-06T00:00:00.000Z",
  reviewWarning: PRESENTATION_TEXT_ASSISTANCE_REVIEW_WARNING,
});
function reverse(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reverse);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .reverse()
        .map(([key, entry]) => [key, reverse(entry)]),
    );
  return value;
}
describe("reviewed Presentation text assistance contracts", () => {
  it("hashes exact selected text without trimming or including other node content", () => {
    const source = `  ${originalText}\n`;
    expect(presentationTextAssistanceSourceDigest(source)).toBe(
      createHash("sha256").update(source).digest("hex"),
    );
    expect(presentationTextAssistanceSourceDigest(source)).not.toBe(
      presentationTextAssistanceSourceDigest(source.trim()),
    );
    expect(() => presentationTextAssistanceSourceDigest(" \n ")).toThrow();
    expect(() => presentationTextAssistanceSourceDigest("x".repeat(4001))).toThrow();
  });
  it("normalizes UUIDs while binding case-sensitive node identity and every creation field", () => {
    const input = {
      schemaVersion: 1,
      requestId: randomUUID(),
      presentationId: randomUUID(),
      blockId: randomUUID(),
      nodeId: "Body:CaseSensitive",
      operation: "rewrite",
      expectedRevision: 2,
      sourceDigest: presentationTextAssistanceSourceDigest(originalText),
    };
    const hash = presentationTextAssistanceRequestHash(input);
    expect(presentationTextAssistanceRequestHash(reverse(input))).toBe(hash);
    expect(
      presentationTextAssistanceRequestHash({
        ...input,
        requestId: input.requestId.toUpperCase(),
        presentationId: input.presentationId.toUpperCase(),
        blockId: input.blockId.toUpperCase(),
      }),
    ).toBe(hash);
    for (const patch of [
      { requestId: randomUUID() },
      { presentationId: randomUUID() },
      { blockId: randomUUID() },
      { nodeId: input.nodeId.toLowerCase() },
      { operation: "shorten" },
      { expectedRevision: 3 },
      { sourceDigest: "a".repeat(64) },
    ])
      expect(presentationTextAssistanceRequestHash({ ...input, ...patch })).not.toBe(hash);
    for (const patch of [
      { originalText },
      { nodeId: "" },
      { nodeId: "x".repeat(201) },
      { expectedRevision: -1 },
      { operation: "translate" },
    ])
      expect(
        CreatePresentationTextAssistanceJobSchema.safeParse({ ...input, ...patch }).success,
      ).toBe(false);
  });
  it("requires changed, bounded, honest proposals and complete canonical hashes", () => {
    const value = proposal();
    expect(PresentationTextAssistanceProposalSchema.parse(value)).toEqual(value);
    expect(presentationTextAssistanceProposalHash(reverse(value))).toBe(
      presentationTextAssistanceProposalHash(value),
    );
    for (const patch of [
      { text: originalText, outputDigest: value.sourceDigest },
      {
        text: `${originalText}!`,
        outputDigest: presentationTextAssistanceSourceDigest(`${originalText}!`),
      },
      { text: " \n", outputDigest: "a".repeat(64) },
      { sourceDigest: "a".repeat(64) },
      { outputDigest: "a".repeat(64) },
      { reviewWarning: "Verified facts" },
      { citations: [{ excerpt: "invented" }] },
      { provider: "x".repeat(81) },
      { model: "x".repeat(121) },
      {
        role: "title",
        originalText: "x".repeat(161),
        sourceDigest: presentationTextAssistanceSourceDigest("x".repeat(161)),
      },
    ])
      expect(() =>
        expect(
          PresentationTextAssistanceProposalSchema.safeParse({ ...value, ...patch }).success,
        ).toBe(false),
      ).not.toThrow();
    for (const patch of [
      { model: "other" },
      { provider: "other" },
      { generatedAt: "2026-11-06T00:00:01.000Z" },
    ])
      expect(presentationTextAssistanceProposalHash({ ...value, ...patch })).not.toBe(
        presentationTextAssistanceProposalHash(value),
      );
  });
  it("binds ready receipts to source/target and requires explicit reviewed mutation intent", () => {
    const value = proposal(),
      id = randomUUID();
    const job = {
      schemaVersion: 1,
      id,
      requestId: id,
      presentationId: randomUUID(),
      blockId: value.blockId,
      nodeId: value.nodeId,
      operation: value.operation,
      sourceRevision: 2,
      role: value.role,
      sourceDigest: value.sourceDigest,
      status: "ready",
      attempts: 1,
      proposal: value,
      proposalHash: presentationTextAssistanceProposalHash(value),
      error: null,
      createdAt: "2026-11-06T00:00:00.000Z",
      updatedAt: "2026-11-06T00:00:01.000Z",
      expiresAt: "2026-11-07T00:00:00.000Z",
    };
    expect(PresentationTextAssistanceJobSchema.safeParse(job).success).toBe(true);
    for (const patch of [
      { nodeId: value.nodeId.toLowerCase() },
      { role: "title" },
      { operation: "rewrite" },
      { proposalHash: "a".repeat(64) },
      { requestId: randomUUID() },
      { status: "failed" },
      { proposal: { ...value, text: " " } },
    ])
      expect(() =>
        expect(PresentationTextAssistanceJobSchema.safeParse({ ...job, ...patch }).success).toBe(
          false,
        ),
      ).not.toThrow();
    const apply = {
      schemaVersion: 1,
      jobId: id,
      proposalHash: job.proposalHash,
      blockId: value.blockId,
      nodeId: value.nodeId,
      sourceDigest: value.sourceDigest,
      reviewed: true,
      expectedRevision: 2,
      mutationId: randomUUID(),
    };
    expect(ApplyPresentationTextAssistanceSchema.safeParse(apply).success).toBe(true);
    for (const patch of [
      { reviewed: false },
      { text: revisedText },
      { expectedRevision: -1 },
      { nodeId: "" },
    ])
      expect(ApplyPresentationTextAssistanceSchema.safeParse({ ...apply, ...patch }).success).toBe(
        false,
      );
  });
  it("retains latest-edit metadata only in document15 without changing old bytes or scene6", () => {
    const value = proposal();
    const { blockId } = value;
    const metadata = PresentationTextAssistanceProvenanceSchema.parse(
      Object.fromEntries(
        Object.entries(value).filter(([key]) => !["originalText", "text", "blockId"].includes(key)),
      ),
    );
    const source = {
      title: "Reviewed deck",
      schemaVersion: 14,
      blocks: [
        {
          id: blockId,
          kind: "content",
          layout: "title_body",
          textElements: [],
          mediaId: null,
          mediaAlt: null,
          speakerNotes: "PRIVATE notes",
          citations: [{ locator: "Original page", excerpt: "Original evidence" }],
          sourceDisclosure: {
            sourceName: "Original source",
            sourceDigest: "c".repeat(64),
            provider: "original",
            model: "original",
            conversionNotes: ["Keep this original note"],
          },
          scene: {
            ...createPresentationDesignScene("Title", value.nodeId),
            nodes: [
              {
                ...createPresentationDesignScene("Title", value.nodeId).nodes[0]!,
                text: "Approved title",
              },
              {
                ...createPresentationDesignScene("Title", value.nodeId).nodes[1]!,
                text: revisedText,
              },
            ],
          },
        },
      ],
      spatial: { schemaVersion: 1, frames: [{ blockId, x: 0, y: 0, width: 1280, height: 720 }] },
    };
    const old = PresentationDraftSchema.parse(source),
      bytes = JSON.stringify(old);
    for (const schema of [PresentationDraftSchema, PresentationContentSchema]) {
      expect(
        schema.safeParse({ ...source, blocks: [{ ...source.blocks[0], textAssistance: metadata }] })
          .success,
      ).toBe(false);
      const next = schema.parse({
        ...source,
        schemaVersion: 15,
        blocks: [{ ...source.blocks[0], textAssistance: metadata }],
      });
      expect(next.blocks[0]).toEqual({ ...old.blocks[0], textAssistance: metadata });
      expect(next.spatial).toEqual(old.spatial);
      expect(schema.safeParse({ ...next, schemaVersion: 19 }).success).toBe(false);
    }
    expect(JSON.stringify(PresentationDraftSchema.parse(old))).toBe(bytes);
  });
});
