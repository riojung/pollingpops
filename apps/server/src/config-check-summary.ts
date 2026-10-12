import type { AppConfig } from "./config.js";

export function createConfigCheckSummary(config: AppConfig) {
  return {
    valid: true,
    buildId: config.OPENROUND_BUILD_ID,
    nodeEnvironment: config.NODE_ENV,
    publicApiUrl: config.PUBLIC_API_URL,
    webOrigin: config.WEB_ORIGIN,
    communityMode: config.COMMUNITY_MODE,
    persistence: config.DATABASE_URL ? "postgresql" : "memory",
    coordination: config.REDIS_URL ? "redis-streams" : "process-local",
    email: config.SMTP_URL ? "smtp" : "disabled",
    developmentEmailInbox: config.DEVELOPMENT_EMAIL_INBOX_URL ? "configured" : "disabled",
    billing: config.BILLING_MODE,
    media: config.S3_ENDPOINT ? config.MEDIA_SCAN_MODE : "disabled",
    metrics: config.METRICS_ENABLED
      ? config.METRICS_TOKEN
        ? "protected"
        : "unprotected"
      : "disabled",
    logs: config.OPENROUND_LOG_SHIPPING_MODE,
    tracing: config.TRACING_ENABLED ? "otlp" : "disabled",
    participantLimit: config.MAX_SESSION_PARTICIPANTS,
    practicePersonalLinkLimit: config.MAX_PRACTICE_PERSONAL_LINKS,
    presentationResponseWrites: config.PRESENTATION_CONCURRENT_RESPONSE_WRITES
      ? "concurrent"
      : "rollback-compatible",
    featureFlags: {
      signups: config.FEATURE_SIGNUPS,
      sessionCreation: config.FEATURE_SESSION_CREATION,
      mediaUploads: config.FEATURE_MEDIA_UPLOADS,
      roundExperiences: config.FEATURE_ROUND_EXPERIENCES,
      audiencePulse: config.FEATURE_AUDIENCE_PULSE,
      roomChat: config.FEATURE_ROOM_CHAT,
      uxBeta: config.FEATURE_UX_BETA,
      recoveryRehearsal: config.FEATURE_RECOVERY_REHEARSAL,
      practiceAssignments: config.FEATURE_PRACTICE_ASSIGNMENTS,
      workspaceShell: config.FEATURE_WORKSPACE_SHELL,
      builderV2: config.FEATURE_BUILDER_V2,
      presentations: config.FEATURE_PRESENTATIONS,
      groups: config.FEATURE_GROUPS,
      discover: config.FEATURE_DISCOVER,
      presentationRealtime: config.FEATURE_PRESENTATION_REALTIME,
      presentationCompanion: config.FEATURE_PRESENTATION_COMPANION,
      liveFlexMode: config.FEATURE_LIVE_FLEX_MODE,
      recoveryPacks: config.FEATURE_RECOVERY_PACKS,
      recoveryPackLiveCards: config.FEATURE_RECOVERY_PACK_LIVE_CARDS,
      questionHealth: config.FEATURE_QUESTION_HEALTH,
      decisionReplay: config.FEATURE_DECISION_REPLAY,
      recoveryTrails: config.FEATURE_RECOVERY_TRAILS,
      conceptHealth: config.FEATURE_CONCEPT_HEALTH,
      extendedQuestionTypes: config.FEATURE_EXTENDED_QUESTION_TYPES,
      verifiedInstitution: config.FEATURE_VERIFIED_INSTITUTION,
      audienceScopes: config.FEATURE_AUDIENCE_SCOPES,
      roundClientProtocol: config.FEATURE_ROUND_CLIENT_PROTOCOL,
      feedbackRooms: config.FEATURE_FEEDBACK_ROOMS,
      surveys: config.FEATURE_SURVEYS,
      feedbackExports: config.FEATURE_FEEDBACK_EXPORTS,
    },
    themedInteractionsWorkspaceAllowlistSize: config.THEMED_INTERACTIONS_WORKSPACE_ALLOWLIST.length,
    uxBetaWorkspaceAllowlistSize: config.UX_BETA_WORKSPACE_ALLOWLIST.length,
    evidenceFeaturesWorkspaceAllowlistSize: config.EVIDENCE_FEATURES_WORKSPACE_ALLOWLIST.length,
    coreParityWorkspaceAllowlistSize: config.CORE_PARITY_WORKSPACE_ALLOWLIST.length,
  };
}
