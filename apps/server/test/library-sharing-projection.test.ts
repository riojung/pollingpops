import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  PresentationContentSchema,
  PresentationDraftSchema,
  type PresentationContent,
} from "@openround/contracts";
import type { LibraryShareRecord, LibraryShareSnapshot } from "@openround/db";
import { SurveyContentSchema } from "@openround/contracts/surveys";
import { surveyPagesFixture } from "../../../packages/db/test/support/survey-pages-conformance.js";
import {
  projectLibraryReader,
  reusableLibrarySnapshot,
} from "../src/library-sharing-projection.js";

describe("Library source-workspace privacy projection", () => {
  it("preserves only public v3 Survey page instructions and their ordered question references", () => {
    const content = SurveyContentSchema.parse(surveyPagesFixture());
    if (content.schemaVersion !== 3) throw new Error("Expected paged Survey content");
    content.pages[0]!.title = "Before answering";
    content.pages[0]!.description = "Read both options.\nChoose the closest match.";
    content.items[0]!.question.explanation = "PRIVATE_EXPLANATION";
    Object.assign(content.pages[0]!, { privateNotes: "PRIVATE_PAGE_NOTES" });
    const before = structuredClone(content);
    const share = { snapshot: { artifactType: "survey", content } } as LibraryShareRecord;
    const result = projectLibraryReader(share);
    if (!("questions" in result) || !result.questions || !result.surveyPages)
      throw new Error("Expected a paged Survey reader");
    expect(result.surveyPages).toEqual(
      content.pages.map(({ id, title, description, questionIds }) => ({
        id,
        title,
        description,
        questionIds,
      })),
    );
    expect(result.questions?.map((question) => question.id)).toEqual(
      content.items.map((item) => item.question.id),
    );
    expect(JSON.stringify(result)).not.toMatch(
      /PRIVATE_|isCorrect|sourceCitations|privateNotes|explanation/,
    );
    expect(content).toEqual(before);
    result.surveyPages[0]!.questionIds.push(randomUUID());
    expect(content).toEqual(before);
  });

  it.each([1, 2] as const)("keeps the legacy v%s Survey reader shape flat", (schemaVersion) => {
    const paged = surveyPagesFixture();
    const content = SurveyContentSchema.parse({
      schemaVersion,
      title: paged.title,
      items: paged.items,
    });
    const result = projectLibraryReader({
      snapshot: { artifactType: "survey", content },
    } as LibraryShareRecord);
    if (!("questions" in result) || !result.questions)
      throw new Error("Expected a legacy Survey reader");
    expect(Object.keys(result)).toEqual(["questions"]);
    expect(result.questions?.map((question) => question.id)).toEqual(
      content.items.map((item) => item.question.id),
    );
  });

  it("compiles hidden-slide dependencies together across scenes, groups, connectors, sections, branches and spatial frames", () => {
    const sceneBlockId = randomUUID(),
      questionBlockId = randomUUID(),
      hiddenBlockId = randomUUID();
    const titleId = randomUUID(),
      hiddenNavId = randomUUID(),
      visibleNavId = randomUUID(),
      connectorId = randomUUID();
    const choiceId = randomUUID();
    const draft = PresentationDraftSchema.parse({
      schemaVersion: 14,
      title: "Public presentation",
      blocks: [
        {
          id: sceneBlockId,
          kind: "content",
          layout: "title_body",
          textElements: [],
          mediaId: null,
          mediaAlt: null,
          speakerNotes: "PRIVATE_NOTES",
          scene: {
            schemaVersion: 6,
            aspectRatio: "16:9",
            nodes: [
              {
                id: titleId,
                type: "text",
                role: "title",
                text: "Public heading",
                frame: { x: 5, y: 5, width: 70, height: 10 },
              },
              {
                id: hiddenNavId,
                type: "navigation",
                label: "Private destination",
                targetBlockId: hiddenBlockId.toUpperCase(),
                frame: { x: 5, y: 70, width: 30, height: 10 },
              },
              {
                id: visibleNavId,
                type: "navigation",
                label: "Public destination",
                targetBlockId: questionBlockId.toUpperCase(),
                frame: { x: 45, y: 70, width: 30, height: 10 },
              },
              {
                id: connectorId,
                type: "connector",
                from: { nodeId: titleId, anchor: "bottom" },
                to: { nodeId: hiddenNavId, anchor: "top" },
                label: "Private connector",
                color: "blue",
              },
            ],
            groups: [{ id: randomUUID(), nodeIds: [titleId, hiddenNavId] }],
            readingOrder: [titleId, hiddenNavId, visibleNavId, connectorId],
          },
        },
        {
          id: questionBlockId,
          kind: "question",
          question: {
            id: randomUUID(),
            type: "single_select",
            prompt: "Public check",
            timeLimitSeconds: 30,
            basePoints: 1000,
            explanation: "Private answer rationale",
            mediaId: null,
            mediaAlt: null,
            choices: [
              { id: choiceId, label: "One", isCorrect: true },
              { id: randomUUID(), label: "Two", isCorrect: false },
            ],
          },
          branches: [
            {
              id: randomUUID(),
              label: "Private branch",
              targetBlockId: hiddenBlockId,
              condition: { kind: "choice_share", choiceId, minPercent: 50, minResponses: 1 },
            },
          ],
        },
        {
          id: hiddenBlockId,
          kind: "content",
          hidden: true,
          layout: "title_body",
          textElements: [
            {
              id: randomUUID(),
              role: "title",
              text: "PRIVATE_HIDDEN_TITLE",
              region: "top_center",
              order: 0,
            },
          ],
          mediaId: null,
          mediaAlt: null,
          speakerNotes: "PRIVATE_HIDDEN_NOTES",
        },
      ],
      sections: [{ id: randomUUID(), title: "PRIVATE_HIDDEN_SECTION", blockIds: [hiddenBlockId] }],
      spatial: {
        schemaVersion: 1,
        frames: [sceneBlockId, questionBlockId, hiddenBlockId].map((blockId, index) => ({
          blockId: blockId.toUpperCase(),
          x: index * 1600,
          y: 0,
          width: 1280,
          height: 720,
        })),
      },
    });
    // Defensive coverage for historical/legacy material; current published schemas reject hidden slides.
    const snapshot: LibraryShareSnapshot = {
      artifactType: "presentation",
      content: draft as PresentationContent,
    };
    const copy = reusableLibrarySnapshot(snapshot);
    expect(copy.artifactType).toBe("presentation");
    if (copy.artifactType !== "presentation") throw new Error("Wrong content type");
    expect(PresentationContentSchema.safeParse(copy.content).success).toBe(true);
    expect(JSON.stringify(copy)).not.toContain(hiddenBlockId);
    expect(JSON.stringify(copy)).not.toContain(hiddenBlockId.toUpperCase());
    expect(copy.content.spatial?.frames).toHaveLength(2);
    const scene = copy.content.blocks[0];
    expect(scene?.kind === "content" && scene.scene?.nodes.map((node) => node.id)).toEqual([
      titleId,
      visibleNavId,
    ]);
    expect(scene?.kind === "content" && scene.scene?.groups).toEqual([]);
    const share = {
      id: randomUUID(),
      artifactId: randomUUID(),
      sourceWorkspaceId: randomUUID(),
      versionId: randomUUID(),
      sharedAt: new Date().toISOString(),
      snapshot,
    } as LibraryShareRecord;
    const reader = projectLibraryReader(share);
    expect(JSON.stringify(reader)).not.toMatch(/PRIVATE_|Private|speakerNotes|correct|explanation/);
    expect(JSON.stringify(reader)).not.toContain(hiddenBlockId.toUpperCase());
    expect(draft.blocks).toHaveLength(3);
    expect(draft.blocks[0]?.kind === "content" && draft.blocks[0].scene?.nodes).toHaveLength(4);
  });
});
