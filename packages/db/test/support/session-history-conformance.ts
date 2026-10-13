import { randomInt, randomUUID } from "node:crypto";
import { expect } from "vitest";
import { createGameState } from "@openround/game-engine";
import type { QuizDraft } from "@openround/contracts";
import {
  createPresentationRepository,
  createPresentationSessionRepository,
  createSurveyRepository,
  type CreatorContext,
  type Repository,
} from "../../src/index.js";
import { presentationSessionConformanceContent } from "./presentation-session-conformance.js";
import { surveyFixture } from "./survey-conformance.js";

/** Shared tenant, retention, search, and count checks for both storage implementations. */
export async function expectSessionHistoryConformance(
  repository: Repository,
  owner: CreatorContext,
  outsider: CreatorContext,
) {
  const now = new Date();
  const retentionExpiresAt = new Date(now.getTime() + 86_400_000);
  let nextCode = randomInt(1_000_000, 9_000_000);
  const code = () => String(nextCode++);
  const content: QuizDraft = {
    title: "Library source",
    description: "",
    questions: [
      {
        id: randomUUID(),
        type: "numeric",
        prompt: "How many?",
        correctValue: "2",
        tolerance: "0",
        unit: null,
        timeLimitSeconds: 30,
        basePoints: 1_000,
        explanation: "Two",
        mediaId: null,
        mediaAlt: null,
      },
    ],
  };
  await expect(repository.getSessionCounts(owner.workspaceId)).resolves.toEqual({
    rounds: 0,
    presentations: 0,
    surveys: 0,
  });

  async function seed(actor: CreatorContext, roundCount: number, otherCount: number) {
    const quizId = randomUUID();
    await repository.createQuiz({
      id: quizId,
      workspaceId: actor.workspaceId,
      title: content.title,
      description: "",
      status: "draft",
      draft: content,
      currentVersionId: null,
      createdAt: now,
      updatedAt: now,
    });
    const version = await repository.publishQuiz({
      id: randomUUID(),
      workspaceId: actor.workspaceId,
      quizId,
      version: 1,
      content,
      contentHash: randomUUID(),
      publishedAt: now,
    });
    const rounds = [];
    for (let index = 0; index < roundCount; index += 1) {
      const id = randomUUID();
      const createdAt = new Date(now.getTime() - (roundCount - index) * 1_000);
      const state = createGameState({
        sessionId: id,
        code: code(),
        quiz: {
          ...content,
          title:
            index === 0
              ? "Frozen needle 50%_ room"
              : index === 1
                ? "Frozen NEEDLE second"
                : "Recent room",
        },
        settings: {
          audienceLimit: 20,
          scoringMode: "accuracy",
          resultVisibility: "private",
          allowLateJoin: true,
          nicknamePolicy: "friendly_only",
        },
      });
      const session = {
        id,
        workspaceId: actor.workspaceId,
        quizVersionId: version.id,
        hostId: actor.userId,
        hostTokenHash: randomUUID(),
        state,
        expiresAt: new Date(now.getTime() + (index === 0 ? -1 : 60_000)),
        retentionExpiresAt,
        createdAt,
        updatedAt: createdAt,
      };
      await repository.createSession(session);
      rounds.push(session);
    }

    const presentations = createPresentationRepository(repository);
    const presentationSessions = createPresentationSessionRepository(repository);
    const presentationContent = presentationSessionConformanceContent();
    const presentation = await presentations.createPresentation({
      id: randomUUID(),
      workspaceId: actor.workspaceId,
      title: presentationContent.title,
      description: presentationContent.description,
      status: "draft",
      draft: presentationContent,
      draftRevision: 0,
      draftSchemaVersion: 2,
      currentVersionId: null,
      folderId: null,
      publishedDraftRevision: null,
      lastEditedBy: actor.userId,
      createdAt: now,
      updatedAt: now,
    });
    const presentationVersion = await presentations.publishPresentation(
      {
        id: randomUUID(),
        workspaceId: actor.workspaceId,
        presentationId: presentation.id,
        version: 1,
        content: presentationContent,
        contentHash: randomUUID(),
        sourceDraftRevision: 0,
        publishedAt: now,
      },
      0,
    );
    const presentationRooms = [];
    for (let index = 0; index < otherCount; index += 1) {
      presentationRooms.push(
        await presentationSessions.createSession({
          id: randomUUID(),
          workspaceId: actor.workspaceId,
          presentationId: presentation.id,
          presentationVersionId: presentationVersion.id,
          title: presentationContent.title,
          content: presentationContent,
          code: code(),
          status: index === 0 ? "active" : "finished",
          phase: index === 0 ? "lobby" : "finished",
          currentBlockIndex: -1,
          revision: 0,
          eventSeq: 0,
          settings: { timeMode: "flex" },
          trustMode: "learning",
          questionOpenedAt: null,
          questionClosesAt: null,
          createdBy: actor.userId,
          createdAt: now,
          updatedAt: now,
          finishedAt: index === 0 ? null : now,
          liveExpiresAt: new Date(now.getTime() - 1),
          retentionExpiresAt,
        }),
      );
    }

    const surveys = createSurveyRepository(repository);
    const survey = await surveys.create(
      actor.workspaceId,
      randomUUID(),
      surveyFixture(),
      randomUUID(),
    );
    await surveys.publish(actor.workspaceId, survey.id, 0, randomUUID(), null);
    const surveyRooms = [];
    for (let index = 0; index < otherCount; index += 1) {
      const room = await surveys.createRoom(actor.workspaceId, survey.id, 0, randomUUID(), {
        code: code(),
        closesAt: new Date(now.getTime() + 60_000).toISOString(),
        expiresAt: retentionExpiresAt.toISOString(),
        participantLimit: 20,
        windowDays: 1,
      });
      if (index === 0) await surveys.close(actor.workspaceId, room.id);
      surveyRooms.push(room);
    }
    return { quizId, rounds, presentationRooms, surveyRooms };
  }

  const owned = await seed(owner, 28, 2);
  const foreign = await seed(outsider, 1, 1);
  await expect(repository.getSessionCounts(owner.workspaceId)).resolves.toEqual({
    rounds: 28,
    presentations: 2,
    surveys: 2,
  });
  await expect(repository.getSessionCounts(outsider.workspaceId)).resolves.toEqual({
    rounds: 1,
    presentations: 1,
    surveys: 1,
  });
  await expect(
    repository.getSessionCounts(owner.workspaceId, { includePresentations: false }),
  ).resolves.toEqual({ rounds: 28, presentations: 0, surveys: 2 });

  const recent = await repository.listSessionHistory(owner.workspaceId, { limit: 25, now });
  expect(recent.items).toHaveLength(25);
  expect(recent.hasMore).toBe(true);
  expect(recent.items.some((item) => item.title.toLowerCase().includes("needle"))).toBe(false);
  await repository.updateQuiz(owner.workspaceId, owned.quizId, {
    ...content,
    title: "Renamed source",
  });
  const first = await repository.listSessionHistory(owner.workspaceId, {
    limit: 1,
    now,
    search: "  NeEdLe  ",
  });
  expect(first.items.map(({ id }) => id)).toEqual([owned.rounds[1]!.id]);
  expect(first.hasMore).toBe(true);
  const anchor = first.items[0]!;
  const second = await repository.listSessionHistory(owner.workspaceId, {
    limit: 1,
    now,
    search: "needle",
    cursor: { createdAt: anchor.createdAt, cursorCreatedAt: anchor.cursorCreatedAt, id: anchor.id },
  });
  expect(second.items.map(({ id }) => id)).toEqual([owned.rounds[0]!.id]);
  expect(second.hasMore).toBe(false);
  for (const search of ["%_", owned.rounds[0]!.state.code]) {
    const page = await repository.listSessionHistory(owner.workspaceId, { limit: 25, now, search });
    expect(page.items.map(({ id }) => id)).toEqual([owned.rounds[0]!.id]);
  }
  for (const options of [{ quizId: foreign.quizId }, { from: now }, { search: "Renamed source" }]) {
    expect(
      (
        await repository.listSessionHistory(owner.workspaceId, {
          limit: 25,
          now,
          search: "needle",
          ...options,
        })
      ).items,
    ).toEqual([]);
  }
  expect(
    (
      await repository.listSessionHistory(owner.workspaceId, {
        limit: 25,
        now,
        search: "needle",
        status: "expired",
      })
    ).items.map(({ id }) => id),
  ).toEqual([owned.rounds[0]!.id]);

  await expect(repository.deleteSession(outsider.workspaceId, owned.rounds[0]!.id)).resolves.toBe(
    false,
  );
  await expect(
    createPresentationSessionRepository(repository).deleteSession(
      outsider.workspaceId,
      owned.presentationRooms[0]!.id,
      now,
    ),
  ).resolves.toEqual({ status: "not_found" });
  await expect(
    createSurveyRepository(repository).deleteRoom(outsider.workspaceId, owned.surveyRooms[0]!.id),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  await expect(repository.getSessionCounts(owner.workspaceId)).resolves.toEqual({
    rounds: 28,
    presentations: 2,
    surveys: 2,
  });
  await repository.deleteSession(owner.workspaceId, owned.rounds[0]!.id);
  await createPresentationSessionRepository(repository).deleteSession(
    owner.workspaceId,
    owned.presentationRooms[0]!.id,
    now,
  );
  await createSurveyRepository(repository).deleteRoom(owner.workspaceId, owned.surveyRooms[0]!.id);
  await expect(repository.getSessionCounts(owner.workspaceId)).resolves.toEqual({
    rounds: 27,
    presentations: 1,
    surveys: 1,
  });
  await expect(repository.getSessionCounts(outsider.workspaceId)).resolves.toEqual({
    rounds: 1,
    presentations: 1,
    surveys: 1,
  });
  expect(
    (await repository.listSessionHistory(owner.workspaceId, { limit: 25, now, search: "%_" }))
      .items,
  ).toEqual([]);
}
