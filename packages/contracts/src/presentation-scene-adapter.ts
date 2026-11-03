import { ContentSlideDraftSchema, type ContentSlideDraft } from "./index";
import { PresentationSceneDraftSchema, type PresentationSceneNode } from "./presentation-scene";
import { contentSlideMediaFrame, resolveContentSlideFrames } from "./slide-geometry";

const legacyRegions = [
  "top_left",
  "top_center",
  "top_right",
  "middle_left",
  "middle_center",
  "middle_right",
  "bottom_left",
  "bottom_center",
  "bottom_right",
] as const;

/**
 * Explicit, deterministic conversion. It retains block metadata and text/node IDs verbatim;
 * stricter scene validation rejects incompatible source data without sanitizing or truncating it.
 * Private-media UUIDs use the same canonical lowercase representation as PostgreSQL.
 * The caller opts its containing document into v4 as part of the same mutation.
 */
export function adaptContentSlideToScene(slide: ContentSlideDraft): ContentSlideDraft {
  ContentSlideDraftSchema.parse(slide);
  if (slide.scene) return structuredClone(slide);
  const frames = resolveContentSlideFrames(slide);
  const nodes: PresentationSceneNode[] = slide.textElements.map((element) => ({
    id: element.id,
    frame: { ...frames[element.id]! },
    type: "text",
    role: element.role,
    text: element.text,
  }));
  const readingOrder = legacyRegions.flatMap((region) =>
    slide.textElements
      .filter((element) => element.region === region)
      .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id))
      .map((element) => element.id),
  );
  if (slide.mediaId) {
    const textIds = new Set(nodes.map((node) => node.id));
    const baseId = `${slide.id}:image`;
    let imageId = baseId;
    for (let suffix = 1; textIds.has(imageId); suffix += 1) imageId = `${baseId}:${suffix}`;
    nodes.push({
      id: imageId,
      frame: { ...contentSlideMediaFrame },
      type: "image",
      mediaId: slide.mediaId,
      altText: slide.mediaAlt,
    });
    readingOrder.push(imageId);
  }
  const scene = PresentationSceneDraftSchema.parse({
    schemaVersion: 1,
    aspectRatio: "16:9",
    nodes,
    readingOrder,
  });
  return {
    ...structuredClone(slide),
    textElements: [],
    mediaId: null,
    mediaAlt: null,
    scene,
  };
}
