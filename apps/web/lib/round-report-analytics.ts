import type { Report } from "@openround/contracts";
import { deriveRecoverySummary } from "./report-summary";

export function roundReportAnalytics(report: Report) {
  const questions = report.questions.map(
    ({ questionId: id, prompt, responses, correct }, index) => ({
      id,
      prompt,
      number: index + 1,
      responses,
      kind: correct === null ? ("opinion" as const) : ("assessment" as const),
    }),
  );
  const questionSummary = {
    answered: 0,
    assessmentSubmissions: 0,
    opinionSubmissions: 0,
    maximumResponses: 0,
  };
  for (const { responses, kind } of questions) {
    if (responses > 0) questionSummary.answered += 1;
    questionSummary.maximumResponses = Math.max(questionSummary.maximumResponses, responses);
    if (kind === "opinion") {
      questionSummary.opinionSubmissions += responses;
    } else {
      questionSummary.assessmentSubmissions += responses;
    }
  }

  let accuracy = null;
  if ("initialAccuracy" in report) {
    const { percent, correct, responses } = report.initialAccuracy;
    if (responses > 0 && percent !== null) accuracy = { percent, correct, responses };
  } else if (questionSummary.assessmentSubmissions > 0) {
    // Schema V1 covered scored questions only. Its rows retain both counts.
    const responses = questionSummary.assessmentSubmissions;
    const correct = report.questions.reduce((total, question) => total + question.correct, 0);
    accuracy = { percent: Math.round((correct / responses) * 1_000) / 10, correct, responses };
  }

  const participation = "participation" in report ? report.participation : null;
  const qna = "qna" in report ? report.qna : null;
  const recovery = "recovery" in report ? deriveRecoverySummary(report) : null;

  return {
    joined: report.metrics.participantCount,
    submissions: report.metrics.answerCount,
    participation: participation
      ? {
          participants: participation.participants,
          respondents: participation.respondents,
          percent: participation.participants > 0 ? participation.percent : null,
        }
      : null,
    questions,
    questionSummary,
    qna: qna
      ? { questions: qna.questions, answered: qna.answered, unresolved: qna.unresolved }
      : null,
    conversation:
      "conversation" in report
        ? {
            pulseParticipants: report.audiencePulse.uniqueParticipants,
            pulseEvents: report.audiencePulse.events,
            messages: report.conversation.messages,
            reactions: report.conversation.reactions,
          }
        : null,
    accuracy,
    recovery:
      recovery && recovery.recoveryPercent !== null
        ? {
            recovered: recovery.recovered,
            denominator: recovery.denominator,
            percent: recovery.recoveryPercent,
            smallSample: recovery.smallSample,
          }
        : null,
  };
}
