import { z } from "zod";
import { PresentationSceneDraftSchema } from "./presentation-scene";
import { PresentationTextLanguageSchema } from "./presentation-languages";
import { presentationSourceFingerprintDigest } from "./presentation-source-digest";
import { PresentationAssistanceErrorCodeSchema } from "./presentation-assistance";
import type { InteractiveQuestionBlockDraft, PresentationBlockDraft } from "./index";

export const PRESENTATION_QUESTION_SUGGESTIONS_MAX_ACTIVE_JOBS = 2;
export const PRESENTATION_QUESTION_SUGGESTIONS_MAX_ATTEMPTS = 3;
export const PRESENTATION_QUESTION_SUGGESTIONS_RETENTION_MS = 24 * 60 * 60 * 1_000;
export const PRESENTATION_QUESTION_SUGGESTIONS_REVIEW_WARNING =
  "AI-generated questions are unverified. Exact citations identify source wording and do not verify the suggested framing or claims. Review both questions before inserting one.";
const uuid = z.string().uuid().toLowerCase();
const digest = z.string().regex(/^[a-f0-9]{64}$/);
function hasControlCharacters(value: string, textWhitespace = false): boolean {
  return Array.from(value).some((character) => {
    const code = character.codePointAt(0)!;
    return code === 127 || (code < 32 && !(textWhitespace && [9, 10, 13].includes(code)));
  });
}
function hasUnpairedSurrogates(value: string): boolean {
  return Array.from(value).some((character) => {
    const code = character.codePointAt(0)!;
    return code >= 0xd800 && code <= 0xdfff;
  });
}
const nodeId = z
  .string()
  .min(1)
  .max(200)
  .refine((value) => value.trim().length > 0 && !hasControlCharacters(value));
const visibleText = (maximum: number) =>
  z
    .string()
    .max(maximum)
    .refine((value) => !hasControlCharacters(value, true));
const nonblankText = (maximum: number) =>
  visibleText(maximum).refine((value) => value.trim().length > 0);
const canonicalVisibleText = (maximum: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(maximum)
    .refine((value) => !hasControlCharacters(value, true) && !hasUnpairedSurrogates(value));
const sourceText = {
  nodeId,
  text: nonblankText(4_000),
  lang: PresentationTextLanguageSchema.nullable(),
};

/** Field order is the original PR209 source fingerprint order. No source wording is normalized. */
export const PresentationQuestionSuggestionSourceSchema = z
  .object({
    blockId: uuid,
    title: z.object({ ...sourceText, text: nonblankText(160) }).strict(),
    body: z
      .array(
        z
          .object({
            ...sourceText,
            paragraphs: z
              .array(
                z
                  .object({
                    kind: z.enum(["paragraph", "bullet", "numbered"]),
                    text: visibleText(4_000),
                  })
                  .strict(),
              )
              .min(1)
              .max(4_001),
          })
          .strict(),
      )
      .min(1)
      .max(8),
    readingOrder: z.array(nodeId).min(2).max(50),
  })
  .strict()
  .superRefine((source, context) => {
    if (source.body.reduce((total, body) => total + body.text.length, 0) > 4_000)
      context.addIssue({
        code: "custom",
        path: ["body"],
        message: "Use at most 4,000 body characters",
      });
    const textIds = [source.title.nodeId, ...source.body.map((body) => body.nodeId)];
    if (
      new Set(textIds).size !== textIds.length ||
      new Set(source.readingOrder).size !== source.readingOrder.length ||
      textIds.some((id) => !source.readingOrder.includes(id))
    )
      context.addIssue({
        code: "custom",
        path: ["readingOrder"],
        message: "Bind each source node exactly once in semantic reading order",
      });
    const orderedBodyIds = source.readingOrder.filter((id) =>
      source.body.some((body) => body.nodeId === id),
    );
    if (orderedBodyIds.some((id, index) => source.body[index]?.nodeId !== id))
      context.addIssue({
        code: "custom",
        path: ["body"],
        message: "Keep body objects in semantic reading order",
      });
    for (const [index, body] of source.body.entries()) {
      const plainParagraphs = body.text.split(/\r\n?|\n/u);
      const exactRich = body.paragraphs.map((paragraph) => paragraph.text).join("\n") === body.text;
      const exactPlain =
        body.paragraphs.length === plainParagraphs.length &&
        body.paragraphs.every(
          (paragraph, item) =>
            paragraph.kind === "paragraph" && paragraph.text === plainParagraphs[item],
        );
      if (!exactRich && !exactPlain)
        context.addIssue({
          code: "custom",
          path: ["body", index, "paragraphs"],
          message: "Source paragraphs must preserve the complete exact visible wording",
        });
    }
  });
export type PresentationQuestionSuggestionSource = z.infer<
  typeof PresentationQuestionSuggestionSourceSchema
>;
export type PresentationQuestionSuggestionSourceResult =
  | { supported: true; source: PresentationQuestionSuggestionSource }
  | { supported: false; reason: string };

/** The caller's saved draft is authoritative; only title/body text enters the source projection. */
export function presentationQuestionSuggestionSource(
  block: PresentationBlockDraft,
): PresentationQuestionSuggestionSourceResult {
  const unsupported = "Choose a visible native slide with a nonblank title and body text.";
  if (block.kind !== "content" || block.hidden || !block.scene)
    return { supported: false, reason: unsupported };
  if (
    !PresentationSceneDraftSchema.safeParse(block.scene).success ||
    block.textElements.length ||
    block.mediaId !== null ||
    block.mediaAlt !== null
  )
    return {
      supported: false,
      reason: "Resolve the slide's invalid content before using question suggestions.",
    };
  const scene = block.scene;
  const nodes = scene.readingOrder.flatMap((id) => {
    const node = scene.nodes.find((candidate) => candidate.id === id);
    return node?.type === "text" ? [node] : [];
  });
  const title = nodes.find((node) => node.role === "title"),
    bodies = nodes.filter((node) => node.role === "body");
  if (!title?.text.trim() || !bodies.length || bodies.some((node) => !node.text.trim()))
    return { supported: false, reason: unsupported };
  if (bodies.length > 8 || bodies.reduce((total, node) => total + node.text.length, 0) > 4_000)
    return {
      supported: false,
      reason:
        "Use at most eight body text objects and 4,000 body characters for question suggestions.",
    };
  const text = (node: (typeof nodes)[number]) => ({
    nodeId: node.id,
    text: node.text,
    lang: node.lang ?? null,
  });
  const source = {
    blockId: block.id.toLowerCase(),
    title: text(title),
    body: bodies.map((node) => ({
      ...text(node),
      paragraphs: node.richText
        ? node.richText.paragraphs.map((paragraph) => ({
            kind: paragraph.kind,
            text: paragraph.runs.map((run) => run.text).join(""),
          }))
        : node.text.split(/\r\n?|\n/u).map((text) => ({ kind: "paragraph" as const, text })),
    })),
    readingOrder: [...scene.readingOrder],
  };
  const parsed = PresentationQuestionSuggestionSourceSchema.safeParse(source);
  return parsed.success
    ? { supported: true, source }
    : {
        supported: false,
        reason: "Resolve the slide's invalid source text before using question suggestions.",
      };
}

export function presentationQuestionSuggestionsSourceFingerprint(
  source: PresentationQuestionSuggestionSource,
): string {
  return JSON.stringify(PresentationQuestionSuggestionSourceSchema.parse(source));
}
export function presentationQuestionSuggestionsSourceDigest(
  source: PresentationQuestionSuggestionSource,
): string {
  return presentationSourceFingerprintDigest(
    presentationQuestionSuggestionsSourceFingerprint(source),
  );
}
export function presentationQuestionSuggestionSourceSections(
  source: PresentationQuestionSuggestionSource,
): { locator: string; text: string }[] {
  source = PresentationQuestionSuggestionSourceSchema.parse(source);
  return [
    { locator: "title", text: source.title.text },
    ...source.body.flatMap((body, index) =>
      body.paragraphs.map((paragraph, paragraphIndex) => ({
        locator: `body ${index + 1} paragraph ${paragraphIndex + 1}`,
        text: paragraph.text,
      })),
    ),
  ];
}

export const CreatePresentationQuestionSuggestionsJobSchema = z
  .object({
    schemaVersion: z.literal(1),
    requestId: uuid,
    presentationId: uuid,
    blockId: uuid,
    expectedRevision: z.number().int().nonnegative(),
    sourceDigest: digest,
    outputLanguage: z.literal("en"),
  })
  .strict();
export type CreatePresentationQuestionSuggestionsJob = z.infer<
  typeof CreatePresentationQuestionSuggestionsJobSchema
>;
export const PresentationQuestionSuggestionCitationSchema = z
  .object({
    locator: canonicalVisibleText(120),
    excerpt: canonicalVisibleText(500),
  })
  .strict();
export const PresentationQuestionSuggestionSchema = z
  .object({
    id: uuid,
    kind: z.enum(["discussion", "reflection"]),
    type: z.literal("open_text"),
    prompt: canonicalVisibleText(500),
    citations: z.array(PresentationQuestionSuggestionCitationSchema).min(1).max(4),
  })
  .strict();
export type PresentationQuestionSuggestion = z.infer<typeof PresentationQuestionSuggestionSchema>;
export const PresentationQuestionSuggestionsProposalSchema = z
  .object({
    schemaVersion: z.literal(1),
    blockId: uuid,
    source: PresentationQuestionSuggestionSourceSchema,
    sourceDigest: digest,
    outputLanguage: z.literal("en"),
    suggestions: z.array(PresentationQuestionSuggestionSchema).length(2),
    provider: canonicalVisibleText(80),
    model: canonicalVisibleText(120),
    generatedAt: z.string().datetime(),
    reviewWarning: z.literal(PRESENTATION_QUESTION_SUGGESTIONS_REVIEW_WARNING),
  })
  .strict()
  .superRefine((proposal, context) => {
    if (!PresentationQuestionSuggestionSourceSchema.safeParse(proposal.source).success) return;
    if (
      proposal.blockId !== proposal.source.blockId ||
      proposal.sourceDigest !== presentationQuestionSuggestionsSourceDigest(proposal.source)
    )
      context.addIssue({
        code: "custom",
        path: ["sourceDigest"],
        message: "Bind the exact complete source projection",
      });
    if (
      proposal.suggestions[0]?.kind !== "discussion" ||
      proposal.suggestions[1]?.kind !== "reflection" ||
      new Set(proposal.suggestions.map((suggestion) => suggestion.id)).size !== 2
    )
      context.addIssue({
        code: "custom",
        path: ["suggestions"],
        message:
          "Include one discussion and one reflection suggestion in that order with distinct identities",
      });
    const prompts = proposal.suggestions.map((suggestion) =>
      suggestion.prompt.normalize("NFKC").replace(/\s+/gu, " ").toLowerCase(),
    );
    if (new Set(prompts).size !== 2)
      context.addIssue({
        code: "custom",
        path: ["suggestions"],
        message: "Use two distinct question prompts",
      });
    const sections = new Map(
      presentationQuestionSuggestionSourceSections(proposal.source).map((section) => [
        section.locator,
        section.text,
      ]),
    );
    for (const [index, suggestion] of proposal.suggestions.entries()) {
      if (!suggestion.citations.some((citation) => citation.locator.startsWith("body ")))
        context.addIssue({
          code: "custom",
          path: ["suggestions", index, "citations"],
          message: "Ground each question in at least one exact body excerpt",
        });
      for (const [citationIndex, citation] of suggestion.citations.entries())
        if (!sections.get(citation.locator)?.includes(citation.excerpt))
          context.addIssue({
            code: "custom",
            path: ["suggestions", index, "citations", citationIndex],
            message: "Copy an exact excerpt from its source section",
          });
    }
  });
export type PresentationQuestionSuggestionsProposal = z.infer<
  typeof PresentationQuestionSuggestionsProposalSchema
>;
export const presentationQuestionSuggestionsRequestHash = (value: unknown) =>
  presentationSourceFingerprintDigest(
    JSON.stringify(CreatePresentationQuestionSuggestionsJobSchema.parse(value)),
  );
export const presentationQuestionSuggestionsProposalHash = (value: unknown) =>
  presentationSourceFingerprintDigest(
    JSON.stringify(PresentationQuestionSuggestionsProposalSchema.parse(value)),
  );

export const PresentationQuestionSuggestionsErrorCodeSchema = PresentationAssistanceErrorCodeSchema;
export type PresentationQuestionSuggestionsErrorCode = z.infer<
  typeof PresentationQuestionSuggestionsErrorCodeSchema
>;
export const PRESENTATION_QUESTION_SUGGESTIONS_ERROR_MESSAGES: Record<
  PresentationQuestionSuggestionsErrorCode,
  string
> = {
  PROVIDER_UNAVAILABLE:
    "Question suggestions are temporarily unavailable. Your deck has not changed.",
  INVALID_OUTPUT: "The generated questions could not be validated. Your deck has not changed.",
  SOURCE_UNAVAILABLE: "The source slide or its author is no longer available.",
  EXPIRED: "These private question suggestions have expired and have been erased.",
  ATTEMPTS_EXHAUSTED: "Question suggestions could not finish within their attempt limit.",
};
export const PresentationQuestionSuggestionsJobSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: uuid,
    requestId: uuid,
    presentationId: uuid,
    blockId: uuid,
    sourceRevision: z.number().int().nonnegative(),
    sourceDigest: digest,
    outputLanguage: z.literal("en"),
    status: z.enum(["pending", "processing", "ready", "failed", "expired"]),
    attempts: z.number().int().min(0).max(PRESENTATION_QUESTION_SUGGESTIONS_MAX_ATTEMPTS),
    proposal: PresentationQuestionSuggestionsProposalSchema.nullable(),
    proposalHash: digest.nullable(),
    error: z
      .object({
        code: PresentationQuestionSuggestionsErrorCodeSchema,
        message: z.string().min(1).max(160),
      })
      .strict()
      .nullable(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    expiresAt: z.string().datetime(),
  })
  .strict()
  .superRefine((job, context) => {
    if (job.id !== job.requestId)
      context.addIssue({
        code: "custom",
        path: ["requestId"],
        message: "Job identity must match its exact request identity",
      });
    if (
      (job.status === "ready") !== (job.proposal !== null && job.proposalHash !== null) ||
      (job.status !== "ready" && (job.proposal !== null || job.proposalHash !== null))
    )
      context.addIssue({
        code: "custom",
        path: ["proposal"],
        message: "Only ready jobs retain complete proposals",
      });
    const parsedProposal = job.proposal
      ? PresentationQuestionSuggestionsProposalSchema.safeParse(job.proposal)
      : null;
    if (
      job.proposal &&
      (!parsedProposal?.success ||
        job.proposal.blockId !== job.blockId ||
        job.proposal.sourceDigest !== job.sourceDigest ||
        job.proposal.outputLanguage !== job.outputLanguage ||
        presentationQuestionSuggestionsProposalHash(parsedProposal.data) !== job.proposalHash)
    )
      context.addIssue({
        code: "custom",
        path: ["proposalHash"],
        message: "The complete proposal must match the admitted source and hash",
      });
    if (
      job.error &&
      job.error.message !== PRESENTATION_QUESTION_SUGGESTIONS_ERROR_MESSAGES[job.error.code]
    )
      context.addIssue({
        code: "custom",
        path: ["error"],
        message: "Use the static error message",
      });
    if (
      ((job.status === "failed" || job.status === "expired") && !job.error) ||
      ((job.status === "ready" || job.status === "processing") && job.error) ||
      (job.status === "expired") !== (job.error?.code === "EXPIRED")
    )
      context.addIssue({
        code: "custom",
        path: ["error"],
        message: "The error must match the job state",
      });
  });
export type PresentationQuestionSuggestionsJob = z.infer<
  typeof PresentationQuestionSuggestionsJobSchema
>;
export const InsertPresentationQuestionSuggestionSchema = z
  .object({
    schemaVersion: z.literal(1),
    jobId: uuid,
    proposalHash: digest,
    blockId: uuid,
    sourceDigest: digest,
    suggestionId: uuid,
    reviewed: z.literal(true),
    expectedRevision: z.number().int().nonnegative(),
    mutationId: uuid,
  })
  .strict();
export type InsertPresentationQuestionSuggestion = z.infer<
  typeof InsertPresentationQuestionSuggestionSchema
>;

const insertionIdentity = z.object({ jobId: uuid, suggestionId: uuid, mutationId: uuid }).strict();
export function presentationQuestionSuggestionInsertionIds(
  input: z.infer<typeof insertionIdentity>,
): { blockId: string; questionId: string } {
  input = insertionIdentity.parse(input);
  const id = (kind: string) => {
    const hex = presentationSourceFingerprintDigest(
      `presentation-question-suggestions:${input.jobId}:${input.mutationId}:${input.suggestionId}:${kind}`,
    )
      .slice(0, 32)
      .split("");
    hex[12] = "5";
    hex[16] = (8 + (Number.parseInt(hex[16]!, 16) & 3)).toString(16);
    const value = hex.join("");
    return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
  };
  return { blockId: id("block"), questionId: id("question") };
}

export const PresentationQuestionSuggestionInsertedBlockSchema = z
  .object({
    id: uuid,
    kind: z.literal("question"),
    question: z
      .object({
        id: uuid,
        prompt: canonicalVisibleText(500),
        purpose: z.literal("opinion"),
        confidence: z.literal("off"),
        delivery: z.literal("main"),
        conceptKeys: z.array(z.never()).length(0),
        linkedRecheckQuestionId: z.null(),
        timeLimitSeconds: z.literal(20),
        basePoints: z.literal(0),
        explanation: z.literal(""),
        mediaId: z.null(),
        mediaAlt: z.null(),
        type: z.literal("open_text"),
      })
      .strict(),
    citations: z.array(PresentationQuestionSuggestionCitationSchema).min(1).max(4),
    sourceDisclosure: z
      .object({
        sourceName: z.string().trim().min(1).max(160),
        sourceDigest: digest,
        provider: canonicalVisibleText(80),
        model: canonicalVisibleText(120),
        conversionNotes: z.array(z.string().trim().min(1).max(300)).min(1).max(10),
      })
      .strict(),
  })
  .strict();

export function buildPresentationQuestionSuggestionBlock(input: {
  proposal: PresentationQuestionSuggestionsProposal;
  jobId: string;
  suggestionId: string;
  mutationId: string;
}): InteractiveQuestionBlockDraft {
  const proposal = PresentationQuestionSuggestionsProposalSchema.parse(input.proposal);
  const ids = presentationQuestionSuggestionInsertionIds({
    jobId: input.jobId,
    suggestionId: input.suggestionId,
    mutationId: input.mutationId,
  });
  const suggestion = proposal.suggestions.find(
    (suggestion) => suggestion.id === input.suggestionId.toLowerCase(),
  );
  if (!suggestion) throw new Error("Select one question from the reviewed proposal");
  return PresentationQuestionSuggestionInsertedBlockSchema.parse({
    id: ids.blockId,
    kind: "question",
    question: {
      id: ids.questionId,
      prompt: suggestion.prompt,
      purpose: "opinion",
      confidence: "off",
      delivery: "main",
      conceptKeys: [],
      linkedRecheckQuestionId: null,
      timeLimitSeconds: 20,
      basePoints: 0,
      explanation: "",
      mediaId: null,
      mediaAlt: null,
      type: "open_text",
    },
    citations: suggestion.citations.map((citation) => ({ ...citation })),
    sourceDisclosure: {
      sourceName: proposal.source.title.text.trim(),
      sourceDigest: proposal.sourceDigest,
      provider: proposal.provider,
      model: proposal.model,
      conversionNotes: [
        `${proposal.reviewWarning} Source slide ${proposal.blockId}.`,
        ...[proposal.source.title, ...proposal.source.body].map(
          (node, index) =>
            `${index === 0 ? "Title" : `Body ${index}`} node ${node.nodeId}; language: ${node.lang ?? "unspecified"}.`,
        ),
      ],
    },
  });
}

/** Exact generated block projection, retained by tab recovery without storing its private text. */
export function presentationQuestionSuggestionInsertedBlockHash(block: unknown): string {
  return presentationSourceFingerprintDigest(
    JSON.stringify(PresentationQuestionSuggestionInsertedBlockSchema.parse(block)),
  );
}
