import type * as ReactModule from "react";
import { isValidElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveExperienceTheme } from "@openround/experience";
import type { QuestionDraft, QuizDraft } from "@openround/contracts";
import QuizPreviewPage from "./page";
import { PreviewMedia, RehearsalQuestion, RoundRehearsal } from "./round-rehearsal";

interface Hooks {
  cursor: number;
  slots: unknown[];
  effects: Array<{ effect: () => unknown; dependencies?: readonly unknown[] }>;
}
const fixtures = vi.hoisted(() => ({
  hooks: null as Hooks | null,
  id: "first-round",
  api: vi.fn(),
  replace: vi.fn(),
  router: null as unknown,
}));
fixtures.router = { replace: fixtures.replace };
vi.mock("next/navigation", () => ({
  useParams: () => ({ id: fixtures.id }),
  useRouter: () => fixtures.router,
  usePathname: () => `/quiz/${fixtures.id}/preview`,
}));
vi.mock("../../../../lib/api", () => ({
  AUTH_CHANGE_EVENT: "pollingpops:auth-change",
  apiFetch: (...args: unknown[]) => fixtures.api(...args),
  humanError: (error: unknown) => (error instanceof Error ? error.message : "Request failed"),
}));
vi.mock("../../../../components/locale-provider", async () => {
  const { loadMessages, localeDomainsForPath, translate } =
    await import("../../../../lib/i18n/catalog");
  const messages = await loadMessages("en-CA", localeDomainsForPath("/quiz/test/preview"));
  return {
    useLocale: () => ({
      locale: "en-CA",
      t: (key: Parameters<typeof translate>[1], values?: Record<string, string | number>) =>
        translate(messages, key, values),
    }),
  };
});
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
        (next: T | ((current: T) => T)) => {
          hooks.slots[index] =
            typeof next === "function"
              ? (next as (current: T) => T)(hooks.slots[index] as T)
              : next;
        },
      ];
    },
    useEffect: (effect: () => unknown, dependencies?: readonly unknown[]) => {
      if (fixtures.hooks) fixtures.hooks.effects.push({ effect, dependencies });
      else react.useEffect(effect as Parameters<typeof react.useEffect>[0], dependencies);
    },
  };
});

type Element = ReactModule.ReactElement<Record<string, unknown>>;
function find(
  tree: ReactModule.ReactNode,
  predicate: (element: Element) => boolean,
): Element | undefined {
  if (Array.isArray(tree)) return tree.map((node) => find(node, predicate)).find(Boolean);
  if (!isValidElement<Record<string, unknown>>(tree)) return undefined;
  return predicate(tree) ? tree : find(tree.props.children as ReactModule.ReactNode, predicate);
}
function mount(render: () => ReactModule.ReactNode) {
  const hooks: Hooks = { cursor: 0, slots: [], effects: [] };
  const committed: Array<{ dependencies?: readonly unknown[]; cleanup: unknown }> = [];
  return {
    render() {
      hooks.cursor = 0;
      hooks.effects = [];
      fixtures.hooks = hooks;
      try {
        return render();
      } finally {
        fixtures.hooks = null;
      }
    },
    effects() {
      for (const [index, incoming] of hooks.effects.entries()) {
        const previous = committed[index];
        if (
          previous &&
          incoming.dependencies &&
          previous.dependencies &&
          incoming.dependencies.length === previous.dependencies.length &&
          incoming.dependencies.every((value, offset) =>
            Object.is(value, previous.dependencies![offset]),
          )
        )
          continue;
        if (typeof previous?.cleanup === "function") previous.cleanup();
        committed[index] = { dependencies: incoming.dependencies, cleanup: incoming.effect() };
      }
    },
    close() {
      for (const { cleanup } of committed) if (typeof cleanup === "function") cleanup();
    },
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
async function settle() {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}
const html = (tree: ReactModule.ReactNode) => renderToStaticMarkup(tree);
const base = {
  id: "11111111-1111-4111-8111-111111111111",
  prompt: "Which model fits?",
  timeLimitSeconds: 30,
  basePoints: 1000,
  explanation: "Compare the evidence.",
  mediaId: null,
  mediaAlt: null,
};
const question: QuestionDraft = {
  ...base,
  type: "single_select",
  confidence: "required",
  choices: [
    { id: "22222222-2222-4222-8222-222222222222", label: "Model A", isCorrect: true },
    { id: "33333333-3333-4333-8333-333333333333", label: "Model B", isCorrect: false },
  ],
};
const draft: QuizDraft = {
  title: "Evidence round",
  description: "Explore the evidence.",
  questions: [question],
};
const account = { brandTheme: null, productFeatures: { workspaceShell: true } };
const theme = resolveExperienceTheme({ category: "general" });
const quiz = (title: string) => ({
  quiz: { id: "test", status: "published", draft: { ...draft, title } },
});

beforeEach(() => {
  fixtures.api.mockReset();
  fixtures.replace.mockReset();
  fixtures.id = "first-round";
  vi.stubGlobal("window", new EventTarget());
});
afterEach(() => {
  fixtures.hooks = null;
  vi.unstubAllGlobals();
});

describe("Round rehearsal workspace", () => {
  it("labels a published round's saved draft accurately and keeps notes outside the audience", async () => {
    fixtures.api.mockImplementation((path: string) =>
      Promise.resolve(path === "/v1/auth/me" ? account : quiz("Saved draft title")),
    );
    const view = mount(QuizPreviewPage);
    view.render();
    view.effects();
    await settle();
    const output = html(view.render());
    expect(output).toContain("Saved draft preview");
    expect(output).toContain("including for published rounds");
    expect(output).toContain("Saved draft title");
    expect(output).toContain("Test only · No real responses");
    expect(output).toContain("Presenter notes");
    // Live Round delivery intentionally normalizes the authored required fixture to optional.
    expect(output).toContain("On (optional)");
    expect(output).not.toContain("Confidence (required)");
    expect(output).not.toContain("Published</");
    expect(output).not.toContain("live-stage");
    expect(
      fixtures.api.mock.calls.every(
        ([path, options]) => String(path).startsWith("/v1/") && !options.method,
      ),
    ).toBe(true);
    view.close();
  });

  it("ignores delayed route and account fetches and clears loaded data on account changes", async () => {
    const first = deferred<ReturnType<typeof quiz>>();
    const second = deferred<ReturnType<typeof quiz>>();
    fixtures.api.mockImplementation((path: string) =>
      path === "/v1/auth/me"
        ? Promise.resolve(account)
        : path.endsWith("first-round")
          ? first.promise
          : second.promise,
    );
    const view = mount(QuizPreviewPage);
    view.render();
    view.effects();
    fixtures.id = "second-round";
    expect(html(view.render())).not.toContain("Which model fits?");
    view.effects();
    second.resolve(quiz("Second draft"));
    await settle();
    expect(html(view.render())).toContain("Second draft");
    first.resolve(quiz("Stale first draft"));
    await settle();
    expect(html(view.render())).not.toContain("Stale first draft");
    const pendingAccount = deferred<typeof account>();
    fixtures.api.mockImplementation((path: string) =>
      path === "/v1/auth/me" ? pendingAccount.promise : Promise.resolve(quiz("New account draft")),
    );
    window.dispatchEvent(new Event("pollingpops:auth-change"));
    expect(html(view.render())).not.toContain("Second draft");
    view.effects();
    window.dispatchEvent(new Event("pollingpops:auth-change"));
    pendingAccount.resolve(account);
    await settle();
    expect(html(view.render())).not.toContain("New account draft");
    view.close();
  });

  it("clears the prior image while media changes and ignores stale media completion", async () => {
    const first = deferred<{ downloadUrl: string }>();
    const second = deferred<{ downloadUrl: string }>();
    const firstId = "55555555-5555-4555-8555-555555555555";
    const secondId = "66666666-6666-4666-8666-666666666666";
    let selected: QuestionDraft = { ...question, mediaId: firstId };
    fixtures.api.mockImplementation((path: string) =>
      path.endsWith(firstId) ? first.promise : second.promise,
    );
    const view = mount(() => PreviewMedia({ question: selected }));
    view.render();
    view.effects();
    selected = { ...question, mediaId: secondId };
    expect(html(view.render())).not.toContain("first-image.png");
    view.effects();
    second.resolve({ downloadUrl: "https://example.test/second-image.png" });
    await settle();
    expect(html(view.render())).toContain("second-image.png");
    first.resolve({ downloadUrl: "https://example.test/first-image.png" });
    await settle();
    expect(html(view.render())).toContain("second-image.png");
    expect(html(view.render())).not.toContain("first-image.png");
    selected = { ...question, mediaId: null };
    expect(html(view.render())).not.toContain("second-image.png");
    view.close();
  });

  it("clears rehearsal content and redirects when the session ends without retrying expired reads", async () => {
    fixtures.api.mockImplementation((path: string) =>
      Promise.resolve(path === "/v1/auth/me" ? account : quiz("Private saved draft")),
    );
    const view = mount(QuizPreviewPage);
    view.render();
    view.effects();
    await settle();
    expect(html(view.render())).toContain("Private saved draft");
    const reads = fixtures.api.mock.calls.length;
    window.dispatchEvent(new Event("pollingpops:session-expired"));
    expect(fixtures.replace).toHaveBeenCalledWith("/signin");
    expect(html(view.render())).not.toContain("Private saved draft");
    view.effects();
    await settle();
    expect(fixtures.api.mock.calls.length).toBe(reads);
    view.close();
  });

  it("keeps the 401 redirect and blocks invalid saved content", async () => {
    fixtures.api.mockRejectedValue({ status: 401 });
    const denied = mount(QuizPreviewPage);
    denied.render();
    denied.effects();
    await settle();
    expect(fixtures.replace).toHaveBeenCalledWith("/signin");
    denied.close();
    fixtures.api.mockImplementation((path: string) =>
      Promise.resolve(path === "/v1/auth/me" ? account : quiz("")),
    );
    const invalid = mount(QuizPreviewPage);
    invalid.render();
    invalid.effects();
    await settle();
    const output = html(invalid.render());
    expect(output).toContain('role="alert"');
    expect(output).not.toContain("Try an answer");
    invalid.close();
  });

  it("moves through checkpoints, resets reveal state, and separates presenter information", () => {
    const recheck: QuestionDraft = {
      ...question,
      id: "44444444-4444-4444-8444-444444444444",
      prompt: "Recheck the model",
      delivery: "recheck",
    };
    const view = mount(() =>
      RoundRehearsal({
        draft: { ...draft, questions: [question, recheck] },
        experienceTheme: theme,
      }),
    );
    let tree = view.render();
    expect(html(tree)).toContain("Checkpoint 1 of 2");
    const reveal = find(
      tree,
      (element) => element.type === "button" && html(element).includes("Reveal answer"),
    )!;
    (reveal.props.onClick as () => void)();
    tree = view.render();
    expect(html(tree)).toContain("Correct answer revealed");
    const next = find(
      tree,
      (element) => element.type === "button" && html(element).includes("Next checkpoint"),
    )!;
    (next.props.onClick as () => void)();
    tree = view.render();
    expect(html(tree)).toContain("Checkpoint 2 of 2");
    expect(html(tree)).not.toContain("Correct answer revealed");
    expect(html(tree)).toContain("recheck");
    const audienceOnly = find(
      tree,
      (element) => element.type === "button" && html(element).includes("Audience view"),
    )!;
    (audienceOnly.props.onClick as () => void)();
    expect(html(view.render())).not.toContain("Presenter notes");
  });

  it("treats authored required confidence as optional in Rounds and reveals opinions without a score", () => {
    const answer = RehearsalQuestion({ question, revealed: false, resetKey: 0 });
    const content = answer.type as (props: typeof answer.props) => ReactModule.ReactNode;
    const view = mount(() => content(answer.props));
    let tree = view.render();
    const choose = find(
      tree,
      (element) => element.type === "input" && element.props.value === question.choices[0]!.id,
    )!;
    (choose.props.onChange as () => void)();
    tree = view.render();
    const submit = find(
      tree,
      (element) => element.type === "button" && element.props.type === "submit",
    )!;
    expect(submit.props.disabled).toBe(false);
    const form = find(tree, (element) => element.type === "form")!;
    (form.props.onSubmit as (event: { preventDefault: () => void }) => void)({
      preventDefault: vi.fn(),
    });
    expect(html(view.render())).toContain("Test answer recorded on this device only");
    expect(html(view.render())).toContain("How sure are you? (Optional)");
    expect(fixtures.api).not.toHaveBeenCalled();
    const poll: QuestionDraft = {
      ...question,
      type: "poll",
      purpose: "opinion",
      confidence: "off",
      basePoints: 0,
      choices: question.choices.map((choice) => ({ ...choice, isCorrect: false })),
    };
    const output = html(<RehearsalQuestion question={poll} revealed resetKey={0} />);
    expect(output).toContain("Opinion · No score or correct answer");
    expect(output).not.toContain("Correct answer revealed");
    expect(output).not.toContain("How sure are you?");
    const opinionWithLegacyConfidence: QuestionDraft = {
      ...question,
      purpose: "opinion",
      confidence: "required",
      basePoints: 0,
    };
    expect(
      html(
        <RehearsalQuestion question={opinionWithLegacyConfidence} revealed={false} resetKey={0} />,
      ),
    ).not.toContain("How sure are you?");
  });
});
