import {
  preparePresentationPublication,
  type PresentationContent,
  type QuestionDraft,
} from "@openround/contracts";
import type { LibraryShareRecord, LibraryShareSnapshot } from "@openround/db";
import { projectPresentationReview } from "./presentation-sharing-projection.js";

function visiblePresentationContent(content: PresentationContent): PresentationContent {
  // Canonical preparation maintains sections and spatial layout alongside visible slides.
  const visible = structuredClone(preparePresentationPublication(content)) as PresentationContent;
  const ids = new Set(visible.blocks.map((block) => block.id.toLowerCase()));
  for (const block of visible.blocks) {
    if (block.kind === "question") {
      if (block.branches)
        block.branches = block.branches.filter(
          (branch) => branch.targetBlockId !== null && ids.has(branch.targetBlockId.toLowerCase()),
        );
      continue;
    }
    if (!block.scene) continue;
    const removed = new Set(
      block.scene.nodes
        .filter(
          (node) =>
            node.type === "navigation" &&
            (node.targetBlockId === null || !ids.has(node.targetBlockId.toLowerCase())),
        )
        .map((node) => node.id),
    );
    for (const node of block.scene.nodes)
      if (
        node.type === "connector" &&
        (removed.has(node.from.nodeId) || removed.has(node.to.nodeId))
      )
        removed.add(node.id);
    block.scene.nodes = block.scene.nodes.filter((node) => !removed.has(node.id));
    block.scene.readingOrder = block.scene.readingOrder.filter((id) => !removed.has(id));
    if (block.scene.groups)
      block.scene.groups = block.scene.groups
        .map((group) => ({
          ...group,
          nodeIds: group.nodeIds.filter((id) => !removed.has(id)),
        }))
        .filter((group) => group.nodeIds.length >= 2);
  }
  return visible;
}

/** An explicit audience projection: answer keys and source provenance never enter a reader. */
export function libraryReaderQuestion(question: QuestionDraft, required?: boolean) {
  return {
    id: question.id,
    type: question.type,
    prompt: question.prompt,
    mediaId: question.mediaId,
    mediaAlt: question.mediaAlt,
    ...("choices" in question
      ? { choices: question.choices.map(({ id, label }) => ({ id, label })) }
      : {}),
    ...(question.type === "numeric" ? { unit: question.unit } : {}),
    ...(question.type === "rating"
      ? {
          min: question.min,
          max: question.max,
          minLabel: question.minLabel,
          maxLabel: question.maxLabel,
        }
      : {}),
    ...(question.type === "ranking" ? { rankCount: question.rankCount } : {}),
    ...("maxSelections" in question && question.maxSelections !== undefined
      ? { maxSelections: question.maxSelections }
      : {}),
    ...(required === undefined ? {} : { required }),
  };
}

export function projectLibraryReader(share: LibraryShareRecord) {
  const snapshot = share.snapshot;
  if (snapshot.artifactType === "round")
    return {
      questions: snapshot.content.questions.map((question) => libraryReaderQuestion(question)),
    };
  if (snapshot.artifactType === "survey")
    return {
      questions: snapshot.content.items.map(({ question, required }) =>
        libraryReaderQuestion(question, required),
      ),
    };
  const content = visiblePresentationContent(snapshot.content);
  const review = projectPresentationReview(
    {
      id: share.versionId,
      workspaceId: share.sourceWorkspaceId,
      presentationId: share.artifactId,
      version: 1,
      content,
      contentHash: "",
      sourceDraftRevision: 0,
      publishedAt: new Date(share.sharedAt),
    },
    // The authenticated catalog has no bearer expiry; the value is display metadata only.
    { expiresAt: new Date("9999-12-31T23:59:59.999Z") },
  );
  return { review };
}

function walk(value: unknown, visit: (key: string, value: unknown) => unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => walk(item, visit));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, child]) => {
      const next = visit(key, child);
      return next === undefined ? [] : [[key, walk(next, visit)]];
    }),
  );
}

/** Independent drafts retain scoring keys but do not retain private source-workspace material. */
export function reusableLibrarySnapshot(snapshot: LibraryShareSnapshot): LibraryShareSnapshot {
  const privateFields = new Set([
    "sourceCitations",
    "citations",
    "sourceDisclosure",
    "textAssistance",
    "provenance",
    "livePublishedQuestions",
    "liveQuickCheck",
    "recoveryPackSource",
    "recoveryPackInsertions",
  ]);
  const copy = walk(snapshot, (key, child) =>
    privateFields.has(key) ? undefined : key === "speakerNotes" ? "" : child,
  ) as LibraryShareSnapshot;
  if (copy.artifactType === "presentation") copy.content = visiblePresentationContent(copy.content);
  return copy;
}

export function librarySnapshotMediaIds(snapshot: unknown) {
  const ids = new Set<string>();
  walk(snapshot, (key, value) => {
    if (key === "mediaId" && typeof value === "string") ids.add(value.toLowerCase());
    return value;
  });
  return ids;
}

export function rewriteLibraryMedia(
  snapshot: LibraryShareSnapshot,
  ids: ReadonlyMap<string, string>,
) {
  return walk(snapshot, (key, value) =>
    key === "mediaId" && typeof value === "string" ? ids.get(value.toLowerCase()) : value,
  ) as LibraryShareSnapshot;
}
