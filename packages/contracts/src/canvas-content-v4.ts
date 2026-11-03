import { z } from "zod";

// Frozen V4 create primitives, independent of workshop projections and response schemas.
const id = z.string().uuid();
const text = (maximum: number) =>
  z
    .string()
    .normalize("NFC")
    .max(maximum)
    .refine(
      (value) =>
        !Array.from(value).some((character) => {
          const code = character.codePointAt(0)!;
          return code === 127 || (code < 32 && ![9, 10, 13].includes(code));
        }),
      "Use plain text",
    );
const coordinate = z.number().finite().min(-100_000).max(100_000);
export const CanvasColorSchema = z.enum([
  "yellow",
  "blue",
  "green",
  "pink",
  "purple",
  "white",
  "orange",
  "red",
  "teal",
  "lime",
  "gray",
  "black",
  "amber",
  "lavender",
  "mint",
  "sky",
]);
export type CanvasColor = z.infer<typeof CanvasColorSchema>;
/** Closed palette values shared by CSS/SVG renderers; user CSS is never accepted. */
export const CANVAS_FILL_COLORS: Readonly<Record<CanvasColor, string>> = Object.freeze({
  yellow: "#fff1a8",
  blue: "#cde7ff",
  green: "#ccebdc",
  pink: "#f9d9e4",
  purple: "#e5dcf8",
  white: "#ffffff",
  orange: "#ffdbb5",
  red: "#ffd1cc",
  teal: "#bce9e4",
  lime: "#e4f2b3",
  gray: "#e6e9ee",
  black: "#3b4351",
  amber: "#ffe3a1",
  lavender: "#ede3ff",
  mint: "#d6f5e7",
  sky: "#d9f0ff",
});
export const CANVAS_STROKE_COLORS: Readonly<Record<CanvasColor, string>> = Object.freeze({
  yellow: "#886800",
  blue: "#175ca5",
  green: "#24744a",
  pink: "#b03765",
  purple: "#7040aa",
  white: "#202938",
  orange: "#a75113",
  red: "#b6342a",
  teal: "#147d76",
  lime: "#657d18",
  gray: "#606a79",
  black: "#202938",
  amber: "#956300",
  lavender: "#7951af",
  mint: "#247a58",
  sky: "#246f9b",
});
export const CanvasShapeVariantSchema = z.enum([
  "rectangle",
  "rounded_rectangle",
  "triangle",
  "star",
  "pentagon",
  "hexagon",
  "octagon",
  "cylinder",
  "speech_bubble",
  "cloud",
  "cross",
  "chevron",
  "document",
  "trapezoid",
  "arrow_right",
  "arrow_left",
  "arrow_double",
]);
export type CanvasShapeVariant = z.infer<typeof CanvasShapeVariantSchema>;
export const CanvasSimpleTypeSchema = z.enum([
  "sticky",
  "text",
  "rect",
  "ellipse",
  "diamond",
  "parallelogram",
]);
export const CanvasFontFamilySchema = z.enum(["sans", "serif", "mono"]);
export const CanvasFontWeightSchema = z.enum(["normal", "bold"]);
export const CanvasFontStyleSchema = z.enum(["normal", "italic"]);
export const CanvasTextDecorationSchema = z.enum(["none", "underline"]);
export const CanvasTextAlignSchema = z.enum(["left", "center", "right"]);
export const CanvasEndpointSchema = z
  .object({
    objectId: id.nullable(),
    x: coordinate,
    y: coordinate,
    anchor: z.enum(["center", "top", "right", "bottom", "left"]).default("center"),
  })
  .strict();
export type CanvasEndpoint = z.infer<typeof CanvasEndpointSchema>;
const common = {
  id,
  x: coordinate,
  y: coordinate,
  width: z.number().finite().min(1).max(10_000),
  height: z.number().finite().min(1).max(10_000),
  rotation: z.number().finite().min(-180).max(180).default(0),
  zIndex: z.number().int().min(-10_000).max(10_000).default(0),
  color: CanvasColorSchema.default("yellow"),
  text: text(2_000).default(""),
  fontSize: z.number().finite().min(10).max(96).default(16),
  fontFamily: CanvasFontFamilySchema.default("sans"),
  fontWeight: CanvasFontWeightSchema.default("normal"),
  fontStyle: CanvasFontStyleSchema.default("normal"),
  textDecoration: CanvasTextDecorationSchema.default("none"),
  textAlign: CanvasTextAlignSchema.default("left"),
  strokeWidth: z.number().finite().min(1).max(24).default(2),
  opacity: z.number().finite().min(0.1).max(1).default(1),
  parentId: id.nullable().default(null),
  geometricGroupId: id.nullable().default(null),
  locked: z.boolean().default(false),
  visibility: z.enum(["team", "published"]).default("team"),
};
const simple = <
  T extends "sticky" | "text" | "rect" | "ellipse" | "frame" | "diamond" | "parallelogram",
>(
  type: T,
) => z.object({ ...common, type: z.literal(type) }).strict();
const url = z
  .string()
  .max(2_048)
  .refine((value) => {
    try {
      const parsed = new URL(value);
      return (
        /^https?:$/.test(parsed.protocol) &&
        !parsed.username &&
        !parsed.password &&
        !Array.from(value).some((character) => {
          const code = character.codePointAt(0)!;
          return code <= 32 || code === 127 || /\s/.test(character);
        })
      );
    } catch {
      return false;
    }
  }, "Use an HTTP(S) link without credentials");
export const CanvasConnectorRoutingSchema = z.enum(["straight", "elbow"]);
export const CanvasConnectorLineStyleSchema = z.enum(["solid", "dashed"]);
export const CanvasConnectorMarkerSchema = z.enum(["none", "arrow"]);
export const CanvasConnectorLineColorSchema = z.enum(["neutral", ...CanvasColorSchema.options]);
export const CanvasObjectCreateSchema = z.discriminatedUnion("type", [
  simple("sticky"),
  simple("text"),
  simple("rect").extend({ shapeVariant: CanvasShapeVariantSchema.default("rectangle") }),
  simple("ellipse"),
  simple("frame"),
  z
    .object({
      ...common,
      type: z.literal("connector"),
      from: CanvasEndpointSchema,
      to: CanvasEndpointSchema,
      routing: CanvasConnectorRoutingSchema.default("straight"),
      lineStyle: CanvasConnectorLineStyleSchema.default("solid"),
      startMarker: CanvasConnectorMarkerSchema.default("none"),
      endMarker: CanvasConnectorMarkerSchema.default("arrow"),
      lineColor: CanvasConnectorLineColorSchema.default("neutral"),
    })
    .strict(),
  z
    .object({
      ...common,
      type: z.literal("pen"),
      strokeWidth: common.strokeWidth.default(3),
      points: z
        .array(z.tuple([coordinate, coordinate]))
        .min(2)
        .max(128),
    })
    .strict(),
  z.object({ ...common, type: z.literal("link"), url }).strict(),
  z
    .object({ ...common, type: z.literal("idea_ref"), text: z.literal("").default(""), ideaId: id })
    .strict(),
  z
    .object({
      ...common,
      type: z.literal("image"),
      mediaId: id,
      altText: text(300).pipe(z.string().trim().min(1)),
    })
    .strict(),
  simple("diamond"),
  simple("parallelogram"),
]);
export type CanvasObjectCreate = z.infer<typeof CanvasObjectCreateSchema>;
export const CanvasObjectCreateV4Schema = CanvasObjectCreateSchema;
export type CanvasObjectCreateV4 = CanvasObjectCreate;

export {
  id as canvasContentIdV4Schema,
  text as canvasContentTextV4Schema,
  coordinate as canvasContentCoordinateV4Schema,
  common as canvasContentCommonV4,
  url as canvasContentUrlV4Schema,
};
