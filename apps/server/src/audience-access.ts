import type { AudienceRole } from "@openround/contracts";
import type {
  ParticipantRecord,
  PresentationSessionCredentialRecord,
  PresentationSessionParticipantRecord,
  PresentationSessionRecord,
  PresentationSessionRepository,
  Repository,
  SessionStaffCredentialRecord,
  StoredSession,
} from "@openround/db";
import { hashToken, safeHashEqual } from "./security.js";

export class AudienceAccessError extends Error {
  constructor(
    public readonly code: "NOT_FOUND" | "UNAUTHORIZED",
    message: string,
  ) {
    super(message);
  }
}

export type RoundParticipantActor = {
  kind: "participant";
  participant: ParticipantRecord;
  session: StoredSession;
};
export type RoundStaffActor = {
  kind: "staff";
  rootHost: boolean;
  credential: SessionStaffCredentialRecord | null;
  session: StoredSession;
};
export type RoundAudienceActor = RoundParticipantActor | RoundStaffActor;

export function roundAudienceRole(actor: RoundAudienceActor): AudienceRole {
  return actor.kind === "participant"
    ? "participant"
    : actor.rootHost
      ? "host"
      : actor.credential!.role;
}

export function roundAudienceCanModerate(actor: RoundAudienceActor): actor is RoundStaffActor {
  return actor.kind === "staff" && (actor.rootHost || actor.credential?.role === "cohost");
}

/** Legacy adapter: keep Round records, credentials, routes, and projections unchanged. */
export class RoundAudienceAccess {
  constructor(private readonly repository: Repository) {}

  async authenticate(
    sessionId: string,
    token: string,
    now = new Date(),
  ): Promise<RoundAudienceActor> {
    if (!token) throw new AudienceAccessError("UNAUTHORIZED", "A session credential is required");
    const session = await this.repository.getSessionById(sessionId);
    if (!session || session.expiresAt <= now) {
      throw new AudienceAccessError("NOT_FOUND", "Live round not found");
    }
    const tokenHash = hashToken(token);
    const participant = await this.repository.getParticipantByToken(tokenHash);
    if (participant?.sessionId === sessionId) {
      const runtime = session.state.participants[participant.id];
      if (!runtime || runtime.kicked || participant.status === "kicked") {
        throw new AudienceAccessError("UNAUTHORIZED", "Participant access has been revoked");
      }
      return { kind: "participant", participant, session };
    }
    if (safeHashEqual(session.hostTokenHash, tokenHash)) {
      return { kind: "staff", rootHost: true, credential: null, session };
    }
    const credential = await this.repository.getSessionStaffByToken(tokenHash, now);
    if (credential?.sessionId !== sessionId || credential.workspaceId !== session.workspaceId) {
      throw new AudienceAccessError("UNAUTHORIZED", "Session credential is invalid or expired");
    }
    return { kind: "staff", rootHost: false, credential, session };
  }
}

export type PresentationAudienceActor = {
  session: PresentationSessionRecord;
} & (
  | { role: "participant"; participant: PresentationSessionParticipantRecord; credential: null }
  | {
      role: "host" | "companion";
      participant: null;
      credential: PresentationSessionCredentialRecord;
    }
);

/** The audience layer must never turn a Companion pass into a moderation/host pass. */
export class PresentationAudienceAccess {
  constructor(private readonly repository: PresentationSessionRepository) {}

  async authenticate(
    sessionId: string,
    token: string,
    now = new Date(),
  ): Promise<PresentationAudienceActor> {
    if (!token) throw new AudienceAccessError("UNAUTHORIZED", "A session credential is required");
    return this.authenticateHash(sessionId, hashToken(token), now);
  }

  /** Internal relay authorization only; HTTP/socket requests still require the original bearer. */
  async authenticateHash(
    sessionId: string,
    tokenHash: string,
    now = new Date(),
  ): Promise<PresentationAudienceActor> {
    if (!/^[a-f0-9]{64}$/.test(tokenHash))
      throw new AudienceAccessError("UNAUTHORIZED", "A valid credential hash is required");
    const session = await this.repository.getSessionById(sessionId);
    if (!session || session.liveExpiresAt <= now || session.retentionExpiresAt <= now) {
      throw new AudienceAccessError(
        "UNAUTHORIZED",
        "Presentation credential is invalid or expired",
      );
    }
    const participant = await this.repository.findParticipant(sessionId, tokenHash);
    if (participant?.workspaceId === session.workspaceId && participant.sessionId === sessionId) {
      return { role: "participant", participant, credential: null, session };
    }
    const credential = await this.repository.findValidCredential(
      sessionId,
      tokenHash,
      undefined,
      now,
    );
    if (
      credential?.workspaceId !== session.workspaceId ||
      credential.sessionId !== sessionId ||
      (credential.role !== "host" && credential.role !== "companion")
    ) {
      throw new AudienceAccessError(
        "UNAUTHORIZED",
        "Presentation credential is invalid or expired",
      );
    }
    return { role: credential.role, participant: null, credential, session };
  }
}
