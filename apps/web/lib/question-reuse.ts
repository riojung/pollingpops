import type { QuestionDraft, QuestionType, QuizDraft } from "@openround/contracts";

export interface QuestionReuseSource {
  id: string;
  title: string;
  draft: Pick<QuizDraft, "questions">;
}

export interface QuestionReuseCandidate {
  mainQuestion: QuestionDraft;
  linkedRecheck: QuestionDraft | null;
  includedQuestionCount: number;
}

export interface QuestionReuseSourceMatch {
  source: QuestionReuseSource;
  candidates: QuestionReuseCandidate[];
}

export interface QuestionReuseSelection {
  sourceQuizId: string;
  selectedMainQuestionIds: string[];
}

export interface QuestionReuseCloneResult {
  questions: QuestionDraft[];
  selectedMainQuestionCount: number;
  includedQuestionCount: number;
  firstQuestionId: string | null;
}

export interface QuestionReuseCapacity {
  currentQuestionCount: number;
  maximumQuestionCount: number;
  remainingQuestionCount: number;
  selectedMainQuestionCount: number;
  includedQuestionCount: number;
  pairedRecheckCount: number;
  remainingAfterReuse: number;
  fits: boolean;
  message: string;
}

const typeLabels: Record<QuestionType, string> = {
  single_select: "single select",
  true_false: "true or false",
  multi_select: "multiple select",
  numeric: "numeric response",
  rating: "rating",
  poll: "poll",
  ranking: "ranking",
  open_text: "open text",
  word_cloud: "word cloud",
};

function normalizeSearchText(value: string) {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("en-CA")
    .replaceAll(/[_-]+/g, " ")
    .replaceAll(/\s+/g, " ")
    .trim();
}

function searchTokens(query: string) {
  const normalized = normalizeSearchText(query);
  return normalized ? normalized.split(" ") : [];
}

function questionSearchText(question: QuestionDraft) {
  return normalizeSearchText(
    [
      question.prompt,
      question.type,
      typeLabels[question.type],
      ...(question.conceptKeys ?? []),
    ].join(" "),
  );
}

function isMainQuestion(question: QuestionDraft) {
  return (question.delivery ?? "main") === "main";
}

function questionIdCounts(source: QuestionReuseSource) {
  const counts = new Map<string, number>();
  for (const question of source.draft.questions) {
    counts.set(question.id, (counts.get(question.id) ?? 0) + 1);
  }
  return counts;
}

function validLinkedRecheck(
  source: QuestionReuseSource,
  question: QuestionDraft,
  idCounts = questionIdCounts(source),
) {
  if (!isMainQuestion(question) || !question.linkedRecheckQuestionId) return null;
  if (idCounts.get(question.id) !== 1 || idCounts.get(question.linkedRecheckQuestionId) !== 1) {
    return null;
  }
  const candidate = source.draft.questions.find(
    (item) => item.id === question.linkedRecheckQuestionId,
  );
  return candidate && (candidate.delivery ?? "main") === "recheck" ? candidate : null;
}

function reusableCandidates(source: QuestionReuseSource) {
  const idCounts = questionIdCounts(source);
  return source.draft.questions
    .filter((question) => isMainQuestion(question) && idCounts.get(question.id) === 1)
    .map<QuestionReuseCandidate>((mainQuestion) => {
      const linkedRecheck = validLinkedRecheck(source, mainQuestion, idCounts);
      return {
        mainQuestion,
        linkedRecheck,
        includedQuestionCount: linkedRecheck ? 2 : 1,
      };
    });
}

/**
 * Finds reusable main questions without ever returning a recheck as a standalone candidate.
 * A query may match the source Round, main prompt/type/concepts, or its paired recheck.
 */
export function findQuestionReuseSources(
  sources: readonly QuestionReuseSource[],
  query: string,
): QuestionReuseSourceMatch[] {
  const tokens = searchTokens(query);
  return sources.flatMap((source) => {
    const sourceText = normalizeSearchText(source.title);
    const candidates = reusableCandidates(source).filter((candidate) => {
      if (tokens.length === 0) return true;
      const candidateText = [
        sourceText,
        questionSearchText(candidate.mainQuestion),
        candidate.linkedRecheck ? questionSearchText(candidate.linkedRecheck) : "",
      ].join(" ");
      return tokens.every((token) => candidateText.includes(token));
    });
    return candidates.length > 0 ? [{ source, candidates }] : [];
  });
}

/**
 * Resolves selected main questions and their valid paired rechecks in source order.
 * Duplicate and unknown selections, plus attempts to select a recheck directly, are ignored.
 */
export function resolveQuestionsForReuse(
  source: QuestionReuseSource,
  selectedMainQuestionIds: readonly string[],
) {
  const requested = new Set(selectedMainQuestionIds);
  const includedIds = new Set<string>();
  const idCounts = questionIdCounts(source);
  let selectedMainQuestionCount = 0;

  for (const question of source.draft.questions) {
    if (
      !requested.has(question.id) ||
      !isMainQuestion(question) ||
      idCounts.get(question.id) !== 1
    ) {
      continue;
    }
    if (!includedIds.has(question.id)) selectedMainQuestionCount += 1;
    includedIds.add(question.id);
    const linkedRecheck = validLinkedRecheck(source, question, idCounts);
    if (linkedRecheck) includedIds.add(linkedRecheck.id);
  }

  return {
    questions: source.draft.questions.filter(
      (question) => idCounts.get(question.id) === 1 && includedIds.has(question.id),
    ),
    selectedMainQuestionCount,
  };
}

/** Removes unknown, duplicate, and recheck-only selections while preserving source order. */
export function normalizeQuestionReuseSelections(
  sources: readonly QuestionReuseSource[],
  selections: readonly QuestionReuseSelection[],
): QuestionReuseSelection[] {
  const requestedBySource = new Map<string, Set<string>>();
  for (const selection of selections) {
    const requested = requestedBySource.get(selection.sourceQuizId) ?? new Set<string>();
    for (const questionId of selection.selectedMainQuestionIds) requested.add(questionId);
    requestedBySource.set(selection.sourceQuizId, requested);
  }

  return sources.flatMap((source) => {
    const requested = requestedBySource.get(source.id);
    if (!requested) return [];
    const idCounts = questionIdCounts(source);
    const selectedMainQuestionIds = source.draft.questions
      .filter(
        (question) =>
          requested.has(question.id) && isMainQuestion(question) && idCounts.get(question.id) === 1,
      )
      .map((question) => question.id);
    return selectedMainQuestionIds.length > 0
      ? [{ sourceQuizId: source.id, selectedMainQuestionIds }]
      : [];
  });
}

function cloneQuestion(
  question: QuestionDraft,
  id: string,
  linkedRecheckQuestionId: string | null,
  createId: () => string,
): QuestionDraft {
  const cloned = {
    ...question,
    id,
    linkedRecheckQuestionId,
    ...(question.conceptKeys ? { conceptKeys: [...question.conceptKeys] } : {}),
    ...(question.sourceCitations
      ? { sourceCitations: question.sourceCitations.map((citation) => ({ ...citation })) }
      : {}),
  } as QuestionDraft;
  if ("choices" in question && "choices" in cloned) {
    cloned.choices = question.choices.map((choice) => ({ ...choice, id: createId() }));
  }
  return cloned;
}

/**
 * Creates an independent snapshot suitable for appending to another Round. The caller supplies
 * the ID factory so browser UUID generation and deterministic tests use the same implementation.
 */
export function cloneQuestionsForReuse(
  source: QuestionReuseSource,
  selectedMainQuestionIds: readonly string[],
  createId: () => string,
): QuestionReuseCloneResult {
  const resolved = resolveQuestionsForReuse(source, selectedMainQuestionIds);
  const questionIds = new Map(
    resolved.questions.map((question) => [question.id, createId()] as const),
  );
  const questions = resolved.questions.map((question) => {
    const linkedRecheck = validLinkedRecheck(source, question);
    const linkedRecheckQuestionId = linkedRecheck
      ? (questionIds.get(linkedRecheck.id) ?? null)
      : null;
    return cloneQuestion(
      question,
      questionIds.get(question.id)!,
      linkedRecheckQuestionId,
      createId,
    );
  });

  return {
    questions,
    selectedMainQuestionCount: resolved.selectedMainQuestionCount,
    includedQuestionCount: questions.length,
    firstQuestionId: questions[0]?.id ?? null,
  };
}

/** Clones a multi-Round selection in source order for one editor structural change. */
export function cloneQuestionReuseSelections(
  sources: readonly QuestionReuseSource[],
  selections: readonly QuestionReuseSelection[],
  createId: () => string,
): QuestionReuseCloneResult {
  const sourceById = new Map(sources.map((source) => [source.id, source]));
  const normalized = normalizeQuestionReuseSelections(sources, selections);
  const batches = normalized.map((selection) =>
    cloneQuestionsForReuse(
      sourceById.get(selection.sourceQuizId)!,
      selection.selectedMainQuestionIds,
      createId,
    ),
  );
  const questions = batches.flatMap((batch) => batch.questions);
  return {
    questions,
    selectedMainQuestionCount: batches.reduce(
      (total, batch) => total + batch.selectedMainQuestionCount,
      0,
    ),
    includedQuestionCount: questions.length,
    firstQuestionId: questions[0]?.id ?? null,
  };
}

function countLabel(count: number, singular: string, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

export function questionReuseCapacity(
  source: QuestionReuseSource,
  selectedMainQuestionIds: readonly string[],
  currentQuestionCount: number,
  maximumQuestionCount = 200,
): QuestionReuseCapacity {
  const maximum = Math.max(0, Math.trunc(maximumQuestionCount));
  const current = Math.min(maximum, Math.max(0, Math.trunc(currentQuestionCount)));
  const remaining = maximum - current;
  const resolved = resolveQuestionsForReuse(source, selectedMainQuestionIds);
  const includedQuestionCount = resolved.questions.length;
  const pairedRecheckCount = includedQuestionCount - resolved.selectedMainQuestionCount;
  const fits = includedQuestionCount > 0 && includedQuestionCount <= remaining;
  const remainingAfterReuse = Math.max(0, remaining - includedQuestionCount);

  let message: string;
  if (remaining === 0) {
    message = `This Round has reached its ${countLabel(maximum, "question")} limit.`;
  } else if (includedQuestionCount === 0) {
    message = `${countLabel(remaining, "question slot")} available.`;
  } else if (!fits) {
    message = `Select fewer questions. This selection adds ${includedQuestionCount}, but only ${countLabel(remaining, "slot")} remain.`;
  } else {
    const selection = countLabel(resolved.selectedMainQuestionCount, "selected question");
    const rechecks = countLabel(pairedRecheckCount, "paired recheck");
    message = `Adds ${countLabel(includedQuestionCount, "question")} (${selection}, ${rechecks}). ${countLabel(remainingAfterReuse, "slot")} will remain.`;
  }

  return {
    currentQuestionCount: current,
    maximumQuestionCount: maximum,
    remainingQuestionCount: remaining,
    selectedMainQuestionCount: resolved.selectedMainQuestionCount,
    includedQuestionCount,
    pairedRecheckCount,
    remainingAfterReuse,
    fits,
    message,
  };
}

export function questionReuseBatchCapacity(
  sources: readonly QuestionReuseSource[],
  selections: readonly QuestionReuseSelection[],
  currentQuestionCount: number,
  maximumQuestionCount = 200,
): QuestionReuseCapacity {
  const sourceById = new Map(sources.map((source) => [source.id, source]));
  const normalized = normalizeQuestionReuseSelections(sources, selections);
  const totals = normalized.reduce(
    (current, selection) => {
      const resolved = resolveQuestionsForReuse(
        sourceById.get(selection.sourceQuizId)!,
        selection.selectedMainQuestionIds,
      );
      current.selected += resolved.selectedMainQuestionCount;
      current.included += resolved.questions.length;
      return current;
    },
    { selected: 0, included: 0 },
  );
  const maximum = Math.max(0, Math.trunc(maximumQuestionCount));
  const current = Math.min(maximum, Math.max(0, Math.trunc(currentQuestionCount)));
  const remaining = maximum - current;
  const pairedRecheckCount = totals.included - totals.selected;
  const fits = totals.included > 0 && totals.included <= remaining;
  const remainingAfterReuse = Math.max(0, remaining - totals.included);

  let message: string;
  if (remaining === 0) {
    message = `This Round has reached its ${countLabel(maximum, "question")} limit.`;
  } else if (totals.included === 0) {
    message = `${countLabel(remaining, "question slot")} available.`;
  } else if (!fits) {
    message = `Select fewer questions. This selection adds ${totals.included}, but only ${countLabel(remaining, "slot")} remain.`;
  } else {
    const selection = countLabel(totals.selected, "selected question");
    const rechecks = countLabel(pairedRecheckCount, "paired recheck");
    message = `Adds ${countLabel(totals.included, "question")} (${selection}, ${rechecks}). ${countLabel(remainingAfterReuse, "slot")} will remain.`;
  }

  return {
    currentQuestionCount: current,
    maximumQuestionCount: maximum,
    remainingQuestionCount: remaining,
    selectedMainQuestionCount: totals.selected,
    includedQuestionCount: totals.included,
    pairedRecheckCount,
    remainingAfterReuse,
    fits,
    message,
  };
}
