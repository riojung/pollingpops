import type { Report } from "@openround/contracts";

/** Only derive counts from retained report rows; never infer unique respondents from answers. */
export function roundReportOverview(report: Report) {
  const questionCount = report.questions.length;
  const answeredQuestions = report.questions.filter((question) => question.responses > 0).length;
  const reviewQuestions = report.questions.filter(
    (question) => question.responses > 0 && question.correct !== null && question.difficult,
  );
  const participation = "participation" in report ? report.participation : null;
  const respondentCoverage =
    participation && participation.participants > 0
      ? {
          respondents: participation.respondents,
          participants: participation.participants,
          percent: participation.percent,
        }
      : null;

  return {
    questionCount,
    answeredQuestions,
    reviewQuestions,
    respondentCoverage,
    questionCoveragePercent:
      questionCount > 0 ? Math.round((answeredQuestions / questionCount) * 100) : null,
    accuracyPercent: report.metrics.answerCount > 0 ? report.metrics.accuracyPercent : null,
    // Retain authored order in the preview; the Questions tab contains every row.
    questionPreview: report.questions.slice(0, 3),
    hasResponses: report.metrics.answerCount > 0,
  };
}
