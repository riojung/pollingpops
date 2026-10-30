import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CanvasBoardViewSchema } from "@openround/contracts";
import type * as ApiModule from "../../lib/api";
import { ApiClientError } from "../../lib/api";
import { boardFixture } from "../../test-utils/idea-board";
import {
  finishWorkshopTemplate,
  parseWorkshopTemplateIntent,
  workshopTemplateIntent,
  type WorkshopTemplateIntent,
} from "./canvas-template-creation";
const api = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock("../../lib/api", async (original) => ({
  ...(await original<typeof ApiModule>()),
  apiFetch: api.fetch,
}));
const userId = "00000000-0000-4000-8000-000000000001";
const workspaceId = "00000000-0000-4000-8000-000000000002";
const canvasBoard = CanvasBoardViewSchema.parse({
  schemaVersion: 2,
  id: "00000000-0000-4000-8000-000000000003",
  workspaceId,
  organizationId: "00000000-0000-4000-8000-000000000004",
  ownerUserId: userId,
  title: "Our chosen title",
  boardType: "workshop",
  sourceBoardId: boardFixture.id,
  status: "active",
  canvasSeq: 1,
  createdAt: boardFixture.createdAt,
  updatedAt: boardFixture.createdAt,
  expiresAt: boardFixture.expiresAt,
  role: "owner",
  capabilities: { edit: true, facilitate: true, share: true, delete: true, archive: true },
  objects: [],
  grants: [],
  invitations: [],
  undoOperationId: null,
  redoOperationId: null,
});
function intent() {
  return workshopTemplateIntent(
    userId,
    workspaceId,
    {
      schemaVersion: 1,
      title: "  Our chosen title  ",
      description: "Our edited prompt",
      identityMode: "alias",
      moderationEnabled: false,
      voteBudget: 5,
      windowDays: 2,
      ideasVisible: true,
    },
    "experience-retro",
  );
}
function canvasResponse() {
  return {
    board: {
      ...canvasBoard,
      title: "Our chosen title",
      boardType: "workshop",
      sourceBoardId: boardFixture.id,
    },
  };
}
function checkpoints() {
  const saved: WorkshopTemplateIntent[] = [];
  return {
    saved,
    checkpoint: (value: WorkshopTemplateIntent) => saved.push(structuredClone(value)),
  };
}
beforeEach(() => vi.resetAllMocks());
afterEach(() => vi.unstubAllGlobals());

describe("guided starter creation checkpoints", () => {
  it("preserves the complete edited setup and distinct exact retry keys", async () => {
    const pending = intent();
    const storage = checkpoints();
    api.fetch
      .mockResolvedValueOnce({ board: boardFixture })
      .mockResolvedValueOnce(canvasResponse());
    await finishWorkshopTemplate(pending, storage.checkpoint);
    expect(storage.saved).toHaveLength(2);
    expect(storage.saved[0]).not.toHaveProperty("sourceBoardId");
    expect(storage.saved[1]!.sourceBoardId).toBe(boardFixture.id);
    const source = JSON.parse(api.fetch.mock.calls[0]![1].body);
    expect(source).toEqual({
      ...pending.source,
      title: "Our chosen title",
      setupContext: { userId, workspaceId },
    });
    expect(source).toMatchObject({
      description: "Our edited prompt",
      identityMode: "alias",
      moderationEnabled: false,
      voteBudget: 5,
      windowDays: 2,
      ideasVisible: true,
    });
    expect(JSON.parse(api.fetch.mock.calls[1]![1].body)).toEqual({
      schemaVersion: 2,
      workspaceId,
      title: "Our chosen title",
      boardType: "workshop",
      sourceBoardId: boardFixture.id,
      templateId: "experience-retro",
      operationId: pending.canvasOperationId,
      setupContext: { userId, workspaceId },
    });
    expect(pending.source.idempotencyKey).not.toBe(pending.canvasOperationId);
  });
  it("retries a lost source acknowledgement with the original source key before attaching once", async () => {
    const pending = intent(),
      storage = checkpoints();
    api.fetch.mockRejectedValueOnce(new TypeError("Lost source ACK"));
    await expect(finishWorkshopTemplate(pending, storage.checkpoint)).rejects.toThrow(
      "Lost source ACK",
    );
    const resumed = parseWorkshopTemplateIntent(
      JSON.parse(JSON.stringify(storage.saved.at(-1))),
      userId,
      workspaceId,
    );
    api.fetch
      .mockResolvedValueOnce({ board: boardFixture })
      .mockResolvedValueOnce(canvasResponse());
    await finishWorkshopTemplate(resumed, storage.checkpoint);
    expect(api.fetch.mock.calls.map(([path]) => path)).toEqual([
      "/v1/idea-boards",
      "/v1/idea-boards",
      "/v1/canvas-boards",
    ]);
    expect(api.fetch.mock.calls[0]![1].body).toBe(api.fetch.mock.calls[1]![1].body);
  });
  it.each([
    new TypeError("Lost canvas ACK"),
    new ApiClientError("Paused", "NOT_FOUND", 404),
    new ApiClientError("Unavailable", "DEPENDENCY_UNAVAILABLE", 503),
  ])("resumes only the canvas after a partial success: %s", async (failure) => {
    const pending = intent(),
      storage = checkpoints();
    api.fetch.mockResolvedValueOnce({ board: boardFixture }).mockRejectedValueOnce(failure);
    await expect(finishWorkshopTemplate(pending, storage.checkpoint)).rejects.toBe(failure);
    const resumed = parseWorkshopTemplateIntent(
      JSON.parse(JSON.stringify(storage.saved.at(-1))),
      userId,
      workspaceId,
    );
    expect(resumed.sourceBoardId).toBe(boardFixture.id);
    api.fetch.mockResolvedValueOnce(canvasResponse());
    await finishWorkshopTemplate(resumed, storage.checkpoint);
    expect(api.fetch.mock.calls.map(([path]) => path)).toEqual([
      "/v1/idea-boards",
      "/v1/canvas-boards",
      "/v1/canvas-boards",
    ]);
    expect(api.fetch.mock.calls[1]![1].body).toBe(api.fetch.mock.calls[2]![1].body);
  });
  it("performs no POST if the initial durable tab checkpoint is unavailable", async () => {
    await expect(
      finishWorkshopTemplate(intent(), () => {
        throw new Error("Storage blocked");
      }),
    ).rejects.toThrow("Storage blocked");
    expect(api.fetch).not.toHaveBeenCalled();
  });
  it("keeps the acknowledged source in memory if its second checkpoint fails", async () => {
    const pending = intent();
    api.fetch.mockResolvedValueOnce({ board: boardFixture });
    const checkpoint = vi
      .fn()
      .mockImplementationOnce(() => undefined)
      .mockImplementationOnce(() => {
        throw new Error("Quota changed");
      });
    await expect(finishWorkshopTemplate(pending, checkpoint)).rejects.toThrow("Quota changed");
    expect(pending.sourceBoardId).toBe(boardFixture.id);
    expect(api.fetch).toHaveBeenCalledTimes(1);
    api.fetch.mockResolvedValueOnce(canvasResponse());
    await finishWorkshopTemplate(pending, () => undefined);
    expect(api.fetch.mock.calls.map(([path]) => path)).toEqual([
      "/v1/idea-boards",
      "/v1/canvas-boards",
    ]);
  });
  it("never issues the second POST after cancellation", async () => {
    const active = new AbortController(),
      pending = intent();
    api.fetch.mockImplementationOnce(async () => {
      active.abort();
      return { board: boardFixture };
    });
    await expect(
      finishWorkshopTemplate(pending, () => undefined, active.signal),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(api.fetch).toHaveBeenCalledTimes(1);
  });
  it("rejects foreign identities, workspaces, extra credentials and oversized setup before resuming", () => {
    const pending = intent();
    for (const value of [
      { ...pending, userId: workspaceId },
      { ...pending, workspaceId: userId },
      { ...pending, bearer: "never-store-this" },
      { ...pending, templateId: "unknown" },
      { ...pending, sourceBoardId: "../../other" },
      { ...pending, source: { ...pending.source, description: "x".repeat(2001) } },
    ])
      expect(() => parseWorkshopTemplateIntent(value, userId, workspaceId)).toThrow();
  });
});
