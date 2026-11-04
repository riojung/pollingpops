import { isValidElement, type ReactElement, type ReactNode } from "react";
import type * as ReactModule from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createNativeContentBlock } from "../../lib/presentation-native-scene";
import { NativeSceneEditor } from "./native-scene-editor";
import { NativeSceneCanvas } from "./native-scene-canvas";

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
        (next: T | ((value: T) => T)) => {
          hooks.slots[index] =
            typeof next === "function" ? (next as (value: T) => T)(hooks.slots[index] as T) : next;
        },
      ];
    },
  };
});

function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement<Record<string, unknown>>(node)) return [];
  return [node, ...elements(node.props.children as ReactNode)];
}

function editorHarness(history: { onUndo?: () => void; onRedo?: () => void } = {}) {
  const hooks = { cursor: 0, slots: [] as unknown[] };
  const scene = createNativeContentBlock().scene!;
  scene.nodes.push({
    id: "body",
    type: "text",
    role: "body",
    text: "Evidence",
    frame: { x: 8, y: 35, width: 55, height: 25 },
  });
  scene.readingOrder.push("body");
  const onChange = vi.fn();
  let tree: ReactNode;
  return {
    scene,
    onChange,
    render(mediaState: "idle" | "uploading" | "scanning", attachmentPending = false) {
      hooks.cursor = 0;
      mocked.hooks = hooks;
      try {
        tree = NativeSceneEditor({
          scene,
          onChange,
          renderImage: () => null,
          uploadsEnabled: true,
          mediaState,
          attachmentPending,
          onUploadImage: vi.fn(),
          ...history,
        });
      } finally {
        mocked.hooks = null;
      }
    },
    find(predicate: (element: ReactElement<Record<string, unknown>>) => boolean) {
      const found = elements(tree).find(predicate);
      if (!found) throw new Error("Missing native editor control");
      return found;
    },
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("native text history focus", () => {
  it("keeps keyboard Undo and Redo reachable when formatting replaces the textarea", () => {
    const frames: (() => void)[] = [];
    const body = {};
    const documentState = { body, activeElement: null as unknown };
    let replacement: FakeTextarea;
    const fields = { isConnected: true, querySelector: () => replacement };
    class FakeTextarea {
      isConnected = true;
      selectionStart = 2;
      selectionEnd = 4;
      hasAttribute = (name: string) => name === "data-native-text-input";
      closest = () => fields;
      focus = vi.fn(() => {
        documentState.activeElement = this;
      });
      setSelectionRange = vi.fn();
    }
    const original = new FakeTextarea();
    const plain = new FakeTextarea();
    const rich = new FakeTextarea();
    replacement = plain;
    documentState.activeElement = original;
    vi.stubGlobal("document", documentState);
    vi.stubGlobal("HTMLTextAreaElement", FakeTextarea);
    vi.stubGlobal("requestAnimationFrame", (callback: () => void) => {
      frames.push(callback);
      return 1;
    });
    const onUndo = vi.fn(() => {
      original.isConnected = false;
      documentState.activeElement = body;
    });
    const onRedo = vi.fn(() => {
      plain.isConnected = false;
      documentState.activeElement = body;
      replacement = rich;
    });
    const editor = editorHarness({ onUndo, onRedo });
    editor.render("idle");
    const fieldset = editor.find((element) => element.props["data-native-text-fields"] === "true");
    function key(target: FakeTextarea, shiftKey: boolean) {
      const event = {
        target,
        key: "z",
        metaKey: true,
        ctrlKey: false,
        altKey: false,
        shiftKey,
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
      };
      (fieldset.props.onKeyDown as (event: unknown) => void)(event);
      expect(event.preventDefault).toHaveBeenCalled();
      frames.splice(0).forEach((frame) => frame());
    }
    key(original, false);
    expect(onUndo).toHaveBeenCalledTimes(1);
    expect(documentState.activeElement).toBe(plain);
    expect(plain.setSelectionRange).toHaveBeenCalledWith(2, 4);
    key(plain, true);
    expect(onRedo).toHaveBeenCalledTimes(1);
    expect(documentState.activeElement).toBe(rich);
    expect(rich.setSelectionRange).toHaveBeenCalledWith(2, 4);
  });
});

describe("native upload capacity guard", () => {
  it.each([
    ["uploading", false],
    ["scanning", false],
    ["idle", true],
  ] as const)("blocks new nodes while state=%s and attachmentPending=%s", (state, pending) => {
    const editor = editorHarness();
    editor.render("idle");
    const description = editor.find(
      (element) =>
        element.type === "input" && element.props["aria-label"] === "New image description",
    );
    (description.props.onChange as (event: unknown) => void)({
      target: { value: "Evidence diagram" },
    });
    editor.render(state, pending);
    for (const label of ["Add native text", "Add native shape", "Add native connector"]) {
      const button = editor.find(
        (element) => element.type === "button" && element.props.children === label,
      );
      expect(button.props.disabled).toBe(true);
      // The handler also protects capacity when invoked from a stale/programmatic event.
      (button.props.onClick as () => void)();
    }
    expect(editor.onChange).not.toHaveBeenCalled();
    const upload = editor.find(
      (element) => element.type === "input" && element.props["aria-label"] === "Add native image",
    );
    expect(upload.props.disabled).toBe(true);
    const title = editor.find(
      (element) =>
        element.type === "textarea" && element.props["aria-label"] === "Native slide title",
    );
    expect(title.props.disabled).not.toBe(true);
    (title.props.onChange as (event: unknown) => void)({
      target: { value: "Keep editing during upload" },
    });
    expect(editor.onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        nodes: expect.arrayContaining([
          expect.objectContaining({ text: "Keep editing during upload" }),
        ]),
      }),
      expect.any(String),
    );
    const view = editor.find((element) => element.type === NativeSceneCanvas);
    (view.props.onChange as (scene: unknown) => void)({
      ...editor.scene,
      nodes: editor.scene.nodes.map((node, index) =>
        index === 0 && node.type !== "connector"
          ? { ...node, frame: { x: 12, y: 8, width: 80, height: 20 } }
          : node,
      ),
    });
    expect(editor.onChange).toHaveBeenCalledTimes(2);
    editor.render("idle");
    for (const label of ["Add native text", "Add native shape", "Add native connector"]) {
      expect(
        editor.find((element) => element.type === "button" && element.props.children === label)
          .props.disabled,
      ).toBe(false);
    }
    expect(
      editor.find(
        (element) => element.type === "input" && element.props["aria-label"] === "Add native image",
      ).props.disabled,
    ).toBe(false);
  });
});

describe("native multi-object selection", () => {
  it("opts only the selected text into structured formatting in one scene edit", () => {
    const editor = editorHarness();
    editor.render("idle");
    const format = editor.find(
      (element) => element.type === "button" && element.props.children === "Format text",
    );
    (format.props.onClick as () => void)();
    expect(editor.onChange).toHaveBeenCalledTimes(1);
    const scene = editor.onChange.mock.calls[0]![0];
    expect(scene.schemaVersion).toBe(2);
    expect(scene.nodes[0]).toMatchObject({
      text: "",
      richText: { paragraphs: [{ kind: "paragraph", runs: [{ text: "" }] }] },
    });
    expect(scene.nodes[1]).toEqual(editor.scene.nodes[1]);
    expect(scene.nodes[1]).not.toHaveProperty("richText");
    expect(scene.readingOrder).toEqual(editor.scene.readingOrder);
  });

  it("exposes explicit selection toggles, moves selected frames together and protects the title on batch delete", () => {
    const editor = editorHarness();
    editor.render("idle");
    const includeBody = editor.find(
      (element) =>
        element.type === "input" && element.props["aria-label"] === "Include Evidence in selection",
    );
    expect(includeBody.props.checked).toBe(false);
    (includeBody.props.onChange as () => void)();
    editor.render("idle");
    const canvas = editor.find((element) => element.type === NativeSceneCanvas);
    expect(canvas.props.selectedNodeIds).toEqual([editor.scene.nodes[0]!.id, "body"]);
    const move = editor.find(
      (element) =>
        element.type === "button" &&
        Array.isArray(element.props.children) &&
        element.props.children.join("") === "Move selection right",
    );
    (move.props.onClick as () => void)();
    const moved = editor.onChange.mock.calls[0]![0];
    expect(moved.nodes[0].frame.x).toBe(9);
    expect(moved.nodes[1].frame.x).toBe(9);
    const remove = editor.find(
      (element) =>
        element.type === "button" && element.props.children === "Delete selected objects",
    );
    (remove.props.onClick as () => void)();
    expect(editor.onChange.mock.calls[1]![0].nodes).toEqual([editor.scene.nodes[0]]);
  });

  it("keeps one object selected when its checkbox is toggled off", () => {
    const editor = editorHarness();
    editor.render("idle");
    const checkbox = editor.find(
      (element) =>
        element.type === "input" &&
        element.props["aria-label"] === "Include Slide title in selection",
    );
    (checkbox.props.onChange as () => void)();
    editor.render("idle");
    expect(
      editor.find((element) => element.type === NativeSceneCanvas).props.selectedNodeIds,
    ).toEqual([editor.scene.nodes[0]!.id]);
    expect(editor.onChange).not.toHaveBeenCalled();
  });
});
