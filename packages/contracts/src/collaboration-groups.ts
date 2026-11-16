import { z } from "zod";

export const CollaborationGroupPurposeSchema = z.enum([
  "team",
  "department",
  "project",
  "cohort",
  "community",
  "other",
]);
export const CollaborationGroupStatusSchema = z.enum(["active", "archived"]);
export const CollaborationGroupRoleSchema = z.enum(["owner", "member"]);
export const CollaborationGroupCreateSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    description: z.string().trim().max(1000).default(""),
    scope: z.enum(["workspace", "organization"]).default("workspace"),
    organizationId: z.string().uuid().optional(),
    purpose: CollaborationGroupPurposeSchema.default("team"),
  })
  .strict();
export const CollaborationGroupUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    description: z.string().trim().max(1000).optional(),
    purpose: CollaborationGroupPurposeSchema.optional(),
    status: CollaborationGroupStatusSchema.optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, "Choose a group change");
export const CollaborationGroupCapabilitiesSchema = z
  .object({
    manageMembers: z.boolean(),
    shareContent: z.boolean(),
    postMessage: z.boolean(),
    schedule: z.boolean(),
    manageGroup: z.boolean(),
  })
  .strict();
export type CollaborationGroupPurpose = z.infer<typeof CollaborationGroupPurposeSchema>;
export type CollaborationGroupStatus = z.infer<typeof CollaborationGroupStatusSchema>;
export type CollaborationGroupCapabilities = z.infer<typeof CollaborationGroupCapabilitiesSchema>;
