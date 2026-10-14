import {
  questionConfidence,
  questionDelivery,
  questionPurpose,
  type QuestionDraft,
  type QuizDraft,
} from "@openround/contracts";
import { normalizePrototypeConceptKey } from "./prototype-normalization";

type ChoiceQuestion = Extract<QuestionDraft, { choices: unknown }>;

export const QUESTION_HEALTH_RULESET_VERSION = "p0.1.1" as const;

export const QUESTION_HEALTH_RULE_IDS = [
  "choice.duplicate",
  "choice.overlap",
  "choice.length_cue",
  "choice.missing_rationale",
  "question.missing_explanation",
  "question.missing_citation",
  "question.dense_content",
  "question.configuration_mismatch",
  "recheck.same_prompt",
  "recheck.concept_mismatch",
] as const;

export type QuestionHealthRuleId = (typeof QUESTION_HEALTH_RULE_IDS)[number];
export type QuestionHealthUsefulness = "useful" | "not_useful";
export type QuestionHealthOutcome = "retained_revision" | "deliberate_dismissal" | "no_decision";
export type QuestionHealthUsefulnessDisposition = QuestionHealthUsefulness | "pending";
export type QuestionHealthOutcomeDisposition = QuestionHealthOutcome | "pending";

export interface QuestionHealthFinding {
  id: string;
  ruleId: QuestionHealthRuleId;
  ruleVersion: 1;
  rulesetVersion: typeof QUESTION_HEALTH_RULESET_VERSION;
  severity: "advisory";
  questionIndex: number;
  fieldPath: string;
  contentHash: string;
  reason: string;
  evidence: string;
  recommendedAction: string;
}

export interface QuestionHealthResult {
  rulesetVersion: typeof QUESTION_HEALTH_RULESET_VERSION;
  evaluatedQuestionCount: number;
  findings: QuestionHealthFinding[];
}

export interface QuestionHealthFindingEvaluation {
  ruleId: QuestionHealthRuleId;
  ruleVersion: 1;
  rulesetVersion: typeof QUESTION_HEALTH_RULESET_VERSION;
  usefulness: QuestionHealthUsefulnessDisposition;
  outcome: QuestionHealthOutcomeDisposition;
}

function normalizedText(value: string) {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function normalizedConcepts(question: QuestionDraft) {
  return [
    ...new Set((question.conceptKeys ?? []).map(normalizePrototypeConceptKey).filter(Boolean)),
  ].sort();
}

/** A small platform-independent FNV-1a hash; this is an identifier, not a security primitive. */
function stableHash(value: string) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function questionContent(question: QuestionDraft) {
  return JSON.stringify({
    type: question.type,
    prompt: question.prompt,
    purpose: questionPurpose(question),
    confidence: questionConfidence(question),
    delivery: questionDelivery(question),
    conceptKeys: normalizedConcepts(question),
    linkedRecheckQuestionId: question.linkedRecheckQuestionId ?? null,
    timeLimitSeconds: question.timeLimitSeconds,
    basePoints: question.basePoints,
    explanation: question.explanation,
    mediaId: question.mediaId,
    mediaAlt: question.mediaAlt,
    sourceCitations: (question.sourceCitations ?? []).map((citation) => ({
      sourceName: citation.sourceName,
      sourceDigest: citation.sourceDigest,
      locator: citation.locator,
      excerpt: citation.excerpt,
    })),
    ...(isChoiceQuestion(question)
      ? {
          choices: question.choices.map((choice) => ({
            label: choice.label,
            isCorrect: choice.isCorrect,
            feedback: choice.feedback ?? null,
            misconceptionKey: choice.misconceptionKey ?? null,
          })),
        }
      : question.type === "numeric"
        ? {
            correctValue: question.correctValue,
            tolerance: question.tolerance,
            unit: question.unit,
          }
        : {
            ...(question.type === "rating"
              ? {
                  min: question.min,
                  max: question.max,
                  minLabel: question.minLabel,
                  maxLabel: question.maxLabel,
                }
              : {}),
          }),
    ...(question.type === "poll" && (question.maxSelections ?? 1) > 1
      ? { maxSelections: question.maxSelections }
      : {}),
    ...(question.type === "ranking"
      ? { rankCount: question.rankCount ?? question.choices.length }
      : {}),
  });
}

function isChoiceQuestion(question: QuestionDraft): question is ChoiceQuestion {
  return "choices" in question;
}

function tokenOverlap(left: string, right: string) {
  const leftTokens = new Set(normalizedText(left).split(" ").filter(Boolean));
  const rightTokens = new Set(normalizedText(right).split(" ").filter(Boolean));
  if (leftTokens.size === 0 || rightTokens.size === 0) return 0;
  const intersection = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  return intersection / Math.min(leftTokens.size, rightTokens.size);
}

interface FindingInput {
  ruleId: QuestionHealthRuleId;
  question: QuestionDraft;
  questionIndex: number;
  localPath: string;
  reason: string;
  evidence: string;
  recommendedAction: string;
  discriminator?: string;
  relatedQuestion?: QuestionDraft;
}

function finding(input: FindingInput): QuestionHealthFinding {
  const contentHash = stableHash(
    [
      questionContent(input.question),
      input.relatedQuestion ? questionContent(input.relatedQuestion) : "",
    ].join("|"),
  );
  const identity = stableHash(input.question.id);
  const idHash = stableHash(
    [
      QUESTION_HEALTH_RULESET_VERSION,
      input.ruleId,
      identity,
      input.localPath,
      input.discriminator ?? "",
      contentHash,
    ].join("|"),
  );
  return {
    id: `qh-${QUESTION_HEALTH_RULESET_VERSION}-${input.ruleId}-${idHash}`,
    ruleId: input.ruleId,
    ruleVersion: 1,
    rulesetVersion: QUESTION_HEALTH_RULESET_VERSION,
    severity: "advisory",
    questionIndex: input.questionIndex,
    fieldPath: `questions.${input.questionIndex}.${input.localPath}`,
    contentHash,
    reason: input.reason,
    evidence: input.evidence,
    recommendedAction: input.recommendedAction,
  };
}

function choiceFindings(question: ChoiceQuestion, questionIndex: number) {
  const findings: QuestionHealthFinding[] = [];
  const normalizedChoices = question.choices.map((choice) => normalizedText(choice.label));

  for (let index = 0; index < question.choices.length; index += 1) {
    const choice = question.choices[index]!;
    const normalized = normalizedChoices[index]!;
    const duplicateIndex = normalizedChoices.findIndex(
      (candidate, candidateIndex) => candidateIndex < index && candidate === normalized,
    );
    if (normalized && duplicateIndex >= 0) {
      findings.push(
        finding({
          ruleId: "choice.duplicate",
          question,
          questionIndex,
          localPath: `choices.${index}.label`,
          discriminator: String(duplicateIndex),
          reason: "Two choices normalize to the same answer.",
          evidence: `Choice ${index + 1} duplicates an earlier choice.`,
          recommendedAction: "Remove the duplicate or make the alternatives meaningfully distinct.",
        }),
      );
    }

    if (
      question.type !== "poll" &&
      !choice.isCorrect &&
      !choice.feedback?.trim() &&
      !choice.misconceptionKey?.trim()
    ) {
      findings.push(
        finding({
          ruleId: "choice.missing_rationale",
          question,
          questionIndex,
          localPath: `choices.${index}.feedback`,
          reason: "This distractor has no feedback or misconception rationale.",
          evidence: `Incorrect choice ${index + 1} has no authored purpose signal.`,
          recommendedAction:
            "Add concise feedback or a misconception key that explains why this option is tempting.",
        }),
      );
    }
  }

  for (let leftIndex = 0; leftIndex < question.choices.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < question.choices.length; rightIndex += 1) {
      const left = normalizedChoices[leftIndex]!;
      const right = normalizedChoices[rightIndex]!;
      if (!left || !right || left === right) continue;
      const contained =
        Math.min(left.length, right.length) >= 8 && (left.includes(right) || right.includes(left));
      if (!contained && tokenOverlap(left, right) < 0.85) continue;
      findings.push(
        finding({
          ruleId: "choice.overlap",
          question,
          questionIndex,
          localPath: `choices.${rightIndex}.label`,
          discriminator: String(leftIndex),
          reason:
            "Two choices substantially overlap, which may make more than one answer defensible.",
          evidence: `Choices ${leftIndex + 1} and ${rightIndex + 1} share most of their wording.`,
          recommendedAction: "Rewrite the choices so each represents one distinct response.",
        }),
      );
    }
  }

  if (question.type !== "poll" && question.choices.length >= 3) {
    const lengths = normalizedChoices.map((choice) => choice.length);
    const longest = Math.max(...lengths);
    const longestIndex = lengths.indexOf(longest);
    const remaining = lengths.filter((_, index) => index !== longestIndex);
    const comparison = Math.max(...remaining);
    if (longest >= comparison * 1.6 && longest - comparison >= 20) {
      findings.push(
        finding({
          ruleId: "choice.length_cue",
          question,
          questionIndex,
          localPath: `choices.${longestIndex}.label`,
          reason: "One choice is much longer than every alternative and may cue the answer.",
          evidence: `Choice ${longestIndex + 1} is at least 60% longer than the next-longest choice.`,
          recommendedAction: "Balance the level of detail across the choices.",
        }),
      );
    }
  }

  return findings;
}

function questionFindings(question: QuestionDraft, questionIndex: number) {
  const findings: QuestionHealthFinding[] = [];
  const scoredPurpose = questionPurpose(question) !== "opinion";
  if (scoredPurpose && !question.explanation.trim()) {
    findings.push(
      finding({
        ruleId: "question.missing_explanation",
        question,
        questionIndex,
        localPath: "explanation",
        reason: "The checkpoint has no explanation for the revealed result.",
        evidence: "The explanation field is empty.",
        recommendedAction: "Add a concise explanation of the reasoning behind the answer.",
      }),
    );
  }
  if (scoredPurpose && (question.sourceCitations?.length ?? 0) === 0) {
    findings.push(
      finding({
        ruleId: "question.missing_citation",
        question,
        questionIndex,
        localPath: "sourceCitations",
        reason: "No source citation is attached to this knowledge checkpoint.",
        evidence: "The citation list is empty.",
        recommendedAction: "Attach a reviewed source citation or deliberately dismiss this advice.",
      }),
    );
  }

  if (question.prompt.trim().length > 240) {
    findings.push(
      finding({
        ruleId: "question.dense_content",
        question,
        questionIndex,
        localPath: "prompt",
        reason: "The prompt may be difficult to scan on a small screen.",
        evidence: "The prompt exceeds a conservative prototype mobile-density threshold.",
        recommendedAction: "Shorten the prompt and test the checkpoint at 200% zoom.",
      }),
    );
  }

  if (isChoiceQuestion(question)) {
    for (const [choiceIndex, choice] of question.choices.entries()) {
      if (choice.label.trim().length <= 140) continue;
      findings.push(
        finding({
          ruleId: "question.dense_content",
          question,
          questionIndex,
          localPath: `choices.${choiceIndex}.label`,
          reason: "This choice may be difficult to scan on a small screen.",
          evidence: `Choice ${choiceIndex + 1} exceeds a conservative prototype mobile-density threshold.`,
          recommendedAction: "Shorten the choice and test the checkpoint at 200% zoom.",
        }),
      );
    }

    const choiceCharacters = question.choices.reduce(
      (total, choice) => total + choice.label.trim().length,
      0,
    );
    if (choiceCharacters > 600) {
      findings.push(
        finding({
          ruleId: "question.dense_content",
          question,
          questionIndex,
          localPath: "choices",
          reason: "The choice set may be difficult to scan on a small screen.",
          evidence: "The combined choice text exceeds a conservative mobile-density threshold.",
          recommendedAction: "Shorten the choices and test the checkpoint at 200% zoom.",
        }),
      );
    }
  }

  const supportsPublishValidOpinionConfiguration = ![
    "poll",
    "rating",
    "ranking",
    "open_text",
    "word_cloud",
  ].includes(question.type);
  const opinionConfigurationMismatch =
    supportsPublishValidOpinionConfiguration &&
    questionPurpose(question) === "opinion" &&
    (question.basePoints !== 0 || questionConfidence(question) !== "off");
  if (opinionConfigurationMismatch) {
    findings.push(
      finding({
        ruleId: "question.configuration_mismatch",
        question,
        questionIndex,
        localPath: "purpose",
        reason: "An opinion checkpoint is configured with scoring or confidence.",
        evidence: "Purpose, scoring, confidence, and delivery settings do not describe one intent.",
        recommendedAction: "Align the checkpoint settings with its intended role in the session.",
      }),
    );
  }

  if (isChoiceQuestion(question)) findings.push(...choiceFindings(question, questionIndex));
  return findings;
}

function recheckFindings(quiz: QuizDraft) {
  const findings: QuestionHealthFinding[] = [];
  for (const [questionIndex, source] of quiz.questions.entries()) {
    if (!source.linkedRecheckQuestionId) continue;
    const recheck = quiz.questions.find(
      (candidate) => candidate.id === source.linkedRecheckQuestionId,
    );
    if (!recheck) continue;

    if (normalizedText(source.prompt) === normalizedText(recheck.prompt)) {
      findings.push(
        finding({
          ruleId: "recheck.same_prompt",
          question: source,
          questionIndex,
          localPath: "linkedRecheckQuestionId",
          discriminator: stableHash(recheck.id),
          relatedQuestion: recheck,
          reason: "The linked recheck repeats the source prompt.",
          evidence:
            "The prompts are identical after case, punctuation, and whitespace normalization.",
          recommendedAction:
            "Ask learners to apply the same concept in a meaningfully different prompt.",
        }),
      );
    }

    const sourceConcepts = normalizedConcepts(source);
    const recheckConcepts = new Set(normalizedConcepts(recheck));
    if (
      sourceConcepts.length === 0 ||
      !sourceConcepts.some((concept) => recheckConcepts.has(concept))
    ) {
      findings.push(
        finding({
          ruleId: "recheck.concept_mismatch",
          question: source,
          questionIndex,
          localPath: "linkedRecheckQuestionId",
          discriminator: stableHash(recheck.id),
          relatedQuestion: recheck,
          reason: "The source and linked recheck have no normalized concept key in common.",
          evidence: "Concept metadata does not establish that the recheck measures the same idea.",
          recommendedAction: "Add one shared, reviewed concept key or select a different recheck.",
        }),
      );
    }
  }
  return findings;
}

export function evaluateQuestionHealth(quiz: QuizDraft): QuestionHealthResult {
  const findings = quiz.questions.flatMap((question, index) => questionFindings(question, index));
  findings.push(...recheckFindings(quiz));
  return {
    rulesetVersion: QUESTION_HEALTH_RULESET_VERSION,
    evaluatedQuestionCount: quiz.questions.length,
    findings,
  };
}

export function createQuestionHealthFindingEvaluation(
  findingToEvaluate: Pick<QuestionHealthFinding, "ruleId" | "ruleVersion" | "rulesetVersion">,
  usefulness: QuestionHealthUsefulnessDisposition,
  outcome: QuestionHealthOutcomeDisposition,
): QuestionHealthFindingEvaluation {
  return {
    ruleId: findingToEvaluate.ruleId,
    ruleVersion: findingToEvaluate.ruleVersion,
    rulesetVersion: findingToEvaluate.rulesetVersion,
    usefulness,
    outcome,
  };
}
