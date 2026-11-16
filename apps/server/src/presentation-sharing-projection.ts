import {
  PresentationContentSchema,
  PresentationReviewSchema,
  PresentationSceneSchema,
  type PresentationSceneNode,
} from "@openround/contracts";
import type { PresentationShareRecord, PresentationVersionRecord } from "@openround/db";
import { presentationBlockDesign } from "./presentation-block-design.js";
const nodeFields: Record<PresentationSceneNode["type"], readonly string[]> = {
  text: ["role", "text", "richText", "lang", "typography"],
  image: ["mediaId", "altText", "fit", "focalPoint"],
  shape: ["shape", "color", "label", "appearance", "decorative"],
  connector: ["from", "to", "label", "color"],
  table: ["caption", "headers", "rows"],
  chart: ["chartType", "title", "summary", "categories", "series"],
  reveal: ["scope", "label", "body"],
  link: ["label", "href"],
  hotspot: ["scope", "label", "detailTitle", "body", "imageNodeId"],
  dialog: ["scope", "label", "detailTitle", "body"],
  navigation: ["label", "targetBlockId"],
};
function projectScene(
  scene: NonNullable<
    Extract<PresentationVersionRecord["content"]["blocks"][number], { kind: "content" }>["scene"]
  >,
) {
  const nodes = scene.nodes.map((node) =>
    Object.fromEntries(
      ["id", "type", "frame", "rotation", ...nodeFields[node.type]]
        .filter((key) => key in node)
        .map((key) => [key, structuredClone(node[key as keyof typeof node])]),
    ),
  );
  // In review, broadcast audience text deliberately becomes viewer-local. No live reveal state is copied.
  return PresentationSceneSchema.parse({
    aspectRatio: "16:9",
    schemaVersion: scene.schemaVersion,
    nodes,
    readingOrder: [...scene.readingOrder],
    ...(scene.design ? { design: structuredClone(scene.design) } : {}),
    ...(scene.groups ? { groups: structuredClone(scene.groups) } : {}),
  });
}
export function projectPresentationReview(
  version: PresentationVersionRecord,
  share: Pick<PresentationShareRecord, "expiresAt">,
) {
  const source = PresentationContentSchema.parse(version.content);
  const blocks = source.blocks.map((block) => {
    const design = presentationBlockDesign(source.blocks, block.id);
    // Freeze inherited appearance before an export selects a single page. Donor-less
    // legacy presentations still omit design and retain their original rendering.
    const effectiveDesign = design ? { design } : {};
    if (block.kind === "content")
      return {
        id: block.id,
        kind: block.kind,
        layout: block.layout,
        textElements: block.textElements.map((element) => ({
          id: element.id,
          role: element.role,
          text: element.text,
          region: element.region,
          order: element.order,
          ...(element.frame ? { frame: { ...element.frame } } : {}),
        })),
        mediaId: block.mediaId,
        mediaAlt: block.mediaAlt,
        ...effectiveDesign,
        ...(block.scene ? { scene: projectScene(block.scene) } : {}),
      };
    const q = block.question;
    return {
      id: block.id,
      kind: block.kind,
      ...effectiveDesign,
      question: {
        type: q.type,
        prompt: q.prompt,
        mediaId: q.mediaId,
        mediaAlt: q.mediaAlt,
        ...("choices" in q ? { choices: q.choices.map(({ id, label }) => ({ id, label })) } : {}),
        ...(q.type === "numeric" ? { unit: q.unit } : {}),
        ...(q.type === "rating"
          ? { rating: { min: q.min, max: q.max, minLabel: q.minLabel, maxLabel: q.maxLabel } }
          : {}),
      },
    };
  });
  return PresentationReviewSchema.parse({
    schemaVersion: 1,
    versionId: version.id,
    version: version.version,
    title: source.title,
    blocks,
    sections: (source.sections ?? []).map(({ id, title, blockIds }) => ({
      id,
      title,
      blockIds: [...blockIds],
    })),
    expiresAt: share.expiresAt.toISOString(),
  });
}
export function presentationReviewMediaIds(review: ReturnType<typeof projectPresentationReview>) {
  const ids = new Set<string>();
  for (const block of review.blocks) {
    const mediaId = block.kind === "content" ? block.mediaId : block.question.mediaId;
    if (mediaId) ids.add(mediaId.toLowerCase());
    if (block.kind === "content")
      for (const node of block.scene?.nodes ?? [])
        if (node.type === "image") ids.add(node.mediaId.toLowerCase());
  }
  return ids;
}
