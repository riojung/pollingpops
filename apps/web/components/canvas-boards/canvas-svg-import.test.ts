import { describe, expect, it, vi, afterEach } from "vitest";
import { rasterizeCanvasSvg, sanitizeCanvasSvg } from "./canvas-svg-import";

const drawing =
  '<svg width="100" height="80" viewBox="0 0 100 80"><g transform="translate(2 3) rotate(10)"><rect width="40" height="30" fill="#ffaa00"/><path d="M1 2 L30 40 Z" stroke="black" fill="none"/><text x="2" y="10" font-family="sans-serif">A &amp; B &lt;plain&gt;</text></g></svg>';
describe("bounded SVG image import", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("reconstructs a small shape/path/text drawing with safe escaped text", () => {
    const result = sanitizeCanvasSvg(drawing);
    expect(result).toMatchObject({ width: 100, height: 80 });
    expect(result.svg).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(result.svg).toContain("A &amp; B &lt;plain&gt;");
    expect(sanitizeCanvasSvg(result.svg)).toEqual(result);
  });
  it.each([
    "<script>alert(1)</script>",
    "<foreignObject/>",
    '<image href="https://example.test/a.png"/>',
    '<rect onclick="alert(1)"/>',
    '<rect style="fill:red"/>',
    '<rect fill="url(https://example.test/a)"/>',
    '<use href="#one"/>',
    '<path filter="url(#f)"/>',
    '<text font-family="Remote Font">hello</text>',
    '<g xmlns:xlink="http://www.w3.org/1999/xlink"/>',
    '<rect fill="&#114;ed"/>',
    '<svg width="10" height="10"/>',
  ])("rejects active, referenced or unsupported SVG content %s", (content) => {
    expect(() => sanitizeCanvasSvg(`<svg width="100" height="100">${content}</svg>`)).toThrow();
  });
  it.each([
    '<!DOCTYPE svg><svg width="10" height="10"/>',
    '<?xml version="1.0"?><svg width="10" height="10"/>',
    '<svg width="999999" height="10"/>',
    '<svg width="1e999" height="10"/>',
    '<svg width="100%" height="10"/>',
    '<svg width="10" height="10"><g></svg>',
    '<svg width="10" height="10"><rect/>',
    '<svg width="10" height="10"/>extra',
  ])("rejects entities, oversized and malformed documents", (source) => {
    expect(() => sanitizeCanvasSvg(source)).toThrow();
  });
  it("bounds file size, node count, nesting and path coordinates", () => {
    expect(() =>
      sanitizeCanvasSvg(`<svg width="10" height="10">${"<rect/>".repeat(2001)}</svg>`),
    ).toThrow();
    expect(() =>
      sanitizeCanvasSvg(
        `<svg width="10" height="10">${"<g>".repeat(33)}${"</g>".repeat(33)}</svg>`,
      ),
    ).toThrow();
    expect(() =>
      sanitizeCanvasSvg('<svg width="10" height="10"><path d="M1e9 0 L1 2"/></svg>'),
    ).toThrow();
    expect(() => sanitizeCanvasSvg(" ".repeat(512001))).toThrow();
  });
  it("uses a bounded PNG and always revokes its temporary SVG URL", async () => {
    const revoke = vi.fn();
    const toBlob = vi.fn((callback: BlobCallback) =>
      callback(new Blob(["png"], { type: "image/png" })),
    );
    const canvas = { width: 0, height: 0, getContext: () => ({ drawImage: vi.fn() }), toBlob };
    vi.stubGlobal("document", { createElement: () => canvas });
    vi.stubGlobal("URL", { createObjectURL: () => "blob:local", revokeObjectURL: revoke });
    vi.stubGlobal(
      "Image",
      class {
        onload: (() => void) | null = null;
        onerror: (() => void) | null = null;
        set src(value: string) {
          if (value) queueMicrotask(() => this.onload?.());
        }
      },
    );
    const file = new File(
      ['<svg width="16000" height="12000"><rect width="10" height="10"/></svg>'],
      "shape.svg",
    );
    const result = await rasterizeCanvasSvg(file, new AbortController().signal);
    expect(result.type).toBe("image/png");
    expect(result.name).toBe("shape.png");
    expect(toBlob).toHaveBeenCalledOnce();
    expect(revoke).toHaveBeenCalledWith("blob:local");
    expect(canvas.width).toBe(0);
  });
  it("rejects cancelled decoding and revokes its temporary SVG URL", async () => {
    const controller = new AbortController(),
      revoke = vi.fn();
    vi.stubGlobal("document", { createElement: () => ({ width: 0, height: 0 }) });
    vi.stubGlobal("URL", { createObjectURL: () => "blob:local", revokeObjectURL: revoke });
    vi.stubGlobal(
      "Image",
      class {
        onload: (() => void) | null = null;
        onerror: (() => void) | null = null;
        set src(value: string) {
          if (value) controller.abort();
        }
      },
    );
    await expect(
      rasterizeCanvasSvg(new File([drawing], "shape.svg"), controller.signal),
    ).rejects.toThrow("cancelled");
    expect(revoke).toHaveBeenCalledWith("blob:local");
  });
});
