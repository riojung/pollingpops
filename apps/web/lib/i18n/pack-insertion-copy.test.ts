import { supportedLocales } from "@openround/contracts";
import { describe, expect, it } from "vitest";
import { canvasFacilitationCopy } from "./canvas-facilitation-messages";
import {
  packInsertionCopy,
  packInsertionCopyKeys,
  packInsertionFeedback,
} from "./pack-insertion-copy";

describe("Pack insertion display copy", () => {
  it.each(supportedLocales)(
    "covers published picker and copied reference chrome in %s",
    (locale) => {
      const copy = packInsertionCopy(locale);
      for (const key of packInsertionCopyKeys) {
        expect(copy(key).trim(), key).not.toBe("");
        expect(
          copy(key)
            .match(/\{\w+\}/g)
            ?.sort() ?? [],
          key,
        ).toEqual(key.match(/\{\w+\}/g)?.sort() ?? []);
      }
      expect(copy("Cancel")).toBe(canvasFacilitationCopy(locale).cancel);
      expect(copy("version {version}", { version: 17 })).toContain("17");
      expect(copy("{count} facilitator cards copied as references.", { count: 3 })).not.toContain(
        "{count}",
      );
      if (locale !== "en-CA")
        expect(copy("Insert a published Recovery Pack")).not.toBe(
          "Insert a published Recovery Pack",
        );
    },
  );
  it("leaves unexpected errors intact and attributes exact insertion guards", () => {
    const guard = "Save the latest Presentation changes before inserting a Pack.";
    expect(packInsertionFeedback("de-DE", guard)).toEqual({
      text: "Speichern Sie vor dem Einfügen eines Packs die neuesten Präsentationsänderungen.",
      lang: "de-DE",
    });
    const raw = `${guard} Request id: authored-private`;
    expect(packInsertionFeedback("de-DE", raw)).toEqual({ text: raw, lang: "en-CA" });
    expect(packInsertionCopy()("Published Recovery Pack")).toBe("Published Recovery Pack");
  });
});

describe("Pack insertion feedback allowlist", () => {
  it.each([
    "Published Recovery Pack",
    "Insert Pack checkpoints",
    "Card citations",
    "Cancel",
    "Description",
  ])("retains label collisions and suffixed diagnostics: %s", (message) => {
    expect(packInsertionFeedback("ko-KR", message)).toEqual({ text: message, lang: "en-CA" });
    expect(packInsertionFeedback("de-DE", `${message} request=private`)).toEqual({
      text: `${message} request=private`,
      lang: "en-CA",
    });
  });
});
