import { randomUUID } from "node:crypto";
import { expect } from "vitest";
import type {
  CreatorContext,
  QuizRecord,
  Repository,
  RoundImportIdentity,
} from "../../src/index.js";
import { assistanceIdentity } from "./presentation-assistance-conformance.js";
import { summaryMember } from "./session-summary-conformance.js";

export async function roundImportFixture(repository: Repository) {
  const actor = await assistanceIdentity(repository);
  const idempotencyKey = randomUUID();
  const identity = (creator = actor): RoundImportIdentity => ({
    actorId: creator.userId,
    workspaceId: creator.workspaceId,
    idempotencyKey,
    requestHash: "a".repeat(64),
  });
  const record = (creator = actor): QuizRecord => {
    const now = new Date();
    return {
      id: randomUUID(),
      workspaceId: creator.workspaceId,
      title: "Imported Round",
      description: "",
      status: "draft",
      draft: { title: "Imported Round", description: "", questions: [] },
      draftSchemaVersion: 1,
      draftRevision: 0,
      lastEditedBy: creator.userId,
      currentVersionId: null,
      createdAt: now,
      updatedAt: now,
    };
  };
  return { repository, actor, identity, record, idempotencyKey };
}

export async function expectRoundImportRecovery(repository: Repository) {
  const f = await roundImportFixture(repository);
  const results = await Promise.all(
    Array.from({ length: 6 }, () => repository.createImportedQuiz(f.record(), f.identity())),
  );
  expect(results.filter(({ status }) => status === "created")).toHaveLength(1);
  expect(new Set(results.map(({ quiz }) => quiz.id)).size).toBe(1);
  const quiz = results[0]!.quiz;
  expect(await repository.listQuizDraftHistory(f.actor.workspaceId, quiz.id, 20)).toHaveLength(1);
  const updated = await repository.updateQuizDraft({
    workspaceId: f.actor.workspaceId,
    quizId: quiz.id,
    expectedRevision: 0,
    mutationId: randomUUID(),
    editorId: f.actor.userId,
    schemaVersion: 1,
    draftHash: "b".repeat(64),
    draft: { ...quiz.draft, title: "Reviewed after acknowledgement loss" },
  });
  expect(await repository.getImportedQuiz(f.identity())).toMatchObject({
    id: quiz.id,
    draftRevision: 1,
    draft: { title: updated!.draft.title },
  });
  expect(await repository.createImportedQuiz(f.record(), f.identity())).toMatchObject({
    status: "duplicate",
    quiz: { id: quiz.id, draftRevision: 1 },
  });
  await expect(
    repository.getImportedQuiz({ ...f.identity(), requestHash: "b".repeat(64) }),
  ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  await expect(
    repository.createImportedQuiz(f.record(), { ...f.identity(), requestHash: "b".repeat(64) }),
  ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  expect(await repository.listQuizzes(f.actor.workspaceId)).toHaveLength(1);
  return { ...f, quiz };
}

export async function expectRoundImportAuthority(repository: Repository) {
  const f = await roundImportFixture(repository);
  const member = await assistanceIdentity(repository),
    outsider = await assistanceIdentity(repository);
  await summaryMember(repository, f.actor, member, "editor");
  const editor: CreatorContext = { ...member, workspaceId: f.actor.workspaceId, role: "editor" };
  const original = await repository.createImportedQuiz(f.record(), f.identity());
  const second = await repository.createImportedQuiz(f.record(editor), f.identity(editor));
  const otherWorkspace = await repository.createImportedQuiz(
    f.record(outsider),
    f.identity(outsider),
  );
  await summaryMember(repository, outsider, f.actor, "editor");
  const sameActorElsewhere: CreatorContext = {
    ...f.actor,
    workspaceId: outsider.workspaceId,
    role: "editor",
  };
  const acrossWorkspace = await repository.createImportedQuiz(
    f.record(sameActorElsewhere),
    f.identity(sameActorElsewhere),
  );
  expect(
    new Set([original.quiz.id, second.quiz.id, otherWorkspace.quiz.id, acrossWorkspace.quiz.id])
      .size,
  ).toBe(4);
  await repository.updateWorkspaceMemberRole(f.actor.workspaceId, member.userId, "viewer");
  expect(await repository.getImportedQuiz(f.identity(editor))).toMatchObject({
    id: second.quiz.id,
  });
  expect(await repository.createImportedQuiz(f.record(editor), f.identity(editor))).toMatchObject({
    status: "duplicate",
    quiz: { id: second.quiz.id },
  });
  await expect(
    repository.createImportedQuiz(f.record(editor), {
      ...f.identity(editor),
      idempotencyKey: randomUUID(),
    }),
  ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  await repository.removeWorkspaceMember(f.actor.workspaceId, member.userId);
  await expect(repository.getImportedQuiz(f.identity(editor))).rejects.toMatchObject({
    code: "UNAUTHORIZED",
  });
  await repository.deleteAccount(member.userId);
  await expect(repository.getImportedQuiz(f.identity(editor))).rejects.toMatchObject({
    code: "UNAUTHORIZED",
  });
  expect(await repository.getImportedQuiz(f.identity())).toMatchObject({ id: original.quiz.id });
  return { ...f, editor, editorQuiz: second.quiz };
}

export async function expectRoundImportDeletion(repository: Repository) {
  const f = await roundImportFixture(repository);
  const { quiz } = await repository.createImportedQuiz(f.record(), f.identity());
  await repository.archiveQuiz(f.actor.workspaceId, quiz.id, true);
  await expect(repository.getImportedQuiz(f.identity())).rejects.toMatchObject({
    code: "IMPORT_TARGET_UNAVAILABLE",
  });
  await expect(repository.createImportedQuiz(f.record(), f.identity())).rejects.toMatchObject({
    code: "IMPORT_TARGET_UNAVAILABLE",
  });
  expect(await repository.deleteQuiz(f.actor.workspaceId, quiz.id)).toBe("deleted");
  await expect(repository.createImportedQuiz(f.record(), f.identity())).rejects.toMatchObject({
    code: "IMPORT_TARGET_UNAVAILABLE",
  });
  expect(await repository.listQuizzes(f.actor.workspaceId, true)).toEqual([]);
  expect(await repository.listQuizDraftHistory(f.actor.workspaceId, quiz.id, 20)).toEqual([]);
  return { ...f, quiz };
}
