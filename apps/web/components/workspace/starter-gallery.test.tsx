import { isValidElement, type ReactElement, type ReactNode } from "react";
import type * as ReactModule from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { QuizDraft, StarterSummary, SupportedLocale } from "@openround/contracts";
import { StarterGallery } from "./starter-gallery";

interface Hooks {
  cursor: number;
  slots: unknown[];
  effects: (() => void)[];
}
const mocked = vi.hoisted(() => ({
  hooks: null as Hooks | null,
  fetch: vi.fn(),
  push: vi.fn(),
  locale: "ko-KR" as SupportedLocale,
  canEdit: true,
}));
const equalDeps = (first: readonly unknown[] | undefined, second: readonly unknown[] | undefined) =>
  Boolean(
    first &&
    second &&
    first.length === second.length &&
    first.every((value, index) => Object.is(value, second[index])),
  );
vi.mock("react", async (original) => {
  const react = await original<typeof ReactModule>();
  return {
    ...react,
    useState: <T,>(initial: T | (() => T)) => {
      if (!mocked.hooks) return react.useState(initial);
      const hooks = mocked.hooks,
        index = hooks.cursor++;
      if (!(index in hooks.slots))
        hooks.slots[index] = typeof initial === "function" ? (initial as () => T)() : initial;
      return [
        hooks.slots[index] as T,
        (value: T | ((old: T) => T)) => {
          hooks.slots[index] =
            typeof value === "function" ? (value as (old: T) => T)(hooks.slots[index] as T) : value;
        },
      ];
    },
    useRef: <T,>(initial: T) => {
      if (!mocked.hooks) return react.useRef(initial);
      const hooks = mocked.hooks,
        index = hooks.cursor++;
      if (!(index in hooks.slots)) hooks.slots[index] = { current: initial };
      return hooks.slots[index];
    },
    useCallback: <T,>(callback: T, deps: readonly unknown[]) => {
      if (!mocked.hooks) return callback;
      const hooks = mocked.hooks,
        index = hooks.cursor++;
      const previous = hooks.slots[index] as { value: T; deps: readonly unknown[] } | undefined;
      if (!previous || !equalDeps(previous.deps, deps))
        hooks.slots[index] = { value: callback, deps };
      return (hooks.slots[index] as { value: T }).value;
    },
    useEffect: (effect: ReactModule.EffectCallback, deps: readonly unknown[]) => {
      if (!mocked.hooks) return react.useEffect(effect, deps);
      const hooks = mocked.hooks,
        index = hooks.cursor++;
      const previous = hooks.slots[index] as
        { deps: readonly unknown[]; cleanup?: () => void } | undefined;
      if (!previous || !equalDeps(previous.deps, deps)) {
        hooks.effects.push(() => {
          previous?.cleanup?.();
          const cleanup = effect();
          hooks.slots[index] = {
            deps,
            cleanup: typeof cleanup === "function" ? cleanup : undefined,
          };
        });
      }
    },
  };
});
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocked.push }) }));
vi.mock("../../lib/api", () => ({
  apiFetch: mocked.fetch,
  humanError: (error: Error) => error.message,
  ApiClientError: class extends Error {},
}));
vi.mock("../locale-provider", () => ({
  useLocale: () => ({ locale: mocked.locale, t: (key: string) => key }),
}));
vi.mock("./workspace-provider", () => ({
  useWorkspace: () => ({
    creator: { segment: "all" },
    canEdit: mocked.canEdit,
    productFeatures: { surveys: true },
  }),
}));
vi.mock("./product-events", () => ({
  recordCreationEvent: vi.fn(),
  recordAuthoringEvent: vi.fn(),
}));

function elements(node: ReactNode): Array<ReactElement<Record<string, unknown>>> {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement<Record<string, unknown>>(node)) return [];
  return [node, ...elements(node.props.children as ReactNode)];
}
function harness(survey = false) {
  const hooks: Hooks = { cursor: 0, slots: [], effects: [] };
  let tree: ReactNode;
  return {
    render() {
      hooks.cursor = 0;
      mocked.hooks = hooks;
      try {
        tree = StarterGallery({ survey });
      } finally {
        mocked.hooks = null;
      }
      for (const effect of hooks.effects.splice(0)) effect();
    },
    markup: () => renderToStaticMarkup(tree),
    button(label: string) {
      const found = elements(tree).find(
        (element) => element.type === "button" && element.props.children === label,
      );
      if (!found) throw new Error(`Missing button ${label}`);
      const handler = found.props.onClick as (event: {
        currentTarget: { focus: () => void };
      }) => Promise<void>;
      return () => handler({ currentTarget: { focus: () => undefined } });
    },
    disabled(label: string) {
      return (
        elements(tree).find(
          (element) => element.type === "button" && element.props.children === label,
        )?.props.disabled === true
      );
    },
  };
}
function summary(locale: SupportedLocale): StarterSummary {
  return {
    id: "training-feedback",
    title: locale === "ko-KR" ? "교육 피드백" : "Retours sur la formation",
    description: locale === "ko-KR" ? "편집 가능한 원본" : "Contenu original modifiable",
    previewPrompt: locale === "ko-KR" ? "무엇이 필요하나요?" : "De quoi avez-vous besoin ?",
    questionCount: 1,
    responseTypes: ["poll"],
    category: "general",
    segment: "all",
    experiencePreset: { id: "focus", version: 1 },
    version: 1,
    roundType: "poll",
  };
}
function draft(locale: SupportedLocale): QuizDraft {
  const item = summary(locale);
  return {
    title: item.title,
    description: item.description,
    category: item.category,
    experiencePreset: item.experiencePreset,
    questions: [
      {
        id: "00000000-0000-4000-8000-000000000001",
        type: "poll",
        prompt: item.previewPrompt!,
        purpose: "opinion",
        confidence: "off",
        delivery: "main",
        conceptKeys: [],
        linkedRecheckQuestionId: null,
        timeLimitSeconds: 30,
        basePoints: 0,
        explanation: "",
        mediaId: null,
        mediaAlt: null,
        choices: [
          { id: "00000000-0000-4000-8000-000000000002", label: "Author text", isCorrect: false },
          { id: "00000000-0000-4000-8000-000000000003", label: "Other text", isCorrect: false },
        ],
      },
    ],
  };
}
async function settle() {
  for (let index = 0; index < 12; index++) await Promise.resolve();
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
beforeEach(() => {
  vi.clearAllMocks();
  mocked.locale = "ko-KR";
  mocked.canEdit = true;
  mocked.hooks = null;
});

describe("creation-locale starter gallery", () => {
  it("retains old-language cards but blocks new preview and creation until a delayed or failed reload is recovered", async () => {
    const french = deferred<{ starters: StarterSummary[] }>();
    let recovery = false;
    mocked.fetch.mockImplementation(async (url: string, options?: { method?: string }) => {
      if (options?.method === "POST") return { quiz: { id: "unexpected" } };
      if (url.includes("/training-feedback?")) return { draft: draft("ko-KR") };
      if (url.endsWith("fr-FR"))
        return recovery ? { starters: [summary("fr-FR")] } : french.promise;
      return { starters: [summary("ko-KR")] };
    });
    const view = harness();
    view.render();
    await settle();
    view.render();
    mocked.locale = "fr-FR";
    view.render();
    expect(view.markup()).toContain("교육 피드백");
    expect(view.markup()).toContain('lang="ko-KR"');
    expect(view.disabled("starter.use")).toBe(true);
    expect(view.disabled("starter.preview")).toBe(true);
    await view.button("starter.use")();
    await view.button("starter.preview")();
    expect(
      mocked.fetch.mock.calls.some(
        (call) => call[1]?.method === "POST" || call[0].includes("/training-feedback?"),
      ),
    ).toBe(false);
    french.reject(new Error("Catalog unavailable"));
    await settle();
    view.render();
    expect(view.markup()).toContain("Catalog unavailable");
    expect(view.disabled("starter.use")).toBe(true);
    expect(view.disabled("starter.preview")).toBe(true);
    await view.button("starter.use")();
    await view.button("starter.preview")();
    expect(mocked.fetch.mock.calls.some((call) => call[1]?.method === "POST")).toBe(false);
    recovery = true;
    await view.button("starter.retry")();
    await settle();
    view.render();
    expect(view.markup()).toContain("Retours sur la formation");
    expect(view.disabled("starter.use")).toBe(false);
    expect(view.disabled("starter.preview")).toBe(false);
  });

  it("ignores stale list and preview responses without creating anything on language changes", async () => {
    const korean = deferred<{ starters: StarterSummary[] }>(),
      french = deferred<{ starters: StarterSummary[] }>();
    const oldPreview = deferred<{ draft: QuizDraft }>();
    mocked.fetch.mockImplementation((url: string) =>
      url.startsWith("/v1/starters?")
        ? url.endsWith("ko-KR")
          ? korean.promise
          : french.promise
        : oldPreview.promise,
    );
    const view = harness();
    view.render();
    mocked.locale = "fr-FR";
    view.render();
    french.resolve({ starters: [summary("fr-FR")] });
    await settle();
    view.render();
    expect(view.markup()).toContain("Retours sur la formation");
    korean.resolve({ starters: [summary("ko-KR")] });
    await settle();
    view.render();
    expect(view.markup()).not.toContain("교육 피드백");
    const pending = view.button("starter.preview")();
    mocked.locale = "ko-KR";
    view.render();
    await settle();
    view.render();
    oldPreview.resolve({ draft: draft("fr-FR") });
    await pending;
    view.render();
    expect(view.markup()).not.toContain("Author text");
    expect(mocked.fetch.mock.calls.every((call) => !call[1]?.method)).toBe(true);
  });

  it("retains reviewed preview text and its language while later creation uses the current locale", async () => {
    mocked.fetch.mockImplementation(async (url: string, options?: { method?: string }) => {
      if (options?.method === "POST") return { quiz: { id: "new-round" } };
      const locale = url.endsWith("ko-KR") ? "ko-KR" : "fr-FR";
      return url.startsWith("/v1/starters?")
        ? { starters: [summary(locale)] }
        : { draft: draft(locale) };
    });
    const view = harness();
    view.render();
    await settle();
    view.render();
    await view.button("starter.preview")();
    view.render();
    expect(view.markup()).toContain("Author text");
    mocked.locale = "fr-FR";
    view.render();
    expect(view.disabled("starter.closePreview")).toBe(false);
    expect(view.disabled("starter.use")).toBe(true);
    await settle();
    view.render();
    expect(view.markup()).toContain("Retours sur la formation");
    expect(view.markup()).toContain('lang="ko-KR"');
    expect(view.markup()).toContain("무엇이 필요하나요?");
    expect(mocked.fetch.mock.calls.filter((call) => call[1]?.method === "POST")).toHaveLength(0);
    await view.button("starter.use")();
    expect(mocked.fetch).toHaveBeenLastCalledWith("/v1/starters/training-feedback/use", {
      method: "POST",
      body: JSON.stringify({ locale: "fr-FR" }),
    });
    expect(mocked.push).toHaveBeenCalledWith("/quiz/new-round");
  });

  it("uses the Survey catalog and previews its exact participant copy and optionality for viewers", async () => {
    mocked.locale = "en-CA";
    mocked.canEdit = false;
    const source = draft("ko-KR");
    const item = summary("ko-KR");
    mocked.fetch.mockImplementation(async (url: string) => {
      if (url.startsWith("/v1/surveys/templates?")) return { templates: [item] };
      if (url.startsWith("/v1/surveys/templates/training-feedback?"))
        return {
          draft: {
            schemaVersion: 2,
            title: source.title,
            description: "You may skip the optional question.",
            category: source.category,
            experiencePreset: source.experiencePreset,
            items: [{ required: false, question: source.questions[0] }],
          },
        };
      throw new Error(`Unexpected route ${url}`);
    });
    const view = harness(true);
    view.render();
    await settle();
    view.render();
    expect(mocked.fetch).toHaveBeenCalledWith("/v1/surveys/templates?locale=en-CA");
    await view.button("Preview questionnaire")();
    view.render();
    expect(view.markup()).toContain('id="starter-preview-training-feedback"');
    expect(view.markup()).toContain("You may skip the optional question.");
    expect(view.markup()).toContain("Optional");
    expect(view.markup()).not.toContain("Correct answer");
    expect(view.markup()).not.toContain("starter.use");
    expect(
      mocked.fetch.mock.calls.every(([, options]) => !options?.method || options.method === "GET"),
    ).toBe(true);
  });

  it("retries a lost Survey creation with the original exact body and locale", async () => {
    let attempts = 0;
    mocked.fetch.mockImplementation(async (url: string, options?: { method?: string }) => {
      if (options?.method === "POST") {
        if (++attempts === 1) throw new Error("Lost response");
        return { survey: { id: "accepted-survey" } };
      }
      return { templates: [summary(url.endsWith("ko-KR") ? "ko-KR" : "fr-FR")] };
    });
    const view = harness(true);
    view.render();
    await settle();
    view.render();
    await view.button("starter.use")();
    view.render();
    const initial = mocked.fetch.mock.calls.find((call) => call[1]?.method === "POST")!;
    expect(JSON.parse(initial[1].body)).toMatchObject({
      templateId: "training-feedback",
      locale: "ko-KR",
    });
    mocked.locale = "fr-FR";
    view.render();
    await settle();
    view.render();
    expect(attempts).toBe(1);
    await view.button("starter.use")();
    expect(mocked.fetch.mock.calls.filter((call) => call[1]?.method === "POST")[1]).toEqual(
      initial,
    );
    expect(mocked.push).toHaveBeenCalledWith("/surveys/accepted-survey");
  });
});
