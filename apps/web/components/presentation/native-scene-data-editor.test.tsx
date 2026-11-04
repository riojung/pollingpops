import { isValidElement, type ReactElement, type ReactNode } from "react";
import type * as ReactModule from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { PresentationScene } from "@openround/contracts";
import { describe, expect, it, vi } from "vitest";
import { createNativeContentBlock } from "../../lib/presentation-native-scene";
import {
  createNativeChartNode,
  createNativeTableNode,
  type NativeDataNode,
} from "../../lib/presentation-native-data";
import { NativeSceneDataEditor } from "./native-scene-data-editor";

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
        (next: T | ((value: T) => T)) => {
          hooks.slots[index] =
            typeof next === "function" ? (next as (value: T) => T)(hooks.slots[index] as T) : next;
        },
      ];
    },
  };
});

function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement<Record<string, unknown>>(node)) return [];
  return [node, ...elements(node.props.children as ReactNode)];
}

function harness(node: NativeDataNode, callback?: () => boolean | void) {
  const base = createNativeContentBlock().scene!;
  let scene: PresentationScene = {
    ...base,
    schemaVersion: 4,
    nodes: [...base.nodes, node],
    readingOrder: [...base.readingOrder, node.id],
  };
  const hooks = { cursor: 0, slots: [] as unknown[] };
  let tree: ReactNode;
  const onChange = vi.fn((next: PresentationScene, _historyField?: string) => {
    if (callback?.() === false) return false;
    scene = next;
  });
  function render() {
    hooks.cursor = 0;
    mocked.hooks = hooks;
    try {
      tree = NativeSceneDataEditor({
        scene,
        node: scene.nodes.find((item) => item.id === node.id) as NativeDataNode,
        onChange,
      });
    } finally {
      mocked.hooks = null;
    }
  }
  function find(predicate: (element: ReactElement<Record<string, unknown>>) => boolean) {
    const found = elements(tree).find(predicate);
    if (!found) throw new Error("Missing data editor control");
    return found;
  }
  render();
  return {
    onChange,
    render,
    get scene() {
      return scene;
    },
    button(label: string) {
      return find((element) => element.type === "button" && element.props.children === label);
    },
    click(label: string) {
      const button = this.button(label);
      if (button.props.disabled) throw new Error("Disabled button");
      (button.props.onClick as () => void)();
      render();
    },
    change(label: string, value: string) {
      const input = find((element) => element.props["aria-label"] === label);
      (input.props.onChange as (event: unknown) => void)({ target: { value } });
      render();
    },
    paste(value: string) {
      const input = find(
        (element) => element.type === "textarea" && "placeholder" in element.props,
      );
      (input.props.onChange as (event: unknown) => void)({ target: { value } });
      render();
    },
    value(label: string) {
      return find((element) => element.props["aria-label"] === label).props.value;
    },
    control(label: string) {
      return find((element) => element.props["aria-label"] === label);
    },
    alerts() {
      return elements(tree)
        .filter((element) => element.props.role === "alert")
        .map((element) => element.props.children)
        .join(" ");
    },
    groupRole() {
      return find(
        (element) =>
          element.props["aria-label"] ===
          (node.type === "chart" ? "Chart data editor" : "Table data editor"),
      ).props.role;
    },
    upstream(update: (current: NativeDataNode) => NativeDataNode) {
      scene = {
        ...scene,
        nodes: scene.nodes.map((item) =>
          item.id === node.id ? update(item as NativeDataNode) : item,
        ),
      };
      render();
    },
  };
}

describe("staged native data editing", () => {
  it("keeps quoted pasted newlines in multiline table headings and cells through rendering and apply", () => {
    const editor = harness(createNativeTableNode());
    editor.paste('"Region\nname",Count,Note\r\n"North\nwest",18,"Says ""hello""\r\nfollow-up"');
    editor.click("Preview pasted data");
    const heading = editor.control("Column 1 heading");
    const note = editor.control("Row 1, column 3");
    expect(heading.type).toBe("textarea");
    expect(heading.props).toMatchObject({ rows: 2, maxLength: 120, value: "Region\nname" });
    expect(note.type).toBe("textarea");
    expect(note.props).toMatchObject({ rows: 2, maxLength: 300, value: 'Says "hello"\nfollow-up' });
    expect(renderToStaticMarkup(note)).toContain("Says &quot;hello&quot;\nfollow-up</textarea>");
    editor.change("Column 3 heading", "Observation\nnotes");
    editor.click("Apply table changes");
    expect(editor.scene.nodes.at(-1)).toMatchObject({
      headers: ["Region\nname", "Count", "Observation\nnotes"],
      rows: [["North\nwest", "18", 'Says "hello"\nfollow-up']],
    });
  });

  it("uses multiline chart labels while keeping chart numbers in bounded decimal inputs", () => {
    const editor = harness(createNativeChartNode());
    expect(editor.control("Series 1 name").type).toBe("textarea");
    expect(editor.control("Category 1").type).toBe("textarea");
    expect(editor.control("Series 1 name").props).toMatchObject({ rows: 2, maxLength: 80 });
    expect(editor.control("Category 1").props).toMatchObject({ rows: 2, maxLength: 80 });
    expect(editor.control("Category 1, series 1 value").type).toBe("input");
    expect(editor.control("Category 1, series 1 value").props).toMatchObject({
      inputMode: "decimal",
      maxLength: 40,
    });
    editor.change("Category 1", "North\nwest");
    editor.change("Series 1 name", "Attendees\ncount");
    editor.click("Apply chart changes");
    expect(editor.scene.nodes.at(-1)).toMatchObject({
      categories: ["North\nwest", "Beta", "Gamma"],
      series: [{ name: "Attendees\ncount", values: [10, 20, 15] }],
    });
  });

  it("previews locally, reports invalid chart values, then applies recovered data once", () => {
    const editor = harness(createNativeChartNode());
    expect(editor.groupRole()).toBe("group");
    editor.paste('Category,Revenue\r\n"North, west",=SUM(A1)\r\nSouth,20');
    editor.click("Preview pasted data");
    expect(editor.value("Category 1")).toBe("North, west");
    expect(editor.onChange).not.toHaveBeenCalled();
    editor.click("Apply chart changes");
    expect(editor.alerts()).toContain("Formulas");
    expect(editor.onChange).not.toHaveBeenCalled();
    editor.change("Category 1, series 1 value", "10");
    editor.click("Apply chart changes");
    expect(editor.onChange).toHaveBeenCalledTimes(1);
    expect(editor.onChange.mock.calls[0]).toHaveLength(1);
    expect(editor.scene.nodes.at(-1)).toMatchObject({
      categories: ["North, west", "South"],
      series: [{ name: "Revenue", values: [10, 20] }],
    });
  });

  it("retains staged cells on malformed or oversized paste, and discards without parent mutation", () => {
    const editor = harness(createNativeTableNode());
    editor.change("Row 1, column 2", "Staged value");
    editor.paste('A,B\n"unfinished,1');
    editor.click("Preview pasted data");
    expect(editor.alerts()).toContain("unfinished");
    expect(editor.value("Row 1, column 2")).toBe("Staged value");
    editor.paste("é".repeat(65537));
    expect(editor.alerts()).toContain("128 KiB");
    expect(editor.value("Row 1, column 2")).toBe("Staged value");
    editor.click("Discard staged changes");
    expect(editor.value("Row 1, column 2")).toBe("10");
    expect(editor.alerts()).toBe("");
    expect(editor.onChange).not.toHaveBeenCalled();
  });

  it("keeps staged data through geometry updates and resets after an upstream data/history change", () => {
    const editor = harness(createNativeTableNode());
    editor.change("Row 1, column 2", "Actual result");
    editor.upstream((node) => ({
      ...node,
      frame: { x: 20, y: 20, width: 60, height: 50 },
      rotation: 5,
    }));
    expect(editor.value("Row 1, column 2")).toBe("Actual result");
    editor.click("Apply table changes");
    expect(editor.scene.nodes.at(-1)).toMatchObject({
      rotation: 5,
      frame: { x: 20, y: 20, width: 60, height: 50 },
      rows: [
        ["Alpha", "Actual result"],
        ["Beta", "20"],
      ],
    });
    editor.change("Row 1, column 2", "Unsaved draft");
    editor.upstream((node) =>
      node.type === "table"
        ? {
            ...node,
            rows: [
              ["Alpha", "Undone result"],
              ["Beta", "20"],
            ],
          }
        : node,
    );
    expect(editor.value("Row 1, column 2")).toBe("Undone result");
    editor.upstream((node) =>
      node.type === "table"
        ? {
            ...node,
            rows: [
              ["Alpha", "Actual result"],
              ["Beta", "20"],
            ],
          }
        : node,
    );
    expect(editor.value("Row 1, column 2")).toBe("Actual result");
  });

  it("supports bounded ordinary table row/column changes", () => {
    const editor = harness(createNativeTableNode());
    editor.click("Add table row");
    editor.click("Add table column");
    editor.change("Column 3 heading", "Notes");
    editor.change("Row 3, column 3", "New observation");
    editor.click("Apply table changes");
    expect(editor.scene.nodes.at(-1)).toMatchObject({
      headers: ["Category", "Value", "Notes"],
      rows: [
        ["Alpha", "10", ""],
        ["Beta", "20", ""],
        ["", "", "New observation"],
      ],
    });
    editor.click("Remove last table row");
    editor.click("Remove last table column");
    editor.click("Apply table changes");
    expect(editor.scene.nodes.at(-1)).toMatchObject({
      headers: ["Category", "Value"],
      rows: [
        ["Alpha", "10"],
        ["Beta", "20"],
      ],
    });
    while (!editor.button("Add table row").props.disabled) editor.click("Add table row");
    while (!editor.button("Add table column").props.disabled) editor.click("Add table column");
    expect(editor.button("Add table row").props.disabled).toBe(true);
    expect(editor.button("Add table column").props.disabled).toBe(true);
  });

  it("does not swallow callback failures and retains the staged draft for recovery", () => {
    const editor = harness(createNativeTableNode(), () => {
      throw new Error("Parent update failed");
    });
    editor.change("Row 1, column 2", "Recovered data");
    expect(() => editor.click("Apply table changes")).toThrow("Parent update failed");
    editor.render();
    expect(editor.value("Row 1, column 2")).toBe("Recovered data");
    expect(editor.alerts()).toBe("");
  });

  it("retains rejected data and retries after the presentation budget accepts the update", () => {
    let accepted = false;
    const editor = harness(createNativeTableNode(), () => accepted);
    editor.change("Row 1, column 2", "Actual result");
    editor.click("Apply table changes");
    expect(editor.alerts()).toContain("Your staged data is retained");
    expect(editor.value("Row 1, column 2")).toBe("Actual result");
    expect(editor.scene.nodes.at(-1)).toMatchObject({
      rows: [
        ["Alpha", "10"],
        ["Beta", "20"],
      ],
    });
    accepted = true;
    editor.click("Apply table changes");
    expect(editor.alerts()).toBe("");
    expect(editor.scene.nodes.at(-1)).toMatchObject({
      rows: [
        ["Alpha", "Actual result"],
        ["Beta", "20"],
      ],
    });
  });

  it("keeps rapid explicit Apply actions out of continuous text-history coalescing", () => {
    const editor = harness(createNativeTableNode());
    editor.change("Row 1, column 2", "11");
    editor.click("Apply table changes");
    editor.change("Row 1, column 2", "12");
    editor.click("Apply table changes");
    expect(editor.onChange).toHaveBeenCalledTimes(2);
    expect(editor.onChange.mock.calls.every((call) => call.length === 1)).toBe(true);
    expect(editor.onChange.mock.calls[0]?.[0].nodes.at(-1)).toMatchObject({
      rows: [
        ["Alpha", "11"],
        ["Beta", "20"],
      ],
    });
    expect(editor.onChange.mock.calls[1]?.[0].nodes.at(-1)).toMatchObject({
      rows: [
        ["Alpha", "12"],
        ["Beta", "20"],
      ],
    });
  });
});
