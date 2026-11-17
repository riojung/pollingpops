import type { SessionSnapshot } from "@openround/contracts";
import {
  legacyResponseRequiresSubmit,
  usesImmediateChoiceSubmission,
} from "../../../lib/participant-response";

export function participantResponseFooterVisible(
  snapshot: SessionSnapshot | null,
  state: {
    saved: boolean;
    pending: boolean;
    retryable: boolean;
    failed: boolean;
    error: string;
    hasDraft: boolean;
  },
) {
  if (snapshot?.phase !== "question_open" || state.saved) return false;
  // Immediate answers already have an instruction beside the question. Reserve
  // the footer for actual save progress and recovery, rather than repeating it.
  if (usesImmediateChoiceSubmission(snapshot))
    return state.pending || state.retryable || state.failed || Boolean(state.error);
  return Boolean(
    snapshot.uxBeta ||
    (snapshot.question && legacyResponseRequiresSubmit(snapshot.question)) ||
    state.retryable ||
    state.hasDraft,
  );
}
