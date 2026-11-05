import {
  presentationScenePaintedBounds,
  PRESENTATION_SCENE_GEOMETRY_EPSILON,
  type PresentationScene,
  type PresentationSceneFrame,
  type PresentationSceneNode,
} from "@openround/contracts";
import { clientUuid } from "./uuid";

type FramedNode = Exclude<PresentationSceneNode, { type: "connector" }>;

/** Image edits preserve each attached hotspot's relative position and size. */
export function synchronizeNativeHotspots(
  before: PresentationScene,
  next: PresentationScene,
): PresentationScene {
  return {
    ...next,
    nodes: next.nodes.map((node) => {
      if (node.type !== "hotspot" || !node.imageNodeId) return node;
      const original = before.nodes.find((item) => item.id === node.id);
      const oldImage = before.nodes.find((item) => item.id === node.imageNodeId);
      const image = next.nodes.find((item) => item.id === node.imageNodeId);
      if (
        original?.type !== "hotspot" ||
        original.imageNodeId !== node.imageNodeId ||
        oldImage?.type !== "image" ||
        image?.type !== "image" ||
        JSON.stringify(oldImage.frame) === JSON.stringify(image.frame)
      )
        return node;
      const width = Math.min(
        image.frame.width,
        Math.max(1, (original.frame.width * image.frame.width) / oldImage.frame.width),
      );
      const height = Math.min(
        image.frame.height,
        Math.max(1, (original.frame.height * image.frame.height) / oldImage.frame.height),
      );
      return {
        ...node,
        frame: {
          x: Math.max(
            image.frame.x,
            Math.min(
              image.frame.x + image.frame.width - width,
              image.frame.x +
                ((original.frame.x - oldImage.frame.x) * image.frame.width) / oldImage.frame.width,
            ),
          ),
          y: Math.max(
            image.frame.y,
            Math.min(
              image.frame.y + image.frame.height - height,
              image.frame.y +
                ((original.frame.y - oldImage.frame.y) * image.frame.height) /
                  oldImage.frame.height,
            ),
          ),
          width,
          height,
        },
      };
    }),
  };
}

/** A stored group always selects and transforms as one unit; reading order stays independent. */
export function expandNativeSceneSelection(scene: PresentationScene, ids: readonly string[]) {
  const existing = new Set(scene.nodes.map((node) => node.id));
  const requested = [...new Set(ids.filter((id) => existing.has(id)))];
  const selected = new Set(requested);
  for (const group of scene.groups ?? []) {
    if (group.nodeIds.some((id) => selected.has(id)))
      group.nodeIds.forEach((id) => selected.add(id));
  }
  return [
    ...scene.readingOrder.filter((id) => selected.has(id) && !requested.includes(id)),
    ...requested,
  ];
}

export function nativeNodePaintedBounds(node: FramedNode): PresentationSceneFrame {
  return node.rotation ? presentationScenePaintedBounds(node.frame, node.rotation) : node.frame;
}

function unionBounds(frames: PresentationSceneFrame[]): PresentationSceneFrame | null {
  if (!frames.length) return null;
  const x = Math.min(...frames.map((frame) => frame.x));
  const y = Math.min(...frames.map((frame) => frame.y));
  return {
    x,
    y,
    width: Math.max(...frames.map((frame) => frame.x + frame.width)) - x,
    height: Math.max(...frames.map((frame) => frame.y + frame.height)) - y,
  };
}

/** Arrangement treats each persistent group as a rectangle, preserving its internal layout. */
export function nativeSceneSelectionUnits(scene: PresentationScene, ids: readonly string[]) {
  const selected = new Set(expandNativeSceneSelection(scene, ids));
  const seen = new Set<string>();
  const units: { ids: string[]; bounds: PresentationSceneFrame }[] = [];
  for (const id of scene.readingOrder) {
    const node = scene.nodes.find((item) => item.id === id);
    if (!node || node.type === "connector" || !selected.has(id) || seen.has(id)) continue;
    const members = scene.groups?.find((group) => group.nodeIds.includes(id))?.nodeIds ?? [id];
    const nodes = scene.nodes.filter(
      (item): item is FramedNode => item.type !== "connector" && members.includes(item.id),
    );
    const bounds = unionBounds(nodes.map(nativeNodePaintedBounds))!;
    nodes.forEach((item) => seen.add(item.id));
    units.push({ ids: nodes.map((item) => item.id), bounds });
  }
  return units;
}

export function groupNativeSceneNodes(
  scene: PresentationScene,
  ids: readonly string[],
  groupId = clientUuid(),
): PresentationScene {
  const units = nativeSceneSelectionUnits(scene, ids);
  if (units.length < 2) return scene;
  const members = new Set(units.flatMap((unit) => unit.ids));
  return {
    ...scene,
    schemaVersion: scene.schemaVersion >= 4 ? scene.schemaVersion : 4,
    groups: [
      ...(scene.groups ?? []).filter((group) => !group.nodeIds.some((id) => members.has(id))),
      { id: groupId, nodeIds: scene.readingOrder.filter((id) => members.has(id)) },
    ],
  };
}

export function ungroupNativeSceneNodes(scene: PresentationScene, ids: readonly string[]) {
  const selected = new Set(ids);
  const groups = scene.groups?.filter((group) => !group.nodeIds.some((id) => selected.has(id)));
  return groups?.length === scene.groups?.length ? scene : { ...scene, groups };
}

function selectedFramedNodes(scene: PresentationScene, ids: readonly string[]): FramedNode[] {
  const selected = new Set(expandNativeSceneSelection(scene, ids));
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
  return unionBounds(nodes.map(nativeNodePaintedBounds));
}

/** Move the selection with one shared translation so objects cannot drift apart at an edge. */
export function moveNativeSceneNodes(
  scene: PresentationScene,
  ids: readonly string[],
  dx: number,
  dy: number,
): PresentationScene {
  if (!Number.isFinite(dx) || !Number.isFinite(dy) || (!dx && !dy)) return scene;
  const selected = selectedFramedNodes(scene, ids);
  if (selected.length === 0) return scene;
  // Raw frames remain bounded by the scene contract as well as their rotated paint.
  // Clamp once for the whole selection so a narrow rotated footprint cannot split a group.
  const frames = selected.flatMap((node) =>
    node.rotation
      ? [
          { frame: node.frame, tolerance: 0 },
          { frame: nativeNodePaintedBounds(node), tolerance: PRESENTATION_SCENE_GEOMETRY_EPSILON },
        ]
      : [{ frame: node.frame, tolerance: 0 }],
  );
  function translation(position: "x" | "y", size: "width" | "height", delta: number) {
    const lower = frames.map(({ frame, tolerance }) => -frame[position] - tolerance);
    const upper = frames.map(
      ({ frame, tolerance }) => 100 - (frame[position] + frame[size]) + tolerance,
    );
    const minimum = Math.max(...lower);
    const maximum = Math.min(...upper);
    let amount = Math.max(minimum, Math.min(delta, maximum));
    // Leave a little of the rotated contract's epsilon unused: the final addition and trig
    // calculation can otherwise round a nominal -epsilon just outside the accepted boundary.
    if (
      amount < 0 &&
      amount === minimum &&
      frames.some((frame, index) => frame.tolerance > 0 && lower[index] === minimum)
    )
      amount = Math.min(0, amount + PRESENTATION_SCENE_GEOMETRY_EPSILON / 4);
    if (
      amount > 0 &&
      amount === maximum &&
      frames.some((frame, index) => frame.tolerance > 0 && upper[index] === maximum)
    )
      amount = Math.max(0, amount - PRESENTATION_SCENE_GEOMETRY_EPSILON / 4);
    return amount;
  }
  const translationX = translation("x", "width", dx);
  const translationY = translation("y", "height", dy);
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
  return changed ? synchronizeNativeHotspots(scene, { ...scene, nodes }) : scene;
}

/** Resize from the bottom-right corner without moving the node's top-left anchor. */
export function resizeNativeSceneNode(
  scene: PresentationScene,
  id: string,
  dx: number,
  dy: number,
): PresentationScene {
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return scene;
  const target = scene.nodes.find((node) => node.id === id);
  if (!target || target.type === "connector" || (!dx && !dy)) return scene;
  const group = scene.groups?.find((group) => group.nodeIds.includes(id));
  if (group) return resizeNativeSceneGroup(scene, group.nodeIds, dx, dy);
  if (target.rotation) return resizeRotatedNode(scene, target, dx, dy);
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
  return changed ? synchronizeNativeHotspots(scene, { ...scene, nodes }) : scene;
}

/** Keep the required title, and remove all connectors whose actual endpoint is being removed. */
export function removeNativeSceneNodes(
  scene: PresentationScene,
  ids: readonly string[],
): PresentationScene {
  const selected = new Set(expandNativeSceneSelection(scene, ids));
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
    nodes: scene.nodes
      .filter((node) => !removed.has(node.id))
      .map((node) =>
        node.type === "hotspot" && node.imageNodeId && removed.has(node.imageNodeId)
          ? { ...node, imageNodeId: null }
          : node,
      ),
    readingOrder: scene.readingOrder.filter((id) => !removed.has(id)),
    ...(scene.groups
      ? {
          groups: scene.groups
            .map((group) => ({
              ...group,
              nodeIds: group.nodeIds.filter((id) => !removed.has(id)),
            }))
            .filter((group) => group.nodeIds.length >= 2),
        }
      : {}),
  };
}

function fits(node: FramedNode) {
  const frame = node.frame;
  const bounds = nativeNodePaintedBounds(node);
  return (
    Object.values(frame).every(Number.isFinite) &&
    frame.width >= 1 &&
    frame.height >= 1 &&
    frame.x >= 0 &&
    frame.y >= 0 &&
    frame.x + frame.width <= 100 &&
    frame.y + frame.height <= 100 &&
    bounds.x >= -PRESENTATION_SCENE_GEOMETRY_EPSILON &&
    bounds.y >= -PRESENTATION_SCENE_GEOMETRY_EPSILON &&
    bounds.x + bounds.width <= 100 + PRESENTATION_SCENE_GEOMETRY_EPSILON &&
    bounds.y + bounds.height <= 100 + PRESENTATION_SCENE_GEOMETRY_EPSILON
  );
}

function withNodes(scene: PresentationScene, nodes: FramedNode[]) {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  return synchronizeNativeHotspots(scene, {
    ...scene,
    nodes: scene.nodes.map((node) => byId.get(node.id) ?? node),
  });
}

/** Bound a continuous resize against the stage without evaluating/parsing slide text per move. */
function boundedResize(scene: PresentationScene, candidate: (amount: number) => FramedNode[]) {
  const full = candidate(1);
  if (full.every(fits)) return withNodes(scene, full);
  let low = 0;
  let high = 1;
  for (let index = 0; index < 36; index++) {
    const middle = (low + high) / 2;
    if (candidate(middle).every(fits)) low = middle;
    else high = middle;
  }
  if (low < 1e-9) return scene;
  return withNodes(scene, candidate(Math.max(0, low - 1e-10)));
}

/** Group resizing is proportional, preserving the shapes and angles of every member. */
export function resizeNativeSceneGroup(
  scene: PresentationScene,
  ids: readonly string[],
  dx: number,
  dy: number,
) {
  if (!Number.isFinite(dx) || !Number.isFinite(dy) || (!dx && !dy)) return scene;
  const nodes = selectedFramedNodes(scene, ids);
  const bounds = unionBounds(nodes.map(nativeNodePaintedBounds));
  if (!bounds) return scene;
  const changeX = dx / bounds.width;
  const changeY = dy / bounds.height;
  const requested = 1 + (Math.abs(changeX) >= Math.abs(changeY) ? changeX : changeY);
  const minimum = Math.max(
    ...nodes.map((node) => Math.max(1 / node.frame.width, 1 / node.frame.height)),
  );
  const scale = Math.max(minimum, Math.min(100, requested));
  if (scale === 1) return scene;
  return boundedResize(scene, (amount) => {
    const factor = 1 + (scale - 1) * amount;
    return nodes.map((node) => ({
      ...node,
      frame: {
        x: bounds.x + (node.frame.x - bounds.x) * factor,
        y: bounds.y + (node.frame.y - bounds.y) * factor,
        width: node.frame.width * factor,
        height: node.frame.height * factor,
      },
    }));
  });
}

function resizeRotatedNode(scene: PresentationScene, node: FramedNode, dx: number, dy: number) {
  const angle = ((node.rotation ?? 0) * Math.PI) / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const width = node.frame.width * 16;
  const height = node.frame.height * 9;
  const localDx = dx * 16 * cos + dy * 9 * sin;
  const localDy = -dx * 16 * sin + dy * 9 * cos;
  const targetWidth = Math.max(16, Math.min(1600, width + localDx));
  const targetHeight = Math.max(9, Math.min(900, height + localDy));
  if (targetWidth === width && targetHeight === height) return scene;
  const centerX = (node.frame.x + node.frame.width / 2) * 16;
  const centerY = (node.frame.y + node.frame.height / 2) * 9;
  const anchorX = centerX - (width / 2) * cos + (height / 2) * sin;
  const anchorY = centerY - (width / 2) * sin - (height / 2) * cos;
  return boundedResize(scene, (amount) => {
    const nextWidth = width + (targetWidth - width) * amount;
    const nextHeight = height + (targetHeight - height) * amount;
    const cx = anchorX + (nextWidth / 2) * cos - (nextHeight / 2) * sin;
    const cy = anchorY + (nextWidth / 2) * sin + (nextHeight / 2) * cos;
    return [
      {
        ...node,
        frame: {
          x: (cx - nextWidth / 2) / 16,
          y: (cy - nextHeight / 2) / 9,
          width: nextWidth / 16,
          height: nextHeight / 9,
        },
      },
    ];
  });
}

/** Rotate around the painted selection center, using the slide's actual 16:9 coordinates. */
export function rotateNativeSceneNodes(
  scene: PresentationScene,
  ids: readonly string[],
  degrees: number,
) {
  if (!Number.isFinite(degrees) || degrees % 360 === 0) return scene;
  const nodes = selectedFramedNodes(scene, ids);
  const bounds = unionBounds(nodes.map(nativeNodePaintedBounds));
  if (!bounds) return scene;
  const px = (bounds.x + bounds.width / 2) * 16;
  const py = (bounds.y + bounds.height / 2) * 9;
  const angle = (degrees * Math.PI) / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const rotated = nodes.map((node) => {
    const x = (node.frame.x + node.frame.width / 2) * 16 - px;
    const y = (node.frame.y + node.frame.height / 2) * 9 - py;
    const cx = px + x * cos - y * sin;
    const cy = py + x * sin + y * cos;
    return {
      ...node,
      rotation: (((((node.rotation ?? 0) + degrees + 180) % 360) + 360) % 360) - 180,
      frame: {
        ...node.frame,
        x: cx / 16 - node.frame.width / 2,
        y: cy / 9 - node.frame.height / 2,
      },
    };
  });
  if (!rotated.every(fits)) return scene;
  return {
    ...withNodes(scene, rotated),
    schemaVersion: scene.schemaVersion >= 4 ? scene.schemaVersion : (4 as const),
  };
}

export type NativeSnapGuide = { axis: "x" | "y"; position: number };

/** Screen-distance snapping is transient; no guide or tolerance is serialized into a draft. */
export function snapNativeSceneMove(
  scene: PresentationScene,
  ids: readonly string[],
  dx: number,
  dy: number,
  stageWidth: number,
  stageHeight: number,
  thresholdPixels = 6,
): { scene: PresentationScene; guides: NativeSnapGuide[] } {
  const moved = moveNativeSceneNodes(scene, ids, dx, dy);
  const bounds = selectedNativeSceneBounds(moved, ids);
  if (!bounds || stageWidth <= 0 || stageHeight <= 0) return { scene: moved, guides: [] };
  const selected = new Set(expandNativeSceneSelection(scene, ids));
  const targets = scene.nodes
    .filter((node): node is FramedNode => node.type !== "connector" && !selected.has(node.id))
    .map(nativeNodePaintedBounds);
  const guides: NativeSnapGuide[] = [];
  let result = moved;
  for (const axis of ["x", "y"] as const) {
    const size = axis === "x" ? "width" : "height";
    const threshold = (thresholdPixels * 100) / (axis === "x" ? stageWidth : stageHeight);
    const starts = [bounds[axis], bounds[axis] + bounds[size] / 2, bounds[axis] + bounds[size]];
    const stops = [
      50,
      0,
      100,
      ...targets.flatMap((frame) => [
        frame[axis],
        frame[axis] + frame[size] / 2,
        frame[axis] + frame[size],
      ]),
    ];
    let match: { delta: number; position: number; anchor: number } | null = null;
    for (const stop of stops)
      for (const [anchor, start] of starts.entries()) {
        const delta = stop - start;
        if (Math.abs(delta) <= threshold && (!match || Math.abs(delta) < Math.abs(match.delta)))
          match = { delta, position: stop, anchor };
      }
    if (!match) continue;
    result = moveNativeSceneNodes(
      result,
      ids,
      axis === "x" ? match.delta : 0,
      axis === "y" ? match.delta : 0,
    );
    const actual = selectedNativeSceneBounds(result, ids)!;
    const anchor =
      actual[axis] +
      (match.anchor === 0 ? 0 : match.anchor === 1 ? actual[size] / 2 : actual[size]);
    if (Math.abs(anchor - match.position) < 1e-7) guides.push({ axis, position: match.position });
  }
  return { scene: result, guides };
}
