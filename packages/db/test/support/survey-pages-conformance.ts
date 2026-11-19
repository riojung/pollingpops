import { createHash, randomInt, randomUUID } from "node:crypto";
import { expect } from "vitest";
import { SurveyDraftSchema, type SurveyResponses } from "@openround/contracts/surveys";
import { createSurveyRepository, type Repository } from "../../src/index.js";
import { assistanceIdentity } from "./presentation-assistance-conformance.js";
import { surveyFixture } from "./survey-conformance.js";

export function surveyPagesFixture() {
  const legacy = surveyFixture();
  return SurveyDraftSchema.parse({
    ...legacy,
    schemaVersion: 3,
    pages: legacy.items.map((item, index) => ({
      id: randomUUID(),
      title: `Page ${index + 1}`,
      description: "Synthetic page introduction",
      questionIds: [item.question.id],
    })),
  });
}

export async function seedPagedSurvey(repository: Repository) {
  const actor = await assistanceIdentity(repository);
  const surveys = createSurveyRepository(repository);
  const id = randomUUID();
  const draft = surveyPagesFixture();
  const createKey = randomUUID();
  const policy = { maximumSchemaVersion: 3 as const };
  const record = await surveys.create(actor.workspaceId, id, draft, createKey, policy);
  const publishKey = randomUUID();
  const published = await surveys.publish(actor.workspaceId, id, 0, publishKey, null, policy);
  const roomKey = randomUUID();
  const now = new Date();
  const settings = {
    code: String(randomInt(1_000_000, 10_000_000)),
    closesAt: new Date(now.getTime() + 60_000).toISOString(),
    expiresAt: new Date(now.getTime() + 3_600_000).toISOString(),
    participantLimit: 20,
    windowDays: 1,
  };
  const room = await surveys.createRoom(actor.workspaceId, id, 0, roomKey, {
    ...settings,
    ...policy,
  });
  return {
    actor,
    surveys,
    id,
    draft,
    record,
    createKey,
    published,
    publishKey,
    room,
    roomKey,
    settings,
    now,
    policy,
  };
}

export async function expectSurveyPagesWriterBoundary(repository: Repository) {
  const f = await seedPagedSurvey(repository);
  expect(await f.surveys.create(f.actor.workspaceId, f.id, f.draft, f.createKey)).toEqual(f.record);
  expect(await f.surveys.publish(f.actor.workspaceId, f.id, 0, f.publishKey, null)).toEqual(
    f.published,
  );
  expect(await f.surveys.createRoom(f.actor.workspaceId, f.id, 0, f.roomKey, f.settings)).toEqual(
    f.room,
  );
  await expect(
    f.surveys.create(f.actor.workspaceId, randomUUID(), f.draft, randomUUID()),
  ).rejects.toMatchObject({ code: "SURVEY_PAGES_NOT_ENABLED" });
  await expect(
    f.surveys.save(f.actor.workspaceId, f.id, { ...f.draft, title: "Changed" }, 0, randomUUID()),
  ).rejects.toMatchObject({ code: "SURVEY_PAGES_NOT_ENABLED" });
  await expect(
    f.surveys.publish(f.actor.workspaceId, f.id, 0, randomUUID(), null),
  ).rejects.toMatchObject({ code: "SURVEY_PAGES_NOT_ENABLED" });
  await expect(
    f.surveys.createRoom(f.actor.workspaceId, f.id, 0, randomUUID(), {
      ...f.settings,
      code: String(randomInt(1_000_000, 10_000_000)),
    }),
  ).rejects.toMatchObject({ code: "SURVEY_PAGES_NOT_ENABLED" });
  const saveKey = randomUUID();
  const changed = { ...f.draft, title: "Edited paged Survey" };
  const saved = await f.surveys.save(f.actor.workspaceId, f.id, changed, 0, saveKey, f.policy);
  expect(await f.surveys.save(f.actor.workspaceId, f.id, changed, 0, saveKey)).toEqual(saved);
  await expect(
    f.surveys.save(
      f.actor.workspaceId,
      f.id,
      { ...changed, title: "Different request" },
      0,
      saveKey,
      f.policy,
    ),
  ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  const { pages: _pages, ...flat } = f.draft as Extract<typeof f.draft, { schemaVersion: 3 }>;
  void _pages;
  await expect(
    f.surveys.save(
      f.actor.workspaceId,
      f.id,
      { ...flat, schemaVersion: 2 },
      1,
      randomUUID(),
      f.policy,
    ),
  ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  expect((await f.surveys.getRoom(f.room.id))?.content).toEqual(f.draft);
  expect((await f.surveys.get(f.actor.workspaceId, f.id))?.draft).toEqual(changed);
  const archived = await f.surveys.archive(f.actor.workspaceId, f.id, 1, randomUUID());
  expect(archived.status).toBe("archived");
  expect(await f.surveys.save(f.actor.workspaceId, f.id, changed, 0, saveKey)).toEqual(saved);
  return f;
}

export async function expectSurveyPagesAudience(repository: Repository) {
  const f = await seedPagedSurvey(repository);
  const token = createHash("sha256").update(randomUUID()).digest("hex");
  await expect(f.surveys.admit(f.room.id, token, f.now)).rejects.toMatchObject({
    code: "SURVEY_CLIENT_UPDATE_REQUIRED",
  });
  await expect(f.surveys.attempt(f.room.id, token, f.now)).rejects.toMatchObject({
    code: "SURVEY_CLIENT_UPDATE_REQUIRED",
  });
  const admitted = await f.surveys.admit(f.room.id, token, f.now, 3);
  expect(admitted).toMatchObject({
    schemaVersion: 3,
    responseSchemaVersion: 3,
    content: f.draft,
    responses: {},
    revision: 0,
  });
  const q = f.draft.items[0]!.question;
  if (q.type !== "poll") throw new Error("Expected poll fixture");
  const responses: SurveyResponses = { [q.id]: { kind: "poll", choiceIds: [q.choices[0]!.id] } };
  const key = randomUUID();
  await expect(
    f.surveys.respond(f.room.id, token, responses, 0, key, false, f.now),
  ).rejects.toMatchObject({ code: "SURVEY_CLIENT_UPDATE_REQUIRED" });
  const saved = await f.surveys.respond(f.room.id, token, responses, 0, key, false, f.now, 3);
  expect(saved.revision).toBe(1);
  await expect(
    f.surveys.respond(f.room.id, token, responses, 0, key, false, f.now),
  ).rejects.toMatchObject({ code: "SURVEY_CLIENT_UPDATE_REQUIRED" });
  expect(await f.surveys.respond(f.room.id, token, responses, 0, key, false, f.now, 3)).toEqual(
    saved,
  );
  await expect(
    f.surveys.respond(f.room.id, token, {}, 1, randomUUID(), true, f.now, 3),
  ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  const submitKey = randomUUID();
  const finalized = await f.surveys.respond(
    f.room.id,
    token,
    responses,
    1,
    submitKey,
    true,
    f.now,
    3,
  );
  expect(finalized).toMatchObject({ revision: 2, finalized: true, responses });
  for (let index = 0; index < 4; index++) {
    const other = createHash("sha256").update(randomUUID()).digest("hex");
    await f.surveys.admit(f.room.id, other, f.now, 3);
    await f.surveys.respond(f.room.id, other, responses, 0, randomUUID(), true, f.now, 3);
  }
  const collecting = await f.surveys.results(f.actor.workspaceId, f.room.id, f.now);
  expect(collecting).toMatchObject({ schemaVersion: 2, submittedCount: 5, suppressed: true });
  await f.surveys.close(f.actor.workspaceId, f.room.id);
  expect(
    await f.surveys.respond(f.room.id, token, responses, 1, submitKey, true, f.now, 3),
  ).toEqual(finalized);
  const results = await f.surveys.results(f.actor.workspaceId, f.room.id, f.now);
  expect(results).toMatchObject({
    schemaVersion: 2,
    submittedCount: 5,
    suppressed: false,
    questions: [
      { id: q.id, answeredCount: 5 },
      { answeredCount: null, suppressed: true },
    ],
  });
  expect(results.questions.map((item) => item.id)).toEqual(
    f.draft.items.map((item) => item.question.id),
  );
  const exported = await repository.exportAccount(f.actor.userId);
  expect(exported.surveyRooms).toEqual(
    expect.arrayContaining([expect.objectContaining({ id: f.room.id, content: f.draft })]),
  );
  expect(JSON.stringify(exported)).not.toContain(token);
  expect(JSON.stringify(exported)).not.toContain(finalized.receipt!);
  await f.surveys.deleteRoom(f.actor.workspaceId, f.room.id);
  await expect(f.surveys.attempt(f.room.id, token, f.now, 3)).rejects.toMatchObject({
    code: "NOT_FOUND",
  });
  expect(await f.surveys.getRoomCreation(f.actor.workspaceId, f.id, f.roomKey)).toBeNull();
  await expect(
    f.surveys.createRoom(f.actor.workspaceId, f.id, 0, f.roomKey, {
      ...f.settings,
      ...f.policy,
      replayOnly: true,
    }),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  return f;
}
