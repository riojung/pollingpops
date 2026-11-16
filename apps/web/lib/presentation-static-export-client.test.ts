import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiClientError } from "./api";
import {
  downloadPresentationStaticExport,
  fetchPresentationStaticExport,
  fetchPresentationStaticExportSource,
  PRESENTATION_STATIC_EXPORT_MAX_BYTES,
  type PresentationStaticExportRequest,
} from "./presentation-static-export-client";

const presentationId = "00000000-0000-4000-8000-000000000001";
const versionId = "00000000-0000-4000-8000-000000000002";
const blockId = "00000000-0000-4000-8000-000000000003";
const mime = {
  pdf: "application/pdf",
  png: "image/png",
  html: "text/html",
  offline_html: "text/html",
};
function source() {
  return { versionId, version: 2, title: "Published deck", pages: [{ blockId, title: "Opening" }] };
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("Presentation static export downloads", () => {
  it.each(["pdf", "png", "html", "offline_html"] as const)(
    "requests a pinned %s using creator credentials and accepts its matching file type",
    async (format) => {
      const fetch = vi.fn<typeof globalThis.fetch>(
        async () => new Response("export bytes", { headers: { "content-type": mime[format] } }),
      );
      vi.stubGlobal("fetch", fetch);
      const signal = new AbortController().signal;
      const request = { versionId, format, ...(format === "png" ? { blockId } : {}) };
      const result = await fetchPresentationStaticExport(presentationId, request, signal);
      expect(result.format).toBe(format);
      expect(result.blob.type).toBe(mime[format]);
      expect(await result.blob.text()).toBe("export bytes");
      expect(fetch).toHaveBeenCalledOnce();
      expect(fetch.mock.calls[0]![0]).toBe(`/v1/presentations/${presentationId}/exports`);
      const options = fetch.mock.calls[0]![1] as RequestInit;
      expect(options).toMatchObject({
        method: "POST",
        credentials: "include",
        cache: "no-store",
        signal,
      });
      expect(options.headers).toEqual({ "content-type": "application/json", accept: mime[format] });
      expect(JSON.parse(options.body as string)).toEqual(request);
    },
  );

  it("loads only metadata for the requested immutable published version", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json(source()));
    vi.stubGlobal("fetch", fetch);
    const signal = new AbortController().signal;
    expect(await fetchPresentationStaticExportSource(presentationId, versionId, signal)).toEqual(
      source(),
    );
    expect(fetch.mock.calls[0]![0]).toBe(
      `/v1/presentations/${presentationId}/exports/source?versionId=${versionId}`,
    );
    expect(fetch.mock.calls[0]![1]).toMatchObject({
      credentials: "include",
      cache: "no-store",
      signal,
    });
  });

  it.each([
    { ...source(), versionId: "00000000-0000-4000-8000-000000000004" },
    { ...source(), pages: [{ blockId: "draft-array-index-0", title: "Unverified" }] },
  ])("rejects a mismatched or malformed published page list", async (value) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(value)),
    );
    await expect(
      fetchPresentationStaticExportSource(presentationId, versionId, new AbortController().signal),
    ).rejects.toThrow("published pages could not be verified");
  });

  it.each([
    { versionId, format: "png" },
    { versionId, format: "pdf", blockId },
    { versionId, format: "html", blockId },
    { versionId, format: "offline_html", blockId },
    { versionId, format: "pdf", token: "unaccepted-extra-field" },
    { versionId: "not-published", format: "pdf" },
  ])("rejects invalid format/page combinations before sending", async (request) => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    await expect(
      fetchPresentationStaticExport(
        presentationId,
        request as PresentationStaticExportRequest,
        new AbortController().signal,
      ),
    ).rejects.toThrow("Choose a published presentation");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("preserves an authoritative export error for the dialog", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          {
            error: {
              code: "EXPORT_MEDIA_UNAVAILABLE",
              message: "An image is unavailable. Try again after it is restored.",
            },
          },
          { status: 409 },
        ),
      ),
    );
    await expect(
      fetchPresentationStaticExport(
        presentationId,
        { versionId, format: "pdf" },
        new AbortController().signal,
      ),
    ).rejects.toEqual(
      new ApiClientError(
        "An image is unavailable. Try again after it is restored.",
        "EXPORT_MEDIA_UNAVAILABLE",
        409,
      ),
    );
  });

  it.each([401, 403])(
    "preserves offline export authority failure %s instead of returning a file",
    async (status) => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () =>
          Response.json(
            { error: { code: "FORBIDDEN", message: "Export access denied." } },
            { status },
          ),
        ),
      );
      await expect(
        fetchPresentationStaticExport(
          presentationId,
          { versionId, format: "offline_html" },
          new AbortController().signal,
        ),
      ).rejects.toEqual(new ApiClientError("Export access denied.", "FORBIDDEN", status));
    },
  );

  it("accepts UTF-8 offline HTML while retaining the HTML MIME type", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("<!doctype html><title>Offline</title>", {
            headers: { "content-type": "text/html; charset=utf-8" },
          }),
      ),
    );
    const result = await fetchPresentationStaticExport(
      presentationId,
      { versionId, format: "offline_html" },
      new AbortController().signal,
    );
    expect(result.blob.type).toBe("text/html");
    expect(await result.blob.text()).toContain("<!doctype html>");
  });

  it("refuses an unexpected content type and cancels its body", async () => {
    const response = new Response("not a PDF", { headers: { "content-type": "text/html" } });
    const cancel = vi.spyOn(response.body!, "cancel");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => response),
    );
    await expect(
      fetchPresentationStaticExport(
        presentationId,
        { versionId, format: "pdf" },
        new AbortController().signal,
      ),
    ).rejects.toThrow("unexpected file type");
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("rejects a PDF response to an offline HTML request and cancels its body", async () => {
    const response = new Response("not HTML", { headers: { "content-type": "application/pdf" } });
    const cancel = vi.spyOn(response.body!, "cancel");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => response),
    );
    await expect(
      fetchPresentationStaticExport(
        presentationId,
        { versionId, format: "offline_html" },
        new AbortController().signal,
      ),
    ).rejects.toThrow("unexpected file type");
    expect(cancel).toHaveBeenCalledOnce();
  });

  it.each(["pdf", "offline_html"] as const)(
    "rejects an oversized declared %s download before consuming bytes",
    async (format) => {
      const response = new Response("too big", {
        headers: {
          "content-type": mime[format],
          "content-length": String(PRESENTATION_STATIC_EXPORT_MAX_BYTES + 1),
        },
      });
      const cancel = vi.spyOn(response.body!, "cancel");
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => response),
      );
      await expect(
        fetchPresentationStaticExport(
          presentationId,
          { versionId, format },
          new AbortController().signal,
        ),
      ).rejects.toThrow("40 MiB");
      expect(cancel).toHaveBeenCalledOnce();
    },
  );

  it("enforces the byte limit while streaming even when the declared length is false", async () => {
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(PRESENTATION_STATIC_EXPORT_MAX_BYTES + 1));
      },
      cancel,
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(body, {
            headers: { "content-type": "application/pdf", "content-length": "1" },
          }),
      ),
    );
    await expect(
      fetchPresentationStaticExport(
        presentationId,
        { versionId, format: "pdf" },
        new AbortController().signal,
      ),
    ).rejects.toThrow("40 MiB");
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("cancels an in-progress body read when its dialog aborts", async () => {
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({ cancel });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(body, { headers: { "content-type": "application/pdf" } })),
    );
    const controller = new AbortController();
    const pending = fetchPresentationStaticExport(
      presentationId,
      { versionId, format: "pdf" },
      controller.signal,
    );
    const rejected = expect(pending).rejects.toMatchObject({ name: "AbortError" });
    await vi.waitFor(() => expect(body.locked).toBe(true));
    controller.abort();
    await rejected;
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("does not download an empty response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { headers: { "content-type": "application/pdf" } })),
    );
    await expect(
      fetchPresentationStaticExport(
        presentationId,
        { versionId, format: "pdf" },
        new AbortController().signal,
      ),
    ).rejects.toThrow("export was empty");
  });

  it.each([
    ["pdf", "polling-pops-presentation.pdf"],
    ["png", "polling-pops-presentation.png"],
    ["html", "polling-pops-presentation.html"],
    ["offline_html", "polling-pops-presentation-offline.html"],
  ] as const)(
    "uses fixed safe %s filename and releases the temporary URL after the click or cleanup",
    async (format, filename) => {
      vi.useFakeTimers();
      const create = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:owned-export");
      const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
      const anchor = { href: "", download: "", click: vi.fn(), remove: vi.fn() };
      const append = vi.fn();
      vi.stubGlobal("document", { createElement: vi.fn(() => anchor), body: { append } });
      const release = downloadPresentationStaticExport({ blob: new Blob(["safe"]), format });
      expect(create).toHaveBeenCalledOnce();
      expect(anchor.download).toBe(filename);
      expect(anchor.href).toBe("blob:owned-export");
      expect(append).toHaveBeenCalledWith(anchor);
      expect(anchor.click).toHaveBeenCalledOnce();
      expect(anchor.remove).toHaveBeenCalledOnce();
      expect(revoke).not.toHaveBeenCalled();
      await vi.runAllTimersAsync();
      release();
      expect(revoke).toHaveBeenCalledExactlyOnceWith("blob:owned-export");
    },
  );

  it("releases its URL immediately if the browser cannot start the download", () => {
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:failed-export");
    const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    const anchor = {
      click: vi.fn(() => {
        throw new Error("Download blocked");
      }),
      remove: vi.fn(),
    };
    vi.stubGlobal("document", { createElement: vi.fn(() => anchor), body: { append: vi.fn() } });
    expect(() =>
      downloadPresentationStaticExport({ blob: new Blob(["safe"]), format: "pdf" }),
    ).toThrow("Download blocked");
    expect(anchor.remove).toHaveBeenCalledOnce();
    expect(revoke).toHaveBeenCalledExactlyOnceWith("blob:failed-export");
  });
});
