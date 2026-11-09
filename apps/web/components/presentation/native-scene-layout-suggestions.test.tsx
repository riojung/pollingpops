import { isValidElement, type ComponentProps, type ReactElement, type ReactNode } from "react";
import type * as ReactModule from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PresentationScene } from "@openround/contracts";
import { createNativeContentBlock } from "../../lib/presentation-native-scene";
import { createNativeTableNode } from "../../lib/presentation-native-data";
import { suggestNativeLayouts } from "../../lib/presentation-layout-suggestions";
interface Slot {
  value?: unknown;
  deps?: readonly unknown[];
  cleanup?: void | (() => void);
}
interface Hooks {
  cursor: number;
  slots: Slot[];
  effects: Array<() => void>;
  dirty: boolean;
}
const fixture = vi.hoisted(() => ({ hooks: null as Hooks | null }));
vi.mock("react", async (original) => {
  const react = await original<typeof ReactModule>();
  return {
    ...react,
    useState: <T,>(initial: T | (() => T)) => {
      const hooks = fixture.hooks;
      if (!hooks) return react.useState(initial);
      const index = hooks.cursor++;
      hooks.slots[index] ??= {
        value: typeof initial === "function" ? (initial as () => T)() : initial,
      };
      return [
        hooks.slots[index]!.value as T,
        (next: T | ((value: T) => T)) => {
          const before = hooks.slots[index]!.value as T;
          const value = typeof next === "function" ? (next as (value: T) => T)(before) : next;
          if (!Object.is(before, value)) hooks.dirty = true;
          hooks.slots[index]!.value = value;
        },
      ];
    },
    useRef: <T,>(initial: T) => {
      const hooks = fixture.hooks;
      if (!hooks) return react.useRef(initial);
      const index = hooks.cursor++;
      hooks.slots[index] ??= { value: { current: initial } };
      return hooks.slots[index]!.value;
    },
    useId: () => {
      const hooks = fixture.hooks;
      if (!hooks) return react.useId();
      const index = hooks.cursor++;
      hooks.slots[index] ??= { value: `layout-review-${index}` };
      return hooks.slots[index]!.value;
    },
    useEffect: (effect: () => void | (() => void), deps?: readonly unknown[]) => {
      const hooks = fixture.hooks;
      if (!hooks) return react.useEffect(effect, deps);
      const index = hooks.cursor++;
      const previous = hooks.slots[index];
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
import {
  NativeLayoutReadingContent,
  NativeSceneLayoutSuggestions,
} from "./native-scene-layout-suggestions";
import { NativeSceneView } from "./native-scene-view";

function nodes(tree: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  if (!isValidElement<Record<string, unknown>>(tree)) return [];
  return [tree, ...nodes(tree.props.children as ReactNode)];
}
function scene(): PresentationScene {
  const result = createNativeContentBlock().scene!;
  const title = result.nodes[0]!;
  if (title.type !== "text") throw new Error("Expected title");
  title.text = "Complete slide title";
  result.nodes.push({
    id: "Body:ExactCase",
    type: "text",
    role: "body",
    text: "Full body text with a deliberate limitation.\nThe second line remains readable.",
    frame: { x: 10, y: 40, width: 55, height: 35 },
  });
  result.readingOrder.push("Body:ExactCase");
  return result;
}
function harness() {
  const hooks: Hooks = { cursor: 0, slots: [], effects: [], dirty: true };
  const props: ComponentProps<typeof NativeSceneLayoutSuggestions> = {
    scene: scene(),
    sourceKey: "slide-one",
    disabled: false,
    onChange: vi.fn(),
  };
  const trigger = { isConnected: true, disabled: false, focus: vi.fn() };
  const nativeDialog = {
    open: false,
    showModal: vi.fn(() => {
      nativeDialog.open = true;
    }),
    close: vi.fn(() => {
      nativeDialog.open = false;
    }),
  };
  let tree: ReactNode;
  let dialogRef: { current: unknown } | undefined;
  const render = () => {
    hooks.cursor = 0;
    hooks.dirty = false;
    fixture.hooks = hooks;
    try {
      tree = NativeSceneLayoutSuggestions(props);
    } finally {
      fixture.hooks = null;
    }
    const elements = nodes(tree);
    const button = elements.find(
      (node) => node.type === "button" && node.props.children === "Suggest layouts",
    )!;
    trigger.disabled = Boolean(button.props.disabled);
    (button.props.ref as { current: unknown }).current = trigger;
    const dialog = elements.find((node) => node.type === "dialog");
    if (dialog) {
      dialogRef = dialog.props.ref as { current: unknown };
      dialogRef.current = nativeDialog;
    } else if (dialogRef) dialogRef.current = null;
    for (const effect of hooks.effects.splice(0)) effect();
  };
  const flush = () => {
    for (let index = 0; index < 12; index++) {
      if (hooks.dirty) render();
    }
  };
  const button = (label: string) => {
    const found = nodes(tree).find(
      (node) => node.type === "button" && node.props.children === label,
    );
    if (!found) throw new Error(`Missing ${label}`);
    return found;
  };
  render();
  flush();
  return {
    props,
    trigger,
    nativeDialog,
    render,
    flush,
    button,
    open() {
      (button("Suggest layouts").props.onClick as () => void)();
      flush();
    },
    get elements() {
      return nodes(tree);
    },
    get dialog() {
      return nodes(tree).find((node) => node.type === "dialog");
    },
    unmount() {
      for (const slot of hooks.slots) slot.cleanup?.();
    },
  };
}
afterEach(() => {
  fixture.hooks = null;
  vi.unstubAllGlobals();
});
describe("reviewed local native layout suggestions", () => {
  it("opens a native modal with radio choices and retains its top-layer session while choosing", () => {
    const h = harness();
    h.open();
    expect(h.dialog?.props.open).toBeUndefined();
    expect(h.dialog?.props["aria-modal"]).toBe("true");
    expect(h.nativeDialog.showModal).toHaveBeenCalledOnce();
    const radios = h.elements.filter(
      (node) => node.type === "input" && node.props.type === "radio",
    );
    expect(radios).toHaveLength(suggestNativeLayouts(h.props.scene).length);
    expect(radios[0]!.props.checked).toBe(true);
    (radios[1]!.props.onChange as () => void)();
    h.flush();
    expect(h.nativeDialog.showModal).toHaveBeenCalledOnce();
    expect(h.props.onChange).not.toHaveBeenCalled();
    expect(h.elements.some((node) => node.props.kind === "current")).toBe(true);
    expect(h.elements.some((node) => node.props.kind === "selected")).toBe(true);
    const previews = h.elements.filter(
      (node) => node.props.kind === "current" || node.props.kind === "selected",
    );
    const markup = renderToStaticMarkup(<>{previews}</>);
    expect(markup.match(/aria-hidden="true" inert=""/g)).toHaveLength(2);
    expect(markup.match(/width:1280px;height:720px/g)).toHaveLength(2);
    expect(markup.match(/data-native-fixed-layout="true"/g)).toHaveLength(2);
    expect(markup.match(/data-native-fit-feedback="true"/g)).toHaveLength(2);
  });
  it("cancels and handles Escape without changing the slide, returning focus to the trigger", () => {
    const h = harness();
    h.open();
    const event = { preventDefault: vi.fn() };
    (h.dialog!.props.onCancel as (event: unknown) => void)(event);
    h.flush();
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(h.dialog).toBeUndefined();
    expect(h.props.onChange).not.toHaveBeenCalled();
    expect(h.nativeDialog.close).toHaveBeenCalledOnce();
    expect(h.trigger.focus).toHaveBeenCalled();
    h.open();
    (h.button("Cancel").props.onClick as () => void)();
    h.flush();
    expect(h.props.onChange).not.toHaveBeenCalled();
  });
  it("applies the selected geometry once without a history coalescing key or service call", () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const h = harness();
    const source = structuredClone(h.props.scene);
    h.open();
    const radios = h.elements.filter(
      (node) => node.type === "input" && node.props.type === "radio",
    );
    const chosen = radios.at(-1)!;
    (chosen.props.onChange as () => void)();
    h.flush();
    const apply = h.button("Apply reviewed layout").props.onClick as () => void;
    apply();
    apply();
    h.flush();
    expect(h.props.onChange).toHaveBeenCalledOnce();
    expect((h.props.onChange as ReturnType<typeof vi.fn>).mock.calls[0]).toHaveLength(1);
    expect((h.props.onChange as ReturnType<typeof vi.fn>).mock.calls[0]![0]).toEqual(
      suggestNativeLayouts(source).find((item) => item.id === chosen.props.value)!.scene,
    );
    expect(h.props.scene).toEqual(source);
    expect(fetch).not.toHaveBeenCalled();
    expect(h.dialog).toBeUndefined();
  });
  it("keeps review open after a validation rejection and allows an explicit retry", () => {
    const h = harness();
    (h.props.onChange as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true);
    h.open();
    (h.button("Apply reviewed layout").props.onClick as () => void)();
    h.flush();
    expect(h.dialog).toBeDefined();
    expect(h.elements.some((node) => node.props.role === "alert")).toBe(true);
    expect(h.nativeDialog.open).toBe(true);
    (h.button("Apply reviewed layout").props.onClick as () => void)();
    h.flush();
    expect(h.props.onChange).toHaveBeenCalledTimes(2);
    expect(h.dialog).toBeUndefined();
  });
  it.each(["scene", "source-key", "permission"] as const)(
    "invalidates a reviewed candidate when its %s changes, including queued Apply",
    (change) => {
      const h = harness();
      h.open();
      const staleApply = h.button("Apply reviewed layout").props.onClick as () => void;
      if (change === "scene")
        h.props.scene = {
          ...h.props.scene,
          schemaVersion: 3,
          design: { theme: "paper", font: "serif", spacing: "relaxed" },
        };
      else if (change === "source-key") h.props.sourceKey = "another-slide-with-identical-content";
      else h.props.disabled = true;
      h.render();
      staleApply();
      h.flush();
      expect(h.props.onChange).not.toHaveBeenCalled();
      expect(h.dialog).toBeUndefined();
    },
  );
  it("rejects the old Apply event after a different radio choice and after unmount", () => {
    const h = harness();
    h.open();
    const staleApply = h.button("Apply reviewed layout").props.onClick as () => void;
    const radio = h.elements.filter(
      (node) => node.type === "input" && node.props.type === "radio",
    )[1]!;
    (radio.props.onChange as () => void)();
    h.flush();
    staleApply();
    expect(h.props.onChange).not.toHaveBeenCalled();
    const selectedApply = h.button("Apply reviewed layout").props.onClick as () => void;
    h.unmount();
    selectedApply();
    expect(h.props.onChange).not.toHaveBeenCalled();
  });
  it("explains unsupported scenes without generating or applying a partial layout", () => {
    const h = harness();
    h.props.scene = {
      ...h.props.scene,
      schemaVersion: 4,
      groups: [{ id: "group", nodeIds: h.props.scene.nodes.map((node) => node.id) }],
    };
    h.render();
    expect(h.button("Suggest layouts").props.disabled).toBe(true);
    expect(JSON.stringify(h.elements)).toContain("grouped objects");
    (h.button("Suggest layouts").props.onClick as () => void)();
    h.flush();
    expect(h.dialog).toBeUndefined();
    expect(h.props.onChange).not.toHaveBeenCalled();
  });
  it("provides complete readable rich text and table data in authored reading order", () => {
    const source = scene();
    const body = source.nodes[1]!;
    if (body.type !== "text") throw new Error("Expected body");
    body.richText = { paragraphs: [{ kind: "bullet", runs: [{ text: body.text, bold: true }] }] };
    const table = createNativeTableNode();
    table.caption = "Full comparison";
    table.headers = ["Option", "Complete limitation"];
    table.rows = [["A", "The full cell remains available without clipping."]];
    source.schemaVersion = 4;
    source.nodes.push(table);
    source.readingOrder = [body.id, table.id, source.nodes[0]!.id];
    const markup = renderToStaticMarkup(<NativeLayoutReadingContent scene={source} />);
    expect(markup).toContain('aria-label="Complete slide content"');
    expect(markup).toContain(body.text);
    expect(markup).toContain("The full cell remains available without clipping.");
    expect(markup.indexOf(body.text)).toBeLessThan(markup.indexOf("Full comparison"));
    expect(markup.indexOf("Full comparison")).toBeLessThan(markup.indexOf("Complete slide title"));
    expect(markup).toContain("<strong>");
    const fixed = renderToStaticMarkup(<NativeSceneView scene={source} fixedLayout />);
    expect(fixed.match(/data-native-fixed-layout="true"/g)).toHaveLength(2);
    const normal = renderToStaticMarkup(<NativeSceneView scene={source} />);
    expect(normal).not.toContain('data-native-fixed-layout="true"');
  });
  it("preserves authored languages in both plain and rich reading content", () => {
    const source = scene();
    source.schemaVersion = 7;
    const title = source.nodes[0]!;
    const body = source.nodes[1]!;
    if (title.type !== "text" || body.type !== "text") throw new Error("Expected text");
    title.text = "Une proposition";
    title.lang = "fr";
    body.lang = "de";
    body.text = "Ein Vorschlag";
    body.richText = { paragraphs: [{ kind: "paragraph", runs: [{ text: body.text }] }] };
    const markup = renderToStaticMarkup(<NativeLayoutReadingContent scene={source} />);
    expect(markup).toContain('<p lang="fr">Une proposition</p>');
    expect(markup).toMatch(/<div[^>]*lang="de"[^>]*><p>Ein Vorschlag<\/p><\/div>/);
    expect(markup).toContain("<h4>Title</h4>");
  });
});
