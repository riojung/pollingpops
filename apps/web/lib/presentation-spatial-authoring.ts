import {
  resolvePresentationSpatialFrames,
  type PresentationDraft,
  type PresentationSpatialFrame,
} from "@openround/contracts";
const key = (id: string) => id.toLowerCase();
/** Geometry edits remain inside the bounded world and preserve the slide's 16:9 aspect. */
export function clampPresentationSpatialFrame(
  frame: PresentationSpatialFrame,
): PresentationSpatialFrame {
  const finite = (value: number, fallback: number) => (Number.isFinite(value) ? value : fallback);
  const width = Math.max(320, Math.min(3200, Math.round(finite(frame.width, 1280) / 16) * 16)),
    height = (width * 9) / 16;
  return {
    ...frame,
    width,
    height,
    x: Math.round(Math.max(0, Math.min(20000 - width, finite(frame.x, 0)))),
    y: Math.round(Math.max(0, Math.min(20000 - height, finite(frame.y, 0)))),
  };
}
export function enablePresentationSpatial(draft: PresentationDraft): PresentationDraft {
  if (draft.spatial) return draft;
  return {
    ...draft,
    schemaVersion: 14,
    sections: draft.sections ?? [],
    spatial: {
      schemaVersion: 1,
      frames: resolvePresentationSpatialFrames({ blocks: draft.blocks }),
    },
  };
}
export function disablePresentationSpatial(draft: PresentationDraft): PresentationDraft {
  if (!draft.spatial) return draft;
  const { spatial: removed, ...next } = draft;
  void removed;
  return next;
}
export function autoLayoutPresentationSpatial(draft: PresentationDraft): PresentationDraft {
  if (!draft.spatial) return draft;
  const frames = resolvePresentationSpatialFrames({ blocks: draft.blocks });
  return JSON.stringify(frames) === JSON.stringify(draft.spatial.frames)
    ? draft
    : { ...draft, spatial: { schemaVersion: 1, frames } };
}
export function updatePresentationSpatialFrame(
  draft: PresentationDraft,
  blockId: string,
  patch: Partial<Pick<PresentationSpatialFrame, "x" | "y" | "width">>,
): PresentationDraft {
  if (!draft.spatial) return draft;
  const frame = resolvePresentationSpatialFrames(draft).find(
    (frame) => key(frame.blockId) === key(blockId),
  );
  if (!frame) return draft;
  const next = clampPresentationSpatialFrame({ ...frame, ...patch });
  const existing = draft.spatial.frames.find((frame) => key(frame.blockId) === key(blockId));
  if (existing && JSON.stringify(existing) === JSON.stringify(next)) return draft;
  return {
    ...draft,
    spatial: {
      schemaVersion: 1,
      frames: existing
        ? draft.spatial.frames.map((frame) => (key(frame.blockId) === key(blockId) ? next : frame))
        : [...draft.spatial.frames, next],
    },
  };
}
export function resetPresentationSpatialFrame(
  draft: PresentationDraft,
  blockId: string,
): PresentationDraft {
  const fallback = resolvePresentationSpatialFrames({ blocks: draft.blocks }).find(
    (frame) => key(frame.blockId) === key(blockId),
  );
  return fallback ? updatePresentationSpatialFrame(draft, blockId, fallback) : draft;
}
/** Reconcile only block insertions/deletions; text edits never materialize existing sparse frames. */
export function reconcilePresentationSpatialBlocks(
  before: PresentationDraft,
  next: PresentationDraft,
): PresentationDraft {
  if (!next.spatial) return next;
  const oldIds = new Set(before.blocks.map((block) => key(block.id))),
    ids = new Set(next.blocks.map((block) => key(block.id)));
  const frames = next.spatial.frames.filter((frame) => ids.has(key(frame.blockId)));
  const stored = new Set(frames.map((frame) => key(frame.blockId)));
  const added = resolvePresentationSpatialFrames(next).filter(
    (frame) => !oldIds.has(key(frame.blockId)) && !stored.has(key(frame.blockId)),
  );
  if (frames.length === next.spatial.frames.length && !added.length) return next;
  return { ...next, spatial: { schemaVersion: 1, frames: [...frames, ...added] } };
}
export function copyPresentationSpatialFrame(
  before: PresentationDraft,
  next: PresentationDraft,
  sourceId: string,
  copyId: string,
): PresentationDraft {
  if (!next.spatial) return next;
  const source = resolvePresentationSpatialFrames(before).find(
    (frame) => key(frame.blockId) === key(sourceId),
  );
  if (!source) return reconcilePresentationSpatialBlocks(before, next);
  const copied = clampPresentationSpatialFrame({
    ...source,
    blockId: copyId,
    x: source.x + 160,
    y: source.y + 96,
  });
  return {
    ...next,
    spatial: {
      schemaVersion: 1,
      frames: [
        ...next.spatial.frames.filter((frame) => key(frame.blockId) !== key(copyId)),
        copied,
      ],
    },
  };
}
export function presentationSpatialSectionBounds(
  draft: PresentationDraft,
  frames: readonly PresentationSpatialFrame[],
) {
  const byId = new Map(frames.map((frame) => [key(frame.blockId), frame]));
  return (draft.sections ?? []).flatMap((section) => {
    const members = section.blockIds.flatMap((id) => byId.get(key(id)) ?? []);
    if (!members.length) return [];
    const x = Math.min(...members.map((frame) => frame.x)),
      y = Math.min(...members.map((frame) => frame.y));
    return [
      {
        sectionId: section.id,
        title: section.title,
        x,
        y,
        width: Math.max(...members.map((frame) => frame.x + frame.width)) - x,
        height: Math.max(...members.map((frame) => frame.y + frame.height)) - y,
      },
    ];
  });
}
