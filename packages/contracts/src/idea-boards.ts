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
  })
  .strict();
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
    ideas: ideas.map(({ id: ideaId, body, alias, groupId, status: ideaStatus, createdAt }) => ({
      id: ideaId,
      body: ideaStatus === "removed" ? null : body,
      alias: record.identityMode === "alias" && ideaStatus !== "removed" ? alias : null,
      groupId,
      status: ideaStatus,
      createdAt,
      voteCount:
        countsVisible && ideaStatus === "approved"
          ? record.guests.filter((guest) => guest.votedIdeaIds.includes(ideaId)).length
          : null,
    })),
    participantCount: moderator ? record.guests.length : null,
    totalIdeas: moderator ? record.ideas.length : ideas.length,
    countsVisible,
  };
}
