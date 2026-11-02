import { supportedLocales } from "@openround/contracts";
import { describe, expect, it } from "vitest";
import {
  canvasToolCopy,
  canvasToolEnglishMessages,
  canvasToolMessages,
} from "./canvas-tool-messages";
import {
  canvasToolColors,
  canvasShapeCatalog,
} from "../../components/canvas-boards/canvas-tool-catalog";

describe("canvas tool localization", () => {
  it.each(supportedLocales)(
    "provides complete tool, shape, color and selection copy in %s",
    (locale) => {
      const messages = canvasToolMessages(locale);
      expect(Object.keys(messages)).toEqual(Object.keys(canvasToolEnglishMessages));
      for (const key of Object.keys(
        canvasToolEnglishMessages,
      ) as (keyof typeof canvasToolEnglishMessages)[]) {
        expect(messages[key], key).toBeTruthy();
        expect(messages[key].match(/\{\w+\}/g) ?? []).toEqual(
          canvasToolEnglishMessages[key].match(/\{\w+\}/g) ?? [],
        );
      }
      const copy = canvasToolCopy(locale);
      for (const color of canvasToolColors) expect(copy.colors[color]).toBe(copy[color]);
      for (const entry of canvasShapeCatalog) expect(copy[entry.label]).toBeTruthy();
    },
  );
  it("uses localized editing, SVG and formatting instructions", () => {
    const english = canvasToolCopy("en-CA"),
      korean = canvasToolCopy("ko-KR");
    for (const key of [
      "selectionToolbar",
      "editText",
      "svgHelp",
      "strokeWidth",
      "eraserHelp",
      "textChanged",
    ] as const)
      expect(korean[key]).not.toBe(english[key]);
  });
});
