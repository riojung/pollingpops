import { afterEach, describe, expect, it, vi } from "vitest";
import { API_URL } from "./api";
import {
  downloadPresentationInsightsFile,
  fetchPresentationSessionInsights,
  PRESENTATION_INSIGHTS_MAX_BYTES,
} from "./presentation-session-insights-client";
import {
  insightsId,
  insightsSource,
  presentationInsightsFixture,
} from "./presentation-session-insights.test-fixtures";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});
describe("creator Presentation insights resource", () => {
  it("loads one bounded, source-bound response with normal creator credentials", async () => {
    const insights = presentationInsightsFixture();
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      Response.json({ status: "ready", insights }),
    );
    vi.stubGlobal("fetch", fetch);
    const signal = new AbortController().signal;
    expect(await fetchPresentationSessionInsights(insightsSource, signal)).toEqual({
      status: "ready",
      insights,
    });
    expect(fetch).toHaveBeenCalledExactlyOnceWith(
      `${API_URL}/v1/presentation-sessions/${insightsSource.sessionId}/insights`,
      {
        credentials: "include",
        cache: "no-store",
        referrerPolicy: "no-referrer",
        headers: { accept: "application/json" },
        signal,
      },
    );
  });
  it.each(["pending", "failed"] as const)(
    "retains the explicit %s state without polling or fabricating aggregates",
    async (status) => {
      const fetch = vi.fn(async () => Response.json({ status, insights: null }));
      vi.stubGlobal("fetch", fetch);
      expect(
        await fetchPresentationSessionInsights(insightsSource, new AbortController().signal),
      ).toEqual({ status, insights: null });
      expect(fetch).toHaveBeenCalledOnce();
    },
  );
  it.each(["sessionId", "presentationId", "presentationVersionId"] as const)(
    "rejects a response with the wrong frozen %s",
    async (field) => {
      const insights = { ...presentationInsightsFixture(), [field]: insightsId(90) };
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => Response.json({ status: "ready", insights })),
      );
      await expect(
        fetchPresentationSessionInsights(insightsSource, new AbortController().signal),
      ).rejects.toThrow("do not match this session and published version");
    },
  );
  it.each([404, 405, 501])(
    "preserves unsupported/legacy HTTP status %s for graceful fallback",
    async (status) => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => new Response("Unavailable", { status })),
      );
      await expect(
        fetchPresentationSessionInsights(insightsSource, new AbortController().signal),
      ).rejects.toMatchObject({ status, code: "INSIGHTS_UNAVAILABLE" });
    },
  );
  it("rejects malformed or unsupported insights without exposing their data", async () => {
    const insights = { ...presentationInsightsFixture(), schemaVersion: 2 };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ status: "ready", insights })),
    );
    await expect(
      fetchPresentationSessionInsights(insightsSource, new AbortController().signal),
    ).rejects.toThrow("could not be verified");
  });
  it("rejects an invalid source before any request", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    await expect(
      fetchPresentationSessionInsights(
        { ...insightsSource, sessionId: "draft-index-0" },
        new AbortController().signal,
      ),
    ).rejects.toThrow("source could not be verified");
    expect(fetch).not.toHaveBeenCalled();
  });
  it("rejects a declared response above one MiB before reading it", async () => {
    const response = Response.json(
      {},
      { headers: { "content-length": String(PRESENTATION_INSIGHTS_MAX_BYTES + 1) } },
    );
    const cancel = vi.spyOn(response.body!, "cancel");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => response),
    );
    await expect(
      fetchPresentationSessionInsights(insightsSource, new AbortController().signal),
    ).rejects.toThrow("download limit");
    expect(cancel).toHaveBeenCalledOnce();
  });
  it("enforces the streamed byte limit despite a false content length", async () => {
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(PRESENTATION_INSIGHTS_MAX_BYTES + 1));
      },
      cancel,
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(body, {
            headers: { "content-type": "application/json", "content-length": "1" },
          }),
      ),
    );
    await expect(
      fetchPresentationSessionInsights(insightsSource, new AbortController().signal),
    ).rejects.toThrow("download limit");
    expect(cancel).toHaveBeenCalledOnce();
  });
  it("cancels an outstanding body read on abort", async () => {
    const cancel = vi.fn(),
      body = new ReadableStream<Uint8Array>({ cancel });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(body, { headers: { "content-type": "application/json" } })),
    );
    const controller = new AbortController();
    const pending = fetchPresentationSessionInsights(insightsSource, controller.signal);
    const rejected = expect(pending).rejects.toMatchObject({ name: "AbortError" });
    await vi.waitFor(() => expect(body.locked).toBe(true));
    controller.abort();
    await rejected;
    expect(cancel).toHaveBeenCalledOnce();
  });
  it("refuses an unexpected response type", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("<h1>Old server</h1>", { headers: { "content-type": "text/html" } }),
      ),
    );
    await expect(
      fetchPresentationSessionInsights(insightsSource, new AbortController().signal),
    ).rejects.toThrow("could not be verified");
  });
});

describe("bounded insights copies", () => {
  it("limits encoded bytes before allocating a download URL", () => {
    const create = vi.spyOn(URL, "createObjectURL");
    expect(() =>
      downloadPresentationInsightsFile("é".repeat(PRESENTATION_INSIGHTS_MAX_BYTES / 2 + 1), "html"),
    ).toThrow("1 MiB");
    expect(create).not.toHaveBeenCalled();
  });
  it.each(["csv", "html"] as const)(
    "downloads %s with a fixed filename and revokes its URL exactly once",
    async (format) => {
      vi.useFakeTimers();
      vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:insights-copy");
      const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
      const anchor = { href: "", download: "", click: vi.fn(), remove: vi.fn() };
      vi.stubGlobal("document", { createElement: vi.fn(() => anchor), body: { append: vi.fn() } });
      const release = downloadPresentationInsightsFile("A copied aggregate", format);
      expect(anchor.download).toBe(
        `polling-pops-session-${format === "csv" ? "coverage.csv" : "summary.html"}`,
      );
      expect(anchor.click).toHaveBeenCalledOnce();
      expect(anchor.remove).toHaveBeenCalledOnce();
      release();
      await vi.runAllTimersAsync();
      expect(revoke).toHaveBeenCalledExactlyOnceWith("blob:insights-copy");
    },
  );
});
