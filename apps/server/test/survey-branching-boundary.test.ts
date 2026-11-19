import { randomBytes, randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CURRENT_SURVEY_SCHEMA_VERSION,
  MAX_SUPPORTED_SURVEY_SCHEMA_VERSION,
  SURVEY_READER_HEADER,
  SurveyContentSchema,
  SurveyDraftSchema,
  surveyPageViews,
  upgradeSurveyDraft,
} from "@openround/contracts/surveys";
import { SurveyBranchingContentSchema } from "@openround/contracts/survey-branching";
import { MemoryRepository, SurveyRepository, createPlatformRepository } from "@openround/db";
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
const id = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;

function productionDraft(version: 1 | 2 | 3) {
  const source = surveyFixture();
  source.items.forEach((item, index) => {
    item.question.id = id(index + 1);
    if (item.question.type === "poll")
      item.question.choices.forEach((choice, offset) => {
        choice.id = id(offset + 100);
      });
  });
  return SurveyDraftSchema.parse({
    ...source,
    schemaVersion: version,
    ...(version === 3
      ? {
          pages: source.items.map((item, index) => ({
            id: id(index + 10),
            title: `Page ${index + 1}`,
            description: "Stable instructions",
            questionIds: [item.question.id],
          })),
        }
      : {}),
  });
}

/** Model a future deployment's stored document without enabling any v4 production writer. */
function store(repository: MemoryRepository) {
  return repository.getOrCreateLifecycleExtension("surveys", () => {
    throw new Error("Expected trusted Survey fixture store");
  }) as unknown as {
    surveys: Map<string, Record<string, unknown>>;
    survey_feedback_rooms: Map<string, Record<string, unknown>>;
    survey_guests: Map<string, unknown>;
    receipts: Map<string, { requestHash: string }>;
  };
}

async function fixture() {
  const workspaceId = randomUUID();
  const repository = new MemoryRepository({ initialWorkspaceId: workspaceId });
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
  const token = randomUUID();
  await repository.createCreatorSession({
    id: randomUUID(),
    userId: f.actor.userId,
    tokenHash: hashToken(token),
    activeWorkspaceId: f.actor.workspaceId,
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + 3_600_000),
  });
  await createPlatformRepository(repository).saveFeaturePolicy({
    expectedRevision: 0,
    features: Object.fromEntries(
      ["audienceScopes", "feedbackRooms", "surveys", "surveyPages"].map((key) => [
        key,
        { enabled: true, plans: ["free", "pro", "team"] },
      ]),
    ),
  });
  const headers = { cookie: `${config.COOKIE_NAME}=${token}` };
  const guest = {
    authorization: `Bearer ${randomBytes(32).toString("hex")}`,
    [SURVEY_READER_HEADER]: "3",
  };
  if (f.draft.schemaVersion !== 3) throw new Error("Expected trusted v3 fixture");
  const controller = f.draft.items[0]!.question;
  if (controller.type !== "poll") throw new Error("Expected single-choice fixture controller");
  const future = SurveyBranchingContentSchema.parse({
    ...f.draft,
    schemaVersion: 4,
    title: "Future conditional Survey",
    pages: f.draft.pages.map((page, index) =>
      index === 0
        ? page
        : {
            ...page,
            visibleWhen: {
              kind: "choice_equals",
              questionId: controller.id,
              choiceId: controller.choices[0]!.id,
            },
          },
    ),
  });
  return { ...f, app, repository, headers, guest, future, store: store(repository) };
}

describe("isolated future Survey branching compatibility boundary", () => {
  // Goldens captured from unchanged production parsers/storage at main 4dcefcc. Accepted
  // receipt hashes depend on parsed field order; changes require a receipt-compatibility plan.
  it.each([
    [
      1,
      "5465a8d0af73ff6eb6f7c6033eb23f2342b388c4441ad818de567840a8b59d59",
      "e5c88c65e87692048ab3b9d4d2395be201e3a2e32a96eaa7ccb93a9417f7bb57",
    ],
    [
      2,
      "ab3edb4d80db034472ef830067ff648e1464db1b4fe5e1010a3290261f7721a9",
      "f036d4b964ab01060bca0069c5e0a8689e1ebf91e8bd5357c2f78180cf90e39f",
    ],
    [
      3,
      "3770c0844a8bc7183dc2ef71928b789711271a2b98e9b76fa1d4355c67535ea9",
      "1a833becb8cbb2a644a4cda6df6ffafdb328b8c5ec4450837dcb037dd15fafb2",
    ],
  ] as const)(
    "keeps production v%s parsed shapes and accepted request hashes stable",
    async (version, createHash, saveHash) => {
      const f = await fixture();
      const draft = productionDraft(version);
      expect(CURRENT_SURVEY_SCHEMA_VERSION).toBe(2);
      expect(MAX_SUPPORTED_SURVEY_SCHEMA_VERSION).toBe(3);
      expect(Object.keys(draft)).toEqual([
        "schemaVersion",
        "title",
        "description",
        "category",
        "experiencePreset",
        "items",
        ...(version === 3 ? ["pages"] : []),
      ]);
      expect(SurveyContentSchema.parse(draft)).toEqual(draft);
      expect(surveyPageViews(draft).flatMap((page) => page.items)).toEqual(draft.items);
      expect(upgradeSurveyDraft(draft).schemaVersion).toBe(version === 1 ? 2 : version);
      const surveyId = randomUUID(),
        createKey = randomUUID(),
        saveKey = randomUUID();
      const created = await f.surveys.create(
        f.actor.workspaceId,
        surveyId,
        draft,
        createKey,
        f.policy,
      );
      expect(f.store.receipts.get(`${surveyId}:${createKey}`)?.requestHash).toBe(createHash);
      const changed = SurveyDraftSchema.parse({ ...draft, title: "Edited stable Survey" });
      const saved = await f.surveys.save(
        f.actor.workspaceId,
        surveyId,
        changed,
        0,
        saveKey,
        f.policy,
      );
      expect(f.store.receipts.get(`${surveyId}:${saveKey}`)?.requestHash).toBe(saveHash);
      expect(
        await f.surveys.create(
          f.actor.workspaceId,
          surveyId,
          SurveyDraftSchema.parse(JSON.parse(JSON.stringify(draft))),
          createKey,
          f.policy,
        ),
      ).toEqual(created);
      expect(
        await f.surveys.save(
          f.actor.workspaceId,
          surveyId,
          SurveyDraftSchema.parse(JSON.parse(JSON.stringify(changed))),
          0,
          saveKey,
          f.policy,
        ),
      ).toEqual(saved);
    },
  );

  it("rejects valid proposed v4 and v4 conditions disguised as v3 before a save writer runs, even with the page grant", async () => {
    const f = await fixture();
    const account = await f.app.inject({ url: "/v1/auth/me", headers: f.headers });
    expect(account.json().productFeatures.surveyPages).toBe(true);
    expect(SurveyDraftSchema.safeParse(f.future).success).toBe(false);
    expect(SurveyContentSchema.safeParse(f.future).success).toBe(false);
    const save = vi.spyOn(SurveyRepository.prototype, "save");
    const before = await f.surveys.get(f.actor.workspaceId, f.id);
    const receipts = f.store.receipts.size;
    for (const draft of [f.future, { ...f.future, schemaVersion: 3 }]) {
      const response = await f.app.inject({
        method: "PUT",
        url: `/v1/surveys/${f.id}`,
        headers: f.headers,
        payload: { idempotencyKey: randomUUID(), expectedRevision: 0, draft },
      });
      expect(response.statusCode, response.body).toBe(400);
      expect(response.json()).not.toHaveProperty("survey");
    }
    expect(save).not.toHaveBeenCalled();
    expect(f.store.receipts.size).toBe(receipts);
    expect(await f.surveys.get(f.actor.workspaceId, f.id)).toEqual(before);
  });

  it("refuses future stored sources on the actual copy-creation path instead of flattening or downgrading them", async () => {
    const f = await fixture();
    const futureRecord = { ...f.store.surveys.get(f.id)!, schemaVersion: 4, draft: f.future };
    f.store.surveys.set(f.id, futureRecord);
    const create = vi.spyOn(SurveyRepository.prototype, "create");
    const response = await f.app.inject({
      method: "POST",
      url: "/v1/surveys",
      headers: f.headers,
      payload: { idempotencyKey: randomUUID(), sourceId: f.id },
    });
    expect(response.statusCode, response.body).toBe(500);
    expect(response.json()).not.toHaveProperty("survey");
    expect(response.body).not.toContain(f.future.title);
    expect(create).not.toHaveBeenCalled();
    expect(f.store.surveys.size).toBe(1);
    expect(f.store.surveys.get(f.id)).toEqual(futureRecord);
  });

  it("fails closed before public metadata, attempt content, admissions or response receipts can consume a future room", async () => {
    const f = await fixture();
    const url = `/v1/survey-rooms/${f.room.id}`;
    const joined = await f.app.inject({
      method: "POST",
      url: `${url}/join`,
      headers: f.guest,
      payload: {},
    });
    expect(joined.statusCode, joined.body).toBe(200);
    const guests = structuredClone([...f.store.survey_guests]);
    const receipts = f.store.receipts.size;
    f.store.survey_feedback_rooms.set(f.room.id, {
      ...f.store.survey_feedback_rooms.get(f.room.id)!,
      schemaVersion: 4,
      content: f.future,
    });
    for (const reader of ["3", "4"]) {
      const headers = { ...f.guest, [SURVEY_READER_HEADER]: reader };
      for (const suffix of ["public", "attempt", "join", "draft", "submit"]) {
        const response = await f.app.inject({
          method: ["public", "attempt"].includes(suffix) ? "GET" : "POST",
          url: `${url}/${suffix}`,
          headers,
          ...(["draft", "submit"].includes(suffix)
            ? { payload: { idempotencyKey: randomUUID(), expectedRevision: 0, responses: {} } }
            : suffix === "join"
              ? { payload: {} }
              : {}),
        });
        expect(response.statusCode, response.body).toBe(500);
        expect(response.json()).not.toHaveProperty("attempt");
        expect(response.json()).not.toHaveProperty("room");
        expect(response.body).not.toContain(f.future.title);
        expect(response.body).not.toContain(f.future.items[0]!.question.prompt);
      }
    }
    expect([...f.store.survey_guests]).toEqual(guests);
    expect(f.store.receipts.size).toBe(receipts);
  });
});
