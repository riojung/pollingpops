export interface RankingQuestion {
  choices: Array<{ id: string; label: string }>;
  rankCount?: number;
}

export function rankingCount(question: RankingQuestion) {
  return question.rankCount ?? question.choices.length;
}

export function initialRanking(question: RankingQuestion) {
  return rankingCount(question) === question.choices.length
    ? question.choices.map((choice) => choice.id)
    : [];
}

export function moveRankedChoice(selected: string[], choiceId: string, direction: -1 | 1) {
  const index = selected.indexOf(choiceId);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= selected.length) return selected;
  const result = [...selected];
  [result[index], result[target]] = [result[target]!, result[index]!];
  return result;
}

export function toggleRankedChoice(selected: string[], choiceId: string, count: number) {
  if (selected.includes(choiceId)) return selected.filter((id) => id !== choiceId);
  return selected.length < count ? [...selected, choiceId] : selected;
}
