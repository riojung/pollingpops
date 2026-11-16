import { describe, expect, it, vi } from "vitest";
import { presentationPresenterAction } from "./presentation-presenter-controls";

function keyEvent(overrides: Partial<Parameters<typeof presentationPresenterAction>[0]> = {}) {
  return {
    key: "ArrowRight",
    target: null,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    repeat: false,
    defaultPrevented: false,
    isComposing: false,
    ...overrides,
  };
}

const available = { dialogOpen: false };

describe("Presentation presenter shortcuts", () => {
  it.each(["ArrowRight", "PageDown", " "])("recognizes %j as a single advance", (key) => {
    expect(presentationPresenterAction(keyEvent({ key }), available)).toBe("advance");
  });

  it.each(["ArrowLeft", "PageUp", "Home", "End", "Enter", "Escape", "Space", "n"])(
    "does not invent a command for %j",
    (key) => {
      expect(presentationPresenterAction(keyEvent({ key }), available)).toBeNull();
    },
  );

  it.each([
    "altKey",
    "ctrlKey",
    "metaKey",
    "shiftKey",
    "repeat",
    "defaultPrevented",
    "isComposing",
  ] as const)("respects %s and leaves the original event untouched", (flag) => {
    const event = Object.freeze(keyEvent({ [flag]: true }));
    expect(presentationPresenterAction(event, available)).toBeNull();
  });

  it("suspends shortcuts while a dialog is open even if focus is outside it", () => {
    expect(presentationPresenterAction(keyEvent(), { dialogOpen: true })).toBeNull();
  });

  it("leaves focused native or custom controls and their children in control of all keys", () => {
    const closest = vi.fn((_selector: string) => ({ nodeType: 1 }));
    const target = { nodeType: 1, closest } as unknown as Element;
    for (const key of ["ArrowRight", "PageDown", " "]) {
      expect(presentationPresenterAction(keyEvent({ key, target }), available)).toBeNull();
    }
    const selector = closest.mock.calls[0]?.[0];
    expect(selector).toContain("button");
    expect(selector).toContain("[contenteditable]");
    expect(selector).toContain("audio[controls]");
    expect(selector).toContain("video[controls]");
    expect(selector).toContain('[role="slider"]');
    expect(selector).toContain('[role="dialog"]');
    expect(selector).not.toContain('[role="main"]');
  });

  it("recognizes a control ancestor when a text node is the key target", () => {
    const parentElement = { closest: vi.fn(() => ({ nodeType: 1 })) };
    const target = { nodeType: 3, parentElement } as unknown as Text;
    expect(presentationPresenterAction(keyEvent({ target }), available)).toBeNull();
    expect(parentElement.closest).toHaveBeenCalledOnce();
  });

  it("allows keys from the noninteractive stage without requiring a browser global", () => {
    const closest = vi.fn(() => null);
    const target = { nodeType: 1, closest } as unknown as Element;
    expect(presentationPresenterAction(keyEvent({ target }), available)).toBe("advance");
    expect(presentationPresenterAction(keyEvent({ target: new EventTarget() }), available)).toBe(
      "advance",
    );
  });
});
