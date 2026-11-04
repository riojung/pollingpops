import {
  PresentationContentSchema,
  PresentationDraftSchema,
  migratePresentationV1,
  clampContentSlideFrame,
  fitContentSlideFrameAroundMedia,
  regionForContentSlideFrame,
  regionContentSlideFrames,
  resolveContentSlideFrames,
  starterContentSlideFrames,
  presentationSceneTitle,
  preparePresentationPublication,
  requiresPresentationOpinionFormats,
  type ContentSlideDraft,
  type ContentSlideFrame,
  type ContentSlideLayout,
  type ContentSlideRegion,
  type ContentSlideTextElement,
  type InteractiveQuestionBlockDraft,
  type PresentationBlockDraft,
  type PresentationDraft,
  type QuestionDraft,
  type QuestionType,
} from "@openround/contracts";
import { clientUuid } from "./uuid";
import { duplicateNativeScene } from "./presentation-native-scene";

export interface PresentationIssue {
  blockId: string | null;
  field: string;
  message: string;
}

export function normalizePresentationRecoveryDraft(value: unknown): PresentationDraft {
  const schemaVersion =
    value && typeof value === "object" && "schemaVersion" in value ? (value.schemaVersion ?? 1) : 1;
  return PresentationDraftSchema.parse(schemaVersion === 1 ? migratePresentationV1(value) : value);
}

function choiceSet(
  type: Extract<QuestionType, "single_select" | "true_false" | "multi_select" | "poll" | "ranking">,
) {
  if (type === "true_false") {
    return [
      { id: clientUuid(), label: "True", isCorrect: true },
      { id: clientUuid(), label: "False", isCorrect: false },
    ];
  }
  return [
    { id: clientUuid(), label: "", isCorrect: type !== "poll" && type !== "ranking" },
    { id: clientUuid(), label: "", isCorrect: false },
    { id: clientUuid(), label: "", isCorrect: false },
    { id: clientUuid(), label: "", isCorrect: false },
  ];
}

export function createPresentationQuestion(type: QuestionType): QuestionDraft {
  if (type === "open_text" || type === "word_cloud")
    throw new Error("Moderated text polls currently support live Rounds only.");
  const opinionOnly = type === "rating" || type === "poll" || type === "ranking";
  const common = {
    id: clientUuid(),
    prompt: "",
    purpose: opinionOnly ? ("opinion" as const) : ("diagnostic" as const),
    confidence: "off" as const,
    delivery: "main" as const,
    conceptKeys: [],
    linkedRecheckQuestionId: null,
    timeLimitSeconds: 20,
    basePoints: opinionOnly ? 0 : 1_000,
    explanation: "",
    mediaId: null,
    mediaAlt: null,
  };
  if (type === "numeric") {
    return { ...common, type, correctValue: "", tolerance: "0", unit: null };
  }
  if (type === "rating") {
    return { ...common, type, min: 1, max: 5, minLabel: "Low", maxLabel: "High" };
  }
  return { ...common, type, choices: choiceSet(type) };
}

/** New formats opt into v9 on write; later edits and history retain the existing v9 floor. */
export function promotePresentationOpinionFormats(
  draft: PresentationDraft,
  currentVersion: PresentationDraft["schemaVersion"] = draft.schemaVersion,
): PresentationDraft {
  if (draft.schemaVersion >= 9) return draft;
  return currentVersion >= 9 || requiresPresentationOpinionFormats(draft)
    ? { ...draft, schemaVersion: 9 }
    : draft;
}

export function createContentBlock(layout: ContentSlideLayout = "title_body"): ContentSlideDraft {
  return {
    id: clientUuid(),
    kind: "content",
    layout,
    textElements: defaultTextElements(layout),
    mediaId: null,
    mediaAlt: null,
    speakerNotes: "",
  };
}

function defaultRegions(layout: ContentSlideLayout) {
  const titleRegion: ContentSlideRegion =
    layout === "title" || layout === "quote" || layout === "section"
      ? "middle_center"
      : layout === "title_body"
        ? "middle_center"
        : "top_center";
  const bodyRegion: ContentSlideRegion =
    layout === "section" || layout === "quote" || layout === "title"
      ? "bottom_center"
      : "middle_center";
  return { titleRegion, bodyRegion };
}

function defaultTextElements(layout: ContentSlideLayout): ContentSlideTextElement[] {
  const { titleRegion, bodyRegion } = defaultRegions(layout);
  const elements: ContentSlideTextElement[] = [
    { id: clientUuid(), role: "title", text: "", region: titleRegion, order: 0 },
    {
      id: clientUuid(),
      role: "body",
      text: "",
      region: bodyRegion,
      order: titleRegion === bodyRegion ? 1 : 0,
    },
  ];
  const frames = starterContentSlideFrames(layout, elements);
  return elements.map((element) => ({ ...element, frame: frames[element.id]! }));
}

function orderedElements(elements: ContentSlideTextElement[]) {
  return [...elements].sort(
    (left, right) => left.order - right.order || left.id.localeCompare(right.id),
  );
}

function normalizeRegionOrders(elements: ContentSlideTextElement[]) {
  const orderById = new Map<string, number>();
  const regions = new Set(elements.map((element) => element.region));
  for (const region of regions) {
    orderedElements(elements.filter((element) => element.region === region)).forEach(
      (element, order) => orderById.set(element.id, order),
    );
  }
  return elements.map((element) => ({ ...element, order: orderById.get(element.id) ?? 0 }));
}

export function createContentTextElement(): ContentSlideTextElement {
  return {
    id: clientUuid(),
    role: "body",
    text: "",
    region: "bottom_center",
    order: 0,
  };
}

function usesStarterFrames(block: ContentSlideDraft) {
  const frames = resolveContentSlideFrames(block);
  const { titleRegion, bodyRegion } = defaultRegions(block.layout);
  const starterFrames = starterContentSlideFrames(
    block.layout,
    block.textElements,
    Boolean(block.mediaId),
  );
  return block.textElements.every((element) => {
    const actual = frames[element.id]!;
    const starter = starterFrames[element.id]!;
    return (
      element.region === (element.role === "title" ? titleRegion : bodyRegion) &&
      actual.x === starter.x &&
      actual.y === starter.y &&
      actual.width === starter.width &&
      actual.height === starter.height
    );
  });
}

/** Attach/remove an image and materialize its text reflow in the same undoable change. */
export function setContentSlideMedia(
  block: ContentSlideDraft,
  mediaId: string | null,
  mediaAlt: string | null,
): ContentSlideDraft {
  const next = { ...block, mediaId, mediaAlt };
  const frames = usesStarterFrames(block)
    ? starterContentSlideFrames(block.layout, block.textElements, Boolean(mediaId))
    : resolveContentSlideFrames(block);
  return {
    ...next,
    textElements: block.textElements.map((element) => ({
      ...element,
      frame: mediaId ? fitContentSlideFrameAroundMedia(frames[element.id]!) : frames[element.id]!,
    })),
  };
}

export function addContentTextElement(
  block: ContentSlideDraft,
  element: ContentSlideTextElement,
): ContentSlideDraft {
  if (block.textElements.length >= 8 || element.role !== "body") return block;
  const frames = resolveContentSlideFrames(block);
  const { bodyRegion } = defaultRegions(block.layout);
  if (usesStarterFrames(block) && !element.frame) {
    const textElements = normalizeRegionOrders([
      ...block.textElements,
      {
        ...element,
        region: bodyRegion,
        order: block.textElements.filter((item) => item.region === bodyRegion).length,
      },
    ]);
    const nextFrames = starterContentSlideFrames(
      block.layout,
      textElements,
      Boolean(block.mediaId),
    );
    return {
      ...block,
      textElements: textElements.map((item) => ({ ...item, frame: nextFrames[item.id]! })),
    };
  }
  const existing = block.textElements.map((item) => ({ ...item, frame: frames[item.id]! }));
  // Prefer an empty part of the slide without changing the author's existing arrangement.
  let frame = clampContentSlideFrame(element.frame ?? { x: 8, y: 2, width: 40, height: 16 });
  if (block.mediaId) frame = fitContentSlideFrameAroundMedia(frame);
  search: for (const [width, height] of [
    [40, 16],
    [24, 12],
    [12, 6],
  ] as const) {
    for (let y = 2; y + height <= (block.mediaId ? 70 : 98); y += 2) {
      for (let x = 2; x + width <= 98; x += 2) {
        const candidate = { x, y, width, height };
        if (
          existing.every(
            ({ frame: other }) =>
              candidate.x + width + 1 <= other.x ||
              other.x + other.width + 1 <= x ||
              candidate.y + height + 1 <= other.y ||
              other.y + other.height + 1 <= y,
          )
        ) {
          frame = candidate;
          break search;
        }
      }
    }
  }
  const region = regionForContentSlideFrame(frame);
  return {
    ...block,
    textElements: normalizeRegionOrders([
      ...existing,
      {
        ...element,
        frame,
        region,
        order: existing.filter((item) => item.region === region).length,
      },
    ]),
  };
}

export function setContentTextElementFrame(
  block: ContentSlideDraft,
  elementId: string,
  requested: ContentSlideFrame,
): ContentSlideDraft {
  const selected = block.textElements.find((element) => element.id === elementId);
  if (!selected) return block;
  const frame = block.mediaId
    ? fitContentSlideFrameAroundMedia(requested)
    : clampContentSlideFrame(requested);
  const frames = resolveContentSlideFrames(block);
  if (JSON.stringify(frames[elementId]) === JSON.stringify(frame)) return block;
  const region = regionForContentSlideFrame(frame);
  return {
    ...block,
    textElements: normalizeRegionOrders(
      block.textElements.map((element) => ({
        ...element,
        frame: element.id === elementId ? frame : frames[element.id]!,
        ...(element.id === elementId
          ? {
              region,
              order:
                region === selected.region
                  ? selected.order
                  : block.textElements.filter((item) => item.region === region).length,
            }
          : {}),
      })),
    ),
  };
}

export function updateContentTextElement(
  block: ContentSlideDraft,
  elementId: string,
  updater: (element: ContentSlideTextElement) => ContentSlideTextElement,
): ContentSlideDraft {
  return {
    ...block,
    textElements: block.textElements.map((element) =>
      element.id === elementId ? updater(element) : element,
    ),
  };
}

export function moveContentTextElement(
  block: ContentSlideDraft,
  elementId: string,
  region: ContentSlideRegion,
): ContentSlideDraft {
  const selected = block.textElements.find((element) => element.id === elementId);
  if (!selected) return block;
  const order =
    selected.region === region
      ? selected.order
      : block.textElements.filter((element) => element.region === region).length;
  const frames = resolveContentSlideFrames(block);
  const elements = normalizeRegionOrders(
    block.textElements.map((element) =>
      element.id === elementId
        ? { ...element, region, order, frame: undefined }
        : { ...element, frame: frames[element.id]! },
    ),
  );
  // Region shortcuts arrange that group in bounded, evenly stacked slots.
  const regionFrames = regionContentSlideFrames(elements, Boolean(block.mediaId));
  return {
    ...block,
    textElements: elements.map((element) => ({
      ...element,
      frame:
        element.region === region
          ? block.mediaId
            ? fitContentSlideFrameAroundMedia(regionFrames[element.id]!)
            : regionFrames[element.id]!
          : element.frame!,
    })),
  };
}

export function reorderContentTextElement(
  block: ContentSlideDraft,
  elementId: string,
  direction: -1 | 1,
): ContentSlideDraft {
  const selected = block.textElements.find((element) => element.id === elementId);
  if (!selected) return block;
  const inRegion = orderedElements(
    block.textElements.filter((element) => element.region === selected.region),
  );
  const index = inRegion.findIndex((element) => element.id === elementId);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= inRegion.length) return block;
  const frames = resolveContentSlideFrames(block);
  const selectedFrame = frames[inRegion[index]!.id]!;
  const targetFrame = frames[inRegion[target]!.id]!;
  const targetId = inRegion[target]!.id;
  [inRegion[index], inRegion[target]] = [inRegion[target]!, inRegion[index]!];
  const order = new Map(inRegion.map((element, itemIndex) => [element.id, itemIndex]));
  return {
    ...block,
    textElements: block.textElements.map((element) => ({
      ...element,
      order: order.get(element.id) ?? element.order,
      frame:
        element.id === elementId
          ? targetFrame
          : element.id === targetId
            ? selectedFrame
            : frames[element.id]!,
    })),
  };
}

export function removeContentTextElement(
  block: ContentSlideDraft,
  elementId: string,
): ContentSlideDraft {
  const selected = block.textElements.find((element) => element.id === elementId);
  if (!selected || selected.role === "title") return block;
  return {
    ...block,
    textElements: normalizeRegionOrders(
      block.textElements.filter((element) => element.id !== elementId),
    ),
  };
}

export function applyContentSlideLayout(
  block: ContentSlideDraft,
  layout: ContentSlideLayout,
): ContentSlideDraft {
  const { titleRegion, bodyRegion } = defaultRegions(layout);
  let bodyOrder = titleRegion === bodyRegion ? 1 : 0;
  const textElements = block.textElements.map((element) => {
    if (element.role === "title")
      return { ...element, frame: undefined, region: titleRegion, order: 0 };
    return { ...element, frame: undefined, region: bodyRegion, order: bodyOrder++ };
  });
  const frames = starterContentSlideFrames(layout, textElements, Boolean(block.mediaId));
  return {
    ...block,
    layout,
    textElements: textElements.map((element) => ({ ...element, frame: frames[element.id]! })),
  };
}

export function contentSlideTitle(block: ContentSlideDraft): string {
  return block.scene
    ? presentationSceneTitle(block.scene)
    : (block.textElements.find((element) => element.role === "title")?.text ?? "");
}

export function createQuestionBlock(
  type: QuestionType = "single_select",
): InteractiveQuestionBlockDraft {
  return { id: clientUuid(), kind: "question", question: createPresentationQuestion(type) };
}

export function changePresentationQuestionType(
  draft: PresentationDraft,
  blockId: string,
  type: QuestionType,
): PresentationDraft {
  const selected = draft.blocks.find(
    (block): block is InteractiveQuestionBlockDraft =>
      block.id === blockId && block.kind === "question",
  );
  if (!selected || selected.question.type === type) return draft;

  const previous = selected.question;
  const opinionOnly = type === "poll" || type === "rating" || type === "ranking";
  const previousOpinionOnly =
    previous.type === "poll" || previous.type === "rating" || previous.type === "ranking";
  const next: QuestionDraft = {
    ...createPresentationQuestion(type),
    id: previous.id,
    prompt: previous.prompt,
    explanation: previous.explanation,
    delivery: opinionOnly ? "main" : previous.delivery,
    conceptKeys: previous.conceptKeys,
    purpose: opinionOnly ? "opinion" : previousOpinionOnly ? "diagnostic" : previous.purpose,
    confidence: opinionOnly ? "off" : previous.confidence,
    linkedRecheckQuestionId: opinionOnly ? null : previous.linkedRecheckQuestionId,
    mediaId: previous.mediaId,
    mediaAlt: previous.mediaAlt,
    sourceCitations: previous.sourceCitations,
    recoveryPackSource: previous.recoveryPackSource,
  };
  if ("choices" in previous && "choices" in next && type !== "true_false") {
    const firstCorrect = Math.max(
      0,
      previous.choices.findIndex((choice) => choice.isCorrect),
    );
    next.choices = previous.choices.map((choice, index) => ({
      ...choice,
      isCorrect: opinionOnly
        ? false
        : type === "multi_select"
          ? choice.isCorrect || (index === 0 && !previous.choices.some((item) => item.isCorrect))
          : index === firstCorrect,
    }));
  }
  return updatePresentationQuestion(draft, blockId, () => next);
}

/** Keep opinion settings and recovery topology valid when a response or limit is edited. */
export function updatePresentationQuestion(
  draft: PresentationDraft,
  blockId: string,
  updater: (question: QuestionDraft) => QuestionDraft,
): PresentationDraft {
  const selected = draft.blocks.find(
    (block): block is InteractiveQuestionBlockDraft =>
      block.id === blockId && block.kind === "question",
  );
  if (!selected) return draft;
  const previous = selected.question;
  const next = updater(previous);
  if (next === previous) return draft;
  const opinionOnly = next.type === "poll" || next.type === "rating" || next.type === "ranking";
  const normalized: QuestionDraft = opinionOnly
    ? {
        ...next,
        purpose: "opinion",
        confidence: "off",
        basePoints: 0,
        delivery: "main",
        linkedRecheckQuestionId: null,
        ...("choices" in next
          ? { choices: next.choices.map((choice) => ({ ...choice, isCorrect: false })) }
          : {}),
      }
    : next;
  const detachedRecheck = opinionOnly && (previous.delivery ?? "main") === "recheck";
  const detachedTargetId = opinionOnly ? previous.linkedRecheckQuestionId : null;
  const detachedTargetHasAnotherSource =
    detachedTargetId !== null && detachedTargetId !== undefined
      ? draft.blocks.some(
          (block) =>
            block.kind === "question" &&
            block.question.id !== previous.id &&
            block.question.linkedRecheckQuestionId === detachedTargetId,
        )
      : false;

  return promotePresentationOpinionFormats({
    ...draft,
    blocks: draft.blocks.map((block) => {
      if (block.id === blockId) return { ...selected, question: normalized };
      if (
        detachedRecheck &&
        block.kind === "question" &&
        block.question.linkedRecheckQuestionId === previous.id
      ) {
        return {
          ...block,
          question: { ...block.question, linkedRecheckQuestionId: null },
        };
      }
      if (
        detachedTargetId &&
        !detachedTargetHasAnotherSource &&
        block.kind === "question" &&
        block.question.id === detachedTargetId
      ) {
        return {
          ...block,
          question: { ...block.question, delivery: "main" },
        };
      }
      return block;
    }),
  });
}

export function movePresentationBlock(
  draft: PresentationDraft,
  blockId: string,
  direction: -1 | 1,
): PresentationDraft {
  const source = draft.blocks.findIndex((block) => block.id === blockId);
  const target = source + direction;
  if (!canMovePresentationBlock(draft, blockId, direction)) return draft;
  const blocks = [...draft.blocks];
  [blocks[source], blocks[target]] = [blocks[target]!, blocks[source]!];
  return { ...draft, blocks };
}

export function canMovePresentationBlock(
  draft: PresentationDraft,
  blockId: string,
  direction: -1 | 1,
): boolean {
  const source = draft.blocks.findIndex((block) => block.id === blockId);
  const target = source + direction;
  if (source < 0 || target < 0 || target >= draft.blocks.length) return false;
  const movedIndex = (index: number) =>
    index === source ? target : index === target ? source : index;
  return draft.blocks.every((block, index) => {
    if (block.kind !== "question" || !block.question.linkedRecheckQuestionId) return true;
    const recheck = draft.blocks.findIndex(
      (candidate) =>
        candidate.kind === "question" &&
        candidate.question.id === block.question.linkedRecheckQuestionId,
    );
    // Keep every currently ordered pair ordered, while allowing repairs of an older invalid draft.
    return recheck <= index || movedIndex(recheck) > movedIndex(index);
  });
}

export function setPresentationSlideHidden(
  draft: PresentationDraft,
  blockId: string,
  hidden: boolean,
): PresentationDraft {
  const selected = draft.blocks.find((block) => block.id === blockId);
  if (selected?.kind !== "content" || Boolean(selected.hidden) === hidden) return draft;
  const { hidden: _hidden, ...visible } = selected;
  void _hidden;
  return {
    ...draft,
    schemaVersion: hidden && draft.schemaVersion < 6 ? 6 : draft.schemaVersion,
    blocks: draft.blocks.map((block) =>
      block.id === blockId ? (hidden ? { ...selected, hidden: true } : visible) : block,
    ),
  };
}

export function removePresentationBlock(
  draft: PresentationDraft,
  blockId: string,
): PresentationDraft {
  const removed = draft.blocks.find((block) => block.id === blockId);
  if (!removed) return draft;
  const removedQuestionId = removed?.kind === "question" ? removed.question.id : null;
  const orphanTarget =
    removed.kind === "question" ? removed.question.linkedRecheckQuestionId : null;
  const targetStillLinked =
    orphanTarget &&
    draft.blocks.some(
      (block) =>
        block.id !== blockId &&
        block.kind === "question" &&
        block.question.linkedRecheckQuestionId === orphanTarget,
    );
  return {
    ...draft,
    blocks: draft.blocks
      .filter((block) => block.id !== blockId)
      .map((block) =>
        orphanTarget &&
        !targetStillLinked &&
        block.kind === "question" &&
        block.question.id === orphanTarget
          ? { ...block, question: { ...block.question, delivery: "main" as const } }
          : removedQuestionId &&
              block.kind === "question" &&
              block.question.linkedRecheckQuestionId === removedQuestionId
            ? {
                ...block,
                question: { ...block.question, linkedRecheckQuestionId: null },
              }
            : block,
      ),
  };
}

export function duplicatePresentationBlock(block: PresentationBlockDraft): PresentationBlockDraft {
  if (block.kind === "content") {
    return {
      ...block,
      id: clientUuid(),
      textElements: block.textElements.map((element) => ({ ...element, id: clientUuid() })),
      ...(block.scene ? { scene: duplicateNativeScene(block.scene) } : {}),
    };
  }
  const choiceIds = new Map<string, string>();
  const question = structuredClone(block.question);
  question.id = clientUuid();
  question.linkedRecheckQuestionId = null;
  question.delivery = "main";
  if ("choices" in question) {
    question.choices = question.choices.map((choice) => {
      const id = clientUuid();
      choiceIds.set(choice.id, id);
      return { ...choice, id };
    });
  }
  return { id: clientUuid(), kind: "question", question };
}

export function presentationReadiness(draft: PresentationDraft): PresentationIssue[] {
  draft = preparePresentationPublication(draft);
  const issues: PresentationIssue[] = [];
  if (!draft.title.trim()) {
    issues.push({ blockId: null, field: "title", message: "Give this presentation a title." });
  }
  if (draft.blocks.length === 0) {
    issues.push({ blockId: null, field: "blocks", message: "Add at least one slide." });
  }
  const questions = new Map(
    draft.blocks.flatMap((block) =>
      block.kind === "question" ? [[block.question.id, block.question] as const] : [],
    ),
  );
  for (const block of draft.blocks) {
    if (block.kind === "content") {
      if (block.scene) continue;
      if (!block.textElements.some((element) => element.text.trim()) && !block.mediaId) {
        issues.push({
          blockId: block.id,
          field: "textElements",
          message: "Add content to this slide.",
        });
      }
      if (block.mediaId && !block.mediaAlt?.trim()) {
        issues.push({
          blockId: block.id,
          field: "mediaAlt",
          message: "Add alternative text for the slide image.",
        });
      }
      continue;
    }

    const question = block.question;
    if (!question.prompt.trim()) {
      issues.push({ blockId: block.id, field: "prompt", message: "Write the question prompt." });
    }
    if ("choices" in question) {
      if (question.choices.some((choice) => !choice.label.trim())) {
        issues.push({
          blockId: block.id,
          field: "choices",
          message: "Complete every answer choice.",
        });
      }
      const correct = question.choices.filter((choice) => choice.isCorrect).length;
      if (question.type !== "poll" && question.type !== "ranking" && correct === 0) {
        issues.push({
          blockId: block.id,
          field: "choices",
          message: "Mark at least one correct answer.",
        });
      }
      if (
        question.type !== "poll" &&
        question.type !== "ranking" &&
        question.type !== "multi_select" &&
        correct > 1
      ) {
        issues.push({
          blockId: block.id,
          field: "choices",
          message: "Mark exactly one correct answer.",
        });
      }
    } else if (question.type === "numeric" && !question.correctValue.trim()) {
      issues.push({
        blockId: block.id,
        field: "correctValue",
        message: "Enter the correct numeric value.",
      });
    }
    if (question.mediaId && !question.mediaAlt?.trim()) {
      issues.push({
        blockId: block.id,
        field: "mediaAlt",
        message: "Add alternative text for the question image.",
      });
    }
    if (question.linkedRecheckQuestionId) {
      const recheck = questions.get(question.linkedRecheckQuestionId);
      if (!recheck || (recheck.delivery ?? "main") !== "recheck") {
        issues.push({
          blockId: block.id,
          field: "linkedRecheckQuestionId",
          message: "Choose a valid recheck question.",
        });
      }
    }
  }
  const strict = PresentationContentSchema.safeParse(draft);
  if (!strict.success) {
    for (const issue of strict.error.issues) {
      const blockIndex = issue.path[0] === "blocks" ? Number(issue.path[1]) : -1;
      const blockId = Number.isInteger(blockIndex) ? (draft.blocks[blockIndex]?.id ?? null) : null;
      const field = [...issue.path].reverse().find((segment) => typeof segment === "string");
      if (
        issues.some(
          (existing) => existing.blockId === blockId && existing.message === issue.message,
        )
      ) {
        continue;
      }
      issues.push({
        blockId,
        field: typeof field === "string" ? field : "artifact",
        message: issue.message,
      });
    }
  }
  return issues;
}
