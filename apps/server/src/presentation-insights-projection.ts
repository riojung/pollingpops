import {
  PresentationReportSchema,
  PresentationSessionInsightsSchema,
  PresentationSessionInsightsQnaSchema,
  questionDelivery,
  isPresentationOpinionResultQuestion,
  questionTypeDefinition,
  isPresentationTextResultQuestion,
  type PresentationReport,
  type PresentationBlock,
  type PresentationInsightsCoverage,
  type PresentationInsightsPurpose,
  type PresentationInsightsQuestion,
  type PresentationSessionInsights,
  type PresentationSessionInsightsQna,
} from "@openround/contracts";
import type { PresentationSessionRecord, PresentationVersionRecord } from "@openround/db";
import { summaryPlainText } from "./session-summary-projection.js";

export class PresentationInsightsProjectionError extends Error {
  readonly code = "INSIGHTS_UNAVAILABLE";
  constructor() {
    super(
      "Session insights are unavailable because the retained evidence could not be reconciled.",
    );
    this.name = "PresentationInsightsProjectionError";
  }
}
export interface PresentationInsightsRosterCount {
  blockId: string;
  sequence: number;
  /** Null is an unavailable legacy roster; zero is a recorded empty roster. */
  participantCount: number | null;
}
export interface PresentationInsightsOpinionCount {
  blockId: string;
  responseCount: number;
  /** Authored choice UUIDs or canonical integer rating values, with no entered text. */
  buckets: { key: string; count: number }[];
}
export interface PresentationInsightsProjectionInput {
  session: PresentationSessionRecord;
  report: PresentationReport;
  reportGeneratedAt: Date;
  publishedVersion: PresentationVersionRecord | null;
  rosterCounts: PresentationInsightsRosterCount[];
  opinionCounts?: PresentationInsightsOpinionCount[];
  qna: PresentationSessionInsightsQna;
  calculatedAt: Date;
}
type Evidence = PresentationReport["evidence"][number];
type QuestionEvidence = Extract<Evidence, { kind: "question" }>;
type DeliveryBlock = PresentationSessionInsights["delivery"]["blocks"][number];
const key = (id: string) => id.toLowerCase();
const equalId = (left: string, right: string) => key(left) === key(right);
const percentage = (value: number, denominator: number) =>
  denominator ? Math.round((value / denominator) * 1000) / 10 : null;
const entryTypes = new Set([
  "content.presented",
  "question.launched",
  "navigation.jumped",
  "navigation.returned",
  "navigation.revisited",
  "navigation.branched",
]);
const displayTypes = new Set([...entryTypes, "question.revealed", "intervention.presented"]);
function unavailable(): never {
  throw new PresentationInsightsProjectionError();
}
function iso(value: Date) {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) unavailable();
  return value.toISOString();
}
function purpose(
  block: PresentationBlock | undefined,
  quickCheckId: string | undefined,
): PresentationInsightsPurpose {
  if (!block) return "unknown";
  if (block.kind === "content") return "content";
  if (quickCheckId && equalId(block.id, quickCheckId)) return "quick_check";
  if (isPresentationTextResultQuestion(block.question)) return "text";
  if (
    block.question.type === "poll" ||
    block.question.type === "rating" ||
    isPresentationOpinionResultQuestion(block.question)
  )
    return "opinion";
  return questionTypeDefinition(block.question.type).scored ? "assessment" : "unknown";
}
function coverage(blocks: DeliveryBlock[]): PresentationInsightsCoverage {
  const presentedBlocks = blocks.filter((block) => block.status === "presented").length;
  const skippedBlocks = blocks.filter((block) => block.status === "skipped").length;
  const unknownBlocks = blocks.length - presentedBlocks - skippedBlocks;
  return {
    totalBlocks: blocks.length,
    presentedBlocks,
    skippedBlocks,
    unknownBlocks,
    coveragePercent: unknownBlocks ? null : percentage(presentedBlocks, blocks.length),
  };
}
function emptyQuestion(
  blockId: string,
  activityPurpose: PresentationInsightsPurpose,
): PresentationInsightsQuestion {
  return {
    blockId,
    purpose: activityPurpose,
    status: "available",
    unavailableReason: null,
    acceptedRespondents: null,
    joinedByRevealCount: null,
    notRespondedByRevealCount: null,
    responseRatePercent: null,
    denominatorBasis: "unavailable",
    denominatorStatus: "unavailable",
    measure: "respondents",
    maxSelections: null,
    distributionStatus: ["opinion", "quick_check"].includes(activityPurpose)
      ? "unavailable"
      : "not_applicable",
    results: [],
  };
}
function questionProjection(input: {
  evidence: QuestionEvidence;
  source: PresentationBlock | undefined;
  block: DeliveryBlock;
  report: PresentationReport;
  reveal: PresentationReport["timeline"][number] | undefined;
  rosterCounts: PresentationInsightsRosterCount[];
  opinionCounts: PresentationInsightsOpinionCount[];
  semanticChoiceIds: boolean;
}): PresentationInsightsQuestion {
  const { evidence, source, block, report, rosterCounts, reveal } = input;
  const result = emptyQuestion(block.blockId, block.purpose);
  if (
    !source ||
    source.kind !== "question" ||
    source.question.type !== evidence.questionType ||
    !equalId(source.question.id, evidence.questionId) ||
    questionDelivery(source.question) !== evidence.delivery
  ) {
    return { ...result, status: "unavailable", unavailableReason: "source_unavailable" };
  }
  if (block.status === "skipped")
    return {
      ...result,
      status: "skipped",
      acceptedRespondents: 0,
      denominatorStatus: "not_revealed",
      distributionStatus: "not_applicable",
    };
  const rosters = reveal
    ? rosterCounts.filter(
        (row) => equalId(row.blockId, block.blockId) && row.sequence === reveal.sequence,
      )
    : [];
  const roster = rosters[0]?.participantCount ?? null;
  const badRoster =
    rosters.length > 1 ||
    (roster !== null &&
      (!Number.isSafeInteger(roster) ||
        roster < 0 ||
        roster > report.participantCount ||
        evidence.respondents > roster));
  const badCounts =
    evidence.respondents > report.participantCount ||
    (evidence.correct !== null && evidence.correct > evidence.respondents) ||
    badRoster;
  if (badCounts) return { ...result, status: "unavailable", unavailableReason: "count_mismatch" };
  if (evidence.respondents > 0 && evidence.respondents < 5)
    return {
      ...result,
      status: "suppressed",
      unavailableReason: "insufficient_sample",
      denominatorStatus: "suppressed",
      distributionStatus: ["opinion", "quick_check"].includes(block.purpose)
        ? "suppressed"
        : "not_applicable",
    };
  result.acceptedRespondents = evidence.respondents;
  result.denominatorStatus = !reveal
    ? "not_revealed"
    : roster === null
      ? "legacy_unavailable"
      : "recorded";
  if (roster !== null) {
    result.denominatorBasis = "joined_by_reveal";
    result.joinedByRevealCount = roster;
    result.notRespondedByRevealCount = roster - evidence.respondents;
    result.responseRatePercent = percentage(evidence.respondents, roster);
  }
  const hasDistribution = ["opinion", "quick_check"].includes(block.purpose);
  if (!hasDistribution) return result;
  if (evidence.respondents < 5) return { ...result, distributionStatus: "suppressed" };
  // Only authored choice labels from frozen non-text opinion distributions enter this resource.
  const distribution = "opinionSummary" in evidence ? evidence.opinionSummary : undefined;
  if (distribution && "choices" in source.question) {
    const choices = new Map(source.question.choices.map((choice) => [key(choice.id), choice]));
    if (
      distribution.responseCount !== evidence.respondents ||
      distribution.choices.length !== choices.size ||
      distribution.choices.some((choice) => !choices.has(key(choice.choiceId))) ||
      (distribution.kind === "poll" &&
        distribution.maxSelections !== (source.question.maxSelections ?? 1))
    )
      return result;
    result.measure = distribution.kind === "ranking" ? "weighted_points" : "respondents";
    result.maxSelections = distribution.kind === "poll" ? distribution.maxSelections : null;
    result.results = distribution.choices.map((choice) => ({
      label: summaryPlainText(choices.get(key(choice.choiceId))!.label),
      value: "count" in choice ? choice.count : choice.weightedScore,
    }));
    result.distributionStatus = "available";
    return result;
  }
  // Legacy single-selection polls and ratings have no cached report distribution. The DB
  // supplies bounded counts only; raw answers and participant identities never enter this path.
  const question = source.question;
  if (!(
    (question.type === "poll" && (question.maxSelections ?? 1) === 1) ||
    question.type === "rating"
  ))
    return result;
  const rows = input.opinionCounts.filter((row) => equalId(row.blockId, block.blockId));
  const row = rows[0];
  if (
    rows.length !== 1 ||
    !row ||
    row.responseCount !== evidence.respondents ||
    !Number.isSafeInteger(row.responseCount) ||
    !Array.isArray(row.buckets) ||
    row.buckets.length > 100
  )
    return result;
  const normalizeChoice = input.semanticChoiceIds ? key : (value: string) => value;
  let labels: { key: string; label: string }[];
  if (question.type === "rating") {
    const rating = question;
    labels = Array.from({ length: Math.min(101, rating.max - rating.min + 1) }, (_, index) => {
      const value = rating.min + index;
      const endpoint =
        value === rating.min ? rating.minLabel : value === rating.max ? rating.maxLabel : "";
      return {
        key: String(value),
        label: `${value}${endpoint ? ` — ${summaryPlainText(endpoint)}` : ""}`,
      };
    });
  } else if (question.type === "poll") {
    labels = question.choices.map((choice) => ({
      key: normalizeChoice(choice.id),
      label: summaryPlainText(choice.label),
    }));
  } else return result;
  if (
    !labels.length ||
    labels.length > 100 ||
    new Set(labels.map((label) => label.key)).size !== labels.length
  )
    return result;
  const known = new Set(labels.map((label) => label.key));
  const counts = new Map<string, number>();
  let total = 0;
  for (const bucket of row.buckets) {
    if (
      typeof bucket.key !== "string" ||
      !Number.isSafeInteger(bucket.count) ||
      bucket.count < 0 ||
      bucket.count > row.responseCount
    )
      return result;
    const bucketKey = question.type === "poll" ? normalizeChoice(bucket.key) : bucket.key;
    if (!known.has(bucketKey) || counts.has(bucketKey)) return result;
    counts.set(bucketKey, bucket.count);
    total += bucket.count;
  }
  if (total !== row.responseCount) return result;
  result.results = labels.map((label) => ({
    label: label.label,
    value: counts.get(label.key) ?? 0,
  }));
  result.maxSelections = question.type === "poll" ? 1 : null;
  result.distributionStatus = "available";
  return result;
}

/** No participant/response scans: only frozen report evidence and bounded private roster counts. */
export function projectPresentationSessionInsights(
  input: PresentationInsightsProjectionInput,
): PresentationSessionInsights {
  try {
    return project(input);
  } catch (error) {
    if (error instanceof PresentationInsightsProjectionError) throw error;
    // Validation errors can contain source values. Expose only this fixed, safe failure.
    throw new PresentationInsightsProjectionError();
  }
}
function project(input: PresentationInsightsProjectionInput): PresentationSessionInsights {
  const { session, publishedVersion } = input;
  const report = PresentationReportSchema.parse(input.report);
  if (
    session.status !== "finished" ||
    !equalId(session.id, report.sessionId) ||
    !equalId(session.presentationId, report.presentationId) ||
    !equalId(session.presentationVersionId, report.presentationVersionId) ||
    report.title !== session.title ||
    input.rosterCounts.length > 200 ||
    report.evidence.length > 200 ||
    session.content.blocks.length > 200 ||
    report.responseCount !==
      report.evidence.reduce(
        (sum, evidence) => sum + (evidence.kind === "question" ? evidence.respondents : 0),
        0,
      )
  )
    unavailable();
  const finishedAt = iso(session.finishedAt ?? session.updatedAt);
  if (finishedAt !== report.finishedAt) unavailable();
  if (
    (session.content.schemaVersion === 13 && report.schemaVersion !== 7) ||
    (session.content.schemaVersion === 12 && report.schemaVersion !== 6)
  )
    unavailable();
  const reportGeneratedAt = iso(input.reportGeneratedAt),
    calculatedAt = iso(input.calculatedAt),
    retentionExpiresAt = iso(session.retentionExpiresAt);
  if (
    publishedVersion &&
    (!equalId(publishedVersion.id, session.presentationVersionId) ||
      !equalId(publishedVersion.presentationId, session.presentationId) ||
      !equalId(publishedVersion.workspaceId, session.workspaceId) ||
      !Number.isSafeInteger(publishedVersion.version) ||
      publishedVersion.version < 1)
  )
    unavailable();
  const sources = new Map(session.content.blocks.map((block) => [key(block.id), block]));
  const evidenceIds = new Set(report.evidence.map((evidence) => key(evidence.blockId)));
  const questionIds = report.evidence.flatMap((evidence) =>
    evidence.kind === "question" ? [key(evidence.questionId)] : [],
  );
  if (
    sources.size !== session.content.blocks.length ||
    evidenceIds.size !== report.evidence.length ||
    new Set(questionIds).size !== questionIds.length ||
    new Set(report.recovery.map((row) => key(row.sourceQuestionId))).size !==
      report.recovery.length ||
    new Set(report.evidence.map((evidence) => evidence.blockIndex)).size !== report.evidence.length
  )
    unavailable();
  const navigation =
    report.schemaVersion === 6 || report.schemaVersion === 7 ? report.navigation : null;
  if (
    navigation &&
    (session.content.schemaVersion < 12 ||
      sources.size !== evidenceIds.size ||
      [...sources.keys()].some((id) => !evidenceIds.has(id)))
  )
    unavailable();
  const publishedIds = publishedVersion
    ? new Set(publishedVersion.content.blocks.map((block) => key(block.id)))
    : null;
  const navigationById = new Map(
    (navigation?.blocks ?? []).map((block) => [key(block.blockId), block]),
  );
  const originalReveals = new Map<string, PresentationReport["timeline"][number]>();
  for (const event of report.timeline) {
    if (event.type !== "question.revealed" || event.blockId === null) continue;
    const blockId = key(event.blockId);
    const prior = originalReveals.get(blockId);
    if (!prior || event.sequence < prior.sequence) originalReveals.set(blockId, event);
  }
  const displayed = new Set(
    report.timeline
      .filter((event) => displayTypes.has(event.type) && event.blockId)
      .map((event) => key(event.blockId!)),
  );
  const blocks: DeliveryBlock[] = report.evidence.map((evidence) => {
    const source = sources.get(key(evidence.blockId));
    if (
      source &&
      (source.kind !== evidence.kind || session.content.blocks[evidence.blockIndex] !== source)
    )
      unavailable();
    const nav = navigationById.get(key(evidence.blockId));
    return {
      blockId: evidence.blockId,
      blockIndex: evidence.blockIndex,
      title: summaryPlainText(evidence.kind === "content" ? evidence.title : evidence.prompt),
      kind: evidence.kind,
      sectionId: nav?.sectionId ?? null,
      status: nav?.status ?? (displayed.has(key(evidence.blockId)) ? "presented" : "unknown"),
      purpose: purpose(source, session.content.liveQuickCheck?.blockId),
      isSessionAddition: publishedIds ? !publishedIds.has(key(evidence.blockId)) : null,
    };
  });
  // Section names and membership come from the immutable report, never the current draft.
  const sectionGroups = new Map<
    string,
    { sectionId: string | null; title: string | null; blocks: DeliveryBlock[] }
  >();
  for (const block of blocks) {
    const nav = navigationById.get(key(block.blockId));
    const sectionKey = block.sectionId ? key(block.sectionId) : "unsectioned";
    const existing = sectionGroups.get(sectionKey);
    if (existing && existing.title !== (nav?.sectionTitle ?? null)) unavailable();
    if (existing) existing.blocks.push(block);
    else
      sectionGroups.set(sectionKey, {
        sectionId: block.sectionId,
        title: nav?.sectionTitle ?? null,
        blocks: [block],
      });
    if (navigation && block.sectionId) {
      const section = session.content.sections?.find((candidate) =>
        equalId(candidate.id, block.sectionId!),
      );
      if (
        !section ||
        section.title !== nav?.sectionTitle ||
        !section.blockIds.some((id) => equalId(id, block.blockId))
      )
        unavailable();
    } else if (
      navigation &&
      session.content.sections?.some((section) =>
        section.blockIds.some((id) => equalId(id, block.blockId)),
      )
    )
      unavailable();
  }
  const entryDates = report.timeline
    .filter(
      (event) => entryTypes.has(event.type) && event.blockId && evidenceIds.has(key(event.blockId)),
    )
    .map((event) => Date.parse(event.occurredAt));
  const start = entryDates.length ? Math.min(...entryDates) : null;
  const startedAt = start === null ? null : new Date(start).toISOString();
  const wallClockElapsedSeconds =
    start === null || start > Date.parse(finishedAt)
      ? null
      : Math.floor((Date.parse(finishedAt) - start) / 1000);
  const questions = report.evidence.flatMap((evidence) =>
    evidence.kind === "question"
      ? [
          questionProjection({
            evidence,
            source: sources.get(key(evidence.blockId)),
            block: blocks.find((block) => equalId(block.blockId, evidence.blockId))!,
            report,
            reveal: originalReveals.get(key(evidence.blockId)),
            rosterCounts: input.rosterCounts,
            opinionCounts:
              (input.opinionCounts?.length ?? 0) <= 200 ? (input.opinionCounts ?? []) : [],
            semanticChoiceIds: session.content.schemaVersion >= 12,
          }),
        ]
      : [],
  );
  const byQuestionId = new Map(
    report.evidence.flatMap((evidence) =>
      evidence.kind === "question" ? [[key(evidence.questionId), evidence] as const] : [],
    ),
  );
  const recovery: PresentationSessionInsights["recovery"] = report.recovery.flatMap((row) => {
    const source = byQuestionId.get(key(row.sourceQuestionId));
    if (!source) return [];
    const target = byQuestionId.get(key(row.recheckQuestionId));
    const sourceBlock = sources.get(key(source.blockId));
    const targetBlock = target && sources.get(key(target.blockId));
    const sourceParticipation = questions.find((question) =>
      equalId(question.blockId, source.blockId),
    );
    const targetParticipation =
      target && questions.find((question) => equalId(question.blockId, target.blockId));
    const valid =
      sourceBlock?.kind === "question" &&
      questionDelivery(sourceBlock.question) === "main" &&
      targetBlock?.kind === "question" &&
      questionDelivery(targetBlock.question) === "recheck" &&
      sourceBlock.question.linkedRecheckQuestionId &&
      equalId(sourceBlock.question.linkedRecheckQuestionId, row.recheckQuestionId) &&
      sourceParticipation?.purpose === "assessment" &&
      targetParticipation?.purpose === "assessment" &&
      sourceParticipation.status !== "unavailable" &&
      targetParticipation.status !== "unavailable" &&
      sourceParticipation.status !== "skipped" &&
      targetParticipation.status !== "skipped" &&
      row.eligible <= source.respondents - (source.correct ?? source.respondents) &&
      row.eligible <= (target?.respondents ?? 0) &&
      row.recovered <= row.eligible;
    const status = !valid ? "unavailable" : row.eligible < 5 ? "suppressed" : "available";
    return [
      {
        sourceBlockId: source.blockId,
        recheckBlockId: target?.blockId ?? null,
        status,
        denominatorBasis: "initially_incorrect_with_accepted_recheck" as const,
        initiallyIncorrectWithAcceptedRecheck: status === "available" ? row.eligible : null,
        recovered: status === "available" ? row.recovered : null,
        recoveryPercent: status === "available" ? percentage(row.recovered, row.eligible) : null,
      },
    ];
  });
  const result = PresentationSessionInsightsSchema.parse({
    schemaVersion: 1,
    sessionId: report.sessionId,
    presentationId: report.presentationId,
    presentationVersionId: report.presentationVersionId,
    publishedVersion: publishedVersion?.version ?? null,
    contentScope: "frozen_session",
    sourceReportSchemaVersion: report.schemaVersion,
    title: summaryPlainText(report.title) || "Presentation",
    minimumRespondents: 5,
    freshness: {
      finishedAt,
      finishedAtBasis: session.finishedAt ? "finished_at" : "legacy_updated_at",
      reportGeneratedAt,
      calculatedAt,
      retentionExpiresAt,
    },
    delivery: {
      basis: navigation ? "navigation" : "recorded_timeline",
      startedAt,
      wallClockElapsedSeconds,
      totals: coverage(blocks),
      blocks,
      sections: [...sectionGroups.values()].map(({ sectionId, title, blocks: group }) => ({
        sectionId,
        title,
        ...coverage(group),
      })),
    },
    participation: {
      joinedParticipantCount: report.participantCount,
      acceptedResponseCount: report.responseCount,
      questions,
    },
    recovery,
    qna: PresentationSessionInsightsQnaSchema.parse(input.qna),
  });
  if (Buffer.byteLength(JSON.stringify(result), "utf8") > 1024 * 1024) unavailable();
  return result;
}
