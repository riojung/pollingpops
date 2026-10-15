import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createSummaryShare,
  fetchSharedSummary,
  fetchSummaryExport,
  fetchSummaryPreview,
  sessionSummaryPath,
  summaryCreateIntent,
  summaryExpiry,
  summaryTokenFromFragment,
  validateCreatedSummaryShare,
} from "./session-summary-client";
import {
  summaryFixture,
  summaryPreviewFixture,
  summarySource,
} from "../test-utils/session-summary";

const shareId = "00000000-0000-4000-8000-000000000002";
const token = "x".repeat(64);
const created = {
  share: {
    id: shareId,
    createdAt: "2026-10-14T12:00:00.000Z",
    expiresAt: "2026-10-18T12:00:00.000Z",
    revokedAt: null,
    allowDownloads: true,
  },
  url: `https://example.test/summary/${shareId}#token=${token}`,
  replayed: false,
};
afterEach(() => vi.unstubAllGlobals());

describe("session summary client privacy and write intent", () => {
  it("validates sources and binds the preview to the requested session", async () => {
    expect(sessionSummaryPath(summarySource)).toBe(
      `/v1/session-summaries/round/${summarySource.id}`,
    );
    expect(() => sessionSummaryPath({ ...summarySource, id: "../../other" })).toThrow();
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(
            JSON.stringify({ ...summaryPreviewFixture, source: { ...summarySource, id: shareId } }),
          ),
        ),
    );
    await expect(fetchSummaryPreview(summarySource, new AbortController().signal)).rejects.toThrow(
      "does not match",
    );
  });
  it("rejects a private payload instead of forwarding unknown fields", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            ...summaryPreviewFixture,
            summary: { ...summaryFixture, participants: [] },
          }),
        ),
      ),
    );
    await expect(
      fetchSummaryPreview(summarySource, new AbortController().signal),
    ).rejects.toThrow();
  });
  it("reuses the same idempotent write after uncertainty and normalizes whitespace", async () => {
    const makeId = vi.fn().mockReturnValueOnce(summarySource.id).mockReturnValueOnce(shareId);
    const first = summaryCreateIntent(
      null,
      { expiresInDays: 7, allowDownloads: true, nextSteps: " Review " },
      makeId,
    );
    const retry = summaryCreateIntent(
      first,
      { expiresInDays: 7, allowDownloads: true, nextSteps: "Review" },
      makeId,
    );
    expect(retry).toBe(first);
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("Connection lost"))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ...created, url: null, replayed: true })),
      );
    vi.stubGlobal("fetch", fetchMock);
    await expect(createSummaryShare(summarySource, first.request)).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(await createSummaryShare(summarySource, retry.request)).toMatchObject({
      url: null,
      replayed: true,
    });
    expect(fetchMock.mock.calls.map((call) => (call[1] as RequestInit).body)).toEqual([
      JSON.stringify(first.request),
      JSON.stringify(first.request),
    ]);
    const changed = summaryCreateIntent(
      first,
      { expiresInDays: 1, allowDownloads: false, nextSteps: "Review" },
      makeId,
    );
    expect(changed.request.idempotencyKey).toBe(shareId);
  });
  it("can create write intents on LAN HTTP without crypto.randomUUID", () => {
    vi.stubGlobal("crypto", { getRandomValues: (bytes: Uint8Array) => bytes.fill(7) });
    const intent = summaryCreateIntent(null, {
      expiresInDays: 7,
      allowDownloads: true,
      nextSteps: "",
    });
    expect(intent.request.idempotencyKey).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });
  it("only accepts a validated fragment capability on the matching share path", () => {
    expect(summaryTokenFromFragment(`#token=${token}`)).toBe(token);
    expect(summaryTokenFromFragment(`#token=${token}&token=${token}`)).toBeNull();
    expect(summaryTokenFromFragment("#token=bad%0Atoken")).toBeNull();
    expect(summaryTokenFromFragment("#token=short")).toBeNull();
    expect(validateCreatedSummaryShare(created)).toEqual(created);
    for (const url of [
      `javascript:alert(1)`,
      `https://example.test/summary/${shareId}?token=${token}`,
      `https://example.test/summary/${summarySource.id}#token=${token}`,
    ])
      expect(() => validateCreatedSummaryShare({ ...created, url })).toThrow();
  });
  it("keeps the capability out of URLs and omits creator cookies and referrers", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          summary: summaryFixture,
          expiresAt: created.share.expiresAt,
          downloadFormats: [],
        }),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    await fetchSharedSummary(shareId, token, new AbortController().signal);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(`/v1/shared-session-summaries/${shareId}`);
    expect(url).not.toContain(token);
    expect(init).toMatchObject({
      credentials: "omit",
      cache: "no-store",
      referrerPolicy: "no-referrer",
      headers: { authorization: `Bearer ${token}` },
    });
  });
  it("public exports cannot change the snapshot notes and validate the file format", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response("synthetic-pdf", { headers: { "content-type": "application/pdf" } }),
      )
      .mockResolvedValueOnce(
        new Response("{}", { headers: { "content-type": "application/json" } }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const request = {
      format: "pdf" as const,
      locale: "ko-KR" as const,
      nextSteps: "Local replacement",
    };
    await fetchSummaryExport({ shareId, token }, request, new AbortController().signal);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(`/v1/shared-session-summaries/${shareId}/export`);
    expect(init).toMatchObject({
      method: "POST",
      credentials: "omit",
      referrerPolicy: "no-referrer",
    });
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      format: "pdf",
      locale: "ko-KR",
    });
    await expect(
      fetchSummaryExport({ source: summarySource }, request, new AbortController().signal),
    ).rejects.toThrow("format");
  });
  it("caps the displayed expiry at the source’s frozen retention deadline", () => {
    const now = Date.parse("2026-10-14T12:00:00.000Z");
    expect(summaryExpiry(summaryPreviewFixture, 7, now).toISOString()).toBe(
      summaryPreviewFixture.sourceExpiresAt,
    );
    expect(summaryExpiry(summaryPreviewFixture, 1, now).toISOString()).toBe(
      "2026-10-15T12:00:00.000Z",
    );
  });
});
