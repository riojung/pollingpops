import type { PresentationDraft, PresentationSceneDesign } from "@openround/contracts";
import {
  INITIAL_NATIVE_DESIGN,
  NATIVE_DESIGN_FONTS,
  NATIVE_DESIGN_THEMES,
} from "./presentation-native-design";

type PresentationBlock = PresentationDraft["blocks"][number];

/** Return only public design tokens, with a fresh copy for an explicit future write. */
export function copyPresentationSceneDesign(
  value?: PresentationSceneDesign,
): PresentationSceneDesign {
  return {
    theme:
      value?.theme && Object.hasOwn(NATIVE_DESIGN_THEMES, value.theme)
        ? value.theme
        : INITIAL_NATIVE_DESIGN.theme,
    font:
      value?.font && Object.hasOwn(NATIVE_DESIGN_FONTS, value.font)
        ? value.font
        : INITIAL_NATIVE_DESIGN.font,
    spacing: value?.spacing === "compact" ? "compact" : INITIAL_NATIVE_DESIGN.spacing,
  };
}

function designNearIndex(blocks: readonly PresentationBlock[], before: number) {
  for (let index = before; index >= 0; index -= 1) {
    const block = blocks[index];
    if (block?.kind === "content" && !block.hidden && block.scene?.design)
      return copyPresentationSceneDesign(block.scene.design);
  }
  for (let index = Math.max(0, before + 1); index < blocks.length; index += 1) {
    const block = blocks[index];
    if (block?.kind === "content" && !block.hidden && block.scene?.design)
      return copyPresentationSceneDesign(block.scene.design);
  }
  return copyPresentationSceneDesign();
}

/** Rendering borrows the nearest visible native design without upgrading stored content. */
export function resolvePresentationActivityDesign(
  blocks: readonly PresentationBlock[],
  blockId: string,
): PresentationSceneDesign {
  const index = blocks.findIndex((block) => block.id.toLowerCase() === blockId.toLowerCase());
  return designNearIndex(blocks, index - 1);
}

/** Explicit insertion may copy the current content slide's design, including after a question. */
export function inheritPresentationSceneDesign(
  blocks: readonly PresentationBlock[],
  afterBlockId?: string | null,
): PresentationSceneDesign {
  const index = afterBlockId
    ? blocks.findIndex((block) => block.id.toLowerCase() === afterBlockId.toLowerCase())
    : blocks.length - 1;
  return designNearIndex(blocks, index);
}
