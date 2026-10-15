import { z } from "zod";

/** Customer organization permissions never imply access to the operator application. */
export const ManagementNavigationSchema = z.object({
  user: z.object({ userId: z.string().uuid(), email: z.string().email() }).nullable(),
  organizationManagementEnabled: z.boolean(),
  organizations: z.array(
    z.object({
      id: z.string().uuid(),
      name: z.string(),
      role: z.enum(["owner", "admin", "billing", "member"]),
    }),
  ),
  operatorConsoleOrigin: z.string().url().nullable(),
});
export type ManagementNavigation = z.infer<typeof ManagementNavigationSchema>;

export const BusinessOperatorNavigationSchema = z.object({
  operator: z.object({
    name: z.string(),
    role: z.enum(["founder", "support", "billing", "operations", "readonly"]),
  }),
  links: z
    .array(
      z.object({
        id: z.enum([
          "overview",
          "organizations",
          "features",
          "billing",
          "credits",
          "operations",
          "staff",
          "support",
          "integrations",
          "audit",
        ]),
        label: z.string(),
        href: z.string().url(),
      }),
    )
    .max(10),
});
export type BusinessOperatorNavigation = z.infer<typeof BusinessOperatorNavigationSchema>;
