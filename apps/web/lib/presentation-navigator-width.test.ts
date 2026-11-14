import { describe, expect, it, vi } from "vitest";
import {
  clampPresentationNavigatorWidth,
  presentationNavigatorMaxWidth,
  readPresentationNavigatorWidth,
  savePresentationNavigatorWidth,
  PRESENTATION_NAVIGATOR_WIDTH_KEY,
} from "./presentation-navigator-width";

describe("Local navigator width preference", () => {
  it("reserves canvas room and clamps the desktop range", () => {
    expect(presentationNavigatorMaxWidth(1440, 310)).toBe(440);
    expect(presentationNavigatorMaxWidth(1000, 290)).toBe(342);
    expect(presentationNavigatorMaxWidth(800, 310)).toBe(200);
    expect(presentationNavigatorMaxWidth(1000, 0)).toBe(440);
    expect(clampPresentationNavigatorWidth(450, 342)).toBe(342);
    expect(clampPresentationNavigatorWidth(80, 440)).toBe(200);
    expect(clampPresentationNavigatorWidth(Number.NaN, 440)).toBe(280);
    expect(clampPresentationNavigatorWidth(281.6, 440)).toBe(282);
  });
  it.each([null, "", "   ", "invalid", "Infinity"])("safely defaults preference %s", (value) => {
    expect(readPresentationNavigatorWidth({ getItem: () => value })).toBe(280);
  });
  it("remembers bounded local preferences while tolerating blocked or full storage", () => {
    expect(readPresentationNavigatorWidth({ getItem: () => "360" })).toBe(360);
    expect(readPresentationNavigatorWidth({ getItem: () => "9999" })).toBe(440);
    expect(
      readPresentationNavigatorWidth({
        getItem: () => {
          throw new Error("Blocked");
        },
      }),
    ).toBe(280);
    const setItem = vi.fn();
    savePresentationNavigatorWidth({ setItem }, 360);
    expect(setItem).toHaveBeenCalledWith(PRESENTATION_NAVIGATOR_WIDTH_KEY, "360");
    expect(() =>
      savePresentationNavigatorWidth(
        {
          setItem: () => {
            throw new Error("Full");
          },
        },
        360,
      ),
    ).not.toThrow();
  });
});
