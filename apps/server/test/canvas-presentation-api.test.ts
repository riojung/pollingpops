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

import { hashToken } from "../src/security.js";
import { CanvasPresenterService } from "../src/canvas-presenter.js";

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

function delayedPresenterRead(f: CanvasFacilitationFixture) {
  let entered!: () => void, release!: () => void;
  const reading = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  const read = f.cache.getCanvasPresenter!.bind(f.cache);
  vi.spyOn(f.cache, "getCanvasPresenter").mockImplementationOnce(async (id) => {
    const value = await read(id);
    entered();
    await released;
    return value;
  });
  return { reading, release };
}

describe("creator presenter request-local guard consolidation", () => {
  it("uses exactly two fresh Canvas authorizations for an inactive creator GET", async () => {
    const f = await fixture(),
      board = await create(f);
    const authorize = vi.spyOn(f.canvasBoards, "authorize");
    const response = await f.app.inject({
      url: `/v1/canvas-boards/${board.id}/presenter`,
      headers: f.owner.headers,
    });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json().presenter).toMatchObject({
      active: false,
      presenterId: null,
      viewport: null,
    });
    expect(authorize).toHaveBeenCalledTimes(2);
    expect(
      authorize.mock.calls.every(
        ([actor, id]) => actor.userId === f.owner.userId && id === board.id,
      ),
    ).toBe(true);
  });

  it.each(["session", "grant", "delete", "feature"] as const)(
    "fails closed when %s changes during a delayed cache read",
    async (change) => {
      const f = await fixture(),
        board = await create(f);
      await share(f, board, f.editor, "viewer");
      const input = start();
      expect((await present(f, board.id, input)).statusCode).toBe(200);
      const delay = delayedPresenterRead(f);
      const pending = f.app.inject({
        url: `/v1/canvas-boards/${board.id}/presenter`,
        headers: f.editor.headers,
      });
      await delay.reading;
      try {
        if (change === "session") {
          const cookie = f.editor.headers.cookie;
          await f.repository.revokeCreatorSession(hashToken(cookie.slice(cookie.indexOf("=") + 1)));
        } else if (change === "grant") {
          await f.canvasBoards.revokeGrant({ userId: f.owner.userId }, board.id, f.editor.userId);
        } else if (change === "delete") {
          await f.canvasBoards.delete({ userId: f.owner.userId }, board.id);
        } else {
          await f.platform.saveFeaturePolicy({
            expectedRevision: 1,
            features: {
              ...structuredClone(canvasFacilitationFeatures),
              canvasBoardRealtime: { enabled: false, plans: ["free", "pro", "team"] },
            },
          });
        }
      } finally {
        delay.release();
      }
      const response = await pending;
      expect(response.statusCode, response.body).toBe(change === "session" ? 401 : 404);
      expect(response.body).not.toContain(input.sessionId);
      expect(response.body).not.toContain("presenterId");
    },
  );

  it("rechecks an active presenter's eligibility after the cache await", async () => {
    const f = await fixture(),
      board = await create(f);
    await share(f, board, f.editor, "facilitator");
    const input = start();
    expect((await present(f, board.id, input, f.editor)).statusCode).toBe(200);
    const delay = delayedPresenterRead(f);
    const pending = f.app.inject({
      url: `/v1/canvas-boards/${board.id}/presenter`,
      headers: f.owner.headers,
    });
    await delay.reading;
    try {
      await f.canvasBoards.revokeGrant({ userId: f.owner.userId }, board.id, f.editor.userId);
    } finally {
      delay.release();
    }
    const response = await pending;
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json().presenter).toMatchObject({
      active: false,
      presenterId: null,
      viewport: null,
    });
    expect(response.body).not.toContain(input.sessionId);
  });

  it("suppresses an expired cached lease even when Redis returned its earlier value", async () => {
    const f = await fixture(),
      board = await create(f);
    expect((await present(f, board.id, start())).statusCode).toBe(200);
    const delay = delayedPresenterRead(f);
    const pending = f.app.inject({
      url: `/v1/canvas-boards/${board.id}/presenter`,
      headers: f.owner.headers,
    });
    await delay.reading;
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 16_000);
    delay.release();
    const response = await pending;
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json().presenter).toMatchObject({
      active: false,
      sessionId: null,
      viewport: null,
    });
  });

  it.each(["canvasSeq", "sourceRevision"] as const)("retains the final %s fence", async (field) => {
    const f = await fixture(),
      board = await create(f);
    const input = start();
    expect((await present(f, board.id, input)).statusCode).toBe(200);
    const original = f.canvasBoards.authorize.bind(f.canvasBoards);
    let calls = 0;
    vi.spyOn(f.canvasBoards, "authorize").mockImplementation(async (...args) => {
      const access = await original(...args);
      // Active team cue has an intervening presenter-owner authorization.
      if (++calls === 3) return { ...access, [field]: (access[field] ?? 0) + 1 };
      return access;
    });
    const response = await f.app.inject({
      url: `/v1/canvas-boards/${board.id}/presenter`,
      headers: f.owner.headers,
    });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json().presenter).toMatchObject({ active: false, viewport: null });
    expect(response.body).not.toContain(input.sessionId);
  });

  it("checks the board deadline synchronously after the final authorization resolves", async () => {
    const f = await fixture(),
      board = await create(f);
    const original = f.canvasBoards.authorize.bind(f.canvasBoards);
    let calls = 0;
    vi.spyOn(f.canvasBoards, "authorize").mockImplementation(async (...args) => {
      const access = await original(...args);
      if (++calls === 2) vi.spyOn(Date, "now").mockReturnValue(Date.parse(access.expiresAt));
      return access;
    });
    const response = await f.app.inject({
      url: `/v1/canvas-boards/${board.id}/presenter`,
      headers: f.owner.headers,
    });
    expect(response.statusCode, response.body).toBe(404);
  });

  it("suppresses a frame unpublished while its current-scene read is delayed", async () => {
    const f = await fixture(),
      workshop = await createFacilitationWorkshop(f);
    const board = await insertCanvasObjects(f, workshop.board, [
      { type: "frame", visibility: "published", text: "Current public frame" },
    ]);
    const frame = board.objects.find((object) => object.type === "frame")!;
    const input = start({
      type: "start",
      audience: "published",
      frameId: frame.id,
      viewport: null,
    });
    expect((await present(f, board.id, input)).statusCode).toBe(200);
    let entered!: () => void, release!: () => void;
    const reading = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    const get = f.canvasBoards.get.bind(f.canvasBoards);
    vi.spyOn(f.canvasBoards, "get").mockImplementationOnce(async (...args) => {
      const value = await get(...args);
      entered();
      await released;
      return value;
    });
    const pending = f.app.inject({
      url: `/v1/canvas-boards/${board.id}/presenter`,
      headers: f.owner.headers,
    });
    await reading;
    try {
      const changed = await canvasObjectCommand(f, board, {
        type: "batch",
        operations: [
          {
            type: "update",
            id: frame.id,
            expectedVersion: frame.version,
            patch: { visibility: "team" },
          },
        ],
      });
      expect(changed.statusCode, changed.body).toBe(200);
    } finally {
      release();
    }
    const response = await pending;
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json().presenter).toMatchObject({
      active: false,
      frameId: null,
      viewport: null,
    });
    expect(response.body).not.toContain(frame.id);
  });
});

describe("service-owned creator presenter authority", () => {
  it("rejects a different callback actor without substituting it for the captured principal", async () => {
    const f = await fixture(),
      board = await create(f);
    const service = new CanvasPresenterService(f.canvasBoards, f.cache);
    const actor = { userId: f.owner.userId };
    const authorize = vi.spyOn(f.canvasBoards, "authorize");
    const currentActor = vi.fn(async () => {
      // Mutating the supplied object must not change the service's captured identity.
      actor.userId = f.editor.userId;
      return { userId: f.editor.userId };
    });
    await expect(
      service.getForRequest(actor, board.id, {
        requireFeature: async () => {},
        currentActor,
      }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(currentActor).toHaveBeenCalledTimes(1);
    expect(authorize).toHaveBeenCalledTimes(1);
    expect(authorize.mock.calls[0]?.[0].userId).toBe(f.owner.userId);
  });

  it("reauthorizes after grant loss during the final actor callback await", async () => {
    const f = await fixture(),
      board = await create(f);
    await share(f, board, f.editor, "viewer");
    const service = new CanvasPresenterService(f.canvasBoards, f.cache);
    let entered!: () => void, release!: () => void;
    const reading = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    const pending = service.getForRequest({ userId: f.editor.userId }, board.id, {
      requireFeature: async () => {},
      currentActor: async () => {
        entered();
        await released;
        return { userId: f.editor.userId };
      },
    });
    // Observe rejection immediately so the deliberately delayed request has no unhandled turn.
    const rejected = expect(pending).rejects.toMatchObject({ code: "NOT_FOUND" });
    await reading;
    try {
      await f.canvasBoards.revokeGrant({ userId: f.owner.userId }, board.id, f.editor.userId);
    } finally {
      release();
    }
    await rejected;
  });
});
