import { isValidElement, type ReactElement, type ReactNode } from "react";
import type * as ReactModule from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { PresentationSessionInsightsEnvelope, SupportedLocale } from "@openround/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiClientError } from "../../lib/api";
import type * as Client from "../../lib/presentation-session-insights-client";
import { presentationInsightsCopy } from "../../lib/i18n/presentation-insights-copy";
import {
  presentationInsightsCsv,
  presentationInsightsHtml,
} from "../../lib/presentation-session-insights-export";
import {
  insightsId,
  insightsSource,
  presentationInsightsFixture,
} from "../../lib/presentation-session-insights.test-fixtures";
import { PresentationInsightsDetails, PresentationSessionInsightsPanel } from "./session-insights";

interface Hooks {
  cursor: number;
  slots: unknown[];
  dependencies: Map<number, readonly unknown[] | undefined>;
  effects: Array<{ index: number; effect: ReactModule.EffectCallback }>;
  cleanups: Map<number, void | (() => void)>;
}
const mocked = vi.hoisted(() => ({
  hooks: null as Hooks | null,
  fetch: vi.fn(),
  download: vi.fn(),
  locale: "en-CA" as SupportedLocale,
}));
vi.mock("react", async (original) => {
  const react = await original<typeof ReactModule>();
  return {
    ...react,
    useId: () => (mocked.hooks ? "session-insights-title" : react.useId()),
    useRef: <T,>(initial: T) => {
      if (!mocked.hooks) return react.useRef(initial);
      const hooks = mocked.hooks,
        index = hooks.cursor++;
      hooks.slots[index] ??= { current: initial };
      return hooks.slots[index];
    },
    useState: <T,>(initial: T) => {
      if (!mocked.hooks) return react.useState(initial);
      const hooks = mocked.hooks,
        index = hooks.cursor++;
      if (!(index in hooks.slots)) hooks.slots[index] = initial;
      return [
        hooks.slots[index],
        (next: T | ((current: T) => T)) => {
          hooks.slots[index] =
            typeof next === "function"
              ? (next as (current: T) => T)(hooks.slots[index] as T)
              : next;
        },
      ];
    },
    useEffect: (effect: ReactModule.EffectCallback, dependencies?: readonly unknown[]) => {
      if (!mocked.hooks) return react.useEffect(effect, dependencies);
      const hooks = mocked.hooks,
        index = hooks.cursor++;
      const previous = hooks.dependencies.get(index);
      if (
        !hooks.dependencies.has(index) ||
        !dependencies ||
        dependencies.some((value, at) => value !== previous?.[at])
      )
        hooks.effects.push({ index, effect });
      hooks.dependencies.set(index, dependencies);
    },
  };
});
vi.mock("../locale-provider", () => ({ useLocale: () => ({ locale: mocked.locale }) }));
vi.mock("../../lib/presentation-session-insights-client", async (original) => ({
  ...(await original<typeof Client>()),
  fetchPresentationSessionInsights: mocked.fetch,
  downloadPresentationInsightsFile: mocked.download,
}));
const mounted = new Set<{ close: () => void }>();
function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement<Record<string, unknown>>(node)) return [];
  return [node, ...elements(node.props.children as ReactNode)];
}
function text(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(text).join("");
  return isValidElement<{ children?: ReactNode }>(node) ? text(node.props.children) : "";
}
function mount(canUseEvidence?: () => boolean) {
  const hooks: Hooks = {
    cursor: 0,
    slots: [],
    dependencies: new Map(),
    effects: [],
    cleanups: new Map(),
  };
  let source = { ...insightsSource },
    tree: ReactNode;
  const view = {
    render(nextSource = source) {
      source = nextSource;
      hooks.cursor = 0;
      hooks.effects = [];
      mocked.hooks = hooks;
      try {
        tree = PresentationSessionInsightsPanel({ source, canUseEvidence });
      } finally {
        mocked.hooks = null;
      }
      for (const { index, effect } of hooks.effects) {
        hooks.cleanups.get(index)?.();
        hooks.cleanups.set(index, effect());
      }
      return tree;
    },
    markup: () => renderToStaticMarkup(view.render()),
    click(label: string) {
      const button = elements(view.render()).find(
        (node) => node.type === "button" && text(node) === label,
      );
      expect(button).toBeDefined();
      (button!.props.onClick as () => void)();
      view.render();
    },
    close() {
      for (const cleanup of hooks.cleanups.values()) cleanup?.();
      hooks.cleanups.clear();
      mounted.delete(view);
    },
  };
  mounted.add(view);
  view.render();
  return view;
}
function setup() {
  mocked.locale = "en-CA";
  mocked.fetch
    .mockReset()
    .mockResolvedValue({ status: "ready", insights: presentationInsightsFixture() });
  mocked.download.mockReset().mockReturnValue(vi.fn());
}
async function settle() {
  for (let index = 0; index < 8; index++) await Promise.resolve();
}
function deferred() {
  let resolve!: (value: PresentationSessionInsightsEnvelope) => void;
  const promise = new Promise<PresentationSessionInsightsEnvelope>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}
afterEach(() => {
  for (const view of [...mounted]) view.close();
  mocked.hooks = null;
});

describe("additive Session insights panel", () => {
  it("rejects captured CSV and HTML callbacks when the report authority guard is invalidated", async () => {
    setup();
    let authorized = true;
    const view = mount(() => authorized);
    await settle();
    const callbacks = elements(view.render())
      .filter(
        (element) =>
          element.type === "button" &&
          ["Export coverage CSV", "Download readable summary"].includes(text(element)),
      )
      .map((element) => element.props.onClick as () => void);
    expect(callbacks).toHaveLength(2);
    authorized = false;
    for (const callback of callbacks) callback();
    expect(mocked.download).not.toHaveBeenCalled();
    expect(view.markup()).not.toContain("Download started.");
  });

  it("changes language around a pending read and download receipt without another read or download, retaining canonical export bytes", async () => {
    setup();
    const request = deferred();
    mocked.fetch.mockReturnValueOnce(request.promise);
    const view = mount();
    mocked.locale = "ko-KR";
    let copy = presentationInsightsCopy(mocked.locale);
    expect(view.markup()).toContain(copy("Loading session insights…"));
    expect(mocked.fetch).toHaveBeenCalledTimes(1);
    const value = presentationInsightsFixture();
    request.resolve({ status: "ready", insights: value });
    await settle();
    let markup = view.markup();
    expect(markup).toContain('lang="ko-KR"');
    expect(markup).toContain(copy("Session insights"));
    expect(markup).toContain(copy("Not recorded for this older activity"));
    expect(markup).not.toContain("Response coverage · Assessed activities");
    view.click(copy("Export coverage CSV"));
    expect(mocked.download).toHaveBeenLastCalledWith(
      presentationInsightsCsv(value, "ko-KR"),
      "csv",
    );
    mocked.locale = "de-DE";
    copy = presentationInsightsCopy(mocked.locale);
    markup = view.markup();
    expect(markup).toContain(copy("Download started. Downloaded copies cannot be revoked."));
    expect(mocked.fetch).toHaveBeenCalledTimes(1);
    expect(mocked.download).toHaveBeenCalledTimes(1);
    view.click(copy("Download readable summary"));
    expect(mocked.download).toHaveBeenLastCalledWith(
      presentationInsightsHtml(value, "de-DE"),
      "html",
    );
    expect(mocked.fetch).toHaveBeenCalledTimes(1);
  });

  it.each(["de-DE", "ko-KR"] as const)(
    "keeps authored collisions in their language while %s UI labels, statuses and missing values stay localized",
    (locale) => {
      const value = presentationInsightsFixture();
      value.delivery.blocks[0]!.title = "Content";
      value.delivery.blocks[2]!.title = "Presented {block} $&";
      value.delivery.sections[0]!.title = "Presented";
      value.participation.questions.find(
        (question) => question.purpose === "opinion",
      )!.results[0]!.label = "Not recorded";
      const copy = presentationInsightsCopy(locale);
      const markup = renderToStaticMarkup(
        <PresentationInsightsDetails insights={value} locale={locale} />,
      );
      expect(markup).toContain(`lang="${locale}"`);
      expect(markup).toContain('<th scope="row" lang="">1. Content</th>');
      expect(markup).toContain('<th scope="row" lang="">Presented</th>');
      expect(markup).toContain('<td lang="">Presented</td>');
      expect(markup).toContain(`<td>${copy("Content")}</td>`);
      expect(markup).toContain(`<td>${copy("Presented")}</td>`);
      expect(markup).toContain('<th scope="row" lang="">Not recorded</th>');
      expect(markup).toContain('<span lang="">3. Presented {block} $&amp;</span>');
      expect(markup).toContain(`<th scope="row">${copy("Not applicable")}</th>`);
      expect(markup).not.toContain(`<th scope="row" lang="">${copy("Not applicable")}</th>`);
    },
  );

  it("retranslates known download failures and retains unknown diagnostics in their original language", async () => {
    setup();
    mocked.download.mockImplementationOnce(() => {
      throw new Error("This summary exceeds the 1 MiB download limit. No file was downloaded.");
    });
    const view = mount();
    await settle();
    view.click("Download readable summary");
    mocked.locale = "ko-KR";
    let copy = presentationInsightsCopy(mocked.locale);
    expect(view.markup()).toContain(
      copy("This summary exceeds the 1 MiB download limit. No file was downloaded."),
    );
    expect(mocked.download).toHaveBeenCalledTimes(1);
    mocked.download.mockImplementationOnce(() => {
      throw new Error("Synthetic original diagnostic {amount} $&");
    });
    view.click(copy("Download readable summary"));
    mocked.locale = "de-DE";
    copy = presentationInsightsCopy(mocked.locale);
    const markup = view.markup();
    expect(markup).toContain(copy("Service message (original language)"));
    expect(markup).toContain(
      '<span lang="en-CA">Synthetic original diagnostic {amount} $&amp;</span>',
    );
    expect(mocked.download).toHaveBeenCalledTimes(2);
    expect(mocked.fetch).toHaveBeenCalledTimes(1);
  });

  it("loads once and labels the region, coverage, version, freshness and response denominators", async () => {
    setup();
    const view = mount();
    expect(view.markup()).toContain("Loading session insights");
    await settle();
    const markup = view.markup();
    expect(markup).toContain('aria-labelledby="session-insights-title"');
    expect(markup).toContain('<h2 id="session-insights-title">Session insights</h2>');
    expect(markup).toContain("Version 2");
    expect(markup).toContain("Report generated");
    expect(markup).toContain("Insights calculated");
    expect(markup).toContain("Participants joined by reveal");
    expect(markup).toContain("Not applicable · zero joined by reveal");
    expect(markup).toContain("Not recorded for this older activity");
    expect(markup).toContain("Hidden · fewer than 5 responses");
    expect(markup).toContain("Added during this session");
    expect(markup).toContain("not measure learner completion");
    expect(mocked.fetch).toHaveBeenCalledExactlyOnceWith(insightsSource, expect.any(AbortSignal));
  });
  it.each(["pending", "failed"] as const)(
    "offers explicit retry for %s without automatic polling",
    async (status) => {
      setup();
      mocked.fetch.mockResolvedValueOnce({ status, insights: null });
      const view = mount();
      await settle();
      expect(view.markup()).toContain("Retry insights");
      expect(view.markup()).not.toContain("Export coverage CSV");
      await settle();
      expect(mocked.fetch).toHaveBeenCalledTimes(1);
      view.click("Retry insights");
      await settle();
      expect(mocked.fetch).toHaveBeenCalledTimes(2);
      expect(view.markup()).toContain("Export coverage CSV");
    },
  );
  it.each([404, 501])(
    "keeps legacy report access available after unsupported HTTP %s",
    async (status) => {
      setup();
      mocked.fetch.mockRejectedValueOnce(
        new ApiClientError("Unavailable", "INSIGHTS_UNAVAILABLE", status),
      );
      const view = mount();
      await settle();
      expect(view.markup()).toContain("Additional insights are unavailable");
      expect(view.markup()).toContain("detailed report and summary controls remain available");
      expect(view.markup()).toContain("Retry insights");
      expect(view.markup()).not.toContain("Export coverage CSV");
    },
  );
  it("offers retry after transient failure and retains source binding", async () => {
    setup();
    mocked.fetch.mockRejectedValueOnce(new TypeError("Offline"));
    const view = mount();
    await settle();
    expect(view.markup()).toContain('role="alert"');
    view.click("Retry insights");
    await settle();
    expect(mocked.fetch.mock.calls.map((call) => call[0])).toEqual([
      insightsSource,
      insightsSource,
    ]);
    expect(view.markup()).toContain("Export coverage CSV");
  });
  it("aborts superseded loads and ignores late results for another version", async () => {
    setup();
    const old = deferred(),
      current = deferred();
    mocked.fetch.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
    const view = mount();
    const oldSignal = mocked.fetch.mock.calls[0]![1] as AbortSignal;
    const nextSource = { ...insightsSource, presentationVersionId: insightsId(90) };
    view.render(nextSource);
    expect(oldSignal.aborted).toBe(true);
    old.resolve({
      status: "ready",
      insights: { ...presentationInsightsFixture(), title: "STALE TITLE" },
    });
    await settle();
    expect(view.markup()).not.toContain("STALE TITLE");
    current.resolve({
      status: "ready",
      insights: {
        ...presentationInsightsFixture(),
        presentationVersionId: nextSource.presentationVersionId,
      },
    });
    await settle();
    expect(view.markup()).toContain("Export coverage CSV");
    const signal = mocked.fetch.mock.calls[1]![1] as AbortSignal;
    view.close();
    expect(signal.aborted).toBe(true);
  });
  it("downloads both copies from the displayed projection and releases their resources", async () => {
    setup();
    const release = vi.fn();
    mocked.download.mockReturnValue(release);
    const view = mount();
    await settle();
    view.click("Export coverage CSV");
    view.click("Download readable summary");
    expect(mocked.download.mock.calls.map((call) => call[1])).toEqual(["csv", "html"]);
    for (const [contents] of mocked.download.mock.calls) {
      expect(contents).toContain("Participants joined by reveal");
      expect(contents).toContain("Not recorded for this older activity");
      expect(contents).not.toMatch(/participantId|nickname|tokenHash/);
    }
    expect(release).toHaveBeenCalledTimes(1);
    view.close();
    expect(release).toHaveBeenCalledTimes(2);
  });
  it("announces a bounded-download failure without removing the insights", async () => {
    setup();
    mocked.download.mockImplementationOnce(() => {
      throw new Error("This summary exceeds the 1 MiB download limit.");
    });
    const view = mount();
    await settle();
    view.click("Download readable summary");
    expect(view.markup()).toContain("1 MiB download limit");
    expect(view.markup()).toContain("Response coverage");
  });
  it("keeps suppressed Q&A separate from a recorded zero", () => {
    const insights = presentationInsightsFixture();
    insights.qna = {
      status: "suppressed",
      asOf: null,
      audienceSeq: null,
      publicQuestionCount: null,
      answeredQuestionCount: null,
      unansweredQuestionCount: null,
      upvoteCount: null,
    };
    const markup = renderToStaticMarkup(<PresentationInsightsDetails insights={insights} />);
    expect(markup).toContain("Q&amp;A totals are hidden");
    expect(markup).not.toContain("Public questions</dt>");
    expect(markup).toContain("Recorded zero roster");
  });
  it("shows an explicit unavailable opinion distribution while preserving its recorded response coverage", () => {
    const insights = presentationInsightsFixture();
    const opinion = insights.participation.questions.find(
      (question) => question.purpose === "opinion",
    )!;
    opinion.distributionStatus = "unavailable";
    opinion.results = [];
    const markup = renderToStaticMarkup(<PresentationInsightsDetails insights={insights} />);
    expect(markup).toContain("Opinion distribution is unavailable for this activity.");
    expect(markup).toContain("Response coverage · Opinion activities");
    expect(markup).toContain("50%");
    expect(markup).not.toContain("Respondents selecting option");
  });
});
