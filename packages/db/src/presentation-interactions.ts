import {
  PresentationInteractionStateSchema,
  PresentationInteractionEventSchema,
  PresentationBranchEventSchema,
  type PresentationContent,
  type PresentationInteractionState,
} from "@openround/contracts";
import type {
  PresentationSessionRecord,
  PresentationSessionTransitionInput,
  PresentationSessionResponseRecord,
} from "./presentation-session-types.js";
const sameId = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export function validatePresentationInteractionState(
  content: PresentationContent,
  value: unknown,
): PresentationInteractionState {
  if (content.schemaVersion < 13)
    throw new Error("Shared interactions require Presentation schema version 13");
  const state = PresentationInteractionStateSchema.parse(value);
  for (const entry of state.reveals) {
    const block = content.blocks.find((block) => sameId(block.id, entry.blockId));
    const node =
      block?.kind === "content"
        ? block.scene?.nodes.find((node) => node.id === entry.nodeId)
        : undefined;
    if (node?.type !== "reveal" || node.scope !== "broadcast")
      throw new Error("Shared reveal state must reference a frozen broadcast node");
  }
  return state;
}

/** Runs under the session row lock, alongside the phase, original attempt and receipt fence. */
export function transitionPresentationInteractionState(
  session: PresentationSessionRecord,
  input: PresentationSessionTransitionInput,
  content: PresentationContent,
  responses: readonly PresentationSessionResponseRecord[] = [],
): PresentationInteractionState | undefined {
  if (content.schemaVersion < 13) {
    if (
      input.interactionState !== undefined ||
      input.event.interaction != null ||
      input.event.branch != null ||
      ["scene.reveal_changed", "navigation.branched"].includes(input.event.type)
    )
      throw new Error("Shared interactions require Presentation schema version 13");
    return undefined;
  }
  const previous = validatePresentationInteractionState(
    content,
    session.interactionState ?? { reveals: [] },
  );
  if (input.event.type === "navigation.branched") {
    const metadata = PresentationBranchEventSchema.parse(input.event.branch);
    const source = session.content.blocks[session.currentBlockIndex];
    const target = content.blocks[input.currentBlockIndex];
    const branch =
      source?.kind === "question"
        ? source.branches?.find((branch) => sameId(branch.id, metadata.branchId))
        : undefined;
    if (
      session.status !== "active" ||
      session.phase !== "question_reveal" ||
      !source ||
      source.kind !== "question" ||
      !target ||
      !branch?.targetBlockId ||
      !sameId(source.id, metadata.sourceBlockId) ||
      !sameId(target.id, metadata.targetBlockId) ||
      !sameId(branch.targetBlockId, target.id)
    )
      throw new Error("A branch requires its revealed frozen source and matching target");
    const accepted = responses.filter((response) => sameId(response.blockId, source.id));
    const denominator =
      branch.condition.kind === "correct_share"
        ? accepted.filter((response) => response.correct !== null)
        : accepted;
    const condition = branch.condition;
    const matched = denominator.filter((response) =>
      condition.kind === "correct_share"
        ? response.correct === true
        : response.response.choiceIds?.some((id) => sameId(id, condition.choiceId)),
    ).length;
    if (
      metadata.denominator !== denominator.length ||
      metadata.matchedResponses !== matched ||
      denominator.length < condition.minResponses ||
      matched * 100 < denominator.length * condition.minPercent
    )
      throw new Error("Accepted responses do not meet this frozen branch condition");
  } else if (input.event.branch != null)
    throw new Error("Branch metadata requires a branch transition");
  if (input.event.type !== "scene.reveal_changed") {
    if (
      input.event.interaction != null ||
      (input.interactionState !== undefined &&
        !equal(validatePresentationInteractionState(content, input.interactionState), previous))
    )
      throw new Error("Only reveal commands may change shared reveal state");
    return previous;
  }
  const event = PresentationInteractionEventSchema.parse(input.event.interaction);
  const current = content.blocks[session.currentBlockIndex];
  if (
    session.status !== "active" ||
    session.phase !== "content" ||
    input.status !== session.status ||
    input.phase !== session.phase ||
    input.currentBlockIndex !== session.currentBlockIndex ||
    current?.kind !== "content" ||
    !sameId(event.blockId, current.id) ||
    !sameId(input.event.blockId ?? "", current.id)
  )
    throw new Error("Broadcast reveals require the current active content block");
  const next = structuredClone(previous);
  const index = next.reveals.findIndex(
    (entry) => sameId(entry.blockId, current.id) && entry.nodeId === event.nodeId,
  );
  if (Boolean(next.reveals[index]?.revealed) === event.revealed)
    throw new Error("The reveal already has the requested state");
  const entry = { blockId: current.id, nodeId: event.nodeId, revealed: event.revealed };
  if (index < 0) next.reveals.push(entry);
  else next.reveals[index] = entry;
  validatePresentationInteractionState(content, next);
  if (
    input.interactionState === undefined ||
    !equal(validatePresentationInteractionState(content, input.interactionState), next)
  )
    throw new Error("A reveal command must change exactly its frozen node state");
  return next;
}
