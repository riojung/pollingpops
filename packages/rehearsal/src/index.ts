import {
  questionConfidence,
  questionDelivery,
  questionPurpose,
  type CheckpointInsight,
  type ConfidenceValue,
  type InterventionType,
  type QuestionDraft,
  type QuizDraft,
  type RoundKind,
  type SessionSnapshot,
} from "@openround/contracts";
import {
  acceptAnswer,
  addParticipant,
  applyHostCommand,
  createGameState,
  snapshotForRole,
  type EngineAnswer,
  type GameState,
} from "@openround/game-engine";
import { deriveCheckpointInsight } from "@openround/insights";
import {
  createHostCommandController,
  getHostPhaseView,
  isLegalHostPhaseCommand,
  sameHostPhaseCommand,
  type HostPhaseCommand,
} from "./host-phase";
export {
  createHostCommandController,
  getHostPhaseView,
  IllegalHostPhaseCommandError,
  isLegalHostPhaseCommand,
  sameHostPhaseCommand,
  type HostCommandController,
  type HostPhaseCommand,
  type HostPhaseView,
} from "./host-phase";
export {
  buildCompanionPrototypeProjection,
  COMPANION_PROTOTYPE_VERSION,
  type CompanionPrototypeAction,
  type CompanionPrototypeConnectionState,
  type CompanionPrototypeInput,
  type CompanionPrototypePhase,
  type CompanionPrototypeProjection,
} from "./companion-prototype";
export {
  DELAYED_PROBE_REJECTION_REASONS,
  DELAYED_PROBE_PROTOTYPE_VERSION,
  evaluateDelayedProbeCandidate,
  type DelayedProbeEvaluation,
  type DelayedProbeRejectionReason,
} from "./delayed-probe-prototype";
export {
  buildPrototypeEvidenceExport,
  PROTOTYPE_EVIDENCE_PROTOCOL_VERSION,
  PROTOTYPE_EVIDENCE_SCHEMA_VERSION,
  prototypeDurationBucket,
  type PrototypeDurationBucket,
  type PrototypeEvidenceExportV1,
  type PrototypeEvidenceInput,
  type PrototypeEvidenceSegment,
} from "./prototype-evidence";
export {
  createQuestionHealthFindingEvaluation,
  evaluateQuestionHealth,
  QUESTION_HEALTH_RULE_IDS,
  QUESTION_HEALTH_RULESET_VERSION,
  type QuestionHealthFinding,
  type QuestionHealthFindingEvaluation,
  type QuestionHealthOutcome,
  type QuestionHealthOutcomeDisposition,
  type QuestionHealthResult,
  type QuestionHealthRuleId,
  type QuestionHealthUsefulness,
  type QuestionHealthUsefulnessDisposition,
} from "./question-health-prototype";

type ChoiceQuestion = Extract<
  QuestionDraft,
  { type: "single_select" | "true_false" | "multi_select" | "poll" }
>;
type RehearsalChoiceQuestion = ChoiceQuestion & { type: "single_select" | "true_false" };

export type RecoveryRehearsalScenarioId =
  "low_participation" | "split_room" | "confident_misconception";

export type RecoveryRehearsalStage =
  | "briefing"
  | "question_open"
  | "responses"
  | "diagnosis"
  | "revealed"
  | "intervention"
  | "verify"
  | "recheck"
  | "debrief";

export interface RecoveryRehearsalScenario {
  id: RecoveryRehearsalScenarioId;
  title: string;
  shortLabel: string;
  description: string;
  audienceSize: 10;
  responseCount: 6 | 10;
  correctCount: 2 | 5 | 6;
  wrongCount: 4 | 5;
  highConfidenceWrongCount: 0 | 4;
}

export const RECOVERY_REHEARSAL_SCENARIOS = [
  {
    id: "low_participation",
    title: "Low participation",
    shortLabel: "6 of 10 respond",
    description:
      "Practise separating an access problem from an understanding problem before acting on the result.",
    audienceSize: 10,
    responseCount: 6,
    correctCount: 2,
    wrongCount: 4,
    highConfidenceWrongCount: 0,
  },
  {
    id: "split_room",
    title: "Split response pattern",
    shortLabel: "5 correct · 5 choose one wrong option",
    description:
      "Practise reading an even split without replacing Polling Pops’ production insight priority.",
    audienceSize: 10,
    responseCount: 10,
    correctCount: 5,
    wrongCount: 5,
    highConfidenceWrongCount: 0,
  },
  {
    id: "confident_misconception",
    title: "Confident misconception",
    shortLabel: "4 very-sure wrong · 6 correct",
    description:
      "Practise responding when a meaningful group is confidently wrong, then check for recovery.",
    audienceSize: 10,
    responseCount: 10,
    correctCount: 6,
    wrongCount: 4,
    highConfidenceWrongCount: 4,
  },
] as const satisfies readonly RecoveryRehearsalScenario[];

export interface RecoveryRehearsalQuestionOption {
  questionId: string;
  questionIndex: number;
  prompt: string;
  wrongChoiceId: string;
  wrongChoiceLabel: string;
  recheckMode: "linked" | "revote";
  recheckQuestionId: string;
  recheckPrompt: string;
}

export interface RecoveryRehearsalEligibility {
  eligible: boolean;
  questions: RecoveryRehearsalQuestionOption[];
  reason: string | null;
  requirements: readonly string[];
}

export interface RecoveryRehearsalParticipant {
  id: string;
  label: string;
  initial: "correct" | "incorrect" | "no_response";
  recheck: "correct" | "incorrect" | "no_response";
  recovered: boolean;
}

export interface RecoveryRehearsalDebrief {
  evidenceLabel: "Linked recheck recovery" | "Revote improvement";
  evidenceNote: string;
  initialWrongCount: number;
  recoveredCount: number;
  recoveryPercent: number;
  unresolvedCount: number;
  summary: string;
  syntheticDataNote: string;
}

export interface RecoveryRehearsalStep {
  id: RecoveryRehearsalStage;
  eyebrow: string;
  title: string;
  guidance: string;
  continueLabel: string | null;
  snapshot: SessionSnapshot;
  command: HostPhaseCommand | null;
}

export interface RecoveryRehearsalPlan {
  scenario: RecoveryRehearsalScenario;
  sourceQuestion: {
    id: string;
    prompt: string;
    correctChoiceLabel: string;
    wrongChoiceLabel: string;
  };
  recheck: {
    mode: "linked" | "revote";
    roundKind: Extract<RoundKind, "linked_recheck" | "revote">;
    questionId: string;
    prompt: string;
    label: "Linked recheck" | "Same-question revote";
  };
  insight: CheckpointInsight;
  recheckInsight: CheckpointInsight;
  intervention: {
    type: InterventionType;
    title: string;
    guidance: string;
  };
  participants: RecoveryRehearsalParticipant[];
  debrief: RecoveryRehearsalDebrief;
  steps: readonly RecoveryRehearsalStep[];
  adaptations: readonly string[];
}

export interface RecoveryRehearsalViewModel {
  step: RecoveryRehearsalStep;
  stepIndex: number;
  stepCount: number;
  progressPercent: number;
  canGoBack: boolean;
  canContinue: boolean;
  complete: boolean;
}

export interface RecoveryRehearsalController {
  readonly plan: RecoveryRehearsalPlan;
  view(stepIndex: number): RecoveryRehearsalViewModel;
  next(stepIndex: number): number;
  previous(stepIndex: number): number;
  apply(stepIndex: number, command: HostPhaseCommand): number;
}

export class RecoveryRehearsalError extends Error {
  constructor(
    public readonly code:
      "NO_ELIGIBLE_CHECKPOINT" | "CHECKPOINT_NOT_ELIGIBLE" | "ILLEGAL_REHEARSAL_ACTION",
    message: string,
  ) {
    super(message);
  }
}

function eligibilityRequirements(scenarioId: RecoveryRehearsalScenarioId) {
  const scenarioRequirement =
    scenarioId === "confident_misconception"
      ? "Enable confidence and tag at least one incorrect choice with a misconception key."
      : scenarioId === "split_room"
        ? "Include at least one untagged incorrect choice for the split response pattern."
        : "Include at least one incorrect choice.";
  return [
    "Use a main single-select or true/false question with a diagnostic or practice purpose.",
    "Include exactly one correct choice and complete every answer label.",
    scenarioRequirement,
  ] as const;
}

const BASE_TIME_MS = Date.UTC(2026, 0, 1, 12, 0, 0);
const SYNTHETIC_SESSION_CODE = "0000000";

function syntheticUuid(prefix: string, value: number) {
  return `${prefix}-0000-4000-8000-${String(value).padStart(12, "0")}`;
}

function isRehearsalChoiceQuestion(question: QuestionDraft): question is RehearsalChoiceQuestion {
  return question.type === "single_select" || question.type === "true_false";
}

function isCompleteChoiceQuestion(question: RehearsalChoiceQuestion) {
  return (
    question.prompt.trim().length > 0 &&
    question.choices.every((choice) => choice.label.trim().length > 0) &&
    question.choices.filter((choice) => choice.isCorrect).length === 1 &&
    question.choices.some((choice) => !choice.isCorrect)
  );
}

function linkedRecheck(
  quiz: QuizDraft,
  source: RehearsalChoiceQuestion,
): RehearsalChoiceQuestion | null {
  if (!source.linkedRecheckQuestionId) return null;
  const candidate = quiz.questions.find(
    (question) => question.id === source.linkedRecheckQuestionId,
  );
  if (
    !candidate ||
    !isRehearsalChoiceQuestion(candidate) ||
    questionDelivery(candidate) !== "recheck" ||
    questionPurpose(candidate) === "opinion" ||
    !isCompleteChoiceQuestion(candidate)
  ) {
    return null;
  }
  return candidate;
}

export function recoveryRehearsalEligibility(
  quiz: QuizDraft,
  scenarioId: RecoveryRehearsalScenarioId = "low_participation",
): RecoveryRehearsalEligibility {
  const questions: RecoveryRehearsalQuestionOption[] = [];
  for (const [questionIndex, question] of quiz.questions.entries()) {
    if (
      !isRehearsalChoiceQuestion(question) ||
      questionDelivery(question) !== "main" ||
      questionPurpose(question) === "opinion" ||
      !isCompleteChoiceQuestion(question)
    ) {
      continue;
    }
    const wrongChoice = question.choices.find((choice) => {
      if (choice.isCorrect) return false;
      const tagged = Boolean(choice.misconceptionKey?.trim());
      if (scenarioId === "confident_misconception") {
        return questionConfidence(question) !== "off" && tagged;
      }
      if (scenarioId === "split_room") return !tagged;
      return true;
    });
    if (!wrongChoice) continue;
    const linked = linkedRecheck(quiz, question);
    questions.push({
      questionId: question.id,
      questionIndex,
      prompt: question.prompt,
      wrongChoiceId: wrongChoice.id,
      wrongChoiceLabel: wrongChoice.label,
      recheckMode: linked ? "linked" : "revote",
      recheckQuestionId: linked?.id ?? question.id,
      recheckPrompt: linked?.prompt ?? question.prompt,
    });
  }
  return {
    eligible: questions.length > 0,
    questions,
    reason:
      questions.length > 0
        ? null
        : scenarioId === "confident_misconception"
          ? "Confident misconception needs a complete scored choice question with confidence enabled and a tagged wrong choice."
          : scenarioId === "split_room"
            ? "Split room needs a complete scored choice question with an untagged wrong choice."
            : "Low participation needs a complete scored choice question with at least one wrong choice.",
    requirements: eligibilityRequirements(scenarioId),
  };
}

function cloneChoiceQuestion(question: RehearsalChoiceQuestion): RehearsalChoiceQuestion {
  return {
    ...question,
    conceptKeys: question.conceptKeys ? [...question.conceptKeys] : undefined,
    choices: question.choices.map((choice) => ({ ...choice })),
    sourceCitations: question.sourceCitations?.map((citation) => ({ ...citation })),
  };
}

function scenarioById(id: RecoveryRehearsalScenarioId): RecoveryRehearsalScenario {
  const scenario = RECOVERY_REHEARSAL_SCENARIOS.find((candidate) => candidate.id === id);
  if (!scenario) throw new Error(`Unknown rehearsal scenario: ${String(id)}`);
  return scenario;
}

function confidenceForAnswer(
  question: RehearsalChoiceQuestion,
  scenario: RecoveryRehearsalScenarioId,
  correct: boolean,
): ConfidenceValue | undefined {
  if (scenario === "confident_misconception") return correct ? 2 : 3;
  return questionConfidence(question) === "required" ? 2 : undefined;
}

function participantOutcome(
  scenario: RecoveryRehearsalScenario,
  participantIndex: number,
): "correct" | "incorrect" | "no_response" {
  if (participantIndex < scenario.correctCount) return "correct";
  if (participantIndex < scenario.responseCount) return "incorrect";
  return "no_response";
}

function recommendationIntervention(insight: CheckpointInsight): {
  type: InterventionType;
  title: string;
  guidance: string;
} {
  switch (insight.recommendation.action) {
    case "wait_or_check_access":
      return {
        type: "explain",
        title: "Check access, then explain briefly",
        guidance:
          "First give the room a moment, restate how to respond, and check that every learner can see the question. After revealing, this rehearsal uses the legal Explain action as an overridable facilitator choice before collecting fresh evidence.",
      };
    case "peer_discussion":
      return {
        type: "peer_discussion",
        title: "Invite a brief peer discussion",
        guidance:
          "Ask pairs to compare reasoning without announcing the correct response, then collect new evidence.",
      };
    case "show_example":
      return {
        type: "example",
        title: "Work through one contrasting example",
        guidance:
          "Name the decision point that separates the correct response from the leading wrong response.",
      };
    case "target_misconception":
    case "explain":
    case "reinforce":
      return {
        type: "explain",
        title: "Target the reasoning, not the learner",
        guidance:
          "Explain why the tempting wrong response fails and give learners a new cue they can apply next time.",
      };
    case "continue":
      return {
        type: "break",
        title: "Make a deliberate judgment call",
        guidance:
          "Use the response pattern and your room context to decide whether a short pause or immediate recheck is useful.",
      };
  }
}

function directInsight(
  question: QuestionDraft,
  answers: readonly EngineAnswer[],
  activeParticipantCount: number,
) {
  return deriveCheckpointInsight({
    question,
    responses: answers.map((answer) => ({
      response: answer.response,
      correct: answer.correct,
      confidence: answer.confidence,
    })),
    activeParticipantCount,
  });
}

export function deriveRehearsalInsight(
  question: QuestionDraft,
  answers: readonly Pick<EngineAnswer, "response" | "correct" | "confidence">[],
  activeParticipantCount: number,
) {
  return deriveCheckpointInsight({ question, responses: [...answers], activeParticipantCount });
}

function hostSnapshot(state: GameState) {
  return snapshotForRole(state, { role: "host" });
}

export function buildRecoveryRehearsal(input: {
  quiz: QuizDraft;
  scenarioId: RecoveryRehearsalScenarioId;
  questionId?: string;
}): RecoveryRehearsalPlan {
  const scenario = scenarioById(input.scenarioId);
  const eligibility = recoveryRehearsalEligibility(input.quiz, scenario.id);
  if (!eligibility.eligible) {
    throw new RecoveryRehearsalError(
      "NO_ELIGIBLE_CHECKPOINT",
      eligibility.reason ?? "No question can be rehearsed.",
    );
  }
  const option = input.questionId
    ? eligibility.questions.find((candidate) => candidate.questionId === input.questionId)
    : eligibility.questions[0];
  if (!option) {
    throw new RecoveryRehearsalError(
      "CHECKPOINT_NOT_ELIGIBLE",
      "Choose an eligible scored choice question for this rehearsal.",
    );
  }

  const originalSource = input.quiz.questions[option.questionIndex];
  if (!originalSource || !isRehearsalChoiceQuestion(originalSource)) {
    throw new RecoveryRehearsalError(
      "CHECKPOINT_NOT_ELIGIBLE",
      "The selected question is no longer eligible.",
    );
  }
  const source = cloneChoiceQuestion(originalSource);
  const linked = linkedRecheck(input.quiz, originalSource);
  const target = linked ? cloneChoiceQuestion(linked) : source;
  const adaptations: string[] = [];

  const simulationQuiz: QuizDraft = {
    ...input.quiz,
    questions: linked ? [source, target] : [source],
  };
  let state = createGameState({
    sessionId: syntheticUuid("10000000", 1),
    code: SYNTHETIC_SESSION_CODE,
    quiz: simulationQuiz,
    settings: {
      audienceLimit: 10,
      scoringMode: "accuracy",
      resultVisibility: "private",
      allowLateJoin: false,
      nicknamePolicy: "friendly_only",
      confidenceEnabled: questionConfidence(source) !== "off",
    },
  });

  const participants = Array.from({ length: 10 }, (_, index) => ({
    id: syntheticUuid("20000000", index + 1),
    nickname: `Synthetic learner ${String(index + 1).padStart(2, "0")}`,
    score: 0,
    correctCount: 0,
    acceptedResponseMs: 0,
    connected: true,
    kicked: false,
  }));
  for (const participant of participants) {
    state = addParticipant(state, participant).state;
  }
  const lobbySnapshot = hostSnapshot(state);

  let commandSequence = 0;
  let roundSequence = 0;
  let interventionSequence = 0;
  const command = (
    action: Parameters<typeof applyHostCommand>[1]["action"],
    extras: Partial<Parameters<typeof applyHostCommand>[1]> = {},
  ) => {
    const result = applyHostCommand(state, {
      commandId: syntheticUuid("40000000", ++commandSequence),
      expectedVersion: state.version,
      action,
      nowMs: BASE_TIME_MS + commandSequence * 2_000,
      newRoundId: () => syntheticUuid("50000000", ++roundSequence),
      newInterventionId: () => syntheticUuid("60000000", ++interventionSequence),
      ...extras,
    });
    state = result.state;
  };

  command("start");
  const openSnapshot = hostSnapshot(state);
  const initialRoundId = state.roundId!;
  const correctChoice = source.choices.find((choice) => choice.isCorrect)!;
  const wrongChoice = source.choices.find((choice) => choice.id === option.wrongChoiceId)!;
  const initialAnswers: EngineAnswer[] = [];
  let answerSequence = 0;
  for (let index = 0; index < scenario.responseCount; index += 1) {
    const correct = participantOutcome(scenario, index) === "correct";
    const accepted = acceptAnswer(state, {
      answerId: syntheticUuid("30000000", ++answerSequence),
      participantId: participants[index]!.id,
      roundId: initialRoundId,
      choiceId: correct ? correctChoice.id : wrongChoice.id,
      confidence: confidenceForAnswer(source, scenario.id, correct),
      idempotencyKey: `rehearsal-initial-${index + 1}`,
      nowMs: BASE_TIME_MS + 3_000 + index * 100,
    });
    state = accepted.state;
    initialAnswers.push(accepted.answer);
  }
  const responsesSnapshot = hostSnapshot(state);
  command("lock");
  const diagnosisSnapshot = hostSnapshot(state);
  const insight = directInsight(source, initialAnswers, participants.length);
  if (diagnosisSnapshot.insight?.recommendation.code !== insight.recommendation.code) {
    throw new Error("Rehearsal insight drifted from the host engine snapshot");
  }

  const intervention = recommendationIntervention(insight);
  command("reveal");
  const revealedSnapshot = hostSnapshot(state);
  command("intervention.start", { interventionType: intervention.type });
  const interventionSnapshot = hostSnapshot(state);
  command("intervention.finish");
  const verifySnapshot = hostSnapshot(state);
  command("recheck.open", {
    recheckMode: linked ? "linked" : "revote",
    recheckQuestionId: linked?.id,
  });
  const recheckRoundId = state.roundId!;
  const recheckOpenedAtMs = state.openedAtMs!;
  const recheckQuestion = linked ?? source;
  const recheckCorrectChoice = recheckQuestion.choices.find((choice) => choice.isCorrect)!;
  const recheckWrongChoice = recheckQuestion.choices.find((choice) => !choice.isCorrect)!;
  const wrongParticipantIndexes = Array.from(
    { length: scenario.wrongCount },
    (_, index) => scenario.correctCount + index,
  );
  const recoverCount = Math.round(scenario.wrongCount * 0.75);
  const recoveredIndexes = new Set(wrongParticipantIndexes.slice(0, recoverCount));
  const recheckAnswers: EngineAnswer[] = [];
  for (let index = 0; index < scenario.responseCount; index += 1) {
    const initialOutcome = participantOutcome(scenario, index);
    const correct = initialOutcome === "correct" || recoveredIndexes.has(index);
    const accepted = acceptAnswer(state, {
      answerId: syntheticUuid("30000000", ++answerSequence),
      participantId: participants[index]!.id,
      roundId: recheckRoundId,
      choiceId: correct ? recheckCorrectChoice.id : recheckWrongChoice.id,
      confidence: questionConfidence(recheckQuestion) === "required" ? 2 : undefined,
      idempotencyKey: `rehearsal-recheck-${index + 1}`,
      nowMs: recheckOpenedAtMs + 1_000 + index * 100,
    });
    state = accepted.state;
    recheckAnswers.push(accepted.answer);
  }
  const recheckSnapshot = hostSnapshot(state);
  command("lock");
  const debriefSnapshot = hostSnapshot(state);
  const recheckInsight = directInsight(recheckQuestion, recheckAnswers, participants.length);
  if (debriefSnapshot.insight?.recommendation.code !== recheckInsight.recommendation.code) {
    throw new Error("Rehearsal recheck insight drifted from the host engine snapshot");
  }

  const participantResults: RecoveryRehearsalParticipant[] = participants.map(
    (participant, index) => {
      const initial = participantOutcome(scenario, index);
      const recheck =
        initial === "no_response"
          ? "no_response"
          : initial === "correct" || recoveredIndexes.has(index)
            ? "correct"
            : "incorrect";
      return {
        id: participant.id,
        label: participant.nickname,
        initial,
        recheck,
        recovered: initial === "incorrect" && recheck === "correct",
      };
    },
  );
  const recoveryPercent = Math.round((recoverCount / scenario.wrongCount) * 100);
  const evidenceLabel = linked ? "Linked recheck recovery" : "Revote improvement";
  const debrief: RecoveryRehearsalDebrief = {
    evidenceLabel,
    evidenceNote: linked
      ? "A different linked question provides stronger transfer evidence than repeating the same prompt."
      : "A revote shows movement on the same prompt; treat it as improvement, not independent transfer evidence.",
    initialWrongCount: scenario.wrongCount,
    recoveredCount: recoverCount,
    recoveryPercent,
    unresolvedCount: scenario.wrongCount - recoverCount,
    summary: `${recoverCount} of ${scenario.wrongCount} initially wrong synthetic learners recovered (${recoveryPercent}%).`,
    syntheticDataNote:
      "All learners, responses, confidence choices, and recovery outcomes in this rehearsal are synthetic and are never saved.",
  };

  const legalCommand = (
    snapshot: SessionSnapshot,
    matches: (candidate: HostPhaseCommand) => boolean,
  ) => {
    const view = getHostPhaseView(snapshot);
    const candidate = [view.primary, ...view.secondary].find((item): item is HostPhaseCommand =>
      Boolean(item && matches(item)),
    );
    if (!candidate || !isLegalHostPhaseCommand(view, candidate)) {
      throw new Error(`Rehearsal step has no legal host command in ${snapshot.phase}`);
    }
    return candidate;
  };

  const startCommand = legalCommand(lobbySnapshot, (candidate) => candidate.action === "start");
  const lockInitialCommand = legalCommand(
    responsesSnapshot,
    (candidate) => candidate.action === "lock",
  );
  const revealCommand = legalCommand(
    diagnosisSnapshot,
    (candidate) => candidate.action === "reveal",
  );
  const interventionCommand = legalCommand(
    revealedSnapshot,
    (candidate) =>
      candidate.action === "intervention.start" && candidate.interventionType === intervention.type,
  );
  const finishInterventionCommand = legalCommand(
    interventionSnapshot,
    (candidate) => candidate.action === "intervention.finish",
  );
  const recheckCommand = legalCommand(
    verifySnapshot,
    (candidate) =>
      candidate.action === "recheck.open" &&
      candidate.recheckMode === (linked ? "linked" : "revote"),
  );
  const lockRecheckCommand = legalCommand(
    recheckSnapshot,
    (candidate) => candidate.action === "lock",
  );

  const steps: RecoveryRehearsalStep[] = [
    {
      id: "briefing",
      eyebrow: "1 · Brief the room",
      title: `${scenario.title}: ${scenario.shortLabel}`,
      guidance:
        "Ten clearly labelled synthetic learners are ready. Nothing in this rehearsal joins or changes a live session.",
      continueLabel: startCommand.label,
      snapshot: lobbySnapshot,
      command: startCommand,
    },
    {
      id: "question_open",
      eyebrow: "2 · Ask",
      title: source.prompt,
      guidance:
        "Imagine presenting this question. The practice clock is deterministic and no real participant can enter.",
      continueLabel: "Collect synthetic responses",
      snapshot: openSnapshot,
      command: null,
    },
    {
      id: "responses",
      eyebrow: "3 · Notice",
      title: `${scenario.responseCount} of 10 synthetic learners responded`,
      guidance:
        scenario.id === "low_participation"
          ? "Four learners have not responded. Locking now will intentionally demonstrate the participation safeguard."
          : `The response pattern is ${scenario.correctCount} correct and ${scenario.wrongCount} on “${wrongChoice.label}”.`,
      continueLabel: lockInitialCommand.label,
      snapshot: responsesSnapshot,
      command: lockInitialCommand,
    },
    {
      id: "diagnosis",
      eyebrow: "4 · Diagnose",
      title: insight.recommendation.title,
      guidance: insight.recommendation.reason,
      continueLabel: revealCommand.label,
      snapshot: diagnosisSnapshot,
      command: revealCommand,
    },
    {
      id: "revealed",
      eyebrow: "5 · Choose an intervention",
      title: intervention.title,
      guidance: intervention.guidance,
      continueLabel: interventionCommand.label,
      snapshot: revealedSnapshot,
      command: interventionCommand,
    },
    {
      id: "intervention",
      eyebrow: "6 · Intervene",
      title: intervention.title,
      guidance: intervention.guidance,
      continueLabel: finishInterventionCommand.label,
      snapshot: interventionSnapshot,
      command: finishInterventionCommand,
    },
    {
      id: "verify",
      eyebrow: "7 · Verify",
      title: "Collect fresh evidence",
      guidance: linked
        ? "The authored linked recheck is ready. It asks learners to transfer the idea to a new prompt."
        : "No eligible linked recheck is available, so the legal fallback is a same-question revote.",
      continueLabel: recheckCommand.label,
      snapshot: verifySnapshot,
      command: recheckCommand,
    },
    {
      id: "recheck",
      eyebrow: "8 · Recheck",
      title: recheckQuestion.prompt,
      guidance: linked
        ? "The engine preferred the authored linked recheck. Synthetic learners now apply the idea to this new question."
        : "No eligible linked recheck was available, so the engine opened a same-question revote.",
      continueLabel: lockRecheckCommand.label,
      snapshot: recheckSnapshot,
      command: lockRecheckCommand,
    },
    {
      id: "debrief",
      eyebrow: "9 · Debrief",
      title: debrief.summary,
      guidance: debrief.evidenceNote,
      continueLabel: null,
      snapshot: debriefSnapshot,
      command: null,
    },
  ];

  return {
    scenario,
    sourceQuestion: {
      id: source.id,
      prompt: source.prompt,
      correctChoiceLabel: correctChoice.label,
      wrongChoiceLabel: wrongChoice.label,
    },
    recheck: {
      mode: linked ? "linked" : "revote",
      roundKind: linked ? "linked_recheck" : "revote",
      questionId: recheckQuestion.id,
      prompt: recheckQuestion.prompt,
      label: linked ? "Linked recheck" : "Same-question revote",
    },
    insight,
    recheckInsight,
    intervention,
    participants: participantResults,
    debrief,
    steps,
    adaptations,
  };
}

export function createRecoveryRehearsalController(
  input: Parameters<typeof buildRecoveryRehearsal>[0],
): RecoveryRehearsalController {
  const plan = buildRecoveryRehearsal(input);
  const clamp = (stepIndex: number) =>
    Math.min(Math.max(Math.trunc(stepIndex), 0), plan.steps.length - 1);
  return {
    plan,
    view(stepIndex) {
      const safeIndex = clamp(stepIndex);
      const step = plan.steps[safeIndex]!;
      return {
        step,
        stepIndex: safeIndex,
        stepCount: plan.steps.length,
        progressPercent: Math.round(((safeIndex + 1) / plan.steps.length) * 100),
        canGoBack: safeIndex > 0,
        canContinue: safeIndex < plan.steps.length - 1,
        complete: safeIndex === plan.steps.length - 1,
      };
    },
    next(stepIndex) {
      return clamp(stepIndex + 1);
    },
    previous(stepIndex) {
      return clamp(stepIndex - 1);
    },
    apply(stepIndex, command) {
      const safeIndex = clamp(stepIndex);
      const step = plan.steps[safeIndex]!;
      return createHostCommandController({
        getSnapshot: () => step.snapshot,
        execute: (candidate) => {
          if (!step.command || !sameHostPhaseCommand(step.command, candidate)) {
            throw new RecoveryRehearsalError(
              "ILLEGAL_REHEARSAL_ACTION",
              "That action is not part of this guided rehearsal step.",
            );
          }
          return clamp(safeIndex + 1);
        },
        onIllegal: () => {
          throw new RecoveryRehearsalError(
            "ILLEGAL_REHEARSAL_ACTION",
            "That action is not part of this guided rehearsal step.",
          );
        },
      }).execute(command);
    },
  };
}
