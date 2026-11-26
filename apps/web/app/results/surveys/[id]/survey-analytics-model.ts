import type { surveyAggregate } from "@openround/contracts/surveys";

export type SurveyAggregate = ReturnType<typeof surveyAggregate>;
export type SurveyAggregateQuestion = SurveyAggregate["questions"][number];

export function surveyAnalyticsOverview(results: SurveyAggregate) {
  if (results.resultsStatus !== "available" || results.suppressed !== false) return null;

  const { minimumRespondents, submittedCount } = results;
  const questions: Array<{
    id: string;
    prompt: string;
    position: number;
    answeredCount: number;
    percent: number;
  }> = [];
  if (
    Number.isSafeInteger(minimumRespondents) &&
    minimumRespondents > 0 &&
    Number.isSafeInteger(submittedCount) &&
    submittedCount >= minimumRespondents
  ) {
    for (const [index, { id, prompt, suppressed, answeredCount }] of results.questions.entries()) {
      if (
        suppressed !== false ||
        answeredCount == null ||
        !Number.isSafeInteger(answeredCount) ||
        answeredCount < minimumRespondents ||
        answeredCount > submittedCount
      )
        continue;
      questions.push({
        id,
        prompt,
        position: index + 1,
        answeredCount,
        percent: (answeredCount / submittedCount) * 100,
      });
    }
  }
  return { totalQuestions: results.questions.length, questions };
}

export function surveyAverageRating(question: SurveyAggregateQuestion): number | null {
  const { answeredCount, distribution } = question;
  if (
    question.type !== "rating" ||
    question.suppressed !== false ||
    answeredCount == null ||
    !Number.isSafeInteger(answeredCount) ||
    answeredCount <= 0 ||
    !Array.isArray(distribution) ||
    distribution.length < 2
  )
    return null;

  // The aggregate publishes each score in the authored scale, including zero-count bins.
  let score = Number(distribution[0]?.label);
  if (!Number.isInteger(score) || score < 1 || score + distribution.length - 1 > 10) return null;

  let remaining = answeredCount;
  let weightedTotal = 0;
  for (const bucket of distribution) {
    if (
      bucket?.label !== String(score) ||
      !Number.isSafeInteger(bucket.count) ||
      bucket.count < 0 ||
      bucket.count > remaining
    )
      return null;
    remaining -= bucket.count;
    weightedTotal += score * bucket.count;
    score += 1;
  }

  return remaining === 0 ? weightedTotal / answeredCount : null;
}
