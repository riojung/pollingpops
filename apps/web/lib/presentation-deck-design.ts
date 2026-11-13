import {
  PresentationDraftSchema,
  PresentationSceneDesignSchema,
  type PresentationDraft,
  type PresentationScene,
  type PresentationSceneDesign,
} from "@openround/contracts";

/** Promote only when needed; adding plain slides or formatting never downgrades a deck. */
export function nativeSceneDocumentVersion(
  current: PresentationDraft["schemaVersion"],
  scene: Pick<PresentationScene, "schemaVersion">,
): PresentationDraft["schemaVersion"] {
  const minimum =
    scene.schemaVersion >= 8
      ? 17
      : scene.schemaVersion >= 7
        ? 16
        : scene.schemaVersion >= 6
          ? 13
          : scene.schemaVersion === 5
            ? 11
            : scene.schemaVersion === 4
              ? 8
              : scene.schemaVersion === 3
                ? 7
                : scene.schemaVersion === 2
                  ? 5
                  : 4;
  return current >= minimum ? current : minimum;
}

/** Validate the entire document before a native edit enters history or an autosave envelope. */
export function applyNativeSceneToDeck(
  draft: PresentationDraft,
  blockId: string,
  scene: PresentationScene,
): PresentationDraft {
  const block = draft.blocks.find((block) => block.id === blockId);
  if (block?.kind !== "content" || !block.scene) return draft;
  const next = {
    ...draft,
    schemaVersion: nativeSceneDocumentVersion(draft.schemaVersion, scene),
    ...(scene.schemaVersion >= 6 && draft.sections === undefined ? { sections: [] } : {}),
    blocks: draft.blocks.map((block) => (block.id === blockId ? { ...block, scene } : block)),
  };
  PresentationDraftSchema.parse(next);
  return next;
}

/** Apply public design tokens without converting ordinary slides or rewriting any content. */
export function applyNativeDesignToDeck(
  draft: PresentationDraft,
  value: PresentationSceneDesign,
): PresentationDraft {
  const design = PresentationSceneDesignSchema.parse(value);
  let changed = false;
  const blocks = draft.blocks.map((block) => {
    if (block.kind !== "content" || !block.scene) return block;
    if (
      block.scene.schemaVersion >= 3 &&
      block.scene.design?.theme === design.theme &&
      block.scene.design.font === design.font &&
      block.scene.design.spacing === design.spacing &&
      block.scene.design.motionBackground === design.motionBackground
    )
      return block;
    changed = true;
    return {
      ...block,
      scene: {
        ...block.scene,
        schemaVersion: Math.max(
          block.scene.schemaVersion,
          design.motionBackground ? 8 : 3,
        ) as PresentationScene["schemaVersion"],
        design: { ...design },
      },
    };
  });
  if (!changed) return draft;
  const minimumVersion = design.motionBackground ? 17 : 7;
  const next = {
    ...draft,
    schemaVersion: Math.max(
      draft.schemaVersion,
      minimumVersion,
    ) as PresentationDraft["schemaVersion"],
    ...(minimumVersion >= 12 && draft.sections === undefined ? { sections: [] } : {}),
    blocks,
  };
  // Check the complete document budget before applying an all-slide operation. Keep existing
  // objects and frozen baselines rather than replacing them with a parsed/canonicalized copy.
  PresentationDraftSchema.parse(next);
  return next;
}
