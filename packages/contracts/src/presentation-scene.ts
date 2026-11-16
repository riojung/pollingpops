import { z } from "zod";
import { PresentationTextLanguageSchema } from "./presentation-languages";
import { CanvasColorSchema, CanvasShapeVariantSchema } from "./canvas-content-v4";
import {
  isSafePresentationLink,
  PresentationRichTextSchema,
  presentationRichTextToPlainText,
} from "./presentation-rich-text";

/** Scene versions opt into Presentation document v4, v5, v7, v8, v11, v13, v16, v17 and v18 respectively. */
export const PRESENTATION_SCENE_SCHEMA_VERSION = 1 as const;
export const PRESENTATION_RICH_TEXT_SCENE_SCHEMA_VERSION = 2 as const;
export const PRESENTATION_DESIGN_SCENE_SCHEMA_VERSION = 3 as const;
export const PRESENTATION_COMPOSITION_SCENE_SCHEMA_VERSION = 4 as const;
export const PRESENTATION_INTERACTION_SCENE_SCHEMA_VERSION = 5 as const;
export const PRESENTATION_ADVANCED_INTERACTION_SCENE_SCHEMA_VERSION = 6 as const;
export const PRESENTATION_LANGUAGE_SCENE_SCHEMA_VERSION = 7 as const;
export const PRESENTATION_MOTION_BACKGROUND_SCENE_SCHEMA_VERSION = 8 as const;
export const PRESENTATION_MOTION_BACKGROUND_DOCUMENT_SCHEMA_VERSION = 17 as const;
export const PRESENTATION_STYLED_SCENE_SCHEMA_VERSION = 9 as const;
export const PRESENTATION_STYLED_DOCUMENT_SCHEMA_VERSION = 18 as const;
export const PRESENTATION_SCENE_GEOMETRY_EPSILON = 1e-8;
export const PRESENTATION_SCENE_MAX_NODES = 50;
export const PRESENTATION_SCENE_MAX_BYTES = 128 * 1024;

/** Built-in decoration only; omission keeps the existing static background. */
export const PRESENTATION_MOTION_BACKGROUND_PRESETS = [
  "aurora",
  "waves",
  "orbs",
  "mesh",
  "ribbons",
  "stars",
] as const;
export const PresentationMotionBackgroundSchema = z.enum(PRESENTATION_MOTION_BACKGROUND_PRESETS);
export type PresentationMotionBackground = z.infer<typeof PresentationMotionBackgroundSchema>;

/** Complete, closed contrast palettes. No CSS, font URLs or arbitrary paint strings enter a scene. */
export const PRESENTATION_DESIGN_PALETTES = {
  default: {
    background: "#ffffff",
    text: "#171717",
    link: "#174d8c",
    border: "#b4b4b4",
    accent: "#171717",
    accentText: "#ffffff",
    muted: "#595959",
    surface: "#ededed",
  },
  ink: {
    background: "#111827",
    text: "#f8fafc",
    link: "#b6d7ff",
    border: "#60718b",
    accent: "#c7f36b",
    accentText: "#17200d",
    muted: "#bec8d8",
    surface: "#253248",
  },
  clay: {
    background: "#f4e9dd",
    text: "#38281f",
    link: "#813820",
    border: "#b59b85",
    accent: "#9a422c",
    accentText: "#fff9f1",
    muted: "#6e5646",
    surface: "#e5d3c0",
  },
  coral: {
    background: "#ff634e",
    text: "#251a19",
    link: "#351d1a",
    border: "#843f35",
    accent: "#251a19",
    accentText: "#fff7ef",
    muted: "#47231f",
    surface: "#ff9989",
  },
  forest: {
    background: "#12392e",
    text: "#f4f4df",
    link: "#c6e7aa",
    border: "#779789",
    accent: "#e1ee9c",
    accentText: "#193326",
    muted: "#c0d2c3",
    surface: "#285342",
  },
  cobalt: {
    background: "#1847c5",
    text: "#ffffff",
    link: "#f4efac",
    border: "#91a8ed",
    accent: "#f5ef83",
    accentText: "#18255b",
    muted: "#d5e0ff",
    surface: "#315cd1",
  },
  rose: {
    background: "#f3dce3",
    text: "#412b39",
    link: "#71334e",
    border: "#b68e9d",
    accent: "#793b57",
    accentText: "#fff7fa",
    muted: "#735665",
    surface: "#e6bfce",
  },
  sand: {
    background: "#f2eee4",
    text: "#292c27",
    link: "#47552d",
    border: "#b1b3a1",
    accent: "#52633b",
    accentText: "#ffffff",
    muted: "#626457",
    surface: "#e2dfd2",
  },
} as const;
export const PresentationDesignPaletteSchema = z.enum([
  "default",
  "ink",
  "clay",
  "coral",
  "forest",
  "cobalt",
  "rose",
  "sand",
]);
export type PresentationDesignPalette = z.infer<typeof PresentationDesignPaletteSchema>;
export type PresentationDesignPaletteColors = {
  [K in keyof typeof PRESENTATION_DESIGN_PALETTES.default]: string;
};

export const PresentationSceneTypographySchema = z
  .object({
    size: z.number().finite().min(12).max(144).optional(),
    weight: z
      .union([
        z.literal(400),
        z.literal(500),
        z.literal(600),
        z.literal(700),
        z.literal(800),
        z.literal(900),
      ])
      .optional(),
    align: z.enum(["left", "center", "right"]).optional(),
    font: z.enum(["sans", "serif", "mono"]).optional(),
    color: z.enum(["text", "accent", "muted", "background", "accentText"]).optional(),
    leading: z.number().finite().min(0.85).max(1.8).optional(),
  })
  .strict();
export type PresentationSceneTypography = z.infer<typeof PresentationSceneTypographySchema>;
export const PresentationSceneShapeAppearanceSchema = z
  .object({
    fill: z
      .enum(["accent", "accentText", "text", "background", "muted", "surface", "none"])
      .optional(),
    stroke: z.enum(["accent", "accentText", "text", "background", "muted", "none"]).optional(),
    strokeWidth: z.number().finite().min(0).max(6).optional(),
  })
  .strict();
export type PresentationSceneShapeAppearance = z.infer<
  typeof PresentationSceneShapeAppearanceSchema
>;

/** Named, closed design tokens; omission preserves the scene's established appearance. */
export const PresentationSceneDesignSchema = z
  .object({
    theme: z.enum(["paper", "midnight", "ocean", "sunset"]),
    palette: PresentationDesignPaletteSchema.optional(),
    font: z.enum(["sans", "serif", "mono"]),
    spacing: z.enum(["relaxed", "compact"]),
    motionBackground: PresentationMotionBackgroundSchema.optional(),
  })
  .strict();
export type PresentationSceneDesign = z.infer<typeof PresentationSceneDesignSchema>;

/** Legacy colors remain byte-for-byte stable when a named palette is omitted. */
export function presentationDesignPalette(
  design?: PresentationSceneDesign,
): PresentationDesignPaletteColors {
  if (design?.palette) return PRESENTATION_DESIGN_PALETTES[design.palette];
  const theme = design?.theme;
  const base =
    theme === "paper"
      ? { background: "#fffdf7", text: "#172b4d", link: "#174d8c", border: "#a6b0ba" }
      : theme === "midnight"
        ? { background: "#111b2e", text: "#f6f8ff", link: "#99d8ff", border: "#657796" }
        : theme === "ocean"
          ? { background: "#eaf8fa", text: "#113945", link: "#145678", border: "#78aab2" }
          : theme === "sunset"
            ? { background: "#fff0e5", text: "#522a20", link: "#873722", border: "#bc8f7b" }
            : { background: "#fff", text: "#102a43", link: "#145da0", border: "#cbd5e1" };
  return {
    ...base,
    accent: base.link,
    accentText: base.background,
    muted: base.text,
    surface: base.background,
  };
}

export const PresentationSceneImageFitSchema = z.enum(["contain", "cover"]);
export type PresentationSceneImageFit = z.infer<typeof PresentationSceneImageFitSchema>;

/** Percentages within the source image, used only by a cover crop. */
export const PresentationSceneFocalPointSchema = z
  .object({
    x: z.number().finite().min(0).max(100),
    y: z.number().finite().min(0).max(100),
  })
  .strict();
export type PresentationSceneFocalPoint = z.infer<typeof PresentationSceneFocalPointSchema>;

function hasControlCharacters(value: string, allowTextWhitespace = false) {
  return Array.from(value).some((character) => {
    const code = character.codePointAt(0)!;
    return code === 127 || (code < 32 && !(allowTextWhitespace && [9, 10, 13].includes(code)));
  });
}

const identifier = z
  .string()
  .min(1)
  .max(200)
  .refine((value) => value.trim().length > 0 && !hasControlCharacters(value), {
    message: "Use a nonblank stable identifier without control characters",
  });
const plainText = (maximum: number) =>
  z
    .string()
    .max(maximum)
    .refine((value) => !hasControlCharacters(value, true), {
      message: "Use plain text without control characters",
    });

/** Finite percentages within a fixed slide, independent of Canvas world coordinates. */
export const PresentationSceneFrameSchema = z
  .object({
    x: z.number().finite().min(0).max(100),
    y: z.number().finite().min(0).max(100),
    width: z.number().finite().min(1).max(100),
    height: z.number().finite().min(1).max(100),
  })
  .strict()
  .superRefine((frame, context) => {
    if (frame.x + frame.width > 100) {
      context.addIssue({
        code: "custom",
        path: ["width"],
        message: "Keep the node inside the slide width",
      });
    }
    if (frame.y + frame.height > 100) {
      context.addIssue({
        code: "custom",
        path: ["height"],
        message: "Keep the node inside the slide height",
      });
    }
  });
export type PresentationSceneFrame = z.infer<typeof PresentationSceneFrameSchema>;

/** Painted axis-aligned bounds in slide percentages, rotating in the physical 16:9 plane. */
export function presentationScenePaintedBounds(
  frame: PresentationSceneFrame,
  rotation = 0,
): PresentationSceneFrame {
  if (rotation === 0) return { ...frame };
  const angle = (rotation * Math.PI) / 180;
  const width =
    Math.abs(frame.width * Math.cos(angle)) + Math.abs((frame.height * 9 * Math.sin(angle)) / 16);
  const height =
    Math.abs(frame.height * Math.cos(angle)) + Math.abs((frame.width * 16 * Math.sin(angle)) / 9);
  return {
    x: frame.x + (frame.width - width) / 2,
    y: frame.y + (frame.height - height) / 2,
    width,
    height,
  };
}

function applyPaintedBounds(
  node: { frame: PresentationSceneFrame; rotation?: number },
  context: z.RefinementCtx,
) {
  if (node.rotation === undefined) return;
  const bounds = presentationScenePaintedBounds(node.frame, node.rotation);
  if (
    !Object.values(bounds).every(Number.isFinite) ||
    bounds.x < -PRESENTATION_SCENE_GEOMETRY_EPSILON ||
    bounds.y < -PRESENTATION_SCENE_GEOMETRY_EPSILON ||
    bounds.x + bounds.width > 100 + PRESENTATION_SCENE_GEOMETRY_EPSILON ||
    bounds.y + bounds.height > 100 + PRESENTATION_SCENE_GEOMETRY_EPSILON
  ) {
    context.addIssue({
      code: "custom",
      path: ["rotation"],
      message: "Keep the rotated object inside the slide",
    });
  }
}

const framedNode = {
  id: identifier,
  frame: PresentationSceneFrameSchema,
  rotation: z.number().finite().min(-180).max(180).optional(),
};
const textNode = z
  .object({
    ...framedNode,
    type: z.literal("text"),
    role: z.enum(["title", "body"]),
    text: plainText(4_000),
    richText: PresentationRichTextSchema.optional(),
    typography: PresentationSceneTypographySchema.optional(),
    lang: PresentationTextLanguageSchema.optional(),
  })
  .strict()
  .superRefine((node, context) => {
    applyPaintedBounds(node, context);
    if (node.role === "title" && node.text.length > 160) {
      context.addIssue({
        code: "custom",
        path: ["text"],
        message: "Slide titles support at most 160 characters",
      });
    }
    if (node.richText && presentationRichTextToPlainText(node.richText) !== node.text) {
      context.addIssue({
        code: "custom",
        path: ["text"],
        message: "Plain text must exactly match the formatted text content",
      });
    }
    if (
      node.role === "title" &&
      node.richText?.paragraphs.some((paragraph) => paragraph.kind !== "paragraph")
    ) {
      context.addIssue({
        code: "custom",
        path: ["richText"],
        message: "Slide titles use paragraphs rather than lists",
      });
    }
  });
const imageNode = z
  .object({
    ...framedNode,
    type: z.literal("image"),
    // Match PostgreSQL UUID canonicalization for memory authorization and retention lookups.
    // This is an authorization reference, never an unrestricted URL or storage path.
    mediaId: z.string().uuid().toLowerCase(),
    altText: plainText(300).nullable(),
    fit: PresentationSceneImageFitSchema.optional(),
    focalPoint: PresentationSceneFocalPointSchema.optional(),
  })
  .strict()
  .superRefine((node, context) => {
    applyPaintedBounds(node, context);
    if ("focalPoint" in node && node.fit !== "cover") {
      context.addIssue({
        code: "custom",
        path: ["focalPoint"],
        message: "Image focal points require cover fit",
      });
    }
  });
const shapeNode = z
  .object({
    ...framedNode,
    type: z.literal("shape"),
    shape: z.enum([...CanvasShapeVariantSchema.options, "ellipse", "diamond", "parallelogram"]),
    color: CanvasColorSchema,
    label: plainText(200),
    appearance: PresentationSceneShapeAppearanceSchema.optional(),
    decorative: z.boolean().optional(),
  })
  .strict()
  .superRefine(applyPaintedBounds);

export const PresentationSceneTableNodeSchema = z
  .object({
    ...framedNode,
    type: z.literal("table"),
    caption: plainText(160),
    headers: z.array(plainText(120)).min(1).max(6),
    rows: z
      .array(z.array(plainText(300)).min(1).max(6))
      .min(1)
      .max(20),
  })
  .strict()
  .superRefine((node, context) => {
    applyPaintedBounds(node, context);
    for (const [index, row] of node.rows.entries()) {
      if (row.length !== node.headers.length) {
        context.addIssue({
          code: "custom",
          path: ["rows", index],
          message: "Every table row must match the header count",
        });
      }
    }
  });
export type PresentationSceneTableNode = z.infer<typeof PresentationSceneTableNodeSchema>;

export const PresentationSceneChartNodeSchema = z
  .object({
    ...framedNode,
    type: z.literal("chart"),
    chartType: z.enum(["bar", "line", "pie"]),
    title: plainText(160),
    summary: plainText(800),
    categories: z.array(plainText(80)).min(1).max(20),
    series: z
      .array(
        z
          .object({
            name: plainText(80),
            values: z.array(z.number().finite().min(-1e12).max(1e12)).min(1).max(20),
          })
          .strict(),
      )
      .min(1)
      .max(4),
  })
  .strict()
  .superRefine((node, context) => {
    applyPaintedBounds(node, context);
    for (const [index, series] of node.series.entries()) {
      if (series.values.length !== node.categories.length) {
        context.addIssue({
          code: "custom",
          path: ["series", index, "values"],
          message: "Each chart series must match the category count",
        });
      }
    }
    if (node.chartType === "pie") {
      if (
        node.series.length !== 1 ||
        node.series.some((series) => series.values.some((value) => value < 0)) ||
        node.series[0]!.values.reduce((sum, value) => sum + value, 0) <= 0
      ) {
        context.addIssue({
          code: "custom",
          path: ["series"],
          message: "Pie charts require one nonnegative series with a positive total",
        });
      }
    }
  });
export type PresentationSceneChartNode = z.infer<typeof PresentationSceneChartNodeSchema>;

/** Public audience content; reveal state belongs only to the local viewer. */
export const PresentationSceneRevealNodeSchema = z
  .object({
    ...framedNode,
    type: z.literal("reveal"),
    scope: z.enum(["local", "broadcast"]),
    label: plainText(120),
    body: plainText(4_000),
  })
  .strict()
  .superRefine(applyPaintedBounds);
export type PresentationSceneRevealNode = z.infer<typeof PresentationSceneRevealNodeSchema>;

export const PresentationSceneLinkNodeSchema = z
  .object({
    ...framedNode,
    type: z.literal("link"),
    label: plainText(120),
    href: z
      .string()
      .max(2_048)
      .refine((value) => value === "" || isSafePresentationLink(value), {
        message: "Use an absolute HTTP or HTTPS link without credentials or whitespace",
      }),
  })
  .strict()
  .superRefine(applyPaintedBounds);
export type PresentationSceneLinkNode = z.infer<typeof PresentationSceneLinkNodeSchema>;

export const PresentationSceneHotspotNodeSchema = z
  .object({
    ...framedNode,
    type: z.literal("hotspot"),
    imageNodeId: identifier.nullable(),
    scope: z.literal("local"),
    label: plainText(120),
    detailTitle: plainText(160),
    body: plainText(4_000),
  })
  .strict()
  .superRefine(applyPaintedBounds);
export type PresentationSceneHotspotNode = z.infer<typeof PresentationSceneHotspotNodeSchema>;
export const PresentationSceneDialogNodeSchema = z
  .object({
    ...framedNode,
    type: z.literal("dialog"),
    scope: z.literal("local"),
    label: plainText(120),
    detailTitle: plainText(160),
    body: plainText(4_000),
  })
  .strict()
  .superRefine(applyPaintedBounds);
export type PresentationSceneDialogNode = z.infer<typeof PresentationSceneDialogNodeSchema>;
export const PresentationSceneNavigationNodeSchema = z
  .object({
    ...framedNode,
    type: z.literal("navigation"),
    label: plainText(120),
    targetBlockId: z.string().uuid().nullable(),
  })
  .strict()
  .superRefine(applyPaintedBounds);
export type PresentationSceneNavigationNode = z.infer<typeof PresentationSceneNavigationNodeSchema>;

export const PresentationSceneGroupSchema = z
  .object({ id: identifier, nodeIds: z.array(identifier).min(2).max(PRESENTATION_SCENE_MAX_NODES) })
  .strict()
  .superRefine((group, context) => {
    if (new Set(group.nodeIds).size !== group.nodeIds.length) {
      context.addIssue({
        code: "custom",
        path: ["nodeIds"],
        message: "Group members must be distinct",
      });
    }
  });
export type PresentationSceneGroup = z.infer<typeof PresentationSceneGroupSchema>;
const endpoint = z
  .object({
    nodeId: identifier,
    anchor: z.enum(["center", "top", "right", "bottom", "left"]),
  })
  .strict();
const connectorNode = z
  .object({
    id: identifier,
    type: z.literal("connector"),
    from: endpoint,
    to: endpoint,
    label: plainText(200),
    color: CanvasColorSchema,
  })
  .strict();

export const PresentationSceneNodeSchema = z.discriminatedUnion("type", [
  textNode,
  imageNode,
  shapeNode,
  connectorNode,
  PresentationSceneTableNodeSchema,
  PresentationSceneChartNodeSchema,
  PresentationSceneRevealNodeSchema,
  PresentationSceneLinkNodeSchema,
  PresentationSceneHotspotNodeSchema,
  PresentationSceneDialogNodeSchema,
  PresentationSceneNavigationNodeSchema,
]);
export type PresentationSceneNode = z.infer<typeof PresentationSceneNodeSchema>;

/** Public slide content only. Notes, provenance and source disclosure stay on the block. */
export const PresentationSceneDraftSchema = z
  .object({
    schemaVersion: z.union([
      z.literal(PRESENTATION_SCENE_SCHEMA_VERSION),
      z.literal(PRESENTATION_RICH_TEXT_SCENE_SCHEMA_VERSION),
      z.literal(PRESENTATION_DESIGN_SCENE_SCHEMA_VERSION),
      z.literal(PRESENTATION_COMPOSITION_SCENE_SCHEMA_VERSION),
      z.literal(PRESENTATION_INTERACTION_SCENE_SCHEMA_VERSION),
      z.literal(PRESENTATION_ADVANCED_INTERACTION_SCENE_SCHEMA_VERSION),
      z.literal(PRESENTATION_LANGUAGE_SCENE_SCHEMA_VERSION),
      z.literal(PRESENTATION_MOTION_BACKGROUND_SCENE_SCHEMA_VERSION),
      z.literal(PRESENTATION_STYLED_SCENE_SCHEMA_VERSION),
    ]),
    aspectRatio: z.literal("16:9"),
    design: PresentationSceneDesignSchema.optional(),
    groups: z.array(PresentationSceneGroupSchema).max(25).optional(),
    nodes: z.array(PresentationSceneNodeSchema).min(1).max(PRESENTATION_SCENE_MAX_NODES),
    readingOrder: z.array(identifier).min(1).max(PRESENTATION_SCENE_MAX_NODES),
  })
  .strict()
  .superRefine((scene, context) => {
    if (scene.schemaVersion < PRESENTATION_DESIGN_SCENE_SCHEMA_VERSION && "design" in scene) {
      context.addIssue({
        code: "custom",
        path: ["design"],
        message: "Slide design requires scene schema version 3",
      });
    }
    if (
      scene.schemaVersion < PRESENTATION_MOTION_BACKGROUND_SCENE_SCHEMA_VERSION &&
      scene.design &&
      "motionBackground" in scene.design
    ) {
      context.addIssue({
        code: "custom",
        path: ["design", "motionBackground"],
        message: "Motion backgrounds require scene schema version 8",
      });
    }
    if (
      scene.schemaVersion < PRESENTATION_STYLED_SCENE_SCHEMA_VERSION &&
      scene.design &&
      "palette" in scene.design
    ) {
      context.addIssue({
        code: "custom",
        path: ["design", "palette"],
        message: "Named palettes require scene schema version 9",
      });
    }
    const byId = new Map(scene.nodes.map((node) => [node.id, node]));
    if (scene.schemaVersion < PRESENTATION_COMPOSITION_SCENE_SCHEMA_VERSION && "groups" in scene) {
      context.addIssue({
        code: "custom",
        path: ["groups"],
        message: "Persistent groups require scene schema version 4",
      });
    }
    const groupIds = new Set<string>();
    const groupedNodes = new Set<string>();
    for (const [index, group] of (scene.groups ?? []).entries()) {
      if (groupIds.has(group.id) || byId.has(group.id)) {
        context.addIssue({
          code: "custom",
          path: ["groups", index, "id"],
          message: "Group IDs must be unique and distinct from node IDs",
        });
      }
      groupIds.add(group.id);
      for (const [memberIndex, id] of group.nodeIds.entries()) {
        const node = byId.get(id);
        if (!node || node.type === "connector" || groupedNodes.has(id)) {
          context.addIssue({
            code: "custom",
            path: ["groups", index, "nodeIds", memberIndex],
            message: "Each group member must be an existing framed node in only one group",
          });
        }
        groupedNodes.add(id);
      }
    }
    if (byId.size !== scene.nodes.length) {
      context.addIssue({ code: "custom", path: ["nodes"], message: "Node IDs must be unique" });
    }
    if (scene.nodes.filter((node) => node.type === "text" && node.role === "title").length !== 1) {
      context.addIssue({
        code: "custom",
        path: ["nodes"],
        message: "Every native slide must have exactly one title node",
      });
    }
    const readingIds = new Set(scene.readingOrder);
    if (
      readingIds.size !== scene.readingOrder.length ||
      readingIds.size !== byId.size ||
      scene.readingOrder.some((id) => !byId.has(id))
    ) {
      context.addIssue({
        code: "custom",
        path: ["readingOrder"],
        message: "List every node exactly once in semantic reading order",
      });
    }
    for (const [index, node] of scene.nodes.entries()) {
      if (
        scene.schemaVersion < PRESENTATION_STYLED_SCENE_SCHEMA_VERSION &&
        ((node.type === "text" && "typography" in node) ||
          (node.type === "shape" && ("appearance" in node || "decorative" in node)))
      ) {
        context.addIssue({
          code: "custom",
          path: ["nodes", index],
          message: "Object styling requires scene schema version 9",
        });
      }

      if (
        node.type === "text" &&
        node.lang !== undefined &&
        scene.schemaVersion < PRESENTATION_LANGUAGE_SCENE_SCHEMA_VERSION
      )
        context.addIssue({
          code: "custom",
          path: ["nodes", index, "lang"],
          message: "Text language requires scene schema version 7",
        });
      if (
        scene.schemaVersion < PRESENTATION_ADVANCED_INTERACTION_SCENE_SCHEMA_VERSION &&
        (node.type === "hotspot" ||
          node.type === "dialog" ||
          node.type === "navigation" ||
          (node.type === "reveal" && node.scope === "broadcast"))
      )
        context.addIssue({
          code: "custom",
          path: ["nodes", index],
          message: "Advanced interactions require scene schema version 6",
        });
      if (
        scene.schemaVersion < PRESENTATION_INTERACTION_SCENE_SCHEMA_VERSION &&
        (node.type === "reveal" || node.type === "link")
      ) {
        context.addIssue({
          code: "custom",
          path: ["nodes", index],
          message: "Interactions require scene schema version 5",
        });
      }
      if (scene.schemaVersion < PRESENTATION_COMPOSITION_SCENE_SCHEMA_VERSION) {
        if (node.type !== "connector" && "rotation" in node) {
          context.addIssue({
            code: "custom",
            path: ["nodes", index, "rotation"],
            message: "Rotation requires scene schema version 4",
          });
        }
        if (node.type === "table" || node.type === "chart") {
          context.addIssue({
            code: "custom",
            path: ["nodes", index],
            message: "Tables and charts require scene schema version 4",
          });
        }
      }
      if (scene.schemaVersion < PRESENTATION_DESIGN_SCENE_SCHEMA_VERSION && node.type === "image") {
        for (const field of ["fit", "focalPoint"] as const) {
          if (!(field in node)) continue;
          context.addIssue({
            code: "custom",
            path: ["nodes", index, field],
            message: "Image design requires scene schema version 3",
          });
        }
      }
      if (scene.schemaVersion === 1 && node.type === "text" && "richText" in node) {
        context.addIssue({
          code: "custom",
          path: ["nodes", index, "richText"],
          message: "Formatted text requires scene schema version 2",
        });
      }
      if (node.type !== "connector") continue;
      for (const side of ["from", "to"] as const) {
        const target = byId.get(node[side].nodeId);
        if (!target || target.type === "connector") {
          context.addIssue({
            code: "custom",
            path: ["nodes", index, side, "nodeId"],
            message: "Connect to an existing framed node in this slide",
          });
        }
      }
      if (node.from.nodeId === node.to.nodeId) {
        context.addIssue({
          code: "custom",
          path: ["nodes", index, "to", "nodeId"],
          message: "Connect two different nodes",
        });
      }
    }
    if (new TextEncoder().encode(JSON.stringify(scene)).byteLength > PRESENTATION_SCENE_MAX_BYTES) {
      context.addIssue({
        code: "custom",
        message: "The scene exceeds its 128 KiB UTF-8 JSON budget",
      });
    }
  });
export type PresentationSceneDraft = z.infer<typeof PresentationSceneDraftSchema>;
/** Delivered content is separately projected; closed broadcast bodies are redacted to an empty string before serialization. */
export const PresentationDeliveredSceneSchema = PresentationSceneDraftSchema;
export type PresentationDeliveredScene = z.infer<typeof PresentationDeliveredSceneSchema>;

export const PresentationSceneSchema = PresentationSceneDraftSchema.superRefine(
  (scene, context) => {
    if (
      !scene.nodes.some(
        (node) =>
          (node.type === "text" && node.text.trim()) ||
          node.type === "image" ||
          (node.type === "table" && node.caption.trim()) ||
          (node.type === "chart" && node.title.trim()) ||
          (node.type === "shape" && !node.decorative && node.label.trim()) ||
          ((node.type === "reveal" ||
            node.type === "link" ||
            node.type === "hotspot" ||
            node.type === "dialog" ||
            node.type === "navigation") &&
            node.label.trim()),
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["nodes"],
        message: "Add text, an image or a named shape to this slide",
      });
    }
    for (const [index, node] of scene.nodes.entries()) {
      const requireLabel = (value: string, path: (string | number)[]) => {
        if (!value.trim())
          context.addIssue({
            code: "custom",
            path: ["nodes", index, ...path],
            message: "Add a readable label before publishing",
          });
      };
      if (node.type === "hotspot" || node.type === "dialog" || node.type === "navigation") {
        requireLabel(node.label, ["label"]);
        if (node.type === "navigation") {
          if (node.targetBlockId === null)
            context.addIssue({
              code: "custom",
              path: ["nodes", index, "targetBlockId"],
              message: "Choose a published navigation target",
            });
        } else {
          requireLabel(node.detailTitle, ["detailTitle"]);
          requireLabel(node.body, ["body"]);
        }
        if (node.type === "hotspot") {
          const image = scene.nodes.find((candidate) => candidate.id === node.imageNodeId);
          if (
            image?.type !== "image" ||
            (image.rotation ?? 0) !== 0 ||
            (node.rotation ?? 0) !== 0 ||
            node.frame.x < image.frame.x ||
            node.frame.y < image.frame.y ||
            node.frame.x + node.frame.width > image.frame.x + image.frame.width ||
            node.frame.y + node.frame.height > image.frame.y + image.frame.height
          )
            context.addIssue({
              code: "custom",
              path: ["nodes", index, "imageNodeId"],
              message: "Place this hotspot inside an existing unrotated image",
            });
        }
      }
      if (node.type === "reveal" || node.type === "link") {
        requireLabel(node.label, ["label"]);
        if (node.type === "reveal") requireLabel(node.body, ["body"]);
        else if (!isSafePresentationLink(node.href)) {
          context.addIssue({
            code: "custom",
            path: ["nodes", index, "href"],
            message: "Add a safe external link before publishing",
          });
        }
      }
      if (node.type === "table") {
        requireLabel(node.caption, ["caption"]);
        node.headers.forEach((label, index) => requireLabel(label, ["headers", index]));
      }
      if (node.type === "chart") {
        requireLabel(node.title, ["title"]);
        requireLabel(node.summary, ["summary"]);
        node.categories.forEach((label, index) => requireLabel(label, ["categories", index]));
        node.series.forEach((series, index) =>
          requireLabel(series.name, ["series", index, "name"]),
        );
      }
      if (node.type === "image" && !node.altText?.trim()) {
        context.addIssue({
          code: "custom",
          path: ["nodes", index, "altText"],
          message: "Describe the image for participants who cannot see it",
        });
      }
      if (node.type === "shape" && !node.decorative && !node.label.trim()) {
        context.addIssue({
          code: "custom",
          path: ["nodes", index, "label"],
          message: "Name the shape for participants who cannot see it",
        });
      }
    }
  },
);
export type PresentationScene = z.infer<typeof PresentationSceneSchema>;

/** Explicit native-creation entry point; parsing older scenes never installs these defaults. */
export function createPresentationDesignScene(
  titleId: string,
  bodyId: string,
): PresentationSceneDraft {
  return {
    schemaVersion: 3,
    aspectRatio: "16:9",
    design: { theme: "paper", font: "sans", spacing: "relaxed" },
    nodes: [
      {
        id: titleId,
        type: "text",
        role: "title",
        text: "",
        frame: { x: 7, y: 7, width: 86, height: 20 },
      },
      {
        id: bodyId,
        type: "text",
        role: "body",
        text: "",
        frame: { x: 7, y: 33, width: 86, height: 59 },
      },
    ],
    readingOrder: [titleId, bodyId],
  };
}

export function presentationSceneTitle(scene: PresentationSceneDraft): string {
  const title = scene.nodes.find((node) => node.type === "text" && node.role === "title");
  return title?.type === "text" ? title.text : "";
}
