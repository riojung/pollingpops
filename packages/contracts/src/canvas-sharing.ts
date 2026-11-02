import { z } from "zod";
import { CanvasBoardGrantRoleSchema } from "./canvas-boards";

export const CANVAS_MAX_GROUP_GRANTS = 20;
const groupId = z
  .string()
  .uuid()
  .transform((value) => value.toLowerCase());
export const CanvasBoardGroupGrantSchema = z
  .object({
    groupId,
    role: CanvasBoardGrantRoleSchema,
    createdAt: z.string().datetime(),
  })
  .strict();
export type CanvasBoardGroupGrant = z.infer<typeof CanvasBoardGroupGrantSchema>;

export const CanvasBoardShareGroupsSchema = z
  .object({
    operationId: z.string().uuid(),
    groupIds: z.array(groupId).min(1).max(CANVAS_MAX_GROUP_GRANTS),
    role: CanvasBoardGrantRoleSchema,
  })
  .strict()
  .refine((value) => new Set(value.groupIds).size === value.groupIds.length, {
    message: "Choose each group once",
    path: ["groupIds"],
  });
export type CanvasBoardShareGroups = z.infer<typeof CanvasBoardShareGroupsSchema>;

export const CanvasBoardSharingSchema = z
  .object({
    groups: z
      .array(
        CanvasBoardGroupGrantSchema.extend({
          name: z.string().min(1).max(120),
          memberCount: z.number().int().nonnegative(),
        }),
      )
      .max(CANVAS_MAX_GROUP_GRANTS),
    availableGroups: z
      .array(
        z
          .object({
            id: z.string().uuid(),
            name: z.string().min(1).max(120),
            memberCount: z.number().int().nonnegative(),
          })
          .strict(),
      )
      .max(1000),
    effectiveGroupIds: z.array(z.string().uuid()).max(CANVAS_MAX_GROUP_GRANTS).optional(),
  })
  .strict();
export type CanvasBoardSharing = z.infer<typeof CanvasBoardSharingSchema>;
