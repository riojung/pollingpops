import type {
  AudienceSignal,
  BrandTheme,
  AuthoringDraft,
  AuthoringSourceType,
  ChatReaction,
  ConfidenceValue,
  FollowupPurpose,
  FollowupTimeMode,
  IdentityRequirement,
  InstitutionCapabilities,
  InstitutionContractStatus,
  InteractionSettings,
  ProductEvent,
  PresentationCompanionPublishedQuestionCatalog,
  QuestionHealthDismissalReason,
  QuestionHealthRevisionChange,
  QuizDraft,
  RecoveryPackPracticeSource,
  RecoveryPackPracticeSequence,
  Report,
  ResponsePayload,
  SessionDecisionEvent,
  SupportedLocale,
  TimeMultiplier,
  TrustMode,
} from "@openround/contracts";
import type {
  EngineAnswer,
  EngineIntervention,
  EngineRound,
  GameState,
} from "@openround/game-engine";

export type Segment = "education" | "workplace";
export type Plan = "free" | "pro" | "team";

export interface BillingProfile {
  plan: Plan;
  status: string;
  customerId: string | null;
  subscriptionId: string | null;
}

export interface BillingEventInput {
  providerEventId: string;
  eventType: string;
  providerCreatedAt: Date;
  workspaceId?: string;
  plan?: Plan;
  status?: string;
  customerId?: string;
  subscriptionId?: string;
}

export interface CapacityTestWorkspaceProvisionResult {
  workspaceId: string;
  previousPlan: Plan;
  previousStatus: string;
  plan: "team";
  status: "active";
  changed: boolean;
}

export interface RuntimeDatabasePrincipalSecurity {
  principal: string;
  sessionPrincipal: string;
  sessionMatchesCurrent: boolean;
  runtimeRoleMember: boolean;
  superuser: boolean;
  bypassRls: boolean;
  createRole: boolean;
  createDatabase: boolean;
  replication: boolean;
  privilegedRoleMember: boolean;
  unexpectedRoleMember: boolean;
  ownerRoleMember: boolean;
}

export interface CreatorContext {
  userId: string;
  workspaceId: string;
  email: string;
  locale: SupportedLocale;
  localePreferenceSet: boolean;
  segment: Segment;
  role: "owner" | "editor" | "viewer";
  plan: Plan;
}

export interface WorkspaceSummaryRecord {
  id: string;
  name: string;
  segment: Segment;
  role: CreatorContext["role"];
  homeRegion: string;
}

export interface WorkspaceMemberRecord {
  userId: string;
  email: string;
  role: CreatorContext["role"];
  joinedAt: Date | null;
}

export interface WorkspaceInvitationRecord {
  id: string;
  workspaceId: string;
  email: string;
  role: Exclude<CreatorContext["role"], "owner">;
  tokenHash: string;
  invitedBy: string;
  expiresAt: Date;
  acceptedAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
}

export interface InstitutionPolicyRecord {
  workspaceId: string;
  contractStatus: InstitutionContractStatus;
  identityRequirement: IdentityRequirement;
  capabilities: InstitutionCapabilities;
  k12Enabled: false;
  updatedAt: Date | null;
}

export interface ExternalIdentityRecord {
  id: string;
  workspaceId: string;
  userId: string;
  provider: "oidc" | "lti";
  issuer: string;
  subject: string;
  emailHint: string | null;
  linkedAt: Date;
  lastUsedAt: Date | null;
}

export interface FederatedAuthTransactionRecord {
  id: string;
  workspaceId: string;
  userId: string | null;
  mode: "login" | "link";
  stateHash: string;
  codeVerifier: string;
  nonce: string;
  expiresAt: Date;
  createdAt: Date;
}

export interface LtiRegistrationRecord {
  id: string;
  workspaceId: string;
  name: string;
  issuer: string;
  clientId: string;
  deploymentId: string;
  authorizationEndpoint: string;
  tokenEndpoint: string | null;
  jwksUrl: string;
  deepLinkReturnOrigins: string[];
  status: "disabled" | "active";
  createdAt: Date;
  updatedAt: Date;
}

export interface LtiLoginTransactionRecord {
  id: string;
  workspaceId: string;
  registrationId: string;
  stateHash: string;
  nonce: string;
  targetLinkUri: string;
  ltiMessageHint: string | null;
  expiresAt: Date;
  createdAt: Date;
}

export interface LtiLaunchRecord {
  id: string;
  workspaceId: string;
  registrationId: string;
  creatorUserId: string | null;
  subject: string | null;
  messageType: "LtiResourceLinkRequest" | "LtiDeepLinkingRequest";
  role: "instructor" | "learner";
  targetLinkUri: string;
  quizId: string | null;
  contextId: string | null;
  resourceLinkId: string | null;
  deepLinkReturnUrl: string | null;
  deepLinkData: string | null;
  linkTokenHash: string | null;
  responseJwt: string | null;
  completedAt: Date | null;
  expiresAt: Date;
  createdAt: Date;
}

export interface MagicTokenRecord {
  id: string;
  email: string;
  segment: Segment;
  tokenHash: string;
  policyVersion: string;
  expiresAt: Date;
  consumedAt: Date | null;
}

export interface QuizRecord {
  id: string;
  workspaceId: string;
  title: string;
  description: string;
  status: "draft" | "published" | "archived";
  draft: QuizDraft;
  /** Monotonically increases after each accepted draft replacement. */
  draftRevision?: number;
  /** Contract version used to validate and upcast the mutable draft. */
  draftSchemaVersion?: number;
  /** Draft revision represented by currentVersionId, when the current draft has been published. */
  publishedDraftRevision?: number | null;
  /** Most recent facilitator to make a meaningful draft change. */
  lastEditedBy?: string | null;
  currentVersionId: string | null;
  folderId?: string | null;
  tags?: string[];
  createdAt: Date;
  updatedAt: Date;
}

export interface QuizListRecord extends QuizRecord {
  /** Latest retained session creation time for this Round, without exposing session details. */
  lastHostedAt: Date | null;
}

export interface FolderRecord {
  id: string;
  workspaceId: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface QuizVersionRecord {
  id: string;
  workspaceId: string;
  quizId: string;
  version: number;
  content: QuizDraft;
  /** Contract version used to validate and upcast immutable published content. */
  contentSchemaVersion?: number;
  contentHash: string;
  sourceDraftRevision?: number | null;
  publishedAt: Date;
}

export interface QuizDraftHistoryRecord {
  id: string;
  workspaceId: string;
  quizId: string;
  revision: number;
  draft: QuizDraft;
  /** Contract version used to validate and upcast this recovery snapshot. */
  draftSchemaVersion?: number;
  savedBy: string | null;
  mutationId: string | null;
  createdAt: Date;
}

export interface QuestionHealthDismissalRecord {
  workspaceId: string;
  quizId: string;
  findingId: string;
  ruleVersion: number;
  rulesetVersion: string;
  contentHash: string;
  reason: QuestionHealthDismissalReason;
  createdAt: Date;
}

export interface QuestionHealthDismissalWrite {
  actorId: string;
  workspaceId: string;
  quizId: string;
  findingId: string;
  ruleVersion: number;
  rulesetVersion: string;
  contentHash: string;
  reason: QuestionHealthDismissalReason;
  expectedDraftRevision: number;
  requestId: string;
}

export type QuestionHealthDismissalIdentity = Omit<QuestionHealthDismissalWrite, "reason">;

/** Durable provenance for a facilitator-approved, draft-only Question Health edit. */
export interface QuestionHealthApplicationRecord {
  workspaceId: string;
  quizId: string;
  applicationId: string;
  findingId: string;
  ruleVersion: number;
  rulesetVersion: string;
  contentHash: string;
  sourceRevision: number;
  appliedRevision: number;
  requestHash: string;
  changes: QuestionHealthRevisionChange[];
  createdAt: Date;
}

export type QuestionHealthApplicationWrite = Omit<
  QuestionHealthApplicationRecord,
  "appliedRevision" | "createdAt"
> & { requestId: string };

export interface QuizDraftUpdate {
  workspaceId: string;
  quizId: string;
  draft: QuizDraft;
  expectedRevision: number;
  mutationId: string;
  editorId: string;
  schemaVersion: number;
  draftHash: string;
  questionHealthApplication?: QuestionHealthApplicationWrite;
  questionHealthUndo?: { applicationId: string; requestId: string };
  /** Preserve the pre-update snapshot while this accepted Recovery Pack edit is current. */
  recoveryPackUpdateSourceRevision?: number;
}

export interface StoredSession {
  id: string;
  workspaceId: string;
  quizVersionId: string;
  hostId: string;
  hostTokenHash: string;
  /** Frozen identity/privacy promise for this session. */
  trustMode?: TrustMode;
  /** Whether the optional decision timeline was enabled when the session was created. */
  decisionReplayEnabled?: boolean;
  state: GameState;
  /** Last instant at which host and participant credentials may use the live session. */
  expiresAt: Date;
  /** Instant at which the full session, answers, and report may be permanently purged. */
  retentionExpiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export type LiveRoomArtifactType = "round" | "presentation" | "feedback_room";

/** Authoritative claim in the shared seven-digit live-room namespace. */
export interface LiveRoomCodeRecord {
  code: string;
  workspaceId: string;
  artifactType: LiveRoomArtifactType;
  artifactId: string;
  expiresAt: Date;
  releasedAt: Date | null;
  createdAt: Date;
}

export type LiveRoomCodeClaim = Omit<LiveRoomCodeRecord, "releasedAt">;

export interface SessionEvidence {
  decisionReplayEnabled: boolean;
  decisionEvents: SessionDecisionEvent[];
  decisionEventsComplete: boolean;
  answers: EngineAnswer[];
  rounds: Array<EngineRound & { id: string }>;
  interventions: EngineIntervention[];
  qna: {
    questions: number;
    answered: number;
    unresolved: number;
  };
  interactions?: {
    signalEvents: Array<{
      contextKey: string;
      participantId: string;
      signal: AudienceSignal | null;
      createdAt: Date;
    }>;
    chatMessages: ChatMessageRecord[];
    reactions: ChatReactionRecord[];
    reports: number;
    moderationActions: number;
  };
}

export interface SessionDecisionEventWrite {
  event: SessionDecisionEvent;
  commandId: string;
  eventOrdinal: number;
}

export interface ReportJob {
  reportId: string;
  workspaceId: string;
  sessionId: string;
  attempts: number;
  expiresAt: Date;
}

/** Narrow, aggregate-only projection for Question Health. Never contains prompts or participants. */
export interface QuestionHealthObservationReport {
  trustMode: TrustMode;
  timeMode: "timed" | "flex";
  scoringMode: "accuracy" | "speed";
  questions: Array<{
    questionId: string;
    responses: number;
    correct: number;
    responseDistribution?: {
      kind: "choice";
      buckets: Array<{ value: string; count: number }>;
    };
  }>;
}

export interface QuestionHealthObservationReportPage {
  reports: QuestionHealthObservationReport[];
  hasMoreReports: boolean;
}

interface FollowupRecordBase {
  id: string;
  workspaceId: string;
  trustMode?: TrustMode;
  sourceQuizVersionId: string | null;
  recoveryPackSource?: RecoveryPackPracticeSource | null;
  recoveryPackSequence?: RecoveryPackPracticeSequence | null;
  /** Internal creation receipt; never contains access seeds or plaintext credentials. */
  creationMutation?: { mutationId: string; requestHash: string } | null;
  title: string;
  content: QuizDraft;
  conceptKeys: string[];
  timeMode: FollowupTimeMode;
  genericTokenHash: string;
  opensAt: Date;
  closesAt: Date;
  expiresAt: Date;
  closedAt: Date | null;
  createdBy: string | null;
  createdAt: Date;
}

export type FollowupRecord = FollowupRecordBase &
  (
    | {
        purpose: "recovery";
        sourceQuizVersionId: string;
        recoveryPackSource?: null;
        creationMutation?: null;
        sourceSessionId: string;
        sourceReportId: string;
      }
    | {
        purpose: "assignment";
        sourceSessionId: null;
        sourceReportId: null;
      }
  );

export interface FollowupAccessRecord {
  id: string;
  workspaceId: string;
  followupId: string;
  sourceParticipantId: string | null;
  kind: "personal" | "assignment_personal" | "accommodation";
  label: string;
  tokenHash: string;
  timeMultiplier: TimeMultiplier;
  expiresAt: Date;
  revokedAt: Date | null;
  createdAt: Date;
}

export interface FollowupAttemptRecord {
  id: string;
  workspaceId: string;
  followupId: string;
  accessTokenId: string | null;
  sourceParticipantId: string | null;
  attemptTokenHash: string;
  status: "in_progress" | "completed";
  phase: "question_open" | "answer_reveal" | "intervention" | "completed";
  interventionIndex?: number | null;
  advanceReceipts?: Record<string, number>;
  currentIndex: number;
  version: number;
  timeMultiplier: TimeMultiplier;
  questionOpenedAt: Date;
  deadlineAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface FollowupAnswerRecord {
  id: string;
  workspaceId: string;
  followupId: string;
  attemptId: string;
  checkpointId: string;
  response: ResponsePayload;
  confidence: ConfidenceValue | null;
  correct: boolean | null;
  idempotencyKey: string;
  submittedVersion?: number | null;
  acceptedAt: Date;
}

export interface AuthoringJobRecord {
  id: string;
  workspaceId: string;
  createdBy: string | null;
  sourceType: AuthoringSourceType;
  sourceName: string;
  sourceMimeType: string | null;
  sourceText: string | null;
  sourceBlob: Buffer | null;
  sourceDigest: string;
  status: "pending" | "processing" | "ready" | "failed";
  attempts: number;
  appliedQuizId: string | null;
  availableAt: Date;
  output: AuthoringDraft | null;
  lastError: string | null;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface AnswerLookup {
  participantId: string;
  roundId: string;
  idempotencyKey: string;
}

export class SessionVersionConflictError extends Error {
  constructor(
    public readonly sessionId: string,
    public readonly expectedVersion: number,
  ) {
    super(`Session ${sessionId} no longer has expected version ${expectedVersion}`);
    this.name = "SessionVersionConflictError";
  }
}

export class SessionCodeConflictError extends Error {
  constructor(public readonly code: string) {
    super(`Session code ${code} is already active`);
    this.name = "SessionCodeConflictError";
  }
}

export class SessionNotActiveError extends Error {
  constructor(public readonly sessionId: string) {
    super(`Session ${sessionId} is not active`);
    this.name = "SessionNotActiveError";
  }
}

export class WorkspaceDeletionInProgressError extends Error {
  constructor(public readonly workspaceId: string) {
    super(`Workspace ${workspaceId} is being deleted`);
    this.name = "WorkspaceDeletionInProgressError";
  }
}

export class FollowupVersionConflictError extends Error {
  constructor(
    public readonly attemptId: string,
    public readonly expectedVersion: number,
  ) {
    super(`Follow-up attempt ${attemptId} no longer has expected version ${expectedVersion}`);
    this.name = "FollowupVersionConflictError";
  }
}

export class FollowupAccessLimitError extends Error {
  constructor(
    public readonly followupId: string,
    public readonly limit: number,
  ) {
    super(`This practice assignment supports up to ${limit} personal links`);
    this.name = "FollowupAccessLimitError";
  }
}

export class RecoveryPackPracticeAssignmentConflictError extends Error {
  constructor(public readonly mutationId: string) {
    super(`Practice creation mutation ${mutationId} was already used for a different request`);
    this.name = "RecoveryPackPracticeAssignmentConflictError";
  }
}

export class PublishedQuizLimitError extends Error {
  constructor(public readonly limit: number) {
    super(`This plan supports ${limit} published Rounds and Surveys combined`);
    this.name = "PublishedQuizLimitError";
  }
}

export class QuizDraftRevisionConflictError extends Error {
  constructor(
    public readonly quizId: string,
    public readonly expectedRevision: number,
    public readonly currentRevision: number,
    public readonly currentEditorId: string | null = null,
  ) {
    super(
      `Round ${quizId} draft revision ${currentRevision} does not match expected revision ${expectedRevision}`,
    );
    this.name = "QuizDraftRevisionConflictError";
  }
}

export class QuizDraftMutationConflictError extends Error {
  constructor(public readonly mutationId: string) {
    super("The Round draft mutation ID was already used for another change");
    this.name = "QuizDraftMutationConflictError";
  }
}

export interface ParticipantRecord {
  id: string;
  sessionId: string;
  nickname: string;
  tokenHash: string;
  status: "active" | "disconnected" | "kicked";
  joinedAt: Date;
}

export interface SessionStaffCredentialRecord {
  id: string;
  workspaceId: string;
  sessionId: string;
  role: "cohost" | "presenter";
  purpose: "collaboration" | "creator_resume";
  label: string;
  tokenHash: string;
  embedPolicyKeyHash?: string | null;
  embedAllowedOrigins?: string[];
  createdBy: string;
  expiresAt: Date;
  revokedAt: Date | null;
  createdAt: Date;
}

export type SessionStaffCredentialInput = Omit<SessionStaffCredentialRecord, "purpose"> & {
  purpose?: SessionStaffCredentialRecord["purpose"];
};

export interface SessionStaffCredentialReplacement {
  credential: SessionStaffCredentialRecord;
  revokedCredentialIds: string[];
}

export interface HistoryCursor {
  createdAt: Date;
  /** Exact database timestamp used for keyset comparisons when Date precision is insufficient. */
  cursorCreatedAt?: string;
  id: string;
}

export interface SessionHistoryRecord {
  id: string;
  quizId: string;
  title: string;
  status: "active" | "finished" | "expired";
  phase: GameState["phase"];
  code: string;
  participantCount: number;
  answerCount: number;
  questionCount: number;
  questionPosition: number | null;
  createdAt: Date;
  /** Exact database timestamp used to create the next opaque keyset cursor. */
  cursorCreatedAt?: string;
  updatedAt: Date;
  expiresAt: Date;
  reportId: string | null;
}

export interface ReportHistoryRecord {
  id: string;
  sessionId: string;
  trustMode: TrustMode;
  quizId: string;
  title: string;
  status: Report["status"];
  participantCount: number;
  initialAccuracyPercent: number;
  recovery: { recovered: number; eligible: number; percent: number | null };
  unresolvedConceptCount: number;
  interventionCount: number;
  followupId: string | null;
  followupStatus: FollowupHistoryRecord["status"] | null;
  generatedAt: Date | null;
  createdAt: Date;
  /** Exact database timestamp used to create the next opaque keyset cursor. */
  cursorCreatedAt?: string;
  expiresAt: Date;
}

interface FollowupHistoryRecordBase {
  id: string;
  quizId: string | null;
  sourceQuizVersionId: string | null;
  recoveryPackSource?: RecoveryPackPracticeSource | null;
  trustMode: TrustMode;
  title: string;
  status: "scheduled" | "open" | "closed" | "expired";
  conceptKeys: string[];
  checkpointCount: number;
  attemptCount: number;
  completedAttemptCount: number;
  opensAt: Date;
  closesAt: Date;
  expiresAt: Date;
  createdAt: Date;
  /** Exact database timestamp used to create the next opaque keyset cursor. */
  cursorCreatedAt?: string;
}

export type FollowupHistoryRecord = FollowupHistoryRecordBase &
  (
    | {
        purpose: "recovery";
        quizId: string;
        sourceQuizVersionId: string;
        recoveryPackSource?: null;
        sourceSessionId: string;
        sourceReportId: string;
      }
    | {
        purpose: "assignment";
        sourceSessionId: null;
        sourceReportId: null;
      }
  );

export interface HistoryPage<T> {
  items: T[];
  hasMore: boolean;
}

export interface FollowupHistoryListOptions {
  cursor?: HistoryCursor;
  limit: number;
  purpose?: FollowupPurpose;
  status?: FollowupHistoryRecord["status"];
  quizId?: string;
  from?: Date;
  to?: Date;
  now: Date;
}

export interface ProductEventRecord extends ProductEvent {
  id: string;
  workspaceId: string;
  expiresAt: Date;
  createdAt: Date;
}

export interface RecoveryPackPracticeCreationContext {
  requestId: string;
  segment?: Segment;
}

export interface QnaSettingsRecord {
  workspaceId: string;
  sessionId: string;
  enabled: boolean;
  displayMode: "anonymous_public" | "alias_public";
  moderationMode: "pre" | "post";
  participantReplies: boolean;
  updatedAt: Date;
}

export interface QnaQuestionRecord {
  id: string;
  workspaceId: string;
  sessionId: string;
  participantId: string;
  body: string;
  publicAlias: string;
  status: "pending" | "published" | "answered" | "dismissed" | "removed";
  label: string | null;
  voteCount: number;
  votedByViewer: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface QnaReplyRecord {
  id: string;
  workspaceId: string;
  sessionId: string;
  questionId: string;
  participantId: string | null;
  actorId: string | null;
  staffCredentialId: string | null;
  body: string;
  publicAlias: string;
  status: "pending" | "published" | "removed";
  createdAt: Date;
  updatedAt: Date;
}

export interface InteractionSettingsRecord extends InteractionSettings {
  workspaceId: string;
  sessionId: string;
  audienceSeq: number;
  closedAt: Date | null;
  updatedAt: Date;
}

export interface ParticipantSignalRecord {
  workspaceId: string;
  sessionId: string;
  contextKey: string;
  participantId: string;
  signal: AudienceSignal;
  updatedAt: Date;
}

export interface ChatMessageRecord {
  id: string;
  workspaceId: string;
  sessionId: string;
  participantId: string | null;
  actorId: string | null;
  staffCredentialId: string | null;
  replyToId: string | null;
  body: string;
  authorAlias: string;
  identityModeAtCreation: InteractionSettings["chatIdentityMode"];
  status: "published" | "removed";
  pinned: boolean;
  idempotencyKey: string;
  audienceSeq: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface ChatReactionRecord {
  workspaceId: string;
  sessionId: string;
  messageId: string;
  participantId: string;
  reaction: ChatReaction;
  updatedAt: Date;
}

export interface AudienceRestrictionRecord {
  workspaceId: string;
  sessionId: string;
  participantId: string;
  mutedUntil: Date | null;
  bannedAt: Date | null;
  actorId: string | null;
  staffCredentialId: string | null;
  updatedAt: Date;
}

export interface AudienceOutboxRecord {
  eventId: string;
  workspaceId: string;
  sessionId: string;
  audienceSeq: number;
  type: string;
  idempotencyKey: string;
  payload: Record<string, unknown>;
  attempts: number;
  claimedAt: Date | null;
  deliveredAt: Date | null;
  createdAt: Date;
}

export interface AudienceEventInput {
  eventId: string;
  idempotencyKey: string;
  type: string;
  payload: Record<string, unknown>;
}

export interface AudienceMutation<T> {
  record: T;
  event: AudienceOutboxRecord;
  duplicate: boolean;
}

export interface ChatReactionSummaryRecord {
  messageId: string;
  counts: Partial<Record<ChatReaction, number>>;
  viewerReaction: ChatReaction | null;
}

export interface ChatMessageListOptions {
  cursor?: { createdAt: Date; id: string };
  limit?: number;
  pinnedOnly?: boolean;
}

export interface ChatActivitySummaryRecord {
  messagesLastMinute: number;
  uniqueContributors: number;
  removedMessages: number;
  reportCount: number;
}

export interface ParticipantChatActivityRecord {
  participantId: string;
  messageCount: number;
  latestMessageAt: Date | null;
}

export class AudienceStoreError extends Error {
  constructor(
    public readonly code:
      | "CHAT_DISABLED"
      | "CHAT_MUTED"
      | "CHAT_RATE_LIMITED"
      | "CHAT_CAPACITY_REACHED"
      | "AUDIENCE_BANNED"
      | "SIGNAL_RATE_LIMITED"
      | "MESSAGE_REMOVED"
      | "NOT_FOUND"
      | "CONFLICT",
    message: string,
  ) {
    super(message);
    this.name = "AudienceStoreError";
  }
}

export type MediaScanStatus = "pending" | "finalizing" | "clean" | "rejected" | "deleting";

// Presigned uploads are valid for ten minutes. Keep a deletion tombstone beyond that window so a
// late client cannot recreate a quarantine object after the final object sweep and metadata purge.
export const MEDIA_DELETION_TOMBSTONE_HOLD_MS = 11 * 60_000;

export interface MediaAssetRecord {
  id: string;
  workspaceId: string;
  objectKey: string;
  mimeType: "image/jpeg" | "image/png" | "image/webp";
  sizeBytes: number;
  scanStatus: MediaScanStatus;
  altText: string;
  createdAt: Date;
  deletionStartedAt: Date | null;
  finalizedAt: Date | null;
}

export interface MediaObjectCleanupClaim {
  asset: MediaAssetRecord;
  pass: 0 | 1;
  claimToken: string;
}

export interface WorkspaceMediaDeletionJobRecord {
  workspaceId: string;
  deletionStartedAt: Date;
  sweepAfter: Date;
}

export interface SessionInvalidationTarget {
  sessionId: string;
  code: string;
}

export type MediaAssetCreateInput = Omit<MediaAssetRecord, "deletionStartedAt" | "finalizedAt"> & {
  deletionStartedAt?: null;
  finalizedAt?: null;
};

export type MediaReferenceOwnerType =
  | "quiz_draft"
  | "quiz_version"
  | "quiz_history"
  | "presentation_draft"
  | "presentation_version"
  | "presentation_history"
  | "recovery_pack_draft"
  | "recovery_pack_version"
  | "recovery_pack_history"
  | "recovery_pack_mutation"
  | "followup";

/**
 * A durable usage edge between a media asset and authoring content. References are
 * intentionally placement-agnostic: accessibility text stays on the question or
 * slide, while this record exists only to make retention and deletion safe.
 */
export interface MediaReferenceRecord {
  workspaceId: string;
  mediaId: string;
  ownerType: MediaReferenceOwnerType;
  ownerId: string;
  createdAt: Date;
}

export interface AuditInput {
  workspaceId: string | null;
  actorId: string | null;
  action: string;
  targetType: string;
  targetId: string | null;
  requestId: string;
  metadata?: Record<string, unknown>;
}

export interface AuditEventRecord extends AuditInput {
  id: string;
  createdAt: Date;
}

export interface OperationalFeaturesRecord {
  signups: boolean;
  sessionCreation: boolean;
  mediaUploads: boolean;
  roundExperiences: boolean;
  audiencePulse: boolean;
  roomChat: boolean;
  updatedAt: Date | null;
}

export type OperationalFeaturesUpdate = Partial<
  Pick<
    OperationalFeaturesRecord,
    | "signups"
    | "sessionCreation"
    | "mediaUploads"
    | "roundExperiences"
    | "audiencePulse"
    | "roomChat"
  >
>;

export type LibraryArtifactDeletionResult = "deleted" | "not_found" | "not_archived" | "in_use";

export interface Repository {
  initialize(): Promise<void>;
  close(): Promise<void>;
  getOperationalFeatures(): Promise<OperationalFeaturesRecord>;
  updateOperationalFeatures(
    input: OperationalFeaturesUpdate,
    requestId: string,
  ): Promise<OperationalFeaturesRecord>;
  createMagicToken(input: MagicTokenRecord): Promise<void>;
  consumeMagicToken(tokenHash: string, now: Date): Promise<CreatorContext | null>;
  createCreatorSession(input: {
    id: string;
    userId: string;
    tokenHash: string;
    expiresAt: Date;
    activeWorkspaceId?: string;
  }): Promise<void>;
  getCreatorBySession(tokenHash: string, now: Date): Promise<CreatorContext | null>;
  updateUserLocale(userId: string, locale: SupportedLocale): Promise<SupportedLocale | null>;
  listWorkspaces(userId: string): Promise<WorkspaceSummaryRecord[]>;
  setCreatorSessionWorkspace(
    tokenHash: string,
    userId: string,
    workspaceId: string,
  ): Promise<boolean>;
  listWorkspaceMembers(workspaceId: string): Promise<WorkspaceMemberRecord[]>;
  updateWorkspaceMemberRole(
    workspaceId: string,
    userId: string,
    role: Exclude<CreatorContext["role"], "owner">,
  ): Promise<WorkspaceMemberRecord | null>;
  removeWorkspaceMember(workspaceId: string, userId: string): Promise<boolean>;
  createWorkspaceInvitation(input: WorkspaceInvitationRecord): Promise<WorkspaceInvitationRecord>;
  listWorkspaceInvitations(workspaceId: string): Promise<WorkspaceInvitationRecord[]>;
  revokeWorkspaceInvitation(workspaceId: string, invitationId: string): Promise<boolean>;
  acceptWorkspaceInvitation(
    tokenHash: string,
    now: Date,
    policyVersion: string,
  ): Promise<CreatorContext | null>;
  revokeCreatorSession(tokenHash: string): Promise<void>;
  getCreatorByUserId(userId: string, workspaceId: string): Promise<CreatorContext | null>;
  listQuizzes(workspaceId: string, includeArchived?: boolean): Promise<QuizListRecord[]>;
  listPublishedQuizQuestionMetadata(
    workspaceId: string,
    search?: string,
    limit?: number,
  ): Promise<PresentationCompanionPublishedQuestionCatalog>;
  listFolders(workspaceId: string): Promise<FolderRecord[]>;
  createFolder(input: FolderRecord): Promise<FolderRecord>;
  renameFolder(workspaceId: string, folderId: string, name: string): Promise<FolderRecord | null>;
  deleteFolder(workspaceId: string, folderId: string): Promise<boolean>;
  organizeQuiz(
    workspaceId: string,
    quizId: string,
    folderId: string | null,
    tags: string[],
  ): Promise<QuizRecord | null>;
  createQuiz(input: QuizRecord): Promise<QuizRecord>;
  getQuiz(workspaceId: string, quizId: string): Promise<QuizRecord | null>;
  updateQuiz(
    workspaceId: string,
    quizId: string,
    draft: QuizDraft,
    expectedDraftRevision?: number,
    editorId?: string,
  ): Promise<QuizRecord | null>;
  updateQuizDraft(input: QuizDraftUpdate): Promise<QuizRecord | null>;
  getQuestionHealthApplication(
    workspaceId: string,
    quizId: string,
    applicationId: string,
  ): Promise<QuestionHealthApplicationRecord | null>;
  listQuestionHealthDismissals(
    workspaceId: string,
    quizId: string,
  ): Promise<QuestionHealthDismissalRecord[]>;
  putQuestionHealthDismissal(
    input: QuestionHealthDismissalWrite,
  ): Promise<
    | { status: "ok"; dismissal: QuestionHealthDismissalRecord }
    | { status: "not_found" }
    | { status: "revision_conflict" }
  >;
  deleteQuestionHealthDismissal(
    input: QuestionHealthDismissalIdentity,
  ): Promise<
    { status: "ok"; removed: boolean } | { status: "not_found" } | { status: "revision_conflict" }
  >;
  listQuizDraftHistory(
    workspaceId: string,
    quizId: string,
    limit?: number,
  ): Promise<QuizDraftHistoryRecord[]>;
  restoreQuizDraftHistory(input: {
    workspaceId: string;
    quizId: string;
    historyRevision: number;
    expectedRevision: number;
    mutationId: string;
    editorId: string;
    questionHealthUndo?: { applicationId: string; requestId: string };
  }): Promise<QuizRecord | null>;
  archiveQuiz(
    workspaceId: string,
    quizId: string,
    archived: boolean,
    maxPublishedQuizzes?: number | null,
  ): Promise<QuizRecord | null>;
  deleteQuiz(workspaceId: string, quizId: string): Promise<LibraryArtifactDeletionResult>;
  duplicateQuiz(input: QuizRecord): Promise<QuizRecord>;
  publishQuiz(
    input: QuizVersionRecord,
    maxPublishedQuizzes?: number | null,
    expectedDraftRevision?: number,
  ): Promise<QuizVersionRecord>;
  getQuizVersion(workspaceId: string, versionId: string): Promise<QuizVersionRecord | null>;
  countPublishedQuizzes(workspaceId: string): Promise<number>;
  getBrandTheme(workspaceId: string): Promise<BrandTheme | null>;
  updateBrandTheme(workspaceId: string, theme: BrandTheme | null): Promise<BrandTheme | null>;
  getEmbedAllowedOrigins(workspaceId: string): Promise<string[]>;
  updateEmbedAllowedOrigins(workspaceId: string, origins: string[]): Promise<string[]>;
  getInstitutionPolicy(workspaceId: string): Promise<InstitutionPolicyRecord>;
  updateInstitutionPolicy(input: InstitutionPolicyRecord, requestId: string): Promise<void>;
  createFederatedAuthTransaction(input: FederatedAuthTransactionRecord): Promise<void>;
  consumeFederatedAuthTransaction(
    stateHash: string,
    now: Date,
  ): Promise<FederatedAuthTransactionRecord | null>;
  linkExternalIdentity(input: ExternalIdentityRecord): Promise<ExternalIdentityRecord | null>;
  getExternalIdentity(
    workspaceId: string,
    provider: ExternalIdentityRecord["provider"],
    issuer: string,
    subject: string,
  ): Promise<ExternalIdentityRecord | null>;
  listExternalIdentities(workspaceId: string, userId: string): Promise<ExternalIdentityRecord[]>;
  touchExternalIdentity(identityId: string, usedAt: Date): Promise<void>;
  unlinkExternalIdentity(workspaceId: string, userId: string, identityId: string): Promise<boolean>;
  upsertLtiRegistration(input: LtiRegistrationRecord): Promise<LtiRegistrationRecord>;
  listLtiRegistrations(workspaceId: string): Promise<LtiRegistrationRecord[]>;
  getLtiRegistration(registrationId: string): Promise<LtiRegistrationRecord | null>;
  findLtiRegistration(
    issuer: string,
    clientId?: string,
    deploymentId?: string,
  ): Promise<LtiRegistrationRecord | null>;
  createLtiLoginTransaction(input: LtiLoginTransactionRecord): Promise<void>;
  consumeLtiLoginTransaction(
    stateHash: string,
    now: Date,
  ): Promise<LtiLoginTransactionRecord | null>;
  createLtiLaunch(input: LtiLaunchRecord): Promise<LtiLaunchRecord>;
  getLtiLaunch(workspaceId: string, launchId: string, now: Date): Promise<LtiLaunchRecord | null>;
  bindLtiLaunch(
    linkTokenHash: string,
    userId: string,
    identityId: string,
    now: Date,
  ): Promise<LtiLaunchRecord | null>;
  completeLtiDeepLink(
    workspaceId: string,
    launchId: string,
    userId: string,
    quizId: string,
    responseJwt: string,
    completedAt: Date,
  ): Promise<LtiLaunchRecord | null>;
  getEmbedPolicyByKey(
    policyKeyHash: string,
    sessionId: string,
    now: Date,
  ): Promise<{ allowedOrigins: string[]; expiresAt: Date } | null>;
  getLiveRoomCode(code: string, now?: Date): Promise<LiveRoomCodeRecord | null>;
  claimLiveRoomCode(input: LiveRoomCodeClaim): Promise<LiveRoomCodeRecord>;
  releaseLiveRoomCode(
    artifactType: LiveRoomArtifactType,
    artifactId: string,
    releasedAt?: Date,
  ): Promise<boolean>;
  createSession(input: StoredSession): Promise<void>;
  getSessionById(sessionId: string): Promise<StoredSession | null>;
  getSessionByCode(code: string): Promise<StoredSession | null>;
  listSessionIds(workspaceId: string): Promise<string[]>;
  listSessionInvalidationTargets(workspaceId: string): Promise<SessionInvalidationTarget[]>;
  workspaceDeletionStarted(workspaceId: string): Promise<boolean>;
  listSessionHistory(
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
  ): Promise<HistoryPage<SessionHistoryRecord>>;
  saveSession(
    input: StoredSession,
    expectedVersion: number,
    report?: Report,
    decisionEvents?: SessionDecisionEventWrite[],
  ): Promise<void>;
  deleteSession(workspaceId: string, sessionId: string): Promise<boolean>;
  createParticipant(input: ParticipantRecord): Promise<void>;
  commitParticipants(
    session: StoredSession,
    participants: ParticipantRecord[],
    expectedVersion: number,
  ): Promise<void>;
  getParticipantByToken(tokenHash: string): Promise<ParticipantRecord | null>;
  getParticipants(sessionId: string): Promise<ParticipantRecord[]>;
  createSessionStaffCredential(
    input: SessionStaffCredentialInput,
  ): Promise<SessionStaffCredentialRecord>;
  replaceCreatorResumeCredential(
    input: SessionStaffCredentialRecord,
  ): Promise<SessionStaffCredentialReplacement>;
  getSessionStaffByToken(
    tokenHash: string,
    now: Date,
  ): Promise<SessionStaffCredentialRecord | null>;
  listSessionStaff(workspaceId: string, sessionId: string): Promise<SessionStaffCredentialRecord[]>;
  revokeSessionStaff(
    workspaceId: string,
    sessionId: string,
    credentialId: string,
  ): Promise<boolean>;
  getWorkspaceSegment(workspaceId: string): Promise<Segment>;
  getQnaSettings(workspaceId: string, sessionId: string): Promise<QnaSettingsRecord | null>;
  saveQnaSettings(input: QnaSettingsRecord): Promise<QnaSettingsRecord>;
  createQnaQuestion(input: QnaQuestionRecord): Promise<QnaQuestionRecord>;
  getQnaQuestion(workspaceId: string, questionId: string): Promise<QnaQuestionRecord | null>;
  listQnaQuestions(
    workspaceId: string,
    sessionId: string,
    viewerParticipantId?: string,
  ): Promise<QnaQuestionRecord[]>;
  updateQnaQuestion(
    workspaceId: string,
    questionId: string,
    update: Pick<QnaQuestionRecord, "status" | "label">,
  ): Promise<QnaQuestionRecord | null>;
  createQnaReply(input: QnaReplyRecord): Promise<QnaReplyRecord>;
  getQnaReply(workspaceId: string, replyId: string): Promise<QnaReplyRecord | null>;
  listQnaReplies(workspaceId: string, questionId: string): Promise<QnaReplyRecord[]>;
  updateQnaReply(
    workspaceId: string,
    replyId: string,
    status: QnaReplyRecord["status"],
  ): Promise<QnaReplyRecord | null>;
  setQnaVote(
    workspaceId: string,
    sessionId: string,
    questionId: string,
    participantId: string,
    voted: boolean,
  ): Promise<number>;
  isQnaBanned(workspaceId: string, sessionId: string, participantId: string): Promise<boolean>;
  banQnaParticipant(
    workspaceId: string,
    sessionId: string,
    participantId: string,
    actorId: string | null,
  ): Promise<void>;
  getInteractionSettings(
    workspaceId: string,
    sessionId: string,
  ): Promise<InteractionSettingsRecord | null>;
  appendAudienceEvent(
    workspaceId: string,
    sessionId: string,
    event: AudienceEventInput,
    createdAt: Date,
  ): Promise<AudienceMutation<null>>;
  saveInteractionSettings(
    input: Omit<InteractionSettingsRecord, "audienceSeq" | "closedAt">,
    event: AudienceEventInput,
  ): Promise<AudienceMutation<InteractionSettingsRecord>>;
  listParticipantSignals(
    workspaceId: string,
    sessionId: string,
    contextKey: string,
  ): Promise<ParticipantSignalRecord[]>;
  countRecentSignalEvents(workspaceId: string, sessionId: string, since: Date): Promise<number>;
  setParticipantSignal(
    input: {
      workspaceId: string;
      sessionId: string;
      contextKey: string;
      participantId: string;
      signal: AudienceSignal | null;
      now: Date;
    },
    event: AudienceEventInput,
  ): Promise<AudienceMutation<ParticipantSignalRecord | null>>;
  getChatMessage(workspaceId: string, messageId: string): Promise<ChatMessageRecord | null>;
  listChatMessages(
    workspaceId: string,
    sessionId: string,
    options?: ChatMessageListOptions,
  ): Promise<ChatMessageRecord[]>;
  createChatMessage(
    input: Omit<ChatMessageRecord, "audienceSeq">,
    event: AudienceEventInput,
  ): Promise<AudienceMutation<ChatMessageRecord>>;
  updateChatMessage(
    workspaceId: string,
    sessionId: string,
    messageId: string,
    update: { status?: ChatMessageRecord["status"]; pinned?: boolean },
    event: AudienceEventInput,
    updatedAt: Date,
  ): Promise<AudienceMutation<ChatMessageRecord>>;
  listChatReactions(
    workspaceId: string,
    sessionId: string,
    messageIds?: string[],
  ): Promise<ChatReactionRecord[]>;
  getChatActivitySummary(
    workspaceId: string,
    sessionId: string,
    since: Date,
  ): Promise<ChatActivitySummaryRecord>;
  listParticipantChatActivity(
    workspaceId: string,
    sessionId: string,
  ): Promise<ParticipantChatActivityRecord[]>;
  setChatReaction(
    input: {
      workspaceId: string;
      sessionId: string;
      messageId: string;
      participantId: string;
      reaction: ChatReaction | null;
      now: Date;
    },
    event: AudienceEventInput,
  ): Promise<AudienceMutation<ChatReactionSummaryRecord>>;
  reportChatMessage(
    workspaceId: string,
    sessionId: string,
    messageId: string,
    participantId: string,
    now: Date,
    event: AudienceEventInput,
  ): Promise<AudienceMutation<number>>;
  countChatReports(workspaceId: string, sessionId: string): Promise<number>;
  getAudienceRestriction(
    workspaceId: string,
    sessionId: string,
    participantId: string,
  ): Promise<AudienceRestrictionRecord | null>;
  listAudienceRestrictions(
    workspaceId: string,
    sessionId: string,
  ): Promise<AudienceRestrictionRecord[]>;
  saveAudienceRestriction(
    input: AudienceRestrictionRecord,
    event: AudienceEventInput,
  ): Promise<AudienceMutation<AudienceRestrictionRecord>>;
  claimAudienceOutbox(now: Date, staleBefore: Date): Promise<AudienceOutboxRecord | null>;
  completeAudienceOutbox(eventId: string, deliveredAt: Date): Promise<boolean>;
  getAudienceOutboxStatus(): Promise<{
    pending: number;
    oldestCreatedAt: Date | null;
    chatEnabledSessions: number;
  }>;
  getSessionEvidence(workspaceId: string, sessionId: string): Promise<SessionEvidence>;
  findAnswers(
    workspaceId: string,
    sessionId: string,
    lookups: AnswerLookup[],
  ): Promise<EngineAnswer[]>;
  findParticipantIdsWithAnswers(
    workspaceId: string,
    sessionId: string,
    participantIds: string[],
  ): Promise<string[]>;
  createMediaAsset(input: MediaAssetCreateInput): Promise<MediaAssetRecord>;
  getMediaAsset(workspaceId: string, mediaId: string): Promise<MediaAssetRecord | null>;
  listMediaAssets(workspaceId: string): Promise<MediaAssetRecord[]>;
  listMediaReferences(workspaceId: string, mediaId?: string): Promise<MediaReferenceRecord[]>;
  replaceMediaReferences(
    workspaceId: string,
    ownerType: MediaReferenceOwnerType,
    ownerId: string,
    mediaIds: string[],
    createdAt?: Date,
  ): Promise<MediaReferenceRecord[]>;
  listStaleMedia(cutoff: Date, limit?: number): Promise<MediaAssetRecord[]>;
  listUnattachedMedia(cutoff: Date, limit?: number): Promise<MediaAssetRecord[]>;
  claimMediaObjectCleanupCandidates(now: Date, limit?: number): Promise<MediaObjectCleanupClaim[]>;
  renewMediaObjectCleanupClaim(claim: MediaObjectCleanupClaim, renewedAt: Date): Promise<boolean>;
  completeMediaObjectCleanupClaim(
    claim: MediaObjectCleanupClaim,
    completedAt: Date,
  ): Promise<boolean>;
  deferMediaObjectCleanupClaim(claim: MediaObjectCleanupClaim, retryAt: Date): Promise<boolean>;
  completeInlineMediaObjectCleanup(asset: MediaAssetRecord, completedAt: Date): Promise<boolean>;
  updateMediaAsset(
    workspaceId: string,
    mediaId: string,
    update: {
      objectKey?: string;
      scanStatus: "clean" | "rejected";
      finalizationToken: string;
      finalizedAt: Date;
    },
  ): Promise<MediaAssetRecord | null>;
  claimMediaAssetFinalization(
    workspaceId: string,
    mediaId: string,
    finalizationToken: string,
    claimedAt?: Date,
  ): Promise<MediaAssetRecord | null>;
  releaseMediaAssetFinalization(
    workspaceId: string,
    mediaId: string,
    finalizationToken: string,
  ): Promise<boolean>;
  claimMediaAssetDeletion(
    workspaceId: string,
    mediaId: string,
    now?: Date,
  ): Promise<MediaAssetRecord | null>;
  claimWorkspaceMediaDeletion(workspaceId: string, now?: Date): Promise<MediaAssetRecord[]>;
  listDueWorkspaceMediaDeletionJobs(
    now: Date,
    limit?: number,
  ): Promise<WorkspaceMediaDeletionJobRecord[]>;
  completeWorkspaceMediaDeletionJob(workspaceId: string, deletionStartedAt: Date): Promise<boolean>;
  deleteMediaAsset(workspaceId: string, mediaId: string, now?: Date): Promise<boolean>;
  persistAnswer(
    workspaceId: string,
    sessionId: string,
    answer: EngineAnswer,
  ): Promise<EngineAnswer>;
  commitAnswer(
    session: StoredSession,
    answer: EngineAnswer,
    expectedVersion: number,
  ): Promise<EngineAnswer>;
  commitAnswers(
    session: StoredSession,
    answers: EngineAnswer[],
    expectedVersion: number,
    options?: { roundEvidencePersisted?: boolean },
  ): Promise<EngineAnswer[]>;
  saveReport(workspaceId: string, report: Report): Promise<void>;
  claimReportJob(now: Date, leaseUntil: Date): Promise<ReportJob | null>;
  completeReportJob(job: ReportJob, report: Report): Promise<void>;
  retryReportJob(job: ReportJob, error: string, availableAt: Date, failed: boolean): Promise<void>;
  getReport(workspaceId: string, reportId: string): Promise<Report | null>;
  getReportBySession(workspaceId: string, sessionId: string): Promise<Report | null>;
  listQuestionHealthObservationReports(
    workspaceId: string,
    quizId: string,
    quizVersionId: string,
    now: Date,
  ): Promise<QuestionHealthObservationReportPage>;
  listReportHistory(
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
  ): Promise<HistoryPage<ReportHistoryRecord>>;
  createFollowup(
    input: Extract<FollowupRecord, { purpose: "recovery" }>,
    access: FollowupAccessRecord[],
  ): Promise<void>;
  createPracticeAssignment(
    sourceQuizId: string,
    input: Extract<FollowupRecord, { purpose: "assignment" }>,
    access: FollowupAccessRecord[],
  ): Promise<boolean>;
  getRecoveryPackPracticeAssignment(
    workspaceId: string,
    packId: string,
    mutationId: string,
    requestHash: string,
  ): Promise<FollowupRecord | null>;
  createRecoveryPackPracticeAssignment(
    packId: string,
    input: Extract<FollowupRecord, { purpose: "assignment" }>,
    access: FollowupAccessRecord[],
    context: RecoveryPackPracticeCreationContext,
  ): Promise<{
    followup: FollowupRecord;
    created: boolean;
    productEvent: ProductEventRecord | null;
  } | null>;
  getFollowup(workspaceId: string, followupId: string): Promise<FollowupRecord | null>;
  getFollowupProgress(
    workspaceId: string,
    followupId: string,
  ): Promise<{ attemptCount: number; completedAttemptCount: number } | null>;
  getFollowupByReport(workspaceId: string, reportId: string): Promise<FollowupRecord | null>;
  listFollowupHistory(
    workspaceId: string,
    options: FollowupHistoryListOptions,
  ): Promise<HistoryPage<FollowupHistoryRecord>>;
  getFollowupByGenericToken(
    followupId: string,
    tokenHash: string,
    now: Date,
  ): Promise<FollowupRecord | null>;
  getFollowupAccessByToken(
    followupId: string,
    tokenHash: string,
    now: Date,
  ): Promise<FollowupAccessRecord | null>;
  listFollowupAccess(workspaceId: string, followupId: string): Promise<FollowupAccessRecord[]>;
  createFollowupAccess(input: FollowupAccessRecord): Promise<FollowupAccessRecord>;
  createAssignmentPersonalAccess(
    input: FollowupAccessRecord,
    maximumLinks: number,
  ): Promise<FollowupAccessRecord | null>;
  revokeFollowupAccess(
    workspaceId: string,
    followupId: string,
    accessId: string,
    revokedAt: Date,
  ): Promise<boolean>;
  closeFollowup(workspaceId: string, followupId: string, closedAt: Date): Promise<boolean>;
  createOrGetFollowupAttempt(input: FollowupAttemptRecord): Promise<FollowupAttemptRecord>;
  getFollowupAttemptByToken(
    followupId: string,
    tokenHash: string,
    now: Date,
  ): Promise<FollowupAttemptRecord | null>;
  getFollowupAnswer(attemptId: string, checkpointId: string): Promise<FollowupAnswerRecord | null>;
  getFollowupAnswerByIdempotencyKey(
    attemptId: string,
    key: string,
  ): Promise<FollowupAnswerRecord | null>;
  commitFollowupAnswer(
    attempt: FollowupAttemptRecord,
    answer: FollowupAnswerRecord,
    expectedVersion: number,
  ): Promise<FollowupAnswerRecord>;
  advanceFollowupAttempt(
    attempt: FollowupAttemptRecord,
    expectedVersion: number,
    idempotencyKey?: string,
  ): Promise<boolean>;
  createAuthoringJob(input: AuthoringJobRecord): Promise<AuthoringJobRecord>;
  createAuthoringJobWithinLimit(
    input: AuthoringJobRecord,
    since: Date,
    monthlyLimit: number | null,
  ): Promise<AuthoringJobRecord | null>;
  countAuthoringJobsSince(workspaceId: string, since: Date): Promise<number>;
  getAuthoringJob(workspaceId: string, jobId: string): Promise<AuthoringJobRecord | null>;
  listAuthoringJobs(workspaceId: string, limit: number): Promise<AuthoringJobRecord[]>;
  claimAuthoringJob(now: Date, leaseUntil: Date): Promise<AuthoringJobRecord | null>;
  completeAuthoringJob(
    jobId: string,
    expectedAttempts: number,
    output: AuthoringDraft,
    completedAt: Date,
  ): Promise<boolean>;
  applyAuthoringJobDraft(
    workspaceId: string,
    jobId: string,
    quiz: QuizRecord,
  ): Promise<QuizRecord | null>;
  retryAuthoringJob(
    jobId: string,
    expectedAttempts: number,
    error: string,
    availableAt: Date,
    failed: boolean,
  ): Promise<boolean>;
  getPlan(workspaceId: string): Promise<Plan>;
  getBillingProfile(workspaceId: string): Promise<BillingProfile>;
  setPlan(
    workspaceId: string,
    plan: Plan,
    provider?: { customerId?: string; subscriptionId?: string; status?: string },
  ): Promise<void>;
  provisionCapacityTestWorkspace(
    workspaceId: string,
    requestId: string,
  ): Promise<CapacityTestWorkspaceProvisionResult>;
  recordBillingEvent(providerEventId: string, eventType: string): Promise<boolean>;
  applyBillingEvent(input: BillingEventInput): Promise<boolean>;
  recordAudit(input: AuditInput): Promise<void>;
  listAuditEvents(
    workspaceId: string,
    since: Date | null,
    limit: number,
  ): Promise<AuditEventRecord[]>;
  purgeAuditEvents(cutoff: Date): Promise<number>;
  recordProductEvents(events: ProductEventRecord[]): Promise<void>;
  purgeProductEvents(now: Date): Promise<number>;
  exportAccount(userId: string): Promise<Record<string, unknown>>;
  deleteAccount(userId: string): Promise<void>;
  expireLiveSessions(now: Date): Promise<string[]>;
  purgeExpired(now: Date): Promise<string[]>;
  purgeExpiredPracticeAssignments(now: Date): Promise<number>;
}
