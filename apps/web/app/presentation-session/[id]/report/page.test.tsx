import { type ReactElement, type ReactNode } from "react";
import type * as ReactModule from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PresentationReportSchema, type PresentationReportEnvelope } from "@openround/contracts";
import type * as ApiModule from "../../../../lib/api";
import { translate, type MessageKey } from "../../../../lib/i18n/catalog";
import { liveDeliveryEnglishMessages } from "../../../../lib/i18n/domains/live-delivery";
import PresentationReportPage from "./page";

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
  useParams: () => ({ id: "11111111-1111-4111-8111-111111111111" }),
  useRouter: () => ({ replace: vi.fn() }),
}));
vi.mock("../../../../components/locale-provider", () => ({
  useLocale: () => ({
    locale: "en-CA",
    t: (key: MessageKey, values?: Record<string, string | number>) =>
      translate(liveDeliveryEnglishMessages, key, values),
  }),
}));
vi.mock("../../../../components/workspace/workspace-provider", () => ({
  WorkspaceProvider: ({ children }: { children: ReactNode }) => children,
  useWorkspace: () => ({ productFeatures: { workspaceShell: false } }),
}));
vi.mock("../../../../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof ApiModule>()),
  apiFetch: fixtures.apiFetch,
}));
vi.mock("../../../../components/session-summary/summary-dialog", () => ({
  SessionSummaryButton: () => <button>Share summary</button>,
}));

beforeEach(() => {
  fixtures.hooks = null;
  fixtures.apiFetch.mockReset();
});

function reportFixture(schemaVersion: 1 | 2 | 3) {
  return PresentationReportSchema.parse({
    schemaVersion,
    sessionId: "11111111-1111-4111-8111-111111111111",
    artifactType: "presentation",
    presentationId: "22222222-2222-4222-8222-222222222222",
    presentationVersionId: "33333333-3333-4333-8333-333333333333",
    title: "A facilitated discussion",
    status: "finished",
    participantCount: 2,
    responseCount: 2,
    leaderboard: [],
    recovery: [],
    timeline: [],
    evidence: [
      {
        blockId: "44444444-4444-4444-8444-444444444444",
        blockIndex: 0,
        kind: "question",
        questionId: "55555555-5555-4555-8555-555555555555",
        prompt: "Which approach should we discuss?",
        questionType: "poll",
        questionTypeLabel: "Poll",
        delivery: "main",
        respondents: 2,
        correct: null,
        accuracyPercent: null,
        totalScore: 0,
        averageResponseMs: 1_000,
        ...(schemaVersion === 3 ? { sessionOnly: "quick_check" } : {}),
      },
    ],
    evidenceNote: "Participation evidence from the finished session.",
    createdAt: "2026-10-08T12:00:00.000Z",
    finishedAt: "2026-10-08T12:10:00.000Z",
  });
}

function reportHarness() {
  const hooks: ReportHooks = { cursor: 0, slots: [], effects: [] };
  const content = PresentationReportPage().props.children as ReactElement<
    Record<string, never>,
    () => ReactElement
  >;
  const render = () => {
    hooks.cursor = 0;
    hooks.effects = [];
    fixtures.hooks = hooks;
    try {
      return content.type();
    } finally {
      fixtures.hooks = null;
    }
  };
  render();
  hooks.effects[0]?.();
  return { render };
}

async function settle() {
  for (let index = 0; index < 8; index++) await Promise.resolve();
}

describe("Presentation Quick Check report compatibility", () => {
  it("offers sharing only when report generation is ready, even if a pending envelope contains evidence", async () => {
    vi.useFakeTimers();
    try {
      fixtures.apiFetch.mockResolvedValue({ reportStatus: "pending", report: reportFixture(1) });
      const harness = reportHarness();
      await settle();
      expect(renderToStaticMarkup(harness.render())).not.toContain("Share summary");
      fixtures.apiFetch.mockResolvedValue({ reportStatus: "ready", report: reportFixture(1) });
      await vi.advanceTimersByTimeAsync(1_000);
      expect(renderToStaticMarkup(harness.render())).toContain("Share summary");
    } finally {
      vi.useRealTimers();
    }
  });
  it.each([1, 2, 3] as const)(
    "opts into Quick Checks and renders V%s evidence with attribution only when marked",
    async (schemaVersion) => {
      fixtures.apiFetch.mockResolvedValue({
        reportStatus: "ready",
        report: reportFixture(schemaVersion),
        sessionContext: { timeMode: "flex" },
      });
      const harness = reportHarness();
      await settle();
      expect(fixtures.apiFetch.mock.calls[0]?.[0]).toBe(
        "/v1/presentation-sessions/11111111-1111-4111-8111-111111111111/report?includeSessionContext=true&includeQuickChecks=true",
      );
      const markup = renderToStaticMarkup(harness.render());
      expect(markup).toContain("Which approach should we discuss?");
      expect(markup).toContain("Flex — facilitator closes responses");
      expect(markup.includes("Session-only Quick Check · unscored")).toBe(schemaVersion === 3);
      expect(markup).not.toContain("Recovery evidence");
    },
  );

  it("renders a legacy API response that ignores opt-in queries and omits session context", async () => {
    const legacy: PresentationReportEnvelope = {
      reportStatus: "ready",
      report: reportFixture(1),
    };
    fixtures.apiFetch.mockResolvedValue(legacy);
    const harness = reportHarness();
    await settle();
    const markup = renderToStaticMarkup(harness.render());
    expect(markup).toContain("Which approach should we discuss?");
    expect(markup).toContain("Timed");
    expect(markup).not.toContain("Session-only Quick Check");
  });
});
