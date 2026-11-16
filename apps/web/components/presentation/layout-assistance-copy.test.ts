import { describe, expect, it } from "vitest";
import { supportedLocales, type SupportedLocale } from "@openround/contracts";
import { createNativeContentBlock } from "../../lib/presentation-native-scene";
import { createNativeTableNode } from "../../lib/presentation-native-data";
import {
  nativeLayoutSuggestionAvailability,
  suggestNativeLayouts,
} from "../../lib/presentation-layout-suggestions";
import {
  isLayoutAssistanceCopyKey,
  layoutAssistanceCopy,
  layoutAssistanceCopyKeys,
  layoutAssistanceSystemMessage,
} from "./layout-assistance-copy";
import { nativeControlsCopy } from "./native-controls-copy";
import { assistanceCopy } from "./assistance-copy";

describe("local layout assistance display copy", () => {
  it.each(supportedLocales)("covers all keys and preserves placeholders in %s", (locale) => {
    const copy = layoutAssistanceCopy(locale);
    for (const key of layoutAssistanceCopyKeys) {
      expect(copy(key).trim(), key).not.toBe("");
      expect(
        copy(key)
          .match(/\{\w+\}/g)
          ?.sort() ?? [],
        key,
      ).toEqual(key.match(/\{\w+\}/g)?.sort() ?? []);
      if (locale === "en-CA") expect(copy(key), key).toBe(key);
      else expect(copy(key), key).not.toBe(key);
    }
    expect(copy("Body text")).toBe(nativeControlsCopy(locale)("Body text"));
    expect(copy("Close")).toBe(assistanceCopy(locale)("Close"));
  });

  it("has unique keys and defaults missing or unrecognized locales to English", () => {
    expect(new Set(layoutAssistanceCopyKeys).size).toBe(layoutAssistanceCopyKeys.length);
    for (const key of layoutAssistanceCopyKeys) {
      expect(layoutAssistanceCopy()(key)).toBe(key);
      expect(layoutAssistanceCopy("zz-ZZ" as SupportedLocale)(key)).toBe(key);
    }
    const diagnostic = "Unexpected authored diagnostic: {title} <original>";
    expect(isLayoutAssistanceCopyKey(diagnostic)).toBe(false);
    expect(layoutAssistanceSystemMessage("ko-KR", diagnostic)).toBe(diagnostic);
  });

  it("recognizes all generated alternative descriptors and availability messages without modifying them", () => {
    const source = createNativeContentBlock().scene!;
    source.nodes.push({
      id: "body",
      type: "text",
      role: "body",
      text: "Authored text",
      frame: { x: 8, y: 40, width: 70, height: 45 },
    });
    source.readingOrder.push("body");
    const withTable = structuredClone(source);
    const table = createNativeTableNode();
    withTable.schemaVersion = 4;
    withTable.nodes.push(table);
    withTable.readingOrder.push(table.id);
    const before = structuredClone([source, withTable]);
    const descriptors = [source, withTable].flatMap(suggestNativeLayouts);
    expect(new Set(descriptors.map((item) => item.id)).size).toBe(6);
    for (const suggestion of descriptors) {
      expect(isLayoutAssistanceCopyKey(suggestion.label)).toBe(true);
      expect(isLayoutAssistanceCopyKey(suggestion.description)).toBe(true);
      expect(layoutAssistanceSystemMessage("ko-KR", suggestion.label)).not.toBe(suggestion.label);
    }
    const grouped = {
      ...source,
      schemaVersion: 4 as const,
      groups: [{ id: "group", nodeIds: source.nodes.map((node) => node.id) }],
    };
    const rotated = structuredClone(source);
    rotated.schemaVersion = 4;
    Object.assign(rotated.nodes[0]!, { rotation: 20 });
    const unsupported = createNativeContentBlock().scene!;
    const invalid = { ...source, readingOrder: ["missing"] };
    for (const scene of [grouped, rotated, unsupported, invalid]) {
      const availability = nativeLayoutSuggestionAvailability(scene);
      expect(availability.supported).toBe(false);
      expect(isLayoutAssistanceCopyKey(availability.reason!)).toBe(true);
      expect(layoutAssistanceSystemMessage("de-DE", availability.reason!)).not.toBe(
        availability.reason,
      );
    }
    expect([source, withTable]).toEqual(before);
  });
});
