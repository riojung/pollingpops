import { isValidElement, type ReactElement, type ReactNode } from "react";
import type * as ReactModule from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CanvasInspectorDrawer, type CanvasInspectorDrawerProps } from "./canvas-inspector-drawer";

interface Hooks {
  cursor: number;
  slots: unknown[];
  effects: Array<() => void>;
  cleanups: Map<number, (() => void) | undefined>;
}
const mocks = vi.hoisted(() => ({ hooks: null as Hooks | null }));
vi.mock("react", async (original) => {
  const react = await original<typeof ReactModule>();
  const effect = (effect: ReactModule.EffectCallback, dependencies?: readonly unknown[]) => {
    if (!mocks.hooks) return react.useEffect(effect, dependencies);
    const hooks = mocks.hooks,
      index = hooks.cursor++;
    const previous = hooks.slots[index] as readonly unknown[] | undefined;
    if (!previous || dependencies?.some((value, dependency) => value !== previous[dependency]))
      hooks.effects.push(() => {
        hooks.cleanups.get(index)?.();
        hooks.cleanups.set(index, effect() || undefined);
      });
    hooks.slots[index] = dependencies;
  };
  return {
    ...react,
    useId: () => (mocks.hooks ? `drawer-${mocks.hooks.cursor++}` : react.useId()),
    useRef: <T,>(initial: T) => {
      if (!mocks.hooks) return react.useRef(initial);
      const hooks = mocks.hooks,
        index = hooks.cursor++;
      hooks.slots[index] ??= { current: initial };
      return hooks.slots[index];
    },
    useEffect: effect,
    useLayoutEffect: effect,
  };
});
vi.mock("../locale-provider", () => ({ useLocale: () => ({ locale: "en-CA" }) }));

class Target {
  isConnected = true;
  inert = false;
  editable = false;
  inDialog = false;
  inPopover = false;
  dir = "ltr";
  descendants = new Set<unknown>();
  focus = vi.fn(() => {
    documentState.activeElement = this;
  });
  closest(selector: string) {
    if (selector === "[dir]") return this;
    if (selector.includes("[inert]") && this.inert) return this;
    if (selector.includes("input") && this.editable) return this;
    if (selector.includes('[role="dialog"]') && this.inDialog) return this;
    if (selector.includes("[popover]") && this.inPopover) return this;
    return null;
  }
  getAttribute(name: string) {
    return name === "dir" ? this.dir : null;
  }
  contains(node: unknown) {
    return node === this || this.descendants.has(node);
  }
}
const listeners = new Map<string, (event: unknown) => void>();
const documentState = {
  activeElement: null as Target | null,
  body: new Target(),
  querySelector: vi.fn((): Target | null => null),
  addEventListener: (name: string, callback: (event: unknown) => void) =>
    listeners.set(name, callback),
  removeEventListener: (name: string) => listeners.delete(name),
};
const tabs: CanvasInspectorDrawerProps["tabs"] = [
  { id: "objects", label: "Objects", content: <p>Object list</p> },
  {
    id: "properties",
    label: "Properties",
    content: <input aria-label="Object text" defaultValue="Property draft" />,
  },
  {
    id: "facilitation",
    label: "Facilitation",
    content: <textarea aria-label="Reply" defaultValue="Unsaved reply" />,
  },
];
function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement<Record<string, unknown>>(node)) return [];
  return [node, ...elements(node.props.children as ReactNode)];
}
function harness(initial: Partial<CanvasInspectorDrawerProps> = {}) {
  const hooks: Hooks = { cursor: 0, slots: [], effects: [], cleanups: new Map() };
  const onClose = vi.fn(),
    onTabChange = vi.fn();
  const aside = new Target();
  const buttons = new Map(tabs.map((item) => [item.id, new Target()]));
  for (const button of buttons.values()) aside.descendants.add(button);
  let props: CanvasInspectorDrawerProps = {
    open: false,
    title: "Inspector",
    tab: "objects",
    tabs,
    onClose,
    onTabChange,
    ...initial,
  };
  return {
    onClose,
    onTabChange,
    aside,
    buttons,
    render(update: Partial<CanvasInspectorDrawerProps> = {}) {
      props = { ...props, ...update };
      hooks.cursor = 0;
      hooks.effects = [];
      mocks.hooks = hooks;
      let tree: ReactElement;
      try {
        tree = CanvasInspectorDrawer(props);
      } finally {
        mocks.hooks = null;
      }
      (tree.props as { ref: { current: unknown } }).ref.current = aside;
      aside.inert = !props.open;
      for (const item of elements(tree).filter((item) => item.props.role === "tab"))
        (item.props.ref as (node: unknown) => void)(
          buttons.get(String(item.props["aria-controls"]).split("-panel-")[1]!),
        );
      for (const effect of hooks.effects) effect();
      return elements(tree);
    },
  };
}
function escape(target = new Target(), extra: Record<string, unknown> = {}) {
  const event = {
    key: "Escape",
    target,
    defaultPrevented: false,
    isComposing: false,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
    ...extra,
  };
  listeners.get("keydown")?.(event);
  return event;
}
beforeEach(() => {
  listeners.clear();
  documentState.activeElement = new Target();
  documentState.querySelector.mockReset().mockReturnValue(null);
  vi.stubGlobal("document", documentState);
  vi.stubGlobal("Element", Target);
  vi.stubGlobal("HTMLElement", Target);
});
afterEach(() => vi.unstubAllGlobals());

describe("nonmodal canvas inspector drawer", () => {
  it("keeps every labelled panel mounted and only the selected open panel interactive", () => {
    const view = harness();
    let open = false,
      tab = "objects";
    for (const update of [
      { open: true },
      { tab: "facilitation" },
      { open: false },
      { open: true, tab: "properties" },
    ]) {
      open = update.open ?? open;
      tab = update.tab ?? tab;
      const tree = view.render(update);
      const panels = tree.filter((item) => item.props.role === "tabpanel");
      expect(panels).toHaveLength(tabs.length);
      expect(panels.filter((panel) => !panel.props.hidden).map((panel) => panel.key)).toEqual(
        open ? [tab] : [],
      );
      panels.forEach((panel, index) => {
        expect(panel.key).toBe(tabs[index]!.id);
        expect(panel.props.children).toBe(tabs[index]!.content);
        expect(panel.props.inert).toBe(panel.props.hidden);
      });
      expect(tree[0]!.props.inert).toBe(!open);
    }
    const markup = renderToStaticMarkup(
      <CanvasInspectorDrawer
        open
        title="Inspector"
        tab="objects"
        tabs={tabs}
        onClose={() => undefined}
        onTabChange={() => undefined}
      />,
    );
    expect(markup).toContain("<aside");
    expect(markup).toContain('role="tablist"');
    expect(markup).toContain("Unsaved reply");
    expect(markup).toContain('aria-label="Close inspector"');
    expect(markup).not.toContain('aria-modal="true"');
  });
  it("leaves the visible opener and other controls focused when opened or switched", () => {
    const opener = documentState.activeElement!;
    const view = harness({ open: true });
    view.render();
    expect(documentState.activeElement).toBe(opener);
    view.render({ tab: "properties" });
    const canvas = new Target();
    documentState.activeElement = canvas;
    view.render({ tab: "facilitation" });
    view.render();
    expect(documentState.activeElement).toBe(canvas);
    for (const button of view.buttons.values()) expect(button.focus).not.toHaveBeenCalled();
    expect(opener.focus).not.toHaveBeenCalled();
  });
  it("hands focus from an inert canvas opener to the active tab and restores it on close", () => {
    const opener = documentState.activeElement!;
    const returnFocusRef = { current: opener as unknown as HTMLElement };
    const view = harness({ returnFocusRef, tab: "properties" });
    view.render();
    // Applying inert may already have cleared activeElement before layout effects.
    opener.inert = true;
    documentState.activeElement = documentState.body;
    view.render({ open: true });
    const selectedTab = view.buttons.get("properties")!;
    expect(selectedTab.focus).toHaveBeenCalledOnce();
    expect(documentState.activeElement).toBe(selectedTab);
    view.render({ tab: "objects" });
    expect(view.buttons.get("objects")!.focus).not.toHaveBeenCalled();
    opener.inert = false;
    view.render({ open: false });
    expect(opener.focus).toHaveBeenCalledOnce();
    expect(documentState.activeElement).toBe(opener);
  });
  it("does not move an inert opener's focus away from an active modal", () => {
    const opener = new Target();
    opener.inert = true;
    const modalInput = documentState.activeElement!;
    documentState.querySelector.mockReturnValue(new Target());
    const view = harness({
      open: true,
      returnFocusRef: { current: opener as unknown as HTMLElement },
    });
    view.render();
    expect(documentState.activeElement).toBe(modalInput);
    for (const button of view.buttons.values()) expect(button.focus).not.toHaveBeenCalled();
  });
  it("uses controlled roving tabs with wrapping arrows, Home/End and RTL without canvas shortcuts", () => {
    const view = harness({ open: true });
    const controls = view.render().filter((item) => item.props.role === "tab");
    expect(controls.map((item) => item.props.tabIndex)).toEqual([0, -1, -1]);
    const key = (index: number, value: string, rtl = false) => {
      const currentTarget = new Target();
      currentTarget.dir = rtl ? "rtl" : "ltr";
      const preventDefault = vi.fn(),
        stopPropagation = vi.fn();
      (controls[index]!.props.onKeyDown as (event: unknown) => void)({
        key: value,
        currentTarget,
        preventDefault,
        stopPropagation,
      });
      expect(preventDefault).toHaveBeenCalledOnce();
      expect(stopPropagation).toHaveBeenCalledOnce();
    };
    key(0, "ArrowLeft");
    expect(view.onTabChange).toHaveBeenLastCalledWith("facilitation");
    expect(view.buttons.get("facilitation")!.focus).toHaveBeenCalledOnce();
    key(2, "Home");
    expect(view.onTabChange).toHaveBeenLastCalledWith("objects");
    key(0, "End");
    expect(view.onTabChange).toHaveBeenLastCalledWith("facilitation");
    key(0, "ArrowRight", true);
    expect(view.onTabChange).toHaveBeenLastCalledWith("facilitation");
    const after = view.render({ tab: "properties" }).filter((item) => item.props.role === "tab");
    expect(after.map((item) => item.props.tabIndex)).toEqual([-1, 0, -1]);
    const preventDefault = vi.fn();
    (controls[0]!.props.onKeyDown as (event: unknown) => void)({ key: "Tab", preventDefault });
    expect(preventDefault).not.toHaveBeenCalled();
  });
  it("leaves edits, modal dialogs, popovers and consumed Escape events to their owners", () => {
    const view = harness({ open: true });
    view.render();
    for (const kind of ["editable", "inDialog", "inPopover"] as const) {
      const target = new Target();
      target[kind] = true;
      view.aside.descendants.add(target);
      escape(target);
    }
    escape(view.aside, { defaultPrevented: true });
    escape(view.aside, { isComposing: true });
    escape(new Target());
    documentState.querySelector.mockReturnValueOnce(new Target());
    escape(view.aside);
    expect(view.onClose).not.toHaveBeenCalled();
    const event = escape(view.aside);
    expect(view.onClose).toHaveBeenCalledOnce();
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(event.stopPropagation).toHaveBeenCalledOnce();
    view.render({ open: false });
    escape();
    expect(view.onClose).toHaveBeenCalledOnce();
  });
  it("restores the captured opener only after an actual close from inside the drawer", () => {
    const opener = documentState.activeElement!;
    const view = harness({ open: true });
    const controls = view.render();
    const input = new Target();
    view.aside.descendants.add(input);
    documentState.activeElement = input;
    view.render({ tab: "properties" });
    const close = controls.find((item) => item.props["aria-label"] === "Close inspector")!;
    (close.props.onClick as () => void)();
    expect(view.onClose).toHaveBeenCalledOnce();
    expect(opener.focus).not.toHaveBeenCalled();
    view.render({ open: false });
    expect(opener.focus).toHaveBeenCalledOnce();
    expect(documentState.activeElement).toBe(opener);
  });
  it("uses a delegated opener assigned after opening for scoped Escape and close restoration", () => {
    const oldAction = documentState.activeElement!;
    const returnFocusRef: { current: HTMLElement | null } = { current: null };
    const view = harness({ open: true, returnFocusRef });
    view.render();
    const more = new Target();
    returnFocusRef.current = more as unknown as HTMLElement;
    documentState.activeElement = more;
    view.render({ tab: "properties" });
    expect(documentState.activeElement).toBe(more);
    escape(more);
    expect(view.onClose).toHaveBeenCalledOnce();
    documentState.activeElement = documentState.body;
    view.render({ open: false });
    expect(more.focus).toHaveBeenCalledOnce();
    expect(oldAction.focus).not.toHaveBeenCalled();
  });
  it("does not steal outside-control or modal focus on opening or closing", () => {
    const opener = documentState.activeElement!;
    const view = harness({ open: true });
    view.render();
    const outside = new Target();
    documentState.activeElement = outside;
    view.render({ open: false });
    expect(opener.focus).not.toHaveBeenCalled();
    documentState.querySelector.mockReturnValue(new Target());
    view.render({ open: true });
    expect(documentState.activeElement).toBe(outside);
    documentState.activeElement = documentState.body;
    view.render({ open: false });
    expect(outside.focus).not.toHaveBeenCalled();
    expect(documentState.activeElement).toBe(documentState.body);
  });
  it.each(["disconnected", "inert"])("does not restore a %s opener", (kind) => {
    const opener = documentState.activeElement!;
    const view = harness({ open: true });
    view.render();
    if (kind === "disconnected") opener.isConnected = false;
    else opener.inert = true;
    documentState.activeElement = documentState.body;
    view.render({ open: false });
    expect(opener.focus).not.toHaveBeenCalled();
  });
  it("keeps drawer navigation disabled during a guarded canvas interaction", () => {
    const controls = harness({ open: true, disabled: true }).render();
    const buttons = controls.filter((item) => item.type === "button");
    expect(buttons).toHaveLength(tabs.length + 1);
    expect(buttons.every((button) => button.props.disabled)).toBe(true);
  });
});
