import type {
  CreatePresentationAssignment,
  PresentationReadingProgress,
} from "@openround/contracts";
import type { PresentationVersionRecord } from "./presentation-types.js";
export class PresentationAssignmentError extends Error {
  constructor(
    public readonly code:
      | "UNAVAILABLE"
      | "IDEMPOTENCY_CONFLICT"
      | "ASSIGNMENT_LIMIT"
      | "ATTEMPT_LIMIT"
      | "REQUEST_EXPIRED"
      | "REVISION_CONFLICT"
      | "INVALID_BLOCK"
      | "INCOMPLETE"
      | "COMPLETED"
      | "RECEIPT_LIMIT",
    message = (
      {
        REVISION_CONFLICT: "Reading progress changed in another tab. Reload to continue.",
        INVALID_BLOCK: "This page is unavailable in this assignment.",
        INCOMPLETE: "Acknowledge every page before finishing reading.",
        COMPLETED: "This reading attempt is already complete.",
        ASSIGNMENT_LIMIT: "Revoke an active assignment or wait for expired assignments to clear.",
        ATTEMPT_LIMIT: "This assignment has reached its reading attempt limit.",
        RECEIPT_LIMIT: "This reading attempt has reached its progress update limit.",
        REQUEST_EXPIRED: "This assignment request expired. Create a new assignment.",
        IDEMPOTENCY_CONFLICT: "This retry has changed. Reload to continue.",
        UNAVAILABLE: "This reading assignment is unavailable",
      } as const
    )[code],
  ) {
    super(message);
  }
}
export interface PresentationAssignmentRecord {
  id: string;
  workspaceId: string;
  presentationId: string;
  versionId: string;
  actorId: string;
  requestId: string;
  intentHash: string;
  tokenHash: string;
  createdAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
}
export interface PresentationReadingAttemptRecord {
  id: string;
  assignmentId: string;
  workspaceId: string;
  tokenHash: string;
  revision: number;
  readBlockIds: string[];
  currentBlockId: string | null;
  startedAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
}
/** Internal counts only. Creator-facing readers must apply the reporting privacy policy. */
export interface PresentationReadingReportRecord {
  assignment: PresentationAssignmentRecord;
  generatedAt: Date;
  blockIds: string[];
  started: number;
  completed: number;
  readCounts: Record<string, number>;
}
export interface CreatePresentationAssignmentInput extends Omit<
  CreatePresentationAssignment,
  "token"
> {
  workspaceId: string;
  presentationId: string;
  actorId: string;
  intentHash: string;
  tokenHash: string;
  now: Date;
}
export interface PresentationAssignmentSource {
  assignment: PresentationAssignmentRecord;
  version: PresentationVersionRecord;
}
export interface PresentationReadingAttemptSource extends PresentationAssignmentSource {
  attempt: PresentationReadingAttemptRecord;
}
export interface StartPresentationReadingAttemptInput {
  assignmentId: string;
  assignmentTokenHash: string;
  attemptId: string;
  tokenHash: string;
  now: Date;
}
export interface MutatePresentationReadingAttemptInput {
  assignmentId: string;
  attemptId: string;
  tokenHash: string;
  mutation: PresentationReadingProgress;
  now: Date;
}
export interface PresentationAssignmentRepository {
  createAssignment(
    input: CreatePresentationAssignmentInput,
  ): Promise<{ assignment: PresentationAssignmentRecord; replayed: boolean }>;
  listAssignments(
    workspaceId: string,
    presentationId: string,
    actorId: string,
  ): Promise<PresentationAssignmentRecord[]>;
  getReadingReport(
    workspaceId: string,
    presentationId: string,
    assignmentId: string,
    actorId: string,
    now: Date,
  ): Promise<PresentationReadingReportRecord | null>;
  revokeAssignment(
    workspaceId: string,
    presentationId: string,
    assignmentId: string,
    actorId: string,
    now: Date,
  ): Promise<boolean>;
  getPublicAssignment(
    assignmentId: string,
    tokenHash: string,
    now: Date,
  ): Promise<PresentationAssignmentSource | null>;
  getAssignmentAccess(
    assignmentId: string,
    tokenHash: string,
    now: Date,
  ): Promise<PresentationAssignmentRecord | null>;
  startAttempt(
    input: StartPresentationReadingAttemptInput,
  ): Promise<PresentationReadingAttemptSource & { replayed: boolean }>;
  getAttempt(
    assignmentId: string,
    attemptId: string,
    tokenHash: string,
    now: Date,
  ): Promise<PresentationReadingAttemptSource | null>;
  mutateAttempt(
    input: MutatePresentationReadingAttemptInput,
  ): Promise<PresentationReadingAttemptSource & { replayed: boolean }>;
}
