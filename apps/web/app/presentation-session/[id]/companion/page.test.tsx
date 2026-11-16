import { isValidElement, type ComponentProps, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type * as ReactModule from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PresentationCompanionSnapshotSchema,
  type PresentationCompanionSnapshot,
  type SupportedLocale,
} from "@openround/contracts";
import { ApiClientError } from "../../../../lib/api";
import type * as ApiModule from "../../../../lib/api";
import { translate, type MessageKey } from "../../../../lib/i18n/catalog";
import type { PresentationRealtimeControllerOptions } from "../../../../lib/presentation-realtime";
import { CompanionOverlay } from "../../../../components/presentation-live/companion-overlay";
import { PresentationNavigationDialog } from "../../../../components/presentation-live/presentation-navigation";
import { ContentSlideView } from "../../../../components/presentation/content-slide-view";
import { PresentationBranches } from "../../../../components/presentation-live/presentation-branches";
import { CompanionQuickCheckForm } from "../../../../components/presentation-live/companion-quick-check";
import { CompanionPublishedQuestionPicker } from "../../../../components/presentation-live/companion-published-questions";
import {
  publishedQuestion,
  publishedQuestionCatalog,
} from "../../../../test-utils/companion-published-questions";
import { publishedQuestionSelection } from "../../../../lib/presentation-companion-published-questions";
import PresentationCompanionPage from "./page";

interface PageHooks {
  cursor: number;
  slots: unknown[];
  effects: Array<() => unknown>;
  layouts: Array<() => unknown>;
}

const fixtures = vi.hoisted(() => ({
  hooks: null as PageHooks | null,
  snapshot: null as PresentationCompanionSnapshot | null,
  controllerOptions:
    null as PresentationRealtimeControllerOptions<PresentationCompanionSnapshot> | null,
  canMutate: true,
  execute: vi.fn(),
  apiFetch: vi.fn(),
  reconcile: vi.fn(),
  locale: "en-CA" as SupportedLocale,
}));

vi.mock("react", async (importOriginal) => {
  const react = await importOriginal<typeof ReactModule>();
  return {
    ...react,
    useState: <T,>(initial: T | (() => T)) => {
      const hooks = fixtures.hooks;
      if (!hooks) return react.useState(initial);
      const index = hooks.cursor++;
      if (!(index in hooks.slots))
        hooks.slots[index] = typeof initial === "function" ? (initial as () => T)() : initial;
      return [
        hooks.slots[index] as T,
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
      if (!(index in hooks.slots)) hooks.slots[index] = { current: initial };
      return hooks.slots[index];
    },
    useCallback: <T,>(callback: T) => callback,
    useEffect: (effect: () => unknown) => {
      if (fixtures.hooks) fixtures.hooks.effects.push(effect);
      else react.useEffect(effect as Parameters<typeof react.useEffect>[0]);
    },
    useLayoutEffect: (effect: () => unknown) => {
      if (fixtures.hooks) fixtures.hooks.layouts.push(effect);
      else react.useLayoutEffect(effect as Parameters<typeof react.useLayoutEffect>[0]);
    },
  };
});

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "11111111-1111-4111-8111-111111111111" }),
}));
vi.mock("../../../../components/locale-provider", async () => {
  const { loadMessages } = await import("../../../../lib/i18n/catalog");
  const { supportedLocales } = await import("@openround/contracts");
  const messages = Object.fromEntries(
    await Promise.all(
      supportedLocales.map(async (locale) => [
        locale,
        await loadMessages(locale, ["live-delivery"]),
      ]),
    ),
  );
  return {
    useLocale: () => ({
      locale: fixtures.locale,
      t: (key: MessageKey, values?: Record<string, string | number>) =>
        translate(messages[fixtures.locale]!, key, values),
    }),
  };
});
vi.mock("../../../../lib/presentation-companion-pass", () => ({
  capturePresentationCompanionPass: () => "companion-pass",
  rejectPresentationCompanionPass: vi.fn(),
}));
vi.mock("../../../../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof ApiModule>()),
  apiFetch: fixtures.apiFetch,
}));
vi.mock("../../../../lib/presentation-realtime", () => ({
  createPresentationRealtimeController: (
    options: PresentationRealtimeControllerOptions<PresentationCompanionSnapshot>,
  ) => {
    fixtures.controllerOptions = options;
    return {
      start: () => {
        if (fixtures.snapshot) options.onSnapshot(fixtures.snapshot);
      },
      stop: vi.fn(),
      canMutate: () => fixtures.canMutate,
      needsFallbackPolling: () => false,
      reconcile: fixtures.reconcile,
      command: fixtures.execute,
    };
  },
}));

function initialSnapshot() {
  return PresentationCompanionSnapshotSchema.parse({
    sessionId: "11111111-1111-4111-8111-111111111111",
    artifactType: "presentation",
    presentationId: "22222222-2222-4222-8222-222222222222",
    presentationVersionId: "33333333-3333-4333-8333-333333333333",
    title: "A facilitated discussion",
    code: "1234567",
    status: "active",
    phase: "lobby",
    currentBlockIndex: -1,
    blockCount: 1,
    revision: 2,
    seq: 2,
    serverTime: "2026-10-08T12:00:00.000Z",
    questionOpenedAt: null,
    questionClosesAt: null,
    acceptingResponses: false,
    settings: { timeMode: "timed", trustMode: "learning", recoveryPackCardsEnabled: true },
    projection: "companion",
    currentBlock: null,
    roomStatus: {
      sessionId: "11111111-1111-4111-8111-111111111111",
      joinedCount: 0,
      connectedCount: 0,
      notCurrentlyConnectedCount: 0,
      responseCount: 0,
      sampledAt: "2026-10-08T12:00:00.000Z",
    },
    primaryAction: "advance",
    canInsertRecoveryPack: true,
    canInsertQuickCheck: true,
    canInsertPublishedQuestion: true,
    finishedAt: null,
  });
}

beforeEach(() => {
  fixtures.locale = "en-CA";
  fixtures.hooks = null;
  fixtures.snapshot = initialSnapshot();
  fixtures.controllerOptions = null;
  fixtures.canMutate = true;
  fixtures.execute
    .mockReset()
    .mockImplementation((_command, fallback: () => Promise<PresentationCompanionSnapshot>) =>
      fallback(),
    );
  fixtures.apiFetch
    .mockReset()
    .mockImplementation(async (url: string) =>
      url.includes("/companion-published-questions")
        ? publishedQuestionCatalog
        : { snapshot: fixtures.snapshot },
    );
  fixtures.reconcile.mockReset().mockResolvedValue(null);
  vi.stubGlobal("window", {
    location: { origin: "https://discussion.example.test" },
    history: {},
    setInterval: vi.fn(() => 1),
    clearInterval: vi.fn(),
  });
  vi.stubGlobal("sessionStorage", {});
});
afterEach(() => vi.unstubAllGlobals());

function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement<Record<string, unknown>>(node)) return [];
  return [node, ...elements(node.props.children as ReactNode)];
}

function text(node: ReactNode): string {
  if (Array.isArray(node)) return node.map(text).join("");
  if (isValidElement<{ children?: ReactNode }>(node)) return text(node.props.children);
  return typeof node === "string" || typeof node === "number" ? String(node) : "";
}

function button(tree: ReactNode, name: string): ComponentProps<"button"> {
  const element = elements(tree).find(
    (candidate) =>
      candidate.type === "button" && text(candidate.props.children as ReactNode) === name,
  );
  if (!element) throw new Error(`Expected button: ${name}`);
  return element.props as ComponentProps<"button">;
}

function propsFor<
  T extends
    | typeof CompanionQuickCheckForm
    | typeof CompanionOverlay
    | typeof PresentationNavigationDialog
    | typeof ContentSlideView
    | typeof PresentationBranches
    | typeof CompanionPublishedQuestionPicker,
>(tree: ReactNode, type: T): ComponentProps<T> {
  const element = elements(tree).find((candidate) => candidate.type === type);
  if (!element) throw new Error("Expected Companion child control");
  return element.props as ComponentProps<T>;
}

function click(tree: ReactNode, name: string) {
  button(tree, name).onClick?.({ currentTarget: { focus: vi.fn() } } as unknown as Parameters<
    NonNullable<ComponentProps<"button">["onClick"]>
  >[0]);
}

// The harness runs the page's capture/controller setup once and exercises the real
// command recovery callbacks; browser tests cover native dialog focus and effects.
function pageHarness() {
  const hooks: PageHooks = { cursor: 0, slots: [], effects: [], layouts: [] };
  const render = () => {
    hooks.cursor = 0;
    hooks.effects = [];
    hooks.layouts = [];
    fixtures.hooks = hooks;
    try {
      return PresentationCompanionPage();
    } finally {
      fixtures.hooks = null;
    }
  };
  render();
  hooks.layouts[0]?.();
  render();
  hooks.effects[0]?.();
  return {
    render,
    broadcast(snapshot: PresentationCompanionSnapshot) {
      fixtures.snapshot = snapshot;
      fixtures.controllerOptions?.onSnapshot(snapshot);
    },
    open() {
      click(render(), "Add Quick Check");
    },
  };
}

async function settle() {
  for (let index = 0; index < 8; index++) await Promise.resolve();
}

const authoredDraft = {
  prompt: "Which approach should we discuss?",
  choices: ["First approach", "Second approach"],
  timeLimitSeconds: "120",
};
const quickCheck = { ...authoredDraft, timeLimitSeconds: 120 };

describe("Companion selected-language shell and recovery", () => {
  it("localizes connection and pass rejection while removing the rejected projection", () => {
    fixtures.locale = "ko-KR";
    fixtures.snapshot = null;
    const harness = pageHarness();
    const connecting = renderToStaticMarkup(harness.render());
    expect(connecting).toContain("프레젠테이션에 연결 중…");
    fixtures.controllerOptions?.onCredentialRejected?.("companion-pass");
    const rejected = renderToStaticMarkup(harness.render());
    expect(rejected).toContain("이 Companion 패스가 만료되었거나 취소되었습니다.");
    expect(rejected).toContain("연결 끊김");
    expect(rejected).not.toContain("A facilitated discussion");
    expect(rejected).not.toContain("companion-pass");
  });

  it("renders Korean shell and join overlay while leaving the room title and URL untouched", () => {
    fixtures.locale = "ko-KR";
    const harness = pageHarness();
    const initial = renderToStaticMarkup(harness.render());
    expect(initial).toContain("프레젠테이션 Companion");
    expect(initial).toContain("참여 정보 표시");
    expect(initial).not.toContain("서버 확인 대기 중");
    expect(initial).toContain("A facilitated discussion");
    expect(initial).not.toContain("companion-pass");
    click(harness.render(), "참여 정보 표시");
    const overlay = propsFor(harness.render(), CompanionOverlay);
    expect(overlay.title).toBe("이 프레젠테이션에 참여");
    const markup = renderToStaticMarkup(harness.render());
    expect(markup).toContain("프레젠테이션으로 돌아가기");
    expect(markup).toContain("https://discussion.example.test/join?code=1234567");
    expect(markup).not.toContain("Return to deck");
  });

  it("changes a pending Quick Check to Korean without changing its authored draft or retained command", async () => {
    fixtures.execute
      .mockRejectedValueOnce(
        new Error("The server did not confirm that action. Retry its acknowledgement."),
      )
      .mockResolvedValueOnce(initialSnapshot());
    const harness = pageHarness();
    harness.open();
    propsFor(harness.render(), CompanionQuickCheckForm).onChange(authoredDraft);
    propsFor(harness.render(), CompanionQuickCheckForm).onInsert(quickCheck);
    await settle();
    const original = fixtures.execute.mock.calls[0]![0];
    fixtures.locale = "ko-KR";
    const localized = renderToStaticMarkup(harness.render());
    expect(localized).toContain("Quick Check 확인 응답 재시도");
    expect(localized).toContain("서버가 작업을 확인하지 않았습니다. 확인 응답을 재시도하세요.");
    expect(localized).toContain(authoredDraft.prompt);
    expect(localized).toContain('lang=""');
    expect(propsFor(harness.render(), CompanionQuickCheckForm).draft).toEqual(authoredDraft);
    expect(fixtures.execute).toHaveBeenCalledTimes(1);
    click(harness.render(), "Quick Check 확인 응답 재시도");
    await settle();
    expect(fixtures.execute).toHaveBeenCalledTimes(2);
    expect(fixtures.execute.mock.calls[1]![0]).toBe(original);
    expect(original).toMatchObject({
      action: "insert_quick_check",
      expectedRevision: 2,
      quickCheck,
    });
  });
});

describe("Companion navigation commands", () => {
  const targetBlockId = "66666666-6666-4666-8666-666666666666";
  function navigationSnapshot(canJump = true): PresentationCompanionSnapshot {
    return {
      ...initialSnapshot(),
      navigation: {
        entries: [
          {
            blockId: targetBlockId,
            title: "Saved activity",
            kind: "question",
            sectionId: null,
            sectionTitle: null,
            status: "visited",
            phase: "question_reveal",
            canJump,
            blockedReason: canJump ? null : "Close the current activity first.",
          },
        ],
        returnTarget: { blockId: targetBlockId, title: "Original path" },
        canReturn: canJump,
        blockedReason: canJump ? null : "Close the current activity first.",
      },
    };
  }

  it("sends an explicit block ID and preserves that request through a lost acknowledgement and phase change", async () => {
    fixtures.execute
      .mockRejectedValueOnce(new Error("Lost acknowledgement"))
      .mockResolvedValueOnce(initialSnapshot());
    const harness = pageHarness();
    harness.broadcast(navigationSnapshot());
    click(harness.render(), "Open navigation");
    propsFor(harness.render(), PresentationNavigationDialog).onJump(targetBlockId);
    await settle();
    const original = fixtures.execute.mock.calls[0]?.[0];
    expect(original).toMatchObject({
      action: "jump_to_block",
      targetBlockId,
      expectedRevision: 2,
      companionToken: "companion-pass",
    });
    expect(original).not.toHaveProperty("targetIndex");
    harness.broadcast({ ...navigationSnapshot(false), revision: 9, seq: 9 });
    expect(propsFor(harness.render(), PresentationNavigationDialog).disabled).toBe(true);
    propsFor(harness.render(), PresentationNavigationDialog).onJump(
      "77777777-7777-4777-8777-777777777777",
    );
    propsFor(harness.render(), PresentationNavigationDialog).onClose();
    click(harness.render(), "Retry jump acknowledgement");
    await settle();
    expect(fixtures.execute).toHaveBeenCalledTimes(2);
    expect(fixtures.execute.mock.calls[1]?.[0]).toBe(original);
  });

  it("sends return_to_path without an invented target and guards disabled server capabilities", async () => {
    const harness = pageHarness();
    harness.broadcast(navigationSnapshot(false));
    click(harness.render(), "Open navigation");
    propsFor(harness.render(), PresentationNavigationDialog).onReturn();
    propsFor(harness.render(), PresentationNavigationDialog).onJump(targetBlockId);
    await settle();
    expect(fixtures.execute).not.toHaveBeenCalled();
    harness.broadcast(navigationSnapshot());
    propsFor(harness.render(), PresentationNavigationDialog).onReturn();
    await settle();
    expect(fixtures.execute.mock.calls[0]?.[0]).toMatchObject({
      action: "return_to_path",
      expectedRevision: 2,
    });
    expect(fixtures.execute.mock.calls[0]?.[0]).not.toHaveProperty("targetBlockId");
  });
});

describe("Companion advanced interaction commands", () => {
  it("keeps the absolute broadcast reveal request after a newer authoritative state", async () => {
    fixtures.execute
      .mockRejectedValueOnce(new Error("Lost acknowledgement"))
      .mockResolvedValueOnce(initialSnapshot());
    const harness = pageHarness();
    const blockId = "66666666-6666-4666-8666-666666666666";
    harness.broadcast({
      ...initialSnapshot(),
      phase: "content",
      currentBlockIndex: 0,
      currentBlock: {
        id: blockId,
        kind: "content",
        layout: "title_body",
        textElements: [],
        mediaId: null,
        mediaAlt: null,
        scene: {
          schemaVersion: 6,
          aspectRatio: "16:9",
          nodes: [
            {
              id: "title",
              type: "text",
              role: "title",
              text: "Evidence",
              frame: { x: 8, y: 5, width: 84, height: 20 },
            },
            {
              id: "reveal",
              type: "reveal",
              scope: "broadcast",
              label: "Show evidence",
              body: "Audience evidence",
              frame: { x: 8, y: 35, width: 60, height: 30 },
            },
          ],
          readingOrder: ["title", "reveal"],
        },
      },
      interactionState: { reveals: [{ blockId, nodeId: "reveal", revealed: false }] },
    });
    propsFor(harness.render(), ContentSlideView).interactionRuntime!.onSetReveal!("reveal", true);
    await settle();
    const original = fixtures.execute.mock.calls[0]?.[0];
    expect(original).toMatchObject({
      action: "set_reveal",
      blockId,
      nodeId: "reveal",
      revealed: true,
      expectedRevision: 2,
    });
    harness.broadcast({ ...initialSnapshot(), revision: 9, seq: 9 });
    click(harness.render(), "Retry broadcast reveal acknowledgement");
    await settle();
    expect(fixtures.execute.mock.calls[1]?.[0]).toBe(original);
  });
  it("dispatches only eligible server-owned branch IDs without sending target or condition data", async () => {
    const harness = pageHarness();
    const blockId = "66666666-6666-4666-8666-666666666666";
    const branchId = "77777777-7777-4777-8777-777777777777";
    harness.broadcast({
      ...initialSnapshot(),
      phase: "question_reveal",
      currentBlock: {
        id: blockId,
        kind: "question",
        question: {
          id: "88888888-8888-4888-8888-888888888888",
          type: "poll",
          prompt: "Choose",
          choices: [
            { id: "99999999-9999-4999-8999-999999999999", label: "A" },
            { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", label: "B" },
          ],
          confidence: "off",
          timeLimitSeconds: 120,
          basePoints: 0,
          mediaId: null,
          mediaAlt: null,
        },
      },
      branches: [
        {
          id: branchId,
          label: "Review",
          targetBlockId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          targetTitle: "Review slide",
          available: false,
          blockedReason: "Close the current activity.",
        },
      ],
    });
    propsFor(harness.render(), PresentationBranches).onFollow(branchId);
    await settle();
    expect(fixtures.execute).not.toHaveBeenCalled();
    harness.broadcast({
      ...fixtures.snapshot!,
      branches: fixtures.snapshot!.branches!.map((branch) => ({
        ...branch,
        available: true,
        blockedReason: null,
      })),
    });
    propsFor(harness.render(), PresentationBranches).onFollow(branchId);
    await settle();
    expect(fixtures.execute.mock.calls[0]?.[0]).toMatchObject({
      action: "follow_branch",
      blockId,
      branchId,
    });
    expect(fixtures.execute.mock.calls[0]?.[0]).not.toHaveProperty("targetBlockId");
    expect(fixtures.execute.mock.calls[0]?.[0]).not.toHaveProperty("condition");
  });
});

describe("Companion published question page state", () => {
  it("uses scoped metadata and inserts independently of Recovery Pack availability", async () => {
    const harness = pageHarness();
    harness.broadcast({
      ...initialSnapshot(),
      settings: { timeMode: "timed", trustMode: "learning", recoveryPackCardsEnabled: false },
      canInsertRecoveryPack: false,
    });
    expect(button(harness.render(), "Add published question").disabled).toBe(false);
    click(harness.render(), "Add published question");
    await settle();
    expect(fixtures.apiFetch.mock.calls[0]?.[0]).toBe(
      "/v1/presentation-sessions/11111111-1111-4111-8111-111111111111/companion-published-questions",
    );
    expect(fixtures.apiFetch.mock.calls[0]?.[1]).toMatchObject({
      credentials: "omit",
      headers: { authorization: "Bearer companion-pass" },
    });
    expect(propsFor(harness.render(), CompanionPublishedQuestionPicker).catalog).toEqual(
      publishedQuestionCatalog,
    );
    propsFor(harness.render(), CompanionPublishedQuestionPicker).onInsert(
      publishedQuestionSelection(publishedQuestion),
    );
    await settle();
    const command = fixtures.execute.mock.calls[0]?.[0];
    expect(command).toMatchObject({
      action: "insert_published_question",
      companionToken: "companion-pass",
      expectedRevision: 2,
      publishedQuestion: publishedQuestionSelection(publishedQuestion),
    });
    expect(command).not.toHaveProperty("controlToken");
    expect(fixtures.apiFetch.mock.calls[1]?.[0]).toContain(
      "/companion-command?includeQuickChecks=true&includePublishedQuestions=true",
    );
    expect(fixtures.apiFetch.mock.calls[1]?.[1]).toMatchObject({
      method: "POST",
      credentials: "omit",
    });
    expect(elements(harness.render()).some((element) => element.type === CompanionOverlay)).toBe(
      false,
    );
  });

  it("hides the unsupported opener on older snapshots and gates stale callbacks at unavailable boundaries", async () => {
    const harness = pageHarness();
    const older = initialSnapshot();
    delete older.canInsertPublishedQuestion;
    harness.broadcast(PresentationCompanionSnapshotSchema.parse(older));
    expect(
      elements(harness.render()).some(
        (element) =>
          element.type === "button" &&
          text(element.props.children as ReactNode) === "Add published question",
      ),
    ).toBe(false);
    harness.broadcast({ ...initialSnapshot(), canInsertPublishedQuestion: false });
    expect(button(harness.render(), "Add published question").disabled).toBe(true);
    click(harness.render(), "Add published question");
    harness.broadcast(initialSnapshot());
    fixtures.canMutate = false;
    click(harness.render(), "Add published question");
    await settle();
    expect(fixtures.apiFetch).not.toHaveBeenCalled();
    expect(
      elements(harness.render()).some(
        (element) => element.type === CompanionPublishedQuestionPicker,
      ),
    ).toBe(false);
  });

  it("keeps the picker through a broadcast, fences double insertion, and closes only on its acknowledgement", async () => {
    let acknowledge!: (snapshot: PresentationCompanionSnapshot) => void;
    fixtures.execute.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          acknowledge = resolve;
        }),
    );
    const harness = pageHarness();
    click(harness.render(), "Add published question");
    await settle();
    const overlay = propsFor(harness.render(), CompanionOverlay);
    expect(overlay.title).toBe("Published Round questions");
    expect(overlay.returnFocusRef).toBe(button(harness.render(), "Start Presentation").ref);
    const picker = propsFor(harness.render(), CompanionPublishedQuestionPicker);
    const selection = publishedQuestionSelection(publishedQuestion);
    picker.onInsert(selection);
    picker.onInsert(selection);
    expect(fixtures.execute).toHaveBeenCalledOnce();
    harness.broadcast({
      ...initialSnapshot(),
      revision: 3,
      seq: 3,
      phase: "question_open",
      acceptingResponses: true,
      canInsertRecoveryPack: false,
      canInsertQuickCheck: false,
      canInsertPublishedQuestion: false,
    });
    expect(propsFor(harness.render(), CompanionPublishedQuestionPicker)).toMatchObject({
      catalog: publishedQuestionCatalog,
      disabled: true,
    });
    expect(button(harness.render(), "Add published question").disabled).toBe(true);
    acknowledge(fixtures.snapshot!);
    await settle();
    expect(elements(harness.render()).some((element) => element.type === CompanionOverlay)).toBe(
      false,
    );
  });

  it("retains the exact published insertion retry after phase and capability changes without reloading sources", async () => {
    fixtures.execute
      .mockRejectedValueOnce(new Error("Acknowledgement lost"))
      .mockRejectedValueOnce(new ApiClientError("Source no longer in catalog", "NOT_FOUND", 404))
      .mockResolvedValueOnce({ ...initialSnapshot(), revision: 4 });
    const harness = pageHarness();
    click(harness.render(), "Add published question");
    await settle();
    propsFor(harness.render(), CompanionPublishedQuestionPicker).onInsert(
      publishedQuestionSelection(publishedQuestion),
    );
    await settle();
    const original = fixtures.execute.mock.calls[0]?.[0];
    const finished: PresentationCompanionSnapshot = {
      ...initialSnapshot(),
      revision: 4,
      seq: 4,
      status: "finished",
      phase: "finished",
      primaryAction: "none",
      canInsertRecoveryPack: false,
      canInsertQuickCheck: false,
      canInsertPublishedQuestion: false,
      finishedAt: "2026-10-08T12:10:00.000Z",
    };
    delete finished.canInsertPublishedQuestion;
    harness.broadcast(finished);
    expect(button(harness.render(), "Retry published question acknowledgement").disabled).toBe(
      false,
    );
    const picker = propsFor(harness.render(), CompanionPublishedQuestionPicker);
    expect(picker.disabled).toBe(true);
    picker.onSearch("another question");
    picker.onInsert({
      ...publishedQuestionSelection(publishedQuestion),
      contentHash: "b".repeat(64),
    });
    expect(fixtures.apiFetch).toHaveBeenCalledOnce();
    expect(fixtures.execute).toHaveBeenCalledOnce();
    click(harness.render(), "Retry published question acknowledgement");
    await settle();
    expect(fixtures.execute.mock.calls[1]?.[0]).toBe(original);
    expect(button(harness.render(), "Retry published question acknowledgement").disabled).toBe(
      false,
    );
    click(harness.render(), "Retry published question acknowledgement");
    await settle();
    expect(fixtures.execute.mock.calls[2]?.[0]).toBe(original);
    expect(elements(harness.render()).some((element) => element.type === CompanionOverlay)).toBe(
      false,
    );
  });

  it("rejects stale catalog references before sending a new insertion and recovers catalog errors with explicit search", async () => {
    fixtures.apiFetch.mockRejectedValueOnce(
      new ApiClientError("Catalog unavailable", "UNAVAILABLE", 503),
    );
    const harness = pageHarness();
    click(harness.render(), "Add published question");
    await settle();
    expect(propsFor(harness.render(), CompanionPublishedQuestionPicker)).toMatchObject({
      loading: false,
      error: "Catalog unavailable",
    });
    propsFor(harness.render(), CompanionPublishedQuestionPicker).onSearch("  comparison %_  ");
    await settle();
    expect(fixtures.apiFetch.mock.calls[1]?.[0]).toContain(
      "/companion-published-questions?search=comparison+%25_",
    );
    const picker = propsFor(harness.render(), CompanionPublishedQuestionPicker);
    expect(picker).toMatchObject({ loading: false, error: "", catalog: publishedQuestionCatalog });
    picker.onInsert({
      ...publishedQuestionSelection(publishedQuestion),
      sourceQuizVersionId: "55555555-5555-4555-8555-555555555555",
    });
    picker.onInsert({
      ...publishedQuestionSelection(publishedQuestion),
      sourceQuestionId: "66666666-6666-4666-8666-666666666666",
    });
    picker.onInsert({
      ...publishedQuestionSelection(publishedQuestion),
      contentHash: "b".repeat(64),
    });
    expect(fixtures.execute).not.toHaveBeenCalled();
  });

  it("ignores a late catalog response after dismissal and reopening", async () => {
    let finishOldRequest!: (catalog: typeof publishedQuestionCatalog) => void;
    fixtures.apiFetch.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishOldRequest = resolve;
        }),
    );
    const harness = pageHarness();
    click(harness.render(), "Add published question");
    expect(propsFor(harness.render(), CompanionPublishedQuestionPicker).loading).toBe(true);
    propsFor(harness.render(), CompanionOverlay).onClose();
    click(harness.render(), "Add published question");
    await settle();
    expect(propsFor(harness.render(), CompanionPublishedQuestionPicker).catalog).toEqual(
      publishedQuestionCatalog,
    );
    finishOldRequest({
      questions: [{ ...publishedQuestion, title: "Late stale catalog" }],
      hasMore: false,
    });
    await settle();
    expect(propsFor(harness.render(), CompanionPublishedQuestionPicker).catalog).toEqual(
      publishedQuestionCatalog,
    );
  });

  it("leaves the picker editable after a definite first rejection", async () => {
    fixtures.execute.mockRejectedValueOnce(
      new ApiClientError("Source unavailable", "NOT_FOUND", 404),
    );
    const harness = pageHarness();
    click(harness.render(), "Add published question");
    await settle();
    propsFor(harness.render(), CompanionPublishedQuestionPicker).onInsert(
      publishedQuestionSelection(publishedQuestion),
    );
    await settle();
    expect(propsFor(harness.render(), CompanionPublishedQuestionPicker)).toMatchObject({
      disabled: false,
      catalog: publishedQuestionCatalog,
    });
    expect(button(harness.render(), "Start Presentation").disabled).toBe(false);
  });
});

describe("Companion Quick Check page state", () => {
  it("uses only the scoped bearer credential and preserves omitted cookie credentials", async () => {
    const harness = pageHarness();
    expect(fixtures.controllerOptions?.credential).toEqual({
      projection: "companion",
      companionToken: "companion-pass",
    });
    await fixtures.controllerOptions?.fetchSnapshot();
    expect(fixtures.apiFetch.mock.calls[0]?.[0]).toBe(
      "/v1/presentation-sessions/11111111-1111-4111-8111-111111111111/companion?includeQuickChecks=true&includePublishedQuestions=true",
    );
    expect(fixtures.apiFetch.mock.calls[0]?.[1]).toMatchObject({
      credentials: "omit",
      headers: { authorization: "Bearer companion-pass" },
    });
    harness.open();
    propsFor(harness.render(), CompanionQuickCheckForm).onInsert(quickCheck);
    await settle();
    expect(fixtures.apiFetch.mock.calls[1]?.[0]).toBe(
      "/v1/presentation-sessions/11111111-1111-4111-8111-111111111111/companion-command?includeQuickChecks=true&includePublishedQuestions=true",
    );
    expect(fixtures.apiFetch.mock.calls[1]?.[1]).toMatchObject({
      method: "POST",
      credentials: "omit",
    });
    expect(JSON.parse(fixtures.apiFetch.mock.calls[1]?.[1].body)).toMatchObject({
      companionToken: "companion-pass",
      action: "insert_quick_check",
      quickCheck,
    });
  });

  it("keeps older snapshots without the optional capability usable and hides the unsupported opener", () => {
    const harness = pageHarness();
    const older = initialSnapshot();
    delete older.canInsertQuickCheck;
    harness.broadcast(PresentationCompanionSnapshotSchema.parse(older));
    const tree = harness.render();
    expect(
      elements(tree).some(
        (element) =>
          element.type === "button" &&
          text(element.props.children as ReactNode) === "Add Quick Check",
      ),
    ).toBe(false);
    expect(button(tree, "Start Presentation").disabled).toBe(false);
  });

  it.each(["capability unavailable", "reconciling"])(
    "gates insertion when %s, including stale opener callbacks",
    (reason) => {
      const harness = pageHarness();
      if (reason === "capability unavailable")
        harness.broadcast({ ...initialSnapshot(), canInsertQuickCheck: false });
      else fixtures.canMutate = false;
      const tree = harness.render();
      expect(button(tree, "Add Quick Check").disabled).toBe(true);
      click(tree, "Add Quick Check");
      expect(
        elements(harness.render()).some((element) => element.type === CompanionQuickCheckForm),
      ).toBe(false);
      expect(fixtures.execute).not.toHaveBeenCalled();
    },
  );

  it("keeps the dialog and authored text through a broadcast and closes only after acknowledgement", async () => {
    let acknowledge!: (snapshot: PresentationCompanionSnapshot) => void;
    fixtures.execute.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          acknowledge = resolve;
        }),
    );
    const harness = pageHarness();
    harness.open();
    const overlay = propsFor(harness.render(), CompanionOverlay);
    expect(overlay.title).toBe("Session-only Quick Check");
    expect(overlay.returnFocusRef).toBe(button(harness.render(), "Start Presentation").ref);
    propsFor(harness.render(), CompanionQuickCheckForm).onChange(authoredDraft);
    const form = propsFor(harness.render(), CompanionQuickCheckForm);
    form.onInsert(quickCheck);
    form.onInsert({ ...quickCheck, prompt: "A second click" });
    expect(fixtures.execute).toHaveBeenCalledOnce();
    harness.broadcast({
      ...initialSnapshot(),
      revision: 3,
      seq: 3,
      phase: "question_open",
      acceptingResponses: true,
      canInsertQuickCheck: false,
      canInsertRecoveryPack: false,
    });
    expect(propsFor(harness.render(), CompanionQuickCheckForm)).toMatchObject({
      draft: authoredDraft,
      disabled: true,
    });
    expect(button(harness.render(), "Add Quick Check").disabled).toBe(true);
    acknowledge(fixtures.snapshot!);
    await settle();
    expect(elements(harness.render()).some((element) => element.type === CompanionOverlay)).toBe(
      false,
    );
  });

  it("keeps an exact retry visible after phase/capability changes and feature rollback until acknowledgement", async () => {
    fixtures.execute
      .mockRejectedValueOnce(new Error("Acknowledgement lost"))
      .mockRejectedValueOnce(new ApiClientError("The room has moved", "PHASE_CLOSED", 409))
      .mockResolvedValueOnce({ ...initialSnapshot(), revision: 4 });
    const harness = pageHarness();
    harness.open();
    propsFor(harness.render(), CompanionQuickCheckForm).onChange(authoredDraft);
    propsFor(harness.render(), CompanionQuickCheckForm).onInsert(quickCheck);
    await settle();
    const original = fixtures.execute.mock.calls[0]?.[0];
    const finished: PresentationCompanionSnapshot = {
      ...initialSnapshot(),
      revision: 4,
      seq: 4,
      phase: "finished",
      status: "finished",
      primaryAction: "none",
      canInsertQuickCheck: false,
      canInsertRecoveryPack: false,
      finishedAt: "2026-10-08T12:10:00.000Z",
    };
    harness.broadcast(finished);
    expect(button(harness.render(), "Retry Quick Check acknowledgement").disabled).toBe(false);
    delete finished.canInsertQuickCheck;
    harness.broadcast(finished);
    expect(propsFor(harness.render(), CompanionQuickCheckForm)).toMatchObject({
      draft: authoredDraft,
      disabled: true,
      available: false,
    });
    click(harness.render(), "Retry Quick Check acknowledgement");
    await settle();
    expect(button(harness.render(), "Retry Quick Check acknowledgement").disabled).toBe(false);
    expect(fixtures.execute.mock.calls[1]?.[0]).toBe(original);
    expect(propsFor(harness.render(), CompanionQuickCheckForm).draft).toEqual(authoredDraft);
    click(harness.render(), "Retry Quick Check acknowledgement");
    await settle();
    expect(fixtures.execute.mock.calls[2]?.[0]).toBe(original);
    expect(elements(harness.render()).some((element) => element.type === CompanionOverlay)).toBe(
      false,
    );
  });

  it("preserves the draft and leaves it editable after a definite first rejection and overlay reopening", async () => {
    fixtures.execute.mockRejectedValueOnce(
      new ApiClientError("Please revise the prompt", "VALIDATION_ERROR", 400),
    );
    const harness = pageHarness();
    harness.open();
    propsFor(harness.render(), CompanionQuickCheckForm).onChange(authoredDraft);
    propsFor(harness.render(), CompanionQuickCheckForm).onInsert(quickCheck);
    await settle();
    expect(propsFor(harness.render(), CompanionQuickCheckForm)).toMatchObject({
      draft: authoredDraft,
      disabled: false,
    });
    expect(button(harness.render(), "Start Presentation").disabled).toBe(false);
    propsFor(harness.render(), CompanionOverlay).onClose();
    harness.open();
    expect(propsFor(harness.render(), CompanionQuickCheckForm).draft).toEqual(authoredDraft);
  });
});
