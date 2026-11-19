import { randomUUID } from "node:crypto";
import { expect } from "vitest";
import type {
  CreatorContext,
  QuizRecord,
  Repository,
  StarterCopyIdentity,
} from "../../src/index.js";
import { assistanceIdentity } from "./presentation-assistance-conformance.js";
import { summaryMember } from "./session-summary-conformance.js";

export async function starterCopyFixture(repository: Repository) {
  const actor = await assistanceIdentity(repository);
  const idempotencyKey = randomUUID();
  const expiresAt = new Date(Date.now() + 24 * 60 * 60_000);
  const identity = (creator = actor): StarterCopyIdentity => ({
    actorId: creator.userId,
    workspaceId: creator.workspaceId,
    idempotencyKey,
    requestHash: "a".repeat(64),
    expiresAt,
  });
  const record = (creator = actor): QuizRecord => {
    const now = new Date();
    return {
      id: randomUUID(),
      workspaceId: creator.workspaceId,
      title: "Starter copy",
      description: "",
      status: "draft",
      draft: { title: "Starter copy", description: "", questions: [] },
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

export async function expectStarterCopyRecovery(repository: Repository) {
  const f = await starterCopyFixture(repository);
  const results = await Promise.all(
    Array.from({ length: 6 }, () => repository.createStarterCopy(f.record(), f.identity())),
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
  expect(await repository.getStarterCopy(f.identity())).toMatchObject({
    id: quiz.id,
    draftRevision: 1,
    draft: { title: updated!.draft.title },
  });
  expect(await repository.createStarterCopy(f.record(), f.identity())).toMatchObject({
    status: "duplicate",
    quiz: { id: quiz.id, draftRevision: 1 },
  });
  await expect(
    repository.getStarterCopy({ ...f.identity(), requestHash: "b".repeat(64) }),
  ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  await expect(
    repository.createStarterCopy(f.record(), { ...f.identity(), requestHash: "b".repeat(64) }),
  ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  // A renewed body under the same UUID must not race an older in-flight body into two copies.
  const renewed = { ...f.identity(), idempotencyKey: randomUUID(), requestHash: "c".repeat(64) };
  const racing = await Promise.allSettled([
    repository.createStarterCopy(f.record(), renewed),
    repository.createStarterCopy(f.record(), { ...renewed, requestHash: "d".repeat(64) }),
  ]);
  expect(racing.filter((result) => result.status === "fulfilled")).toHaveLength(1);
  const conflict = racing.find((result) => result.status === "rejected");
  expect(conflict).toMatchObject({ status: "rejected", reason: { code: "IDEMPOTENCY_CONFLICT" } });
  expect(await repository.listQuizzes(f.actor.workspaceId)).toHaveLength(2);
  return { ...f, quiz };
}

export async function expectStarterCopyAuthority(repository: Repository) {
  const f = await starterCopyFixture(repository);
  const member = await assistanceIdentity(repository),
    outsider = await assistanceIdentity(repository);
  await summaryMember(repository, f.actor, member, "editor");
  const editor: CreatorContext = { ...member, workspaceId: f.actor.workspaceId, role: "editor" };
  const original = await repository.createStarterCopy(f.record(), f.identity());
  const second = await repository.createStarterCopy(f.record(editor), f.identity(editor));
  const otherWorkspace = await repository.createStarterCopy(
    f.record(outsider),
    f.identity(outsider),
  );
  await summaryMember(repository, outsider, f.actor, "editor");
  const sameActorElsewhere: CreatorContext = {
    ...f.actor,
    workspaceId: outsider.workspaceId,
    role: "editor",
  };
  const acrossWorkspace = await repository.createStarterCopy(
    f.record(sameActorElsewhere),
    f.identity(sameActorElsewhere),
  );
  expect(
    new Set([original.quiz.id, second.quiz.id, otherWorkspace.quiz.id, acrossWorkspace.quiz.id])
      .size,
  ).toBe(4);
  await repository.updateWorkspaceMemberRole(f.actor.workspaceId, member.userId, "viewer");
  expect(await repository.getStarterCopy(f.identity(editor))).toMatchObject({
    id: second.quiz.id,
  });
  expect(await repository.createStarterCopy(f.record(editor), f.identity(editor))).toMatchObject({
    status: "duplicate",
    quiz: { id: second.quiz.id },
  });
  await expect(
    repository.createStarterCopy(f.record(editor), {
      ...f.identity(editor),
      idempotencyKey: randomUUID(),
    }),
  ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  await repository.removeWorkspaceMember(f.actor.workspaceId, member.userId);
  await expect(repository.getStarterCopy(f.identity(editor))).rejects.toMatchObject({
    code: "UNAUTHORIZED",
  });
  await repository.deleteAccount(member.userId);
  await expect(repository.getStarterCopy(f.identity(editor))).rejects.toMatchObject({
    code: "UNAUTHORIZED",
  });
  expect(await repository.getStarterCopy(f.identity())).toMatchObject({ id: original.quiz.id });
  return { ...f, editor, editorQuiz: second.quiz };
}

export async function expectStarterCopyDeletion(repository: Repository) {
  const f = await starterCopyFixture(repository);
  const { quiz } = await repository.createStarterCopy(f.record(), f.identity());
  await repository.archiveQuiz(f.actor.workspaceId, quiz.id, true);
  await expect(repository.getStarterCopy(f.identity())).rejects.toMatchObject({
    code: "STARTER_COPY_TARGET_UNAVAILABLE",
  });
  await expect(repository.createStarterCopy(f.record(), f.identity())).rejects.toMatchObject({
    code: "STARTER_COPY_TARGET_UNAVAILABLE",
  });
  expect(await repository.deleteQuiz(f.actor.workspaceId, quiz.id)).toBe("deleted");
  await expect(repository.createStarterCopy(f.record(), f.identity())).rejects.toMatchObject({
    code: "STARTER_COPY_TARGET_UNAVAILABLE",
  });
  expect(await repository.listQuizzes(f.actor.workspaceId, true)).toEqual([]);
  expect(await repository.listQuizDraftHistory(f.actor.workspaceId, quiz.id, 20)).toEqual([]);
  return { ...f, quiz };
}
