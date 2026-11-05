import { readFileSync } from "node:fs";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import type * as ReactModule from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  PresentationNavigationSnapshot,
  PresentationSpatialSnapshot,
} from "@openround/contracts";
import { shouldApplyPresentationSnapshot } from "../../lib/presentation-realtime";
import { PresentationSpatialDelivery } from "./presentation-spatial-delivery";

type Effect = { deps?: readonly unknown[]; run: () => void | (() => void); cleanup?: () => void };
type Hooks = { cursor: number; slots: unknown[]; effects: Map<number, Effect>; pending: Effect[] };
const fixture = vi.hoisted(() => ({ hooks: null as Hooks | null }));
vi.mock("react", async (original) => {
  const react = await original<typeof ReactModule>();
  return {
    ...react,
    useId: () => (fixture.hooks ? `spatial-${fixture.hooks.cursor++}` : react.useId()),
    useRef: <T,>(initial: T) => {
      const hooks = fixture.hooks;
      if (!hooks) return react.useRef(initial);
      const index = hooks.cursor++;
      hooks.slots[index] ??= { current: initial };
      return hooks.slots[index];
    },
    useState: <T,>(initial: T) => {
      const hooks = fixture.hooks;
      if (!hooks) return react.useState(initial);
      const index = hooks.cursor++;
      if (!(index in hooks.slots)) hooks.slots[index] = initial;
      return [
        hooks.slots[index],
        (next: T | ((current: T) => T)) => {
          hooks.slots[index] =
            typeof next === "function"
              ? (next as (current: T) => T)(hooks.slots[index] as T)
              : next;
        },
      ];
    },
    useEffect: (run: Effect["run"], deps?: readonly unknown[]) => {
      const hooks = fixture.hooks;
      if (!hooks) return react.useEffect(run, deps);
      const index = hooks.cursor++;
      const previous = hooks.effects.get(index);
      if (previous && deps?.every((value, position) => Object.is(value, previous.deps?.[position])))
        return;
      previous?.cleanup?.();
      const effect = { run, deps };
      hooks.effects.set(index, effect);
      hooks.pending.push(effect);
    },
  };
});

const spatial: PresentationSpatialSnapshot = {
  schemaVersion: 1,
  frames: [
    { blockIndex: 0, x: 0, y: 0, width: 1280, height: 720 },
    { blockIndex: 1, x: 8000, y: 6000, width: 1280, height: 720 },
    { blockIndex: 2, x: 18_000, y: 17_000, width: 1280, height: 720 },
  ],
};
const navigation: PresentationNavigationSnapshot = {
  entries: [
    {
      blockId: "00000000-0000-4000-8000-000000000001",
      title: "Current private title",
      kind: "content",
      sectionId: null,
      sectionTitle: null,
      status: "current",
      phase: "content",
      canJump: false,
      blockedReason: "Already current.",
    },
    {
      blockId: "00000000-0000-4000-8000-000000000002",
      title: "Guarded activity",
      kind: "question",
      sectionId: null,
      sectionTitle: null,
      status: "not_visited",
      phase: null,
      canJump: false,
      blockedReason: "Close the current activity first.",
    },
    {
      blockId: "00000000-0000-4000-8000-000000000003",
      title: "Allowed slide",
      kind: "content",
      sectionId: null,
      sectionTitle: null,
      status: "not_visited",
      phase: null,
      canJump: true,
      blockedReason: null,
    },
  ],
  returnTarget: null,
  canReturn: false,
  blockedReason: null,
};
type Props = Parameters<typeof PresentationSpatialDelivery>[0];
function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement<Record<string, unknown>>(node)) return [];
  return [node, ...elements(node.props.children as ReactNode)];
}
function harness(overrides: Partial<Props> = {}) {
  const hooks: Hooks = { cursor: 0, slots: [], effects: new Map(), pending: [] };
  let props: Props = {
    spatial,
    currentBlockIndex: 0,
    phase: "content",
    sourceKey: "session:version",
    ...overrides,
  };
  const dom = { getBoundingClientRect: () => ({ width: 800, height: 240 }) };
  function render(next: Partial<Props> = {}) {
    props = { ...props, ...next };
    fixture.hooks = hooks;
    hooks.cursor = 0;
    try {
      const wrapper = PresentationSpatialDelivery(props)!;
      const node = (wrapper.type as (props: Props) => ReactNode)(wrapper.props);
      for (const element of elements(node)) {
        if (element.props["data-spatial-view"])
          (element.props.ref as { current: unknown }).current = dom;
      }
      return node;
    } finally {
      fixture.hooks = null;
      for (const effect of hooks.pending.splice(0)) effect.cleanup = effect.run() ?? undefined;
    }
  }
  const result = {
    render,
    dom,
    markup: () => renderToStaticMarkup(render()),
    camera: () =>
      elements(render()).find((element) => element.type === "g" && element.props.style)?.props
        .style,
    diagram: () => elements(render()).find((element) => element.props["data-spatial-view"])!,
    button: (label: string) =>
      elements(render()).find(
        (element) => element.type === "button" && element.props.children === label,
      )!,
    click(label: string) {
      const button = result.button(label);
      expect(button.props.disabled).not.toBe(true);
      (button.props.onClick as () => void)();
    },
    select(blockId: string) {
      const select = elements(render()).find((element) => element.type === "select")!;
      (select.props.onChange as (event: unknown) => void)({ target: { value: blockId } });
    },
    unmount: () => hooks.effects.forEach((effect) => effect.cleanup?.()),
  };
  render();
  return result;
}
function setupObserver() {
  let resize: () => void = () => undefined;
  const observe = vi.fn(),
    disconnect = vi.fn();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: () => void) {
        resize = callback;
      }
      observe = observe;
      disconnect = disconnect;
    },
  );
  return { observe, disconnect, resize: () => resize() };
}
afterEach(() => {
  fixture.hooks = null;
  vi.unstubAllGlobals();
});

describe("geometry-only live presentation spatial delivery", () => {
  it("preserves legacy linear delivery and exposes only numbered geometry to audiences", () => {
    expect(
      PresentationSpatialDelivery({ currentBlockIndex: 0, phase: "content", sourceKey: "legacy" }),
    ).toBeNull();
    const markup = renderToStaticMarkup(
      <PresentationSpatialDelivery
        spatial={spatial}
        currentBlockIndex={0}
        phase="content"
        sourceKey="audience"
      />,
    );
    expect(markup).toContain('aria-label="Presentation spatial path"');
    expect(markup).toContain('aria-hidden="true" focusable="false"');
    expect(markup.match(/data-spatial-page=/g)).toHaveLength(3);
    expect(markup).toContain("Page 1 of 3");
    expect(markup).not.toContain("Current private title");
    expect(markup).not.toContain("00000000-");
    expect(markup).not.toContain("Jump to page");
  });

  it("provides local overview and linear toggles without moving focus or dispatching commands", () => {
    setupObserver();
    const focus = vi.fn();
    const activeElement = { focus };
    vi.stubGlobal("document", { activeElement });
    const onJump = vi.fn();
    const panel = harness({ navigation, onJump });
    const initial = panel.camera();
    panel.click("Show overview");
    expect(panel.diagram().props["data-spatial-view"]).toBe("overview");
    expect(panel.camera()).not.toEqual(initial);
    panel.render({ currentBlockIndex: 1, phase: "question_open" });
    expect(panel.diagram().props["data-spatial-view"]).toBe("overview");
    panel.click("Focus current page");
    expect(panel.diagram().props["data-spatial-view"]).toBe("current");
    panel.click("Use linear view");
    expect(panel.diagram().props.hidden).toBe(true);
    expect(panel.button("Use spatial view").props["aria-pressed"]).toBe(true);
    panel.click("Use spatial view");
    expect(panel.diagram().props.hidden).toBe(false);
    expect(document.activeElement).toBe(activeElement);
    expect(focus).not.toHaveBeenCalled();
    expect(onJump).not.toHaveBeenCalled();
    panel.unmount();
  });

  it("defaults lobby and finished to overview, resets view for a new immutable source", () => {
    setupObserver();
    const panel = harness({ currentBlockIndex: -1, phase: "lobby" });
    expect(panel.markup()).toContain("Overview · 3 pages");
    expect(panel.button("Focus current page").props.disabled).toBe(true);
    panel.render({ currentBlockIndex: 1, phase: "content" });
    expect(panel.diagram().props["data-spatial-view"]).toBe("current");
    panel.render({ phase: "finished" });
    expect(panel.diagram().props["data-spatial-view"]).toBe("overview");
    expect(panel.markup()).toContain("Presentation complete · 3 pages");
    const oldSource = PresentationSpatialDelivery({
      spatial,
      currentBlockIndex: 1,
      phase: "content",
      sourceKey: "old",
    });
    const newSource = PresentationSpatialDelivery({
      spatial,
      currentBlockIndex: 1,
      phase: "content",
      sourceKey: "new",
    });
    expect(oldSource?.key).not.toBe(newSource?.key);
    panel.unmount();
  });

  it("uses exact private target IDs and current server guards without optimistic camera movement", () => {
    setupObserver();
    const onJump = vi.fn();
    const panel = harness({ navigation, onJump });
    const currentCamera = panel.camera();
    panel.select(navigation.entries[1]!.blockId);
    expect(panel.button("Jump to selected page").props.disabled).toBe(true);
    expect(panel.markup()).toContain("Close the current activity first.");
    // The callback is guarded too, even if an old click arrives after the control becomes disabled.
    (panel.button("Jump to selected page").props.onClick as () => void)();
    expect(onJump).not.toHaveBeenCalled();
    panel.select(navigation.entries[2]!.blockId);
    panel.click("Jump to selected page");
    expect(onJump).toHaveBeenCalledExactlyOnceWith(navigation.entries[2]!.blockId);
    expect(panel.camera()).toEqual(currentCamera);
    panel.render({ disabled: true });
    expect(panel.button("Jump to selected page").props.disabled).toBe(true);
    (panel.button("Jump to selected page").props.onClick as () => void)();
    expect(onJump).toHaveBeenCalledTimes(1);
    panel.unmount();
  });

  it("follows only the accepted snapshot cursor after a stale reconnect or acknowledgement", () => {
    setupObserver();
    const panel = harness();
    let accepted = {
      seq: 4,
      revision: 4,
      serverTime: "2026-11-05T12:00:04Z",
      currentBlockIndex: 0,
    };
    const apply = (incoming: typeof accepted) => {
      if (shouldApplyPresentationSnapshot(accepted, incoming)) accepted = incoming;
      panel.render({ currentBlockIndex: accepted.currentBlockIndex });
    };
    apply({ ...accepted, seq: 8, revision: 8, currentBlockIndex: 2 });
    const confirmedCamera = panel.camera();
    expect(panel.markup()).toContain("Page 3 of 3");
    apply({ seq: 7, revision: 7, serverTime: "2026-11-05T12:00:20Z", currentBlockIndex: 1 });
    expect(panel.camera()).toEqual(confirmedCamera);
    expect(panel.markup()).toContain("Page 3 of 3");
    panel.unmount();
  });

  it("refits on actual element size changes and releases its observer", () => {
    const observer = setupObserver();
    const panel = harness();
    const initial = panel.camera();
    panel.dom.getBoundingClientRect = () => ({ width: 320, height: 150 });
    observer.resize();
    expect(panel.camera()).not.toEqual(initial);
    const narrowCamera = panel.camera();
    expect(observer.observe).toHaveBeenCalledExactlyOnceWith(panel.dom);
    panel.click("Use linear view");
    panel.dom.getBoundingClientRect = () => ({ width: 0, height: 0 });
    observer.resize();
    expect(panel.camera()).toEqual(narrowCamera);
    panel.unmount();
    expect(observer.disconnect).toHaveBeenCalledTimes(1);
  });

  it("keeps the current ordinal visible above overlapping frames without reordering the path", () => {
    setupObserver();
    const overlapped: PresentationSpatialSnapshot = {
      schemaVersion: 1,
      frames: [spatial.frames[0]!, { ...spatial.frames[0]!, blockIndex: 1 }, spatial.frames[2]!],
    };
    const panel = harness({ spatial: overlapped, currentBlockIndex: 0 });
    const nodes = elements(panel.render());
    const paintedFrames = nodes.filter((element) => element.props["data-spatial-page"]);
    expect(paintedFrames.map((element) => element.props["data-spatial-page"])).toEqual([2, 3, 1]);
    expect(paintedFrames.at(-1)?.props["data-current"]).toBe(true);
    expect(
      elements(paintedFrames.at(-1)).find((element) => element.type === "text")?.props.children,
    ).toBe(1);
    expect(nodes.find((element) => element.type === "polyline")?.props.points).toBe(
      "640,360 640,360 18640,17360",
    );
    expect(overlapped.frames.map((frame) => frame.blockIndex)).toEqual([0, 1, 2]);
    panel.unmount();
  });

  it("bounds camera motion and removes it for reduced motion without changing document order", () => {
    const css = readFileSync(
      new URL("./presentation-spatial-delivery.module.css", import.meta.url),
      "utf8",
    );
    expect(css).toMatch(/transition:\s*transform 300ms ease-out/);
    expect(css).toMatch(
      /@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*transition-duration:\s*0ms/,
    );
    expect(css).not.toMatch(/\border\s*:/);
  });
});
