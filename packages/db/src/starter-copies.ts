import { createHash } from "node:crypto";
import {
  STARTER_COPY_INTENT_CLOCK_SKEW_MS,
  STARTER_COPY_INTENT_TTL_MS,
} from "@openround/contracts";

export interface StarterCopyIdentity {
  workspaceId: string;
  actorId: string;
  idempotencyKey: string;
  requestHash: string;
  expiresAt: Date;
}

export class StarterCopyError extends Error {
  constructor(
    public readonly code:
      | "UNAUTHORIZED"
      | "IDEMPOTENCY_CONFLICT"
      | "STARTER_COPY_EXPIRED"
      | "STARTER_COPY_TARGET_UNAVAILABLE"
      | "INVALID_INTENT",
  ) {
    super(
      code === "UNAUTHORIZED"
        ? "Your workspace role does not allow this action"
        : code === "IDEMPOTENCY_CONFLICT"
          ? "This starter copy request key was already used with different content"
          : code === "STARTER_COPY_EXPIRED"
            ? "This starter copy request expired. Start a new copy to continue."
            : code === "STARTER_COPY_TARGET_UNAVAILABLE"
              ? "The original starter copy was archived or deleted. Start a new copy to continue."
              : "Starter copy requests may remain available for up to 24 hours",
    );
  }
}

export function starterCopyActorHash(actorId: string) {
  return createHash("sha256")
    .update(`starter-copy-actor-v1:${actorId.toLowerCase()}`)
    .digest("hex");
}

export function starterCopyKey(identity: StarterCopyIdentity) {
  return `${identity.workspaceId}:${starterCopyActorHash(identity.actorId)}:${identity.idempotencyKey}`;
}

/** Call only after checking for an accepted receipt, and again after acquiring write locks. */
export function assertStarterCopyFresh(expiresAt: Date, now = new Date()) {
  const remaining = expiresAt.getTime() - now.getTime();
  if (remaining <= 0) throw new StarterCopyError("STARTER_COPY_EXPIRED");
  if (
    !Number.isFinite(remaining) ||
    remaining > STARTER_COPY_INTENT_TTL_MS + STARTER_COPY_INTENT_CLOCK_SKEW_MS
  )
    throw new StarterCopyError("INVALID_INTENT");
}
