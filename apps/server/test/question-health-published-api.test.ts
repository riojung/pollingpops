import { verifyEmailAndSignIn } from "./support/email-auth.js";
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import {
  QuestionHealthPostUseResultSchema,
  QuestionHealthPublishedResultSchema,
  QuizDraftSchema,
  type QuizDraft,
} from "@openround/contracts";
import { MemoryRepository } from "@openround/db";
import { createGameState } from "@openround/game-engine";
import { buildApp } from "../src/app.js";
import { MemorySessionCache } from "../src/cache.js";
import { ConfigSchema } from "../src/config.js";
import { generateReport } from "../src/reporting.js";

let app: FastifyInstance | undefined;
let repository: MemoryRepository | undefined;
let ownerWorkspaceId: string | undefined;

async function build(enabled: boolean, extraAllowlistedWorkspaceIds: string[] = []) {
  ownerWorkspaceId ??= randomUUID();
  repository ??= new MemoryRepository({ initialWorkspaceId: ownerWorkspaceId });
  const built = await buildApp(
    ConfigSchema.parse({
      NODE_ENV: "test",
      ALLOW_IN_MEMORY: "true",
      COMMUNITY_MODE: "false",
      WEB_ORIGIN: "http://localhost:3000",
      PUBLIC_API_URL: "http://localhost:4000",
      LOG_LEVEL: "silent",
      TEST_INITIAL_WORKSPACE_ID: ownerWorkspaceId,
      FEATURE_QUESTION_HEALTH: String(enabled),
      EVIDENCE_FEATURES_WORKSPACE_ALLOWLIST: [
        ownerWorkspaceId,
        ...extraAllowlistedWorkspaceIds,
      ].join(","),
    }),
    { repository, cache: new MemorySessionCache() },
  );
  app = built.app;
  return built.app;
}

async function signIn(target: FastifyInstance, email: string) {
  const magic = await target.inject({
    method: "POST",
    url: "/v1/auth/magic-link",
    payload: { email, segment: "workplace", acceptPolicies: true },
  });
  const token = new URL(magic.json<{ debugUrl: string }>().debugUrl).searchParams.get("token")!;
  const verified = await verifyEmailAndSignIn(target, `/v1/auth/verify?token=${token}`, email);
  const setCookie = verified.headers["set-cookie"]!;
  return (Array.isArray(setCookie) ? setCookie[0]! : setCookie).split(";")[0]!;
}

async function createPublishedRound(
  target: FastifyInstance,
  cookie: string,
): Promise<{
  quizId: string;
  draft: QuizDraft;
  version: {
    id: string;
    version: number;
    contentHash: string;
    publishedAt: string;
    sourceDraftRevision: number;
  };
}> {
  const created = await target.inject({
    method: "POST",
    url: "/v1/quizzes",
    headers: { cookie },
    payload: { title: "Immutable Question Health", description: "" },
  });
  expect(created.statusCode).toBe(201);
  const quizId = created.json<{ quiz: { id: string } }>().quiz.id;
  const draft = QuizDraftSchema.parse({
    title: "Immutable Question Health",
    description: "",
    questions: [
      {
        id: randomUUID(),
        type: "single_select",
        prompt: "Which option is correct?",
        purpose: "diagnostic",
        confidence: "off",
        delivery: "main",
        conceptKeys: ["immutable.health"],
        linkedRecheckQuestionId: null,
        choices: [
          { id: randomUUID(), label: "The correct option", isCorrect: true },
          { id: randomUUID(), label: "A distractor", isCorrect: false },
        ],
        timeLimitSeconds: 30,
        basePoints: 1_000,
        explanation: "",
        mediaId: null,
        mediaAlt: null,
      },
    ],
  });
  const saved = await target.inject({
    method: "PATCH",
    url: `/v1/quizzes/${quizId}`,
    headers: { cookie },
    payload: { draft, expectedDraftRevision: 0 },
  });
  expect(saved.statusCode).toBe(200);
  const published = await target.inject({
    method: "POST",
    url: `/v1/quizzes/${quizId}/publish`,
    headers: { cookie },
    payload: { expectedDraftRevision: 1 },
  });
  expect(published.statusCode).toBe(200);
  const version = published.json<{
    version: {
      id: string;
      version: number;
      contentHash: string;
      publishedAt: string;
      sourceDraftRevision: number;
    };
  }>().version;
  return { quizId, draft, version };
}

function publishedHealthUrl(quizId: string, versionId: string) {
  return `/v1/quizzes/${quizId}/versions/${versionId}/question-health`;
}

function postUseObservationsUrl(quizId: string, versionId: string) {
  return `${publishedHealthUrl(quizId, versionId)}/observations`;
}

async function addAggregateReport(
  versionId: string,
  draft: Awaited<ReturnType<typeof createPublishedRound>>["draft"],
  correct: number,
) {
  if (!repository || !ownerWorkspaceId)
    throw new Error("The API test repository was not initialized");
  const reportIndex = repository.reports.size;
  const now = new Date(Date.now() + reportIndex);
  const sessionId = randomUUID();
  const retentionExpiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60_000);
  const state = createGameState({
    sessionId,
    code: String(1_000_000 + reportIndex),
    quiz: draft,
    settings: {
      audienceLimit: 50,
      timeMode: "timed",
      scoringMode: "accuracy",
      resultVisibility: "private",
      allowLateJoin: true,
      nicknamePolicy: "custom",
      trustMode: "learning",
    },
  });
  const firstQuestion = draft.questions[0];
  if (!firstQuestion || !("choices" in firstQuestion)) {
    throw new Error("Expected a choice question in this test fixture");
  }
  await repository.createSession({
    id: sessionId,
    workspaceId: ownerWorkspaceId,
    quizVersionId: versionId,
    hostId: randomUUID(),
    hostTokenHash: randomUUID(),
    trustMode: "learning",
    state,
    expiresAt: new Date(now.getTime() + 60 * 60_000),
    retentionExpiresAt,
    createdAt: now,
    updatedAt: now,
  });
  const generated = generateReport(state, retentionExpiresAt, { generatedAt: now });
  generated.questions = generated.questions.map((question) => ({
    ...question,
    responses: 20,
    correct,
    accuracyPercent: correct * 5,
    difficult: false,
    responseDistribution: {
      kind: "choice",
      respondents: 20,
      totalSelections: 20,
      percentBasis: "responses",
      buckets: [
        {
          value: firstQuestion.choices[0]!.id,
          label: "Correct",
          count: correct,
          percent: correct * 5,
        },
        {
          value: firstQuestion.choices[1]!.id,
          label: "Distractor",
          count: 0,
          percent: 0,
        },
      ],
    },
  }));
  repository.reports.set(generated.id, generated);
}

afterEach(async () => {
  if (app) await app.close();
  app = undefined;
  repository = undefined;
  ownerWorkspaceId = undefined;
});

describe("Question Health published-version analysis", () => {
  it("returns only aggregate observations for eligible sessions of the exact version", async () => {
    const target = await build(true);
    const cookie = await signIn(target, "question-health-post-use@example.com");
    const { quizId, draft, version } = await createPublishedRound(target, cookie);
    await addAggregateReport(version.id, draft, 14);

    const response = await target.inject({
      method: "GET",
      url: postUseObservationsUrl(quizId, version.id),
      headers: { cookie },
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("private, no-store");
    const result = QuestionHealthPostUseResultSchema.parse(response.json());
    expect(result).toMatchObject({
      quizId,
      source: "published",
      rulesetVersion: "post-use-1.0.0",
      version: { id: version.id, contentHash: version.contentHash },
      history: { maxReports: 250, reportsIncluded: 1, hasMoreReports: false },
      cohorts: [
        {
          trustMode: "learning",
          timeMode: "timed",
          scoringMode: "accuracy",
          questions: [
            {
              questionPosition: 1,
              sample: { sessions: 1, responses: 20 },
              correct: 14,
              accuracyPercent: 70,
              signals: [{ ruleId: "choice.unused_after_use" }],
            },
          ],
        },
      ],
    });
    expect(response.body).not.toContain("participantId");
    expect(response.body).not.toContain("sessionId");
    expect(response.body).not.toContain("participants");
  });

  it("bounds the analysis to the latest reports and exposes omitted history", async () => {
    const target = await build(true);
    const cookie = await signIn(target, "question-health-observation-window@example.com");
    const { quizId, draft, version } = await createPublishedRound(target, cookie);
    for (let index = 0; index < 251; index += 1) {
      await addAggregateReport(version.id, draft, index === 0 ? 0 : 20);
    }

    const response = await target.inject({
      method: "GET",
      url: postUseObservationsUrl(quizId, version.id),
      headers: { cookie },
    });
    expect(response.statusCode).toBe(200);
    const result = QuestionHealthPostUseResultSchema.parse(response.json());
    expect(result.history).toEqual({
      maxReports: 250,
      reportsIncluded: 250,
      hasMoreReports: true,
    });
    expect(result.cohorts[0]?.questions[0]?.sample).toEqual({
      sessions: 250,
      responses: 5_000,
      minimumResponsesPerSession: 20,
    });
    expect(result.cohorts[0]?.questions[0]?.accuracyPercent).toBe(100);
    expect(result.evidenceNote).toContain("older reports are omitted");
  });

  it("analyzes the selected immutable version, not later draft edits or publications", async () => {
    const target = await build(true);
    const cookie = await signIn(target, "question-health-published@example.com");
    const { quizId, draft, version } = await createPublishedRound(target, cookie);
    const firstUrl = publishedHealthUrl(quizId, version.id);
    const firstResponse = await target.inject({
      method: "GET",
      url: firstUrl,
      headers: { cookie },
    });
    expect(firstResponse.statusCode).toBe(200);
    expect(firstResponse.headers["cache-control"]).toBe("private, no-store");
    const first = QuestionHealthPublishedResultSchema.parse(firstResponse.json());
    expect(first).toMatchObject({
      quizId,
      source: "published",
      version: {
        id: version.id,
        number: version.version,
        contentHash: version.contentHash,
        publishedAt: version.publishedAt,
        sourceDraftRevision: 1,
      },
    });
    expect(first.findings.map((finding) => finding.ruleId)).toContain(
      "question.missing_explanation",
    );
    expect(firstResponse.json()).not.toHaveProperty("draftRevision");
    expect(firstResponse.json()).not.toHaveProperty("dismissals");

    const editedDraft = {
      ...draft,
      questions: [
        {
          ...draft.questions[0]!,
          prompt: "Which revised option is correct?",
          explanation: "The first answer follows the cited standard.",
        },
      ],
    };
    const edited = await target.inject({
      method: "PATCH",
      url: `/v1/quizzes/${quizId}`,
      headers: { cookie },
      payload: { draft: editedDraft, expectedDraftRevision: 1 },
    });
    expect(edited.statusCode).toBe(200);
    const afterDraftEdit = await target.inject({
      method: "GET",
      url: firstUrl,
      headers: { cookie },
    });
    expect(afterDraftEdit.json()).toEqual(firstResponse.json());

    const republished = await target.inject({
      method: "POST",
      url: `/v1/quizzes/${quizId}/publish`,
      headers: { cookie },
      payload: { expectedDraftRevision: 2 },
    });
    expect(republished.statusCode).toBe(200);
    const secondVersion = republished.json<{ version: { id: string; contentHash: string } }>()
      .version;
    const second = QuestionHealthPublishedResultSchema.parse(
      (
        await target.inject({
          method: "GET",
          url: publishedHealthUrl(quizId, secondVersion.id),
          headers: { cookie },
        })
      ).json(),
    );
    expect(second.version.id).not.toBe(version.id);
    expect(second.version.contentHash).toBe(secondVersion.contentHash);
    expect(second.version.sourceDraftRevision).toBe(2);
    expect(second.findings.map((finding) => finding.ruleId)).not.toContain(
      "question.missing_explanation",
    );
    expect(
      second.findings.find((finding) => finding.ruleId === "question.missing_citation")
        ?.contentHash,
    ).not.toBe(
      first.findings.find((finding) => finding.ruleId === "question.missing_citation")?.contentHash,
    );
    expect(
      (await target.inject({ method: "GET", url: firstUrl, headers: { cookie } })).json(),
    ).toEqual(firstResponse.json());
  });

  it("returns 404 for a version under another Round or workspace, even if the ID is known", async () => {
    const target = await build(true);
    const ownerCookie = await signIn(target, "question-health-version-owner@example.com");
    const { quizId, version } = await createPublishedRound(target, ownerCookie);
    const otherRound = await target.inject({
      method: "POST",
      url: "/v1/quizzes",
      headers: { cookie: ownerCookie },
      payload: { title: "Another Round", description: "" },
    });
    const otherRoundId = otherRound.json<{ quiz: { id: string } }>().quiz.id;
    const wrongRound = await target.inject({
      method: "GET",
      url: publishedHealthUrl(otherRoundId, version.id),
      headers: { cookie: ownerCookie },
    });
    expect(wrongRound.statusCode).toBe(404);
    expect(wrongRound.body).not.toContain("Immutable Question Health");

    const intruderEmail = "question-health-version-intruder@example.com";
    const intruderCookie = await signIn(target, intruderEmail);
    const intruderAccount = await target.inject({
      method: "GET",
      url: "/v1/auth/me",
      headers: { cookie: intruderCookie },
    });
    const intruderWorkspaceId = intruderAccount.json<{ creator: { workspaceId: string } }>().creator
      .workspaceId;
    expect(intruderWorkspaceId).not.toBe(ownerWorkspaceId);
    await target.close();
    app = undefined;
    const bothAllowlisted = await build(true, [intruderWorkspaceId]);
    const enabledIntruderCookie = await signIn(bothAllowlisted, intruderEmail);
    const foreign = await bothAllowlisted.inject({
      method: "GET",
      url: publishedHealthUrl(quizId, version.id),
      headers: { cookie: enabledIntruderCookie },
    });
    expect(foreign.statusCode).toBe(404);
    expect(foreign.body).not.toContain("Immutable Question Health");
    expect(foreign.body).not.toContain("Which option is correct?");
  });

  it("uses the legacy v1 content upcaster and never substitutes the current draft", async () => {
    const target = await build(true);
    const cookie = await signIn(target, "question-health-legacy-version@example.com");
    const { quizId, version } = await createPublishedRound(target, cookie);
    const stored = repository?.versions.get(version.id);
    expect(stored).toBeDefined();
    if (!stored) return;
    stored.contentSchemaVersion = undefined;
    stored.sourceDraftRevision = null;
    const response = await target.inject({
      method: "GET",
      url: publishedHealthUrl(quizId, version.id),
      headers: { cookie },
    });
    expect(response.statusCode).toBe(200);
    const result = QuestionHealthPublishedResultSchema.parse(response.json());
    expect(result.version.sourceDraftRevision).toBeNull();
    expect(result.version.contentHash).toBe(version.contentHash);
    expect(result.findings.map((finding) => finding.ruleId)).toContain(
      "question.missing_explanation",
    );
  });

  it("requires the feature rollout but leaves the published Round itself readable", async () => {
    const target = await build(false);
    const cookie = await signIn(target, "question-health-published-disabled@example.com");
    const { quizId, version } = await createPublishedRound(target, cookie);
    const disabled = await target.inject({
      method: "GET",
      url: publishedHealthUrl(quizId, version.id),
      headers: { cookie },
    });
    expect(disabled.statusCode).toBe(404);
    const disabledObservations = await target.inject({
      method: "GET",
      url: postUseObservationsUrl(quizId, version.id),
      headers: { cookie },
    });
    expect(disabledObservations.statusCode).toBe(404);
    const round = await target.inject({
      method: "GET",
      url: `/v1/quizzes/${quizId}`,
      headers: { cookie },
    });
    expect(round.statusCode).toBe(200);
    expect(round.json()).toMatchObject({ currentVersion: { id: version.id } });
  });
});
