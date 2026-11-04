import { createHash, randomUUID } from "node:crypto";
import { PresentationDraftSchema, type PresentationDraft } from "@openround/contracts";
import { describe, expect, it } from "vitest";
import { MemoryPresentationRepository } from "../src/presentations.js";
import {
  PRESENTATION_CONTENT_SCHEMA_VERSION,
  PRESENTATION_DRAFT_SCHEMA_VERSION,
  PRESENTATION_NATIVE_SCENE_SCHEMA_VERSION,
  PRESENTATION_RICH_TEXT_SCHEMA_VERSION,
  upcastPresentationContent,
  upcastPresentationDraft,
  upcastPresentationSessionContent,
} from "../src/artifact-schemas.js";

function presentation(): PresentationDraft {
  return PresentationDraftSchema.parse({
    title: "Native update",
    schemaVersion: 4,
    blocks: [
      {
        id: randomUUID(),
        kind: "content",
        layout: "title_body",
        textElements: [],
        mediaId: null,
        mediaAlt: null,
        speakerNotes: "Private note",
        citations: [{ locator: "Brief", excerpt: "Source text" }],
        scene: {
          schemaVersion: 1,
          aspectRatio: "16:9",
          nodes: [
            {
              id: "title",
              frame: { x: 8, y: 8, width: 80, height: 20 },
              type: "text",
              role: "title",
              text: "Project update",
            },
            {
              id: "image",
              frame: { x: 8, y: 40, width: 40, height: 40 },
              type: "image",
              mediaId: randomUUID(),
              altText: "A workflow",
            },
          ],
          readingOrder: ["title", "image"],
        },
      },
    ],
  });
}

function richTextPresentation(): PresentationDraft {
  const draft = presentation();
  draft.schemaVersion = 5;
  const block = draft.blocks[0]!;
  if (block.kind !== "content" || !block.scene) throw new Error("Expected native slide");
  block.scene.schemaVersion = 2;
  const title = block.scene.nodes.find((node) => node.type === "text")!;
  if (title.type !== "text") throw new Error("Expected title");
  title.richText = {
    paragraphs: [
      {
        kind: "paragraph",
        runs: [
          { text: "Project ", bold: true },
          { text: "update", italic: true },
        ],
      },
    ],
  };
  block.scene.nodes.push({
    id: "body",
    type: "text",
    role: "body",
    frame: { x: 52, y: 40, width: 40, height: 40 },
    text: "Review the plan\nShip safely\nCheck results",
    richText: {
      paragraphs: [
        { kind: "paragraph", runs: [{ text: "Review the plan", bold: true }] },
        {
          kind: "bullet",
          runs: [{ text: "Ship safely", italic: true, href: "https://example.com/release" }],
        },
        { kind: "numbered", runs: [{ text: "Check results" }] },
      ],
    },
  });
  block.scene.readingOrder.push("body");
  return PresentationDraftSchema.parse(draft);
}

describe("durable native Presentation artifact version", () => {
  it("opts into v4 and retains ordinary v2 defaults", () => {
    expect(PRESENTATION_DRAFT_SCHEMA_VERSION).toBe(2);
    expect(PRESENTATION_CONTENT_SCHEMA_VERSION).toBe(2);
    expect(PRESENTATION_NATIVE_SCENE_SCHEMA_VERSION).toBe(4);
    const draft = presentation();
    const stored = JSON.parse(JSON.stringify(draft));
    expect(upcastPresentationDraft(stored, 4)).toEqual(draft);
    expect(upcastPresentationContent(stored, 4)).toEqual(draft);
    expect(upcastPresentationSessionContent(stored, 4)).toEqual(draft);
    expect(JSON.stringify(upcastPresentationContent(stored, 4))).toBe(JSON.stringify(draft));
  });

  it.each([undefined, null, 1, 2, 3])(
    "rejects scene content under an old stored column %s instead of losing references",
    (schemaVersion) => {
      const draft = presentation();
      expect(() => upcastPresentationDraft(draft, schemaVersion)).toThrow("schema version 4");
      expect(() => upcastPresentationContent(draft, schemaVersion)).toThrow("schema version 4");
      expect(() => upcastPresentationSessionContent(draft, schemaVersion)).toThrow(
        "schema version 4",
      );
    },
  );

  it("retains the legacy partial-snapshot read path for v4 without dropping scenes", () => {
    const draft = presentation();
    const block = draft.blocks[0]!;
    if (block.kind !== "content" || !block.scene) throw new Error("Expected native slide");
    const image = block.scene.nodes.find((node) => node.type === "image")!;
    if (image.type !== "image") throw new Error("Expected image");
    image.altText = null;
    expect(upcastPresentationSessionContent(draft, 4)).toEqual(draft);
    expect(() => upcastPresentationContent(draft, 4)).toThrow("Describe the image");
  });

  it.each([4, 5] as const)(
    "reads v%s draft, history and immutable version without rewriting hash or native IDs",
    async (schemaVersion) => {
      const repository = new MemoryPresentationRepository();
      const draft = schemaVersion === 5 ? richTextPresentation() : presentation();
      const workspaceId = randomUUID();
      const presentationId = randomUUID();
      const versionId = randomUUID();
      const now = new Date("2026-11-03T12:00:00.000Z");
      const record = {
        id: presentationId,
        workspaceId,
        title: draft.title,
        description: draft.description,
        status: "published" as const,
        draft,
        draftRevision: 1,
        draftSchemaVersion: schemaVersion,
        currentVersionId: versionId,
        folderId: null,
        publishedDraftRevision: 1,
        lastEditedBy: null,
        createdAt: now,
        updatedAt: now,
      };
      repository.presentations.set(presentationId, record);
      repository.history.set(`${presentationId}:1`, {
        id: randomUUID(),
        workspaceId,
        presentationId,
        revision: 1,
        draft,
        draftSchemaVersion: schemaVersion,
        savedBy: null,
        mutationId: null,
        createdAt: now,
      });
      const published = {
        id: versionId,
        workspaceId,
        presentationId,
        version: 1,
        content: draft,
        contentSchemaVersion: schemaVersion,
        contentHash: createHash("sha256").update(JSON.stringify(draft)).digest("hex"),
        sourceDraftRevision: 1,
        publishedAt: now,
      };
      repository.versions.set(versionId, published);
      await expect(repository.getPresentation(workspaceId, presentationId)).resolves.toEqual(
        record,
      );
      await expect(
        repository.listPresentationHistory(workspaceId, presentationId),
      ).resolves.toMatchObject([{ draft, draftSchemaVersion: schemaVersion }]);
      await expect(repository.getPresentationVersion(workspaceId, versionId)).resolves.toEqual(
        published,
      );
      expect(repository.versions.get(versionId)).toEqual(published);
    },
  );
});

describe("durable rich-text Presentation artifact version", () => {
  it("opts into v5 and round-trips canonical draft, content and session JSON without changing hashes", () => {
    expect(PRESENTATION_RICH_TEXT_SCHEMA_VERSION).toBe(5);
    expect(PRESENTATION_DRAFT_SCHEMA_VERSION).toBe(2);
    expect(PRESENTATION_CONTENT_SCHEMA_VERSION).toBe(2);
    const draft = richTextPresentation();
    const serialized = JSON.stringify(draft);
    const expectedHash = createHash("sha256").update(serialized).digest("hex");
    for (const parse of [
      upcastPresentationDraft,
      upcastPresentationContent,
      upcastPresentationSessionContent,
    ]) {
      const parsed = parse(JSON.parse(serialized), 5);
      expect(parsed).toEqual(draft);
      expect(JSON.stringify(parsed)).toBe(serialized);
      expect(createHash("sha256").update(JSON.stringify(parsed)).digest("hex")).toBe(expectedHash);
    }
  });

  it.each([undefined, null, 1, 2, 3, 4])(
    "rejects scene2 content under an old stored column %s without discarding formatting",
    (schemaVersion) => {
      const draft = richTextPresentation();
      expect(() => upcastPresentationDraft(draft, schemaVersion)).toThrow("schema version 5");
      expect(() => upcastPresentationContent(draft, schemaVersion)).toThrow("schema version 5");
      expect(() => upcastPresentationSessionContent(draft, schemaVersion)).toThrow(
        "schema version 5",
      );
    },
  );

  it("retains the legacy partial-snapshot read path for v5 without dropping formatting", () => {
    const draft = richTextPresentation();
    const block = draft.blocks[0]!;
    if (block.kind !== "content" || !block.scene) throw new Error("Expected native slide");
    const image = block.scene.nodes.find((node) => node.type === "image")!;
    if (image.type !== "image") throw new Error("Expected image");
    image.altText = null;
    expect(upcastPresentationSessionContent(draft, 5)).toEqual(draft);
    expect(() => upcastPresentationContent(draft, 5)).toThrow("Describe the image");
  });
});
