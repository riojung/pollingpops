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
});
