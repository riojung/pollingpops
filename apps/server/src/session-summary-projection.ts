import {
  AggregateSessionSummarySchema,
  type AggregateSessionSummary,
  type PresentationReport,
  type QuizDraft,
  type Report,
  type SummaryAccuracy,
  type SummaryQuestion,
} from "@openround/contracts";
import type { surveyAggregate } from "@openround/contracts/surveys";

/** Preserve literal plain text, including international scripts, while removing spoofing controls. */
export function summaryPlainText(value: string): string {
  return Array.from(value)
    .map((character) => {
      const code = character.codePointAt(0)!;
      return code >= 0xd800 && code <= 0xdfff ? "\ufffd" : character;
    })
    .filter((character) => {
      const code = character.codePointAt(0)!;
      return !(
        (code < 32 && code !== 9 && code !== 10 && code !== 13) ||
        (code >= 127 && code <= 159) ||
        (code >= 0x200b && code <= 0x200f && code !== 0x200d) ||
        (code >= 0x202a && code <= 0x202e) ||
        (code >= 0x2060 && code <= 0x206f) ||
        code === 0xfeff ||
        code === 0xfffe ||
        code === 0xffff
      );
    })
    .join("")
    .normalize("NFC")
    .trim();
}

function accuracy(correct: number | null, responses: number): SummaryAccuracy | null {
  if (correct === null || responses < 5 || correct > responses) return null;
  return { correct, responses, percent: Math.round((correct / responses) * 1000) / 10 };
}

function base(
  kind: AggregateSessionSummary["kind"],
  title: string,
  finishedAt: string,
  participantCount: number,
  responseCount: number,
): AggregateSessionSummary {
  return {
    schemaVersion: 1,
    kind,
    title: summaryPlainText(title) || "PollingPops",
    finishedAt,
    minimumRespondents: 5,
    participantCount,
    responseCount,
    questionCount: 0,
    initialAccuracy: null,
    recovery: [],
    questions: [],
    noteCodes: ["aggregate_only"],
    nextSteps: "",
  };
}

function finish(summary: AggregateSessionSummary): AggregateSessionSummary {
  summary.questionCount = summary.questions.length;
  if (summary.questions.some((q) => q.suppression === "insufficient_sample"))
    summary.noteCodes.push("insufficient_sample");
  if (summary.questions.some((q) => q.suppression === "participant_text"))
    summary.noteCodes.push("participant_text_excluded");
  if (summary.recovery.length) summary.noteCodes.push("paired_evidence");
  if (!summary.questions.some((q) => q.accuracy)) summary.noteCodes.push("no_scored_evidence");
  // Reject oversized or malformed legacy evidence instead of publishing a partial document.
  const result = AggregateSessionSummarySchema.parse(summary);
  if (Buffer.byteLength(JSON.stringify(result), "utf8") > 1024 * 1024)
    throw new Error("Summary exceeds the document limit");
  return result;
}

export function projectRoundSummary(
  report: Report,
  quiz: QuizDraft,
  finishedAt: string,
): AggregateSessionSummary {
  const summary = base(
    "round",
    quiz.title,
    finishedAt,
    report.metrics.participantCount,
    report.metrics.answerCount,
  );
  summary.questions = report.questions.map((evidence, index): SummaryQuestion => {
    const source = quiz.questions.find((q) => q.id === evidence.questionId);
    const type = source?.type ?? "unknown";
    const purpose =
      source?.purpose === "opinion" || type === "poll" || type === "rating"
        ? "opinion"
        : "assessed";
    const text = type === "open_text" || type === "word_cloud";
    const distribution = evidence.responseDistribution;
    // Text distributions contain audience-authored bodies/terms, even after moderation.
    const safeDistribution =
      distribution && distribution.kind !== "open_text" && distribution.kind !== "word_cloud"
        ? distribution
        : null;
    const adequate = evidence.responses >= 5;
    const question: SummaryQuestion = {
      index,
      prompt: summaryPlainText(evidence.prompt),
      type,
      purpose,
      respondents: adequate ? evidence.responses : null,
      accuracy:
        !text && adequate && purpose === "assessed"
          ? accuracy(evidence.correct, evidence.responses)
          : null,
      suppression: text
        ? "participant_text"
        : !adequate
          ? "insufficient_sample"
          : !source
            ? "unavailable"
            : "none",
      measure: safeDistribution?.kind === "ranking" ? "weighted_points" : "respondents",
      maxSelections: source && "maxSelections" in source ? (source.maxSelections ?? 1) : null,
      results: [],
    };
    if (question.suppression !== "none") question.accuracy = null;
    if (question.suppression === "none" && safeDistribution && safeDistribution.respondents >= 5) {
      if (safeDistribution.kind === "choice" || safeDistribution.kind === "rating")
        question.results = safeDistribution.buckets.map((bucket) => ({
          label: summaryPlainText(bucket.label),
          value: bucket.count,
        }));
      if (safeDistribution.kind === "ranking")
        question.results = safeDistribution.buckets.map((bucket) => ({
          label: summaryPlainText(bucket.label),
          value: bucket.weightedScore,
        }));
      // Numeric reports only supply correctness counts; never publish entered point values.
    }
    return question;
  });
  if ("initialAccuracy" in report) {
    const contributors = report.participantFeedback.filter((row) => row.responses > 0).length;
    if (contributors >= 5)
      summary.initialAccuracy = accuracy(
        report.initialAccuracy.correct,
        report.initialAccuracy.responses,
      );
    summary.recovery = report.recovery
      .filter((row) => row.initiallyIncorrectWithBoth >= 5 && row.recoveryPercent !== null)
      .map((row) => ({
        kind: row.evidenceType === "revote" ? "revote" : "linked",
        label: summaryPlainText(
          quiz.questions.find((q) => q.id === row.sourceQuestionId)?.prompt ?? "",
        ),
        eligible: row.initiallyIncorrectWithBoth,
        recovered: row.recovered,
        percent: Math.round((row.recovered / row.initiallyIncorrectWithBoth) * 1000) / 10,
      }));
  }
  return finish(summary);
}

export function projectPresentationSummary(report: PresentationReport): AggregateSessionSummary {
  const summary = base(
    "presentation",
    report.title,
    report.finishedAt,
    report.participantCount,
    report.responseCount,
  );
  summary.questions = report.evidence.map((evidence, index): SummaryQuestion => {
    if (evidence.kind === "content")
      return {
        index,
        prompt: summaryPlainText(evidence.title),
        type: "content",
        purpose: "content",
        respondents: null,
        accuracy: null,
        suppression: "unavailable",
        measure: "respondents",
        maxSelections: null,
        results: [],
      };
    const text = evidence.questionType === "open_text" || evidence.questionType === "word_cloud";
    const adequate = evidence.respondents >= 5;
    return {
      index,
      prompt: summaryPlainText(evidence.prompt),
      type: evidence.questionType,
      purpose: evidence.correct === null ? "opinion" : "assessed",
      respondents: adequate ? evidence.respondents : null,
      accuracy: !text && adequate ? accuracy(evidence.correct, evidence.respondents) : null,
      suppression: text ? "participant_text" : adequate ? "none" : "insufficient_sample",
      measure: "respondents",
      maxSelections: null,
      results: [],
    };
  });
  summary.recovery = report.recovery
    .filter((row) => row.eligible >= 5 && row.recoveryPercent !== null)
    .map((row) => {
      const source = report.evidence.find(
        (e) => e.kind === "question" && e.questionId === row.sourceQuestionId,
      );
      return {
        kind: "linked",
        label: summaryPlainText(source?.kind === "question" ? source.prompt : ""),
        eligible: row.eligible,
        recovered: row.recovered,
        percent: Math.round((row.recovered / row.eligible) * 1000) / 10,
      };
    });
  return finish(summary);
}

export function projectSurveySummary(
  report: ReturnType<typeof surveyAggregate>,
  finishedAt: string,
): AggregateSessionSummary {
  const summary = base(
    "survey",
    report.title,
    finishedAt,
    report.submittedCount,
    report.submittedCount,
  );
  summary.questions = report.questions.map((evidence, index) => ({
    index,
    prompt: summaryPlainText(evidence.prompt),
    type: evidence.type,
    purpose: "opinion",
    respondents: evidence.answeredCount,
    accuracy: null,
    suppression: evidence.suppressed ? "insufficient_sample" : "none",
    measure: "respondents",
    maxSelections: evidence.maxSelections ?? null,
    results: evidence.suppressed
      ? []
      : evidence.distribution.map((bucket) => ({
          label: summaryPlainText(bucket.label),
          value: bucket.count,
        })),
  }));
  return finish(summary);
}
