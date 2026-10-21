import { z } from "zod";

export const IDEA_BOARD_MAX_IDEAS = 200;
export const IDEA_BOARD_MAX_GUEST_IDEAS = 10;
export const IDEA_BOARD_MAX_GROUPS = 20;
export const IDEA_BOARD_MAX_RECEIPTS = 5_000;
const id = z.string().uuid();
const plain = (limit: number) =>
  z
    .string()
    .transform((value) => value.normalize("NFC").trim())
    .pipe(
      z
        .string()
        .min(1)
        .max(limit)
        .refine(
          (value) =>
            !Array.from(value).some((character) => {
              const code = character.codePointAt(0)!;
              return code === 127 || (code < 32 && code !== 9 && code !== 10 && code !== 13);
            }),
          "Use plain text without control characters",
        ),
    );
export const IdeaBoardBodySchema = plain(1_000);
export const IdeaBoardAliasSchema = plain(40);
export const IDEA_BOARD_MAX_ATTACHMENTS = 3;
export const IDEA_BOARD_MAX_LINKS = 3;
export const IDEA_BOARD_MAX_SKETCH_ELEMENTS = 32;
export const IDEA_BOARD_MAX_SKETCH_BYTES = 16 * 1024;
export const IdeaBoardAttachmentSchema = z.object({ mediaId: id, alt: plain(300) }).strict();
export type IdeaBoardAttachment = z.infer<typeof IdeaBoardAttachmentSchema>;
export const IdeaBoardLinkSchema = z
  .object({
    url: z
      .string()
      .trim()
      .min(1)
      .max(2_048)
      .refine((value) => {
        if (
          Array.from(value).some((character) => {
            const code = character.codePointAt(0)!;
            return code <= 32 || code === 127;
          })
        )
          return false;
        try {
          const parsed = new URL(value);
          return (
            ["https:", "http:"].includes(parsed.protocol) &&
            Boolean(parsed.hostname) &&
            !parsed.username &&
            !parsed.password
          );
        } catch {
          return false;
        }
      }, "Use an HTTP or HTTPS link without credentials")
      .transform((value) => new URL(value).href)
      .pipe(z.string().max(2_048)),
    label: plain(160).optional(),
    imageMediaId: id.optional(),
  })
  .strict();
export type IdeaBoardLink = z.infer<typeof IdeaBoardLinkSchema>;
const sketchX = z.number().int().min(0).max(1_000);
const sketchY = z.number().int().min(0).max(600);
const sketchStyle = {
  id,
  color: z.enum(["ink", "blue", "green", "orange", "red", "purple"]),
  strokeWidth: z.union([z.literal(1), z.literal(2), z.literal(4), z.literal(8)]),
};
const sketchBox = z
  .object({
    ...sketchStyle,
    x: sketchX,
    y: sketchY,
    width: z.number().int().min(1).max(1_000),
    height: z.number().int().min(1).max(600),
  })
  .strict();
const sketchLine = z
  .object({
    ...sketchStyle,
    x1: sketchX,
    y1: sketchY,
    x2: sketchX,
    y2: sketchY,
  })
  .strict();
export const IdeaBoardSketchElementSchema = z.discriminatedUnion("type", [
  sketchBox.extend({ type: z.literal("rect") }),
  sketchBox.extend({ type: z.literal("ellipse") }),
  sketchLine.extend({ type: z.literal("line") }),
  sketchLine.extend({ type: z.literal("arrow") }),
  z
    .object({
      ...sketchStyle,
      type: z.literal("text"),
      x: sketchX,
      y: sketchY,
      text: plain(300),
      fontSize: z.union([z.literal(16), z.literal(24), z.literal(32), z.literal(48)]),
    })
    .strict(),
  z
    .object({
      ...sketchStyle,
      type: z.literal("freehand"),
      points: z
        .array(z.tuple([sketchX, sketchY]))
        .min(2)
        .max(128),
    })
    .strict(),
]);
export type IdeaBoardSketchElement = z.infer<typeof IdeaBoardSketchElementSchema>;
export const IdeaBoardSketchSchema = z
  .object({
    schemaVersion: z.literal(1),
    width: z.literal(1_000),
    height: z.literal(600),
    elements: z.array(IdeaBoardSketchElementSchema).max(IDEA_BOARD_MAX_SKETCH_ELEMENTS),
  })
  .strict()
  .superRefine((value, context) => {
    if (new Set(value.elements.map((element) => element.id)).size !== value.elements.length)
      context.addIssue({ code: "custom", message: "Use unique drawing element identifiers" });
    let points = 0;
    for (const element of value.elements) {
      if (
        (element.type === "rect" || element.type === "ellipse") &&
        (element.x + element.width > 1_000 || element.y + element.height > 600)
      )
        context.addIssue({ code: "custom", message: "Keep drawing shapes inside the canvas" });
      if (element.type === "freehand") points += element.points.length;
    }
    if (points > 1_024)
      context.addIssue({ code: "custom", message: "Use up to 1,024 drawing points" });
    if (new TextEncoder().encode(JSON.stringify(value)).byteLength > IDEA_BOARD_MAX_SKETCH_BYTES)
      context.addIssue({ code: "custom", message: "This drawing is too large" });
  });
export type IdeaBoardSketch = z.infer<typeof IdeaBoardSketchSchema>;
function validateLinkImages(
  value: { attachments?: Array<{ mediaId: string }>; links?: Array<{ imageMediaId?: string }> },
  context: z.RefinementCtx,
) {
  const images = new Set(value.attachments?.map((item) => item.mediaId));
  value.links?.forEach((link, index) => {
    if (link.imageMediaId && !images.has(link.imageMediaId))
      context.addIssue({
        code: "custom",
        path: ["links", index, "imageMediaId"],
        message: "Choose a link image from this idea's attachments",
      });
  });
}
export const IdeaBoardRichContentSchema = z
  .object({
    attachments: z
      .array(IdeaBoardAttachmentSchema)
      .max(IDEA_BOARD_MAX_ATTACHMENTS)
      .refine(
        (items) => new Set(items.map((item) => item.mediaId)).size === items.length,
        "Choose each image only once",
      )
      .optional(),
    links: z.array(IdeaBoardLinkSchema).max(IDEA_BOARD_MAX_LINKS).optional(),
    sketch: IdeaBoardSketchSchema.nullable().optional(),
  })
  .strict()
  .superRefine(validateLinkImages);
export type IdeaBoardRichContent = z.infer<typeof IdeaBoardRichContentSchema>;
/** Omit empty additions to preserve the original text-only wire shape and receipt hash. */
export function ideaBoardRichContent(value: IdeaBoardRichContent): IdeaBoardRichContent {
  return {
    ...(value.attachments?.length
      ? { attachments: value.attachments.map((item) => ({ ...item })) }
      : {}),
    ...(value.links?.length ? { links: value.links.map((item) => ({ ...item })) } : {}),
    ...(value.sketch?.elements.length ? { sketch: structuredClone(value.sketch) } : {}),
  };
}
export const IdeaBoardCreateSchema = z
  .object({
    schemaVersion: z.literal(1).default(1),
    title: plain(160),
    description: z.string().max(2_000).default(""),
    identityMode: z.enum(["anonymous", "alias"]).default("anonymous"),
    moderationEnabled: z.boolean().default(true),
    voteBudget: z.number().int().min(1).max(10).default(3),
    windowDays: z.number().int().min(1).max(30).default(7),
    ideasVisible: z.boolean().default(false),
  })
  .strict();
export type IdeaBoardCreate = z.infer<typeof IdeaBoardCreateSchema>;
export const IdeaBoardStatusSchema = z.enum(["draft", "collecting", "voting", "closed"]);
export const IdeaBoardGroupSchema = z.object({ id, name: plain(80) }).strict();
export const IdeaBoardIdeaSchema = z
  .object({
    id,
    body: z.string().max(1_000).nullable(),
    alias: z.string().max(40).nullable(),
    groupId: id.nullable(),
    status: z.enum(["pending", "approved", "removed"]),
    createdAt: z.string().datetime(),
    voteCount: z.number().int().nonnegative().nullable(),
    ...IdeaBoardRichContentSchema.shape,
  })
  .strict();
export type IdeaBoardIdea = z.infer<typeof IdeaBoardIdeaSchema>;
export const IdeaBoardPublicInfoSchema = z
  .object({
    schemaVersion: z.literal(1),
    id,
    title: z.string().max(160),
    description: z.string().max(2_000),
    identityMode: z.enum(["anonymous", "alias"]),
    moderationEnabled: z.boolean(),
    voteBudget: z.number().int().min(1).max(10),
    ideasVisible: z.boolean(),
    status: IdeaBoardStatusSchema,
    closesAt: z.string().datetime(),
    expiresAt: z.string().datetime(),
  })
  .strict();
export type IdeaBoardPublicInfo = z.infer<typeof IdeaBoardPublicInfoSchema>;
export const IdeaBoardViewSchema = IdeaBoardPublicInfoSchema.extend({
  revision: z.number().int().nonnegative(),
  participantLimit: z.number().int().positive(),
  createdAt: z.string().datetime(),
  groups: z.array(IdeaBoardGroupSchema).max(IDEA_BOARD_MAX_GROUPS),
  ideas: z.array(IdeaBoardIdeaSchema).max(IDEA_BOARD_MAX_IDEAS),
  participantCount: z.number().int().nonnegative().nullable(),
  totalIdeas: z.number().int().nonnegative(),
  countsVisible: z.boolean(),
}).strict();
export type IdeaBoardView = z.infer<typeof IdeaBoardViewSchema>;
export const IdeaBoardReceiptSchema = z
  .object({
    id,
    kind: z.string().max(40),
    ideaId: id.nullable(),
    revision: z.number().int().nonnegative(),
  })
  .strict();
export type IdeaBoardReceipt = z.infer<typeof IdeaBoardReceiptSchema>;
export const IdeaBoardGuestViewSchema = z
  .object({
    board: IdeaBoardViewSchema,
    ownIdeas: z.array(IdeaBoardIdeaSchema).max(IDEA_BOARD_MAX_GUEST_IDEAS),
    votedIdeaIds: z.array(id).max(10),
    revision: z.number().int().nonnegative(),
    receipt: IdeaBoardReceiptSchema.optional(),
    imageUploadsAvailable: z.boolean().optional(),
  })
  .strict();
export type IdeaBoardGuestView = z.infer<typeof IdeaBoardGuestViewSchema>;
export const IdeaBoardHostCommandSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("collect") }).strict(),
  z.object({ type: z.literal("start_voting") }).strict(),
  z.object({ type: z.literal("close") }).strict(),
  z.object({ type: z.literal("visibility"), visible: z.boolean() }).strict(),
  z
    .object({ type: z.literal("moderate"), ideaId: id, status: z.enum(["approved", "removed"]) })
    .strict(),
  z.object({ type: z.literal("group.create"), id, name: plain(80) }).strict(),
  z.object({ type: z.literal("group.rename"), groupId: id, name: plain(80) }).strict(),
  z.object({ type: z.literal("group.delete"), groupId: id }).strict(),
  z.object({ type: z.literal("idea.group"), ideaId: id, groupId: id.nullable() }).strict(),
]);
export type IdeaBoardHostCommand = z.infer<typeof IdeaBoardHostCommandSchema>;
export const IdeaBoardJoinSchema = z
  .object({
    schemaVersion: z.literal(1).default(1),
    alias: IdeaBoardAliasSchema.nullable().optional(),
  })
  .strict();
export const IdeaBoardSubmitSchema = z
  .object({
    schemaVersion: z.literal(1).default(1),
    body: IdeaBoardBodySchema,
    idempotencyKey: id,
    ...IdeaBoardRichContentSchema.shape,
  })
  .strict()
  .superRefine(validateLinkImages);
export const IdeaBoardVoteSchema = z
  .object({
    schemaVersion: z.literal(1).default(1),
    ideaIds: z.array(id).max(10),
    expectedRevision: z.number().int().nonnegative(),
    idempotencyKey: id,
  })
  .strict()
  .refine(
    (value) => new Set(value.ideaIds).size === value.ideaIds.length,
    "Choose each idea only once",
  );

/** Server-private durable state. Never serialize this record into an API or account export. */
export const IdeaBoardStoredSchema = IdeaBoardPublicInfoSchema.extend({
  workspaceId: id,
  revision: z.number().int().nonnegative(),
  participantLimit: z.number().int().positive().max(250),
  createdAt: z.string().datetime(),
  creationKey: id,
  creationHash: z.string().regex(/^[a-f0-9]{64}$/),
  uploadCount: z.number().int().nonnegative().max(600).optional(),
  uploadBytes: z
    .number()
    .int()
    .nonnegative()
    .max(200 * 1024 * 1024)
    .optional(),
  groups: z.array(IdeaBoardGroupSchema).max(IDEA_BOARD_MAX_GROUPS),
  ideas: z
    .array(IdeaBoardIdeaSchema.omit({ voteCount: true }).extend({ guestId: id }))
    .max(IDEA_BOARD_MAX_IDEAS),
  guests: z
    .array(
      z
        .object({
          id,
          tokenHash: z.string().regex(/^[a-f0-9]{64}$/),
          alias: z.string().max(40).nullable(),
          revision: z.number().int().nonnegative(),
          ideaIds: z.array(id).max(IDEA_BOARD_MAX_GUEST_IDEAS),
          votedIdeaIds: z.array(id).max(10),
          uploadCount: z.number().int().nonnegative().max(40).optional(),
        })
        .strict(),
    )
    .max(250),
  receipts: z
    .array(
      z
        .object({
          owner: z.string().max(40),
          key: id,
          hash: z.string().regex(/^[a-f0-9]{64}$/),
          receipt: IdeaBoardReceiptSchema,
        })
        .strict(),
    )
    .max(IDEA_BOARD_MAX_RECEIPTS),
}).strict();
export type IdeaBoardStored = z.infer<typeof IdeaBoardStoredSchema>;

/** Explicit projection prevents guest credentials, linkable identities and ballots escaping. */
export function ideaBoardProjection(
  record: IdeaBoardStored,
  now: Date,
  moderator = false,
): IdeaBoardView {
  const status = Date.parse(record.closesAt) <= now.getTime() ? "closed" : record.status;
  const countsVisible = status === "closed";
  const visible = moderator || record.ideasVisible || status === "voting" || status === "closed";
  const ideas = visible
    ? record.ideas.filter((idea) => moderator || idea.status === "approved")
    : [];
  return {
    schemaVersion: 1,
    id: record.id,
    title: record.title,
    description: record.description,
    identityMode: record.identityMode,
    moderationEnabled: record.moderationEnabled,
    voteBudget: record.voteBudget,
    ideasVisible: record.ideasVisible,
    status,
    closesAt: record.closesAt,
    expiresAt: record.expiresAt,
    revision: record.revision,
    participantLimit: record.participantLimit,
    createdAt: record.createdAt,
    groups: visible ? record.groups.map((group) => ({ ...group })) : [],
    ideas: ideas.map(
      ({ id: ideaId, body, alias, groupId, status: ideaStatus, createdAt, ...content }) => ({
        id: ideaId,
        body: ideaStatus === "removed" ? null : body,
        alias: record.identityMode === "alias" && ideaStatus !== "removed" ? alias : null,
        groupId,
        status: ideaStatus,
        createdAt,
        ...(ideaStatus !== "removed" ? ideaBoardRichContent(content) : {}),
        voteCount:
          countsVisible && ideaStatus === "approved"
            ? record.guests.filter((guest) => guest.votedIdeaIds.includes(ideaId)).length
            : null,
      }),
    ),
    participantCount: moderator ? record.guests.length : null,
    totalIdeas: moderator ? record.ideas.length : ideas.length,
    countsVisible,
  };
}
