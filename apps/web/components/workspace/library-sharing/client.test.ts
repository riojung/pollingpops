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
    expect(libraryScopeHref("workspace", "rounds")).toBe("/library?type=rounds");
    expect(libraryScopeHref("shared", "all")).toBe("/library?scope=shared");
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

  it("keeps organization selection and cursor when browsing group publication candidates", async () => {
    mocked.fetch.mockResolvedValue({ shares: [shareFixture()], nextCursor: "page-two" });
    const active = new AbortController();
    await listLibraryShares("organization", active.signal, "page-one", id);
    const url = new URL(mocked.fetch.mock.calls[0]![0], "https://example.test");
    expect(url.searchParams.get("scope")).toBe("organization");
    expect(url.searchParams.get("organizationId")).toBe(id);
    expect(url.searchParams.get("cursor")).toBe("page-one");
    expect(mocked.fetch.mock.calls[0]![1]).toEqual({ signal: active.signal, cache: "no-store" });
  });

  it("adds bounded search, facets and sorting without changing positional callers", async () => {
    mocked.fetch.mockResolvedValue({ shares: [], nextCursor: null });
    await listLibraryShares("shared", undefined, "page-one", undefined, {
      q: `  ${"x".repeat(180)}  `,
      kind: "survey",
      sort: "title_desc",
      progress: "done",
      permission: "view",
      limit: 30,
    });
    const params = new URL(mocked.fetch.mock.calls[0]![0], "https://example.test").searchParams;
    expect(params.get("q")).toHaveLength(160);
    expect(Object.fromEntries([...params].filter(([key]) => key !== "q"))).toEqual({
      scope: "shared",
      kind: "survey",
      sort: "title_desc",
      progress: "done",
      permission: "view",
      limit: "30",
      cursor: "page-one",
    });
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
  it("preserves v3 Survey layout and the unchanged flat question projection", async () => {
    const questions = [
      {
        id: requestId,
        type: "rating",
        prompt: "Question",
        mediaId: null,
        mediaAlt: null,
        min: 1,
        max: 5,
        required: true,
      },
    ];
    const surveyPages = [
      {
        id: artifactId,
        title: "Authored page",
        description: "First line\n\n  Second line",
        questionIds: [requestId],
      },
    ];
    const share = shareFixture({
      artifactType: "survey",
      permission: "view",
      capabilities: { view: true, copy: false, manage: false },
    });
    mocked.fetch.mockResolvedValue({ share, questions, surveyPages });
    const result = await readLibraryShare(id, new AbortController().signal);
    expect(result.surveyPages).toEqual(surveyPages);
    expect(result.questions).toBe(questions);
    expect(result.share.capabilities.copy).toBe(false);
    expect(result.questions).toEqual(questions);
  });
  it.each(["round", "survey"] as const)(
    "retains the flat legacy %s detail shape when no layout is present",
    async (artifactType) => {
      const questions = [
        { id: requestId, type: "rating", prompt: "Flat question", mediaId: null, mediaAlt: null },
      ];
      mocked.fetch.mockResolvedValue({ share: shareFixture({ artifactType }), questions });
      const result = await readLibraryShare(id, new AbortController().signal);
      expect(result.questions).toBe(questions);
      expect(result).not.toHaveProperty("surveyPages");
    },
  );
  it("does not attach Survey layout to Round detail responses", async () => {
    mocked.fetch.mockResolvedValue({
      share: shareFixture(),
      questions: [],
      surveyPages: [
        { id: artifactId, title: "Unexpected Survey field", description: "", questionIds: [] },
      ],
    });
    expect(await readLibraryShare(id, new AbortController().signal)).not.toHaveProperty(
      "surveyPages",
    );
  });
  it("keeps Presentation review payloads on their existing reader projection", async () => {
    const review = {
      schemaVersion: 1,
      versionId,
      version: 1,
      title: "Published deck",
      blocks: [
        {
          id: requestId,
          kind: "question",
          question: { type: "poll", prompt: "Deck question", mediaId: null, mediaAlt: null },
        },
      ],
      sections: [],
      expiresAt: "2099-01-01T00:00:00.000Z",
    };
    mocked.fetch.mockResolvedValue({
      share: shareFixture({ artifactType: "presentation" }),
      review,
      surveyPages: [
        { id: artifactId, title: "Unexpected Survey metadata", description: "", questionIds: [] },
      ],
    });
    const result = await readLibraryShare(id, new AbortController().signal);
    expect(result.review).toEqual(review);
    expect(result).not.toHaveProperty("surveyPages");
    expect(result).not.toHaveProperty("questions");
  });
  it.each([
    "null",
    "empty",
    "duplicate-page",
    "duplicate-question",
    "missing-question",
    "dangling-question",
    "wrong-order",
    "too-many-pages",
    "private-fields",
  ])("fails closed on present malformed Survey layout: %s", async (kind) => {
    const questions = [requestId, versionId].map((id) => ({
      id,
      type: "rating",
      prompt: id,
      mediaId: null,
      mediaAlt: null,
    }));
    const first = { id: artifactId, title: "First", description: "", questionIds: [requestId] };
    const second = { id, title: "Second", description: "", questionIds: [versionId] };
    let surveyPages: unknown = [first, second];
    if (kind === "null") surveyPages = null;
    if (kind === "empty") surveyPages = [];
    if (kind === "duplicate-page") second.id = first.id;
    if (kind === "duplicate-question") second.questionIds = [...first.questionIds];
    if (kind === "missing-question") surveyPages = [first];
    if (kind === "dangling-question") second.questionIds = [artifactId];
    if (kind === "wrong-order") surveyPages = [second, first];
    if (kind === "too-many-pages") surveyPages = Array.from({ length: 21 }, () => first);
    if (kind === "private-fields")
      surveyPages = [{ ...first, responses: { secret: true } }, second];
    mocked.fetch.mockResolvedValue({
      share: shareFixture({ artifactType: "survey" }),
      questions,
      surveyPages,
    });
    await expect(readLibraryShare(id, new AbortController().signal)).rejects.toThrow();
  });
});
