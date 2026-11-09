import {
  PresentationSceneDraftSchema,
  type PresentationScene,
  type PresentationSceneFrame,
  type PresentationSceneNode,
} from "@openround/contracts";

export interface NativeLayoutSuggestion {
  id: string;
  label: string;
  description: string;
  scene: PresentationScene;
}

type TextNode = Extract<PresentationSceneNode, { type: "text" }>;
type TableNode = Extract<PresentationSceneNode, { type: "table" }>;
type Targets = { title: TextNode; body: TextNode; table?: TableNode };
type Arrangement = Omit<NativeLayoutSuggestion, "scene"> & {
  frames: ReadonlyMap<string, PresentationSceneFrame>;
};
const frameKeys = ["x", "y", "width", "height"] as const;
const clamp = (value: number, minimum: number, maximum: number) =>
  Math.min(maximum, Math.max(minimum, value));

function targets(scene: PresentationScene): Targets | string {
  if (!PresentationSceneDraftSchema.safeParse(scene).success)
    return "Correct this slide’s invalid native content before reviewing layout alternatives.";
  if (scene.groups?.length)
    return "Layout alternatives are unavailable for grouped objects. Ungroup them first.";
  if (scene.nodes.some((node) => "rotation" in node && (node.rotation ?? 0) !== 0))
    return "Layout alternatives are unavailable for rotated objects. Reset their rotation first.";
  const titles = scene.nodes.filter(
    (node): node is TextNode => node.type === "text" && node.role === "title",
  );
  const bodies = scene.nodes.filter(
    (node): node is TextNode => node.type === "text" && node.role === "body",
  );
  const tables = scene.nodes.filter((node): node is TableNode => node.type === "table");
  if (
    titles.length !== 1 ||
    bodies.length !== 1 ||
    tables.length > 1 ||
    scene.nodes.length !== 2 + tables.length
  )
    return "Use exactly one title and one body text object, with an optional table, to review layout alternatives.";
  return { title: titles[0]!, body: bodies[0]!, table: tables[0] };
}

/** Content density guides space and ordering; it cannot establish rendered text or table fit. */
function headingHeight(title: TextNode) {
  const lines = title.text.split(/\r\n|\r|\n/u).length;
  return clamp(18 + Math.max(0, Math.ceil(title.text.length / 55) - 1, lines - 1) * 6, 18, 30);
}
function leadDensity(body: TextNode) {
  return Math.ceil(body.text.length / 80) + body.text.split(/\r\n|\r|\n/u).length - 1;
}
function textArrangements({ title, body }: Targets): Arrangement[] {
  const heading = headingHeight(title),
    compact = Math.max(14, heading - 6);
  const layouts: Arrangement[] = [
    {
      id: "text-roomy",
      label: "Wide text",
      description: "Uses most of the slide width for the body beneath a separate heading band.",
      frames: new Map([
        [title.id, { x: 6, y: 5, width: 88, height: heading }],
        [body.id, { x: 6, y: heading + 11, width: 88, height: 83 - heading }],
      ]),
    },
    {
      id: "text-compact",
      label: "More room for the body",
      description: "Reserves a shallower heading band and a larger body frame.",
      frames: new Map([
        [title.id, { x: 7, y: 5, width: 86, height: compact }],
        [body.id, { x: 7, y: compact + 9, width: 86, height: 86 - compact }],
      ]),
    },
    {
      id: "text-focus",
      label: "Focused reading column",
      description: "Centers a narrower body column beneath the heading.",
      frames: new Map([
        [title.id, { x: 13, y: 7, width: 74, height: heading }],
        [body.id, { x: 17, y: heading + 14, width: 66, height: 79 - heading }],
      ]),
    },
  ];
  const order =
    title.text.length > 100 || /[\r\n]/u.test(title.text)
      ? ["text-roomy", "text-focus", "text-compact"]
      : leadDensity(body) > 8
        ? ["text-compact", "text-roomy", "text-focus"]
        : leadDensity(body) <= 3
          ? ["text-focus", "text-roomy", "text-compact"]
          : ["text-roomy", "text-compact", "text-focus"];
  return order.map((id) => layouts.find((layout) => layout.id === id)!);
}
function tableArrangements({ title, body, table }: Targets & { table: TableNode }): Arrangement[] {
  const heading = headingHeight(title),
    density = leadDensity(body);
  const balancedLead = clamp(16 + density * 2, 16, 24);
  const textLead = clamp(24 + density * 2, 24, 34);
  const compact = Math.max(14, heading - 4),
    dataLead = clamp(12 + density, 12, 18);
  const arrangements: Array<{
    id: string;
    label: string;
    description: string;
    heading: number;
    lead: number;
    gap: number;
  }> = [
    {
      id: "table-balanced",
      label: "Balanced lead and table",
      description: "Stacks a separate heading, lead text and wide table with space between them.",
      heading,
      lead: balancedLead,
      gap: 5,
    },
    {
      id: "table-text-first",
      label: "Emphasize the lead",
      description: "Gives the lead text more vertical space and places the table below it.",
      heading,
      lead: textLead,
      gap: 5,
    },
    {
      id: "table-data-first",
      label: "Emphasize the table",
      description:
        "Uses compact heading and lead bands to reserve more vertical space for the table.",
      heading: compact,
      lead: dataLead,
      gap: 4,
    },
  ];
  const layouts = arrangements.map(({ heading: height, lead, gap, ...layout }): Arrangement => {
    const bodyY = height + 10,
      tableY = bodyY + lead + gap;
    return {
      ...layout,
      frames: new Map([
        [title.id, { x: 7, y: 5, width: 86, height }],
        [body.id, { x: 7, y: bodyY, width: 86, height: lead }],
        [table.id, { x: 7, y: tableY, width: 86, height: 95 - tableY }],
      ]),
    };
  });
  const cellCharacters = [...table.headers, ...table.rows.flat()].reduce(
    (sum, cell) => sum + cell.length,
    0,
  );
  const tableDense = table.rows.length >= 7 || table.headers.length >= 4 || cellCharacters >= 700;
  const order =
    density > 7 && !tableDense
      ? ["table-text-first", "table-balanced", "table-data-first"]
      : tableDense
        ? ["table-data-first", "table-balanced", "table-text-first"]
        : ["table-balanced", "table-data-first", "table-text-first"];
  return order.map((id) => layouts.find((layout) => layout.id === id)!);
}
function sameFrames(left: PresentationScene, right: PresentationScene) {
  return left.nodes.every((node, index) => {
    const other = right.nodes[index];
    return (
      "frame" in node &&
      other &&
      "frame" in other &&
      frameKeys.every((key) => Math.abs(node.frame[key] - other.frame[key]) <= 1e-7)
    );
  });
}
function separateFrames(frames: readonly PresentationSceneFrame[]) {
  return frames.every((frame, index) =>
    frames
      .slice(index + 1)
      .every(
        (other) =>
          frame.x + frame.width <= other.x ||
          other.x + other.width <= frame.x ||
          frame.y + frame.height <= other.y ||
          other.y + other.height <= frame.y,
      ),
  );
}
function review(scene: PresentationScene): {
  suggestions: NativeLayoutSuggestion[];
  reason: string | null;
} {
  const selected = targets(scene);
  if (typeof selected === "string") return { suggestions: [], reason: selected };
  const arrangements = selected.table
    ? tableArrangements({ ...selected, table: selected.table })
    : textArrangements(selected);
  const suggestions: NativeLayoutSuggestion[] = [];
  for (const { frames, ...arrangement } of arrangements) {
    // Keep the author’s exact source fields. Parsing is validation only, never normalization.
    const candidate: PresentationScene = {
      ...scene,
      nodes: scene.nodes.map((node) => ({ ...node, frame: { ...frames.get(node.id)! } })),
    };
    if (
      !PresentationSceneDraftSchema.safeParse(candidate).success ||
      !separateFrames([...frames.values()]) ||
      sameFrames(scene, candidate) ||
      suggestions.some((suggestion) => sameFrames(suggestion.scene, candidate))
    )
      continue;
    suggestions.push({ ...arrangement, scene: candidate });
  }
  return {
    suggestions,
    reason: suggestions.length
      ? null
      : "These alternatives exceed the slide’s limits. Reduce its content before trying again.",
  };
}

export function nativeLayoutSuggestionAvailability(scene: PresentationScene): {
  supported: boolean;
  reason: string | null;
} {
  const result = review(scene);
  return { supported: result.suggestions.length > 0, reason: result.reason };
}

/** Bounded local alternatives: no provider, saved proposal, source rewrite or automatic mutation. */
export function suggestNativeLayouts(scene: PresentationScene): NativeLayoutSuggestion[] {
  return review(scene).suggestions;
}
