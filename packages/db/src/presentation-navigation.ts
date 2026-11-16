import {
  PresentationNavigationStateSchema,
  PresentationNavigationEventSchema,
  type PresentationContent,
  type PresentationNavigationState,
  type PresentationNavigationBlockState,
} from "@openround/contracts";
import type {
  PresentationSessionRecord,
  PresentationSessionTransitionInput,
} from "./presentation-session-types.js";

const sameId = (a: string | null, b: string | null) => a?.toLowerCase() === b?.toLowerCase();
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const navigationEvents = new Set([
  "navigation.jumped",
  "navigation.returned",
  "navigation.revisited",
  "navigation.branched",
]);

/** Validate references against this exact frozen document; UUID spelling is retained. */
export function validatePresentationNavigationState(
  content: PresentationContent,
  value: unknown,
): PresentationNavigationState {
  if (content.schemaVersion < 12)
    throw new Error("Navigation requires Presentation schema version 12");
  const state = PresentationNavigationStateSchema.parse(value);
  if (
    state.returnBlockId !== null &&
    !content.blocks.some((block) => sameId(block.id, state.returnBlockId))
  )
    throw new Error("Navigation return target must belong to the frozen presentation");
  for (const progress of state.blocks) {
    const block = content.blocks.find((block) => sameId(block.id, progress.blockId));
    if (
      !block ||
      (block.kind === "content") !== (progress.phase === "content") ||
      (block.kind === "question" && progress.questionOpenedAt === null)
    )
      throw new Error("Navigation progress must match a visited frozen block");
    if (
      progress.recoveryPackIntervention != null &&
      !content.recoveryPackInsertions?.some((insertion) => {
        const baseline = insertion.updateBaseline ?? {
          packVersionId: insertion.packVersionId,
          packVersion: insertion.packVersion,
          contentHash: insertion.contentHash,
          content: insertion.originalContent,
        };
        const reference = progress.recoveryPackIntervention!.reference;
        return (
          insertion.id === reference.insertionId &&
          insertion.packId === reference.packId &&
          baseline.packVersionId === reference.packVersionId &&
          baseline.packVersion === reference.packVersion &&
          baseline.contentHash === reference.contentHash &&
          insertion.diagnosticQuestionId ===
            (block.kind === "question" ? block.question.id : null) &&
          baseline.content.interventions.some((card) => card.id === reference.cardId)
        );
      })
    )
      throw new Error("Navigation intervention must match the frozen diagnostic card");
  }
  return state;
}

/** Derive monotonic progress inside the same aggregate fence as phase, timeline and receipt. */
export function transitionPresentationNavigationState(
  session: PresentationSessionRecord,
  input: PresentationSessionTransitionInput,
  content: PresentationContent,
  window: { questionOpenedAt: Date | null; questionClosesAt: Date | null },
): PresentationNavigationState | undefined {
  const isNavigation = navigationEvents.has(input.event.type);
  if (content.schemaVersion < 12) {
    if (
      session.navigationState !== undefined ||
      input.navigationState !== undefined ||
      isNavigation ||
      input.event.navigation != null
    )
      throw new Error("Navigation requires Presentation schema version 12");
    return undefined;
  }
  const previous = validatePresentationNavigationState(
    content,
    session.navigationState ?? { returnBlockId: null, blocks: [] },
  );
  const requested =
    input.navigationState === undefined
      ? previous
      : validatePresentationNavigationState(content, input.navigationState);
  if (!equal(requested.blocks, previous.blocks))
    throw new Error("Navigation progress is derived from accepted transitions");
  if (!isNavigation && !sameId(requested.returnBlockId, previous.returnBlockId))
    throw new Error("Only navigation commands may change the return target");
  const target = content.blocks[input.currentBlockIndex];
  const current = session.content.blocks[session.currentBlockIndex];
  const prior = target && previous.blocks.find((block) => sameId(block.blockId, target.id));
  const closed = (id: string) =>
    previous.blocks.some(
      (progress) =>
        sameId(progress.blockId, id) &&
        ["question_reveal", "intervention"].includes(progress.phase),
    );
  const sources = content.blocks.filter(
    (block) => block.kind === "question" && block.question.linkedRecheckQuestionId,
  );
  if (
    target?.kind === "question" &&
    target.question.delivery === "recheck" &&
    !sources.some(
      (source) =>
        source.kind === "question" &&
        sameId(source.question.linkedRecheckQuestionId ?? null, target.question.id) &&
        closed(source.id),
    )
  )
    throw new Error("A recheck requires its closed linked diagnostic");
  if (
    ["navigation.jumped", "navigation.returned", "navigation.branched"].includes(input.event.type)
  ) {
    if (
      target?.kind === "question" &&
      target.question.delivery === "recheck" &&
      !(
        input.event.type === "navigation.returned" &&
        prior &&
        ["question_reveal", "intervention"].includes(prior.phase) &&
        sameId(previous.returnBlockId, target.id)
      )
    )
      throw new Error("Navigate through the linked diagnostic before its recheck");
    for (const source of sources) {
      if (source.kind !== "question") continue;
      const recheckIndex = content.blocks.findIndex(
        (candidate) =>
          candidate.kind === "question" &&
          sameId(candidate.question.id, source.question.linkedRecheckQuestionId ?? null),
      );
      const sourceIndex = content.blocks.indexOf(source);
      const recheck = content.blocks[recheckIndex];
      if (
        (closed(source.id) && recheck && !closed(recheck.id)) ||
        (sourceIndex < input.currentBlockIndex &&
          input.currentBlockIndex <= recheckIndex &&
          !closed(source.id))
      )
        throw new Error("Complete the linked diagnostic and recheck path before navigating away");
    }
  }

  if (
    session.phase === "question_open" &&
    (input.currentBlockIndex !== session.currentBlockIndex || input.phase !== "question_reveal")
  )
    throw new Error("Reveal the open question before leaving it");
  if (isNavigation) {
    if (
      !target ||
      input.status !== "active" ||
      session.phase === "question_open" ||
      session.status !== "active"
    )
      throw new Error("Navigation requires an active closed boundary");
    const metadata = PresentationNavigationEventSchema.parse(input.event.navigation);
    if (
      !sameId(metadata.fromBlockId, current?.id ?? null) ||
      !sameId(metadata.toBlockId, target.id) ||
      !sameId(metadata.returnBlockId, requested.returnBlockId) ||
      metadata.restored !== Boolean(prior)
    )
      throw new Error("Navigation event must describe the accepted transition");
    if (
      input.event.type === "navigation.returned" &&
      (previous.returnBlockId === null ||
        !sameId(previous.returnBlockId, target.id) ||
        requested.returnBlockId !== null)
    )
      throw new Error("Return must restore and clear the original path anchor");
    if (
      input.event.type === "navigation.revisited" &&
      (!prior || !sameId(requested.returnBlockId, previous.returnBlockId))
    )
      throw new Error("A revisit must restore existing progress without changing the anchor");
    if (input.event.type === "navigation.jumped" || input.event.type === "navigation.branched") {
      const original = previous.returnBlockId ?? current?.id ?? content.blocks[0]?.id ?? null;
      if (!(
        sameId(requested.returnBlockId, original) ||
        (sameId(target.id, original) && requested.returnBlockId === null)
      ))
        throw new Error("A detour must retain its original return target");
    }
  } else if (input.event.navigation != null)
    throw new Error("Navigation metadata requires a navigation event");
  const blocks = structuredClone(previous.blocks);
  if (target && input.phase !== "lobby" && input.phase !== "finished") {
    if ((target.kind === "content") !== (input.phase === "content"))
      throw new Error("Navigation phase must match the frozen block");
    if (prior && prior.phase !== "question_open" && input.phase === "question_open")
      throw new Error("A visited question cannot reopen");
    if (!prior && target.kind === "question" && input.phase !== "question_open")
      throw new Error("An unvisited question must begin with its original open attempt");
    if (prior && input.event.type === "question.launched")
      throw new Error("A visited question cannot launch again");
    if (
      input.event.type === "question.revealed" &&
      (!prior ||
        prior.phase !== "question_open" ||
        session.phase !== "question_open" ||
        !sameId(current?.id ?? null, target.id))
    )
      throw new Error("A question may reveal only once from its original open attempt");
    const rank = { content: 0, question_open: 0, question_reveal: 1, intervention: 2 };
    if (prior && rank[input.phase] < rank[prior.phase])
      throw new Error("Navigation progress cannot move backwards");
    if (
      isNavigation &&
      prior &&
      (input.phase !== prior.phase ||
        !equal(input.recoveryPackIntervention ?? null, prior.recoveryPackIntervention ?? null))
    )
      throw new Error("A revisit must restore its saved phase and intervention");
    const progress: PresentationNavigationBlockState = {
      blockId: target.id,
      phase: input.phase,
      questionOpenedAt:
        prior?.questionOpenedAt ??
        (target.kind === "question"
          ? ((window.questionOpenedAt ?? session.questionOpenedAt)?.toISOString() ?? null)
          : null),
      questionClosesAt: prior
        ? prior.questionClosesAt
        : target.kind === "question"
          ? ((window.questionClosesAt ?? session.questionClosesAt)?.toISOString() ?? null)
          : null,
      ...(input.phase === "intervention"
        ? { recoveryPackIntervention: input.recoveryPackIntervention ?? null }
        : {}),
    };
    if (
      input.phase === "question_open" &&
      prior &&
      (!equal(progress.questionOpenedAt, window.questionOpenedAt?.toISOString() ?? null) ||
        !equal(progress.questionClosesAt, window.questionClosesAt?.toISOString() ?? null))
    )
      throw new Error("An accepted question window cannot restart");
    const index = blocks.findIndex((block) => sameId(block.blockId, target.id));
    if (index === -1) blocks.push(progress);
    else blocks[index] = progress;
  }
  return validatePresentationNavigationState(content, {
    returnBlockId: requested.returnBlockId,
    blocks,
  });
}
