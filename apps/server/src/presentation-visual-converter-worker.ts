import { readFile } from "node:fs/promises";
import { inflateSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import type { Canvas, SKRSContext2D } from "@napi-rs/canvas";
import type * as VisualConverter from "./presentation-visual-converter.js";
import type {
  PresentationVisualConversionErrorCode,
  PresentationVisualConversionInput,
  PresentationVisualPage,
} from "./presentation-visual-converter.js";

const extension = import.meta.url.endsWith(".ts") ? "ts" : "js";
const {
  PresentationVisualConversionError,
  PRESENTATION_VISUAL_LIMITS: limits,
  validatePresentationVisualInput,
  inspectPresentationVisualImage,
  presentationVisualOutputSize,
} = (await import(
  new URL(`./presentation-visual-converter.${extension}`, import.meta.url).href
)) as typeof VisualConverter;

function fail(code: PresentationVisualConversionErrorCode): never {
  throw new PresentationVisualConversionError(code);
}
function send(message: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!process.send) return reject(new Error("Missing converter IPC"));
    process.send(message, (error: Error | null) => (error ? reject(error) : resolve()));
  });
}

// Never run in an accidentally unrestricted process, including a manual direct launch.
if (
  !process.send ||
  !process.permission ||
  process.permission.has("net") ||
  process.permission.has("child") ||
  process.permission.has("worker") ||
  process.permission.has("fs.write")
)
  process.exit(1);

// PDF.js no longer exposes isEvalSupported in v6. Eval is disabled by a V8 flag.
// No scripting manager, attachments, annotation actions or XFA are ever executed.
// Native canvas is trusted; Node permissions do not form an OS/native-code sandbox.
const { createCanvas, loadImage } = await import("@napi-rs/canvas");
let allocatedPixels = 0;
const allocations = new WeakMap<Canvas, number>();
function checkCanvas(width: number, height: number, previous = 0): number {
  const pixels = Math.ceil(width) * Math.ceil(height);
  if (
    !Number.isFinite(pixels) ||
    width <= 0 ||
    height <= 0 ||
    width > limits.sourceImageEdge ||
    height > limits.sourceImageEdge ||
    pixels > limits.canvasPixels ||
    allocatedPixels - previous + pixels > limits.canvasPixels
  )
    fail("limit");
  return pixels;
}
type CanvasPair = { canvas: Canvas | null; context: SKRSContext2D | null };
class BoundedCanvasFactory {
  create(width: number, height: number): CanvasPair {
    const pixels = checkCanvas(width, height);
    const canvas = createCanvas(Math.ceil(width), Math.ceil(height));
    allocatedPixels += pixels;
    allocations.set(canvas, pixels);
    return { canvas, context: canvas.getContext("2d") };
  }
  reset(pair: CanvasPair, width: number, height: number): void {
    if (!pair.canvas) fail("malformed");
    const previous = allocations.get(pair.canvas) ?? 0;
    const pixels = checkCanvas(width, height, previous);
    pair.canvas.width = Math.ceil(width);
    pair.canvas.height = Math.ceil(height);
    allocatedPixels += pixels - previous;
    allocations.set(pair.canvas, pixels);
  }
  destroy(pair: CanvasPair): void {
    if (pair.canvas) {
      allocatedPixels -= allocations.get(pair.canvas) ?? 0;
      allocations.delete(pair.canvas);
      pair.canvas.width = pair.canvas.height = 1;
    }
    pair.canvas = null;
    pair.context = null;
  }
}
const factory = new BoundedCanvasFactory();
const pdfRoot = new URL("./", import.meta.resolve("pdfjs-dist/package.json"));
class LocalBinaryDataFactory {
  async fetch({ kind, filename }: { kind: string; filename: string }): Promise<Uint8Array> {
    // Only shipped non-executable CMaps/fonts. Never accept a document-provided URL.
    if (!/^[A-Za-z0-9_.-]+$/.test(filename) || filename.includes("..")) fail("malformed");
    const directory =
      kind === "cMapUrl" ? "cmaps" : kind === "standardFontDataUrl" ? "standard_fonts" : undefined;
    if (!directory) fail("malformed");
    const bytes = await readFile(new URL(`${directory}/${filename}`, pdfRoot));
    if (bytes.length > 2 * 1024 * 1024) fail("limit");
    return new Uint8Array(bytes);
  }
}

function safeErrorCode(error: unknown): PresentationVisualConversionErrorCode {
  if (error instanceof PresentationVisualConversionError) return error.code;
  if (error instanceof Error) {
    if (error.name === "PasswordException") return "encrypted";
    if (/Image exceeded maximum allowed size|canvas|allocation|out of memory/i.test(error.message))
      return "limit";
    if ((error as NodeJS.ErrnoException).code === "ERR_ACCESS_DENIED")
      return "conversion_unavailable";
  }
  return "malformed";
}

function pngWithoutMetadata(bytes: Uint8Array): Uint8Array {
  // Avoid libpng expanding untrusted iCCP/text metadata. The critical image stream is bounded by IHDR.
  const input = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const parts = [input.subarray(0, 8)];
  for (let offset = 8; offset + 12 <= input.length;) {
    const length = input.readUInt32BE(offset);
    const kind = input.toString("ascii", offset + 4, offset + 8);
    if (["IHDR", "PLTE", "tRNS", "IDAT", "IEND"].includes(kind))
      parts.push(input.subarray(offset, offset + length + 12));
    else if (kind.charCodeAt(0) >= 65 && kind.charCodeAt(0) <= 90) fail("malformed");
    offset += length + 12;
  }
  return Buffer.concat(parts);
}

async function convertImage(input: PresentationVisualConversionInput): Promise<string[]> {
  const source = inspectPresentationVisualImage(input.bytes, input.mimeType);
  // Buffer input exclusively: loadImage's URL/path branches are unreachable.
  const image = await loadImage(
    input.mimeType === "image/png" ? pngWithoutMetadata(input.bytes) : input.bytes,
  );
  // The decoder already applies EXIF orientation. An axis swap preserves every predecode
  // pixel/edge budget; any other dimension mismatch still rejects the file.
  const sameAxes = image.width === source.width && image.height === source.height;
  const swappedAxes = image.width === source.height && image.height === source.width;
  if (!sameAxes && !swappedAxes) fail("malformed");
  const size = presentationVisualOutputSize(image.width, image.height);
  const pair = factory.create(size.width, size.height);
  try {
    pair.context!.fillStyle = "#ffffff";
    pair.context!.fillRect(0, 0, size.width, size.height);
    pair.context!.drawImage(image, 0, 0, size.width, size.height);
    const png = await pair.canvas!.encode("png");
    if (png.length > limits.outputBytes) fail("limit");
    await send({
      type: "page",
      page: { pageNumber: 1, ...size, png, extractedText: "" } satisfies PresentationVisualPage,
    });
  } finally {
    factory.destroy(pair);
  }
  return [
    "Image text is not extracted. Add and review an accessible description before inserting this slide.",
  ];
}

/** Conservative preflight; stream dictionaries themselves cannot be compressed object-stream objects. */
function preflightPdfStreams(bytes: Uint8Array): void {
  const data = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const body = data.toString("latin1");
  const decodeNames = (text: string) =>
    text.replace(/#([0-9a-f]{2})/gi, (_match, hex: string) =>
      String.fromCharCode(Number.parseInt(hex, 16)),
    );
  const lengths = new Map<string, number>();
  for (const object of body.matchAll(/(?:^|[\r\n])\s*(\d+)\s+(\d+)\s+obj\s+(\d+)\s+endobj\b/g)) {
    lengths.set(`${object[1]} ${object[2]}`, Number(object[3]));
  }
  function checkInlineImages(payload: Uint8Array): void {
    const operators = Buffer.from(payload.buffer, payload.byteOffset, payload.byteLength).toString(
      "latin1",
    );
    for (const inline of operators.matchAll(/\bBI\s+([\s\S]{0,4096}?)\bID(?:\s|$)/g)) {
      const header = decodeNames(inline[1]!);
      const width = /\/(?:Width|W)\s+(\d+)\b/.exec(header);
      const height = /\/(?:Height|H)\s+(\d+)\b/.exec(header);
      if (!width || !height) continue;
      if (
        Number(width[1]) * Number(height[1]) > limits.pagePixels ||
        Number(width[1]) > limits.sourceImageEdge ||
        Number(height[1]) > limits.sourceImageEdge
      )
        fail("limit");
      if (/\/(?:LZWDecode|LZW)\b/.test(header)) fail("malformed");
    }
  }
  const streams: Array<{ header: string; encoded: Buffer }> = [];
  const outsideStreams: string[] = [];
  let outsideCursor = 0;
  const objects = /(?:^|[\r\n])\s*\d+\s+\d+\s+obj\b/g;
  for (let object = objects.exec(body); object; object = objects.exec(body)) {
    const start = objects.lastIndex;
    const endObject = body.indexOf("endobj", start);
    // Bound header scanning independently of compressed stream contents.
    const candidate = body.slice(
      start,
      Math.min(endObject < 0 ? body.length : endObject, start + 65_536),
    );
    const found = /\bstream(?:\r\n|\r|\n)/.exec(candidate);
    if (!found) continue;
    const dataStart = start + found.index + found[0].length;
    const header = decodeNames(candidate.slice(0, found.index)).replace(/%[^\r\n]*/g, "");
    if (!/^\s*<</.test(header) || !/>>\s*$/.test(header)) fail("malformed");
    const lengthToken = /\/Length\s+(\d+)(?:\s+(\d+)\s+R\b)?/.exec(header);
    if (!lengthToken) fail("malformed");
    const length =
      lengthToken[2] === undefined
        ? Number(lengthToken[1])
        : lengths.get(`${lengthToken[1]} ${lengthToken[2]}`);
    if (
      length === undefined ||
      !Number.isSafeInteger(length) ||
      length < 0 ||
      length > data.length - dataStart
    )
      fail("malformed");
    const end = dataStart + length;
    if (!/^\s*endstream\b/.test(body.slice(end, end + 32))) fail("malformed");
    const encoded = data.subarray(dataStart, end);
    objects.lastIndex = end + 9;
    streams.push({ header, encoded });
    outsideStreams.push(body.slice(outsideCursor, dataStart));
    outsideCursor = end;
  }
  outsideStreams.push(body.slice(outsideCursor));
  const syntax = outsideStreams.join("");
  // Match a PDF name token outside strings, hex strings, comments and stream bytes.
  // Ordinary security/programming text containing "/Encrypt" remains importable.
  for (let index = 0; index < syntax.length;) {
    const character = syntax[index];
    if (character === "(") {
      let depth = 1;
      index++;
      while (index < syntax.length && depth) {
        if (syntax[index] === "\\") {
          index += 2;
          continue;
        }
        if (syntax[index] === "(") depth++;
        if (syntax[index] === ")") depth--;
        index++;
      }
    } else if (character === "<") {
      if (syntax[index + 1] === "<") index += 2;
      else {
        const end = syntax.indexOf(">", index + 1);
        index = end < 0 ? syntax.length : end + 1;
      }
    } else if (character === "%") {
      while (index < syntax.length && !/[\r\n]/.test(syntax[index]!)) index++;
    } else if (character === "/") {
      const start = ++index;
      while (index < syntax.length && !/[\s()[\]<>/%]/.test(syntax[index]!)) index++;
      if (decodeNames(syntax.slice(start, index)) === "Encrypt") fail("encrypted");
    } else index++;
  }
  let decompressed = 0;
  for (const { header, encoded } of streams) {
    if (/\/Subtype\s*\/Image\b/.test(header)) {
      const width = /\/Width\s+(\d+)\b(?!\s+\d+\s+R\b)/.exec(header);
      const height = /\/Height\s+(\d+)\b(?!\s+\d+\s+R\b)/.exec(header);
      // Indirect image dimensions are deliberately unsupported: native allocation needs an upfront bound.
      if (!width || !height) fail("malformed");
      const pixels = Number(width[1]) * Number(height[1]);
      if (!Number.isSafeInteger(pixels) || pixels <= 0) fail("malformed");
      if (
        pixels > limits.pagePixels ||
        Number(width[1]) > limits.sourceImageEdge ||
        Number(height[1]) > limits.sourceImageEdge
      )
        fail("limit");
      if (/\/(?:DCTDecode|DCT)\b/.test(header)) {
        const size = inspectPresentationVisualImage(encoded, "image/jpeg");
        if (size.width * size.height > limits.pagePixels) fail("limit");
      }
    }
    const aliases: Record<string, string> = {
      "/Fl": "/FlateDecode",
      "/LZW": "/LZWDecode",
      "/RL": "/RunLengthDecode",
    };
    const filter = /\/Filter\s*(\/\w+|\[[^\]]*\])/
      .exec(header)?.[1]
      ?.replace(/\/(?:Fl|LZW|RL)\b/g, (alias) => aliases[alias]!);
    if (/\/Filter\b/.test(header) && !filter) fail("malformed");
    if (filter?.includes("LZWDecode")) fail("malformed");
    if (filter?.includes("FlateDecode")) {
      // Multiple filter stages can conceal another decompression layer; require a fresh PDF export.
      if (!/^\/FlateDecode$|^\[\s*\/FlateDecode\s*\]$/.test(filter)) fail("malformed");
      try {
        const expanded = inflateSync(encoded, { maxOutputLength: 16 * 1024 * 1024 });
        checkInlineImages(expanded);
        decompressed += expanded.length;
        if (decompressed > 64 * 1024 * 1024) fail("limit");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ERR_BUFFER_TOO_LARGE") fail("limit");
        throw error;
      }
    } else if (!filter) {
      checkInlineImages(encoded);
    } else if (filter?.includes("RunLengthDecode")) {
      let expanded = 0;
      for (let offset = 0; offset < encoded.length;) {
        const count = encoded[offset++]!;
        if (count === 128) break;
        expanded += count < 128 ? count + 1 : 257 - count;
        offset += count < 128 ? count + 1 : 1;
        if (offset > encoded.length) fail("malformed");
        if (expanded > 16 * 1024 * 1024) fail("limit");
      }
      decompressed += expanded;
      if (decompressed > 64 * 1024 * 1024) fail("limit");
    }
  }
}

async function convertPdf(input: PresentationVisualConversionInput): Promise<string[]> {
  preflightPdfStreams(input.bytes);
  const { getDocument, AnnotationMode, VerbosityLevel } =
    await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = getDocument({
    data: new Uint8Array(input.bytes),
    CanvasFactory: BoundedCanvasFactory,
    BinaryDataFactory: LocalBinaryDataFactory,
    verbosity: VerbosityLevel.ERRORS,
    useWasm: false,
    useWorkerFetch: false,
    useSystemFonts: false,
    disableFontFace: true,
    enableXfa: false,
    stopAtErrors: true,
    maxImageSize: limits.pagePixels,
    canvasMaxAreaInBytes: limits.canvasPixels * 4,
    isOffscreenCanvasSupported: false,
    isImageDecoderSupported: false,
    disableAutoFetch: true,
    disableRange: true,
    disableStream: true,
    cMapUrl: fileURLToPath(new URL("cmaps/", pdfRoot)),
    standardFontDataUrl: fileURLToPath(new URL("standard_fonts/", pdfRoot)),
  });
  const password = new Promise<never>((_resolve, reject) => {
    task.onPassword = () => reject(new PresentationVisualConversionError("encrypted"));
  });
  const warnings = [
    "Visual slides are flattened images. Editable objects, animation, audio, video and interactive actions are not imported.",
    "Extracted text needs author review for reading order, accuracy and meaning before insertion.",
  ];
  try {
    const document = await Promise.race([task.promise, password]);
    const { info } = await document.getMetadata();
    if ((info as { EncryptFilterName?: unknown }).EncryptFilterName) fail("encrypted");
    if (!Number.isInteger(document.numPages) || document.numPages < 1) fail("malformed");
    if (document.numPages > limits.pages) fail("limit");
    let totalPixels = 0;
    let outputBytes = 0;
    // Preflight all output dimensions before doing any native rendering.
    const sizes: Array<{ width: number; height: number }> = [];
    for (let number = 1; number <= document.numPages; number++) {
      const page = await document.getPage(number);
      const viewport = page.getViewport({ scale: 1 }); // Includes inherited PDF rotation.
      const size = presentationVisualOutputSize(viewport.width, viewport.height);
      totalPixels += size.width * size.height;
      if (totalPixels > limits.totalPixels) fail("limit");
      sizes.push(size);
      page.cleanup();
    }
    for (let number = 1; number <= document.numPages; number++) {
      const page = await document.getPage(number);
      const size = sizes[number - 1]!;
      const original = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({
        scale: Math.min(size.width / original.width, size.height / original.height),
      });
      const pair = factory.create(size.width, size.height);
      try {
        await page.getOperatorList({ intent: "display", annotationMode: AnnotationMode.DISABLE });
        await page.render({
          canvas: pair.canvas as unknown as HTMLCanvasElement,
          canvasContext: pair.context as unknown as CanvasRenderingContext2D,
          viewport,
          annotationMode: AnnotationMode.DISABLE,
          background: "rgb(255,255,255)",
        }).promise;
        let extractedText = "";
        let truncated = false;
        // Streaming keeps text extraction from collecting an unbounded page before truncation.
        const reader = page.streamTextContent({ disableNormalization: false }).getReader();
        try {
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            for (const item of value.items) {
              if (!("str" in item)) continue;
              const text = item.str.replace(/\p{Cc}/gu, (character: string) =>
                ["\t", "\r", "\n"].includes(character) ? character : "",
              );
              const remaining = limits.textCharacters - extractedText.length;
              const next = `${text}${item.hasEOL ? "\n" : " "}`;
              extractedText += next.slice(0, remaining);
              if (next.length > remaining || extractedText.length >= limits.textCharacters) {
                truncated = true;
                break;
              }
            }
            if (truncated) break;
          }
        } finally {
          await reader.cancel(new Error("Bounded visual text extraction finished"));
        }
        if (truncated)
          warnings.push(
            `Page ${number}: extracted text was limited to ${limits.textCharacters} characters; review and complete it.`,
          );
        const png = await pair.canvas!.encode("png");
        outputBytes += png.length;
        if (outputBytes > limits.outputBytes) fail("limit");
        await send({
          type: "page",
          page: {
            pageNumber: number,
            ...size,
            png,
            extractedText: extractedText.trim(),
          } satisfies PresentationVisualPage,
        });
      } finally {
        factory.destroy(pair);
        page.cleanup();
      }
    }
    return warnings;
  } finally {
    await task.destroy();
  }
}

process.once("disconnect", () => process.exit(1));

process.once("message", async (input: PresentationVisualConversionInput) => {
  try {
    validatePresentationVisualInput(input);
    const warnings = input.kind === "pdf" ? await convertPdf(input) : await convertImage(input);
    await send({ type: "done", warnings });
  } catch (error) {
    await send({ type: "error", code: safeErrorCode(error) }).catch(() => undefined);
  } finally {
    process.disconnect?.();
    process.exit(0);
  }
});
