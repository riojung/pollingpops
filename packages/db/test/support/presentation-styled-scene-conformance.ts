import { createHash, randomUUID } from "node:crypto";
import { expect } from "vitest";
import {
  PRESENTATION_TEXT_ASSISTANCE_REVIEW_WARNING,
  PresentationContentSchema,
  type PresentationDesignPalette,
} from "@openround/contracts";
import { createPresentationSessionRepository, type Repository } from "../../src/index.js";
import { advancedInteractionContent } from "./presentation-advanced-interaction-conformance.js";
import { presentationSharingFixture } from "./presentation-sharing-conformance.js";

export const styledContentHash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");

export function styledPresentationContent(palette: PresentationDesignPalette = "forest") {
  const content = advancedInteractionContent();
  const first = content.blocks[0]!;
  if (first.kind !== "content" || !first.scene) throw new Error("Expected native content");
  first.scene = {
    ...first.scene,
    schemaVersion: 9,
    design: {
      theme: "paper",
      font: "sans",
      spacing: "relaxed",
      palette,
      motionBackground: "waves",
    },
    nodes: [
      ...first.scene.nodes.map((node) =>
        node.type === "text"
          ? {
              ...node,
              lang: "fr" as const,
              typography: {
                size: 62,
                weight: 700 as const,
                align: "left" as const,
                font: "serif" as const,
                color: "accentText" as const,
                leading: 1.1,
              },
            }
          : node,
      ),
      {
        id: "decoration",
        type: "shape",
        shape: "rectangle",
        color: "mint",
        label: "",
        decorative: true,
        frame: { x: 3, y: 93, width: 94, height: 3 },
        appearance: { fill: "accentText", stroke: "accentText", strokeWidth: 0.5 },
      },
    ],
    readingOrder: [...first.scene.readingOrder, "decoration"],
    groups: [{ id: "visual-header", nodeIds: ["title", "decoration"] }],
  };
  first.citations = [{ locator: "Original reference", excerpt: "Keep the imported reference" }];
  first.sourceDisclosure = {
    sourceName: "Original.pdf",
    sourceDigest: "c".repeat(64),
    provider: "Polling Pops",
    model: "visual-import-v1",
  };
  first.textAssistance = {
    schemaVersion: 1,
    nodeId: "title",
    role: "title",
    operation: "translate",
    sourceDigest: "a".repeat(64),
    outputDigest: "b".repeat(64),
    provider: "approved-test",
    model: "bounded-test",
    generatedAt: "2026-11-01T00:00:00.000Z",
    reviewWarning: PRESENTATION_TEXT_ASSISTANCE_REVIEW_WARNING,
    targetLanguage: "fr",
    sourceLanguage: "en",
  };
  return PresentationContentSchema.parse({
    ...content,
    schemaVersion: 18,
    sections: [{ id: randomUUID(), title: "Core", blockIds: content.blocks.map(({ id }) => id) }],
    spatial: {
      schemaVersion: 1,
      frames: [{ blockId: first.id, x: 0, y: 0, width: 1280, height: 720 }],
    },
  });
}

export async function persistStyledPresentation(
  repository: Repository,
  content = styledPresentationContent(),
) {
  const source = await presentationSharingFixture(repository, "styled");
  for (const block of content.blocks)
    if (block.kind === "content")
      for (const node of block.scene?.nodes ?? [])
        if (node.type === "image")
          await repository.createMediaAsset({
            id: node.mediaId,
            workspaceId: source.actor.workspaceId,
            objectKey: `media/${source.actor.workspaceId}/${node.mediaId}.png`,
            mimeType: "image/png",
            sizeBytes: 10,
            scanStatus: "clean",
            altText: node.altText ?? "Example diagram",
            createdAt: source.now,
          });
  const saved = await source.presentations.updatePresentationDraft({
    workspaceId: source.actor.workspaceId,
    presentationId: source.presentation.id,
    draft: content,
    expectedRevision: 0,
    mutationId: randomUUID(),
    editorId: source.actor.userId,
    draftHash: styledContentHash(content),
  });
  expect(saved).toMatchObject({ draftSchemaVersion: 18, draft: content });
  const version = await source.presentations.publishPresentation(
    {
      ...source.version,
      id: randomUUID(),
      version: 2,
      sourceDraftRevision: 1,
      contentSchemaVersion: 18,
      content,
      contentHash: styledContentHash(content),
    },
    1,
  );
  return {
    ...source,
    content,
    version,
    legacyVersion: source.version,
    sessions: createPresentationSessionRepository(repository),
  };
}
