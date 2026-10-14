import {
  normalizeTextResponse,
  type RoundResponseModerationPage,
  type RoundTextResponseResults,
} from "@openround/contracts";
import {
  approvedTextResponseDistribution,
  isApprovedTextAnswer,
  type EngineAnswer,
  type GameState,
} from "@openround/game-engine";

export class TextResponseReadError extends Error {
  constructor(
    public readonly code: "CONFLICT" | "NOT_FOUND",
    message: string,
  ) {
    super(message);
  }
}

export interface TextResponsePageQuery {
  limit: number;
  cursor?: string;
}
export interface TextModerationPageQuery extends TextResponsePageQuery {
  status: "pending" | "approved" | "removed";
  roundId?: string;
}

type Metadata = NonNullable<GameState["responseModeration"]>[string] & { answerId: string };

function pageStart(state: GameState, query: TextResponsePageQuery, scope: string) {
  if (!Number.isInteger(query.limit) || query.limit < 1 || query.limit > 50)
    throw new TextResponseReadError("CONFLICT", "Choose a page size between 1 and 50");
  if (!query.cursor) return null;
  try {
    if (query.cursor.length > 2_000) throw new Error();
    const parsed: unknown = JSON.parse(Buffer.from(query.cursor, "base64url").toString("utf8"));
    if (
      !Array.isArray(parsed) ||
      parsed.length !== 4 ||
      parsed[0] !== state.sessionId ||
      parsed[1] !== state.version ||
      parsed[2] !== scope ||
      typeof parsed[3] !== "string"
    )
      throw new Error();
    return parsed[3];
  } catch {
    throw new TextResponseReadError(
      "CONFLICT",
      "Responses changed. Refresh the list before continuing",
    );
  }
}
function nextCursor(state: GameState, scope: string, lastId: string | null) {
  return lastId
    ? Buffer.from(JSON.stringify([state.sessionId, state.version, scope, lastId])).toString(
        "base64url",
      )
    : null;
}
function metadata(state: GameState, roundId?: string): Metadata[] {
  return Object.entries(state.responseModeration ?? {})
    .flatMap(([answerId, entry]) => {
      const round = state.rounds[entry.roundId];
      const question = state.quiz.questions.find((candidate) => candidate.id === entry.questionId);
      return round &&
        round.questionId === entry.questionId &&
        (!roundId || entry.roundId === roundId) &&
        (question?.type === "open_text" || question?.type === "word_cloud")
        ? [{ ...entry, answerId }]
        : [];
    })
    .sort((a, b) => a.acceptedAtMs - b.acceptedAtMs || a.answerId.localeCompare(b.answerId));
}
function slicePage<T extends { answerId: string }>(
  values: T[],
  lastId: string | null,
  limit: number,
) {
  const start = lastId === null ? 0 : values.findIndex((entry) => entry.answerId === lastId) + 1;
  if (lastId !== null && start === 0)
    throw new TextResponseReadError(
      "CONFLICT",
      "The response cursor is no longer available. Refresh the list",
    );
  return values.slice(start, start + limit + 1);
}

export function moderationPageSelection(state: GameState, query: TextModerationPageQuery) {
  const scope = `moderation:${query.status}:${query.roundId ?? "all"}`;
  const values = slicePage(
    metadata(state, query.roundId).filter((entry) => entry.status === query.status),
    pageStart(state, query, scope),
    query.limit,
  );
  return {
    entries: values.slice(0, query.limit),
    nextCursor: nextCursor(
      state,
      scope,
      values.length > query.limit ? values[query.limit - 1]!.answerId : null,
    ),
  };
}

export function moderationPage(
  state: GameState,
  query: TextModerationPageQuery,
  answers: EngineAnswer[],
): RoundResponseModerationPage {
  const selected = moderationPageSelection(state, query);
  const byId = new Map(answers.map((answer) => [answer.answerId, answer]));
  return {
    sessionId: state.sessionId,
    version: state.version,
    phase: state.phase,
    items: selected.entries.flatMap((entry) => {
      const answer = byId.get(entry.answerId);
      if (
        !answer ||
        answer.roundId !== entry.roundId ||
        answer.acceptedAtMs !== entry.acceptedAtMs ||
        answer.response.kind !== "text"
      )
        return [];
      return [
        {
          answerId: entry.answerId,
          roundId: entry.roundId,
          questionId: entry.questionId,
          questionPrompt: state.quiz.questions.find((question) => question.id === entry.questionId)!
            .prompt,
          status: entry.status,
          body: entry.status === "removed" ? null : answer.response.value,
          submittedAt: new Date(entry.acceptedAtMs).toISOString(),
          authorAlias: state.participants[answer.participantId]?.nickname ?? null,
        },
      ];
    }),
    nextCursor: selected.nextCursor,
  };
}

export function approvedTextAnswerIds(state: GameState, roundId: string) {
  return metadata(state, roundId)
    .filter((entry) => entry.status === "approved")
    .map((entry) => entry.answerId);
}

export function textResults(
  state: GameState,
  roundId: string,
  query: TextResponsePageQuery,
  answers: EngineAnswer[],
): RoundTextResponseResults {
  const round = state.rounds[roundId];
  const question =
    round && state.quiz.questions.find((candidate) => candidate.id === round.questionId);
  if (!round || (question?.type !== "open_text" && question?.type !== "word_cloud"))
    throw new TextResponseReadError("NOT_FOUND", "Text checkpoint not found in this session");
  const scope = `results:${roundId}`;
  const lastId = pageStart(state, query, scope);
  const seen = new Set<string>();
  const approved = answers
    .filter(
      (answer) =>
        answer.roundId === roundId &&
        isApprovedTextAnswer(answer, state.responseModeration, question.id),
    )
    .sort((a, b) => a.acceptedAtMs - b.acceptedAtMs || a.answerId.localeCompare(b.answerId))
    .flatMap((answer): EngineAnswer[] => {
      if (answer.response.kind !== "text" || seen.has(answer.participantId)) return [];
      try {
        const value = normalizeTextResponse(answer.response.value, question.type);
        seen.add(answer.participantId);
        return [{ ...answer, response: { kind: "text", value } }];
      } catch {
        return [];
      }
    });
  const approvedRespondents = new Set(approved.map((answer) => answer.participantId)).size;
  const distribution = approvedTextResponseDistribution(
    question,
    approved,
    state.responseModeration,
  );
  const visible =
    round.revealedAtMs != null && approvedRespondents >= 5 && distribution !== undefined;
  const base: RoundTextResponseResults = {
    sessionId: state.sessionId,
    roundId,
    version: state.version,
    type: question.type,
    visible,
    approvedRespondents,
    items: [],
    terms: [],
    nextCursor: null,
  };
  if (!visible) return base;
  if (question.type === "open_text") {
    const selected = slicePage(approved, lastId, query.limit);
    return {
      ...base,
      items: selected
        .slice(0, query.limit)
        .flatMap((answer) =>
          answer.response.kind === "text"
            ? [{ answerId: answer.answerId, body: answer.response.value }]
            : [],
        ),
      nextCursor: nextCursor(
        state,
        scope,
        selected.length > query.limit ? selected[query.limit - 1]!.answerId : null,
      ),
    };
  }
  if (distribution?.kind !== "word_cloud") return { ...base, visible: false };
  const selected = slicePage(
    distribution.buckets.map((term) => ({ ...term, answerId: term.value })),
    lastId,
    query.limit,
  );
  return {
    ...base,
    terms: selected
      .slice(0, query.limit)
      .map(({ value, label, count }) => ({ value, label, count })),
    nextCursor: nextCursor(
      state,
      scope,
      selected.length > query.limit ? selected[query.limit - 1]!.value : null,
    ),
  };
}
