import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { deriveRoundProtocol, type Report } from "@openround/contracts";
import type { SessionEvidence } from "@openround/db";
import { addParticipant, createGameState, type EngineAnswer } from "@openround/game-engine";
import { createPendingReport, generateReport, reportCsv } from "../src/reporting.js";

describe("report CSV", () => {
  it("records the frozen Round time mode in new reports", () => {
    const state = createGameState({
      sessionId: randomUUID(),
      code: "1234567",
      quiz: { title: "Flex evidence", description: "", questions: [] },
      settings: {
        audienceLimit: 20,
        timeMode: "flex",
        scoringMode: "speed",
        resultVisibility: "private",
        allowLateJoin: true,
        nicknamePolicy: "custom",
      },
    });
    expect(createPendingReport(state, new Date("2026-10-01T00:00:00.000Z"))).toMatchObject({
      timeMode: "flex",
      trustMode: "learning",
    });
    const ready = generateReport(state, new Date("2026-10-01T00:00:00.000Z"));
    expect(ready.timeMode).toBe("flex");
    expect(reportCsv(ready)).toContain("time_mode,flex");
  });

  it("emits a V4 timeline only from explicitly captured session evidence", () => {
    const state = createGameState({
      sessionId: randomUUID(),
      code: "7654321",
      quiz: { title: "Replay evidence", description: "", questions: [] },
      settings: {
        audienceLimit: 20,
        scoringMode: "accuracy",
        resultVisibility: "private",
        allowLateJoin: true,
        nicknamePolicy: "custom",
      },
    });
    const expiresAt = new Date("2026-10-01T00:00:00.000Z");
    const pending = createPendingReport(state, expiresAt, true);
    expect(pending).toMatchObject({
      schemaVersion: 4,
      decisionReplayAvailable: false,
      decisionReplayComplete: false,
      decisionTimeline: [],
    });
    const finishedEvent = {
      seq: 1,
      occurredAt: "2026-09-30T12:00:00.000Z",
      type: "session_finished" as const,
      reason: "completed" as const,
    };
    const ready = generateReport(state, expiresAt, {
      evidence: {
        decisionReplayEnabled: true,
        decisionEvents: [finishedEvent],
        decisionEventsComplete: true,
        answers: [],
        rounds: [],
        interventions: [],
        qna: { questions: 0, answered: 0, unresolved: 0 },
      },
    });
    expect(ready).toMatchObject({
      schemaVersion: 4,
      decisionReplayAvailable: true,
      decisionReplayComplete: true,
      decisionTimeline: [finishedEvent],
    });
    expect(reportCsv(ready)).toContain("session_finished,1,2026-09-30T12:00:00.000Z");

    const noCapture = generateReport(state, expiresAt, {
      evidence: {
        decisionReplayEnabled: true,
        decisionEvents: [],
        decisionEventsComplete: false,
        answers: [],
        rounds: [],
        interventions: [],
        qna: { questions: 0, answered: 0, unresolved: 0 },
      },
    });
    expect(noCapture).toMatchObject({
      schemaVersion: 4,
      decisionReplayAvailable: false,
      decisionReplayComplete: false,
      decisionTimeline: [],
    });
  });

  it("neutralizes spreadsheet formulas in participant-controlled nicknames", () => {
    const dangerousNicknames = ["=1+1", "+SUM(A1:A2)", "-2+3", "@IMPORTDATA(A1)", "\t=1+1"];
    const report: Report = {
      id: randomUUID(),
      sessionId: randomUUID(),
      status: "ready",
      generatedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      metrics: {
        participantCount: dangerousNicknames.length + 1,
        completedCount: 0,
        answerCount: 0,
        accuracyPercent: 0,
      },
      questions: [],
      participants: [...dangerousNicknames, "Safe nickname"].map((nickname) => ({
        participantId: randomUUID(),
        nickname,
        score: 0,
        correctCount: 0,
        answerCount: 0,
      })),
    };

    const csv = reportCsv(report);

    for (const nickname of dangerousNicknames) expect(csv).toContain(`'${nickname}`);
    expect(csv).toContain(",Safe nickname,0,0,0");
    expect(csv).not.toMatch(/,[=+@-]/);
  });

  it("separates initial accuracy from linked-recheck recovery evidence", () => {
    const sourceQuestionId = randomUUID();
    const recheckQuestionId = randomUUID();
    const sourceRoundId = randomUUID();
    const recheckRoundId = randomUUID();
    const interventionId = randomUUID();
    const correctChoiceId = randomUUID();
    const misconceptionChoiceId = randomUUID();
    const recheckCorrectId = randomUUID();
    const firstParticipantId = randomUUID();
    const secondParticipantId = randomUUID();
    const kickedParticipantId = randomUUID();
    let state = createGameState({
      sessionId: randomUUID(),
      code: "1234567",
      quiz: {
        title: "Recovery evidence",
        description: "",
        questions: [
          {
            id: sourceQuestionId,
            type: "single_select",
            prompt: "Choose the safe procedure",
            purpose: "diagnostic",
            confidence: "required",
            delivery: "main",
            conceptKeys: ["safe-work"],
            linkedRecheckQuestionId: recheckQuestionId,
            choices: [
              { id: correctChoiceId, label: "Safe", isCorrect: true },
              {
                id: misconceptionChoiceId,
                label: "Shortcut",
                isCorrect: false,
                misconceptionKey: "shortcut-is-safe",
              },
            ],
            timeLimitSeconds: 20,
            basePoints: 1_000,
            explanation: "Use the complete safe procedure.",
            mediaId: null,
            mediaAlt: null,
          },
          {
            id: recheckQuestionId,
            type: "true_false",
            prompt: "The procedure still applies in this scenario.",
            purpose: "practice",
            confidence: "off",
            delivery: "recheck",
            conceptKeys: ["safe-work"],
            linkedRecheckQuestionId: null,
            choices: [
              { id: recheckCorrectId, label: "True", isCorrect: true },
              { id: randomUUID(), label: "False", isCorrect: false },
            ],
            timeLimitSeconds: 20,
            basePoints: 1_000,
            explanation: "It applies.",
            mediaId: null,
            mediaAlt: null,
          },
        ],
      },
      settings: {
        audienceLimit: 20,
        scoringMode: "accuracy",
        resultVisibility: "private",
        allowLateJoin: true,
        nicknamePolicy: "custom",
      },
    });
    for (const [id, nickname] of [
      [firstParticipantId, "First"],
      [secondParticipantId, "Second"],
    ] as const) {
      state = addParticipant(state, {
        id,
        nickname,
        avatarId: id === firstParticipantId ? "otter" : "robot",
        score: id === secondParticipantId ? 1_000 : 0,
        correctCount: id === secondParticipantId ? 1 : 0,
        acceptedResponseMs: 1_000,
        connected: false,
        kicked: false,
      }).state;
    }
    state = addParticipant(state, {
      id: kickedParticipantId,
      nickname: "Removed participant",
      score: 0,
      correctCount: 0,
      acceptedResponseMs: 1_000,
      connected: false,
      kicked: true,
    }).state;
    const answer = (
      participantId: string,
      roundId: string,
      choiceId: string,
      correct: boolean,
      confidence: 1 | 2 | 3 | null,
      acceptedAtMs: number,
    ): EngineAnswer => ({
      answerId: randomUUID(),
      participantId,
      roundId,
      response: { kind: "choice", choiceIds: [choiceId] },
      confidence,
      choiceId,
      acceptedAtMs,
      responseMs: 1_000,
      score: roundId === sourceRoundId && correct ? 1_000 : 0,
      correct,
      idempotencyKey: randomUUID(),
    });
    const generated = generateReport(state, new Date("2026-10-01T00:00:00.000Z"), {
      generatedAt: new Date("2026-09-01T00:00:00.000Z"),
      evidence: {
        decisionReplayEnabled: false,
        decisionEvents: [],
        decisionEventsComplete: false,
        answers: [
          answer(firstParticipantId, sourceRoundId, misconceptionChoiceId, false, 3, 2_000),
          answer(secondParticipantId, sourceRoundId, correctChoiceId, true, 1, 2_100),
          answer(kickedParticipantId, sourceRoundId, misconceptionChoiceId, false, 3, 2_200),
          answer(firstParticipantId, recheckRoundId, recheckCorrectId, true, null, 5_000),
        ],
        rounds: [
          {
            id: sourceRoundId,
            questionId: sourceQuestionId,
            position: 0,
            kind: "main",
            sourceRoundId: null,
            interventionId: null,
            openedAtMs: 1_000,
            deadlineMs: 21_000,
            lockedAtMs: 3_000,
          },
          {
            id: recheckRoundId,
            questionId: recheckQuestionId,
            position: 1,
            kind: "linked_recheck",
            sourceRoundId,
            interventionId,
            openedAtMs: 4_000,
            deadlineMs: 24_000,
            lockedAtMs: 6_000,
          },
        ],
        interventions: [
          {
            id: interventionId,
            type: "explain",
            sourceRoundId,
            startedAtMs: 3_000,
            finishedAtMs: 4_000,
          },
        ],
        qna: { questions: 2, answered: 1, unresolved: 1 },
        interactions: {
          signalEvents: [
            {
              contextKey: `round:${sourceRoundId}`,
              participantId: firstParticipantId,
              signal: "unsure",
              createdAt: new Date(1_500),
            },
            {
              contextKey: `round:${sourceRoundId}`,
              participantId: firstParticipantId,
              signal: "got_it",
              createdAt: new Date(2_500),
            },
            {
              contextKey: `round:${sourceRoundId}`,
              participantId: secondParticipantId,
              signal: "need_example",
              createdAt: new Date(2_600),
            },
            {
              contextKey: `round:${sourceRoundId}`,
              participantId: secondParticipantId,
              signal: null,
              createdAt: new Date(2_700),
            },
          ],
          chatMessages: [],
          reactions: [],
          reports: 0,
          moderationActions: 0,
        },
      },
    });

    expect(generated).toMatchObject({
      schemaVersion: 3,
      status: "ready",
      metrics: { participantCount: 2, completedCount: 2, answerCount: 3 },
      initialAccuracy: { correct: 1, responses: 2, percent: 50 },
      recovery: [
        {
          evidenceType: "linked_recheck",
          recovered: 1,
          initiallyIncorrectWithBoth: 1,
          recoveryPercent: 100,
          smallSample: true,
        },
      ],
      misconceptions: [
        {
          key: "shortcut-is-safe",
          responses: 1,
          allResponsePercent: 50,
          wrongResponsePercent: 100,
        },
      ],
      unresolvedConcepts: [
        { conceptKey: "safe-work", initiallyIncorrect: 1, recovered: 1, unresolved: 0 },
      ],
      qna: { questions: 2, answered: 1, unresolved: 1 },
      audiencePulse: {
        uniqueParticipants: 2,
        events: 4,
        bySignal: { got_it: 1, unsure: 0, need_example: 0, too_fast: 0 },
        contexts: [
          {
            contextKey: `round:${sourceRoundId}`,
            uniqueParticipants: 2,
            bySignal: { got_it: 1, unsure: 0, need_example: 0, too_fast: 0 },
          },
        ],
      },
    });
    expect(generated.evidenceNote).toContain("not be interpreted as proof");
    expect(generated.participants).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ participantId: firstParticipantId, avatarId: "otter" }),
        expect.objectContaining({ participantId: secondParticipantId, avatarId: "robot" }),
      ]),
    );
  });

  it("persists only privacy-safe question distributions with at least five respondents", () => {
    const questionId = randomUUID();
    const correctChoiceId = randomUUID();
    const wrongChoiceId = randomUUID();
    const roundId = randomUUID();
    let state = createGameState({
      sessionId: randomUUID(),
      code: "7654321",
      quiz: {
        title: "Distribution evidence",
        description: "",
        questions: [
          {
            id: questionId,
            type: "single_select",
            prompt: "Choose one",
            purpose: "diagnostic",
            confidence: "off",
            delivery: "main",
            conceptKeys: [],
            linkedRecheckQuestionId: null,
            choices: [
              { id: correctChoiceId, label: "Correct", isCorrect: true },
              { id: wrongChoiceId, label: "Incorrect", isCorrect: false },
            ],
            timeLimitSeconds: 20,
            basePoints: 1_000,
            explanation: "",
            mediaId: null,
            mediaAlt: null,
          },
        ],
      },
      settings: {
        audienceLimit: 20,
        scoringMode: "accuracy",
        resultVisibility: "private",
        allowLateJoin: true,
        nicknamePolicy: "friendly_only",
      },
    });
    const participantIds = Array.from({ length: 5 }, () => randomUUID());
    for (const [index, participantId] of participantIds.entries()) {
      state = addParticipant(state, {
        id: participantId,
        nickname: `Participant ${index + 1}`,
        score: 0,
        correctCount: 0,
        acceptedResponseMs: 1_000,
        connected: false,
        kicked: false,
      }).state;
    }
    const answers: EngineAnswer[] = participantIds.map((participantId, index) => ({
      answerId: randomUUID(),
      participantId,
      roundId,
      response: {
        kind: "choice",
        choiceIds: [index < 3 ? correctChoiceId : wrongChoiceId],
      },
      confidence: null,
      choiceId: index < 3 ? correctChoiceId : wrongChoiceId,
      acceptedAtMs: 2_000 + index,
      responseMs: 1_000,
      score: index < 3 ? 1_000 : 0,
      correct: index < 3,
      idempotencyKey: randomUUID(),
    }));
    const evidence = (selectedAnswers: EngineAnswer[]) => ({
      decisionReplayEnabled: false,
      decisionEvents: [],
      decisionEventsComplete: false,
      answers: selectedAnswers,
      rounds: [
        {
          id: roundId,
          questionId,
          position: 0,
          kind: "main" as const,
          sourceRoundId: null,
          interventionId: null,
          openedAtMs: 1_000,
          deadlineMs: 21_000,
          lockedAtMs: 3_000,
        },
      ],
      interventions: [],
      qna: { questions: 0, answered: 0, unresolved: 0 },
      interactions: {
        signalEvents: [],
        chatMessages: [],
        reactions: [],
        reports: 0,
        moderationActions: 0,
      },
    });

    const report = generateReport(state, new Date("2026-10-01T00:00:00.000Z"), {
      evidence: evidence(answers),
    });
    expect(report.questions[0]?.responseDistribution).toMatchObject({
      kind: "choice",
      respondents: 5,
      totalSelections: 5,
      buckets: [
        { label: "Correct", count: 3, percent: 60 },
        { label: "Incorrect", count: 2, percent: 40 },
      ],
    });

    const smallReport = generateReport(state, new Date("2026-10-01T00:00:00.000Z"), {
      evidence: evidence(answers.slice(0, 4)),
    });
    expect(smallReport.questions[0]?.responseDistribution).toBeUndefined();
  });

  it("retains assessed revote recovery while excluding opinion revotes in mixed evidence", () => {
    const numeric = {
      id: randomUUID(),
      type: "numeric" as const,
      prompt: "Synthetic checkpoint",
      purpose: "diagnostic" as const,
      confidence: "off" as const,
      delivery: "main" as const,
      conceptKeys: ["synthetic-concept"],
      linkedRecheckQuestionId: null,
      correctValue: "4",
      tolerance: "0",
      unit: null,
      timeLimitSeconds: 30,
      basePoints: 100,
      explanation: "Synthetic explanation",
      mediaId: null,
      mediaAlt: null,
    };
    const ranking = {
      id: randomUUID(),
      type: "ranking" as const,
      prompt: "Synthetic priorities",
      purpose: "opinion" as const,
      confidence: "off" as const,
      delivery: "main" as const,
      conceptKeys: ["opinion-concept"],
      linkedRecheckQuestionId: null,
      rankCount: 2,
      choices: ["Option A", "Option B", "Option C"].map((label) => ({
        id: randomUUID(),
        label,
        isCorrect: false,
      })),
      timeLimitSeconds: 30,
      basePoints: 0,
      explanation: "",
      mediaId: null,
      mediaAlt: null,
    };
    const quiz = {
      title: "Mixed recovery evidence",
      description: "",
      questions: [numeric, ranking],
    };
    let state = createGameState({
      sessionId: randomUUID(),
      code: "1234567",
      quiz,
      roundProtocol: deriveRoundProtocol(quiz),
      settings: {
        audienceLimit: 20,
        scoringMode: "accuracy",
        resultVisibility: "private",
        allowLateJoin: true,
        nicknamePolicy: "custom",
      },
    });
    const participants = Array.from({ length: 5 }, () => randomUUID());
    for (const [index, id] of participants.entries())
      state = addParticipant(state, {
        id,
        nickname: `Guest ${index + 1}`,
        score: 0,
        correctCount: 0,
        acceptedResponseMs: 0,
        connected: false,
        kicked: false,
      }).state;
    const [scoredMain, scoredRevote, opinionMain, opinionRevote] = Array.from({ length: 4 }, () =>
      randomUUID(),
    ) as [string, string, string, string];
    const answer = (
      participantId: string,
      roundId: string,
      response: EngineAnswer["response"],
      correct: boolean,
    ): EngineAnswer => ({
      answerId: randomUUID(),
      participantId,
      roundId,
      response,
      confidence: null,
      choiceId: null,
      acceptedAtMs: 2_000,
      responseMs: 1_000,
      score: correct ? 100 : 0,
      correct,
      idempotencyKey: randomUUID(),
    });
    const evidence: SessionEvidence = {
      decisionReplayEnabled: false,
      decisionEvents: [],
      decisionEventsComplete: false,
      answers: participants.flatMap((id, index) => [
        answer(id, scoredMain, { kind: "numeric", value: index < 2 ? "4" : "5" }, index < 2),
        answer(id, scoredRevote, { kind: "numeric", value: index < 4 ? "4" : "5" }, index < 4),
        answer(
          id,
          opinionMain,
          { kind: "ranking", choiceIds: ranking.choices.slice(0, 2).map((choice) => choice.id) },
          false,
        ),
        answer(
          id,
          opinionRevote,
          {
            kind: "ranking",
            choiceIds: ranking.choices
              .slice(0, 2)
              .reverse()
              .map((choice) => choice.id),
          },
          false,
        ),
      ]),
      rounds: [
        {
          id: scoredMain,
          questionId: numeric.id,
          position: 0,
          kind: "main" as const,
          sourceRoundId: null,
        },
        {
          id: scoredRevote,
          questionId: numeric.id,
          position: 0,
          kind: "revote" as const,
          sourceRoundId: scoredMain,
        },
        {
          id: opinionMain,
          questionId: ranking.id,
          position: 1,
          kind: "main" as const,
          sourceRoundId: null,
        },
        {
          id: opinionRevote,
          questionId: ranking.id,
          position: 1,
          kind: "revote" as const,
          sourceRoundId: opinionMain,
        },
      ].map((round) => ({
        ...round,
        interventionId: null,
        openedAtMs: 1_000,
        deadlineMs: 31_000,
        lockedAtMs: 3_000,
      })),
      interventions: [],
      qna: { questions: 0, answered: 0, unresolved: 0 },
    };
    const report = generateReport(state, new Date("2099-11-01T00:00:00.000Z"), { evidence });
    expect(report).toMatchObject({
      schemaVersion: 6,
      metrics: { answerCount: 20, accuracyPercent: 40 },
      initialAccuracy: { correct: 2, responses: 5, percent: 40 },
      recovery: [
        {
          sourceQuestionId: numeric.id,
          evidenceType: "revote",
          recovered: 2,
          initiallyIncorrectWithBoth: 3,
          recoveryPercent: 66.7,
        },
      ],
      unresolvedConcepts: [
        { conceptKey: "synthetic-concept", initiallyIncorrect: 3, recovered: 2, unresolved: 1 },
      ],
    });
    if (report.schemaVersion !== 6) throw new Error("Expected ranking report");
    expect(report.recovery).toHaveLength(1);
    expect(report.participantFeedback).toHaveLength(5);
    expect(
      report.participantFeedback.every(
        (feedback) =>
          feedback.responses === 1 && !feedback.unresolvedConcepts.includes("opinion-concept"),
      ),
    ).toBe(true);
    const csv = reportCsv(report);
    expect(csv).toContain(`revote,${numeric.id},${numeric.id},2,3,66.7,true`);
    expect(csv).not.toContain(`revote,${ranking.id},${ranking.id},`);
  });
});
