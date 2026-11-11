import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import ts from "typescript";
import {
  PresentationContentSchema,
  QuizContentSchema,
  supportedLocales,
  type SupportedLocale,
} from "../packages/contracts/src/index";
import { SurveyContentSchema } from "../packages/contracts/src/surveys";
import {
  allPresentationTemplatesForLocale,
  instantiatePresentationTemplate,
} from "../apps/web/lib/presentation-templates";
import { loadPresentationTemplateLocale } from "../apps/web/lib/presentation-template-locales";
import { presentationReadiness, createQuestionBlock } from "../apps/web/lib/presentation-builder";
import {
  createNativeChartNode,
  createNativeTableNode,
} from "../apps/web/lib/presentation-native-data";
import { creationContent, packPracticeTitle } from "../apps/web/lib/i18n/creation-content";
import { questionStarterContent } from "../apps/web/lib/i18n/question-starter-content";
import { creationGoalMessages } from "../apps/web/lib/i18n/creation-goal-messages";
import { creationMessages } from "../apps/web/lib/i18n/creation-messages";
import { templateMessages } from "../apps/web/lib/i18n/template-messages";
import {
  practiceManagementCopy,
  practiceManagementCopyKeys,
} from "../apps/web/lib/i18n/practice-management-copy";
import {
  packPracticeSetupCopy,
  packPracticeSetupCopyKeys,
} from "../apps/web/lib/i18n/pack-practice-setup-copy";
import {
  packPracticeDetailCopy,
  packPracticeDetailCopyKeys,
} from "../apps/web/lib/i18n/pack-practice-detail-copy";
import { packPracticeCopy, packPracticeCopyKeys } from "../apps/web/lib/i18n/pack-practice-copy";
import { instantiateStarter, starterSummariesForLocale } from "../apps/server/src/starters";
import {
  STARTER_CONTENT_VERSION,
  surveyCreationCopy,
} from "../apps/server/src/starter-localization";

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export interface ReviewItem {
  id: string;
  context: string;
  source: { file: string; helper: string; contentVersion: string };
  english: Json;
  target: Json;
  englishHash: string;
  targetHash: string;
}
export interface ReviewBundle {
  recordVersion: 1;
  locale: SupportedLocale;
  purpose: "native-review-preparation" | "english-reference";
  scope: string;
  sourceBinding: {
    sourceRef: string;
    files: { path: string; sha256: string }[];
    filesHash: string;
    canonicalContentHash: string;
  };
  coverage: { presentations: number; rounds: number; surveyContexts: number };
  items: ReviewItem[];
  bundleHash: string;
}
export interface ReviewDecisions {
  recordVersion: 1;
  locale: SupportedLocale;
  bundleHash: string;
  sourceBindingHash: string;
  entries: {
    itemId: string;
    englishHash: string;
    targetHash: string;
    decision: "pending" | "accepted" | "needs-change";
    reviewerReference: string | null;
    reviewedAt: string | null;
    issue: string | null;
    evidenceReference: string | null;
  }[];
}

export const reviewExampleSource =
  "Synthetic authored source: 12345678-1234-4123-8123-123456789abc $& $` $' {title} <img src=x onerror=alert(1)>";
const scope =
  "Creation and practice copy; all 21 Presentation definitions and generated drafts; all 36 Round starters and 17 Survey projections; action-created defaults. Static editorial preparation only: no native-quality, accessibility, in-context, support/legal, or release acceptance is inferred. Raw catalog parity remains covered by existing catalog tests, not English fallback merging.";
const shaPattern = /^[a-f0-9]{40}$/;
const hashPattern = /^sha256:[a-f0-9]{64}$/;
const uuidPattern = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;

export function canonicalJson(value: unknown): string {
  const sort = (input: unknown): unknown => {
    if (Array.isArray(input)) return input.map(sort);
    if (input !== null && typeof input === "object")
      return Object.fromEntries(
        Object.entries(input)
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([key, child]) => [key, sort(child)]),
      );
    return input;
  };
  return JSON.stringify(sort(value), null, 2) + "\n";
}

export function contentHash(value: unknown): string {
  return `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
}

function fail(message: string): never {
  throw new Error(`Localization review: ${message}`);
}

/** Only generated schema ID fields and their declared references are rewritten. */
export function normalizeGeneratedIds(value: unknown): Json {
  const copy = structuredClone(value) as Json;
  const identities = new Map<string, string>();
  const generatedPath =
    /^(?:\/id|\/question\/id)$|\/(?:blocks|questions|choices|textElements|nodes)\/\d+(?:\/question)?\/id$/;
  const visit = (input: Json, path: string, replace: boolean): Json => {
    if (Array.isArray(input))
      return input.map((child, index) => visit(child, `${path}/${index}`, replace));
    if (input !== null && typeof input === "object")
      return Object.fromEntries(
        Object.entries(input).map(([key, child]) => {
          const childPath = `${path}/${key}`;
          if (
            key === "id" &&
            typeof child === "string" &&
            (uuidPattern.test(child) || child === `generated:${childPath}`) &&
            generatedPath.test(childPath)
          ) {
            if (!replace) {
              if (identities.has(child)) fail(`duplicate generated identity at ${childPath}`);
              identities.set(child, `generated:${childPath}`);
            }
            return [key, replace ? identities.get(child)! : child];
          }
          if (replace && key === "linkedRecheckQuestionId" && typeof child === "string") {
            if (!identities.has(child)) fail(`unresolved generated reference at ${childPath}`);
            return [key, identities.get(child)!];
          }
          if (replace && key === "readingOrder" && Array.isArray(child))
            return [
              key,
              child.map((id) => {
                if (typeof id !== "string" || !identities.has(id))
                  fail(`unresolved reading order at ${childPath}`);
                return identities.get(id)!;
              }),
            ];
          return [key, visit(child, childPath, replace)];
        }),
      );
    return input;
  };
  visit(copy, "", false);
  return visit(copy, "", true);
}

const copyFields = new Set([
  "title",
  "description",
  "scenarioLabel",
  "body",
  "notes",
  "speakerNotes",
  "prompt",
  "explanation",
  "minLabel",
  "maxLabel",
  "label",
  "feedback",
  "unit",
  "text",
  "caption",
  "summary",
  "headers",
  "categories",
  "name",
  "low",
  "high",
  "columns",
  "labels",
  "rows",
]);

/** Retains IDs/topology, enums, scoring, schema, geometry, figures and all array shapes. */
export function invariantStructure(value: unknown, source = value): Json {
  const visit = (input: Json, reference: Json | undefined, field = "", inCopy = false): Json => {
    const translated = inCopy || copyFields.has(field);
    if (typeof input === "string" && translated)
      return typeof reference === "string" && /^[\d\s$%,.–—:+/()-]+$/u.test(reference)
        ? input
        : "<copy>";
    if (Array.isArray(input))
      return input.map((child, index) =>
        visit(child, Array.isArray(reference) ? reference[index] : undefined, field, translated),
      );
    if (input !== null && typeof input === "object")
      return Object.fromEntries(
        // Column emphasis is generated from localized colon punctuation, not scene geometry.
        Object.entries(input)
          .filter(([key]) => key !== "richText")
          .map(([key, child]) => [
            key,
            visit(
              child,
              reference && !Array.isArray(reference) && typeof reference === "object"
                ? reference[key]
                : undefined,
              key,
            ),
          ]),
      );
    return input;
  };
  return visit(normalizeGeneratedIds(value), normalizeGeneratedIds(source));
}

export function assertInvariantParity(english: unknown, target: unknown, context: string) {
  const sourceStructure = invariantStructure(english);
  const targetStructure = invariantStructure(target, english);
  if (canonicalJson(sourceStructure) !== canonicalJson(targetStructure)) {
    const firstDifference = (
      source: Json | undefined,
      translated: Json | undefined,
      path: string,
    ): string => {
      if (source && translated && typeof source === "object" && typeof translated === "object") {
        const a = source as Record<string, Json>;
        const b = translated as Record<string, Json>;
        for (const key of new Set([...Object.keys(a), ...Object.keys(b)]))
          if (canonicalJson(a[key]) !== canonicalJson(b[key]))
            return firstDifference(a[key], b[key], `${path}/${key}`);
      }
      return path;
    };
    fail(
      `schema/number/scoring/topology invariant changed: ${context}${firstDifference(sourceStructure, targetStructure, "")}`,
    );
  }
}

export function currentSourceRef(root = process.cwd()): string {
  try {
    const head = execFileSync("git", ["rev-parse", "--verify", "HEAD"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
    if (!shaPattern.test(head)) fail("candidate HEAD must be a full Git SHA");
    return head;
  } catch {
    return fail("unable to determine candidate Git HEAD");
  }
}

function placeholders(text: string) {
  return [...text.matchAll(/\{([a-zA-Z][\w]*)\}/g)].map((match) => match[1]!).sort();
}

function phraseExample(text: string, locale: SupportedLocale) {
  return text.replace(/\{([a-zA-Z][\w]*)\}/g, (_match, key: string) => {
    if (/date|time|open|close|expire/i.test(key))
      return new Intl.DateTimeFormat(locale, {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "UTC",
      }).format(new Date("2026-11-11T17:30:00.000Z"));
    if (/count|number|limit|days|minutes|total|completed|active/i.test(key))
      return new Intl.NumberFormat(locale).format(1234);
    return `[synthetic ${key}: ${reviewExampleSource}]`;
  });
}

function resolveImport(root: string, importer: string, specifier: string): string | null {
  let base: string;
  if (specifier.startsWith(".")) base = resolve(dirname(importer), specifier);
  else if (specifier.startsWith("@openround/")) {
    const [name, ...subpath] = specifier.slice("@openround/".length).split("/");
    base = resolve(root, "packages", name!, "src", subpath.join("/") || "index");
  } else return null;
  const candidates = [
    base,
    base.replace(/\.js$/, ".ts"),
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.json`,
    resolve(base, "index.ts"),
  ];
  const found = candidates.find(
    (candidate) => /\.(?:tsx?|json)$/.test(candidate) && existsSync(candidate),
  );
  if (!found) fail(`cannot bind source import ${specifier} from ${relative(root, importer)}`);
  if (relative(root, found).startsWith("..")) fail("source import escapes the repository");
  return found;
}

/** Compiler parsing includes re-exports, type imports and lazy locale imports; no Git mutation. */
export async function reviewSourceFiles(root = process.cwd()) {
  const pending = [resolve(root, "scripts/localization-review.ts")];
  const files = new Map<string, string>();
  for (const metadata of [
    "scripts/localization-review.tsconfig.json",
    "pnpm-lock.yaml",
    "package.json",
    "packages/contracts/package.json",
    "packages/experience/package.json",
    "apps/server/package.json",
    "apps/web/package.json",
  ])
    pending.push(resolve(root, metadata));
  while (pending.length) {
    const path = pending.pop()!;
    if (files.has(path)) continue;
    const bytes = await readFile(path);
    files.set(path, `sha256:${createHash("sha256").update(bytes).digest("hex")}`);
    if (!/\.tsx?$/.test(path)) continue;
    const source = ts.createSourceFile(path, bytes.toString("utf8"), ts.ScriptTarget.Latest, true);
    const visit = (node: ts.Node) => {
      let specifier: ts.Expression | undefined;
      if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node))
        specifier = node.moduleSpecifier;
      if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword)
        specifier = node.arguments[0];
      if (specifier && ts.isStringLiteral(specifier)) {
        const dependency = resolveImport(root, path, specifier.text);
        if (dependency) pending.push(dependency);
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return [...files.entries()]
    .map(([path, sha256]) => ({ path: relative(root, path).replaceAll("\\", "/"), sha256 }))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

export async function buildReviewBundle(
  locale: SupportedLocale,
  sourceRef: string,
  root = process.cwd(),
): Promise<ReviewBundle> {
  if (!(supportedLocales as readonly string[]).includes(locale)) fail("unsupported locale");
  if (!shaPattern.test(sourceRef)) fail("source-ref must be a full lowercase Git SHA");
  if (sourceRef !== currentSourceRef(root))
    fail("source-ref does not match current candidate Git HEAD");
  await Promise.all([
    loadPresentationTemplateLocale("en-CA"),
    loadPresentationTemplateLocale(locale),
  ]);
  const items: ReviewItem[] = [];
  const add = (
    id: string,
    context: string,
    file: string,
    helper: string,
    english: unknown,
    target: unknown,
    contentVersion = "repository-source",
  ) => {
    const source = { file, helper, contentVersion };
    const entry = {
      id,
      context,
      source,
      english: english as Json,
      target: target as Json,
      englishHash: contentHash(english),
      targetHash: contentHash(target),
    };
    if (items.some((item) => item.id === id)) fail(`duplicate generated item ${id}`);
    items.push(entry);
  };
  const ui = (
    group: string,
    file: string,
    helper: string,
    english: Record<string, string>,
    target: Record<string, string>,
  ) => {
    if (canonicalJson(Object.keys(english).sort()) !== canonicalJson(Object.keys(target).sort()))
      fail(`${group} key parity`);
    for (const key of Object.keys(english).sort()) {
      const sourceText = english[key]!;
      const targetText = target[key];
      if (!targetText?.trim()) fail(`${group}/${key} is empty`);
      if (canonicalJson(placeholders(sourceText)) !== canonicalJson(placeholders(targetText)))
        fail(`${group}/${key} placeholder parity`);
      add(
        `ui/${group}/${encodeURIComponent(key)}`,
        `Critical-flow phrase: ${key}. Examples use synthetic values; dates are UTC.`,
        file,
        helper,
        { template: sourceText, example: phraseExample(sourceText, "en-CA") },
        { template: targetText, example: phraseExample(targetText, locale) },
      );
    }
  };
  for (const [group, helper, keys, factory] of [
    [
      "practice-management",
      "practiceManagementCopy",
      practiceManagementCopyKeys,
      practiceManagementCopy,
    ],
    [
      "pack-practice-setup",
      "packPracticeSetupCopy",
      packPracticeSetupCopyKeys,
      packPracticeSetupCopy,
    ],
    [
      "pack-practice-detail",
      "packPracticeDetailCopy",
      packPracticeDetailCopyKeys,
      packPracticeDetailCopy,
    ],
    ["pack-practice", "packPracticeCopy", packPracticeCopyKeys, packPracticeCopy],
  ] as const) {
    const messages = (language: SupportedLocale) => {
      const copy = factory(language) as (
        key: string,
        values?: Record<string, string | number>,
      ) => string;
      return Object.fromEntries(keys.map((key) => [key, copy(key)]));
    };
    ui(group, `apps/web/lib/i18n/${group}-copy.ts`, helper, messages("en-CA"), messages(locale));
  }
  for (const [group, helper, factory] of [
    ["creation-goal", "creationGoalMessages", creationGoalMessages],
    ["creation", "creationMessages", creationMessages],
    ["template", "templateMessages", templateMessages],
  ] as const)
    ui(group, `apps/web/lib/i18n/${group}-messages.ts`, helper, factory("en-CA"), factory(locale));

  const definitions = allPresentationTemplatesForLocale("en-CA");
  const translated = allPresentationTemplatesForLocale(locale);
  if (definitions.length !== 21 || translated.length !== 21) fail("expected 21 Presentations");
  for (const [index, definition] of definitions.entries()) {
    const targetDefinition = translated[index]!;
    if (definition.id !== targetDefinition.id) fail("Presentation identity/order changed");
    const file =
      definition.collection === "native"
        ? "apps/web/lib/presentation-native-templates.ts"
        : "apps/web/lib/presentation-templates.ts";
    assertInvariantParity(definition, targetDefinition, definition.id);
    add(
      `presentation/${definition.id}/definition`,
      "Full authored definition, including adaptation notes and data labels.",
      file,
      definition.collection === "native"
        ? "nativePresentationTemplatesForLocale"
        : "allPresentationTemplatesForLocale",
      definition,
      targetDefinition,
    );
    const english = instantiatePresentationTemplate(definition.id, "en-CA");
    const target = instantiatePresentationTemplate(definition.id, locale);
    for (const draft of [english, target]) {
      PresentationContentSchema.parse(draft);
      if (presentationReadiness(draft).length) fail(`Presentation is not ready: ${definition.id}`);
    }
    assertInvariantParity(english, target, definition.id);
    add(
      `presentation/${definition.id}/draft`,
      "Actual generated draft: visible scene/text and complete speaker notes; IDs normalized by field path.",
      file,
      definition.collection === "native"
        ? "instantiateNativePresentationTemplate"
        : "instantiatePresentationTemplate",
      normalizeGeneratedIds(english),
      normalizeGeneratedIds(target),
    );
  }

  const summaries = starterSummariesForLocale("en-CA");
  const targetSummaries = starterSummariesForLocale(locale);
  if (summaries.length !== 36 || targetSummaries.length !== 36) fail("expected 36 Round starters");
  let surveyContexts = 0;
  for (const [index, summary] of summaries.entries()) {
    const targetSummary = targetSummaries[index]!;
    if (summary.id !== targetSummary.id) fail("Round identity/order changed");
    const english = instantiateStarter(summary.id, "en-CA");
    const target = instantiateStarter(summary.id, locale);
    QuizContentSchema.parse(english);
    QuizContentSchema.parse(target);
    assertInvariantParity(english, target, summary.id);
    add(
      `round/${summary.id}/metadata`,
      "Gallery metadata and preview prompt.",
      "apps/server/src/starters.ts",
      "starterSummariesForLocale",
      summary,
      targetSummary,
      STARTER_CONTENT_VERSION,
    );
    add(
      `round/${summary.id}/draft`,
      "Complete generated Round; answer keys, numeric answers and recheck links remain visible for editorial review.",
      "apps/server/src/starters.ts",
      "instantiateStarter",
      normalizeGeneratedIds(english),
      normalizeGeneratedIds(target),
      STARTER_CONTENT_VERSION,
    );
    if (summary.responseTypes.every((type) => type === "poll" || type === "rating")) {
      const survey = (draft: typeof english, language: SupportedLocale) => ({
        schemaVersion: 2,
        title: draft.title,
        description: surveyCreationCopy(language).description,
        category: draft.category,
        experiencePreset: draft.experiencePreset,
        items: draft.questions.map((question) => ({ required: true, question })),
      });
      SurveyContentSchema.parse(survey(english, "en-CA"));
      SurveyContentSchema.parse(survey(target, locale));
      const context = (language: SupportedLocale) => ({
        schemaVersion: 2,
        questionContentReference: `round/${summary.id}/draft`,
        description: surveyCreationCopy(language).description,
        required: true,
        unscored: true,
        questionCount: english.questions.length,
      });
      add(
        `survey/${summary.id}/context`,
        "Survey projection reuses this Round's exact localized questions; review the referenced draft and this Survey-only description/required/unscored context.",
        "apps/server/src/starter-localization.ts",
        "surveyCreationCopy / SurveyContentSchema",
        context("en-CA"),
        context(locale),
        STARTER_CONTENT_VERSION,
      );
      surveyContexts++;
    }
  }
  if (surveyContexts !== 17) fail("expected 17 Survey contexts");

  const defaults = (language: SupportedLocale) => {
    const copy = creationContent(language);
    const keys = [
      "true",
      "false",
      "low",
      "high",
      "untitledRound",
      "option",
      "notAtAll",
      "veryMuch",
      "tableCaption",
      "category",
      "value",
      "alpha",
      "beta",
      "gamma",
      "chartTitle",
      "chartSummary",
      "seriesValue",
      "series",
      "column",
      "intervention",
    ] as const;
    return {
      strings: Object.fromEntries(keys.map((key) => [key, copy(key, 3)])),
      delayedProbeTitle: packPracticeTitle(language, false, reviewExampleSource),
      fullSequenceTitle: packPracticeTitle(language, true, reviewExampleSource),
    };
  };
  add(
    "defaults/creation-copy",
    "Explicit action-created defaults. The synthetic source is intentionally literal; titles retain the product's 160-character cap.",
    "apps/web/lib/i18n/creation-content.ts",
    "creationContent / packPracticeTitle",
    defaults("en-CA"),
    defaults(locale),
  );
  add(
    "defaults/question-scaffolds",
    "Generated local discussion/clarity/priority scaffolds quote the exact synthetic authored source. Source text, dollar tokens, UUIDs and HTML-like bytes are not translated.",
    "apps/web/lib/i18n/question-starter-content.ts",
    "questionStarterContent",
    questionStarterContent("en-CA", reviewExampleSource),
    questionStarterContent(locale, reviewExampleSource),
  );
  add(
    "defaults/survey-copy",
    "New Survey title, unscored description and copy suffix.",
    "apps/server/src/starter-localization.ts",
    "surveyCreationCopy",
    surveyCreationCopy("en-CA"),
    surveyCreationCopy(locale),
    STARTER_CONTENT_VERSION,
  );
  for (const [name, factory] of [
    ["table", createNativeTableNode],
    ["chart", (language: SupportedLocale) => createNativeChartNode("bar", language)],
    ["true-false", (language: SupportedLocale) => createQuestionBlock("true_false", language)],
    ["rating", (language: SupportedLocale) => createQuestionBlock("rating", language)],
  ] as const) {
    const english = factory("en-CA");
    const target = factory(locale);
    assertInvariantParity(english, target, `defaults/${name}`);
    add(
      `defaults/${name}`,
      "Actual inserted default; numeric values and scoring are invariant.",
      name === "chart" || name === "table"
        ? "apps/web/lib/presentation-native-data.ts"
        : "apps/web/lib/presentation-builder.ts",
      name === "chart"
        ? "createNativeChartNode"
        : name === "table"
          ? "createNativeTableNode"
          : "createQuestionBlock",
      normalizeGeneratedIds(english),
      normalizeGeneratedIds(target),
    );
  }
  add(
    "examples/formatting",
    "Fixed UTC instant, counts, percentages and lists for native reviewers. These are synthetic examples, not recorded user data.",
    "scripts/localization-review.ts",
    "Intl (UTC)",
    formattingExample("en-CA"),
    formattingExample(locale),
  );
  items.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const files = await reviewSourceFiles(root);
  const body = {
    recordVersion: 1 as const,
    locale,
    purpose:
      locale === "en-CA" ? ("english-reference" as const) : ("native-review-preparation" as const),
    scope,
    sourceBinding: {
      sourceRef,
      files,
      filesHash: contentHash(files),
      canonicalContentHash: contentHash(items.map(({ id, englishHash }) => ({ id, englishHash }))),
    },
    coverage: { presentations: definitions.length, rounds: summaries.length, surveyContexts },
    items,
  };
  return { ...body, bundleHash: contentHash(body) };
}

function formattingExample(locale: SupportedLocale) {
  return {
    instant: "2026-11-11T17:30:00.000Z",
    timeZone: "UTC",
    dateTime: new Intl.DateTimeFormat(locale, {
      dateStyle: "full",
      timeStyle: "short",
      timeZone: "UTC",
    }).format(new Date("2026-11-11T17:30:00.000Z")),
    count: new Intl.NumberFormat(locale).format(12345),
    percent: new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 1 }).format(
      0.375,
    ),
    list: new Intl.ListFormat(locale, { type: "conjunction" }).format(["Alpha", "Beta", "Gamma"]),
  };
}

export function createReviewDecisions(bundle: ReviewBundle): ReviewDecisions {
  return {
    recordVersion: 1,
    locale: bundle.locale,
    bundleHash: bundle.bundleHash,
    sourceBindingHash: contentHash(bundle.sourceBinding),
    entries: bundle.items.map((item) => ({
      itemId: item.id,
      englishHash: item.englishHash,
      targetHash: item.targetHash,
      decision: "pending",
      reviewerReference: null,
      reviewedAt: null,
      issue: null,
      evidenceReference: null,
    })),
  };
}

function object(value: unknown, context: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    fail(`${context} must be an object`);
  return value as Record<string, unknown>;
}
function exactKeys(value: Record<string, unknown>, keys: string[], context: string) {
  if (canonicalJson(Object.keys(value).sort()) !== canonicalJson(keys.sort()))
    fail(`${context} has missing or unknown fields`);
}
function optionalText(value: unknown, context: string) {
  if (value !== null && (typeof value !== "string" || !value.trim() || value.length > 4000))
    fail(`${context} must be null or nonempty text (up to 4000 characters)`);
}

/** Validates recorded human decisions; it does not establish translation quality or update gates. */
export function checkReviewDecisions(bundle: ReviewBundle, input: unknown, now = new Date()) {
  const review = object(input, "decisions");
  exactKeys(
    review,
    ["recordVersion", "locale", "bundleHash", "sourceBindingHash", "entries"],
    "decisions",
  );
  if (review.recordVersion !== 1) fail("unsupported decisions version");
  if (review.locale !== bundle.locale) fail("decisions locale mismatch");
  if (
    review.bundleHash !== bundle.bundleHash ||
    review.sourceBindingHash !== contentHash(bundle.sourceBinding)
  )
    fail("stale decisions bundle/source binding");
  if (!Array.isArray(review.entries)) fail("decisions entries must be an array");
  const expected = new Map(bundle.items.map((item) => [item.id, item]));
  const seen = new Set<string>();
  const counts = { accepted: 0, pending: 0, needsChange: 0 };
  for (const raw of review.entries) {
    const entry = object(raw, "decision entry");
    exactKeys(
      entry,
      [
        "itemId",
        "englishHash",
        "targetHash",
        "decision",
        "reviewerReference",
        "reviewedAt",
        "issue",
        "evidenceReference",
      ],
      "decision entry",
    );
    if (typeof entry.itemId !== "string" || !expected.has(entry.itemId))
      fail("unknown decision item");
    if (seen.has(entry.itemId)) fail(`duplicate decision item ${entry.itemId}`);
    seen.add(entry.itemId);
    const item = expected.get(entry.itemId)!;
    if (entry.englishHash !== item.englishHash || entry.targetHash !== item.targetHash)
      fail(`stale item hashes: ${entry.itemId}`);
    for (const key of ["reviewerReference", "issue", "evidenceReference"] as const)
      optionalText(entry[key], `${entry.itemId}/${key}`);
    if (entry.decision === "pending") {
      if (
        entry.reviewerReference !== null ||
        entry.reviewedAt !== null ||
        entry.issue !== null ||
        entry.evidenceReference !== null
      )
        fail("pending decisions cannot carry completed review provenance");
      counts.pending++;
      continue;
    }
    if (entry.decision !== "accepted" && entry.decision !== "needs-change")
      fail("unknown review decision");
    if (!entry.reviewerReference) fail("completed decision requires a human reviewer reference");
    if (
      typeof entry.reviewedAt !== "string" ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(entry.reviewedAt)
    )
      fail("completed decision requires a UTC timestamp");
    const timestamp = new Date(entry.reviewedAt);
    if (
      !Number.isFinite(timestamp.getTime()) ||
      timestamp.toISOString() !== entry.reviewedAt ||
      timestamp > now
    )
      fail("invalid or future review timestamp");
    if (entry.decision === "needs-change") {
      if (!entry.issue) fail("needs-change decision requires an issue");
      counts.needsChange++;
    } else {
      if (entry.issue !== null) fail("accepted decision cannot retain an unresolved issue");
      counts.accepted++;
    }
  }
  if (seen.size !== expected.size) fail("incomplete decision item coverage");
  return {
    ...counts,
    complete: counts.pending === 0 && counts.needsChange === 0,
    nativeAcceptance: false as const,
    referenceOnly: bundle.locale === "en-CA",
  };
}

export async function validateCurrentReview(
  bundleInput: unknown,
  decisions: unknown,
  root = process.cwd(),
) {
  const input = object(bundleInput, "bundle");
  const binding = object(input.sourceBinding, "source binding");
  if (
    typeof input.locale !== "string" ||
    !(supportedLocales as readonly string[]).includes(input.locale)
  )
    fail("unsupported bundle locale");
  if (typeof binding.sourceRef !== "string" || !shaPattern.test(binding.sourceRef))
    fail("invalid source-ref");
  if (typeof input.bundleHash !== "string" || !hashPattern.test(input.bundleHash))
    fail("invalid bundle hash");
  const current = await buildReviewBundle(input.locale as SupportedLocale, binding.sourceRef, root);
  if (canonicalJson(current) !== canonicalJson(input))
    fail("bundle is stale, malformed or changed; regenerate from current sources");
  return checkReviewDecisions(current, decisions);
}

export function escapeHtml(value: string) {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!,
  );
}

export function renderReviewHtml(bundle: ReviewBundle): string {
  const text = escapeHtml;
  return `<!doctype html>
<html lang="en-CA"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>Native review preparation — ${text(bundle.locale)}</title>
<style>body{font:16px system-ui;line-height:1.5;margin:2rem;max-width:110rem;color:#17202a;background:#fff}article{border-top:2px solid #617080;margin-top:2rem;padding-top:1rem}.pair{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:1.5rem}.pair>section{min-width:0}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f4f6f8;padding:1rem}code{overflow-wrap:anywhere}small{display:block;overflow-wrap:anywhere}h2{font-size:1.1rem;overflow-wrap:anywhere}@media(max-width:700px){body{margin:1rem}.pair{grid-template-columns:minmax(0,1fr)}}</style></head><body>
<h1>Native review preparation: ${text(bundle.locale)}</h1><p>${text(bundle.scope)}</p>
<p>Use your browser’s Find to search this complete, expanded document. Each JSON object exposes exact field paths and complete copy. Record human decisions in the separate decisions.json; every generated entry begins pending. English packets are reference material. The checker validates records and current source binding; it cannot verify that a reviewer is human or establish native quality.</p>
<p>Candidate source: <code>${text(bundle.sourceBinding.sourceRef)}</code><br>Source files: <code>${text(bundle.sourceBinding.filesHash)}</code><br>Bundle: <code>${text(bundle.bundleHash)}</code></p>
<p>Read the repository localization glossary before reviewing terminology. Review full flows, errors, dates, numbers, visible copy and speaker notes in context before recording acceptance. This packet contains synthetic examples only.</p>
${bundle.items.map((item) => `<article><h2>${text(item.id)}</h2><p>${text(item.context)}</p><p><code>${text(item.source.file)} · ${text(item.source.helper)} · ${text(item.source.contentVersion)}</code></p><div class="pair"><section lang="en-CA"><h3>English reference</h3><pre>${text(canonicalJson(item.english))}</pre><small>${text(item.englishHash)}</small></section><section lang="${text(bundle.locale)}"><h3>${text(bundle.locale)}</h3><pre>${text(canonicalJson(item.target))}</pre><small>${text(item.targetHash)}</small></section></div></article>`).join("\n")}
</body></html>\n`;
}

export async function runLocalizationReview(argv: string[], root = process.cwd()) {
  const [mode, ...rest] = argv;
  const allowed =
    mode === "export"
      ? ["locale", "source-ref", "out"]
      : mode === "check"
        ? ["bundle", "decisions"]
        : [];
  const options = new Map<string, string>();
  for (let index = 0; index < rest.length; index += 2) {
    const flag = rest[index];
    const value = rest[index + 1];
    const key = flag?.slice(2);
    if (
      !flag?.startsWith("--") ||
      !key ||
      !allowed.includes(key) ||
      !value ||
      value.startsWith("--") ||
      options.has(key)
    )
      fail("invalid, duplicate or missing CLI option");
    options.set(key, value);
  }
  if (!allowed.length || allowed.some((key) => !options.has(key)))
    fail(
      "usage: export --locale <locale> --source-ref <40hex> --out <directory> | check --bundle <bundle.json> --decisions <decisions.json>",
    );
  if (mode === "export") {
    const bundle = await buildReviewBundle(
      options.get("locale")! as SupportedLocale,
      options.get("source-ref")!,
      root,
    );
    const out = resolve(root, options.get("out")!);
    await mkdir(out, { recursive: true });
    // Never overwrite decisions: a rerun must not erase a human's work or quietly rebind it.
    const decisionsPath = resolve(out, "decisions.json");
    if (existsSync(decisionsPath))
      fail("decisions.json already exists; choose a fresh output directory");
    await writeFile(decisionsPath, canonicalJson(createReviewDecisions(bundle)), { flag: "wx" });
    await writeFile(resolve(out, "bundle.json"), canonicalJson(bundle));
    await writeFile(resolve(out, "review.html"), renderReviewHtml(bundle));
    return {
      exitCode: 0,
      message: `Exported ${bundle.items.length} pending review items for ${bundle.locale} to ${out}. No acceptance recorded.`,
    };
  }
  const bundle = JSON.parse(await readFile(resolve(root, options.get("bundle")!), "utf8"));
  const decisions = JSON.parse(await readFile(resolve(root, options.get("decisions")!), "utf8"));
  const result = await validateCurrentReview(bundle, decisions, root);
  return {
    exitCode: result.complete ? 0 : 2,
    message: `${result.accepted} accepted / ${result.pending} pending / ${result.needsChange} needs change. ${result.referenceOnly ? "English reference only." : "Recorded human decisions only."} Native quality and release acceptance are not established; no gates updated.`,
  };
}

if (process.argv[1]?.replaceAll("\\", "/").endsWith("/localization-review.ts")) {
  runLocalizationReview(process.argv.slice(2))
    .then((result) => {
      process.stdout.write(`${result.message}\n`);
      process.exitCode = result.exitCode;
    })
    .catch((error: unknown) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    });
}
