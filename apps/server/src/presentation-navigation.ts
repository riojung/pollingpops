import {
  presentationSceneTitle,
  type PresentationBlock,
  type PresentationControlCommand,
  type PresentationHostSnapshot,
} from "@openround/contracts";
import type { PresentationSessionRecord, PresentationSessionTransitionInput } from "@openround/db";
import { PresentationSessionServiceError } from "./presentation-session-errors.js";

type Progress = NonNullable<PresentationSessionRecord["navigationState"]>["blocks"][number];
type Transition = Omit<
  PresentationSessionTransitionInput,
  "workspaceId" | "sessionId" | "expectedRevision"
>;
const key = (id: string) => id.toLowerCase();
const closed = (progress: Progress | undefined) =>
  progress?.phase === "question_reveal" || progress?.phase === "intervention";

export function presentationNavigationBlockTitle(block: PresentationBlock, index: number) {
  const title =
    block.kind === "question"
      ? block.question.prompt
      : block.scene
        ? presentationSceneTitle(block.scene)
        : (block.textElements.find((element) => element.role === "title")?.text ?? "");
  return (
    title.trim().slice(0, 160) || `${block.kind === "content" ? "Slide" : "Activity"} ${index + 1}`
  );
}

function context(session: PresentationSessionRecord) {
  const progress = new Map(
    (session.navigationState?.blocks ?? []).map((entry) => [key(entry.blockId), entry]),
  );
  const questionIndex = new Map(
    session.content.blocks.flatMap((block, index) =>
      block.kind === "question" ? [[key(block.question.id), index] as const] : [],
    ),
  );
  const pairs = session.content.blocks.flatMap((block, sourceIndex) => {
    if (block.kind !== "question" || !block.question.linkedRecheckQuestionId) return [];
    const recheckIndex = questionIndex.get(key(block.question.linkedRecheckQuestionId));
    if (recheckIndex === undefined) return [];
    const recheck = session.content.blocks[recheckIndex]!;
    return [
      {
        sourceIndex,
        recheckIndex,
        started: progress.has(key(block.id)),
        completed: closed(progress.get(key(recheck.id))),
      },
    ];
  });
  return { progress, pairs };
}

export function presentationNavigationBlockedReason(session: PresentationSessionRecord) {
  if (session.content.schemaVersion < 12)
    return "Enable sections and navigation in the presentation before publishing.";
  if (session.status !== "active" || session.phase === "finished")
    return "This presentation has finished. Start a new session to present it again.";
  if (session.phase === "question_open")
    return "Close and reveal the current activity before navigating.";
  if (context(session).pairs.some((pair) => pair.started && !pair.completed))
    return "Complete the linked recheck before navigating.";
  return null;
}

function targetBlockedReason(
  session: PresentationSessionRecord,
  index: number,
  pairs: ReturnType<typeof context>["pairs"],
) {
  const block = session.content.blocks[index];
  if (!block) return "Choose a block in this session's published presentation.";
  if (block.kind === "question" && block.question.delivery === "recheck")
    return "Present this recheck through its linked diagnostic and intervention.";
  if (
    pairs.some((pair) => !pair.completed && index > pair.sourceIndex && index < pair.recheckIndex)
  )
    return "Start the linked diagnostic before entering this recovery sequence.";
  return null;
}

/** Private control map built only from this session's frozen public content, never author notes. */
export function presentationNavigationSnapshot(
  session: PresentationSessionRecord,
): PresentationHostSnapshot["navigation"] {
  if (session.content.schemaVersion < 12) return undefined;
  const { progress, pairs } = context(session);
  const blockedReason = presentationNavigationBlockedReason(session);
  const sectionByBlock = new Map(
    (session.content.sections ?? []).flatMap((section) =>
      section.blockIds.map((blockId) => [key(blockId), section] as const),
    ),
  );
  const returnIndex = session.navigationState?.returnBlockId
    ? session.content.blocks.findIndex(
        (block) => key(block.id) === key(session.navigationState!.returnBlockId!),
      )
    : -1;
  const returnBlock = session.content.blocks[returnIndex];
  return {
    entries: session.content.blocks.map((block, index) => {
      const visited = progress.get(key(block.id));
      const section = sectionByBlock.get(key(block.id));
      const current = index === session.currentBlockIndex && session.phase !== "lobby";
      const reason =
        blockedReason ??
        (current ? "You are on this block." : targetBlockedReason(session, index, pairs));
      return {
        blockId: block.id,
        title: presentationNavigationBlockTitle(block, index),
        kind: block.kind,
        sectionId: section?.id ?? null,
        sectionTitle: section?.title ?? null,
        status: current ? "current" : visited ? "visited" : "not_visited",
        phase: visited?.phase ?? null,
        canJump: reason === null,
        blockedReason: reason,
      };
    }),
    returnTarget: returnBlock
      ? {
          blockId: returnBlock.id,
          title: presentationNavigationBlockTitle(returnBlock, returnIndex),
        }
      : null,
    canReturn: Boolean(returnBlock) && blockedReason === null,
    blockedReason,
  };
}

/** A single durable anchor retains the original path across multiple detour jumps. */
export function presentationNavigationTransition(
  session: PresentationSessionRecord,
  command: Extract<PresentationControlCommand, { action: "jump_to_block" | "return_to_path" }>,
): Transition {
  const reason = presentationNavigationBlockedReason(session);
  if (reason) throw new PresentationSessionServiceError(409, "PHASE_CLOSED", reason);
  const current = session.content.blocks[session.currentBlockIndex];
  const state = session.navigationState ?? { returnBlockId: null, blocks: [] };
  const targetId =
    command.action === "return_to_path" ? state.returnBlockId : command.targetBlockId;
  const index = targetId
    ? session.content.blocks.findIndex((block) => key(block.id) === key(targetId))
    : -1;
  const target = session.content.blocks[index];
  if (!target)
    throw new PresentationSessionServiceError(
      422,
      "VALIDATION_ERROR",
      "Choose a valid navigation target in this session.",
    );
  const { progress, pairs } = context(session);
  const prior = progress.get(key(target.id));
  const returningToClosedRecheck =
    command.action === "return_to_path" &&
    target.kind === "question" &&
    target.question.delivery === "recheck" &&
    closed(prior);
  const targetReason = returningToClosedRecheck ? null : targetBlockedReason(session, index, pairs);
  if (targetReason) throw new PresentationSessionServiceError(409, "PHASE_CLOSED", targetReason);
  if (command.action === "jump_to_block" && current && key(current.id) === key(target.id))
    throw new PresentationSessionServiceError(
      422,
      "VALIDATION_ERROR",
      "You are already presenting this block.",
    );
  if (prior?.phase === "question_open")
    throw new PresentationSessionServiceError(
      409,
      "PHASE_CLOSED",
      "Close the existing activity before returning to it.",
    );
  const anchor = state.returnBlockId ?? current?.id ?? session.content.blocks[0]!.id;
  const returnBlockId =
    command.action === "return_to_path" || key(target.id) === key(anchor) ? null : anchor;
  const phase = prior?.phase ?? (target.kind === "content" ? "content" : "question_open");
  return {
    currentBlockIndex: index,
    status: "active",
    phase,
    recoveryPackIntervention:
      phase === "intervention" ? (prior?.recoveryPackIntervention ?? null) : null,
    navigationState: { ...structuredClone(state), returnBlockId },
    event: {
      type: command.action === "return_to_path" ? "navigation.returned" : "navigation.jumped",
      blockId: target.id,
      blockIndex: index,
      navigation: {
        fromBlockId: current?.id ?? null,
        toBlockId: target.id,
        returnBlockId,
        restored: Boolean(prior),
      },
    },
  };
}

/** Linear Next follows the authored order while restoring previously visited closed activities. */
export function restorePresentationNavigationTarget(
  session: PresentationSessionRecord,
  transition: Transition,
): Transition {
  if (session.content.schemaVersion < 12 || transition.status === "finished") return transition;
  const target = (transition.content ?? session.content).blocks[transition.currentBlockIndex];
  const current = session.content.blocks[session.currentBlockIndex];
  if (!target || (current && key(current.id) === key(target.id))) return transition;
  const { progress } = context(session);
  const prior = progress.get(key(target.id));
  if (!prior) {
    if (target.kind === "question" && target.question.delivery === "recheck") {
      const source = session.content.blocks.find(
        (block) =>
          block.kind === "question" &&
          block.question.linkedRecheckQuestionId &&
          key(block.question.linkedRecheckQuestionId) === key(target.question.id),
      );
      if (!source || !closed(progress.get(key(source.id))))
        throw new PresentationSessionServiceError(
          409,
          "PHASE_CLOSED",
          "Present the diagnostic and intervention before its recheck.",
        );
    }
    return transition;
  }
  if (prior.phase === "question_open")
    throw new PresentationSessionServiceError(
      409,
      "PHASE_CLOSED",
      "An existing response window cannot be reopened.",
    );
  return {
    ...transition,
    phase: prior.phase,
    questionOpenedAt: null,
    questionClosesAt: null,
    recoveryPackIntervention:
      prior.phase === "intervention" ? (prior.recoveryPackIntervention ?? null) : null,
    event: {
      type: "navigation.revisited",
      blockId: target.id,
      blockIndex: transition.currentBlockIndex,
      navigation: {
        fromBlockId: current?.id ?? null,
        toBlockId: target.id,
        returnBlockId: session.navigationState?.returnBlockId ?? null,
        restored: true,
      },
    },
  };
}
