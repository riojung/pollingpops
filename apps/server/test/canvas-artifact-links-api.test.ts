import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CanvasArtifactLinkListSchema,
  CanvasArtifactLinkEligibleSchema,
  CanvasArtifactLinkMutationResponseSchema,
  CanvasVersionViewSchema,
} from "@openround/contracts";
import {
  CanvasArtifactLinkRepository,
  createPresentationRepository,
  MemoryRepository,
} from "@openround/db";
import {
  canvasFacilitationFixture as fixture,
  closeCanvasFacilitationFixtures,
  createFacilitationCanvas,
  createFacilitationWorkshop,
  facilitateCanvas,
  insertCanvasObjects,
  shareFacilitationCanvas,
  canvasObjectCommand,
  insertFacilitationImage,
  syntheticCanvasStorage,
  delayedCanvasImageRead,
  type CanvasFacilitationFixture,
} from "./support/canvas-facilitation-fixture.js";

afterEach(closeCanvasFacilitationFixtures);
async function target(f: CanvasFacilitationFixture, kind: "round" | "presentation" = "round") {
  const selected = await f.app.inject({
    method: "POST",
    url: `/v1/workspaces/${f.workspaceId}/select`,
    headers: f.owner.headers,
  });
  expect(selected.statusCode, selected.body).toBe(200);
  const id = randomUUID(),
    now = new Date();
  const common = {
    id,
    workspaceId: f.workspaceId,
    title: "Private destination",
    description: "",
    status: "draft" as const,
    currentVersionId: null,
    createdAt: now,
    updatedAt: now,
    draftRevision: 0,
    lastEditedBy: f.owner.userId,
  };
  if (kind === "round")
    await f.repository.createQuiz({
      ...common,
      draft: { title: common.title, description: "", questions: [] },
    });
  else
    await createPresentationRepository(f.repository).createPresentation({
      ...common,
      draftSchemaVersion: 2,
      publishedDraftRevision: null,
      folderId: null,
      draft: {
        schemaVersion: 2,
        title: common.title,
        description: "",
        experiencePreset: { id: "pops", version: 1 },
        blocks: [],
      },
    });
  return {
    id,
    kind,
    path: `/v1/${kind === "round" ? "quizzes" : "presentations"}/${id}/canvas-snapshot-links`,
  };
}
async function source(f: CanvasFacilitationFixture) {
  const board = await insertCanvasObjects(f, await createFacilitationCanvas(f), [
    { text: "Named checkpoint content" },
  ]);
  const versionId = randomUUID();
  expect(
    (
      await facilitateCanvas(f, board, {
        type: "version_create",
        versionId,
        name: "Exact saved scene",
      })
    ).statusCode,
  ).toBe(200);
  return { board, versionId };
}
const intent = (boardId: string, versionId: string) => ({
  schemaVersion: 1 as const,
  operationId: randomUUID(),
  linkId: randomUUID(),
  boardId,
  versionId,
});
const remove = (expectedRevision = 1) => ({
  schemaVersion: 1,
  operationId: randomUUID(),
  expectedRevision,
});

describe.each(["round", "presentation"] as const)(
  "%s authoring-only canvas checkpoint links",
  (kind) => {
    it("links an exact checkpoint with deduplication, durable exact retries and no draft/public content fields", async () => {
      const f = await fixture(),
        destination = await target(f, kind),
        { board, versionId } = await source(f);
      const eligible = await f.app.inject({
        url: `${destination.path}/eligible`,
        headers: f.owner.headers,
      });
      expect(eligible.statusCode, eligible.body).toBe(200);
      expect(CanvasArtifactLinkEligibleSchema.parse(eligible.json()).boards[0]).toMatchObject({
        id: board.id,
        versions: [{ id: versionId }],
      });
      const input = intent(board.id, versionId);
      const create = () =>
        f.app.inject({
          method: "POST",
          url: destination.path,
          headers: f.owner.headers,
          payload: input,
        });
      const first = await create();
      expect(first.statusCode, first.body).toBe(200);
      const receipt = CanvasArtifactLinkMutationResponseSchema.parse(first.json()).receipt;
      expect((await create()).json()).toEqual(first.json());
      const deduped = await f.app.inject({
        method: "POST",
        url: destination.path,
        headers: f.owner.headers,
        payload: intent(board.id, versionId),
      });
      expect(deduped.statusCode, deduped.body).toBe(200);
      expect(deduped.json().receipt.linkId).toBe(receipt.linkId);
      const conflict = await f.app.inject({
        method: "POST",
        url: destination.path,
        headers: f.owner.headers,
        payload: { ...input, versionId: randomUUID() },
      });
      expect(conflict.statusCode, conflict.body).toBe(409);
      const listed = await f.app.inject({ url: destination.path, headers: f.owner.headers });
      expect(listed.headers["cache-control"]).toBe("private, no-store");
      expect(CanvasArtifactLinkListSchema.parse(listed.json()).links).toMatchObject([
        {
          id: receipt.linkId,
          boardId: board.id,
          versionId,
          name: "Exact saved scene",
          canDelete: true,
        },
      ]);
      const preview = await f.app.inject({
        url: `${destination.path}/${receipt.linkId}/preview`,
        headers: f.owner.headers,
      });
      expect(preview.statusCode, preview.body).toBe(200);
      expect(CanvasVersionViewSchema.parse(preview.json()).objects[0]!.text).toBe(
        "Named checkpoint content",
      );
      const record =
        kind === "round"
          ? await f.repository.getQuiz(f.workspaceId, destination.id)
          : await createPresentationRepository(f.repository).getPresentation(
              f.workspaceId,
              destination.id,
            );
      for (const excluded of [
        "canvas-snapshot-links",
        receipt.linkId,
        board.id,
        versionId,
        "Named checkpoint content",
      ])
        expect(JSON.stringify(record!.draft)).not.toContain(excluded);
    });
    it("fences deletion and never reuses a retired link ID", async () => {
      const f = await fixture(),
        destination = await target(f, kind),
        { board, versionId } = await source(f),
        input = intent(board.id, versionId);
      const created = await f.app.inject({
        method: "POST",
        url: destination.path,
        headers: f.owner.headers,
        payload: input,
      });
      expect(created.statusCode, created.body).toBe(200);
      const url = `${destination.path}/${input.linkId}`;
      const stale = await f.app.inject({
        method: "DELETE",
        url,
        headers: f.owner.headers,
        payload: remove(2),
      });
      expect(stale.statusCode, stale.body).toBe(409);
      const deletion = remove();
      const erased = await f.app.inject({
        method: "DELETE",
        url,
        headers: f.owner.headers,
        payload: deletion,
      });
      expect(erased.statusCode, erased.body).toBe(200);
      expect(
        (
          await f.app.inject({ method: "DELETE", url, headers: f.owner.headers, payload: deletion })
        ).json(),
      ).toEqual(erased.json());
      const retired = await f.app.inject({
        method: "POST",
        url: destination.path,
        headers: f.owner.headers,
        payload: { ...input, operationId: randomUUID() },
      });
      expect(retired.statusCode, retired.body).toBe(409);
      // Replaying an old create cannot restore its deleted relation.
      expect(
        (
          await f.app.inject({
            method: "POST",
            url: destination.path,
            headers: f.owner.headers,
            payload: input,
          })
        ).json(),
      ).toEqual(created.json());
      expect(
        (await f.app.inject({ url: destination.path, headers: f.owner.headers })).json().links,
      ).toEqual([]);
      expect(
        (await f.app.inject({ url: `${url}/preview`, headers: f.owner.headers })).statusCode,
      ).toBe(404);
    });
  },
);

describe("snapshot-link permission intersections and lifecycle", () => {
  it("requires target membership and fresh source access, and gives target/source viewers no mutation permission", async () => {
    const f = await fixture(),
      destination = await target(f),
      { board, versionId } = await source(f),
      input = intent(board.id, versionId);
    expect(
      (
        await f.app.inject({
          method: "POST",
          url: destination.path,
          headers: f.owner.headers,
          payload: input,
        })
      ).statusCode,
    ).toBe(200);
    expect(f.repository).toBeInstanceOf(MemoryRepository);
    const repository = f.repository as MemoryRepository;
    repository.workspaceMembers.set(`${f.workspaceId}:${f.editor.userId}`, {
      workspaceId: f.workspaceId,
      userId: f.editor.userId,
      role: "editor",
      joinedAt: new Date(),
    });
    await shareFacilitationCanvas(f, board, f.editor, "viewer");
    expect(
      (
        await f.app.inject({
          method: "POST",
          url: `/v1/workspaces/${f.workspaceId}/select`,
          headers: f.editor.headers,
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (await f.app.inject({ url: destination.path, headers: f.editor.headers })).json().links[0]
        .canDelete,
    ).toBe(false);
    expect(
      (
        await f.app.inject({
          url: `${destination.path}/${input.linkId}/preview`,
          headers: f.editor.headers,
        })
      ).statusCode,
    ).toBe(200);
    const denied = await f.app.inject({
      method: "POST",
      url: destination.path,
      headers: f.editor.headers,
      payload: intent(board.id, versionId),
    });
    expect(denied.statusCode, denied.body).toBe(403);
    const revoked = await f.app.inject({
      method: "DELETE",
      url: `/v1/canvas-boards/${board.id}/grants/${f.editor.userId}`,
      headers: f.owner.headers,
    });
    expect(revoked.statusCode, revoked.body).toBe(204);
    expect(
      (await f.app.inject({ url: destination.path, headers: f.editor.headers })).json().links,
    ).toEqual([]);
    expect(
      (
        await f.app.inject({
          url: `${destination.path}/${input.linkId}/preview`,
          headers: f.editor.headers,
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (await f.app.inject({ url: destination.path, headers: f.outsider.headers })).statusCode,
    ).toBe(404);
    expect((await f.app.inject({ url: destination.path })).statusCode).toBe(401);
  });
  it("denies cross-workspace/archived creation, cascades source checkpoint deletion, and retains bounded tombstones", async () => {
    const f = await fixture(),
      destination = await target(f),
      { board, versionId } = await source(f),
      input = intent(board.id, versionId);
    const foreign = await f.app.inject({
      method: "POST",
      url: destination.path,
      headers: f.outsider.headers,
      payload: input,
    });
    expect(foreign.statusCode, foreign.body).toBe(404);
    const otherBoard = await createFacilitationCanvas(f, { workspaceId: f.owner.workspaceId }),
      otherVersion = randomUUID();
    expect(
      (
        await facilitateCanvas(f, otherBoard, {
          type: "version_create",
          versionId: otherVersion,
          name: "Same user different workspace",
        })
      ).statusCode,
    ).toBe(200);
    const crossWorkspace = await f.app.inject({
      method: "POST",
      url: destination.path,
      headers: f.owner.headers,
      payload: intent(otherBoard.id, otherVersion),
    });
    expect(crossWorkspace.statusCode, crossWorkspace.body).toBe(404);
    expect(
      (
        await f.app.inject({
          method: "POST",
          url: destination.path,
          headers: f.owner.headers,
          payload: input,
        })
      ).statusCode,
    ).toBe(200);
    const deleted = await facilitateCanvas(f, board, {
      type: "version_delete",
      versionId,
      expectedVersion: 1,
    });
    expect(deleted.statusCode, deleted.body).toBe(200);
    expect(
      (await f.app.inject({ url: destination.path, headers: f.owner.headers })).json().links,
    ).toEqual([]);
    expect(
      (
        await f.app.inject({
          url: `${destination.path}/${input.linkId}/preview`,
          headers: f.owner.headers,
        })
      ).statusCode,
    ).toBe(404);
    const quiz = (f.repository as MemoryRepository).quizzes.get(destination.id)!;
    quiz.status = "archived";
    const other = await source(f);
    expect(
      (
        await f.app.inject({
          method: "POST",
          url: destination.path,
          headers: f.owner.headers,
          payload: intent(other.board.id, other.versionId),
        })
      ).statusCode,
    ).toBe(409);
    expect(
      (await f.app.inject({ url: `${destination.path}/eligible`, headers: f.owner.headers })).json()
        .boards,
    ).toEqual([]);
  });
  it("reauthorizes the destination after reading a preview and never delivers a revoked snapshot", async () => {
    const f = await fixture(),
      destination = await target(f),
      { board, versionId } = await source(f),
      input = intent(board.id, versionId);
    expect(
      (
        await f.app.inject({
          method: "POST",
          url: destination.path,
          headers: f.owner.headers,
          payload: input,
        })
      ).statusCode,
    ).toBe(200);
    const original = CanvasArtifactLinkRepository.prototype.preview;
    vi.spyOn(CanvasArtifactLinkRepository.prototype, "preview").mockImplementationOnce(
      async function (this: CanvasArtifactLinkRepository, ...args) {
        const value = await original.apply(this, args);
        (f.repository as MemoryRepository).workspaceMembers.delete(
          `${f.workspaceId}:${f.owner.userId}`,
        );
        return value;
      },
    );
    const denied = await f.app.inject({
      url: `${destination.path}/${input.linkId}/preview`,
      headers: f.owner.headers,
    });
    expect([401, 404]).toContain(denied.statusCode);
    expect(denied.body).not.toContain("Named checkpoint content");
  });
  it("reprojects canonical guest removals without persisting bodies in destination links", async () => {
    const f = await fixture(true),
      read = syntheticCanvasStorage(f),
      destination = await target(f),
      { board, sourceId, guest } = await createFacilitationWorkshop(f, true);
    const ticket = await f.app.inject({
      method: "POST",
      url: `/v1/idea-boards/${sourceId}/media`,
      headers: guest,
      payload: {
        fileName: "drawing.png",
        mimeType: "image/png",
        sizeBytes: 8,
        altText: "Guest drawing",
      },
    });
    expect(ticket.statusCode, ticket.body).toBe(201);
    const mediaId = ticket.json().mediaId;
    const completed = await f.app.inject({
      method: "POST",
      url: `/v1/idea-boards/${sourceId}/media/${mediaId}/complete`,
      headers: guest,
    });
    expect(completed.statusCode, completed.body).toBe(200);
    const submitted = await f.app.inject({
      method: "POST",
      url: `/v1/idea-boards/${sourceId}/ideas`,
      headers: guest,
      payload: {
        body: "Canonical guest secret",
        attachments: [{ mediaId, alt: "Guest drawing" }],
        idempotencyKey: randomUUID(),
      },
    });
    expect(submitted.statusCode, submitted.body).toBe(200);
    const ideaId = submitted.json().ownIdeas[0].id;
    const latest = await f.canvasBoards.get(f.owner, board.id);
    expect(
      (
        await canvasObjectCommand(f, board, {
          type: "workshop",
          expectedRevision: latest.sourceBoard!.revision,
          command: { type: "moderate", ideaId, status: "approved" },
        })
      ).statusCode,
    ).toBe(200);
    const versionId = randomUUID();
    expect(
      (
        await facilitateCanvas(f, board, {
          type: "version_create",
          versionId,
          name: "Guest reference checkpoint",
        })
      ).statusCode,
    ).toBe(200);
    const input = intent(board.id, versionId);
    expect(
      (
        await f.app.inject({
          method: "POST",
          url: destination.path,
          headers: f.owner.headers,
          payload: input,
        })
      ).statusCode,
    ).toBe(200);
    const url = `${destination.path}/${input.linkId}/preview`;
    expect((await f.app.inject({ url, headers: f.owner.headers })).body).toContain(
      "Canonical guest secret",
    );
    const imageUrl = `${destination.path}/${input.linkId}/media/${mediaId}`;
    const available = await f.app.inject({ url: imageUrl, headers: f.owner.headers });
    expect(available.statusCode, available.body).toBe(200);
    expect(available.headers["content-type"]).toBe("image/png");
    const delayed = delayedCanvasImageRead(read),
      pending = f.app.inject({ url: imageUrl, headers: f.owner.headers });
    await delayed.reading;
    const current = await f.canvasBoards.get(f.owner, board.id);
    expect(
      (
        await canvasObjectCommand(f, board, {
          type: "workshop",
          expectedRevision: current.sourceBoard!.revision,
          command: { type: "moderate", ideaId, status: "removed" },
        })
      ).statusCode,
    ).toBe(200);
    delayed.release();
    const imageDenied = await pending;
    expect(imageDenied.statusCode, imageDenied.body).toBe(404);
    const after = await f.app.inject({ url, headers: f.owner.headers });
    expect(after.statusCode, after.body).toBe(200);
    expect(after.json().objects).toEqual([]);
    const record = await f.repository.getQuiz(f.workspaceId, destination.id);
    expect(JSON.stringify(record)).not.toContain("Canonical guest secret");
    expect((await f.app.inject({ url, headers: guest })).statusCode).toBe(401);
  });
  it("checks target authorization again after historical image storage reads", async () => {
    const f = await fixture(true),
      read = syntheticCanvasStorage(f),
      destination = await target(f);
    const image = await insertFacilitationImage(f, await createFacilitationCanvas(f)),
      board = image.board,
      versionId = randomUUID();
    expect(
      (
        await facilitateCanvas(f, board, {
          type: "version_create",
          versionId,
          name: "Image reference",
        })
      ).statusCode,
    ).toBe(200);
    const input = intent(board.id, versionId);
    expect(
      (
        await f.app.inject({
          method: "POST",
          url: destination.path,
          headers: f.owner.headers,
          payload: input,
        })
      ).statusCode,
    ).toBe(200);
    const delayed = delayedCanvasImageRead(read),
      pending = f.app.inject({
        url: `${destination.path}/${input.linkId}/media/${image.mediaId}`,
        headers: f.owner.headers,
      });
    await delayed.reading;
    (f.repository as MemoryRepository).workspaceMembers.delete(
      `${f.workspaceId}:${f.owner.userId}`,
    );
    delayed.release();
    const denied = await pending;
    expect([401, 404]).toContain(denied.statusCode);
    expect(denied.headers["content-type"]).not.toBe("image/png");
  });
});
