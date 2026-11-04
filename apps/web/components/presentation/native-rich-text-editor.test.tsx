import { isValidElement, type ReactElement, type ReactNode } from "react";
import type * as ReactModule from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { plainTextToPresentationRichText, type PresentationSceneNode } from "@openround/contracts";
import { NativeRichTextEditor } from "./native-rich-text-editor";
import { toggleNativeRichTextMark } from "../../lib/presentation-rich-text";

const mocked = vi.hoisted(() => ({
  hooks: null as { cursor: number; slots: unknown[]; cleanups: (() => void)[] } | null,
}));
vi.mock("react", async (original) => {
  const react = await original<typeof ReactModule>();
  return {
    ...react,
    useCallback: <T extends (...arguments_: any[]) => any>(
      callback: T,
      dependencies: unknown[],
    ) => {
      if (!mocked.hooks) return react.useCallback(callback, dependencies);
      return callback;
    },
    useEffect: (effect: () => void | (() => void), dependencies: unknown[]) => {
      if (!mocked.hooks) return react.useEffect(effect, dependencies);
      const cleanup = effect();
      if (cleanup) mocked.hooks.cleanups.push(cleanup);
    },
    useState: <T,>(initial: T) => {
      const hooks = mocked.hooks;
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
    useRef: <T,>(initial: T) => {
      const hooks = mocked.hooks;
      if (!hooks) return react.useRef(initial);
      const index = hooks.cursor++;
      if (!(index in hooks.slots)) hooks.slots[index] = { current: initial };
      return hooks.slots[index];
    },
  };
});
function elements(node: ReactNode): ReactElement<Record<string, any>>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement<Record<string, any>>(node)) return [];
  return [node, ...elements(node.props.children as ReactNode)];
}
function harness(
  history: { onUndo?: () => void; onRedo?: () => void } = {},
  initialSelection: [number, number] = [0, 0],
) {
  const listeners = new Map<string, (event: Event) => void>();
  const documentState = { activeElement: null as unknown };
  const element = {
    selectionStart: initialSelection[0],
    selectionEnd: initialSelection[1],
    focus: vi.fn(() => {
      documentState.activeElement = element;
    }),
    setSelectionRange(start: number, end: number) {
      this.selectionStart = start;
      this.selectionEnd = end;
      listeners.get("select")?.(new Event("select"));
    },
    addEventListener(type: string, listener: (event: Event) => void) {
      listeners.set(type, listener);
    },
    removeEventListener(type: string) {
      listeners.delete(type);
    },
  };
  const hooks = {
    cursor: 0,
    slots: [{ current: element }] as unknown[],
    cleanups: [] as (() => void)[],
  };
  let node: Extract<PresentationSceneNode, { type: "text" }> = {
    id: "body",
    type: "text",
    role: "body",
    text: "Read the plan",
    frame: { x: 8, y: 35, width: 55, height: 25 },
    richText: plainTextToPresentationRichText("Read the plan"),
  };
  const onChange = vi.fn((next) => {
    node = next;
  });
  let tree: ReactNode;
  const scheduled: (() => void)[] = [];
  const frames = new Map<number, () => void>();
  let nextFrame = 0;
  documentState.activeElement = element;
  vi.stubGlobal("document", documentState);
  vi.stubGlobal("requestAnimationFrame", (callback: () => void) => {
    nextFrame += 1;
    frames.set(nextFrame, callback);
    scheduled.push(callback);
    return nextFrame;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  function render() {
    hooks.cursor = 0;
    mocked.hooks = hooks;
    try {
      tree = NativeRichTextEditor({ node, onChange, ...history });
    } finally {
      mocked.hooks = null;
    }
  }
  function find(predicate: (element: ReactElement<Record<string, any>>) => boolean) {
    const found = elements(tree).find(predicate);
    if (!found) throw new Error("Missing rich text control");
    return found;
  }
  render();
  return {
    onChange,
    node: () => node,
    render,
    find,
    element,
    activeElement: () => documentState.activeElement,
    focusOther(target: unknown) {
      documentState.activeElement = target;
      (tree as ReactElement<Record<string, any>>).props.onFocusCapture();
    },
    flushRestores(includeCanceled = false) {
      const callbacks = includeCanceled ? scheduled.splice(0) : [...frames.values()];
      frames.clear();
      callbacks.forEach((callback) => callback());
    },
    unmount: () => hooks.cleanups.forEach((cleanup) => cleanup()),
    restoreSelection: (start: number, end: number) => element.setSelectionRange(start, end),
    select(start: number, end: number) {
      documentState.activeElement = element;
      element.setSelectionRange(start, end);
      find((element) => element.type === "textarea").props.onSelect({
        currentTarget: { selectionStart: start, selectionEnd: end },
      });
      render();
    },
    click(label: string) {
      find(
        (element) => element.type === "button" && element.props.children === label,
      ).props.onClick();
    },
    beforeInput(inputType: string, cancelable = true) {
      const event = new Event("beforeinput", { cancelable });
      Object.defineProperty(event, "inputType", { value: inputType });
      listeners.get("beforeinput")?.(event);
      return event;
    },
  };
}
afterEach(() => vi.unstubAllGlobals());

describe("native formatting controls", () => {
  it("does not let an older paragraph restore overwrite a newer selection or blurred toolbar range", () => {
    const editor = harness();
    editor.select(5, 8);
    editor
      .find((element) => element.type === "select")
      .props.onChange({ target: { value: "bullet" } });
    editor.restoreSelection(9, 13);
    editor.render();
    const linkField = {};
    editor.focusOther(linkField);
    // A late native select from the blurred textarea must not replace the deliberate plan range.
    editor.restoreSelection(5, 8);
    editor.render();
    // Execute even canceled callbacks, as though a frame was already queued for delivery.
    editor.flushRestores(true);
    expect(editor.activeElement()).toBe(linkField);
    expect(editor.element.focus).not.toHaveBeenCalled();
    editor
      .find((element) => element.type === "input")
      .props.onChange({ target: { value: "https://example.com/plan" } });
    editor.render();
    editor.click("Apply link");
    expect(editor.node().richText!.paragraphs[0]!.runs).toEqual([
      { text: "Read the " },
      { text: "plan", href: "https://example.com/plan" },
    ]);
  });

  it("cancels a pending restore when another control gains focus or the editor unmounts", () => {
    const editor = harness();
    editor.select(5, 8);
    editor.click("Bold");
    const otherControl = {};
    editor.focusOther(otherControl);
    editor.flushRestores(true);
    expect(editor.activeElement()).toBe(otherControl);
    expect(editor.element.focus).not.toHaveBeenCalled();
    const removed = harness();
    removed.select(5, 8);
    removed.click("Bold");
    removed.unmount();
    removed.flushRestores(true);
    expect(removed.element.focus).not.toHaveBeenCalled();
  });

  it("reads a selection restored before the native listener subscribes", () => {
    const editor = harness({}, [5, 8]);
    // The mount effect observes the existing DOM range without a select or keyboard event.
    editor.render();
    expect(
      editor.find((element) => element.type === "button" && element.props.children === "Bold").props
        .disabled,
    ).toBe(false);
    editor.click("Bold");
    expect(editor.node().richText!.paragraphs[0]!.runs).toEqual([
      { text: "Read " },
      { text: "the", bold: true },
      { text: " plan" },
    ]);
  });

  it("synchronizes a DOM-restored selection before applying emphasis and links without another key", () => {
    const editor = harness();
    expect(
      editor.find((element) => element.type === "button" && element.props.children === "Bold").props
        .disabled,
    ).toBe(true);
    editor.restoreSelection(5, 8);
    editor.render();
    expect(
      editor.find((element) => element.type === "button" && element.props.children === "Bold").props
        .disabled,
    ).toBe(false);
    editor.click("Bold");
    editor.render();
    editor
      .find((element) => element.type === "input" && element.props["aria-label"] === "Link address")
      .props.onChange({ target: { value: "https://example.com/restored" } });
    editor.render();
    editor.click("Apply link");
    expect(editor.node().richText!.paragraphs[0]!.runs).toEqual([
      { text: "Read " },
      { text: "the", bold: true, href: "https://example.com/restored" },
      { text: " plan" },
    ]);
  });

  it("routes keyboard Undo and Redo through document history instead of the textarea's plain history", () => {
    const onUndo = vi.fn();
    const onRedo = vi.fn();
    const editor = harness({ onUndo, onRedo });
    const input = editor.find((element) => element.type === "textarea");
    for (const [key, metaKey, ctrlKey, shiftKey] of [
      ["z", true, false, false],
      ["z", false, true, true],
      ["y", false, true, false],
    ] as const) {
      const event = {
        key,
        metaKey,
        ctrlKey,
        shiftKey,
        altKey: false,
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
      };
      input.props.onKeyDown(event);
      expect(event.preventDefault).toHaveBeenCalled();
      expect(event.stopPropagation).toHaveBeenCalled();
    }
    expect(onUndo).toHaveBeenCalledTimes(1);
    expect(onRedo).toHaveBeenCalledTimes(2);
    expect(editor.onChange).not.toHaveBeenCalled();
  });

  it.each([true, false])(
    "consumes native history input once after cancelable=%s beforeinput",
    (cancelable) => {
      const onUndo = vi.fn();
      const editor = harness({ onUndo });
      editor.node().text = "aa";
      editor.node().richText = toggleNativeRichTextMark(
        plainTextToPresentationRichText("aa"),
        0,
        1,
        "bold",
      );
      editor.render();
      const before = editor.beforeInput("historyUndo", cancelable);
      expect(before.defaultPrevented).toBe(cancelable);
      expect(onUndo).toHaveBeenCalledTimes(1);
      editor
        .find((element) => element.type === "textarea")
        .props.onChange({
          nativeEvent: { inputType: "historyUndo", data: null },
          target: { value: "a" },
        });
      expect(onUndo).toHaveBeenCalledTimes(1);
      expect(editor.onChange).not.toHaveBeenCalled();
      expect(editor.node().richText!.paragraphs[0]!.runs).toEqual([
        { text: "a", bold: true },
        { text: "a" },
      ]);
    },
  );

  it("handles native history without beforeinput and protects a standalone editor without history callbacks", () => {
    const onRedo = vi.fn();
    const editor = harness({ onRedo });
    editor
      .find((element) => element.type === "textarea")
      .props.onChange({
        nativeEvent: { inputType: "historyRedo", data: null },
        target: { value: "different native history" },
      });
    expect(onRedo).toHaveBeenCalledTimes(1);
    expect(editor.onChange).not.toHaveBeenCalled();
    const standalone = harness();
    standalone.beforeInput("historyUndo", false);
    standalone.render();
    expect(standalone.find((element) => element.props.role === "alert").props.children).toBe(
      "Undo and Redo are unavailable in this view.",
    );
    expect(standalone.onChange).not.toHaveBeenCalled();
  });

  it("maps real deletion input to its caret range when repeated characters have different marks", () => {
    const editor = harness();
    editor.node().text = "aa";
    editor.node().richText = toggleNativeRichTextMark(
      plainTextToPresentationRichText("aa"),
      0,
      1,
      "bold",
    );
    editor.render();
    const text = editor.find((element) => element.type === "textarea");
    text.props.onChange({
      nativeEvent: { inputType: "deleteContentForward", data: null },
      currentTarget: { selectionStart: 0, selectionEnd: 0 },
      target: { value: "a" },
    });
    expect(editor.node().richText!.paragraphs[0]!.runs).toEqual([{ text: "a" }]);
    expect(editor.node().text).toBe("a");
  });

  it("accepts an explicitly empty plain-text replacement at the selected formatted range", () => {
    const editor = harness();
    editor.node().text = "aa";
    editor.node().richText = toggleNativeRichTextMark(
      plainTextToPresentationRichText("aa"),
      0,
      1,
      "bold",
    );
    editor.render();
    editor
      .find((element) => element.type === "textarea")
      .props.onPaste({
        preventDefault: vi.fn(),
        currentTarget: { selectionStart: 0, selectionEnd: 1 },
        clipboardData: { types: ["text/plain"], getData: () => "" },
      });
    expect(editor.node().richText!.paragraphs[0]!.runs).toEqual([{ text: "a" }]);
    expect(editor.onChange).toHaveBeenCalledTimes(1);
  });

  it("uses the remembered textarea selection for emphasis and keeps the canonical fallback", () => {
    const editor = harness();
    expect(
      editor.find((element) => element.type === "button" && element.props.children === "Bold").props
        .disabled,
    ).toBe(true);
    editor.select(9, 13);
    editor.click("Bold");
    expect(editor.node().richText!.paragraphs[0]!.runs).toEqual([
      { text: "Read the " },
      { text: "plan", bold: true },
    ]);
    expect(editor.node().text).toBe("Read the plan");
    expect(editor.onChange).toHaveBeenCalledTimes(1);
  });

  it("rejects unsafe links visibly and retains the text selection across link field focus", () => {
    const editor = harness();
    editor.select(9, 13);
    const link = editor.find(
      (element) => element.type === "input" && element.props["aria-label"] === "Link address",
    );
    link.props.onChange({ target: { value: "javascript:alert(1)" } });
    editor.render();
    editor.click("Apply link");
    editor.render();
    expect(editor.onChange).not.toHaveBeenCalled();
    expect(editor.find((element) => element.props.role === "alert").props.children).toMatch(
      /complete http/,
    );
    editor
      .find((element) => element.type === "input")
      .props.onChange({ target: { value: "https://example.com/plan" } });
    editor.render();
    editor.click("Apply link");
    expect(editor.node().richText!.paragraphs[0]!.runs).toEqual([
      { text: "Read the " },
      { text: "plan", href: "https://example.com/plan" },
    ]);
  });

  it("pastes only clipboard text and preserves formatting outside the replacement", () => {
    const editor = harness();
    const clipboard = vi.fn((type: string) =>
      type === "text/plain" ? "New" : "<script>bad()</script>",
    );
    editor.select(0, 4);
    editor.click("Bold");
    editor.render();
    const preventDefault = vi.fn();
    editor
      .find((element) => element.type === "textarea")
      .props.onPaste({
        preventDefault,
        currentTarget: { selectionStart: 9, selectionEnd: 13 },
        clipboardData: { types: ["text/plain", "text/html"], getData: clipboard },
      });
    expect(preventDefault).toHaveBeenCalled();
    expect(clipboard).toHaveBeenCalledWith("text/plain");
    expect(clipboard).toHaveBeenCalledTimes(1);
    expect(editor.node().text).toBe("Read the New");
    expect(editor.node().richText!.paragraphs[0]!.runs[0]).toEqual({ text: "Read", bold: true });
  });

  it.each([
    ["an image", ["image/png"]],
    ["files", ["Files"]],
    ["HTML only", ["text/html"]],
    ["no declared flavor", []],
  ] as const)("keeps selected formatted text when the clipboard contains %s", (_label, types) => {
    const editor = harness();
    editor.node().richText = toggleNativeRichTextMark(editor.node().richText!, 5, 8, "bold");
    editor.render();
    editor.select(5, 8);
    const before = structuredClone(editor.node());
    const selection = [editor.element.selectionStart, editor.element.selectionEnd];
    const getData = vi.fn(() => "");
    const preventDefault = vi.fn();
    editor
      .find((element) => element.type === "textarea")
      .props.onPaste({
        preventDefault,
        currentTarget: editor.element,
        clipboardData: { types, getData },
      });
    editor.render();
    expect(preventDefault).toHaveBeenCalled();
    expect(getData).not.toHaveBeenCalled();
    expect(editor.onChange).not.toHaveBeenCalled();
    expect(editor.node()).toEqual(before);
    expect([editor.element.selectionStart, editor.element.selectionEnd]).toEqual(selection);
    const bold = editor.find(
      (element) => element.type === "button" && element.props.children === "Bold",
    );
    expect(bold.props.disabled).toBe(false);
    expect(bold.props["aria-pressed"]).toBe(true);
  });

  it("validates large pastes and provides an explicit reversible way to remove formatting", () => {
    const editor = harness();
    editor
      .find((element) => element.type === "textarea")
      .props.onPaste({
        preventDefault: vi.fn(),
        currentTarget: { selectionStart: 0, selectionEnd: 0 },
        clipboardData: { types: ["text/plain"], getData: () => "X".repeat(4001) },
      });
    editor.render();
    expect(editor.onChange).not.toHaveBeenCalled();
    expect(editor.find((element) => element.props.role === "alert").props.children).toMatch(
      /exceeds the formatting limits/,
    );
    editor.click("Remove formatting");
    expect(editor.node()).not.toHaveProperty("richText");
    expect(editor.node().text).toBe("Read the plan");
  });
});
