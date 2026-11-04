import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type {
  PresentationCommand,
  PresentationCompanionCommand,
  PresentationCompanionSnapshot,
  PresentationEventEnvelope,
  PresentationHostSnapshot,
  PresentationParticipantSnapshot,
  PresentationResponseAck,
  PresentationRoleSnapshot,
  PresentationSyncResponse,
} from "@openround/contracts";
import type { Socket } from "socket.io-client";
import {
  createPresentationRealtimeController,
  presentationRemainingSeconds,
  presentationSaveStateForBlock,
  shouldApplyPresentationSnapshot,
} from "./presentation-realtime";
import { createPresentationCommandRecovery } from "./presentation-command-recovery";
import { ApiClientError } from "./api";

const NOW = "2026-09-23T12:00:00.000Z";

function participantSnapshot(
  overrides: Partial<PresentationParticipantSnapshot> = {},
): PresentationParticipantSnapshot {
  return {
    sessionId: "8dce12bc-efb8-4b9c-9a60-2cf8e846fc33",
    artifactType: "presentation",
    presentationId: "1a36d53a-8c07-4a7f-a204-93ae21d64f34",
    presentationVersionId: "c91e1d24-e1f1-42c2-9319-fea02e55c043",
    projection: "participant",
    participantId: "34a98a18-2d53-4d20-9b35-28f17b09106a",
    title: "Recovery check",
    code: "1234567",
    status: "active",
    phase: "question_open",
    currentBlockIndex: 0,
    blockCount: 1,
    revision: 3,
    seq: 5,
    serverTime: NOW,
    questionOpenedAt: NOW,
    questionClosesAt: "2026-09-23T12:00:30.000Z",
    acceptingResponses: true,
    settings: { timeMode: "timed", trustMode: "learning" },
    currentBlock: {
      id: "1c6d42d6-5ffc-4782-a29d-8f1517a13852",
      kind: "question",
      question: {
        id: "4db807cf-e8d5-471b-9b2d-72eb9cf01f5a",
        type: "single_select",
        prompt: "Which choice is supported?",
        confidence: "off",
        choices: [
          { id: "6846c45c-7c3c-4348-86a5-c6e4e5bff962", label: "A" },
          { id: "33dc550e-53c2-402a-9125-001da929f371", label: "B" },
        ],
        timeLimitSeconds: 30,
        basePoints: 1_000,
        mediaId: null,
        mediaAlt: null,
      },
    },
    participantCount: 2,
    responseSubmitted: false,
    standing: null,
    responseResult: null,
    finishedAt: null,
    ...overrides,
  };
}

function hostSnapshot(overrides: Partial<PresentationHostSnapshot> = {}): PresentationHostSnapshot {
  const base = participantSnapshot();
  return {
    sessionId: base.sessionId,
    artifactType: "presentation",
    presentationId: base.presentationId,
    presentationVersionId: base.presentationVersionId,
    projection: "host",
    title: base.title,
    code: base.code,
    status: base.status,
    phase: base.phase,
    currentBlockIndex: base.currentBlockIndex,
    blockCount: base.blockCount,
    revision: base.revision,
    seq: base.seq,
    serverTime: base.serverTime,
    questionOpenedAt: base.questionOpenedAt,
    questionClosesAt: base.questionClosesAt,
    acceptingResponses: base.acceptingResponses,
    settings: base.settings,
    currentBlock: null,
    participantCount: 2,
    responseCount: 0,
    participants: [],
    roomStatus: {
      sessionId: base.sessionId,
      joinedCount: 2,
      connectedCount: 0,
      notCurrentlyConnectedCount: 2,
      responseCount: 0,
      sampledAt: NOW,
    },
    finishedAt: null,
    ...overrides,
  };
}

function companionSnapshot(
  overrides: Partial<PresentationCompanionSnapshot> = {},
): PresentationCompanionSnapshot {
  const base = participantSnapshot();
  return {
    sessionId: base.sessionId,
    artifactType: base.artifactType,
    presentationId: base.presentationId,
    presentationVersionId: base.presentationVersionId,
    projection: "companion",
    title: base.title,
    code: base.code,
    status: base.status,
    phase: base.phase,
    currentBlockIndex: base.currentBlockIndex,
    blockCount: base.blockCount,
    revision: base.revision,
    seq: base.seq,
    serverTime: base.serverTime,
    questionOpenedAt: base.questionOpenedAt,
    questionClosesAt: base.questionClosesAt,
    acceptingResponses: base.acceptingResponses,
    settings: base.settings,
    currentBlock: base.currentBlock,
    roomStatus: hostSnapshot().roomStatus,
    primaryAction: "advance",
    finishedAt: null,
    ...overrides,
  };
}

class FakeSocket {
  connected = false;
  private listeners = new Map<string, Array<(...args: never[]) => void>>();
  readonly emitted: Array<{ event: string; payload: unknown; ack?: (value: unknown) => void }> = [];

  on(event: string, listener: (...args: never[]) => void) {
    const listeners = this.listeners.get(event) ?? [];
    listeners.push(listener);
    this.listeners.set(event, listeners);
    return this;
  }

  emit(event: string, payload: unknown, ack?: (value: unknown) => void) {
    this.emitted.push({ event, payload, ack });
    return this;
  }

  connect() {
    this.connected = true;
    this.fire("connect");
    return this;
  }

  disconnect() {
    this.connected = false;
    this.fire("disconnect");
    return this;
  }

  removeAllListeners() {
    this.listeners.clear();
    return this;
  }

  fire(event: string, ...args: unknown[]) {
    for (const listener of this.listeners.get(event) ?? []) {
      listener(...(args as never[]));
    }
  }

  last(event: string) {
    return this.emitted.filter((entry) => entry.event === event).at(-1);
  }
}

function sync(socket: FakeSocket, snapshot: PresentationRoleSnapshot) {
  const pending = socket.last("presentation.sync.request");
  expect(pending).toBeDefined();
  pending!.ack?.({
    data: { resetRequired: false, events: [], snapshot } satisfies PresentationSyncResponse,
  });
}

describe("Presentation companion realtime controls", () => {
  it("syncs with the scoped companion credential and fences snapshots and room status", async () => {
    const socket = new FakeSocket();
    const initial = companionSnapshot();
    const controller = createPresentationRealtimeController({
      sessionId: initial.sessionId,
      credential: { projection: "companion", companionToken: "c".repeat(32) },
      fetchSnapshot: async () => initial,
      onSnapshot: () => undefined,
      onConnectionState: () => undefined,
      socketFactory: () => socket as unknown as Socket,
    });
    controller.start();
    expect(socket.last("presentation.sync.request")?.payload).toMatchObject({
      projection: "companion",
      companionToken: "c".repeat(32),
      afterSeq: 0,
    });
    sync(socket, initial);
    await Promise.resolve();
    expect(controller.canMutate()).toBe(true);
    expect(controller.applySnapshot(companionSnapshot({ seq: 4 }))).toBe(false);
    expect(
      controller.applySnapshot(
        hostSnapshot({ seq: 99 }) as unknown as PresentationCompanionSnapshot,
      ),
    ).toBe(false);
    const newerStatus = {
      ...initial.roomStatus,
      connectedCount: 1,
      notCurrentlyConnectedCount: 1,
      sampledAt: "2026-09-23T12:00:05.000Z",
    };
    socket.fire("presentation.room-status.updated", { payload: newerStatus });
    controller.applySnapshot(
      companionSnapshot({ seq: 6, revision: 4, roomStatus: initial.roomStatus }),
    );
    expect(controller.latest()?.roomStatus).toEqual(newerStatus);
    controller.stop();
  });

  it.each(["advance", "insert_recovery_pack", "start_recovery_card"] as const)(
    "retries exactly the original %s after lost acknowledgement and newer state",
    async (action) => {
      vi.useFakeTimers();
      const socket = new FakeSocket();
      const initial = companionSnapshot(
        action === "insert_recovery_pack"
          ? {
              phase: "lobby",
              currentBlock: null,
              currentBlockIndex: -1,
              acceptingResponses: false,
              canInsertRecoveryPack: true,
            }
          : action === "start_recovery_card"
            ? { phase: "question_reveal", acceptingResponses: false }
            : {},
      );
      const controller = createPresentationRealtimeController({
        sessionId: initial.sessionId,
        credential: { projection: "companion", companionToken: "c".repeat(32) },
        fetchSnapshot: async () => initial,
        onSnapshot: () => undefined,
        onConnectionState: () => undefined,
        socketFactory: () => socket as unknown as Socket,
        acknowledgementTimeoutMs: 20,
      });
      const recovery = createPresentationCommandRecovery<
        PresentationCompanionSnapshot,
        PresentationCompanionCommand
      >({
        execute: (command) => controller.command(command, async () => initial),
        onState: () => undefined,
      });
      try {
        controller.start();
        sync(socket, initial);
        await Promise.resolve();
        const credentials = {
          sessionId: initial.sessionId,
          companionToken: "c".repeat(32),
          commandId: randomUUID(),
          expectedRevision: initial.revision,
        };
        const original: PresentationCompanionCommand =
          action === "insert_recovery_pack"
            ? { ...credentials, action, packVersionId: randomUUID() }
            : action === "start_recovery_card"
              ? {
                  ...credentials,
                  action,
                  recoveryPackCard: { insertionId: randomUUID(), cardId: randomUUID() },
                  interventionType: "explain",
                }
              : { ...credentials, action };
        const attempt = recovery.run(original);
        const rejection = expect(attempt).rejects.toMatchObject({
          code: "PRESENTATION_COMMAND_UNCONFIRMED",
        });
        const emitted = socket.last("presentation.command")!;
        const revealed = companionSnapshot({
          phase:
            action === "insert_recovery_pack"
              ? "question_open"
              : action === "start_recovery_card"
                ? "intervention"
                : "question_reveal",
          acceptingResponses: action === "insert_recovery_pack",
          canInsertRecoveryPack: false,
          seq: 6,
          revision: 4,
        });
        socket.fire("presentation.session.updated", { payload: revealed });
        await recovery.run({ ...original, commandId: randomUUID() });
        expect(socket.emitted.filter(({ event }) => event === "presentation.command")).toHaveLength(
          1,
        );
        await vi.advanceTimersByTimeAsync(20);
        await rejection;
        await expect(recovery.retry()).rejects.toMatchObject({
          code: "PRESENTATION_RECONNECT_REQUIRED",
        });
        expect(recovery.state().pendingCommand).toEqual(original);
        sync(socket, revealed);
        await Promise.resolve();
        const retry = recovery.retry();
        expect(socket.last("presentation.command")?.payload).toBe(emitted.payload);
        socket.last("presentation.command")!.ack?.({ data: { snapshot: revealed } });
        await expect(retry).resolves.toEqual(revealed);
        expect(controller.latest()?.phase).toBe(revealed.phase);
        expect(recovery.state().pendingCommand).toBeNull();
      } finally {
        controller.stop();
        vi.useRealTimers();
      }
    },
  );

  it("rejects a host acknowledgement for a companion command and accepts a companion REST fallback", async () => {
    const initial = companionSnapshot();
    const controller = createPresentationRealtimeController({
      sessionId: initial.sessionId,
      credential: null,
      fetchSnapshot: async () => initial,
      onSnapshot: () => undefined,
      onConnectionState: () => undefined,
    });
    const command: PresentationCompanionCommand = {
      sessionId: initial.sessionId,
      companionToken: "c".repeat(32),
      commandId: randomUUID(),
      expectedRevision: 3,
      action: "advance",
    };
    await expect(
      controller.command(
        command,
        async () => hostSnapshot() as unknown as PresentationCompanionSnapshot,
      ),
    ).rejects.toMatchObject({ code: "PRESENTATION_COMMAND_UNCONFIRMED" });
    expect(controller.latest()).toBeNull();
    await expect(controller.command(command, async () => initial)).resolves.toEqual(initial);
  });

  it("stops companion mutation and polling after socket credential rejection", async () => {
    const initial = companionSnapshot();
    const socket = new FakeSocket();
    const rejected = vi.fn();
    const fetchSnapshot = vi.fn(async () => initial);
    const controller = createPresentationRealtimeController({
      sessionId: initial.sessionId,
      credential: { projection: "companion", companionToken: "revoked-pass" },
      fetchSnapshot,
      onSnapshot: () => undefined,
      onConnectionState: () => undefined,
      onCredentialRejected: rejected,
      socketFactory: () => socket as unknown as Socket,
    });
    controller.start();
    socket
      .last("presentation.sync.request")!
      .ack?.({ error: { code: "UNAUTHORIZED", message: "Pass revoked" } });
    await controller.reconcile();
    expect(rejected).toHaveBeenCalledExactlyOnceWith("revoked-pass");
    expect(controller.canMutate()).toBe(false);
    expect(controller.needsFallbackPolling()).toBe(false);
    expect(controller.applySnapshot(companionSnapshot({ seq: 99 }))).toBe(false);
    const rest = vi.fn(async () => initial);
    await expect(
      controller.command(
        {
          sessionId: initial.sessionId,
          companionToken: "revoked-pass",
          commandId: randomUUID(),
          expectedRevision: 3,
          action: "advance",
        },
        rest,
      ),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(rest).not.toHaveBeenCalled();
    await controller.reconcile();
    expect(fetchSnapshot).toHaveBeenCalledTimes(1);
    controller.stop();
  });

  it("rejects expired companion credentials on REST reconciliation after disconnect", async () => {
    const initial = companionSnapshot();
    const socket = new FakeSocket();
    const rejected = vi.fn();
    const fetchSnapshot = vi
      .fn()
      .mockResolvedValueOnce(initial)
      .mockRejectedValue(new ApiClientError("Expired", "UNAUTHORIZED", 401));
    const controller = createPresentationRealtimeController<PresentationCompanionSnapshot>({
      sessionId: initial.sessionId,
      credential: { projection: "companion", companionToken: "expired-pass" },
      fetchSnapshot,
      onSnapshot: () => undefined,
      onConnectionState: () => undefined,
      onCredentialRejected: rejected,
      socketFactory: () => socket as unknown as Socket,
    });
    controller.start();
    sync(socket, initial);
    await Promise.resolve();
    socket.connected = false;
    socket.fire("disconnect", "io server disconnect");
    await controller.reconcile();
    expect(rejected).toHaveBeenCalledExactlyOnceWith("expired-pass");
    expect(controller.canMutate()).toBe(false);
    expect(controller.needsFallbackPolling()).toBe(false);
    controller.stop();
  });
});

describe("Presentation card command acknowledgements", () => {
  it("replays the exact card command after an intervention update and lost acknowledgement", async () => {
    vi.useFakeTimers();
    const socket = new FakeSocket();
    const initial = hostSnapshot({ phase: "question_reveal", acceptingResponses: false });
    const received: PresentationHostSnapshot[] = [];
    const controller = createPresentationRealtimeController({
      sessionId: initial.sessionId,
      credential: { projection: "host", controlToken: "h".repeat(32) },
      fetchSnapshot: async () => initial,
      onSnapshot: (snapshot) => received.push(snapshot),
      onConnectionState: () => undefined,
      socketFactory: () => socket as unknown as Socket,
      acknowledgementTimeoutMs: 20,
    });
    const recovery = createPresentationCommandRecovery({
      execute: (command: PresentationCommand) => controller.command(command, async () => initial),
      onState: () => undefined,
    });
    try {
      controller.start();
      sync(socket, initial);
      await Promise.resolve();
      const command: PresentationCommand = {
        sessionId: initial.sessionId,
        controlToken: "h".repeat(32),
        commandId: randomUUID(),
        expectedRevision: initial.revision,
        action: "start_recovery_card",
        recoveryPackCard: { insertionId: randomUUID(), cardId: randomUUID() },
        interventionType: "explain",
      };
      const first = recovery.run(command);
      const rejected = expect(first).rejects.toMatchObject({
        code: "PRESENTATION_COMMAND_UNCONFIRMED",
      });
      const originalAttempt = socket.last("presentation.command")!;
      const active = hostSnapshot({
        phase: "intervention",
        acceptingResponses: false,
        seq: 6,
        revision: 4,
      });
      socket.fire("presentation.session.updated", {
        eventId: randomUUID(),
        sessionId: initial.sessionId,
        revision: active.revision,
        seq: active.seq,
        type: "presentation.session.updated",
        serverTime: NOW,
        payload: active,
      } satisfies PresentationEventEnvelope);
      expect(recovery.state().busy).toBe(true);
      await vi.advanceTimersByTimeAsync(20);
      await rejected;
      sync(socket, active);
      await Promise.resolve();
      expect(recovery.state().pendingCommand).toEqual(command);
      // A late acknowledgement for the timed-out attempt cannot masquerade as this retry.
      originalAttempt.ack?.({ data: { snapshot: hostSnapshot({ seq: 99, revision: 99 }) } });
      expect(controller.latest()?.seq).toBe(6);
      const second = recovery.retry();
      const repeated = socket.last("presentation.command")!;
      expect(repeated.payload).toBe(originalAttempt.payload);
      repeated.ack?.({ data: { snapshot: active } });
      await expect(second).resolves.toEqual(active);
      expect(recovery.state().pendingCommand).toBeNull();
      expect(received.at(-1)?.phase).toBe("intervention");
    } finally {
      controller.stop();
      vi.useRealTimers();
    }
  });

  it("uses the supplied card REST fallback without rewriting the request", async () => {
    const initial = hostSnapshot({ phase: "question_reveal" });
    const controller = createPresentationRealtimeController({
      sessionId: initial.sessionId,
      credential: null,
      fetchSnapshot: async () => initial,
      onSnapshot: () => undefined,
      onConnectionState: () => undefined,
    });
    const command: PresentationCommand = {
      sessionId: initial.sessionId,
      controlToken: "fallback",
      commandId: randomUUID(),
      expectedRevision: initial.revision,
      action: "start_recovery_card",
      recoveryPackCard: { insertionId: randomUUID(), cardId: randomUUID() },
      interventionType: "example",
    };
    const active = hostSnapshot({ phase: "intervention", seq: 6, revision: 4 });
    const rest = vi.fn(async () => active);
    await expect(controller.command(command, rest)).resolves.toEqual(active);
    expect(rest).toHaveBeenCalledOnce();
    expect(controller.latest()?.phase).toBe("intervention");
  });

  it.each([
    ["missing snapshot", undefined],
    ["different session", hostSnapshot({ sessionId: randomUUID() })],
    ["participant projection", participantSnapshot()],
  ])(
    "keeps the original command unresolved after a REST acknowledgement with %s",
    async (_name, mismatch) => {
      const initial = hostSnapshot({ phase: "question_reveal" });
      const onSnapshot = vi.fn();
      const controller = createPresentationRealtimeController({
        sessionId: initial.sessionId,
        credential: null,
        fetchSnapshot: async () => initial,
        onSnapshot,
        onConnectionState: () => undefined,
      });
      const command: PresentationCommand = {
        sessionId: initial.sessionId,
        controlToken: "h".repeat(32),
        commandId: randomUUID(),
        expectedRevision: initial.revision,
        action: "start_recovery_card",
        recoveryPackCard: { insertionId: randomUUID(), cardId: randomUUID() },
        interventionType: "example",
      };
      const active = hostSnapshot({ phase: "intervention", seq: 6, revision: 4 });
      const rest = vi.fn().mockResolvedValueOnce(mismatch).mockResolvedValueOnce(active);
      const recovery = createPresentationCommandRecovery({
        execute: (request: PresentationCommand) => controller.command(request, rest),
        onState: () => undefined,
      });
      await expect(recovery.run(command)).rejects.toMatchObject({
        code: "PRESENTATION_COMMAND_UNCONFIRMED",
      });
      expect(onSnapshot).not.toHaveBeenCalled();
      expect(controller.latest()).toBeNull();
      expect(recovery.state().pendingCommand).toEqual(command);
      await expect(recovery.retry()).resolves.toEqual(active);
      expect(onSnapshot).toHaveBeenCalledWith(active);
      expect(recovery.state().pendingCommand).toBeNull();
    },
  );
});

describe("Presentation scoped host pass rejection", () => {
  it("reports a stale pass rejected by initial socket sync and stays in authenticated REST fallback", async () => {
    const socket = new FakeSocket();
    const rejected = vi.fn();
    const initial = hostSnapshot();
    const controller = createPresentationRealtimeController({
      sessionId: initial.sessionId,
      credential: { projection: "host", controlToken: "revoked-pass" },
      fetchSnapshot: async () => initial,
      onSnapshot: () => undefined,
      onConnectionState: () => undefined,
      onCredentialRejected: rejected,
      socketFactory: () => socket as unknown as Socket,
    });
    controller.start();
    socket
      .last("presentation.sync.request")!
      .ack?.({ error: { code: "UNAUTHORIZED", message: "Revoked host pass" } });
    await controller.reconcile();
    expect(rejected).toHaveBeenCalledExactlyOnceWith("revoked-pass");
    expect(controller.latest()).toEqual(initial);
    expect(controller.canMutate()).toBe(true);
    expect(controller.needsFallbackPolling()).toBe(true);
    socket.disconnect();
    socket.connect();
    await controller.reconcile();
    expect(
      socket.emitted.filter(({ event }) => event === "presentation.sync.request"),
    ).toHaveLength(1);
    expect(controller.canMutate()).toBe(true);
    controller.stop();
  });

  it("reports the exact pass rejected by a socket command", async () => {
    const socket = new FakeSocket();
    const rejected = vi.fn();
    const initial = hostSnapshot();
    const controller = createPresentationRealtimeController({
      sessionId: initial.sessionId,
      credential: { projection: "host", controlToken: "revoked-pass" },
      fetchSnapshot: async () => initial,
      onSnapshot: () => undefined,
      onConnectionState: () => undefined,
      onCredentialRejected: rejected,
      socketFactory: () => socket as unknown as Socket,
    });
    controller.start();
    sync(socket, initial);
    const attempt = controller.command(
      {
        sessionId: initial.sessionId,
        controlToken: "revoked-pass",
        commandId: randomUUID(),
        expectedRevision: initial.revision,
        action: "advance",
      },
      async () => initial,
    );
    socket
      .last("presentation.command")!
      .ack?.({ error: { code: "UNAUTHORIZED", message: "Revoked host pass" } });
    await expect(attempt).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(rejected).toHaveBeenCalledExactlyOnceWith("revoked-pass");
    expect(controller.needsFallbackPolling()).toBe(true);
    controller.stop();
  });

  it("reports scoped REST command401 but never treats creator-auth snapshot401 as pass rejection", async () => {
    const initial = hostSnapshot();
    const rejected = vi.fn();
    const controller = createPresentationRealtimeController({
      sessionId: initial.sessionId,
      credential: null,
      fetchSnapshot: async () => {
        throw new ApiClientError("Creator login expired", "UNAUTHORIZED", 401);
      },
      onSnapshot: () => undefined,
      onConnectionState: () => undefined,
      onCredentialRejected: rejected,
    });
    await expect(controller.reconcile()).resolves.toBeNull();
    expect(rejected).not.toHaveBeenCalled();
    await expect(
      controller.command(
        {
          sessionId: initial.sessionId,
          controlToken: "revoked-pass",
          commandId: randomUUID(),
          expectedRevision: initial.revision,
          action: "advance",
        },
        async () => {
          throw new ApiClientError("Revoked host pass", "UNAUTHORIZED", 401);
        },
      ),
    ).rejects.toMatchObject({ status: 401 });
    expect(rejected).toHaveBeenCalledExactlyOnceWith("revoked-pass");
    controller.stop();
  });
});

describe("Presentation deadline timing", () => {
  it("derives the countdown from server time instead of the participant device clock", () => {
    expect(presentationRemainingSeconds(participantSnapshot(), 1_000_000, 1_010_000)).toBe(20);
    expect(
      presentationRemainingSeconds(
        participantSnapshot({ acceptingResponses: false }),
        1_000_000,
        1_010_000,
      ),
    ).toBe(0);
    expect(
      presentationRemainingSeconds(
        participantSnapshot({ questionClosesAt: null }),
        1_000_000,
        1_010_000,
      ),
    ).toBeNull();
  });

  it("locally expires a continuously connected timed question without another sync", async () => {
    vi.useFakeTimers();
    const socket = new FakeSocket();
    const received: PresentationParticipantSnapshot[] = [];
    const controller = createPresentationRealtimeController({
      sessionId: participantSnapshot().sessionId,
      credential: { projection: "participant", participantToken: "p".repeat(32) },
      fetchSnapshot: async () => participantSnapshot(),
      onSnapshot: (snapshot) => received.push(snapshot),
      onConnectionState: () => undefined,
      socketFactory: () => socket as unknown as Socket,
    });

    try {
      controller.start();
      sync(socket, participantSnapshot());
      await Promise.resolve();
      const syncCount = socket.emitted.filter(
        ({ event }) => event === "presentation.sync.request",
      ).length;

      vi.advanceTimersByTime(30_000);
      expect(controller.latest()?.acceptingResponses).toBe(true);
      vi.advanceTimersByTime(1);

      expect(controller.latest()?.acceptingResponses).toBe(false);
      expect(received.at(-1)?.acceptingResponses).toBe(false);
      expect(
        controller.applySnapshot(participantSnapshot({ serverTime: "2026-09-23T12:00:29.500Z" })),
      ).toBe(false);
      expect(controller.latest()?.acceptingResponses).toBe(false);
      expect(
        socket.emitted.filter(({ event }) => event === "presentation.sync.request"),
      ).toHaveLength(syncCount);
    } finally {
      controller.stop();
      vi.useRealTimers();
    }
  });

  it("does not let an earlier question deadline expire a newer block", async () => {
    vi.useFakeTimers();
    const socket = new FakeSocket();
    const controller = createPresentationRealtimeController({
      sessionId: participantSnapshot().sessionId,
      credential: { projection: "participant", participantToken: "p".repeat(32) },
      fetchSnapshot: async () => participantSnapshot(),
      onSnapshot: () => undefined,
      onConnectionState: () => undefined,
      socketFactory: () => socket as unknown as Socket,
    });

    try {
      controller.start();
      sync(socket, participantSnapshot());
      await Promise.resolve();
      vi.advanceTimersByTime(10_000);
      const nextBlockId = randomUUID();
      controller.applySnapshot(
        participantSnapshot({
          seq: 6,
          serverTime: "2026-09-23T12:00:10.000Z",
          questionClosesAt: "2026-09-23T12:01:00.000Z",
          currentBlock: {
            ...participantSnapshot().currentBlock!,
            id: nextBlockId,
          },
        }),
      );

      vi.advanceTimersByTime(20_001);

      expect(controller.latest()?.currentBlock?.id).toBe(nextBlockId);
      expect(controller.latest()?.acceptingResponses).toBe(true);
    } finally {
      controller.stop();
      vi.useRealTimers();
    }
  });
});

describe("Presentation realtime snapshot fencing", () => {
  it("uses sequence before revision and ignores stale snapshots", () => {
    const current = { seq: 8, revision: 3, serverTime: "2026-09-23T12:00:30.000Z" };
    expect(
      shouldApplyPresentationSnapshot(current, {
        seq: 7,
        revision: 99,
        serverTime: "2026-09-23T12:00:31.000Z",
      }),
    ).toBe(false);
    expect(
      shouldApplyPresentationSnapshot(current, {
        seq: 8,
        revision: 2,
        serverTime: "2026-09-23T12:00:31.000Z",
      }),
    ).toBe(false);
    expect(
      shouldApplyPresentationSnapshot(current, {
        seq: 8,
        revision: 3,
        serverTime: "2026-09-23T12:00:29.000Z",
      }),
    ).toBe(false);
    expect(shouldApplyPresentationSnapshot(current, current)).toBe(false);
    expect(
      shouldApplyPresentationSnapshot(current, {
        seq: 8,
        revision: 3,
        serverTime: "2026-09-23T12:00:31.000Z",
      }),
    ).toBe(true);
    expect(
      shouldApplyPresentationSnapshot(current, {
        seq: 8,
        revision: 4,
        serverTime: "2026-09-23T12:00:29.000Z",
      }),
    ).toBe(true);
    expect(
      shouldApplyPresentationSnapshot(current, {
        seq: 9,
        revision: 3,
        serverTime: "2026-09-23T12:00:29.000Z",
      }),
    ).toBe(true);
  });

  it("refreshes deadline-derived state from a newer snapshot at the same durable fence", () => {
    const received: PresentationParticipantSnapshot[] = [];
    const controller = createPresentationRealtimeController({
      sessionId: participantSnapshot().sessionId,
      credential: null,
      fetchSnapshot: async () => participantSnapshot(),
      onSnapshot: (snapshot) => received.push(snapshot),
      onConnectionState: () => undefined,
    });

    expect(
      controller.applySnapshot(
        participantSnapshot({
          serverTime: "2026-09-23T12:00:29.000Z",
          acceptingResponses: true,
        }),
      ),
    ).toBe(true);
    expect(
      controller.applySnapshot(
        participantSnapshot({
          serverTime: "2026-09-23T12:00:31.000Z",
          acceptingResponses: false,
        }),
      ),
    ).toBe(true);
    expect(
      controller.applySnapshot(
        participantSnapshot({
          serverTime: "2026-09-23T12:00:30.000Z",
          acceptingResponses: true,
        }),
      ),
    ).toBe(false);

    expect(received.map(({ acceptingResponses }) => acceptingResponses)).toEqual([true, false]);
    expect(controller.latest()?.acceptingResponses).toBe(false);
    controller.stop();
  });

  it("does not apply a delayed realtime event after a newer sync", () => {
    const socket = new FakeSocket();
    const received: number[] = [];
    const controller = createPresentationRealtimeController({
      sessionId: participantSnapshot().sessionId,
      credential: { projection: "participant", participantToken: "p".repeat(32) },
      fetchSnapshot: async () => participantSnapshot(),
      onSnapshot: (snapshot) => received.push(snapshot.seq),
      onConnectionState: () => undefined,
      socketFactory: () => socket as unknown as Socket,
    });

    controller.start();
    sync(socket, participantSnapshot({ seq: 8, revision: 4 }));
    socket.fire("presentation.session.updated", {
      eventId: randomUUID(),
      sessionId: participantSnapshot().sessionId,
      revision: 99,
      seq: 7,
      type: "presentation.session.updated",
      serverTime: NOW,
      payload: participantSnapshot({ seq: 7, revision: 99 }),
    } satisfies PresentationEventEnvelope);

    expect(received).toEqual([8]);
    controller.stop();
  });

  it("coalesces concurrent synchronization attempts", async () => {
    const socket = new FakeSocket();
    const controller = createPresentationRealtimeController({
      sessionId: participantSnapshot().sessionId,
      credential: { projection: "participant", participantToken: "p".repeat(32) },
      fetchSnapshot: async () => participantSnapshot(),
      onSnapshot: () => undefined,
      onConnectionState: () => undefined,
      socketFactory: () => socket as unknown as Socket,
    });
    controller.start();
    sync(socket, participantSnapshot());
    await Promise.resolve();

    const before = socket.emitted.filter(
      (entry) => entry.event === "presentation.sync.request",
    ).length;
    const first = controller.reconcile();
    const second = controller.reconcile();
    expect(second).toBe(first);
    expect(
      socket.emitted.filter((entry) => entry.event === "presentation.sync.request"),
    ).toHaveLength(before + 1);
    sync(socket, participantSnapshot({ seq: 6 }));
    await expect(first).resolves.toMatchObject({ seq: 6 });
    controller.stop();
  });

  it("accepts wrapped room-status events and rejects an older sample", () => {
    const socket = new FakeSocket();
    const connectedCounts: number[] = [];
    const controller = createPresentationRealtimeController({
      sessionId: participantSnapshot().sessionId,
      credential: { projection: "participant", participantToken: "p".repeat(32) },
      fetchSnapshot: async () => participantSnapshot(),
      onSnapshot: () => undefined,
      onConnectionState: () => undefined,
      onRoomStatus: (status) => connectedCounts.push(status.connectedCount),
      socketFactory: () => socket as unknown as Socket,
    });
    controller.start();
    sync(socket, participantSnapshot());
    const status = (connectedCount: number, sampledAt = NOW) => ({
      sessionId: participantSnapshot().sessionId,
      joinedCount: 2,
      connectedCount,
      notCurrentlyConnectedCount: 2 - connectedCount,
      responseCount: 0,
      sampledAt,
    });
    const envelope = (seq: number, connectedCount: number, sampledAt = NOW) => ({
      eventId: randomUUID(),
      sessionId: participantSnapshot().sessionId,
      revision: 3,
      seq,
      type: "presentation.room-status.updated" as const,
      serverTime: NOW,
      payload: { roomStatus: status(connectedCount, sampledAt) },
    });

    socket.fire("presentation.room-status.updated", envelope(8, 2));
    socket.fire("presentation.room-status.updated", envelope(9, 1));
    socket.fire("presentation.room-status.updated", envelope(1, 1, "2026-09-23T12:00:01.000Z"));

    expect(connectedCounts).toEqual([2, 1]);
    controller.stop();
  });

  it("uses the newer room-status sample across events and host snapshots", () => {
    const socket = new FakeSocket();
    const controller = createPresentationRealtimeController({
      sessionId: hostSnapshot().sessionId,
      credential: { projection: "host", controlToken: "h".repeat(32) },
      fetchSnapshot: async () => hostSnapshot(),
      onSnapshot: () => undefined,
      onConnectionState: () => undefined,
      onRoomStatus: () => undefined,
      socketFactory: () => socket as unknown as Socket,
    });
    controller.start();
    sync(socket, hostSnapshot());

    socket.fire("presentation.room-status.updated", {
      eventId: randomUUID(),
      sessionId: hostSnapshot().sessionId,
      revision: 3,
      seq: 5,
      type: "presentation.room-status.updated",
      serverTime: "2026-09-23T12:00:01.000Z",
      payload: {
        roomStatus: {
          ...hostSnapshot().roomStatus,
          connectedCount: 2,
          notCurrentlyConnectedCount: 0,
          sampledAt: "2026-09-23T12:00:01.000Z",
        },
      },
    } satisfies PresentationEventEnvelope);

    controller.applySnapshot(
      hostSnapshot({
        seq: 5,
        serverTime: "2026-09-23T12:00:02.000Z",
        roomStatus: {
          ...hostSnapshot().roomStatus,
          sampledAt: "2026-09-23T12:00:02.000Z",
        },
      }),
    );

    expect(controller.latest()?.projection).toBe("host");
    expect((controller.latest() as PresentationHostSnapshot).roomStatus.connectedCount).toBe(0);

    controller.applySnapshot(
      hostSnapshot({
        seq: 6,
        serverTime: "2026-09-23T12:00:03.000Z",
        roomStatus: {
          ...hostSnapshot().roomStatus,
          connectedCount: 1,
          notCurrentlyConnectedCount: 1,
          sampledAt: "2026-09-23T12:00:01.500Z",
        },
      }),
    );

    expect((controller.latest() as PresentationHostSnapshot).roomStatus.connectedCount).toBe(0);
    controller.stop();
  });
});

describe("Presentation participant acknowledgement recovery", () => {
  it("settles a lost acknowledgement after a bounded closed-question reconciliation", async () => {
    vi.useFakeTimers();
    const socket = new FakeSocket();
    const saveStates: string[] = [];
    const open = participantSnapshot({
      questionClosesAt: "2026-09-23T12:00:00.005Z",
    });
    const controller = createPresentationRealtimeController({
      sessionId: open.sessionId,
      credential: { projection: "participant", participantToken: "p".repeat(32) },
      fetchSnapshot: async () => open,
      onSnapshot: () => undefined,
      onConnectionState: () => undefined,
      onSaveState: (state) => saveStates.push(state),
      socketFactory: () => socket as unknown as Socket,
      acknowledgementTimeoutMs: 10,
    });

    try {
      controller.start();
      sync(socket, open);
      await Promise.resolve();
      const submission = controller.submitResponse(
        {
          sessionId: open.sessionId,
          participantToken: "p".repeat(32),
          blockId: open.currentBlock!.id,
          expectedRevision: open.revision,
          idempotencyKey: randomUUID(),
          response: { choiceIds: ["6846c45c-7c3c-4348-86a5-c6e4e5bff962"] },
        },
        async () => {
          throw new Error("REST should not be used");
        },
      );
      const rejected = expect(submission).rejects.toThrow(
        "question closed before the response was confirmed",
      );

      vi.advanceTimersByTime(10);
      sync(
        socket,
        participantSnapshot({
          serverTime: "2026-09-23T12:00:00.010Z",
          questionClosesAt: open.questionClosesAt,
          acceptingResponses: false,
        }),
      );
      await Promise.resolve();
      vi.advanceTimersByTime(10);
      sync(
        socket,
        participantSnapshot({
          serverTime: "2026-09-23T12:00:00.020Z",
          questionClosesAt: open.questionClosesAt,
          acceptingResponses: false,
        }),
      );

      await rejected;
      expect(saveStates.at(-1)).toBe("idle");
    } finally {
      controller.stop();
      vi.useRealTimers();
    }
  });

  it("does not reconcile a pending response from a rejected stale sync snapshot", async () => {
    const socket = new FakeSocket();
    const current = participantSnapshot({
      seq: 6,
      serverTime: "2026-09-23T12:00:31.000Z",
      phase: "question_reveal",
      questionClosesAt: null,
      acceptingResponses: false,
    });
    const controller = createPresentationRealtimeController({
      sessionId: current.sessionId,
      credential: { projection: "participant", participantToken: "p".repeat(32) },
      fetchSnapshot: async () => current,
      onSnapshot: () => undefined,
      onConnectionState: () => undefined,
      socketFactory: () => socket as unknown as Socket,
    });
    controller.start();
    sync(socket, current);
    await Promise.resolve();

    const submission = controller.submitResponse(
      {
        sessionId: current.sessionId,
        participantToken: "p".repeat(32),
        blockId: current.currentBlock!.id,
        expectedRevision: current.revision,
        idempotencyKey: randomUUID(),
        response: { choiceIds: ["6846c45c-7c3c-4348-86a5-c6e4e5bff962"] },
      },
      async () => {
        throw new Error("REST should not be used");
      },
    );
    const rejected = expect(submission).rejects.toThrow(
      "question closed before the response was confirmed",
    );
    const reconciliation = controller.reconcile();
    sync(socket, participantSnapshot({ seq: 5 }));

    await expect(reconciliation).resolves.toMatchObject({ seq: 6 });
    await rejected;
    expect(
      socket.emitted.filter(({ event }) => event === "presentation.response.submit"),
    ).toHaveLength(1);
    controller.stop();
  });

  it("settles a pending socket response from a disconnected REST reconciliation", async () => {
    const socket = new FakeSocket();
    const saveStates: string[] = [];
    let authoritative = participantSnapshot();
    const controller = createPresentationRealtimeController({
      sessionId: participantSnapshot().sessionId,
      credential: { projection: "participant", participantToken: "p".repeat(32) },
      fetchSnapshot: async () => authoritative,
      onSnapshot: () => undefined,
      onConnectionState: () => undefined,
      onSaveState: (state) => saveStates.push(state),
      socketFactory: () => socket as unknown as Socket,
      acknowledgementTimeoutMs: 500,
    });
    controller.start();
    sync(socket, participantSnapshot());
    await Promise.resolve();

    const blockId = participantSnapshot().currentBlock!.id;
    const idempotencyKey = randomUUID();
    const responseId = randomUUID();
    const submission = controller.submitResponse(
      {
        sessionId: participantSnapshot().sessionId,
        participantToken: "p".repeat(32),
        blockId,
        expectedRevision: 3,
        idempotencyKey,
        response: { choiceIds: ["6846c45c-7c3c-4348-86a5-c6e4e5bff962"] },
      },
      async () => {
        throw new Error("REST submission should not be repeated");
      },
    );
    socket.connected = false;
    authoritative = participantSnapshot({
      seq: 6,
      responseSubmitted: true,
      responseReceipt: { responseId, blockId, idempotencyKey, acceptedAt: NOW },
    });

    await controller.reconcile();
    await expect(submission).resolves.toMatchObject({
      responseId,
      idempotencyKey,
      accepted: true,
      duplicate: true,
    });
    expect(saveStates.at(-1)).toBe("saved");
    controller.stop();
  });

  it("rejects an unconfirmed pending response after disconnected reconciliation", async () => {
    const socket = new FakeSocket();
    const saveStates: string[] = [];
    const controller = createPresentationRealtimeController({
      sessionId: participantSnapshot().sessionId,
      credential: { projection: "participant", participantToken: "p".repeat(32) },
      fetchSnapshot: async () => participantSnapshot(),
      onSnapshot: () => undefined,
      onConnectionState: () => undefined,
      onSaveState: (state) => saveStates.push(state),
      socketFactory: () => socket as unknown as Socket,
      acknowledgementTimeoutMs: 10,
    });
    controller.start();
    sync(socket, participantSnapshot());
    await Promise.resolve();

    const submission = controller.submitResponse(
      {
        sessionId: participantSnapshot().sessionId,
        participantToken: "p".repeat(32),
        blockId: participantSnapshot().currentBlock!.id,
        expectedRevision: 3,
        idempotencyKey: randomUUID(),
        response: { choiceIds: ["6846c45c-7c3c-4348-86a5-c6e4e5bff962"] },
      },
      async () => {
        throw new Error("REST submission should not be repeated");
      },
    );
    socket.connected = false;

    await expect(submission).rejects.toThrow("did not confirm that response");
    expect(saveStates.at(-1)).toBe("idle");
    controller.stop();
  });

  it("rejects a pending response when disconnected reconciliation fails", async () => {
    const socket = new FakeSocket();
    let failFetch = false;
    const controller = createPresentationRealtimeController({
      sessionId: participantSnapshot().sessionId,
      credential: { projection: "participant", participantToken: "p".repeat(32) },
      fetchSnapshot: async () => {
        if (failFetch) throw new Error("REST unavailable");
        return participantSnapshot();
      },
      onSnapshot: () => undefined,
      onConnectionState: () => undefined,
      socketFactory: () => socket as unknown as Socket,
      acknowledgementTimeoutMs: 10,
    });
    controller.start();
    sync(socket, participantSnapshot());
    await Promise.resolve();

    const submission = controller.submitResponse(
      {
        sessionId: participantSnapshot().sessionId,
        participantToken: "p".repeat(32),
        blockId: participantSnapshot().currentBlock!.id,
        expectedRevision: 3,
        idempotencyKey: randomUUID(),
        response: { choiceIds: ["6846c45c-7c3c-4348-86a5-c6e4e5bff962"] },
      },
      async () => {
        throw new Error("REST submission should not be repeated");
      },
    );
    socket.connected = false;
    failFetch = true;

    await expect(submission).rejects.toThrow("did not confirm that response");
    controller.stop();
  });

  it("recovers a REST submission when the response is lost after the server commits it", async () => {
    const socket = new FakeSocket();
    const saveStates: string[] = [];
    let authoritative = participantSnapshot();
    const controller = createPresentationRealtimeController({
      sessionId: participantSnapshot().sessionId,
      credential: { projection: "participant", participantToken: "p".repeat(32) },
      fetchSnapshot: async () => authoritative,
      onSnapshot: () => undefined,
      onConnectionState: () => undefined,
      onSaveState: (state) => saveStates.push(state),
      socketFactory: () => socket as unknown as Socket,
    });
    controller.start();
    sync(socket, participantSnapshot());
    await Promise.resolve();
    socket.fire("connect_error");
    socket.connected = false;

    const blockId = participantSnapshot().currentBlock!.id;
    const idempotencyKey = randomUUID();
    const responseId = randomUUID();
    authoritative = participantSnapshot({
      seq: 6,
      responseSubmitted: true,
      responseReceipt: { responseId, blockId, idempotencyKey, acceptedAt: NOW },
    });

    const result = controller.submitResponse(
      {
        sessionId: participantSnapshot().sessionId,
        participantToken: "p".repeat(32),
        blockId,
        expectedRevision: 3,
        idempotencyKey,
        response: { choiceIds: ["6846c45c-7c3c-4348-86a5-c6e4e5bff962"] },
      },
      async () => {
        throw new Error("Connection ended before the acknowledgement arrived");
      },
    );

    await expect(result).resolves.toMatchObject({
      responseId,
      idempotencyKey,
      accepted: true,
      duplicate: true,
    });
    expect(saveStates).toEqual(["saving", "reconnecting_not_saved", "saved"]);
    controller.stop();
  });

  it("recovers the durable response receipt when the original acknowledgement is lost", async () => {
    const socket = new FakeSocket();
    const saveStatuses: Array<{ state: string; blockId: string }> = [];
    const controller = createPresentationRealtimeController({
      sessionId: participantSnapshot().sessionId,
      credential: { projection: "participant", participantToken: "p".repeat(32) },
      fetchSnapshot: async () => participantSnapshot(),
      onSnapshot: () => undefined,
      onConnectionState: () => undefined,
      onSaveState: (state, blockId) => saveStatuses.push({ state, blockId }),
      socketFactory: () => socket as unknown as Socket,
      acknowledgementTimeoutMs: 500,
    });
    controller.start();
    sync(socket, participantSnapshot());

    const idempotencyKey = randomUUID();
    const responseId = randomUUID();
    const submittedBlockId = participantSnapshot().currentBlock!.id;
    const nextBlockId = randomUUID();
    const submission = controller.submitResponse(
      {
        sessionId: participantSnapshot().sessionId,
        participantToken: "p".repeat(32),
        blockId: submittedBlockId,
        expectedRevision: 3,
        idempotencyKey,
        response: { choiceIds: ["6846c45c-7c3c-4348-86a5-c6e4e5bff962"] },
      },
      async () => {
        throw new Error("REST should not be used");
      },
    );

    socket.disconnect();
    socket.connect();
    sync(
      socket,
      participantSnapshot({
        seq: 6,
        phase: "question_reveal",
        acceptingResponses: false,
        currentBlock: {
          ...participantSnapshot().currentBlock!,
          id: nextBlockId,
        },
        responseSubmitted: false,
        responseReceipt: {
          responseId,
          blockId: submittedBlockId,
          idempotencyKey,
          acceptedAt: NOW,
        },
      }),
    );

    await expect(submission).resolves.toMatchObject({
      responseId,
      idempotencyKey,
      duplicate: true,
    });
    expect(saveStatuses.at(-1)).toEqual({ state: "saved", blockId: submittedBlockId });
    expect(
      presentationSaveStateForBlock({ state: "saved", blockId: submittedBlockId }, nextBlockId),
    ).toBe("idle");
    controller.stop();
  });

  it.each(["choice", "text"] as const)(
    "replays the exact pending %s response after reconnect and a newer sequence",
    async (kind) => {
      const initial = participantSnapshot();
      if (kind === "text" && initial.currentBlock?.kind === "question") {
        initial.currentBlock.question = {
          ...initial.currentBlock.question,
          type: "open_text",
          choices: [],
          basePoints: 0,
        };
      }
      const snapshot = (overrides: Partial<PresentationParticipantSnapshot> = {}) => ({
        ...initial,
        ...overrides,
      });
      const socket = new FakeSocket();
      const saveStates: string[] = [];
      const controller = createPresentationRealtimeController({
        sessionId: initial.sessionId,
        credential: { projection: "participant", participantToken: "p".repeat(32) },
        fetchSnapshot: async () => snapshot(),
        onSnapshot: () => undefined,
        onConnectionState: () => undefined,
        onSaveState: (state) => saveStates.push(state),
        socketFactory: () => socket as unknown as Socket,
        acknowledgementTimeoutMs: 50,
      });
      controller.start();
      sync(socket, snapshot());

      const idempotencyKey = randomUUID();
      const submission = controller.submitResponse(
        {
          sessionId: initial.sessionId,
          participantToken: "p".repeat(32),
          blockId: initial.currentBlock!.id,
          expectedRevision: 3,
          idempotencyKey,
          response:
            kind === "text"
              ? { textValue: "Private café\nnext step" }
              : { choiceIds: ["6846c45c-7c3c-4348-86a5-c6e4e5bff962"] },
        },
        async () => {
          throw new Error("REST should not be used");
        },
      );
      socket.disconnect();
      socket.connect();
      sync(socket, snapshot({ seq: 6 }));

      const attempts = socket.emitted.filter(
        (entry) => entry.event === "presentation.response.submit",
      );
      expect(attempts).toHaveLength(2);
      expect(attempts[1]!.payload).toEqual(attempts[0]!.payload);
      expect(
        attempts.map(({ payload }) => (payload as { idempotencyKey: string }).idempotencyKey),
      ).toEqual([idempotencyKey, idempotencyKey]);

      const ack: PresentationResponseAck = {
        sessionId: initial.sessionId,
        blockId: initial.currentBlock!.id,
        idempotencyKey,
        accepted: true,
        duplicate: true,
        responseId: randomUUID(),
        acceptedAt: NOW,
        snapshot: snapshot({ seq: 7, responseSubmitted: true }),
      };
      attempts[1]!.ack?.({ data: ack });
      await expect(submission).resolves.toEqual(ack);
      expect(saveStates.at(-1)).toBe("saved");
      controller.stop();
    },
  );

  it.each([
    ["session", { sessionId: randomUUID() }],
    ["block", { blockId: randomUUID() }],
    ["idempotency key", { idempotencyKey: randomUUID() }],
  ])("rejects an acknowledgement with a mismatched %s", async (_field, mismatch) => {
    const socket = new FakeSocket();
    const saveStatuses: Array<{ state: string; blockId: string }> = [];
    const controller = createPresentationRealtimeController({
      sessionId: participantSnapshot().sessionId,
      credential: { projection: "participant", participantToken: "p".repeat(32) },
      fetchSnapshot: async () => participantSnapshot(),
      onSnapshot: () => undefined,
      onConnectionState: () => undefined,
      onSaveState: (state, blockId) => saveStatuses.push({ state, blockId }),
      socketFactory: () => socket as unknown as Socket,
    });
    controller.start();
    sync(socket, participantSnapshot());

    const blockId = participantSnapshot().currentBlock!.id;
    const idempotencyKey = randomUUID();
    const submission = controller.submitResponse(
      {
        sessionId: participantSnapshot().sessionId,
        participantToken: "p".repeat(32),
        blockId,
        expectedRevision: 3,
        idempotencyKey,
        response: { choiceIds: ["6846c45c-7c3c-4348-86a5-c6e4e5bff962"] },
      },
      async () => {
        throw new Error("REST should not be used");
      },
    );
    socket.last("presentation.response.submit")!.ack?.({
      data: {
        sessionId: participantSnapshot().sessionId,
        blockId,
        idempotencyKey,
        accepted: true,
        duplicate: false,
        responseId: randomUUID(),
        acceptedAt: NOW,
        snapshot: participantSnapshot({ seq: 6, responseSubmitted: true }),
        ...mismatch,
      } satisfies PresentationResponseAck,
    });

    await expect(submission).rejects.toThrow("mismatched response acknowledgement");
    expect(saveStatuses.at(-1)).toEqual({ state: "idle", blockId });
    controller.stop();
  });

  it("ignores a duplicate acknowledgement after the pending response has settled", async () => {
    const socket = new FakeSocket();
    const snapshots: number[] = [];
    const controller = createPresentationRealtimeController({
      sessionId: participantSnapshot().sessionId,
      credential: { projection: "participant", participantToken: "p".repeat(32) },
      fetchSnapshot: async () => participantSnapshot(),
      onSnapshot: (snapshot) => snapshots.push(snapshot.seq),
      onConnectionState: () => undefined,
      socketFactory: () => socket as unknown as Socket,
    });
    controller.start();
    sync(socket, participantSnapshot());
    const idempotencyKey = randomUUID();
    const result = controller.submitResponse(
      {
        sessionId: participantSnapshot().sessionId,
        participantToken: "p".repeat(32),
        blockId: participantSnapshot().currentBlock!.id,
        expectedRevision: 3,
        idempotencyKey,
        response: { choiceIds: ["6846c45c-7c3c-4348-86a5-c6e4e5bff962"] },
      },
      async () => {
        throw new Error("REST should not be used");
      },
    );
    const attempt = socket.last("presentation.response.submit")!;
    const ack: PresentationResponseAck = {
      sessionId: participantSnapshot().sessionId,
      blockId: participantSnapshot().currentBlock!.id,
      idempotencyKey,
      accepted: true,
      duplicate: false,
      responseId: randomUUID(),
      acceptedAt: NOW,
      snapshot: participantSnapshot({ seq: 6, responseSubmitted: true }),
    };
    attempt.ack?.({ data: ack });
    attempt.ack?.({ data: { ...ack, snapshot: participantSnapshot({ seq: 7 }) } });

    await expect(result).resolves.toEqual(ack);
    expect(snapshots).toEqual([5, 6]);
    controller.stop();
  });
});

describe("Presentation realtime disconnect recovery", () => {
  it("switches a terminal server disconnect to REST fallback", async () => {
    const socket = new FakeSocket();
    const connectionStates: string[] = [];
    let fetches = 0;
    const controller = createPresentationRealtimeController({
      sessionId: hostSnapshot().sessionId,
      credential: { projection: "host", controlToken: "h".repeat(32) },
      fetchSnapshot: async () => {
        fetches += 1;
        return hostSnapshot();
      },
      onSnapshot: () => undefined,
      onConnectionState: (state) => connectionStates.push(state),
      socketFactory: () => socket as unknown as Socket,
    });
    controller.start();
    sync(socket, hostSnapshot());
    await Promise.resolve();
    const fetchesBeforeDisconnect = fetches;

    socket.connected = false;
    socket.fire("disconnect", "io server disconnect");
    await Promise.resolve();

    expect(connectionStates.at(-1)).toBe("fallback");
    expect(controller.needsFallbackPolling()).toBe(true);
    expect(controller.canMutate()).toBe(true);
    expect(fetches).toBeGreaterThan(fetchesBeforeDisconnect);
    controller.stop();
  });
});
