import { describe, expect, it } from "vitest";
import {
  PresentationSceneSchema,
  type PresentationScene,
  type PresentationSceneFrame,
} from "@openround/contracts";
import {
  moveNativeSceneNodes,
  removeNativeSceneNodes,
  resizeNativeSceneNode,
  resizeNativeSceneSelection,
  selectedNativeSceneBounds,
  type NativeSceneResizeHandle,
} from "./presentation-native-geometry";

function fixture(): PresentationScene {
  return {
    schemaVersion: 1,
    aspectRatio: "16:9",
    nodes: [
      {
        id: "title",
        type: "text",
        role: "title",
        text: "Product proposal",
        frame: { x: 8, y: 8, width: 84, height: 20 },
      },
      {
        id: "body",
        type: "text",
        role: "body",
        text: "Current workflow",
        frame: { x: 10, y: 35, width: 25, height: 20 },
      },
      {
        id: "shape",
        type: "shape",
        shape: "diamond",
        color: "blue",
        label: "Decision",
        frame: { x: 60, y: 45, width: 25, height: 30 },
      },
      {
        id: "image",
        type: "image",
        mediaId: "11111111-1111-4111-8111-111111111111",
        altText: "Product screenshot",
        frame: { x: 10, y: 75, width: 25, height: 20 },
      },
      {
        id: "edge",
        type: "connector",
        from: { nodeId: "body", anchor: "right" },
        to: { nodeId: "shape", anchor: "left" },
        label: "Next step",
        color: "blue",
      },
      {
        id: "title-edge",
        type: "connector",
        from: { nodeId: "title", anchor: "bottom" },
        to: { nodeId: "image", anchor: "top" },
        label: "Illustration",
        color: "black",
      },
    ],
    readingOrder: ["title", "body", "shape", "edge", "image", "title-edge"],
  };
}

function frame(scene: PresentationScene, id: string): PresentationSceneFrame {
  const node = scene.nodes.find((item) => item.id === id);
  if (!node || node.type === "connector") throw new Error(`Missing framed fixture node ${id}`);
  return node.frame;
}

describe("native selection geometry", () => {
  it("moves text, shapes and images together without changing scene references or metadata", () => {
    const scene = fixture();
    const before = structuredClone(scene);
    const result = moveNativeSceneNodes(scene, ["body", "shape", "image", "edge"], 4, -3);
    expect(frame(result, "body")).toEqual({ x: 14, y: 32, width: 25, height: 20 });
    expect(frame(result, "shape")).toEqual({ x: 64, y: 42, width: 25, height: 30 });
    expect(frame(result, "image")).toEqual({ x: 14, y: 72, width: 25, height: 20 });
    expect(result.readingOrder).toBe(scene.readingOrder);
    expect(result.nodes[0]).toBe(scene.nodes[0]);
    expect(result.nodes[4]).toBe(scene.nodes[4]);
    expect(result.nodes[3]).toMatchObject({
      id: "image",
      mediaId: "11111111-1111-4111-8111-111111111111",
      altText: "Product screenshot",
    });
    expect(PresentationSceneSchema.parse(result)).toEqual(result);
    expect(scene).toEqual(before);
  });

  it.each([
    [100, 100, 15, 25],
    [-100, -100, -10, -35],
    [100, -100, 15, -35],
    [-100, 100, -10, 25],
  ])("clamps a group requested at (%s, %s) by one translation", (dx, dy, actualX, actualY) => {
    const scene = fixture();
    const result = moveNativeSceneNodes(scene, ["body", "shape"], dx, dy);
    for (const id of ["body", "shape"]) {
      expect(frame(result, id).x - frame(scene, id).x).toBe(actualX);
      expect(frame(result, id).y - frame(scene, id).y).toBe(actualY);
    }
    expect(frame(result, "shape").x - frame(result, "body").x).toBe(50);
    expect(frame(result, "shape").y - frame(result, "body").y).toBe(10);
    expect(PresentationSceneSchema.safeParse(result).success).toBe(true);
  });

  it("ignores duplicate, missing and connector IDs and preserves identity when nothing moves", () => {
    const scene = fixture();
    expect(moveNativeSceneNodes(scene, ["edge", "missing"], 5, 5)).toBe(scene);
    expect(moveNativeSceneNodes(scene, [], 5, 5)).toBe(scene);
    expect(moveNativeSceneNodes(scene, ["body"], 0, 0)).toBe(scene);
    expect(moveNativeSceneNodes(scene, ["body"], Infinity, 5)).toBe(scene);
    expect(moveNativeSceneNodes(scene, ["body"], 5, NaN)).toBe(scene);
    expect(moveNativeSceneNodes(scene, ["body", "body"], 5, 5)).toEqual(
      moveNativeSceneNodes(scene, ["body"], 5, 5),
    );
    const atEdge = moveNativeSceneNodes(scene, ["body"], -100, -100);
    expect(moveNativeSceneNodes(atEdge, ["body"], -1, -1)).toBe(atEdge);
  });

  it("returns the visual selection bounds without treating connectors as rectangles", () => {
    const scene = fixture();
    expect(selectedNativeSceneBounds(scene, ["body", "shape", "edge", "body"])).toEqual({
      x: 10,
      y: 35,
      width: 75,
      height: 40,
    });
    expect(selectedNativeSceneBounds(scene, ["missing", "edge"])).toBeNull();
    expect(selectedNativeSceneBounds(scene, [])).toBeNull();
  });

  it("resizes only the requested node and holds its top-left corner fixed at either limit", () => {
    const scene = fixture();
    const enlarged = resizeNativeSceneNode(scene, "shape", 100, 100);
    expect(frame(enlarged, "shape")).toEqual({ x: 60, y: 45, width: 40, height: 55 });
    const shrunk = resizeNativeSceneNode(scene, "shape", -100, -100);
    expect(frame(shrunk, "shape")).toEqual({ x: 60, y: 45, width: 1, height: 1 });
    expect(enlarged.nodes[0]).toBe(scene.nodes[0]);
    expect(enlarged.nodes[4]).toBe(scene.nodes[4]);
    expect(enlarged.readingOrder).toBe(scene.readingOrder);
    expect(PresentationSceneSchema.safeParse(enlarged).success).toBe(true);
    expect(PresentationSceneSchema.safeParse(shrunk).success).toBe(true);
    expect(resizeNativeSceneNode(enlarged, "shape", 100, 100)).toBe(enlarged);
    expect(resizeNativeSceneNode(shrunk, "shape", -100, -100)).toBe(shrunk);
  });

  it("does not create history changes for missing nodes, connectors, zero or invalid resize input", () => {
    const scene = fixture();
    expect(resizeNativeSceneNode(scene, "missing", 5, 5)).toBe(scene);
    expect(resizeNativeSceneNode(scene, "edge", 5, 5)).toBe(scene);
    expect(resizeNativeSceneNode(scene, "body", 0, 0)).toBe(scene);
    expect(resizeNativeSceneNode(scene, "body", 5, -Infinity)).toBe(scene);
    expect(resizeNativeSceneNode(scene, "body", NaN, 5)).toBe(scene);
  });

  it("does not round a valid fractional edge inward during no-op or perpendicular edits", () => {
    const scene = fixture();
    const body = scene.nodes[1]!;
    const shape = scene.nodes[2]!;
    if (body.type === "connector" || shape.type === "connector") throw new Error("fixture");
    body.frame = { x: 30.654732332081387, y: 30, width: 69.34526766791862, height: 20 };
    shape.frame = { x: 83.82005837948, y: 45, width: 16.179941620520005, height: 30 };
    expect(PresentationSceneSchema.safeParse(scene).success).toBe(true);
    expect(resizeNativeSceneNode(scene, "shape", 100, 0)).toBe(scene);
    expect(resizeNativeSceneNode(scene, "shape", 0, 0)).toBe(scene);
    expect(frame(moveNativeSceneNodes(scene, ["body"], 0, 1), "body").x).toBe(body.frame.x);
    expect(frame(resizeNativeSceneNode(scene, "shape", 0, 1), "shape").width).toBe(
      shape.frame.width,
    );
  });

  it("keeps fractional pointer deltas within the real scene contract through repeated edge edits", () => {
    let scene = fixture();
    const body = scene.nodes[1]!;
    if (body.type === "connector") throw new Error("fixture");
    body.frame = { x: 0.1, y: 0.2, width: 33.333333333333336, height: 17.13579135791358 };
    const shape = scene.nodes[2]!;
    if (shape.type === "connector") throw new Error("fixture");
    shape.frame = { x: 62.123456789, y: 41.531246798, width: 23.123456789, height: 24.679813579 };
    for (let index = 0; index < 200; index += 1) {
      const dx = Math.sin(index * 3.7) * 110;
      const dy = Math.cos(index * 1.3) * 110;
      const separationX = frame(scene, "shape").x - frame(scene, "body").x;
      const separationY = frame(scene, "shape").y - frame(scene, "body").y;
      scene = moveNativeSceneNodes(scene, ["body", "shape"], dx, dy);
      expect(frame(scene, "shape").x - frame(scene, "body").x).toBeCloseTo(separationX, 10);
      expect(frame(scene, "shape").y - frame(scene, "body").y).toBeCloseTo(separationY, 10);
      expect(PresentationSceneSchema.safeParse(scene).success).toBe(true);
      scene = resizeNativeSceneNode(scene, "image", dx, dy);
      expect(PresentationSceneSchema.safeParse(scene).success).toBe(true);
    }
  });
});

describe("direct resize handles", () => {
  const handles: NativeSceneResizeHandle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
  it.each(handles)("anchors the opposite edge for %s in either pointer direction", (handle) => {
    const scene = fixture();
    const before = frame(scene, "body");
    const horizontal = handle.includes("w") ? -1 : handle.includes("e") ? 1 : 0;
    const vertical = handle.includes("n") ? -1 : handle.includes("s") ? 1 : 0;
    for (const amount of [-4, 4]) {
      const result = resizeNativeSceneSelection(
        scene,
        ["body"],
        handle,
        horizontal * amount,
        vertical * amount,
      );
      const after = frame(result, "body");
      expect(after.width).toBe(before.width + Math.abs(horizontal) * amount);
      expect(after.height).toBe(before.height + Math.abs(vertical) * amount);
      expect(after.x).toBe(before.x - (horizontal < 0 ? amount : 0));
      expect(after.y).toBe(before.y - (vertical < 0 ? amount : 0));
      expect(result.readingOrder).toBe(scene.readingOrder);
      expect(result.nodes[2]).toBe(scene.nodes[2]);
      expect(PresentationSceneSchema.safeParse(result).success).toBe(true);
    }
  });

  it.each(handles)(
    "keeps %s within every slide edge and enforces a minimum without flipping",
    (handle) => {
      const scene = fixture();
      for (const delta of [-1000, 1000]) {
        const result = resizeNativeSceneSelection(scene, ["body"], handle, delta, delta);
        const after = frame(result, "body");
        expect(after.width).toBeGreaterThanOrEqual(1);
        expect(after.height).toBeGreaterThanOrEqual(1);
        expect(PresentationSceneSchema.safeParse(result).success).toBe(true);
        expect(resizeNativeSceneSelection(result, ["body"], handle, delta, delta)).toBe(result);
      }
    },
  );

  it("ignores the perpendicular pointer axis on side handles and invalid/no-op requests", () => {
    const scene = fixture();
    expect(resizeNativeSceneSelection(scene, ["body"], "n", 100, 0)).toBe(scene);
    expect(resizeNativeSceneSelection(scene, ["body"], "w", 0, 100)).toBe(scene);
    expect(resizeNativeSceneSelection(scene, ["body"], "e", 0, 0)).toBe(scene);
    expect(resizeNativeSceneSelection(scene, ["body"], "e", Infinity, 2)).toBe(scene);
    expect(resizeNativeSceneSelection(scene, ["edge", "missing"], "se", 2, 2)).toBe(scene);
  });

  it.each(handles)(
    "scales a multi-selection proportionally around the opposite %s anchor",
    (handle) => {
      const scene = fixture();
      const bounds = selectedNativeSceneBounds(scene, ["body", "shape"])!;
      const horizontal = handle.includes("w") ? -1 : handle.includes("e") ? 1 : 0;
      const vertical = handle.includes("n") ? -1 : handle.includes("s") ? 1 : 0;
      // Shrink to leave every anchor safely inside the slide, including side midpoints.
      const result = resizeNativeSceneSelection(
        scene,
        ["body", "shape"],
        handle,
        (-horizontal * bounds.width) / 5,
        (-vertical * bounds.height) / 5,
      );
      const nextBounds = selectedNativeSceneBounds(result, ["body", "shape"])!;
      const anchor = (position: number, size: number, direction: number) =>
        position + (direction < 0 ? size : direction ? 0 : size / 2);
      expect(anchor(nextBounds.x, nextBounds.width, horizontal)).toBeCloseTo(
        anchor(bounds.x, bounds.width, horizontal),
      );
      expect(anchor(nextBounds.y, nextBounds.height, vertical)).toBeCloseTo(
        anchor(bounds.y, bounds.height, vertical),
      );
      for (const id of ["body", "shape"]) {
        expect(frame(result, id).width / frame(scene, id).width).toBeCloseTo(0.8);
        expect(frame(result, id).height / frame(scene, id).height).toBeCloseTo(0.8);
      }
      expect(PresentationSceneSchema.safeParse(result).success).toBe(true);
      const grouped = {
        ...scene,
        schemaVersion: 4 as const,
        groups: [{ id: "group", nodeIds: ["body", "shape"] }],
      };
      const groupResult = resizeNativeSceneSelection(
        grouped,
        ["shape"],
        handle,
        (-horizontal * bounds.width) / 5,
        (-vertical * bounds.height) / 5,
      );
      expect(groupResult.nodes).toEqual(result.nodes);
      expect(groupResult.groups).toBe(grouped.groups);
    },
  );

  it.each(handles)("resizes a rotated object at %s in physical slide coordinates", (handle) => {
    const scene = fixture();
    scene.schemaVersion = 4;
    const body = scene.nodes[1]!;
    if (body.type === "connector") throw new Error("fixture");
    body.rotation = 35;
    body.frame = { x: 35, y: 35, width: 20, height: 20 };
    const horizontal = handle.includes("w") ? -1 : handle.includes("e") ? 1 : 0;
    const vertical = handle.includes("n") ? -1 : handle.includes("s") ? 1 : 0;
    const angle = (35 * Math.PI) / 180;
    const dx = (horizontal * 32 * Math.cos(angle) - vertical * 18 * Math.sin(angle)) / 16;
    const dy = (horizontal * 32 * Math.sin(angle) + vertical * 18 * Math.cos(angle)) / 9;
    const result = resizeNativeSceneSelection(scene, ["body"], handle, dx, dy);
    const next = frame(result, "body");
    expect(next.width).toBeCloseTo(20 + Math.abs(horizontal) * 2);
    expect(next.height).toBeCloseTo(20 + Math.abs(vertical) * 2);
    function anchor(value: PresentationSceneFrame) {
      const x = -horizontal * value.width * 8;
      const y = -vertical * value.height * 4.5;
      return {
        x: (value.x + value.width / 2) * 16 + x * Math.cos(angle) - y * Math.sin(angle),
        y: (value.y + value.height / 2) * 9 + x * Math.sin(angle) + y * Math.cos(angle),
      };
    }
    expect(anchor(next).x).toBeCloseTo(anchor(body.frame).x);
    expect(anchor(next).y).toBeCloseTo(anchor(body.frame).y);
    for (const delta of [-1000, 1000])
      expect(
        PresentationSceneSchema.safeParse(
          resizeNativeSceneSelection(scene, ["body"], handle, delta, delta),
        ).success,
      ).toBe(true);
  });

  it("bounds rotated group growth with one scale and leaves the source immutable", () => {
    const scene = fixture();
    scene.schemaVersion = 4;
    const shape = scene.nodes[2]!;
    if (shape.type === "connector") throw new Error("fixture");
    shape.rotation = 25;
    shape.frame = { x: 60, y: 45, width: 20, height: 20 };
    scene.groups = [{ id: "group", nodeIds: ["body", "shape"] }];
    const before = structuredClone(scene);
    for (const handle of handles) {
      const bounds = selectedNativeSceneBounds(scene, ["body"])!;
      const horizontal = handle.includes("w") ? -1 : handle.includes("e") ? 1 : 0;
      const vertical = handle.includes("n") ? -1 : handle.includes("s") ? 1 : 0;
      const shrunk = resizeNativeSceneSelection(
        scene,
        ["body"],
        handle,
        (-horizontal * bounds.width) / 10,
        (-vertical * bounds.height) / 10,
      );
      const after = selectedNativeSceneBounds(shrunk, ["body"])!;
      const anchor = (position: number, size: number, direction: number) =>
        position + (direction < 0 ? size : direction ? 0 : size / 2);
      expect(anchor(after.x, after.width, horizontal)).toBeCloseTo(
        anchor(bounds.x, bounds.width, horizontal),
      );
      expect(anchor(after.y, after.height, vertical)).toBeCloseTo(
        anchor(bounds.y, bounds.height, vertical),
      );
      const result = resizeNativeSceneSelection(scene, ["body"], handle, 1000, 1000);
      expect(PresentationSceneSchema.safeParse(result).success).toBe(true);
      expect(frame(result, "shape").width / frame(scene, "shape").width).toBeCloseTo(
        frame(result, "body").width / frame(scene, "body").width,
      );
    }
    expect(scene).toEqual(before);
  });
});

describe("native selection deletion", () => {
  it("removes the selected nodes and attached edges atomically while keeping the required title", () => {
    const scene = fixture();
    const before = structuredClone(scene);
    const result = removeNativeSceneNodes(scene, ["title", "body", "shape", "body", "missing"]);
    expect(result.nodes.map((node) => node.id)).toEqual(["title", "image", "title-edge"]);
    expect(result.readingOrder).toEqual(["title", "image", "title-edge"]);
    expect(result.nodes[0]).toBe(scene.nodes[0]);
    expect(PresentationSceneSchema.parse(result)).toEqual(result);
    expect(scene).toEqual(before);
  });

  it("allows deleting only a connector and preserves title edges when only the title is selected", () => {
    const scene = fixture();
    const result = removeNativeSceneNodes(scene, ["edge"]);
    expect(result.nodes.map((node) => node.id)).toEqual([
      "title",
      "body",
      "shape",
      "image",
      "title-edge",
    ]);
    expect(result.readingOrder).toEqual(["title", "body", "shape", "image", "title-edge"]);
    expect(PresentationSceneSchema.safeParse(result).success).toBe(true);
    expect(removeNativeSceneNodes(scene, ["title", "missing"])).toBe(scene);
    expect(removeNativeSceneNodes(scene, [])).toBe(scene);
  });

  it("can remove every optional node and still leave a valid title-only scene", () => {
    const scene = fixture();
    const result = removeNativeSceneNodes(scene, scene.readingOrder);
    expect(result.nodes).toEqual([scene.nodes[0]]);
    expect(result.readingOrder).toEqual(["title"]);
    expect(PresentationSceneSchema.parse(result)).toEqual(result);
  });
});
