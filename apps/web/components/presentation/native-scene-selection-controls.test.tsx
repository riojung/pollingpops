import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("../locale-provider", () => ({ useLocale: () => ({ locale: "en-CA" }) }));
import { type PresentationScene } from "@openround/contracts";
import { NativeSceneSelectionControls } from "./native-scene-selection-controls";

function fixture(): PresentationScene {
  return {
    schemaVersion: 4,
    aspectRatio: "16:9",
    nodes: [
      {
        id: "title",
        type: "text",
        role: "title",
        text: "Complete title",
        frame: { x: 0, y: 0, width: 100, height: 1 },
      },
      {
        id: "body",
        type: "text",
        role: "body",
        text: "Evidence",
        frame: { x: 12, y: 42, width: 30, height: 30 },
        rotation: 15,
      },
      {
        id: "edge",
        type: "connector",
        from: { nodeId: "title", anchor: "bottom" },
        to: { nodeId: "body", anchor: "top" },
        label: "Supports",
        color: "blue",
      },
    ],
    readingOrder: ["title", "body", "edge"],
  };
}
function elements(node: ReactNode): ReactElement<Record<string, any>>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement<Record<string, any>>(node)) return [];
  return [node, ...elements(node.props.children as ReactNode)];
}
function controls(selectedNodeIds = ["body"], scene = fixture()) {
  const onSelect = vi.fn(),
    onPointerDown = vi.fn(),
    onGeometryKey = vi.fn();
  const tree = NativeSceneSelectionControls({
    scene,
    selectedNodeIds,
    onSelect,
    onPointerDown,
    onGeometryKey,
  });
  const all = elements(tree);
  return {
    tree,
    all,
    scene,
    onSelect,
    onPointerDown,
    onGeometryKey,
    buttons: all.filter((node) => node.type === "button"),
    select: all.find((node) => node.type === "select")!,
  };
}

describe("external native selection controls", () => {
  it("offers every object in semantic reading order without replacing inspector selection labels", () => {
    const view = controls();
    expect(view.select.props.value).toBe("body");
    expect(
      view.all.filter((node) => node.type === "option").map((node) => node.props.value),
    ).toEqual(["title", "body", "edge"]);
    const markup = renderToStaticMarkup(view.tree);
    expect(markup).toContain('aria-label="Selected object controls"');
    expect(markup).toContain("Canvas object");
    expect(markup).toContain("Move Evidence. Use arrow keys to nudge.");
    expect(markup).not.toContain("Move Slide title");
    view.select.props.onChange({ target: { value: "title" } });
    expect(view.onSelect).toHaveBeenCalledWith("title");
    expect(view.onGeometryKey).not.toHaveBeenCalled();
  });

  it("keeps a connector selectable without offering meaningless geometry controls", () => {
    const view = controls(["edge"]);
    expect(view.select.props.value).toBe("edge");
    expect(view.buttons).toHaveLength(0);
    expect(renderToStaticMarkup(view.tree)).toContain("Connections follow their objects");
  });

  it("routes named move and resize keys to the active object with normal and Shift steps", () => {
    const view = controls();
    const event = (key: string, shiftKey = false) => ({
      key,
      shiftKey,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    });
    const move = event("ArrowLeft"),
      resize = event("ArrowDown", true),
      enter = event("Enter");
    view.buttons[0]!.props.onKeyDown(move);
    view.buttons[1]!.props.onKeyDown(resize);
    view.buttons[0]!.props.onKeyDown(enter);
    expect(view.onGeometryKey.mock.calls).toEqual([
      ["body", -1, 0, false],
      ["body", 0, 5, true],
    ]);
    expect(move.preventDefault).toHaveBeenCalled();
    expect(resize.preventDefault).toHaveBeenCalled();
    expect(enter.preventDefault).not.toHaveBeenCalled();
  });

  it("delegates explicit pointer handles without editing the scene or selecting another object", () => {
    const view = controls();
    const original = structuredClone(view.scene);
    const pointer = { pointerId: 7 };
    view.buttons[0]!.props.onPointerDown(pointer);
    view.buttons[1]!.props.onPointerDown(pointer);
    expect(view.onPointerDown.mock.calls).toEqual([
      [pointer, "body", false, true],
      [pointer, "body", true, true],
    ]);
    expect(view.onGeometryKey).not.toHaveBeenCalled();
    expect(view.onSelect).not.toHaveBeenCalled();
    expect(view.scene).toEqual(original);
  });

  it("uses the persistent group name and member geometry path while retaining the selection", () => {
    const scene = fixture();
    scene.groups = [{ id: "group", nodeIds: ["title", "body"] }];
    const view = controls(["title", "body"], scene);
    expect(view.buttons[1]!.props["aria-label"]).toBe(
      "Resize group 1. Use arrow keys to change size.",
    );
    view.buttons[1]!.props.onKeyDown({
      key: "ArrowRight",
      shiftKey: false,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    });
    expect(view.onGeometryKey).toHaveBeenCalledWith("body", 1, 0, true);
    expect(renderToStaticMarkup(view.tree)).toContain("Move affects all selected objects");
  });

  it("has no active gesture controls when a selection no longer exists", () => {
    const view = controls(["removed"]);
    expect(view.select.props.value).toBe("");
    expect(view.buttons).toHaveLength(0);
    expect(renderToStaticMarkup(view.tree)).toContain("Choose an object to move or resize it");
  });
});
