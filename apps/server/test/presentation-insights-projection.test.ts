import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  PresentationContentSchema,
  PresentationReportSchema,
  QuestionDraftSchema,
  type PresentationReport,
} from "@openround/contracts";
import type { PresentationSessionRecord, PresentationVersionRecord } from "@openround/db";
import {
  projectPresentationSessionInsights,
  PresentationInsightsProjectionError,
  type PresentationInsightsProjectionInput,
} from "../src/presentation-insights-projection.js";

const at = (seconds: number) => new Date(Date.UTC(2026, 10, 5, 12, 0, seconds));
function fixture(
  respondents = 5,
  schemaVersion: 2 | 12 | 13 = 12,
): PresentationInsightsProjectionInput {
  const ids = [randomUUID().toUpperCase(), randomUUID().toUpperCase(), randomUUID().toUpperCase()];
  const questionId = randomUUID();
  const sectionId = randomUUID();
  const content = PresentationContentSchema.parse({
    schemaVersion,
    title: "Frozen lesson",
    description: "",
    experiencePreset: { id: "focus", version: 1 },
    ...(schemaVersion >= 12
      ? { sections: [{ id: sectionId, title: "First section", blockIds: ids.slice(0, 2) }] }
      : {}),
    blocks: [
      {
        id: ids[0],
        kind: "content",
        layout: "title_body",
        speakerNotes: "PRIVATE_SPEAKER_NOTES",
        mediaId: null,
        mediaAlt: null,
        textElements: [
          { id: "title", role: "title", text: "Authored opening", region: "top_center", order: 0 },
        ],
      },
      {
        id: ids[1],
        kind: "question",
        question: {
          id: questionId,
          type: "numeric",
          prompt: "An authored assessment",
          purpose: "diagnostic",
          delivery: "main",
          confidence: "off",
          conceptKeys: [],
          linkedRecheckQuestionId: null,
          timeLimitSeconds: 30,
          basePoints: 1000,
          explanation: "PRIVATE_EXPLANATION",
          correctValue: "42",
          tolerance: "0",
          unit: null,
          mediaId: null,
          mediaAlt: null,
        },
      },
      {
        id: ids[2],
        kind: "content",
        layout: "title_body",
        speakerNotes: "",
        mediaId: null,
        mediaAlt: null,
        textElements: [
          { id: "title", role: "title", text: "Session addition", region: "top_center", order: 0 },
        ],
      },
    ],
  });
  const session: PresentationSessionRecord = {
    id: randomUUID(),
    workspaceId: randomUUID(),
    presentationId: randomUUID(),
    presentationVersionId: randomUUID(),
    title: content.title,
    content,
    code: "1234567",
    status: "finished",
    phase: "finished",
    currentBlockIndex: 1,
    revision: 6,
    eventSeq: 20,
    settings: { timeMode: "timed" },
    trustMode: "learning",
    questionOpenedAt: null,
    questionClosesAt: null,
    createdBy: randomUUID(),
    createdAt: at(-60),
    updatedAt: at(60),
    finishedAt: at(60),
    liveExpiresAt: at(86400),
    retentionExpiresAt: at(86400 * 30),
  };
  const timeline = [
    {
      sequence: 1,
      type: "content.presented",
      blockIndex: 0,
      blockId: ids[0],
      occurredAt: at(1).toISOString(),
    },
    {
      sequence: 2,
      type: "question.launched",
      blockIndex: 1,
      blockId: ids[1],
      occurredAt: at(10).toISOString(),
    },
    {
      sequence: 3,
      type: "question.revealed",
      blockIndex: 1,
      blockId: ids[1],
      occurredAt: at(25).toISOString(),
    },
    {
      sequence: 6,
      type: "presentation.finished",
      blockIndex: null,
      blockId: null,
      occurredAt: at(60).toISOString(),
    },
  ];
  const report = PresentationReportSchema.parse({
    schemaVersion: schemaVersion === 2 ? 1 : schemaVersion === 13 ? 7 : 6,
    sessionId: session.id,
    artifactType: "presentation",
    presentationId: session.presentationId,
    presentationVersionId: session.presentationVersionId,
    title: session.title,
    status: "finished",
    trustMode: "learning",
    participantCount: 10,
    responseCount: respondents,
    leaderboard: [],
    recovery: [],
    evidence: [
      {
        blockId: ids[0],
        blockIndex: 0,
        kind: "content",
        title: "Authored opening",
        assessmentStatus: "not_assessed",
      },
      {
        blockId: ids[1],
        blockIndex: 1,
        kind: "question",
        questionId,
        prompt: "An authored assessment",
        questionType: "numeric",
        questionTypeLabel: "Numeric",
        delivery: "main",
        respondents,
        correct: respondents ? Math.max(0, respondents - 1) : null,
        accuracyPercent: respondents ? Math.round(((respondents - 1) / respondents) * 100) : null,
        totalScore: 0,
        averageResponseMs: respondents ? 1000 : null,
      },
      {
        blockId: ids[2],
        blockIndex: 2,
        kind: "content",
        title: "Session addition",
        assessmentStatus: "not_assessed",
      },
    ],
    timeline,
    evidenceNote: "Only recorded evidence.",
    createdAt: session.createdAt.toISOString(),
    finishedAt: at(60).toISOString(),
    ...(schemaVersion >= 12
      ? {
          navigation: {
            blocks: ids.map((blockId, index) => ({
              blockId,
              sectionId: index < 2 ? sectionId : null,
              sectionTitle: index < 2 ? "First section" : null,
              status: index === 2 ? "skipped" : "presented",
              phase: index === 0 ? "content" : index === 1 ? "question_reveal" : null,
            })),
            jumpCount: 0,
            returnCount: 0,
          },
        }
      : {}),
    ...(schemaVersion === 13
      ? { interactionSummary: { revealChangeCount: 0, branchCount: 0 } }
      : {}),
  });
  const publishedVersion: PresentationVersionRecord = {
    id: session.presentationVersionId,
    workspaceId: session.workspaceId,
    presentationId: session.presentationId,
    version: 3,
    content: { ...content, blocks: content.blocks.slice(0, 2) },
    contentHash: "a".repeat(64),
    sourceDraftRevision: 2,
    publishedAt: at(-120),
  };
  return {
    session,
    report,
    reportGeneratedAt: at(62),
    calculatedAt: at(90),
    publishedVersion,
    rosterCounts: [{ blockId: ids[1]!.toLowerCase(), sequence: 3, participantCount: 8 }],
    qna: {
      status: "unavailable",
      asOf: null,
      audienceSeq: null,
      publicQuestionCount: null,
      answeredQuestionCount: null,
      unansweredQuestionCount: null,
      upvoteCount: null,
    },
  };
}
function activity(input: PresentationInsightsProjectionInput) {
  const evidence = input.report.evidence[1]!;
  if (evidence.kind !== "question") throw new Error("Missing fixture activity");
  return evidence;
}
function pollFixture(respondents = 5, schemaVersion: 2 | 12 = 12) {
  const input = fixture(respondents, schemaVersion);
  const block = input.session.content.blocks[1]!;
  if (block.kind !== "question") throw new Error("Missing question fixture");
  const choices = ["First", "Second", "Third"].map((label) => ({
    id: randomUUID().toUpperCase(),
    label,
    isCorrect: false,
  }));
  block.question = QuestionDraftSchema.parse({
    id: block.question.id,
    type: "poll",
    prompt: block.question.prompt,
    purpose: "opinion",
    delivery: "main",
    confidence: "off",
    conceptKeys: [],
    linkedRecheckQuestionId: null,
    timeLimitSeconds: 30,
    basePoints: 0,
    explanation: "PRIVATE_EXPLANATION",
    mediaId: null,
    mediaAlt: null,
    choices,
  });
  Object.assign(activity(input), {
    questionType: "poll",
    questionTypeLabel: "Poll",
    correct: null,
    accuracyPercent: null,
    totalScore: 0,
  });
  input.opinionCounts = [
    {
      blockId: block.id.toLowerCase(),
      responseCount: respondents,
      buckets: [
        { key: choices[0]!.id, count: Math.min(3, respondents) },
        { key: choices[1]!.id, count: Math.max(0, respondents - 3) },
      ],
    },
  ];
  return { input, block, choices };
}
describe("frozen Presentation session insights projection", () => {
  it("uses navigation's distinct coverage, frozen sections, exact reveal counts and pinned version identity", () => {
    const input = fixture();
    const source = JSON.stringify(input);
    const value = projectPresentationSessionInsights(input);
    expect(JSON.stringify(input)).toBe(source);
    expect(value).toMatchObject({
      schemaVersion: 1,
      contentScope: "frozen_session",
      publishedVersion: 3,
      sourceReportSchemaVersion: 6,
      freshness: {
        finishedAt: at(60).toISOString(),
        finishedAtBasis: "finished_at",
        reportGeneratedAt: at(62).toISOString(),
        calculatedAt: at(90).toISOString(),
      },
      delivery: {
        basis: "navigation",
        startedAt: at(1).toISOString(),
        wallClockElapsedSeconds: 59,
        totals: {
          totalBlocks: 3,
          presentedBlocks: 2,
          skippedBlocks: 1,
          unknownBlocks: 0,
          coveragePercent: 66.7,
        },
      },
      participation: {
        joinedParticipantCount: 10,
        acceptedResponseCount: 5,
        questions: [
          {
            purpose: "assessment",
            status: "available",
            acceptedRespondents: 5,
            joinedByRevealCount: 8,
            notRespondedByRevealCount: 3,
            responseRatePercent: 62.5,
            denominatorBasis: "joined_by_reveal",
          },
        ],
      },
    });
    expect(value.delivery.sections).toMatchObject([
      { title: "First section", totalBlocks: 2, coveragePercent: 100 },
      { sectionId: null, title: null, totalBlocks: 1, coveragePercent: 0 },
    ]);
    expect(value.delivery.blocks.map((block) => block.isSessionAddition)).toEqual([
      false,
      false,
      true,
    ]);
    const encoded = JSON.stringify(value);
    expect(encoded).not.toMatch(
      /PRIVATE_|speakerNotes|correctValue|leaderboard|tokenHash|joinedAt|branchId|textResults/,
    );
  });
  it("does not count revisits, return trips, branches or reveal changes as additional covered blocks", () => {
    const input = fixture(5, 13);
    const target = input.report.evidence[1]!.blockId;
    input.report.timeline.splice(
      3,
      0,
      {
        sequence: 4,
        type: "navigation.revisited",
        blockIndex: 1,
        blockId: target,
        occurredAt: at(30).toISOString(),
      },
      {
        sequence: 5,
        type: "navigation.returned",
        blockIndex: 1,
        blockId: target,
        occurredAt: at(31).toISOString(),
      },
    );
    expect(projectPresentationSessionInsights(input).delivery.totals.presentedBlocks).toBe(2);
    expect(projectPresentationSessionInsights(input).participation.questions).toHaveLength(1);
  });
  it("keeps legacy absent delivery and reveal rosters unknown without replacing them with final join count", () => {
    const input = fixture(5, 2);
    input.rosterCounts[0]!.participantCount = null;
    input.session.finishedAt = null;
    const value = projectPresentationSessionInsights(input);
    expect(value.freshness.finishedAtBasis).toBe("legacy_updated_at");
    expect(value.delivery.totals).toMatchObject({
      presentedBlocks: 2,
      skippedBlocks: 0,
      unknownBlocks: 1,
      coveragePercent: null,
    });
    expect(value.participation.questions[0]).toMatchObject({
      acceptedRespondents: 5,
      joinedByRevealCount: null,
      responseRatePercent: null,
      denominatorStatus: "legacy_unavailable",
      denominatorBasis: "unavailable",
      purpose: "assessment",
    });
    input.report.timeline = [];
    expect(projectPresentationSessionInsights(input).delivery).toMatchObject({
      startedAt: null,
      wallClockElapsedSeconds: null,
      totals: { presentedBlocks: 0, unknownBlocks: 3 },
    });
  });
  it("distinguishes a recorded empty roster from unavailable legacy history and suppresses 1–4 respondent samples", () => {
    const empty = fixture(0);
    empty.rosterCounts[0]!.participantCount = 0;
    expect(projectPresentationSessionInsights(empty).participation.questions[0]).toMatchObject({
      acceptedRespondents: 0,
      joinedByRevealCount: 0,
      notRespondedByRevealCount: 0,
      responseRatePercent: null,
      denominatorStatus: "recorded",
    });
    for (const respondents of [1, 2, 3, 4]) {
      const value = projectPresentationSessionInsights(fixture(respondents)).participation
        .questions[0];
      expect(value).toMatchObject({
        status: "suppressed",
        acceptedRespondents: null,
        joinedByRevealCount: null,
        notRespondedByRevealCount: null,
        responseRatePercent: null,
        results: [],
        denominatorStatus: "suppressed",
      });
    }
  });
  it("selects the original accepted reveal sequence and treats impossible or conflicting counts as unavailable", () => {
    const input = fixture();
    const originalReveal = input.report.timeline.find(
      (event) => event.type === "question.revealed",
    )!;
    // Imported timelines need not be sequence ordered; the later duplicate must not replace
    // the original roster, even when its UUID spelling differs and it appears first.
    input.report.timeline.unshift({
      ...originalReveal,
      type: "question.revealed",
      sequence: 99,
      blockId: originalReveal.blockId!.toLowerCase(),
      occurredAt: at(35).toISOString(),
    });
    input.rosterCounts.push({ ...input.rosterCounts[0]!, sequence: 99, participantCount: 10 });
    expect(
      projectPresentationSessionInsights(input).participation.questions[0]!.joinedByRevealCount,
    ).toBe(8);
    input.rosterCounts[0]!.participantCount = 4;
    expect(projectPresentationSessionInsights(input).participation.questions[0]).toMatchObject({
      status: "unavailable",
      unavailableReason: "count_mismatch",
      acceptedRespondents: null,
      joinedByRevealCount: null,
      responseRatePercent: null,
    });
    input.rosterCounts[0]!.participantCount = 8;
    input.rosterCounts.push({ ...input.rosterCounts[0]! });
    expect(projectPresentationSessionInsights(input).participation.questions[0]!.status).toBe(
      "unavailable",
    );
  });
  it("does not infer an opinion from null correctness, and keeps unavailable published provenance nullable", () => {
    const input = fixture(0);
    input.publishedVersion = null;
    const value = projectPresentationSessionInsights(input);
    expect(value.publishedVersion).toBeNull();
    expect(value.delivery.blocks.every((block) => block.isSessionAddition === null)).toBe(true);
    expect(value.participation.questions[0]!.purpose).toBe("assessment");
    const legacy = fixture(0, 2);
    legacy.session.content.blocks.splice(1, 1);
    // Legacy evidence retains an authored activity whose complete source was not retained.
    legacy.session.content.blocks = legacy.session.content.blocks.slice(0, 1);
    expect(projectPresentationSessionInsights(legacy).participation.questions[0]).toMatchObject({
      purpose: "unknown",
      status: "unavailable",
      unavailableReason: "source_unavailable",
    });
  });
  it("uses actual legacy scoring semantics and omits unsupported assessed denominators", () => {
    const input = fixture(5, 2);
    const block = input.session.content.blocks[1]!;
    if (block.kind !== "question" || block.question.type !== "numeric")
      throw new Error("Expected numeric fixture");
    const common = Object.fromEntries(
      Object.entries(block.question).filter(
        ([name]) => !["correctValue", "tolerance", "unit"].includes(name),
      ),
    );
    block.question = QuestionDraftSchema.parse({
      ...common,
      type: "single_select",
      purpose: "opinion",
      choices: [
        { id: randomUUID(), label: "Authored first choice", isCorrect: true },
        { id: randomUUID(), label: "Authored second choice", isCorrect: false },
      ],
    });
    activity(input).questionType = "single_select";
    // Five accepted responses can contain only one assessed, incorrect response in legacy rows.
    activity(input).correct = 0;
    activity(input).accuracyPercent = 0;
    const value = projectPresentationSessionInsights(input).participation.questions[0]!;
    expect(value.purpose).toBe("assessment");
    expect(value.acceptedRespondents).toBe(5);
    expect(value).not.toHaveProperty("accuracy");
    expect(value).not.toHaveProperty("correct");
  });
  it("classifies text, opinions and Quick Checks from frozen formats without exporting participant bodies", () => {
    const text = fixture(5);
    const block = text.session.content.blocks[1]!;
    if (block.kind !== "question" || block.question.type !== "numeric")
      throw new Error("Expected numeric fixture");
    const common = Object.fromEntries(
      Object.entries(block.question).filter(
        ([name]) => !["correctValue", "tolerance", "unit"].includes(name),
      ),
    );
    block.question = QuestionDraftSchema.parse({
      ...common,
      type: "open_text",
      purpose: "opinion",
      basePoints: 0,
    });
    const evidence = activity(text);
    text.report.evidence[1] = {
      ...evidence,
      questionType: "open_text",
      correct: null,
      accuracyPercent: null,
      totalScore: 0,
      textResults: {
        kind: "open_text",
        respondents: 5,
        entries: Array.from({ length: 5 }, () => ({ value: "PRIVATE_AUDIENCE_TEXT" })),
      },
    };
    const value = projectPresentationSessionInsights(text);
    expect(value.participation.questions[0]).toMatchObject({
      purpose: "text",
      acceptedRespondents: 5,
      results: [],
    });
    expect(JSON.stringify(value)).not.toContain("PRIVATE_AUDIENCE_TEXT");
    const poll = fixture(0);
    const pollBlock = poll.session.content.blocks[1]!;
    if (pollBlock.kind !== "question") throw new Error("Expected question fixture");
    pollBlock.question = QuestionDraftSchema.parse({
      ...common,
      id: activity(poll).questionId,
      type: "poll",
      purpose: "opinion",
      basePoints: 0,
      choices: [
        { id: randomUUID(), label: "First", isCorrect: false },
        { id: randomUUID(), label: "Second", isCorrect: false },
      ],
    });
    activity(poll).questionType = "poll";
    expect(projectPresentationSessionInsights(poll).participation.questions[0]!.purpose).toBe(
      "opinion",
    );
    poll.session.content.liveQuickCheck = { commandId: randomUUID(), blockId: pollBlock.id };
    expect(projectPresentationSessionInsights(poll).participation.questions[0]!.purpose).toBe(
      "quick_check",
    );
  });
  it("renders ordinary poll and unscored Quick Check counts from bounded aggregates without changing participation", () => {
    const { input, block, choices } = pollFixture();
    input.opinionCounts![0]!.buckets[0]!.key = choices[0]!.id.toLowerCase();
    const question = projectPresentationSessionInsights(input).participation.questions[0]!;
    expect(question).toMatchObject({
      status: "available",
      distributionStatus: "available",
      acceptedRespondents: 5,
      joinedByRevealCount: 8,
      responseRatePercent: 62.5,
      maxSelections: 1,
      measure: "respondents",
      results: [
        { label: "First", value: 3 },
        { label: "Second", value: 2 },
        { label: "Third", value: 0 },
      ],
    });
    input.session.content.liveQuickCheck = { commandId: randomUUID(), blockId: block.id };
    expect(projectPresentationSessionInsights(input).participation.questions[0]).toMatchObject({
      purpose: "quick_check",
      distributionStatus: "available",
      results: question.results,
    });
    expect(question).not.toHaveProperty("accuracy");
    expect(question).not.toHaveProperty("correct");
  });
  it("renders canonical rating histograms in authored range order with only frozen endpoint labels", () => {
    const { input, block } = pollFixture();
    block.question = QuestionDraftSchema.parse({
      ...block.question,
      type: "rating",
      min: 1,
      max: 5,
      minLabel: "Low",
      maxLabel: "High",
    });
    activity(input).questionType = "rating";
    input.opinionCounts = [
      {
        blockId: block.id,
        responseCount: 5,
        buckets: [
          { key: "5", count: 2 },
          { key: "1", count: 3 },
        ],
      },
    ];
    expect(projectPresentationSessionInsights(input).participation.questions[0]).toMatchObject({
      distributionStatus: "available",
      results: [
        { label: "1 — Low", value: 3 },
        { label: "2", value: 0 },
        { label: "3", value: 0 },
        { label: "4", value: 0 },
        { label: "5 — High", value: 2 },
      ],
    });
    input.opinionCounts[0]!.buckets[0]!.key = "5.0";
    expect(projectPresentationSessionInsights(input).participation.questions[0]).toMatchObject({
      status: "available",
      distributionStatus: "unavailable",
      acceptedRespondents: 5,
      results: [],
    });
  });
  it("preserves literal legacy choice matching and rejects unknown, duplicate, missing or inconsistent aggregate buckets only for distributions", () => {
    const legacy = pollFixture(5, 2);
    expect(
      projectPresentationSessionInsights(legacy.input).participation.questions[0]!
        .distributionStatus,
    ).toBe("available");
    legacy.input.opinionCounts![0]!.buckets[0]!.key = legacy.choices[0]!.id.toLowerCase();
    expect(
      projectPresentationSessionInsights(legacy.input).participation.questions[0]!
        .distributionStatus,
    ).toBe("unavailable");
    for (const mutate of [
      (input: PresentationInsightsProjectionInput) => {
        input.opinionCounts = [];
      },
      (input: PresentationInsightsProjectionInput) => {
        input.opinionCounts![0]!.responseCount = 6;
      },
      (input: PresentationInsightsProjectionInput) => {
        input.opinionCounts![0]!.buckets[0]!.count = 2;
      },
      (input: PresentationInsightsProjectionInput) => {
        input.opinionCounts![0]!.buckets[0]!.key = "PRIVATE_AUDIENCE_VALUE";
      },
      (input: PresentationInsightsProjectionInput) => {
        input.opinionCounts![0]!.buckets[0]!.count = -1;
      },
      (input: PresentationInsightsProjectionInput) => {
        input.opinionCounts![0]!.buckets.push(input.opinionCounts![0]!.buckets[0]!);
      },
      (input: PresentationInsightsProjectionInput) => {
        input.opinionCounts!.push(input.opinionCounts![0]!);
      },
    ]) {
      const { input } = pollFixture();
      mutate(input);
      const value = projectPresentationSessionInsights(input);
      expect(value.participation.questions[0]).toMatchObject({
        status: "available",
        distributionStatus: "unavailable",
        acceptedRespondents: 5,
        joinedByRevealCount: 8,
        responseRatePercent: 62.5,
        results: [],
      });
      expect(JSON.stringify(value)).not.toContain("PRIVATE_AUDIENCE_VALUE");
    }
  });
  it("prefers immutable cached distributions and maps their labels from the frozen authored choices", () => {
    const { input, block, choices } = pollFixture();
    if (block.question.type !== "poll") throw new Error("Missing poll fixture");
    block.question.maxSelections = 2;
    input.report.evidence[1] = {
      ...activity(input),
      opinionSummary: {
        kind: "poll",
        blockId: block.id,
        responseCount: 5,
        maxSelections: 2,
        totalSelections: 6,
        choices: choices.map((choice, index) => ({
          choiceId: choice.id,
          label: "PRIVATE_UNTRUSTED_REPORT_LABEL",
          count: [3, 2, 1][index]!,
          percentOfRespondents: [60, 40, 20][index]!,
        })),
      },
    };
    input.opinionCounts = [{ blockId: block.id, responseCount: 999, buckets: [] }];
    const value = projectPresentationSessionInsights(input);
    expect(value.participation.questions[0]).toMatchObject({
      distributionStatus: "available",
      maxSelections: 2,
      results: [
        { label: "First", value: 3 },
        { label: "Second", value: 2 },
        { label: "Third", value: 1 },
      ],
    });
    expect(JSON.stringify(value)).not.toContain("PRIVATE_UNTRUSTED_REPORT_LABEL");
  });
  it("suppresses small and empty distributions while retaining explicitly known zero accepted counts", () => {
    for (const respondents of [0, 1, 2, 3, 4]) {
      const { input } = pollFixture(respondents);
      const value = projectPresentationSessionInsights(input).participation.questions[0]!;
      expect(value.distributionStatus).toBe("suppressed");
      expect(value.results).toEqual([]);
      expect(value.acceptedRespondents).toBe(respondents === 0 ? 0 : null);
    }
    const unsupported = fixture();
    unsupported.opinionCounts = [
      {
        blockId: activity(unsupported).blockId,
        responseCount: 5,
        buckets: [{ key: "42", count: 5 }],
      },
    ];
    expect(
      projectPresentationSessionInsights(unsupported).participation.questions[0]!
        .distributionStatus,
    ).toBe("not_applicable");
  });
  it("keeps skipped questions unassessed and content-only participation free of invented response opportunities", () => {
    const input = fixture(0);
    if (input.report.schemaVersion !== 6) throw new Error("Expected navigation fixture");
    input.report.navigation.blocks[1]!.status = "skipped";
    input.report.navigation.blocks[1]!.phase = null;
    input.report.timeline = input.report.timeline.filter(
      (event) => event.blockId !== input.report.evidence[1]!.blockId,
    );
    expect(projectPresentationSessionInsights(input).participation.questions[0]).toMatchObject({
      status: "skipped",
      acceptedRespondents: 0,
      joinedByRevealCount: null,
      results: [],
    });
    const contentOnly = fixture(0);
    contentOnly.report.evidence.splice(1, 1);
    contentOnly.session.content.blocks.splice(1, 1);
    contentOnly.report.evidence[1]!.blockIndex = 1;
    if (contentOnly.report.schemaVersion !== 6) throw new Error("Expected navigation fixture");
    contentOnly.report.navigation.blocks.splice(1, 1);
    expect(projectPresentationSessionInsights(contentOnly).participation.questions).toEqual([]);
  });
  it("thresholds paired recovery by initially incorrect respondents with an accepted recheck", () => {
    const input = fixture(5);
    activity(input).correct = 0;
    activity(input).accuracyPercent = 0;
    const initial = input.session.content.blocks[1]!;
    if (initial.kind !== "question") throw new Error("Expected question");
    const recheckId = randomUUID(),
      recheckBlockId = randomUUID();
    initial.question.linkedRecheckQuestionId = recheckId;
    input.session.content.blocks[2] = {
      ...initial,
      id: recheckBlockId,
      question: {
        ...initial.question,
        id: recheckId,
        prompt: "Authored recheck",
        delivery: "recheck",
        linkedRecheckQuestionId: null,
      },
    };
    input.report.evidence[2] = {
      ...activity(input),
      blockId: recheckBlockId,
      blockIndex: 2,
      questionId: recheckId,
      prompt: "Authored recheck",
      delivery: "recheck",
    };
    if (input.report.schemaVersion !== 6) throw new Error("Expected navigation fixture");
    input.report.navigation.blocks[2] = {
      blockId: recheckBlockId,
      sectionId: null,
      sectionTitle: null,
      status: "presented",
      phase: "question_reveal",
    };
    input.report.responseCount = 10;
    input.report.recovery = [
      {
        sourceQuestionId: initial.question.id,
        recheckQuestionId: recheckId,
        eligible: 4,
        recovered: 3,
        recoveryPercent: 75,
      },
    ];
    expect(projectPresentationSessionInsights(input).recovery[0]).toMatchObject({
      status: "suppressed",
      initiallyIncorrectWithAcceptedRecheck: null,
      recovered: null,
      recoveryPercent: null,
    });
    input.report.recovery[0] = {
      ...input.report.recovery[0]!,
      eligible: 5,
      recovered: 3,
      recoveryPercent: 60,
    };
    expect(projectPresentationSessionInsights(input).recovery[0]).toMatchObject({
      status: "available",
      denominatorBasis: "initially_incorrect_with_accepted_recheck",
      initiallyIncorrectWithAcceptedRecheck: 5,
      recovered: 3,
      recoveryPercent: 60,
    });
  });
  it("keeps current Q&A provenance separate and never emits hidden question breakdowns", () => {
    const input = fixture();
    input.qna = {
      status: "available",
      asOf: at(89).toISOString(),
      audienceSeq: 200,
      publicQuestionCount: 5,
      answeredQuestionCount: 2,
      unansweredQuestionCount: 3,
      upvoteCount: 9,
    };
    expect(projectPresentationSessionInsights(input).qna).toEqual(input.qna);
    expect(projectPresentationSessionInsights(input).freshness.finishedAt).toBe(
      at(60).toISOString(),
    );
    input.qna.publicQuestionCount = 4;
    expect(() => projectPresentationSessionInsights(input)).toThrow(
      PresentationInsightsProjectionError,
    );
  });
  it("fails closed for mixed identity, source version, report counts, duplicate blocks and oversized metadata", () => {
    for (const mutate of [
      (input: PresentationInsightsProjectionInput) => {
        input.report.sessionId = randomUUID();
      },
      (input: PresentationInsightsProjectionInput) => {
        input.publishedVersion!.id = randomUUID();
      },
      (input: PresentationInsightsProjectionInput) => {
        input.report.responseCount += 1;
      },
      (input: PresentationInsightsProjectionInput) => {
        input.report.evidence.push(input.report.evidence[0]!);
      },
      (input: PresentationInsightsProjectionInput) => {
        input.rosterCounts = Array.from({ length: 201 }, () => input.rosterCounts[0]!);
      },
    ]) {
      const input = fixture();
      mutate(input);
      expect(() => projectPresentationSessionInsights(input)).toThrow(
        PresentationInsightsProjectionError,
      );
    }
  });
  it("does not modify historical report documents while deriving new insights", () => {
    for (const version of [2, 12, 13] as const) {
      const input = fixture(5, version);
      const before = JSON.stringify(input.report);
      projectPresentationSessionInsights(input);
      expect(JSON.stringify(input.report)).toBe(before);
      expect(PresentationReportSchema.parse(input.report)).toEqual(
        input.report as PresentationReport,
      );
    }
  });
  it("rejects an otherwise bounded 200-block projection that exceeds one MiB", () => {
    const input = fixture(5);
    const source = input.session.content.blocks[1]!;
    if (source.kind !== "question" || input.report.schemaVersion !== 6)
      throw new Error("Expected fixture question");
    const evidence = activity(input);
    const prompt = "界".repeat(2000);
    const blocks = Array.from({ length: 200 }, (_, blockIndex) => {
      const blockId = randomUUID(),
        questionId = randomUUID();
      return { blockId, questionId, blockIndex };
    });
    input.session.content.blocks = blocks.map(({ blockId, questionId }) => ({
      ...source,
      id: blockId,
      question: { ...source.question, id: questionId, prompt },
    }));
    input.session.content.sections = [];
    input.publishedVersion = null;
    input.report.evidence = blocks.map(({ blockId, questionId, blockIndex }) => ({
      ...evidence,
      blockId,
      questionId,
      blockIndex,
      prompt,
    }));
    input.report.responseCount = 1000;
    input.report.timeline = [];
    input.report.navigation.blocks = blocks.map(({ blockId }) => ({
      blockId,
      sectionId: null,
      sectionTitle: null,
      status: "presented",
      phase: "question_reveal",
    }));
    input.rosterCounts = [];
    expect(() => projectPresentationSessionInsights(input)).toThrow(
      PresentationInsightsProjectionError,
    );
  });
});
