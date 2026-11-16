import { describe, expect, it } from "vitest";
import {
  PresentationSceneDraftSchema,
  PresentationSceneSchema,
  type PresentationScene,
  type PresentationSceneFrame,
  type PresentationSceneNode,
} from "@openround/contracts";
import {
  expandNativeSceneSelection,
  groupNativeSceneNodes,
  moveNativeSceneNodes,
  nativeNodePaintedBounds,
  nativeSceneSelectionUnits,
  removeNativeSceneNodes,
  resizeNativeSceneGroup,
  resizeNativeSceneNode,
  rotateNativeSceneNodes,
  selectedNativeSceneBounds,
  snapNativeSceneMove,
  ungroupNativeSceneNodes,
} from "./presentation-native-geometry";
import {
  alignNativeSceneNodes,
  canAlignNativeSceneNodes,
  canDistributeNativeSceneNodes,
  canLayerNativeSceneNode,
  distributeNativeSceneNodes,
  layerNativeSceneNode,
} from "./presentation-native-design";
import {
  duplicateNativeScene,
  createNativeContentBlock,
  createNativeLinkNode,
  createNativeRevealNode,
  removeNativeNode,
  reorderNativeNode,
} from "./presentation-native-scene";

type FramedNode = Exclude<PresentationSceneNode, { type: "connector" }>;

describe("audience interaction composition", () => {
  it("groups, moves, resizes and rotates reveal/link objects while preserving scene 5 and content", () => {
    const base = createNativeContentBlock().scene!;
    const reveal = {
      ...createNativeRevealNode(),
      label: "Show detail",
      body: "Audience detail",
      frame: { x: 20, y: 40, width: 20, height: 20 },
    };
    const link = {
      ...createNativeLinkNode(),
      label: "Read more",
      href: "https://example.com/detail",
      frame: { x: 60, y: 40, width: 20, height: 15 },
    };
    const scene: PresentationScene = {
      ...base,
      schemaVersion: 5,
      nodes: [...base.nodes, reveal, link],
      readingOrder: [...base.readingOrder, reveal.id, link.id],
    };
    const grouped = groupNativeSceneNodes(scene, [reveal.id, link.id], "interactions");
    expect(grouped.schemaVersion).toBe(5);
    expect(expandNativeSceneSelection(grouped, [reveal.id])).toEqual([link.id, reveal.id]);
    const moved = moveNativeSceneNodes(grouped, [reveal.id], 2, 3);
    const resized = resizeNativeSceneNode(moved, link.id, 2, 2);
    const rotated = rotateNativeSceneNodes(resized, [reveal.id], 10);
    for (const next of [grouped, moved, resized, rotated]) {
      expect(next.schemaVersion).toBe(5);
      expect(PresentationSceneDraftSchema.parse(next)).toEqual(next);
      expect(content(next)).toEqual(content(scene));
      expect(next.readingOrder).toEqual(scene.readingOrder);
    }
    expect(node(moved, reveal.id).frame.x).toBe(22);
    expect(node(moved, link.id).frame.x).toBe(62);
    expect(node(resized, reveal.id).frame.width).toBeGreaterThan(reveal.frame.width);
    expect(node(rotated, reveal.id).rotation).toBe(10);
    expect(node(rotated, link.id).rotation).toBe(10);
    const duplicate = duplicateNativeScene(rotated);
    expect(duplicate.groups?.[0]?.nodeIds).toEqual(duplicate.readingOrder.slice(1));
    expect(
      duplicate.nodes.slice(1).map(({ id: _id, ...data }) => {
        void _id;
        return data;
      }),
    ).toEqual(
      rotated.nodes.slice(1).map(({ id: _id, ...data }) => {
        void _id;
        return data;
      }),
    );
    const removed = removeNativeSceneNodes(rotated, [link.id]);
    expect(removed.nodes).toEqual([scene.nodes[0]]);
    expect(removed.groups).toEqual([]);
    expect(PresentationSceneDraftSchema.parse(removed)).toEqual(removed);
  });
});

function fixture(): PresentationScene {
  return {
    schemaVersion: 4,
    aspectRatio: "16:9",
    design: { theme: "midnight", font: "serif", spacing: "compact" },
    groups: [
      { id: "first-group", nodeIds: ["a", "b"] },
      { id: "last-group", nodeIds: ["d", "e"] },
    ],
    nodes: [
      {
        id: "title",
        type: "text",
        role: "title",
        text: "Evidence",
        frame: { x: 8, y: 5, width: 84, height: 12 },
      },
      {
        id: "a",
        type: "shape",
        shape: "diamond",
        color: "blue",
        label: "First",
        rotation: 15,
        frame: { x: 12, y: 32, width: 10, height: 12 },
      },
      {
        id: "edge",
        type: "connector",
        from: { nodeId: "a", anchor: "right" },
        to: { nodeId: "c", anchor: "left" },
        label: "Supports",
        color: "blue",
      },
      {
        id: "c",
        type: "image",
        mediaId: "00000000-0000-4000-8000-000000000001",
        altText: "Evidence diagram",
        fit: "cover",
        focalPoint: { x: 25, y: 75 },
        frame: { x: 46, y: 30, width: 10, height: 12 },
      },
      {
        id: "b",
        type: "text",
        role: "body",
        text: "Review evidence",
        richText: {
          paragraphs: [
            {
              kind: "bullet",
              runs: [{ text: "Review evidence", bold: true, href: "https://example.com/evidence" }],
            },
          ],
        },
        rotation: -10,
        frame: { x: 27, y: 35, width: 12, height: 9 },
      },
      {
        id: "d",
        type: "table",
        caption: "Evidence counts",
        headers: ["Stage", "Count"],
        rows: [
          ["Plan", "12"],
          ["Deliver", "18"],
        ],
        frame: { x: 62, y: 40, width: 10, height: 12 },
      },
      {
        id: "title-edge",
        type: "connector",
        from: { nodeId: "title", anchor: "bottom" },
        to: { nodeId: "b", anchor: "top" },
        label: "Read",
        color: "black",
      },
      {
        id: "e",
        type: "chart",
        chartType: "bar",
        title: "Evidence",
        summary: "Counts rose from 12 to 18.",
        categories: ["Plan", "Deliver"],
        series: [{ name: "Count", values: [12, 18] }],
        frame: { x: 82, y: 35, width: 10, height: 12 },
      },
    ],
    readingOrder: ["title", "a", "b", "c", "d", "e", "edge", "title-edge"],
  };
}

function node(scene: PresentationScene, id: string): FramedNode {
  const result = scene.nodes.find((item) => item.id === id);
  if (!result || result.type === "connector") throw new Error(`Missing framed fixture ${id}`);
  return result;
}

function valid(scene: PresentationScene) {
  const result = PresentationSceneDraftSchema.safeParse(scene);
  expect(result.success, result.error?.message).toBe(true);
  expect(PresentationSceneSchema.parse(scene)).toEqual(scene);
  return scene;
}

function content(scene: PresentationScene) {
  return new Map<string, unknown>(
    scene.nodes.map((item) => {
      if (item.type === "connector") return [item.id, item];
      const { frame: _frame, rotation: _rotation, ...retained } = item;
      void [_frame, _rotation];
      return [item.id, retained];
    }),
  );
}

function center(item: FramedNode) {
  return {
    x: (item.frame.x + item.frame.width / 2) * 16,
    y: (item.frame.y + item.frame.height / 2) * 9,
  };
}

function distance(a: FramedNode, b: FramedNode) {
  const first = center(a),
    second = center(b);
  return Math.hypot(second.x - first.x, second.y - first.y);
}

/** The actual rotated local top-left corner, in physical stage units. */
function topLeft(item: FramedNode) {
  const angle = ((item.rotation ?? 0) * Math.PI) / 180;
  const middle = center(item);
  return {
    x:
      middle.x - item.frame.width * 8 * Math.cos(angle) + item.frame.height * 4.5 * Math.sin(angle),
    y:
      middle.y - item.frame.width * 8 * Math.sin(angle) - item.frame.height * 4.5 * Math.cos(angle),
  };
}

function expectOffset(scene: PresentationScene, changed: PresentationScene, a = "a", b = "b") {
  expect(node(changed, b).frame.x - node(changed, a).frame.x).toBeCloseTo(
    node(scene, b).frame.x - node(scene, a).frame.x,
    9,
  );
  expect(node(changed, b).frame.y - node(changed, a).frame.y).toBeCloseTo(
    node(scene, b).frame.y - node(scene, a).frame.y,
    9,
  );
}

describe("persistent native groups", () => {
  it("expands one selected member, filters missing IDs and keeps the last requested object last", () => {
    const scene = valid(fixture());
    expect(expandNativeSceneSelection(scene, ["a", "a", "missing", "edge"])).toEqual([
      "b",
      "a",
      "edge",
    ]);
    const units = nativeSceneSelectionUnits(scene, ["a", "c", "d", "edge"]);
    expect(units.map((unit) => unit.ids.slice().sort())).toEqual([["a", "b"], ["c"], ["d", "e"]]);
    expect(selectedNativeSceneBounds(scene, ["a"])).toEqual(
      selectedNativeSceneBounds(scene, ["a", "b"]),
    );
    expect(selectedNativeSceneBounds(scene, ["edge", "missing"])).toBeNull();
  });

  it("merges complete selected groups with another unit and ungroups without rewriting content", () => {
    const scene = fixture();
    const before = structuredClone(scene);
    const merged = valid(groupNativeSceneNodes(scene, ["a", "d", "c", "edge"], "merged"));
    expect(merged.groups).toEqual([{ id: "merged", nodeIds: ["a", "b", "c", "d", "e"] }]);
    expect(merged.readingOrder).toBe(scene.readingOrder);
    expect(content(merged)).toEqual(content(scene));
    expect(merged.nodes).toBe(scene.nodes);
    expect(groupNativeSceneNodes(scene, ["a", "b"], "unused")).toBe(scene);
    expect(groupNativeSceneNodes(scene, ["edge", "missing"], "unused")).toBe(scene);
    const ungrouped = valid(ungroupNativeSceneNodes(scene, ["b"]));
    expect(ungrouped.groups).toEqual([scene.groups![1]]);
    expect(ungrouped.nodes).toBe(scene.nodes);
    expect(ungroupNativeSceneNodes(scene, ["missing", "edge"])).toBe(scene);
    expect(scene).toEqual(before);
  });

  it("moves every member through a one-member selection without affecting connectors or other objects", () => {
    const scene = fixture();
    const changed = valid(moveNativeSceneNodes(scene, ["b"], 3.125, -4.25));
    expectOffset(scene, changed);
    for (const id of ["a", "b"]) {
      expect(node(changed, id).frame.x).toBe(node(scene, id).frame.x + 3.125);
      expect(node(changed, id).frame.y).toBe(node(scene, id).frame.y - 4.25);
    }
    for (const item of scene.nodes.filter((item) => !["a", "b"].includes(item.id)))
      expect(changed.nodes.find((next) => next.id === item.id)).toBe(item);
    expect(changed.groups).toBe(scene.groups);
    expect(changed.readingOrder).toBe(scene.readingOrder);
    expect(content(changed)).toEqual(content(scene));
  });

  it("clamps one shared translation against both raw and rotated painted bounds", () => {
    const scene = fixture();
    node(scene, "a").frame = { x: 30, y: 35, width: 30, height: 10 };
    node(scene, "a").rotation = 90;
    node(scene, "b").frame = { x: 65, y: 35, width: 10, height: 10 };
    node(scene, "b").rotation = 0;
    valid(scene);
    for (const [dx, dy] of [
      [-100, 0],
      [100, 0],
      [0, -100],
      [0, 100],
    ]) {
      const candidate = moveNativeSceneNodes(scene, ["a"], dx!, dy!);
      expect(
        PresentationSceneDraftSchema.safeParse(candidate).success,
        JSON.stringify({
          dx,
          dy,
          first: node(candidate, "a").frame,
          painted: nativeNodePaintedBounds(node(candidate, "a")),
        }),
      ).toBe(true);
      const moved = valid(candidate);
      expectOffset(scene, moved);
      expect(distance(node(moved, "a"), node(moved, "b"))).toBeCloseTo(
        distance(node(scene, "a"), node(scene, "b")),
        8,
      );
    }
    expect(node(moveNativeSceneNodes(scene, ["a"], -100, 0), "a").frame.x).toBe(0);
  });

  it("resizes every grouped member proportionally from its painted union anchor", () => {
    const scene = fixture();
    const before = structuredClone(scene);
    const bounds = selectedNativeSceneBounds(scene, ["a"])!;
    const changed = valid(resizeNativeSceneNode(scene, "b", bounds.width / 4, 0));
    const nextBounds = selectedNativeSceneBounds(changed, ["a"])!;
    expect(nextBounds.x).toBeCloseTo(bounds.x, 8);
    expect(nextBounds.y).toBeCloseTo(bounds.y, 8);
    for (const id of ["a", "b"]) {
      expect(node(changed, id).frame.width / node(scene, id).frame.width).toBeCloseTo(1.25);
      expect(node(changed, id).frame.height / node(scene, id).frame.height).toBeCloseTo(1.25);
      expect(node(changed, id).rotation).toBe(node(scene, id).rotation);
    }
    expect(distance(node(changed, "a"), node(changed, "b"))).toBeCloseTo(
      distance(node(scene, "a"), node(scene, "b")) * 1.25,
    );
    const bounded = valid(resizeNativeSceneGroup(scene, ["a"], 1000, 1000));
    const scale = node(bounded, "a").frame.width / node(scene, "a").frame.width;
    expect(node(bounded, "b").frame.width / node(scene, "b").frame.width).toBeCloseTo(scale, 8);
    expect(content(changed)).toEqual(content(scene));
    expect(scene).toEqual(before);
  });
});

describe("native physical rotations", () => {
  it.each([-90, -35, 35, 90])(
    "resizes a %s-degree object with the opposite physical corner anchored",
    (rotation) => {
      const scene = fixture();
      delete scene.groups;
      const image = node(scene, "c");
      image.frame = { x: 40, y: 40, width: 12, height: 16 };
      image.rotation = rotation;
      const originalAnchor = topLeft(image);
      const changed = valid(resizeNativeSceneNode(valid(scene), "c", 3.125, 1.75));
      const anchor = topLeft(node(changed, "c"));
      expect(anchor.x).toBeCloseTo(originalAnchor.x, 8);
      expect(anchor.y).toBeCloseTo(originalAnchor.y, 8);
      expect(node(changed, "c").rotation).toBe(rotation);
      expect(content(changed)).toEqual(content(scene));
      expect(node(changed, "c").frame).not.toEqual(image.frame);
      valid(resizeNativeSceneNode(scene, "c", 1000, 1000));
      valid(resizeNativeSceneNode(scene, "c", -1000, -1000));
    },
  );

  it("rotates the complete selected group while preserving physical center distances and content", () => {
    const scene = fixture();
    const changed = valid(rotateNativeSceneNodes(scene, ["a"], 30));
    expect(changed).not.toBe(scene);
    expect(distance(node(changed, "a"), node(changed, "b"))).toBeCloseTo(
      distance(node(scene, "a"), node(scene, "b")),
      9,
    );
    expect(node(changed, "a").rotation).toBe(45);
    expect(node(changed, "b").rotation).toBe(20);
    for (const id of ["a", "b"]) {
      expect(node(changed, id).frame.width).toBe(node(scene, id).frame.width);
      expect(node(changed, id).frame.height).toBe(node(scene, id).frame.height);
    }
    expect(content(changed)).toEqual(content(scene));
    expect(changed.readingOrder).toBe(scene.readingOrder);
    expect(changed.groups).toBe(scene.groups);
    expect(rotateNativeSceneNodes(scene, ["a"], 360)).toBe(scene);
    expect(rotateNativeSceneNodes(scene, ["a"], NaN)).toBe(scene);
    expect(rotateNativeSceneNodes(scene, ["edge"], 30)).toBe(scene);
  });

  it("refuses an off-stage rotation atomically and promotes an accepted old scene only when changed", () => {
    const scene = fixture();
    delete scene.groups;
    node(scene, "title").frame = { x: 0, y: 0, width: 100, height: 12 };
    const before = structuredClone(scene);
    expect(rotateNativeSceneNodes(scene, ["title"], 90)).toBe(scene);
    expect(scene).toEqual(before);
    scene.schemaVersion = 3;
    scene.nodes = scene.nodes.filter((item) => item.type !== "table" && item.type !== "chart");
    scene.readingOrder = scene.readingOrder.filter((id) =>
      scene.nodes.some((item) => item.id === id),
    );
    for (const item of scene.nodes) if (item.type !== "connector") delete item.rotation;
    const accepted = valid(rotateNativeSceneNodes(valid(scene), ["c"], 390));
    expect(accepted.schemaVersion).toBe(4);
    expect(node(accepted, "c").rotation).toBe(30);
    expect(scene.schemaVersion).toBe(3);
  });
});

describe("arranging composition units", () => {
  it.each(["left", "center", "right", "top", "middle", "bottom"] as const)(
    "aligns %s using group painted bounds and preserves internal offsets",
    (alignment) => {
      const scene = fixture();
      const changed = valid(alignNativeSceneNodes(scene, ["a", "c", "d", "edge"], alignment));
      const units = nativeSceneSelectionUnits(changed, ["a", "c", "d"]);
      const positions = units.map(({ bounds }) =>
        alignment === "left"
          ? bounds.x
          : alignment === "center"
            ? bounds.x + bounds.width / 2
            : alignment === "right"
              ? bounds.x + bounds.width
              : alignment === "top"
                ? bounds.y
                : alignment === "middle"
                  ? bounds.y + bounds.height / 2
                  : bounds.y + bounds.height,
      );
      positions.forEach((position) => expect(position).toBeCloseTo(positions[0]!, 8));
      expectOffset(scene, changed);
      expectOffset(scene, changed, "d", "e");
      expect(content(changed)).toEqual(content(scene));
      expect(changed.readingOrder).toBe(scene.readingOrder);
    },
  );

  it.each(["horizontal", "vertical"] as const)(
    "distributes groups %s with equal nonnegative gaps and fixed outer members",
    (axis) => {
      const scene = fixture();
      if (axis === "vertical") {
        node(scene, "a").frame.y -= 10;
        node(scene, "b").frame.y -= 10;
        node(scene, "c").frame.y = 50;
        node(scene, "d").frame.y = 75;
        node(scene, "e").frame.y = 70;
      }
      expect(canDistributeNativeSceneNodes(scene, ["a", "c", "d"], axis)).toBe(true);
      const changed = valid(distributeNativeSceneNodes(scene, ["a", "c", "d"], axis));
      const units = nativeSceneSelectionUnits(changed, ["a", "c", "d"]);
      const first = units[0]!.bounds,
        middle = units[1]!.bounds,
        last = units[2]!.bounds;
      const position = axis === "horizontal" ? "x" : "y";
      const size = axis === "horizontal" ? "width" : "height";
      expect(middle[position] - first[position] - first[size]).toBeCloseTo(
        last[position] - middle[position] - middle[size],
        8,
      );
      expect(middle[position] - first[position] - first[size]).toBeGreaterThanOrEqual(0);
      for (const id of ["a", "b", "d", "e"]) expect(node(changed, id)).toEqual(node(scene, id));
      expect(content(changed)).toEqual(content(scene));
      expect(changed.readingOrder).toBe(scene.readingOrder);
      expect(canDistributeNativeSceneNodes(scene, ["a", "b", "c"], axis)).toBe(false);
      expect(distributeNativeSceneNodes(scene, ["a", "b", "c"], axis)).toBe(scene);
    },
  );

  it("refuses an entire alignment or distribution that requires a negative raw frame for a rotated object", () => {
    const scene = snapFixture();
    node(scene, "moving").frame = { x: 0, y: 30, width: 30, height: 10 };
    node(scene, "moving").rotation = 90;
    node(scene, "target").frame.x = 0;
    valid(scene);
    const before = structuredClone(scene);
    expect(canAlignNativeSceneNodes(scene, ["moving", "target"], "left")).toBe(false);
    expect(alignNativeSceneNodes(scene, ["moving", "target"], "left")).toBe(scene);
    const left: PresentationSceneNode = {
      id: "left",
      type: "shape",
      shape: "rectangle",
      color: "blue",
      label: "Left",
      frame: { x: 0, y: 70, width: 1, height: 5 },
    };
    const distribution = structuredClone(scene);
    distribution.nodes.push(left);
    distribution.readingOrder.push(left.id);
    node(distribution, "target").frame = { x: 18, y: 70, width: 1, height: 5 };
    valid(distribution);
    expect(
      canDistributeNativeSceneNodes(distribution, ["left", "moving", "target"], "horizontal"),
    ).toBe(false);
    expect(
      distributeNativeSceneNodes(distribution, ["left", "moving", "target"], "horizontal"),
    ).toBe(distribution);
    expect(scene).toEqual(before);
  });

  it("moves a complete layer unit through stable connector slots without changing reading order", () => {
    const scene = fixture();
    const changed = valid(layerNativeSceneNode(scene, "b", "front"));
    expect(changed.nodes.filter((item) => item.type !== "connector").map(({ id }) => id)).toEqual([
      "title",
      "c",
      "d",
      "e",
      "a",
      "b",
    ]);
    scene.nodes.forEach((item, index) => {
      if (item.type === "connector") expect(changed.nodes[index]).toBe(item);
    });
    expect(changed.readingOrder).toBe(scene.readingOrder);
    expect(changed.groups).toBe(scene.groups);
    expect(new Map(changed.nodes.map((item) => [item.id, item]))).toEqual(
      new Map(scene.nodes.map((item) => [item.id, item])),
    );
    const backward = valid(layerNativeSceneNode(changed, "a", "backward"));
    expect(backward.nodes.filter((item) => item.type !== "connector").map(({ id }) => id)).toEqual([
      "title",
      "c",
      "a",
      "b",
      "d",
      "e",
    ]);
    expect(canLayerNativeSceneNode(changed, "a", "forward")).toBe(false);
    expect(canLayerNativeSceneNode(scene, "edge", "front")).toBe(false);
  });

  it("protects the title while deleting an entire group, its edges and orphan group membership", () => {
    const scene = fixture();
    scene.groups = [{ id: "protected", nodeIds: ["title", "a", "b"] }, scene.groups![1]!];
    const changed = valid(removeNativeNode(scene, "a"));
    expect(changed.nodes.map(({ id }) => id)).toEqual(["title", "c", "d", "e"]);
    expect(changed.groups).toEqual([scene.groups[1]]);
    expect(changed.readingOrder).toEqual(["title", "c", "d", "e"]);
    const all = valid(removeNativeSceneNodes(scene, scene.readingOrder));
    expect(all.nodes).toEqual([scene.nodes[0]]);
    expect(all.groups).toEqual([]);
    expect(all.readingOrder).toEqual(["title"]);
  });

  it("duplicates every group/member/connector identity while preserving all content and relative layout", () => {
    const scene = fixture();
    const before = structuredClone(scene);
    const copy = valid(duplicateNativeScene(scene));
    const ids = new Map(scene.nodes.map((item, index) => [item.id, copy.nodes[index]!.id]));
    const oldIds = new Set([
      ...scene.nodes.map(({ id }) => id),
      ...scene.groups!.map(({ id }) => id),
    ]);
    for (const id of [...copy.nodes.map(({ id }) => id), ...copy.groups!.map(({ id }) => id)])
      expect(oldIds.has(id)).toBe(false);
    expect(copy.readingOrder).toEqual(scene.readingOrder.map((id) => ids.get(id)));
    copy.nodes.forEach((item, index) => {
      const old = scene.nodes[index]!;
      if (item.type === "connector" && old.type === "connector")
        expect(item).toEqual({
          ...old,
          id: ids.get(old.id),
          from: { ...old.from, nodeId: ids.get(old.from.nodeId) },
          to: { ...old.to, nodeId: ids.get(old.to.nodeId) },
        });
      else expect(item).toEqual({ ...old, id: ids.get(old.id) });
    });
    copy.groups!.forEach((group, index) =>
      expect(group.nodeIds).toEqual(scene.groups![index]!.nodeIds.map((id) => ids.get(id))),
    );
    const reordered = valid(reorderNativeNode(scene, "b", 1));
    expect(reordered.nodes).toBe(scene.nodes);
    expect(reordered.groups).toBe(scene.groups);
    expect(scene).toEqual(before);
  });
});

function snapFixture(): PresentationScene {
  return {
    schemaVersion: 4,
    aspectRatio: "16:9",
    nodes: [
      {
        id: "title",
        type: "text",
        role: "title",
        text: "Snap",
        frame: { x: 5, y: 5, width: 90, height: 10 },
      },
      {
        id: "moving",
        type: "text",
        role: "body",
        text: "Move",
        frame: { x: 10, y: 30, width: 10, height: 10 },
      },
      {
        id: "target",
        type: "shape",
        shape: "rectangle",
        color: "blue",
        label: "Target",
        frame: { x: 40, y: 70, width: 10, height: 10 },
      },
    ],
    readingOrder: ["title", "moving", "target"],
  };
}

describe("transient screen-distance native snapping", () => {
  it("snaps exactly six screen pixels away and keeps larger distances free at the same percentage delta", () => {
    const scene = snapFixture();
    const snapped = snapNativeSceneMove(scene, ["moving"], 19.5, 0, 1200, 675);
    valid(snapped.scene);
    expect(node(snapped.scene, "moving").frame.x).toBe(30);
    expect(snapped.guides).toEqual([{ axis: "x", position: 40 }]);
    const farther = snapNativeSceneMove(scene, ["moving"], 19.49, 0, 1200, 675);
    expect(node(valid(farther.scene), "moving").frame.x).toBeCloseTo(29.49);
    expect(farther.guides).toEqual([]);
    const zoomed = snapNativeSceneMove(scene, ["moving"], 19.5, 0, 2400, 1350);
    expect(node(valid(zoomed.scene), "moving").frame.x).toBe(29.5);
    expect(zoomed.guides).toEqual([]);
    const edge = snapNativeSceneMove(scene, ["moving"], -9.5, 0, 1200, 675);
    expect(node(valid(edge.scene), "moving").frame.x).toBe(0);
    expect(edge.guides).toEqual([{ axis: "x", position: 0 }]);
  });

  it("excludes every selected group member from targets and does not carry preview state into cancellation", () => {
    const scene = snapFixture();
    node(scene, "title").frame.x = 3;
    node(scene, "moving").frame = { x: 17, y: 35, width: 5, height: 5 };
    node(scene, "target").frame = { x: 24, y: 35, width: 5, height: 5 };
    scene.groups = [{ id: "pair", nodeIds: ["moving", "target"] }];
    const before = structuredClone(scene);
    const selected = snapNativeSceneMove(scene, ["moving"], 1, 3, 1200, 675);
    expect(selected.guides).toEqual([]);
    expect(node(valid(selected.scene), "moving").frame).toEqual({
      x: 18,
      y: 38,
      width: 5,
      height: 5,
    });
    expectOffset(scene, selected.scene, "moving", "target");
    const base = snapFixture();
    const preview = snapNativeSceneMove(base, ["moving"], 19.5, 0, 1200, 675);
    expect(preview.guides).toHaveLength(1);
    const cancelled = snapNativeSceneMove(base, ["moving"], 0, 0, 1200, 675);
    expect(cancelled.scene).toBe(base);
    expect(cancelled.guides).toEqual([]);
    expect(preview.scene).not.toHaveProperty("guides");
    expect(snapNativeSceneMove(base, ["moving"], 1, 0, 0, 675).guides).toEqual([]);
    expect(scene).toEqual(before);
  });
});

it("keeps 100 deterministic repeated fractional/rotated group edits valid without drifting members", () => {
  let scene = fixture();
  scene.groups = [scene.groups![0]!];
  node(scene, "a").frame = {
    x: 35.123456789,
    y: 40.246813579,
    width: 8.123456789,
    height: 5.987654321,
  };
  node(scene, "b").frame = {
    x: 49.135791357,
    y: 46.864209753,
    width: 5.135791357,
    height: 8.246813579,
  };
  const expectedContent = content(scene);
  for (let index = 0; index < 100; index++) {
    const moved = valid(
      moveNativeSceneNodes(scene, ["a"], Math.sin(index * 3.7) * 110, Math.cos(index * 1.3) * 110),
    );
    expectOffset(scene, moved);
    const resized = valid(
      resizeNativeSceneNode(moved, "b", Math.sin(index * 1.7) * 8, Math.cos(index * 2.9) * 8),
    );
    const scale = node(resized, "a").frame.width / node(moved, "a").frame.width;
    expect(node(resized, "b").frame.height / node(moved, "b").frame.height).toBeCloseTo(scale, 7);
    const rotated = valid(rotateNativeSceneNodes(resized, ["a"], 13.75));
    expect(distance(node(rotated, "a"), node(rotated, "b"))).toBeCloseTo(
      distance(node(resized, "a"), node(resized, "b")),
      7,
    );
    expect(content(rotated)).toEqual(expectedContent);
    expect(rotated.readingOrder).toEqual(scene.readingOrder);
    expect(rotated.groups).toEqual(scene.groups);
    for (const item of rotated.nodes)
      if (item.type !== "connector") {
        const bounds: PresentationSceneFrame = nativeNodePaintedBounds(item);
        expect(bounds.x).toBeGreaterThanOrEqual(-1e-8);
        expect(bounds.y).toBeGreaterThanOrEqual(-1e-8);
        expect(bounds.x + bounds.width).toBeLessThanOrEqual(100 + 1e-8);
        expect(bounds.y + bounds.height).toBeLessThanOrEqual(100 + 1e-8);
      }
    scene = rotated;
  }
});
