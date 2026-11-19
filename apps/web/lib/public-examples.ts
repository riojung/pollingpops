import { LocalReturnPathSchema } from "@openround/contracts";
import content from "./public-examples-content.json";

export const publicExampleKinds = {
  round: "Round",
  presentation: "Presentation",
  survey: "Survey",
  board: "Board",
} as const;
export type PublicExampleKind = keyof typeof publicExampleKinds;

export const publicExampleUseCases = {
  meetings: "Meetings",
  workshops: "Workshops",
  education: "Education",
  training: "Training",
  events: "Events",
} as const;
export type PublicExampleUseCase = keyof typeof publicExampleUseCases;

export interface PublicExample {
  id: string;
  sourceId: string;
  kind: PublicExampleKind;
  title: string;
  summary: string;
  useCases: PublicExampleUseCase[];
  guide: {
    audience: string;
    minutes: number;
    preparation: string;
    facilitation: string;
    interpretation: string;
    followUp: string;
  };
  preview: Array<{
    kind: "poll" | "rating" | "quiz" | "slide" | "board";
    title: string;
    body?: string;
    options?: string[];
    note?: string;
  }>;
}

/**
 * Finite English editorial projection of original repository starters, not workspace data.
 * Sources: server starter-meeting-collection/starters; web presentation-templates;
 * contracts canvas-template-catalog. No runtime API, model, media or copy factory is used.
 * Keep participant responses, session aliases and customer evidence out of this catalog.
 */
export const publicExamples = content as PublicExample[];

export function findPublicExample(id: string | null | undefined) {
  return publicExamples.find((example) => example.id === id);
}

export function filterPublicExamples({
  search = "",
  kind = "all",
  useCase = "all",
}: {
  search?: string;
  kind?: PublicExampleKind | "all";
  useCase?: PublicExampleUseCase | "all";
} = {}) {
  const words = search.normalize("NFC").trim().toLocaleLowerCase("en-CA").split(/\s+/u);
  return publicExamples.filter((example) => {
    const searchable = [
      example.title,
      example.summary,
      publicExampleKinds[example.kind],
      ...example.useCases.map((value) => publicExampleUseCases[value]),
      ...example.preview.map((block) => block.title),
    ]
      .join(" ")
      .normalize("NFC")
      .toLocaleLowerCase("en-CA");
    return (
      (kind === "all" || example.kind === kind) &&
      (useCase === "all" || example.useCases.includes(useCase)) &&
      words.every((word) => searchable.includes(word))
    );
  });
}

export function publicExampleDestination(example: PublicExample) {
  if (example.kind === "board") return "/boards?create=1";
  const type = example.kind === "round" ? "rounds" : `${example.kind}s`;
  const query = new URLSearchParams({ type, sourceId: example.sourceId });
  if (
    [
      "meeting-priorities",
      "team-retrospective",
      "meeting",
      "retrospective",
      "team-collaboration",
    ].includes(example.sourceId)
  ) {
    query.set("collection", "team-meetings");
  }
  return `/templates?${query}`;
}

export function publicExampleContinueHref(example: PublicExample) {
  const returnTo = LocalReturnPathSchema.parse(publicExampleDestination(example));
  return `/signin?${new URLSearchParams({ returnTo })}`;
}

/** A query is navigation context only. It never creates a draft or grants access. */
export function publicTemplateContext(sourceId: string | null, type: string) {
  return publicExamples.find(
    (example) =>
      example.kind !== "board" &&
      example.sourceId === sourceId &&
      (example.kind === "round" ? "rounds" : `${example.kind}s`) === type,
  );
}
