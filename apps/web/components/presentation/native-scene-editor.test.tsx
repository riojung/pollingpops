import { isValidElement, type ReactElement, type ReactNode } from "react";
import type * as ReactModule from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createNativeContentBlock } from "../../lib/presentation-native-scene";
import { NativeSceneEditor } from "./native-scene-editor";
import { NativeSceneCanvas } from "./native-scene-canvas";
import { NativeRichTextEditor } from "./native-rich-text-editor";
import { NativeSceneInteractionEditor } from "./native-scene-interaction-editor";
import {
  NativeSceneDesignControls,
  NativeSceneLayoutControls,
} from "./native-scene-design-controls";

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

function editorHarness(
  history: {
    onUndo?: () => void;
    onRedo?: () => void;
    onTextAssistance?: (nodeId: string, operation: "rewrite" | "shorten") => void;
    textAssistanceDisabled?: boolean;
  } = {},
) {
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
    for (const label of [
      "Add native text",
      "Add native shape",
      "Add native connector",
      "Add reveal panel",
      "Add link",
    ]) {
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
    for (const label of [
      "Add native text",
      "Add native shape",
      "Add native connector",
      "Add reveal panel",
      "Add link",
    ]) {
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

describe("native design and rich text coexistence", () => {
  it.each([3, 4] as const)(
    "keeps scene %s and its composition when formatting, editing and removing formatting",
    (version) => {
      const editor = editorHarness();
      editor.scene.schemaVersion = version;
      editor.scene.design = { theme: "midnight", font: "serif", spacing: "compact" };
      if (version === 4) {
        editor.scene.groups = [{ id: "group", nodeIds: editor.scene.nodes.map((node) => node.id) }];
        const body = editor.scene.nodes[1]!;
        if (body.type !== "connector") body.rotation = 5;
      }
      editor.render("idle");
      const format = editor.find(
        (element) => element.type === "button" && element.props.children === "Format text",
      );
      (format.props.onClick as () => void)();
      const formatted = editor.onChange.mock.calls[0]![0];
      expect(formatted.schemaVersion).toBe(version);
      expect(formatted.design).toEqual(editor.scene.design);
      expect(formatted.groups).toEqual(editor.scene.groups);
      expect(formatted.nodes[1]).toEqual(editor.scene.nodes[1]);
      editor.scene.nodes = formatted.nodes;
      editor.render("idle");
      const richEditor = editor.find((element) => element.type === NativeRichTextEditor);
      const richNode = formatted.nodes[0];
      (richEditor.props.onChange as (node: unknown) => void)({
        ...richNode,
        text: "Revised",
        richText: { paragraphs: [{ kind: "paragraph", runs: [{ text: "Revised", bold: true }] }] },
      });
      expect(editor.onChange.mock.calls[1]![0]).toMatchObject({
        schemaVersion: version,
        design: editor.scene.design,
      });
      const { richText: _richText, ...plain } = richNode;
      void _richText;
      (richEditor.props.onChange as (node: unknown) => void)(plain);
      expect(editor.onChange.mock.calls[2]![0]).toMatchObject({
        schemaVersion: version,
        design: editor.scene.design,
      });
      expect(editor.onChange.mock.calls[2]![0].nodes[0]).not.toHaveProperty("richText");
    },
  );
});

describe("native edit validation", () => {
  it.each([
    ["Add reveal panel", "reveal"],
    ["Add link", "link"],
  ] as const)(
    "adds and selects %s with scene 5, preserving its version when adding data",
    (label, type) => {
      const editor = editorHarness();
      editor.render("idle");
      const button = editor.find(
        (element) => element.type === "button" && element.props.children === label,
      );
      (button.props.onClick as () => void)();
      const next = editor.onChange.mock.calls[0]![0];
      expect(next).toMatchObject({ schemaVersion: 5 });
      expect(next.nodes.at(-1)).toMatchObject(
        type === "reveal"
          ? { type, label: "", body: "", scope: "local" }
          : { type, label: "", href: "" },
      );
      expect(next.readingOrder.at(-1)).toBe(next.nodes.at(-1).id);
      Object.assign(editor.scene, next);
      editor.render("idle");
      expect(
        editor.find((element) => element.type === NativeSceneInteractionEditor).props.node,
      ).toEqual(next.nodes.at(-1));
      expect(
        editor.find((element) => element.type === NativeSceneCanvas).props.selectedNodeIds,
      ).toEqual([next.nodes.at(-1).id]);
      const table = editor.find(
        (element) => element.type === "button" && element.props.children === "Add table",
      );
      (table.props.onClick as () => void)();
      expect(editor.onChange.mock.calls[1]![0]).toMatchObject({
        schemaVersion: 5,
        nodes: expect.arrayContaining([next.nodes.at(-1)]),
      });
    },
  );

  it("retains the slide and selection when the presentation rejects a new information object", () => {
    const editor = editorHarness();
    editor.onChange.mockReturnValue(false);
    editor.render("idle");
    const add = () =>
      editor.find((element) => element.type === "button" && element.props.children === "Add table");
    (add().props.onClick as () => void)();
    editor.render("idle");
    expect(
      editor.find((element) => element.type === NativeSceneCanvas).props.selectedNodeIds,
    ).toEqual([editor.scene.nodes[0]!.id]);
    expect(editor.find((element) => element.props.role === "alert").props.children).toContain(
      "current slide is retained",
    );
    expect(editor.scene.nodes).toHaveLength(2);
    editor.onChange.mockReturnValue(undefined);
    (add().props.onClick as () => void)();
    expect(editor.onChange).toHaveBeenCalledTimes(2);
    expect(editor.onChange.mock.calls[1]![0]).toMatchObject({
      schemaVersion: 4,
      nodes: expect.arrayContaining([expect.objectContaining({ type: "table" })]),
    });
  });

  it("rejects invalid scene edits before calling history or saving, and accepts a corrected edit", () => {
    const editor = editorHarness();
    editor.render("idle");
    const change = editor.find((element) => element.type === NativeSceneCanvas).props.onChange as (
      scene: unknown,
    ) => void;
    change({ ...editor.scene, readingOrder: [] });
    editor.render("idle");
    expect(editor.onChange).not.toHaveBeenCalled();
    expect(editor.find((element) => element.props.role === "alert").props.children).toContain(
      "slide’s limits",
    );
    change({
      ...editor.scene,
      nodes: editor.scene.nodes.map((node) =>
        node.type === "text" && node.role === "body" ? { ...node, text: "Corrected" } : node,
      ),
    });
    expect(editor.onChange).toHaveBeenCalledTimes(1);
  });
});

describe("native design discoverability", () => {
  it.each(["legacy", "designed"] as const)(
    "places one %s design fieldset above the canvas while object controls stay below",
    (kind) => {
      const editor = editorHarness();
      if (kind === "designed") {
        editor.scene.schemaVersion = 3;
        editor.scene.design = { theme: "paper", font: "sans", spacing: "relaxed" };
      }
      const original = structuredClone(editor.scene);
      editor.render("idle");
      const root = editor.find((element) => element.type === "div");
      const children = root.props.children as ReactElement<Record<string, unknown>>[];
      const design = elements(children[0]).filter(
        (element) => element.type === NativeSceneDesignControls,
      );
      expect(design).toHaveLength(1);
      expect(
        elements(root).filter((element) => element.type === NativeSceneDesignControls),
      ).toHaveLength(1);
      expect(design[0]!.props.scene).toBe(editor.scene);
      expect(children[1]!.type).toBe(NativeSceneCanvas);
      const lower = children[2]!;
      expect(lower.props["aria-label"]).toBe("Native slide editor");
      expect(children[0]!.props.className).toBe(lower.props.className);
      expect(elements(lower).some((element) => element.type === NativeSceneLayoutControls)).toBe(
        true,
      );
      expect(
        elements(lower).some((element) => element.props["data-native-text-fields"] === "true"),
      ).toBe(true);
      expect(editor.onChange).not.toHaveBeenCalled();
      expect(editor.scene).toEqual(original);
    },
  );
});

describe("selected native text assistance", () => {
  it("targets the exact selected case-sensitive native node from its own fieldset", () => {
    const assistance = vi.fn();
    const editor = editorHarness({ onTextAssistance: assistance });
    const title = editor.scene.nodes[0]!;
    title.id = "Imported Title / CASE";
    if (title.type === "text") title.text = "Selected imported title";
    editor.scene.readingOrder[0] = title.id;
    editor.render("idle");
    const fieldset = editor.find((node) => node.props["data-native-text-fields"] === "true");
    const rewrite = elements(fieldset).find(
      (node) => node.type === "button" && node.props.children === "Rewrite text",
    )!;
    expect(rewrite.props.disabled).toBe(false);
    (rewrite.props.onClick as () => void)();
    expect(assistance).toHaveBeenCalledWith("Imported Title / CASE", "rewrite");
    const shorten = elements(fieldset).find(
      (node) => node.type === "button" && node.props.children === "Shorten text",
    )!;
    (shorten.props.onClick as () => void)();
    expect(assistance).toHaveBeenCalledWith("Imported Title / CASE", "shorten");
  });
  it("explicitly disables rich-text and pending-intent assistance, including stale handlers", () => {
    const assistance = vi.fn();
    const editor = editorHarness({ onTextAssistance: assistance });
    const title = editor.scene.nodes[0]!;
    if (title.type !== "text") throw new Error("Expected title");
    title.richText = {
      paragraphs: [{ kind: "paragraph", runs: [{ text: title.text }] }],
    };
    editor.render("idle");
    const rewrite = editor.find(
      (node) => node.type === "button" && node.props.children === "Rewrite text",
    );
    expect(rewrite.props.disabled).toBe(true);
    (rewrite.props.onClick as () => void)();
    expect(assistance).not.toHaveBeenCalled();
    const fieldset = editor.find((node) => node.props["data-native-text-fields"] === "true");
    expect(JSON.stringify(fieldset)).toContain("Formatted text cannot be rewritten or shortened");
    const pending = editorHarness({ onTextAssistance: assistance, textAssistanceDisabled: true });
    pending.render("idle");
    (
      pending.find((node) => node.type === "button" && node.props.children === "Shorten text").props
        .onClick as () => void
    )();
    expect(assistance).not.toHaveBeenCalled();
  });
});
