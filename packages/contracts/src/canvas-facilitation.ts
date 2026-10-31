import { z } from "zod";
import { CanvasObjectSchema, CanvasObjectV2Schema } from "./canvas-boards";

export const CANVAS_MAX_COMMENT_THREADS = 100;
export const CANVAS_MAX_THREAD_MESSAGES = 20;
export const CANVAS_MAX_COMMENT_MESSAGES = 500;
export const CANVAS_MAX_COMMENT_BYTES = 512 * 1024;
export const CANVAS_MAX_SAVED_VERSIONS = 10;
export const CANVAS_MAX_VERSION_BYTES = 2 * 1024 * 1024;
export const CANVAS_MAX_HISTORY_BYTES = 4 * 1024 * 1024;
const id = z.string().uuid();
const revision = z.number().int().nonnegative();
const plain = (maximum: number) =>
  z
    .string()
    .normalize("NFC")
    .trim()
    .min(1)
    .max(maximum)
    .refine(
      (value) =>
        !Array.from(value).some((character) => {
          const code = character.codePointAt(0)!;
          return code === 127 || (code < 32 && ![9, 10, 13].includes(code));
        }),
      "Use plain text",
    );
export const CanvasCommentMessageSchema = z
  .object({
    id,
    authorId: id.nullable(),
    text: z.string().max(2_000),
    version: z.number().int().positive(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    deleted: z.boolean(),
  })
  .strict();
export type CanvasCommentMessage = z.infer<typeof CanvasCommentMessageSchema>;
export const CanvasCommentThreadSchema = z
  .object({
    id,
    objectId: id,
    version: z.number().int().positive(),
    resolved: z.boolean(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    messages: z.array(CanvasCommentMessageSchema).max(CANVAS_MAX_THREAD_MESSAGES),
  })
  .strict();
export type CanvasCommentThread = z.infer<typeof CanvasCommentThreadSchema>;
export const CanvasTimerSchema = z
  .object({
    revision,
    status: z.enum(["idle", "running", "paused", "finished"]),
    durationSeconds: z.number().int().min(5).max(7_200).nullable(),
    remainingMs: z.number().int().min(0).max(7_200_000),
    deadlineAt: z.string().datetime().nullable(),
  })
  .strict();
export type CanvasTimer = z.infer<typeof CanvasTimerSchema>;
export const CanvasVersionMetadataSchema = z
  .object({
    id,
    name: plain(120),
    version: z.number().int().positive(),
    createdAt: z.string().datetime(),
    createdBy: id.nullable(),
    canvasSeq: revision,
    objectCount: z.number().int().min(0).max(500),
  })
  .strict();
export type CanvasVersionMetadata = z.infer<typeof CanvasVersionMetadataSchema>;
export const CanvasFacilitationCommandSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("comment_thread_create"),
      threadId: id,
      messageId: id,
      objectId: id,
      text: plain(2_000),
    })
    .strict(),
  z
    .object({
      type: z.literal("comment_reply"),
      threadId: id,
      expectedVersion: revision,
      messageId: id,
      text: plain(2_000),
    })
    .strict(),
  z
    .object({
      type: z.literal("comment_edit"),
      threadId: id,
      expectedVersion: revision,
      messageId: id,
      text: plain(2_000),
    })
    .strict(),
  z
    .object({
      type: z.literal("comment_delete"),
      threadId: id,
      expectedVersion: revision,
      messageId: id,
    })
    .strict(),
  z
    .object({
      type: z.literal("comment_resolve"),
      threadId: id,
      expectedVersion: revision,
      resolved: z.boolean(),
    })
    .strict(),
  z
    .object({
      type: z.literal("timer_start"),
      expectedRevision: revision,
      durationSeconds: z.number().int().min(5).max(7_200),
    })
    .strict(),
  z.object({ type: z.literal("timer_pause"), expectedRevision: revision }).strict(),
  z.object({ type: z.literal("timer_resume"), expectedRevision: revision }).strict(),
  z.object({ type: z.literal("timer_reset"), expectedRevision: revision }).strict(),
  z.object({ type: z.literal("version_create"), versionId: id, name: plain(120) }).strict(),
  z
    .object({ type: z.literal("version_delete"), versionId: id, expectedVersion: revision })
    .strict(),
]);
export type CanvasFacilitationCommand = z.infer<typeof CanvasFacilitationCommandSchema>;
export const CanvasFacilitationMutationSchema = z
  .object({
    schemaVersion: z.literal(1),
    operationId: id,
    command: CanvasFacilitationCommandSchema,
  })
  .strict();
export type CanvasFacilitationMutation = z.infer<typeof CanvasFacilitationMutationSchema>;
export const CanvasFacilitationViewSchema = z
  .object({
    schemaVersion: z.literal(1),
    boardId: id,
    canvasSeq: revision,
    actorId: id,
    serverNow: z.string().datetime(),
    timer: CanvasTimerSchema,
    capabilities: z
      .object({
        comment: z.boolean(),
        moderateComments: z.boolean(),
        controlTimer: z.boolean(),
        saveVersion: z.boolean(),
        deleteVersion: z.boolean(),
      })
      .strict(),
    threads: z.array(CanvasCommentThreadSchema).max(CANVAS_MAX_COMMENT_THREADS),
    versions: z.array(CanvasVersionMetadataSchema).max(CANVAS_MAX_SAVED_VERSIONS),
  })
  .strict();
export type CanvasFacilitationView = z.infer<typeof CanvasFacilitationViewSchema>;
/** Frozen saved-scene V1 envelope uses strict Canvas V2 objects. */
export const CanvasVersionViewV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    boardId: id,
    version: CanvasVersionMetadataSchema,
    objects: z.array(CanvasObjectV2Schema).max(500),
  })
  .strict();
export const CanvasVersionViewV2Schema = z
  .object({
    schemaVersion: z.literal(2),
    boardId: id,
    version: CanvasVersionMetadataSchema,
    objects: z.array(CanvasObjectSchema).max(500),
  })
  .strict();
export const CanvasVersionViewSchema = z.union([
  CanvasVersionViewV2Schema,
  CanvasVersionViewV1Schema.transform((view) =>
    CanvasVersionViewV2Schema.parse({
      ...view,
      schemaVersion: 2,
      objects: view.objects.map((object) => CanvasObjectSchema.parse(object)),
    }),
  ),
]);
export type CanvasVersionView = z.infer<typeof CanvasVersionViewV2Schema>;
export const CanvasGuestFacilitationViewSchema = z
  .object({
    schemaVersion: z.literal(1),
    boardId: id,
    canvasSeq: revision,
    serverNow: z.string().datetime(),
    timer: CanvasTimerSchema,
  })
  .strict();
export type CanvasGuestFacilitationView = z.infer<typeof CanvasGuestFacilitationViewSchema>;
export const CanvasFacilitationResponseSchema = z
  .object({
    facilitation: CanvasFacilitationViewSchema,
    receipt: z.object({ operationId: id, canvasSeq: revision, type: z.string().max(40) }).strict(),
  })
  .strict();
export type CanvasFacilitationResponse = z.infer<typeof CanvasFacilitationResponseSchema>;

export const CanvasExportRegionSchema = z
  .object({
    x: z.number().finite().min(-100_000).max(100_000),
    y: z.number().finite().min(-100_000).max(100_000),
    width: z.number().finite().positive().max(100_000),
    height: z.number().finite().positive().max(100_000),
  })
  .strict();
export type CanvasExportRegion = z.infer<typeof CanvasExportRegionSchema>;
export const CanvasExportRequestSchema = z
  .object({
    schemaVersion: z.literal(1),
    format: z.literal("svg"),
    region: CanvasExportRegionSchema.nullable(),
    background: z.enum(["white", "transparent"]).default("white"),
  })
  .strict();
export type CanvasExportRequest = z.infer<typeof CanvasExportRequestSchema>;

const presenterPosition = {
  audience: z.enum(["team", "published"]),
  frameId: id.nullable(),
  viewport: CanvasExportRegionSchema.nullable(),
};
export const CanvasPresenterMutationSchema = z
  .object({
    schemaVersion: z.literal(1),
    operationId: id,
    expectedRevision: revision,
    sessionId: id,
    command: z.discriminatedUnion("type", [
      z.object({ type: z.literal("start"), ...presenterPosition }).strict(),
      z.object({ type: z.literal("update"), ...presenterPosition }).strict(),
      z.object({ type: z.literal("stop") }).strict(),
    ]),
  })
  .strict();
export type CanvasPresenterMutation = z.infer<typeof CanvasPresenterMutationSchema>;
export const CanvasPresenterViewSchema = z
  .object({
    schemaVersion: z.literal(1),
    boardId: id,
    serverNow: z.string().datetime(),
    revision,
    active: z.boolean(),
    sessionId: id.nullable(),
    presenterId: id.nullable(),
    ...presenterPosition,
    expiresAt: z.string().datetime().nullable(),
  })
  .strict();
export type CanvasPresenterView = z.infer<typeof CanvasPresenterViewSchema>;
export const CanvasGuestPresenterViewSchema = CanvasPresenterViewSchema.omit({ presenterId: true })
  .extend({ audience: z.literal("published"), viewport: z.null() })
  .strict();
export type CanvasGuestPresenterView = z.infer<typeof CanvasGuestPresenterViewSchema>;
