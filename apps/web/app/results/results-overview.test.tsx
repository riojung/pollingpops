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
  it("keeps finished and active Presentation counts alongside their lifecycle signals", () => {
    const items = (["finished", "active"] as const).map((status) => ({
      id: status,
      presentationId: "presentation",
      title: "Presentation",
      status,
      phase: status === "finished" ? "finished" : "lobby",
      participantCount: 0,
      responseCount: 0,
      blockCount: 1,
      createdAt: "2026-10-01",
    }));
    const markup = renderToStaticMarkup(<ResultsOverview kind="presentations" items={items} />);
    expect(markup).toContain('data-status="finished" data-tone="neutral"');
    expect(markup).toContain('data-status="active" data-tone="active"');
    expect(markup).toContain('aria-hidden="true" data-status="finished"');
    expect(markup).toContain('aria-hidden="true" data-status="active"');
    expect(markup).toContain("Finished<strong>1</strong>");
    expect(markup).toContain("Active<strong>1</strong>");
    expect(markup).toContain('aria-valuenow="50"');
    expect(markup).toContain('aria-valuetext="1 / 2"');
    expect(markup).toContain("0<p>Across the Presentation sessions shown");
    expect(markup).not.toContain('data-tone="danger"');
  });
  it("labels Survey metadata as shown runs and identifies report-level response evidence", () => {
    const items = [
      {
        id: "run",
        surveyId: "survey",
        title: "Feedback",
        code: "123456",
        closed: true,
        closesAt: "2026-10-01",
        expiresAt: "2099-10-01",
      },
    ];
    const markup = renderToStaticMarkup(<ResultsOverview kind="surveys" items={items} hasMore />);
    expect(markup).toContain('aria-label="At a glance"');
    expect(markup).toContain("current filters");
    expect(markup).toContain("Survey runs shown");
    expect(markup).toContain("Response counts are available inside each Survey report.");
    expect(markup).toContain("Load more to expand this overview");
    expect(markup).not.toContain('role="meter"');
    expect(markup).not.toContain("participants");
  });
});
