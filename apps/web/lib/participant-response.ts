import type {
  AnswerAck,
  ConfidenceValue,
  ResponsePayload,
  SessionSnapshot,
} from "@openround/contracts";

export type ParticipantProgressStage =
  "waiting" | "answering" | "saved" | "discussing" | "reviewing" | "rechecking" | "complete";

export function participantProgressStage(
  snapshot: SessionSnapshot,
  responseSaved: boolean,
): ParticipantProgressStage {
  if (snapshot.phase === "finished") return "complete";
  if (snapshot.phase === "intervention") return "discussing";
  if (snapshot.phase === "question_reveal" || snapshot.phase === "leaderboard") {
    return "reviewing";
  }
  if (snapshot.roundKind === "linked_recheck" || snapshot.roundKind === "revote") {
    return "rechecking";
  }
  if (snapshot.phase === "question_open") return responseSaved ? "saved" : "answering";
  if (responseSaved && snapshot.phase === "question_locked") {
    return "saved";
  }
  return "waiting";
}

export interface ParticipantResponseView {
  saved: boolean;
  choiceIds: string[];
  rankingChoiceIds: string[];
  numericValue: string;
  ratingValue: number | null;
  confidence: ConfidenceValue | null;
}

export interface LocalResponseReceipt {
  response: ResponsePayload;
  confidence: ConfidenceValue | null;
}

export interface ParticipantRevealState {
  revealed: boolean;
  selectedCorrect: boolean;
  selectedIncorrect: boolean;
}

export function togglePollSelection(selected: string[], choiceId: string, maxSelections: number) {
  if (selected.includes(choiceId)) return selected.filter((id) => id !== choiceId);
  return selected.length < maxSelections ? [...selected, choiceId] : selected;
}

export function multipleSelectionPoll(question: { type: string; maxSelections?: number }) {
  return question.type === "poll" && (question.maxSelections ?? 1) > 1;
}

export function legacyResponseRequiresSubmit(question: {
  type: string;
  maxSelections?: number;
  confidence?: string;
}) {
  return (
    ["multi_select", "numeric", "rating", "ranking", "open_text", "word_cloud"].includes(
      question.type,
    ) ||
    multipleSelectionPoll(question) ||
    (question.confidence ?? "off") !== "off"
  );
}

/** Competitive single answers save immediately; confidence is always skippable. */
export function usesAutomaticChoiceSubmission(
  snapshot: Pick<SessionSnapshot, "uxBeta" | "settings" | "roundKind" | "question"> | null,
) {
  return Boolean(
    snapshot?.uxBeta === true &&
    snapshot.settings.resultVisibility === "leaderboard" &&
    snapshot.roundKind === "main" &&
    snapshot.question &&
    ["single_select", "true_false"].includes(snapshot.question.type),
  );
}

/**
 * Builds the learner-safe reveal state from the explicit server signal and the learner's own
 * result. It never needs the facilitator-only correct response.
 */
export function participantRevealState(
  snapshot: Pick<SessionSnapshot, "answerRevealed" | "myCorrect">,
  selected = false,
): ParticipantRevealState {
  return {
    revealed: snapshot.answerRevealed,
    selectedCorrect: snapshot.answerRevealed && selected && snapshot.myCorrect === true,
    selectedIncorrect: snapshot.answerRevealed && selected && snapshot.myCorrect === false,
  };
}

export function participantResponseControlsDisabled(input: {
  questionOpen: boolean;
  saved: boolean;
  submitting: boolean;
}) {
  return !input.questionOpen || input.saved || input.submitting;
}

export function participantResponseView(
  serverResponse: ResponsePayload | null | undefined,
  serverConfidence: ConfidenceValue | null | undefined,
  acknowledgement: AnswerAck | null,
  localReceipt: LocalResponseReceipt | null = null,
  responseAccepted = false,
): ParticipantResponseView {
  const acknowledgedResponse = acknowledgement?.accepted ? localReceipt?.response : null;
  const visibleResponse = serverResponse ?? acknowledgedResponse;
  return {
    saved: Boolean(serverResponse || acknowledgement?.accepted || responseAccepted),
    choiceIds:
      visibleResponse?.kind === "choice" || visibleResponse?.kind === "poll"
        ? visibleResponse.choiceIds
        : [],
    rankingChoiceIds: visibleResponse?.kind === "ranking" ? visibleResponse.choiceIds : [],
    numericValue: visibleResponse?.kind === "numeric" ? visibleResponse.value : "",
    ratingValue: visibleResponse?.kind === "rating" ? visibleResponse.value : null,
    confidence: serverResponse
      ? (serverConfidence ?? null)
      : acknowledgement?.accepted
        ? (localReceipt?.confidence ?? null)
        : null,
  };
}
