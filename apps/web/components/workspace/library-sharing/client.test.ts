import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LibraryShareSummary } from "@openround/contracts";
import {
  copyLibraryShare,
  createLibraryShare,
  libraryScope,
  libraryScopeHref,
  listLibraryShares,
  readLibraryShare,
} from "./client";

const mocked = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock("../../../lib/api", () => ({ apiFetch: mocked.fetch }));
const id = "00000000-0000-4000-8000-000000000001";
const artifactId = "00000000-0000-4000-8000-000000000002";
const versionId = "00000000-0000-4000-8000-000000000003";
const requestId = "00000000-0000-4000-8000-000000000004";
function shareFixture(overrides: Partial<LibraryShareSummary> = {}): LibraryShareSummary {
  return {
    id,
    organizationId: id,
    organizationName: "Learning team",
    sourceWorkspaceId: id,
    sourceWorkspaceName: "Content team",
    artifactType: "round",
    artifactId,
    versionId,
    title: "Shared Round",
    description: "Published questions",
    sharedAt: "2026-11-16T12:00:00.000Z",
    permission: "use",
    audience: "organization",
    message: "Review before Friday",
    dueAt: null,
    progress: "new",
    capabilities: { view: true, copy: true, manage: false },
    ...overrides,
  };
}
beforeEach(() => mocked.fetch.mockReset());

describe("authenticated library sharing client", () => {
  it("keeps scope and kind in share links and falls back from unknown scopes", () => {
    expect(libraryScope("shared")).toBe("shared");
    expect(libraryScope("private-token")).toBe("workspace");
    expect(libraryScopeHref("organization", "presentations")).toBe(
      "/library?scope=organization&type=presentations",
    );
    expect(libraryScopeHref("workspace", "rounds")).toBe("/library");
  });

  it("lists strict metadata without accepting source snapshots in summaries", async () => {
    mocked.fetch.mockResolvedValue({ shares: [shareFixture()], nextCursor: null });
    const active = new AbortController();
    expect((await listLibraryShares("shared", active.signal)).shares).toHaveLength(1);
    expect(mocked.fetch).toHaveBeenCalledWith("/v1/library/shares?scope=shared", {
      signal: active.signal,
      cache: "no-store",
    });
    mocked.fetch.mockResolvedValue({
      shares: [{ ...shareFixture(), snapshot: { answers: ["secret"] } }],
      nextCursor: null,
    });
    await expect(listLibraryShares("shared")).rejects.toThrow();
  });

  it("pins publication and preserves an identical create request across transport retries", async () => {
    const intent = {
      requestId,
      artifactType: "round" as const,
      artifactId,
      versionId,
      audience: "organization" as const,
      recipientIds: [],
      permission: "use" as const,
      message: "Review before Friday",
      dueAt: null,
    };
    mocked.fetch
      .mockRejectedValueOnce(new TypeError("Disconnected"))
      .mockResolvedValueOnce({ share: shareFixture() });
    await expect(createLibraryShare(intent)).rejects.toThrow("Disconnected");
    await createLibraryShare(intent);
    expect(mocked.fetch.mock.calls[0]).toEqual(mocked.fetch.mock.calls[1]);
    const body = JSON.parse(mocked.fetch.mock.calls[1]![1].body);
    expect(body).toMatchObject({ versionId, requestId, artifactType: "round", artifactId });
    expect(body).not.toHaveProperty("draft");
    mocked.fetch.mockResolvedValue({ share: shareFixture({ versionId: requestId }) });
    await expect(createLibraryShare(intent)).rejects.toThrow("acknowledgement");
  });

  it("only navigates a successful independent copy to its matching local editor", async () => {
    mocked.fetch.mockResolvedValue({
      artifactType: "round",
      artifactId,
      workspaceId: id,
      href: `/quiz/${artifactId}`,
      replayed: false,
    });
    expect((await copyLibraryShare(id, requestId)).href).toBe(`/quiz/${artifactId}`);
    expect(JSON.parse(mocked.fetch.mock.calls[0]![1].body)).toEqual({ requestId });
    mocked.fetch.mockResolvedValue({
      artifactType: "round",
      artifactId,
      workspaceId: id,
      href: "https://other.example/quiz/secret",
      replayed: false,
    });
    await expect(copyLibraryShare(id, requestId)).rejects.toThrow("verified");
  });

  it("does not accept a detail response for a different share", async () => {
    mocked.fetch.mockResolvedValue({ share: shareFixture({ id: requestId }), questions: [] });
    await expect(readLibraryShare(id, new AbortController().signal)).rejects.toThrow("unavailable");
    expect(mocked.fetch.mock.calls[0]![1]).toMatchObject({ cache: "no-store" });
  });
});
