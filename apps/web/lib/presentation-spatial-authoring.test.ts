import { describe, expect, it } from "vitest";
import {
  PresentationDraftSchema,
  preparePresentationPublication,
  resolvePresentationSpatialFrames,
  type PresentationDraft,
} from "@openround/contracts";
import {
  createContentBlock,
  duplicatePresentationBlock,
  insertPresentationBlockDuplicate,
  movePresentationBlock,
  promotePresentationOpinionFormats,
  removePresentationBlock,
  setPresentationSlideHidden,
} from "./presentation-builder";
import {
  autoLayoutPresentationSpatial,
  clampPresentationSpatialFrame,
  disablePresentationSpatial,
  enablePresentationSpatial,
  presentationSpatialSectionBounds,
  reconcilePresentationSpatialBlocks,
  resetPresentationSpatialFrame,
  updatePresentationSpatialFrame,
} from "./presentation-spatial-authoring";
function draft(): PresentationDraft {
  return {
    schemaVersion: 2,
    title: "Spatial authoring",
    description: "",
    experiencePreset: { id: "focus", version: 1 },
    blocks: [createContentBlock(), createContentBlock(), createContentBlock()].map(
      (block, index) => ({
        ...block,
        textElements: block.textElements.map((element) => ({
          ...element,
          text: element.role === "title" ? `Slide ${index + 1}` : "Public body",
        })),
      }),
    ),
  };
}
describe("Presentation spatial authoring", () => {
  it("preserves version 15 when spatial layout is enabled after a text edit", () => {
    const source: PresentationDraft = { ...draft(), schemaVersion: 15, sections: [] };
    const enabled = enablePresentationSpatial(source);
    expect(enabled.schemaVersion).toBe(15);
    expect(PresentationDraftSchema.safeParse(enabled).success).toBe(true);
  });
  it("requires explicit enabling and retains the version floor after disabling or restoring history", () => {
    const source = draft();
    expect(
      reconcilePresentationSpatialBlocks(source, { ...source, title: "Edited" }),
    ).not.toHaveProperty("spatial");
    const enabled = enablePresentationSpatial(source);
    expect(enabled.schemaVersion).toBe(14);
    expect(enabled.spatial?.frames).toEqual(resolvePresentationSpatialFrames(source));
    expect(source).not.toHaveProperty("spatial");
    expect(enablePresentationSpatial(enabled)).toBe(enabled);
    const disabled = disablePresentationSpatial(enabled);
    expect(disabled.schemaVersion).toBe(14);
    expect(disabled).not.toHaveProperty("spatial");
    expect(PresentationDraftSchema.parse(disabled)).not.toHaveProperty("spatial");
    const restored = promotePresentationOpinionFormats(source, enabled.schemaVersion);
    expect(restored.schemaVersion).toBe(14);
    expect(restored).not.toHaveProperty("spatial");
  });
  it("clamps integer geometry inside the world and preserves 16:9 without changing content or order", () => {
    const source = enablePresentationSpatial(draft()),
      id = source.blocks[0]!.id;
    const moved = updatePresentationSpatialFrame(source, id, { x: 999999, y: -7, width: 321 });
    expect(moved.spatial?.frames.find((frame) => frame.blockId === id)).toMatchObject({
      x: 19680,
      y: 0,
      width: 320,
      height: 180,
    });
    expect(moved.blocks).toBe(source.blocks);
    expect(source.spatial?.frames[0]?.x).toBe(0);
    expect(PresentationDraftSchema.safeParse(moved).success).toBe(true);
    expect(
      clampPresentationSpatialFrame({
        blockId: id,
        x: NaN,
        y: Infinity,
        width: Infinity,
        height: 1,
      }),
    ).toMatchObject({ x: 0, y: 0, width: 1280, height: 720 });
    const edge = updatePresentationSpatialFrame(source, id, { x: 19999, y: 19999, width: 3200 });
    expect(edge.spatial?.frames.find((frame) => frame.blockId === id)).toMatchObject({
      x: 16800,
      y: 18200,
      width: 3200,
      height: 1800,
    });
  });
  it("preserves positions across path reorder and remaps duplicate/delete membership", () => {
    let source = enablePresentationSpatial(draft());
    const id = source.blocks[0]!.id;
    source = updatePresentationSpatialFrame(source, id, { x: 640, y: 320, width: 1600 });
    source = {
      ...source,
      sections: [{ id: "10000000-0000-4000-8000-000000000001", title: "Opening", blockIds: [id] }],
    };
    const moved = movePresentationBlock(source, id, 1);
    expect(moved.spatial).toBe(source.spatial);
    const copy = duplicatePresentationBlock(source.blocks[0]!),
      duplicated = insertPresentationBlockDuplicate(source, id, copy);
    expect(duplicated.spatial?.frames.find((frame) => frame.blockId === copy.id)).toMatchObject({
      x: 800,
      y: 416,
      width: 1600,
      height: 900,
    });
    expect(duplicated.sections?.[0]?.blockIds).toEqual([id, copy.id]);
    const removed = removePresentationBlock(duplicated, id);
    expect(removed.spatial?.frames.some((frame) => frame.blockId === id)).toBe(false);
    expect(removed.spatial?.frames.some((frame) => frame.blockId === copy.id)).toBe(true);
    expect(removed.sections?.[0]?.blockIds).toEqual([copy.id]);
    expect(removed.schemaVersion).toBe(14);
  });
  it("fills only newly inserted frames and leaves existing sparse metadata untouched on text edits", () => {
    const enabled = enablePresentationSpatial(draft()),
      sparse = {
        ...enabled,
        spatial: { schemaVersion: 1 as const, frames: [enabled.spatial!.frames[0]!] },
      };
    const text = { ...sparse, title: "Updated" };
    expect(reconcilePresentationSpatialBlocks(sparse, text)).toBe(text);
    const next = { ...sparse, blocks: [...sparse.blocks, createContentBlock()] },
      added = reconcilePresentationSpatialBlocks(sparse, next);
    expect(added.spatial?.frames.map((frame) => frame.blockId)).toEqual([
      sparse.blocks[0]!.id,
      next.blocks[3]!.id,
    ]);
    expect(added.spatial?.frames[1]).toMatchObject({ x: 4800, y: 0, width: 1280, height: 720 });
  });
  it("retains hidden planning frames but strips them and empty section bounds from preview publication", () => {
    const source = enablePresentationSpatial(draft()),
      id = source.blocks[0]!.id;
    const hidden = setPresentationSlideHidden(
      {
        ...source,
        sections: [
          { id: "10000000-0000-4000-8000-000000000001", title: "Private planning", blockIds: [id] },
        ],
      },
      id,
      true,
    );
    expect(hidden.spatial?.frames.some((frame) => frame.blockId === id)).toBe(true);
    const publication = preparePresentationPublication(hidden);
    expect(publication.spatial?.frames.some((frame) => frame.blockId === id)).toBe(false);
    expect(publication.sections).toEqual([]);
    expect(
      presentationSpatialSectionBounds(publication, resolvePresentationSpatialFrames(publication)),
    ).toEqual([]);
    expect(
      presentationSpatialSectionBounds(hidden, resolvePresentationSpatialFrames(hidden)),
    ).toHaveLength(1);
  });
  it("resets one frame or auto layouts all frames without changing UUIDs, section IDs or the path", () => {
    const source = enablePresentationSpatial(draft()),
      id = source.blocks[1]!.id,
      moved = updatePresentationSpatialFrame(source, id, { x: 8000, y: 9000, width: 2000 }),
      reset = resetPresentationSpatialFrame(moved, id);
    expect(resolvePresentationSpatialFrames(reset)).toEqual(
      resolvePresentationSpatialFrames(source),
    );
    expect(autoLayoutPresentationSpatial(moved).spatial).toEqual(source.spatial);
    expect(autoLayoutPresentationSpatial(source)).toBe(source);
    expect(moved.blocks.map((block) => block.id)).toEqual(source.blocks.map((block) => block.id));
  });
});
