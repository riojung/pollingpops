import { describe, expect, it, vi } from "vitest";
import { startModalInitialFocus } from "./modal-initial-focus";

class FrameWindow extends EventTarget {
  frames = new Map<number, FrameRequestCallback>();
  private next = 0;
  requestAnimationFrame = (callback: FrameRequestCallback) => {
    const id = ++this.next;
    this.frames.set(id, callback);
    return id;
  };
  cancelAnimationFrame = (id: number) => this.frames.delete(id);
  getComputedStyle = (element: Element) =>
    (element as unknown as FocusElement).style as CSSStyleDeclaration;
  render() {
    const callbacks = [...this.frames.values()];
    this.frames.clear();
    callbacks.forEach((callback) => callback(0));
  }
}
class FocusDocument extends EventTarget {
  visibilityState = "visible";
  focused = true;
  activeElement: FocusElement | null = null;
  defaultView = new FrameWindow();
  hasFocus = () => this.focused;
}
class FocusElement {
  isConnected = true;
  inert = false;
  ariaHidden = false;
  disabled = false;
  measurable = true;
  rejectFocus = false;
  style = { display: "block", visibility: "visible", opacity: "1" };
  constructor(
    readonly doc: FocusDocument,
    readonly parent: FocusElement | null = null,
  ) {}
  contains(value: unknown): boolean {
    let current = value instanceof FocusElement ? value : null;
    while (current) {
      if (current === this) return true;
      current = current.parent;
    }
    return false;
  }
  closest(): FocusElement | null {
    if (this.inert || this.ariaHidden) return this;
    return this.parent?.closest() ?? null;
  }
  matches = () => this.disabled;
  getClientRects = () => (this.measurable ? [{}] : []);
  focus = vi.fn((_options?: FocusOptions) => {
    if (this.rejectFocus) return;
    this.doc.activeElement = this;
    this.doc.dispatchEvent(new Event("focusin"));
  });
}
function fixture() {
  const doc = new FocusDocument();
  const win = doc.defaultView;
  const dialog = new FocusElement(doc);
  const close = new FocusElement(doc, dialog);
  const other = new FocusElement(doc, dialog);
  const start = () =>
    startModalInitialFocus({
      dialog: () => dialog as unknown as HTMLElement,
      target: () => close as unknown as HTMLElement,
      ownerDocument: doc as unknown as Document,
    });
  return { doc, win, dialog, close, other, start };
}

describe("initial modal focus readiness", () => {
  it("waits for connected, non-inert, rendered visible controls and prevents scroll", () => {
    const f = fixture();
    f.dialog.inert = true;
    const stop = f.start();
    f.win.render();
    expect(f.close.focus).not.toHaveBeenCalled();
    f.dialog.inert = false;
    f.close.isConnected = false;
    f.win.render();
    expect(f.close.focus).not.toHaveBeenCalled();
    f.close.isConnected = true;
    f.dialog.style.visibility = "hidden";
    f.win.render();
    expect(f.close.focus).not.toHaveBeenCalled();
    f.dialog.style.visibility = "visible";
    f.close.measurable = false;
    f.win.render();
    expect(f.close.focus).not.toHaveBeenCalled();
    f.close.measurable = true;
    f.win.render();
    expect(f.close.focus).toHaveBeenCalledExactlyOnceWith({ preventScroll: true });
    expect(f.doc.activeElement).toBe(f.close);
    expect(f.win.frames.size).toBe(0);
    stop();
  });

  it("verifies accepted focus and can recover after more than two rejected attempts", () => {
    const f = fixture();
    f.close.rejectFocus = true;
    const stop = f.start();
    for (let index = 0; index < 3; index += 1) {
      f.win.render();
      expect(f.win.frames.size).toBe(1);
    }
    expect(f.close.focus).toHaveBeenCalledTimes(3);
    expect(f.doc.activeElement).toBeNull();
    f.close.rejectFocus = false;
    f.win.render();
    expect(f.close.focus).toHaveBeenCalledTimes(4);
    expect(f.doc.activeElement).toBe(f.close);
    expect(f.win.frames.size).toBe(0);
    stop();
  });

  it("does not poll a background document and resumes when the visible window gains focus", () => {
    const f = fixture();
    f.doc.visibilityState = "hidden";
    f.doc.focused = false;
    const stop = f.start();
    expect(f.win.frames.size).toBe(0);
    f.doc.visibilityState = "visible";
    f.doc.dispatchEvent(new Event("visibilitychange"));
    expect(f.win.frames.size).toBe(0);
    f.doc.focused = true;
    f.win.dispatchEvent(new Event("focus"));
    expect(f.win.frames.size).toBe(1);
    f.win.render();
    expect(f.doc.activeElement).toBe(f.close);
    stop();
  });

  it("pauses a queued attempt if foreground is lost and restarts on the dialog transition", () => {
    const f = fixture();
    const stop = f.start();
    f.doc.focused = false;
    f.win.render();
    expect(f.win.frames.size).toBe(0);
    expect(f.close.focus).not.toHaveBeenCalled();
    f.doc.focused = true;
    const event = new Event("transitionend");
    Object.defineProperty(event, "target", { value: f.dialog });
    f.doc.dispatchEvent(event);
    expect(f.win.frames.size).toBe(1);
    f.win.render();
    expect(f.doc.activeElement).toBe(f.close);
    stop();
  });

  it("stops permanently when the user focuses another dialog control before initial focus", () => {
    const f = fixture();
    const docRemove = vi.spyOn(f.doc, "removeEventListener");
    const winRemove = vi.spyOn(f.win, "removeEventListener");
    const stop = f.start();
    f.doc.activeElement = f.other;
    f.doc.dispatchEvent(new Event("focusin"));
    expect(f.win.frames.size).toBe(0);
    f.doc.activeElement = null;
    f.win.dispatchEvent(new Event("focus"));
    f.doc.dispatchEvent(new Event("visibilitychange"));
    f.win.render();
    expect(f.close.focus).not.toHaveBeenCalled();
    expect(docRemove).toHaveBeenCalledTimes(3);
    expect(winRemove).toHaveBeenCalledTimes(1);
    stop();
  });

  it("retains existing inside focus and cancels all pending work when the modal closes", () => {
    const f = fixture();
    f.doc.activeElement = f.other;
    f.start()();
    expect(f.win.frames.size).toBe(0);
    expect(f.close.focus).not.toHaveBeenCalled();
    f.doc.activeElement = null;
    const stop = f.start();
    expect(f.win.frames.size).toBe(1);
    stop();
    expect(f.win.frames.size).toBe(0);
    f.win.dispatchEvent(new Event("focus"));
    f.doc.dispatchEvent(new Event("visibilitychange"));
    f.win.render();
    expect(f.close.focus).not.toHaveBeenCalled();
  });
});
