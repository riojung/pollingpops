import { createHash, randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  PresentationContentSchema,
  PresentationQuestionSuggestionsProposalSchema,
  PRESENTATION_QUESTION_SUGGESTIONS_REVIEW_WARNING,
  buildPresentationQuestionSuggestionBlock,
  presentationQuestionSuggestionSource,
  presentationQuestionSuggestionsSourceDigest,
  type ContentSlideDraft,
} from "@openround/contracts";
import { MemoryRepository } from "@openround/db";
import { presentationSharingFixture } from "../../../packages/db/test/support/presentation-sharing-conformance.js";
import { presentationParticipantBlock } from "../src/presentation-session-projections.js";
import { projectPresentationReview } from "../src/presentation-sharing-projection.js";
import {
  PresentationStaticExportService,
  type PresentationStaticRenderer,
} from "../src/presentation-static-export-service.js";

const contentTypes = { pdf: "application/pdf", png: "image/png", html: "text/html" } as const;
const prompts = {
  discussion: "What would you want to learn from customer interviews?",
  reflection: "How might testing a prototype change your next step?",
} as const;
type SuggestionKind = keyof typeof prompts;
const provider = "PRIVATE_APPROVED_QUESTION_PROVIDER";
const model = "PRIVATE_BOUNDED_QUESTION_MODEL";
const generatedAt = "2026-11-07T12:34:56.000Z";

async function fixture(kind: SuggestionKind, schemaVersion: 10 | 16) {
  const repository = new MemoryRepository();
  const f = await presentationSharingFixture(repository, "ai-question-suggestions");
  const sourceBlock: ContentSlideDraft = {
    id: randomUUID(),
    kind: "content",
    layout: "title_body",
    textElements: [],
    mediaId: null,
    mediaAlt: null,
    speakerNotes: "PRIVATE_SOURCE_NOTES",
    scene: {
      schemaVersion: 7,
      aspectRatio: "16:9",
      nodes: [
        {
          id: "PRIVATE_SOURCE_TITLE_NODE",
          type: "text",
          role: "title",
          text: "PRIVATE_SOURCE_TITLE",
          lang: "en",
          frame: { x: 5, y: 5, width: 90, height: 20 },
        },
        {
          id: "PRIVATE_SOURCE_BODY_NODE",
          type: "text",
          role: "body",
          text: "PRIVATE_DISCUSSION_EVIDENCE: Compare customer interviews.\nPRIVATE_REFLECTION_EVIDENCE: Test a prototype.",
          lang: "en",
          frame: { x: 5, y: 30, width: 90, height: 60 },
        },
      ],
      readingOrder: ["PRIVATE_SOURCE_TITLE_NODE", "PRIVATE_SOURCE_BODY_NODE"],
    },
  };
  const projectedSource = presentationQuestionSuggestionSource(sourceBlock);
  if (!projectedSource.supported) throw new Error(projectedSource.reason);
  const source = projectedSource.source;
  const proposal = PresentationQuestionSuggestionsProposalSchema.parse({
    schemaVersion: 1,
    blockId: source.blockId,
    source,
    sourceDigest: presentationQuestionSuggestionsSourceDigest(source),
    outputLanguage: "en",
    suggestions: [
      {
        id: randomUUID(),
        kind: "discussion",
        type: "open_text",
        prompt: prompts.discussion,
        citations: [
          {
            locator: "body 1 paragraph 1",
            excerpt: "PRIVATE_DISCUSSION_EVIDENCE: Compare customer interviews.",
          },
        ],
      },
      {
        id: randomUUID(),
        kind: "reflection",
        type: "open_text",
        prompt: prompts.reflection,
        citations: [
          {
            locator: "body 1 paragraph 2",
            excerpt: "PRIVATE_REFLECTION_EVIDENCE: Test a prototype.",
          },
        ],
      },
    ],
    provider,
    model,
    generatedAt,
    reviewWarning: PRESENTATION_QUESTION_SUGGESTIONS_REVIEW_WARNING,
  });
  const suggestion = proposal.suggestions.find((suggestion) => suggestion.kind === kind)!;
  const creatorBlock = buildPresentationQuestionSuggestionBlock({
    proposal,
    jobId: randomUUID(),
    suggestionId: suggestion.id,
    mutationId: randomUUID(),
  });
  // The independent inserted question retains private evidence without embedding its original slide.
  const content = PresentationContentSchema.parse({
    schemaVersion,
    title: "Reviewed audience discussion",
    blocks: [creatorBlock],
  });
  const draftHash = createHash("sha256").update(JSON.stringify(content)).digest("hex");
  const saved = (await f.presentations.updatePresentationDraft({
    workspaceId: f.actor.workspaceId,
    presentationId: f.presentation.id,
    draft: content,
    expectedRevision: f.presentation.draftRevision,
    mutationId: randomUUID(),
    editorId: f.actor.userId,
    draftHash,
  }))!;
  const version = await f.presentations.publishPresentation(
    {
      id: randomUUID(),
      workspaceId: f.actor.workspaceId,
      presentationId: f.presentation.id,
      version: 2,
      content,
      contentSchemaVersion: schemaVersion,
      contentHash: draftHash,
      sourceDraftRevision: saved.draftRevision,
      publishedAt: new Date(),
    },
    saved.draftRevision,
  );
  return { ...f, repository, proposal, source, suggestion, creatorBlock, content, version };
}

function expectPrivateContextOmitted(value: unknown, f: Awaited<ReturnType<typeof fixture>>) {
  const serialized = JSON.stringify(value);
  expect(serialized).toContain(f.suggestion.prompt);
  expect(serialized).toContain('"type":"open_text"');
  expect(serialized).not.toMatch(
    /PRIVATE_|sourceCitations|sourceDisclosure|citations|sourceDigest|sourceRevision|sourceSnapshot|readingOrder|generatedAt|reviewWarning|provenance|explanation|feedback|isCorrect/,
  );
  for (const privateValue of [
    f.source.blockId,
    f.source.title.nodeId,
    f.source.body[0]!.nodeId,
    f.suggestion.id,
    f.proposal.sourceDigest,
    f.proposal.provider,
    f.proposal.model,
    f.proposal.generatedAt,
    f.proposal.reviewWarning,
  ])
    expect(serialized).not.toContain(privateValue);
}

describe("reviewed AI question suggestion projection privacy", () => {
  for (const kind of ["discussion", "reflection"] as const) {
    it.each([10, 16] as const)(
      `keeps the ${kind} opinion prompt while omitting private generation context in document%s participant, review and static export inputs`,
      async (schemaVersion) => {
        const f = await fixture(kind, schemaVersion);
        const before = await f.presentations.getPresentation(
          f.actor.workspaceId,
          f.presentation.id,
        );
        const creatorBefore = JSON.stringify(f.creatorBlock);
        const participant = presentationParticipantBlock(f.content.blocks[0]!);
        const review = projectPresentationReview(f.version, {
          expiresAt: new Date(Date.now() + 60_000),
        });
        expectPrivateContextOmitted(participant, f);
        expectPrivateContextOmitted(review, f);
        expect(participant).toMatchObject({
          kind: "question",
          question: {
            type: "open_text",
            prompt: f.suggestion.prompt,
            confidence: "off",
            timeLimitSeconds: 20,
          },
        });
        if (participant?.kind !== "question") throw new Error("Expected the public question");
        expect(participant.question).not.toHaveProperty("choices");
        expect(review.blocks[0]).toMatchObject({
          kind: "question",
          question: { type: "open_text", prompt: f.suggestion.prompt },
        });

        const render = vi.fn<PresentationStaticRenderer>(async (input) => ({
          bytes: Buffer.from("SYNTHETIC_STATIC_RESULT"),
          contentType: contentTypes[input.format],
          extension: input.format,
        }));
        const readImage = vi.fn();
        const exports = new PresentationStaticExportService({
          repository: f.repository,
          presentations: f.presentations,
          storage: { readImage },
          featureEnabled: async () => true,
          render,
        });
        for (const format of ["pdf", "png", "html"] as const) {
          await exports.export(
            f.actor,
            f.presentation.id,
            {
              versionId: f.version.id,
              format,
              ...(format === "png" ? { blockId: f.creatorBlock.id } : {}),
            },
            { reauthorize: async () => f.actor },
          );
          const input = render.mock.calls.at(-1)![0];
          expect(input.format).toBe(format);
          expectPrivateContextOmitted(input, f);
          expect(input.review.blocks).toEqual(review.blocks);
          expect(input.review.versionId).toBe(f.version.id);
          expect(input.images.size).toBe(0);
        }
        expect(readImage).not.toHaveBeenCalled();
        expect(
          await f.presentations.getPresentation(f.actor.workspaceId, f.presentation.id),
        ).toEqual(before);
        const retained = await f.presentations.getPresentationVersion(
          f.actor.workspaceId,
          f.version.id,
        );
        expect(retained!.content.blocks[0]).toEqual(f.creatorBlock);
        expect(retained!.content.blocks[0]).toMatchObject({
          question: { type: "open_text", purpose: "opinion", confidence: "off", basePoints: 0 },
          citations: f.suggestion.citations,
          sourceDisclosure: { provider, model, sourceDigest: f.proposal.sourceDigest },
        });
        expect(JSON.stringify(f.creatorBlock)).toBe(creatorBefore);
        expect(f.proposal.generatedAt).toBe(generatedAt);
      },
    );
  }
});
