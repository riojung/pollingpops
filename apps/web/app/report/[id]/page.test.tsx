import type * as ReactModule from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  LegacyReportSchema,
  ReportV7Schema,
  type Report,
  type ResponseDistribution,
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

beforeEach(() => {
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

async function renderReport(report: Report, uxBeta = false) {
  fixtures.apiFetch.mockImplementation(async (path: string) =>
    path === "/v1/auth/me"
      ? { productFeatures: { uxBeta, workspaceShell: false } }
      : { report, entitlements: null, followup: null },
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
