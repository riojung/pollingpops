import type { SessionSnapshot } from "@openround/contracts";
import type { PresenterCue } from "../../../lib/sound";

type PhaseSnapshot = Pick<SessionSnapshot, "sessionId" | "seq" | "roundId" | "phase">;

export function presenterCueFor(
  previous: PhaseSnapshot | null,
  next: PhaseSnapshot,
  eventType: string,
): PresenterCue | undefined {
  if (!previous || previous.sessionId !== next.sessionId || next.seq <= previous.seq) return;

  const sameCheckpoint = next.roundId !== null && previous.roundId === next.roundId;
  switch (eventType) {
    case "question.open":
    case "recheck.open":
      if (next.phase === "question_open" && next.roundId !== null && !sameCheckpoint) return "open";
      break;
    case "question.locked":
      if (
        sameCheckpoint &&
        next.phase === "question_locked" &&
        (previous.phase === "question_open" || previous.phase === "paused")
      ) {
        return "lock";
      }
      break;
    case "question.reveal":
      if (
        sameCheckpoint &&
        next.phase === "question_reveal" &&
        previous.phase === "question_locked"
      ) {
        return "reveal";
      }
      break;
    case "game.finished":
      if (next.phase === "finished" && previous.phase !== "finished") return "finish";
      break;
  }
}

export function presenterResponseDistribution(snapshot: SessionSnapshot | null) {
  const question = snapshot?.question;
  if (
    snapshot?.uxBeta === true ||
    question?.type === "ranking" ||
    (question?.type === "poll" && (question.maxSelections ?? 1) > 1)
  ) {
    return snapshot?.responseDistribution;
  }
}
