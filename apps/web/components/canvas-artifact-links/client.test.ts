import { afterEach, describe, expect, it, vi } from "vitest";
import { CanvasVersionViewSchema } from "@openround/contracts";
import { canvasId, canvasObject } from "../canvas-boards/canvas-test-fixtures";
import {
  canvasArtifactPath,
  createCanvasArtifactIntent,
  deleteCanvasArtifactIntent,
  eligibleCanvasArtifactLinks,
  listCanvasArtifactLinks,
  readCanvasArtifactPreview,
  writeCanvasArtifactLink,
} from "./client";
const api = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock("../../lib/api", () => ({ apiFetch: api.fetch }));
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const target = { kind: "round" as const, targetId: id(1) };
const link = { id: id(2), boardId: canvasId, versionId: id(3), revision: 1 as const };
const version = {
  id: link.versionId,
  name: "Private checkpoint",
  version: 1,
  createdAt: "2026-10-01T00:00:00.000Z",
  createdBy: null,
  canvasSeq: 1,
  objectCount: 1,
};
const view = () =>
  CanvasVersionViewSchema.parse({
    schemaVersion: 3,
    boardId: canvasId,
    version,
    objects: [canvasObject],
  });
// Genuine saved-scene V1/V2 bodies predate all Canvas V4 text/stroke styles.
const frozenView = (schemaVersion: 1 | 2) => ({
  schemaVersion,
  boardId: canvasId,
  version,
  objects: [
    {
      id: canvasObject.id,
      type: "sticky",
      version: 1,
      x: 20,
      y: 30,
      width: 200,
      height: 160,
      text: "Synthetic canvas note",
      rotation: 0,
      zIndex: 0,
      color: "yellow",
      parentId: null,
      geometricGroupId: null,
      locked: false,
      visibility: "team",
    },
  ],
});
afterEach(() => {
  vi.resetAllMocks();
  vi.useRealTimers();
});
describe("creator artifact link transport", () => {
  it("uses only target-authorized paths, cookies, cancellation and uncached requests", async () => {
    api.fetch
      .mockResolvedValueOnce({ schemaVersion: 1, canCreate: true, links: [] })
      .mockResolvedValueOnce({ schemaVersion: 1, boards: [] });
    const abort = new AbortController();
    await listCanvasArtifactLinks(target, abort.signal);
    await eligibleCanvasArtifactLinks(
      { kind: "presentation", targetId: target.targetId },
      abort.signal,
    );
    expect(api.fetch.mock.calls[0]![0]).toBe(
      `/v1/quizzes/${target.targetId}/canvas-snapshot-links`,
    );
    expect(api.fetch.mock.calls[1]![0]).toBe(
      `/v1/presentations/${target.targetId}/canvas-snapshot-links/eligible`,
    );
    expect(api.fetch.mock.calls[0]![1]).toMatchObject({
      credentials: "include",
      cache: "no-store",
      referrerPolicy: "no-referrer",
      signal: expect.any(AbortSignal),
    });
  });
  it("retains byte-identical create bodies for a lost acknowledgement and accepts a canonical deduped link", async () => {
    const pending = createCanvasArtifactIntent(canvasId, link.versionId, id(4), link.id);
    api.fetch.mockRejectedValueOnce(new TypeError("lost response")).mockResolvedValueOnce({
      schemaVersion: 1,
      receipt: { operationId: id(4), linkId: id(9), deleted: false },
    });
    await expect(writeCanvasArtifactLink(target, pending)).rejects.toThrow();
    await expect(writeCanvasArtifactLink(target, pending)).resolves.toMatchObject({
      receipt: { linkId: id(9) },
    });
    expect(api.fetch.mock.calls[0]![1].body).toBe(api.fetch.mock.calls[1]![1].body);
    expect(JSON.parse(api.fetch.mock.calls[0]![1].body)).toEqual(pending.input);
  });
  it("sends revision-checked deletion with an exact acknowledgement", async () => {
    const pending = deleteCanvasArtifactIntent(link, id(4));
    api.fetch.mockResolvedValue({
      schemaVersion: 1,
      receipt: { operationId: id(4), linkId: link.id, deleted: true },
    });
    await writeCanvasArtifactLink(target, pending);
    expect(api.fetch).toHaveBeenCalledWith(
      `${canvasArtifactPath(target, link.id)}`,
      expect.objectContaining({
        method: "DELETE",
        body: JSON.stringify({ schemaVersion: 1, operationId: id(4), expectedRevision: 1 }),
      }),
    );
    api.fetch.mockResolvedValue({
      schemaVersion: 1,
      receipt: { operationId: id(4), linkId: id(9), deleted: true },
    });
    await expect(writeCanvasArtifactLink(target, pending)).rejects.toThrow("Mismatched");
  });
  it("parses current and frozen saved-scene envelopes and rejects an unrelated scene", async () => {
    api.fetch
      .mockResolvedValueOnce(view())
      .mockResolvedValueOnce(frozenView(1))
      .mockResolvedValueOnce(frozenView(2))
      .mockResolvedValueOnce({ ...view(), boardId: id(9) });
    await expect(readCanvasArtifactPreview(target, link)).resolves.toMatchObject({
      schemaVersion: 3,
    });
    for (const schemaVersion of [1, 2] as const) {
      expect(frozenView(schemaVersion).objects[0]).not.toHaveProperty("fontSize");
      await expect(readCanvasArtifactPreview(target, link)).resolves.toMatchObject({
        schemaVersion: 3,
        objects: [{ id: canvasObject.id, version: 1, fontSize: 16, strokeWidth: 2, opacity: 1 }],
      });
    }
    await expect(readCanvasArtifactPreview(target, link)).rejects.toThrow("Mismatched");
    expect(
      api.fetch.mock.calls.every(
        ([path]) => path === `${canvasArtifactPath(target, link.id)}/preview`,
      ),
    ).toBe(true);
  });
  it.each([1, 2])(
    "rejects current object styles in frozen saved-scene envelope %s",
    async (schemaVersion) => {
      api.fetch.mockResolvedValue({ ...view(), schemaVersion });
      await expect(readCanvasArtifactPreview(target, link)).rejects.toThrow();
    },
  );
  it.each(["../private", "", `${id(1)}/preview`])(
    "rejects invalid path segments before network access: %s",
    async (invalid) => {
      expect(() => canvasArtifactPath({ ...target, targetId: invalid })).toThrow();
      expect(() => canvasArtifactPath(target, invalid)).toThrow();
      expect(api.fetch).not.toHaveBeenCalled();
    },
  );
  it("forwards cancellation and bounds stalled requests to eight seconds", async () => {
    vi.useFakeTimers();
    api.fetch.mockImplementation(
      (_path, init) =>
        new Promise((_resolve, reject) =>
          init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true }),
        ),
    );
    const abort = new AbortController();
    const canceled = listCanvasArtifactLinks(target, abort.signal);
    const canceledAssertion = expect(canceled).rejects.toBeDefined();
    abort.abort();
    await canceledAssertion;
    const stalled = listCanvasArtifactLinks(target);
    const stalledAssertion = expect(stalled).rejects.toMatchObject({ name: "TimeoutError" });
    await vi.advanceTimersByTimeAsync(8000);
    await stalledAssertion;
    const before = api.fetch.mock.calls.length;
    await expect(listCanvasArtifactLinks(target, abort.signal)).rejects.toBeDefined();
    expect(api.fetch).toHaveBeenCalledTimes(before);
  });
  it("rejects extra response content and mismatched operation receipts", async () => {
    api.fetch.mockResolvedValueOnce({
      schemaVersion: 1,
      canCreate: true,
      links: [],
      sourceBoard: {},
    });
    await expect(listCanvasArtifactLinks(target)).rejects.toThrow();
    api.fetch.mockResolvedValueOnce({
      schemaVersion: 1,
      receipt: { operationId: id(9), linkId: link.id, deleted: false },
    });
    await expect(
      writeCanvasArtifactLink(
        target,
        createCanvasArtifactIntent(canvasId, link.versionId, id(4), link.id),
      ),
    ).rejects.toThrow("Mismatched");
  });
});
