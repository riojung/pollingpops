import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import {
  PresentationStaticExportRequestSchema,
  PresentationStaticExportSourceSchema,
} from "../src/index.js";
describe("published Presentation static export requests", () => {
  it("requires exactly one published page for PNG and complete decks for PDF/HTML", () => {
    const versionId = randomUUID(),
      blockId = randomUUID();
    expect(
      PresentationStaticExportRequestSchema.parse({
        versionId: versionId.toUpperCase(),
        format: "png",
        blockId: blockId.toUpperCase(),
      }),
    ).toEqual({ versionId, format: "png", blockId });
    for (const format of ["pdf", "html"]) {
      expect(PresentationStaticExportRequestSchema.safeParse({ versionId, format }).success).toBe(
        true,
      );
      expect(
        PresentationStaticExportRequestSchema.safeParse({ versionId, format, blockId }).success,
      ).toBe(false);
    }
    for (const input of [
      { versionId, format: "png" },
      { versionId, format: "pptx" },
      { versionId, format: "pdf", speakerNotes: true },
      { format: "pdf" },
    ])
      expect(PresentationStaticExportRequestSchema.safeParse(input).success).toBe(false);
  });
  it("keeps page-picker metadata strict and excludes draft or answer fields", () => {
    const source = {
      versionId: randomUUID(),
      version: 1,
      title: "Published",
      pages: [{ blockId: randomUUID(), title: "First" }],
    };
    expect(PresentationStaticExportSourceSchema.parse(source)).toEqual(source);
    expect(PresentationStaticExportSourceSchema.safeParse({ ...source, draft: {} }).success).toBe(
      false,
    );
    expect(
      PresentationStaticExportSourceSchema.safeParse({
        ...source,
        pages: [{ ...source.pages[0], correctValue: "private" }],
      }).success,
    ).toBe(false);
  });

  it("accepts offline HTML only as a strict whole-deck request with a canonical published version identity", () => {
    const versionId = "abcdef12-3456-4789-8abc-def012345678";
    expect(
      PresentationStaticExportRequestSchema.parse({
        versionId: versionId.toUpperCase(),
        format: "offline_html",
      }),
    ).toEqual({ versionId, format: "offline_html" });
    for (const input of [
      { versionId, format: "offline_html", blockId: randomUUID() },
      { versionId, format: "offline_html", blockId: null },
      { versionId, format: "offline_html", speakerNotes: true },
      { versionId, format: "offline_html", includeAnswers: true },
      { versionId, format: "offline-html" },
      { versionId, format: "OFFLINE_HTML" },
      { versionId, format: "interactive_html" },
    ])
      expect(PresentationStaticExportRequestSchema.safeParse(input).success).toBe(false);
    const result = PresentationStaticExportRequestSchema.safeParse({
      versionId,
      format: "offline_html",
      blockId: randomUUID(),
    });
    if (result.success) throw new Error("Expected whole-deck-only validation");
    expect(result.error.issues).toContainEqual(
      expect.objectContaining({
        path: ["blockId"],
        message: expect.stringContaining("offline HTML"),
      }),
    );
  });

  it("retains the canonical request bytes and page-selection behavior of existing PDF, PNG and readable HTML", () => {
    const versionId = "abcdef12-3456-4789-8abc-def012345678",
      blockId = "fedcba98-7654-4321-8fed-cba987654321";
    for (const format of ["pdf", "png", "html"] as const) {
      const input = {
        versionId: versionId.toUpperCase(),
        format,
        ...(format === "png" ? { blockId: blockId.toUpperCase() } : {}),
      };
      const expected = { versionId, format, ...(format === "png" ? { blockId } : {}) };
      expect(JSON.stringify(PresentationStaticExportRequestSchema.parse(input))).toBe(
        JSON.stringify(expected),
      );
      expect(
        PresentationStaticExportRequestSchema.safeParse({ versionId, format, blockId }).success,
      ).toBe(format === "png");
      expect(PresentationStaticExportRequestSchema.safeParse({ versionId, format }).success).toBe(
        format !== "png",
      );
    }
  });
});
