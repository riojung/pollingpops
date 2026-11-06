import type {
  CreatePresentationAssistanceJob,
  PresentationAssistanceJob,
  PresentationAssistanceProposal,
  PresentationAssistanceErrorCode,
} from "@openround/contracts";
export interface PresentationAssistanceContext {
  workspaceId: string;
  presentationId: string;
  actorId: string;
  now?: Date;
}
export interface PresentationAssistanceCreateInput extends PresentationAssistanceContext {
  request: CreatePresentationAssistanceJob;
  since: Date;
  monthlyLimit: number | null;
  expiresAt?: Date;
}
export interface PresentationAssistanceClaim extends PresentationAssistanceJob {
  workspaceId: string;
  createdBy: string;
  outline: string;
  requestHash: string;
  attempt: number;
  leaseToken: string;
  leaseUntil: Date;
}
export interface PresentationAssistanceFence {
  jobId: string;
  attempt: number;
  leaseToken: string;
  now?: Date;
}
export interface PresentationAssistanceRepository {
  create(
    input: PresentationAssistanceCreateInput,
  ): Promise<{ status: "created" | "duplicate"; job: PresentationAssistanceJob }>;
  get(
    input: PresentationAssistanceContext & { jobId: string },
  ): Promise<PresentationAssistanceJob | null>;
  list(
    input: PresentationAssistanceContext & { limit?: number },
  ): Promise<PresentationAssistanceJob[]>;
  usage(
    input: PresentationAssistanceContext & { since: Date },
  ): Promise<{ used: number; active: number }>;
  claim(now: Date, leaseUntil: Date): Promise<PresentationAssistanceClaim | null>;
  complete(
    input: PresentationAssistanceFence & { proposal: PresentationAssistanceProposal },
  ): Promise<boolean>;
  fail(
    input: PresentationAssistanceFence & {
      errorCode: PresentationAssistanceErrorCode;
      availableAt?: Date;
      terminal: boolean;
    },
  ): Promise<boolean>;
  purgeExpired(now: Date): Promise<string[]>;
}
export class PresentationAssistanceError extends Error {
  constructor(
    readonly code: "NOT_FOUND" | "CONFLICT" | "LIMIT_REACHED" | "ACTIVE_LIMIT_REACHED",
    message = "Slide assistance is unavailable for this request",
  ) {
    super(message);
  }
}
