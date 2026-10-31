import { afterEach, describe, expect, it, vi } from "vitest";
import { CanvasObjectSchema } from "@openround/contracts";
import type * as ApiModule from "../../lib/api";
import {
  canvasExportPng,
  downloadCanvasExport,
  fetchCanvasExport,
  selectedCanvasExportFrameRegion,
  validateClosedCanvasSvg,
} from "./canvas-export-client";
import { canvasId, canvasObject } from "./canvas-test-fixtures";
vi.mock("../../lib/api", async (original) => ({
  ...(await original<typeof ApiModule>()),
  API_URL: "http://localhost:4100",
}));
const svg =
  '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600" viewBox="0 0 800 600"><title>Synthetic &lt;board&gt;</title><rect width="800" height="600" fill="#ffffff"/></svg>';
const svgResponse = (text = svg, headers: Record<string, string> = {}) =>
  new Response(text, {
    headers: { "content-type": "image/svg+xml;charset=utf-8", ...headers },
  });
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("canvas export download boundary", () => {
  it("requests only the current authorized SVG projection using cookie auth and a cancellable POST", async () => {
    const fetcher = vi.fn().mockResolvedValue(svgResponse());
    vi.stubGlobal("fetch", fetcher);
    const controller = new AbortController();
    const result = await fetchCanvasExport(canvasId, null, "transparent", controller.signal);
    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls[0]![0]).toBe(
      `http://localhost:4100/v1/canvas-boards/${canvasId}/export`,
    );
    expect(fetcher.mock.calls[0]![1]).toMatchObject({
      method: "POST",
      credentials: "include",
      cache: "no-store",
      referrerPolicy: "no-referrer",
    });
    expect(JSON.parse(fetcher.mock.calls[0]![1].body)).toEqual({
      schemaVersion: 1,
      format: "svg",
      region: null,
      background: "transparent",
    });
    expect(result.width).toBe(800);
    expect(result.height).toBe(600);
    expect(result.blob.type).toBe("image/svg+xml");
    expect(await result.blob.text()).toBe(svg);
  });

  it("rejects invalid board/region input without starting a request", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    await expect(fetchCanvasExport("../../private", null)).rejects.toThrow("Invalid canvas");
    await expect(
      fetchCanvasExport(canvasId, { x: 0, y: 0, width: 100001, height: 10 }),
    ).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("propagates cancellation and bounds a stalled transport with a timeout", async () => {
    vi.useFakeTimers();
    let received: AbortSignal | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            received = init.signal!;
            received.addEventListener("abort", () => reject(received?.reason), { once: true });
          }),
      ),
    );
    const controller = new AbortController();
    const cancelled = fetchCanvasExport(canvasId, null, "white", controller.signal);
    const rejected = expect(cancelled).rejects.toMatchObject({ name: "AbortError" });
    controller.abort();
    await rejected;
    expect(received?.aborted).toBe(true);
    const timed = fetchCanvasExport(canvasId, null);
    const timeout = expect(timed).rejects.toMatchObject({ name: "TimeoutError" });
    await vi.advanceTimersByTimeAsync(30000);
    await timeout;
  });

  it("rejects failed, oversized, malformed, or incorrectly typed responses", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ error: { code: "FORBIDDEN", message: "Private server detail" } }),
          { status: 403 },
        ),
      )
      .mockResolvedValueOnce(svgResponse(svg, { "content-length": String(20 * 1024 * 1024 + 1) }))
      .mockResolvedValueOnce(new Response(svg, { headers: { "content-type": "text/html" } }))
      .mockResolvedValueOnce(svgResponse(svg.replace('width="800"', 'width="4097"')));
    vi.stubGlobal("fetch", fetcher);
    await expect(fetchCanvasExport(canvasId, null)).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: "This canvas export is unavailable",
    });
    for (let index = 0; index < 3; index++)
      await expect(fetchCanvasExport(canvasId, null)).rejects.toThrow(
        "Invalid canvas export response",
      );
  });

  it.each([
    "<script>alert(1)</script>",
    "<foreignObject><div>HTML</div></foreignObject>",
    "<style>@import url(https://example.test/)</style>",
    '<image href="https://example.test/private"/>',
    '<image href="data:image/svg+xml;base64,PHN2Zy8+"/>',
    '<g onload="bad"/>',
    '<g style="background:url(https://example.test/)"/>',
    '<g filter="url(https://example.test/)"/>',
    "<text>&#60;script&#62;</text>",
    '<use href="#export-region"/>',
  ])("rejects active SVG or network references before rasterization: %s", (content) => {
    expect(() => validateClosedCanvasSvg(svg.replace("</svg>", content + "</svg>"))).toThrow(
      "Invalid canvas export response",
    );
  });

  it("rejects processing instructions, DTDs, trailing syntax and unclosed tags", () => {
    for (const value of [
      "<?xml-stylesheet href='https://example.test/remote'?>" + svg,
      "<!DOCTYPE svg SYSTEM 'https://example.test/remote'>" + svg,
      svg + "<",
      svg.replace("</svg>", ""),
    ])
      expect(() => validateClosedCanvasSvg(value)).toThrow();
  });

  it("accepts closed local clips, markers, rotated geometry and raster data URIs", () => {
    const content =
      '<defs><clipPath id="export-region"><rect x="0" y="0" width="800" height="600"/></clipPath><marker id="export-arrow" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto" markerUnits="strokeWidth"><path d="M0 0L8 3L0 6" fill="none" stroke="#667085"/></marker></defs><g clip-path="url(#export-region)"><line x1="1" y1="2" x2="300" y2="200" stroke="#667085" stroke-width="2" marker-end="url(#export-arrow)"/><g transform="translate(-20 30) rotate(90 100 80)"><image width="200" height="160" href="data:image/png;base64,AAAA" preserveAspectRatio="xMidYMid meet"><title>Image</title></image><text x="10" y="20" font-family="Arial, sans-serif" font-size="16" fill="#202938" xml:space="preserve"><tspan x="10" dy="0">Plain &amp; safe</tspan></text></g><polyline points="0,0 100,100" fill="none" stroke="#175ca5" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></g>';
    expect(validateClosedCanvasSvg(svg.replace("</svg>", content + "</svg>"))).toEqual({
      width: 800,
      height: 600,
    });
  });

  it("uses the rotated visual area of exactly one selected frame", () => {
    const frame = CanvasObjectSchema.parse({ ...canvasObject, type: "frame", rotation: 90 });
    const result = selectedCanvasExportFrameRegion([frame], [frame.id]);
    expect(result!.x).toBeCloseTo(40);
    expect(result!.y).toBeCloseTo(10);
    expect(result!.width).toBeCloseTo(160);
    expect(result!.height).toBeCloseTo(200);
    expect(selectedCanvasExportFrameRegion([frame], [])).toBeNull();
    const other = { ...frame, id: "00000000-0000-4000-8000-000000000098" };
    expect(selectedCanvasExportFrameRegion([frame, other], [frame.id, other.id])).toBeNull();
  });

  it("converts the bounded closed SVG with a local canvas and releases the temporary URL", async () => {
    const create = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:synthetic-export");
    const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    const drawImage = vi.fn();
    const toBlob = vi.fn((done: BlobCallback) =>
      done(new Blob(["synthetic PNG bytes"], { type: "image/png" })),
    );
    const canvas = { width: 0, height: 0, getContext: () => ({ drawImage }), toBlob };
    vi.stubGlobal("window", { document: { createElement: vi.fn(() => canvas) } });
    class LocalImage {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(value: string) {
        if (value) queueMicrotask(() => this.onload?.());
      }
    }
    vi.stubGlobal("Image", LocalImage);
    const result = await canvasExportPng({
      blob: new Blob([svg], { type: "image/svg+xml" }),
      width: 800,
      height: 600,
    });
    expect(result.type).toBe("image/png");
    expect(canvas.width).toBe(800);
    expect(canvas.height).toBe(600);
    expect(drawImage).toHaveBeenCalledWith(expect.any(LocalImage), 0, 0, 800, 600);
    expect(create).toHaveBeenCalledOnce();
    expect(revoke).toHaveBeenCalledWith("blob:synthetic-export");
    expect(toBlob).toHaveBeenCalledWith(expect.any(Function), "image/png");
  });

  it("cancels rasterization and releases its URL without triggering a download", async () => {
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:synthetic-export");
    const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    class StalledImage {
      onload = null;
      onerror = null;
      src = "";
    }
    vi.stubGlobal("Image", StalledImage);
    const controller = new AbortController();
    const pending = canvasExportPng(
      { blob: new Blob([svg]), width: 800, height: 600 },
      controller.signal,
    );
    const rejected = expect(pending).rejects.toMatchObject({ name: "AbortError" });
    await vi.waitFor(() => expect(URL.createObjectURL).toHaveBeenCalledOnce());
    controller.abort();
    await rejected;
    expect(revoke).toHaveBeenCalledWith("blob:synthetic-export");
  });

  it("accepts bounded diagram paths and local arrow markers without admitting arbitrary SVG paths", () => {
    const diagram =
      '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400"><defs><marker id="export-arrow-blue" orient="auto-start-reverse"><path d="M0 0L10 5L0 10Z" fill="#175ca5"/></marker></defs><path d="M100 0 L200 80 L100 160 L0 80 Z" fill="#cde7ff"/><path d="M220 110 L270 110 L270 280 L320 280" stroke="#175ca5" marker-start="url(#export-arrow-blue)" marker-end="url(#export-arrow-blue)"/></svg>';
    expect(validateClosedCanvasSvg(diagram)).toEqual({ width: 600, height: 400 });
    for (const path of [
      "M0 0 C10 10 20 20 30 30",
      "M0 0 LInfinity 1",
      "M0 0 L1000001 0",
      "M0 0 Z L10 10",
      "M0 0 " + "L1 1 ".repeat(33),
    ])
      expect(() =>
        validateClosedCanvasSvg(diagram.replace("M100 0 L200 80 L100 160 L0 80 Z", path)),
      ).toThrow();
    expect(() =>
      validateClosedCanvasSvg(
        diagram.replace("url(#export-arrow-blue)", "url(https://example.test/arrow)"),
      ),
    ).toThrow();
  });

  it("creates an explicit local file download with a fixed safe filename and cleans up", async () => {
    vi.useFakeTimers();
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:synthetic-download");
    const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    const anchor = { href: "", download: "", rel: "", click: vi.fn(), remove: vi.fn() };
    const append = vi.fn();
    vi.stubGlobal("window", { document: { createElement: vi.fn(() => anchor), body: { append } } });
    downloadCanvasExport(new Blob([svg]), "svg");
    expect(anchor.download).toBe("idea-board.svg");
    expect(anchor.click).toHaveBeenCalledOnce();
    expect(append).toHaveBeenCalledWith(anchor);
    expect(anchor.remove).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1000);
    expect(revoke).toHaveBeenCalledWith("blob:synthetic-download");
  });
});
