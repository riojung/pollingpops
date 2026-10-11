import { createHash, randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool, type PoolClient, type QueryResultRow } from "pg";
import { upgradeGameState, type EngineAnswer, type GameState } from "@openround/game-engine";
import {
  MAX_SESSION_DECISION_EVENTS,
  QUESTION_HEALTH_POST_USE_MAX_REPORTS,
  RecoveryPackCardReferenceSchema,
  RecoveryPackPracticeSourceSchema,
  RecoveryPackPracticeSequenceSchema,
  ReportSchema,
  ResponsePayloadSchema,
  SessionDecisionEventSchema,
  SupportedLocaleSchema,
  TrustModeSchema,
  questionDelivery,
  QuestionSchema,
  type BrandTheme,
  type QuizDraft,
  type Report,
  type SupportedLocale,
} from "@openround/contracts";
import {
  AudienceStoreError,
  FollowupAccessLimitError,
  FollowupVersionConflictError,
  MEDIA_DELETION_TOMBSTONE_HOLD_MS,
  PublishedQuizLimitError,
  QuizDraftMutationConflictError,
  QuizDraftRevisionConflictError,
  SessionCodeConflictError,
  SessionNotActiveError,
  SessionVersionConflictError,
  WorkspaceDeletionInProgressError,
} from "./types.js";
import { runMigrations } from "./migrations.js";
import {
  publishedQuestionCatalogOptions,
  publishedQuestionMetadata,
  publishedQuestionTextOnlyLiveEligible,
} from "./published-question-live-metadata.js";
import {
  assertRecoveryPackPracticeInput,
  matchRecoveryPackPracticeReceipt,
  recoveryPackPracticeSourceMatches,
  recoveryPackPracticeCreationEvidence,
} from "./recovery-pack-practice.js";
import {
  PRESENTATION_CONTENT_SCHEMA_VERSION,
  PRESENTATION_DRAFT_SCHEMA_VERSION,
  ROUND_CONTENT_SCHEMA_VERSION,
  ROUND_DRAFT_SCHEMA_VERSION,
  RECOVERY_PACK_CONTENT_SCHEMA_VERSION,
  RECOVERY_PACK_DRAFT_SCHEMA_VERSION,
  upcastPresentationContent,
  upcastPresentationDraft,
  upcastRoundContent,
  assertRoundContentSchemaVersion,
  upcastRoundDraft,
  upcastRecoveryPackContent,
  upcastRecoveryPackDraft,
} from "./artifact-schemas.js";
import type {
  AudienceEventInput,
  AudienceMutation,
  AudienceOutboxRecord,
  AudienceRestrictionRecord,
  AuditEventRecord,
  AuditInput,
  AnswerLookup,
  AuthoringJobRecord,
  BillingEventInput,
  CapacityTestWorkspaceProvisionResult,
  ChatMessageListOptions,
  ChatMessageRecord,
  ChatReactionRecord,
  ChatReactionSummaryRecord,
  CreatorContext,
  FolderRecord,
  FollowupAccessRecord,
  FollowupAnswerRecord,
  FollowupAttemptRecord,
  FollowupRecord,
  FollowupHistoryRecord,
  FollowupHistoryListOptions,
  FederatedAuthTransactionRecord,
  HistoryCursor,
  ExternalIdentityRecord,
  InstitutionPolicyRecord,
  InteractionSettingsRecord,
  LtiLaunchRecord,
  LtiLoginTransactionRecord,
  LtiRegistrationRecord,
  LiveRoomArtifactType,
  LibraryArtifactDeletionResult,
  LiveRoomCodeClaim,
  LiveRoomCodeRecord,
  MagicTokenRecord,
  MediaAssetCreateInput,
  MediaAssetRecord,
  MediaObjectCleanupClaim,
  MediaReferenceOwnerType,
  MediaReferenceRecord,
  OperationalFeaturesRecord,
  OperationalFeaturesUpdate,
  ParticipantRecord,
  ParticipantSignalRecord,
  Plan,
  ProductEventRecord,
  RecoveryPackPracticeCreationContext,
  QuestionHealthObservationReport,
  QuestionHealthObservationReportPage,
  QuestionHealthDismissalIdentity,
  QuestionHealthDismissalRecord,
  QuestionHealthDismissalWrite,
  QuestionHealthApplicationRecord,
  QnaQuestionRecord,
  QnaReplyRecord,
  QnaSettingsRecord,
  QuizListRecord,
  QuizDraftHistoryRecord,
  QuizDraftUpdate,
  QuizRecord,
  QuizVersionRecord,
  RuntimeDatabasePrincipalSecurity,
  ReportJob,
  ReportHistoryRecord,
  Repository,
  Segment,
  SessionStaffCredentialRecord,
  SessionStaffCredentialInput,
  SessionDecisionEventWrite,
  SessionHistoryRecord,
  SessionInvalidationTarget,
  StoredSession,
  WorkspaceInvitationRecord,
  WorkspaceMediaDeletionJobRecord,
  WorkspaceMemberRecord,
  WorkspaceSummaryRecord,
} from "./types.js";

interface RuntimeDatabasePrincipalRow {
  principal: string;
  session_principal: string;
  session_matches_current: boolean;
  runtime_role_member: boolean;
  superuser: boolean;
  bypass_rls: boolean;
  create_role: boolean;
  create_database: boolean;
  replication: boolean;
  privileged_role_member: boolean;
  unexpected_role_member: boolean;
  owner_role_member: boolean;
}

const runtimeDatabasePrincipalSql = `SELECT current_user::text AS principal,
       session_user::text AS session_principal,
       session_user = current_user AS session_matches_current,
       pg_has_role(current_user, 'openround_runtime', 'MEMBER') AS runtime_role_member,
       role.rolsuper AS superuser,
       role.rolbypassrls AS bypass_rls,
       role.rolcreaterole AS create_role,
       role.rolcreatedb AS create_database,
       role.rolreplication AS replication,
       EXISTS (
         SELECT 1
           FROM pg_roles AS privileged_role
          WHERE (
                  privileged_role.rolsuper
                  OR privileged_role.rolbypassrls
                  OR privileged_role.rolcreaterole
                  OR privileged_role.rolcreatedb
                  OR privileged_role.rolreplication
                )
            AND pg_has_role(current_user, privileged_role.oid, 'MEMBER')
       ) AS privileged_role_member,
       EXISTS (
         SELECT 1
           FROM pg_roles AS member_role
          WHERE member_role.oid <> role.oid
            AND member_role.rolname <> 'openround_runtime'
            AND pg_has_role(current_user, member_role.oid, 'MEMBER')
       ) AS unexpected_role_member,
       EXISTS (
         SELECT 1
           FROM (
             SELECT database.datdba AS role_oid
               FROM pg_database AS database
              WHERE database.datname = current_database()
             UNION
             SELECT namespace.nspowner AS role_oid
               FROM pg_namespace AS namespace
              WHERE namespace.nspname = 'public'
             UNION
             SELECT object.relowner AS role_oid
               FROM pg_class AS object
               JOIN pg_namespace AS namespace ON namespace.oid = object.relnamespace
              WHERE namespace.nspname = 'public'
             UNION
             SELECT procedure.proowner AS role_oid
               FROM pg_proc AS procedure
               JOIN pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
              WHERE namespace.nspname = 'public'
           ) AS owner_role
          WHERE pg_has_role(current_user, owner_role.role_oid, 'MEMBER')
       ) AS owner_role_member
  FROM pg_roles AS role
 WHERE role.rolname = current_user`;

function mapRuntimeDatabasePrincipal(
  principal: RuntimeDatabasePrincipalRow | undefined,
): RuntimeDatabasePrincipalSecurity {
  if (!principal) throw new Error("Unable to inspect the current database principal");
  return {
    principal: principal.principal,
    sessionPrincipal: principal.session_principal,
    sessionMatchesCurrent: principal.session_matches_current,
    runtimeRoleMember: principal.runtime_role_member,
    superuser: principal.superuser,
    bypassRls: principal.bypass_rls,
    createRole: principal.create_role,
    createDatabase: principal.create_database,
    replication: principal.replication,
    privilegedRoleMember: principal.privileged_role_member,
    unexpectedRoleMember: principal.unexpected_role_member,
    ownerRoleMember: principal.owner_role_member,
  };
}

export function assertRestrictedRuntimeDatabasePrincipal(
  principal: RuntimeDatabasePrincipalSecurity,
) {
  if (
    !principal.sessionMatchesCurrent ||
    !principal.runtimeRoleMember ||
    principal.superuser ||
    principal.bypassRls ||
    principal.createRole ||
    principal.createDatabase ||
    principal.replication ||
    principal.privilegedRoleMember ||
    principal.unexpectedRoleMember ||
    principal.ownerRoleMember
  ) {
    throw new Error(
      "Capacity provisioning requires a restricted, non-owner openround_runtime database principal",
    );
  }
  return principal;
}

function date(value: unknown): Date {
  return value instanceof Date ? value : new Date(String(value));
}

function supportedLocale(value: unknown): SupportedLocale {
  const parsed = SupportedLocaleSchema.safeParse(value);
  return parsed.success ? parsed.data : "en-CA";
}

function mapQuiz(row: QueryResultRow): QuizRecord {
  const draftSchemaVersion = Number(row.draft_schema_version ?? ROUND_DRAFT_SCHEMA_VERSION);
  const draft = upcastRoundDraft(row.draft, draftSchemaVersion);
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    title: draft.title,
    description: draft.description,
    status: row.status,
    draft,
    draftRevision: Number(row.draft_revision ?? 0),
    draftSchemaVersion,
    publishedDraftRevision:
      row.published_draft_revision == null ? null : Number(row.published_draft_revision),
    lastEditedBy: row.last_edited_by == null ? null : String(row.last_edited_by),
    currentVersionId: row.current_version_id,
    folderId: row.folder_id ?? null,
    tags: Array.isArray(row.tags) ? row.tags.map(String) : [],
    createdAt: date(row.created_at),
    updatedAt: date(row.updated_at),
  };
}

function mapQuizDraftHistory(row: QueryResultRow): QuizDraftHistoryRecord {
  const draftSchemaVersion = Number(row.draft_schema_version ?? ROUND_DRAFT_SCHEMA_VERSION);
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    quizId: String(row.quiz_id),
    revision: Number(row.revision),
    draft: upcastRoundDraft(row.draft, draftSchemaVersion),
    draftSchemaVersion,
    savedBy: row.saved_by ? String(row.saved_by) : null,
    mutationId: row.mutation_id ? String(row.mutation_id) : null,
    createdAt: date(row.created_at),
  };
}

function mapQuestionHealthDismissal(row: QueryResultRow): QuestionHealthDismissalRecord {
  return {
    workspaceId: String(row.workspace_id),
    quizId: String(row.quiz_id),
    findingId: String(row.finding_id),
    ruleVersion: Number(row.rule_version),
    rulesetVersion: String(row.ruleset_version),
    contentHash: String(row.content_hash).trim(),
    reason: row.reason,
    createdAt: date(row.created_at),
  };
}

function mapQuestionHealthApplication(row: QueryResultRow): QuestionHealthApplicationRecord {
  return {
    workspaceId: String(row.workspace_id),
    quizId: String(row.quiz_id),
    applicationId: String(row.application_id),
    findingId: String(row.finding_id),
    ruleVersion: Number(row.rule_version),
    rulesetVersion: String(row.ruleset_version),
    contentHash: String(row.content_hash).trim(),
    sourceRevision: Number(row.source_revision),
    appliedRevision: Number(row.applied_revision),
    requestHash: String(row.request_hash).trim(),
    changes: row.changes,
    createdAt: date(row.created_at),
  };
}

function quizAtDraftRevision(current: QuizRecord, snapshot: QuizDraftHistoryRecord): QuizRecord {
  return {
    ...current,
    title: snapshot.draft.title,
    description: snapshot.draft.description,
    draft: snapshot.draft,
    draftRevision: snapshot.revision,
    draftSchemaVersion: snapshot.draftSchemaVersion,
    lastEditedBy: snapshot.savedBy,
    updatedAt: snapshot.createdAt,
  };
}

function mapQuizListRecord(row: QueryResultRow): QuizListRecord {
  return {
    ...mapQuiz(row),
    lastHostedAt: row.last_hosted_at == null ? null : date(row.last_hosted_at),
  };
}

function mapFolder(row: QueryResultRow): FolderRecord {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    name: String(row.name),
    createdAt: date(row.created_at),
    updatedAt: date(row.updated_at),
  };
}

function mapVersion(row: QueryResultRow): QuizVersionRecord {
  const contentSchemaVersion = Number(row.content_schema_version ?? ROUND_CONTENT_SCHEMA_VERSION);
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    quizId: row.quiz_id,
    version: row.version,
    content: upcastRoundContent(row.content, contentSchemaVersion),
    contentSchemaVersion,
    contentHash: row.content_hash,
    sourceDraftRevision:
      row.source_draft_revision == null ? null : Number(row.source_draft_revision),
    publishedAt: date(row.published_at),
  };
}

function mapWorkspaceInvitation(row: QueryResultRow): WorkspaceInvitationRecord {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    email: String(row.email),
    role: row.role,
    tokenHash: String(row.token_hash),
    invitedBy: String(row.invited_by),
    expiresAt: date(row.expires_at),
    acceptedAt: row.accepted_at ? date(row.accepted_at) : null,
    revokedAt: row.revoked_at ? date(row.revoked_at) : null,
    createdAt: date(row.created_at),
  };
}

function defaultInstitutionPolicy(workspaceId: string): InstitutionPolicyRecord {
  return {
    workspaceId,
    contractStatus: "disabled",
    identityRequirement: "guest",
    capabilities: {
      oidc: false,
      managedSso: false,
      scim: false,
      lti: false,
      nrps: false,
      ags: false,
      auditExports: false,
      residencyControls: false,
    },
    k12Enabled: false,
    updatedAt: null,
  };
}

function mapInstitutionPolicy(row: QueryResultRow): InstitutionPolicyRecord {
  return {
    workspaceId: String(row.workspace_id),
    contractStatus: row.contract_status,
    identityRequirement: row.identity_requirement,
    capabilities: {
      oidc: Boolean(row.oidc_enabled),
      managedSso: Boolean(row.managed_sso_enabled),
      scim: Boolean(row.scim_enabled),
      lti: Boolean(row.lti_enabled),
      nrps: Boolean(row.nrps_enabled),
      ags: Boolean(row.ags_enabled),
      auditExports: Boolean(row.audit_exports_enabled),
      residencyControls: Boolean(row.residency_controls_enabled),
    },
    k12Enabled: false,
    updatedAt: date(row.updated_at),
  };
}

function mapExternalIdentity(row: QueryResultRow): ExternalIdentityRecord {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    userId: String(row.user_id),
    provider: row.provider,
    issuer: String(row.issuer),
    subject: String(row.subject),
    emailHint: row.email_hint ? String(row.email_hint) : null,
    linkedAt: date(row.linked_at),
    lastUsedAt: row.last_used_at ? date(row.last_used_at) : null,
  };
}

function mapFederatedAuthTransaction(row: QueryResultRow): FederatedAuthTransactionRecord {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    userId: row.user_id ? String(row.user_id) : null,
    mode: row.mode,
    stateHash: String(row.state_hash),
    codeVerifier: String(row.code_verifier),
    nonce: String(row.nonce),
    expiresAt: date(row.expires_at),
    createdAt: date(row.created_at),
  };
}

function mapLtiRegistration(row: QueryResultRow): LtiRegistrationRecord {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    name: String(row.name),
    issuer: String(row.issuer),
    clientId: String(row.client_id),
    deploymentId: String(row.deployment_id),
    authorizationEndpoint: String(row.authorization_endpoint),
    tokenEndpoint: row.token_endpoint ? String(row.token_endpoint) : null,
    jwksUrl: String(row.jwks_url),
    deepLinkReturnOrigins: Array.isArray(row.deep_link_return_origins)
      ? row.deep_link_return_origins.map(String)
      : [],
    status: row.status,
    createdAt: date(row.created_at),
    updatedAt: date(row.updated_at),
  };
}

function mapLtiLoginTransaction(row: QueryResultRow): LtiLoginTransactionRecord {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    registrationId: String(row.registration_id),
    stateHash: String(row.state_hash),
    nonce: String(row.nonce),
    targetLinkUri: String(row.target_link_uri),
    ltiMessageHint: row.lti_message_hint ? String(row.lti_message_hint) : null,
    expiresAt: date(row.expires_at),
    createdAt: date(row.created_at),
  };
}

function mapLtiLaunch(row: QueryResultRow): LtiLaunchRecord {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    registrationId: String(row.registration_id),
    creatorUserId: row.creator_user_id ? String(row.creator_user_id) : null,
    subject: row.subject ? String(row.subject) : null,
    messageType: row.message_type,
    role: row.role,
    targetLinkUri: String(row.target_link_uri),
    quizId: row.quiz_id ? String(row.quiz_id) : null,
    contextId: row.context_id ? String(row.context_id) : null,
    resourceLinkId: row.resource_link_id ? String(row.resource_link_id) : null,
    deepLinkReturnUrl: row.deep_link_return_url ? String(row.deep_link_return_url) : null,
    deepLinkData: row.deep_link_data ? String(row.deep_link_data) : null,
    linkTokenHash: row.link_token_hash ? String(row.link_token_hash) : null,
    responseJwt: row.response_jwt ? String(row.response_jwt) : null,
    completedAt: row.completed_at ? date(row.completed_at) : null,
    expiresAt: date(row.expires_at),
    createdAt: date(row.created_at),
  };
}

function mapSession(row: QueryResultRow): StoredSession {
  const state = upgradeGameState(row.state_snapshot as GameState);
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    quizVersionId: row.quiz_version_id,
    hostId: row.host_id,
    hostTokenHash: row.host_token_hash,
    trustMode: TrustModeSchema.parse(row.trust_mode ?? state.settings.trustMode ?? "learning"),
    decisionReplayEnabled: row.decision_replay_enabled === true,
    state,
    expiresAt: date(row.expires_at),
    retentionExpiresAt: date(row.retention_expires_at),
    createdAt: date(row.created_at),
    updatedAt: date(row.updated_at),
  };
}

function mapAnswer(row: QueryResultRow): EngineAnswer {
  return {
    answerId: row.id,
    participantId: row.participant_id,
    roundId: row.round_id,
    response: ResponsePayloadSchema.parse(row.response_payload),
    confidence: row.confidence,
    choiceId: row.choice_id,
    acceptedAtMs: date(row.accepted_at).getTime(),
    responseMs: row.response_ms,
    score: row.score,
    correct: row.correct,
    idempotencyKey: row.idempotency_key,
  };
}

function mapMediaAsset(row: QueryResultRow): MediaAssetRecord {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    objectKey: row.object_key,
    mimeType: row.mime_type,
    sizeBytes: Number(row.size_bytes),
    scanStatus: row.scan_status,
    altText: row.alt_text,
    createdAt: date(row.created_at),
    deletionStartedAt: row.deletion_started_at ? date(row.deletion_started_at) : null,
    finalizedAt: row.finalized_at ? date(row.finalized_at) : null,
  };
}

function mapWorkspaceMediaDeletionJob(row: QueryResultRow): WorkspaceMediaDeletionJobRecord {
  return {
    workspaceId: String(row.workspace_id),
    deletionStartedAt: date(row.deletion_started_at),
    sweepAfter: date(row.sweep_after),
  };
}

function mapMediaReference(row: QueryResultRow): MediaReferenceRecord {
  return {
    workspaceId: String(row.workspace_id),
    mediaId: String(row.media_id),
    ownerType: row.owner_type,
    ownerId: String(row.owner_id),
    createdAt: date(row.created_at),
  };
}

function mapOperationalFeatures(row: QueryResultRow | undefined): OperationalFeaturesRecord {
  return row
    ? {
        signups: row.signups_enabled,
        sessionCreation: row.session_creation_enabled,
        mediaUploads: row.media_uploads_enabled,
        roundExperiences: row.round_experiences_enabled,
        audiencePulse: row.audience_pulse_enabled,
        roomChat: row.room_chat_enabled,
        updatedAt: date(row.updated_at),
      }
    : {
        signups: true,
        sessionCreation: true,
        mediaUploads: true,
        roundExperiences: true,
        audiencePulse: true,
        roomChat: true,
        updatedAt: null,
      };
}

function mapSessionStaff(row: QueryResultRow): SessionStaffCredentialRecord {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    sessionId: String(row.session_id),
    role: row.role,
    purpose: row.purpose ?? "collaboration",
    label: String(row.label),
    tokenHash: String(row.token_hash),
    embedPolicyKeyHash: row.embed_policy_key_hash ? String(row.embed_policy_key_hash) : null,
    embedAllowedOrigins: Array.isArray(row.embed_allowed_origins)
      ? row.embed_allowed_origins.map(String)
      : [],
    createdBy: String(row.created_by),
    expiresAt: date(row.expires_at),
    revokedAt: row.revoked_at ? date(row.revoked_at) : null,
    createdAt: date(row.created_at),
  };
}

function sessionHistoryStatus(
  state: GameState,
  expiresAt: Date,
  now: Date,
): SessionHistoryRecord["status"] {
  if (state.phase === "finished") return "finished";
  return expiresAt <= now ? "expired" : "active";
}

function sessionQuestionPosition(state: GameState) {
  if (state.questionIndex === null) return null;
  const index =
    state.roundKind === "main"
      ? state.questionIndex
      : state.sourceRoundId
        ? (state.rounds[state.sourceRoundId]?.position ?? state.questionIndex)
        : state.questionIndex;
  return state.quiz.questions
    .slice(0, index + 1)
    .filter((question) => questionDelivery(question) === "main").length;
}

function mapStoredReport(row: QueryResultRow): Report {
  return ReportSchema.parse({
    ...(row.metrics as Report),
    status: row.status,
    generatedAt: row.generated_at ? date(row.generated_at).toISOString() : null,
    expiresAt: date(row.retention_expires_at).toISOString(),
  });
}

function normalizeAccountExportReport(metrics: unknown, sourceTrustMode: unknown): Report {
  if (!metrics || typeof metrics !== "object" || Array.isArray(metrics)) {
    return ReportSchema.parse(metrics);
  }
  const rawReport = metrics as Record<string, unknown>;
  const sourceTrust = TrustModeSchema.safeParse(sourceTrustMode);
  const storedTrust = TrustModeSchema.safeParse(rawReport.trustMode);
  return ReportSchema.parse({
    ...rawReport,
    trustMode: sourceTrust.success
      ? sourceTrust.data
      : storedTrust.success
        ? storedTrust.data
        : "learning",
  });
}

function mapReportHistory(row: QueryResultRow): ReportHistoryRecord {
  const report = mapStoredReport(row);
  const recovery = "recovery" in report ? report.recovery : [];
  const recovered = recovery.reduce((total, item) => total + item.recovered, 0);
  const eligible = recovery.reduce((total, item) => total + item.initiallyIncorrectWithBoth, 0);
  return {
    id: report.id,
    sessionId: report.sessionId,
    trustMode: report.trustMode ?? "learning",
    quizId: String(row.quiz_id),
    title: String(row.quiz_title),
    status: report.status,
    participantCount: report.metrics.participantCount,
    initialAccuracyPercent:
      "initialAccuracy" in report ? report.initialAccuracy.percent : report.metrics.accuracyPercent,
    recovery: {
      recovered,
      eligible,
      percent:
        eligible > 0 ? Math.min(100, Math.round((recovered / eligible) * 10_000) / 100) : null,
    },
    unresolvedConceptCount:
      "unresolvedConcepts" in report
        ? report.unresolvedConcepts.filter((concept) => concept.unresolved > 0).length
        : 0,
    interventionCount: "interventions" in report ? report.interventions.length : 0,
    followupId: row.followup_id ? String(row.followup_id) : null,
    followupStatus: row.followup_status ?? null,
    generatedAt: report.generatedAt ? new Date(report.generatedAt) : null,
    createdAt: date(row.created_at),
    cursorCreatedAt: row.cursor_created_at ? String(row.cursor_created_at) : undefined,
    expiresAt: date(row.retention_expires_at),
  };
}

function mapFollowupHistory(row: QueryResultRow, now: Date): FollowupHistoryRecord {
  const opensAt = date(row.opens_at);
  const closesAt = date(row.closes_at);
  const expiresAt = date(row.expires_at);
  const closedAt = row.closed_at ? date(row.closed_at) : null;
  const status: FollowupHistoryRecord["status"] =
    expiresAt <= now
      ? "expired"
      : closedAt || closesAt <= now
        ? "closed"
        : opensAt > now
          ? "scheduled"
          : "open";
  const content = row.content as QuizDraft;
  const source =
    row.purpose === "assignment"
      ? ({
          purpose: "assignment" as const,
          sourceSessionId: null,
          sourceReportId: null,
        } as const)
      : ({
          purpose: "recovery" as const,
          sourceSessionId: String(row.source_session_id),
          sourceReportId: String(row.source_report_id),
        } as const);
  return {
    id: String(row.id),
    ...source,
    quizId: row.quiz_id ? String(row.quiz_id) : null,
    sourceQuizVersionId: row.source_quiz_version_id ? String(row.source_quiz_version_id) : null,
    recoveryPackSource: row.recovery_pack_source
      ? RecoveryPackPracticeSourceSchema.parse(row.recovery_pack_source)
      : null,
    trustMode: TrustModeSchema.parse(row.trust_mode ?? "learning"),
    title: String(row.title),
    status,
    conceptKeys: Array.isArray(row.concept_keys) ? row.concept_keys.map(String) : [],
    checkpointCount: content.questions.length,
    attemptCount: Number(row.attempt_count ?? 0),
    completedAttemptCount: Number(row.completed_attempt_count ?? 0),
    opensAt,
    closesAt,
    expiresAt,
    createdAt: date(row.created_at),
    cursorCreatedAt: row.cursor_created_at ? String(row.cursor_created_at) : undefined,
  } as FollowupHistoryRecord;
}

function mapFollowup(row: QueryResultRow): FollowupRecord {
  const source =
    row.purpose === "assignment"
      ? ({
          purpose: "assignment" as const,
          sourceSessionId: null,
          sourceReportId: null,
        } as const)
      : ({
          purpose: "recovery" as const,
          sourceSessionId: String(row.source_session_id),
          sourceReportId: String(row.source_report_id),
        } as const);
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    trustMode: TrustModeSchema.parse(row.trust_mode ?? "learning"),
    sourceQuizVersionId: row.source_quiz_version_id ? String(row.source_quiz_version_id) : null,
    recoveryPackSource: row.recovery_pack_source
      ? RecoveryPackPracticeSourceSchema.parse(row.recovery_pack_source)
      : null,
    creationMutation: row.creation_mutation_id
      ? {
          mutationId: String(row.creation_mutation_id),
          requestHash: String(row.creation_request_hash),
        }
      : null,
    recoveryPackSequence: row.recovery_pack_sequence
      ? RecoveryPackPracticeSequenceSchema.parse(row.recovery_pack_sequence)
      : null,
    ...source,
    title: String(row.title),
    content: row.content as QuizDraft,
    conceptKeys: Array.isArray(row.concept_keys) ? row.concept_keys.map(String) : [],
    timeMode: row.time_mode,
    genericTokenHash: String(row.generic_token_hash),
    opensAt: date(row.opens_at),
    closesAt: date(row.closes_at),
    expiresAt: date(row.expires_at),
    closedAt: row.closed_at ? date(row.closed_at) : null,
    createdBy: row.created_by ? String(row.created_by) : null,
    createdAt: date(row.created_at),
  } as FollowupRecord;
}

function mapFollowupAccess(row: QueryResultRow): FollowupAccessRecord {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    followupId: String(row.followup_id),
    sourceParticipantId: row.source_participant_id ? String(row.source_participant_id) : null,
    kind: row.kind,
    label: String(row.label),
    tokenHash: String(row.token_hash),
    timeMultiplier: Number(row.time_multiplier) as FollowupAccessRecord["timeMultiplier"],
    expiresAt: date(row.expires_at),
    revokedAt: row.revoked_at ? date(row.revoked_at) : null,
    createdAt: date(row.created_at),
  };
}

function mapFollowupAttempt(row: QueryResultRow): FollowupAttemptRecord {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    followupId: String(row.followup_id),
    accessTokenId: row.access_token_id ? String(row.access_token_id) : null,
    sourceParticipantId: row.source_participant_id ? String(row.source_participant_id) : null,
    attemptTokenHash: String(row.attempt_token_hash),
    status: row.status,
    phase: row.phase,
    interventionIndex:
      row.intervention_index === null || row.intervention_index === undefined
        ? null
        : Number(row.intervention_index),
    advanceReceipts: row.advance_receipts ?? {},
    currentIndex: Number(row.current_index),
    version: Number(row.version),
    timeMultiplier: Number(row.time_multiplier) as FollowupAttemptRecord["timeMultiplier"],
    questionOpenedAt: date(row.question_opened_at),
    deadlineAt: row.deadline_at ? date(row.deadline_at) : null,
    completedAt: row.completed_at ? date(row.completed_at) : null,
    createdAt: date(row.created_at),
    updatedAt: date(row.updated_at),
  };
}

function mapFollowupAnswer(row: QueryResultRow): FollowupAnswerRecord {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    followupId: String(row.followup_id),
    attemptId: String(row.attempt_id),
    checkpointId: String(row.checkpoint_id),
    response: ResponsePayloadSchema.parse(row.response_payload),
    confidence: row.confidence === null ? null : (Number(row.confidence) as 1 | 2 | 3),
    correct: row.correct === null ? null : Boolean(row.correct),
    idempotencyKey: String(row.idempotency_key),
    submittedVersion:
      row.submitted_version === null || row.submitted_version === undefined
        ? null
        : Number(row.submitted_version),
    acceptedAt: date(row.accepted_at),
  };
}

function mapAuthoringJob(row: QueryResultRow): AuthoringJobRecord {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    createdBy: row.created_by ? String(row.created_by) : null,
    sourceType: row.source_type,
    sourceName: String(row.source_name),
    sourceMimeType: row.source_mime_type ? String(row.source_mime_type) : null,
    sourceText: row.source_text === null ? null : String(row.source_text),
    sourceBlob: row.source_blob ? Buffer.from(row.source_blob) : null,
    sourceDigest: String(row.source_digest),
    status: row.status,
    attempts: Number(row.attempts),
    appliedQuizId: row.applied_quiz_id ? String(row.applied_quiz_id) : null,
    availableAt: date(row.available_at),
    output: (row.output as AuthoringJobRecord["output"] | null) ?? null,
    lastError: row.last_error ? String(row.last_error) : null,
    expiresAt: date(row.expires_at),
    createdAt: date(row.created_at),
    updatedAt: date(row.updated_at),
  };
}

function mapQnaSettings(row: QueryResultRow): QnaSettingsRecord {
  return {
    workspaceId: String(row.workspace_id),
    sessionId: String(row.session_id),
    enabled: Boolean(row.enabled),
    displayMode: row.display_mode,
    moderationMode: row.moderation_mode,
    participantReplies: Boolean(row.participant_replies),
    updatedAt: date(row.updated_at),
  };
}

function mapQnaQuestion(row: QueryResultRow): QnaQuestionRecord {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    sessionId: String(row.session_id),
    participantId: String(row.participant_id),
    body: String(row.body),
    publicAlias: String(row.public_alias),
    status: row.status,
    label: row.label,
    voteCount: Number(row.vote_count ?? 0),
    votedByViewer: Boolean(row.voted_by_viewer),
    createdAt: date(row.created_at),
    updatedAt: date(row.updated_at),
  };
}

function mapQnaReply(row: QueryResultRow): QnaReplyRecord {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    sessionId: String(row.session_id),
    questionId: String(row.question_id),
    participantId: row.participant_id,
    actorId: row.actor_id,
    staffCredentialId: row.staff_credential_id,
    body: String(row.body),
    publicAlias: String(row.public_alias),
    status: row.status,
    createdAt: date(row.created_at),
    updatedAt: date(row.updated_at),
  };
}

function mapInteractionSettings(row: QueryResultRow): InteractionSettingsRecord {
  return {
    workspaceId: String(row.workspace_id),
    sessionId: String(row.session_id),
    signalsEnabled: Boolean(row.signals_enabled),
    chatEnabled: Boolean(row.chat_enabled),
    chatIdentityMode: row.chat_identity_mode,
    slowModeSeconds: Number(row.slow_mode_seconds) as 0 | 5 | 15 | 30,
    presenterFeedMode: row.presenter_feed_mode,
    audienceSeq: Number(row.audience_seq),
    closedAt: row.closed_at ? date(row.closed_at) : null,
    updatedAt: date(row.updated_at),
  };
}

function mapParticipantSignal(row: QueryResultRow): ParticipantSignalRecord {
  return {
    workspaceId: String(row.workspace_id),
    sessionId: String(row.session_id),
    contextKey: String(row.context_key),
    participantId: String(row.participant_id),
    signal: row.signal,
    updatedAt: date(row.updated_at),
  };
}

function mapChatMessage(row: QueryResultRow): ChatMessageRecord {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    sessionId: String(row.session_id),
    participantId: row.participant_id,
    actorId: row.actor_id,
    staffCredentialId: row.staff_credential_id,
    replyToId: row.reply_to_id,
    body: String(row.body),
    authorAlias: String(row.author_alias),
    identityModeAtCreation: row.identity_mode_at_creation,
    status: row.status,
    pinned: Boolean(row.pinned),
    idempotencyKey: String(row.idempotency_key),
    audienceSeq: Number(row.audience_seq),
    createdAt: date(row.created_at),
    updatedAt: date(row.updated_at),
  };
}

function mapChatReaction(row: QueryResultRow): ChatReactionRecord {
  return {
    workspaceId: String(row.workspace_id),
    sessionId: String(row.session_id),
    messageId: String(row.message_id),
    participantId: String(row.participant_id),
    reaction: row.reaction,
    updatedAt: date(row.updated_at),
  };
}

function mapAudienceRestriction(row: QueryResultRow): AudienceRestrictionRecord {
  return {
    workspaceId: String(row.workspace_id),
    sessionId: String(row.session_id),
    participantId: String(row.participant_id),
    mutedUntil: row.muted_until ? date(row.muted_until) : null,
    bannedAt: row.banned_at ? date(row.banned_at) : null,
    actorId: row.actor_id,
    staffCredentialId: row.staff_credential_id,
    updatedAt: date(row.updated_at),
  };
}

function mapAudienceOutbox(row: QueryResultRow): AudienceOutboxRecord {
  return {
    eventId: String(row.event_id),
    workspaceId: String(row.workspace_id),
    sessionId: String(row.session_id),
    audienceSeq: Number(row.audience_seq),
    type: String(row.event_type),
    idempotencyKey: String(row.idempotency_key),
    payload: (row.payload ?? {}) as Record<string, unknown>,
    attempts: Number(row.attempts),
    claimedAt: row.claimed_at ? date(row.claimed_at) : null,
    deliveredAt: row.delivered_at ? date(row.delivered_at) : null,
    createdAt: date(row.created_at),
  };
}

function mapLiveRoomCode(row: QueryResultRow): LiveRoomCodeRecord {
  return {
    code: String(row.code),
    workspaceId: String(row.workspace_id),
    artifactType: row.artifact_type,
    artifactId: String(row.artifact_id),
    expiresAt: date(row.expires_at),
    releasedAt: row.released_at ? date(row.released_at) : null,
    createdAt: date(row.created_at),
  };
}

export class PostgresRepository implements Repository {
  readonly pool: Pool;
  private readonly migrationsDirectory: string;

  constructor(connectionString: string, options: { migrationsDirectory?: string } = {}) {
    this.pool = new Pool({ connectionString, max: 15, statement_timeout: 10_000 });
    const here = dirname(fileURLToPath(import.meta.url));
    const legacyMigrationFile = process.env.OPENROUND_MIGRATION_FILE;
    this.migrationsDirectory =
      options.migrationsDirectory ??
      process.env.OPENROUND_MIGRATIONS_DIR ??
      (legacyMigrationFile ? dirname(legacyMigrationFile) : join(here, "../migrations"));
  }

  async initialize() {
    await this.pool.query("SELECT 1");
  }

  async inspectRuntimeDatabasePrincipal(): Promise<RuntimeDatabasePrincipalSecurity> {
    const result = await this.pool.query<RuntimeDatabasePrincipalRow>(runtimeDatabasePrincipalSql);
    return mapRuntimeDatabasePrincipal(result.rows[0]);
  }

  async migrate() {
    await runMigrations(this.pool, this.migrationsDirectory);
  }

  async close() {
    await this.pool.end();
  }

  async getOperationalFeatures() {
    const result = await this.systemQuery("SELECT * FROM operational_settings WHERE id = 'global'");
    return mapOperationalFeatures(result.rows[0]);
  }

  async updateOperationalFeatures(input: OperationalFeaturesUpdate, requestId: string) {
    return this.transaction(
      async (client) => {
        const beforeResult = await client.query(
          "SELECT * FROM operational_settings WHERE id = 'global' FOR UPDATE",
        );
        const before = mapOperationalFeatures(beforeResult.rows[0]);
        const updatedAt = new Date();
        const result = await client.query(
          `INSERT INTO operational_settings
             (id, signups_enabled, session_creation_enabled, media_uploads_enabled,
              round_experiences_enabled, audience_pulse_enabled, room_chat_enabled, updated_at)
           VALUES ('global', COALESCE($1::boolean, true), COALESCE($2::boolean, true),
                   COALESCE($3::boolean, true), COALESCE($4::boolean, true),
                   COALESCE($5::boolean, true), COALESCE($6::boolean, true), $7)
           ON CONFLICT (id) DO UPDATE SET
             signups_enabled = COALESCE($1::boolean, operational_settings.signups_enabled),
             session_creation_enabled = COALESCE(
               $2::boolean, operational_settings.session_creation_enabled
             ),
             media_uploads_enabled = COALESCE(
               $3::boolean, operational_settings.media_uploads_enabled
             ),
             round_experiences_enabled = COALESCE(
               $4::boolean, operational_settings.round_experiences_enabled
             ),
             audience_pulse_enabled = COALESCE(
               $5::boolean, operational_settings.audience_pulse_enabled
             ),
             room_chat_enabled = COALESCE($6::boolean, operational_settings.room_chat_enabled),
             updated_at = $7
           RETURNING *`,
          [
            input.signups ?? null,
            input.sessionCreation ?? null,
            input.mediaUploads ?? null,
            input.roundExperiences ?? null,
            input.audiencePulse ?? null,
            input.roomChat ?? null,
            updatedAt,
          ],
        );
        const after = mapOperationalFeatures(result.rows[0]);
        await client.query(
          `INSERT INTO audit_events
             (id, workspace_id, actor_id, action, target_type, target_id, request_id, metadata)
           VALUES ($1, NULL, NULL, 'operations.features.update', 'operational_features',
                   'global', $2, $3)`,
          [randomUUID(), requestId, JSON.stringify({ before, after })],
        );
        return after;
      },
      { system: true },
    );
  }

  private async transaction<T>(
    work: (client: PoolClient) => Promise<T>,
    access: { workspaceId?: string; system?: boolean } = {},
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      if (access.system) {
        await client.query("SELECT set_config('app.system_access', 'on', true)");
      } else if (access.workspaceId) {
        await client.query("SELECT set_config('app.workspace_id', $1, true)", [access.workspaceId]);
      }
      const result = await work(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  private async workspaceQuery(workspaceId: string, sql: string, values: unknown[] = []) {
    return this.transaction((client) => client.query(sql, values), { workspaceId });
  }

  private async systemQuery(sql: string, values: unknown[] = []) {
    return this.transaction((client) => client.query(sql, values), { system: true });
  }

  private async lockInteractionSettings(
    client: PoolClient,
    workspaceId: string,
    sessionId: string,
  ) {
    const result = await client.query(
      `SELECT * FROM session_interaction_settings
       WHERE workspace_id = $1 AND session_id = $2 FOR UPDATE`,
      [workspaceId, sessionId],
    );
    if (!result.rows[0]) {
      throw new AudienceStoreError("NOT_FOUND", "Audience interaction settings were not found");
    }
    const settings = mapInteractionSettings(result.rows[0]);
    if (settings.closedAt) {
      throw new AudienceStoreError(
        "CONFLICT",
        "Audience interactions are closed because this live round has finished",
      );
    }
    return settings;
  }

  private async existingAudienceEvent(
    client: PoolClient,
    sessionId: string,
    idempotencyKey: string,
  ) {
    const result = await client.query(
      `SELECT * FROM audience_outbox WHERE session_id = $1 AND idempotency_key = $2`,
      [sessionId, idempotencyKey],
    );
    return result.rows[0] ? mapAudienceOutbox(result.rows[0]) : null;
  }

  private async appendAudienceEventLocked(
    client: PoolClient,
    workspaceId: string,
    sessionId: string,
    event: AudienceEventInput,
    createdAt: Date,
  ) {
    const sequence = await client.query(
      `UPDATE session_interaction_settings SET audience_seq = audience_seq + 1
       WHERE workspace_id = $1 AND session_id = $2 RETURNING audience_seq`,
      [workspaceId, sessionId],
    );
    if (!sequence.rows[0]) {
      throw new AudienceStoreError("NOT_FOUND", "Audience interaction settings were not found");
    }
    const inserted = await client.query(
      `INSERT INTO audience_outbox
         (event_id, workspace_id, session_id, audience_seq, event_type, idempotency_key,
          payload, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [
        event.eventId,
        workspaceId,
        sessionId,
        Number(sequence.rows[0].audience_seq),
        event.type,
        event.idempotencyKey,
        JSON.stringify(event.payload),
        createdAt,
      ],
    );
    return mapAudienceOutbox(inserted.rows[0]!);
  }

  private async chatReactionSummary(
    client: PoolClient,
    messageId: string,
    participantId: string,
  ): Promise<ChatReactionSummaryRecord> {
    const result = await client.query(
      `SELECT reaction, count(*)::integer AS count,
              bool_or(participant_id = $2::uuid) AS selected_by_viewer
       FROM chat_message_reactions WHERE message_id = $1 GROUP BY reaction`,
      [messageId, participantId],
    );
    const counts: ChatReactionSummaryRecord["counts"] = {};
    let viewerReaction: ChatReactionSummaryRecord["viewerReaction"] = null;
    for (const row of result.rows) {
      const reaction = row.reaction as ChatReactionRecord["reaction"];
      counts[reaction] = Number(row.count);
      if (row.selected_by_viewer) viewerReaction = reaction;
    }
    return { messageId, counts, viewerReaction };
  }

  private async syncSessionEvidence(client: PoolClient, session: StoredSession) {
    const rounds = Object.entries(session.state.rounds);
    for (const [id, round] of rounds) {
      const question = session.state.quiz.questions[round.position];
      const openedAtMs = round.openedAtMs > 0 ? round.openedAtMs : session.createdAt.getTime();
      const deadlineMs =
        round.deadlineMs === null
          ? null
          : round.deadlineMs > openedAtMs
            ? round.deadlineMs
            : openedAtMs + (question?.timeLimitSeconds ?? 20) * 1_000;
      await client.query(
        `INSERT INTO question_rounds
           (id, session_id, question_id, position, opened_at, deadline, locked_at, round_kind)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (id) DO UPDATE SET
           question_id = EXCLUDED.question_id,
           position = EXCLUDED.position,
           opened_at = EXCLUDED.opened_at,
           deadline = EXCLUDED.deadline,
           locked_at = EXCLUDED.locked_at,
           round_kind = EXCLUDED.round_kind`,
        [
          id,
          session.id,
          round.questionId,
          round.position,
          new Date(openedAtMs),
          deadlineMs === null ? null : new Date(deadlineMs),
          round.lockedAtMs === null ? null : new Date(round.lockedAtMs),
          round.kind,
        ],
      );
    }

    for (const [id, round] of rounds) {
      await client.query("UPDATE question_rounds SET source_round_id = $2 WHERE id = $1", [
        id,
        round.sourceRoundId,
      ]);
    }

    for (const intervention of Object.values(session.state.interventions)) {
      const linkedRecheckRoundId = rounds.find(
        ([, round]) => round.interventionId === intervention.id && round.kind !== "main",
      )?.[0];
      await client.query(
        `INSERT INTO session_interventions
           (id, workspace_id, session_id, source_round_id, facilitator_id, kind, status,
            linked_recheck_round_id, started_at, finished_at, recovery_pack_card)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb)
         ON CONFLICT (id) DO UPDATE SET
           status = EXCLUDED.status,
           linked_recheck_round_id = EXCLUDED.linked_recheck_round_id,
           finished_at = EXCLUDED.finished_at`,
        [
          intervention.id,
          session.workspaceId,
          session.id,
          intervention.sourceRoundId,
          session.hostId,
          intervention.type,
          intervention.finishedAtMs === null ? "active" : "finished",
          linkedRecheckRoundId ?? null,
          new Date(intervention.startedAtMs),
          intervention.finishedAtMs === null ? null : new Date(intervention.finishedAtMs),
          intervention.recoveryPackCard
            ? JSON.stringify(RecoveryPackCardReferenceSchema.parse(intervention.recoveryPackCard))
            : null,
        ],
      );
    }

    for (const [id, round] of rounds) {
      await client.query("UPDATE question_rounds SET intervention_id = $2 WHERE id = $1", [
        id,
        round.interventionId,
      ]);
    }
  }

  async createMagicToken(input: MagicTokenRecord) {
    await this.systemQuery(
      `INSERT INTO auth_magic_tokens (id, email, segment, token_hash, policy_version, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [input.id, input.email, input.segment, input.tokenHash, input.policyVersion, input.expiresAt],
    );
  }

  async consumeMagicToken(tokenHash: string, now: Date): Promise<CreatorContext | null> {
    return this.transaction(
      async (client) => {
        const tokenResult = await client.query(
          `UPDATE auth_magic_tokens SET consumed_at = $2
         WHERE token_hash = $1 AND consumed_at IS NULL AND expires_at > $2
         RETURNING email, segment, policy_version`,
          [tokenHash, now],
        );
        const token = tokenResult.rows[0] as
          { email: string; segment: Segment; policy_version: string } | undefined;
        if (!token) return null;

        let userResult = await client.query(
          "SELECT id, email FROM users WHERE email = $1 AND deleted_at IS NULL",
          [token.email],
        );
        let user = userResult.rows[0] as { id: string; email: string } | undefined;
        if (!user) {
          user = { id: randomUUID(), email: token.email };
          await client.query("INSERT INTO users (id, email) VALUES ($1, $2)", [
            user.id,
            user.email,
          ]);
          const workspaceId = randomUUID();
          await client.query(
            `INSERT INTO workspaces (id, name, segment, owner_id, retention_days)
           VALUES ($1, $2, $3, $4, 30)`,
            [workspaceId, `${token.email.split("@")[0]}'s workspace`, token.segment, user.id],
          );
          await client.query(
            "INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, 'owner')",
            [workspaceId, user.id],
          );
          await client.query("INSERT INTO subscriptions (workspace_id) VALUES ($1)", [workspaceId]);
        }

        userResult = await client.query(
          `SELECT u.id AS user_id, u.email, u.locale, u.locale_explicit,
                  w.id AS workspace_id, w.segment, wm.role,
                COALESCE(s.plan, 'free') AS plan
         FROM users u
         JOIN workspace_members wm ON wm.user_id = u.id
         JOIN workspaces w ON w.id = wm.workspace_id
         LEFT JOIN subscriptions s ON s.workspace_id = w.id
         WHERE u.id = $1 AND u.deleted_at IS NULL
         ORDER BY w.created_at LIMIT 1`,
          [user.id],
        );
        const row = userResult.rows[0];
        if (row) {
          for (const documentType of ["terms", "privacy"]) {
            await client.query(
              `INSERT INTO consent_records
                 (id, workspace_id, user_id, document_type, document_version, accepted_at)
               VALUES ($1, $2, $3, $4, $5, $6)
               ON CONFLICT (workspace_id, user_id, document_type, document_version) DO NOTHING`,
              [
                randomUUID(),
                row.workspace_id,
                row.user_id,
                documentType,
                token.policy_version,
                now,
              ],
            );
          }
        }
        return row
          ? {
              userId: row.user_id,
              workspaceId: row.workspace_id,
              email: row.email,
              locale: supportedLocale(row.locale),
              localePreferenceSet: Boolean(row.locale_explicit),
              segment: row.segment,
              role: row.role,
              plan: row.plan,
            }
          : null;
      },
      { system: true },
    );
  }

  async createCreatorSession(input: {
    id: string;
    userId: string;
    tokenHash: string;
    expiresAt: Date;
    activeWorkspaceId?: string;
  }) {
    await this.systemQuery(
      `INSERT INTO creator_sessions
         (id, user_id, token_hash, expires_at, active_workspace_id)
       VALUES ($1, $2, $3, $4, $5)`,
      [input.id, input.userId, input.tokenHash, input.expiresAt, input.activeWorkspaceId ?? null],
    );
  }

  async getCreatorBySession(tokenHash: string, now: Date): Promise<CreatorContext | null> {
    const result = await this.systemQuery(
      `SELECT u.id AS user_id, u.email, u.locale, u.locale_explicit,
              w.id AS workspace_id, w.segment, wm.role,
              COALESCE(s.plan, 'free') AS plan
       FROM creator_sessions cs
       JOIN users u ON u.id = cs.user_id
       JOIN workspace_members wm ON wm.user_id = u.id
         AND wm.workspace_id = COALESCE(
           cs.active_workspace_id,
           (SELECT first_membership.workspace_id
            FROM workspace_members AS first_membership
            JOIN workspaces AS first_workspace ON first_workspace.id = first_membership.workspace_id
            WHERE first_membership.user_id = u.id
            ORDER BY first_workspace.created_at, first_workspace.id
            LIMIT 1)
         )
       JOIN workspaces w ON w.id = wm.workspace_id
       LEFT JOIN subscriptions s ON s.workspace_id = w.id
       WHERE cs.token_hash = $1 AND cs.revoked_at IS NULL AND cs.expires_at > $2
         AND u.deleted_at IS NULL
       LIMIT 1`,
      [tokenHash, now],
    );
    const row = result.rows[0];
    return row
      ? {
          userId: row.user_id,
          workspaceId: row.workspace_id,
          email: row.email,
          locale: supportedLocale(row.locale),
          localePreferenceSet: Boolean(row.locale_explicit),
          segment: row.segment,
          role: row.role,
          plan: row.plan,
        }
      : null;
  }

  async updateUserLocale(userId: string, locale: SupportedLocale) {
    const result = await this.systemQuery(
      `UPDATE users SET locale = $2, locale_explicit = true
       WHERE id = $1 AND deleted_at IS NULL RETURNING locale`,
      [userId, locale],
    );
    return result.rows[0] ? supportedLocale(result.rows[0].locale) : null;
  }

  async listWorkspaces(userId: string): Promise<WorkspaceSummaryRecord[]> {
    const result = await this.systemQuery(
      `SELECT w.id, w.name, w.segment, w.home_region, wm.role
       FROM workspace_members AS wm
       JOIN workspaces AS w ON w.id = wm.workspace_id
       JOIN users AS u ON u.id = wm.user_id
       WHERE wm.user_id = $1 AND u.deleted_at IS NULL
       ORDER BY w.name, w.id`,
      [userId],
    );
    return result.rows.map((row) => ({
      id: String(row.id),
      name: String(row.name),
      segment: row.segment,
      role: row.role,
      homeRegion: String(row.home_region),
    }));
  }

  async setCreatorSessionWorkspace(tokenHash: string, userId: string, workspaceId: string) {
    const result = await this.systemQuery(
      `UPDATE creator_sessions AS session SET active_workspace_id = $3
       WHERE session.token_hash = $1 AND session.user_id = $2
         AND session.revoked_at IS NULL
         AND EXISTS (
           SELECT 1 FROM workspace_members
           WHERE workspace_id = $3 AND user_id = $2
         )
       RETURNING session.id`,
      [tokenHash, userId, workspaceId],
    );
    return result.rowCount === 1;
  }

  async listWorkspaceMembers(workspaceId: string): Promise<WorkspaceMemberRecord[]> {
    const result = await this.systemQuery(
      `SELECT member.user_id, users.email, member.role, member.created_at
       FROM workspace_members AS member
       JOIN users ON users.id = member.user_id
       WHERE member.workspace_id = $1 AND users.deleted_at IS NULL
       ORDER BY users.email, member.user_id`,
      [workspaceId],
    );
    return result.rows.map((row) => ({
      userId: String(row.user_id),
      email: String(row.email),
      role: row.role,
      joinedAt: row.created_at ? date(row.created_at) : null,
    }));
  }

  async updateWorkspaceMemberRole(workspaceId: string, userId: string, role: "editor" | "viewer") {
    const result = await this.systemQuery(
      `UPDATE workspace_members AS member SET role = $3
       FROM users
       WHERE member.workspace_id = $1 AND member.user_id = $2
         AND member.role <> 'owner' AND users.id = member.user_id
       RETURNING member.user_id, users.email, member.role, member.created_at`,
      [workspaceId, userId, role],
    );
    const row = result.rows[0];
    return row
      ? {
          userId: String(row.user_id),
          email: String(row.email),
          role: row.role,
          joinedAt: row.created_at ? date(row.created_at) : null,
        }
      : null;
  }

  async removeWorkspaceMember(workspaceId: string, userId: string) {
    return this.transaction(
      async (client) => {
        const removed = await client.query(
          `DELETE FROM workspace_members
           WHERE workspace_id = $1 AND user_id = $2 AND role <> 'owner'
           RETURNING user_id`,
          [workspaceId, userId],
        );
        if (removed.rowCount !== 1) return false;
        await client.query(
          `UPDATE creator_sessions SET active_workspace_id = (
             SELECT member.workspace_id FROM workspace_members AS member
             JOIN workspaces ON workspaces.id = member.workspace_id
             WHERE member.user_id = $2
             ORDER BY workspaces.created_at, workspaces.id LIMIT 1
           )
           WHERE user_id = $2 AND active_workspace_id = $1`,
          [workspaceId, userId],
        );
        return true;
      },
      { system: true },
    );
  }

  async createWorkspaceInvitation(input: WorkspaceInvitationRecord) {
    const result = await this.workspaceQuery(
      input.workspaceId,
      `INSERT INTO workspace_invitations
         (id, workspace_id, email, role, token_hash, invited_by, expires_at,
          accepted_at, revoked_at, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [
        input.id,
        input.workspaceId,
        input.email,
        input.role,
        input.tokenHash,
        input.invitedBy,
        input.expiresAt,
        input.acceptedAt,
        input.revokedAt,
        input.createdAt,
      ],
    );
    return mapWorkspaceInvitation(result.rows[0]!);
  }

  async listWorkspaceInvitations(workspaceId: string) {
    const result = await this.workspaceQuery(
      workspaceId,
      `SELECT * FROM workspace_invitations
       WHERE workspace_id = $1 ORDER BY created_at DESC, id DESC`,
      [workspaceId],
    );
    return result.rows.map(mapWorkspaceInvitation);
  }

  async revokeWorkspaceInvitation(workspaceId: string, invitationId: string) {
    const result = await this.workspaceQuery(
      workspaceId,
      `UPDATE workspace_invitations SET revoked_at = now()
       WHERE workspace_id = $1 AND id = $2 AND accepted_at IS NULL AND revoked_at IS NULL
       RETURNING id`,
      [workspaceId, invitationId],
    );
    return result.rowCount === 1;
  }

  async acceptWorkspaceInvitation(tokenHash: string, now: Date, policyVersion: string) {
    return this.transaction(
      async (client) => {
        const invitationResult = await client.query(
          `SELECT invitation.*, workspace.segment
           FROM workspace_invitations AS invitation
           JOIN workspaces AS workspace ON workspace.id = invitation.workspace_id
           WHERE invitation.token_hash = $1 AND invitation.accepted_at IS NULL
             AND invitation.revoked_at IS NULL AND invitation.expires_at > $2
           FOR UPDATE OF invitation`,
          [tokenHash, now],
        );
        const invitation = invitationResult.rows[0];
        if (!invitation) return null;

        let userResult = await client.query(
          "SELECT id, email FROM users WHERE lower(email) = lower($1) AND deleted_at IS NULL",
          [invitation.email],
        );
        let user = userResult.rows[0] as { id: string; email: string } | undefined;
        if (!user) {
          user = { id: randomUUID(), email: String(invitation.email) };
          await client.query("INSERT INTO users (id, email) VALUES ($1, $2)", [
            user.id,
            user.email,
          ]);
        }
        await client.query(
          `INSERT INTO workspace_members (workspace_id, user_id, role, created_at)
           VALUES ($1,$2,$3,$4)
           ON CONFLICT (workspace_id, user_id) DO NOTHING`,
          [invitation.workspace_id, user.id, invitation.role, now],
        );
        await client.query("UPDATE workspace_invitations SET accepted_at = $2 WHERE id = $1", [
          invitation.id,
          now,
        ]);
        for (const documentType of ["terms", "privacy"]) {
          await client.query(
            `INSERT INTO consent_records
               (id, workspace_id, user_id, document_type, document_version, accepted_at)
             VALUES ($1,$2,$3,$4,$5,$6)
             ON CONFLICT (workspace_id, user_id, document_type, document_version) DO NOTHING`,
            [randomUUID(), invitation.workspace_id, user.id, documentType, policyVersion, now],
          );
        }
        userResult = await client.query(
          `SELECT users.id AS user_id, users.email, users.locale, users.locale_explicit,
                  workspace.id AS workspace_id,
                  workspace.segment, member.role, COALESCE(subscription.plan, 'free') AS plan
           FROM users
           JOIN workspace_members AS member ON member.user_id = users.id
             AND member.workspace_id = $2
           JOIN workspaces AS workspace ON workspace.id = member.workspace_id
           LEFT JOIN subscriptions AS subscription ON subscription.workspace_id = workspace.id
           WHERE users.id = $1`,
          [user.id, invitation.workspace_id],
        );
        const row = userResult.rows[0];
        return row
          ? {
              userId: row.user_id,
              workspaceId: row.workspace_id,
              email: row.email,
              locale: supportedLocale(row.locale),
              localePreferenceSet: Boolean(row.locale_explicit),
              segment: row.segment,
              role: row.role,
              plan: row.plan,
            }
          : null;
      },
      { system: true },
    );
  }

  async revokeCreatorSession(tokenHash: string) {
    await this.systemQuery("UPDATE creator_sessions SET revoked_at = now() WHERE token_hash = $1", [
      tokenHash,
    ]);
  }

  async getCreatorByUserId(userId: string, workspaceId: string): Promise<CreatorContext | null> {
    const result = await this.systemQuery(
      `SELECT users.id AS user_id, users.email, users.locale, users.locale_explicit,
              workspace.id AS workspace_id,
              workspace.segment, member.role, COALESCE(subscription.plan, 'free') AS plan
       FROM users
       JOIN workspace_members AS member ON member.user_id = users.id
         AND member.workspace_id = $2
       JOIN workspaces AS workspace ON workspace.id = member.workspace_id
       LEFT JOIN subscriptions AS subscription ON subscription.workspace_id = workspace.id
       WHERE users.id = $1 AND users.deleted_at IS NULL`,
      [userId, workspaceId],
    );
    const row = result.rows[0];
    return row
      ? {
          userId: String(row.user_id),
          workspaceId: String(row.workspace_id),
          email: String(row.email),
          locale: supportedLocale(row.locale),
          localePreferenceSet: Boolean(row.locale_explicit),
          segment: row.segment,
          role: row.role,
          plan: row.plan,
        }
      : null;
  }

  async listQuizzes(workspaceId: string, includeArchived = false) {
    const result = await this.workspaceQuery(
      workspaceId,
      `SELECT quiz.*, hosted.last_hosted_at
       FROM quizzes AS quiz
       LEFT JOIN (
         SELECT version.quiz_id, max(session.created_at) AS last_hosted_at
         FROM quiz_versions AS version
         JOIN game_sessions AS session
           ON session.quiz_version_id = version.id
          AND session.workspace_id = $1
          AND session.deleted_at IS NULL
         WHERE version.workspace_id = $1
         GROUP BY version.quiz_id
       ) AS hosted ON hosted.quiz_id = quiz.id
       WHERE quiz.workspace_id = $1 AND ($2 OR quiz.status <> 'archived')
       ORDER BY quiz.updated_at DESC, quiz.id DESC`,
      [workspaceId, includeArchived],
    );
    return result.rows.map(mapQuizListRecord);
  }

  async listPublishedQuizQuestionMetadata(workspaceId: string, search = "", limit = 100) {
    const options = publishedQuestionCatalogOptions(search, limit);
    const result = await this.transaction(async (client) => {
      // Validate the entire current catalog before reading JSON, on the same snapshot as the
      // bounded metadata query so a concurrent publisher cannot introduce an unchecked version.
      await client.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
      await client.query("SELECT set_config('app.workspace_id', $1, true)", [workspaceId]);
      const versions = await client.query(
        `SELECT version.content_schema_version
         FROM quizzes AS quiz
         JOIN quiz_versions AS version
           ON version.id = quiz.current_version_id
          AND version.quiz_id = quiz.id AND version.workspace_id = $1
         WHERE quiz.workspace_id = $1 AND quiz.status <> 'archived'`,
        [workspaceId],
      );
      for (const version of versions.rows) {
        assertRoundContentSchemaVersion(version.content_schema_version);
      }
      return client.query(
        `SELECT version.id, version.quiz_id, version.version, version.content_hash,
              version.content ->> 'title' AS source_title, source.question
       FROM quizzes AS quiz
       JOIN quiz_versions AS version
         ON version.id = quiz.current_version_id
        AND version.quiz_id = quiz.id AND version.workspace_id = $1
       CROSS JOIN LATERAL jsonb_array_elements(version.content -> 'questions')
         WITH ORDINALITY AS source(question, ordinal)
       WHERE quiz.workspace_id = $1 AND quiz.status <> 'archived'
         AND source.question ->> 'mediaId' IS NULL
         AND COALESCE(source.question ->> 'delivery', 'main') = 'main'
         AND source.question ->> 'linkedRecheckQuestionId' IS NULL
         AND source.question ->> 'recoveryPackSource' IS NULL
         AND NOT EXISTS (
           SELECT 1 FROM jsonb_array_elements(version.content -> 'questions') AS related(question)
           WHERE related.question ->> 'linkedRecheckQuestionId' = source.question ->> 'id'
         )
         AND ($2 = '' OR strpos(lower(version.content ->> 'title'), lower($2)) > 0
              OR strpos(lower(source.question ->> 'prompt'), lower($2)) > 0)
       ORDER BY quiz.updated_at DESC, quiz.id DESC, source.ordinal
       LIMIT $3`,
        [workspaceId, options.search, options.limit + 1],
      );
    });
    const questions = result.rows.flatMap((row) => {
      const question = QuestionSchema.safeParse(row.question);
      if (!question.success || !publishedQuestionTextOnlyLiveEligible(question.data)) return [];
      return [
        publishedQuestionMetadata(
          {
            id: String(row.id),
            quizId: String(row.quiz_id),
            version: Number(row.version),
            contentHash: String(row.content_hash),
            content: { title: String(row.source_title) },
          },
          question.data,
        ),
      ];
    });
    return {
      questions: questions.slice(0, options.limit),
      hasMore: questions.length > options.limit,
    };
  }

  async listFolders(workspaceId: string) {
    const result = await this.workspaceQuery(
      workspaceId,
      "SELECT * FROM folders WHERE workspace_id = $1 ORDER BY lower(name), id",
      [workspaceId],
    );
    return result.rows.map(mapFolder);
  }

  async createFolder(input: FolderRecord) {
    const result = await this.workspaceQuery(
      input.workspaceId,
      `INSERT INTO folders (id, workspace_id, name, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [input.id, input.workspaceId, input.name, input.createdAt, input.updatedAt],
    );
    return mapFolder(result.rows[0]!);
  }

  async renameFolder(workspaceId: string, folderId: string, name: string) {
    const result = await this.workspaceQuery(
      workspaceId,
      `UPDATE folders SET name = $3, updated_at = now()
       WHERE workspace_id = $1 AND id = $2 RETURNING *`,
      [workspaceId, folderId, name],
    );
    return result.rows[0] ? mapFolder(result.rows[0]) : null;
  }

  async deleteFolder(workspaceId: string, folderId: string) {
    const result = await this.workspaceQuery(
      workspaceId,
      "DELETE FROM folders WHERE workspace_id = $1 AND id = $2",
      [workspaceId, folderId],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async organizeQuiz(workspaceId: string, quizId: string, folderId: string | null, tags: string[]) {
    const result = await this.workspaceQuery(
      workspaceId,
      `UPDATE quizzes SET folder_id = $3, tags = $4::text[], updated_at = now()
       WHERE workspace_id = $1 AND id = $2
         AND ($3::uuid IS NULL OR EXISTS (
           SELECT 1 FROM folders WHERE workspace_id = $1 AND id = $3
         ))
       RETURNING *`,
      [workspaceId, quizId, folderId, tags],
    );
    return result.rows[0] ? mapQuiz(result.rows[0]) : null;
  }

  async createQuiz(input: QuizRecord) {
    const draftSchemaVersion = input.draftSchemaVersion ?? ROUND_DRAFT_SCHEMA_VERSION;
    const draft = upcastRoundDraft(input.draft, draftSchemaVersion);
    return this.transaction(
      async (client) => {
        const result = await client.query(
          `INSERT INTO quizzes (
             id, workspace_id, title, description, status, draft, folder_id, tags,
             draft_revision, draft_schema_version, published_draft_revision, last_edited_by,
             created_at, updated_at
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::text[], $9, $10, $11, $12, $13, $14)
           RETURNING *`,
          [
            input.id,
            input.workspaceId,
            draft.title,
            draft.description,
            input.status,
            JSON.stringify(draft),
            input.folderId ?? null,
            input.tags ?? [],
            input.draftRevision ?? 0,
            draftSchemaVersion,
            input.publishedDraftRevision ?? null,
            input.lastEditedBy ?? null,
            input.createdAt,
            input.updatedAt,
          ],
        );
        await client.query(
          `INSERT INTO quiz_draft_history
             (id, workspace_id, quiz_id, revision, draft, draft_schema_version,
              saved_by, mutation_id, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, NULL, $8)
           ON CONFLICT (quiz_id, revision) DO NOTHING`,
          [
            randomUUID(),
            input.workspaceId,
            input.id,
            input.draftRevision ?? 0,
            JSON.stringify(draft),
            draftSchemaVersion,
            input.lastEditedBy ?? null,
            input.createdAt,
          ],
        );
        return mapQuiz(result.rows[0]!);
      },
      { workspaceId: input.workspaceId },
    );
  }

  async getQuiz(workspaceId: string, quizId: string) {
    const result = await this.workspaceQuery(
      workspaceId,
      "SELECT * FROM quizzes WHERE workspace_id = $1 AND id = $2",
      [workspaceId, quizId],
    );
    return result.rows[0] ? mapQuiz(result.rows[0]) : null;
  }

  async updateQuiz(
    workspaceId: string,
    quizId: string,
    draft: QuizDraft,
    expectedDraftRevision?: number,
    editorId?: string,
  ) {
    const normalizedDraft = upcastRoundDraft(draft, ROUND_DRAFT_SCHEMA_VERSION);
    return this.transaction(
      async (client) => {
        const current = await client.query(
          `SELECT status, draft_revision, last_edited_by
           FROM quizzes WHERE workspace_id = $1 AND id = $2 FOR UPDATE`,
          [workspaceId, quizId],
        );
        if (!current.rows[0] || current.rows[0].status === "archived") return null;
        const currentRevision = Number(current.rows[0].draft_revision);
        if (expectedDraftRevision !== undefined && expectedDraftRevision !== currentRevision) {
          throw new QuizDraftRevisionConflictError(
            quizId,
            expectedDraftRevision,
            currentRevision,
            current.rows[0].last_edited_by ? String(current.rows[0].last_edited_by) : null,
          );
        }
        const result = await client.query(
          `UPDATE quizzes SET title = $3, description = $4, draft = $5,
             draft_revision = draft_revision + 1, draft_schema_version = 1,
             last_edited_by = COALESCE($6::uuid, last_edited_by), updated_at = now()
           WHERE workspace_id = $1 AND id = $2 RETURNING *`,
          [
            workspaceId,
            quizId,
            normalizedDraft.title,
            normalizedDraft.description,
            JSON.stringify(normalizedDraft),
            editorId ?? null,
          ],
        );
        const quiz = mapQuiz(result.rows[0]!);
        await client.query(
          `INSERT INTO quiz_draft_history
             (id, workspace_id, quiz_id, revision, draft, draft_schema_version,
              saved_by, mutation_id, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, NULL, $8)`,
          [
            randomUUID(),
            workspaceId,
            quizId,
            quiz.draftRevision,
            JSON.stringify(normalizedDraft),
            ROUND_DRAFT_SCHEMA_VERSION,
            quiz.lastEditedBy ?? null,
            quiz.updatedAt,
          ],
        );
        await this.pruneQuizDraftHistory(client, workspaceId, quizId);
        return quiz;
      },
      { workspaceId },
    );
  }

  private async replayQuizDraftMutation(
    client: PoolClient,
    input: Pick<QuizDraftUpdate, "workspaceId" | "quizId">,
    receipt: QueryResultRow,
    currentRow?: QueryResultRow,
  ): Promise<QuizRecord | null> {
    const currentResult = currentRow
      ? null
      : await client.query("SELECT * FROM quizzes WHERE workspace_id = $1 AND id = $2", [
          input.workspaceId,
          input.quizId,
        ]);
    const row = currentRow ?? currentResult?.rows[0];
    if (!row) return null;
    const current = mapQuiz(row);
    const resultingRevision = Number(receipt.resulting_revision);
    if ((current.draftRevision ?? 0) === resultingRevision) return current;

    const history = await client.query(
      `SELECT * FROM quiz_draft_history
       WHERE workspace_id = $1 AND quiz_id = $2 AND revision = $3`,
      [input.workspaceId, input.quizId, resultingRevision],
    );
    if (history.rows[0]) {
      return quizAtDraftRevision(current, mapQuizDraftHistory(history.rows[0]));
    }
    throw new QuizDraftRevisionConflictError(
      input.quizId,
      resultingRevision,
      current.draftRevision ?? 0,
      current.lastEditedBy ?? null,
    );
  }

  async updateQuizDraft(input: QuizDraftUpdate) {
    const draft = upcastRoundDraft(input.draft, input.schemaVersion);
    if (
      input.recoveryPackUpdateSourceRevision !== undefined &&
      (!Number.isSafeInteger(input.recoveryPackUpdateSourceRevision) ||
        input.recoveryPackUpdateSourceRevision < 0 ||
        input.recoveryPackUpdateSourceRevision !== input.expectedRevision)
    ) {
      throw new QuizDraftMutationConflictError(input.mutationId);
    }
    return this.transaction(
      async (client) => {
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
          `${input.workspaceId}:${input.mutationId}`,
        ]);
        const prior = await client.query(
          `SELECT quiz_id, expected_revision, resulting_revision, draft_hash,
                  question_health_undo_application_id, recovery_pack_update_source_revision
           FROM quiz_draft_mutations WHERE workspace_id = $1 AND mutation_id = $2`,
          [input.workspaceId, input.mutationId],
        );
        if (prior.rows[0]) {
          const receipt = prior.rows[0];
          if (
            String(receipt.quiz_id) !== input.quizId ||
            Number(receipt.expected_revision) !== input.expectedRevision ||
            String(receipt.draft_hash) !== input.draftHash ||
            (receipt.question_health_undo_application_id == null
              ? null
              : String(receipt.question_health_undo_application_id)) !==
              (input.questionHealthUndo?.applicationId ?? null) ||
            (receipt.recovery_pack_update_source_revision == null
              ? null
              : Number(receipt.recovery_pack_update_source_revision)) !==
              (input.recoveryPackUpdateSourceRevision ?? null)
          ) {
            throw new QuizDraftMutationConflictError(input.mutationId);
          }
          if (input.questionHealthApplication) {
            const application = await client.query(
              `SELECT request_hash FROM question_health_applications
               WHERE workspace_id = $1 AND quiz_id = $2 AND application_id = $3`,
              [input.workspaceId, input.quizId, input.mutationId],
            );
            if (
              String(application.rows[0]?.request_hash ?? "").trim() !==
              input.questionHealthApplication.requestHash
            )
              throw new QuizDraftMutationConflictError(input.mutationId);
          }
          return this.replayQuizDraftMutation(client, input, receipt);
        }

        const current = await client.query(
          `SELECT * FROM quizzes WHERE workspace_id = $1 AND id = $2 FOR UPDATE`,
          [input.workspaceId, input.quizId],
        );
        if (!current.rows[0] || current.rows[0].status === "archived") return null;
        // A duplicate request may have committed while this transaction waited on
        // the Round row lock, so check the receipt again before evaluating CAS.
        const raced = await client.query(
          `SELECT quiz_id, expected_revision, resulting_revision, draft_hash,
                  question_health_undo_application_id, recovery_pack_update_source_revision
           FROM quiz_draft_mutations WHERE workspace_id = $1 AND mutation_id = $2`,
          [input.workspaceId, input.mutationId],
        );
        if (raced.rows[0]) {
          const receipt = raced.rows[0];
          if (
            String(receipt.quiz_id) !== input.quizId ||
            Number(receipt.expected_revision) !== input.expectedRevision ||
            String(receipt.draft_hash) !== input.draftHash ||
            (receipt.question_health_undo_application_id == null
              ? null
              : String(receipt.question_health_undo_application_id)) !==
              (input.questionHealthUndo?.applicationId ?? null) ||
            (receipt.recovery_pack_update_source_revision == null
              ? null
              : Number(receipt.recovery_pack_update_source_revision)) !==
              (input.recoveryPackUpdateSourceRevision ?? null)
          ) {
            throw new QuizDraftMutationConflictError(input.mutationId);
          }
          if (input.questionHealthApplication) {
            const application = await client.query(
              `SELECT request_hash FROM question_health_applications
               WHERE workspace_id = $1 AND quiz_id = $2 AND application_id = $3`,
              [input.workspaceId, input.quizId, input.mutationId],
            );
            if (
              String(application.rows[0]?.request_hash ?? "").trim() !==
              input.questionHealthApplication.requestHash
            )
              throw new QuizDraftMutationConflictError(input.mutationId);
          }
          return this.replayQuizDraftMutation(client, input, receipt, current.rows[0]);
        }
        const quiz = mapQuiz(current.rows[0]);
        const currentRevision = quiz.draftRevision ?? 0;
        if (currentRevision !== input.expectedRevision) {
          throw new QuizDraftRevisionConflictError(
            input.quizId,
            input.expectedRevision,
            currentRevision,
            quiz.lastEditedBy ?? null,
          );
        }
        const comparison = await client.query<{ meaningful: boolean }>(
          "SELECT $1::jsonb <> $2::jsonb AS meaningful",
          [JSON.stringify(quiz.draft), JSON.stringify(draft)],
        );
        const meaningful = comparison.rows[0]?.meaningful ?? true;
        if (
          (input.questionHealthApplication ||
            input.recoveryPackUpdateSourceRevision !== undefined) &&
          !meaningful
        ) {
          throw new QuizDraftMutationConflictError(input.mutationId);
        }
        const resultingRevision = meaningful ? currentRevision + 1 : currentRevision;
        await client.query(
          `INSERT INTO quiz_draft_mutations
             (mutation_id, workspace_id, quiz_id, expected_revision, resulting_revision,
              draft_hash, question_health_undo_application_id, recovery_pack_update_source_revision)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            input.mutationId,
            input.workspaceId,
            input.quizId,
            input.expectedRevision,
            resultingRevision,
            input.draftHash,
            input.questionHealthUndo?.applicationId ?? null,
            input.recoveryPackUpdateSourceRevision ?? null,
          ],
        );
        if (!meaningful) return quiz;

        const updated = await client.query(
          `UPDATE quizzes SET title = $3, description = $4, draft = $5,
             draft_revision = $6, draft_schema_version = $7, last_edited_by = $8,
             updated_at = now()
           WHERE workspace_id = $1 AND id = $2 RETURNING *`,
          [
            input.workspaceId,
            input.quizId,
            draft.title,
            draft.description,
            JSON.stringify(draft),
            resultingRevision,
            input.schemaVersion,
            input.editorId,
          ],
        );
        const saved = mapQuiz(updated.rows[0]!);
        await client.query(
          `INSERT INTO quiz_draft_history
             (id, workspace_id, quiz_id, revision, draft, draft_schema_version,
              saved_by, mutation_id, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            randomUUID(),
            input.workspaceId,
            input.quizId,
            resultingRevision,
            JSON.stringify(draft),
            input.schemaVersion,
            input.editorId,
            input.mutationId,
            saved.updatedAt,
          ],
        );
        if (input.questionHealthApplication) {
          const application = input.questionHealthApplication;
          await client.query(
            `INSERT INTO question_health_applications
               (workspace_id, quiz_id, application_id, finding_id, rule_version,
                ruleset_version, content_hash, source_revision, applied_revision,
                request_hash, changes, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12)`,
            [
              input.workspaceId,
              input.quizId,
              application.applicationId,
              application.findingId,
              application.ruleVersion,
              application.rulesetVersion,
              application.contentHash,
              application.sourceRevision,
              resultingRevision,
              application.requestHash,
              JSON.stringify(application.changes),
              saved.updatedAt,
            ],
          );
          await client.query(
            `INSERT INTO audit_events
               (id, workspace_id, actor_id, action, target_type, target_id, request_id, metadata)
             VALUES ($1, $2, $3, 'question_health.application.apply',
                     'question_health_application', $4, $5, $6::jsonb)`,
            [
              randomUUID(),
              input.workspaceId,
              input.editorId,
              input.mutationId,
              application.requestId,
              JSON.stringify({
                quizId: input.quizId,
                findingId: application.findingId,
                sourceRevision: application.sourceRevision,
                appliedRevision: resultingRevision,
              }),
            ],
          );
        }
        if (input.questionHealthUndo) {
          await client.query(
            `INSERT INTO audit_events
               (id, workspace_id, actor_id, action, target_type, target_id, request_id, metadata)
             VALUES ($1, $2, $3, 'question_health.application.undo',
                     'question_health_application', $4, $5, $6::jsonb)`,
            [
              randomUUID(),
              input.workspaceId,
              input.editorId,
              input.questionHealthUndo.applicationId,
              input.questionHealthUndo.requestId,
              JSON.stringify({
                quizId: input.quizId,
                sourceRevision: input.expectedRevision - 1,
                resultingRevision,
              }),
            ],
          );
        }
        await this.pruneQuizDraftHistory(client, input.workspaceId, input.quizId);
        return saved;
      },
      { workspaceId: input.workspaceId },
    );
  }

  async listQuestionHealthDismissals(workspaceId: string, quizId: string) {
    const result = await this.workspaceQuery(
      workspaceId,
      `SELECT * FROM question_health_dismissals
       WHERE workspace_id = $1 AND quiz_id = $2
       ORDER BY created_at DESC, finding_id`,
      [workspaceId, quizId],
    );
    return result.rows.map(mapQuestionHealthDismissal);
  }

  async getQuestionHealthApplication(workspaceId: string, quizId: string, applicationId: string) {
    const result = await this.workspaceQuery(
      workspaceId,
      `SELECT * FROM question_health_applications
       WHERE workspace_id = $1 AND quiz_id = $2 AND application_id = $3`,
      [workspaceId, quizId, applicationId],
    );
    return result.rows[0] ? mapQuestionHealthApplication(result.rows[0]) : null;
  }

  async putQuestionHealthDismissal(input: QuestionHealthDismissalWrite) {
    return this.transaction(
      async (client) => {
        const quiz = await client.query(
          `SELECT draft_revision FROM quizzes
           WHERE workspace_id = $1 AND id = $2 FOR UPDATE`,
          [input.workspaceId, input.quizId],
        );
        if (!quiz.rows[0]) return { status: "not_found" as const };
        if (Number(quiz.rows[0].draft_revision) !== input.expectedDraftRevision) {
          return { status: "revision_conflict" as const };
        }

        await client.query(
          `DELETE FROM question_health_dismissals
           WHERE workspace_id = $1 AND quiz_id = $2 AND finding_id = $3`,
          [input.workspaceId, input.quizId, input.findingId],
        );
        const result = await client.query(
          `INSERT INTO question_health_dismissals
             (workspace_id, quiz_id, finding_id, rule_version, ruleset_version,
              content_hash, reason)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (workspace_id, quiz_id, finding_id, rule_version,
                        ruleset_version, content_hash)
           DO UPDATE SET reason = EXCLUDED.reason, created_at = now()
           RETURNING *`,
          [
            input.workspaceId,
            input.quizId,
            input.findingId,
            input.ruleVersion,
            input.rulesetVersion,
            input.contentHash,
            input.reason,
          ],
        );
        await client.query(
          `INSERT INTO audit_events
             (id, workspace_id, actor_id, action, target_type, target_id, request_id, metadata)
           VALUES ($1, $2, $3, 'question_health.dismissal.create',
                   'question_health_dismissal', $4, $5, $6::jsonb)`,
          [
            randomUUID(),
            input.workspaceId,
            input.actorId,
            input.findingId,
            input.requestId,
            JSON.stringify({
              quizId: input.quizId,
              findingId: input.findingId,
              ruleVersion: input.ruleVersion,
              rulesetVersion: input.rulesetVersion,
              contentHash: input.contentHash,
              reason: input.reason,
            }),
          ],
        );
        return { status: "ok" as const, dismissal: mapQuestionHealthDismissal(result.rows[0]!) };
      },
      { workspaceId: input.workspaceId },
    );
  }

  async deleteQuestionHealthDismissal(input: QuestionHealthDismissalIdentity) {
    return this.transaction(
      async (client) => {
        const quiz = await client.query(
          `SELECT draft_revision FROM quizzes
           WHERE workspace_id = $1 AND id = $2 FOR UPDATE`,
          [input.workspaceId, input.quizId],
        );
        if (!quiz.rows[0]) return { status: "not_found" as const };
        if (Number(quiz.rows[0].draft_revision) !== input.expectedDraftRevision) {
          return { status: "revision_conflict" as const };
        }
        const deleted = await client.query(
          `DELETE FROM question_health_dismissals
           WHERE workspace_id = $1 AND quiz_id = $2 AND finding_id = $3
             AND rule_version = $4 AND ruleset_version = $5 AND content_hash = $6
           RETURNING finding_id`,
          [
            input.workspaceId,
            input.quizId,
            input.findingId,
            input.ruleVersion,
            input.rulesetVersion,
            input.contentHash,
          ],
        );
        if (deleted.rowCount) {
          await client.query(
            `INSERT INTO audit_events
               (id, workspace_id, actor_id, action, target_type, target_id, request_id, metadata)
             VALUES ($1, $2, $3, 'question_health.dismissal.delete',
                     'question_health_dismissal', $4, $5, $6::jsonb)`,
            [
              randomUUID(),
              input.workspaceId,
              input.actorId,
              input.findingId,
              input.requestId,
              JSON.stringify({
                quizId: input.quizId,
                findingId: input.findingId,
                ruleVersion: input.ruleVersion,
                rulesetVersion: input.rulesetVersion,
                contentHash: input.contentHash,
              }),
            ],
          );
        }
        return { status: "ok" as const, removed: Boolean(deleted.rowCount) };
      },
      { workspaceId: input.workspaceId },
    );
  }

  private async pruneQuizDraftHistory(client: PoolClient, workspaceId: string, quizId: string) {
    await client.query(
      `DELETE FROM quiz_draft_history history
       WHERE history.workspace_id = $1 AND history.quiz_id = $2
         AND (history.created_at < now() - interval '30 days' OR history.id NOT IN (
           SELECT kept.id FROM quiz_draft_history kept
           WHERE kept.workspace_id = $1 AND kept.quiz_id = $2
           ORDER BY kept.revision DESC LIMIT 20
         ))
         AND NOT EXISTS (
           SELECT 1 FROM question_health_applications application
           JOIN quizzes quiz ON quiz.workspace_id = application.workspace_id
                            AND quiz.id = application.quiz_id
           WHERE application.workspace_id = history.workspace_id
             AND application.quiz_id = history.quiz_id
             AND application.source_revision = history.revision
             AND application.applied_revision = quiz.draft_revision
         )
         AND NOT EXISTS (
           SELECT 1 FROM quiz_draft_mutations mutation
           JOIN quizzes quiz ON quiz.workspace_id = mutation.workspace_id
                            AND quiz.id = mutation.quiz_id
           WHERE mutation.workspace_id = history.workspace_id
             AND mutation.quiz_id = history.quiz_id
             AND mutation.recovery_pack_update_source_revision = history.revision
             AND mutation.resulting_revision = quiz.draft_revision
         )`,
      [workspaceId, quizId],
    );
    await client.query(
      `DELETE FROM quiz_draft_mutations
       WHERE workspace_id = $1 AND quiz_id = $2
         AND created_at < now() - interval '30 days'`,
      [workspaceId, quizId],
    );
  }

  async listQuizDraftHistory(workspaceId: string, quizId: string, limit = 20) {
    const result = await this.workspaceQuery(
      workspaceId,
      `SELECT * FROM quiz_draft_history
       WHERE workspace_id = $1 AND quiz_id = $2
       ORDER BY revision DESC LIMIT $3`,
      [workspaceId, quizId, Math.min(20, Math.max(1, limit))],
    );
    return result.rows.map(mapQuizDraftHistory);
  }

  async restoreQuizDraftHistory(input: {
    workspaceId: string;
    quizId: string;
    historyRevision: number;
    expectedRevision: number;
    mutationId: string;
    editorId: string;
    questionHealthUndo?: { applicationId: string; requestId: string };
  }) {
    const draftHash = `restore:${input.historyRevision}`;
    const replayReceipt = () =>
      this.transaction(
        async (client) => {
          const prior = await client.query(
            `SELECT quiz_id, expected_revision, resulting_revision, draft_hash,
                    question_health_undo_application_id, recovery_pack_update_source_revision
             FROM quiz_draft_mutations WHERE workspace_id = $1 AND mutation_id = $2`,
            [input.workspaceId, input.mutationId],
          );
          if (!prior.rows[0]) return { handled: false as const, quiz: null };
          const receipt = prior.rows[0];
          if (
            String(receipt.quiz_id) !== input.quizId ||
            Number(receipt.expected_revision) !== input.expectedRevision ||
            String(receipt.draft_hash) !== draftHash ||
            (receipt.question_health_undo_application_id == null
              ? null
              : String(receipt.question_health_undo_application_id)) !==
              (input.questionHealthUndo?.applicationId ?? null) ||
            receipt.recovery_pack_update_source_revision != null
          ) {
            throw new QuizDraftMutationConflictError(input.mutationId);
          }
          return {
            handled: true as const,
            quiz: await this.replayQuizDraftMutation(client, input, receipt),
          };
        },
        { workspaceId: input.workspaceId },
      );
    const replayed = await replayReceipt();
    if (replayed.handled) return replayed.quiz;

    const snapshot = await this.workspaceQuery(
      input.workspaceId,
      `SELECT * FROM quiz_draft_history
       WHERE workspace_id = $1 AND quiz_id = $2 AND revision = $3`,
      [input.workspaceId, input.quizId, input.historyRevision],
    );
    if (!snapshot.rows[0]) {
      const racedReplay = await replayReceipt();
      return racedReplay.handled ? racedReplay.quiz : null;
    }
    const history = mapQuizDraftHistory(snapshot.rows[0]);
    return this.updateQuizDraft({
      workspaceId: input.workspaceId,
      quizId: input.quizId,
      draft: history.draft,
      expectedRevision: input.expectedRevision,
      mutationId: input.mutationId,
      editorId: input.editorId,
      schemaVersion: history.draftSchemaVersion ?? ROUND_DRAFT_SCHEMA_VERSION,
      draftHash,
      questionHealthUndo: input.questionHealthUndo,
    });
  }

  async archiveQuiz(
    workspaceId: string,
    quizId: string,
    archived: boolean,
    maxPublishedQuizzes: number | null = null,
  ) {
    return this.transaction(
      async (client) => {
        await client.query("SELECT id FROM workspaces WHERE id = $1 FOR UPDATE", [workspaceId]);
        const current = await client.query(
          "SELECT * FROM quizzes WHERE workspace_id = $1 AND id = $2 FOR UPDATE",
          [workspaceId, quizId],
        );
        const quiz = current.rows[0];
        if (!quiz) return null;
        const restoresPublishedQuiz =
          !archived && quiz.status === "archived" && quiz.current_version_id !== null;
        if (restoresPublishedQuiz && maxPublishedQuizzes !== null) {
          const count = await client.query(
            "SELECT ((SELECT count(*) FROM quizzes WHERE workspace_id = $1 AND status = 'published') + (SELECT count(*) FROM surveys WHERE workspace_id = $1 AND data->>'status' = 'published'))::integer AS count",
            [workspaceId],
          );
          if (Number(count.rows[0]?.count ?? 0) >= maxPublishedQuizzes) {
            throw new PublishedQuizLimitError(maxPublishedQuizzes);
          }
        }
        const result = await client.query(
          `UPDATE quizzes SET status = CASE WHEN $3 THEN 'archived'
            WHEN current_version_id IS NULL THEN 'draft' ELSE 'published' END,
            archived_at = CASE WHEN $3 THEN now() ELSE NULL END, updated_at = now()
           WHERE workspace_id = $1 AND id = $2 RETURNING *`,
          [workspaceId, quizId, archived],
        );
        return result.rows[0] ? mapQuiz(result.rows[0]) : null;
      },
      { workspaceId },
    );
  }

  async deleteQuiz(workspaceId: string, quizId: string): Promise<LibraryArtifactDeletionResult> {
    try {
      return await this.transaction(
        async (client) => {
          const current = await client.query(
            "SELECT status FROM quizzes WHERE workspace_id = $1 AND id = $2 FOR UPDATE",
            [workspaceId, quizId],
          );
          if (!current.rows[0]) return "not_found";
          if (current.rows[0].status !== "archived") return "not_archived";
          const referenced = await client.query(
            `SELECT 1 FROM quiz_versions AS version
             WHERE version.workspace_id = $1 AND version.quiz_id = $2
               AND (EXISTS (
                 SELECT 1 FROM game_sessions AS session
                 WHERE session.workspace_id = $1 AND session.quiz_version_id = version.id
               ) OR EXISTS (
                 SELECT 1 FROM followups AS followup
                 WHERE followup.workspace_id = $1 AND followup.source_quiz_version_id = version.id
               )) LIMIT 1`,
            [workspaceId, quizId],
          );
          if (referenced.rows[0]) return "in_use";
          // Parent cascades remove versions/history; their FKs reject newly committed dependents.
          await client.query("DELETE FROM quizzes WHERE workspace_id = $1 AND id = $2", [
            workspaceId,
            quizId,
          ]);
          return "deleted";
        },
        { workspaceId },
      );
    } catch (error) {
      if ((error as { code?: string }).code === "23503") return "in_use";
      throw error;
    }
  }

  async duplicateQuiz(input: QuizRecord) {
    return this.createQuiz(input);
  }

  async publishQuiz(
    input: QuizVersionRecord,
    maxPublishedQuizzes: number | null = null,
    expectedDraftRevision?: number,
  ) {
    return this.transaction(
      async (client) => {
        await client.query("SELECT id FROM workspaces WHERE id = $1 FOR UPDATE", [
          input.workspaceId,
        ]);
        const current = await client.query(
          `SELECT status, draft_revision, last_edited_by
           FROM quizzes WHERE workspace_id = $1 AND id = $2 FOR UPDATE`,
          [input.workspaceId, input.quizId],
        );
        if (!current.rows[0]) throw new Error("Quiz not found");
        const currentDraftRevision = Number(current.rows[0].draft_revision);
        if (expectedDraftRevision !== undefined && currentDraftRevision !== expectedDraftRevision) {
          throw new QuizDraftRevisionConflictError(
            input.quizId,
            expectedDraftRevision,
            currentDraftRevision,
            current.rows[0].last_edited_by ? String(current.rows[0].last_edited_by) : null,
          );
        }
        const contentSchemaVersion = input.contentSchemaVersion ?? ROUND_CONTENT_SCHEMA_VERSION;
        const content = upcastRoundContent(input.content, contentSchemaVersion);
        if (current.rows[0].status !== "published" && maxPublishedQuizzes !== null) {
          const count = await client.query(
            "SELECT ((SELECT count(*) FROM quizzes WHERE workspace_id = $1 AND status = 'published') + (SELECT count(*) FROM surveys WHERE workspace_id = $1 AND data->>'status' = 'published'))::integer AS count",
            [input.workspaceId],
          );
          if (Number(count.rows[0]?.count ?? 0) >= maxPublishedQuizzes) {
            throw new PublishedQuizLimitError(maxPublishedQuizzes);
          }
        }
        const result = await client.query(
          `INSERT INTO quiz_versions (
             id, workspace_id, quiz_id, version, content, content_schema_version,
             content_hash, source_draft_revision, published_at
           )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (quiz_id, content_hash) DO UPDATE SET content_hash = EXCLUDED.content_hash
         RETURNING *`,
          [
            input.id,
            input.workspaceId,
            input.quizId,
            input.version,
            JSON.stringify(content),
            contentSchemaVersion,
            input.contentHash,
            currentDraftRevision,
            input.publishedAt,
          ],
        );
        const version = mapVersion(result.rows[0]!);
        await client.query(
          `UPDATE quizzes SET current_version_id = $3, status = 'published',
             published_draft_revision = $4, updated_at = now()
           WHERE workspace_id = $1 AND id = $2`,
          [input.workspaceId, input.quizId, version.id, currentDraftRevision],
        );
        return version;
      },
      { workspaceId: input.workspaceId },
    );
  }

  async getQuizVersion(workspaceId: string, versionId: string) {
    const result = await this.workspaceQuery(
      workspaceId,
      "SELECT * FROM quiz_versions WHERE workspace_id = $1 AND id = $2",
      [workspaceId, versionId],
    );
    return result.rows[0] ? mapVersion(result.rows[0]) : null;
  }

  async countPublishedQuizzes(workspaceId: string) {
    const result = await this.workspaceQuery(
      workspaceId,
      "SELECT count(*)::integer AS count FROM quizzes WHERE workspace_id = $1 AND status = 'published'",
      [workspaceId],
    );
    return result.rows[0]?.count ?? 0;
  }

  async getBrandTheme(workspaceId: string) {
    const result = await this.workspaceQuery(
      workspaceId,
      "SELECT brand_theme FROM workspaces WHERE id = $1",
      [workspaceId],
    );
    return (result.rows[0]?.brand_theme as BrandTheme | null | undefined) ?? null;
  }

  async updateBrandTheme(workspaceId: string, theme: BrandTheme | null) {
    const result = await this.workspaceQuery(
      workspaceId,
      "UPDATE workspaces SET brand_theme = $2 WHERE id = $1 RETURNING brand_theme",
      [workspaceId, theme ? JSON.stringify(theme) : null],
    );
    return (result.rows[0]?.brand_theme as BrandTheme | null | undefined) ?? null;
  }

  async getEmbedAllowedOrigins(workspaceId: string) {
    const result = await this.workspaceQuery(
      workspaceId,
      "SELECT embed_allowed_origins FROM workspaces WHERE id = $1",
      [workspaceId],
    );
    return Array.isArray(result.rows[0]?.embed_allowed_origins)
      ? result.rows[0]!.embed_allowed_origins.map(String)
      : [];
  }

  async updateEmbedAllowedOrigins(workspaceId: string, origins: string[]) {
    const result = await this.workspaceQuery(
      workspaceId,
      `UPDATE workspaces SET embed_allowed_origins = $2::text[]
       WHERE id = $1 RETURNING embed_allowed_origins`,
      [workspaceId, origins],
    );
    return Array.isArray(result.rows[0]?.embed_allowed_origins)
      ? result.rows[0]!.embed_allowed_origins.map(String)
      : [];
  }

  async getInstitutionPolicy(workspaceId: string): Promise<InstitutionPolicyRecord> {
    const result = await this.workspaceQuery(
      workspaceId,
      "SELECT * FROM workspace_institution_policies WHERE workspace_id = $1",
      [workspaceId],
    );
    return result.rows[0]
      ? mapInstitutionPolicy(result.rows[0])
      : defaultInstitutionPolicy(workspaceId);
  }

  async updateInstitutionPolicy(input: InstitutionPolicyRecord, requestId: string) {
    await this.transaction(
      async (client) => {
        const previousResult = await client.query(
          "SELECT * FROM workspace_institution_policies WHERE workspace_id = $1 FOR UPDATE",
          [input.workspaceId],
        );
        const before = previousResult.rows[0]
          ? mapInstitutionPolicy(previousResult.rows[0])
          : defaultInstitutionPolicy(input.workspaceId);
        await client.query(
          `INSERT INTO workspace_institution_policies
             (workspace_id, contract_status, identity_requirement, oidc_enabled,
              managed_sso_enabled, scim_enabled, lti_enabled, nrps_enabled, ags_enabled,
              audit_exports_enabled, residency_controls_enabled, k12_enabled, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,false,$12)
           ON CONFLICT (workspace_id) DO UPDATE SET
             contract_status = EXCLUDED.contract_status,
             identity_requirement = EXCLUDED.identity_requirement,
             oidc_enabled = EXCLUDED.oidc_enabled,
             managed_sso_enabled = EXCLUDED.managed_sso_enabled,
             scim_enabled = EXCLUDED.scim_enabled,
             lti_enabled = EXCLUDED.lti_enabled,
             nrps_enabled = EXCLUDED.nrps_enabled,
             ags_enabled = EXCLUDED.ags_enabled,
             audit_exports_enabled = EXCLUDED.audit_exports_enabled,
             residency_controls_enabled = EXCLUDED.residency_controls_enabled,
             k12_enabled = false,
             updated_at = EXCLUDED.updated_at`,
          [
            input.workspaceId,
            input.contractStatus,
            input.identityRequirement,
            input.capabilities.oidc,
            input.capabilities.managedSso,
            input.capabilities.scim,
            input.capabilities.lti,
            input.capabilities.nrps,
            input.capabilities.ags,
            input.capabilities.auditExports,
            input.capabilities.residencyControls,
            input.updatedAt ?? new Date(),
          ],
        );
        await client.query(
          `INSERT INTO audit_events
             (id, workspace_id, actor_id, action, target_type, target_id, request_id, metadata)
           VALUES ($1,$2::uuid,NULL,'institution.policy.update','workspace',$2::uuid::text,$3,$4)`,
          [randomUUID(), input.workspaceId, requestId, JSON.stringify({ before, after: input })],
        );
      },
      { system: true },
    );
  }

  async createFederatedAuthTransaction(input: FederatedAuthTransactionRecord) {
    await this.systemQuery(
      `INSERT INTO federated_auth_transactions
         (id, workspace_id, user_id, mode, state_hash, code_verifier, nonce, expires_at, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        input.id,
        input.workspaceId,
        input.userId,
        input.mode,
        input.stateHash,
        input.codeVerifier,
        input.nonce,
        input.expiresAt,
        input.createdAt,
      ],
    );
  }

  async consumeFederatedAuthTransaction(stateHash: string, now: Date) {
    return this.transaction(
      async (client) => {
        const result = await client.query(
          `DELETE FROM federated_auth_transactions
           WHERE state_hash = $1 AND expires_at > $2 RETURNING *`,
          [stateHash, now],
        );
        return result.rows[0] ? mapFederatedAuthTransaction(result.rows[0]) : null;
      },
      { system: true },
    );
  }

  async linkExternalIdentity(input: ExternalIdentityRecord) {
    return this.transaction(
      async (client) => {
        const subject = await client.query(
          `SELECT * FROM external_identities
           WHERE workspace_id = $1 AND provider = $2 AND issuer = $3 AND subject = $4
           FOR UPDATE`,
          [input.workspaceId, input.provider, input.issuer, input.subject],
        );
        if (subject.rows[0]) {
          const existing = mapExternalIdentity(subject.rows[0]);
          return existing.userId === input.userId ? existing : null;
        }
        const userIdentity = await client.query(
          `SELECT id FROM external_identities
           WHERE workspace_id = $1 AND provider = $2 AND issuer = $3 AND user_id = $4`,
          [input.workspaceId, input.provider, input.issuer, input.userId],
        );
        if (userIdentity.rowCount) return null;
        const result = await client.query(
          `INSERT INTO external_identities
             (id, workspace_id, user_id, provider, issuer, subject, email_hint,
              linked_at, last_used_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
          [
            input.id,
            input.workspaceId,
            input.userId,
            input.provider,
            input.issuer,
            input.subject,
            input.emailHint,
            input.linkedAt,
            input.lastUsedAt,
          ],
        );
        return mapExternalIdentity(result.rows[0]!);
      },
      { system: true },
    );
  }

  async getExternalIdentity(
    workspaceId: string,
    provider: ExternalIdentityRecord["provider"],
    issuer: string,
    subject: string,
  ) {
    const result = await this.systemQuery(
      `SELECT * FROM external_identities
       WHERE workspace_id = $1 AND provider = $2 AND issuer = $3 AND subject = $4`,
      [workspaceId, provider, issuer, subject],
    );
    return result.rows[0] ? mapExternalIdentity(result.rows[0]) : null;
  }

  async listExternalIdentities(workspaceId: string, userId: string) {
    const result = await this.workspaceQuery(
      workspaceId,
      `SELECT * FROM external_identities
       WHERE workspace_id = $1 AND user_id = $2 ORDER BY linked_at, id`,
      [workspaceId, userId],
    );
    return result.rows.map(mapExternalIdentity);
  }

  async touchExternalIdentity(identityId: string, usedAt: Date) {
    await this.systemQuery("UPDATE external_identities SET last_used_at = $2 WHERE id = $1", [
      identityId,
      usedAt,
    ]);
  }

  async unlinkExternalIdentity(workspaceId: string, userId: string, identityId: string) {
    const result = await this.workspaceQuery(
      workspaceId,
      `DELETE FROM external_identities
       WHERE workspace_id = $1 AND user_id = $2 AND id = $3 RETURNING id`,
      [workspaceId, userId, identityId],
    );
    return result.rowCount === 1;
  }

  async upsertLtiRegistration(input: LtiRegistrationRecord) {
    const result = await this.systemQuery(
      `INSERT INTO lti_platform_registrations
         (id, workspace_id, name, issuer, client_id, deployment_id, authorization_endpoint,
          token_endpoint, jwks_url, deep_link_return_origins, status, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::text[],$11,$12,$13)
       ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name,
         issuer = EXCLUDED.issuer,
         client_id = EXCLUDED.client_id,
         deployment_id = EXCLUDED.deployment_id,
         authorization_endpoint = EXCLUDED.authorization_endpoint,
         token_endpoint = EXCLUDED.token_endpoint,
         jwks_url = EXCLUDED.jwks_url,
         deep_link_return_origins = EXCLUDED.deep_link_return_origins,
         status = EXCLUDED.status,
         updated_at = EXCLUDED.updated_at
       WHERE lti_platform_registrations.workspace_id = EXCLUDED.workspace_id
       RETURNING *`,
      [
        input.id,
        input.workspaceId,
        input.name,
        input.issuer,
        input.clientId,
        input.deploymentId,
        input.authorizationEndpoint,
        input.tokenEndpoint,
        input.jwksUrl,
        input.deepLinkReturnOrigins,
        input.status,
        input.createdAt,
        input.updatedAt,
      ],
    );
    if (!result.rows[0]) throw new Error("LTI registration workspace cannot be changed");
    return mapLtiRegistration(result.rows[0]);
  }

  async listLtiRegistrations(workspaceId: string) {
    const result = await this.workspaceQuery(
      workspaceId,
      `SELECT * FROM lti_platform_registrations
       WHERE workspace_id = $1 ORDER BY lower(name), id`,
      [workspaceId],
    );
    return result.rows.map(mapLtiRegistration);
  }

  async getLtiRegistration(registrationId: string) {
    const result = await this.systemQuery(
      "SELECT * FROM lti_platform_registrations WHERE id = $1",
      [registrationId],
    );
    return result.rows[0] ? mapLtiRegistration(result.rows[0]) : null;
  }

  async findLtiRegistration(issuer: string, clientId?: string, deploymentId?: string) {
    const result = await this.systemQuery(
      `SELECT * FROM lti_platform_registrations
       WHERE status = 'active' AND issuer = $1
         AND ($2::text IS NULL OR client_id = $2)
         AND ($3::text IS NULL OR deployment_id = $3)
       ORDER BY id LIMIT 2`,
      [issuer, clientId ?? null, deploymentId ?? null],
    );
    return result.rows.length === 1 ? mapLtiRegistration(result.rows[0]!) : null;
  }

  async createLtiLoginTransaction(input: LtiLoginTransactionRecord) {
    await this.systemQuery(
      `INSERT INTO lti_login_transactions
         (id, workspace_id, registration_id, state_hash, nonce, target_link_uri,
          lti_message_hint, expires_at, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        input.id,
        input.workspaceId,
        input.registrationId,
        input.stateHash,
        input.nonce,
        input.targetLinkUri,
        input.ltiMessageHint,
        input.expiresAt,
        input.createdAt,
      ],
    );
  }

  async consumeLtiLoginTransaction(stateHash: string, now: Date) {
    const result = await this.systemQuery(
      `DELETE FROM lti_login_transactions
       WHERE state_hash = $1 AND expires_at > $2 RETURNING *`,
      [stateHash, now],
    );
    return result.rows[0] ? mapLtiLoginTransaction(result.rows[0]) : null;
  }

  async createLtiLaunch(input: LtiLaunchRecord) {
    const result = await this.systemQuery(
      `INSERT INTO lti_launches
         (id, workspace_id, registration_id, creator_user_id, subject, message_type, role,
          target_link_uri, quiz_id, context_id, resource_link_id, deep_link_return_url,
          deep_link_data, link_token_hash, response_jwt, completed_at, expires_at, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
       RETURNING *`,
      [
        input.id,
        input.workspaceId,
        input.registrationId,
        input.creatorUserId,
        input.subject,
        input.messageType,
        input.role,
        input.targetLinkUri,
        input.quizId,
        input.contextId,
        input.resourceLinkId,
        input.deepLinkReturnUrl,
        input.deepLinkData,
        input.linkTokenHash,
        input.responseJwt,
        input.completedAt,
        input.expiresAt,
        input.createdAt,
      ],
    );
    return mapLtiLaunch(result.rows[0]!);
  }

  async getLtiLaunch(workspaceId: string, launchId: string, now: Date) {
    const result = await this.workspaceQuery(
      workspaceId,
      `SELECT * FROM lti_launches
       WHERE workspace_id = $1 AND id = $2 AND expires_at > $3`,
      [workspaceId, launchId, now],
    );
    return result.rows[0] ? mapLtiLaunch(result.rows[0]) : null;
  }

  async bindLtiLaunch(linkTokenHash: string, userId: string, identityId: string, now: Date) {
    return this.transaction(
      async (client) => {
        const launchResult = await client.query(
          `SELECT launch.*, registration.issuer
           FROM lti_launches AS launch
           JOIN lti_platform_registrations AS registration
             ON registration.id = launch.registration_id
           WHERE launch.link_token_hash = $1 AND launch.expires_at > $2
             AND launch.subject IS NOT NULL
             AND EXISTS (
               SELECT 1 FROM workspace_members AS member
               WHERE member.workspace_id = launch.workspace_id AND member.user_id = $3
             )
           FOR UPDATE OF launch`,
          [linkTokenHash, now, userId],
        );
        const launch = launchResult.rows[0];
        if (!launch) return null;
        const identityLocks = [
          `lti-bind-subject:${launch.workspace_id}:${launch.issuer}:${launch.subject}`,
          `lti-bind-user:${launch.workspace_id}:${launch.issuer}:${userId}`,
        ].sort();
        for (const lock of identityLocks) {
          await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [lock]);
        }
        const subjectIdentity = await client.query(
          `SELECT user_id FROM external_identities
           WHERE workspace_id = $1 AND provider = 'lti' AND issuer = $2 AND subject = $3
           FOR UPDATE`,
          [launch.workspace_id, launch.issuer, launch.subject],
        );
        if (subjectIdentity.rows[0] && String(subjectIdentity.rows[0].user_id) !== userId) {
          return null;
        }
        const userIdentity = await client.query(
          `SELECT subject FROM external_identities
           WHERE workspace_id = $1 AND provider = 'lti' AND issuer = $2 AND user_id = $3
           FOR UPDATE`,
          [launch.workspace_id, launch.issuer, userId],
        );
        if (userIdentity.rows[0] && String(userIdentity.rows[0].subject) !== launch.subject) {
          return null;
        }
        if (!subjectIdentity.rows[0]) {
          await client.query(
            `INSERT INTO external_identities
               (id, workspace_id, user_id, provider, issuer, subject, email_hint,
                linked_at, last_used_at)
             VALUES ($1,$2,$3,'lti',$4,$5,NULL,$6,$6)`,
            [identityId, launch.workspace_id, userId, launch.issuer, launch.subject, now],
          );
        }
        const result = await client.query(
          `UPDATE lti_launches SET creator_user_id = $2, link_token_hash = NULL
           WHERE id = $1 RETURNING *`,
          [launch.id, userId],
        );
        return mapLtiLaunch(result.rows[0]!);
      },
      { system: true },
    );
  }

  async completeLtiDeepLink(
    workspaceId: string,
    launchId: string,
    userId: string,
    quizId: string,
    responseJwt: string,
    completedAt: Date,
  ) {
    const result = await this.workspaceQuery(
      workspaceId,
      `UPDATE lti_launches SET
         quiz_id = COALESCE(quiz_id, $4),
         response_jwt = COALESCE(response_jwt, $5),
         completed_at = COALESCE(completed_at, $6)
       WHERE workspace_id = $1 AND id = $2 AND creator_user_id = $3
         AND message_type = 'LtiDeepLinkingRequest' AND expires_at > $6
       RETURNING *`,
      [workspaceId, launchId, userId, quizId, responseJwt, completedAt],
    );
    return result.rows[0] ? mapLtiLaunch(result.rows[0]) : null;
  }

  async getEmbedPolicyByKey(policyKeyHash: string, sessionId: string, now: Date) {
    const result = await this.systemQuery(
      `SELECT embed_allowed_origins, expires_at
       FROM session_staff_credentials
       WHERE embed_policy_key_hash = $1 AND session_id = $2 AND role = 'presenter'
         AND revoked_at IS NULL AND expires_at > $3`,
      [policyKeyHash, sessionId, now],
    );
    return result.rows[0]
      ? {
          allowedOrigins: Array.isArray(result.rows[0].embed_allowed_origins)
            ? result.rows[0].embed_allowed_origins.map(String)
            : [],
          expiresAt: date(result.rows[0].expires_at),
        }
      : null;
  }

  async getLiveRoomCode(code: string, now = new Date()) {
    const result = await this.systemQuery(
      `SELECT * FROM live_room_codes
       WHERE code = $1 AND released_at IS NULL AND expires_at > $2`,
      [code, now],
    );
    return result.rows[0] ? mapLiveRoomCode(result.rows[0]) : null;
  }

  async claimLiveRoomCode(input: LiveRoomCodeClaim) {
    try {
      return await this.transaction(
        async (client) => {
          await client.query(
            `DELETE FROM live_room_codes
             WHERE code = $1 AND (released_at IS NOT NULL OR expires_at <= clock_timestamp())`,
            [input.code],
          );
          const result = await client.query(
            `INSERT INTO live_room_codes
               (code, workspace_id, artifact_type, artifact_id, expires_at, created_at)
             VALUES ($1,$2,$3,$4,$5,$6)
             RETURNING *`,
            [
              input.code,
              input.workspaceId,
              input.artifactType,
              input.artifactId,
              input.expiresAt,
              input.createdAt,
            ],
          );
          return mapLiveRoomCode(result.rows[0]!);
        },
        { system: true },
      );
    } catch (error) {
      const postgresError = error as { code?: string; constraint?: string };
      if (
        postgresError.code === "23505" &&
        (postgresError.constraint === "live_room_codes_pkey" ||
          postgresError.constraint === "live_room_codes_artifact_type_artifact_id_key")
      ) {
        throw new SessionCodeConflictError(input.code);
      }
      throw error;
    }
  }

  async releaseLiveRoomCode(
    artifactType: LiveRoomArtifactType,
    artifactId: string,
    releasedAt = new Date(),
  ) {
    const result = await this.systemQuery(
      `UPDATE live_room_codes
       SET released_at = COALESCE(released_at, $3)
       WHERE artifact_type = $1 AND artifact_id = $2
       RETURNING code`,
      [artifactType, artifactId, releasedAt],
    );
    return result.rowCount === 1;
  }

  async createSession(input: StoredSession) {
    const state = input.state;
    try {
      await this.workspaceQuery(
        input.workspaceId,
        `WITH eligible_workspace AS (
           SELECT id FROM workspaces
           WHERE id = $2 AND deletion_started_at IS NULL
           FOR SHARE
         ), inserted_session AS (
           INSERT INTO game_sessions
             (id, workspace_id, quiz_version_id, host_id, code, state, version, seq, deadline,
              settings, state_snapshot, state_schema_version, host_token_hash, trust_mode,
              decision_replay_enabled, expires_at, retention_expires_at, created_at, updated_at)
           SELECT $1, eligible_workspace.id, $3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,
                  $16,$17,$18,$19
           FROM eligible_workspace
           RETURNING id, workspace_id
         )
         INSERT INTO session_interaction_settings (session_id, workspace_id)
         SELECT id, workspace_id FROM inserted_session
         RETURNING session_id`,
        [
          input.id,
          input.workspaceId,
          input.quizVersionId,
          input.hostId,
          state.code,
          state.phase,
          state.version,
          state.seq,
          state.deadlineMs ? new Date(state.deadlineMs) : null,
          JSON.stringify(state.settings),
          JSON.stringify(state),
          state.stateSchemaVersion,
          input.hostTokenHash,
          input.trustMode ?? state.settings.trustMode ?? "learning",
          input.decisionReplayEnabled ?? false,
          input.expiresAt,
          input.retentionExpiresAt,
          input.createdAt,
          input.updatedAt,
        ],
      ).then((result) => {
        if (result.rowCount !== 1) {
          throw new WorkspaceDeletionInProgressError(input.workspaceId);
        }
      });
    } catch (error) {
      const postgresError = error as { code?: string; constraint?: string };
      if (
        postgresError.code === "23505" &&
        (postgresError.constraint === "game_sessions_active_code_uq" ||
          postgresError.constraint === "live_room_codes_pkey")
      ) {
        throw new SessionCodeConflictError(state.code);
      }
      throw error;
    }
  }

  async getSessionById(sessionId: string) {
    const result = await this.systemQuery(
      "SELECT * FROM game_sessions WHERE id = $1 AND deleted_at IS NULL",
      [sessionId],
    );
    return result.rows[0] ? mapSession(result.rows[0]) : null;
  }

  async getSessionByCode(code: string) {
    const result = await this.systemQuery(
      `SELECT * FROM game_sessions
       WHERE code = $1 AND ended_at IS NULL AND deleted_at IS NULL AND expires_at > now()
       ORDER BY created_at DESC LIMIT 1`,
      [code],
    );
    return result.rows[0] ? mapSession(result.rows[0]) : null;
  }

  async listSessionIds(workspaceId: string) {
    const result = await this.workspaceQuery(
      workspaceId,
      "SELECT id FROM game_sessions WHERE workspace_id = $1 ORDER BY id",
      [workspaceId],
    );
    return result.rows.map((row) => String(row.id));
  }

  async listSessionInvalidationTargets(workspaceId: string): Promise<SessionInvalidationTarget[]> {
    const result = await this.workspaceQuery(
      workspaceId,
      `SELECT id, code FROM game_sessions
       WHERE workspace_id = $1
       ORDER BY id`,
      [workspaceId],
    );
    return result.rows.map((row) => ({
      sessionId: String(row.id),
      code: String(row.code),
    }));
  }

  async workspaceDeletionStarted(workspaceId: string) {
    const result = await this.systemQuery(
      "SELECT deletion_started_at FROM workspaces WHERE id = $1",
      [workspaceId],
    );
    return !result.rows[0] || result.rows[0].deletion_started_at !== null;
  }

  async listSessionHistory(
    workspaceId: string,
    options: {
      cursor?: HistoryCursor;
      limit: number;
      status?: SessionHistoryRecord["status"];
      quizId?: string;
      from?: Date;
      to?: Date;
      now: Date;
    },
  ) {
    const result = await this.workspaceQuery(
      workspaceId,
      `SELECT game_sessions.*, quiz_versions.quiz_id,
              reports.id AS report_id,
              to_char(
                game_sessions.created_at AT TIME ZONE 'UTC',
                'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
              ) AS cursor_created_at,
              (SELECT count(*)::integer FROM answers
               WHERE answers.workspace_id = game_sessions.workspace_id
                 AND answers.session_id = game_sessions.id) AS answer_count
       FROM game_sessions
       JOIN quiz_versions ON quiz_versions.id = game_sessions.quiz_version_id
       LEFT JOIN reports ON reports.session_id = game_sessions.id
       WHERE game_sessions.workspace_id = $1 AND game_sessions.deleted_at IS NULL
         AND ($2::timestamptz IS NULL OR (game_sessions.created_at, game_sessions.id) < ($2, $3::uuid))
         AND ($4::uuid IS NULL OR quiz_versions.quiz_id = $4)
         AND ($5::timestamptz IS NULL OR game_sessions.created_at >= $5)
         AND ($6::timestamptz IS NULL OR game_sessions.created_at <= $6)
         AND (
           $7::text IS NULL
           OR ($7 = 'finished' AND game_sessions.state = 'finished')
           OR ($7 = 'active' AND game_sessions.state <> 'finished' AND game_sessions.expires_at > $8)
           OR ($7 = 'expired' AND game_sessions.state <> 'finished' AND game_sessions.expires_at <= $8)
         )
       ORDER BY game_sessions.created_at DESC, game_sessions.id DESC
       LIMIT $9`,
      [
        workspaceId,
        options.cursor?.cursorCreatedAt ?? options.cursor?.createdAt ?? null,
        options.cursor?.id ?? null,
        options.quizId ?? null,
        options.from ?? null,
        options.to ?? null,
        options.status ?? null,
        options.now,
        options.limit + 1,
      ],
    );
    const hasMore = result.rows.length > options.limit;
    const rows = result.rows.slice(0, options.limit);
    return {
      items: rows.map((row): SessionHistoryRecord => {
        const state = upgradeGameState(row.state_snapshot as GameState);
        return {
          id: String(row.id),
          quizId: String(row.quiz_id),
          title: state.quiz.title,
          status: sessionHistoryStatus(state, date(row.expires_at), options.now),
          phase: state.phase,
          code: state.code,
          participantCount: Object.values(state.participants).filter(
            (participant) => !participant.kicked,
          ).length,
          answerCount: Number(row.answer_count ?? 0),
          questionCount: state.quiz.questions.filter(
            (question) => questionDelivery(question) === "main",
          ).length,
          questionPosition: sessionQuestionPosition(state),
          createdAt: date(row.created_at),
          cursorCreatedAt: row.cursor_created_at ? String(row.cursor_created_at) : undefined,
          updatedAt: date(row.updated_at),
          expiresAt: date(row.expires_at),
          reportId: row.report_id ? String(row.report_id) : null,
        };
      }),
      hasMore,
    };
  }

  async saveSession(
    input: StoredSession,
    expectedVersion: number,
    report?: Report,
    decisionEvents: SessionDecisionEventWrite[] = [],
  ) {
    const state = input.state;
    const trustMode = input.trustMode ?? state.settings.trustMode ?? "learning";
    const decisionReplayEnabled = input.decisionReplayEnabled ?? false;
    const validatedDecisionEvents = decisionEvents.map((write) => ({
      ...write,
      event: SessionDecisionEventSchema.parse(write.event),
    }));
    if (validatedDecisionEvents.length > 0 && !decisionReplayEnabled) {
      throw new Error("Decision events cannot be written for a session without replay enabled");
    }
    if (
      validatedDecisionEvents.some(
        (write) =>
          typeof write.commandId !== "string" ||
          write.commandId.length === 0 ||
          write.commandId.length > 160 ||
          !Number.isSafeInteger(write.eventOrdinal) ||
          write.eventOrdinal < 0,
      ) ||
      new Set(validatedDecisionEvents.map((write) => write.event.seq)).size !==
        validatedDecisionEvents.length ||
      new Set(
        validatedDecisionEvents.map((write) => `${write.commandId}\u0000${write.eventOrdinal}`),
      ).size !== validatedDecisionEvents.length
    ) {
      throw new Error("Duplicate or invalid session decision event sequence/ordinal");
    }
    if ((state.settings.trustMode ?? "learning") !== trustMode) {
      throw new Error("Session state trust mode must match its immutable session trust mode");
    }
    if (report && report.sessionId !== input.id) throw new Error("Report session does not match");
    await this.transaction(
      async (client) => {
        const workspace = await client.query(
          `SELECT id FROM workspaces
           WHERE id = $1 AND deletion_started_at IS NULL
           FOR SHARE`,
          [input.workspaceId],
        );
        if (!workspace.rows[0]) {
          throw new WorkspaceDeletionInProgressError(input.workspaceId);
        }
        const result = await client.query(
          `UPDATE game_sessions SET state = $2, version = $3, seq = $4, deadline = $5,
           state_snapshot = $6, state_schema_version = $7,
           ended_at = CASE WHEN $2 = 'finished' THEN COALESCE(ended_at, now()) ELSE ended_at END,
           retention_expires_at = $8, updated_at = now()
           WHERE id = $1 AND version = $9 AND trust_mode = $10
             AND decision_replay_enabled = $11`,
          [
            input.id,
            state.phase,
            state.version,
            state.seq,
            state.deadlineMs ? new Date(state.deadlineMs) : null,
            JSON.stringify(state),
            state.stateSchemaVersion,
            input.retentionExpiresAt,
            expectedVersion,
            trustMode,
            decisionReplayEnabled,
          ],
        );
        if (result.rowCount !== 1) {
          throw new SessionVersionConflictError(input.id, expectedVersion);
        }
        if (validatedDecisionEvents.length > 0) {
          if (!decisionReplayEnabled) {
            throw new Error(
              "Decision events cannot be written for a session without replay enabled",
            );
          }
          const capture = await client.query<{
            captured_count: number;
            truncated: boolean | null;
          }>(
            `SELECT count(*) FILTER (WHERE type <> 'decision.capture_truncated')::integer
               AS captured_count,
                    bool_or(type = 'decision.capture_truncated') AS truncated
             FROM session_events
             WHERE workspace_id = $1 AND session_id = $2 AND type LIKE 'decision.%'`,
            [input.workspaceId, input.id],
          );
          const captureRow = capture.rows[0];
          if (!captureRow?.truncated) {
            const remaining = Math.max(
              0,
              MAX_SESSION_DECISION_EVENTS - Number(captureRow?.captured_count ?? 0),
            );
            const writes = validatedDecisionEvents.slice(0, remaining);
            const overflow = validatedDecisionEvents[remaining];
            if (overflow) {
              writes.push({
                ...overflow,
                event: {
                  type: "capture_truncated",
                  seq: overflow.event.seq,
                  occurredAt: overflow.event.occurredAt,
                  reason: "event_limit",
                },
              });
            }
            for (const write of writes) {
              await client.query(
                `INSERT INTO session_events
                   (id, workspace_id, session_id, seq, type, payload, command_id,
                    event_ordinal, expires_at)
                 VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9)`,
                [
                  randomUUID(),
                  input.workspaceId,
                  input.id,
                  write.event.seq,
                  `decision.${write.event.type}`,
                  JSON.stringify(write.event),
                  write.commandId,
                  write.eventOrdinal,
                  input.retentionExpiresAt,
                ],
              );
            }
          }
        }
        if (state.phase === "finished") {
          await client.query(
            `UPDATE session_interaction_settings
             SET closed_at = COALESCE(closed_at, now()), signals_enabled = false,
                 chat_enabled = false, updated_at = now()
             WHERE workspace_id = $1 AND session_id = $2`,
            [input.workspaceId, input.id],
          );
        }
        await this.syncSessionEvidence(client, input);
        if (report) {
          await client.query(
            `INSERT INTO reports
               (id, workspace_id, session_id, status, metrics, generated_at, schema_version,
                attempts, available_at, last_error, updated_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,0,now(),NULL,now())
             ON CONFLICT (session_id) DO UPDATE SET id = EXCLUDED.id, status = EXCLUDED.status,
             metrics = EXCLUDED.metrics, generated_at = EXCLUDED.generated_at,
             schema_version = EXCLUDED.schema_version, attempts = 0, available_at = now(),
             last_error = NULL, updated_at = now()`,
            [
              report.id,
              input.workspaceId,
              report.sessionId,
              report.status,
              JSON.stringify(report),
              report.generatedAt,
              report.schemaVersion ?? 1,
            ],
          );
        }
      },
      { workspaceId: input.workspaceId },
    );
  }

  async deleteSession(workspaceId: string, sessionId: string) {
    const result = await this.workspaceQuery(
      workspaceId,
      "DELETE FROM game_sessions WHERE workspace_id = $1 AND id = $2 RETURNING id",
      [workspaceId, sessionId],
    );
    return result.rowCount === 1;
  }

  async createParticipant(input: ParticipantRecord) {
    await this.systemQuery(
      `INSERT INTO participants (id, session_id, nickname, token_hash, status, joined_at)
       VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (token_hash) DO UPDATE SET last_seen_at = now(), status = 'active'`,
      [input.id, input.sessionId, input.nickname, input.tokenHash, input.status, input.joinedAt],
    );
  }

  async commitParticipants(
    session: StoredSession,
    participants: ParticipantRecord[],
    expectedVersion: number,
  ) {
    if (participants.length === 0) return;
    await this.transaction(
      async (client) => {
        const workspace = await client.query(
          `SELECT id FROM workspaces
           WHERE id = $1 AND deletion_started_at IS NULL
           FOR SHARE`,
          [session.workspaceId],
        );
        if (!workspace.rows[0]) {
          throw new WorkspaceDeletionInProgressError(session.workspaceId);
        }
        const inserted = await client.query(
          `INSERT INTO participants (id, session_id, nickname, token_hash, status, joined_at)
           SELECT id, session_id, nickname, token_hash, status, joined_at
           FROM jsonb_to_recordset($1::jsonb) AS input(
             id uuid, session_id uuid, nickname text, token_hash text,
             status text, joined_at timestamptz
           )`,
          [
            JSON.stringify(
              participants.map((participant) => ({
                id: participant.id,
                session_id: participant.sessionId,
                nickname: participant.nickname,
                token_hash: participant.tokenHash,
                status: participant.status,
                joined_at: participant.joinedAt.toISOString(),
              })),
            ),
          ],
        );
        if (inserted.rowCount !== participants.length) {
          throw new Error("Not every participant was committed");
        }
        const state = session.state;
        const saved = await client.query(
          `UPDATE game_sessions SET state = $2, version = $3, seq = $4, deadline = $5,
           state_snapshot = $6, state_schema_version = $7, updated_at = now()
           WHERE id = $1 AND version = $8`,
          [
            session.id,
            state.phase,
            state.version,
            state.seq,
            state.deadlineMs ? new Date(state.deadlineMs) : null,
            JSON.stringify(state),
            state.stateSchemaVersion,
            expectedVersion,
          ],
        );
        if (saved.rowCount !== 1) {
          throw new SessionVersionConflictError(session.id, expectedVersion);
        }
      },
      { workspaceId: session.workspaceId },
    );
  }

  async getParticipantByToken(tokenHash: string) {
    const result = await this.systemQuery("SELECT * FROM participants WHERE token_hash = $1", [
      tokenHash,
    ]);
    const row = result.rows[0];
    return row
      ? {
          id: row.id,
          sessionId: row.session_id,
          nickname: row.nickname,
          tokenHash: row.token_hash,
          status: row.status,
          joinedAt: date(row.joined_at),
        }
      : null;
  }

  async getParticipants(sessionId: string) {
    const result = await this.systemQuery("SELECT * FROM participants WHERE session_id = $1", [
      sessionId,
    ]);
    return result.rows.map((row) => ({
      id: row.id,
      sessionId: row.session_id,
      nickname: row.nickname,
      tokenHash: row.token_hash,
      status: row.status,
      joinedAt: date(row.joined_at),
    }));
  }

  async createSessionStaffCredential(input: SessionStaffCredentialInput) {
    const result = await this.workspaceQuery(
      input.workspaceId,
      `INSERT INTO session_staff_credentials
         (id, workspace_id, session_id, role, label, token_hash, created_by, expires_at,
          revoked_at, created_at, embed_policy_key_hash, embed_allowed_origins, purpose)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::text[],$13) RETURNING *`,
      [
        input.id,
        input.workspaceId,
        input.sessionId,
        input.role,
        input.label,
        input.tokenHash,
        input.createdBy,
        input.expiresAt,
        input.revokedAt,
        input.createdAt,
        input.embedPolicyKeyHash ?? null,
        input.embedAllowedOrigins ?? [],
        input.purpose ?? "collaboration",
      ],
    );
    return mapSessionStaff(result.rows[0]!);
  }

  async replaceCreatorResumeCredential(input: SessionStaffCredentialRecord) {
    if (input.purpose !== "creator_resume" || input.role !== "cohost") {
      throw new Error("A creator resume credential must be a cohost credential");
    }
    return this.transaction(
      async (client) => {
        const session = await client.query(
          `SELECT state, expires_at FROM game_sessions
           WHERE workspace_id = $1 AND id = $2 AND deleted_at IS NULL
           FOR UPDATE`,
          [input.workspaceId, input.sessionId],
        );
        if (session.rowCount !== 1) throw new SessionNotActiveError(input.sessionId);
        const clock = await client.query("SELECT clock_timestamp() AS checked_at");
        const lockedSession = session.rows[0]!;
        if (
          lockedSession.state === "finished" ||
          date(lockedSession.expires_at) <= date(clock.rows[0]!.checked_at)
        ) {
          throw new SessionNotActiveError(input.sessionId);
        }
        const revoked = await client.query(
          `UPDATE session_staff_credentials SET revoked_at = $4
           WHERE workspace_id = $1 AND session_id = $2 AND created_by = $3
             AND purpose = 'creator_resume' AND revoked_at IS NULL
           RETURNING id`,
          [input.workspaceId, input.sessionId, input.createdBy, input.createdAt],
        );
        const result = await client.query(
          `INSERT INTO session_staff_credentials
             (id, workspace_id, session_id, role, purpose, label, token_hash, created_by,
              expires_at, revoked_at, created_at, embed_policy_key_hash, embed_allowed_origins)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::text[])
           RETURNING *`,
          [
            input.id,
            input.workspaceId,
            input.sessionId,
            input.role,
            input.purpose,
            input.label,
            input.tokenHash,
            input.createdBy,
            input.expiresAt,
            input.revokedAt,
            input.createdAt,
            input.embedPolicyKeyHash ?? null,
            input.embedAllowedOrigins ?? [],
          ],
        );
        return {
          credential: mapSessionStaff(result.rows[0]!),
          revokedCredentialIds: revoked.rows.map((row) => String(row.id)),
        };
      },
      { workspaceId: input.workspaceId },
    );
  }

  async getSessionStaffByToken(tokenHash: string, now: Date) {
    const result = await this.systemQuery(
      `SELECT * FROM session_staff_credentials
       WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > $2`,
      [tokenHash, now],
    );
    return result.rows[0] ? mapSessionStaff(result.rows[0]) : null;
  }

  async listSessionStaff(workspaceId: string, sessionId: string) {
    const result = await this.workspaceQuery(
      workspaceId,
      `SELECT * FROM session_staff_credentials
       WHERE workspace_id = $1 AND session_id = $2 ORDER BY created_at, id`,
      [workspaceId, sessionId],
    );
    return result.rows.map(mapSessionStaff);
  }

  async revokeSessionStaff(workspaceId: string, sessionId: string, credentialId: string) {
    const result = await this.workspaceQuery(
      workspaceId,
      `UPDATE session_staff_credentials SET revoked_at = now()
       WHERE workspace_id = $1 AND session_id = $2 AND id = $3 AND revoked_at IS NULL
       RETURNING id`,
      [workspaceId, sessionId, credentialId],
    );
    return result.rowCount === 1;
  }

  async getWorkspaceSegment(workspaceId: string): Promise<Segment> {
    const result = await this.workspaceQuery(
      workspaceId,
      "SELECT segment FROM workspaces WHERE id = $1",
      [workspaceId],
    );
    return (result.rows[0]?.segment as Segment | undefined) ?? "workplace";
  }

  async getQnaSettings(workspaceId: string, sessionId: string) {
    const result = await this.workspaceQuery(
      workspaceId,
      `SELECT * FROM session_qna_settings WHERE workspace_id = $1 AND session_id = $2`,
      [workspaceId, sessionId],
    );
    return result.rows[0] ? mapQnaSettings(result.rows[0]) : null;
  }

  async saveQnaSettings(input: QnaSettingsRecord) {
    const result = await this.workspaceQuery(
      input.workspaceId,
      `INSERT INTO session_qna_settings
         (session_id, workspace_id, enabled, display_mode, moderation_mode,
          participant_replies, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (session_id) DO UPDATE SET
         enabled = EXCLUDED.enabled,
         display_mode = EXCLUDED.display_mode,
         moderation_mode = EXCLUDED.moderation_mode,
         participant_replies = EXCLUDED.participant_replies,
         updated_at = EXCLUDED.updated_at
       RETURNING *`,
      [
        input.sessionId,
        input.workspaceId,
        input.enabled,
        input.displayMode,
        input.moderationMode,
        input.participantReplies,
        input.updatedAt,
      ],
    );
    return mapQnaSettings(result.rows[0]!);
  }

  async createQnaQuestion(input: QnaQuestionRecord) {
    const result = await this.workspaceQuery(
      input.workspaceId,
      `INSERT INTO qna_questions
         (id, workspace_id, session_id, participant_id, body, public_alias, status, label,
          created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *, 0 AS vote_count,
         false AS voted_by_viewer`,
      [
        input.id,
        input.workspaceId,
        input.sessionId,
        input.participantId,
        input.body,
        input.publicAlias,
        input.status,
        input.label,
        input.createdAt,
        input.updatedAt,
      ],
    );
    return mapQnaQuestion(result.rows[0]!);
  }

  async getQnaQuestion(workspaceId: string, questionId: string) {
    const result = await this.workspaceQuery(
      workspaceId,
      `SELECT question.*, count(vote.question_id)::integer AS vote_count,
              false AS voted_by_viewer
       FROM qna_questions AS question
       LEFT JOIN qna_votes AS vote ON vote.question_id = question.id
       WHERE question.workspace_id = $1 AND question.id = $2
       GROUP BY question.id`,
      [workspaceId, questionId],
    );
    return result.rows[0] ? mapQnaQuestion(result.rows[0]) : null;
  }

  async listQnaQuestions(workspaceId: string, sessionId: string, viewerParticipantId?: string) {
    const result = await this.workspaceQuery(
      workspaceId,
      `SELECT question.*, count(vote.question_id)::integer AS vote_count,
              COALESCE(bool_or(vote.participant_id = $3::uuid), false) AS voted_by_viewer
       FROM qna_questions AS question
       LEFT JOIN qna_votes AS vote ON vote.question_id = question.id
       WHERE question.workspace_id = $1 AND question.session_id = $2
       GROUP BY question.id
       ORDER BY question.created_at DESC, question.id DESC`,
      [workspaceId, sessionId, viewerParticipantId ?? null],
    );
    return result.rows.map(mapQnaQuestion);
  }

  async updateQnaQuestion(
    workspaceId: string,
    questionId: string,
    update: Pick<QnaQuestionRecord, "status" | "label">,
  ) {
    const result = await this.workspaceQuery(
      workspaceId,
      `UPDATE qna_questions SET status = $3, label = $4, updated_at = now()
       WHERE workspace_id = $1 AND id = $2
       RETURNING *, (SELECT count(*)::integer FROM qna_votes WHERE question_id = $2) AS vote_count,
         false AS voted_by_viewer`,
      [workspaceId, questionId, update.status, update.label],
    );
    return result.rows[0] ? mapQnaQuestion(result.rows[0]) : null;
  }

  async createQnaReply(input: QnaReplyRecord) {
    const result = await this.workspaceQuery(
      input.workspaceId,
      `INSERT INTO qna_replies
         (id, workspace_id, session_id, question_id, participant_id, actor_id,
          staff_credential_id, body, public_alias, status, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [
        input.id,
        input.workspaceId,
        input.sessionId,
        input.questionId,
        input.participantId,
        input.actorId,
        input.staffCredentialId,
        input.body,
        input.publicAlias,
        input.status,
        input.createdAt,
        input.updatedAt,
      ],
    );
    return mapQnaReply(result.rows[0]!);
  }

  async getQnaReply(workspaceId: string, replyId: string) {
    const result = await this.workspaceQuery(
      workspaceId,
      "SELECT * FROM qna_replies WHERE workspace_id = $1 AND id = $2",
      [workspaceId, replyId],
    );
    return result.rows[0] ? mapQnaReply(result.rows[0]) : null;
  }

  async listQnaReplies(workspaceId: string, questionId: string) {
    const result = await this.workspaceQuery(
      workspaceId,
      `SELECT * FROM qna_replies WHERE workspace_id = $1 AND question_id = $2
       ORDER BY created_at, id`,
      [workspaceId, questionId],
    );
    return result.rows.map(mapQnaReply);
  }

  async updateQnaReply(workspaceId: string, replyId: string, status: QnaReplyRecord["status"]) {
    const result = await this.workspaceQuery(
      workspaceId,
      `UPDATE qna_replies SET status = $3, updated_at = now()
       WHERE workspace_id = $1 AND id = $2 RETURNING *`,
      [workspaceId, replyId, status],
    );
    return result.rows[0] ? mapQnaReply(result.rows[0]) : null;
  }

  async setQnaVote(
    workspaceId: string,
    sessionId: string,
    questionId: string,
    participantId: string,
    voted: boolean,
  ) {
    return this.transaction(
      async (client) => {
        if (voted) {
          const inserted = await client.query(
            `INSERT INTO qna_votes (workspace_id, session_id, question_id, participant_id)
             SELECT $1,$2,$3,$4 FROM qna_questions
             WHERE workspace_id = $1 AND session_id = $2 AND id = $3
             ON CONFLICT (question_id, participant_id) DO NOTHING`,
            [workspaceId, sessionId, questionId, participantId],
          );
          if (inserted.rowCount === 0) {
            const exists = await client.query(
              `SELECT 1 FROM qna_questions WHERE workspace_id = $1 AND session_id = $2 AND id = $3`,
              [workspaceId, sessionId, questionId],
            );
            if (exists.rowCount !== 1) throw new Error("Q&A question not found");
          }
        } else {
          await client.query(
            `DELETE FROM qna_votes
             WHERE workspace_id = $1 AND session_id = $2 AND question_id = $3
               AND participant_id = $4`,
            [workspaceId, sessionId, questionId, participantId],
          );
        }
        const count = await client.query(
          "SELECT count(*)::integer AS count FROM qna_votes WHERE question_id = $1",
          [questionId],
        );
        return Number(count.rows[0]?.count ?? 0);
      },
      { workspaceId },
    );
  }

  async isQnaBanned(workspaceId: string, sessionId: string, participantId: string) {
    const result = await this.workspaceQuery(
      workspaceId,
      `SELECT 1 FROM qna_bans
       WHERE workspace_id = $1 AND session_id = $2 AND participant_id = $3`,
      [workspaceId, sessionId, participantId],
    );
    return result.rowCount === 1;
  }

  async banQnaParticipant(
    workspaceId: string,
    sessionId: string,
    participantId: string,
    actorId: string | null,
  ) {
    await this.workspaceQuery(
      workspaceId,
      `INSERT INTO qna_bans (workspace_id, session_id, participant_id, actor_id)
       VALUES ($1,$2,$3,$4) ON CONFLICT (session_id, participant_id) DO NOTHING`,
      [workspaceId, sessionId, participantId, actorId],
    );
  }

  async getInteractionSettings(workspaceId: string, sessionId: string) {
    const result = await this.workspaceQuery(
      workspaceId,
      `SELECT * FROM session_interaction_settings
       WHERE workspace_id = $1 AND session_id = $2`,
      [workspaceId, sessionId],
    );
    return result.rows[0] ? mapInteractionSettings(result.rows[0]) : null;
  }

  async appendAudienceEvent(
    workspaceId: string,
    sessionId: string,
    eventInput: AudienceEventInput,
    createdAt: Date,
  ): Promise<AudienceMutation<null>> {
    return this.transaction(
      async (client) => {
        await this.lockInteractionSettings(client, workspaceId, sessionId);
        const existing = await this.existingAudienceEvent(
          client,
          sessionId,
          eventInput.idempotencyKey,
        );
        if (existing) return { record: null, event: existing, duplicate: true };
        const event = await this.appendAudienceEventLocked(
          client,
          workspaceId,
          sessionId,
          eventInput,
          createdAt,
        );
        return { record: null, event, duplicate: false };
      },
      { workspaceId },
    );
  }

  async saveInteractionSettings(
    input: Omit<InteractionSettingsRecord, "audienceSeq" | "closedAt">,
    eventInput: AudienceEventInput,
  ): Promise<AudienceMutation<InteractionSettingsRecord>> {
    return this.transaction(
      async (client) => {
        await client.query(
          `INSERT INTO session_interaction_settings
             (session_id, workspace_id, signals_enabled, chat_enabled, chat_identity_mode,
              slow_mode_seconds, presenter_feed_mode, updated_at)
           SELECT $1,$2,$3,$4,$5,$6,$7,$8
           FROM game_sessions
           WHERE id = $1 AND workspace_id = $2 AND ended_at IS NULL AND deleted_at IS NULL
           ON CONFLICT (session_id) DO NOTHING`,
          [
            input.sessionId,
            input.workspaceId,
            input.signalsEnabled,
            input.chatEnabled,
            input.chatIdentityMode,
            input.slowModeSeconds,
            input.presenterFeedMode,
            input.updatedAt,
          ],
        );
        await this.lockInteractionSettings(client, input.workspaceId, input.sessionId);
        const existingEvent = await this.existingAudienceEvent(
          client,
          input.sessionId,
          eventInput.idempotencyKey,
        );
        if (existingEvent) {
          const current = await client.query(
            `SELECT * FROM session_interaction_settings WHERE session_id = $1`,
            [input.sessionId],
          );
          return {
            record: mapInteractionSettings(current.rows[0]!),
            event: existingEvent,
            duplicate: true,
          };
        }
        await client.query(
          `UPDATE session_interaction_settings SET
             signals_enabled = $3, chat_enabled = $4, chat_identity_mode = $5,
             slow_mode_seconds = $6, presenter_feed_mode = $7, updated_at = $8
           WHERE workspace_id = $1 AND session_id = $2`,
          [
            input.workspaceId,
            input.sessionId,
            input.signalsEnabled,
            input.chatEnabled,
            input.chatIdentityMode,
            input.slowModeSeconds,
            input.presenterFeedMode,
            input.updatedAt,
          ],
        );
        const event = await this.appendAudienceEventLocked(
          client,
          input.workspaceId,
          input.sessionId,
          eventInput,
          input.updatedAt,
        );
        const saved = await client.query(
          `SELECT * FROM session_interaction_settings WHERE session_id = $1`,
          [input.sessionId],
        );
        return {
          record: mapInteractionSettings(saved.rows[0]!),
          event,
          duplicate: false,
        };
      },
      { workspaceId: input.workspaceId },
    );
  }

  async listParticipantSignals(workspaceId: string, sessionId: string, contextKey: string) {
    const result = await this.workspaceQuery(
      workspaceId,
      `SELECT * FROM participant_signal_state
       WHERE workspace_id = $1 AND session_id = $2 AND context_key = $3
       ORDER BY updated_at DESC, participant_id`,
      [workspaceId, sessionId, contextKey],
    );
    return result.rows.map(mapParticipantSignal);
  }

  async countRecentSignalEvents(workspaceId: string, sessionId: string, since: Date) {
    const result = await this.workspaceQuery(
      workspaceId,
      `SELECT count(*)::integer AS count FROM participant_signal_events
       WHERE workspace_id = $1 AND session_id = $2 AND created_at >= $3`,
      [workspaceId, sessionId, since],
    );
    return Number(result.rows[0]?.count ?? 0);
  }

  async setParticipantSignal(
    input: {
      workspaceId: string;
      sessionId: string;
      contextKey: string;
      participantId: string;
      signal: ParticipantSignalRecord["signal"] | null;
      now: Date;
    },
    eventInput: AudienceEventInput,
  ): Promise<AudienceMutation<ParticipantSignalRecord | null>> {
    return this.transaction(
      async (client) => {
        await this.lockInteractionSettings(client, input.workspaceId, input.sessionId);
        const existingEvent = await this.existingAudienceEvent(
          client,
          input.sessionId,
          eventInput.idempotencyKey,
        );
        if (existingEvent) {
          const current = await client.query(
            `SELECT * FROM participant_signal_state
             WHERE session_id = $1 AND context_key = $2 AND participant_id = $3`,
            [input.sessionId, input.contextKey, input.participantId],
          );
          return {
            record: current.rows[0] ? mapParticipantSignal(current.rows[0]) : null,
            event: existingEvent,
            duplicate: true,
          };
        }
        const restriction = await client.query(
          `SELECT banned_at FROM session_audience_restrictions
           WHERE session_id = $1 AND participant_id = $2`,
          [input.sessionId, input.participantId],
        );
        if (restriction.rows[0]?.banned_at) {
          throw new AudienceStoreError(
            "AUDIENCE_BANNED",
            "Audience interaction access was revoked",
          );
        }
        const recent = await client.query(
          `SELECT count(*)::integer AS count FROM participant_signal_events
           WHERE session_id = $1 AND participant_id = $2 AND created_at > $3`,
          [input.sessionId, input.participantId, new Date(input.now.getTime() - 60_000)],
        );
        if (Number(recent.rows[0]?.count ?? 0) >= 30) {
          throw new AudienceStoreError(
            "SIGNAL_RATE_LIMITED",
            "Too many pulse changes; wait before trying again",
          );
        }
        let record: ParticipantSignalRecord | null = null;
        if (input.signal) {
          const saved = await client.query(
            `INSERT INTO participant_signal_state
               (workspace_id, session_id, context_key, participant_id, signal, updated_at)
             VALUES ($1,$2,$3,$4,$5,$6)
             ON CONFLICT (session_id, context_key, participant_id) DO UPDATE SET
               signal = EXCLUDED.signal, updated_at = EXCLUDED.updated_at
             RETURNING *`,
            [
              input.workspaceId,
              input.sessionId,
              input.contextKey,
              input.participantId,
              input.signal,
              input.now,
            ],
          );
          record = mapParticipantSignal(saved.rows[0]!);
        } else {
          await client.query(
            `DELETE FROM participant_signal_state
             WHERE workspace_id = $1 AND session_id = $2 AND context_key = $3
               AND participant_id = $4`,
            [input.workspaceId, input.sessionId, input.contextKey, input.participantId],
          );
        }
        const event = await this.appendAudienceEventLocked(
          client,
          input.workspaceId,
          input.sessionId,
          eventInput,
          input.now,
        );
        await client.query(
          `INSERT INTO participant_signal_events
             (id, workspace_id, session_id, context_key, participant_id, signal,
              idempotency_key, audience_seq, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [
            eventInput.eventId,
            input.workspaceId,
            input.sessionId,
            input.contextKey,
            input.participantId,
            input.signal,
            eventInput.idempotencyKey,
            event.audienceSeq,
            input.now,
          ],
        );
        return { record, event, duplicate: false };
      },
      { workspaceId: input.workspaceId },
    );
  }

  async getChatMessage(workspaceId: string, messageId: string) {
    const result = await this.workspaceQuery(
      workspaceId,
      `SELECT * FROM chat_messages WHERE workspace_id = $1 AND id = $2`,
      [workspaceId, messageId],
    );
    return result.rows[0] ? mapChatMessage(result.rows[0]) : null;
  }

  async listChatMessages(
    workspaceId: string,
    sessionId: string,
    options: ChatMessageListOptions = {},
  ) {
    const values: unknown[] = [workspaceId, sessionId];
    const predicates = ["workspace_id = $1", "session_id = $2"];
    if (options.pinnedOnly) predicates.push("pinned = true");
    if (options.cursor) {
      values.push(options.cursor.createdAt, options.cursor.id);
      predicates.push(`(created_at, id) < ($${values.length - 1}, $${values.length}::uuid)`);
    }
    const limit = options.limit;
    if (limit !== undefined) values.push(limit);
    const result = await this.workspaceQuery(
      workspaceId,
      `SELECT * FROM chat_messages WHERE ${predicates.join(" AND ")}
       ORDER BY created_at DESC, id DESC${limit !== undefined ? ` LIMIT $${values.length}` : ""}`,
      values,
    );
    return result.rows.map(mapChatMessage);
  }

  async createChatMessage(
    input: Omit<ChatMessageRecord, "audienceSeq">,
    eventInput: AudienceEventInput,
  ): Promise<AudienceMutation<ChatMessageRecord>> {
    return this.transaction(
      async (client) => {
        const settings = await this.lockInteractionSettings(
          client,
          input.workspaceId,
          input.sessionId,
        );
        const existingEvent = await this.existingAudienceEvent(
          client,
          input.sessionId,
          eventInput.idempotencyKey,
        );
        if (existingEvent) {
          const existing = await client.query(
            `SELECT * FROM chat_messages WHERE session_id = $1 AND idempotency_key = $2`,
            [input.sessionId, eventInput.idempotencyKey],
          );
          if (!existing.rows[0]) {
            throw new AudienceStoreError("CONFLICT", "The chat request could not be reconciled");
          }
          return {
            record: mapChatMessage(existing.rows[0]),
            event: existingEvent,
            duplicate: true,
          };
        }
        if (!settings.chatEnabled) {
          throw new AudienceStoreError("CHAT_DISABLED", "Chat is disabled for this live round");
        }
        if (input.replyToId) {
          const parent = await client.query(
            `SELECT reply_to_id, status FROM chat_messages WHERE session_id = $1 AND id = $2`,
            [input.sessionId, input.replyToId],
          );
          if (!parent.rows[0] || parent.rows[0].status === "removed") {
            throw new AudienceStoreError(
              "NOT_FOUND",
              "The chat message being replied to was not found",
            );
          }
          if (parent.rows[0].reply_to_id) {
            throw new AudienceStoreError("CONFLICT", "Chat supports one level of replies");
          }
        }
        const sessionCount = await client.query(
          `SELECT count(*)::integer AS count FROM chat_messages WHERE session_id = $1`,
          [input.sessionId],
        );
        if (Number(sessionCount.rows[0]?.count ?? 0) >= 10_000) {
          throw new AudienceStoreError(
            "CHAT_CAPACITY_REACHED",
            "This round has reached its chat message limit",
          );
        }
        if (input.participantId) {
          const restriction = await client.query(
            `SELECT muted_until, banned_at FROM session_audience_restrictions
             WHERE session_id = $1 AND participant_id = $2`,
            [input.sessionId, input.participantId],
          );
          if (restriction.rows[0]?.banned_at) {
            throw new AudienceStoreError(
              "AUDIENCE_BANNED",
              "Audience interaction access was revoked",
            );
          }
          if (
            restriction.rows[0]?.muted_until &&
            date(restriction.rows[0].muted_until) > input.createdAt
          ) {
            throw new AudienceStoreError(
              "CHAT_MUTED",
              "Chat is temporarily muted for this participant",
            );
          }
          const participantCount = await client.query(
            `SELECT count(*)::integer AS session_count,
                    count(*) FILTER (WHERE created_at > $3)::integer AS minute_count,
                    max(created_at) AS latest_at
             FROM chat_messages WHERE session_id = $1 AND participant_id = $2`,
            [input.sessionId, input.participantId, new Date(input.createdAt.getTime() - 60_000)],
          );
          const counts = participantCount.rows[0]!;
          if (Number(counts.session_count) >= 200) {
            throw new AudienceStoreError(
              "CHAT_CAPACITY_REACHED",
              "This participant has reached the session chat limit",
            );
          }
          if (Number(counts.minute_count) >= 12) {
            throw new AudienceStoreError(
              "CHAT_RATE_LIMITED",
              "Too many messages; wait before posting again",
            );
          }
          if (
            counts.latest_at &&
            input.createdAt.getTime() - date(counts.latest_at).getTime() <
              settings.slowModeSeconds * 1_000
          ) {
            throw new AudienceStoreError(
              "CHAT_RATE_LIMITED",
              `Slow mode allows one message every ${settings.slowModeSeconds} seconds`,
            );
          }
        }
        const event = await this.appendAudienceEventLocked(
          client,
          input.workspaceId,
          input.sessionId,
          eventInput,
          input.createdAt,
        );
        const inserted = await client.query(
          `INSERT INTO chat_messages
             (id, workspace_id, session_id, participant_id, actor_id, staff_credential_id,
              reply_to_id, body, author_alias, identity_mode_at_creation, status, pinned,
              idempotency_key, audience_seq, created_at, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *`,
          [
            input.id,
            input.workspaceId,
            input.sessionId,
            input.participantId,
            input.actorId,
            input.staffCredentialId,
            input.replyToId,
            input.body,
            input.authorAlias,
            settings.chatIdentityMode,
            input.status,
            input.pinned,
            input.idempotencyKey,
            event.audienceSeq,
            input.createdAt,
            input.updatedAt,
          ],
        );
        return { record: mapChatMessage(inserted.rows[0]!), event, duplicate: false };
      },
      { workspaceId: input.workspaceId },
    );
  }

  async updateChatMessage(
    workspaceId: string,
    sessionId: string,
    messageId: string,
    update: { status?: ChatMessageRecord["status"]; pinned?: boolean },
    eventInput: AudienceEventInput,
    updatedAt: Date,
  ): Promise<AudienceMutation<ChatMessageRecord>> {
    return this.transaction(
      async (client) => {
        await this.lockInteractionSettings(client, workspaceId, sessionId);
        const existingEvent = await this.existingAudienceEvent(
          client,
          sessionId,
          eventInput.idempotencyKey,
        );
        if (existingEvent) {
          const current = await client.query(
            `SELECT * FROM chat_messages WHERE workspace_id = $1 AND session_id = $2 AND id = $3`,
            [workspaceId, sessionId, messageId],
          );
          if (!current.rows[0]) throw new AudienceStoreError("NOT_FOUND", "Chat message not found");
          return {
            record: mapChatMessage(current.rows[0]),
            event: existingEvent,
            duplicate: true,
          };
        }
        const event = await this.appendAudienceEventLocked(
          client,
          workspaceId,
          sessionId,
          eventInput,
          updatedAt,
        );
        const result = await client.query(
          `UPDATE chat_messages SET
             status = COALESCE($4::text, status), pinned = COALESCE($5::boolean, pinned),
             audience_seq = $6, updated_at = $7
           WHERE workspace_id = $1 AND session_id = $2 AND id = $3 RETURNING *`,
          [
            workspaceId,
            sessionId,
            messageId,
            update.status ?? null,
            update.pinned ?? null,
            event.audienceSeq,
            updatedAt,
          ],
        );
        if (!result.rows[0]) throw new AudienceStoreError("NOT_FOUND", "Chat message not found");
        return { record: mapChatMessage(result.rows[0]), event, duplicate: false };
      },
      { workspaceId },
    );
  }

  async listChatReactions(workspaceId: string, sessionId: string, messageIds?: string[]) {
    if (messageIds?.length === 0) return [];
    const result = await this.workspaceQuery(
      workspaceId,
      `SELECT * FROM chat_message_reactions
       WHERE workspace_id = $1 AND session_id = $2
         ${messageIds ? "AND message_id = ANY($3::uuid[])" : ""}`,
      messageIds ? [workspaceId, sessionId, messageIds] : [workspaceId, sessionId],
    );
    return result.rows.map(mapChatReaction);
  }

  async getChatActivitySummary(workspaceId: string, sessionId: string, since: Date) {
    const result = await this.workspaceQuery(
      workspaceId,
      `SELECT
         count(*) FILTER (WHERE status = 'published' AND created_at >= $3)::integer
           AS messages_last_minute,
         count(DISTINCT COALESCE(
           participant_id::text,
           'actor:' || actor_id::text,
           'staff:' || staff_credential_id::text
         )) FILTER (WHERE status = 'published')::integer AS unique_contributors,
         count(*) FILTER (WHERE status = 'removed')::integer AS removed_messages,
         (SELECT count(*)::integer FROM chat_message_reports
          WHERE workspace_id = $1 AND session_id = $2) AS report_count
       FROM chat_messages WHERE workspace_id = $1 AND session_id = $2`,
      [workspaceId, sessionId, since],
    );
    const row = result.rows[0];
    return {
      messagesLastMinute: Number(row?.messages_last_minute ?? 0),
      uniqueContributors: Number(row?.unique_contributors ?? 0),
      removedMessages: Number(row?.removed_messages ?? 0),
      reportCount: Number(row?.report_count ?? 0),
    };
  }

  async listParticipantChatActivity(workspaceId: string, sessionId: string) {
    const result = await this.workspaceQuery(
      workspaceId,
      `SELECT participant_id, count(*)::integer AS message_count, max(created_at) AS latest_message_at
       FROM chat_messages
       WHERE workspace_id = $1 AND session_id = $2 AND participant_id IS NOT NULL
       GROUP BY participant_id`,
      [workspaceId, sessionId],
    );
    return result.rows.map((row) => ({
      participantId: String(row.participant_id),
      messageCount: Number(row.message_count),
      latestMessageAt: row.latest_message_at ? date(row.latest_message_at) : null,
    }));
  }

  async setChatReaction(
    input: {
      workspaceId: string;
      sessionId: string;
      messageId: string;
      participantId: string;
      reaction: ChatReactionRecord["reaction"] | null;
      now: Date;
    },
    eventInput: AudienceEventInput,
  ): Promise<AudienceMutation<ChatReactionSummaryRecord>> {
    return this.transaction(
      async (client) => {
        await this.lockInteractionSettings(client, input.workspaceId, input.sessionId);
        const existingEvent = await this.existingAudienceEvent(
          client,
          input.sessionId,
          eventInput.idempotencyKey,
        );
        if (existingEvent) {
          return {
            record: await this.chatReactionSummary(client, input.messageId, input.participantId),
            event: existingEvent,
            duplicate: true,
          };
        }
        const message = await client.query(
          `SELECT status FROM chat_messages WHERE session_id = $1 AND id = $2`,
          [input.sessionId, input.messageId],
        );
        if (!message.rows[0]) throw new AudienceStoreError("NOT_FOUND", "Chat message not found");
        if (message.rows[0].status === "removed") {
          throw new AudienceStoreError(
            "MESSAGE_REMOVED",
            "Removed messages cannot receive reactions",
          );
        }
        if (input.reaction) {
          await client.query(
            `INSERT INTO chat_message_reactions
               (workspace_id, session_id, message_id, participant_id, reaction, updated_at)
             VALUES ($1,$2,$3,$4,$5,$6)
             ON CONFLICT (message_id, participant_id) DO UPDATE SET
               reaction = EXCLUDED.reaction, updated_at = EXCLUDED.updated_at`,
            [
              input.workspaceId,
              input.sessionId,
              input.messageId,
              input.participantId,
              input.reaction,
              input.now,
            ],
          );
        } else {
          await client.query(
            `DELETE FROM chat_message_reactions
             WHERE workspace_id = $1 AND session_id = $2 AND message_id = $3
               AND participant_id = $4`,
            [input.workspaceId, input.sessionId, input.messageId, input.participantId],
          );
        }
        const event = await this.appendAudienceEventLocked(
          client,
          input.workspaceId,
          input.sessionId,
          eventInput,
          input.now,
        );
        return {
          record: await this.chatReactionSummary(client, input.messageId, input.participantId),
          event,
          duplicate: false,
        };
      },
      { workspaceId: input.workspaceId },
    );
  }

  async reportChatMessage(
    workspaceId: string,
    sessionId: string,
    messageId: string,
    participantId: string,
    now: Date,
    eventInput: AudienceEventInput,
  ): Promise<AudienceMutation<number>> {
    return this.transaction(
      async (client) => {
        await this.lockInteractionSettings(client, workspaceId, sessionId);
        const existingEvent = await this.existingAudienceEvent(
          client,
          sessionId,
          eventInput.idempotencyKey,
        );
        if (!existingEvent) {
          const inserted = await client.query(
            `INSERT INTO chat_message_reports
               (workspace_id, session_id, message_id, participant_id, created_at)
             SELECT $1,$2,$3,$4,$5 FROM chat_messages
             WHERE workspace_id = $1 AND session_id = $2 AND id = $3
             ON CONFLICT (message_id, participant_id) DO NOTHING`,
            [workspaceId, sessionId, messageId, participantId, now],
          );
          if (inserted.rowCount === 0) {
            const exists = await client.query(
              `SELECT 1 FROM chat_messages WHERE workspace_id = $1 AND session_id = $2 AND id = $3`,
              [workspaceId, sessionId, messageId],
            );
            if (!exists.rows[0])
              throw new AudienceStoreError("NOT_FOUND", "Chat message not found");
          }
        }
        const event =
          existingEvent ??
          (await this.appendAudienceEventLocked(client, workspaceId, sessionId, eventInput, now));
        const count = await client.query(
          `SELECT count(*)::integer AS count FROM chat_message_reports WHERE message_id = $1`,
          [messageId],
        );
        return {
          record: Number(count.rows[0]?.count ?? 0),
          event,
          duplicate: Boolean(existingEvent),
        };
      },
      { workspaceId },
    );
  }

  async countChatReports(workspaceId: string, sessionId: string) {
    const result = await this.workspaceQuery(
      workspaceId,
      `SELECT count(*)::integer AS count FROM chat_message_reports
       WHERE workspace_id = $1 AND session_id = $2`,
      [workspaceId, sessionId],
    );
    return Number(result.rows[0]?.count ?? 0);
  }

  async getAudienceRestriction(workspaceId: string, sessionId: string, participantId: string) {
    const result = await this.workspaceQuery(
      workspaceId,
      `SELECT * FROM session_audience_restrictions
       WHERE workspace_id = $1 AND session_id = $2 AND participant_id = $3`,
      [workspaceId, sessionId, participantId],
    );
    return result.rows[0] ? mapAudienceRestriction(result.rows[0]) : null;
  }

  async listAudienceRestrictions(workspaceId: string, sessionId: string) {
    const result = await this.workspaceQuery(
      workspaceId,
      `SELECT * FROM session_audience_restrictions
       WHERE workspace_id = $1 AND session_id = $2`,
      [workspaceId, sessionId],
    );
    return result.rows.map(mapAudienceRestriction);
  }

  async saveAudienceRestriction(
    input: AudienceRestrictionRecord,
    eventInput: AudienceEventInput,
  ): Promise<AudienceMutation<AudienceRestrictionRecord>> {
    return this.transaction(
      async (client) => {
        await this.lockInteractionSettings(client, input.workspaceId, input.sessionId);
        const existingEvent = await this.existingAudienceEvent(
          client,
          input.sessionId,
          eventInput.idempotencyKey,
        );
        if (existingEvent) {
          const current = await client.query(
            `SELECT * FROM session_audience_restrictions
             WHERE session_id = $1 AND participant_id = $2`,
            [input.sessionId, input.participantId],
          );
          if (!current.rows[0]) {
            throw new AudienceStoreError(
              "CONFLICT",
              "The moderation request could not be reconciled",
            );
          }
          return {
            record: mapAudienceRestriction(current.rows[0]),
            event: existingEvent,
            duplicate: true,
          };
        }
        const result = await client.query(
          `INSERT INTO session_audience_restrictions
             (workspace_id, session_id, participant_id, muted_until, banned_at, actor_id,
              staff_credential_id, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
           ON CONFLICT (session_id, participant_id) DO UPDATE SET
             muted_until = EXCLUDED.muted_until, banned_at = EXCLUDED.banned_at,
             actor_id = EXCLUDED.actor_id, staff_credential_id = EXCLUDED.staff_credential_id,
             updated_at = EXCLUDED.updated_at
           RETURNING *`,
          [
            input.workspaceId,
            input.sessionId,
            input.participantId,
            input.mutedUntil,
            input.bannedAt,
            input.actorId,
            input.staffCredentialId,
            input.updatedAt,
          ],
        );
        if (input.bannedAt) {
          await client.query(
            `INSERT INTO qna_bans (workspace_id, session_id, participant_id, actor_id)
             VALUES ($1,$2,$3,$4) ON CONFLICT (session_id, participant_id) DO NOTHING`,
            [input.workspaceId, input.sessionId, input.participantId, input.actorId],
          );
        } else {
          await client.query(
            `DELETE FROM qna_bans
             WHERE workspace_id = $1 AND session_id = $2 AND participant_id = $3`,
            [input.workspaceId, input.sessionId, input.participantId],
          );
        }
        const event = await this.appendAudienceEventLocked(
          client,
          input.workspaceId,
          input.sessionId,
          eventInput,
          input.updatedAt,
        );
        return {
          record: mapAudienceRestriction(result.rows[0]!),
          event,
          duplicate: false,
        };
      },
      { workspaceId: input.workspaceId },
    );
  }

  async claimAudienceOutbox(now: Date, staleBefore: Date) {
    return this.transaction(
      async (client) => {
        const result = await client.query(
          `WITH candidate AS (
             SELECT event_id FROM audience_outbox
             WHERE delivered_at IS NULL AND (claimed_at IS NULL OR claimed_at < $2)
             ORDER BY created_at, event_id FOR UPDATE SKIP LOCKED LIMIT 1
           )
           UPDATE audience_outbox SET claimed_at = $1, attempts = attempts + 1
           WHERE event_id = (SELECT event_id FROM candidate) RETURNING *`,
          [now, staleBefore],
        );
        return result.rows[0] ? mapAudienceOutbox(result.rows[0]) : null;
      },
      { system: true },
    );
  }

  async completeAudienceOutbox(eventId: string, deliveredAt: Date) {
    const result = await this.systemQuery(
      `UPDATE audience_outbox SET delivered_at = $2, claimed_at = NULL
       WHERE event_id = $1 AND delivered_at IS NULL RETURNING event_id`,
      [eventId, deliveredAt],
    );
    return result.rowCount === 1;
  }

  async getAudienceOutboxStatus() {
    const result = await this.systemQuery(
      `SELECT
         (SELECT count(*)::integer FROM audience_outbox WHERE delivered_at IS NULL) AS pending,
         (SELECT min(created_at) FROM audience_outbox WHERE delivered_at IS NULL)
           AS oldest_created_at,
         (SELECT count(*)::integer FROM session_interaction_settings settings
          JOIN game_sessions session ON session.id = settings.session_id
          WHERE settings.chat_enabled AND session.ended_at IS NULL
            AND session.deleted_at IS NULL AND session.expires_at > now())
           AS chat_enabled_sessions`,
    );
    return {
      pending: Number(result.rows[0]?.pending ?? 0),
      oldestCreatedAt: result.rows[0]?.oldest_created_at
        ? date(result.rows[0].oldest_created_at)
        : null,
      chatEnabledSessions: Number(result.rows[0]?.chat_enabled_sessions ?? 0),
    };
  }

  async getSessionEvidence(workspaceId: string, sessionId: string) {
    return this.transaction(
      async (client) => {
        const answerResult = await client.query(
          "SELECT * FROM answers WHERE workspace_id = $1 AND session_id = $2 ORDER BY accepted_at, id",
          [workspaceId, sessionId],
        );
        const sessionResult = await client.query<{ decision_replay_enabled: boolean }>(
          `SELECT decision_replay_enabled FROM game_sessions
           WHERE workspace_id = $1 AND id = $2`,
          [workspaceId, sessionId],
        );
        const decisionResult = await client.query<{ type: string; payload: unknown }>(
          `SELECT type, payload FROM session_events
           WHERE workspace_id = $1 AND session_id = $2 AND type LIKE 'decision.%'
           ORDER BY seq ASC LIMIT $3`,
          [workspaceId, sessionId, MAX_SESSION_DECISION_EVENTS + 1],
        );
        const decisionEvents = decisionResult.rows.map((row) => {
          const event = SessionDecisionEventSchema.parse(row.payload);
          if (row.type !== `decision.${event.type}`) {
            throw new Error("Stored decision event type does not match its payload");
          }
          return event;
        });
        const roundResult = await client.query(
          `SELECT * FROM question_rounds WHERE session_id = $1 ORDER BY opened_at, id`,
          [sessionId],
        );
        const interventionResult = await client.query(
          `SELECT * FROM session_interventions
           WHERE workspace_id = $1 AND session_id = $2 ORDER BY started_at, id`,
          [workspaceId, sessionId],
        );
        const qnaResult = await client.query(
          `SELECT
             count(*) FILTER (WHERE status <> 'removed')::integer AS questions,
             count(*) FILTER (WHERE status = 'answered')::integer AS answered,
             count(*) FILTER (WHERE status IN ('pending', 'published'))::integer AS unresolved
           FROM qna_questions WHERE workspace_id = $1 AND session_id = $2`,
          [workspaceId, sessionId],
        );
        const signalResult = await client.query(
          `SELECT context_key, participant_id, signal, created_at
           FROM participant_signal_events
           WHERE workspace_id = $1 AND session_id = $2 ORDER BY created_at, id`,
          [workspaceId, sessionId],
        );
        const chatResult = await client.query(
          `SELECT * FROM chat_messages WHERE workspace_id = $1 AND session_id = $2
           ORDER BY created_at, id`,
          [workspaceId, sessionId],
        );
        const reactionResult = await client.query(
          `SELECT * FROM chat_message_reactions WHERE workspace_id = $1 AND session_id = $2`,
          [workspaceId, sessionId],
        );
        const interactionCountResult = await client.query(
          `SELECT
             (SELECT count(*)::integer FROM chat_message_reports
              WHERE workspace_id = $1 AND session_id = $2) AS reports,
             (SELECT count(*)::integer FROM audience_outbox
              WHERE workspace_id = $1 AND session_id = $2
                AND event_type IN ('audience.moderation.updated', 'chat.message.removed'))
               AS moderation_actions`,
          [workspaceId, sessionId],
        );
        return {
          decisionReplayEnabled: sessionResult.rows[0]?.decision_replay_enabled === true,
          decisionEvents,
          decisionEventsComplete:
            sessionResult.rows[0]?.decision_replay_enabled === true &&
            decisionEvents.some((event) => event.type !== "capture_truncated") &&
            !decisionEvents.some((event) => event.type === "capture_truncated"),
          answers: answerResult.rows.map(mapAnswer),
          rounds: roundResult.rows.map((row) => ({
            id: String(row.id),
            questionId: String(row.question_id),
            position: Number(row.position),
            kind: row.round_kind,
            sourceRoundId: row.source_round_id,
            interventionId: row.intervention_id,
            openedAtMs: date(row.opened_at).getTime(),
            deadlineMs: row.deadline ? date(row.deadline).getTime() : null,
            lockedAtMs: row.locked_at ? date(row.locked_at).getTime() : null,
          })),
          interventions: interventionResult.rows.map((row) => ({
            id: String(row.id),
            type: row.kind,
            sourceRoundId: String(row.source_round_id),
            startedAtMs: date(row.started_at).getTime(),
            finishedAtMs: row.finished_at ? date(row.finished_at).getTime() : null,
            ...(row.recovery_pack_card
              ? { recoveryPackCard: RecoveryPackCardReferenceSchema.parse(row.recovery_pack_card) }
              : {}),
          })),
          qna: {
            questions: Number(qnaResult.rows[0]?.questions ?? 0),
            answered: Number(qnaResult.rows[0]?.answered ?? 0),
            unresolved: Number(qnaResult.rows[0]?.unresolved ?? 0),
          },
          interactions: {
            signalEvents: signalResult.rows.map((row) => ({
              contextKey: String(row.context_key),
              participantId: String(row.participant_id),
              signal: row.signal,
              createdAt: date(row.created_at),
            })),
            chatMessages: chatResult.rows.map(mapChatMessage),
            reactions: reactionResult.rows.map(mapChatReaction),
            reports: Number(interactionCountResult.rows[0]?.reports ?? 0),
            moderationActions: Number(interactionCountResult.rows[0]?.moderation_actions ?? 0),
          },
        };
      },
      { workspaceId },
    );
  }

  async findAnswers(workspaceId: string, sessionId: string, lookups: AnswerLookup[]) {
    if (lookups.length === 0) return [];
    const result = await this.workspaceQuery(
      workspaceId,
      `WITH lookup_pairs AS (
         SELECT * FROM jsonb_to_recordset($4::jsonb) AS input(
           participant_id uuid, round_id uuid
         )
       )
       SELECT answer.* FROM answers AS answer
       WHERE answer.workspace_id = $1 AND answer.session_id = $2
         AND (
           answer.idempotency_key = ANY($3::text[])
           OR EXISTS (
             SELECT 1 FROM lookup_pairs
             WHERE lookup_pairs.participant_id = answer.participant_id
               AND lookup_pairs.round_id = answer.round_id
           )
         )
       ORDER BY answer.accepted_at, answer.id`,
      [
        workspaceId,
        sessionId,
        lookups.map((lookup) => lookup.idempotencyKey),
        JSON.stringify(
          lookups.map((lookup) => ({
            participant_id: lookup.participantId,
            round_id: lookup.roundId,
          })),
        ),
      ],
    );
    return result.rows.map(mapAnswer);
  }

  async findParticipantIdsWithAnswers(
    workspaceId: string,
    sessionId: string,
    participantIds: string[],
  ) {
    if (participantIds.length === 0) return [];
    const result = await this.workspaceQuery(
      workspaceId,
      `SELECT DISTINCT participant_id::text AS participant_id
       FROM answers
       WHERE workspace_id = $1 AND session_id = $2
         AND participant_id = ANY($3::uuid[])
       ORDER BY participant_id::text`,
      [workspaceId, sessionId, participantIds],
    );
    return result.rows.map((row) => String(row.participant_id));
  }

  async createMediaAsset(input: MediaAssetCreateInput) {
    const result = await this.workspaceQuery(
      input.workspaceId,
      `WITH eligible_workspace AS (
         SELECT id FROM workspaces
         WHERE id = $2 AND deletion_started_at IS NULL
         FOR SHARE
       )
       INSERT INTO media_assets
         (id, workspace_id, object_key, mime_type, size_bytes, scan_status, alt_text, created_at)
       SELECT $1, eligible_workspace.id, $3, $4, $5, $6, $7, $8
       FROM eligible_workspace
       RETURNING *`,
      [
        input.id,
        input.workspaceId,
        input.objectKey,
        input.mimeType,
        input.sizeBytes,
        input.scanStatus,
        input.altText,
        input.createdAt,
      ],
    );
    if (!result.rows[0]) throw new Error("Workspace deletion is in progress");
    return mapMediaAsset(result.rows[0]!);
  }

  async getMediaAsset(workspaceId: string, mediaId: string) {
    const result = await this.workspaceQuery(
      workspaceId,
      "SELECT * FROM media_assets WHERE workspace_id = $1 AND id = $2",
      [workspaceId, mediaId],
    );
    return result.rows[0] ? mapMediaAsset(result.rows[0]) : null;
  }

  async listMediaAssets(workspaceId: string) {
    const result = await this.workspaceQuery(
      workspaceId,
      "SELECT * FROM media_assets WHERE workspace_id = $1 ORDER BY created_at, id",
      [workspaceId],
    );
    return result.rows.map(mapMediaAsset);
  }

  async listMediaReferences(workspaceId: string, mediaId?: string) {
    const result = await this.workspaceQuery(
      workspaceId,
      `SELECT * FROM media_references
       WHERE workspace_id = $1 AND ($2::uuid IS NULL OR media_id = $2)
       ORDER BY created_at, owner_type, owner_id`,
      [workspaceId, mediaId ?? null],
    );
    return result.rows.map(mapMediaReference);
  }

  async replaceMediaReferences(
    workspaceId: string,
    ownerType: MediaReferenceOwnerType,
    ownerId: string,
    mediaIds: string[],
    createdAt = new Date(),
  ) {
    return this.transaction(
      async (client) => {
        const uniqueMediaIds = [...new Set(mediaIds)];
        if (uniqueMediaIds.length > 0) {
          const existing = await client.query<{ id: string }>(
            `SELECT id FROM media_assets
             WHERE workspace_id = $1 AND id = ANY($2::uuid[])
               AND scan_status <> 'deleting'
             ORDER BY id
             FOR UPDATE`,
            [workspaceId, uniqueMediaIds],
          );
          const existingIds = new Set(existing.rows.map(({ id }) => String(id)));
          const invalidMediaId = uniqueMediaIds.find((mediaId) => !existingIds.has(mediaId));
          if (invalidMediaId) {
            throw new Error(`Media asset ${invalidMediaId} is unavailable in this workspace`);
          }
        }
        await client.query(
          `DELETE FROM media_references
           WHERE workspace_id = $1 AND owner_type = $2 AND owner_id = $3`,
          [workspaceId, ownerType, ownerId],
        );
        if (uniqueMediaIds.length > 0) {
          await client.query(
            `INSERT INTO media_references
               (workspace_id, media_id, owner_type, owner_id, created_at)
             SELECT $1, asset.id, $2, $3, $5
             FROM media_assets asset
             WHERE asset.workspace_id = $1 AND asset.id = ANY($4::uuid[])
             ON CONFLICT DO NOTHING`,
            [workspaceId, ownerType, ownerId, uniqueMediaIds, createdAt],
          );
        }
        const result = await client.query(
          `SELECT * FROM media_references
           WHERE workspace_id = $1 AND owner_type = $2 AND owner_id = $3
           ORDER BY created_at, media_id`,
          [workspaceId, ownerType, ownerId],
        );
        return result.rows.map(mapMediaReference);
      },
      { workspaceId },
    );
  }

  async listStaleMedia(cutoff: Date, limit = 100) {
    const result = await this.systemQuery(
      `SELECT asset.* FROM media_assets asset
       WHERE (asset.scan_status = 'deleting'
              OR (asset.scan_status <> 'clean' AND asset.created_at <= $1))
         AND NOT EXISTS (
           SELECT 1 FROM media_references reference
           WHERE reference.workspace_id = asset.workspace_id AND reference.media_id = asset.id
         )
       ORDER BY created_at, id LIMIT $2`,
      [cutoff, limit],
    );
    return result.rows.map(mapMediaAsset);
  }

  async listUnattachedMedia(cutoff: Date, limit = 100) {
    const result = await this.systemQuery(
      `SELECT asset.* FROM media_assets asset
       WHERE asset.created_at <= $1
         AND NOT EXISTS (
           SELECT 1 FROM media_references reference
           WHERE reference.workspace_id = asset.workspace_id AND reference.media_id = asset.id
         )
       ORDER BY asset.created_at, asset.id LIMIT $2`,
      [cutoff, limit],
    );
    return result.rows.map(mapMediaAsset);
  }

  async claimMediaObjectCleanupCandidates(now: Date, limit = 100) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new Error("Media cleanup batch limit must be between 1 and 100");
    }
    const claimToken = randomUUID();
    const result = await this.systemQuery(
      `WITH due AS (
         SELECT id FROM media_assets
         WHERE scan_status = 'clean' AND object_cleanup_pass < 2
           AND object_cleanup_due_at <= $1
           AND (object_cleanup_claim_token IS NULL
                OR object_cleanup_claimed_at <= $1::timestamptz - interval '5 minutes')
         ORDER BY object_cleanup_due_at, id
         LIMIT $2
         FOR UPDATE SKIP LOCKED
       )
       UPDATE media_assets AS asset
       SET object_cleanup_claim_token = $3, object_cleanup_claimed_at = $1
       FROM due
       WHERE asset.id = due.id
       RETURNING asset.*`,
      [now, limit, claimToken],
    );
    return result.rows
      .sort(
        (left, right) =>
          date(left.object_cleanup_due_at).getTime() -
            date(right.object_cleanup_due_at).getTime() ||
          String(left.id).localeCompare(String(right.id)),
      )
      .map((row): MediaObjectCleanupClaim => ({
        asset: mapMediaAsset(row),
        pass: Number(row.object_cleanup_pass) as 0 | 1,
        claimToken,
      }));
  }

  async completeMediaObjectCleanupClaim(claim: MediaObjectCleanupClaim, completedAt: Date) {
    const { asset, pass, claimToken } = claim;
    if (!asset.finalizedAt) return false;
    const result = await this.workspaceQuery(
      asset.workspaceId,
      `UPDATE media_assets
       SET object_cleanup_pass = CASE WHEN $5 = 0 THEN 1 ELSE 2 END,
           object_cleanup_due_at = CASE WHEN $5 = 0
             THEN GREATEST(finalized_at + interval '6 days', $7::timestamptz + interval '1 hour')
             ELSE NULL END,
           object_cleanup_claim_token = NULL, object_cleanup_claimed_at = NULL
       WHERE workspace_id = $1 AND id = $2 AND scan_status = 'clean'
         AND object_key = $3 AND finalized_at = $4
         AND object_cleanup_pass = $5 AND object_cleanup_claim_token = $6
       RETURNING id`,
      [
        asset.workspaceId,
        asset.id,
        asset.objectKey,
        asset.finalizedAt,
        pass,
        claimToken,
        completedAt,
      ],
    );
    return result.rowCount === 1;
  }

  async renewMediaObjectCleanupClaim(claim: MediaObjectCleanupClaim, renewedAt: Date) {
    const { asset, pass, claimToken } = claim;
    if (!asset.finalizedAt) return false;
    const result = await this.workspaceQuery(
      asset.workspaceId,
      `UPDATE media_assets
       SET object_cleanup_claimed_at = $7
       WHERE workspace_id = $1 AND id = $2 AND scan_status = 'clean'
         AND object_key = $3 AND finalized_at = $4
         AND object_cleanup_pass = $5 AND object_cleanup_claim_token = $6
       RETURNING id`,
      [
        asset.workspaceId,
        asset.id,
        asset.objectKey,
        asset.finalizedAt,
        pass,
        claimToken,
        renewedAt,
      ],
    );
    return result.rowCount === 1;
  }

  async deferMediaObjectCleanupClaim(claim: MediaObjectCleanupClaim, retryAt: Date) {
    const { asset, pass, claimToken } = claim;
    if (!asset.finalizedAt) return false;
    const result = await this.workspaceQuery(
      asset.workspaceId,
      `UPDATE media_assets
       SET object_cleanup_due_at = $7,
           object_cleanup_claim_token = NULL, object_cleanup_claimed_at = NULL
       WHERE workspace_id = $1 AND id = $2 AND scan_status = 'clean'
         AND object_key = $3 AND finalized_at = $4
         AND object_cleanup_pass = $5 AND object_cleanup_claim_token = $6
       RETURNING id`,
      [asset.workspaceId, asset.id, asset.objectKey, asset.finalizedAt, pass, claimToken, retryAt],
    );
    return result.rowCount === 1;
  }

  async completeInlineMediaObjectCleanup(asset: MediaAssetRecord, completedAt: Date) {
    if (asset.scanStatus !== "clean" || !asset.finalizedAt) return false;
    const result = await this.workspaceQuery(
      asset.workspaceId,
      `UPDATE media_assets
       SET object_cleanup_pass = 1,
           object_cleanup_due_at = GREATEST(finalized_at + interval '6 days', $5::timestamptz + interval '1 hour')
       WHERE workspace_id = $1 AND id = $2 AND scan_status = 'clean'
         AND object_key = $3 AND finalized_at = $4
         AND object_cleanup_pass = 0 AND object_cleanup_claim_token IS NULL
       RETURNING id`,
      [asset.workspaceId, asset.id, asset.objectKey, asset.finalizedAt, completedAt],
    );
    return result.rowCount === 1;
  }

  async updateMediaAsset(
    workspaceId: string,
    mediaId: string,
    update: {
      objectKey?: string;
      scanStatus: "clean" | "rejected";
      finalizationToken: string;
      finalizedAt: Date;
    },
  ) {
    const result = await this.workspaceQuery(
      workspaceId,
      `UPDATE media_assets
       SET scan_status = $3, object_key = COALESCE($4, object_key),
           finalization_token = NULL, finalization_started_at = NULL,
           deletion_started_at = NULL, finalized_at = $6::timestamptz,
           object_cleanup_pass = 0,
           object_cleanup_due_at = CASE WHEN $3 = 'clean' THEN $6::timestamptz ELSE NULL END,
           object_cleanup_claim_token = NULL, object_cleanup_claimed_at = NULL
       WHERE workspace_id = $1 AND id = $2 AND scan_status = 'finalizing'
         AND finalization_token = $5
       RETURNING *`,
      [
        workspaceId,
        mediaId,
        update.scanStatus,
        update.objectKey ?? null,
        update.finalizationToken,
        update.finalizedAt,
      ],
    );
    return result.rows[0] ? mapMediaAsset(result.rows[0]) : null;
  }

  async claimMediaAssetFinalization(
    workspaceId: string,
    mediaId: string,
    finalizationToken: string,
    claimedAt = new Date(),
  ) {
    return this.transaction(
      async (client) => {
        const claimed = await client.query(
          `UPDATE media_assets
           SET scan_status = 'finalizing', finalization_token = $3,
               finalization_started_at = $4::timestamptz, deletion_started_at = NULL
           WHERE workspace_id = $1 AND id = $2
             AND (
               scan_status = 'pending'
               OR (
                 scan_status = 'finalizing'
                 AND (
                   finalization_started_at IS NULL
                   OR finalization_started_at <= $4::timestamptz - interval '5 minutes'
                 )
               )
             )
           RETURNING *`,
          [workspaceId, mediaId, finalizationToken, claimedAt],
        );
        return claimed.rows[0] ? mapMediaAsset(claimed.rows[0]) : null;
      },
      { workspaceId },
    );
  }

  async releaseMediaAssetFinalization(
    workspaceId: string,
    mediaId: string,
    finalizationToken: string,
  ) {
    const result = await this.workspaceQuery(
      workspaceId,
      `UPDATE media_assets
       SET scan_status = 'pending', finalization_token = NULL,
           finalization_started_at = NULL, deletion_started_at = NULL
       WHERE workspace_id = $1 AND id = $2 AND scan_status = 'finalizing'
         AND finalization_token = $3
       RETURNING id`,
      [workspaceId, mediaId, finalizationToken],
    );
    return result.rowCount === 1;
  }

  async claimMediaAssetDeletion(workspaceId: string, mediaId: string, now = new Date()) {
    return this.transaction(
      async (client) => {
        const current = await client.query(
          `SELECT * FROM media_assets
           WHERE workspace_id = $1 AND id = $2
           FOR UPDATE`,
          [workspaceId, mediaId],
        );
        if (!current.rows[0]) return null;
        const references = await client.query(
          `SELECT 1 FROM media_references
           WHERE workspace_id = $1 AND media_id = $2
           LIMIT 1`,
          [workspaceId, mediaId],
        );
        if (references.rowCount !== 0) return null;
        if (
          current.rows[0].scan_status === "finalizing" &&
          current.rows[0].finalization_started_at &&
          date(current.rows[0].finalization_started_at).getTime() > now.getTime() - 5 * 60_000
        ) {
          return null;
        }
        if (current.rows[0].scan_status === "deleting") {
          return mapMediaAsset(current.rows[0]);
        }
        const claimed = await client.query(
          `UPDATE media_assets
           SET scan_status = 'deleting', finalization_token = NULL,
               finalization_started_at = NULL,
               deletion_started_at = COALESCE(deletion_started_at, $3)
           WHERE workspace_id = $1 AND id = $2
           RETURNING *`,
          [workspaceId, mediaId, now],
        );
        return mapMediaAsset(claimed.rows[0]);
      },
      { workspaceId },
    );
  }

  async claimWorkspaceMediaDeletion(workspaceId: string, now = new Date()) {
    return this.transaction(
      async (client) => {
        const workspace = await client.query(
          `UPDATE workspaces
           SET deletion_started_at = COALESCE(deletion_started_at, $2)
           WHERE id = $1
           RETURNING id`,
          [workspaceId, now],
        );
        if (!workspace.rows[0]) return [];
        const claimed = await client.query(
          `UPDATE media_assets
           SET scan_status = 'deleting', finalization_token = NULL,
               finalization_started_at = NULL,
               deletion_started_at = COALESCE(deletion_started_at, $2)
           WHERE workspace_id = $1
           RETURNING *`,
          [workspaceId, now],
        );
        if ((claimed.rowCount ?? 0) > 0) {
          await client.query(
            `INSERT INTO workspace_media_deletion_jobs
               (workspace_id, deletion_started_at, sweep_after)
             VALUES ($1, $2, $3)
             ON CONFLICT (workspace_id) DO NOTHING`,
            [workspaceId, now, new Date(now.getTime() + MEDIA_DELETION_TOMBSTONE_HOLD_MS)],
          );
        }
        return claimed.rows
          .map(mapMediaAsset)
          .sort(
            (left, right) =>
              left.createdAt.getTime() - right.createdAt.getTime() ||
              left.id.localeCompare(right.id),
          );
      },
      { workspaceId },
    );
  }

  async listDueWorkspaceMediaDeletionJobs(now: Date, limit = 100) {
    const result = await this.systemQuery(
      `SELECT workspace_id, deletion_started_at, sweep_after
       FROM workspace_media_deletion_jobs
       WHERE sweep_after <= $1
       ORDER BY sweep_after, workspace_id
       LIMIT $2`,
      [now, limit],
    );
    return result.rows.map(mapWorkspaceMediaDeletionJob);
  }

  async completeWorkspaceMediaDeletionJob(workspaceId: string, deletionStartedAt: Date) {
    const result = await this.systemQuery(
      `DELETE FROM workspace_media_deletion_jobs
       WHERE workspace_id = $1 AND deletion_started_at = $2
       RETURNING workspace_id`,
      [workspaceId, deletionStartedAt],
    );
    return result.rowCount === 1;
  }

  async deleteMediaAsset(workspaceId: string, mediaId: string, now = new Date()) {
    const result = await this.workspaceQuery(
      workspaceId,
      `DELETE FROM media_assets asset
       WHERE asset.workspace_id = $1 AND asset.id = $2
         AND asset.scan_status = 'deleting'
         AND asset.deletion_started_at <= $3
         AND NOT EXISTS (
           SELECT 1 FROM media_references reference
           WHERE reference.workspace_id = asset.workspace_id AND reference.media_id = asset.id
         )
       RETURNING id`,
      [workspaceId, mediaId, new Date(now.getTime() - MEDIA_DELETION_TOMBSTONE_HOLD_MS)],
    );
    return result.rowCount === 1;
  }

  async persistAnswer(workspaceId: string, sessionId: string, answer: EngineAnswer) {
    const result = await this.workspaceQuery(
      workspaceId,
      `INSERT INTO answers
       (id, workspace_id, session_id, round_id, participant_id, choice_id, accepted_at,
        response_payload, response_schema_version, confidence, response_ms, score, correct,
        idempotency_key)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,2,$9,$10,$11,$12,$13)
       ON CONFLICT (session_id, idempotency_key) DO UPDATE SET idempotency_key = EXCLUDED.idempotency_key
       RETURNING *`,
      [
        answer.answerId,
        workspaceId,
        sessionId,
        answer.roundId,
        answer.participantId,
        answer.choiceId,
        new Date(answer.acceptedAtMs),
        JSON.stringify(answer.response),
        answer.confidence,
        answer.responseMs,
        answer.score,
        answer.correct,
        answer.idempotencyKey,
      ],
    );
    return mapAnswer(result.rows[0]!);
  }

  async commitAnswer(session: StoredSession, answer: EngineAnswer, expectedVersion: number) {
    return (await this.commitAnswers(session, [answer], expectedVersion))[0]!;
  }

  async commitAnswers(
    session: StoredSession,
    answers: EngineAnswer[],
    expectedVersion: number,
    options: { roundEvidencePersisted?: boolean } = {},
  ) {
    if (answers.length === 0) return [];
    return this.transaction(
      async (client) => {
        const workspace = await client.query(
          `SELECT id FROM workspaces
           WHERE id = $1 AND deletion_started_at IS NULL
           FOR SHARE`,
          [session.workspaceId],
        );
        if (!workspace.rows[0]) {
          throw new WorkspaceDeletionInProgressError(session.workspaceId);
        }
        if (!options.roundEvidencePersisted) await this.syncSessionEvidence(client, session);
        const result = await client.query(
          `WITH answer_input AS (
             SELECT * FROM jsonb_to_recordset($1::jsonb) AS input(
               id uuid, round_id uuid, participant_id uuid, choice_id uuid,
               accepted_at timestamptz, response_payload jsonb, confidence smallint,
               response_ms integer, score integer, correct boolean, idempotency_key text
             )
           ),
           persisted_answers AS (
             INSERT INTO answers
                (id, workspace_id, session_id, round_id, participant_id, choice_id, accepted_at,
                response_payload, response_schema_version, confidence, response_ms, score, correct,
                idempotency_key)
             SELECT id, $2, $3, round_id, participant_id, choice_id, accepted_at,
                    response_payload, 2, confidence, response_ms, score, correct, idempotency_key
             FROM answer_input
             ON CONFLICT (session_id, idempotency_key) DO UPDATE
               SET idempotency_key = EXCLUDED.idempotency_key
             RETURNING *
           ),
           session_update AS (
             UPDATE game_sessions SET state = $4, version = $5, seq = $6, deadline = $7,
               state_snapshot = $8, state_schema_version = $11, updated_at = now()
             WHERE id = $3 AND version = $10
             RETURNING id
           ),
           participant_input AS (
             SELECT * FROM jsonb_to_recordset($9::jsonb) AS input(
               id uuid, score integer, correct_count integer, accepted_response_ms bigint
             )
           ),
           participant_update AS (
             UPDATE participants AS participant SET
               score = input.score,
               correct_count = input.correct_count,
               accepted_response_ms = input.accepted_response_ms,
               last_seen_at = now()
             FROM participant_input AS input
             WHERE participant.id = input.id AND participant.session_id = $3
             RETURNING participant.id
           )
           SELECT
             (SELECT count(*) FROM persisted_answers) AS answer_updates,
             (SELECT count(*)
                FROM persisted_answers AS persisted
                JOIN answer_input AS input
                  ON input.idempotency_key = persisted.idempotency_key
                 AND input.id = persisted.id) AS matching_answer_updates,
             (SELECT count(*) FROM session_update) AS session_updates,
             (SELECT count(*) FROM participant_update) AS participant_updates
           `,
          [
            JSON.stringify(
              answers.map((answer) => ({
                id: answer.answerId,
                round_id: answer.roundId,
                participant_id: answer.participantId,
                choice_id: answer.choiceId,
                accepted_at: new Date(answer.acceptedAtMs).toISOString(),
                response_payload: answer.response,
                confidence: answer.confidence,
                response_ms: answer.responseMs,
                score: answer.score,
                correct: answer.correct,
                idempotency_key: answer.idempotencyKey,
              })),
            ),
            session.workspaceId,
            session.id,
            session.state.phase,
            session.state.version,
            session.state.seq,
            session.state.deadlineMs ? new Date(session.state.deadlineMs) : null,
            JSON.stringify(session.state),
            JSON.stringify(
              [...new Set(answers.map((answer) => answer.participantId))].map((participantId) => {
                const participant = session.state.participants[participantId];
                return {
                  id: participantId,
                  score: participant?.score ?? 0,
                  correct_count: participant?.correctCount ?? 0,
                  accepted_response_ms: participant?.acceptedResponseMs ?? 0,
                };
              }),
            ),
            expectedVersion,
            session.state.stateSchemaVersion,
          ],
        );
        if (Number(result.rows[0]?.session_updates ?? 0) !== 1) {
          throw new SessionVersionConflictError(session.id, expectedVersion);
        }
        const expectedParticipantUpdates = new Set(answers.map((answer) => answer.participantId))
          .size;
        if (Number(result.rows[0]?.participant_updates ?? 0) !== expectedParticipantUpdates) {
          throw new Error("Not every answer participant was updated");
        }
        if (Number(result.rows[0]?.answer_updates ?? 0) !== answers.length) {
          throw new Error("Not every committed answer was returned by PostgreSQL");
        }
        if (Number(result.rows[0]?.matching_answer_updates ?? 0) !== answers.length) {
          throw new Error("Answer state changed during persistence");
        }
        return answers;
      },
      { workspaceId: session.workspaceId },
    );
  }

  async saveReport(workspaceId: string, report: Report) {
    await this.workspaceQuery(
      workspaceId,
      `INSERT INTO reports
         (id, workspace_id, session_id, status, metrics, generated_at, schema_version,
          attempts, available_at, last_error, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,0,now(),NULL,now())
       ON CONFLICT (session_id) DO UPDATE SET id = EXCLUDED.id, status = EXCLUDED.status,
       metrics = EXCLUDED.metrics, generated_at = EXCLUDED.generated_at,
       schema_version = EXCLUDED.schema_version, attempts = 0, available_at = now(),
       last_error = NULL, updated_at = now()`,
      [
        report.id,
        workspaceId,
        report.sessionId,
        report.status,
        JSON.stringify(report),
        report.generatedAt,
        report.schemaVersion ?? 1,
      ],
    );
  }

  async claimReportJob(now: Date, leaseUntil: Date): Promise<ReportJob | null> {
    return this.transaction(
      async (client) => {
        const selected = await client.query(
          `SELECT reports.id, reports.workspace_id, reports.session_id, reports.attempts,
                  game_sessions.retention_expires_at
           FROM reports
           JOIN game_sessions ON game_sessions.id = reports.session_id
           WHERE reports.status = 'pending' AND reports.available_at <= $1
           ORDER BY reports.available_at, reports.created_at
           FOR UPDATE OF reports SKIP LOCKED
           LIMIT 1`,
          [now],
        );
        const row = selected.rows[0];
        if (!row) return null;
        const updated = await client.query(
          `UPDATE reports SET attempts = attempts + 1, available_at = $2, updated_at = now()
           WHERE id = $1 AND status = 'pending' RETURNING attempts`,
          [row.id, leaseUntil],
        );
        if (updated.rowCount !== 1) return null;
        return {
          reportId: String(row.id),
          workspaceId: String(row.workspace_id),
          sessionId: String(row.session_id),
          attempts: Number(updated.rows[0]!.attempts),
          expiresAt: date(row.retention_expires_at),
        };
      },
      { system: true },
    );
  }

  async completeReportJob(job: ReportJob, report: Report) {
    if (job.reportId !== report.id || job.sessionId !== report.sessionId) {
      throw new Error("Completed report does not match the claimed job");
    }
    const result = await this.workspaceQuery(
      job.workspaceId,
      `UPDATE reports SET status = 'ready', metrics = $3, generated_at = $4,
         schema_version = $5, last_error = NULL, updated_at = now()
       WHERE id = $1 AND workspace_id = $2 AND session_id = $6 AND status = 'pending'`,
      [
        job.reportId,
        job.workspaceId,
        JSON.stringify(report),
        report.generatedAt,
        report.schemaVersion ?? 1,
        job.sessionId,
      ],
    );
    if (result.rowCount !== 1) throw new Error("The claimed report job is no longer pending");
  }

  async retryReportJob(job: ReportJob, error: string, availableAt: Date, failed: boolean) {
    await this.workspaceQuery(
      job.workspaceId,
      `UPDATE reports SET status = $3, last_error = $4, available_at = $5, updated_at = now()
       WHERE id = $1 AND workspace_id = $2 AND status = 'pending'`,
      [
        job.reportId,
        job.workspaceId,
        failed ? "failed" : "pending",
        error.slice(0, 2_000),
        availableAt,
      ],
    );
  }

  private mapReport(row: QueryResultRow): Report {
    return mapStoredReport(row);
  }

  async getReport(workspaceId: string, reportId: string) {
    const result = await this.workspaceQuery(
      workspaceId,
      `SELECT reports.*, game_sessions.retention_expires_at
       FROM reports JOIN game_sessions ON game_sessions.id = reports.session_id
       WHERE reports.workspace_id = $1 AND reports.id = $2`,
      [workspaceId, reportId],
    );
    return result.rows[0] ? this.mapReport(result.rows[0]) : null;
  }

  async getReportBySession(workspaceId: string, sessionId: string) {
    const result = await this.workspaceQuery(
      workspaceId,
      `SELECT reports.*, game_sessions.retention_expires_at
       FROM reports JOIN game_sessions ON game_sessions.id = reports.session_id
       WHERE reports.workspace_id = $1 AND reports.session_id = $2`,
      [workspaceId, sessionId],
    );
    return result.rows[0] ? this.mapReport(result.rows[0]) : null;
  }

  async listQuestionHealthObservationReports(
    workspaceId: string,
    quizId: string,
    quizVersionId: string,
    now: Date,
  ): Promise<QuestionHealthObservationReportPage> {
    const limit = QUESTION_HEALTH_POST_USE_MAX_REPORTS;
    const result = await this.workspaceQuery(
      workspaceId,
      `SELECT game_sessions.trust_mode,
              COALESCE(reports.metrics->>'timeMode',
                       game_sessions.state_snapshot->'settings'->>'timeMode', 'timed') AS time_mode,
              COALESCE(game_sessions.state_snapshot->'settings'->>'scoringMode',
                       game_sessions.settings->>'scoringMode', 'accuracy') AS scoring_mode,
              reports.metrics->'questions' AS questions
       FROM reports
       JOIN game_sessions ON game_sessions.workspace_id = reports.workspace_id
                         AND game_sessions.id = reports.session_id
       JOIN quiz_versions ON quiz_versions.id = game_sessions.quiz_version_id
       WHERE reports.workspace_id = $1
         AND quiz_versions.workspace_id = $1
         AND quiz_versions.quiz_id = $2
         AND game_sessions.quiz_version_id = $3
         AND reports.status = 'ready'
         AND reports.generated_at IS NOT NULL
         AND game_sessions.retention_expires_at > $4
       ORDER BY reports.generated_at DESC, reports.id DESC
       LIMIT $5`,
      [workspaceId, quizId, quizVersionId, now, limit + 1],
    );
    const reports = result.rows
      .slice(0, limit)
      .flatMap((row): QuestionHealthObservationReport[] => {
        const questions = Array.isArray(row.questions) ? row.questions : [];
        const parsedTrustMode = TrustModeSchema.safeParse(row.trust_mode);
        return [
          {
            trustMode: parsedTrustMode.success ? parsedTrustMode.data : "learning",
            timeMode: row.time_mode === "flex" ? "flex" : "timed",
            scoringMode: row.scoring_mode === "speed" ? "speed" : "accuracy",
            questions: questions.flatMap((candidate: unknown) => {
              if (!candidate || typeof candidate !== "object" || Array.isArray(candidate))
                return [];
              const question = candidate as Record<string, unknown>;
              if (
                typeof question.questionId !== "string" ||
                !Number.isSafeInteger(question.responses) ||
                !Number.isSafeInteger(question.correct) ||
                Number(question.responses) < 0 ||
                Number(question.correct) < 0 ||
                Number(question.correct) > Number(question.responses)
              ) {
                return [];
              }
              const rawDistribution = question.responseDistribution;
              const distribution =
                rawDistribution &&
                typeof rawDistribution === "object" &&
                !Array.isArray(rawDistribution) &&
                (rawDistribution as Record<string, unknown>).kind === "choice" &&
                Array.isArray((rawDistribution as Record<string, unknown>).buckets)
                  ? {
                      kind: "choice" as const,
                      buckets: (
                        (rawDistribution as Record<string, unknown>).buckets as unknown[]
                      ).flatMap((bucket) => {
                        if (!bucket || typeof bucket !== "object" || Array.isArray(bucket)) {
                          return [];
                        }
                        const value = (bucket as Record<string, unknown>).value;
                        const count = (bucket as Record<string, unknown>).count;
                        return typeof value === "string" &&
                          Number.isInteger(count) &&
                          Number(count) >= 0
                          ? [{ value, count: Number(count) }]
                          : [];
                      }),
                    }
                  : undefined;
              return [
                {
                  questionId: question.questionId,
                  responses: Number(question.responses),
                  correct: Number(question.correct),
                  ...(distribution ? { responseDistribution: distribution } : {}),
                },
              ];
            }),
          },
        ];
      });
    return { reports, hasMoreReports: result.rows.length > limit };
  }

  async listReportHistory(
    workspaceId: string,
    options: {
      cursor?: HistoryCursor;
      limit: number;
      status?: Report["status"];
      quizId?: string;
      from?: Date;
      to?: Date;
      now: Date;
    },
  ) {
    const result = await this.workspaceQuery(
      workspaceId,
      `SELECT reports.*, game_sessions.retention_expires_at, quiz_versions.quiz_id,
              game_sessions.state_snapshot->'quiz'->>'title' AS quiz_title,
              followups.id AS followup_id,
              to_char(
                reports.created_at AT TIME ZONE 'UTC',
                'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
              ) AS cursor_created_at,
              CASE
                WHEN followups.id IS NULL THEN NULL
                WHEN followups.expires_at <= $8 THEN 'expired'
                WHEN followups.closed_at IS NOT NULL OR followups.closes_at <= $8 THEN 'closed'
                WHEN followups.opens_at > $8 THEN 'scheduled'
                ELSE 'open'
              END AS followup_status
       FROM reports
       JOIN game_sessions ON game_sessions.id = reports.session_id
       JOIN quiz_versions ON quiz_versions.id = game_sessions.quiz_version_id
       LEFT JOIN followups ON followups.source_report_id = reports.id
       WHERE reports.workspace_id = $1
         AND ($2::timestamptz IS NULL OR (reports.created_at, reports.id) < ($2, $3::uuid))
         AND ($4::text IS NULL OR reports.status = $4)
         AND ($5::uuid IS NULL OR quiz_versions.quiz_id = $5)
       AND ($6::timestamptz IS NULL OR reports.created_at >= $6)
       AND ($7::timestamptz IS NULL OR reports.created_at <= $7)
       ORDER BY reports.created_at DESC, reports.id DESC
       LIMIT $9`,
      [
        workspaceId,
        options.cursor?.cursorCreatedAt ?? options.cursor?.createdAt ?? null,
        options.cursor?.id ?? null,
        options.status ?? null,
        options.quizId ?? null,
        options.from ?? null,
        options.to ?? null,
        options.now,
        options.limit + 1,
      ],
    );
    const hasMore = result.rows.length > options.limit;
    return {
      items: result.rows.slice(0, options.limit).map(mapReportHistory),
      hasMore,
    };
  }

  private async insertFollowup(
    client: PoolClient,
    input: FollowupRecord,
    access: FollowupAccessRecord[],
  ) {
    await client.query(
      `INSERT INTO followups
         (id, workspace_id, purpose, source_quiz_version_id, source_session_id,
          source_report_id, trust_mode, title, content, concept_keys, time_mode, generic_token_hash,
          opens_at, closes_at, expires_at, closed_at, created_by, created_at,
          recovery_pack_source, creation_mutation_id, creation_request_hash, recovery_pack_sequence)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19::jsonb,$20,$21,$22::jsonb)`,
      [
        input.id,
        input.workspaceId,
        input.purpose,
        input.sourceQuizVersionId,
        input.sourceSessionId,
        input.sourceReportId,
        input.trustMode ?? "learning",
        input.title,
        JSON.stringify(input.content),
        input.conceptKeys,
        input.timeMode,
        input.genericTokenHash,
        input.opensAt,
        input.closesAt,
        input.expiresAt,
        input.closedAt,
        input.createdBy,
        input.createdAt,
        input.recoveryPackSource ? JSON.stringify(input.recoveryPackSource) : null,
        input.creationMutation?.mutationId ?? null,
        input.creationMutation?.requestHash ?? null,
        input.recoveryPackSequence ? JSON.stringify(input.recoveryPackSequence) : null,
      ],
    );
    for (const item of access) {
      await client.query(
        `INSERT INTO followup_access_tokens
           (id, workspace_id, followup_id, source_participant_id, kind, label, token_hash,
            time_multiplier, expires_at, revoked_at, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [
          item.id,
          item.workspaceId,
          item.followupId,
          item.sourceParticipantId,
          item.kind,
          item.label,
          item.tokenHash,
          item.timeMultiplier,
          item.expiresAt,
          item.revokedAt,
          item.createdAt,
        ],
      );
    }
  }

  async createFollowup(input: FollowupRecord, access: FollowupAccessRecord[]) {
    if (input.purpose !== "recovery") {
      throw new TypeError("Practice assignments require atomic source validation");
    }
    await this.transaction((client) => this.insertFollowup(client, input, access), {
      workspaceId: input.workspaceId,
    });
  }

  async createPracticeAssignment(
    sourceQuizId: string,
    input: Extract<FollowupRecord, { purpose: "assignment" }>,
    access: FollowupAccessRecord[],
  ) {
    if (input.recoveryPackSource || input.creationMutation || input.sourceQuizVersionId === null)
      throw new TypeError("Round practice requires a Round source");
    return this.transaction(
      async (client) => {
        const workspace = await client.query(
          `SELECT id
           FROM workspaces
           WHERE id = $1
           FOR KEY SHARE`,
          [input.workspaceId],
        );
        if (workspace.rowCount !== 1) return false;
        const source = await client.query(
          `/* create_practice_assignment */
           SELECT status, current_version_id
           FROM quizzes
           WHERE workspace_id = $1
             AND id = $2
           FOR SHARE`,
          [input.workspaceId, sourceQuizId],
        );
        const quiz = source.rows[0];
        if (
          !quiz ||
          quiz.status !== "published" ||
          quiz.current_version_id !== input.sourceQuizVersionId
        ) {
          return false;
        }
        await this.insertFollowup(client, input, access);
        return true;
      },
      { workspaceId: input.workspaceId },
    );
  }

  async getRecoveryPackPracticeAssignment(
    workspaceId: string,
    packId: string,
    mutationId: string,
    requestHash: string,
  ) {
    const result = await this.workspaceQuery(
      workspaceId,
      "SELECT * FROM followups WHERE workspace_id = $1 AND creation_mutation_id = $2",
      [workspaceId, mutationId],
    );
    return result.rows[0]
      ? matchRecoveryPackPracticeReceipt(
          mapFollowup(result.rows[0]),
          packId,
          mutationId,
          requestHash,
        )
      : null;
  }

  async createRecoveryPackPracticeAssignment(
    packId: string,
    input: Extract<FollowupRecord, { purpose: "assignment" }>,
    access: FollowupAccessRecord[],
    context: RecoveryPackPracticeCreationContext,
  ): Promise<{
    followup: FollowupRecord;
    created: boolean;
    productEvent: ProductEventRecord | null;
  } | null> {
    const source = assertRecoveryPackPracticeInput(input);
    const receipt = input.creationMutation!;
    return this.transaction(
      async (client) => {
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
          `pack-practice:${input.workspaceId}:${receipt.mutationId}`,
        ]);
        const replay = await client.query(
          "SELECT * FROM followups WHERE workspace_id = $1 AND creation_mutation_id = $2",
          [input.workspaceId, receipt.mutationId],
        );
        if (replay.rows[0])
          return {
            followup: matchRecoveryPackPracticeReceipt(
              mapFollowup(replay.rows[0]),
              packId,
              receipt.mutationId,
              receipt.requestHash,
            ),
            created: false,
            productEvent: null,
          };
        const workspace = await client.query(
          `/* create_recovery_pack_practice_workspace */ SELECT workspace.deletion_started_at, EXISTS (
             SELECT 1 FROM workspace_media_deletion_jobs AS job WHERE job.workspace_id = workspace.id
           ) AS media_deletion_started
           FROM workspaces AS workspace WHERE workspace.id = $1 FOR SHARE`,
          [input.workspaceId],
        );
        if (!workspace.rows[0]) return null;
        if (
          workspace.rows[0].deletion_started_at !== null ||
          workspace.rows[0].media_deletion_started
        )
          throw new WorkspaceDeletionInProgressError(input.workspaceId);
        const result = await client.query(
          `/* create_recovery_pack_practice */ SELECT version.*
         FROM recovery_packs AS pack
         JOIN recovery_pack_versions AS version
           ON version.id = pack.current_version_id AND version.pack_id = pack.id AND version.workspace_id = pack.workspace_id
         WHERE pack.workspace_id = $1 AND pack.id = $2 AND version.id = $3
         FOR SHARE OF pack`,
          [input.workspaceId, packId, source.packVersionId],
        );
        const row = result.rows[0];
        if (
          !row ||
          !recoveryPackPracticeSourceMatches(input, {
            id: String(row.id),
            workspaceId: String(row.workspace_id),
            packId: String(row.pack_id),
            version: Number(row.version),
            content: upcastRecoveryPackContent(row.content, Number(row.content_schema_version)),
            contentSchemaVersion: Number(row.content_schema_version),
            contentHash: String(row.content_hash),
            sourceDraftRevision: Number(row.source_draft_revision),
            publishedAt: date(row.published_at),
          })
        )
          return null;
        await this.insertFollowup(client, input, access);
        const { audit, productEvent } = recoveryPackPracticeCreationEvidence(
          input,
          access.length,
          context,
        );
        await this.insertAuditEvent(client, audit);
        await this.insertProductEventRecords(client, [productEvent]);
        const stored = await client.query(
          "SELECT * FROM followups WHERE workspace_id = $1 AND id = $2",
          [input.workspaceId, input.id],
        );
        return { followup: mapFollowup(stored.rows[0]!), created: true, productEvent };
      },
      { workspaceId: input.workspaceId },
    );
  }

  async getFollowup(workspaceId: string, followupId: string) {
    const result = await this.workspaceQuery(
      workspaceId,
      "SELECT * FROM followups WHERE workspace_id = $1 AND id = $2",
      [workspaceId, followupId],
    );
    return result.rows[0] ? mapFollowup(result.rows[0]) : null;
  }

  async getFollowupProgress(workspaceId: string, followupId: string) {
    const result = await this.workspaceQuery(
      workspaceId,
      `SELECT count(attempt.id)::integer AS attempt_count,
              count(attempt.id) FILTER (WHERE attempt.status = 'completed')::integer
                AS completed_attempt_count
       FROM followups AS followup
       LEFT JOIN followup_attempts AS attempt
         ON attempt.followup_id = followup.id
        AND attempt.workspace_id = followup.workspace_id
       WHERE followup.workspace_id = $1 AND followup.id = $2
       GROUP BY followup.id`,
      [workspaceId, followupId],
    );
    const row = result.rows[0];
    return row
      ? {
          attemptCount: Number(row.attempt_count),
          completedAttemptCount: Number(row.completed_attempt_count),
        }
      : null;
  }

  async getFollowupByReport(workspaceId: string, reportId: string) {
    const result = await this.workspaceQuery(
      workspaceId,
      "SELECT * FROM followups WHERE workspace_id = $1 AND source_report_id = $2",
      [workspaceId, reportId],
    );
    return result.rows[0] ? mapFollowup(result.rows[0]) : null;
  }

  async listFollowupHistory(workspaceId: string, options: FollowupHistoryListOptions) {
    const result = await this.workspaceQuery(
      workspaceId,
      `SELECT followups.*,
              quiz_versions.quiz_id,
              to_char(
                followups.created_at AT TIME ZONE 'UTC',
                'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
              ) AS cursor_created_at,
              count(followup_attempts.id)::integer AS attempt_count,
              count(followup_attempts.id) FILTER (
                WHERE followup_attempts.status = 'completed'
              )::integer AS completed_attempt_count
       FROM followups
       LEFT JOIN quiz_versions
         ON quiz_versions.id = followups.source_quiz_version_id
        AND quiz_versions.workspace_id = followups.workspace_id
       LEFT JOIN followup_attempts
         ON followup_attempts.followup_id = followups.id
        AND followup_attempts.workspace_id = followups.workspace_id
       WHERE followups.workspace_id = $1
         AND ($2::timestamptz IS NULL OR (followups.created_at, followups.id) < ($2, $3::uuid))
         AND ($4::text IS NULL OR followups.purpose = $4)
         AND ($5::uuid IS NULL OR quiz_versions.quiz_id = $5)
         AND ($6::timestamptz IS NULL OR followups.created_at >= $6)
         AND ($7::timestamptz IS NULL OR followups.created_at <= $7)
         AND (
           $8::text IS NULL
           OR ($8 = 'expired' AND followups.expires_at <= $9)
           OR ($8 = 'closed' AND followups.expires_at > $9
               AND (followups.closed_at IS NOT NULL OR followups.closes_at <= $9))
           OR ($8 = 'scheduled' AND followups.expires_at > $9
               AND followups.closed_at IS NULL AND followups.closes_at > $9
               AND followups.opens_at > $9)
           OR ($8 = 'open' AND followups.expires_at > $9
               AND followups.closed_at IS NULL AND followups.closes_at > $9
               AND followups.opens_at <= $9)
         )
       GROUP BY followups.id, quiz_versions.quiz_id
       ORDER BY followups.created_at DESC, followups.id DESC
       LIMIT $10`,
      [
        workspaceId,
        options.cursor?.cursorCreatedAt ?? options.cursor?.createdAt ?? null,
        options.cursor?.id ?? null,
        options.purpose ?? null,
        options.quizId ?? null,
        options.from ?? null,
        options.to ?? null,
        options.status ?? null,
        options.now,
        options.limit + 1,
      ],
    );
    const hasMore = result.rows.length > options.limit;
    return {
      items: result.rows.slice(0, options.limit).map((row) => mapFollowupHistory(row, options.now)),
      hasMore,
    };
  }

  async getFollowupByGenericToken(followupId: string, tokenHash: string, now: Date) {
    const result = await this.systemQuery(
      `SELECT * FROM followups
       WHERE id = $1 AND generic_token_hash = $2 AND expires_at > $3`,
      [followupId, tokenHash, now],
    );
    return result.rows[0] ? mapFollowup(result.rows[0]) : null;
  }

  async getFollowupAccessByToken(followupId: string, tokenHash: string, now: Date) {
    const result = await this.systemQuery(
      `SELECT * FROM followup_access_tokens
       WHERE followup_id = $1 AND token_hash = $2 AND revoked_at IS NULL AND expires_at > $3`,
      [followupId, tokenHash, now],
    );
    return result.rows[0] ? mapFollowupAccess(result.rows[0]) : null;
  }

  async listFollowupAccess(workspaceId: string, followupId: string) {
    const result = await this.workspaceQuery(
      workspaceId,
      `SELECT * FROM followup_access_tokens
       WHERE workspace_id = $1 AND followup_id = $2 ORDER BY created_at, id`,
      [workspaceId, followupId],
    );
    return result.rows.map(mapFollowupAccess);
  }

  async createFollowupAccess(input: FollowupAccessRecord) {
    const result = await this.workspaceQuery(
      input.workspaceId,
      `INSERT INTO followup_access_tokens
         (id, workspace_id, followup_id, source_participant_id, kind, label, token_hash,
          time_multiplier, expires_at, revoked_at, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [
        input.id,
        input.workspaceId,
        input.followupId,
        input.sourceParticipantId,
        input.kind,
        input.label,
        input.tokenHash,
        input.timeMultiplier,
        input.expiresAt,
        input.revokedAt,
        input.createdAt,
      ],
    );
    return mapFollowupAccess(result.rows[0]!);
  }

  async createAssignmentPersonalAccess(input: FollowupAccessRecord, maximumLinks: number) {
    if (
      input.kind !== "assignment_personal" ||
      input.sourceParticipantId !== null ||
      input.timeMultiplier !== 1 ||
      input.label.length < 1 ||
      input.label.length > 80
    ) {
      throw new TypeError("Assignment personal access is invalid");
    }
    if (!Number.isSafeInteger(maximumLinks) || maximumLinks < 0) {
      throw new RangeError("Maximum personal links must be a non-negative safe integer");
    }
    return this.transaction(
      async (client) => {
        const target = await client.query(
          `SELECT purpose, closed_at, closes_at FROM followups
           WHERE workspace_id = $1 AND id = $2
           FOR UPDATE /* create_assignment_personal_access */`,
          [input.workspaceId, input.followupId],
        );
        const followup = target.rows[0];
        if (followup?.purpose !== "assignment") return null;
        const checkedAt = await client.query("SELECT clock_timestamp() AS checked_at");
        if (
          followup.closed_at !== null ||
          date(followup.closes_at) <= date(checkedAt.rows[0]?.checked_at)
        ) {
          return null;
        }
        const count = await client.query(
          `SELECT count(*)::integer AS count
           FROM followup_access_tokens
           WHERE workspace_id = $1 AND followup_id = $2 AND kind = 'assignment_personal'`,
          [input.workspaceId, input.followupId],
        );
        if (Number(count.rows[0]?.count ?? 0) >= maximumLinks) {
          throw new FollowupAccessLimitError(input.followupId, maximumLinks);
        }
        const result = await client.query(
          `INSERT INTO followup_access_tokens
             (id, workspace_id, followup_id, source_participant_id, kind, label, token_hash,
              time_multiplier, expires_at, revoked_at, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
           RETURNING *`,
          [
            input.id,
            input.workspaceId,
            input.followupId,
            input.sourceParticipantId,
            input.kind,
            input.label,
            input.tokenHash,
            input.timeMultiplier,
            input.expiresAt,
            input.revokedAt,
            input.createdAt,
          ],
        );
        return mapFollowupAccess(result.rows[0]!);
      },
      { workspaceId: input.workspaceId },
    );
  }

  async revokeFollowupAccess(
    workspaceId: string,
    followupId: string,
    accessId: string,
    revokedAt: Date,
  ) {
    const result = await this.workspaceQuery(
      workspaceId,
      `UPDATE followup_access_tokens SET revoked_at = COALESCE(revoked_at, $4)
       WHERE workspace_id = $1 AND followup_id = $2 AND id = $3 RETURNING id`,
      [workspaceId, followupId, accessId, revokedAt],
    );
    return result.rowCount === 1;
  }

  async closeFollowup(workspaceId: string, followupId: string, closedAt: Date) {
    const result = await this.workspaceQuery(
      workspaceId,
      `UPDATE followups SET closed_at = COALESCE(closed_at, $3)
       WHERE workspace_id = $1 AND id = $2 RETURNING id`,
      [workspaceId, followupId, closedAt],
    );
    return result.rowCount === 1;
  }

  async createOrGetFollowupAttempt(input: FollowupAttemptRecord) {
    return this.transaction(
      async (client) => {
        const inserted = await client.query(
          `INSERT INTO followup_attempts
             (id, workspace_id, followup_id, access_token_id, source_participant_id,
              attempt_token_hash, status, phase, current_index, version, time_multiplier,
              question_opened_at, deadline_at, completed_at, created_at, updated_at,
              intervention_index, advance_receipts)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18::jsonb)
           ON CONFLICT DO NOTHING RETURNING *`,
          [
            input.id,
            input.workspaceId,
            input.followupId,
            input.accessTokenId,
            input.sourceParticipantId,
            input.attemptTokenHash,
            input.status,
            input.phase,
            input.currentIndex,
            input.version,
            input.timeMultiplier,
            input.questionOpenedAt,
            input.deadlineAt,
            input.completedAt,
            input.createdAt,
            input.updatedAt,
            input.interventionIndex ?? null,
            JSON.stringify(input.advanceReceipts ?? {}),
          ],
        );
        if (inserted.rows[0]) return mapFollowupAttempt(inserted.rows[0]);
        const existing = input.accessTokenId
          ? await client.query(
              `SELECT * FROM followup_attempts
               WHERE followup_id = $1 AND (attempt_token_hash = $2 OR access_token_id = $3)
               LIMIT 1`,
              [input.followupId, input.attemptTokenHash, input.accessTokenId],
            )
          : await client.query(
              `SELECT * FROM followup_attempts
               WHERE followup_id = $1 AND attempt_token_hash = $2 LIMIT 1`,
              [input.followupId, input.attemptTokenHash],
            );
        if (!existing.rows[0]) throw new Error("Follow-up attempt could not be created");
        return mapFollowupAttempt(existing.rows[0]);
      },
      { system: true },
    );
  }

  async getFollowupAttemptByToken(followupId: string, tokenHash: string, now: Date) {
    const result = await this.systemQuery(
      `SELECT attempt.* FROM followup_attempts AS attempt
       LEFT JOIN followup_access_tokens AS access ON access.id = attempt.access_token_id
       WHERE attempt.followup_id = $1 AND attempt.attempt_token_hash = $2
         AND (attempt.access_token_id IS NULL OR (
           access.revoked_at IS NULL AND access.expires_at > $3
         ))`,
      [followupId, tokenHash, now],
    );
    return result.rows[0] ? mapFollowupAttempt(result.rows[0]) : null;
  }

  async getFollowupAnswer(attemptId: string, checkpointId: string) {
    const result = await this.systemQuery(
      "SELECT * FROM followup_answers WHERE attempt_id = $1 AND checkpoint_id = $2",
      [attemptId, checkpointId],
    );
    return result.rows[0] ? mapFollowupAnswer(result.rows[0]) : null;
  }

  async getFollowupAnswerByIdempotencyKey(attemptId: string, key: string) {
    const result = await this.systemQuery(
      "SELECT * FROM followup_answers WHERE attempt_id = $1 AND idempotency_key = $2",
      [attemptId, key],
    );
    return result.rows[0] ? mapFollowupAnswer(result.rows[0]) : null;
  }

  async commitFollowupAnswer(
    attempt: FollowupAttemptRecord,
    answer: FollowupAnswerRecord,
    expectedVersion: number,
  ) {
    return this.transaction(
      async (client) => {
        const duplicate = await client.query(
          `SELECT * FROM followup_answers
           WHERE attempt_id = $1 AND idempotency_key = $2`,
          [answer.attemptId, answer.idempotencyKey],
        );
        if (duplicate.rows[0]) return mapFollowupAnswer(duplicate.rows[0]);
        const updated = await client.query(
          `UPDATE followup_attempts SET status = $2, phase = $3, current_index = $4,
             version = $5, time_multiplier = $6, question_opened_at = $7,
             deadline_at = $8, completed_at = $9, updated_at = $10, intervention_index = $12
           WHERE id = $1 AND version = $11`,
          [
            attempt.id,
            attempt.status,
            attempt.phase,
            attempt.currentIndex,
            attempt.version,
            attempt.timeMultiplier,
            attempt.questionOpenedAt,
            attempt.deadlineAt,
            attempt.completedAt,
            attempt.updatedAt,
            expectedVersion,
            attempt.interventionIndex ?? null,
          ],
        );
        if (updated.rowCount !== 1) {
          throw new FollowupVersionConflictError(attempt.id, expectedVersion);
        }
        const inserted = await client.query(
          `INSERT INTO followup_answers
             (id, workspace_id, followup_id, attempt_id, checkpoint_id, response_payload,
              response_schema_version, confidence, correct, idempotency_key, accepted_at, submitted_version)
           VALUES ($1,$2,$3,$4,$5,$6,2,$7,$8,$9,$10,$11) RETURNING *`,
          [
            answer.id,
            answer.workspaceId,
            answer.followupId,
            answer.attemptId,
            answer.checkpointId,
            JSON.stringify(answer.response),
            answer.confidence,
            answer.correct,
            answer.idempotencyKey,
            answer.acceptedAt,
            answer.submittedVersion ?? null,
          ],
        );
        return mapFollowupAnswer(inserted.rows[0]!);
      },
      { system: true },
    );
  }

  async advanceFollowupAttempt(
    attempt: FollowupAttemptRecord,
    expectedVersion: number,
    idempotencyKey?: string,
  ) {
    if (idempotencyKey !== undefined)
      RecoveryPackPracticeSourceSchema.shape.packId.parse(idempotencyKey);
    const result = await this.systemQuery(
      `UPDATE followup_attempts SET status = $2, phase = $3, current_index = $4,
         version = $5, time_multiplier = $6, question_opened_at = $7,
         deadline_at = $8, completed_at = $9, updated_at = $10, intervention_index = $12,
         advance_receipts = CASE WHEN $13::text IS NULL THEN advance_receipts
           ELSE advance_receipts || jsonb_build_object($13::text, $11::integer) END
       WHERE id = $1 AND version = $11
         AND ($13::text IS NULL OR (
           NOT (advance_receipts ? $13::text)
           AND (SELECT count(*) FROM jsonb_object_keys(advance_receipts)) < 256
         )) RETURNING id`,
      [
        attempt.id,
        attempt.status,
        attempt.phase,
        attempt.currentIndex,
        attempt.version,
        attempt.timeMultiplier,
        attempt.questionOpenedAt,
        attempt.deadlineAt,
        attempt.completedAt,
        attempt.updatedAt,
        expectedVersion,
        attempt.interventionIndex ?? null,
        idempotencyKey ?? null,
      ],
    );
    return result.rowCount === 1;
  }

  async createAuthoringJob(input: AuthoringJobRecord) {
    const result = await this.workspaceQuery(
      input.workspaceId,
      `INSERT INTO authoring_jobs
         (id, workspace_id, created_by, source_type, source_name, source_mime_type,
          source_text, source_blob, source_digest, status, attempts, available_at, output,
          last_error, expires_at, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
       RETURNING *`,
      [
        input.id,
        input.workspaceId,
        input.createdBy,
        input.sourceType,
        input.sourceName,
        input.sourceMimeType,
        input.sourceText,
        input.sourceBlob,
        input.sourceDigest,
        input.status,
        input.attempts,
        input.availableAt,
        input.output ? JSON.stringify(input.output) : null,
        input.lastError,
        input.expiresAt,
        input.createdAt,
        input.updatedAt,
      ],
    );
    return mapAuthoringJob(result.rows[0]!);
  }

  async createAuthoringJobWithinLimit(
    input: AuthoringJobRecord,
    since: Date,
    monthlyLimit: number | null,
  ) {
    return this.transaction(
      async (client) => {
        await client.query("SELECT id FROM workspaces WHERE id = $1 FOR UPDATE", [
          input.workspaceId,
        ]);
        if (monthlyLimit !== null) {
          const usage = await client.query(
            `SELECT count(*)::integer AS count FROM authoring_jobs
             WHERE workspace_id = $1 AND created_at >= $2`,
            [input.workspaceId, since],
          );
          if (Number(usage.rows[0]?.count ?? 0) >= monthlyLimit) return null;
        }
        const result = await client.query(
          `INSERT INTO authoring_jobs
             (id, workspace_id, created_by, source_type, source_name, source_mime_type,
              source_text, source_blob, source_digest, status, attempts, available_at, output,
              last_error, expires_at, created_at, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
           RETURNING *`,
          [
            input.id,
            input.workspaceId,
            input.createdBy,
            input.sourceType,
            input.sourceName,
            input.sourceMimeType,
            input.sourceText,
            input.sourceBlob,
            input.sourceDigest,
            input.status,
            input.attempts,
            input.availableAt,
            input.output ? JSON.stringify(input.output) : null,
            input.lastError,
            input.expiresAt,
            input.createdAt,
            input.updatedAt,
          ],
        );
        return mapAuthoringJob(result.rows[0]!);
      },
      { workspaceId: input.workspaceId },
    );
  }

  async countAuthoringJobsSince(workspaceId: string, since: Date) {
    const result = await this.workspaceQuery(
      workspaceId,
      `SELECT count(*)::integer AS count FROM authoring_jobs
       WHERE workspace_id = $1 AND created_at >= $2`,
      [workspaceId, since],
    );
    return Number(result.rows[0]?.count ?? 0);
  }

  async getAuthoringJob(workspaceId: string, jobId: string) {
    const result = await this.workspaceQuery(
      workspaceId,
      "SELECT * FROM authoring_jobs WHERE workspace_id = $1 AND id = $2",
      [workspaceId, jobId],
    );
    return result.rows[0] ? mapAuthoringJob(result.rows[0]) : null;
  }

  async listAuthoringJobs(workspaceId: string, limit: number) {
    const result = await this.workspaceQuery(
      workspaceId,
      `SELECT * FROM authoring_jobs WHERE workspace_id = $1
       ORDER BY created_at DESC, id DESC LIMIT $2`,
      [workspaceId, limit],
    );
    return result.rows.map(mapAuthoringJob);
  }

  async claimAuthoringJob(now: Date, leaseUntil: Date) {
    return this.transaction(
      async (client) => {
        const result = await client.query(
          `WITH candidate AS (
             SELECT id FROM authoring_jobs
             WHERE status IN ('pending', 'processing') AND available_at <= $1
             ORDER BY available_at, created_at
             FOR UPDATE SKIP LOCKED
             LIMIT 1
           )
           UPDATE authoring_jobs AS job
           SET status = 'processing', attempts = attempts + 1, available_at = $2,
               updated_at = $1
           FROM candidate
           WHERE job.id = candidate.id
           RETURNING job.*`,
          [now, leaseUntil],
        );
        return result.rows[0] ? mapAuthoringJob(result.rows[0]) : null;
      },
      { system: true },
    );
  }

  async completeAuthoringJob(
    jobId: string,
    expectedAttempts: number,
    output: NonNullable<AuthoringJobRecord["output"]>,
    completedAt: Date,
  ) {
    const result = await this.systemQuery(
      `UPDATE authoring_jobs SET status = 'ready', output = $3, source_text = NULL,
         source_blob = NULL, last_error = NULL, updated_at = $4
       WHERE id = $1 AND status = 'processing' AND attempts = $2 RETURNING id`,
      [jobId, expectedAttempts, JSON.stringify(output), completedAt],
    );
    return result.rowCount === 1;
  }

  async applyAuthoringJobDraft(workspaceId: string, jobId: string, quiz: QuizRecord) {
    return this.transaction(
      async (client) => {
        const jobResult = await client.query(
          `SELECT status, output, applied_quiz_id FROM authoring_jobs
           WHERE workspace_id = $1 AND id = $2 FOR UPDATE`,
          [workspaceId, jobId],
        );
        const job = jobResult.rows[0];
        if (!job || job.status !== "ready" || !job.output) return null;
        if (job.applied_quiz_id) {
          const existing = await client.query(
            "SELECT * FROM quizzes WHERE workspace_id = $1 AND id = $2",
            [workspaceId, job.applied_quiz_id],
          );
          return existing.rows[0] ? mapQuiz(existing.rows[0]) : null;
        }
        const created = await client.query(
          `INSERT INTO quizzes
             (id, workspace_id, title, description, status, draft, folder_id, tags,
              created_at, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8::text[],$9,$10)
           RETURNING *`,
          [
            quiz.id,
            quiz.workspaceId,
            quiz.title,
            quiz.description,
            quiz.status,
            JSON.stringify(quiz.draft),
            quiz.folderId,
            quiz.tags,
            quiz.createdAt,
            quiz.updatedAt,
          ],
        );
        await client.query(
          "UPDATE authoring_jobs SET applied_quiz_id = $2, updated_at = $3 WHERE id = $1",
          [jobId, quiz.id, quiz.updatedAt],
        );
        return mapQuiz(created.rows[0]!);
      },
      { workspaceId },
    );
  }

  async retryAuthoringJob(
    jobId: string,
    expectedAttempts: number,
    error: string,
    availableAt: Date,
    failed: boolean,
  ) {
    const result = await this.systemQuery(
      `UPDATE authoring_jobs SET status = $3, last_error = $4, available_at = $5,
         source_text = CASE WHEN $3 = 'failed' THEN NULL ELSE source_text END,
         source_blob = CASE WHEN $3 = 'failed' THEN NULL ELSE source_blob END,
         updated_at = now()
       WHERE id = $1 AND status = 'processing' AND attempts = $2 RETURNING id`,
      [jobId, expectedAttempts, failed ? "failed" : "pending", error.slice(0, 2_000), availableAt],
    );
    return result.rowCount === 1;
  }

  async getPlan(workspaceId: string): Promise<Plan> {
    const result = await this.workspaceQuery(
      workspaceId,
      "SELECT plan FROM subscriptions WHERE workspace_id = $1",
      [workspaceId],
    );
    return (result.rows[0]?.plan as Plan | undefined) ?? "free";
  }

  async getBillingProfile(workspaceId: string) {
    const result = await this.workspaceQuery(
      workspaceId,
      `SELECT plan, status, provider_customer_id, provider_subscription_id
       FROM subscriptions WHERE workspace_id = $1`,
      [workspaceId],
    );
    const row = result.rows[0];
    return {
      plan: (row?.plan as Plan | undefined) ?? "free",
      status: row?.status ?? "free",
      customerId: row?.provider_customer_id ?? null,
      subscriptionId: row?.provider_subscription_id ?? null,
    };
  }

  async setPlan(
    workspaceId: string,
    plan: Plan,
    provider: { customerId?: string; subscriptionId?: string; status?: string } = {},
  ) {
    await this.workspaceQuery(
      workspaceId,
      `INSERT INTO subscriptions
       (workspace_id, plan, status, provider_customer_id, provider_subscription_id, updated_at)
       VALUES ($1,$2,$3,$4,$5,now())
       ON CONFLICT (workspace_id) DO UPDATE SET plan = EXCLUDED.plan, status = EXCLUDED.status,
       provider_customer_id = COALESCE(EXCLUDED.provider_customer_id, subscriptions.provider_customer_id),
       provider_subscription_id = COALESCE(EXCLUDED.provider_subscription_id, subscriptions.provider_subscription_id),
       updated_at = now()`,
      [
        workspaceId,
        plan,
        provider.status ?? (plan === "free" ? "free" : "active"),
        provider.customerId,
        provider.subscriptionId,
      ],
    );
  }

  async provisionCapacityTestWorkspace(
    workspaceId: string,
    requestId: string,
  ): Promise<CapacityTestWorkspaceProvisionResult> {
    return this.transaction(
      async (client) => {
        const principal = mapRuntimeDatabasePrincipal(
          (await client.query<RuntimeDatabasePrincipalRow>(runtimeDatabasePrincipalSql)).rows[0],
        );
        assertRestrictedRuntimeDatabasePrincipal(principal);
        const workspace = await client.query("SELECT id FROM workspaces WHERE id = $1 FOR UPDATE", [
          workspaceId,
        ]);
        if (workspace.rowCount !== 1) {
          throw new Error("Capacity-test workspace does not exist");
        }

        const subscription = await client.query<{
          plan: Plan;
          status: string;
          provider_customer_id: string | null;
          provider_subscription_id: string | null;
        }>(
          `SELECT plan, status, provider_customer_id, provider_subscription_id
             FROM subscriptions
            WHERE workspace_id = $1
            FOR UPDATE`,
          [workspaceId],
        );
        const current = subscription.rows[0];
        const previousPlan = current?.plan ?? "free";
        const previousStatus = current?.status ?? "free";
        if (current?.provider_customer_id || current?.provider_subscription_id) {
          throw new Error("Capacity-test provisioning refuses a provider-linked workspace");
        }
        const priorProvision = await client.query(
          `SELECT 1
             FROM audit_events
            WHERE workspace_id = $1
              AND action = 'operations.staging_capacity.provision'
              AND target_type = 'workspace'
              AND target_id = $1::uuid::text
            LIMIT 1`,
          [workspaceId],
        );
        if (previousPlan === "team" && previousStatus === "active") {
          if (priorProvision.rowCount !== 1) {
            throw new Error(
              "Capacity-test provisioning refuses a Team workspace without its prior audit marker",
            );
          }
          return {
            workspaceId,
            previousPlan,
            previousStatus,
            plan: "team",
            status: "active",
            changed: false,
          };
        }
        if (previousPlan !== "free" || previousStatus !== "free") {
          throw new Error("Capacity-test provisioning requires an untouched free workspace");
        }
        if (priorProvision.rowCount === 1) {
          throw new Error("Capacity-test provisioning requires an untouched free workspace");
        }

        await client.query(
          `INSERT INTO subscriptions (workspace_id, plan, status, updated_at)
           VALUES ($1, 'team', 'active', now())
           ON CONFLICT (workspace_id) DO UPDATE SET
             plan = 'team',
             status = 'active',
             updated_at = now()`,
          [workspaceId],
        );
        await client.query(
          `INSERT INTO audit_events
             (id, workspace_id, actor_id, action, target_type, target_id, request_id, metadata)
           VALUES ($1,$2,NULL,'operations.staging_capacity.provision','workspace',$2::uuid::text,$3,$4)`,
          [
            randomUUID(),
            workspaceId,
            requestId,
            JSON.stringify({
              purpose: "target-region-load",
              previousPlan,
              previousStatus,
              plan: "team",
              status: "active",
              maxParticipants: 250,
            }),
          ],
        );
        return {
          workspaceId,
          previousPlan,
          previousStatus,
          plan: "team",
          status: "active",
          changed: true,
        };
      },
      { workspaceId },
    );
  }

  async recordBillingEvent(providerEventId: string, eventType: string) {
    const result = await this.systemQuery(
      `INSERT INTO billing_events (provider_event_id, event_type) VALUES ($1,$2)
       ON CONFLICT DO NOTHING RETURNING provider_event_id`,
      [providerEventId, eventType],
    );
    return result.rowCount === 1;
  }

  async applyBillingEvent(input: BillingEventInput) {
    return this.transaction(
      async (client) => {
        const recorded = await client.query(
          `INSERT INTO billing_events (provider_event_id, event_type, provider_created_at)
           VALUES ($1,$2,$3) ON CONFLICT DO NOTHING RETURNING provider_event_id`,
          [input.providerEventId, input.eventType, input.providerCreatedAt],
        );
        if (recorded.rowCount !== 1) return false;
        if (!input.workspaceId || !input.plan) return true;

        await client.query(
          `INSERT INTO subscriptions
           (workspace_id, plan, status, provider_customer_id, provider_subscription_id,
            last_event_created_at, updated_at)
           SELECT $1,$2,$3,$4,$5,$6,now()
           WHERE EXISTS (SELECT 1 FROM workspaces WHERE id = $1)
           ON CONFLICT (workspace_id) DO UPDATE SET
             plan = EXCLUDED.plan,
             status = EXCLUDED.status,
             provider_customer_id = COALESCE(EXCLUDED.provider_customer_id,
               subscriptions.provider_customer_id),
             provider_subscription_id = COALESCE(EXCLUDED.provider_subscription_id,
               subscriptions.provider_subscription_id),
             last_event_created_at = EXCLUDED.last_event_created_at,
             updated_at = now()
           WHERE subscriptions.last_event_created_at IS NULL
              OR EXCLUDED.last_event_created_at >= subscriptions.last_event_created_at`,
          [
            input.workspaceId,
            input.plan,
            input.status ?? (input.plan === "free" ? "free" : "active"),
            input.customerId,
            input.subscriptionId,
            input.providerCreatedAt,
          ],
        );
        return true;
      },
      { system: true },
    );
  }

  async recordAudit(input: AuditInput) {
    await this.transaction(
      (client) =>
        this.insertAuditEvent(client, { id: randomUUID(), ...input, createdAt: new Date() }),
      input.workspaceId ? { workspaceId: input.workspaceId } : { system: true },
    );
  }

  private async insertAuditEvent(client: PoolClient, input: AuditEventRecord) {
    await client.query(
      `INSERT INTO audit_events
       (id, workspace_id, actor_id, action, target_type, target_id, request_id, metadata, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        input.id,
        input.workspaceId,
        input.actorId,
        input.action,
        input.targetType,
        input.targetId,
        input.requestId,
        JSON.stringify(input.metadata ?? {}),
        input.createdAt,
      ],
    );
  }

  async listAuditEvents(workspaceId: string, since: Date | null, limit: number) {
    const result = await this.workspaceQuery(
      workspaceId,
      `SELECT id, workspace_id, actor_id, action, target_type, target_id, request_id,
              metadata, created_at
       FROM audit_events
       WHERE workspace_id = $1 AND ($2::timestamptz IS NULL OR created_at >= $2)
       ORDER BY created_at, id
       LIMIT $3`,
      [workspaceId, since, limit],
    );
    return result.rows.map((row): AuditEventRecord => ({
      id: String(row.id),
      workspaceId: String(row.workspace_id),
      actorId: row.actor_id ? String(row.actor_id) : null,
      action: String(row.action),
      targetType: String(row.target_type),
      targetId: row.target_id ? String(row.target_id) : null,
      requestId: String(row.request_id),
      metadata:
        row.metadata && typeof row.metadata === "object"
          ? (row.metadata as Record<string, unknown>)
          : {},
      createdAt: new Date(row.created_at),
    }));
  }

  async purgeAuditEvents(cutoff: Date) {
    const result = await this.systemQuery(
      "DELETE FROM audit_events WHERE created_at <= $1 RETURNING id",
      [cutoff],
    );
    return result.rowCount ?? 0;
  }

  async recordProductEvents(events: ProductEventRecord[]) {
    if (events.length === 0) return;
    await this.transaction((client) => this.insertProductEventRecords(client, events), {
      workspaceId: events[0]!.workspaceId,
    });
  }

  private async insertProductEventRecords(client: PoolClient, events: ProductEventRecord[]) {
    if (events.length === 0) return;
    const workspaceId = events[0]!.workspaceId;
    if (events.some((event) => event.workspaceId !== workspaceId)) {
      throw new Error("Product event batches cannot span workspaces");
    }
    await client.query(
      `INSERT INTO product_events
         (id, workspace_id, event_name, dimensions, occurred_at, expires_at, created_at)
       SELECT input.id, $1, input.event_name, input.dimensions,
              input.occurred_at, input.expires_at, input.created_at
       FROM jsonb_to_recordset($2::jsonb) AS input(
         id uuid,
         event_name text,
         dimensions jsonb,
         occurred_at timestamptz,
         expires_at timestamptz,
         created_at timestamptz
       )`,
      [
        workspaceId,
        JSON.stringify(
          events.map((event) => ({
            id: event.id,
            event_name: event.name,
            dimensions: event.dimensions,
            occurred_at: event.occurredAt,
            expires_at: event.expiresAt.toISOString(),
            created_at: event.createdAt.toISOString(),
          })),
        ),
      ],
    );
  }

  async purgeProductEvents(now: Date) {
    const result = await this.systemQuery(
      "DELETE FROM product_events WHERE expires_at <= $1 RETURNING id",
      [now],
    );
    return result.rowCount ?? 0;
  }

  async exportAccount(userId: string) {
    return this.transaction(
      async (client) => {
        const userResult = await client.query(
          `SELECT id, email, locale, locale_explicit AS "localePreferenceSet", created_at
           FROM users WHERE id = $1 AND deleted_at IS NULL`,
          [userId],
        );
        const membershipResult = await client.query(
          `SELECT w.id, w.name, w.segment, w.home_region, wm.role,
                  wm.created_at AS joined_at
           FROM workspaces w JOIN workspace_members wm ON wm.workspace_id = w.id
           WHERE wm.user_id = $1
           ORDER BY lower(w.name), w.id`,
          [userId],
        );
        const workspaceResult = await client.query(
          `SELECT w.*, wm.role FROM workspaces w
           JOIN workspace_members wm ON wm.workspace_id = w.id
           WHERE wm.user_id = $1 AND wm.role = 'owner'
           ORDER BY lower(w.name), w.id`,
          [userId],
        );
        const workspaceIds = workspaceResult.rows.map((row) => row.id);
        const queryWorkspaceData = async (sql: string) =>
          workspaceIds.length ? client.query(sql, [workspaceIds]) : { rows: [] };
        const quizzes = await queryWorkspaceData(
          `SELECT id, workspace_id, title, description, status, draft, draft_revision,
                  draft_schema_version, published_draft_revision, last_edited_by,
                  current_version_id, folder_id, tags, created_at, updated_at
           FROM quizzes WHERE workspace_id = ANY($1::uuid[]) ORDER BY created_at, id`,
        );
        const surveys = await queryWorkspaceData(
          "SELECT data FROM surveys WHERE workspace_id = ANY($1::uuid[]) ORDER BY id",
        );
        const surveyVersions = await queryWorkspaceData(
          "SELECT data FROM survey_versions WHERE workspace_id = ANY($1::uuid[]) ORDER BY id",
        );
        const surveyRooms = await queryWorkspaceData(
          "SELECT data FROM survey_feedback_rooms WHERE workspace_id = ANY($1::uuid[]) ORDER BY id",
        );
        const quizDraftHistory = await queryWorkspaceData(
          `SELECT id, workspace_id, quiz_id, revision, draft, draft_schema_version,
                  saved_by, mutation_id, created_at
           FROM quiz_draft_history WHERE workspace_id = ANY($1::uuid[])
           ORDER BY quiz_id, revision`,
        );
        const questionHealthDismissals = await queryWorkspaceData(
          `SELECT workspace_id, quiz_id, finding_id, rule_version, ruleset_version,
                  content_hash, reason, created_at
           FROM question_health_dismissals WHERE workspace_id = ANY($1::uuid[])
           ORDER BY workspace_id, quiz_id, finding_id`,
        );
        const questionHealthApplications = await queryWorkspaceData(
          `SELECT workspace_id, quiz_id, application_id, finding_id, rule_version,
                  ruleset_version, content_hash, source_revision, applied_revision,
                  request_hash, changes, created_at
           FROM question_health_applications WHERE workspace_id = ANY($1::uuid[])
           ORDER BY workspace_id, quiz_id, created_at, application_id`,
        );
        const folders = await queryWorkspaceData(
          `SELECT id, workspace_id, name, created_at, updated_at
           FROM folders WHERE workspace_id = ANY($1::uuid[]) ORDER BY workspace_id, lower(name), id`,
        );
        const quizVersions = await queryWorkspaceData(
          `SELECT id, workspace_id, quiz_id, version, content, content_schema_version,
                  content_hash, published_at
           FROM quiz_versions WHERE workspace_id = ANY($1::uuid[])
           ORDER BY quiz_id, version`,
        );
        const presentations = await queryWorkspaceData(
          `SELECT id, workspace_id, title, description, status, draft, draft_revision,
                  draft_schema_version, current_version_id, published_draft_revision,
                  last_edited_by, folder_id, created_at, updated_at, archived_at
           FROM presentations WHERE workspace_id = ANY($1::uuid[])
           ORDER BY created_at, id`,
        );
        const audienceScopes = await queryWorkspaceData(
          `SELECT id, workspace_id, kind, identity_policy, schema_version, audience_seq,
                  creation_idempotency_key, created_at, expires_at
           FROM audience_scopes WHERE workspace_id = ANY($1::uuid[]) ORDER BY created_at, id`,
        );
        const scopedQnaSettings = await queryWorkspaceData(
          "SELECT * FROM scoped_qna_settings WHERE workspace_id = ANY($1::uuid[]) ORDER BY scope_id",
        );
        const scopedQnaQuestions =
          await queryWorkspaceData(`SELECT id, workspace_id, scope_id, participant_id, public_alias, status, label, created_at, updated_at,
          CASE WHEN status = 'removed' THEN '' ELSE body END AS body
          FROM scoped_qna_questions WHERE workspace_id = ANY($1::uuid[]) ORDER BY created_at, id`);
        const scopedQnaVotes = await queryWorkspaceData(
          "SELECT * FROM scoped_qna_votes WHERE workspace_id = ANY($1::uuid[]) ORDER BY scope_id, question_id, participant_id",
        );
        const scopedQnaBans = await queryWorkspaceData(
          "SELECT * FROM scoped_qna_bans WHERE workspace_id = ANY($1::uuid[]) ORDER BY scope_id, participant_id",
        );
        const scopedQnaAudit = await queryWorkspaceData(
          "SELECT * FROM scoped_qna_audit WHERE workspace_id = ANY($1::uuid[]) ORDER BY occurred_at, id",
        );
        const libraryFavorites = await client.query(
          `SELECT workspace_id, user_id, artifact_type, artifact_id, created_at
           FROM library_favorites WHERE user_id = $1
           ORDER BY created_at, artifact_type, artifact_id`,
          [userId],
        );
        const presentationVersions = await queryWorkspaceData(
          `SELECT id, workspace_id, presentation_id, version, content, content_schema_version,
                  content_hash,
                  source_draft_revision, published_at
           FROM presentation_versions WHERE workspace_id = ANY($1::uuid[])
           ORDER BY presentation_id, version`,
        );
        const presentationDraftHistory = await queryWorkspaceData(
          `SELECT id, workspace_id, presentation_id, revision, draft, draft_schema_version,
                  saved_by, mutation_id, created_at
           FROM presentation_draft_history WHERE workspace_id = ANY($1::uuid[])
           ORDER BY presentation_id, revision`,
        );
        const recoveryPacks = await queryWorkspaceData(
          `SELECT id, workspace_id, title, description, draft, draft_revision,
                  draft_schema_version, current_version_id, published_draft_revision,
                  last_edited_by, created_at, updated_at
           FROM recovery_packs WHERE workspace_id = ANY($1::uuid[]) ORDER BY created_at, id`,
        );
        const recoveryPackVersions = await queryWorkspaceData(
          `SELECT id, workspace_id, pack_id, version, content, content_schema_version,
                  content_hash, source_draft_revision, published_at
           FROM recovery_pack_versions WHERE workspace_id = ANY($1::uuid[]) ORDER BY pack_id, version`,
        );
        const recoveryPackDraftHistory = await queryWorkspaceData(
          `SELECT id, workspace_id, pack_id, revision, draft, draft_schema_version,
                  saved_by, mutation_id, created_at
           FROM recovery_pack_draft_history WHERE workspace_id = ANY($1::uuid[]) ORDER BY pack_id, revision`,
        );
        const recoveryPackDraftMutations = await queryWorkspaceData(
          `SELECT workspace_id, mutation_id, pack_id, expected_revision, resulting_revision,
                  draft_hash, resulting_draft, draft_schema_version, last_edited_by,
                  resulting_at, created_at
           FROM recovery_pack_draft_mutations WHERE workspace_id = ANY($1::uuid[]) ORDER BY pack_id, created_at, mutation_id`,
        );
        const recoveryPackSources = await queryWorkspaceData(
          "SELECT * FROM recovery_pack_sources WHERE workspace_id = ANY($1::uuid[]) ORDER BY pack_id",
        );
        const recoveryPackSourceApprovals = await queryWorkspaceData(
          "SELECT * FROM recovery_pack_source_approvals WHERE workspace_id = ANY($1::uuid[]) ORDER BY pack_id, created_at, mutation_id",
        );
        const mediaAssets = await queryWorkspaceData(
          `SELECT id, workspace_id, object_key, mime_type, size_bytes, scan_status, alt_text,
                  created_at
           FROM media_assets WHERE workspace_id = ANY($1::uuid[]) ORDER BY created_at, id`,
        );
        const mediaReferences = await queryWorkspaceData(
          `SELECT workspace_id, media_id, owner_type, owner_id, created_at
           FROM media_references WHERE workspace_id = ANY($1::uuid[])
           ORDER BY created_at, media_id, owner_type, owner_id`,
        );
        const sessions = await queryWorkspaceData(
          `SELECT id, workspace_id, quiz_version_id, host_id, code, state, version, seq,
                  deadline, settings, state_snapshot, trust_mode, ended_at, deleted_at, expires_at,
                  retention_expires_at, created_at, updated_at
           FROM game_sessions WHERE workspace_id = ANY($1::uuid[]) ORDER BY created_at, id`,
        );
        const presentationSessions = await queryWorkspaceData(
          `SELECT id, workspace_id, presentation_id, presentation_version_id, title,
                  content_snapshot, join_code, status, phase, current_block_index, revision,
                  settings, trust_mode, event_seq, event_seq_offset, question_opened_at,
                  question_closes_at, created_by, created_at, updated_at, finished_at,
                  live_expires_at, retention_expires_at, recovery_pack_cards_enabled,
                  recovery_pack_intervention
           FROM presentation_live_sessions WHERE workspace_id = ANY($1::uuid[])
           ORDER BY created_at, id`,
        );
        const presentationSessionIds = presentationSessions.rows.map((row) => row.id);
        const presentationSessionParticipants = presentationSessionIds.length
          ? await client.query(
              `SELECT id, workspace_id, session_id, nickname, joined_at, last_seen_at
               FROM presentation_live_participants
               WHERE session_id = ANY($1::uuid[]) ORDER BY joined_at, id`,
              [presentationSessionIds],
            )
          : { rows: [] };
        const presentationSessionResponses = await queryWorkspaceData(
          `SELECT id, workspace_id, session_id, participant_id, block_id, question_id,
                  response, correct, score, response_ms, idempotency_key, submitted_at
           FROM presentation_live_responses WHERE workspace_id = ANY($1::uuid[])
           ORDER BY submitted_at, id`,
        );
        const presentationSessionTimeline = await queryWorkspaceData(
          `SELECT id, workspace_id, session_id, sequence, event_type, block_index, block_id,
                  occurred_at, recovery_pack_intervention
           FROM presentation_session_timeline WHERE workspace_id = ANY($1::uuid[])
           ORDER BY session_id, sequence`,
        );
        const presentationSessionCommandReceipts = await queryWorkspaceData(
          `SELECT id, workspace_id, session_id, command_id, expected_revision,
                  resulting_revision, event_type, received_at, request_hash
           FROM presentation_session_command_receipts
           WHERE workspace_id = ANY($1::uuid[])
           ORDER BY session_id, received_at, id`,
        );
        const presentationSessionCredentials = await queryWorkspaceData(
          `SELECT id, workspace_id, session_id, role, created_at, expires_at, revoked_at
           FROM presentation_session_credentials
           WHERE workspace_id = ANY($1::uuid[])
           ORDER BY session_id, created_at, id`,
        );
        const presentationSessionReports = await queryWorkspaceData(
          `SELECT id, workspace_id, session_id, status, schema_version, payload, generated_at,
                  created_at, updated_at
           FROM presentation_session_reports
           WHERE workspace_id = ANY($1::uuid[])
           ORDER BY created_at, id`,
        );
        const sessionIds = sessions.rows.map((row) => row.id);
        const participants = sessionIds.length
          ? await client.query(
              `SELECT id, session_id, nickname, status, score, correct_count,
                      accepted_response_ms, joined_at, last_seen_at
               FROM participants WHERE session_id = ANY($1::uuid[]) ORDER BY joined_at, id`,
              [sessionIds],
            )
          : { rows: [] };
        const answers = await queryWorkspaceData(
          `SELECT id, workspace_id, session_id, round_id, participant_id, choice_id,
                  response_payload, response_schema_version, confidence, accepted_at,
                  response_ms, score, correct, idempotency_key
           FROM answers WHERE workspace_id = ANY($1::uuid[]) ORDER BY accepted_at, id`,
        );
        const reports = await queryWorkspaceData(
          `SELECT reports.id, reports.workspace_id, reports.session_id, reports.status,
                  reports.metrics, reports.generated_at, reports.created_at,
                  game_sessions.trust_mode AS source_trust_mode
           FROM reports
           JOIN game_sessions
             ON game_sessions.id = reports.session_id
            AND game_sessions.workspace_id = reports.workspace_id
           WHERE reports.workspace_id = ANY($1::uuid[])
           ORDER BY reports.created_at, reports.id`,
        );
        const interactionSettings = await queryWorkspaceData(
          `SELECT session_id, workspace_id, signals_enabled, chat_enabled, chat_identity_mode,
                  slow_mode_seconds, presenter_feed_mode, audience_seq, updated_at
           FROM session_interaction_settings WHERE workspace_id = ANY($1::uuid[])
           ORDER BY session_id`,
        );
        const participantSignals = await queryWorkspaceData(
          `SELECT workspace_id, session_id, context_key, participant_id, signal, updated_at
           FROM participant_signal_state WHERE workspace_id = ANY($1::uuid[])
           ORDER BY session_id, context_key, participant_id`,
        );
        const signalEvents = await queryWorkspaceData(
          `SELECT id, workspace_id, session_id, context_key, participant_id, signal,
                  audience_seq, created_at
           FROM participant_signal_events WHERE workspace_id = ANY($1::uuid[])
           ORDER BY session_id, audience_seq`,
        );
        const chatMessages = await queryWorkspaceData(
          `SELECT id, workspace_id, session_id, participant_id, actor_id, staff_credential_id,
                  reply_to_id, body, author_alias, identity_mode_at_creation, status, pinned,
                  audience_seq, created_at, updated_at
           FROM chat_messages WHERE workspace_id = ANY($1::uuid[])
           ORDER BY session_id, audience_seq`,
        );
        const chatReactions = await queryWorkspaceData(
          `SELECT workspace_id, session_id, message_id, participant_id, reaction, updated_at
           FROM chat_message_reactions WHERE workspace_id = ANY($1::uuid[])
           ORDER BY session_id, message_id, participant_id`,
        );
        const chatReports = await queryWorkspaceData(
          `SELECT workspace_id, session_id, message_id, participant_id, created_at
           FROM chat_message_reports WHERE workspace_id = ANY($1::uuid[])
           ORDER BY session_id, message_id, participant_id`,
        );
        const audienceRestrictions = await queryWorkspaceData(
          `SELECT workspace_id, session_id, participant_id, muted_until, banned_at, actor_id,
                  staff_credential_id, updated_at
           FROM session_audience_restrictions WHERE workspace_id = ANY($1::uuid[])
           ORDER BY session_id, participant_id`,
        );
        const followups = await queryWorkspaceData(
          `SELECT id, workspace_id, purpose, source_quiz_version_id, source_session_id,
                  source_report_id, recovery_pack_source, recovery_pack_sequence, trust_mode, title, content, concept_keys, time_mode,
                  opens_at, closes_at,
                  expires_at, closed_at, created_by, created_at
           FROM followups WHERE workspace_id = ANY($1::uuid[]) ORDER BY created_at, id`,
        );
        const followupAccess = await queryWorkspaceData(
          `SELECT id, workspace_id, followup_id, source_participant_id, kind, label,
                  time_multiplier, expires_at, revoked_at, created_at
           FROM followup_access_tokens WHERE workspace_id = ANY($1::uuid[])
           ORDER BY created_at, id`,
        );
        const followupAttempts = await queryWorkspaceData(
          `SELECT id, workspace_id, followup_id, access_token_id, source_participant_id,
                  status, phase, current_index, version, intervention_index, advance_receipts, time_multiplier, question_opened_at,
                  deadline_at, completed_at, created_at, updated_at
           FROM followup_attempts WHERE workspace_id = ANY($1::uuid[])
           ORDER BY created_at, id`,
        );
        const followupAnswers = await queryWorkspaceData(
          `SELECT id, workspace_id, followup_id, attempt_id, checkpoint_id, response_payload,
                  response_schema_version, confidence, correct, idempotency_key, submitted_version, accepted_at
           FROM followup_answers WHERE workspace_id = ANY($1::uuid[])
           ORDER BY accepted_at, id`,
        );
        const authoringJobs = await queryWorkspaceData(
          `SELECT id, workspace_id, created_by, source_type, source_name, source_mime_type,
                  source_text, encode(source_blob, 'base64') AS source_blob_base64,
                  source_digest, status, attempts, applied_quiz_id, output, last_error, expires_at,
                  created_at, updated_at
           FROM authoring_jobs WHERE workspace_id = ANY($1::uuid[])
           ORDER BY created_at, id`,
        );
        const institutionPolicies = await queryWorkspaceData(
          `SELECT * FROM workspace_institution_policies
           WHERE workspace_id = ANY($1::uuid[]) ORDER BY workspace_id`,
        );
        const externalIdentities = await queryWorkspaceData(
          `SELECT id, workspace_id, user_id, provider, issuer, subject, email_hint,
                  linked_at, last_used_at
           FROM external_identities WHERE workspace_id = ANY($1::uuid[])
           ORDER BY linked_at, id`,
        );
        const ltiRegistrations = await queryWorkspaceData(
          `SELECT id, workspace_id, name, issuer, client_id, deployment_id,
                  authorization_endpoint, token_endpoint, jwks_url, deep_link_return_origins,
                  status, created_at, updated_at
           FROM lti_platform_registrations WHERE workspace_id = ANY($1::uuid[])
           ORDER BY workspace_id, lower(name), id`,
        );
        const ltiLaunches = await queryWorkspaceData(
          `SELECT id, workspace_id, registration_id, creator_user_id, subject, message_type,
                  role, target_link_uri, quiz_id, context_id, resource_link_id,
                  deep_link_return_url, deep_link_data, completed_at, expires_at, created_at
           FROM lti_launches WHERE workspace_id = ANY($1::uuid[])
           ORDER BY created_at, id`,
        );
        const subscriptions = await queryWorkspaceData(
          `SELECT workspace_id, provider_customer_id, provider_subscription_id, status, plan,
                  current_period_end, updated_at
           FROM subscriptions WHERE workspace_id = ANY($1::uuid[]) ORDER BY workspace_id`,
        );
        const auditEvents = await queryWorkspaceData(
          `SELECT id, workspace_id, actor_id, action, target_type, target_id, request_id,
                  metadata, created_at
           FROM audit_events WHERE workspace_id = ANY($1::uuid[]) ORDER BY created_at, id`,
        );
        const collaborationGroups = await queryWorkspaceData(
          `SELECT id, workspace_id, name, description, created_by, created_at, updated_at
           FROM collaboration_groups WHERE workspace_id = ANY($1::uuid[])
           ORDER BY created_at, id`,
        );
        const collaborationGroupMembers = await client.query(
          `SELECT workspace_id, group_id, user_id, role, joined_at
           FROM collaboration_group_members
           WHERE workspace_id = ANY($1::uuid[]) OR user_id = $2
           ORDER BY workspace_id, group_id, joined_at`,
          [workspaceIds, userId],
        );
        const collaborationGroupArtifacts = await queryWorkspaceData(
          `SELECT id, workspace_id, group_id, artifact_type, artifact_id, added_by, created_at
           FROM collaboration_group_artifacts WHERE workspace_id = ANY($1::uuid[])
           ORDER BY created_at, id`,
        );
        const collaborationGroupMessages = await queryWorkspaceData(
          `SELECT id, workspace_id, group_id, author_id, body, created_at
           FROM collaboration_group_messages WHERE workspace_id = ANY($1::uuid[])
           ORDER BY created_at, id`,
        );
        const collaborationGroupSchedule = await queryWorkspaceData(
          `SELECT id, workspace_id, group_id, artifact_type, artifact_id, kind, scheduled_for,
                  note, created_by, created_at
           FROM collaboration_group_schedule WHERE workspace_id = ANY($1::uuid[])
           ORDER BY scheduled_for, id`,
        );
        const consentRecords = await client.query(
          `SELECT document_type, document_version, accepted_at
           FROM consent_records WHERE user_id = $1 ORDER BY accepted_at`,
          [userId],
        );
        return {
          profile: userResult.rows[0] ?? null,
          workspaceMemberships: membershipResult.rows,
          workspaces: workspaceResult.rows,
          folders: folders.rows,
          surveys: surveys.rows.map((row) => row.data),
          surveyVersions: surveyVersions.rows.map((row) => row.data),
          surveyRooms: surveyRooms.rows.map((row) => row.data),
          quizzes: quizzes.rows.map((row) => ({
            ...row,
            draft: upcastRoundDraft(
              row.draft,
              Number(row.draft_schema_version ?? ROUND_DRAFT_SCHEMA_VERSION),
            ),
          })),
          quizDraftHistory: quizDraftHistory.rows.map((row) => ({
            ...row,
            draft: upcastRoundDraft(
              row.draft,
              Number(row.draft_schema_version ?? ROUND_DRAFT_SCHEMA_VERSION),
            ),
          })),
          questionHealthDismissals: questionHealthDismissals.rows,
          questionHealthApplications: questionHealthApplications.rows,
          quizVersions: quizVersions.rows.map((row) => ({
            ...row,
            content: upcastRoundContent(
              row.content,
              Number(row.content_schema_version ?? ROUND_CONTENT_SCHEMA_VERSION),
            ),
          })),
          presentations: presentations.rows.map((row) => ({
            ...row,
            draft: upcastPresentationDraft(
              row.draft,
              Number(row.draft_schema_version ?? PRESENTATION_DRAFT_SCHEMA_VERSION),
            ),
          })),
          presentationVersions: presentationVersions.rows.map((row) => ({
            ...row,
            content: upcastPresentationContent(
              row.content,
              Number(row.content_schema_version ?? PRESENTATION_CONTENT_SCHEMA_VERSION),
            ),
          })),
          presentationDraftHistory: presentationDraftHistory.rows.map((row) => ({
            ...row,
            draft: upcastPresentationDraft(
              row.draft,
              Number(row.draft_schema_version ?? PRESENTATION_DRAFT_SCHEMA_VERSION),
            ),
          })),
          recoveryPacks: recoveryPacks.rows.map((row) => ({
            ...row,
            draft: upcastRecoveryPackDraft(
              row.draft,
              Number(row.draft_schema_version ?? RECOVERY_PACK_DRAFT_SCHEMA_VERSION),
            ),
          })),
          recoveryPackVersions: recoveryPackVersions.rows.map((row) => ({
            ...row,
            content: upcastRecoveryPackContent(
              row.content,
              Number(row.content_schema_version ?? RECOVERY_PACK_CONTENT_SCHEMA_VERSION),
            ),
          })),
          recoveryPackDraftHistory: recoveryPackDraftHistory.rows.map((row) => ({
            ...row,
            draft: upcastRecoveryPackDraft(
              row.draft,
              Number(row.draft_schema_version ?? RECOVERY_PACK_DRAFT_SCHEMA_VERSION),
            ),
          })),
          recoveryPackDraftMutations: recoveryPackDraftMutations.rows.map((row) => ({
            ...row,
            resulting_draft: upcastRecoveryPackDraft(
              row.resulting_draft,
              Number(row.draft_schema_version ?? RECOVERY_PACK_DRAFT_SCHEMA_VERSION),
            ),
          })),
          recoveryPackSources: recoveryPackSources.rows,
          recoveryPackSourceApprovals: recoveryPackSourceApprovals.rows,
          libraryFavorites: libraryFavorites.rows,
          mediaAssets: mediaAssets.rows,
          mediaReferences: mediaReferences.rows,
          sessions: sessions.rows,
          presentationSessions: presentationSessions.rows,
          audienceScopes: audienceScopes.rows,
          scopedQnaSettings: scopedQnaSettings.rows,
          scopedQnaQuestions: scopedQnaQuestions.rows,
          scopedQnaVotes: scopedQnaVotes.rows,
          scopedQnaBans: scopedQnaBans.rows,
          scopedQnaAudit: scopedQnaAudit.rows,
          presentationSessionParticipants: presentationSessionParticipants.rows,
          presentationSessionResponses: presentationSessionResponses.rows,
          presentationSessionTimeline: presentationSessionTimeline.rows,
          presentationSessionCommandReceipts: presentationSessionCommandReceipts.rows,
          presentationSessionCredentials: presentationSessionCredentials.rows,
          presentationSessionReports: presentationSessionReports.rows,
          participants: participants.rows,
          answers: answers.rows,
          reports: reports.rows.map(({ source_trust_mode: sourceTrustMode, ...row }) => ({
            ...row,
            metrics: normalizeAccountExportReport(row.metrics, sourceTrustMode),
          })),
          interactionSettings: interactionSettings.rows,
          participantSignals: participantSignals.rows,
          signalEvents: signalEvents.rows,
          chatMessages: chatMessages.rows,
          chatReactions: chatReactions.rows,
          chatReports: chatReports.rows,
          audienceRestrictions: audienceRestrictions.rows,
          followups: followups.rows,
          followupAccess: followupAccess.rows,
          followupAttempts: followupAttempts.rows,
          followupAnswers: followupAnswers.rows,
          authoringJobs: authoringJobs.rows,
          institutionPolicies: institutionPolicies.rows,
          externalIdentities: externalIdentities.rows,
          ltiRegistrations: ltiRegistrations.rows,
          ltiLaunches: ltiLaunches.rows,
          billing: subscriptions.rows,
          consentRecords: consentRecords.rows,
          auditEvents: auditEvents.rows,
          collaborationGroups: collaborationGroups.rows,
          collaborationGroupMembers: collaborationGroupMembers.rows,
          collaborationGroupArtifacts: collaborationGroupArtifacts.rows,
          collaborationGroupMessages: collaborationGroupMessages.rows,
          collaborationGroupSchedule: collaborationGroupSchedule.rows,
        };
      },
      { system: true },
    );
  }

  async deleteAccount(userId: string) {
    await this.transaction(
      async (client) => {
        const workspaceResult = await client.query(
          "SELECT workspace_id FROM workspace_members WHERE user_id = $1 AND role = 'owner'",
          [userId],
        );
        for (const row of workspaceResult.rows) {
          await client.query("DELETE FROM workspaces WHERE id = $1", [row.workspace_id]);
        }
        const groupOwnerships = await client.query<{ group_id: string }>(
          `SELECT group_id FROM collaboration_group_members
           WHERE user_id = $1 AND role = 'owner'`,
          [userId],
        );
        for (const { group_id: groupId } of groupOwnerships.rows) {
          const otherOwner = await client.query(
            `SELECT 1 FROM collaboration_group_members
             WHERE group_id = $1 AND user_id <> $2 AND role = 'owner'
             LIMIT 1`,
            [groupId, userId],
          );
          if (otherOwner.rows[0]) continue;
          const successor = await client.query<{ user_id: string }>(
            `SELECT user_id FROM collaboration_group_members
             WHERE group_id = $1 AND user_id <> $2
             ORDER BY joined_at, user_id
             LIMIT 1`,
            [groupId, userId],
          );
          if (successor.rows[0]) {
            await client.query(
              `UPDATE collaboration_group_members SET role = 'owner'
               WHERE group_id = $1 AND user_id = $2`,
              [groupId, successor.rows[0].user_id],
            );
          } else {
            await client.query("DELETE FROM collaboration_groups WHERE id = $1", [groupId]);
          }
        }
        await client.query("DELETE FROM collaboration_group_members WHERE user_id = $1", [userId]);
        await client.query("DELETE FROM library_favorites WHERE user_id = $1", [userId]);
        await client.query("DELETE FROM external_identities WHERE user_id = $1", [userId]);
        await client.query("DELETE FROM workspace_members WHERE user_id = $1", [userId]);
        await client.query("DELETE FROM consent_records WHERE user_id = $1", [userId]);
        await client.query(
          `UPDATE users
           SET email = $2, locale = 'en-CA', locale_explicit = false, deleted_at = now()
           WHERE id = $1`,
          [
            userId,
            `deleted-${createHash("sha256").update(userId).digest("hex").slice(0, 16)}@invalid.local`,
          ],
        );
        await client.query("UPDATE creator_sessions SET revoked_at = now() WHERE user_id = $1", [
          userId,
        ]);
      },
      { system: true },
    );
  }

  async expireLiveSessions(now: Date) {
    const result = await this.systemQuery(
      `UPDATE game_sessions SET ended_at = COALESCE(ended_at, $1), updated_at = now()
       WHERE expires_at <= $1 AND ended_at IS NULL AND deleted_at IS NULL
       RETURNING id`,
      [now],
    );
    return result.rows.map((row) => String(row.id));
  }

  async purgeExpired(now: Date) {
    return this.transaction(
      async (client) => {
        const result = await client.query(
          "DELETE FROM game_sessions WHERE retention_expires_at <= $1 RETURNING id",
          [now],
        );
        const presentationResult = await client.query(
          "DELETE FROM presentation_live_sessions WHERE retention_expires_at <= $1 RETURNING id",
          [now],
        );
        const surveyResult = await client.query(
          "DELETE FROM survey_feedback_rooms WHERE retention_expires_at <= $1 RETURNING id",
          [now],
        );
        await client.query("DELETE FROM auth_magic_tokens WHERE expires_at <= $1", [now]);
        await client.query("DELETE FROM creator_sessions WHERE expires_at <= $1", [now]);
        await client.query("DELETE FROM authoring_jobs WHERE expires_at <= $1", [now]);
        await client.query("DELETE FROM federated_auth_transactions WHERE expires_at <= $1", [now]);
        await client.query("DELETE FROM lti_login_transactions WHERE expires_at <= $1", [now]);
        await client.query("DELETE FROM lti_launches WHERE expires_at <= $1", [now]);
        await client.query(
          "DELETE FROM recovery_pack_draft_history WHERE created_at < $1::timestamptz - interval '30 days'",
          [now],
        );
        await client.query(
          "DELETE FROM recovery_pack_draft_mutations WHERE created_at < $1::timestamptz - interval '30 days'",
          [now],
        );
        await client.query(
          "DELETE FROM recovery_pack_source_approvals WHERE created_at < $1::timestamptz - interval '30 days'",
          [now],
        );
        return [...result.rows, ...presentationResult.rows, ...surveyResult.rows].map((row) =>
          String(row.id),
        );
      },
      { system: true },
    );
  }

  async purgeExpiredPracticeAssignments(now: Date) {
    const result = await this.systemQuery(
      `DELETE FROM followups
       WHERE purpose = 'assignment' AND expires_at <= $1
       RETURNING id`,
      [now],
    );
    return result.rowCount ?? 0;
  }
}
