import { supportedLocales, type SupportedLocale } from "@openround/contracts";
import { describe, expect, it } from "vitest";
import {
  presentationWorkspaceCopy,
  presentationWorkspaceCopyKeys,
} from "./presentation-workspace-copy";

const connectionCounts = "{connected} connected · {disconnected} not currently connected";

describe("Presentation workspace copy", () => {
  it.each(supportedLocales)("provides every phrase and preserves placeholders in %s", (locale) => {
    const copy = presentationWorkspaceCopy(locale);
    for (const phrase of presentationWorkspaceCopyKeys) {
      const translated = copy(phrase);
      expect(translated.trim(), `${locale}:${phrase}`).not.toBe("");
      expect((translated.match(/\{\w+\}/g) ?? []).sort(), `${locale}:${phrase}`).toEqual(
        (phrase.match(/\{\w+\}/g) ?? []).sort(),
      );
      if (locale === "en-CA") expect(translated).toBe(phrase);
      else expect(translated, `${locale}:${phrase}`).not.toBe(phrase);
    }
  });

  it("exports exactly the 32 scoped phrases without duplicates", () => {
    expect(presentationWorkspaceCopyKeys).toHaveLength(32);
    expect(new Set(presentationWorkspaceCopyKeys).size).toBe(32);
    expect(presentationWorkspaceCopyKeys).toEqual([
      "Connected",
      "Connected using compatibility mode",
      "Reconnecting…",
      "Private presenter workspace. Share the audience stage window with your audience.",
      "Facilitation controls",
      "Current slide",
      "Private speaker notes",
      "Speaker notes text",
      "No speaker notes for this slide.",
      "Next slide preview",
      "Next slide content",
      "Presentation complete.",
      "No further slides or activities.",
      connectionCounts,
      "Advance with Right Arrow, Page Down or Space when no control or dialog is focused. Each action waits for server confirmation.",
      "Audience stage controls",
      "Updating stage access…",
      "Open audience stage",
      "Share the audience stage window. Presenter notes and controls stay in this workspace.",
      "Your browser blocked the stage window. Open it using this link, then share that tab.",
      "Open audience stage in a new tab",
      "Revoke audience stage access",
      "Use the host tab that opened the current stage, or open a replacement stage here and then revoke it.",
      "Presentation timer",
      "Running",
      "Paused",
      "Ready",
      "Elapsed presentation time",
      "Private to this tab. Reset affects only this timer.",
      "Start",
      "Pause",
      "Reset",
    ]);
  });

  it("keeps the English default byte-for-byte and handles unsupported runtime locales", () => {
    for (const phrase of presentationWorkspaceCopyKeys) {
      expect(presentationWorkspaceCopy()(phrase)).toBe(phrase);
      for (const locale of ["unknown", "toString", "__proto__"])
        expect(presentationWorkspaceCopy(locale as SupportedLocale)(phrase)).toBe(phrase);
    }
  });

  it.each(supportedLocales)("keeps caller-formatted numbers and zero values in %s", (locale) => {
    const copy = presentationWorkspaceCopy(locale);
    const connected = new Intl.NumberFormat(locale).format(12_345);
    const disconnected = "٠٠١٬٢٣٤٫٥٠";
    const result = copy(connectionCounts, { connected, disconnected });
    expect(result).toContain(connected);
    expect(result).toContain(disconnected);
    expect(result).not.toMatch(/\{\w+\}/);
    expect(copy(connectionCounts, { connected: 0, disconnected: 3 })).toContain("0");
    expect(copy(connectionCounts, { connected: 0, disconnected: 3 })).toContain("3");
  });

  it.each(supportedLocales)("substitutes supplied literal values once in %s", (locale) => {
    const copy = presentationWorkspaceCopy(locale);
    const connected = "$& $` $' $$ {disconnected} <img src=x> 한국어";
    const disconnected = "{connected} $&";
    const result = copy(connectionCounts, { connected, disconnected });
    expect(result).toContain(connected);
    expect(result).toContain(disconnected);
    if (locale === "en-CA")
      expect(result).toBe(`${connected} connected · ${disconnected} not currently connected`);
  });

  it("preserves missing placeholders and empty values without reading inherited values", () => {
    const copy = presentationWorkspaceCopy();
    expect(copy(connectionCounts, { connected: 0 })).toBe(
      "0 connected · {disconnected} not currently connected",
    );
    expect(copy(connectionCounts, { connected: "", disconnected: 2 })).toBe(
      " connected · 2 not currently connected",
    );
    expect(copy(connectionCounts, Object.create({ connected: "inherited", disconnected: 3 }))).toBe(
      connectionCounts,
    );
  });
});
