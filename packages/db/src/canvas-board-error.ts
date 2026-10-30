export class CanvasBoardError extends Error {
  constructor(
    public readonly code:
      | "NOT_FOUND"
      | "UNAUTHORIZED"
      | "FORBIDDEN"
      | "STALE_DRAFT"
      | "IDEMPOTENCY_CONFLICT"
      | "ROOM_CLOSED"
      | "VALIDATION_ERROR"
      | "ENTITLEMENT_LIMIT"
      | "RATE_LIMITED",
    message: string,
  ) {
    super(message);
  }
}
