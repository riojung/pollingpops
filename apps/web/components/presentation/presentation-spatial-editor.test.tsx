import { isValidElement, type ReactElement, type ReactNode } from "react";
import type * as ReactModule from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PresentationDraft } from "@openround/contracts";
import { createContentBlock } from "../../lib/presentation-builder";
import {
  enablePresentationSpatial,
  updatePresentationSpatialFrame,
} from "../../lib/presentation-spatial-authoring";
import { PresentationSpatialEditor } from "./presentation-spatial-editor";
const mocked = vi.hoisted(() => ({
  hooks: null as null | { cursor: number; slots: unknown[]; effects: (() => void)[] },
}));
vi.mock("../../lib/modal-initial-focus", () => ({ startModalInitialFocus: () => () => undefined }));
vi.mock("react", async (original) => {
  const react = await original<typeof ReactModule>();
  return {
    ...react,
    useMemo: <T,>(compute: () => T, deps: unknown[]) =>
      mocked.hooks ? compute() : react.useMemo(compute, deps),
    useRef: <T,>(initial: T) => {
      const hooks = mocked.hooks;
      if (!hooks) return react.useRef(initial);
      const index = hooks.cursor++;
      if (!(index in hooks.slots)) hooks.slots[index] = { current: initial };
      return hooks.slots[index];
    },
    useState: <T,>(initial: T) => {
      const hooks = mocked.hooks;
      if (!hooks) return react.useState(initial);
      const index = hooks.cursor++;
      if (!(index in hooks.slots)) hooks.slots[index] = initial;
      return [
        hooks.slots[index],
        (next: T) => {
          hooks.slots[index] = next;
        },
      ];
    },
    useEffect: (callback: () => void | (() => void), deps: unknown[]) => {
      const hooks = mocked.hooks;
      if (!hooks) return react.useEffect(callback, deps);
      const index = hooks.cursor++,
        prior = hooks.slots[index] as { deps: unknown[]; cleanup?: () => void } | undefined;
      if (prior && deps.every((value, i) => value === prior.deps[i])) return;
      hooks.effects.push(() => {
        prior?.cleanup?.();
        hooks.slots[index] = { deps, cleanup: callback() };
      });
    },
  };
});
function fixture(enabled = true): PresentationDraft {
  const first = createContentBlock(),
    second = createContentBlock();
  first.textElements[0]!.text = "First public title";
  second.textElements[0]!.text = "Second public title";
  first.speakerNotes = "PRIVATE_EDITOR_NOTES";
  const draft: PresentationDraft = {
    schemaVersion: 2,
    title: "Spatial",
    description: "",
    experiencePreset: { id: "focus", version: 1 },
    blocks: [first, { ...second, hidden: true }],
  };
  return enabled ? enablePresentationSpatial(draft) : draft;
}
function elements(node: ReactNode): ReactElement<Record<string, any>>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement<Record<string, any>>(node)) return [];
  return [node, ...elements(node.props.children)];
}
function harness(enabled = true) {
  const hooks = { cursor: 0, slots: [] as unknown[], effects: [] as (() => void)[] },
    capture = new Set<number>();
  let narrow = false,
    draft = fixture(enabled),
    selectedBlockId = draft.blocks[0]!.id,
    tree: ReactElement;
  const root = {
    focus: vi.fn(),
    getBoundingClientRect: () => ({ width: 900, height: 480 }),
    setPointerCapture: vi.fn((id: number) => capture.add(id)),
    hasPointerCapture: (id: number) => capture.has(id),
    releasePointerCapture: vi.fn((id: number) => capture.delete(id)),
  };
  vi.stubGlobal("window", { matchMedia: () => ({ matches: narrow }) });
  vi.stubGlobal("document", { activeElement: null });
  vi.stubGlobal("HTMLElement", class {});
  const onChange = vi.fn(),
    onSelect = vi.fn(),
    onClose = vi.fn(),
    onPreviewPath = vi.fn();
  function render(next = draft, selectedId = selectedBlockId) {
    draft = next;
    selectedBlockId = selectedId;
    hooks.cursor = 0;
    mocked.hooks = hooks;
    try {
      tree = PresentationSpatialEditor({
        draft,
        selectedBlockId,
        onChange,
        onSelect,
        onClose,
        onPreviewPath,
      });
    } finally {
      mocked.hooks = null;
    }
    for (const element of elements(tree)) {
      if (element.props.ref) element.props.ref.current = root;
    }
    hooks.effects.splice(0).forEach((effect) => effect());
  }
  function find(label: string) {
    const result = elements(tree).find(
      (element) => element.props["aria-label"] === label || element.props.children === label,
    );
    if (!result) throw new Error(`Missing ${label}`);
    return result;
  }
  function event(overrides: Record<string, unknown> = {}) {
    return {
      pointerId: 1,
      isPrimary: true,
      button: 0,
      pointerType: "mouse",
      clientX: 100,
      clientY: 100,
      currentTarget: root,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
      ...overrides,
    };
  }
  function field(label: string) {
    const container = elements(tree).find(
      (element) =>
        element.type === "label" &&
        Array.isArray(element.props.children) &&
        element.props.children.includes(label),
    );
    const input = elements(container).find((element) => element.type === "input");
    if (!input) throw new Error(`Missing input ${label}`);
    return input;
  }
  render();
  const stage = () => find("Spatial frame overview");
  return {
    initial: draft,
    root,
    onChange,
    onSelect,
    onClose,
    onPreviewPath,
    render,
    find,
    field,
    event,
    start: () => find("Move selected frame").props.onPointerDown(event()),
    move: () => stage().props.onPointerMove(event({ clientX: 140, clientY: 120 })),
    finish: () => stage().props.onPointerUp(event({ clientX: 140, clientY: 120 })),
    escape: () => elements(tree)[0]!.props.onKeyDown(event({ key: "Escape" })),
    narrow: () => {
      narrow = true;
    },
    unmount: () =>
      hooks.slots.forEach((slot) => (slot as { cleanup?: () => void } | null)?.cleanup?.()),
  };
}
beforeEach(() => {
  mocked.hooks = null;
});
afterEach(() => vi.unstubAllGlobals());
describe("Presentation spatial editor", () => {
  it("offers explicit enablement and accessible numeric/mobile controls without private notes", () => {
    const props = {
      draft: fixture(false),
      selectedBlockId: null,
      onChange: vi.fn(),
      onSelect: vi.fn(),
      onClose: vi.fn(),
      onPreviewPath: vi.fn(),
    };
    const disabled = renderToStaticMarkup(<PresentationSpatialEditor {...props} />);
    expect(disabled).toContain("Enable spatial layout");
    expect(disabled).not.toContain("Frame width");
    const enabled = renderToStaticMarkup(
      <PresentationSpatialEditor {...props} draft={fixture()} />,
    );
    expect(enabled).toContain('aria-label="Arrange space"');
    expect(enabled).toContain("Frame X");
    expect(enabled).toContain("Frame Y");
    expect(enabled).toContain("Frame width");
    expect(enabled).toContain(
      "Press Enter or leave a numeric field to apply. Escape cancels the edit.",
    );
    expect(enabled).toContain("Selected frame");
    expect(enabled).toContain('aria-label="Spatial frame controls"');
    expect(enabled).toContain("Hidden · excluded from publication");
    expect(enabled).toContain('aria-label="Spatial frames in playback order"');
    expect(enabled).not.toContain("PRIVATE_EDITOR_NOTES");
  });
  it("previews a drag locally and commits one snapshot on release", () => {
    const editor = harness();
    editor.start();
    editor.move();
    editor.render();
    expect(editor.onChange).not.toHaveBeenCalled();
    editor.finish();
    expect(editor.onChange).toHaveBeenCalledTimes(1);
    const next = editor.onChange.mock.calls[0]![0] as PresentationDraft;
    expect(next.spatial!.frames[0]!.x).toBeGreaterThan(0);
    expect(next.blocks).toBe(editor.initial.blocks);
    editor.unmount();
  });
  it("derives frame names from every visible label including hidden planning badges", () => {
    const editor = harness();
    // Inspect the actual frame children rather than replacing their native accessible names.
    const first = editor.find("Spatial frame overview");
    const buttons = elements(first).filter((element) => element.props["data-spatial-frame"]);
    const text = (node: ReactNode): string => {
      if (typeof node === "string" || typeof node === "number") return String(node);
      if (Array.isArray(node)) return node.map(text).join("");
      return isValidElement<{ children?: ReactNode }>(node) ? text(node.props.children) : "";
    };
    expect(buttons.map((button) => button.props["aria-label"])).toEqual([undefined, undefined]);
    expect(buttons.map((button) => text(button.props.children))).toEqual([
      "Slide 1: First public title",
      "Slide 2: Second public title Hidden · excluded from publication",
    ]);
    editor.unmount();
  });
  it("cancels Escape without closing or committing and discards a drag after history/recovery changes", () => {
    const editor = harness();
    editor.start();
    editor.move();
    editor.escape();
    expect(editor.onChange).not.toHaveBeenCalled();
    expect(editor.onClose).not.toHaveBeenCalled();
    expect(editor.root.releasePointerCapture).toHaveBeenCalledOnce();
    editor.start();
    editor.move();
    editor.render({ ...editor.initial, title: "Restored checkpoint" });
    editor.finish();
    expect(editor.onChange).not.toHaveBeenCalled();
    editor.escape();
    expect(editor.onClose).toHaveBeenCalledOnce();
    editor.unmount();
  });
  it("supports keyboard nudges as coalescible draft commits and leaves phone touches to numeric controls", () => {
    const editor = harness();
    editor
      .find("Move selected frame")
      .props.onKeyDown(editor.event({ key: "ArrowRight", shiftKey: true }));
    expect(editor.onChange).toHaveBeenCalledTimes(1);
    const [update, historyKey] = editor.onChange.mock.calls[0]!;
    expect(update(editor.initial).spatial.frames[0].x).toBe(160);
    expect(historyKey).toContain("spatial:");
    editor.onChange.mockClear();
    editor.narrow();
    editor.start();
    editor.move();
    editor.finish();
    expect(editor.onChange).not.toHaveBeenCalled();
    editor.unmount();
  });
  it("keeps empty and intermediate width text editable, then commits the completed replacement once", () => {
    const editor = harness();
    expect(editor.field("Frame width").props.value).toBe("1280");
    for (const value of ["", "6", "64", "640"]) {
      editor.field("Frame width").props.onChange({ target: { value } });
      editor.render();
      expect(editor.field("Frame width").props.value).toBe(value);
      expect(editor.onChange).not.toHaveBeenCalled();
    }
    editor.field("Frame width").props.onBlur();
    expect(editor.onChange).toHaveBeenCalledOnce();
    const [update, historyKey] = editor.onChange.mock.calls[0]!;
    const next = update(editor.initial) as PresentationDraft;
    expect(next.spatial!.frames[0]).toMatchObject({ width: 640, height: 360 });
    expect(editor.initial.spatial!.frames[0]!.width).toBe(1280);
    expect(historyKey).toBeUndefined();
    editor.render(next);
    expect(editor.field("Frame width").props.value).toBe("640");
    editor.field("Frame width").props.onChange({ target: { value: "1600" } });
    editor.render();
    editor.field("Frame width").props.onBlur();
    expect(editor.onChange).toHaveBeenCalledTimes(2);
    expect(editor.onChange.mock.calls[1]![1]).toBeUndefined();
    expect(editor.onChange.mock.calls[1]![0](next).spatial.frames[0].width).toBe(1600);
    editor.unmount();
  });
  it("normalizes on Enter without double committing on blur and restores invalid or cancelled text", () => {
    const editor = harness();
    editor.field("Frame width").props.onChange({ target: { value: "999999" } });
    editor.render();
    const input = editor.field("Frame width");
    expect(input.props.value).toBe("999999");
    input.props.onKeyDown(editor.event({ key: "Enter" }));
    input.props.onBlur();
    expect(editor.onChange).toHaveBeenCalledOnce();
    const next = editor.onChange.mock.calls[0]![0](editor.initial) as PresentationDraft;
    expect(next.spatial!.frames[0]).toMatchObject({ width: 3200, height: 1800 });
    editor.render(next);
    editor.onChange.mockClear();
    for (const value of ["", "not a number", "Infinity"]) {
      editor.field("Frame width").props.onChange({ target: { value } });
      editor.render();
      editor.field("Frame width").props.onBlur();
      editor.render();
      expect(editor.field("Frame width").props.value).toBe("3200");
      expect(editor.onChange).not.toHaveBeenCalled();
    }
    editor.field("Frame width").props.onChange({ target: { value: "640" } });
    editor.render();
    editor.field("Frame width").props.onKeyDown(editor.event({ key: "Escape" }));
    editor.render();
    expect(editor.field("Frame width").props.value).toBe("3200");
    expect(editor.onChange).not.toHaveBeenCalled();
    expect(editor.onClose).not.toHaveBeenCalled();
    editor.unmount();
  });
  it("discards unfinished numeric edits after selection or history changes and keeps keyboard movement current", () => {
    const editor = harness(),
      firstId = editor.initial.blocks[0]!.id,
      secondId = editor.initial.blocks[1]!.id;
    editor.field("Frame width").props.onChange({ target: { value: "640" } });
    editor.render();
    const staleInput = editor.field("Frame width");
    editor.render(editor.initial, secondId);
    expect(editor.field("Frame width").props.value).toBe("1280");
    staleInput.props.onBlur();
    expect(editor.onChange).not.toHaveBeenCalled();
    editor.render(editor.initial, firstId);
    editor.field("Frame width").props.onChange({ target: { value: "640" } });
    editor.render();
    const restored = updatePresentationSpatialFrame(editor.initial, firstId, { width: 960 });
    editor.render(restored);
    expect(editor.field("Frame width").props.value).toBe("960");
    editor.field("Frame width").props.onBlur();
    expect(editor.onChange).not.toHaveBeenCalled();
    editor.find("Move selected frame").props.onKeyDown(editor.event({ key: "ArrowRight" }));
    const moved = editor.onChange.mock.calls[0]![0](restored) as PresentationDraft;
    expect(moved.spatial!.frames[0]).toMatchObject({ x: 16, width: 960, height: 540 });
    editor.unmount();
  });
});
