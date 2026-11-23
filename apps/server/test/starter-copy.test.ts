import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { STARTER_COPY_INTENT_TTL_MS, type StarterCopyRequest } from "@openround/contracts";
import { MemoryRepository } from "@openround/db";
import { buildApp } from "../src/app.js";
import { MemorySessionCache } from "../src/cache.js";
import { ConfigSchema } from "../src/config.js";
import { hashToken } from "../src/security.js";
import { STARTER_CONTENT_VERSION } from "../src/starter-localization.js";
import * as localization from "../src/starter-localization.js";
import * as starters from "../src/starters.js";

const apps: FastifyInstance[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  vi.restoreAllMocks();
});

async function fixture() {
  const workspaceId = randomUUID();
  const repository = new MemoryRepository({ initialWorkspaceId: workspaceId });
  const config = ConfigSchema.parse({
    NODE_ENV: "test",
    ALLOW_IN_MEMORY: "true",
    COMMUNITY_MODE: "true",
    FEATURE_ROUND_CLIENT_PROTOCOL: "true",
    CORE_PARITY_WORKSPACE_ALLOWLIST: workspaceId,
    LOG_LEVEL: "silent",
  });
  const { app } = await buildApp(config, { repository, cache: new MemorySessionCache() });
  apps.push(app);
  const now = new Date();
  const tokenHash = randomUUID();
  await repository.createMagicToken({
    id: randomUUID(),
    tokenHash,
    email: `${randomUUID()}@example.test`,
    segment: "workplace",
    policyVersion: "test",
    expiresAt: new Date(now.getTime() + 60_000),
    consumedAt: null,
  });
  const actor = (await repository.consumeMagicToken(tokenHash, now))!;
  const token = randomUUID();
  await repository.createCreatorSession({
    id: randomUUID(),
    userId: actor.userId,
    tokenHash: hashToken(token),
    activeWorkspaceId: actor.workspaceId,
    expiresAt: new Date(now.getTime() + 60 * 60_000),
    createdAt: now,
  });
  const headers = { cookie: `${config.COOKIE_NAME}=${token}` };
  const input = (): StarterCopyRequest => ({
    locale: "ko-KR",
    idempotencyKey: randomUUID(),
    creationContext: { actorId: actor.userId, workspaceId: actor.workspaceId },
    contentVersion: STARTER_CONTENT_VERSION,
    expiresAt: new Date(Date.now() + STARTER_COPY_INTENT_TTL_MS).toISOString(),
  });
  const copy = (body: Record<string, unknown> = input(), id = "misconception-check") =>
    app.inject({ method: "POST", url: `/v1/starters/${id}/use`, headers, payload: body });
  return { app, repository, config, actor, headers, input, copy };
}

describe("durable Round starter copies", () => {
  it("retains legacy locale-only and no-body independent creation", async () => {
    const f = await fixture();
    const english = await f.app.inject({
      method: "POST",
      url: "/v1/starters/exit-ticket/use",
      headers: f.headers,
    });
    const second = await f.copy({}, "exit-ticket");
    const localized = await f.copy({ locale: "ko-KR" }, "exit-ticket");
    for (const response of [english, second, localized]) {
      expect(response.statusCode, response.body).toBe(201);
      expect(response.json()).not.toHaveProperty("replayed");
    }
    expect(english.json().quiz.title).toBe("Exit ticket");
    expect(second.json().quiz.id).not.toBe(english.json().quiz.id);
    expect(localized.json().quiz.title).not.toBe("Exit ticket");
  });

  it("creates once across concurrent retries, audits once and recovers current edits", async () => {
    const f = await fixture();
    const input = f.input();
    const responses = await Promise.all(Array.from({ length: 6 }, () => f.copy(input)));
    expect(responses.filter((response) => response.statusCode === 201)).toHaveLength(1);
    expect(responses.filter((response) => response.statusCode === 200)).toHaveLength(5);
    const quiz = responses[0]!.json().quiz;
    expect(new Set(responses.map((response) => response.json().quiz.id)).size).toBe(1);
    expect(await f.repository.listQuizzes(f.actor.workspaceId)).toHaveLength(1);
    expect(await f.repository.listQuizDraftHistory(f.actor.workspaceId, quiz.id, 10)).toHaveLength(
      1,
    );
    expect(f.repository.audits.filter((entry) => entry.action === "starter.use")).toHaveLength(1);
    await f.repository.updateQuizDraft({
      workspaceId: f.actor.workspaceId,
      quizId: quiz.id,
      draft: { ...quiz.draft, title: "Edited after lost acknowledgement" },
      expectedRevision: 0,
      mutationId: randomUUID(),
      editorId: f.actor.userId,
      schemaVersion: quiz.draftSchemaVersion,
      draftHash: "b".repeat(64),
    });
    const replay = await f.copy(input);
    expect(replay.statusCode, replay.body).toBe(200);
    expect(replay.json()).toMatchObject({
      replayed: true,
      quiz: { id: quiz.id, draftRevision: 1, title: "Edited after lost acknowledgement" },
    });
    const published = await f.app.inject({
      method: "POST",
      url: `/v1/quizzes/${quiz.id}/publish`,
      headers: f.headers,
      payload: { expectedDraftRevision: 1 },
    });
    expect(published.statusCode, published.body).toBe(200);
    const retained = await f.repository.getQuiz(f.actor.workspaceId, quiz.id);
    expect((await f.copy(input)).json().quiz).toMatchObject({
      id: quiz.id,
      status: "published",
      currentVersionId: retained!.currentVersionId,
      publishedDraftRevision: 1,
    });
    expect(await f.repository.getQuiz(f.actor.workspaceId, quiz.id)).toEqual(retained);
    expect(f.repository.audits.filter((entry) => entry.action === "starter.use")).toHaveLength(1);
  });

  it("binds accepted keys to source, language, pinned version, expiry and context", async () => {
    const f = await fixture();
    const input = f.input();
    expect((await f.copy(input)).statusCode).toBe(201);
    for (const changed of [
      { ...input, locale: "fr-FR" },
      { ...input, contentVersion: "another-content-version" },
      { ...input, expiresAt: new Date(Date.now() + 60_000).toISOString() },
    ]) {
      const response = await f.copy(changed);
      expect(response.statusCode, response.body).toBe(409);
      expect(response.json().error.code).toBe("IDEMPOTENCY_CONFLICT");
    }
    const otherSource = await f.copy(input, "exit-ticket");
    expect(otherSource.statusCode).toBe(409);
    expect(otherSource.json().error.code).toBe("IDEMPOTENCY_CONFLICT");
    for (const field of ["actorId", "workspaceId"]) {
      const response = await f.copy({
        ...input,
        creationContext: { ...input.creationContext, [field]: randomUUID() },
      });
      expect(response.statusCode).toBe(409);
      expect(response.json().error.code).toBe("STARTER_COPY_CONTEXT_CHANGED");
    }
    expect(await f.repository.listQuizzes(f.actor.workspaceId)).toHaveLength(1);
  });

  it("rejects expired, excessive, changed-content and incomplete unaccepted intents", async () => {
    const f = await fixture();
    for (const [body, status, code] of [
      [{ ...f.input(), expiresAt: new Date(0).toISOString() }, 410, "STARTER_COPY_EXPIRED"],
      [
        { ...f.input(), expiresAt: new Date(Date.now() + 25 * 60 * 60_000).toISOString() },
        400,
        "INVALID_INTENT",
      ],
      [{ ...f.input(), contentVersion: "old-version" }, 409, "STARTER_CONTENT_CHANGED"],
    ] as const) {
      const response = await f.copy(body);
      expect(response.statusCode, response.body).toBe(status);
      expect(response.json().error.code).toBe(code);
    }
    const incomplete: Record<string, unknown> = { ...f.input() };
    delete incomplete.expiresAt;
    expect((await f.copy(incomplete)).statusCode).toBe(400);
    expect(await f.repository.listQuizzes(f.actor.workspaceId)).toEqual([]);
  });

  it("replays an accepted intent after expiry or response-writer rollback without creating again", async () => {
    // Current catalog polls are single-select. Exercise the existing writer gate with an
    // otherwise ordinary starter factory fixture that needs the extended response protocol.
    const instantiate = starters.instantiateStarter;
    vi.spyOn(starters, "instantiateStarter").mockImplementation((id, locale) => {
      const draft = instantiate(id, locale);
      const question = draft.questions.find((candidate) => candidate.type === "poll");
      if (question?.type === "poll") question.maxSelections = 2;
      return draft;
    });
    const f = await fixture();
    const input = { ...f.input(), expiresAt: new Date(Date.now() + 1000).toISOString() };
    const created = await f.copy(input, "icebreaker-poll");
    expect(created.statusCode, created.body).toBe(201);
    f.config.FEATURE_ROUND_CLIENT_PROTOCOL = false;
    await delay(Math.max(0, Date.parse(input.expiresAt) - Date.now() + 10));
    const replay = await f.copy(input, "icebreaker-poll");
    expect(replay.statusCode, replay.body).toBe(200);
    expect(replay.json()).toMatchObject({ replayed: true, quiz: { id: created.json().quiz.id } });
    const fresh = await f.copy(f.input(), "icebreaker-poll");
    expect(fresh.statusCode).toBe(404);
    expect(await f.repository.listQuizzes(f.actor.workspaceId)).toHaveLength(1);
  });

  it("requires editor access for legacy creation, durable creation and replay", async () => {
    const f = await fixture();
    const input = f.input();
    expect((await f.copy(input)).statusCode).toBe(201);
    f.repository.workspaceMembers.get(`${f.actor.workspaceId}:${f.actor.userId}`)!.role = "viewer";
    f.repository.users.get(f.actor.userId)!.role = "viewer";
    for (const body of [{}, { locale: "en-CA" }, input, f.input()])
      expect((await f.copy(body)).statusCode).toBe(403);
    expect(await f.repository.listQuizzes(f.actor.workspaceId)).toHaveLength(1);
  });

  it("recovers an Event experience copy with its original description after the catalog changes", async () => {
    const f = await fixture();
    const previousVersion = "launch-collection-v2";
    const previousDescription =
      "Tell us what was useful and what to improve next time. This is unscored feedback; skip optional questions that do not apply.";
    const input = { ...f.input(), locale: "en-CA", contentVersion: previousVersion };
    const catalog = vi
      .spyOn(localization, "STARTER_CONTENT_VERSION", "get")
      .mockReturnValue(previousVersion as typeof STARTER_CONTENT_VERSION);
    const factory = vi.spyOn(starters, "instantiateStarter").mockReturnValueOnce({
      ...starters.instantiateStarter("event-feedback"),
      description: previousDescription,
    });
    const created = await f.copy(input, "event-feedback");
    expect(created.statusCode, created.body).toBe(201);
    expect(created.json().quiz.draft.description).toBe(previousDescription);
    catalog.mockRestore();
    factory.mockRestore();
    const replay = await f.copy(input, "event-feedback");
    expect(replay.statusCode, replay.body).toBe(200);
    expect(replay.json()).toMatchObject({ replayed: true, quiz: created.json().quiz });
    const unaccepted = await f.copy({ ...input, idempotencyKey: randomUUID() }, "event-feedback");
    expect(unaccepted.statusCode).toBe(409);
    expect(unaccepted.json().error.code).toBe("STARTER_CONTENT_CHANGED");
    const refreshed = await f.copy(
      { ...input, idempotencyKey: randomUUID(), contentVersion: STARTER_CONTENT_VERSION },
      "event-feedback",
    );
    expect(refreshed.statusCode, refreshed.body).toBe(201);
    expect(refreshed.json().quiz.draft.description).toBe(
      starters.instantiateStarter("event-feedback").description,
    );
    expect(refreshed.json().quiz.draft.description).not.toBe(previousDescription);
  });

  it("retains consumed keys after archive and deletion and permits a deliberate independent copy", async () => {
    const f = await fixture();
    const input = f.input();
    const created = await f.copy(input);
    const id = created.json().quiz.id;
    await f.repository.archiveQuiz(f.actor.workspaceId, id, true);
    for (const deleted of [false, true]) {
      if (deleted) expect(await f.repository.deleteQuiz(f.actor.workspaceId, id)).toBe("deleted");
      const response = await f.copy(input);
      expect(response.statusCode, response.body).toBe(410);
      expect(response.json().error.code).toBe("STARTER_COPY_TARGET_UNAVAILABLE");
    }
    expect((await f.copy(f.input())).statusCode).toBe(201);
    expect(await f.repository.listQuizzes(f.actor.workspaceId)).toHaveLength(1);
  });
});
