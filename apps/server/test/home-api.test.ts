import { verifyEmailAndSignIn } from "./support/email-auth.js";
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createIdeaBoardRepository,
  createPlatformRepository,
  createSurveyRepository,
  IdeaBoardRepository,
  MemoryRepository,
  type CreatorContext,
  type PresentationSessionRecord,
} from "@openround/db";
import {
  CANVAS_SCHEMA_VERSION,
  CanvasBoardCreateSchema,
  IdeaBoardCreateSchema,
  ReportV4Schema,
  type QuestionDraft,
} from "@openround/contracts";
import {
  acceptAnswer,
  addParticipant,
  applyHostCommand,
  createGameState,
  type EngineAnswer,
} from "@openround/game-engine";
import { SurveyDraftSchema } from "@openround/contracts/surveys";
import { buildApp } from "../src/app.js";
import { MemorySessionCache } from "../src/cache.js";
import { ConfigSchema } from "../src/config.js";
import { generateReport } from "../src/reporting.js";

let app: FastifyInstance | undefined;
const BETA_WORKSPACE_ID = "10000000-0000-4000-8000-000000000004";

async function signIn(target: FastifyInstance, email: string) {
  const magic = await target.inject({
    method: "POST",
    url: "/v1/auth/magic-link",
    payload: { email, segment: "workplace", acceptPolicies: true },
  });
  const token = new URL(magic.json<{ debugUrl: string }>().debugUrl).searchParams.get("token")!;
  const verified = await verifyEmailAndSignIn(target, `/v1/auth/verify?token=${token}`, email);
  const setCookie = verified.headers["set-cookie"]!;
  const cookie = (Array.isArray(setCookie) ? setCookie[0]! : setCookie).split(";")[0]!;
  const account = await target.inject({ method: "GET", url: "/v1/auth/me", headers: { cookie } });
  return { cookie, creator: account.json<{ creator: CreatorContext }>().creator };
}

afterEach(async () => {
  if (app) await app.close();
  app = undefined;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function artifactFixture() {
  const repository = new MemoryRepository({ initialWorkspaceId: BETA_WORKSPACE_ID });
  const built = await buildApp(
    ConfigSchema.parse({
      NODE_ENV: "test",
      ALLOW_IN_MEMORY: "true",
      COMMUNITY_MODE: "false",
      FEATURE_SURVEYS: "false",
      FEATURE_IDEA_BOARDS: "false",
      FEATURE_CANVAS_BOARDS: "false",
      LOG_LEVEL: "silent",
    }),
    { repository, cache: new MemorySessionCache() },
  );
  app = built.app;
  const owner = await signIn(app, "home-artifact-owner@example.com");
  return {
    ...built,
    repository,
    owner,
    surveys: createSurveyRepository(repository),
    ideaBoards: createIdeaBoardRepository(repository),
  };
}
type ArtifactFixture = Awaited<ReturnType<typeof artifactFixture>>;

function surveyDraft(title: string) {
  return SurveyDraftSchema.parse({
    schemaVersion: 2,
    title,
    description: "Summary description",
    items: [
      {
        required: true,
        question: {
          id: randomUUID(),
          type: "poll",
          prompt: "Private survey question content",
          choices: [
            { id: randomUUID(), label: "Private survey choice", isCorrect: false },
            { id: randomUUID(), label: "B", isCorrect: false },
          ],
          purpose: "opinion",
          confidence: "off",
          delivery: "main",
          timeLimitSeconds: 20,
          basePoints: 0,
          explanation: "",
          mediaId: null,
          mediaAlt: null,
        },
      },
    ],
  });
}

function createSummaryIdeaBoard(
  f: ArtifactFixture,
  workspaceId: string,
  title: string,
  createdAt: Date,
) {
  return f.ideaBoards.create(
    workspaceId,
    randomUUID(),
    IdeaBoardCreateSchema.parse({
      title,
      description: "Public board description",
      moderationEnabled: true,
      ideasVisible: false,
    }),
    randomUUID(),
    {
      participantLimit: 10,
      closesAt: new Date(createdAt.getTime() + 86_400_000).toISOString(),
      expiresAt: new Date(createdAt.getTime() + 7 * 86_400_000).toISOString(),
    },
    () => createdAt,
  );
}

function createSummaryCanvas(
  f: ArtifactFixture,
  creator: CreatorContext,
  title: string,
  sourceBoardId?: string,
  clock = new Date(),
) {
  return f.canvasBoards.create(
    creator,
    CanvasBoardCreateSchema.parse({
      schemaVersion: CANVAS_SCHEMA_VERSION,
      workspaceId: creator.workspaceId,
      title,
      boardType: sourceBoardId ? "workshop" : "team",
      ...(sourceBoardId ? { sourceBoardId } : {}),
      operationId: randomUUID(),
    }),
    () => clock,
  );
}

describe("Home workspace summary", () => {
  it("keeps absent Round assessment evidence distinct from measured zero in result highlights", async () => {
    const f = await artifactFixture();
    const { creator, cookie } = f.owner;
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 86_400_000);
    const poll: QuestionDraft = {
      id: randomUUID(),
      type: "poll",
      prompt: "Pick a priority",
      choices: [
        { id: randomUUID(), label: "Clarity", isCorrect: false },
        { id: randomUUID(), label: "Speed", isCorrect: false },
      ],
      timeLimitSeconds: 30,
      basePoints: 0,
      explanation: "",
      mediaId: null,
      mediaAlt: null,
    };
    const assessed: QuestionDraft = {
      ...poll,
      id: randomUUID(),
      type: "single_select",
      prompt: "Select the correct answer",
      basePoints: 1_000,
      choices: [
        { id: randomUUID(), label: "Correct", isCorrect: true },
        { id: randomUUID(), label: "Incorrect", isCorrect: false },
      ],
    };
    const cases = [
      { title: "Unanswered assessment", questions: [assessed], answers: false, replay: false },
      {
        title: "Unanswered replay assessment",
        questions: [assessed],
        answers: false,
        replay: true,
      },
      { title: "Current poll", questions: [poll], answers: true, replay: false },
      { title: "Historical poll", questions: [poll], answers: true, replay: true },
      { title: "Mixed measured zero", questions: [poll, assessed], answers: true, replay: false },
    ];
    const expected: Array<{ id: string; title: string; accuracyPercent: number | null }> = [];
    for (const [index, entry] of cases.entries()) {
      const content = { title: entry.title, description: "", questions: entry.questions };
      const quiz = await f.repository.createQuiz({
        id: randomUUID(),
        workspaceId: creator.workspaceId,
        title: content.title,
        description: "",
        status: "draft",
        draft: content,
        currentVersionId: null,
        createdAt: now,
        updatedAt: now,
      });
      const version = await f.repository.publishQuiz({
        id: randomUUID(),
        workspaceId: creator.workspaceId,
        quizId: quiz.id,
        version: 1,
        content,
        contentHash: randomUUID(),
        publishedAt: now,
      });
      const sessionId = randomUUID();
      let state = createGameState({
        sessionId,
        code: String(7_000_001 + index),
        quiz: content,
        settings: {
          audienceLimit: 10,
          scoringMode: "accuracy",
          resultVisibility: "private",
          allowLateJoin: true,
          nicknamePolicy: "custom",
        },
      });
      const participantId = randomUUID();
      state = addParticipant(state, {
        id: participantId,
        nickname: "Guest",
        score: 0,
        correctCount: 0,
        acceptedResponseMs: 0,
        connected: true,
        kicked: false,
      }).state;
      let nowMs = now.getTime();
      const command = (action: Parameters<typeof applyHostCommand>[1]["action"]) => {
        state = applyHostCommand(state, {
          action,
          commandId: randomUUID(),
          expectedVersion: state.version,
          nowMs: (nowMs += 1_000),
          newRoundId: randomUUID,
        }).state;
      };
      const answers: EngineAnswer[] = [];
      for (const [questionIndex, question] of entry.questions.entries()) {
        command(questionIndex === 0 ? "start" : "next");
        if (entry.answers) {
          if (question.type !== "poll" && question.type !== "single_select")
            throw new Error("Expected choice question fixture");
          const accepted = acceptAnswer(state, {
            answerId: randomUUID(),
            participantId,
            roundId: state.roundId!,
            response: {
              kind: question.type === "poll" ? "poll" : "choice",
              choiceIds: [question.choices[1]!.id],
            },
            idempotencyKey: randomUUID(),
            nowMs: (nowMs += 1_000),
          });
          state = accepted.state;
          answers.push(accepted.answer);
        }
        command("lock");
        command("reveal");
      }
      command("end");
      let report = generateReport(state, expiresAt, {
        generatedAt: now,
        evidence: {
          decisionReplayEnabled: entry.replay,
          decisionEvents: [],
          decisionEventsComplete: false,
          answers,
          rounds: Object.entries(state.rounds).map(([id, round]) => ({ id, ...round })),
          interventions: [],
          qna: { questions: 0, answered: 0, unresolved: 0 },
        },
      });
      if (entry.title === "Historical poll") {
        report = ReportV4Schema.parse({
          ...report,
          schemaVersion: 4,
          metrics: { ...report.metrics, accuracyPercent: 0 },
          initialAccuracy: { correct: 0, responses: 0, percent: 0 },
          questions: report.questions.map((question) => ({
            ...question,
            correct: 0,
            accuracyPercent: 0,
          })),
        });
      }
      await f.repository.createSession({
        id: sessionId,
        workspaceId: creator.workspaceId,
        quizVersionId: version.id,
        hostId: creator.userId,
        hostTokenHash: randomUUID(),
        state,
        expiresAt,
        retentionExpiresAt: expiresAt,
        createdAt: now,
        updatedAt: now,
      });
      await f.repository.saveReport(creator.workspaceId, report);
      expected.push({
        id: report.id,
        title: entry.title,
        accuracyPercent: entry.title === "Mixed measured zero" ? 0 : null,
      });
    }
    const response = await f.app.inject({ url: "/v1/home/summary", headers: { cookie } });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json().resultHighlights).toHaveLength(cases.length);
    for (const result of expected) {
      expect(response.json().resultHighlights).toContainEqual(
        expect.objectContaining({ ...result, participantCount: 1, recoveryPercent: null }),
      );
    }
  });

  it("uses bounded canvas metadata and deduplicates a linked workshop outside the recent page", async () => {
    const f = await artifactFixture();
    const { creator, cookie } = f.owner;
    const now = Date.now();
    const standalone = await createSummaryIdeaBoard(
      f,
      creator.workspaceId,
      "Older standalone workshop",
      new Date(now - 100_000),
    );
    const source = await createSummaryIdeaBoard(
      f,
      creator.workspaceId,
      "Older linked source",
      new Date(now - 90_000),
    );
    await createSummaryCanvas(f, creator, "Older linked canvas", source.id, new Date(now - 80_000));
    const teams = [];
    for (let index = 0; index < 7; index++)
      teams.push(
        await createSummaryCanvas(
          f,
          creator,
          `Recent canvas ${index}`,
          undefined,
          new Date(now - (7 - index) * 10_000),
        ),
      );
    const list = vi
      .spyOn(f.canvasBoards, "list")
      .mockRejectedValue(new Error("Home must not scan the Board library"));
    const recent = vi.spyOn(f.canvasBoards, "recentMetadata");
    const response = await f.app.inject({ url: "/v1/home/summary", headers: { cookie } });
    expect(response.statusCode, response.body).toBe(200);
    expect(list).not.toHaveBeenCalled();
    expect(recent).toHaveBeenCalledWith(
      expect.objectContaining({ userId: creator.userId }),
      { workspaceId: creator.workspaceId, limit: 6 },
      expect.any(Function),
    );
    expect(response.json().recentBoards.map((board: { id: string }) => board.id)).toEqual(
      teams
        .slice(1)
        .reverse()
        .map((board) => board.id),
    );
    expect(response.json().totals).toMatchObject({ boards: 9, artifacts: 9 });
    expect(response.body).not.toContain(source.title);
    expect(response.json().recentBoards).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: standalone.id })]),
    );
  });

  it("includes retained Surveys and both Board modes when creation is paused, with distinct keys, real dates and deduplicated totals", async () => {
    const f = await artifactFixture();
    const { cookie, creator } = f.owner;
    const now = new Date();
    const createdRound = await f.app.inject({
      method: "POST",
      url: "/v1/quizzes",
      headers: { cookie },
      payload: { title: "Existing Round", description: "Round metadata" },
    });
    expect(createdRound.statusCode, createdRound.body).toBe(201);
    const roundId = createdRound.json().quiz.id as string;
    vi.useFakeTimers({ toFake: ["Date"] });
    for (let index = 0; index < 7; index++) {
      vi.setSystemTime(now.getTime() - (10 - index) * 1000);
      await f.surveys.create(
        creator.workspaceId,
        index === 6 ? roundId : randomUUID(),
        surveyDraft(`Survey ${index}`),
        randomUUID(),
      );
    }
    vi.setSystemTime(now.getTime() - 2000);
    await f.surveys.archive(creator.workspaceId, roundId, 0, randomUUID());
    vi.setSystemTime(now);
    const standalone = await createSummaryIdeaBoard(
      f,
      creator.workspaceId,
      "Standalone workshop",
      new Date(now.getTime() - 60_000),
    );
    const source = await createSummaryIdeaBoard(
      f,
      creator.workspaceId,
      "Linked source should not repeat",
      new Date(now.getTime() - 50_000),
    );
    const team = await createSummaryCanvas(
      f,
      creator,
      "Team canvas",
      undefined,
      new Date(now.getTime() - 40_000),
    );
    const guided = await createSummaryCanvas(
      f,
      creator,
      "Guided canvas",
      source.id,
      new Date(now.getTime() - 30_000),
    );

    for (const url of ["/v1/surveys", "/v1/idea-boards", "/v1/canvas-boards"]) {
      const response = await f.app.inject({ url, headers: { cookie } });
      expect(response.statusCode, response.body).toBe(200);
    }
    const response = await f.app.inject({ url: "/v1/home/summary", headers: { cookie } });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.headers["cache-control"]).toBe("private, no-store");
    expect(response.headers.pragma).toBe("no-cache");
    const summary = response.json();
    expect(summary.recentArtifacts).toEqual([
      expect.objectContaining({ artifactType: "round", id: roundId }),
    ]);
    expect(summary.recentSurveys).toHaveLength(6);
    expect(summary.recentSurveys.map((item: { title: string }) => item.title)).toEqual([
      "Survey 6",
      "Survey 5",
      "Survey 4",
      "Survey 3",
      "Survey 2",
      "Survey 1",
    ]);
    expect(summary.recentSurveys[0]).toEqual({
      id: roundId,
      artifactType: "survey",
      title: "Survey 6",
      description: "Summary description",
      status: "archived",
      itemCount: 1,
      updatedAt: new Date(now.getTime() - 2000).toISOString(),
      editHref: `/surveys/${roundId}`,
      actionHref: `/surveys/${roundId}`,
      actionLabel: "Open Survey",
    });
    expect(summary.recentBoards).toEqual([
      expect.objectContaining({
        id: guided.id,
        artifactType: "canvas",
        boardType: "workshop",
        role: "owner",
        canEdit: true,
        itemCount: null,
        updatedAt: guided.updatedAt,
        editHref: `/canvas/${guided.id}`,
        actionHref: `/canvas/${guided.id}`,
      }),
      expect.objectContaining({
        id: team.id,
        artifactType: "canvas",
        boardType: "team",
        role: "owner",
        canEdit: true,
        itemCount: null,
      }),
      expect.objectContaining({
        id: standalone.id,
        artifactType: "idea_board",
        boardType: "workshop",
        status: "draft",
        itemCount: 0,
        updatedAt: standalone.createdAt,
        editHref: `/boards/${standalone.id}`,
        actionHref: `/boards/${standalone.id}`,
      }),
    ]);
    expect(summary.totals).toMatchObject({ artifacts: 11, surveys: 7, boards: 3 });
    expect(response.body).not.toContain(source.title);
    expect(response.body).not.toContain("Private survey question content");
    expect(response.body).not.toContain("Private survey choice");
    expect(summary.sessions).toEqual([]);
    expect(summary.assignments).toEqual([]);
  });

  it("uses viewer-safe board metadata and actual shared canvas roles while excluding unrelated and other-owned workspaces", async () => {
    const f = await artifactFixture();
    const owner = f.owner;
    const viewer = await signIn(f.app, "home-artifact-viewer@example.com");
    const outsider = await signIn(f.app, "home-artifact-outsider@example.com");
    const now = new Date();
    const hidden = await createSummaryIdeaBoard(
      f,
      owner.creator.workspaceId,
      "Moderated workspace board",
      now,
    );
    await f.ideaBoards.hostCommand(
      owner.creator.workspaceId,
      hidden.id,
      { type: "collect" },
      0,
      randomUUID(),
      () => now,
    );
    const guestToken = "a".repeat(64);
    await f.ideaBoards.join(hidden.id, guestToken, null, () => now);
    await f.ideaBoards.submitIdea(
      hidden.id,
      guestToken,
      "Pending private suggestion must stay hidden",
      randomUUID(),
      () => now,
    );
    await f.surveys.create(
      owner.creator.workspaceId,
      randomUUID(),
      surveyDraft("Workspace survey"),
      randomUUID(),
    );
    await f.surveys.create(
      outsider.creator.workspaceId,
      randomUUID(),
      surveyDraft("Unrelated workspace survey"),
      randomUUID(),
    );
    await createSummaryIdeaBoard(
      f,
      outsider.creator.workspaceId,
      "Unrelated workspace workshop",
      now,
    );
    const workspaceCanvas = await createSummaryCanvas(f, owner.creator, "Shared workspace canvas");
    await createSummaryCanvas(f, owner.creator, "Unshared workspace canvas");
    await createSummaryCanvas(f, viewer.creator, "Other owned workspace canvas");
    const external = await createSummaryCanvas(
      f,
      outsider.creator,
      "Explicit external facilitator canvas",
    );
    await createSummaryCanvas(f, outsider.creator, "Unrelated external canvas");
    const platform = createPlatformRepository(f.repository);
    for (const origin of [owner, outsider]) {
      await platform.setOrganizationMember({
        organizationId: origin.creator.workspaceId,
        actorId: origin.creator.userId,
        userId: viewer.creator.userId,
        role: "member",
      });
    }
    for (const [origin, board, role] of [
      [owner, workspaceCanvas, "viewer"],
      [outsider, external, "facilitator"],
    ] as const) {
      const invitation = await f.canvasBoards.invite(origin.creator, board.id, {
        email: viewer.creator.email,
        role,
        operationId: randomUUID(),
      });
      await f.canvasBoards.acceptInvitation(viewer.creator, invitation.id);
    }
    f.repository.workspaceMembers.set(`${owner.creator.workspaceId}:${viewer.creator.userId}`, {
      workspaceId: owner.creator.workspaceId,
      userId: viewer.creator.userId,
      role: "viewer",
      joinedAt: now,
    });
    const selected = await f.app.inject({
      method: "POST",
      url: `/v1/workspaces/${owner.creator.workspaceId}/select`,
      headers: { cookie: viewer.cookie },
    });
    expect(selected.statusCode, selected.body).toBe(200);
    const list = vi.spyOn(IdeaBoardRepository.prototype, "list");
    const moderator = vi.spyOn(IdeaBoardRepository.prototype, "getModerator");
    const scene = vi.spyOn(f.canvasBoards, "get");
    const response = await f.app.inject({
      url: "/v1/home/summary",
      headers: { cookie: viewer.cookie },
    });
    expect(response.statusCode, response.body).toBe(200);
    const summary = response.json();
    expect(list).toHaveBeenCalledWith(owner.creator.workspaceId, expect.any(Function), false);
    expect(moderator).not.toHaveBeenCalled();
    expect(scene).not.toHaveBeenCalled();
    expect(summary.recentBoards).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: hidden.id,
          artifactType: "idea_board",
          itemCount: 0,
          canEdit: false,
        }),
        expect.objectContaining({
          id: workspaceCanvas.id,
          role: "viewer",
          canEdit: false,
          itemCount: null,
        }),
        expect.objectContaining({
          id: external.id,
          role: "facilitator",
          canEdit: true,
          itemCount: null,
        }),
      ]),
    );
    expect(summary.recentBoards).toHaveLength(3);
    expect(summary.recentSurveys).toEqual([
      expect.objectContaining({
        title: "Workspace survey",
        actionLabel: "View Survey",
        itemCount: 1,
      }),
    ]);
    expect(summary.totals).toMatchObject({ artifacts: 4, surveys: 1, boards: 3 });
    for (const secret of [
      "Pending private suggestion must stay hidden",
      "Private survey question content",
      "Unshared workspace canvas",
      "Other owned workspace canvas",
      "Unrelated external canvas",
      "Unrelated workspace survey",
      "Unrelated workspace workshop",
      '"objects"',
      '"ideas"',
      '"draft":',
    ])
      expect(response.body).not.toContain(secret);
    const ownerSummary = await f.app.inject({
      url: "/v1/home/summary",
      headers: { cookie: owner.cookie },
    });
    expect(ownerSummary.json().recentBoards).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: hidden.id, itemCount: 1, canEdit: true }),
      ]),
    );
  });

  it("combines current work and activity while preserving authentication and workspace isolation", async () => {
    const built = await buildApp(
      ConfigSchema.parse({
        NODE_ENV: "test",
        ALLOW_IN_MEMORY: "true",
        COMMUNITY_MODE: "false",
        WEB_ORIGIN: "http://localhost:3000",
        PUBLIC_API_URL: "http://localhost:4000",
        FEATURE_UX_BETA: "true",
        UX_BETA_WORKSPACE_ALLOWLIST: BETA_WORKSPACE_ID,
        FEATURE_WORKSPACE_SHELL: "true",
        FEATURE_PRESENTATIONS: "true",
        FEATURE_PRESENTATION_REALTIME: "true",
        EVIDENCE_FEATURES_WORKSPACE_ALLOWLIST: BETA_WORKSPACE_ID,
        FEATURE_GROUPS: "true",
        LOG_LEVEL: "silent",
      }),
      {
        repository: new MemoryRepository({ initialWorkspaceId: BETA_WORKSPACE_ID }),
        cache: new MemorySessionCache(),
      },
    );
    app = built.app;

    const unauthenticated = await app.inject({ method: "GET", url: "/v1/home/summary" });
    expect(unauthenticated.statusCode).toBe(401);

    const { cookie, creator } = await signIn(app, "home-owner@example.com");
    const createdRound = await app.inject({
      method: "POST",
      url: "/v1/quizzes",
      headers: { cookie },
      payload: { title: "Safety decisions", description: "Diagnose the response plan" },
    });
    const roundId = createdRound.json<{ quiz: { id: string } }>().quiz.id;
    const roundDraft = {
      title: "Safety decisions",
      description: "Diagnose the response plan",
      questions: [
        {
          id: randomUUID(),
          type: "single_select",
          prompt: "What is the first response?",
          choices: [
            { id: randomUUID(), label: "Secure the area", isCorrect: true },
            { id: randomUUID(), label: "Ignore the signal", isCorrect: false },
          ],
          timeLimitSeconds: 20,
          basePoints: 1_000,
          explanation: "Secure the area before proceeding.",
          mediaId: null,
          mediaAlt: null,
        },
        {
          id: randomUUID(),
          type: "single_select",
          prompt: "What happens after the area is secure?",
          choices: [
            { id: randomUUID(), label: "Follow the response plan", isCorrect: true },
            { id: randomUUID(), label: "Resume normal work", isCorrect: false },
          ],
          timeLimitSeconds: 20,
          basePoints: 1_000,
          explanation: "Follow the response plan after securing the area.",
          mediaId: null,
          mediaAlt: null,
        },
      ],
    };
    const savedRound = await app.inject({
      method: "PATCH",
      url: `/v1/quizzes/${roundId}`,
      headers: { cookie },
      payload: { draft: roundDraft, expectedDraftRevision: 0 },
    });
    expect(savedRound.statusCode, savedRound.body).toBe(200);
    const publishedRound = await app.inject({
      method: "POST",
      url: `/v1/quizzes/${roundId}/publish`,
      headers: { cookie },
      payload: { expectedDraftRevision: 1 },
    });
    const roundVersionId = publishedRound.json<{ version: { id: string } }>().version.id;
    const hostedRound = await app.inject({
      method: "POST",
      url: "/v1/sessions",
      headers: { cookie },
      payload: {
        quizId: roundId,
        settings: {
          audienceLimit: 10,
          scoringMode: "accuracy",
          resultVisibility: "private",
          allowLateJoin: true,
          nicknamePolicy: "custom",
        },
      },
    });
    expect(hostedRound.statusCode).toBe(201);
    const roundSession = hostedRound.json<{
      sessionId: string;
      hostToken: string;
      snapshot: { version: number };
    }>();
    const startedRound = await app.inject({
      method: "POST",
      url: `/v1/sessions/${roundSession.sessionId}/commands`,
      headers: { authorization: `Bearer ${roundSession.hostToken}` },
      payload: {
        commandId: randomUUID(),
        expectedVersion: roundSession.snapshot.version,
        action: "start",
      },
    });
    expect(startedRound.statusCode, startedRound.body).toBe(200);

    await built.followups.createAssignment(
      creator,
      roundId,
      {
        sourceQuizVersionId: roundVersionId,
        title: "Safety practice",
        timeMode: "flex",
        closesAt: new Date(Date.now() + 2 * 86_400_000).toISOString(),
        personalLabels: [],
      },
      30,
      50,
    );

    const createdPresentation = await app.inject({
      method: "POST",
      url: "/v1/presentations",
      headers: { cookie },
      payload: { title: "Safety briefing", description: "A concise facilitator deck" },
    });
    const presentation = createdPresentation.json<{
      presentation: { id: string; draft: { blocks: Array<{ id: string }> } };
    }>().presentation;
    const presentationDraft = {
      title: "Safety briefing",
      description: "A concise facilitator deck",
      experiencePreset: { id: "focus", version: 1 },
      schemaVersion: 2,
      blocks: [
        {
          id: presentation.draft.blocks[0]!.id,
          kind: "content",
          layout: "title_body",
          textElements: [
            {
              id: randomUUID(),
              role: "title",
              text: "Know the plan",
              region: "middle_center",
              order: 0,
            },
            {
              id: randomUUID(),
              role: "body",
              text: "Review the response sequence before practice.",
              region: "middle_center",
              order: 1,
            },
          ],
          mediaId: null,
          mediaAlt: null,
          speakerNotes: "Confirm roles before continuing.",
        },
        {
          id: randomUUID(),
          kind: "question",
          question: {
            id: randomUUID(),
            type: "single_select",
            prompt: "Which action comes first?",
            choices: [
              { id: randomUUID(), label: "Secure the area", isCorrect: true },
              { id: randomUUID(), label: "Skip the plan", isCorrect: false },
            ],
            purpose: "diagnostic",
            confidence: "optional",
            delivery: "main",
            conceptKeys: ["response-sequence"],
            linkedRecheckQuestionId: null,
            timeLimitSeconds: 30,
            basePoints: 1_000,
            explanation: "Securing the area comes first.",
            mediaId: null,
            mediaAlt: null,
          },
        },
      ],
    };
    const savedPresentation = await app.inject({
      method: "PUT",
      url: `/v1/presentations/${presentation.id}/draft`,
      headers: { cookie },
      payload: {
        draft: presentationDraft,
        expectedRevision: 0,
        mutationId: randomUUID(),
        schemaVersion: 2,
      },
    });
    expect(savedPresentation.statusCode, savedPresentation.body).toBe(200);
    const publishedPresentation = await app.inject({
      method: "POST",
      url: `/v1/presentations/${presentation.id}/publish`,
      headers: { cookie },
      payload: { expectedDraftRevision: 1 },
    });
    expect(publishedPresentation.statusCode, publishedPresentation.body).toBe(200);
    const publishedPresentationVersion = publishedPresentation.json<{
      version: { id: string; content: PresentationSessionRecord["content"] };
    }>().version;
    const hostedPresentation = await app.inject({
      method: "POST",
      url: "/v1/presentation-sessions",
      headers: { cookie },
      payload: { presentationId: presentation.id },
    });
    expect(hostedPresentation.statusCode, hostedPresentation.body).toBe(201);
    const presentationSession = hostedPresentation.json<{
      snapshot: { id: string; revision: number };
    }>().snapshot;
    for (const expectedRevision of [0, 1, 2, 3]) {
      await app.inject({
        method: "POST",
        url: `/v1/presentation-sessions/${presentationSession.id}/advance`,
        headers: { cookie },
        payload: { expectedRevision },
      });
    }

    const expiredPresentationSessionId = randomUUID();
    const expiredAt = new Date(Date.now() - 1);
    await built.presentationSessions.createSession({
      id: expiredPresentationSessionId,
      workspaceId: creator.workspaceId,
      presentationId: presentation.id,
      presentationVersionId: publishedPresentationVersion.id,
      title: publishedPresentationVersion.content.title,
      content: publishedPresentationVersion.content,
      code: "9081726",
      status: "active",
      phase: "lobby",
      currentBlockIndex: -1,
      revision: 0,
      createdBy: creator.userId,
      createdAt: expiredAt,
      updatedAt: expiredAt,
      finishedAt: null,
      liveExpiresAt: expiredAt,
      retentionExpiresAt: new Date(Date.now() + 30 * 86_400_000),
    });

    const createdGroup = await app.inject({
      method: "POST",
      url: "/v1/groups",
      headers: { cookie },
      payload: { name: "Safety facilitators", description: "Shared delivery plan" },
    });
    const groupId = createdGroup.json<{ group: { id: string } }>().group.id;
    await app.inject({
      method: "POST",
      url: `/v1/groups/${groupId}/artifacts`,
      headers: { cookie },
      payload: { artifactType: "round", artifactId: roundId },
    });
    await app.inject({
      method: "POST",
      url: `/v1/groups/${groupId}/schedule`,
      headers: { cookie },
      payload: {
        artifactType: "round",
        artifactId: roundId,
        kind: "live_session",
        scheduledFor: new Date(Date.now() + 86_400_000).toISOString(),
        note: "Run before the next shift.",
      },
    });

    const response = await app.inject({
      method: "GET",
      url: "/v1/home/summary",
      headers: { cookie },
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("private, no-store");
    expect(response.json()).toMatchObject({
      recentArtifacts: expect.arrayContaining([
        expect.objectContaining({ artifactType: "round", title: "Safety decisions" }),
        expect.objectContaining({ artifactType: "presentation", title: "Safety briefing" }),
      ]),
      sessions: expect.arrayContaining([
        expect.objectContaining({
          artifactType: "round",
          status: "active",
          progressLabel: "Question 1 of 2",
        }),
        expect.objectContaining({ artifactType: "presentation", status: "finished" }),
      ]),
      assignments: [expect.objectContaining({ title: "Safety practice", status: "open" })],
      resultHighlights: [
        expect.objectContaining({ artifactType: "presentation", title: "Safety briefing" }),
      ],
      groupSchedule: [
        expect.objectContaining({
          groupName: "Safety facilitators",
          artifactTitle: "Safety decisions",
        }),
      ],
      totals: expect.objectContaining({ artifacts: 2, activeSessions: 1, activeAssignments: 1 }),
    });
    expect(
      response.json<{ sessions: Array<{ id: string }> }>().sessions.map(({ id }) => id),
    ).not.toContain(expiredPresentationSessionId);

    const outsider = await signIn(app, "home-outsider@example.com");
    const isolated = await app.inject({
      method: "GET",
      url: "/v1/home/summary",
      headers: { cookie: outsider.cookie },
    });
    expect(isolated.statusCode).toBe(200);
    expect(isolated.json()).toMatchObject({
      recentArtifacts: [],
      sessions: [],
      assignments: [],
      resultHighlights: [],
      groupSchedule: [],
      totals: { artifacts: 0, activeSessions: 0, activeAssignments: 0 },
    });
  });

  it("omits persisted Presentation schedule rows when Presentations are disabled", async () => {
    const built = await buildApp(
      ConfigSchema.parse({
        NODE_ENV: "test",
        ALLOW_IN_MEMORY: "true",
        COMMUNITY_MODE: "false",
        WEB_ORIGIN: "http://localhost:3000",
        PUBLIC_API_URL: "http://localhost:4000",
        FEATURE_UX_BETA: "true",
        UX_BETA_WORKSPACE_ALLOWLIST: BETA_WORKSPACE_ID,
        FEATURE_WORKSPACE_SHELL: "true",
        FEATURE_PRESENTATIONS: "false",
        FEATURE_GROUPS: "true",
        LOG_LEVEL: "silent",
      }),
      {
        repository: new MemoryRepository({ initialWorkspaceId: BETA_WORKSPACE_ID }),
        cache: new MemorySessionCache(),
      },
    );
    app = built.app;
    const { cookie, creator } = await signIn(app, "home-rollout-owner@example.com");
    const createdGroup = await app.inject({
      method: "POST",
      url: "/v1/groups",
      headers: { cookie },
      payload: { name: "Existing facilitators", description: "Created before flag rollback" },
    });
    expect(createdGroup.statusCode, createdGroup.body).toBe(201);
    const groupId = createdGroup.json<{ group: { id: string } }>().group.id;
    const presentationId = randomUUID();
    const now = new Date();
    await built.groups.addArtifact({
      id: randomUUID(),
      workspaceId: creator.workspaceId,
      groupId,
      artifactType: "presentation",
      artifactId: presentationId,
      addedBy: creator.userId,
      createdAt: now,
    });
    await built.groups.addSchedule({
      id: randomUUID(),
      workspaceId: creator.workspaceId,
      groupId,
      artifactType: "presentation",
      artifactId: presentationId,
      kind: "live_session",
      scheduledFor: new Date(now.getTime() + 86_400_000),
      note: "Hidden while Presentation rollout is disabled",
      createdBy: creator.userId,
      createdAt: now,
    });

    const response = await app.inject({
      method: "GET",
      url: "/v1/home/summary",
      headers: { cookie },
    });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toMatchObject({
      groupSchedule: [],
      totals: { upcomingGroupItems: 0 },
    });
  });
});
