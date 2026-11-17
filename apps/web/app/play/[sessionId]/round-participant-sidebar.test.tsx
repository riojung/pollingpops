import type { SessionSnapshot } from "@openround/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { withEnglishLocale } from "../../../test-utils/english-locale";
import {
  participantSidebarKeyTarget,
  participantSidebarTabs,
  RoundParticipantSidebar,
} from "./round-participant-sidebar";

vi.mock("next/navigation", () => ({ usePathname: () => "/play/test-session" }));
const panels = vi.hoisted(() => ({ audience: vi.fn(), qna: vi.fn(), standings: vi.fn() }));
vi.mock("../../../components/audience-panel", () => ({
  AudiencePanel: (props: Record<string, unknown>) => {
    panels.audience(props);
    return <section data-testid="audience-panel" />;
  },
}));
vi.mock("../../../components/qna-panel", () => ({
  QnaPanel: (props: Record<string, unknown>) => {
    panels.qna(props);
    return <section data-testid="qna-panel" />;
  },
}));
vi.mock("../../../components/competition-dashboard", () => ({
  CompetitionDashboard: (props: Record<string, unknown>) => {
    panels.standings(props);
    return <section data-testid="competition-dashboard" />;
  },
}));

function snapshot(overrides: Partial<SessionSnapshot> = {}): SessionSnapshot {
  return {
    phase: "question_open",
    roundKind: "main",
    myParticipantId: "participant-test-id",
    myScoredResponseSummary: {
      answeredScoredQuestions: 1,
      correctScoredQuestions: 1,
      revealedScoredQuestions: 1,
    },
    competitionStandings: {
      status: "waiting",
      totalParticipants: 1,
      scoringMode: "accuracy",
      timeMode: "timed",
      completedScoredQuestions: 0,
      totalScoredQuestions: 2,
      tieBreak: "score_correct",
      entries: [],
    },
    ...overrides,
  } as SessionSnapshot;
}

function render(state = snapshot()) {
  return renderToStaticMarkup(
    withEnglishLocale(
      <RoundParticipantSidebar
        snapshot={state}
        sessionId="test-session"
        token="test-credential"
        audiencePanelKey="test-session:participant"
        realtimeBatch={null}
        audienceSyncRevision={3}
        qnaRevision={4}
      />,
    ),
  );
}

beforeEach(() => vi.clearAllMocks());

describe("participant side rail visibility", () => {
  it("never infers public standings from the private participant score", () => {
    const state = snapshot({ competitionStandings: undefined });
    expect(participantSidebarTabs(state)).toEqual(["qna", "pulse", "chat"]);
    const markup = render(state);
    expect(markup).not.toContain(">Standings</button>");
    expect(panels.standings).not.toHaveBeenCalled();
  });

  it("keeps lobby, interventions and rechecks free of the main competition", () => {
    for (const overrides of [
      { phase: "lobby" },
      { phase: "intervention" },
      { roundKind: "linked_recheck" },
    ] as Partial<SessionSnapshot>[]) {
      expect(participantSidebarTabs(snapshot(overrides))).toEqual(["qna", "pulse", "chat"]);
    }
  });

  it("keeps released standings available through open, locked and review states", () => {
    for (const phase of [
      "question_open",
      "question_locked",
      "question_reveal",
      "leaderboard",
      "paused",
    ] as const) {
      expect(participantSidebarTabs(snapshot({ phase }))).toEqual([
        "standings",
        "qna",
        "pulse",
        "chat",
      ]);
    }
  });

  it("ends Pulse/chat while preserving final standings and Q&A", () => {
    const state = snapshot({ phase: "finished", roundKind: "linked_recheck" });
    expect(participantSidebarTabs(state)).toEqual(["standings", "qna"]);
    render(state);
    expect(panels.audience).not.toHaveBeenCalled();
    expect(panels.standings).toHaveBeenCalledWith(
      expect.objectContaining({ finished: true, compact: false }),
    );
    expect(panels.qna).toHaveBeenCalledOnce();
  });

  it("passes private receipts, participant authorization and realtime revisions through", () => {
    const state = snapshot();
    render(state);
    expect(panels.standings).toHaveBeenCalledWith(
      expect.objectContaining({
        variant: "participant",
        participantId: state.myParticipantId,
        responseSummary: state.myScoredResponseSummary,
        standings: state.competitionStandings,
        compact: true,
      }),
    );
    expect(panels.qna).toHaveBeenCalledWith(
      expect.objectContaining({ role: "participant", revision: 4, token: "test-credential" }),
    );
    expect(panels.audience).toHaveBeenCalledWith(
      expect.objectContaining({
        role: "participant",
        syncRevision: 3,
        realtimeBatch: null,
        token: "test-credential",
      }),
    );
    expect(panels.audience).toHaveBeenCalledOnce();
  });
});

describe("participant side rail accessibility", () => {
  it("exposes a single selected tab and connects every tab to an existing panel", () => {
    const markup = render();
    const tabs = markup.match(/<button\b[^>]*role="tab"[^>]*>[\s\S]*?<\/button>/g) ?? [];
    expect(tabs).toHaveLength(4);
    expect(tabs.filter((tab) => tab.includes('aria-selected="true"'))).toHaveLength(1);
    expect(tabs.filter((tab) => tab.includes('tabindex="0"'))).toHaveLength(1);
    expect(tabs.find((tab) => tab.includes('aria-selected="true"'))).toContain(
      ">Standings</button>",
    );
    for (const tab of tabs) {
      const target = tab.match(/aria-controls="([^"]+)"/)?.[1];
      expect(target).toBeTruthy();
      expect(markup).toContain(`id="${target}"`);
    }
    expect(markup.match(/ hidden=""/g)).toHaveLength(2);
    // Both tools stay mounted while hidden; changing tabs must not discard a draft.
    expect(panels.qna).toHaveBeenCalledOnce();
    expect(panels.audience).toHaveBeenCalledOnce();
  });

  it("selects Q&A when standings are not available", () => {
    const markup = render(snapshot({ phase: "lobby" }));
    const selectedTab = markup.match(
      /<button\b[^>]*aria-selected="true"[^>]*>[\s\S]*?<\/button>/,
    )?.[0];
    expect(selectedTab).toContain(">Q&amp;A</button>");
    expect(markup.match(/ hidden=""/g)).toHaveLength(1);
  });

  it("supports roving arrow, Home and End keys across the actual available tabs", () => {
    const tabs = participantSidebarTabs(snapshot());
    expect(participantSidebarKeyTarget(tabs, "standings", "ArrowLeft")).toBe("chat");
    expect(participantSidebarKeyTarget(tabs, "chat", "ArrowRight")).toBe("standings");
    expect(participantSidebarKeyTarget(tabs, "qna", "ArrowRight")).toBe("pulse");
    expect(participantSidebarKeyTarget(tabs, "pulse", "Home")).toBe("standings");
    expect(participantSidebarKeyTarget(tabs, "qna", "End")).toBe("chat");
    expect(participantSidebarKeyTarget(["qna"], "qna", "ArrowLeft")).toBe("qna");
    expect(participantSidebarKeyTarget(["qna"], "qna", "Enter")).toBeNull();
    expect(participantSidebarKeyTarget(["qna"], "chat", "ArrowRight")).toBeNull();
  });
});
