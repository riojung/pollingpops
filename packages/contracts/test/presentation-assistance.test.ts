import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  CreatePresentationAssistanceJobSchema,
  InsertPresentationAssistanceProposalsSchema,
  PresentationAssistanceProposalSchema,
  PresentationAssistanceJobSchema,
  PRESENTATION_ASSISTANCE_REVIEW_WARNING,
  presentationAssistanceRequestHash,
  presentationAssistanceSourceDigest,
  presentationAssistanceProposalHash,
} from "../src/index.js";
const outline =
  "Creators write a short outline before drafting slides.\nReview every generated slide and its source before insertion.\nKeep an existing deck unchanged until the author confirms.";
const request = () => ({
  schemaVersion: 1 as const,
  requestId: randomUUID(),
  presentationId: randomUUID(),
  sourceName: "Creator outline",
  outline,
  slideCount: 3,
});
const proposal = () => ({
  schemaVersion: 1 as const,
  sourceName: "Creator outline",
  sourceDigest: presentationAssistanceSourceDigest(outline),
  slides: outline.split("\n").map((line, index) => ({
    id: randomUUID(),
    title: `Slide ${index + 1}`,
    body: line,
    citations: [{ locator: `outline line ${index + 1}`, excerpt: line }],
  })),
  generatedAt: "2026-11-05T00:00:00.000Z",
  provider: "test",
  model: "text",
  reviewWarning: PRESENTATION_ASSISTANCE_REVIEW_WARNING,
});
function reverse(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reverse);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .reverse()
        .map(([key, item]) => [key, reverse(item)]),
    );
  return value;
}
describe("presentation outline assistance contracts", () => {
  it("bounds strict native content requests and hashes the complete normalized intent", () => {
    const input = request(),
      hash = presentationAssistanceRequestHash(input);
    expect(
      presentationAssistanceRequestHash({
        ...input,
        sourceName: ` ${input.sourceName} `,
        outline: `\n${outline}\n`,
      }),
    ).toBe(hash);
    expect(
      CreatePresentationAssistanceJobSchema.parse({
        ...input,
        requestId: input.requestId.toUpperCase(),
        presentationId: input.presentationId.toUpperCase(),
      }),
    ).toEqual(input);
    expect(
      presentationAssistanceRequestHash({
        ...input,
        requestId: input.requestId.toUpperCase(),
        presentationId: input.presentationId.toUpperCase(),
      }),
    ).toBe(hash);
    for (const patch of [
      { slideCount: 4 },
      { sourceName: "Changed" },
      { outline: `${outline}\nAnother source.` },
      { presentationId: randomUUID() },
      { requestId: randomUUID() },
    ])
      expect(presentationAssistanceRequestHash({ ...input, ...patch })).not.toBe(hash);
    for (const patch of [
      { slideCount: 2 },
      { slideCount: 9 },
      { outline: "short" },
      { outline: "x".repeat(12_001) },
      { sourceName: "x".repeat(161) },
      { schemaVersion: 2 },
      { mode: "quiz" },
    ])
      expect(CreatePresentationAssistanceJobSchema.safeParse({ ...input, ...patch }).success).toBe(
        false,
      );
  });
  it("requires exact cited text proposal structure and binds every normalized output field", () => {
    const output = proposal(),
      hash = presentationAssistanceProposalHash(output);
    expect(presentationAssistanceProposalHash(reverse(output))).toBe(hash);
    expect(
      presentationAssistanceProposalHash({
        ...output,
        slides: output.slides.map((slide) => ({ ...slide, id: slide.id.toUpperCase() })),
      }),
    ).toBe(hash);
    for (const patch of [
      { model: "other" },
      { provider: "other" },
      { generatedAt: "2026-11-05T00:00:01.000Z" },
      {
        slides: output.slides.map((slide, index) =>
          index ? slide : { ...slide, body: "Changed" },
        ),
      },
    ])
      expect(presentationAssistanceProposalHash({ ...output, ...patch })).not.toBe(hash);
    for (const patch of [
      { reviewWarning: "Verified facts" },
      { checkpointSet: {} },
      { slides: [output.slides[0], output.slides[0], output.slides[2]] },
      { slides: output.slides.map((slide) => ({ ...slide, citations: [] })) },
      { slides: output.slides.map((slide) => ({ ...slide, body: "x".repeat(2001) })) },
    ])
      expect(PresentationAssistanceProposalSchema.safeParse({ ...output, ...patch }).success).toBe(
        false,
      );
  });
  it("verifies complete ready receipts and explicit reviewed insertion fences", () => {
    const input = request(),
      output = proposal(),
      now = "2026-11-05T00:00:00.000Z";
    const job = {
      schemaVersion: 1,
      id: input.requestId,
      requestId: input.requestId,
      presentationId: input.presentationId,
      sourceName: input.sourceName,
      slideCount: 3,
      status: "ready",
      attempts: 1,
      proposal: output,
      proposalHash: presentationAssistanceProposalHash(output),
      sourceDigest: output.sourceDigest,
      error: null,
      createdAt: now,
      updatedAt: now,
      expiresAt: "2026-11-06T00:00:00.000Z",
    };
    expect(PresentationAssistanceJobSchema.safeParse(job).success).toBe(true);
    expect(
      PresentationAssistanceJobSchema.safeParse({ ...job, proposalHash: "a".repeat(64) }).success,
    ).toBe(false);
    expect(
      PresentationAssistanceJobSchema.safeParse({ ...job, requestId: randomUUID() }).success,
    ).toBe(false);
    expect(PresentationAssistanceJobSchema.safeParse({ ...job, status: "failed" }).success).toBe(
      false,
    );
    const insert = {
      schemaVersion: 1,
      jobId: input.requestId,
      proposalHash: job.proposalHash,
      selectedSlideIds: [output.slides[0]!.id],
      reviewed: true,
      expectedRevision: 0,
      mutationId: randomUUID(),
      afterBlockId: null,
    };
    expect(InsertPresentationAssistanceProposalsSchema.safeParse(insert).success).toBe(true);
    expect(
      InsertPresentationAssistanceProposalsSchema.parse({
        ...insert,
        jobId: insert.jobId.toUpperCase(),
        mutationId: insert.mutationId.toUpperCase(),
        selectedSlideIds: insert.selectedSlideIds.map((id) => id.toUpperCase()),
      }),
    ).toEqual(insert);
    for (const patch of [
      { reviewed: false },
      { selectedSlideIds: [] },
      { selectedSlideIds: [output.slides[0]!.id, output.slides[0]!.id] },
      { expectedRevision: -1 },
      { newDeck: true },
    ])
      expect(
        InsertPresentationAssistanceProposalsSchema.safeParse({ ...insert, ...patch }).success,
      ).toBe(false);
  });
});
