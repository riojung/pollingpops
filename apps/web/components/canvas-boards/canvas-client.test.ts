import { afterEach, describe, expect, it, vi } from "vitest";
import {
  canvasIntent,
  deleteCanvas,
  listCanvases,
  readCanvas,
  watchCanvas,
  writeCanvas,
} from "./canvas-client";
import type * as ApiModule from "../../lib/api";
import { ApiClientError } from "../../lib/api";
import { canvasBoard, canvasId, canvasObject } from "./canvas-test-fixtures";
const api = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock("../../lib/api", async (original) => ({
  ...(await original<typeof ApiModule>()),
  API_URL: "http://localhost:4100",
  apiFetch: api.fetch,
}));
afterEach(() => {
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});
describe("canvas client boundaries", () => {
  it("retains the canvas cursor so later owned/shared pages remain discoverable", async () => {
    const laterId = "00000000-0000-4000-8000-000000000099";
    api.fetch
      .mockResolvedValueOnce({ boards: [canvasBoard], nextCursor: canvasId })
      .mockResolvedValueOnce({ boards: [{ ...canvasBoard, id: laterId }], nextCursor: null });
    const first = await listCanvases("shared");
    const second = await listCanvases("shared", undefined, first.nextCursor);
    expect(first.nextCursor).toBe(canvasId);
    expect(second.nextCursor).toBeNull();
    expect(second.boards[0]!.id).toBe(laterId);
    expect(api.fetch.mock.calls[1]![0]).toBe(`/v1/canvas-boards?scope=shared&cursor=${canvasId}`);
  });
  it("keeps a failed delete retry on the same resource and accepts acknowledged absence", async () => {
    api.fetch
      .mockRejectedValueOnce(new TypeError("Lost acknowledgement"))
      .mockRejectedValueOnce(new ApiClientError("Missing", "NOT_FOUND", 404));
    await expect(deleteCanvas(canvasId)).rejects.toThrow("Lost acknowledgement");
    await expect(deleteCanvas(canvasId)).resolves.toBeUndefined();
    expect(api.fetch.mock.calls.map((call) => call[0])).toEqual([
      `/v1/canvas-boards/${canvasId}`,
      `/v1/canvas-boards/${canvasId}`,
    ]);
    api.fetch.mockRejectedValueOnce(new ApiClientError("Denied", "FORBIDDEN", 403));
    await expect(deleteCanvas(canvasId)).rejects.toThrow("Denied");
  });
  it("preserves the exact normalized operation on retry and validates its acknowledgement", async () => {
    const operation = canvasIntent({
      type: "batch",
      operations: [
        {
          type: "update",
          id: canvasObject.id,
          expectedVersion: 1,
          patch: { text: "Retained draft" },
        },
      ],
    });
    const response = {
      board: canvasBoard,
      receipt: { operationId: operation.operationId, canvasSeq: 1, type: "batch" },
    };
    api.fetch.mockRejectedValueOnce(new TypeError("Offline")).mockResolvedValue(response);
    await expect(writeCanvas(canvasId, operation)).rejects.toThrow("Offline");
    await writeCanvas(canvasId, operation);
    expect(api.fetch.mock.calls[0]![1].body).toBe(api.fetch.mock.calls[1]![1].body);
    api.fetch.mockResolvedValue({
      ...response,
      receipt: { ...response.receipt, operationId: "00000000-0000-4000-8000-000000000099" },
    });
    await expect(writeCanvas(canvasId, operation)).rejects.toThrow(
      "Mismatched canvas acknowledgement",
    );
  });
  it("rejects a foreign snapshot rather than displaying it", async () => {
    api.fetch.mockResolvedValue({
      board: { ...canvasBoard, id: "00000000-0000-4000-8000-000000000098" },
    });
    await expect(readCanvas(canvasId)).rejects.toThrow("Mismatched canvas");
    await expect(readCanvas("../../other-workspace")).rejects.toThrow("Invalid canvas");
  });
  it("uses authenticated metadata notifications and stops on revocation without consuming object content", async () => {
    const changed = vi.fn(),
      revoked = vi.fn();
    const payload = new TextEncoder().encode(
      JSON.stringify({ type: "canvas.changed", boardId: canvasId, objects: ["ignored"] }) +
        "\n" +
        JSON.stringify({ type: "access.revoked" }) +
        "\n",
    );
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(payload);
            controller.close();
          },
        }),
      ),
    );
    vi.stubGlobal("fetch", fetcher);
    await watchCanvas(canvasId, new AbortController().signal, changed, revoked);
    expect(fetcher.mock.calls[0]![1]).toMatchObject({ credentials: "include", cache: "no-store" });
    expect(changed).toHaveBeenCalledOnce();
    expect(revoked).toHaveBeenCalledOnce();
  });
});
