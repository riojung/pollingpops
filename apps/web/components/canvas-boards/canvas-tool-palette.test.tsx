import { isValidElement, type ReactElement, type ReactNode } from "react";
import type * as ReactModule from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CanvasShapePreview,
  CanvasToolPalette,
  type CanvasToolPaletteProps,
} from "./canvas-tool-palette";
import { canvasShapeCatalog, defaultCanvasDrawSettings } from "./canvas-tool-catalog";

interface EffectSlot {
  dependencies?: readonly unknown[];
  cleanup?: () => void;
}
interface Hooks {
  cursor: number;
  slots: unknown[];
  pending: (() => void)[];
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
    useId: () => (mocked.hooks ? "palette-" + mocked.hooks.cursor++ : react.useId()),
    useEffect: (effect: ReactModule.EffectCallback, dependencies?: readonly unknown[]) => {
      if (!mocked.hooks) return react.useEffect(effect, dependencies);
      const hooks = mocked.hooks,
        index = hooks.cursor++,
        previous = hooks.slots[index] as EffectSlot | undefined;
      if (
        previous &&
        dependencies?.every((value, position) =>
          Object.is(value, previous.dependencies?.[position]),
        )
      )
        return;
      const slot: EffectSlot = { dependencies };
      hooks.slots[index] = slot;
      hooks.pending.push(() => {
        previous?.cleanup?.();
        const cleanup = effect();
        if (typeof cleanup === "function") slot.cleanup = cleanup;
      });
    },
  };
});
vi.mock("../locale-provider", () => ({ useLocale: () => ({ locale: "en-CA" }) }));

class PaletteNode {
  constructor(readonly inside = true) {}
}
function find(
  node: ReactNode,
  predicate: (element: ReactElement<Record<string, unknown>>) => boolean,
): ReactElement<Record<string, unknown>> | undefined {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = find(child, predicate);
      if (found) return found;
    }
    return;
  }
  if (!isValidElement<Record<string, unknown>>(node)) return;
  return predicate(node) ? node : find(node.props.children as ReactNode, predicate);
}
function nodeText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(nodeText).join("");
  return isValidElement<{ children?: ReactNode }>(node) ? nodeText(node.props.children) : "";
}
const disposals: (() => void)[] = [];
const documentListeners = new Map<string, Set<(event: unknown) => void>>();
beforeEach(() => {
  documentListeners.clear();
  vi.stubGlobal("Node", PaletteNode);
  vi.stubGlobal("document", {
    addEventListener: (name: string, listener: (event: unknown) => void) => {
      if (!documentListeners.has(name)) documentListeners.set(name, new Set());
      documentListeners.get(name)?.add(listener);
    },
    removeEventListener: (name: string, listener: (event: unknown) => void) =>
      documentListeners.get(name)?.delete(listener),
  });
});
afterEach(() => {
  for (const dispose of disposals.splice(0)) dispose();
  vi.unstubAllGlobals();
});

function harness(overrides: Partial<CanvasToolPaletteProps> = {}) {
  const hooks: Hooks = { cursor: 0, slots: [], pending: [] };
  const callbacks = {
    onAdd: vi.fn(),
    onTool: vi.fn(),
    onConnector: vi.fn(),
    onDrawSettings: vi.fn(),
    onUploadSvg: vi.fn(),
    onTemplates: vi.fn(),
    onStickyStack: vi.fn(),
  };
  const props: CanvasToolPaletteProps = {
    activeTool: "select",
    disabled: false,
    drawSettings: defaultCanvasDrawSettings,
    selectedStickyColor: "yellow",
    ...callbacks,
    ...overrides,
  };
  callbacks.onDrawSettings.mockImplementation((settings) => {
    props.drawSettings = settings;
  });
  let tree: ReactNode;
  const focus = vi.fn(),
    initialFocus = vi.fn();
  const initialNode = { focus: initialFocus };
  const trigger = Object.assign(new PaletteNode(), { focus });
  const view = {
    ...callbacks,
    focus,
    initialFocus,
    render() {
      hooks.cursor = 0;
      mocked.hooks = hooks;
      try {
        tree = CanvasToolPalette(props);
      } finally {
        mocked.hooks = null;
      }
      const root = find(tree, (element) => "data-canvas-tool-palette" in element.props);
      if (root)
        (root.props.ref as { current: unknown }).current = {
          contains: (target: PaletteNode) => target.inside,
        };
      const panel = find(tree, (element) => element.props.role === "dialog");
      if (panel)
        (panel.props.ref as { current: unknown }).current = { querySelector: () => initialNode };
      for (const effect of hooks.pending.splice(0)) effect();
      return renderToStaticMarkup(tree);
    },
    click(label: string) {
      const button = find(
        tree,
        (element) =>
          element.type === "button" &&
          (element.props["aria-label"] === label ||
            nodeText(element.props.children as ReactNode) === label),
      );
      if (!button) throw new Error("Missing button: " + label);
      (button.props.onClick as (event: unknown) => void)({ currentTarget: trigger });
      return view.render();
    },
    input(type: string, value: string) {
      const input = find(
        tree,
        (element) => element.type === "input" && element.props.type === type,
      );
      if (!input) throw new Error("Missing input: " + type);
      (input.props.onChange as (event: unknown) => void)({ target: { value } });
      return view.render();
    },
    event(type: string, event: unknown) {
      for (const listener of documentListeners.get(type) ?? []) listener(event);
      return view.render();
    },
  };
  disposals.push(() => {
    for (const slot of hooks.slots) (slot as EffectSlot | undefined)?.cleanup?.();
  });
  view.render();
  return view;
}

describe("canvas tool palette", () => {
  it("keeps basic tools directly discoverable and routes their real actions", () => {
    const view = harness();
    const html = view.render();
    for (const label of [
      "Sticky note",
      "Text",
      "Rectangle",
      "Oval",
      "Frame",
      "Connector",
      "Pen",
      "Select",
      "Pan",
      "Area selection",
    ])
      expect(html).toContain(`aria-label="${label}"`);
    view.click("Sticky note");
    expect(view.onAdd).toHaveBeenLastCalledWith("sticky", { color: "yellow" });
    view.click("Rectangle");
    expect(view.onAdd).toHaveBeenLastCalledWith("rect", { shapeVariant: "rectangle" });
    view.click("Connector");
    expect(view.onConnector).toHaveBeenCalledWith("arrow");
    view.click("Templates");
    expect(view.onTemplates).toHaveBeenCalledOnce();
    view.click("Add SVG image");
    expect(view.onUploadSvg).toHaveBeenCalledOnce();
    view.click("Pan");
    expect(view.onTool).toHaveBeenLastCalledWith("hand");
  });
  it("filters shapes and invokes connector or variant callbacks from the browser", () => {
    const view = harness();
    expect(view.click("Shapes and connectors")).toContain('role="dialog"');
    const html = view.input("search", "triangle");
    expect(html).toContain("Triangle");
    expect(html).not.toContain(">Star<");
    view.click("Triangle");
    expect(view.onAdd).toHaveBeenLastCalledWith("rect", { shapeVariant: "triangle" });
    view.click("Shapes and connectors");
    view.input("search", "");
    view.click("Connectors");
    view.click("Elbow connector");
    expect(view.onConnector).toHaveBeenLastCalledWith("elbow");
  });
  it("adds a chosen sticky color and limits the atomic stack to remaining capacity", () => {
    const view = harness({ stickyStackLimit: 3 });
    view.click("Sticky note colors");
    view.click("Sticky note: Teal");
    expect(view.onAdd).toHaveBeenLastCalledWith("sticky", { color: "teal" });
    view.click("Sticky note colors");
    view.input("number", "200");
    view.click("Add notes3");
    expect(view.onStickyStack).toHaveBeenCalledWith(3, "yellow");
  });
  it("selects highlighter and whole-stroke eraser modes with controlled settings", () => {
    const view = harness();
    view.click("Drawing settings");
    view.click("Highlighter");
    expect(view.onDrawSettings).toHaveBeenLastCalledWith({
      mode: "highlighter",
      color: "black",
      width: 12,
    });
    expect(view.onTool).toHaveBeenLastCalledWith("pen");
    expect(view.click("Eraser")).toContain("Erase an entire");
    expect(view.onDrawSettings).toHaveBeenLastCalledWith({
      mode: "eraser",
      color: "black",
      width: 12,
    });
    expect(view.onTool).toHaveBeenLastCalledWith("eraser");
  });
  it("focuses a flyout and restores its trigger on Escape while outside clicks keep their focus", () => {
    const view = harness();
    view.click("Shapes and connectors");
    expect(view.initialFocus).toHaveBeenCalled();
    const event = { key: "Escape", preventDefault: vi.fn(), stopPropagation: vi.fn() };
    expect(view.event("keydown", event)).not.toContain('role="dialog"');
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(view.focus).toHaveBeenCalledOnce();
    view.click("Drawing settings");
    view.event("pointerdown", { target: new PaletteNode(false) });
    expect(view.render()).not.toContain('role="dialog"');
    expect(view.focus).toHaveBeenCalledOnce();
    expect(documentListeners.get("keydown")?.size).toBe(0);
  });
  it.each([{ readOnly: true }, { creationFull: true }, { disabled: true }])(
    "blocks creation callbacks for %j",
    (overrides) => {
      const view = harness(overrides);
      view.click("Sticky note");
      view.click("Connector");
      view.click("Pen");
      view.click("Templates");
      view.click("Add SVG image");
      for (const callback of [
        view.onAdd,
        view.onConnector,
        view.onDrawSettings,
        view.onTemplates,
        view.onUploadSvg,
      ])
        expect(callback).not.toHaveBeenCalled();
      expect(view.render()).toContain("disabled");
    },
  );
  it("keeps whole-stroke erasing available when creation capacity is full", () => {
    const view = harness({ creationFull: true });
    view.click("Drawing settings");
    view.click("Highlighter");
    expect(view.onDrawSettings).not.toHaveBeenCalled();
    view.click("Eraser");
    expect(view.onTool).toHaveBeenCalledWith("eraser");
  });
  it("allows read-only navigation while disabling unavailable SVG uploads", () => {
    const view = harness({ readOnly: true, svgUploadDisabled: true });
    view.click("Pan");
    expect(view.onTool).toHaveBeenCalledWith("hand");
    view.click("Add SVG image");
    expect(view.onUploadSvg).not.toHaveBeenCalled();
  });
  it("renders authored thumbnails without remote assets, HTML injection or origin requirements", () => {
    for (const entry of canvasShapeCatalog) {
      const html = renderToStaticMarkup(<CanvasShapePreview entry={entry} />);
      expect(html).toContain('viewBox="0 0 64 48"');
      expect(html).toContain('aria-hidden="true"');
      expect(html).not.toMatch(/https?:|<image|<script|foreignObject|href=/i);
    }
  });
});
