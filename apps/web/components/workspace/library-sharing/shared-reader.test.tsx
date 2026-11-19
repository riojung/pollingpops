import { isValidElement, type ReactElement, type ReactNode } from "react";
import type * as ReactModule from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LibraryShareSummary, SupportedLocale } from "@openround/contracts";
import type { SurveyPage } from "@openround/contracts/surveys";
import type { SharedLibraryDetail, SharedQuestion } from "./client";
import type * as ClientModule from "./client";
import { surveyPagesCopy } from "../../../lib/i18n/survey-pages-copy";

type Hooks = {
  cursor: number;
  slots: unknown[];
  effects: Array<() => void>;
  cleanups: Map<number, () => void>;
};
const mocked = vi.hoisted(() => ({
  hooks: null as Hooks | null,
  read: vi.fn(),
  progress: vi.fn(),
  locale: "en-CA" as SupportedLocale,
  userId: "actor-a",
  workspaceId: "workspace-a",
}));
vi.mock("react", async (original) => {
  const react = await original<typeof ReactModule>();
  return {
    ...react,
    useState: <T,>(initial: T | (() => T)) => {
      const hooks = mocked.hooks;
      if (!hooks) return react.useState(initial);
      const index = hooks.cursor++;
      if (!(index in hooks.slots))
        hooks.slots[index] = typeof initial === "function" ? (initial as () => T)() : initial;
      return [
        hooks.slots[index],
        (next: T | ((old: T) => T)) => {
          hooks.slots[index] =
            typeof next === "function" ? (next as (old: T) => T)(hooks.slots[index] as T) : next;
        },
      ];
    },
    useRef: <T,>(initial: T) => {
      const hooks = mocked.hooks;
      if (!hooks) return react.useRef(initial);
      const index = hooks.cursor++;
      hooks.slots[index] ??= { current: initial };
      return hooks.slots[index];
    },
    useCallback: <T,>(callback: T, deps: readonly unknown[]) => {
      const hooks = mocked.hooks;
      if (!hooks) return callback;
      const index = hooks.cursor++;
      const previous = hooks.slots[index] as { callback: T; deps: readonly unknown[] } | undefined;
      if (!previous || deps.some((value, index) => !Object.is(value, previous.deps[index])))
        hooks.slots[index] = { callback, deps };
      return (hooks.slots[index] as { callback: T }).callback;
    },
    useEffect: (effect: ReactModule.EffectCallback, deps: readonly unknown[]) => {
      const hooks = mocked.hooks;
      if (!hooks) return react.useEffect(effect, deps);
      const index = hooks.cursor++;
      const old = hooks.slots[index] as readonly unknown[] | undefined;
      if (!old || deps.some((value, index) => !Object.is(value, old[index]))) {
        hooks.slots[index] = deps;
        hooks.effects.push(() => {
          hooks.cleanups.get(index)?.();
          const cleanup = effect();
          if (cleanup) hooks.cleanups.set(index, cleanup);
        });
      }
    },
  };
});
vi.mock("../../locale-provider", () => ({ useLocale: () => ({ locale: mocked.locale }) }));
vi.mock("../workspace-provider", () => ({
  WorkspaceProvider: ({ children }: { children: ReactNode }) => children,
  useWorkspace: () => ({ creator: { userId: mocked.userId, workspaceId: mocked.workspaceId } }),
}));
vi.mock("../workspace-shell", () => ({
  WorkspaceShell: ({ children, title }: { children: ReactNode; title: string }) => (
    <main>
      <h1>{title}</h1>
      {children}
    </main>
  ),
}));
vi.mock("./client", async (original) => ({
  ...(await original<typeof ClientModule>()),
  readLibraryShare: mocked.read,
  updateLibraryShareProgress: mocked.progress,
}));
vi.mock("./share-actions", () => ({
  LibraryShareActions: ({ share }: { share: LibraryShareSummary }) => (
    <div data-copy-allowed={share.capabilities.copy} />
  ),
}));

import {
  SharedLibraryQuestion,
  SharedLibraryReader,
  SharedLibrarySurveyPages,
} from "./shared-reader";
const id = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
const share = (): LibraryShareSummary => ({
  id: id(100),
  organizationId: id(101),
  organizationName: "Organization",
  sourceWorkspaceId: id(102),
  sourceWorkspaceName: "Source",
  artifactType: "survey",
  artifactId: id(103),
  versionId: id(104),
  title: "Saved Survey",
  description: "",
  sharedAt: "2026-11-18T12:00:00.000Z",
  permission: "view",
  audience: "people",
  message: "",
  dueAt: null,
  progress: "in_progress",
  capabilities: { view: true, copy: false, manage: false },
});
const questions = (): SharedQuestion[] =>
  [1, 2, 3].map((index) => ({
    id: id(index),
    type: "poll",
    prompt: `Question ${index} <plain>`,
    mediaId: null,
    mediaAlt: null,
    choices: [{ id: id(index + 10), label: `Option ${index} <text>` }],
    required: true,
  }));
const pages = (): SurveyPage[] =>
  [1, 2, 3].map((index) => ({
    id: id(index + 20),
    title: index === 3 ? "" : `Page ${index} <title>`,
    description: index === 1 ? "First line\n\n  Second line <script>" : `Instructions ${index}`,
    questionIds: [id(index)],
  }));
const detail = (): SharedLibraryDetail => ({
  share: share(),
  questions: questions(),
  surveyPages: pages(),
});
function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement<Record<string, unknown>>(node)) return [];
  return [node, ...elements(node.props.children as ReactNode)];
}
const cleanups: Array<() => void> = [];
function harness() {
  const hooks: Hooks = { cursor: 0, slots: [], effects: [], cleanups: new Map() };
  const wrapper = SharedLibraryReader({ shareId: id(100) });
  const child = wrapper.props.children as ReactElement;
  const Reader = child.type as (props: { shareId: string }) => ReactNode;
  let tree: ReactNode;
  const render = () => {
    hooks.cursor = 0;
    mocked.hooks = hooks;
    try {
      tree = Reader({ shareId: id(100) });
    } finally {
      mocked.hooks = null;
    }
    hooks.effects.splice(0).forEach((effect) => effect());
    return renderToStaticMarkup(tree);
  };
  cleanups.push(() => hooks.cleanups.forEach((cleanup) => cleanup()));
  return {
    render,
    revoke() {
      const actions = elements(tree).find((node) => typeof node.props.onRevoked === "function")!;
      (actions.props.onRevoked as () => void)();
    },
  };
}
async function settle() {
  for (let index = 0; index < 16; index++) await Promise.resolve();
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { resolve, promise };
}
beforeEach(() => {
  vi.clearAllMocks();
  mocked.locale = "en-CA";
  mocked.userId = "actor-a";
  mocked.workspaceId = "workspace-a";
  mocked.read.mockResolvedValue(detail());
  vi.stubGlobal("window", new EventTarget());
});
afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup());
  mocked.hooks = null;
  vi.unstubAllGlobals();
});

describe("shared Survey page reader", () => {
  it("renders every page group in order, associates each question, and uses h3 under page h2", () => {
    const source = detail();
    const before = JSON.stringify(source);
    const markup = renderToStaticMarkup(
      <SharedLibrarySurveyPages
        shareId={source.share.id}
        questions={source.questions!}
        pages={source.surveyPages!}
      />,
    );
    expect(markup.match(/data-shared-survey-page=/g)).toHaveLength(3);
    const first = markup.slice(
      markup.indexOf(`data-shared-survey-page="${id(21)}"`),
      markup.indexOf(`data-shared-survey-page="${id(22)}"`),
    );
    expect(first).toContain("Page 1 &lt;title&gt;");
    expect(first).toContain("Question 1 &lt;plain&gt;");
    expect(first).not.toContain("Question 2");
    expect(first.indexOf("<h2")).toBeLessThan(first.indexOf("<h3"));
    expect(markup).toContain("First line\n\n  Second line &lt;script&gt;");
    expect(markup).toContain("Option 3 &lt;text&gt;");
    expect(markup).not.toMatch(/<input|<textarea|<select|<form|<script>/);
    expect(JSON.stringify(source)).toBe(before);
  });
  it.each(["en-CA", "ko-KR", "ja-JP"] as const)(
    "localizes blank headings and per-page progress in %s",
    (locale) => {
      mocked.locale = locale;
      const markup = renderToStaticMarkup(
        <SharedLibrarySurveyPages shareId={id(100)} questions={questions()} pages={pages()} />,
      );
      const copy = surveyPagesCopy(locale);
      expect(markup).toContain(copy.untitledPage.replace("{page}", "3"));
      expect(markup).toContain(copy.pageProgress.replace("{page}", "2").replace("{count}", "3"));
      expect(markup).toContain(`lang="${locale}"`);
      expect(markup).toContain('lang="" dir="auto">Page 1');
    },
  );
  it("keeps the legacy default question heading at h2", () => {
    const markup = renderToStaticMarkup(
      <SharedLibraryQuestion shareId={id(100)} question={questions()[0]!} />,
    );
    expect(markup).toContain("<h2");
    expect(markup).not.toContain("<h3");
    expect(markup).not.toContain("data-shared-survey-page");
  });
  it("uses all page groups through the authenticated reader without enabling copy or responses", async () => {
    const view = harness();
    view.render();
    await settle();
    const markup = view.render();
    expect(markup.match(/data-shared-survey-page=/g)).toHaveLength(3);
    expect(markup).toContain('data-copy-allowed="false"');
    expect(markup).not.toMatch(/<input|<form|Use a copy/);
    expect(mocked.progress).not.toHaveBeenCalled();
  });
  it.each(["survey", "round"] as const)(
    "keeps legacy %s questions flat when no layout exists",
    async (artifactType) => {
      mocked.read.mockResolvedValue({
        share: { ...share(), artifactType },
        questions: questions(),
      });
      const view = harness();
      view.render();
      await settle();
      const markup = view.render();
      expect(markup).not.toContain("data-shared-survey-page");
      expect(markup.match(/<h2 /g)).toHaveLength(3);
      expect(markup).not.toContain("<h3");
    },
  );
  it("retains Presentation block navigation and default h2 question rendering", async () => {
    mocked.read.mockResolvedValue({
      share: { ...share(), artifactType: "presentation" },
      review: {
        schemaVersion: 1,
        versionId: id(104),
        version: 1,
        title: "Published deck",
        blocks: [
          {
            id: id(1),
            kind: "question",
            question: { type: "poll", prompt: "Deck question", mediaId: null, mediaAlt: null },
          },
        ],
        sections: [],
        expiresAt: "2099-01-01T00:00:00.000Z",
      },
    });
    const view = harness();
    view.render();
    await settle();
    const markup = view.render();
    expect(markup).toContain("Deck question");
    expect(markup).toContain("<h2");
    expect(markup).not.toContain("<h3");
    expect(markup).not.toContain("data-shared-survey-page");
    expect(markup).toContain("Previous");
    expect(markup).toContain("Next");
  });
  it("removes all page content on share revocation", async () => {
    const view = harness();
    view.render();
    await settle();
    view.render();
    view.revoke();
    const markup = view.render();
    expect(markup).not.toContain("data-shared-survey-page");
    expect(markup).not.toContain("Question 1");
  });
  it.each(["workspace", "actor"] as const)(
    "hides page content immediately and ignores stale details after a %s change",
    async (change) => {
      const stale = deferred<SharedLibraryDetail>();
      mocked.read.mockReturnValueOnce(stale.promise);
      const view = harness();
      view.render();
      if (change === "workspace") mocked.workspaceId = "workspace-b";
      else mocked.userId = "actor-b";
      expect(view.render()).not.toContain("data-shared-survey-page");
      await settle();
      const current = view.render();
      expect(current).toContain("Page 1 &lt;title&gt;");
      stale.resolve({
        ...detail(),
        surveyPages: pages().map((page) => ({ ...page, title: "Stale private page" })),
      });
      await settle();
      expect(view.render()).not.toContain("Stale private page");
    },
  );
});
