import { verifyEmailAndSignIn } from "./support/email-auth.js";
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import {
  MemoryRepository,
  type CreatorContext,
  type PresentationSessionRecord,
} from "@openround/db";
import { buildApp } from "../src/app.js";
import { MemorySessionCache } from "../src/cache.js";
import { ConfigSchema } from "../src/config.js";

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
});

describe("Home workspace summary", () => {
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
