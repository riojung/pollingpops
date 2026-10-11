import { createHash, randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z, ZodError } from "zod";
import Stripe from "stripe";
import {
  AnswerSubmitSchema,
  AcceptWorkspaceInvitationSchema,
  ApplyAuthoringJobSchema,
  BrandThemeSchema,
  CheckpointSetImportRequestSchema,
  CreateFolderSchema,
  CreateAuthoringJobSchema,
  CreateChatMessageSchema,
  CreateFollowupSchema,
  CreatePracticeAssignmentSchema,
  CreateAssignmentPersonalPassSchema,
  CreateAccommodationPassSchema,
  CreateWorkspaceInvitationSchema,
  CreateQuizSchema,
  CreateQnaQuestionSchema,
  CreateQnaReplySchema,
  CreateSessionStaffCredentialSchema,
  CreateSessionSchema,
  CreatorControlPassResponseSchema,
  EmbedAllowedOriginsSchema,
  EmbedPolicySchema,
  HostCommandSchema,
  FollowupAnswerSubmitSchema,
  FollowupAdvanceSchema,
  FollowupPurposeSchema,
  FederatedIdentitySchema,
  OidcStartSchema,
  OidcStatusSchema,
  JoinPreflightRequestSchema,
  JoinPreflightResponseSchema,
  JoinRequestSchema,
  LtiDeepLinkSelectionSchema,
  LtiLaunchFormSchema,
  LtiLaunchViewSchema,
  LtiLoginInitiationSchema,
  LtiRegistrationSchema,
  LocalReturnPathSchema,
  MagicLinkRequestSchema,
  MediaUploadRequestSchema,
  ModerateQnaQuestionSchema,
  ModerateQnaReplySchema,
  ModerateAudienceParticipantSchema,
  ModerateChatMessageSchema,
  OperationalFeaturesUpdateSchema,
  OperationalFeaturesViewSchema,
  OrganizeQuizSchema,
  PublicFeaturesSchema,
  ProductEventBatchSchema,
  PublishQuizRequestSchema,
  RestoreRoundDraftHistorySchema,
  ReportContextSchema,
  ReportSummaryPageSchema,
  RoundFilterOptionsResponseSchema,
  SessionSummaryPageSchema,
  FollowupSummaryPageSchema,
  StarterIdSchema,
  StartersResponseSchema,
  QuizContentSchema,
  RoundDraftMutationSchema,
  QnaSettingsSchema,
  SetAudienceSignalSchema,
  SetChatReactionSchema,
  UpdateInteractionSettingsSchema,
  UpdateLocalePreferenceSchema,
  UpdateQnaSettingsSchema,
  UpdateFolderSchema,
  UpdateQuizSchema,
  UpdateQuizRequestSchema,
  UpdateWorkspaceMemberSchema,
  UpdateWorkspaceInstitutionPolicySchema,
  UpsertLtiRegistrationSchema,
  WorkspaceInstitutionPolicySchema,
  WorkspaceInvitationSchema,
  WorkspaceMemberSchema,
  WorkspaceSummarySchema,
  StartFollowupSchema,
  type QuizDraft,
} from "@openround/contracts";
import {
  PublishedQuizLimitError,
  QuizDraftMutationConflictError,
  QuizDraftRevisionConflictError,
  type BillingEventInput,
  type CreatorContext,
  type Repository,
} from "@openround/db";
import { experiencePresets } from "@openround/experience";
import type { AppConfig } from "./config.js";
import { coreParityCreationEnabled } from "./core-parity-rollout.js";
import type { AuthService } from "./auth.js";
import { cleanPlainText, hashToken } from "./security.js";
import type { SessionService } from "./session-service.js";
import { SessionError } from "./session-service.js";
import type { RetentionService } from "./retention.js";
import type { MetricsService } from "./metrics.js";
import { reportCsv } from "./reporting.js";
import type { StorageService } from "./storage.js";
import { entitlementsFor } from "./entitlements.js";
import { validationIssueMessage } from "./validation.js";
import type { QnaService } from "./qna-service.js";
import { QnaError } from "./qna-service.js";
import { checkpointSetCsv, importCheckpointSet, openRoundJson } from "./portability.js";
import { exportQtiPackage, importQtiPackage } from "./qti.js";
import { FollowupError, type FollowupService } from "./followup-service.js";
import { AuthoringError, type AuthoringService } from "./authoring-service.js";
import { OidcError, type OidcService } from "./oidc-service.js";
import { LtiError, type LtiService } from "./lti-service.js";
import { InteractionError, type InteractionService } from "./interaction-service.js";
import { instantiateStarter, starterSummaries } from "./starters.js";
import type { ProductEventDispatcher } from "./product-events.js";
import { ROUND_DRAFT_BODY_LIMIT } from "./draft-limits.js";
import {
  evidenceWorkspaceFeatureEnabled,
  professionalWorkspaceEligible,
  professionalWorkspaceFeatureEnabled,
} from "./workspace-rollout.js";

const IdParamsSchema = z.object({ id: z.string().uuid() });
const RoundHistoryParamsSchema = z.object({
  id: z.string().uuid(),
  revision: z.coerce.number().int().nonnegative(),
});
const SessionMediaParamsSchema = z.object({ id: z.string().uuid(), mediaId: z.string().uuid() });
const SessionStaffParamsSchema = z.object({
  id: z.string().uuid(),
  credentialId: z.string().uuid(),
});
const QnaQuestionParamsSchema = z.object({
  id: z.string().uuid(),
  questionId: z.string().uuid(),
});
const QnaReplyParamsSchema = z.object({
  id: z.string().uuid(),
  replyId: z.string().uuid(),
});
const ChatMessageParamsSchema = z.object({
  id: z.string().uuid(),
  messageId: z.string().uuid(),
});
const AudienceParticipantParamsSchema = z.object({
  id: z.string().uuid(),
  participantId: z.string().uuid(),
});
const WorkspaceParamsSchema = z.object({ id: z.string().uuid() });
const WorkspaceInvitationParamsSchema = z.object({ invitationId: z.string().uuid() });
const WorkspaceMemberParamsSchema = z.object({ userId: z.string().uuid() });
const EmbedPolicyParamsSchema = z.object({
  sessionId: z.string().uuid(),
  policyKey: z.string().min(20).max(1_000),
});
const FollowupParamsSchema = z.object({ id: z.string().uuid() });
const FollowupAccessParamsSchema = z.object({
  id: z.string().uuid(),
  accessId: z.string().uuid(),
});
const FollowupMediaParamsSchema = z.object({
  id: z.string().uuid(),
  mediaId: z.string().uuid(),
});
const AuthoringJobParamsSchema = z.object({ id: z.string().uuid() });
const StarterParamsSchema = z.object({ id: StarterIdSchema });
const FederatedIdentityParamsSchema = z.object({ identityId: z.string().uuid() });
const LtiLaunchParamsSchema = z.object({ launchId: z.string().uuid() });
const LtiRegistrationParamsSchema = z.object({
  id: z.string().uuid(),
  registrationId: z.string().uuid(),
});
const QnaListQuerySchema = z.object({
  cursor: z.string().min(1).max(1_000).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});
const ChatListQuerySchema = z.object({
  cursor: z.string().min(1).max(1_000).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(30),
});
const QuizListQuerySchema = z.object({
  archived: z.enum(["true", "false"]).optional(),
  summary: z.enum(["true", "false"]).optional(),
});
const InteractionTranscriptQuerySchema = z.object({
  audit: z.enum(["true", "false"]).default("false"),
});
const HistoryCursorSchema = z
  .string()
  .min(1)
  .max(1_000)
  .transform((value, context) => {
    try {
      const decoded = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
      return z
        .object({ createdAt: z.string().datetime(), id: z.string().uuid() })
        .strict()
        .parse(decoded);
    } catch {
      context.addIssue({ code: "custom", message: "Cursor is malformed" });
      return z.NEVER;
    }
  });
const HistoryQueryBase = {
  cursor: HistoryCursorSchema.optional(),
  limit: z.coerce.number().int().min(1).max(50).default(25),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
};
const SessionHistoryQuerySchema = z.object({
  ...HistoryQueryBase,
  status: z.enum(["active", "finished", "expired"]).optional(),
  quizId: z.string().uuid().optional(),
});
const ReportHistoryQuerySchema = z.object({
  ...HistoryQueryBase,
  status: z.enum(["pending", "ready", "failed"]).optional(),
  quizId: z.string().uuid().optional(),
});
const FollowupHistoryQuerySchema = z.object({
  ...HistoryQueryBase,
  purpose: FollowupPurposeSchema.optional(),
  status: z.enum(["scheduled", "open", "closed", "expired"]).optional(),
  quizId: z.string().uuid().optional(),
});

function historyCursor(item: { createdAt: Date; cursorCreatedAt?: string; id: string }) {
  return Buffer.from(
    JSON.stringify({
      createdAt: item.cursorCreatedAt ?? item.createdAt.toISOString(),
      id: item.id,
    }),
    "utf8",
  ).toString("base64url");
}

function transcriptCsvCell(value: unknown) {
  const raw = value === null || value === undefined ? "" : String(value);
  const safe = /^(?:\s*[=+@-]|[\t\r\n])/.test(raw) ? `'${raw}` : raw;
  return /[",\n\r]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

function transcriptCsv(transcript: {
  signals: Array<Record<string, unknown>>;
  messages: Array<Record<string, unknown>>;
}) {
  const rows: unknown[][] = [
    ["record_type", "created_at", "context_or_message_id", "alias", "value", "status"],
    ...transcript.signals.map((signal) => [
      "signal",
      signal.createdAt,
      signal.contextKey,
      signal.alias,
      signal.signal,
      "",
    ]),
    ...transcript.messages.map((message) => [
      "chat",
      message.createdAt,
      message.id,
      message.alias,
      message.body,
      message.status,
    ]),
  ];
  return `\uFEFF${rows.map((row) => row.map(transcriptCsvCell).join(",")).join("\r\n")}\r\n`;
}

function apiError(
  reply: FastifyReply,
  status: number,
  code: string,
  message: string,
  requestId: string,
) {
  return reply.code(status).send({ error: { code, message, requestId } });
}

function draftEtag(revision: number | undefined) {
  return `"draft-${revision ?? 0}"`;
}

interface RoundPublishIssue {
  artifactType: "round";
  artifactId: string;
  questionId: string | null;
  field: string;
  path: string;
  message: string;
}

function roundPublishIssue(
  quizId: string,
  draft: QuizDraft,
  path: readonly PropertyKey[],
  message: string,
): RoundPublishIssue {
  const questionIndex = path[0] === "questions" && typeof path[1] === "number" ? path[1] : -1;
  const field = [...path].reverse().find((part) => typeof part === "string");
  return {
    artifactType: "round",
    artifactId: quizId,
    questionId: questionIndex >= 0 ? (draft.questions[questionIndex]?.id ?? null) : null,
    field: typeof field === "string" ? field : "artifact",
    path: path.map(String).join("."),
    message,
  };
}

function roundPublishValidationError(
  reply: FastifyReply,
  requestId: string,
  issues: RoundPublishIssue[],
) {
  return reply.code(422).send({
    error: {
      code: "VALIDATION_ERROR",
      message: "This Round has publish blockers. Review every issue and try again.",
      requestId,
      details: { issues },
    },
    validation: { issues },
  });
}

function sessionStatus(code: SessionError["code"]) {
  if (code === "UNAUTHORIZED") return 401;
  if (code === "INSTITUTION_AUTH_REQUIRED") return 403;
  if (code === "NOT_FOUND" || code === "INVALID_CODE") return 404;
  if (code === "ENTITLEMENT_LIMIT") return 402;
  if (
    code === "SESSION_FULL" ||
    code === "SESSION_LOCKED" ||
    code === "STALE_VERSION" ||
    code === "CONFLICT"
  )
    return 409;
  if (code === "NICKNAME_REJECTED" || code === "ANSWER_INVALID" || code === "ANSWER_LATE")
    return 422;
  return 400;
}

function qnaStatus(code: QnaError["code"]) {
  if (code === "UNAUTHORIZED") return 401;
  if (code === "NOT_FOUND") return 404;
  if (code === "QNA_RATE_LIMITED") return 429;
  return 409;
}

function interactionStatus(code: InteractionError["code"]) {
  if (code === "UNAUTHORIZED") return 401;
  if (code === "NOT_FOUND") return 404;
  if (code.endsWith("RATE_LIMITED")) return 429;
  if (code === "CHAT_MUTED" || code === "AUDIENCE_BANNED") return 403;
  if (code === "CHAT_CAPACITY_REACHED") return 409;
  return 409;
}

function requestIdempotencyKey(request: FastifyRequest) {
  const raw = request.headers["x-idempotency-key"];
  return z
    .string()
    .min(8)
    .max(160)
    .parse(Array.isArray(raw) ? raw[0] : raw);
}

function followupStatus(code: FollowupError["code"]) {
  if (code === "UNAUTHORIZED") return 401;
  if (code === "NOT_FOUND") return 404;
  if (code === "ANSWER_INVALID" || code === "ANSWER_LATE") return 422;
  return 409;
}

function authoringStatus(code: AuthoringError["code"]) {
  if (code === "NOT_FOUND") return 404;
  if (code === "AUTHORING_DISABLED") return 503;
  if (code === "AUTHORING_LIMIT") return 402;
  if (code === "ANSWER_INVALID") return 422;
  return 409;
}

function oidcStatus(code: OidcError["code"]) {
  if (code === "UNAUTHORIZED") return 401;
  if (code === "FEDERATED_IDENTITY_NOT_LINKED" || code === "INSTITUTION_NOT_ENABLED") return 403;
  if (code === "FEDERATED_AUTH_DISABLED") return 503;
  if (code === "FEDERATED_AUTH_REPLAYED") return 400;
  return 409;
}

function ltiStatus(code: LtiError["code"]) {
  if (code === "UNAUTHORIZED") return 401;
  if (code === "INSTITUTION_NOT_ENABLED") return 403;
  if (code === "NOT_FOUND" || code === "LTI_REGISTRATION_NOT_FOUND") return 404;
  if (code === "LTI_DISABLED") return 503;
  if (code === "LTI_LAUNCH_INVALID") return 400;
  return 409;
}

export async function registerRoutes(
  app: FastifyInstance,
  dependencies: {
    config: AppConfig;
    repository: Repository;
    auth: AuthService;
    oidc: OidcService;
    lti: LtiService;
    sessions: SessionService;
    qna: QnaService;
    interactions: InteractionService;
    followups: FollowupService;
    authoring: AuthoringService;
    storage: StorageService;
    retention: RetentionService;
    metrics: MetricsService;
    productEvents: ProductEventDispatcher;
    readiness: () => Promise<void>;
    stripeClient?: Stripe | null;
  },
) {
  const {
    config,
    repository,
    auth,
    oidc,
    lti,
    sessions,
    qna,
    interactions,
    followups,
    authoring,
    storage,
    retention,
    metrics,
    productEvents,
  } = dependencies;
  const stripe =
    dependencies.stripeClient !== undefined
      ? dependencies.stripeClient
      : config.BILLING_MODE === "stripe"
        ? new Stripe(config.STRIPE_SECRET_KEY!)
        : null;
  const operationalFeatures = async () => {
    const runtime = await repository.getOperationalFeatures();
    const configured = {
      signups: config.FEATURE_SIGNUPS,
      sessionCreation: config.FEATURE_SESSION_CREATION,
      mediaUploads: storage.mediaUploadsEnabled,
      roundExperiences: config.FEATURE_ROUND_EXPERIENCES,
      audiencePulse: config.FEATURE_AUDIENCE_PULSE,
      roomChat: config.FEATURE_ROOM_CHAT,
    };
    return OperationalFeaturesViewSchema.parse({
      configured,
      runtime: {
        signups: runtime.signups,
        sessionCreation: runtime.sessionCreation,
        mediaUploads: runtime.mediaUploads,
        roundExperiences: runtime.roundExperiences,
        audiencePulse: runtime.audiencePulse,
        roomChat: runtime.roomChat,
        updatedAt: runtime.updatedAt?.toISOString() ?? null,
      },
      effective: {
        signups: configured.signups && runtime.signups,
        sessionCreation: configured.sessionCreation && runtime.sessionCreation,
        mediaUploads: configured.mediaUploads && runtime.mediaUploads,
        roundExperiences: configured.roundExperiences && runtime.roundExperiences,
        audiencePulse: configured.audiencePulse && runtime.audiencePulse,
        roomChat: configured.roomChat && runtime.roomChat,
      },
    });
  };
  const uxBetaWorkspaceEnabled = (workspaceId: string) =>
    professionalWorkspaceEligible(config, workspaceId);
  const practiceAssignmentsWorkspaceEnabled = (workspaceId: string) =>
    uxBetaWorkspaceEnabled(workspaceId) && config.FEATURE_PRACTICE_ASSIGNMENTS;
  const workspaceProductFeatures = async (workspaceId: string) => {
    const { effective } = await operationalFeatures();
    const allowlist = config.THEMED_INTERACTIONS_WORKSPACE_ALLOWLIST;
    const workspaceAllowed = allowlist.length === 0 || allowlist.includes(workspaceId);
    const uxAllowlist = config.UX_BETA_WORKSPACE_ALLOWLIST;
    const uxAllowed = uxAllowlist.includes(workspaceId);
    return {
      roundExperiences: workspaceAllowed && effective.roundExperiences,
      audiencePulse: workspaceAllowed && effective.audiencePulse,
      roomChat: workspaceAllowed && effective.roomChat,
      uxBeta: uxBetaWorkspaceEnabled(workspaceId),
      recoveryRehearsal: uxAllowed && config.FEATURE_UX_BETA && config.FEATURE_RECOVERY_REHEARSAL,
      practiceAssignments: practiceAssignmentsWorkspaceEnabled(workspaceId),
      workspaceShell: professionalWorkspaceFeatureEnabled(config, workspaceId, "workspaceShell"),
      builderV2: professionalWorkspaceFeatureEnabled(config, workspaceId, "builderV2"),
      presentations: professionalWorkspaceFeatureEnabled(config, workspaceId, "presentations"),
      presentationRealtime:
        professionalWorkspaceFeatureEnabled(config, workspaceId, "presentations") &&
        evidenceWorkspaceFeatureEnabled(config, workspaceId, "presentationRealtime"),
      presentationCompanion:
        professionalWorkspaceFeatureEnabled(config, workspaceId, "presentations") &&
        evidenceWorkspaceFeatureEnabled(config, workspaceId, "presentationCompanion"),
      liveFlexMode: evidenceWorkspaceFeatureEnabled(config, workspaceId, "liveFlexMode"),
      questionHealth: evidenceWorkspaceFeatureEnabled(config, workspaceId, "questionHealth"),
      surveys: coreParityCreationEnabled(config, workspaceId, "surveys"),
      recoveryPacks: evidenceWorkspaceFeatureEnabled(config, workspaceId, "recoveryPacks"),
      groups: professionalWorkspaceFeatureEnabled(config, workspaceId, "groups"),
      discover: professionalWorkspaceFeatureEnabled(config, workspaceId, "discover"),
    };
  };
  const requireWorkspaceRole = (
    creator: CreatorContext,
    allowed: CreatorContext["role"][],
    reply: FastifyReply,
    requestId: string,
  ) =>
    allowed.includes(creator.role)
      ? true
      : apiError(
          reply,
          403,
          "UNAUTHORIZED",
          "Your workspace role does not allow this action",
          requestId,
        );

  const interactionTranscript = async (
    creator: CreatorContext,
    reportId: string,
    includeRemovedBodies: boolean,
  ) => {
    const report = await repository.getReport(creator.workspaceId, reportId);
    if (!report) return null;
    const [session, evidence] = await Promise.all([
      repository.getSessionById(report.sessionId),
      repository.getSessionEvidence(creator.workspaceId, report.sessionId),
    ]);
    if (!session) return null;
    const participantAliases = new Map(
      Object.values(session.state.participants).map((participant) => [
        participant.id,
        participant.nickname,
      ]),
    );
    const interactionEvidence = evidence.interactions ?? {
      signalEvents: [],
      chatMessages: [],
      reactions: [],
      reports: 0,
      moderationActions: 0,
    };
    return {
      reportId,
      sessionId: report.sessionId,
      experience: session.state.experienceTheme,
      signals: interactionEvidence.signalEvents.map((event) => ({
        contextKey: event.contextKey,
        participantId: event.participantId,
        alias: participantAliases.get(event.participantId) ?? "Participant",
        signal: event.signal,
        createdAt: event.createdAt.toISOString(),
      })),
      messages: interactionEvidence.chatMessages.map((message) => {
        const privateParticipantForViewer = Boolean(
          message.participantId &&
          message.identityModeAtCreation === "alias_private" &&
          creator.role === "viewer",
        );
        return {
          id: message.id,
          replyToMessageId: message.replyToId,
          participantId: privateParticipantForViewer ? null : message.participantId,
          alias: privateParticipantForViewer ? "Anonymous" : message.authorAlias,
          identityModeAtCreation: message.identityModeAtCreation,
          body: message.status === "removed" && !includeRemovedBodies ? null : message.body,
          status: message.status,
          pinned: message.pinned,
          reactions: interactionEvidence.reactions.filter(
            (reaction) => reaction.messageId === message.id,
          ).length,
          createdAt: message.createdAt.toISOString(),
        };
      }),
      counts: {
        reports: interactionEvidence.reports,
        moderationActions: interactionEvidence.moderationActions,
      },
    };
  };
  const reportContext = async (report: { sessionId: string }) => {
    const session = await repository.getSessionById(report.sessionId);
    if (!session) return null;
    const version = await repository.getQuizVersion(session.workspaceId, session.quizVersionId);
    if (!version) return null;
    return ReportContextSchema.parse({
      quizId: version.quizId,
      quizTitle: session.state.quiz.title,
      sessionCreatedAt: session.createdAt.toISOString(),
      sessionUpdatedAt: session.updatedAt.toISOString(),
    });
  };

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError) {
      return apiError(
        reply,
        400,
        "VALIDATION_ERROR",
        error.issues[0] ? validationIssueMessage(error.issues[0]) : "Request: Invalid value",
        request.id,
      );
    }
    if (error instanceof QuizDraftRevisionConflictError) {
      return reply.code(409).send({
        error: {
          code: "STALE_DRAFT",
          message: "This Round changed since you opened it. Refresh before saving or publishing.",
          requestId: request.id,
          details: {
            quizId: error.quizId,
            expectedDraftRevision: error.expectedRevision,
            currentDraftRevision: error.currentRevision,
            currentEditorId: error.currentEditorId,
          },
        },
      });
    }
    if (error instanceof QuizDraftMutationConflictError) {
      return reply.code(409).send({
        error: {
          code: "CONFLICT",
          message: "This mutation ID was already used for a different Round change.",
          requestId: request.id,
          details: { mutationId: error.mutationId },
        },
      });
    }
    if (error instanceof SessionError) {
      return apiError(reply, sessionStatus(error.code), error.code, error.message, request.id);
    }
    if (error instanceof QnaError) {
      return apiError(reply, qnaStatus(error.code), error.code, error.message, request.id);
    }
    if (error instanceof InteractionError) {
      return apiError(reply, interactionStatus(error.code), error.code, error.message, request.id);
    }
    if (error instanceof FollowupError) {
      return apiError(reply, followupStatus(error.code), error.code, error.message, request.id);
    }
    if (error instanceof AuthoringError) {
      return apiError(reply, authoringStatus(error.code), error.code, error.message, request.id);
    }
    if (error instanceof OidcError) {
      return apiError(reply, oidcStatus(error.code), error.code, error.message, request.id);
    }
    if (error instanceof LtiError) {
      return apiError(reply, ltiStatus(error.code), error.code, error.message, request.id);
    }
    if (error instanceof PublishedQuizLimitError) {
      return apiError(reply, 402, "ENTITLEMENT_LIMIT", error.message, request.id);
    }
    if ((error as { code?: string }).code === "23505") {
      return apiError(reply, 409, "CONFLICT", "The requested record already exists", request.id);
    }
    if ((error as { statusCode?: number }).statusCode === 429) {
      return apiError(
        reply,
        429,
        "RATE_LIMITED",
        "Too many requests. Wait before trying again",
        request.id,
      );
    }
    request.log.error({ err: error }, "request failed");
    return apiError(reply, 500, "INTERNAL_ERROR", "The request could not be completed", request.id);
  });

  app.get("/health/live", async () => ({ status: "ok", buildId: config.OPENROUND_BUILD_ID }));
  app.get("/health/ready", async (request, reply) => {
    try {
      await dependencies.readiness();
      return {
        status: "ready",
        dependencies: { database: "ready", coordination: "ready" },
        storage: storage.configured ? "configured" : "disabled",
        mediaScanning: storage.mediaUploadsEnabled ? "enabled" : "disabled",
      };
    } catch (error) {
      request.log.warn({ err: error }, "readiness dependency check failed");
      return reply.code(503).send({
        status: "not_ready",
        dependencies: { database: "unknown", coordination: "unknown" },
      });
    }
  });

  app.get("/metrics", async (request, reply) => {
    if (!config.METRICS_ENABLED)
      return apiError(reply, 404, "NOT_FOUND", "Metrics are disabled", request.id);
    const token = request.headers.authorization?.replace(/^Bearer\s+/i, "");
    if (config.METRICS_TOKEN && token !== config.METRICS_TOKEN) {
      return apiError(reply, 401, "UNAUTHORIZED", "Metrics token required", request.id);
    }
    return reply.header("content-type", metrics.contentType).send(await metrics.render());
  });

  app.get("/v1/features", async () => {
    const { effective } = await operationalFeatures();
    return PublicFeaturesSchema.parse({
      publicWebUrl: config.WEB_ORIGIN,
      ...(config.COMMUNITY_MODE && config.DEVELOPMENT_EMAIL_INBOX_URL
        ? { developmentEmailInboxUrl: config.DEVELOPMENT_EMAIL_INBOX_URL }
        : {}),
      mediaUploads: effective.mediaUploads,
      billing: config.BILLING_MODE,
      communityMode: config.COMMUNITY_MODE,
      signups: effective.signups,
      sessionCreation: effective.sessionCreation,
      roundExperiences: effective.roundExperiences,
      audiencePulse: effective.audiencePulse,
      roomChat: effective.roomChat,
      uxBeta: config.FEATURE_UX_BETA,
      recoveryRehearsal: config.FEATURE_UX_BETA && config.FEATURE_RECOVERY_REHEARSAL,
      practiceAssignments: config.FEATURE_UX_BETA && config.FEATURE_PRACTICE_ASSIGNMENTS,
      presentations: config.FEATURE_PRESENTATIONS,
    });
  });

  app.get("/v1/experience-presets", async (request, reply) => {
    if (!(await operationalFeatures()).effective.roundExperiences) {
      return apiError(
        reply,
        503,
        "DEPENDENCY_UNAVAILABLE",
        "Round Experiences are temporarily unavailable",
        request.id,
      );
    }
    return { presets: experiencePresets };
  });

  app.post("/v1/auth/magic-link", async (request, reply) => {
    if (!(await operationalFeatures()).effective.signups) {
      return apiError(
        reply,
        503,
        "DEPENDENCY_UNAVAILABLE",
        "New sign-ins are temporarily paused",
        request.id,
      );
    }
    const input = MagicLinkRequestSchema.parse(request.body);
    const debugUrl = await auth.requestMagicLink(input.email, input.segment, input.returnTo);
    return reply.code(202).send({ accepted: true, ...(debugUrl ? { debugUrl } : {}) });
  });

  app.get("/v1/auth/verify", async (request, reply) => {
    const { token, returnTo } = z
      .object({
        token: z.string().min(20),
        returnTo: LocalReturnPathSchema.optional(),
      })
      .parse(request.query);
    const verified = await auth.verifyMagicLink(token);
    if (!verified)
      return apiError(
        reply,
        400,
        "UNAUTHORIZED",
        "This sign-in link is invalid or expired",
        request.id,
      );
    auth.setSessionCookie(reply, verified.sessionToken);
    return reply.redirect(
      auth.localeAwareWebRedirect(verified.creator, returnTo ?? "/dashboard?welcome=1"),
    );
  });

  app.get("/v1/auth/me", async (request, reply) => {
    const creator = await auth.requireCreator(request, reply);
    if (!creator) return;
    const entitlements = entitlementsFor(creator.plan, config);
    return {
      creator,
      entitlements,
      productFeatures: await workspaceProductFeatures(creator.workspaceId),
      brandTheme: entitlements.brandTheme
        ? await repository.getBrandTheme(creator.workspaceId)
        : null,
    };
  });

  app.put("/v1/account/locale", async (request, reply) => {
    const creator = await auth.requireCreator(request, reply);
    if (!creator) return;
    const { locale } = UpdateLocalePreferenceSchema.parse(request.body);
    const updated = await repository.updateUserLocale(creator.userId, locale);
    if (!updated) {
      return apiError(reply, 404, "NOT_FOUND", "Account not found", request.id);
    }
    return { locale: updated };
  });

  app.post(
    "/v1/product-events",
    { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const creator = await auth.requireCreator(request, reply);
      if (!creator) return;
      const input = ProductEventBatchSchema.parse(request.body);
      if (!uxBetaWorkspaceEnabled(creator.workspaceId)) {
        return reply.code(202).send({ accepted: 0 });
      }
      const accepted = productEvents.enqueue({
        workspaceId: creator.workspaceId,
        segment: creator.segment,
        authoritative: false,
        events: input.events,
      });
      return reply.code(202).send({ accepted });
    },
  );

  app.get("/v1/auth/oidc/status", async (request) => {
    const { workspaceId } = z.object({ workspaceId: z.string().uuid() }).parse(request.query);
    return OidcStatusSchema.parse(await oidc.status(workspaceId));
  });

  app.post(
    "/v1/auth/oidc/start",
    { config: { rateLimit: { max: 10, timeWindow: "5 minutes" } } },
    async (request) => {
      const input = OidcStartSchema.parse(request.body);
      const creator = await auth.creatorFromRequest(request);
      return oidc.start(input.workspaceId, input.mode, creator);
    },
  );

  app.get(
    "/v1/auth/oidc/callback",
    { config: { rateLimit: { max: 30, timeWindow: "5 minutes" } } },
    async (request, reply) => {
      const { state } = z.object({ state: z.string().min(20).max(1_000) }).parse(request.query);
      const creator = await auth.creatorFromRequest(request);
      const result = await oidc.callback(
        new URL(request.url, config.PUBLIC_API_URL),
        state,
        creator,
      );
      await repository.recordAudit({
        workspaceId: result.creator.workspaceId,
        actorId: result.creator.userId,
        action: result.mode === "link" ? "federated_identity.link" : "federated_identity.login",
        targetType: "external_identity",
        targetId: result.identity.id,
        requestId: request.id,
        metadata: { provider: "oidc", issuer: result.identity.issuer },
      });
      if (result.mode === "login") {
        const session = await auth.issueCreatorSession(result.creator);
        auth.setSessionCookie(reply, session.sessionToken);
        return reply.redirect(
          auth.localeAwareWebRedirect(session.creator, "/dashboard?federated=1"),
        );
      }
      return reply.redirect(`${config.WEB_ORIGIN}/account?federated=linked`);
    },
  );

  app.get("/v1/auth/federated-identities", async (request, reply) => {
    const creator = await auth.requireCreator(request, reply);
    if (!creator) return;
    const identities = await repository.listExternalIdentities(creator.workspaceId, creator.userId);
    return {
      identities: identities.map((identity) =>
        FederatedIdentitySchema.parse({
          id: identity.id,
          provider: identity.provider,
          issuer: identity.issuer,
          emailHint: identity.emailHint,
          linkedAt: identity.linkedAt.toISOString(),
          lastUsedAt: identity.lastUsedAt?.toISOString() ?? null,
        }),
      ),
    };
  });

  app.delete("/v1/auth/federated-identities/:identityId", async (request, reply) => {
    const creator = await auth.requireCreator(request, reply);
    if (!creator) return;
    const { identityId } = FederatedIdentityParamsSchema.parse(request.params);
    const removed = await repository.unlinkExternalIdentity(
      creator.workspaceId,
      creator.userId,
      identityId,
    );
    if (!removed) {
      return apiError(reply, 404, "NOT_FOUND", "Linked identity not found", request.id);
    }
    await repository.recordAudit({
      workspaceId: creator.workspaceId,
      actorId: creator.userId,
      action: "federated_identity.unlink",
      targetType: "external_identity",
      targetId: identityId,
      requestId: request.id,
    });
    return reply.code(204).send();
  });

  app.get("/v1/lti/jwks", async (request, reply) => {
    reply.header("cache-control", "public, max-age=300, stale-while-revalidate=300");
    return lti.publicJwks();
  });

  app.post(
    "/v1/lti/login",
    { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const input = LtiLoginInitiationSchema.parse(request.body);
      const result = await lti.login(input);
      return reply.redirect(result.authorizationUrl);
    },
  );

  app.post(
    "/v1/lti/launch",
    {
      bodyLimit: 70_000,
      config: { rateLimit: { max: 60, timeWindow: "1 minute" } },
    },
    async (request, reply) => {
      const input = LtiLaunchFormSchema.parse(request.body);
      const result = await lti.launch(input.state, input.id_token);
      await repository.recordAudit({
        workspaceId: result.launch.workspaceId,
        actorId: result.creator?.userId ?? null,
        action: "lti.launch.accept",
        targetType: "lti_launch",
        targetId: result.launch.id,
        requestId: request.id,
        metadata: {
          messageType: result.launch.messageType,
          role: result.launch.role,
          registrationId: result.launch.registrationId,
        },
      });
      if (result.linkToken) {
        return reply.redirect(
          `${config.WEB_ORIGIN}/lti/link#token=${encodeURIComponent(result.linkToken)}`,
        );
      }
      const session = await auth.issueCreatorSession(result.creator!);
      auth.setSessionCookie(reply, session.sessionToken);
      if (result.launch.messageType === "LtiDeepLinkingRequest") {
        return reply.redirect(
          auth.localeAwareWebRedirect(session.creator, `/lti/select?launchId=${result.launch.id}`),
        );
      }
      return reply.redirect(
        auth.localeAwareWebRedirect(
          session.creator,
          result.launch.quizId ? `/host/setup/${result.launch.quizId}` : "/dashboard?lti=1",
        ),
      );
    },
  );

  app.post("/v1/lti/link", async (request, reply) => {
    const creator = await auth.requireCreator(request, reply);
    if (!creator) return;
    const { token } = z.object({ token: z.string().min(20).max(1_000) }).parse(request.body);
    const launch = await lti.bind(creator, token);
    await repository.recordAudit({
      workspaceId: creator.workspaceId,
      actorId: creator.userId,
      action: "lti.identity.link",
      targetType: "lti_launch",
      targetId: launch.id,
      requestId: request.id,
      metadata: { registrationId: launch.registrationId },
    });
    return {
      launch: LtiLaunchViewSchema.parse({
        id: launch.id,
        messageType: launch.messageType,
        role: launch.role,
        quizId: launch.quizId,
        expiresAt: launch.expiresAt.toISOString(),
      }),
      destination:
        launch.messageType === "LtiDeepLinkingRequest"
          ? `/lti/select?launchId=${launch.id}`
          : launch.quizId
            ? `/host/setup/${launch.quizId}`
            : "/dashboard?lti=1",
    };
  });

  app.get("/v1/lti/launches/:launchId", async (request, reply) => {
    const creator = await auth.requireCreator(request, reply);
    if (!creator) return;
    const { launchId } = LtiLaunchParamsSchema.parse(request.params);
    const launch = await lti.getLaunch(creator, launchId);
    return {
      launch: LtiLaunchViewSchema.parse({
        id: launch.id,
        messageType: launch.messageType,
        role: launch.role,
        quizId: launch.quizId,
        expiresAt: launch.expiresAt.toISOString(),
      }),
    };
  });

  app.post("/v1/lti/launches/:launchId/deep-link", async (request, reply) => {
    const creator = await auth.requireCreator(request, reply);
    if (!creator) return;
    if (requireWorkspaceRole(creator, ["owner", "editor"], reply, request.id) !== true) return;
    const { launchId } = LtiLaunchParamsSchema.parse(request.params);
    const input = LtiDeepLinkSelectionSchema.parse(request.body);
    const result = await lti.createDeepLink(creator, launchId, input.quizId);
    await repository.recordAudit({
      workspaceId: creator.workspaceId,
      actorId: creator.userId,
      action: "lti.deep_link.create",
      targetType: "quiz",
      targetId: result.quizId,
      requestId: request.id,
      metadata: { launchId },
    });
    return result;
  });

  app.post("/v1/invitations/accept", async (request, reply) => {
    const input = AcceptWorkspaceInvitationSchema.parse(request.body);
    const accepted = await auth.acceptWorkspaceInvitation(input.token);
    if (!accepted) {
      return apiError(
        reply,
        400,
        "UNAUTHORIZED",
        "This workspace invitation is invalid, expired, or already used",
        request.id,
      );
    }
    auth.setSessionCookie(reply, accepted.sessionToken);
    return { creator: accepted.creator };
  });

  app.get("/v1/workspaces", async (request, reply) => {
    const creator = await auth.requireCreator(request, reply);
    if (!creator) return;
    const workspaces = await repository.listWorkspaces(creator.userId);
    return {
      activeWorkspaceId: creator.workspaceId,
      workspaces: workspaces.map((workspace) => WorkspaceSummarySchema.parse(workspace)),
    };
  });

  app.post("/v1/workspaces/:id/select", async (request, reply) => {
    const creator = await auth.requireCreator(request, reply);
    if (!creator) return;
    const { id } = WorkspaceParamsSchema.parse(request.params);
    const selected = await auth.switchWorkspace(request, creator, id);
    if (!selected) {
      return apiError(reply, 404, "NOT_FOUND", "Workspace membership not found", request.id);
    }
    return { activeWorkspaceId: id };
  });

  app.get("/v1/workspace/members", async (request, reply) => {
    const creator = await auth.requireCreator(request, reply);
    if (!creator) return;
    if (requireWorkspaceRole(creator, ["owner"], reply, request.id) !== true) return;
    const [members, invitations] = await Promise.all([
      repository.listWorkspaceMembers(creator.workspaceId),
      repository.listWorkspaceInvitations(creator.workspaceId),
    ]);
    return {
      members: members.map((member) =>
        WorkspaceMemberSchema.parse({
          ...member,
          joinedAt: member.joinedAt?.toISOString() ?? null,
        }),
      ),
      invitations: invitations.map((invitation) =>
        WorkspaceInvitationSchema.parse({
          ...invitation,
          tokenHash: undefined,
          expiresAt: invitation.expiresAt.toISOString(),
          acceptedAt: invitation.acceptedAt?.toISOString() ?? null,
          revokedAt: invitation.revokedAt?.toISOString() ?? null,
          createdAt: invitation.createdAt.toISOString(),
        }),
      ),
    };
  });

  app.get("/v1/workspace/institution-policy", async (request, reply) => {
    const creator = await auth.requireCreator(request, reply);
    if (!creator) return;
    const policy = await repository.getInstitutionPolicy(creator.workspaceId);
    return WorkspaceInstitutionPolicySchema.parse({
      ...policy,
      updatedAt: policy.updatedAt?.toISOString() ?? null,
    });
  });

  app.get("/v1/workspace/lti-registrations", async (request, reply) => {
    const creator = await auth.requireCreator(request, reply);
    if (!creator) return;
    if (requireWorkspaceRole(creator, ["owner"], reply, request.id) !== true) return;
    const registrations = await repository.listLtiRegistrations(creator.workspaceId);
    return {
      registrations: registrations.map((registration) =>
        LtiRegistrationSchema.parse({
          ...registration,
          createdAt: registration.createdAt.toISOString(),
          updatedAt: registration.updatedAt.toISOString(),
        }),
      ),
    };
  });

  app.post("/v1/workspace/invitations", async (request, reply) => {
    const creator = await auth.requireCreator(request, reply);
    if (!creator) return;
    if (requireWorkspaceRole(creator, ["owner"], reply, request.id) !== true) return;
    const input = CreateWorkspaceInvitationSchema.parse(request.body);
    const members = await repository.listWorkspaceMembers(creator.workspaceId);
    if (members.some((member) => member.email.toLocaleLowerCase() === input.email)) {
      return apiError(
        reply,
        409,
        "CONFLICT",
        "This person is already a workspace member",
        request.id,
      );
    }
    const result = await auth.inviteWorkspace(creator, input.email, input.role);
    await repository.recordAudit({
      workspaceId: creator.workspaceId,
      actorId: creator.userId,
      action: "workspace.invitation.create",
      targetType: "workspace_invitation",
      targetId: result.invitation.id,
      requestId: request.id,
      metadata: { email: input.email, role: input.role },
    });
    return reply.code(201).send({
      invitation: WorkspaceInvitationSchema.parse({
        ...result.invitation,
        tokenHash: undefined,
        expiresAt: result.invitation.expiresAt.toISOString(),
        acceptedAt: null,
        revokedAt: null,
        createdAt: result.invitation.createdAt.toISOString(),
      }),
      ...(result.debugUrl ? { debugUrl: result.debugUrl } : {}),
    });
  });

  app.delete("/v1/workspace/invitations/:invitationId", async (request, reply) => {
    const creator = await auth.requireCreator(request, reply);
    if (!creator) return;
    if (requireWorkspaceRole(creator, ["owner"], reply, request.id) !== true) return;
    const { invitationId } = WorkspaceInvitationParamsSchema.parse(request.params);
    const revoked = await repository.revokeWorkspaceInvitation(creator.workspaceId, invitationId);
    if (!revoked) {
      return apiError(reply, 404, "NOT_FOUND", "Active invitation not found", request.id);
    }
    await repository.recordAudit({
      workspaceId: creator.workspaceId,
      actorId: creator.userId,
      action: "workspace.invitation.revoke",
      targetType: "workspace_invitation",
      targetId: invitationId,
      requestId: request.id,
    });
    return reply.code(204).send();
  });

  app.patch("/v1/workspace/members/:userId", async (request, reply) => {
    const creator = await auth.requireCreator(request, reply);
    if (!creator) return;
    if (requireWorkspaceRole(creator, ["owner"], reply, request.id) !== true) return;
    const { userId } = WorkspaceMemberParamsSchema.parse(request.params);
    const input = UpdateWorkspaceMemberSchema.parse(request.body);
    const member = await repository.updateWorkspaceMemberRole(
      creator.workspaceId,
      userId,
      input.role,
    );
    if (!member) {
      return apiError(
        reply,
        409,
        "CONFLICT",
        "Owners cannot be changed or member was not found",
        request.id,
      );
    }
    await repository.recordAudit({
      workspaceId: creator.workspaceId,
      actorId: creator.userId,
      action: "workspace.member.role.update",
      targetType: "workspace_member",
      targetId: userId,
      requestId: request.id,
      metadata: { role: input.role },
    });
    return {
      member: WorkspaceMemberSchema.parse({
        ...member,
        joinedAt: member.joinedAt?.toISOString() ?? null,
      }),
    };
  });

  app.delete("/v1/workspace/members/:userId", async (request, reply) => {
    const creator = await auth.requireCreator(request, reply);
    if (!creator) return;
    if (requireWorkspaceRole(creator, ["owner"], reply, request.id) !== true) return;
    const { userId } = WorkspaceMemberParamsSchema.parse(request.params);
    if (userId === creator.userId) {
      return apiError(
        reply,
        409,
        "CONFLICT",
        "The workspace owner cannot remove themselves",
        request.id,
      );
    }
    const removed = await repository.removeWorkspaceMember(creator.workspaceId, userId);
    if (!removed) {
      return apiError(reply, 404, "NOT_FOUND", "Removable workspace member not found", request.id);
    }
    await repository.recordAudit({
      workspaceId: creator.workspaceId,
      actorId: creator.userId,
      action: "workspace.member.remove",
      targetType: "workspace_member",
      targetId: userId,
      requestId: request.id,
    });
    return reply.code(204).send();
  });

  app.get("/v1/account/theme", async (request, reply) => {
    const creator = await auth.requireCreator(request, reply);
    if (!creator) return;
    const entitlements = entitlementsFor(creator.plan, config);
    return {
      theme: await repository.getBrandTheme(creator.workspaceId),
      enabled: entitlements.brandTheme,
    };
  });

  app.put("/v1/account/theme", async (request, reply) => {
    const creator = await auth.requireCreator(request, reply);
    if (!creator) return;
    if (requireWorkspaceRole(creator, ["owner"], reply, request.id) !== true) return;
    const entitlements = entitlementsFor(creator.plan, config);
    if (!entitlements.brandTheme) {
      return apiError(
        reply,
        402,
        "ENTITLEMENT_LIMIT",
        "A workspace brand theme requires Pro",
        request.id,
      );
    }
    const input = BrandThemeSchema.parse(request.body);
    const theme = BrandThemeSchema.parse({
      ...input,
      organizationName: cleanPlainText(input.organizationName, 80),
    });
    await repository.updateBrandTheme(creator.workspaceId, theme);
    await repository.recordAudit({
      workspaceId: creator.workspaceId,
      actorId: creator.userId,
      action: "workspace.theme.update",
      targetType: "workspace",
      targetId: creator.workspaceId,
      requestId: request.id,
      metadata: { organizationName: theme.organizationName },
    });
    return { theme };
  });

  app.delete("/v1/account/theme", async (request, reply) => {
    const creator = await auth.requireCreator(request, reply);
    if (!creator) return;
    if (requireWorkspaceRole(creator, ["owner"], reply, request.id) !== true) return;
    await repository.updateBrandTheme(creator.workspaceId, null);
    await repository.recordAudit({
      workspaceId: creator.workspaceId,
      actorId: creator.userId,
      action: "workspace.theme.delete",
      targetType: "workspace",
      targetId: creator.workspaceId,
      requestId: request.id,
    });
    return reply.code(204).send();
  });

  app.post("/v1/auth/logout", async (request, reply) => {
    await auth.logout(request, reply);
    return { ok: true };
  });

  app.get("/v1/account/embed-origins", async (request, reply) => {
    const creator = await auth.requireCreator(request, reply);
    if (!creator) return;
    return { origins: await repository.getEmbedAllowedOrigins(creator.workspaceId) };
  });

  app.put("/v1/account/embed-origins", async (request, reply) => {
    const creator = await auth.requireCreator(request, reply);
    if (!creator) return;
    if (requireWorkspaceRole(creator, ["owner"], reply, request.id) !== true) return;
    const input = EmbedAllowedOriginsSchema.parse(request.body);
    const origins = await repository.updateEmbedAllowedOrigins(creator.workspaceId, input.origins);
    await repository.recordAudit({
      workspaceId: creator.workspaceId,
      actorId: creator.userId,
      action: "workspace.embed_origins.update",
      targetType: "workspace",
      targetId: creator.workspaceId,
      requestId: request.id,
      metadata: { origins },
    });
    return { origins };
  });

  app.get(
    "/v1/embed/policies/:sessionId/:policyKey",
    { config: { rateLimit: { max: 120, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const { sessionId, policyKey } = EmbedPolicyParamsSchema.parse(request.params);
      const policy = await repository.getEmbedPolicyByKey(
        hashToken(policyKey),
        sessionId,
        new Date(),
      );
      if (!policy) {
        return apiError(reply, 404, "NOT_FOUND", "Embed policy not found", request.id);
      }
      reply.header("cache-control", "private, no-store");
      return EmbedPolicySchema.parse({
        sessionId,
        allowedOrigins: policy.allowedOrigins,
        expiresAt: policy.expiresAt.toISOString(),
      });
    },
  );

  app.get("/v1/authoring/status", async (request, reply) => {
    const creator = await auth.requireCreator(request, reply);
    if (!creator) return;
    const entitlements = entitlementsFor(creator.plan, config);
    return {
      status: await authoring.status(creator.workspaceId, entitlements.authoringJobsPerMonth),
    };
  });

  app.get("/v1/authoring/jobs", async (request, reply) => {
    const creator = await auth.requireCreator(request, reply);
    if (!creator) return;
    return { jobs: await authoring.list(creator.workspaceId) };
  });

  app.post(
    "/v1/authoring/jobs",
    {
      bodyLimit: 8_100_000,
      config: { rateLimit: { max: 10, timeWindow: "5 minutes" } },
    },
    async (request, reply) => {
      const creator = await auth.requireCreator(request, reply);
      if (!creator) return;
      if (requireWorkspaceRole(creator, ["owner", "editor"], reply, request.id) !== true) return;
      const input = CreateAuthoringJobSchema.parse(request.body);
      const entitlements = entitlementsFor(creator.plan, config);
      const job = await authoring.create(
        creator,
        input,
        entitlements.authoringJobsPerMonth,
        entitlements.reportRetentionDays,
      );
      await repository.recordAudit({
        workspaceId: creator.workspaceId,
        actorId: creator.userId,
        action: "authoring.job.create",
        targetType: "authoring_job",
        targetId: job.id,
        requestId: request.id,
        metadata: { sourceType: job.sourceType },
      });
      return reply.code(202).send({ job });
    },
  );

  app.get("/v1/authoring/jobs/:id", async (request, reply) => {
    const creator = await auth.requireCreator(request, reply);
    if (!creator) return;
    const { id } = AuthoringJobParamsSchema.parse(request.params);
    return { job: await authoring.get(creator.workspaceId, id) };
  });

  app.post("/v1/authoring/jobs/:id/apply", async (request, reply) => {
    const creator = await auth.requireCreator(request, reply);
    if (!creator) return;
    if (requireWorkspaceRole(creator, ["owner", "editor"], reply, request.id) !== true) return;
    const { id } = AuthoringJobParamsSchema.parse(request.params);
    const input = ApplyAuthoringJobSchema.parse(request.body ?? {});
    const quiz = await authoring.apply(creator, id, input.title);
    await repository.recordAudit({
      workspaceId: creator.workspaceId,
      actorId: creator.userId,
      action: "authoring.job.apply",
      targetType: "quiz",
      targetId: quiz.id,
      requestId: request.id,
      metadata: { authoringJobId: id },
    });
    return reply.code(201).send({ quiz });
  });

  app.get("/v1/folders", async (request, reply) => {
    const creator = await auth.requireCreator(request, reply);
    if (!creator) return;
    return { folders: await repository.listFolders(creator.workspaceId) };
  });

  app.post("/v1/folders", async (request, reply) => {
    const creator = await auth.requireCreator(request, reply);
    if (!creator) return;
    if (requireWorkspaceRole(creator, ["owner", "editor"], reply, request.id) !== true) return;
    const input = CreateFolderSchema.parse(request.body);
    const name = cleanPlainText(input.name, 80);
    if (!name)
      return apiError(reply, 400, "VALIDATION_ERROR", "Folder name is required", request.id);
    const now = new Date();
    const folder = await repository.createFolder({
      id: randomUUID(),
      workspaceId: creator.workspaceId,
      name,
      createdAt: now,
      updatedAt: now,
    });
    await repository.recordAudit({
      workspaceId: creator.workspaceId,
      actorId: creator.userId,
      action: "folder.create",
      targetType: "folder",
      targetId: folder.id,
      requestId: request.id,
    });
    return reply.code(201).send({ folder });
  });

  app.patch("/v1/folders/:id", async (request, reply) => {
    const creator = await auth.requireCreator(request, reply);
    if (!creator) return;
    if (requireWorkspaceRole(creator, ["owner", "editor"], reply, request.id) !== true) return;
    const { id } = IdParamsSchema.parse(request.params);
    const input = UpdateFolderSchema.parse(request.body);
    const name = cleanPlainText(input.name, 80);
    if (!name)
      return apiError(reply, 400, "VALIDATION_ERROR", "Folder name is required", request.id);
    const folder = await repository.renameFolder(creator.workspaceId, id, name);
    if (!folder) return apiError(reply, 404, "NOT_FOUND", "Folder not found", request.id);
    await repository.recordAudit({
      workspaceId: creator.workspaceId,
      actorId: creator.userId,
      action: "folder.rename",
      targetType: "folder",
      targetId: folder.id,
      requestId: request.id,
    });
    return { folder };
  });

  app.delete("/v1/folders/:id", async (request, reply) => {
    const creator = await auth.requireCreator(request, reply);
    if (!creator) return;
    if (requireWorkspaceRole(creator, ["owner", "editor"], reply, request.id) !== true) return;
    const { id } = IdParamsSchema.parse(request.params);
    if (!(await repository.deleteFolder(creator.workspaceId, id))) {
      return apiError(reply, 404, "NOT_FOUND", "Folder not found", request.id);
    }
    await repository.recordAudit({
      workspaceId: creator.workspaceId,
      actorId: creator.userId,
      action: "folder.delete",
      targetType: "folder",
      targetId: id,
      requestId: request.id,
    });
    return reply.code(204).send();
  });

  app.get("/v1/quizzes", async (request, reply) => {
    reply.header("cache-control", "private, no-store").header("pragma", "no-cache");
    const creator = await auth.requireCreator(request, reply);
    if (!creator) return;
    const query = QuizListQuerySchema.parse(request.query);
    const quizzes = await repository.listQuizzes(creator.workspaceId, query.archived === "true");
    return query.summary === "true"
      ? RoundFilterOptionsResponseSchema.parse({ quizzes })
      : { quizzes };
  });

  app.get("/v1/starters", async (request, reply) => {
    const creator = await auth.requireCreator(request, reply);
    if (!creator) return;
    return StartersResponseSchema.parse({ starters: starterSummaries });
  });
  app.get("/v1/starters/:id", async (request, reply) => {
    const creator = await auth.requireCreator(request, reply);
    if (!creator) return;
    const { id } = StarterParamsSchema.parse(request.params);
    return { draft: instantiateStarter(id) };
  });

  app.post("/v1/starters/:id/use", async (request, reply) => {
    const creator = await auth.requireCreator(request, reply);
    if (!creator) return;
    if (requireWorkspaceRole(creator, ["owner", "editor"], reply, request.id) !== true) return;
    const { id } = StarterParamsSchema.parse(request.params);
    const draft = instantiateStarter(id);
    const now = new Date();
    const quiz = await repository.createQuiz({
      id: randomUUID(),
      workspaceId: creator.workspaceId,
      title: draft.title,
      description: draft.description,
      status: "draft",
      draft,
      draftSchemaVersion: 1,
      lastEditedBy: creator.userId,
      currentVersionId: null,
      folderId: null,
      tags: ["starter"],
      createdAt: now,
      updatedAt: now,
    });
    await repository.recordAudit({
      workspaceId: creator.workspaceId,
      actorId: creator.userId,
      action: "starter.use",
      targetType: "quiz",
      targetId: quiz.id,
      requestId: request.id,
      metadata: { starterId: id, starterVersion: 1 },
    });
    return reply.code(201).send({ quiz });
  });

  app.post("/v1/quizzes", async (request, reply) => {
    const creator = await auth.requireCreator(request, reply);
    if (!creator) return;
    if (requireWorkspaceRole(creator, ["owner", "editor"], reply, request.id) !== true) return;
    const input = CreateQuizSchema.parse(request.body);
    const now = new Date();
    const quiz = await repository.createQuiz({
      id: randomUUID(),
      workspaceId: creator.workspaceId,
      title: cleanPlainText(input.title, 160),
      description: cleanPlainText(input.description, 1_000),
      status: "draft",
      draft: {
        title: input.title,
        description: input.description,
        questions: [],
        category: "general",
        experiencePreset: { id: "pops", version: 1 },
      },
      draftSchemaVersion: 1,
      lastEditedBy: creator.userId,
      currentVersionId: null,
      folderId: null,
      tags: [],
      createdAt: now,
      updatedAt: now,
    });
    await repository.recordAudit({
      workspaceId: creator.workspaceId,
      actorId: creator.userId,
      action: "quiz.create",
      targetType: "quiz",
      targetId: quiz.id,
      requestId: request.id,
    });
    return reply.code(201).send({ quiz });
  });

  app.post("/v1/quizzes/import", { bodyLimit: 8_100_000 }, async (request, reply) => {
    const creator = await auth.requireCreator(request, reply);
    if (!creator) return;
    if (requireWorkspaceRole(creator, ["owner", "editor"], reply, request.id) !== true) return;
    if (!entitlementsFor(creator.plan, config).csvExport) {
      return apiError(
        reply,
        402,
        "ENTITLEMENT_LIMIT",
        "Checkpoint-set import is available on the Pro plan",
        request.id,
      );
    }
    const input = CheckpointSetImportRequestSchema.parse(request.body);
    const result =
      input.format === "qti3"
        ? await importQtiPackage(input.data, input.title)
        : importCheckpointSet(input.format, input.data, input.title);
    if (!result.draft) {
      return reply.code(422).send({
        error: {
          code: "IMPORT_VALIDATION_FAILED",
          message: "The checkpoint set could not be imported. Review the validation details.",
          requestId: request.id,
        },
        validation: result.validation,
      });
    }
    // A Pack baseline is immutable evidence, unlike portable destination question media. Never
    // strip its media IDs under an unchanged hash or grant access to another workspace's media.
    const baselineMediaIds = new Set(
      (result.draft.recoveryPackInsertions ?? []).flatMap(({ originalContent, updateBaseline }) =>
        [originalContent, ...(updateBaseline ? [updateBaseline.content] : [])].flatMap((content) =>
          [content.diagnostic, content.recheck, content.delayedProbe].flatMap((question) =>
            question?.mediaId ? [question.mediaId] : [],
          ),
        ),
      ),
    );
    for (const mediaId of baselineMediaIds) {
      const asset = await repository.getMediaAsset(creator.workspaceId, mediaId);
      if (!asset || asset.deletionStartedAt || asset.scanStatus === "rejected") {
        return reply.code(422).send({
          error: {
            code: "IMPORT_VALIDATION_FAILED",
            message:
              "A Recovery Pack baseline references private media unavailable in this workspace. Import into the source workspace or prepare a media-free Pack before exporting.",
            requestId: request.id,
          },
          validation: {
            ...result.validation,
            errors: [
              ...result.validation.errors,
              {
                severity: "error",
                code: "RECOVERY_PACK_MEDIA_UNAVAILABLE",
                field: "recoveryPackInsertions",
                message: "The frozen Pack baseline was not changed or imported.",
              },
            ],
          },
        });
      }
    }
    const now = new Date();
    const quiz = await repository.createQuiz({
      id: randomUUID(),
      workspaceId: creator.workspaceId,
      title: result.draft.title,
      description: result.draft.description,
      status: "draft",
      draft: result.draft,
      draftSchemaVersion: 1,
      lastEditedBy: creator.userId,
      currentVersionId: null,
      folderId: null,
      tags: [],
      createdAt: now,
      updatedAt: now,
    });
    await repository.recordAudit({
      workspaceId: creator.workspaceId,
      actorId: creator.userId,
      action: "quiz.import",
      targetType: "quiz",
      targetId: quiz.id,
      requestId: request.id,
      metadata: {
        format: input.format,
        importedCheckpoints: result.validation.importedCheckpoints,
        warningCount: result.validation.warnings.length,
      },
    });
    return reply.code(201).send({ quiz, validation: result.validation });
  });

  app.get("/v1/quizzes/:id", async (request, reply) => {
    reply.header("cache-control", "private, no-store").header("pragma", "no-cache");
    const creator = await auth.requireCreator(request, reply);
    if (!creator) return;
    const { id } = IdParamsSchema.parse(request.params);
    const quiz = await repository.getQuiz(creator.workspaceId, id);
    if (!quiz) return apiError(reply, 404, "NOT_FOUND", "Quiz not found", request.id);
    const currentVersion = quiz.currentVersionId
      ? await repository.getQuizVersion(creator.workspaceId, quiz.currentVersionId)
      : null;
    reply.header("etag", draftEtag(quiz.draftRevision));
    return { quiz, currentVersion };
  });

  app.get("/v1/quizzes/:id/export.json", async (request, reply) => {
    const creator = await auth.requireCreator(request, reply);
    if (!creator) return;
    const { id } = IdParamsSchema.parse(request.params);
    const quiz = await repository.getQuiz(creator.workspaceId, id);
    if (!quiz) return apiError(reply, 404, "NOT_FOUND", "Checkpoint set not found", request.id);
    if (!entitlementsFor(creator.plan, config).csvExport) {
      return apiError(
        reply,
        402,
        "ENTITLEMENT_LIMIT",
        "Checkpoint-set export is available on the Pro plan",
        request.id,
      );
    }
    return reply
      .header("content-type", "application/json; charset=utf-8")
      .header(
        "content-disposition",
        `attachment; filename="polling-pops-checkpoint-set-${id}.json"`,
      )
      .send(openRoundJson(quiz.draft));
  });

  app.get("/v1/quizzes/:id/export.csv", async (request, reply) => {
    const creator = await auth.requireCreator(request, reply);
    if (!creator) return;
    const { id } = IdParamsSchema.parse(request.params);
    const quiz = await repository.getQuiz(creator.workspaceId, id);
    if (!quiz) return apiError(reply, 404, "NOT_FOUND", "Checkpoint set not found", request.id);
    if (!entitlementsFor(creator.plan, config).csvExport) {
      return apiError(
        reply,
        402,
        "ENTITLEMENT_LIMIT",
        "Checkpoint-set export is available on the Pro plan",
        request.id,
      );
    }
    return reply
      .header("content-type", "text/csv; charset=utf-8")
      .header("content-disposition", `attachment; filename="polling-pops-checkpoint-set-${id}.csv"`)
      .send(checkpointSetCsv(quiz.draft));
  });

  app.get("/v1/quizzes/:id/export.qti.zip", async (request, reply) => {
    const creator = await auth.requireCreator(request, reply);
    if (!creator) return;
    const { id } = IdParamsSchema.parse(request.params);
    const quiz = await repository.getQuiz(creator.workspaceId, id);
    if (!quiz) return apiError(reply, 404, "NOT_FOUND", "Checkpoint set not found", request.id);
    if (!entitlementsFor(creator.plan, config).csvExport) {
      return apiError(
        reply,
        402,
        "ENTITLEMENT_LIMIT",
        "Checkpoint-set export is available on the Pro plan",
        request.id,
      );
    }
    const result = await exportQtiPackage(quiz.draft);
    if (!result.archive) {
      return reply.code(422).send({
        error: {
          code: "EXPORT_VALIDATION_FAILED",
          message: "This checkpoint set cannot be represented by the supported QTI 3 profile.",
          requestId: request.id,
        },
        validation: result.validation,
      });
    }
    return reply
      .header("content-type", "application/zip")
      .header("cache-control", "private, no-store")
      .header("x-openround-export-warnings", String(result.validation.warnings.length))
      .header(
        "content-disposition",
        `attachment; filename="polling-pops-checkpoint-set-${id}.qti.zip"`,
      )
      .send(result.archive);
  });

  app.patch("/v1/quizzes/:id", { bodyLimit: ROUND_DRAFT_BODY_LIMIT }, async (request, reply) => {
    const creator = await auth.requireCreator(request, reply);
    if (!creator) return;
    if (requireWorkspaceRole(creator, ["owner", "editor"], reply, request.id) !== true) return;
    const { id } = IdParamsSchema.parse(request.params);
    const revisioned =
      request.body !== null &&
      typeof request.body === "object" &&
      "expectedDraftRevision" in request.body;
    const input = revisioned
      ? UpdateQuizRequestSchema.parse(request.body)
      : { draft: UpdateQuizSchema.parse(request.body), expectedDraftRevision: undefined };
    const quiz = await repository.updateQuiz(
      creator.workspaceId,
      id,
      input.draft,
      input.expectedDraftRevision,
      creator.userId,
    );
    if (!quiz) return apiError(reply, 404, "NOT_FOUND", "Quiz not found", request.id);
    reply.header("etag", draftEtag(quiz.draftRevision));
    return { quiz };
  });

  app.put(
    "/v1/quizzes/:id/draft",
    { bodyLimit: ROUND_DRAFT_BODY_LIMIT },
    async (request, reply) => {
      const creator = await auth.requireCreator(request, reply);
      if (!creator) return;
      if (requireWorkspaceRole(creator, ["owner", "editor"], reply, request.id) !== true) return;
      const { id } = IdParamsSchema.parse(request.params);
      const input = RoundDraftMutationSchema.parse(request.body);
      const quiz = await repository.updateQuizDraft({
        workspaceId: creator.workspaceId,
        quizId: id,
        draft: input.draft,
        expectedRevision: input.expectedRevision,
        mutationId: input.mutationId,
        editorId: creator.userId,
        schemaVersion: input.schemaVersion,
        draftHash: createHash("sha256").update(JSON.stringify(input.draft)).digest("hex"),
      });
      if (!quiz) return apiError(reply, 404, "NOT_FOUND", "Quiz not found", request.id);
      reply.header("etag", draftEtag(quiz.draftRevision));
      return { quiz };
    },
  );

  app.get("/v1/quizzes/:id/history", async (request, reply) => {
    reply.header("cache-control", "private, no-store").header("pragma", "no-cache");
    const creator = await auth.requireCreator(request, reply);
    if (!creator) return;
    const { id } = IdParamsSchema.parse(request.params);
    const quiz = await repository.getQuiz(creator.workspaceId, id);
    if (!quiz) return apiError(reply, 404, "NOT_FOUND", "Quiz not found", request.id);
    const history = await repository.listQuizDraftHistory(creator.workspaceId, id, 20);
    return {
      history: history.map(({ id: historyId, revision, savedBy, createdAt }) => ({
        id: historyId,
        revision,
        savedBy,
        createdAt,
      })),
    };
  });

  app.post("/v1/quizzes/:id/history/:revision/restore", async (request, reply) => {
    const creator = await auth.requireCreator(request, reply);
    if (!creator) return;
    if (requireWorkspaceRole(creator, ["owner", "editor"], reply, request.id) !== true) return;
    const { id, revision } = RoundHistoryParamsSchema.parse(request.params);
    const input = RestoreRoundDraftHistorySchema.parse(request.body);
    const quiz = await repository.restoreQuizDraftHistory({
      workspaceId: creator.workspaceId,
      quizId: id,
      historyRevision: revision,
      expectedRevision: input.expectedRevision,
      mutationId: input.mutationId,
      editorId: creator.userId,
    });
    if (!quiz) {
      return apiError(reply, 404, "NOT_FOUND", "Round revision not found", request.id);
    }
    await repository.recordAudit({
      workspaceId: creator.workspaceId,
      actorId: creator.userId,
      action: "quiz.restore",
      targetType: "quiz",
      targetId: id,
      requestId: request.id,
      metadata: { restoredRevision: revision, resultingRevision: quiz.draftRevision ?? 0 },
    });
    reply.header("etag", draftEtag(quiz.draftRevision));
    return { quiz };
  });

  app.patch("/v1/quizzes/:id/organization", async (request, reply) => {
    const creator = await auth.requireCreator(request, reply);
    if (!creator) return;
    if (requireWorkspaceRole(creator, ["owner", "editor"], reply, request.id) !== true) return;
    const { id } = IdParamsSchema.parse(request.params);
    const input = OrganizeQuizSchema.parse(request.body);
    const tags = input.tags.map((tag) => cleanPlainText(tag, 40));
    if (tags.some((tag) => !tag)) {
      return apiError(reply, 400, "VALIDATION_ERROR", "Tags cannot be empty", request.id);
    }
    const quiz = await repository.organizeQuiz(creator.workspaceId, id, input.folderId, tags);
    if (!quiz) {
      return apiError(
        reply,
        404,
        "NOT_FOUND",
        "Checkpoint set or selected folder not found",
        request.id,
      );
    }
    await repository.recordAudit({
      workspaceId: creator.workspaceId,
      actorId: creator.userId,
      action: "quiz.organize",
      targetType: "quiz",
      targetId: quiz.id,
      requestId: request.id,
      metadata: { folderId: quiz.folderId ?? null, tags: quiz.tags ?? [] },
    });
    return { quiz };
  });

  app.post("/v1/quizzes/:id/publish", async (request, reply) => {
    const creator = await auth.requireCreator(request, reply);
    if (!creator) return;
    if (requireWorkspaceRole(creator, ["owner", "editor"], reply, request.id) !== true) return;
    const { id } = IdParamsSchema.parse(request.params);
    const revisioned =
      request.body !== null &&
      typeof request.body === "object" &&
      "expectedDraftRevision" in request.body;
    const input = revisioned ? PublishQuizRequestSchema.parse(request.body) : null;
    const quiz = await repository.getQuiz(creator.workspaceId, id);
    if (!quiz) return apiError(reply, 404, "NOT_FOUND", "Quiz not found", request.id);
    const expectedDraftRevision = input?.expectedDraftRevision ?? quiz.draftRevision ?? 0;
    if (expectedDraftRevision !== (quiz.draftRevision ?? 0)) {
      throw new QuizDraftRevisionConflictError(
        quiz.id,
        expectedDraftRevision,
        quiz.draftRevision ?? 0,
        quiz.lastEditedBy ?? null,
      );
    }
    const parsedContent = QuizContentSchema.safeParse(quiz.draft);
    const validationIssues = parsedContent.success
      ? []
      : parsedContent.error.issues.map((issue) =>
          roundPublishIssue(quiz.id, quiz.draft, issue.path, issue.message),
        );
    const mediaReferences = quiz.draft.questions.flatMap((question, questionIndex) =>
      question.mediaId
        ? [
            {
              mediaId: question.mediaId,
              path: ["questions", questionIndex, "mediaId"] as const,
            },
          ]
        : [],
    );
    const mediaStatuses = await Promise.all(
      mediaReferences.map(async (reference) => ({
        ...reference,
        media: await repository.getMediaAsset(creator.workspaceId, reference.mediaId),
      })),
    );
    for (const reference of mediaStatuses) {
      if (reference.media?.scanStatus === "clean") continue;
      validationIssues.push(
        roundPublishIssue(
          quiz.id,
          quiz.draft,
          reference.path,
          reference.media
            ? "This image must finish security scanning before publishing"
            : "This image is unavailable or does not belong to this workspace",
        ),
      );
    }
    if (!parsedContent.success || validationIssues.length > 0) {
      return roundPublishValidationError(reply, request.id, validationIssues);
    }
    const entitlements = entitlementsFor(creator.plan, config);
    const current = quiz.currentVersionId
      ? await repository.getQuizVersion(creator.workspaceId, quiz.currentVersionId)
      : null;
    const content = parsedContent.data;
    const contentHash = createHash("sha256").update(JSON.stringify(content)).digest("hex");
    const version = await repository.publishQuiz(
      {
        id: randomUUID(),
        workspaceId: creator.workspaceId,
        quizId: quiz.id,
        version: (current?.version ?? 0) + 1,
        content,
        contentHash,
        sourceDraftRevision: expectedDraftRevision,
        publishedAt: new Date(),
      },
      entitlements.maxPublishedQuizzes,
      expectedDraftRevision,
    );
    await repository.recordAudit({
      workspaceId: creator.workspaceId,
      actorId: creator.userId,
      action: "quiz.publish",
      targetType: "quiz_version",
      targetId: version.id,
      requestId: request.id,
      metadata: { version: version.version, contentHash, draftRevision: expectedDraftRevision },
    });
    if (uxBetaWorkspaceEnabled(creator.workspaceId)) {
      productEvents.enqueue({
        workspaceId: creator.workspaceId,
        segment: creator.segment,
        events: [{ name: "round_published", dimensions: { artifactType: "round" } }],
      });
    }
    reply.header("etag", draftEtag(expectedDraftRevision));
    return { version };
  });

  app.post("/v1/quizzes/:id/duplicate", async (request, reply) => {
    const creator = await auth.requireCreator(request, reply);
    if (!creator) return;
    if (requireWorkspaceRole(creator, ["owner", "editor"], reply, request.id) !== true) return;
    const { id } = IdParamsSchema.parse(request.params);
    const source = await repository.getQuiz(creator.workspaceId, id);
    if (!source) return apiError(reply, 404, "NOT_FOUND", "Quiz not found", request.id);
    const now = new Date();
    const title = `${source.title} copy`.slice(0, 160);
    const quiz = await repository.duplicateQuiz({
      ...source,
      id: randomUUID(),
      title,
      status: "draft",
      currentVersionId: null,
      draftRevision: 0,
      draftSchemaVersion: 1,
      publishedDraftRevision: null,
      lastEditedBy: creator.userId,
      draft: { ...source.draft, title },
      createdAt: now,
      updatedAt: now,
    });
    return reply.code(201).send({ quiz });
  });

  app.post("/v1/quizzes/:id/archive", async (request, reply) => {
    const creator = await auth.requireCreator(request, reply);
    if (!creator) return;
    if (requireWorkspaceRole(creator, ["owner", "editor"], reply, request.id) !== true) return;
    const { id } = IdParamsSchema.parse(request.params);
    const { archived } = z.object({ archived: z.boolean().default(true) }).parse(request.body);
    const quiz = await repository.archiveQuiz(
      creator.workspaceId,
      id,
      archived,
      entitlementsFor(creator.plan, config).maxPublishedQuizzes,
    );
    return quiz ? { quiz } : apiError(reply, 404, "NOT_FOUND", "Quiz not found", request.id);
  });

  app.get("/v1/sessions", async (request, reply) => {
    const creator = await auth.requireCreator(request, reply);
    if (!creator) return;
    const query = SessionHistoryQuerySchema.parse(request.query);
    const page = await repository.listSessionHistory(creator.workspaceId, {
      limit: query.limit,
      ...(query.cursor
        ? {
            cursor: {
              createdAt: new Date(query.cursor.createdAt),
              cursorCreatedAt: query.cursor.createdAt,
              id: query.cursor.id,
            },
          }
        : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.quizId ? { quizId: query.quizId } : {}),
      ...(query.from ? { from: new Date(query.from) } : {}),
      ...(query.to ? { to: new Date(query.to) } : {}),
      now: new Date(),
    });
    const last = page.items.at(-1);
    return SessionSummaryPageSchema.parse({
      items: page.items.map((item) => ({
        ...item,
        createdAt: item.createdAt.toISOString(),
        updatedAt: item.updatedAt.toISOString(),
        expiresAt: item.expiresAt.toISOString(),
      })),
      nextCursor: page.hasMore && last ? historyCursor(last) : null,
    });
  });

  app.post("/v1/sessions", async (request, reply) => {
    const creator = await auth.requireCreator(request, reply);
    if (!creator) return;
    if (requireWorkspaceRole(creator, ["owner", "editor"], reply, request.id) !== true) return;
    if (!(await operationalFeatures()).effective.sessionCreation) {
      return apiError(
        reply,
        503,
        "DEPENDENCY_UNAVAILABLE",
        "New live sessions are temporarily paused",
        request.id,
      );
    }
    const input = CreateSessionSchema.parse(request.body);
    const { roundExperiences: experiencesAvailable } = await workspaceProductFeatures(
      creator.workspaceId,
    );
    const session = await sessions.createSession(creator, input.quizId, input.settings, {
      experiencePresetOverride: experiencesAvailable ? input.experiencePresetOverride : "focus",
      presenterSoundEnabled: experiencesAvailable && input.presenterSoundEnabled,
    });
    return reply.code(201).send(session);
  });

  app.post(
    "/v1/sessions/:id/control-pass",
    { config: { rateLimit: { max: 5, timeWindow: "5 minutes" } } },
    async (request, reply) => {
      const creator = await auth.requireCreator(request, reply);
      if (!creator) return;
      if (requireWorkspaceRole(creator, ["owner", "editor"], reply, request.id) !== true) return;
      const { id } = IdParamsSchema.parse(request.params);
      const created = await sessions.createCreatorControlPass(creator, id);
      await repository.recordAudit({
        workspaceId: creator.workspaceId,
        actorId: creator.userId,
        action: "session.creator_resume.create",
        targetType: "session_staff_credential",
        targetId: created.credential.id,
        requestId: request.id,
        metadata: { sessionId: id, expiresAt: created.credential.expiresAt },
      });
      return reply
        .header("cache-control", "private, no-store")
        .code(201)
        .send(CreatorControlPassResponseSchema.parse(created));
    },
  );

  app.post("/v1/sessions/:id/staff", async (request, reply) => {
    const creator = await auth.requireCreator(request, reply);
    if (!creator) return;
    if (requireWorkspaceRole(creator, ["owner", "editor"], reply, request.id) !== true) return;
    const { id } = IdParamsSchema.parse(request.params);
    const input = CreateSessionStaffCredentialSchema.parse(request.body);
    const created = await sessions.createSessionStaffCredential(creator, id, input);
    await repository.recordAudit({
      workspaceId: creator.workspaceId,
      actorId: creator.userId,
      action: "session.staff.create",
      targetType: "session_staff_credential",
      targetId: created.credential.id,
      requestId: request.id,
      metadata: { sessionId: id, role: created.credential.role },
    });
    return reply.code(201).send(created);
  });

  app.get("/v1/sessions/:id/staff", async (request, reply) => {
    const creator = await auth.requireCreator(request, reply);
    if (!creator) return;
    if (requireWorkspaceRole(creator, ["owner", "editor"], reply, request.id) !== true) return;
    const { id } = IdParamsSchema.parse(request.params);
    const session = await repository.getSessionById(id);
    if (!session || session.workspaceId !== creator.workspaceId) {
      return apiError(reply, 404, "NOT_FOUND", "Session not found", request.id);
    }
    const credentials = await repository.listSessionStaff(creator.workspaceId, id);
    return {
      credentials: credentials.map((credential) => ({
        id: credential.id,
        sessionId: credential.sessionId,
        role: credential.role,
        purpose: credential.purpose,
        label: credential.label,
        expiresAt: credential.expiresAt.toISOString(),
        revokedAt: credential.revokedAt?.toISOString() ?? null,
        createdAt: credential.createdAt.toISOString(),
      })),
    };
  });

  app.delete("/v1/sessions/:id/staff/:credentialId", async (request, reply) => {
    const creator = await auth.requireCreator(request, reply);
    if (!creator) return;
    if (requireWorkspaceRole(creator, ["owner", "editor"], reply, request.id) !== true) return;
    const { id, credentialId } = SessionStaffParamsSchema.parse(request.params);
    const session = await repository.getSessionById(id);
    if (!session || session.workspaceId !== creator.workspaceId) {
      return apiError(reply, 404, "NOT_FOUND", "Session not found", request.id);
    }
    const revoked = await repository.revokeSessionStaff(creator.workspaceId, id, credentialId);
    if (!revoked) {
      return apiError(reply, 404, "NOT_FOUND", "Staff credential not found", request.id);
    }
    await repository.recordAudit({
      workspaceId: creator.workspaceId,
      actorId: creator.userId,
      action: "session.staff.revoke",
      targetType: "session_staff_credential",
      targetId: credentialId,
      requestId: request.id,
      metadata: { sessionId: id },
    });
    await sessions
      .publishAuxiliary({
        sessionId: id,
        type: "session.staff.revoked",
        payload: { credentialId },
      })
      .catch((error: unknown) => {
        request.log.warn({ err: error, credentialId }, "staff socket disconnect broadcast failed");
      });
    return reply.code(204).send();
  });

  app.get(
    "/v1/sessions/join/preflight",
    { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } },
    async (request, reply) => {
      reply.header("cache-control", "no-store");
      const input = JoinPreflightRequestSchema.parse(request.query);
      return JoinPreflightResponseSchema.parse(await sessions.preflightJoin(input));
    },
  );

  app.post(
    "/v1/sessions/join",
    { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const input = JoinRequestSchema.parse(request.body);
      return reply.code(201).send(await sessions.join(input));
    },
  );

  app.get("/v1/sessions/:id/snapshot", async (request) => {
    const { id } = IdParamsSchema.parse(request.params);
    const { role } = z
      .object({ role: z.enum(["host", "participant", "presenter"]).default("participant") })
      .parse(request.query);
    const bearer = request.headers.authorization?.replace(/^Bearer\s+/i, "");
    return {
      snapshot: await sessions.snapshot({
        sessionId: id,
        role,
        ...(role === "participant" ? { participantToken: bearer } : { hostToken: bearer }),
      }),
    };
  });

  app.post("/v1/sessions/:id/commands", async (request) => {
    const { id } = IdParamsSchema.parse(request.params);
    const hostToken = request.headers.authorization?.replace(/^Bearer\s+/i, "") ?? "";
    const command = HostCommandSchema.parse({
      ...(request.body as Record<string, unknown>),
      sessionId: id,
      hostToken,
    });
    return { snapshot: await sessions.hostCommand(command) };
  });

  app.post("/v1/sessions/:id/answers", async (request) => {
    const { id } = IdParamsSchema.parse(request.params);
    const participantToken = request.headers.authorization?.replace(/^Bearer\s+/i, "") ?? "";
    const input = AnswerSubmitSchema.parse({
      ...(request.body as Record<string, unknown>),
      sessionId: id,
      participantToken,
    });
    return sessions.answer(input);
  });

  app.get("/v1/sessions/:id/qna/questions", async (request) => {
    const { id } = IdParamsSchema.parse(request.params);
    const query = QnaListQuerySchema.parse(request.query);
    const token = request.headers.authorization?.replace(/^Bearer\s+/i, "") ?? "";
    return qna.list(id, token, query);
  });

  app.post(
    "/v1/sessions/:id/qna/questions",
    { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const { id } = IdParamsSchema.parse(request.params);
      const input = CreateQnaQuestionSchema.parse(request.body);
      const token = request.headers.authorization?.replace(/^Bearer\s+/i, "") ?? "";
      return reply.code(201).send(await qna.createQuestion(id, token, input.body));
    },
  );

  app.post(
    "/v1/sessions/:id/qna/questions/:questionId/replies",
    { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const { id, questionId } = QnaQuestionParamsSchema.parse(request.params);
      const input = CreateQnaReplySchema.parse(request.body);
      const token = request.headers.authorization?.replace(/^Bearer\s+/i, "") ?? "";
      return reply.code(201).send(await qna.createReply(id, questionId, token, input.body));
    },
  );

  app.post("/v1/sessions/:id/qna/questions/:questionId/vote", async (request) => {
    const { id, questionId } = QnaQuestionParamsSchema.parse(request.params);
    const token = request.headers.authorization?.replace(/^Bearer\s+/i, "") ?? "";
    return qna.setVote(id, questionId, token, true);
  });

  app.delete("/v1/sessions/:id/qna/questions/:questionId/vote", async (request) => {
    const { id, questionId } = QnaQuestionParamsSchema.parse(request.params);
    const token = request.headers.authorization?.replace(/^Bearer\s+/i, "") ?? "";
    return qna.setVote(id, questionId, token, false);
  });

  app.patch("/v1/sessions/:id/qna/settings", async (request) => {
    const { id } = IdParamsSchema.parse(request.params);
    const input = UpdateQnaSettingsSchema.parse(request.body);
    const token = request.headers.authorization?.replace(/^Bearer\s+/i, "") ?? "";
    const settings = await qna.updateSettings(id, token, input, request.id);
    return QnaSettingsSchema.parse(settings);
  });

  app.patch("/v1/sessions/:id/qna/questions/:questionId", async (request) => {
    const { id, questionId } = QnaQuestionParamsSchema.parse(request.params);
    const input = ModerateQnaQuestionSchema.parse(request.body);
    const token = request.headers.authorization?.replace(/^Bearer\s+/i, "") ?? "";
    return qna.moderateQuestion(id, questionId, token, input, request.id);
  });

  app.patch("/v1/sessions/:id/qna/replies/:replyId", async (request) => {
    const { id, replyId } = QnaReplyParamsSchema.parse(request.params);
    const input = ModerateQnaReplySchema.parse(request.body);
    const token = request.headers.authorization?.replace(/^Bearer\s+/i, "") ?? "";
    return qna.moderateReply(id, replyId, token, input.status, request.id);
  });

  app.get("/v1/sessions/:id/interactions/settings", async (request) => {
    const { id } = IdParamsSchema.parse(request.params);
    const token = request.headers.authorization?.replace(/^Bearer\s+/i, "") ?? "";
    return interactions.getSettings(id, token);
  });

  app.patch("/v1/sessions/:id/interactions/settings", async (request) => {
    const { id } = IdParamsSchema.parse(request.params);
    const input = UpdateInteractionSettingsSchema.parse(request.body);
    const token = request.headers.authorization?.replace(/^Bearer\s+/i, "") ?? "";
    return interactions.updateSettings(
      id,
      token,
      input,
      requestIdempotencyKey(request),
      request.id,
    );
  });

  app.get("/v1/sessions/:id/interactions/summary", async (request) => {
    const { id } = IdParamsSchema.parse(request.params);
    const token = request.headers.authorization?.replace(/^Bearer\s+/i, "") ?? "";
    return interactions.summary(id, token);
  });

  app.get("/v1/sessions/:id/interactions/sync", async (request) => {
    const { id } = IdParamsSchema.parse(request.params);
    const query = ChatListQuerySchema.pick({ limit: true }).parse(request.query);
    const token = request.headers.authorization?.replace(/^Bearer\s+/i, "") ?? "";
    return interactions.sync(id, token, query.limit);
  });

  app.put(
    "/v1/sessions/:id/signals/current",
    { config: { rateLimit: { max: 40, timeWindow: "1 minute" } } },
    async (request) => {
      const { id } = IdParamsSchema.parse(request.params);
      const input = SetAudienceSignalSchema.parse(request.body);
      const token = request.headers.authorization?.replace(/^Bearer\s+/i, "") ?? "";
      return interactions.setSignal(id, token, input.signal, input.idempotencyKey);
    },
  );

  app.get("/v1/sessions/:id/chat/messages", async (request) => {
    const { id } = IdParamsSchema.parse(request.params);
    const query = ChatListQuerySchema.parse(request.query);
    const token = request.headers.authorization?.replace(/^Bearer\s+/i, "") ?? "";
    return interactions.listChat(id, token, query);
  });

  app.post(
    "/v1/sessions/:id/chat/messages",
    { config: { rateLimit: { max: 40, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const { id } = IdParamsSchema.parse(request.params);
      const input = CreateChatMessageSchema.parse(request.body);
      const token = request.headers.authorization?.replace(/^Bearer\s+/i, "") ?? "";
      return reply.code(201).send(await interactions.createChatMessage(id, token, input));
    },
  );

  app.patch("/v1/sessions/:id/chat/messages/:messageId", async (request) => {
    const { id, messageId } = ChatMessageParamsSchema.parse(request.params);
    const input = ModerateChatMessageSchema.parse(request.body);
    const token = request.headers.authorization?.replace(/^Bearer\s+/i, "") ?? "";
    return interactions.moderateMessage(
      id,
      messageId,
      token,
      input,
      requestIdempotencyKey(request),
      request.id,
    );
  });

  app.put("/v1/sessions/:id/chat/messages/:messageId/reaction", async (request) => {
    const { id, messageId } = ChatMessageParamsSchema.parse(request.params);
    const input = SetChatReactionSchema.parse(request.body);
    const token = request.headers.authorization?.replace(/^Bearer\s+/i, "") ?? "";
    return interactions.setReaction(
      id,
      messageId,
      token,
      input.reaction,
      requestIdempotencyKey(request),
    );
  });

  app.delete("/v1/sessions/:id/chat/messages/:messageId/reaction", async (request) => {
    const { id, messageId } = ChatMessageParamsSchema.parse(request.params);
    const token = request.headers.authorization?.replace(/^Bearer\s+/i, "") ?? "";
    return interactions.setReaction(id, messageId, token, null, requestIdempotencyKey(request));
  });

  app.post("/v1/sessions/:id/chat/messages/:messageId/report", async (request) => {
    const { id, messageId } = ChatMessageParamsSchema.parse(request.params);
    const token = request.headers.authorization?.replace(/^Bearer\s+/i, "") ?? "";
    return interactions.reportMessage(id, messageId, token, requestIdempotencyKey(request));
  });

  app.patch("/v1/sessions/:id/interactions/participants/:participantId", async (request) => {
    const { id, participantId } = AudienceParticipantParamsSchema.parse(request.params);
    const input = ModerateAudienceParticipantSchema.parse(request.body);
    const token = request.headers.authorization?.replace(/^Bearer\s+/i, "") ?? "";
    return interactions.moderateParticipant(
      id,
      participantId,
      token,
      input,
      requestIdempotencyKey(request),
      request.id,
    );
  });

  app.delete("/v1/sessions/:id", async (request, reply) => {
    const creator = await auth.requireCreator(request, reply);
    if (!creator) return;
    if (requireWorkspaceRole(creator, ["owner"], reply, request.id) !== true) return;
    const { id } = IdParamsSchema.parse(request.params);
    const deleted = await sessions.deleteSession(creator.workspaceId, id);
    if (!deleted) return apiError(reply, 404, "NOT_FOUND", "Session not found", request.id);
    await repository.recordAudit({
      workspaceId: creator.workspaceId,
      actorId: creator.userId,
      action: "session.delete",
      targetType: "game_session",
      targetId: id,
      requestId: request.id,
    });
    return reply.code(204).send();
  });

  app.get("/v1/sessions/:id/report", async (request, reply) => {
    const creator = await auth.requireCreator(request, reply);
    if (!creator) return;
    const { id } = IdParamsSchema.parse(request.params);
    const report = await repository.getReportBySession(creator.workspaceId, id);
    return report
      ? {
          report,
          context: await reportContext(report),
          entitlements: entitlementsFor(creator.plan, config),
        }
      : apiError(reply, 404, "NOT_FOUND", "Report not found", request.id);
  });

  app.get("/v1/reports", async (request, reply) => {
    const creator = await auth.requireCreator(request, reply);
    if (!creator) return;
    const query = ReportHistoryQuerySchema.parse(request.query);
    const page = await repository.listReportHistory(creator.workspaceId, {
      limit: query.limit,
      ...(query.cursor
        ? {
            cursor: {
              createdAt: new Date(query.cursor.createdAt),
              cursorCreatedAt: query.cursor.createdAt,
              id: query.cursor.id,
            },
          }
        : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.quizId ? { quizId: query.quizId } : {}),
      ...(query.from ? { from: new Date(query.from) } : {}),
      ...(query.to ? { to: new Date(query.to) } : {}),
      now: new Date(),
    });
    const last = page.items.at(-1);
    return ReportSummaryPageSchema.parse({
      items: page.items.map((item) => ({
        ...item,
        generatedAt: item.generatedAt?.toISOString() ?? null,
        createdAt: item.createdAt.toISOString(),
        expiresAt: item.expiresAt.toISOString(),
      })),
      nextCursor: page.hasMore && last ? historyCursor(last) : null,
    });
  });

  app.get("/v1/reports/:id", async (request, reply) => {
    const creator = await auth.requireCreator(request, reply);
    if (!creator) return;
    const { id } = IdParamsSchema.parse(request.params);
    const report = await repository.getReport(creator.workspaceId, id);
    if (!report) return apiError(reply, 404, "NOT_FOUND", "Report not found", request.id);
    if (report.status === "ready" && uxBetaWorkspaceEnabled(creator.workspaceId)) {
      productEvents.enqueue({
        workspaceId: creator.workspaceId,
        segment: creator.segment,
        events: [{ name: "report_viewed" }],
      });
    }
    return {
      report,
      context: await reportContext(report),
      entitlements: entitlementsFor(creator.plan, config),
      followup: await followups.getForReport(creator.workspaceId, id),
    };
  });

  app.get("/v1/reports/:id/interactions", async (request, reply) => {
    const creator = await auth.requireCreator(request, reply);
    if (!creator) return;
    const { id } = IdParamsSchema.parse(request.params);
    const query = InteractionTranscriptQuerySchema.parse(request.query);
    if (
      query.audit === "true" &&
      requireWorkspaceRole(creator, ["owner", "editor"], reply, request.id) !== true
    ) {
      return;
    }
    const transcript = await interactionTranscript(creator, id, query.audit === "true");
    return transcript
      ? { transcript }
      : apiError(reply, 404, "NOT_FOUND", "Interaction transcript not found", request.id);
  });

  app.get("/v1/reports/:id/interactions.csv", async (request, reply) => {
    const creator = await auth.requireCreator(request, reply);
    if (!creator) return;
    const { id } = IdParamsSchema.parse(request.params);
    const query = InteractionTranscriptQuerySchema.parse(request.query);
    if (!entitlementsFor(creator.plan, config).csvExport) {
      return apiError(
        reply,
        402,
        "ENTITLEMENT_LIMIT",
        "Interaction transcript export is available on the Pro plan",
        request.id,
      );
    }
    if (
      query.audit === "true" &&
      requireWorkspaceRole(creator, ["owner", "editor"], reply, request.id) !== true
    ) {
      return;
    }
    const transcript = await interactionTranscript(creator, id, query.audit === "true");
    if (!transcript) {
      return apiError(reply, 404, "NOT_FOUND", "Interaction transcript not found", request.id);
    }
    return reply
      .header("content-type", "text/csv; charset=utf-8")
      .header("content-disposition", `attachment; filename="polling-pops-interactions-${id}.csv"`)
      .send(transcriptCsv(transcript));
  });

  app.get("/v1/reports/:id.csv", async (request, reply) => {
    const creator = await auth.requireCreator(request, reply);
    if (!creator) return;
    const { id } = IdParamsSchema.parse(request.params);
    const report = await repository.getReport(creator.workspaceId, id);
    if (!report) return apiError(reply, 404, "NOT_FOUND", "Report not found", request.id);
    if (report.status !== "ready") {
      return apiError(
        reply,
        409,
        "CONFLICT",
        report.status === "pending"
          ? "The report is still being generated; try again shortly"
          : "Report generation failed; contact support with this report ID",
        request.id,
      );
    }
    if (!entitlementsFor(creator.plan, config).csvExport) {
      return apiError(
        reply,
        402,
        "ENTITLEMENT_LIMIT",
        "CSV export is available on the Pro plan",
        request.id,
      );
    }
    return reply
      .header("content-type", "text/csv; charset=utf-8")
      .header("content-disposition", `attachment; filename="polling-pops-report-${id}.csv"`)
      .send(reportCsv(report));
  });

  app.get("/v1/reports/:id.json", async (request, reply) => {
    const creator = await auth.requireCreator(request, reply);
    if (!creator) return;
    const { id } = IdParamsSchema.parse(request.params);
    const report = await repository.getReport(creator.workspaceId, id);
    if (!report) return apiError(reply, 404, "NOT_FOUND", "Report not found", request.id);
    if (report.status !== "ready") {
      return apiError(
        reply,
        409,
        "CONFLICT",
        report.status === "pending"
          ? "The report is still being generated; try again shortly"
          : "Report generation failed; contact support with this report ID",
        request.id,
      );
    }
    if (!entitlementsFor(creator.plan, config).csvExport) {
      return apiError(
        reply,
        402,
        "ENTITLEMENT_LIMIT",
        "Report exports are available on the Pro plan",
        request.id,
      );
    }
    return reply
      .header("content-type", "application/json; charset=utf-8")
      .header("content-disposition", `attachment; filename="polling-pops-report-${id}.json"`)
      .send(JSON.stringify(report, null, 2));
  });

  app.post("/v1/quizzes/:id/practice-assignments", async (request, reply) => {
    const creator = await auth.requireCreator(request, reply);
    if (!creator) return;
    if (requireWorkspaceRole(creator, ["owner", "editor"], reply, request.id) !== true) return;
    if (!practiceAssignmentsWorkspaceEnabled(creator.workspaceId)) {
      return apiError(
        reply,
        404,
        "NOT_FOUND",
        "Practice assignments are not available",
        request.id,
      );
    }
    const entitlements = entitlementsFor(creator.plan, config);
    if (!entitlements.followups) {
      return apiError(
        reply,
        402,
        "ENTITLEMENT_LIMIT",
        "Practice assignments are available on the Pro plan",
        request.id,
      );
    }
    const { id } = IdParamsSchema.parse(request.params);
    const input = CreatePracticeAssignmentSchema.parse(request.body);
    const created = await followups.createAssignment(
      creator,
      id,
      input,
      entitlements.reportRetentionDays,
      entitlements.maxPracticePersonalLinks,
    );
    const link = (token: string) =>
      `${config.WEB_ORIGIN}/followup/${created.followup.id}#token=${encodeURIComponent(token)}`;
    await repository.recordAudit({
      workspaceId: creator.workspaceId,
      actorId: creator.userId,
      action: "practice_assignment.create",
      targetType: "practice_assignment",
      targetId: created.followup.id,
      requestId: request.id,
      metadata: {
        sourceQuizId: id,
        sourceQuizVersionId: created.followup.sourceQuizVersionId,
        personalPasses: created.personalAccess.length,
        timeMode: created.followup.timeMode,
      },
    });
    productEvents.enqueue({
      workspaceId: creator.workspaceId,
      segment: creator.segment,
      events: [{ name: "practice_assignment_created" }],
    });
    return reply
      .header("cache-control", "private, no-store")
      .header("pragma", "no-cache")
      .code(201)
      .send({
        followup: created.followup,
        genericUrl: link(created.genericToken),
        personalAccess: created.personalAccess.map((access) => ({
          ...access,
          url: link(access.token),
        })),
      });
  });

  app.post("/v1/reports/:id/followups", async (request, reply) => {
    const creator = await auth.requireCreator(request, reply);
    if (!creator) return;
    if (requireWorkspaceRole(creator, ["owner", "editor"], reply, request.id) !== true) return;
    if (!entitlementsFor(creator.plan, config).followups) {
      return apiError(
        reply,
        402,
        "ENTITLEMENT_LIMIT",
        "Self-paced follow-up is available on the Pro plan",
        request.id,
      );
    }
    const { id } = IdParamsSchema.parse(request.params);
    const input = CreateFollowupSchema.parse(request.body);
    const created = await followups.create(creator, id, input);
    const link = (token: string) =>
      `${config.WEB_ORIGIN}/followup/${created.followup.id}#token=${encodeURIComponent(token)}`;
    await repository.recordAudit({
      workspaceId: creator.workspaceId,
      actorId: creator.userId,
      action: "followup.create",
      targetType: "followup",
      targetId: created.followup.id,
      requestId: request.id,
      metadata: {
        sourceReportId: id,
        conceptKeys: created.followup.conceptKeys,
        participantPasses: created.personalAccess.length,
        timeMode: created.followup.timeMode,
      },
    });
    return reply
      .header("cache-control", "private, no-store")
      .header("pragma", "no-cache")
      .code(201)
      .send({
        followup: created.followup,
        genericUrl: link(created.genericToken),
        personalAccess: created.personalAccess.map((access) => ({
          ...access,
          url: link(access.token!),
        })),
      });
  });

  app.get("/v1/followups", async (request, reply) => {
    const creator = await auth.requireCreator(request, reply);
    if (!creator) return;
    const query = FollowupHistoryQuerySchema.parse(request.query);
    const page = await repository.listFollowupHistory(creator.workspaceId, {
      limit: query.limit,
      ...(query.cursor
        ? {
            cursor: {
              createdAt: new Date(query.cursor.createdAt),
              cursorCreatedAt: query.cursor.createdAt,
              id: query.cursor.id,
            },
          }
        : {}),
      ...(query.purpose ? { purpose: query.purpose } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.quizId ? { quizId: query.quizId } : {}),
      ...(query.from ? { from: new Date(query.from) } : {}),
      ...(query.to ? { to: new Date(query.to) } : {}),
      now: new Date(),
    });
    const last = page.items.at(-1);
    return FollowupSummaryPageSchema.parse({
      items: page.items.map((item) => ({
        ...item,
        opensAt: item.opensAt.toISOString(),
        closesAt: item.closesAt.toISOString(),
        expiresAt: item.expiresAt.toISOString(),
        createdAt: item.createdAt.toISOString(),
      })),
      nextCursor: page.hasMore && last ? historyCursor(last) : null,
    });
  });

  app.get("/v1/followups/:id", async (request, reply) => {
    const creator = await auth.requireCreator(request, reply);
    if (!creator) return;
    const { id } = FollowupParamsSchema.parse(request.params);
    const detail = await followups.getForCreator(creator.workspaceId, id);
    return reply
      .header("cache-control", "private, no-store")
      .header("pragma", "no-cache")
      .send(detail);
  });

  app.post("/v1/followups/:id/personal-passes", async (request, reply) => {
    const creator = await auth.requireCreator(request, reply);
    if (!creator) return;
    if (requireWorkspaceRole(creator, ["owner", "editor"], reply, request.id) !== true) return;
    if (!practiceAssignmentsWorkspaceEnabled(creator.workspaceId)) {
      return apiError(
        reply,
        404,
        "NOT_FOUND",
        "Practice assignments are not available",
        request.id,
      );
    }
    const entitlements = entitlementsFor(creator.plan, config);
    if (!entitlements.followups) {
      return apiError(
        reply,
        402,
        "ENTITLEMENT_LIMIT",
        "Practice assignments are available on the Pro plan",
        request.id,
      );
    }
    const { id } = FollowupParamsSchema.parse(request.params);
    const source = await repository.getFollowup(creator.workspaceId, id);
    if (
      source?.recoveryPackSource &&
      !evidenceWorkspaceFeatureEnabled(config, creator.workspaceId, "recoveryPacks")
    ) {
      return apiError(
        reply,
        404,
        "NOT_FOUND",
        "Recovery Pack practice is not available in this workspace",
        request.id,
      );
    }
    const input = CreateAssignmentPersonalPassSchema.parse(request.body);
    const created = await followups.createAssignmentPersonalPass(
      creator,
      id,
      input.label,
      entitlements.maxPracticePersonalLinks,
    );
    const url = `${config.WEB_ORIGIN}/followup/${id}#token=${encodeURIComponent(created.access.token!)}`;
    await repository.recordAudit({
      workspaceId: creator.workspaceId,
      actorId: creator.userId,
      action: "practice_assignment.personal_pass.create",
      targetType: "followup_access_token",
      targetId: created.access.id,
      requestId: request.id,
      metadata: { followupId: id },
    });
    return reply
      .header("cache-control", "private, no-store")
      .header("pragma", "no-cache")
      .code(201)
      .send({ access: { ...created.access, url } });
  });

  app.post("/v1/followups/:id/accommodation-passes", async (request, reply) => {
    const creator = await auth.requireCreator(request, reply);
    if (!creator) return;
    if (requireWorkspaceRole(creator, ["owner", "editor"], reply, request.id) !== true) return;
    const { id } = FollowupParamsSchema.parse(request.params);
    const input = CreateAccommodationPassSchema.parse(request.body);
    const created = await followups.createAccommodation(creator, id, input);
    const url = `${config.WEB_ORIGIN}/followup/${id}#token=${encodeURIComponent(created.access.token!)}`;
    await repository.recordAudit({
      workspaceId: creator.workspaceId,
      actorId: creator.userId,
      action: "followup.accommodation_pass.create",
      targetType: "followup_access_token",
      targetId: created.access.id,
      requestId: request.id,
      metadata: { followupId: id, timeMultiplier: created.access.timeMultiplier },
    });
    return reply
      .header("cache-control", "private, no-store")
      .header("pragma", "no-cache")
      .code(201)
      .send({ access: { ...created.access, url } });
  });

  app.delete("/v1/followups/:id/access/:accessId", async (request, reply) => {
    const creator = await auth.requireCreator(request, reply);
    if (!creator) return;
    if (requireWorkspaceRole(creator, ["owner", "editor"], reply, request.id) !== true) return;
    const { id, accessId } = FollowupAccessParamsSchema.parse(request.params);
    await followups.revokeAccess(creator.workspaceId, id, accessId);
    await repository.recordAudit({
      workspaceId: creator.workspaceId,
      actorId: creator.userId,
      action: "followup.access.revoke",
      targetType: "followup_access_token",
      targetId: accessId,
      requestId: request.id,
      metadata: { followupId: id },
    });
    return reply.code(204).send();
  });

  app.post("/v1/followups/:id/close", async (request, reply) => {
    const creator = await auth.requireCreator(request, reply);
    if (!creator) return;
    if (requireWorkspaceRole(creator, ["owner", "editor"], reply, request.id) !== true) return;
    const { id } = FollowupParamsSchema.parse(request.params);
    await followups.close(creator.workspaceId, id);
    await repository.recordAudit({
      workspaceId: creator.workspaceId,
      actorId: creator.userId,
      action: "followup.close",
      targetType: "followup",
      targetId: id,
      requestId: request.id,
    });
    return reply.code(204).send();
  });

  app.post(
    "/v1/followups/:id/start",
    { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const token = request.headers.authorization?.replace(/^Bearer\s+/i, "") ?? "";
      if (!token)
        return apiError(reply, 401, "UNAUTHORIZED", "Follow-up token required", request.id);
      const { id } = FollowupParamsSchema.parse(request.params);
      const input = StartFollowupSchema.parse(request.body ?? {});
      const result = await followups.start(id, token, input.attemptToken);
      return reply.code(201).send(result);
    },
  );

  app.get(
    "/v1/followups/:id/snapshot",
    { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const token = request.headers.authorization?.replace(/^Bearer\s+/i, "") ?? "";
      if (!token) return apiError(reply, 401, "UNAUTHORIZED", "Attempt token required", request.id);
      const { id } = FollowupParamsSchema.parse(request.params);
      return { snapshot: await followups.resume(id, token) };
    },
  );

  app.post(
    "/v1/followups/:id/answers",
    { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const token = request.headers.authorization?.replace(/^Bearer\s+/i, "") ?? "";
      if (!token) return apiError(reply, 401, "UNAUTHORIZED", "Attempt token required", request.id);
      const { id } = FollowupParamsSchema.parse(request.params);
      const input = FollowupAnswerSubmitSchema.parse(request.body);
      return { snapshot: await followups.answer(id, token, input) };
    },
  );

  app.post(
    "/v1/followups/:id/advance",
    { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const token = request.headers.authorization?.replace(/^Bearer\s+/i, "") ?? "";
      if (!token) return apiError(reply, 401, "UNAUTHORIZED", "Attempt token required", request.id);
      const { id } = FollowupParamsSchema.parse(request.params);
      const input = FollowupAdvanceSchema.parse(request.body ?? {});
      return { snapshot: await followups.advance(id, token, new Date(), input) };
    },
  );

  app.get("/v1/followups/:id/media/:mediaId", async (request, reply) => {
    const { id, mediaId } = FollowupMediaParamsSchema.parse(request.params);
    const token = request.headers.authorization?.replace(/^Bearer\s+/i, "") ?? "";
    if (!token) return apiError(reply, 401, "UNAUTHORIZED", "Attempt token required", request.id);
    const workspaceId = await followups.authorizeMedia(id, token, mediaId);
    const asset = await repository.getMediaAsset(workspaceId, mediaId);
    if (!asset || asset.scanStatus !== "clean") {
      return apiError(reply, 404, "NOT_FOUND", "Media not found", request.id);
    }
    return {
      media: { id: asset.id, scanStatus: asset.scanStatus, altText: asset.altText },
      downloadUrl: await storage.createDownloadUrl(asset),
    };
  });

  app.post("/v1/media", async (request, reply) => {
    const creator = await auth.requireCreator(request, reply);
    if (!creator) return;
    if (requireWorkspaceRole(creator, ["owner", "editor"], reply, request.id) !== true) return;
    if (!(await operationalFeatures()).effective.mediaUploads)
      return apiError(
        reply,
        503,
        "DEPENDENCY_UNAVAILABLE",
        "Media uploads are temporarily unavailable",
        request.id,
      );
    const input = MediaUploadRequestSchema.parse(request.body);
    try {
      const upload = await storage.createUpload({ workspaceId: creator.workspaceId, ...input });
      await repository.createMediaAsset(upload.media);
      await repository.recordAudit({
        workspaceId: creator.workspaceId,
        actorId: creator.userId,
        action: "media.upload_requested",
        targetType: "media_asset",
        targetId: upload.media.id,
        requestId: request.id,
        metadata: { mimeType: upload.media.mimeType, sizeBytes: upload.media.sizeBytes },
      });
      return reply.code(201).send({
        mediaId: upload.media.id,
        uploadUrl: upload.uploadUrl,
        expiresInSeconds: upload.expiresInSeconds,
        scanStatus: upload.media.scanStatus,
      });
    } catch (error) {
      return apiError(
        reply,
        422,
        "VALIDATION_ERROR",
        error instanceof Error ? error.message : "Invalid upload",
        request.id,
      );
    }
  });

  app.post("/v1/media/:id/complete", async (request, reply) => {
    const creator = await auth.requireCreator(request, reply);
    if (!creator) return;
    if (requireWorkspaceRole(creator, ["owner", "editor"], reply, request.id) !== true) return;
    const { id } = IdParamsSchema.parse(request.params);
    const asset = await repository.getMediaAsset(creator.workspaceId, id);
    if (!asset || asset.scanStatus === "deleting") {
      return apiError(reply, 404, "NOT_FOUND", "Media not found", request.id);
    }
    if (asset.scanStatus === "clean" || asset.scanStatus === "rejected") {
      return {
        media: { id, scanStatus: asset.scanStatus, altText: asset.altText },
        ...(asset.scanStatus === "clean"
          ? { downloadUrl: await storage.createDownloadUrl(asset) }
          : {}),
      };
    }
    const finalizationToken = randomUUID();
    let finalizationCommitted = false;
    let failureCleanupAllowed = true;
    try {
      const claimed = await repository.claimMediaAssetFinalization(
        creator.workspaceId,
        id,
        finalizationToken,
      );
      if (!claimed) {
        return apiError(reply, 409, "CONFLICT", "Media state changed; retry shortly", request.id);
      }
      const result = await storage.finalize(claimed, finalizationToken);
      if (result.scanStatus === "clean") {
        // A clean row is externally visible and may be referenced immediately. Make the winner
        // lifecycle-safe before the conditional database commit can acknowledge it.
        await storage.commitFinalizationCandidate(claimed, finalizationToken, result.objectKey);
      }
      let updated: Awaited<ReturnType<Repository["updateMediaAsset"]>>;
      try {
        updated = await repository.updateMediaAsset(creator.workspaceId, id, {
          ...result,
          finalizationToken,
          finalizedAt: new Date(),
        });
      } catch (updateError) {
        // A dropped connection can hide a committed CAS. Reconcile before deleting the candidate;
        // otherwise a clean row could be left pointing at an object we just removed.
        failureCleanupAllowed = false;
        const authoritative = await repository
          .getMediaAsset(creator.workspaceId, id)
          .catch(() => null);
        const committedThisAttempt =
          authoritative !== null &&
          ((result.scanStatus === "clean" &&
            authoritative.scanStatus === "clean" &&
            authoritative.objectKey === result.objectKey) ||
            (result.scanStatus === "rejected" && authoritative.scanStatus === "rejected"));
        if (committedThisAttempt) {
          updated = authoritative;
          finalizationCommitted = true;
        } else {
          // This conditional release succeeds only while this attempt still owns the lease. If
          // ownership or the authoritative read is uncertain, preserve the private candidate for
          // retry/retention instead of risking deletion of a committed winner.
          failureCleanupAllowed = await repository
            .releaseMediaAssetFinalization(creator.workspaceId, id, finalizationToken)
            .catch(() => false);
          throw updateError;
        }
      }
      if (!updated) {
        await storage
          .deleteFinalizationCandidate(
            claimed,
            finalizationToken,
            result.scanStatus === "clean" ? result.objectKey : undefined,
          )
          .catch((cleanupError) => {
            request.log.error(
              {
                errorType: cleanupError instanceof Error ? cleanupError.name : "unknown",
                mediaId: id,
              },
              "stale media finalization candidate cleanup deferred",
            );
          });
        return apiError(reply, 409, "CONFLICT", "Media state changed; retry shortly", request.id);
      }
      finalizationCommitted = true;
      try {
        await storage.cleanupFinalization(updated);
        if (updated.scanStatus === "clean") {
          await repository.completeInlineMediaObjectCleanup(updated, new Date());
        }
      } catch (cleanupError) {
        request.log.error(
          {
            errorType: cleanupError instanceof Error ? cleanupError.name : "unknown",
            mediaId: id,
          },
          "media finalization object cleanup deferred",
        );
      }
      await repository
        .recordAudit({
          workspaceId: creator.workspaceId,
          actorId: creator.userId,
          action: `media.${result.scanStatus}`,
          targetType: "media_asset",
          targetId: id,
          requestId: request.id,
        })
        .catch((auditError) => {
          request.log.error(
            {
              errorType: auditError instanceof Error ? auditError.name : "unknown",
              mediaId: id,
            },
            "media finalization audit write failed after authoritative commit",
          );
        });
      metrics.recordMediaFinalization(result.scanStatus);
      return {
        media: {
          id,
          scanStatus: updated.scanStatus,
          altText: asset.altText,
        },
        ...(result.scanStatus === "clean"
          ? { downloadUrl: await storage.createDownloadUrl(updated) }
          : {}),
      };
    } catch (error) {
      if (!finalizationCommitted) {
        if (failureCleanupAllowed) {
          await storage
            .deleteFinalizationCandidate(asset, finalizationToken)
            .catch(() => undefined);
          await repository
            .releaseMediaAssetFinalization(creator.workspaceId, id, finalizationToken)
            .catch(() => undefined);
        }
        metrics.recordMediaFinalization("error");
      }
      request.log.warn(
        { err: error, mediaId: id, finalizationCommitted },
        finalizationCommitted
          ? "media finalization committed but response delivery failed"
          : "media finalization deferred",
      );
      return apiError(
        reply,
        409,
        "CONFLICT",
        "The upload is unavailable or the scanner could not complete; retry shortly",
        request.id,
      );
    }
  });

  app.get("/v1/media/:id", async (request, reply) => {
    const creator = await auth.requireCreator(request, reply);
    if (!creator) return;
    const { id } = IdParamsSchema.parse(request.params);
    const asset = await repository.getMediaAsset(creator.workspaceId, id);
    if (!asset || asset.scanStatus === "deleting") {
      return apiError(reply, 404, "NOT_FOUND", "Media not found", request.id);
    }
    if (asset.scanStatus !== "clean") {
      return apiError(reply, 409, "CONFLICT", "Media is not available", request.id);
    }
    return {
      media: { id: asset.id, scanStatus: asset.scanStatus, altText: asset.altText },
      downloadUrl: await storage.createDownloadUrl(asset),
    };
  });

  app.delete("/v1/media/:id", async (request, reply) => {
    const creator = await auth.requireCreator(request, reply);
    if (!creator) return;
    if (requireWorkspaceRole(creator, ["owner", "editor"], reply, request.id) !== true) return;
    const { id } = IdParamsSchema.parse(request.params);
    const asset = await repository.getMediaAsset(creator.workspaceId, id);
    if (!asset) return apiError(reply, 404, "NOT_FOUND", "Media not found", request.id);

    const references = await repository.listMediaReferences(creator.workspaceId, id);
    if (references.length > 0) {
      return apiError(reply, 409, "CONFLICT", "Referenced media cannot be deleted", request.id);
    }

    // The durable `deleting` tombstone is the atomic claim. It remains longer than the presigned
    // PUT lifetime so retention can perform a second object sweep before metadata is removed.
    const claimedAsset = await repository.claimMediaAssetDeletion(creator.workspaceId, id);
    if (!claimedAsset) {
      const current = await repository.getMediaAsset(creator.workspaceId, id);
      return current
        ? apiError(reply, 409, "CONFLICT", "Referenced media cannot be deleted", request.id)
        : apiError(reply, 404, "NOT_FOUND", "Media not found", request.id);
    }
    try {
      await storage.deleteAsset(claimedAsset);
    } catch (error) {
      request.log.error(
        {
          errorType: error instanceof Error ? error.name : "unknown",
          mediaId: id,
        },
        "media deletion deferred with durable tombstone",
      );
      return apiError(
        reply,
        503,
        "DEPENDENCY_UNAVAILABLE",
        "Media deletion could not be completed; retry shortly",
        request.id,
      );
    }
    await repository.recordAudit({
      workspaceId: creator.workspaceId,
      actorId: creator.userId,
      action: "media.deletion_requested",
      targetType: "media_asset",
      targetId: id,
      requestId: request.id,
    });
    return reply.code(204).send();
  });

  app.get("/v1/sessions/:id/media/:mediaId", async (request, reply) => {
    const { id, mediaId } = SessionMediaParamsSchema.parse(request.params);
    const credential = request.headers.authorization?.replace(/^Bearer\s+/i, "") ?? "";
    const workspaceId = await sessions.authorizeMedia(id, mediaId, credential);
    const asset = await repository.getMediaAsset(workspaceId, mediaId);
    if (!asset || asset.scanStatus !== "clean") {
      return apiError(reply, 404, "NOT_FOUND", "Media not found", request.id);
    }
    return {
      media: { id: asset.id, scanStatus: asset.scanStatus, altText: asset.altText },
      downloadUrl: await storage.createDownloadUrl(asset),
    };
  });

  app.get("/v1/billing/status", async (request, reply) => {
    const creator = await auth.requireCreator(request, reply);
    return creator
      ? {
          billing: await repository.getBillingProfile(creator.workspaceId),
          mode: config.BILLING_MODE,
        }
      : undefined;
  });

  app.post("/v1/billing/checkout", async (request, reply) => {
    const creator = await auth.requireCreator(request, reply);
    if (!creator) return;
    if (requireWorkspaceRole(creator, ["owner"], reply, request.id) !== true) return;
    if (!stripe)
      return apiError(
        reply,
        409,
        "CONFLICT",
        "Billing is disabled for this deployment",
        request.id,
      );
    const billing = await repository.getBillingProfile(creator.workspaceId);
    if (
      billing.plan !== "free" ||
      !["free", "canceled", "incomplete_expired"].includes(billing.status)
    ) {
      return apiError(
        reply,
        409,
        "CONFLICT",
        "A subscription already exists for this workspace; use the billing portal",
        request.id,
      );
    }
    const attemptKey = createHash("sha256")
      .update(
        [
          creator.workspaceId,
          billing.customerId ?? "new-customer",
          billing.subscriptionId ?? "first-subscription",
          billing.status,
          config.STRIPE_PRO_PRICE_ID,
        ].join(":"),
      )
      .digest("hex");
    const checkout = await stripe.checkout.sessions.create(
      {
        mode: "subscription",
        line_items: [{ price: config.STRIPE_PRO_PRICE_ID!, quantity: 1 }],
        ...(billing.customerId
          ? { customer: billing.customerId }
          : { customer_email: creator.email }),
        client_reference_id: creator.workspaceId,
        metadata: { workspaceId: creator.workspaceId },
        subscription_data: { metadata: { workspaceId: creator.workspaceId } },
        success_url: `${config.WEB_ORIGIN}/dashboard?billing=success`,
        cancel_url: `${config.WEB_ORIGIN}/pricing?billing=cancelled`,
      },
      { idempotencyKey: `openround-pro-${attemptKey}` },
    );
    if (!checkout.url) {
      return apiError(
        reply,
        503,
        "DEPENDENCY_UNAVAILABLE",
        "Stripe did not return a checkout address",
        request.id,
      );
    }
    return { url: checkout.url };
  });

  app.post("/v1/billing/portal", async (request, reply) => {
    const creator = await auth.requireCreator(request, reply);
    if (!creator) return;
    if (requireWorkspaceRole(creator, ["owner"], reply, request.id) !== true) return;
    if (!stripe)
      return apiError(
        reply,
        409,
        "CONFLICT",
        "Billing is disabled for this deployment",
        request.id,
      );
    const billing = await repository.getBillingProfile(creator.workspaceId);
    if (!billing.customerId)
      return apiError(reply, 409, "CONFLICT", "No billing customer exists yet", request.id);
    const portal = await stripe.billingPortal.sessions.create({
      customer: billing.customerId,
      return_url: `${config.WEB_ORIGIN}/dashboard`,
    });
    return { url: portal.url };
  });

  app.post("/v1/webhooks/stripe", { config: { rawBody: true } }, async (request, reply) => {
    if (!stripe) return reply.code(204).send();
    const signature = request.headers["stripe-signature"];
    const rawBody = (request as FastifyRequest & { rawBody?: Buffer }).rawBody;
    if (typeof signature !== "string" || !rawBody)
      return apiError(reply, 400, "VALIDATION_ERROR", "Missing Stripe signature", request.id);
    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(rawBody, signature, config.STRIPE_WEBHOOK_SECRET!);
    } catch {
      metrics.recordBillingEvent("unknown", "invalid_signature");
      return apiError(reply, 400, "UNAUTHORIZED", "Invalid Stripe signature", request.id);
    }

    const billingEvent: BillingEventInput = {
      providerEventId: event.id,
      eventType: event.type,
      providerCreatedAt: new Date(event.created * 1_000),
    };
    if (event.type === "checkout.session.completed") {
      const checkout = event.data.object;
      const workspaceId = z.string().uuid().safeParse(checkout.metadata?.workspaceId);
      if (workspaceId.success) {
        Object.assign(billingEvent, {
          workspaceId: workspaceId.data,
          plan: "pro" as const,
          customerId:
            typeof checkout.customer === "string" ? checkout.customer : checkout.customer?.id,
          subscriptionId:
            typeof checkout.subscription === "string"
              ? checkout.subscription
              : checkout.subscription?.id,
          status: "active",
        });
      }
    }
    if (
      event.type === "customer.subscription.updated" ||
      event.type === "customer.subscription.deleted"
    ) {
      const subscription = event.data.object;
      const workspaceId = z.string().uuid().safeParse(subscription.metadata.workspaceId);
      if (workspaceId.success) {
        const active =
          event.type !== "customer.subscription.deleted" &&
          ["active", "trialing"].includes(subscription.status);
        Object.assign(billingEvent, {
          workspaceId: workspaceId.data,
          plan: active ? ("pro" as const) : ("free" as const),
          customerId:
            typeof subscription.customer === "string"
              ? subscription.customer
              : subscription.customer.id,
          subscriptionId: subscription.id,
          status: subscription.status,
        });
      }
    }
    metrics.observeBillingLag((Date.now() - event.created * 1_000) / 1_000);
    const applied = await repository.applyBillingEvent(billingEvent);
    metrics.recordBillingEvent(event.type, applied ? "applied" : "duplicate");
    return reply.code(204).send();
  });

  app.get("/v1/account/export", async (request, reply) => {
    const creator = await auth.requireCreator(request, reply);
    if (!creator) return;
    const data = await repository.exportAccount(creator.userId);
    return reply
      .header("content-type", "application/json; charset=utf-8")
      .header(
        "content-disposition",
        `attachment; filename="openround-account-${creator.userId}.json"`,
      )
      .send(data);
  });

  app.get("/v1/workspace/audit-export", async (request, reply) => {
    const creator = await auth.requireCreator(request, reply);
    if (!creator) return;
    if (requireWorkspaceRole(creator, ["owner"], reply, request.id) !== true) return;
    const policy = await repository.getInstitutionPolicy(creator.workspaceId);
    if (policy.contractStatus === "disabled" || !policy.capabilities.auditExports) {
      return apiError(
        reply,
        403,
        "INSTITUTION_NOT_ENABLED",
        "Institution audit export is not approved for this workspace",
        request.id,
      );
    }
    const query = z
      .object({
        since: z
          .string()
          .datetime({ offset: true })
          .transform((value) => new Date(value))
          .optional(),
      })
      .parse(request.query);
    const workspaces = await repository.listWorkspaces(creator.userId);
    const workspace = workspaces.find((candidate) => candidate.id === creator.workspaceId);
    const maximumEvents = 10_000;
    const events = await repository.listAuditEvents(
      creator.workspaceId,
      query.since ?? null,
      maximumEvents + 1,
    );
    const truncated = events.length > maximumEvents;
    const exportedEvents = events.slice(0, maximumEvents).map((event) => ({
      ...event,
      createdAt: event.createdAt.toISOString(),
    }));
    await repository.recordAudit({
      workspaceId: creator.workspaceId,
      actorId: creator.userId,
      action: "institution.audit.export",
      targetType: "workspace",
      targetId: creator.workspaceId,
      requestId: request.id,
      metadata: {
        since: query.since?.toISOString() ?? null,
        exportedCount: exportedEvents.length,
        truncated,
      },
    });
    return reply
      .header("cache-control", "no-store")
      .header("content-type", "application/json; charset=utf-8")
      .header(
        "content-disposition",
        `attachment; filename="polling-pops-audit-${creator.workspaceId}.json"`,
      )
      .send({
        format: "openround.audit",
        schemaVersion: 1,
        exportedAt: new Date().toISOString(),
        workspace: {
          id: creator.workspaceId,
          name: workspace?.name ?? "Polling Pops workspace",
          homeRegion: workspace?.homeRegion ?? null,
        },
        range: { since: query.since?.toISOString() ?? null, truncated, maximumEvents },
        events: exportedEvents,
      });
  });

  app.delete("/v1/account", async (request, reply) => {
    const creator = await auth.requireCreator(request, reply);
    if (!creator) return;
    const { confirmation } = z.object({ confirmation: z.literal("DELETE") }).parse(request.body);
    void confirmation;
    const ownedWorkspaces = (await repository.listWorkspaces(creator.userId)).filter(
      (workspace) => workspace.role === "owner",
    );
    const ownedWorkspaceData = await Promise.all(
      ownedWorkspaces.map(async (workspace) => ({
        workspace,
        mediaAssets: await repository.listMediaAssets(workspace.id),
      })),
    );
    const mediaAssets = ownedWorkspaceData.flatMap((item) => item.mediaAssets);
    if (mediaAssets.length > 0 && !storage.configured) {
      return apiError(
        reply,
        503,
        "DEPENDENCY_UNAVAILABLE",
        "Account media could not be removed because object storage is unavailable",
        request.id,
      );
    }
    const deletionStartedAt = new Date();
    const claimedWorkspaceData = await Promise.all(
      ownedWorkspaceData.map(async ({ workspace }) => ({
        workspace,
        mediaAssets: await repository.claimWorkspaceMediaDeletion(workspace.id, deletionStartedAt),
      })),
    );
    // Session creation takes a workspace row lock and refuses the durable deletion fence. Reading
    // invalidation targets only after every fence is committed therefore includes creations that
    // won the race, including their Redis room-code reservations.
    const sessionInvalidationTargets = (
      await Promise.all(
        ownedWorkspaces.map((workspace) => repository.listSessionInvalidationTargets(workspace.id)),
      )
    ).flat();
    const claimedMediaAssets = claimedWorkspaceData.flatMap((item) => item.mediaAssets);
    if (claimedMediaAssets.length > 0 && !storage.configured) {
      return apiError(
        reply,
        503,
        "DEPENDENCY_UNAVAILABLE",
        "Account media could not be removed because object storage is unavailable",
        request.id,
      );
    }
    try {
      for (const asset of claimedMediaAssets) await storage.deleteAsset(asset);
      await sessions.invalidateWorkspaceDeletion(sessionInvalidationTargets);
    } catch {
      return apiError(
        reply,
        503,
        "DEPENDENCY_UNAVAILABLE",
        "Account dependencies could not be cleared; the account record was not deleted",
        request.id,
      );
    }
    await Promise.all(
      claimedWorkspaceData.map(({ workspace, mediaAssets: workspaceMedia }) =>
        repository.recordAudit({
          workspaceId: workspace.id,
          actorId: creator.userId,
          action: "account.delete",
          targetType: "account",
          targetId: creator.userId,
          requestId: request.id,
          metadata: { mediaObjectsRemoved: workspaceMedia.length },
        }),
      ),
    );
    await repository.deleteAccount(creator.userId);
    auth.clearSessionCookie(reply);
    return reply.code(204).send();
  });

  app.get("/v1/admin/features", async (request, reply) => {
    const token = request.headers.authorization?.replace(/^Bearer\s+/i, "");
    if (!config.ADMIN_TOKEN || token !== config.ADMIN_TOKEN)
      return apiError(reply, 401, "UNAUTHORIZED", "Administrator token required", request.id);
    return operationalFeatures();
  });

  app.patch("/v1/admin/features", async (request, reply) => {
    const token = request.headers.authorization?.replace(/^Bearer\s+/i, "");
    if (!config.ADMIN_TOKEN || token !== config.ADMIN_TOKEN)
      return apiError(reply, 401, "UNAUTHORIZED", "Administrator token required", request.id);
    const input = OperationalFeaturesUpdateSchema.parse(request.body);
    await repository.updateOperationalFeatures(input, request.id);
    return operationalFeatures();
  });

  app.put("/v1/admin/workspaces/:id/institution-policy", async (request, reply) => {
    const token = request.headers.authorization?.replace(/^Bearer\s+/i, "");
    if (!config.ADMIN_TOKEN || token !== config.ADMIN_TOKEN)
      return apiError(reply, 401, "UNAUTHORIZED", "Administrator token required", request.id);
    const { id } = WorkspaceParamsSchema.parse(request.params);
    const input = UpdateWorkspaceInstitutionPolicySchema.parse(request.body);
    const policy = {
      workspaceId: id,
      ...input,
      k12Enabled: false as const,
      updatedAt: new Date(),
    };
    await repository.updateInstitutionPolicy(policy, request.id);
    return WorkspaceInstitutionPolicySchema.parse({
      ...policy,
      updatedAt: policy.updatedAt.toISOString(),
    });
  });

  app.post("/v1/admin/workspaces/:id/lti-registrations", async (request, reply) => {
    const token = request.headers.authorization?.replace(/^Bearer\s+/i, "");
    if (!config.ADMIN_TOKEN || token !== config.ADMIN_TOKEN)
      return apiError(reply, 401, "UNAUTHORIZED", "Administrator token required", request.id);
    const { id } = WorkspaceParamsSchema.parse(request.params);
    const input = UpsertLtiRegistrationSchema.parse(request.body);
    const registration = await lti.upsertRegistration(id, input);
    await repository.recordAudit({
      workspaceId: id,
      actorId: null,
      action: "lti.registration.create",
      targetType: "lti_registration",
      targetId: registration.id,
      requestId: request.id,
      metadata: { issuer: registration.issuer, deploymentId: registration.deploymentId },
    });
    return reply.code(201).send(
      LtiRegistrationSchema.parse({
        ...registration,
        createdAt: registration.createdAt.toISOString(),
        updatedAt: registration.updatedAt.toISOString(),
      }),
    );
  });

  app.put("/v1/admin/workspaces/:id/lti-registrations/:registrationId", async (request, reply) => {
    const token = request.headers.authorization?.replace(/^Bearer\s+/i, "");
    if (!config.ADMIN_TOKEN || token !== config.ADMIN_TOKEN)
      return apiError(reply, 401, "UNAUTHORIZED", "Administrator token required", request.id);
    const { id, registrationId } = LtiRegistrationParamsSchema.parse(request.params);
    const input = UpsertLtiRegistrationSchema.parse(request.body);
    const registration = await lti.upsertRegistration(id, input, registrationId);
    await repository.recordAudit({
      workspaceId: id,
      actorId: null,
      action: "lti.registration.update",
      targetType: "lti_registration",
      targetId: registration.id,
      requestId: request.id,
      metadata: { issuer: registration.issuer, deploymentId: registration.deploymentId },
    });
    return LtiRegistrationSchema.parse({
      ...registration,
      createdAt: registration.createdAt.toISOString(),
      updatedAt: registration.updatedAt.toISOString(),
    });
  });

  app.post("/v1/admin/retention/run", async (request, reply) => {
    const token = request.headers.authorization?.replace(/^Bearer\s+/i, "");
    if (!config.ADMIN_TOKEN || token !== config.ADMIN_TOKEN)
      return apiError(reply, 401, "UNAUTHORIZED", "Administrator token required", request.id);
    return retention.run(new Date());
  });

  app.get("/v1/admin/sessions/by-code/:code", async (request, reply) => {
    const token = request.headers.authorization?.replace(/^Bearer\s+/i, "");
    if (!config.ADMIN_TOKEN || token !== config.ADMIN_TOKEN)
      return apiError(reply, 401, "UNAUTHORIZED", "Administrator token required", request.id);
    const { code } = z.object({ code: z.string().regex(/^\d{7}$/) }).parse(request.params);
    const session = await repository.getSessionByCode(code);
    if (!session) return apiError(reply, 404, "NOT_FOUND", "Session not found", request.id);
    await repository.recordAudit({
      workspaceId: session.workspaceId,
      actorId: null,
      action: "support.session_lookup",
      targetType: "game_session",
      targetId: session.id,
      requestId: request.id,
    });
    return {
      session: {
        id: session.id,
        code,
        phase: session.state.phase,
        version: session.state.version,
        participantCount: Object.keys(session.state.participants).length,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
      },
    };
  });
}
