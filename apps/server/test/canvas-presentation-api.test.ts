import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CanvasGuestPresenterViewSchema,
  CanvasPresenterViewSchema,
  type CanvasPresenterMutation,
} from "@openround/contracts";
import {
  canvasFacilitationFeatures,
  canvasFacilitationFixture as fixture,
  canvasObjectCommand,
  closeCanvasFacilitationFixtures,
  createFacilitationCanvas as create,
  createFacilitationWorkshop,
  insertCanvasObjects,
  shareFacilitationCanvas as share,
  type CanvasFacilitationFixture,
  type CanvasFixtureActor,
} from "./support/canvas-facilitation-fixture.js";

afterEach(closeCanvasFacilitationFixtures);
const viewport = { x: 20, y: 30, width: 800, height: 600 };
function present(
  f: CanvasFacilitationFixture,
  boardId: string,
  input: CanvasPresenterMutation,
  actor: CanvasFixtureActor = f.owner,
) {
  return f.app.inject({
    method: "POST",
    url: `/v1/canvas-boards/${boardId}/presenter`,
    headers: actor.headers,
    payload: input,
  });
}
function start(
  command: Extract<CanvasPresenterMutation["command"], { type: "start" }> = {
    type: "start",
    audience: "team",
    frameId: null,
    viewport,
  },
): CanvasPresenterMutation {
  const operationId = randomUUID();
  return { schemaVersion: 1, operationId, sessionId: operationId, expectedRevision: 0, command };
}

describe("ephemeral canvas presentation HTTP boundaries", () => {
  it("serves an expiring attention cue with replay-safe CAS updates and no board content", async () => {
    const f = await fixture(),
      board = await create(f);
    const input = start(),
      opened = await present(f, board.id, input);
    expect(opened.statusCode, opened.body).toBe(200);
    const view = CanvasPresenterViewSchema.parse(opened.json().presenter);
    expect(view).toMatchObject({
      boardId: board.id,
      active: true,
      revision: 1,
      sessionId: input.sessionId,
      presenterId: f.owner.userId,
      viewport,
    });
    expect(Date.parse(view.expiresAt!)).toBeLessThanOrEqual(Date.now() + 15000);
    const replay = await present(f, board.id, input);
    expect(replay.statusCode, replay.body).toBe(200);
    expect(replay.json().presenter.revision).toBe(1);
    const changedRetry = await present(f, board.id, {
      ...input,
      command: { type: "start", audience: "team", frameId: null, viewport: { ...viewport, x: 99 } },
    });
    expect(changedRetry.statusCode, changedRetry.body).toBe(409);
    expect(changedRetry.json().error.code).toBe("IDEMPOTENCY_CONFLICT");
    const stale = await present(f, board.id, {
      ...input,
      operationId: randomUUID(),
      expectedRevision: 0,
      command: { type: "update", audience: "team", frameId: null, viewport },
    });
    expect(stale.statusCode, stale.body).toBe(409);
    expect(stale.json().error.code).toBe("STALE_DRAFT");
    vi.spyOn(f.cache, "setCanvasPresenter").mockResolvedValueOnce(false);
    const lostCas = await present(f, board.id, {
      ...input,
      operationId: randomUUID(),
      expectedRevision: 1,
      command: { type: "update", audience: "team", frameId: null, viewport },
    });
    expect(lostCas.statusCode, lostCas.body).toBe(409);
    const read = await f.app.inject({
      url: `/v1/canvas-boards/${board.id}/presenter`,
      headers: f.owner.headers,
    });
    expect(read.statusCode, read.body).toBe(200);
    expect(read.json().presenter.revision).toBe(1);
    expect(read.headers["cache-control"]).toBe("private, no-store");
    for (const key of ["objects", "grants", "sourceBoard", "credentials"])
      expect(read.body).not.toContain(key);
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now + 16000);
    const expired = await f.app.inject({
      url: `/v1/canvas-boards/${board.id}/presenter`,
      headers: f.owner.headers,
    });
    expect(expired.statusCode, expired.body).toBe(200);
    expect(expired.json().presenter).toMatchObject({
      active: false,
      revision: 0,
      sessionId: null,
      viewport: null,
      presenterId: null,
    });
  });

  it("denies editor/viewer and foreign workspace control, foreign sessions, and updates by a different facilitator", async () => {
    const f = await fixture(),
      board = await create(f);
    await share(f, board, f.editor, "editor");
    await share(f, board, f.billing, "viewer");
    for (const [actor, status] of [
      [f.editor, 403],
      [f.billing, 403],
      [f.outsider, 404],
    ] as const) {
      const response = await present(f, board.id, start(), actor);
      expect(response.statusCode, response.body).toBe(status);
    }
    const granted = await canvasObjectCommand(f, board, {
      type: "grant",
      userId: f.editor.userId,
      role: "facilitator",
    });
    expect(granted.statusCode, granted.body).toBe(200);
    const input = start();
    expect((await present(f, board.id, input)).statusCode).toBe(200);
    const foreign = await present(
      f,
      board.id,
      {
        ...input,
        operationId: randomUUID(),
        sessionId: randomUUID(),
        expectedRevision: 1,
        command: { type: "update", audience: "team", frameId: null, viewport },
      },
      f.editor,
    );
    expect(foreign.statusCode, foreign.body).toBe(409);
    const otherPresenter = await present(
      f,
      board.id,
      {
        ...input,
        operationId: randomUUID(),
        expectedRevision: 1,
        command: { type: "update", audience: "team", frameId: null, viewport },
      },
      f.editor,
    );
    expect(otherPresenter.statusCode, otherPresenter.body).toBe(403);
    const stopped = await present(
      f,
      board.id,
      { ...input, operationId: randomUUID(), expectedRevision: 1, command: { type: "stop" } },
      f.editor,
    );
    expect(stopped.statusCode, stopped.body).toBe(200);
    expect(stopped.json().presenter.active).toBe(false);
  });

  it("permits guest cues only for a currently published workshop frame and omits presenter identity and arbitrary viewport", async () => {
    const f = await fixture();
    const { sourceId, guest, board: initialBoard } = await createFacilitationWorkshop(f);
    let board = initialBoard;
    board = await insertCanvasObjects(f, board, [
      { type: "frame", visibility: "team", text: "Private frame" },
      { type: "frame", visibility: "published", text: "Public frame" },
    ]);
    const privateFrame = board.objects.find((object) => object.text === "Private frame")!;
    const publicFrame = board.objects.find((object) => object.text === "Public frame")!;
    const privateStart = start({
      type: "start",
      audience: "published",
      frameId: privateFrame.id,
      viewport: null,
    });
    const denied = await present(f, board.id, privateStart);
    expect(denied.statusCode, denied.body).toBe(422);
    const unbounded = await present(
      f,
      board.id,
      start({ type: "start", audience: "published", frameId: publicFrame.id, viewport }),
    );
    expect(unbounded.statusCode, unbounded.body).toBe(422);
    const input = start({
      type: "start",
      audience: "published",
      frameId: publicFrame.id,
      viewport: null,
    });
    expect((await present(f, board.id, input)).statusCode).toBe(200);
    const path = `/v1/canvas-boards/workshop/${sourceId}/guest/presenter`;
    const response = await f.app.inject({ url: path, headers: { ...guest, ...f.owner.headers } });
    expect(response.statusCode, response.body).toBe(200);
    const cue = CanvasGuestPresenterViewSchema.parse(response.json().presenter);
    expect(cue).toMatchObject({
      active: true,
      frameId: publicFrame.id,
      audience: "published",
      viewport: null,
    });
    for (const excluded of [
      "presenterId",
      f.owner.userId,
      "objects",
      "Private frame",
      "Public frame",
      privateFrame.id,
    ])
      expect(response.body).not.toContain(excluded);
    expect((await f.app.inject({ url: path, headers: f.owner.headers })).statusCode).toBe(401);
    const unpublished = await canvasObjectCommand(f, board, {
      type: "batch",
      operations: [
        {
          type: "update",
          id: publicFrame.id,
          expectedVersion: publicFrame.version,
          patch: { visibility: "team" },
        },
      ],
    });
    expect(unpublished.statusCode, unpublished.body).toBe(200);
    const hidden = await f.app.inject({ url: path, headers: guest });
    expect(hidden.statusCode, hidden.body).toBe(200);
    expect(hidden.json().presenter).toMatchObject({ active: false, frameId: null, viewport: null });
    expect(hidden.body).not.toContain(publicFrame.id);
  });

  it("keeps a team-only presentation invisible to guests even with a privileged creator cookie", async () => {
    const f = await fixture();
    const { board, sourceId, guest } = await createFacilitationWorkshop(f);
    const input = start();
    expect((await present(f, board.id, input)).statusCode).toBe(200);
    const response = await f.app.inject({
      url: `/v1/canvas-boards/workshop/${sourceId}/guest/presenter`,
      headers: { ...guest, ...f.owner.headers },
    });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json().presenter).toMatchObject({
      active: false,
      audience: "published",
      viewport: null,
      sessionId: null,
      frameId: null,
    });
    expect(response.body).not.toContain(f.owner.userId);
    expect(response.body).not.toContain(input.sessionId);
  });

  it("suppresses a revoked presenter's lease and applies feature gates to reads and writes", async () => {
    const f = await fixture(),
      board = await create(f);
    await share(f, board, f.editor, "facilitator");
    expect((await present(f, board.id, start(), f.editor)).statusCode).toBe(200);
    const revoke = await f.app.inject({
      method: "DELETE",
      url: `/v1/canvas-boards/${board.id}/grants/${f.editor.userId}`,
      headers: f.owner.headers,
    });
    expect(revoke.statusCode, revoke.body).toBe(204);
    const suppressed = await f.app.inject({
      url: `/v1/canvas-boards/${board.id}/presenter`,
      headers: f.owner.headers,
    });
    expect(suppressed.statusCode, suppressed.body).toBe(200);
    expect(suppressed.json().presenter.active).toBe(false);
    await f.platform.saveFeaturePolicy({
      expectedRevision: 1,
      features: {
        ...structuredClone(canvasFacilitationFeatures),
        canvasBoardRealtime: { enabled: false, plans: ["free", "pro", "team"] },
        canvasBoards: { enabled: false, plans: ["free", "pro", "team"] },
      },
    });
    for (const suffix of ["presenter", "facilitation"])
      expect(
        (
          await f.app.inject({
            url: `/v1/canvas-boards/${board.id}/${suffix}`,
            headers: f.owner.headers,
          })
        ).statusCode,
      ).toBe(404);
    expect((await present(f, board.id, start())).statusCode).toBe(404);
    const exportDenied = await f.app.inject({
      method: "POST",
      url: `/v1/canvas-boards/${board.id}/export`,
      headers: f.owner.headers,
      payload: { schemaVersion: 1, format: "svg", region: null },
    });
    expect(exportDenied.statusCode, exportDenied.body).toBe(404);
  });
});
