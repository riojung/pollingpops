import { fork } from "node:child_process";
import { readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type PresentationVisualConversionErrorCode =
  "encrypted" | "malformed" | "limit" | "timeout" | "conversion_unavailable";

const safeMessages: Record<PresentationVisualConversionErrorCode, string> = {
  encrypted: "Encrypted PDFs cannot be imported. Export an unencrypted PDF and try again.",
  malformed:
    "This file could not be read safely. Export a new PDF or PNG/JPEG/WebP image and try again.",
  limit:
    "This file exceeds the visual import limits. Split the PDF or resize the image and try again.",
  timeout: "Visual conversion took too long. Split the PDF or simplify the file and try again.",
  conversion_unavailable: "Visual conversion is unavailable on this server. Try again later.",
};

/** Carries only a fixed, user-safe message: parser errors can include document content. */
export class PresentationVisualConversionError extends Error {
  readonly code: PresentationVisualConversionErrorCode;
  constructor(code: PresentationVisualConversionErrorCode) {
    super(safeMessages[code]);
    this.name = "PresentationVisualConversionError";
    this.code = code;
  }
}

export interface PresentationVisualConversionInput {
  kind: "pdf" | "image";
  bytes: Uint8Array;
  mimeType: string;
}
export interface PresentationVisualPage {
  pageNumber: number;
  width: number;
  height: number;
  png: Uint8Array;
  extractedText: string;
}
export interface PresentationVisualConversionResult {
  pages: PresentationVisualPage[];
  warnings: string[];
}

export const PRESENTATION_VISUAL_LIMITS = Object.freeze({
  pdfBytes: 6 * 1024 * 1024,
  imageBytes: 10 * 1024 * 1024,
  pages: 40,
  longestEdge: 1600,
  pagePixels: 2_000_000,
  totalPixels: 60_000_000,
  outputBytes: 40 * 1024 * 1024,
  sourceImagePixels: 16_000_000,
  sourceImageEdge: 16_000,
  textCharacters: 6000,
  canvasPixels: 8_000_000,
  residentBytes: 384 * 1024 * 1024,
});

export function presentationVisualConversionAvailable(): boolean {
  return (
    process.allowedNodeEnvironmentFlags.has("--allow-net") &&
    process.allowedNodeEnvironmentFlags.has("--permission") &&
    (process.platform === "linux" || process.platform === "darwin")
  );
}

function fail(code: PresentationVisualConversionErrorCode): never {
  throw new PresentationVisualConversionError(code);
}

/** Runs before handing any image bytes to a native decoder. No decoded allocation is needed. */
export function inspectPresentationVisualImage(
  bytes: Uint8Array,
  mimeType: string,
): { width: number; height: number } {
  const data = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let width = 0;
  let height = 0;
  if (mimeType === "image/png") {
    if (
      data.length < 33 ||
      data.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a" ||
      data.readUInt32BE(8) !== 13 ||
      data.toString("ascii", 12, 16) !== "IHDR"
    )
      fail("malformed");
    width = data.readUInt32BE(16);
    height = data.readUInt32BE(20);
    // Reject animation and malformed chunk framing before libpng sees the file.
    let offset = 8;
    let ended = false;
    let imageData = false;
    while (offset + 12 <= data.length) {
      const length = data.readUInt32BE(offset);
      if (length > data.length - offset - 12) fail("malformed");
      const kind = data.toString("ascii", offset + 4, offset + 8);
      if (kind === "acTL" || kind === "fcTL" || kind === "fdAT") fail("malformed");
      if (kind === "IDAT") imageData = true;
      if (kind === "IEND") {
        if (length !== 0 || offset + 12 !== data.length) fail("malformed");
        ended = true;
        break;
      }
      if (kind === "IHDR" && offset !== 8) fail("malformed");
      offset += length + 12;
    }
    if (!ended || !imageData) fail("malformed");
  } else if (mimeType === "image/jpeg") {
    if (data.length < 4 || data[0] !== 0xff || data[1] !== 0xd8) fail("malformed");
    let offset = 2;
    let scan = false;
    while (offset + 3 < data.length) {
      if (data[offset++] !== 0xff) fail("malformed");
      while (data[offset] === 0xff) offset++;
      const marker = data[offset++];
      if (marker === undefined || marker === 0xd9 || marker === 0xd8 || marker === 0x00)
        fail("malformed");
      const length = data.readUInt16BE(offset);
      if (length < 2 || length > data.length - offset) fail("malformed");
      if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) {
        if (length < 8 || width !== 0) fail("malformed");
        height = data.readUInt16BE(offset + 3);
        width = data.readUInt16BE(offset + 5);
      } else if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        fail("malformed");
      }
      if (marker === 0xda) {
        scan = true;
        break;
      }
      offset += length;
    }
    if (!scan || data[data.length - 2] !== 0xff || data[data.length - 1] !== 0xd9)
      fail("malformed");
  } else if (mimeType === "image/webp") {
    if (
      data.length < 30 ||
      data.toString("ascii", 0, 4) !== "RIFF" ||
      data.toString("ascii", 8, 12) !== "WEBP" ||
      data.readUInt32LE(4) !== data.length - 8
    )
      fail("malformed");
    let offset = 12;
    let frameWidth = 0;
    let frameHeight = 0;
    while (offset + 8 <= data.length) {
      const kind = data.toString("ascii", offset, offset + 4);
      const length = data.readUInt32LE(offset + 4);
      if (length > data.length - offset - 8) fail("malformed");
      const start = offset + 8;
      if (kind === "ANIM" || kind === "ANMF") fail("malformed");
      if (kind === "VP8X") {
        if (length !== 10 || width !== 0 || (data[start]! & 2) !== 0) fail("malformed");
        width = data.readUIntLE(start + 4, 3) + 1;
        height = data.readUIntLE(start + 7, 3) + 1;
      } else if (kind === "VP8 ") {
        if (
          length < 10 ||
          frameWidth !== 0 ||
          data.toString("hex", start + 3, start + 6) !== "9d012a"
        )
          fail("malformed");
        frameWidth = data.readUInt16LE(start + 6) & 0x3fff;
        frameHeight = data.readUInt16LE(start + 8) & 0x3fff;
      } else if (kind === "VP8L") {
        if (length < 5 || frameWidth !== 0 || data[start] !== 0x2f) fail("malformed");
        const bits = data.readUInt32LE(start + 1);
        frameWidth = (bits & 0x3fff) + 1;
        frameHeight = ((bits >>> 14) & 0x3fff) + 1;
      }
      offset += 8 + length + (length & 1);
    }
    if (offset !== data.length || frameWidth === 0) fail("malformed");
    if (width && (width !== frameWidth || height !== frameHeight)) fail("malformed");
    width = frameWidth;
    height = frameHeight;
  } else {
    fail("malformed");
  }
  if (!width || !height) fail("malformed");
  if (
    width > PRESENTATION_VISUAL_LIMITS.sourceImageEdge ||
    height > PRESENTATION_VISUAL_LIMITS.sourceImageEdge ||
    width * height > PRESENTATION_VISUAL_LIMITS.sourceImagePixels
  )
    fail("limit");
  return { width, height };
}

export function validatePresentationVisualInput(input: PresentationVisualConversionInput): void {
  if (!(input.bytes instanceof Uint8Array) || input.bytes.length === 0) fail("malformed");
  if (input.kind === "pdf") {
    if (input.bytes.length > PRESENTATION_VISUAL_LIMITS.pdfBytes) fail("limit");
    if (input.mimeType !== "application/pdf") fail("malformed");
    const data = Buffer.from(input.bytes.buffer, input.bytes.byteOffset, input.bytes.byteLength);
    if (!/^%PDF-\d\.\d/.test(data.toString("ascii", 0, 8))) fail("malformed");
    // PDF.js repairs broken xrefs by default. Require a complete last revision instead.
    const tail = data.subarray(Math.max(0, data.length - 1024)).toString("latin1");
    const ending = /startxref\s+(\d+)\s+%%EOF\s*$/.exec(tail);
    if (!ending) fail("malformed");
    const offset = Number(ending[1]);
    if (!Number.isSafeInteger(offset) || offset < 8 || offset >= data.length) fail("malformed");
    if (!/^(?:xref\b|\d+\s+\d+\s+obj\b)/.test(data.toString("latin1", offset, offset + 48)))
      fail("malformed");
  } else if (input.kind === "image") {
    if (input.bytes.length > PRESENTATION_VISUAL_LIMITS.imageBytes) fail("limit");
    inspectPresentationVisualImage(input.bytes, input.mimeType);
  } else fail("malformed");
}

export function presentationVisualOutputSize(
  width: number,
  height: number,
): { width: number; height: number } {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1)
    fail("malformed");
  const scale = Math.min(
    PRESENTATION_VISUAL_LIMITS.longestEdge / Math.max(width, height),
    Math.sqrt(PRESENTATION_VISUAL_LIMITS.pagePixels / (width * height)),
  );
  return {
    width: Math.max(1, Math.floor(width * scale)),
    height: Math.max(1, Math.floor(height * scale)),
  };
}

type WorkerMessage =
  | { type: "page"; page: PresentationVisualPage }
  | { type: "done"; warnings: string[] }
  | { type: "error"; code: PresentationVisualConversionErrorCode };

async function residentBytes(pid: number): Promise<number> {
  if (process.platform === "linux") {
    const status = await readFile(`/proc/${pid}/status`, "utf8");
    const rss = /^VmRSS:\s+(\d+)\s+kB/m.exec(status);
    if (!rss) throw new Error("Process memory is unavailable");
    return Number(rss[1]) * 1024;
  }
  return new Promise((resolveRss, reject) => {
    execFile(
      "/bin/ps",
      ["-o", "rss=", "-p", String(pid)],
      { timeout: 1000, maxBuffer: 1024 },
      (error, stdout) => {
        const rss = Number(stdout.trim());
        if (error || !Number.isFinite(rss) || rss <= 0)
          reject(new Error("Process memory is unavailable"));
        else resolveRss(rss * 1024);
      },
    );
  });
}

/**
 * Separate process; Node permission enforcement denies JS network/children/workers/write.
 * Native canvas is trusted code and requires allow-addons: this is NOT an OS sandbox.
 * Heap, image/canvas and output budgets plus a parent RSS watchdog contain routine bombs.
 * A deployment container/cgroup memory limit is still required for a hard native-memory cap.
 */
export async function convertPresentationVisualIsolated(
  input: PresentationVisualConversionInput,
  timeoutMs = 45_000,
): Promise<PresentationVisualConversionResult> {
  validatePresentationVisualInput(input);
  if (!presentationVisualConversionAvailable()) fail("conversion_unavailable");
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) fail("timeout");
  const extension = import.meta.url.endsWith(".ts") ? "ts" : "js";
  const workerPath = fileURLToPath(
    new URL(`./presentation-visual-converter-worker.${extension}`, import.meta.url),
  );
  // Grant only module code/data, never the application's working directory or secrets.
  const moduleDirectory = dirname(fileURLToPath(import.meta.url));
  const pdfRoot = fileURLToPath(new URL("./", import.meta.resolve("pdfjs-dist/package.json")));
  const canvasRoot = fileURLToPath(
    new URL("./", import.meta.resolve("@napi-rs/canvas/package.json")),
  );
  const pnpmMarker = `${resolve("/")}node_modules${resolve("/")}.pnpm${resolve("/")}`;
  const pnpmIndex = canvasRoot.indexOf(pnpmMarker);
  const nodeModules =
    pnpmIndex >= 0
      ? canvasRoot.slice(0, pnpmIndex + pnpmMarker.length)
      : resolve(canvasRoot, "..", "..");
  const child = fork(workerPath, [], {
    execArgv: [
      "--permission",
      "--allow-addons",
      `--allow-fs-read=${moduleDirectory}`,
      `--allow-fs-read=${resolve(moduleDirectory, "..", "package.json")}`,
      `--allow-fs-read=${resolve(moduleDirectory, "..", "node_modules")}`,
      `--allow-fs-read=${pdfRoot}`,
      `--allow-fs-read=${canvasRoot}`,
      `--allow-fs-read=${nodeModules}`,
      "--max-old-space-size=192",
      "--max-semi-space-size=8",
      "--disallow-code-generation-from-strings",
      // Native TypeScript stripping itself requires WASM in source/dev runs.
      ...(extension === "js" ? ["--jitless"] : []),
      "--disable-proto=throw",
    ],
    // Do not inherit credentials, proxy settings, NODE_OPTIONS, or addon overrides.
    env: { NODE_ENV: "production", DISABLE_SYSTEM_FONTS_LOAD: "1" },
    serialization: "advanced",
    stdio: ["ignore", "ignore", "ignore", "ipc"],
  });
  return new Promise((resolveResult, reject) => {
    const pages: PresentationVisualPage[] = [];
    let outputBytes = 0;
    let pixels = 0;
    let warnings: string[] | undefined;
    let failure: PresentationVisualConversionError | undefined;
    let checkingMemory = false;
    let failedMemoryChecks = 0;
    let closed = false;
    const stop = (code: PresentationVisualConversionErrorCode) => {
      failure ??= new PresentationVisualConversionError(code);
      if (!closed) child.kill("SIGKILL");
    };
    const timeout = setTimeout(() => stop("timeout"), Math.min(timeoutMs, 90_000));
    const memoryCheck = setInterval(() => {
      if (checkingMemory || closed || !child.pid) return;
      checkingMemory = true;
      void residentBytes(child.pid)
        .then((rss) => {
          failedMemoryChecks = 0;
          if (!closed && rss > PRESENTATION_VISUAL_LIMITS.residentBytes) stop("limit");
        })
        .catch(() => {
          // A process can disappear between the sample and its close event.
          if (
            !closed &&
            !warnings &&
            child.exitCode === null &&
            child.signalCode === null &&
            ++failedMemoryChecks >= 3
          )
            stop("conversion_unavailable");
        })
        .finally(() => {
          checkingMemory = false;
        });
    }, 100);
    child.on("message", (message: WorkerMessage) => {
      if (failure || closed) return;
      if (!message || typeof message !== "object") return stop("malformed");
      if (message.type === "error") {
        stop(Object.hasOwn(safeMessages, message.code) ? message.code : "malformed");
      } else if (message.type === "page") {
        const page = message.page;
        if (
          warnings ||
          !page ||
          page.pageNumber !== pages.length + 1 ||
          !Number.isInteger(page.width) ||
          !Number.isInteger(page.height) ||
          page.width < 1 ||
          page.height < 1 ||
          Math.max(page.width, page.height) > PRESENTATION_VISUAL_LIMITS.longestEdge ||
          page.width * page.height > PRESENTATION_VISUAL_LIMITS.pagePixels ||
          !(page.png instanceof Uint8Array) ||
          page.png.length < 24 ||
          Buffer.from(page.png.subarray(0, 8)).toString("hex") !== "89504e470d0a1a0a" ||
          typeof page.extractedText !== "string" ||
          page.extractedText.length > PRESENTATION_VISUAL_LIMITS.textCharacters
        )
          return stop("malformed");
        pixels += page.width * page.height;
        outputBytes += page.png.length;
        if (
          pixels > PRESENTATION_VISUAL_LIMITS.totalPixels ||
          outputBytes > PRESENTATION_VISUAL_LIMITS.outputBytes ||
          pages.length >= PRESENTATION_VISUAL_LIMITS.pages
        )
          return stop("limit");
        pages.push(page);
      } else if (message.type === "done") {
        if (
          !Array.isArray(message.warnings) ||
          message.warnings.length > 50 ||
          message.warnings.some((warning) => typeof warning !== "string" || warning.length > 300)
        )
          return stop("malformed");
        warnings = message.warnings;
      } else stop("malformed");
    });
    child.once("error", () => stop("conversion_unavailable"));
    // Resolve/reject only after close, so every completion has reaped its child.
    child.once("close", (code) => {
      closed = true;
      clearTimeout(timeout);
      clearInterval(memoryCheck);
      if (failure) reject(failure);
      else if (code === 0 && warnings && pages.length) resolveResult({ pages, warnings });
      else reject(new PresentationVisualConversionError("conversion_unavailable"));
    });
    child.send(input, (error) => {
      if (error) stop("conversion_unavailable");
    });
  });
}
