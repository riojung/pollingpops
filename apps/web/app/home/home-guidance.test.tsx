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
