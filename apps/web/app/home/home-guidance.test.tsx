import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { withEnglishLocale } from "../../test-utils/english-locale";
import type { HomeSummary } from "./home-model";
import { HomeGuidance } from "./home-guidance";

vi.mock("next/navigation", () => ({ usePathname: () => "/home" }));
const summary: HomeSummary = {
  generatedAt: "2026-11-09T00:00:00Z",
  recentArtifacts: [],
  sessions: [],
  assignments: [],
  resultHighlights: [],
  groupSchedule: [],
  totals: { artifacts: 0, activeSessions: 0, activeAssignments: 0, upcomingGroupItems: 0 },
};

describe("Home guidance feature availability", () => {
  it("offers granted goals before the first draft and removes them once work has begun", () => {
    const creationGoals = [{ kind: "quiz" as const, href: "/create?type=quiz" }];
    const render = (data: HomeSummary) =>
      renderToStaticMarkup(
        withEnglishLocale(
          <HomeGuidance
            summary={data}
            contextKey="owner:workspace"
            guideAvailable={false}
            creationGoals={creationGoals}
          />,
        ),
      );
    expect(render(summary)).toContain("Check understanding");
    expect(render(summary)).toContain('href="/create?type=quiz"');
    expect(render({ ...summary, totals: { ...summary.totals, artifacts: 1 } })).not.toContain(
      "Check understanding",
    );
  });
  it.each([true, false])(
    "links the professional quick-start guide only when available: %s",
    (guideAvailable) => {
      const markup = renderToStaticMarkup(
        withEnglishLocale(
          <HomeGuidance
            summary={summary}
            contextKey="owner:workspace"
            guideAvailable={guideAvailable}
          />,
        ),
      );
      expect(markup).toContain('href="/create"');
      expect(markup.includes('href="/help#quick-start"')).toBe(guideAvailable);
    },
  );
});
