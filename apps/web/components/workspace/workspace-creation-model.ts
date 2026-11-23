import type { WorkspaceProductFeatures } from "@openround/contracts";
import type { TemplateCollectionId } from "../../lib/template-collections";

export const roundCreationMethods = ["blank", "starters", "source", "import"] as const;
export type RoundCreationMethod = (typeof roundCreationMethods)[number];
export type RoundCreationGoal = "quiz" | "poll" | "custom";
export type PresentationCreationMethod = "blank" | "source" | "template" | "outline" | "design";
export type SurveyCreationMethod = "blank" | "template";
type CreationQuery = { getAll(name: string): string[] };
type SelectionIssue = "invalid-selection" | "incompatible-method" | null;

/** Fixed local destinations: navigation never creates a draft. */
export function roundCreationHref(kind?: RoundCreationGoal, method?: RoundCreationMethod): string {
  const query = new URLSearchParams(kind ? { type: kind } : { product: "round" });
  if (method) query.set("start", method);
  return `/create?${query}`;
}

export function presentationCreationHref(method?: PresentationCreationMethod): string {
  return `/create/presentation${method ? `?start=${method}` : ""}`;
}

export function surveyCreationHref(method?: SurveyCreationMethod): string {
  return `/surveys/new${method ? `?start=${method}` : ""}`;
}

export function templateCatalogHref(
  type?: "rounds" | "presentations" | "surveys" | "designs",
  collection?: TemplateCollectionId,
): string {
  const query = new URLSearchParams();
  if (type) query.set("type", type);
  if (collection) query.set("collection", collection);
  return `/templates${query.size ? `?${query}` : ""}`;
}

function selection<T extends string>(query: CreationQuery, key: string, values: readonly T[]) {
  const requested = query.getAll(key);
  const value = requested.length === 1 ? requested[0] : undefined;
  return {
    present: requested.length > 0,
    valid: requested.length === 0 || (requested.length === 1 && values.includes(value as T)),
    value: values.includes(value as T) ? (value as T) : null,
  };
}

/** Query selection takes precedence over legacy hashes, including an invalid query. */
export function resolveRoundCreation(
  query: CreationQuery,
  hash: string,
  builderEnabled: boolean,
): {
  kind: RoundCreationGoal | null;
  method: RoundCreationMethod | null;
  issue: SelectionIssue;
  roundOnly: boolean;
} {
  const product = selection(query, "product", ["round"]);
  const roundOnly = product.valid && product.value === "round";
  if (!builderEnabled) return { kind: null, method: null, issue: null, roundOnly };
  const goal = selection(query, "type", ["quiz", "poll", "custom"] as const);
  const start = selection(query, "start", roundCreationMethods);
  if (!goal.valid) return { kind: null, method: null, issue: "invalid-selection", roundOnly };
  if (!start.valid)
    return { kind: goal.value, method: null, issue: "invalid-selection", roundOnly };
  const hashValue = hash.replace(/^#/, "");
  const legacyMethod = roundCreationMethods.find((value) => value === hashValue) ?? null;
  const requestedMethod = start.present ? start.value : legacyMethod;
  const kind = goal.value ?? (requestedMethod ? "custom" : null);
  if (kind === "poll" && (requestedMethod === "source" || requestedMethod === "import"))
    return { kind, method: null, issue: "incompatible-method", roundOnly };
  return { kind, method: kind ? (requestedMethod ?? "blank") : null, issue: null, roundOnly };
}

export function resolvePresentationCreation(query: CreationQuery): {
  method: PresentationCreationMethod | null;
  issue: "invalid-selection" | null;
} {
  const start = selection(query, "start", [
    "blank",
    "source",
    "template",
    "outline",
    "design",
  ] as const);
  return { method: start.value, issue: start.valid ? null : "invalid-selection" };
}

export function resolveSurveyCreation(query: CreationQuery): {
  method: SurveyCreationMethod | null;
  issue: "invalid-selection" | null;
} {
  const start = selection(query, "start", ["blank", "template"] as const);
  return { method: start.value, issue: start.valid ? null : "invalid-selection" };
}

export type WorkspaceCreationKind = "round" | "presentation" | "survey" | "ideaBoard";
export interface WorkspaceCreationOption {
  kind: WorkspaceCreationKind;
  href: string;
}

export type WorkspaceCreationGoal = {
  kind: "poll" | "quiz" | "presentation" | "round";
  href: string;
};

/** First-session goals use the same role and feature grants as the full creation launcher. */
export function workspaceCreationGoals(
  input: Parameters<typeof workspaceCreationOptions>[0],
): WorkspaceCreationGoal[] {
  const available = workspaceCreationOptions(input);
  const goals: WorkspaceCreationGoal[] = [];
  const round = available.find((option) => option.kind === "round");
  if (round) {
    if (input.productFeatures?.builderV2)
      goals.push(
        { kind: "poll", href: roundCreationHref("poll") },
        { kind: "quiz", href: roundCreationHref("quiz") },
      );
    else goals.push({ kind: "round", href: round.href });
  }
  if (available.some((option) => option.kind === "presentation"))
    goals.push({ kind: "presentation", href: presentationCreationHref() });
  return goals;
}

/** Account-resolved feature grants and workspace role are the source of UI availability. */
export function workspaceCreationOptions({
  canEdit,
  productFeatures,
}: {
  canEdit: boolean;
  productFeatures: WorkspaceProductFeatures | null | undefined;
}): WorkspaceCreationOption[] {
  if (!canEdit || !productFeatures) return [];
  const options: WorkspaceCreationOption[] = [
    { kind: "round", href: productFeatures.builderV2 ? roundCreationHref() : "/dashboard" },
  ];
  if (productFeatures.presentations)
    options.push({ kind: "presentation", href: presentationCreationHref() });
  if (productFeatures.surveys) options.push({ kind: "survey", href: surveyCreationHref() });
  if (productFeatures.ideaBoards || productFeatures.canvasBoards)
    options.push({ kind: "ideaBoard", href: "/boards?create=1" });
  return options;
}

export function workspaceBlankCreationHref(
  kind: WorkspaceCreationKind,
  input: Parameters<typeof workspaceCreationOptions>[0],
): string | null {
  const available = workspaceCreationOptions(input).find((option) => option.kind === kind);
  if (!available) return null;
  if (kind === "round")
    return input.productFeatures?.builderV2 ? roundCreationHref("custom", "blank") : available.href;
  if (kind === "presentation") return presentationCreationHref("blank");
  if (kind === "survey") return surveyCreationHref("blank");
  return available.href;
}
