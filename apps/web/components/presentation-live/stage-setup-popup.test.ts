import { describe, expect, it, vi } from "vitest";
import { dismissStagePopupOnEscape, stageSetupPopupBounds } from "./stage-setup-popup";

function popupFixture() {
  const summary = { focus: vi.fn() };
  const details = {
    open: true,
    closest: vi.fn(() => null as unknown),
    ownerDocument: { querySelectorAll: vi.fn(() => [] as Array<{ contains: () => boolean }>) },
    querySelector: vi.fn(() => summary),
  };
  const event = {
    key: "Escape",
    target: { tagName: "BODY" },
    defaultPrevented: false,
    isComposing: false,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
  };
  return {
    details,
    event,
    summary,
    dismiss: () =>
      dismissStagePopupOnEscape(
        event as unknown as KeyboardEvent,
        details as unknown as HTMLDetailsElement,
      ),
  };
}

describe("document-level stage popup Escape", () => {
  it("closes and restores the summary when a pointer action leaves keyboard focus on body", () => {
    const popup = popupFixture();
    popup.dismiss();
    expect(popup.details.open).toBe(false);
    expect(popup.summary.focus).toHaveBeenCalledExactlyOnceWith({ preventScroll: true });
    expect(popup.event.preventDefault).toHaveBeenCalledOnce();
    expect(popup.event.stopPropagation).toHaveBeenCalledOnce();
  });

  it("leaves Escape to a separate modal and to controls that already handled it", () => {
    const popup = popupFixture();
    popup.details.ownerDocument.querySelectorAll.mockReturnValue([{ contains: () => false }]);
    popup.dismiss();
    expect(popup.details.open).toBe(true);
    expect(popup.summary.focus).not.toHaveBeenCalled();
    expect(popup.event.preventDefault).not.toHaveBeenCalled();
    popup.details.ownerDocument.querySelectorAll.mockReturnValue([]);
    popup.event.defaultPrevented = true;
    popup.dismiss();
    expect(popup.details.open).toBe(true);
    expect(popup.event.stopPropagation).not.toHaveBeenCalled();
  });

  it("dismisses a popup within its owning modal while ignoring hidden or closed popups", () => {
    const popup = popupFixture();
    popup.details.ownerDocument.querySelectorAll.mockReturnValue([{ contains: () => true }]);
    popup.details.closest.mockReturnValue({});
    popup.dismiss();
    expect(popup.details.open).toBe(true);
    popup.details.closest.mockReturnValue(null);
    popup.dismiss();
    expect(popup.details.open).toBe(false);
    popup.summary.focus.mockClear();
    popup.dismiss();
    expect(popup.summary.focus).not.toHaveBeenCalled();
  });
});

describe("stage setup popup viewport bounds", () => {
  it.each([
    {
      label: "English setup wrapped to the left edge at 320px",
      anchor: { left: 16, right: 166, top: 116, bottom: 156 },
      viewport: { left: 0, top: 0, width: 320, height: 740 },
    },
    {
      label: "Korean setup on a separate header row at 320px",
      anchor: { left: 12, right: 177, top: 152, bottom: 192 },
      viewport: { left: 0, top: 0, width: 320, height: 500 },
    },
    {
      label: "a German setup summary spanning two lines",
      anchor: { left: 16, right: 304, top: 205, bottom: 285 },
      viewport: { left: 0, top: 0, width: 320, height: 500 },
    },
    {
      label: "a short landscape window",
      anchor: { left: 310, right: 488, top: 260, bottom: 300 },
      viewport: { left: 0, top: 0, width: 500, height: 320 },
    },
    {
      label: "a mobile keyboard covering the lower layout viewport",
      anchor: { left: 12, right: 177, top: 152, bottom: 192 },
      viewport: { left: 0, top: 260, width: 320, height: 240 },
    },
    {
      label: "a zoomed visual viewport with horizontal and vertical offsets",
      anchor: { left: 120, right: 275, top: 80, bottom: 120 },
      viewport: { left: 80, top: 25, width: 280, height: 320 },
    },
  ])("keeps $label inside the visible viewport", ({ anchor, viewport }) => {
    const popup = stageSetupPopupBounds(anchor, viewport, 800);
    expect(popup.left).toBeGreaterThanOrEqual(viewport.left + 12);
    expect(popup.top).toBeGreaterThanOrEqual(viewport.top + 12);
    expect(popup.left + popup.width).toBeLessThanOrEqual(viewport.left + viewport.width - 12);
    expect(popup.top + popup.maxHeight).toBeLessThanOrEqual(viewport.top + viewport.height - 12);
    expect(popup.maxHeight).toBeGreaterThanOrEqual(40);
  });

  it("clamps a left-aligned wrapped setup panel rather than anchoring its right edge offscreen", () => {
    expect(
      stageSetupPopupBounds(
        { left: 16, right: 166, top: 116, bottom: 156 },
        { left: 0, top: 0, width: 320, height: 740 },
        280,
      ),
    ).toEqual({ left: 12, top: 164, width: 296, maxHeight: 540 });
  });

  it("opens above a low anchor when the translated body needs more space", () => {
    const anchor = { left: 310, right: 488, top: 260, bottom: 300 };
    const popup = stageSetupPopupBounds(anchor, { left: 0, top: 0, width: 500, height: 320 }, 180);
    expect(popup.top + 180).toBeLessThan(anchor.top);
    expect(popup.width).toBe(360);
    expect(popup.maxHeight).toBe(240);
  });
});
