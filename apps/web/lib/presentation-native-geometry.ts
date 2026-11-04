import {
  type PresentationScene,
  type PresentationSceneFrame,
  type PresentationSceneNode,
} from "@openround/contracts";

type FramedNode = Exclude<PresentationSceneNode, { type: "connector" }>;

function selectedFramedNodes(scene: PresentationScene, ids: readonly string[]): FramedNode[] {
  const selected = new Set(ids);
  return scene.nodes.filter(
    (node): node is FramedNode => node.type !== "connector" && selected.has(node.id),
  );
}

/** Bounds only visual nodes; connectors follow their endpoints and have no independent frame. */
export function selectedNativeSceneBounds(
  scene: PresentationScene,
  ids: readonly string[],
): PresentationSceneFrame | null {
  const nodes = selectedFramedNodes(scene, ids);
  if (nodes.length === 0) return null;
  const x = Math.min(...nodes.map((node) => node.frame.x));
  const y = Math.min(...nodes.map((node) => node.frame.y));
  return {
    x,
    y,
    width: Math.max(...nodes.map((node) => node.frame.x + node.frame.width)) - x,
    height: Math.max(...nodes.map((node) => node.frame.y + node.frame.height)) - y,
  };
}

/** Move the selection with one shared translation so objects cannot drift apart at an edge. */
export function moveNativeSceneNodes(
  scene: PresentationScene,
  ids: readonly string[],
  dx: number,
  dy: number,
): PresentationScene {
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return scene;
  const selected = selectedFramedNodes(scene, ids);
  if (selected.length === 0) return scene;
  const translationX = Math.max(
    Math.max(...selected.map((node) => -node.frame.x)),
    Math.min(dx, Math.min(...selected.map((node) => 100 - (node.frame.x + node.frame.width)))),
  );
  const translationY = Math.max(
    Math.max(...selected.map((node) => -node.frame.y)),
    Math.min(dy, Math.min(...selected.map((node) => 100 - (node.frame.y + node.frame.height)))),
  );
  if (translationX === 0 && translationY === 0) return scene;
  const selectedIds = new Set(selected.map((node) => node.id));
  let changed = false;
  const nodes = scene.nodes.map((node) => {
    if (node.type === "connector" || !selectedIds.has(node.id)) return node;
    // Clamp the final addition as well: fractional percentages may otherwise round just past 100.
    const translatedX = Math.max(0, node.frame.x + translationX);
    const translatedY = Math.max(0, node.frame.y + translationY);
    const x = translatedX + node.frame.width > 100 ? 100 - node.frame.width : translatedX;
    const y = translatedY + node.frame.height > 100 ? 100 - node.frame.height : translatedY;
    if (x === node.frame.x && y === node.frame.y) return node;
    changed = true;
    return { ...node, frame: { ...node.frame, x, y } };
  });
  return changed ? { ...scene, nodes } : scene;
}

/** Resize from the bottom-right corner without moving the node's top-left anchor. */
export function resizeNativeSceneNode(
  scene: PresentationScene,
  id: string,
  dx: number,
  dy: number,
): PresentationScene {
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return scene;
  let changed = false;
  const nodes = scene.nodes.map((node) => {
    if (node.id !== id || node.type === "connector") return node;
    const resizedWidth = Math.max(
      1,
      node.frame.width + Math.min(dx, 100 - (node.frame.x + node.frame.width)),
    );
    const resizedHeight = Math.max(
      1,
      node.frame.height + Math.min(dy, 100 - (node.frame.y + node.frame.height)),
    );
    const width = node.frame.x + resizedWidth > 100 ? 100 - node.frame.x : resizedWidth;
    const height = node.frame.y + resizedHeight > 100 ? 100 - node.frame.y : resizedHeight;
    if (width === node.frame.width && height === node.frame.height) return node;
    changed = true;
    return { ...node, frame: { ...node.frame, width, height } };
  });
  return changed ? { ...scene, nodes } : scene;
}

/** Keep the required title, and remove all connectors whose actual endpoint is being removed. */
export function removeNativeSceneNodes(
  scene: PresentationScene,
  ids: readonly string[],
): PresentationScene {
  const selected = new Set(ids);
  const removed = new Set(
    scene.nodes
      .filter((node) => selected.has(node.id) && !(node.type === "text" && node.role === "title"))
      .map((node) => node.id),
  );
  if (removed.size === 0) return scene;
  for (const node of scene.nodes) {
    if (node.type === "connector" && (removed.has(node.from.nodeId) || removed.has(node.to.nodeId)))
      removed.add(node.id);
  }
  return {
    ...scene,
    nodes: scene.nodes.filter((node) => !removed.has(node.id)),
    readingOrder: scene.readingOrder.filter((id) => !removed.has(id)),
  };
}
