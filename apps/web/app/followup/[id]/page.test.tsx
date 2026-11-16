import type * as ReactModule from "react";
import { isValidElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  supportedLocales,
  type FollowupSnapshot,
  type SupportedLocale,
} from "@openround/contracts";
import { followupCopy } from "../../../lib/i18n/followup-copy";
import FollowupPage from "./page";

interface Hooks {
  cursor: number;
  slots: unknown[];
  effects: Array<{ effect: () => unknown; dependencies?: readonly unknown[] }>;
}
const fixtures = vi.hoisted(() => ({
  hooks: null as Hooks | null,
  locale: "en-CA" as SupportedLocale,
}));
vi.mock("react", async (original) => {
  const react = await original<typeof ReactModule>();
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
        (value: T | ((previous: T) => T)) => {
          hooks.slots[index] =
            typeof value === "function"
              ? (value as (previous: T) => T)(hooks.slots[index] as T)
              : value;
        },
      ];
    },
    useRef: <T,>(initial: T) => {
      const hooks = fixtures.hooks;
      if (!hooks) return react.useRef(initial);
      const index = hooks.cursor++;
      if (!(index in hooks.slots)) hooks.slots[index] = { current: initial };
      return hooks.slots[index] as { current: T };
    },
    useEffect: (effect: () => unknown, dependencies?: readonly unknown[]) => {
      if (fixtures.hooks) fixtures.hooks.effects.push({ effect, dependencies });
      else react.useEffect(effect as Parameters<typeof react.useEffect>[0], dependencies);
    },
  };
});
vi.mock("next/navigation", () => ({ useParams: () => ({ id: "practice" }) }));
vi.mock("../../../components/locale-provider", async () => {
  const { loadMessages, translate, localeDomainsForPath } =
    await import("../../../lib/i18n/catalog");
  const { supportedLocales } = await import("@openround/contracts");
  const messages = Object.fromEntries(
    await Promise.all(
      supportedLocales.map(async (locale) => [
        locale,
        await loadMessages(locale, localeDomainsForPath("/followup/practice")),
      ]),
    ),
  );
  return {
    useLocale: () => ({
      locale: fixtures.locale,
      t: (key: Parameters<typeof translate>[1], values?: Record<string, string | number>) =>
        translate(messages[fixtures.locale]!, key, values),
    }),
  };
});

const fetchMock = vi.fn();
beforeEach(() => {
  fixtures.locale = "en-CA";
  const storage = new Map<string, string>();
  vi.stubGlobal("sessionStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
  const surface = Object.assign(new EventTarget(), {
    location: new URL("https://example.test/followup/practice#token=private-access"),
    history: {
      replaceState: (_state: unknown, _title: string, path: string) => {
        surface.location = new URL(path, surface.location);
      },
    },
    requestAnimationFrame: (callback: () => void) => callback(),
  });
  vi.stubGlobal("window", surface);
  vi.stubGlobal("document", { querySelector: () => null });
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
});
afterEach(() => vi.unstubAllGlobals());

type Element = ReactModule.ReactElement<Record<string, unknown>>;
function find(
  tree: ReactModule.ReactNode,
  predicate: (element: Element) => boolean,
): Element | undefined {
  if (Array.isArray(tree)) return tree.map((child) => find(child, predicate)).find(Boolean);
  if (!isValidElement<Record<string, unknown>>(tree)) return undefined;
  return predicate(tree) ? tree : find(tree.props.children as ReactModule.ReactNode, predicate);
}
function view() {
  const hooks: Hooks = { cursor: 0, slots: [], effects: [] };
  const committedEffects: Array<{ dependencies?: readonly unknown[]; cleanup: unknown }> = [];
  const entry = FollowupPage();
  const content = entry.type as () => ReactModule.ReactNode;
  return {
    render() {
      hooks.cursor = 0;
      hooks.effects = [];
      fixtures.hooks = hooks;
      try {
        return content();
      } finally {
        fixtures.hooks = null;
      }
    },
    async effects() {
      for (const [index, incoming] of hooks.effects.entries()) {
        const previous = committedEffects[index];
        const unchanged =
          previous &&
          incoming.dependencies &&
          previous.dependencies &&
          incoming.dependencies.length === previous.dependencies.length &&
          incoming.dependencies.every((value, offset) =>
            Object.is(value, previous.dependencies![offset]),
          );
        if (unchanged) continue;
        if (typeof previous?.cleanup === "function") previous.cleanup();
        committedEffects[index] = {
          dependencies: incoming.dependencies,
          cleanup: incoming.effect(),
        };
      }
      for (let index = 0; index < 15; index++) await Promise.resolve();
      return () =>
        committedEffects.forEach(({ cleanup }) => {
          if (typeof cleanup === "function") cleanup();
        });
    },
  };
}
const html = (tree: ReactModule.ReactNode) => renderToStaticMarkup(tree);
const button = (tree: ReactModule.ReactNode, name: string) =>
  find(tree, (element) => element.type === "button" && html(element).includes(name))!;
const click = async (element: Element) => {
  await (element.props.onClick as () => Promise<void>)();
  // DOM event wrappers deliberately return void; let the asynchronous command settle.
  for (let index = 0; index < 15; index++) await Promise.resolve();
};
function snapshot(patch: Partial<FollowupSnapshot> = {}): FollowupSnapshot {
  return {
    followupId: "practice",
    attemptId: "attempt",
    version: 1,
    purpose: "recovery",
    status: "in_progress",
    phase: "question_open",
    title: "Authored private title",
    timeMode: "flex",
    timeMultiplier: 1.5,
    questionIndex: 0,
    questionCount: 1,
    question: {
      id: "question",
      type: "single_select",
      purpose: "diagnostic",
      prompt: "Authored prompt 原文",
      confidence: "off",
      choices: [{ id: "choice", label: "Authored choice 原文" }],
    },
    ...patch,
  } as FollowupSnapshot;
}
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });

describe("private follow-up participant rendering and recovery", () => {
  it.each(supportedLocales)(
    "renders system controls in %s while preserving authored text and private access",
    async (locale) => {
      fixtures.locale = locale;
      fetchMock.mockResolvedValue(json({ attemptToken: "private-attempt", snapshot: snapshot() }));
      const page = view();
      const opening = html(page.render());
      expect(opening).toContain(followupCopy(locale)("Opening your private practice…"));
      const cleanup = await page.effects();
      const markup = html(page.render());
      expect(markup).toContain(`lang="${locale}"`);
      expect(markup).toContain(followupCopy(locale)("No countdown"));
      expect(markup).toContain(followupCopy(locale)("Response choices"));
      expect(markup).toContain('lang="" tabindex="-1"');
      expect(markup).toContain("Authored prompt 原文");
      expect(markup).toContain("Authored choice 原文");
      expect(markup).not.toMatch(/live\.(?:presentationPlay|roundPlay|common|host)\./);
      expect(markup).not.toContain("private-attempt");
      expect(window.location.hash).toBe("");
      cleanup();
    },
  );

  it("provides localized missing-access guidance without manufacturing a token or sending a start", async () => {
    fixtures.locale = "ko-KR";
    window.location.hash = "";
    const page = view();
    page.render();
    const cleanup = await page.effects();
    const markup = html(page.render());
    expect(markup).toContain("비공개 접근 토큰이 없습니다");
    expect(markup).toContain('lang="ko-KR"');
    expect(markup).toContain("홈으로 돌아가기");
    expect(fetchMock).not.toHaveBeenCalled();
    cleanup();
  });

  it("renders Korean submit and confidence controls using only the private follow-up route catalogs", async () => {
    fixtures.locale = "ko-KR";
    const question = { ...snapshot().question!, confidence: "required" as const };
    fetchMock.mockResolvedValue(
      json({ attemptToken: "private-attempt", snapshot: snapshot({ question }) }),
    );
    const page = view();
    page.render();
    const cleanup = await page.effects();
    const tree = page.render();
    expect(button(tree, "응답 제출")).toBeDefined();
    expect(button(tree, "잘 모르겠어요")).toBeDefined();
    expect(button(tree, "어느 정도 확신해요")).toBeDefined();
    expect(button(tree, "매우 확신해요")).toBeDefined();
    expect(html(tree)).toContain("(필수)");
    expect(html(tree)).not.toContain("live.presentationPlay.submit");
    cleanup();
  });

  it("passes Korean labels into the real timed follow-up countdown", async () => {
    fixtures.locale = "ko-KR";
    fetchMock.mockResolvedValue(
      json({
        attemptToken: "private-attempt",
        snapshot: snapshot({ timeMode: "timed", deadline: "2000-01-01T00:00:00.000Z" }),
      }),
    );
    const page = view();
    page.render();
    const cleanup = await page.effects();
    const markup = html(page.render());
    expect(markup).toContain('role="timer">0초');
    expect(markup).toContain("시간이 다 되었습니다");
    expect(markup).not.toContain("Time is up");
    cleanup();
  });

  it.each(["This follow-up has expired", "Unrecognized upstream diagnostic 9f2"])(
    "keeps denied access safe and attributes %s",
    async (message) => {
      fixtures.locale = "fr-FR";
      fetchMock.mockResolvedValue(json({ error: { code: "UNAUTHORIZED", message } }, 401));
      const page = view();
      page.render();
      const cleanup = await page.effects();
      const markup = html(page.render());
      expect(markup).toContain(
        message.startsWith("This follow-up") ? "Ce suivi a expiré" : message,
      );
      expect(markup).toContain(
        message.startsWith("This follow-up") ? 'lang="fr-FR"' : 'lang="en-CA"',
      );
      expect(markup).not.toContain("Authored prompt");
      expect(markup).not.toContain("private-access");
      cleanup();
    },
  );

  it("retries an opening ACK failure with the same reserved attempt identity", async () => {
    fetchMock
      .mockRejectedValueOnce(new TypeError("ACK lost"))
      .mockResolvedValueOnce(json({ attemptToken: "private-attempt", snapshot: snapshot() }));
    const page = view();
    page.render();
    const cleanup = await page.effects();
    await click(button(page.render(), "Retry opening practice"));
    page.render();
    await page.effects();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]![1].body).toBe(fetchMock.mock.calls[0]![1].body);
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body)).toHaveProperty("attemptToken");
    expect(html(page.render())).toContain("Authored prompt 原文");
    cleanup();
  });

  it("loads a replacement private link after one failed opening retry without reusing the old access nonce", async () => {
    fetchMock
      .mockRejectedValueOnce(new TypeError("Initial opening ACK lost"))
      .mockRejectedValueOnce(new TypeError("Opening retry ACK lost"))
      .mockResolvedValueOnce(
        json({
          attemptToken: "replacement-attempt-token",
          snapshot: snapshot({
            attemptId: "replacement-attempt",
            title: "Replacement private practice",
          }),
        }),
      );
    const page = view();
    page.render();
    const cleanup = await page.effects();
    await click(button(page.render(), "Retry opening practice"));
    page.render();
    await page.effects();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]![1].body).toBe(fetchMock.mock.calls[0]![1].body);
    const originalNonce = JSON.parse(fetchMock.mock.calls[0]![1].body).attemptToken;
    window.location.hash = "#token=replacement-private-access";
    window.dispatchEvent(new Event("hashchange"));
    page.render();
    await page.effects();
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[2]![1].headers.authorization).toBe(
      "Bearer replacement-private-access",
    );
    expect(JSON.parse(fetchMock.mock.calls[2]![1].body).attemptToken).not.toBe(originalNonce);
    expect(html(page.render())).toContain("Replacement private practice");
    expect(sessionStorage.getItem("openround:followup-attempt:practice")).toBe(
      "replacement-attempt-token",
    );
    expect(sessionStorage.getItem("openround:followup-pending-attempt:practice")).toBeNull();
    expect(window.location.hash).toBe("");
    cleanup();
  });

  it("localizes ambiguous-answer retry while preserving the exact command and locking new intent", async () => {
    fetchMock.mockResolvedValueOnce(
      json({ attemptToken: "private-attempt", snapshot: snapshot() }),
    );
    const page = view();
    page.render();
    const cleanup = await page.effects();
    await click(button(page.render(), "Authored choice 原文"));
    fetchMock.mockRejectedValueOnce(new TypeError("ACK lost"));
    await click(button(page.render(), "Submit response"));
    fixtures.locale = "ko-KR";
    const pending = page.render();
    expect(html(pending)).toContain("같은 요청을 다시 시도하세요");
    expect(button(pending, "Authored choice 原文").props.disabled).toBe(true);
    fetchMock.mockResolvedValueOnce(
      json({ snapshot: snapshot({ version: 2, phase: "answer_reveal", correct: true }) }),
    );
    await click(button(pending, "답변 확인 다시 시도"));
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[2]![0]).toBe(fetchMock.mock.calls[1]![0]);
    expect(fetchMock.mock.calls[2]![1].body).toBe(fetchMock.mock.calls[1]![1].body);
    expect(JSON.parse(fetchMock.mock.calls[2]![1].body)).toMatchObject({
      questionId: "question",
      expectedVersion: 1,
      response: { kind: "choice", choiceIds: ["choice"] },
    });
    expect(html(page.render())).toContain("후속 학습 마치기");
    cleanup();
  });
});
