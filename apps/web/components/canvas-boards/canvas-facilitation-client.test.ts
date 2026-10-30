import { afterEach, describe, expect, it, vi } from "vitest";
import type * as Api from "../../lib/api";
import {
  facilitationIntent,
  readCanvasFacilitation,
  readCanvasVersion,
  writeCanvasFacilitation,
} from "./canvas-facilitation-client";
import { facilitationFixture as view } from "./canvas-facilitation-test-fixtures";
const mocked = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock("../../lib/api", async (original) => ({
  ...(await original<typeof Api>()),
  apiFetch: mocked.fetch,
}));
afterEach(() => vi.resetAllMocks());
describe("facilitation client boundaries", () => {
  it("retains exactly the same operation and concurrency fence after a lost acknowledgement", async () => {
    const operation = facilitationIntent({
      type: "timer_start",
      expectedRevision: 0,
      durationSeconds: 300,
    });
    mocked.fetch.mockRejectedValueOnce(new TypeError("Lost acknowledgement")).mockResolvedValue({
      facilitation: view,
      receipt: { operationId: operation.operationId, canvasSeq: 2, type: "timer_start" },
    });
    await expect(writeCanvasFacilitation(view.boardId, operation)).rejects.toThrow();
    await writeCanvasFacilitation(view.boardId, operation);
    expect(mocked.fetch.mock.calls[0]![1].body).toBe(mocked.fetch.mock.calls[1]![1].body);
    expect(JSON.parse(mocked.fetch.mock.calls[0]![1].body).schemaVersion).toBe(1);
    mocked.fetch.mockResolvedValue({
      facilitation: view,
      receipt: { operationId: view.versions[0]!.id, canvasSeq: 2, type: "timer_start" },
    });
    await expect(writeCanvasFacilitation(view.boardId, operation)).rejects.toThrow(
      "Mismatched facilitation acknowledgement",
    );
  });
  it("rejects foreign snapshots and foreign version identities", async () => {
    mocked.fetch.mockResolvedValue({ facilitation: { ...view, boardId: view.actorId } });
    await expect(readCanvasFacilitation(view.boardId)).rejects.toThrow(
      "Mismatched facilitation board",
    );
    mocked.fetch.mockResolvedValue({
      schemaVersion: 1,
      boardId: view.boardId,
      version: view.versions[0],
      objects: [],
    });
    await expect(readCanvasVersion(view.boardId, view.actorId)).rejects.toThrow(
      "Mismatched saved version",
    );
    await expect(readCanvasVersion(view.boardId, "../other-workspace")).rejects.toThrow(
      "Invalid canvas",
    );
  });
});
