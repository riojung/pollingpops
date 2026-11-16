import {
  type PresentationScene,
  type PresentationSceneDesign,
  type PresentationSceneFrame,
  type PresentationSceneNode,
} from "@openround/contracts";
import { canFitDesignTextAtSize, createDesignComposer } from "./presentation-design-composer";
import type {
  DesignLayoutId,
  PresentationDesignId,
  PresentationDesignSlideCopy,
} from "./presentation-designs";

type TextNode = Extract<PresentationSceneNode, { type: "text" }>;
type FramedNode = Exclude<PresentationSceneNode, { type: "connector" }>;
type Slot = { frame: PresentationSceneFrame; typography?: TextNode["typography"] };
type CompositionFactory = (
  family: PresentationDesignId,
  layout: DesignLayoutId,
  copy: PresentationDesignSlideCopy,
  createId: () => string,
) => PresentationSceneNode[];

// Probe copy is used only to identify the native composition's authored regions. None of these
// nodes or words enter the result: only empty decorative shapes, frames and typography do.
const probes = {
  body: "__design_slot_body__",
  eyebrow: "__design_slot_eyebrow__",
  leftTitle: "__design_slot_left_title__",
  leftBody: "__design_slot_left_body__",
  rightTitle: "__design_slot_right_title__",
  rightBody: "__design_slot_right_body__",
  imageLabel: "__design_slot_image__",
  metricLabel: "__design_slot_metric_label__",
  metricValue: "↗",
};

function orderedContent(scene: PresentationScene) {
  const referenced = new Set(scene.groups?.flatMap((group) => group.nodeIds) ?? []);
  for (const node of scene.nodes) {
    if (node.type === "connector") {
      referenced.add(node.from.nodeId);
      referenced.add(node.to.nodeId);
    } else if (node.type === "hotspot" && node.imageNodeId) referenced.add(node.imageNodeId);
  }
  const removable = new Set(
    scene.nodes
      .filter(
        (node) =>
          node.type === "shape" &&
          node.decorative &&
          !node.label.trim() &&
          !referenced.has(node.id),
      )
      .map((node) => node.id),
  );
  const byId = new Map(scene.nodes.map((node) => [node.id, node]));
  return {
    removable,
    nodes: scene.readingOrder.flatMap((id) => {
      const node = byId.get(id);
      return node && !removable.has(id) ? [node] : [];
    }),
  };
}

/** Graphs and imported canvases keep their exact geometry rather than guessing at semantics. */
export function canReflowPresentationDesign(scene: PresentationScene, visualImport = false) {
  if (visualImport || scene.groups?.length) return false;
  const content = orderedContent(scene).nodes;
  if (
    content.some((node) => node.type === "image") &&
    content.some((node) => node.type === "table" || node.type === "chart")
  )
    return false;
  return (
    content.length <= 10 &&
    content.every(
      (node) =>
        (node.type === "text" ||
          node.type === "image" ||
          node.type === "table" ||
          node.type === "chart" ||
          (node.type === "shape" && Boolean(node.label.trim()))) &&
        (!node.rotation || node.rotation === 0),
    )
  );
}

function union(slots: Slot[]): Slot {
  const x = Math.min(...slots.map((slot) => slot.frame.x));
  const y = Math.min(...slots.map((slot) => slot.frame.y));
  return {
    frame: {
      x,
      y,
      width: Math.max(...slots.map((slot) => slot.frame.x + slot.frame.width)) - x,
      height: Math.max(...slots.map((slot) => slot.frame.y + slot.frame.height)) - y,
    },
    typography: slots.at(-1)?.typography,
  };
}

function grid(region: Slot, count: number): Slot[] {
  if (!count) return [];
  if (count === 1) return [region];
  // Wider regions become columns; narrow image captions become rows. Every authored object
  // gets its own region, including labelled native shapes and additional body paragraphs.
  const columns = region.frame.width >= 36 ? Math.min(count, count > 4 ? 3 : 2) : 1;
  const rows = Math.ceil(count / columns);
  const gap = 2;
  const width = (region.frame.width - gap * (columns - 1)) / columns;
  const height = (region.frame.height - gap * (rows - 1)) / rows;
  return Array.from({ length: count }, (_, index) => ({
    frame: {
      x: region.frame.x + (index % columns) * (width + gap),
      y: region.frame.y + Math.floor(index / columns) * (height + gap),
      width,
      height,
    },
    typography: region.typography,
  }));
}

function fittedTypography(node: TextNode, slot: Slot, spacing: PresentationSceneDesign["spacing"]) {
  const composer = createDesignComposer(
    { title: "", body: "" },
    () => node.id,
    spacing === "compact" ? 5 : 10,
  );
  const { size = node.role === "title" ? 54 : 25, ...typography } = slot.typography ?? {};
  const { x, y, width, height } = slot.frame;
  const paragraphs = node.role === "body" ? node.richText?.paragraphs : undefined;
  const listInset = paragraphs?.some((paragraph) => paragraph.kind !== "paragraph")
    ? size * 1.5
    : 0;
  const paragraphGap = paragraphs
    ? paragraphs.length * size * (spacing === "compact" ? 0.25 : 0.55)
    : 0;
  // Plain fallback text preserves paragraph breaks. Reserve the rich renderer's additional
  // paragraph margins and list indentation for measurement without rewriting any authored runs.
  const fits = composer.text(
    node.text,
    [x, y, Math.max(1, width - listInset / 12.8), Math.max(1, height - paragraphGap / 7.2)],
    size,
    typography,
  );
  if (fits === false) return null;
  const fitted = composer.nodes[0];
  return {
    ...node.typography,
    ...(fitted?.type === "text" ? fitted.typography : { size, ...typography }),
  };
}

function selectLayout(
  nodes: PresentationSceneNode[],
  position: { first: boolean; last: boolean },
): DesignLayoutId {
  if (nodes.some((node) => node.type === "table" || node.type === "chart")) return "data";
  const image = nodes.find((node) => node.type === "image");
  if (image?.type === "image")
    return image.frame.x + image.frame.width / 2 < 50 ? "image_left" : "image_right";
  if (position.first) return "cover";
  if (position.last) return "closing";
  if (nodes.length === 1) return "section";
  return nodes.length > 2 ? "split" : "body";
}

/** Apply real family artwork and content regions without replacing authored objects with samples. */
export function reflowPresentationDesign(
  scene: PresentationScene,
  options: {
    blockId: string;
    family: PresentationDesignId;
    design: PresentationSceneDesign;
    first: boolean;
    last: boolean;
    compose: CompositionFactory;
  },
): PresentationScene {
  const { removable, nodes: content } = orderedContent(scene);
  const title = content.find(
    (node): node is TextNode => node.type === "text" && node.role === "title",
  )!;
  const layout = selectLayout(content, options);
  let sequence = 0;
  const recipe = options.compose(
    options.family,
    layout,
    {
      title: title.text,
      ...probes,
      dataCaption: "__design_slot_table__",
      dataHeaders: ["__design_slot_header__", "__design_slot_value__"],
      dataRows: [[probes.metricLabel, probes.metricValue]],
    },
    () => `slot:${sequence++}`,
  );
  const textSlot = (value: string): Slot | undefined => {
    const node = recipe.find(
      (node) => node.type === "text" && node.role === "body" && node.text === value,
    );
    return node?.type === "text" ? { frame: node.frame, typography: node.typography } : undefined;
  };
  const recipeTitle = recipe.find((node) => node.type === "text" && node.role === "title");
  if (recipeTitle?.type !== "text") return scene;
  const body = textSlot(probes.body);
  const eyebrow = textSlot(probes.eyebrow);
  const left = [textSlot(probes.leftTitle), textSlot(probes.leftBody)].filter(
    (slot): slot is Slot => Boolean(slot),
  );
  const right = [textSlot(probes.rightTitle), textSlot(probes.rightBody)].filter(
    (slot): slot is Slot => Boolean(slot),
  );
  const metric = [textSlot(probes.metricValue), textSlot(probes.metricLabel)].filter(
    (slot): slot is Slot => Boolean(slot),
  );
  const image = recipe.find(
    (node): node is Extract<PresentationSceneNode, { type: "shape" }> =>
      node.type === "shape" && !node.decorative,
  );
  const data = recipe.find((node) => node.type === "table");
  const regions = [
    ...(body ? [body] : []),
    ...(left.length ? [union(left)] : []),
    ...(right.length ? [union(right)] : []),
    ...(metric.length ? [union(metric)] : []),
    ...(image ? [{ frame: image.frame }] : []),
    ...(data ? [{ frame: data.frame }] : []),
  ];
  // A section may have no body copy slot; its eyebrow remains separate from the title.
  const region: Slot = {
    ...(regions.length
      ? union(regions)
      : (eyebrow ?? { frame: { x: 7, y: 72, width: 80, height: 18 } })),
    typography: body?.typography ??
      left.at(-1)?.typography ??
      metric.at(-1)?.typography ?? {
        size: 25,
        font: options.design.font,
        color: recipeTitle.typography?.color ?? "text",
      },
  };
  const assignments = new Map<string, Slot>([
    [title.id, { frame: recipeTitle.frame, typography: recipeTitle.typography }],
  ]);
  const smallType = new Set<string>();
  const recipeFolio = recipe.find(
    (node) =>
      node.type === "text" && /^\d{2}$/u.test(node.text) && (node.typography?.size ?? 30) <= 18,
  );
  let usedFolio = false;
  let usedEyebrow = false;
  // Authored eyebrows and page markers reuse family regions without inventing new wording.
  for (const node of content) {
    if (node.type !== "text" || node.role === "title" || (node.typography?.size ?? 30) > 18)
      continue;
    const numeric = /^\d{1,3}$/u.test(node.text.trim());
    // A folio can move between a footer and an upper corner. Style-only font changes remove
    // its mono override, so an inherited font also qualifies at the exact 14px folio size.
    const marker =
      numeric &&
      (node.typography?.font === "mono" ||
        (node.typography?.font === undefined && node.typography?.size === 14)) &&
      node.typography.align === "right" &&
      node.frame.width <= 13 &&
      node.frame.height <= 6 &&
      (node.frame.y >= 80 || (node.frame.y <= 16 && node.frame.x >= 80));
    if (marker && recipeFolio?.type === "text" && !usedFolio) {
      assignments.set(node.id, { frame: recipeFolio.frame, typography: recipeFolio.typography });
      smallType.add(node.id);
      usedFolio = true;
    } else if (!numeric && node.frame.y < 25 && eyebrow && !usedEyebrow) {
      assignments.set(node.id, eyebrow);
      smallType.add(node.id);
      usedEyebrow = true;
    }
  }
  const remaining = content.filter((node) => !assignments.has(node.id)) as FramedNode[];
  const images = remaining.filter((node) => node.type === "image");
  const tables = remaining.filter((node) => node.type === "table" || node.type === "chart");
  const extras = remaining.filter(
    (node) => node.type !== "image" && node.type !== "table" && node.type !== "chart",
  );
  if (images.length && !tables.length && image && body) {
    grid({ frame: image.frame }, images.length).forEach((slot, index) =>
      assignments.set(images[index]!.id, slot),
    );
    grid(body, extras.length).forEach((slot, index) => assignments.set(extras[index]!.id, slot));
  } else if (tables.length && !images.length && data) {
    const metricRegion = metric.length ? union(metric) : undefined;
    grid(extras.length ? { frame: data.frame } : region, tables.length).forEach((slot, index) =>
      assignments.set(tables[index]!.id, slot),
    );
    const numeric = extras.find(
      (node) => node.type === "text" && /^[\d\s.,%+−–—$€£¥()-]+$/u.test(node.text),
    );
    if (numeric && extras.length === 2 && metric.length === 2) {
      assignments.set(numeric.id, metric[0]!);
      assignments.set(extras.find((node) => node !== numeric)!.id, metric[1]!);
    } else if (metricRegion)
      grid(metricRegion, extras.length).forEach((slot, index) =>
        assignments.set(extras[index]!.id, slot),
      );
    else
      grid(region, remaining.length).forEach((slot, index) =>
        assignments.set(remaining[index]!.id, slot),
      );
  } else if (left.length && right.length && remaining.length >= 2) {
    const boundary = Math.ceil(remaining.length / 2);
    for (const [column, items] of [
      [union(left), remaining.slice(0, boundary)],
      [union(right), remaining.slice(boundary)],
    ] as const) {
      grid(column, items.length).forEach((slot, index) => assignments.set(items[index]!.id, slot));
    }
  } else {
    grid(region, remaining.length).forEach((slot, index) =>
      assignments.set(remaining[index]!.id, slot),
    );
  }
  if (
    [...assignments.entries()].some(
      ([id, { frame, typography }]) =>
        !smallType.has(id) &&
        (frame.width < 10 || (frame.height < 8 && (typography?.size ?? 25) > 20)),
    )
  )
    return scene;
  // Validate every assigned text region and fixed-size shape label before changing any
  // frames or decoration. A label cannot use the editable text renderer's shrink loop.
  const fittedText = new Map<string, TextNode["typography"]>();
  for (const node of content) {
    const slot = assignments.get(node.id);
    if (!slot) continue;
    if (node.type === "shape" && node.label.trim()) {
      const { x, y, width, height } = slot.frame;
      // CSS normal whitespace collapses ASCII whitespace; NBSP and full-width spaces
      // remain measurable glyphs. Shape spans use 85% width and inherit the family font.
      if (
        !canFitDesignTextAtSize(
          node.label.replace(/[ \t\r\n\f]+/gu, " ").replace(/^ +| +$/gu, ""),
          [x, y, width * 0.85, height],
          22,
          {
            font: options.design.font,
            leading: 1.35,
          },
        )
      )
        return scene;
    }
    if (node.type !== "text") continue;
    const typography = fittedTypography(node, slot, options.design.spacing);
    if (!typography) return scene;
    fittedText.set(node.id, typography);
  }
  const meaningful = scene.nodes
    .filter((node) => !removable.has(node.id))
    .map((node) => {
      const slot = assignments.get(node.id);
      if (!slot || node.type === "connector") return node;
      if (node.type === "text")
        return {
          ...node,
          frame: slot.frame,
          typography: fittedText.get(node.id),
        };
      if (node.type === "shape")
        return {
          ...node,
          frame: slot.frame,
          appearance: { ...node.appearance, fill: "surface" as const },
        };
      return { ...node, frame: slot.frame };
    });
  const usedIds = new Set([
    ...meaningful.map((node) => node.id),
    ...(scene.groups?.map((group) => group.id) ?? []),
  ]);
  const decoration = recipe.flatMap((node, index) => {
    if (node.type !== "shape" || !node.decorative || node.label) return [];
    const base = `design:${options.blockId}:${options.family}:${layout}:${index}`;
    let id = base;
    for (let collision = 1; usedIds.has(id); collision++) id = `${base}:${collision}`;
    usedIds.add(id);
    return [{ ...node, id }];
  });
  return {
    ...scene,
    schemaVersion: 9,
    design: options.design,
    nodes: [...decoration, ...meaningful],
    readingOrder: [
      ...scene.readingOrder.filter((id) => !removable.has(id)),
      ...decoration.map((node) => node.id),
    ],
  };
}
