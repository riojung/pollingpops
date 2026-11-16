import { createHash, randomUUID } from "node:crypto";
import { expect } from "vitest";
import {
  createPresentationDesignScene,
  PresentationDraftSchema,
  PresentationContentSchema,
} from "@openround/contracts";
import {
  createPresentationRepository,
  type Repository,
  type PresentationRecord,
  type CreatorContext,
} from "../../src/index.js";
import { assistanceIdentity } from "./presentation-assistance-conformance.js";
import { summaryMember } from "./session-summary-conformance.js";

export async function presentationCreationFixture(repository: Repository) {
  const actor = await assistanceIdentity(repository),
    presentations = createPresentationRepository(repository);
  const creationRequestId = randomUUID();
  const record = (creator = actor): PresentationRecord => {
    const now = new Date();
    const draft = PresentationDraftSchema.parse({
      title: "Outline draft",
      description: "Creator supplied title",
      schemaVersion: 7,
      experiencePreset: { id: "pops", version: 1 },
      blocks: [
        {
          id: randomUUID(),
          kind: "content",
          layout: "title_body",
          textElements: [],
          mediaId: null,
          mediaAlt: null,
          speakerNotes: "",
          scene: createPresentationDesignScene(randomUUID(), randomUUID()),
        },
      ],
    });
    return {
      id: randomUUID(),
      workspaceId: creator.workspaceId,
      title: draft.title,
      description: draft.description,
      status: "draft",
      draft,
      draftSchemaVersion: draft.schemaVersion,
      draftRevision: 0,
      currentVersionId: null,
      publishedDraftRevision: null,
      lastEditedBy: creator.userId,
      folderId: null,
      createdAt: now,
      updatedAt: now,
    };
  };
  const intent = (creator = actor, key = creationRequestId) => ({
    creationRequestId: key,
    creationContext: { actorId: creator.userId, workspaceId: creator.workspaceId },
    initialSlide: "native" as const,
  });
  return { repository, actor, presentations, record, intent, creationRequestId };
}

export async function expectPresentationCreationRecovery(repository: Repository) {
  const f = await presentationCreationFixture(repository);
  const admissions = await repository.countAuthoringJobsSince(f.actor.workspaceId, new Date(0));
  const results = await Promise.all(
    Array.from({ length: 6 }, () =>
      f.presentations.createPresentationIdempotently(f.record(), f.intent()),
    ),
  );
  expect(results.filter((result) => result.status === "created")).toHaveLength(1);
  const presentation = results[0]!.presentation;
  expect(new Set(results.map((result) => result.presentation.id)).size).toBe(1);
  expect(
    await f.presentations.listPresentationHistory(f.actor.workspaceId, presentation.id),
  ).toHaveLength(1);
  expect(await f.presentations.listPresentations(f.actor.workspaceId)).toHaveLength(1);
  const draft = structuredClone(presentation.draft);
  draft.title = "Edited after acknowledgement loss";
  const block = draft.blocks[0]!;
  if (block.kind !== "content" || !block.scene) throw new Error("Expected native starter");
  for (const node of block.scene.nodes)
    if (node.type === "text")
      node.text = node.role === "title" ? "Reviewed title" : "Reviewed body";
  const updated = (await f.presentations.updatePresentationDraft({
    workspaceId: f.actor.workspaceId,
    presentationId: presentation.id,
    draft,
    expectedRevision: 0,
    mutationId: randomUUID(),
    editorId: f.actor.userId,
    draftHash: "a".repeat(64),
  }))!;
  const content = PresentationContentSchema.parse(draft);
  const version = await f.presentations.publishPresentation(
    {
      id: randomUUID(),
      workspaceId: f.actor.workspaceId,
      presentationId: presentation.id,
      version: 1,
      content,
      contentSchemaVersion: draft.schemaVersion,
      contentHash: createHash("sha256").update(JSON.stringify(content)).digest("hex"),
      sourceDraftRevision: updated.draftRevision,
      publishedAt: new Date(),
    },
    updated.draftRevision,
  );
  const replay = await f.presentations.createPresentationIdempotently(f.record(), {
    ...f.intent(),
    creationRequestId: f.creationRequestId.toUpperCase(),
  });
  expect(replay).toMatchObject({
    status: "duplicate",
    presentation: {
      id: presentation.id,
      draftRevision: 1,
      draft: { title: draft.title },
      currentVersionId: version.id,
      status: "published",
    },
  });
  expect(await f.presentations.getPresentationVersion(f.actor.workspaceId, version.id)).toEqual(
    version,
  );
  for (const input of [
    { ...f.record(), title: "Different" },
    { ...f.record(), description: "Different" },
  ])
    await expect(
      f.presentations.createPresentationIdempotently(input, f.intent()),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  await expect(
    f.presentations.createPresentationIdempotently(f.record(), {
      ...f.intent(),
      initialSlide: "classic",
    }),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  const classicKey = randomUUID();
  const { initialSlide: _initialSlide, ...classic } = f.intent(f.actor, classicKey);
  void _initialSlide;
  await f.presentations.createPresentationIdempotently(f.record(), classic);
  expect(
    (
      await f.presentations.createPresentationIdempotently(f.record(), {
        ...classic,
        initialSlide: "classic",
      })
    ).status,
  ).toBe("duplicate");
  expect(await repository.countAuthoringJobsSince(f.actor.workspaceId, new Date(0))).toBe(
    admissions,
  );
  return { ...f, presentation, version };
}

export async function expectPresentationCreationAuthority(repository: Repository) {
  const f = await presentationCreationFixture(repository),
    member = await assistanceIdentity(repository),
    outsider = await assistanceIdentity(repository);
  await summaryMember(repository, f.actor, member, "editor");
  const editor: CreatorContext = { ...member, workspaceId: f.actor.workspaceId, role: "editor" };
  await f.presentations.createPresentationIdempotently(f.record(), f.intent());
  await expect(
    f.presentations.createPresentationIdempotently(f.record(editor), f.intent(editor)),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  await expect(
    f.presentations.createPresentationIdempotently(f.record(outsider), f.intent(outsider)),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  expect(await f.presentations.listPresentations(outsider.workspaceId)).toEqual([]);
  await expect(
    f.presentations.createPresentationIdempotently(
      f.record(outsider),
      f.intent(f.actor, randomUUID()),
    ),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  const editorIntent = f.intent(editor, randomUUID());
  await f.presentations.createPresentationIdempotently(f.record(editor), editorIntent);
  await repository.updateWorkspaceMemberRole(f.actor.workspaceId, member.userId, "viewer");
  await expect(
    f.presentations.createPresentationIdempotently(f.record(editor), editorIntent),
  ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  await expect(
    f.presentations.createPresentationIdempotently(
      f.record(editor),
      f.intent(editor, randomUUID()),
    ),
  ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  await repository.deleteAccount(member.userId);
  await expect(
    f.presentations.createPresentationIdempotently(f.record(editor), editorIntent),
  ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  await expect(
    f.presentations.createPresentationIdempotently(f.record(), {
      ...editorIntent,
      creationContext: f.intent().creationContext,
    }),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  return { ...f, editor, editorIntent };
}

export async function expectPresentationCreationDeletion(repository: Repository) {
  const f = await presentationCreationFixture(repository);
  const { presentation } = await f.presentations.createPresentationIdempotently(
    f.record(),
    f.intent(),
  );
  await f.presentations.archivePresentation(f.actor.workspaceId, presentation.id, true);
  expect(
    (await f.presentations.createPresentationIdempotently(f.record(), f.intent())).presentation
      .status,
  ).toBe("archived");
  expect(await f.presentations.deletePresentation(f.actor.workspaceId, presentation.id)).toBe(
    "deleted",
  );
  await expect(
    f.presentations.createPresentationIdempotently(f.record(), f.intent()),
  ).rejects.toMatchObject({ code: "DELETED" });
  expect(await f.presentations.listPresentations(f.actor.workspaceId, true)).toEqual([]);
  expect(
    await f.presentations.listPresentationHistory(f.actor.workspaceId, presentation.id),
  ).toEqual([]);
  return { ...f, presentation };
}
