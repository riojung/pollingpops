import { describe, expect, it } from "vitest";
import type { PresentationDraft, PresentationSceneDesign } from "@openround/contracts";
import { createContentBlock, createQuestionBlock } from "./presentation-builder";
import { createNativeContentBlock } from "./presentation-native-scene";
import { INITIAL_NATIVE_DESIGN } from "./presentation-native-design";
import {
  copyPresentationSceneDesign,
  inheritPresentationSceneDesign,
  resolvePresentationContentDesign,
  resolvePresentationActivityDesign,
} from "./presentation-activity-design";

const sunset: PresentationSceneDesign = { theme: "sunset", font: "serif", spacing: "compact" };
const ocean: PresentationSceneDesign = { theme: "ocean", font: "mono", spacing: "relaxed" };

function native(design?: PresentationSceneDesign, hidden = false) {
  const block = createNativeContentBlock();
  return {
    ...block,
    ...(hidden ? { hidden: true as const } : {}),
    scene: { ...block.scene!, ...(design ? { schemaVersion: 3 as const, design } : {}) },
  };
}

describe("Presentation activity design inheritance", () => {
  it("keeps legacy layout styling when no visible authored design exists, matching delivery", () => {
    const legacy = createContentBlock("section");
    const blocks = [legacy, native(), native(sunset, true)];
    const before = structuredClone(blocks);
    expect(resolvePresentationContentDesign(blocks, legacy.id)).toBeUndefined();
    expect(resolvePresentationContentDesign(blocks, "missing")).toBeUndefined();
    expect(blocks).toEqual(before);
  });

  it("inherits only explicit visible deck design for content, preferring its own authored design", () => {
    const preceding = native(ocean);
    const legacy = createContentBlock("section");
    const own = native(sunset);
    expect(resolvePresentationContentDesign([legacy, preceding], legacy.id)).toEqual(ocean);
    expect(resolvePresentationContentDesign([preceding, legacy, own], legacy.id)).toEqual(ocean);
    const blocks = [preceding, own];
    const before = structuredClone(blocks);
    const resolved = resolvePresentationContentDesign(blocks, own.id.toUpperCase());
    expect(resolved).toEqual(sunset);
    expect(resolved).not.toBe(sunset);
    expect(blocks).toEqual(before);
  });

  it("uses the nearest preceding visible native design, preserving the stored deck", () => {
    const activity = createQuestionBlock();
    const blocks: PresentationDraft["blocks"] = [
      native(ocean),
      native(sunset),
      native(ocean, true),
      createContentBlock(),
      native(),
      activity,
      native(ocean),
    ];
    const snapshot = structuredClone(blocks);
    const resolved = resolvePresentationActivityDesign(blocks, activity.id.toUpperCase());
    expect(resolved).toEqual(sunset);
    expect(resolved).not.toBe(sunset);
    expect(blocks).toEqual(snapshot);
    resolved.theme = "midnight";
    expect(blocks).toEqual(snapshot);
  });

  it("looks forward when no preceding design is available and skips hidden slides", () => {
    const first = createQuestionBlock();
    const second = createQuestionBlock();
    const blocks = [first, native(sunset, true), createContentBlock(), second, native(ocean)];
    expect(resolvePresentationActivityDesign(blocks, first.id)).toEqual(ocean);
    expect(resolvePresentationActivityDesign(blocks, second.id)).toEqual(ocean);
  });

  it("uses the initial design for old, plain and empty decks without upgrading them", () => {
    const activity = createQuestionBlock();
    const blocks = [createContentBlock(), native(), activity, native(sunset, true)];
    const snapshot = structuredClone(blocks);
    expect(resolvePresentationActivityDesign(blocks, activity.id)).toEqual(INITIAL_NATIVE_DESIGN);
    expect(resolvePresentationActivityDesign([], activity.id)).toEqual(INITIAL_NATIVE_DESIGN);
    expect(blocks).toEqual(snapshot);
  });

  it("copies the selected content design for an insertion and uses surrounding design after activities", () => {
    const first = native(sunset);
    const activity = createQuestionBlock();
    const last = native(ocean);
    const blocks = [first, activity, last];
    expect(inheritPresentationSceneDesign(blocks, first.id.toUpperCase())).toEqual(sunset);
    expect(inheritPresentationSceneDesign(blocks, activity.id)).toEqual(sunset);
    expect(inheritPresentationSceneDesign(blocks)).toEqual(ocean);
    expect(inheritPresentationSceneDesign(blocks, "missing-id")).toEqual(sunset);
    const hidden = { ...last, hidden: true as const };
    expect(inheritPresentationSceneDesign([first, hidden], hidden.id)).toEqual(sunset);
  });

  it("bounds copies to the existing closed tokens and discards unrelated properties", () => {
    const value = {
      theme: "external-theme",
      font: "url(untrusted)",
      spacing: "compact",
      background: "untrusted",
    } as unknown as PresentationSceneDesign;
    expect(copyPresentationSceneDesign(value)).toEqual({
      ...INITIAL_NATIVE_DESIGN,
      spacing: "compact",
    });
    expect(copyPresentationSceneDesign(sunset)).toEqual(sunset);
    expect(copyPresentationSceneDesign(sunset)).not.toBe(sunset);
  });
});
