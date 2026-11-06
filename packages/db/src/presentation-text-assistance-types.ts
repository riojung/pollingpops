import type {
  CreatePresentationTextAssistanceJob,
  PresentationTextAssistanceJob,
  PresentationTextAssistanceProposal,
  PresentationTextAssistanceErrorCode,
} from "@openround/contracts";
export interface PresentationTextAssistanceContext {
  workspaceId: string;
  presentationId: string;
  actorId: string;
  now?: Date;
}
export interface PresentationTextAssistanceCreateInput extends PresentationTextAssistanceContext {
  request: CreatePresentationTextAssistanceJob;
  originalText: string;
  role: "title" | "body";
  since: Date;
  monthlyLimit: number | null;
  expiresAt?: Date;
}
export interface PresentationTextAssistanceClaim extends PresentationTextAssistanceJob {
  workspaceId: string;
  createdBy: string;
  originalText: string;
  requestHash: string;
  attempt: number;
  leaseToken: string;
  leaseUntil: Date;
}
export interface PresentationTextAssistanceFence {
  jobId: string;
  attempt: number;
  leaseToken: string;
  now?: Date;
}
export interface PresentationTextAssistanceRepository {
  create(
    input: PresentationTextAssistanceCreateInput,
  ): Promise<{ status: "created" | "duplicate"; job: PresentationTextAssistanceJob }>;
  get(
    input: PresentationTextAssistanceContext & { jobId: string },
  ): Promise<PresentationTextAssistanceJob | null>;
  list(
    input: PresentationTextAssistanceContext & { limit?: number },
  ): Promise<PresentationTextAssistanceJob[]>;
  usage(
    input: PresentationTextAssistanceContext & { since: Date },
  ): Promise<{ used: number; active: number }>;
  claim(now: Date, leaseUntil: Date): Promise<PresentationTextAssistanceClaim | null>;
  complete(
    input: PresentationTextAssistanceFence & { proposal: PresentationTextAssistanceProposal },
  ): Promise<boolean>;
  fail(
    input: PresentationTextAssistanceFence & {
      errorCode: PresentationTextAssistanceErrorCode;
      availableAt?: Date;
      terminal: boolean;
    },
  ): Promise<boolean>;
  purgeExpired(now: Date): Promise<string[]>;
}
export class PresentationTextAssistanceError extends Error {
  constructor(
    readonly code: "NOT_FOUND" | "CONFLICT" | "LIMIT_REACHED" | "ACTIVE_LIMIT_REACHED",
    message = "Text assistance is unavailable for this request",
  ) {
    super(message);
  }
}
