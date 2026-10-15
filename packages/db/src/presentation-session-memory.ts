import { randomUUID } from "node:crypto";
import { assertAudienceAdmissionInMemory } from "./platform-memory.js";
import { MemoryRepository } from "./memory.js";
import {
  reserveRoomCoverageInMemory,
  consumeRoomCoverageInMemory,
  releaseRoomCoverageInMemory,
  getMemoryPlatformRepository,
} from "./platform-memory.js";
import type {
  MemoryRepositoryLifecycleContext,
  MemoryRepositoryLifecycleExtension,
} from "./memory.js";
import type { Repository } from "./types.js";
import {
  clone,
  assertCommandRequestHash,
  commandReceiptMatches,
  normalizeSession,
  responseWindowOpen,
  transitionWindow,
  transitionRecoveryPackIntervention,
  transitionContent,
} from "./presentation-session-rules.js";
import {
  comparePresentationLeaderboardEntries,
  PresentationPublishedQuestionSourceUnavailableError,
  PresentationSessionConflictError,
  type PresentationParticipantJoin,
  type PresentationParticipantSnapshotProjection,
  type PresentationResponseAcceptance,
  type PresentationResponseAcknowledgementState,
  type PresentationResponseContext,
  type PresentationSessionCommandInput,
  type PresentationSessionCommandReceiptRecord,
  type PresentationSessionCreateInput,
  type PresentationSessionCredentialRecord,
  type PresentationSessionCredentialRole,
  type PresentationSessionDeletion,
  type PresentationSessionParticipantRecord,
  type PresentationSessionRecord,
  type PresentationSessionReportCompletion,
  type PresentationSessionReportJob,
  type PresentationSessionReportRecord,
  type PresentationSessionRepository,
  type PresentationSessionResponseRecord,
  type PresentationSessionTimelineRecord,
  type PresentationSessionTransitionInput,
  type PresentationTransitionAcceptance,
} from "./presentation-session-types.js";

export class MemoryPresentationSessionRepository
  implements PresentationSessionRepository, MemoryRepositoryLifecycleExtension
{
  private readonly sessions = new Map<string, PresentationSessionRecord>();
  private readonly participants = new Map<string, PresentationSessionParticipantRecord>();
  private readonly responses = new Map<string, PresentationSessionResponseRecord>();
  private readonly timeline = new Map<string, PresentationSessionTimelineRecord>();
  private readonly commandReceipts = new Map<string, PresentationSessionCommandReceiptRecord>();
  private readonly credentials = new Map<string, PresentationSessionCredentialRecord>();
  private readonly reports = new Map<string, PresentationSessionReportRecord>();
  private readonly reportJobs = new Map<
    string,
    { attempts: number; availableAt: Date; leaseToken: string | null; lastError: string | null }
  >();

  constructor(
    private readonly liveRooms: Pick<Repository, "claimLiveRoomCode" | "releaseLiveRoomCode"> & {
      assertWorkspaceLiveSessionCreationAllowed?: (workspaceId: string) => void;
      assertNewRoomLaunchAllowed?: (workspaceId: string) => void;
      deletePresentationSessionMetadata?: (workspaceId: string, sessionId: string) => void;
      assertPresentationPublishedQuestionSource?: (
        workspaceId: string,
        source: NonNullable<PresentationSessionCommandInput["publishedQuestionSource"]>,
      ) => void;
      isLibraryArtifactDeleted?: (
        workspaceId: string,
        artifactType: "round" | "presentation",
        artifactId: string,
      ) => boolean;
    },
  ) {}

  private assertWorkspaceMutationAllowed(workspaceId: string) {
    this.liveRooms.assertWorkspaceLiveSessionCreationAllowed?.(workspaceId);
  }

  getSessionSummarySource(workspaceId: string, kind: "presentation" | "survey", sourceId: string) {
    if (kind !== "presentation") return null;
    const session = this.sessions.get(sourceId);
    if (!session || session.workspaceId !== workspaceId) return null;
    return {
      ready:
        session.status === "finished" &&
        [...this.reports.values()].some(
          (report) => report.sessionId === sourceId && report.status === "ready",
        ),
      expiresAt: new Date(session.retentionExpiresAt),
    };
  }

  isLibraryArtifactReferenced(
    workspaceId: string,
    artifactType: "round" | "presentation",
    artifactId: string,
  ) {
    return (
      artifactType === "presentation" &&
      [...this.sessions.values()].some(
        (session) => session.workspaceId === workspaceId && session.presentationId === artifactId,
      )
    );
  }

  private assertPresentationExists(session: PresentationSessionRecord) {
    if (
      this.liveRooms.isLibraryArtifactDeleted?.(
        session.workspaceId,
        "presentation",
        session.presentationId,
      )
    ) {
      throw new Error("Presentation not found");
    }
  }

  exportAccount({ ownedWorkspaceIds }: MemoryRepositoryLifecycleContext) {
    const sessions = [...this.sessions.values()].filter((session) =>
      ownedWorkspaceIds.has(session.workspaceId),
    );
    const sessionIds = new Set(sessions.map((session) => session.id));
    return {
      presentationSessions: sessions.map(({ joinPasswordHash: _joinPasswordHash, ...session }) =>
        clone(session),
      ),
      presentationSessionParticipants: [...this.participants.values()]
        .filter((participant) => sessionIds.has(participant.sessionId))
        .map(({ tokenHash: _tokenHash, ...participant }) => clone(participant)),
      presentationSessionResponses: [...this.responses.values()]
        .filter((response) => sessionIds.has(response.sessionId))
        .map(clone),
      presentationSessionTimeline: [...this.timeline.values()]
        .filter((event) => sessionIds.has(event.sessionId))
        .map(clone),
      presentationSessionCommandReceipts: [...this.commandReceipts.values()]
        .filter((receipt) => sessionIds.has(receipt.sessionId))
        .map(clone),
      presentationSessionCredentials: [...this.credentials.values()]
        .filter((credential) => sessionIds.has(credential.sessionId))
        .map(({ tokenHash: _tokenHash, ...credential }) => clone(credential)),
      presentationSessionReports: [...this.reports.values()]
        .filter((report) => sessionIds.has(report.sessionId))
        .map(clone),
    };
  }

  async deleteAccount({ ownedWorkspaceIds, userId }: MemoryRepositoryLifecycleContext) {
    for (const credential of this.credentials.values()) {
      if (this.sessions.get(credential.sessionId)?.createdBy === userId && !credential.revokedAt) {
        credential.revokedAt = new Date();
      }
    }
    for (const [id, session] of this.sessions) {
      if (ownedWorkspaceIds.has(session.workspaceId)) await this.deleteSessionTree(id);
    }
  }

  async purgeExpired(now: Date) {
    const purged: string[] = [];
    for (const [id, session] of this.sessions) {
      if (session.retentionExpiresAt <= now) {
        await this.deleteSessionTree(id);
        purged.push(id);
      }
    }
    return purged;
  }

  private async deleteSessionTree(sessionId: string) {
    if (this.liveRooms instanceof MemoryRepository)
      releaseRoomCoverageInMemory(this.liveRooms, "presentation", sessionId);
    // Remove every record synchronously before releasing the code so no suspended mutation or
    // report worker can republish retained room data while deletion is in progress.
    const session = this.sessions.get(sessionId);
    if (session && this.liveRooms instanceof MemoryRepository)
      this.liveRooms.deleteSessionSummarySource(session.workspaceId, "presentation", sessionId);
    if (session) this.liveRooms.deletePresentationSessionMetadata?.(session.workspaceId, sessionId);
    this.sessions.delete(sessionId);
    const participantIds = new Set<string>();
    for (const [id, participant] of this.participants) {
      if (participant.sessionId === sessionId) {
        participantIds.add(participant.id);
        this.participants.delete(id);
      }
    }
    for (const [id, response] of this.responses) {
      if (response.sessionId === sessionId || participantIds.has(response.participantId)) {
        this.responses.delete(id);
      }
    }
    for (const [id, event] of this.timeline) {
      if (event.sessionId === sessionId) this.timeline.delete(id);
    }
    for (const [key, receipt] of this.commandReceipts) {
      if (receipt.sessionId === sessionId) this.commandReceipts.delete(key);
    }
    for (const [id, credential] of this.credentials) {
      if (credential.sessionId === sessionId) this.credentials.delete(id);
    }
    for (const [id, report] of this.reports) {
      if (report.sessionId === sessionId) {
        this.reports.delete(id);
        this.reportJobs.delete(id);
      }
    }
    await this.liveRooms.releaseLiveRoomCode("presentation", sessionId);
  }

  private enqueueReport(session: PresentationSessionRecord) {
    if (session.status !== "finished") return;
    const existing = [...this.reports.values()].find((report) => report.sessionId === session.id);
    if (existing) return;
    const createdAt = session.finishedAt ?? session.updatedAt;
    const report: PresentationSessionReportRecord = {
      id: session.id,
      workspaceId: session.workspaceId,
      sessionId: session.id,
      status: "pending",
      schemaVersion: 1,
      payload: null,
      generatedAt: null,
      expiresAt: new Date(session.retentionExpiresAt),
      createdAt: new Date(createdAt),
      updatedAt: new Date(createdAt),
    };
    this.reports.set(report.id, report);
    this.reportJobs.set(report.id, {
      attempts: 0,
      availableAt: new Date(createdAt),
      leaseToken: null,
      lastError: null,
    });
  }

  retainedSessionCounts(workspaceId: string) {
    let presentations = 0;
    for (const session of this.sessions.values()) {
      if (session.workspaceId === workspaceId) presentations += 1;
    }
    return { presentations };
  }

  async listSessions(workspaceId: string, now = new Date(), includeExpired = false) {
    return [...this.sessions.values()]
      .filter(
        (session) =>
          session.workspaceId === workspaceId &&
          (includeExpired || session.status !== "active" || session.liveExpiresAt > now),
      )
      .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
      .map(clone);
  }

  async deleteSession(
    workspaceId: string,
    sessionId: string,
    now = new Date(),
  ): Promise<PresentationSessionDeletion> {
    const session = this.sessions.get(sessionId);
    if (!session || session.workspaceId !== workspaceId) return { status: "not_found" };
    if (session.status === "active" && session.liveExpiresAt > now) return { status: "active" };
    await this.deleteSessionTree(sessionId);
    return { status: "deleted" };
  }

  async createSession(input: PresentationSessionCreateInput) {
    const normalized = normalizeSession(input);
    this.assertWorkspaceMutationAllowed(normalized.workspaceId);
    this.liveRooms.assertNewRoomLaunchAllowed?.(normalized.workspaceId);
    await this.liveRooms.claimLiveRoomCode({
      code: normalized.code,
      workspaceId: normalized.workspaceId,
      artifactType: "presentation",
      artifactId: normalized.id,
      expiresAt: normalized.liveExpiresAt,
      createdAt: normalized.createdAt,
    });
    let inserted = false;
    try {
      this.assertWorkspaceMutationAllowed(normalized.workspaceId);
      this.liveRooms.assertNewRoomLaunchAllowed?.(normalized.workspaceId);
      if (this.sessions.has(normalized.id))
        throw Object.assign(new Error("Room already exists"), {
          code: "23505",
          constraint: "presentation_live_sessions_pkey",
        });
      this.assertPresentationExists(normalized);
      this.sessions.set(input.id, clone(normalized));
      inserted = true;
      this.enqueueReport(normalized);
      if (normalized.status !== "active" || normalized.liveExpiresAt <= new Date()) {
        await this.liveRooms.releaseLiveRoomCode(
          "presentation",
          normalized.id,
          normalized.finishedAt ?? normalized.updatedAt,
        );
      }
      return clone(normalized);
    } catch (error) {
      if (inserted) {
        this.sessions.delete(normalized.id);
        this.reports.delete(normalized.id);
        this.reportJobs.delete(normalized.id);
      }
      await this.liveRooms.releaseLiveRoomCode("presentation", normalized.id);
      throw error;
    }
  }

  async createSessionWithCredential(
    input: PresentationSessionCreateInput,
    credential: PresentationSessionCredentialRecord,
  ) {
    const normalized = normalizeSession(input);
    this.assertWorkspaceMutationAllowed(normalized.workspaceId);
    this.liveRooms.assertNewRoomLaunchAllowed?.(normalized.workspaceId);
    if (
      credential.workspaceId !== normalized.workspaceId ||
      credential.sessionId !== normalized.id
    ) {
      throw new Error("Presentation credential must belong to the session being created");
    }
    if (
      [...this.credentials.values()].some(({ tokenHash }) => tokenHash === credential.tokenHash)
    ) {
      throw new Error("Presentation session credential already exists");
    }
    await this.liveRooms.claimLiveRoomCode({
      code: normalized.code,
      workspaceId: normalized.workspaceId,
      artifactType: "presentation",
      artifactId: normalized.id,
      expiresAt: normalized.liveExpiresAt,
      createdAt: normalized.createdAt,
    });
    let inserted = false;
    try {
      this.assertWorkspaceMutationAllowed(normalized.workspaceId);
      this.liveRooms.assertNewRoomLaunchAllowed?.(normalized.workspaceId);
      if (this.sessions.has(normalized.id))
        throw Object.assign(new Error("Room already exists"), {
          code: "23505",
          constraint: "presentation_live_sessions_pkey",
        });
      this.assertPresentationExists(normalized);
      if (input.commercialCoverage) {
        if (!(this.liveRooms instanceof MemoryRepository))
          throw new Error("Commercial rooms require the durable repository");
        reserveRoomCoverageInMemory(this.liveRooms, input.commercialCoverage);
      }
      this.sessions.set(normalized.id, clone(normalized));
      inserted = true;
      this.credentials.set(credential.id, clone(credential));
      this.enqueueReport(normalized);
      if (normalized.status !== "active" || normalized.liveExpiresAt <= new Date()) {
        await this.liveRooms.releaseLiveRoomCode(
          "presentation",
          normalized.id,
          normalized.finishedAt ?? normalized.updatedAt,
        );
      }
      return { session: clone(normalized), credential: clone(credential) };
    } catch (error) {
      if (inserted) {
        this.sessions.delete(normalized.id);
        this.credentials.delete(credential.id);
        this.reports.delete(normalized.id);
        this.reportJobs.delete(normalized.id);
      }
      await this.liveRooms.releaseLiveRoomCode("presentation", normalized.id);
      throw error;
    }
  }

  async getSessionForWorkspace(workspaceId: string, sessionId: string) {
    return this.getSessionForWorkspaceSync(workspaceId, sessionId);
  }

  /** Memory-only read for atomic parent checks and dependent writes without an await boundary. */
  getSessionForWorkspaceSync(workspaceId: string, sessionId: string) {
    const session = this.sessions.get(sessionId);
    return session?.workspaceId === workspaceId ? clone(session) : null;
  }

  async getSessionById(sessionId: string) {
    const session = this.sessions.get(sessionId);
    return session ? clone(session) : null;
  }

  async getSessionByCode(code: string) {
    const now = new Date();
    const session = [...this.sessions.values()]
      .filter(
        (candidate) =>
          candidate.code === code && candidate.status === "active" && candidate.liveExpiresAt > now,
      )
      .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())[0];
    return session ? clone(session) : null;
  }

  private async applyTransition(
    input: PresentationSessionTransitionInput,
    command?: PresentationSessionCommandInput,
  ) {
    const session = this.sessions.get(input.sessionId);
    if (!session || session.workspaceId !== input.workspaceId) return null;
    this.assertWorkspaceMutationAllowed(input.workspaceId);
    if (session.revision !== input.expectedRevision) {
      throw new PresentationSessionConflictError(input.expectedRevision, session.revision);
    }
    assertCommandRequestHash(command?.requestHash);
    if (command?.publishedQuestionSource) {
      if (!this.liveRooms.assertPresentationPublishedQuestionSource)
        throw new PresentationPublishedQuestionSourceUnavailableError();
      // Do not suspend between this source check and the synchronous state/receipt writes.
      this.liveRooms.assertPresentationPublishedQuestionSource(
        input.workspaceId,
        command.publishedQuestionSource,
      );
    }
    const now = input.occurredAt ?? new Date();
    const { intervention, timelineIntervention } = transitionRecoveryPackIntervention(input);
    if (intervention !== null && !session.recoveryPackCardsEnabled) {
      throw new Error("Recovery Pack cards were not enabled when this session was created");
    }
    const content = transitionContent(session, input);
    const window = transitionWindow({ ...session, content }, input, now);
    const becomingFinished = session.status !== "finished" && input.status === "finished";
    const updated: PresentationSessionRecord = {
      ...session,
      content,
      phase: input.phase,
      currentBlockIndex: input.currentBlockIndex,
      status: input.status,
      recoveryPackIntervention: intervention,
      revision: session.revision + 1,
      eventSeq: session.eventSeq + 1,
      ...window,
      updatedAt: now,
      finishedAt: becomingFinished ? now : session.finishedAt,
      retentionExpiresAt:
        becomingFinished && input.retentionExpiresAt
          ? input.retentionExpiresAt
          : session.retentionExpiresAt,
    };
    this.sessions.set(updated.id, updated);
    const event: PresentationSessionTimelineRecord = {
      ...input.event,
      id: randomUUID(),
      workspaceId: session.workspaceId,
      sessionId: session.id,
      sequence: updated.eventSeq,
      occurredAt: now,
      recoveryPackIntervention: timelineIntervention,
    };
    this.timeline.set(event.id, event);
    if (command) {
      const receipt: PresentationSessionCommandReceiptRecord = {
        id: randomUUID(),
        workspaceId: session.workspaceId,
        sessionId: session.id,
        commandId: command.commandId,
        requestHash: command.requestHash ?? null,
        expectedRevision: input.expectedRevision,
        resultingRevision: updated.revision,
        eventType: input.event.type,
        receivedAt: now,
      };
      this.commandReceipts.set(`${session.id}:${command.commandId}`, receipt);
    }
    // Publish the report job only after every report input for this transition is visible. The
    // memory worker can run concurrently while this async method is suspended, so enqueueing
    // before the final timeline record would diverge from PostgreSQL transaction semantics.
    if (becomingFinished) this.enqueueReport(updated);
    if (updated.status !== "active") {
      if (this.liveRooms instanceof MemoryRepository)
        releaseRoomCoverageInMemory(this.liveRooms, "presentation", updated.id);
      await this.liveRooms.releaseLiveRoomCode("presentation", updated.id, now);
    }
    return clone(updated);
  }

  async transitionSession(input: PresentationSessionTransitionInput) {
    return this.applyTransition(input);
  }

  async transitionSessionCommand(
    input: PresentationSessionCommandInput,
  ): Promise<PresentationTransitionAcceptance> {
    const receipt = this.commandReceipts.get(`${input.sessionId}:${input.commandId}`);
    if (receipt?.workspaceId === input.workspaceId) {
      const session = this.sessions.get(input.sessionId);
      if (!session) return { status: "not_found" };
      return commandReceiptMatches(receipt, input)
        ? { status: "duplicate", session: clone(session) }
        : { status: "idempotency_conflict", session: clone(session) };
    }
    const session = await this.applyTransition(input, input);
    return session ? { status: "accepted", session } : { status: "not_found" };
  }

  async findCommandReceipt(workspaceId: string, sessionId: string, commandId: string) {
    const receipt = this.commandReceipts.get(`${sessionId}:${commandId}`);
    return receipt?.workspaceId === workspaceId ? clone(receipt) : null;
  }

  async addParticipant(input: PresentationSessionParticipantRecord) {
    const session = this.sessions.get(input.sessionId);
    if (!session || session.workspaceId !== input.workspaceId) {
      throw new Error("Presentation session does not exist");
    }
    session.eventSeq += 1;
    const stored = clone(input);
    this.participants.set(input.id, stored);
    return clone(stored);
  }

  async joinParticipantWithinLimit(
    input: PresentationSessionParticipantRecord,
    participantLimit: number,
  ): Promise<PresentationParticipantJoin> {
    const session = this.sessions.get(input.sessionId);
    if (!session || session.workspaceId !== input.workspaceId) {
      return { status: "closed" };
    }
    this.assertWorkspaceMutationAllowed(input.workspaceId);
    if (session.status !== "active" || new Date() >= session.liveExpiresAt) {
      return { status: "closed" };
    }
    const participantCount = [...this.participants.values()].filter(
      (participant) => participant.sessionId === input.sessionId,
    ).length;
    if (participantCount >= participantLimit) return { status: "full" };
    if (this.liveRooms instanceof MemoryRepository)
      assertAudienceAdmissionInMemory(this.liveRooms, input.workspaceId);
    if (this.liveRooms instanceof MemoryRepository)
      consumeRoomCoverageInMemory(this.liveRooms, "presentation", input.sessionId);
    // Sequence fences cover every durable aggregate mutation, not only host transitions. This
    // keeps equal-revision join snapshots from racing one another in reconnecting clients.
    session.eventSeq += 1;
    const stored = clone(input);
    this.participants.set(input.id, stored);
    return { status: "accepted", participant: clone(stored) };
  }

  findAudienceActorSync(sessionId: string, tokenHash: string, now: Date) {
    const workspaceId = this.sessions.get(sessionId)?.workspaceId;
    const participant = [...this.participants.values()].find(
      (candidate) =>
        candidate.workspaceId === workspaceId &&
        candidate.sessionId === sessionId &&
        candidate.tokenHash === tokenHash,
    );
    if (participant)
      return { role: "participant" as const, id: participant.id, alias: participant.nickname };
    const credential = [...this.credentials.values()].find(
      (candidate) =>
        candidate.sessionId === sessionId &&
        candidate.workspaceId === workspaceId &&
        candidate.tokenHash === tokenHash &&
        !candidate.revokedAt &&
        candidate.expiresAt > now,
    );
    return credential ? { role: credential.role, id: credential.id, alias: "Facilitator" } : null;
  }

  async findParticipant(sessionId: string, tokenHash: string) {
    const participant = [...this.participants.values()].find(
      (candidate) => candidate.sessionId === sessionId && candidate.tokenHash === tokenHash,
    );
    if (!participant) return null;
    participant.lastSeenAt = new Date();
    return clone(participant);
  }

  async getResponseContext(
    sessionId: string,
    tokenHash: string,
    idempotencyKey: string,
  ): Promise<PresentationResponseContext | null> {
    const session = this.sessions.get(sessionId);
    const participant = [...this.participants.values()].find(
      (candidate) => candidate.sessionId === sessionId && candidate.tokenHash === tokenHash,
    );
    if (!session || !participant) return null;
    participant.lastSeenAt = new Date();
    const priorResponse = [...this.responses.values()].find(
      (candidate) =>
        candidate.sessionId === sessionId &&
        candidate.participantId === participant.id &&
        candidate.idempotencyKey === idempotencyKey,
    );
    return {
      session: clone(session),
      participant: clone(participant),
      priorResponse: priorResponse ? clone(priorResponse) : null,
    };
  }

  async listParticipants(sessionId: string) {
    return [...this.participants.values()]
      .filter((participant) => participant.sessionId === sessionId)
      .sort((left, right) => left.joinedAt.getTime() - right.joinedAt.getTime())
      .map(clone);
  }

  async saveResponse(input: PresentationSessionResponseRecord) {
    const key = `${input.sessionId}:${input.participantId}:${input.blockId}`;
    const existing = this.responses.get(key);
    if (existing) return clone(existing);
    const stored = clone(input);
    this.responses.set(key, stored);
    const session = this.sessions.get(input.sessionId);
    if (session?.workspaceId === input.workspaceId) session.eventSeq += 1;
    return clone(stored);
  }

  async acceptResponse(
    input: PresentationSessionResponseRecord,
    expectedSessionRevision: number,
  ): Promise<PresentationResponseAcceptance> {
    if (input.idempotencyKey) {
      const idempotent = [...this.responses.values()].find(
        (candidate) =>
          candidate.workspaceId === input.workspaceId &&
          candidate.sessionId === input.sessionId &&
          candidate.participantId === input.participantId &&
          candidate.idempotencyKey === input.idempotencyKey,
      );
      if (idempotent) {
        return idempotent.requestHash &&
          input.requestHash &&
          idempotent.requestHash !== input.requestHash
          ? { status: "idempotency_conflict", response: clone(idempotent) }
          : {
              status: "duplicate",
              response: clone(idempotent),
              acknowledgement: this.responseAcknowledgementState(
                this.sessions.get(input.sessionId)!,
                input.participantId,
              ),
            };
      }
    }
    const session = this.sessions.get(input.sessionId);
    if (!session || session.workspaceId !== input.workspaceId) {
      return { status: "phase_closed" };
    }
    this.assertWorkspaceMutationAllowed(input.workspaceId);
    if (
      ![...this.participants.values()].some(
        (participant) =>
          participant.workspaceId === input.workspaceId &&
          participant.sessionId === input.sessionId &&
          participant.id === input.participantId,
      ) ||
      !responseWindowOpen(session, input, expectedSessionRevision)
    ) {
      return { status: "phase_closed" };
    }
    const key = `${input.sessionId}:${input.participantId}:${input.blockId}`;
    const existing = this.responses.get(key);
    if (existing) {
      if (input.idempotencyKey) {
        return { status: "already_responded", response: clone(existing) };
      }
      return {
        status: "duplicate",
        response: clone(existing),
        acknowledgement: this.responseAcknowledgementState(session, input.participantId),
      };
    }
    // A response changes participant/answer aggregates while the host revision stays fixed.
    // Advance the independent sequence so delayed snapshots cannot roll those aggregates back.
    session.eventSeq += 1;
    const stored = clone(input);
    this.responses.set(key, stored);
    return {
      status: "accepted",
      response: clone(stored),
      acknowledgement: this.responseAcknowledgementState(session, input.participantId),
    };
  }

  async listResponses(sessionId: string) {
    return [...this.responses.values()]
      .filter((response) => response.sessionId === sessionId)
      .sort((left, right) => left.submittedAt.getTime() - right.submittedAt.getTime())
      .map(clone);
  }

  async findResponseByIdempotencyKey(
    sessionId: string,
    participantId: string,
    idempotencyKey: string,
  ) {
    const response = [...this.responses.values()].find(
      (candidate) =>
        candidate.sessionId === sessionId &&
        candidate.participantId === participantId &&
        candidate.idempotencyKey === idempotencyKey,
    );
    return response ? clone(response) : null;
  }

  private participantSnapshotProjection(
    sessionId: string,
    participantId: string,
    currentBlockId: string | null,
    includeStanding: boolean,
  ): PresentationParticipantSnapshotProjection | null {
    const participants = [...this.participants.values()]
      .filter((participant) => participant.sessionId === sessionId)
      .sort(
        (left, right) =>
          left.joinedAt.getTime() - right.joinedAt.getTime() ||
          left.nickname.localeCompare(right.nickname) ||
          left.id.localeCompare(right.id),
      );
    if (!participants.some((participant) => participant.id === participantId)) return null;
    let standing: PresentationParticipantSnapshotProjection["standing"] = null;
    if (includeStanding) {
      const responses = [...this.responses.values()].filter(
        (response) => response.sessionId === sessionId,
      );
      const scores = new Map<string, number>();
      for (const response of responses) {
        scores.set(
          response.participantId,
          (scores.get(response.participantId) ?? 0) + response.score,
        );
      }
      const ranked = participants
        .map((participant) => ({
          ...participant,
          score: scores.get(participant.id) ?? 0,
        }))
        .sort(comparePresentationLeaderboardEntries);
      const rank = ranked.findIndex((participant) => participant.id === participantId);
      standing = rank < 0 ? null : { rank: rank + 1, score: ranked[rank]!.score };
    }
    const currentResponse = currentBlockId
      ? this.responses.get(`${sessionId}:${participantId}:${currentBlockId}`)
      : undefined;
    return {
      participantCount: participants.length,
      standing,
      currentResponse: currentResponse ? clone(currentResponse) : null,
    };
  }

  private responseAcknowledgementState(
    session: PresentationSessionRecord,
    participantId: string,
  ): PresentationResponseAcknowledgementState {
    const currentBlock =
      session.currentBlockIndex >= 0
        ? (session.content.blocks[session.currentBlockIndex] ?? null)
        : null;
    const projection = this.participantSnapshotProjection(
      session.id,
      participantId,
      currentBlock?.id ?? null,
      session.phase !== "question_open",
    );
    if (!projection) throw new Error("Presentation response participant no longer exists");
    return { session: clone(session), projection };
  }

  async getParticipantSnapshotProjection(
    sessionId: string,
    participantId: string,
    currentBlockId: string | null,
    includeStanding: boolean,
  ): Promise<PresentationParticipantSnapshotProjection | null> {
    return this.participantSnapshotProjection(
      sessionId,
      participantId,
      currentBlockId,
      includeStanding,
    );
  }

  async listTimeline(sessionId: string) {
    return [...this.timeline.values()]
      .filter((event) => event.sessionId === sessionId)
      .sort((left, right) => left.sequence - right.sequence)
      .map(clone);
  }

  async getReport(workspaceId: string, sessionId: string) {
    const session = this.sessions.get(sessionId);
    if (!session || session.workspaceId !== workspaceId) return null;
    const report = [...this.reports.values()].find(
      (candidate) => candidate.sessionId === sessionId,
    );
    return report ? clone(report) : null;
  }

  async claimReportJob(now: Date, leaseUntil: Date) {
    if (this.liveRooms instanceof MemoryRepository)
      getMemoryPlatformRepository(this.liveRooms).memoryStore.assertMutationAllowed();
    const candidate = [...this.reportJobs.entries()]
      .filter(([id, job]) => this.reports.get(id)?.status === "pending" && job.availableAt <= now)
      .sort(
        (left, right) =>
          left[1].availableAt.getTime() - right[1].availableAt.getTime() ||
          left[0].localeCompare(right[0]),
      )[0];
    if (!candidate) return null;
    const [reportId, metadata] = candidate;
    const report = this.reports.get(reportId)!;
    const leaseToken = randomUUID();
    metadata.attempts += 1;
    metadata.availableAt = new Date(leaseUntil);
    metadata.leaseToken = leaseToken;
    return {
      reportId,
      workspaceId: report.workspaceId,
      sessionId: report.sessionId,
      attempts: metadata.attempts,
      leaseToken,
      expiresAt: new Date(report.expiresAt),
    };
  }

  async completeReportJob(
    job: PresentationSessionReportJob,
    report: PresentationSessionReportCompletion,
  ) {
    if (this.liveRooms instanceof MemoryRepository)
      getMemoryPlatformRepository(this.liveRooms).memoryStore.assertMutationAllowed();
    if (job.reportId !== report.reportId || job.sessionId !== report.sessionId) {
      throw new Error("Completed Presentation report does not match the claimed job");
    }
    if (!Number.isInteger(report.schemaVersion) || report.schemaVersion < 1) {
      throw new Error("Presentation report schema version must be a positive integer");
    }
    const current = this.reports.get(job.reportId);
    const metadata = this.reportJobs.get(job.reportId);
    if (
      !current ||
      !metadata ||
      current.workspaceId !== job.workspaceId ||
      current.sessionId !== job.sessionId ||
      current.status !== "pending" ||
      metadata.leaseToken !== job.leaseToken
    ) {
      throw new Error("The claimed Presentation report job is no longer pending");
    }
    this.reports.set(job.reportId, {
      ...current,
      status: "ready",
      schemaVersion: report.schemaVersion,
      payload: clone(report.payload),
      generatedAt: new Date(report.generatedAt),
      updatedAt: new Date(),
    });
    this.reportJobs.delete(job.reportId);
  }

  async retryReportJob(
    job: PresentationSessionReportJob,
    error: string,
    availableAt: Date,
    failed: boolean,
  ) {
    if (this.liveRooms instanceof MemoryRepository)
      getMemoryPlatformRepository(this.liveRooms).memoryStore.assertMutationAllowed();
    const report = this.reports.get(job.reportId);
    const metadata = this.reportJobs.get(job.reportId);
    if (
      !report ||
      !metadata ||
      report.workspaceId !== job.workspaceId ||
      report.sessionId !== job.sessionId ||
      report.status !== "pending" ||
      metadata.leaseToken !== job.leaseToken
    ) {
      return;
    }
    metadata.lastError = error.slice(0, 2_000);
    metadata.availableAt = new Date(availableAt);
    metadata.leaseToken = null;
    report.updatedAt = new Date();
    if (failed) {
      report.status = "failed";
      // Retain attempts/error evidence for a guarded operator retry.
    }
  }

  operatorReportQueueRows(now: Date) {
    return [...this.reports.values()].map((report) => {
      const metadata = this.reportJobs.get(report.id);
      return {
        id: report.id,
        status: report.status,
        createdAt: report.createdAt,
        processing:
          report.status === "pending" &&
          Boolean(metadata?.leaseToken && metadata.availableAt > now),
        retryable:
          report.status === "failed" &&
          report.expiresAt > now &&
          this.sessions.has(report.sessionId),
      };
    });
  }
  retryFailedReportForOperator(id: string, now: Date): (() => void) | null {
    const report = this.reports.get(id);
    if (
      !report ||
      report.status !== "failed" ||
      report.expiresAt <= now ||
      !this.sessions.has(report.sessionId)
    )
      return null;
    const before = clone(report);
    const metadata = this.reportJobs.get(id);
    const priorMetadata = metadata ? clone(metadata) : null;
    this.reports.set(id, { ...report, status: "pending", updatedAt: now });
    this.reportJobs.set(id, {
      attempts: metadata?.attempts ?? 0,
      availableAt: now,
      leaseToken: null,
      lastError: null,
    });
    return () => {
      this.reports.set(id, before);
      if (priorMetadata) this.reportJobs.set(id, priorMetadata);
      else this.reportJobs.delete(id);
    };
  }

  async createCredential(input: PresentationSessionCredentialRecord) {
    const session = this.sessions.get(input.sessionId);
    if (!session || session.workspaceId !== input.workspaceId) {
      throw new Error("Presentation session does not exist");
    }
    if ([...this.credentials.values()].some(({ tokenHash }) => tokenHash === input.tokenHash)) {
      throw new Error("Presentation session credential already exists");
    }
    this.credentials.set(input.id, clone(input));
    return clone(input);
  }

  async rotateCredential(input: PresentationSessionCredentialRecord) {
    for (const credential of this.credentials.values()) {
      if (
        credential.workspaceId === input.workspaceId &&
        credential.sessionId === input.sessionId &&
        credential.role === input.role &&
        credential.revokedAt === null
      ) {
        credential.revokedAt = new Date(input.createdAt);
      }
    }
    return this.createCredential(input);
  }

  async findValidCredential(
    sessionId: string,
    tokenHash: string,
    role?: PresentationSessionCredentialRole,
    now = new Date(),
  ) {
    const credential = [...this.credentials.values()].find(
      (candidate) =>
        candidate.sessionId === sessionId &&
        candidate.tokenHash === tokenHash &&
        (role === undefined || candidate.role === role) &&
        candidate.revokedAt === null &&
        candidate.expiresAt > now,
    );
    return credential ? clone(credential) : null;
  }

  async revokeCredential(
    workspaceId: string,
    sessionId: string,
    credentialId: string,
    revokedAt = new Date(),
    role?: PresentationSessionCredentialRole,
  ) {
    const credential = this.credentials.get(credentialId);
    if (
      !credential ||
      credential.workspaceId !== workspaceId ||
      credential.sessionId !== sessionId ||
      (role !== undefined && credential.role !== role)
    ) {
      return null;
    }
    credential.revokedAt ??= revokedAt;
    return clone(credential);
  }
}
