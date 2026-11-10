import { isValidElement, type ReactElement, type ReactNode } from "react";
import type * as ReactModule from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../locale-provider", () => ({ useLocale: () => ({ locale: "en-CA" }) }));
import {
  PRESENTATION_SCENE_MAX_BYTES,
  PresentationSceneDraftSchema,
  type PresentationScene,
} from "@openround/contracts";
import { createNativeContentBlock } from "../../lib/presentation-native-scene";
import { createNativeChartNode, createNativeTableNode } from "../../lib/presentation-native-data";
import { selectedNativeSceneBounds } from "../../lib/presentation-native-geometry";
import { NativeSceneCompositionControls } from "./native-scene-composition-controls";

const mocked = vi.hoisted(() => ({ hooks: null as { cursor: number; slots: unknown[] } | null }));
vi.mock("react", async (original) => {
  const react = await original<typeof ReactModule>();
  return {
    ...react,
    useState: <T,>(initial: T) => {
      const hooks = mocked.hooks;
      if (!hooks) return react.useState(initial);
      const index = hooks.cursor++;
      if (!(index in hooks.slots)) hooks.slots[index] = initial;
      return [
        hooks.slots[index] as T,
        (next: T) => {
          hooks.slots[index] = next;
        },
      ];
    },
  };
});
beforeEach(() => {
  mocked.hooks = { cursor: 0, slots: [] };
});
afterEach(() => {
  mocked.hooks = null;
});
function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement<Record<string, unknown>>(node)) return [];
  return [node, ...elements(node.props.children as ReactNode)];
}
function text(node: ReactNode): string {
  if (Array.isArray(node)) return node.map(text).join("");
  if (isValidElement<Record<string, unknown>>(node)) return text(node.props.children as ReactNode);
  return typeof node === "string" ? node : "";
}
function fixture(): PresentationScene {
  const scene = createNativeContentBlock().scene!;
  const table = {
    ...createNativeTableNode(),
    id: "a",
    rotation: 10,
    frame: { x: 20, y: 30, width: 20, height: 20 },
  };
  const chart = {
    ...createNativeChartNode(),
    id: "b",
    rotation: -10,
    frame: { x: 50, y: 35, width: 20, height: 20 },
  };
  return {
    ...scene,
    schemaVersion: 4,
    design: { theme: "midnight", font: "serif", spacing: "compact" },
    nodes: [...scene.nodes, table, chart],
    readingOrder: [...scene.readingOrder, table.id, chart.id],
  };
}
function nearBudget(): PresentationScene {
  const scene = fixture();
  for (let index = 0; index < 35; index += 1)
    scene.nodes.push({
      id: `body-${index}`,
      type: "text",
      role: "body",
      text: "",
      frame: { x: 10, y: 30, width: 40, height: 50 },
    });
  scene.readingOrder = scene.nodes.map((node) => node.id);
  let remaining =
    PRESENTATION_SCENE_MAX_BYTES - 1 - new TextEncoder().encode(JSON.stringify(scene)).byteLength;
  for (const node of scene.nodes) {
    if (node.type !== "text" || node.role !== "body") continue;
    const length = Math.min(4000, remaining);
    node.text = "x".repeat(length);
    remaining -= length;
  }
  expect(remaining).toBe(0);
  expect(PresentationSceneDraftSchema.safeParse(scene).success).toBe(true);
  return scene;
}
function harness(initial = fixture(), initialSelection = ["a", "b"], callback?: () => void) {
  let scene = initial;
  let selectedIds = initialSelection;
  let tree: ReactNode;
  const onChange = vi.fn((next: PresentationScene) => {
    callback?.();
    scene = next;
  });
  function render() {
    mocked.hooks!.cursor = 0;
    tree = NativeSceneCompositionControls({
      scene,
      selectedIds,
      selectedId: selectedIds.at(-1)!,
      onChange,
    });
  }
  function button(label: string) {
    const found = elements(tree).find(
      (element) => element.type === "button" && text(element) === label,
    );
    if (!found) throw new Error(`Missing ${label}`);
    return found;
  }
  render();
  return {
    onChange,
    render,
    button,
    get scene() {
      return scene;
    },
    click(label: string) {
      const control = button(label);
      if (control.props.disabled) throw new Error("Disabled control");
      (control.props.onClick as () => void)();
      render();
    },
    error() {
      return text(elements(tree).find((element) => element.props.role === "alert"));
    },
    upstream(next: PresentationScene) {
      scene = next;
      render();
    },
    select(ids: string[]) {
      selectedIds = ids;
      render();
    },
    angle(valueAsNumber: number) {
      const input = elements(tree).find((element) => element.type === "input");
      if (!input) throw new Error("Missing angle");
      (input.props.onChange as (event: unknown) => void)({ target: { valueAsNumber } });
      render();
    },
  };
}

describe("native composition controls", () => {
  it("groups and ungroups in one callback per action without changing data, rotation or reading order", () => {
    const original = fixture();
    const before = structuredClone(original);
    const editor = harness(original);
    editor.click("Group selected objects");
    expect(editor.onChange).toHaveBeenCalledTimes(1);
    expect(editor.scene.schemaVersion).toBe(4);
    expect(editor.scene.groups).toEqual([{ id: expect.any(String), nodeIds: ["a", "b"] }]);
    expect(editor.scene.nodes).toEqual(before.nodes);
    expect(editor.scene.readingOrder).toEqual(before.readingOrder);
    expect(editor.scene.design).toEqual(before.design);
    editor.select(["a"]);
    expect(editor.button("Group selected objects").props.disabled).toBe(true);
    editor.click("Ungroup selected objects");
    expect(editor.onChange).toHaveBeenCalledTimes(2);
    expect(editor.scene.groups).toEqual([]);
    expect(editor.scene.nodes).toEqual(before.nodes);
    expect(original).toEqual(before);
  });

  it("reports an offstage rotation without a callback, then recovers after moving away from the edge", () => {
    const scene = createNativeContentBlock().scene!;
    scene.nodes.push({
      id: "edge",
      type: "shape",
      shape: "diamond",
      color: "blue",
      label: "Edge",
      frame: { x: 0, y: 30, width: 40, height: 20 },
    });
    scene.readingOrder.push("edge");
    const editor = harness(scene, ["edge"]);
    const before = structuredClone(scene);
    editor.click("Rotate selection right 15°");
    expect(editor.error()).toContain("would leave the slide");
    expect(editor.onChange).not.toHaveBeenCalled();
    expect(scene).toEqual(before);
    const moved = {
      ...scene,
      nodes: scene.nodes.map((node) =>
        node.type === "shape" ? { ...node, frame: { ...node.frame, x: 25 } } : node,
      ),
    };
    editor.upstream(moved);
    editor.click("Rotate selection right 15°");
    expect(editor.error()).toBe("");
    expect(editor.onChange).toHaveBeenCalledTimes(1);
    expect(editor.scene).toMatchObject({
      schemaVersion: 4,
      nodes: [expect.anything(), expect.objectContaining({ rotation: 15 })],
    });
    editor.angle(45);
    expect(editor.scene.nodes.at(-1)).toMatchObject({ rotation: 45 });
    expect(editor.onChange).toHaveBeenCalledTimes(2);
    for (const invalid of [Number.NaN, Infinity, -181, 181]) editor.angle(invalid);
    expect(editor.onChange).toHaveBeenCalledTimes(2);
  });

  it("exposes ordinary button actions for growing and shrinking an entire selected group", () => {
    const scene = fixture();
    scene.groups = [{ id: "group", nodeIds: ["a", "b"] }];
    const editor = harness(scene, ["a"]);
    const initial = selectedNativeSceneBounds(scene, ["a"])!;
    for (const label of ["Grow selection 5%", "Shrink selection 5%"]) {
      expect(editor.button(label).props.type).toBe("button");
      expect(editor.button(label).props.disabled).toBe(false);
    }
    editor.click("Grow selection 5%");
    const grown = selectedNativeSceneBounds(editor.scene, ["a"])!;
    expect(grown.width).toBeGreaterThan(initial.width);
    expect(grown.height).toBeGreaterThan(initial.height);
    expect(editor.onChange).toHaveBeenCalledTimes(1);
    editor.click("Shrink selection 5%");
    const shrunk = selectedNativeSceneBounds(editor.scene, ["a"])!;
    expect(shrunk.width).toBeLessThan(grown.width);
    expect(editor.onChange).toHaveBeenCalledTimes(2);
    expect(editor.scene.groups).toEqual(scene.groups);
    expect(editor.scene.readingOrder).toEqual(scene.readingOrder);
    expect(
      editor.scene.nodes.slice(1).map((node) => node.type !== "connector" && node.rotation),
    ).toEqual([10, -10]);
    expect(PresentationSceneDraftSchema.safeParse(editor.scene).success).toBe(true);
  });

  it("rejects grouping beyond the unchanged byte budget without a history callback, then recovers", () => {
    const scene = nearBudget();
    const before = structuredClone(scene);
    const editor = harness(scene);
    editor.click("Group selected objects");
    expect(editor.error()).toContain("exceeds the slide’s limits");
    expect(editor.onChange).not.toHaveBeenCalled();
    expect(scene).toEqual(before);
    const shortened = structuredClone(scene);
    const body = shortened.nodes.find((node) => node.type === "text" && node.role === "body");
    if (body?.type !== "text") throw new Error("Missing budget text");
    body.text = body.text.slice(256);
    editor.upstream(shortened);
    editor.click("Group selected objects");
    expect(editor.onChange).toHaveBeenCalledTimes(1);
    expect(editor.error()).toBe("");
    expect(editor.scene.groups?.[0]?.nodeIds).toEqual(["a", "b"]);
  });

  it("lets callback programming errors propagate instead of presenting validation errors", () => {
    const editor = harness(fixture(), ["a", "b"], () => {
      throw new Error("Parent update failed");
    });
    expect(() => editor.click("Group selected objects")).toThrow("Parent update failed");
    editor.render();
    expect(editor.error()).toBe("");
    expect(editor.scene.groups).toBeUndefined();
  });
});
