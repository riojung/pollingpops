import { z } from "zod";
import {
  IdeaBoardHostCommandSchema,
  IdeaBoardIdeaSchema,
  IdeaBoardViewSchema,
} from "./idea-boards";

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
export const CanvasColorSchema = z.enum(["yellow", "blue", "green", "pink", "purple", "white"]);
export const CanvasEndpointSchema = z
  .object({
    objectId: id.nullable(),
    x: coordinate,
    y: coordinate,
    anchor: z.enum(["center", "top", "right", "bottom", "left"]).default("center"),
  })
  .strict();
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
  parentId: id.nullable().default(null),
  locked: z.boolean().default(false),
  visibility: z.enum(["team", "published"]).default("team"),
};
const simple = <T extends "sticky" | "text" | "rect" | "ellipse" | "frame">(type: T) =>
  z.object({ ...common, type: z.literal(type) }).strict();
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
export const CanvasObjectCreateSchema = z.discriminatedUnion("type", [
  simple("sticky"),
  simple("text"),
  simple("rect"),
  simple("ellipse"),
  simple("frame"),
  z
    .object({
      ...common,
      type: z.literal("connector"),
      from: CanvasEndpointSchema,
      to: CanvasEndpointSchema,
    })
    .strict(),
  z
    .object({
      ...common,
      type: z.literal("pen"),
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
]);
export type CanvasObjectCreate = z.infer<typeof CanvasObjectCreateSchema>;
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
]);
export type CanvasObject = z.infer<typeof CanvasObjectSchema>;
export const CanvasObjectPatchSchema = z
  .object({
    x: coordinate.optional(),
    y: coordinate.optional(),
    width: common.width.optional(),
    height: common.height.optional(),
    rotation: common.rotation.unwrap().optional(),
    zIndex: common.zIndex.unwrap().optional(),
    color: CanvasColorSchema.optional(),
    text: text(2_000).optional(),
    parentId: id.nullable().optional(),
    locked: z.boolean().optional(),
    visibility: common.visibility.unwrap().optional(),
    from: CanvasEndpointSchema.optional(),
    to: CanvasEndpointSchema.optional(),
    points: z
      .array(z.tuple([coordinate, coordinate]))
      .min(2)
      .max(128)
      .optional(),
    url: url.optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, "Change at least one field");
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
export const CanvasBoardMutationSchema = z
  .object({ schemaVersion: z.literal(1), operationId: id, command: CanvasBoardCommandSchema })
  .strict()
  .superRefine((value, ctx) => {
    if (new TextEncoder().encode(JSON.stringify(value)).byteLength > CANVAS_MAX_OPERATION_BYTES)
      ctx.addIssue({ code: "custom", message: "Canvas operation is too large" });
  });
export type CanvasBoardMutation = z.infer<typeof CanvasBoardMutationSchema>;
export const CanvasBoardCreateSchema = z
  .object({
    schemaVersion: z.literal(1).default(1),
    workspaceId: id,
    title: text(160).pipe(z.string().trim().min(1)),
    boardType: z.enum(["team", "workshop"]),
    sourceBoardId: id.optional(),
    operationId: id,
  })
  .strict()
  .refine(
    (value) => (value.boardType === "workshop") === Boolean(value.sourceBoardId),
    "Workshops require a source board; team canvases have no source board",
  );
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
export const CanvasBoardViewSchema = z
  .object({
    schemaVersion: z.literal(1),
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
    objects: z.array(CanvasObjectSchema).max(CANVAS_MAX_OBJECTS),
    grants: z.array(CanvasBoardGrantSchema).max(100),
    invitations: z.array(CanvasBoardInvitationSchema).max(100),
    sourceBoard: IdeaBoardViewSchema.optional(),
    undoOperationId: id.nullable(),
    redoOperationId: id.nullable(),
  })
  .strict();
export type CanvasBoardView = z.infer<typeof CanvasBoardViewSchema>;
export const CanvasBoardGuestViewSchema = z
  .object({
    schemaVersion: z.literal(1),
    id,
    sourceBoardId: id,
    canvasSeq: z.number().int().nonnegative(),
    status: z.enum(["active", "archived", "frozen", "closed"]),
    objects: z.array(CanvasObjectSchema).max(CANVAS_MAX_OBJECTS),
    sourceBoard: IdeaBoardViewSchema,
  })
  .strict();
export type CanvasBoardGuestView = z.infer<typeof CanvasBoardGuestViewSchema>;
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
