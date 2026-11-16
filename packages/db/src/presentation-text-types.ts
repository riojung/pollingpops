import type {
  PresentationTextModerationQuery,
  PresentationTextResultsQuery,
  PresentationTextModerationPage,
  PresentationTextResponseResults,
  TextResponseDistribution,
  TextResponseModerationStatus,
} from "@openround/contracts";
import type {
  PresentationSessionRecord,
  PresentationSessionResponseRecord,
} from "./presentation-session-types.js";
export type PresentationTextReadActor =
  | { role: "host" | "companion" | "stage"; credentialId: string }
  | { role: "participant"; participantId: string }
  | { role: "creator"; userId: string };
export interface PresentationTextModerationInput {
  workspaceId: string;
  sessionId: string;
  hostCredentialId: string;
  commandId: string;
  expectedRevision: number;
  expectedModerationVersion: number;
  responseId: string;
  status: "approved" | "removed";
  requestHash: string;
  occurredAt: Date;
}
export interface PresentationTextModerationReceiptRecord {
  id: string;
  workspaceId: string;
  sessionId: string;
  commandId: string;
  responseId: string;
  blockId: string;
  hostCredentialId: string;
  requestHash: string;
  previousStatus: "pending" | "approved";
  status: "approved" | "removed";
  expectedRevision: number;
  expectedModerationVersion: number;
  resultingModerationVersion: number;
  acceptedAt: Date;
}
export type PresentationTextModerationAcceptance =
  | {
      status: "accepted" | "duplicate";
      session: PresentationSessionRecord;
      receipt: PresentationTextModerationReceiptRecord;
      response: PresentationSessionResponseRecord;
    }
  | { status: "stale"; session: PresentationSessionRecord; actualModerationVersion: number }
  | {
      status:
        "idempotency_conflict" | "phase_closed" | "not_found" | "unauthorized" | "limit_reached";
    };
export interface PresentationTextModerationPageInput extends PresentationTextModerationQuery {
  workspaceId: string;
  sessionId: string;
  hostCredentialId: string;
  now?: Date;
}
export interface PresentationTextResultsInput extends Omit<PresentationTextResultsQuery, "role"> {
  workspaceId: string;
  sessionId: string;
  actor: PresentationTextReadActor;
  now?: Date;
}
export interface PresentationTextReportEvidence {
  blockId: string;
  textResults: TextResponseDistribution;
}
export interface PresentationPrivateTextResponse {
  record: PresentationSessionResponseRecord;
  textValue: string | null;
}
export interface PresentationTextRepository {
  moderateTextResponse(
    input: PresentationTextModerationInput,
  ): Promise<PresentationTextModerationAcceptance>;
  findTextModerationReceipt(
    workspaceId: string,
    sessionId: string,
    commandId: string,
  ): Promise<PresentationTextModerationReceiptRecord | null>;
  getTextModerationPage(
    input: PresentationTextModerationPageInput,
  ): Promise<PresentationTextModerationPage>;
  getTextResponseResults(
    input: PresentationTextResultsInput,
  ): Promise<PresentationTextResponseResults>;
  getTextReportEvidence(input: {
    workspaceId: string;
    sessionId: string;
    now?: Date;
  }): Promise<PresentationTextReportEvidence[]>;
}
export class PresentationTextReadError extends Error {
  constructor(
    public readonly code: "NOT_FOUND" | "UNAUTHORIZED" | "CONFLICT",
    message: string,
  ) {
    super(message);
  }
}
export function textStatus(
  record: PresentationSessionResponseRecord,
): TextResponseModerationStatus | null {
  return record.moderationStatus ?? null;
}

export class PresentationTextCapacityError extends Error {
  readonly code = "PRESENTATION_TEXT_CAPACITY";
  constructor(message = "The Presentation text response limit has been reached") {
    super(message);
  }
}
