import { z } from "zod";

const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const percent = z.number().min(0).max(100);
const id = z.string().uuid();
const date = z.string().datetime();
const sameId = (left: string, right: string) => left.toLowerCase() === right.toLowerCase();
export const PresentationInsightsPurposeSchema = z.enum([
  "content",
  "assessment",
  "opinion",
  "text",
  "quick_check",
  "unknown",
]);
export type PresentationInsightsPurpose = z.infer<typeof PresentationInsightsPurposeSchema>;

export const PresentationInsightsCoverageSchema = z
  .object({
    totalBlocks: count.max(200),
    presentedBlocks: count.max(200),
    skippedBlocks: count.max(200),
    unknownBlocks: count.max(200),
    coveragePercent: percent.nullable(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.presentedBlocks + value.skippedBlocks + value.unknownBlocks !== value.totalBlocks)
      ctx.addIssue({ code: "custom", message: "Coverage counts must describe every block" });
    const expected =
      value.unknownBlocks || !value.totalBlocks
        ? null
        : Math.round((value.presentedBlocks / value.totalBlocks) * 1000) / 10;
    if (value.coveragePercent !== expected)
      ctx.addIssue({
        code: "custom",
        message: "Coverage requires a complete recorded denominator",
      });
  });
export type PresentationInsightsCoverage = z.infer<typeof PresentationInsightsCoverageSchema>;

export const PresentationSessionInsightsQnaSchema = z
  .object({
    status: z.enum(["available", "suppressed", "not_enabled", "unavailable"]),
    asOf: date.nullable(),
    audienceSeq: count.nullable(),
    publicQuestionCount: count.nullable(),
    answeredQuestionCount: count.nullable(),
    unansweredQuestionCount: count.nullable(),
    upvoteCount: count.nullable(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const values = [
      value.publicQuestionCount,
      value.answeredQuestionCount,
      value.unansweredQuestionCount,
      value.upvoteCount,
    ];
    if (value.status !== "available") {
      if (values.some((item) => item !== null))
        ctx.addIssue({
          code: "custom",
          message: "Unavailable or suppressed Q&A cannot expose counts",
        });
      return;
    }
    if (
      values.some((item) => item === null) ||
      value.asOf === null ||
      value.audienceSeq === null ||
      (value.publicQuestionCount! > 0 && value.publicQuestionCount! < 5) ||
      (value.publicQuestionCount === 0 && value.upvoteCount !== 0) ||
      value.answeredQuestionCount! + value.unansweredQuestionCount! !== value.publicQuestionCount
    )
      ctx.addIssue({
        code: "custom",
        message: "Available Q&A requires a thresholded public aggregate",
      });
  });
export type PresentationSessionInsightsQna = z.infer<typeof PresentationSessionInsightsQnaSchema>;

export const PresentationInsightsQuestionSchema = z
  .object({
    blockId: id,
    purpose: PresentationInsightsPurposeSchema,
    status: z.enum(["available", "suppressed", "unavailable", "skipped"]),
    unavailableReason: z
      .enum(["insufficient_sample", "source_unavailable", "count_mismatch"])
      .nullable(),
    acceptedRespondents: count.nullable(),
    joinedByRevealCount: count.nullable(),
    notRespondedByRevealCount: count.nullable(),
    responseRatePercent: percent.nullable(),
    denominatorBasis: z.enum(["joined_by_reveal", "unavailable"]),
    denominatorStatus: z.enum([
      "recorded",
      "not_revealed",
      "legacy_unavailable",
      "suppressed",
      "unavailable",
    ]),
    measure: z.enum(["respondents", "weighted_points"]),
    maxSelections: z.number().int().min(1).max(6).nullable(),
    distributionStatus: z.enum(["available", "suppressed", "unavailable", "not_applicable"]),
    results: z.array(z.object({ label: z.string().max(500), value: count }).strict()).max(100),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      value.purpose === "content" ||
      (value.status === "available" &&
        (value.acceptedRespondents === null || value.unavailableReason !== null)) ||
      (value.status === "suppressed" &&
        (value.unavailableReason !== "insufficient_sample" ||
          value.denominatorStatus !== "suppressed")) ||
      (value.status === "unavailable" &&
        (value.unavailableReason === null || value.unavailableReason === "insufficient_sample")) ||
      (value.status === "skipped" && value.unavailableReason !== null)
    )
      ctx.addIssue({
        code: "custom",
        message: "Activity availability must match its aggregate provenance",
      });
    const hidden = value.status === "suppressed" || value.status === "unavailable";
    if (
      hidden &&
      (value.acceptedRespondents !== null ||
        value.joinedByRevealCount !== null ||
        value.notRespondedByRevealCount !== null ||
        value.responseRatePercent !== null ||
        value.results.length)
    )
      ctx.addIssue({
        code: "custom",
        message: "Suppressed or inconsistent samples must contain no aggregate evidence",
      });
    if (
      value.status === "skipped" &&
      (value.acceptedRespondents !== 0 ||
        value.results.length ||
        value.joinedByRevealCount !== null ||
        value.notRespondedByRevealCount !== null ||
        value.responseRatePercent !== null)
    )
      ctx.addIssue({
        code: "custom",
        message: "Skipped activities cannot claim a response window or assessment result",
      });
    if (
      value.acceptedRespondents !== null &&
      value.acceptedRespondents > 0 &&
      value.acceptedRespondents < 5
    )
      ctx.addIssue({ code: "custom", message: "Small response samples must be suppressed" });
    if (
      value.results.length &&
      (value.status !== "available" ||
        value.acceptedRespondents === null ||
        value.acceptedRespondents < 5 ||
        !["opinion", "quick_check"].includes(value.purpose))
    )
      ctx.addIssue({
        code: "custom",
        message: "Results require an adequate non-text opinion sample",
      });
    if (
      (value.distributionStatus === "available") !== value.results.length > 0 ||
      (value.distributionStatus === "available" &&
        (value.status !== "available" ||
          value.acceptedRespondents === null ||
          value.acceptedRespondents < 5))
    )
      ctx.addIssue({
        code: "custom",
        message: "A distribution requires its explicit available, adequate sample",
      });
    if (value.denominatorBasis === "joined_by_reveal") {
      if (
        value.denominatorStatus !== "recorded" ||
        value.joinedByRevealCount === null ||
        value.acceptedRespondents === null ||
        value.acceptedRespondents > value.joinedByRevealCount ||
        value.notRespondedByRevealCount !== value.joinedByRevealCount - value.acceptedRespondents ||
        value.responseRatePercent !==
          (value.joinedByRevealCount
            ? Math.round((value.acceptedRespondents / value.joinedByRevealCount) * 1000) / 10
            : null)
      )
        ctx.addIssue({
          code: "custom",
          message: "Participation requires its exact joined-by-reveal denominator",
        });
    } else if (
      value.joinedByRevealCount !== null ||
      value.notRespondedByRevealCount !== null ||
      value.responseRatePercent !== null ||
      value.denominatorStatus === "recorded"
    )
      ctx.addIssue({
        code: "custom",
        message: "Missing historical rosters cannot provide a participation denominator",
      });
  });
export type PresentationInsightsQuestion = z.infer<typeof PresentationInsightsQuestionSchema>;

const recovery = z
  .object({
    sourceBlockId: id,
    recheckBlockId: id.nullable(),
    status: z.enum(["available", "suppressed", "unavailable"]),
    denominatorBasis: z.literal("initially_incorrect_with_accepted_recheck"),
    initiallyIncorrectWithAcceptedRecheck: count.nullable(),
    recovered: count.nullable(),
    recoveryPercent: percent.nullable(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const denominator = value.initiallyIncorrectWithAcceptedRecheck;
    if (value.status !== "available") {
      if (denominator !== null || value.recovered !== null || value.recoveryPercent !== null)
        ctx.addIssue({
          code: "custom",
          message: "Suppressed paired evidence must contain no counts",
        });
    } else if (
      denominator === null ||
      value.recovered === null ||
      value.recheckBlockId === null ||
      denominator < 5 ||
      value.recovered > denominator ||
      value.recoveryPercent !==
        (denominator ? Math.round((value.recovered / denominator) * 1000) / 10 : null)
    )
      ctx.addIssue({
        code: "custom",
        message: "Paired recovery must match its adequate accepted-recheck sample",
      });
  });

/** Creator-only aggregates from one frozen session. This is not the stored report or public summary. */
export const PresentationSessionInsightsSchema = z
  .object({
    schemaVersion: z.literal(1),
    sessionId: id,
    presentationId: id,
    presentationVersionId: id,
    publishedVersion: z.number().int().positive().nullable(),
    contentScope: z.literal("frozen_session"),
    sourceReportSchemaVersion: z.number().int().min(1).max(7),
    title: z.string().min(1).max(160),
    minimumRespondents: z.literal(5),
    freshness: z
      .object({
        finishedAt: date,
        finishedAtBasis: z.enum(["finished_at", "legacy_updated_at"]),
        reportGeneratedAt: date,
        calculatedAt: date,
        retentionExpiresAt: date,
      })
      .strict(),
    delivery: z
      .object({
        basis: z.enum(["navigation", "recorded_timeline"]),
        startedAt: date.nullable(),
        wallClockElapsedSeconds: count.nullable(),
        totals: PresentationInsightsCoverageSchema,
        blocks: z
          .array(
            z
              .object({
                blockId: id,
                blockIndex: z.number().int().min(0).max(199),
                title: z.string().max(2_000),
                kind: z.enum(["content", "question"]),
                sectionId: id.nullable(),
                status: z.enum(["presented", "skipped", "unknown"]),
                purpose: PresentationInsightsPurposeSchema,
                isSessionAddition: z.boolean().nullable(),
              })
              .strict(),
          )
          .max(200),
        // Fifty authored sections plus the synthetic, unnamed unsectioned group.
        sections: z
          .array(
            PresentationInsightsCoverageSchema.safeExtend({
              sectionId: id.nullable(),
              title: z.string().max(120).nullable(),
            }),
          )
          .max(51),
      })
      .strict(),
    participation: z
      .object({
        joinedParticipantCount: count,
        acceptedResponseCount: count,
        questions: z.array(PresentationInsightsQuestionSchema).max(200),
      })
      .strict(),
    recovery: z.array(recovery).max(200),
    qna: PresentationSessionInsightsQnaSchema,
  })
  .strict()
  .superRefine((value, ctx) => {
    const start = value.delivery.startedAt === null ? null : Date.parse(value.delivery.startedAt);
    const finish = Date.parse(value.freshness.finishedAt);
    const expectedElapsed =
      start === null || start > finish ? null : Math.floor((finish - start) / 1000);
    if (value.delivery.wallClockElapsedSeconds !== expectedElapsed)
      ctx.addIssue({
        code: "custom",
        message: "Wall-clock elapsed time requires an actual recorded delivery start",
      });
    const blocks = value.delivery.blocks;
    if (
      new Set(blocks.map((block) => block.blockId.toLowerCase())).size !== blocks.length ||
      new Set(blocks.map((block) => block.blockIndex)).size !== blocks.length ||
      blocks.length !== value.delivery.totals.totalBlocks
    )
      ctx.addIssue({ code: "custom", message: "Delivery must describe each frozen block once" });
    for (const [status, field] of [
      ["presented", "presentedBlocks"],
      ["skipped", "skippedBlocks"],
      ["unknown", "unknownBlocks"],
    ] as const)
      if (blocks.filter((block) => block.status === status).length !== value.delivery.totals[field])
        ctx.addIssue({
          code: "custom",
          message: "Delivery totals must match recorded block states",
        });
    const sections = value.delivery.sections;
    if (
      sections.filter((section) => section.sectionId !== null).length > 50 ||
      new Set(sections.map((section) => section.sectionId?.toLowerCase() ?? "unsectioned")).size !==
        sections.length
    )
      ctx.addIssue({
        code: "custom",
        message: "Section coverage must contain unique bounded sections",
      });
    if (sections.reduce((sum, section) => sum + section.totalBlocks, 0) !== blocks.length)
      ctx.addIssue({ code: "custom", message: "Sections must cover every frozen block once" });
    for (const section of sections) {
      const group = blocks.filter((block) =>
        section.sectionId === null
          ? block.sectionId === null
          : block.sectionId !== null && sameId(block.sectionId, section.sectionId),
      );
      if (
        group.length !== section.totalBlocks ||
        (section.sectionId === null) !== (section.title === null)
      )
        ctx.addIssue({ code: "custom", message: "Section coverage must match frozen membership" });
      for (const [status, field] of [
        ["presented", "presentedBlocks"],
        ["skipped", "skippedBlocks"],
        ["unknown", "unknownBlocks"],
      ] as const)
        if (group.filter((block) => block.status === status).length !== section[field])
          ctx.addIssue({
            code: "custom",
            message: "Section counts must match recorded block states",
          });
    }
    const questions = value.participation.questions;
    if (
      new Set(questions.map((question) => question.blockId.toLowerCase())).size !==
        questions.length ||
      questions.length !== blocks.filter((block) => block.kind === "question").length ||
      questions.some(
        (question) =>
          !blocks.some(
            (block) =>
              block.kind === "question" &&
              sameId(block.blockId, question.blockId) &&
              block.purpose === question.purpose,
          ),
      )
    )
      ctx.addIssue({
        code: "custom",
        message: "Participation must describe each frozen activity once",
      });
    for (const question of questions)
      if (
        (question.acceptedRespondents ?? 0) > value.participation.joinedParticipantCount ||
        (question.joinedByRevealCount ?? 0) > value.participation.joinedParticipantCount
      )
        ctx.addIssue({
          code: "custom",
          message: "Question aggregates cannot exceed the joined session population",
        });
  });
export type PresentationSessionInsights = z.infer<typeof PresentationSessionInsightsSchema>;
export const PresentationSessionInsightsEnvelopeSchema = z
  .object({
    status: z.enum(["pending", "failed", "ready"]),
    insights: PresentationSessionInsightsSchema.nullable(),
  })
  .strict()
  .refine(
    (value) => (value.status === "ready") === (value.insights !== null),
    "Only ready insights contain reconciled evidence",
  );
export type PresentationSessionInsightsEnvelope = z.infer<
  typeof PresentationSessionInsightsEnvelopeSchema
>;
