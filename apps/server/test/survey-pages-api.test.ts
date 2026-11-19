import { randomBytes, randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SURVEY_READER_HEADER } from "@openround/contracts/surveys";
import { MemoryRepository, SurveyRepository } from "@openround/db";
import { seedPagedSurvey } from "../../../packages/db/test/support/survey-pages-conformance.js";
import { surveyFixture } from "../../../packages/db/test/support/survey-conformance.js";
import { buildApp } from "../src/app.js";
import { ConfigSchema } from "../src/config.js";
import { MemorySessionCache } from "../src/cache.js";
import { hashToken } from "../src/security.js";

const apps: FastifyInstance[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  vi.restoreAllMocks();
});
async function fixture() {
  const workspaceId = randomUUID(),
    repository = new MemoryRepository({ initialWorkspaceId: workspaceId });
  const config = ConfigSchema.parse({
    NODE_ENV: "test",
    ALLOW_IN_MEMORY: "true",
    COMMUNITY_MODE: "true",
    FEATURE_AUDIENCE_SCOPES: "true",
    FEATURE_FEEDBACK_ROOMS: "true",
    FEATURE_SURVEYS: "true",
    CORE_PARITY_WORKSPACE_ALLOWLIST: workspaceId,
    WEB_ORIGIN: "http://localhost:3000",
    LOG_LEVEL: "silent",
  });
  const { app } = await buildApp(config, { repository, cache: new MemorySessionCache() });
  apps.push(app);
  const f = await seedPagedSurvey(repository);
  const token = randomUUID(),
    now = new Date();
  await repository.createCreatorSession({
    id: randomUUID(),
    userId: f.actor.userId,
    tokenHash: hashToken(token),
    activeWorkspaceId: f.actor.workspaceId,
    createdAt: now,
    expiresAt: new Date(now.getTime() + 3_600_000),
  });
  const headers = { cookie: `${config.COOKIE_NAME}=${token}` };
  const bearer = randomBytes(32).toString("hex");
  const guest = { authorization: `Bearer ${bearer}`, [SURVEY_READER_HEADER]: "3" };
  return { ...f, repository, config, app, headers, guest };
}

describe("paged Survey reader and writer HTTP boundary", () => {
  it("reads stored pages and metadata while blocking new page edits, publication, rooms and downgrades", async () => {
    const f = await fixture();
    const read = await f.app.inject({
      method: "GET",
      url: `/v1/surveys/${f.id}`,
      headers: f.headers,
    });
    expect(read.statusCode, read.body).toBe(200);
    expect(read.json().survey.draft).toEqual(f.draft);
    for (const [method, url, payload] of [
      [
        "PUT",
        `/v1/surveys/${f.id}`,
        {
          idempotencyKey: randomUUID(),
          expectedRevision: 0,
          draft: { ...f.draft, title: "Changed" },
        },
      ],
      [
        "POST",
        `/v1/surveys/${f.id}/publish`,
        { idempotencyKey: randomUUID(), expectedRevision: 0 },
      ],
      ["POST", `/v1/surveys/${f.id}/rooms`, { idempotencyKey: randomUUID(), expectedRevision: 0 }],
    ] as const) {
      const response = await f.app.inject({ method, url, headers: f.headers, payload });
      expect(response.statusCode, response.body).toBe(409);
      expect(response.json().error.code).toBe("SURVEY_PAGES_NOT_ENABLED");
    }
    if (f.draft.schemaVersion !== 3) throw new Error("Expected pages");
    const { pages: _pages, ...flat } = f.draft;
    void _pages;
    const downgrade = await f.app.inject({
      method: "PUT",
      url: `/v1/surveys/${f.id}`,
      headers: f.headers,
      payload: {
        idempotencyKey: randomUUID(),
        expectedRevision: 0,
        draft: { ...flat, schemaVersion: 2 },
      },
    });
    expect(downgrade.statusCode, downgrade.body).toBe(422);
    const move = await f.app.inject({
      method: "PATCH",
      url: `/v1/surveys/${f.id}/organization`,
      headers: f.headers,
      payload: { idempotencyKey: randomUUID(), expectedRevision: 0, folderId: null },
    });
    expect(move.statusCode, move.body).toBe(200);
    const archive = await f.app.inject({
      method: "POST",
      url: `/v1/surveys/${f.id}/archive`,
      headers: f.headers,
      payload: { idempotencyKey: randomUUID(), expectedRevision: 1 },
    });
    expect(archive.statusCode, archive.body).toBe(200);
    expect((await f.surveys.getRoom(f.room.id))?.content).toEqual(f.draft);
  });

  it("requires the exact v3 reader header before admission, frozen content or accepted response acknowledgements", async () => {
    const f = await fixture(),
      url = `/v1/survey-rooms/${f.room.id}`;
    const admit = vi.spyOn(SurveyRepository.prototype, "admit");
    const metadata = await f.app.inject({ method: "GET", url: `${url}/public` });
    expect(metadata.statusCode, metadata.body).toBe(200);
    expect(metadata.json().room.title).toBe(f.draft.title);
    expect(metadata.json().room).not.toHaveProperty("content");
    for (const value of [undefined, "2", "4", "3, 3"]) {
      const headers = {
        authorization: f.guest.authorization,
        ...(value ? { [SURVEY_READER_HEADER]: value } : {}),
      };
      for (const path of [`${url}/join`, "/v1/survey-rooms/join"]) {
        const response = await f.app.inject({
          method: "POST",
          url: path,
          headers,
          payload: path.endsWith("rooms/join") ? { code: f.room.code } : {},
        });
        expect(response.statusCode, response.body).toBe(409);
        expect(response.json().error.code).toBe("SURVEY_CLIENT_UPDATE_REQUIRED");
        expect(response.json()).not.toHaveProperty("attempt");
      }
    }
    expect(admit).not.toHaveBeenCalled();
    const joined = await f.app.inject({
      method: "POST",
      url: `${url}/join`,
      headers: f.guest,
      payload: {},
    });
    expect(joined.statusCode, joined.body).toBe(200);
    expect(joined.json().attempt.content).toEqual(f.draft);
    expect(admit).toHaveBeenCalledOnce();
    const q = f.draft.items[0]!.question;
    if (q.type !== "poll") throw new Error("Expected poll");
    const body = {
      idempotencyKey: randomUUID(),
      expectedRevision: 0,
      responses: { [q.id]: { kind: "poll", choiceIds: [q.choices[0]!.id] } },
    };
    const legacyHeaders = { authorization: f.guest.authorization };
    for (const suffix of ["attempt", "draft"]) {
      const response = await f.app.inject(
        suffix === "attempt"
          ? { method: "GET", url: `${url}/${suffix}`, headers: legacyHeaders }
          : { method: "POST", url: `${url}/${suffix}`, headers: legacyHeaders, payload: body },
      );
      expect(response.statusCode, response.body).toBe(409);
      expect(response.json()).not.toHaveProperty("attempt");
    }
    const saved = await f.app.inject({
      method: "POST",
      url: `${url}/draft`,
      headers: f.guest,
      payload: body,
    });
    expect(saved.statusCode, saved.body).toBe(200);
    expect(saved.json().attempt.revision).toBe(1);
    const blockedReplay = await f.app.inject({
      method: "POST",
      url: `${url}/draft`,
      headers: legacyHeaders,
      payload: body,
    });
    expect(blockedReplay.statusCode).toBe(409);
    const replay = await f.app.inject({
      method: "POST",
      url: `${url}/draft`,
      headers: f.guest,
      payload: body,
    });
    expect(replay.json()).toEqual(saved.json());
    f.config.FEATURE_SURVEYS = false;
    const resumed = await f.app.inject({ method: "GET", url: `${url}/attempt`, headers: f.guest });
    expect(resumed.json()).toEqual(saved.json());
    const finalized = await f.app.inject({
      method: "POST",
      url: `${url}/submit`,
      headers: f.guest,
      payload: { ...body, idempotencyKey: randomUUID(), expectedRevision: 1 },
    });
    expect(finalized.statusCode, finalized.body).toBe(200);
    expect(finalized.json().attempt.finalized).toBe(true);
    const cors = await f.app.inject({
      method: "OPTIONS",
      url: `${url}/draft`,
      headers: {
        origin: f.config.WEB_ORIGIN,
        "access-control-request-method": "POST",
        "access-control-request-headers": `authorization,${SURVEY_READER_HEADER}`,
      },
    });
    expect(cors.statusCode, cors.body).toBe(204);
    expect(cors.headers["access-control-allow-headers"]).toContain(SURVEY_READER_HEADER);
  });

  it("preserves exact page references on source-copy generation and replays trusted accepted receipts", async () => {
    const f = await fixture(),
      key = randomUUID(),
      observed: (typeof f.draft)[] = [];
    const create = SurveyRepository.prototype.create;
    vi.spyOn(SurveyRepository.prototype, "create").mockImplementation(function (
      this: SurveyRepository,
      ...args
    ) {
      observed.push(structuredClone(args[2]));
      return create.apply(this, args);
    });
    const payload = { idempotencyKey: key, sourceId: f.id, locale: "en-CA" };
    for (let i = 0; i < 2; i++) {
      const response = await f.app.inject({
        method: "POST",
        url: "/v1/surveys",
        headers: f.headers,
        payload,
      });
      expect(response.statusCode, response.body).toBe(409);
      expect(response.json().error.code).toBe("SURVEY_PAGES_NOT_ENABLED");
    }
    expect(observed[0]).toEqual(observed[1]);
    const draft = observed[0]!;
    if (draft.schemaVersion !== 3 || f.draft.schemaVersion !== 3) throw new Error("Expected pages");
    expect(draft.pages.flatMap((page) => page.questionIds)).toEqual(
      draft.items.map((item) => item.question.id),
    );
    expect(draft.pages[0]!.id).not.toBe(f.draft.pages[0]!.id);
    expect(draft.items[0]!.question.id).not.toBe(f.draft.items[0]!.question.id);
    const accepted = await f.surveys.create(f.actor.workspaceId, key, draft, key, {
      maximumSchemaVersion: 3,
    });
    const replay = await f.app.inject({
      method: "POST",
      url: "/v1/surveys",
      headers: f.headers,
      payload,
    });
    expect(replay.statusCode, replay.body).toBe(201);
    expect(replay.json().survey).toEqual(accepted);
    const flatId = randomUUID(),
      flatKey = randomUUID();
    await f.surveys.create(f.actor.workspaceId, flatId, surveyFixture(), flatKey);
    const legacy = await f.app.inject({
      method: "POST",
      url: "/v1/surveys",
      headers: f.headers,
      payload: { idempotencyKey: randomUUID(), sourceId: flatId },
    });
    expect(legacy.statusCode, legacy.body).toBe(201);
    expect(legacy.json().survey.schemaVersion).toBe(2);
    expect(legacy.json().survey.draft).not.toHaveProperty("pages");
  });
});
