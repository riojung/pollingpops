import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  AnswerSubmitSchema,
  ApiErrorSchema,
  AVATAR_IDS,
  AvatarIdSchema,
  BrandThemeSchema,
  canonicalizeResponse,
  CopyRoundQuestionsToPresentationSchema,
  CreatePracticeAssignmentSchema,
  EntitlementsSchema,
  FacilitatorQuestionSchema,
  FollowupSchema,
  FollowupSummarySchema,
  HostCommandSchema,
  JoinRequestSchema,
  LegacyReportSchema,
  liveQuestionConfidence,
  normalizeDecimalString,
  OperationalFeaturesUpdateSchema,
  ParticipantQuestionSchema,
  PresentationContentSchema,
  PresentationDraftSchema,
  ProductEventBatchSchema,
  ProductEventNameSchema,
  PublicFeaturesSchema,
  PublishQuizRequestSchema,
  QuestionHealthDismissalInputSchema,
  QuestionHealthPublishedResultSchema,
  QuestionHealthResultSchema,
  QuizContentSchema,
  QuizDraftSchema,
  QuestionSchema,
  ResponseDistributionSchema,
  RoundFilterOptionsResponseSchema,
  SessionSettingsSchema,
  SessionSnapshotSchema,
  SessionDecisionEventSchema,
  SessionCountsResponseSchema,
  SessionHistorySearchSchema,
  ReportV3Schema,
  SyncRequestSchema,
  UpdateQuizRequestSchema,
  WorkspaceProductFeaturesSchema,
} from "../src/index.js";

describe("public contracts", () => {
  it("keeps live confidence optional and inherits collection only when the setting is omitted", () => {
    const settings = {
      audienceLimit: 20,
      scoringMode: "accuracy" as const,
      resultVisibility: "private" as const,
      allowLateJoin: true,
      nicknamePolicy: "custom" as const,
    };
    expect(SessionSettingsSchema.parse(settings)).not.toHaveProperty("confidenceEnabled");
    for (const enabled of [false, true]) {
      expect(
        SessionSettingsSchema.parse({ ...settings, confidenceEnabled: enabled }),
      ).toMatchObject({
        confidenceEnabled: enabled,
      });
    }
    for (const purpose of ["diagnostic", "practice"] as const) {
      for (const confidence of ["off", "optional", "required"] as const) {
        const question = { type: "single_select" as const, purpose, confidence };
        expect(liveQuestionConfidence(question, {})).toBe(
          confidence === "off" ? "off" : "optional",
        );
        expect(liveQuestionConfidence(question, { confidenceEnabled: false })).toBe("off");
        expect(liveQuestionConfidence(question, { confidenceEnabled: true })).toBe("optional");
      }
    }
    for (const confidenceEnabled of [undefined, false, true]) {
      expect(
        liveQuestionConfidence(
          { type: "poll", purpose: "opinion", confidence: "off" },
          { confidenceEnabled },
        ),
      ).toBe("off");
    }
  });

  it("requires a confidence toggle boolean only on confidence.set host commands", () => {
    const command = {
      sessionId: randomUUID(),
      hostToken: "host-confidence-command-token-long-enough",
      commandId: randomUUID(),
      expectedVersion: 0,
    };
    for (const confidenceEnabled of [false, true]) {
      expect(
        HostCommandSchema.parse({ ...command, action: "confidence.set", confidenceEnabled }),
      ).toMatchObject({ action: "confidence.set", confidenceEnabled });
      expect(
        HostCommandSchema.safeParse({ ...command, action: "start", confidenceEnabled }).success,
      ).toBe(false);
    }
    expect(HostCommandSchema.safeParse({ ...command, action: "confidence.set" }).success).toBe(
      false,
    );
    expect(
      HostCommandSchema.safeParse({
        ...command,
        action: "confidence.set",
        confidenceEnabled: "true",
      }).success,
    ).toBe(false);
  });

  it("supports optional private revealed-response summaries with consistent counts", () => {
    const schema = SessionSnapshotSchema.shape.myScoredResponseSummary;
    expect(schema.parse(undefined)).toBeUndefined();
    expect(
      schema.parse({
        answeredScoredQuestions: 2,
        correctScoredQuestions: 1,
        revealedScoredQuestions: 3,
        lastResponseStatus: "unanswered",
      }),
    ).toEqual({
      answeredScoredQuestions: 2,
      correctScoredQuestions: 1,
      revealedScoredQuestions: 3,
      lastResponseStatus: "unanswered",
    });
    for (const summary of [
      { answeredScoredQuestions: -1, correctScoredQuestions: 0, revealedScoredQuestions: 0 },
      { answeredScoredQuestions: 1, correctScoredQuestions: 2, revealedScoredQuestions: 2 },
      { answeredScoredQuestions: 2, correctScoredQuestions: 1, revealedScoredQuestions: 1 },
      {
        answeredScoredQuestions: 0,
        correctScoredQuestions: 0,
        revealedScoredQuestions: 1,
        lastResponseStatus: "pending",
      },
    ]) {
      expect(schema.safeParse(summary).success).toBe(false);
    }
  });

  it("validates exact nonnegative session counts and a trimmed bounded history search", () => {
    expect(
      SessionCountsResponseSchema.parse({ counts: { rounds: 28, presentations: 0, surveys: 2 } }),
    ).toEqual({ counts: { rounds: 28, presentations: 0, surveys: 2 } });
    for (const rounds of [-1, 1.5, "28"]) {
      expect(
        SessionCountsResponseSchema.safeParse({ counts: { rounds, presentations: 0, surveys: 2 } })
          .success,
      ).toBe(false);
    }
    expect(SessionHistorySearchSchema.parse("  Frozen room  ")).toBe("Frozen room");
    expect(SessionHistorySearchSchema.parse("   ")).toBe("");
    expect(SessionHistorySearchSchema.safeParse("x".repeat(161)).success).toBe(false);
  });
  it("validates bounded, versioned Question Health findings", () => {
    const result = QuestionHealthResultSchema.parse({
      quizId: randomUUID(),
      draftRevision: 3,
      rulesetVersion: "1.0.0",
      evaluatedQuestionCount: 1,
      findings: [
        {
          id: `qh-${randomUUID()}`,
          ruleId: "question.missing_citation",
          ruleVersion: 1,
          rulesetVersion: "1.0.0",
          severity: "advisory",
          questionId: randomUUID(),
          fieldPath: "questions.0.sourceCitations",
          contentHash: "a".repeat(64),
          reason: "No source citation is attached.",
          evidence: "The citation list is empty.",
          recommendedAction: "Attach a reviewed citation.",
        },
      ],
      findingsTruncated: false,
    });
    expect(result.findings).toHaveLength(1);
    expect(result.dismissals).toEqual([]);
    expect(
      QuestionHealthResultSchema.safeParse({
        ...result,
        findings: [{ ...result.findings[0], contentHash: "not-a-content-hash" }],
      }).success,
    ).toBe(false);
  });

  it("limits Question Health dismissal feedback to bounded reason codes", () => {
    const input = {
      draftRevision: 3,
      ruleVersion: 1,
      rulesetVersion: "1.0.0",
      contentHash: "b".repeat(64),
      reason: "intentional_choice",
    };
    expect(QuestionHealthDismissalInputSchema.parse(input)).toEqual(input);
    expect(
      QuestionHealthDismissalInputSchema.safeParse({ ...input, reason: "freeform explanation" })
        .success,
    ).toBe(false);
  });

  it("binds published Question Health findings to immutable version provenance", () => {
    const result = QuestionHealthPublishedResultSchema.parse({
      quizId: randomUUID(),
      rulesetVersion: "1.0.0",
      evaluatedQuestionCount: 1,
      findings: [],
      findingsTruncated: false,
      source: "published",
      version: {
        id: randomUUID(),
        number: 2,
        contentHash: "a".repeat(64),
        publishedAt: new Date().toISOString(),
        sourceDraftRevision: null,
      },
    });
    expect(result.version.number).toBe(2);
    expect(
      QuestionHealthPublishedResultSchema.safeParse({
        ...result,
        version: { ...result.version, contentHash: "not-a-hash" },
      }).success,
    ).toBe(false);
  });

  it("defaults legacy reports to Learning mode", () => {
    expect(
      LegacyReportSchema.parse({
        id: randomUUID(),
        sessionId: randomUUID(),
        status: "ready",
        generatedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
        metrics: {
          participantCount: 0,
          completedCount: 0,
          answerCount: 0,
          accuracyPercent: 0,
        },
        questions: [],
        participants: [],
      }),
    ).toMatchObject({
      trustMode: "learning",
      timeMode: "timed",
      decisionReplayAvailable: false,
    });
  });

  it("keeps decision replay aggregate-only and old report schemas explicitly unavailable", () => {
    const legacyV3 = ReportV3Schema.parse({
      id: randomUUID(),
      sessionId: randomUUID(),
      schemaVersion: 3,
      status: "ready",
      generatedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      metrics: {
        participantCount: 0,
        completedCount: 0,
        answerCount: 0,
        accuracyPercent: 0,
      },
      questions: [],
      participants: [],
      initialAccuracy: { correct: 0, responses: 0, percent: 0 },
      confidenceMatrix: [],
      misconceptions: [],
      interventions: [],
      recovery: [],
      unresolvedConcepts: [],
      participation: { participants: 0, respondents: 0, percent: 0 },
      responseTime: { responses: 0, medianMs: null, p95Ms: null },
      qna: { questions: 0, answered: 0, unresolved: 0 },
      participantFeedback: [],
      evidenceNote: "Session evidence only.",
      experience: { category: "general", preset: { id: "focus", version: 1 } },
      audiencePulse: {
        uniqueParticipants: 0,
        events: 0,
        bySignal: { got_it: 0, unsure: 0, need_example: 0, too_fast: 0 },
        contexts: [],
      },
      conversation: {
        messages: 0,
        uniqueContributors: 0,
        reactions: 0,
        reports: 0,
        removed: 0,
        moderationActions: 0,
        peakMessagesPerMinute: 0,
        transcriptAvailable: false,
      },
    });
    expect(legacyV3.decisionReplayAvailable).toBe(false);

    const event = {
      seq: 1,
      occurredAt: new Date().toISOString(),
      type: "insight_shown",
      roundId: randomUUID(),
      questionId: randomUUID(),
      sampleSize: 3,
      activeParticipantCount: 5,
      recommendationCode: "low_participation",
      ruleSetVersion: "checkpoint-insight-v1",
    } as const;
    expect(SessionDecisionEventSchema.parse(event)).toEqual(event);
    expect(
      SessionDecisionEventSchema.safeParse({ ...event, participantId: randomUUID() }).success,
    ).toBe(false);
  });

  it("defaults existing live Round settings to timed mode", () => {
    expect(
      SessionSettingsSchema.parse({
        audienceLimit: 20,
        scoringMode: "speed",
        resultVisibility: "private",
        allowLateJoin: true,
        nicknamePolicy: "custom",
      }).timeMode,
    ).toBe("timed");
  });

  it("accepts every presentation-session error emitted by the API", () => {
    for (const code of [
      "PRECONDITION_REQUIRED",
      "STALE_SESSION",
      "PARTICIPANT_LIMIT",
      "PHASE_CLOSED",
      "ALREADY_RESPONDED",
    ]) {
      expect(
        ApiErrorSchema.safeParse({ error: { code, message: "Request rejected" } }).success,
      ).toBe(true);
    }
  });

  it("keeps facilitator-only Round metadata out of participant question DTOs", () => {
    const participantQuestion = {
      id: randomUUID(),
      type: "single_select" as const,
      prompt: "Which control is safest?",
      confidence: "required" as const,
      choices: [
        { id: randomUUID(), label: "The approved control" },
        { id: randomUUID(), label: "An unapproved shortcut" },
      ],
      timeLimitSeconds: 20,
      basePoints: 1_000,
      mediaId: null,
      mediaAlt: null,
    };

    expect(ParticipantQuestionSchema.parse(participantQuestion)).toEqual(participantQuestion);
    expect(
      ParticipantQuestionSchema.safeParse({
        ...participantQuestion,
        purpose: "diagnostic",
        linkedRecheckAvailable: true,
      }).success,
    ).toBe(false);
    expect(
      FacilitatorQuestionSchema.parse({
        ...participantQuestion,
        purpose: "diagnostic",
        linkedRecheckAvailable: true,
      }),
    ).toMatchObject({ purpose: "diagnostic", linkedRecheckAvailable: true });
  });

  it("requires revision fences for legacy Round mutations and publishing", () => {
    expect(
      UpdateQuizRequestSchema.safeParse({ title: "Unfenced", description: "", questions: [] })
        .success,
    ).toBe(false);
    expect(PublishQuizRequestSchema.safeParse({}).success).toBe(false);
    expect(PublishQuizRequestSchema.parse({ expectedDraftRevision: 0 })).toEqual({
      expectedDraftRevision: 0,
    });
  });

  it("keeps avatar selection allowlisted and backward compatible", () => {
    expect(AVATAR_IDS).toEqual([
      "comet",
      "fox",
      "owl",
      "otter",
      "panda",
      "robot",
      "rocket",
      "star",
      "bear",
      "bunny",
      "cat",
      "dog",
      "koala",
      "lion",
      "penguin",
      "tiger",
      "turtle",
      "dolphin",
      "whale",
      "octopus",
      "butterfly",
      "bee",
      "frog",
      "hedgehog",
    ]);
    expect(new Set(AVATAR_IDS).size).toBe(24);
    for (const avatarId of AVATAR_IDS) {
      expect(AvatarIdSchema.parse(avatarId)).toBe(avatarId);
      expect(
        JoinRequestSchema.parse({ code: "1234567", nickname: "Learner", avatarId }),
      ).toMatchObject({ avatarId });
    }
    expect(
      JoinRequestSchema.parse({ code: "1234567", nickname: "Legacy learner" }),
    ).not.toHaveProperty("avatarId");
    expect(
      JoinRequestSchema.parse({ code: "1234567", nickname: "Learner", avatarId: "fox" }),
    ).toMatchObject({ avatarId: "fox" });
    expect(
      JoinRequestSchema.safeParse({
        code: "1234567",
        nickname: "Learner",
        avatarId: "dragon",
      }).success,
    ).toBe(false);
  });

  it("allows a development inbox hint without requiring it in hosted deployments", () => {
    const base = {
      publicWebUrl: "http://localhost:8080",
      mediaUploads: true,
      billing: "disabled" as const,
      communityMode: true,
      signups: true,
      sessionCreation: true,
      roundExperiences: true,
      audiencePulse: true,
      roomChat: true,
    };

    const parsed = PublicFeaturesSchema.parse(base);
    expect(parsed.developmentEmailInboxUrl).toBeUndefined();
    expect(parsed.presentations).toBe(false);
    expect(
      PublicFeaturesSchema.parse({
        ...base,
        developmentEmailInboxUrl: "http://localhost:8025",
      }).developmentEmailInboxUrl,
    ).toBe("http://localhost:8025");
    expect(
      PublicFeaturesSchema.safeParse({
        ...base,
        developmentEmailInboxUrl: "javascript:alert(1)",
      }).success,
    ).toBe(false);
    expect(
      PublicFeaturesSchema.safeParse({
        ...base,
        developmentEmailInboxUrl: "not a URL",
      }).success,
    ).toBe(false);
  });

  it("requires an explicit authenticated rollout decision for every workspace milestone", () => {
    expect(
      WorkspaceProductFeaturesSchema.parse({
        roundExperiences: true,
        audiencePulse: true,
        roomChat: true,
        uxBeta: true,
        recoveryRehearsal: false,
        practiceAssignments: false,
        workspaceShell: true,
        builderV2: true,
        presentations: false,
        presentationRealtime: false,
        liveFlexMode: false,
        groups: true,
        discover: false,
      }),
    ).toMatchObject({
      workspaceShell: true,
      presentations: false,
      presentationCompanion: false,
      groups: true,
    });
    expect(
      WorkspaceProductFeaturesSchema.parse({
        roundExperiences: true,
        audiencePulse: true,
        roomChat: true,
        uxBeta: true,
        recoveryRehearsal: false,
        practiceAssignments: false,
        workspaceShell: true,
        builderV2: true,
        presentations: false,
        presentationRealtime: false,
        groups: true,
        discover: false,
      }).liveFlexMode,
    ).toBe(false);
    expect(
      WorkspaceProductFeaturesSchema.safeParse({
        roundExperiences: true,
        audiencePulse: true,
        roomChat: true,
        uxBeta: true,
        recoveryRehearsal: false,
        practiceAssignments: false,
      }).success,
    ).toBe(false);
  });

  it("represents finite Free limits and unlimited paid quiz publishing", () => {
    expect(
      EntitlementsSchema.parse({
        plan: "free",
        maxParticipants: 20,
        maxPublishedQuizzes: 5,
        reportRetentionDays: 30,
        csvExport: false,
        brandTheme: false,
        followups: false,
        authoringJobsPerMonth: 3,
      }),
    ).toMatchObject({
      maxPublishedQuizzes: 5,
      csvExport: false,
      maxPracticePersonalLinks: 0,
      recoveryTrails: false,
      maxRecoveryStages: 0,
      conceptHealth: false,
      decisionReplay: false,
    });
    const paid = EntitlementsSchema.parse({
      plan: "pro",
      maxParticipants: 100,
      maxPublishedQuizzes: null,
      reportRetentionDays: 365,
      csvExport: true,
      brandTheme: true,
      followups: true,
      authoringJobsPerMonth: 100,
      maxPracticePersonalLinks: 25,
      recoveryTrails: true,
      maxRecoveryStages: 4,
      conceptHealth: true,
      decisionReplay: true,
    });
    expect(paid).toMatchObject({
      maxPublishedQuizzes: null,
      maxPracticePersonalLinks: 25,
      recoveryTrails: true,
      maxRecoveryStages: 4,
      conceptHealth: true,
      decisionReplay: true,
    });
  });

  it("identifies the source Round in follow-up history summaries", () => {
    const quizId = randomUUID();
    expect(
      FollowupSummarySchema.parse({
        id: randomUUID(),
        purpose: "recovery",
        sourceSessionId: randomUUID(),
        sourceReportId: randomUUID(),
        sourceQuizVersionId: randomUUID(),
        quizId,
        title: "Practice follow-up",
        status: "open",
        conceptKeys: ["core-model"],
        checkpointCount: 1,
        attemptCount: 0,
        completedAttemptCount: 0,
        opensAt: "2026-09-18T12:00:00.000Z",
        closesAt: "2026-09-19T12:00:00.000Z",
        expiresAt: "2026-10-18T12:00:00.000Z",
        createdAt: "2026-09-18T12:00:00.000Z",
      }),
    ).toMatchObject({ quizId });
  });

  it("keeps recovery and standalone practice sources distinct", () => {
    const shared = {
      id: randomUUID(),
      sourceQuizVersionId: randomUUID(),
      title: "Independent practice",
      conceptKeys: [],
      checkpointCount: 2,
      timeMode: "flex" as const,
      opensAt: "2026-09-18T12:00:00.000Z",
      closesAt: "2026-09-25T12:00:00.000Z",
      expiresAt: "2026-10-18T12:00:00.000Z",
      closedAt: null,
      createdAt: "2026-09-18T12:00:00.000Z",
    };
    expect(
      FollowupSchema.parse({
        ...shared,
        purpose: "assignment",
        sourceSessionId: null,
        sourceReportId: null,
      }),
    ).toMatchObject({ purpose: "assignment", sourceReportId: null });
    expect(
      FollowupSchema.safeParse({
        ...shared,
        purpose: "assignment",
        sourceSessionId: randomUUID(),
        sourceReportId: null,
      }).success,
    ).toBe(false);
    expect(
      FollowupSchema.safeParse({
        ...shared,
        purpose: "recovery",
        sourceSessionId: null,
        sourceReportId: null,
      }).success,
    ).toBe(false);
    expect(
      FollowupSchema.safeParse({
        ...shared,
        purpose: "assignment",
        sourceSessionId: null,
        sourceReportId: null,
        conceptKeys: ["recovery-only"],
      }).success,
    ).toBe(false);
  });

  it("validates bounded, unique personal labels for practice assignments", () => {
    const closesAt = "2026-09-25T12:00:00.000Z";
    const sourceQuizVersionId = randomUUID();
    expect(
      CreatePracticeAssignmentSchema.parse({
        sourceQuizVersionId,
        closesAt,
        personalLabels: ["Ada", "Grace"],
      }),
    ).toMatchObject({
      sourceQuizVersionId,
      timeMode: "flex",
      personalLabels: ["Ada", "Grace"],
    });
    expect(
      CreatePracticeAssignmentSchema.safeParse({
        closesAt,
        personalLabels: [],
      }).success,
    ).toBe(false);
    expect(
      CreatePracticeAssignmentSchema.safeParse({
        sourceQuizVersionId,
        closesAt,
        personalLabels: ["Ada", " ada "],
      }).success,
    ).toBe(false);
  });

  it("keeps history Round filter options summary-only", () => {
    const option = RoundFilterOptionsResponseSchema.parse({
      quizzes: [
        {
          id: randomUUID(),
          title: "Summary-only Round",
          draft: { questions: [{ answer: "must not survive parsing" }] },
        },
      ],
    }).quizzes[0]!;

    expect(Object.keys(option).sort()).toEqual(["id", "title"]);
  });

  it("keeps beta telemetry dimensions bounded and distribution samples staff-safe", () => {
    expect(ProductEventNameSchema.options).toEqual([
      "creation_started",
      "creation_completed",
      "first_block_created",
      "draft_save_failed",
      "draft_conflict",
      "publish_blocked",
      "creation_abandoned",
      "presentation_host_started",
      "presentation_reconnected",
      "round_published",
      "setup_recipe_selected",
      "host_setup_completed",
      "participant_joined",
      "first_answer_submitted",
      "response_saved_acknowledged",
      "question_locked",
      "insight_shown",
      "intervention_started",
      "recheck_opened",
      "linked_recheck_opened",
      "report_reconciled",
      "report_viewed",
      "followup_shared",
      "practice_assignment_created",
      "practice_assignment_shared",
      "rehearsal_started",
      "rehearsal_completed",
    ]);
    for (const name of ProductEventNameSchema.options) {
      const dimensions =
        name === "creation_started" || name === "creation_completed"
          ? { creationPath: "starter", artifactType: "round" }
          : [
                "first_block_created",
                "draft_save_failed",
                "draft_conflict",
                "publish_blocked",
                "creation_abandoned",
                "presentation_host_started",
                "presentation_reconnected",
              ].includes(name)
            ? { artifactType: "presentation" }
            : name === "setup_recipe_selected"
              ? { recipe: "recovery" }
              : name === "linked_recheck_opened" || name === "report_reconciled"
                ? { artifactType: "round" }
                : name === "rehearsal_started"
                  ? { scenario: "split_room" }
                  : name === "rehearsal_completed"
                    ? { scenario: "split_room", durationBucket: "1_to_5m" }
                    : {};
      expect(
        ProductEventBatchSchema.safeParse({
          events: [{ name, occurredAt: new Date().toISOString(), dimensions }],
        }).success,
      ).toBe(true);
    }
    for (const event of [
      { name: "creation_started", dimensions: {} },
      { name: "creation_completed", dimensions: {} },
      { name: "creation_started", dimensions: { creationPath: "starter" } },
      { name: "creation_completed", dimensions: { creationPath: "starter" } },
      { name: "first_block_created", dimensions: {} },
      { name: "draft_save_failed", dimensions: {} },
      { name: "draft_conflict", dimensions: {} },
      { name: "publish_blocked", dimensions: {} },
      { name: "creation_abandoned", dimensions: {} },
      { name: "presentation_host_started", dimensions: { artifactType: "round" } },
      { name: "presentation_reconnected", dimensions: { artifactType: "round" } },
      { name: "linked_recheck_opened", dimensions: {} },
      { name: "report_reconciled", dimensions: {} },
      { name: "setup_recipe_selected", dimensions: {} },
      { name: "rehearsal_started", dimensions: {} },
      { name: "rehearsal_completed", dimensions: { scenario: "split_room" } },
      { name: "rehearsal_completed", dimensions: { durationBucket: "1_to_5m" } },
    ]) {
      expect(
        ProductEventBatchSchema.safeParse({
          events: [{ ...event, occurredAt: new Date().toISOString() }],
        }).success,
      ).toBe(false);
    }
    expect(
      ProductEventBatchSchema.safeParse({
        events: [
          {
            name: "creation_started",
            occurredAt: new Date().toISOString(),
            dimensions: {
              creationPath: "starter",
              artifactType: "round",
              objectId: randomUUID(),
            },
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      ProductEventBatchSchema.safeParse({
        events: [
          {
            name: "creation_started",
            occurredAt: new Date().toISOString(),
            dimensions: { creationPath: "starter", artifactType: "round" },
            actorId: randomUUID(),
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      ProductEventBatchSchema.safeParse({
        events: Array.from({ length: 21 }, () => ({
          name: "rehearsal_completed",
          occurredAt: new Date().toISOString(),
          dimensions: { scenario: "split_room", durationBucket: "1_to_5m" },
        })),
      }).success,
    ).toBe(false);

    expect(
      ResponseDistributionSchema.safeParse({
        kind: "choice",
        respondents: 4,
        totalSelections: 4,
        percentBasis: "responses",
        buckets: [],
      }).success,
    ).toBe(false);
    expect(
      ResponseDistributionSchema.parse({
        kind: "numeric",
        respondents: 5,
        correct: 3,
        incorrect: 2,
      }),
    ).toEqual({ kind: "numeric", respondents: 5, correct: 3, incorrect: 2 });
  });

  it("requires brand colours to remain readable with white live-view text", () => {
    expect(
      BrandThemeSchema.parse({
        organizationName: "Northern Learning",
        primaryColor: "#0b2239",
        accentColor: "#087375",
      }),
    ).toEqual({
      organizationName: "Northern Learning",
      primaryColor: "#0B2239",
      accentColor: "#087375",
    });
    expect(
      BrandThemeSchema.safeParse({
        organizationName: "Unreadable",
        primaryColor: "#FFFFFF",
        accentColor: "#FFFF00",
      }).success,
    ).toBe(false);
  });

  it("rejects questions with more than one correct choice", () => {
    const result = QuestionSchema.safeParse({
      id: randomUUID(),
      type: "single_select",
      prompt: "Which answers are marked correct?",
      choices: [
        { id: randomUUID(), label: "A", isCorrect: true },
        { id: randomUUID(), label: "B", isCorrect: true },
      ],
      timeLimitSeconds: 20,
      basePoints: 1_000,
      explanation: "",
      mediaId: null,
      mediaAlt: null,
    });

    expect(result.success).toBe(false);
  });

  it("saves incomplete drafts but requires complete publishable content", () => {
    const draft = {
      title: "Draft in progress",
      description: "",
      questions: [
        {
          id: randomUUID(),
          type: "single_select" as const,
          prompt: "",
          choices: [
            { id: randomUUID(), label: "", isCorrect: true },
            { id: randomUUID(), label: "", isCorrect: false },
          ],
          timeLimitSeconds: 20,
          basePoints: 1_000,
          explanation: "",
          mediaId: null,
          mediaAlt: null,
        },
      ],
    };

    expect(QuizDraftSchema.safeParse(draft).success).toBe(true);
    const publishable = QuizContentSchema.safeParse(draft);
    expect(publishable.success).toBe(false);
    if (!publishable.success) {
      expect(publishable.error.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: ["questions", 0, "prompt"],
            message: "Enter the checkpoint prompt",
          }),
          expect.objectContaining({
            path: ["questions", 0, "choices", 0, "label"],
            message: "Enter an answer",
          }),
        ]),
      );
    }
  });

  it("stores transient answer and rating states but rejects them at publish time", () => {
    const choiceId = randomUUID();
    const incomplete = {
      title: "Still editing",
      description: "",
      questions: [
        {
          id: randomUUID(),
          type: "multi_select" as const,
          prompt: "Select every applicable answer",
          choices: [
            { id: choiceId, label: "First", isCorrect: false },
            { id: randomUUID(), label: "Second", isCorrect: false },
          ],
          timeLimitSeconds: 20,
          basePoints: 1_000,
          explanation: "",
          mediaId: null,
          mediaAlt: null,
        },
        {
          id: randomUUID(),
          type: "rating" as const,
          prompt: "Rate this",
          min: 5,
          max: 5,
          minLabel: "Low",
          maxLabel: "High",
          timeLimitSeconds: 20,
          basePoints: 1_000,
          explanation: "",
          mediaId: null,
          mediaAlt: null,
        },
      ],
    };

    expect(QuizDraftSchema.safeParse(incomplete).success).toBe(true);
    expect(QuizContentSchema.safeParse(incomplete).success).toBe(false);
  });

  it("preserves versioned experience metadata when content is published", () => {
    const content = QuizContentSchema.parse({
      title: "Technical checkpoint",
      description: "",
      category: "technical",
      experiencePreset: { id: "blueprint", version: 1 },
      questions: [
        {
          id: randomUUID(),
          type: "true_false",
          prompt: "The published version owns its experience preset.",
          choices: [
            { id: randomUUID(), label: "True", isCorrect: true },
            { id: randomUUID(), label: "False", isCorrect: false },
          ],
          timeLimitSeconds: 20,
          basePoints: 1_000,
          explanation: "Presentation metadata is immutable with the content version.",
          mediaId: null,
          mediaAlt: null,
        },
      ],
    });

    expect(content).toMatchObject({
      category: "technical",
      experiencePreset: { id: "blueprint", version: 1 },
    });
  });

  it("keeps the public snapshot free of answer keys while a question is open", () => {
    const snapshot = SessionSnapshotSchema.parse({
      sessionId: randomUUID(),
      code: "1234567",
      version: 2,
      seq: 2,
      phase: "question_open",
      roundId: randomUUID(),
      questionIndex: 0,
      questionCount: 1,
      question: {
        id: randomUUID(),
        prompt: "A question",
        choices: [{ id: randomUUID(), label: "An answer" }],
        timeLimitSeconds: 20,
        basePoints: 1_000,
        mediaId: null,
        mediaAlt: null,
      },
      deadline: new Date().toISOString(),
      participants: [],
      answerCount: 0,
      lobbyLocked: false,
      settings: {
        audienceLimit: 20,
        scoringMode: "accuracy",
        resultVisibility: "private",
        allowLateJoin: true,
        nicknamePolicy: "custom",
      },
      brandTheme: null,
      experienceTheme: {
        preset: { id: "focus", version: 1 },
        name: "Focus",
        category: "general",
        motion: "calm",
        soundCue: "none",
        soundEnabled: false,
        tokens: {
          canvas: "#F7F4EC",
          surface: "#FFFFFF",
          surfaceStrong: "#DCEEEE",
          text: "#0B2239",
          mutedText: "#425B72",
          primary: "#075E63",
          accent: "#8A3D22",
          choiceColors: ["#075E63", "#7B3657", "#6D4B0C", "#345594", "#553D8A", "#23613F"],
          pattern: "dots",
          typography: "humanist",
          corners: "soft",
        },
      },
      pausedRemainingMs: null,
    });

    expect(JSON.stringify(snapshot)).not.toContain("isCorrect");
    expect(JSON.stringify(snapshot)).not.toContain("correctChoiceId");
    expect(snapshot.answerRevealed).toBe(false);
  });

  it("requires an explicit participant for kick commands", () => {
    const result = HostCommandSchema.safeParse({
      sessionId: randomUUID(),
      hostToken: "a-secure-host-token-with-enough-length",
      commandId: randomUUID(),
      expectedVersion: 3,
      action: "kick",
    });

    expect(result.success).toBe(false);
  });

  it("requires role-appropriate synchronization credentials", () => {
    expect(
      SyncRequestSchema.safeParse({
        sessionId: randomUUID(),
        role: "participant",
        hostToken: "a-secure-host-token-with-enough-length",
        lastSeq: 0,
      }).success,
    ).toBe(false);
    expect(
      SyncRequestSchema.safeParse({
        sessionId: randomUUID(),
        role: "presenter",
        participantToken: "a-secure-participant-token-long-enough",
        lastSeq: 0,
      }).success,
    ).toBe(false);
  });

  it("requires a nonempty operational feature update", () => {
    expect(OperationalFeaturesUpdateSchema.safeParse({}).success).toBe(false);
    expect(OperationalFeaturesUpdateSchema.parse({ sessionCreation: false })).toStrictEqual({
      sessionCreation: false,
    });
  });

  it("accepts legacy and canonical answer requests, but never both at once", () => {
    const base = {
      sessionId: randomUUID(),
      roundId: randomUUID(),
      participantToken: "a-secure-participant-token-long-enough",
      idempotencyKey: randomUUID(),
    };
    const choiceId = randomUUID();

    expect(AnswerSubmitSchema.safeParse({ ...base, choiceId }).success).toBe(true);
    expect(
      AnswerSubmitSchema.safeParse({
        ...base,
        response: { kind: "choice", choiceIds: [choiceId] },
        confidence: 3,
      }).success,
    ).toBe(true);
    expect(
      AnswerSubmitSchema.safeParse({
        ...base,
        choiceId,
        response: { kind: "choice", choiceIds: [choiceId] },
      }).success,
    ).toBe(false);
    expect(AnswerSubmitSchema.safeParse(base).success).toBe(false);
  });

  it("canonicalizes decimals and choice sets without floating-point coercion", () => {
    expect(normalizeDecimalString("+00042.5000")).toBe("42.5");
    expect(normalizeDecimalString("-.5000")).toBe("-0.5");
    expect(() => normalizeDecimalString("1e3")).toThrow(/without exponent notation/);

    const first = randomUUID();
    const second = randomUUID();
    expect(canonicalizeResponse({ kind: "choice", choiceIds: [second, first] })).toStrictEqual({
      kind: "choice",
      choiceIds: [first, second].sort(),
    });
  });

  it("rejects adversarial decimal input without regex backtracking", () => {
    const longInvalidDecimal = `${"1".repeat(100_000)}x`;
    expect(() => normalizeDecimalString(longInvalidDecimal)).toThrow(/without exponent notation/);
  });

  it("enforces unscored opinion rules for rating and poll checkpoints", () => {
    const common = {
      id: randomUUID(),
      prompt: "How useful was this checkpoint?",
      purpose: "opinion" as const,
      confidence: "off" as const,
      delivery: "main" as const,
      conceptKeys: [],
      linkedRecheckQuestionId: null,
      timeLimitSeconds: 20,
      basePoints: 0,
      explanation: "",
      mediaId: null,
      mediaAlt: null,
    };
    expect(
      QuestionSchema.safeParse({
        ...common,
        type: "rating",
        min: 1,
        max: 5,
        minLabel: "Not useful",
        maxLabel: "Very useful",
      }).success,
    ).toBe(true);
    expect(
      QuestionSchema.safeParse({
        ...common,
        type: "poll",
        basePoints: 1_000,
        choices: [
          { id: randomUUID(), label: "Yes", isCorrect: false },
          { id: randomUUID(), label: "No", isCorrect: false },
        ],
      }).success,
    ).toBe(false);
  });

  it("requires linked checkpoints to exist and be marked as rechecks", () => {
    const linkedId = randomUUID();
    const common = {
      prompt: "Choose one",
      type: "single_select" as const,
      purpose: "diagnostic" as const,
      confidence: "off" as const,
      conceptKeys: [],
      timeLimitSeconds: 20,
      basePoints: 1_000,
      explanation: "",
      mediaId: null,
      mediaAlt: null,
      choices: [
        { id: randomUUID(), label: "A", isCorrect: true },
        { id: randomUUID(), label: "B", isCorrect: false },
      ],
    };
    const content = {
      title: "Recovery set",
      description: "",
      questions: [
        {
          ...common,
          id: randomUUID(),
          delivery: "main" as const,
          linkedRecheckQuestionId: linkedId,
        },
        {
          ...common,
          id: linkedId,
          delivery: "recheck" as const,
          linkedRecheckQuestionId: null,
        },
      ],
    };
    expect(QuizContentSchema.safeParse(content).success).toBe(true);
    expect(
      QuizContentSchema.safeParse({ ...content, questions: [content.questions[0]] }).success,
    ).toBe(false);

    const shared = structuredClone(content);
    shared.questions.splice(1, 0, {
      ...common,
      id: randomUUID(),
      delivery: "main" as const,
      linkedRecheckQuestionId: linkedId,
    });
    const sharedResult = QuizContentSchema.safeParse(shared);
    expect(sharedResult.success).toBe(false);
    expect(sharedResult.error?.issues.map(({ message }) => message)).toContain(
      "A recheck cannot be shared by multiple diagnostic checkpoints",
    );

    const misordered = { ...content, questions: [...content.questions].reverse() };
    const orderResult = QuizContentSchema.safeParse(misordered);
    expect(orderResult.success).toBe(false);
    expect(orderResult.error?.issues.map(({ message }) => message)).toContain(
      "Place the linked recheck after its diagnostic checkpoint",
    );

    const orphan = structuredClone(content);
    orphan.questions[0]!.linkedRecheckQuestionId = null;
    const orphanResult = QuizContentSchema.safeParse(orphan);
    expect(orphanResult.success).toBe(false);
    expect(orphanResult.error?.issues.map(({ message }) => message)).toContain(
      "Every recheck must be linked from one earlier diagnostic checkpoint",
    );
  });

  it("requires a main checkpoint and unique checkpoint and per-question choice ids", () => {
    const questionId = randomUUID();
    const choiceId = randomUUID();
    const question = {
      id: questionId,
      prompt: "Choose one",
      type: "single_select" as const,
      delivery: "recheck" as const,
      timeLimitSeconds: 20,
      basePoints: 1_000,
      explanation: "",
      mediaId: null,
      mediaAlt: null,
      choices: [
        { id: choiceId, label: "A", isCorrect: true },
        { id: randomUUID(), label: "B", isCorrect: false },
      ],
    };
    const allRechecks = { title: "Invalid", description: "", questions: [question] };
    expect(QuizContentSchema.safeParse(allRechecks).success).toBe(false);

    const duplicateIds = {
      ...allRechecks,
      questions: [
        { ...question, delivery: "main" as const },
        {
          ...question,
          delivery: "main" as const,
          choices: [
            { id: choiceId, label: "C", isCorrect: true },
            { id: choiceId, label: "D", isCorrect: false },
          ],
        },
      ],
    };
    const parsed = QuizContentSchema.safeParse(duplicateIds);
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues.map((issue) => issue.message)).toEqual(
        expect.arrayContaining([
          "Checkpoint IDs must be unique",
          "Answer choice IDs must be unique",
        ]),
      );
    }
  });

  it("keeps presentation drafts autosaveable while enforcing publish accessibility", () => {
    const mediaId = randomUUID();
    const slideId = randomUUID();
    const draft = {
      title: "Accessible presentation",
      description: "",
      experiencePreset: { id: "focus" as const, version: 1 as const },
      schemaVersion: 2 as const,
      blocks: [
        {
          id: slideId,
          kind: "content" as const,
          layout: "media" as const,
          textElements: [
            {
              id: `${slideId}:title`,
              role: "title" as const,
              text: "Evidence",
              region: "top_center" as const,
              order: 0,
            },
            {
              id: `${slideId}:body`,
              role: "body" as const,
              text: "",
              region: "middle_center" as const,
              order: 0,
            },
          ],
          mediaId,
          mediaAlt: null,
          speakerNotes: "",
        },
        {
          id: randomUUID(),
          kind: "question" as const,
          question: {
            id: randomUUID(),
            type: "single_select" as const,
            prompt: "Which signal is strongest?",
            choices: [
              { id: randomUUID(), label: "Observed behaviour", isCorrect: true },
              { id: randomUUID(), label: "Raw volume", isCorrect: false },
            ],
            timeLimitSeconds: 20,
            basePoints: 1_000,
            explanation: "",
            mediaId: null,
            mediaAlt: null,
          },
        },
      ],
    };

    expect(PresentationDraftSchema.safeParse(draft).success).toBe(true);
    const publish = PresentationContentSchema.safeParse(draft);
    expect(publish.success).toBe(false);
    if (!publish.success) {
      expect(publish.error.issues.map((issue) => issue.message)).toContain(
        "Describe the slide image for participants who cannot see it",
      );
    }

    const questionId = randomUUID();
    expect(
      CopyRoundQuestionsToPresentationSchema.safeParse({
        sourceQuizVersionId: randomUUID(),
        questionIds: [questionId, questionId],
        afterBlockId: null,
        expectedRevision: 0,
        mutationId: randomUUID(),
      }).success,
    ).toBe(false);
  });
});
