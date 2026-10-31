import {
  CanvasExportRequestSchema,
  type CanvasExportRegion,
  type CanvasObject,
} from "@openround/contracts";
import { API_URL, ApiClientError } from "../../lib/api";
import { canvasPath } from "./canvas-client";

const MAX_BYTES = 20 * 1024 * 1024;
const MAX_PIXELS = 4096;
const FETCH_TIMEOUT_MS = 30_000;
const CONVERSION_TIMEOUT_MS = 15_000;
export interface CanvasExportDocument {
  blob: Blob;
  width: number;
  height: number;
}

export function selectedCanvasExportFrameRegion(
  objects: readonly CanvasObject[],
  selectedIds: readonly string[],
): CanvasExportRegion | null {
  const frames = objects.filter(
    (object) => object.type === "frame" && selectedIds.includes(object.id),
  );
  if (frames.length !== 1) return null;
  const frame = frames[0]!;
  const angle = (frame.rotation * Math.PI) / 180;
  const width = Math.abs(frame.width * Math.cos(angle)) + Math.abs(frame.height * Math.sin(angle));
  const height = Math.abs(frame.width * Math.sin(angle)) + Math.abs(frame.height * Math.cos(angle));
  return {
    x: frame.x + (frame.width - width) / 2,
    y: frame.y + (frame.height - height) / 2,
    width,
    height,
  };
}

function invalid(): never {
  throw new Error("Invalid canvas export response");
}
const numeric = /^-?(?:\d+\.?\d*|\.\d+)$/;
const numberList = /^-?[\d.]+(?:[ ,]-?[\d.]+)*$/;
const names = new Set([
  "svg",
  "title",
  "defs",
  "clipPath",
  "rect",
  "marker",
  "path",
  "g",
  "text",
  "tspan",
  "line",
  "polyline",
  "ellipse",
  "image",
]);
const numbers = new Set([
  "width",
  "height",
  "x",
  "y",
  "x1",
  "y1",
  "x2",
  "y2",
  "cx",
  "cy",
  "rx",
  "ry",
  "dy",
  "font-size",
  "stroke-width",
  "markerWidth",
  "markerHeight",
  "refX",
  "refY",
]);
/** Validate the deliberately small closed SVG language before browser rasterization. */
export function validateClosedCanvasSvg(svg: string): { width: number; height: number } {
  if (!svg.length || new TextEncoder().encode(svg).length > MAX_BYTES) invalid();
  const tokens = svg.match(/<[^>]*>|[^<]+/g) ?? [];
  if (tokens.join("") !== svg) invalid();
  const stack: string[] = [];
  let root = false,
    ended = false,
    images = 0;
  let width = 0,
    height = 0;
  for (const token of tokens) {
    if (token[0] !== "<") {
      if (
        (!stack.length && token.trim()) ||
        /[<>]/.test(token) ||
        /&(?!(?:amp|lt|gt|quot|apos);)/.test(token)
      )
        invalid();
      continue;
    }
    const close = /^<\/([A-Za-z]+)>$/.exec(token);
    if (close) {
      if (stack.pop() !== close[1]) invalid();
      if (!stack.length) ended = true;
      continue;
    }
    const tag = /^<([A-Za-z]+)([\s\S]*?)(\/?)>$/.exec(token);
    if (!tag || !names.has(tag[1]!) || ended) invalid();
    const name = tag[1]!;
    if ((!root && name !== "svg") || (root && name === "svg")) invalid();
    if (name === "image" && ++images > 25) invalid();
    const attributes: Record<string, string> = {};
    let rest = tag[2]!;
    while (rest.trim()) {
      const match = /^\s+([A-Za-z][A-Za-z0-9:-]*)="([^"<>]*)"/.exec(rest);
      if (!match) invalid();
      const key = match[1]!,
        value = match[2]!;
      if (key in attributes || /&(?!(?:amp|lt|gt|quot|apos);)/.test(value)) invalid();
      attributes[key] = value;
      if (numbers.has(key)) {
        if (!numeric.test(value) || !Number.isFinite(Number(value))) invalid();
      } else if (["fill", "stroke"].includes(key)) {
        if (!/^(?:none|#[0-9a-f]{6})$/.test(value)) invalid();
      } else if (key === "xmlns") {
        if (name !== "svg" || value !== "http://www.w3.org/2000/svg") invalid();
      } else if (key === "id") {
        if (
          !/^export-(?:region|arrow(?:-(?:yellow|blue|green|pink|purple|white))?|object-\d+)$/.test(
            value,
          )
        )
          invalid();
      } else if (key === "clip-path" || key === "marker-end" || key === "marker-start") {
        if (
          !/^url\(#export-(?:region|arrow(?:-(?:yellow|blue|green|pink|purple|white))?|object-\d+)\)$/.test(
            value,
          )
        )
          invalid();
      } else if (key === "href") {
        if (
          name !== "image" ||
          !/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(value)
        )
          invalid();
      } else if (key === "viewBox" || key === "points" || key === "stroke-dasharray") {
        if (!numberList.test(value)) invalid();
      } else if (key === "transform") {
        if (!/^translate\(-?[\d.]+ -?[\d.]+\) rotate\(-?[\d.]+ [\d.]+ [\d.]+\)$/.test(value))
          invalid();
      } else if (key === "d") {
        const commands = value
          .trim()
          .split(/(?=[MLZ])/)
          .map((command) => command.trim());
        if (!commands.length || commands.length > 32 || !commands[0]!.startsWith("M")) invalid();
        for (const [index, command] of commands.entries()) {
          if (command === "Z" && index === commands.length - 1 && index >= 2) continue;
          const match = /^(M|L)(-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)$/.exec(command);
          if (
            !match ||
            (index > 0 && match[1] !== "L") ||
            ![match[2], match[3]].every(
              (number) => Number.isFinite(Number(number)) && Math.abs(Number(number)) <= 1_000_000,
            )
          )
            invalid();
        }
      } else if (key === "font-family") {
        if (value !== "Arial, sans-serif") invalid();
      } else if (key === "xml:space") {
        if (value !== "preserve") invalid();
      } else if (key === "preserveAspectRatio") {
        if (value !== "xMidYMid meet") invalid();
      } else if (key === "orient") {
        if (value !== "auto" && value !== "auto-start-reverse") invalid();
      } else if (key === "markerUnits") {
        if (value !== "strokeWidth") invalid();
      } else if (key === "stroke-linecap" || key === "stroke-linejoin") {
        if (value !== "round") invalid();
      } else invalid();
      rest = rest.slice(match[0].length);
    }
    if (!root) {
      root = true;
      width = Number(attributes.width);
      height = Number(attributes.height);
      if (
        attributes.xmlns !== "http://www.w3.org/2000/svg" ||
        !Number.isInteger(width) ||
        !Number.isInteger(height) ||
        width < 1 ||
        height < 1 ||
        width > MAX_PIXELS ||
        height > MAX_PIXELS
      )
        invalid();
    }
    if (!tag[3]) stack.push(name);
    else if (!stack.length) ended = true;
  }
  if (!root || !ended || stack.length) invalid();
  return { width, height };
}

async function readBoundedSvg(response: Response, signal: AbortSignal) {
  const length = Number(response.headers.get("content-length"));
  if (Number.isFinite(length) && length > MAX_BYTES) invalid();
  const reader = response.body?.getReader();
  if (!reader) invalid();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytes = 0,
    text = "";
  try {
    for (;;) {
      signal.throwIfAborted();
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.length;
      if (bytes > MAX_BYTES) invalid();
      text += decoder.decode(chunk.value, { stream: true });
    }
    signal.throwIfAborted();
    return text + decoder.decode();
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

/** Team export transport: current authorized server projection, never a client scene upload. */
export async function fetchCanvasExport(
  boardId: string,
  region: CanvasExportRegion | null,
  background: "white" | "transparent" = "white",
  signal?: AbortSignal,
): Promise<CanvasExportDocument> {
  const body = CanvasExportRequestSchema.parse({
    schemaVersion: 1,
    format: "svg",
    region,
    background,
  });
  const path = canvasPath(boardId);
  signal?.throwIfAborted();
  const controller = new AbortController();
  const cancelled = () => controller.abort(signal?.reason);
  signal?.addEventListener("abort", cancelled, { once: true });
  const timer = setTimeout(
    () => controller.abort(new DOMException("Export timed out", "TimeoutError")),
    FETCH_TIMEOUT_MS,
  );
  try {
    const response = await fetch(`${API_URL}${path}/export`, {
      method: "POST",
      credentials: "include",
      cache: "no-store",
      referrerPolicy: "no-referrer",
      headers: { "content-type": "application/json", accept: "image/svg+xml" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!response.ok) {
      const error = (await response.json().catch(() => null)) as {
        error?: { code?: string };
      } | null;
      throw new ApiClientError(
        "This canvas export is unavailable",
        error?.error?.code ?? "EXPORT_FAILED",
        response.status,
      );
    }
    if (response.headers.get("content-type")?.split(";")[0]?.trim() !== "image/svg+xml") invalid();
    const text = await readBoundedSvg(response, controller.signal);
    const size = validateClosedCanvasSvg(text);
    return { blob: new Blob([text], { type: "image/svg+xml" }), ...size };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", cancelled);
  }
}

/** Rasterize only a validated, self-contained server SVG; no URL/HTML fetches occur. */
export async function canvasExportPng(
  document: CanvasExportDocument,
  signal?: AbortSignal,
): Promise<Blob> {
  signal?.throwIfAborted();
  const size = validateClosedCanvasSvg(await document.blob.text());
  if (size.width !== document.width || size.height !== document.height) invalid();
  signal?.throwIfAborted();
  const url = URL.createObjectURL(document.blob);
  const image = new Image();
  try {
    await new Promise<void>((resolve, reject) => {
      const cancelled = () => done(signal?.reason ?? new DOMException("Cancelled", "AbortError"));
      const timer = setTimeout(
        () => done(new Error("Canvas export conversion timed out")),
        CONVERSION_TIMEOUT_MS,
      );
      function done(error?: unknown) {
        clearTimeout(timer);
        signal?.removeEventListener("abort", cancelled);
        image.onload = null;
        image.onerror = null;
        if (error) {
          image.src = "";
          reject(error);
        } else resolve();
      }
      signal?.addEventListener("abort", cancelled, { once: true });
      image.onload = () => done();
      image.onerror = () => done(new Error("Canvas export conversion failed"));
      image.src = url;
    });
    signal?.throwIfAborted();
    const canvas = window.document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas export conversion is unavailable");
    context.drawImage(image, 0, 0, size.width, size.height);
    const blob = await new Promise<Blob>((resolve, reject) => {
      let finished = false;
      const cancelled = () =>
        done(null, signal?.reason ?? new DOMException("Cancelled", "AbortError"));
      const timer = setTimeout(
        () => done(null, new Error("Canvas export conversion timed out")),
        CONVERSION_TIMEOUT_MS,
      );
      function done(value: Blob | null, error?: unknown) {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        signal?.removeEventListener("abort", cancelled);
        if (value) resolve(value);
        else reject(error ?? new Error("Canvas export conversion failed"));
      }
      signal?.addEventListener("abort", cancelled, { once: true });
      try {
        canvas.toBlob((value) => done(value), "image/png");
      } catch (error) {
        done(null, error);
      }
    });
    signal?.throwIfAborted();
    if (!blob.size || blob.size > MAX_BYTES || blob.type !== "image/png") invalid();
    return blob;
  } finally {
    image.onload = null;
    image.onerror = null;
    image.src = "";
    URL.revokeObjectURL(url);
  }
}

/** Called only after the user presses Download. */
export function downloadCanvasExport(blob: Blob, format: "svg" | "png") {
  const url = URL.createObjectURL(blob);
  const anchor = window.document.createElement("a");
  anchor.href = url;
  anchor.download = `idea-board.${format}`;
  anchor.rel = "noopener";
  window.document.body.append(anchor);
  try {
    anchor.click();
  } finally {
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
