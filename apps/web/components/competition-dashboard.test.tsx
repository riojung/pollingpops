import type { CompetitionStandings } from "@openround/contracts";
import { supportedLocales } from "@openround/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { competitionCopies, competitionPlace, competitionText } from "../lib/i18n/competition-copy";
import { withEnglishLocale } from "../test-utils/english-locale";
import {
  CompetitionDashboard,
  getCompetitionMotionPreference,
  type CompetitionDashboardProps,
} from "./competition-dashboard";

vi.mock("next/navigation", () => ({ usePathname: () => "/play/test-session" }));

function fixture(): CompetitionStandings {
  return {
    status: "live",
    totalParticipants: 6,
    scoringMode: "accuracy",
    timeMode: "timed",
    completedScoredQuestions: 2,
    totalScoredQuestions: 4,
    tieBreak: "score_correct_time",
    entries: ["Ada", "Bea", "Cy", "Dee", "Eli", "Fay"].map((nickname, index) => ({
      id: `person-${index}`,
      nickname,
      avatarId: "owl",
      score: 2_000 - index * 250,
      rank: index + 1,
      previousRank: index === 1 ? 4 : index + 1,
      tied: false,
      pointsToLeader: index * 250,
      pointsToNextRank: index === 0 ? null : 250,
    })),
  };
}

function render(
  standings: CompetitionStandings,
  props: Omit<CompetitionDashboardProps, "standings"> = {},
) {
  return renderToStaticMarkup(
    withEnglishLocale(<CompetitionDashboard standings={standings} {...props} />),
  );
}

describe("competition dashboard", () => {
  it("provides the page heading when standings replace the question stage", () => {
    const markup = render(fixture(), { headingLevel: 1 });
    expect(markup).toMatch(/<h1[^>]*>Race to the top<\/h1>/);
  });

  it("shows explicit top-three places and accessible expandable full standings", () => {
    const markup = render(fixture(), { compact: true });
    expect(markup).toContain("Race to the top");
    expect(markup).toContain('data-testid="competition-podium"');
    for (const rank of [1, 2, 3]) expect(markup).toContain(`data-rank="${rank}"`);
    for (const place of ["1st", "2nd", "3rd"]) expect(markup).toContain(place);
    expect(markup).toContain('aria-label="Top three places"');
    expect(markup).toContain('<th scope="col">Position</th>');
    expect(markup).toContain('scope="row"');
    expect(markup).toMatch(/<details[^>]*><summary>All standings/);
    expect(markup).not.toMatch(/<details[^>]*open/);
    expect(markup).toContain("Fay");
    expect(markup).toContain("2 of 4 scored questions revealed");
    expect(markup).toContain("Standings include revealed questions only.");
  });

  it("keeps compact host standings on stage with a disclosed detailed view", () => {
    const markup = render(fixture(), { compact: true, summary: true, variant: "host" });
    expect(markup).toContain('data-summary="true"');
    expect(markup).toContain("Race to the top");
    expect(markup).toMatch(/<details[^>]*><summary>All standings/);
    expect(markup).not.toMatch(/<details[^>]*open/);
    // The expanded view preserves every participant and the actual score policy.
    expect(markup).toContain("Ada");
    expect(markup).toContain("Fay");
    expect(markup).toContain("Standings include revealed questions only.");
    expect(markup).toContain('data-testid="competition-race"');
  });

  it("discloses projector effects and score policy while keeping participant controls direct", () => {
    const presenter = render(fixture(), { variant: "presenter", finished: true });
    expect(presenter).toMatch(/<details[^>]*data-testid="competition-display-options"/);
    expect(presenter).not.toMatch(
      /<details[^>]*data-testid="competition-display-options"[^>]*open/,
    );
    expect(presenter).toContain('data-testid="competition-replay"');
    expect(presenter).toContain("Standings include revealed questions only.");
    const participant = render(fixture(), { variant: "participant", finished: true });
    expect(participant).not.toContain('data-testid="competition-display-options"');
    expect(participant).toContain('data-testid="competition-motion-toggle"');
  });

  it("supports a primary host results heading when standings occupy the stage", () => {
    const markup = render(fixture(), { variant: "host", finished: true, headingLevel: 1 });
    expect(markup).toMatch(/<h1[^>]*>Final standings<\/h1>/);
  });

  it("keeps final podium and personal chase context, including actual movement", () => {
    const standings = fixture();
    standings.status = "final";
    standings.completedScoredQuestions = 4;
    const markup = render(standings, { participantId: "person-1" });
    expect(markup).toContain('data-status="final"');
    expect(markup).toContain("Final standings");
    expect(markup).toContain('data-testid="competition-personal"');
    expect(markup).toContain("Your position");
    expect(markup).toContain('aria-label="Up 2 places"');
    expect(markup).toContain("Points behind leader");
    expect(markup).toContain("Points to next place");
    expect(markup).toContain("1,750");
    expect(markup).toContain("250");
    expect(markup).toContain("Standings include revealed questions only.");
  });

  it("marks merit ties without presenting an arbitrary sole winner", () => {
    const standings = fixture();
    standings.entries[0]!.tied = true;
    standings.entries[1] = {
      ...standings.entries[1]!,
      score: 2_000,
      tied: true,
      pointsToLeader: 0,
      pointsToNextRank: 0,
    };
    standings.tieBreak = "score_correct";
    standings.timeMode = "flex";
    const markup = render(standings, { participantId: "person-1" });
    expect(markup).toContain("Tied");
    expect(markup).toContain("Tied results retain a stable display order.");
    expect(markup).toContain("Time does not break ties.");
    expect(markup).not.toContain("Winner");
    expect(markup).not.toContain("Champion");
  });

  it("does not invent a podium or personal winner for unscored opinion polls", () => {
    const standings = fixture();
    standings.status = "unscored";
    standings.completedScoredQuestions = 0;
    standings.totalScoredQuestions = 0;
    const markup = render(standings, { participantId: "person-0" });
    expect(markup).toContain("Everyone&#x27;s voice counts");
    expect(markup).toContain("There are no points, places or winners.");
    expect(markup).not.toContain('data-testid="competition-podium"');
    expect(markup).not.toContain('data-testid="competition-personal"');
    expect(markup).not.toContain("<table");
    expect(markup).not.toContain("Ada");
  });

  it("waits for a released scored question and handles an empty or early-ended session", () => {
    const standings = fixture();
    standings.completedScoredQuestions = 0;
    standings.status = "waiting";
    const waitingMarkup = render(standings);
    expect(waitingMarkup).toContain("Getting ready");
    expect(waitingMarkup).toContain("The race starts after the first scored question is revealed.");
    expect(waitingMarkup).not.toContain('data-testid="competition-podium"');
    expect(waitingMarkup).not.toContain("<table");
    standings.status = "live";
    standings.completedScoredQuestions = 1;
    standings.entries = [];
    expect(render(standings)).not.toContain('data-testid="competition-podium"');
  });

  it("ends an unrevealed competition truthfully without inventing winners or waiting for another question", () => {
    const standings = fixture();
    standings.status = "waiting";
    standings.completedScoredQuestions = 0;
    const markup = render(standings, { finished: true, participantId: "person-0" });
    expect(markup).toContain('data-status="final"');
    expect(markup).toContain("Final standings");
    expect(markup).toContain("No scored results were revealed.");
    expect(markup).not.toContain("Getting ready");
    expect(markup).not.toContain("The race starts");
    expect(markup).not.toContain('data-testid="competition-podium"');
    expect(markup).not.toContain('data-testid="competition-personal"');
    expect(markup).not.toContain("<table");
    standings.status = "unscored";
    const unscoredMarkup = render(standings, { finished: true });
    expect(unscoredMarkup).toContain("There are no points, places or winners.");
    expect(unscoredMarkup).not.toContain("No scored results were revealed.");
    expect(unscoredMarkup).not.toContain('data-testid="competition-podium"');
  });

  it("does not display a negative chase gap and distinguishes no prior rank", () => {
    const standings = fixture();
    standings.entries[1] = {
      ...standings.entries[1]!,
      previousRank: null,
      pointsToLeader: -5,
      pointsToNextRank: -10,
    };
    const markup = render(standings, { participantId: "person-1" });
    expect(markup).toContain('aria-label="First standings"');
    expect(markup).not.toContain(">-5<");
    expect(markup).not.toContain(">-10<");
    const leaderMarkup = render(standings, { participantId: "person-0" });
    expect(leaderMarkup).toContain("Leading group");
  });

  it("escapes participant aliases and avoids a full-list toggle for a small room", () => {
    const standings = fixture();
    standings.entries = standings.entries.slice(0, 2);
    standings.totalParticipants = 2;
    standings.entries[0]!.nickname = '<img src=x onerror="alert(1)">';
    const markup = render(standings);
    expect(markup).toContain("&lt;img");
    expect(markup).not.toContain("<img src=x");
    expect(markup).not.toContain("All standings");
  });

  it("shows real score comparisons, climb recognition and accessible view controls", () => {
    const standings = fixture();
    standings.entries[1]!.lastScoreDelta = 1_000;
    standings.entries[1]!.correctStreak = 2;
    const markup = render(standings, { participantId: "person-1", variant: "participant" });
    expect(markup).toContain('data-testid="competition-race"');
    expect(markup).toContain('data-testid="competition-spotlight"');
    expect(markup).toContain("Biggest climb");
    expect(markup).toContain("Bea · places gained: 2");
    expect(markup).toContain('aria-label="Bea: 1,750 points, 88% of the leading score."');
    expect(markup).toContain("Last scored question");
    expect(markup).toContain("+1,000 points");
    expect(markup).toContain('aria-label="Correct streak: 2 in a row"');
    expect(markup).toContain('aria-label="Scoreboard view"');
    expect(markup).toContain('aria-pressed="true">Race view');
    expect(markup).toContain('aria-pressed="false">Table view');
  });

  it("does not invent score gains, streaks or full bars from missing history or all-zero points", () => {
    const standings = fixture();
    for (const entry of standings.entries) {
      entry.score = 0;
      entry.previousRank = null;
      entry.tied = true;
    }
    const markup = render(standings, { participantId: "person-0", finished: true });
    expect(markup).not.toContain('data-testid="competition-question-gain"');
    expect(markup).not.toContain('data-testid="competition-streak"');
    expect(markup).not.toContain("Top finisher");
    expect(markup).not.toContain("Biggest climb");
    expect(markup).toContain('style="width:0%"');
    expect(markup).not.toContain('style="width:100%"');
    expect(markup).not.toContain("A finish worth sharing");
    expect(markup).not.toContain('data-testid="competition-celebration"');
    expect(markup).not.toContain('data-testid="competition-spotlight"');
    expect(markup).not.toContain('data-testid="competition-replay"');
    expect(markup).toContain('data-motion="off"');
    expect(markup).not.toContain('data-testid="competition-podium"');
    expect(markup).toContain('data-testid="competition-zero-points"');
    expect(markup).toContain("No points earned from revealed scored questions.");
    expect(markup).toContain("<table");
    expect(markup).toContain("Final standings");
  });

  it("shows the participant's own saved-answer receipt without inferring it from points", () => {
    const standings = fixture();
    standings.entries[1]!.score = 0;
    const markup = render(standings, {
      participantId: "person-1",
      responseSummary: {
        answeredScoredQuestions: 1,
        correctScoredQuestions: 0,
        revealedScoredQuestions: 2,
      },
    });
    expect(markup).toContain('data-testid="scored-response-receipt"');
    expect(markup).toContain("1 / 2");
    expect(markup).toContain(
      "Your saved answers to the revealed scored questions were not correct.",
    );
    expect(markup).toContain('data-testid="competition-podium"');
    expect(markup).not.toContain('data-testid="competition-zero-points"');
    expect(render(standings, { participantId: "person-1" })).not.toContain(
      'data-testid="scored-response-receipt"',
    );
  });

  it("keeps zero-response results neutral while preserving the actual standings", () => {
    const standings = fixture();
    standings.status = "final";
    standings.entries = [
      {
        ...standings.entries[0]!,
        score: 0,
        previousRank: null,
      },
    ];
    standings.totalParticipants = 1;
    const markup = render(standings, {
      participantId: "person-0",
      responseSummary: {
        answeredScoredQuestions: 0,
        correctScoredQuestions: 0,
        revealedScoredQuestions: 2,
      },
    });
    expect(markup).toContain("No answer was saved for the revealed scored questions.");
    expect(markup).toContain("No points earned from revealed scored questions.");
    expect(markup).toContain("Ada");
    expect(markup).toContain('data-testid="competition-race"');
    expect(markup).not.toContain('data-testid="competition-podium"');
    expect(markup).not.toContain('data-testid="competition-celebration"');
    expect(markup).not.toContain("Top finisher");
  });

  it("does not expose an own-answer receipt on a staff surface", () => {
    const markup = render(fixture(), {
      participantId: "person-0",
      variant: "host",
      responseSummary: {
        answeredScoredQuestions: 0,
        correctScoredQuestions: 0,
        revealedScoredQuestions: 2,
      },
    });
    expect(markup).not.toContain('data-testid="scored-response-receipt"');
  });

  it("does not award a climb spotlight for a zero-gain or unknown-history rank change", () => {
    const standings = fixture();
    standings.entries[1]!.lastScoreDelta = 0;
    expect(render(standings)).not.toContain("Biggest climb");
    delete standings.entries[1]!.lastScoreDelta;
    expect(render(standings)).not.toContain("Biggest climb");
    standings.entries[1]!.lastScoreDelta = 250;
    expect(render(standings)).toContain("Biggest climb");
  });

  it("keeps decorative celebration separate from immediately accessible final results", () => {
    const standings = fixture();
    standings.status = "final";
    const markup = render(standings, { variant: "presenter" });
    expect(markup).toContain(
      'data-testid="competition-celebration" data-replay="0" aria-hidden="true"',
    );
    expect(markup).toContain('data-testid="competition-replay"');
    expect(markup).toContain("Replay celebration");
    expect(markup).toContain("Top finisher");
    expect(markup).toContain("Ada");
    expect(markup).toContain("Final standings");
    expect(markup).toContain('data-motion="off"');
    expect(markup).not.toContain('aria-hidden="true">Ada');
    for (const status of ["waiting", "unscored"] as const) {
      const hidden = render(
        { ...standings, status, completedScoredQuestions: 0 },
        { finished: true },
      );
      expect(hidden).not.toContain('data-testid="competition-celebration"');
      expect(hidden).not.toContain('data-testid="competition-replay"');
    }
  });
});

describe("competition localization", () => {
  it("has a complete typed catalog for each interface locale and resolves progress placeholders", () => {
    expect(Object.keys(competitionCopies).sort()).toEqual([...supportedLocales].sort());
    for (const locale of supportedLocales) {
      expect(Object.keys(competitionCopies[locale]).sort()).toEqual(
        Object.keys(competitionCopies["en-CA"]).sort(),
      );
      expect(competitionText(locale, "progress", { completed: 2, total: 4 })).not.toMatch(/[{}]/);
      expect(competitionPlace(locale, 1)).toBeTruthy();
      expect(competitionText(locale, "upPlaces", { count: 2 })).not.toMatch(/[{}]/);
    }
  });

  it("formats meaningful ordinal places, including English teen exceptions", () => {
    expect([1, 2, 3, 11, 12, 13, 21].map((rank) => competitionPlace("en-CA", rank))).toEqual([
      "1st",
      "2nd",
      "3rd",
      "11th",
      "12th",
      "13th",
      "21st",
    ]);
    expect(competitionPlace("ko-KR", 2)).toBe("2위");
    expect(competitionPlace("zh-TW", 3)).toBe("第3名");
  });
});

describe("competition motion preferences", () => {
  afterEach(() => vi.unstubAllGlobals());
  function environment(stored: Record<string, string> = {}, system = false, app = "theme") {
    vi.stubGlobal("window", {
      matchMedia: () => ({ matches: system }),
      localStorage: { getItem: (key: string) => stored[key] ?? null },
    });
    vi.stubGlobal("document", { documentElement: { dataset: { openroundMotion: app } } });
  }
  it("honors system and saved app reduced motion before the decorative-effects choice", () => {
    environment({ "openround:competition-motion": "on" }, true);
    expect(getCompetitionMotionPreference()).toBe("reduced");
    environment({
      "openround:experience-preferences": JSON.stringify({ reducedMotion: true }),
      "openround:competition-motion": "on",
    });
    expect(getCompetitionMotionPreference()).toBe("reduced");
    environment({}, false, "reduced");
    expect(getCompetitionMotionPreference()).toBe("reduced");
    environment({ "openround:competition-motion": "off" });
    expect(getCompetitionMotionPreference()).toBe("off");
    environment();
    expect(getCompetitionMotionPreference()).toBe("on");
  });
  it("does not fail when a saved preference is malformed", () => {
    environment({ "openround:experience-preferences": "malformed" });
    expect(getCompetitionMotionPreference()).toBe("on");
    environment({
      "openround:experience-preferences": "malformed",
      "openround:competition-motion": "off",
    });
    expect(getCompetitionMotionPreference()).toBe("off");
  });
});
