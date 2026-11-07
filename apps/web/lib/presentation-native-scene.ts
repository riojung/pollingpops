import {
  adaptContentSlideToScene,
  createPresentationDesignScene,
  PRESENTATION_SCENE_MAX_NODES,
  type PresentationDraft,
  type ContentSlideDraft,
  type PresentationScene,
  type PresentationSceneFrame,
  type PresentationSceneNode,
} from "@openround/contracts";
import { clientUuid } from "./uuid";
import { removeNativeSceneNodes, synchronizeNativeHotspots } from "./presentation-native-geometry";

export function createNativeContentBlock(): ContentSlideDraft {
  const titleId = clientUuid();
  return {
    id: clientUuid(),
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
          id: titleId,
          type: "text",
          role: "title",
          text: "",
          frame: { x: 8, y: 8, width: 84, height: 20 },
        },
      ],
      readingOrder: [titleId],
    },
  };
}

export { adaptContentSlideToScene };

/** The visible New slide action starts with design controls and editable title/body content. */
export function createDesignedNativeContentBlock(): ContentSlideDraft {
  const block = createNativeContentBlock();
  return {
    ...block,
    scene: createPresentationDesignScene(block.scene!.nodes[0]!.id, clientUuid()),
  };
}

export function boundNativeSceneFrame(frame: PresentationSceneFrame): PresentationSceneFrame {
  const width = Math.max(1, Math.min(100, frame.width));
  const height = Math.max(1, Math.min(100, frame.height));
  return {
    x: Math.max(0, Math.min(100 - width, frame.x)),
    y: Math.max(0, Math.min(100 - height, frame.y)),
    width,
    height,
  };
}

export function nativeNodeLabel(node: PresentationSceneNode): string {
  if (node.type === "text")
    return node.role === "title" ? "Slide title" : node.text.trim().slice(0, 40) || "Body text";
  if (node.type === "image") return node.altText?.trim() || "Image";
  if (node.type === "shape") return node.label.trim() || `${node.shape.replaceAll("_", " ")} shape`;
  if (node.type === "table") return node.caption.trim() || "Data table";
  if (node.type === "chart") return node.title.trim() || `${node.chartType} chart`;
  if (node.type === "reveal") return node.label.trim() || "Reveal panel";
  if (node.type === "link") return node.label.trim() || "External link";
  if (node.type === "hotspot") return node.label.trim() || "Image hotspot";
  if (node.type === "dialog") return node.label.trim() || "Detail dialog";
  if (node.type === "navigation") return node.label.trim() || "Slide link";
  return node.label.trim() || "Connection";
}

export function createNativeRevealNode(): Extract<PresentationSceneNode, { type: "reveal" }> {
  return {
    id: clientUuid(),
    type: "reveal",
    scope: "local",
    label: "",
    body: "",
    frame: { x: 8, y: 35, width: 50, height: 30 },
  };
}

export function createNativeLinkNode(): Extract<PresentationSceneNode, { type: "link" }> {
  return {
    id: clientUuid(),
    type: "link",
    label: "",
    href: "",
    frame: { x: 62, y: 35, width: 28, height: 14 },
  };
}

export function createNativeDialogNode(): Extract<PresentationSceneNode, { type: "dialog" }> {
  return {
    id: clientUuid(),
    type: "dialog",
    scope: "local",
    label: "",
    detailTitle: "",
    body: "",
    frame: { x: 8, y: 35, width: 45, height: 20 },
  };
}

export function createNativeHotspotNode(
  image?: Extract<PresentationSceneNode, { type: "image" }>,
): Extract<PresentationSceneNode, { type: "hotspot" }> {
  const width = Math.min(12, image?.frame.width ?? 12);
  const height = Math.min(12, image?.frame.height ?? 12);
  return {
    id: clientUuid(),
    type: "hotspot",
    scope: "local",
    imageNodeId: image?.id ?? null,
    label: "",
    detailTitle: "",
    body: "",
    frame: {
      x: image ? image.frame.x + (image.frame.width - width) / 2 : 40,
      y: image ? image.frame.y + (image.frame.height - height) / 2 : 40,
      width,
      height,
    },
  };
}

export function createNativeNavigationNode(): Extract<
  PresentationSceneNode,
  { type: "navigation" }
> {
  return {
    id: clientUuid(),
    type: "navigation",
    label: "",
    targetBlockId: null,
    frame: { x: 62, y: 35, width: 28, height: 14 },
  };
}

export function updateNativeNode(
  scene: PresentationScene,
  id: string,
  update: (node: PresentationSceneNode) => PresentationSceneNode,
): PresentationScene {
  const nodes = scene.nodes.map((node) => (node.id === id ? update(node) : node));
  return synchronizeNativeHotspots(scene, {
    ...scene,
    schemaVersion: nodes.some((node) => node.type === "text" && node.lang !== undefined)
      ? 7
      : scene.schemaVersion,
    nodes,
  });
}

export function removeNativeNode(scene: PresentationScene, id: string): PresentationScene {
  const node = scene.nodes.find((node) => node.id === id);
  if (node?.type === "text" && node.role === "title") return scene;
  return removeNativeSceneNodes(scene, [id]);
}

export function reorderNativeNode(
  scene: PresentationScene,
  id: string,
  offset: -1 | 1,
): PresentationScene {
  const index = scene.readingOrder.indexOf(id);
  const destination = index + offset;
  if (index < 0 || destination < 0 || destination >= scene.readingOrder.length) return scene;
  const readingOrder = [...scene.readingOrder];
  [readingOrder[index], readingOrder[destination]] = [
    readingOrder[destination]!,
    readingOrder[index]!,
  ];
  return { ...scene, readingOrder };
}

export function duplicateNativeScene(scene: PresentationScene): PresentationScene {
  const ids = new Map(scene.nodes.map((node) => [node.id, clientUuid()]));
  return {
    ...scene,
    nodes: scene.nodes.map((node) =>
      node.type === "connector"
        ? {
            ...structuredClone(node),
            id: ids.get(node.id)!,
            from: { ...node.from, nodeId: ids.get(node.from.nodeId)! },
            to: { ...node.to, nodeId: ids.get(node.to.nodeId)! },
          }
        : node.type === "hotspot"
          ? {
              ...structuredClone(node),
              id: ids.get(node.id)!,
              imageNodeId: node.imageNodeId ? (ids.get(node.imageNodeId) ?? null) : null,
            }
          : { ...structuredClone(node), id: ids.get(node.id)! },
    ),
    readingOrder: scene.readingOrder.map((id) => ids.get(id)!),
    ...(scene.groups
      ? {
          groups: scene.groups.map((group) => ({
            id: clientUuid(),
            nodeIds: group.nodeIds.map((id) => ids.get(id)!),
          })),
        }
      : {}),
  };
}

/** A clean upload waiting to join its original slide; never a storage URL or pending draft node. */
export interface NativeImageAttachment {
  blockId: string;
  nodeId: string;
  mediaId: string;
  altText: string;
}

export function nativeImageAttachmentStatus(
  draft: PresentationDraft,
  attachment: NativeImageAttachment,
): "ready" | "attached" | "full" | "missing" | "conflict" {
  const block = draft.blocks.find((candidate) => candidate.id === attachment.blockId);
  if (block?.kind !== "content" || !block.scene) return "missing";
  const existing = block.scene.nodes.find((node) => node.id === attachment.nodeId);
  if (existing) {
    return existing.type === "image" && existing.mediaId === attachment.mediaId
      ? "attached"
      : "conflict";
  }
  return block.scene.nodes.length >= PRESENTATION_SCENE_MAX_NODES ? "full" : "ready";
}

/** Pure and idempotent, including when React replays an updater or history replaces the target. */
export function attachNativeImage(
  draft: PresentationDraft,
  attachment: NativeImageAttachment,
): PresentationDraft {
  if (nativeImageAttachmentStatus(draft, attachment) !== "ready") return draft;
  return {
    ...draft,
    blocks: draft.blocks.map((block) =>
      block.id === attachment.blockId && block.kind === "content" && block.scene
        ? {
            ...block,
            scene: {
              ...block.scene,
              nodes: [
                ...block.scene.nodes,
                {
                  id: attachment.nodeId,
                  type: "image" as const,
                  mediaId: attachment.mediaId,
                  altText: attachment.altText,
                  frame: { x: 55, y: 35, width: 35, height: 45 },
                },
              ],
              readingOrder: [...block.scene.readingOrder, attachment.nodeId],
            },
          }
        : block,
    ),
  };
}
