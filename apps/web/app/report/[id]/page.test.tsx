import type * as ReactModule from "react";
import type * as LocaleModule from "../../../components/locale-provider";
import { isValidElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  LegacyReportSchema,
  ReportV7Schema,
  supportedLocales,
  type Report,
  type ResponseDistribution,
  type SupportedLocale,
} from "@openround/contracts";
import type * as ApiModule from "../../../lib/api";
import { withEnglishLocale } from "../../../test-utils/english-locale";
import ReportPage from "./page";
import { followupCopy } from "../../../lib/i18n/followup-copy";
import { AUTH_CHANGE_EVENT } from "../../../lib/api";

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

type TestElement = ReactModule.ReactElement<Record<string, unknown>>;
function findElement(
  tree: ReactModule.ReactNode,
  predicate: (node: TestElement) => boolean,
): TestElement | undefined {
  if (Array.isArray(tree)) return tree.map((node) => findElement(node, predicate)).find(Boolean);
  if (!isValidElement<Record<string, unknown>>(tree)) return undefined;
  return predicate(tree)
    ? tree
    : findElement(tree.props.children as ReactModule.ReactNode, predicate);
}

function hookView(renderComponent: () => ReactModule.ReactNode) {
  const hooks: ReportHooks = { cursor: 0, slots: [], effects: [] };
  return {
    render() {
      hooks.cursor = 0;
      hooks.effects = [];
      fixtures.hooks = hooks;
      try {
        return renderComponent();
      } finally {
        fixtures.hooks = null;
      }
    },
    async effects() {
      const cleanups = hooks.effects.map((effect) => effect());
      for (let index = 0; index < 12; index++) await Promise.resolve();
      return () =>
        cleanups.forEach((cleanup) => {
          if (typeof cleanup === "function") cleanup();
        });
    },
  };
}

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
    useRef: <T,>(initial: T) => {
      const hooks = fixtures.hooks;
      if (!hooks) return react.useRef(initial);
      const index = hooks.cursor++;
      if (!(index in hooks.slots)) hooks.slots[index] = { current: initial };
      return hooks.slots[index] as { current: T };
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
  vi.stubGlobal("window", new EventTarget());
});
afterEach(() => vi.unstubAllGlobals());

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
      ? { productFeatures: { uxBeta, workspaceShell: false }, creator: { role: "owner" } }
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

describe("report follow-up access management", () => {
  const followup = {
    id: "00000000-0000-4000-8000-000000000099",
    title: "Authored follow-up title",
    checkpointCount: 2,
    timeMode: "flex",
    closesAt: "2099-06-01T12:00:00.000Z",
    closedAt: null,
  };
  const personalPass = {
    id: "private-pass",
    nickname: "Participant 原名",
    label: "Stored label",
    timeMultiplier: 1.5,
    expiresAt: "2099-06-01T12:00:00.000Z",
    revokedAt: null,
  };
  const report = {
    ...opinionReport(),
    expiresAt: "2099-07-01T12:00:00.000Z",
    unresolvedConcepts: [
      { conceptKey: "Authored concept", initiallyIncorrect: 1, recovered: 0, unresolved: 1 },
    ],
  };
  async function load(role: string | undefined, existing = true, entitled = true) {
    fixtures.apiFetch.mockImplementation(async (path: string) => {
      if (path === "/v1/auth/me")
        return { creator: { role }, productFeatures: { uxBeta: false, workspaceShell: false } };
      if (path === `/v1/followups/${followup.id}`) return { access: [personalPass] };
      return {
        report,
        followup: existing ? followup : null,
        entitlements: { followups: entitled, csvExport: true, reportRetentionDays: 30 },
      };
    });
    const page = hookView(() => ReportPage());
    page.render();
    const cleanup = await page.effects();
    const tree = page.render();
    const element = findElement(
      tree,
      (node) => typeof node.type === "function" && node.type.name === "FollowupBuilder",
    )!;
    const builder = hookView(() =>
      (element.type as (props: Record<string, unknown>) => ReactModule.ReactNode)(element.props),
    );
    builder.render();
    await builder.effects();
    return { page, builder, tree, cleanup };
  }
  const markup = (tree: ReactModule.ReactNode) => renderToStaticMarkup(withEnglishLocale(tree));
  const action = (tree: ReactModule.ReactNode, text: string) =>
    findElement(tree, (node) => node.type === "button" && markup(node).includes(text))!;

  it.each(supportedLocales)(
    "renders accommodation/access state in %s while retaining authored content",
    async (locale) => {
      fixtures.locale = locale;
      const view = await load("owner");
      const html = markup(view.builder.render());
      const copy = followupCopy(locale);
      expect(html).toContain(copy("Accommodation pass label"));
      expect(html).toContain(copy("Create private pass"));
      expect(html).toContain(copy("Follow-up access passes"));
      expect(html).toContain(copy("Active"));
      expect(html).toContain('lang="">Participant 原名');
      expect(html).toContain(`value="${copy("Extended time")}"`);
      expect(html).toContain("Authored follow-up title");
      if (locale !== "en-CA") {
        expect(html).not.toContain("Accommodation pass label");
        expect(html).not.toContain("Links remain revocable.");
      }
      view.cleanup();
    },
  );

  it.each(["owner", "editor", "viewer", "unknown", undefined])(
    "uses canonical %s role for management and owner-only deletion",
    async (role) => {
      const view = await load(role);
      const html = markup(view.builder.render());
      expect(html.includes("Create private pass")).toBe(role === "owner" || role === "editor");
      expect(html.includes("Close follow-up for everyone")).toBe(
        role === "owner" || role === "editor",
      );
      expect(html.includes('class="danger-link"')).toBe(role === "owner" || role === "editor");
      expect(markup(view.tree).includes("Delete session and report")).toBe(role === "owner");
      expect(html).toContain("Participant 原名");
      expect(html).toContain("Authored follow-up title");
      view.cleanup();
    },
  );

  it("keeps a one-time private URL visible after blocked copy, without creating another pass", async () => {
    fixtures.locale = "fr-FR";
    const view = await load("editor");
    const form = findElement(view.builder.render(), (node) => node.type === "form")!;
    const privateUrl = "https://example.test/followup/private#token=one-time-secret";
    fixtures.apiFetch.mockResolvedValueOnce({
      access: { ...personalPass, id: "new-pass", url: privateUrl },
    });
    await (form.props.onSubmit as (event: { preventDefault: () => void }) => Promise<void>)({
      preventDefault() {},
    });
    const clipboard = vi.fn().mockRejectedValueOnce(new Error("denied"));
    vi.stubGlobal("navigator", { clipboard: { writeText: clipboard } });
    expect(markup(view.builder.render())).toContain(privateUrl);
    const copy = action(view.builder.render(), "Copie");
    await (copy.props.onClick as () => Promise<void>)();
    await Promise.resolve();
    const html = markup(view.builder.render());
    expect(clipboard).toHaveBeenCalledWith(privateUrl);
    expect(html).toContain('id="followup-private-url"');
    expect(html).toContain('for="followup-private-url"');
    expect(html).toContain(privateUrl);
    expect(html).toContain('role="alert"');
    expect(html).toContain('role="alert" lang="fr-FR"');
    expect(html).toContain("La copie a été bloquée.");
    expect(html).not.toContain("Clipboard access");
    expect(fixtures.apiFetch.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(
      1,
    );
    expect(
      JSON.parse(fixtures.apiFetch.mock.calls.find(([, init]) => init?.method === "POST")![1].body),
    ).toEqual({ label: "Temps supplémentaire", timeMultiplier: 1.5 });
    clipboard.mockResolvedValueOnce(undefined);
    await (action(view.builder.render(), "Copie").props.onClick as () => Promise<void>)();
    for (let index = 0; index < 5; index++) await Promise.resolve();
    fixtures.locale = "ko-KR";
    const changedLanguage = markup(view.builder.render());
    expect(changedLanguage).toContain("비공개 패스 링크를 복사했습니다.");
    expect(changedLanguage).not.toContain("La copie a été bloquée.");
    expect(changedLanguage).toContain(privateUrl);
    expect(fixtures.apiFetch.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(
      1,
    );
    view.cleanup();
  });

  it("associates the one-time generic URL with its label and preserves the selected creation payload", async () => {
    const view = await load("owner", false);
    const form = findElement(view.builder.render(), (node) => node.type === "form")!;
    const genericUrl = "https://example.test/followup/new#token=generic-secret";
    fixtures.apiFetch.mockResolvedValueOnce({ followup, genericUrl, personalAccess: [] });
    await (form.props.onSubmit as (event: { preventDefault: () => void }) => Promise<void>)({
      preventDefault() {},
    });
    const html = markup(view.builder.render());
    expect(html).toContain('for="followup-generic-url"');
    expect(html).toContain('id="followup-generic-url"');
    expect(html).toContain(genericUrl);
    expect(html).toContain("Save these links now.");
    expect(
      JSON.parse(fixtures.apiFetch.mock.calls.find(([, init]) => init?.method === "POST")![1].body),
    ).toMatchObject({ conceptKeys: ["Authored concept"], timeMode: "flex" });
    view.cleanup();
  });

  it("localizes destructive confirmations and sends no mutation when cancelled", async () => {
    fixtures.locale = "fr-FR";
    const view = await load("owner");
    const confirm = vi.fn<(message: string) => boolean>(() => false);
    Object.assign(window, { confirm });
    fixtures.apiFetch.mockClear();
    await (action(view.builder.render(), "Révoquer").props.onClick as () => Promise<void>)();
    await (
      action(view.builder.render(), "Fermer le suivi pour tous").props
        .onClick as () => Promise<void>
    )();
    expect(confirm.mock.calls.map(([message]) => message)).toEqual([
      "Révoquer cet accès au suivi ? La tentative associée ne fonctionnera plus.",
      "Fermer ce suivi pour tous les participants ?",
    ]);
    expect(fixtures.apiFetch).not.toHaveBeenCalled();
    view.cleanup();
  });

  it("retains safe pass rows after a failed refresh and provides a read-only retry and empty state", async () => {
    fixtures.locale = "ko-KR";
    const view = await load("editor");
    Object.assign(window, { confirm: () => true });
    fixtures.apiFetch.mockResolvedValueOnce(undefined);
    await (
      action(view.builder.render(), "모든 참가자의 후속 학습 마감").props
        .onClick as () => Promise<void>
    )();
    fixtures.apiFetch.mockRejectedValueOnce(new Error("Unknown access diagnostic 73"));
    view.builder.render();
    await view.builder.effects();
    const failed = markup(view.builder.render());
    expect(failed).toContain("Participant 原名");
    expect(failed).toContain('lang="en-CA">Unknown access diagnostic 73');
    const retry = action(view.builder.render(), "접근 패스 다시 불러오기");
    const callsBeforeRetry = fixtures.apiFetch.mock.calls.length;
    fixtures.apiFetch.mockResolvedValueOnce({ access: [] });
    (retry.props.onClick as () => void)();
    view.builder.render();
    await view.builder.effects();
    expect(fixtures.apiFetch.mock.calls.slice(callsBeforeRetry)).toEqual([
      [`/v1/followups/${followup.id}`],
    ]);
    expect(markup(view.builder.render())).toContain("생성된 개인 접근 패스가 없습니다.");
    view.cleanup();
  });

  it("shows an individual pass as expired and does not offer creation past report retention", async () => {
    const view = await load("owner");
    fixtures.apiFetch.mockResolvedValueOnce({
      access: [{ ...personalPass, expiresAt: "2000-01-01T00:00:00.000Z" }],
    });
    view.builder.render();
    await view.builder.effects();
    expect(markup(view.builder.render())).toContain("Expired");
    view.cleanup();
    const now = vi.spyOn(Date, "now").mockReturnValue(Date.parse("2100-01-01T00:00:00.000Z"));
    try {
      const expired = await load("owner", false);
      const html = markup(expired.builder.render());
      expect(html).toContain("The report retention deadline has passed.");
      expect(html).not.toContain("<form");
      expired.cleanup();
    } finally {
      now.mockRestore();
    }
  });

  it.each(supportedLocales)(
    "distinguishes the final-minute creation safety window from expiry in %s",
    async (locale) => {
      fixtures.locale = locale;
      const now = vi.spyOn(Date, "now").mockReturnValue(Date.parse(report.expiresAt) - 30_000);
      try {
        const view = await load("owner", false);
        const html = markup(view.builder.render());
        const copy = followupCopy(locale);
        expect(html).toContain(
          copy(
            "One minute or less remains before the report retention deadline. A new follow-up cannot be created.",
          ),
        );
        expect(html).not.toContain(
          copy("The report retention deadline has passed. A new follow-up cannot be created."),
        );
        expect(html).not.toContain("<form");
        view.cleanup();
      } finally {
        now.mockRestore();
      }
    },
  );

  it("keeps the existing one-minute creation cutoff", async () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(Date.parse(report.expiresAt) - 60_001);
    try {
      const before = await load("owner", false);
      expect(markup(before.builder.render())).toContain("<form");
      before.cleanup();
      now.mockReturnValue(Date.parse(report.expiresAt) - 60_000);
      const boundary = await load("owner", false);
      const html = markup(boundary.builder.render());
      expect(html).toContain("One minute or less remains");
      expect(html).not.toContain("<form");
      boundary.cleanup();
    } finally {
      now.mockRestore();
    }
  });

  it("localizes an untouched generated pass label but preserves authored edits across language changes", async () => {
    fixtures.locale = "fr-FR";
    const view = await load("editor");
    expect(markup(view.builder.render())).toContain('value="Temps supplémentaire"');
    fixtures.locale = "ko-KR";
    expect(markup(view.builder.render())).toContain('value="추가 시간"');
    const label = findElement(
      view.builder.render(),
      (node) => node.type === "input" && node.props.maxLength === 80,
    )!;
    (label.props.onChange as (event: { target: { value: string } }) => void)({
      target: { value: "Authored accommodation 原名" },
    });
    fixtures.locale = "de-DE";
    expect(markup(view.builder.render())).toContain('value="Authored accommodation 原名"');
    const form = findElement(view.builder.render(), (node) => node.type === "form")!;
    fixtures.apiFetch.mockResolvedValueOnce({
      access: {
        ...personalPass,
        label: "Authored accommodation 原名",
        id: "authored-pass",
        url: "https://example.test/followup/private#token=authored",
      },
    });
    await (form.props.onSubmit as (event: { preventDefault: () => void }) => Promise<void>)({
      preventDefault() {},
    });
    expect(
      JSON.parse(fixtures.apiFetch.mock.calls.find(([, init]) => init?.method === "POST")![1].body),
    ).toEqual({ label: "Authored accommodation 原名", timeMultiplier: 1.5 });
    fixtures.locale = "ja-JP";
    expect(markup(view.builder.render())).toContain('value="Authored accommodation 原名"');
    view.cleanup();
  });

  it("invalidates captured management/delete handlers immediately on an account change", async () => {
    const view = await load("owner");
    const create = findElement(view.builder.render(), (node) => node.type === "form")!;
    const close = action(view.builder.render(), "Close follow-up for everyone");
    const revoke = action(view.builder.render(), "Revoke");
    const remove = action(view.tree, "Delete session and report");
    const confirm = vi.fn(() => true);
    Object.assign(window, { confirm });
    fixtures.apiFetch.mockClear();
    window.dispatchEvent(new Event(AUTH_CHANGE_EVENT));
    await (create.props.onSubmit as (event: { preventDefault: () => void }) => Promise<void>)({
      preventDefault() {},
    });
    await (close.props.onClick as () => Promise<void>)();
    await (revoke.props.onClick as () => Promise<void>)();
    await (remove.props.onClick as () => Promise<void>)();
    expect(fixtures.apiFetch).not.toHaveBeenCalled();
    expect(confirm).not.toHaveBeenCalled();
    expect(markup(view.page.render())).not.toContain("Create private pass");
    view.cleanup();
  });

  it("does not let an old owner read re-enable management after a workspace change", async () => {
    let resolveOwner!: (account: unknown) => void;
    fixtures.apiFetch.mockImplementation((path: string) =>
      path === "/v1/auth/me"
        ? new Promise((resolve) => {
            resolveOwner = resolve;
          })
        : Promise.resolve({
            report,
            followup,
            entitlements: { followups: true, reportRetentionDays: 30 },
          }),
    );
    const page = hookView(() => ReportPage());
    page.render();
    const cleanup = await page.effects();
    window.dispatchEvent(new Event("polling-pops:workspace-updated"));
    resolveOwner({
      creator: { role: "owner" },
      productFeatures: { uxBeta: false, workspaceShell: false },
    });
    for (let index = 0; index < 8; index++) await Promise.resolve();
    const html = markup(page.render());
    expect(html).not.toContain("Create private pass");
    expect(html).not.toContain("Delete session and report");
    expect(html).not.toContain("Authored follow-up title");
    cleanup();
  });

  it("localizes entitlement guidance without enabling creation for viewers", async () => {
    fixtures.locale = "ko-KR";
    const view = await load("viewer", false, false);
    const html = markup(view.builder.render());
    expect(html).toContain("에디션 비교");
    expect(html).toContain("Hosted Pro");
    expect(html).not.toContain("<form");
    view.cleanup();
  });
});
