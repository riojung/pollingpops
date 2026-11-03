import type {
  ContentSlideDraft,
  PresentationContent,
  PresentationDraft,
  QuizDraft,
  RecoveryPackDraft,
  IdeaBoardStored,
} from "@openround/contracts";

function uniqueMediaIds(mediaIds: Array<string | null | undefined>) {
  return [...new Set(mediaIds.filter((mediaId): mediaId is string => Boolean(mediaId)))];
}

export function ideaBoardMediaIds(content: Pick<IdeaBoardStored, "ideas">) {
  return uniqueMediaIds(
    content.ideas.flatMap((idea) =>
      idea.status === "removed" ? [] : (idea.attachments ?? []).map((item) => item.mediaId),
    ),
  );
}

export function quizMediaIds(content: QuizDraft) {
  return uniqueMediaIds([
    ...content.questions.map((question) => question.mediaId),
    ...(content.recoveryPackInsertions ?? []).flatMap((insertion) => [
      ...recoveryPackMediaIds(insertion.originalContent),
      ...(insertion.updateBaseline ? recoveryPackMediaIds(insertion.updateBaseline.content) : []),
    ]),
  ]);
}

export function recoveryPackMediaIds(content: RecoveryPackDraft) {
  return uniqueMediaIds([
    content.diagnostic.mediaId,
    content.recheck.mediaId,
    content.delayedProbe?.mediaId,
  ]);
}

/** Placement paths are shared by publication checks and the retention graph. */
export function presentationMediaReferences(content: PresentationDraft | PresentationContent) {
  const references: Array<{ mediaId: string; fieldPath: readonly (string | number)[] }> = [];
  for (const [blockIndex, block] of content.blocks.entries()) {
    if (block.kind === "question") {
      if (block.question.mediaId)
        references.push({
          mediaId: block.question.mediaId,
          fieldPath: ["blocks", blockIndex, "question", "mediaId"],
        });
      continue;
    }
    if (block.mediaId)
      references.push({ mediaId: block.mediaId, fieldPath: ["blocks", blockIndex, "mediaId"] });
    for (const [nodeIndex, node] of (block.scene?.nodes ?? []).entries()) {
      if (node.type === "image")
        references.push({
          mediaId: node.mediaId,
          fieldPath: ["blocks", blockIndex, "scene", "nodes", nodeIndex, "mediaId"],
        });
    }
  }
  // Frozen Pack baselines remain assets even after their local questions are edited or removed.
  for (const [index, insertion] of (content.recoveryPackInsertions ?? []).entries()) {
    const baselines = [
      {
        content: insertion.originalContent,
        path: ["recoveryPackInsertions", index, "originalContent"],
      },
      ...(insertion.updateBaseline
        ? [
            {
              content: insertion.updateBaseline.content,
              path: ["recoveryPackInsertions", index, "updateBaseline", "content"],
            },
          ]
        : []),
    ];
    for (const baseline of baselines) {
      for (const role of ["diagnostic", "recheck", "delayedProbe"] as const) {
        const mediaId = baseline.content[role]?.mediaId;
        if (mediaId) references.push({ mediaId, fieldPath: [...baseline.path, role, "mediaId"] });
      }
    }
  }
  return references;
}

/** Only assets on the current visible content block authorize participant media delivery. */
export function presentationContentBlockMediaIds(block: ContentSlideDraft) {
  return uniqueMediaIds([
    block.mediaId,
    ...(block.scene?.nodes ?? []).flatMap((node) => (node.type === "image" ? [node.mediaId] : [])),
  ]);
}

export function presentationMediaIds(content: PresentationDraft | PresentationContent) {
  return uniqueMediaIds(presentationMediaReferences(content).map((reference) => reference.mediaId));
}
