import {
  type PresentationBlock,
  type PresentationControlCommand,
  type PresentationHostSnapshot,
} from "@openround/contracts";
import type {
  PresentationSessionRecord,
  PresentationSessionResponseRecord,
  PresentationSessionTransitionInput,
} from "@openround/db";
import {
  presentationNavigationBlockedReason,
  presentationNavigationBlockTitle,
  presentationNavigationTransition,
} from "./presentation-navigation.js";
import { PresentationSessionServiceError } from "./presentation-session-errors.js";
import { presentationResponsesForContent } from "./presentation-response-identifiers.js";

type Transition = Omit<
  PresentationSessionTransitionInput,
  "workspaceId" | "sessionId" | "expectedRevision"
>;
type AdvancedCommand = Extract<
  PresentationControlCommand,
  {
    action: "set_reveal" | "navigate_scene" | "follow_branch";
  }
>;
const sameId = (left: string, right: string) => left.toLowerCase() === right.toLowerCase();

function currentBlock(session: PresentationSessionRecord) {
  return session.content.blocks[session.currentBlockIndex] ?? null;
}
function fail(message: string): never {
  throw new PresentationSessionServiceError(409, "PHASE_CLOSED", message);
}

/** Public scene projection is conservative even when called without a live session. */
export function presentationDeliveredScene(
  block: Extract<PresentationBlock, { kind: "content" }>,
  session?: PresentationSessionRecord,
  staff = false,
) {
  if (!block.scene) return undefined;
  const scene = structuredClone(block.scene);
  if (staff) return scene;
  for (const node of scene.nodes) {
    if (node.type === "reveal" && node.scope === "broadcast") {
      const open = session?.interactionState?.reveals.some(
        (entry) => sameId(entry.blockId, block.id) && entry.nodeId === node.id && entry.revealed,
      );
      if (!open) node.body = "";
    }
    // A live audience receives an affordance, never the staff-only target graph.
    if (node.type === "navigation") node.targetBlockId = null;
  }
  return scene;
}

export function presentationInteractionSnapshot(session: PresentationSessionRecord, staff = false) {
  if (session.content.schemaVersion < 13) return undefined;
  const block = currentBlock(session);
  return {
    reveals: structuredClone(
      (session.interactionState?.reveals ?? []).filter(
        (entry) => staff || (block && sameId(entry.blockId, block.id)),
      ),
    ),
  };
}

function branchEvidence(
  session: PresentationSessionRecord,
  responses: readonly PresentationSessionResponseRecord[],
) {
  const block = currentBlock(session);
  if (block?.kind !== "question") return [];
  const accepted = presentationResponsesForContent(session.content, responses).filter((response) =>
    sameId(response.blockId, block.id),
  );
  return (block.branches ?? []).map((branch) => {
    const condition = branch.condition;
    const denominator =
      condition.kind === "correct_share"
        ? accepted.filter((response) => response.correct !== null)
        : accepted;
    const matched = denominator.filter((response) =>
      condition.kind === "correct_share"
        ? response.correct === true
        : response.response.choiceIds?.some((id) => sameId(id, condition.choiceId)) === true,
    ).length;
    const targetIndex = session.content.blocks.findIndex(
      (candidate) => branch.targetBlockId !== null && sameId(candidate.id, branch.targetBlockId),
    );
    const target = session.content.blocks[targetIndex];
    let blockedReason = presentationNavigationBlockedReason(session);
    if (!blockedReason && session.phase !== "question_reveal")
      blockedReason = "Close and reveal this activity before following an answer branch.";
    if (!blockedReason && !target) blockedReason = "This branch target is unavailable.";
    if (!blockedReason && denominator.length < branch.condition.minResponses)
      blockedReason = `This branch needs at least ${branch.condition.minResponses} accepted responses.`;
    if (!blockedReason && matched * 100 < denominator.length * branch.condition.minPercent)
      blockedReason = "The accepted responses do not meet this branch condition.";
    return { branch, denominator: denominator.length, matched, target, targetIndex, blockedReason };
  });
}

export function presentationBranchSnapshot(
  session: PresentationSessionRecord,
  responses: readonly PresentationSessionResponseRecord[],
): PresentationHostSnapshot["branches"] {
  if (session.content.schemaVersion < 13) return undefined;
  return branchEvidence(session, responses).map(
    ({ branch, target, targetIndex, blockedReason }) => ({
      id: branch.id,
      label: branch.label,
      targetBlockId: target?.id ?? branch.targetBlockId!,
      targetTitle: target
        ? presentationNavigationBlockTitle(target, targetIndex)
        : "Unavailable target",
      available: blockedReason === null,
      blockedReason,
    }),
  );
}

export function presentationAdvancedInteractionTransition(
  session: PresentationSessionRecord,
  command: AdvancedCommand,
  responses: readonly PresentationSessionResponseRecord[] = [],
): Transition {
  if (session.content.schemaVersion < 13)
    fail("Publish a presentation with advanced interactions before using this action.");
  if (session.status !== "active") fail("This presentation has finished.");
  const block = currentBlock(session);
  if (!block || !sameId(block.id, command.blockId))
    fail("This interaction is not on the current published block.");
  if (command.action === "follow_branch") {
    const selected = branchEvidence(session, responses).find(({ branch }) =>
      sameId(branch.id, command.branchId),
    );
    if (!selected) fail("Choose a branch on the current published activity.");
    if (selected.blockedReason) fail(selected.blockedReason);
    if (!selected.target) fail("This branch target is unavailable.");
    const transition = presentationNavigationTransition(session, {
      ...command,
      action: "jump_to_block",
      targetBlockId: selected.target.id,
    });
    return {
      ...transition,
      event: {
        ...transition.event,
        type: "navigation.branched",
        branch: {
          branchId: selected.branch.id,
          sourceBlockId: block.id,
          targetBlockId: selected.target.id,
          denominator: selected.denominator,
          matchedResponses: selected.matched,
        },
      },
    };
  }
  if (block.kind !== "content" || session.phase !== "content")
    fail("Present the slide before using its interaction.");
  const node = block.scene?.nodes.find((candidate) => candidate.id === command.nodeId);
  if (!node) fail("Choose an interaction in the published slide.");
  if (command.action === "navigate_scene") {
    if (node.type !== "navigation" || !node.targetBlockId)
      fail("This object is not an internal navigation control.");
    return presentationNavigationTransition(session, {
      ...command,
      action: "jump_to_block",
      targetBlockId: node.targetBlockId,
    });
  }
  if (node.type !== "reveal" || node.scope !== "broadcast")
    fail("This object is not a presenter-controlled reveal.");
  const reveals = structuredClone(session.interactionState?.reveals ?? []);
  const index = reveals.findIndex(
    (entry) => sameId(entry.blockId, block.id) && entry.nodeId === node.id,
  );
  if (Boolean(reveals[index]?.revealed) === command.revealed)
    throw new PresentationSessionServiceError(
      422,
      "VALIDATION_ERROR",
      "This reveal already has the requested state.",
    );
  const value = { blockId: block.id, nodeId: node.id, revealed: command.revealed };
  if (index < 0) reveals.push(value);
  else reveals[index] = value;
  return {
    status: session.status,
    currentBlockIndex: session.currentBlockIndex,
    phase: session.phase,
    interactionState: { reveals },
    event: {
      type: "scene.reveal_changed",
      blockId: block.id,
      blockIndex: session.currentBlockIndex,
      interaction: value,
    },
  };
}
