import type {
  CreatePresentationPracticeAssignment,
  PresentationPracticeProgress,
} from "@openround/contracts";
import type { PresentationVersionRecord } from "./presentation-types.js";

export class PresentationPracticeAssignmentError extends Error {
  constructor(
    public readonly code:
      | "UNAVAILABLE"
      | "IDEMPOTENCY_CONFLICT"
      | "ASSIGNMENT_LIMIT"
      | "ATTEMPT_LIMIT"
      | "REQUEST_EXPIRED"
      | "REVISION_CONFLICT"
      | "INVALID_BLOCK"
      | "INVALID_RESPONSE"
      | "UNSUPPORTED_CONTENT"
      | "INCOMPLETE"
      | "COMPLETED"
      | "RECEIPT_LIMIT",
    message: string = (
      {
        UNAVAILABLE: "This practice assignment is unavailable.",
        IDEMPOTENCY_CONFLICT: "This retry has changed. Reload to continue.",
        ASSIGNMENT_LIMIT:
          "Revoke an active practice assignment or wait for expired assignments to clear.",
        ATTEMPT_LIMIT: "This practice assignment has reached its attempt limit.",
        REQUEST_EXPIRED: "This assignment request expired. Create a new practice assignment.",
        REVISION_CONFLICT: "Practice progress changed in another tab. Reload to continue.",
        INVALID_BLOCK: "This page cannot be acknowledged in this practice assignment.",
        INVALID_RESPONSE: "Choose one available response for this practice question.",
        UNSUPPORTED_CONTENT:
          "Practice requires 1–25 single-select or true/false questions and at most 50 visible pages, without linked rechecks.",
        INCOMPLETE:
          "Acknowledge every content page and answer every question before finishing practice.",
        COMPLETED: "This practice attempt is already complete.",
        RECEIPT_LIMIT: "This practice attempt has reached its progress update limit.",
      } as const
    )[code],
  ) {
    super(message);
  }
}
export interface PresentationPracticeAssignmentRecord {
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
export interface PresentationPracticeAnswerRecord {
  choiceId: string;
  correct: boolean;
  revision: number;
  submittedAt: Date;
}
export interface PresentationPracticeAttemptRecord {
  id: string;
  assignmentId: string;
  workspaceId: string;
  tokenHash: string;
  revision: number;
  readBlockIds: string[];
  currentBlockId: string | null;
  answers: Record<string, PresentationPracticeAnswerRecord>;
  startedAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
}
export interface PresentationPracticeInsightsRecord {
  assignment: PresentationPracticeAssignmentRecord;
  generatedAt: Date;
  started: number;
  completed: number;
}
export interface CreatePresentationPracticeAssignmentInput extends Omit<
  CreatePresentationPracticeAssignment,
  "token"
> {
  workspaceId: string;
  presentationId: string;
  actorId: string;
  intentHash: string;
  tokenHash: string;
  now: Date;
}
export interface PresentationPracticeAssignmentSource {
  assignment: PresentationPracticeAssignmentRecord;
  version: PresentationVersionRecord;
}
export interface PresentationPracticeAttemptSource extends PresentationPracticeAssignmentSource {
  attempt: PresentationPracticeAttemptRecord;
}
export interface StartPresentationPracticeAttemptInput {
  assignmentId: string;
  assignmentTokenHash: string;
  attemptId: string;
  tokenHash: string;
  now: Date;
}
export interface MutatePresentationPracticeAttemptInput {
  assignmentId: string;
  attemptId: string;
  tokenHash: string;
  mutation: PresentationPracticeProgress;
  now: Date;
}
export interface PresentationPracticeAssignmentRepository {
  createAssignment(
    input: CreatePresentationPracticeAssignmentInput,
  ): Promise<{ assignment: PresentationPracticeAssignmentRecord; replayed: boolean }>;
  listAssignments(
    workspaceId: string,
    presentationId: string,
    actorId: string,
  ): Promise<PresentationPracticeAssignmentRecord[]>;
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
  ): Promise<PresentationPracticeAssignmentSource | null>;
  getAssignmentAccess(
    assignmentId: string,
    tokenHash: string,
    now: Date,
  ): Promise<PresentationPracticeAssignmentRecord | null>;
  startAttempt(
    input: StartPresentationPracticeAttemptInput,
  ): Promise<PresentationPracticeAttemptSource & { replayed: boolean }>;
  getAttempt(
    assignmentId: string,
    attemptId: string,
    tokenHash: string,
    now: Date,
  ): Promise<PresentationPracticeAttemptSource | null>;
  mutateAttempt(
    input: MutatePresentationPracticeAttemptInput,
  ): Promise<PresentationPracticeAttemptSource & { replayed: boolean }>;
  getPracticeInsights(
    workspaceId: string,
    presentationId: string,
    assignmentId: string,
    actorId: string,
    now: Date,
  ): Promise<PresentationPracticeInsightsRecord | null>;
}
