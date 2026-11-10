import type * as ReactModule from "react";
import type * as LocaleModule from "../../../components/locale-provider";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  LegacyReportSchema,
  ReportV7Schema,
  type Report,
  type ResponseDistribution,
  type SupportedLocale,
} from "@openround/contracts";
import type * as ApiModule from "../../../lib/api";
import { withEnglishLocale } from "../../../test-utils/english-locale";
import ReportPage from "./page";

interface ReportHooks {
  cursor: number;
  slots: unknown[];
  effects: Array<() => unknown>;
}

const fixtures = vi.hoisted(() => ({
  hooks: null as ReportHooks | null,
  apiFetch: vi.fn(),
  locale: "en-CA" as SupportedLocale,
}));

vi.mock("react", async (importOriginal) => {
  const react = await importOriginal<typeof ReactModule>();
  return {
    ...react,
    useState: <T,>(initial: T | (() => T)) => {
      const hooks = fixtures.hooks;
      if (!hooks) return react.useState(initial);
      const index = hooks.cursor++;
      if (!(index in hooks.slots))
        hooks.slots[index] = typeof initial === "function" ? (initial as () => T)() : initial;
      return [
        hooks.slots[index] as T,
        (next: T | ((current: T) => T)) => {
          hooks.slots[index] =
            typeof next === "function"
              ? (next as (current: T) => T)(hooks.slots[index] as T)
              : next;
        },
      ];
    },
    useEffect: (effect: () => unknown) => {
      if (fixtures.hooks) fixtures.hooks.effects.push(effect);
      else react.useEffect(effect as Parameters<typeof react.useEffect>[0]);
    },
  };
});

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "00000000-0000-4000-8000-000000000001" }),
  usePathname: () => "/report/00000000-0000-4000-8000-000000000001",
  useRouter: () => ({ replace: vi.fn() }),
}));
vi.mock("../../../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof ApiModule>()),
  apiFetch: fixtures.apiFetch,
}));

vi.mock("../../../components/locale-provider", async (importOriginal) => {
  const original = await importOriginal<typeof LocaleModule>();
  const { loadMessages, translate, localeDomains } = await import("../../../lib/i18n/catalog");
  const { supportedLocales } = await import("@openround/contracts");
  const messages = Object.fromEntries(
    await Promise.all(
      supportedLocales.map(async (locale) => [locale, await loadMessages(locale, localeDomains)]),
    ),
  );
  return {
    ...original,
    useLocale: () => ({
      locale: fixtures.locale,
      t: (key: Parameters<typeof translate>[1], values?: Record<string, string | number>) =>
        translate(messages[fixtures.locale]!, key, values),
    }),
  };
});

beforeEach(() => {
  fixtures.locale = "en-CA";
  fixtures.hooks = null;
  fixtures.apiFetch.mockReset();
});

const optionIds = ["00000000-0000-4000-8000-000000000010", "00000000-0000-4000-8000-000000000011"];
const distributions: Array<{ format: string; distribution: ResponseDistribution; result: string }> =
  [
    {
      format: "multiple-selection poll",
      distribution: {
        kind: "choice",
        respondents: 5,
        totalSelections: 8,
        percentBasis: "respondents",
        buckets: [
          { value: optionIds[0]!, label: "Practice", count: 5, percent: 100 },
          { value: optionIds[1]!, label: "Examples", count: 3, percent: 60 },
        ],
      },
      result: "Practice</span>: 5 (100% of respondents)",
    },
    {
      format: "ranking",
      distribution: {
        kind: "ranking",
        respondents: 5,
        rankCount: 2,
        totalRankings: 10,
        buckets: [
          {
            value: optionIds[0]!,
            label: "Practice",
            weightedScore: 9,
            rankedRespondents: 5,
            averageRank: 1.2,
          },
          {
            value: optionIds[1]!,
            label: "Examples",
            weightedScore: 6,
            rankedRespondents: 5,
            averageRank: 1.8,
          },
        ],
      },
      result: "<td>9</td><td>5</td><td>1.2</td>",
    },
    {
      format: "open text",
      distribution: {
        kind: "open_text",
        respondents: 5,
        entries: [
          { value: "Approved <script>plain text</script>" },
          { value: "More examples" },
          { value: "More practice" },
          { value: "Clear priorities" },
          { value: "Useful feedback" },
        ],
      },
      result: "Approved &lt;script&gt;plain text&lt;/script&gt;",
    },
    {
      format: "word cloud",
      distribution: {
        kind: "word_cloud",
        respondents: 5,
        buckets: [
          { value: "practice", label: "Practice", count: 3, percent: 60 },
          { value: "examples", label: "Examples", count: 2, percent: 40 },
        ],
      },
      result: 'scope="row" lang="">Practice</th><td>3</td>',
    },
  ];

function opinionReport(distribution?: ResponseDistribution, responses = 7): Report {
  return ReportV7Schema.parse({
    id: "00000000-0000-4000-8000-000000000001",
    sessionId: "00000000-0000-4000-8000-000000000002",
    schemaVersion: 7,
    status: "ready",
    generatedAt: "2026-10-13T12:00:00.000Z",
    expiresAt: "2026-11-13T12:00:00.000Z",
    metrics: {
      participantCount: 7,
      completedCount: 7,
      answerCount: responses,
      accuracyPercent: null,
    },
    questions: [
      {
        questionId: "00000000-0000-4000-8000-000000000003",
        prompt: "Share your priorities",
        responses,
        correct: null,
        accuracyPercent: null,
        difficult: false,
        responseDistribution: distribution,
      },
    ],
    participants: [],
    initialAccuracy: { correct: 0, responses: 0, percent: null },
    confidenceMatrix: [],
    misconceptions: [],
    interventions: [],
    recovery: [],
    unresolvedConcepts: [],
    participation: { participants: 7, respondents: 7, percent: 100 },
    responseTime: { responses, medianMs: 1000, p95Ms: 2000 },
    qna: { questions: 0, answered: 0, unresolved: 0 },
    participantFeedback: [],
    evidenceNote: "Opinion feedback only.",
    experience: { category: "general", preset: { id: "focus", version: 1 } },
    audiencePulse: {
      uniqueParticipants: 0,
      events: 0,
      bySignal: { got_it: 0, unsure: 0, need_example: 0, too_fast: 0 },
      contexts: [],
    },
    conversation: {
      messages: 0,
      uniqueContributors: 0,
      reactions: 0,
      reports: 0,
      removed: 0,
      moderationActions: 0,
      peakMessagesPerMinute: 0,
      transcriptAvailable: false,
    },
    decisionReplayAvailable: false,
    decisionReplayComplete: false,
    decisionTimeline: [],
  });
}

async function renderReport(
  report: Report,
  uxBeta = false,
  context?: {
    quizId: string;
    quizTitle: string;
    sessionCreatedAt: string;
    sessionUpdatedAt: string;
  },
) {
  fixtures.apiFetch.mockImplementation(async (path: string) =>
    path === "/v1/auth/me"
      ? { productFeatures: { uxBeta, workspaceShell: false } }
      : { report, entitlements: null, followup: null, context },
  );
  const hooks: ReportHooks = { cursor: 0, slots: [], effects: [] };
  const render = () => {
    hooks.cursor = 0;
    hooks.effects = [];
    fixtures.hooks = hooks;
    try {
      return ReportPage();
    } finally {
      fixtures.hooks = null;
    }
  };
  render();
  for (const effect of hooks.effects) effect();
  for (let index = 0; index < 8; index++) await Promise.resolve();
  if (uxBeta) hooks.slots[5] = "questions";
  return renderToStaticMarkup(withEnglishLocale(render()));
}

describe("Live Round opinion report compatibility", () => {
  it.each([
    [false, "en-CA", "Not measured"],
    [true, "en-CA", "Not measured"],
    [false, "ko-KR", "측정되지 않음"],
    [true, "ko-KR", "측정되지 않음"],
  ] as const)(
    "separates an unanswered assessment from an observed zero (beta=%s, locale=%s)",
    async (uxBeta, locale, unavailable) => {
      fixtures.locale = locale;
      const report = LegacyReportSchema.parse({
        ...opinionReport(),
        schemaVersion: 1,
        metrics: { participantCount: 1, completedCount: 1, answerCount: 1, accuracyPercent: 0 },
        questions: [
          {
            questionId: "00000000-0000-4000-8000-000000000003",
            prompt: "Missing assessment evidence",
            responses: 0,
            correct: 0,
            accuracyPercent: 0,
            difficult: true,
          },
          {
            questionId: "00000000-0000-4000-8000-000000000004",
            prompt: "Observed incorrect response",
            responses: 1,
            correct: 0,
            accuracyPercent: 0,
            difficult: true,
          },
        ],
      });
      const markup = await renderReport(report, uxBeta);
      const rows = markup.match(/<tr(?: [^>]*)?>[\s\S]*?<\/tr>/g) ?? [];
      const missing = rows.find((row) => row.includes("Missing assessment evidence"))!;
      const zero = rows.find((row) => row.includes("Observed incorrect response"))!;
      expect(missing).toContain(`<td>${unavailable}</td>`);
      expect(missing.match(/<td>(?:Not measured|측정되지 않음)<\/td>/g)).toHaveLength(2);
      expect(missing).not.toContain("<td>0%</td>");
      expect(missing).not.toContain(`<td>${locale === "en-CA" ? "Review" : "검토"}</td>`);
      expect(zero).toContain("<td>0%</td>");
      expect(zero).toContain(`<td>${locale === "en-CA" ? "Review" : "검토"}</td>`);
      if (locale === "en-CA") expect(markup).toContain("<strong>0%</strong><span>Accuracy</span>");
    },
  );

  it("does not assign accuracy or review needs when a legacy assessment has no responses", async () => {
    const report = LegacyReportSchema.parse({
      ...opinionReport(),
      schemaVersion: 1,
      metrics: { participantCount: 1, completedCount: 0, answerCount: 0, accuracyPercent: 0 },
      questions: [
        {
          questionId: "00000000-0000-4000-8000-000000000003",
          prompt: "Unanswered assessment",
          responses: 0,
          correct: 0,
          accuracyPercent: 0,
          difficult: true,
        },
      ],
    });
    const markup = await renderReport(report);
    expect(markup).toContain("<strong>—</strong><span>No assessed answers</span>");
    expect(markup).toContain("<strong>0</strong><span>Checkpoints needing review</span>");
    expect(markup).not.toContain("0%");
  });

  it("localizes report navigation and analysis while retaining authored question text", async () => {
    fixtures.locale = "fr-FR";
    const report = opinionReport(distributions[0]!.distribution);
    const markup = await renderReport(report, true);
    expect(markup).toContain("Gérer les données");
    expect(markup).toContain("Analyse des questions");
    expect(markup).toContain("Non noté");
    expect(markup).toContain(report.questions[0]!.prompt);
    expect(markup).not.toContain(">Manage data<");
    expect(markup).not.toContain(">Not scored<");
  });
  it.each([false, true])(
    "keeps missing evidence distinct from zero in the %s beta report",
    async (uxBeta) => {
      const report = ReportV7Schema.parse({
        ...opinionReport(),
        initialAccuracy: { correct: 0, responses: 1, percent: 0 },
      });
      const markup = await renderReport(report, uxBeta);
      expect(markup).not.toContain("0/0");
      expect(markup).toContain("Not measured");
      expect(markup).toContain("Fewer than five assessed responses");
      expect(markup).toContain('href="/results"');
      expect(markup).not.toContain(">Dashboard</a>");
      if (uxBeta) {
        expect(markup).toContain("No concept-level recovery evidence was recorded.");
        expect(markup).not.toContain("No authored concept remains unresolved");
      }
    },
  );

  it("keeps the session identity visible independently of UX flags", async () => {
    const markup = await renderReport(opinionReport(), false, {
      quizId: "source-round",
      quizTitle: "Original workshop",
      sessionCreatedAt: "2026-10-13T12:00:00Z",
      sessionUpdatedAt: "2026-10-13T13:00:00Z",
    });
    expect(markup).toContain('<h1 lang="">Original workshop</h1>');
    expect(markup).toContain('dateTime="2026-10-13T12:00:00Z"');
  });
  it.each(distributions)(
    "renders $format results in classic reports independently of UX beta",
    async ({ distribution, result }) => {
      const markup = await renderReport(opinionReport(distribution));
      expect(markup).toContain("Checkpoint analysis");
      expect(markup).toContain("<th>Distribution</th>");
      expect(markup).toContain(result);
      expect(markup).toContain("<td>Not scored</td>");
      if (distribution.kind === "open_text" || distribution.kind === "word_cloud")
        expect(markup).toContain("<summary>5 approved respondents</summary>");
    },
  );

  it.each(distributions)(
    "retains $format results in beta reports",
    async ({ distribution, result }) => {
      const markup = await renderReport(opinionReport(distribution), true);
      expect(markup).toContain("Question analysis");
      expect(markup).toContain(result);
    },
  );

  it("keeps absent distributions hidden instead of deriving them from response totals", async () => {
    const smallSample = await renderReport(opinionReport(undefined, 4));
    expect(smallSample).toContain("<td>Hidden below five responses</td>");
    const withheldText = await renderReport(opinionReport(undefined, 7));
    expect(withheldText).toContain("<td>Not available</td>");
    expect(withheldText).not.toContain("approved respondents");
    expect(withheldText).not.toContain("text-response-list");
  });

  it("keeps the existing classic layout for legacy assessed-only reports", async () => {
    const legacy = LegacyReportSchema.parse({
      ...opinionReport(),
      schemaVersion: 1,
      metrics: { participantCount: 7, completedCount: 7, answerCount: 7, accuracyPercent: 100 },
      questions: [
        {
          questionId: "00000000-0000-4000-8000-000000000003",
          prompt: "Which answer is correct?",
          responses: 7,
          correct: 7,
          accuracyPercent: 100,
          difficult: false,
          responseDistribution: distributions[0]!.distribution,
        },
      ],
    });
    const markup = await renderReport(legacy);
    expect(markup).toContain("Checkpoint analysis");
    expect(markup).toContain("<td>100%</td>");
    expect(markup).not.toContain("<th>Distribution</th>");
    expect(markup).not.toContain("<details>");
  });
});
