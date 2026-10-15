export type PresentationSessionServiceErrorCode =
  | "NOT_FOUND"
  | "PHASE_CLOSED"
  | "PARTICIPANT_LIMIT"
  | "INSTITUTION_AUTH_REQUIRED"
  | "UNAUTHORIZED"
  | "PASSWORD_REQUIRED"
  | "INVALID_PASSWORD"
  | "ENTITLEMENT_LIMIT"
  | "VALIDATION_ERROR"
  | "CONFLICT"
  | "STALE_SESSION"
  | "IDEMPOTENCY_CONFLICT"
  | "ALREADY_RESPONDED"
  | "REPORT_UNAVAILABLE";

export class PresentationSessionServiceError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: PresentationSessionServiceErrorCode,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "PresentationSessionServiceError";
  }
}
