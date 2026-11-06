import type {
  EnablePresentationReview,
  PresentationReviewFeedback,
  PresentationReviewFeedbackAccess,
  PresentationReviewFeedbackMutation,
  PresentationReviewFeedbackMutationResponse,
} from "@openround/contracts";

export class PresentationReviewFeedbackError extends Error {
  constructor(
    public readonly code:
      "UNAVAILABLE" | "CONFLICT" | "IDEMPOTENCY_CONFLICT" | "REVIEW_LIMIT" | "VALIDATION_ERROR",
  ) {
    super(
      {
        UNAVAILABLE: "This presentation review is unavailable",
        CONFLICT: "This review changed. Refresh and keep your unsent text before trying again.",
        IDEMPOTENCY_CONFLICT: "This review operation was used for a different request",
        REVIEW_LIMIT: "This review has reached its discussion limit",
        VALIDATION_ERROR: "This review action is not available in its current state",
      }[code],
    );
    this.name = "PresentationReviewFeedbackError";
  }
}
export interface PresentationReviewAuthorContext {
  workspaceId: string;
  presentationId: string;
  shareId: string;
  actorId: string;
  now: Date;
}
export interface PresentationReviewReviewerContext {
  shareId: string;
  tokenHash: string;
  actorId: string;
  now: Date;
}
/** workspaceId is service-only source context and must never be copied into the public DTO. */
export interface PresentationReviewFeedbackResult {
  workspaceId: string;
  feedback: PresentationReviewFeedback;
}
export interface PresentationReviewFeedbackMutationResult {
  workspaceId: string;
  result: PresentationReviewFeedbackMutationResponse;
}
export interface PresentationReviewFeedbackRepository {
  enableReview(
    input: PresentationReviewAuthorContext & { request: EnablePresentationReview },
  ): Promise<PresentationReviewFeedbackMutationResult>;
  getReviewAccess(input: {
    shareId: string;
    tokenHash: string;
    actorId?: string;
    now: Date;
  }): Promise<{ workspaceId: string; access: PresentationReviewFeedbackAccess }>;
  getAuthorReview(
    input: PresentationReviewAuthorContext,
  ): Promise<PresentationReviewFeedbackResult>;
  getReviewerReview(
    input: PresentationReviewReviewerContext,
  ): Promise<PresentationReviewFeedbackResult>;
  mutateAuthorReview(
    input: PresentationReviewAuthorContext & { mutation: PresentationReviewFeedbackMutation },
  ): Promise<PresentationReviewFeedbackMutationResult>;
  mutateReviewerReview(
    input: PresentationReviewReviewerContext & { mutation: PresentationReviewFeedbackMutation },
  ): Promise<PresentationReviewFeedbackMutationResult>;
}
