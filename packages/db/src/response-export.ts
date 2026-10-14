import {
  isApprovedTextAnswer,
  upgradeGameState,
  type EngineAnswer,
  type GameState,
} from "@openround/game-engine";

type ExportAnswer = Pick<EngineAnswer, "answerId" | "roundId" | "acceptedAtMs" | "response">;

/** Standard exports share the public text policy; the moderation queue is the pending-body read. */
export function roundAnswerExportAllowed(state: GameState, answer: ExportAnswer): boolean {
  if (answer.response.kind !== "text") return true;
  const questionId = state.rounds[answer.roundId]?.questionId;
  return Boolean(questionId) && isApprovedTextAnswer(answer, state.responseModeration, questionId);
}

/** Filter an independent export copy, preserving the immutable accepted records in storage. */
export function roundStateForExport(state: GameState): GameState {
  const copy = structuredClone(upgradeGameState(state));
  copy.answers = Object.fromEntries(
    Object.entries(copy.answers).filter(([, answer]) => roundAnswerExportAllowed(copy, answer)),
  );
  return copy;
}
