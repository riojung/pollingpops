import {
  ContentSlideDraftSchema,
  SupportedLocaleSchema,
  type SupportedLocale,
  InteractiveQuestionBlockDraftSchema,
  PRESENTATION_NATIVE_DOCUMENT_MAX_BYTES,
  PresentationDraftSchema,
  presentationSourceFingerprintDigest,
  presentationQuestionSuggestionSource,
  type InteractiveQuestionBlockDraft,
  type PresentationBlockDraft,
  type PresentationDraft,
  type PresentationTextLanguage,
} from "@openround/contracts";
import { questionStarterContent } from "./i18n/question-starter-content";
import { questionStartersCopy } from "./i18n/question-starters-copy";
import { promotePresentationOpinionFormats } from "./presentation-builder";
import { reconcilePresentationSpatialBlocks } from "./presentation-spatial-authoring";

export type PresentationQuestionStarterKind = "discussion" | "clarity" | "priority";
export interface PresentationQuestionStarterSourceText {
  nodeId: string;
  text: string;
  lang: PresentationTextLanguage | null;
}
export interface PresentationQuestionStarterSourceBody extends PresentationQuestionStarterSourceText {
  paragraphs: { kind: "paragraph" | "bullet" | "numbered"; text: string }[];
}
export interface PresentationQuestionStarterSource {
  blockId: string;
  title: PresentationQuestionStarterSourceText;
  body: PresentationQuestionStarterSourceBody[];
  readingOrder: string[];
  fingerprint: string;
  sourceDigest: string;
}
export interface PresentationQuestionStarter {
  id: PresentationQuestionStarterKind;
  creationLocale?: SupportedLocale;
  label: string;
  description: string;
  type: "open_text" | "rating" | "poll";
  prompt: string;
  choices?: string[];
  rating?: { min: 1; max: 5; minLabel: string; maxLabel: string };
  source: PresentationQuestionStarterSource;
}
export interface PresentationQuestionStarterIds {
  blockId: string;
  questionId: string;
  choiceIds?: string[];
}
export type PresentationQuestionStarterInsertion =
  { ok: true; draft: PresentationDraft; blockId: string } | { ok: false; reason: string };

const unsupported = "Choose a visible native slide with a nonblank title and body text.";
const stale =
  "The source or starter changed. Open question starters again to review the current wording.";

function sourceFor(
  block: PresentationBlockDraft,
):
  | { supported: true; source: PresentationQuestionStarterSource }
  | { supported: false; reason: string } {
  if (block.kind !== "content" || block.hidden || !block.scene) {
    return { supported: false, reason: unsupported };
  }
  if (!ContentSlideDraftSchema.safeParse(block).success) {
    return {
      supported: false,
      reason: "Resolve the slide's invalid content before using question starters.",
    };
  }
  const shared = presentationQuestionSuggestionSource(block);
  if (!shared.supported)
    return {
      supported: false,
      reason: shared.reason.replaceAll("question suggestions", "question starters"),
    };
  const projection = shared.source;
  const fingerprint = JSON.stringify(projection);
  return {
    supported: true,
    source: {
      ...projection,
      fingerprint,
      sourceDigest: presentationSourceFingerprintDigest(fingerprint),
    },
  };
}

export function presentationQuestionStarterAvailability(block: PresentationBlockDraft): {
  supported: boolean;
  reason: string | null;
} {
  const result = sourceFor(block);
  return result.supported
    ? { supported: true, reason: null }
    : { supported: false, reason: result.reason };
}

/** Every authored point is included, or the poll is unavailable. No sentence inference or shortening. */
function priorityChoices(source: PresentationQuestionStarterSource): string[] | null {
  const points = source.body.flatMap((body) => body.paragraphs.map((paragraph) => paragraph.text));
  const choices = points.filter((point) => point.trim().length > 0);
  if (
    choices.length < 2 ||
    choices.length > 6 ||
    choices.some((choice) => choice.length > 180 || choice !== choice.trim())
  )
    return null;
  const normalized = choices.map((choice) =>
    choice.normalize("NFKC").replace(/\s+/gu, " ").toLowerCase(),
  );
  return new Set(normalized).size === choices.length ? choices : null;
}

/** Local templates quote authored text; they do not infer facts, comprehension or correctness. */
export function createPresentationQuestionStarters(
  block: PresentationBlockDraft,
  locale: SupportedLocale = "en-CA",
): PresentationQuestionStarter[] {
  const result = sourceFor(block);
  if (!result.supported) return [];
  const source = result.source;
  const content = questionStarterContent(locale, source.title.text);
  const copy = questionStartersCopy(locale);
  const creation = locale === "en-CA" ? {} : { creationLocale: locale };
  const starters: PresentationQuestionStarter[] = [
    {
      ...creation,
      id: "discussion",
      label: copy("Discussion"),
      description: copy("Invite questions and comments about the authored slide title."),
      type: "open_text",
      prompt: content.discussion,
      source,
    },
    {
      ...creation,
      id: "clarity",
      label: copy("Clarity rating"),
      description: copy("Ask for a subjective clarity rating, not a scored understanding check."),
      type: "rating",
      prompt: content.clarity,
      rating: { min: 1, max: 5, minLabel: content.minLabel, maxLabel: content.maxLabel },
      source,
    },
  ];
  const choices = priorityChoices(source);
  if (choices)
    starters.push({
      ...creation,
      id: "priority",
      label: copy("Priority poll"),
      description: copy("Use every authored body point as an option for what to discuss next."),
      type: "poll",
      prompt: content.priority,
      choices,
      source,
    });
  return starters;
}

/** Exact excerpts use the existing private citation bounds, with no omitted source wording. */
function sourceCitations(source: PresentationQuestionStarterSource) {
  return [source.title, ...source.body].flatMap((node, index) => {
    const excerpts: { locator: string; excerpt: string }[] = [];
    let remaining = node.text;
    while (remaining.length) {
      let length = Math.min(500, remaining.length);
      if (length < remaining.length && /[\uD800-\uDBFF]/u.test(remaining[length - 1]!)) length--;
      const excerpt = remaining.slice(0, length);
      remaining = remaining.slice(length);
      if (excerpt.trim())
        excerpts.push({
          locator: `${index === 0 ? "Title" : `Body ${index}`} · part ${excerpts.length + 1}`,
          excerpt,
        });
    }
    return excerpts;
  });
}

function starterIdentity(starter: PresentationQuestionStarter): string {
  return JSON.stringify([
    starter.id,
    starter.creationLocale ?? "en-CA",
    starter.label,
    starter.description,
    starter.type,
    starter.prompt,
    starter.choices ?? null,
    starter.rating
      ? [starter.rating.min, starter.rating.max, starter.rating.minLabel, starter.rating.maxLabel]
      : null,
    starter.source,
  ]);
}

/** Prepare IDs once before the normal builder commit; retries never silently select another source. */
export function insertPresentationQuestionStarter(
  draft: PresentationDraft,
  starter: PresentationQuestionStarter,
  ids: PresentationQuestionStarterIds,
): PresentationQuestionStarterInsertion {
  const sourceIndex = draft.blocks.findIndex(
    (block) => block.id.toLowerCase() === starter.source.blockId.toLowerCase(),
  );
  const source = draft.blocks[sourceIndex];
  if (!source) return { ok: false, reason: stale };
  const locale = SupportedLocaleSchema.safeParse(starter.creationLocale ?? "en-CA");
  if (!locale.success) return { ok: false, reason: stale };
  const current = createPresentationQuestionStarters(source, locale.data).find(
    (candidate) => candidate.id === starter.id,
  );
  if (!current || starterIdentity(current) !== starterIdentity(starter))
    return { ok: false, reason: stale };
  if (draft.blocks.length >= 200)
    return { ok: false, reason: "A presentation supports at most 200 slides and activities." };
  const blockId = ids.blockId.toLowerCase(),
    questionId = ids.questionId.toLowerCase();
  const choiceIds = ids.choiceIds?.map((id) => id.toLowerCase()) ?? [];
  if (choiceIds.length !== (starter.choices?.length ?? 0))
    return { ok: false, reason: "Prepare a distinct identity for each answer choice." };
  const requestedIds = [blockId, questionId, ...choiceIds];
  const existingIds = new Set(
    draft.blocks.flatMap((block) => [
      block.id.toLowerCase(),
      ...(block.kind === "question"
        ? [
            block.question.id.toLowerCase(),
            ...("choices" in block.question
              ? block.question.choices.map((choice) => choice.id.toLowerCase())
              : []),
          ]
        : []),
    ]),
  );
  if (
    new Set(requestedIds).size !== requestedIds.length ||
    requestedIds.some((id) => existingIds.has(id))
  ) {
    return {
      ok: false,
      reason: "This question identity is already in use. Open question starters again.",
    };
  }
  const common = {
    id: questionId,
    prompt: starter.prompt,
    purpose: "opinion" as const,
    confidence: "off" as const,
    delivery: "main" as const,
    conceptKeys: [],
    linkedRecheckQuestionId: null,
    timeLimitSeconds: 20,
    basePoints: 0,
    explanation: "",
    mediaId: null,
    mediaAlt: null,
  };
  const question =
    starter.type === "poll"
      ? {
          ...common,
          type: "poll" as const,
          choices: starter.choices!.map((label, index) => ({
            id: choiceIds[index]!,
            label,
            isCorrect: false,
          })),
        }
      : starter.type === "rating"
        ? { ...common, type: "rating" as const, ...starter.rating! }
        : { ...common, type: "open_text" as const };
  const block: InteractiveQuestionBlockDraft = {
    id: blockId,
    kind: "question",
    question,
    citations: sourceCitations(starter.source),
    sourceDisclosure: {
      sourceName: `Slide: ${starter.source.title.text}`,
      sourceDigest: starter.source.sourceDigest,
      provider: "local",
      model: locale.data === "en-CA" ? "question-starters-v1" : "question-starters-v2",
      conversionNotes: [
        `Source slide ${starter.source.blockId}. ${locale.data === "en-CA" ? "Local English template" : `Local template; creation locale: ${locale.data}`}; only authored title/body text is used. Other objects are not interpreted. No AI or independent verification.`,
        ...[starter.source.title, ...starter.source.body].map(
          (node, index) =>
            `${index === 0 ? "Title" : `Body ${index}`} node ${node.nodeId}; language: ${node.lang ?? "unspecified"}.`,
        ),
      ],
    },
  };
  if (!InteractiveQuestionBlockDraftSchema.safeParse(block).success)
    return {
      ok: false,
      reason: "The question or its complete source context exceeds the existing question limits.",
    };
  const blocks = [...draft.blocks];
  blocks.splice(sourceIndex + 1, 0, block);
  const next = reconcilePresentationSpatialBlocks(
    draft,
    promotePresentationOpinionFormats({
      ...draft,
      blocks,
      ...(draft.sections
        ? {
            sections: draft.sections.map((section) => {
              const index = section.blockIds.findIndex(
                (id) => id.toLowerCase() === source.id.toLowerCase(),
              );
              if (index < 0) return section;
              const blockIds = [...section.blockIds];
              blockIds.splice(index + 1, 0, blockId);
              return { ...section, blockIds };
            }),
          }
        : {}),
    }),
  );
  if (
    !PresentationDraftSchema.safeParse(next).success ||
    new TextEncoder().encode(JSON.stringify(next)).length > PRESENTATION_NATIVE_DOCUMENT_MAX_BYTES
  )
    return {
      ok: false,
      reason: "This insertion would exceed the presentation's existing content or activity limits.",
    };
  return { ok: true, draft: next, blockId };
}
