import {
  questionConfidence,
  questionDelivery,
  questionPurpose,
  type QuestionDraft,
  type QuestionHealthFinding,
  type QuestionHealthResult,
  type QuestionHealthRuleId,
  type QuizDraft,
} from "@openround/contracts";

export const QUESTION_HEALTH_RULESET_VERSION = "1.0.0" as const;
export const QUESTION_HEALTH_MAX_FINDINGS = 1_000;

type ChoiceQuestion = Extract<QuestionDraft, { choices: unknown }>;

interface FindingDraft {
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

function normalizedText(value: string) {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function normalizedConcept(value: string) {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(/[^\p{L}\p{N}._-]+/gu, "")
    .replace(/^[._-]+|[._-]+$/g, "");
}

function normalizedConcepts(question: QuestionDraft) {
  return [...new Set((question.conceptKeys ?? []).map(normalizedConcept).filter(Boolean))].sort();
}

function isChoiceQuestion(question: QuestionDraft): question is ChoiceQuestion {
  return "choices" in question;
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
            id: choice.id,
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

async function sha256(value: string) {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function tokenOverlap(left: string, right: string) {
  const leftTokens = new Set(normalizedText(left).split(" ").filter(Boolean));
  const rightTokens = new Set(normalizedText(right).split(" ").filter(Boolean));
  if (leftTokens.size === 0 || rightTokens.size === 0) return 0;
  const intersection = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  return intersection / Math.min(leftTokens.size, rightTokens.size);
}

function choiceFindings(question: ChoiceQuestion, questionIndex: number): FindingDraft[] {
  const findings: FindingDraft[] = [];
  const normalizedChoices = question.choices.map((choice) => normalizedText(choice.label));

  for (let index = 0; index < question.choices.length; index += 1) {
    const choice = question.choices[index]!;
    const normalized = normalizedChoices[index]!;
    const duplicateIndex = normalizedChoices.findIndex(
      (candidate, candidateIndex) => candidateIndex < index && candidate === normalized,
    );
    if (normalized && duplicateIndex >= 0) {
      findings.push({
        ruleId: "choice.duplicate",
        question,
        questionIndex,
        localPath: `choices.${index}.label`,
        discriminator: String(duplicateIndex),
        reason: "Two choices normalize to the same answer.",
        evidence: `Choice ${index + 1} duplicates an earlier choice.`,
        recommendedAction: "Remove the duplicate or make the alternatives meaningfully distinct.",
      });
    }

    if (
      question.type !== "poll" &&
      !choice.isCorrect &&
      !choice.feedback?.trim() &&
      !choice.misconceptionKey?.trim()
    ) {
      findings.push({
        ruleId: "choice.missing_rationale",
        question,
        questionIndex,
        localPath: `choices.${index}.feedback`,
        reason: "This distractor has no feedback or misconception rationale.",
        evidence: `Incorrect choice ${index + 1} has no authored purpose signal.`,
        recommendedAction:
          "Add concise feedback or a misconception key that explains why this option is tempting.",
      });
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
      findings.push({
        ruleId: "choice.overlap",
        question,
        questionIndex,
        localPath: `choices.${rightIndex}.label`,
        discriminator: String(leftIndex),
        reason:
          "Two choices substantially overlap, which may make more than one answer defensible.",
        evidence: `Choices ${leftIndex + 1} and ${rightIndex + 1} share most of their wording.`,
        recommendedAction: "Rewrite the choices so each represents one distinct response.",
      });
    }
  }

  if (question.type !== "poll" && question.choices.length >= 3) {
    const lengths = normalizedChoices.map((choice) => choice.length);
    const longest = Math.max(...lengths);
    const longestIndex = lengths.indexOf(longest);
    const remaining = lengths.filter((_, index) => index !== longestIndex);
    const comparison = Math.max(...remaining);
    if (longest >= comparison * 1.6 && longest - comparison >= 20) {
      findings.push({
        ruleId: "choice.length_cue",
        question,
        questionIndex,
        localPath: `choices.${longestIndex}.label`,
        reason: "One choice is much longer than every alternative and may cue the answer.",
        evidence: `Choice ${longestIndex + 1} is at least 60% longer than the next-longest choice.`,
        recommendedAction: "Balance the level of detail across the choices.",
      });
    }
  }

  return findings;
}

function questionFindings(question: QuestionDraft, questionIndex: number): FindingDraft[] {
  const findings: FindingDraft[] = [];
  const scoredPurpose = questionPurpose(question) !== "opinion";
  if (scoredPurpose && !question.explanation.trim()) {
    findings.push({
      ruleId: "question.missing_explanation",
      question,
      questionIndex,
      localPath: "explanation",
      reason: "The checkpoint has no explanation for the revealed result.",
      evidence: "The explanation field is empty.",
      recommendedAction: "Add a concise explanation of the reasoning behind the answer.",
    });
  }
  if (scoredPurpose && (question.sourceCitations?.length ?? 0) === 0) {
    findings.push({
      ruleId: "question.missing_citation",
      question,
      questionIndex,
      localPath: "sourceCitations",
      reason: "No source citation is attached to this knowledge checkpoint.",
      evidence: "The citation list is empty.",
      recommendedAction: "Attach a reviewed source citation or deliberately dismiss this advice.",
    });
  }

  if (question.prompt.trim().length > 240) {
    findings.push({
      ruleId: "question.dense_content",
      question,
      questionIndex,
      localPath: "prompt",
      reason: "The prompt may be difficult to scan on a small screen.",
      evidence: "The prompt exceeds a conservative mobile-density threshold.",
      recommendedAction: "Shorten the prompt and test the checkpoint at 200% zoom.",
    });
  }

  if (isChoiceQuestion(question)) {
    for (const [choiceIndex, choice] of question.choices.entries()) {
      if (choice.label.trim().length <= 140) continue;
      findings.push({
        ruleId: "question.dense_content",
        question,
        questionIndex,
        localPath: `choices.${choiceIndex}.label`,
        reason: "This choice may be difficult to scan on a small screen.",
        evidence: `Choice ${choiceIndex + 1} exceeds a conservative mobile-density threshold.`,
        recommendedAction: "Shorten the choice and test the checkpoint at 200% zoom.",
      });
    }

    const choiceCharacters = question.choices.reduce(
      (total, choice) => total + choice.label.trim().length,
      0,
    );
    if (choiceCharacters > 600) {
      findings.push({
        ruleId: "question.dense_content",
        question,
        questionIndex,
        localPath: "choices",
        reason: "The choice set may be difficult to scan on a small screen.",
        evidence: "The combined choice text exceeds a conservative mobile-density threshold.",
        recommendedAction: "Shorten the choices and test the checkpoint at 200% zoom.",
      });
    }
  }

  const supportsPublishValidOpinionConfiguration = ![
    "poll",
    "rating",
    "ranking",
    "open_text",
    "word_cloud",
  ].includes(question.type);
  if (
    supportsPublishValidOpinionConfiguration &&
    questionPurpose(question) === "opinion" &&
    (question.basePoints !== 0 || questionConfidence(question) !== "off")
  ) {
    findings.push({
      ruleId: "question.configuration_mismatch",
      question,
      questionIndex,
      localPath: "purpose",
      reason: "An opinion checkpoint is configured with scoring or confidence.",
      evidence: "Purpose, scoring, confidence, and delivery settings do not describe one intent.",
      recommendedAction: "Align the checkpoint settings with its intended role in the session.",
    });
  }

  if (isChoiceQuestion(question)) findings.push(...choiceFindings(question, questionIndex));
  return findings;
}

function recheckFindings(quiz: QuizDraft): FindingDraft[] {
  const findings: FindingDraft[] = [];
  for (const [questionIndex, source] of quiz.questions.entries()) {
    if (!source.linkedRecheckQuestionId) continue;
    const recheck = quiz.questions.find(
      (candidate) => candidate.id === source.linkedRecheckQuestionId,
    );
    if (!recheck) continue;

    if (normalizedText(source.prompt) === normalizedText(recheck.prompt)) {
      findings.push({
        ruleId: "recheck.same_prompt",
        question: source,
        relatedQuestion: recheck,
        questionIndex,
        localPath: "linkedRecheckQuestionId",
        discriminator: recheck.id,
        reason: "The linked recheck repeats the source prompt.",
        evidence:
          "The prompts are identical after case, punctuation, and whitespace normalization.",
        recommendedAction:
          "Ask learners to apply the same concept in a meaningfully different prompt.",
      });
    }

    const sourceConcepts = normalizedConcepts(source);
    const recheckConcepts = new Set(normalizedConcepts(recheck));
    if (
      sourceConcepts.length === 0 ||
      !sourceConcepts.some((concept) => recheckConcepts.has(concept))
    ) {
      findings.push({
        ruleId: "recheck.concept_mismatch",
        question: source,
        relatedQuestion: recheck,
        questionIndex,
        localPath: "linkedRecheckQuestionId",
        discriminator: recheck.id,
        reason: "The source and linked recheck have no normalized concept key in common.",
        evidence: "Concept metadata does not establish that the recheck measures the same idea.",
        recommendedAction: "Add one shared, reviewed concept key or select a different recheck.",
      });
    }
  }
  return findings;
}

function findingId(finding: FindingDraft) {
  const field = finding.localPath.replaceAll(".", "-");
  return `qh-${QUESTION_HEALTH_RULESET_VERSION}-${finding.ruleId}-${finding.question.id}-${field}${finding.discriminator ? `-${finding.discriminator}` : ""}`;
}

/**
 * Deterministic, read-only quality advice for a Round draft. Fingerprints use Web Crypto SHA-256
 * so finding dismissals can be invalidated safely when the relevant authored content changes.
 */
export async function evaluateQuestionHealth(
  quiz: QuizDraft,
  options: {
    quizId: string;
    draftRevision: number;
    includeFindingIds?: ReadonlySet<string>;
    includeQuestionIds?: ReadonlySet<string>;
  },
): Promise<QuestionHealthResult> {
  const questionHashes = await Promise.all(
    quiz.questions.map((question) => sha256(questionContent(question))),
  );
  const drafts = [
    ...quiz.questions.flatMap((question, index) => questionFindings(question, index)),
    ...recheckFindings(quiz),
  ];
  const included = options.includeFindingIds;
  const includedQuestions = options.includeQuestionIds;
  const prioritize = Boolean(included?.size || includedQuestions?.size);
  const selected = prioritize
    ? drafts
        .filter(
          (draft) => included?.has(findingId(draft)) || includedQuestions?.has(draft.question.id),
        )
        .slice(0, QUESTION_HEALTH_MAX_FINDINGS)
    : drafts.slice(0, QUESTION_HEALTH_MAX_FINDINGS);
  if (prioritize && selected.length < QUESTION_HEALTH_MAX_FINDINGS) {
    for (const draft of drafts) {
      if (selected.length === QUESTION_HEALTH_MAX_FINDINGS) break;
      if (!included?.has(findingId(draft)) && !includedQuestions?.has(draft.question.id))
        selected.push(draft);
    }
  }
  const pairHashes = new Map<string, Promise<string>>();
  const findings: QuestionHealthFinding[] = await Promise.all(
    selected.map(async (draft) => {
      let contentHash = questionHashes[draft.questionIndex]!;
      if (draft.relatedQuestion) {
        const pairKey = `${draft.question.id}:${draft.relatedQuestion.id}`;
        let pairHash = pairHashes.get(pairKey);
        if (!pairHash) {
          const relatedIndex = quiz.questions.findIndex(
            (candidate) => candidate.id === draft.relatedQuestion!.id,
          );
          pairHash = sha256(JSON.stringify([contentHash, questionHashes[relatedIndex]]));
          pairHashes.set(pairKey, pairHash);
        }
        contentHash = await pairHash;
      }
      return {
        id: findingId(draft),
        ruleId: draft.ruleId,
        ruleVersion: 1,
        rulesetVersion: QUESTION_HEALTH_RULESET_VERSION,
        severity: "advisory",
        questionId: draft.question.id,
        fieldPath: `questions.${draft.questionIndex}.${draft.localPath}`,
        contentHash,
        reason: draft.reason,
        evidence: draft.evidence,
        recommendedAction: draft.recommendedAction,
      };
    }),
  );

  return {
    quizId: options.quizId,
    draftRevision: options.draftRevision,
    rulesetVersion: QUESTION_HEALTH_RULESET_VERSION,
    evaluatedQuestionCount: quiz.questions.length,
    findings,
    findingsTruncated: drafts.length > selected.length,
    dismissals: [],
  };
}
