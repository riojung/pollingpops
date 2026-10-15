import { createServer, type Server as HttpServer } from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { io as createClient, type Socket } from "socket.io-client";
import type {
  PresentationCommand,
  PresentationCompanionCommand,
  PresentationCompanionSnapshot,
  PresentationContent,
  PresentationEventEnvelope,
  PresentationHostSnapshot,
  PresentationParticipantSnapshot,
  PresentationResponseAck,
  PresentationResponseSubmit,
  PresentationRoleSnapshot,
  PresentationRoomStatus,
  PresentationSyncRequest,
  PresentationSyncResponse,
} from "@openround/contracts";
import { PresentationContentSchema } from "@openround/contracts";
import {
  MemoryRepository,
  createPresentationRepository,
  createPresentationSessionRepository,
} from "@openround/db";
import { ConfigSchema } from "../src/config.js";
import { MetricsService } from "../src/metrics.js";
import type { PresentationRealtimeService } from "../src/presentation-realtime.js";
import {
  PresentationBroadcastConsistencyError,
  PresentationSessionService,
  PresentationSessionServiceError,
  presentationParticipantTokenHash,
} from "../src/presentation-session-service.js";
import { attachRealtime } from "../src/realtime.js";
import type { SessionService } from "../src/session-service.js";
import { StorageService } from "../src/storage.js";

const workspaceId = crypto.randomUUID();
const sessionId = crypto.randomUUID();
const presentationId = crypto.randomUUID();
const presentationVersionId = crypto.randomUUID();
const participantId = crypto.randomUUID();
const blockId = crypto.randomUUID();
const controlToken = "host-control-token-that-is-long-enough";
const companionToken = "companion-token-that-is-long-enough";
const participantToken = "participant-token-that-is-long-enough";

function roomStatus(responseCount = 0) {
  return {
    sessionId,
    joinedCount: 1,
    connectedCount: 1,
    notCurrentlyConnectedCount: 0,
    responseCount,
    sampledAt: new Date().toISOString(),
  };
}

function snapshotBase(revision = 0) {
  return {
    sessionId,
    artifactType: "presentation" as const,
    presentationId,
    presentationVersionId,
    title: "Realtime recovery",
    code: "1234567",
    status: "active" as const,
    phase: "lobby" as const,
    currentBlockIndex: -1,
    blockCount: 1,
    revision,
    seq: revision,
    serverTime: new Date().toISOString(),
    questionOpenedAt: null,
    questionClosesAt: null,
    acceptingResponses: false,
    settings: { timeMode: "timed" as const, trustMode: "learning" as const },
    finishedAt: null,
  };
}

function hostSnapshot(revision = 0, responseCount = 0): PresentationHostSnapshot {
  return {
    ...snapshotBase(revision),
    projection: "host",
    currentBlock: null,
    participantCount: 1,
    responseCount,
    participants: [
      {
        id: participantId,
        nickname: "Learner",
        joinedAt: new Date().toISOString(),
        score: 0,
        rank: 1,
      },
    ],
    roomStatus: roomStatus(responseCount),
  };
}

function participantSnapshot(
  revision = 0,
  responseSubmitted = false,
): PresentationParticipantSnapshot {
  return {
    ...snapshotBase(revision),
    projection: "participant",
    participantId,
    currentBlock: null,
    participantCount: 1,
    responseSubmitted,
    standing: null,
    responseResult: null,
  };
}

function companionSnapshot(revision = 0, responseCount = 0): PresentationCompanionSnapshot {
  return {
    ...snapshotBase(revision),
    projection: "companion",
    currentBlock: null,
    roomStatus: roomStatus(responseCount),
    primaryAction: "advance",
    resultSummary: null,
  };
}

class FakePresentationRealtimeService implements PresentationRealtimeService {
  revision = 0;
  responseId = crypto.randomUUID();
  responses = new Set<string>();
  internalSyncError = false;
  syncBarrier: Promise<void> | null = null;
  activeSyncs = 0;
  maximumActiveSyncs = 0;
  syncCalls = 0;
  deleted = false;
  companionRevoked = false;
  sessionDeletedHandler: ((sessionId: string) => void) | null = null;

  setSessionDeletedHandler(handler: ((sessionId: string) => void) | null) {
    this.sessionDeletedHandler = handler;
  }

  deleteSession() {
    this.deleted = true;
    this.sessionDeletedHandler?.(sessionId);
  }

  async workspaceForCode(code: string) {
    return !this.deleted && code === "1234567" ? workspaceId : null;
  }

  async workspaceForSession(candidate: string) {
    return !this.deleted && candidate === sessionId ? workspaceId : null;
  }

  async join(code: string, _nickname: string) {
    if (this.deleted || code !== "1234567")
      throw Object.assign(new Error("Presentation not found"), { code: "NOT_FOUND" });
    return {
      workspaceId,
      participantToken,
      snapshot: participantSnapshot(this.revision),
    };
  }

  async sync(input: PresentationSyncRequest): Promise<PresentationSyncResponse> {
    this.syncCalls += 1;
    this.activeSyncs += 1;
    this.maximumActiveSyncs = Math.max(this.maximumActiveSyncs, this.activeSyncs);
    try {
      if (this.syncBarrier) await this.syncBarrier;
      if (this.deleted) this.unauthorized();
      if (this.internalSyncError) {
        throw Object.assign(new Error("database host db.internal and table secret_table failed"), {
          details: { internalQuery: "SELECT secret" },
        });
      }
      if (input.projection === "host") {
        if (input.controlToken !== controlToken) this.unauthorized();
        return {
          resetRequired: false,
          events: [],
          snapshot: hostSnapshot(this.revision, this.responses.size),
        };
      }
      if (input.projection === "participant") {
        if (input.participantToken !== participantToken) this.unauthorized();
        return {
          resetRequired: false,
          events: [],
          snapshot: participantSnapshot(this.revision, this.responses.size > 0),
        };
      }
      if (input.projection === "companion") {
        if (this.companionRevoked || input.companionToken !== companionToken) this.unauthorized();
        return {
          resetRequired: false,
          events: [],
          snapshot: companionSnapshot(this.revision, this.responses.size),
        };
      }
      this.unauthorized();
    } finally {
      this.activeSyncs -= 1;
    }
  }

  async command(input: PresentationCommand) {
    if (this.deleted) this.unauthorized();
    if (input.controlToken !== controlToken) this.unauthorized();
    if (input.expectedRevision !== this.revision) {
      throw Object.assign(new Error("This Presentation advanced in another host window"), {
        code: "STALE_SESSION",
        details: { expectedRevision: input.expectedRevision, currentRevision: this.revision },
      });
    }
    this.revision += 1;
    return hostSnapshot(this.revision, this.responses.size);
  }

  async submitResponse(input: PresentationResponseSubmit): Promise<PresentationResponseAck> {
    if (this.deleted) this.unauthorized();
    if (input.participantToken !== participantToken) this.unauthorized();
    const duplicate = this.responses.has(input.idempotencyKey);
    this.responses.add(input.idempotencyKey);
    return {
      sessionId,
      blockId: input.blockId,
      idempotencyKey: input.idempotencyKey,
      accepted: true,
      duplicate,
      responseId: this.responseId,
      acceptedAt: new Date().toISOString(),
      snapshot: participantSnapshot(this.revision, true),
    };
  }

  async companionCommand(input: PresentationCompanionCommand) {
    if (this.deleted || this.companionRevoked || input.companionToken !== companionToken)
      this.unauthorized();
    if (input.expectedRevision !== this.revision)
      throw Object.assign(new Error("Presentation advanced"), { code: "STALE_SESSION" });
    this.revision += 1;
    return companionSnapshot(this.revision, this.responses.size);
  }

  private unauthorized(): never {
    throw Object.assign(new Error("Presentation credential is invalid"), { code: "UNAUTHORIZED" });
  }
}

function emitAck<T>(socket: Socket, event: string, payload: unknown) {
  return new Promise<T>((resolve) => socket.emit(event, payload, resolve));
}

function waitForRoomStatus(socket: Socket, connectedCount: number) {
  return new Promise<PresentationRoomStatus>((resolve) => {
    const listener = (
      event: PresentationEventEnvelope<{ roomStatus: PresentationRoomStatus }>,
      acknowledge?: () => void,
    ) => {
      acknowledge?.();
      if (event.payload.roomStatus.connectedCount !== connectedCount) return;
      socket.off("presentation.room-status.updated", listener);
      resolve(event.payload.roomStatus);
    };
    socket.on("presentation.room-status.updated", listener);
  });
}

describe("Presentation realtime transport", () => {
  let httpServer: HttpServer;
  let realtime: Awaited<ReturnType<typeof attachRealtime>>;
  let origin: string;
  let clients: Socket[];
  let service: FakePresentationRealtimeService;
  let metrics: MetricsService;
  let realtimeEnabled: boolean;

  beforeEach(async () => {
    clients = [];
    service = new FakePresentationRealtimeService();
    metrics = new MetricsService();
    realtimeEnabled = true;
    const roundSessions = {
      subscribe: vi.fn(() => vi.fn()),
      subscribeAuxiliary: vi.fn(() => vi.fn()),
      disconnect: vi.fn().mockResolvedValue(undefined),
    } as unknown as SessionService;
    httpServer = createServer();
    await new Promise<void>((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
    const address = httpServer.address();
    if (!address || typeof address === "string") throw new Error("Test server did not bind");
    origin = `http://127.0.0.1:${address.port}`;
    realtime = await attachRealtime(
      httpServer,
      roundSessions,
      ConfigSchema.parse({
        NODE_ENV: "test",
        ALLOW_IN_MEMORY: "true",
        WEB_ORIGIN: origin,
        PUBLIC_API_URL: origin,
        LOG_LEVEL: "silent",
      }),
      metrics,
      undefined,
      { service, isEnabled: () => realtimeEnabled },
    );
  });

  afterEach(async () => {
    for (const client of clients) client.disconnect();
    await realtime.close();
    if (httpServer.listening) {
      await new Promise<void>((resolve, reject) =>
        httpServer.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });

  async function connect() {
    const client = createClient(origin, {
      transports: ["websocket"],
      reconnection: false,
      extraHeaders: { origin },
    });
    clients.push(client);
    await new Promise<void>((resolve, reject) => {
      client.once("connect", resolve);
      client.once("connect_error", reject);
    });
    return client;
  }

  it("forwards exact room passwords and returns actionable admission errors", async () => {
    const participant = await connect();
    const join = vi
      .spyOn(service, "join")
      .mockRejectedValueOnce(
        new PresentationSessionServiceError(
          401,
          "PASSWORD_REQUIRED",
          "Enter the room password to join",
        ),
      )
      .mockRejectedValueOnce(
        new PresentationSessionServiceError(
          401,
          "INVALID_PASSWORD",
          "The room password is incorrect",
        ),
      );
    const missing = await emitAck<{ error: { code: string } }>(participant, "presentation.join", {
      code: "1234567",
      nickname: "Learner",
    });
    expect(missing.error.code).toBe("PASSWORD_REQUIRED");
    const incorrect = await emitAck<{ error: { code: string } }>(participant, "presentation.join", {
      code: "1234567",
      nickname: "Learner",
      password: "Incorrect password",
    });
    expect(incorrect.error.code).toBe("INVALID_PASSWORD");
    const password = " Exact Presentation password ";
    const admitted = await emitAck<{ data: { participantToken: string } }>(
      participant,
      "presentation.join",
      { code: "1234567", nickname: "Learner", password },
    );
    expect(admitted.data.participantToken).toBe(participantToken);
    expect(join).toHaveBeenLastCalledWith("1234567", "Learner", password);
    const socketData = JSON.stringify(
      (await realtime.io.fetchSockets()).map((socket) => socket.data),
    );
    expect(socketData).not.toContain(password);
    expect(socketData).not.toContain("password");
  });

  it("joins and synchronizes with authoritative role projections", async () => {
    expect(
      (realtime.io as unknown as { _opts?: { connectionStateRecovery?: unknown } })._opts
        ?.connectionStateRecovery,
    ).toBeUndefined();
    const participant = await connect();
    const joined = await emitAck<{
      data: { participantToken: string; snapshot: PresentationParticipantSnapshot };
    }>(participant, "presentation.join", { code: "1234567", nickname: "Learner" });
    expect(joined.data).toMatchObject({
      participantToken,
      snapshot: { projection: "participant", participantId, sessionId },
    });

    const host = await connect();
    const synchronized = await emitAck<{ data: PresentationSyncResponse }>(
      host,
      "presentation.sync.request",
      { sessionId, projection: "host", controlToken, afterSeq: 0 },
    );
    expect(synchronized.data.snapshot).toMatchObject({
      projection: "host",
      sessionId,
      participants: [{ id: participantId, nickname: "Learner" }],
    });
    const socketData = JSON.stringify(
      (await realtime.io.fetchSockets()).map((serverSocket) => serverSocket.data),
    );
    expect(socketData).not.toContain(participantToken);
    expect(socketData).not.toContain(controlToken);
    expect(socketData).toContain("presentationParticipantTokenHash");
    expect(socketData).toContain("presentationControlTokenHash");
  });

  it("returns the same durable acknowledgement for a duplicate response", async () => {
    const participant = await connect();
    const payload = {
      sessionId,
      participantToken,
      blockId,
      expectedRevision: 0,
      idempotencyKey: "durable-response-1",
      response: { ratingValue: 3 },
    };
    const first = await emitAck<{ data: PresentationResponseAck }>(
      participant,
      "presentation.response.submit",
      payload,
    );
    const duplicate = await emitAck<{ data: PresentationResponseAck }>(
      participant,
      "presentation.response.submit",
      payload,
    );

    expect(first.data).toMatchObject({ accepted: true, duplicate: false, blockId });
    expect(duplicate.data).toMatchObject({
      accepted: true,
      duplicate: true,
      responseId: first.data.responseId,
      blockId,
    });
  });

  it("disconnects a deleted room and rejects its old credentials on reconnect", async () => {
    const participant = await connect();
    await emitAck(participant, "presentation.join", { code: "1234567", nickname: "Learner" });
    const host = await connect();
    await emitAck(host, "presentation.sync.request", {
      sessionId,
      projection: "host",
      controlToken,
    });
    const unrelated = await connect();
    expect(service.sessionDeletedHandler).toEqual(expect.any(Function));

    const participantDisconnected = new Promise<string>((resolve) =>
      participant.once("disconnect", resolve),
    );
    const hostDisconnected = new Promise<string>((resolve) => host.once("disconnect", resolve));
    service.deleteSession();
    await expect(participantDisconnected).resolves.toBe("io server disconnect");
    await expect(hostDisconnected).resolves.toBe("io server disconnect");
    expect(unrelated.connected).toBe(true);
    expect(await realtime.io.in(`presentation:${sessionId}`).fetchSockets()).toEqual([]);

    const reconnect = await connect();
    for (const payload of [
      { sessionId, projection: "host", controlToken },
      { sessionId, projection: "participant", participantToken },
    ]) {
      const response = await emitAck(reconnect, "presentation.sync.request", payload);
      expect(response).toMatchObject({ error: { code: "UNAUTHORIZED" } });
    }
    expect(await realtime.io.in(`presentation:${sessionId}`).fetchSockets()).toEqual([]);
  });

  it("keeps an active session usable and reconnectable when rollout is paused", async () => {
    const participant = await connect();
    await emitAck(participant, "presentation.join", {
      code: "1234567",
      nickname: "Learner",
    });
    realtimeEnabled = false;

    const accepted = await emitAck<{ data: PresentationResponseAck }>(
      participant,
      "presentation.response.submit",
      {
        sessionId,
        participantToken,
        blockId,
        expectedRevision: 0,
        idempotencyKey: "rollout-paused-response",
        response: { ratingValue: 3 },
      },
    );
    expect(accepted.data).toMatchObject({ accepted: true, duplicate: false });

    const reconnect = await connect();
    const synchronized = await emitAck<{ data: PresentationSyncResponse }>(
      reconnect,
      "presentation.sync.request",
      { sessionId, projection: "participant", participantToken, afterSeq: 0 },
    );
    expect(synchronized.data.snapshot).toMatchObject({
      sessionId,
      projection: "participant",
      responseSubmitted: true,
    });

    const host = await connect();
    const advanced = await emitAck<{ data: { snapshot: PresentationHostSnapshot } }>(
      host,
      "presentation.command",
      {
        sessionId,
        controlToken,
        commandId: crypto.randomUUID(),
        expectedRevision: 0,
        action: "advance",
      },
    );
    expect(advanced.data.snapshot.revision).toBe(1);
  });

  it("rate-limits reconnecting join abuse by room and alias instead of campus IP", async () => {
    const attempts: Array<{ data?: unknown; error?: { code: string } }> = [];
    for (let attempt = 0; attempt < 11; attempt += 1) {
      const client = await connect();
      attempts.push(
        await emitAck(client, "presentation.join", {
          code: "1234567",
          nickname: "Repeated alias",
        }),
      );
    }

    expect(attempts.slice(0, 10).every(({ data }) => Boolean(data))).toBe(true);
    expect(attempts[10]).toEqual({
      error: { code: "RATE_LIMITED", message: "Too many join attempts" },
    });
    const renderedMetrics = await metrics.render();
    expect(renderedMetrics).toContain(
      'openround_presentation_admission_attempts_total{transport="socket",outcome="accepted"} 10',
    );
    expect(renderedMetrics).toContain(
      'openround_presentation_admission_attempts_total{transport="socket",outcome="rate_limited"} 1',
    );
  });

  it("rejects a stale command without rebinding or broadcasting it", async () => {
    const host = await connect();
    const result = await emitAck<{ error: { code: string; details: unknown } }>(
      host,
      "presentation.command",
      {
        sessionId,
        controlToken,
        commandId: crypto.randomUUID(),
        expectedRevision: 8,
        action: "advance",
      },
    );
    expect(result.error).toMatchObject({
      code: "STALE_SESSION",
      details: { expectedRevision: 8, currentRevision: 0 },
    });
    expect(service.revision).toBe(0);
  });

  it("does not disclose unexpected service errors over the socket", async () => {
    service.internalSyncError = true;
    const client = await connect();
    const result = await emitAck<{ error: { code: string; message: string; details?: unknown } }>(
      client,
      "presentation.sync.request",
      { sessionId, projection: "host", controlToken, afterSeq: 0 },
    );
    expect(result).toEqual({
      error: {
        code: "INTERNAL_ERROR",
        message: "The Presentation realtime request failed",
      },
    });
    expect(JSON.stringify(result)).not.toContain("db.internal");
    expect(JSON.stringify(result)).not.toContain("secret_table");
  });

  it.each([
    "advance",
    "insert_recovery_pack",
    "start_recovery_card",
    "insert_quick_check",
    "insert_published_question",
  ] as const)(
    "dispatches companion %s without promoting their socket or leaking host broadcasts",
    async (action) => {
      const companion = await connect();
      const host = await connect();
      await emitAck(companion, "presentation.sync.request", {
        sessionId,
        projection: "companion",
        companionToken,
      });
      await emitAck(host, "presentation.sync.request", {
        sessionId,
        projection: "host",
        controlToken,
      });
      const waitForProjection = (client: Socket, revision: number) =>
        new Promise<PresentationRoleSnapshot>((resolve) => {
          const listener = (
            event: PresentationEventEnvelope<{ snapshot: PresentationRoleSnapshot }>,
            acknowledge?: () => void,
          ) => {
            acknowledge?.();
            if (event.payload.snapshot.revision !== revision) return;
            client.off("presentation.session.updated", listener);
            resolve(event.payload.snapshot);
          };
          client.on("presentation.session.updated", listener);
        });
      const companionUpdate = waitForProjection(companion, 1);
      const hostUpdate = waitForProjection(host, 1);
      const command = {
        sessionId,
        companionToken,
        commandId: crypto.randomUUID(),
        expectedRevision: 0,
        action,
        ...(action === "insert_recovery_pack" ? { packVersionId: crypto.randomUUID() } : {}),
        ...(action === "insert_published_question"
          ? {
              publishedQuestion: {
                sourceQuizVersionId: crypto.randomUUID(),
                sourceQuestionId: crypto.randomUUID(),
                contentHash: "a".repeat(64),
              },
            }
          : {}),
        ...(action === "insert_quick_check"
          ? {
              quickCheck: {
                prompt: "Which pace works best?",
                choices: ["More time", "Ready to continue"],
                timeLimitSeconds: 23,
              },
            }
          : {}),
        ...(action === "start_recovery_card"
          ? {
              recoveryPackCard: { insertionId: crypto.randomUUID(), cardId: crypto.randomUUID() },
              interventionType: "explain",
            }
          : {}),
      };
      const accepted = await emitAck<{ data: { snapshot: PresentationCompanionSnapshot } }>(
        companion,
        "presentation.command",
        command,
      );
      expect(accepted.data.snapshot).toMatchObject({ projection: "companion", revision: 1 });
      const companionBroadcast = await companionUpdate;
      expect(companionBroadcast.projection).toBe("companion");
      expect(JSON.stringify(companionBroadcast)).not.toContain("Learner");
      expect(await hostUpdate).toMatchObject({
        projection: "host",
        participants: [{ nickname: "Learner" }],
      });
      const serverSocket = (await realtime.io.fetchSockets()).find(
        (candidate) => candidate.id === companion.id,
      )!;
      expect(serverSocket.data).toMatchObject({
        presentationProjection: "companion",
        presentationCompanionTokenHash: presentationParticipantTokenHash(companionToken),
      });
      expect(serverSocket.data.presentationControlTokenHash).toBeUndefined();
      for (const payload of [
        {
          ...command,
          action: "start_recovery_card",
          recoveryPackCard: undefined,
          interventionType: undefined,
        },
        { ...command, controlToken },
        {
          sessionId,
          controlToken: companionToken,
          commandId: crypto.randomUUID(),
          expectedRevision: 1,
          action: "advance",
        },
      ]) {
        const rejected = await emitAck<{ error: { code: string } }>(
          companion,
          "presentation.command",
          payload,
        );
        expect(["VALIDATION_ERROR", "UNAUTHORIZED"]).toContain(rejected.error.code);
      }
      expect(service.revision).toBe(1);
      expect(serverSocket.data.presentationProjection).toBe("companion");
      service.companionRevoked = true;
      const disconnected = new Promise<void>((resolve) =>
        companion.once("disconnect", () => resolve()),
      );
      await emitAck(host, "presentation.command", {
        sessionId,
        controlToken,
        commandId: crypto.randomUUID(),
        expectedRevision: 1,
        action: "advance",
      });
      await disconnected;
      expect(host.connected).toBe(true);
    },
  );

  it("broadcasts only the projection authorized for each socket", async () => {
    const participant = await connect();
    const host = await connect();
    await emitAck(participant, "presentation.sync.request", {
      sessionId,
      projection: "participant",
      participantToken,
      afterSeq: 0,
    });
    await emitAck(host, "presentation.sync.request", {
      sessionId,
      projection: "host",
      controlToken,
      afterSeq: 0,
    });

    const participantUpdate = new Promise<any>((resolve) =>
      participant.on("presentation.session.updated", (event, acknowledge) => {
        acknowledge?.();
        if (event.payload.snapshot.revision === 1) resolve(event);
      }),
    );
    const hostUpdate = new Promise<any>((resolve) =>
      host.on("presentation.session.updated", (event, acknowledge) => {
        acknowledge?.();
        if (event.payload.snapshot.revision === 1) resolve(event);
      }),
    );
    const command = await emitAck<{ data: { snapshot: PresentationHostSnapshot } }>(
      host,
      "presentation.command",
      {
        sessionId,
        controlToken,
        commandId: crypto.randomUUID(),
        expectedRevision: 0,
        action: "advance",
      },
    );
    expect(command.data.snapshot.revision).toBe(1);

    const [participantEvent, hostEvent] = await Promise.all([participantUpdate, hostUpdate]);
    expect(participantEvent.payload.snapshot).toMatchObject({
      projection: "participant",
      participantId,
      revision: 1,
    });
    expect(participantEvent.payload.snapshot).not.toHaveProperty("participants");
    expect(participantEvent.payload.snapshot).not.toHaveProperty("roomStatus");
    expect(JSON.stringify(participantEvent)).not.toContain("isCorrect");
    expect(hostEvent.payload.snapshot).toMatchObject({
      projection: "host",
      revision: 1,
      participants: [{ id: participantId }],
      roomStatus: { connectedCount: 1 },
    });
  });

  it("keeps authorized sockets connected while a transient bulk projection is retried", async () => {
    const participant = await connect();
    const host = await connect();
    await emitAck(participant, "presentation.sync.request", {
      sessionId,
      projection: "participant",
      participantToken,
      afterSeq: 0,
    });
    await emitAck(host, "presentation.sync.request", {
      sessionId,
      projection: "host",
      controlToken,
      afterSeq: 0,
    });
    await new Promise((resolve) => setTimeout(resolve, 300));
    const bulkSync = vi.fn(async () => {
      throw new PresentationBroadcastConsistencyError(sessionId);
    });
    Object.assign(service, { syncManyByCredentialHash: bulkSync });

    await emitAck(host, "presentation.command", {
      sessionId,
      controlToken,
      commandId: crypto.randomUUID(),
      expectedRevision: 0,
      action: "advance",
    });

    await vi.waitFor(() => expect(bulkSync).toHaveBeenCalled());
    expect(participant.connected).toBe(true);
    expect(host.connected).toBe(true);
    expect(await realtime.io.fetchSockets()).toHaveLength(2);
    expect(await metrics.render()).toContain(
      'openround_presentation_broadcast_duration_seconds_count{outcome="error"}',
    );
  });

  it("coalesces overlapping room broadcasts into one queued rerun", async () => {
    const participant = await connect();
    const host = await connect();
    await emitAck(participant, "presentation.sync.request", {
      sessionId,
      projection: "participant",
      participantToken,
      afterSeq: 0,
    });
    await emitAck(host, "presentation.sync.request", {
      sessionId,
      projection: "host",
      controlToken,
      afterSeq: 0,
    });
    await new Promise((resolve) => setTimeout(resolve, 300));

    let release!: () => void;
    service.syncBarrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    service.maximumActiveSyncs = 0;
    const startingCalls = service.syncCalls;
    await emitAck(host, "presentation.command", {
      sessionId,
      controlToken,
      commandId: crypto.randomUUID(),
      expectedRevision: 0,
      action: "advance",
    });
    await vi.waitFor(() => expect(service.activeSyncs).toBe(2));
    await emitAck(host, "presentation.command", {
      sessionId,
      controlToken,
      commandId: crypto.randomUUID(),
      expectedRevision: 1,
      action: "advance",
    });
    release();
    service.syncBarrier = null;

    await vi.waitFor(() => expect(service.syncCalls - startingCalls).toBeGreaterThanOrEqual(4));
    await vi.waitFor(() => expect(service.activeSyncs).toBe(0));
    expect(service.maximumActiveSyncs).toBe(2);
  });
});

function mixedTransportContent(): PresentationContent {
  return PresentationContentSchema.parse({
    title: "Mixed transport presence",
    description: "",
    experiencePreset: { id: "focus", version: 1 },
    schemaVersion: 2,
    blocks: [
      {
        id: crypto.randomUUID(),
        kind: "question",
        citations: [],
        question: {
          id: crypto.randomUUID(),
          type: "single_select",
          prompt: "Which participant is still connected?",
          purpose: "diagnostic",
          confidence: "optional",
          delivery: "main",
          conceptKeys: ["presence"],
          linkedRecheckQuestionId: null,
          choices: [
            {
              id: crypto.randomUUID(),
              label: "The active socket participant",
              isCorrect: true,
              feedback: "Correct",
            },
            {
              id: crypto.randomUUID(),
              label: "Nobody",
              isCorrect: false,
              misconceptionKey: "socket-presence",
            },
          ],
          timeLimitSeconds: 60,
          basePoints: 1_000,
          explanation: "Socket presence survives a host-only fallback.",
          mediaId: null,
          mediaAlt: null,
          sourceCitations: [],
        },
      },
    ],
  });
}

describe("Presentation mixed-transport presence", () => {
  it("broadcasts out-of-band host commands and legacy advances, then clears the update handler on close", async () => {
    const mixedWorkspaceId = crypto.randomUUID();
    const mixedSessionId = crypto.randomUUID();
    const mixedParticipantId = crypto.randomUUID();
    const mixedUserId = crypto.randomUUID();
    const mixedParticipantToken = "out-of-band-participant-token-that-is-long-enough";
    const mixedControlToken = "out-of-band-host-token-that-is-long-enough";
    const repository = new MemoryRepository({ initialWorkspaceId: mixedWorkspaceId });
    const presentationSessions = createPresentationSessionRepository(repository);
    const now = new Date();
    const liveExpiresAt = new Date(now.getTime() + 60 * 60_000);
    await presentationSessions.createSession({
      id: mixedSessionId,
      workspaceId: mixedWorkspaceId,
      presentationId: crypto.randomUUID(),
      presentationVersionId: crypto.randomUUID(),
      title: "Out-of-band host mutations",
      content: mixedTransportContent(),
      code: "7654323",
      status: "active",
      phase: "lobby",
      currentBlockIndex: -1,
      revision: 0,
      createdBy: mixedUserId,
      createdAt: now,
      updatedAt: now,
      finishedAt: null,
      liveExpiresAt,
      retentionExpiresAt: new Date(now.getTime() + 24 * 60 * 60_000),
    });
    await presentationSessions.addParticipant({
      id: mixedParticipantId,
      workspaceId: mixedWorkspaceId,
      sessionId: mixedSessionId,
      nickname: "Connected learner",
      tokenHash: presentationParticipantTokenHash(mixedParticipantToken),
      joinedAt: now,
      lastSeenAt: now,
    });
    await presentationSessions.createCredential({
      id: crypto.randomUUID(),
      workspaceId: mixedWorkspaceId,
      sessionId: mixedSessionId,
      role: "host",
      tokenHash: presentationParticipantTokenHash(mixedControlToken),
      createdAt: now,
      expiresAt: liveExpiresAt,
      revokedAt: null,
    });

    const httpServer = createServer();
    let realtime: Awaited<ReturnType<typeof attachRealtime>> | null = null;
    let client: Socket | null = null;
    try {
      await new Promise<void>((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
      const address = httpServer.address();
      if (!address || typeof address === "string") throw new Error("Test server did not bind");
      const mixedOrigin = `http://127.0.0.1:${address.port}`;
      const mixedConfig = ConfigSchema.parse({
        NODE_ENV: "test",
        ALLOW_IN_MEMORY: "true",
        COMMUNITY_MODE: "false",
        WEB_ORIGIN: mixedOrigin,
        PUBLIC_API_URL: mixedOrigin,
        LOG_LEVEL: "silent",
      });
      const service = new PresentationSessionService({
        repository,
        presentations: createPresentationRepository(repository),
        sessions: presentationSessions,
        config: mixedConfig,
        storage: new StorageService(mixedConfig, null),
      });
      const notified = vi.fn();
      const setUpdatedHandler = service.setSessionUpdatedHandler.bind(service);
      const handlerSetter = vi
        .spyOn(service, "setSessionUpdatedHandler")
        .mockImplementation((handler) =>
          setUpdatedHandler(
            handler
              ? (id) => {
                  notified(id);
                  handler(id);
                }
              : null,
          ),
        );
      const roundSessions = {
        subscribe: vi.fn(() => vi.fn()),
        subscribeAuxiliary: vi.fn(() => vi.fn()),
        disconnect: vi.fn().mockResolvedValue(undefined),
      } as unknown as SessionService;
      realtime = await attachRealtime(
        httpServer,
        roundSessions,
        mixedConfig,
        new MetricsService(),
        undefined,
        { service },
      );
      expect(handlerSetter).toHaveBeenCalledExactlyOnceWith(expect.any(Function));
      client = createClient(mixedOrigin, {
        transports: ["websocket"],
        reconnection: false,
        extraHeaders: { origin: mixedOrigin },
      });
      await new Promise<void>((resolve, reject) => {
        client!.once("connect", resolve);
        client!.once("connect_error", reject);
      });
      await emitAck(client, "presentation.sync.request", {
        sessionId: mixedSessionId,
        projection: "participant",
        participantToken: mixedParticipantToken,
      });
      const waitForRevision = (revision: number) =>
        new Promise<PresentationParticipantSnapshot>((resolve) => {
          const listener = (
            event: PresentationEventEnvelope<{ snapshot: PresentationParticipantSnapshot }>,
            acknowledge?: () => void,
          ) => {
            acknowledge?.();
            if (event.payload.snapshot.revision !== revision) return;
            client!.off("presentation.session.updated", listener);
            resolve(event.payload.snapshot);
          };
          client!.on("presentation.session.updated", listener);
        });

      const commandUpdate = waitForRevision(1);
      await service.command({
        sessionId: mixedSessionId,
        controlToken: mixedControlToken,
        commandId: crypto.randomUUID(),
        expectedRevision: 0,
        action: "advance",
      });
      await expect(commandUpdate).resolves.toMatchObject({
        projection: "participant",
        phase: "question_open",
        revision: 1,
      });
      const advanceUpdate = waitForRevision(2);
      await service.advance({
        workspaceId: mixedWorkspaceId,
        userId: mixedUserId,
        sessionId: mixedSessionId,
        expectedRevision: 1,
        requestId: crypto.randomUUID(),
      });
      await expect(advanceUpdate).resolves.toMatchObject({
        projection: "participant",
        phase: "question_reveal",
        revision: 2,
      });
      expect(notified.mock.calls).toEqual([[mixedSessionId], [mixedSessionId]]);

      await expect(
        service.command({
          sessionId: mixedSessionId,
          controlToken: mixedControlToken,
          commandId: crypto.randomUUID(),
          expectedRevision: 0,
          action: "advance",
        }),
      ).rejects.toMatchObject({ code: "STALE_SESSION" });
      await expect(
        service.advance({
          workspaceId: mixedWorkspaceId,
          userId: mixedUserId,
          sessionId: mixedSessionId,
          expectedRevision: 0,
          requestId: crypto.randomUUID(),
        }),
      ).rejects.toMatchObject({ code: "STALE_SESSION" });
      expect(notified).toHaveBeenCalledTimes(2);

      await realtime.close();
      realtime = null;
      expect(handlerSetter).toHaveBeenLastCalledWith(null);
      await expect(
        service.command({
          sessionId: mixedSessionId,
          controlToken: mixedControlToken,
          commandId: crypto.randomUUID(),
          expectedRevision: 2,
          action: "advance",
        }),
      ).resolves.toMatchObject({ phase: "finished", revision: 3 });
      expect(notified).toHaveBeenCalledTimes(2);
    } finally {
      client?.disconnect();
      await realtime?.close();
      if (httpServer.listening) {
        await new Promise<void>((resolve, reject) =>
          httpServer.close((error) => (error ? reject(error) : resolve())),
        );
      }
    }
  });

  it("keeps an active socket participant connected in a REST host snapshot after heartbeat expiry", async () => {
    const mixedWorkspaceId = crypto.randomUUID();
    const mixedSessionId = crypto.randomUUID();
    const mixedParticipantId = crypto.randomUUID();
    const mixedParticipantToken = "mixed-participant-token-that-is-long-enough";
    const repository = new MemoryRepository({ initialWorkspaceId: mixedWorkspaceId });
    const presentationSessions = createPresentationSessionRepository(repository);
    const joinedAt = new Date();
    await presentationSessions.createSession({
      id: mixedSessionId,
      workspaceId: mixedWorkspaceId,
      presentationId: crypto.randomUUID(),
      presentationVersionId: crypto.randomUUID(),
      title: "Mixed transport presence",
      content: mixedTransportContent(),
      code: "7654321",
      status: "active",
      phase: "lobby",
      currentBlockIndex: -1,
      revision: 0,
      settings: { timeMode: "timed" },
      trustMode: "learning",
      eventSeq: 0,
      questionOpenedAt: null,
      questionClosesAt: null,
      createdBy: crypto.randomUUID(),
      createdAt: joinedAt,
      updatedAt: joinedAt,
      finishedAt: null,
      liveExpiresAt: new Date(joinedAt.getTime() + 60 * 60_000),
      retentionExpiresAt: new Date(joinedAt.getTime() + 24 * 60 * 60_000),
    });
    await presentationSessions.addParticipant({
      id: mixedParticipantId,
      workspaceId: mixedWorkspaceId,
      sessionId: mixedSessionId,
      nickname: "Socket learner",
      tokenHash: presentationParticipantTokenHash(mixedParticipantToken),
      joinedAt,
      lastSeenAt: joinedAt,
    });

    const httpServer = createServer();
    let realtime: Awaited<ReturnType<typeof attachRealtime>> | null = null;
    let client: Socket | null = null;
    try {
      await new Promise<void>((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
      const address = httpServer.address();
      if (!address || typeof address === "string") throw new Error("Test server did not bind");
      const mixedOrigin = `http://127.0.0.1:${address.port}`;
      const mixedConfig = ConfigSchema.parse({
        NODE_ENV: "test",
        ALLOW_IN_MEMORY: "true",
        COMMUNITY_MODE: "false",
        WEB_ORIGIN: mixedOrigin,
        PUBLIC_API_URL: mixedOrigin,
        FEATURE_PRESENTATIONS: "true",
        LOG_LEVEL: "silent",
      });
      const service = new PresentationSessionService({
        repository,
        presentations: createPresentationRepository(repository),
        sessions: presentationSessions,
        config: mixedConfig,
        storage: new StorageService(mixedConfig, null),
      });
      const roundSessions = {
        subscribe: vi.fn(() => vi.fn()),
        subscribeAuxiliary: vi.fn(() => vi.fn()),
        disconnect: vi.fn().mockResolvedValue(undefined),
      } as unknown as SessionService;
      realtime = await attachRealtime(
        httpServer,
        roundSessions,
        mixedConfig,
        new MetricsService(),
        undefined,
        { service },
      );
      client = createClient(mixedOrigin, {
        transports: ["websocket"],
        reconnection: false,
        extraHeaders: { origin: mixedOrigin },
      });
      await new Promise<void>((resolve, reject) => {
        client!.once("connect", resolve);
        client!.once("connect_error", reject);
      });
      const synchronized = await emitAck<{ data: PresentationSyncResponse }>(
        client,
        "presentation.sync.request",
        {
          sessionId: mixedSessionId,
          projection: "participant",
          participantToken: mixedParticipantToken,
          afterSeq: 0,
        },
      );
      expect(synchronized.data.snapshot).toMatchObject({
        projection: "participant",
        participantId: mixedParticipantId,
      });
      expect(synchronized.data.snapshot).not.toHaveProperty("roomStatus");

      const heartbeatBeforeFallback = (
        await presentationSessions.listParticipants(mixedSessionId)
      )[0]!.lastSeenAt;
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date(heartbeatBeforeFallback.getTime() + 60_000));

      const fallbackSnapshot = await service.getHostSnapshot(mixedWorkspaceId, mixedSessionId);
      expect(fallbackSnapshot.roomStatus).toMatchObject({
        joinedCount: 1,
        connectedCount: 1,
        notCurrentlyConnectedCount: 0,
      });
      expect(
        (await presentationSessions.listParticipants(mixedSessionId))[0]!.lastSeenAt.toISOString(),
      ).toBe(heartbeatBeforeFallback.toISOString());

      const serverParticipantSocket = [...realtime.io.sockets.sockets.values()].find(
        (socket) => socket.data.presentationParticipantId === mixedParticipantId,
      );
      if (!serverParticipantSocket) throw new Error("Participant socket was not bound");
      const serverDisconnected = new Promise<void>((resolve) =>
        serverParticipantSocket.once("disconnect", () => resolve()),
      );
      client.disconnect();
      await serverDisconnected;
      const afterDisconnect = await service.getHostSnapshot(mixedWorkspaceId, mixedSessionId);
      expect(afterDisconnect.roomStatus).toMatchObject({
        joinedCount: 1,
        connectedCount: 0,
        notCurrentlyConnectedCount: 1,
      });
    } finally {
      vi.useRealTimers();
      client?.disconnect();
      await realtime?.close();
      if (httpServer.listening) {
        await new Promise<void>((resolve, reject) =>
          httpServer.close((error) => (error ? reject(error) : resolve())),
        );
      }
    }
  });

  it("includes a REST-fallback participant in socket host broadcasts without leaking staff presence", async () => {
    const mixedWorkspaceId = crypto.randomUUID();
    const mixedSessionId = crypto.randomUUID();
    const mixedParticipantId = crypto.randomUUID();
    const mixedParticipantToken = "rest-fallback-participant-token-that-is-long-enough";
    const mixedControlToken = "mixed-socket-host-token-that-is-long-enough";
    const repository = new MemoryRepository({ initialWorkspaceId: mixedWorkspaceId });
    const presentationSessions = createPresentationSessionRepository(repository);
    const createdAt = new Date();
    const staleHeartbeatAt = new Date(createdAt.getTime() - 60_000);
    const liveExpiresAt = new Date(createdAt.getTime() + 60 * 60_000);
    await presentationSessions.createSession({
      id: mixedSessionId,
      workspaceId: mixedWorkspaceId,
      presentationId: crypto.randomUUID(),
      presentationVersionId: crypto.randomUUID(),
      title: "Mixed transport presence",
      content: mixedTransportContent(),
      code: "7654322",
      status: "active",
      phase: "lobby",
      currentBlockIndex: -1,
      revision: 0,
      settings: { timeMode: "timed" },
      trustMode: "learning",
      eventSeq: 0,
      questionOpenedAt: null,
      questionClosesAt: null,
      createdBy: crypto.randomUUID(),
      createdAt,
      updatedAt: createdAt,
      finishedAt: null,
      liveExpiresAt,
      retentionExpiresAt: new Date(createdAt.getTime() + 24 * 60 * 60_000),
    });
    await presentationSessions.addParticipant({
      id: mixedParticipantId,
      workspaceId: mixedWorkspaceId,
      sessionId: mixedSessionId,
      nickname: "REST fallback learner",
      tokenHash: presentationParticipantTokenHash(mixedParticipantToken),
      joinedAt: staleHeartbeatAt,
      lastSeenAt: staleHeartbeatAt,
    });
    await presentationSessions.createCredential({
      id: crypto.randomUUID(),
      workspaceId: mixedWorkspaceId,
      sessionId: mixedSessionId,
      role: "host",
      tokenHash: presentationParticipantTokenHash(mixedControlToken),
      createdAt,
      expiresAt: liveExpiresAt,
      revokedAt: null,
    });

    const httpServer = createServer();
    let realtime: Awaited<ReturnType<typeof attachRealtime>> | null = null;
    let host: Socket | null = null;
    try {
      await new Promise<void>((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
      const address = httpServer.address();
      if (!address || typeof address === "string") throw new Error("Test server did not bind");
      const mixedOrigin = `http://127.0.0.1:${address.port}`;
      const mixedConfig = ConfigSchema.parse({
        NODE_ENV: "test",
        ALLOW_IN_MEMORY: "true",
        COMMUNITY_MODE: "false",
        WEB_ORIGIN: mixedOrigin,
        PUBLIC_API_URL: mixedOrigin,
        FEATURE_PRESENTATIONS: "true",
        LOG_LEVEL: "silent",
      });
      const service = new PresentationSessionService({
        repository,
        presentations: createPresentationRepository(repository),
        sessions: presentationSessions,
        config: mixedConfig,
        storage: new StorageService(mixedConfig, null),
      });
      const roundSessions = {
        subscribe: vi.fn(() => vi.fn()),
        subscribeAuxiliary: vi.fn(() => vi.fn()),
        disconnect: vi.fn().mockResolvedValue(undefined),
      } as unknown as SessionService;
      realtime = await attachRealtime(
        httpServer,
        roundSessions,
        mixedConfig,
        new MetricsService(),
        undefined,
        { service },
      );
      host = createClient(mixedOrigin, {
        transports: ["websocket"],
        reconnection: false,
        extraHeaders: { origin: mixedOrigin },
      });
      await new Promise<void>((resolve, reject) => {
        host!.once("connect", resolve);
        host!.once("connect_error", reject);
      });

      const initiallyDisconnected = waitForRoomStatus(host, 0);
      const initialSync = await emitAck<{ data: PresentationSyncResponse }>(
        host,
        "presentation.sync.request",
        {
          sessionId: mixedSessionId,
          projection: "host",
          controlToken: mixedControlToken,
          afterSeq: 0,
        },
      );
      expect(initialSync.data.snapshot).toMatchObject({
        projection: "host",
        roomStatus: { joinedCount: 1, connectedCount: 0, notCurrentlyConnectedCount: 1 },
      });
      await expect(initiallyDisconnected).resolves.toMatchObject({ connectedCount: 0 });

      const restParticipant = await service.getParticipantSnapshot(
        mixedSessionId,
        mixedParticipantToken,
      );
      expect(restParticipant.snapshot).toMatchObject({
        projection: "participant",
        participantId: mixedParticipantId,
      });
      expect(restParticipant.snapshot).not.toHaveProperty("roomStatus");
      expect(restParticipant.snapshot).not.toHaveProperty("participants");

      const connectedBroadcast = waitForRoomStatus(host, 1);
      await emitAck(host, "presentation.sync.request", {
        sessionId: mixedSessionId,
        projection: "host",
        controlToken: mixedControlToken,
        afterSeq: 0,
      });
      await expect(connectedBroadcast).resolves.toMatchObject({
        joinedCount: 1,
        connectedCount: 1,
        notCurrentlyConnectedCount: 0,
      });

      const overlappingUnion = await service.syncManyByCredentialHash(
        [
          {
            sessionId: mixedSessionId,
            projection: "host",
            controlTokenHash: presentationParticipantTokenHash(mixedControlToken),
            afterSeq: 0,
          },
        ],
        new Set([mixedParticipantId]),
      );
      expect(overlappingUnion[0]?.snapshot).toMatchObject({
        projection: "host",
        roomStatus: { joinedCount: 1, connectedCount: 1, notCurrentlyConnectedCount: 0 },
      });
      expect(
        [...realtime.io.sockets.sockets.values()].filter(
          (socket) => socket.data.presentationProjection === "participant",
        ),
      ).toHaveLength(0);
    } finally {
      host?.disconnect();
      await realtime?.close();
      if (httpServer.listening) {
        await new Promise<void>((resolve, reject) =>
          httpServer.close((error) => (error ? reject(error) : resolve())),
        );
      }
    }
  });
});
