import { afterEach, describe, expect, it, vi } from "vitest";
import type { SessionSnapshot } from "@openround/contracts";
import {
  createAckRecoveryController,
  participantSubmissionRecovery,
} from "./realtime-mutation-recovery";

function snapshot(
  input: Pick<SessionSnapshot, "phase" | "roundId" | "myResponse"> &
    Partial<Pick<SessionSnapshot, "myResponseAccepted">>,
): SessionSnapshot {
  return input as SessionSnapshot;
}

describe("participantSubmissionRecovery", () => {
  it("reconciles accepted text from a body-free marker after acknowledgement loss", () => {
    expect(
      participantSubmissionRecovery(
        "round-1",
        snapshot({
          phase: "question_open",
          roundId: "round-1",
          myResponse: null,
          myResponseAccepted: true,
        }),
      ),
    ).toBe("saved");
  });
  it("uses the authoritative saved response after a reconnect", () => {
    expect(
      participantSubmissionRecovery(
        "round-1",
        snapshot({
          phase: "question_open",
          roundId: "round-1",
          myResponse: { kind: "choice", choiceIds: ["choice-1"] },
        }),
      ),
    ).toBe("saved");
  });

  it("keeps an open-round submission unconfirmed when no durable response is visible yet", () => {
    expect(
      participantSubmissionRecovery(
        "round-1",
        snapshot({ phase: "question_open", roundId: "round-1", myResponse: null }),
      ),
    ).toBe("unconfirmed");
  });

  it("does not invite a retry after the question or round has moved on", () => {
    expect(
      participantSubmissionRecovery(
        "round-1",
        snapshot({ phase: "question_locked", roundId: "round-1", myResponse: null }),
      ),
    ).toBe("closed");
    expect(
      participantSubmissionRecovery(
        "round-1",
        snapshot({ phase: "question_open", roundId: "round-2", myResponse: null }),
      ),
    ).toBe("closed");
  });
});

describe("createAckRecoveryController", () => {
  afterEach(() => vi.useRealTimers());

  it("keeps a host command pending through unrelated realtime activity and a delayed ack", () => {
    vi.useFakeTimers();
    const pendingStates: boolean[] = [];
    const reconciliationRequests: string[] = [];
    const expired: string[] = [];
    const controller = createAckRecoveryController<null>({
      acknowledgementTimeoutMs: 10_000,
      reconciliationTimeoutMs: 5_000,
      onPendingChange: (pending) => pendingStates.push(pending),
      onReconciliationRequested: ({ id }) => reconciliationRequests.push(id),
      onExpired: ({ id }) => expired.push(id),
    });

    expect(controller.begin("command-1", null)).toBe(true);
    expect(controller.begin("command-2", null)).toBe(false);

    // Receiving an unrelated room snapshot has no controller transition. Only
    // this command's ack or independently verified durable evidence may settle it.
    vi.advanceTimersByTime(10_000);
    expect(controller.current()).toMatchObject({
      id: "command-1",
      stage: "reconciling",
    });
    expect(reconciliationRequests).toEqual(["command-1"]);

    expect(controller.settle("another-command")).toBeNull();
    expect(controller.current()?.id).toBe("command-1");
    expect(controller.settle("command-1")).toMatchObject({ id: "command-1" });

    vi.advanceTimersByTime(5_000);
    expect(expired).toEqual([]);
    expect(pendingStates).toEqual([true, false]);
  });

  it("expires a dropped acknowledgement after reconciliation also times out", () => {
    vi.useFakeTimers();
    const expired: string[] = [];
    const controller = createAckRecoveryController({
      acknowledgementTimeoutMs: 10_000,
      reconciliationTimeoutMs: 5_000,
      onReconciliationRequested: () => undefined,
      onExpired: ({ id }) => expired.push(id),
    });

    controller.begin("submission-1", { roundId: "round-1" });
    vi.advanceTimersByTime(15_000);

    expect(expired).toEqual(["submission-1"]);
    expect(controller.current()).toBeNull();
    expect(controller.settle("submission-1")).toBeNull();
  });

  it("retries the same participant idempotency key without letting a stale ack clear it", () => {
    vi.useFakeTimers();
    const expired: Array<{ idempotencyKey: string; response: string }> = [];
    const controller = createAckRecoveryController<{
      idempotencyKey: string;
      response: string;
    }>({
      acknowledgementTimeoutMs: 10_000,
      reconciliationTimeoutMs: 5_000,
      onReconciliationRequested: () => undefined,
      onExpired: ({ context }) => expired.push(context),
    });
    const submission = { idempotencyKey: "answer-key-1", response: "A" };

    controller.begin("transport-attempt-1", submission);
    vi.advanceTimersByTime(15_000);
    expect(expired).toEqual([submission]);

    expect(controller.begin("transport-attempt-2", expired[0]!)).toBe(true);
    expect(controller.settle("transport-attempt-1")).toBeNull();
    expect(controller.current()).toMatchObject({
      id: "transport-attempt-2",
      context: submission,
    });
    expect(controller.settle("transport-attempt-2")).not.toBeNull();
  });
});
