import { isValidElement, type ComponentProps, type ReactElement, type ReactNode } from "react";
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
import { RoundWorkspaceDialog } from "./round-workspace-dialog";

afterEach(() => {
  fixture.hooks = null;
  vi.unstubAllGlobals();
});

class FocusTarget {
  isConnected = true;
  focus = vi.fn();
}
function nodes(tree: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  if (!isValidElement<Record<string, unknown>>(tree)) return [];
  return [tree, ...nodes(tree.props.children as ReactNode)];
}
function harness(options: { open?: boolean; explicitTrigger?: boolean } = {}) {
  vi.stubGlobal("HTMLElement", FocusTarget);
  const browserActive = new FocusTarget();
  const documentState = { activeElement: browserActive };
  vi.stubGlobal("document", documentState);
  const explicitTrigger = new FocusTarget();
  const props: ComponentProps<typeof RoundWorkspaceDialog> = {
    open: options.open ?? false,
    title: "Review Round",
    onClose: vi.fn(),
    returnFocusTo:
      options.explicitTrigger === false ? undefined : (explicitTrigger as unknown as HTMLElement),
    children: (
      <section data-pending-mutation="same-operation">
        <input defaultValue="Pending replacement" />
        <button type="button">Retry pending revision</button>
      </section>
    ),
  };
  const heading = new FocusTarget();
  const native = {
    open: false,
    showModal: vi.fn(() => {
      native.open = true;
    }),
    close: vi.fn(() => {
      native.open = false;
    }),
    querySelector: vi.fn((selector: string) => (selector === "h2" ? heading : null)),
  };
  const hooks: Hooks = { cursor: 0, slots: [], effects: [] };
  let tree: ReactElement<Record<string, unknown>>;
  const render = () => {
    hooks.cursor = 0;
    fixture.hooks = hooks;
    try {
      tree = RoundWorkspaceDialog(props);
    } finally {
      fixture.hooks = null;
    }
    (tree.props.ref as { current: unknown }).current = native;
    for (const effect of hooks.effects.splice(0)) effect();
    return tree;
  };
  render();
  return {
    props,
    native,
    heading,
    browserActive,
    explicitTrigger,
    documentState,
    render,
    node: () => tree,
    all: () => nodes(tree),
    unmount: () => hooks.slots.forEach((slot) => slot.cleanup?.()),
  };
}

describe("Round workspace native dialog", () => {
  it("keeps the same pending controls mounted across closed, open and closed states", () => {
    const h = harness();
    const pending = h
      .all()
      .find((node) => node.props["data-pending-mutation"] === "same-operation");
    expect(pending).toBe(h.props.children);
    expect(h.native.open).toBe(false);
    expect(h.node().props["aria-label"]).toBe("Review Round");
    expect(h.node().props["aria-modal"]).toBe("true");
    h.props.open = true;
    h.render();
    expect(h.native.showModal).toHaveBeenCalledTimes(1);
    expect(h.native.open).toBe(true);
    expect(h.heading.focus).toHaveBeenCalledTimes(1);
    expect(h.all()).toContain(pending);
    h.render();
    expect(h.native.showModal).toHaveBeenCalledTimes(1);
    h.props.open = false;
    h.render();
    expect(h.native.open).toBe(false);
    expect(h.all()).toContain(pending);
    expect(h.all().find((node) => node.type === "input")?.props.defaultValue).toBe(
      "Pending replacement",
    );
  });

  it("restores the explicitly supplied Safari pointer trigger rather than unrelated activeElement", () => {
    const h = harness({ open: true });
    expect(h.browserActive).not.toBe(h.explicitTrigger);
    h.documentState.activeElement = new FocusTarget();
    h.props.open = false;
    h.render();
    expect(h.explicitTrigger.focus).toHaveBeenCalledTimes(1);
    expect(h.browserActive.focus).not.toHaveBeenCalled();
    expect(h.documentState.activeElement.focus).not.toHaveBeenCalled();
  });

  it("uses browser focus as a fallback and skips disconnected return targets", () => {
    const fallback = harness({ open: true, explicitTrigger: false });
    fallback.props.open = false;
    fallback.render();
    expect(fallback.browserActive.focus).toHaveBeenCalledTimes(1);
    const removed = harness({ open: true });
    removed.explicitTrigger.isConnected = false;
    removed.props.open = false;
    removed.render();
    expect(removed.explicitTrigger.focus).not.toHaveBeenCalled();
  });

  it("handles its own Escape cancellation through controlled close", () => {
    const h = harness({ open: true });
    const preventDefault = vi.fn();
    (h.node().props.onCancel as (event: unknown) => void)({
      target: h.native,
      currentTarget: h.native,
      preventDefault,
    });
    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(h.props.onClose).toHaveBeenCalledTimes(1);
    h.props.open = false;
    h.render();
    expect(h.native.open).toBe(false);
    expect(h.explicitTrigger.focus).toHaveBeenCalledTimes(1);
  });

  it("does not intercept a nested dialog cancellation", () => {
    const h = harness({ open: true });
    const preventDefault = vi.fn();
    (h.node().props.onCancel as (event: unknown) => void)({
      target: { open: true },
      currentTarget: h.native,
      preventDefault,
    });
    expect(preventDefault).not.toHaveBeenCalled();
    expect(h.props.onClose).not.toHaveBeenCalled();
    expect(h.native.open).toBe(true);
  });

  it("offers an explicit close control and closes the native surface on unmount", () => {
    const h = harness({ open: true });
    const close = h
      .all()
      .find((node) => node.type === "button" && node.props.children === "Close")!;
    expect(close.props.type).toBe("button");
    (close.props.onClick as () => void)();
    expect(h.props.onClose).toHaveBeenCalledTimes(1);
    h.unmount();
    expect(h.native.open).toBe(false);
    expect(h.explicitTrigger.focus).toHaveBeenCalledTimes(1);
  });
});
