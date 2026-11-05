import { createHash, randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { PresentationContentSchema, PresentationDraftSchema } from "@openround/contracts";
import {
  PRESENTATION_OPINION_SCHEMA_VERSION,
  upcastPresentationContent,
  upcastPresentationDraft,
  upcastPresentationSessionContent,
  UnsupportedArtifactSchemaVersionError,
} from "../src/artifact-schemas.js";
import {
  presentationResponseSchemaVersion,
  upcastPresentationResponse,
} from "../src/response-schemas.js";
import { mapResponse } from "../src/presentation-session-postgres-support.js";
import { presentationMediaIds } from "../src/media-references.js";
import { MemoryPresentationRepository } from "../src/presentations.js";
import { publishedQuestionTextOnlyLiveEligible } from "../src/published-question-live-metadata.js";

function opinionDocument() {
  return PresentationContentSchema.parse({
    title: "Opinions",
    schemaVersion: 9,
    blocks: [
      {
        id: randomUUID(),
        kind: "question",
        question: {
          id: randomUUID(),
          type: "ranking",
          prompt: "Prioritize",
          choices: ["A", "B", "C"].map((label) => ({ id: randomUUID(), label, isCorrect: false })),
          rankCount: 2,
          purpose: "opinion",
          confidence: "off",
          delivery: "main",
          linkedRecheckQuestionId: null,
          timeLimitSeconds: 30,
          basePoints: 0,
          explanation: "",
          mediaId: null,
          mediaAlt: null,
        },
      },
    ],
  });
}

describe("Presentation v9 durable readers", () => {
  it("preserves the exact embedded payload and rejects all earlier version columns and future versions", () => {
    const document = opinionDocument();
    const bytes = JSON.stringify(document);
    expect(PRESENTATION_OPINION_SCHEMA_VERSION).toBe(9);
    for (const parse of [
      upcastPresentationContent,
      upcastPresentationDraft,
      upcastPresentationSessionContent,
    ]) {
      expect(JSON.stringify(parse(JSON.parse(bytes), 9))).toBe(bytes);
      for (const version of [1, 2, 3, 4, 5, 6, 7, 8])
        expect(() => parse(document, version)).toThrow("schema version 9");
      expect(() => parse(document, 14)).toThrow(UnsupportedArtifactSchemaVersionError);
    }
    const block = document.blocks[0]!;
    if (block.kind !== "question") throw new Error("Expected ranking");
    expect(publishedQuestionTextOnlyLiveEligible(block.question)).toBe(true);
    expect(
      publishedQuestionTextOnlyLiveEligible({
        ...block.question,
        type: "open_text",
        choices: undefined,
        rankCount: undefined,
      } as never),
    ).toBe(false);
  });

  it("retains v9 through authoring retries, frozen publication, history and restore", async () => {
    const repository = new MemoryPresentationRepository();
    const workspaceId = randomUUID();
    const presentationId = randomUUID();
    const editorId = randomUUID();
    const now = new Date();
    const draft = PresentationDraftSchema.parse(opinionDocument());
    await repository.createPresentation({
      id: presentationId,
      workspaceId,
      title: draft.title,
      description: draft.description,
      status: "draft",
      draft,
      draftRevision: 0,
      draftSchemaVersion: 9,
      currentVersionId: null,
      folderId: null,
      publishedDraftRevision: null,
      lastEditedBy: editorId,
      createdAt: now,
      updatedAt: now,
    });
    const content = PresentationContentSchema.parse(draft);
    const contentHash = createHash("sha256").update(JSON.stringify(content)).digest("hex");
    const published = await repository.publishPresentation(
      {
        id: randomUUID(),
        workspaceId,
        presentationId,
        version: 1,
        content,
        contentHash,
        contentSchemaVersion: 9,
        sourceDraftRevision: 0,
        publishedAt: now,
      },
      0,
    );
    const edited = structuredClone(draft);
    const block = edited.blocks[0]!;
    if (block.kind !== "question") throw new Error("Expected ranking");
    block.question.prompt = "A later unpublished edit";
    const mutation = {
      workspaceId,
      presentationId,
      draft: edited,
      expectedRevision: 0,
      mutationId: randomUUID(),
      editorId,
      draftHash: createHash("sha256").update(JSON.stringify(edited)).digest("hex"),
    };
    expect((await repository.updatePresentationDraft(mutation))?.draftSchemaVersion).toBe(9);
    expect((await repository.updatePresentationDraft(mutation))?.draftRevision).toBe(1);
    expect(await repository.getPresentationVersion(workspaceId, published.id)).toMatchObject({
      content,
      contentHash,
      contentSchemaVersion: 9,
    });
    expect(
      (await repository.listPresentationHistory(workspaceId, presentationId)).map(
        (entry) => entry.draftSchemaVersion,
      ),
    ).toEqual([9, 9]);
    const restored = await repository.restorePresentationHistory({
      workspaceId,
      presentationId,
      historyRevision: 0,
      expectedRevision: 1,
      mutationId: randomUUID(),
      editorId,
    });
    expect(restored).toMatchObject({ draftSchemaVersion: 9, draftRevision: 2, draft });
    expect(await repository.getPresentationVersion(workspaceId, published.id)).toMatchObject({
      content,
      contentHash,
      contentSchemaVersion: 9,
    });
  });

  it("keeps existing native and question media discoverable in v9", () => {
    const document = opinionDocument();
    const question = document.blocks[0]!;
    if (question.kind !== "question") throw new Error("Expected ranking");
    const questionMedia = randomUUID();
    const sceneMedia = randomUUID();
    const draft = PresentationDraftSchema.parse({
      ...document,
      blocks: [
        {
          ...question,
          question: { ...question.question, mediaId: questionMedia, mediaAlt: "Priorities" },
        },
        {
          id: randomUUID(),
          kind: "content",
          layout: "title_body",
          textElements: [],
          mediaId: null,
          mediaAlt: null,
          speakerNotes: "",
          scene: {
            schemaVersion: 1,
            aspectRatio: "16:9",
            nodes: [
              {
                id: "title",
                type: "text",
                role: "title",
                text: "Priorities",
                frame: { x: 5, y: 5, width: 80, height: 20 },
              },
              {
                id: "image",
                type: "image",
                mediaId: sceneMedia,
                altText: "Context",
                frame: { x: 5, y: 30, width: 80, height: 50 },
              },
            ],
            readingOrder: ["title", "image"],
          },
        },
      ],
    });
    expect(presentationMediaIds(upcastPresentationDraft(draft, 9)).sort()).toEqual(
      [questionMedia, sceneMedia].sort(),
    );
  });

  it("checks response version before parsing and preserves explicit ranking order", () => {
    const ids = [randomUUID(), randomUUID()];
    const response = { orderedChoiceIds: ids };
    expect(presentationResponseSchemaVersion(response)).toBe(2);
    expect(
      presentationResponseSchemaVersion({ choiceIds: ids }, { type: "poll", maxSelections: 2 }),
    ).toBe(2);
    expect(presentationResponseSchemaVersion({ choiceIds: ids }, { type: "multi_select" })).toBe(1);
    expect(upcastPresentationResponse(response, 2)).toEqual(response);
    expect(() => upcastPresentationResponse(response, 1)).toThrow("schema version 2");
    expect(() => upcastPresentationResponse(response, 4)).toThrow(
      "Unsupported Presentation response schema version 4",
    );
    expect(() => mapResponse({ response, response_schema_version: 1 })).toThrow("schema version 2");
    expect(() => mapResponse({ response, response_schema_version: 4 })).toThrow(
      "Unsupported Presentation response schema version 4",
    );
    expect(upcastPresentationResponse({ choiceIds: ids }, 1)).toEqual({ choiceIds: ids });
  });
});
