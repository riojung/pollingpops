import {
  PresentationSceneDraftSchema,
  type PresentationScene,
  type PresentationSceneDesign,
  type PresentationSceneFrame,
  type PresentationSceneNode,
} from "@openround/contracts";
import { boundNativeSceneFrame } from "./presentation-native-scene";

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

/** An explicit action opts into version 3; existing scenes are never normalized on read. */
export function applyNativeSceneDesign(
  scene: PresentationScene,
  design: PresentationSceneDesign,
): PresentationScene {
  return PresentationSceneDraftSchema.parse({ ...scene, schemaVersion: 3, design });
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

function selectedFrames(scene: PresentationScene, ids: readonly string[]) {
  const selected = new Set(ids);
  return scene.nodes.filter(
    (node): node is FramedNode => node.type !== "connector" && selected.has(node.id),
  );
}

function withFrames(scene: PresentationScene, frames: Map<string, PresentationSceneFrame>) {
  return {
    ...scene,
    nodes: scene.nodes.map((node) =>
      node.type !== "connector" && frames.has(node.id)
        ? { ...node, frame: boundNativeSceneFrame(frames.get(node.id)!) }
        : node,
    ),
  };
}

export function alignNativeSceneNodes(
  scene: PresentationScene,
  ids: readonly string[],
  alignment: NativeAlignment,
): PresentationScene {
  const nodes = selectedFrames(scene, ids);
  if (nodes.length < 2) return scene;
  const left = Math.min(...nodes.map((node) => node.frame.x));
  const right = Math.max(...nodes.map((node) => node.frame.x + node.frame.width));
  const top = Math.min(...nodes.map((node) => node.frame.y));
  const bottom = Math.max(...nodes.map((node) => node.frame.y + node.frame.height));
  return withFrames(
    scene,
    new Map(
      nodes.map(({ id, frame }) => [
        id,
        {
          ...frame,
          x:
            alignment === "left"
              ? left
              : alignment === "right"
                ? right - frame.width
                : alignment === "center"
                  ? (left + right - frame.width) / 2
                  : frame.x,
          y:
            alignment === "top"
              ? top
              : alignment === "bottom"
                ? bottom - frame.height
                : alignment === "middle"
                  ? (top + bottom - frame.height) / 2
                  : frame.y,
        },
      ]),
    ),
  );
}

function distributionFrames(
  scene: PresentationScene,
  ids: readonly string[],
  axis: NativeDistribution,
) {
  const position = axis === "horizontal" ? "x" : "y";
  const size = axis === "horizontal" ? "width" : "height";
  const nodes = selectedFrames(scene, ids).sort(
    (a, b) => a.frame[position] - b.frame[position] || a.id.localeCompare(b.id, "en"),
  );
  if (nodes.length < 3) return null;
  const first = nodes[0]!;
  const last = nodes.at(-1)!;
  const start = first.frame[position];
  const end = last.frame[position] + last.frame[size];
  const occupied = nodes.reduce((total, node) => total + node.frame[size], 0);
  const gap = (end - start - occupied) / (nodes.length - 1);
  // Keep both outer objects fixed. Reject layouts that would require negative gaps.
  if (gap < 0 || !Number.isFinite(gap)) return null;
  let cursor = start;
  return new Map(
    nodes.map((node, index) => {
      const frame =
        index === 0 || index === nodes.length - 1
          ? node.frame
          : { ...node.frame, [position]: cursor };
      cursor += node.frame[size] + gap;
      return [node.id, frame] as const;
    }),
  );
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
  return frames ? withFrames(scene, frames) : scene;
}

export type NativeLayerAction = "back" | "backward" | "forward" | "front";

export function canLayerNativeSceneNode(
  scene: PresentationScene,
  id: string,
  action: NativeLayerAction,
) {
  const nodes = scene.nodes.filter((node) => node.type !== "connector");
  const index = nodes.findIndex((node) => node.id === id);
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
  const framed = scene.nodes.filter((node) => node.type !== "connector");
  const index = framed.findIndex((node) => node.id === id);
  const destination =
    action === "back"
      ? 0
      : action === "front"
        ? framed.length - 1
        : index + (action === "backward" ? -1 : 1);
  const [node] = framed.splice(index, 1);
  framed.splice(destination, 0, node!);
  let cursor = 0;
  return {
    ...scene,
    nodes: scene.nodes.map((node) => (node.type === "connector" ? node : framed[cursor++]!)),
  };
}
