import { createHash, randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { PresentationContentSchema } from "@openround/contracts";
import { MemoryRepository } from "@openround/db";
import { presentationSharingFixture } from "../../../packages/db/test/support/presentation-sharing-conformance.js";
import { presentationParticipantBlock } from "../src/presentation-session-projections.js";
import { projectPresentationReview } from "../src/presentation-sharing-projection.js";
import {
  PresentationStaticExportService,
  type PresentationStaticRenderer,
} from "../src/presentation-static-export-service.js";

const publicPrompt = "Which authored next step should we discuss?";
const publicOptions = ["Run a small pilot", "Review the results together"];
const sourceSnapshot = "PRIVATE_SOURCE_SNAPSHOT: additional authored context outside this question";
const contentTypes = { pdf: "application/pdf", png: "image/png", html: "text/html" } as const;
type StarterQuestionType = "poll" | "open_text" | "rating";

async function fixture(type: StarterQuestionType, schemaVersion: 10 | 16) {
  const repository = new MemoryRepository();
  const f = await presentationSharingFixture(repository, "local-question-starters");
  const sourceBlockId = randomUUID();
  const sourceDigest = createHash("sha256").update(sourceSnapshot).digest("hex");
  const blockId = randomUUID();
  // These are existing question/citation contracts. No fabricated published-Round provenance,
  // new starter field, or raw source snapshot is needed in the recipient contracts.
  const content = PresentationContentSchema.parse({
    schemaVersion,
    title: "Reviewed local questions",
    blocks: [
      {
        id: blockId,
        kind: "question",
        question: {
          id: randomUUID(),
          type,
          prompt: publicPrompt,
          purpose: "opinion",
          confidence: "off",
          delivery: "main",
          linkedRecheckQuestionId: null,
          timeLimitSeconds: 20,
          basePoints: 0,
          explanation: "PRIVATE_CREATOR_EXPLANATION",
          mediaId: null,
          mediaAlt: null,
          sourceCitations: [
            {
              sourceName: "PRIVATE_LOCAL_SOURCE_NAME",
              sourceDigest,
              locator: `slide ${sourceBlockId}`,
              excerpt: sourceSnapshot,
            },
          ],
          ...(type === "poll"
            ? {
                maxSelections: 1,
                choices: publicOptions.map((label) => ({
                  id: randomUUID(),
                  label,
                  isCorrect: false,
                  feedback: "PRIVATE_CREATOR_CHOICE_FEEDBACK",
                })),
              }
            : type === "rating"
              ? { min: 1, max: 5, minLabel: "Not clear yet", maxLabel: "Very clear" }
              : {}),
        },
        citations: [
          { locator: "Body 1 · part 1", excerpt: sourceSnapshot },
          { locator: "PRIVATE_BLOCK_LOCATOR", excerpt: "PRIVATE_BLOCK_EVIDENCE" },
        ],
        sourceDisclosure: {
          sourceName: "Slide: PRIVATE_LOCAL_SOURCE_TITLE",
          sourceDigest,
          provider: "local",
          model: "question-starters-v1",
          conversionNotes: [
            "Local English question template. Only authored title/body text is used; other objects are not interpreted. No AI or independent verification.",
            `Source slide ${sourceBlockId}; source text and language identities are bound by the source digest.`,
          ],
        },
      },
    ],
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
  return { ...f, repository, content, version, blockId, sourceBlockId, sourceDigest };
}

function expectSafeQuestion(
  value: unknown,
  type: StarterQuestionType,
  sourceBlockId: string,
  sourceDigest: string,
) {
  const serialized = JSON.stringify(value);
  expect(serialized).toContain(publicPrompt);
  if (type === "poll") for (const label of publicOptions) expect(serialized).toContain(label);
  else expect(serialized).not.toContain('"choices"');
  if (type === "rating") {
    expect(serialized).toContain("Not clear yet");
    expect(serialized).toContain("Very clear");
  }
  expect(serialized).not.toMatch(
    /PRIVATE_|sourceCitations|sourceDisclosure|citations|sourceDigest|sourceSnapshot|provenance|explanation|feedback|isCorrect/,
  );
  expect(serialized).not.toContain(sourceBlockId);
  expect(serialized).not.toContain(sourceDigest);
  expect(serialized).not.toContain("question-starters-v1");
}

describe("reviewed local question starter projection privacy", () => {
  for (const type of ["poll", "open_text", "rating"] as const) {
    it.each([10, 16] as const)(
      `retains ${type} wording while hiding creator attribution in document%s participant, review and static export projections`,
      async (schemaVersion) => {
        const f = await fixture(type, schemaVersion);
        const before = await f.presentations.getPresentation(
          f.actor.workspaceId,
          f.presentation.id,
        );
        const participant = presentationParticipantBlock(f.content.blocks[0]!);
        const review = projectPresentationReview(f.version, {
          expiresAt: new Date(Date.now() + 60_000),
        });
        expectSafeQuestion(participant, type, f.sourceBlockId, f.sourceDigest);
        expectSafeQuestion(review, type, f.sourceBlockId, f.sourceDigest);

        // Exercise the export service's real recipient projection before its renderer boundary.
        const render = vi.fn<PresentationStaticRenderer>(async (input) => ({
          bytes: Buffer.from("SYNTHETIC_STATIC_RESULT"),
          contentType: contentTypes[input.format === "offline_html" ? "html" : input.format],
          extension: input.format === "offline_html" ? "html" : input.format,
        }));
        const readImage = vi.fn();
        const exports = new PresentationStaticExportService({
          repository: f.repository,
          presentations: f.presentations,
          storage: { readImage },
          featureEnabled: async () => true,
          render,
        });
        for (const format of ["pdf", "png", "html", "offline_html"] as const) {
          await exports.export(
            f.actor,
            f.presentation.id,
            {
              versionId: f.version.id,
              format,
              ...(format === "png" ? { blockId: f.blockId } : {}),
            },
            { reauthorize: async () => f.actor },
          );
          const rendered = render.mock.calls.at(-1)![0];
          expect(rendered.format).toBe(format);
          expectSafeQuestion(rendered.review, type, f.sourceBlockId, f.sourceDigest);
          expect(rendered.review.blocks).toEqual(review.blocks);
          expect(rendered.review.versionId).toBe(review.versionId);
        }
        expect(readImage).not.toHaveBeenCalled();
        expect(
          await f.presentations.getPresentation(f.actor.workspaceId, f.presentation.id),
        ).toEqual(before);
        const retained = await f.presentations.getPresentationVersion(
          f.actor.workspaceId,
          f.version.id,
        );
        expect(retained?.content.blocks[0]).toHaveProperty(
          "question.sourceCitations.0.excerpt",
          sourceSnapshot,
        );
        expect(retained?.content.blocks[0]).toHaveProperty("citations.0.excerpt", sourceSnapshot);
        expect(retained?.content.blocks[0]).toHaveProperty(
          "sourceDisclosure.model",
          "question-starters-v1",
        );
        expect(retained?.content.blocks[0]).not.toHaveProperty("provenance");
      },
    );
  }
});
