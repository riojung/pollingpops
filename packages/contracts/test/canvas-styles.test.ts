import { describe, expect, it } from "vitest";
import {
  CANVAS_SCHEMA_VERSION,
  CANVAS_FILL_COLORS,
  CANVAS_STROKE_COLORS,
  CanvasBoardCreateSchema,
  CanvasBoardCreateV3Schema,
  CanvasBoardMutationSchema,
  CanvasBoardMutationV3Schema,
  CanvasBoardViewSchema,
  CanvasBoardViewV3Schema,
  CanvasObjectCreateSchema,
  CanvasObjectCreateV3Schema,
  CanvasObjectV3Schema,
  CanvasObjectPatchSchema,
  CanvasShapeVariantSchema,
  CanvasColorSchema,
  CanvasVersionViewSchema,
  CanvasVersionViewV2Schema,
} from "../src/index.js";

const id = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
const node = { id: id(1), type: "rect", x: 10, y: 20, width: 220, height: 140, text: "Cafe\u0301" };
const creation = {
  schemaVersion: 3,
  workspaceId: id(2),
  title: " Legacy canvas ",
  boardType: "team",
  operationId: id(3),
  templateId: "flow-to-action",
};

describe("Canvas V4 bounded manual styles", () => {
  it("keeps genuine V3 creates and mutation normalization frozen for exact retries", () => {
    expect(CANVAS_SCHEMA_VERSION).toBe(4);
    expect(CanvasBoardCreateSchema.parse(creation)).toEqual(
      CanvasBoardCreateV3Schema.parse(creation),
    );
    const mutation = {
      schemaVersion: 3,
      operationId: id(4),
      command: { type: "batch", operations: [{ type: "create", object: node }] },
    };
    const parsed = CanvasBoardMutationSchema.parse(mutation);
    expect(parsed).toEqual(CanvasBoardMutationV3Schema.parse(mutation));
    expect(JSON.stringify(parsed)).not.toMatch(
      /fontSize|fontFamily|strokeWidth|opacity|shapeVariant/,
    );
    for (const field of [{ fontSize: 24 }, { shapeVariant: "star" }, { color: "mint" }])
      expect(
        CanvasBoardMutationSchema.safeParse({
          ...mutation,
          command: {
            type: "batch",
            operations: [{ type: "create", object: { ...node, ...field } }],
          },
        }).success,
      ).toBe(false);
    expect(CanvasObjectCreateV3Schema.safeParse({ ...node, opacity: 0.5 }).success).toBe(false);
    expect(CanvasBoardMutationSchema.safeParse({ ...mutation, schemaVersion: 4 }).success).toBe(
      true,
    );
  });

  it("uses closed palettes, explicit rect variants, bounded typography and stroke defaults", () => {
    expect(CanvasColorSchema.options).toHaveLength(16);
    for (const color of CanvasColorSchema.options) {
      expect(CANVAS_FILL_COLORS[color]).toMatch(/^#[0-9a-f]{6}$/);
      expect(CANVAS_STROKE_COLORS[color]).toMatch(/^#[0-9a-f]{6}$/);
    }
    const current = CanvasObjectCreateSchema.parse(node);
    expect(current).toMatchObject({
      shapeVariant: "rectangle",
      fontSize: 16,
      fontFamily: "sans",
      fontWeight: "normal",
      fontStyle: "normal",
      textDecoration: "none",
      textAlign: "left",
      strokeWidth: 2,
      opacity: 1,
    });
    for (const shapeVariant of CanvasShapeVariantSchema.options)
      expect(CanvasObjectCreateSchema.safeParse({ ...node, shapeVariant }).success).toBe(true);
    const pen = CanvasObjectCreateSchema.parse({
      ...node,
      type: "pen",
      points: [
        [10, 20],
        [30, 40],
      ],
    });
    expect(pen.strokeWidth).toBe(3);
    expect(
      CanvasObjectCreateSchema.safeParse({ ...node, type: "ellipse", shapeVariant: "star" })
        .success,
    ).toBe(false);
    expect(
      CanvasObjectCreateSchema.safeParse({
        ...node,
        type: "pen",
        shapeVariant: "star",
        points: [
          [10, 20],
          [30, 40],
        ],
      }).success,
    ).toBe(false);
    for (const invalid of [
      { fontSize: 9 },
      { fontSize: 97 },
      { fontSize: Infinity },
      { strokeWidth: 0 },
      { strokeWidth: 25 },
      { opacity: 0 },
      { opacity: 1.01 },
      { fontFamily: "url(https://example.test)" },
      { fontWeight: "900" },
      { fontStyle: "oblique" },
      { textAlign: "justify" },
      { textDecoration: "line-through" },
      { shapeVariant: "<path/>" },
      { color: "#fff" },
      { style: "background:url(https://example.test)" },
    ]) {
      expect(CanvasObjectCreateSchema.safeParse({ ...node, ...invalid }).success).toBe(false);
      expect(CanvasObjectPatchSchema.safeParse(invalid).success).toBe(false);
    }
    expect(CanvasObjectPatchSchema.parse({ type: "ellipse", fontSize: 24, opacity: 0.5 })).toEqual({
      type: "ellipse",
      fontSize: 24,
      opacity: 0.5,
    });
    for (const type of ["image", "idea_ref", "pen", "connector", "frame", "link"])
      expect(CanvasObjectPatchSchema.safeParse({ type }).success).toBe(false);
  });

  it("upcasts V3 views and V2 checkpoints deterministically without changing their originals", () => {
    const old = CanvasObjectV3Schema.parse({ ...node, version: 7 });
    const createdAt = "2026-11-01T00:00:00.000Z";
    const legacy = CanvasBoardViewV3Schema.parse({
      schemaVersion: 3,
      id: id(5),
      workspaceId: id(2),
      organizationId: id(6),
      ownerUserId: id(7),
      title: "Legacy board",
      boardType: "team",
      sourceBoardId: null,
      status: "active",
      canvasSeq: 8,
      createdAt,
      updatedAt: createdAt,
      expiresAt: "2027-11-01T00:00:00.000Z",
      role: "owner",
      capabilities: { edit: true, facilitate: true, share: true, delete: true, archive: true },
      objects: [old],
      grants: [],
      invitations: [],
      undoOperationId: null,
      redoOperationId: null,
    });
    const original = structuredClone(legacy);
    const current = CanvasBoardViewSchema.parse(legacy);
    expect(current).toMatchObject({
      schemaVersion: 4,
      objects: [{ id: node.id, version: 7, shapeVariant: "rectangle", fontSize: 16, opacity: 1 }],
    });
    expect(CanvasBoardViewSchema.parse(current)).toEqual(current);
    expect(legacy).toEqual(original);
    expect(CanvasBoardViewV3Schema.safeParse(current).success).toBe(false);
    const checkpoint = CanvasVersionViewV2Schema.parse({
      schemaVersion: 2,
      boardId: legacy.id,
      version: {
        id: id(8),
        name: "Original scene",
        canvasSeq: 8,
        createdAt,
        createdBy: id(7),
        version: 1,
        objectCount: 1,
      },
      objects: [old],
    });
    const saved = CanvasVersionViewSchema.parse(checkpoint);
    expect(saved).toMatchObject({
      schemaVersion: 3,
      objects: [{ version: 7, shapeVariant: "rectangle", strokeWidth: 2 }],
    });
    expect(checkpoint.objects[0]).not.toHaveProperty("shapeVariant");
    expect(CanvasVersionViewV2Schema.safeParse(saved).success).toBe(false);
  });
});
