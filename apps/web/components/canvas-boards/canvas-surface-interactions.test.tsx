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
  ) {}
  closest(selector: string) {
    return selector === "[data-canvas-object]" && this.id ? this : null;
  }
  getAttribute(name: string) {
    return name === "data-canvas-object" ? this.id : null;
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
    onGestureActive = vi.fn();
  const handlers = { onSelect, onSelectMany, onTransform, onCreatePen, onGestureActive };
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
