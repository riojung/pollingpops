import type { SessionSnapshot } from "@openround/contracts";

export type ParticipantSubmissionRecovery = "saved" | "unconfirmed" | "closed";

export type AckRecoveryStage = "awaiting_ack" | "reconciling";

export type AckRecoveryPending<T> = Readonly<{
  id: string;
  context: T;
  stage: AckRecoveryStage;
}>;

export type AckRecoveryController<T> = {
  begin(id: string, context: T): boolean;
  current(): AckRecoveryPending<T> | null;
  settle(id?: string): AckRecoveryPending<T> | null;
  dispose(): void;
};

type AckRecoveryOptions<T> = {
  acknowledgementTimeoutMs: number;
  reconciliationTimeoutMs: number;
  onPendingChange?: (pending: boolean) => void;
  onReconciliationRequested: (pending: AckRecoveryPending<T>) => void;
  onExpired: (pending: AckRecoveryPending<T>) => void;
};

type InternalPending<T> = {
  id: string;
  context: T;
  stage: AckRecoveryStage;
  timeoutId: ReturnType<typeof setTimeout> | null;
};

function publicPending<T>(pending: InternalPending<T>): AckRecoveryPending<T> {
  return { id: pending.id, context: pending.context, stage: pending.stage };
}

/**
 * Keeps an acknowledgement pending until its own callback or an authoritative
 * reconciliation settles it. Realtime snapshots deliberately do not feed this
 * controller: unrelated room activity must never make a command look confirmed.
 */
export function createAckRecoveryController<T>(
  options: AckRecoveryOptions<T>,
): AckRecoveryController<T> {
  let pending: InternalPending<T> | null = null;

  const settle = (id?: string) => {
    if (!pending || (id && pending.id !== id)) return null;
    const settled = publicPending(pending);
    if (pending.timeoutId) clearTimeout(pending.timeoutId);
    pending = null;
    options.onPendingChange?.(false);
    return settled;
  };

  return {
    begin(id, context) {
      if (pending) return false;
      const next: InternalPending<T> = {
        id,
        context,
        stage: "awaiting_ack",
        timeoutId: null,
      };
      next.timeoutId = setTimeout(() => {
        if (pending !== next || next.stage !== "awaiting_ack") return;
        next.stage = "reconciling";
        next.timeoutId = setTimeout(() => {
          const expired = settle(next.id);
          if (expired) options.onExpired(expired);
        }, options.reconciliationTimeoutMs);
        options.onReconciliationRequested(publicPending(next));
      }, options.acknowledgementTimeoutMs);
      pending = next;
      options.onPendingChange?.(true);
      return true;
    },
    current() {
      return pending ? publicPending(pending) : null;
    },
    settle,
    dispose() {
      if (!pending) return;
      if (pending.timeoutId) clearTimeout(pending.timeoutId);
      pending = null;
    },
  };
}

export function participantSubmissionRecovery(
  pendingRoundId: string,
  snapshot: SessionSnapshot,
): ParticipantSubmissionRecovery {
  if (snapshot.roundId === pendingRoundId && (snapshot.myResponse || snapshot.myResponseAccepted))
    return "saved";
  if (snapshot.roundId === pendingRoundId && snapshot.phase === "question_open") {
    return "unconfirmed";
  }
  return "closed";
}

export const PARTICIPANT_ACK_TIMEOUT_MESSAGE =
  "The server did not confirm that response. Retry saving the same response.";

export const PARTICIPANT_ACK_CHECKING_MESSAGE =
  "The response acknowledgement was delayed. Checking whether it was saved…";

export const HOST_ACK_TIMEOUT_MESSAGE =
  "The server did not confirm that action. Review the current room state and try again.";

export const HOST_ACK_CHECKING_MESSAGE =
  "The action acknowledgement was delayed. Checking the current room state…";
