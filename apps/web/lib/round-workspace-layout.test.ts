import { describe, expect, it } from "vitest";
import { readRoundPaneWidths, roundPaneWidth } from "./round-workspace-layout";

describe("Round editor pane bounds", () => {
  it("ignores malformed or unrelated stored preferences", () => {
    for (const raw of [
      null,
      "broken",
      "null",
      "[]",
      "false",
      '{"navigation":"999px","tools":null}',
    ])
      expect(readRoundPaneWidths(raw)).toEqual({ navigation: 260, tools: 320 });
  });
  it("restores independent widths within their accessible bounds", () => {
    expect(readRoundPaneWidths('{"navigation":310,"tools":360}')).toEqual({
      navigation: 310,
      tools: 360,
    });
    expect(readRoundPaneWidths('{"navigation":9000,"tools":-1}')).toEqual({
      navigation: 420,
      tools: 280,
    });
  });
  it("reserves enough room for the central question at narrower desktop widths", () => {
    expect(roundPaneWidth("navigation", 420, 1080, 320)).toBe(384);
    expect(roundPaneWidth("tools", 440, 1080, 260)).toBe(440);
    expect(roundPaneWidth("navigation", 420, 1080, 440)).toBe(264);
  });
  it("handles non-finite drag coordinates and fractional widths", () => {
    expect(roundPaneWidth("tools", Number.NaN)).toBe(320);
    expect(roundPaneWidth("navigation", 310.7)).toBe(311);
  });
});
