import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import {
  QuestionDraftSchema,
  QuestionHealthResultSchema,
  QuestionHealthRevisionAppliedSchema,
  QuestionHealthRevisionUndoneSchema,
  type QuizDraft,
} from "@openround/contracts";
import { MemoryRepository } from "@openround/db";
import { buildApp } from "../src/app.js";
import { MemorySessionCache } from "../src/cache.js";
import { ConfigSchema } from "../src/config.js";

const apps: FastifyInstance[] = [];
afterEach(async () => {
  for (const app of apps.splice(0)) await app.close();
});

async function fixture(type: "poll" | "ranking" | "open_text" | "word_cloud") {
  const workspaceId = randomUUID();
  const repository = new MemoryRepository({ initialWorkspaceId: workspaceId });
  const config = ConfigSchema.parse({
    NODE_ENV: "test",
    ALLOW_IN_MEMORY: "true",
    COMMUNITY_MODE: "true",
    LOG_LEVEL: "silent",
    FEATURE_QUESTION_HEALTH: "true",
    EVIDENCE_FEATURES_WORKSPACE_ALLOWLIST: workspaceId,
    FEATURE_ROUND_CLIENT_PROTOCOL: "true",
    CORE_PARITY_WORKSPACE_ALLOWLIST: workspaceId,
  });
  const app = (await buildApp(config, { repository, cache: new MemorySessionCache() })).app;
  apps.push(app);
  const magic = await app.inject({
    method: "POST",
    url: "/v1/auth/magic-link",
    payload: { email: `${randomUUID()}@example.com`, segment: "workplace", acceptPolicies: true },
  });
  const token = new URL(magic.json<{ debugUrl: string }>().debugUrl).searchParams.get("token")!;
  const verified = await app.inject({ url: `/v1/auth/verify?token=${token}` });
  const cookies = verified.headers["set-cookie"]!;
  const cookie = (Array.isArray(cookies) ? cookies[0]! : cookies).split(";")[0]!;
  const common = {
    id: randomUUID(),
    type,
    prompt: "Share a priority",
    purpose: "opinion",
    confidence: "off",
    delivery: "main",
    linkedRecheckQuestionId: null,
    conceptKeys: [],
    timeLimitSeconds: 30,
    basePoints: 0,
    explanation: "",
    mediaId: null,
    mediaAlt: null,
  };
  const opinion = QuestionDraftSchema.parse(
    type === "poll" || type === "ranking"
      ? {
          ...common,
          choices: ["Practice", "Examples", "Discussion"].map((label) => ({
            id: randomUUID(),
            label,
            isCorrect: false,
          })),
          ...(type === "poll" ? { maxSelections: 2 } : { rankCount: 2 }),
        }
      : common,
  );
  const draft: QuizDraft = {
    title: "Mixed-format health revision",
    description: "",
    questions: [
      {
        id: randomUUID(),
        type: "single_select",
        prompt: "Which option is correct?",
        purpose: "diagnostic",
        confidence: "off",
        delivery: "main",
        conceptKeys: ["health.revision"],
        linkedRecheckQuestionId: null,
        choices: [
          { id: randomUUID(), label: "A correct option", isCorrect: true },
          { id: randomUUID(), label: "A distractor", isCorrect: false },
        ],
        timeLimitSeconds: 30,
        basePoints: 1000,
        explanation: "",
        mediaId: null,
        mediaAlt: null,
      },
      opinion,
    ],
  };
  const created = await app.inject({
    method: "POST",
    url: "/v1/quizzes",
    headers: { cookie },
    payload: { title: draft.title },
  });
  expect(created.statusCode).toBe(201);
  const quizId = created.json<{ quiz: { id: string } }>().quiz.id;
  const saved = await app.inject({
    method: "PATCH",
    url: `/v1/quizzes/${quizId}`,
    headers: { cookie },
    payload: { draft, expectedDraftRevision: 0 },
  });
  expect(saved.statusCode).toBe(200);
  const published = await app.inject({
    method: "POST",
    url: `/v1/quizzes/${quizId}/publish`,
    headers: { cookie },
    payload: { expectedDraftRevision: 1 },
  });
  expect(published.statusCode).toBe(200);
  const version = published.json<{
    version: { id: string; content: unknown; contentSchemaVersion: number };
  }>().version;
  async function proposedInput() {
    const read = await app.inject({
      url: `/v1/quizzes/${quizId}/question-health`,
      headers: { cookie },
    });
    expect(read.statusCode).toBe(200);
    const health = QuestionHealthResultSchema.parse(read.json());
    const finding = health.findings.find(
      (candidate) => candidate.ruleId === "question.missing_explanation",
    )!;
    expect(finding).toBeDefined();
    return {
      url: `/v1/quizzes/${quizId}/question-health/findings/${encodeURIComponent(finding.id)}/apply`,
      payload: {
        draftRevision: health.draftRevision,
        ruleVersion: finding.ruleVersion,
        rulesetVersion: finding.rulesetVersion,
        contentHash: finding.contentHash,
        action: { kind: "set_explanation", value: "The first option is correct." },
        mutationId: randomUUID(),
      },
    };
  }
  const input = await proposedInput();
  return {
    app,
    config,
    repository,
    workspaceId,
    cookie,
    quizId,
    opinion,
    draft,
    version,
    input,
    proposedInput,
  };
}

describe("Question Health mutations on richer Round drafts", () => {
  it.each([
    ["poll", 2],
    ["ranking", 3],
    ["open_text", 4],
    ["word_cloud", 4],
  ] as const)(
    "applies and undoes alongside %s with artifact version %i",
    async (type, schemaVersion) => {
      const f = await fixture(type);
      expect(f.version.contentSchemaVersion).toBe(schemaVersion);
      const request = () =>
        f.app.inject({
          method: "POST",
          url: f.input.url,
          headers: { cookie: f.cookie },
          payload: f.input.payload,
        });
      const [first, replay] = await Promise.all([request(), request()]);
      expect(first.statusCode).toBe(200);
      expect(replay.statusCode).toBe(200);
      const applied = QuestionHealthRevisionAppliedSchema.parse(first.json());
      expect(applied.quiz).toMatchObject({ draftRevision: 2, draftSchemaVersion: schemaVersion });
      expect(applied.quiz.draft.questions[1]).toEqual(f.opinion);
      expect(applied.quiz.draft.questions[0]!.explanation).toBe(f.input.payload.action.value);
      expect(QuestionHealthRevisionAppliedSchema.parse(replay.json()).applicationId).toBe(
        applied.applicationId,
      );
      expect(
        (await f.repository.getQuizDraftHistory(f.workspaceId, f.quizId, 2))?.draftSchemaVersion,
      ).toBe(schemaVersion);
      expect(
        (await f.repository.getQuizDraftHistory(f.workspaceId, f.quizId, 1))?.draftSchemaVersion,
      ).toBe(schemaVersion);
      expect(
        f.repository.audits.filter((audit) => audit.action === "question_health.application.apply"),
      ).toHaveLength(1);
      const undoRequest = {
        method: "POST" as const,
        url: `/v1/quizzes/${f.quizId}/question-health/applications/${applied.applicationId}/undo`,
        headers: { cookie: f.cookie },
        payload: { expectedRevision: 2, mutationId: randomUUID() },
      };
      const undone = await f.app.inject(undoRequest);
      expect(undone.statusCode).toBe(200);
      const restored = QuestionHealthRevisionUndoneSchema.parse(undone.json());
      expect(restored.quiz).toMatchObject({
        draftRevision: 3,
        draftSchemaVersion: schemaVersion,
        draft: f.draft,
        currentVersionId: f.version.id,
      });
      expect((await f.app.inject(undoRequest)).statusCode).toBe(200);
      expect((await f.repository.getQuizVersion(f.workspaceId, f.version.id))?.content).toEqual(
        f.version.content,
      );
    },
  );

  it.each(["flag", "allowlist"] as const)(
    "blocks fresh extended writes after the %s is disabled while preserving apply receipts and undo",
    async (disabled) => {
      const f = await fixture("word_cloud");
      const request = () =>
        f.app.inject({
          method: "POST",
          url: f.input.url,
          headers: { cookie: f.cookie },
          payload: f.input.payload,
        });
      const accepted = await request();
      expect(accepted.statusCode).toBe(200);
      const applied = QuestionHealthRevisionAppliedSchema.parse(accepted.json());
      if (disabled === "flag") f.config.FEATURE_ROUND_CLIENT_PROTOCOL = false;
      else f.config.CORE_PARITY_WORKSPACE_ALLOWLIST = [];
      expect((await request()).statusCode).toBe(200);
      const undone = await f.app.inject({
        method: "POST",
        url: `/v1/quizzes/${f.quizId}/question-health/applications/${applied.applicationId}/undo`,
        headers: { cookie: f.cookie },
        payload: { expectedRevision: 2, mutationId: randomUUID() },
      });
      expect(undone.statusCode).toBe(200);
      const fresh = await f.proposedInput();
      const blocked = await f.app.inject({
        method: "POST",
        url: fresh.url,
        headers: { cookie: f.cookie },
        payload: fresh.payload,
      });
      expect(blocked.statusCode).toBe(404);
      expect(blocked.json()).toMatchObject({
        error: {
          code: "NOT_FOUND",
          message: "These live response formats are not enabled for this workspace",
        },
      });
      expect((await f.repository.getQuiz(f.workspaceId, f.quizId))?.draftRevision).toBe(3);
    },
  );
});
