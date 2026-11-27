import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../components/locale-provider", async () => {
  const { englishMessages, translate } = await import("../../lib/i18n/catalog");
  const { workspacePageEnglishMessages } = await import("../../lib/i18n/domains/workspace-pages");
  return {
    useLocale: () => ({
      locale: "en-CA",
      t: (key: Parameters<typeof translate>[1], values?: Record<string, string | number>) =>
        translate({ ...englishMessages, ...workspacePageEnglishMessages }, key, values),
    }),
  };
});

import { EvidenceMeter, ResultsOverview } from "./results-overview";

describe("Results overview widgets", () => {
  it("exposes measured zero as an accessible meter while missing evidence has no numeric meter", () => {
    const measured = renderToStaticMarkup(<EvidenceMeter label="Accuracy" value={0} />);
    expect(measured).toContain('role="meter"');
    expect(measured).toContain('aria-valuenow="0"');
    expect(measured).toContain("0%");
    const absent = renderToStaticMarkup(<EvidenceMeter label="Accuracy" value={null} />);
    expect(absent).not.toContain('role="meter"');
    expect(absent).toContain("No evidence recorded");
    expect(absent).not.toContain("0%");
  });
  it("uses full-history Presentation counts and links to loaded finished reports", () => {
    const items = (["finished", "active"] as const).map((status) => ({
      id: status,
      presentationId: "presentation",
      title: "Presentation",
      status,
      reportStatus: status === "finished" ? ("ready" as const) : null,
      phase: status === "finished" ? ("finished" as const) : ("lobby" as const),
      participantCount: status === "finished" ? 5 : 7,
      responseCount: 50,
      blockCount: 1,
      createdAt: "2026-10-01",
    }));
    const markup = renderToStaticMarkup(
      <ResultsOverview
        kind="presentations"
        items={items}
        analytics={{
          active: 8,
          finished: 17,
          participantJoins: 120,
          activity: {
            month: [{ start: "2026-10-01", count: 25 }],
            quarter: [{ start: "2026-10-01", count: 25 }],
          },
        }}
        onAnalyticsRetry={() => undefined}
        grouping="month"
        onGroupingChange={() => undefined}
      />,
    );
    expect(markup).toContain('data-status="finished" data-tone="neutral"');
    expect(markup).toContain('data-status="active" data-tone="active"');
    expect(markup).toContain('aria-hidden="true" data-status="finished"');
    expect(markup).toContain('aria-hidden="true" data-status="active"');
    expect(markup).toContain("Finished<strong>17</strong>");
    expect(markup).toContain("Active<strong>8</strong>");
    expect(markup).toContain('aria-valuenow="68"');
    expect(markup).toContain('aria-valuetext="17 / 25"');
    expect(markup).toMatch(/<dt>Matching sessions<\/dt><dd[^>]*>25</);
    expect(markup).toMatch(/<dt>Participant joins<\/dt><dd[^>]*>120</);
    expect(markup).toContain("Join records across matching sessions.");
    expect(markup).toContain("Grouped by session creation date in UTC.");
    expect(markup).toContain('href="/presentation-session/finished/report"');
    expect(markup).not.toContain('href="/presentation-session/active/report"');
    expect(markup).not.toContain('data-tone="danger"');
  });
  it("keeps ready and readable pending Presentation reports in the shortcuts despite newer failures", () => {
    const statuses = ["ready", "pending", "failed", "failed", "failed", null] as const;
    const items = statuses.map((reportStatus, index) => ({
      id: `session-${index + 1}`,
      presentationId: "presentation",
      title: `Presentation ${index + 1}`,
      status: "finished" as const,
      reportStatus,
      phase: "finished" as const,
      participantCount: 5,
      responseCount: 50,
      blockCount: 1,
      createdAt: `2026-10-0${index + 1}`,
    }));
    const markup = renderToStaticMarkup(
      <ResultsOverview
        kind="presentations"
        items={items}
        analytics="unavailable"
        onAnalyticsRetry={() => undefined}
        grouping="month"
        onGroupingChange={() => undefined}
      />,
    );
    expect(markup).toContain("Presentation totals and activity could not load.");
    expect(markup).toContain("Retry Presentation analytics");
    expect(markup).not.toContain("<dt>Matching sessions</dt>");
    expect(markup.match(/href="\/presentation-session\/session-\d\/report"/g)).toEqual([
      'href="/presentation-session/session-2/report"',
      'href="/presentation-session/session-1/report"',
    ]);
  });
  it("uses matching run and source totals without lifting response evidence out of Survey reports", () => {
    const items = [
      {
        id: "run",
        surveyId: "survey",
        title: "Feedback",
        code: "1234567",
        closesAt: "2026-10-01",
        expiresAt: "2099-10-01",
      },
    ];
    const markup = renderToStaticMarkup(
      <ResultsOverview
        kind="surveys"
        items={items}
        hasMore
        analytics={{
          rooms: 29,
          surveys: 4,
          refreshAfterMs: null,
          activity: {
            month: [{ start: "2026-10-01", count: 29 }],
            quarter: [{ start: "2026-10-01", count: 29 }],
          },
        }}
        onAnalyticsRetry={() => undefined}
        grouping="month"
        onGroupingChange={() => undefined}
      />,
    );
    expect(markup).toContain("Results analytics");
    expect(markup).toContain(
      "Totals and activity cover all closed Survey runs that match your filters and have retained results.",
    );
    expect(markup).toContain("<dt>Matching Survey runs</dt><dd>29</dd>");
    expect(markup).toMatch(/<dt>Surveys represented<\/dt><dd[^>]*>4<\/dd>/);
    expect(markup).toContain("Grouped by scheduled collection deadline in UTC.");
    expect(markup).toContain("Survey reports show results when privacy rules allow.");
    expect(markup).toContain('href="/results/surveys/run"');
    expect(markup).not.toContain("Load more to expand this overview");
    expect(markup).not.toContain('role="meter"');
    expect(markup).not.toContain("Participant joins");
  });
});
