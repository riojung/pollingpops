import { z } from "zod";
import {
  SurveyBranchingContentSchema,
  surveyBranchingEligibility,
  validateSurveyBranchingResponses,
  type SurveyBranchingDraft,
} from "./survey-branching";
import { SurveyResponsesSchema, type SurveyResponses } from "./surveys";

/** Proposed results version, independent of conditional Survey content version 4. */
export const PROPOSED_SURVEY_BRANCHING_AGGREGATE_SCHEMA_VERSION = 3;
export const SURVEY_BRANCHING_RESULTS_SOURCE_SCHEMA_VERSION = 4;
export const SURVEY_BRANCHING_RESULTS_MINIMUM_RESPONDENTS = 5;

export type SurveyBranchingResultsInputErrorCode =
  "INVALID_SURVEY_BRANCHING_CONTENT" | "INVALID_SURVEY_BRANCHING_SUBMISSIONS";

/** No validation issues, row positions, response values, or original causes are attached. */
export class SurveyBranchingResultsInputError extends Error {
  constructor(public readonly code: SurveyBranchingResultsInputErrorCode) {
    super(
      code === "INVALID_SURVEY_BRANCHING_CONTENT"
        ? "Expected valid published conditional Survey content"
        : "Expected valid finalized conditional Survey submissions",
    );
    this.name = "SurveyBranchingResultsInputError";
  }
}

const questionMetadata = {
  id: z.string().uuid(),
  prompt: z.string().min(1).max(2_000),
  distributionPercentBasis: z.literal("answered_respondents"),
  responseCoverageBasis: z.literal("eligible_submissions"),
};
const withheldQuestionEvidence = {
  eligibleCount: z.null(),
  answeredCount: z.null(),
  unansweredCount: z.null(),
  skippedLogicCount: z.null(),
  suppressed: z.literal(true),
  distribution: z.array(z.never()).max(0),
};

/** C1 cannot encode released evidence, even for large or apparently simple branch cohorts. */
export const SurveyBranchingSuppressedQuestionSchema = z.discriminatedUnion("type", [
  z
    .object({
      ...questionMetadata,
      type: z.literal("poll"),
      maxSelections: z.number().int().min(1).max(6),
      ...withheldQuestionEvidence,
    })
    .strict(),
  z
    .object({
      ...questionMetadata,
      type: z.literal("rating"),
      ...withheldQuestionEvidence,
    })
    .strict(),
]);
export type SurveyBranchingSuppressedQuestion = z.infer<
  typeof SurveyBranchingSuppressedQuestionSchema
>;

/**
 * Suppressed-only transport proposal. This is not a qualified privacy policy or runtime
 * results grant. No caller option can release counts, branch membership, or distributions.
 */
export const SurveyBranchingSuppressedResultsSchema = z
  .object({
    schemaVersion: z.literal(PROPOSED_SURVEY_BRANCHING_AGGREGATE_SCHEMA_VERSION),
    sourceSchemaVersion: z.literal(SURVEY_BRANCHING_RESULTS_SOURCE_SCHEMA_VERSION),
    title: z.string().min(1).max(160),
    submittedCount: z.null(),
    suppressed: z.literal(true),
    resultsStatus: z.enum(["collecting", "privacy_review_required"]),
    minimumRespondents: z.literal(SURVEY_BRANCHING_RESULTS_MINIMUM_RESPONDENTS),
    questions: z.array(SurveyBranchingSuppressedQuestionSchema).min(1).max(100),
  })
  .strict()
  .refine(
    (results) =>
      new Set(results.questions.map((question) => question.id)).size === results.questions.length,
    "Survey result question IDs must be unique",
  );
export type SurveyBranchingSuppressedResults = z.infer<
  typeof SurveyBranchingSuppressedResultsSchema
>;

interface AnalysisQuestionEvidence {
  eligibleCount: number;
  answeredCount: number;
  unansweredCount: number;
  skippedLogicCount: number;
  distribution: { label: string; count: number }[];
}
type AnalysisQuestionMetadata =
  | {
      id: string;
      prompt: string;
      type: "poll";
      maxSelections: number;
      distributionPercentBasis: "answered_respondents";
      responseCoverageBasis: "eligible_submissions";
    }
  | {
      id: string;
      prompt: string;
      type: "rating";
      distributionPercentBasis: "answered_respondents";
      responseCoverageBasis: "eligible_submissions";
    };
export type SurveyBranchingFinalizedQuestionAnalysis = AnalysisQuestionMetadata &
  AnalysisQuestionEvidence;

/**
 * INTERNAL aggregate-only qualification evidence, not a facilitator/public response DTO.
 * Counts are submissions, not verified people or page visits. Do not serialize this analysis
 * into reports, summaries, exports, logs, or account data. C2 must qualify any future release.
 */
export interface SurveyBranchingFinalizedAnalysis {
  submittedCount: number;
  questions: SurveyBranchingFinalizedQuestionAnalysis[];
}

const finalizedSubmissionsSchema = z.array(
  z.object({ finalized: z.literal(true), responses: z.unknown() }).strict(),
);

function parseContent(input: unknown): SurveyBranchingDraft {
  try {
    const content = SurveyBranchingContentSchema.safeParse(input);
    if (content.success) return content.data;
  } catch {
    // Unknown objects can throw while being inspected. Never retain their error payload.
  }
  throw new SurveyBranchingResultsInputError("INVALID_SURVEY_BRANCHING_CONTENT");
}

function parseFinalizedResponses(content: SurveyBranchingDraft, input: unknown): SurveyResponses[] {
  try {
    const submissions = finalizedSubmissionsSchema.safeParse(input);
    if (submissions.success) {
      const responses: SurveyResponses[] = [];
      for (const submission of submissions.data) {
        // Canonicalize once, then validate and count that exact stable response map.
        const normalized = SurveyResponsesSchema.parse(submission.responses);
        // Validation rejects hidden answers; cleanup must never approve a stored final row.
        if (validateSurveyBranchingResponses(content, normalized, true).length) break;
        responses.push(normalized);
      }
      if (responses.length === submissions.data.length) return responses;
    }
  } catch {
    // Neither Zod diagnostics nor an input object's exception can cross this boundary.
  }
  throw new SurveyBranchingResultsInputError("INVALID_SURVEY_BRANCHING_SUBMISSIONS");
}

function metadataForQuestion(
  question: SurveyBranchingDraft["items"][number]["question"],
): AnalysisQuestionMetadata {
  const common = {
    id: question.id,
    prompt: question.prompt,
    distributionPercentBasis: "answered_respondents" as const,
    responseCoverageBasis: "eligible_submissions" as const,
  };
  if (question.type === "poll")
    return { ...common, type: "poll", maxSelections: question.maxSelections ?? 1 };
  if (question.type === "rating") return { ...common, type: "rating" };
  throw new SurveyBranchingResultsInputError("INVALID_SURVEY_BRANCHING_CONTENT");
}

function analyzeParsedResponses(
  content: SurveyBranchingDraft,
  responses: SurveyResponses[],
): SurveyBranchingFinalizedAnalysis {
  const eligibleCounts = new Map(content.items.map(({ question }) => [question.id, 0]));
  for (const row of responses)
    for (const id of surveyBranchingEligibility(content, row).eligibleQuestionIds)
      eligibleCounts.set(id, eligibleCounts.get(id)! + 1);
  return {
    submittedCount: responses.length,
    questions: content.items.map(({ question }) => {
      const eligibleCount = eligibleCounts.get(question.id)!;
      const answeredCount = responses.filter((row) => Object.hasOwn(row, question.id)).length;
      return {
        ...metadataForQuestion(question),
        eligibleCount,
        answeredCount,
        unansweredCount: eligibleCount - answeredCount,
        skippedLogicCount: responses.length - eligibleCount,
        distribution:
          question.type === "poll"
            ? question.choices.map((choice) => ({
                label: choice.label,
                count: responses.filter((row) => {
                  const answer = row[question.id];
                  return answer?.kind === "poll" && answer.choiceIds.includes(choice.id);
                }).length,
              }))
            : question.type === "rating"
              ? Array.from({ length: question.max - question.min + 1 }, (_, offset) => ({
                  label: String(question.min + offset),
                  count: responses.filter((row) => {
                    const answer = row[question.id];
                    return answer?.kind === "rating" && answer.value === question.min + offset;
                  }).length,
                }))
              : [],
      };
    }),
  };
}

/** Pure, finalized-only INTERNAL analysis. Never reconciles or silently drops invalid rows. */
export function analyzeSurveyBranchingFinalizedResponses(
  content: unknown,
  submissions: unknown,
): SurveyBranchingFinalizedAnalysis {
  const parsedContent = parseContent(content);
  return analyzeParsedResponses(parsedContent, parseFinalizedResponses(parsedContent, submissions));
}

/**
 * Validate the same published/finalized inputs, but withhold the whole release regardless of
 * sample size. Closure changes the status only. This does not enable runtime results or writers.
 */
export function surveyBranchingSuppressedResults(
  content: unknown,
  submissions: unknown,
  closed = false,
): SurveyBranchingSuppressedResults {
  const parsedContent = parseContent(content);
  parseFinalizedResponses(parsedContent, submissions);
  return SurveyBranchingSuppressedResultsSchema.parse({
    schemaVersion: PROPOSED_SURVEY_BRANCHING_AGGREGATE_SCHEMA_VERSION,
    sourceSchemaVersion: SURVEY_BRANCHING_RESULTS_SOURCE_SCHEMA_VERSION,
    title: parsedContent.title,
    submittedCount: null,
    suppressed: true,
    resultsStatus: closed === true ? "privacy_review_required" : "collecting",
    minimumRespondents: SURVEY_BRANCHING_RESULTS_MINIMUM_RESPONDENTS,
    questions: parsedContent.items.map(({ question }) => ({
      ...metadataForQuestion(question),
      eligibleCount: null,
      answeredCount: null,
      unansweredCount: null,
      skippedLogicCount: null,
      distribution: [],
      suppressed: true,
    })),
  });
}

/** C2 is separate from the immutable C1 suppressed-only aggregate-v3 contract. */
export const SURVEY_BRANCHING_DISCLOSURE_AGGREGATE_SCHEMA_VERSION = 4;
export const SURVEY_BRANCHING_DISCLOSURE_PRIVACY_POLICY = "joint_contribution_atoms_v1";

const disclosedCountSchema = z
  .number()
  .int()
  .nonnegative()
  .max(Number.MAX_SAFE_INTEGER)
  .refine(
    (value) => value === 0 || value >= SURVEY_BRANCHING_RESULTS_MINIMUM_RESPONDENTS,
    "Released cohort counts must be zero or meet the minimum",
  );
const disclosureBucketSchema = z
  .object({ label: z.string().min(1).max(180), count: disclosedCountSchema })
  .strict();
const disclosedQuestionEvidence = {
  eligibleCount: disclosedCountSchema,
  answeredCount: disclosedCountSchema,
  unansweredCount: disclosedCountSchema,
  skippedLogicCount: disclosedCountSchema,
  suppressed: z.literal(false),
};
const disclosureQuestionSchema = z
  .discriminatedUnion("type", [
    z
      .object({
        ...questionMetadata,
        type: z.literal("poll"),
        maxSelections: z.number().int().min(1).max(6),
        ...disclosedQuestionEvidence,
        distribution: z.array(disclosureBucketSchema).min(2).max(6),
      })
      .strict(),
    z
      .object({
        ...questionMetadata,
        type: z.literal("rating"),
        ...disclosedQuestionEvidence,
        distribution: z.array(disclosureBucketSchema).min(2).max(10),
      })
      .strict(),
  ])
  .superRefine((question, ctx) => {
    const counts = [
      question.eligibleCount,
      question.answeredCount,
      question.unansweredCount,
      question.skippedLogicCount,
      ...question.distribution.map((bucket) => bucket.count),
    ];
    if (!counts.every(Number.isSafeInteger)) return;
    const eligible = BigInt(question.eligibleCount);
    const answered = BigInt(question.answeredCount);
    const unanswered = BigInt(question.unansweredCount);
    if (eligible !== answered + unanswered)
      ctx.addIssue({
        code: "custom",
        message: "Eligible responses must equal answered plus unanswered",
      });
    if (question.distribution.some((bucket) => bucket.count > question.answeredCount))
      ctx.addIssue({
        code: "custom",
        path: ["distribution"],
        message: "A bucket cannot exceed the answered sample",
      });
    const selections = question.distribution.reduce(
      (total, bucket) => total + BigInt(bucket.count),
      0n,
    );
    if (question.type === "rating" || question.maxSelections === 1) {
      if (selections !== answered)
        ctx.addIssue({
          code: "custom",
          path: ["distribution"],
          message: "Single-response buckets must total the answered sample",
        });
    } else if (Number.isSafeInteger(question.maxSelections)) {
      if (question.maxSelections > question.distribution.length)
        ctx.addIssue({
          code: "custom",
          path: ["maxSelections"],
          message: "Selection limit exceeds the available choices",
        });
      if (selections < answered || selections > answered * BigInt(question.maxSelections))
        ctx.addIssue({
          code: "custom",
          path: ["distribution"],
          message: "Selection totals must fit the answered sample and selection limit",
        });
    }
  });

const disclosureMetadata = {
  schemaVersion: z.literal(SURVEY_BRANCHING_DISCLOSURE_AGGREGATE_SCHEMA_VERSION),
  sourceSchemaVersion: z.literal(SURVEY_BRANCHING_RESULTS_SOURCE_SCHEMA_VERSION),
  privacyPolicy: z.literal(SURVEY_BRANCHING_DISCLOSURE_PRIVACY_POLICY),
  title: z.string().min(1).max(160),
  minimumRespondents: z.literal(SURVEY_BRANCHING_RESULTS_MINIMUM_RESPONDENTS),
};

/**
 * Structural validation cannot prove joint qualification from marginal counts. Only the
 * trusted projector below evaluates the full submitted population. No runtime grant is added.
 */
export const SurveyBranchingDisclosureResultsSchema = z
  .discriminatedUnion("resultsStatus", [
    z
      .object({
        ...disclosureMetadata,
        submittedCount: z.null(),
        suppressed: z.literal(true),
        resultsStatus: z.enum(["collecting", "privacy_withheld"]),
        questions: z.array(SurveyBranchingSuppressedQuestionSchema).min(1).max(100),
      })
      .strict(),
    z
      .object({
        ...disclosureMetadata,
        submittedCount: z
          .number()
          .int()
          .min(SURVEY_BRANCHING_RESULTS_MINIMUM_RESPONDENTS)
          .max(Number.MAX_SAFE_INTEGER),
        suppressed: z.literal(false),
        resultsStatus: z.literal("available"),
        questions: z.array(disclosureQuestionSchema).min(1).max(100),
      })
      .strict(),
  ])
  .superRefine((results, ctx) => {
    if (new Set(results.questions.map((question) => question.id)).size !== results.questions.length)
      ctx.addIssue({
        code: "custom",
        path: ["questions"],
        message: "Survey result question IDs must be unique",
      });
    if (results.resultsStatus !== "available" || !Number.isSafeInteger(results.submittedCount))
      return;
    const submitted = BigInt(results.submittedCount);
    for (const [index, question] of results.questions.entries()) {
      if (
        !Number.isSafeInteger(question.eligibleCount) ||
        !Number.isSafeInteger(question.skippedLogicCount)
      )
        continue;
      if (submitted !== BigInt(question.eligibleCount) + BigInt(question.skippedLogicCount))
        ctx.addIssue({
          code: "custom",
          path: ["questions", index],
          message: "Submitted responses must equal eligible plus logic-skipped",
        });
    }
  });
export type SurveyBranchingDisclosureResults = z.infer<
  typeof SurveyBranchingDisclosureResultsSchema
>;

/** Private complete contribution patterns; never expose signatures, frequencies, or diagnostics. */
function jointContributionAtomsMeetMinimum(
  content: SurveyBranchingDraft,
  responses: SurveyResponses[],
) {
  if (responses.length < SURVEY_BRANCHING_RESULTS_MINIMUM_RESPONDENTS) return false;
  const atoms = new Map<string, number>();
  for (const row of responses) {
    const eligible = new Set(surveyBranchingEligibility(content, row).eligibleQuestionIds);
    const signature: number[] = [];
    for (const { question } of content.items) {
      if (!eligible.has(question.id)) {
        signature.push(0, 0); // Logic-skipped, with no answer contribution.
        continue;
      }
      const answer = row[question.id];
      if (!answer) {
        signature.push(1, 0); // Eligible, but unanswered.
        continue;
      }
      // Frozen choice positions distinguish complete selection sets, even with equal labels.
      if (question.type === "poll" && answer.kind === "poll") {
        const selected = new Set(answer.choiceIds);
        const mask = question.choices.reduce(
          (value, choice, index) => value | (selected.has(choice.id) ? 1 << index : 0),
          0,
        );
        signature.push(2, mask);
      } else if (question.type === "rating" && answer.kind === "rating") {
        signature.push(2, answer.value);
      } else {
        throw new SurveyBranchingResultsInputError("INVALID_SURVEY_BRANCHING_SUBMISSIONS");
      }
    }
    const key = JSON.stringify(signature);
    atoms.set(key, (atoms.get(key) ?? 0) + 1);
  }
  return [...atoms.values()].every(
    (count) => count >= SURVEY_BRANCHING_RESULTS_MINIMUM_RESPONDENTS,
  );
}

/**
 * Candidate C2 policy for one fixed closed report: every Boolean cohort over its contribution
 * predicates is a union of full atoms. This is not differential privacy, side-information
 * protection, a finalization proof, or permission for repeated snapshots/runtime collection.
 */
export function surveyBranchingDisclosureResults(
  content: unknown,
  submissions: unknown,
  closed = false,
): SurveyBranchingDisclosureResults {
  const parsedContent = parseContent(content);
  const responses = parseFinalizedResponses(parsedContent, submissions);
  const metadata = {
    schemaVersion: SURVEY_BRANCHING_DISCLOSURE_AGGREGATE_SCHEMA_VERSION,
    sourceSchemaVersion: SURVEY_BRANCHING_RESULTS_SOURCE_SCHEMA_VERSION,
    privacyPolicy: SURVEY_BRANCHING_DISCLOSURE_PRIVACY_POLICY,
    title: parsedContent.title,
    minimumRespondents: SURVEY_BRANCHING_RESULTS_MINIMUM_RESPONDENTS,
  };
  if (closed !== true || !jointContributionAtomsMeetMinimum(parsedContent, responses))
    return SurveyBranchingDisclosureResultsSchema.parse({
      ...metadata,
      submittedCount: null,
      suppressed: true,
      resultsStatus: closed === true ? "privacy_withheld" : "collecting",
      questions: parsedContent.items.map(({ question }) => ({
        ...metadataForQuestion(question),
        eligibleCount: null,
        answeredCount: null,
        unansweredCount: null,
        skippedLogicCount: null,
        distribution: [],
        suppressed: true,
      })),
    });
  const analysis = analyzeParsedResponses(parsedContent, responses);
  return SurveyBranchingDisclosureResultsSchema.parse({
    ...metadata,
    submittedCount: analysis.submittedCount,
    suppressed: false,
    resultsStatus: "available",
    questions: analysis.questions.map((question) => ({ ...question, suppressed: false })),
  });
}
