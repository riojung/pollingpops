import { randomUUID } from "node:crypto";
import { describe, it, expect } from "vitest";
import {
  PresentationDraftSchema,
  PresentationContentSchema,
  PresentationDeliveredSceneSchema,
  PresentationSceneSchema,
  PresentationCommandSchema,
  PresentationInteractionStateSchema,
} from "../src/index.js";
const scene = () => ({
  schemaVersion: 6,
  aspectRatio: "16:9",
  nodes: [
    {
      id: "title",
      type: "text",
      role: "title",
      text: "Explore",
      frame: { x: 0, y: 0, width: 100, height: 10 },
    },
    {
      id: "image",
      type: "image",
      mediaId: randomUUID(),
      altText: "Diagram",
      frame: { x: 5, y: 15, width: 60, height: 70 },
    },
    {
      id: "hotspot",
      type: "hotspot",
      scope: "local",
      imageNodeId: "image",
      label: "Inspect",
      detailTitle: "Detail",
      body: "Public local text",
      frame: { x: 10, y: 25, width: 15, height: 15 },
    },
    {
      id: "dialog",
      type: "dialog",
      scope: "local",
      label: "Read",
      detailTitle: "Context",
      body: "Public dialog",
      frame: { x: 70, y: 15, width: 25, height: 15 },
    },
    {
      id: "broadcast",
      type: "reveal",
      scope: "broadcast",
      label: "Presenter reveal",
      body: "Private until revealed",
      frame: { x: 70, y: 45, width: 25, height: 15 },
    },
  ],
  readingOrder: ["title", "image", "hotspot", "dialog", "broadcast"],
});
const block = (value: unknown = scene()) => ({
  id: randomUUID(),
  kind: "content",
  layout: "title_body",
  textElements: [],
  mediaId: null,
  mediaAlt: null,
  speakerNotes: "Private notes",
  scene: value,
});
describe("advanced Presentation interaction contracts", () => {
  it("separates full private publication from redacted delivered broadcast bodies", () => {
    const value = scene();
    expect(PresentationSceneSchema.safeParse(value).success).toBe(true);
    const redacted = {
      ...value,
      nodes: value.nodes.map((node) => (node.type === "reveal" ? { ...node, body: "" } : node)),
    };
    expect(PresentationSceneSchema.safeParse(redacted).success).toBe(false);
    expect(PresentationDeliveredSceneSchema.safeParse(redacted).success).toBe(true);
    expect(PresentationSceneSchema.safeParse({ ...value, schemaVersion: 5 }).success).toBe(false);
    expect(
      PresentationContentSchema.safeParse({
        schemaVersion: 12,
        title: "Wrong gate",
        blocks: [block(value)],
      }).success,
    ).toBe(false);
  });
  it("permits incomplete hotspot targets only in drafts and validates containment", () => {
    const value = scene();
    const incomplete = {
      ...value,
      nodes: value.nodes.map((node) =>
        node.type === "hotspot" ? { ...node, imageNodeId: null } : node,
      ),
    };
    expect(
      PresentationDraftSchema.safeParse({
        schemaVersion: 13,
        title: "Draft",
        blocks: [block(incomplete)],
      }).success,
    ).toBe(true);
    expect(PresentationSceneSchema.safeParse(incomplete).success).toBe(false);
    expect(
      PresentationSceneSchema.safeParse({
        ...value,
        nodes: value.nodes.map((node) =>
          node.type === "hotspot"
            ? { ...node, frame: { x: 75, y: 25, width: 15, height: 15 } }
            : node,
        ),
      }).success,
    ).toBe(false);
  });
  it("allows only forward frozen branches on supported unlinked main checkpoints", () => {
    const source = {
      id: randomUUID(),
      kind: "question",
      question: {
        id: randomUUID(),
        type: "numeric",
        prompt: "How many?",
        correctValue: "1",
        tolerance: "0",
        unit: null,
        purpose: "diagnostic",
        confidence: "off",
        delivery: "main",
        linkedRecheckQuestionId: null,
        timeLimitSeconds: 30,
        basePoints: 1000,
        explanation: "One",
        mediaId: null,
        mediaAlt: null,
      },
    };
    const target = block();
    const branch = {
      id: randomUUID(),
      label: "Follow",
      condition: { kind: "correct_share", minPercent: 50, minResponses: 2 },
      targetBlockId: target.id,
    };
    const value = {
      schemaVersion: 13,
      title: "Answer branches",
      blocks: [{ ...source, branches: [branch] }, target],
    };
    expect(PresentationContentSchema.safeParse(value).success).toBe(true);
    expect(PresentationContentSchema.safeParse({ ...value, schemaVersion: 12 }).success).toBe(
      false,
    );
    expect(
      PresentationContentSchema.safeParse({
        ...value,
        blocks: [target, { ...source, branches: [branch] }],
      }).success,
    ).toBe(false);
    expect(
      PresentationDraftSchema.safeParse({
        ...value,
        blocks: [{ ...source, branches: [{ ...branch, targetBlockId: null, label: "" }] }, target],
      }).success,
    ).toBe(true);
    expect(
      PresentationContentSchema.safeParse({
        ...value,
        blocks: [
          {
            ...source,
            branches: [
              {
                ...branch,
                condition: {
                  kind: "choice_share",
                  choiceId: randomUUID(),
                  minPercent: 50,
                  minResponses: 1,
                },
              },
            ],
          },
          target,
        ],
      }).success,
    ).toBe(false);
  });
  it("strictly validates new commands and unique absolute reveal state", () => {
    const fields = {
      sessionId: randomUUID(),
      controlToken: "t".repeat(32),
      commandId: randomUUID(),
      expectedRevision: 0,
      blockId: randomUUID(),
    };
    expect(
      PresentationCommandSchema.parse({
        ...fields,
        action: "set_reveal",
        nodeId: "broadcast",
        revealed: true,
      }).action,
    ).toBe("set_reveal");
    expect(
      PresentationCommandSchema.parse({ ...fields, action: "navigate_scene", nodeId: "link" })
        .action,
    ).toBe("navigate_scene");
    expect(
      PresentationCommandSchema.parse({
        ...fields,
        action: "follow_branch",
        branchId: randomUUID(),
      }).action,
    ).toBe("follow_branch");
    const state = { blockId: fields.blockId, nodeId: "broadcast", revealed: true };
    expect(
      PresentationInteractionStateSchema.safeParse({
        reveals: [state, { ...state, blockId: state.blockId.toUpperCase() }],
      }).success,
    ).toBe(false);
  });
});
