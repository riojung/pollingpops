import { z } from "zod";

const allPlans = ["free", "pro", "team"] as const;
const paidPlans = ["pro", "team"] as const;
export const productFeatureKeys = [
  "roundExperiences",
  "audiencePulse",
  "roomChat",
  "uxBeta",
  "recoveryRehearsal",
  "practiceAssignments",
  "workspaceShell",
  "builderV2",
  "presentations",
  "groups",
  "discover",
  "presentationRealtime",
  "presentationCompanion",
  "liveFlexMode",
  "recoveryPacks",
  "recoveryPackLiveCards",
  "questionHealth",
  "decisionReplay",
  "recoveryTrails",
  "conceptHealth",
  "audienceScopes",
  "roundClientProtocol",
  "feedbackRooms",
  "surveys",
  "sessionSummaries",
  "ideaBoards",
  "csvExport",
  "brandTheme",
  "followups",
  "cohosting",
  "passwordProtection",
] as const;
export const ProductFeatureKeySchema = z.enum(productFeatureKeys);
export type ProductFeatureKey = z.infer<typeof ProductFeatureKeySchema>;
export const ProductFeatureRuleSchema = z
  .object({
    enabled: z.boolean(),
    plans: z
      .array(z.enum(allPlans))
      .max(3)
      .refine((plans) => new Set(plans).size === plans.length, "Plans must be unique"),
  })
  .strict();
export type ProductFeatureRule = z.infer<typeof ProductFeatureRuleSchema>;
/** Missing entries retain the deployment's legacy defaults until explicitly managed. */
export const ProductFeatureRulesSchema = z.partialRecord(
  ProductFeatureKeySchema,
  ProductFeatureRuleSchema,
);
export type ProductFeatureRules = z.infer<typeof ProductFeatureRulesSchema>;
export interface ProductFeaturePolicy {
  revision: number;
  features: ProductFeatureRules;
  updatedAt: Date;
}
export interface ProductFeatureDefinition {
  key: ProductFeatureKey;
  label: string;
  description: string;
  category: string;
  defaultPlans: readonly (typeof allPlans)[number][];
  dependencies: readonly ProductFeatureKey[];
}
const define = (
  key: ProductFeatureKey,
  label: string,
  description: string,
  category: string,
  dependencies: readonly ProductFeatureKey[] = [],
  defaultPlans: readonly (typeof allPlans)[number][] = allPlans,
): ProductFeatureDefinition => ({ key, label, description, category, defaultPlans, dependencies });

/** Product policy only: credentials, storage/scanner setup and service admission stay operational settings. */
export const productFeatureCatalog: readonly ProductFeatureDefinition[] = [
  define(
    "uxBeta",
    "Professional workspace",
    "Enable the professional product experience for selected plans.",
    "Workspace",
  ),
  define(
    "workspaceShell",
    "Workspace navigation",
    "Use the Home, Library, Sessions and Results workspace navigation.",
    "Workspace",
    ["uxBeta"],
  ),
  define(
    "builderV2",
    "Round builder",
    "Use the canvas Round editor and question navigator.",
    "Workspace",
    ["uxBeta"],
  ),
  define("presentations", "Presentations", "Create and manage Presentations.", "Workspace", [
    "uxBeta",
  ]),
  define("groups", "Groups", "Organize workspace groups and reusable audiences.", "Workspace", [
    "uxBeta",
  ]),
  define("discover", "Discover", "Browse curated starters and reusable content.", "Workspace", [
    "uxBeta",
  ]),
  define(
    "roundExperiences",
    "Round experiences",
    "Choose visual themes and experiences for Rounds.",
    "Live delivery",
  ),
  define(
    "audiencePulse",
    "Audience pulse",
    "Collect audience pulse signals during live delivery.",
    "Live delivery",
  ),
  define("roomChat", "Room chat", "Enable moderated room chat.", "Live delivery"),
  define(
    "presentationRealtime",
    "Live Presentations",
    "Host real-time Presentation sessions.",
    "Live delivery",
    ["presentations"],
  ),
  define(
    "presentationCompanion",
    "Presentation companion",
    "Enable the participant companion for live Presentations.",
    "Live delivery",
    ["presentationRealtime"],
  ),
  define(
    "liveFlexMode",
    "Flexible pacing",
    "Allow flexible pacing for live Rounds.",
    "Live delivery",
  ),
  define(
    "roundClientProtocol",
    "Extended live responses",
    "Author and deliver multiple-selection polls, rankings, open text and word clouds.",
    "Live delivery",
  ),
  define(
    "recoveryRehearsal",
    "Recovery rehearsal",
    "Use rehearsal activities in the professional workspace.",
    "Learning",
    ["uxBeta"],
  ),
  define(
    "practiceAssignments",
    "Practice assignments",
    "Assign practice from a published Round. Follow-up practice access is also required.",
    "Learning",
    ["uxBeta"],
  ),
  define("recoveryPacks", "Recovery Packs", "Create and reuse Recovery Packs.", "Learning"),
  define(
    "recoveryPackLiveCards",
    "Recovery Pack live cards",
    "Add interactive Recovery Pack cards to delivery.",
    "Learning",
    ["recoveryPacks"],
  ),
  define(
    "questionHealth",
    "Question health",
    "Inspect question evidence and improvement suggestions.",
    "Learning",
  ),
  define(
    "decisionReplay",
    "Decision replay",
    "Review decision evidence from completed sessions.",
    "Learning",
  ),
  define(
    "recoveryTrails",
    "Recovery trails",
    "Create multi-stage recovery follow-up trails.",
    "Learning",
    [],
    paidPlans,
  ),
  define(
    "conceptHealth",
    "Concept health",
    "Track aggregate concept evidence.",
    "Learning",
    [],
    paidPlans,
  ),
  define(
    "audienceScopes",
    "Audience scopes",
    "Enable shared audience scopes for supported activities.",
    "Feedback",
  ),
  define("feedbackRooms", "Feedback rooms", "Create independent feedback rooms.", "Feedback", [
    "audienceScopes",
  ]),
  define("surveys", "Surveys", "Create and publish self-paced Surveys.", "Feedback", [
    "feedbackRooms",
  ]),
  define(
    "sessionSummaries",
    "Session summaries",
    "Preview and share completed session summaries. Links and downloads also require report export access.",
    "Reports",
  ),
  define(
    "ideaBoards",
    "Brainstorming boards",
    "Collect moderated ideas, group them manually and invite private priority voting.",
    "Feedback",
  ),
  define(
    "csvExport",
    "Report exports",
    "Download reports and permit session summary sharing and downloads.",
    "Plan entitlements",
    [],
    paidPlans,
  ),
  define(
    "brandTheme",
    "Custom branding",
    "Apply a workspace brand theme.",
    "Plan entitlements",
    [],
    paidPlans,
  ),
  define(
    "followups",
    "Follow-up practice",
    "Create accountless follow-up practice.",
    "Plan entitlements",
    [],
    paidPlans,
  ),
  define(
    "cohosting",
    "Co-hosting",
    "Invite co-hosts to supported live sessions.",
    "Plan entitlements",
    [],
    paidPlans,
  ),
  define(
    "passwordProtection",
    "Password protection",
    "Require a password when launching a Round, Presentation or Survey run.",
    "Plan entitlements",
    [],
    paidPlans,
  ),
];
