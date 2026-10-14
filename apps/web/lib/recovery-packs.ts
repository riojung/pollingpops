import {
  InsertRecoveryPackSchema,
  QUESTION_TYPE_REGISTRY,
  LegacyQuestionDraftSchema,
  type QuestionDraft,
  type RecoveryPackDraft,
} from "@openround/contracts";

/** Destination IDs come from a DOM selection; reject non-UUID values before using them. */
export function recoveryPackTargetId(value: string) {
  const parsed = InsertRecoveryPackSchema.shape.quizId.safeParse(value);
  return parsed.success ? parsed.data : "";
}

export function recoveryPackRoundHref(value: string) {
  const id = recoveryPackTargetId(value);
  return id ? `/quiz/${encodeURIComponent(id)}` : null;
}

function supportsRecoveryPack(
  question: QuestionDraft,
): question is RecoveryPackDraft["diagnostic"] {
  return (
    LegacyQuestionDraftSchema.safeParse(question).success &&
    QUESTION_TYPE_REGISTRY[question.type].supportsRecovery
  );
}

export function recoveryPackPairs(questions: readonly QuestionDraft[]) {
  const ids = questions.map((question) => question.id);
  return questions.flatMap((diagnostic) => {
    if (
      (diagnostic.delivery ?? "main") !== "main" ||
      !supportsRecoveryPack(diagnostic) ||
      !diagnostic.linkedRecheckQuestionId ||
      ids.filter((id) => id === diagnostic.id).length !== 1
    )
      return [];
    const rechecks = questions.filter(
      (question) => question.id === diagnostic.linkedRecheckQuestionId,
    );
    const recheck = rechecks[0];
    return rechecks.length === 1 && recheck?.delivery === "recheck" && supportsRecoveryPack(recheck)
      ? [{ diagnostic, recheck }]
      : [];
  });
}

export function conceptKeysFromText(value: string) {
  return [
    ...new Set(
      value
        .split(",")
        .map((key) => key.trim())
        .filter(Boolean),
    ),
  ];
}

/** Copies a frozen published pair, never an unsaved source draft or nested Pack lineage. */
export function recoveryPackDraftFromPair(
  title: string,
  diagnostic: QuestionDraft,
  recheck: QuestionDraft,
  cardId: string,
): RecoveryPackDraft {
  const clone = (question: QuestionDraft) => {
    if (!supportsRecoveryPack(question))
      throw new Error("Only learning checkpoints can become Recovery Packs");
    const copied = LegacyQuestionDraftSchema.parse(structuredClone(question));
    delete copied.recoveryPackSource;
    return copied;
  };
  const diagnosticConcepts = diagnostic.conceptKeys ?? [];
  const recheckConcepts = recheck.conceptKeys ?? [];
  const allConcepts = [...new Set([...diagnosticConcepts, ...recheckConcepts])];
  // Source questions retain their complete metadata. Bound only the Pack summary, prioritizing
  // shared concepts and covering both checkpoints even when their concept lists are disjoint.
  const concepts =
    allConcepts.length <= 12
      ? allConcepts
      : [
          ...new Set([
            ...diagnosticConcepts.filter((key) => recheckConcepts.includes(key)),
            ...diagnosticConcepts.slice(0, 1),
            ...recheckConcepts.slice(0, 1),
            ...allConcepts,
          ]),
        ].slice(0, 12);
  const citations = [
    ...(diagnostic.sourceCitations ?? []),
    ...(recheck.sourceCitations ?? []),
  ].filter(
    (citation, index, all) =>
      all.findIndex((candidate) => JSON.stringify(candidate) === JSON.stringify(citation)) ===
      index,
  );
  const misconceptions =
    "choices" in diagnostic
      ? diagnostic.choices.flatMap((choice) =>
          choice.misconceptionKey ? [choice.misconceptionKey] : [],
        )
      : [];
  return {
    schemaVersion: 1,
    title,
    description: "",
    diagnostic: {
      ...clone(diagnostic),
      purpose: "diagnostic",
      delivery: "main",
      linkedRecheckQuestionId: recheck.id,
    },
    recheck: { ...clone(recheck), delivery: "recheck", linkedRecheckQuestionId: null },
    interventions: [
      {
        id: cardId,
        title: "Facilitator intervention",
        body: diagnostic.explanation,
        citations: diagnostic.sourceCitations ?? [],
      },
    ],
    delayedProbe: null,
    conceptKeys: concepts,
    misconceptionKeys: [...new Set(misconceptions)],
    citations,
  };
}
