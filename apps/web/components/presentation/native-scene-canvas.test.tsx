import { isValidElement, type ReactElement, type ReactNode } from "react";
import type * as ReactModule from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type PresentationScene } from "@openround/contracts";
import { NativeSceneCanvas } from "./native-scene-canvas";
import { NativeSceneView } from "./native-scene-view";
import { NativeSceneSelectionControls } from "./native-scene-selection-controls";
import { NativeSceneInteractionMap } from "./native-scene-interaction-map";

const mocked = vi.hoisted(() => ({
  hooks: null as null | {
    cursor: number;
    slots: unknown[];
    effects: (() => void)[];
  },
}));
vi.mock("react", async (original) => {
  const react = await original<typeof ReactModule>();
  return {
    ...react,
    useRef: <T,>(initial: T) => {
      const hooks = mocked.hooks;
      if (!hooks) return react.useRef(initial);
      const index = hooks.cursor++;
      if (!(index in hooks.slots)) hooks.slots[index] = { current: initial };
      return hooks.slots[index];
    },
    useState: <T,>(initial: T) => {
      const hooks = mocked.hooks;
      if (!hooks) return react.useState(initial);
      const index = hooks.cursor++;
      if (!(index in hooks.slots)) hooks.slots[index] = initial;
      return [
        hooks.slots[index],
        (next: T) => {
          hooks.slots[index] = next;
        },
      ];
    },
    useEffect: (callback: () => void | (() => void), dependencies: unknown[]) => {
      const hooks = mocked.hooks;
      if (!hooks) return react.useEffect(callback, dependencies);
      const index = hooks.cursor++;
      const previous = hooks.slots[index] as
        { dependencies: unknown[]; cleanup?: () => void } | undefined;
      if (previous && dependencies.every((value, i) => value === previous.dependencies[i])) return;
      hooks.effects.push(() => {
        previous?.cleanup?.();
        hooks.slots[index] = { dependencies, cleanup: callback() };
      });
    },
  };
});

function fixture(): PresentationScene {
  return {
    schemaVersion: 1,
    aspectRatio: "16:9",
    nodes: [
      {
        id: "title",
        type: "text",
        role: "title",
        text: "Title",
        frame: { x: 8, y: 8, width: 84, height: 20 },
      },
      {
        id: "body",
        type: "text",
        role: "body",
        text: "Evidence",
        frame: { x: 10, y: 40, width: 20, height: 20 },
      },
      {
        id: "shape",
        type: "shape",
        shape: "rectangle",
        color: "blue",
        label: "Decision",
        frame: { x: 60, y: 40, width: 25, height: 25 },
      },
    ],
    readingOrder: ["title", "body", "shape"],
  };
}

function elements(node: ReactNode): ReactElement<Record<string, any>>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement<Record<string, any>>(node)) return [];
  return [node, ...elements(node.props.children as ReactNode)];
}

function harness(selectedNodeIds = ["body", "shape"]) {
  const hooks = { cursor: 0, slots: [] as unknown[], effects: [] as (() => void)[] };
  const capture = new Set<number>();
  let narrow = false;
  let width = 1000;
  const root = {
    focus: vi.fn(),
    querySelector: () => ({ getBoundingClientRect: () => ({ width, height: 500 }) }),
    setPointerCapture: vi.fn((id: number) => capture.add(id)),
    hasPointerCapture: (id: number) => capture.has(id),
    releasePointerCapture: vi.fn((id: number) => capture.delete(id)),
  };
  vi.stubGlobal("window", { matchMedia: () => ({ matches: narrow }) });
  vi.stubGlobal("HTMLButtonElement", class {});
  const onChange = vi.fn();
  const onSelect = vi.fn();
  const onEditInteraction = vi.fn();
  const original = fixture();
  let scene = original;
  let tree: ReactElement<Record<string, any>>;
  function render(next = scene, flush = true) {
    scene = next;
    hooks.cursor = 0;
    mocked.hooks = hooks;
    try {
      tree = NativeSceneCanvas({
        scene,
        renderImage: () => null,
        selectedNodeIds,
        onSelect,
        onChange,
        onEditInteraction,
      });
    } finally {
      mocked.hooks = null;
    }
    tree.props.ref.current = root;
    if (flush) hooks.effects.splice(0).forEach((effect) => effect());
  }
  function event(overrides: Record<string, unknown> = {}) {
    return {
      pointerId: 7,
      pointerType: "mouse",
      isPrimary: true,
      button: 0,
      clientX: 100,
      clientY: 100,
      shiftKey: false,
      currentTarget: root,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
      ...overrides,
    };
  }
  render();
  const view = () => elements(tree).find((child) => child.type === NativeSceneView)!;
  return {
    original,
    onChange,
    onSelect,
    onEditInteraction,
    root,
    event,
    render,
    view,
    controls: () => elements(tree).find((child) => child.type === NativeSceneSelectionControls)!,
    interactionMap: () => elements(tree).find((child) => child.type === NativeSceneInteractionMap)!,
    start: (ev = event(), id = "body", resize = false, handle = true) =>
      view().props.onNodePointerDown(ev, id, resize, handle),
    move: (ev = event({ clientX: 200, clientY: 150 })) => tree.props.onPointerMove(ev),
    finish: (ev = event({ clientX: 200, clientY: 150 })) => tree.props.onPointerUp(ev),
    cancel: (kind: "onPointerCancel" | "onLostPointerCapture") => tree.props[kind](event()),
    escape: () => tree.props.onKeyDown(event({ key: "Escape" })),
    setNarrow: () => {
      narrow = true;
    },
    setZeroWidth: () => {
      width = 0;
    },
    unmount: () =>
      hooks.slots.forEach((slot) => (slot as { cleanup?: () => void } | null)?.cleanup?.()),
  };
}

function frame(scene: PresentationScene, id = "body") {
  const node = scene.nodes.find((node) => node.id === id)!;
  if (node.type === "connector") throw new Error("Expected framed node");
  return node.frame;
}

afterEach(() => vi.unstubAllGlobals());
beforeEach(() => {
  mocked.hooks = null;
});

describe("native pointer gesture lifecycle", () => {
  it("keeps map visibility and selection outside history, and follows gesture previews and cancellation", () => {
    const current = harness();
    expect(current.interactionMap().props.expanded).toBe(false);
    expect(current.view().props.editorOverlay).toBeUndefined();
    current.interactionMap().props.onExpandedChange(true);
    current.render();
    expect(current.interactionMap().props.expanded).toBe(true);
    expect(current.view().props.editorOverlay.props.scene).toBe(current.original);
    current.start();
    current.move();
    current.render();
    const preview = current.view().props.scene;
    expect(preview).not.toBe(current.original);
    expect(current.view().props.editorOverlay.props.scene).toBe(preview);
    expect(current.interactionMap().props.scene).toBe(preview);
    expect(current.onChange).not.toHaveBeenCalled();
    current.escape();
    current.render();
    expect(current.view().props.editorOverlay.props.scene).toBe(current.original);
    current.start();
    current.move();
    current.render();
    current.interactionMap().props.onSelect("shape");
    current.render();
    expect(current.root.releasePointerCapture).toHaveBeenCalled();
    expect(current.onSelect).toHaveBeenLastCalledWith("shape");
    expect(current.view().props.scene).toBe(current.original);
    expect(current.onChange).not.toHaveBeenCalled();
    current.interactionMap().props.onEdit("body");
    expect(current.onEditInteraction).toHaveBeenLastCalledWith("body");
    expect(current.onChange).not.toHaveBeenCalled();
    const recovered = { ...current.original, nodes: [...current.original.nodes] };
    current.render(recovered);
    expect(current.view().props.editorOverlay.props.scene).toBe(recovered);
    current.interactionMap().props.onExpandedChange(false);
    current.render();
    expect(current.view().props.editorOverlay).toBeUndefined();
  });
  it("places selection controls outside the authored surface and disables in-stage handles", () => {
    const editor = harness();
    expect(editor.view().props.hideGeometryControls).toBe(true);
    expect(elements(editor.controls()).some((node) => node.type === NativeSceneView)).toBe(false);
    expect(editor.controls().props.selectedNodeIds).toEqual(["body", "shape"]);
  });

  it("keeps the external pointer control bound to the original scene during previews and cancels before changing selection", () => {
    const editor = harness();
    editor.controls().props.onPointerDown(editor.event(), "shape", true, true);
    editor.move();
    editor.render();
    expect(editor.controls().props.scene).toBe(editor.original);
    expect(editor.view().props.scene).not.toBe(editor.original);
    expect(editor.onChange).not.toHaveBeenCalled();
    editor.controls().props.onSelect("title");
    editor.render();
    expect(editor.view().props.scene).toBe(editor.original);
    expect(editor.onSelect).toHaveBeenCalledWith("title");
    editor.finish();
    expect(editor.onChange).not.toHaveBeenCalled();
  });

  it("resizes a persistent group from the external handle proportionally and commits only on release", () => {
    const editor = harness();
    const scene = {
      ...editor.original,
      schemaVersion: 4 as const,
      groups: [{ id: "group", nodeIds: ["body", "shape"] }],
    };
    editor.render(scene);
    editor.controls().props.onPointerDown(editor.event(), "shape", true, true);
    editor.move(editor.event({ clientX: 150, clientY: 125 }));
    editor.render();
    expect(editor.onChange).not.toHaveBeenCalled();
    expect(frame(editor.view().props.scene).width).toBeCloseTo(24);
    expect(frame(editor.view().props.scene, "shape").width).toBeCloseTo(30);
    editor.finish(editor.event({ clientX: 150, clientY: 125 }));
    expect(editor.onChange).toHaveBeenCalledTimes(1);
    const result = editor.onChange.mock.calls[0]![0] as PresentationScene;
    expect(result.groups).toEqual(scene.groups);
    expect(result.readingOrder).toEqual(scene.readingOrder);
    expect(frame(result, "title")).toEqual(frame(scene, "title"));
  });

  it("keeps external keyboard move/resize available in phone reading mode", () => {
    const editor = harness(["body"]);
    editor.setNarrow();
    editor
      .controls()
      .props.onPointerDown(editor.event({ pointerType: "touch" }), "body", true, true);
    expect(editor.root.setPointerCapture).not.toHaveBeenCalled();
    editor.controls().props.onGeometryKey("body", 5, 0, false);
    expect(frame(editor.onChange.mock.calls[0]![0]).x).toBe(15);
    editor.controls().props.onGeometryKey("body", 0, 1, true);
    expect(frame(editor.onChange.mock.calls[1]![0]).height).toBe(21);
  });
  it("previews a whole selection locally and commits once on release", () => {
    const editor = harness();
    editor.start();
    editor.move();
    editor.render();
    expect(frame(editor.view().props.scene)).toMatchObject({ x: 20, y: 50 });
    expect(frame(editor.view().props.scene, "shape")).toMatchObject({ x: 70, y: 50 });
    expect(editor.onChange).not.toHaveBeenCalled();
    expect(editor.onSelect).not.toHaveBeenCalled();
    editor.finish();
    expect(editor.onChange).toHaveBeenCalledTimes(1);
    expect(frame(editor.onChange.mock.calls[0]![0])).toMatchObject({ x: 20, y: 50 });
    expect(editor.root.releasePointerCapture).toHaveBeenCalledWith(7);
    editor.finish();
    expect(editor.onChange).toHaveBeenCalledTimes(1);
  });

  it("uses the final release position and resizes only the chosen node", () => {
    const editor = harness();
    editor.start(editor.event(), "shape", true);
    editor.finish(editor.event({ clientX: 150, clientY: 125 }));
    const result = editor.onChange.mock.calls[0]![0] as PresentationScene;
    expect(frame(result, "shape")).toEqual({ x: 60, y: 40, width: 30, height: 30 });
    expect(frame(result)).toEqual(frame(editor.original));
  });

  it.each(["escape", "onPointerCancel", "onLostPointerCapture"] as const)(
    "discards previews on %s without draft mutation",
    (reason) => {
      const editor = harness();
      editor.start();
      editor.move();
      if (reason === "escape") editor.escape();
      else editor.cancel(reason);
      editor.render();
      expect(editor.view().props.scene).toBe(editor.original);
      editor.finish();
      expect(editor.onChange).not.toHaveBeenCalled();
      expect(editor.root.releasePointerCapture).toHaveBeenCalledWith(7);
    },
  );

  it("rejects a stale release before effects and clears previews after external history replaces the scene", () => {
    const editor = harness();
    editor.start();
    editor.move();
    const restored = { ...editor.original, nodes: [...editor.original.nodes] };
    editor.render(restored, false);
    expect(editor.view().props.scene).toBe(restored);
    editor.finish();
    expect(editor.onChange).not.toHaveBeenCalled();
    editor.render(editor.original);
    expect(editor.view().props.scene).toBe(editor.original);
  });

  it("cancels capture on unmount", () => {
    const editor = harness();
    editor.start();
    editor.move();
    editor.unmount();
    editor.finish();
    expect(editor.onChange).not.toHaveBeenCalled();
    expect(editor.root.releasePointerCapture).toHaveBeenCalledWith(7);
  });

  it("ignores secondary pointers, tiny clicks and invalid stage bounds", () => {
    const editor = harness();
    editor.start(editor.event({ button: 2 }));
    editor.start(editor.event({ isPrimary: false }));
    expect(editor.root.setPointerCapture).not.toHaveBeenCalled();
    editor.start();
    editor.finish(editor.event({ clientX: 101, clientY: 100 }));
    expect(editor.onChange).not.toHaveBeenCalled();
    editor.setZeroWidth();
    editor.start();
    editor.finish();
    expect(editor.onChange).not.toHaveBeenCalled();
  });

  it("toggles Shift selection without capture or default handle focus", () => {
    const editor = harness(["body"]);
    const ev = editor.event({ shiftKey: true });
    editor.start(ev, "shape");
    expect(ev.preventDefault).toHaveBeenCalled();
    expect(editor.onSelect).toHaveBeenCalledWith("shape", true);
    expect(editor.root.setPointerCapture).not.toHaveBeenCalled();
  });

  it("retains touch scrolling and narrow semantic geometry while keeping keyboard group nudges", () => {
    const editor = harness();
    editor.start(editor.event({ pointerType: "touch" }), "body", false, false);
    expect(editor.root.setPointerCapture).not.toHaveBeenCalled();
    editor.setNarrow();
    const ev = editor.event({ pointerType: "touch" });
    editor.start(ev);
    expect(ev.preventDefault).not.toHaveBeenCalled();
    expect(editor.root.setPointerCapture).not.toHaveBeenCalled();
    editor.view().props.onGeometryKey("body", 1, 0, false);
    expect(editor.onSelect).not.toHaveBeenCalled();
    expect(frame(editor.onChange.mock.calls[0]![0])).toMatchObject({ x: 11 });
    expect(frame(editor.onChange.mock.calls[0]![0], "shape")).toMatchObject({ x: 61 });
  });
});
