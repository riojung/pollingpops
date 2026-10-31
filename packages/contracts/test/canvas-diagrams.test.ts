import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  CANVAS_SCHEMA_VERSION,
  CanvasBoardCreateV2Schema,
  CanvasBoardMutationSchema,
  CanvasBoardMutationV1Schema,
  CanvasBoardMutationV2Schema,
  CanvasBoardViewSchema,
  CanvasBoardViewV2Schema,
  CanvasObjectCreateSchema,
  CanvasObjectV2Schema,
  CanvasVersionViewSchema,
} from "../src/index.js";

const id = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
const connector = {
  id: id(2),
  type: "connector",
  x: 10,
  y: 20,
  width: 100,
  height: 50,
  text: " Cafe\u0301 ",
  from: { objectId: null, x: 1, y: 2 },
  to: { objectId: null, x: 101, y: 52 },
};
const request = (schemaVersion: number, object = connector) => ({
  schemaVersion,
  operationId: id(1),
  command: { type: "batch", operations: [{ type: "create", object }] },
});

describe("Canvas V3 manual diagrams and frozen requests", () => {
  it("retains exact V1/V2 normalized requests without new connector defaults", () => {
    const fingerprints = [
      "257c2e4c0b5d33c332307c5b5d2af461b0131867699f87fb657f04f4ee132fac",
      "260814ddf81b9f9823cc0d1d78541f3c2739752c91bbbfefe77ccaf95434cf1b",
    ];
    for (const [index, schema] of [
      CanvasBoardMutationV1Schema,
      CanvasBoardMutationV2Schema,
    ].entries()) {
      const input = request(index + 1);
      const parsed = CanvasBoardMutationSchema.parse(input);
      expect(parsed).toEqual(schema.parse(input));
      expect(createHash("sha256").update(JSON.stringify(parsed)).digest("hex")).toBe(
        fingerprints[index],
      );
      expect(JSON.stringify(parsed)).not.toMatch(
        /routing|lineStyle|startMarker|endMarker|lineColor/,
      );
      expect(input.command.operations[0]!.object.text).toBe(" Cafe\u0301 ");
    }
  });

  it("requires V3 for diagram shapes and styles while retaining explicit bounds", () => {
    expect(CANVAS_SCHEMA_VERSION).toBe(3);
    const styled = {
      ...connector,
      routing: "elbow",
      lineStyle: "dashed",
      startMarker: "arrow",
      endMarker: "none",
      lineColor: "blue",
    };
    expect(CanvasBoardMutationSchema.safeParse(request(2, styled)).success).toBe(false);
    expect(CanvasBoardMutationSchema.safeParse(request(3, styled)).success).toBe(true);
    for (const type of ["diamond", "parallelogram"] as const) {
      const object = { id: id(3), type, x: 0, y: 0, width: 220, height: 140, text: "Manual node" };
      const envelope = {
        ...request(3),
        command: { type: "batch", operations: [{ type: "create", object }] },
      };
      expect(CanvasBoardMutationSchema.safeParse(envelope).success).toBe(true);
      expect(CanvasBoardMutationSchema.safeParse({ ...envelope, schemaVersion: 2 }).success).toBe(
        false,
      );
      expect(CanvasObjectCreateSchema.safeParse({ ...object, width: 10001 }).success).toBe(false);
    }
    for (const patch of [
      { routing: "script" },
      { lineColor: "url(https://example.test)" },
      { waypoints: [] },
      { startMarker: "external" },
    ])
      expect(CanvasObjectCreateSchema.safeParse({ ...styled, ...patch }).success).toBe(false);
    expect(
      CanvasBoardCreateV2Schema.safeParse({
        schemaVersion: 2,
        workspaceId: id(5),
        title: "New diagram",
        boardType: "team",
        operationId: id(6),
        templateId: "manual-flowchart",
      }).success,
    ).toBe(false);
  });

  it("upcasts V2 reads and saved scenes without changing old source objects", () => {
    const old = CanvasObjectV2Schema.parse({ ...connector, version: 1 });
    const createdAt = "2026-10-30T00:00:00.000Z";
    const legacy = CanvasBoardViewV2Schema.parse({
      schemaVersion: 2,
      id: id(7),
      workspaceId: id(8),
      organizationId: id(9),
      ownerUserId: id(10),
      title: "Existing flow",
      boardType: "team",
      sourceBoardId: null,
      status: "active",
      canvasSeq: 4,
      createdAt,
      updatedAt: createdAt,
      expiresAt: "2027-10-30T00:00:00.000Z",
      role: "owner",
      capabilities: { edit: true, facilitate: true, share: true, delete: true, archive: true },
      objects: [old],
      grants: [],
      invitations: [],
      undoOperationId: null,
      redoOperationId: null,
    });
    const current = CanvasBoardViewSchema.parse(legacy);
    expect(current.schemaVersion).toBe(3);
    expect(current.objects[0]).toMatchObject({
      routing: "straight",
      lineStyle: "solid",
      startMarker: "none",
      endMarker: "arrow",
      lineColor: "neutral",
    });
    expect(old).not.toHaveProperty("routing");
    expect(legacy.schemaVersion).toBe(2);
    const saved = CanvasVersionViewSchema.parse({
      schemaVersion: 1,
      boardId: legacy.id,
      version: {
        id: id(11),
        name: "Existing checkpoint",
        canvasSeq: 4,
        createdAt,
        createdBy: id(10),
        version: 1,
        objectCount: 1,
      },
      objects: [old],
    });
    expect(saved.schemaVersion).toBe(2);
    expect(saved.objects[0]).toMatchObject({ routing: "straight", lineColor: "neutral" });
  });
});
