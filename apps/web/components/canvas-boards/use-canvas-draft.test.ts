import type * as ReactModule from "react";
import type { CanvasBoardView } from "@openround/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AUTH_CHANGE_EVENT } from "../../lib/api";
import { useCanvasDraft } from "./use-canvas-draft";
import { canvasObjectDraft } from "./canvas-draft";
import { canvasBoard, canvasObject } from "./canvas-test-fixtures";
interface Hooks {
  cursor: number;
  slots: unknown[];
  effects: ReactModule.EffectCallback[];
}
const mocked = vi.hoisted(() => ({ hooks: null as Hooks | null }));
vi.mock("react", async (original) => {
  const react = await original<typeof ReactModule>();
  return {
    ...react,
    useState: <T>(initial: T | (() => T)) => {
      const hooks = mocked.hooks!;
      const index = hooks.cursor++;
      if (!(index in hooks.slots))
        hooks.slots[index] = typeof initial === "function" ? (initial as () => T)() : initial;
      return [
        hooks.slots[index],
        (value: T | ((old: T) => T)) => {
          hooks.slots[index] =
            typeof value === "function" ? (value as (old: T) => T)(hooks.slots[index] as T) : value;
        },
      ];
    },
    useEffect: (effect: ReactModule.EffectCallback) => mocked.hooks!.effects.push(effect),
  };
});
function harness() {
  const hooks: Hooks = { cursor: 0, slots: [], effects: [] };
  const cleanup: Array<() => void> = [];
  let board: CanvasBoardView | null = canvasBoard;
  const confirm = vi.fn().mockReturnValue(false),
    discard = vi.fn();
  return {
    confirm,
    discard,
    setBoard(next: CanvasBoardView | null) {
      board = next;
    },
    render(locked = false, pending = false) {
      hooks.cursor = 0;
      hooks.effects = [];
      mocked.hooks = hooks;
      try {
        return useCanvasDraft(canvasBoard.id, board, {
          locked,
          pending,
          confirmDiscard: confirm,
          onDiscardPending: discard,
        });
      } finally {
        mocked.hooks = null;
      }
    },
    mount() {
      hooks.effects.forEach((effect) => {
        const result = effect();
        if (result) cleanup.push(result);
      });
    },
    unmount() {
      cleanup.forEach((effect) => effect());
    },
  };
}
beforeEach(() => {
  const events = new EventTarget();
  vi.stubGlobal("window", {
    addEventListener: events.addEventListener.bind(events),
    removeEventListener: events.removeEventListener.bind(events),
    dispatchEvent: events.dispatchEvent.bind(events),
  });
});
afterEach(() => {
  mocked.hooks = null;
  vi.unstubAllGlobals();
});
describe("canvas unsaved draft recovery", () => {
  it("preserves unsaved text and the dirty guard after its target is deleted; a denied selection keeps it intact", () => {
    const view = harness();
    view.render();
    view.mount();
    view.render().select(canvasObject.id);
    const draft = {
      ...canvasObjectDraft(canvasObject),
      text: "A local idea never sent to the server",
    };
    view.render().setDraft(draft);
    view.setBoard({ ...canvasBoard, objects: [] });
    const missing = view.render();
    expect(missing.selected).toBeUndefined();
    expect(missing.localDraft).toBeNull();
    expect(missing.dirty).toBe(true);
    expect(missing.recovery).toBe("missing");
    expect(missing.draft).toEqual(draft);
    expect(missing.select("00000000-0000-4000-8000-000000000099")).toBe(false);
    expect(view.confirm).toHaveBeenCalledOnce();
    expect(view.render().draft).toEqual(draft);
    view.render().setDraft(null);
    expect(view.render().dirty).toBe(false);
    expect(view.render().select(null)).toBe(true);
    expect(view.discard).not.toHaveBeenCalled();
    view.unmount();
  });
  it("requires explicit discard to replace a draft and clears a retained pending operation at the same time", () => {
    const view = harness();
    view.render();
    view.mount();
    view.render().select(canvasObject.id);
    view.render().setDraft({ ...canvasObjectDraft(canvasObject), text: "Keep until confirmed" });
    expect(view.render(true, true).select(null)).toBe(false);
    expect(view.confirm).not.toHaveBeenCalled();
    view.confirm.mockReturnValue(true);
    expect(view.render(false, true).select(null)).toBe(true);
    expect(view.discard).toHaveBeenCalledOnce();
    expect(view.render().draft).toBeNull();
    view.unmount();
  });
  it("keeps a same-object draft unchanged through a remote edit, role loss and board loss without making it writable", () => {
    const view = harness();
    view.render();
    view.mount();
    view.render().select(canvasObject.id);
    const draft = { ...canvasObjectDraft(canvasObject), text: "My original wording" };
    view.render().setDraft(draft);
    const changed: CanvasBoardView = {
      ...canvasBoard,
      objects: [{ ...canvasObject, type: "sticky", version: 4, text: "Collaborator's wording" }],
    };
    view.setBoard(changed);
    expect(view.render().localDraft).toEqual(draft);
    expect(view.render().selected?.version).toBe(4);
    view.setBoard({ ...changed, capabilities: { ...changed.capabilities, edit: false } });
    expect(view.render().recovery).toBe("readOnly");
    expect(view.render().draft).toEqual(draft);
    expect(view.render().dirty).toBe(true);
    view.setBoard(null);
    expect(view.render().recovery).toBe("unavailable");
    expect(view.render().draft).toEqual(draft);
    expect(view.render().dirty).toBe(true);
    window.dispatchEvent(new Event(AUTH_CHANGE_EVENT));
    expect(view.render().draft).toBeNull();
    expect(view.render().dirty).toBe(false);
    view.unmount();
  });
  it("clears a draft only after an accepted local save or explicit discard", () => {
    const view = harness();
    view.render();
    view.mount();
    view.render().select(canvasObject.id);
    view.render().setDraft(canvasObjectDraft(canvasObject));
    view.render().acceptSelection(canvasObject.id);
    expect(view.render().draft).toBeNull();
    expect(view.render().dirty).toBe(false);
    expect(view.render().selectedId).toBe(canvasObject.id);
    view.unmount();
  });
});
