import {
  adaptContentSlideToScene,
  type ContentSlideDraft,
  type PresentationScene,
  type PresentationSceneFrame,
  type PresentationSceneNode,
} from "@openround/contracts";
import { clientUuid } from "./uuid";

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
  return node.label.trim() || "Connection";
}

export function updateNativeNode(
  scene: PresentationScene,
  id: string,
  update: (node: PresentationSceneNode) => PresentationSceneNode,
): PresentationScene {
  return { ...scene, nodes: scene.nodes.map((node) => (node.id === id ? update(node) : node)) };
}

export function removeNativeNode(scene: PresentationScene, id: string): PresentationScene {
  const node = scene.nodes.find((item) => item.id === id);
  if (!node || (node.type === "text" && node.role === "title")) return scene;
  const removed = new Set(
    scene.nodes
      .filter(
        (item) =>
          item.id === id ||
          (item.type === "connector" && (item.from.nodeId === id || item.to.nodeId === id)),
      )
      .map((item) => item.id),
  );
  return {
    ...scene,
    nodes: scene.nodes.filter((item) => !removed.has(item.id)),
    readingOrder: scene.readingOrder.filter((item) => !removed.has(item)),
  };
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
        : { ...structuredClone(node), id: ids.get(node.id)! },
    ),
    readingOrder: scene.readingOrder.map((id) => ids.get(id)!),
  };
}
