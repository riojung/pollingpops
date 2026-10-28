import type {
  PresentationContent,
  PresentationRecoveryPackIntervention,
  PresentationSessionPhase,
  PresentationSessionResponse,
} from "@openround/contracts";
import type { PlatformRoomCoverageInput } from "./platform-types.js";

export interface PresentationSessionRecord {
  id: string;
  workspaceId: string;
  /** Creation-only commercial request; not part of the audience protocol. */
  commercialCoverage?: PlatformRoomCoverageInput;
  presentationId: string;
  presentationVersionId: string;
  title: string;
  content: PresentationContent;
  code: string;
  /** Server-private salted verifier; never part of settings or audience state. */
  joinPasswordHash?: string | null;
  status: "active" | "finished";
  phase: PresentationSessionPhase;
  currentBlockIndex: number;
  revision: number;
  settings: PresentationSessionSettings;
  trustMode: PresentationSessionTrustMode;
  /** Creation-time eligibility; absent only on legacy in-process records. */
  recoveryPackCardsEnabled?: boolean;
  /** Frozen aggregate attribution for the intervention currently being presented. */
  recoveryPackIntervention?: PresentationRecoveryPackIntervention | null;
  eventSeq: number;
  questionOpenedAt: Date | null;
  questionClosesAt: Date | null;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
  finishedAt: Date | null;
  liveExpiresAt: Date;
  retentionExpiresAt: Date;
}

export type PresentationSessionTimeMode = "timed" | "flex";
export type PresentationSessionTrustMode = "learning" | "verified";

export interface PresentationSessionSettings {
  timeMode: PresentationSessionTimeMode;
}

export type PresentationSessionCreateInput = Omit<
  PresentationSessionRecord,
  "settings" | "trustMode" | "eventSeq" | "questionOpenedAt" | "questionClosesAt"
> &
  Partial<
    Pick<
      PresentationSessionRecord,
      "settings" | "trustMode" | "eventSeq" | "questionOpenedAt" | "questionClosesAt"
    >
  >;

export interface PresentationSessionParticipantRecord {
  id: string;
  workspaceId: string;
  sessionId: string;
  nickname: string;
  tokenHash: string;
  joinedAt: Date;
  lastSeenAt: Date;
}

/**
 * Canonical Presentation leaderboard ordering for in-process projections and reports. Keep the
 * PostgreSQL acknowledgement ranking windows in presentation-session-postgres.ts in the same
 * order.
 */
export function comparePresentationLeaderboardEntries(
  left: Pick<PresentationSessionParticipantRecord, "id" | "nickname" | "joinedAt"> & {
    score: number;
  },
  right: Pick<PresentationSessionParticipantRecord, "id" | "nickname" | "joinedAt"> & {
    score: number;
  },
) {
  return (
    right.score - left.score ||
    left.joinedAt.getTime() - right.joinedAt.getTime() ||
    left.nickname.localeCompare(right.nickname) ||
    left.id.localeCompare(right.id)
  );
}

export interface PresentationSessionResponseRecord {
  id: string;
  workspaceId: string;
  sessionId: string;
  participantId: string;
  blockId: string;
  questionId: string;
  response: PresentationSessionResponse;
  correct: boolean | null;
  score: number;
  responseMs: number;
  submittedAt: Date;
  /** Required by realtime callers. Optional only while legacy REST callers migrate. */
  idempotencyKey?: string | null;
  /** Canonical request fingerprint used to reject key reuse with a different request. */
  requestHash?: string | null;
}

export interface PresentationParticipantSnapshotProjection {
  participantCount: number;
  standing: { rank: number; score: number } | null;
  currentResponse: PresentationSessionResponseRecord | null;
}

export interface PresentationResponseContext {
  session: PresentationSessionRecord;
  participant: PresentationSessionParticipantRecord;
  priorResponse: PresentationSessionResponseRecord | null;
}

export interface PresentationResponseAcknowledgementState {
  session: PresentationSessionRecord;
  projection: PresentationParticipantSnapshotProjection;
}

export type PresentationSessionCredentialRole = "host" | "companion";

export interface PresentationSessionCredentialRecord {
  id: string;
  workspaceId: string;
  sessionId: string;
  role: PresentationSessionCredentialRole;
  tokenHash: string;
  createdAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
}

export interface PresentationSessionCommandReceiptRecord {
  id: string;
  workspaceId: string;
  sessionId: string;
  commandId: string;
  expectedRevision: number;
  resultingRevision: number;
  eventType: PresentationSessionTimelineRecord["type"];
  /** Null only for receipts written before command request fingerprinting. */
  requestHash?: string | null;
  receivedAt: Date;
}

export interface PresentationSessionTimelineRecord {
  id: string;
  workspaceId: string;
  sessionId: string;
  sequence: number;
  type:
    | "presentation.started"
    | "content.presented"
    | "question.launched"
    | "question.revealed"
    | "intervention.presented"
    | "presentation.finished";
  blockIndex: number | null;
  blockId: string | null;
  /** Staff-private roster frozen at reveal; absent/null only on legacy timeline records. */
  revealedParticipantIds?: string[] | null;
  recoveryPackIntervention?: PresentationRecoveryPackIntervention | null;
  occurredAt: Date;
}

export type PresentationSessionReportStatus = "pending" | "ready" | "failed";

/**
 * Durable report metadata. The payload deliberately remains contract-neutral so the DB package
 * can persist versioned Presentation report documents without owning their API schema.
 */
export interface PresentationSessionReportRecord {
  id: string;
  workspaceId: string;
  sessionId: string;
  status: PresentationSessionReportStatus;
  schemaVersion: number;
  payload: unknown | null;
  generatedAt: Date | null;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface PresentationSessionReportJob {
  reportId: string;
  workspaceId: string;
  sessionId: string;
  attempts: number;
  /** Opaque claim identity used to fence workers whose lease was subsequently reclaimed. */
  leaseToken: string;
  expiresAt: Date;
}

export interface PresentationSessionReportCompletion {
  reportId: string;
  sessionId: string;
  schemaVersion: number;
  payload: unknown;
  generatedAt: Date;
}

export type PresentationResponseAcceptance =
  | {
      status: "accepted";
      response: PresentationSessionResponseRecord;
      acknowledgement: PresentationResponseAcknowledgementState;
    }
  | {
      status: "duplicate";
      response: PresentationSessionResponseRecord;
      acknowledgement: PresentationResponseAcknowledgementState;
    }
  | { status: "idempotency_conflict"; response: PresentationSessionResponseRecord }
  | { status: "already_responded"; response: PresentationSessionResponseRecord }
  | { status: "phase_closed" };

export type PresentationTransitionAcceptance =
  | { status: "accepted"; session: PresentationSessionRecord }
  | { status: "duplicate"; session: PresentationSessionRecord }
  | { status: "idempotency_conflict"; session: PresentationSessionRecord }
  | { status: "not_found" };

export type PresentationParticipantJoin =
  | { status: "accepted"; participant: PresentationSessionParticipantRecord }
  | { status: "full" }
  | { status: "closed" };

export type PresentationSessionDeletion =
  { status: "deleted" } | { status: "not_found" } | { status: "active" };

export interface PresentationSessionTransitionInput {
  workspaceId: string;
  sessionId: string;
  expectedRevision: number;
  phase: PresentationSessionPhase;
  currentBlockIndex: number;
  status: "active" | "finished";
  occurredAt?: Date;
  questionOpenedAt?: Date | null;
  questionClosesAt?: Date | null;
  retentionExpiresAt?: Date;
  recoveryPackIntervention?: PresentationRecoveryPackIntervention | null;
  /** Session-local frozen content replacement, fenced with the command and its receipt. */
  content?: PresentationContent;
  event: Omit<
    PresentationSessionTimelineRecord,
    "id" | "workspaceId" | "sessionId" | "sequence" | "occurredAt" | "revealedParticipantIds"
  >;
}

export type PresentationSessionCommandInput = PresentationSessionTransitionInput & {
  commandId: string;
  requestHash?: string | null;
  /** Revalidated atomically with a new insertion; accepted receipts bypass this source fence. */
  publishedQuestionSource?: {
    quizId: string;
    versionId: string;
    contentHash: string;
  };
};

export interface PresentationSessionRepository {
  listSessions(
    workspaceId: string,
    now?: Date,
    includeExpired?: boolean,
  ): Promise<PresentationSessionRecord[]>;
  /** Deletes the entire retained room only when it is finished or its live access has expired. */
  deleteSession(
    workspaceId: string,
    sessionId: string,
    now?: Date,
  ): Promise<PresentationSessionDeletion>;
  createSession(input: PresentationSessionCreateInput): Promise<PresentationSessionRecord>;
  /** Creates the live room and its first scoped credential in one durable unit. */
  createSessionWithCredential(
    input: PresentationSessionCreateInput,
    credential: PresentationSessionCredentialRecord,
  ): Promise<{
    session: PresentationSessionRecord;
    credential: PresentationSessionCredentialRecord;
  }>;
  getSessionForWorkspace(
    workspaceId: string,
    sessionId: string,
  ): Promise<PresentationSessionRecord | null>;
  getSessionById(sessionId: string): Promise<PresentationSessionRecord | null>;
  getSessionByCode(code: string): Promise<PresentationSessionRecord | null>;
  transitionSession(
    input: PresentationSessionTransitionInput,
  ): Promise<PresentationSessionRecord | null>;
  transitionSessionCommand(
    input: PresentationSessionCommandInput,
  ): Promise<PresentationTransitionAcceptance>;
  /** Recover a scoped receipt before current phase, revision, or selector validation. */
  findCommandReceipt(
    workspaceId: string,
    sessionId: string,
    commandId: string,
  ): Promise<PresentationSessionCommandReceiptRecord | null>;
  addParticipant(
    input: PresentationSessionParticipantRecord,
  ): Promise<PresentationSessionParticipantRecord>;
  joinParticipantWithinLimit(
    input: PresentationSessionParticipantRecord,
    participantLimit: number,
  ): Promise<PresentationParticipantJoin>;
  findParticipant(
    sessionId: string,
    tokenHash: string,
  ): Promise<PresentationSessionParticipantRecord | null>;
  /** Loads the authenticated response context and an existing receipt in one hot-path read. */
  getResponseContext(
    sessionId: string,
    tokenHash: string,
    idempotencyKey: string,
  ): Promise<PresentationResponseContext | null>;
  listParticipants(sessionId: string): Promise<PresentationSessionParticipantRecord[]>;
  saveResponse(
    input: PresentationSessionResponseRecord,
  ): Promise<PresentationSessionResponseRecord>;
  acceptResponse(
    input: PresentationSessionResponseRecord,
    expectedSessionRevision: number,
  ): Promise<PresentationResponseAcceptance>;
  findResponseByIdempotencyKey(
    sessionId: string,
    participantId: string,
    idempotencyKey: string,
  ): Promise<PresentationSessionResponseRecord | null>;
  getParticipantSnapshotProjection(
    sessionId: string,
    participantId: string,
    currentBlockId: string | null,
    includeStanding: boolean,
  ): Promise<PresentationParticipantSnapshotProjection | null>;
  listResponses(sessionId: string): Promise<PresentationSessionResponseRecord[]>;
  listTimeline(sessionId: string): Promise<PresentationSessionTimelineRecord[]>;
  getReport(
    workspaceId: string,
    sessionId: string,
  ): Promise<PresentationSessionReportRecord | null>;
  claimReportJob(now: Date, leaseUntil: Date): Promise<PresentationSessionReportJob | null>;
  completeReportJob(
    job: PresentationSessionReportJob,
    report: PresentationSessionReportCompletion,
  ): Promise<void>;
  retryReportJob(
    job: PresentationSessionReportJob,
    error: string,
    availableAt: Date,
    failed: boolean,
  ): Promise<void>;
  createCredential(
    input: PresentationSessionCredentialRecord,
  ): Promise<PresentationSessionCredentialRecord>;
  /** Atomically revokes active credentials for the same role before creating the replacement. */
  rotateCredential(
    input: PresentationSessionCredentialRecord,
  ): Promise<PresentationSessionCredentialRecord>;
  findValidCredential(
    sessionId: string,
    tokenHash: string,
    role?: PresentationSessionCredentialRole,
    now?: Date,
  ): Promise<PresentationSessionCredentialRecord | null>;
  revokeCredential(
    workspaceId: string,
    sessionId: string,
    credentialId: string,
    revokedAt?: Date,
    role?: PresentationSessionCredentialRole,
  ): Promise<PresentationSessionCredentialRecord | null>;
}

export class PresentationSessionConflictError extends Error {
  constructor(
    public readonly expectedRevision: number,
    public readonly currentRevision: number,
  ) {
    super("The live presentation changed in another host window");
    this.name = "PresentationSessionConflictError";
  }
}

export class PresentationPublishedQuestionSourceUnavailableError extends Error {
  constructor() {
    super("Published source Round version not found");
    this.name = "PresentationPublishedQuestionSourceUnavailableError";
  }
}
