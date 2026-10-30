import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  CanvasBoardCreateSchema,
  CanvasBoardMutationSchema,
  CanvasObjectCreateSchema,
  CanvasObjectSchema,
  CanvasObjectPatchSchema,
} from "../src/index.js";
const object = () => ({
  id: randomUUID(),
  type: "sticky",
  x: 0,
  y: 0,
  width: 240,
  height: 160,
  text: "A manually written idea",
});
describe("typed canvas contracts", () => {
  it("keeps sparse patches sparse so arranging an idea never changes its publication or style", () => {
    expect(CanvasObjectPatchSchema.parse({ x: 25 })).toEqual({ x: 25 });
  });
  it("separates immutable team and workshop source identities", () => {
    const base = { workspaceId: randomUUID(), title: "A board", operationId: randomUUID() };
    expect(CanvasBoardCreateSchema.parse({ ...base, boardType: "team" })).toMatchObject({
      schemaVersion: 1,
      boardType: "team",
    });
    expect(CanvasBoardCreateSchema.safeParse({ ...base, boardType: "workshop" }).success).toBe(
      false,
    );
    expect(
      CanvasBoardCreateSchema.safeParse({ ...base, boardType: "team", sourceBoardId: randomUUID() })
        .success,
    ).toBe(false);
    expect(
      CanvasBoardCreateSchema.safeParse({
        ...base,
        boardType: "workshop",
        sourceBoardId: randomUUID(),
      }).success,
    ).toBe(true);
  });
  it("bounds finite geometry, text, typed shapes and server-managed versions", () => {
    for (const field of ["x", "y", "width", "height", "rotation"])
      for (const value of [Infinity, NaN, -Infinity])
        expect(CanvasObjectCreateSchema.safeParse({ ...object(), [field]: value }).success).toBe(
          false,
        );
    expect(CanvasObjectCreateSchema.safeParse({ ...object(), x: 100001 }).success).toBe(false);
    expect(CanvasObjectCreateSchema.safeParse({ ...object(), width: 0 }).success).toBe(false);
    expect(
      CanvasObjectCreateSchema.safeParse({ ...object(), text: "x".repeat(2001) }).success,
    ).toBe(false);
    expect(CanvasObjectCreateSchema.safeParse({ ...object(), version: 999 }).success).toBe(false);
    expect(
      CanvasObjectCreateSchema.safeParse({ ...object(), html: "<svg onload=alert(1)>" }).success,
    ).toBe(false);
    expect(CanvasObjectSchema.parse({ ...object(), version: 1 })).toMatchObject({
      visibility: "team",
      parentId: null,
      locked: false,
    });
    expect(
      CanvasObjectSchema.safeParse({ ...object(), version: 1, unknown: "value" }).success,
    ).toBe(false);
    expect(
      CanvasObjectCreateSchema.safeParse({
        ...object(),
        type: "idea_ref",
        ideaId: randomUUID(),
        text: "Silently rewritten guest text",
      }).success,
    ).toBe(false);
  });
  it("rejects credential-bearing links, excessive batches and large serialized payloads", () => {
    expect(
      CanvasObjectCreateSchema.safeParse({
        ...object(),
        type: "link",
        url: "https://user:password@example.com",
      }).success,
    ).toBe(false);
    expect(
      CanvasObjectCreateSchema.safeParse({ ...object(), type: "link", url: "javascript:alert(1)" })
        .success,
    ).toBe(false);
    expect(
      CanvasObjectCreateSchema.safeParse({
        ...object(),
        type: "link",
        url: "https://example.com/path",
      }).success,
    ).toBe(true);
    const base = { schemaVersion: 1, operationId: randomUUID() };
    expect(
      CanvasBoardMutationSchema.safeParse({
        ...base,
        command: {
          type: "batch",
          operations: Array.from({ length: 51 }, () => ({ type: "create", object: object() })),
        },
      }).success,
    ).toBe(false);
    expect(
      CanvasBoardMutationSchema.safeParse({
        ...base,
        command: {
          type: "batch",
          operations: Array.from({ length: 40 }, () => ({
            type: "create",
            object: { ...object(), text: "語".repeat(2000) },
          })),
        },
      }).success,
    ).toBe(false);
    expect(
      CanvasBoardMutationSchema.safeParse({
        ...base,
        command: {
          type: "batch",
          operations: [
            {
              type: "update",
              id: randomUUID(),
              expectedVersion: 1,
              patch: { ideaId: randomUUID() },
            },
          ],
        },
      }).success,
    ).toBe(false);
  });
});
