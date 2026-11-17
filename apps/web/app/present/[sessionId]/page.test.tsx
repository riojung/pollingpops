import type * as ReactModule from "react";
import type * as RealtimeModule from "../../../lib/realtime";
import { renderToStaticMarkup } from "react-dom/server";
import { SessionSnapshotSchema, type BrandTheme, type SessionSnapshot } from "@openround/contracts";
import { resolveExperienceTheme } from "@openround/experience";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import liveTheme from "../../../components/round-live-theme.module.css";
import { experienceThemeStyle } from "../../../lib/theme";
import PresenterPage from "./page";

const fixtures = vi.hoisted(() => ({ snapshot: null as SessionSnapshot | null, stateIndex: 0 }));

vi.mock("react", async (importOriginal) => {
  const react = await importOriginal<typeof ReactModule>();
  return {
    ...react,
    useState: <T,>(initial: T) => [
      fixtures.stateIndex++ === 0 ? fixtures.snapshot : initial,
      vi.fn(),
    ],
    useRef: <T,>(initial: T) => ({ current: initial }),
    useMemo: <T,>(factory: () => T) => factory(),
    useEffect: vi.fn(),
  };
});
vi.mock("next/navigation", () => ({ useParams: () => ({ sessionId: "presenter-room" }) }));
vi.mock("../../../components/locale-provider", () => ({
  useLocale: () => ({ locale: "en-CA", t: (key: string) => key }),
}));
vi.mock("../../../lib/realtime", async (importOriginal) => ({
  ...(await importOriginal<typeof RealtimeModule>()),
  createRealtimeClient: () => ({}),
}));

function snapshot(brandTheme: BrandTheme | null): SessionSnapshot {
  return SessionSnapshotSchema.parse({
    mode: "live",
    stateSchemaVersion: 4,
    sessionId: "11111111-1111-4111-8111-111111111111",
    code: "1234567",
    version: 1,
    seq: 1,
    phase: "lobby",
    answerRevealed: false,
    roundId: null,
    roundKind: "main",
    sourceRoundId: null,
    questionIndex: null,
    questionPosition: null,
    questionCount: 1,
    question: null,
    deadline: null,
    participants: [],
    answerCount: 0,
    lobbyLocked: false,
    settings: {
      audienceLimit: 20,
      scoringMode: "accuracy",
      resultVisibility: "private",
      allowLateJoin: true,
      nicknamePolicy: "friendly_only",
    },
    brandTheme,
    experienceTheme: resolveExperienceTheme({ category: "general", brandTheme }),
    pausedRemainingMs: null,
    intervention: null,
  });
}

const brand = {
  organizationName: "Frozen workspace",
  primaryColor: "#17334A",
  accentColor: "#006B80",
};

beforeEach(() => {
  fixtures.snapshot = null;
  fixtures.stateIndex = 0;
});
afterEach(() => vi.unstubAllGlobals());

describe("presenter frozen workspace appearance", () => {
  it.each([
    ["light", "light"],
    ["light", "dark"],
    ["dark", "light"],
    ["dark", "dark"],
  ] as const)(
    "mounts the shared %s room palette with a %s personal interface",
    (roomMode, personalMode) => {
      fixtures.snapshot = snapshot({ ...brand, colorMode: roomMode });
      vi.stubGlobal("document", { documentElement: { dataset: { colorMode: personalMode } } });

      const shell = PresenterPage();
      expect(shell.props.className).toBe(`live-shell ${liveTheme.shell}`);
      expect(shell.props["data-workspace-color-mode"]).toBe(roomMode);
      expect(shell.props.style).toEqual(experienceThemeStyle(fixtures.snapshot.experienceTheme));
      // Render the boundary itself without running unrelated realtime child effects.
      const markup = renderToStaticMarkup(<div {...shell.props} children={undefined} />);
      expect(markup).toContain(`data-workspace-color-mode="${roomMode}"`);
      expect(markup).toContain(
        `--experience-surface:${fixtures.snapshot.experienceTheme.tokens.surface}`,
      );
      expect(markup).toContain(
        `--experience-text:${fixtures.snapshot.experienceTheme.tokens.text}`,
      );
    },
  );

  it.each([null, brand])(
    "uses the authored frozen experience for a mode-absent brand %j",
    (brandTheme) => {
      fixtures.snapshot = snapshot(brandTheme);
      const shell = PresenterPage();
      expect(shell.props.className).toBe(`live-shell ${liveTheme.shell}`);
      expect(shell.props["data-workspace-color-mode"]).toBeUndefined();
      expect(shell.props.style).toEqual(experienceThemeStyle(fixtures.snapshot.experienceTheme));
    },
  );

  it("keeps the loading shell unchanged before a frozen snapshot arrives", () => {
    const shell = PresenterPage();
    expect(shell.props.className).toBe("live-shell");
    expect(shell.props["data-workspace-color-mode"]).toBeUndefined();
    expect(shell.props.style).toBeUndefined();
  });
});
