import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  CreatePresentationVisualImportSchema,
  InsertPresentationVisualImportSchema,
  PresentationVisualImportJobSchema,
  PresentationVisualImportPageSchema,
  PRESENTATION_VISUAL_IMPORT_MAX_PDF_BYTES,
} from "../src/index.js";
const file = (mimeType = "image/png", bytes = Buffer.from("bounded source")) => ({
  name: "Source image",
  mimeType,
  base64: bytes.toString("base64"),
});
describe("Presentation visual import contracts", () => {
  it("bounds converted pixels and prevents duplicate asset aliases in a ready manifest", () => {
    const page = {
      pageNumber: 1,
      mediaId: randomUUID(),
      width: 1600,
      height: 1000,
      extractedText: "Reviewed suggestion",
      warnings: [],
    };
    expect(PresentationVisualImportPageSchema.safeParse(page).success).toBe(true);
    for (const invalid of [
      { ...page, width: 1601 },
      { ...page, height: 1600 },
      { ...page, extractedText: "😀".repeat(3001) },
    ])
      expect(
        PresentationVisualImportPageSchema.safeParse(invalid).success,
        JSON.stringify({
          width: invalid.width,
          height: invalid.height,
          textLength: invalid.extractedText.length,
        }),
      ).toBe(false);
    const now = new Date().toISOString();
    const job = {
      id: randomUUID(),
      presentationId: randomUUID(),
      status: "ready",
      attempts: 1,
      sourceType: "pdf",
      sourceName: "Source",
      sourceDigest: "a".repeat(64),
      fileCount: 1,
      pageCount: 2,
      pages: [page, { ...page, pageNumber: 2 }],
      warnings: [],
      error: null,
      retainOriginal: false,
      createdAt: now,
      updatedAt: now,
      expiresAt: now,
    };
    expect(PresentationVisualImportJobSchema.safeParse(job).success).toBe(false);
    const pages = Array.from({ length: 40 }, (_, index) => ({
      ...page,
      pageNumber: index + 1,
      mediaId: randomUUID(),
    }));
    expect(
      PresentationVisualImportJobSchema.safeParse({ ...job, pageCount: 40, pages }).success,
    ).toBe(false);
  });
  it("keeps visual conversion separate and requires bounded PDF or image sets with no original retention", () => {
    const input = { requestId: randomUUID(), files: [file()] };
    expect(CreatePresentationVisualImportSchema.parse(input).retainOriginal).toBe(false);
    for (const change of [
      { retainOriginal: true },
      { files: [] },
      { files: Array.from({ length: 41 }, () => file()) },
      { files: [file("application/pdf"), file()] },
      { files: [file("image/svg+xml")] },
      { files: [{ ...file(), base64: "not base64!" }] },
      { files: [{ ...file(), base64: "AAA" }] },
    ])
      expect(CreatePresentationVisualImportSchema.safeParse({ ...input, ...change }).success).toBe(
        false,
      );
    expect(
      CreatePresentationVisualImportSchema.safeParse({
        ...input,
        files: [
          file("application/pdf", Buffer.alloc(PRESENTATION_VISUAL_IMPORT_MAX_PDF_BYTES + 1)),
        ],
      }).success,
    ).toBe(false);
    expect(
      CreatePresentationVisualImportSchema.safeParse({
        ...input,
        files: [file("application/pdf", Buffer.alloc(PRESENTATION_VISUAL_IMPORT_MAX_PDF_BYTES))],
      }).success,
    ).toBe(true);
  });
  it("requires explicit fidelity and reading-order review while retaining selected page order", () => {
    const page = {
      pageNumber: 2,
      title: "Reviewed page",
      alternativeText: "A source diagram",
      accessibleText: "Author-reviewed reading order and meaning",
      readingOrderReviewed: true,
    };
    const input = {
      expectedRevision: 3,
      mutationId: randomUUID(),
      fidelityAccepted: true,
      pages: [page, { ...page, pageNumber: 1 }],
    };
    expect(
      InsertPresentationVisualImportSchema.parse(input).pages.map((page) => page.pageNumber),
    ).toEqual([2, 1]);
    for (const change of [
      { fidelityAccepted: false },
      { pages: [page, page] },
      { pages: [{ ...page, readingOrderReviewed: false }] },
      { pages: [{ ...page, accessibleText: " " }] },
      { pages: [{ ...page, accessibleText: "x".repeat(3001) }] },
      { pages: [{ ...page, alternativeText: "x".repeat(301) }] },
    ])
      expect(InsertPresentationVisualImportSchema.safeParse({ ...input, ...change }).success).toBe(
        false,
      );
  });
  it("public job views cannot carry private files or arbitrary object paths", () => {
    const now = new Date().toISOString();
    const job = {
      id: randomUUID(),
      presentationId: randomUUID(),
      status: "pending",
      attempts: 0,
      sourceType: "image_set",
      sourceName: "Source",
      sourceDigest: "a".repeat(64),
      fileCount: 1,
      pageCount: 0,
      pages: [],
      warnings: [],
      error: null,
      retainOriginal: false,
      createdAt: now,
      updatedAt: now,
      expiresAt: now,
    };
    expect(PresentationVisualImportJobSchema.safeParse(job).success).toBe(true);
    for (const privateField of [
      { files: [file()] },
      { inputFiles: [file()] },
      { objectKey: "quarantine/private" },
      { leaseToken: randomUUID() },
    ])
      expect(PresentationVisualImportJobSchema.safeParse({ ...job, ...privateField }).success).toBe(
        false,
      );
    expect(PresentationVisualImportJobSchema.safeParse({ ...job, status: "ready" }).success).toBe(
      false,
    );
  });
});
