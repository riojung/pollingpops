import type { QuestionDraft, QuestionType } from "@openround/contracts";

export type QuestionOutlineFilter = "all" | "attention" | "recheck";

export const QUESTION_TYPE_GROUPS: ReadonlyArray<{
  kind: "knowledge" | "opinion";
  types: readonly QuestionType[];
}> = [
  { kind: "knowledge", types: ["single_select", "true_false", "multi_select", "numeric"] },
  { kind: "opinion", types: ["poll", "rating", "ranking", "open_text", "word_cloud"] },
];

export function availableQuestionTypes({
  rankingPollsEnabled = false,
  openTextPollsEnabled = false,
  wordCloudPollsEnabled = false,
}: {
  rankingPollsEnabled?: boolean;
  openTextPollsEnabled?: boolean;
  wordCloudPollsEnabled?: boolean;
} = {}): QuestionType[] {
  return QUESTION_TYPE_GROUPS.flatMap(({ types }) => types).filter(
    (type) =>
      (type !== "ranking" || rankingPollsEnabled) &&
      (type !== "open_text" || openTextPollsEnabled) &&
      (type !== "word_cloud" || wordCloudPollsEnabled),
  );
}

export function questionOutlineItems(
  questions: readonly QuestionDraft[],
  {
    query,
    filter,
    issueQuestionIds,
    typeLabels,
  }: {
    query: string;
    filter: QuestionOutlineFilter;
    issueQuestionIds: ReadonlySet<string>;
    typeLabels: Record<QuestionType, string>;
  },
) {
  const tokens = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return questions
    .map((question, index) => ({ question, index }))
    .filter(({ question, index }) => {
      if (filter === "attention" && !issueQuestionIds.has(question.id)) return false;
      if (filter === "recheck" && question.delivery !== "recheck") return false;
      const content = [
        String(index + 1),
        question.prompt,
        typeLabels[question.type],
        ...(question.conceptKeys ?? []),
        ...("choices" in question ? question.choices.map(({ label }) => label) : []),
        ...("unit" in question ? [question.unit ?? "", question.correctValue] : []),
      ]
        .join(" ")
        .toLocaleLowerCase();
      return tokens.every((token) => content.includes(token));
    });
}
