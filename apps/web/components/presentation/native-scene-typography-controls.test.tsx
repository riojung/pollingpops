import { isValidElement, type ReactElement, type ReactNode } from "react";
import type * as ReactModule from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  plainTextToPresentationRichText,
  supportedLocales,
  type PresentationSceneNode,
} from "@openround/contracts";
import { NativeSceneTypographyControls } from "./native-scene-typography-controls";
import { nativeInspectorCopy } from "./native-inspector-copy";

const mocked = vi.hoisted(() => ({ hooks: null as { cursor: number; slots: unknown[] } | null }));
vi.mock("react", async (original) => {
  const react = await original<typeof ReactModule>();
  return {
    ...react,
    useState: <T,>(initial: T) => {
      const hooks = mocked.hooks;
      if (!hooks) return react.useState(initial);
      const index = hooks.cursor++;
      if (!(index in hooks.slots)) hooks.slots[index] = initial;
      return [
        hooks.slots[index] as T,
        (next: T) => {
          hooks.slots[index] = next;
        },
      ];
    },
  };
});
afterEach(() => {
  mocked.hooks = null;
});
type TextNode = Extract<PresentationSceneNode, { type: "text" }>;
const fixture = (): TextNode => ({
  id: "body",
  type: "text",
  role: "body",
  text: "Authored words",
  richText: plainTextToPresentationRichText("Authored words"),
  frame: { x: 10, y: 30, width: 60, height: 40 },
  typography: { weight: 700, align: "center", leading: 1.2, color: "accent" },
});
function elements(node: ReactNode): ReactElement<Record<string, any>>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement<Record<string, any>>(node)) return [];
  return [node, ...elements(node.props.children as ReactNode)];
}
function harness() {
  const hooks = { cursor: 0, slots: [] as unknown[] };
  let node = fixture();
  let tree: ReactNode;
  const onChange = vi.fn((next: TextNode, _field?: string) => {
    node = next;
  });
  function render() {
    hooks.cursor = 0;
    mocked.hooks = hooks;
    tree = NativeSceneTypographyControls({ node, locale: "en-CA", onChange });
    mocked.hooks = null;
  }
  function field(label: string) {
    return elements(tree).find((element) => element.props["aria-label"] === label)!;
  }
  render();
  return {
    onChange,
    render,
    field,
    get node() {
      return node;
    },
    change(label: string, value: string) {
      field(label).props.onChange({
        target: { value, valueAsNumber: value === "" ? NaN : Number(value) },
      });
      render();
    },
    upstream(next: TextNode) {
      node = next;
      render();
    },
  };
}

describe("object typography controls", () => {
  it("persists the supported system font and bounded size while retaining authored rich text and other typography", () => {
    const editor = harness();
    const original = structuredClone(editor.node);
    editor.change("Font family", "mono");
    editor.change("Font size (px)", "72");
    expect(editor.node).toEqual({
      ...original,
      typography: { ...original.typography, font: "mono", size: 72 },
    });
    expect(editor.onChange.mock.calls.map((call) => call[1])).toEqual([
      "typography:font",
      "typography:size",
    ]);
    editor.change("Font family", "");
    editor.change("Font size (px)", "");
    expect(editor.node).toEqual(original);
  });

  it("allows incomplete numeric entry, rejects out-of-range sizes, and follows undo/redo without reviving an invalid draft", () => {
    const editor = harness();
    editor.change("Font size (px)", "4");
    expect(editor.field("Font size (px)").props.value).toBe("4");
    expect(editor.onChange).not.toHaveBeenCalled();
    editor.change("Font size (px)", "48");
    const at48 = editor.node;
    editor.change("Font size (px)", "72");
    const at72 = editor.node;
    editor.change("Font size (px)", "720");
    expect(editor.node.typography?.size).toBe(72);
    editor.upstream(at48);
    editor.upstream(at72);
    expect(editor.field("Font size (px)").props.value).toBe("72");
    editor.change("Font size (px)", "11");
    editor.field("Font size (px)").props.onBlur();
    editor.render();
    expect(editor.field("Font size (px)").props.value).toBe("72");
    editor.change("Font family", "remote-font");
    expect(editor.node.typography?.font).toBeUndefined();
    expect(editor.onChange).toHaveBeenCalledTimes(2);
  });

  it.each(supportedLocales)(
    "localizes typography controls in %s without translating authored content",
    (locale) => {
      const html = renderToStaticMarkup(
        <NativeSceneTypographyControls node={fixture()} locale={locale} onChange={vi.fn()} />,
      );
      expect(html).toContain(nativeInspectorCopy(locale)("Font family"));
      expect(html).toContain(nativeInspectorCopy(locale)("Font size (px)"));
      if (locale !== "en-CA")
        expect(nativeInspectorCopy(locale)("Font family")).not.toBe("Font family");
    },
  );
});
