import { describe, expect, it } from "vitest";
import { CanvasObjectSchema } from "@openround/contracts";
import { canvasObject, canvasBoard } from "./canvas-test-fixtures";
import { canvasObjectDraft } from "./canvas-draft";
import { canvasConnectorDraftPatch, changeCanvasEndpoint } from "./canvas-diagram-model";
import { planCanvasLayer } from "./canvas-productivity";
import { duplicateCanvasObject } from "./canvas-model";
const id = (number: number) => `00000000-0000-4000-8000-${String(number).padStart(12, "0")}`;
const connector = CanvasObjectSchema.parse({
  ...canvasObject,
  type: "connector",
  from: { objectId: null, x: 10, y: 20 },
  to: { objectId: null, x: 300, y: 200 },
});
describe("manual diagram proposals", () => {
  it("saves detached endpoints and styles without overwriting them with old coordinates or metadata", () => {
    if (connector.type !== "connector") throw new Error("Fixture");
    const draft = {
      ...canvasObjectDraft(connector),
      text: "確認 → 次へ",
      fromX: -20.5,
      toY: 350.25,
      routing: "elbow" as const,
      lineStyle: "dashed" as const,
      startMarker: "arrow" as const,
      lineColor: "blue" as const,
    };
    const result = canvasConnectorDraftPatch(connector, draft);
    expect(result.success).toBe(true);
    if (!result.success) throw new Error("Invalid proposal");
    expect(result.data).toMatchObject({
      text: draft.text,
      from: { objectId: null, x: -20.5, y: 20 },
      to: { x: 300, y: 350.25 },
      routing: "elbow",
      lineStyle: "dashed",
      startMarker: "arrow",
      lineColor: "blue",
    });
    for (const field of ["x", "y", "width", "height", "visibility", "parentId"])
      expect(result.data).not.toHaveProperty(field);
    expect(canvasConnectorDraftPatch(connector, { ...draft, fromX: Infinity }).success).toBe(false);
  });
  it("detaches at the current rotated port rather than a stale fallback and offsets copied free endpoints", () => {
    if (connector.type !== "connector") throw new Error("Fixture");
    const node = CanvasObjectSchema.parse({
      ...canvasObject,
      id: id(1),
      type: "parallelogram",
      x: 10,
      y: 20,
      width: 200,
      height: 100,
      rotation: 90,
    });
    const attached = {
      ...connector,
      from: { ...connector.from, objectId: node.id, anchor: "left" as const, x: -999, y: -999 },
    };
    const draft = changeCanvasEndpoint(attached, canvasObjectDraft(attached), "from", "", [
      node,
      attached,
    ]);
    expect(draft.fromId).toBe("");
    expect(draft.fromX).toBeCloseTo(110);
    expect(draft.fromY).toBeCloseTo(-10);
    expect(duplicateCanvasObject(connector)).toMatchObject({
      from: { x: 38, y: 48 },
      to: { x: 328, y: 228 },
      routing: "straight",
      lineColor: "neutral",
    });
  });
  it("changes selected layer order atomically while preserving internal order, locks and budget", () => {
    const a = CanvasObjectSchema.parse({
      ...canvasObject,
      id: id(1),
      zIndex: -1,
      geometricGroupId: id(99),
    });
    const b = CanvasObjectSchema.parse({
      ...canvasObject,
      id: id(2),
      zIndex: 0,
      geometricGroupId: id(99),
    });
    const other = CanvasObjectSchema.parse({ ...canvasObject, id: id(3), zIndex: 10 });
    const result = planCanvasLayer({ ...canvasBoard, objects: [a, b, other] }, [a.id], "front");
    expect(result.command?.operations).toEqual([
      { type: "update", id: a.id, expectedVersion: 1, patch: { zIndex: 11 } },
      { type: "update", id: b.id, expectedVersion: 1, patch: { zIndex: 12 } },
    ]);
    expect(
      planCanvasLayer(
        { ...canvasBoard, objects: [{ ...a, locked: true }, b, other] },
        [a.id],
        "front",
      ).reason,
    ).toBe("locked");
    expect(
      planCanvasLayer(
        { ...canvasBoard, objects: [a, b, { ...other, zIndex: 10000 }] },
        [a.id],
        "front",
      ).reason,
    ).toBe("bounds");
    const many = Array.from({ length: 51 }, (_, index) =>
      CanvasObjectSchema.parse({ ...a, id: id(index + 200) }),
    );
    expect(
      planCanvasLayer({ ...canvasBoard, objects: [...many, other] }, [many[0]!.id], "front").reason,
    ).toBe("limit");
  });
});
