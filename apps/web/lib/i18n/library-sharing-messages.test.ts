import { supportedLocales } from "@openround/contracts";
import { describe, expect, it } from "vitest";
import { librarySharingEnglish, librarySharingMessages } from "./library-sharing-messages";

describe("library sharing messages", () => {
  it("translates every sharing control, permission, and privacy explanation for every locale", () => {
    for (const locale of supportedLocales) {
      const copy = librarySharingMessages(locale);
      expect(Object.keys(copy)).toEqual(Object.keys(librarySharingEnglish));
      for (const key of Object.keys(librarySharingEnglish) as Array<
        keyof typeof librarySharingEnglish
      >) {
        expect(copy[key]?.trim(), `${locale}:${key}`).toBeTruthy();
        if (locale !== "en-CA")
          expect(copy[key], `${locale}:${key}`).not.toBe(librarySharingEnglish[key]);
      }
    }
  });
});
