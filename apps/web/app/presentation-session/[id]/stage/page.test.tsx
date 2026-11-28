import { renderToStaticMarkup } from "react-dom/server";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import type * as ReactModule from "react";
import type * as LocaleModule from "../../../../components/locale-provider";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PresentationStageSnapshotSchema,
  type PresentationStageSnapshot,
} from "@openround/contracts";
import { withEnglishLocale } from "../../../../test-utils/english-locale";
import PresentationAudienceStagePage from "./page";

type Effect = { deps?: readonly unknown[]; run: () => void | (() => void); cleanup?: () => void };
type Hooks = { cursor: number; slots: unknown[]; effects: Map<number, Effect>; pending: Effect[] };
const fixtures = vi.hoisted(() => ({ states: [] as unknown[], hooks: null as Hooks | null }));

vi.mock("../../../../components/locale-provider", async (original) => {
  const module = await original<typeof LocaleModule>();
  return {
    ...module,
    useLocale: () => (fixtures.hooks ? { locale: "en-CA" } : module.useLocale()),
  };
});

vi.mock("react", async (importOriginal) => {
  const react = await importOriginal<typeof ReactModule>();
  function queueEffect(run: Effect["run"], deps?: readonly unknown[]) {
    const hooks = fixtures.hooks!;
    const index = hooks.cursor++;
    const previous = hooks.effects.get(index);
    if (previous && deps?.every((value, position) => Object.is(value, previous.deps?.[position])))
      return;
    previous?.cleanup?.();
    const effect = { run, deps };
    hooks.effects.set(index, effect);
    hooks.pending.push(effect);
  }
  return {
    ...react,
    useState: <T,>(initial: T | (() => T)) => {
      const hooks = fixtures.hooks;
      if (!hooks)
        return react.useState(
          initial === null && fixtures.states.length ? (fixtures.states.shift() as T) : initial,
        );
      const index = hooks.cursor++;
      if (!(index in hooks.slots))
        hooks.slots[index] = typeof initial === "function" ? (initial as () => T)() : initial;
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
    useRef: <T,>(initial: T) => {
      const hooks = fixtures.hooks;
      if (!hooks) return react.useRef(initial);
      const index = hooks.cursor++;
      hooks.slots[index] ??= { current: initial };
      return hooks.slots[index];
    },
    useEffect: (run: Effect["run"], deps?: readonly unknown[]) => {
      if (fixtures.hooks) queueEffect(run, deps);
      else react.useEffect(run, deps);
    },
    useLayoutEffect: (run: Effect["run"], deps?: readonly unknown[]) => {
      if (fixtures.hooks) queueEffect(run, deps);
      else react.useLayoutEffect(run, deps);
    },
    useSyncExternalStore: <T,>(
      subscribe: (onStoreChange: () => void) => () => void,
      getSnapshot: () => T,
      getServerSnapshot?: () => T,
    ) => {
      if (fixtures.hooks) return getSnapshot();
      return react.useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
    },
  };
});

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "11111111-1111-4111-8111-111111111111" }),
  usePathname: () => "/presentation-session/11111111-1111-4111-8111-111111111111/stage",
}));

afterEach(() => {
  fixtures.hooks = null;
  fixtures.states = [];
  vi.unstubAllGlobals();
});

function elements(node: ReactNode, visibleOnly = false): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap((child) => elements(child, visibleOnly));
  if (!isValidElement<Record<string, unknown>>(node) || (visibleOnly && node.props.hidden))
    return [];
  return [node, ...elements(node.props.children as ReactNode, visibleOnly)];
}

const stageSnapshotBase = {
  sessionId: "11111111-1111-4111-8111-111111111111",
  artifactType: "presentation",
  presentationId: "22222222-2222-4222-8222-222222222222",
  presentationVersionId: "33333333-3333-4333-8333-333333333333",
  projection: "stage",
  title: "Authored presentation title",
  code: "1234567",
  status: "active",
  serverTime: "2026-11-03T12:00:00.000Z",
  questionOpenedAt: null,
  questionClosesAt: null,
  acceptingResponses: false,
  settings: { timeMode: "flex", trustMode: "learning" },
  participantCount: 2,
  responseCount: 0,
  revealedAnswer: null,
  finishedAt: null,
};

function revealedRanking(blockId: string, prompt: string, index: number, revision: number) {
  const choices = [
    { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", label: "Examples" },
    { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", label: "Practice" },
  ];
  return PresentationStageSnapshotSchema.parse({
    ...stageSnapshotBase,
    phase: "question_reveal",
    currentBlockIndex: index,
    blockCount: 2,
    revision,
    seq: revision,
    currentBlock: {
      id: blockId,
      kind: "question",
      question: {
        id: blockId,
        type: "ranking",
        prompt,
        rankCount: 2,
        choices,
        timeLimitSeconds: 30,
        basePoints: 0,
        mediaId: null,
        mediaAlt: null,
      },
    },
    opinionSummary: {
      kind: "ranking",
      blockId,
      rankCount: 2,
      responseCount: 0,
      totalRankings: 0,
      choices: choices.map(({ id, label }) => ({
        choiceId: id,
        label,
        weightedScore: 0,
        rankedRespondents: 0,
        averageRank: null,
        rankCounts: [0, 0],
      })),
    },
  });
}

function displayHarness({
  supported = true,
  reject = false,
  rejectExit = false,
  snapshot,
  reducedMotion = false,
}: {
  supported?: boolean;
  reject?: boolean;
  rejectExit?: boolean;
  snapshot?: PresentationStageSnapshot;
  reducedMotion?: boolean;
} = {}) {
  const hooks: Hooks = { cursor: 0, slots: [], effects: new Map(), pending: [] };
  const listeners = new Map<string, () => void>();
  const animationFrames: Array<() => void> = [];
  let nextPoll: (() => void) | undefined;
  const trigger = { focus: vi.fn() };
  const root = {
    focus: vi.fn(),
    requestFullscreen: vi.fn<(...args: unknown[]) => Promise<void>>(),
  };
  const resultTable = { scrollTo: vi.fn() };
  const canvas = {
    scrollTo: vi.fn(),
    animate: vi.fn(),
    querySelectorAll: (selector: string) =>
      selector === "[data-opinion-results-scroll]" ? [resultTable] : [],
  };
  const document = {
    documentElement: { dataset: { openroundMotion: reducedMotion ? "reduced" : undefined } },
    fullscreenElement: null as unknown,
    fullscreenEnabled: supported,
    addEventListener: vi.fn((event: string, callback: () => void) =>
      listeners.set(event, callback),
    ),
    removeEventListener: vi.fn((event: string) => listeners.delete(event)),
    exitFullscreen: vi.fn(async () => {
      if (rejectExit) throw new Error("Synthetic exit rejection");
      document.fullscreenElement = null;
      listeners.get("fullscreenchange")?.();
    }),
  };
  root.requestFullscreen.mockImplementation(async () => {
    if (reject) throw new Error("Synthetic fullscreen rejection");
    document.fullscreenElement = root;
    listeners.get("fullscreenchange")?.();
  });
  vi.stubGlobal("document", document);
  if (snapshot) vi.stubGlobal("fetch", async () => Response.json({ snapshot }));
  vi.stubGlobal("window", {
    location: { href: "https://example.test/presentation-session/session/stage" },
    history: { state: null, replaceState: vi.fn() },
    sessionStorage: { getItem: () => (snapshot ? "stage-pass" : null) },
    setInterval: vi.fn(() => 1),
    clearInterval: vi.fn(),
    setTimeout: vi.fn((callback: () => void, delay: number) => {
      if (delay === 2_000) nextPoll = callback;
      return 2;
    }),
    clearTimeout: vi.fn(),
    requestAnimationFrame: (callback: () => void) => {
      animationFrames.push(callback);
      return 3;
    },
  });
  function render() {
    hooks.cursor = 0;
    fixtures.hooks = hooks;
    try {
      const wrapper = PresentationAudienceStagePage();
      const tree = (wrapper.type as (props: Record<string, unknown>) => ReactNode)(wrapper.props);
      const nodes = elements(tree);
      const main = nodes.find((element) => element.type === "main")!;
      (main.props.ref as { current: unknown }).current = root;
      const slide = nodes.find((element) => "data-stage-slide" in element.props);
      if (slide) (slide.props.ref as { current: unknown }).current = canvas;
      return tree;
    } finally {
      fixtures.hooks = null;
      for (const effect of hooks.pending.splice(0)) effect.cleanup = effect.run() ?? undefined;
      for (const callback of animationFrames.splice(0)) callback();
    }
  }
  const harness = {
    root,
    canvas,
    resultTable,
    document,
    trigger,
    render,
    main: () => elements(render())[0]!,
    button: (name: string) =>
      elements(render(), true).find(
        (element) => element.type === "button" && element.props.children === name,
      )!,
    async click(name: string) {
      const button = harness.button(name);
      expect(button).toBeDefined();
      expect(button.props.disabled).not.toBe(true);
      (button.props.onClick as (event: unknown) => void)({ currentTarget: trigger });
      await Promise.resolve();
      await Promise.resolve();
      render();
    },
    async escape() {
      const preventDefault = vi.fn();
      (harness.main().props.onKeyDown as (event: unknown) => void)({
        key: "Escape",
        preventDefault,
      });
      await Promise.resolve();
      render();
      return preventDefault;
    },
    browserExit() {
      document.fullscreenElement = null;
      listeners.get("fullscreenchange")?.();
      render();
    },
    browserEnter() {
      document.fullscreenElement = root;
      listeners.get("fullscreenchange")?.();
      render();
    },
    async readSnapshot(next?: PresentationStageSnapshot) {
      if (next) {
        const poll = nextPoll;
        expect(poll).toBeDefined();
        nextPoll = undefined;
        snapshot = next;
        poll?.();
      }
      await vi.waitFor(() => expect(nextPoll).toBeDefined());
      return render();
    },
    markup: () => renderToStaticMarkup(render()),
    unmount: () => hooks.effects.forEach((effect) => effect.cleanup?.()),
  };
  render();
  return harness;
}

describe("Presentation audience stage workspace", () => {
  it.each([false, true])(
    "resets both result scroll containers on a direct block change with reduced motion %s",
    async (reducedMotion) => {
      const initial = revealedRanking("55555555-5555-4555-8555-555555555555", "Rank ideas", 0, 1);
      const target = revealedRanking("66666666-6666-4666-8666-666666666666", "Rank formats", 1, 3);
      const stage = displayHarness({ snapshot: initial, reducedMotion });
      const before = await stage.readSnapshot();
      const beforeSlide = elements(before).find((element) => "data-stage-slide" in element.props);
      expect(renderToStaticMarkup(withEnglishLocale(before))).toContain(
        'data-opinion-results-scroll="true"',
      );
      stage.canvas.scrollTo.mockClear();
      stage.resultTable.scrollTo.mockClear();
      stage.canvas.animate.mockClear();

      await stage.readSnapshot({ ...initial, seq: 2, participantCount: 3 });
      expect(stage.canvas.scrollTo).not.toHaveBeenCalled();
      expect(stage.resultTable.scrollTo).not.toHaveBeenCalled();

      const after = await stage.readSnapshot(target);
      const afterSlide = elements(after).find((element) => "data-stage-slide" in element.props);
      expect(elements(after).find((element) => element.type === "h1")?.props.children).toBe(
        "Rank formats",
      );
      expect(afterSlide?.key).toBe(beforeSlide?.key);
      expect(afterSlide?.props.ref).toBe(beforeSlide?.props.ref);
      const origin = { top: 0, left: 0, behavior: "instant" };
      expect(stage.canvas.scrollTo).toHaveBeenCalledExactlyOnceWith(origin);
      expect(stage.resultTable.scrollTo).toHaveBeenCalledExactlyOnceWith(origin);
      expect(stage.canvas.animate).toHaveBeenCalledTimes(reducedMotion ? 0 : 1);
      expect(stage.root.focus).not.toHaveBeenCalled();
      stage.unmount();
    },
  );

  it("requests fullscreen only from the stage action and follows native Escape state", async () => {
    const stage = displayHarness();
    expect(stage.root.requestFullscreen).not.toHaveBeenCalled();
    expect(stage.main().props["data-stage-focus"]).toBe("false");
    await stage.click("Enter full screen");
    expect(stage.root.requestFullscreen).toHaveBeenCalledExactlyOnceWith({ navigationUI: "hide" });
    expect(stage.document.fullscreenElement).toBe(stage.root);
    expect(stage.main().props["data-stage-focus"]).toBe("true");
    expect(
      elements(stage.render()).find((element) => element.props["data-stage-header"] !== undefined)
        ?.props.hidden,
    ).toBe(true);
    expect(stage.button("Exit slide-only view")).toBeDefined();
    stage.browserExit();
    expect(stage.main().props["data-stage-focus"]).toBe("false");
    expect(stage.trigger.focus).toHaveBeenCalled();
    stage.unmount();
  });

  it("keeps slide-only view usable after a fullscreen rejection and exits it with Escape", async () => {
    const stage = displayHarness({ reject: true });
    await stage.click("Enter full screen");
    expect(stage.main().props["data-stage-focus"]).toBe("true");
    expect(stage.document.fullscreenElement).toBeNull();
    expect(stage.markup()).toContain("continue presenting in this tab");
    expect(stage.markup()).toContain("use Exit or Escape to return");
    expect(await stage.escape()).toHaveBeenCalledOnce();
    expect(stage.main().props["data-stage-focus"]).toBe("false");
    expect(stage.trigger.focus).toHaveBeenCalled();
    stage.unmount();
  });

  it("offers a local slide-only view when fullscreen is unavailable", async () => {
    const stage = displayHarness({ supported: false });
    expect(stage.button("Enter full screen").props.disabled).toBe(true);
    await stage.click("Slide-only view");
    expect(stage.main().props["data-stage-focus"]).toBe("true");
    expect(stage.root.requestFullscreen).not.toHaveBeenCalled();
    expect(stage.markup()).toContain("Slide-only view still fills this window");
    await stage.click("Exit slide-only view");
    expect(stage.main().props["data-stage-focus"]).toBe("false");
    expect(stage.document.exitFullscreen).not.toHaveBeenCalled();
    stage.unmount();
  });

  it("keeps a rejected fullscreen exit honest and leaves the accessible exit control available", async () => {
    const stage = displayHarness({ rejectExit: true });
    await stage.click("Enter full screen");
    await stage.click("Exit slide-only view");
    expect(stage.main().props["data-stage-focus"]).toBe("true");
    expect(stage.document.fullscreenElement).toBe(stage.root);
    expect(stage.markup()).toContain("Full screen could not close");
    expect(stage.button("Exit slide-only view")).toBeDefined();
    stage.unmount();
  });

  it("exits a delayed fullscreen request if the user already left slide-only view", async () => {
    const stage = displayHarness();
    let complete: () => void = () => undefined;
    stage.root.requestFullscreen.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          complete = resolve;
        }),
    );
    await stage.click("Enter full screen");
    await stage.click("Exit slide-only view");
    expect(stage.main().props["data-stage-focus"]).toBe("false");
    expect(stage.button("Enter full screen").props.disabled).toBe(true);
    stage.browserEnter();
    complete();
    await Promise.resolve();
    await Promise.resolve();
    stage.render();
    expect(stage.document.exitFullscreen).toHaveBeenCalledOnce();
    expect(stage.document.fullscreenElement).toBeNull();
    expect(stage.main().props["data-stage-focus"]).toBe("false");
    expect(stage.button("Enter full screen").props.disabled).toBe(false);
    stage.unmount();
  });

  it("keeps accessible brand and full-screen access in the stage header while connecting", () => {
    const markup = renderToStaticMarkup(withEnglishLocale(<PresentationAudienceStagePage />));
    const header = markup.match(/<header\b[^>]*>([\s\S]*?)<\/header>/)?.[1];
    expect(header).toContain('<span class="sr-only">Polling Pops</span>');
    expect(header).toContain("Enter full screen");
    expect(header).not.toContain('data-inverted="true"');
    expect(markup).toContain("Connecting to audience stage");
  });

  it("retains authored content design inside a dedicated frame with join access after the slide", () => {
    fixtures.states = [
      PresentationStageSnapshotSchema.parse({
        ...stageSnapshotBase,
        phase: "content",
        currentBlockIndex: 0,
        blockCount: 1,
        revision: 3,
        seq: 3,
        currentBlock: {
          id: "55555555-5555-4555-8555-555555555555",
          kind: "content",
          layout: "title",
          design: { theme: "sunset", font: "serif", spacing: "compact" },
          textElements: [
            {
              id: "title",
              role: "title",
              text: "Authored slide title",
              region: "top_center",
              order: 0,
            },
          ],
          mediaId: null,
          mediaAlt: null,
        },
      }),
      "stage-pass",
    ];
    const markup = renderToStaticMarkup(withEnglishLocale(<PresentationAudienceStagePage />));
    expect(markup).toContain('aria-label="Audience slide"');
    expect(markup).toContain('data-kind="content"');
    expect(markup).toContain('data-design-theme="sunset"');
    expect(markup).toContain("Authored slide title");
    expect(markup).not.toContain("data-native-fixed-layout");
    expect(markup.indexOf("Authored slide title")).toBeLessThan(
      markup.indexOf('aria-label="Join this Presentation"'),
    );
    expect(markup).not.toContain("Submit response");
  });
});
