import type { PresentationSceneDesign } from "@openround/contracts";

type DesignBlock = {
  id: string;
  kind: "content" | "question";
  hidden?: true;
  scene?: { design?: PresentationSceneDesign };
};

/** Resolve against the complete source sequence before selecting recipient pages. */
export function presentationBlockDesign(
  blocks: readonly DesignBlock[],
  blockId: string,
): PresentationSceneDesign | undefined {
  const index = blocks.findIndex((block) => block.id.toLowerCase() === blockId.toLowerCase());
  if (index < 0) return undefined;
  const explicitDesign = (candidate: DesignBlock | undefined) => {
    if (candidate?.kind !== "content" || candidate.hidden || !candidate.scene?.design)
      return undefined;
    const { theme, font, spacing, motionBackground } = candidate.scene.design;
    return {
      theme,
      font,
      spacing,
      ...(motionBackground === undefined ? {} : { motionBackground }),
    };
  };
  const own = explicitDesign(blocks[index]);
  if (own) return own;
  for (let preceding = index - 1; preceding >= 0; preceding--) {
    const design = explicitDesign(blocks[preceding]);
    if (design) return design;
  }
  for (let following = index + 1; following < blocks.length; following++) {
    const design = explicitDesign(blocks[following]);
    if (design) return design;
  }
  return undefined;
}
