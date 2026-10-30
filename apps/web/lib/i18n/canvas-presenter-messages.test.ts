import { describe, expect, it } from "vitest";
import { supportedLocales } from "@openround/contracts";
import { canvasPresenterCopy, canvasPresenterMessages } from "./canvas-presenter-messages";

describe("presenter messages", () => {
  it.each(supportedLocales)(
    "keeps optional following and presenter controls complete in %s",
    (locale) => {
      const copy = canvasPresenterCopy(locale);
      expect(Object.keys(copy)).toEqual(Object.keys(canvasPresenterCopy("en-CA")));
      for (const key of Object.keys(copy) as (keyof typeof copy)[]) {
        const value = copy[key];
        expect(value).toBeTruthy();
        expect(canvasPresenterMessages(locale)[`canvas.presenter.${key}`]).toBe(value);
        if (locale !== "en-CA") expect(value).not.toBe(canvasPresenterCopy("en-CA")[key]);
      }
      expect(copy.follow).not.toBe(copy.leave);
      expect(copy.start).not.toBe(copy.stop);
    },
  );
});
