import { describe, expect, it } from "vitest";
import { supportedLocales } from "@openround/contracts";
import {
  canvasDiagramCopy,
  canvasDiagramMessages,
  canvasDiagramEnglishMessages,
} from "./canvas-diagram-messages";
describe("manual diagram localization", () => {
  it.each(supportedLocales)("includes every visible label in %s", (locale) => {
    expect(Object.keys(canvasDiagramMessages(locale))).toEqual(
      Object.keys(canvasDiagramEnglishMessages),
    );
    for (const value of Object.values(canvasDiagramCopy(locale))) expect(value).toBeTruthy();
  });
});
