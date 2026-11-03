import { isValidElement, type ReactElement, type ReactNode } from "react";
import type * as ReactModule from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CanvasQuickTimer, type CanvasQuickTimerProps } from "./canvas-quick-timer";
interface EffectSlot {
  dependencies?: readonly unknown[];
  cleanup?: () => void;
}
interface Hooks {
  cursor: number;
  slots: unknown[];
  pending: (() => void)[];
}
const mocked = vi.hoisted(() => ({ hooks: null as Hooks | null, portal: vi.fn() }));
vi.mock("../locale-provider", () => ({ useLocale: () => ({ locale: "en-CA" }) }));
vi.mock("react-dom", () => ({ createPortal: mocked.portal }));
vi.mock("react", async (original) => {
  const react = await original<typeof ReactModule>();
  return {
    ...react,
    useRef: <T,>(initial: T) => {
      if (!mocked.hooks) return react.useRef(initial);
      const index = mocked.hooks.cursor++;
      mocked.hooks.slots[index] ??= { current: initial };
      return mocked.hooks.slots[index];
    },
    useEffect: (effect: ReactModule.EffectCallback, dependencies?: readonly unknown[]) => {
      if (!mocked.hooks) return react.useEffect(effect, dependencies);
      const hooks = mocked.hooks,
        index = hooks.cursor++,
        previous = hooks.slots[index] as EffectSlot | undefined;
      if (
        previous &&
        dependencies?.length === previous.dependencies?.length &&
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
class Target extends EventTarget {
  isConnected = true;
  visible = true;
  inert = false;
  children = new Set<unknown>();
  focus = vi.fn(() => {
    Object.assign(document, { activeElement: this });
  });
  getClientRects() {
    return this.visible ? [{}] : [];
  }
  closest() {
    return this.inert ? this : null;
  }
  matches() {
    return false;
  }
  contains(target: unknown) {
    return this.children.has(target);
  }
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
const cleanups: (() => void)[] = [];
beforeEach(() => {
  mocked.portal.mockReset().mockImplementation((children) => children);
  vi.stubGlobal("HTMLElement", Target);
  const body = new Target();
  vi.stubGlobal("document", {
    body,
    activeElement: body,
    hasFocus: () => true,
    querySelector: vi.fn(() => null),
  });
});
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  mocked.hooks = null;
  vi.unstubAllGlobals();
});
function harness() {
  const hooks: Hooks = { cursor: 0, slots: [], pending: [] };
  const opener = new Target(),
    first = new Target(),
    panel = new Target();
  panel.children.add(first);
  Object.assign(panel, { querySelector: () => first });
  Object.assign(document, { activeElement: opener });
  const close = vi.fn(() => {
    props.open = false;
  });
  const props: CanvasQuickTimerProps = {
    open: true,
    onClose: close,
    returnFocusRef: { current: opener as unknown as HTMLElement },
    children: (
      <button type="button" data-timer-primary>
        Start timer
      </button>
    ),
  };
  let tree: ReactNode;
  const view = {
    opener,
    first,
    panel,
    close,
    render(open = props.open) {
      props.open = open;
      hooks.cursor = 0;
      mocked.hooks = hooks;
      try {
        tree = CanvasQuickTimer(props);
      } finally {
        mocked.hooks = null;
      }
      const region = find(tree, (element) => element.props["data-testid"] === "canvas-quick-timer");
      if (region) (region.props.ref as { current: unknown }).current = panel;
      for (const effect of hooks.pending.splice(0)) effect();
      return tree;
    },
    escape(isComposing = false) {
      const region = find(
        tree,
        (element) => element.props["data-testid"] === "canvas-quick-timer",
      )!;
      const event = {
        key: "Escape",
        nativeEvent: { isComposing },
        defaultPrevented: false,
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
      };
      (region.props.onKeyDown as (event: unknown) => void)(event);
      view.render();
      return event;
    },
    clickClose() {
      const button = find(
        tree,
        (element) => element.type === "button" && element.props["aria-label"] === "Close timer",
      )!;
      (button.props.onClick as () => void)();
      return view.render();
    },
  };
  cleanups.push(() => {
    for (const slot of hooks.slots) (slot as EffectSlot | undefined)?.cleanup?.();
  });
  view.render();
  return view;
}
describe("floating quick timer portal and focus", () => {
  it("mounts directly in the body, focuses inside, and restores a visible opener on scoped Escape", () => {
    const view = harness();
    expect(mocked.portal.mock.calls.at(-1)![1]).toBe(document.body);
    expect(document.activeElement).toBe(view.first);
    const event = view.escape();
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(event.stopPropagation).not.toHaveBeenCalled();
    expect(view.close).toHaveBeenCalledOnce();
    expect(view.opener.focus).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(view.opener);
  });
  it("keeps the widget open during outside canvas work and preserves outside focus on external close", () => {
    const view = harness(),
      outside = new Target();
    outside.focus();
    view.render();
    expect(view.close).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(outside);
    view.render(false);
    expect(document.activeElement).toBe(outside);
    expect(view.opener.focus).not.toHaveBeenCalled();
  });
  it("closes with its button and avoids restoring hidden or inert openers", () => {
    const view = harness();
    view.opener.inert = true;
    view.clickClose();
    expect(view.close).toHaveBeenCalledOnce();
    expect(view.opener.focus).not.toHaveBeenCalled();
  });
  it("does not consume composing Escape or steal focus from a native modal", () => {
    const view = harness();
    view.escape(true);
    expect(view.close).not.toHaveBeenCalled();
    const outside = new Target();
    outside.focus();
    vi.mocked(document.querySelector).mockReturnValue({ open: true } as unknown as Element);
    view.escape();
    expect(view.close).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(outside);
    view.render(false);
    expect(view.opener.focus).not.toHaveBeenCalled();
  });
});
