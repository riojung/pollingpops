import {
  PresentationSpatialSnapshotSchema,
  resolvePresentationSpatialFrames,
  type PresentationContent,
  type PresentationSpatialSnapshot,
} from "@openround/contracts";

/** The story map carries orientation only; the current block remains the content authority. */
export function presentationSpatialSnapshotFields(content: PresentationContent): {
  spatial?: PresentationSpatialSnapshot;
} {
  if (content.schemaVersion < 14 || !content.spatial) return {};
  return {
    spatial: PresentationSpatialSnapshotSchema.parse({
      schemaVersion: 1,
      frames: resolvePresentationSpatialFrames(content).map(
        ({ x, y, width, height }, blockIndex) => ({ blockIndex, x, y, width, height }),
      ),
    }),
  };
}
