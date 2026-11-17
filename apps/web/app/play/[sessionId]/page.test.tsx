import type * as ReactModule from "react";
import type * as RealtimeModule from "../../../lib/realtime";
import { renderToStaticMarkup } from "react-dom/server";
import { SessionSnapshotSchema, type SessionSnapshot } from "@openround/contracts";
import { resolveExperienceTheme } from "@openround/experience";
import { beforeEach, describe, expect, it, vi } from "vitest";
import PlayerPage from "./page";
import styles from "./participant-page.module.css";

const fixtures = vi.hoisted(() => ({
  renderingPage: false,
  stateIndex: 0,
  snapshot: null as SessionSnapshot | null,
  credential: "participant-credential",
}));

vi.mock("react", async (importOriginal) => {
  const react = await importOriginal<typeof ReactModule>();
  return {
    ...react,
    useState: <T,>(initial: T | (() => T)) => {
      if (!fixtures.renderingPage) return react.useState(initial);
      const index = fixtures.stateIndex++;
      return [
        index === 0 ? fixtures.snapshot : index === 9 ? fixtures.credential : initial,
        vi.fn(),
      ];
    },
    useRef: <T,>(initial: T) =>
      fixtures.renderingPage ? { current: initial } : react.useRef(initial),
    useMemo: <T,>(factory: () => T, dependencies: ReactModule.DependencyList) =>
      fixtures.renderingPage ? factory() : react.useMemo(factory, dependencies),
    useEffect: (effect: ReactModule.EffectCallback, dependencies?: ReactModule.DependencyList) =>
      fixtures.renderingPage ? undefined : react.useEffect(effect, dependencies),
  };
});
vi.mock("next/navigation", () => ({
  useParams: () => ({ sessionId: "participant-room" }),
  usePathname: () => "/play/participant-room",
}));
vi.mock("../../../components/locale-provider", async () => {
  const { loadMessages, translate } = await import("../../../lib/i18n/catalog");
  const messages = await loadMessages("en-CA", ["live-delivery"]);
  return {
    useLocale: () => ({
      locale: "en-CA",
      t: (key: Parameters<typeof translate>[1], values?: Record<string, string | number>) =>
        translate(messages, key, values),
    }),
  };
});
vi.mock("../../../lib/realtime", async (importOriginal) => ({
  ...(await importOriginal<typeof RealtimeModule>()),
  createRealtimeClient: () => ({}),
}));
vi.mock("../../../components/experience-preferences", () => ({
  ExperiencePreferences: () => null,
}));
vi.mock("../../../components/qna-panel", () => ({
  QnaPanel: () => <section data-testid="participant-qna" />,
}));
vi.mock("../../../components/audience-panel", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  AudiencePanel: () => <section data-testid="participant-audience" />,
}));

function snapshot(overrides: Partial<SessionSnapshot> = {}): SessionSnapshot {
  const entries = ["Ada", "Bea", "Cy"].map((nickname, index) => ({
    id: `11111111-1111-4111-8111-11111111111${index}`,
    nickname,
    avatarId: "owl",
    score: 2_000 - index * 500,
    rank: index + 1,
    previousRank: index + 1,
    tied: false,
    pointsToLeader: index * 500,
    pointsToNextRank: index === 0 ? null : 500,
  }));
  return SessionSnapshotSchema.parse({
    sessionId: "11111111-1111-4111-8111-111111111111",
    code: "1234567",
    version: 1,
    seq: 1,
    phase: "finished",
    roundId: null,
    roundKind: "main",
    questionIndex: null,
    questionCount: 2,
    question: null,
    deadline: null,
    participants: entries.map((entry) => ({ ...entry, connected: true })),
    competitionStandings: {
      status: "final",
      totalParticipants: entries.length,
      scoringMode: "accuracy",
      timeMode: "timed",
      completedScoredQuestions: 2,
      totalScoredQuestions: 2,
      tieBreak: "score_correct",
      entries,
    },
    answerCount: 3,
    lobbyLocked: false,
    settings: {
      audienceLimit: 20,
      scoringMode: "accuracy",
      resultVisibility: "leaderboard",
      allowLateJoin: true,
      nicknamePolicy: "friendly_only",
    },
    brandTheme: null,
    experienceTheme: resolveExperienceTheme({ category: "general", brandTheme: null }),
    pausedRemainingMs: null,
    myParticipantId: entries[0]!.id,
    myScoredResponseSummary: {
      answeredScoredQuestions: 2,
      correctScoredQuestions: 2,
      revealedScoredQuestions: 2,
    },
    ...overrides,
  });
}

function render(state = snapshot()) {
  fixtures.snapshot = state;
  fixtures.stateIndex = 0;
  fixtures.renderingPage = true;
  let tree;
  try {
    tree = PlayerPage();
  } finally {
    fixtures.renderingPage = false;
  }
  return renderToStaticMarkup(tree);
}

beforeEach(() => {
  fixtures.renderingPage = false;
  fixtures.credential = "participant-credential";
});

describe("participant final results stage", () => {
  it("shows the full final leaderboard before completion and outside the tools rail", () => {
    const markup = render();
    const [primary, sidebar] = markup.split(`<aside class="${styles.sidebar}"`);
    expect(primary).toContain('data-testid="participant-final-results"');
    expect(primary).toMatch(/<h1[^>]*>Final standings<\/h1>/);
    expect(primary).toContain('data-testid="competition-podium"');
    expect(primary).toContain('data-testid="competition-race"');
    expect(primary).toContain('data-testid="competition-replay"');
    expect(primary).not.toContain('role="tabpanel"');
    expect(primary).not.toContain(' hidden=""');
    expect(markup.indexOf('data-testid="competition-dashboard"')).toBeLessThan(
      markup.indexOf("Your final score is"),
    );
    expect(markup.match(/data-testid="scored-response-receipt"/g)).toHaveLength(1);
    expect(sidebar).toContain('data-testid="participant-qna"');
    expect(sidebar).not.toContain('data-testid="competition-dashboard"');
    expect(sidebar).not.toContain(' hidden=""');
  });

  it("does not require a sidebar credential to display already projected final results", () => {
    fixtures.credential = "";
    const markup = render();
    expect(markup).toContain('data-testid="participant-final-results"');
    expect(markup).not.toContain(`<aside class="${styles.sidebar}"`);
  });

  it("never reconstructs a public leaderboard from settings, roster or private score", () => {
    const markup = render(snapshot({ competitionStandings: undefined }));
    expect(markup).not.toContain('data-testid="competition-dashboard"');
    expect(markup).not.toContain("Bea");
    expect(markup).toContain("Your final score is 2,000.");
    expect(markup.match(/data-testid="scored-response-receipt"/g)).toHaveLength(1);
    expect(markup).toContain('data-testid="participant-qna"');
  });

  it("keeps compact live standings in the sidebar until the Round finishes", () => {
    const state = snapshot({ phase: "question_open" });
    state.competitionStandings!.status = "live";
    const markup = render(state);
    const [primary, sidebar] = markup.split(`<aside class="${styles.sidebar}"`);
    expect(primary).not.toContain('data-testid="competition-dashboard"');
    expect(sidebar).toContain('data-testid="competition-dashboard"');
    expect(sidebar).toContain('data-compact-participant="true"');
  });

  it("finishes an opinion-only Round without inventing scores or winners", () => {
    const state = snapshot();
    state.competitionStandings = {
      ...state.competitionStandings!,
      status: "unscored",
      entries: [],
      completedScoredQuestions: 0,
      totalScoredQuestions: 0,
    };
    state.participants = state.participants.map((entry) => ({ ...entry, score: 0 }));
    state.myScoredResponseSummary = {
      answeredScoredQuestions: 0,
      correctScoredQuestions: 0,
      revealedScoredQuestions: 0,
    };
    const markup = render(state);
    expect(markup).toContain('data-status="unscored"');
    expect(markup).toContain("Your accepted responses were recorded");
    expect(markup).not.toContain("Your final score");
    expect(markup).not.toContain('data-testid="competition-podium"');
    expect(markup).not.toContain('data-testid="scored-response-receipt"');
  });

  it("shows zero-point results and a personal receipt without a winner celebration", () => {
    const state = snapshot();
    state.competitionStandings!.entries = state.competitionStandings!.entries.map((entry) => ({
      ...entry,
      score: 0,
    }));
    state.participants = state.participants.map((entry) => ({ ...entry, score: 0 }));
    state.myScoredResponseSummary!.correctScoredQuestions = 0;
    const markup = render(state);
    expect(markup).toContain('data-testid="competition-zero-points"');
    expect(markup).toContain("Your final score is 0.");
    expect(markup).toContain(
      "Your saved answers to the revealed scored questions were not correct.",
    );
    expect(markup).not.toContain('data-testid="competition-podium"');
    expect(markup).not.toContain('data-testid="competition-celebration"');
  });

  it("ends an empty Round without inventing results or waiting for another question", () => {
    const state = snapshot({
      participants: [],
      myParticipantId: null,
      myScoredResponseSummary: undefined,
    });
    state.competitionStandings = {
      ...state.competitionStandings!,
      entries: [],
      totalParticipants: 0,
      completedScoredQuestions: 0,
    };
    const markup = render(state);
    expect(markup).toContain('data-testid="participant-final-results"');
    expect(markup).toContain("No scored results were revealed.");
    expect(markup).not.toContain("The race starts after");
    expect(markup).not.toContain("Your final score");
    expect(markup).not.toContain('data-testid="competition-podium"');
    expect(markup).not.toContain('data-testid="competition-personal"');
    expect(markup).not.toContain('data-testid="scored-response-receipt"');
  });

  it("keeps a one-person result personal without manufacturing a podium", () => {
    const state = snapshot();
    state.competitionStandings!.entries = state.competitionStandings!.entries.slice(0, 1);
    state.competitionStandings!.totalParticipants = 1;
    state.participants = state.participants.slice(0, 1);
    const markup = render(state);
    expect(markup).toContain('data-testid="participant-final-results"');
    expect(markup).toContain('data-testid="competition-personal"');
    expect(markup).toContain('data-testid="scored-response-receipt"');
    expect(markup).not.toContain('data-testid="competition-podium"');
  });
});
