import type { EngineAnswer } from "@openround/game-engine";
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
  QuestionHealthDismissalIdentity,
  QuestionHealthDismissalRecord,
  QuestionHealthDismissalWrite,
  QuestionHealthApplicationRecord,
  QnaQuestionRecord,
  QnaReplyRecord,
  QnaSettingsRecord,
  QuizRecord,
  QuizDraftHistoryRecord,
  QuizDraftUpdate,
  QuizVersionRecord,
  ReportJob,
  ReportHistoryRecord,
  Repository,
  SessionStaffCredentialRecord,
  SessionStaffCredentialInput,
  SessionDecisionEventWrite,
  SessionHistoryRecord,
  SessionInvalidationTarget,
  StoredSession,
  WorkspaceMediaDeletionJobRecord,
  WorkspaceInvitationRecord,
  WorkspaceMemberRecord,
  WorkspaceSummaryRecord,
} from "./types.js";
import { quizMediaIds } from "./media-references.js";
import {
  PresentationPublishedQuestionSourceUnavailableError,
  type PresentationSessionCommandInput,
} from "./presentation-session-types.js";
import {
  publishedQuestionCatalogOptions,
  publishedQuestionMetadata,
  publishedQuestionTextOnlyLiveEligible,
} from "./published-question-live-metadata.js";
import {
  createRecoveryPackRepository,
  type MemoryRecoveryPackRepository,
} from "./recovery-packs.js";
import {
  assertRecoveryPackPracticeInput,
  assertFollowupAdvanceReceipts,
  matchRecoveryPackPracticeReceipt,
  recoveryPackPracticeSourceMatches,
  recoveryPackPracticeCreationEvidence,
} from "./recovery-pack-practice.js";
import {
  ROUND_CONTENT_SCHEMA_VERSION,
  ROUND_DRAFT_SCHEMA_VERSION,
  assertRoundContentSchemaVersion,
  upcastRoundContent,
  upcastRoundDraft,
} from "./artifact-schemas.js";
import {
  MAX_SESSION_DECISION_EVENTS,
  QUESTION_HEALTH_POST_USE_MAX_REPORTS,
  ReportSchema,
  SessionDecisionEventSchema,
  questionDelivery,
  type BrandTheme,
  type QuizDraft,
  type Report,
} from "@openround/contracts";

interface UserRecord extends CreatorContext {
  deletedAt: Date | null;
}

interface ConsentRecord {
  workspaceId: string;
  userId: string;
  documentType: "terms" | "privacy";
  documentVersion: string;
  acceptedAt: Date;
}

interface QuizDraftMutationReceipt {
  workspaceId: string;
  quizId: string;
  expectedRevision: number;
  resultingRevision: number;
  draftHash: string;
  questionHealthUndoApplicationId?: string | null;
  recoveryPackUpdateSourceRevision?: number | null;
  createdAt: Date;
}

function quizAtDraftRevision(current: QuizRecord, snapshot: QuizDraftHistoryRecord): QuizRecord {
  const normalized = normalizeQuizHistory(snapshot);
  return normalizeQuizRecord({
    ...current,
    title: normalized.draft.title,
    description: normalized.draft.description,
    draft: structuredClone(normalized.draft),
    draftRevision: normalized.revision,
    draftSchemaVersion: normalized.draftSchemaVersion,
    lastEditedBy: normalized.savedBy,
    updatedAt: normalized.createdAt,
  });
}

interface MemoryWorkspace {
  id: string;
  name: string;
  segment: CreatorContext["segment"];
  homeRegion: string;
  embedAllowedOrigins: string[];
}

function normalizeQuizRecord(input: QuizRecord): QuizRecord {
  const draftSchemaVersion = input.draftSchemaVersion ?? ROUND_DRAFT_SCHEMA_VERSION;
  const draft = upcastRoundDraft(input.draft, draftSchemaVersion);
  return {
    ...input,
    title: draft.title,
    description: draft.description,
    draft,
    draftSchemaVersion,
  };
}

function normalizeQuizVersion(input: QuizVersionRecord): QuizVersionRecord {
  const contentSchemaVersion = input.contentSchemaVersion ?? ROUND_CONTENT_SCHEMA_VERSION;
  return {
    ...input,
    content: upcastRoundContent(input.content, contentSchemaVersion),
    contentSchemaVersion,
  };
}

function normalizeQuizHistory(
  input: QuizDraftHistoryRecord,
  fallbackSchemaVersion = ROUND_DRAFT_SCHEMA_VERSION,
): QuizDraftHistoryRecord {
  const draftSchemaVersion = input.draftSchemaVersion ?? fallbackSchemaVersion;
  return {
    ...input,
    draft: upcastRoundDraft(input.draft, draftSchemaVersion),
    draftSchemaVersion,
  };
}

function questionHealthDismissalKey(
  input: Pick<
    QuestionHealthDismissalRecord,
    "workspaceId" | "quizId" | "findingId" | "ruleVersion" | "rulesetVersion" | "contentHash"
  >,
) {
  return JSON.stringify([
    input.workspaceId,
    input.quizId,
    input.findingId,
    input.ruleVersion,
    input.rulesetVersion,
    input.contentHash,
  ]);
}

export interface MemoryRepositoryLifecycleContext {
  userId: string;
  ownedWorkspaceIds: ReadonlySet<string>;
}

export interface MemoryRepositoryLifecycleExtension {
  publishedSurveyCount?(workspaceId: string): number;
  deletePresentationSessionMetadata?(workspaceId: string, sessionId: string): void;
  exportAccount(
    context: MemoryRepositoryLifecycleContext,
  ): Promise<Record<string, unknown>> | Record<string, unknown>;
  deleteAccount(context: MemoryRepositoryLifecycleContext): Promise<void> | void;
  purgeExpired?(now: Date): Promise<string[]> | string[];
  hasLibraryArtifact?(
    workspaceId: string,
    artifactType: "round" | "presentation",
    artifactId: string,
  ): boolean;
  isLibraryArtifactReferenced?(
    workspaceId: string,
    artifactType: "round" | "presentation",
    artifactId: string,
  ): boolean;
  deleteLibraryArtifactMetadata?(
    workspaceId: string,
    artifactType: "round" | "presentation",
    artifactId: string,
  ): void;
}

export interface MemoryAccountExport extends Record<string, unknown> {
  workspaceMemberships?: WorkspaceSummaryRecord[];
  workspaces?: unknown[];
  quizzes?: QuizRecord[];
  quizDraftHistory?: QuizDraftHistoryRecord[];
  questionHealthDismissals?: QuestionHealthDismissalRecord[];
  questionHealthApplications?: QuestionHealthApplicationRecord[];
  mediaAssets?: MediaAssetRecord[];
  mediaReferences?: MediaReferenceRecord[];
  consentRecords?: ConsentRecord[];
  auditEvents?: AuditEventRecord[];
}

export class MemoryRepository implements Repository {
  private nextInitialWorkspaceId: string | undefined;
  private nextInitialPlan: Plan | undefined;
  readonly magicTokens = new Map<string, MagicTokenRecord>();
  readonly creatorSessions = new Map<
    string,
    { userId: string; activeWorkspaceId: string; expiresAt: Date; revoked: boolean }
  >();
  readonly users = new Map<string, UserRecord>();
  readonly workspaces = new Map<string, MemoryWorkspace>();
  readonly workspaceMembers = new Map<
    string,
    { workspaceId: string; userId: string; role: CreatorContext["role"]; joinedAt: Date }
  >();
  readonly workspaceInvitations = new Map<string, WorkspaceInvitationRecord>();
  readonly institutionPolicies = new Map<string, InstitutionPolicyRecord>();
  readonly externalIdentities = new Map<string, ExternalIdentityRecord>();
  readonly federatedAuthTransactions = new Map<string, FederatedAuthTransactionRecord>();
  readonly ltiRegistrations = new Map<string, LtiRegistrationRecord>();
  readonly ltiLoginTransactions = new Map<string, LtiLoginTransactionRecord>();
  readonly ltiLaunches = new Map<string, LtiLaunchRecord>();
  readonly quizzes = new Map<string, QuizRecord>();
  readonly quizDraftHistory = new Map<string, QuizDraftHistoryRecord>();
  readonly quizDraftMutations = new Map<string, QuizDraftMutationReceipt>();
  readonly questionHealthDismissals = new Map<string, QuestionHealthDismissalRecord>();
  readonly questionHealthApplications = new Map<string, QuestionHealthApplicationRecord>();
  readonly folders = new Map<string, FolderRecord>();
  readonly versions = new Map<string, QuizVersionRecord>();
  readonly sessions = new Map<string, StoredSession>();
  readonly sessionDecisionEvents = new Map<string, SessionDecisionEventWrite[]>();
  readonly liveRoomCodes = new Map<string, LiveRoomCodeRecord>();
  readonly participants = new Map<string, ParticipantRecord>();
  readonly sessionStaff = new Map<string, SessionStaffCredentialRecord>();
  readonly qnaSettings = new Map<string, QnaSettingsRecord>();
  readonly qnaQuestions = new Map<string, QnaQuestionRecord>();
  readonly qnaReplies = new Map<string, QnaReplyRecord>();
  readonly qnaVotes = new Set<string>();
  readonly qnaBans = new Set<string>();
  readonly interactionSettings = new Map<string, InteractionSettingsRecord>();
  readonly participantSignals = new Map<string, ParticipantSignalRecord>();
  readonly signalEvents: Array<{
    workspaceId: string;
    sessionId: string;
    participantId: string;
    contextKey: string;
    signal: ParticipantSignalRecord["signal"] | null;
    idempotencyKey: string;
    createdAt: Date;
  }> = [];
  readonly chatMessages = new Map<string, ChatMessageRecord>();
  readonly chatReactions = new Map<string, ChatReactionRecord>();
  readonly chatReports = new Set<string>();
  readonly audienceRestrictions = new Map<string, AudienceRestrictionRecord>();
  readonly audienceOutbox = new Map<string, AudienceOutboxRecord>();
  readonly mediaAssets = new Map<string, MediaAssetRecord>();
  readonly mediaFinalizationLeases = new Map<string, { token: string; startedAt: Date }>();
  readonly mediaObjectCleanup = new Map<
    string,
    {
      pass: 0 | 1 | 2;
      dueAt: Date | null;
      claimToken: string | null;
      claimedAt: Date | null;
    }
  >();
  readonly workspaceMediaDeletionClaims = new Set<string>();
  readonly workspaceMediaDeletionJobs = new Map<string, WorkspaceMediaDeletionJobRecord>();
  readonly mediaReferences = new Map<string, MediaReferenceRecord>();
  readonly answers = new Map<string, EngineAnswer>();
  readonly reports = new Map<string, Report>();
  readonly reportCreatedAt = new Map<string, Date>();
  readonly followups = new Map<string, FollowupRecord>();
  readonly followupAccess = new Map<string, FollowupAccessRecord>();
  readonly followupAttempts = new Map<string, FollowupAttemptRecord>();
  readonly followupAnswers = new Map<string, FollowupAnswerRecord>();
  readonly authoringJobs = new Map<string, AuthoringJobRecord>();
  readonly reportJobs = new Map<
    string,
    { workspaceId: string; attempts: number; availableAt: Date; lastError: string | null }
  >();
  readonly expiredLiveSessions = new Set<string>();
  readonly plans = new Map<string, Plan>();
  readonly brandThemes = new Map<string, BrandTheme>();
  readonly billingProfiles = new Map<
    string,
    { status: string; customerId: string | null; subscriptionId: string | null }
  >();
  readonly billingEvents = new Set<string>();
  readonly billingEventCreatedAt = new Map<string, Date>();
  readonly audits: AuditEventRecord[] = [];
  readonly productEvents: ProductEventRecord[] = [];
  readonly consents: ConsentRecord[] = [];
  private readonly lifecycleExtensions = new Map<
    string,
    { instance: unknown; lifecycle: MemoryRepositoryLifecycleExtension }
  >();

  deletePresentationSessionMetadata(workspaceId: string, sessionId: string) {
    for (const { lifecycle } of this.lifecycleExtensions.values()) {
      lifecycle.deletePresentationSessionMetadata?.(workspaceId, sessionId);
    }
  }
  private readonly deletedLibraryArtifacts = new Set<string>();
  private readonly deletedQuizVersions = new Set<string>();
  private readonly deletedMediaReferenceOwners = new Set<string>();
  readonly operationalFeatures: OperationalFeaturesRecord = {
    signups: true,
    sessionCreation: true,
    mediaUploads: true,
    roundExperiences: true,
    audiencePulse: true,
    roomChat: true,
    updatedAt: null,
  };

  constructor(options: { initialWorkspaceId?: string; initialPlan?: Plan } = {}) {
    this.nextInitialWorkspaceId = options.initialWorkspaceId;
    this.nextInitialPlan = options.initialPlan;
  }

  private readonly publicationLocks = new Map<string, Promise<unknown>>();
  async withPublicationLock<T>(workspaceId: string, work: () => Promise<T>): Promise<T> {
    const previous = this.publicationLocks.get(workspaceId) ?? Promise.resolve();
    const task = previous.catch(() => undefined).then(work);
    this.publicationLocks.set(workspaceId, task);
    try {
      return await task;
    } finally {
      if (this.publicationLocks.get(workspaceId) === task)
        this.publicationLocks.delete(workspaceId);
    }
  }
  private publishedSurveyCount(workspaceId: string) {
    return [...this.lifecycleExtensions.values()].reduce(
      (count, { lifecycle }) => count + (lifecycle.publishedSurveyCount?.(workspaceId) ?? 0),
      0,
    );
  }

  getOrCreateLifecycleExtension<T extends MemoryRepositoryLifecycleExtension>(
    name: string,
    create: () => T,
  ): T {
    const existing = this.lifecycleExtensions.get(name);
    if (existing) return existing.instance as T;
    const instance = create();
    this.lifecycleExtensions.set(name, { instance, lifecycle: instance });
    return instance;
  }

  hasLibraryArtifact(
    workspaceId: string,
    artifactType: "round" | "presentation",
    artifactId: string,
  ) {
    if (artifactType === "round") return this.quizzes.get(artifactId)?.workspaceId === workspaceId;
    return [...this.lifecycleExtensions.values()].some(({ lifecycle }) =>
      lifecycle.hasLibraryArtifact?.(workspaceId, artifactType, artifactId),
    );
  }

  isLibraryArtifactReferenced(
    workspaceId: string,
    artifactType: "round" | "presentation",
    artifactId: string,
  ) {
    return [...this.lifecycleExtensions.values()].some(({ lifecycle }) =>
      lifecycle.isLibraryArtifactReferenced?.(workspaceId, artifactType, artifactId),
    );
  }

  isLibraryArtifactDeleted(
    workspaceId: string,
    artifactType: "round" | "presentation",
    artifactId: string,
  ) {
    return this.deletedLibraryArtifacts.has(`${workspaceId}:${artifactType}:${artifactId}`);
  }

  assertPresentationPublishedQuestionSource(
    workspaceId: string,
    source: NonNullable<PresentationSessionCommandInput["publishedQuestionSource"]>,
  ) {
    const quiz = this.quizzes.get(source.quizId);
    const version = this.versions.get(source.versionId);
    if (
      !quiz ||
      quiz.workspaceId !== workspaceId ||
      quiz.status === "archived" ||
      !version ||
      version.workspaceId !== workspaceId ||
      version.quizId !== quiz.id ||
      version.contentHash !== source.contentHash
    )
      throw new PresentationPublishedQuestionSourceUnavailableError();
  }

  markLibraryArtifactDeleted(
    workspaceId: string,
    artifactType: "round" | "presentation",
    artifactId: string,
  ) {
    this.deletedLibraryArtifacts.add(`${workspaceId}:${artifactType}:${artifactId}`);
  }

  deleteLibraryArtifactMetadata(
    workspaceId: string,
    artifactType: "round" | "presentation",
    artifactId: string,
  ) {
    for (const { lifecycle } of this.lifecycleExtensions.values()) {
      lifecycle.deleteLibraryArtifactMetadata?.(workspaceId, artifactType, artifactId);
    }
  }

  async initialize() {}
  async close() {}

  async getOperationalFeatures() {
    return structuredClone(this.operationalFeatures);
  }

  async updateOperationalFeatures(input: OperationalFeaturesUpdate, requestId: string) {
    const before = structuredClone(this.operationalFeatures);
    Object.assign(this.operationalFeatures, input, { updatedAt: new Date() });
    this.audits.push({
      id: crypto.randomUUID(),
      workspaceId: null,
      actorId: null,
      action: "operations.features.update",
      targetType: "operational_features",
      targetId: "global",
      requestId,
      metadata: { before, after: structuredClone(this.operationalFeatures) },
      createdAt: new Date(),
    });
    return structuredClone(this.operationalFeatures);
  }

  async createMagicToken(input: MagicTokenRecord) {
    this.magicTokens.set(input.tokenHash, structuredClone(input));
  }

  async consumeMagicToken(tokenHash: string, now: Date) {
    const token = this.magicTokens.get(tokenHash);
    if (!token || token.consumedAt || token.expiresAt <= now) return null;
    token.consumedAt = now;
    let user = [...this.users.values()].find((candidate) => candidate.email === token.email);
    if (!user) {
      const userId = crypto.randomUUID();
      const usesInitialWorkspace = Boolean(
        this.nextInitialWorkspaceId && !this.workspaces.has(this.nextInitialWorkspaceId),
      );
      const workspaceId = usesInitialWorkspace ? this.nextInitialWorkspaceId! : crypto.randomUUID();
      const plan = usesInitialWorkspace ? (this.nextInitialPlan ?? "free") : "free";
      this.nextInitialWorkspaceId = undefined;
      this.nextInitialPlan = undefined;
      user = {
        userId,
        workspaceId,
        email: token.email,
        locale: "en-CA",
        localePreferenceSet: false,
        segment: token.segment,
        role: "owner",
        plan,
        deletedAt: null,
      };
      this.users.set(userId, user);
      this.plans.set(user.workspaceId, plan);
      this.workspaces.set(user.workspaceId, {
        id: user.workspaceId,
        name: `${token.email.split("@")[0]}'s workspace`,
        segment: token.segment,
        homeRegion: "ca-central-1",
        embedAllowedOrigins: [],
      });
      this.workspaceMembers.set(`${user.workspaceId}:${userId}`, {
        workspaceId: user.workspaceId,
        userId,
        role: "owner",
        joinedAt: now,
      });
    }
    for (const documentType of ["terms", "privacy"] as const) {
      if (
        !this.consents.some(
          (record) =>
            record.workspaceId === user!.workspaceId &&
            record.userId === user!.userId &&
            record.documentType === documentType &&
            record.documentVersion === token.policyVersion,
        )
      ) {
        this.consents.push({
          workspaceId: user.workspaceId,
          userId: user.userId,
          documentType,
          documentVersion: token.policyVersion,
          acceptedAt: now,
        });
      }
    }
    return this.contextFor(user);
  }

  async createCreatorSession(input: {
    id: string;
    userId: string;
    tokenHash: string;
    expiresAt: Date;
    activeWorkspaceId?: string;
  }) {
    const user = this.users.get(input.userId);
    if (!user) throw new Error("Creator not found");
    this.creatorSessions.set(input.tokenHash, {
      userId: input.userId,
      activeWorkspaceId: input.activeWorkspaceId ?? user.workspaceId,
      expiresAt: input.expiresAt,
      revoked: false,
    });
  }

  async getCreatorBySession(tokenHash: string, now: Date) {
    const session = this.creatorSessions.get(tokenHash);
    if (!session || session.revoked || session.expiresAt <= now) return null;
    const user = this.users.get(session.userId);
    return user && !user.deletedAt ? this.contextFor(user, session.activeWorkspaceId) : null;
  }

  async updateUserLocale(userId: string, locale: CreatorContext["locale"]) {
    const user = this.users.get(userId);
    if (!user || user.deletedAt) return null;
    user.locale = locale;
    user.localePreferenceSet = true;
    return user.locale;
  }

  async listWorkspaces(userId: string): Promise<WorkspaceSummaryRecord[]> {
    const user = this.users.get(userId);
    if (!user || user.deletedAt) return [];
    const memberships = [...this.workspaceMembers.values()].filter(
      (membership) => membership.userId === userId,
    );
    if (!memberships.some((membership) => membership.workspaceId === user.workspaceId)) {
      memberships.push({
        workspaceId: user.workspaceId,
        userId,
        role: user.role,
        joinedAt: new Date(),
      });
    }
    return memberships
      .map((membership) => {
        const workspace = this.workspaces.get(membership.workspaceId);
        if (!workspace) return null;
        return {
          id: workspace.id,
          name: workspace.name,
          segment: workspace.segment,
          role: workspace.id === user.workspaceId ? user.role : membership.role,
          homeRegion: workspace.homeRegion,
        } satisfies WorkspaceSummaryRecord;
      })
      .filter((workspace): workspace is WorkspaceSummaryRecord => workspace !== null)
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  async setCreatorSessionWorkspace(tokenHash: string, userId: string, workspaceId: string) {
    const session = this.creatorSessions.get(tokenHash);
    const user = this.users.get(userId);
    if (!session || session.userId !== userId || !user) return false;
    const member =
      user.workspaceId === workspaceId || this.workspaceMembers.has(`${workspaceId}:${userId}`);
    if (!member) return false;
    session.activeWorkspaceId = workspaceId;
    return true;
  }

  async listWorkspaceMembers(workspaceId: string): Promise<WorkspaceMemberRecord[]> {
    return [...this.workspaceMembers.values()]
      .filter((membership) => membership.workspaceId === workspaceId)
      .flatMap((membership): WorkspaceMemberRecord[] => {
        const user = this.users.get(membership.userId);
        return user && !user.deletedAt
          ? [
              {
                userId: user.userId,
                email: user.email,
                role: user.workspaceId === workspaceId ? user.role : membership.role,
                joinedAt: membership.joinedAt,
              },
            ]
          : [];
      })
      .sort((left, right) => left.email.localeCompare(right.email));
  }

  async updateWorkspaceMemberRole(workspaceId: string, userId: string, role: "editor" | "viewer") {
    const membership = this.workspaceMembers.get(`${workspaceId}:${userId}`);
    const user = this.users.get(userId);
    if (!membership || membership.role === "owner" || !user) return null;
    membership.role = role;
    if (user.workspaceId === workspaceId) user.role = role;
    return { userId, email: user.email, role, joinedAt: membership.joinedAt };
  }

  async removeWorkspaceMember(workspaceId: string, userId: string) {
    const key = `${workspaceId}:${userId}`;
    const membership = this.workspaceMembers.get(key);
    if (!membership || membership.role === "owner") return false;
    this.workspaceMembers.delete(key);
    for (const session of this.creatorSessions.values()) {
      if (session.userId === userId && session.activeWorkspaceId === workspaceId) {
        const fallback = [...this.workspaceMembers.values()].find(
          (candidate) => candidate.userId === userId,
        );
        if (fallback) session.activeWorkspaceId = fallback.workspaceId;
        else session.revoked = true;
      }
    }
    return true;
  }

  async createWorkspaceInvitation(input: WorkspaceInvitationRecord) {
    const duplicate = [...this.workspaceInvitations.values()].find(
      (invitation) =>
        invitation.workspaceId === input.workspaceId &&
        invitation.email === input.email &&
        !invitation.acceptedAt &&
        !invitation.revokedAt,
    );
    if (duplicate) throw Object.assign(new Error("Invitation already exists"), { code: "23505" });
    this.workspaceInvitations.set(input.id, structuredClone(input));
    return structuredClone(input);
  }

  async listWorkspaceInvitations(workspaceId: string) {
    return [...this.workspaceInvitations.values()]
      .filter((invitation) => invitation.workspaceId === workspaceId)
      .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
      .map((invitation) => structuredClone(invitation));
  }

  async revokeWorkspaceInvitation(workspaceId: string, invitationId: string) {
    const invitation = this.workspaceInvitations.get(invitationId);
    if (
      !invitation ||
      invitation.workspaceId !== workspaceId ||
      invitation.acceptedAt ||
      invitation.revokedAt
    )
      return false;
    invitation.revokedAt = new Date();
    return true;
  }

  async acceptWorkspaceInvitation(tokenHash: string, now: Date, policyVersion: string) {
    const invitation = [...this.workspaceInvitations.values()].find(
      (candidate) =>
        candidate.tokenHash === tokenHash &&
        !candidate.acceptedAt &&
        !candidate.revokedAt &&
        candidate.expiresAt > now,
    );
    if (!invitation) return null;
    let user = [...this.users.values()].find(
      (candidate) => candidate.email === invitation.email && !candidate.deletedAt,
    );
    if (!user) {
      const workspace = this.workspaces.get(invitation.workspaceId);
      if (!workspace) return null;
      user = {
        userId: crypto.randomUUID(),
        workspaceId: invitation.workspaceId,
        email: invitation.email,
        locale: "en-CA",
        localePreferenceSet: false,
        segment: workspace.segment,
        role: invitation.role,
        plan: this.plans.get(invitation.workspaceId) ?? "free",
        deletedAt: null,
      };
      this.users.set(user.userId, user);
    }
    const key = `${invitation.workspaceId}:${user.userId}`;
    const existing = this.workspaceMembers.get(key);
    if (!existing) {
      this.workspaceMembers.set(key, {
        workspaceId: invitation.workspaceId,
        userId: user.userId,
        role: invitation.role,
        joinedAt: now,
      });
    }
    invitation.acceptedAt = now;
    for (const documentType of ["terms", "privacy"] as const) {
      if (
        !this.consents.some(
          (record) =>
            record.workspaceId === invitation.workspaceId &&
            record.userId === user!.userId &&
            record.documentType === documentType &&
            record.documentVersion === policyVersion,
        )
      ) {
        this.consents.push({
          workspaceId: invitation.workspaceId,
          userId: user.userId,
          documentType,
          documentVersion: policyVersion,
          acceptedAt: now,
        });
      }
    }
    return this.contextFor(user, invitation.workspaceId);
  }

  async revokeCreatorSession(tokenHash: string) {
    const session = this.creatorSessions.get(tokenHash);
    if (session) session.revoked = true;
  }

  async getCreatorByUserId(userId: string, workspaceId: string) {
    const user = this.users.get(userId);
    return user && !user.deletedAt ? this.contextFor(user, workspaceId) : null;
  }

  private contextFor(user: UserRecord, workspaceId = user.workspaceId): CreatorContext | null {
    const workspace = this.workspaces.get(workspaceId);
    const membership = this.workspaceMembers.get(`${workspaceId}:${user.userId}`);
    if (!workspace || !membership) return null;
    return {
      userId: user.userId,
      workspaceId,
      email: user.email,
      locale: user.locale,
      localePreferenceSet: user.localePreferenceSet,
      segment: workspace.segment,
      role: workspaceId === user.workspaceId ? user.role : membership.role,
      plan: this.plans.get(workspaceId) ?? "free",
    };
  }

  async listQuizzes(workspaceId: string, includeArchived = false) {
    const quizIdByVersionId = new Map(
      [...this.versions.values()]
        .filter((version) => version.workspaceId === workspaceId)
        .map((version) => [version.id, version.quizId]),
    );
    const lastHostedAtByQuizId = new Map<string, Date>();
    for (const session of this.sessions.values()) {
      if (session.workspaceId !== workspaceId) continue;
      const quizId = quizIdByVersionId.get(session.quizVersionId);
      if (!quizId) continue;
      const current = lastHostedAtByQuizId.get(quizId);
      if (!current || session.createdAt > current) {
        lastHostedAtByQuizId.set(quizId, session.createdAt);
      }
    }
    return [...this.quizzes.values()]
      .filter(
        (quiz) =>
          quiz.workspaceId === workspaceId && (includeArchived || quiz.status !== "archived"),
      )
      .sort(
        (left, right) =>
          right.updatedAt.getTime() - left.updatedAt.getTime() ||
          (left.id === right.id ? 0 : left.id < right.id ? 1 : -1),
      )
      .map((quiz) => ({
        ...structuredClone(normalizeQuizRecord(quiz)),
        lastHostedAt: structuredClone(lastHostedAtByQuizId.get(quiz.id) ?? null),
      }));
  }

  async listPublishedQuizQuestionMetadata(workspaceId: string, search = "", limit = 100) {
    const options = publishedQuestionCatalogOptions(search, limit);
    const needle = options.search.toLowerCase();
    const quizzes = [...this.quizzes.values()]
      .filter((quiz) => quiz.workspaceId === workspaceId && quiz.status !== "archived")
      .sort(
        (left, right) =>
          right.updatedAt.getTime() - left.updatedAt.getTime() ||
          (left.id === right.id ? 0 : left.id < right.id ? 1 : -1),
      );
    const questions: Awaited<
      ReturnType<Repository["listPublishedQuizQuestionMetadata"]>
    >["questions"] = [];
    const versions = quizzes.flatMap((quiz) => {
      const version = quiz.currentVersionId ? this.versions.get(quiz.currentVersionId) : undefined;
      return version && version.workspaceId === workspaceId && version.quizId === quiz.id
        ? [version]
        : [];
    });
    for (const version of versions) {
      assertRoundContentSchemaVersion(version.contentSchemaVersion);
    }
    for (const version of versions) {
      const normalized = normalizeQuizVersion(version);
      for (const question of normalized.content.questions) {
        if (
          !publishedQuestionTextOnlyLiveEligible(question, normalized.content.questions) ||
          (needle &&
            !normalized.content.title.toLowerCase().includes(needle) &&
            !question.prompt.toLowerCase().includes(needle))
        )
          continue;
        questions.push(publishedQuestionMetadata(normalized, question));
        if (questions.length > options.limit) {
          return { questions: questions.slice(0, options.limit), hasMore: true };
        }
      }
    }
    return { questions, hasMore: false };
  }

  async listFolders(workspaceId: string) {
    return [...this.folders.values()]
      .filter((folder) => folder.workspaceId === workspaceId)
      .sort((left, right) => left.name.localeCompare(right.name))
      .map((folder) => structuredClone(folder));
  }

  async createFolder(input: FolderRecord) {
    const duplicate = [...this.folders.values()].some(
      (folder) =>
        folder.workspaceId === input.workspaceId &&
        folder.name.toLocaleLowerCase() === input.name.toLocaleLowerCase(),
    );
    if (duplicate) {
      const error = new Error("A folder with this name already exists") as Error & {
        code?: string;
      };
      error.code = "23505";
      throw error;
    }
    this.folders.set(input.id, structuredClone(input));
    return structuredClone(input);
  }

  async renameFolder(workspaceId: string, folderId: string, name: string) {
    const folder = this.folders.get(folderId);
    if (!folder || folder.workspaceId !== workspaceId) return null;
    const duplicate = [...this.folders.values()].some(
      (candidate) =>
        candidate.id !== folderId &&
        candidate.workspaceId === workspaceId &&
        candidate.name.toLocaleLowerCase() === name.toLocaleLowerCase(),
    );
    if (duplicate) {
      const error = new Error("A folder with this name already exists") as Error & {
        code?: string;
      };
      error.code = "23505";
      throw error;
    }
    folder.name = name;
    folder.updatedAt = new Date();
    return structuredClone(folder);
  }

  async deleteFolder(workspaceId: string, folderId: string) {
    const folder = this.folders.get(folderId);
    if (!folder || folder.workspaceId !== workspaceId) return false;
    this.folders.delete(folderId);
    for (const quiz of this.quizzes.values()) {
      if (quiz.workspaceId === workspaceId && quiz.folderId === folderId) {
        quiz.folderId = null;
        quiz.updatedAt = new Date();
      }
    }
    return true;
  }

  async organizeQuiz(workspaceId: string, quizId: string, folderId: string | null, tags: string[]) {
    const quiz = this.quizzes.get(quizId);
    if (!quiz || quiz.workspaceId !== workspaceId) return null;
    if (folderId && this.folders.get(folderId)?.workspaceId !== workspaceId) return null;
    quiz.folderId = folderId;
    quiz.tags = [...tags];
    quiz.updatedAt = new Date();
    return structuredClone(normalizeQuizRecord(quiz));
  }

  async createQuiz(input: QuizRecord) {
    const parsed = normalizeQuizRecord(input);
    const normalized = {
      ...parsed,
      folderId: parsed.folderId ?? null,
      tags: parsed.tags ?? [],
      draftRevision: parsed.draftRevision ?? 0,
      publishedDraftRevision: parsed.publishedDraftRevision ?? null,
      lastEditedBy: parsed.lastEditedBy ?? null,
    };
    this.validateMediaReferences(normalized.workspaceId, quizMediaIds(normalized.draft));
    this.quizzes.set(input.id, structuredClone(normalized));
    const historyId = crypto.randomUUID();
    this.quizDraftHistory.set(`${input.id}:${normalized.draftRevision}`, {
      id: historyId,
      workspaceId: normalized.workspaceId,
      quizId: normalized.id,
      revision: normalized.draftRevision,
      draft: structuredClone(normalized.draft),
      draftSchemaVersion: normalized.draftSchemaVersion,
      savedBy: normalized.lastEditedBy,
      mutationId: null,
      createdAt: normalized.createdAt,
    });
    await this.replaceMediaReferences(
      normalized.workspaceId,
      "quiz_draft",
      normalized.id,
      quizMediaIds(normalized.draft),
      normalized.createdAt,
    );
    await this.replaceMediaReferences(
      normalized.workspaceId,
      "quiz_history",
      historyId,
      quizMediaIds(normalized.draft),
      normalized.createdAt,
    );
    return structuredClone(normalized);
  }

  async getQuiz(workspaceId: string, quizId: string) {
    const quiz = this.quizzes.get(quizId);
    return quiz?.workspaceId === workspaceId ? structuredClone(normalizeQuizRecord(quiz)) : null;
  }

  async updateQuiz(
    workspaceId: string,
    quizId: string,
    draft: QuizDraft,
    expectedDraftRevision?: number,
    editorId?: string,
  ) {
    const quiz = this.quizzes.get(quizId);
    if (!quiz || quiz.workspaceId !== workspaceId || quiz.status === "archived") return null;
    const normalizedDraft = upcastRoundDraft(draft, ROUND_DRAFT_SCHEMA_VERSION);
    const currentDraftRevision = quiz.draftRevision ?? 0;
    if (expectedDraftRevision !== undefined && expectedDraftRevision !== currentDraftRevision) {
      throw new QuizDraftRevisionConflictError(
        quizId,
        expectedDraftRevision,
        currentDraftRevision,
        quiz.lastEditedBy ?? null,
      );
    }
    this.validateMediaReferences(workspaceId, quizMediaIds(normalizedDraft));
    Object.assign(quiz, {
      title: normalizedDraft.title,
      description: normalizedDraft.description,
      draft: structuredClone(normalizedDraft),
      draftRevision: currentDraftRevision + 1,
      draftSchemaVersion: ROUND_DRAFT_SCHEMA_VERSION,
      lastEditedBy: editorId ?? quiz.lastEditedBy ?? null,
      updatedAt: new Date(),
    });
    const historyId = crypto.randomUUID();
    this.quizDraftHistory.set(`${quizId}:${quiz.draftRevision}`, {
      id: historyId,
      workspaceId,
      quizId,
      revision: quiz.draftRevision ?? currentDraftRevision + 1,
      draft: structuredClone(normalizedDraft),
      draftSchemaVersion: ROUND_DRAFT_SCHEMA_VERSION,
      savedBy: editorId ?? quiz.lastEditedBy ?? null,
      mutationId: null,
      createdAt: quiz.updatedAt,
    });
    await this.replaceMediaReferences(
      workspaceId,
      "quiz_draft",
      quizId,
      quizMediaIds(normalizedDraft),
      quiz.updatedAt,
    );
    await this.replaceMediaReferences(
      workspaceId,
      "quiz_history",
      historyId,
      quizMediaIds(normalizedDraft),
      quiz.updatedAt,
    );
    await this.pruneQuizDraftHistory(quizId, quiz.updatedAt);
    return structuredClone(normalizeQuizRecord(quiz));
  }

  async updateQuizDraft(input: QuizDraftUpdate) {
    const draft = upcastRoundDraft(input.draft, input.schemaVersion);
    const quiz = this.quizzes.get(input.quizId);
    if (!quiz || quiz.workspaceId !== input.workspaceId) return null;
    if (
      input.recoveryPackUpdateSourceRevision !== undefined &&
      (!Number.isSafeInteger(input.recoveryPackUpdateSourceRevision) ||
        input.recoveryPackUpdateSourceRevision < 0 ||
        input.recoveryPackUpdateSourceRevision !== input.expectedRevision)
    ) {
      throw new QuizDraftMutationConflictError(input.mutationId);
    }
    const mutationKey = `${input.workspaceId}:${input.mutationId}`;
    const retry = this.quizDraftMutations.get(mutationKey);
    if (retry) {
      if (
        retry.quizId !== input.quizId ||
        retry.expectedRevision !== input.expectedRevision ||
        retry.draftHash !== input.draftHash ||
        (retry.questionHealthUndoApplicationId ?? null) !==
          (input.questionHealthUndo?.applicationId ?? null) ||
        (retry.recoveryPackUpdateSourceRevision ?? null) !==
          (input.recoveryPackUpdateSourceRevision ?? null)
      ) {
        throw new QuizDraftMutationConflictError(input.mutationId);
      }
      if (
        input.questionHealthApplication &&
        this.questionHealthApplications.get(mutationKey)?.requestHash !==
          input.questionHealthApplication.requestHash
      ) {
        throw new QuizDraftMutationConflictError(input.mutationId);
      }
      return this.replayQuizDraftMutation(quiz, retry);
    }
    if (quiz.status === "archived") return null;
    const currentRevision = quiz.draftRevision ?? 0;
    if (input.expectedRevision !== currentRevision) {
      throw new QuizDraftRevisionConflictError(
        input.quizId,
        input.expectedRevision,
        currentRevision,
        quiz.lastEditedBy ?? null,
      );
    }

    const meaningful = JSON.stringify(normalizeQuizRecord(quiz).draft) !== JSON.stringify(draft);
    if (
      (input.questionHealthApplication || input.recoveryPackUpdateSourceRevision !== undefined) &&
      !meaningful
    ) {
      throw new QuizDraftMutationConflictError(input.mutationId);
    }
    const updatedAt = new Date();
    const resultingRevision = meaningful ? currentRevision + 1 : currentRevision;
    if (meaningful) {
      this.validateMediaReferences(input.workspaceId, quizMediaIds(draft));
    }
    this.quizDraftMutations.set(mutationKey, {
      workspaceId: input.workspaceId,
      quizId: input.quizId,
      expectedRevision: input.expectedRevision,
      resultingRevision,
      draftHash: input.draftHash,
      questionHealthUndoApplicationId: input.questionHealthUndo?.applicationId ?? null,
      recoveryPackUpdateSourceRevision: input.recoveryPackUpdateSourceRevision ?? null,
      createdAt: updatedAt,
    });
    if (!meaningful) return structuredClone(normalizeQuizRecord(quiz));

    Object.assign(quiz, {
      title: draft.title,
      description: draft.description,
      draft: structuredClone(draft),
      draftRevision: resultingRevision,
      draftSchemaVersion: input.schemaVersion,
      lastEditedBy: input.editorId,
      updatedAt,
    });
    const historyId = crypto.randomUUID();
    this.quizDraftHistory.set(`${input.quizId}:${resultingRevision}`, {
      id: historyId,
      workspaceId: input.workspaceId,
      quizId: input.quizId,
      revision: resultingRevision,
      draft: structuredClone(draft),
      draftSchemaVersion: input.schemaVersion,
      savedBy: input.editorId,
      mutationId: input.mutationId,
      createdAt: updatedAt,
    });
    if (input.questionHealthApplication) {
      const { requestId, ...application } = input.questionHealthApplication;
      this.questionHealthApplications.set(mutationKey, {
        ...structuredClone(application),
        appliedRevision: resultingRevision,
        createdAt: updatedAt,
      });
      await this.recordAudit({
        workspaceId: input.workspaceId,
        actorId: input.editorId,
        action: "question_health.application.apply",
        targetType: "question_health_application",
        targetId: input.mutationId,
        requestId,
        metadata: {
          quizId: input.quizId,
          findingId: application.findingId,
          sourceRevision: application.sourceRevision,
          appliedRevision: resultingRevision,
        },
      });
    }
    if (input.questionHealthUndo) {
      await this.recordAudit({
        workspaceId: input.workspaceId,
        actorId: input.editorId,
        action: "question_health.application.undo",
        targetType: "question_health_application",
        targetId: input.questionHealthUndo.applicationId,
        requestId: input.questionHealthUndo.requestId,
        metadata: {
          quizId: input.quizId,
          sourceRevision: input.expectedRevision - 1,
          resultingRevision,
        },
      });
    }
    await this.replaceMediaReferences(
      input.workspaceId,
      "quiz_draft",
      input.quizId,
      quizMediaIds(draft),
      updatedAt,
    );
    await this.replaceMediaReferences(
      input.workspaceId,
      "quiz_history",
      historyId,
      quizMediaIds(draft),
      updatedAt,
    );
    await this.pruneQuizDraftHistory(input.quizId, updatedAt);
    return structuredClone(normalizeQuizRecord(quiz));
  }

  async listQuestionHealthDismissals(workspaceId: string, quizId: string) {
    return [...this.questionHealthDismissals.values()]
      .filter((dismissal) => dismissal.workspaceId === workspaceId && dismissal.quizId === quizId)
      .map((dismissal) => structuredClone(dismissal));
  }

  async getQuestionHealthApplication(workspaceId: string, quizId: string, applicationId: string) {
    const record = this.questionHealthApplications.get(`${workspaceId}:${applicationId}`);
    return record?.quizId === quizId ? structuredClone(record) : null;
  }

  async putQuestionHealthDismissal(input: QuestionHealthDismissalWrite) {
    const quiz = this.quizzes.get(input.quizId);
    if (!quiz || quiz.workspaceId !== input.workspaceId) return { status: "not_found" as const };
    if ((quiz.draftRevision ?? 0) !== input.expectedDraftRevision) {
      return { status: "revision_conflict" as const };
    }

    // A changed content hash invalidates a prior dismissal for this same finding.
    for (const [key, dismissal] of this.questionHealthDismissals) {
      if (
        dismissal.workspaceId === input.workspaceId &&
        dismissal.quizId === input.quizId &&
        dismissal.findingId === input.findingId
      ) {
        this.questionHealthDismissals.delete(key);
      }
    }
    const dismissal: QuestionHealthDismissalRecord = {
      workspaceId: input.workspaceId,
      quizId: input.quizId,
      findingId: input.findingId,
      ruleVersion: input.ruleVersion,
      rulesetVersion: input.rulesetVersion,
      contentHash: input.contentHash,
      reason: input.reason,
      createdAt: new Date(),
    };
    this.questionHealthDismissals.set(questionHealthDismissalKey(dismissal), dismissal);
    await this.recordAudit({
      workspaceId: input.workspaceId,
      actorId: input.actorId,
      action: "question_health.dismissal.create",
      targetType: "question_health_dismissal",
      targetId: input.findingId,
      requestId: input.requestId,
      metadata: {
        quizId: input.quizId,
        findingId: input.findingId,
        ruleVersion: input.ruleVersion,
        rulesetVersion: input.rulesetVersion,
        contentHash: input.contentHash,
        reason: input.reason,
      },
    });
    return { status: "ok" as const, dismissal: structuredClone(dismissal) };
  }

  async deleteQuestionHealthDismissal(input: QuestionHealthDismissalIdentity) {
    const quiz = this.quizzes.get(input.quizId);
    if (!quiz || quiz.workspaceId !== input.workspaceId) return { status: "not_found" as const };
    if ((quiz.draftRevision ?? 0) !== input.expectedDraftRevision) {
      return { status: "revision_conflict" as const };
    }
    const removed = this.questionHealthDismissals.delete(questionHealthDismissalKey(input));
    if (removed) {
      await this.recordAudit({
        workspaceId: input.workspaceId,
        actorId: input.actorId,
        action: "question_health.dismissal.delete",
        targetType: "question_health_dismissal",
        targetId: input.findingId,
        requestId: input.requestId,
        metadata: {
          quizId: input.quizId,
          findingId: input.findingId,
          ruleVersion: input.ruleVersion,
          rulesetVersion: input.rulesetVersion,
          contentHash: input.contentHash,
        },
      });
    }
    return { status: "ok" as const, removed };
  }

  private replayQuizDraftMutation(
    current: QuizRecord,
    receipt: QuizDraftMutationReceipt,
  ): QuizRecord {
    const currentRevision = current.draftRevision ?? 0;
    if (currentRevision === receipt.resultingRevision) {
      return structuredClone(normalizeQuizRecord(current));
    }
    const snapshot = this.quizDraftHistory.get(`${receipt.quizId}:${receipt.resultingRevision}`);
    if (snapshot && snapshot.workspaceId === receipt.workspaceId) {
      return structuredClone(quizAtDraftRevision(current, snapshot));
    }
    throw new QuizDraftRevisionConflictError(
      receipt.quizId,
      receipt.resultingRevision,
      currentRevision,
      current.lastEditedBy ?? null,
    );
  }

  private async pruneQuizDraftHistory(quizId: string, now: Date) {
    const currentRevision = this.quizzes.get(quizId)?.draftRevision ?? 0;
    const protectedSourceRevisions = new Set(
      [...this.questionHealthApplications.values()]
        .filter(
          (application) =>
            application.quizId === quizId && application.appliedRevision === currentRevision,
        )
        .map((application) => application.sourceRevision),
    );
    for (const receipt of this.quizDraftMutations.values()) {
      if (
        receipt.quizId === quizId &&
        receipt.resultingRevision === currentRevision &&
        receipt.recoveryPackUpdateSourceRevision != null
      ) {
        protectedSourceRevisions.add(receipt.recoveryPackUpdateSourceRevision);
      }
    }
    const snapshots = [...this.quizDraftHistory.entries()]
      .filter(([, snapshot]) => snapshot.quizId === quizId)
      .sort((left, right) => right[1].revision - left[1].revision);
    const cutoff = now.getTime() - 30 * 24 * 60 * 60 * 1_000;
    for (const [index, [key, snapshot]] of snapshots.entries()) {
      if (protectedSourceRevisions.has(snapshot.revision)) continue;
      if (index >= 20 || snapshot.createdAt.getTime() < cutoff) {
        this.quizDraftHistory.delete(key);
        await this.replaceMediaReferences(
          snapshot.workspaceId,
          "quiz_history",
          snapshot.id,
          [],
          now,
        );
      }
    }
    for (const [key, receipt] of this.quizDraftMutations) {
      if (receipt.quizId === quizId && receipt.createdAt.getTime() < cutoff) {
        this.quizDraftMutations.delete(key);
      }
    }
  }

  async listQuizDraftHistory(workspaceId: string, quizId: string, limit = 20) {
    return [...this.quizDraftHistory.values()]
      .filter((snapshot) => snapshot.workspaceId === workspaceId && snapshot.quizId === quizId)
      .sort((left, right) => right.revision - left.revision)
      .slice(0, limit)
      .map((snapshot) => structuredClone(normalizeQuizHistory(snapshot)));
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
    const quiz = this.quizzes.get(input.quizId);
    if (!quiz || quiz.workspaceId !== input.workspaceId) return null;
    const retry = this.quizDraftMutations.get(`${input.workspaceId}:${input.mutationId}`);
    if (retry) {
      if (
        retry.quizId !== input.quizId ||
        retry.expectedRevision !== input.expectedRevision ||
        retry.draftHash !== `restore:${input.historyRevision}` ||
        (retry.questionHealthUndoApplicationId ?? null) !==
          (input.questionHealthUndo?.applicationId ?? null) ||
        retry.recoveryPackUpdateSourceRevision != null
      ) {
        throw new QuizDraftMutationConflictError(input.mutationId);
      }
      return this.replayQuizDraftMutation(quiz, retry);
    }
    const snapshot = this.quizDraftHistory.get(`${input.quizId}:${input.historyRevision}`);
    if (!snapshot || snapshot.workspaceId !== input.workspaceId) return null;
    return this.updateQuizDraft({
      workspaceId: input.workspaceId,
      quizId: input.quizId,
      draft: normalizeQuizHistory(snapshot).draft,
      expectedRevision: input.expectedRevision,
      mutationId: input.mutationId,
      editorId: input.editorId,
      schemaVersion: snapshot.draftSchemaVersion ?? ROUND_DRAFT_SCHEMA_VERSION,
      draftHash: `restore:${input.historyRevision}`,
      questionHealthUndo: input.questionHealthUndo,
    });
  }

  async archiveQuiz(
    workspaceId: string,
    quizId: string,
    archived: boolean,
    maxPublishedQuizzes: number | null = null,
  ) {
    return this.withPublicationLock(workspaceId, () =>
      this.archiveQuizUnlocked(workspaceId, quizId, archived, maxPublishedQuizzes),
    );
  }
  private async archiveQuizUnlocked(
    workspaceId: string,
    quizId: string,
    archived: boolean,
    maxPublishedQuizzes: number | null,
  ) {
    const quiz = this.quizzes.get(quizId);
    if (!quiz || quiz.workspaceId !== workspaceId) return null;
    const restoresPublishedQuiz = !archived && quiz.status === "archived" && quiz.currentVersionId;
    const publishedQuizCount = [...this.quizzes.values()].filter(
      (candidate) => candidate.workspaceId === workspaceId && candidate.status === "published",
    ).length;
    if (
      restoresPublishedQuiz &&
      maxPublishedQuizzes !== null &&
      publishedQuizCount + this.publishedSurveyCount(workspaceId) >= maxPublishedQuizzes
    ) {
      throw new PublishedQuizLimitError(maxPublishedQuizzes);
    }
    quiz.status = archived ? "archived" : quiz.currentVersionId ? "published" : "draft";
    quiz.updatedAt = new Date();
    return structuredClone(normalizeQuizRecord(quiz));
  }

  async deleteQuiz(workspaceId: string, quizId: string): Promise<LibraryArtifactDeletionResult> {
    const quiz = this.quizzes.get(quizId);
    if (!quiz || quiz.workspaceId !== workspaceId) return "not_found";
    if (quiz.status !== "archived") return "not_archived";
    const versionIds = new Set(
      [...this.versions.values()]
        .filter((version) => version.workspaceId === workspaceId && version.quizId === quizId)
        .map((version) => version.id),
    );
    if (
      [...this.sessions.values()].some(
        (session) => session.workspaceId === workspaceId && versionIds.has(session.quizVersionId),
      ) ||
      [...this.followups.values()].some(
        (followup) =>
          followup.workspaceId === workspaceId &&
          followup.sourceQuizVersionId !== null &&
          versionIds.has(followup.sourceQuizVersionId),
      ) ||
      this.isLibraryArtifactReferenced(workspaceId, "round", quizId)
    )
      return "in_use";

    // Keep the check and every removal synchronous so a restore or new dependent cannot interleave.
    const historyIds = new Set<string>();
    for (const [key, snapshot] of this.quizDraftHistory) {
      if (snapshot.workspaceId === workspaceId && snapshot.quizId === quizId) {
        historyIds.add(snapshot.id);
        this.quizDraftHistory.delete(key);
      }
    }
    for (const [key, mutation] of this.quizDraftMutations) {
      if (mutation.workspaceId === workspaceId && mutation.quizId === quizId)
        this.quizDraftMutations.delete(key);
    }
    for (const [key, dismissal] of this.questionHealthDismissals) {
      if (dismissal.workspaceId === workspaceId && dismissal.quizId === quizId)
        this.questionHealthDismissals.delete(key);
    }
    for (const [key, application] of this.questionHealthApplications) {
      if (application.workspaceId === workspaceId && application.quizId === quizId)
        this.questionHealthApplications.delete(key);
    }
    for (const id of versionIds) {
      this.versions.delete(id);
      this.deletedQuizVersions.add(`${workspaceId}:${id}`);
    }
    this.removeMediaReferencesForOwners(workspaceId, [
      { ownerType: "quiz_draft", ownerId: quizId },
      ...[...versionIds].map((ownerId) => ({ ownerType: "quiz_version" as const, ownerId })),
      ...[...historyIds].map((ownerId) => ({ ownerType: "quiz_history" as const, ownerId })),
    ]);
    this.quizzes.delete(quizId);
    this.markLibraryArtifactDeleted(workspaceId, "round", quizId);
    this.deleteLibraryArtifactMetadata(workspaceId, "round", quizId);
    return "deleted";
  }

  async duplicateQuiz(input: QuizRecord) {
    return this.createQuiz(input);
  }

  async publishQuiz(
    input: QuizVersionRecord,
    maxPublishedQuizzes: number | null = null,
    expectedDraftRevision?: number,
  ) {
    return this.withPublicationLock(input.workspaceId, () =>
      this.publishQuizUnlocked(input, maxPublishedQuizzes, expectedDraftRevision),
    );
  }
  private async publishQuizUnlocked(
    input: QuizVersionRecord,
    maxPublishedQuizzes: number | null,
    expectedDraftRevision?: number,
  ) {
    const quiz = this.quizzes.get(input.quizId);
    if (!quiz || quiz.workspaceId !== input.workspaceId) throw new Error("Quiz not found");
    const currentDraftRevision = quiz.draftRevision ?? 0;
    if (expectedDraftRevision !== undefined && expectedDraftRevision !== currentDraftRevision) {
      throw new QuizDraftRevisionConflictError(
        input.quizId,
        expectedDraftRevision,
        currentDraftRevision,
        quiz.lastEditedBy ?? null,
      );
    }
    const normalizedInput = normalizeQuizVersion(input);
    const publishedQuizCount = [...this.quizzes.values()].filter(
      (candidate) =>
        candidate.workspaceId === input.workspaceId && candidate.status === "published",
    ).length;
    if (
      quiz.status !== "published" &&
      maxPublishedQuizzes !== null &&
      publishedQuizCount + this.publishedSurveyCount(input.workspaceId) >= maxPublishedQuizzes
    ) {
      throw new PublishedQuizLimitError(maxPublishedQuizzes);
    }
    const existing = [...this.versions.values()].find(
      (version) =>
        version.quizId === normalizedInput.quizId &&
        version.contentHash === normalizedInput.contentHash,
    );
    const version = existing ?? {
      ...structuredClone(normalizedInput),
      sourceDraftRevision: currentDraftRevision,
    };
    if (!existing) this.versions.set(version.id, structuredClone(version));
    quiz.currentVersionId = version.id;
    quiz.status = "published";
    quiz.publishedDraftRevision = currentDraftRevision;
    quiz.updatedAt = new Date();
    await this.replaceMediaReferences(
      input.workspaceId,
      "quiz_version",
      version.id,
      quizMediaIds(version.content),
      version.publishedAt,
    );
    return structuredClone(normalizeQuizVersion(version));
  }

  async getQuizVersion(workspaceId: string, versionId: string) {
    const version = this.versions.get(versionId);
    return version?.workspaceId === workspaceId
      ? structuredClone(normalizeQuizVersion(version))
      : null;
  }

  async countPublishedQuizzes(workspaceId: string) {
    return [...this.quizzes.values()].filter(
      (quiz) => quiz.workspaceId === workspaceId && quiz.status === "published",
    ).length;
  }

  async getBrandTheme(workspaceId: string) {
    const theme = this.brandThemes.get(workspaceId);
    return theme ? structuredClone(theme) : null;
  }

  async updateBrandTheme(workspaceId: string, theme: BrandTheme | null) {
    if (theme) this.brandThemes.set(workspaceId, structuredClone(theme));
    else this.brandThemes.delete(workspaceId);
    return theme ? structuredClone(theme) : null;
  }

  async getEmbedAllowedOrigins(workspaceId: string) {
    return [...(this.workspaces.get(workspaceId)?.embedAllowedOrigins ?? [])];
  }

  async updateEmbedAllowedOrigins(workspaceId: string, origins: string[]) {
    const workspace = this.workspaces.get(workspaceId);
    if (!workspace) return [];
    workspace.embedAllowedOrigins = [...origins];
    return [...workspace.embedAllowedOrigins];
  }

  async getInstitutionPolicy(workspaceId: string): Promise<InstitutionPolicyRecord> {
    const policy = this.institutionPolicies.get(workspaceId);
    return policy
      ? structuredClone(policy)
      : {
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

  async updateInstitutionPolicy(input: InstitutionPolicyRecord, requestId: string) {
    if (!this.workspaces.has(input.workspaceId)) throw new Error("Workspace not found");
    const before = await this.getInstitutionPolicy(input.workspaceId);
    this.institutionPolicies.set(input.workspaceId, structuredClone(input));
    this.audits.push({
      id: crypto.randomUUID(),
      workspaceId: input.workspaceId,
      actorId: null,
      action: "institution.policy.update",
      targetType: "workspace",
      targetId: input.workspaceId,
      requestId,
      metadata: { before, after: structuredClone(input) },
      createdAt: new Date(),
    });
  }

  async createFederatedAuthTransaction(input: FederatedAuthTransactionRecord) {
    this.federatedAuthTransactions.set(input.stateHash, structuredClone(input));
  }

  async consumeFederatedAuthTransaction(stateHash: string, now: Date) {
    const transaction = this.federatedAuthTransactions.get(stateHash);
    if (!transaction || transaction.expiresAt <= now) return null;
    this.federatedAuthTransactions.delete(stateHash);
    return structuredClone(transaction);
  }

  async linkExternalIdentity(input: ExternalIdentityRecord) {
    const subjectConflict = [...this.externalIdentities.values()].find(
      (identity) =>
        identity.workspaceId === input.workspaceId &&
        identity.provider === input.provider &&
        identity.issuer === input.issuer &&
        identity.subject === input.subject,
    );
    if (subjectConflict) {
      return subjectConflict.userId === input.userId ? structuredClone(subjectConflict) : null;
    }
    const userConflict = [...this.externalIdentities.values()].some(
      (identity) =>
        identity.workspaceId === input.workspaceId &&
        identity.provider === input.provider &&
        identity.issuer === input.issuer &&
        identity.userId === input.userId,
    );
    if (userConflict) return null;
    this.externalIdentities.set(input.id, structuredClone(input));
    return structuredClone(input);
  }

  async getExternalIdentity(
    workspaceId: string,
    provider: ExternalIdentityRecord["provider"],
    issuer: string,
    subject: string,
  ) {
    const identity = [...this.externalIdentities.values()].find(
      (candidate) =>
        candidate.workspaceId === workspaceId &&
        candidate.provider === provider &&
        candidate.issuer === issuer &&
        candidate.subject === subject,
    );
    return identity ? structuredClone(identity) : null;
  }

  async listExternalIdentities(workspaceId: string, userId: string) {
    return [...this.externalIdentities.values()]
      .filter((identity) => identity.workspaceId === workspaceId && identity.userId === userId)
      .sort((left, right) => left.linkedAt.getTime() - right.linkedAt.getTime())
      .map((identity) => structuredClone(identity));
  }

  async touchExternalIdentity(identityId: string, usedAt: Date) {
    const identity = this.externalIdentities.get(identityId);
    if (identity) identity.lastUsedAt = new Date(usedAt);
  }

  async unlinkExternalIdentity(workspaceId: string, userId: string, identityId: string) {
    const identity = this.externalIdentities.get(identityId);
    if (!identity || identity.workspaceId !== workspaceId || identity.userId !== userId)
      return false;
    return this.externalIdentities.delete(identityId);
  }

  async upsertLtiRegistration(input: LtiRegistrationRecord) {
    if (!this.workspaces.has(input.workspaceId)) throw new Error("Workspace not found");
    const duplicate = [...this.ltiRegistrations.values()].find(
      (registration) =>
        registration.id !== input.id &&
        registration.workspaceId === input.workspaceId &&
        registration.issuer === input.issuer &&
        registration.clientId === input.clientId &&
        registration.deploymentId === input.deploymentId,
    );
    if (duplicate) throw new Error("LTI registration already exists");
    this.ltiRegistrations.set(input.id, structuredClone(input));
    return structuredClone(input);
  }

  async listLtiRegistrations(workspaceId: string) {
    return [...this.ltiRegistrations.values()]
      .filter((registration) => registration.workspaceId === workspaceId)
      .sort((left, right) => left.name.localeCompare(right.name))
      .map((registration) => structuredClone(registration));
  }

  async getLtiRegistration(registrationId: string) {
    const registration = this.ltiRegistrations.get(registrationId);
    return registration ? structuredClone(registration) : null;
  }

  async findLtiRegistration(issuer: string, clientId?: string, deploymentId?: string) {
    const matches = [...this.ltiRegistrations.values()].filter(
      (registration) =>
        registration.status === "active" &&
        registration.issuer === issuer &&
        (!clientId || registration.clientId === clientId) &&
        (!deploymentId || registration.deploymentId === deploymentId),
    );
    return matches.length === 1 ? structuredClone(matches[0]!) : null;
  }

  async createLtiLoginTransaction(input: LtiLoginTransactionRecord) {
    this.ltiLoginTransactions.set(input.stateHash, structuredClone(input));
  }

  async consumeLtiLoginTransaction(stateHash: string, now: Date) {
    const transaction = this.ltiLoginTransactions.get(stateHash);
    if (!transaction || transaction.expiresAt <= now) return null;
    this.ltiLoginTransactions.delete(stateHash);
    return structuredClone(transaction);
  }

  async createLtiLaunch(input: LtiLaunchRecord) {
    this.ltiLaunches.set(input.id, structuredClone(input));
    return structuredClone(input);
  }

  async getLtiLaunch(workspaceId: string, launchId: string, now: Date) {
    const launch = this.ltiLaunches.get(launchId);
    return launch && launch.workspaceId === workspaceId && launch.expiresAt > now
      ? structuredClone(launch)
      : null;
  }

  async bindLtiLaunch(linkTokenHash: string, userId: string, identityId: string, now: Date) {
    const launch = [...this.ltiLaunches.values()].find(
      (candidate) => candidate.linkTokenHash === linkTokenHash && candidate.expiresAt > now,
    );
    const registration = launch ? this.ltiRegistrations.get(launch.registrationId) : null;
    if (
      !launch ||
      !registration ||
      !launch.subject ||
      !this.workspaceMembers.has(`${launch.workspaceId}:${userId}`)
    ) {
      return null;
    }
    const existingSubject = [...this.externalIdentities.values()].find(
      (identity) =>
        identity.workspaceId === launch.workspaceId &&
        identity.provider === "lti" &&
        identity.issuer === registration.issuer &&
        identity.subject === launch.subject,
    );
    if (existingSubject && existingSubject.userId !== userId) return null;
    const existingUser = [...this.externalIdentities.values()].find(
      (identity) =>
        identity.workspaceId === launch.workspaceId &&
        identity.provider === "lti" &&
        identity.issuer === registration.issuer &&
        identity.userId === userId,
    );
    if (existingUser && existingUser.subject !== launch.subject) return null;
    if (!existingSubject) {
      this.externalIdentities.set(identityId, {
        id: identityId,
        workspaceId: launch.workspaceId,
        userId,
        provider: "lti",
        issuer: registration.issuer,
        subject: launch.subject,
        emailHint: null,
        linkedAt: new Date(now),
        lastUsedAt: new Date(now),
      });
    }
    launch.creatorUserId = userId;
    launch.linkTokenHash = null;
    return structuredClone(launch);
  }

  async completeLtiDeepLink(
    workspaceId: string,
    launchId: string,
    userId: string,
    quizId: string,
    responseJwt: string,
    completedAt: Date,
  ) {
    const launch = this.ltiLaunches.get(launchId);
    if (
      !launch ||
      launch.workspaceId !== workspaceId ||
      launch.creatorUserId !== userId ||
      launch.messageType !== "LtiDeepLinkingRequest" ||
      launch.expiresAt <= completedAt
    ) {
      return null;
    }
    if (!launch.responseJwt) {
      launch.quizId = quizId;
      launch.responseJwt = responseJwt;
      launch.completedAt = new Date(completedAt);
    }
    return structuredClone(launch);
  }

  async getEmbedPolicyByKey(policyKeyHash: string, sessionId: string, now: Date) {
    const credential = [...this.sessionStaff.values()].find(
      (candidate) =>
        candidate.embedPolicyKeyHash === policyKeyHash &&
        candidate.sessionId === sessionId &&
        candidate.role === "presenter" &&
        !candidate.revokedAt &&
        candidate.expiresAt > now,
    );
    return credential
      ? {
          allowedOrigins: [...(credential.embedAllowedOrigins ?? [])],
          expiresAt: new Date(credential.expiresAt),
        }
      : null;
  }

  async getLiveRoomCode(code: string, now = new Date()) {
    const claim = this.liveRoomCodes.get(code);
    if (!claim || claim.releasedAt !== null || claim.expiresAt <= now) return null;
    return structuredClone(claim);
  }

  assertWorkspaceLiveSessionCreationAllowed(workspaceId: string) {
    if (this.workspaceMediaDeletionClaims.has(workspaceId)) {
      throw new WorkspaceDeletionInProgressError(workspaceId);
    }
  }

  async claimLiveRoomCode(input: LiveRoomCodeClaim) {
    this.assertWorkspaceLiveSessionCreationAllowed(input.workspaceId);
    const now = new Date();
    const current = this.liveRoomCodes.get(input.code);
    if (current && current.releasedAt === null && current.expiresAt > now) {
      throw new SessionCodeConflictError(input.code);
    }
    const claim: LiveRoomCodeRecord = {
      ...structuredClone(input),
      releasedAt: null,
    };
    this.liveRoomCodes.set(input.code, claim);
    return structuredClone(claim);
  }

  async releaseLiveRoomCode(
    artifactType: LiveRoomArtifactType,
    artifactId: string,
    releasedAt = new Date(),
  ) {
    const claim = [...this.liveRoomCodes.values()].find(
      (candidate) => candidate.artifactType === artifactType && candidate.artifactId === artifactId,
    );
    if (!claim) return false;
    claim.releasedAt ??= new Date(releasedAt);
    return true;
  }

  async createSession(input: StoredSession) {
    await this.claimLiveRoomCode({
      code: input.state.code,
      workspaceId: input.workspaceId,
      artifactType: "round",
      artifactId: input.id,
      expiresAt: input.expiresAt,
      createdAt: input.createdAt,
    });
    try {
      // `claimLiveRoomCode` is awaited by callers, so account deletion can start between the
      // reservation and this write. Recheck synchronously before publishing any session state.
      this.assertWorkspaceLiveSessionCreationAllowed(input.workspaceId);
      if (this.deletedQuizVersions.has(`${input.workspaceId}:${input.quizVersionId}`)) {
        throw new Error("Quiz version not found");
      }
      this.sessions.set(
        input.id,
        structuredClone({
          ...input,
          trustMode: input.trustMode ?? input.state.settings.trustMode ?? "learning",
        }),
      );
      this.interactionSettings.set(input.id, {
        workspaceId: input.workspaceId,
        sessionId: input.id,
        signalsEnabled: true,
        chatEnabled: false,
        chatIdentityMode: "alias_public",
        slowModeSeconds: 5,
        presenterFeedMode: "pinned",
        audienceSeq: 0,
        closedAt: null,
        updatedAt: new Date(input.createdAt),
      });
      if (input.state.phase === "finished" || input.expiresAt <= new Date()) {
        await this.releaseLiveRoomCode("round", input.id, input.updatedAt);
      }
    } catch (error) {
      await this.releaseLiveRoomCode("round", input.id);
      throw error;
    }
  }

  async getSessionById(sessionId: string) {
    const value = this.sessions.get(sessionId);
    return value ? structuredClone(value) : null;
  }

  async getSessionByCode(code: string) {
    const now = Date.now();
    const value = [...this.sessions.values()].find(
      (session) =>
        session.state.code === code &&
        session.state.phase !== "finished" &&
        session.expiresAt.getTime() > now,
    );
    return value ? structuredClone(value) : null;
  }

  async listSessionIds(workspaceId: string) {
    return [...this.sessions.values()]
      .filter((session) => session.workspaceId === workspaceId)
      .map((session) => session.id)
      .sort();
  }

  async listSessionInvalidationTargets(workspaceId: string): Promise<SessionInvalidationTarget[]> {
    return [...this.sessions.values()]
      .filter((session) => session.workspaceId === workspaceId)
      .map((session) => ({ sessionId: session.id, code: session.state.code }))
      .sort((left, right) => left.sessionId.localeCompare(right.sessionId));
  }

  async workspaceDeletionStarted(workspaceId: string) {
    return this.workspaceMediaDeletionClaims.has(workspaceId);
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
    const records = [...this.sessions.values()]
      .filter((session) => session.workspaceId === workspaceId)
      .flatMap((session): SessionHistoryRecord[] => {
        const version = this.versions.get(session.quizVersionId);
        if (!version) return [];
        const quiz = this.quizzes.get(version.quizId);
        if (!quiz) return [];
        const status: SessionHistoryRecord["status"] =
          session.state.phase === "finished"
            ? "finished"
            : session.expiresAt <= options.now
              ? "expired"
              : "active";
        const questionIndex =
          session.state.questionIndex === null
            ? null
            : session.state.roundKind === "main"
              ? session.state.questionIndex
              : session.state.sourceRoundId
                ? (session.state.rounds[session.state.sourceRoundId]?.position ??
                  session.state.questionIndex)
                : session.state.questionIndex;
        return [
          {
            id: session.id,
            quizId: version.quizId,
            title: session.state.quiz.title,
            status,
            phase: session.state.phase,
            code: session.state.code,
            participantCount: Object.values(session.state.participants).filter(
              (participant) => !participant.kicked,
            ).length,
            answerCount: [...this.answers.keys()].filter((key) => key.startsWith(`${session.id}:`))
              .length,
            questionCount: session.state.quiz.questions.filter(
              (question) => questionDelivery(question) === "main",
            ).length,
            questionPosition:
              questionIndex === null
                ? null
                : session.state.quiz.questions
                    .slice(0, questionIndex + 1)
                    .filter((question) => questionDelivery(question) === "main").length,
            createdAt: new Date(session.createdAt),
            updatedAt: new Date(session.updatedAt),
            expiresAt: new Date(session.expiresAt),
            reportId:
              [...this.reports.values()].find((report) => report.sessionId === session.id)?.id ??
              null,
          },
        ];
      })
      .filter((item) => !options.status || item.status === options.status)
      .filter((item) => !options.quizId || item.quizId === options.quizId)
      .filter((item) => !options.from || item.createdAt >= options.from)
      .filter((item) => !options.to || item.createdAt <= options.to)
      .filter(
        (item) =>
          !options.cursor ||
          item.createdAt < options.cursor.createdAt ||
          (item.createdAt.getTime() === options.cursor.createdAt.getTime() &&
            item.id < options.cursor.id),
      )
      .sort(
        (left, right) =>
          right.createdAt.getTime() - left.createdAt.getTime() || right.id.localeCompare(left.id),
      );
    return {
      items: structuredClone(records.slice(0, options.limit)),
      hasMore: records.length > options.limit,
    };
  }

  async saveSession(
    input: StoredSession,
    expectedVersion: number,
    report?: Report,
    decisionEvents: SessionDecisionEventWrite[] = [],
  ) {
    if (this.workspaceMediaDeletionClaims.has(input.workspaceId)) {
      throw new WorkspaceDeletionInProgressError(input.workspaceId);
    }
    const current = this.sessions.get(input.id);
    if (!current || current.state.version !== expectedVersion) {
      throw new SessionVersionConflictError(input.id, expectedVersion);
    }
    if (report && report.sessionId !== input.id) throw new Error("Report session does not match");
    const currentTrustMode = current.trustMode ?? current.state.settings.trustMode ?? "learning";
    const nextTrustMode = input.trustMode ?? input.state.settings.trustMode ?? "learning";
    const currentDecisionReplayEnabled = current.decisionReplayEnabled ?? false;
    const nextDecisionReplayEnabled = input.decisionReplayEnabled ?? false;
    if (
      currentTrustMode !== nextTrustMode ||
      (input.state.settings.trustMode ?? "learning") !== nextTrustMode ||
      currentDecisionReplayEnabled !== nextDecisionReplayEnabled
    ) {
      throw new Error("Session trust and decision replay settings are immutable");
    }
    if (decisionEvents.length > 0 && !nextDecisionReplayEnabled) {
      throw new Error("Decision events cannot be written for a session without replay enabled");
    }
    const currentDecisionEvents = this.sessionDecisionEvents.get(input.id) ?? [];
    const nextDecisionEvents = decisionEvents.map((write) => ({
      ...write,
      event: SessionDecisionEventSchema.parse(write.event),
    }));
    if (
      nextDecisionEvents.some(
        (write) =>
          typeof write.commandId !== "string" ||
          write.commandId.length === 0 ||
          write.commandId.length > 160 ||
          !Number.isSafeInteger(write.eventOrdinal) ||
          write.eventOrdinal < 0,
      )
    ) {
      throw new Error("Invalid session decision event command or ordinal");
    }
    for (let index = 0; index < nextDecisionEvents.length; index += 1) {
      const write = nextDecisionEvents[index]!;
      const priorEvents = [...currentDecisionEvents, ...nextDecisionEvents.slice(0, index)];
      if (
        priorEvents.some(
          (prior) =>
            prior.event.seq === write.event.seq ||
            (prior.commandId === write.commandId && prior.eventOrdinal === write.eventOrdinal),
        )
      ) {
        throw new Error("Duplicate session decision event sequence or command ordinal");
      }
    }
    const hasDecisionEventLimitMarker = currentDecisionEvents.some(
      (write) => write.event.type === "capture_truncated",
    );
    const capturedDecisionEventCount = currentDecisionEvents.filter(
      (write) => write.event.type !== "capture_truncated",
    ).length;
    const decisionEventSlots = Math.max(
      0,
      MAX_SESSION_DECISION_EVENTS - capturedDecisionEventCount,
    );
    const eventsToPersist = hasDecisionEventLimitMarker
      ? []
      : nextDecisionEvents.slice(0, decisionEventSlots);
    const firstOmittedDecisionEvent = nextDecisionEvents[decisionEventSlots];
    if (!hasDecisionEventLimitMarker && firstOmittedDecisionEvent) {
      eventsToPersist.push({
        ...firstOmittedDecisionEvent,
        event: {
          type: "capture_truncated",
          seq: firstOmittedDecisionEvent.event.seq,
          occurredAt: firstOmittedDecisionEvent.event.occurredAt,
          reason: "event_limit",
        },
      });
    }
    const storedSession = structuredClone({ ...input, updatedAt: new Date() });
    const storedReport = report ? structuredClone(report) : undefined;
    this.sessions.set(input.id, storedSession);
    if (eventsToPersist.length > 0) {
      this.sessionDecisionEvents.set(input.id, [
        ...currentDecisionEvents,
        ...structuredClone(eventsToPersist),
      ]);
    }
    if (storedSession.state.phase === "finished") {
      await this.releaseLiveRoomCode("round", storedSession.id, storedSession.updatedAt);
      const settings = this.interactionSettings.get(input.id);
      if (settings) {
        settings.closedAt ??= new Date();
        settings.signalsEnabled = false;
        settings.chatEnabled = false;
        settings.updatedAt = new Date();
      }
    }
    if (storedReport) {
      const prior = [...this.reports.entries()].find(
        ([, candidate]) => candidate.sessionId === storedReport.sessionId,
      );
      const createdAt = prior ? (this.reportCreatedAt.get(prior[0]) ?? new Date()) : new Date();
      if (prior) {
        this.reports.delete(prior[0]);
        this.reportJobs.delete(prior[0]);
        this.reportCreatedAt.delete(prior[0]);
      }
      this.reports.set(storedReport.id, storedReport);
      this.reportCreatedAt.set(storedReport.id, createdAt);
      if (storedReport.status === "pending") {
        this.reportJobs.set(storedReport.id, {
          workspaceId: input.workspaceId,
          attempts: 0,
          availableAt: new Date(0),
          lastError: null,
        });
      }
    }
  }

  async deleteSession(workspaceId: string, sessionId: string) {
    const session = this.sessions.get(sessionId);
    if (!session || session.workspaceId !== workspaceId) return false;
    this.deleteSessionTree(sessionId);
    return true;
  }

  private deleteSessionTree(sessionId: string) {
    for (const [code, claim] of this.liveRoomCodes) {
      if (claim.artifactType === "round" && claim.artifactId === sessionId) {
        this.liveRoomCodes.delete(code);
      }
    }
    for (const [followupId, followup] of this.followups) {
      if (followup.sourceSessionId === sessionId) this.deleteFollowupTree(followupId);
    }
    this.sessions.delete(sessionId);
    this.sessionDecisionEvents.delete(sessionId);
    this.expiredLiveSessions.delete(sessionId);
    for (const [key, participant] of this.participants) {
      if (participant.sessionId === sessionId) this.participants.delete(key);
    }
    for (const [key, credential] of this.sessionStaff) {
      if (credential.sessionId === sessionId) this.sessionStaff.delete(key);
    }
    this.qnaSettings.delete(sessionId);
    for (const [id, question] of this.qnaQuestions) {
      if (question.sessionId === sessionId) this.qnaQuestions.delete(id);
    }
    for (const [id, reply] of this.qnaReplies) {
      if (reply.sessionId === sessionId) this.qnaReplies.delete(id);
    }
    for (const vote of this.qnaVotes) {
      if (vote.startsWith(`${sessionId}:`)) this.qnaVotes.delete(vote);
    }
    for (const ban of this.qnaBans) {
      if (ban.startsWith(`${sessionId}:`)) this.qnaBans.delete(ban);
    }
    this.interactionSettings.delete(sessionId);
    for (const [key, signal] of this.participantSignals) {
      if (signal.sessionId === sessionId) this.participantSignals.delete(key);
    }
    for (let index = this.signalEvents.length - 1; index >= 0; index -= 1) {
      if (this.signalEvents[index]?.sessionId === sessionId) this.signalEvents.splice(index, 1);
    }
    const chatMessageIds = new Set<string>();
    for (const [id, message] of this.chatMessages) {
      if (message.sessionId === sessionId) {
        chatMessageIds.add(id);
        this.chatMessages.delete(id);
      }
    }
    for (const [key, reaction] of this.chatReactions) {
      if (reaction.sessionId === sessionId) this.chatReactions.delete(key);
    }
    for (const report of this.chatReports) {
      if (chatMessageIds.has(report.split(":", 1)[0]!)) this.chatReports.delete(report);
    }
    for (const [key, restriction] of this.audienceRestrictions) {
      if (restriction.sessionId === sessionId) this.audienceRestrictions.delete(key);
    }
    for (const [id, event] of this.audienceOutbox) {
      if (event.sessionId === sessionId) this.audienceOutbox.delete(id);
    }
    for (const key of this.answers.keys()) {
      if (key.startsWith(`${sessionId}:`)) this.answers.delete(key);
    }
    for (const [id, report] of this.reports) {
      if (report.sessionId === sessionId) {
        this.reports.delete(id);
        this.reportJobs.delete(id);
        this.reportCreatedAt.delete(id);
      }
    }
  }

  private deleteFollowupTree(followupId: string) {
    const followup = this.followups.get(followupId);
    if (followup)
      this.removeMediaReferencesForOwners(followup.workspaceId, [
        { ownerType: "followup", ownerId: followupId },
      ]);
    this.followups.delete(followupId);
    const accessIds = new Set<string>();
    for (const [tokenHash, access] of this.followupAccess) {
      if (access.followupId === followupId) {
        accessIds.add(access.id);
        this.followupAccess.delete(tokenHash);
      }
    }
    const attemptIds = new Set<string>();
    for (const [tokenHash, attempt] of this.followupAttempts) {
      if (
        attempt.followupId === followupId ||
        (attempt.accessTokenId && accessIds.has(attempt.accessTokenId))
      ) {
        attemptIds.add(attempt.id);
        this.followupAttempts.delete(tokenHash);
      }
    }
    for (const [key, answer] of this.followupAnswers) {
      if (answer.followupId === followupId || attemptIds.has(answer.attemptId)) {
        this.followupAnswers.delete(key);
      }
    }
  }

  async createParticipant(input: ParticipantRecord) {
    this.participants.set(input.tokenHash, structuredClone(input));
  }

  async commitParticipants(
    session: StoredSession,
    participants: ParticipantRecord[],
    expectedVersion: number,
  ) {
    this.assertWorkspaceLiveSessionCreationAllowed(session.workspaceId);
    const current = this.sessions.get(session.id);
    if (!current || current.state.version !== expectedVersion) {
      throw new SessionVersionConflictError(session.id, expectedVersion);
    }
    const existingIds = new Set([...this.participants.values()].map(({ id }) => id));
    for (const participant of participants) {
      if (this.participants.has(participant.tokenHash) || existingIds.has(participant.id)) {
        throw new Error("Participant state changed during persistence");
      }
      existingIds.add(participant.id);
    }
    for (const participant of participants) {
      this.participants.set(participant.tokenHash, structuredClone(participant));
    }
    await this.saveSession(session, expectedVersion);
  }

  async getParticipantByToken(tokenHash: string) {
    const value = this.participants.get(tokenHash);
    return value ? structuredClone(value) : null;
  }

  async getParticipants(sessionId: string) {
    return [...this.participants.values()]
      .filter((participant) => participant.sessionId === sessionId)
      .map((participant) => structuredClone(participant));
  }

  async createSessionStaffCredential(input: SessionStaffCredentialInput) {
    const normalized = {
      ...input,
      purpose: input.purpose ?? "collaboration",
      embedPolicyKeyHash: input.embedPolicyKeyHash ?? null,
      embedAllowedOrigins: input.embedAllowedOrigins ?? [],
    };
    this.sessionStaff.set(input.tokenHash, structuredClone(normalized));
    return structuredClone(normalized);
  }

  async replaceCreatorResumeCredential(input: SessionStaffCredentialRecord) {
    if (input.purpose !== "creator_resume" || input.role !== "cohost") {
      throw new Error("A creator resume credential must be a cohost credential");
    }
    const session = this.sessions.get(input.sessionId);
    const checkedAt = new Date();
    if (
      !session ||
      session.workspaceId !== input.workspaceId ||
      session.state.phase === "finished" ||
      session.expiresAt <= checkedAt
    ) {
      throw new SessionNotActiveError(input.sessionId);
    }
    const revokedCredentialIds: string[] = [];
    for (const credential of this.sessionStaff.values()) {
      if (
        credential.workspaceId === input.workspaceId &&
        credential.sessionId === input.sessionId &&
        credential.createdBy === input.createdBy &&
        credential.purpose === "creator_resume" &&
        !credential.revokedAt
      ) {
        credential.revokedAt = new Date(input.createdAt);
        revokedCredentialIds.push(credential.id);
      }
    }
    return {
      credential: await this.createSessionStaffCredential(input),
      revokedCredentialIds,
    };
  }

  async getSessionStaffByToken(tokenHash: string, now: Date) {
    const credential = this.sessionStaff.get(tokenHash);
    return credential && !credential.revokedAt && credential.expiresAt > now
      ? structuredClone(credential)
      : null;
  }

  async listSessionStaff(workspaceId: string, sessionId: string) {
    return [...this.sessionStaff.values()]
      .filter(
        (credential) =>
          credential.workspaceId === workspaceId && credential.sessionId === sessionId,
      )
      .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime())
      .map((credential) => structuredClone(credential));
  }

  async revokeSessionStaff(workspaceId: string, sessionId: string, credentialId: string) {
    const credential = [...this.sessionStaff.values()].find(
      (candidate) =>
        candidate.workspaceId === workspaceId &&
        candidate.sessionId === sessionId &&
        candidate.id === credentialId,
    );
    if (!credential || credential.revokedAt) return false;
    credential.revokedAt = new Date();
    return true;
  }

  async getWorkspaceSegment(workspaceId: string) {
    return (
      [...this.users.values()].find((user) => user.workspaceId === workspaceId)?.segment ??
      "workplace"
    );
  }

  async getQnaSettings(workspaceId: string, sessionId: string) {
    const settings = this.qnaSettings.get(sessionId);
    return settings?.workspaceId === workspaceId ? structuredClone(settings) : null;
  }

  async saveQnaSettings(input: QnaSettingsRecord) {
    this.qnaSettings.set(input.sessionId, structuredClone(input));
    return structuredClone(input);
  }

  async createQnaQuestion(input: QnaQuestionRecord) {
    this.qnaQuestions.set(input.id, structuredClone(input));
    return structuredClone(input);
  }

  async getQnaQuestion(workspaceId: string, questionId: string) {
    const question = this.qnaQuestions.get(questionId);
    if (!question || question.workspaceId !== workspaceId) return null;
    const voteCount = [...this.qnaVotes].filter((vote) => vote.includes(`:${questionId}:`)).length;
    return structuredClone({ ...question, voteCount });
  }

  async listQnaQuestions(workspaceId: string, sessionId: string, viewerParticipantId?: string) {
    return [...this.qnaQuestions.values()]
      .filter(
        (question) => question.workspaceId === workspaceId && question.sessionId === sessionId,
      )
      .sort(
        (left, right) =>
          right.createdAt.getTime() - left.createdAt.getTime() || right.id.localeCompare(left.id),
      )
      .map((question) => {
        const prefix = `${sessionId}:${question.id}:`;
        const voteCount = [...this.qnaVotes].filter((vote) => vote.startsWith(prefix)).length;
        return structuredClone({
          ...question,
          voteCount,
          votedByViewer: viewerParticipantId
            ? this.qnaVotes.has(`${prefix}${viewerParticipantId}`)
            : false,
        });
      });
  }

  async updateQnaQuestion(
    workspaceId: string,
    questionId: string,
    update: Pick<QnaQuestionRecord, "status" | "label">,
  ) {
    const question = this.qnaQuestions.get(questionId);
    if (!question || question.workspaceId !== workspaceId) return null;
    Object.assign(question, update, { updatedAt: new Date() });
    return structuredClone(question);
  }

  async createQnaReply(input: QnaReplyRecord) {
    this.qnaReplies.set(input.id, structuredClone(input));
    return structuredClone(input);
  }

  async getQnaReply(workspaceId: string, replyId: string) {
    const reply = this.qnaReplies.get(replyId);
    return reply?.workspaceId === workspaceId ? structuredClone(reply) : null;
  }

  async listQnaReplies(workspaceId: string, questionId: string) {
    return [...this.qnaReplies.values()]
      .filter((reply) => reply.workspaceId === workspaceId && reply.questionId === questionId)
      .sort(
        (left, right) =>
          left.createdAt.getTime() - right.createdAt.getTime() || left.id.localeCompare(right.id),
      )
      .map((reply) => structuredClone(reply));
  }

  async updateQnaReply(workspaceId: string, replyId: string, status: QnaReplyRecord["status"]) {
    const reply = this.qnaReplies.get(replyId);
    if (!reply || reply.workspaceId !== workspaceId) return null;
    reply.status = status;
    reply.updatedAt = new Date();
    return structuredClone(reply);
  }

  async setQnaVote(
    workspaceId: string,
    sessionId: string,
    questionId: string,
    participantId: string,
    voted: boolean,
  ) {
    const question = this.qnaQuestions.get(questionId);
    if (!question || question.workspaceId !== workspaceId || question.sessionId !== sessionId) {
      throw new Error("Q&A question not found");
    }
    const key = `${sessionId}:${questionId}:${participantId}`;
    if (voted) this.qnaVotes.add(key);
    else this.qnaVotes.delete(key);
    return [...this.qnaVotes].filter((vote) => vote.startsWith(`${sessionId}:${questionId}:`))
      .length;
  }

  async isQnaBanned(workspaceId: string, sessionId: string, participantId: string) {
    const session = this.sessions.get(sessionId);
    return (
      session?.workspaceId === workspaceId && this.qnaBans.has(`${sessionId}:${participantId}`)
    );
  }

  async banQnaParticipant(
    workspaceId: string,
    sessionId: string,
    participantId: string,
    _actorId: string | null,
  ) {
    const session = this.sessions.get(sessionId);
    if (session?.workspaceId !== workspaceId) throw new Error("Session not found");
    this.qnaBans.add(`${sessionId}:${participantId}`);
  }

  private findAudienceEvent(sessionId: string, idempotencyKey: string) {
    return [...this.audienceOutbox.values()].find(
      (event) => event.sessionId === sessionId && event.idempotencyKey === idempotencyKey,
    );
  }

  private requireOpenInteractionSettings(workspaceId: string, sessionId: string) {
    const settings = this.interactionSettings.get(sessionId);
    if (!settings || settings.workspaceId !== workspaceId) {
      throw new AudienceStoreError("NOT_FOUND", "Audience interaction settings were not found");
    }
    if (settings.closedAt) {
      throw new AudienceStoreError(
        "CONFLICT",
        "Audience interactions are closed because this live round has finished",
      );
    }
    return settings;
  }

  private allocateAudienceEvent(
    workspaceId: string,
    sessionId: string,
    input: AudienceEventInput,
    createdAt: Date,
  ) {
    const settings = this.requireOpenInteractionSettings(workspaceId, sessionId);
    settings.audienceSeq += 1;
    settings.updatedAt = createdAt;
    const event: AudienceOutboxRecord = {
      eventId: input.eventId,
      workspaceId,
      sessionId,
      audienceSeq: settings.audienceSeq,
      type: input.type,
      idempotencyKey: input.idempotencyKey,
      payload: structuredClone(input.payload),
      attempts: 0,
      claimedAt: null,
      deliveredAt: null,
      createdAt,
    };
    this.audienceOutbox.set(event.eventId, structuredClone(event));
    return event;
  }

  async getInteractionSettings(workspaceId: string, sessionId: string) {
    const settings = this.interactionSettings.get(sessionId);
    return settings?.workspaceId === workspaceId ? structuredClone(settings) : null;
  }

  async appendAudienceEvent(
    workspaceId: string,
    sessionId: string,
    eventInput: AudienceEventInput,
    createdAt: Date,
  ): Promise<AudienceMutation<null>> {
    const existing = this.findAudienceEvent(sessionId, eventInput.idempotencyKey);
    if (existing) {
      return { record: null, event: structuredClone(existing), duplicate: true };
    }
    const event = this.allocateAudienceEvent(workspaceId, sessionId, eventInput, createdAt);
    return { record: null, event: structuredClone(event), duplicate: false };
  }

  async saveInteractionSettings(
    input: Omit<InteractionSettingsRecord, "audienceSeq" | "closedAt">,
    eventInput: AudienceEventInput,
  ): Promise<AudienceMutation<InteractionSettingsRecord>> {
    const existingEvent = this.findAudienceEvent(input.sessionId, eventInput.idempotencyKey);
    const existing = this.interactionSettings.get(input.sessionId);
    const session = this.sessions.get(input.sessionId);
    if (!session || session.workspaceId !== input.workspaceId) {
      throw new AudienceStoreError("NOT_FOUND", "Live round not found");
    }
    if (session.state.phase === "finished" || existing?.closedAt) {
      throw new AudienceStoreError(
        "CONFLICT",
        "Audience interactions are closed because this live round has finished",
      );
    }
    if (existingEvent && existing) {
      return {
        record: structuredClone(existing),
        event: structuredClone(existingEvent),
        duplicate: true,
      };
    }
    const base: InteractionSettingsRecord = {
      ...structuredClone(input),
      audienceSeq: existing?.audienceSeq ?? 0,
      closedAt: null,
    };
    this.interactionSettings.set(input.sessionId, base);
    const event = this.allocateAudienceEvent(
      input.workspaceId,
      input.sessionId,
      eventInput,
      input.updatedAt,
    );
    const saved = this.interactionSettings.get(input.sessionId)!;
    return { record: structuredClone(saved), event: structuredClone(event), duplicate: false };
  }

  async listParticipantSignals(workspaceId: string, sessionId: string, contextKey: string) {
    return [...this.participantSignals.values()]
      .filter(
        (signal) =>
          signal.workspaceId === workspaceId &&
          signal.sessionId === sessionId &&
          signal.contextKey === contextKey,
      )
      .map((signal) => structuredClone(signal));
  }

  async countRecentSignalEvents(workspaceId: string, sessionId: string, since: Date) {
    return this.signalEvents.filter(
      (event) =>
        event.workspaceId === workspaceId &&
        event.sessionId === sessionId &&
        event.createdAt >= since,
    ).length;
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
    this.requireOpenInteractionSettings(input.workspaceId, input.sessionId);
    const key = `${input.sessionId}:${input.contextKey}:${input.participantId}`;
    const existingEvent = this.findAudienceEvent(input.sessionId, eventInput.idempotencyKey);
    if (existingEvent) {
      return {
        record: structuredClone(this.participantSignals.get(key) ?? null),
        event: structuredClone(existingEvent),
        duplicate: true,
      };
    }
    const recentSignals = this.signalEvents.filter(
      (candidate) =>
        candidate.sessionId === input.sessionId &&
        candidate.participantId === input.participantId &&
        input.now.getTime() - candidate.createdAt.getTime() < 60_000,
    );
    if (recentSignals.length >= 30) {
      throw new AudienceStoreError(
        "SIGNAL_RATE_LIMITED",
        "Too many pulse changes; wait before trying again",
      );
    }
    const record = input.signal
      ? {
          workspaceId: input.workspaceId,
          sessionId: input.sessionId,
          contextKey: input.contextKey,
          participantId: input.participantId,
          signal: input.signal,
          updatedAt: input.now,
        }
      : null;
    if (record) this.participantSignals.set(key, structuredClone(record));
    else this.participantSignals.delete(key);
    this.signalEvents.push({
      workspaceId: input.workspaceId,
      sessionId: input.sessionId,
      participantId: input.participantId,
      contextKey: input.contextKey,
      signal: input.signal,
      idempotencyKey: eventInput.idempotencyKey,
      createdAt: input.now,
    });
    const event = this.allocateAudienceEvent(
      input.workspaceId,
      input.sessionId,
      eventInput,
      input.now,
    );
    return {
      record: structuredClone(record),
      event: structuredClone(event),
      duplicate: false,
    };
  }

  async getChatMessage(workspaceId: string, messageId: string) {
    const message = this.chatMessages.get(messageId);
    return message?.workspaceId === workspaceId ? structuredClone(message) : null;
  }

  async listChatMessages(
    workspaceId: string,
    sessionId: string,
    options: ChatMessageListOptions = {},
  ) {
    const messages = [...this.chatMessages.values()]
      .filter((message) => message.workspaceId === workspaceId && message.sessionId === sessionId)
      .filter((message) => !options.pinnedOnly || message.pinned)
      .filter(
        (message) =>
          !options.cursor ||
          message.createdAt < options.cursor.createdAt ||
          (message.createdAt.getTime() === options.cursor.createdAt.getTime() &&
            message.id.localeCompare(options.cursor.id) < 0),
      )
      .sort(
        (left, right) =>
          right.createdAt.getTime() - left.createdAt.getTime() || right.id.localeCompare(left.id),
      );
    return messages
      .slice(0, options.limit ?? messages.length)
      .map((message) => structuredClone(message));
  }

  async createChatMessage(
    input: Omit<ChatMessageRecord, "audienceSeq">,
    eventInput: AudienceEventInput,
  ): Promise<AudienceMutation<ChatMessageRecord>> {
    this.requireOpenInteractionSettings(input.workspaceId, input.sessionId);
    const existingEvent = this.findAudienceEvent(input.sessionId, eventInput.idempotencyKey);
    const existingMessage = [...this.chatMessages.values()].find(
      (message) =>
        message.sessionId === input.sessionId &&
        message.idempotencyKey === eventInput.idempotencyKey,
    );
    if (existingEvent && existingMessage) {
      return {
        record: structuredClone(existingMessage),
        event: structuredClone(existingEvent),
        duplicate: true,
      };
    }
    const settings = this.interactionSettings.get(input.sessionId);
    if (!settings?.chatEnabled) {
      throw new AudienceStoreError("CHAT_DISABLED", "Chat is disabled for this live round");
    }
    if (input.replyToId) {
      const parent = this.chatMessages.get(input.replyToId);
      if (!parent || parent.sessionId !== input.sessionId || parent.status === "removed") {
        throw new AudienceStoreError(
          "NOT_FOUND",
          "The chat message being replied to was not found",
        );
      }
      if (parent.replyToId) {
        throw new AudienceStoreError("CONFLICT", "Chat supports one level of replies");
      }
    }
    const sessionMessages = [...this.chatMessages.values()].filter(
      (message) => message.sessionId === input.sessionId,
    );
    if (sessionMessages.length >= 10_000) {
      throw new AudienceStoreError(
        "CHAT_CAPACITY_REACHED",
        "This round has reached its chat message limit",
      );
    }
    if (input.participantId) {
      const restriction = this.audienceRestrictions.get(
        `${input.sessionId}:${input.participantId}`,
      );
      if (restriction?.bannedAt) {
        throw new AudienceStoreError("AUDIENCE_BANNED", "Audience interaction access was revoked");
      }
      if (restriction?.mutedUntil && restriction.mutedUntil > input.createdAt) {
        throw new AudienceStoreError(
          "CHAT_MUTED",
          "Chat is temporarily muted for this participant",
        );
      }
      const mine = sessionMessages.filter(
        (message) => message.participantId === input.participantId,
      );
      if (mine.length >= 200) {
        throw new AudienceStoreError(
          "CHAT_CAPACITY_REACHED",
          "This participant has reached the session chat limit",
        );
      }
      const minuteCount = mine.filter(
        (message) => input.createdAt.getTime() - message.createdAt.getTime() < 60_000,
      ).length;
      if (minuteCount >= 12) {
        throw new AudienceStoreError(
          "CHAT_RATE_LIMITED",
          "Too many messages; wait before posting again",
        );
      }
      const latest = mine.sort(
        (left, right) => right.createdAt.getTime() - left.createdAt.getTime(),
      )[0];
      if (
        latest &&
        input.createdAt.getTime() - latest.createdAt.getTime() < settings.slowModeSeconds * 1_000
      ) {
        throw new AudienceStoreError(
          "CHAT_RATE_LIMITED",
          `Slow mode allows one message every ${settings.slowModeSeconds} seconds`,
        );
      }
    }
    const event = this.allocateAudienceEvent(
      input.workspaceId,
      input.sessionId,
      eventInput,
      input.createdAt,
    );
    const message = { ...structuredClone(input), audienceSeq: event.audienceSeq };
    this.chatMessages.set(message.id, message);
    return { record: structuredClone(message), event: structuredClone(event), duplicate: false };
  }

  async updateChatMessage(
    workspaceId: string,
    sessionId: string,
    messageId: string,
    update: { status?: ChatMessageRecord["status"]; pinned?: boolean },
    eventInput: AudienceEventInput,
    updatedAt: Date,
  ): Promise<AudienceMutation<ChatMessageRecord>> {
    this.requireOpenInteractionSettings(workspaceId, sessionId);
    const existingEvent = this.findAudienceEvent(sessionId, eventInput.idempotencyKey);
    const message = this.chatMessages.get(messageId);
    if (!message || message.workspaceId !== workspaceId || message.sessionId !== sessionId) {
      throw new AudienceStoreError("NOT_FOUND", "Chat message not found");
    }
    if (existingEvent) {
      return {
        record: structuredClone(message),
        event: structuredClone(existingEvent),
        duplicate: true,
      };
    }
    if (update.status) message.status = update.status;
    if (update.pinned !== undefined) message.pinned = update.pinned;
    message.updatedAt = updatedAt;
    const event = this.allocateAudienceEvent(workspaceId, sessionId, eventInput, updatedAt);
    message.audienceSeq = event.audienceSeq;
    return { record: structuredClone(message), event: structuredClone(event), duplicate: false };
  }

  async listChatReactions(workspaceId: string, sessionId: string, messageIds?: string[]) {
    const selected = messageIds ? new Set(messageIds) : null;
    return [...this.chatReactions.values()]
      .filter(
        (reaction) => reaction.workspaceId === workspaceId && reaction.sessionId === sessionId,
      )
      .filter((reaction) => !selected || selected.has(reaction.messageId))
      .map((reaction) => structuredClone(reaction));
  }

  async getChatActivitySummary(workspaceId: string, sessionId: string, since: Date) {
    const messages = [...this.chatMessages.values()].filter(
      (message) => message.workspaceId === workspaceId && message.sessionId === sessionId,
    );
    const contributorKeys = messages
      .filter((message) => message.status === "published")
      .map(
        (message) =>
          message.participantId ??
          (message.actorId ? `actor:${message.actorId}` : `staff:${message.staffCredentialId}`),
      );
    return {
      messagesLastMinute: messages.filter(
        (message) => message.status === "published" && message.createdAt >= since,
      ).length,
      uniqueContributors: new Set(contributorKeys).size,
      removedMessages: messages.filter((message) => message.status === "removed").length,
      reportCount: await this.countChatReports(workspaceId, sessionId),
    };
  }

  async listParticipantChatActivity(workspaceId: string, sessionId: string) {
    const activity = new Map<
      string,
      { participantId: string; messageCount: number; latestMessageAt: Date | null }
    >();
    for (const message of this.chatMessages.values()) {
      if (
        message.workspaceId !== workspaceId ||
        message.sessionId !== sessionId ||
        !message.participantId
      )
        continue;
      const current = activity.get(message.participantId) ?? {
        participantId: message.participantId,
        messageCount: 0,
        latestMessageAt: null,
      };
      current.messageCount += 1;
      if (!current.latestMessageAt || message.createdAt > current.latestMessageAt) {
        current.latestMessageAt = new Date(message.createdAt);
      }
      activity.set(message.participantId, current);
    }
    return [...activity.values()].map((record) => structuredClone(record));
  }

  private chatReactionSummary(messageId: string, participantId: string) {
    const records = [...this.chatReactions.values()].filter(
      (reaction) => reaction.messageId === messageId,
    );
    const counts: ChatReactionSummaryRecord["counts"] = {};
    for (const record of records) counts[record.reaction] = (counts[record.reaction] ?? 0) + 1;
    return {
      messageId,
      counts,
      viewerReaction:
        records.find((record) => record.participantId === participantId)?.reaction ?? null,
    };
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
    this.requireOpenInteractionSettings(input.workspaceId, input.sessionId);
    const existingEvent = this.findAudienceEvent(input.sessionId, eventInput.idempotencyKey);
    if (existingEvent) {
      return {
        record: this.chatReactionSummary(input.messageId, input.participantId),
        event: structuredClone(existingEvent),
        duplicate: true,
      };
    }
    const message = this.chatMessages.get(input.messageId);
    if (!message || message.sessionId !== input.sessionId) {
      throw new AudienceStoreError("NOT_FOUND", "Chat message not found");
    }
    if (message.status === "removed") {
      throw new AudienceStoreError("MESSAGE_REMOVED", "Removed messages cannot receive reactions");
    }
    const key = `${input.messageId}:${input.participantId}`;
    if (input.reaction) {
      this.chatReactions.set(key, {
        workspaceId: input.workspaceId,
        sessionId: input.sessionId,
        messageId: input.messageId,
        participantId: input.participantId,
        reaction: input.reaction,
        updatedAt: input.now,
      });
    } else this.chatReactions.delete(key);
    const event = this.allocateAudienceEvent(
      input.workspaceId,
      input.sessionId,
      eventInput,
      input.now,
    );
    return {
      record: this.chatReactionSummary(input.messageId, input.participantId),
      event: structuredClone(event),
      duplicate: false,
    };
  }

  async reportChatMessage(
    workspaceId: string,
    sessionId: string,
    messageId: string,
    participantId: string,
    now: Date,
    eventInput: AudienceEventInput,
  ): Promise<AudienceMutation<number>> {
    this.requireOpenInteractionSettings(workspaceId, sessionId);
    const existingEvent = this.findAudienceEvent(sessionId, eventInput.idempotencyKey);
    const prefix = `${messageId}:`;
    if (existingEvent) {
      return {
        record: [...this.chatReports].filter((key) => key.startsWith(prefix)).length,
        event: structuredClone(existingEvent),
        duplicate: true,
      };
    }
    const message = this.chatMessages.get(messageId);
    if (!message || message.workspaceId !== workspaceId || message.sessionId !== sessionId) {
      throw new AudienceStoreError("NOT_FOUND", "Chat message not found");
    }
    this.chatReports.add(`${messageId}:${participantId}`);
    const event = this.allocateAudienceEvent(workspaceId, sessionId, eventInput, now);
    return {
      record: [...this.chatReports].filter((key) => key.startsWith(prefix)).length,
      event: structuredClone(event),
      duplicate: false,
    };
  }

  async countChatReports(workspaceId: string, sessionId: string) {
    const messageIds = new Set(
      [...this.chatMessages.values()]
        .filter((message) => message.workspaceId === workspaceId && message.sessionId === sessionId)
        .map((message) => message.id),
    );
    return [...this.chatReports].filter((key) => messageIds.has(key.split(":", 1)[0]!)).length;
  }

  async getAudienceRestriction(workspaceId: string, sessionId: string, participantId: string) {
    const restriction = this.audienceRestrictions.get(`${sessionId}:${participantId}`);
    return restriction?.workspaceId === workspaceId ? structuredClone(restriction) : null;
  }

  async listAudienceRestrictions(workspaceId: string, sessionId: string) {
    return [...this.audienceRestrictions.values()]
      .filter(
        (restriction) =>
          restriction.workspaceId === workspaceId && restriction.sessionId === sessionId,
      )
      .map((restriction) => structuredClone(restriction));
  }

  async saveAudienceRestriction(
    input: AudienceRestrictionRecord,
    eventInput: AudienceEventInput,
  ): Promise<AudienceMutation<AudienceRestrictionRecord>> {
    this.requireOpenInteractionSettings(input.workspaceId, input.sessionId);
    const existingEvent = this.findAudienceEvent(input.sessionId, eventInput.idempotencyKey);
    const key = `${input.sessionId}:${input.participantId}`;
    const existing = this.audienceRestrictions.get(key);
    if (existingEvent && existing) {
      return {
        record: structuredClone(existing),
        event: structuredClone(existingEvent),
        duplicate: true,
      };
    }
    this.audienceRestrictions.set(key, structuredClone(input));
    const qnaBanKey = `${input.sessionId}:${input.participantId}`;
    if (input.bannedAt) this.qnaBans.add(qnaBanKey);
    else this.qnaBans.delete(qnaBanKey);
    const event = this.allocateAudienceEvent(
      input.workspaceId,
      input.sessionId,
      eventInput,
      input.updatedAt,
    );
    return { record: structuredClone(input), event: structuredClone(event), duplicate: false };
  }

  async claimAudienceOutbox(now: Date, staleBefore: Date) {
    const event = [...this.audienceOutbox.values()]
      .filter(
        (candidate) =>
          !candidate.deliveredAt &&
          (!candidate.claimedAt || candidate.claimedAt.getTime() < staleBefore.getTime()),
      )
      .sort(
        (left, right) =>
          left.createdAt.getTime() - right.createdAt.getTime() ||
          left.eventId.localeCompare(right.eventId),
      )[0];
    if (!event) return null;
    event.claimedAt = now;
    event.attempts += 1;
    return structuredClone(event);
  }

  async completeAudienceOutbox(eventId: string, deliveredAt: Date) {
    const event = this.audienceOutbox.get(eventId);
    if (!event) return false;
    event.deliveredAt = deliveredAt;
    event.claimedAt = null;
    return true;
  }

  async getAudienceOutboxStatus() {
    const pending = [...this.audienceOutbox.values()]
      .filter((event) => !event.deliveredAt)
      .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime());
    const now = new Date();
    const chatEnabledSessions = [...this.interactionSettings.values()].filter((settings) => {
      const session = this.sessions.get(settings.sessionId);
      return Boolean(
        settings.chatEnabled &&
        session &&
        session.state.phase !== "finished" &&
        session.expiresAt > now,
      );
    }).length;
    return {
      pending: pending.length,
      oldestCreatedAt: pending[0]?.createdAt ?? null,
      chatEnabledSessions,
    };
  }

  async getSessionEvidence(workspaceId: string, sessionId: string) {
    const session = this.sessions.get(sessionId);
    if (!session || session.workspaceId !== workspaceId) {
      return {
        decisionReplayEnabled: false,
        decisionEvents: [],
        decisionEventsComplete: false,
        answers: [],
        rounds: [],
        interventions: [],
        qna: { questions: 0, answered: 0, unresolved: 0 },
        interactions: {
          signalEvents: [],
          chatMessages: [],
          reactions: [],
          reports: 0,
          moderationActions: 0,
        },
      };
    }
    const qnaQuestions = [...this.qnaQuestions.values()].filter(
      (question) => question.workspaceId === workspaceId && question.sessionId === sessionId,
    );
    const decisionWrites = this.sessionDecisionEvents.get(sessionId) ?? [];
    const decisionEvents = decisionWrites.map((write) => structuredClone(write.event));
    const hasCapturedDecisionEvents = decisionEvents.some(
      (event) => event.type !== "capture_truncated",
    );
    const decisionEventsTruncated = decisionEvents.some(
      (event) => event.type === "capture_truncated",
    );
    return {
      decisionReplayEnabled: session.decisionReplayEnabled ?? false,
      decisionEvents,
      decisionEventsComplete:
        (session.decisionReplayEnabled ?? false) &&
        hasCapturedDecisionEvents &&
        !decisionEventsTruncated,
      answers: [...this.answers.entries()]
        .filter(([key]) => key.startsWith(`${sessionId}:`))
        .map(([, answer]) => structuredClone(answer)),
      rounds: Object.entries(session.state.rounds).map(([id, round]) => ({
        id,
        ...structuredClone(round),
      })),
      interventions: Object.values(session.state.interventions).map((intervention) =>
        structuredClone(intervention),
      ),
      qna: {
        questions: qnaQuestions.filter((question) => question.status !== "removed").length,
        answered: qnaQuestions.filter((question) => question.status === "answered").length,
        unresolved: qnaQuestions.filter((question) =>
          ["pending", "published"].includes(question.status),
        ).length,
      },
      interactions: {
        signalEvents: this.signalEvents
          .filter((event) => event.workspaceId === workspaceId && event.sessionId === sessionId)
          .map((event) => ({
            contextKey: event.contextKey,
            participantId: event.participantId,
            signal: event.signal,
            createdAt: new Date(event.createdAt),
          })),
        chatMessages: [...this.chatMessages.values()]
          .filter(
            (message) => message.workspaceId === workspaceId && message.sessionId === sessionId,
          )
          .map((message) => structuredClone(message)),
        reactions: [...this.chatReactions.values()]
          .filter(
            (reaction) => reaction.workspaceId === workspaceId && reaction.sessionId === sessionId,
          )
          .map((reaction) => structuredClone(reaction)),
        reports: await this.countChatReports(workspaceId, sessionId),
        moderationActions: [...this.audienceOutbox.values()].filter(
          (event) =>
            event.workspaceId === workspaceId &&
            event.sessionId === sessionId &&
            (event.type === "audience.moderation.updated" || event.type === "chat.message.removed"),
        ).length,
      },
    };
  }

  async findAnswers(workspaceId: string, sessionId: string, lookups: AnswerLookup[]) {
    const session = this.sessions.get(sessionId);
    if (!session || session.workspaceId !== workspaceId || lookups.length === 0) return [];
    return [...this.answers.entries()]
      .filter(
        ([key, answer]) =>
          key.startsWith(`${sessionId}:`) &&
          lookups.some(
            (lookup) =>
              lookup.idempotencyKey === answer.idempotencyKey ||
              (lookup.participantId === answer.participantId && lookup.roundId === answer.roundId),
          ),
      )
      .map(([, answer]) => structuredClone(answer));
  }

  async findParticipantIdsWithAnswers(
    workspaceId: string,
    sessionId: string,
    participantIds: string[],
  ) {
    const session = this.sessions.get(sessionId);
    if (!session || session.workspaceId !== workspaceId || participantIds.length === 0) return [];
    const requested = new Set(participantIds);
    return [
      ...new Set(
        [...this.answers.entries()]
          .filter(
            ([key, answer]) =>
              key.startsWith(`${sessionId}:`) && requested.has(answer.participantId),
          )
          .map(([, answer]) => answer.participantId),
      ),
    ];
  }

  async createMediaAsset(input: MediaAssetCreateInput) {
    if (this.workspaceMediaDeletionClaims.has(input.workspaceId)) {
      throw new Error("Workspace deletion is in progress");
    }
    const asset = {
      ...structuredClone(input),
      deletionStartedAt: input.deletionStartedAt ?? null,
      finalizedAt: input.finalizedAt ?? null,
    };
    this.mediaAssets.set(input.id, asset);
    return structuredClone(asset);
  }

  async getMediaAsset(workspaceId: string, mediaId: string) {
    const asset = this.mediaAssets.get(mediaId);
    return asset?.workspaceId === workspaceId ? structuredClone(asset) : null;
  }

  async listMediaAssets(workspaceId: string) {
    return [...this.mediaAssets.values()]
      .filter((asset) => asset.workspaceId === workspaceId)
      .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime())
      .map((asset) => structuredClone(asset));
  }

  async listMediaReferences(workspaceId: string, mediaId?: string) {
    return [...this.mediaReferences.values()]
      .filter(
        (reference) =>
          reference.workspaceId === workspaceId &&
          (mediaId === undefined || reference.mediaId === mediaId),
      )
      .sort(
        (left, right) =>
          left.createdAt.getTime() - right.createdAt.getTime() ||
          left.ownerType.localeCompare(right.ownerType) ||
          left.ownerId.localeCompare(right.ownerId),
      )
      .map((reference) => structuredClone(reference));
  }

  removeMediaReferencesForOwners(
    workspaceId: string,
    owners: Array<{ ownerType: MediaReferenceOwnerType; ownerId: string }>,
  ) {
    const ownerKeys = new Set(
      owners.map(({ ownerType, ownerId }) => `${workspaceId}:${ownerType}:${ownerId}`),
    );
    for (const key of ownerKeys) this.deletedMediaReferenceOwners.add(key);
    for (const [key, reference] of this.mediaReferences) {
      if (ownerKeys.has(`${reference.workspaceId}:${reference.ownerType}:${reference.ownerId}`))
        this.mediaReferences.delete(key);
    }
  }

  async replaceMediaReferences(
    workspaceId: string,
    ownerType: MediaReferenceOwnerType,
    ownerId: string,
    mediaIds: string[],
    createdAt = new Date(),
  ) {
    // A pending authoring save may resume after permanent deletion removed its owner.
    if (this.deletedMediaReferenceOwners.has(`${workspaceId}:${ownerType}:${ownerId}`)) return [];
    const uniqueMediaIds = [...new Set(mediaIds)];
    this.validateMediaReferences(workspaceId, uniqueMediaIds);
    for (const [key, reference] of this.mediaReferences) {
      if (
        reference.workspaceId === workspaceId &&
        reference.ownerType === ownerType &&
        reference.ownerId === ownerId
      ) {
        this.mediaReferences.delete(key);
      }
    }
    for (const mediaId of uniqueMediaIds) {
      const reference: MediaReferenceRecord = {
        workspaceId,
        mediaId,
        ownerType,
        ownerId,
        createdAt,
      };
      this.mediaReferences.set(`${workspaceId}:${mediaId}:${ownerType}:${ownerId}`, reference);
    }
    return this.listMediaReferences(workspaceId).then((references) =>
      references.filter(
        (reference) => reference.ownerType === ownerType && reference.ownerId === ownerId,
      ),
    );
  }

  validateMediaReferences(workspaceId: string, mediaIds: string[]) {
    const invalidMediaId = [...new Set(mediaIds)].find((mediaId) => {
      const asset = this.mediaAssets.get(mediaId);
      return !asset || asset.workspaceId !== workspaceId || asset.scanStatus === "deleting";
    });
    if (invalidMediaId) {
      throw new Error(`Media asset ${invalidMediaId} is unavailable in this workspace`);
    }
  }

  async listStaleMedia(cutoff: Date, limit = 100) {
    return [...this.mediaAssets.values()]
      .filter(
        (asset) =>
          (asset.scanStatus === "deleting" ||
            (asset.scanStatus !== "clean" && asset.createdAt <= cutoff)) &&
          ![...this.mediaReferences.values()].some(
            (reference) =>
              reference.workspaceId === asset.workspaceId && reference.mediaId === asset.id,
          ),
      )
      .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime())
      .slice(0, limit)
      .map((asset) => structuredClone(asset));
  }

  async listUnattachedMedia(cutoff: Date, limit = 100) {
    return [...this.mediaAssets.values()]
      .filter(
        (asset) =>
          asset.createdAt <= cutoff &&
          ![...this.mediaReferences.values()].some(
            (reference) =>
              reference.workspaceId === asset.workspaceId && reference.mediaId === asset.id,
          ),
      )
      .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime())
      .slice(0, limit)
      .map((asset) => structuredClone(asset));
  }

  async claimMediaObjectCleanupCandidates(now: Date, limit = 100) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new Error("Media cleanup batch limit must be between 1 and 100");
    }
    const claimToken = crypto.randomUUID();
    return [...this.mediaAssets.values()]
      .filter((asset) => {
        const state = this.mediaObjectCleanup.get(asset.id);
        return (
          asset.scanStatus === "clean" &&
          asset.finalizedAt !== null &&
          state !== undefined &&
          state.pass < 2 &&
          state.dueAt !== null &&
          state.dueAt <= now &&
          (state.claimToken === null ||
            (state.claimedAt !== null && now.getTime() - state.claimedAt.getTime() >= 5 * 60_000))
        );
      })
      .sort((left, right) => {
        const leftDueAt = this.mediaObjectCleanup.get(left.id)!.dueAt!;
        const rightDueAt = this.mediaObjectCleanup.get(right.id)!.dueAt!;
        return leftDueAt.getTime() - rightDueAt.getTime() || left.id.localeCompare(right.id);
      })
      .slice(0, limit)
      .map((asset): MediaObjectCleanupClaim => {
        const state = this.mediaObjectCleanup.get(asset.id)!;
        state.claimToken = claimToken;
        state.claimedAt = new Date(now);
        return { asset: structuredClone(asset), pass: state.pass as 0 | 1, claimToken };
      });
  }

  async completeMediaObjectCleanupClaim(claim: MediaObjectCleanupClaim, completedAt: Date) {
    const { asset: claimedAsset, pass, claimToken } = claim;
    const asset = this.mediaAssets.get(claimedAsset.id);
    const state = this.mediaObjectCleanup.get(claimedAsset.id);
    if (
      !asset ||
      !state ||
      !asset.finalizedAt ||
      !claimedAsset.finalizedAt ||
      asset.workspaceId !== claimedAsset.workspaceId ||
      asset.scanStatus !== "clean" ||
      asset.objectKey !== claimedAsset.objectKey ||
      asset.finalizedAt.getTime() !== claimedAsset.finalizedAt.getTime() ||
      state.pass !== pass ||
      state.claimToken !== claimToken
    ) {
      return false;
    }
    state.pass = pass === 0 ? 1 : 2;
    state.dueAt =
      pass === 0
        ? new Date(
            Math.max(
              asset.finalizedAt.getTime() + 6 * 24 * 60 * 60_000,
              completedAt.getTime() + 60 * 60_000,
            ),
          )
        : null;
    state.claimToken = null;
    state.claimedAt = null;
    return true;
  }

  async renewMediaObjectCleanupClaim(claim: MediaObjectCleanupClaim, renewedAt: Date) {
    const { asset: claimedAsset, pass, claimToken } = claim;
    const asset = this.mediaAssets.get(claimedAsset.id);
    const state = this.mediaObjectCleanup.get(claimedAsset.id);
    if (
      !asset ||
      !state ||
      !asset.finalizedAt ||
      !claimedAsset.finalizedAt ||
      asset.workspaceId !== claimedAsset.workspaceId ||
      asset.scanStatus !== "clean" ||
      asset.objectKey !== claimedAsset.objectKey ||
      asset.finalizedAt.getTime() !== claimedAsset.finalizedAt.getTime() ||
      state.pass !== pass ||
      state.claimToken !== claimToken
    ) {
      return false;
    }
    state.claimedAt = new Date(renewedAt);
    return true;
  }

  async deferMediaObjectCleanupClaim(claim: MediaObjectCleanupClaim, retryAt: Date) {
    const { asset: claimedAsset, pass, claimToken } = claim;
    const asset = this.mediaAssets.get(claimedAsset.id);
    const state = this.mediaObjectCleanup.get(claimedAsset.id);
    if (
      !asset ||
      !state ||
      !asset.finalizedAt ||
      !claimedAsset.finalizedAt ||
      asset.workspaceId !== claimedAsset.workspaceId ||
      asset.scanStatus !== "clean" ||
      asset.objectKey !== claimedAsset.objectKey ||
      asset.finalizedAt.getTime() !== claimedAsset.finalizedAt.getTime() ||
      state.pass !== pass ||
      state.claimToken !== claimToken
    ) {
      return false;
    }
    state.dueAt = new Date(retryAt);
    state.claimToken = null;
    state.claimedAt = null;
    return true;
  }

  async completeInlineMediaObjectCleanup(asset: MediaAssetRecord, completedAt: Date) {
    const current = this.mediaAssets.get(asset.id);
    const state = this.mediaObjectCleanup.get(asset.id);
    if (
      !current ||
      !state ||
      !asset.finalizedAt ||
      !current.finalizedAt ||
      current.workspaceId !== asset.workspaceId ||
      current.scanStatus !== "clean" ||
      current.objectKey !== asset.objectKey ||
      current.finalizedAt.getTime() !== asset.finalizedAt.getTime() ||
      state.pass !== 0 ||
      state.claimToken !== null
    ) {
      return false;
    }
    state.pass = 1;
    state.dueAt = new Date(
      Math.max(
        current.finalizedAt.getTime() + 6 * 24 * 60 * 60_000,
        completedAt.getTime() + 60 * 60_000,
      ),
    );
    return true;
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
    const asset = this.mediaAssets.get(mediaId);
    const lease = this.mediaFinalizationLeases.get(mediaId);
    if (
      !asset ||
      asset.workspaceId !== workspaceId ||
      asset.scanStatus !== "finalizing" ||
      lease?.token !== update.finalizationToken
    ) {
      return null;
    }
    asset.scanStatus = update.scanStatus;
    asset.deletionStartedAt = null;
    asset.finalizedAt = new Date(update.finalizedAt);
    if (update.objectKey) asset.objectKey = update.objectKey;
    this.mediaFinalizationLeases.delete(mediaId);
    if (update.scanStatus === "clean") {
      this.mediaObjectCleanup.set(mediaId, {
        pass: 0,
        dueAt: new Date(update.finalizedAt),
        claimToken: null,
        claimedAt: null,
      });
    } else {
      this.mediaObjectCleanup.delete(mediaId);
    }
    return structuredClone(asset);
  }

  async claimMediaAssetFinalization(
    workspaceId: string,
    mediaId: string,
    finalizationToken: string,
    claimedAt = new Date(),
  ) {
    const asset = this.mediaAssets.get(mediaId);
    if (!asset || asset.workspaceId !== workspaceId) return null;
    const lease = this.mediaFinalizationLeases.get(mediaId);
    const leaseExpired =
      asset.scanStatus === "finalizing" &&
      (!lease || claimedAt.getTime() - lease.startedAt.getTime() >= 5 * 60_000);
    if (asset.scanStatus !== "pending" && !leaseExpired) return null;
    asset.scanStatus = "finalizing";
    asset.deletionStartedAt = null;
    this.mediaFinalizationLeases.set(mediaId, {
      token: finalizationToken,
      startedAt: new Date(claimedAt),
    });
    return structuredClone(asset);
  }

  async releaseMediaAssetFinalization(
    workspaceId: string,
    mediaId: string,
    finalizationToken: string,
  ) {
    const asset = this.mediaAssets.get(mediaId);
    const lease = this.mediaFinalizationLeases.get(mediaId);
    if (
      !asset ||
      asset.workspaceId !== workspaceId ||
      asset.scanStatus !== "finalizing" ||
      lease?.token !== finalizationToken
    ) {
      return false;
    }
    asset.scanStatus = "pending";
    asset.deletionStartedAt = null;
    this.mediaFinalizationLeases.delete(mediaId);
    return true;
  }

  async claimMediaAssetDeletion(workspaceId: string, mediaId: string, now = new Date()) {
    const asset = this.mediaAssets.get(mediaId);
    if (!asset || asset.workspaceId !== workspaceId) return null;
    if (
      [...this.mediaReferences.values()].some(
        (reference) => reference.workspaceId === workspaceId && reference.mediaId === mediaId,
      )
    ) {
      return null;
    }
    const lease = this.mediaFinalizationLeases.get(mediaId);
    if (
      asset.scanStatus === "finalizing" &&
      lease &&
      now.getTime() - lease.startedAt.getTime() < 5 * 60_000
    ) {
      return null;
    }
    if (asset.scanStatus !== "deleting") {
      asset.scanStatus = "deleting";
      asset.deletionStartedAt = new Date(now);
    }
    this.mediaFinalizationLeases.delete(mediaId);
    this.mediaObjectCleanup.delete(mediaId);
    return structuredClone(asset);
  }

  async claimWorkspaceMediaDeletion(workspaceId: string, now = new Date()) {
    this.workspaceMediaDeletionClaims.add(workspaceId);
    const claimed = [...this.mediaAssets.values()]
      .filter((asset) => asset.workspaceId === workspaceId)
      .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime());
    if (claimed.length > 0 && !this.workspaceMediaDeletionJobs.has(workspaceId)) {
      this.workspaceMediaDeletionJobs.set(workspaceId, {
        workspaceId,
        deletionStartedAt: new Date(now),
        sweepAfter: new Date(now.getTime() + MEDIA_DELETION_TOMBSTONE_HOLD_MS),
      });
    }
    for (const asset of claimed) {
      if (asset.scanStatus !== "deleting") {
        asset.scanStatus = "deleting";
        asset.deletionStartedAt = new Date(now);
      }
      this.mediaFinalizationLeases.delete(asset.id);
      this.mediaObjectCleanup.delete(asset.id);
    }
    return claimed.map((asset) => structuredClone(asset));
  }

  async listDueWorkspaceMediaDeletionJobs(now: Date, limit = 100) {
    return [...this.workspaceMediaDeletionJobs.values()]
      .filter((job) => job.sweepAfter <= now)
      .sort(
        (left, right) =>
          left.sweepAfter.getTime() - right.sweepAfter.getTime() ||
          left.workspaceId.localeCompare(right.workspaceId),
      )
      .slice(0, limit)
      .map((job) => structuredClone(job));
  }

  async completeWorkspaceMediaDeletionJob(workspaceId: string, deletionStartedAt: Date) {
    const job = this.workspaceMediaDeletionJobs.get(workspaceId);
    if (!job || job.deletionStartedAt.getTime() !== deletionStartedAt.getTime()) return false;
    return this.workspaceMediaDeletionJobs.delete(workspaceId);
  }

  async deleteMediaAsset(workspaceId: string, mediaId: string, now = new Date()) {
    const asset = this.mediaAssets.get(mediaId);
    if (
      !asset ||
      asset.workspaceId !== workspaceId ||
      asset.scanStatus !== "deleting" ||
      !asset.deletionStartedAt ||
      now.getTime() - asset.deletionStartedAt.getTime() < MEDIA_DELETION_TOMBSTONE_HOLD_MS
    ) {
      return false;
    }
    if (
      [...this.mediaReferences.values()].some(
        (reference) => reference.workspaceId === workspaceId && reference.mediaId === mediaId,
      )
    ) {
      return false;
    }
    this.mediaFinalizationLeases.delete(mediaId);
    this.mediaObjectCleanup.delete(mediaId);
    return this.mediaAssets.delete(mediaId);
  }

  async persistAnswer(_workspaceId: string, sessionId: string, answer: EngineAnswer) {
    const duplicate = [...this.answers.values()].find(
      (candidate) =>
        candidate.idempotencyKey === answer.idempotencyKey ||
        (candidate.roundId === answer.roundId && candidate.participantId === answer.participantId),
    );
    if (duplicate) return structuredClone(duplicate);
    this.answers.set(`${sessionId}:${answer.answerId}`, structuredClone(answer));
    return structuredClone(answer);
  }

  async commitAnswer(session: StoredSession, answer: EngineAnswer, expectedVersion: number) {
    return (await this.commitAnswers(session, [answer], expectedVersion))[0]!;
  }

  async commitAnswers(
    session: StoredSession,
    answers: EngineAnswer[],
    expectedVersion: number,
    _options: { roundEvidencePersisted?: boolean } = {},
  ) {
    if (this.workspaceMediaDeletionClaims.has(session.workspaceId)) {
      throw new WorkspaceDeletionInProgressError(session.workspaceId);
    }
    const current = this.sessions.get(session.id);
    if (!current || current.state.version !== expectedVersion) {
      throw new SessionVersionConflictError(session.id, expectedVersion);
    }
    const persisted: EngineAnswer[] = [];
    const staged = new Map<string, EngineAnswer>();
    for (const answer of answers) {
      const result = [...this.answers.values(), ...staged.values()].find(
        (candidate) =>
          candidate.idempotencyKey === answer.idempotencyKey ||
          (candidate.roundId === answer.roundId &&
            candidate.participantId === answer.participantId),
      );
      const committed = result ?? structuredClone(answer);
      if (!result) staged.set(`${session.id}:${answer.answerId}`, committed);
      persisted.push(committed);
    }
    if (persisted.some((answer, index) => answer.answerId !== answers[index]?.answerId)) {
      throw new Error("Answer state changed during persistence");
    }
    for (const [key, answer] of staged) this.answers.set(key, answer);
    if (staged.size > 0) {
      this.sessions.set(session.id, structuredClone({ ...session, updatedAt: new Date() }));
    }
    return persisted;
  }

  async saveReport(_workspaceId: string, report: Report) {
    const prior = [...this.reports.entries()].find(
      ([id, candidate]) => id !== report.id && candidate.sessionId === report.sessionId,
    );
    const createdAt = prior ? (this.reportCreatedAt.get(prior[0]) ?? new Date()) : new Date();
    if (prior) {
      this.reports.delete(prior[0]);
      this.reportJobs.delete(prior[0]);
      this.reportCreatedAt.delete(prior[0]);
    }
    this.reports.set(report.id, structuredClone(report));
    if (!this.reportCreatedAt.has(report.id)) this.reportCreatedAt.set(report.id, createdAt);
    if (report.status === "pending") {
      this.reportJobs.set(report.id, {
        workspaceId: _workspaceId,
        attempts: 0,
        availableAt: new Date(0),
        lastError: null,
      });
    } else {
      this.reportJobs.delete(report.id);
    }
  }

  async claimReportJob(now: Date, leaseUntil: Date) {
    const candidate = [...this.reportJobs.entries()]
      .filter(([id, job]) => this.reports.get(id)?.status === "pending" && job.availableAt <= now)
      .sort((left, right) => left[1].availableAt.getTime() - right[1].availableAt.getTime())[0];
    if (!candidate) return null;
    const [reportId, metadata] = candidate;
    const report = this.reports.get(reportId)!;
    metadata.attempts += 1;
    metadata.availableAt = leaseUntil;
    return {
      reportId,
      workspaceId: metadata.workspaceId,
      sessionId: report.sessionId,
      attempts: metadata.attempts,
      expiresAt: new Date(report.expiresAt),
    };
  }

  async completeReportJob(job: ReportJob, report: Report) {
    if (job.reportId !== report.id || job.sessionId !== report.sessionId) {
      throw new Error("Completed report does not match the claimed job");
    }
    this.reports.set(report.id, structuredClone(report));
    if (!this.reportCreatedAt.has(report.id)) this.reportCreatedAt.set(report.id, new Date());
    this.reportJobs.delete(report.id);
  }

  async retryReportJob(job: ReportJob, error: string, availableAt: Date, failed: boolean) {
    const report = this.reports.get(job.reportId);
    const metadata = this.reportJobs.get(job.reportId);
    if (!report || !metadata) return;
    metadata.lastError = error;
    metadata.availableAt = availableAt;
    if (failed) {
      this.reports.set(job.reportId, { ...report, status: "failed" });
      this.reportJobs.delete(job.reportId);
    }
  }

  async getReport(workspaceId: string, reportId: string) {
    const report = this.reports.get(reportId);
    const session = report ? this.sessions.get(report.sessionId) : undefined;
    return report && session?.workspaceId === workspaceId
      ? ReportSchema.parse(structuredClone(report))
      : null;
  }

  async getReportBySession(workspaceId: string, sessionId: string) {
    const session = this.sessions.get(sessionId);
    if (!session || session.workspaceId !== workspaceId) return null;
    const report = [...this.reports.values()].find(
      (candidate) => candidate.sessionId === sessionId,
    );
    return report ? ReportSchema.parse(structuredClone(report)) : null;
  }

  async listQuestionHealthObservationReports(
    workspaceId: string,
    quizId: string,
    quizVersionId: string,
    now: Date,
  ) {
    const limit = QUESTION_HEALTH_POST_USE_MAX_REPORTS;
    const newest: Array<{ report: Report; session: StoredSession }> = [];
    const retainedReportLimit = limit + 1;
    let retainedReportCount = 0;

    for (const report of this.reports.values()) {
      if (report.status !== "ready" || !report.generatedAt) continue;
      const session = this.sessions.get(report.sessionId);
      if (
        !session ||
        session.workspaceId !== workspaceId ||
        session.quizVersionId !== quizVersionId ||
        session.retentionExpiresAt <= now
      ) {
        continue;
      }
      const version = this.versions.get(session.quizVersionId);
      if (!version || version.workspaceId !== workspaceId || version.quizId !== quizId) continue;

      retainedReportCount += 1;
      const candidate = { report, session };
      const insertAt = newest.findIndex((existing) => {
        const dateOrder =
          Date.parse(report.generatedAt!) - Date.parse(existing.report.generatedAt!);
        return dateOrder > 0 || (dateOrder === 0 && report.id > existing.report.id);
      });
      if (insertAt < 0) {
        if (newest.length < retainedReportLimit) newest.push(candidate);
      } else {
        newest.splice(insertAt, 0, candidate);
        if (newest.length > retainedReportLimit) newest.pop();
      }
    }

    return {
      hasMoreReports: retainedReportCount > limit,
      reports: newest.slice(0, limit).map(({ report, session }) => ({
        trustMode: session.trustMode ?? report.trustMode ?? "learning",
        timeMode: report.timeMode ?? session.state.settings.timeMode ?? "timed",
        scoringMode: session.state.settings.scoringMode,
        questions: report.questions.map((question) => {
          const distribution = question.responseDistribution;
          return {
            questionId: question.questionId,
            responses: question.responses,
            correct: question.correct,
            ...(distribution?.kind === "choice"
              ? {
                  responseDistribution: {
                    kind: "choice" as const,
                    buckets: distribution.buckets.flatMap((bucket) =>
                      typeof bucket.value === "string"
                        ? [{ value: bucket.value, count: bucket.count }]
                        : [],
                    ),
                  },
                }
              : {}),
          };
        }),
      })),
    };
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
    const records = [...this.reports.values()]
      .flatMap((report): ReportHistoryRecord[] => {
        const session = this.sessions.get(report.sessionId);
        if (!session || session.workspaceId !== workspaceId) return [];
        const version = this.versions.get(session.quizVersionId);
        if (!version) return [];
        const quiz = this.quizzes.get(version.quizId);
        if (!quiz) return [];
        const recovery = "recovery" in report ? report.recovery : [];
        const recovered = recovery.reduce((sum, item) => sum + item.recovered, 0);
        const eligible = recovery.reduce((sum, item) => sum + item.initiallyIncorrectWithBoth, 0);
        const followup = [...this.followups.values()].find(
          (candidate) => candidate.sourceReportId === report.id,
        );
        const followupStatus: ReportHistoryRecord["followupStatus"] = !followup
          ? null
          : followup.expiresAt <= options.now
            ? "expired"
            : followup.closedAt || followup.closesAt <= options.now
              ? "closed"
              : followup.opensAt > options.now
                ? "scheduled"
                : "open";
        return [
          {
            id: report.id,
            sessionId: report.sessionId,
            trustMode: report.trustMode ?? session.trustMode ?? "learning",
            quizId: version.quizId,
            title: session.state.quiz.title,
            status: report.status,
            participantCount: report.metrics.participantCount,
            initialAccuracyPercent:
              "initialAccuracy" in report
                ? report.initialAccuracy.percent
                : report.metrics.accuracyPercent,
            recovery: {
              recovered,
              eligible,
              percent:
                eligible > 0
                  ? Math.min(100, Math.round((recovered / eligible) * 10_000) / 100)
                  : null,
            },
            unresolvedConceptCount:
              "unresolvedConcepts" in report
                ? report.unresolvedConcepts.filter((concept) => concept.unresolved > 0).length
                : 0,
            interventionCount: "interventions" in report ? report.interventions.length : 0,
            followupId: followup?.id ?? null,
            followupStatus,
            generatedAt: report.generatedAt ? new Date(report.generatedAt) : null,
            createdAt: new Date(this.reportCreatedAt.get(report.id) ?? session.updatedAt),
            expiresAt: new Date(report.expiresAt),
          },
        ];
      })
      .filter((item) => !options.status || item.status === options.status)
      .filter((item) => !options.quizId || item.quizId === options.quizId)
      .filter((item) => !options.from || item.createdAt.getTime() >= options.from.getTime())
      .filter((item) => !options.to || item.createdAt.getTime() <= options.to.getTime())
      .filter(
        (item) =>
          !options.cursor ||
          item.createdAt.getTime() < options.cursor.createdAt.getTime() ||
          (item.createdAt.getTime() === options.cursor.createdAt.getTime() &&
            item.id < options.cursor.id),
      )
      .sort(
        (left, right) =>
          right.createdAt.getTime() - left.createdAt.getTime() || right.id.localeCompare(left.id),
      );
    return {
      items: structuredClone(records.slice(0, options.limit)),
      hasMore: records.length > options.limit,
    };
  }

  private storeFollowup(input: FollowupRecord, access: FollowupAccessRecord[]) {
    if (!input.recoveryPackSource && input.recoveryPackSequence != null)
      throw new TypeError("Only full-sequence Pack practice can contain interventions");
    if (this.followups.has(input.id)) throw new Error("Follow-up already exists");
    if (
      [...this.followups.values()].some((item) => item.genericTokenHash === input.genericTokenHash)
    ) {
      throw new Error("Duplicate follow-up token");
    }
    if (
      input.purpose === "recovery" &&
      [...this.followups.values()].some(
        (item) => item.purpose === "recovery" && item.sourceReportId === input.sourceReportId,
      )
    ) {
      throw new Error("A follow-up already exists for this report");
    }
    const version = input.sourceQuizVersionId
      ? this.versions.get(input.sourceQuizVersionId)
      : undefined;
    if (!input.recoveryPackSource && (!version || version.workspaceId !== input.workspaceId)) {
      throw new Error("Follow-up source version does not exist");
    }
    if (input.purpose === "recovery") {
      const session = this.sessions.get(input.sourceSessionId);
      const report = this.reports.get(input.sourceReportId);
      if (
        !session ||
        session.workspaceId !== input.workspaceId ||
        session.quizVersionId !== input.sourceQuizVersionId ||
        !report ||
        report.sessionId !== input.sourceSessionId
      ) {
        throw new Error("Follow-up source does not exist");
      }
      if (input.conceptKeys.length < 1 || input.conceptKeys.length > 12) {
        throw new Error("Recovery follow-ups require concepts");
      }
    } else {
      if (input.sourceSessionId !== null || input.sourceReportId !== null) {
        throw new Error("Practice assignments cannot reference a session or report");
      }
      if (input.conceptKeys.length !== 0) {
        throw new Error("Practice assignments cannot store recovery concepts");
      }
    }
    const accessTokenHashes = new Set<string>();
    for (const item of access) {
      if (this.followupAccess.has(item.tokenHash) || accessTokenHashes.has(item.tokenHash)) {
        throw new Error("Duplicate follow-up token");
      }
      accessTokenHashes.add(item.tokenHash);
      this.assertFollowupAccess(input, item);
    }
    const mediaIds = input.recoveryPackSource ? quizMediaIds(input.content) : [];
    this.validateMediaReferences(input.workspaceId, mediaIds);
    this.followups.set(input.id, structuredClone(input));
    for (const mediaId of mediaIds) {
      this.mediaReferences.set(`${input.workspaceId}:${mediaId}:followup:${input.id}`, {
        workspaceId: input.workspaceId,
        mediaId,
        ownerType: "followup",
        ownerId: input.id,
        createdAt: input.createdAt,
      });
    }
    for (const item of access) {
      this.followupAccess.set(item.tokenHash, structuredClone(item));
    }
  }

  async createFollowup(input: FollowupRecord, access: FollowupAccessRecord[]) {
    if (input.purpose !== "recovery") {
      throw new TypeError("Practice assignments require atomic source validation");
    }
    this.storeFollowup(input, access);
  }

  async createPracticeAssignment(
    sourceQuizId: string,
    input: Extract<FollowupRecord, { purpose: "assignment" }>,
    access: FollowupAccessRecord[],
  ) {
    if (input.recoveryPackSource || input.creationMutation || input.sourceQuizVersionId === null)
      throw new TypeError("Round practice requires a Round source");
    const quiz = this.quizzes.get(sourceQuizId);
    if (
      !quiz ||
      quiz.workspaceId !== input.workspaceId ||
      quiz.status !== "published" ||
      quiz.currentVersionId !== input.sourceQuizVersionId
    ) {
      return false;
    }
    this.storeFollowup(input, access);
    return true;
  }

  async getRecoveryPackPracticeAssignment(
    workspaceId: string,
    packId: string,
    mutationId: string,
    requestHash: string,
  ) {
    const record = this.findRecoveryPackPracticeReceipt(workspaceId, mutationId);
    return record
      ? matchRecoveryPackPracticeReceipt(record, packId, mutationId, requestHash)
      : null;
  }

  private findRecoveryPackPracticeReceipt(workspaceId: string, mutationId: string) {
    return [...this.followups.values()].find(
      (record) =>
        record.workspaceId === workspaceId && record.creationMutation?.mutationId === mutationId,
    );
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
    const packs = createRecoveryPackRepository(this) as MemoryRecoveryPackRepository;
    return packs.withPracticeCreationLock(input.workspaceId, async () => {
      const replay = this.findRecoveryPackPracticeReceipt(input.workspaceId, receipt.mutationId);
      if (replay)
        return {
          followup: matchRecoveryPackPracticeReceipt(
            replay,
            packId,
            receipt.mutationId,
            receipt.requestHash,
          ),
          created: false,
          productEvent: null,
        };
      this.assertWorkspaceLiveSessionCreationAllowed(input.workspaceId);
      if (!this.workspaces.has(input.workspaceId)) return null;
      const pack = packs.packs.get(packId);
      const version = packs.versions.get(source.packVersionId);
      if (
        !pack ||
        pack.workspaceId !== input.workspaceId ||
        source.packId !== packId ||
        pack.currentVersionId !== source.packVersionId ||
        !version ||
        version.workspaceId !== input.workspaceId ||
        !recoveryPackPracticeSourceMatches(input, version)
      )
        return null;
      const { audit, productEvent } = recoveryPackPracticeCreationEvidence(
        input,
        access.length,
        context,
      );
      const stagedAudit: AuditEventRecord[] = [];
      const stagedEvents: ProductEventRecord[] = [];
      await this.recordAudit(audit, stagedAudit, audit.createdAt, audit.id);
      await this.recordProductEvents([productEvent], stagedEvents);
      // Deletion can begin while a memory insertion hook is pending; never publish a partial receipt.
      this.assertWorkspaceLiveSessionCreationAllowed(input.workspaceId);
      if (!this.workspaces.has(input.workspaceId)) return null;
      this.storeFollowup(input, access);
      this.audits.push(...stagedAudit);
      this.productEvents.push(...stagedEvents);
      return {
        followup: structuredClone(input),
        created: true,
        productEvent: structuredClone(productEvent),
      };
    });
  }

  private assertFollowupAccess(followup: FollowupRecord, input: FollowupAccessRecord) {
    if (input.workspaceId !== followup.workspaceId || input.followupId !== followup.id) {
      throw new Error("Follow-up access must belong to the follow-up workspace");
    }
    if (input.kind === "personal") {
      const participant = [...this.participants.values()].find(
        (candidate) => candidate.id === input.sourceParticipantId,
      );
      if (
        followup.purpose !== "recovery" ||
        !participant ||
        participant.sessionId !== followup.sourceSessionId ||
        input.timeMultiplier !== 1
      ) {
        throw new Error("Follow-up participant must belong to the source session");
      }
      return;
    }
    if (input.kind === "assignment_personal") {
      if (
        followup.purpose !== "assignment" ||
        input.sourceParticipantId !== null ||
        input.timeMultiplier !== 1 ||
        input.label.length < 1 ||
        input.label.length > 80
      ) {
        throw new Error("Assignment personal access is invalid");
      }
      return;
    }
    if (
      input.sourceParticipantId !== null ||
      (input.timeMultiplier !== 1.5 && input.timeMultiplier !== 2)
    ) {
      throw new Error("Accommodation access is invalid");
    }
  }

  async getFollowup(workspaceId: string, followupId: string) {
    const followup = this.followups.get(followupId);
    return followup?.workspaceId === workspaceId ? structuredClone(followup) : null;
  }

  async getFollowupProgress(workspaceId: string, followupId: string) {
    if ((await this.getFollowup(workspaceId, followupId)) === null) return null;
    const attempts = [...this.followupAttempts.values()].filter(
      (attempt) => attempt.followupId === followupId,
    );
    return {
      attemptCount: attempts.length,
      completedAttemptCount: attempts.filter((attempt) => attempt.status === "completed").length,
    };
  }

  async getFollowupByReport(workspaceId: string, reportId: string) {
    const followup = [...this.followups.values()].find(
      (candidate) => candidate.workspaceId === workspaceId && candidate.sourceReportId === reportId,
    );
    return followup ? structuredClone(followup) : null;
  }

  async listFollowupHistory(workspaceId: string, options: FollowupHistoryListOptions) {
    const records = [...this.followups.values()]
      .filter((followup) => followup.workspaceId === workspaceId)
      .filter((followup) => !options.purpose || followup.purpose === options.purpose)
      .flatMap((followup): FollowupHistoryRecord[] => {
        const version = followup.sourceQuizVersionId
          ? this.versions.get(followup.sourceQuizVersionId)
          : undefined;
        if (
          (!version && !followup.recoveryPackSource) ||
          (options.quizId && version?.quizId !== options.quizId)
        )
          return [];
        const attempts = [...this.followupAttempts.values()].filter(
          (attempt) => attempt.followupId === followup.id,
        );
        const status: FollowupHistoryRecord["status"] =
          followup.expiresAt <= options.now
            ? "expired"
            : followup.closedAt || followup.closesAt <= options.now
              ? "closed"
              : followup.opensAt > options.now
                ? "scheduled"
                : "open";
        const source =
          followup.purpose === "assignment"
            ? ({
                purpose: "assignment" as const,
                sourceSessionId: null,
                sourceReportId: null,
              } as const)
            : ({
                purpose: "recovery" as const,
                sourceSessionId: followup.sourceSessionId,
                sourceReportId: followup.sourceReportId,
              } as const);
        return [
          {
            id: followup.id,
            ...source,
            quizId: version?.quizId ?? null,
            sourceQuizVersionId: followup.sourceQuizVersionId,
            recoveryPackSource: followup.recoveryPackSource ?? null,
            trustMode: followup.trustMode ?? "learning",
            title: followup.title,
            status,
            conceptKeys: [...followup.conceptKeys],
            checkpointCount: followup.content.questions.length,
            attemptCount: attempts.length,
            completedAttemptCount: attempts.filter((attempt) => attempt.status === "completed")
              .length,
            opensAt: new Date(followup.opensAt),
            closesAt: new Date(followup.closesAt),
            expiresAt: new Date(followup.expiresAt),
            createdAt: new Date(followup.createdAt),
          } as FollowupHistoryRecord,
        ];
      })
      .filter((item) => !options.status || item.status === options.status)
      .filter((item) => !options.from || item.createdAt.getTime() >= options.from.getTime())
      .filter((item) => !options.to || item.createdAt.getTime() <= options.to.getTime())
      .filter(
        (item) =>
          !options.cursor ||
          item.createdAt.getTime() < options.cursor.createdAt.getTime() ||
          (item.createdAt.getTime() === options.cursor.createdAt.getTime() &&
            item.id < options.cursor.id),
      )
      .sort(
        (left, right) =>
          right.createdAt.getTime() - left.createdAt.getTime() || right.id.localeCompare(left.id),
      );
    return {
      items: structuredClone(records.slice(0, options.limit)),
      hasMore: records.length > options.limit,
    };
  }

  async getFollowupByGenericToken(followupId: string, tokenHash: string, now: Date) {
    const followup = this.followups.get(followupId);
    return followup && followup.genericTokenHash === tokenHash && followup.expiresAt > now
      ? structuredClone(followup)
      : null;
  }

  async getFollowupAccessByToken(followupId: string, tokenHash: string, now: Date) {
    const access = this.followupAccess.get(tokenHash);
    return access && access.followupId === followupId && !access.revokedAt && access.expiresAt > now
      ? structuredClone(access)
      : null;
  }

  async listFollowupAccess(workspaceId: string, followupId: string) {
    if ((await this.getFollowup(workspaceId, followupId)) === null) return [];
    return [...this.followupAccess.values()]
      .filter((item) => item.followupId === followupId)
      .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime())
      .map((item) => structuredClone(item));
  }

  async createFollowupAccess(input: FollowupAccessRecord) {
    const followup = this.followups.get(input.followupId);
    if (!followup || followup.workspaceId !== input.workspaceId) {
      throw new Error("Follow-up not found");
    }
    if (this.followupAccess.has(input.tokenHash)) throw new Error("Duplicate follow-up token");
    this.assertFollowupAccess(followup, input);
    this.followupAccess.set(input.tokenHash, structuredClone(input));
    return structuredClone(input);
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
    const followup = this.followups.get(input.followupId);
    if (
      !followup ||
      followup.workspaceId !== input.workspaceId ||
      followup.purpose !== "assignment" ||
      followup.closedAt !== null ||
      followup.closesAt <= input.createdAt
    ) {
      return null;
    }
    const count = [...this.followupAccess.values()].filter(
      (access) => access.followupId === input.followupId && access.kind === "assignment_personal",
    ).length;
    if (count >= maximumLinks) {
      throw new FollowupAccessLimitError(input.followupId, maximumLinks);
    }
    if (this.followupAccess.has(input.tokenHash)) throw new Error("Duplicate follow-up token");
    this.assertFollowupAccess(followup, input);
    this.followupAccess.set(input.tokenHash, structuredClone(input));
    return structuredClone(input);
  }

  async revokeFollowupAccess(
    workspaceId: string,
    followupId: string,
    accessId: string,
    revokedAt: Date,
  ) {
    const item = [...this.followupAccess.values()].find(
      (candidate) =>
        candidate.workspaceId === workspaceId &&
        candidate.followupId === followupId &&
        candidate.id === accessId,
    );
    if (!item) return false;
    item.revokedAt = revokedAt;
    return true;
  }

  async closeFollowup(workspaceId: string, followupId: string, closedAt: Date) {
    const followup = this.followups.get(followupId);
    if (!followup || followup.workspaceId !== workspaceId) return false;
    followup.closedAt ??= closedAt;
    return true;
  }

  async createOrGetFollowupAttempt(input: FollowupAttemptRecord) {
    const byToken = this.followupAttempts.get(input.attemptTokenHash);
    if (byToken) return structuredClone(byToken);
    if (input.accessTokenId) {
      const byAccess = [...this.followupAttempts.values()].find(
        (candidate) => candidate.accessTokenId === input.accessTokenId,
      );
      if (byAccess) return structuredClone(byAccess);
    }
    this.assertFollowupAttemptSequence(input);
    const stored = {
      ...structuredClone(input),
      interventionIndex: input.interventionIndex ?? null,
      advanceReceipts: structuredClone(assertFollowupAdvanceReceipts(input.advanceReceipts)),
    };
    this.followupAttempts.set(input.attemptTokenHash, stored);
    return structuredClone(stored);
  }

  private assertFollowupAttemptSequence(attempt: FollowupAttemptRecord) {
    assertFollowupAdvanceReceipts(attempt.advanceReceipts);
    if (attempt.phase !== "intervention") {
      if (attempt.interventionIndex != null)
        throw new TypeError("Only an intervention phase can have an intervention index");
      return;
    }
    const followup = this.followups.get(attempt.followupId);
    const index = attempt.interventionIndex;
    if (
      followup?.workspaceId !== attempt.workspaceId ||
      followup.recoveryPackSource?.role !== "full_sequence" ||
      !followup.recoveryPackSequence ||
      index == null ||
      !Number.isInteger(index) ||
      index < 0 ||
      index >= followup.recoveryPackSequence.interventions.length ||
      attempt.currentIndex !== 0 ||
      attempt.status !== "in_progress"
    )
      throw new TypeError("Intervention phase requires a frozen sequence and valid card index");
  }

  private followupAttemptTransition(
    current: FollowupAttemptRecord,
    next: FollowupAttemptRecord,
    advanceReceipts: Record<string, number>,
  ): FollowupAttemptRecord {
    const stored = {
      ...structuredClone(current),
      status: next.status,
      phase: next.phase,
      currentIndex: next.currentIndex,
      version: next.version,
      timeMultiplier: next.timeMultiplier,
      questionOpenedAt: new Date(next.questionOpenedAt),
      deadlineAt: next.deadlineAt ? new Date(next.deadlineAt) : null,
      completedAt: next.completedAt ? new Date(next.completedAt) : null,
      updatedAt: new Date(next.updatedAt),
      interventionIndex: next.interventionIndex ?? null,
      advanceReceipts: structuredClone(advanceReceipts),
    };
    this.assertFollowupAttemptSequence(stored);
    return stored;
  }

  async getFollowupAttemptByToken(followupId: string, tokenHash: string, now: Date) {
    const attempt = this.followupAttempts.get(tokenHash);
    if (!attempt || attempt.followupId !== followupId) return null;
    if (attempt.accessTokenId) {
      const access = [...this.followupAccess.values()].find(
        (candidate) => candidate.id === attempt.accessTokenId,
      );
      if (!access || access.revokedAt || access.expiresAt <= now) return null;
    }
    return structuredClone(attempt);
  }

  async getFollowupAnswer(attemptId: string, checkpointId: string) {
    const answer = this.followupAnswers.get(`${attemptId}:${checkpointId}`);
    return answer ? structuredClone(answer) : null;
  }

  async getFollowupAnswerByIdempotencyKey(attemptId: string, key: string) {
    const answer = [...this.followupAnswers.values()].find(
      (candidate) => candidate.attemptId === attemptId && candidate.idempotencyKey === key,
    );
    return answer ? structuredClone(answer) : null;
  }

  async commitFollowupAnswer(
    attempt: FollowupAttemptRecord,
    answer: FollowupAnswerRecord,
    expectedVersion: number,
  ) {
    const duplicate = [...this.followupAnswers.values()].find(
      (candidate) =>
        candidate.attemptId === answer.attemptId &&
        candidate.idempotencyKey === answer.idempotencyKey,
    );
    if (duplicate) return structuredClone(duplicate);
    const current = this.followupAttempts.get(attempt.attemptTokenHash);
    if (!current || current.id !== attempt.id || current.version !== expectedVersion) {
      throw new FollowupVersionConflictError(attempt.id, expectedVersion);
    }
    const key = `${answer.attemptId}:${answer.checkpointId}`;
    if (this.followupAnswers.has(key)) throw new Error("This checkpoint was already answered");
    const next = this.followupAttemptTransition(current, attempt, current.advanceReceipts ?? {});
    if (
      answer.submittedVersion != null &&
      (!Number.isInteger(answer.submittedVersion) ||
        answer.submittedVersion < 0 ||
        answer.submittedVersion > 2_147_483_647)
    )
      throw new TypeError("Submitted answer version must be a non-negative integer");
    const storedAnswer = {
      ...structuredClone(answer),
      submittedVersion: answer.submittedVersion ?? null,
    };
    this.followupAnswers.set(key, storedAnswer);
    this.followupAttempts.set(current.attemptTokenHash, next);
    return structuredClone(storedAnswer);
  }

  async advanceFollowupAttempt(
    attempt: FollowupAttemptRecord,
    expectedVersion: number,
    idempotencyKey?: string,
  ) {
    if (idempotencyKey !== undefined)
      assertFollowupAdvanceReceipts({ [idempotencyKey]: expectedVersion });
    const current = this.followupAttempts.get(attempt.attemptTokenHash);
    if (!current || current.id !== attempt.id || current.version !== expectedVersion) return false;
    const receipts = structuredClone(current.advanceReceipts ?? {});
    if (idempotencyKey !== undefined) {
      if (Object.hasOwn(receipts, idempotencyKey) || Object.keys(receipts).length >= 256)
        return false;
      receipts[idempotencyKey] = expectedVersion;
    }
    this.followupAttempts.set(
      current.attemptTokenHash,
      this.followupAttemptTransition(current, attempt, receipts),
    );
    return true;
  }

  async createAuthoringJob(input: AuthoringJobRecord) {
    if (this.authoringJobs.has(input.id)) throw new Error("Authoring job already exists");
    this.authoringJobs.set(input.id, structuredClone(input));
    return structuredClone(input);
  }

  async createAuthoringJobWithinLimit(
    input: AuthoringJobRecord,
    since: Date,
    monthlyLimit: number | null,
  ) {
    const used = [...this.authoringJobs.values()].filter(
      (job) => job.workspaceId === input.workspaceId && job.createdAt >= since,
    ).length;
    if (monthlyLimit !== null && used >= monthlyLimit) return null;
    return this.createAuthoringJob(input);
  }

  async countAuthoringJobsSince(workspaceId: string, since: Date) {
    return [...this.authoringJobs.values()].filter(
      (job) => job.workspaceId === workspaceId && job.createdAt >= since,
    ).length;
  }

  async getAuthoringJob(workspaceId: string, jobId: string) {
    const job = this.authoringJobs.get(jobId);
    return job?.workspaceId === workspaceId ? structuredClone(job) : null;
  }

  async listAuthoringJobs(workspaceId: string, limit: number) {
    return [...this.authoringJobs.values()]
      .filter((job) => job.workspaceId === workspaceId)
      .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
      .slice(0, limit)
      .map((job) => structuredClone(job));
  }

  async claimAuthoringJob(now: Date, leaseUntil: Date) {
    const job = [...this.authoringJobs.values()]
      .filter(
        (candidate) =>
          (candidate.status === "pending" || candidate.status === "processing") &&
          candidate.availableAt <= now,
      )
      .sort((left, right) => left.availableAt.getTime() - right.availableAt.getTime())[0];
    if (!job) return null;
    job.status = "processing";
    job.attempts += 1;
    job.availableAt = leaseUntil;
    job.updatedAt = now;
    return structuredClone(job);
  }

  async completeAuthoringJob(
    jobId: string,
    expectedAttempts: number,
    output: NonNullable<AuthoringJobRecord["output"]>,
    completedAt: Date,
  ) {
    const job = this.authoringJobs.get(jobId);
    if (!job || !output || job.status !== "processing" || job.attempts !== expectedAttempts) {
      return false;
    }
    job.status = "ready";
    job.output = structuredClone(output);
    job.sourceText = null;
    job.sourceBlob = null;
    job.lastError = null;
    job.updatedAt = completedAt;
    return true;
  }

  async applyAuthoringJobDraft(workspaceId: string, jobId: string, quiz: QuizRecord) {
    const job = this.authoringJobs.get(jobId);
    if (!job || job.workspaceId !== workspaceId || job.status !== "ready" || !job.output) {
      return null;
    }
    if (job.appliedQuizId) {
      const existing = this.quizzes.get(job.appliedQuizId);
      return existing?.workspaceId === workspaceId ? structuredClone(existing) : null;
    }
    const created = await this.createQuiz(quiz);
    job.appliedQuizId = created.id;
    job.updatedAt = new Date();
    return created;
  }

  async retryAuthoringJob(
    jobId: string,
    expectedAttempts: number,
    error: string,
    availableAt: Date,
    failed: boolean,
  ) {
    const job = this.authoringJobs.get(jobId);
    if (!job || job.status !== "processing" || job.attempts !== expectedAttempts) return false;
    job.status = failed ? "failed" : "pending";
    job.lastError = error.slice(0, 2_000);
    job.availableAt = availableAt;
    job.updatedAt = new Date();
    if (failed) {
      job.sourceText = null;
      job.sourceBlob = null;
    }
    return true;
  }

  async getPlan(workspaceId: string) {
    return this.plans.get(workspaceId) ?? "free";
  }

  async getBillingProfile(workspaceId: string) {
    const profile = this.billingProfiles.get(workspaceId);
    return {
      plan: this.plans.get(workspaceId) ?? "free",
      status: profile?.status ?? "free",
      customerId: profile?.customerId ?? null,
      subscriptionId: profile?.subscriptionId ?? null,
    };
  }

  async setPlan(
    workspaceId: string,
    plan: Plan,
    provider: { customerId?: string; subscriptionId?: string; status?: string } = {},
  ) {
    this.plans.set(workspaceId, plan);
    const previous = this.billingProfiles.get(workspaceId);
    this.billingProfiles.set(workspaceId, {
      status: provider.status ?? previous?.status ?? (plan === "free" ? "free" : "active"),
      customerId: provider.customerId ?? previous?.customerId ?? null,
      subscriptionId: provider.subscriptionId ?? previous?.subscriptionId ?? null,
    });
  }

  async provisionCapacityTestWorkspace(
    workspaceId: string,
    requestId: string,
  ): Promise<CapacityTestWorkspaceProvisionResult> {
    if (!this.workspaces.has(workspaceId)) {
      throw new Error("Capacity-test workspace does not exist");
    }
    const previousPlan = this.plans.get(workspaceId) ?? "free";
    const previousProfile = this.billingProfiles.get(workspaceId);
    const previousStatus = previousProfile?.status ?? "free";
    if (previousProfile?.customerId || previousProfile?.subscriptionId) {
      throw new Error("Capacity-test provisioning refuses a provider-linked workspace");
    }
    const priorProvision = this.audits.some(
      (event) =>
        event.workspaceId === workspaceId &&
        event.action === "operations.staging_capacity.provision" &&
        event.targetType === "workspace" &&
        event.targetId === workspaceId,
    );
    if (previousPlan === "team" && previousStatus === "active") {
      if (!priorProvision) {
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
    if (priorProvision) {
      throw new Error("Capacity-test provisioning requires an untouched free workspace");
    }

    this.plans.set(workspaceId, "team");
    this.billingProfiles.set(workspaceId, {
      status: "active",
      customerId: null,
      subscriptionId: null,
    });
    this.audits.push({
      id: crypto.randomUUID(),
      workspaceId,
      actorId: null,
      action: "operations.staging_capacity.provision",
      targetType: "workspace",
      targetId: workspaceId,
      requestId,
      metadata: {
        purpose: "target-region-load",
        previousPlan,
        previousStatus,
        plan: "team",
        status: "active",
        maxParticipants: 250,
      },
      createdAt: new Date(),
    });
    return {
      workspaceId,
      previousPlan,
      previousStatus,
      plan: "team",
      status: "active",
      changed: true,
    };
  }

  async recordBillingEvent(providerEventId: string, _eventType: string) {
    if (this.billingEvents.has(providerEventId)) return false;
    this.billingEvents.add(providerEventId);
    return true;
  }

  async applyBillingEvent(input: BillingEventInput) {
    if (!(await this.recordBillingEvent(input.providerEventId, input.eventType))) return false;
    if (input.workspaceId && input.plan) {
      const lastCreatedAt = this.billingEventCreatedAt.get(input.workspaceId);
      if (!lastCreatedAt || input.providerCreatedAt >= lastCreatedAt) {
        await this.setPlan(input.workspaceId, input.plan, {
          customerId: input.customerId,
          subscriptionId: input.subscriptionId,
          status: input.status,
        });
        this.billingEventCreatedAt.set(input.workspaceId, input.providerCreatedAt);
      }
    }
    return true;
  }

  async recordAudit(
    input: AuditInput,
    target = this.audits,
    createdAt = new Date(),
    id: string = crypto.randomUUID(),
  ) {
    await this.insertAuditEvent({ id, ...structuredClone(input), createdAt }, target);
  }

  protected async insertAuditEvent(event: AuditEventRecord, target = this.audits) {
    target.push(structuredClone(event));
  }

  async listAuditEvents(workspaceId: string, since: Date | null, limit: number) {
    return this.audits
      .filter(
        (event) =>
          event.workspaceId === workspaceId &&
          (!since || event.createdAt.getTime() >= since.getTime()),
      )
      .sort((left, right) => {
        const byTime = left.createdAt.getTime() - right.createdAt.getTime();
        return byTime || left.id.localeCompare(right.id);
      })
      .slice(0, limit)
      .map((event) => structuredClone(event));
  }

  async purgeAuditEvents(cutoff: Date) {
    let purged = 0;
    for (let index = this.audits.length - 1; index >= 0; index -= 1) {
      if (this.audits[index]!.createdAt <= cutoff) {
        this.audits.splice(index, 1);
        purged += 1;
      }
    }
    return purged;
  }

  async recordProductEvents(events: ProductEventRecord[], target = this.productEvents) {
    await this.insertProductEventRecords(events, target);
  }

  protected async insertProductEventRecords(
    events: ProductEventRecord[],
    target = this.productEvents,
  ) {
    const workspaceId = events[0]?.workspaceId;
    if (events.some((event) => event.workspaceId !== workspaceId)) {
      throw new Error("Product event batches cannot span workspaces");
    }
    const ids = new Set(
      [...this.productEvents, ...(target === this.productEvents ? [] : target)].map(
        (event) => event.id,
      ),
    );
    for (const event of events) {
      if (ids.has(event.id)) throw new Error("Product event already exists");
      ids.add(event.id);
    }
    target.push(...structuredClone(events));
  }

  async purgeProductEvents(now: Date) {
    let purged = 0;
    for (let index = this.productEvents.length - 1; index >= 0; index -= 1) {
      if (this.productEvents[index]!.expiresAt <= now) {
        this.productEvents.splice(index, 1);
        purged += 1;
      }
    }
    return purged;
  }

  async exportAccount(userId: string): Promise<MemoryAccountExport> {
    const user = this.users.get(userId);
    if (!user || user.deletedAt) return {};
    const workspaceMemberships = await this.listWorkspaces(userId);
    const ownedWorkspaceIds = new Set(
      workspaceMemberships
        .filter((membership) => membership.role === "owner")
        .map((membership) => membership.id),
    );
    const sessions = [...this.sessions.values()].filter((session) =>
      ownedWorkspaceIds.has(session.workspaceId),
    );
    const sessionIds = new Set(sessions.map((session) => session.id));
    const participants = [...this.participants.values()].filter((participant) =>
      sessionIds.has(participant.sessionId),
    );
    const ownedWorkspaceIdList = [...ownedWorkspaceIds];
    const extensionData = Object.assign(
      {},
      ...(await Promise.all(
        [...this.lifecycleExtensions.values()].map(({ lifecycle }) =>
          lifecycle.exportAccount({ userId, ownedWorkspaceIds }),
        ),
      )),
    ) as Record<string, unknown>;
    return Object.assign(
      {
        profile: {
          id: user.userId,
          email: user.email,
          locale: user.locale,
          localePreferenceSet: user.localePreferenceSet,
          segment: user.segment,
        },
        workspaceMemberships,
        workspaces: await Promise.all(
          ownedWorkspaceIdList.map(async (workspaceId) => ({
            ...this.workspaces.get(workspaceId)!,
            role: "owner",
            brandTheme: await this.getBrandTheme(workspaceId),
          })),
        ),
        folders: (
          await Promise.all(
            ownedWorkspaceIdList.map((workspaceId) => this.listFolders(workspaceId)),
          )
        ).flat(),
        quizzes: (
          await Promise.all(
            ownedWorkspaceIdList.map((workspaceId) => this.listQuizzes(workspaceId, true)),
          )
        ).flat(),
        quizDraftHistory: [...this.quizDraftHistory.values()]
          .filter((snapshot) => ownedWorkspaceIds.has(snapshot.workspaceId))
          .map((snapshot) => structuredClone(normalizeQuizHistory(snapshot))),
        questionHealthDismissals: [...this.questionHealthDismissals.values()]
          .filter((dismissal) => ownedWorkspaceIds.has(dismissal.workspaceId))
          .map((dismissal) => structuredClone(dismissal)),
        questionHealthApplications: [...this.questionHealthApplications.values()]
          .filter((application) => ownedWorkspaceIds.has(application.workspaceId))
          .map((application) => structuredClone(application)),
        quizVersions: [...this.versions.values()]
          .filter((version) => ownedWorkspaceIds.has(version.workspaceId))
          .map((version) => structuredClone(normalizeQuizVersion(version))),
        mediaAssets: (
          await Promise.all(
            ownedWorkspaceIdList.map((workspaceId) => this.listMediaAssets(workspaceId)),
          )
        ).flat(),
        mediaReferences: (
          await Promise.all(
            ownedWorkspaceIdList.map((workspaceId) => this.listMediaReferences(workspaceId)),
          )
        ).flat(),
        sessions: sessions.map(({ hostTokenHash: _hostTokenHash, ...session }) => session),
        participants: participants.map(({ tokenHash: _tokenHash, ...participant }) => participant),
        answers: [...this.answers.entries()]
          .filter(([key]) => sessionIds.has(key.split(":", 1)[0]!))
          .map(([, answer]) => structuredClone(answer)),
        reports: [...this.reports.values()]
          .filter((report) => sessionIds.has(report.sessionId))
          .map((report) => ReportSchema.parse(structuredClone(report))),
        interactionSettings: [...this.interactionSettings.values()].filter((settings) =>
          sessionIds.has(settings.sessionId),
        ),
        participantSignals: [...this.participantSignals.values()].filter((signal) =>
          sessionIds.has(signal.sessionId),
        ),
        signalEvents: this.signalEvents.filter((event) => sessionIds.has(event.sessionId)),
        chatMessages: [...this.chatMessages.values()].filter((message) =>
          sessionIds.has(message.sessionId),
        ),
        chatReactions: [...this.chatReactions.values()].filter((reaction) =>
          sessionIds.has(reaction.sessionId),
        ),
        chatReports: [...this.chatReports]
          .map((report) => {
            const separator = report.indexOf(":");
            return {
              messageId: report.slice(0, separator),
              participantId: report.slice(separator + 1),
            };
          })
          .filter((report) =>
            [...this.chatMessages.values()].some(
              (message) => message.id === report.messageId && sessionIds.has(message.sessionId),
            ),
          ),
        audienceRestrictions: [...this.audienceRestrictions.values()].filter((restriction) =>
          sessionIds.has(restriction.sessionId),
        ),
        followups: [...this.followups.values()]
          .filter((followup) => ownedWorkspaceIds.has(followup.workspaceId))
          .map(
            ({
              genericTokenHash: _genericTokenHash,
              creationMutation: _creationMutation,
              ...followup
            }) => structuredClone(followup),
          ),
        followupAccess: [...this.followupAccess.values()]
          .filter((access) => ownedWorkspaceIds.has(access.workspaceId))
          .map(({ tokenHash: _tokenHash, ...access }) => structuredClone(access)),
        followupAttempts: [...this.followupAttempts.values()]
          .filter((attempt) => ownedWorkspaceIds.has(attempt.workspaceId))
          .map(({ attemptTokenHash: _attemptTokenHash, ...attempt }) => structuredClone(attempt)),
        followupAnswers: [...this.followupAnswers.values()].filter((answer) =>
          ownedWorkspaceIds.has(answer.workspaceId),
        ),
        authoringJobs: [...this.authoringJobs.values()]
          .filter((job) => ownedWorkspaceIds.has(job.workspaceId))
          .map(({ sourceBlob, ...job }) => ({
            ...structuredClone(job),
            sourceBlobBase64: sourceBlob?.toString("base64") ?? null,
          })),
        institutionPolicies: await Promise.all(
          ownedWorkspaceIdList.map((workspaceId) => this.getInstitutionPolicy(workspaceId)),
        ),
        externalIdentities: [...this.externalIdentities.values()].filter(
          (identity) => identity.userId === userId,
        ),
        ltiRegistrations: (
          await Promise.all(
            ownedWorkspaceIdList.map((workspaceId) => this.listLtiRegistrations(workspaceId)),
          )
        ).flat(),
        ltiLaunches: [...this.ltiLaunches.values()]
          .filter((launch) => ownedWorkspaceIds.has(launch.workspaceId))
          .map(({ linkTokenHash: _linkTokenHash, responseJwt: _responseJwt, ...launch }) =>
            structuredClone(launch),
          ),
        billing: await Promise.all(
          ownedWorkspaceIdList.map(async (workspaceId) => ({
            workspaceId,
            ...(await this.getBillingProfile(workspaceId)),
          })),
        ),
        consentRecords: this.consents.filter((record) => record.userId === userId),
        auditEvents: this.audits.filter(
          (audit) => audit.workspaceId !== null && ownedWorkspaceIds.has(audit.workspaceId),
        ),
      },
      extensionData,
    );
  }

  async deleteAccount(userId: string) {
    const user = this.users.get(userId);
    if (!user) return;
    const originalEmail = user.email;
    const ownedWorkspaceIds = new Set(
      (await this.listWorkspaces(userId))
        .filter((workspace) => workspace.role === "owner")
        .map((workspace) => workspace.id),
    );
    await Promise.all(
      [...this.lifecycleExtensions.values()].map(({ lifecycle }) =>
        lifecycle.deleteAccount({ userId, ownedWorkspaceIds }),
      ),
    );
    for (const key of this.deletedLibraryArtifacts) {
      if (ownedWorkspaceIds.has(key.split(":", 1)[0]!)) this.deletedLibraryArtifacts.delete(key);
    }
    for (const key of this.deletedQuizVersions) {
      if (ownedWorkspaceIds.has(key.split(":", 1)[0]!)) this.deletedQuizVersions.delete(key);
    }
    for (const key of this.deletedMediaReferenceOwners) {
      if (ownedWorkspaceIds.has(key.split(":", 1)[0]!))
        this.deletedMediaReferenceOwners.delete(key);
    }
    user.deletedAt = new Date();
    user.email = `deleted-${userId.slice(0, 8)}@invalid.local`;
    user.locale = "en-CA";
    user.localePreferenceSet = false;
    for (const [tokenHash, session] of this.creatorSessions) {
      if (session.userId === userId) this.creatorSessions.delete(tokenHash);
    }
    for (const [tokenHash, token] of this.magicTokens) {
      if (token.email === originalEmail) this.magicTokens.delete(tokenHash);
    }
    for (const [id, quiz] of this.quizzes) {
      if (ownedWorkspaceIds.has(quiz.workspaceId)) this.quizzes.delete(id);
    }
    for (const [key, snapshot] of this.quizDraftHistory) {
      if (ownedWorkspaceIds.has(snapshot.workspaceId)) this.quizDraftHistory.delete(key);
    }
    for (const [key, mutation] of this.quizDraftMutations) {
      if (ownedWorkspaceIds.has(mutation.workspaceId)) this.quizDraftMutations.delete(key);
    }
    for (const [key, dismissal] of this.questionHealthDismissals) {
      if (ownedWorkspaceIds.has(dismissal.workspaceId)) this.questionHealthDismissals.delete(key);
    }
    for (const [key, application] of this.questionHealthApplications) {
      if (ownedWorkspaceIds.has(application.workspaceId))
        this.questionHealthApplications.delete(key);
    }
    for (const [id, folder] of this.folders) {
      if (ownedWorkspaceIds.has(folder.workspaceId)) this.folders.delete(id);
    }
    for (const [id, version] of this.versions) {
      if (ownedWorkspaceIds.has(version.workspaceId)) this.versions.delete(id);
    }
    for (const [id, followup] of this.followups) {
      if (ownedWorkspaceIds.has(followup.workspaceId)) this.deleteFollowupTree(id);
    }
    const deletedSessionIds = new Set<string>();
    for (const [id, session] of this.sessions) {
      if (ownedWorkspaceIds.has(session.workspaceId)) {
        deletedSessionIds.add(id);
        this.deleteSessionTree(id);
      }
    }
    for (const [tokenHash, participant] of this.participants) {
      if (deletedSessionIds.has(participant.sessionId)) this.participants.delete(tokenHash);
    }
    for (const key of this.answers.keys()) {
      if (deletedSessionIds.has(key.split(":", 1)[0]!)) this.answers.delete(key);
    }
    for (const [id, report] of this.reports) {
      if (deletedSessionIds.has(report.sessionId)) this.reports.delete(id);
    }
    for (const [id, asset] of this.mediaAssets) {
      if (ownedWorkspaceIds.has(asset.workspaceId)) {
        this.mediaAssets.delete(id);
        this.mediaFinalizationLeases.delete(id);
        this.mediaObjectCleanup.delete(id);
      }
    }
    for (const [key, reference] of this.mediaReferences) {
      if (ownedWorkspaceIds.has(reference.workspaceId)) this.mediaReferences.delete(key);
    }
    for (const [id, job] of this.authoringJobs) {
      if (ownedWorkspaceIds.has(job.workspaceId)) this.authoringJobs.delete(id);
    }
    for (let index = this.productEvents.length - 1; index >= 0; index -= 1) {
      if (ownedWorkspaceIds.has(this.productEvents[index]!.workspaceId)) {
        this.productEvents.splice(index, 1);
      }
    }
    for (const workspaceId of ownedWorkspaceIds) {
      this.institutionPolicies.delete(workspaceId);
      this.plans.delete(workspaceId);
      this.brandThemes.delete(workspaceId);
      this.billingProfiles.delete(workspaceId);
      this.billingEventCreatedAt.delete(workspaceId);
      this.workspaces.delete(workspaceId);
    }
    for (const [id, identity] of this.externalIdentities) {
      if (ownedWorkspaceIds.has(identity.workspaceId) || identity.userId === userId)
        this.externalIdentities.delete(id);
    }
    for (const [stateHash, transaction] of this.federatedAuthTransactions) {
      if (ownedWorkspaceIds.has(transaction.workspaceId) || transaction.userId === userId)
        this.federatedAuthTransactions.delete(stateHash);
    }
    for (const [id, registration] of this.ltiRegistrations) {
      if (ownedWorkspaceIds.has(registration.workspaceId)) this.ltiRegistrations.delete(id);
    }
    for (const [stateHash, transaction] of this.ltiLoginTransactions) {
      if (ownedWorkspaceIds.has(transaction.workspaceId))
        this.ltiLoginTransactions.delete(stateHash);
    }
    for (const [id, launch] of this.ltiLaunches) {
      if (ownedWorkspaceIds.has(launch.workspaceId)) this.ltiLaunches.delete(id);
    }
    for (const [key, membership] of this.workspaceMembers) {
      if (membership.userId === userId || ownedWorkspaceIds.has(membership.workspaceId)) {
        this.workspaceMembers.delete(key);
      }
    }
    for (const [id, invitation] of this.workspaceInvitations) {
      if (ownedWorkspaceIds.has(invitation.workspaceId)) this.workspaceInvitations.delete(id);
    }
    for (let index = this.consents.length - 1; index >= 0; index -= 1) {
      if (this.consents[index]?.userId === userId) this.consents.splice(index, 1);
    }
    for (const audit of this.audits) {
      if (audit.workspaceId !== null && ownedWorkspaceIds.has(audit.workspaceId)) {
        audit.workspaceId = null;
        audit.actorId = null;
        audit.metadata = {};
      }
    }
  }

  async purgeExpired(now: Date) {
    const purged: string[] = [];
    for (const [id, session] of this.sessions) {
      if (session.retentionExpiresAt <= now) {
        this.deleteSessionTree(id);
        purged.push(id);
      }
    }
    for (const [tokenHash, token] of this.magicTokens) {
      if (token.expiresAt <= now) this.magicTokens.delete(tokenHash);
    }
    for (const [tokenHash, session] of this.creatorSessions) {
      if (session.expiresAt <= now) this.creatorSessions.delete(tokenHash);
    }
    for (const [id, job] of this.authoringJobs) {
      if (job.expiresAt <= now) this.authoringJobs.delete(id);
    }
    for (const [stateHash, transaction] of this.federatedAuthTransactions) {
      if (transaction.expiresAt <= now) this.federatedAuthTransactions.delete(stateHash);
    }
    for (const [stateHash, transaction] of this.ltiLoginTransactions) {
      if (transaction.expiresAt <= now) this.ltiLoginTransactions.delete(stateHash);
    }
    for (const [id, launch] of this.ltiLaunches) {
      if (launch.expiresAt <= now) this.ltiLaunches.delete(id);
    }
    const extensionPurges = await Promise.all(
      [...this.lifecycleExtensions.values()].map(({ lifecycle }) =>
        lifecycle.purgeExpired ? lifecycle.purgeExpired(now) : [],
      ),
    );
    purged.push(...extensionPurges.flat());
    return purged;
  }

  async purgeExpiredPracticeAssignments(now: Date) {
    let purged = 0;
    for (const [id, followup] of this.followups) {
      if (followup.purpose === "assignment" && followup.expiresAt <= now) {
        this.deleteFollowupTree(id);
        purged += 1;
      }
    }
    return purged;
  }

  async expireLiveSessions(now: Date) {
    const expired: string[] = [];
    for (const [id, session] of this.sessions) {
      if (
        session.expiresAt <= now &&
        session.state.phase !== "finished" &&
        !this.expiredLiveSessions.has(id)
      ) {
        this.expiredLiveSessions.add(id);
        await this.releaseLiveRoomCode("round", id, now);
        expired.push(id);
      }
    }
    return expired;
  }
}
