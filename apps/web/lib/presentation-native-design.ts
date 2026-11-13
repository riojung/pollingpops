import {
  PresentationSceneDraftSchema,
  type PresentationScene,
  type PresentationSceneDesign,
  type PresentationSceneFrame,
  type PresentationSceneNode,
} from "@openround/contracts";
import { boundNativeSceneFrame } from "./presentation-native-scene";
import {
  moveNativeSceneNodes,
  nativeSceneSelectionUnits,
  selectedNativeSceneBounds,
} from "./presentation-native-geometry";

export const NATIVE_DESIGN_THEMES = {
  paper: { background: "#fffdf7", text: "#172b4d", link: "#174d8c", border: "#a6b0ba" },
  midnight: { background: "#111b2e", text: "#f6f8ff", link: "#99d8ff", border: "#657796" },
  ocean: { background: "#eaf8fa", text: "#113945", link: "#145678", border: "#78aab2" },
  sunset: { background: "#fff0e5", text: "#522a20", link: "#873722", border: "#bc8f7b" },
} as const;

export const NATIVE_DESIGN_FONTS = {
  sans: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  serif: 'Georgia, "Times New Roman", serif',
  mono: 'ui-monospace, "SFMono-Regular", Consolas, "Liberation Mono", monospace',
} as const;

export const INITIAL_NATIVE_DESIGN: PresentationSceneDesign = {
  theme: "paper",
  font: "sans",
  spacing: "relaxed",
};

/** Explicit design writes opt into their feature version; reads preserve historical scenes. */
export function applyNativeSceneDesign(
  scene: PresentationScene,
  design: PresentationSceneDesign,
): PresentationScene {
  return PresentationSceneDraftSchema.parse({
    ...scene,
    schemaVersion: Math.max(scene.schemaVersion, design.motionBackground ? 8 : 3),
    design,
  });
}

type FramedNode = Exclude<PresentationSceneNode, { type: "connector" }>;
export const NATIVE_LAYOUT_PRESETS = [
  { id: "title_body", label: "Title and body", help: "Requires a title and one body text object." },
  { id: "split", label: "Split text", help: "Requires a title and two body text objects." },
  {
    id: "image_left",
    label: "Image left",
    help: "Requires a title, one body text object and one image.",
  },
  {
    id: "image_right",
    label: "Image right",
    help: "Requires a title, one body text object and one image.",
  },
  {
    id: "three_columns",
    label: "Three columns",
    help: "Requires a title and three body text objects.",
  },
  { id: "title_data", label: "Title and data", help: "Requires a title and one table or chart." },
] as const;
export type NativeLayoutPreset = (typeof NATIVE_LAYOUT_PRESETS)[number]["id"];

function layoutFrames(
  scene: PresentationScene,
  preset: NativeLayoutPreset,
): Map<string, PresentationSceneFrame> | null {
  const ordered = scene.readingOrder.flatMap((id) => {
    const node = scene.nodes.find((node) => node.id === id);
    return node && node.type !== "connector" ? [node] : [];
  });
  const titles = ordered.filter((node) => node.type === "text" && node.role === "title");
  const bodies = ordered.filter((node) => node.type === "text" && node.role === "body");
  const images = ordered.filter((node) => node.type === "image");
  const data = ordered.filter((node) => node.type === "table" || node.type === "chart");
  if (preset === "title_data") {
    return titles.length === 1 && data.length === 1 && ordered.length === 2
      ? new Map([
          [titles[0]!.id, { x: 7, y: 7, width: 86, height: 20 }],
          [data[0]!.id, { x: 7, y: 33, width: 86, height: 59 }],
        ])
      : null;
  }
  const bodyCount = preset === "three_columns" ? 3 : preset === "split" ? 2 : 1;
  const imageCount = preset === "image_left" || preset === "image_right" ? 1 : 0;
  if (
    titles.length !== 1 ||
    bodies.length !== bodyCount ||
    images.length !== imageCount ||
    ordered.length !== 1 + bodyCount + imageCount
  )
    return null;
  const frames = new Map<string, PresentationSceneFrame>([
    [titles[0]!.id, { x: 7, y: 7, width: 86, height: 20 }],
  ]);
  if (imageCount) {
    const imageX = preset === "image_left" ? 7 : 53;
    const bodyX = preset === "image_left" ? 53 : 7;
    frames.set(images[0]!.id, { x: imageX, y: 33, width: 40, height: 59 });
    frames.set(bodies[0]!.id, { x: bodyX, y: 33, width: 40, height: 59 });
  } else {
    const gap = 5;
    const width = (86 - gap * (bodyCount - 1)) / bodyCount;
    bodies.forEach((node, index) =>
      frames.set(node.id, {
        x: 7 + index * (width + gap),
        y: 33,
        width,
        height: 59,
      }),
    );
  }
  return frames;
}

export function canApplyNativeLayout(scene: PresentationScene, preset: NativeLayoutPreset) {
  return layoutFrames(scene, preset) !== null;
}

/** Only frames change: content, rich text, IDs, reading order and connector references survive. */
export function applyNativeLayout(
  scene: PresentationScene,
  preset: NativeLayoutPreset,
): PresentationScene {
  const frames = layoutFrames(scene, preset);
  if (!frames) return scene;
  return {
    ...scene,
    nodes: scene.nodes.map((node) =>
      node.type === "connector"
        ? node
        : {
            ...node,
            frame: boundNativeSceneFrame(frames.get(node.id)!),
          },
    ),
  };
}

export type NativeAlignment = "left" | "center" | "right" | "top" | "middle" | "bottom";
export type NativeDistribution = "horizontal" | "vertical";

function alignmentResult(
  scene: PresentationScene,
  ids: readonly string[],
  alignment: NativeAlignment,
): PresentationScene | null {
  const nodes = nativeSceneSelectionUnits(scene, ids);
  if (nodes.length < 2) return null;
  const left = Math.min(...nodes.map((node) => node.bounds.x));
  const right = Math.max(...nodes.map((node) => node.bounds.x + node.bounds.width));
  const top = Math.min(...nodes.map((node) => node.bounds.y));
  const bottom = Math.max(...nodes.map((node) => node.bounds.y + node.bounds.height));
  let possible = true;
  const result = nodes.reduce((current, { ids, bounds: frame }) => {
    const x =
      alignment === "left"
        ? left
        : alignment === "right"
          ? right - frame.width
          : alignment === "center"
            ? (left + right - frame.width) / 2
            : frame.x;
    const y =
      alignment === "top"
        ? top
        : alignment === "bottom"
          ? bottom - frame.height
          : alignment === "middle"
            ? (top + bottom - frame.height) / 2
            : frame.y;
    const next = moveNativeSceneNodes(current, ids, x - frame.x, y - frame.y);
    const actual = selectedNativeSceneBounds(next, ids)!;
    if (Math.abs(actual.x - x) > 1e-7 || Math.abs(actual.y - y) > 1e-7) possible = false;
    return next;
  }, scene);
  return possible ? result : null;
}

export function canAlignNativeSceneNodes(
  scene: PresentationScene,
  ids: readonly string[],
  alignment: NativeAlignment,
) {
  return alignmentResult(scene, ids, alignment) !== null;
}

export function alignNativeSceneNodes(
  scene: PresentationScene,
  ids: readonly string[],
  alignment: NativeAlignment,
): PresentationScene {
  return alignmentResult(scene, ids, alignment) ?? scene;
}

function distributionFrames(
  scene: PresentationScene,
  ids: readonly string[],
  axis: NativeDistribution,
) {
  const position = axis === "horizontal" ? "x" : "y";
  const size = axis === "horizontal" ? "width" : "height";
  const nodes = nativeSceneSelectionUnits(scene, ids).sort(
    (a, b) => a.bounds[position] - b.bounds[position] || a.ids[0]!.localeCompare(b.ids[0]!, "en"),
  );
  if (nodes.length < 3) return null;
  const first = nodes[0]!;
  const last = nodes.at(-1)!;
  const start = first.bounds[position];
  const end = last.bounds[position] + last.bounds[size];
  const occupied = nodes.reduce((total, node) => total + node.bounds[size], 0);
  const gap = (end - start - occupied) / (nodes.length - 1);
  // Keep both outer objects fixed. Reject layouts that would require negative gaps.
  if (gap < 0 || !Number.isFinite(gap)) return null;
  let cursor = start;
  const changes = nodes.map((node, index) => {
    const delta = index === 0 || index === nodes.length - 1 ? 0 : cursor - node.bounds[position];
    cursor += node.bounds[size] + gap;
    return { ids: node.ids, dx: position === "x" ? delta : 0, dy: position === "y" ? delta : 0 };
  });
  if (
    changes.some((unit, index) => {
      const next = moveNativeSceneNodes(scene, unit.ids, unit.dx, unit.dy);
      const actual = selectedNativeSceneBounds(next, unit.ids)!;
      return (
        Math.abs(actual.x - (nodes[index]!.bounds.x + unit.dx)) > 1e-7 ||
        Math.abs(actual.y - (nodes[index]!.bounds.y + unit.dy)) > 1e-7
      );
    })
  )
    return null;
  return changes;
}

export function canDistributeNativeSceneNodes(
  scene: PresentationScene,
  ids: readonly string[],
  axis: NativeDistribution,
) {
  return distributionFrames(scene, ids, axis) !== null;
}

export function distributeNativeSceneNodes(
  scene: PresentationScene,
  ids: readonly string[],
  axis: NativeDistribution,
): PresentationScene {
  const frames = distributionFrames(scene, ids, axis);
  return frames
    ? frames.reduce(
        (current, unit) => moveNativeSceneNodes(current, unit.ids, unit.dx, unit.dy),
        scene,
      )
    : scene;
}

export type NativeLayerAction = "back" | "backward" | "forward" | "front";

function layerUnits(scene: PresentationScene) {
  const framed = scene.nodes.filter((node): node is FramedNode => node.type !== "connector");
  const seen = new Set<string>();
  return framed.flatMap((node) => {
    if (seen.has(node.id)) return [];
    const ids = scene.groups?.find((group) => group.nodeIds.includes(node.id))?.nodeIds ?? [
      node.id,
    ];
    const unit = framed.filter((item) => ids.includes(item.id));
    unit.forEach((item) => seen.add(item.id));
    return [unit];
  });
}

export function canLayerNativeSceneNode(
  scene: PresentationScene,
  id: string,
  action: NativeLayerAction,
) {
  const nodes = layerUnits(scene);
  const index = nodes.findIndex((unit) => unit.some((node) => node.id === id));
  return (
    index >= 0 &&
    (action === "back" || action === "backward" ? index > 0 : index < nodes.length - 1)
  );
}

/** Stacking order lives in nodes; semantic reading order remains entirely independent. */
export function layerNativeSceneNode(
  scene: PresentationScene,
  id: string,
  action: NativeLayerAction,
): PresentationScene {
  if (!canLayerNativeSceneNode(scene, id, action)) return scene;
  const units = layerUnits(scene);
  const index = units.findIndex((unit) => unit.some((node) => node.id === id));
  const destination =
    action === "back"
      ? 0
      : action === "front"
        ? units.length - 1
        : index + (action === "backward" ? -1 : 1);
  const [unit] = units.splice(index, 1);
  units.splice(destination, 0, unit!);
  const framed = units.flat();
  let cursor = 0;
  return {
    ...scene,
    nodes: scene.nodes.map((node) => (node.type === "connector" ? node : framed[cursor++]!)),
  };
}
