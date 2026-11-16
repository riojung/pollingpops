import {
  PresentationDraftSchema,
  type PresentationBlockDraft,
  type PresentationDraft,
  type PresentationSection,
} from "@openround/contracts";
import {
  addPresentationSection,
  presentationInteractionTargets,
  presentationSectionForBlock,
} from "./presentation-builder";

export interface PresentationSectionRun {
  key: string;
  section: PresentationSection | null;
  blocks: PresentationBlockDraft[];
  startIndex: number;
  continued: boolean;
}

/** Read the actual playback order, including older, noncontiguous memberships. */
export function presentationSectionRuns(
  blocks: PresentationBlockDraft[],
  sections: PresentationSection[] = [],
): PresentationSectionRun[] {
  const runs: PresentationSectionRun[] = [];
  const seen = new Set<string>();
  for (const [index, block] of blocks.entries()) {
    const section = presentationSectionForBlock(sections, block.id) ?? null;
    const sectionKey = section?.id.toLowerCase() ?? "unsectioned";
    const previous = runs.at(-1);
    if (previous && (previous.section?.id.toLowerCase() ?? "unsectioned") === sectionKey) {
      previous.blocks.push(block);
    } else {
      runs.push({
        key: `${sectionKey}:${block.id.toLowerCase()}`,
        section,
        blocks: [block],
        startIndex: index,
        continued: seen.has(sectionKey),
      });
      seen.add(sectionKey);
    }
  }
  // Empty draft sections still have a reachable rename/remove control.
  for (const section of sections) {
    if (seen.has(section.id.toLowerCase())) continue;
    runs.push({
      key: `${section.id.toLowerCase()}:empty`,
      section,
      blocks: [],
      startIndex: blocks.length,
      continued: false,
    });
  }
  return runs;
}

/** Split the selected run at the selected slide without changing any slide order. */
export function addPresentationSectionAtBlock(
  draft: PresentationDraft,
  sectionId: string,
  title: string,
  selectedBlockId: string | null,
): PresentationDraft {
  const added = addPresentationSection(draft, sectionId, title);
  if (added === draft || !selectedBlockId) return added;
  const run = presentationSectionRuns(draft.blocks, draft.sections).find((run) =>
    run.blocks.some((block) => block.id.toLowerCase() === selectedBlockId.toLowerCase()),
  );
  if (!run) return added;
  const start = run.blocks.findIndex(
    (block) => block.id.toLowerCase() === selectedBlockId.toLowerCase(),
  );
  const blockIds = run.blocks.slice(start).map((block) => block.id);
  const moved = new Set(blockIds.map((id) => id.toLowerCase()));
  return {
    ...added,
    sections: added.sections!.map((section) =>
      section.id === sectionId
        ? { ...section, blockIds }
        : section.blockIds.some((id) => moved.has(id.toLowerCase()))
          ? { ...section, blockIds: section.blockIds.filter((id) => !moved.has(id.toLowerCase())) }
          : section,
    ),
  };
}

function preservesInteractionTargets(before: PresentationDraft, after: PresentationDraft) {
  return before.blocks.every((block) => {
    const forwardTargets = block.kind === "question" ? (block.branches ?? []) : [];
    const navigationTargets =
      block.kind === "content"
        ? (block.scene?.nodes.filter((node) => node.type === "navigation") ?? [])
        : [];
    return [
      { targets: forwardTargets, forward: true },
      { targets: navigationTargets, forward: false },
    ].every(({ targets, forward }) => {
      if (!targets.length) return true;
      const validBefore = new Set(
        presentationInteractionTargets(before, block.id, forward).map((target) =>
          target.id.toLowerCase(),
        ),
      );
      const validAfter = new Set(
        presentationInteractionTargets(after, block.id, forward).map((target) =>
          target.id.toLowerCase(),
        ),
      );
      return targets.every(({ targetBlockId }) => {
        const id = targetBlockId?.toLowerCase();
        return !id || !validBefore.has(id) || validAfter.has(id);
      });
    });
  });
}

/** Move a whole, contiguous section one run earlier/later; never regroup legacy records. */
export function movePresentationSection(
  draft: PresentationDraft,
  sectionId: string,
  direction: -1 | 1,
): PresentationDraft {
  const runs = presentationSectionRuns(draft.blocks, draft.sections).filter(
    (run) => run.blocks.length,
  );
  const matching = runs.filter((run) => run.section?.id.toLowerCase() === sectionId.toLowerCase());
  if (matching.length !== 1) return draft;
  const source = runs.indexOf(matching[0]!);
  const target = source + direction;
  const neighbor = runs[target];
  if (!neighbor) return draft;
  if (
    neighbor.section &&
    runs.filter((run) => run.section?.id === neighbor.section?.id).length !== 1
  )
    return draft;
  [runs[source], runs[target]] = [runs[target]!, runs[source]!];
  const blocks = runs.flatMap((run) => run.blocks);
  const next = { ...draft, blocks };
  const nextIndices = new Map(blocks.map((block, index) => [block.id, index]));
  const preservesLinkedChecks = draft.blocks.every((block, index) => {
    if (block.kind !== "question" || !block.question.linkedRecheckQuestionId) return true;
    const target = draft.blocks.findIndex(
      (candidate) =>
        candidate.kind === "question" &&
        candidate.question.id.toLowerCase() ===
          block.question.linkedRecheckQuestionId!.toLowerCase(),
    );
    return (
      target <= index || nextIndices.get(draft.blocks[target]!.id)! > nextIndices.get(block.id)!
    );
  });
  // IDs, block content, memberships and spatial frames retain their exact identities.
  // Draft schemas allow incomplete relationships. Preserve every currently ordered
  // pair and valid publish-time branch/navigation target explicitly as well.
  if (
    !preservesLinkedChecks ||
    !PresentationDraftSchema.safeParse(next).success ||
    !preservesInteractionTargets(draft, next)
  )
    return draft;
  return next;
}

export function canMovePresentationSection(
  draft: PresentationDraft,
  sectionId: string,
  direction: -1 | 1,
) {
  return movePresentationSection(draft, sectionId, direction) !== draft;
}
