import { isValidElement, type ReactElement, type ReactNode } from "react";
import type * as ReactModule from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { QuizDraft, StarterSummary, SupportedLocale } from "@openround/contracts";
import { StarterGallery } from "./starter-gallery";
import { StarterTemplatePreview } from "./starter-template-preview";
import { starterCopyCopy } from "../../lib/i18n/starter-copy-copy";
import { starterCopyStorageKey } from "../../lib/starter-copy-intent";

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
  userId: "00000000-0000-4000-8000-000000000001",
  workspaceId: "00000000-0000-4000-8000-000000000002",
  surveys: true,
  rankingPolls: true,
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
  apiFetch: (url: string, options?: RequestInit) => {
    const result = mocked.fetch(url, ...(options ? [options] : []));
    return url.startsWith("/v1/starters") && !options?.method
      ? Promise.resolve(result).then((value) => ({ contentVersion: "test-v1", ...value }))
      : result;
  },
  humanError: (error: Error) => error.message,
  ApiClientError: class extends Error {},
  AUTH_CHANGE_EVENT: "pollingpops:auth-change",
}));
vi.mock("../locale-provider", () => ({
  useLocale: () => ({
    locale: mocked.locale,
    t: (key: string, values?: { count?: string }) =>
      values?.count === undefined ? key : `${key}:${values.count}`,
  }),
}));
vi.mock("./workspace-provider", () => ({
  useWorkspace: () => ({
    creator: {
      userId: mocked.userId,
      workspaceId: mocked.workspaceId,
      segment: "all",
      role: mocked.canEdit ? "owner" : "viewer",
    },
    canEdit: mocked.canEdit,
    productFeatures: { surveys: mocked.surveys, rankingPolls: mocked.rankingPolls },
    loading: false,
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
function harness(survey = false, compact = true, collection: "team-meetings" | null = null) {
  const hooks: Hooks = { cursor: 0, slots: [], effects: [] };
  let tree: ReactNode;
  const controls = () => [
    ...elements(tree),
    ...elements(tree)
      .filter((element) => element.type === StarterTemplatePreview)
      .flatMap((element) => elements(element.props.actionNotice as ReactNode)),
  ];
  return {
    render() {
      hooks.cursor = 0;
      mocked.hooks = hooks;
      try {
        tree = StarterGallery({ survey, compact, collection });
      } finally {
        mocked.hooks = null;
      }
      for (const effect of hooks.effects.splice(0)) effect();
    },
    markup: () => renderToStaticMarkup(tree),
    changeCollection(next: "team-meetings" | null) {
      collection = next;
    },
    searchValue: () =>
      elements(tree).find((element) => element.type === "input" && element.props.type === "search")
        ?.props.value,
    preview() {
      const found = elements(tree).find((element) => element.type === StarterTemplatePreview);
      if (!found) throw new Error("Missing preview");
      return found.props as unknown as ReactModule.ComponentProps<typeof StarterTemplatePreview>;
    },
    changeSearch(value: string) {
      const found = elements(tree).find(
        (element) => element.type === "input" && element.props.type === "search",
      );
      (found?.props.onChange as (event: { target: { value: string } }) => void)({
        target: { value },
      });
    },
    selectStarter(id: string) {
      const found = elements(tree).find(
        (element) =>
          element.type === "select" &&
          elements(element.props.children as ReactNode).some(
            (option) => option.type === "option" && option.props.value === id,
          ),
      );
      (found?.props.onChange as (event: unknown) => void)({ target: { value: id } });
    },
    unmount() {
      for (const slot of hooks.slots) (slot as { cleanup?: () => void } | undefined)?.cleanup?.();
    },
    button(label: string) {
      const found = controls().find(
        (element) => element.type === "button" && element.props.children === label,
      );
      if (!found) throw new Error(`Missing button ${label}`);
      const handler = found.props.onClick as (event: {
        currentTarget: { focus: () => void };
      }) => Promise<void>;
      return async () => {
        await handler({ currentTarget: { focus: () => undefined } });
        await settle();
      };
    },
    disabled(label: string) {
      return (
        controls().find((element) => element.type === "button" && element.props.children === label)
          ?.props.disabled === true
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
  mocked.userId = "00000000-0000-4000-8000-000000000001";
  mocked.workspaceId = "00000000-0000-4000-8000-000000000002";
  mocked.surveys = true;
  mocked.rankingPolls = true;
  mocked.hooks = null;
  const values = new Map<string, string>();
  const target = new EventTarget();
  Object.assign(target, {
    sessionStorage: {
      getItem: vi.fn((key: string) => values.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => {
        values.set(key, value);
      }),
      removeItem: vi.fn((key: string) => {
        values.delete(key);
      }),
    },
  });
  vi.stubGlobal("window", target);
});

describe("creation-locale starter gallery", () => {
  async function ready(view: ReturnType<typeof harness>) {
    for (let index = 0; index < 4; index++) {
      view.render();
      await settle();
    }
    view.render();
  }

  describe("collection changes during a copy", () => {
    function source(survey: boolean) {
      const member = {
        ...summary("ko-KR"),
        id: survey ? "team-collaboration" : "meeting-priorities",
      } as StarterSummary;
      const content = draft("ko-KR");
      return {
        member,
        catalog: survey
          ? { templates: [member, summary("ko-KR")] }
          : { starters: [member, summary("ko-KR")] },
        preview: {
          draft: survey
            ? {
                ...content,
                schemaVersion: 2,
                items: [{ question: content.questions[0], required: false }],
              }
            : content,
        },
      };
    }

    it.each([false, true])(
      "keeps the busy guard and successful navigation across collection changes (Survey=%s)",
      async (survey) => {
        const pending = deferred<unknown>();
        const fixture = source(survey);
        mocked.fetch.mockImplementation(async (url: string, options?: { method?: string }) => {
          if (options?.method === "POST") return pending.promise;
          return url.includes("templates?") || url.startsWith("/v1/starters?")
            ? fixture.catalog
            : fixture.preview;
        });
        const view = harness(survey, false, "team-meetings");
        await ready(view);
        view.preview().onUse!();
        view.changeCollection(null);
        await ready(view);
        expect(view.preview().useDisabled).toBe(true);
        view.preview().onUse!();
        view.changeCollection("team-meetings");
        await ready(view);
        view.preview().onUse!();
        expect(mocked.fetch.mock.calls.filter((call) => call[1]?.method === "POST")).toHaveLength(
          1,
        );
        pending.resolve(survey ? { survey: { id: "one-copy" } } : { quiz: { id: "one-copy" } });
        await settle();
        expect(mocked.push).toHaveBeenCalledExactlyOnceWith(
          survey ? "/surveys/one-copy" : "/quiz/one-copy",
        );
      },
    );

    it("retains a failed Survey intent and resets browsing filters across both collection directions", async () => {
      const pending = deferred<unknown>();
      const fixture = source(true);
      let attempts = 0;
      mocked.fetch.mockImplementation(async (url: string, options?: { method?: string }) => {
        if (options?.method === "POST") {
          if (++attempts === 1) throw new Error("Acknowledgement lost");
          return pending.promise;
        }
        return url.includes("templates?") ? fixture.catalog : fixture.preview;
      });
      const view = harness(true, false);
      await ready(view);
      view.preview().onUse!();
      await settle();
      view.changeSearch("No matching templates");
      await ready(view);
      expect(view.markup()).toContain("starter.noMatches");
      view.changeCollection("team-meetings");
      await ready(view);
      expect(view.searchValue()).toBe("");
      expect(view.preview().id).toBe(fixture.member.id);
      expect(view.preview().actionError).toBe("Acknowledgement lost");
      view.preview().onUse!();
      const requests = mocked.fetch.mock.calls.filter((call) => call[1]?.method === "POST");
      expect(requests).toHaveLength(2);
      expect(requests[1]![1].body).toBe(requests[0]![1].body);
      view.changeSearch("No matching templates");
      await ready(view);
      view.changeCollection(null);
      await ready(view);
      expect(view.searchValue()).toBe("");
      expect(view.preview().useDisabled).toBe(true);
      pending.resolve({ survey: { id: "original-copy" } });
      await settle();
      expect(mocked.push).toHaveBeenCalledExactlyOnceWith("/surveys/original-copy");
    });
  });

  it.each([false, true])(
    "filters the collection before automatic preview and matching counts (Survey=%s)",
    async (survey) => {
      const originals: StarterSummary[] = [
        { ...summary("ko-KR"), id: "meeting-priorities", title: "Meeting priorities" },
        { ...summary("ko-KR"), id: "team-retrospective", title: "Team retrospective" },
        { ...summary("ko-KR"), id: "team-collaboration", title: "How we work together" },
        summary("ko-KR"),
      ];
      mocked.fetch.mockImplementation(async (url: string) => {
        if (url.startsWith("/v1/starters?")) return { starters: originals };
        if (url.startsWith("/v1/surveys/templates?")) return { templates: originals };
        return {
          draft: survey
            ? { items: [{ question: draft("ko-KR").questions[0], required: false }] }
            : draft("ko-KR"),
        };
      });
      const view = harness(survey, false, "team-meetings");
      await ready(view);
      const html = view.markup();
      expect(html.match(/data-template-id=/g)).toHaveLength(survey ? 1 : 2);
      expect(html).not.toContain('data-template-id="training-feedback"');
      expect(view.preview().id).toBe(survey ? "team-collaboration" : "meeting-priorities");
      expect(
        mocked.fetch.mock.calls.every(
          ([url, options]) => !url.includes("training-feedback") && !options?.method,
        ),
      ).toBe(true);
      view.changeSearch("missing topic");
      await ready(view);
      expect(view.markup()).toContain("starter.noMatches");
      expect(view.markup()).not.toContain("starter-preview-");
    },
  );

  it("browses summaries beside the full selected preview without writes, then creates one independent Round copy", async () => {
    const pending = deferred<{ quiz: { id: string } }>();
    const source = draft("ko-KR");
    const before = JSON.stringify(source);
    mocked.fetch.mockImplementation(async (url: string, options?: { method?: string }) => {
      if (options?.method === "POST") return pending.promise;
      return url.startsWith("/v1/starters?") ? { starters: [summary("ko-KR")] } : { draft: source };
    });
    const view = harness(false, false);
    await ready(view);
    expect(view.markup()).toContain('<section id="starter-preview-training-feedback"');
    expect(view.markup()).not.toContain("<dialog");
    expect(view.markup()).toContain('aria-pressed="true"');
    expect(view.markup()).toContain("Author text");
    expect(view.preview().content).toEqual({ kind: "round", draft: source });
    expect(mocked.fetch.mock.calls.every((call) => !call[1]?.method)).toBe(true);
    view.preview().onUse!();
    view.preview().onUse!();
    expect(mocked.fetch.mock.calls.filter((call) => call[1]?.method === "POST")).toHaveLength(1);
    expect(mocked.fetch).toHaveBeenLastCalledWith("/v1/starters/training-feedback/use", {
      method: "POST",
      body: expect.any(String),
    });
    expect(JSON.parse(mocked.fetch.mock.calls.at(-1)![1].body)).toMatchObject({
      locale: "ko-KR",
      contentVersion: "test-v1",
      creationContext: { actorId: mocked.userId, workspaceId: mocked.workspaceId },
      idempotencyKey: expect.any(String),
      expiresAt: expect.any(String),
    });
    pending.resolve({ quiz: { id: "independent-copy" } });
    await settle();
    expect(mocked.push).toHaveBeenCalledExactlyOnceWith("/quiz/independent-copy");
    expect(JSON.stringify(source)).toBe(before);
  });

  it("shows preview loading and retry states, and offers the Survey copy action only after its exact content loads", async () => {
    const pending = deferred<{ draft: unknown }>();
    let retry = false;
    const source = draft("ko-KR");
    const survey = {
      schemaVersion: 2,
      title: source.title,
      description: "Optional feedback stays optional.",
      category: source.category,
      experiencePreset: source.experiencePreset,
      items: [{ required: false, question: source.questions[0] }],
    };
    mocked.fetch.mockImplementation(async (url: string, options?: { method?: string }) => {
      if (options?.method === "POST") return { survey: { id: "survey-copy" } };
      if (url.startsWith("/v1/surveys/templates?")) return { templates: [summary("ko-KR")] };
      return retry ? { draft: survey } : pending.promise;
    });
    const view = harness(true, false);
    await ready(view);
    expect(view.preview().loading).toBe(true);
    expect(view.preview().content).toBeUndefined();
    view.preview().onUse!();
    expect(mocked.fetch.mock.calls.some((call) => call[1]?.method === "POST")).toBe(false);
    pending.reject(new Error("Preview unavailable"));
    await settle();
    view.render();
    expect(view.markup()).toContain("Preview unavailable");
    expect(view.preview().error).toBe("Preview unavailable");
    retry = true;
    view.preview().onRetry!();
    await settle();
    view.render();
    expect(view.markup()).toContain(survey.description);
    expect(view.markup()).toContain("선택");
    view.preview().onUse!();
    await settle();
    expect(mocked.push).toHaveBeenCalledExactlyOnceWith("/surveys/survey-copy");
  });

  describe.each(["Round", "Survey"] as const)("pending %s copy", (kind) => {
    const survey = kind === "Survey";
    it.each([false, true])(
      "preserves the submitted copy's navigation after changing or closing the preview (compact=%s)",
      async (compact) => {
        const pending = deferred<unknown>();
        const source = draft("ko-KR");
        const second = { ...summary("ko-KR"), id: "second", title: "Second template" };
        mocked.fetch.mockImplementation(async (url: string, options?: { method?: string }) => {
          if (options?.method === "POST") return pending.promise;
          if (url.includes("templates?") || url.startsWith("/v1/starters?"))
            return survey
              ? { templates: [summary("ko-KR"), second] }
              : { starters: [summary("ko-KR"), second] };
          return {
            draft: survey
              ? {
                  ...source,
                  schemaVersion: 2,
                  items: [{ required: false, question: source.questions[0] }],
                }
              : source,
          };
        });
        const view = harness(survey, compact);
        await ready(view);
        if (compact) {
          await view.button(survey ? "설문지 미리 보기" : "starter.preview")();
          view.render();
        }
        const originalUse = view.preview().onUse!;
        originalUse();
        view.render();
        if (compact) view.preview().onClose();
        else view.changeSearch("Second");
        await ready(view);
        if (compact) expect(view.markup()).not.toContain("<dialog");
        else {
          expect(view.preview().id).toBe("second");
          view.preview().onUse!();
        }
        originalUse();
        expect(mocked.fetch.mock.calls.filter((call) => call[1]?.method === "POST")).toHaveLength(
          1,
        );
        pending.resolve(
          survey ? { survey: { id: "submitted-copy" } } : { quiz: { id: "submitted-copy" } },
        );
        await settle();
        expect(mocked.push).toHaveBeenCalledExactlyOnceWith(
          survey ? "/surveys/submitted-copy" : "/quiz/submitted-copy",
        );
      },
    );

    it.each([false, true])(
      "shows a delayed copy failure after filtering away or closing the preview (compact=%s)",
      async (compact) => {
        const pending = deferred<unknown>();
        const retry = deferred<unknown>();
        let attempts = 0;
        const source = draft("ko-KR");
        mocked.fetch.mockImplementation(async (url: string, options?: { method?: string }) => {
          if (options?.method === "POST") return ++attempts === 1 ? pending.promise : retry.promise;
          if (url.includes("templates?") || url.startsWith("/v1/starters?"))
            return survey ? { templates: [summary("ko-KR")] } : { starters: [summary("ko-KR")] };
          return {
            draft: survey
              ? {
                  ...source,
                  schemaVersion: 2,
                  items: [{ required: false, question: source.questions[0] }],
                }
              : source,
          };
        });
        const view = harness(survey, compact);
        await ready(view);
        if (compact) {
          await view.button(survey ? "설문지 미리 보기" : "starter.preview")();
          view.render();
        }
        view.preview().onUse!();
        view.render();
        if (compact) view.preview().onClose();
        else view.changeSearch("No matching template");
        await ready(view);
        pending.reject(new Error("Delayed copy failure"));
        await settle();
        view.render();
        expect(mocked.push).not.toHaveBeenCalled();
        expect(view.markup()).toContain('role="alert"');
        expect(view.markup()).toContain("Delayed copy failure");
        if (compact) expect(view.disabled("starter.use")).toBe(false);
        if (compact) await view.button(survey ? "설문지 미리 보기" : "starter.preview")();
        else view.changeSearch("");
        await ready(view);
        expect(view.preview().actionError).toBe("Delayed copy failure");
        view.preview().onUse!();
        view.render();
        expect(view.preview().actionError).toBe("");
        const requests = mocked.fetch.mock.calls.filter((call) => call[1]?.method === "POST");
        expect(requests).toHaveLength(2);
        if (survey) expect(requests[1]![1].body).toBe(requests[0]![1].body);
        retry.resolve(
          survey ? { survey: { id: "retried-copy" } } : { quiz: { id: "retried-copy" } },
        );
        await settle();
        expect(mocked.push).toHaveBeenCalledExactlyOnceWith(
          survey ? "/surveys/retried-copy" : "/quiz/retried-copy",
        );
      },
    );
  });

  it("fences late selections and stale preview actions when search changes the visible result", async () => {
    const first = deferred<{ draft: QuizDraft }>();
    const second = { ...summary("ko-KR"), id: "second", title: "Second template" };
    mocked.fetch.mockImplementation(async (url: string) => {
      if (url.startsWith("/v1/starters?")) return { starters: [summary("ko-KR"), second] };
      return url.includes("/second?")
        ? { draft: { ...draft("ko-KR"), title: second.title } }
        : first.promise;
    });
    const view = harness(false, false);
    await ready(view);
    const oldAction = view.preview().onUse!;
    view.changeSearch("Second");
    await ready(view);
    expect(view.preview().id).toBe("second");
    oldAction();
    first.resolve({ draft: draft("ko-KR") });
    await settle();
    view.render();
    expect(view.preview().id).toBe("second");
    expect(view.preview().content?.draft.title).toBe("Second template");
    expect(mocked.fetch.mock.calls.every((call) => !call[1]?.method)).toBe(true);
  });

  it.each(["locale", "workspace", "user", "role", "feature", "auth", "unmount"] as const)(
    "fences captured Survey actions and late navigation after a %s change",
    async (change) => {
      const pending = deferred<{ survey: { id: string } }>();
      const source = draft("ko-KR");
      mocked.fetch.mockImplementation(async (url: string, options?: { method?: string }) => {
        if (options?.method === "POST") return pending.promise;
        if (url.startsWith("/v1/surveys/templates?")) return { templates: [summary("ko-KR")] };
        return {
          draft: {
            schemaVersion: 2,
            title: source.title,
            description: source.description,
            category: source.category,
            experiencePreset: source.experiencePreset,
            items: [{ required: false, question: source.questions[0] }],
          },
        };
      });
      const view = harness(true, false);
      await ready(view);
      const use = view.preview().onUse!;
      use();
      if (change === "locale") mocked.locale = "fr-FR";
      if (change === "workspace") mocked.workspaceId = "workspace-two";
      if (change === "user") mocked.userId = "creator-two";
      if (change === "role") mocked.canEdit = false;
      if (change === "feature") mocked.surveys = false;
      if (change === "auth") window.dispatchEvent(new Event("pollingpops:auth-change"));
      if (change === "unmount") view.unmount();
      else view.render();
      use();
      pending.resolve({ survey: { id: "old-copy" } });
      await settle();
      expect(mocked.fetch.mock.calls.filter((call) => call[1]?.method === "POST")).toHaveLength(1);
      expect(mocked.push).not.toHaveBeenCalled();
      if (change === "workspace" || change === "user")
        expect(view.markup()).not.toContain("Author text");
      if (change === "auth") expect(view.markup()).toContain("로그인 상태가 변경");
    },
  );

  it("does not reuse a Survey retry intent in another workspace or language", async () => {
    mocked.fetch.mockImplementation(async (_url: string, options?: { method?: string }) => {
      if (options?.method === "POST") throw new Error("Lost response");
      return { templates: [summary("ko-KR")] };
    });
    const view = harness(true);
    await ready(view);
    await view.button("starter.use")();
    await settle();
    view.render();
    mocked.locale = "fr-FR";
    await ready(view);
    await view.button("starter.use")();
    await settle();
    view.render();
    mocked.workspaceId = "workspace-two";
    await ready(view);
    await view.button("starter.use")();
    const bodies = mocked.fetch.mock.calls
      .filter((call) => call[1]?.method === "POST")
      .map((call) => JSON.parse(call[1].body));
    expect(bodies).toHaveLength(3);
    expect(bodies.map((body) => body.locale)).toEqual(["ko-KR", "fr-FR", "fr-FR"]);
    expect(new Set(bodies.map((body) => body.idempotencyKey)).size).toBe(3);
  });

  it.each(["role", "feature", "workspace", "auth"] as const)(
    "blocks a captured preview CTA before submission after a %s change",
    async (change) => {
      const source = draft("ko-KR");
      mocked.fetch.mockImplementation(async (url: string) =>
        url.startsWith("/v1/surveys/templates?")
          ? { templates: [summary("ko-KR")] }
          : {
              draft: {
                schemaVersion: 2,
                title: source.title,
                description: source.description,
                category: source.category,
                experiencePreset: source.experiencePreset,
                items: [{ required: false, question: source.questions[0] }],
              },
            },
      );
      const view = harness(true, false);
      await ready(view);
      const captured = view.preview().onUse!;
      if (change === "role") mocked.canEdit = false;
      if (change === "feature") mocked.surveys = false;
      if (change === "workspace") mocked.workspaceId = "workspace-two";
      if (change === "auth") window.dispatchEvent(new Event("pollingpops:auth-change"));
      view.render();
      captured();
      expect(mocked.fetch.mock.calls.every((call) => !call[1]?.method)).toBe(true);
      if (change === "role" || change === "feature") expect(view.preview().onUse).toBeUndefined();
      if (change === "role") expect(view.markup()).toContain("starter.readOnly");
    },
  );

  it("shows metadata for the exact loaded questions rather than overstating the catalog summary", async () => {
    mocked.locale = "en-CA";
    const item = { ...summary("ko-KR"), questionCount: 99, responseTypes: ["poll", "rating"] };
    mocked.fetch.mockImplementation(async (url: string) =>
      url.startsWith("/v1/starters?") ? { starters: [item] } : { draft: draft("ko-KR") },
    );
    const view = harness(false, false);
    await ready(view);
    const markup = renderToStaticMarkup(view.preview().metadata);
    expect(markup).toContain("starter.questionCount.one:1");
    expect(markup).toContain("questionType.poll.label");
    expect(markup).not.toContain("questionType.rating.label");
    expect(view.markup()).toContain("starter.questionCount.other:99");
  });

  it.each(["workspace", "auth"] as const)(
    "ignores late preview content after a %s change",
    async (change) => {
      const pending = deferred<{ draft: QuizDraft }>();
      let previews = 0;
      mocked.fetch.mockImplementation(async (url: string) => {
        if (url.startsWith("/v1/starters?")) return { starters: [summary("ko-KR")] };
        if (++previews === 1) return pending.promise;
        return { draft: { ...draft("ko-KR"), title: "Current workspace content" } };
      });
      const view = harness(false, false);
      await ready(view);
      expect(view.preview().loading).toBe(true);
      if (change === "workspace") mocked.workspaceId = "workspace-two";
      else window.dispatchEvent(new Event("pollingpops:auth-change"));
      await ready(view);
      pending.resolve({ draft: { ...draft("ko-KR"), title: "Stale workspace content" } });
      await settle();
      view.render();
      expect(view.markup()).not.toContain("Stale workspace content");
      if (change === "workspace")
        expect(view.preview().content?.draft.title).toBe("Current workspace content");
      expect(mocked.fetch.mock.calls.every((call) => !call[1]?.method)).toBe(true);
    },
  );

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

  it("closes the previous-language preview and blocks its captured action while a new locale loads", async () => {
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
    const previousUse = view.preview().onUse!;
    mocked.locale = "fr-FR";
    view.render();
    expect(view.disabled("starter.use")).toBe(true);
    previousUse();
    expect(mocked.fetch.mock.calls.filter((call) => call[1]?.method === "POST")).toHaveLength(0);
    await settle();
    view.render();
    expect(view.markup()).toContain("Retours sur la formation");
    expect(view.markup()).not.toContain('lang="ko-KR"');
    expect(view.markup()).not.toContain("무엇이 필요하나요?");
    expect(mocked.fetch.mock.calls.filter((call) => call[1]?.method === "POST")).toHaveLength(0);
    await view.button("starter.use")();
    expect(mocked.fetch).toHaveBeenLastCalledWith("/v1/starters/training-feedback/use", {
      method: "POST",
      body: expect.any(String),
    });
    expect(JSON.parse(mocked.fetch.mock.calls.at(-1)![1].body).locale).toBe("fr-FR");
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

  it("retries a lost Survey creation with the exact body within the same scope and locale", async () => {
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

  describe("durable Round copy recovery", () => {
    const copy = starterCopyCopy("en-CA");
    const posts = () => mocked.fetch.mock.calls.filter((call) => call[1]?.method === "POST");
    const storageKey = () =>
      starterCopyStorageKey({ actorId: mocked.userId, workspaceId: mocked.workspaceId });
    const rejected = (status: number, code: string) =>
      Object.assign(new Error(code), { status, code });
    beforeEach(() => {
      mocked.locale = "en-CA";
    });
    async function pendingCopy(
      failure: Error = new TypeError("Acknowledgement lost"),
      ranking = false,
    ) {
      let attempts = 0;
      mocked.fetch.mockImplementation(async (url: string, options?: { method?: string }) => {
        if (options?.method === "POST") {
          if (++attempts === 1) throw failure;
          return { quiz: { id: "original-copy" }, replayed: true };
        }
        return url.startsWith("/v1/starters?")
          ? {
              starters: [
                { ...summary("en-CA"), ...(ranking ? { responseTypes: ["ranking"] } : {}) },
              ],
            }
          : { draft: draft("en-CA") };
      });
      const view = harness(false, false);
      await ready(view);
      view.preview().onUse!();
      await settle();
      view.render();
      return { view, body: posts()[0]![1].body };
    }
    it("replays the exact saved body across reload and stores metadata without authored questions or answers", async () => {
      const first = await pendingCopy();
      const raw = window.sessionStorage.getItem(storageKey())!;
      expect(JSON.parse(raw).intents[0]).toEqual({
        starterId: "training-feedback",
        body: first.body,
        previousBodies: [],
      });
      expect(raw).not.toMatch(/Author text|Other text|questions|choices|title|description/);
      first.view.unmount();
      const reloaded = harness(false, false);
      await ready(reloaded);
      expect(reloaded.preview().useLabel).toBe(copy.retryCopy);
      expect(reloaded.markup()).not.toContain("No draft has been created");
      expect(posts()).toHaveLength(1);
      reloaded.preview().onUse!();
      await settle();
      expect(posts()[1]![1].body).toBe(first.body);
      expect(mocked.push).toHaveBeenCalledExactlyOnceWith("/quiz/original-copy");
      expect(window.sessionStorage.getItem(storageKey())).toBeNull();
    });
    it("recovers despite a feature rollback and failed current preview without allowing a fresh copy", async () => {
      const first = await pendingCopy(undefined, true);
      first.view.unmount();
      mocked.rankingPolls = false;
      mocked.fetch.mockImplementation(async (url: string, options?: { method?: string }) => {
        if (options?.method === "POST") return { quiz: { id: "original-copy" }, replayed: true };
        if (url.startsWith("/v1/starters?"))
          return { starters: [{ ...summary("en-CA"), responseTypes: ["ranking"] }] };
        throw new Error("Current feature unavailable");
      });
      const recovered = harness(false, false);
      await ready(recovered);
      expect(recovered.preview().error).toContain("Current feature unavailable");
      expect(recovered.preview().recoveryWithoutPreview).toBe(true);
      expect(recovered.preview().useDisabled).toBe(false);
      expect(recovered.preview().useLabel).toBe(copy.retryCopy);
      expect(recovered.markup()).not.toContain("No draft has been created");
      recovered.preview().onUse!();
      await settle();
      expect(posts()[1]![1].body).toBe(first.body);
      recovered.unmount();
      const fresh = harness(false, false);
      await ready(fresh);
      expect(fresh.preview().onUse).toBeUndefined();
      expect(posts()).toHaveLength(2);
    });
    it.each(["missing", "replaced"])(
      "fails closed if a pending receipt is %s between rendering and retry",
      async (change) => {
        const { view } = await pendingCopy();
        const retry = view.preview().onUse!;
        if (change === "missing") window.sessionStorage.removeItem(storageKey());
        else {
          const value = JSON.parse(window.sessionStorage.getItem(storageKey())!);
          const body = JSON.parse(value.intents[0].body);
          body.idempotencyKey = "00000000-0000-4000-8000-000000000099";
          value.intents[0].body = JSON.stringify(body);
          window.sessionStorage.setItem(storageKey(), JSON.stringify(value));
        }
        retry();
        await settle();
        view.render();
        expect(posts()).toHaveLength(1);
        expect(view.markup()).toContain(copy.recoveryError);
        expect(view.preview().useDisabled).toBe(true);
      },
    );
    it.each(["read", "write", "corrupt"])(
      "blocks writes when recovery storage has a %s failure",
      async (kind) => {
        mocked.fetch.mockImplementation(async (url: string) =>
          url.startsWith("/v1/starters?")
            ? { starters: [summary("en-CA")] }
            : { draft: draft("en-CA") },
        );
        if (kind === "corrupt") window.sessionStorage.setItem(storageKey(), "broken");
        if (kind === "read")
          vi.mocked(window.sessionStorage.getItem).mockImplementationOnce(() => {
            throw new Error("Denied");
          });
        const view = harness(false, false);
        await ready(view);
        if (kind === "write")
          vi.mocked(window.sessionStorage.setItem).mockImplementationOnce(() => {
            throw new Error("Denied");
          });
        view.preview().onUse!();
        await settle();
        view.render();
        expect(posts()).toHaveLength(0);
        expect(view.markup()).toContain(copy.recoveryError);
        expect(view.preview().useDisabled).toBe(true);
      },
    );
    it("retains known success through failed receipt cleanup and opens it without another POST", async () => {
      mocked.fetch.mockImplementation(async (url: string, options?: { method?: string }) =>
        options?.method === "POST"
          ? { quiz: { id: "created-copy" } }
          : url.startsWith("/v1/starters?")
            ? { starters: [summary("en-CA")] }
            : { draft: draft("en-CA") },
      );
      const view = harness(false, false);
      await ready(view);
      vi.mocked(window.sessionStorage.removeItem).mockImplementationOnce(() => {
        throw new Error("Denied");
      });
      view.preview().onUse!();
      await settle();
      view.render();
      expect(mocked.push).not.toHaveBeenCalled();
      expect(posts()).toHaveLength(1);
      expect(view.markup()).toContain(copy.cleanupError);
      expect(view.markup()).not.toContain(copy.pendingCopy);
      expect(view.markup()).not.toContain("Draft creation wasn’t confirmed");
      expect(view.preview().useLabel).toBe(copy.openCreated);
      await view.button(copy.retryRecovery)();
      view.render();
      view.preview().onUse!();
      await settle();
      expect(posts()).toHaveLength(1);
      expect(mocked.push).toHaveBeenCalledExactlyOnceWith("/quiz/created-copy");
    });
    it("retries opening a known created copy after navigation failure without copying again", async () => {
      mocked.fetch.mockImplementation(async (url: string, options?: { method?: string }) =>
        options?.method === "POST"
          ? { quiz: { id: "created-copy" } }
          : url.startsWith("/v1/starters?")
            ? { starters: [summary("en-CA")] }
            : { draft: draft("en-CA") },
      );
      mocked.push.mockImplementationOnce(() => {
        throw new Error("Navigation failed");
      });
      const view = harness(false, false);
      await ready(view);
      view.preview().onUse!();
      await settle();
      view.render();
      expect(view.preview().useLabel).toBe(copy.openCreated);
      expect(view.markup()).toContain(copy.openError);
      expect(view.markup()).not.toContain(copy.pendingCopy);
      expect(view.markup()).not.toContain("Draft creation wasn’t confirmed");
      view.preview().onUse!();
      await settle();
      expect(posts()).toHaveLength(1);
      expect(mocked.push).toHaveBeenCalledTimes(2);
    });
    it("keeps known-success error wording bound to the submitted copy after another preview is selected", async () => {
      const pending = deferred<{ quiz: { id: string } }>();
      const first = { ...summary("en-CA"), id: "meeting-priorities" as const };
      const second = { ...summary("en-CA"), id: "team-retrospective" as const };
      mocked.fetch.mockImplementation(async (url: string, options?: { method?: string }) =>
        options?.method === "POST"
          ? pending.promise
          : url.startsWith("/v1/starters?")
            ? { starters: [first, second] }
            : { draft: draft("en-CA") },
      );
      const view = harness(false, false);
      await ready(view);
      view.preview().onUse!();
      view.selectStarter(second.id);
      await ready(view);
      mocked.push.mockImplementationOnce(() => {
        throw new Error("Navigation failed");
      });
      pending.resolve({ quiz: { id: "submitted-copy" } });
      await settle();
      view.render();
      expect(view.preview().id).toBe(second.id);
      expect(view.preview().actionErrorMessage).toBe(copy.openError);
      expect(view.markup()).not.toContain(copy.requestError);
      view.selectStarter(first.id);
      await ready(view);
      expect(view.preview().useLabel).toBe(copy.openCreated);
      view.preview().onUse!();
      await settle();
      expect(posts()).toHaveLength(1);
      expect(mocked.push).toHaveBeenLastCalledWith("/quiz/submitted-copy");
    });
    it("refreshes changed content before explicit renewal, keeps the UUID and can recover a late committed original", async () => {
      let version = "v1";
      let attempts = 0;
      mocked.fetch.mockImplementation(async (url: string, options?: { method?: string }) => {
        if (options?.method === "POST") {
          if (++attempts === 1) {
            version = "v2";
            throw rejected(409, "STARTER_CONTENT_CHANGED");
          }
          if (attempts === 2) throw rejected(409, "IDEMPOTENCY_CONFLICT");
          return { quiz: { id: "late-original" }, replayed: true };
        }
        return url.startsWith("/v1/starters?")
          ? { starters: [summary("en-CA")], contentVersion: version }
          : { draft: { ...draft("en-CA"), title: `Content ${version}` }, contentVersion: version };
      });
      const view = harness(false, false);
      await ready(view);
      const captured = view.preview().onUse!;
      captured();
      await settle();
      captured();
      expect(posts()).toHaveLength(1);
      await ready(view);
      expect(view.preview().content?.draft.title).toBe("Content v2");
      expect(view.markup()).toContain(copy.createAnother);
      expect(view.preview().onUse).toBeUndefined();
      await view.button(copy.createAnother)();
      await settle();
      view.render();
      const original = JSON.parse(posts()[0]![1].body);
      const renewed = JSON.parse(posts()[1]![1].body);
      expect(renewed.contentVersion).toBe("v2");
      expect(renewed.idempotencyKey).toBe(original.idempotencyKey);
      expect(view.preview().useLabel).toBe(copy.retryCopy);
      view.preview().onUse!();
      await settle();
      expect(posts()[2]![1].body).toBe(posts()[0]![1].body);
      expect(mocked.push).toHaveBeenCalledExactlyOnceWith("/quiz/late-original");
    });
    it.each([
      [400, "INVALID_INTENT", false],
      [410, "STARTER_COPY_EXPIRED", false],
      [410, "STARTER_COPY_TARGET_UNAVAILABLE", true],
    ] as const)(
      "requires explicit renewal after %s %s and changes key only for a tombstoned target",
      async (status, code, changesKey) => {
        const { view, body } = await pendingCopy(rejected(status, code));
        expect(posts()).toHaveLength(1);
        expect(view.preview().onUse).toBeUndefined();
        expect(view.markup()).toContain(copy.createAnother);
        await view.button(copy.createAnother)();
        await settle();
        expect(posts()).toHaveLength(2);
        expect(
          JSON.parse(posts()[1]![1].body).idempotencyKey === JSON.parse(body).idempotencyKey,
        ).toBe(!changesKey);
      },
    );
    it("blocks a generic conflict without rotating identity and guides the Library", async () => {
      const { view, body } = await pendingCopy(rejected(409, "IDEMPOTENCY_CONFLICT"));
      expect(view.preview().onUse).toBeUndefined();
      expect(view.markup()).toContain(copy.conflict);
      expect(view.markup()).toContain('href="/library"');
      expect(view.markup()).not.toContain(copy.createAnother);
      expect(JSON.parse(window.sessionStorage.getItem(storageKey())!).intents[0].body).toBe(body);
      expect(posts()).toHaveLength(1);
    });
    it("pins a new copy to the exact inspected preview version during a mixed-version rollout", async () => {
      mocked.fetch.mockImplementation(async (url: string, options?: { method?: string }) => {
        if (options?.method === "POST") throw rejected(409, "STARTER_CONTENT_CHANGED");
        return url.startsWith("/v1/starters?")
          ? { starters: [summary("en-CA")], contentVersion: "catalog-v2" }
          : { draft: draft("en-CA"), contentVersion: "preview-v1" };
      });
      const view = harness(false, false);
      await ready(view);
      view.preview().onUse!();
      await settle();
      expect(JSON.parse(posts()[0]![1].body).contentVersion).toBe("preview-v1");
      expect(posts()).toHaveLength(1);
    });
    it("pins explicit renewal inside a preview to its inspected version rather than the catalog version", async () => {
      let attempts = 0;
      mocked.fetch.mockImplementation(async (url: string, options?: { method?: string }) => {
        if (options?.method === "POST") {
          if (++attempts === 1) throw rejected(410, "STARTER_COPY_EXPIRED");
          return { quiz: { id: "renewed-copy" } };
        }
        return url.startsWith("/v1/starters?")
          ? { starters: [summary("en-CA")], contentVersion: "catalog-v3" }
          : { draft: draft("en-CA"), contentVersion: "preview-v2" };
      });
      const view = harness(false, false);
      await ready(view);
      view.preview().onUse!();
      await settle();
      view.render();
      await view.button(copy.createAnother)();
      await settle();
      expect(posts()).toHaveLength(2);
      const original = JSON.parse(posts()[0]![1].body);
      const renewed = JSON.parse(posts()[1]![1].body);
      expect(renewed.contentVersion).toBe("preview-v2");
      expect(renewed.idempotencyKey).toBe(original.idempotencyKey);
    });
    it("keeps the selected second template while loading changed content before explicit renewal", async () => {
      let version = "v1";
      const second = {
        ...summary("en-CA"),
        id: "team-retrospective" as const,
        title: "Second template",
      };
      const freshCatalog = deferred<{ starters: StarterSummary[]; contentVersion: string }>();
      mocked.fetch.mockImplementation(async (url: string, options?: { method?: string }) => {
        if (options?.method === "POST") {
          version = "v2";
          throw rejected(409, "STARTER_CONTENT_CHANGED");
        }
        if (url.startsWith("/v1/starters?"))
          return version === "v1"
            ? { starters: [summary("en-CA"), second], contentVersion: version }
            : freshCatalog.promise;
        return {
          draft: {
            ...draft("en-CA"),
            title: `${url.includes("team-retrospective") ? "Second" : "First"} ${version}`,
          },
          contentVersion: version,
        };
      });
      const view = harness(false, false);
      await ready(view);
      view.selectStarter(second.id);
      await ready(view);
      expect(view.preview().id).toBe(second.id);
      view.preview().onUse!();
      await settle();
      view.render();
      expect(view.preview().id).toBe(second.id);
      expect(view.preview().loading).toBe(true);
      expect(view.disabled(copy.createAnother)).toBe(true);
      freshCatalog.resolve({ starters: [summary("en-CA"), second], contentVersion: "v2" });
      await ready(view);
      expect(view.preview().id).toBe(second.id);
      expect(view.preview().content?.draft.title).toBe("Second v2");
      expect(view.disabled(copy.createAnother)).toBe(false);
      expect(posts()).toHaveLength(1);
    });
    it.each([429, 500])("retains the exact body after an HTTP %s failure", async (status) => {
      const { view, body } = await pendingCopy(rejected(status, "RETRY_LATER"));
      view.preview().onUse!();
      await settle();
      expect(posts()[1]![1].body).toBe(body);
      expect(mocked.push).toHaveBeenCalledExactlyOnceWith("/quiz/original-copy");
    });
    it.each(["locale", "workspace", "actor", "role", "feature", "auth", "unmount"])(
      "ignores a late Round copy response after a %s change and retains its recovery intent",
      async (change) => {
        const pending = deferred<{ quiz: { id: string } }>();
        mocked.fetch.mockImplementation(async (url: string, options?: { method?: string }) =>
          options?.method === "POST"
            ? pending.promise
            : url.startsWith("/v1/starters?")
              ? { starters: [summary("en-CA")] }
              : { draft: draft("en-CA") },
        );
        const view = harness(false, false);
        await ready(view);
        view.preview().onUse!();
        const key = storageKey();
        const raw = window.sessionStorage.getItem(key);
        if (change === "locale") mocked.locale = "fr-FR";
        if (change === "workspace") mocked.workspaceId = "00000000-0000-4000-8000-000000000077";
        if (change === "actor") mocked.userId = "00000000-0000-4000-8000-000000000088";
        if (change === "role") mocked.canEdit = false;
        if (change === "feature") mocked.rankingPolls = false;
        if (change === "auth") window.dispatchEvent(new Event("pollingpops:auth-change"));
        if (change === "unmount") view.unmount();
        else view.render();
        pending.resolve({ quiz: { id: "stale-copy" } });
        await settle();
        expect(mocked.push).not.toHaveBeenCalled();
        expect(window.sessionStorage.getItem(key)).toBe(raw);
        expect(posts()).toHaveLength(1);
      },
    );
    it.each(["locale", "workspace", "actor", "role", "auth"])(
      "fences a captured durable retry after %s changes",
      async (change) => {
        const { view } = await pendingCopy();
        const retry = view.preview().onUse!;
        if (change === "locale") mocked.locale = "fr-FR";
        if (change === "workspace") mocked.workspaceId = "00000000-0000-4000-8000-000000000077";
        if (change === "actor") mocked.userId = "00000000-0000-4000-8000-000000000088";
        if (change === "role") mocked.canEdit = false;
        if (change === "auth") window.dispatchEvent(new Event("pollingpops:auth-change"));
        view.render();
        retry();
        await settle();
        expect(posts()).toHaveLength(1);
        expect(mocked.push).not.toHaveBeenCalled();
      },
    );
  });
});
