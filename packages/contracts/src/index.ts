import { z } from "zod";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";

export { PRODUCT_BRAND } from "./product-brand";
export * from "./audience-scopes";
export * from "./qna-policy";

export {
  clampContentSlideFrame,
  contentSlideMediaFrame,
  fitContentSlideFrameAroundMedia,
  regionContentSlideFrames,
  regionForContentSlideFrame,
  resolveContentSlideFrames,
  starterContentSlideFrames,
} from "./slide-geometry";

export {
  applyRecoveryPackUpdate,
  buildRecoveryPackUpdatePreview,
  recoveryPackQuestionSemanticValue,
  recoveryPackUpdateLinkIssue,
  RecoveryPackUpdateError,
  type RecoveryPackUpdateComparison,
  type RecoveryPackUpdateErrorCode,
  type RecoveryPackUpdateTarget,
} from "./recovery-pack-updates";

export {
  applyPresentationRecoveryPackUpdate,
  buildPresentationRecoveryPackUpdatePreview,
  presentationRecoveryPackUpdateLinkIssue,
  type PresentationRecoveryPackUpdateComparison,
} from "./presentation-recovery-pack-updates";

function isHttpOrHttpsUrl(value: string) {
  try {
    return ["http:", "https:"].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

export const errorCodes = [
  "INVALID_CODE",
  "SESSION_FULL",
  "SESSION_LOCKED",
  "NICKNAME_REJECTED",
  "STALE_VERSION",
  "ANSWER_LATE",
  "ANSWER_INVALID",
  "ENTITLEMENT_LIMIT",
  "UNAUTHORIZED",
  "ARTIFACT_NOT_ARCHIVED",
  "ARTIFACT_IN_USE",
  "RATE_LIMITED",
  "NOT_FOUND",
  "VALIDATION_ERROR",
  "CONFLICT",
  "DEPENDENCY_UNAVAILABLE",
  "QNA_DISABLED",
  "MODERATION_REQUIRED",
  "QNA_RATE_LIMITED",
  "THEME_NOT_FOUND",
  "THEME_VERSION_UNSUPPORTED",
  "INTERACTIONS_DISABLED",
  "CHAT_DISABLED",
  "CHAT_MUTED",
  "CHAT_RATE_LIMITED",
  "CHAT_CAPACITY_REACHED",
  "AUDIENCE_BANNED",
  "SIGNAL_RATE_LIMITED",
  "MESSAGE_REMOVED",
  "INVALID_REACTION",
  "AUDIENCE_SYNC_REQUIRED",
  "ROOM_CLOSED",
  "PRECONDITION_REQUIRED",
  "STALE_DRAFT",
  "STALE_SESSION",
  "PARTICIPANT_LIMIT",
  "PHASE_CLOSED",
  "ALREADY_RESPONDED",
  "IDEMPOTENCY_CONFLICT",
  "IMPORT_VALIDATION_FAILED",
  "EXPORT_VALIDATION_FAILED",
  "FOLLOWUP_NOT_OPEN",
  "FOLLOWUP_CLOSED",
  "FOLLOWUP_COMPLETED",
  "AUTHORING_DISABLED",
  "AUTHORING_LIMIT",
  "INSTITUTION_NOT_ENABLED",
  "INSTITUTION_AUTH_REQUIRED",
  "FEDERATED_AUTH_DISABLED",
  "FEDERATED_IDENTITY_NOT_LINKED",
  "FEDERATED_AUTH_REPLAYED",
  "LTI_DISABLED",
  "LTI_REGISTRATION_NOT_FOUND",
  "LTI_LAUNCH_INVALID",
  "INTERNAL_ERROR",
] as const;

export const ErrorCodeSchema = z.enum(errorCodes);
export type ErrorCode = z.infer<typeof ErrorCodeSchema>;

export const ApiErrorSchema = z.object({
  error: z.object({
    code: ErrorCodeSchema,
    message: z.string(),
    requestId: z.string().optional(),
    details: z.record(z.string(), z.unknown()).optional(),
  }),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;

export const PublicFeaturesSchema = z.object({
  publicWebUrl: z.string().url(),
  developmentEmailInboxUrl: z
    .string()
    .url()
    .refine(isHttpOrHttpsUrl, "Must use HTTP or HTTPS")
    .optional(),
  mediaUploads: z.boolean(),
  billing: z.enum(["disabled", "stripe"]),
  communityMode: z.boolean(),
  signups: z.boolean(),
  sessionCreation: z.boolean(),
  roundExperiences: z.boolean(),
  audiencePulse: z.boolean(),
  roomChat: z.boolean(),
  uxBeta: z.boolean().default(false),
  recoveryRehearsal: z.boolean().default(false),
  practiceAssignments: z.boolean().default(false),
  presentations: z.boolean().default(false),
});
export type PublicFeatures = z.infer<typeof PublicFeaturesSchema>;

export const WorkspaceProductFeaturesSchema = z.object({
  roundExperiences: z.boolean(),
  audiencePulse: z.boolean(),
  roomChat: z.boolean(),
  uxBeta: z.boolean(),
  recoveryRehearsal: z.boolean(),
  practiceAssignments: z.boolean(),
  workspaceShell: z.boolean(),
  builderV2: z.boolean(),
  presentations: z.boolean(),
  presentationRealtime: z.boolean(),
  presentationCompanion: z.boolean().default(false),
  liveFlexMode: z.boolean().default(false),
  questionHealth: z.boolean().default(false),
  recoveryPacks: z.boolean().default(false),
  surveys: z.boolean().default(false),
  groups: z.boolean(),
  discover: z.boolean(),
});
export type WorkspaceProductFeatures = z.infer<typeof WorkspaceProductFeaturesSchema>;

export const supportedLocales = [
  "en-CA",
  "fr-FR",
  "de-DE",
  "es-ES",
  "it-IT",
  "pt-PT",
  "ja-JP",
  "ko-KR",
  "zh-CN",
  "zh-TW",
] as const;

export const LOCALE_COOKIE_NAME = "openround-locale" as const;
export const LOCALE_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

export const SupportedLocaleSchema = z.enum(supportedLocales);
export type SupportedLocale = z.infer<typeof SupportedLocaleSchema>;

export const UpdateLocalePreferenceSchema = z.object({
  locale: SupportedLocaleSchema,
});
export type UpdateLocalePreference = z.infer<typeof UpdateLocalePreferenceSchema>;

export const OperationalFeatureFlagsSchema = z.object({
  signups: z.boolean(),
  sessionCreation: z.boolean(),
  mediaUploads: z.boolean(),
  roundExperiences: z.boolean(),
  audiencePulse: z.boolean(),
  roomChat: z.boolean(),
});
export type OperationalFeatureFlags = z.infer<typeof OperationalFeatureFlagsSchema>;

export const OperationalFeaturesUpdateSchema = OperationalFeatureFlagsSchema.partial().refine(
  (update) => Object.keys(update).length > 0,
  "Provide at least one operational feature",
);
export type OperationalFeaturesUpdate = z.infer<typeof OperationalFeaturesUpdateSchema>;

export const OperationalFeaturesViewSchema = z.object({
  configured: OperationalFeatureFlagsSchema,
  runtime: OperationalFeatureFlagsSchema.extend({ updatedAt: z.string().datetime().nullable() }),
  effective: OperationalFeatureFlagsSchema,
});
export type OperationalFeaturesView = z.infer<typeof OperationalFeaturesViewSchema>;

export const PlanSchema = z.enum(["free", "pro", "team"]);
export type Plan = z.infer<typeof PlanSchema>;

export const EntitlementsSchema = z.object({
  plan: PlanSchema,
  maxParticipants: z.number().int().positive(),
  maxPublishedQuizzes: z.number().int().positive().nullable(),
  reportRetentionDays: z.number().int().positive(),
  csvExport: z.boolean(),
  brandTheme: z.boolean(),
  followups: z.boolean(),
  cohosting: z.boolean().default(false),
  authoringJobsPerMonth: z.number().int().nonnegative().nullable(),
  maxPracticePersonalLinks: z.number().int().nonnegative().default(0),
  recoveryTrails: z.boolean().default(false),
  maxRecoveryStages: z.number().int().nonnegative().default(0),
  conceptHealth: z.boolean().default(false),
  decisionReplay: z.boolean().default(false),
});
export type Entitlements = z.infer<typeof EntitlementsSchema>;

const HexColorSchema = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, "Use a six-digit hexadecimal colour such as #0B2239")
  .transform((value) => value.toUpperCase());

function relativeLuminance(hexColor: string) {
  const channels = [1, 3, 5].map((offset) =>
    Number.parseInt(hexColor.slice(offset, offset + 2), 16),
  );
  const [red, green, blue] = channels.map((channel) => {
    const normalized = channel / 255;
    return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * red! + 0.7152 * green! + 0.0722 * blue!;
}

export function colorContrastRatio(first: string, second: string) {
  const light = Math.max(relativeLuminance(first), relativeLuminance(second));
  const dark = Math.min(relativeLuminance(first), relativeLuminance(second));
  return (light + 0.05) / (dark + 0.05);
}

export const BrandThemeSchema = z
  .object({
    organizationName: z.string().trim().min(1).max(80),
    primaryColor: HexColorSchema,
    accentColor: HexColorSchema,
  })
  .superRefine((theme, ctx) => {
    for (const field of ["primaryColor", "accentColor"] as const) {
      if (colorContrastRatio(theme[field], "#FFFFFF") < 4.5) {
        ctx.addIssue({
          code: "custom",
          path: [field],
          message: "Choose a darker colour with at least 4.5:1 contrast against white",
        });
      }
    }
  });
export type BrandTheme = z.infer<typeof BrandThemeSchema>;

export const RoundCategorySchema = z.enum([
  "general",
  "education",
  "business",
  "technical",
  "safety_compliance",
  "icebreaker",
]);
export type RoundCategory = z.infer<typeof RoundCategorySchema>;

export const ExperiencePresetIdSchema = z.enum([
  "pops",
  "focus",
  "campus",
  "studio",
  "blueprint",
  "signal",
  "spark",
]);
export type ExperiencePresetId = z.infer<typeof ExperiencePresetIdSchema>;

export const ExperiencePresetRefSchema = z.object({
  id: ExperiencePresetIdSchema,
  version: z.literal(1),
});
export type ExperiencePresetRef = z.infer<typeof ExperiencePresetRefSchema>;

export const ExperienceMotionSchema = z.enum(["calm", "standard", "lively"]);
export const ExperienceSoundCueSchema = z.enum(["none", "subtle", "celebration"]);

export const ExperienceThemeTokensSchema = z.object({
  canvas: HexColorSchema,
  surface: HexColorSchema,
  surfaceStrong: HexColorSchema,
  text: HexColorSchema,
  mutedText: HexColorSchema,
  primary: HexColorSchema,
  accent: HexColorSchema,
  choiceColors: z.array(HexColorSchema).length(6),
  pattern: z.enum(["none", "dots", "grid", "stripes", "signals", "confetti"]),
  typography: z.enum(["humanist", "academic", "studio", "technical", "signal", "playful"]),
  corners: z.enum(["compact", "soft", "round"]),
});
export type ExperienceThemeTokens = z.infer<typeof ExperienceThemeTokensSchema>;

export const ExperienceThemeSnapshotSchema = z.object({
  preset: ExperiencePresetRefSchema,
  name: z.string().min(1).max(80),
  category: RoundCategorySchema,
  motion: ExperienceMotionSchema,
  soundCue: ExperienceSoundCueSchema,
  soundEnabled: z.boolean(),
  tokens: ExperienceThemeTokensSchema,
});
export type ExperienceThemeSnapshot = z.infer<typeof ExperienceThemeSnapshotSchema>;

export const ExperiencePresetSummarySchema = ExperienceThemeSnapshotSchema.omit({
  soundEnabled: true,
}).extend({
  description: z.string().min(1).max(240),
});
export type ExperiencePresetSummary = z.infer<typeof ExperiencePresetSummarySchema>;

export const QuestionTypeSchema = z.enum([
  "single_select",
  "true_false",
  "multi_select",
  "numeric",
  "rating",
  "poll",
]);
export type QuestionType = z.infer<typeof QuestionTypeSchema>;

export const QUESTION_TYPE_REGISTRY_VERSION = 1;

export interface QuestionTypeDefinition {
  type: QuestionType;
  label: string;
  editorLabel: string;
  description: string;
  responseKind: "choice" | "number" | "scale";
  scored: boolean;
  supportsConfidence: boolean;
  supportsRecovery: boolean;
}

/**
 * Versioned source of truth for question capabilities and human-facing labels. Canvas editors,
 * preview/live renderers, and reports use this registry so a newly introduced type cannot silently
 * appear in only one surface.
 */
export const QUESTION_TYPE_REGISTRY = {
  single_select: {
    type: "single_select",
    label: "Single choice",
    editorLabel: "Single select",
    description: "One correct response with clear feedback.",
    responseKind: "choice",
    scored: true,
    supportsConfidence: true,
    supportsRecovery: true,
  },
  true_false: {
    type: "true_false",
    label: "True or false",
    editorLabel: "True or false",
    description: "A fast check for one precise claim.",
    responseKind: "choice",
    scored: true,
    supportsConfidence: true,
    supportsRecovery: true,
  },
  multi_select: {
    type: "multi_select",
    label: "Multiple choice",
    editorLabel: "Multiple select",
    description: "Learners select every correct response.",
    responseKind: "choice",
    scored: true,
    supportsConfidence: true,
    supportsRecovery: true,
  },
  numeric: {
    type: "numeric",
    label: "Number",
    editorLabel: "Numeric response",
    description: "A numeric answer with optional tolerance and unit.",
    responseKind: "number",
    scored: true,
    supportsConfidence: true,
    supportsRecovery: true,
  },
  rating: {
    type: "rating",
    label: "Rating scale",
    editorLabel: "Rating",
    description: "An unscored sentiment or reflection scale.",
    responseKind: "scale",
    scored: false,
    supportsConfidence: false,
    supportsRecovery: false,
  },
  poll: {
    type: "poll",
    label: "Poll",
    editorLabel: "Poll",
    description: "An unscored choice with no right answer.",
    responseKind: "choice",
    scored: false,
    supportsConfidence: false,
    supportsRecovery: false,
  },
} as const satisfies Record<QuestionType, QuestionTypeDefinition>;

export function questionTypeDefinition(type: QuestionType): QuestionTypeDefinition {
  return QUESTION_TYPE_REGISTRY[type];
}

export const QuestionPurposeSchema = z.enum(["diagnostic", "practice", "opinion"]);
export type QuestionPurpose = z.infer<typeof QuestionPurposeSchema>;

export const ConfidenceModeSchema = z.enum(["off", "optional", "required"]);
export type ConfidenceMode = z.infer<typeof ConfidenceModeSchema>;

export const QuestionDeliverySchema = z.enum(["main", "recheck"]);
export type QuestionDelivery = z.infer<typeof QuestionDeliverySchema>;

export const ConfidenceValueSchema = z.union([z.literal(1), z.literal(2), z.literal(3)]);
export type ConfidenceValue = z.infer<typeof ConfidenceValueSchema>;

const ConceptKeySchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/i, "Use letters, numbers, dots, dashes, or underscores");

export const ChoiceDraftSchema = z.object({
  id: z.string().uuid(),
  label: z.string().trim().max(180),
  isCorrect: z.boolean(),
  feedback: z.string().trim().max(500).optional(),
  misconceptionKey: ConceptKeySchema.nullable().optional(),
});
export type ChoiceDraft = z.infer<typeof ChoiceDraftSchema>;

export const ChoiceSchema = ChoiceDraftSchema.extend({
  label: z.string().trim().min(1, "Enter an answer").max(180),
});
export type Choice = z.infer<typeof ChoiceSchema>;

type ChoiceQuestionRuleInput = {
  type: QuestionType;
  choices: Array<{ isCorrect: boolean }>;
};

function applyChoiceRules(question: ChoiceQuestionRuleInput, ctx: z.RefinementCtx) {
  const correct = question.choices.filter((choice) => choice.isCorrect);
  const requiredCorrect = question.type === "multi_select" ? "one or more" : "exactly one";
  if (
    question.type !== "poll" &&
    (correct.length === 0 || (question.type !== "multi_select" && correct.length !== 1))
  ) {
    ctx.addIssue({
      code: "custom",
      message: `Select ${requiredCorrect} correct answer${requiredCorrect === "one or more" ? "s" : ""}`,
      path: ["choices"],
    });
  }
  if (question.type === "poll" && correct.length > 0) {
    ctx.addIssue({
      code: "custom",
      message: "Poll choices cannot be marked correct",
      path: ["choices"],
    });
  }
  if (question.type === "true_false" && question.choices.length !== 2) {
    ctx.addIssue({
      code: "custom",
      message: "Use exactly two choices for a true or false question",
      path: ["choices"],
    });
  }
}

type CommonQuestionRuleInput = {
  type: QuestionType;
  purpose?: QuestionPurpose;
  confidence?: ConfidenceMode;
  delivery?: QuestionDelivery;
  linkedRecheckQuestionId?: string | null;
  mediaId: string | null;
  mediaAlt: string | null;
  basePoints: number;
};

function applyCommonQuestionRules(question: CommonQuestionRuleInput, ctx: z.RefinementCtx) {
  if (question.mediaId && !question.mediaAlt?.trim()) {
    ctx.addIssue({
      code: "custom",
      message: "Describe the instructional image for participants who cannot see it",
      path: ["mediaAlt"],
    });
  }
  if (question.type === "poll" || question.type === "rating") {
    if ((question.purpose ?? "opinion") !== "opinion") {
      ctx.addIssue({
        code: "custom",
        message: "Poll and rating checkpoints must have an opinion purpose",
        path: ["purpose"],
      });
    }
    if ((question.confidence ?? "off") !== "off") {
      ctx.addIssue({
        code: "custom",
        message: "Poll and rating checkpoints cannot collect confidence",
        path: ["confidence"],
      });
    }
    if (question.basePoints !== 0) {
      ctx.addIssue({
        code: "custom",
        message: "Poll and rating checkpoints are unscored",
        path: ["basePoints"],
      });
    }
  }
  if ((question.delivery ?? "main") === "recheck" && question.linkedRecheckQuestionId) {
    ctx.addIssue({
      code: "custom",
      message: "A recheck cannot link to another recheck",
      path: ["linkedRecheckQuestionId"],
    });
  }
}

export const RecoveryPackSourceSchema = z.object({
  artifactType: z.literal("recovery_pack"),
  packId: z.string().uuid(),
  packVersionId: z.string().uuid(),
  packVersion: z.number().int().positive(),
  sourceItemId: z.string().uuid(),
  role: z.enum(["diagnostic", "recheck", "delayed_probe"]),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
});

/** Frozen assignment provenance survives deletion of its published source Pack. */
export const RecoveryPackPracticeModeSchema = z.enum(["delayed_probe", "full_sequence"]);
export type RecoveryPackPracticeMode = z.infer<typeof RecoveryPackPracticeModeSchema>;

export const RecoveryPackPracticeSourceSchema = z
  .object({
    artifactType: z.literal("recovery_pack"),
    packId: z.string().uuid(),
    packVersionId: z.string().uuid(),
    packVersion: z.number().int().positive(),
    contentHash: z.string().regex(/^[a-f0-9]{64}$/),
    packTitle: z.string().trim().min(1).max(160),
    publishedAt: z.string().datetime(),
    sourceItemId: z.string().uuid(),
    role: RecoveryPackPracticeModeSchema,
  })
  .strict();
export type RecoveryPackPracticeSource = z.infer<typeof RecoveryPackPracticeSourceSchema>;

export const SourceCitationSchema = z.object({
  sourceName: z.string().trim().min(1).max(200),
  sourceDigest: z.string().regex(/^[a-f0-9]{64}$/),
  locator: z.string().trim().min(1).max(120),
  excerpt: z.string().trim().min(1).max(500),
});
export type SourceCitation = z.infer<typeof SourceCitationSchema>;

const CommonQuestionDraftSchema = z.object({
  id: z.string().uuid(),
  prompt: z.string().trim().max(500),
  purpose: QuestionPurposeSchema.optional(),
  confidence: ConfidenceModeSchema.optional(),
  delivery: QuestionDeliverySchema.optional(),
  conceptKeys: z.array(ConceptKeySchema).max(12).optional(),
  linkedRecheckQuestionId: z.string().uuid().nullable().optional(),
  timeLimitSeconds: z.number().int().min(5).max(300),
  basePoints: z.number().int().min(0).max(10_000),
  explanation: z.string().trim().max(1_000),
  mediaId: z.string().uuid().nullable(),
  mediaAlt: z.string().trim().max(300).nullable(),
  sourceCitations: z.array(SourceCitationSchema).max(5).optional(),
  recoveryPackSource: RecoveryPackSourceSchema.optional(),
});

const ChoiceQuestionDraftSchema = CommonQuestionDraftSchema.extend({
  type: z.enum(["single_select", "true_false", "multi_select", "poll"]),
  choices: z.array(ChoiceDraftSchema).min(2).max(6),
});

const NumericQuestionDraftSchema = CommonQuestionDraftSchema.extend({
  type: z.literal("numeric"),
  correctValue: z.string().trim().max(64),
  tolerance: z.string().trim().max(64),
  unit: z.string().trim().max(32).nullable(),
});

const RatingQuestionDraftSchema = CommonQuestionDraftSchema.extend({
  type: z.literal("rating"),
  min: z.number().int().min(1).max(9),
  max: z.number().int().min(2).max(10),
  minLabel: z.string().trim().max(80),
  maxLabel: z.string().trim().max(80),
});

/**
 * Drafts validate bounded storage shape, not publish-time correctness. This deliberately permits
 * transient editor states such as an unanswered multi-select or an unfinished rating range.
 */
export const QuestionDraftSchema = z.union([
  ChoiceQuestionDraftSchema,
  NumericQuestionDraftSchema,
  RatingQuestionDraftSchema,
]);
export type QuestionDraft = z.infer<typeof QuestionDraftSchema>;

export const QUESTION_HEALTH_RULE_IDS = [
  "choice.duplicate",
  "choice.overlap",
  "choice.length_cue",
  "choice.missing_rationale",
  "question.missing_explanation",
  "question.missing_citation",
  "question.dense_content",
  "question.configuration_mismatch",
  "recheck.same_prompt",
  "recheck.concept_mismatch",
] as const;
export const QuestionHealthRuleIdSchema = z.enum(QUESTION_HEALTH_RULE_IDS);
export type QuestionHealthRuleId = z.infer<typeof QuestionHealthRuleIdSchema>;

export const QuestionHealthFindingSchema = z.object({
  id: z.string().min(1).max(500),
  ruleId: QuestionHealthRuleIdSchema,
  ruleVersion: z.number().int().positive().max(99),
  rulesetVersion: z.string().min(1).max(32),
  severity: z.literal("advisory"),
  questionId: z.string().uuid(),
  fieldPath: z.string().min(1).max(500),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  reason: z.string().min(1).max(1_000),
  evidence: z.string().min(1).max(1_000),
  recommendedAction: z.string().min(1).max(1_000),
});
export type QuestionHealthFinding = z.infer<typeof QuestionHealthFindingSchema>;

export const QuestionHealthDismissalReasonSchema = z.enum([
  "false_positive",
  "intentional_choice",
  "will_address_later",
]);
export type QuestionHealthDismissalReason = z.infer<typeof QuestionHealthDismissalReasonSchema>;

export const QuestionHealthDismissalSchema = z.object({
  findingId: z.string().min(1).max(500),
  ruleVersion: z.number().int().positive().max(99),
  rulesetVersion: z.string().min(1).max(32),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  reason: QuestionHealthDismissalReasonSchema,
  createdAt: z.string().datetime(),
});
export type QuestionHealthDismissal = z.infer<typeof QuestionHealthDismissalSchema>;

export const QuestionHealthDismissalInputSchema = QuestionHealthDismissalSchema.omit({
  findingId: true,
  createdAt: true,
}).extend({ draftRevision: z.number().int().nonnegative() });
export type QuestionHealthDismissalInput = z.infer<typeof QuestionHealthDismissalInputSchema>;

export const QuestionHealthDismissalIdentitySchema = QuestionHealthDismissalSchema.omit({
  reason: true,
  createdAt: true,
}).extend({ draftRevision: z.number().int().nonnegative() });
export type QuestionHealthDismissalIdentity = z.infer<typeof QuestionHealthDismissalIdentitySchema>;

export const QuestionHealthResultSchema = z.object({
  quizId: z.string().uuid(),
  draftRevision: z.number().int().nonnegative(),
  rulesetVersion: z.string().min(1).max(32),
  evaluatedQuestionCount: z.number().int().nonnegative().max(200),
  findings: z.array(QuestionHealthFindingSchema).max(1_000),
  findingsTruncated: z.boolean(),
  dismissals: z.array(QuestionHealthDismissalSchema).max(1_000).default([]),
});
export type QuestionHealthResult = z.infer<typeof QuestionHealthResultSchema>;

/** Findings for one immutable published Round version; draft dismissals never apply here. */
export const QuestionHealthPublishedResultSchema = QuestionHealthResultSchema.omit({
  draftRevision: true,
  dismissals: true,
}).extend({
  source: z.literal("published"),
  version: z.object({
    id: z.string().uuid(),
    number: z.number().int().positive(),
    contentHash: z.string().regex(/^[a-f0-9]{64}$/),
    publishedAt: z.string().datetime(),
    sourceDraftRevision: z.number().int().nonnegative().nullable(),
  }),
});
export type QuestionHealthPublishedResult = z.infer<typeof QuestionHealthPublishedResultSchema>;

/** Aggregate-only post-use evidence for one exact published Round version. */
export const QUESTION_HEALTH_POST_USE_MAX_REPORTS = 250;

export const QuestionHealthPostUseSignalSchema = z.discriminatedUnion("ruleId", [
  z.object({
    id: z.string().min(1).max(500),
    ruleId: z.literal("choice.unused_after_use"),
    ruleVersion: z.literal(1),
    severity: z.literal("advisory"),
    questionId: z.string().uuid(),
    choiceId: z.string().uuid(),
    evidence: z.string().min(1).max(1_000),
    recommendedAction: z.string().min(1).max(1_000),
  }),
  z.object({
    id: z.string().min(1).max(500),
    ruleId: z.literal("question.session_instability"),
    ruleVersion: z.literal(1),
    severity: z.literal("advisory"),
    questionId: z.string().uuid(),
    evidence: z.string().min(1).max(1_000),
    recommendedAction: z.string().min(1).max(1_000),
  }),
]);
export type QuestionHealthPostUseSignal = z.infer<typeof QuestionHealthPostUseSignalSchema>;

export const QuestionHealthPostUseObservationSchema = z.object({
  questionId: z.string().uuid(),
  questionPosition: z.number().int().positive(),
  sample: z.object({
    sessions: z.number().int().positive(),
    responses: z.number().int().min(20),
    minimumResponsesPerSession: z.literal(20),
  }),
  correct: z.number().int().nonnegative(),
  accuracyPercent: z.number().min(0).max(100),
  sessionAccuracyRange: z
    .object({
      minPercent: z.number().min(0).max(100),
      maxPercent: z.number().min(0).max(100),
    })
    .nullable(),
  signals: z.array(QuestionHealthPostUseSignalSchema).max(200),
});
export type QuestionHealthPostUseObservation = z.infer<
  typeof QuestionHealthPostUseObservationSchema
>;

export const QuestionHealthPostUseResultSchema = z.object({
  quizId: z.string().uuid(),
  source: z.literal("published"),
  rulesetVersion: z.literal("post-use-1.0.0"),
  version: QuestionHealthPublishedResultSchema.shape.version,
  eligibility: z.object({
    minimumResponsesPerSession: z.literal(20),
    instabilityMinimumSessions: z.literal(3),
    instabilityThresholdPercentagePoints: z.literal(30),
  }),
  history: z.object({
    maxReports: z.literal(QUESTION_HEALTH_POST_USE_MAX_REPORTS),
    reportsIncluded: z.number().int().min(0).max(QUESTION_HEALTH_POST_USE_MAX_REPORTS),
    hasMoreReports: z.boolean(),
  }),
  cohorts: z
    .array(
      z.object({
        trustMode: z.enum(["learning", "verified"]),
        timeMode: z.enum(["timed", "flex"]),
        scoringMode: z.enum(["accuracy", "speed"]),
        questions: z.array(QuestionHealthPostUseObservationSchema).max(200),
      }),
    )
    .max(100),
  evidenceNote: z.string().min(1).max(1_000),
});
export type QuestionHealthPostUseResult = z.infer<typeof QuestionHealthPostUseResultSchema>;

/** Only narrowly-scoped, facilitator-reviewed edits may be applied from a health finding. */
export const QuestionHealthRevisionActionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("align_opinion_settings") }),
  z.object({ kind: z.literal("set_explanation"), value: z.string().trim().min(1).max(1_000) }),
  z.object({ kind: z.literal("set_choice_feedback"), value: z.string().trim().min(1).max(500) }),
  z.object({ kind: z.literal("set_choice_label"), value: z.string().trim().min(1).max(180) }),
  z.object({ kind: z.literal("set_prompt"), value: z.string().trim().min(1).max(500) }),
  z.object({ kind: z.literal("set_recheck_prompt"), value: z.string().trim().min(1).max(500) }),
]);
export type QuestionHealthRevisionAction = z.infer<typeof QuestionHealthRevisionActionSchema>;

export const QuestionHealthRevisionPreviewInputSchema = QuestionHealthDismissalInputSchema.omit({
  reason: true,
}).extend({ action: QuestionHealthRevisionActionSchema });
export type QuestionHealthRevisionPreviewInput = z.infer<
  typeof QuestionHealthRevisionPreviewInputSchema
>;

export const QuestionHealthRevisionApplyInputSchema =
  QuestionHealthRevisionPreviewInputSchema.extend({ mutationId: z.string().uuid() });
export type QuestionHealthRevisionApplyInput = z.infer<
  typeof QuestionHealthRevisionApplyInputSchema
>;

export const QuestionHealthRevisionUndoInputSchema = z.object({
  expectedRevision: z.number().int().nonnegative(),
  mutationId: z.string().uuid(),
});
export type QuestionHealthRevisionUndoInput = z.infer<typeof QuestionHealthRevisionUndoInputSchema>;

export const QuestionHealthRevisionChangeSchema = z.object({
  fieldPath: z.string().min(1).max(500),
  before: z.union([z.string(), z.number(), z.null()]),
  after: z.union([z.string(), z.number(), z.null()]),
});
export type QuestionHealthRevisionChange = z.infer<typeof QuestionHealthRevisionChangeSchema>;

export const QuestionHealthRevisionPreviewSchema = z.object({
  findingId: z.string().min(1).max(500),
  draftRevision: z.number().int().nonnegative(),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  changes: z.array(QuestionHealthRevisionChangeSchema).min(1).max(2),
});
export type QuestionHealthRevisionPreview = z.infer<typeof QuestionHealthRevisionPreviewSchema>;

/** The API returns the complete QuizRecord; this schema checks the fields needed by the editor. */
const QuestionHealthRevisionQuizSchema = z
  .object({
    id: z.string().uuid(),
    draft: z.lazy(() => QuizDraftSchema),
    draftRevision: z.number().int().nonnegative(),
  })
  .passthrough();

export const QuestionHealthRevisionAppliedSchema = z.object({
  quiz: QuestionHealthRevisionQuizSchema,
  applicationId: z.string().uuid(),
  appliedRevision: z.number().int().nonnegative(),
  changes: z.array(QuestionHealthRevisionChangeSchema).min(1).max(2),
});
export type QuestionHealthRevisionApplied = z.infer<typeof QuestionHealthRevisionAppliedSchema>;

export const QuestionHealthRevisionUndoneSchema = z.object({
  quiz: QuestionHealthRevisionQuizSchema,
  applicationId: z.string().uuid(),
});
export type QuestionHealthRevisionUndone = z.infer<typeof QuestionHealthRevisionUndoneSchema>;

const CommonQuestionSchema = CommonQuestionDraftSchema.extend({
  prompt: z.string().trim().min(1, "Enter the checkpoint prompt").max(500),
});

const ChoiceQuestionSchema = CommonQuestionSchema.extend({
  type: z.enum(["single_select", "true_false", "multi_select", "poll"]),
  choices: z.array(ChoiceSchema).min(2, "Add at least two answer choices").max(6),
}).superRefine(applyChoiceRules);

export function normalizeDecimalString(value: string): string {
  const trimmed = value.trim();
  let cursor = trimmed.startsWith("+") || trimmed.startsWith("-") ? 1 : 0;
  let decimalPoint = -1;
  let hasDigit = false;

  for (; cursor < trimmed.length; cursor += 1) {
    const character = trimmed.charAt(cursor);
    if (character >= "0" && character <= "9") {
      hasDigit = true;
      continue;
    }
    if (character === "." && decimalPoint === -1) {
      decimalPoint = cursor;
      continue;
    }
    throw new Error("Enter a decimal number without exponent notation");
  }

  if (!hasDigit) {
    throw new Error("Enter a decimal number without exponent notation");
  }

  const negative = trimmed.startsWith("-");
  const numberStart = trimmed.startsWith("+") || negative ? 1 : 0;
  const integerEnd = decimalPoint === -1 ? trimmed.length : decimalPoint;
  let integerStart = numberStart;
  while (integerStart < integerEnd - 1 && trimmed[integerStart] === "0") {
    integerStart += 1;
  }
  const integer = integerStart === integerEnd ? "0" : trimmed.slice(integerStart, integerEnd);

  let fractionEnd = trimmed.length;
  while (
    decimalPoint !== -1 &&
    fractionEnd > decimalPoint + 1 &&
    trimmed[fractionEnd - 1] === "0"
  ) {
    fractionEnd -= 1;
  }
  const fraction = decimalPoint === -1 ? "" : trimmed.slice(decimalPoint + 1, fractionEnd);
  const normalized = fraction ? `${integer}.${fraction}` : integer;
  return negative && normalized !== "0" ? `-${normalized}` : normalized;
}

const DecimalStringSchema = z
  .string()
  .trim()
  .min(1, "Enter a numeric answer")
  .max(64)
  .transform((value, context) => {
    try {
      return normalizeDecimalString(value);
    } catch (error) {
      context.addIssue({ code: "custom", message: (error as Error).message });
      return z.NEVER;
    }
  });

const NumericQuestionSchema = CommonQuestionSchema.extend({
  type: z.literal("numeric"),
  correctValue: DecimalStringSchema,
  tolerance: DecimalStringSchema.refine((value) => !value.startsWith("-"), {
    message: "Tolerance cannot be negative",
  }),
  unit: z.string().trim().max(32).nullable(),
});

const RatingQuestionSchema = CommonQuestionSchema.extend({
  type: z.literal("rating"),
  min: z.number().int().min(1).max(9),
  max: z.number().int().min(2).max(10),
  minLabel: z.string().trim().max(80),
  maxLabel: z.string().trim().max(80),
}).refine((question) => question.max > question.min, {
  message: "Rating maximum must be greater than its minimum",
  path: ["max"],
});

export const QuestionSchema = z
  .union([ChoiceQuestionSchema, NumericQuestionSchema, RatingQuestionSchema])
  .superRefine(applyCommonQuestionRules);
export type Question = z.infer<typeof QuestionSchema>;

export const RecoveryInterventionCardDraftSchema = z.object({
  id: z.string().uuid(),
  title: z.string().trim().max(160),
  body: z.string().trim().max(2_000),
  citations: z.array(SourceCitationSchema).max(5).default([]),
});
export const RecoveryInterventionCardSchema = RecoveryInterventionCardDraftSchema.extend({
  title: z.string().trim().min(1).max(160),
  body: z.string().trim().min(1).max(2_000),
});

/** Internal immutable assignment context, never a participant projection. */
export const RecoveryPackPracticeSequenceSchema = z
  .object({
    schemaVersion: z.literal(1),
    interventions: z.array(RecoveryInterventionCardSchema.strict()).min(1).max(5),
    citations: z.array(SourceCitationSchema.strict()).max(20),
  })
  .strict()
  .superRefine((sequence, context) => {
    if (
      new Set(sequence.interventions.map((card) => card.id)).size !== sequence.interventions.length
    )
      context.addIssue({
        code: "custom",
        path: ["interventions"],
        message: "Intervention card IDs must be unique",
      });
  });
export type RecoveryPackPracticeSequence = z.infer<typeof RecoveryPackPracticeSequenceSchema>;

export const RecoveryPackCardSelectionSchema = z
  .object({
    insertionId: z.string().uuid(),
    cardId: z.string().uuid(),
  })
  .strict();
export type RecoveryPackCardSelection = z.infer<typeof RecoveryPackCardSelectionSchema>;

export const RecoveryPackCardReferenceSchema = z
  .object({
    insertionId: z.string().uuid(),
    packId: z.string().uuid(),
    packVersionId: z.string().uuid(),
    packVersion: z.number().int().positive(),
    contentHash: z.string().regex(/^[a-f0-9]{64}$/),
    cardId: z.string().uuid(),
  })
  .strict();
export type RecoveryPackCardReference = z.infer<typeof RecoveryPackCardReferenceSchema>;

export const RecoveryPackLiveCardSchema = RecoveryInterventionCardSchema.omit({ id: true })
  .extend({ reference: RecoveryPackCardReferenceSchema })
  .strict();
export type RecoveryPackLiveCard = z.infer<typeof RecoveryPackLiveCardSchema>;

/** Durable Presentation attribution contains no authored card body or learner responses. */
export const PresentationRecoveryPackInterventionSchema = z
  .object({
    type: z.enum(["explain", "example"]),
    reference: RecoveryPackCardReferenceSchema,
  })
  .strict();
export type PresentationRecoveryPackIntervention = z.infer<
  typeof PresentationRecoveryPackInterventionSchema
>;

export const PresentationRecoveryPackPlaybackSchema = z
  .object({
    type: z.enum(["explain", "example"]),
    card: RecoveryPackLiveCardSchema,
  })
  .strict();

export const RecoveryPackDraftSchema = z.object({
  schemaVersion: z.literal(1).default(1),
  title: z.string().trim().max(160),
  description: z.string().trim().max(1_000).default(""),
  diagnostic: QuestionDraftSchema,
  interventions: z.array(RecoveryInterventionCardDraftSchema).max(5),
  recheck: QuestionDraftSchema,
  delayedProbe: QuestionDraftSchema.nullable().default(null),
  conceptKeys: z.array(ConceptKeySchema).max(12),
  misconceptionKeys: z.array(ConceptKeySchema).max(12).default([]),
  citations: z.array(SourceCitationSchema).max(20).default([]),
});
export type RecoveryPackDraft = z.infer<typeof RecoveryPackDraftSchema>;

export const RecoveryPackContentSchema = RecoveryPackDraftSchema.extend({
  title: z.string().trim().min(1).max(160),
  diagnostic: QuestionSchema,
  interventions: z.array(RecoveryInterventionCardSchema).min(1).max(5),
  recheck: QuestionSchema,
  delayedProbe: QuestionSchema.nullable().default(null),
  conceptKeys: z.array(ConceptKeySchema).min(1).max(12),
}).superRefine((pack, context) => {
  const issue = (path: (string | number)[], message: string) =>
    context.addIssue({ code: "custom", path, message });
  if ((pack.diagnostic.delivery ?? "main") !== "main" || pack.diagnostic.purpose !== "diagnostic")
    issue(["diagnostic"], "The first item must be a main diagnostic checkpoint");
  if (
    pack.recheck.delivery !== "recheck" ||
    pack.diagnostic.linkedRecheckQuestionId !== pack.recheck.id
  )
    issue(["recheck"], "Link the diagnostic to this recheck checkpoint");
  const questions = [
    pack.diagnostic,
    pack.recheck,
    ...(pack.delayedProbe ? [pack.delayedProbe] : []),
  ];
  const ids = [...questions.map((item) => item.id), ...pack.interventions.map((card) => card.id)];
  if (new Set(ids).size !== ids.length) issue([], "Pack item IDs must be unique");
  const normalize = (value: string) =>
    value.normalize("NFKC").toLocaleLowerCase("en").replace(/\s+/g, " ").trim();
  for (const [index, question] of questions.entries()) {
    const path = index === 0 ? "diagnostic" : index === 1 ? "recheck" : "delayedProbe";
    if (!QUESTION_TYPE_REGISTRY[question.type].supportsRecovery)
      issue([path, "type"], "Use a scored recovery question type");
    if (!question.conceptKeys?.some((key) => pack.conceptKeys.includes(key)))
      issue([path, "conceptKeys"], "Each checkpoint must share a Pack concept");
    if (index > 0 && normalize(question.prompt) === normalize(pack.diagnostic.prompt))
      issue([path, "prompt"], "Use a different prompt to check transfer, not recall");
    if (question.recoveryPackSource)
      issue(
        [path, "recoveryPackSource"],
        "Pack source items cannot contain nested Pack provenance",
      );
    if (
      "choices" in question &&
      new Set(question.choices.map((choice) => choice.id)).size !== question.choices.length
    )
      issue([path, "choices"], "Choice IDs must be unique");
  }
  if (
    pack.delayedProbe &&
    ((pack.delayedProbe.delivery ?? "main") !== "main" || pack.delayedProbe.linkedRecheckQuestionId)
  )
    issue(["delayedProbe"], "A delayed probe must be a standalone main checkpoint");
  if (pack.delayedProbe && normalize(pack.delayedProbe.prompt) === normalize(pack.recheck.prompt))
    issue(["delayedProbe", "prompt"], "The delayed probe must differ from the immediate recheck");
});
export type RecoveryPackContent = z.infer<typeof RecoveryPackContentSchema>;

function hashParsedRecoveryPackContent(content: RecoveryPackContent) {
  return bytesToHex(sha256(new TextEncoder().encode(JSON.stringify(content))));
}

/**
 * Hash the strict parsed representation, matching immutable Pack publication in Node and
 * normalizing property order after JSON/JSONB round-trips. This is an integrity check, not proof
 * that a claimed source Pack/version exists or that its citation approvals were granted.
 */
export function recoveryPackContentHash(content: unknown): string {
  return hashParsedRecoveryPackContent(RecoveryPackContentSchema.parse(content));
}

export const RecoveryPackUpdateBaselineSchema = z
  .object({
    packVersionId: z.string().uuid(),
    packVersion: z.number().int().positive(),
    contentHash: z.string().regex(/^[a-f0-9]{64}$/),
    content: RecoveryPackContentSchema,
  })
  .superRefine((baseline, context) => {
    if (hashParsedRecoveryPackContent(baseline.content) !== baseline.contentHash) {
      context.addIssue({
        code: "custom",
        path: ["contentHash"],
        message: "The Recovery Pack update baseline does not match its content hash",
      });
    }
  });
export type RecoveryPackUpdateBaseline = z.infer<typeof RecoveryPackUpdateBaselineSchema>;

/** Frozen source baseline; destination copies remain usable after source deletion. */
export const RecoveryPackInsertionSchema = z
  .object({
    id: z.string().uuid(),
    packId: z.string().uuid(),
    packVersionId: z.string().uuid(),
    packVersion: z.number().int().positive(),
    contentHash: z.string().regex(/^[a-f0-9]{64}$/),
    diagnosticQuestionId: z.string().uuid(),
    recheckQuestionId: z.string().uuid(),
    originalContent: RecoveryPackContentSchema,
    updateBaseline: RecoveryPackUpdateBaselineSchema.optional(),
  })
  .superRefine((insertion, context) => {
    if (hashParsedRecoveryPackContent(insertion.originalContent) !== insertion.contentHash) {
      context.addIssue({
        code: "custom",
        path: ["contentHash"],
        message: "The Recovery Pack baseline does not match its content hash",
      });
    }
  });
export type RecoveryPackInsertion = z.infer<typeof RecoveryPackInsertionSchema>;

export const RecoveryPackUpdateRoleSchema = z.enum(["diagnostic", "recheck"]);
export type RecoveryPackUpdateRole = z.infer<typeof RecoveryPackUpdateRoleSchema>;
export const RecoveryPackUpdateChoiceSchema = z.object({
  role: RecoveryPackUpdateRoleSchema,
  action: z.enum(["keep_local", "use_latest"]),
});
export type RecoveryPackUpdateChoice = z.infer<typeof RecoveryPackUpdateChoiceSchema>;

export const RecoveryPackUpdatePreviewRequestSchema = z.object({
  quizId: z.string().uuid(),
  insertionId: z.string().uuid(),
});
export type RecoveryPackUpdatePreviewRequest = z.infer<
  typeof RecoveryPackUpdatePreviewRequestSchema
>;

export const RecoveryPackUpdatePreviewSchema = z.object({
  quizId: z.string().uuid(),
  insertionId: z.string().uuid(),
  draftRevision: z.number().int().nonnegative(),
  baselineVersionId: z.string().uuid(),
  baselineVersion: z.number().int().positive(),
  latestVersionId: z.string().uuid(),
  latestVersion: z.number().int().positive(),
  baselineContent: RecoveryPackContentSchema,
  latestContent: RecoveryPackContentSchema,
  items: z
    .array(
      z.object({
        role: RecoveryPackUpdateRoleSchema,
        questionId: z.string().uuid(),
        status: z.enum(["unchanged", "source_changed", "local_changed", "conflict"]),
        baseline: QuestionSchema,
        local: QuestionDraftSchema.nullable(),
        latest: QuestionSchema,
      }),
    )
    .length(2)
    .refine(
      (items) => new Set(items.map((item) => item.role)).size === items.length,
      "Review each question role exactly once",
    ),
  contextChanged: z.boolean(),
});
export type RecoveryPackUpdatePreview = z.infer<typeof RecoveryPackUpdatePreviewSchema>;

export const ApplyRecoveryPackUpdateSchema = z.object({
  quizId: z.string().uuid(),
  insertionId: z.string().uuid(),
  packVersionId: z.string().uuid(),
  expectedRevision: z.number().int().nonnegative(),
  mutationId: z.string().uuid(),
  choices: z
    .array(RecoveryPackUpdateChoiceSchema)
    .max(2)
    .refine(
      (choices) => new Set(choices.map((choice) => choice.role)).size === choices.length,
      "Choose one action per question role",
    ),
});
export type ApplyRecoveryPackUpdate = z.infer<typeof ApplyRecoveryPackUpdateSchema>;

/** Presentation IDs belong to the route; comparison and choice semantics are shared with Rounds. */
export const PresentationRecoveryPackUpdatePreviewRequestSchema =
  RecoveryPackUpdatePreviewRequestSchema.omit({ quizId: true }).strict();
export type PresentationRecoveryPackUpdatePreviewRequest = z.infer<
  typeof PresentationRecoveryPackUpdatePreviewRequestSchema
>;

export const PresentationRecoveryPackUpdatePreviewSchema = RecoveryPackUpdatePreviewSchema.omit({
  quizId: true,
}).extend({ presentationId: z.string().uuid() });
export type PresentationRecoveryPackUpdatePreview = z.infer<
  typeof PresentationRecoveryPackUpdatePreviewSchema
>;

export const ApplyPresentationRecoveryPackUpdateSchema = ApplyRecoveryPackUpdateSchema.omit({
  quizId: true,
}).strict();
export type ApplyPresentationRecoveryPackUpdate = z.infer<
  typeof ApplyPresentationRecoveryPackUpdateSchema
>;

export const CreateRecoveryPackSchema = z.object({ draft: RecoveryPackDraftSchema });
export const UpdateRecoveryPackSchema = z.object({
  draft: RecoveryPackDraftSchema,
  expectedRevision: z.number().int().nonnegative(),
  mutationId: z.string().uuid(),
});
export const PublishRecoveryPackSchema = z.object({
  expectedDraftRevision: z.number().int().nonnegative(),
});
export const InsertRecoveryPackSchema = z.object({
  packVersionId: z.string().uuid(),
  quizId: z.string().uuid(),
  expectedRevision: z.number().int().nonnegative(),
  mutationId: z.string().uuid(),
});
export const RecoveryPackJsonSchema = z.object({
  format: z.literal("openround-recovery-pack"),
  schemaVersion: z.literal(1),
  content: RecoveryPackContentSchema,
});

export const QuizDraftSchema = z.object({
  title: z.string().trim().max(160),
  description: z.string().trim().max(1_000).default(""),
  category: RoundCategorySchema.default("general"),
  experiencePreset: ExperiencePresetRefSchema.default({ id: "focus", version: 1 }),
  questions: z.array(QuestionDraftSchema).max(200),
  recoveryPackInsertions: z.array(RecoveryPackInsertionSchema).max(100).optional(),
});
type ParsedQuizDraft = z.infer<typeof QuizDraftSchema>;
/** Presentation fields stay optional in the TypeScript compatibility shape through v1. */
export type QuizDraft = Omit<ParsedQuizDraft, "category" | "experiencePreset"> & {
  category?: RoundCategory;
  experiencePreset?: ExperiencePresetRef;
};

export const QuizContentSchema = z
  .object({
    title: z.string().trim().min(1, "Enter a quiz title").max(160),
    description: z.string().trim().max(1_000).default(""),
    category: RoundCategorySchema.default("general"),
    experiencePreset: ExperiencePresetRefSchema.default({ id: "focus", version: 1 }),
    questions: z.array(QuestionSchema).min(1, "Add at least one question").max(200),
    recoveryPackInsertions: z.array(RecoveryPackInsertionSchema).max(100).optional(),
  })
  .superRefine((quiz, context) => {
    if (!quiz.questions.some((question) => (question.delivery ?? "main") === "main")) {
      context.addIssue({
        code: "custom",
        message: "Add at least one main checkpoint",
        path: ["questions"],
      });
    }
    const seenQuestionIds = new Set<string>();
    for (const [questionIndex, question] of quiz.questions.entries()) {
      if (seenQuestionIds.has(question.id)) {
        context.addIssue({
          code: "custom",
          message: "Checkpoint IDs must be unique",
          path: ["questions", questionIndex, "id"],
        });
      }
      seenQuestionIds.add(question.id);
      if (!("choices" in question)) continue;
      const seenChoiceIds = new Set<string>();
      for (const [choiceIndex, choice] of question.choices.entries()) {
        if (seenChoiceIds.has(choice.id)) {
          context.addIssue({
            code: "custom",
            message: "Answer choice IDs must be unique",
            path: ["questions", questionIndex, "choices", choiceIndex, "id"],
          });
        }
        seenChoiceIds.add(choice.id);
      }
    }
    const byId = new Map(quiz.questions.map((question) => [question.id, question]));
    const indexById = new Map(quiz.questions.map((question, index) => [question.id, index]));
    const linkedSources = new Map<string, number[]>();
    for (const [index, question] of quiz.questions.entries()) {
      if (!question.linkedRecheckQuestionId) continue;
      const linked = byId.get(question.linkedRecheckQuestionId);
      if (!linked) {
        context.addIssue({
          code: "custom",
          message: "Linked recheck checkpoint does not exist",
          path: ["questions", index, "linkedRecheckQuestionId"],
        });
      } else if ((linked.delivery ?? "main") !== "recheck") {
        context.addIssue({
          code: "custom",
          message: "Linked checkpoint must be marked as a recheck",
          path: ["questions", index, "linkedRecheckQuestionId"],
        });
      } else {
        const linkedIndex = indexById.get(linked.id)!;
        if (linkedIndex <= index) {
          context.addIssue({
            code: "custom",
            message: "Place the linked recheck after its diagnostic checkpoint",
            path: ["questions", index, "linkedRecheckQuestionId"],
          });
        }
        const sources = linkedSources.get(linked.id) ?? [];
        sources.push(index);
        linkedSources.set(linked.id, sources);
      }
    }
    for (const [index, question] of quiz.questions.entries()) {
      if ((question.delivery ?? "main") !== "recheck") continue;
      const sources = linkedSources.get(question.id) ?? [];
      if (sources.length === 0) {
        context.addIssue({
          code: "custom",
          message: "Every recheck must be linked from one earlier diagnostic checkpoint",
          path: ["questions", index, "delivery"],
        });
      }
      for (const sharedSourceIndex of sources.slice(1)) {
        context.addIssue({
          code: "custom",
          message: "A recheck cannot be shared by multiple diagnostic checkpoints",
          path: ["questions", sharedSourceIndex, "linkedRecheckQuestionId"],
        });
      }
    }
  });
type ParsedQuizContent = z.infer<typeof QuizContentSchema>;
export type QuizContent = Omit<ParsedQuizContent, "category" | "experiencePreset"> & {
  category?: RoundCategory;
  experiencePreset?: ExperiencePresetRef;
};

export const OpenRoundCheckpointSetExportV1Schema = z.object({
  format: z.literal("openround.checkpoint-set"),
  version: z.literal(1),
  exportedAt: z.string().datetime(),
  checkpointSet: QuizDraftSchema.omit({ category: true, experiencePreset: true }),
});

export const OpenRoundCheckpointSetExportV2Schema = z.object({
  format: z.literal("openround.checkpoint-set"),
  version: z.literal(2),
  exportedAt: z.string().datetime(),
  checkpointSet: QuizDraftSchema,
});

/** v3 declares Pack lineage/baselines so older importers fail rather than silently losing them. */
export const OpenRoundCheckpointSetExportV3Schema = OpenRoundCheckpointSetExportV2Schema.extend({
  version: z.literal(3),
});

/** v4 declares accepted Pack update baselines; older importers must not silently discard them. */
export const OpenRoundCheckpointSetExportV4Schema = OpenRoundCheckpointSetExportV3Schema.extend({
  version: z.literal(4),
});

export const OpenRoundCheckpointSetExportSchema = z.union([
  OpenRoundCheckpointSetExportV4Schema,
  OpenRoundCheckpointSetExportV3Schema,
  OpenRoundCheckpointSetExportV2Schema,
  OpenRoundCheckpointSetExportV1Schema,
]);
export type OpenRoundCheckpointSetExport = z.infer<typeof OpenRoundCheckpointSetExportSchema>;

export const CheckpointSetImportRequestSchema = z
  .object({
    format: z.enum(["openround_json", "csv", "bulk", "qti3"]),
    data: z.string().min(1).max(8_000_000),
    encoding: z.enum(["text", "base64"]).default("text"),
    title: z.string().trim().min(1).max(160).optional(),
  })
  .superRefine((input, context) => {
    if (input.format === "qti3" && input.encoding !== "base64") {
      context.addIssue({
        code: "custom",
        path: ["encoding"],
        message: "QTI 3 packages must use base64 encoding",
      });
    }
    if (input.format !== "qti3" && input.encoding !== "text") {
      context.addIssue({
        code: "custom",
        path: ["encoding"],
        message: "This import format must use text encoding",
      });
    }
  });

export const ImportValidationIssueSchema = z.object({
  severity: z.enum(["error", "warning"]),
  code: z.string(),
  message: z.string(),
  row: z.number().int().positive().optional(),
  field: z.string().optional(),
});

export const ImportValidationReportSchema = z.object({
  format: z.enum(["openround_json", "csv", "bulk", "qti3"]),
  importedCheckpoints: z.number().int().nonnegative(),
  errors: z.array(ImportValidationIssueSchema),
  warnings: z.array(ImportValidationIssueSchema),
});
export type ImportValidationReport = z.infer<typeof ImportValidationReportSchema>;

export const FolderSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(80),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type Folder = z.infer<typeof FolderSchema>;

export const CreateFolderSchema = z.object({
  name: z.string().trim().min(1).max(80),
});

export const UpdateFolderSchema = CreateFolderSchema;

export const OrganizeQuizSchema = z.object({
  folderId: z.string().uuid().nullable(),
  tags: z
    .array(z.string().trim().min(1).max(40))
    .max(20)
    .transform((tags) => {
      const unique = new Map<string, string>();
      for (const tag of tags) {
        const normalized = tag.replace(/\s+/g, " ");
        if (!unique.has(normalized.toLocaleLowerCase())) {
          unique.set(normalized.toLocaleLowerCase(), normalized);
        }
      }
      return [...unique.values()];
    }),
});

export function questionPurpose(question: Pick<QuestionDraft, "type" | "purpose">) {
  return (
    question.purpose ??
    (question.type === "poll" || question.type === "rating" ? "opinion" : "diagnostic")
  );
}

export function questionConfidence(question: Pick<QuestionDraft, "confidence">) {
  return question.confidence ?? "off";
}

export function questionDelivery(question: Pick<QuestionDraft, "delivery">) {
  return question.delivery ?? "main";
}

export const ScoringModeSchema = z.enum(["accuracy", "speed"]);
export type ScoringMode = z.infer<typeof ScoringModeSchema>;

export const RoundTimeModeSchema = z.enum(["timed", "flex"]);
export type RoundTimeMode = z.infer<typeof RoundTimeModeSchema>;

export const ResultVisibilitySchema = z.enum(["private", "leaderboard"]);
export type ResultVisibility = z.infer<typeof ResultVisibilitySchema>;

export const TrustModeSchema = z.enum(["learning", "verified"]);
export type TrustMode = z.infer<typeof TrustModeSchema>;

export const SessionSettingsSchema = z.object({
  audienceLimit: z.number().int().min(1).max(250),
  timeMode: RoundTimeModeSchema.default("timed"),
  scoringMode: ScoringModeSchema,
  resultVisibility: ResultVisibilitySchema,
  allowLateJoin: z.boolean(),
  nicknamePolicy: z.enum(["custom", "friendly_only"]),
  trustMode: TrustModeSchema.default("learning"),
});
/** Input remains source-compatible while parsing always resolves an explicit trust mode. */
export type SessionSettings = z.input<typeof SessionSettingsSchema>;
export type ResolvedSessionSettings = z.output<typeof SessionSettingsSchema>;

export const SessionPhaseSchema = z.enum([
  "lobby",
  "question_open",
  "paused",
  "question_locked",
  "question_reveal",
  "intervention",
  "leaderboard",
  "finished",
]);
export type SessionPhase = z.infer<typeof SessionPhaseSchema>;

export const AVATAR_IDS = [
  "comet",
  "fox",
  "owl",
  "otter",
  "panda",
  "robot",
  "rocket",
  "star",
] as const;
export const AvatarIdSchema = z.enum(AVATAR_IDS);
export type AvatarId = z.infer<typeof AvatarIdSchema>;

export const ParticipantViewSchema = z.object({
  id: z.string().uuid(),
  nickname: z.string(),
  avatarId: AvatarIdSchema.optional(),
  score: z.number().int(),
  connected: z.boolean(),
  rank: z.number().int().positive().nullable(),
});
export type ParticipantView = z.infer<typeof ParticipantViewSchema>;

const LiveQuestionBaseSchema = z.object({
  id: z.string().uuid(),
  type: QuestionTypeSchema.default("single_select"),
  prompt: z.string(),
  confidence: ConfidenceModeSchema.default("off"),
  choices: z
    .array(ChoiceSchema.omit({ isCorrect: true, feedback: true, misconceptionKey: true }))
    .default([]),
  unit: z.string().nullable().optional(),
  rating: z
    .object({
      min: z.number().int(),
      max: z.number().int(),
      minLabel: z.string(),
      maxLabel: z.string(),
    })
    .optional(),
  timeLimitSeconds: z.number().int(),
  basePoints: z.number().int(),
  mediaId: z.string().uuid().nullable(),
  mediaAlt: z.string().nullable(),
});

/** Question fields that are safe to send to a learner in a live Round. */
export const ParticipantQuestionSchema = LiveQuestionBaseSchema.strict();
export type ParticipantQuestion = z.infer<typeof ParticipantQuestionSchema>;

/**
 * The facilitator projection preserves the legacy live/follow-up question contract. Purpose and
 * Recovery Loop availability are authoring/facilitation metadata and must not enter participant
 * question DTOs.
 */
export const FacilitatorQuestionSchema = LiveQuestionBaseSchema.extend({
  purpose: QuestionPurposeSchema.default("diagnostic"),
  linkedRecheckAvailable: z.boolean().default(false),
}).strict();
export type FacilitatorQuestion = z.infer<typeof FacilitatorQuestionSchema>;

/** Backward-compatible name used by host and follow-up surfaces. */
export const PublicQuestionSchema = FacilitatorQuestionSchema;
export type PublicQuestion = z.infer<typeof PublicQuestionSchema>;

/** Role-dependent live wire shape. Facilitator-only fields stay optional on the shared envelope. */
export const LiveQuestionSchema = LiveQuestionBaseSchema.extend({
  purpose: QuestionPurposeSchema.optional(),
  linkedRecheckAvailable: z.boolean().optional(),
}).strict();
export type LiveQuestion = z.infer<typeof LiveQuestionSchema>;

export const RoundKindSchema = z.enum(["main", "linked_recheck", "revote"]);
export type RoundKind = z.infer<typeof RoundKindSchema>;

export const InterventionTypeSchema = z.enum(["peer_discussion", "explain", "example", "break"]);
export type InterventionType = z.infer<typeof InterventionTypeSchema>;

export const InterventionStateSchema = z.object({
  id: z.string().uuid(),
  type: InterventionTypeSchema,
  sourceRoundId: z.string().uuid(),
  startedAt: z.string().datetime(),
  finishedAt: z.string().datetime().nullable(),
  recoveryPackCard: RecoveryPackCardReferenceSchema.optional(),
});
export type InterventionState = z.infer<typeof InterventionStateSchema>;

export const InsightActionSchema = z.enum([
  "wait_or_check_access",
  "target_misconception",
  "explain",
  "show_example",
  "peer_discussion",
  "reinforce",
  "continue",
]);
export type InsightAction = z.infer<typeof InsightActionSchema>;

export const CheckpointInsightRecommendationCodeSchema = z.enum([
  "insufficient_sample",
  "low_participation",
  "high_confidence_error",
  "dominant_misconception",
  "low_correctness",
  "split_understanding",
  "correct_but_uncertain",
  "continue",
  "opinion_result",
]);
export type CheckpointInsightRecommendationCode = z.infer<
  typeof CheckpointInsightRecommendationCodeSchema
>;

export const CheckpointInsightSchema = z.object({
  sampleSize: z.number().int().nonnegative(),
  activeParticipantCount: z.number().int().nonnegative(),
  participationPercent: z.number().min(0).max(100),
  correctnessPercent: z.number().min(0).max(100).nullable(),
  highConfidenceWrongPercent: z.number().min(0).max(100).nullable(),
  correctLowConfidencePercent: z.number().min(0).max(100).nullable(),
  dominantMisconception: z
    .object({
      key: z.string(),
      responses: z.number().int().positive(),
      allResponsePercent: z.number().min(0).max(100),
      wrongResponsePercent: z.number().min(0).max(100),
    })
    .nullable(),
  recommendation: z.object({
    code: CheckpointInsightRecommendationCodeSchema,
    action: InsightActionSchema,
    title: z.string(),
    reason: z.string(),
    strong: z.boolean(),
  }),
});
export type CheckpointInsight = z.infer<typeof CheckpointInsightSchema>;

const ChoiceResponseSchema = z.object({
  kind: z.literal("choice"),
  choiceIds: z.array(z.string().uuid()).min(1).max(6),
});

const NumericResponseSchema = z.object({
  kind: z.literal("numeric"),
  value: DecimalStringSchema,
  unit: z.string().trim().max(32).optional(),
});

const RatingResponseSchema = z.object({
  kind: z.literal("rating"),
  value: z.number().int().min(1).max(10),
});

const PollResponseSchema = z.object({
  kind: z.literal("poll"),
  choiceIds: z.array(z.string().uuid()).length(1),
});

export const ResponsePayloadSchema = z
  .discriminatedUnion("kind", [
    ChoiceResponseSchema,
    NumericResponseSchema,
    RatingResponseSchema,
    PollResponseSchema,
  ])
  .superRefine((response, context) => {
    if (
      (response.kind === "choice" || response.kind === "poll") &&
      new Set(response.choiceIds).size !== response.choiceIds.length
    ) {
      context.addIssue({ code: "custom", message: "A choice can only be selected once" });
    }
  });
export type ResponsePayload = z.infer<typeof ResponsePayloadSchema>;

export function canonicalizeResponse(response: ResponsePayload): ResponsePayload {
  if (response.kind === "choice" || response.kind === "poll") {
    return { ...response, choiceIds: [...response.choiceIds].sort() };
  }
  if (response.kind === "numeric") {
    return { ...response, value: normalizeDecimalString(response.value) };
  }
  return response;
}

const ResponseDistributionBucketSchema = z.object({
  value: z.string().min(1).max(500),
  label: z.string().min(1).max(500),
  count: z.number().int().nonnegative(),
  percent: z.number().min(0).max(100),
});

/**
 * Aggregate response evidence that is safe to expose to authenticated session staff only.
 * It is omitted before lock/reveal and whenever fewer than five people responded.
 */
export const ResponseDistributionSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("choice"),
    respondents: z.number().int().min(5),
    totalSelections: z.number().int().nonnegative(),
    percentBasis: z.enum(["responses", "respondents"]),
    buckets: z.array(ResponseDistributionBucketSchema).max(6),
  }),
  z.object({
    kind: z.literal("rating"),
    respondents: z.number().int().min(5),
    buckets: z.array(ResponseDistributionBucketSchema).max(10),
  }),
  z.object({
    kind: z.literal("numeric"),
    respondents: z.number().int().min(5),
    correct: z.number().int().nonnegative(),
    incorrect: z.number().int().nonnegative(),
  }),
]);
export type ResponseDistribution = z.infer<typeof ResponseDistributionSchema>;

export const SessionSnapshotSchema = z.object({
  mode: z.literal("live").default("live"),
  uxBeta: z.boolean().optional(),
  stateSchemaVersion: z.number().int().positive().default(1),
  sessionId: z.string().uuid(),
  code: z.string().regex(/^\d{7}$/),
  version: z.number().int().nonnegative(),
  seq: z.number().int().nonnegative(),
  phase: SessionPhaseSchema,
  /**
   * Non-secret signal that the facilitator has revealed this question's result. Participant
   * projections use it to render their own outcome without receiving the answer key.
   */
  answerRevealed: z.boolean().default(false),
  roundId: z.string().uuid().nullable(),
  roundKind: RoundKindSchema.default("main"),
  sourceRoundId: z.string().uuid().nullable().default(null),
  questionIndex: z.number().int().nonnegative().nullable(),
  questionPosition: z.number().int().nonnegative().nullable().optional(),
  questionCount: z.number().int().nonnegative(),
  question: LiveQuestionSchema.nullable(),
  deadline: z.string().datetime().nullable(),
  participants: z.array(ParticipantViewSchema),
  answerCount: z.number().int().nonnegative(),
  lobbyLocked: z.boolean(),
  settings: SessionSettingsSchema,
  brandTheme: BrandThemeSchema.nullable(),
  experienceTheme: ExperienceThemeSnapshotSchema,
  pausedRemainingMs: z.number().int().nonnegative().nullable(),
  myParticipantId: z.string().uuid().nullable().optional(),
  myAnswerChoiceId: z.string().uuid().nullable().optional(),
  myResponse: ResponsePayloadSchema.nullable().optional(),
  myConfidence: ConfidenceValueSchema.nullable().optional(),
  myCorrect: z.boolean().nullable().optional(),
  correctChoiceId: z.string().uuid().nullable().optional(),
  correctResponse: ResponsePayloadSchema.nullable().optional(),
  explanation: z.string().nullable().optional(),
  feedback: z.string().nullable().optional(),
  intervention: InterventionStateSchema.nullable().default(null),
  insight: CheckpointInsightSchema.optional(),
  responseDistribution: ResponseDistributionSchema.optional(),
  recoveryPackCards: z.array(RecoveryPackLiveCardSchema).max(5).optional(),
  recoveryPackCard: RecoveryPackLiveCardSchema.optional(),
});
export type ResolvedSessionSnapshot = z.output<typeof SessionSnapshotSchema>;
export type SessionSnapshot = Omit<ResolvedSessionSnapshot, "settings"> & {
  settings: SessionSettings;
};

export const EventEnvelopeSchema = z.object({
  eventId: z.string(),
  sessionId: z.string().uuid(),
  sessionVersion: z.number().int().nonnegative(),
  seq: z.number().int().nonnegative(),
  type: z.string(),
  schemaVersion: z.union([z.literal(1), z.literal(2)]),
  serverTime: z.string().datetime(),
  idempotencyKey: z.string().max(160).optional(),
  payload: z.unknown(),
});
export type EventEnvelope<T = unknown> = Omit<z.infer<typeof EventEnvelopeSchema>, "payload"> & {
  payload: T;
};

export const JoinPreflightRequestSchema = z
  .object({
    code: z
      .string()
      .trim()
      .regex(/^\d{7}$/),
  })
  .strict();
export type JoinPreflightRequest = z.infer<typeof JoinPreflightRequestSchema>;

export const JoinPreflightResponseSchema = z
  .object({
    nicknamePolicy: z.enum(["custom", "friendly_only"]),
    artifactType: z.enum(["round", "presentation", "feedback_room"]).default("round"),
    destination: z.string().startsWith("/").default("/join"),
  })
  .strict();
export type JoinPreflightResponse = z.input<typeof JoinPreflightResponseSchema>;
export type ResolvedJoinPreflightResponse = z.output<typeof JoinPreflightResponseSchema>;

export const JoinRequestSchema = z.object({
  code: z
    .string()
    .trim()
    .regex(/^\d{7}$/),
  nickname: z.string().trim().min(1).max(32).optional(),
  avatarId: AvatarIdSchema.optional(),
  resumeToken: z.string().min(20).max(1_000).optional(),
});
export type JoinRequest = z.infer<typeof JoinRequestSchema>;

export const JoinResponseSchema = z.object({
  participantId: z.string().uuid(),
  participantToken: z.string(),
  snapshot: SessionSnapshotSchema,
});
export type ResolvedJoinResponse = z.output<typeof JoinResponseSchema>;
export type JoinResponse = Omit<ResolvedJoinResponse, "snapshot"> & {
  snapshot: SessionSnapshot;
};

export const SessionStaffRoleSchema = z.enum(["cohost", "presenter"]);
export type SessionStaffRole = z.infer<typeof SessionStaffRoleSchema>;
export const SessionStaffPurposeSchema = z.enum(["collaboration", "creator_resume"]);
export type SessionStaffPurpose = z.infer<typeof SessionStaffPurposeSchema>;

export const CreateSessionStaffCredentialSchema = z.object({
  role: SessionStaffRoleSchema,
  label: z.string().trim().max(80).default(""),
  expiresInMinutes: z
    .number()
    .int()
    .min(5)
    .max(24 * 60)
    .default(240),
});

export const SessionStaffCredentialSchema = z.object({
  id: z.string().uuid(),
  sessionId: z.string().uuid(),
  role: SessionStaffRoleSchema,
  purpose: SessionStaffPurposeSchema.default("collaboration"),
  label: z.string(),
  expiresAt: z.string().datetime(),
  revokedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
});
export type SessionStaffCredential = z.infer<typeof SessionStaffCredentialSchema>;

export const CreateSessionStaffCredentialResponseSchema = z.object({
  credential: SessionStaffCredentialSchema,
  token: z.string().min(20),
  embedPolicyKey: z.string().min(20).optional(),
  embedAllowedOrigins: z.array(z.string().url()).max(10).optional(),
});
export type CreateSessionStaffCredentialResponse = z.infer<
  typeof CreateSessionStaffCredentialResponseSchema
>;

export const CreatorControlPassResponseSchema = z.object({
  credential: SessionStaffCredentialSchema.extend({
    role: z.literal("cohost"),
    purpose: z.literal("creator_resume"),
  }),
  token: z.string().min(20),
});
export type CreatorControlPassResponse = z.infer<typeof CreatorControlPassResponseSchema>;

const HttpsOriginSchema = z
  .string()
  .trim()
  .url()
  .superRefine((value, context) => {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:") {
      context.addIssue({ code: "custom", message: "Embed origins must use HTTPS" });
    }
    if (
      parsed.username ||
      parsed.password ||
      parsed.pathname !== "/" ||
      parsed.search ||
      parsed.hash
    ) {
      context.addIssue({
        code: "custom",
        message: "Enter an origin only, such as https://learning.example.org",
      });
    }
  })
  .transform((value) => new URL(value).origin);

export const EmbedAllowedOriginsSchema = z.object({
  origins: z
    .array(HttpsOriginSchema)
    .max(10)
    .transform((origins) => [...new Set(origins)]),
});
export type EmbedAllowedOrigins = z.infer<typeof EmbedAllowedOriginsSchema>;

export const EmbedPolicySchema = z.object({
  sessionId: z.string().uuid(),
  allowedOrigins: z.array(HttpsOriginSchema).max(10),
  expiresAt: z.string().datetime(),
});
export type EmbedPolicy = z.infer<typeof EmbedPolicySchema>;

export const WorkspaceRoleSchema = z.enum(["owner", "editor", "viewer"]);
export type WorkspaceRole = z.infer<typeof WorkspaceRoleSchema>;

export const IdentityRequirementSchema = z.enum(["guest", "optional", "institution"]);
export type IdentityRequirement = z.infer<typeof IdentityRequirementSchema>;

export const InstitutionContractStatusSchema = z.enum(["disabled", "pilot", "active"]);
export type InstitutionContractStatus = z.infer<typeof InstitutionContractStatusSchema>;

export const InstitutionCapabilitiesSchema = z.object({
  oidc: z.boolean(),
  managedSso: z.boolean(),
  scim: z.boolean(),
  lti: z.boolean(),
  nrps: z.boolean(),
  ags: z.boolean(),
  auditExports: z.boolean(),
  residencyControls: z.boolean(),
});
export type InstitutionCapabilities = z.infer<typeof InstitutionCapabilitiesSchema>;

function validateInstitutionPolicy(
  policy: {
    contractStatus: InstitutionContractStatus;
    identityRequirement: IdentityRequirement;
    capabilities: InstitutionCapabilities;
  },
  ctx: z.RefinementCtx,
) {
  const enabledCapabilities = Object.entries(policy.capabilities)
    .filter(([, enabled]) => enabled)
    .map(([name]) => name);
  if (
    policy.contractStatus === "disabled" &&
    (policy.identityRequirement !== "guest" || enabledCapabilities.length > 0)
  ) {
    ctx.addIssue({
      code: "custom",
      path: ["contractStatus"],
      message: "A disabled contract must keep guest identity and all capabilities off",
    });
  }
  if (
    (policy.capabilities.nrps || policy.capabilities.ags) &&
    (!policy.capabilities.lti || policy.identityRequirement !== "institution")
  ) {
    ctx.addIssue({
      code: "custom",
      path: ["capabilities"],
      message: "NRPS and AGS require LTI with institution-identified participation",
    });
  }
  if (policy.capabilities.scim && !policy.capabilities.managedSso) {
    ctx.addIssue({
      code: "custom",
      path: ["capabilities", "scim"],
      message: "SCIM requires managed SSO",
    });
  }
}

export const WorkspaceInstitutionPolicySchema = z
  .object({
    workspaceId: z.string().uuid(),
    contractStatus: InstitutionContractStatusSchema,
    identityRequirement: IdentityRequirementSchema,
    capabilities: InstitutionCapabilitiesSchema,
    k12Enabled: z.literal(false),
    updatedAt: z.string().datetime().nullable(),
  })
  .superRefine(validateInstitutionPolicy);
export type WorkspaceInstitutionPolicy = z.infer<typeof WorkspaceInstitutionPolicySchema>;

export const UpdateWorkspaceInstitutionPolicySchema = z
  .object({
    contractStatus: InstitutionContractStatusSchema,
    identityRequirement: IdentityRequirementSchema,
    capabilities: InstitutionCapabilitiesSchema,
    // This release deliberately cannot enable K-12 through an API call.
    k12Enabled: z.literal(false).default(false),
  })
  .superRefine(validateInstitutionPolicy);
export type UpdateWorkspaceInstitutionPolicy = z.infer<
  typeof UpdateWorkspaceInstitutionPolicySchema
>;

export const FederatedIdentitySchema = z.object({
  id: z.string().uuid(),
  provider: z.enum(["oidc", "lti"]),
  issuer: z.string().url(),
  emailHint: z.string().email().nullable(),
  linkedAt: z.string().datetime(),
  lastUsedAt: z.string().datetime().nullable(),
});
export type FederatedIdentity = z.infer<typeof FederatedIdentitySchema>;

export const OidcStartSchema = z.object({
  workspaceId: z.string().uuid(),
  mode: z.enum(["login", "link"]),
});

export const OidcStatusSchema = z.object({
  enabled: z.boolean(),
  providerName: z.string().min(1).max(80).nullable(),
  workspaceId: z.string().uuid(),
  identityRequirement: IdentityRequirementSchema,
});
export type OidcStatus = z.infer<typeof OidcStatusSchema>;

export const LtiRegistrationStatusSchema = z.enum(["disabled", "active"]);
export const LtiRegistrationSchema = z.object({
  id: z.string().uuid(),
  workspaceId: z.string().uuid(),
  name: z.string().min(1).max(120),
  issuer: z.string().url(),
  clientId: z.string().min(1).max(500),
  deploymentId: z.string().min(1).max(500),
  authorizationEndpoint: z.string().url(),
  tokenEndpoint: z.string().url().nullable(),
  jwksUrl: z.string().url(),
  deepLinkReturnOrigins: z.array(z.string().url()).max(10),
  status: LtiRegistrationStatusSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type LtiRegistration = z.infer<typeof LtiRegistrationSchema>;

export const UpsertLtiRegistrationSchema = z.object({
  name: z.string().trim().min(1).max(120),
  issuer: z.string().url().max(2_048),
  clientId: z.string().trim().min(1).max(500),
  deploymentId: z.string().trim().min(1).max(500),
  authorizationEndpoint: z.string().url().max(2_048),
  tokenEndpoint: z.string().url().max(2_048).nullable().default(null),
  jwksUrl: z.string().url().max(2_048),
  deepLinkReturnOrigins: z
    .array(z.string().url().max(2_048))
    .max(10)
    .transform((values) => [...new Set(values.map((value) => new URL(value).origin))]),
  status: LtiRegistrationStatusSchema.default("active"),
});

export const LtiLoginInitiationSchema = z.object({
  iss: z.string().url().max(2_048),
  login_hint: z.string().min(1).max(2_048),
  target_link_uri: z.string().url().max(2_048),
  lti_message_hint: z.string().min(1).max(8_192).optional(),
  client_id: z.string().min(1).max(500).optional(),
  lti_deployment_id: z.string().min(1).max(500).optional(),
});

export const LtiLaunchFormSchema = z.object({
  state: z.string().min(20).max(1_000),
  id_token: z.string().min(20).max(64_000),
});

export const LtiLaunchViewSchema = z.object({
  id: z.string().uuid(),
  messageType: z.enum(["LtiResourceLinkRequest", "LtiDeepLinkingRequest"]),
  role: z.enum(["instructor", "learner"]),
  quizId: z.string().uuid().nullable(),
  expiresAt: z.string().datetime(),
});
export type LtiLaunchView = z.infer<typeof LtiLaunchViewSchema>;

export const LtiDeepLinkSelectionSchema = z.object({ quizId: z.string().uuid() });

export const CreateWorkspaceInvitationSchema = z.object({
  email: z
    .string()
    .trim()
    .email()
    .max(320)
    .transform((value) => value.toLocaleLowerCase()),
  role: WorkspaceRoleSchema.exclude(["owner"]),
});

export const AcceptWorkspaceInvitationSchema = z.object({
  token: z.string().min(20).max(1_000),
  acceptPolicies: z.literal(true),
});

export const UpdateWorkspaceMemberSchema = z.object({
  role: WorkspaceRoleSchema.exclude(["owner"]),
});

export const WorkspaceSummarySchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  segment: z.enum(["education", "workplace"]),
  role: WorkspaceRoleSchema,
  homeRegion: z.string(),
});
export type WorkspaceSummary = z.infer<typeof WorkspaceSummarySchema>;

export const WorkspaceMemberSchema = z.object({
  userId: z.string().uuid(),
  email: z.string().email(),
  role: WorkspaceRoleSchema,
  joinedAt: z.string().datetime().nullable(),
});
export type WorkspaceMember = z.infer<typeof WorkspaceMemberSchema>;

export const WorkspaceInvitationSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  role: WorkspaceRoleSchema.exclude(["owner"]),
  invitedBy: z.string().uuid(),
  expiresAt: z.string().datetime(),
  acceptedAt: z.string().datetime().nullable(),
  revokedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
});
export type WorkspaceInvitation = z.infer<typeof WorkspaceInvitationSchema>;

export const QnaDisplayModeSchema = z.enum(["anonymous_public", "alias_public"]);
export const QnaModerationModeSchema = z.enum(["pre", "post"]);
export const QnaQuestionStatusSchema = z.enum([
  "pending",
  "published",
  "answered",
  "dismissed",
  "removed",
]);
export const QnaReplyStatusSchema = z.enum(["pending", "published", "removed"]);

export const QnaSettingsSchema = z.object({
  enabled: z.boolean(),
  displayMode: QnaDisplayModeSchema,
  moderationMode: QnaModerationModeSchema,
  participantReplies: z.boolean(),
});
export type QnaSettings = z.infer<typeof QnaSettingsSchema>;

export const UpdateQnaSettingsSchema = QnaSettingsSchema.partial().refine(
  (update) => Object.keys(update).length > 0,
  "Provide at least one Q&A setting",
);

export const CreateQnaQuestionSchema = z.object({
  body: z.string().trim().min(1).max(1_000),
});

export const CreateQnaReplySchema = z.object({
  body: z.string().trim().min(1).max(1_000),
});

export const ModerateQnaQuestionSchema = z.object({
  status: QnaQuestionStatusSchema,
  label: z.string().trim().max(80).nullable().optional(),
  banParticipant: z.boolean().default(false),
});

export const ModerateQnaReplySchema = z.object({
  status: QnaReplyStatusSchema,
});

export const QnaReplySchema = z.object({
  id: z.string().uuid(),
  questionId: z.string().uuid(),
  body: z.string(),
  status: QnaReplyStatusSchema,
  author: z.object({
    displayName: z.string(),
    kind: z.enum(["participant", "staff"]),
    mine: z.boolean(),
  }),
  createdAt: z.string().datetime(),
});
export type QnaReply = z.infer<typeof QnaReplySchema>;

export const QnaQuestionSchema = z.object({
  id: z.string().uuid(),
  body: z.string(),
  status: QnaQuestionStatusSchema,
  label: z.string().nullable(),
  author: z.object({
    displayName: z.string(),
    mine: z.boolean(),
  }),
  voteCount: z.number().int().nonnegative(),
  votedByMe: z.boolean(),
  replies: z.array(QnaReplySchema),
  createdAt: z.string().datetime(),
  moderationParticipantId: z.string().uuid().optional(),
});
export type QnaQuestion = z.infer<typeof QnaQuestionSchema>;

export const QnaPageSchema = z.object({
  questions: z.array(QnaQuestionSchema),
  nextCursor: z.string().nullable(),
  settings: QnaSettingsSchema,
});
export type QnaPage = z.infer<typeof QnaPageSchema>;
export const ScopedQnaPageSchema = QnaPageSchema.extend({
  schemaVersion: z.literal(1),
  audienceSeq: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  lifecycle: z.enum(["open", "closed"]),
}).strict();
export type ScopedQnaPage = z.infer<typeof ScopedQnaPageSchema>;

export const AudienceSignalSchema = z.enum(["got_it", "unsure", "need_example", "too_fast"]);
export type AudienceSignal = z.infer<typeof AudienceSignalSchema>;

export const ChatReactionSchema = z.enum(["like", "love", "insight", "laugh"]);
export type ChatReaction = z.infer<typeof ChatReactionSchema>;

export const InteractionSettingsSchema = z.object({
  signalsEnabled: z.boolean(),
  chatEnabled: z.boolean(),
  chatIdentityMode: z.enum(["alias_public", "alias_private"]),
  slowModeSeconds: z.union([z.literal(0), z.literal(5), z.literal(15), z.literal(30)]),
  presenterFeedMode: z.enum(["off", "pinned", "live"]),
});
export type InteractionSettings = z.infer<typeof InteractionSettingsSchema>;

export const UpdateInteractionSettingsSchema = InteractionSettingsSchema.partial().refine(
  (update) => Object.keys(update).length > 0,
  "Provide at least one interaction setting",
);

export const SetAudienceSignalSchema = z.object({
  signal: AudienceSignalSchema.nullable(),
  idempotencyKey: z.string().min(8).max(160),
});

export const CreateChatMessageSchema = z.object({
  body: z.string().trim().min(1).max(500),
  replyToMessageId: z.string().uuid().nullable().default(null),
  idempotencyKey: z.string().min(8).max(160),
});

export const ModerateChatMessageSchema = z
  .object({
    status: z.enum(["published", "removed"]).optional(),
    pinned: z.boolean().optional(),
  })
  .refine((update) => update.status !== undefined || update.pinned !== undefined, {
    message: "Provide a moderation change",
  });

export const SetChatReactionSchema = z.object({
  reaction: ChatReactionSchema,
});

export const ModerateAudienceParticipantSchema = z.object({
  action: z.enum(["mute", "unmute", "ban", "unban"]),
  durationMinutes: z.union([z.literal(5), z.literal(15), z.literal(60)]).optional(),
});

export const ChatAuthorSchema = z.object({
  displayName: z.string(),
  kind: z.enum(["participant", "staff"]),
  mine: z.boolean(),
});

export const ChatMessageSchema = z.object({
  id: z.string().uuid(),
  audienceSeq: z.number().int().nonnegative(),
  body: z.string(),
  status: z.enum(["published", "removed"]),
  author: ChatAuthorSchema,
  replyToMessageId: z.string().uuid().nullable(),
  pinned: z.boolean(),
  reactions: z.record(ChatReactionSchema, z.number().int().nonnegative()),
  myReaction: ChatReactionSchema.nullable(),
  createdAt: z.string().datetime(),
  moderationParticipantId: z.string().uuid().optional(),
});
export type ChatMessage = z.infer<typeof ChatMessageSchema>;

export const ChatPageSchema = z.object({
  messages: z.array(ChatMessageSchema),
  nextCursor: z.string().nullable(),
  settings: InteractionSettingsSchema,
  audienceSeq: z.number().int().nonnegative(),
});
export type ChatPage = z.infer<typeof ChatPageSchema>;

export const SignalCountsSchema = z.object({
  got_it: z.number().int().nonnegative(),
  unsure: z.number().int().nonnegative(),
  need_example: z.number().int().nonnegative(),
  too_fast: z.number().int().nonnegative(),
});

export const ParticipantInteractionViewSchema = z.object({
  participantId: z.string().uuid(),
  nickname: z.string(),
  avatarId: AvatarIdSchema.optional(),
  connected: z.boolean(),
  answered: z.boolean(),
  currentSignal: AudienceSignalSchema.nullable(),
  lastSignalAt: z.string().datetime().nullable(),
  lastActivityAt: z.string().datetime().nullable(),
  chatMessageCount: z.number().int().nonnegative(),
  mutedUntil: z.string().datetime().nullable(),
  banned: z.boolean(),
});
export type ParticipantInteractionView = z.infer<typeof ParticipantInteractionViewSchema>;

export const InteractionSummarySchema = z.object({
  audienceSeq: z.number().int().nonnegative(),
  contextKey: z.string(),
  connectedParticipants: z.number().int().nonnegative(),
  disconnectedParticipants: z.number().int().nonnegative(),
  answeredParticipants: z.number().int().nonnegative(),
  uniqueSignalers: z.number().int().nonnegative(),
  signalCounts: SignalCountsSchema.nullable(),
  signalsLastMinute: z.number().int().nonnegative(),
  messagesLastMinute: z.number().int().nonnegative(),
  uniqueChatContributors: z.number().int().nonnegative(),
  moderationCount: z.number().int().nonnegative(),
  reportedCount: z.number().int().nonnegative(),
  mySignal: AudienceSignalSchema.nullable().optional(),
  participants: z.array(ParticipantInteractionViewSchema).optional(),
});
export type InteractionSummary = z.infer<typeof InteractionSummarySchema>;

export const AudienceEventEnvelopeSchema = z.object({
  eventId: z.string().uuid(),
  sessionId: z.string().uuid(),
  audienceSeq: z.number().int().nonnegative(),
  schemaVersion: z.literal(1),
  serverTime: z.string().datetime(),
  type: z.string(),
  payload: z.unknown(),
});
export type AudienceEventEnvelope<T = unknown> = Omit<
  z.infer<typeof AudienceEventEnvelopeSchema>,
  "payload"
> & { payload: T };

export const AudienceSyncRequestSchema = z
  .object({
    sessionId: z.string().uuid(),
    participantToken: z.string().min(20).max(1_000).optional(),
    hostToken: z.string().min(20).max(1_000).optional(),
    limit: z.number().int().min(1).max(50).default(50),
  })
  .refine((input) => Boolean(input.participantToken) !== Boolean(input.hostToken), {
    message: "Provide exactly one audience synchronization credential",
  });

export const AnswerSubmitSchema = z
  .object({
    sessionId: z.string().uuid(),
    roundId: z.string().uuid(),
    choiceId: z.string().uuid().optional(),
    response: ResponsePayloadSchema.optional(),
    confidence: ConfidenceValueSchema.optional(),
    participantToken: z.string().min(20),
    idempotencyKey: z.string().min(8).max(160),
  })
  .superRefine((answer, context) => {
    if (Boolean(answer.choiceId) === Boolean(answer.response)) {
      context.addIssue({
        code: "custom",
        message: "Provide either the legacy choiceId or a response payload",
        path: ["response"],
      });
    }
  });
export type AnswerSubmit = z.infer<typeof AnswerSubmitSchema>;

export function responseForAnswer(answer: AnswerSubmit): ResponsePayload {
  return canonicalizeResponse(answer.response ?? { kind: "choice", choiceIds: [answer.choiceId!] });
}

export const AnswerAckSchema = z.object({
  accepted: z.boolean(),
  answerId: z.string().uuid().optional(),
  acceptedAt: z.string().datetime().optional(),
  score: z.number().int().optional(),
  duplicate: z.boolean().default(false),
  code: ErrorCodeSchema.optional(),
});
export type AnswerAck = z.infer<typeof AnswerAckSchema>;

export const HostActionSchema = z.enum([
  "start",
  "pause",
  "resume",
  "lock",
  "reveal",
  "next",
  "show_leaderboard",
  "end",
  "lock_lobby",
  "unlock_lobby",
  "kick",
  "intervention.start",
  "intervention.finish",
  "recheck.open",
]);
export type HostAction = z.infer<typeof HostActionSchema>;

export const HostCommandSchema = z
  .object({
    sessionId: z.string().uuid(),
    hostToken: z.string().min(20),
    commandId: z.string().min(8).max(160),
    expectedVersion: z.number().int().nonnegative(),
    action: HostActionSchema,
    participantId: z.string().uuid().optional(),
    interventionType: InterventionTypeSchema.optional(),
    recheckMode: z.enum(["linked", "revote"]).optional(),
    recheckQuestionId: z.string().uuid().optional(),
    recoveryPackCard: RecoveryPackCardSelectionSchema.optional(),
  })
  .superRefine((command, context) => {
    if (
      command.recoveryPackCard &&
      (command.action !== "intervention.start" ||
        (command.interventionType !== "explain" && command.interventionType !== "example"))
    ) {
      context.addIssue({
        code: "custom",
        message: "Recovery Pack cards can only start an explanation or example intervention",
        path: ["recoveryPackCard"],
      });
    }
    if (command.action === "kick" && !command.participantId) {
      context.addIssue({
        code: "custom",
        message: "participantId is required when kicking a participant",
        path: ["participantId"],
      });
    }
    if (command.action === "intervention.start" && !command.interventionType) {
      context.addIssue({
        code: "custom",
        message: "interventionType is required when starting an intervention",
        path: ["interventionType"],
      });
    }
    if (command.action === "recheck.open" && !command.recheckMode) {
      context.addIssue({
        code: "custom",
        message: "recheckMode is required when opening a recheck",
        path: ["recheckMode"],
      });
    }
  });
export type HostCommand = z.infer<typeof HostCommandSchema>;

export const SyncRequestSchema = z
  .object({
    sessionId: z.string().uuid(),
    role: z.enum(["host", "presenter", "participant"]),
    hostToken: z.string().min(20).max(1_000).optional(),
    participantToken: z.string().min(20).max(1_000).optional(),
    lastSeq: z.number().int().nonnegative().default(0),
  })
  .superRefine((request, context) => {
    if (request.role === "participant" && !request.participantToken) {
      context.addIssue({
        code: "custom",
        message: "participantToken is required for participant synchronization",
        path: ["participantToken"],
      });
    }
    if (request.role !== "participant" && !request.hostToken) {
      context.addIssue({
        code: "custom",
        message: "hostToken is required for host or presenter synchronization",
        path: ["hostToken"],
      });
    }
  });
export type SyncRequest = z.infer<typeof SyncRequestSchema>;

export const SyncResponseSchema = z.object({
  snapshot: SessionSnapshotSchema,
  replay: z.array(EventEnvelopeSchema),
  replayComplete: z.boolean(),
});
export type ResolvedSyncResponse = z.output<typeof SyncResponseSchema>;
export type SyncResponse = Omit<ResolvedSyncResponse, "snapshot"> & {
  snapshot: SessionSnapshot;
};

export const MediaScanStatusSchema = z.enum(["pending", "clean", "rejected"]);
export type MediaScanStatus = z.infer<typeof MediaScanStatusSchema>;

export const MediaUploadRequestSchema = z.object({
  fileName: z.string().trim().min(1).max(200),
  mimeType: z.enum(["image/jpeg", "image/png", "image/webp"]),
  sizeBytes: z
    .number()
    .int()
    .min(1)
    .max(10 * 1024 * 1024),
  altText: z.string().trim().min(1).max(300),
});
export type MediaUploadRequest = z.infer<typeof MediaUploadRequestSchema>;

export const MediaUploadTicketSchema = z.object({
  mediaId: z.string().uuid(),
  uploadUrl: z.string().url(),
  expiresInSeconds: z.number().int().positive(),
  scanStatus: z.literal("pending"),
});
export type MediaUploadTicket = z.infer<typeof MediaUploadTicketSchema>;

export const MediaAccessSchema = z.object({
  media: z.object({
    id: z.string().uuid(),
    scanStatus: MediaScanStatusSchema,
    altText: z.string().min(1).max(300),
  }),
  downloadUrl: z.string().url().optional(),
});
export type MediaAccess = z.infer<typeof MediaAccessSchema>;

export const CreateQuizSchema = z.object({
  title: z.string().trim().min(1, "Enter a Round title").max(160),
  description: z.string().trim().max(1_000).default(""),
});

export const UpdateQuizSchema = QuizDraftSchema;

export const DraftRevisionSchema = z.number().int().nonnegative();
export type DraftRevision = z.infer<typeof DraftRevisionSchema>;

/** Revision-aware replacement payload retained on the legacy PATCH route during migration. */
export const RevisionedUpdateQuizSchema = z.object({
  draft: QuizDraftSchema,
  expectedDraftRevision: DraftRevisionSchema,
});
export type RevisionedUpdateQuiz = z.infer<typeof RevisionedUpdateQuizSchema>;

/** Revision-fenced, idempotent Round draft replacement used by the professional Builder. */
export const RoundDraftMutationSchema = z.object({
  draft: QuizDraftSchema,
  expectedRevision: DraftRevisionSchema,
  mutationId: z.string().uuid(),
  schemaVersion: z.literal(1),
});
export type RoundDraftMutation = z.infer<typeof RoundDraftMutationSchema>;

export const RestoreRoundDraftHistorySchema = z.object({
  expectedRevision: DraftRevisionSchema,
  mutationId: z.string().uuid(),
});
export type RestoreRoundDraftHistory = z.infer<typeof RestoreRoundDraftHistorySchema>;

export const UpdateQuizRequestSchema = RevisionedUpdateQuizSchema;
export type UpdateQuizRequest = z.infer<typeof UpdateQuizRequestSchema>;

export const PublishQuizRequestSchema = z.object({
  expectedDraftRevision: DraftRevisionSchema,
});
export type PublishQuizRequest = z.infer<typeof PublishQuizRequestSchema>;

export const StarterIdSchema = z.enum([
  "exit-ticket",
  "misconception-check",
  "technical-concept-check",
  "compliance-scenario",
  "new-hire-knowledge-check",
  "icebreaker-poll",
  "retrieval-practice",
  "scientific-reasoning",
  "data-literacy",
  "percentage-check",
  "cybersecurity-basics",
  "api-design",
  "incident-response",
  "accessibility-awareness",
  "project-kickoff",
  "team-retrospective",
  "meeting-priorities",
  "training-feedback",
  "course-pulse",
  "workshop-expectations",
  "change-readiness",
  "customer-discovery",
  "this-or-that",
  "weekend-warmup",
]);
export type StarterId = z.infer<typeof StarterIdSchema>;

export const StarterSummarySchema = z.object({
  id: StarterIdSchema,
  title: z.string().min(1).max(160),
  description: z.string().min(1).max(500),
  segment: z.enum(["all", "education", "workplace"]),
  category: RoundCategorySchema,
  experiencePreset: ExperiencePresetRefSchema,
  questionCount: z.number().int().positive(),
  responseTypes: z.array(QuestionTypeSchema).min(1),
  version: z.literal(1),
  roundType: z.enum(["quiz", "poll", "custom"]).default("custom"),
});
export type StarterSummary = z.infer<typeof StarterSummarySchema>;

export const StartersResponseSchema = z.object({
  starters: z.array(StarterSummarySchema),
});
export type StartersResponse = z.infer<typeof StartersResponseSchema>;

export const RoundFilterOptionSchema = z.object({
  id: z.string().uuid(),
  title: z.string().min(1).max(160),
});
export type RoundFilterOption = z.infer<typeof RoundFilterOptionSchema>;
export const RoundFilterOptionsResponseSchema = z.object({
  quizzes: z.array(RoundFilterOptionSchema),
});
export type RoundFilterOptionsResponse = z.infer<typeof RoundFilterOptionsResponseSchema>;

export const SessionHistoryStatusSchema = z.enum(["active", "finished", "expired"]);
export type SessionHistoryStatus = z.infer<typeof SessionHistoryStatusSchema>;
export const SessionSummarySchema = z.object({
  id: z.string().uuid(),
  quizId: z.string().uuid(),
  title: z.string().min(1).max(160),
  status: SessionHistoryStatusSchema,
  phase: SessionPhaseSchema,
  code: z.string().regex(/^\d{7}$/),
  participantCount: z.number().int().nonnegative(),
  answerCount: z.number().int().nonnegative(),
  questionCount: z.number().int().nonnegative(),
  questionPosition: z.number().int().positive().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
  reportId: z.string().uuid().nullable(),
});
export type SessionSummary = z.infer<typeof SessionSummarySchema>;

const RecoverySummarySchema = z.object({
  recovered: z.number().int().nonnegative(),
  eligible: z.number().int().nonnegative(),
  percent: z.number().min(0).max(100).nullable(),
});

export const FollowupHistoryStatusSchema = z.enum(["scheduled", "open", "closed", "expired"]);
export type FollowupHistoryStatus = z.infer<typeof FollowupHistoryStatusSchema>;
export const FollowupPurposeSchema = z.enum(["recovery", "assignment"]);
export type FollowupPurpose = z.infer<typeof FollowupPurposeSchema>;

export const ReportSummarySchema = z.object({
  id: z.string().uuid(),
  sessionId: z.string().uuid(),
  trustMode: TrustModeSchema.default("learning"),
  quizId: z.string().uuid(),
  title: z.string().min(1).max(160),
  status: z.enum(["pending", "ready", "failed"]),
  participantCount: z.number().int().nonnegative(),
  initialAccuracyPercent: z.number().min(0).max(100),
  recovery: RecoverySummarySchema,
  unresolvedConceptCount: z.number().int().nonnegative(),
  interventionCount: z.number().int().nonnegative(),
  followupId: z.string().uuid().nullable(),
  followupStatus: FollowupHistoryStatusSchema.nullable(),
  generatedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
});
export type ReportSummary = z.infer<typeof ReportSummarySchema>;

const FollowupSummaryBaseSchema = z.object({
  id: z.string().uuid(),
  trustMode: TrustModeSchema.default("learning"),
  sourceQuizVersionId: z.string().uuid().nullable(),
  quizId: z.string().uuid().nullable(),
  recoveryPackSource: RecoveryPackPracticeSourceSchema.nullable().default(null),
  title: z.string().min(1).max(160),
  status: FollowupHistoryStatusSchema,
  conceptKeys: z.array(ConceptKeySchema),
  checkpointCount: z.number().int().positive(),
  attemptCount: z.number().int().nonnegative(),
  completedAttemptCount: z.number().int().nonnegative(),
  opensAt: z.string().datetime(),
  closesAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
  createdAt: z.string().datetime(),
});
export const FollowupSummarySchema = z
  .discriminatedUnion("purpose", [
    FollowupSummaryBaseSchema.extend({
      purpose: z.literal("recovery"),
      sourceSessionId: z.string().uuid(),
      sourceReportId: z.string().uuid(),
      conceptKeys: z.array(ConceptKeySchema).min(1).max(12),
      sourceQuizVersionId: z.string().uuid(),
      quizId: z.string().uuid(),
      recoveryPackSource: z.null().default(null),
    }),
    FollowupSummaryBaseSchema.extend({
      purpose: z.literal("assignment"),
      sourceSessionId: z.null(),
      sourceReportId: z.null(),
      conceptKeys: z.array(ConceptKeySchema).length(0),
    }),
  ])
  .superRefine((input, context) => {
    if (input.purpose !== "assignment") return;
    if (
      input.recoveryPackSource
        ? input.sourceQuizVersionId !== null || input.quizId !== null
        : input.sourceQuizVersionId === null || input.quizId === null
    ) {
      context.addIssue({
        code: "custom",
        path: ["recoveryPackSource"],
        message: "Practice must reference either a Round version or a frozen Recovery Pack source",
      });
    }
    if (
      input.recoveryPackSource &&
      input.checkpointCount !== (input.recoveryPackSource.role === "full_sequence" ? 2 : 1)
    )
      context.addIssue({
        code: "custom",
        path: ["checkpointCount"],
        message: "Pack practice checkpoint count must match its frozen mode",
      });
  });
export type FollowupSummary = z.infer<typeof FollowupSummarySchema>;

export const SessionSummaryPageSchema = z.object({
  items: z.array(SessionSummarySchema),
  nextCursor: z.string().nullable(),
});
export type SessionSummaryPage = z.infer<typeof SessionSummaryPageSchema>;
export const ReportSummaryPageSchema = z.object({
  items: z.array(ReportSummarySchema),
  nextCursor: z.string().nullable(),
});
export type ReportSummaryPage = z.infer<typeof ReportSummaryPageSchema>;
export const FollowupSummaryPageSchema = z.object({
  items: z.array(FollowupSummarySchema),
  nextCursor: z.string().nullable(),
});
export type FollowupSummaryPage = z.infer<typeof FollowupSummaryPageSchema>;

export const ReportContextSchema = z.object({
  quizId: z.string().uuid(),
  quizTitle: z.string().min(1).max(160),
  sessionCreatedAt: z.string().datetime(),
  sessionUpdatedAt: z.string().datetime(),
});
export type ReportContext = z.infer<typeof ReportContextSchema>;

export const ProductEventNameSchema = z.enum([
  "creation_started",
  "creation_completed",
  "first_block_created",
  "draft_save_failed",
  "draft_conflict",
  "publish_blocked",
  "creation_abandoned",
  "presentation_host_started",
  "presentation_reconnected",
  "round_published",
  "setup_recipe_selected",
  "host_setup_completed",
  "participant_joined",
  "first_answer_submitted",
  "response_saved_acknowledged",
  "question_locked",
  "insight_shown",
  "intervention_started",
  "recheck_opened",
  "linked_recheck_opened",
  "report_reconciled",
  "report_viewed",
  "followup_shared",
  "practice_assignment_created",
  "practice_assignment_shared",
  "rehearsal_started",
  "rehearsal_completed",
]);
export type ProductEventName = z.infer<typeof ProductEventNameSchema>;
export const ProductEventSchema = z
  .object({
    name: ProductEventNameSchema,
    occurredAt: z.string().datetime(),
    dimensions: z
      .object({
        creationPath: z.enum(["starter", "source", "import", "blank"]).optional(),
        artifactType: z.enum(["round", "presentation"]).optional(),
        recipe: z.enum(["recovery", "friendly_competition", "open_discussion"]).optional(),
        scenario: z.enum(["low_participation", "split_room", "confident_misconception"]).optional(),
        segment: z.enum(["education", "workplace"]).optional(),
        betaVersion: z.literal("p0-2026").optional(),
        durationBucket: z.enum(["under_1m", "1_to_5m", "5_to_15m", "over_15m"]).optional(),
      })
      .strict()
      .default({}),
  })
  .strict()
  .superRefine((event, context) => {
    if (
      (event.name === "creation_started" || event.name === "creation_completed") &&
      !event.dimensions.creationPath
    ) {
      context.addIssue({
        code: "custom",
        path: ["dimensions", "creationPath"],
        message: "Creation events require a creation path",
      });
    }
    if (
      [
        "creation_started",
        "creation_completed",
        "first_block_created",
        "draft_save_failed",
        "draft_conflict",
        "publish_blocked",
        "creation_abandoned",
        "presentation_host_started",
        "presentation_reconnected",
      ].includes(event.name) &&
      !event.dimensions.artifactType
    ) {
      context.addIssue({
        code: "custom",
        path: ["dimensions", "artifactType"],
        message: "Authoring events require an artifact type",
      });
    }
    if (
      (event.name === "presentation_host_started" || event.name === "presentation_reconnected") &&
      event.dimensions.artifactType !== "presentation"
    ) {
      context.addIssue({
        code: "custom",
        path: ["dimensions", "artifactType"],
        message: "Presentation delivery events require the presentation artifact type",
      });
    }
    if (
      (event.name === "linked_recheck_opened" || event.name === "report_reconciled") &&
      !event.dimensions.artifactType
    ) {
      context.addIssue({
        code: "custom",
        path: ["dimensions", "artifactType"],
        message: "Recovery evidence events require an artifact type",
      });
    }
    if (event.name === "setup_recipe_selected" && !event.dimensions.recipe) {
      context.addIssue({
        code: "custom",
        path: ["dimensions", "recipe"],
        message: "Setup recipe selection requires a recipe",
      });
    }
    if (
      (event.name === "rehearsal_started" || event.name === "rehearsal_completed") &&
      !event.dimensions.scenario
    ) {
      context.addIssue({
        code: "custom",
        path: ["dimensions", "scenario"],
        message: "Rehearsal events require a scenario",
      });
    }
    if (event.name === "rehearsal_completed" && !event.dimensions.durationBucket) {
      context.addIssue({
        code: "custom",
        path: ["dimensions", "durationBucket"],
        message: "Completed rehearsals require a duration bucket",
      });
    }
  });
export type ProductEvent = z.infer<typeof ProductEventSchema>;

export const ProductEventBatchSchema = z
  .object({
    events: z.array(ProductEventSchema).min(1).max(20),
  })
  .strict();
export type ProductEventBatch = z.infer<typeof ProductEventBatchSchema>;

export const CreateSessionSchema = z.object({
  quizId: z.string().uuid(),
  settings: SessionSettingsSchema,
  experiencePresetOverride: ExperiencePresetIdSchema.optional(),
  presenterSoundEnabled: z.boolean().default(false),
});

export const CreateSessionResponseSchema = z.object({
  sessionId: z.string().uuid(),
  code: z.string().regex(/^\d{7}$/),
  hostToken: z.string(),
  snapshot: SessionSnapshotSchema,
});

function hasControlCharacter(value: string) {
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 0x1f || codePoint === 0x7f;
  });
}

export const LocalReturnPathSchema = z
  .string()
  .max(500)
  .refine(
    (value) =>
      value.startsWith("/") &&
      !value.startsWith("//") &&
      !value.includes("\\") &&
      !hasControlCharacter(value),
    "Return path must be a local application path",
  );

export const MagicLinkRequestSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  segment: z.enum(["education", "workplace"]).default("workplace"),
  acceptPolicies: z.literal(true),
  returnTo: LocalReturnPathSchema.optional(),
});

const ReportMetricsSchema = z.object({
  participantCount: z.number().int().nonnegative(),
  completedCount: z.number().int().nonnegative(),
  answerCount: z.number().int().nonnegative(),
  accuracyPercent: z.number().min(0).max(100),
});

const ReportQuestionSchema = z.object({
  questionId: z.string().uuid(),
  prompt: z.string(),
  responses: z.number().int().nonnegative(),
  correct: z.number().int().nonnegative(),
  accuracyPercent: z.number().min(0).max(100),
  difficult: z.boolean(),
  responseDistribution: ResponseDistributionSchema.optional(),
});

const ReportParticipantSchema = z.object({
  participantId: z.string().uuid(),
  nickname: z.string(),
  avatarId: AvatarIdSchema.optional(),
  score: z.number().int(),
  correctCount: z.number().int().nonnegative(),
  answerCount: z.number().int().nonnegative(),
});

const SessionDecisionEventBaseShape = {
  seq: z.number().int().positive(),
  occurredAt: z.string().datetime(),
};

export const SessionDecisionEventSchema = z.discriminatedUnion("type", [
  z
    .object({
      ...SessionDecisionEventBaseShape,
      type: z.literal("insight_shown"),
      roundId: z.string().uuid(),
      questionId: z.string().uuid(),
      sampleSize: z.number().int().nonnegative(),
      activeParticipantCount: z.number().int().nonnegative(),
      recommendationCode: CheckpointInsightRecommendationCodeSchema,
      ruleSetVersion: z.string().regex(/^checkpoint-insight-v[1-9][0-9]*$/),
    })
    .strict(),
  z
    .object({
      ...SessionDecisionEventBaseShape,
      type: z.literal("answer_revealed"),
      roundId: z.string().uuid(),
      questionId: z.string().uuid(),
    })
    .strict(),
  z
    .object({
      ...SessionDecisionEventBaseShape,
      type: z.literal("intervention_started"),
      roundId: z.string().uuid(),
      interventionType: InterventionTypeSchema,
      recoveryPackCard: RecoveryPackCardReferenceSchema.optional(),
    })
    .strict(),
  z
    .object({
      ...SessionDecisionEventBaseShape,
      type: z.literal("intervention_finished"),
      roundId: z.string().uuid(),
      interventionType: InterventionTypeSchema,
      recoveryPackCard: RecoveryPackCardReferenceSchema.optional(),
    })
    .strict(),
  z
    .object({
      ...SessionDecisionEventBaseShape,
      type: z.literal("recheck_opened"),
      sourceRoundId: z.string().uuid(),
      roundId: z.string().uuid(),
      questionId: z.string().uuid(),
      kind: z.enum(["linked_recheck", "revote"]),
    })
    .strict(),
  z
    .object({
      ...SessionDecisionEventBaseShape,
      type: z.literal("question_advanced"),
      fromRoundId: z.string().uuid(),
      toRoundId: z.string().uuid(),
      questionId: z.string().uuid(),
    })
    .strict(),
  z
    .object({
      ...SessionDecisionEventBaseShape,
      type: z.literal("session_finished"),
      reason: z.enum(["host_ended", "completed"]),
    })
    .strict(),
  z
    .object({
      ...SessionDecisionEventBaseShape,
      type: z.literal("capture_truncated"),
      reason: z.literal("event_limit"),
    })
    .strict(),
]);
export type SessionDecisionEvent = z.infer<typeof SessionDecisionEventSchema>;
export const MAX_SESSION_DECISION_EVENTS = 5_000;

const ReportBaseShape = {
  id: z.string().uuid(),
  sessionId: z.string().uuid(),
  trustMode: TrustModeSchema.default("learning"),
  timeMode: RoundTimeModeSchema.default("timed"),
  decisionReplayAvailable: z.boolean().default(false),
  status: z.enum(["pending", "ready", "failed"]),
  generatedAt: z.string().datetime().nullable(),
  expiresAt: z.string().datetime(),
  metrics: ReportMetricsSchema,
  questions: z.array(ReportQuestionSchema),
  participants: z.array(ReportParticipantSchema),
};

export const LegacyReportSchema = z.object({
  ...ReportBaseShape,
  schemaVersion: z.literal(1).optional(),
});

export const ReportV2Schema = z.object({
  ...ReportBaseShape,
  schemaVersion: z.literal(2),
  initialAccuracy: z.object({
    correct: z.number().int().nonnegative(),
    responses: z.number().int().nonnegative(),
    percent: z.number().min(0).max(100),
  }),
  confidenceMatrix: z.array(
    z.object({
      confidence: ConfidenceValueSchema,
      correct: z.number().int().nonnegative(),
      incorrect: z.number().int().nonnegative(),
      total: z.number().int().nonnegative(),
    }),
  ),
  misconceptions: z.array(
    z.object({
      questionId: z.string().uuid(),
      key: z.string(),
      responses: z.number().int().positive(),
      allResponsePercent: z.number().min(0).max(100),
      wrongResponsePercent: z.number().min(0).max(100),
    }),
  ),
  interventions: z.array(
    z.object({
      id: z.string().uuid(),
      type: InterventionTypeSchema,
      sourceRoundId: z.string().uuid(),
      linkedRecheckRoundId: z.string().uuid().nullable(),
      startedAt: z.string().datetime(),
      finishedAt: z.string().datetime().nullable(),
      recoveryPackCard: RecoveryPackCardReferenceSchema.optional(),
    }),
  ),
  recovery: z.array(
    z.object({
      sourceQuestionId: z.string().uuid(),
      recheckQuestionId: z.string().uuid(),
      sourceRoundId: z.string().uuid(),
      recheckRoundId: z.string().uuid(),
      evidenceType: z.enum(["linked_recheck", "revote"]),
      recovered: z.number().int().nonnegative(),
      initiallyIncorrectWithBoth: z.number().int().nonnegative(),
      recoveryPercent: z.number().min(0).max(100).nullable(),
      smallSample: z.boolean(),
    }),
  ),
  unresolvedConcepts: z.array(
    z.object({
      conceptKey: z.string(),
      initiallyIncorrect: z.number().int().nonnegative(),
      recovered: z.number().int().nonnegative(),
      unresolved: z.number().int().nonnegative(),
    }),
  ),
  participation: z.object({
    participants: z.number().int().nonnegative(),
    respondents: z.number().int().nonnegative(),
    percent: z.number().min(0).max(100),
  }),
  responseTime: z.object({
    responses: z.number().int().nonnegative(),
    medianMs: z.number().int().nonnegative().nullable(),
    p95Ms: z.number().int().nonnegative().nullable(),
  }),
  qna: z.object({
    questions: z.number().int().nonnegative(),
    answered: z.number().int().nonnegative(),
    unresolved: z.number().int().nonnegative(),
  }),
  participantFeedback: z.array(
    z.object({
      participantId: z.string().uuid(),
      correct: z.number().int().nonnegative(),
      responses: z.number().int().nonnegative(),
      unresolvedConcepts: z.array(z.string()),
    }),
  ),
  evidenceNote: z.string(),
});

export const ReportV3Schema = ReportV2Schema.extend({
  schemaVersion: z.literal(3),
  experience: z.object({
    category: RoundCategorySchema,
    preset: ExperiencePresetRefSchema,
  }),
  audiencePulse: z.object({
    uniqueParticipants: z.number().int().nonnegative(),
    events: z.number().int().nonnegative(),
    bySignal: SignalCountsSchema,
    contexts: z.array(
      z.object({
        contextKey: z.string(),
        uniqueParticipants: z.number().int().nonnegative(),
        bySignal: SignalCountsSchema,
      }),
    ),
  }),
  conversation: z.object({
    messages: z.number().int().nonnegative(),
    uniqueContributors: z.number().int().nonnegative(),
    reactions: z.number().int().nonnegative(),
    reports: z.number().int().nonnegative(),
    removed: z.number().int().nonnegative(),
    moderationActions: z.number().int().nonnegative(),
    peakMessagesPerMinute: z.number().int().nonnegative(),
    transcriptAvailable: z.boolean(),
  }),
});

export const ReportV4Schema = ReportV3Schema.extend({
  schemaVersion: z.literal(4),
  decisionReplayAvailable: z.boolean(),
  decisionReplayComplete: z.boolean(),
  decisionTimeline: z.array(SessionDecisionEventSchema).max(MAX_SESSION_DECISION_EVENTS + 1),
});

export const ReportSchema = z.union([
  ReportV4Schema,
  ReportV3Schema,
  ReportV2Schema,
  LegacyReportSchema,
]);
/** Input aliases preserve compatibility while schema parsing resolves the trust-mode default. */
export type Report = z.input<typeof ReportSchema>;
export type ReportV2 = z.input<typeof ReportV2Schema>;
export type ReportV3 = z.input<typeof ReportV3Schema>;
export type ReportV4 = z.input<typeof ReportV4Schema>;
export type ResolvedReport = z.output<typeof ReportSchema>;
export type ResolvedReportV2 = z.output<typeof ReportV2Schema>;
export type ResolvedReportV3 = z.output<typeof ReportV3Schema>;
export type ResolvedReportV4 = z.output<typeof ReportV4Schema>;

export const FollowupTimeModeSchema = z.enum(["timed", "flex"]);
export type FollowupTimeMode = z.infer<typeof FollowupTimeModeSchema>;

export const CreateFollowupSchema = z
  .object({
    conceptKeys: z.array(ConceptKeySchema).min(1).max(12),
    title: z.string().trim().min(1).max(160).optional(),
    timeMode: FollowupTimeModeSchema.default("flex"),
    opensAt: z.string().datetime().optional(),
    closesAt: z.string().datetime(),
  })
  .superRefine((input, context) => {
    if (input.opensAt && new Date(input.opensAt) >= new Date(input.closesAt)) {
      context.addIssue({
        code: "custom",
        path: ["closesAt"],
        message: "The follow-up close time must be after its open time",
      });
    }
  });
export type CreateFollowup = z.infer<typeof CreateFollowupSchema>;

const PracticeRecipientLabelSchema = z.string().trim().min(1).max(80);

export const CreatePracticeAssignmentSchema = z
  .object({
    sourceQuizVersionId: z.string().uuid(),
    title: z.string().trim().min(1).max(160).optional(),
    timeMode: FollowupTimeModeSchema.default("flex"),
    opensAt: z.string().datetime().optional(),
    closesAt: z.string().datetime(),
    personalLabels: z.array(PracticeRecipientLabelSchema).max(250).default([]),
  })
  .superRefine((input, context) => {
    if (input.opensAt && new Date(input.opensAt) >= new Date(input.closesAt)) {
      context.addIssue({
        code: "custom",
        path: ["closesAt"],
        message: "The assignment close time must be after its open time",
      });
    }
    const seen = new Set<string>();
    for (const [index, label] of input.personalLabels.entries()) {
      const key = label.toLocaleLowerCase();
      if (seen.has(key)) {
        context.addIssue({
          code: "custom",
          path: ["personalLabels", index],
          message: "Personal link labels must be unique",
        });
      }
      seen.add(key);
    }
  });
export type CreatePracticeAssignment = z.infer<typeof CreatePracticeAssignmentSchema>;

export const CreateRecoveryPackPracticeAssignmentSchema = z
  .object({
    mode: RecoveryPackPracticeModeSchema.default("delayed_probe"),
    sourcePackVersionId: z.string().uuid(),
    mutationId: z.string().uuid(),
    accessSeed: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
    title: z.string().trim().min(1).max(160).optional(),
    timeMode: FollowupTimeModeSchema.default("flex"),
    opensAt: z.string().datetime().optional(),
    closesAt: z.string().datetime(),
    personalLabels: z.array(PracticeRecipientLabelSchema).max(250).default([]),
  })
  .strict()
  .superRefine((input, context) => {
    if (input.opensAt && new Date(input.opensAt) >= new Date(input.closesAt)) {
      context.addIssue({
        code: "custom",
        path: ["closesAt"],
        message: "The assignment close time must be after its open time",
      });
    }
    const seen = new Set<string>();
    for (const [index, label] of input.personalLabels.entries()) {
      const key = label.toLocaleLowerCase();
      if (seen.has(key))
        context.addIssue({
          code: "custom",
          path: ["personalLabels", index],
          message: "Personal link labels must be unique",
        });
      seen.add(key);
    }
  });
export type CreateRecoveryPackPracticeAssignment = z.infer<
  typeof CreateRecoveryPackPracticeAssignmentSchema
>;

const FollowupBaseSchema = z.object({
  id: z.string().uuid(),
  trustMode: TrustModeSchema.default("learning"),
  sourceQuizVersionId: z.string().uuid().nullable(),
  recoveryPackSource: RecoveryPackPracticeSourceSchema.nullable().default(null),
  title: z.string(),
  conceptKeys: z.array(ConceptKeySchema),
  checkpointCount: z.number().int().positive(),
  timeMode: FollowupTimeModeSchema,
  opensAt: z.string().datetime(),
  closesAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
  closedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
});
export const FollowupSchema = z
  .discriminatedUnion("purpose", [
    FollowupBaseSchema.extend({
      purpose: z.literal("recovery"),
      sourceSessionId: z.string().uuid(),
      sourceReportId: z.string().uuid(),
      conceptKeys: z.array(ConceptKeySchema).min(1).max(12),
      sourceQuizVersionId: z.string().uuid(),
      recoveryPackSource: z.null().default(null),
    }),
    FollowupBaseSchema.extend({
      purpose: z.literal("assignment"),
      sourceSessionId: z.null(),
      sourceReportId: z.null(),
      conceptKeys: z.array(ConceptKeySchema).length(0),
    }),
  ])
  .superRefine((input, context) => {
    if (
      input.purpose === "assignment" &&
      (input.recoveryPackSource
        ? input.sourceQuizVersionId !== null
        : input.sourceQuizVersionId === null)
    ) {
      context.addIssue({
        code: "custom",
        path: ["recoveryPackSource"],
        message: "Practice must reference either a Round version or a frozen Recovery Pack source",
      });
    }
    if (
      input.recoveryPackSource &&
      input.checkpointCount !== (input.recoveryPackSource.role === "full_sequence" ? 2 : 1)
    )
      context.addIssue({
        code: "custom",
        path: ["checkpointCount"],
        message: "Pack practice checkpoint count must match its frozen mode",
      });
  });
export type Followup = z.infer<typeof FollowupSchema>;

export const FollowupContextSchema = z.union([
  z.object({
    sourceType: z.literal("round").default("round"),
    quizId: z.string().uuid(),
    quizTitle: z.string().min(1).max(160),
    version: z.number().int().positive(),
    publishedAt: z.string().datetime(),
  }),
  z
    .object({
      sourceType: z.literal("recovery_pack"),
      packId: z.string().uuid(),
      packTitle: z.string().min(1).max(160),
      version: z.number().int().positive(),
      publishedAt: z.string().datetime(),
    })
    .strict(),
]);
export type FollowupContext = z.infer<typeof FollowupContextSchema>;

export const FollowupAccessKindSchema = z.enum([
  "personal",
  "assignment_personal",
  "accommodation",
]);
export const TimeMultiplierSchema = z.union([z.literal(1), z.literal(1.5), z.literal(2)]);
export type TimeMultiplier = z.infer<typeof TimeMultiplierSchema>;

export const FollowupAccessLinkSchema = z.object({
  id: z.string().uuid(),
  kind: FollowupAccessKindSchema,
  participantId: z.string().uuid().nullable(),
  nickname: z.string().nullable(),
  label: z.string(),
  timeMultiplier: TimeMultiplierSchema,
  expiresAt: z.string().datetime(),
  revokedAt: z.string().datetime().nullable(),
  token: z.string().min(20).optional(),
});
export type FollowupAccessLink = z.infer<typeof FollowupAccessLinkSchema>;

export const CreateAccommodationPassSchema = z.object({
  label: z.string().trim().min(1).max(80),
  timeMultiplier: z.union([z.literal(1.5), z.literal(2)]),
});

export const CreateAssignmentPersonalPassSchema = z.object({
  label: PracticeRecipientLabelSchema,
});

export const StartFollowupSchema = z.object({
  attemptToken: z.string().min(32).max(1_000).optional(),
});

export const FollowupAnswerSubmitSchema = z
  .object({
    idempotencyKey: z.string().min(1).max(160),
    response: ResponsePayloadSchema,
    confidence: ConfidenceValueSchema.optional(),
    questionId: z.string().uuid().optional(),
    expectedVersion: z.number().int().nonnegative().optional(),
  })
  .superRefine((input, context) => {
    if ((input.questionId === undefined) !== (input.expectedVersion === undefined))
      context.addIssue({
        code: "custom",
        path: ["expectedVersion"],
        message: "Checkpoint identity and expected version must be supplied together",
      });
  });
export type FollowupAnswerSubmit = z.infer<typeof FollowupAnswerSubmitSchema>;

/** Empty legacy advances remain accepted; sequence advances require both fields on the server. */
export const FollowupAdvanceSchema = z
  .object({
    idempotencyKey: z.string().uuid().optional(),
    expectedVersion: z.number().int().nonnegative().optional(),
  })
  .strict()
  .superRefine((input, context) => {
    if ((input.idempotencyKey === undefined) !== (input.expectedVersion === undefined))
      context.addIssue({
        code: "custom",
        path: ["expectedVersion"],
        message: "An advance receipt key and expected version must be supplied together",
      });
  })
  .default({});
export type FollowupAdvance = z.infer<typeof FollowupAdvanceSchema>;

export const FollowupInterventionSchema = z
  .object({
    index: z.number().int().min(0).max(4),
    count: z.number().int().min(1).max(5),
    card: RecoveryInterventionCardSchema.strict(),
  })
  .strict()
  .refine((input) => input.index < input.count, {
    path: ["index"],
    message: "The active card must be within the frozen sequence",
  });

export const FollowupSnapshotSchema = z
  .object({
    mode: z.literal("followup"),
    purpose: FollowupPurposeSchema,
    trustMode: TrustModeSchema.default("learning"),
    followupId: z.string().uuid(),
    attemptId: z.string().uuid(),
    version: z.number().int().nonnegative(),
    title: z.string(),
    status: z.enum(["in_progress", "completed"]),
    phase: z.enum(["question_open", "answer_reveal", "intervention", "completed"]),
    practiceMode: RecoveryPackPracticeModeSchema.nullable().default(null),
    intervention: FollowupInterventionSchema.nullable().default(null),
    questionIndex: z.number().int().nonnegative().nullable(),
    questionCount: z.number().int().positive(),
    question: PublicQuestionSchema.nullable(),
    deadline: z.string().datetime().nullable(),
    timeMode: FollowupTimeModeSchema,
    timeMultiplier: TimeMultiplierSchema,
    response: ResponsePayloadSchema.nullable(),
    confidence: ConfidenceValueSchema.nullable(),
    correct: z.boolean().nullable(),
    correctResponse: ResponsePayloadSchema.nullable(),
    explanation: z.string().nullable(),
    feedback: z.string().nullable(),
    completedAt: z.string().datetime().nullable(),
  })
  .superRefine((snapshot, context) => {
    if (snapshot.phase === "intervention") {
      if (
        snapshot.practiceMode !== "full_sequence" ||
        snapshot.purpose !== "assignment" ||
        snapshot.status !== "in_progress" ||
        !snapshot.intervention ||
        snapshot.question !== null ||
        snapshot.deadline !== null ||
        snapshot.response !== null ||
        snapshot.confidence !== null ||
        snapshot.correct !== null ||
        snapshot.correctResponse !== null ||
        snapshot.explanation !== null ||
        snapshot.feedback !== null
      )
        context.addIssue({
          code: "custom",
          path: ["intervention"],
          message: "Only the active intervention card may be delivered during a Pack card stage",
        });
    } else if (snapshot.intervention !== null) {
      context.addIssue({
        code: "custom",
        path: ["intervention"],
        message: "Intervention cards are available only during their authorized stage",
      });
    }
  });
export type FollowupSnapshot = z.infer<typeof FollowupSnapshotSchema>;

export const AuthoringSourceTypeSchema = z.enum(["pasted_text", "pdf", "docx", "pptx"]);
export type AuthoringSourceType = z.infer<typeof AuthoringSourceTypeSchema>;

export const ContentSlideLayoutSchema = z.enum([
  "title",
  "title_body",
  "media",
  "quote",
  "section",
  "callout",
]);
export type ContentSlideLayout = z.infer<typeof ContentSlideLayoutSchema>;

export const ContentSlideRegionSchema = z.enum([
  "top_left",
  "top_center",
  "top_right",
  "middle_left",
  "middle_center",
  "middle_right",
  "bottom_left",
  "bottom_center",
  "bottom_right",
]);
export type ContentSlideRegion = z.infer<typeof ContentSlideRegionSchema>;

export const ContentSlideFrameSchema = z
  .object({
    x: z.number().finite().min(0).max(100),
    y: z.number().finite().min(0).max(100),
    width: z.number().finite().min(12).max(100),
    height: z.number().finite().min(6).max(100),
  })
  .superRefine((frame, context) => {
    if (frame.x + frame.width > 100) {
      context.addIssue({
        code: "custom",
        path: ["width"],
        message: "Text elements must fit within the slide width",
      });
    }
    if (frame.y + frame.height > 100) {
      context.addIssue({
        code: "custom",
        path: ["height"],
        message: "Text elements must fit within the slide height",
      });
    }
  });
export type ContentSlideFrame = z.infer<typeof ContentSlideFrameSchema>;

const ContentSlideTitleElementSchema = z.object({
  id: z.string().trim().min(1).max(200),
  role: z.literal("title"),
  text: z.string().trim().max(160),
  region: ContentSlideRegionSchema,
  order: z.number().int().min(0).max(7),
  frame: ContentSlideFrameSchema.optional(),
});

const ContentSlideBodyElementSchema = z.object({
  id: z.string().trim().min(1).max(200),
  role: z.literal("body"),
  text: z.string().trim().max(4_000),
  region: ContentSlideRegionSchema,
  order: z.number().int().min(0).max(7),
  frame: ContentSlideFrameSchema.optional(),
});

export const ContentSlideTextElementSchema = z.discriminatedUnion("role", [
  ContentSlideTitleElementSchema,
  ContentSlideBodyElementSchema,
]);
export type ContentSlideTextElement = z.infer<typeof ContentSlideTextElementSchema>;

const PastedAuthoringSourceSchema = z.object({
  sourceType: z.literal("pasted_text"),
  sourceName: z.string().trim().min(1).max(200).default("Pasted source"),
  text: z.string().trim().min(50).max(100_000),
});

const FileAuthoringSourceSchema = z.object({
  sourceType: z.enum(["pdf", "docx", "pptx"]),
  sourceName: z.string().trim().min(1).max(200),
  mimeType: z.enum([
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ]),
  encoding: z.literal("base64"),
  data: z.string().min(4).max(8_000_000),
});

export const CreateAuthoringJobSchema = z
  .discriminatedUnion("sourceType", [PastedAuthoringSourceSchema, FileAuthoringSourceSchema])
  .superRefine((input, context) => {
    if (input.sourceType === "pasted_text") return;
    const expected = {
      pdf: "application/pdf",
      docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    }[input.sourceType];
    if (input.mimeType !== expected) {
      context.addIssue({
        code: "custom",
        path: ["mimeType"],
        message: `The MIME type does not match the ${input.sourceType.toUpperCase()} source type`,
      });
    }
  });
export type CreateAuthoringJob = z.infer<typeof CreateAuthoringJobSchema>;

export const AuthoringCitationSchema = z.object({
  checkpointId: z.string().uuid(),
  locator: z.string().min(1).max(120),
  excerpt: z.string().min(1).max(500),
});

/**
 * A reviewable, source-derived slide proposal. These are intentionally content-only: source
 * conversion does not imply that document media or freeform layout can be reproduced safely.
 */
export const AuthoringContentSlideProposalSchema = z.object({
  id: z.string().uuid(),
  kind: z.literal("content"),
  layout: ContentSlideLayoutSchema.exclude(["media"]),
  title: z.string().trim().min(1).max(160),
  body: z.string().trim().max(4_000),
  citations: z
    .array(
      z.object({
        locator: z.string().trim().min(1).max(120),
        excerpt: z.string().trim().min(1).max(500),
      }),
    )
    .min(1)
    .max(4),
});
export type AuthoringContentSlideProposal = z.infer<typeof AuthoringContentSlideProposalSchema>;

export const AuthoringDraftSchema = z.object({
  schemaVersion: z.literal(1),
  sourceName: z.string(),
  sourceDigest: z.string().regex(/^[a-f0-9]{64}$/),
  checkpointSet: QuizContentSchema,
  citations: z.array(AuthoringCitationSchema).min(2).max(20),
  contentSlideProposals: z.array(AuthoringContentSlideProposalSchema).max(8).optional(),
  generatedAt: z.string().datetime(),
  provider: z.string(),
  model: z.string(),
  conversionNotes: z.array(z.string().trim().min(1).max(300)).max(10).optional(),
});
export type AuthoringDraft = z.infer<typeof AuthoringDraftSchema>;

/** Canonical complete source-output binding, identical after JSON/JSONB round trips. */
export function authoringDraftContentHash(output: unknown): string {
  return bytesToHex(
    sha256(new TextEncoder().encode(JSON.stringify(AuthoringDraftSchema.parse(output)))),
  );
}

const RecoveryPackSourceHashSchema = z.string().regex(/^[a-f0-9]{64}$/);

/** Creator-only review state; never embedded in immutable Pack content or native JSON. */
export const RecoveryPackSourceReviewSchema = z
  .object({
    schemaVersion: z.literal(1),
    authoringJobId: z.string().uuid(),
    sourceName: z.string().trim().min(1).max(200),
    sourceDigest: RecoveryPackSourceHashSchema,
    sourceOutputHash: RecoveryPackSourceHashSchema,
    contentHash: RecoveryPackSourceHashSchema.nullable(),
    approvedContentHash: RecoveryPackSourceHashSchema.nullable(),
    approvedDraftRevision: z.number().int().nonnegative().nullable(),
    approvedAt: z.string().datetime().nullable(),
    approved: z.boolean(),
  })
  .strict();
export type RecoveryPackSourceReview = z.infer<typeof RecoveryPackSourceReviewSchema>;

export const RecoveryPackSourceProposalSchema = z
  .object({
    schemaVersion: z.literal(1),
    authoringJobId: z.string().uuid(),
    sourceName: z.string().trim().min(1).max(200),
    sourceDigest: RecoveryPackSourceHashSchema,
    sourceOutputHash: RecoveryPackSourceHashSchema,
    contentHash: RecoveryPackSourceHashSchema,
    draft: RecoveryPackContentSchema,
    conversionNotes: z.array(z.string().trim().min(1).max(300)).max(10),
  })
  .strict()
  .superRefine((proposal, context) => {
    if (recoveryPackContentHash(proposal.draft) !== proposal.contentHash)
      context.addIssue({
        code: "custom",
        path: ["contentHash"],
        message: "Content hash must match the complete proposal",
      });
  });
export type RecoveryPackSourceProposal = z.infer<typeof RecoveryPackSourceProposalSchema>;

export const ApplySourceRecoveryPackSchema = z
  .object({
    draft: RecoveryPackContentSchema,
    sourceOutputHash: RecoveryPackSourceHashSchema,
    expectedContentHash: RecoveryPackSourceHashSchema,
    mutationId: z.string().uuid(),
  })
  .strict();
export type ApplySourceRecoveryPack = z.infer<typeof ApplySourceRecoveryPackSchema>;

export const ApproveRecoveryPackSourceSchema = z
  .object({
    expectedDraftRevision: z.number().int().nonnegative(),
    expectedContentHash: RecoveryPackSourceHashSchema,
    sourceDigest: RecoveryPackSourceHashSchema,
    sourceOutputHash: RecoveryPackSourceHashSchema,
    mutationId: z.string().uuid(),
    approveContent: z.literal(true),
    approveCitations: z.literal(true),
  })
  .strict();
export type ApproveRecoveryPackSource = z.infer<typeof ApproveRecoveryPackSourceSchema>;

export const AuthoringJobSchema = z.object({
  id: z.string().uuid(),
  sourceType: AuthoringSourceTypeSchema,
  sourceName: z.string(),
  status: z.enum(["pending", "processing", "ready", "failed"]),
  attempts: z.number().int().nonnegative(),
  appliedQuizId: z.string().uuid().nullable(),
  output: AuthoringDraftSchema.nullable(),
  error: z.string().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type AuthoringJob = z.infer<typeof AuthoringJobSchema>;

export const ApplyAuthoringJobSchema = z.object({
  title: z.string().trim().min(1).max(160).optional(),
});

const AuthoringProposalSelectionFields = {
  selectedContentSlideIds: z
    .array(z.string().uuid())
    .max(8)
    .refine((ids) => new Set(ids).size === ids.length, {
      message: "Select each content-slide proposal only once",
    })
    .optional(),
  selectedQuestionIds: z
    .array(z.string().uuid())
    .max(2)
    .refine((ids) => new Set(ids).size === ids.length, {
      message: "Select each proposed question only once",
    })
    .optional(),
};

function requireAuthoringProposalSelection(
  input: {
    selectedContentSlideIds?: string[];
    selectedQuestionIds?: string[];
  },
  context: z.RefinementCtx,
) {
  if (
    (input.selectedContentSlideIds !== undefined || input.selectedQuestionIds !== undefined) &&
    (input.selectedContentSlideIds?.length ?? 0) + (input.selectedQuestionIds?.length ?? 0) === 0
  ) {
    context.addIssue({
      code: "custom",
      path: ["selectedContentSlideIds"],
      message: "Select at least one content slide or question",
    });
  }
}

export const ApplyPresentationAuthoringJobSchema = z
  .object({
    title: z.string().trim().min(1).max(160).optional(),
    ...AuthoringProposalSelectionFields,
  })
  .superRefine(requireAuthoringProposalSelection);
export type ApplyPresentationAuthoringJob = z.infer<typeof ApplyPresentationAuthoringJobSchema>;

/**
 * Presentations deliberately use structured, responsive blocks instead of
 * arbitrary coordinates. This keeps authoring, accessibility, and live
 * rendering on the same contract.
 */
export const ArtifactTypeSchema = z.enum(["round", "presentation"]);
export type ArtifactType = z.infer<typeof ArtifactTypeSchema>;

export const PresentationCitationSchema = z.object({
  locator: z.string().trim().min(1).max(120),
  excerpt: z.string().trim().min(1).max(500),
});

export const PresentationSourceDisclosureSchema = z.object({
  sourceName: z.string().trim().min(1).max(200),
  sourceDigest: z.string().regex(/^[a-f0-9]{64}$/),
  provider: z.string().trim().min(1).max(120),
  model: z.string().trim().min(1).max(120),
  conversionNotes: z.array(z.string().trim().min(1).max(300)).max(10).optional(),
});

const ContentSlideDraftFields = {
  id: z.string().uuid(),
  kind: z.literal("content"),
  layout: ContentSlideLayoutSchema,
  textElements: z.array(ContentSlideTextElementSchema).min(1).max(8),
  mediaId: z.string().uuid().nullable(),
  mediaAlt: z.string().trim().max(300).nullable(),
  speakerNotes: z.string().trim().max(2_000),
  citations: z.array(PresentationCitationSchema).max(20).optional(),
  sourceDisclosure: PresentationSourceDisclosureSchema.optional(),
};

/** Draft slides retain bounded storage shape while allowing incomplete accessibility metadata. */
export const ContentSlideDraftSchema = z
  .object(ContentSlideDraftFields)
  .superRefine((slide, ctx) => {
    const titles = slide.textElements.filter((element) => element.role === "title");
    if (titles.length !== 1) {
      ctx.addIssue({
        code: "custom",
        message: "Every content slide must have exactly one title element",
        path: ["textElements"],
      });
    }
    const ids = new Set<string>();
    const locations = new Set<string>();
    for (const [index, element] of slide.textElements.entries()) {
      if (ids.has(element.id)) {
        ctx.addIssue({
          code: "custom",
          message: "Every text element needs a unique ID",
          path: ["textElements", index, "id"],
        });
      }
      ids.add(element.id);
      const location = `${element.region}:${element.order}`;
      if (locations.has(location)) {
        ctx.addIssue({
          code: "custom",
          message: "Text elements in the same region need a unique order",
          path: ["textElements", index, "order"],
        });
      }
      locations.add(location);
    }
  });
export type ContentSlideDraft = z.infer<typeof ContentSlideDraftSchema>;

export const ContentSlideSchema = z.object(ContentSlideDraftFields).superRefine((slide, ctx) => {
  if (!slide.textElements.some((element) => element.text.trim()) && !slide.mediaId) {
    ctx.addIssue({
      code: "custom",
      message: "Add a title, body, or image to this slide",
      path: ["textElements"],
    });
  }
  if (!ContentSlideDraftSchema.safeParse(slide).success) {
    ctx.addIssue({
      code: "custom",
      message: "This slide has invalid text elements",
      path: ["textElements"],
    });
  }
  if (slide.mediaId && !slide.mediaAlt?.trim()) {
    ctx.addIssue({
      code: "custom",
      message: "Describe the slide image for participants who cannot see it",
      path: ["mediaAlt"],
    });
  }
});
export type ContentSlide = z.infer<typeof ContentSlideSchema>;

const QuestionProvenanceSchema = z.object({
  sourceQuizVersionId: z.string().uuid(),
  sourceQuestionId: z.string().uuid(),
});

export const InteractiveQuestionBlockDraftSchema = z.object({
  id: z.string().uuid(),
  kind: z.literal("question"),
  question: QuestionDraftSchema,
  provenance: QuestionProvenanceSchema.optional(),
  citations: z.array(PresentationCitationSchema).max(20).optional(),
  sourceDisclosure: PresentationSourceDisclosureSchema.optional(),
});
export type InteractiveQuestionBlockDraft = z.infer<typeof InteractiveQuestionBlockDraftSchema>;

export const InteractiveQuestionBlockSchema = z.object({
  id: z.string().uuid(),
  kind: z.literal("question"),
  question: QuestionSchema,
  provenance: QuestionProvenanceSchema.optional(),
  citations: z.array(PresentationCitationSchema).max(20).optional(),
  sourceDisclosure: PresentationSourceDisclosureSchema.optional(),
});
export type InteractiveQuestionBlock = z.infer<typeof InteractiveQuestionBlockSchema>;

/** Only a bounded, unscored choice prompt may be authored from the scoped sidecar. */
export const PresentationQuickCheckInputSchema = z
  .object({
    prompt: z.string().trim().min(1, "Enter a Quick Check prompt").max(500),
    choices: z.array(z.string().trim().min(1, "Enter a choice").max(180)).min(2).max(6),
    timeLimitSeconds: z.number().int().min(10).max(300),
  })
  .strict()
  .superRefine(({ choices }, ctx) => {
    const normalized = choices.map((choice) =>
      choice.normalize("NFKC").replace(/\s+/gu, " ").toLowerCase(),
    );
    if (new Set(normalized).size !== normalized.length) {
      ctx.addIssue({
        code: "custom",
        path: ["choices"],
        message: "Use distinct Quick Check choices",
      });
    }
  });
export type PresentationQuickCheckInput = z.infer<typeof PresentationQuickCheckInputSchema>;

/** Session content only: this marker is deliberately absent from authoring drafts. */
export const PresentationLiveQuickCheckSchema = z
  .object({ commandId: z.string().uuid(), blockId: z.string().uuid() })
  .strict();
export type PresentationLiveQuickCheck = z.infer<typeof PresentationLiveQuickCheckSchema>;

/** A scoped sidecar selects an exact retained version, never supplies mutable question content. */
export const PresentationPublishedQuestionSelectionSchema = z
  .object({
    sourceQuizVersionId: z.string().uuid(),
    sourceQuestionId: z.string().uuid(),
    contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
export type PresentationPublishedQuestionSelection = z.infer<
  typeof PresentationPublishedQuestionSelectionSchema
>;

/** Frozen Round provenance is session-only; authoring drafts do not retain live insertions. */
export const PresentationLivePublishedQuestionSchema =
  PresentationPublishedQuestionSelectionSchema.extend({
    commandId: z.string().uuid(),
    blockId: z.string().uuid(),
    sourceQuizId: z.string().uuid(),
    sourceQuizVersion: z.number().int().positive(),
  }).strict();
export type PresentationLivePublishedQuestion = z.infer<
  typeof PresentationLivePublishedQuestionSchema
>;

export const PresentationBlockDraftSchema = z.discriminatedUnion("kind", [
  ContentSlideDraftSchema,
  InteractiveQuestionBlockDraftSchema,
]);
export type PresentationBlockDraft = z.infer<typeof PresentationBlockDraftSchema>;

export const PresentationBlockSchema = z.discriminatedUnion("kind", [
  ContentSlideSchema,
  InteractiveQuestionBlockSchema,
]);
export type PresentationBlock = z.infer<typeof PresentationBlockSchema>;

function applyPresentationTopology(
  presentation: {
    blocks: Array<
      | { id: string; kind: "content" }
      | {
          id: string;
          kind: "question";
          question: {
            id: string;
            delivery?: QuestionDelivery;
            linkedRecheckQuestionId?: string | null;
            choices?: Array<{ id: string }>;
          };
        }
    >;
  },
  ctx: z.RefinementCtx,
  publishReady: boolean,
) {
  const blockIds = new Set<string>();
  const questionIds = new Map<
    string,
    { delivery?: QuestionDelivery; linkedRecheckQuestionId?: string | null; blockIndex: number }
  >();
  const choiceIds = new Set<string>();
  for (const [blockIndex, block] of presentation.blocks.entries()) {
    if (blockIds.has(block.id)) {
      ctx.addIssue({
        code: "custom",
        message: "Every presentation block needs a unique ID",
        path: ["blocks", blockIndex, "id"],
      });
    }
    blockIds.add(block.id);
    if (block.kind !== "question") continue;
    if (questionIds.has(block.question.id)) {
      ctx.addIssue({
        code: "custom",
        message: "Every presentation question needs a unique ID",
        path: ["blocks", blockIndex, "question", "id"],
      });
    }
    questionIds.set(block.question.id, { ...block.question, blockIndex });
    for (const [choiceIndex, choice] of (block.question.choices ?? []).entries()) {
      if (choiceIds.has(choice.id)) {
        ctx.addIssue({
          code: "custom",
          message: "Every answer choice needs a unique ID",
          path: ["blocks", blockIndex, "question", "choices", choiceIndex, "id"],
        });
      }
      choiceIds.add(choice.id);
    }
  }
  if (!publishReady) return;
  const linkedSources = new Map<string, number[]>();
  for (const [blockIndex, block] of presentation.blocks.entries()) {
    if (block.kind !== "question" || !block.question.linkedRecheckQuestionId) continue;
    const linked = questionIds.get(block.question.linkedRecheckQuestionId);
    if (!linked || (linked.delivery ?? "main") !== "recheck") {
      ctx.addIssue({
        code: "custom",
        message: "Linked recheck must reference a recheck question in this presentation",
        path: ["blocks", blockIndex, "question", "linkedRecheckQuestionId"],
      });
      continue;
    }
    if (linked.blockIndex <= blockIndex) {
      ctx.addIssue({
        code: "custom",
        message: "Place the linked recheck after its diagnostic question",
        path: ["blocks", blockIndex, "question", "linkedRecheckQuestionId"],
      });
    }
    const sources = linkedSources.get(block.question.linkedRecheckQuestionId) ?? [];
    sources.push(blockIndex);
    linkedSources.set(block.question.linkedRecheckQuestionId, sources);
  }
  for (const [questionId, question] of questionIds) {
    if ((question.delivery ?? "main") !== "recheck") continue;
    const sources = linkedSources.get(questionId) ?? [];
    if (sources.length === 0) {
      ctx.addIssue({
        code: "custom",
        message: "Every recheck must be linked from one earlier diagnostic question",
        path: ["blocks", question.blockIndex, "question", "delivery"],
      });
    }
    for (const sharedSourceIndex of sources.slice(1)) {
      ctx.addIssue({
        code: "custom",
        message: "A recheck cannot be shared by multiple diagnostic questions",
        path: ["blocks", sharedSourceIndex, "question", "linkedRecheckQuestionId"],
      });
    }
  }
}

function applyPresentationRecoveryPackRules(
  presentation: {
    schemaVersion: 2 | 3;
    recoveryPackInsertions?: RecoveryPackInsertion[];
  },
  ctx: z.RefinementCtx,
) {
  const issue = (path: (string | number)[], message: string) =>
    ctx.addIssue({ code: "custom", path, message });
  if (presentation.schemaVersion === 2) {
    // v2 already retained question-level Pack provenance through shared Question contracts and
    // Round imports. Only the new complete, frozen insertion baselines require embedded v3.
    if (presentation.recoveryPackInsertions?.length) {
      issue(["schemaVersion"], "Recovery Pack baselines require Presentation schema version 3");
    }
    return;
  }

  const insertionIds = new Set<string>();
  const destinationIds = new Set<string>();
  for (const [index, insertion] of (presentation.recoveryPackInsertions ?? []).entries()) {
    const path = ["recoveryPackInsertions", index];
    if (insertionIds.has(insertion.id)) {
      issue([...path, "id"], "Recovery Pack insertion IDs must be unique");
    }
    insertionIds.add(insertion.id);
    for (const field of ["diagnosticQuestionId", "recheckQuestionId"] as const) {
      const id = insertion[field];
      if (destinationIds.has(id)) {
        issue([...path, field], "Recovery Pack destination questions must be distinct");
      }
      destinationIds.add(id);
    }
  }
}

export const PresentationDraftSchema = z
  .object({
    title: z.string().trim().max(160),
    description: z.string().trim().max(1_000).default(""),
    experiencePreset: ExperiencePresetRefSchema.default({ id: "focus", version: 1 }),
    schemaVersion: z.union([z.literal(2), z.literal(3)]).default(2),
    sourceDisclosure: PresentationSourceDisclosureSchema.optional(),
    blocks: z.array(PresentationBlockDraftSchema).max(200),
    recoveryPackInsertions: z.array(RecoveryPackInsertionSchema).max(100).optional(),
  })
  .superRefine((presentation, ctx) => {
    applyPresentationTopology(presentation, ctx, false);
    applyPresentationRecoveryPackRules(presentation, ctx);
  });
export type PresentationDraft = z.infer<typeof PresentationDraftSchema>;

export const PresentationContentSchema = z
  .object({
    title: z.string().trim().min(1, "Enter a presentation title").max(160),
    description: z.string().trim().max(1_000).default(""),
    experiencePreset: ExperiencePresetRefSchema.default({ id: "focus", version: 1 }),
    schemaVersion: z.union([z.literal(2), z.literal(3)]),
    sourceDisclosure: PresentationSourceDisclosureSchema.optional(),
    blocks: z.array(PresentationBlockSchema).min(1).max(200),
    recoveryPackInsertions: z.array(RecoveryPackInsertionSchema).max(100).optional(),
    liveQuickCheck: PresentationLiveQuickCheckSchema.optional(),
    livePublishedQuestions: z
      .array(PresentationLivePublishedQuestionSchema)
      .min(1)
      .max(100)
      .optional(),
  })
  .superRefine((presentation, ctx) => {
    applyPresentationTopology(presentation, ctx, true);
    applyPresentationRecoveryPackRules(presentation, ctx);
    const liveCommandIds = new Set<string>();
    const liveBlockIds = new Set<string>();
    for (const [index, insertion] of (presentation.livePublishedQuestions ?? []).entries()) {
      const block = presentation.blocks.find((candidate) => candidate.id === insertion.blockId);
      if (
        liveCommandIds.has(insertion.commandId) ||
        liveBlockIds.has(insertion.blockId) ||
        insertion.commandId === presentation.liveQuickCheck?.commandId ||
        insertion.blockId === presentation.liveQuickCheck?.blockId ||
        presentation.recoveryPackInsertions?.some((pack) => pack.id === insertion.commandId) ||
        block?.kind !== "question" ||
        (block.question.delivery ?? "main") !== "main" ||
        block.question.mediaId !== null ||
        block.question.linkedRecheckQuestionId ||
        block.question.recoveryPackSource ||
        block.provenance?.sourceQuizVersionId !== insertion.sourceQuizVersionId ||
        block.provenance.sourceQuestionId !== insertion.sourceQuestionId
      ) {
        ctx.addIssue({
          code: "custom",
          path: ["livePublishedQuestions", index],
          message:
            "Live published questions require unique insertions and matching standalone text-only provenance",
        });
      }
      liveCommandIds.add(insertion.commandId);
      liveBlockIds.add(insertion.blockId);
    }
    if (presentation.liveQuickCheck) {
      const block = presentation.blocks.find(
        (candidate) => candidate.id === presentation.liveQuickCheck!.blockId,
      );
      if (
        block?.kind !== "question" ||
        block.question.type !== "poll" ||
        block.question.purpose !== "opinion" ||
        block.question.confidence !== "off" ||
        block.question.delivery !== "main" ||
        block.question.basePoints !== 0 ||
        block.question.linkedRecheckQuestionId !== null ||
        block.question.conceptKeys?.length ||
        block.question.explanation !== "" ||
        block.question.mediaId !== null ||
        block.question.mediaAlt !== null ||
        block.question.recoveryPackSource ||
        block.question.sourceCitations?.length ||
        block.provenance ||
        block.sourceDisclosure ||
        block.citations?.length ||
        block.question.choices.some(
          (choice) => choice.isCorrect || choice.feedback || choice.misconceptionKey,
        ) ||
        !PresentationQuickCheckInputSchema.safeParse({
          prompt: block.question.prompt,
          choices: block.question.choices.map((choice) => choice.label),
          timeLimitSeconds: block.question.timeLimitSeconds,
        }).success
      ) {
        ctx.addIssue({
          code: "custom",
          path: ["liveQuickCheck"],
          message: "A session-only Quick Check must reference one plain, unscored opinion poll",
        });
      }
    }
    if (!presentation.blocks.some((block) => block.kind === "question")) {
      ctx.addIssue({
        code: "custom",
        message: "Add at least one interactive question before publishing",
        path: ["blocks"],
      });
    }
    if (
      !presentation.blocks.some(
        (block) => block.kind === "question" && (block.question.delivery ?? "main") === "main",
      )
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Add at least one main interactive question before publishing",
        path: ["blocks"],
      });
    }
  });
export type PresentationContent = z.infer<typeof PresentationContentSchema>;

const legacyRegionByLayout = {
  title: "middle_center",
  title_body: "middle_center",
  media: "top_center",
  quote: "middle_center",
  section: "middle_center",
  callout: "top_center",
} as const;

/** Shared by persisted artifacts and browser recovery; already-current v3 metadata is retained. */
export function migratePresentationV1(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const presentation = value as { blocks?: unknown; [key: string]: unknown };
  if (presentation.schemaVersion === 3) return presentation;
  if (!Array.isArray(presentation.blocks)) return { ...presentation, schemaVersion: 2 };
  return {
    ...presentation,
    schemaVersion: 2,
    blocks: presentation.blocks.map((rawBlock) => {
      if (!rawBlock || typeof rawBlock !== "object" || Array.isArray(rawBlock)) return rawBlock;
      const block = rawBlock as {
        id?: unknown;
        kind?: unknown;
        layout?: unknown;
        title?: unknown;
        body?: unknown;
        [key: string]: unknown;
      };
      if (block.kind !== "content" || "textElements" in block) return rawBlock;
      const layout =
        typeof block.layout === "string" && block.layout in legacyRegionByLayout
          ? (block.layout as keyof typeof legacyRegionByLayout)
          : "title_body";
      const blockId = typeof block.id === "string" ? block.id : "legacy-slide";
      const title = typeof block.title === "string" ? block.title : "";
      const body = typeof block.body === "string" ? block.body : "";
      const retained = { ...block };
      delete retained.title;
      delete retained.body;
      const bodyRegion =
        layout === "title_body" || layout === "media" || layout === "callout"
          ? "middle_center"
          : "bottom_center";
      return {
        ...retained,
        textElements: [
          {
            id: `${blockId}:title`,
            role: "title",
            text: title,
            region: legacyRegionByLayout[layout],
            order: 0,
          },
          {
            id: `${blockId}:body`,
            role: "body",
            text: body,
            region: bodyRegion,
            order: bodyRegion === legacyRegionByLayout[layout] ? 1 : 0,
          },
        ],
      };
    }),
  };
}

export const CreatePresentationSchema = z.object({
  title: z.string().trim().min(1).max(160),
  description: z.string().trim().max(1_000).default(""),
});

export const PresentationDraftMutationSchema = z.object({
  draft: PresentationDraftSchema,
  expectedRevision: z.number().int().nonnegative(),
  mutationId: z.string().uuid(),
  schemaVersion: z.literal(2),
});
export type PresentationDraftMutation = z.infer<typeof PresentationDraftMutationSchema>;

export const PublishPresentationSchema = z.object({
  expectedDraftRevision: z.number().int().nonnegative(),
});

export const CopyRoundQuestionsToPresentationSchema = z.object({
  sourceQuizVersionId: z.string().uuid(),
  questionIds: z
    .array(z.string().uuid())
    .min(1)
    .max(50)
    .refine((questionIds) => new Set(questionIds).size === questionIds.length, {
      message: "Select each source question only once",
    }),
  afterBlockId: z.string().uuid().nullable().default(null),
  expectedRevision: z.number().int().nonnegative(),
  mutationId: z.string().uuid(),
});

export const InsertRecoveryPackIntoPresentationSchema = z.object({
  packVersionId: z.string().uuid(),
  expectedRevision: z.number().int().nonnegative(),
  mutationId: z.string().uuid(),
  afterBlockId: z.string().uuid().nullable().default(null),
});
export type InsertRecoveryPackIntoPresentation = z.infer<
  typeof InsertRecoveryPackIntoPresentationSchema
>;

export const InsertAuthoringProposalsIntoPresentationSchema = z
  .object({
    authoringJobId: z.string().uuid(),
    ...AuthoringProposalSelectionFields,
    afterBlockId: z.string().uuid().nullable().default(null),
    expectedRevision: z.number().int().nonnegative(),
    mutationId: z.string().uuid(),
  })
  .superRefine(requireAuthoringProposalSelection);
export type InsertAuthoringProposalsIntoPresentation = z.infer<
  typeof InsertAuthoringProposalsIntoPresentationSchema
>;

export const PresentationSessionPhaseSchema = z.enum([
  "lobby",
  "content",
  "question_open",
  "question_reveal",
  "intervention",
  "finished",
]);
export type PresentationSessionPhase = z.infer<typeof PresentationSessionPhaseSchema>;

export const PresentationSessionStatusSchema = z.enum(["active", "finished"]);
export type PresentationSessionStatus = z.infer<typeof PresentationSessionStatusSchema>;

export const PresentationTimeModeSchema = z.enum(["timed", "flex"]);
export type PresentationTimeMode = z.infer<typeof PresentationTimeModeSchema>;

export const PresentationSessionSettingsSchema = z
  .object({
    timeMode: PresentationTimeModeSchema.default("timed"),
    trustMode: TrustModeSchema.default("learning"),
    recoveryPackCardsEnabled: z.boolean().optional(),
  })
  .strict();
export type PresentationSessionSettings = z.input<typeof PresentationSessionSettingsSchema>;
export type ResolvedPresentationSessionSettings = z.output<
  typeof PresentationSessionSettingsSchema
>;

/** Content that is safe for every live Presentation role. */
export const PresentationLiveContentBlockSchema = z
  .object({
    id: z.string().uuid(),
    kind: z.literal("content"),
    layout: ContentSlideLayoutSchema,
    textElements: z.array(ContentSlideTextElementSchema).min(1).max(8),
    mediaId: z.string().uuid().nullable(),
    mediaAlt: z.string().max(300).nullable(),
  })
  .superRefine((block, ctx) => {
    const parsed = ContentSlideDraftSchema.safeParse({ ...block, speakerNotes: "" });
    if (!parsed.success) {
      ctx.addIssue({
        code: "custom",
        message: "Live content slides must contain valid text element positions",
        path: ["textElements"],
      });
    }
  })
  .strict();
export type PresentationLiveContentBlock = z.infer<typeof PresentationLiveContentBlockSchema>;

/** Learner and companion question projection. It intentionally excludes answer and authoring data. */
export const PresentationParticipantQuestionBlockSchema = z
  .object({
    id: z.string().uuid(),
    kind: z.literal("question"),
    question: ParticipantQuestionSchema,
  })
  .strict();
export type PresentationParticipantQuestionBlock = z.infer<
  typeof PresentationParticipantQuestionBlockSchema
>;

/** Host answer material is a separate phase-fenced projection and excludes source metadata. */
export const PresentationRevealedAnswerSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("choice"),
      correctChoiceIds: z.array(z.string().uuid()).min(1).max(6),
      explanation: z.string().max(1_000),
    })
    .strict(),
  z
    .object({
      kind: z.literal("numeric"),
      correctValue: z.string().max(64),
      tolerance: z.string().max(64),
      unit: z.string().max(32).nullable(),
      explanation: z.string().max(1_000),
    })
    .strict(),
  z
    .object({
      kind: z.literal("unscored"),
      explanation: z.string().max(1_000),
    })
    .strict(),
]);
export type PresentationRevealedAnswer = z.infer<typeof PresentationRevealedAnswerSchema>;

export const PresentationHostQuestionBlockSchema = z
  .object({
    id: z.string().uuid(),
    kind: z.literal("question"),
    question: FacilitatorQuestionSchema,
    revealedAnswer: PresentationRevealedAnswerSchema.nullable().default(null),
  })
  .strict();
export type PresentationHostQuestionBlock = z.infer<typeof PresentationHostQuestionBlockSchema>;

export const PresentationParticipantCurrentBlockSchema = z.discriminatedUnion("kind", [
  PresentationLiveContentBlockSchema,
  PresentationParticipantQuestionBlockSchema,
]);
export type PresentationParticipantCurrentBlock = z.infer<
  typeof PresentationParticipantCurrentBlockSchema
>;

export const PresentationHostCurrentBlockSchema = z.discriminatedUnion("kind", [
  PresentationLiveContentBlockSchema,
  PresentationHostQuestionBlockSchema,
]);
export type PresentationHostCurrentBlock = z.infer<typeof PresentationHostCurrentBlockSchema>;

export const PresentationRoomStatusSchema = z
  .object({
    sessionId: z.string().uuid(),
    joinedCount: z.number().int().nonnegative(),
    connectedCount: z.number().int().nonnegative(),
    notCurrentlyConnectedCount: z.number().int().nonnegative(),
    responseCount: z.number().int().nonnegative(),
    sampledAt: z.string().datetime(),
  })
  .strict()
  .superRefine((status, ctx) => {
    if (status.connectedCount + status.notCurrentlyConnectedCount !== status.joinedCount) {
      ctx.addIssue({
        code: "custom",
        message: "Connected and disconnected counts must equal the joined count",
        path: ["connectedCount"],
      });
    }
    if (status.responseCount > status.joinedCount) {
      ctx.addIssue({
        code: "custom",
        message: "Response count cannot exceed the joined count",
        path: ["responseCount"],
      });
    }
  });
export type PresentationRoomStatus = z.infer<typeof PresentationRoomStatusSchema>;

const PresentationSnapshotBaseFields = {
  sessionId: z.string().uuid(),
  artifactType: z.literal("presentation"),
  presentationId: z.string().uuid(),
  presentationVersionId: z.string().uuid(),
  title: z.string().min(1).max(160),
  code: z.string().regex(/^\d{7}$/),
  status: PresentationSessionStatusSchema,
  phase: PresentationSessionPhaseSchema,
  currentBlockIndex: z.number().int().min(-1),
  blockCount: z.number().int().nonnegative(),
  revision: z.number().int().nonnegative(),
  seq: z.number().int().nonnegative(),
  serverTime: z.string().datetime(),
  questionOpenedAt: z.string().datetime().nullable(),
  questionClosesAt: z.string().datetime().nullable(),
  acceptingResponses: z.boolean(),
  settings: PresentationSessionSettingsSchema,
  recoveryPackIntervention: PresentationRecoveryPackPlaybackSchema.optional(),
};

function validatePresentationRecoveryPackPlayback(
  snapshot: {
    phase: PresentationSessionPhase;
    recoveryPackIntervention?: z.infer<typeof PresentationRecoveryPackPlaybackSchema>;
    recoveryPackCards?: Array<Pick<RecoveryPackLiveCard, "reference" | "title">>;
  },
  ctx: z.RefinementCtx,
) {
  if (snapshot.recoveryPackIntervention !== undefined && snapshot.phase !== "intervention") {
    ctx.addIssue({
      code: "custom",
      message: "A Recovery Pack card can be delivered only during its active intervention",
      path: ["recoveryPackIntervention"],
    });
  }
  if (snapshot.recoveryPackCards !== undefined && snapshot.phase !== "question_reveal") {
    ctx.addIssue({
      code: "custom",
      message: "Recovery Pack previews cannot be delivered before question reveal",
      path: ["recoveryPackCards"],
    });
  }
}

export const PresentationHostParticipantSchema = z
  .object({
    id: z.string().uuid(),
    nickname: z.string().min(1).max(32),
    joinedAt: z.string().datetime(),
    score: z.number().int().nonnegative(),
    rank: z.number().int().positive(),
  })
  .strict();
export type PresentationHostParticipant = z.infer<typeof PresentationHostParticipantSchema>;

export const PresentationHostSnapshotSchema = z
  .object({
    ...PresentationSnapshotBaseFields,
    projection: z.literal("host"),
    recoveryPackCards: z.array(RecoveryPackLiveCardSchema).min(1).max(5).optional(),
    currentBlock: PresentationHostCurrentBlockSchema.nullable(),
    participantCount: z.number().int().nonnegative(),
    responseCount: z.number().int().nonnegative(),
    participants: z.array(PresentationHostParticipantSchema),
    roomStatus: PresentationRoomStatusSchema,
    finishedAt: z.string().datetime().nullable(),
  })
  .strict()
  .superRefine((snapshot, ctx) => {
    validatePresentationRecoveryPackPlayback(snapshot, ctx);
    if (
      snapshot.currentBlock?.kind === "question" &&
      !["question_reveal", "intervention", "finished"].includes(snapshot.phase) &&
      snapshot.currentBlock.revealedAnswer !== null
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Answer material cannot be delivered before reveal",
        path: ["currentBlock", "revealedAnswer"],
      });
    }
  });
export type PresentationHostSnapshot = z.infer<typeof PresentationHostSnapshotSchema>;

export const PresentationResponseReceiptSchema = z
  .object({
    responseId: z.string().uuid(),
    blockId: z.string().uuid(),
    idempotencyKey: z.string().min(1).max(160),
    acceptedAt: z.string().datetime(),
  })
  .strict();
export type PresentationResponseReceipt = z.infer<typeof PresentationResponseReceiptSchema>;

export const PresentationParticipantSnapshotSchema = z
  .object({
    ...PresentationSnapshotBaseFields,
    projection: z.literal("participant"),
    participantId: z.string().uuid(),
    currentBlock: PresentationParticipantCurrentBlockSchema.nullable(),
    participantCount: z.number().int().nonnegative(),
    responseSubmitted: z.boolean(),
    responseReceipt: PresentationResponseReceiptSchema.nullable().optional(),
    standing: z
      .object({
        rank: z.number().int().positive(),
        score: z.number().int().nonnegative(),
      })
      .strict()
      .nullable(),
    responseResult: z
      .object({
        correct: z.boolean().nullable(),
        score: z.number().int().nonnegative(),
      })
      .strict()
      .nullable(),
    finishedAt: z.string().datetime().nullable(),
  })
  .strict()
  .superRefine(validatePresentationRecoveryPackPlayback);
export type PresentationParticipantSnapshot = z.infer<typeof PresentationParticipantSnapshotSchema>;

const PresentationRestSnapshotAliasFields = {
  id: z.string().uuid(),
  eventSeq: z.number().int().nonnegative(),
  trustMode: TrustModeSchema,
};

const PresentationRestV1RatingAliasFields = {
  min: z.number().int().min(1).max(9).optional(),
  max: z.number().int().min(2).max(10).optional(),
  minLabel: z.string().max(80).optional(),
  maxLabel: z.string().max(80).optional(),
};

function validatePresentationRestV1RatingAliases(
  question: {
    type: PresentationParticipantQuestionBlock["question"]["type"];
    rating?: { min: number; max: number; minLabel: string; maxLabel: string };
    min?: number;
    max?: number;
    minLabel?: string;
    maxLabel?: string;
  },
  ctx: z.RefinementCtx,
) {
  const aliases = [question.min, question.max, question.minLabel, question.maxLabel];
  if (question.type !== "rating") {
    if (aliases.some((value) => value !== undefined)) {
      ctx.addIssue({
        code: "custom",
        message: "Legacy rating aliases are valid only for rating questions",
        path: ["min"],
      });
    }
    return;
  }
  if (
    !question.rating ||
    question.min !== question.rating.min ||
    question.max !== question.rating.max ||
    question.minLabel !== question.rating.minLabel ||
    question.maxLabel !== question.rating.maxLabel
  ) {
    ctx.addIssue({
      code: "custom",
      message: "Legacy rating aliases must match the canonical rating fields",
      path: ["min"],
    });
  }
}

export const PresentationRestV1ParticipantQuestionSchema = z
  .object({
    ...ParticipantQuestionSchema.shape,
    ...PresentationRestV1RatingAliasFields,
  })
  .strict()
  .superRefine(validatePresentationRestV1RatingAliases);

export const PresentationRestV1HostQuestionSchema = z
  .object({
    ...FacilitatorQuestionSchema.shape,
    ...PresentationRestV1RatingAliasFields,
  })
  .strict()
  .superRefine(validatePresentationRestV1RatingAliases);

export const PresentationRestV1ParticipantCurrentBlockSchema = z.discriminatedUnion("kind", [
  PresentationLiveContentBlockSchema,
  z
    .object({
      id: z.string().uuid(),
      kind: z.literal("question"),
      question: PresentationRestV1ParticipantQuestionSchema,
    })
    .strict(),
]);

export const PresentationRestV1HostCurrentBlockSchema = z.discriminatedUnion("kind", [
  PresentationLiveContentBlockSchema,
  z
    .object({
      id: z.string().uuid(),
      kind: z.literal("question"),
      question: PresentationRestV1HostQuestionSchema,
      revealedAnswer: PresentationRevealedAnswerSchema.nullable(),
    })
    .strict(),
]);

function validatePresentationRestV1SnapshotAliases(
  snapshot: {
    id: string;
    sessionId: string;
    eventSeq: number;
    seq: number;
    trustMode: TrustMode;
    settings: { trustMode: TrustMode };
  },
  ctx: z.RefinementCtx,
) {
  if (snapshot.id !== snapshot.sessionId) {
    ctx.addIssue({ code: "custom", message: "REST session ID alias must match", path: ["id"] });
  }
  if (snapshot.eventSeq !== snapshot.seq) {
    ctx.addIssue({
      code: "custom",
      message: "REST event sequence alias must match",
      path: ["eventSeq"],
    });
  }
  if (snapshot.trustMode !== snapshot.settings.trustMode) {
    ctx.addIssue({
      code: "custom",
      message: "REST trust mode alias must match",
      path: ["trustMode"],
    });
  }
}

/**
 * Version-1 REST compatibility projection retained while existing Presentation clients migrate
 * to the canonical realtime contracts. The canonical snapshot is validated before aliases and
 * legacy rating fields are added, so the current block is intentionally opaque at this layer.
 */
export const PresentationRestV1HostSnapshotSchema = z
  .object({
    ...PresentationHostSnapshotSchema.shape,
    ...PresentationRestSnapshotAliasFields,
    currentBlock: PresentationRestV1HostCurrentBlockSchema.nullable(),
    leaderboard: z.array(PresentationHostParticipantSchema),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict()
  .superRefine((snapshot, ctx) => {
    validatePresentationRestV1SnapshotAliases(snapshot, ctx);
    validatePresentationRecoveryPackPlayback(snapshot, ctx);
    if (
      snapshot.currentBlock?.kind === "question" &&
      !["question_reveal", "intervention", "finished"].includes(snapshot.phase) &&
      snapshot.currentBlock.revealedAnswer !== null
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Answer material cannot be delivered before reveal",
        path: ["currentBlock", "revealedAnswer"],
      });
    }
    if (
      snapshot.participants.length !== snapshot.leaderboard.length ||
      snapshot.participants.some((participant, index) => {
        const legacy = snapshot.leaderboard[index];
        return (
          !legacy ||
          participant.id !== legacy.id ||
          participant.nickname !== legacy.nickname ||
          participant.joinedAt !== legacy.joinedAt ||
          participant.score !== legacy.score ||
          participant.rank !== legacy.rank
        );
      })
    ) {
      ctx.addIssue({
        code: "custom",
        message: "REST leaderboard alias must match participants",
        path: ["leaderboard"],
      });
    }
  });
export type PresentationRestV1HostSnapshot = z.infer<typeof PresentationRestV1HostSnapshotSchema>;

export const PresentationRestV1ParticipantSnapshotSchema = z
  .object({
    ...PresentationParticipantSnapshotSchema.shape,
    ...PresentationRestSnapshotAliasFields,
    currentBlock: PresentationRestV1ParticipantCurrentBlockSchema.nullable(),
  })
  .strict()
  .superRefine((snapshot, ctx) => {
    validatePresentationRestV1SnapshotAliases(snapshot, ctx);
    validatePresentationRecoveryPackPlayback(snapshot, ctx);
  });
export type PresentationRestV1ParticipantSnapshot = z.infer<
  typeof PresentationRestV1ParticipantSnapshotSchema
>;

/** Compatibility exports retained for code written before the REST contract acquired a name. */
export const PresentationHostRestSnapshotSchema = PresentationRestV1HostSnapshotSchema;
export type PresentationHostRestSnapshot = PresentationRestV1HostSnapshot;
export const PresentationParticipantRestSnapshotSchema =
  PresentationRestV1ParticipantSnapshotSchema;
export type PresentationParticipantRestSnapshot = PresentationRestV1ParticipantSnapshot;

export const PresentationRestV1HostSnapshotResponseSchema = z
  .object({ snapshot: PresentationRestV1HostSnapshotSchema })
  .strict();
export const PresentationRestV1ParticipantSnapshotResponseSchema = z
  .object({ snapshot: PresentationRestV1ParticipantSnapshotSchema })
  .strict();

/** Exact legacy list item returned by `GET /v1/presentation-sessions`. */
export const PresentationRestV1SessionListItemSchema = z
  .object({
    id: z.string().uuid(),
    artifactType: z.literal("presentation"),
    presentationId: z.string().uuid(),
    presentationVersionId: z.string().uuid(),
    title: z.string().min(1).max(160),
    code: z.string().regex(/^\d{7}$/),
    status: PresentationSessionStatusSchema,
    phase: PresentationSessionPhaseSchema,
    currentBlockIndex: z.number().int().min(-1),
    blockCount: z.number().int().nonnegative(),
    revision: z.number().int().nonnegative(),
    settings: PresentationSessionSettingsSchema,
    trustMode: TrustModeSchema,
    eventSeq: z.number().int().nonnegative(),
    currentBlock: PresentationRestV1HostCurrentBlockSchema.nullable(),
    questionOpenedAt: z.string().datetime().nullable(),
    questionClosesAt: z.string().datetime().nullable(),
    acceptingResponses: z.boolean(),
    participantCount: z.number().int().nonnegative(),
    responseCount: z.number().int().nonnegative(),
    participants: z.array(PresentationHostParticipantSchema),
    leaderboard: z.array(PresentationHostParticipantSchema),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    finishedAt: z.string().datetime().nullable(),
    liveExpiresAt: z.string().datetime().optional(),
  })
  .strict()
  .superRefine((snapshot, ctx) => {
    if (snapshot.trustMode !== snapshot.settings.trustMode) {
      ctx.addIssue({
        code: "custom",
        message: "REST trust mode alias must match",
        path: ["trustMode"],
      });
    }
    if (
      snapshot.participants.length !== snapshot.leaderboard.length ||
      snapshot.participants.some((participant, index) => {
        const legacy = snapshot.leaderboard[index];
        return !legacy || participant.id !== legacy.id || participant.joinedAt !== legacy.joinedAt;
      })
    ) {
      ctx.addIssue({
        code: "custom",
        message: "REST leaderboard alias must match participants",
        path: ["leaderboard"],
      });
    }
  });
export type PresentationRestV1SessionListItem = z.infer<
  typeof PresentationRestV1SessionListItemSchema
>;
export const PresentationRestV1SessionListResponseSchema = z
  .object({ sessions: z.array(PresentationRestV1SessionListItemSchema) })
  .strict();

/** Shareable counts only: never includes an answer key or a learner's response/identity. */
export const PresentationCompanionResultSummarySchema = z
  .object({
    blockId: z.string().uuid(),
    responseCount: z.number().int().nonnegative(),
    choiceCounts: z
      .array(
        z.object({ choiceId: z.string().uuid(), count: z.number().int().nonnegative() }).strict(),
      )
      .max(10),
  })
  .strict()
  .superRefine((summary, ctx) => {
    const choiceIds = new Set<string>();
    summary.choiceCounts.forEach((choice, index) => {
      if (choiceIds.has(choice.choiceId) || choice.count > summary.responseCount) {
        ctx.addIssue({
          code: "custom",
          message: "Choice counts must be unique and cannot exceed the response count",
          path: ["choiceCounts", index],
        });
      }
      choiceIds.add(choice.choiceId);
    });
  });
export type PresentationCompanionResultSummary = z.infer<
  typeof PresentationCompanionResultSummarySchema
>;

/** A sidecar's published Pack catalog contains no checkpoint, card, or source content. */
export const PresentationCompanionPublishedRecoveryPackSchema = z
  .object({
    packId: z.string().uuid(),
    packVersionId: z.string().uuid(),
    packVersion: z.number().int().positive(),
    title: z.string().trim().min(1).max(160),
  })
  .strict();
export type PresentationCompanionPublishedRecoveryPack = z.infer<
  typeof PresentationCompanionPublishedRecoveryPackSchema
>;
export const PresentationCompanionRecoveryPackCatalogSchema = z
  .object({ packs: z.array(PresentationCompanionPublishedRecoveryPackSchema).max(100) })
  .strict()
  .superRefine(({ packs }, ctx) => {
    if (new Set(packs.map((pack) => pack.packVersionId)).size !== packs.length) {
      ctx.addIssue({
        code: "custom",
        message: "Published Pack versions must be unique",
        path: ["packs"],
      });
    }
  });
export type PresentationCompanionRecoveryPackCatalog = z.infer<
  typeof PresentationCompanionRecoveryPackCatalogSchema
>;

/** Catalog metadata excludes keys, choices, explanations, concepts, citations, and media. */
export const PresentationCompanionPublishedQuestionSchema =
  PresentationPublishedQuestionSelectionSchema.extend({
    sourceQuizId: z.string().uuid(),
    sourceQuizVersion: z.number().int().positive(),
    title: z.string().trim().min(1).max(160),
    prompt: z.string().trim().min(1).max(500),
    type: z.enum(["single_select", "true_false", "multi_select", "poll", "numeric", "rating"]),
  }).strict();
export type PresentationCompanionPublishedQuestion = z.infer<
  typeof PresentationCompanionPublishedQuestionSchema
>;
export const PresentationCompanionPublishedQuestionCatalogSchema = z
  .object({
    questions: z.array(PresentationCompanionPublishedQuestionSchema).max(100),
    hasMore: z.boolean(),
  })
  .strict()
  .superRefine(({ questions }, ctx) => {
    const identities = questions.map(
      (question) => `${question.sourceQuizVersionId}:${question.sourceQuestionId}`,
    );
    if (new Set(identities).size !== identities.length) {
      ctx.addIssue({
        code: "custom",
        message: "Published question references must be unique",
        path: ["questions"],
      });
    }
  });
export type PresentationCompanionPublishedQuestionCatalog = z.infer<
  typeof PresentationCompanionPublishedQuestionCatalogSchema
>;

/** Titles are available after reveal; only the explicitly selected card may include a body. */
export const PresentationCompanionRecoveryPackCardSchema = z
  .object({
    reference: RecoveryPackCardReferenceSchema,
    title: z.string().trim().min(1).max(160),
  })
  .strict();
export type PresentationCompanionRecoveryPackCard = z.infer<
  typeof PresentationCompanionRecoveryPackCardSchema
>;

export const PresentationCompanionSnapshotSchema = z
  .object({
    ...PresentationSnapshotBaseFields,
    projection: z.literal("companion"),
    currentBlock: PresentationParticipantCurrentBlockSchema.nullable(),
    roomStatus: PresentationRoomStatusSchema,
    primaryAction: z.enum(["advance", "none"]),
    canInsertRecoveryPack: z.boolean().optional(),
    canInsertQuickCheck: z.boolean().optional(),
    canInsertPublishedQuestion: z.boolean().optional(),
    recoveryPackCards: z
      .array(PresentationCompanionRecoveryPackCardSchema)
      .min(1)
      .max(5)
      .optional(),
    resultSummary: PresentationCompanionResultSummarySchema.nullable().optional(),
    finishedAt: z.string().datetime().nullable(),
  })
  .strict()
  .superRefine((snapshot, ctx) => {
    validatePresentationRecoveryPackPlayback(snapshot, ctx);
    if (
      snapshot.canInsertPublishedQuestion &&
      (snapshot.status !== "active" ||
        !["lobby", "content", "question_reveal"].includes(snapshot.phase) ||
        snapshot.acceptingResponses)
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["canInsertPublishedQuestion"],
        message: "Published question insertion requires an active room at a closed, safe boundary",
      });
    }
    if (
      snapshot.canInsertQuickCheck &&
      (snapshot.status !== "active" ||
        !["lobby", "content", "question_reveal"].includes(snapshot.phase) ||
        snapshot.acceptingResponses)
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["canInsertQuickCheck"],
        message: "Quick Check insertion requires an active room at a closed, safe boundary",
      });
    }
    if (
      snapshot.canInsertRecoveryPack &&
      (snapshot.status !== "active" ||
        !["lobby", "content", "question_reveal"].includes(snapshot.phase) ||
        snapshot.acceptingResponses ||
        !snapshot.settings.recoveryPackCardsEnabled)
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Pack insertion requires an eligible room at a closed, safe boundary",
        path: ["canInsertRecoveryPack"],
      });
    }
    if (snapshot.recoveryPackCards) {
      const ids = snapshot.recoveryPackCards.map(
        ({ reference }) => `${reference.insertionId}:${reference.cardId}`,
      );
      if (
        snapshot.currentBlock?.kind !== "question" ||
        snapshot.acceptingResponses ||
        !snapshot.settings.recoveryPackCardsEnabled ||
        new Set(ids).size !== ids.length
      ) {
        ctx.addIssue({
          code: "custom",
          message: "Companion card choices require a revealed diagnostic and unique references",
          path: ["recoveryPackCards"],
        });
      }
    }
    if (!snapshot.resultSummary) return;
    const block = snapshot.currentBlock;
    if (
      !["question_reveal", "intervention", "finished"].includes(snapshot.phase) ||
      snapshot.acceptingResponses ||
      block?.kind !== "question" ||
      block.id !== snapshot.resultSummary.blockId
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Companion results may only describe the current question after reveal",
        path: ["resultSummary"],
      });
      return;
    }
    const choiceIds = new Set(
      "choices" in block.question ? block.question.choices.map((choice) => choice.id) : [],
    );
    if (snapshot.resultSummary.choiceCounts.some((choice) => !choiceIds.has(choice.choiceId))) {
      ctx.addIssue({
        code: "custom",
        message: "Companion result choices must belong to the current question",
        path: ["resultSummary", "choiceCounts"],
      });
    }
  });
export type PresentationCompanionSnapshot = z.infer<typeof PresentationCompanionSnapshotSchema>;

export const PresentationRoleSnapshotSchema = z.discriminatedUnion("projection", [
  PresentationHostSnapshotSchema,
  PresentationParticipantSnapshotSchema,
  PresentationCompanionSnapshotSchema,
]);
export type PresentationRoleSnapshot = z.infer<typeof PresentationRoleSnapshotSchema>;

export const PresentationSocketEventNameSchema = z.enum([
  "presentation.join",
  "presentation.sync.request",
  "presentation.command",
  "presentation.response.submit",
  "presentation.session.updated",
  "presentation.room-status.updated",
]);
export type PresentationSocketEventName = z.infer<typeof PresentationSocketEventNameSchema>;

export const PresentationEventEnvelopeSchema = z
  .object({
    eventId: z.string().uuid(),
    sessionId: z.string().uuid(),
    revision: z.number().int().nonnegative(),
    seq: z.number().int().nonnegative(),
    type: z.enum(["presentation.session.updated", "presentation.room-status.updated"]),
    serverTime: z.string().datetime(),
    payload: z.unknown(),
  })
  .strict();
export type PresentationEventEnvelope<T = unknown> = Omit<
  z.infer<typeof PresentationEventEnvelopeSchema>,
  "payload"
> & { payload: T };

const PresentationSyncFenceFields = {
  sessionId: z.string().uuid(),
  afterSeq: z.number().int().nonnegative().default(0),
};
const PresentationCredentialSchema = z.string().min(32).max(1_000);

export const PresentationCompanionPassResponseSchema = z
  .object({
    credentialId: z.string().uuid(),
    companionToken: PresentationCredentialSchema,
    expiresAt: z.string().datetime(),
  })
  .strict();
export type PresentationCompanionPassResponse = z.infer<
  typeof PresentationCompanionPassResponseSchema
>;

export const PresentationRestV1CreateSessionResponseSchema = z
  .object({
    snapshot: PresentationRestV1HostSnapshotSchema,
    controlToken: PresentationCredentialSchema,
    controlCredentialId: z.string().uuid(),
  })
  .strict();
export type PresentationRestV1CreateSessionResponse = z.infer<
  typeof PresentationRestV1CreateSessionResponseSchema
>;

export const PresentationRestV1JoinSessionResponseSchema = z
  .object({
    participantToken: PresentationCredentialSchema,
    snapshot: PresentationRestV1ParticipantSnapshotSchema,
  })
  .strict();
export type PresentationRestV1JoinSessionResponse = z.infer<
  typeof PresentationRestV1JoinSessionResponseSchema
>;

export const PresentationSyncRequestSchema = z.discriminatedUnion("projection", [
  z
    .object({
      ...PresentationSyncFenceFields,
      projection: z.literal("host"),
      controlToken: PresentationCredentialSchema,
    })
    .strict(),
  z
    .object({
      ...PresentationSyncFenceFields,
      projection: z.literal("participant"),
      participantToken: PresentationCredentialSchema,
    })
    .strict(),
  z
    .object({
      ...PresentationSyncFenceFields,
      projection: z.literal("companion"),
      companionToken: PresentationCredentialSchema,
    })
    .strict(),
]);
export type PresentationSyncRequest = z.input<typeof PresentationSyncRequestSchema>;

export const PresentationSyncResponseSchema = z
  .object({
    resetRequired: z.boolean(),
    events: z.array(PresentationEventEnvelopeSchema).max(1_000),
    snapshot: PresentationRoleSnapshotSchema,
  })
  .strict();
export type PresentationSyncResponse = z.infer<typeof PresentationSyncResponseSchema>;

const PresentationCommandFields = {
  sessionId: z.string().uuid(),
  controlToken: PresentationCredentialSchema,
  commandId: z.string().uuid(),
  expectedRevision: z.number().int().nonnegative(),
};
export const PresentationCommandSchema = z.discriminatedUnion("action", [
  z.object({ ...PresentationCommandFields, action: z.literal("advance") }).strict(),
  z
    .object({
      ...PresentationCommandFields,
      action: z.literal("start_recovery_card"),
      recoveryPackCard: RecoveryPackCardSelectionSchema,
      interventionType: z.enum(["explain", "example"]),
    })
    .strict(),
]);
export type PresentationCommand = z.infer<typeof PresentationCommandSchema>;

const PresentationCompanionCommandFields = {
  sessionId: z.string().uuid(),
  companionToken: PresentationCredentialSchema,
  commandId: z.string().uuid(),
  expectedRevision: z.number().int().nonnegative(),
};
/** Scoped live controls only; no creator, settings, identity, or host authority. */
export const PresentationCompanionCommandSchema = z.discriminatedUnion("action", [
  z.object({ ...PresentationCompanionCommandFields, action: z.literal("advance") }).strict(),
  z
    .object({
      ...PresentationCompanionCommandFields,
      action: z.literal("insert_published_question"),
      publishedQuestion: PresentationPublishedQuestionSelectionSchema,
    })
    .strict(),
  z
    .object({
      ...PresentationCompanionCommandFields,
      action: z.literal("insert_quick_check"),
      quickCheck: PresentationQuickCheckInputSchema,
    })
    .strict(),
  z
    .object({
      ...PresentationCompanionCommandFields,
      action: z.literal("insert_recovery_pack"),
      packVersionId: z.string().uuid(),
    })
    .strict(),
  z
    .object({
      ...PresentationCompanionCommandFields,
      action: z.literal("start_recovery_card"),
      recoveryPackCard: RecoveryPackCardSelectionSchema,
      interventionType: z.enum(["explain", "example"]),
    })
    .strict(),
]);
export type PresentationCompanionCommand = z.infer<typeof PresentationCompanionCommandSchema>;
export const PresentationControlCommandSchema = z.union([
  PresentationCommandSchema,
  PresentationCompanionCommandSchema,
]);
export type PresentationControlCommand = z.infer<typeof PresentationControlCommandSchema>;

export const CreatePresentationSessionSchema = z.object({
  presentationId: z.string().uuid(),
  timeMode: PresentationTimeModeSchema.default("timed"),
});

export const AdvancePresentationSessionSchema = z.object({
  expectedRevision: z.number().int().nonnegative(),
});

export const JoinPresentationSessionSchema = z.object({
  code: z.string().regex(/^\d{7}$/, "Enter a seven-digit presentation code"),
  nickname: z.string().trim().min(1).max(32),
});

export const PresentationSessionResponseSchema = z
  .object({
    choiceIds: z.array(z.string().uuid()).max(10).optional(),
    numericValue: z.string().trim().max(100).optional(),
    ratingValue: z.number().int().optional(),
    confidence: ConfidenceValueSchema.nullable().optional(),
  })
  .refine(
    (response) =>
      response.choiceIds !== undefined ||
      response.numericValue !== undefined ||
      response.ratingValue !== undefined,
    { message: "Add a response before submitting" },
  );
export type PresentationSessionResponse = z.infer<typeof PresentationSessionResponseSchema>;

const PresentationResponseFenceFields = {
  participantToken: PresentationCredentialSchema,
  blockId: z.string().uuid(),
  expectedRevision: z.number().int().nonnegative(),
  idempotencyKey: z.string().min(1).max(160),
  response: PresentationSessionResponseSchema,
};

export const PresentationResponseSubmitSchema = z
  .object({
    sessionId: z.string().uuid(),
    ...PresentationResponseFenceFields,
  })
  .strict();
export type PresentationResponseSubmit = z.infer<typeof PresentationResponseSubmitSchema>;

/** REST compatibility shape: the session ID continues to come from the route parameter. */
export const SubmitPresentationSessionResponseSchema = z
  .object(PresentationResponseFenceFields)
  .strict();
export type SubmitPresentationSessionResponse = z.infer<
  typeof SubmitPresentationSessionResponseSchema
>;

/**
 * Read-only compatibility contract for pre-realtime `/v1` clients. The server derives the live
 * block/revision fence and a block-scoped idempotency key before entering the authoritative path.
 */
export const LegacySubmitPresentationSessionResponseSchema = z
  .object({
    participantToken: PresentationCredentialSchema,
    response: PresentationSessionResponseSchema,
  })
  .strict();
export type LegacySubmitPresentationSessionResponse = z.infer<
  typeof LegacySubmitPresentationSessionResponseSchema
>;

export const PresentationRestResponseSubmitSchema = z.union([
  SubmitPresentationSessionResponseSchema,
  LegacySubmitPresentationSessionResponseSchema,
]);
export type PresentationRestResponseSubmit = z.infer<typeof PresentationRestResponseSubmitSchema>;

export const PresentationResponseAckSchema = z
  .object({
    sessionId: z.string().uuid(),
    blockId: z.string().uuid(),
    idempotencyKey: z.string().min(1).max(160),
    accepted: z.boolean(),
    duplicate: z.boolean(),
    responseId: z.string().uuid(),
    acceptedAt: z.string().datetime(),
    snapshot: PresentationParticipantSnapshotSchema,
  })
  .strict()
  .superRefine((ack, ctx) => {
    if (!ack.accepted && ack.duplicate) {
      ctx.addIssue({
        code: "custom",
        message: "A duplicate acknowledgement must reference an accepted response",
        path: ["duplicate"],
      });
    }
    if (ack.snapshot.sessionId !== ack.sessionId) {
      ctx.addIssue({
        code: "custom",
        message: "The acknowledgement snapshot must belong to the acknowledged session",
        path: ["snapshot", "sessionId"],
      });
    }
    const receipt = ack.snapshot.responseReceipt;
    if (
      receipt &&
      (receipt.responseId !== ack.responseId ||
        receipt.blockId !== ack.blockId ||
        receipt.idempotencyKey !== ack.idempotencyKey ||
        receipt.acceptedAt !== ack.acceptedAt)
    ) {
      ctx.addIssue({
        code: "custom",
        message: "The acknowledgement must match its durable response receipt",
        path: ["snapshot", "responseReceipt"],
      });
    }
  });
export type PresentationResponseAck = z.infer<typeof PresentationResponseAckSchema>;

/** Version-1 REST acknowledgement with legacy timestamp/revision aliases. */
export const PresentationRestV1ResponseAckSchema = z
  .object({
    sessionId: z.string().uuid(),
    blockId: z.string().uuid(),
    idempotencyKey: z.string().min(1).max(160),
    accepted: z.boolean(),
    duplicate: z.boolean(),
    responseId: z.string().uuid(),
    acceptedAt: z.string().datetime(),
    snapshot: PresentationRestV1ParticipantSnapshotSchema,
    revision: z.number().int().nonnegative(),
    submittedAt: z.string().datetime(),
  })
  .strict()
  .superRefine((ack, ctx) => {
    const receipt = ack.snapshot.responseReceipt;
    if (
      ack.snapshot.sessionId !== ack.sessionId ||
      ack.submittedAt !== ack.acceptedAt ||
      (receipt &&
        (receipt.responseId !== ack.responseId ||
          receipt.blockId !== ack.blockId ||
          receipt.idempotencyKey !== ack.idempotencyKey ||
          receipt.acceptedAt !== ack.acceptedAt))
    ) {
      ctx.addIssue({
        code: "custom",
        message: "The REST acknowledgement must match its durable response receipt",
        path: ["snapshot", "responseReceipt"],
      });
    }
  });
export type PresentationRestV1ResponseAck = z.infer<typeof PresentationRestV1ResponseAckSchema>;

/** Compatibility exports retained for existing imports of the original unversioned name. */
export const PresentationRestResponseAckSchema = PresentationRestV1ResponseAckSchema;
export type PresentationRestResponseAck = PresentationRestV1ResponseAck;

export const PresentationReportStatusSchema = z.enum(["pending", "ready", "failed"]);
export type PresentationReportStatus = z.infer<typeof PresentationReportStatusSchema>;

export const PresentationReportTimelineEventTypeSchema = z.enum([
  "presentation.started",
  "content.presented",
  "question.launched",
  "question.revealed",
  "intervention.presented",
  "presentation.finished",
]);
export type PresentationReportTimelineEventType = z.infer<
  typeof PresentationReportTimelineEventTypeSchema
>;

const PresentationReportEvidenceSchema = z.discriminatedUnion("kind", [
  z
    .object({
      blockId: z.string().uuid(),
      blockIndex: z.number().int().nonnegative(),
      kind: z.literal("content"),
      title: z.string().max(160),
      assessmentStatus: z.literal("not_assessed"),
    })
    .strict(),
  z
    .object({
      blockId: z.string().uuid(),
      blockIndex: z.number().int().nonnegative(),
      kind: z.literal("question"),
      questionId: z.string().uuid(),
      prompt: z.string().max(2_000),
      questionType: QuestionTypeSchema,
      questionTypeLabel: z.string().min(1).max(120),
      delivery: QuestionDeliverySchema,
      respondents: z.number().int().nonnegative(),
      correct: z.number().int().nonnegative().nullable(),
      accuracyPercent: z.number().min(0).max(100).nullable(),
      totalScore: z.number().int().nonnegative(),
      averageResponseMs: z.number().int().nonnegative().nullable(),
    })
    .strict(),
]);

const PresentationReportQuickCheckEvidenceSchema = z.discriminatedUnion("kind", [
  PresentationReportEvidenceSchema.options[0],
  PresentationReportEvidenceSchema.options[1]
    .extend({ sessionOnly: z.literal("quick_check").optional() })
    .superRefine((evidence, ctx) => {
      if (
        evidence.sessionOnly &&
        (evidence.questionType !== "poll" ||
          evidence.delivery !== "main" ||
          evidence.correct !== null ||
          evidence.accuracyPercent !== null ||
          evidence.totalScore !== 0)
      ) {
        ctx.addIssue({
          code: "custom",
          path: ["sessionOnly"],
          message: "Session-only Quick Checks report participation, not scored learning evidence",
        });
      }
    }),
]);

/** Immutable, aggregate-only evidence produced from one finished Presentation session. */
export const PresentationReportV1Schema = z
  .object({
    schemaVersion: z.literal(1).default(1),
    sessionId: z.string().uuid(),
    artifactType: z.literal("presentation"),
    presentationId: z.string().uuid(),
    presentationVersionId: z.string().uuid(),
    title: z.string().min(1).max(160),
    status: z.literal("finished"),
    trustMode: TrustModeSchema.default("learning"),
    participantCount: z.number().int().nonnegative(),
    responseCount: z.number().int().nonnegative(),
    leaderboard: z.array(
      z
        .object({
          id: z.string().uuid(),
          nickname: z.string().min(1).max(32),
          score: z.number().int().nonnegative(),
          rank: z.number().int().positive(),
        })
        .strict(),
    ),
    evidence: z.array(PresentationReportEvidenceSchema),
    recovery: z.array(
      z
        .object({
          sourceQuestionId: z.string().uuid(),
          recheckQuestionId: z.string().uuid(),
          eligible: z.number().int().nonnegative(),
          recovered: z.number().int().nonnegative(),
          recoveryPercent: z.number().min(0).max(100).nullable(),
        })
        .strict(),
    ),
    timeline: z.array(
      z
        .object({
          sequence: z.number().int().nonnegative(),
          type: PresentationReportTimelineEventTypeSchema,
          blockIndex: z.number().int().nonnegative().nullable(),
          blockId: z.string().uuid().nullable(),
          occurredAt: z.string().datetime(),
        })
        .strict(),
    ),
    evidenceNote: z.string().min(1).max(500),
    createdAt: z.string().datetime(),
    finishedAt: z.string().datetime(),
  })
  .strict();
export type PresentationReportV1 = z.infer<typeof PresentationReportV1Schema>;

/** New evidence preserves the exact selected immutable Pack/card reference, never its body. */
export const PresentationReportV2Schema = PresentationReportV1Schema.extend({
  schemaVersion: z.literal(2),
  timeline: z.array(
    PresentationReportV1Schema.shape.timeline.element
      .extend({ recoveryPackIntervention: PresentationRecoveryPackInterventionSchema.optional() })
      .superRefine((event, ctx) => {
        if (event.recoveryPackIntervention && event.type !== "intervention.presented") {
          ctx.addIssue({
            code: "custom",
            message: "Pack attribution is valid only for a presented intervention",
            path: ["recoveryPackIntervention"],
          });
        }
      }),
  ),
});
export type PresentationReportV2 = z.infer<typeof PresentationReportV2Schema>;
/** Session-only evidence is separately versioned; legacy V1/V2 stay strict and unchanged. */
export const PresentationReportV3Schema = PresentationReportV2Schema.extend({
  schemaVersion: z.literal(3),
  evidence: z.array(PresentationReportQuickCheckEvidenceSchema),
});
export type PresentationReportV3 = z.infer<typeof PresentationReportV3Schema>;
export const PresentationReportSchema = z.discriminatedUnion("schemaVersion", [
  PresentationReportV1Schema,
  PresentationReportV2Schema,
  PresentationReportV3Schema,
]);
export type PresentationReport = z.infer<typeof PresentationReportSchema>;

export const PresentationReportEnvelopeSchema = z
  .object({
    reportStatus: PresentationReportStatusSchema,
    report: PresentationReportSchema.nullable(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.reportStatus === "ready" && value.report === null) {
      context.addIssue({
        code: "custom",
        path: ["report"],
        message: "A ready Presentation report must include its immutable evidence",
      });
    }
    if (value.reportStatus === "failed" && value.report !== null) {
      context.addIssue({
        code: "custom",
        path: ["report"],
        message: "A failed Presentation report cannot include evidence",
      });
    }
  });
export type PresentationReportEnvelope = z.infer<typeof PresentationReportEnvelopeSchema>;

/** Opt-in session context keeps the persisted V1 report and original REST envelope unchanged. */
export const PresentationReportWithSessionContextEnvelopeSchema =
  PresentationReportEnvelopeSchema.safeExtend({
    sessionContext: z.object({ timeMode: PresentationTimeModeSchema }).strict(),
  });
export type PresentationReportWithSessionContextEnvelope = z.infer<
  typeof PresentationReportWithSessionContextEnvelopeSchema
>;

export * from "./recovery-pack-exports";
