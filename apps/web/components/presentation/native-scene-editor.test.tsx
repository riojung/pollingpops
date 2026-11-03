import { isValidElement, type ReactElement, type ReactNode } from "react";
import type * as ReactModule from "react";
import { describe, expect, it, vi } from "vitest";
import { createNativeContentBlock } from "../../lib/presentation-native-scene";
import { NativeSceneEditor } from "./native-scene-editor";
import { NativeSceneView } from "./native-scene-view";

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

function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement<Record<string, unknown>>(node)) return [];
  return [node, ...elements(node.props.children as ReactNode)];
}

function editorHarness() {
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
    const view = editor.find((element) => element.type === NativeSceneView);
    (view.props.onFrameChange as (id: string, frame: unknown) => void)(editor.scene.nodes[0]!.id, {
      x: 12,
      y: 8,
      width: 80,
      height: 20,
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
