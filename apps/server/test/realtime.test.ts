import { createServer, type Server as HttpServer } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { io as createClient, type Socket } from "socket.io-client";
import {
  canUseRoundProtocol,
  currentRoundClientCapabilities,
  ROUND_CLIENT_UPDATE_MESSAGE,
} from "@openround/contracts";
import {
  acceptAnswer,
  addParticipant,
  applyHostCommand,
  createGameState,
  snapshotForRole,
} from "@openround/game-engine";
import { ConfigSchema } from "../src/config.js";
import { MetricsService } from "../src/metrics.js";
import {
  attachRealtime,
  isExpiredRealtimeStaffCredential,
  snapshotSelector,
} from "../src/realtime.js";
import type { InteractionService } from "../src/interaction-service.js";
import {
  SessionError,
  type SessionAudienceEvent,
  type SessionService,
} from "../src/session-service.js";
import type { SessionAuxiliaryEvent } from "../src/session-service.js";

describe("realtime authorization", () => {
  let httpServer: HttpServer | undefined;
  let realtime: Awaited<ReturnType<typeof attachRealtime>> | undefined;
  let client: Socket | undefined;

  afterEach(async () => {
    client?.disconnect();
    if (realtime) await realtime.close();
    if (httpServer?.listening) {
      await new Promise<void>((resolve, reject) => {
        httpServer!.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  it.each([
    undefined,
    { protocolVersion: 2 as const, capabilities: [] },
    currentRoundClientCapabilities(),
    { protocolVersion: 3 as const, capabilities: ["poll.multiselect" as const] },
    { protocolVersion: 3 as const, capabilities: ["response.ranking" as const] },
  ])("fences unsupported realtime projections for profile %j", async (clientCapabilities) => {
    const state = createGameState({
      sessionId: crypto.randomUUID(),
      code: "1234567",
      quiz: {
        title: "Protocol fanout",
        description: "",
        questions: [
          {
            id: crypto.randomUUID(),
            type: "numeric",
            prompt: "Two plus two?",
            correctValue: "4",
            tolerance: "0",
            unit: null,
            timeLimitSeconds: 30,
            basePoints: 100,
            explanation: "Private explanation",
            mediaId: null,
            mediaAlt: null,
          },
        ],
      },
      settings: {
        audienceLimit: 20,
        scoringMode: "accuracy",
        resultVisibility: "private",
        allowLateJoin: true,
        nicknamePolicy: "custom",
      },
      roundProtocol: {
        schemaVersion: 1,
        minimumClientVersion: 3,
        requiredCapabilities: ["poll.multiselect"],
      },
    });
    let listener: Parameters<SessionService["subscribe"]>[0] | undefined;
    const sessions = {
      subscribe: vi.fn((callback) => {
        listener = callback;
        return vi.fn();
      }),
      subscribeAuxiliary: vi.fn(() => vi.fn()),
      join: vi.fn().mockResolvedValue({
        participantId: crypto.randomUUID(),
        participantToken: "participant-token-long-enough",
        snapshot: snapshotForRole(state, { role: "participant" }),
      }),
      disconnect: vi.fn().mockResolvedValue(undefined),
      envelope: vi.fn((_state, event, payload) => ({ type: event.type, payload })),
    } as unknown as SessionService;
    httpServer = createServer();
    await new Promise<void>((resolve) => httpServer!.listen(0, "127.0.0.1", resolve));
    const address = httpServer.address();
    if (!address || typeof address === "string") throw new Error("Test server did not bind a port");
    const origin = `http://127.0.0.1:${address.port}`;
    realtime = await attachRealtime(
      httpServer,
      sessions,
      ConfigSchema.parse({
        NODE_ENV: "test",
        ALLOW_IN_MEMORY: "true",
        WEB_ORIGIN: origin,
        PUBLIC_API_URL: origin,
        LOG_LEVEL: "silent",
      }),
      new MetricsService(),
    );
    client = createClient(origin, {
      transports: ["websocket"],
      reconnection: false,
      extraHeaders: { origin },
    });
    await new Promise<void>((resolve, reject) => {
      client!.once("connect", resolve);
      client!.once("connect_error", reject);
    });
    const invalid = await client.timeout(2_000).emitWithAck("session.join", {
      code: state.code,
      clientCapabilities: { protocolVersion: 99, capabilities: [] },
    });
    expect(invalid).toHaveProperty("error");
    expect(sessions.join).not.toHaveBeenCalled();
    const joined = await client.timeout(2_000).emitWithAck("session.join", {
      code: state.code,
      clientCapabilities,
      password: " Exact Round password ",
    });
    expect(joined).toHaveProperty("data");
    expect(sessions.join).toHaveBeenCalledWith(
      expect.objectContaining({
        code: state.code,
        password: " Exact Round password ",
        ...(clientCapabilities ? { clientCapabilities } : {}),
      }),
    );
    const received = vi.fn();
    client.on("lobby.updated", received);
    const supported = canUseRoundProtocol(state.roundProtocol, clientCapabilities);
    const nextEvent = new Promise<unknown>((resolve) =>
      client!.once(supported ? "lobby.updated" : "client.update.required", resolve),
    );
    const disconnected = supported
      ? null
      : new Promise<void>((resolve) => client!.once("disconnect", () => resolve()));
    await listener!({ state, events: [{ type: "lobby.updated", seq: state.seq }] });
    if (supported) {
      expect(await nextEvent).toHaveProperty(
        "payload.snapshot.roundProtocol.minimumClientVersion",
        3,
      );
      expect(client.connected).toBe(true);
    } else {
      expect(await nextEvent).toEqual({
        error: { code: "CLIENT_UPDATE_REQUIRED", message: ROUND_CLIENT_UPDATE_MESSAGE },
      });
      await disconnected;
      expect(received).not.toHaveBeenCalled();
      expect(sessions.envelope).not.toHaveBeenCalled();
    }
  });

  it("treats adapter-normalized null staff expiry as non-expiring", () => {
    expect(isExpiredRealtimeStaffCredential(null, 1_000)).toBe(false);
    expect(isExpiredRealtimeStaffCredential(undefined, 1_000)).toBe(false);
    expect(isExpiredRealtimeStaffCredential("999", 1_000)).toBe(false);
    expect(isExpiredRealtimeStaffCredential(999, 1_000)).toBe(true);
    expect(isExpiredRealtimeStaffCredential(1_001, 1_000)).toBe(false);
  });

  it("contains best-effort presence failures after a participant disconnects", async () => {
    const sessionId = crypto.randomUUID();
    const participantToken = "participant-token-long-enough";
    const disconnect = vi
      .fn()
      .mockRejectedValue(new SessionError("CONFLICT", "Session coordination unavailable"));
    const sessions = {
      subscribe: vi.fn(() => vi.fn()),
      subscribeAuxiliary: vi.fn(() => vi.fn()),
      join: vi.fn().mockResolvedValue({
        participantId: crypto.randomUUID(),
        participantToken,
        snapshot: { sessionId },
      }),
      disconnect,
    } as unknown as SessionService;
    httpServer = createServer();
    await new Promise<void>((resolve) => httpServer!.listen(0, "127.0.0.1", resolve));
    const address = httpServer.address();
    if (!address || typeof address === "string") throw new Error("Test server did not bind a port");
    const origin = `http://127.0.0.1:${address.port}`;
    realtime = await attachRealtime(
      httpServer,
      sessions,
      ConfigSchema.parse({
        NODE_ENV: "test",
        ALLOW_IN_MEMORY: "true",
        WEB_ORIGIN: origin,
        PUBLIC_API_URL: origin,
        LOG_LEVEL: "silent",
      }),
      new MetricsService(),
    );
    client = createClient(origin, {
      transports: ["websocket"],
      reconnection: false,
      extraHeaders: { origin },
    });
    await new Promise<void>((resolve, reject) => {
      client!.once("connect", resolve);
      client!.once("connect_error", reject);
    });
    await new Promise<void>((resolve) => {
      client!.emit("session.join", { code: "1234567", nickname: "Disconnect test" }, () =>
        resolve(),
      );
    });

    client.disconnect();

    await vi.waitFor(() => expect(disconnect).toHaveBeenCalledWith(participantToken));
    expect(httpServer.listening).toBe(true);
  });

  it("builds a private participant reveal without broadcasting the answer key", () => {
    const participantId = crypto.randomUUID();
    const correctChoiceId = crypto.randomUUID();
    const wrongChoiceId = crypto.randomUUID();
    let state = createGameState({
      sessionId: crypto.randomUUID(),
      code: "1234567",
      quiz: {
        title: "Realtime reveal",
        description: "",
        questions: [
          {
            id: crypto.randomUUID(),
            type: "single_select",
            prompt: "Choose the correct response",
            choices: [
              { id: correctChoiceId, label: "Correct", isCorrect: true },
              {
                id: wrongChoiceId,
                label: "Incorrect",
                isCorrect: false,
                feedback: "Review the explanation and try the recheck.",
              },
            ],
            timeLimitSeconds: 20,
            basePoints: 1_000,
            explanation: "The first response is correct.",
            mediaId: null,
            mediaAlt: null,
          },
        ],
      },
      settings: {
        audienceLimit: 20,
        scoringMode: "accuracy",
        resultVisibility: "private",
        allowLateJoin: true,
        nicknamePolicy: "custom",
      },
    });
    state = addParticipant(state, {
      id: participantId,
      nickname: "Private learner",
      score: 0,
      correctCount: 0,
      acceptedResponseMs: 0,
      connected: true,
      kicked: false,
    }).state;
    state = applyHostCommand(state, {
      action: "start",
      commandId: crypto.randomUUID(),
      expectedVersion: state.version,
      nowMs: 1_000,
      newRoundId: () => crypto.randomUUID(),
    }).state;
    state = acceptAnswer(state, {
      answerId: crypto.randomUUID(),
      participantId,
      roundId: state.roundId!,
      response: { kind: "choice", choiceIds: [wrongChoiceId] },
      idempotencyKey: crypto.randomUUID(),
      nowMs: 2_000,
    }).state;
    for (const action of ["lock", "reveal"] as const) {
      state = applyHostCommand(state, {
        action,
        commandId: crypto.randomUUID(),
        expectedVersion: state.version,
        nowMs: 3_000,
        newRoundId: () => crypto.randomUUID(),
      }).state;
    }

    const selectSnapshot = snapshotSelector(state);
    const participantSnapshot = selectSnapshot("participant", participantId);
    expect(participantSnapshot).toMatchObject({
      answerRevealed: true,
      myParticipantId: participantId,
      myCorrect: false,
      feedback: "Review the explanation and try the recheck.",
      participants: [expect.objectContaining({ id: participantId, nickname: "Private learner" })],
    });
    expect(participantSnapshot).not.toHaveProperty("correctChoiceId");
    expect(participantSnapshot).not.toHaveProperty("correctResponse");
    expect(participantSnapshot.question).not.toHaveProperty("purpose");
    expect(participantSnapshot.question).not.toHaveProperty("linkedRecheckAvailable");

    expect(selectSnapshot("presenter")).not.toHaveProperty("correctResponse");
    expect(selectSnapshot("presenter")).not.toHaveProperty("correctChoiceId");
    expect(selectSnapshot("host")).toMatchObject({
      correctChoiceId,
      correctResponse: { kind: "choice", choiceIds: [correctChoiceId] },
    });
  });

  it.each(["private", "leaderboard"] as const)(
    "preserves only each participant's revealed summary in answer-free %s snapshots",
    (resultVisibility) => {
      const participantIds = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
      let state = createGameState({
        sessionId: crypto.randomUUID(),
        code: "7654321",
        quiz: {
          title: "Realtime projection",
          description: "",
          questions: [
            {
              id: crypto.randomUUID(),
              type: "true_false",
              prompt: "Projection remains role-safe.",
              choices: [
                { id: crypto.randomUUID(), label: "True", isCorrect: true },
                { id: crypto.randomUUID(), label: "False", isCorrect: false },
              ],
              timeLimitSeconds: 20,
              basePoints: 1_000,
              explanation: "",
              mediaId: null,
              mediaAlt: null,
            },
          ],
        },
        settings: {
          audienceLimit: 20,
          scoringMode: "accuracy",
          resultVisibility,
          allowLateJoin: true,
          nicknamePolicy: "custom",
        },
      });
      state.quiz.questions.push({ ...state.quiz.questions[0]!, id: crypto.randomUUID() });
      for (const [index, participantId] of participantIds.entries()) {
        state = addParticipant(state, {
          id: participantId,
          nickname: `Private learner ${index + 1}`,
          score: 0,
          correctCount: 0,
          acceptedResponseMs: 0,
          connected: true,
          kicked: false,
        }).state;
      }
      state = applyHostCommand(state, {
        action: "start",
        commandId: crypto.randomUUID(),
        expectedVersion: state.version,
        nowMs: 1_000,
        newRoundId: () => crypto.randomUUID(),
      }).state;

      const assertOwnProjections = () => {
        const selectSnapshot = snapshotSelector(state);
        for (const participantId of participantIds) {
          const snapshot = selectSnapshot("participant", participantId);
          expect(snapshot).toEqual(snapshotForRole(state, { role: "participant", participantId }));
          for (const participant of snapshot.participants) {
            expect(participant).not.toHaveProperty("myScoredResponseSummary");
            expect(participant).not.toHaveProperty("answeredCount");
            expect(participant).not.toHaveProperty("lastResponseStatus");
          }
          for (const participant of snapshot.competitionStandings?.entries ?? []) {
            expect(participant).not.toHaveProperty("answeredCount");
            expect(participant).not.toHaveProperty("lastResponseStatus");
          }
        }
        for (const role of ["host", "presenter", "participant"] as const) {
          expect(selectSnapshot(role)).not.toHaveProperty("myScoredResponseSummary");
        }
        expect(selectSnapshot("participant", crypto.randomUUID())).not.toHaveProperty(
          "myScoredResponseSummary",
        );
        return selectSnapshot;
      };
      assertOwnProjections();
      const question = state.quiz.questions[0]!;
      if (!("choices" in question)) throw new Error("Expected a choice checkpoint");
      for (const [index, participantId] of participantIds.slice(0, 2).entries()) {
        state = acceptAnswer(state, {
          answerId: crypto.randomUUID(),
          participantId,
          roundId: state.roundId!,
          choiceId: question.choices[index]!.id,
          idempotencyKey: crypto.randomUUID(),
          nowMs: 2_000,
        }).state;
      }
      const beforeReveal = assertOwnProjections();
      for (const participantId of participantIds) {
        expect(beforeReveal("participant", participantId).myScoredResponseSummary).toEqual({
          answeredScoredQuestions: 0,
          correctScoredQuestions: 0,
          revealedScoredQuestions: 0,
        });
      }
      for (const action of ["lock", "reveal", "next"] as const) {
        state = applyHostCommand(state, {
          action,
          commandId: crypto.randomUUID(),
          expectedVersion: state.version,
          nowMs: 3_000,
          newRoundId: () => crypto.randomUUID(),
        }).state;
      }
      expect(state.phase).toBe("question_open");
      expect(state.answers).toEqual({});
      const released = assertOwnProjections();
      const expectedSummaries = [
        {
          answeredScoredQuestions: 1,
          correctScoredQuestions: 1,
          revealedScoredQuestions: 1,
          lastResponseStatus: "correct",
        },
        {
          answeredScoredQuestions: 1,
          correctScoredQuestions: 0,
          revealedScoredQuestions: 1,
          lastResponseStatus: "incorrect",
        },
        {
          answeredScoredQuestions: 0,
          correctScoredQuestions: 0,
          revealedScoredQuestions: 1,
          lastResponseStatus: "unanswered",
        },
      ];
      for (const [index, participantId] of participantIds.entries()) {
        expect(released("participant", participantId).myScoredResponseSummary).toEqual(
          expectedSummaries[index],
        );
      }
      state = applyHostCommand(state, {
        action: "end",
        commandId: crypto.randomUUID(),
        expectedVersion: state.version,
        nowMs: 4_000,
        newRoundId: () => crypto.randomUUID(),
      }).state;
      state = JSON.parse(JSON.stringify(state)) as typeof state;
      expect(state.phase).toBe("finished");
      expect(state.answers).toEqual({});
      const final = assertOwnProjections();
      for (const [index, participantId] of participantIds.entries()) {
        expect(final("participant", participantId).myScoredResponseSummary).toEqual(
          expectedSummaries[index],
        );
      }
    },
  );

  it("does not promote or subscribe a socket when host authentication fails", async () => {
    const sessionId = crypto.randomUUID();
    const sessions = {
      subscribe: vi.fn(() => vi.fn()),
      subscribeAuxiliary: vi.fn(() => vi.fn()),
      hostCommand: vi
        .fn()
        .mockRejectedValue(new SessionError("UNAUTHORIZED", "Host token is invalid")),
    } as unknown as SessionService;
    httpServer = createServer();
    await new Promise<void>((resolve) => httpServer!.listen(0, "127.0.0.1", resolve));
    const address = httpServer.address();
    if (!address || typeof address === "string") throw new Error("Test server did not bind a port");
    const origin = `http://127.0.0.1:${address.port}`;
    realtime = await attachRealtime(
      httpServer,
      sessions,
      ConfigSchema.parse({
        NODE_ENV: "test",
        ALLOW_IN_MEMORY: "true",
        WEB_ORIGIN: origin,
        PUBLIC_API_URL: origin,
        LOG_LEVEL: "silent",
      }),
      new MetricsService(),
    );
    client = createClient(origin, {
      transports: ["websocket"],
      extraHeaders: { origin },
    });
    await new Promise<void>((resolve, reject) => {
      client!.once("connect", resolve);
      client!.once("connect_error", reject);
    });

    const acknowledgement = await new Promise<unknown>((resolve) => {
      client!.emit(
        "host.command",
        {
          sessionId,
          hostToken: "invalid-host-token-long-enough",
          commandId: crypto.randomUUID(),
          expectedVersion: 0,
          action: "start",
        },
        resolve,
      );
    });

    expect(acknowledgement).toMatchObject({ error: { code: "UNAUTHORIZED" } });
    const sockets = await realtime.io.fetchSockets();
    expect(sockets).toHaveLength(1);
    expect(sockets[0]?.data.role).toBeUndefined();
    expect(sockets[0]?.rooms.has(`session:${sessionId}`)).toBe(false);
  });

  it("disconnects a connected staff socket as soon as its credential is revoked", async () => {
    const sessionId = crypto.randomUUID();
    const credentialId = crypto.randomUUID();
    let auxiliaryListener: ((event: SessionAuxiliaryEvent) => Promise<void> | void) | undefined;
    const snapshot = {
      mode: "live" as const,
      stateSchemaVersion: 3,
      sessionId,
      code: "1234567",
      version: 0,
      seq: 0,
      phase: "lobby" as const,
      roundId: null,
      roundKind: "main" as const,
      sourceRoundId: null,
      questionIndex: null,
      questionPosition: null,
      questionCount: 1,
      question: null,
      deadline: null,
      participants: [],
      answerCount: 0,
      lobbyLocked: false,
      settings: {
        audienceLimit: 20,
        scoringMode: "accuracy" as const,
        resultVisibility: "private" as const,
        allowLateJoin: true,
        nicknamePolicy: "custom" as const,
      },
      brandTheme: null,
      pausedRemainingMs: null,
      intervention: null,
    };
    const sessions = {
      subscribe: vi.fn(() => vi.fn()),
      subscribeAuxiliary: vi.fn(
        (listener: (event: SessionAuxiliaryEvent) => Promise<void> | void) => {
          auxiliaryListener = listener;
          return vi.fn();
        },
      ),
      sync: vi.fn().mockResolvedValue({ snapshot, replay: [], replayComplete: true }),
      realtimeStaffIdentity: vi.fn().mockResolvedValue({
        credentialId,
        expiresAtMs: Date.now() + 60_000,
        tokenHash: "staff-token-hash",
      }),
    } as unknown as SessionService;
    httpServer = createServer();
    await new Promise<void>((resolve) => httpServer!.listen(0, "127.0.0.1", resolve));
    const address = httpServer.address();
    if (!address || typeof address === "string") throw new Error("Test server did not bind a port");
    const origin = `http://127.0.0.1:${address.port}`;
    realtime = await attachRealtime(
      httpServer,
      sessions,
      ConfigSchema.parse({
        NODE_ENV: "test",
        ALLOW_IN_MEMORY: "true",
        WEB_ORIGIN: origin,
        PUBLIC_API_URL: origin,
        LOG_LEVEL: "silent",
      }),
      new MetricsService(),
    );
    client = createClient(origin, {
      transports: ["websocket"],
      reconnection: false,
      extraHeaders: { origin },
    });
    await new Promise<void>((resolve, reject) => {
      client!.once("connect", resolve);
      client!.once("connect_error", reject);
    });
    const synchronized = await new Promise<unknown>((resolve) => {
      client!.emit(
        "sync.request",
        {
          sessionId,
          role: "presenter",
          hostToken: "presenter-token-long-enough",
          lastSeq: 0,
        },
        resolve,
      );
    });
    expect(synchronized).toMatchObject({ data: { snapshot: { sessionId } } });
    const disconnected = new Promise<void>((resolve) =>
      client!.once("disconnect", () => resolve()),
    );

    await auxiliaryListener?.({
      sessionId,
      type: "session.staff.revoked",
      payload: { credentialId },
    });
    await disconnected;

    expect(client.connected).toBe(false);
  });

  it("revalidates staff credentials before sending private audience events", async () => {
    const sessionId = crypto.randomUUID();
    const credentialId = crypto.randomUUID();
    let audienceListener:
      ((event: SessionAudienceEvent) => boolean | void | Promise<boolean | void>) | undefined;
    const snapshot = {
      mode: "live" as const,
      stateSchemaVersion: 4,
      sessionId,
      code: "1234567",
      version: 0,
      seq: 0,
      phase: "lobby" as const,
      roundId: null,
      roundKind: "main" as const,
      sourceRoundId: null,
      questionIndex: null,
      questionPosition: null,
      questionCount: 1,
      question: null,
      deadline: null,
      participants: [],
      answerCount: 0,
      lobbyLocked: false,
      settings: {
        audienceLimit: 20,
        scoringMode: "accuracy" as const,
        resultVisibility: "private" as const,
        allowLateJoin: true,
        nicknamePolicy: "custom" as const,
      },
      brandTheme: null,
      pausedRemainingMs: null,
      intervention: null,
    };
    const sessions = {
      subscribe: vi.fn(() => vi.fn()),
      subscribeAuxiliary: vi.fn(() => vi.fn()),
      subscribeAudience: vi.fn(
        (listener: (event: SessionAudienceEvent) => boolean | void | Promise<boolean | void>) => {
          audienceListener = listener;
          return vi.fn();
        },
      ),
      sync: vi.fn().mockResolvedValue({ snapshot, replay: [], replayComplete: true }),
      realtimeStaffIdentity: vi.fn().mockResolvedValue({
        credentialId,
        credentialRole: "cohost",
        expiresAtMs: Date.now() + 60_000,
        tokenHash: "revoked-staff-token-hash",
      }),
      revalidateRealtimeStaff: vi
        .fn()
        .mockRejectedValue(new SessionError("UNAUTHORIZED", "Credential revoked")),
    } as unknown as SessionService;
    const interactions = {
      realtimeSummaries: vi.fn().mockResolvedValue({
        publicSummary: {},
        moderatorSummary: {},
      }),
    } as unknown as InteractionService;
    httpServer = createServer();
    await new Promise<void>((resolve) => httpServer!.listen(0, "127.0.0.1", resolve));
    const address = httpServer.address();
    if (!address || typeof address === "string") throw new Error("Test server did not bind a port");
    const origin = `http://127.0.0.1:${address.port}`;
    realtime = await attachRealtime(
      httpServer,
      sessions,
      ConfigSchema.parse({
        NODE_ENV: "test",
        ALLOW_IN_MEMORY: "true",
        WEB_ORIGIN: origin,
        PUBLIC_API_URL: origin,
        LOG_LEVEL: "silent",
      }),
      new MetricsService(),
      interactions,
    );
    client = createClient(origin, {
      transports: ["websocket"],
      reconnection: false,
      extraHeaders: { origin },
    });
    await new Promise<void>((resolve, reject) => {
      client!.once("connect", resolve);
      client!.once("connect_error", reject);
    });
    await new Promise<void>((resolve) => {
      client!.emit(
        "sync.request",
        {
          sessionId,
          role: "host",
          hostToken: "cohost-token-long-enough",
          lastSeq: 0,
        },
        () => resolve(),
      );
    });
    const disconnected = new Promise<void>((resolve) =>
      client!.once("disconnect", () => resolve()),
    );

    await audienceListener?.({
      eventId: crypto.randomUUID(),
      sessionId,
      audienceSeq: 1,
      type: "audience.signal.updated",
      payload: {
        participantId: crypto.randomUUID(),
        contextKey: "lobby",
        signal: "unsure",
      },
      createdAt: new Date(),
    });
    await disconnected;

    expect(sessions.revalidateRealtimeStaff).toHaveBeenCalledWith(
      sessionId,
      "revoked-staff-token-hash",
      "host",
    );
    expect(client.connected).toBe(false);
  });

  it("disconnects a kicked participant before delivering audience chat", async () => {
    const sessionId = crypto.randomUUID();
    const participantId = crypto.randomUUID();
    let audienceListener:
      ((event: SessionAudienceEvent) => boolean | void | Promise<boolean | void>) | undefined;
    const snapshot = {
      mode: "live" as const,
      stateSchemaVersion: 4,
      sessionId,
      code: "1234567",
      version: 0,
      seq: 0,
      phase: "lobby" as const,
      roundId: null,
      roundKind: "main" as const,
      sourceRoundId: null,
      questionIndex: null,
      questionPosition: null,
      questionCount: 1,
      question: null,
      deadline: null,
      participants: [
        {
          id: participantId,
          nickname: "Removed participant",
          score: 0,
          connected: true,
          answered: false,
        },
      ],
      myParticipantId: participantId,
      answerCount: 0,
      lobbyLocked: false,
      settings: {
        audienceLimit: 20,
        scoringMode: "accuracy" as const,
        resultVisibility: "private" as const,
        allowLateJoin: true,
        nicknamePolicy: "custom" as const,
      },
      brandTheme: null,
      pausedRemainingMs: null,
      intervention: null,
    };
    const sessions = {
      subscribe: vi.fn(() => vi.fn()),
      subscribeAuxiliary: vi.fn(() => vi.fn()),
      subscribeAudience: vi.fn(
        (listener: (event: SessionAudienceEvent) => boolean | void | Promise<boolean | void>) => {
          audienceListener = listener;
          return vi.fn();
        },
      ),
      sync: vi.fn().mockResolvedValue({ snapshot, replay: [], replayComplete: true }),
      revalidateRealtimeParticipant: vi
        .fn()
        .mockRejectedValue(new SessionError("UNAUTHORIZED", "Participant was kicked")),
      disconnect: vi.fn().mockResolvedValue(undefined),
    } as unknown as SessionService;
    const projectRealtimeChat = vi.fn().mockReturnValue({
      message: { id: crypto.randomUUID(), body: "Private room message" },
    });
    const interactions = {
      prepareRealtimeChat: vi.fn().mockResolvedValue({ message: {} }),
      projectRealtimeChat,
      realtimeSummaries: vi.fn().mockResolvedValue({
        publicSummary: {},
        moderatorSummary: {},
      }),
    } as unknown as InteractionService;
    httpServer = createServer();
    await new Promise<void>((resolve) => httpServer!.listen(0, "127.0.0.1", resolve));
    const address = httpServer.address();
    if (!address || typeof address === "string") throw new Error("Test server did not bind a port");
    const origin = `http://127.0.0.1:${address.port}`;
    realtime = await attachRealtime(
      httpServer,
      sessions,
      ConfigSchema.parse({
        NODE_ENV: "test",
        ALLOW_IN_MEMORY: "true",
        WEB_ORIGIN: origin,
        PUBLIC_API_URL: origin,
        LOG_LEVEL: "silent",
      }),
      new MetricsService(),
      interactions,
    );
    client = createClient(origin, {
      transports: ["websocket"],
      reconnection: false,
      extraHeaders: { origin },
    });
    await new Promise<void>((resolve, reject) => {
      client!.once("connect", resolve);
      client!.once("connect_error", reject);
    });
    await new Promise<void>((resolve) => {
      client!.emit(
        "sync.request",
        {
          sessionId,
          role: "participant",
          participantToken: "participant-token-long-enough",
          lastSeq: 0,
        },
        () => resolve(),
      );
    });
    const received = vi.fn();
    client.on("chat.message.created", received);
    const disconnected = new Promise<void>((resolve) =>
      client!.once("disconnect", () => resolve()),
    );

    await audienceListener?.({
      eventId: crypto.randomUUID(),
      sessionId,
      audienceSeq: 1,
      type: "chat.message.created",
      payload: { messageId: crypto.randomUUID() },
      createdAt: new Date(),
    });
    await disconnected;

    expect(sessions.revalidateRealtimeParticipant).toHaveBeenCalledWith(
      sessionId,
      "participant-token-long-enough",
      participantId,
    );
    expect(projectRealtimeChat).not.toHaveBeenCalled();
    expect(received).not.toHaveBeenCalled();
    expect(client.connected).toBe(false);
  });

  it("keeps coalesced audience events pending until the delayed summary is emitted", async () => {
    const sessionId = crypto.randomUUID();
    let audienceListener:
      ((event: SessionAudienceEvent) => boolean | void | Promise<boolean | void>) | undefined;
    const sessions = {
      subscribe: vi.fn(() => vi.fn()),
      subscribeAuxiliary: vi.fn(() => vi.fn()),
      subscribeAudience: vi.fn(
        (listener: (event: SessionAudienceEvent) => boolean | void | Promise<boolean | void>) => {
          audienceListener = listener;
          return vi.fn();
        },
      ),
    } as unknown as SessionService;
    const completeOutboxEvents = vi.fn().mockResolvedValue(undefined);
    const interactions = {
      realtimeSummaries: vi.fn().mockResolvedValue({
        publicSummary: {},
        moderatorSummary: {},
      }),
      completeOutboxEvents,
    } as unknown as InteractionService;
    httpServer = createServer();
    realtime = await attachRealtime(
      httpServer,
      sessions,
      ConfigSchema.parse({
        NODE_ENV: "test",
        ALLOW_IN_MEMORY: "true",
        WEB_ORIGIN: "http://localhost:3000",
        PUBLIC_API_URL: "http://localhost:4000",
        LOG_LEVEL: "silent",
      }),
      new MetricsService(),
      interactions,
    );
    const event = (audienceSeq: number): SessionAudienceEvent => ({
      eventId: crypto.randomUUID(),
      sessionId,
      audienceSeq,
      type: "audience.summary.updated",
      payload: {},
      createdAt: new Date(),
    });

    expect(await audienceListener?.(event(1))).toBe(true);
    const deferred = event(2);
    expect(await audienceListener?.(deferred)).toBe(false);
    expect(completeOutboxEvents).not.toHaveBeenCalled();
    await vi.waitFor(() => {
      expect(completeOutboxEvents).toHaveBeenCalledWith(new Set([deferred.eventId]));
    });
  });
});
