import { beforeEach, describe, expect, it, vi } from "vitest";
import { FolderPaginationError, loadFolderContent } from "./folder-content";

const fixtures = vi.hoisted(() => ({ apiFetch: vi.fn() }));
vi.mock("../../../lib/api", () => ({ apiFetch: fixtures.apiFetch }));

describe("folder manager content loading", () => {
  beforeEach(() => fixtures.apiFetch.mockReset());

  it.each([
    ["rounds", "/v1/quizzes?archived=true", "quizzes"],
    ["presentations", "/v1/presentations?archived=true", "presentations"],
  ] as const)(
    "loads only %s, including archived content, and forwards cancellation",
    async (type, path, responseKey) => {
      const rows = [
        {
          id: "item",
          title: "Archived example",
          status: "archived",
          folderId: null,
          tags: ["Keep"],
        },
      ];
      fixtures.apiFetch.mockResolvedValue({ [responseKey]: rows });
      const controller = new AbortController();
      expect(await loadFolderContent(type, controller.signal)).toEqual(rows);
      expect(fixtures.apiFetch).toHaveBeenCalledExactlyOnceWith(path, {
        signal: controller.signal,
      });
    },
  );

  it("loads every Survey page and retains revision metadata for safe organization writes", async () => {
    fixtures.apiFetch.mockResolvedValueOnce({
      surveys: [
        { id: "one", draft: { title: "First" }, folderId: null, revision: 7, status: "published" },
      ],
      nextCursor: "next/id",
    });
    fixtures.apiFetch.mockResolvedValueOnce({
      surveys: [
        {
          id: "two",
          draft: { title: "Second" },
          folderId: "folder",
          revision: 12,
          status: "archived",
        },
      ],
      nextCursor: null,
    });
    const signal = new AbortController().signal;
    const content = await loadFolderContent("surveys", signal);
    expect(
      content.map(({ id, title, revision, status }) => ({ id, title, revision, status })),
    ).toEqual([
      { id: "one", title: "First", revision: 7, status: "published" },
      { id: "two", title: "Second", revision: 12, status: "archived" },
    ]);
    expect(fixtures.apiFetch.mock.calls).toEqual([
      ["/v1/surveys?limit=50", { signal }],
      ["/v1/surveys?limit=50&cursor=next%2Fid", { signal }],
    ]);
  });

  it("rejects pagination that repeats a cursor instead of hanging the manager", async () => {
    fixtures.apiFetch.mockResolvedValue({ surveys: [], nextCursor: "same" });
    await expect(loadFolderContent("surveys", new AbortController().signal)).rejects.toBeInstanceOf(
      FolderPaginationError,
    );
    expect(fixtures.apiFetch).toHaveBeenCalledTimes(2);
  });
});
