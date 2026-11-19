import { createHash, randomInt, randomUUID } from "node:crypto";
import { expect } from "vitest";
import { SurveyDraftSchema, type SurveyDraft } from "@openround/contracts/surveys";
import { surveyBranchingFixture } from "../../../contracts/test/support/survey-branching-fixture";
import {
  MemoryRepository,
  PostgresRepository,
  createSurveyRepository,
  type Repository,
  type SurveyRecord,
  type SurveyRoom,
  type SurveyVersion,
} from "../../src/index.js";
import { assistanceIdentity } from "./presentation-assistance-conformance.js";

export function branchingMemoryStore(repository: MemoryRepository) {
  return repository.getOrCreateLifecycleExtension("surveys", () => {
    throw new Error("Initialize the Survey repository before inspecting its synthetic store");
  }) as unknown as {
    surveys: Map<string, SurveyRecord>;
    survey_versions: Map<string, SurveyVersion>;
    survey_feedback_rooms: Map<string, SurveyRoom>;
    survey_guests: Map<string, Record<string, unknown>>;
    receipts: Map<string, { roomId: string; receipt: unknown }>;
  };
}

/** Trusted frozen-data fixture only. No production authoring method accepts a v4 document. */
export async function seedBranchingSurvey(repository: Repository) {
  const actor = await assistanceIdentity(repository);
  const surveys = createSurveyRepository(repository);
  const draft = surveyBranchingFixture();
  const now = new Date();
  const id = randomUUID();
  const version: SurveyVersion = {
    schemaVersion: 4,
    id: randomUUID(),
    workspaceId: actor.workspaceId,
    surveyId: id,
    content: draft,
    revision: 0,
  };
  const record: SurveyRecord = {
    schemaVersion: 4,
    id,
    workspaceId: actor.workspaceId,
    draft,
    revision: 0,
    status: "published",
    versionId: version.id,
    publishedRevision: 0,
    folderId: null,
  };
  const room: SurveyRoom = {
    schemaVersion: 4,
    id: randomUUID(),
    workspaceId: actor.workspaceId,
    surveyId: id,
    versionId: version.id,
    content: draft,
    code: String(randomInt(1_000_000, 10_000_000)),
    closesAt: new Date(now.getTime() + 3_600_000).toISOString(),
    expiresAt: new Date(now.getTime() + 86_400_000).toISOString(),
    closed: false,
    participantLimit: 20,
    identityPolicy: "organizer_blind",
  };
  if (repository instanceof MemoryRepository) {
    const store = branchingMemoryStore(repository);
    store.surveys.set(id, structuredClone(record));
    store.survey_versions.set(version.id, structuredClone(version));
    store.survey_feedback_rooms.set(room.id, structuredClone(room));
    await repository.claimLiveRoomCode({
      code: room.code,
      workspaceId: room.workspaceId,
      artifactType: "feedback_room",
      artifactId: room.id,
      createdAt: now,
      expiresAt: new Date(room.closesAt),
    });
  } else if (repository instanceof PostgresRepository) {
    const client = await repository.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.system_access','on',true)");
      await client.query("INSERT INTO surveys(id,workspace_id,data) VALUES($1,$2,$3)", [
        id,
        actor.workspaceId,
        record,
      ]);
      await client.query(
        "INSERT INTO survey_versions(id,workspace_id,survey_id,data) VALUES($1,$2,$3,$4)",
        [version.id, actor.workspaceId, id, version],
      );
      await client.query(
        "INSERT INTO survey_feedback_rooms(id,workspace_id,survey_id,version_id,code,closes_at,retention_expires_at,data) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
        [
          room.id,
          actor.workspaceId,
          id,
          version.id,
          room.code,
          room.closesAt,
          room.expiresAt,
          room,
        ],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  } else throw new Error("Unsupported synthetic Survey store");
  const [controller, followup, detail] = draft.items;
  if (controller!.question.type !== "poll" || followup!.question.type !== "poll")
    throw new Error("Expected synthetic single-choice controls");
  const opened = {
    [controller!.question.id]: {
      kind: "poll" as const,
      choiceIds: [controller!.question.choices[0]!.id],
    },
    [followup!.question.id]: {
      kind: "poll" as const,
      choiceIds: [followup!.question.choices[0]!.id],
    },
    [detail!.question.id]: { kind: "rating" as const, value: 4 },
  };
  const shut = {
    [controller!.question.id]: {
      kind: "poll" as const,
      choiceIds: [controller!.question.choices[1]!.id],
    },
  };
  return { actor, surveys, draft, id, record, version, room, now, opened, shut };
}

const credential = () => createHash("sha256").update(randomUUID()).digest("hex");

export async function expectBranchingReaderAndResponses(repository: Repository) {
  const f = await seedBranchingSurvey(repository);
  const token = credential();
  expect((await f.surveys.get(f.actor.workspaceId, f.id))?.draft).toEqual(f.draft);
  expect((await f.surveys.getRoom(f.room.id))?.content).toEqual(f.draft);
  for (const reader of [2, 3] as const) {
    await expect(f.surveys.admit(f.room.id, token, f.now, reader)).rejects.toMatchObject({
      code: "SURVEY_CLIENT_UPDATE_REQUIRED",
    });
    await expect(f.surveys.attempt(f.room.id, token, f.now, reader)).rejects.toMatchObject({
      code: "SURVEY_CLIENT_UPDATE_REQUIRED",
    });
  }
  const joined = await f.surveys.admit(f.room.id, token, f.now, 4);
  expect(joined).toMatchObject({
    schemaVersion: 4,
    responseSchemaVersion: 4,
    revision: 0,
    responses: {},
  });
  expect(await f.surveys.admit(f.room.id, token, f.now, 4)).toEqual(joined);
  const firstKey = randomUUID();
  const first = await f.surveys.respond(f.room.id, token, f.opened, 0, firstKey, false, f.now, 4);
  const second = await f.surveys.respond(
    f.room.id,
    token,
    f.shut,
    1,
    randomUUID(),
    false,
    f.now,
    4,
  );
  expect(second).toMatchObject({ revision: 2, responses: f.shut });
  expect(await f.surveys.respond(f.room.id, token, f.opened, 0, firstKey, false, f.now, 4)).toEqual(
    first,
  );
  expect(await f.surveys.attempt(f.room.id, token, f.now, 4)).toEqual(second);
  await expect(
    f.surveys.respond(f.room.id, token, f.opened, 1, randomUUID(), false, f.now, 4),
  ).rejects.toMatchObject({ code: "STALE_DRAFT" });
  await expect(
    f.surveys.respond(f.room.id, token, f.shut, 0, firstKey, false, f.now, 4),
  ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  for (const reader of [2, 3] as const)
    await expect(
      f.surveys.respond(f.room.id, token, f.opened, 0, firstKey, false, f.now, reader),
    ).rejects.toMatchObject({ code: "SURVEY_CLIENT_UPDATE_REQUIRED" });

  const followupId = f.draft.items[1]!.question.id;
  for (const responses of [
    { ...f.shut, [followupId]: f.opened[followupId] },
    { ...f.shut, [followupId]: { malformed: "PRIVATE_HIDDEN" } },
    { ...f.shut, [randomUUID()]: { malformed: "PRIVATE_UNKNOWN" } },
    { [f.draft.items[0]!.question.id]: { kind: "rating", value: 3 } },
    { ...f.opened, [f.draft.items[2]!.question.id]: { kind: "rating", value: 99 } },
    null,
    [],
  ]) {
    await expect(
      f.surveys.respond(f.room.id, token, responses, 2, randomUUID(), false, f.now, 4),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(await f.surveys.attempt(f.room.id, token, f.now, 4)).toEqual(second);
  }
  const reopened = { [f.draft.items[0]!.question.id]: f.opened[f.draft.items[0]!.question.id]! };
  const resumed = await f.surveys.respond(
    f.room.id,
    token,
    reopened,
    2,
    randomUUID(),
    false,
    f.now,
    4,
  );
  expect(resumed.responses).toEqual(reopened);
  await expect(
    f.surveys.respond(f.room.id, token, reopened, 3, randomUUID(), true, f.now, 4),
  ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  const finalKey = randomUUID();
  const final = await f.surveys.respond(f.room.id, token, f.shut, 3, finalKey, true, f.now, 4);
  expect(final).toMatchObject({ revision: 4, finalized: true, responses: f.shut });
  expect(final.receipt).toBeTruthy();
  await f.surveys.close(f.actor.workspaceId, f.room.id);
  expect(await f.surveys.respond(f.room.id, token, f.shut, 3, finalKey, true, f.now, 4)).toEqual(
    final,
  );
  expect(await f.surveys.attempt(f.room.id, token, f.now, 4)).toMatchObject({
    closed: true,
    finalized: true,
  });
  return f;
}

export async function expectBranchingReaderLegacyCompatibility(repository: Repository) {
  const actor = await assistanceIdentity(repository);
  const surveys = createSurveyRepository(repository);
  for (const schemaVersion of [1, 2, 3] as const) {
    const conditional = surveyBranchingFixture();
    const { pages, ...flat } = conditional;
    const draft = SurveyDraftSchema.parse({
      ...flat,
      schemaVersion,
      items: flat.items.map((item) => ({ ...item, required: false })),
      ...(schemaVersion === 3
        ? { pages: pages.map(({ visibleWhen: _condition, ...page }) => page) }
        : {}),
    });
    const id = randomUUID();
    const policy = { maximumSchemaVersion: 3 as const };
    await surveys.create(actor.workspaceId, id, draft, randomUUID(), policy);
    await surveys.publish(actor.workspaceId, id, 0, randomUUID(), null, policy);
    const now = new Date();
    const room = await surveys.createRoom(actor.workspaceId, id, 0, randomUUID(), {
      ...policy,
      code: String(randomInt(1_000_000, 10_000_000)),
      closesAt: new Date(now.getTime() + 3_600_000).toISOString(),
      expiresAt: new Date(now.getTime() + 86_400_000).toISOString(),
      participantLimit: 10,
      windowDays: 1,
    });
    const token = credential();
    expect(await surveys.admit(room.id, token, now, 4)).toMatchObject({
      schemaVersion,
      responseSchemaVersion: schemaVersion,
      content: draft,
    });
    const saved = await surveys.respond(room.id, token, {}, 0, randomUUID(), true, now, 4);
    expect(saved).toMatchObject({
      schemaVersion,
      responseSchemaVersion: schemaVersion,
      finalized: true,
    });
    expect(await surveys.attempt(room.id, token, now, 4)).toEqual(saved);
  }
}

export async function expectBranchingWriterAndResultsBoundary(repository: Repository) {
  const f = await seedBranchingSurvey(repository);
  const policy = { maximumSchemaVersion: 3 as const };
  // Exercise runtime checks even when a trusted internal caller circumvents static writer types.
  const proposed = f.draft as unknown as SurveyDraft;
  await expect(
    f.surveys.create(f.actor.workspaceId, randomUUID(), proposed, randomUUID(), policy),
  ).rejects.toMatchObject({ code: "SURVEY_BRANCHING_NOT_ENABLED" });
  await expect(
    f.surveys.save(f.actor.workspaceId, f.id, proposed, 0, randomUUID(), policy),
  ).rejects.toMatchObject({ code: "SURVEY_BRANCHING_NOT_ENABLED" });
  const flat = SurveyDraftSchema.parse({
    schemaVersion: 2,
    title: "Attempted downgrade",
    items: [],
  });
  await expect(
    f.surveys.save(f.actor.workspaceId, f.id, flat, 0, randomUUID(), policy),
  ).rejects.toMatchObject({ code: "SURVEY_BRANCHING_NOT_ENABLED" });
  await expect(
    f.surveys.publish(f.actor.workspaceId, f.id, 0, randomUUID(), null, policy),
  ).rejects.toMatchObject({ code: "SURVEY_BRANCHING_NOT_ENABLED" });
  await expect(
    f.surveys.createRoom(f.actor.workspaceId, f.id, 0, randomUUID(), {
      ...policy,
      code: String(randomInt(1_000_000, 10_000_000)),
      closesAt: f.room.closesAt,
      expiresAt: f.room.expiresAt,
      participantLimit: 10,
      windowDays: 1,
    }),
  ).rejects.toMatchObject({ code: "SURVEY_BRANCHING_NOT_ENABLED" });
  const roomBefore = await f.surveys.getRoom(f.room.id);
  await expect(
    f.surveys.results(f.actor.workspaceId, f.room.id, new Date(f.room.closesAt)),
  ).rejects.toMatchObject({ code: "SURVEY_BRANCHING_RESULTS_NOT_AVAILABLE" });
  expect(await f.surveys.getRoom(f.room.id)).toEqual(roomBefore);
  expect((await f.surveys.get(f.actor.workspaceId, f.id))?.draft).toEqual(f.draft);
  return f;
}

export async function expectBranchingLifecycle(
  repository: Repository,
  mode: "room" | "expiry" | "account",
) {
  const f = await seedBranchingSurvey(repository);
  const token = credential();
  await f.surveys.admit(f.room.id, token, f.now, 4);
  const final = await f.surveys.respond(f.room.id, token, f.shut, 0, randomUUID(), true, f.now, 4);
  const exported = JSON.stringify(await repository.exportAccount(f.actor.userId));
  expect(exported).toContain(f.draft.title);
  expect(exported).not.toContain(token);
  expect(exported).not.toContain(final.receipt!);
  expect(exported).not.toContain('"responses"');
  if (mode === "room") await f.surveys.deleteRoom(f.actor.workspaceId, f.room.id);
  else if (mode === "expiry")
    await repository.purgeExpired(new Date(Date.parse(f.room.expiresAt) + 1));
  else await repository.deleteAccount(f.actor.userId);
  expect(await f.surveys.getRoom(f.room.id)).toBeNull();
  expect(await repository.getLiveRoomCode(f.room.code, f.now)).toBeNull();
  await expect(f.surveys.attempt(f.room.id, token, f.now, 4)).rejects.toMatchObject({
    code: "NOT_FOUND",
  });
  return f;
}
