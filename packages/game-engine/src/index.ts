import {
  AvatarIdSchema,
  AVATAR_IDS,
  canonicalizeResponse,
  normalizeDecimalString,
  questionConfidence,
  questionDelivery,
  questionPurpose,
  RoundProtocolSchema,
  type RoundProtocol,
  RecoveryPackCardSelectionSchema,
  RecoveryPackLiveCardSchema,
  type BrandTheme,
  type AvatarId,
  type ConfidenceValue,
  type ExperienceThemeSnapshot,
  type HostAction,
  type InterventionType,
  type ParticipantView,
  type ParticipantQuestion,
  type PublicQuestion,
  type QuestionDraft,
  type QuizDraft,
  type RecoveryPackCardReference,
  type RecoveryPackCardSelection,
  type RecoveryPackLiveCard,
  type ResponseDistribution,
  type ResponsePayload,
  type ResolvedSessionSettings,
  type RoundKind,
  type SessionPhase,
  type SessionSettings,
  type SessionSnapshot,
} from "@openround/contracts";
import { resolveExperienceTheme } from "@openround/experience";
import { deriveCheckpointInsight } from "@openround/insights";

// Flag-off rooms retain v5/v6 readability. Protocol-aware rooms use v7 to fence old writers.
export const BASE_GAME_STATE_SCHEMA_VERSION = 5;
export const RECOVERY_PACK_GAME_STATE_SCHEMA_VERSION = 6;
export const CURRENT_GAME_STATE_SCHEMA_VERSION = 7;

/** Browser-safe stable fallback used for legacy and avatar-less participants. */
export function avatarIdForSeed(seed: string): AvatarId {
  let hash = 2_166_136_261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return AVATAR_IDS[(hash >>> 0) % AVATAR_IDS.length]!;
}

export interface EngineParticipant {
  id: string;
  nickname: string;
  /** Optional for pre-avatar persisted state. New joins are normalized before persistence. */
  avatarId?: AvatarId;
  score: number;
  correctCount: number;
  acceptedResponseMs: number;
  connected: boolean;
  kicked: boolean;
}

function participantsWithAvatars(
  participants: Record<string, EngineParticipant> | undefined,
): Record<string, EngineParticipant> {
  const source = participants ?? {};
  let normalized = source;
  for (const [id, participant] of Object.entries(source)) {
    const parsedAvatar = AvatarIdSchema.safeParse(participant.avatarId);
    if (parsedAvatar.success) continue;
    if (normalized === source) normalized = { ...source };
    normalized[id] = { ...participant, avatarId: avatarIdForSeed(participant.id || id) };
  }
  return normalized;
}

function resolvedSettings(settings: SessionSettings): ResolvedSessionSettings {
  const timeMode = settings.timeMode ?? "timed";
  return {
    ...settings,
    timeMode,
    // An untimed room cannot award a speed advantage, including when an older client still
    // submits its default speed-scoring selection at session creation.
    scoringMode: timeMode === "flex" ? "accuracy" : settings.scoringMode,
    trustMode: settings.trustMode ?? "learning",
  };
}

export interface EngineAnswer {
  answerId: string;
  participantId: string;
  roundId: string;
  response: ResponsePayload;
  confidence: ConfidenceValue | null;
  /** Retained through v1 for single-choice compatibility. */
  choiceId: string | null;
  acceptedAtMs: number;
  responseMs: number;
  score: number;
  correct: boolean;
  idempotencyKey: string;
}

export interface EngineRound {
  questionId: string;
  position: number;
  kind: RoundKind;
  sourceRoundId: string | null;
  interventionId: string | null;
  openedAtMs: number;
  deadlineMs: number | null;
  lockedAtMs: number | null;
}

export interface EngineIntervention {
  id: string;
  type: InterventionType;
  sourceRoundId: string;
  startedAtMs: number;
  finishedAtMs: number | null;
  recoveryPackCard?: RecoveryPackCardReference;
}

export interface GameState {
  stateSchemaVersion: number;
  roundProtocol?: RoundProtocol;
  uxBeta?: boolean;
  recoveryPackCardsEnabled?: boolean;
  sessionId: string;
  code: string;
  quiz: QuizDraft;
  version: number;
  seq: number;
  phase: SessionPhase;
  questionIndex: number | null;
  roundId: string | null;
  roundKind: RoundKind;
  sourceRoundId: string | null;
  openedAtMs: number | null;
  deadlineMs: number | null;
  pausedRemainingMs: number | null;
  pausedFrom: Exclude<SessionPhase, "paused"> | null;
  interventionReturnPhase: "question_locked" | "question_reveal" | null;
  intervention: EngineIntervention | null;
  interventions: Record<string, EngineIntervention>;
  lobbyLocked: boolean;
  settings: ResolvedSessionSettings;
  brandTheme: BrandTheme | null;
  experienceTheme: ExperienceThemeSnapshot;
  participants: Record<string, EngineParticipant>;
  answers: Record<string, EngineAnswer>;
  rounds: Record<string, EngineRound>;
  processedCommands: Record<string, number>;
}

export type EngineEventType =
  | "lobby.updated"
  | "question.open"
  | "question.locked"
  | "question.reveal"
  | "checkpoint.insight"
  | "intervention.updated"
  | "recheck.open"
  | "leaderboard.updated"
  | "game.finished"
  | "session.snapshot";

export interface EngineEvent {
  type: EngineEventType;
  seq: number;
}

export interface TransitionResult {
  state: GameState;
  events: EngineEvent[];
  duplicate?: boolean;
}

export class EngineError extends Error {
  constructor(
    public readonly code:
      | "STALE_VERSION"
      | "CONFLICT"
      | "NOT_FOUND"
      | "SESSION_LOCKED"
      | "ANSWER_LATE"
      | "ANSWER_INVALID",
    message: string,
  ) {
    super(message);
  }
}

function legacyAnswer(answer: Partial<EngineAnswer> & { choiceId?: string | null }): EngineAnswer {
  const choiceId = answer.choiceId ?? null;
  return {
    answerId: answer.answerId!,
    participantId: answer.participantId!,
    roundId: answer.roundId!,
    response: canonicalizeResponse(
      answer.response ?? { kind: "choice", choiceIds: choiceId ? [choiceId] : [] },
    ),
    confidence: answer.confidence ?? null,
    choiceId,
    acceptedAtMs: answer.acceptedAtMs!,
    responseMs: answer.responseMs!,
    score: answer.score!,
    correct: answer.correct!,
    idempotencyKey: answer.idempotencyKey!,
  };
}

function inferLegacyRoundOpenedAt(state: GameState, roundId: string) {
  const candidates = Object.values(state.answers ?? {})
    .filter((answer) => answer.roundId === roundId)
    .map((answer) => answer.acceptedAtMs - answer.responseMs);
  if (state.roundId === roundId && state.openedAtMs !== null) candidates.push(state.openedAtMs);
  return candidates.length > 0 ? Math.min(...candidates) : 0;
}

/** Upgrades persisted P0/P1 snapshots without rewriting completed session history. */
export function upgradeGameState(input: GameState): GameState {
  const legacy = input as GameState & {
    stateSchemaVersion?: number;
    roundKind?: RoundKind;
    sourceRoundId?: string | null;
    intervention?: EngineIntervention | null;
    interventionReturnPhase?: "question_locked" | "question_reveal" | null;
    interventions?: Record<string, EngineIntervention>;
    experienceTheme?: ExperienceThemeSnapshot;
    rounds: Record<
      string,
      EngineRound | { questionId: string; position: number; kind?: RoundKind }
    >;
  };
  if ((legacy.stateSchemaVersion ?? 1) > CURRENT_GAME_STATE_SCHEMA_VERSION) {
    throw new Error(
      `Game state schema ${legacy.stateSchemaVersion} is newer than supported schema ${CURRENT_GAME_STATE_SCHEMA_VERSION}`,
    );
  }
  if (
    (legacy.stateSchemaVersion ?? 1) < CURRENT_GAME_STATE_SCHEMA_VERSION &&
    legacy.roundProtocol !== undefined
  ) {
    throw new Error("Round protocol metadata requires game state schema 7");
  }
  const participants = participantsWithAvatars(legacy.participants);
  const settings = resolvedSettings(legacy.settings);
  if (legacy.stateSchemaVersion === CURRENT_GAME_STATE_SCHEMA_VERSION) {
    return {
      ...legacy,
      participants,
      settings,
      recoveryPackCardsEnabled: legacy.recoveryPackCardsEnabled ?? false,
      roundProtocol: RoundProtocolSchema.parse(legacy.roundProtocol),
    };
  }
  if (
    legacy.stateSchemaVersion === BASE_GAME_STATE_SCHEMA_VERSION ||
    legacy.stateSchemaVersion === RECOVERY_PACK_GAME_STATE_SCHEMA_VERSION
  ) {
    return {
      ...legacy,
      participants,
      settings,
      stateSchemaVersion: legacy.stateSchemaVersion,
      recoveryPackCardsEnabled:
        legacy.stateSchemaVersion === RECOVERY_PACK_GAME_STATE_SCHEMA_VERSION &&
        (legacy.recoveryPackCardsEnabled ?? false),
    };
  }
  const category = legacy.quiz.category ?? "general";
  const presetId = legacy.quiz.experiencePreset?.id ?? "focus";
  return {
    ...legacy,
    stateSchemaVersion: BASE_GAME_STATE_SCHEMA_VERSION,
    recoveryPackCardsEnabled: false,
    roundKind: legacy.roundKind ?? "main",
    sourceRoundId: legacy.sourceRoundId ?? null,
    intervention: legacy.intervention ?? null,
    interventionReturnPhase: legacy.interventionReturnPhase ?? null,
    interventions:
      legacy.interventions ??
      (legacy.intervention ? { [legacy.intervention.id]: legacy.intervention } : {}),
    experienceTheme:
      legacy.experienceTheme ??
      resolveExperienceTheme({ category, presetId, brandTheme: legacy.brandTheme }),
    settings,
    participants,
    answers: Object.fromEntries(
      Object.entries(legacy.answers ?? {}).map(([id, answer]) => [id, legacyAnswer(answer)]),
    ),
    rounds: Object.fromEntries(
      Object.entries(legacy.rounds ?? {}).map(([id, round]) => [
        id,
        {
          ...round,
          kind: round.kind ?? "main",
          sourceRoundId: "sourceRoundId" in round ? (round.sourceRoundId ?? null) : null,
          interventionId: "interventionId" in round ? (round.interventionId ?? null) : null,
          openedAtMs:
            "openedAtMs" in round ? (round.openedAtMs ?? 0) : inferLegacyRoundOpenedAt(legacy, id),
          deadlineMs:
            "deadlineMs" in round
              ? (round.deadlineMs ?? 0)
              : legacy.roundId === id
                ? (legacy.deadlineMs ?? 0)
                : 0,
          lockedAtMs: "lockedAtMs" in round ? (round.lockedAtMs ?? null) : null,
        },
      ]),
    ),
  };
}

export function createGameState(input: {
  sessionId: string;
  code: string;
  quiz: QuizDraft;
  settings: SessionSettings;
  brandTheme?: BrandTheme | null;
  experienceTheme?: ExperienceThemeSnapshot;
  uxBeta?: boolean;
  recoveryPackCardsEnabled?: boolean;
  roundProtocol?: RoundProtocol;
}): GameState {
  const brandTheme = input.brandTheme ?? null;
  return {
    stateSchemaVersion: input.roundProtocol
      ? CURRENT_GAME_STATE_SCHEMA_VERSION
      : input.recoveryPackCardsEnabled
        ? RECOVERY_PACK_GAME_STATE_SCHEMA_VERSION
        : BASE_GAME_STATE_SCHEMA_VERSION,
    ...(input.roundProtocol
      ? { roundProtocol: RoundProtocolSchema.parse(input.roundProtocol) }
      : {}),
    uxBeta: input.uxBeta,
    recoveryPackCardsEnabled: input.recoveryPackCardsEnabled ?? false,
    sessionId: input.sessionId,
    code: input.code,
    quiz: input.quiz,
    version: 0,
    seq: 0,
    phase: "lobby",
    questionIndex: null,
    roundId: null,
    roundKind: "main",
    sourceRoundId: null,
    openedAtMs: null,
    deadlineMs: null,
    pausedRemainingMs: null,
    pausedFrom: null,
    interventionReturnPhase: null,
    intervention: null,
    interventions: {},
    lobbyLocked: false,
    settings: resolvedSettings(input.settings),
    brandTheme,
    experienceTheme:
      input.experienceTheme ??
      resolveExperienceTheme({
        category: input.quiz.category ?? "general",
        presetId: input.quiz.experiencePreset?.id,
        brandTheme,
      }),
    participants: {},
    answers: {},
    rounds: {},
    processedCommands: {},
  };
}

export function calculateScore(input: {
  correct: boolean;
  basePoints: number;
  elapsedMs: number;
  limitMs: number;
  mode: SessionSettings["scoringMode"];
}): number {
  if (!input.correct) return 0;
  if (input.mode === "accuracy") return input.basePoints;
  const remainingFraction = Math.max(0, 1 - input.elapsedMs / input.limitMs);
  return Math.round(input.basePoints * (0.6 + 0.4 * remainingFraction));
}

function nextState(
  state: GameState,
  patch: Partial<GameState>,
  eventTypes: EngineEventType[],
): TransitionResult {
  const version = state.version + 1;
  let seq = state.seq;
  const events = eventTypes.map((type) => ({ type, seq: ++seq }));
  return { state: { ...state, ...patch, version, seq }, events };
}

function isChoiceQuestion(
  question: QuestionDraft,
): question is Extract<
  QuestionDraft,
  { type: "single_select" | "true_false" | "multi_select" | "poll" }
> {
  return ["single_select", "true_false", "multi_select", "poll"].includes(question.type);
}

export function responseDistributionFor(
  question: QuestionDraft | undefined,
  answers: ReadonlyArray<Pick<EngineAnswer, "response" | "correct">>,
): ResponseDistribution | undefined {
  if (!question || answers.length < 5) return undefined;
  const percent = (count: number) => Math.round((count / answers.length) * 10_000) / 100;
  if (isChoiceQuestion(question)) {
    const counts = new Map<string, number>();
    for (const answer of answers) {
      if (answer.response.kind !== "choice" && answer.response.kind !== "poll") continue;
      for (const choiceId of answer.response.choiceIds) {
        counts.set(choiceId, (counts.get(choiceId) ?? 0) + 1);
      }
    }
    const totalSelections = [...counts.values()].reduce((sum, count) => sum + count, 0);
    return {
      kind: "choice",
      respondents: answers.length,
      totalSelections,
      percentBasis: question.type === "multi_select" ? "respondents" : "responses",
      buckets: question.choices.map((choice) => ({
        value: choice.id,
        label: choice.label,
        count: counts.get(choice.id) ?? 0,
        percent: percent(counts.get(choice.id) ?? 0),
      })),
    };
  }
  if (question.type === "rating") {
    const counts = new Map<number, number>();
    for (const answer of answers) {
      if (answer.response.kind === "rating") {
        counts.set(answer.response.value, (counts.get(answer.response.value) ?? 0) + 1);
      }
    }
    return {
      kind: "rating",
      respondents: answers.length,
      buckets: Array.from({ length: question.max - question.min + 1 }, (_, index) => {
        const value = question.min + index;
        const count = counts.get(value) ?? 0;
        return { value: String(value), label: String(value), count, percent: percent(count) };
      }),
    };
  }
  const correct = answers.filter((answer) => answer.correct).length;
  return {
    kind: "numeric",
    respondents: answers.length,
    correct,
    incorrect: answers.length - correct,
  };
}

function distributionFor(
  state: GameState,
  question: QuestionDraft | undefined,
): ResponseDistribution | undefined {
  if (!state.roundId) return undefined;
  return responseDistributionFor(
    question,
    Object.values(state.answers).filter((answer) => answer.roundId === state.roundId),
  );
}

function nextMainQuestionIndex(quiz: QuizDraft, afterIndex: number) {
  for (let index = afterIndex + 1; index < quiz.questions.length; index += 1) {
    if (questionDelivery(quiz.questions[index]!) === "main") return index;
  }
  return null;
}

function mainQuestionPosition(quiz: QuizDraft, questionIndex: number | null) {
  if (questionIndex === null) return null;
  let position = 0;
  for (let index = 0; index < quiz.questions.length; index += 1) {
    if (questionDelivery(quiz.questions[index]!) !== "main") continue;
    if (index === questionIndex) return position;
    position += 1;
  }
  return null;
}

function openQuestion(
  state: GameState,
  index: number,
  nowMs: number,
  roundId: string,
  kind: RoundKind = "main",
  sourceRoundId: string | null = null,
  interventionId: string | null = null,
) {
  const question = state.quiz.questions[index];
  if (!question) throw new EngineError("NOT_FOUND", "Checkpoint does not exist");
  const deadlineMs =
    state.settings.timeMode === "flex" ? null : nowMs + question.timeLimitSeconds * 1_000;
  return nextState(
    state,
    {
      phase: "question_open",
      questionIndex: index,
      roundId,
      roundKind: kind,
      sourceRoundId,
      openedAtMs: nowMs,
      deadlineMs,
      pausedRemainingMs: null,
      pausedFrom: null,
      interventionReturnPhase: null,
      intervention: kind === "main" ? null : state.intervention,
      answers: {},
      rounds: {
        ...state.rounds,
        [roundId]: {
          questionId: question.id,
          position: index,
          kind,
          sourceRoundId,
          interventionId,
          openedAtMs: nowMs,
          deadlineMs,
          lockedAtMs: null,
        },
      },
    },
    kind === "main" ? ["question.open"] : ["recheck.open", "question.open"],
  );
}

/** Resolve only the accepted immutable snapshot, never the current source Pack publication. */
function frozenRecoveryPackCards(state: GameState): RecoveryPackLiveCard[] {
  const question =
    state.questionIndex === null ? undefined : state.quiz.questions[state.questionIndex];
  if (
    !state.recoveryPackCardsEnabled ||
    state.roundKind !== "main" ||
    !question ||
    questionDelivery(question) !== "main" ||
    questionPurpose(question) !== "diagnostic" ||
    state.quiz.questions.filter((item) => item.id === question.id).length !== 1
  )
    return [];
  const insertions = state.quiz.recoveryPackInsertions ?? [];
  const owners = insertions.filter((insertion) => insertion.diagnosticQuestionId === question.id);
  if (owners.length !== 1) return [];
  if (
    insertions
      .flatMap((insertion) => [insertion.diagnosticQuestionId, insertion.recheckQuestionId])
      .filter((id) => id === question.id).length !== 1
  )
    return [];
  const insertion = owners[0]!;
  if (insertions.filter((item) => item.id === insertion.id).length !== 1) return [];
  const baseline = insertion.updateBaseline ?? {
    packVersionId: insertion.packVersionId,
    packVersion: insertion.packVersion,
    contentHash: insertion.contentHash,
    content: insertion.originalContent,
  };
  const cards = baseline.content.interventions;
  if (cards.length > 5 || new Set(cards.map((card) => card.id)).size !== cards.length) return [];
  const result = cards.map((card) =>
    RecoveryPackLiveCardSchema.safeParse({
      reference: {
        insertionId: insertion.id,
        packId: insertion.packId,
        packVersionId: baseline.packVersionId,
        packVersion: baseline.packVersion,
        contentHash: baseline.contentHash,
        cardId: card.id,
      },
      title: card.title,
      body: card.body,
      citations: card.citations,
    }),
  );
  return result.every((item) => item.success) ? result.map((item) => item.data!) : [];
}

function sameRecoveryPackCardReference(
  left: RecoveryPackCardReference,
  right: RecoveryPackCardReference,
) {
  return (
    left.insertionId === right.insertionId &&
    left.packId === right.packId &&
    left.packVersionId === right.packVersionId &&
    left.packVersion === right.packVersion &&
    left.contentHash === right.contentHash &&
    left.cardId === right.cardId
  );
}

export function applyHostCommand(
  state: GameState,
  input: {
    commandId: string;
    expectedVersion: number;
    action: HostAction;
    participantId?: string;
    interventionType?: InterventionType;
    recheckMode?: "linked" | "revote";
    recheckQuestionId?: string;
    recoveryPackCard?: RecoveryPackCardSelection;
    nowMs: number;
    newRoundId: () => string;
    newInterventionId?: () => string;
  },
): TransitionResult {
  state = upgradeGameState(state);
  if (state.processedCommands[input.commandId] !== undefined) {
    return { state, events: [], duplicate: true };
  }
  if (input.expectedVersion !== state.version) {
    throw new EngineError("STALE_VERSION", "Session state changed; synchronize and retry");
  }
  if (
    input.recoveryPackCard &&
    (!RecoveryPackCardSelectionSchema.safeParse(input.recoveryPackCard).success ||
      input.action !== "intervention.start" ||
      (input.interventionType !== "explain" && input.interventionType !== "example"))
  ) {
    throw new EngineError(
      "CONFLICT",
      "Recovery Pack cards require an explanation or example intervention",
    );
  }

  let result: TransitionResult;
  switch (input.action) {
    case "start": {
      const firstIndex = nextMainQuestionIndex(state.quiz, -1);
      if (state.phase !== "lobby" || firstIndex === null) {
        throw new EngineError("CONFLICT", "The session cannot start from its current state");
      }
      result = openQuestion(state, firstIndex, input.nowMs, input.newRoundId());
      break;
    }
    case "pause": {
      if (state.phase !== "question_open") {
        throw new EngineError("CONFLICT", "Only an open checkpoint can be paused");
      }
      if (state.settings.timeMode === "timed" && state.deadlineMs === null) {
        throw new EngineError("CONFLICT", "The timed checkpoint has no deadline");
      }
      result = nextState(
        state,
        {
          phase: "paused",
          pausedFrom: "question_open",
          pausedRemainingMs:
            state.deadlineMs === null ? null : Math.max(0, state.deadlineMs - input.nowMs),
          deadlineMs: null,
        },
        ["session.snapshot"],
      );
      break;
    }
    case "resume": {
      if (
        state.phase !== "paused" ||
        (state.settings.timeMode === "timed" && state.pausedRemainingMs === null)
      ) {
        throw new EngineError("CONFLICT", "The session is not paused");
      }
      const deadlineMs =
        state.settings.timeMode === "flex" ? null : input.nowMs + state.pausedRemainingMs!;
      result = nextState(
        state,
        {
          phase: state.pausedFrom ?? "question_open",
          deadlineMs,
          pausedRemainingMs: null,
          pausedFrom: null,
          rounds: state.roundId
            ? {
                ...state.rounds,
                [state.roundId]: { ...state.rounds[state.roundId]!, deadlineMs },
              }
            : state.rounds,
        },
        ["session.snapshot"],
      );
      break;
    }
    case "lock":
      if (state.phase !== "question_open" && state.phase !== "paused") {
        throw new EngineError("CONFLICT", "Only an active checkpoint can be locked");
      }
      result = nextState(
        state,
        {
          phase: "question_locked",
          deadlineMs: null,
          pausedRemainingMs: null,
          pausedFrom: null,
          rounds: state.roundId
            ? {
                ...state.rounds,
                [state.roundId]: {
                  ...state.rounds[state.roundId]!,
                  lockedAtMs: input.nowMs,
                },
              }
            : state.rounds,
        },
        ["question.locked", "checkpoint.insight"],
      );
      break;
    case "reveal":
      if (state.phase !== "question_locked") {
        throw new EngineError("CONFLICT", "Lock the checkpoint before revealing the answer");
      }
      result = nextState(state, { phase: "question_reveal" }, ["question.reveal"]);
      break;
    case "intervention.start": {
      const interventionType = input.interventionType;
      if (!interventionType || state.roundId === null) {
        throw new EngineError("CONFLICT", "Choose an intervention for an active checkpoint");
      }
      if (state.intervention && state.intervention.finishedAtMs === null) {
        throw new EngineError("CONFLICT", "Finish the active intervention first");
      }
      const beforeReveal = interventionType === "peer_discussion";
      if (
        (beforeReveal && state.phase !== "question_locked") ||
        (!beforeReveal && interventionType !== "break" && state.phase !== "question_reveal") ||
        (interventionType === "break" &&
          state.phase !== "question_locked" &&
          state.phase !== "question_reveal")
      ) {
        throw new EngineError(
          "CONFLICT",
          beforeReveal
            ? "Peer discussion starts after locking and before reveal"
            : "This intervention starts after revealing the answer",
        );
      }
      const returnPhase = state.phase as "question_locked" | "question_reveal";
      const selectedCard = input.recoveryPackCard
        ? frozenRecoveryPackCards(state).find(
            (card) =>
              card.reference.insertionId === input.recoveryPackCard!.insertionId &&
              card.reference.cardId === input.recoveryPackCard!.cardId,
          )
        : undefined;
      if (input.recoveryPackCard && !selectedCard) {
        throw new EngineError(
          "CONFLICT",
          "This Recovery Pack card is not available for the current diagnostic",
        );
      }
      const activeIntervention: EngineIntervention = {
        id: (input.newInterventionId ?? input.newRoundId)(),
        type: interventionType,
        sourceRoundId: state.roundId,
        startedAtMs: input.nowMs,
        finishedAtMs: null,
        ...(selectedCard ? { recoveryPackCard: selectedCard.reference } : {}),
      };
      result = nextState(
        state,
        {
          phase: "intervention",
          interventionReturnPhase: returnPhase,
          intervention: activeIntervention,
          interventions: {
            ...state.interventions,
            [activeIntervention.id]: activeIntervention,
          },
        },
        ["intervention.updated"],
      );
      break;
    }
    case "intervention.finish": {
      if (
        state.phase !== "intervention" ||
        !state.intervention ||
        state.intervention.finishedAtMs !== null ||
        !state.interventionReturnPhase
      ) {
        throw new EngineError("CONFLICT", "There is no active intervention to finish");
      }
      const finishedIntervention = { ...state.intervention, finishedAtMs: input.nowMs };
      result = nextState(
        state,
        {
          phase: state.interventionReturnPhase,
          interventionReturnPhase: null,
          intervention: finishedIntervention,
          interventions: {
            ...state.interventions,
            [finishedIntervention.id]: finishedIntervention,
          },
        },
        ["intervention.updated", "checkpoint.insight"],
      );
      break;
    }
    case "recheck.open": {
      if (
        (state.phase !== "question_locked" && state.phase !== "question_reveal") ||
        state.questionIndex === null ||
        state.roundId === null ||
        state.roundKind !== "main"
      ) {
        throw new EngineError("CONFLICT", "A recheck can only follow a locked main checkpoint");
      }
      const sourceQuestion = state.quiz.questions[state.questionIndex]!;
      const mode = input.recheckMode;
      if (!mode) throw new EngineError("CONFLICT", "Choose a linked recheck or revote");
      let targetIndex = state.questionIndex;
      let kind: RoundKind = "revote";
      if (mode === "linked") {
        const targetId = input.recheckQuestionId ?? sourceQuestion.linkedRecheckQuestionId;
        targetIndex = state.quiz.questions.findIndex((question) => question.id === targetId);
        const target = state.quiz.questions[targetIndex];
        if (!target || questionDelivery(target) !== "recheck") {
          throw new EngineError("NOT_FOUND", "The linked recheck checkpoint was not found");
        }
        kind = "linked_recheck";
      }
      result = openQuestion(
        state,
        targetIndex,
        input.nowMs,
        input.newRoundId(),
        kind,
        state.roundId,
        state.intervention?.id ?? null,
      );
      break;
    }
    case "show_leaderboard":
      if (state.phase !== "question_reveal") {
        throw new EngineError("CONFLICT", "Reveal the answer before showing the leaderboard");
      }
      result = nextState(state, { phase: "leaderboard" }, ["leaderboard.updated"]);
      break;
    case "next": {
      if (state.phase !== "question_reveal" && state.phase !== "leaderboard") {
        throw new EngineError("CONFLICT", "Finish the current checkpoint before advancing");
      }
      const sourcePosition =
        state.roundKind === "main"
          ? (state.questionIndex ?? -1)
          : ((state.sourceRoundId ? state.rounds[state.sourceRoundId]?.position : undefined) ??
            state.questionIndex ??
            -1);
      const nextIndex = nextMainQuestionIndex(state.quiz, sourcePosition);
      result =
        nextIndex === null
          ? nextState(state, { phase: "finished", deadlineMs: null, answers: {} }, [
              "game.finished",
            ])
          : openQuestion(state, nextIndex, input.nowMs, input.newRoundId());
      break;
    }
    case "end":
      if (state.phase === "finished") {
        throw new EngineError("CONFLICT", "The session has already finished");
      }
      result = nextState(state, { phase: "finished", deadlineMs: null, answers: {} }, [
        "game.finished",
      ]);
      break;
    case "lock_lobby":
      result = nextState(state, { lobbyLocked: true }, ["lobby.updated"]);
      break;
    case "unlock_lobby":
      result = nextState(state, { lobbyLocked: false }, ["lobby.updated"]);
      break;
    case "kick": {
      if (state.phase === "finished") {
        throw new EngineError("CONFLICT", "A finished session cannot be changed");
      }
      const participant = input.participantId ? state.participants[input.participantId] : undefined;
      if (!participant || participant.kicked) {
        throw new EngineError("NOT_FOUND", "Participant not found");
      }
      result = nextState(
        state,
        {
          participants: {
            ...state.participants,
            [participant.id]: { ...participant, connected: false, kicked: true },
          },
        },
        ["lobby.updated"],
      );
      break;
    }
    default: {
      const exhaustive: never = input.action;
      throw new EngineError("CONFLICT", `Unsupported command: ${String(exhaustive)}`);
    }
  }

  result.state.processedCommands = {
    ...result.state.processedCommands,
    [input.commandId]: result.state.version,
  };
  return result;
}

export function addParticipant(state: GameState, participant: EngineParticipant): TransitionResult {
  state = upgradeGameState(state);
  if (state.lobbyLocked) throw new EngineError("SESSION_LOCKED", "The lobby is locked");
  const existing = state.participants[participant.id];
  const normalizedParticipant = {
    ...participant,
    avatarId: participant.avatarId ?? avatarIdForSeed(participant.id),
  };
  return nextState(
    state,
    {
      participants: {
        ...state.participants,
        [participant.id]: existing ? { ...existing, connected: true } : normalizedParticipant,
      },
    },
    ["lobby.updated"],
  );
}

export function setParticipantConnection(
  state: GameState,
  participantId: string,
  connected: boolean,
): TransitionResult {
  state = upgradeGameState(state);
  const participant = state.participants[participantId];
  if (!participant) throw new EngineError("NOT_FOUND", "Participant not found");
  return nextState(
    state,
    {
      participants: {
        ...state.participants,
        [participantId]: { ...participant, connected },
      },
    },
    ["lobby.updated"],
  );
}

function decimalParts(value: string) {
  const normalized = normalizeDecimalString(value);
  const negative = normalized.startsWith("-");
  const unsigned = negative ? normalized.slice(1) : normalized;
  const [whole, fraction = ""] = unsigned.split(".");
  const amount = BigInt(`${whole}${fraction}` || "0") * (negative ? -1n : 1n);
  return { amount, scale: fraction.length };
}

function decimalWithinTolerance(actual: string, expected: string, tolerance: string) {
  const values = [decimalParts(actual), decimalParts(expected), decimalParts(tolerance)];
  const scale = Math.max(...values.map((value) => value.scale));
  const scaled = values.map((value) => value.amount * 10n ** BigInt(scale - value.scale));
  const difference = scaled[0]! >= scaled[1]! ? scaled[0]! - scaled[1]! : scaled[1]! - scaled[0]!;
  return difference <= scaled[2]!;
}

export function evaluateResponse(question: QuestionDraft, response: ResponsePayload) {
  const canonical = canonicalizeResponse(response);
  if (isChoiceQuestion(question)) {
    const expectedKind = question.type === "poll" ? "poll" : "choice";
    if (canonical.kind !== expectedKind) {
      throw new EngineError("ANSWER_INVALID", "Response type does not match the checkpoint");
    }
    const selected = canonical.choiceIds;
    const choicesById = new Map(question.choices.map((choice) => [choice.id, choice]));
    if (selected.some((id) => !choicesById.has(id))) {
      throw new EngineError("ANSWER_INVALID", "Choice not found");
    }
    if (question.type !== "multi_select" && selected.length !== 1) {
      throw new EngineError("ANSWER_INVALID", "Select exactly one choice");
    }
    if (question.type === "poll") {
      return { response: canonical, correct: false, choiceId: selected[0] ?? null };
    }
    const correctIds = question.choices
      .filter((choice) => choice.isCorrect)
      .map((choice) => choice.id)
      .sort();
    const correct =
      selected.length === correctIds.length &&
      selected.every((id, index) => id === correctIds[index]);
    return {
      response: canonical,
      correct,
      choiceId: selected.length === 1 ? selected[0]! : null,
    };
  }
  if (question.type === "numeric") {
    if (canonical.kind !== "numeric") {
      throw new EngineError("ANSWER_INVALID", "Enter a numeric response");
    }
    const expectedUnit = question.unit?.trim().toLocaleLowerCase("en-CA") ?? "";
    const actualUnit = canonical.unit?.trim().toLocaleLowerCase("en-CA") ?? "";
    if (expectedUnit && expectedUnit !== actualUnit) {
      throw new EngineError("ANSWER_INVALID", `Use the expected unit: ${question.unit}`);
    }
    return {
      response: canonical,
      correct: decimalWithinTolerance(canonical.value, question.correctValue, question.tolerance),
      choiceId: null,
    };
  }
  if (
    canonical.kind !== "rating" ||
    canonical.value < question.min ||
    canonical.value > question.max
  ) {
    throw new EngineError("ANSWER_INVALID", "Rating is outside the configured range");
  }
  return { response: canonical, correct: false, choiceId: null };
}

export function acceptAnswer(
  state: GameState,
  input: {
    answerId: string;
    participantId: string;
    roundId: string;
    response?: ResponsePayload;
    choiceId?: string;
    confidence?: ConfidenceValue;
    idempotencyKey: string;
    nowMs: number;
  },
): { state: GameState; answer: EngineAnswer } {
  state = upgradeGameState(state);
  const duplicate = Object.values(state.answers).find(
    (answer) => answer.idempotencyKey === input.idempotencyKey,
  );
  if (duplicate) return { state, answer: duplicate };
  if (
    state.phase !== "question_open" ||
    !state.roundId ||
    state.roundId !== input.roundId ||
    (state.settings.timeMode === "timed" && state.deadlineMs === null) ||
    state.openedAtMs === null
  ) {
    throw new EngineError("CONFLICT", "The checkpoint is not accepting responses");
  }
  if (state.deadlineMs !== null && input.nowMs > state.deadlineMs) {
    throw new EngineError("ANSWER_LATE", "The response arrived after the server deadline");
  }
  const participant = state.participants[input.participantId];
  if (!participant || participant.kicked) {
    throw new EngineError("NOT_FOUND", "Participant not found");
  }
  const prior = Object.values(state.answers).find(
    (answer) => answer.participantId === input.participantId && answer.roundId === input.roundId,
  );
  if (prior) return { state, answer: prior };
  const question = state.quiz.questions[state.questionIndex ?? -1];
  if (!question) throw new EngineError("NOT_FOUND", "Checkpoint not found");
  const confidenceMode = questionConfidence(question);
  if (confidenceMode === "required" && input.confidence === undefined) {
    throw new EngineError("ANSWER_INVALID", "Select a confidence level");
  }
  if (confidenceMode === "off" && input.confidence !== undefined) {
    throw new EngineError("ANSWER_INVALID", "This checkpoint does not collect confidence");
  }
  const evaluated = evaluateResponse(
    question,
    input.response ?? { kind: "choice", choiceIds: input.choiceId ? [input.choiceId] : [] },
  );
  const responseMs = Math.max(0, input.nowMs - state.openedAtMs);
  const scored =
    state.roundKind === "main" &&
    questionPurpose(question) !== "opinion" &&
    question.type !== "poll" &&
    question.type !== "rating";
  const score = scored
    ? calculateScore({
        correct: evaluated.correct,
        basePoints: question.basePoints,
        elapsedMs: responseMs,
        limitMs: question.timeLimitSeconds * 1_000,
        mode: state.settings.scoringMode,
      })
    : 0;
  const answer: EngineAnswer = {
    answerId: input.answerId,
    participantId: input.participantId,
    roundId: input.roundId,
    response: evaluated.response,
    confidence: input.confidence ?? null,
    choiceId: evaluated.choiceId,
    acceptedAtMs: input.nowMs,
    responseMs,
    score,
    correct: evaluated.correct,
    idempotencyKey: input.idempotencyKey,
  };
  return {
    answer,
    state: {
      ...state,
      version: state.version + 1,
      seq: state.seq + 1,
      answers: { ...state.answers, [answer.answerId]: answer },
      participants: {
        ...state.participants,
        [participant.id]: {
          ...participant,
          score: participant.score + score,
          correctCount: participant.correctCount + (scored && evaluated.correct ? 1 : 0),
          acceptedResponseMs: participant.acceptedResponseMs + (scored ? responseMs : 0),
        },
      },
    },
  };
}

export function leaderboard(state: GameState): ParticipantView[] {
  const sorted = Object.values(state.participants)
    .filter((participant) => !participant.kicked)
    .sort(
      (a, b) =>
        b.score - a.score ||
        b.correctCount - a.correctCount ||
        (state.settings.timeMode === "flex" ? 0 : a.acceptedResponseMs - b.acceptedResponseMs) ||
        a.id.localeCompare(b.id),
    );
  return sorted.map((participant, index) => ({
    id: participant.id,
    nickname: participant.nickname,
    avatarId: participant.avatarId ?? avatarIdForSeed(participant.id),
    score: participant.score,
    connected: participant.connected,
    rank: index + 1,
  }));
}

function sharedQuestion(question: QuestionDraft): ParticipantQuestion {
  const common = {
    id: question.id,
    type: question.type,
    prompt: question.prompt,
    confidence: questionConfidence(question),
    timeLimitSeconds: question.timeLimitSeconds,
    basePoints: question.basePoints,
    mediaId: question.mediaId,
    mediaAlt: question.mediaAlt,
  };
  if (isChoiceQuestion(question)) {
    return {
      ...common,
      choices: question.choices.map(({ id, label }) => ({ id, label })),
    };
  }
  if (question.type === "numeric") {
    return { ...common, choices: [], unit: question.unit };
  }
  return {
    ...common,
    choices: [],
    rating: {
      min: question.min,
      max: question.max,
      minLabel: question.minLabel,
      maxLabel: question.maxLabel,
    },
  };
}

/** Learner-safe question projection for live Round snapshots. */
export function participantQuestion(
  question: QuestionDraft | undefined,
): ParticipantQuestion | null {
  return question ? sharedQuestion(question) : null;
}

/** Facilitator question projection. Kept as the legacy publicQuestion API for follow-ups. */
export function publicQuestion(question: QuestionDraft | undefined): PublicQuestion | null {
  if (!question) return null;
  return {
    ...sharedQuestion(question),
    purpose: questionPurpose(question),
    linkedRecheckAvailable: Boolean(question.linkedRecheckQuestionId),
  };
}

export function correctResponse(question: QuestionDraft | undefined): ResponsePayload | null {
  if (!question || question.type === "poll" || question.type === "rating") return null;
  if (isChoiceQuestion(question)) {
    return {
      kind: "choice",
      choiceIds: question.choices
        .filter((choice) => choice.isCorrect)
        .map((choice) => choice.id)
        .sort(),
    };
  }
  return {
    kind: "numeric",
    value: normalizeDecimalString(question.correctValue),
    unit: question.unit ?? undefined,
  };
}

export function snapshotForRole(
  inputState: GameState,
  options: { role: "host" | "participant" | "presenter"; participantId?: string },
): SessionSnapshot {
  const state = upgradeGameState(inputState);
  const question =
    state.questionIndex === null ? undefined : state.quiz.questions[state.questionIndex];
  const visibleParticipants = leaderboard(state).map((participant) => ({
    ...participant,
    avatarId:
      state.settings.resultVisibility === "private" &&
      options.role === "participant" &&
      participant.id !== options.participantId
        ? undefined
        : participant.avatarId,
    nickname:
      state.settings.resultVisibility === "private" && options.role === "participant"
        ? participant.id === options.participantId
          ? participant.nickname
          : "Participant"
        : participant.nickname,
    score:
      state.settings.resultVisibility === "private" &&
      options.role === "participant" &&
      participant.id !== options.participantId
        ? 0
        : participant.score,
    rank:
      state.settings.resultVisibility === "private" &&
      options.role === "participant" &&
      participant.id !== options.participantId
        ? null
        : participant.rank,
  }));
  const participantAnswer = Object.values(state.answers).find(
    (answer) => answer.participantId === options.participantId && answer.roundId === state.roundId,
  );
  const revealed =
    state.phase === "question_reveal" ||
    state.phase === "leaderboard" ||
    state.phase === "finished" ||
    (state.phase === "intervention" && state.interventionReturnPhase === "question_reveal");
  const sourceQuestionIndex =
    state.roundKind === "main"
      ? state.questionIndex
      : ((state.sourceRoundId ? state.rounds[state.sourceRoundId]?.position : undefined) ?? null);
  const expected = options.role === "host" && revealed ? correctResponse(question) : undefined;
  const selectedFeedback =
    revealed && participantAnswer && question && isChoiceQuestion(question)
      ? (question.choices.find((choice) => choice.id === participantAnswer.choiceId)?.feedback ??
        null)
      : undefined;
  const insightVisible =
    options.role !== "participant" &&
    question &&
    state.phase !== "lobby" &&
    state.phase !== "question_open" &&
    state.phase !== "paused";
  const recoveryPackCards = frozenRecoveryPackCards(state);
  const activeRecoveryPackCard =
    state.phase === "intervention" &&
    state.interventionReturnPhase === "question_reveal" &&
    state.intervention?.finishedAtMs === null &&
    state.intervention.sourceRoundId === state.roundId &&
    (state.intervention.type === "explain" || state.intervention.type === "example") &&
    state.intervention.recoveryPackCard
      ? recoveryPackCards.find((card) =>
          sameRecoveryPackCardReference(card.reference, state.intervention!.recoveryPackCard!),
        )
      : undefined;
  return {
    mode: "live",
    uxBeta: state.uxBeta ?? false,
    stateSchemaVersion: state.stateSchemaVersion,
    ...(state.roundProtocol ? { roundProtocol: state.roundProtocol } : {}),
    sessionId: state.sessionId,
    code: state.code,
    version: state.version,
    seq: state.seq,
    phase: state.phase,
    answerRevealed: revealed,
    roundId: state.roundId,
    roundKind: state.roundKind,
    sourceRoundId: state.sourceRoundId,
    questionIndex: state.questionIndex,
    questionPosition: mainQuestionPosition(state.quiz, sourceQuestionIndex),
    questionCount: state.quiz.questions.filter((item) => questionDelivery(item) === "main").length,
    question:
      options.role === "participant" ? participantQuestion(question) : publicQuestion(question),
    deadline: state.deadlineMs ? new Date(state.deadlineMs).toISOString() : null,
    participants: visibleParticipants,
    answerCount: Object.values(state.answers).filter((answer) => answer.roundId === state.roundId)
      .length,
    lobbyLocked: state.lobbyLocked,
    settings: state.settings,
    brandTheme: state.brandTheme ?? null,
    experienceTheme: state.experienceTheme,
    pausedRemainingMs: state.pausedRemainingMs,
    myParticipantId: options.participantId ?? null,
    myAnswerChoiceId: participantAnswer?.choiceId ?? null,
    myResponse: participantAnswer?.response ?? null,
    myConfidence: participantAnswer?.confidence ?? null,
    myCorrect: revealed ? (participantAnswer?.correct ?? null) : undefined,
    ...(options.role === "host" && revealed
      ? {
          correctChoiceId:
            expected?.kind === "choice" && expected.choiceIds.length === 1
              ? expected.choiceIds[0]!
              : null,
          correctResponse: expected ?? null,
        }
      : {}),
    explanation: revealed ? (question?.explanation ?? "") : undefined,
    feedback: selectedFeedback,
    intervention: state.intervention
      ? {
          id: state.intervention.id,
          type: state.intervention.type,
          sourceRoundId: state.intervention.sourceRoundId,
          startedAt: new Date(state.intervention.startedAtMs).toISOString(),
          finishedAt:
            state.intervention.finishedAtMs === null
              ? null
              : new Date(state.intervention.finishedAtMs).toISOString(),
          ...(state.intervention.recoveryPackCard
            ? { recoveryPackCard: state.intervention.recoveryPackCard }
            : {}),
        }
      : null,
    insight: insightVisible
      ? deriveCheckpointInsight({
          question,
          responses: Object.values(state.answers)
            .filter((answer) => answer.roundId === state.roundId)
            .map((answer) => ({
              response: answer.response,
              correct: answer.correct,
              confidence: answer.confidence,
            })),
          activeParticipantCount: Object.values(state.participants).filter(
            (participant) => !participant.kicked,
          ).length,
        })
      : undefined,
    responseDistribution:
      options.role !== "participant" && insightVisible
        ? distributionFor(state, question)
        : undefined,
    ...(options.role === "host" && state.phase === "question_reveal" && recoveryPackCards.length > 0
      ? { recoveryPackCards }
      : {}),
    ...(activeRecoveryPackCard ? { recoveryPackCard: activeRecoveryPackCard } : {}),
  };
}
