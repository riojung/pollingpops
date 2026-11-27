import { z } from "zod";
import { LibraryDateRangeQuerySchema } from "./library-date-range";
import { LibraryArtifactKindSchema } from "./library-sharing";
export { LibraryFilterDateSchema } from "./library-date-range";

/** HTTP booleans deliberately avoid z.coerce.boolean(), which treats "false" as true. */
const QueryBooleanSchema = z
  .union([z.boolean(), z.enum(["true", "false"])])
  .transform((value) => value === true || value === "true");

export const LibraryItemsQuerySchema = LibraryDateRangeQuerySchema.safeExtend({
  q: z
    .string()
    .trim()
    .max(160)
    .refine((value) => !value.includes("\u0000"), "Search cannot contain a null character")
    .default(""),
  kind: z.enum(["all", "round", "presentation", "survey"]).default("all"),
  status: z.enum(["active", "draft", "published", "archived", "all"]).default("active"),
  sort: z.enum(["recent", "title_asc", "title_desc"]).default("recent"),
  favorites: QueryBooleanSchema.optional(),
  folder: z
    .union([
      z.enum(["all", "unfiled"]),
      z
        .string()
        .uuid()
        .transform((id) => id.toLowerCase()),
    ])
    .default("all"),
  limit: z.coerce.number().int().min(1).max(100).default(30),
  cursor: z
    .string()
    .min(1)
    .max(4096)
    .regex(/^[A-Za-z0-9_-]+$/)
    .optional(),
});
export type LibraryItemsQuery = z.infer<typeof LibraryItemsQuerySchema>;

export const LibraryItemSummarySchema = z
  .object({
    id: z.string().uuid(),
    artifactType: LibraryArtifactKindSchema,
    title: z.string(),
    description: z.string(),
    status: z.enum(["draft", "published", "archived"]),
    updatedAt: z.string().datetime(),
    folderId: z.string().uuid().nullable(),
    favorite: z.boolean(),
    currentVersionId: z.string().uuid().nullable(),
    itemCount: z.number().int().nonnegative(),
  })
  .strict();
export type LibraryItemSummary = z.infer<typeof LibraryItemSummarySchema>;

export const LibraryItemsResponseSchema = z
  .object({
    items: z.array(LibraryItemSummarySchema).max(100),
    nextCursor: z.string().max(4096).nullable(),
    facets: z
      .object({
        kinds: z
          .object({
            round: z.number().int().nonnegative(),
            presentation: z.number().int().nonnegative(),
            survey: z.number().int().nonnegative(),
          })
          .strict(),
        statuses: z
          .object({
            draft: z.number().int().nonnegative(),
            published: z.number().int().nonnegative(),
            archived: z.number().int().nonnegative(),
          })
          .strict(),
        total: z.number().int().nonnegative(),
      })
      .strict(),
  })
  .strict();
export type LibraryItemsResponse = z.infer<typeof LibraryItemsResponseSchema>;
