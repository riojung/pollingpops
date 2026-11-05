import { execFile } from "node:child_process";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import PDFDocument from "pdfkit";
import { describe, expect, it } from "vitest";
import {
  convertPresentationVisualIsolated,
  inspectPresentationVisualImage,
  PRESENTATION_VISUAL_LIMITS,
  PresentationVisualConversionError,
  presentationVisualConversionAvailable,
  presentationVisualOutputSize,
} from "../src/presentation-visual-converter.js";

async function pdf(
  configure: (document: PDFKit.PDFDocument) => void,
  options: PDFKit.PDFDocumentOptions = {},
): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const document = new PDFDocument({ size: [400, 200], margin: 0, ...options });
    const chunks: Buffer[] = [];
    document.on("data", (chunk: Buffer) => chunks.push(chunk));
    document.on("end", () => resolve(Buffer.concat(chunks)));
    document.on("error", reject);
    configure(document);
    document.end();
  });
}
function input(bytes: Uint8Array) {
  return { kind: "pdf" as const, bytes, mimeType: "application/pdf" };
}

type ExifByteOrder = "II" | "MM";
function orientationMetadata(orientation: number, byteOrder: ExifByteOrder) {
  // One bounded TIFF IFD containing only the SHORT-valued Orientation tag.
  const tiff = Buffer.alloc(26);
  const short = (value: number, offset: number) =>
    byteOrder === "II" ? tiff.writeUInt16LE(value, offset) : tiff.writeUInt16BE(value, offset);
  const long = (value: number, offset: number) =>
    byteOrder === "II" ? tiff.writeUInt32LE(value, offset) : tiff.writeUInt32BE(value, offset);
  tiff.write(byteOrder, 0);
  short(42, 2);
  long(8, 4);
  short(1, 8);
  short(0x0112, 10);
  short(3, 12);
  long(1, 14);
  short(orientation, 18);
  return tiff;
}

function withImageOrientation(
  bytes: Buffer,
  mimeType: "image/jpeg" | "image/webp",
  orientation: number,
  byteOrder: ExifByteOrder,
) {
  const tiff = orientationMetadata(orientation, byteOrder);
  if (mimeType === "image/jpeg") {
    const metadata = Buffer.concat([Buffer.from("Exif\0\0"), tiff]);
    const marker = Buffer.alloc(4);
    marker.writeUInt16BE(0xffe1, 0);
    marker.writeUInt16BE(metadata.length + 2, 2);
    return Buffer.concat([bytes.subarray(0, 2), marker, metadata, bytes.subarray(2)]);
  }
  // The canvas encoder emits an extended WebP; preserve its existing ICC/bitstream chunks.
  const result = Buffer.concat([bytes, Buffer.alloc(8), tiff]);
  expect(result.toString("ascii", 12, 16)).toBe("VP8X");
  result[20] = result[20]! | 0x08;
  result.write("EXIF", bytes.length);
  result.writeUInt32LE(tiff.length, bytes.length + 4);
  result.writeUInt32LE(result.length - 8, 4);
  return result;
}

const cornerColors = [
  [255, 0, 0],
  [0, 255, 0],
  [0, 0, 255],
  [255, 255, 0],
] as const;
const orientationCorners = [
  [0, 1, 2, 3],
  [1, 0, 3, 2],
  [3, 2, 1, 0],
  [2, 3, 0, 1],
  [0, 2, 1, 3],
  [2, 0, 3, 1],
  [3, 1, 2, 0],
  [1, 3, 0, 2],
] as const;
const orientationCases = (["image/jpeg", "image/webp"] as const).flatMap((mimeType) =>
  (["II", "MM"] as const).flatMap((byteOrder) =>
    orientationCorners.map((corners, index) => ({
      mimeType,
      byteOrder,
      orientation: index + 1,
      corners,
    })),
  ),
);
const available = presentationVisualConversionAvailable();

describe("bounded presentation visual conversion", () => {
  it("fails closed where the runtime cannot deny network access", async () => {
    if (available) return;
    await expect(
      convertPresentationVisualIsolated(input(await pdf((doc) => doc.text("Safe")))),
    ).rejects.toMatchObject({ code: "conversion_unavailable" });
  });

  it("rejects bad headers and compressed-image dimensions before native decoding", async () => {
    await expect(
      convertPresentationVisualIsolated(input(new TextEncoder().encode("secret malformed input"))),
    ).rejects.toMatchObject({ code: "malformed" });
    const image = createCanvas(2, 2).toBuffer("image/png");
    image.writeUInt32BE(0x7fffffff, 16);
    expect(() => inspectPresentationVisualImage(image, "image/png")).toThrowError(
      PresentationVisualConversionError,
    );
    await expect(
      convertPresentationVisualIsolated({ kind: "image", bytes: image, mimeType: "image/png" }),
    ).rejects.toMatchObject({ code: "limit" });
  });

  it("enforces input budgets and keeps errors free of parser content", async () => {
    await expect(
      convertPresentationVisualIsolated(
        input(new Uint8Array(PRESENTATION_VISUAL_LIMITS.pdfBytes + 1)),
      ),
    ).rejects.toMatchObject({ code: "limit" });
    await expect(
      convertPresentationVisualIsolated({
        kind: "image",
        bytes: new Uint8Array(PRESENTATION_VISUAL_LIMITS.imageBytes + 1),
        mimeType: "image/png",
      }),
    ).rejects.toMatchObject({ code: "limit" });
    const error = await convertPresentationVisualIsolated(
      input(new TextEncoder().encode("PRIVATE DOC STRING")),
    ).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(PresentationVisualConversionError);
    expect((error as Error).message).not.toContain("PRIVATE");
    const size = presentationVisualOutputSize(1000, 1000);
    expect(size.width * size.height).toBeLessThanOrEqual(PRESENTATION_VISUAL_LIMITS.pagePixels);
    expect(presentationVisualOutputSize(1920, 1080)).toEqual({ width: 1600, height: 900 });
  });

  it("rejects type mismatch, SVG and malformed WebP frame dimensions", () => {
    const image = createCanvas(3, 2).toBuffer("image/png");
    expect(() => inspectPresentationVisualImage(image, "image/jpeg")).toThrow();
    expect(() =>
      inspectPresentationVisualImage(new TextEncoder().encode("<svg/>"), "image/svg+xml"),
    ).toThrow();
    const webp = createCanvas(3, 2).toBuffer("image/webp");
    expect(inspectPresentationVisualImage(webp, "image/webp")).toEqual({ width: 3, height: 2 });
    const extended = Buffer.alloc(30);
    extended.write("RIFF", 0);
    extended.writeUInt32LE(22, 4);
    extended.write("WEBPVP8X", 8);
    extended.writeUInt32LE(10, 16);
    extended.writeUIntLE(0xffffff, 24, 3);
    extended.writeUIntLE(0xffffff, 27, 3);
    expect(() => inspectPresentationVisualImage(extended, "image/webp")).toThrow();
  });

  it.runIf(available)(
    "rasterizes actual PDF content and extracts text with bounded dimensions",
    async () => {
      const result = await convertPresentationVisualIsolated(
        input(
          await pdf((doc) => {
            doc.rect(0, 0, 400, 200).fill("#ff0000");
            doc.fillColor("black").fontSize(24).text("Visual import", 25, 30);
          }),
        ),
      );
      expect(result.pages).toHaveLength(1);
      const page = result.pages[0]!;
      expect(page).toMatchObject({ pageNumber: 1, width: 1600, height: 800 });
      expect(Buffer.from(page.png.subarray(0, 8)).toString("hex")).toBe("89504e470d0a1a0a");
      expect(page.png.length).toBeGreaterThan(1000);
      const raster = await loadImage(page.png);
      const sample = createCanvas(page.width, page.height);
      sample.getContext("2d").drawImage(raster, 0, 0);
      expect([...sample.getContext("2d").getImageData(1590, 790, 1, 1).data]).toEqual([
        255, 0, 0, 255,
      ]);
      expect(page.extractedText).toContain("Visual import");
      expect(result.warnings.join(" ")).toContain("author review");
    },
  );

  it.runIf(available)("honors inherited PDF rotation", async () => {
    const bytes = await pdf((doc) => {
      (
        doc.page as unknown as { dictionary: { data: Record<string, unknown> } }
      ).dictionary.data.Rotate = 90;
      doc.text("Rotated", 20, 20);
    });
    const { pages } = await convertPresentationVisualIsolated(input(bytes));
    expect(pages[0]).toMatchObject({ width: 800, height: 1600 });
  });

  it.runIf(available)(
    "accepts ordinary literal text and metadata containing the Encrypt name",
    async () => {
      const bytes = await pdf(
        (doc) => {
          doc.text("PDF /Encrypt is a dictionary name", 10, 10);
          doc.addContent("% /Encrypt in a comment\n");
        },
        { compress: false, info: { Title: "Use /Encrypt (flag) safely" } },
      );
      const result = await convertPresentationVisualIsolated(input(bytes));
      expect(result.pages[0]!.extractedText).toContain("/Encrypt");
    },
  );

  it.runIf(available)("rejects password-protected and empty-password encrypted PDFs", async () => {
    const protectedPdf = await pdf((doc) => doc.text("Encrypted"), {
      userPassword: "secret",
      ownerPassword: "owner",
    });
    const ownerOnlyPdf = await pdf((doc) => doc.text("Encrypted"), { ownerPassword: "owner" });
    await expect(convertPresentationVisualIsolated(input(protectedPdf))).rejects.toMatchObject({
      code: "encrypted",
    });
    await expect(convertPresentationVisualIsolated(input(ownerOnlyPdf))).rejects.toMatchObject({
      code: "encrypted",
    });
  });

  it.runIf(available)(
    "rejects oversized embedded PDF images instead of silently dropping them",
    async () => {
      const canvas = createCanvas(1500, 1500);
      canvas.getContext("2d").fillRect(0, 0, 1500, 1500);
      const image = canvas.toBuffer("image/png");
      const bytes = await pdf((doc) => doc.image(image, 0, 0, { width: 200, height: 200 }));
      const code = await convertPresentationVisualIsolated(input(bytes)).then(
        () => "success",
        (error: PresentationVisualConversionError) => error.code,
      );
      expect(code).toBe("limit");
    },
  );

  it.runIf(available)(
    "rejects oversized inline PDF images inside compressed content streams",
    async () => {
      const bytes = await pdf((doc) =>
        doc.addContent(`BI /W 2000 /H 2000 /CS /G /BPC 8 ID\n${"\0".repeat(4_000_000)}\nEI`),
      );
      const code = await convertPresentationVisualIsolated(input(bytes)).then(
        () => "success",
        (error: PresentationVisualConversionError) => error.code,
      );
      expect(code).toBe("limit");
    },
  );

  it.runIf(available)("bounds compressed PDF streams before parser expansion", async () => {
    const bytes = await pdf((doc) => doc.addContent(" ".repeat(17 * 1024 * 1024)));
    expect(bytes.length).toBeLessThan(PRESENTATION_VISUAL_LIMITS.pdfBytes);
    const abbreviated = Buffer.from(
      Buffer.from(bytes)
        .toString("latin1")
        .replaceAll("/FlateDecode", "/Fl".padEnd("/FlateDecode".length, " ")),
      "latin1",
    );
    for (const payload of [bytes, abbreviated]) {
      const code = await convertPresentationVisualIsolated(input(payload)).then(
        () => "success",
        (error: PresentationVisualConversionError) => error.code,
      );
      expect(code).toBe("limit");
    }
  });

  it.runIf(available)("bounds extracted text and reports truncation", async () => {
    const bytes = await pdf((doc) => {
      for (let line = 0; line < 70; line++) {
        doc.fontSize(2).text("Reading order review ".repeat(8), 2, line * 2, { lineBreak: false });
      }
    });
    const result = await convertPresentationVisualIsolated(input(bytes));
    expect(result.pages[0]!.extractedText.length).toBeLessThanOrEqual(6000);
    expect(result.warnings.some((warning) => warning.includes("limited to 6000"))).toBe(true);
  });

  it.runIf(available)("rejects broken PDFs even when a PDF header is present", async () => {
    const valid = await pdf((doc) => doc.text("Complete"));
    await expect(
      convertPresentationVisualIsolated(input(valid.subarray(0, valid.length - 10))),
    ).rejects.toMatchObject({ code: "malformed" });
    const fake = new TextEncoder().encode(
      "%PDF-1.7\nxref\n0 1\n0000000000 65535 f\ntrailer\n<< /Size 1 >>\nstartxref\n9\n%%EOF\n",
    );
    await expect(convertPresentationVisualIsolated(input(fake))).rejects.toMatchObject({
      code: "malformed",
    });
  });

  it.runIf(available)("rejects page and total raster pixel limits before rendering", async () => {
    const tooMany = await pdf((doc) => {
      for (let i = 1; i < 41; i++) doc.addPage();
    });
    await expect(convertPresentationVisualIsolated(input(tooMany))).rejects.toMatchObject({
      code: "limit",
    });
    const tooManyPixels = await pdf(
      (doc) => {
        for (let i = 1; i < 31; i++) doc.addPage();
      },
      { size: [400, 400] },
    );
    await expect(convertPresentationVisualIsolated(input(tooManyPixels))).rejects.toMatchObject({
      code: "limit",
    });
  });

  it.runIf(available)("kills and reaps timed-out conversion processes", async () => {
    const bytes = await pdf((doc) => doc.text("A real document"));
    await expect(convertPresentationVisualIsolated(input(bytes), 1)).rejects.toMatchObject({
      code: "timeout",
    });
    // Successful work after timeout demonstrates the failed process cannot poison the next conversion.
    await expect(convertPresentationVisualIsolated(input(bytes))).resolves.toMatchObject({
      pages: [expect.objectContaining({ pageNumber: 1 })],
    });
  });

  it.runIf(available)("normalizes PNG, JPEG and WebP bytes to bounded PNGs", async () => {
    const canvas = createCanvas(120, 60);
    canvas.getContext("2d").fillRect(0, 0, 120, 60);
    for (const mimeType of ["image/png", "image/jpeg", "image/webp"] as const) {
      const bytes = canvas.toBuffer(mimeType as "image/png");
      const { pages } = await convertPresentationVisualIsolated({ kind: "image", bytes, mimeType });
      expect(pages[0]).toMatchObject({ width: 1600, height: 800, extractedText: "" });
      expect(Buffer.from(pages[0]!.png.subarray(0, 8)).toString("hex")).toBe("89504e470d0a1a0a");
    }
  });

  it.runIf(available).each(orientationCases)(
    "honors $mimeType EXIF orientation $orientation with $byteOrder byte order",
    async ({ mimeType, byteOrder, orientation, corners }) => {
      const canvas = createCanvas(120, 60);
      const context = canvas.getContext("2d");
      for (const [index, color] of cornerColors.entries()) {
        context.fillStyle = `rgb(${color.join(",")})`;
        context.fillRect((index % 2) * 60, Math.floor(index / 2) * 30, 60, 30);
      }
      const bytes = withImageOrientation(
        canvas.toBuffer(mimeType as "image/jpeg"),
        mimeType,
        orientation,
        byteOrder,
      );
      expect(inspectPresentationVisualImage(bytes, mimeType)).toEqual({ width: 120, height: 60 });
      const { pages } = await convertPresentationVisualIsolated({ kind: "image", bytes, mimeType });
      expect(pages).toHaveLength(1);
      const page = pages[0]!;
      expect(page).toMatchObject(
        orientation >= 5 ? { width: 800, height: 1600 } : { width: 1600, height: 800 },
      );
      const raster = createCanvas(page.width, page.height);
      const rasterContext = raster.getContext("2d");
      rasterContext.drawImage(await loadImage(page.png), 0, 0);
      for (const [index, corner] of corners.entries()) {
        const x = Math.floor(page.width * (index % 2 === 0 ? 0.25 : 0.75));
        const y = Math.floor(page.height * (index < 2 ? 0.25 : 0.75));
        const pixel = rasterContext.getImageData(x, y, 1, 1).data;
        for (const [channel, expected] of cornerColors[corner].entries())
          expect(Math.abs(pixel[channel]! - expected)).toBeLessThanOrEqual(12);
        expect(pixel[3]).toBe(255);
      }
    },
  );

  it.each([6, 8])(
    "rejects oversized JPEG headers before decoding EXIF orientation %i",
    async (orientation) => {
      const encoded = createCanvas(120, 60).toBuffer("image/jpeg");
      for (const [width, height] of [
        [PRESENTATION_VISUAL_LIMITS.sourceImageEdge + 1, 1],
        [4001, 4000],
      ]) {
        const bytes = withImageOrientation(encoded, "image/jpeg", orientation, "II");
        const frame = bytes.indexOf(Buffer.from([0xff, 0xc0]));
        expect(frame).toBeGreaterThan(0);
        bytes.writeUInt16BE(height!, frame + 5);
        bytes.writeUInt16BE(width!, frame + 7);
        await expect(
          convertPresentationVisualIsolated({ kind: "image", bytes, mimeType: "image/jpeg" }),
        ).rejects.toMatchObject({ code: "limit" });
      }
    },
  );

  it.runIf(available)("uses real Node permission enforcement for outbound sockets", async () => {
    const result = await new Promise<string>((resolve, reject) => {
      execFile(
        process.execPath,
        [
          "--permission",
          "-e",
          "const socket=require('node:net').connect(9,'127.0.0.1');socket.on('error',error=>{process.stdout.write(error.code);process.exit(error.code==='ERR_ACCESS_DENIED'?0:1)})",
        ],
        { timeout: 2000 },
        (error, stdout) => (error ? reject(error) : resolve(stdout)),
      );
    });
    expect(result).toBe("ERR_ACCESS_DENIED");
  });
});
