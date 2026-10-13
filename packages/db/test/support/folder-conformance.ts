import { randomUUID } from "node:crypto";
import { expect } from "vitest";
import type { FolderArtifactType, PresentationDraft } from "@openround/contracts";
import {
  createPresentationRepository,
  createSurveyRepository,
  type CreatorContext,
  type Repository,
} from "../../src/index.js";
import { surveyFixture } from "./survey-conformance.js";

export async function expectFolderConformance(
  repository: Repository,
  actor: CreatorContext,
  outsider: CreatorContext,
) {
  const now = new Date();
  const create = (
    name: string,
    artifactType: FolderArtifactType = "round",
    parentId: string | null = null,
    workspaceId = actor.workspaceId,
  ) =>
    repository.createFolder({
      id: randomUUID(),
      workspaceId,
      name,
      artifactType,
      parentId,
      createdAt: now,
      updatedAt: now,
    });
  const root = await create("Workshop");
  const presentationsFolder = await create("Workshop", "presentation");
  const surveyFolder = await create("Workshop", "survey");
  const other = await create("Workshop", "round", null, outsider.workspaceId);
  const child = await create("Week one", "round", root.id);
  const grandchild = await create("Exercises", "round", child.id);
  const rootTwo = await create("Week two");
  await expect(create("workshop")).rejects.toMatchObject({ code: "CONFLICT" });
  await expect(create("Bad parent", "round", presentationsFolder.id)).rejects.toMatchObject({
    code: "NOT_FOUND",
  });
  await expect(create("Bad parent", "round", other.id)).rejects.toMatchObject({
    code: "NOT_FOUND",
  });
  expect(
    await repository.updateFolder(outsider.workspaceId, root.id, { name: "Intrusion" }),
  ).toBeNull();
  expect(await repository.deleteFolder(outsider.workspaceId, root.id)).toBe(false);
  await expect(
    repository.updateFolder(actor.workspaceId, root.id, { parentId: grandchild.id }),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  await expect(
    repository.updateFolder(actor.workspaceId, root.id, { parentId: root.id }),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  await expect(
    repository.updateFolder(actor.workspaceId, child.id, { parentId: surveyFolder.id }),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  await repository.updateFolder(actor.workspaceId, rootTwo.id, { position: 0 });
  expect(
    (await repository.listFolders(actor.workspaceId, "round"))
      .filter((f) => f.parentId === null)
      .map((f) => [f.id, f.position]),
  ).toEqual([
    [rootTwo.id, 0],
    [root.id, 1],
  ]);
  await repository.updateFolder(actor.workspaceId, child.id, { parentId: rootTwo.id });
  expect(
    (await repository.listFolders(actor.workspaceId, "round")).find((f) => f.id === grandchild.id)
      ?.parentId,
  ).toBe(child.id);
  await repository.updateFolder(actor.workspaceId, child.id, { parentId: root.id });

  const round = await repository.createQuiz({
    id: randomUUID(),
    workspaceId: actor.workspaceId,
    title: "Folder Round",
    description: "",
    status: "draft",
    draft: { title: "Folder Round", description: "", questions: [] },
    currentVersionId: null,
    createdAt: now,
    updatedAt: now,
  });
  await expect(
    repository.createQuiz({ ...round, id: randomUUID(), folderId: presentationsFolder.id }),
  ).rejects.toThrow();
  await expect(
    repository.createQuiz({ ...round, id: randomUUID(), folderId: other.id }),
  ).rejects.toThrow();
  expect(
    await repository.organizeQuiz(actor.workspaceId, round.id, presentationsFolder.id, []),
  ).toBeNull();
  expect(await repository.organizeQuiz(actor.workspaceId, round.id, other.id, [])).toBeNull();
  await repository.organizeQuiz(actor.workspaceId, round.id, root.id, ["Loaded tag"]);
  const staleRound = await repository.getQuiz(actor.workspaceId, round.id);
  // Another editor changes tags after the folder manager loads this Round.
  await repository.organizeQuiz(actor.workspaceId, round.id, root.id, ["Updated by editor"]);
  expect(staleRound?.tags).toEqual(["Loaded tag"]);
  expect(await repository.organizeQuiz(actor.workspaceId, round.id, rootTwo.id)).toMatchObject({
    folderId: rootTwo.id,
    tags: ["Updated by editor"],
  });
  expect((await repository.getQuiz(actor.workspaceId, round.id))?.tags).toEqual([
    "Updated by editor",
  ]);
  expect(await repository.organizeQuiz(actor.workspaceId, round.id, root.id, [])).toMatchObject({
    folderId: root.id,
    tags: [],
  });
  await repository.organizeQuiz(actor.workspaceId, round.id, root.id, ["Keep tag"]);
  const nestedRound = await repository.createQuiz({ ...round, id: randomUUID() });
  await repository.organizeQuiz(actor.workspaceId, nestedRound.id, grandchild.id, []);

  const presentations = createPresentationRepository(repository);
  const draft: PresentationDraft = {
    schemaVersion: 2,
    title: "Folder Presentation",
    description: "",
    experiencePreset: { id: "focus", version: 1 },
    blocks: [
      {
        id: randomUUID(),
        kind: "content",
        layout: "title_body",
        textElements: [
          {
            id: randomUUID(),
            role: "title",
            text: "Folder Presentation",
            region: "top_left",
            order: 0,
          },
          { id: randomUUID(), role: "body", text: "Preserved", region: "middle_left", order: 1 },
        ],
        speakerNotes: "",
        mediaId: null,
        mediaAlt: null,
      },
    ],
  };
  const presentation = await presentations.createPresentation({
    id: randomUUID(),
    workspaceId: actor.workspaceId,
    title: draft.title,
    description: "",
    status: "draft",
    draft,
    draftRevision: 0,
    draftSchemaVersion: 2,
    currentVersionId: null,
    folderId: null,
    publishedDraftRevision: null,
    lastEditedBy: actor.userId,
    createdAt: now,
    updatedAt: now,
  });
  await expect(
    presentations.createPresentation({ ...presentation, id: randomUUID(), folderId: root.id }),
  ).rejects.toThrow();
  await expect(
    presentations.createPresentation({ ...presentation, id: randomUUID(), folderId: other.id }),
  ).rejects.toThrow();
  expect(
    await presentations.organizePresentation(actor.workspaceId, presentation.id, root.id),
  ).toBeNull();
  expect(
    await presentations.organizePresentation(actor.workspaceId, presentation.id, other.id),
  ).toBeNull();
  await presentations.organizePresentation(
    actor.workspaceId,
    presentation.id,
    presentationsFolder.id,
  );
  const surveys = createSurveyRepository(repository);
  const survey = await surveys.create(
    actor.workspaceId,
    randomUUID(),
    surveyFixture(),
    randomUUID(),
  );
  await expect(
    surveys.organize(actor.workspaceId, survey.id, root.id, 0, randomUUID()),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  await expect(
    surveys.organize(actor.workspaceId, survey.id, other.id, 0, randomUUID()),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  await surveys.organize(actor.workspaceId, survey.id, surveyFolder.id, 0, randomUUID());
  expect(await repository.listFolders(actor.workspaceId, "presentation")).toHaveLength(1);
  expect(await repository.listFolders(actor.workspaceId)).toHaveLength(6);

  // Promotion must be atomic when the root destination has a duplicate name.
  const collision = await create("Week one");
  await expect(repository.deleteFolder(actor.workspaceId, root.id)).rejects.toMatchObject({
    code: "CONFLICT",
  });
  expect((await repository.getQuiz(actor.workspaceId, round.id))?.folderId).toBe(root.id);
  await repository.deleteFolder(actor.workspaceId, collision.id);
  expect(await repository.deleteFolder(actor.workspaceId, root.id)).toBe(true);
  const retained = await repository.listFolders(actor.workspaceId, "round");
  expect(retained.find((f) => f.id === child.id)?.parentId).toBeNull();
  expect(retained.find((f) => f.id === grandchild.id)?.parentId).toBe(child.id);
  expect(await repository.getQuiz(actor.workspaceId, round.id)).toMatchObject({
    folderId: null,
    tags: ["Keep tag"],
    draft: round.draft,
  });
  expect((await repository.getQuiz(actor.workspaceId, nestedRound.id))?.folderId).toBe(
    grandchild.id,
  );
  await repository.deleteFolder(actor.workspaceId, presentationsFolder.id);
  expect(await presentations.getPresentation(actor.workspaceId, presentation.id)).toMatchObject({
    folderId: null,
    draft,
  });
  await repository.deleteFolder(actor.workspaceId, surveyFolder.id);
  expect(await surveys.get(actor.workspaceId, survey.id)).toMatchObject({
    folderId: null,
    draft: survey.draft,
    revision: 1,
  });

  const a = await create("Concurrent A");
  const b = await create("Concurrent B");
  const moves = await Promise.allSettled([
    repository.updateFolder(actor.workspaceId, a.id, { parentId: b.id }),
    repository.updateFolder(actor.workspaceId, b.id, { parentId: a.id }),
  ]);
  expect(moves.filter((result) => result.status === "fulfilled")).toHaveLength(1);
  expect(moves.filter((result) => result.status === "rejected")).toMatchObject([
    { reason: { code: "CONFLICT" } },
  ]);
  const final = await repository.listFolders(actor.workspaceId, "round");
  for (const folder of final) {
    const seen = new Set([folder.id]);
    let cursor = folder.parentId;
    while (cursor) {
      expect(seen.has(cursor)).toBe(false);
      seen.add(cursor);
      cursor = final.find((f) => f.id === cursor)!.parentId;
    }
  }
}
