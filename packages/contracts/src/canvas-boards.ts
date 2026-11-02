import { z } from "zod";
import { CANVAS_TEMPLATE_IDS } from "./canvas-template-catalog";
import {
  CanvasBoardCreateV1Schema,
  CanvasBoardMutationV1Schema,
  CanvasBoardViewV1Schema,
  CanvasBoardGuestViewV1Schema,
} from "./canvas-boards-v1";
export {
  CanvasObjectCreateV1Schema,
  CanvasObjectV1Schema,
  CanvasObjectPatchV1Schema,
  CanvasBoardCommandV1Schema,
  CanvasBoardMutationV1Schema,
  CanvasBoardCreateV1Schema,
  CanvasBoardViewV1Schema,
  CanvasBoardGuestViewV1Schema,
} from "./canvas-boards-v1";
export type {
  CanvasObjectCreateV1,
  CanvasObjectV1,
  CanvasBoardCreateV1,
  CanvasBoardMutationV1,
  CanvasBoardViewV1,
  CanvasBoardGuestViewV1,
} from "./canvas-boards-v1";
import {
  IdeaBoardHostCommandSchema,
  IdeaBoardIdeaSchema,
  IdeaBoardViewSchema,
} from "./idea-boards";

import {
  CanvasObjectCreateSchema as FrozenObjectCreateV2Schema,
  CanvasObjectSchema as FrozenObjectV2Schema,
  CanvasObjectPatchSchema as FrozenObjectPatchV2Schema,
  CanvasBoardCommandSchema as FrozenCommandV2Schema,
  CanvasBoardMutationV2Schema as FrozenMutationV2Schema,
  CanvasBoardCreateV2Schema as FrozenCreateV2Schema,
  CanvasBoardViewV2Schema as FrozenViewV2Schema,
  CanvasBoardGuestViewV2Schema as FrozenGuestViewV2Schema,
} from "./canvas-boards-v2";
export {
  FrozenObjectCreateV2Schema as CanvasObjectCreateV2Schema,
  FrozenObjectV2Schema as CanvasObjectV2Schema,
  FrozenObjectPatchV2Schema as CanvasObjectPatchV2Schema,
  FrozenCommandV2Schema as CanvasBoardCommandV2Schema,
  FrozenMutationV2Schema as CanvasBoardMutationV2Schema,
  FrozenCreateV2Schema as CanvasBoardCreateV2Schema,
  FrozenViewV2Schema as CanvasBoardViewV2Schema,
  FrozenGuestViewV2Schema as CanvasBoardGuestViewV2Schema,
};
export type CanvasObjectCreateV2 = z.infer<typeof FrozenObjectCreateV2Schema>;
export type CanvasObjectV2 = z.infer<typeof FrozenObjectV2Schema>;
import {
  CanvasObjectCreateV3Schema as FrozenObjectCreateV3Schema,
  CanvasObjectV3Schema as FrozenObjectV3Schema,
  CanvasObjectPatchV3Schema as FrozenObjectPatchV3Schema,
  CanvasBoardCommandV3Schema as FrozenCommandV3Schema,
  CanvasBoardMutationV3Schema as FrozenMutationV3Schema,
  CanvasBoardCreateV3Schema as FrozenCreateV3Schema,
  CanvasBoardViewV3Schema as FrozenViewV3Schema,
  CanvasBoardGuestViewV3Schema as FrozenGuestViewV3Schema,
} from "./canvas-boards-v3";
export {
  FrozenObjectCreateV3Schema as CanvasObjectCreateV3Schema,
  FrozenObjectV3Schema as CanvasObjectV3Schema,
  FrozenObjectPatchV3Schema as CanvasObjectPatchV3Schema,
  FrozenCommandV3Schema as CanvasBoardCommandV3Schema,
  FrozenMutationV3Schema as CanvasBoardMutationV3Schema,
  FrozenCreateV3Schema as CanvasBoardCreateV3Schema,
  FrozenViewV3Schema as CanvasBoardViewV3Schema,
  FrozenGuestViewV3Schema as CanvasBoardGuestViewV3Schema,
};
export type CanvasObjectCreateV3 = z.infer<typeof FrozenObjectCreateV3Schema>;
export type CanvasObjectV3 = z.infer<typeof FrozenObjectV3Schema>;
export const CANVAS_SCHEMA_VERSION = 4 as const;

export const CANVAS_MAX_OBJECTS = 500;
export const CANVAS_MAX_OPERATION_BYTES = 64 * 1024;
export const CANVAS_MAX_DOCUMENT_BYTES = 2 * 1024 * 1024;
export const CANVAS_MAX_OPERATIONS = 50;
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
export const CanvasBoardRoleSchema = z.enum(["owner", "facilitator", "editor", "viewer"]);
export type CanvasBoardRole = z.infer<typeof CanvasBoardRoleSchema>;
export const CanvasBoardGrantRoleSchema = z.enum(["facilitator", "editor", "viewer"]);
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
const versioned = <T extends z.ZodRawShape>(schema: z.ZodObject<T>) =>
  schema.extend({ version: z.number().int().positive(), idea: IdeaBoardIdeaSchema.optional() });
export const CanvasObjectSchema = z.discriminatedUnion("type", [
  versioned(CanvasObjectCreateSchema.options[0]),
  versioned(CanvasObjectCreateSchema.options[1]),
  versioned(CanvasObjectCreateSchema.options[2]),
  versioned(CanvasObjectCreateSchema.options[3]),
  versioned(CanvasObjectCreateSchema.options[4]),
  versioned(CanvasObjectCreateSchema.options[5]),
  versioned(CanvasObjectCreateSchema.options[6]),
  versioned(CanvasObjectCreateSchema.options[7]),
  versioned(CanvasObjectCreateSchema.options[8]),
  versioned(CanvasObjectCreateSchema.options[9]),
  versioned(CanvasObjectCreateSchema.options[10]),
  versioned(CanvasObjectCreateSchema.options[11]),
]);
export type CanvasObject = z.infer<typeof CanvasObjectSchema>;
export const CanvasObjectV4Schema = CanvasObjectSchema;
export type CanvasObjectV4 = CanvasObject;
export const CanvasObjectPatchSchema = z
  .object({
    type: CanvasSimpleTypeSchema.optional(),
    shapeVariant: CanvasShapeVariantSchema.optional(),
    fontSize: common.fontSize.unwrap().optional(),
    fontFamily: CanvasFontFamilySchema.optional(),
    fontWeight: CanvasFontWeightSchema.optional(),
    fontStyle: CanvasFontStyleSchema.optional(),
    textDecoration: CanvasTextDecorationSchema.optional(),
    textAlign: CanvasTextAlignSchema.optional(),
    strokeWidth: common.strokeWidth.unwrap().optional(),
    opacity: common.opacity.unwrap().optional(),
    x: coordinate.optional(),
    y: coordinate.optional(),
    width: common.width.optional(),
    height: common.height.optional(),
    rotation: common.rotation.unwrap().optional(),
    zIndex: common.zIndex.unwrap().optional(),
    color: CanvasColorSchema.optional(),
    text: text(2_000).optional(),
    parentId: id.nullable().optional(),
    geometricGroupId: id.nullable().optional(),
    locked: z.boolean().optional(),
    visibility: common.visibility.unwrap().optional(),
    from: CanvasEndpointSchema.optional(),
    to: CanvasEndpointSchema.optional(),
    routing: CanvasConnectorRoutingSchema.optional(),
    lineStyle: CanvasConnectorLineStyleSchema.optional(),
    startMarker: CanvasConnectorMarkerSchema.optional(),
    endMarker: CanvasConnectorMarkerSchema.optional(),
    lineColor: CanvasConnectorLineColorSchema.optional(),
    points: z
      .array(z.tuple([coordinate, coordinate]))
      .min(2)
      .max(128)
      .optional(),
    url: url.optional(),
    altText: text(300).pipe(z.string().trim().min(1)).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, "Change at least one field");
export const CanvasObjectPatchV4Schema = CanvasObjectPatchSchema;
export const CanvasObjectOperationSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("create"), object: CanvasObjectCreateSchema }).strict(),
  z
    .object({
      type: z.literal("update"),
      id,
      expectedVersion: z.number().int().positive(),
      patch: CanvasObjectPatchSchema,
    })
    .strict(),
  z
    .object({ type: z.literal("delete"), id, expectedVersion: z.number().int().positive() })
    .strict(),
]);
export const CanvasBoardCommandSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("batch"),
      operations: z.array(CanvasObjectOperationSchema).min(1).max(CANVAS_MAX_OPERATIONS),
      expectedRelated: z
        .array(z.object({ id, expectedVersion: z.number().int().positive() }).strict())
        .max(CANVAS_MAX_OPERATIONS)
        .optional(),
    })
    .strict(),
  z.object({ type: z.literal("undo"), targetOperationId: id }).strict(),
  z.object({ type: z.literal("redo"), targetOperationId: id }).strict(),
  z.object({ type: z.literal("archive") }).strict(),
  z.object({ type: z.literal("restore") }).strict(),
  z.object({ type: z.literal("grant"), userId: id, role: CanvasBoardGrantRoleSchema }).strict(),
  z.object({ type: z.literal("revoke"), userId: id }).strict(),
  z
    .object({
      type: z.literal("workshop"),
      expectedRevision: z.number().int().nonnegative(),
      command: IdeaBoardHostCommandSchema,
    })
    .strict(),
]);
export type CanvasBoardCommand = z.infer<typeof CanvasBoardCommandSchema>;
export const CanvasBoardCommandV4Schema = CanvasBoardCommandSchema;
export const CanvasBoardMutationV4Schema = z
  .object({ schemaVersion: z.literal(4), operationId: id, command: CanvasBoardCommandSchema })
  .strict()
  .superRefine((value, ctx) => {
    if (new TextEncoder().encode(JSON.stringify(value)).byteLength > CANVAS_MAX_OPERATION_BYTES)
      ctx.addIssue({ code: "custom", message: "Canvas operation is too large" });
  });
export const CanvasBoardMutationSchema = z.union([
  CanvasBoardMutationV1Schema,
  FrozenMutationV2Schema,
  FrozenMutationV3Schema,
  CanvasBoardMutationV4Schema,
]);
export type CanvasBoardMutation = z.infer<typeof CanvasBoardMutationSchema>;
export const CanvasBoardCreateV4Schema = z
  .object({
    schemaVersion: z.literal(4),
    workspaceId: id,
    title: text(160).pipe(z.string().trim().min(1)),
    boardType: z.enum(["team", "workshop"]),
    sourceBoardId: id.optional(),
    templateId: z.enum(CANVAS_TEMPLATE_IDS).optional(),
    operationId: id,
  })
  .strict()
  .refine(
    (value) => (value.boardType === "workshop") === Boolean(value.sourceBoardId),
    "Workshops require a source board; team canvases have no source board",
  );
export const CanvasBoardCreateSchema = z.union([
  CanvasBoardCreateV1Schema,
  FrozenCreateV2Schema,
  FrozenCreateV3Schema,
  CanvasBoardCreateV4Schema,
]);
export type CanvasBoardCreate = z.infer<typeof CanvasBoardCreateSchema>;
export const CanvasBoardCapabilitiesSchema = z
  .object({
    edit: z.boolean(),
    facilitate: z.boolean(),
    share: z.boolean(),
    delete: z.boolean(),
    archive: z.boolean(),
  })
  .strict();
export const CanvasBoardGrantSchema = z
  .object({
    userId: id,
    role: CanvasBoardGrantRoleSchema,
    createdAt: z.string().datetime(),
    label: z.string().max(320).optional(),
  })
  .strict();
export const CanvasBoardInvitationSchema = z
  .object({
    id,
    boardId: id,
    email: z.string().email().max(320),
    role: CanvasBoardGrantRoleSchema,
    createdAt: z.string().datetime(),
    expiresAt: z.string().datetime(),
    acceptedAt: z.string().datetime().nullable(),
    revokedAt: z.string().datetime().nullable(),
  })
  .strict();
export const CanvasBoardInviteSchema = z
  .object({ email: z.string().email().max(320), role: CanvasBoardGrantRoleSchema, operationId: id })
  .strict();
export type CanvasBoardInvitation = z.infer<typeof CanvasBoardInvitationSchema>;
export const CanvasBoardViewV4Schema = z
  .object({
    schemaVersion: z.literal(4),
    id,
    workspaceId: id,
    organizationId: id,
    ownerUserId: id,
    workspaceName: z.string().max(160).optional(),
    organizationName: z.string().max(160).optional(),
    title: text(160),
    boardType: z.enum(["team", "workshop"]),
    sourceBoardId: id.nullable(),
    status: z.enum(["active", "archived", "frozen", "closed"]),
    canvasSeq: z.number().int().nonnegative(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    expiresAt: z.string().datetime(),
    role: CanvasBoardRoleSchema,
    capabilities: CanvasBoardCapabilitiesSchema,
    imageUploadsAvailable: z.boolean().optional(),
    objects: z.array(CanvasObjectSchema).max(CANVAS_MAX_OBJECTS),
    grants: z.array(CanvasBoardGrantSchema).max(100),
    invitations: z.array(CanvasBoardInvitationSchema).max(100),
    sourceBoard: IdeaBoardViewSchema.optional(),
    undoOperationId: id.nullable(),
    redoOperationId: id.nullable(),
  })
  .strict();
export const CanvasBoardViewSchema = z.union([
  CanvasBoardViewV4Schema,
  FrozenViewV3Schema.transform((value) =>
    CanvasBoardViewV4Schema.parse({
      ...value,
      schemaVersion: 4,
      objects: value.objects.map((object) => CanvasObjectSchema.parse(object)),
    }),
  ),
  FrozenViewV2Schema.transform((value) =>
    CanvasBoardViewV4Schema.parse({
      ...value,
      schemaVersion: 4,
      objects: value.objects.map((object) => CanvasObjectSchema.parse(object)),
    }),
  ),
  CanvasBoardViewV1Schema.transform((value) =>
    CanvasBoardViewV4Schema.parse({
      ...value,
      schemaVersion: 4,
      objects: value.objects.map((object) => CanvasObjectSchema.parse(object)),
    }),
  ),
]);
export type CanvasBoardView = z.infer<typeof CanvasBoardViewV4Schema>;
export const CanvasBoardGuestViewV4Schema = z
  .object({
    schemaVersion: z.literal(4),
    id,
    sourceBoardId: id,
    canvasSeq: z.number().int().nonnegative(),
    status: z.enum(["active", "archived", "frozen", "closed"]),
    objects: z.array(CanvasObjectSchema).max(CANVAS_MAX_OBJECTS),
    sourceBoard: IdeaBoardViewSchema,
  })
  .strict();
export const CanvasBoardGuestViewSchema = z.union([
  CanvasBoardGuestViewV4Schema,
  FrozenGuestViewV3Schema.transform((value) =>
    CanvasBoardGuestViewV4Schema.parse({
      ...value,
      schemaVersion: 4,
      objects: value.objects.map((object) => CanvasObjectSchema.parse(object)),
    }),
  ),
  FrozenGuestViewV2Schema.transform((value) =>
    CanvasBoardGuestViewV4Schema.parse({
      ...value,
      schemaVersion: 4,
      objects: value.objects.map((object) => CanvasObjectSchema.parse(object)),
    }),
  ),
  CanvasBoardGuestViewV1Schema.transform((value) =>
    CanvasBoardGuestViewV4Schema.parse({
      ...value,
      schemaVersion: 4,
      objects: value.objects.map((object) => CanvasObjectSchema.parse(object)),
    }),
  ),
]);
export type CanvasBoardGuestView = z.infer<typeof CanvasBoardGuestViewV4Schema>;
export const CanvasBoardReceiptSchema = z
  .object({ operationId: id, canvasSeq: z.number().int().nonnegative(), type: z.string().max(40) })
  .strict();
export const CanvasBoardMutationResponseSchema = z
  .object({ board: CanvasBoardViewSchema, receipt: CanvasBoardReceiptSchema })
  .strict();
export type CanvasBoardMutationResponse = z.infer<typeof CanvasBoardMutationResponseSchema>;
export const CanvasBoardEventSchema = z
  .object({
    eventId: id,
    boardId: id,
    canvasSeq: z.number().int().nonnegative(),
    type: z.enum(["canvas.changed", "canvas.deleted"]),
    createdAt: z.string().datetime(),
  })
  .strict();
export type CanvasBoardEvent = z.infer<typeof CanvasBoardEventSchema>;
