import type { ComponentProps, ReactElement } from "react";
import type * as ReactModule from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

interface Slot {
  value?: unknown;
  deps?: readonly unknown[];
  cleanup?: void | (() => void);
}
interface Hooks {
  cursor: number;
  slots: Slot[];
  effects: (() => void)[];
}
const fixture = vi.hoisted(() => ({ hooks: null as Hooks | null }));
vi.mock("react", async (original) => {
  const react = await original<typeof ReactModule>();
  return {
    ...react,
    useState: <T,>(initial: T | (() => T)) => {
      if (!fixture.hooks) return react.useState(initial);
      const hooks = fixture.hooks,
        index = hooks.cursor++;
      hooks.slots[index] ??= {
        value: typeof initial === "function" ? (initial as () => T)() : initial,
      };
      return [
        hooks.slots[index]!.value,
        (value: T) => {
          hooks.slots[index]!.value = value;
        },
      ];
    },
    useRef: <T,>(initial: T) => {
      if (!fixture.hooks) return react.useRef(initial);
      const hooks = fixture.hooks,
        index = hooks.cursor++;
      hooks.slots[index] ??= { value: { current: initial } };
      return hooks.slots[index]!.value;
    },
    useEffect: (effect: () => void | (() => void), deps?: readonly unknown[]) => {
      if (!fixture.hooks) return react.useEffect(effect, deps);
      const hooks = fixture.hooks,
        index = hooks.cursor++,
        previous = hooks.slots[index];
      if (
        deps &&
        previous?.deps &&
        deps.length === previous.deps.length &&
        deps.every((value, offset) => Object.is(value, previous.deps![offset]))
      )
        return;
      hooks.slots[index] = { deps };
      hooks.effects.push(() => {
        previous?.cleanup?.();
        hooks.slots[index]!.cleanup = effect();
      });
    },
  };
});
vi.mock("../locale-provider", () => ({ useLocale: () => ({ locale: "en-CA" }) }));
import { RoundPaneResize } from "./round-workspace-layout";

afterEach(() => {
  fixture.hooks = null;
  vi.unstubAllGlobals();
});

function harness(
  options: {
    pane?: "navigation" | "tools";
    width?: number;
    otherWidth?: number;
    rendered?: number;
    otherRendered?: number;
    workspaceWidth?: number;
    hidden?: boolean;
  } = {},
) {
  const geometry = {
    own: options.rendered ?? 326,
    other: options.otherRendered ?? 398,
    workspace: options.workspaceWidth ?? 1200,
  };
  const ownElement = { getBoundingClientRect: () => ({ width: geometry.own }) };
  const otherElement = { getBoundingClientRect: () => ({ width: geometry.other }) };
  const observers: Array<{
    callback: () => void;
    observe: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
  }> = [];
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe = vi.fn();
      disconnect = vi.fn();
      constructor(public callback: () => void) {
        observers.push(this);
      }
    },
  );
  const pane = options.pane ?? "navigation";
  const ownId = pane === "navigation" ? "round-question-navigator" : "round-question-tools";
  const workspace = {
    getBoundingClientRect: () => ({ width: geometry.workspace }),
    querySelector: (selector: string) => (selector === `#${ownId}` ? ownElement : otherElement),
  };
  const props: ComponentProps<typeof RoundPaneResize> = {
    pane,
    width: options.width ?? 420,
    otherWidth: options.otherWidth ?? 440,
    workspaceRef: { current: workspace as unknown as HTMLDivElement },
    onChange: vi.fn(),
    hidden: options.hidden,
  };
  const hooks: Hooks = { cursor: 0, slots: [], effects: [] };
  let tree: ReactElement<Record<string, unknown>>;
  const render = () => {
    hooks.cursor = 0;
    fixture.hooks = hooks;
    try {
      tree = RoundPaneResize(props);
    } finally {
      fixture.hooks = null;
    }
    for (const effect of hooks.effects.splice(0)) effect();
    return tree;
  };
  const target = { focus: vi.fn(), setPointerCapture: vi.fn(), releasePointerCapture: vi.fn() };
  const pointer = (handler: string, clientX: number, extra: Record<string, unknown> = {}) => {
    const preventDefault = vi.fn();
    (tree.props[handler] as (event: unknown) => void)({
      currentTarget: target,
      pointerId: 7,
      button: 0,
      clientX,
      preventDefault,
      ...extra,
    });
    return preventDefault;
  };
  const key = (value: string, shiftKey = false) => {
    const preventDefault = vi.fn();
    (tree.props.onKeyDown as (event: unknown) => void)({
      key: value,
      shiftKey,
      currentTarget: target,
      preventDefault,
    });
    return preventDefault;
  };
  render();
  render();
  return {
    props,
    geometry,
    target,
    observers,
    ownElement,
    render,
    node: () => tree,
    pointer,
    key,
    unmount: () => hooks.slots.forEach((slot) => slot.cleanup?.()),
  };
}

describe("Round pane separator interactions", () => {
  it("starts dragging from rendered geometry while preserving the stored preference for Escape", () => {
    const h = harness({
      width: 420,
      rendered: 326,
      otherWidth: 440,
      otherRendered: 398,
      workspaceWidth: 1200,
    });
    expect(h.node().props["aria-valuenow"]).toBe(326);
    h.pointer("onPointerDown", 300);
    expect(h.target.focus).toHaveBeenCalled();
    expect(h.target.setPointerCapture).toHaveBeenCalledWith(7);
    h.pointer("onPointerMove", 301);
    expect(h.props.onChange).toHaveBeenLastCalledWith(327);
    expect(h.key("Escape")).toHaveBeenCalled();
    expect(h.props.onChange).toHaveBeenLastCalledWith(420);
    expect(h.target.releasePointerCapture).toHaveBeenCalledWith(7);
    h.pointer("onPointerMove", 310);
    expect(h.props.onChange).toHaveBeenCalledTimes(2);
  });

  it("reserves room for the actual opposite pane instead of its larger stored preference", () => {
    const h = harness({
      width: 420,
      rendered: 260,
      otherWidth: 440,
      otherRendered: 280,
      workspaceWidth: 1080,
    });
    h.pointer("onPointerDown", 260);
    h.pointer("onPointerMove", 400);
    expect(h.props.onChange).toHaveBeenLastCalledWith(400);
    h.geometry.other = 350;
    h.pointer("onPointerMove", 500);
    expect(h.props.onChange).toHaveBeenLastCalledWith(354);
  });

  it("does not jump left from the displayed rail after the viewport narrows", () => {
    const h = harness({
      width: 420,
      rendered: 325.8,
      otherWidth: 440,
      otherRendered: 398.2,
      workspaceWidth: 1100,
    });
    h.pointer("onPointerDown", 326);
    h.pointer("onPointerMove", 327);
    expect(h.props.onChange).toHaveBeenLastCalledWith(326);
  });

  it("keeps its accessible current width synchronized with observed rendering", () => {
    const h = harness();
    expect(h.observers).toHaveLength(1);
    expect(h.observers[0]!.observe).toHaveBeenCalledWith(h.ownElement);
    h.geometry.own = 291.6;
    h.observers[0]!.callback();
    expect(h.render().props["aria-valuenow"]).toBe(292);
    h.geometry.own = 0;
    h.observers[0]!.callback();
    expect(h.render().props["aria-valuenow"]).toBe(292);
    h.unmount();
    expect(h.observers[0]!.disconnect).toHaveBeenCalled();
  });

  it("resizes from measured width with arrows, Shift steps and available-room bounds", () => {
    const h = harness({ rendered: 290, otherRendered: 320, workspaceWidth: 1048 });
    expect(h.key("ArrowRight")).toHaveBeenCalled();
    expect(h.props.onChange).toHaveBeenLastCalledWith(306);
    h.key("ArrowLeft", true);
    expect(h.props.onChange).toHaveBeenLastCalledWith(242);
    h.key("Home");
    expect(h.props.onChange).toHaveBeenLastCalledWith(216);
    h.key("End");
    expect(h.props.onChange).toHaveBeenLastCalledWith(352);
    expect(h.key("Enter")).not.toHaveBeenCalled();
    expect(h.props.onChange).toHaveBeenCalledTimes(4);
  });

  it("reverses tools-pane drag and arrow direction and clamps to its own limits", () => {
    const h = harness({
      pane: "tools",
      width: 440,
      rendered: 350,
      otherWidth: 420,
      otherRendered: 260,
      workspaceWidth: 1600,
    });
    h.key("ArrowRight");
    expect(h.props.onChange).toHaveBeenLastCalledWith(334);
    h.key("ArrowLeft", true);
    expect(h.props.onChange).toHaveBeenLastCalledWith(398);
    h.key("Home");
    expect(h.props.onChange).toHaveBeenLastCalledWith(280);
    h.key("End");
    expect(h.props.onChange).toHaveBeenLastCalledWith(440);
    h.pointer("onPointerDown", 900);
    h.pointer("onPointerMove", 880);
    expect(h.props.onChange).toHaveBeenLastCalledWith(370);
  });

  it("restores preference on pointer cancellation and ignores nonactive pointers", () => {
    const h = harness();
    h.pointer("onPointerDown", 300, { button: 2 });
    expect(h.target.setPointerCapture).not.toHaveBeenCalled();
    h.pointer("onPointerDown", 300);
    h.pointer("onPointerMove", 320, { pointerId: 8 });
    expect(h.props.onChange).not.toHaveBeenCalled();
    h.pointer("onPointerMove", 320);
    (h.node().props.onPointerCancel as () => void)();
    expect(h.props.onChange).toHaveBeenLastCalledWith(420);
    h.pointer("onPointerMove", 330);
    expect(h.props.onChange).toHaveBeenCalledTimes(2);
  });

  it("finishes capture without undoing a completed drag and hides collapsed separators from tab order", () => {
    const h = harness({ hidden: true });
    expect(h.node().props.hidden).toBe(true);
    expect(h.node().props.tabIndex).toBe(-1);
    h.pointer("onPointerDown", 300);
    h.pointer("onPointerMove", 310);
    h.pointer("onPointerUp", 310);
    expect(h.target.releasePointerCapture).toHaveBeenCalledWith(7);
    h.key("Escape");
    expect(h.props.onChange).toHaveBeenCalledTimes(1);
  });
});
