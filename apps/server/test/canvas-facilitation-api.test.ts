import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CanvasBoardViewSchema,
  CanvasFacilitationResponseSchema,
  CanvasFacilitationViewSchema,
  CanvasGuestFacilitationViewSchema,
  CanvasVersionViewSchema,
} from "@openround/contracts";
import {
  canvasFacilitationFixture as fixture,
  canvasObjectCommand,
  closeCanvasFacilitationFixtures,
  createFacilitationCanvas as create,
  createFacilitationWorkshop,
  delayedCanvasImageRead,
  facilitateCanvas,
  insertCanvasObjects,
  insertFacilitationImage,
  shareFacilitationCanvas as share,
  syntheticCanvasPng,
  syntheticCanvasStorage,
} from "./support/canvas-facilitation-fixture.js";

afterEach(closeCanvasFacilitationFixtures);
const exportPayload = { schemaVersion: 1, format: "svg", region: null, background: "white" };

async function approvedWorkshopRaceScene(f: Awaited<ReturnType<typeof fixture>>) {
  const { board: initial, sourceId, guest } = await createFacilitationWorkshop(f, true);
  const protectedBody = "Synthetic canonical body removed during response delivery";
  const submitted = await f.app.inject({
    method: "POST",
    url: `/v1/idea-boards/${sourceId}/ideas`,
    headers: guest,
    payload: { body: protectedBody, idempotencyKey: randomUUID() },
  });
  expect(submitted.statusCode, submitted.body).toBe(200);
  const ideaId = submitted.json().ownIdeas[0].id as string;
  async function moderate(status: "approved" | "removed") {
    const latest = await f.app.inject({
      url: `/v1/canvas-boards/${initial.id}`,
      headers: f.owner.headers,
    });
    expect(latest.statusCode, latest.body).toBe(200);
    const response = await canvasObjectCommand(f, initial, {
      type: "workshop",
      expectedRevision: latest.json().board.sourceBoard.revision,
      command: { type: "moderate", ideaId, status },
    });
    expect(response.statusCode, response.body).toBe(200);
    return CanvasBoardViewSchema.parse(response.json().board);
  }
  const board = await moderate("approved");
  const reference = board.objects.find(
    (object) => object.type === "idea_ref" && object.ideaId === ideaId,
  )!;
  expect(
    reference,
    "approved source idea must have a current reference before the barrier",
  ).toBeTruthy();
  return { board, reference, protectedBody, remove: () => moderate("removed") };
}

describe("canvas facilitation HTTP authorization and current projections", () => {
  it("wraps current facilitation and gives licensed editors, billing viewers and outsiders only their permitted actions", async () => {
    const f = await fixture(),
      board = await create(f);
    await share(f, board, f.editor, "editor");
    await share(f, board, f.billing, "viewer");
    for (const [actor, comment, controlTimer] of [
      [f.owner, true, true],
      [f.editor, true, false],
      [f.billing, false, false],
    ] as const) {
      const response = await f.app.inject({
        url: `/v1/canvas-boards/${board.id}/facilitation`,
        headers: actor.headers,
      });
      expect(response.statusCode, response.body).toBe(200);
      const view = CanvasFacilitationViewSchema.parse(response.json().facilitation);
      expect(Object.keys(response.json())).toEqual(["facilitation"]);
      expect(view).toMatchObject({
        boardId: board.id,
        actorId: actor.userId,
        capabilities: { comment, controlTimer },
        threads: [],
        versions: [],
      });
      expect(response.headers["cache-control"]).toBe("private, no-store");
    }
    const denied = await f.app.inject({
      url: `/v1/canvas-boards/${board.id}/facilitation`,
      headers: f.outsider.headers,
    });
    expect(denied.statusCode, denied.body).toBe(404);
    const billing = await facilitateCanvas(
      f,
      board,
      { type: "version_create", versionId: randomUUID(), name: "Denied checkpoint" },
      f.billing,
    );
    expect(billing.statusCode, billing.body).toBe(403);
    const foreign = await facilitateCanvas(
      f,
      board,
      { type: "timer_start", expectedRevision: 0, durationSeconds: 60 },
      f.outsider,
    );
    expect(foreign.statusCode, foreign.body).toBe(404);
  });

  it("keeps comment receipts idempotent, rejects stale replies and protects author edits while permitting facilitator deletion", async () => {
    const f = await fixture();
    let board = await create(f);
    await share(f, board, f.editor, "editor");
    board = await insertCanvasObjects(f, board, [{}]);
    const threadId = randomUUID(),
      messageId = randomUUID(),
      operationId = randomUUID();
    const command = {
      type: "comment_thread_create" as const,
      threadId,
      messageId,
      objectId: board.objects[0]!.id,
      text: "Synthetic anchored discussion",
    };
    const created = await facilitateCanvas(f, board, command, f.editor, operationId);
    expect(created.statusCode, created.body).toBe(200);
    const first = CanvasFacilitationResponseSchema.parse(created.json());
    const replay = await facilitateCanvas(f, board, command, f.editor, operationId);
    expect(replay.statusCode, replay.body).toBe(200);
    expect(replay.json().receipt).toEqual(first.receipt);
    expect(replay.json().facilitation.threads).toHaveLength(1);
    const conflict = await facilitateCanvas(
      f,
      board,
      { ...command, text: "Changed retry" },
      f.editor,
      operationId,
    );
    expect(conflict.statusCode, conflict.body).toBe(409);
    expect(conflict.json().error.code).toBe("IDEMPOTENCY_CONFLICT");
    const stale = await facilitateCanvas(
      f,
      board,
      {
        type: "comment_reply",
        threadId,
        expectedVersion: 0,
        messageId: randomUUID(),
        text: "Stale reply",
      },
      f.editor,
    );
    expect(stale.statusCode, stale.body).toBe(409);
    expect(stale.json().error.code).toBe("STALE_DRAFT");
    const otherAuthor = await facilitateCanvas(f, board, {
      type: "comment_edit",
      threadId,
      expectedVersion: 1,
      messageId,
      text: "Changed by another author",
    });
    expect(otherAuthor.statusCode, otherAuthor.body).toBe(403);
    const removed = await facilitateCanvas(f, board, {
      type: "comment_delete",
      threadId,
      expectedVersion: 1,
      messageId,
    });
    expect(removed.statusCode, removed.body).toBe(200);
    expect(removed.json().facilitation.threads[0].messages[0]).toMatchObject({
      deleted: true,
      text: "",
      version: 2,
    });
  });

  it("keeps timer control facilitator-only with an authoritative deadline and revision conflicts", async () => {
    const f = await fixture(),
      board = await create(f);
    await share(f, board, f.editor, "editor");
    const denied = await facilitateCanvas(
      f,
      board,
      { type: "timer_start", expectedRevision: 0, durationSeconds: 60 },
      f.editor,
    );
    expect(denied.statusCode, denied.body).toBe(403);
    const started = await facilitateCanvas(f, board, {
      type: "timer_start",
      expectedRevision: 0,
      durationSeconds: 60,
    });
    expect(started.statusCode, started.body).toBe(200);
    const timer = started.json().facilitation.timer;
    expect(timer).toMatchObject({ revision: 1, status: "running", durationSeconds: 60 });
    expect(Date.parse(timer.deadlineAt)).toBeGreaterThan(Date.now() + 59000);
    const stale = await facilitateCanvas(f, board, { type: "timer_pause", expectedRevision: 0 });
    expect(stale.statusCode, stale.body).toBe(409);
    const paused = await facilitateCanvas(f, board, { type: "timer_pause", expectedRevision: 1 });
    expect(paused.statusCode, paused.body).toBe(200);
    expect(paused.json().facilitation.timer).toMatchObject({
      status: "paused",
      deadlineAt: null,
      revision: 2,
    });
  });

  it("reauthorizes a facilitation read after its shared grant is revoked", async () => {
    const f = await fixture(),
      board = await create(f);
    await share(f, board, f.editor, "editor");
    const original = f.canvasBoards.getFacilitation.bind(f.canvasBoards);
    vi.spyOn(f.canvasBoards, "getFacilitation").mockImplementationOnce(async (...args) => {
      const value = await original(...args);
      const revoked = await f.app.inject({
        method: "DELETE",
        url: `/v1/canvas-boards/${board.id}/grants/${f.editor.userId}`,
        headers: f.owner.headers,
      });
      expect(revoked.statusCode, revoked.body).toBe(204);
      return value;
    });
    const denied = await f.app.inject({
      url: `/v1/canvas-boards/${board.id}/facilitation`,
      headers: f.editor.headers,
    });
    expect(denied.statusCode, denied.body).toBe(404);
    expect(denied.body).not.toContain('"threads"');
  });

  it("rejects a saved version body when its approved source idea is removed after snapshot creation", async () => {
    const f = await fixture();
    const { board, protectedBody, remove } = await approvedWorkshopRaceScene(f);
    const versionId = randomUUID();
    const saved = await facilitateCanvas(f, board, {
      type: "version_create",
      versionId,
      name: "Before delivery race",
    });
    expect(saved.statusCode, saved.body).toBe(200);
    const original = f.canvasBoards.getVersion.bind(f.canvasBoards);
    vi.spyOn(f.canvasBoards, "getVersion").mockImplementationOnce(async (...args) => {
      const stale = await original(...args);
      expect(stale.objects.some((object) => object.idea?.body === protectedBody)).toBe(true);
      await remove();
      return stale;
    });
    const response = await f.app.inject({
      url: `/v1/canvas-boards/${board.id}/versions/${versionId}`,
      headers: f.owner.headers,
    });
    expect(response.statusCode, response.body).toBe(409);
    expect(response.json().error.code).toBe("STALE_DRAFT");
    expect(response.body).not.toContain(protectedBody);
    expect(response.body).not.toContain('"objects"');
  });

  it("rejects an anchored discussion snapshot when source moderation purges its thread before final authorization", async () => {
    const f = await fixture();
    const { board, reference, protectedBody, remove } = await approvedWorkshopRaceScene(f);
    const text = "Synthetic anchored discussion removed before GET delivery";
    const created = await facilitateCanvas(f, board, {
      type: "comment_thread_create",
      threadId: randomUUID(),
      messageId: randomUUID(),
      objectId: reference.id,
      text,
    });
    expect(created.statusCode, created.body).toBe(200);
    const original = f.canvasBoards.getFacilitation.bind(f.canvasBoards);
    vi.spyOn(f.canvasBoards, "getFacilitation").mockImplementationOnce(async (...args) => {
      const stale = await original(...args);
      expect(
        stale.threads.some((thread) => thread.messages.some((message) => message.text === text)),
      ).toBe(true);
      await remove();
      return stale;
    });
    const response = await f.app.inject({
      url: `/v1/canvas-boards/${board.id}/facilitation`,
      headers: f.owner.headers,
    });
    expect(response.statusCode, response.body).toBe(409);
    expect(response.json().error.code).toBe("STALE_DRAFT");
    for (const excluded of [text, protectedBody, '"threads"'])
      expect(response.body).not.toContain(excluded);
    const current = await f.app.inject({
      url: `/v1/canvas-boards/${board.id}/facilitation`,
      headers: f.owner.headers,
    });
    expect(current.statusCode, current.body).toBe(200);
    expect(current.json().facilitation.threads).toEqual([]);
  });

  it("rejects a POST comment response snapshot when its canonical anchor is removed before response authorization", async () => {
    const f = await fixture();
    const { board, reference, protectedBody, remove } = await approvedWorkshopRaceScene(f);
    const text = "Synthetic comment removed before POST delivery";
    const original = f.canvasBoards.facilitate.bind(f.canvasBoards);
    vi.spyOn(f.canvasBoards, "facilitate").mockImplementationOnce(async (...args) => {
      const stale = await original(...args);
      expect(
        stale.facilitation.threads.some((thread) =>
          thread.messages.some((message) => message.text === text),
        ),
      ).toBe(true);
      await remove();
      return stale;
    });
    const response = await facilitateCanvas(f, board, {
      type: "comment_thread_create",
      threadId: randomUUID(),
      messageId: randomUUID(),
      objectId: reference.id,
      text,
    });
    expect(response.statusCode, response.body).toBe(409);
    expect(response.json().error.code).toBe("STALE_DRAFT");
    for (const excluded of [text, protectedBody, '"threads"', '"receipt"'])
      expect(response.body).not.toContain(excluded);
    const current = await f.app.inject({
      url: `/v1/canvas-boards/${board.id}/facilitation`,
      headers: f.owner.headers,
    });
    expect(current.statusCode, current.body).toBe(200);
    expect(current.json().facilitation.threads).toEqual([]);
  });

  it("returns named history directly, retains a removed team object, and denies foreign board or guest history reads", async () => {
    const f = await fixture();
    let board = await create(f);
    await share(f, board, f.billing, "viewer");
    board = await insertCanvasObjects(f, board, [{ text: "Saved synthetic object" }]);
    const versionId = randomUUID();
    const saved = await facilitateCanvas(f, board, {
      type: "version_create",
      versionId,
      name: "Before removal",
    });
    expect(saved.statusCode, saved.body).toBe(200);
    const object = board.objects[0]!;
    expect(
      (
        await canvasObjectCommand(f, board, {
          type: "batch",
          operations: [{ type: "delete", id: object.id, expectedVersion: object.version }],
        })
      ).statusCode,
    ).toBe(200);
    const path = `/v1/canvas-boards/${board.id}/versions/${versionId}`;
    const read = await f.app.inject({ url: path, headers: f.billing.headers });
    expect(read.statusCode, read.body).toBe(200);
    const version = CanvasVersionViewSchema.parse(read.json());
    expect(version.objects[0]!.text).toBe("Saved synthetic object");
    expect(version.version.name).toBe("Before removal");
    expect(read.json().facilitation).toBeUndefined();
    expect((await f.app.inject({ url: path, headers: f.outsider.headers })).statusCode).toBe(404);
    expect((await f.app.inject({ url: path })).statusCode).toBe(401);
    const other = await create(f);
    expect(
      (
        await f.app.inject({
          url: `/v1/canvas-boards/${other.id}/versions/${versionId}`,
          headers: f.owner.headers,
        })
      ).statusCode,
    ).toBe(404);
  });

  it("rejects unknown facilitation fields and an eleventh checkpoint without raising the retained history cap", async () => {
    const f = await fixture(),
      board = await create(f);
    const malformed = await f.app.inject({
      method: "POST",
      url: `/v1/canvas-boards/${board.id}/facilitation/commands`,
      headers: f.owner.headers,
      payload: {
        schemaVersion: 1,
        operationId: randomUUID(),
        command: { type: "timer_reset", expectedRevision: 0, actorId: f.editor.userId },
      },
    });
    expect(malformed.statusCode, malformed.body).toBe(400);
    for (let index = 0; index < 10; index++) {
      const response = await facilitateCanvas(f, board, {
        type: "version_create",
        versionId: randomUUID(),
        name: `Synthetic checkpoint ${index}`,
      });
      expect(response.statusCode, response.body).toBe(200);
    }
    const overflow = await facilitateCanvas(f, board, {
      type: "version_create",
      versionId: randomUUID(),
      name: "Overflow",
    });
    expect(overflow.statusCode, overflow.body).toBe(422);
    const read = await f.app.inject({
      url: `/v1/canvas-boards/${board.id}/facilitation`,
      headers: f.owner.headers,
    });
    expect(read.json().facilitation.versions).toHaveLength(10);
  });

  it("reprojects saved workshop references after moderation removes their canonical idea", async () => {
    const f = await fixture();
    const { board, sourceId, guest } = await createFacilitationWorkshop(f, true);
    const submitted = await f.app.inject({
      method: "POST",
      url: `/v1/idea-boards/${sourceId}/ideas`,
      headers: guest,
      payload: { body: "Approved historical synthetic proposal", idempotencyKey: randomUUID() },
    });
    expect(submitted.statusCode, submitted.body).toBe(200);
    const ideaId = submitted.json().ownIdeas[0].id as string;
    const moderate = async (status: "approved" | "removed") => {
      const latest = await f.app.inject({
        url: `/v1/canvas-boards/${board.id}`,
        headers: f.owner.headers,
      });
      const response = await canvasObjectCommand(f, board, {
        type: "workshop",
        expectedRevision: latest.json().board.sourceBoard.revision,
        command: { type: "moderate", ideaId, status },
      });
      expect(response.statusCode, response.body).toBe(200);
    };
    await moderate("approved");
    const versionId = randomUUID();
    const saved = await facilitateCanvas(f, board, {
      type: "version_create",
      versionId,
      name: "Canonical idea reference",
    });
    expect(saved.statusCode, saved.body).toBe(200);
    const path = `/v1/canvas-boards/${board.id}/versions/${versionId}`;
    const before = await f.app.inject({ url: path, headers: f.owner.headers });
    expect(before.statusCode, before.body).toBe(200);
    expect(before.body).toContain("Approved historical synthetic proposal");
    await moderate("removed");
    const after = await f.app.inject({ url: path, headers: f.owner.headers });
    expect(after.statusCode, after.body).toBe(200);
    const version = CanvasVersionViewSchema.parse(after.json());
    expect(version.objects).toEqual([]);
    expect(version.version.objectCount).toBe(0);
    expect(after.body).not.toContain("Approved historical synthetic proposal");
  });

  it("serves history-only clean image bytes and rechecks the checkpoint during asynchronous storage reads", async () => {
    const f = await fixture(true),
      read = syntheticCanvasStorage(f);
    let board = await create(f);
    const image = await insertFacilitationImage(f, board);
    board = image.board;
    const versionId = randomUUID();
    expect(
      (
        await facilitateCanvas(f, board, {
          type: "version_create",
          versionId,
          name: "Image checkpoint",
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await canvasObjectCommand(f, board, {
          type: "batch",
          operations: [
            { type: "delete", id: image.object.id, expectedVersion: image.object.version },
          ],
        })
      ).statusCode,
    ).toBe(200);
    const path = `/v1/canvas-boards/${board.id}/versions/${versionId}/media/${image.mediaId}`;
    expect(
      (
        await f.app.inject({
          url: `/v1/canvas-boards/${board.id}/media/${image.mediaId}`,
          headers: f.owner.headers,
        })
      ).statusCode,
    ).toBe(404);
    const available = await f.app.inject({ url: path, headers: f.owner.headers });
    expect(available.statusCode, available.body).toBe(200);
    expect(available.rawPayload.equals(syntheticCanvasPng)).toBe(true);
    expect(available.headers).toMatchObject({
      "cache-control": "private, no-store",
      "content-type": "image/png",
      "x-content-type-options": "nosniff",
    });
    const delayed = delayedCanvasImageRead(read),
      pending = f.app.inject({ url: path, headers: f.owner.headers });
    await delayed.reading;
    const deleted = await facilitateCanvas(f, board, {
      type: "version_delete",
      versionId,
      expectedVersion: 1,
    });
    expect(deleted.statusCode, deleted.body).toBe(200);
    delayed.release();
    const denied = await pending;
    expect(denied.statusCode, denied.body).toBe(404);
    expect(denied.headers["content-type"]).not.toBe("image/png");
  });

  it("keeps guest facilitation timer-only and Bearer-scoped even beside an owner cookie", async () => {
    const f = await fixture();
    const { board, sourceId, guest } = await createFacilitationWorkshop(f);
    const withObject = await insertCanvasObjects(f, board, [{}]);
    await facilitateCanvas(f, board, {
      type: "comment_thread_create",
      threadId: randomUUID(),
      messageId: randomUUID(),
      objectId: withObject.objects[0]!.id,
      text: "Private synthetic team comment",
    });
    await facilitateCanvas(f, board, {
      type: "version_create",
      versionId: randomUUID(),
      name: "Private synthetic checkpoint",
    });
    await facilitateCanvas(f, board, {
      type: "timer_start",
      expectedRevision: 0,
      durationSeconds: 60,
    });
    const path = `/v1/canvas-boards/workshop/${sourceId}/guest/facilitation`;
    const response = await f.app.inject({ url: path, headers: { ...guest, ...f.owner.headers } });
    expect(response.statusCode, response.body).toBe(200);
    const view = CanvasGuestFacilitationViewSchema.parse(response.json().facilitation);
    expect(view.timer.status).toBe("running");
    expect(Object.keys(view).sort()).toEqual(
      ["schemaVersion", "boardId", "canvasSeq", "serverNow", "timer"].sort(),
    );
    for (const excluded of ["threads", "versions", "actorId", f.owner.userId, "Private synthetic"])
      expect(response.body).not.toContain(excluded);
    expect((await f.app.inject({ url: path, headers: f.owner.headers })).statusCode).toBe(401);
    const unjoined = { authorization: `Bearer ${"a".repeat(64)}`, ...f.owner.headers };
    expect((await f.app.inject({ url: path, headers: unjoined })).statusCode).toBe(404);
  });
});

describe("canvas SVG export HTTP boundaries", () => {
  it("downloads only the current scene with escaped text, approved ideas, fixed headers and no source metadata", async () => {
    const f = await fixture();
    const { sourceId, guest, board: initialBoard } = await createFacilitationWorkshop(f, true);
    let board = initialBoard;
    const submit = async (body: string) => {
      const response = await f.app.inject({
        method: "POST",
        url: `/v1/idea-boards/${sourceId}/ideas`,
        headers: guest,
        payload: { body, idempotencyKey: randomUUID() },
      });
      expect(response.statusCode, response.body).toBe(200);
      return response.json().ownIdeas;
    };
    const ideas = await submit("Approved synthetic proposal");
    const approvedId = ideas[0].id as string;
    await submit("Pending synthetic secret");
    const current = await f.app.inject({
      url: `/v1/canvas-boards/${board.id}`,
      headers: f.owner.headers,
    });
    const moderated = await canvasObjectCommand(f, board, {
      type: "workshop",
      expectedRevision: current.json().board.sourceBoard.revision,
      command: { type: "moderate", ideaId: approvedId, status: "approved" },
    });
    expect(moderated.statusCode, moderated.body).toBe(200);
    board = await insertCanvasObjects(f, board, [{ text: '<script> & "label"' }]);
    await share(f, board, f.billing, "viewer");
    const response = await f.app.inject({
      method: "POST",
      url: `/v1/canvas-boards/${board.id}/export`,
      headers: f.billing.headers,
      payload: exportPayload,
    });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.headers).toMatchObject({
      "content-type": "image/svg+xml; charset=utf-8",
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
      "content-disposition": 'attachment; filename="canvas-export.svg"',
      "referrer-policy": "no-referrer",
    });
    expect(response.body).toContain("&lt;script&gt; &amp; &quot;label&quot;");
    expect(response.body).toContain("Approved synthetic proposal");
    for (const excluded of [
      "Pending synthetic secret",
      "sourceBoard",
      "grants",
      "receipts",
      f.owner.userId,
      sourceId,
      approvedId,
      guest.authorization,
    ])
      expect(response.body).not.toContain(excluded);
    expect(response.body).not.toMatch(/<script|foreignObject|<style|href="https?:/);
    expect(
      (
        await f.app.inject({
          method: "POST",
          url: `/v1/canvas-boards/${board.id}/export`,
          headers: guest,
          payload: exportPayload,
        })
      ).statusCode,
    ).toBe(401);
    expect(
      (
        await f.app.inject({
          method: "POST",
          url: `/v1/canvas-boards/workshop/${sourceId}/guest/export`,
          headers: guest,
          payload: exportPayload,
        })
      ).statusCode,
    ).toBe(404);
  });

  it("rejects unbounded export requests and excess image placements before reading media", async () => {
    const f = await fixture(true),
      read = syntheticCanvasStorage(f);
    let board = await create(f);
    const image = await insertFacilitationImage(f, board);
    board = image.board;
    board = await insertCanvasObjects(
      f,
      board,
      Array.from({ length: 25 }, () => ({
        type: "image",
        mediaId: image.mediaId,
        altText: "Synthetic diagram",
        text: "",
      })),
    );
    const path = `/v1/canvas-boards/${board.id}/export`;
    const invalid = await f.app.inject({
      method: "POST",
      url: path,
      headers: f.owner.headers,
      payload: { ...exportPayload, region: { x: 0, y: 0, width: 100001, height: 1 } },
    });
    expect(invalid.statusCode, invalid.body).toBe(400);
    const png = await f.app.inject({
      method: "POST",
      url: path,
      headers: f.owner.headers,
      payload: { ...exportPayload, format: "png" },
    });
    expect(png.statusCode, png.body).toBe(400);
    const count = await f.app.inject({
      method: "POST",
      url: path,
      headers: f.owner.headers,
      payload: exportPayload,
    });
    expect(count.statusCode, count.body).toBe(422);
    expect(count.json().error.code).toBe("EXPORT_LIMIT");
    expect(read).not.toHaveBeenCalled();
  });

  it("returns no SVG or image bytes when an export reader loses its grant during storage IO", async () => {
    const f = await fixture(true),
      read = syntheticCanvasStorage(f);
    let board = await create(f);
    await share(f, board, f.editor, "editor");
    board = (await insertFacilitationImage(f, board)).board;
    const delayed = delayedCanvasImageRead(read),
      pending = f.app.inject({
        method: "POST",
        url: `/v1/canvas-boards/${board.id}/export`,
        headers: f.editor.headers,
        payload: exportPayload,
      });
    await delayed.reading;
    const revoked = await f.app.inject({
      method: "DELETE",
      url: `/v1/canvas-boards/${board.id}/grants/${f.editor.userId}`,
      headers: f.owner.headers,
    });
    expect(revoked.statusCode, revoked.body).toBe(204);
    delayed.release();
    const response = await pending;
    expect(response.statusCode, response.body).toBe(503);
    expect(response.json().error.code).toBe("EXPORT_MEDIA_UNAVAILABLE");
    expect(response.body).not.toMatch(/<svg|data:image/);
  });

  it("rejects a source privacy change while media is loading before delivering an export", async () => {
    const f = await fixture(true),
      read = syntheticCanvasStorage(f);
    let { board } = await createFacilitationWorkshop(f, true);
    board = (await insertFacilitationImage(f, board)).board;
    const delayed = delayedCanvasImageRead(read),
      pending = f.app.inject({
        method: "POST",
        url: `/v1/canvas-boards/${board.id}/export`,
        headers: f.owner.headers,
        payload: exportPayload,
      });
    await delayed.reading;
    const current = await f.app.inject({
      url: `/v1/canvas-boards/${board.id}`,
      headers: f.owner.headers,
    });
    const changed = await canvasObjectCommand(f, board, {
      type: "workshop",
      expectedRevision: current.json().board.sourceBoard.revision,
      command: { type: "visibility", visible: false },
    });
    expect(changed.statusCode, changed.body).toBe(200);
    delayed.release();
    const response = await pending;
    expect(response.statusCode, response.body).toBe(409);
    expect(response.json().error.code).toBe("STALE_DRAFT");
    expect(response.body).not.toMatch(/<svg|data:image/);
  });
});
