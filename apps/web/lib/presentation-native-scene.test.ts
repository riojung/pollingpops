import { describe, expect, it } from "vitest";
import {
  PresentationDraftSchema,
  PresentationSceneDraftSchema,
  PRESENTATION_SCENE_MAX_NODES,
  type PresentationDraft,
  type PresentationScene,
} from "@openround/contracts";
import {
  contentSlideTitle,
  duplicatePresentationBlock,
  normalizePresentationRecoveryDraft,
  presentationReadiness,
} from "./presentation-builder";
import {
  attachNativeImage,
  boundNativeSceneFrame,
  nativeImageAttachmentStatus,
  type NativeImageAttachment,
  createNativeContentBlock,
  createDesignedNativeContentBlock,
  createNativeLinkNode,
  createNativeRevealNode,
  duplicateNativeScene,
  nativeNodeLabel,
  removeNativeNode,
  reorderNativeNode,
  updateNativeNode,
} from "./presentation-native-scene";

function nativeSceneFixture(): PresentationScene {
  return {
    schemaVersion: 1,
    aspectRatio: "16:9",
    nodes: [
      {
        id: "title",
        type: "text",
        role: "title",
        text: "Native workflow",
        frame: { x: 8, y: 8, width: 84, height: 20 },
      },
      {
        id: "shape",
        type: "shape",
        shape: "diamond",
        color: "blue",
        label: "Decision",
        frame: { x: 40, y: 40, width: 25, height: 30 },
      },
      {
        id: "body",
        type: "text",
        role: "body",
        text: "Start here",
        frame: { x: 8, y: 40, width: 25, height: 20 },
      },
      {
        id: "edge",
        type: "connector",
        from: { nodeId: "body", anchor: "right" },
        to: { nodeId: "shape", anchor: "left" },
        label: "Continue",
        color: "blue",
      },
    ],
    readingOrder: ["title", "body", "shape", "edge"],
  };
}

function draft(): PresentationDraft {
  return {
    title: "Native deck",
    description: "",
    experiencePreset: { id: "focus", version: 1 },
    schemaVersion: 4,
    blocks: [
      { ...createNativeContentBlock(), scene: nativeSceneFixture(), speakerNotes: "Private notes" },
    ],
  };
}

describe("native Presentation authoring operations", () => {
  it("preserves reveal and link content through document 11 recovery, duplication and reading-order changes", () => {
    const input = draft();
    input.schemaVersion = 11;
    const block = input.blocks[0]!;
    if (block.kind !== "content" || !block.scene) throw new Error("fixture");
    const reveal = {
      ...createNativeRevealNode(),
      label: "Show the explanation",
      body: "Audience explanation\nwith detail",
    };
    const link = {
      ...createNativeLinkNode(),
      label: "Read more",
      href: "https://example.com/details",
    };
    expect(nativeNodeLabel(createNativeRevealNode())).toBe("Reveal panel");
    expect(nativeNodeLabel(createNativeLinkNode())).toBe("External link");
    expect(createNativeLinkNode().id).not.toBe(link.id);
    block.scene = {
      ...block.scene,
      schemaVersion: 5,
      nodes: [...block.scene.nodes, reveal, link],
      readingOrder: [...block.scene.readingOrder, reveal.id, link.id],
    };
    const restored = normalizePresentationRecoveryDraft(JSON.parse(JSON.stringify(input)));
    expect(restored).toEqual(input);
    expect(PresentationDraftSchema.parse(restored).schemaVersion).toBe(11);
    const copied = duplicateNativeScene(block.scene);
    expect(copied.schemaVersion).toBe(5);
    const copiedReveal = copied.nodes.find((node) => node.type === "reveal")!;
    const copiedLink = copied.nodes.find((node) => node.type === "link")!;
    expect(copiedReveal).toEqual({ ...reveal, id: copiedReveal.id });
    expect(copiedLink).toEqual({ ...link, id: copiedLink.id });
    expect(copiedReveal.id).not.toBe(reveal.id);
    expect(copiedLink.id).not.toBe(link.id);
    const reordered = reorderNativeNode(copied, copiedLink.id, -1);
    expect(reordered.readingOrder.slice(-2)).toEqual([copiedLink.id, copiedReveal.id]);
    const removed = removeNativeNode(reordered, copiedLink.id);
    expect(removed.nodes.find((node) => node.id === copiedReveal.id)).toEqual(copiedReveal);
    expect(removed.nodes.some((node) => node.id === copiedLink.id)).toBe(false);
    expect(removed.schemaVersion).toBe(5);
    expect(PresentationSceneDraftSchema.parse(removed)).toEqual(removed);
  });

  it("starts the visible New slide action with independent designed title and body objects", () => {
    const first = createDesignedNativeContentBlock();
    const second = createDesignedNativeContentBlock();
    expect(first.scene).toMatchObject({
      schemaVersion: 3,
      design: { theme: "paper", font: "sans", spacing: "relaxed" },
    });
    expect(
      first.scene!.nodes.map((node) => (node.type === "text" ? node.role : node.type)),
    ).toEqual(["title", "body"]);
    expect(PresentationSceneDraftSchema.safeParse(first.scene).success).toBe(true);
    expect(first.id).not.toBe(second.id);
    expect(
      second.scene!.nodes.every(
        (node) => !first.scene!.nodes.some((source) => source.id === node.id),
      ),
    ).toBe(true);
    expect(createNativeContentBlock().scene!.schemaVersion).toBe(1);
  });

  it("retains rich formatting and canonical text through recovery and node-remapping duplication", () => {
    const input = draft();
    input.schemaVersion = 5;
    const block = input.blocks[0]!;
    if (block.kind !== "content") throw new Error("fixture");
    block.scene!.schemaVersion = 2;
    const body = block.scene!.nodes.find((node) => node.id === "body");
    if (!body || body.type !== "text") throw new Error("fixture");
    body.richText = {
      paragraphs: [
        {
          kind: "bullet",
          runs: [
            { text: "Start", bold: true },
            { text: " here", href: "https://example.com" },
          ],
        },
      ],
    };
    const restored = normalizePresentationRecoveryDraft(JSON.parse(JSON.stringify(input)));
    expect(restored).toEqual(input);
    const copied = duplicatePresentationBlock(block);
    if (copied.kind !== "content") throw new Error("fixture");
    const copiedBody = copied.scene!.nodes.find(
      (node) => node.type === "text" && node.role === "body",
    );
    expect(copiedBody).toMatchObject({ text: "Start here", richText: body.richText });
    expect(copiedBody!.id).not.toBe(body.id);
    expect(PresentationDraftSchema.parse({ ...input, blocks: [copied] }).schemaVersion).toBe(5);
  });

  it("creates a valid incomplete scene and preserves all visual edits through recovery", () => {
    expect(PresentationSceneDraftSchema.safeParse(createNativeContentBlock().scene).success).toBe(
      true,
    );
    const edited = draft();
    const block = edited.blocks[0]!;
    if (block.kind !== "content") throw new Error("fixture");
    block.scene = updateNativeNode(block.scene!, "body", (node) =>
      node.type === "text"
        ? { ...node, text: "Recovered evidence", frame: { ...node.frame, x: 12 } }
        : node,
    );
    block.scene = reorderNativeNode(block.scene, "shape", -1);
    const restored = normalizePresentationRecoveryDraft(JSON.parse(JSON.stringify(edited)));
    expect(restored).toEqual(edited);
    expect(PresentationDraftSchema.safeParse(restored).success).toBe(true);
    expect(contentSlideTitle(block)).toBe("Native workflow");
    expect(presentationReadiness(restored)).toEqual([]);
  });

  it("remaps every node, endpoint and reading-order reference when duplicating", () => {
    const original = draft().blocks[0]!;
    const before = structuredClone(original);
    const copy = duplicatePresentationBlock(original);
    expect(original).toEqual(before);
    expect(copy.id).not.toBe(original.id);
    if (copy.kind !== "content" || original.kind !== "content") throw new Error("fixture");
    expect(copy.speakerNotes).toBe("Private notes");
    expect(PresentationSceneDraftSchema.safeParse(copy.scene).success).toBe(true);
    const originalIds = new Set(original.scene!.nodes.map((node) => node.id));
    expect(copy.scene!.nodes.every((node) => !originalIds.has(node.id))).toBe(true);
    const edge = copy.scene!.nodes.find((node) => node.type === "connector")!;
    if (edge.type !== "connector") throw new Error("fixture");
    expect(edge.from.nodeId).toBe(
      copy.scene!.nodes.find((node) => node.type === "text" && node.role === "body")!.id,
    );
    expect(edge.to.nodeId).toBe(copy.scene!.nodes.find((node) => node.type === "shape")!.id);
    expect(copy.scene!.readingOrder[1]).toBe(edge.from.nodeId);
  });

  it("deletes connected edges atomically and retains the required title", () => {
    const scene = nativeSceneFixture();
    const removed = removeNativeNode(scene, "shape");
    expect(removed.nodes.map((node) => node.id)).toEqual(["title", "body"]);
    expect(removed.readingOrder).toEqual(["title", "body"]);
    expect(PresentationSceneDraftSchema.safeParse(removed).success).toBe(true);
    expect(removeNativeNode(scene, "title")).toBe(scene);
  });

  it("bounds movement and resizing within the slide", () => {
    expect(boundNativeSceneFrame({ x: -10, y: 110, width: 150, height: -5 })).toEqual({
      x: 0,
      y: 99,
      width: 100,
      height: 1,
    });
  });

  it("reports native accessibility failures without legacy empty-text errors", () => {
    const input = draft();
    const block = input.blocks[0]!;
    if (block.kind !== "content") throw new Error("fixture");
    block.scene!.nodes.push({
      id: "image",
      type: "image",
      mediaId: "11111111-1111-4111-8111-111111111111",
      altText: null,
      frame: { x: 70, y: 40, width: 20, height: 30 },
    });
    block.scene!.readingOrder.push("image");
    const issues = presentationReadiness(input);
    expect(issues.some((issue) => issue.field === "altText")).toBe(true);
    expect(issues.some((issue) => issue.message === "Add content to this slide.")).toBe(false);
  });
});

describe("finalized native image attachment", () => {
  function fullDraft() {
    const input = draft();
    const block = input.blocks[0]!;
    if (block.kind !== "content" || !block.scene) throw new Error("fixture");
    while (block.scene.nodes.length < PRESENTATION_SCENE_MAX_NODES) {
      const id = `extra-${block.scene.nodes.length}`;
      block.scene.nodes.push({
        id,
        type: "text",
        role: "body",
        text: "Existing work",
        frame: { x: 8, y: 40, width: 20, height: 20 },
      });
      block.scene.readingOrder.push(id);
    }
    const attachment: NativeImageAttachment = {
      blockId: block.id,
      nodeId: "uploaded-image",
      mediaId: "11111111-1111-4111-8111-111111111111",
      altText: "Clean uploaded evidence",
    };
    return { input, attachment };
  }

  it("retains a finalized image when history fills the last slot, then attaches the same media when space returns", () => {
    const { input: full, attachment } = fullDraft();
    const target = full.blocks[0]!;
    if (target.kind !== "content" || !target.scene) throw new Error("fixture");
    const withSpace = {
      ...full,
      blocks: [{ ...target, scene: removeNativeNode(target.scene, "extra-49") }],
    };
    expect(nativeImageAttachmentStatus(withSpace, attachment)).toBe("ready");
    // An Undo/Redo can restore the 50-node draft while quarantine/scanning is still pending.
    const before = structuredClone(full);
    expect(nativeImageAttachmentStatus(full, attachment)).toBe("full");
    expect(attachNativeImage(full, attachment)).toBe(full);
    expect(full).toEqual(before);
    const attached = attachNativeImage(withSpace, attachment);
    expect(nativeImageAttachmentStatus(attached, attachment)).toBe("attached");
    const block = attached.blocks[0]!;
    if (block.kind !== "content" || !block.scene) throw new Error("fixture");
    expect(block.scene.nodes).toHaveLength(PRESENTATION_SCENE_MAX_NODES);
    expect(block.scene.nodes.at(-1)).toMatchObject({
      id: attachment.nodeId,
      type: "image",
      mediaId: attachment.mediaId,
      altText: attachment.altText,
    });
    expect(block.scene.readingOrder.at(-1)).toBe(attachment.nodeId);
    expect(block.speakerNotes).toBe("Private notes");
    expect(PresentationDraftSchema.safeParse(attached).success).toBe(true);
  });

  it("waits for a removed or converted target and never redirects to another selected slide", () => {
    const { input: full, attachment } = fullDraft();
    const target = full.blocks[0]!;
    if (target.kind !== "content" || !target.scene) throw new Error("fixture");
    const other = createNativeContentBlock();
    const removed = { ...full, blocks: [other] };
    expect(nativeImageAttachmentStatus(removed, attachment)).toBe("missing");
    expect(attachNativeImage(removed, attachment)).toBe(removed);
    const converted = { ...full, blocks: [{ ...target, scene: undefined }, other] };
    expect(nativeImageAttachmentStatus(converted, attachment)).toBe("missing");
    expect(attachNativeImage(converted, attachment)).toBe(converted);
    const restored = {
      ...full,
      blocks: [other, { ...target, scene: removeNativeNode(target.scene, "extra-49") }],
    };
    const attached = attachNativeImage(restored, attachment);
    expect(attached.blocks[0]).toBe(other);
    expect(nativeImageAttachmentStatus(attached, attachment)).toBe("attached");
  });

  it("is pure under updater replay and idempotent after attachment", () => {
    const input = draft();
    const attachment: NativeImageAttachment = {
      blockId: input.blocks[0]!.id,
      nodeId: "stable-image",
      mediaId: "11111111-1111-4111-8111-111111111111",
      altText: "Scanned diagram",
    };
    const before = structuredClone(input);
    const first = attachNativeImage(input, attachment);
    const replay = attachNativeImage(input, attachment);
    expect(first).toEqual(replay);
    expect(input).toEqual(before);
    expect(attachNativeImage(first, attachment)).toBe(first);
    const target = first.blocks[0]!;
    if (target.kind !== "content" || !target.scene) throw new Error("fixture");
    expect(target.scene.nodes.filter((node) => node.id === attachment.nodeId)).toHaveLength(1);
    expect(target.scene.readingOrder.filter((id) => id === attachment.nodeId)).toHaveLength(1);
  });

  it("does not overwrite an existing object with the upload's ID", () => {
    const input = draft();
    const attachment: NativeImageAttachment = {
      blockId: input.blocks[0]!.id,
      nodeId: "title",
      mediaId: "11111111-1111-4111-8111-111111111111",
      altText: "Scanned diagram",
    };
    expect(nativeImageAttachmentStatus(input, attachment)).toBe("conflict");
    expect(attachNativeImage(input, attachment)).toBe(input);
  });
});
