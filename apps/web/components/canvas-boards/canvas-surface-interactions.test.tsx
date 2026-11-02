import { isValidElement, type ReactElement, type ReactNode } from "react";
import type * as ReactModule from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CanvasObjectSchema } from "@openround/contracts";
import english from "../../lib/i18n/domains/idea-boards/en-CA";
import { CanvasReadOnlySurface, CanvasSurface } from "./canvas-surface";
import { canvasObject } from "./canvas-test-fixtures";
interface Hooks {
  cursor: number;
  slots: unknown[];
}
const mocked = vi.hoisted(() => ({ hooks: null as Hooks | null }));
vi.mock("react", async (original) => {
  const react = await original<typeof ReactModule>();
  return {
    ...react,
    useState: <T,>(initial: T | (() => T)) => {
      if (!mocked.hooks) return react.useState(initial);
      const hooks = mocked.hooks,
        index = hooks.cursor++;
      if (!(index in hooks.slots))
        hooks.slots[index] = typeof initial === "function" ? (initial as () => T)() : initial;
      return [
        hooks.slots[index],
        (value: T | ((old: T) => T)) => {
          hooks.slots[index] =
            typeof value === "function" ? (value as (old: T) => T)(hooks.slots[index] as T) : value;
        },
      ];
    },
    useRef: <T,>(initial: T) => {
      if (!mocked.hooks) return react.useRef(initial);
      const hooks = mocked.hooks,
        index = hooks.cursor++;
      hooks.slots[index] ??= { current: initial };
      return hooks.slots[index];
    },
    useId: () => (mocked.hooks ? "canvas-id-" + mocked.hooks.cursor++ : react.useId()),
    useEffect: (effect: ReactModule.EffectCallback, dependencies?: readonly unknown[]) => {
      if (!mocked.hooks) react.useEffect(effect, dependencies);
    },
  };
});
vi.mock("../locale-provider", () => ({
  useLocale: () => ({ t: (key: keyof typeof english) => english[key] ?? key }),
}));
class Target {
  constructor(
    readonly id: string | null = null,
    readonly resize = false,
    readonly port: string | null = null,
  ) {}
  closest(selector: string) {
    return selector === "[data-canvas-object]" && this.id ? this : null;
  }
  getAttribute(name: string) {
    return name === "data-canvas-object" ? this.id : name === "data-canvas-port" ? this.port : null;
  }
  hasAttribute(name: string) {
    return name === "data-canvas-resize" && this.resize;
  }
}
function findElement(
  node: ReactNode,
  predicate: (element: ReactElement<Record<string, unknown>>) => boolean,
): ReactElement<Record<string, unknown>> | undefined {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findElement(child, predicate);
      if (found) return found;
    }
    return;
  }
  if (!isValidElement<Record<string, unknown>>(node)) return;
  return predicate(node) ? node : findElement(node.props.children as ReactNode, predicate);
}
function harness(props: Partial<Parameters<typeof CanvasSurface>[0]> = {}) {
  const hooks: Hooks = { cursor: 0, slots: [] };
  let tree: ReactNode;
  const viewport = vi.fn(),
    onSelect = vi.fn(),
    onSelectMany = vi.fn(),
    onTransform = vi.fn().mockResolvedValue(true),
    onCreatePen = vi.fn().mockResolvedValue(true),
    onGestureActive = vi.fn(),
    onCreateConnector = vi.fn().mockResolvedValue(true),
    onErasePen = vi.fn().mockResolvedValue(true),
    onCommitText = vi.fn().mockResolvedValue(true),
    onTextEditingChange = vi.fn();
  const handlers = {
    onSelect,
    onSelectMany,
    onTransform,
    onCreatePen,
    onGestureActive,
    onCreateConnector,
    onErasePen,
    onCommitText,
    onTextEditingChange,
  };
  const view = {
    viewport,
    ...handlers,
    render() {
      hooks.cursor = 0;
      mocked.hooks = hooks;
      try {
        tree = CanvasSurface({
          objects: [canvasObject],
          viewport: { x: 0, y: 0, zoom: 1 },
          onViewport: viewport,
          canEdit: true,
          tool: "select",
          selectedIds: [canvasObject.id],
          ...handlers,
          ...props,
        });
      } finally {
        mocked.hooks = null;
      }
      return renderToStaticMarkup(tree);
    },
    event(
      name: string,
      x: number,
      y: number,
      target = new Target(canvasObject.id),
      pointerId = 1,
      shiftKey = false,
    ) {
      const node = tree as ReactElement<Record<string, unknown>>;
      const handler = node.props[name] as (event: unknown) => void;
      handler({
        button: 0,
        pointerId,
        clientX: x,
        clientY: y,
        target,
        shiftKey,
        ctrlKey: false,
        metaKey: false,
        preventDefault: vi.fn(),
        currentTarget: { setPointerCapture: vi.fn() },
      });
    },
    find(predicate: (element: ReactElement<Record<string, unknown>>) => boolean) {
      return findElement(tree, predicate);
    },
  };
  return view;
}
async function settle() {
  for (let index = 0; index < 12; index++) await Promise.resolve();
}
beforeEach(() => {
  vi.stubGlobal("Element", Target);
});
describe("read-only canvas outline", () => {
  it("exposes image descriptions and explicit safe links when the outline is opened", () => {
    const image = CanvasObjectSchema.parse({
      ...canvasObject,
      type: "image",
      text: "",
      mediaId: "00000000-0000-4000-8000-000000000099",
      altText: "A diagram of the workshop priorities",
    });
    const link = CanvasObjectSchema.parse({
      ...canvasObject,
      id: "00000000-0000-4000-8000-000000000098",
      type: "link",
      text: "Workshop guide",
      url: "https://docs.example.test/guide",
    });
    if (image.type !== "image" || link.type !== "link") throw new Error("Invalid fixture");
    const hooks: Hooks = { cursor: 0, slots: [] };
    function render() {
      hooks.cursor = 0;
      mocked.hooks = hooks;
      try {
        return CanvasReadOnlySurface({ objects: [image, link] });
      } finally {
        mocked.hooks = null;
      }
    }
    const tree = render();
    const toggle = findElement(
      tree,
      (element) => element.type === "button" && element.props.children === "Object outline",
    );
    expect(toggle?.props["aria-expanded"]).toBe(false);
    (toggle!.props.onClick as () => void)();
    const outlined = render();
    const html = renderToStaticMarkup(outlined);
    expect(html).toContain(image.altText);
    expect(html).not.toContain(image.mediaId);
    expect(html).toContain("docs.example.test");
    const anchor = findElement(outlined, (element) => element.type === "a")!;
    expect(anchor.props).toMatchObject({
      href: link.url,
      target: "_blank",
      rel: "noopener noreferrer",
      referrerPolicy: "no-referrer",
      children: "Workshop guide",
    });
  });
});
afterEach(() => {
  mocked.hooks = null;
  vi.unstubAllGlobals();
});
describe("canvas productivity pointer paths", () => {
  it.each([30, 45, 90, -45])(
    "previews and finishes a non-square %s-degree resize from its model bounds",
    async (rotation) => {
      const rotated = CanvasObjectSchema.parse({
        ...canvasObject,
        x: 120,
        y: 80,
        width: 240,
        height: 90,
        rotation,
        version: 7,
      });
      const view = harness({
        objects: [rotated],
        viewport: { x: 40, y: 60, zoom: 2 },
      });
      view.render();
      const handle = new Target(rotated.id, true);
      view.event("onPointerDown", 600, 400, handle);
      view.event("onPointerMove", 660, 420, handle);
      view.render();
      const preview = view.find((element) => element.props["data-canvas-object"] === rotated.id)!;
      expect(preview.props.transform).toBe(`translate(120 80) rotate(${rotation} 135 50)`);
      const rectangle = findElement(
        preview,
        (element) => element.type === "rect" && !element.props["data-canvas-resize"],
      )!;
      expect(rectangle.props).toMatchObject({ width: 270, height: 100 });
      // The final pointer-up may arrive beyond the most recent pointer-move frame.
      view.event("onPointerUp", 700, 440, handle);
      await settle();
      expect(view.onTransform).toHaveBeenCalledExactlyOnceWith(
        [rotated.id],
        { type: "resize", bounds: { x: 120, y: 80, width: 290, height: 110 } },
        [rotated],
      );
      expect(view.onGestureActive).toHaveBeenLastCalledWith(false);
    },
  );
  it("does not jump a rotated object on a stationary resize contact", () => {
    const rotated = CanvasObjectSchema.parse({
      ...canvasObject,
      x: 120,
      y: 80,
      width: 240,
      height: 90,
      rotation: -30,
    });
    const view = harness({ objects: [rotated] });
    view.render();
    const handle = new Target(rotated.id, true);
    view.event("onPointerDown", 300, 200, handle);
    view.event("onPointerMove", 300, 200, handle);
    view.render();
    const preview = view.find((element) => element.props["data-canvas-object"] === rotated.id)!;
    expect(preview.props.transform).toBe("translate(120 80) rotate(-30 120 45)");
    const rectangle = findElement(
      preview,
      (element) => element.type === "rect" && !element.props["data-canvas-resize"],
    )!;
    expect(rectangle.props).toMatchObject({ width: 240, height: 90 });
    view.event("onPointerCancel", 300, 200, handle);
    expect(view.onTransform).not.toHaveBeenCalled();
  });
  it("keeps an existing selection unchanged on first contact and allows a second contact to pinch", async () => {
    const view = harness();
    view.render();
    view.event("onPointerDown", 30, 40);
    view.event("onPointerDown", 70, 40, new Target(canvasObject.id), 2);
    view.event("onPointerMove", 10, 40);
    view.event("onPointerMove", 90, 40, new Target(canvasObject.id), 2);
    expect(view.onSelect).not.toHaveBeenCalled();
    expect(view.viewport).toHaveBeenLastCalledWith(expect.objectContaining({ zoom: 2 }));
    view.event("onPointerUp", 10, 40);
    view.event("onPointerUp", 90, 40, new Target(canvasObject.id), 2);
    await settle();
    expect(view.onTransform).not.toHaveBeenCalled();
    expect(view.onGestureActive).toHaveBeenLastCalledWith(false);
  });
  it("retains the pointer-down versions and one final move proposal for the whole selection", async () => {
    const view = harness();
    view.render();
    view.event("onPointerDown", 30, 40);
    view.event("onPointerMove", 60, 60);
    view.event("onPointerUp", 60, 60);
    await settle();
    expect(view.onTransform).toHaveBeenCalledOnce();
    expect(view.onTransform).toHaveBeenCalledWith(
      [canvasObject.id],
      { type: "move", dx: 30, dy: 20 },
      [canvasObject],
    );
  });
  it("selects several contained objects through an explicit touch area tool", async () => {
    const view = harness({ tool: "marquee" });
    view.render();
    view.event("onPointerDown", 0, 0, new Target());
    view.event("onPointerMove", 400, 400, new Target());
    view.event("onPointerUp", 400, 400, new Target());
    await settle();
    expect(view.onSelectMany).toHaveBeenCalledWith([canvasObject.id], false);
    expect(view.onTransform).not.toHaveBeenCalled();
  });
  it("saves an explicit freehand stroke once, while cancellation or a second contact never draws", async () => {
    const view = harness({ tool: "pen" });
    view.render();
    view.event("onPointerDown", 0, 0, new Target());
    view.event("onPointerMove", 40, 30, new Target());
    view.event("onPointerMove", 80, 60, new Target());
    view.event("onPointerUp", 80, 60, new Target());
    await settle();
    expect(view.onCreatePen).toHaveBeenCalledOnce();
    expect(view.onCreatePen.mock.calls[0]![0]).toEqual([
      [0, 0],
      [40, 30],
      [80, 60],
    ]);
    const cancelled = harness({ tool: "pen" });
    cancelled.render();
    cancelled.event("onPointerDown", 0, 0, new Target());
    cancelled.event("onPointerMove", 40, 30, new Target());
    cancelled.event("onPointerCancel", 40, 30, new Target());
    cancelled.event("onPointerUp", 40, 30, new Target());
    await settle();
    expect(cancelled.onCreatePen).not.toHaveBeenCalled();
    const pinch = harness({ tool: "pen" });
    pinch.render();
    pinch.event("onPointerDown", 0, 0, new Target());
    pinch.event("onPointerMove", 40, 30, new Target());
    pinch.event("onPointerDown", 80, 30, new Target(), 2);
    pinch.event("onPointerUp", 40, 30, new Target());
    await settle();
    expect(pinch.onCreatePen).not.toHaveBeenCalled();
  });
});

describe("canvas direct creation and editing", () => {
  it.each(["pen", "connector"] as const)(
    "keeps text editable at capacity while blocking %s creation and connection handles",
    async (tool) => {
      const connect = vi.fn();
      const view = harness({ tool, canEdit: true, canCreate: false, onConnect: connect });
      view.render();
      expect(view.find((element) => Boolean(element.props["data-canvas-port"]))).toBeUndefined();
      view.event("onPointerDown", 50, 50);
      view.event("onPointerMove", 100, 100);
      view.event("onPointerUp", 100, 100);
      view.event("onPointerDown", 400, 400, new Target());
      view.event("onPointerUp", 500, 500, new Target());
      await settle();
      expect(connect).not.toHaveBeenCalled();
      expect(view.onCreatePen).not.toHaveBeenCalled();
      expect(view.onCreateConnector).not.toHaveBeenCalled();
      view.event("onDoubleClick", 60, 60);
      view.render();
      const textarea = view.find((element) => element.type === "textarea")!;
      (textarea.props.onChange as (event: unknown) => void)({
        target: { value: "Edited at capacity" },
      });
      view.render();
      (
        view.find((element) => element.type === "textarea")!.props.onKeyDown as (
          event: unknown,
        ) => void
      )({
        key: "Enter",
        ctrlKey: true,
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
      });
      await settle();
      expect(view.onCommitText).toHaveBeenCalledExactlyOnceWith(canvasObject, "Edited at capacity");
    },
  );

  it("drags a connector from a rotated object's port to another node and keeps click-to-connect", async () => {
    const first = CanvasObjectSchema.parse({ ...canvasObject, rotation: 90 });
    const second = CanvasObjectSchema.parse({
      ...canvasObject,
      id: "00000000-0000-4000-8000-000000000099",
      x: 400,
    });
    const view = harness({ objects: [first, second] });
    view.render();
    // First right port rotates from (220,110) to (120,210).
    view.event("onPointerDown", 120, 210, new Target(first.id, false, "right"));
    view.event("onPointerMove", 400, 110, new Target(second.id));
    view.event("onPointerUp", 400, 110, new Target(second.id));
    await settle();
    expect(view.onCreateConnector).toHaveBeenCalledExactlyOnceWith(
      { objectId: first.id, anchor: "right", x: 120, y: 210 },
      { objectId: second.id, anchor: "left", x: 400, y: 110 },
    );
    expect(view.onTransform).not.toHaveBeenCalled();
    expect(view.onGestureActive).toHaveBeenLastCalledWith(false);
    const connect = vi.fn();
    const click = harness({ tool: "connector", onConnect: connect });
    click.render();
    click.event("onPointerDown", 100, 100);
    expect(connect).toHaveBeenCalledWith(canvasObject.id);
  });
  it.each(["pen", "connector"] as const)(
    "abandons an active %s proposal when creation becomes unavailable",
    async (tool) => {
      const props: Partial<Parameters<typeof CanvasSurface>[0]> = {
        tool,
        objects: [],
        canCreate: true,
      };
      const view = harness(props);
      view.render();
      view.event("onPointerDown", 0, 0, new Target());
      view.event("onPointerMove", 100, 100, new Target());
      props.canCreate = false;
      view.render();
      view.event("onPointerUp", 150, 150, new Target());
      await settle();
      expect(view.onCreatePen).not.toHaveBeenCalled();
      expect(view.onCreateConnector).not.toHaveBeenCalled();
      expect(view.onGestureActive).toHaveBeenLastCalledWith(false);
    },
  );
  it("creates free-point connectors in world coordinates and abandons cancelled/multitouch creation", async () => {
    const view = harness({ tool: "connector", objects: [], viewport: { x: 20, y: 30, zoom: 2 } });
    view.render();
    view.event("onPointerDown", 40, 50, new Target());
    view.event("onPointerUp", 140, 150, new Target());
    await settle();
    expect(view.onCreateConnector).toHaveBeenCalledWith(
      { objectId: null, anchor: "center", x: 10, y: 10 },
      { objectId: null, anchor: "center", x: 60, y: 60 },
    );
    for (const interrupted of ["cancel", "pinch"] as const) {
      const pending = harness({ tool: "connector", objects: [] });
      pending.render();
      pending.event("onPointerDown", 0, 0, new Target());
      if (interrupted === "cancel") pending.event("onPointerCancel", 100, 100, new Target());
      else pending.event("onPointerDown", 100, 100, new Target(), 2);
      pending.event("onPointerUp", 100, 100, new Target());
      await settle();
      expect(pending.onCreateConnector).not.toHaveBeenCalled();
      expect(pending.onGestureActive).toHaveBeenLastCalledWith(false);
    }
  });
  it("erases whole hit strokes once without changing selection or touching locked strokes", async () => {
    const pen = CanvasObjectSchema.parse({
      ...canvasObject,
      type: "pen",
      id: "00000000-0000-4000-8000-000000000099",
      version: 7,
      x: 0,
      y: 0,
      width: 100,
      height: 1,
      points: [
        [0, 0],
        [100, 0],
      ],
    });
    const locked = CanvasObjectSchema.parse({
      ...pen,
      id: "00000000-0000-4000-8000-000000000098",
      locked: true,
    });
    const view = harness({
      tool: "eraser",
      canCreate: false,
      objects: [canvasObject, pen, locked],
    });
    view.render();
    view.event("onPointerDown", 50, -50, new Target());
    view.event("onPointerMove", 50, 50, new Target());
    view.event("onPointerUp", 50, 80, new Target());
    await settle();
    expect(view.onErasePen).toHaveBeenCalledExactlyOnceWith([pen]);
    expect(view.onSelect).not.toHaveBeenCalled();
    expect(view.onSelectMany).not.toHaveBeenCalled();
    const denied = harness({ tool: "eraser", canEdit: false, objects: [pen] });
    denied.render();
    denied.event("onPointerDown", 50, 0, new Target(pen.id));
    denied.event("onPointerUp", 50, 0, new Target(pen.id));
    await settle();
    expect(denied.onErasePen).not.toHaveBeenCalled();
    expect(denied.onSelect).not.toHaveBeenCalled();
  });
  it("never erases a cancelled or multi-contact stroke", async () => {
    const pen = CanvasObjectSchema.parse({
      ...canvasObject,
      type: "pen",
      points: [
        [0, 0],
        [100, 0],
      ],
    });
    for (const interrupted of ["cancel", "pinch"] as const) {
      const view = harness({ tool: "eraser", objects: [pen] });
      view.render();
      view.event("onPointerDown", 50, 0, new Target());
      if (interrupted === "cancel") view.event("onPointerCancel", 50, 0, new Target());
      else view.event("onPointerDown", 70, 0, new Target(), 2);
      view.event("onPointerUp", 80, 0, new Target());
      await settle();
      expect(view.onErasePen).not.toHaveBeenCalled();
      expect(view.onGestureActive).toHaveBeenLastCalledWith(false);
    }
  });
  it("edits plain text using the original version and retains failed saves", async () => {
    const commit = vi.fn().mockResolvedValue(false);
    const view = harness({ onCommitText: commit });
    view.render();
    view.event("onDoubleClick", 60, 60);
    view.render();
    const textarea = view.find((element) => element.type === "textarea")!;
    (textarea.props.onChange as (event: unknown) => void)({
      target: { value: "New <plain> text" },
    });
    view.render();
    const input = view.find((element) => element.type === "textarea")!;
    (input.props.onKeyDown as (event: unknown) => void)({
      key: "Enter",
      ctrlKey: true,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    });
    await settle();
    expect(commit).toHaveBeenCalledExactlyOnceWith(canvasObject, "New <plain> text");
    view.render();
    expect(view.find((element) => element.type === "textarea")!.props.value).toBe(
      "New <plain> text",
    );
    expect(view.onTextEditingChange).toHaveBeenLastCalledWith(true);
    const cancel = view.find((element) => element.type === "textarea")!;
    (cancel.props.onKeyDown as (event: unknown) => void)({
      key: "Escape",
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    });
    expect(view.onTextEditingChange).toHaveBeenLastCalledWith(false);
  });
  it.each(["Save text", "Cancel text edit"])(
    "cancels inline editing with Escape while %s has focus",
    (label) => {
      const view = harness();
      view.render();
      view.event("onDoubleClick", 60, 60);
      view.render();
      (
        view.find((element) => element.type === "textarea")!.props.onChange as (
          event: unknown,
        ) => void
      )({ target: { value: "Unsaved wording" } });
      view.render();
      const wrapper = view.find(
        (element) => element.props["data-canvas-inline-editor"] === "true",
      )!;
      const button = view.find(
        (element) => element.type === "button" && element.props.children === label,
      )!;
      const preventDefault = vi.fn(),
        stopPropagation = vi.fn();
      (wrapper.props.onKeyDown as (event: unknown) => void)({
        key: "Escape",
        target: button,
        preventDefault,
        stopPropagation,
      });
      view.render();
      expect(preventDefault).toHaveBeenCalledOnce();
      expect(stopPropagation).toHaveBeenCalledOnce();
      expect(view.find((element) => element.type === "textarea")).toBeUndefined();
      expect(view.onTextEditingChange).toHaveBeenLastCalledWith(false);
      expect(view.onCommitText).not.toHaveBeenCalled();
      expect(view.onTransform).not.toHaveBeenCalled();
      expect(canvasObject.text).toBe("Synthetic canvas note");
    },
  );
  it("retains a locally edited draft when a remote version replaces or removes its original", async () => {
    const props: Partial<Parameters<typeof CanvasSurface>[0]> = { objects: [canvasObject] };
    const view = harness(props);
    view.render();
    view.event("onDoubleClick", 60, 60);
    view.render();
    (
      view.find((element) => element.type === "textarea")!.props.onChange as (
        event: unknown,
      ) => void
    )({ target: { value: "Keep this text" } });
    props.objects = [
      CanvasObjectSchema.parse({ ...canvasObject, version: 2, text: "Remote text" }),
    ];
    view.render();
    (view.find((element) => element.type === "textarea")!.props.onBlur as (event: unknown) => void)(
      { relatedTarget: null },
    );
    await settle();
    expect(view.onCommitText).not.toHaveBeenCalled();
    props.objects = [];
    view.render();
    expect(view.find((element) => element.type === "textarea")!.props.value).toBe("Keep this text");
    expect(view.onTextEditingChange).toHaveBeenLastCalledWith(true);
  });
});
