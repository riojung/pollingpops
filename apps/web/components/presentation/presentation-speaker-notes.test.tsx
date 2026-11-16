import { isValidElement, type ComponentProps, type ReactElement, type ReactNode } from "react";
import type * as ReactModule from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EDITOR_MODAL_SELECTOR } from "./presentation-editor-chrome";

interface HookSlot {
  value?: unknown;
  dependencies?: readonly unknown[];
  cleanup?: void | (() => void);
}
interface HookState {
  cursor: number;
  slots: HookSlot[];
  effects: (() => void)[];
  dirty: boolean;
}
const fixture = vi.hoisted(() => ({ hooks: null as HookState | null }));
vi.mock("react", async (original) => {
  const react = await original<typeof ReactModule>();
  return {
    ...react,
    useState: <T,>(initial: T) => {
      const hooks = fixture.hooks;
      if (!hooks) return react.useState(initial);
      const index = hooks.cursor++;
      hooks.slots[index] ??= { value: initial };
      return [
        hooks.slots[index]!.value,
        (next: T) => {
          if (!Object.is(hooks.slots[index]!.value, next)) hooks.dirty = true;
          hooks.slots[index]!.value = next;
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
      return `notes-test-${hooks.cursor++}`;
    },
    useEffect: (callback: () => void | (() => void), dependencies: readonly unknown[]) => {
      const hooks = fixture.hooks;
      if (!hooks) return react.useEffect(callback, dependencies);
      const index = hooks.cursor++;
      const previous = hooks.slots[index];
      if (
        previous?.dependencies &&
        dependencies.length === previous.dependencies.length &&
        dependencies.every((value, offset) => Object.is(value, previous.dependencies![offset]))
      )
        return;
      hooks.slots[index] = { dependencies };
      hooks.effects.push(() => {
        previous?.cleanup?.();
        hooks.slots[index]!.cleanup = callback();
      });
    },
  };
});
import { PresenterNotesPanel, SpeakerNotesEditor } from "./presentation-speaker-notes";

function elements(tree: ReactNode): ReactElement<Record<string, any>>[] {
  if (Array.isArray(tree)) return tree.flatMap(elements);
  if (!isValidElement<Record<string, any>>(tree)) return [];
  return [tree, ...elements(tree.props.children as ReactNode)];
}
function textContent(tree: ReactNode): string {
  if (Array.isArray(tree)) return tree.map(textContent).join("");
  if (isValidElement<{ children?: ReactNode }>(tree)) return textContent(tree.props.children);
  return typeof tree === "string" || typeof tree === "number" ? String(tree) : "";
}
function editorHarness() {
  const hooks: HookState = { cursor: 0, slots: [], effects: [], dirty: false };
  const props: ComponentProps<typeof SpeakerNotesEditor> = {
    value: "First cue\n\nSecond cue",
    sourceKey: "slide-a",
    onChange: vi.fn(),
    onPreview: vi.fn(),
  };
  const trigger = { isConnected: true, disabled: false, focus: vi.fn() };
  const section = { isConnected: true, focus: vi.fn() };
  const nativeDialog = {
    open: false,
    showModal: vi.fn(() => {
      nativeDialog.open = true;
    }),
    close: vi.fn(() => {
      nativeDialog.open = false;
    }),
  };
  const expandedInput = { focus: vi.fn(() => expect(nativeDialog.open).toBe(true)) };
  let tree: ReactNode;
  let dialogRef: { current: unknown } | undefined;
  const nodes = () => elements(tree);
  const button = (label: string) => {
    const found = nodes().find(
      (node) => node.type === "button" && textContent(node.props.children).trim() === label,
    );
    if (!found) throw new Error(`Missing ${label}`);
    return found;
  };
  const render = () => {
    hooks.cursor = 0;
    hooks.dirty = false;
    fixture.hooks = hooks;
    try {
      tree = SpeakerNotesEditor(props);
    } finally {
      fixture.hooks = null;
    }
    const expandedTrigger = button("Expand notes editor");
    trigger.disabled = Boolean(expandedTrigger.props.disabled);
    expandedTrigger.props.ref.current = trigger;
    nodes().find((node) => node.type === "section")!.props.ref.current = section;
    const modal = nodes().find((node) => node.type === "dialog");
    if (modal) {
      const expandedField = nodes().find((node) => node.type === "textarea" && node.props.ref);
      expandedField!.props.ref.current = expandedInput;
      dialogRef = modal.props.ref;
      dialogRef!.current = nativeDialog;
    } else if (dialogRef) dialogRef.current = null;
    hooks.effects.splice(0).forEach((effect) => effect());
  };
  const flush = () => {
    for (let i = 0; i < 8 && hooks.dirty; i++) render();
  };
  render();
  flush();
  return {
    props,
    render,
    flush,
    button,
    trigger,
    section,
    nativeDialog,
    expandedInput,
    get nodes() {
      return nodes();
    },
    get fields() {
      return nodes().filter((node) => node.type === "textarea");
    },
    get dialog() {
      return nodes().find((node) => node.type === "dialog");
    },
    open() {
      button("Expand notes editor").props.onClick();
      flush();
    },
    change(index: number, value: string) {
      const field = nodes().filter((node) => node.type === "textarea")[index]!;
      field.props.onChange({ target: { value } });
    },
    unmount() {
      hooks.slots.forEach((slot) => slot.cleanup?.());
    },
  };
}

afterEach(() => {
  fixture.hooks = null;
});

describe("private speaker notes writing", () => {
  it("labels the audience privacy boundary and character limit with an explicit presenter preview", () => {
    const h = editorHarness();
    expect(textContent(h.nodes[0])).toContain("The audience never sees these notes.");
    expect(h.fields[0]!.props.maxLength).toBe(2000);
    expect(h.fields[0]!.props.rows).toBeGreaterThanOrEqual(14);
    expect(h.fields[0]!.props["aria-describedby"]).toContain("-limit");
    expect(textContent(h.nodes[0])).toContain("21 / 2,000 characters");
    const focus = vi.fn();
    h.button("Preview presenter view").props.onClick({ currentTarget: { focus } });
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(h.props.onPreview).toHaveBeenCalledOnce();
    expect(h.props.onChange).not.toHaveBeenCalled();
  });

  it("keeps the inline field mounted while expanded edits use the current controlled value", () => {
    const h = editorHarness();
    const inlineId = h.fields[0]!.props.id;
    h.open();
    expect(h.nativeDialog.showModal).toHaveBeenCalledOnce();
    expect(h.expandedInput.focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(h.dialog?.props.open).toBeUndefined();
    expect(h.dialog?.props["aria-modal"]).toBe("true");
    expect(EDITOR_MODAL_SELECTOR).toContain("dialog[open]");
    expect(h.fields).toHaveLength(2);
    expect(h.fields[0]!.props.id).toBe(inlineId);
    h.change(1, "Edited from the large writing surface");
    expect(h.props.onChange).toHaveBeenLastCalledWith("Edited from the large writing surface");
    h.props.value = "Current restored draft\n\nAnother paragraph";
    h.render();
    expect(h.fields.map((field) => field.props.value)).toEqual([h.props.value, h.props.value]);
    h.button("Done writing").props.onClick();
    h.flush();
    expect(h.fields).toHaveLength(1);
    expect(h.props.onChange).toHaveBeenCalledOnce();
    expect(h.trigger.focus).toHaveBeenCalledWith({ preventScroll: true });
  });

  it("uses native Escape cancellation and closes without discarding or committing a hidden draft", () => {
    const h = editorHarness();
    h.open();
    const event = { preventDefault: vi.fn() };
    h.dialog!.props.onCancel(event);
    h.flush();
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(h.nativeDialog.close).toHaveBeenCalledOnce();
    expect(h.props.onChange).not.toHaveBeenCalled();
    expect(h.fields[0]!.props.value).toBe(h.props.value);
    expect(h.trigger.focus).toHaveBeenCalledOnce();
  });

  it("closes on permission revocation and rejects retained edit handlers without losing saved notes", () => {
    const h = editorHarness();
    h.open();
    const staleChange = h.fields[1]!.props.onChange;
    h.change(1, "Last valid saved cue");
    h.props.value = "Last valid saved cue";
    h.props.disabled = true;
    h.render();
    h.flush();
    staleChange({ target: { value: "Forbidden edit" } });
    h.change(0, "Forbidden inline edit");
    expect(h.props.onChange).toHaveBeenCalledExactlyOnceWith("Last valid saved cue");
    expect(h.dialog).toBeUndefined();
    expect(h.nativeDialog.open).toBe(false);
    expect(h.fields[0]!.props.value).toBe("Last valid saved cue");
    expect(h.section.focus).toHaveBeenCalledOnce();
    h.props.disabled = false;
    h.render();
    expect(h.dialog).toBeUndefined();
  });

  it("closes for a new slide and rejects handlers retained from the previous slide", () => {
    const h = editorHarness();
    h.open();
    const oldInlineChange = h.fields[0]!.props.onChange;
    const oldExpandedChange = h.fields[1]!.props.onChange;
    h.props.sourceKey = "slide-b";
    h.props.value = "Different slide notes";
    h.render();
    h.flush();
    oldInlineChange({ target: { value: "Old slide update" } });
    oldExpandedChange({ target: { value: "Old expanded update" } });
    expect(h.props.onChange).not.toHaveBeenCalled();
    expect(h.dialog).toBeUndefined();
    expect(h.fields[0]!.props.value).toBe("Different slide notes");
  });

  it("bounds pasted values and rejects changes after unmount", () => {
    const h = editorHarness();
    h.change(0, "x".repeat(2100));
    expect(h.props.onChange).toHaveBeenLastCalledWith("x".repeat(2000));
    const oldChange = h.fields[0]!.props.onChange;
    h.unmount();
    oldChange({ target: { value: "Late update" } });
    expect(h.props.onChange).toHaveBeenCalledOnce();
  });

  it("explains an unavailable presenter preview and guards a retained preview handler", () => {
    const h = editorHarness();
    const preview = h.button("Preview presenter view").props.onClick;
    h.props.previewDisabled = true;
    h.props.previewDisabledReason = "Unhide this slide to include it in presenter preview.";
    h.render();
    expect(h.button("Preview presenter view").props.disabled).toBe(true);
    expect(textContent(h.nodes[0])).toContain(h.props.previewDisabledReason);
    expect(h.button("Preview presenter view").props["aria-describedby"]).toContain("preview-help");
    preview({ currentTarget: { focus: vi.fn() } });
    expect(h.props.onPreview).not.toHaveBeenCalled();
  });
});

describe("private draft presenter rehearsal", () => {
  it("shows complete notes as text with slide context and published-version guidance", () => {
    const notes = "Opening cue\n\n  Indented reminder\n" + "Long note. ".repeat(170);
    const markup = renderToStaticMarkup(
      <PresenterNotesPanel notes={notes} slideNumber={2} totalSlides={5} />,
    );
    expect(markup).toContain(notes);
    expect(markup).toContain("Private · Draft rehearsal");
    expect(markup).toContain("Slide 2 of 5");
    expect(markup).toContain("The audience never sees them.");
    expect(markup).toContain("published version that started the session");
    expect(markup).toContain('aria-label="Speaker notes text"');
    expect(markup).toContain('tabindex="0"');
    expect(markup).not.toContain("<textarea");
  });

  it("gives useful empty guidance and escapes note markup", () => {
    const empty = renderToStaticMarkup(<PresenterNotesPanel notes={"   \n"} />);
    expect(empty).toContain("Add them in the Notes tab");
    const markup = renderToStaticMarkup(
      <PresenterNotesPanel notes="<script>private cue</script>" />,
    );
    expect(markup).toContain("&lt;script&gt;private cue&lt;/script&gt;");
    expect(markup).not.toContain("<script>");
  });
});
