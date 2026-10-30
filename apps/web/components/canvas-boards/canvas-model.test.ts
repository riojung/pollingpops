import { describe, expect, it } from "vitest";
import { CanvasObjectSchema } from "@openround/contracts";
import {
  canvasObjectLabel,
  canChangeObject,
  canPublishCanvasObject,
  duplicateCanvasObject,
  moveCanvasPatch,
  nextCanvasPosition,
  reviewedCanvasCommand,
} from "./canvas-model";
import { canvasBoard, canvasObject } from "./canvas-test-fixtures";

describe("canvas draft and object permissions", () => {
  it("identifies creator images by their description instead of an empty text field or generic index", () => {
    const altText = "Workshop diagram showing our three priorities";
    const image = CanvasObjectSchema.parse({
      ...canvasObject,
      type: "image",
      text: "",
      mediaId: "00000000-0000-4000-8000-000000000099",
      altText,
    });
    expect(canvasObjectLabel(image, "Image 2")).toBe(altText);
    expect(canvasObjectLabel({ ...canvasObject, text: "" }, "Sticky note 3")).toBe("Sticky note 3");
  });
  it("does not treat large frame backdrops as occupied insertion space", () => {
    const frame = CanvasObjectSchema.parse({
      ...canvasObject,
      type: "frame",
      x: -500,
      y: -500,
      width: 3000,
      height: 3000,
    });
    expect(nextCanvasPosition([frame], { x: 120.5, y: 57.5 }, 320, 220)).toEqual({
      x: 120.5,
      y: 57.5,
    });
  });
  it("only lets workshop facilitators publish ordinary objects and protects published objects from editors", () => {
    const workshop = { ...canvasBoard, boardType: "workshop" as const };
    expect(canPublishCanvasObject(canvasBoard, canvasObject)).toBe(false);
    expect(canPublishCanvasObject(workshop, canvasObject)).toBe(true);
    const editor = { ...workshop, capabilities: { ...workshop.capabilities, facilitate: false } };
    expect(canPublishCanvasObject(editor, canvasObject)).toBe(false);
    expect(canChangeObject(editor, { ...canvasObject, visibility: "published" })).toBe(false);
    expect(canChangeObject(editor, canvasObject)).toBe(true);
    const frame = CanvasObjectSchema.parse({ ...canvasObject, type: "frame" });
    expect(canPublishCanvasObject(workshop, frame)).toBe(true);
    const idea = CanvasObjectSchema.parse({
      ...canvasObject,
      type: "idea_ref",
      text: "",
      ideaId: "00000000-0000-4000-8000-000000000096",
    });
    expect(canPublishCanvasObject(workshop, idea)).toBe(false);
  });
  it("places a new note next to existing content without covering it", () => {
    expect(nextCanvasPosition([canvasObject], { x: 20, y: 30 })).toEqual({ x: 264, y: 30 });
    expect(nextCanvasPosition([], { x: 20, y: 30 })).toEqual({ x: 20, y: 30 });
  });
  it("requires facilitation for protected ideas and never duplicates their guest content", () => {
    const idea = CanvasObjectSchema.parse({
      ...canvasObject,
      type: "idea_ref",
      ideaId: "00000000-0000-4000-8000-000000000096",
      text: "",
    });
    expect(
      canChangeObject(
        { ...canvasBoard, capabilities: { ...canvasBoard.capabilities, facilitate: false } },
        idea,
      ),
    ).toBe(false);
    expect(canChangeObject(canvasBoard, idea)).toBe(true);
    expect(duplicateCanvasObject(idea)).toBeNull();
    expect(canChangeObject(canvasBoard, { ...canvasObject, locked: true })).toBe(false);
  });
  it("only rebases reviewed commands against an existing editable object", () => {
    const command = {
      type: "batch" as const,
      operations: [
        {
          type: "update" as const,
          id: canvasObject.id,
          expectedVersion: 1,
          patch: { text: "Kept local draft" },
        },
      ],
    };
    const changed = {
      ...canvasBoard,
      objects: [
        CanvasObjectSchema.parse({ ...canvasObject, version: 4, text: "Another editor's text" }),
      ],
    };
    expect(command.operations[0]!.expectedVersion).toBe(1);
    expect(reviewedCanvasCommand(changed, command)?.operations[0]).toEqual({
      ...command.operations[0],
      expectedVersion: 4,
    });
    expect(reviewedCanvasCommand({ ...changed, objects: [] }, command)).toBeNull();
    expect(
      reviewedCanvasCommand(
        { ...changed, capabilities: { ...changed.capabilities, edit: false } },
        command,
      ),
    ).toBeNull();
    expect(
      reviewedCanvasCommand(changed, {
        type: "batch",
        operations: [{ type: "create", object: duplicateCanvasObject(canvasObject)! }],
      }),
    ).toBeNull();
  });
  it("duplicates normalized content with a new identity and translates freehand points", () => {
    const pen = CanvasObjectSchema.parse({
      ...canvasObject,
      type: "pen",
      points: [
        [20, 30],
        [50, 60],
      ],
    });
    const copy = duplicateCanvasObject(pen)!;
    expect(copy.id).not.toBe(pen.id);
    expect(copy).not.toHaveProperty("version");
    expect(copy).toMatchObject({
      x: 48,
      y: 58,
      points: [
        [48, 58],
        [78, 88],
      ],
    });
    expect(moveCanvasPatch(pen, 10, -5)).toMatchObject({
      x: 30,
      y: 25,
      points: [
        [30, 25],
        [60, 55],
      ],
    });
  });
});
