import { isValidElement, type ReactElement, type ReactNode } from "react";
import type * as ReactModule from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CanvasTopbar, type CanvasTopbarProps } from "./canvas-topbar";

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
vi.mock("../locale-provider", () => ({ useLocale: () => ({ locale: "en-CA" }) }));
vi.mock("react", async (original) => {
  const react = await original<typeof ReactModule>();
  return {
    ...react,
    useId: () => (mocked.hooks ? "topbar-" + mocked.hooks.cursor++ : react.useId()),
    useState: <T,>(initial: T | (() => T)) => {
      if (!mocked.hooks) return react.useState(initial);
      const hooks = mocked.hooks,
        index = hooks.cursor++;
      if (!(index in hooks.slots))
        hooks.slots[index] = typeof initial === "function" ? (initial as () => T)() : initial;
      return [
        hooks.slots[index],
        (value: T | ((previous: T) => T)) => {
          hooks.slots[index] =
            typeof value === "function"
              ? (value as (previous: T) => T)(hooks.slots[index] as T)
              : value;
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
function textOf(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  return isValidElement<{ children?: ReactNode }>(node) ? textOf(node.props.children) : "";
}
class Control extends EventTarget {
  readonly focus = vi.fn();
  readonly inside = true;
  disabled = false;
  closest(selector: string) {
    return selector === "button" ? this : null;
  }
}
const cleanups: (() => void)[] = [];
beforeEach(() => {
  vi.stubGlobal("document", new EventTarget());
  vi.stubGlobal("Node", EventTarget);
  vi.stubGlobal("Element", Control);
});
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  vi.unstubAllGlobals();
});

function harness(overrides: Partial<CanvasTopbarProps> = {}) {
  const hooks: Hooks = { cursor: 0, slots: [], pending: [] };
  const image = vi.fn(),
    link = vi.fn(),
    undo = vi.fn(),
    panel = vi.fn(),
    presenter = vi.fn();
  const trigger = new Control(),
    initialFocus = vi.fn();
  const props: CanvasTopbarProps = {
    backLink: (
      <a href="/boards" aria-label="Boards" title="Boards">
        Back
      </a>
    ),
    title: "A long original planning canvas title",
    subtitle: <span>Example workspace</span>,
    saveStatus: <p role="status">Saved</p>,
    history: (
      <button type="button" aria-label="Undo" onClick={undo}>
        Undo
      </button>
    ),
    panels: (
      <button type="button" aria-label="Object outline" onClick={panel}>
        Objects
      </button>
    ),
    presenter: (
      <button
        type="button"
        aria-label="Presentation"
        data-testid="presenter-slot"
        onClick={presenter}
      >
        Presentation
      </button>
    ),
    assets: <div data-testid="assets-slot">Persistent asset owner</div>,
    share: (
      <button type="button" aria-label="Share">
        Share
      </button>
    ),
    insertActions: [
      { id: "image", label: "Image", icon: "image", onSelect: image },
      { id: "link", label: "Link", icon: "link", onSelect: link, disabled: true },
    ],
    ...overrides,
  };
  let tree: ReactNode;
  const view = {
    image,
    link,
    undo,
    panel,
    presenter,
    trigger,
    initialFocus,
    render() {
      hooks.cursor = 0;
      mocked.hooks = hooks;
      try {
        tree = CanvasTopbar(props);
      } finally {
        mocked.hooks = null;
      }
      const header = find(tree, (element) => element.type === "header")!;
      (header.props.ref as { current: unknown }).current = {
        contains: (target: unknown) => target instanceof Control,
      };
      for (const suffix of ["insert", "actions"]) {
        const container = find(
          tree,
          (element) =>
            element.type === "div" &&
            typeof element.props.id === "string" &&
            element.props.id.endsWith("-" + suffix),
        );
        if (container)
          (container.props.ref as { current: unknown }).current = {
            querySelector: () => ({ focus: initialFocus }),
          };
      }
      for (const effect of hooks.pending.splice(0)) effect();
      return renderToStaticMarkup(tree);
    },
    button(label: string) {
      const button = find(
        tree,
        (element) =>
          element.type === "button" &&
          (element.props["aria-label"] === label ||
            textOf(element.props.children as ReactNode) === label),
      );
      if (!button) throw new Error("Missing button: " + label);
      return button;
    },
    click(label: string) {
      (view.button(label).props.onClick as (event: unknown) => void)({ currentTarget: trigger });
      return view.render();
    },
    activateSlot(label: string) {
      const button = view.button(label);
      const wrapper = find(
        tree,
        (element) =>
          element.type === "div" &&
          typeof element.props.onClick === "function" &&
          Boolean(find(element.props.children as ReactNode, (child) => child === button)),
      )!;
      (button.props.onClick as () => void)();
      (wrapper.props.onClick as (event: unknown) => void)({ target: trigger });
      return view.render();
    },
    group(suffix: "insert" | "actions") {
      return find(
        tree,
        (element) =>
          element.type === "div" &&
          typeof element.props.id === "string" &&
          element.props.id.endsWith("-" + suffix),
      )!.props;
    },
    escape() {
      const event = { key: "Escape", preventDefault: vi.fn(), stopPropagation: vi.fn() };
      const header = find(tree, (element) => element.type === "header")!;
      (header.props.onKeyDown as (event: unknown) => void)(event);
      view.render();
      return event;
    },
    outside() {
      document.dispatchEvent(new Event("pointerdown"));
      return view.render();
    },
  };
  cleanups.push(() => {
    for (const slot of hooks.slots) (slot as EffectSlot | undefined)?.cleanup?.();
  });
  view.render();
  return view;
}

describe("compact canvas topbar", () => {
  it("retains one header, identity and one mounted owner of each stateful slot", () => {
    const view = harness();
    for (const action of [
      () => view.render(),
      () => view.click("Insert"),
      () => view.click("More board actions"),
      () => view.escape(),
    ]) {
      action();
      const html = view.render();
      expect(html.match(/<header\b/g)).toHaveLength(1);
      expect(html.match(/data-testid="assets-slot"/g)).toHaveLength(1);
      expect(html.match(/data-testid="presenter-slot"/g)).toHaveLength(1);
      expect(html).toContain('<h1 lang="" dir="auto"');
      expect(html).toContain("A long original planning canvas title");
      expect(html).toContain("Example workspace");
      expect(html).toContain('role="status"');
    }
  });
  it("routes real insert callbacks, keeps disabled actions disabled, and closes after selection", () => {
    const view = harness();
    view.click("Insert");
    expect(view.group("insert").hidden).toBe(false);
    expect(view.button("Link").props.disabled).toBe(true);
    view.click("Link");
    expect(view.link).not.toHaveBeenCalled();
    expect(view.trigger.focus).not.toHaveBeenCalled();
    view.click("Image");
    expect(view.image).toHaveBeenCalledOnce();
    expect(view.group("insert").hidden).toBe(true);
    expect(view.render()).toContain('data-testid="assets-slot"');
  });
  it.each([
    ["Image", "image"],
    ["Link", "link"],
    ["Add SVG image", "upload-svg"],
  ] as const)(
    "focuses the visible Insert opener before %s captures its dialog return target",
    (label, icon) => {
      const onSelect = vi.fn();
      const view = harness({ insertActions: [{ id: icon, label, icon, onSelect }] });
      const order: string[] = [];
      let focused: Control | null = null;
      let returnTarget: Control | null = null;
      view.trigger.focus.mockImplementation(() => {
        order.push("focus Insert");
        focused = view.trigger;
        expect(view.group("insert").hidden).toBe(false);
      });
      onSelect.mockImplementation(() => {
        order.push("open asset dialog");
        returnTarget = focused;
        expect(view.group("insert").hidden).toBe(false);
      });
      view.click("Insert");
      view.click(label);
      expect(order).toEqual(["focus Insert", "open asset dialog"]);
      expect(returnTarget).toBe(view.trigger);
      expect(view.group("insert").hidden).toBe(true);
      expect(onSelect).toHaveBeenCalledOnce();
    },
  );
  it("focuses disclosures, restores Escape focus, and dismisses outside without stealing focus", () => {
    const view = harness();
    view.click("Insert");
    expect(view.initialFocus).toHaveBeenCalledOnce();
    const event = view.escape();
    expect(event.stopPropagation).toHaveBeenCalledOnce();
    expect(view.trigger.focus).toHaveBeenCalledOnce();
    view.click("More board actions");
    view.outside();
    expect(view.group("actions")["data-open"]).toBe(false);
    expect(view.trigger.focus).toHaveBeenCalledOnce();
  });
  it("closes delegated history and panel actions while retaining presentation disclosure access", () => {
    const view = harness();
    view.click("More board actions");
    view.activateSlot("Undo");
    expect(view.undo).toHaveBeenCalledOnce();
    expect(view.group("actions")["data-open"]).toBe(false);
    expect(view.trigger.focus).toHaveBeenCalledOnce();
    view.click("More board actions");
    view.activateSlot("Object outline");
    expect(view.panel).toHaveBeenCalledOnce();
    expect(view.group("actions")["data-open"]).toBe(false);
    expect(view.trigger.focus).toHaveBeenCalledTimes(2);
    view.click("More board actions");
    view.activateSlot("Presentation");
    expect(view.presenter).toHaveBeenCalledOnce();
    expect(view.group("actions")["data-open"]).toBe(true);
  });
  it("keeps direct desktop panel actions from moving focus to an unrelated disclosure", () => {
    const view = harness();
    view.activateSlot("Object outline");
    expect(view.panel).toHaveBeenCalledOnce();
    expect(view.trigger.focus).not.toHaveBeenCalled();
  });
  it("disables an empty insert disclosure without hiding history or assets", () => {
    const view = harness({ insertActions: [] });
    expect(view.button("Insert").props.disabled).toBe(true);
    expect(view.button("Undo")).toBeTruthy();
    expect(view.render()).toContain('data-testid="assets-slot"');
  });
});
