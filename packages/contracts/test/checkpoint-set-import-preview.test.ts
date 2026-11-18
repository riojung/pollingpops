import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  CheckpointSetImportConfirmRequestSchema,
  CheckpointSetImportPreviewRequestSchema,
  CheckpointSetImportPreviewResponseSchema,
  CheckpointSetImportRequestSchema,
} from "../src/index.js";

const source = {
  format: "bulk",
  data: "Question\n* Complete check\n- Skip check",
  title: "  Import review  ",
};
const confirmation = () => ({
  ...source,
  previewFingerprint: "a".repeat(64),
  idempotencyKey: randomUUID(),
  creationContext: { actorId: randomUUID(), workspaceId: randomUUID() },
});

describe("structured import preview contracts", () => {
  it("preserves the legacy source contract and normalizes preview/confirmation identically", () => {
    const normalized = { ...source, title: "Import review", encoding: "text" };
    expect(CheckpointSetImportRequestSchema.parse(source)).toEqual(normalized);
    expect(CheckpointSetImportPreviewRequestSchema.parse(source)).toEqual(normalized);
    expect(CheckpointSetImportConfirmRequestSchema.parse(confirmation())).toMatchObject(normalized);
  });
  it("requires source and stable confirmation context and refuses a client draft", () => {
    const valid = confirmation();
    expect(CheckpointSetImportConfirmRequestSchema.safeParse(valid).success).toBe(true);
    for (const field of [
      "data",
      "format",
      "previewFingerprint",
      "idempotencyKey",
      "creationContext",
    ] as const) {
      const missing: Record<string, unknown> = { ...valid };
      delete missing[field];
      expect(CheckpointSetImportConfirmRequestSchema.safeParse(missing).success).toBe(false);
    }
    expect(
      CheckpointSetImportPreviewRequestSchema.safeParse({ ...source, draft: {} }).success,
    ).toBe(false);
    expect(CheckpointSetImportConfirmRequestSchema.safeParse({ ...valid, draft: {} }).success).toBe(
      false,
    );
    expect(
      CheckpointSetImportConfirmRequestSchema.safeParse({
        ...valid,
        creationContext: { ...valid.creationContext, unexpected: true },
      }).success,
    ).toBe(false);
    expect(
      CheckpointSetImportConfirmRequestSchema.safeParse({
        ...valid,
        previewFingerprint: "not a digest",
      }).success,
    ).toBe(false);
    expect(
      CheckpointSetImportPreviewRequestSchema.safeParse({ ...source, encoding: "base64" }).success,
    ).toBe(false);
    expect(
      CheckpointSetImportPreviewRequestSchema.safeParse({
        format: "qti3",
        data: "package",
        encoding: "text",
      }).success,
    ).toBe(false);
    expect(
      CheckpointSetImportConfirmRequestSchema.safeParse({
        ...valid,
        format: "qti3",
        encoding: "text",
      }).success,
    ).toBe(false);
  });
  it("requires the separate source digest and validation report on read-only previews", () => {
    const response = {
      draft: null,
      validation: {
        format: "bulk",
        importedCheckpoints: 0,
        errors: [
          { severity: "error", code: "INVALID_BULK_BLOCK", message: "Review the source", row: 1 },
        ],
        warnings: [],
      },
      sourceDigest: "a".repeat(64),
      previewFingerprint: "b".repeat(64),
      creationContext: confirmation().creationContext,
    };
    expect(CheckpointSetImportPreviewResponseSchema.safeParse(response).success).toBe(true);
    const { sourceDigest: _sourceDigest, ...missing } = response;
    void _sourceDigest;
    expect(CheckpointSetImportPreviewResponseSchema.safeParse(missing).success).toBe(false);
    expect(
      CheckpointSetImportPreviewResponseSchema.safeParse({
        ...response,
        sourceDigest: "not a digest",
      }).success,
    ).toBe(false);
  });
});
