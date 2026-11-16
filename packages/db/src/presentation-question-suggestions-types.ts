import type {
  CreatePresentationQuestionSuggestionsJob,
  PresentationQuestionSuggestionsJob,
  PresentationQuestionSuggestionsProposal,
  PresentationQuestionSuggestionsErrorCode,
  PresentationQuestionSuggestionSource,
} from "@openround/contracts";
export interface PresentationQuestionSuggestionsContext {
  workspaceId: string;
  presentationId: string;
  actorId: string;
  now?: Date;
}
export interface PresentationQuestionSuggestionsCreateInput extends PresentationQuestionSuggestionsContext {
  request: CreatePresentationQuestionSuggestionsJob;
  source: PresentationQuestionSuggestionSource | null;
  since: Date;
  monthlyLimit: number | null;
  expiresAt?: Date;
}
export interface PresentationQuestionSuggestionsClaim extends PresentationQuestionSuggestionsJob {
  workspaceId: string;
  createdBy: string;
  source: PresentationQuestionSuggestionSource;
  requestHash: string;
  attempt: number;
  leaseToken: string;
  leaseUntil: Date;
}
export interface PresentationQuestionSuggestionsFence {
  jobId: string;
  attempt: number;
  leaseToken: string;
  now?: Date;
}
export interface PresentationQuestionSuggestionsRepository {
  create(
    input: PresentationQuestionSuggestionsCreateInput,
  ): Promise<{ status: "created" | "duplicate"; job: PresentationQuestionSuggestionsJob }>;
  get(
    input: PresentationQuestionSuggestionsContext & { jobId: string },
  ): Promise<PresentationQuestionSuggestionsJob | null>;
  list(
    input: PresentationQuestionSuggestionsContext & { limit?: number },
  ): Promise<PresentationQuestionSuggestionsJob[]>;
  usage(
    input: PresentationQuestionSuggestionsContext & { since: Date },
  ): Promise<{ used: number; active: number }>;
  claim(now: Date, leaseUntil: Date): Promise<PresentationQuestionSuggestionsClaim | null>;
  complete(
    input: PresentationQuestionSuggestionsFence & {
      proposal: PresentationQuestionSuggestionsProposal;
    },
  ): Promise<boolean>;
  fail(
    input: PresentationQuestionSuggestionsFence & {
      errorCode: PresentationQuestionSuggestionsErrorCode;
      availableAt?: Date;
      terminal: boolean;
    },
  ): Promise<boolean>;
  purgeExpired(now: Date): Promise<string[]>;
}
export class PresentationQuestionSuggestionsError extends Error {
  constructor(
    readonly code: "NOT_FOUND" | "CONFLICT" | "LIMIT_REACHED" | "ACTIVE_LIMIT_REACHED",
    message = "Question suggestions are unavailable for this request",
  ) {
    super(message);
  }
}
