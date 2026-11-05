import type { PresentationCommand, PresentationControlCommand } from "@openround/contracts";
import { isPresentationHostPassRejection } from "./presentation-host-pass";

export interface PresentationCommandRecoveryState<
  Command extends PresentationControlCommand = PresentationCommand,
> {
  busy: boolean;
  pendingCommand: Command | null;
}

function acknowledgementMayBeLost(error: unknown) {
  const { code, status } = (error ?? {}) as { code?: string; status?: number };
  if (typeof status === "number") return status >= 500;
  return (
    !code ||
    code === "INTERNAL_ERROR" ||
    code === "PRESENTATION_COMMAND_UNCONFIRMED" ||
    code === "PRESENTATION_RECONNECT_REQUIRED"
  );
}

function retryTemporarilyDenied(error: unknown) {
  const { code, status } = (error ?? {}) as { code?: string; status?: number };
  return (
    status === 408 ||
    status === 425 ||
    status === 429 ||
    code === "RATE_LIMITED" ||
    code === "RECONNECTING" ||
    code === "DEPENDENCY_UNAVAILABLE" ||
    code === "FEATURE_UNAVAILABLE" ||
    code === "UNAVAILABLE" ||
    isPresentationHostPassRejection(error)
  );
}

function insertionRetryPrerequisiteDenied(error: unknown, command: PresentationControlCommand) {
  const { code } = (error ?? {}) as { code?: string };
  // An earlier insertion may still be committing while this retry misses its durable receipt.
  // Source, phase, or media checks on the retry cannot settle that earlier ambiguous attempt.
  return (
    (command.action === "insert_recovery_pack" ||
      command.action === "insert_quick_check" ||
      command.action === "insert_published_question") &&
    (code === "NOT_FOUND" || code === "PHASE_CLOSED" || code === "VALIDATION_ERROR")
  );
}

/** Keep the exact request until its acknowledgement resolves the action, even after a phase update. */
export function createPresentationCommandRecovery<
  Snapshot,
  Command extends PresentationControlCommand = PresentationCommand,
>({
  execute,
  onState,
  pendingCommand = null,
}: {
  execute: (command: Command) => Promise<Snapshot>;
  onState: (state: PresentationCommandRecoveryState<Command>) => void;
  pendingCommand?: Command | null;
}) {
  let state: PresentationCommandRecoveryState<Command> = {
    busy: false,
    pendingCommand: pendingCommand ? (Object.freeze({ ...pendingCommand }) as Command) : null,
  };
  const publish = (next: PresentationCommandRecoveryState<Command>) => {
    state = next;
    onState(next);
  };
  const attempt = async (command: Command, retrying = false) => {
    // This synchronous fence also covers two clicks before React renders the disabled control.
    if (state.busy) return;
    publish({ busy: true, pendingCommand: command });
    try {
      const snapshot = await execute(command);
      publish({ busy: false, pendingCommand: null });
      return snapshot;
    } catch (error) {
      publish({
        busy: false,
        // A retry rejected before receipt lookup does not settle the original ambiguous attempt.
        pendingCommand:
          acknowledgementMayBeLost(error) ||
          (retrying &&
            (retryTemporarilyDenied(error) || insertionRetryPrerequisiteDenied(error, command)))
            ? command
            : null,
      });
      throw error;
    }
  };
  return {
    state: () => state,
    run(command: Command) {
      if (state.busy || state.pendingCommand) return Promise.resolve(undefined);
      // Freeze a copy so changing picker selection or the received revision cannot alter a retry.
      const frozen = Object.freeze({
        ...command,
        ...(command.action === "start_recovery_card"
          ? { recoveryPackCard: Object.freeze({ ...command.recoveryPackCard }) }
          : {}),
        ...(command.action === "insert_quick_check"
          ? {
              quickCheck: Object.freeze({
                ...command.quickCheck,
                choices: Object.freeze([...command.quickCheck.choices]),
              }),
            }
          : {}),
        ...(command.action === "insert_published_question"
          ? { publishedQuestion: Object.freeze({ ...command.publishedQuestion }) }
          : {}),
      }) as Command;
      return attempt(frozen);
    },
    retry() {
      if (!state.pendingCommand || state.busy) return Promise.resolve(undefined);
      return attempt(state.pendingCommand, true);
    },
    rebindControlToken(controlToken: string) {
      if (state.busy) return false;
      if (state.pendingCommand) {
        if (!("controlToken" in state.pendingCommand)) return false;
        publish({
          ...state,
          pendingCommand: Object.freeze({ ...state.pendingCommand, controlToken }) as Command,
        });
      }
      return true;
    },
  };
}
