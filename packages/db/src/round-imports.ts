import { createHash } from "node:crypto";

/** The source and preview stay in the caller; durable receipts retain only compact digests. */
export interface RoundImportIdentity {
  workspaceId: string;
  actorId: string;
  idempotencyKey: string;
  requestHash: string;
}

export class RoundImportError extends Error {
  constructor(
    public readonly code: "UNAUTHORIZED" | "IDEMPOTENCY_CONFLICT" | "IMPORT_TARGET_UNAVAILABLE",
  ) {
    super(
      code === "UNAUTHORIZED"
        ? "Your workspace role does not allow this action"
        : code === "IDEMPOTENCY_CONFLICT"
          ? "This import request key was already used with different content"
          : "The imported Round was archived or deleted. Start a new import to create another draft.",
    );
  }
}

export function roundImportActorHash(actorId: string) {
  return createHash("sha256")
    .update(`round-import-actor-v1:${actorId.toLowerCase()}`)
    .digest("hex");
}

export function roundImportKey(input: RoundImportIdentity) {
  return `${input.workspaceId}:${roundImportActorHash(input.actorId)}:${input.idempotencyKey}`;
}
