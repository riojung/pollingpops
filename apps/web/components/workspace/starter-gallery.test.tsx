import { isValidElement, type ReactElement, type ReactNode } from "react";
import type * as ReactModule from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { QuizDraft, StarterSummary, SupportedLocale } from "@openround/contracts";
import { StarterGallery } from "./starter-gallery";
import { StarterTemplatePreview } from "./starter-template-preview";

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
  userId: "creator-one",
  workspaceId: "workspace-one",
  surveys: true,
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
    productFeatures: { surveys: mocked.surveys },
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
    unmount() {
      for (const slot of hooks.slots) (slot as { cleanup?: () => void } | undefined)?.cleanup?.();
    },
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
  mocked.userId = "creator-one";
  mocked.workspaceId = "workspace-one";
  mocked.surveys = true;
  mocked.hooks = null;
  vi.stubGlobal("window", new EventTarget());
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
      body: JSON.stringify({ locale: "ko-KR" }),
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
});
