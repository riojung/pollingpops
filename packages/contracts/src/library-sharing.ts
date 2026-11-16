import { z } from "zod";

export const LibraryArtifactKindSchema = z.enum(["round", "presentation", "survey"]);
export type LibraryArtifactKind = z.infer<typeof LibraryArtifactKindSchema>;
export const LibrarySharePermissionSchema = z.enum(["view", "use"]);
export const LibraryShareProgressStatusSchema = z.enum(["new", "in_progress", "done"]);
export type LibraryShareProgress = z.infer<typeof LibraryShareProgressStatusSchema>;

export const LibraryShareCreateSchema = z
  .object({
    requestId: z.string().uuid(),
    artifactType: LibraryArtifactKindSchema,
    artifactId: z.string().uuid(),
    versionId: z.string().uuid(),
    audience: z.enum(["organization", "people"]),
    recipientIds: z.array(z.string().uuid()).max(50).default([]),
    permission: LibrarySharePermissionSchema,
    message: z.string().trim().max(1000).default(""),
    dueAt: z.string().datetime().nullable().default(null),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      (value.audience === "people" && value.recipientIds.length === 0) ||
      (value.audience === "organization" && value.recipientIds.length !== 0)
    )
      ctx.addIssue({
        code: "custom",
        path: ["recipientIds"],
        message: "Choose people only for a people share",
      });
    if (
      new Set(value.recipientIds.map((id) => id.toLowerCase())).size !== value.recipientIds.length
    )
      ctx.addIssue({ code: "custom", path: ["recipientIds"], message: "Choose each person once" });
  });
export type LibraryShareCreate = z.infer<typeof LibraryShareCreateSchema>;

export const LibraryShareSummarySchema = z
  .object({
    id: z.string().uuid(),
    organizationId: z.string().uuid(),
    organizationName: z.string(),
    sourceWorkspaceId: z.string().uuid(),
    sourceWorkspaceName: z.string(),
    artifactType: LibraryArtifactKindSchema,
    artifactId: z.string().uuid(),
    versionId: z.string().uuid(),
    title: z.string(),
    description: z.string(),
    sharedAt: z.string().datetime(),
    permission: LibrarySharePermissionSchema,
    audience: z.enum(["organization", "people"]),
    message: z.string().max(1000),
    dueAt: z.string().datetime().nullable(),
    progress: LibraryShareProgressStatusSchema,
    capabilities: z.object({ view: z.boolean(), copy: z.boolean(), manage: z.boolean() }).strict(),
    copyUnavailableReason: z.string().nullable().optional(),
  })
  .strict();
export type LibraryShareSummary = z.infer<typeof LibraryShareSummarySchema>;
export const LibraryShareListSchema = z
  .object({
    shares: z.array(LibraryShareSummarySchema),
    nextCursor: z.string().nullable(),
  })
  .strict();
export const LibraryShareRecipientSchema = z
  .object({ userId: z.string().uuid(), email: z.string().email() })
  .strict();
export type LibraryShareRecipient = z.infer<typeof LibraryShareRecipientSchema>;
export const LibraryShareRecipientsSchema = z
  .object({ recipients: z.array(LibraryShareRecipientSchema) })
  .strict();
export const LibraryShareProgressSchema = z
  .object({ status: z.enum(["in_progress", "done"]) })
  .strict();
export const LibraryShareCopySchema = z.object({ requestId: z.string().uuid() }).strict();
export const LibraryShareCopyResultSchema = z
  .object({
    artifactType: LibraryArtifactKindSchema,
    artifactId: z.string().uuid(),
    replayed: z.boolean(),
    workspaceId: z.string().uuid(),
    href: z.string(),
  })
  .strict();
