import { randomInt, randomUUID } from "node:crypto";
import { setImmediate as yieldToEventLoop } from "node:timers/promises";
import { SpanStatusCode, trace, type Attributes } from "@opentelemetry/api";
import {
  canonicalizeResponse,
  canUseRoundProtocol,
  deriveRoundProtocol,
  ROUND_CLIENT_UPDATE_MESSAGE,
  type RoundClientCapabilities,
  responseForAnswer,
  type AnswerAck,
  type AnswerSubmit,
  type EventEnvelope,
  type ExperiencePresetId,
  type HostCommand,
  type JoinPreflightRequest,
  type JoinPreflightResponse,
  type JoinRequest,
  type JoinResponse,
  type Report,
  type SessionSettings,
  type SessionSnapshot,
  type SessionStaffRole,
  type SyncRequest,
  type SyncResponse,
} from "@openround/contracts";
import { resolveExperienceTheme } from "@openround/experience";
import {
  SessionCodeConflictError,
  SessionNotActiveError,
  SessionVersionConflictError,
  WorkspaceDeletionInProgressError,
  createPlatformRepository,
  PlatformError,
  MemoryRepository,
  type AudienceOutboxRecord,
  type CreatorContext,
  type ParticipantRecord,
  type Repository,
  type SessionInvalidationTarget,
  type SessionStaffCredentialRecord,
  type SessionStaffCredentialReplacement,
  type StoredSession,
} from "@openround/db";
import {
  acceptAnswer,
  addParticipant,
  applyHostCommand,
  avatarIdForSeed,
  EngineError,
  setParticipantConnection,
  snapshotForRole,
  createGameState,
  upgradeGameState,
  type EngineAnswer,
  type EngineEvent,
  type GameState,
} from "@openround/game-engine";
import type { AppConfig } from "./config.js";
import type { SessionCache } from "./cache.js";
import {
  friendlyNickname,
  hashToken,
  nicknameAllowed,
  normalizeNickname,
  opaqueToken,
  safeHashEqual,
} from "./security.js";
import { createPendingReport } from "./reporting.js";
import { hashRoomPassword, verifyRoomPassword } from "./room-password.js";
import type { MetricsService } from "./metrics.js";
import { retentionExpiry } from "./entitlements.js";
import {
  roomCreationPolicy,
  roomEntitlements,
  coverageRequest,
  roomCreationIdentity,
} from "./room-entitlements.js";
import { ProductEventDispatcher, type ProductEventInput } from "./product-events.js";
import { evidenceWorkspaceFeatureEnabled } from "./workspace-rollout.js";
import { decisionEventsForTransition } from "./session-decision-replay.js";
import {
  approvedTextAnswerIds,
  moderationPage,
  moderationPageSelection,
  textResults,
  type TextModerationPageQuery,
  type TextResponsePageQuery,
} from "./response-moderation.js";
import {
  extendedRoundResponseWriteAllowed,
  richerRoundResponsesEnabled,
  EXTENDED_ROUND_RESPONSE_UNAVAILABLE_MESSAGE,
} from "./round-response-rollout.js";

export interface SessionMutation {
  state: GameState;
  events: EngineEvent[];
  reportId?: string;
}

type MutationListener = (mutation: SessionMutation) => void | Promise<void>;

export interface SessionAuxiliaryEvent {
  sessionId: string;
  type: `qna.${string}` | "session.staff.revoked";
  payload: Record<string, unknown>;
}

type AuxiliaryListener = (event: SessionAuxiliaryEvent) => void | Promise<void>;

export type SessionAudienceEvent = Pick<
  AudienceOutboxRecord,
  "eventId" | "sessionId" | "audienceSeq" | "type" | "payload" | "createdAt"
>;

type AudienceListener = (event: SessionAudienceEvent) => boolean | void | Promise<boolean | void>;

interface PendingAnswer {
  input: AnswerSubmit;
  participant: ParticipantRecord;
  receivedAtMs: number;
  resolve: (acknowledgement: AnswerAck) => void;
  reject: (error: unknown) => void;
}

interface AnswerBatch {
  items: PendingAnswer[];
  timer: NodeJS.Timeout;
  deadlineAtMs: number;
  awaitingParticipantIds: Set<string> | null;
}

interface AnswerIngress {
  receivedAtMs: number;
  ready: Promise<void>;
  settled: Promise<void>;
}

interface AnswerIngressBarrier {
  cutoffs: Map<symbol, number>;
  items: PendingAnswer[];
}

interface PendingJoin {
  input: JoinRequest;
  resolve: (response: JoinResponse) => void;
  reject: (error: unknown) => void;
}

interface JoinBatch {
  items: PendingJoin[];
  timer: NodeJS.Timeout;
}

// Use a short quiet window so one synchronized response burst reaches a single
// durable write. Cap the total wait so a steady trickle is still acknowledged
// well inside the participant receipt target.
const answerBatchWindowMs = 50;
const maximumAnswerBatchWaitMs = 150;
const maximumAnswerBatchSize = 250;
const joinBatchWindowMs = 50;
const maximumJoinBatchSize = 250;
// Admit the supported ten-room synchronized load while leaving five of the
// repository's fifteen PostgreSQL connections for host and recovery traffic.
const maximumConcurrentAnswerCommits = 10;

export class SessionError extends Error {
  constructor(
    public readonly code:
      | "INVALID_CODE"
      | "SESSION_FULL"
      | "SESSION_LOCKED"
      | "NICKNAME_REJECTED"
      | "PASSWORD_REQUIRED"
      | "INVALID_PASSWORD"
      | "RATE_LIMITED"
      | "STALE_VERSION"
      | "ANSWER_LATE"
      | "ANSWER_INVALID"
      | "ENTITLEMENT_LIMIT"
      | "INSTITUTION_AUTH_REQUIRED"
      | "UNAUTHORIZED"
      | "NOT_FOUND"
      | "CLIENT_UPDATE_REQUIRED"
      | "CONFLICT",
    message: string,
  ) {
    super(message);
  }
}

function requireRoundClient(
  state: Pick<GameState, "roundProtocol">,
  client?: RoundClientCapabilities,
) {
  if (!canUseRoundProtocol(state.roundProtocol, client)) {
    throw new SessionError("CLIENT_UPDATE_REQUIRED", ROUND_CLIENT_UPDATE_MESSAGE);
  }
}

export class SessionService {
  private readonly active = new Map<string, StoredSession>();
  private readonly queues = new Map<string, Promise<unknown>>();
  private readonly timers = new Map<string, NodeJS.Timeout>();
  private readonly answerBatches = new Map<string, AnswerBatch>();
  private readonly answerIngress = new Map<string, Set<AnswerIngress>>();
  private readonly answerIngressBarriers = new Map<string, AnswerIngressBarrier>();
  private activeAnswerCommits = 0;
  private readonly answerCommitWaiters: Array<() => void> = [];
  private readonly joinBatches = new Map<string, JoinBatch>();
  private readonly participantCredentials = new Map<string, ParticipantRecord>();
  private readonly listeners = new Set<MutationListener>();
  private readonly auxiliaryListeners = new Set<AuxiliaryListener>();
  private readonly audienceListeners = new Set<AudienceListener>();
  private readonly tracer = trace.getTracer("openround-game-service");
  private readonly productEvents: ProductEventDispatcher;
  private closing = false;

  constructor(
    private readonly repository: Repository,
    private readonly cache: SessionCache,
    private readonly config: AppConfig,
    private readonly metrics: MetricsService,
    productEvents?: ProductEventDispatcher,
    private readonly otherLiveRoomCodeInUse?: (code: string) => Promise<boolean>,
  ) {
    this.productEvents = productEvents ?? new ProductEventDispatcher(repository, metrics);
  }

  private uxBetaEnabled(workspaceId: string) {
    return (
      this.config.FEATURE_UX_BETA && this.config.UX_BETA_WORKSPACE_ALLOWLIST.includes(workspaceId)
    );
  }

  private recordSessionProductEvents(
    workspaceId: string,
    events: ProductEventInput[],
    segment?: CreatorContext["segment"],
  ) {
    if (!this.uxBetaEnabled(workspaceId) || events.length === 0) return;
    this.productEvents.enqueue({
      workspaceId,
      events,
      ...(segment ? { segment } : {}),
    });
  }

  private lifecycleProductEvents(events: EngineEvent[], occurredAt = new Date()) {
    return events.flatMap((event): ProductEventInput[] => {
      switch (event.type) {
        case "question.locked":
          return [
            {
              name: "question_locked",
              occurredAt: occurredAt.toISOString(),
              dimensions: { artifactType: "round" },
            },
          ];
        case "checkpoint.insight":
          return [
            {
              name: "insight_shown",
              occurredAt: occurredAt.toISOString(),
              dimensions: { artifactType: "round" },
            },
          ];
        case "recheck.open":
          return [
            {
              name: "recheck_opened",
              occurredAt: occurredAt.toISOString(),
              dimensions: { artifactType: "round" },
            },
          ];
        default:
          return [];
      }
    });
  }

  subscribe(listener: MutationListener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  subscribeAuxiliary(listener: AuxiliaryListener) {
    this.auxiliaryListeners.add(listener);
    return () => this.auxiliaryListeners.delete(listener);
  }

  async publishAuxiliary(event: SessionAuxiliaryEvent) {
    for (const listener of this.auxiliaryListeners) await listener(event);
  }

  subscribeAudience(listener: AudienceListener) {
    this.audienceListeners.add(listener);
    return () => this.audienceListeners.delete(listener);
  }

  async publishAudience(event: SessionAudienceEvent) {
    let delivered = true;
    for (const listener of this.audienceListeners) {
      if ((await listener(event)) === false) delivered = false;
    }
    return delivered;
  }

  private traceOperation<T>(name: string, attributes: Attributes, work: () => Promise<T>) {
    return this.tracer.startActiveSpan(name, { attributes }, async (span) => {
      try {
        return await work();
      } catch (error) {
        span.setStatus({ code: SpanStatusCode.ERROR });
        span.recordException(error instanceof Error ? error : String(error));
        throw error;
      } finally {
        span.end();
      }
    });
  }

  private async publish(mutation: SessionMutation) {
    this.metrics.recordSessionEvents(mutation.events.map((event) => event.type));
    for (const listener of this.listeners) await listener(mutation);
  }

  private async exclusive<T>(sessionId: string, work: () => Promise<T>): Promise<T> {
    const prior = this.queues.get(sessionId) ?? Promise.resolve();
    let resolveCurrent!: () => void;
    const current = new Promise<void>((resolve) => {
      resolveCurrent = resolve;
    });
    const chained = prior.then(() => current);
    this.queues.set(sessionId, chained);
    await prior;
    try {
      return await work();
    } finally {
      resolveCurrent();
      if (this.queues.get(sessionId) === chained) this.queues.delete(sessionId);
    }
  }

  private async mutate<T>(
    sessionId: string,
    operation:
      "answer" | "create" | "deadline" | "delete" | "disconnect" | "host" | "join" | "resume",
    work: () => Promise<T>,
  ): Promise<T> {
    return this.exclusive(sessionId, async () => {
      if (this.closing) throw new SessionError("CONFLICT", "The server is shutting down");
      const owner = randomUUID();
      const startedAt = performance.now();
      const waitUntil = Date.now() + this.config.SESSION_MUTATION_LEASE_WAIT_MS;
      let acquired: boolean;
      try {
        acquired = await this.cache.acquireMutationLease(
          sessionId,
          owner,
          this.config.SESSION_MUTATION_LEASE_TTL_MS,
        );
        while (!acquired) {
          const remainingMs = waitUntil - Date.now();
          if (remainingMs <= 0) break;
          await new Promise((resolve) =>
            setTimeout(resolve, Math.min(25, Math.max(5, remainingMs))),
          );
          acquired = await this.cache.acquireMutationLease(
            sessionId,
            owner,
            this.config.SESSION_MUTATION_LEASE_TTL_MS,
          );
        }
      } catch {
        this.metrics.observeMutationLease("error", (performance.now() - startedAt) / 1_000);
        throw new SessionError("CONFLICT", "Session coordination is temporarily unavailable");
      }
      if (!acquired) {
        this.metrics.observeMutationLease("timeout", (performance.now() - startedAt) / 1_000);
        throw new SessionError("CONFLICT", "The session is busy; synchronize and retry");
      }
      this.metrics.observeMutationLease("acquired", (performance.now() - startedAt) / 1_000);

      const renewal = setInterval(
        () => {
          void this.cache
            .renewMutationLease(sessionId, owner, this.config.SESSION_MUTATION_LEASE_TTL_MS)
            .then((renewed) => {
              if (!renewed) this.metrics.mutationLeaseRenewalFailed();
            })
            .catch(() => this.metrics.mutationLeaseRenewalFailed());
        },
        Math.max(250, Math.floor(this.config.SESSION_MUTATION_LEASE_TTL_MS / 3)),
      );
      renewal.unref();

      try {
        let conflictRetries = 0;
        while (true) {
          try {
            return await work();
          } catch (error) {
            if (!(error instanceof SessionVersionConflictError)) throw error;
            this.active.delete(sessionId);
            this.metrics.setActiveSessions(this.active.size);
            this.metrics.sessionVersionConflict(operation);
            if (operation !== "join" && conflictRetries === 0) {
              conflictRetries += 1;
              continue;
            }
            throw new SessionError(
              operation === "host" ? "STALE_VERSION" : "CONFLICT",
              "Session state changed; synchronize and retry",
            );
          }
        }
      } finally {
        clearInterval(renewal);
        await this.cache.releaseMutationLease(sessionId, owner).catch(() => undefined);
      }
    });
  }

  private async loadSession(sessionId: string): Promise<StoredSession | null> {
    const persisted = await this.repository.getSessionById(sessionId);
    if (!persisted || persisted.expiresAt.getTime() <= Date.now()) {
      this.active.delete(sessionId);
      this.metrics.setActiveSessions(this.active.size);
      if (persisted) await this.cache.delete(sessionId).catch(() => undefined);
      return null;
    }
    const cached = await this.cache.get(sessionId);
    // Check after the last asynchronous cache read. If deletion fenced the workspace while this
    // load was in flight, do not republish the now-deleted session into the process-local cache.
    if (await this.repository.workspaceDeletionStarted(persisted.workspaceId)) {
      this.active.delete(sessionId);
      this.metrics.setActiveSessions(this.active.size);
      await this.cache.delete(sessionId).catch(() => undefined);
      return null;
    }
    persisted.state = upgradeGameState(persisted.state);
    if (cached && cached.version >= persisted.state.version) {
      persisted.state = upgradeGameState(cached);
    }
    persisted.state.uxBeta = this.uxBetaEnabled(persisted.workspaceId);
    this.active.set(sessionId, persisted);
    this.metrics.setActiveSessions(this.active.size);
    this.scheduleDeadline(persisted);
    return persisted;
  }

  private async loadSessionForMutation(sessionId: string): Promise<StoredSession | null> {
    const active = this.active.get(sessionId);
    if (active) {
      if (active.expiresAt.getTime() <= Date.now()) {
        this.active.delete(sessionId);
        this.metrics.setActiveSessions(this.active.size);
        await this.cache.delete(sessionId).catch(() => undefined);
        return null;
      }
      if (await this.repository.workspaceDeletionStarted(active.workspaceId)) {
        this.active.delete(sessionId);
        this.metrics.setActiveSessions(this.active.size);
        await this.cache.delete(sessionId).catch(() => undefined);
        return null;
      }
      const cached = await this.cache.get(sessionId);
      if (cached && cached.version >= active.state.version) {
        active.state = upgradeGameState(cached);
        active.state.uxBeta = this.uxBetaEnabled(active.workspaceId);
        this.scheduleDeadline(active);
        return active;
      }
      active.state.uxBeta = this.uxBetaEnabled(active.workspaceId);
    }
    return this.loadSession(sessionId);
  }

  private async participantForToken(token: string) {
    const tokenHash = hashToken(token);
    const cached = this.participantCredentials.get(tokenHash);
    if (cached) return cached;
    const participant = await this.repository.getParticipantByToken(tokenHash);
    if (participant) this.participantCredentials.set(tokenHash, participant);
    return participant;
  }

  private async staffForTokenHash(tokenHash: string) {
    return this.repository.getSessionStaffByToken(tokenHash, new Date());
  }

  private async authorizeStaffTokenHash(
    session: StoredSession,
    tokenHash: string,
    allowedRoles: SessionStaffRole[],
  ): Promise<{ rootHost: boolean; credential: SessionStaffCredentialRecord | null }> {
    if (safeHashEqual(session.hostTokenHash, tokenHash)) {
      const principal = await this.repository.getUserPrincipalById(session.hostId);
      // Memory-only protocol fixtures may use synthetic hosts; persisted customers must exist.
      if (
        !principal &&
        (!(this.repository instanceof MemoryRepository) ||
          this.repository.users.has(session.hostId))
      ) {
        throw new SessionError("UNAUTHORIZED", "The hosting account no longer has access");
      }
      return { rootHost: true, credential: null };
    }
    const credential = await this.staffForTokenHash(tokenHash);
    if (
      !credential ||
      credential.sessionId !== session.id ||
      credential.workspaceId !== session.workspaceId ||
      !allowedRoles.includes(credential.role)
    ) {
      throw new SessionError("UNAUTHORIZED", "Session staff credential is invalid or expired");
    }
    return { rootHost: false, credential };
  }

  private authorizeStaff(session: StoredSession, token: string, allowedRoles: SessionStaffRole[]) {
    return this.authorizeStaffTokenHash(session, hashToken(token), allowedRoles);
  }

  async realtimeStaffIdentity(sessionId: string, token: string, role: "host" | "presenter") {
    const session = await this.loadSession(sessionId);
    if (!session) throw new SessionError("NOT_FOUND", "Session not found");
    const tokenHash = hashToken(token);
    const staff = await this.authorizeStaffTokenHash(
      session,
      tokenHash,
      role === "presenter" ? ["cohost", "presenter"] : ["cohost"],
    );
    return {
      credentialId: staff.credential?.id ?? null,
      credentialRole: staff.credential?.role ?? "host",
      expiresAtMs: staff.credential?.expiresAt.getTime() ?? null,
      tokenHash,
    };
  }

  async revalidateRealtimeStaff(sessionId: string, tokenHash: string, role: "host" | "presenter") {
    const session = await this.loadSession(sessionId);
    if (!session) throw new SessionError("NOT_FOUND", "Session not found");
    await this.authorizeStaffTokenHash(
      session,
      tokenHash,
      role === "presenter" ? ["cohost", "presenter"] : ["cohost"],
    );
  }

  async revalidateRealtimeParticipant(
    sessionId: string,
    participantToken: string,
    expectedParticipantId: string,
  ) {
    const [session, participant] = await Promise.all([
      this.repository.getSessionById(sessionId),
      this.repository.getParticipantByToken(hashToken(participantToken)),
    ]);
    if (!session || session.expiresAt.getTime() <= Date.now()) {
      throw new SessionError("NOT_FOUND", "Session not found");
    }
    if (
      !participant ||
      participant.sessionId !== sessionId ||
      participant.id !== expectedParticipantId
    ) {
      throw new SessionError("UNAUTHORIZED", "Participant credential is invalid");
    }
    const runtimeParticipant = session.state.participants[participant.id];
    if (!runtimeParticipant || runtimeParticipant.kicked || participant.status === "kicked") {
      throw new SessionError("UNAUTHORIZED", "Participant access has been revoked");
    }
  }

  async createSessionStaffCredential(
    creator: CreatorContext,
    sessionId: string,
    input: { role: SessionStaffRole; label: string; expiresInMinutes: number },
  ) {
    if (creator.role === "viewer") {
      throw new SessionError("UNAUTHORIZED", "Viewers cannot create session staff credentials");
    }
    const session = await this.repository.getSessionById(sessionId);
    if (!session || session.workspaceId !== creator.workspaceId) {
      throw new SessionError("NOT_FOUND", "Session not found");
    }
    if (
      input.role === "cohost" &&
      !(
        await roomEntitlements(
          this.repository,
          this.config,
          "round",
          sessionId,
          creator.workspaceId,
        )
      ).cohosting
    ) {
      throw new SessionError(
        "ENTITLEMENT_LIMIT",
        "Shareable cohost access is available on Pro, Team, and Community plans",
      );
    }
    const token = opaqueToken();
    const embedPolicyKey = input.role === "presenter" ? opaqueToken() : undefined;
    const embedAllowedOrigins =
      input.role === "presenter"
        ? await this.repository.getEmbedAllowedOrigins(creator.workspaceId)
        : [];
    const now = new Date();
    const requestedExpiry = new Date(now.getTime() + input.expiresInMinutes * 60_000);
    const record = await this.repository.createSessionStaffCredential({
      id: randomUUID(),
      workspaceId: creator.workspaceId,
      sessionId,
      role: input.role,
      purpose: "collaboration",
      label: input.label,
      tokenHash: hashToken(token),
      embedPolicyKeyHash: embedPolicyKey ? hashToken(embedPolicyKey) : null,
      embedAllowedOrigins,
      createdBy: creator.userId,
      expiresAt:
        requestedExpiry < session.expiresAt ? requestedExpiry : new Date(session.expiresAt),
      revokedAt: null,
      createdAt: now,
    });
    return {
      token,
      ...(embedPolicyKey ? { embedPolicyKey } : {}),
      ...(input.role === "presenter" ? { embedAllowedOrigins } : {}),
      credential: {
        id: record.id,
        sessionId: record.sessionId,
        role: record.role,
        purpose: record.purpose,
        label: record.label,
        expiresAt: record.expiresAt.toISOString(),
        revokedAt: record.revokedAt?.toISOString() ?? null,
        createdAt: record.createdAt.toISOString(),
      },
    };
  }

  async createCreatorControlPass(creator: CreatorContext, sessionId: string, now = new Date()) {
    if (creator.role === "viewer") {
      throw new SessionError("UNAUTHORIZED", "Viewers cannot resume live sessions");
    }
    const session = await this.repository.getSessionById(sessionId);
    if (!session || session.workspaceId !== creator.workspaceId) {
      throw new SessionError("NOT_FOUND", "Session not found");
    }
    if (session.state.phase === "finished" || session.expiresAt <= now) {
      throw new SessionError("CONFLICT", "Only an active live session can be resumed");
    }
    const token = opaqueToken();
    const expiresAt = new Date(
      Math.min(session.expiresAt.getTime(), now.getTime() + 4 * 60 * 60_000),
    );
    let replacement: SessionStaffCredentialReplacement;
    try {
      replacement = await this.repository.replaceCreatorResumeCredential({
        id: randomUUID(),
        workspaceId: creator.workspaceId,
        sessionId,
        role: "cohost",
        purpose: "creator_resume",
        label: "Creator resume",
        tokenHash: hashToken(token),
        embedPolicyKeyHash: null,
        embedAllowedOrigins: [],
        createdBy: creator.userId,
        expiresAt,
        revokedAt: null,
        createdAt: now,
      });
    } catch (error) {
      if (error instanceof SessionNotActiveError) {
        throw new SessionError("CONFLICT", "Only an active live session can be resumed");
      }
      throw error;
    }
    for (const credentialId of replacement.revokedCredentialIds) {
      await this.publishAuxiliary({
        sessionId,
        type: "session.staff.revoked",
        payload: { credentialId },
      }).catch(() => undefined);
    }
    const record = replacement.credential;
    return {
      token,
      credential: {
        id: record.id,
        sessionId: record.sessionId,
        role: record.role,
        purpose: record.purpose,
        label: record.label,
        expiresAt: record.expiresAt.toISOString(),
        revokedAt: null,
        createdAt: record.createdAt.toISOString(),
      },
    };
  }

  private async save(
    session: StoredSession,
    events: EngineEvent[],
    expectedVersion: number,
    report?: Report,
    decisionEvents: Parameters<Repository["saveSession"]>[3] = [],
  ) {
    session.updatedAt = new Date();
    await this.repository.saveSession(session, expectedVersion, report, decisionEvents);
    this.active.set(session.id, session);
    this.metrics.setActiveSessions(this.active.size);
    await Promise.allSettled([
      this.cache.set(session.state, this.liveCacheTtlSeconds(session)),
      this.cache.appendEvents(
        session.id,
        events.map((event) => ({
          seq: event.seq,
          type: event.type,
          payload: {
            version: session.state.version,
          },
        })),
      ),
    ]);
    if (session.state.phase === "finished") {
      await this.cache.releaseSessionCode(session.state.code, session.id).catch(() => undefined);
    }
    this.scheduleDeadline(session);
  }

  private liveCacheTtlSeconds(session: StoredSession) {
    return Math.max(1, Math.ceil((session.expiresAt.getTime() - Date.now()) / 1_000));
  }

  private scheduleDeadline(session: StoredSession) {
    const existing = this.timers.get(session.id);
    if (existing) clearTimeout(existing);
    this.timers.delete(session.id);
    if (
      session.state.phase !== "question_open" ||
      session.state.settings.timeMode === "flex" ||
      session.state.deadlineMs === null
    )
      return;
    const delay = Math.max(0, session.state.deadlineMs - Date.now());
    const deadlineMs = session.state.deadlineMs;
    const timer = setTimeout(
      () => {
        this.timers.delete(session.id);
        void this.autoLock(session.id, deadlineMs).catch(() => undefined);
      },
      Math.min(delay + answerBatchWindowMs + 5, 2_147_483_647),
    );
    timer.unref();
    this.timers.set(session.id, timer);
  }

  private async autoLock(sessionId: string, deadlineMs: number) {
    const barrierToken = this.registerAnswerIngressBarrier(sessionId, deadlineMs);
    try {
      await this.flushAnswersReceivedBy(sessionId, deadlineMs);
      await this.mutate(sessionId, "deadline", async () => {
        const session = await this.loadSessionForMutation(sessionId);
        if (
          !session ||
          session.state.phase !== "question_open" ||
          session.state.settings.timeMode === "flex" ||
          session.state.deadlineMs === null
        )
          return;
        if (session.state.deadlineMs && Date.now() < session.state.deadlineMs) {
          this.scheduleDeadline(session);
          return;
        }
        const priorState = session.state;
        const lockTimeMs = Date.now();
        const result = applyHostCommand(session.state, {
          action: "lock",
          commandId: `deadline:${session.state.roundId}`,
          expectedVersion: session.state.version,
          nowMs: lockTimeMs,
          newRoundId: randomUUID,
        });
        session.state = result.state;
        const decisionEvents = session.decisionReplayEnabled
          ? decisionEventsForTransition({
              before: priorState,
              after: result.state,
              engineEvents: result.events,
              action: "deadline",
              commandId: `deadline:${priorState.roundId}`,
              occurredAt: new Date(lockTimeMs),
            })
          : [];
        try {
          await this.save(
            session,
            result.events,
            result.state.version - 1,
            undefined,
            decisionEvents,
          );
        } catch (error) {
          session.state = priorState;
          this.active.delete(session.id);
          this.metrics.setActiveSessions(this.active.size);
          throw error;
        }
        this.recordSessionProductEvents(
          session.workspaceId,
          this.lifecycleProductEvents(result.events, new Date(deadlineMs)),
        );
        await this.publish({ state: session.state, events: result.events });
      });
    } finally {
      this.releaseAnswerIngressBarrier(sessionId, barrierToken);
    }
  }

  async createSession(
    creator: CreatorContext,
    quizId: string,
    settings: SessionSettings,
    experience: {
      experiencePresetOverride?: ExperiencePresetId;
      presenterSoundEnabled?: boolean;
      clientCapabilities?: RoundClientCapabilities;
      useEventCredit?: boolean;
      joinPassword?: string;
      idempotencyKey?: string;
    } = {},
  ): Promise<{ sessionId: string; code: string; hostToken: string; snapshot: SessionSnapshot }> {
    if (creator.role === "viewer") {
      throw new SessionError("UNAUTHORIZED", "Viewers cannot host live rounds");
    }
    const previousIdentity =
      this.config.BUSINESS_PLATFORM_ENABLED && !this.config.COMMUNITY_MODE
        ? roomCreationIdentity(creator.workspaceId, "round", experience.idempotencyKey, {})
        : null;
    const previousRoom = previousIdentity
      ? await this.repository.getSessionById(previousIdentity.roomId)
      : null;
    const policy = previousRoom
      ? {
          entitlements: await roomEntitlements(
            this.repository,
            this.config,
            "round",
            previousRoom.id,
            creator.workspaceId,
          ),
          funding: null,
        }
      : await roomCreationPolicy(
          this.repository,
          this.config,
          creator.workspaceId,
          experience.useEventCredit,
        );
    if (experience.joinPassword !== undefined && policy.entitlements.plan === "free") {
      throw new SessionError("ENTITLEMENT_LIMIT", "Password-protected rooms require a paid plan");
    }
    const joinPasswordHash =
      experience.joinPassword === undefined
        ? undefined
        : await hashRoomPassword(
            experience.joinPassword,
            experience.idempotencyKey
              ? `${creator.workspaceId}:round:${experience.idempotencyKey}`
              : undefined,
          );
    const creation =
      this.config.BUSINESS_PLATFORM_ENABLED && !this.config.COMMUNITY_MODE
        ? roomCreationIdentity(creator.workspaceId, "round", experience.idempotencyKey, {
            quizId,
            settings,
            experiencePresetOverride: experience.experiencePresetOverride,
            presenterSoundEnabled: experience.presenterSoundEnabled ?? false,
            useEventCredit: experience.useEventCredit ?? false,
            joinPasswordHash,
          })
        : null;
    const replay = async (existing: StoredSession) => {
      requireRoundClient(existing.state, experience.clientCapabilities);
      const coverage = await createPlatformRepository(this.repository).getRoomCoverage(
        "round",
        existing.id,
      );
      if (!creation || coverage?.creationKey !== creation.creationKey) {
        throw new PlatformError(
          "CONFLICT",
          "Room idempotency key was used for a different request",
        );
      }
      const pass = await this.createCreatorControlPass(creator, existing.id);
      return {
        sessionId: existing.id,
        code: existing.state.code,
        hostToken: pass.token,
        snapshot: snapshotForRole(existing.state, { role: "host" }),
      };
    };
    // A retained entitlement snapshot only authorizes replay of this accepted room. Never
    // carry it into a replacement creation if the room is deleted while hashing the request.
    if (previousRoom) return replay(previousRoom);
    if (creation) {
      const existing = await this.repository.getSessionById(creation.roomId);
      if (existing) return replay(existing);
    }
    if (
      settings.timeMode === "flex" &&
      !evidenceWorkspaceFeatureEnabled(this.config, creator.workspaceId, "liveFlexMode")
    ) {
      throw new SessionError("NOT_FOUND", "Flex sessions are not available in this workspace");
    }
    if (settings.trustMode === "verified") {
      throw new SessionError(
        "INSTITUTION_AUTH_REQUIRED",
        "Verified sessions require an institution-bound learner launch, which is not enabled in this release",
      );
    }
    const institutionPolicy = await this.repository.getInstitutionPolicy(creator.workspaceId);
    if (institutionPolicy.identityRequirement === "institution") {
      throw new SessionError(
        "INSTITUTION_AUTH_REQUIRED",
        "Institution-identified live participation is not enabled in this release; keep guest or optional identity to host a round",
      );
    }
    const quiz = await this.repository.getQuiz(creator.workspaceId, quizId);
    if (!quiz?.currentVersionId)
      throw new SessionError("NOT_FOUND", "Publish the quiz before hosting it");
    const version = await this.repository.getQuizVersion(
      creator.workspaceId,
      quiz.currentVersionId,
    );
    if (!version) throw new SessionError("NOT_FOUND", "Published quiz version not found");
    if (!extendedRoundResponseWriteAllowed(this.config, creator.workspaceId, version.content)) {
      throw new SessionError("NOT_FOUND", EXTENDED_ROUND_RESPONSE_UNAVAILABLE_MESSAGE);
    }
    const roundProtocol = deriveRoundProtocol(version.content);
    requireRoundClient({ roundProtocol }, experience.clientCapabilities);
    const textCount = version.content.questions.filter(
      (question) => question.type === "open_text" || question.type === "word_cloud",
    ).length;
    if (textCount > 10 || (textCount > 0 && settings.audienceLimit > 250)) {
      throw new SessionError(
        "ENTITLEMENT_LIMIT",
        "Text sessions support up to 10 text checkpoints and 250 participants",
      );
    }
    const entitlements = policy.entitlements;
    if (settings.audienceLimit > entitlements.maxParticipants) {
      throw new SessionError(
        "ENTITLEMENT_LIMIT",
        `This plan supports up to ${entitlements.maxParticipants} live participants`,
      );
    }
    const brandTheme = entitlements.brandTheme
      ? await this.repository.getBrandTheme(creator.workspaceId)
      : null;
    const category = version.content.category ?? "general";
    const experienceTheme = resolveExperienceTheme({
      category,
      presetId: experience.experiencePresetOverride ?? version.content.experiencePreset?.id,
      soundEnabled: experience.presenterSoundEnabled,
      brandTheme,
    });

    const sessionId = creation?.roomId ?? randomUUID();
    const hostToken = opaqueToken();
    const now = new Date();
    const ttlMs = 24 * 60 * 60_000;
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const code = String(randomInt(0, 10_000_000)).padStart(7, "0");
      let reserved = false;
      let retained = false;
      try {
        try {
          reserved = await this.cache.reserveSessionCode(code, sessionId, ttlMs);
        } catch {
          throw new SessionError(
            "CONFLICT",
            "Session code coordination is temporarily unavailable",
          );
        }
        if (!reserved) continue;
        if (await this.repository.getSessionByCode(code)) continue;
        if (await this.otherLiveRoomCodeInUse?.(code)) continue;
        const session: StoredSession = {
          id: sessionId,
          workspaceId: creator.workspaceId,
          quizVersionId: version.id,
          hostId: creator.userId,
          hostTokenHash: hashToken(hostToken),
          joinPasswordHash,
          commercialCoverage: coverageRequest(policy, {
            artifactType: "round",
            roomId: sessionId,
            workspaceId: creator.workspaceId,
            actorId: creator.userId,
            expiresAt: new Date(now.getTime() + ttlMs),
            creationKey: creation?.creationKey,
          }),
          trustMode: settings.trustMode ?? "learning",
          decisionReplayEnabled: evidenceWorkspaceFeatureEnabled(
            this.config,
            creator.workspaceId,
            "decisionReplay",
          ),
          state: createGameState({
            sessionId,
            code,
            quiz: version.content,
            settings,
            brandTheme,
            experienceTheme,
            ...(richerRoundResponsesEnabled(this.config, creator.workspaceId)
              ? { roundProtocol }
              : {}),
            uxBeta: this.uxBetaEnabled(creator.workspaceId),
            // Freeze live Pack use with the room. Disabling rollout must not strand an
            // already-created room or require mutable source Pack access during playback.
            recoveryPackCardsEnabled: evidenceWorkspaceFeatureEnabled(
              this.config,
              creator.workspaceId,
              "recoveryPackLiveCards",
            ),
          }),
          expiresAt: new Date(now.getTime() + ttlMs),
          retentionExpiresAt: retentionExpiry(now, entitlements),
          createdAt: now,
          updatedAt: now,
        };
        return await this.mutate(sessionId, "create", async () => {
          if (creation) {
            const existing = await this.repository.getSessionById(sessionId);
            if (existing) return replay(existing);
          }
          await this.repository.createSession(session);
          retained = true;
          await this.cache.set(session.state, ttlMs / 1_000).catch(() => undefined);
          this.active.set(session.id, session);
          this.metrics.setActiveSessions(this.active.size);
          this.recordSessionProductEvents(
            session.workspaceId,
            [
              {
                name: "host_setup_completed",
                occurredAt: now.toISOString(),
                dimensions: { artifactType: "round" },
              },
            ],
            creator.segment,
          );
          return {
            sessionId,
            code,
            hostToken,
            snapshot: snapshotForRole(session.state, { role: "host" }),
          };
        });
      } catch (error) {
        if (creation && (error as { code?: string }).code === "23505") {
          const existing = await this.repository.getSessionById(creation.roomId);
          if (existing) return replay(existing);
        }
        if (error instanceof SessionCodeConflictError) continue;
        if (error instanceof WorkspaceDeletionInProgressError) {
          throw new SessionError("CONFLICT", "This workspace is being deleted");
        }
        if (error instanceof SessionNotActiveError) {
          throw new SessionError("SESSION_LOCKED", "This session has ended or expired");
        }
        throw error;
      } finally {
        if (reserved && !retained) {
          await this.cache.releaseSessionCode(code, sessionId).catch(() => undefined);
        }
      }
    }
    throw new SessionError("CONFLICT", "Could not reserve a session code");
  }

  async preflightJoin(input: JoinPreflightRequest): Promise<JoinPreflightResponse> {
    const unavailable = () =>
      new SessionError(
        "INVALID_CODE",
        "This round is not accepting joins. Check the code or ask the facilitator",
      );
    const stored = await this.repository.getSessionByCode(input.code);
    if (!stored || stored.expiresAt.getTime() <= Date.now()) throw unavailable();

    const state = upgradeGameState(stored.state);
    const institutionPolicy = await this.repository.getInstitutionPolicy(stored.workspaceId);
    const participantCount = Object.values(state.participants).filter(
      (participant) => !participant.kicked,
    ).length;
    if (
      institutionPolicy.identityRequirement === "institution" ||
      (stored.trustMode ?? state.settings.trustMode ?? "learning") === "verified" ||
      state.phase === "finished" ||
      state.lobbyLocked ||
      (!state.settings.allowLateJoin && state.phase !== "lobby") ||
      participantCount >= state.settings.audienceLimit
    ) {
      throw unavailable();
    }

    return {
      nicknamePolicy: state.settings.nicknamePolicy,
      passwordRequired: Boolean(stored.joinPasswordHash),
    };
  }

  async join(input: JoinRequest): Promise<JoinResponse> {
    // Shared cache budgets apply before password verification for both REST and sockets.
    if (!input.resumeToken) {
      const alias = hashToken((input.nickname ?? "").trim().toLocaleLowerCase());
      const buckets: Array<[string, number]> = [
        ...(input.nickname
          ? [[`round:join:alias:${input.code}:${alias}`, 10] as [string, number]]
          : []),
        [`round:join:room:${input.code}`, 600],
      ];
      for (const [key, maximum] of buckets) {
        if (!(await this.cache.consumeRateLimit(key, maximum, 60_000))) {
          throw new SessionError("RATE_LIMITED", "Too many join attempts. Wait a minute and retry");
        }
      }
    }
    const kind = input.resumeToken ? "resume" : "new";
    return this.traceOperation(
      "openround.session.join",
      { "openround.join.kind": kind },
      async () => {
        const startedAt = performance.now();
        try {
          const joined = await this.joinParticipant(input);
          this.metrics.recordJoin(kind, "success", (performance.now() - startedAt) / 1_000);
          trace.getActiveSpan()?.setAttribute("openround.outcome", "success");
          return joined;
        } catch (error) {
          const outcome =
            error instanceof SessionError ? error.code.toLocaleLowerCase("en-CA") : "error";
          this.metrics.recordJoin(kind, outcome, (performance.now() - startedAt) / 1_000);
          trace.getActiveSpan()?.setAttribute("openround.outcome", outcome);
          throw error;
        }
      },
    );
  }

  private async joinParticipant(input: JoinRequest): Promise<JoinResponse> {
    if (input.resumeToken) {
      const participant = await this.participantForToken(input.resumeToken);
      if (!participant) throw new SessionError("UNAUTHORIZED", "Resume token is invalid");
      return {
        participantId: participant.id,
        participantToken: input.resumeToken,
        snapshot: await this.reconnectParticipant(participant, input.clientCapabilities),
      };
    }

    return this.queueJoin(input.code, input);
  }

  private queueJoin(code: string, input: JoinRequest) {
    return new Promise<JoinResponse>((resolve, reject) => {
      let batch = this.joinBatches.get(code);
      if (!batch) {
        const items: PendingJoin[] = [];
        const timer = setTimeout(() => this.dispatchJoinBatch(code, items), joinBatchWindowMs);
        batch = { items, timer };
        this.joinBatches.set(code, batch);
      }
      batch.items.push({ input, resolve, reject });
      if (batch.items.length >= maximumJoinBatchSize) {
        clearTimeout(batch.timer);
        this.dispatchJoinBatch(code, batch.items);
      }
    });
  }

  private dispatchJoinBatch(code: string, items: PendingJoin[]) {
    const current = this.joinBatches.get(code);
    if (!current || current.items !== items) return;
    clearTimeout(current.timer);
    this.joinBatches.delete(code);
    void this.processJoinBatch(code, items).catch((error: unknown) => {
      for (const item of items) item.reject(error);
    });
  }

  private async processJoinBatch(code: string, items: PendingJoin[]) {
    const stored = await this.repository.getSessionByCode(code);
    if (!stored) throw new SessionError("INVALID_CODE", "Check the code and try again");
    if ((stored.trustMode ?? stored.state.settings.trustMode ?? "learning") === "verified") {
      throw new SessionError(
        "INSTITUTION_AUTH_REQUIRED",
        "Verified sessions require an institution-bound learner launch; anonymous code entry is disabled",
      );
    }
    const institutionPolicy = await this.repository.getInstitutionPolicy(stored.workspaceId);
    if (institutionPolicy.identityRequirement === "institution") {
      throw new SessionError(
        "INSTITUTION_AUTH_REQUIRED",
        "This workspace requires institution identity; anonymous code entry is disabled",
      );
    }

    // Protection is immutable for the run. Verify before acquiring the room mutation queue so
    // incorrect passwords cannot stall host commands or answer commits behind expensive hashes.
    // Synchronized guests normally share one password. Keep exact-value verification promises
    // only for this bounded batch, and start distinct checks together through Node's worker pool.
    const verifications = new Map<string | undefined, Promise<boolean>>();
    const decisions = await Promise.all(
      items.map(async (item) => {
        const password = item.input.password;
        if (stored.joinPasswordHash && !password) {
          item.reject(new SessionError("PASSWORD_REQUIRED", "Enter the room password to join"));
          return null;
        }
        let verification = verifications.get(password);
        if (!verification) {
          verification = verifyRoomPassword(password, stored.joinPasswordHash);
          verifications.set(password, verification);
        }
        if (!(await verification)) {
          item.reject(new SessionError("INVALID_PASSWORD", "The room password is incorrect"));
          return null;
        }
        return item;
      }),
    );
    const admitted = decisions.filter((item) => item !== null);
    if (admitted.length === 0) return;

    await this.mutate(stored.id, "join", async () => {
      const session = await this.loadSessionForMutation(stored.id);
      if (!session) throw new SessionError("INVALID_CODE", "Session is no longer available");
      const priorState = session.state;
      if (
        priorState.lobbyLocked ||
        (!priorState.settings.allowLateJoin && priorState.phase !== "lobby")
      ) {
        throw new SessionError("SESSION_LOCKED", "This session is not accepting new participants");
      }
      if (priorState.phase === "finished")
        throw new SessionError("SESSION_LOCKED", "This session has ended");

      let nextState = priorState;
      let participantCount = Object.values(priorState.participants).filter(
        (participant) => !participant.kicked,
      ).length;
      const normalizedNames = new Set(
        Object.values(priorState.participants).map((participant) =>
          participant.nickname.toLocaleLowerCase("en-CA"),
        ),
      );
      const accepted: Array<{
        item: PendingJoin;
        participant: ParticipantRecord;
        participantToken: string;
      }> = [];
      const events: EngineEvent[] = [];
      const eventVersions = new Map<number, number>();

      for (const item of admitted) {
        try {
          requireRoundClient(priorState, item.input.clientCapabilities);
          if (participantCount >= priorState.settings.audienceLimit) {
            throw new SessionError(
              "SESSION_FULL",
              "This session has reached its participant limit",
            );
          }
          const generated = friendlyNickname(participantCount);
          const nickname = normalizeNickname(
            priorState.settings.nicknamePolicy === "friendly_only"
              ? generated
              : (item.input.nickname ?? generated),
          );
          if (!nicknameAllowed(nickname)) {
            throw new SessionError("NICKNAME_REJECTED", "Choose another nickname");
          }
          let uniqueNickname = nickname;
          let suffix = 2;
          while (normalizedNames.has(uniqueNickname.toLocaleLowerCase("en-CA"))) {
            uniqueNickname = `${nickname} ${suffix++}`;
          }
          normalizedNames.add(uniqueNickname.toLocaleLowerCase("en-CA"));

          const participantToken = opaqueToken();
          const participantId = randomUUID();
          const participant: ParticipantRecord = {
            id: participantId,
            sessionId: session.id,
            nickname: uniqueNickname,
            tokenHash: hashToken(participantToken),
            status: "active",
            joinedAt: new Date(),
          };
          const result = addParticipant(nextState, {
            id: participant.id,
            nickname: participant.nickname,
            avatarId: item.input.avatarId ?? avatarIdForSeed(participantId),
            score: 0,
            correctCount: 0,
            acceptedResponseMs: 0,
            connected: true,
            kicked: false,
          });
          nextState = result.state;
          participantCount += 1;
          events.push(...result.events);
          for (const event of result.events) eventVersions.set(event.seq, result.state.version);
          accepted.push({ item, participant, participantToken });
        } catch (error) {
          if (error instanceof SessionError) item.reject(error);
          else throw error;
        }
      }

      if (accepted.length === 0) return;
      session.state = nextState;
      session.updatedAt = new Date();
      try {
        await this.repository.commitParticipants(
          session,
          accepted.map(({ participant }) => participant),
          priorState.version,
        );
      } catch (error) {
        session.state = priorState;
        if (error instanceof WorkspaceDeletionInProgressError) {
          throw new SessionError("CONFLICT", "This workspace is being deleted");
        }
        if (error instanceof SessionNotActiveError) {
          throw new SessionError("SESSION_LOCKED", "This session has ended or expired");
        }
        throw error;
      }
      this.active.set(session.id, session);
      this.metrics.setActiveSessions(this.active.size);
      this.metrics.recordJoinBatch(accepted.length);
      for (const { participant } of accepted) {
        this.participantCredentials.set(participant.tokenHash, participant);
      }
      this.recordSessionProductEvents(
        session.workspaceId,
        accepted.map(({ participant }) => ({
          name: "participant_joined",
          occurredAt: participant.joinedAt.toISOString(),
          dimensions: { artifactType: "round" },
        })),
      );
      for (const { item, participant, participantToken } of accepted) {
        item.resolve({
          participantId: participant.id,
          participantToken,
          snapshot: snapshotForRole(session.state, {
            role: "participant",
            participantId: participant.id,
          }),
        });
      }
      // Let Socket.IO flush the durable join acknowledgements before cache and
      // audience fanout work starts on the same event-loop turn.
      await yieldToEventLoop();
      const cacheUpdate = Promise.allSettled([
        this.cache.set(session.state, this.liveCacheTtlSeconds(session)),
        this.cache.appendEvents(
          session.id,
          events.map((event) => ({
            seq: event.seq,
            type: event.type,
            payload: { version: eventVersions.get(event.seq) ?? session.state.version },
          })),
        ),
      ]);
      await cacheUpdate;
      this.scheduleDeadline(session);
      const latestEvent = events.at(-1)!;
      await this.publish({ state: session.state, events: [latestEvent] }).catch(() => undefined);
    });
  }

  async answer(input: AnswerSubmit): Promise<AnswerAck> {
    const receivedAtMs = Date.now();
    let markReady!: () => void;
    let markSettled!: () => void;
    const ingress: AnswerIngress = {
      receivedAtMs,
      ready: new Promise<void>((resolve) => {
        markReady = resolve;
      }),
      settled: new Promise<void>((resolve) => {
        markSettled = resolve;
      }),
    };
    const sessionIngress = this.answerIngress.get(input.sessionId) ?? new Set<AnswerIngress>();
    sessionIngress.add(ingress);
    this.answerIngress.set(input.sessionId, sessionIngress);
    return this.traceOperation("openround.session.answer", {}, async () => {
      const startedAt = performance.now();
      try {
        const acknowledgement = await this.queueAnswer(input, receivedAtMs, markReady);
        const outcome = acknowledgement.accepted
          ? acknowledgement.duplicate
            ? "duplicate"
            : "accepted"
          : acknowledgement.code === "ANSWER_LATE"
            ? "late"
            : "invalid";
        this.metrics.recordAnswer(outcome, (performance.now() - startedAt) / 1_000);
        trace.getActiveSpan()?.setAttribute("openround.outcome", outcome);
        return acknowledgement;
      } catch (error) {
        this.metrics.recordAnswer("error", (performance.now() - startedAt) / 1_000);
        trace.getActiveSpan()?.setAttribute("openround.outcome", "error");
        throw error;
      } finally {
        markReady();
        markSettled();
        sessionIngress.delete(ingress);
        if (sessionIngress.size === 0) this.answerIngress.delete(input.sessionId);
      }
    });
  }

  private async queueAnswer(
    input: AnswerSubmit,
    receivedAtMs: number,
    markReady: () => void,
  ): Promise<AnswerAck> {
    const participant = await this.participantForToken(input.participantToken);
    if (!participant || participant.sessionId !== input.sessionId) {
      throw new SessionError("UNAUTHORIZED", "Participant token is invalid");
    }
    if (this.closing) throw new SessionError("CONFLICT", "The server is shutting down");
    return new Promise<AnswerAck>((resolve, reject) => {
      const item = { input, participant, receivedAtMs, resolve, reject };
      const barrier = this.answerIngressBarriers.get(input.sessionId);
      const earliestCutoffMs = barrier
        ? Math.min(...barrier.cutoffs.values())
        : Number.POSITIVE_INFINITY;
      if (barrier && receivedAtMs > earliestCutoffMs) {
        barrier.items.push(item);
        markReady();
        return;
      }
      let batch = this.answerBatches.get(input.sessionId);
      if (!batch) {
        const items: PendingAnswer[] = [];
        const timer = setTimeout(
          () => this.dispatchAnswerBatch(input.sessionId, items),
          answerBatchWindowMs,
        );
        batch = {
          items,
          timer,
          deadlineAtMs: Date.now() + maximumAnswerBatchWaitMs,
          awaitingParticipantIds: this.participantsAwaitingAnswer(input.sessionId),
        };
        this.answerBatches.set(input.sessionId, batch);
      }
      batch.items.push(item);
      if (
        batch.awaitingParticipantIds &&
        input.roundId === this.active.get(input.sessionId)?.state.roundId
      ) {
        batch.awaitingParticipantIds.delete(item.participant.id);
      }
      markReady();
      if (
        batch.items.length >= maximumAnswerBatchSize ||
        batch.awaitingParticipantIds?.size === 0
      ) {
        clearTimeout(batch.timer);
        this.dispatchAnswerBatch(input.sessionId, batch.items);
      } else {
        clearTimeout(batch.timer);
        const delayMs = Math.max(0, Math.min(answerBatchWindowMs, batch.deadlineAtMs - Date.now()));
        batch.timer = setTimeout(
          () => this.dispatchAnswerBatch(input.sessionId, batch.items),
          delayMs,
        );
      }
    });
  }

  private registerAnswerIngressBarrier(sessionId: string, cutoffMs: number) {
    const token = Symbol("answer-ingress-barrier");
    let barrier = this.answerIngressBarriers.get(sessionId);
    if (!barrier) {
      barrier = { cutoffs: new Map(), items: [] };
      this.answerIngressBarriers.set(sessionId, barrier);
    }
    barrier.cutoffs.set(token, cutoffMs);

    const earliestCutoffMs = Math.min(...barrier.cutoffs.values());
    const batch = this.answerBatches.get(sessionId);
    if (batch) {
      const eligible: PendingAnswer[] = [];
      const deferred: PendingAnswer[] = [];
      for (const item of batch.items) {
        (item.receivedAtMs <= earliestCutoffMs ? eligible : deferred).push(item);
      }
      if (deferred.length > 0) {
        clearTimeout(batch.timer);
        this.answerBatches.delete(sessionId);
        barrier.items.push(...deferred);
        this.processPendingAnswerItems(sessionId, eligible);
      }
    }
    return token;
  }

  private releaseAnswerIngressBarrier(sessionId: string, token: symbol) {
    const barrier = this.answerIngressBarriers.get(sessionId);
    if (!barrier || !barrier.cutoffs.delete(token)) return;

    const nextCutoffMs =
      barrier.cutoffs.size > 0 ? Math.min(...barrier.cutoffs.values()) : Number.POSITIVE_INFINITY;
    const eligible: PendingAnswer[] = [];
    const deferred: PendingAnswer[] = [];
    for (const item of barrier.items) {
      (item.receivedAtMs <= nextCutoffMs ? eligible : deferred).push(item);
    }
    barrier.items = deferred;
    if (barrier.cutoffs.size === 0) this.answerIngressBarriers.delete(sessionId);
    this.processPendingAnswerItems(sessionId, eligible);
  }

  private processPendingAnswerItems(sessionId: string, items: PendingAnswer[]) {
    for (let index = 0; index < items.length; index += maximumAnswerBatchSize) {
      const chunk = items.slice(index, index + maximumAnswerBatchSize);
      void this.processAnswerBatch(sessionId, chunk).catch((error: unknown) => {
        for (const item of chunk) item.reject(error);
      });
    }
  }

  private participantsAwaitingAnswer(sessionId: string) {
    const state = this.active.get(sessionId)?.state;
    if (!state || state.phase !== "question_open" || !state.roundId) return null;

    const awaiting = new Set(
      Object.values(state.participants)
        .filter((participant) => !participant.kicked)
        .map((participant) => participant.id),
    );
    for (const answer of Object.values(state.answers)) {
      if (answer.roundId === state.roundId) awaiting.delete(answer.participantId);
    }
    return awaiting.size > 0 ? awaiting : null;
  }

  private async withAnswerCommitSlot<T>(work: () => Promise<T>): Promise<T> {
    if (this.activeAnswerCommits >= maximumConcurrentAnswerCommits) {
      await new Promise<void>((resolve) => this.answerCommitWaiters.push(resolve));
    } else {
      this.activeAnswerCommits += 1;
    }
    try {
      return await work();
    } finally {
      const next = this.answerCommitWaiters.shift();
      if (next) next();
      else this.activeAnswerCommits -= 1;
    }
  }

  private async flushAnswersReceivedBy(sessionId: string, cutoffMs: number) {
    while (true) {
      const ingress = [...(this.answerIngress.get(sessionId) ?? [])].filter(
        (item) => item.receivedAtMs <= cutoffMs,
      );
      if (ingress.length === 0) return;
      await Promise.allSettled(ingress.map((item) => item.ready));
      const batch = this.answerBatches.get(sessionId);
      if (batch) {
        clearTimeout(batch.timer);
        const eligible = batch.items.filter((item) => item.receivedAtMs <= cutoffMs);
        const deferred = batch.items.filter((item) => item.receivedAtMs > cutoffMs);
        this.answerBatches.delete(sessionId);
        const barrier = this.answerIngressBarriers.get(sessionId);
        if (barrier) barrier.items.push(...deferred);
        else this.processPendingAnswerItems(sessionId, deferred);
        this.processPendingAnswerItems(sessionId, eligible);
      }
      await Promise.allSettled(ingress.map((item) => item.settled));
    }
  }

  private dispatchAnswerBatch(sessionId: string, items: PendingAnswer[]) {
    const current = this.answerBatches.get(sessionId);
    if (!current || current.items !== items) return;
    clearTimeout(current.timer);
    this.answerBatches.delete(sessionId);
    this.processPendingAnswerItems(sessionId, items);
  }

  private async processAnswerBatch(sessionId: string, items: PendingAnswer[]) {
    await this.mutate(sessionId, "answer", async () => {
      const session = await this.loadSessionForMutation(sessionId);
      if (!session) throw new SessionError("NOT_FOUND", "Session not found");
      const priorState = session.state;
      // Current-round answers are part of the atomically persisted session
      // snapshot. While the first round is active, it cannot have historical
      // idempotency keys, so avoid a second PostgreSQL transaction on this
      // latency-critical path. Later rounds and finished sessions still consult
      // durable history because those transitions clear `state.answers`.
      const durableAnswers =
        Object.keys(priorState.rounds).length > 1 || priorState.phase === "finished"
          ? await this.repository.findAnswers(
              session.workspaceId,
              session.id,
              items.map(({ input, participant }) => ({
                participantId: participant.id,
                roundId: input.roundId,
                idempotencyKey: input.idempotencyKey,
              })),
            )
          : [];
      const existingAnswers = [...Object.values(priorState.answers), ...durableAnswers];
      const existingByIdempotencyKey = new Map(
        existingAnswers.map((answer) => [answer.idempotencyKey, answer]),
      );
      const existingByParticipantRound = new Map(
        existingAnswers.map((answer) => [`${answer.participantId}:${answer.roundId}`, answer]),
      );
      let nextState = priorState;
      const newAnswers: EngineAnswer[] = [];
      const events: EngineEvent[] = [];
      const eventVersions = new Map<number, number>();
      const outcomes: Array<{ item: PendingAnswer; acknowledgement: AnswerAck }> = [];

      for (const item of items) {
        try {
          requireRoundClient(priorState, item.input.clientCapabilities);
          const existingForKey = existingByIdempotencyKey.get(item.input.idempotencyKey);
          const existingForRound = existingByParticipantRound.get(
            `${item.participant.id}:${item.input.roundId}`,
          );
          const existing = existingForKey ?? existingForRound;
          if (existing) {
            const idempotentRequestMatches =
              !existingForKey ||
              (existing.participantId === item.participant.id &&
                existing.roundId === item.input.roundId &&
                existing.confidence === (item.input.confidence ?? null) &&
                JSON.stringify(canonicalizeResponse(existing.response)) ===
                  JSON.stringify(responseForAnswer(item.input)));
            if (existing.participantId !== item.participant.id || !idempotentRequestMatches) {
              outcomes.push({
                item,
                acknowledgement: {
                  accepted: false,
                  duplicate: false,
                  code: "ANSWER_INVALID",
                },
              });
            } else {
              outcomes.push({
                item,
                acknowledgement: {
                  accepted: true,
                  answerId: existing.answerId,
                  acceptedAt: new Date(existing.acceptedAtMs).toISOString(),
                  score: existing.score,
                  duplicate: true,
                },
              });
            }
            continue;
          }
          const beforeAnswer = nextState;
          const result = acceptAnswer(beforeAnswer, {
            answerId: randomUUID(),
            participantId: item.participant.id,
            roundId: item.input.roundId,
            response: responseForAnswer(item.input),
            confidence: item.input.confidence,
            idempotencyKey: item.input.idempotencyKey,
            nowMs: item.receivedAtMs,
          });
          const duplicate = result.state === beforeAnswer;
          if (!duplicate) {
            nextState = result.state;
            newAnswers.push(result.answer);
            existingByIdempotencyKey.set(result.answer.idempotencyKey, result.answer);
            existingByParticipantRound.set(
              `${result.answer.participantId}:${result.answer.roundId}`,
              result.answer,
            );
            events.push({ type: "session.snapshot", seq: result.state.seq });
            eventVersions.set(result.state.seq, result.state.version);
          }
          outcomes.push({
            item,
            acknowledgement: {
              accepted: true,
              answerId: result.answer.answerId,
              acceptedAt: new Date(result.answer.acceptedAtMs).toISOString(),
              score: result.answer.score,
              duplicate,
            },
          });
        } catch (error) {
          if (error instanceof SessionError && error.code === "CLIENT_UPDATE_REQUIRED") {
            // Compatibility is specific to this client, not the shared commit.
            // One outdated submission must not reject other participants' answers.
            item.reject(error);
          } else if (error instanceof EngineError && error.code === "ANSWER_LATE") {
            outcomes.push({
              item,
              acknowledgement: { accepted: false, duplicate: false, code: "ANSWER_LATE" },
            });
          } else if (
            error instanceof EngineError &&
            (error.code === "ANSWER_INVALID" ||
              error.code === "NOT_FOUND" ||
              error.code === "CONFLICT")
          ) {
            outcomes.push({
              item,
              acknowledgement: { accepted: false, duplicate: false, code: "ANSWER_INVALID" },
            });
          } else {
            throw error;
          }
        }
      }

      if (newAnswers.length > 0) {
        const previouslyAnsweredParticipantIds = this.uxBetaEnabled(session.workspaceId)
          ? await this.repository
              .findParticipantIdsWithAnswers(session.workspaceId, session.id, [
                ...new Set(newAnswers.map((answer) => answer.participantId)),
              ])
              .then((participantIds) => new Set(participantIds))
              .catch(() => null)
          : null;
        session.state = nextState;
        session.updatedAt = new Date();
        try {
          const queuedAt = performance.now();
          const persisted = await this.withAnswerCommitSlot(async () => {
            this.metrics.observeAnswerCommitStage("wait", (performance.now() - queuedAt) / 1_000);
            const commitStartedAt = performance.now();
            try {
              return await this.repository.commitAnswers(
                session,
                newAnswers,
                priorState.version,
                // The question-open transition is committed before participants receive
                // the round, and accepting an answer cannot change round evidence.
                { roundEvidencePersisted: true },
              );
            } finally {
              this.metrics.observeAnswerCommitStage(
                "persist",
                (performance.now() - commitStartedAt) / 1_000,
              );
            }
          });
          for (let index = 0; index < newAnswers.length; index += 1) {
            if (persisted[index]?.answerId !== newAnswers[index]?.answerId) {
              throw new SessionError(
                "CONFLICT",
                "Answer state changed during persistence; synchronize and retry",
              );
            }
          }
        } catch (error) {
          session.state = priorState;
          if (error instanceof WorkspaceDeletionInProgressError) {
            throw new SessionError("CONFLICT", "This workspace is being deleted");
          }
          throw error;
        }
        this.active.set(session.id, session);
        this.metrics.setActiveSessions(this.active.size);
        this.metrics.recordAnswerBatch(newAnswers.length);
        const firstAnswers = previouslyAnsweredParticipantIds
          ? [
              ...new Map(
                newAnswers
                  .filter((answer) => !previouslyAnsweredParticipantIds.has(answer.participantId))
                  .map((answer) => [answer.participantId, answer]),
              ).values(),
            ]
          : [];
        for (const { item, acknowledgement } of outcomes) item.resolve(acknowledgement);
        this.recordSessionProductEvents(session.workspaceId, [
          ...firstAnswers.map((answer): ProductEventInput => ({
            name: "first_answer_submitted",
            occurredAt: new Date(answer.acceptedAtMs).toISOString(),
            dimensions: { artifactType: "round" },
          })),
          ...newAnswers.map((answer): ProductEventInput => ({
            name: "response_saved_acknowledged",
            occurredAt: new Date(answer.acceptedAtMs).toISOString(),
            dimensions: { artifactType: "round" },
          })),
        ]);
        // The answer is durable at this point. Yield to I/O so response receipts
        // are not delayed by state serialization and a 250-socket publication.
        await yieldToEventLoop();
        const cacheUpdate = Promise.allSettled([
          this.cache.set(session.state, this.liveCacheTtlSeconds(session)),
          this.cache.appendEvents(
            session.id,
            events.map((event) => ({
              seq: event.seq,
              type: event.type,
              payload: { version: eventVersions.get(event.seq) ?? session.state.version },
            })),
          ),
        ]);
        await cacheUpdate;
        const latestEvent = events.at(-1)!;
        await this.publish({ state: session.state, events: [latestEvent] }).catch(() => undefined);
        return;
      }

      for (const { item, acknowledgement } of outcomes) item.resolve(acknowledgement);
    });
  }

  async hostCommand(input: HostCommand): Promise<SessionSnapshot> {
    const closesAnswerIngress = ["pause", "lock", "end"].includes(input.action);
    return this.traceOperation(
      "openround.session.host_command",
      { "openround.host.action": input.action },
      async () => {
        let barrierToken: symbol | null = null;
        let commandTimeMs: number | null = null;
        try {
          if (closesAnswerIngress) {
            await this.snapshot({
              sessionId: input.sessionId,
              hostToken: input.hostToken,
              role: "host",
              clientCapabilities: input.clientCapabilities,
            });
            // Authentication is the command's ordering point. Do not let an
            // unauthenticated request stall participant receipts.
            commandTimeMs = Date.now();
            barrierToken = this.registerAnswerIngressBarrier(input.sessionId, commandTimeMs);
            await this.flushAnswersReceivedBy(input.sessionId, commandTimeMs);
          }
          return await this.mutate(input.sessionId, "host", async () => {
            const session = await this.loadSessionForMutation(input.sessionId);
            if (!session) throw new SessionError("NOT_FOUND", "Session not found");
            const staffActor = await this.authorizeStaff(session, input.hostToken, ["cohost"]);
            requireRoundClient(session.state, input.clientCapabilities);
            try {
              const commandTime = new Date(commandTimeMs ?? Date.now());
              const priorState = session.state;
              const priorRetentionExpiresAt = session.retentionExpiresAt;
              const priorPhase = session.state.phase;
              const result = applyHostCommand(session.state, {
                commandId: input.commandId,
                expectedVersion: input.expectedVersion,
                action: input.action,
                participantId: input.participantId,
                interventionType: input.interventionType,
                recoveryPackCard: input.recoveryPackCard,
                answerId: input.answerId,
                responseStatus: input.responseStatus,
                moderationActor: staffActor.rootHost
                  ? { kind: "host", userId: session.hostId }
                  : { kind: "cohost", credentialId: staffActor.credential!.id },
                recheckMode: input.recheckMode,
                recheckQuestionId: input.recheckQuestionId,
                nowMs: commandTime.getTime(),
                newRoundId: randomUUID,
              });
              if (!result.duplicate) {
                const expectedVersion = session.state.version;
                session.state = result.state;
                if (priorPhase !== "finished" && session.state.phase === "finished") {
                  session.retentionExpiresAt = retentionExpiry(
                    commandTime,
                    await roomEntitlements(
                      this.repository,
                      this.config,
                      "round",
                      session.id,
                      session.workspaceId,
                    ),
                  );
                }
                const report =
                  session.state.phase === "finished"
                    ? createPendingReport(
                        session.state,
                        session.retentionExpiresAt,
                        session.decisionReplayEnabled ?? false,
                      )
                    : undefined;
                const decisionEvents = session.decisionReplayEnabled
                  ? decisionEventsForTransition({
                      before: priorState,
                      after: session.state,
                      engineEvents: result.events,
                      action: input.action,
                      commandId: input.commandId,
                      occurredAt: commandTime,
                    })
                  : [];
                try {
                  await this.save(session, result.events, expectedVersion, report, decisionEvents);
                } catch (error) {
                  session.state = priorState;
                  session.retentionExpiresAt = priorRetentionExpiresAt;
                  this.active.delete(session.id);
                  this.metrics.setActiveSessions(this.active.size);
                  throw error;
                }
                this.recordSessionProductEvents(session.workspaceId, [
                  ...this.lifecycleProductEvents(result.events, commandTime),
                  ...(input.action === "intervention.start"
                    ? [
                        {
                          name: "intervention_started" as const,
                          occurredAt: commandTime.toISOString(),
                          dimensions: { artifactType: "round" as const },
                        },
                      ]
                    : []),
                  ...(input.action === "recheck.open" && input.recheckMode === "linked"
                    ? [
                        {
                          name: "linked_recheck_opened" as const,
                          occurredAt: commandTime.toISOString(),
                          dimensions: { artifactType: "round" as const },
                        },
                      ]
                    : []),
                ]);
                await this.publish({
                  state: session.state,
                  events: result.events,
                  reportId: report?.id,
                });
                await this.repository.recordAudit({
                  workspaceId: session.workspaceId,
                  actorId: staffActor.rootHost ? session.hostId : null,
                  action: `session.command.${input.action}`,
                  targetType: "game_session",
                  targetId: session.id,
                  requestId: input.commandId,
                  metadata: staffActor.credential
                    ? {
                        staffCredentialId: staffActor.credential.id,
                        staffRole: staffActor.credential.role,
                      }
                    : {},
                });
              }
              this.metrics.recordHostCommand(
                input.action,
                result.duplicate ? "duplicate" : "applied",
              );
              return snapshotForRole(session.state, { role: "host" });
            } catch (error) {
              if (error instanceof EngineError) {
                const code = error.code === "STALE_VERSION" ? "STALE_VERSION" : "CONFLICT";
                this.metrics.recordHostCommand(input.action, code.toLocaleLowerCase("en-CA"));
                throw new SessionError(code, error.message);
              }
              this.metrics.recordHostCommand(input.action, "error");
              throw error;
            }
          });
        } finally {
          if (barrierToken) this.releaseAnswerIngressBarrier(input.sessionId, barrierToken);
        }
      },
    );
  }

  async snapshot(input: {
    sessionId: string;
    participantToken?: string;
    hostToken?: string;
    role?: "participant" | "host" | "presenter";
    clientCapabilities?: RoundClientCapabilities;
  }) {
    const session = await this.loadSession(input.sessionId);
    if (!session) throw new SessionError("NOT_FOUND", "Session not found");
    if (input.hostToken) {
      await this.authorizeStaff(
        session,
        input.hostToken,
        input.role === "presenter" ? ["cohost", "presenter"] : ["cohost"],
      );
      requireRoundClient(session.state, input.clientCapabilities);
      return snapshotForRole(session.state, {
        role: input.role === "presenter" ? "presenter" : "host",
      });
    }
    if (input.participantToken) {
      const participant = await this.participantForToken(input.participantToken);
      if (!participant || participant.sessionId !== session.id) {
        throw new SessionError("UNAUTHORIZED", "Participant token is invalid");
      }
      requireRoundClient(session.state, input.clientCapabilities);
      return snapshotForRole(session.state, { role: "participant", participantId: participant.id });
    }
    throw new SessionError("UNAUTHORIZED", "A session credential is required");
  }

  async responseModerationPage(
    input: TextModerationPageQuery & {
      sessionId: string;
      hostToken: string;
      clientCapabilities?: RoundClientCapabilities;
    },
  ) {
    return this.readTextResponses(input, true);
  }

  async approvedResponseResults(
    input: TextResponsePageQuery & {
      sessionId: string;
      roundId: string;
      role: "participant" | "host" | "presenter";
      token: string;
      clientCapabilities?: RoundClientCapabilities;
    },
  ) {
    return this.readTextResponses(input, false);
  }

  private async readTextResponses(
    input: TextModerationPageQuery & {
      sessionId: string;
      hostToken: string;
      clientCapabilities?: RoundClientCapabilities;
    },
    moderation: true,
  ): Promise<ReturnType<typeof moderationPage>>;
  private async readTextResponses(
    input: TextResponsePageQuery & {
      sessionId: string;
      roundId: string;
      role: "participant" | "host" | "presenter";
      token: string;
      clientCapabilities?: RoundClientCapabilities;
    },
    moderation: false,
  ): Promise<ReturnType<typeof textResults>>;
  private async readTextResponses(
    input:
      | (TextModerationPageQuery & {
          sessionId: string;
          hostToken: string;
          clientCapabilities?: RoundClientCapabilities;
        })
      | (TextResponsePageQuery & {
          sessionId: string;
          roundId: string;
          role: "participant" | "host" | "presenter";
          token: string;
          clientCapabilities?: RoundClientCapabilities;
        }),
    moderation: boolean,
  ) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const session = await this.loadSession(input.sessionId);
      if (!session) throw new SessionError("NOT_FOUND", "Session not found");
      if ("hostToken" in input) {
        await this.authorizeStaff(session, input.hostToken, ["cohost"]);
      } else if (input.role === "participant") {
        const participant = await this.participantForToken(input.token);
        const runtime = participant && session.state.participants[participant.id];
        if (
          !participant ||
          participant.sessionId !== session.id ||
          !runtime ||
          runtime.kicked ||
          participant.status === "kicked"
        )
          throw new SessionError("UNAUTHORIZED", "Participant access is invalid or revoked");
      } else {
        await this.authorizeStaff(
          session,
          input.token,
          input.role === "presenter" ? ["cohost", "presenter"] : ["cohost"],
        );
      }
      requireRoundClient(session.state, input.clientCapabilities);
      const ids =
        "hostToken" in input
          ? moderationPageSelection(session.state, input).entries.map((entry) => entry.answerId)
          : approvedTextAnswerIds(session.state, input.roundId);
      const batches: string[][] = [];
      for (let index = 0; index < ids.length; index += 100)
        batches.push(ids.slice(index, index + 100));
      const answers = (
        await Promise.all(
          batches.map((batch) =>
            this.repository.getSessionAnswersByIds(session.workspaceId, session.id, batch),
          ),
        )
      ).flat();
      const durable = await this.repository.getSessionById(session.id);
      if (!durable || durable.workspaceId !== session.workspaceId)
        throw new SessionError("NOT_FOUND", "Session not found");
      if (durable.state.version !== session.state.version) continue;
      if (await this.repository.workspaceDeletionStarted(session.workspaceId))
        throw new SessionError("NOT_FOUND", "Session not found");
      // Credential revocation does not advance the game revision. Recheck staff access
      // after loading bodies so an in-flight private queue cannot outlive its credential.
      if ("hostToken" in input) {
        await this.authorizeStaff(session, input.hostToken, ["cohost"]);
      } else if (input.role !== "participant") {
        await this.authorizeStaff(
          session,
          input.token,
          input.role === "presenter" ? ["cohost", "presenter"] : ["cohost"],
        );
      }
      return moderation && "hostToken" in input
        ? moderationPage(session.state, input, answers)
        : textResults(session.state, input.roundId!, input, answers);
    }
    throw new SessionError("CONFLICT", "Responses changed. Refresh the current view");
  }

  async sync(input: SyncRequest): Promise<SyncResponse> {
    let snapshot: SessionSnapshot;
    if (input.role === "participant" && input.participantToken) {
      const participant = await this.participantForToken(input.participantToken);
      if (!participant || participant.sessionId !== input.sessionId) {
        throw new SessionError("UNAUTHORIZED", "Participant token is invalid");
      }
      snapshot = await this.reconnectParticipant(participant, input.clientCapabilities);
    } else {
      snapshot = await this.snapshot(input);
    }
    const cached =
      input.lastSeq < snapshot.seq
        ? await this.cache.readEvents(input.sessionId, input.lastSeq, 1_000)
        : [];
    const replay = cached.map((event) => {
      const payloadVersion = (event.payload as { version?: unknown } | null)?.version;
      return {
        eventId: `${input.sessionId}:${event.seq}`,
        sessionId: input.sessionId,
        sessionVersion:
          typeof payloadVersion === "number" && Number.isSafeInteger(payloadVersion)
            ? payloadVersion
            : snapshot.version,
        seq: event.seq,
        type: event.type,
        schemaVersion: 1 as const,
        serverTime: event.serverTime,
        payload: event.payload,
      };
    });
    const replayComplete =
      input.lastSeq === snapshot.seq ||
      (replay.length > 0 &&
        replay[0]!.seq === input.lastSeq + 1 &&
        replay.at(-1)!.seq === snapshot.seq);
    this.metrics.recordSync(input.role, replayComplete, replay.length);
    return { snapshot, replay, replayComplete };
  }

  private async reconnectParticipant(
    participant: ParticipantRecord,
    client?: RoundClientCapabilities,
  ): Promise<SessionSnapshot> {
    return this.mutate(participant.sessionId, "resume", async () => {
      const session = await this.loadSessionForMutation(participant.sessionId);
      if (!session) throw new SessionError("INVALID_CODE", "Session is no longer available");
      const current = session.state.participants[participant.id];
      if (!current || current.kicked || participant.status === "kicked") {
        throw new SessionError("UNAUTHORIZED", "Participant access has been revoked");
      }
      requireRoundClient(session.state, client);
      if (!current.connected) {
        const expectedVersion = session.state.version;
        const result = setParticipantConnection(session.state, participant.id, true);
        session.state = result.state;
        await this.save(session, result.events, expectedVersion);
        await this.publish({ state: session.state, events: result.events });
      }
      return snapshotForRole(session.state, {
        role: "participant",
        participantId: participant.id,
      });
    });
  }

  async deleteSession(workspaceId: string, sessionId: string) {
    return this.mutate(sessionId, "delete", async () => {
      const session = await this.loadSessionForMutation(sessionId);
      const deleted = await this.repository.deleteSession(workspaceId, sessionId);
      if (deleted) {
        if (session) {
          await this.cache
            .releaseSessionCode(session.state.code, session.id)
            .catch(() => undefined);
        }
        await this.invalidate([sessionId]);
      }
      return deleted;
    });
  }

  async invalidate(sessionIds: string[]) {
    const uniqueSessionIds = [...new Set(sessionIds)];
    for (const sessionId of uniqueSessionIds) {
      const timer = this.timers.get(sessionId);
      if (timer) clearTimeout(timer);
      this.timers.delete(sessionId);
      this.active.delete(sessionId);
      for (const [tokenHash, participant] of this.participantCredentials) {
        if (participant.sessionId === sessionId) this.participantCredentials.delete(tokenHash);
      }
    }
    this.metrics.setActiveSessions(this.active.size);
    const cacheDeletes = await Promise.allSettled(
      uniqueSessionIds.map((sessionId) => this.cache.delete(sessionId)),
    );
    const failures = cacheDeletes
      .filter((result): result is PromiseRejectedResult => result.status === "rejected")
      .map((result) => result.reason);
    if (failures.length > 0) {
      throw new AggregateError(failures, "One or more session cache entries could not be deleted");
    }
  }

  async invalidateWorkspaceDeletion(targets: SessionInvalidationTarget[]) {
    const uniqueTargets = [
      ...new Map(targets.map((target) => [target.sessionId, target])).values(),
    ];
    const results = await Promise.allSettled(
      uniqueTargets.map((target) =>
        this.mutate(target.sessionId, "delete", async () => {
          const cleanup = await Promise.allSettled([
            this.cache.releaseSessionCode(target.code, target.sessionId),
            this.invalidate([target.sessionId]),
          ]);
          const failures = cleanup
            .filter((result): result is PromiseRejectedResult => result.status === "rejected")
            .map((result) => result.reason);
          if (failures.length > 0) {
            throw new AggregateError(
              failures,
              `Session ${target.sessionId} could not be invalidated for workspace deletion`,
            );
          }
        }),
      ),
    );
    const failures = results
      .filter((result): result is PromiseRejectedResult => result.status === "rejected")
      .map((result) => result.reason);
    if (failures.length > 0) {
      throw new AggregateError(failures, "Workspace session invalidation did not complete");
    }
  }

  async authorizeMedia(sessionId: string, mediaId: string, credential: string) {
    const session = await this.loadSession(sessionId);
    if (!session) throw new SessionError("NOT_FOUND", "Session not found");
    const referenced = session.state.quiz.questions.some(
      (question) => question.mediaId === mediaId,
    );
    if (!referenced) throw new SessionError("NOT_FOUND", "Media is not part of this session");
    if (safeHashEqual(session.hostTokenHash, hashToken(credential))) return session.workspaceId;
    const staff = await this.staffForTokenHash(hashToken(credential));
    if (staff?.sessionId === session.id && staff.workspaceId === session.workspaceId) {
      return session.workspaceId;
    }
    const participant = await this.participantForToken(credential);
    const participantState = participant ? session.state.participants[participant.id] : null;
    if (
      !participant ||
      participant.sessionId !== sessionId ||
      !participantState ||
      participantState.kicked
    ) {
      throw new SessionError("UNAUTHORIZED", "Session credential is invalid");
    }
    return session.workspaceId;
  }

  async disconnect(participantToken: string) {
    const participant = await this.participantForToken(participantToken);
    if (!participant) return;
    await this.mutate(participant.sessionId, "disconnect", async () => {
      const session = await this.loadSessionForMutation(participant.sessionId);
      if (!session || !session.state.participants[participant.id]) return;
      if (!session.state.participants[participant.id]!.connected) return;
      const expectedVersion = session.state.version;
      const result = setParticipantConnection(session.state, participant.id, false);
      session.state = result.state;
      await this.save(session, result.events, expectedVersion);
      await this.publish({ state: session.state, events: result.events });
    });
  }

  envelope<T>(state: GameState, event: EngineEvent, payload: T): EventEnvelope<T> {
    return {
      eventId: `${state.sessionId}:${event.seq}`,
      sessionId: state.sessionId,
      sessionVersion: state.version,
      seq: event.seq,
      type: event.type,
      schemaVersion: 1,
      serverTime: new Date().toISOString(),
      payload,
    };
  }

  close() {
    this.closing = true;
    for (const batch of this.joinBatches.values()) {
      clearTimeout(batch.timer);
      for (const item of batch.items) {
        item.reject(new SessionError("CONFLICT", "The server is shutting down"));
      }
    }
    this.joinBatches.clear();
    for (const batch of this.answerBatches.values()) {
      clearTimeout(batch.timer);
      for (const item of batch.items) {
        item.reject(new SessionError("CONFLICT", "The server is shutting down"));
      }
    }
    this.answerBatches.clear();
    for (const barrier of this.answerIngressBarriers.values()) {
      for (const item of barrier.items) {
        item.reject(new SessionError("CONFLICT", "The server is shutting down"));
      }
    }
    this.answerIngressBarriers.clear();
    this.answerIngress.clear();
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    this.active.clear();
    this.participantCredentials.clear();
    this.metrics.setActiveSessions(0);
  }
}
