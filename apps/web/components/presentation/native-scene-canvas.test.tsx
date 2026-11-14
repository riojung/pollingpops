import { isValidElement, type ReactElement, type ReactNode } from "react";
import type * as ReactModule from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type PresentationScene, type SupportedLocale } from "@openround/contracts";
import { NativeSceneCanvas } from "./native-scene-canvas";
import { NativeSceneView } from "./native-scene-view";
import { NativeSceneSelectionControls } from "./native-scene-selection-controls";
import { NativeSceneInteractionMap } from "./native-scene-interaction-map";
import type { NativeSceneResizeHandle } from "../../lib/presentation-native-geometry";

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
    contains: (target: { parentElement?: unknown } | null) => {
      let element = target;
      while (element) {
        if (element === root) return true;
        element = element.parentElement as typeof element;
      }
      return false;
    },
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
  const onArrangeSelection = vi.fn();
  const original = fixture();
  let scene = original;
  let tree: ReactElement<Record<string, any>>;
  let canEdit = true;
  let locale: SupportedLocale = "en-CA";
  let selection = selectedNodeIds;
  function render(next = scene, flush = true) {
    scene = next;
    hooks.cursor = 0;
    mocked.hooks = hooks;
    try {
      tree = NativeSceneCanvas({
        scene,
        locale,
        canEdit,
        renderImage: () => null,
        selectedNodeIds: selection,
        onSelect,
        onChange,
        onEditInteraction,
        onArrangeSelection,
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
      target: root,
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
    setCanEdit: (value: boolean) => {
      canEdit = value;
    },
    setLocale: (value: SupportedLocale) => {
      locale = value;
    },
    setSelection: (value: string[]) => {
      selection = value;
    },
    tree: () => tree,
    onChange,
    onSelect,
    onEditInteraction,
    onArrangeSelection,
    root,
    event,
    render,
    view,
    controls: () => elements(tree).find((child) => child.type === NativeSceneSelectionControls)!,
    interactionMap: () => elements(tree).find((child) => child.type === NativeSceneInteractionMap)!,
    start: (
      ev = event(),
      id = "body",
      resize = false,
      handle = true,
      resizeHandle?: NativeSceneResizeHandle,
    ) => view().props.onNodePointerDown(ev, id, resize, handle, resizeHandle),
    move: (ev = event({ clientX: 200, clientY: 150 })) => tree.props.onPointerMove(ev),
    finish: (ev = event({ clientX: 200, clientY: 150 })) => tree.props.onPointerUp(ev),
    cancel: (kind: "onPointerCancel" | "onLostPointerCapture") => tree.props[kind](event()),
    escape: () => tree.props.onKeyDown(event({ key: "Escape" })),
    key: (key = "ArrowRight", overrides: Record<string, unknown> = {}) => {
      const ev = event({ key, ...overrides });
      tree.props.onKeyDown(ev);
      return ev;
    },
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

/** A small DOM stand-in keeps these event-boundary tests independent of a browser renderer. */
class KeyboardTarget {
  parentElement: KeyboardTarget | null = null;
  scrollWidth = 100;
  clientWidth = 100;
  scrollHeight = 100;
  clientHeight = 100;
  overflowX = "visible";
  overflowY = "visible";
  isContentEditable = false;
  constructor(
    private tag = "div",
    private attributes: Record<string, string> = {},
  ) {}
  getAttribute(name: string) {
    return this.attributes[name] ?? null;
  }
  closest(selectors: string): KeyboardTarget | null {
    for (const selector of selectors.split(",").map((value) => value.trim())) {
      if (selector === "[contenteditable]:not([contenteditable='false'])") {
        if (
          this.attributes.contenteditable !== undefined &&
          this.attributes.contenteditable !== "false"
        )
          return this;
      } else if (selector.startsWith("[")) {
        const [, name, value] = selector.match(/^\[([^=\]]+)(?:='([^']*)')?\]$/) ?? [];
        if (
          name &&
          this.attributes[name] !== undefined &&
          (value === undefined || this.attributes[name] === value)
        )
          return this;
      } else if (this.tag === selector) return this;
    }
    return this.parentElement instanceof KeyboardTarget
      ? this.parentElement.closest(selectors)
      : null;
  }
}

function keyboardHarness(selectedNodeIds = ["body", "shape"]) {
  const editor = harness(selectedNodeIds);
  vi.stubGlobal("Element", KeyboardTarget);
  vi.stubGlobal("HTMLElement", KeyboardTarget);
  Object.assign(window, {
    getComputedStyle: (target: KeyboardTarget) => ({
      overflowX: target.overflowX,
      overflowY: target.overflowY,
    }),
  });
  return {
    ...editor,
    element: (
      tag = "div",
      attributes: Record<string, string> = {},
      parent: KeyboardTarget | typeof editor.root = editor.root,
    ) => {
      const target = new KeyboardTarget(tag, attributes);
      target.parentElement = parent as KeyboardTarget;
      return target;
    },
  };
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
    expect(editor.view().props.showSelectionHandles).toBe(true);
    expect(elements(editor.controls()).some((node) => node.type === NativeSceneView)).toBe(false);
    expect(editor.controls().props.selectedNodeIds).toEqual(["body", "shape"]);
  });

  it("drags an object's body immediately and preserves an existing multiselection", () => {
    const editor = harness();
    editor.start(editor.event(), "shape", false, false);
    editor.finish(editor.event({ clientX: 150, clientY: 125, altKey: true }));
    expect(editor.onSelect).not.toHaveBeenCalled();
    expect(editor.onChange).toHaveBeenCalledOnce();
    expect(frame(editor.onChange.mock.calls[0]![0])).toMatchObject({ x: 15, y: 45 });
    expect(frame(editor.onChange.mock.calls[0]![0], "shape")).toMatchObject({ x: 65, y: 45 });
  });

  it.each(["nw", "n", "ne", "e", "se", "s", "sw", "w"] as const)(
    "previews the direct %s handle locally and commits the release position once",
    (handle) => {
      const editor = harness(["body"]);
      const horizontal = handle.includes("w") ? -1 : handle.includes("e") ? 1 : 0;
      const vertical = handle.includes("n") ? -1 : handle.includes("s") ? 1 : 0;
      editor.start(editor.event(), "body", true, true, handle);
      editor.move(editor.event({ clientX: 100 + horizontal * 20, clientY: 100 + vertical * 10 }));
      editor.render();
      expect(editor.onChange).not.toHaveBeenCalled();
      expect(frame(editor.view().props.scene).width).toBe(20 + Math.abs(horizontal) * 2);
      editor.finish(editor.event({ clientX: 100 + horizontal * 40, clientY: 100 + vertical * 20 }));
      expect(editor.onChange).toHaveBeenCalledOnce();
      expect(frame(editor.onChange.mock.calls[0]![0]).width).toBe(20 + Math.abs(horizontal) * 4);
      expect(frame(editor.onChange.mock.calls[0]![0]).height).toBe(20 + Math.abs(vertical) * 4);
      editor.finish();
      expect(editor.onChange).toHaveBeenCalledOnce();
    },
  );

  it("scales a multiselection from a direct corner and retains keyboard handle geometry", () => {
    const editor = harness();
    editor.start(editor.event(), "shape", true, true, "nw");
    editor.finish(editor.event({ clientX: 175, clientY: 112.5 }));
    const result = editor.onChange.mock.calls[0]![0] as PresentationScene;
    expect(frame(result).width).toBeCloseTo(18);
    expect(frame(result, "shape").width).toBeCloseTo(22.5);
    expect(frame(result, "shape").x + frame(result, "shape").width).toBeCloseTo(85);
    expect(frame(result, "shape").y + frame(result, "shape").height).toBeCloseTo(65);
    editor.view().props.onGeometryKey("shape", 0, -1, true, "n");
    expect(editor.onChange).toHaveBeenCalledTimes(2);
    expect(frame(editor.onChange.mock.calls[1]![0]).width).toBeCloseTo(20.8);
  });

  it("preserves interactive descendants and native content scrolling while still selecting their object", () => {
    class Target {
      parentElement: Target | null = null;
      scrollWidth = 100;
      clientWidth = 100;
      scrollHeight = 100;
      clientHeight = 100;
      constructor(public interactive = false) {}
      closest() {
        return this.interactive ? this : null;
      }
    }
    vi.stubGlobal("Element", Target);
    vi.stubGlobal("HTMLElement", Target);
    const editor = harness(["body"]);
    Object.assign(window, { getComputedStyle: () => ({ overflowX: "auto", overflowY: "auto" }) });
    const linked = editor.event({ target: new Target(true) });
    editor.start(linked, "shape", false, false);
    expect(linked.preventDefault).not.toHaveBeenCalled();
    expect(editor.onSelect).toHaveBeenCalledWith("shape");
    const scroll = new Target();
    scroll.scrollHeight = 200;
    const content = new Target();
    content.parentElement = scroll;
    const scrolling = editor.event({ target: content });
    editor.start(scrolling, "body", false, false);
    expect(scrolling.preventDefault).not.toHaveBeenCalled();
    expect(editor.root.setPointerCapture).not.toHaveBeenCalled();
    // Explicit handles are separate from content and always take the resize gesture.
    editor.start(editor.event({ target: scroll }), "body", true, true, "e");
    expect(editor.root.setPointerCapture).toHaveBeenCalledOnce();
  });

  it("moves a scrollable object's selection border directly, preserving its interior guard and committing once", () => {
    class ScrollTarget {
      parentElement = null;
      scrollWidth = 200;
      clientWidth = 100;
      scrollHeight = 200;
      clientHeight = 100;
      closest() {
        return null;
      }
    }
    vi.stubGlobal("Element", ScrollTarget);
    vi.stubGlobal("HTMLElement", ScrollTarget);
    const editor = harness(["body"]);
    Object.assign(window, { getComputedStyle: () => ({ overflowX: "auto", overflowY: "auto" }) });
    const content = new ScrollTarget();
    editor.start(editor.event({ target: content }), "body", false, false);
    editor.move();
    editor.finish();
    expect(editor.root.setPointerCapture).not.toHaveBeenCalled();
    expect(editor.onChange).not.toHaveBeenCalled();
    // Selection-border strips call the same move operation as an explicit pointer handle.
    editor.start(editor.event({ target: content }), "body", false, true);
    editor.move(editor.event({ clientX: 130, clientY: 110, altKey: true }));
    editor.render();
    expect(frame(editor.view().props.scene)).toMatchObject({ x: 13, y: 42 });
    expect(editor.onChange).not.toHaveBeenCalled();
    editor.finish(editor.event({ clientX: 150, clientY: 125, altKey: true }));
    editor.finish();
    expect(editor.onChange).toHaveBeenCalledOnce();
    expect(frame(editor.onChange.mock.calls[0]![0])).toEqual({
      x: 15,
      y: 45,
      width: 20,
      height: 20,
    });
    expect(frame(editor.onChange.mock.calls[0]![0], "shape")).toEqual(
      frame(editor.original, "shape"),
    );
  });

  it("keeps the selection strip bound to the original scene during previews and cancels before changing selection", () => {
    const editor = harness();
    editor.start(editor.event(), "shape", true, true, "se");
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

  it("resizes a persistent group from a direct handle proportionally and commits only on release", () => {
    const editor = harness();
    const scene = {
      ...editor.original,
      schemaVersion: 4 as const,
      groups: [{ id: "group", nodeIds: ["body", "shape"] }],
    };
    editor.render(scene);
    editor.start(editor.event(), "shape", true, true, "se");
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

  it("keeps canvas keyboard movement and direct keyboard resize available in phone reading mode", () => {
    const editor = harness(["body"]);
    editor.setNarrow();
    editor.start(editor.event({ pointerType: "touch" }), "body", true, true, "se");
    expect(editor.root.setPointerCapture).not.toHaveBeenCalled();
    editor.key("ArrowRight", { shiftKey: true });
    expect(frame(editor.onChange.mock.calls[0]![0]).x).toBe(15);
    editor.view().props.onGeometryKey("body", 0, 1, true, "s");
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
      editor.start(editor.event(), "body", true, true, "nw");
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

  it("fences captured body, resize and keyboard handlers immediately when the source changes", () => {
    const editor = harness();
    const ownerStart = editor.view().props.onNodePointerDown;
    const ownerKey = editor.view().props.onGeometryKey;
    const ownerFinish = editor.tree().props.onPointerUp;
    editor.start(editor.event(), "body", true, true, "nw");
    editor.move();
    const recovered = { ...editor.original, nodes: [...editor.original.nodes] };
    editor.render(recovered, false);
    ownerFinish(editor.event({ clientX: 250 }));
    ownerKey("body", 4, 0, true, "e");
    ownerStart(editor.event(), "body", false, false);
    expect(editor.onChange).not.toHaveBeenCalled();
    editor.render(recovered);
    expect(editor.view().props.scene).toBe(recovered);
    expect(editor.root.releasePointerCapture).toHaveBeenCalledWith(7);
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

describe("native canvas permission boundaries", () => {
  it("discards an in-flight preview on permission loss and fences captured geometry handlers before effects", () => {
    const current = harness();
    const ownerStart = current.view().props.onNodePointerDown;
    const ownerKey = current.view().props.onGeometryKey;
    const ownerFinish = current.tree().props.onPointerUp;
    current.start(current.event(), "body", true, true, "e");
    current.move();
    current.render();
    expect(current.view().props.scene).not.toBe(current.original);
    current.setCanEdit(false);
    current.render(current.original, false);
    expect(current.view().props.scene).toBe(current.original);
    expect(current.view().props.showSelectionHandles).toBe(false);
    expect(current.controls().props.disabled).toBe(true);
    ownerFinish(current.event({ clientX: 240 }));
    ownerKey("body", 5, 0, false);
    ownerStart(current.event(), "body", false, true);
    expect(current.onChange).not.toHaveBeenCalled();
    expect(current.root.releasePointerCapture).toHaveBeenCalledWith(7);
    current.controls().props.onSelect("shape");
    expect(current.onSelect).toHaveBeenCalledWith("shape");
    current.interactionMap().props.onExpandedChange(true);
    current.render();
    expect(current.interactionMap().props.expanded).toBe(true);
    current.interactionMap().props.onEdit("shape");
    expect(current.onEditInteraction).toHaveBeenCalledWith("shape");
    expect(current.onChange).not.toHaveBeenCalled();
    current.setCanEdit(true);
    current.render();
    current.key();
    expect(current.onChange).toHaveBeenCalledOnce();
    expect(frame(current.onChange.mock.calls[0]![0]).x).toBe(11);
  });
});

describe("native canvas selection arrow keys", () => {
  it("makes the canvas a localized keyboard stop with group semantics", () => {
    const editor = harness();
    expect(editor.tree().props.tabIndex).toBe(0);
    expect(editor.tree().props.role).toBe("group");
    expect(editor.tree().props["aria-label"]).toBe("Slide canvas");
    expect(editor.tree().props["aria-description"]).toContain("arrow keys");
    editor.setLocale("ko-KR");
    editor.render();
    expect(editor.tree().props.lang).toBe("ko-KR");
    expect(editor.tree().props["aria-label"]).not.toBe("Slide canvas");
    expect(editor.tree().props["aria-description"]).not.toContain("arrow keys");
  });

  it.each([
    ["ArrowRight", false, 1, 0],
    ["ArrowLeft", false, -1, 0],
    ["ArrowDown", false, 0, 1],
    ["ArrowUp", false, 0, -1],
    ["ArrowRight", true, 5, 0],
    ["ArrowUp", true, 0, -5],
  ])("moves the whole selection once for %s with Shift=%s", (key, shiftKey, dx, dy) => {
    const editor = harness();
    const ev = editor.key(String(key), { shiftKey });
    expect(ev.preventDefault).toHaveBeenCalledOnce();
    expect(ev.stopPropagation).toHaveBeenCalledOnce();
    expect(editor.onChange).toHaveBeenCalledOnce();
    const result = editor.onChange.mock.calls[0]![0] as PresentationScene;
    expect(frame(result)).toEqual({
      x: 10 + Number(dx),
      y: 40 + Number(dy),
      width: 20,
      height: 20,
    });
    expect(frame(result, "shape")).toEqual({
      x: 60 + Number(dx),
      y: 40 + Number(dy),
      width: 25,
      height: 25,
    });
    expect(frame(result, "title")).toBe(frame(editor.original, "title"));
    expect(editor.onSelect).not.toHaveBeenCalled();
    expect(editor.view().props.scene).toBe(editor.original);
    expect(editor.root.setPointerCapture).not.toHaveBeenCalled();
  });

  it("uses the latest committed scene on each key press and keeps group members together at bounds", () => {
    const editor = keyboardHarness(["body"]);
    const scene: PresentationScene = {
      ...editor.original,
      schemaVersion: 4,
      groups: [{ id: "group", nodeIds: ["body", "shape"] }],
      nodes: editor.original.nodes.map((node) =>
        node.id === "shape" && node.type !== "connector"
          ? { ...node, frame: { ...node.frame, x: 73 } }
          : node,
      ),
    };
    editor.render(scene);
    // A selected persistent group's member is selected chrome even when only its peer is explicit.
    const member = editor.element("div", { "data-node-id": "shape" });
    editor.key("ArrowRight", { shiftKey: true, target: member });
    const result = editor.onChange.mock.calls[0]![0] as PresentationScene;
    expect(frame(result).x).toBe(12);
    expect(frame(result, "shape").x).toBe(75);
    expect(result.groups).toBe(scene.groups);
    expect(result.readingOrder).toBe(scene.readingOrder);
    editor.render(result);
    editor.onChange.mockClear();
    const boundary = editor.key("ArrowRight");
    expect(boundary.preventDefault).toHaveBeenCalledOnce();
    expect(editor.onChange).not.toHaveBeenCalled();
    editor.key("ArrowLeft");
    expect(frame(editor.onChange.mock.calls[0]![0]).x).toBe(11);
  });

  it("accepts selected object chrome and selection outlines, while ignoring unrelated descendants", () => {
    const editor = keyboardHarness();
    const object = editor.element("div", { "data-node-id": "body" });
    const content = editor.element("span", {}, object);
    editor.key("ArrowRight", { target: content });
    const outline = editor.element("div", { "data-native-selection-outline": "true" });
    const border = editor.element("span", { "data-native-move-border": "n" }, outline);
    editor.key("ArrowRight", { target: border });
    expect(editor.onChange).toHaveBeenCalledTimes(2);
    for (const target of [
      editor.element("p"),
      editor.element("div", { "data-node-id": "title" }),
      new KeyboardTarget("div", { "data-node-id": "body" }),
    ]) {
      const ev = editor.key("ArrowRight", { target });
      expect(ev.preventDefault).not.toHaveBeenCalled();
    }
    expect(editor.onChange).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["select", {}],
    ["input", {}],
    ["textarea", {}],
    ["button", {}],
    ["a", { href: "/preview" }],
    ["details", {}],
    ["summary", {}],
    ["div", { contenteditable: "true" }],
    ["div", { contenteditable: "" }],
    ["div", { contenteditable: "plaintext-only" }],
    ["div", { role: "textbox" }],
    ["div", { role: "slider" }],
    ["span", { "data-native-resize-handle": "se" }],
  ])("leaves %s keyboard behavior with the focused descendant", (tag, attributes) => {
    const editor = keyboardHarness(["body"]);
    const object = editor.element("div", { "data-node-id": "body" });
    const control = editor.element(tag, attributes, object);
    const descendant = editor.element("span", {}, control);
    const ev = editor.key("ArrowRight", { target: descendant });
    expect(ev.preventDefault).not.toHaveBeenCalled();
    expect(ev.stopPropagation).not.toHaveBeenCalled();
    expect(editor.onChange).not.toHaveBeenCalled();
    expect(editor.onSelect).not.toHaveBeenCalled();
  });

  it.each(["overflowX", "overflowY"] as const)(
    "preserves keyboard scrolling for %s content",
    (axis) => {
      const editor = keyboardHarness(["body"]);
      const object = editor.element("div", { "data-node-id": "body" });
      const scroll = editor.element("div", {}, object);
      scroll[axis] = "auto";
      scroll.scrollWidth = 200;
      scroll.scrollHeight = 200;
      const text = editor.element("span", {}, scroll);
      const ev = editor.key("ArrowDown", { target: text });
      expect(ev.preventDefault).not.toHaveBeenCalled();
      expect(editor.onChange).not.toHaveBeenCalled();
    },
  );

  it.each([
    { ctrlKey: true },
    { metaKey: true },
    { altKey: true },
    { nativeEvent: { isComposing: true } },
    { nativeEvent: { keyCode: 229 } },
    { defaultPrevented: true },
  ])("ignores modified, composing and already-handled keys: %j", (overrides) => {
    const editor = harness(["body"]);
    const ev = editor.key("ArrowRight", overrides);
    expect(ev.preventDefault).not.toHaveBeenCalled();
    expect(editor.onChange).not.toHaveBeenCalled();
  });

  it.each([{ selection: [] }, { selection: ["missing"] }, { selection: ["connection"] }])(
    "does not create an edit for an immovable selection $selection",
    ({ selection }) => {
      const editor = harness(selection);
      const scene: PresentationScene = {
        ...editor.original,
        nodes: [
          ...editor.original.nodes,
          {
            id: "connection",
            type: "connector",
            from: { nodeId: "body", anchor: "right" },
            to: { nodeId: "shape", anchor: "left" },
            label: "Connection",
            color: "blue",
          },
        ],
        readingOrder: [...editor.original.readingOrder, "connection"],
      };
      editor.render(scene);
      const ev = editor.key();
      expect(ev.preventDefault).not.toHaveBeenCalled();
      expect(editor.onChange).not.toHaveBeenCalled();
    },
  );

  it("ignores keys during pointer gestures without cancelling the preview or capture", () => {
    const editor = harness(["body"]);
    editor.start();
    editor.move(editor.event({ clientX: 130, clientY: 110, altKey: true }));
    editor.render();
    const preview = editor.view().props.scene;
    const ev = editor.key("ArrowRight");
    editor.render();
    expect(ev.preventDefault).not.toHaveBeenCalled();
    expect(editor.onChange).not.toHaveBeenCalled();
    expect(editor.view().props.scene).toBe(preview);
    expect(editor.root.releasePointerCapture).not.toHaveBeenCalled();
    editor.finish(editor.event({ clientX: 150, clientY: 125, altKey: true }));
    expect(editor.onChange).toHaveBeenCalledOnce();
    expect(frame(editor.onChange.mock.calls[0]![0]).x).toBe(15);
  });

  it("fences stale scene, selection and permission handlers before effects", () => {
    const editor = harness(["body"]);
    const oldSceneKey = editor.tree().props.onKeyDown;
    const recovered = { ...editor.original, nodes: [...editor.original.nodes] };
    editor.render(recovered, false);
    oldSceneKey(editor.event({ key: "ArrowRight" }));
    const oldSelectionKey = editor.tree().props.onKeyDown;
    editor.setSelection(["shape"]);
    editor.render(recovered, false);
    oldSelectionKey(editor.event({ key: "ArrowRight" }));
    const oldPermissionKey = editor.tree().props.onKeyDown;
    editor.setCanEdit(false);
    editor.render(recovered, false);
    oldPermissionKey(editor.event({ key: "ArrowRight" }));
    editor.key();
    expect(editor.onChange).not.toHaveBeenCalled();
    editor.setCanEdit(true);
    editor.render(recovered);
    editor.key();
    expect(editor.onChange).toHaveBeenCalledOnce();
    expect(frame(editor.onChange.mock.calls[0]![0], "shape").x).toBe(61);
  });

  it("cancels a pointer preview when opening Arrange and keeps the callback outside history", () => {
    const editor = harness();
    expect(editor.controls().props.onPointerDown).toBeUndefined();
    expect(editor.controls().props.onGeometryKey).toBeUndefined();
    editor.start();
    editor.move();
    editor.controls().props.onArrange();
    editor.render();
    expect(editor.onArrangeSelection).toHaveBeenCalledOnce();
    expect(editor.view().props.scene).toBe(editor.original);
    expect(editor.root.releasePointerCapture).toHaveBeenCalledWith(7);
    editor.finish();
    expect(editor.onChange).not.toHaveBeenCalled();
  });
});
