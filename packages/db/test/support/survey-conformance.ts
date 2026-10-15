import { createHash, randomInt, randomUUID } from "node:crypto";
import { expect } from "vitest";
import { SurveyDraftSchema } from "@openround/contracts/surveys";
import { createSurveyRepository, type Repository } from "../../src/index.js";

export function surveyFixture() {
  return SurveyDraftSchema.parse({
    schemaVersion: 1,
    title: "Workshop feedback",
    items: [
      {
        required: true,
        question: {
          id: randomUUID(),
          type: "poll",
          prompt: "What would help next?",
          purpose: "opinion",
          confidence: "off",
          delivery: "main",
          choices: ["Practice", "Examples"].map((label) => ({
            id: randomUUID(),
            label,
            isCorrect: false,
          })),
          timeLimitSeconds: 30,
          basePoints: 0,
          explanation: "",
          mediaId: null,
          mediaAlt: null,
        },
      },
      {
        required: false,
        question: {
          id: randomUUID(),
          type: "rating",
          prompt: "How useful was this?",
          purpose: "opinion",
          confidence: "off",
          delivery: "main",
          min: 1,
          max: 5,
          minLabel: "Not useful",
          maxLabel: "Very useful",
          timeLimitSeconds: 30,
          basePoints: 0,
          explanation: "",
          mediaId: null,
          mediaAlt: null,
        },
      },
    ],
  });
}
export async function expectSurveyPasswordConformance(repository: Repository, workspaceId: string) {
  const surveys = createSurveyRepository(repository);
  const id = randomUUID();
  const now = new Date();
  const creationKey = randomUUID();
  await surveys.create(workspaceId, id, surveyFixture(), creationKey);
  expect(await surveys.getRoomCreation(workspaceId, id, creationKey)).toBeNull();
  await surveys.publish(workspaceId, id, 0, randomUUID(), 5);
  const settings = {
    code: String(randomInt(1000000, 10000000)),
    closesAt: new Date(now.getTime() + 86400000).toISOString(),
    expiresAt: new Date(now.getTime() + 30 * 86400000).toISOString(),
    participantLimit: 20,
    windowDays: 1,
  };
  const protectedKey = randomUUID();
  const protectedSettings = { ...settings, joinPasswordHash: "stable-salted-verifier" };
  const protectedRoom = await surveys.createRoom(
    workspaceId,
    id,
    0,
    protectedKey,
    protectedSettings,
  );
  expect(await surveys.getRoomCreation(workspaceId, id, protectedKey)).toEqual(protectedRoom);
  expect(await surveys.getRoomCreation(randomUUID(), id, protectedKey)).toBeNull();
  expect(await surveys.getRoomCreation(workspaceId, randomUUID(), protectedKey)).toBeNull();
  expect(await surveys.getRoomCreation(workspaceId, id, randomUUID())).toBeNull();
  expect(await surveys.getRoom(protectedRoom.id)).toMatchObject({
    joinPasswordHash: protectedSettings.joinPasswordHash,
  });
  expect(
    (await surveys.listRooms(workspaceId)).find((room) => room.id === protectedRoom.id),
  ).toMatchObject({ joinPasswordHash: protectedSettings.joinPasswordHash });
  expect(protectedRoom.content).not.toHaveProperty("joinPasswordHash");
  expect(
    await surveys.createRoom(workspaceId, id, 0, protectedKey, {
      ...protectedSettings,
      code: String(randomInt(1000000, 10000000)),
      replayOnly: true,
    }),
  ).toEqual(protectedRoom);
  for (const joinPasswordHash of [null, undefined, "different-salted-verifier"])
    await expect(
      surveys.createRoom(workspaceId, id, 0, protectedKey, { ...settings, joinPasswordHash }),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  await surveys.close(workspaceId, protectedRoom.id);
  expect(await surveys.getRoom(protectedRoom.id)).toMatchObject({
    closed: true,
    joinPasswordHash: protectedSettings.joinPasswordHash,
  });
  expect(await surveys.getRoomCreation(workspaceId, id, protectedKey)).toMatchObject({
    id: protectedRoom.id,
    closed: true,
    joinPasswordHash: protectedSettings.joinPasswordHash,
  });

  const openKey = randomUUID();
  const openRoom = await surveys.createRoom(workspaceId, id, 0, openKey, {
    ...settings,
    code: String(randomInt(1000000, 10000000)),
  });
  expect(openRoom.joinPasswordHash ?? null).toBeNull();
  expect(await surveys.getRoomCreation(workspaceId, id, openKey)).toEqual(openRoom);
  // Null defaults must retain the exact legacy request fingerprint.
  expect(
    await surveys.createRoom(workspaceId, id, 0, openKey, { ...settings, joinPasswordHash: null }),
  ).toEqual(openRoom);
  await expect(
    surveys.createRoom(workspaceId, id, 0, openKey, protectedSettings),
  ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  const deletedKey = randomUUID();
  const deletedSettings = {
    ...protectedSettings,
    code: String(randomInt(1000000, 10000000)),
  };
  const deletedRoom = await surveys.createRoom(workspaceId, id, 0, deletedKey, deletedSettings);
  await surveys.deleteRoom(workspaceId, deletedRoom.id);
  expect(await surveys.getRoomCreation(workspaceId, id, deletedKey)).toBeNull();
  await expect(
    surveys.createRoom(workspaceId, id, 0, deletedKey, { ...deletedSettings, replayOnly: true }),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  expect(await surveys.getRoomCreation(workspaceId, id, deletedKey)).toBeNull();
  expect(await repository.getLiveRoomCode(deletedSettings.code)).toBeNull();
  return { protectedRoom, openRoom };
}

export async function expectSurveyCreationUpgradeConformance(
  repository: Repository,
  workspaceId: string,
) {
  const surveys = createSurveyRepository(repository);
  const id = randomUUID();
  const key = randomUUID();
  const legacyDraft = surveyFixture();
  const original = await surveys.create(workspaceId, id, legacyDraft, key);
  const upgradedDraft = { ...legacyDraft, schemaVersion: 2 as const };
  expect(await surveys.create(workspaceId, id, upgradedDraft, key)).toEqual(original);

  const changedDrafts = [
    { ...upgradedDraft, title: "Changed title" },
    { ...upgradedDraft, description: "Changed description" },
    {
      ...upgradedDraft,
      items: upgradedDraft.items.map((item) => ({ ...item, required: !item.required })),
    },
    {
      ...upgradedDraft,
      items: upgradedDraft.items.map((item) =>
        item.question.type === "poll"
          ? { ...item, question: { ...item.question, maxSelections: 2 } }
          : item,
      ),
    },
  ];
  for (const changed of changedDrafts)
    await expect(surveys.create(workspaceId, id, changed, key)).rejects.toMatchObject({
      code: "IDEMPOTENCY_CONFLICT",
    });
  await expect(surveys.save(workspaceId, id, upgradedDraft, 0, key)).rejects.toMatchObject({
    code: "IDEMPOTENCY_CONFLICT",
  });

  const saved = await surveys.save(workspaceId, id, upgradedDraft, 0, randomUUID());
  expect(saved.schemaVersion).toBe(2);
  const retries = await Promise.all([
    surveys.create(workspaceId, id, upgradedDraft, key),
    surveys.create(workspaceId, id, legacyDraft, key),
  ]);
  expect(retries).toEqual([original, original]);
  expect(await surveys.get(workspaceId, id)).toEqual(saved);
  expect(await surveys.get(randomUUID(), id)).toBeNull();

  const newId = randomUUID();
  const newKey = randomUUID();
  const current = await surveys.create(workspaceId, newId, upgradedDraft, newKey);
  expect(current.schemaVersion).toBe(2);
  expect(await surveys.create(workspaceId, newId, upgradedDraft, newKey)).toEqual(current);
  await expect(surveys.create(workspaceId, newId, legacyDraft, newKey)).rejects.toMatchObject({
    code: "IDEMPOTENCY_CONFLICT",
  });
}
export async function expectSurveyConformance(
  repository: Repository,
  workspaceId: string,
  schemaVersion: 1 | 2 = 1,
) {
  const surveys = createSurveyRepository(repository);
  const id = randomUUID();
  const now = new Date();
  const draft = surveyFixture();
  draft.schemaVersion = schemaVersion;
  if (schemaVersion === 2 && draft.items[0]!.question.type === "poll")
    draft.items[0]!.question.maxSelections = 2;
  const key = randomUUID();
  const original = await surveys.create(workspaceId, id, draft, key);
  expect(await surveys.create(workspaceId, id, draft, key)).toEqual(original);
  await expect(
    surveys.create(workspaceId, id, { ...draft, title: "changed" }, key),
  ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  expect(await surveys.get(randomUUID(), id)).toBeNull();
  const saved = await surveys.save(
    workspaceId,
    id,
    { ...draft, title: "Feedback v1" },
    0,
    randomUUID(),
  );
  await expect(surveys.save(workspaceId, id, draft, 0, randomUUID())).rejects.toMatchObject({
    code: "STALE_DRAFT",
  });
  await surveys.publish(workspaceId, id, saved.revision, randomUUID(), 5);
  const settings = {
    code: String(randomInt(1000000, 10000000)),
    closesAt: new Date(now.getTime() + 86400000).toISOString(),
    expiresAt: new Date(now.getTime() + 30 * 86400000).toISOString(),
    participantLimit: 20,
    windowDays: 1,
  };
  const roomKey = randomUUID();
  for (const expiresAt of [settings.closesAt, new Date(now.getTime()).toISOString(), "invalid"]) {
    await expect(
      surveys.createRoom(workspaceId, id, saved.revision, randomUUID(), {
        ...settings,
        expiresAt,
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  }
  const room = await surveys.createRoom(workspaceId, id, saved.revision, roomKey, settings);
  expect(room.schemaVersion).toBe(schemaVersion);
  expect(room.content.schemaVersion).toBe(schemaVersion);
  expect(
    await surveys.createRoom(workspaceId, id, saved.revision, roomKey, {
      ...settings,
      code: String(randomInt(1000000, 10000000)),
      participantLimit: 100,
      expiresAt: new Date(now.getTime() + 365 * 86400000).toISOString(),
    }),
  ).toEqual(room);
  await expect(
    surveys.createRoom(workspaceId, id, saved.revision, roomKey, {
      ...settings,
      windowDays: 2,
    }),
  ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  expect(await repository.getLiveRoomCode(room.code, now)).toMatchObject({
    artifactType: "feedback_room",
    artifactId: room.id,
  });
  const updated = await surveys.save(
    workspaceId,
    id,
    {
      ...draft,
      schemaVersion: 2,
      title: "Feedback v2",
      items: draft.items.map((item) =>
        item.question.type === "poll"
          ? { ...item, question: { ...item.question, maxSelections: 2 } }
          : item,
      ),
    },
    saved.revision,
    randomUUID(),
  );
  await surveys.publish(workspaceId, id, updated.revision, randomUUID(), 5);
  expect(updated.schemaVersion).toBe(2);
  expect((await surveys.getRoom(room.id))?.schemaVersion).toBe(schemaVersion);
  expect((await surveys.getRoom(room.id))?.content.items[0]!.question.maxSelections).toBe(
    schemaVersion === 2 ? 2 : undefined,
  );
  expect((await surveys.getRoom(room.id))?.content.title).toBe("Feedback v1");
  const question = draft.items[0]!.question;
  if (question.type !== "poll") throw new Error("Expected poll");
  const responses = {
    [question.id]: {
      kind: "poll" as const,
      choiceIds:
        schemaVersion === 2
          ? question.choices.map((choice) => choice.id).sort()
          : [question.choices[0]!.id],
    },
  };
  const tokenHash = createHash("sha256").update(randomUUID()).digest("hex");
  const admitted = await Promise.all([
    surveys.admit(room.id, tokenHash, now),
    surveys.admit(room.id, tokenHash, now),
  ]);
  expect(admitted[0]).toEqual(admitted[1]);
  await expect(surveys.attempt(room.id, "wrong", now)).rejects.toMatchObject({
    code: "UNAUTHORIZED",
  });
  const progressKey = randomUUID();
  const progress = await surveys.respond(room.id, tokenHash, responses, 0, progressKey, false, now);
  expect(await surveys.respond(room.id, tokenHash, responses, 0, progressKey, false, now)).toEqual(
    progress,
  );
  expect((await surveys.results(workspaceId, room.id, now)).submittedCount).toBe(0);
  await expect(
    surveys.respond(room.id, tokenHash, {}, 1, randomUUID(), true, now),
  ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  const submitKey = randomUUID();
  const completed = await surveys.respond(room.id, tokenHash, responses, 1, submitKey, true, now);
  expect(completed.responseSchemaVersion).toBe(schemaVersion);
  if (schemaVersion === 2) {
    expect(
      await surveys.respond(
        room.id,
        tokenHash,
        {
          [question.id]: {
            kind: "poll",
            choiceIds: [...responses[question.id]!.choiceIds].reverse(),
          },
        },
        1,
        submitKey,
        true,
        now,
      ),
    ).toEqual(completed);
  }
  expect(completed.finalized).toBe(true);
  expect(completed.receipt).toBeTruthy();
  expect(
    await surveys.respond(
      room.id,
      tokenHash,
      responses,
      1,
      submitKey,
      true,
      new Date(settings.closesAt),
    ),
  ).toEqual(completed);
  await expect(
    surveys.respond(room.id, tokenHash, responses, 2, randomUUID(), true, now),
  ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  expect(
    (await surveys.results(workspaceId, room.id, now)).questions.every(
      (q) => q.distribution.length === 0,
    ),
  ).toBe(true);
  for (let i = 0; i < 4; i++) {
    const token = createHash("sha256").update(randomUUID()).digest("hex");
    await surveys.admit(room.id, token, now);
    await surveys.respond(room.id, token, responses, 0, randomUUID(), true, now);
  }
  const liveResults = await surveys.results(workspaceId, room.id, now);
  expect(liveResults).toMatchObject({
    suppressed: true,
    resultsStatus: "collecting",
    submittedCount: 5,
  });
  expect(
    liveResults.questions.every((q) => q.answeredCount === null && q.distribution.length === 0),
  ).toBe(true);
  const sixthToken = createHash("sha256").update(randomUUID()).digest("hex");
  await surveys.admit(room.id, sixthToken, now);
  await surveys.respond(
    room.id,
    sixthToken,
    {
      [question.id]: { kind: "poll", choiceIds: [question.choices[1]!.id] },
    },
    0,
    randomUUID(),
    true,
    now,
  );
  const sixthResults = await surveys.results(workspaceId, room.id, now);
  expect(sixthResults).toMatchObject({
    suppressed: true,
    resultsStatus: "collecting",
    submittedCount: 6,
  });
  expect(sixthResults.questions).toEqual(liveResults.questions);
  await surveys.close(workspaceId, room.id);
  const results = await surveys.results(workspaceId, room.id, now);
  expect(results).toMatchObject({
    suppressed: false,
    resultsStatus: "available",
    submittedCount: 6,
  });
  expect(results.questions[0]!.distribution[0]!.count).toBe(5);
  expect(results.questions[0]!.distribution[1]!.count).toBe(schemaVersion === 2 ? 6 : 1);
  expect(results.questions[1]).toMatchObject({
    suppressed: true,
    answeredCount: null,
    distribution: [],
  });
  expect(await surveys.respond(room.id, tokenHash, responses, 1, submitKey, true, now)).toEqual(
    completed,
  );
  expect(await surveys.results(workspaceId, room.id, now)).toEqual(results);
  expect(JSON.stringify(results)).not.toMatch(
    /tokenHash|receipt|workspaceId|responses|guestId|submittedAt/,
  );
  await expect(surveys.results(randomUUID(), room.id, now)).rejects.toMatchObject({
    code: "NOT_FOUND",
  });
  const exported = JSON.stringify(
    await repository.exportAccount((await repository.listWorkspaceMembers(workspaceId))[0]!.userId),
  );
  expect(exported).not.toContain(tokenHash);
  expect(exported).not.toContain(completed.receipt!);
  await expect(
    surveys.admit(room.id, createHash("sha256").update(randomUUID()).digest("hex"), now),
  ).rejects.toMatchObject({ code: "ROOM_CLOSED" });
  expect((await surveys.attempt(room.id, tokenHash, now)).finalized).toBe(true);
  await surveys.deleteRoom(workspaceId, room.id);
  expect(await repository.getLiveRoomCode(room.code, now)).toBeNull();
  await expect(surveys.attempt(room.id, tokenHash, now)).rejects.toMatchObject({
    code: "NOT_FOUND",
  });
  // Deletion removes the creation receipt too; a reused key must not return the deleted room.
  const replacement = await surveys.createRoom(
    workspaceId,
    id,
    updated.revision,
    roomKey,
    settings,
  );
  expect(replacement.id).not.toBe(room.id);
  expect(await surveys.getRoom(replacement.id)).not.toBeNull();
  await surveys.deleteRoom(workspaceId, replacement.id);

  const now2 = new Date();
  const expiringKey = randomUUID();
  const expiringSettings = {
    ...settings,
    code: String(randomInt(1000000, 10000000)),
    closesAt: new Date(now2.getTime() + 5000).toISOString(),
    expiresAt: new Date(now2.getTime() + 6000).toISOString(),
  };
  const expiring = await surveys.createRoom(
    workspaceId,
    id,
    updated.revision,
    expiringKey,
    expiringSettings,
  );
  for (let i = 0; i < 5; i++) {
    const token = createHash("sha256").update(randomUUID()).digest("hex");
    await surveys.admit(expiring.id, token, now2);
    await surveys.respond(expiring.id, token, responses, 0, randomUUID(), true, now2);
  }
  expect(
    (await surveys.results(workspaceId, expiring.id, new Date(now2.getTime() + 4999)))
      .resultsStatus,
  ).toBe("collecting");
  expect(
    (await surveys.results(workspaceId, expiring.id, new Date(expiring.closesAt))).resultsStatus,
  ).toBe("available");
  await expect(
    surveys.admit(expiring.id, randomUUID(), new Date(expiring.closesAt)),
  ).rejects.toMatchObject({ code: "ROOM_CLOSED" });
  await repository.purgeExpired(new Date(now2.getTime() + 6001));
  expect(await surveys.getRoom(expiring.id)).toBeNull();
  const newRun = await surveys.createRoom(
    workspaceId,
    id,
    updated.revision,
    expiringKey,
    expiringSettings,
  );
  expect(newRun.id).not.toBe(expiring.id);
  await surveys.deleteRoom(workspaceId, newRun.id);
}
