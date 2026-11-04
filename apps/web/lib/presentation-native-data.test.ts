import { PresentationSceneDraftSchema, type PresentationScene } from "@openround/contracts";
import { describe, expect, it } from "vitest";
import { createNativeContentBlock } from "./presentation-native-scene";
import {
  applyNativeDataDraft,
  createNativeChartNode,
  createNativeTableNode,
  nativeDataDraft,
  nativeDataRevision,
  parseNativeDataPaste,
  type NativeDataNode,
} from "./presentation-native-data";

function sceneWith(node: NativeDataNode): PresentationScene {
  const scene = createNativeContentBlock().scene!;
  return {
    ...scene,
    schemaVersion: 4,
    nodes: [...scene.nodes, node],
    readingOrder: [...scene.readingOrder, node.id],
  };
}

describe("bounded local native data", () => {
  it.each([
    createNativeTableNode(),
    ...["bar", "line", "pie"].map((type) => createNativeChartNode(type as "bar" | "line" | "pie")),
  ])("builds valid explicitly illustrative defaults ($type)", (node) => {
    expect(PresentationSceneDraftSchema.safeParse(sceneWith(node)).success).toBe(true);
    expect(node.type === "table" ? node.caption : node.title).toContain("Illustrative");
  });

  it("reads BOM/CRLF, quoted commas, doubled quotes and multiline cells", () => {
    expect(
      parseNativeDataPaste('\uFEFFName,Note\r\n"North, west","Says ""hello""\r\non two lines"\r\n'),
    ).toEqual({
      success: true,
      data: [
        ["Name", "Note"],
        ["North, west", 'Says "hello"\non two lines'],
      ],
    });
    expect(parseNativeDataPaste('Name\tValue\n"North\twest"\t10')).toEqual({
      success: true,
      data: [
        ["Name", "Value"],
        ["North\twest", "10"],
      ],
    });
  });

  it.each([
    ['Name,Value\n"unfinished,10', "unfinished"],
    ["A,B\n1", "same number"],
    ["A,B\n1,2,3", "same number"],
    ['A,B\n"one"tail,2', "closing quote"],
    ["A,B,C,D,E,F,G\n1,2,3,4,5,6,7", "6 columns"],
    [`A\n${Array.from({ length: 21 }, () => "1").join("\n")}`, "20 data rows"],
    [`A\n${"x".repeat(301)}`, "300 characters"],
    ["é".repeat(65537), "128 KiB"],
  ])("rejects malformed or oversized paste without partial data", (input, message) => {
    const result = parseNativeDataPaste(input);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toContain(message);
  });

  it("preserves newest geometry, scene design and persistent groups when applying staged data", () => {
    const node = createNativeTableNode();
    const draft = nativeDataDraft(node);
    if (draft.type !== "table") throw new Error("Wrong fixture");
    draft.caption = "Actual results";
    draft.grid[1]![1] = "=literal text";
    const scene = sceneWith({
      ...node,
      frame: { x: 20, y: 30, width: 60, height: 40 },
      rotation: 10,
    });
    scene.design = { theme: "midnight", font: "serif", spacing: "compact" };
    scene.groups = [{ id: "group", nodeIds: [scene.nodes[0]!.id, node.id] }];
    const result = applyNativeDataDraft(scene, node.id, draft);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.nodes.at(-1)).toMatchObject({
      rotation: 10,
      frame: { x: 20, y: 30, width: 60, height: 40 },
      caption: "Actual results",
      rows: [
        ["Alpha", "=literal text"],
        ["Beta", "20"],
      ],
    });
    expect(result.data.design).toEqual(scene.design);
    expect(result.data.groups).toEqual(scene.groups);
    expect(nativeDataRevision(node)).toBe(
      nativeDataRevision({ ...node, rotation: 10, frame: { x: 10, y: 20, width: 60, height: 40 } }),
    );
  });

  it.each(["", "=1+1", "Infinity", "NaN", "0x10", "1e13"])(
    "rejects unsafe or missing chart value %j",
    (value) => {
      const node = createNativeChartNode();
      const draft = nativeDataDraft(node);
      draft.grid[1]![1] = value;
      const scene = sceneWith(node);
      const original = structuredClone(scene);
      expect(applyNativeDataDraft(scene, node.id, draft).success).toBe(false);
      expect(scene).toEqual(original);
    },
  );

  it("accepts finite signed decimal/scientific values and rejects invalid pie data", () => {
    const node = createNativeChartNode();
    const draft = nativeDataDraft(node);
    draft.grid = [
      ["Category", "Change"],
      ["One", "-1.2e2"],
      ["Two", ".5"],
      ["Three", "+0"],
    ];
    const result = applyNativeDataDraft(sceneWith(node), node.id, draft);
    expect(result.success).toBe(true);
    if (result.success)
      expect(result.data.nodes.at(-1)).toMatchObject({
        series: [{ name: "Change", values: [-120, 0.5, 0] }],
      });
    if (draft.type !== "chart") throw new Error("Wrong fixture");
    draft.chartType = "pie";
    expect(applyNativeDataDraft(sceneWith(node), node.id, draft).success).toBe(false);
    draft.grid = [
      ["Category", "Value"],
      ["Only", "0"],
    ];
    expect(applyNativeDataDraft(sceneWith(node), node.id, draft).success).toBe(false);
    draft.grid = [
      ["Category", "Value", "Other"],
      ["Only", "1", "2"],
    ];
    expect(applyNativeDataDraft(sceneWith(node), node.id, draft).success).toBe(false);
  });

  it("enforces metadata, dimensional and unchanged scene byte limits", () => {
    const node = createNativeTableNode();
    const scene = sceneWith(node);
    const draft = nativeDataDraft(node);
    if (draft.type !== "table") throw new Error("Wrong fixture");
    draft.caption = " ";
    expect(applyNativeDataDraft(scene, node.id, draft).success).toBe(false);
    draft.caption = "Results";
    draft.grid = [
      Array(6).fill("Header"),
      ...Array.from({ length: 20 }, () => Array(6).fill("x".repeat(300))),
    ];
    for (let index = 0; index < 28; index += 1) {
      scene.nodes.push({
        id: `body-${index}`,
        type: "text",
        role: "body",
        text: "a".repeat(4000),
        frame: { x: 0, y: 0, width: 10, height: 10 },
      });
      scene.readingOrder.push(`body-${index}`);
    }
    expect(PresentationSceneDraftSchema.safeParse(scene).success).toBe(true);
    const tooLarge = applyNativeDataDraft(scene, node.id, draft);
    expect(tooLarge.success).toBe(false);
    if (!tooLarge.success) expect(tooLarge.error).toContain("128 KiB");
    draft.grid.push(Array(6).fill("extra"));
    expect(applyNativeDataDraft(sceneWith(node), node.id, draft).success).toBe(false);
  });
});
