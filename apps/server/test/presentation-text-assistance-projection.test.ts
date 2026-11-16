import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  PresentationContentSchema,
  PRESENTATION_TEXT_ASSISTANCE_REVIEW_WARNING,
  presentationTextAssistanceSourceDigest,
} from "@openround/contracts";
import { presentationParticipantBlock } from "../src/presentation-session-projections.js";
import { projectPresentationReview } from "../src/presentation-sharing-projection.js";

describe("private latest AI edit provenance", () => {
  it.each([15, 16] as const)(
    "keeps document%s AI edits private while retaining public text language annotations",
    (versionNumber) => {
      const sourceDigest = presentationTextAssistanceSourceDigest("PRIVATE original draft wording"),
        text = "Public reviewed wording",
        outputDigest = presentationTextAssistanceSourceDigest(text);
      const content = PresentationContentSchema.parse({
        schemaVersion: versionNumber,
        title: "Approved deck",
        blocks: [
          {
            id: randomUUID(),
            kind: "content",
            layout: "title_body",
            textElements: [],
            mediaId: null,
            mediaAlt: null,
            speakerNotes: "PRIVATE notes",
            citations: [{ locator: "PRIVATE locator", excerpt: "PRIVATE earlier evidence" }],
            sourceDisclosure: {
              sourceName: "PRIVATE source",
              sourceDigest: "a".repeat(64),
              provider: "PRIVATE original provider",
              model: "PRIVATE original model",
              conversionNotes: ["PRIVATE conversion note"],
            },
            textAssistance: {
              schemaVersion: 1,
              nodeId: "Body:CaseSensitive",
              role: "body",
              operation: versionNumber === 16 ? "translate" : "rewrite",
              ...(versionNumber === 16 ? { targetLanguage: "fr", sourceLanguage: null } : {}),
              sourceDigest,
              outputDigest,
              provider: "PRIVATE new provider",
              model: "PRIVATE new model",
              generatedAt: "2026-11-06T00:00:00.000Z",
              reviewWarning: PRESENTATION_TEXT_ASSISTANCE_REVIEW_WARNING,
            },
            scene: {
              schemaVersion: versionNumber === 16 ? 7 : 6,
              aspectRatio: "16:9",
              nodes: [
                {
                  id: "Title",
                  type: "text",
                  role: "title",
                  text: "Public title",
                  frame: { x: 7, y: 7, width: 86, height: 20 },
                },
                {
                  id: "Body:CaseSensitive",
                  type: "text",
                  role: "body",
                  text,
                  ...(versionNumber === 16 ? { lang: "fr" } : {}),
                  frame: { x: 7, y: 33, width: 86, height: 59 },
                },
              ],
              readingOrder: ["Title", "Body:CaseSensitive"],
            },
          },
        ],
      });
      const version = {
        id: randomUUID(),
        workspaceId: randomUUID(),
        presentationId: randomUUID(),
        version: 1,
        content,
        contentSchemaVersion: versionNumber,
        contentHash: "d".repeat(64),
        sourceDraftRevision: 3,
        publishedAt: new Date("2026-11-06T00:00:00.000Z"),
      };
      const participant = presentationParticipantBlock(content.blocks[0]!),
        review = projectPresentationReview(version, {
          expiresAt: new Date("2026-11-07T00:00:00.000Z"),
        });
      for (const projected of [participant, review]) {
        const json = JSON.stringify(projected);
        expect(json).toContain(text);
        expect(json).toContain("Body:CaseSensitive");
        expect(json).not.toMatch(
          /PRIVATE|textAssistance|sourceDisclosure|citations|sourceDigest|outputDigest|reviewWarning/,
        );
        expect(json).not.toContain(sourceDigest);
        expect(json).not.toContain(outputDigest);
        if (versionNumber === 16) expect(json).toContain('"lang":"fr"');
      }
      expect(content.blocks[0]).toHaveProperty("textAssistance.provider", "PRIVATE new provider");
      expect(content.blocks[0]).toHaveProperty(
        "sourceDisclosure.provider",
        "PRIVATE original provider",
      );
    },
  );
});
