import { isValidElement, type ReactElement, type ReactNode } from "react";
import type * as ReactModule from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type PresentationScene } from "@openround/contracts";
import { NativeSceneCanvas } from "./native-scene-canvas";
import { NativeSceneView } from "./native-scene-view";

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
    root,
    event,
    render,
    view,
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
