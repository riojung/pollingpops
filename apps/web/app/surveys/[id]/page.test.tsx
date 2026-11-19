import { isValidElement, type ReactElement, type ReactNode } from "react";
import type * as ReactModule from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SurveyDraftSchema } from "@openround/contracts/surveys";
import { surveyBranchingFixture } from "../../../../../packages/contracts/test/support/survey-branching-fixture";
import type { SurveyRecordView } from "../../../lib/survey-client";
import type * as ApiModule from "../../../lib/api";
import { ApiClientError } from "../../../lib/api";
import type * as AutosaveModule from "../../../lib/survey-autosave";
import { SurveyPageAuthoring } from "../../../components/survey-page-authoring";
import { WorkspaceShell } from "../../../components/workspace/workspace-shell";
import {
  addSurveyPage,
  updateSurveyPage,
  type PagedSurveyDraft,
} from "../../../lib/survey-page-authoring";

type Hooks = {
  cursor: number;
  slots: unknown[];
  effects: Array<() => void>;
  cleanups: Map<number, () => void>;
};
const mocked = vi.hoisted(() => ({
  hooks: null as Hooks | null,
  request: vi.fn(),
  constructed: vi.fn(),
  push: vi.fn(),
  workspace: {
    canEdit: true,
    loading: false,
    error: "",
    creator: { userId: "actor", workspaceId: "workspace" } as {
      userId: string;
      workspaceId: string;
    } | null,
    productFeatures: { surveys: true, surveyPages: false },
    entitlements: null,
    refreshAccount: vi.fn(async () => undefined),
  },
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
    useCallback: <T,>(callback: T) => callback,
    useEffect: (effect: ReactModule.EffectCallback, dependencies: readonly unknown[]) => {
      const hooks = mocked.hooks;
      if (!hooks) return react.useEffect(effect, dependencies);
      const index = hooks.cursor++;
      const previous = hooks.slots[index] as readonly unknown[] | undefined;
      if (!previous || dependencies.some((value, index) => !Object.is(value, previous[index]))) {
        hooks.slots[index] = dependencies;
        hooks.effects.push(() => {
          hooks.cleanups.get(index)?.();
          const cleanup = effect();
          if (cleanup) hooks.cleanups.set(index, cleanup);
        });
      }
    },
  };
});
vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "survey" }),
  useRouter: () => ({ push: mocked.push }),
}));
vi.mock("../../../components/workspace/workspace-provider", () => ({
  WorkspaceProvider: ({ children }: { children: ReactNode }) => children,
  useWorkspace: () => mocked.workspace,
}));
vi.mock("../../../components/workspace/workspace-shell", () => ({
  WorkspaceShell: ({ children }: { children: ReactNode }) => {
    const { loading, error, creator, refreshAccount } = mocked.workspace;
    if (loading || error || !creator)
      return (
        <main>
          {error ? (
            <>
              <p role="alert">{error}</p>
              <button type="button" onClick={() => void refreshAccount()}>
                Retry
              </button>
            </>
          ) : (
            "Loading workspace…"
          )}
        </main>
      );
    return <main>{children}</main>;
  },
}));
vi.mock("../../../components/navigation-guard", () => ({
  NavigationGuardProvider: ({ children }: { children: ReactNode }) => children,
  GuardedLink: ({ children }: { children: ReactNode }) => <a>{children}</a>,
  useNavigationBlocker: vi.fn(),
}));
vi.mock("../../../components/locale-provider", () => ({
  useLocale: () => ({ locale: "en-CA", t: (key: string) => key }),
}));
vi.mock("../../../lib/api", async (original) => ({
  ...(await original<typeof ApiModule>()),
  apiFetch: mocked.request,
}));
vi.mock("../../../lib/survey-autosave", async (original) => {
  const actual = await original<typeof AutosaveModule>();
  return {
    ...actual,
    SurveyAutosave: class extends actual.SurveyAutosave {
      constructor(...args: ConstructorParameters<typeof actual.SurveyAutosave>) {
        super(...args);
        mocked.constructed(this);
      }
    },
  };
});
import SurveyEditorPage, { SurveyEditor } from "./page";
const id = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
const draft = () =>
  SurveyDraftSchema.parse({
    schemaVersion: 3,
    title: "Saved ordered feedback",
    description: "Saved description",
    items: [1, 2].map((index) => ({
      required: true,
      question: {
        id: id(index),
        type: "rating",
        prompt: `Question ${index}`,
        purpose: "opinion",
        confidence: "off",
        delivery: "main",
        basePoints: 0,
        timeLimitSeconds: 30,
        explanation: "",
        mediaId: null,
        mediaAlt: null,
        min: 1,
        max: 5,
        minLabel: "Low",
        maxLabel: "High",
      },
    })),
    pages: [1, 2].map((index) => ({
      id: id(index + 10),
      title: `Saved page ${index}`,
      description: `Saved notes ${index}`,
      questionIds: [id(index)],
    })),
  });
const record = (): SurveyRecordView => ({
  id: "survey",
  draft: draft(),
  revision: 4,
  status: "draft",
  publishedRevision: null,
  versionId: null,
});
const cleanups: Array<() => void> = [];
function harness(scoped = false) {
  let hooks: Hooks = { cursor: 0, slots: [], effects: [], cleanups: new Map() };
  const scopeHooks: Hooks = { cursor: 0, slots: [], effects: [], cleanups: new Map() };
  const wrapper = SurveyEditorPage();
  const provider = wrapper.props.children as ReactElement<{ children: ReactElement }>;
  const Scope = provider.props.children.type as (props: { id: string }) => ReactElement;
  let currentKey: string | null = null;
  let tree: ReactNode;
  const elements = (node: ReactNode): ReactElement<Record<string, unknown>>[] => {
    if (Array.isArray(node)) return node.flatMap(elements);
    if (!isValidElement<Record<string, unknown>>(node)) return [];
    return [node, ...elements(node.props.children as ReactNode)];
  };
  const text = (node: ReactNode): string => {
    if (Array.isArray(node)) return node.map(text).join("");
    if (isValidElement<{ children?: ReactNode }>(node)) return text(node.props.children);
    return typeof node === "string" ? node : "";
  };
  cleanups.push(() => hooks.cleanups.forEach((cleanup) => cleanup()));
  return {
    render() {
      let props = { id: "survey", scope: JSON.stringify(["actor", "workspace", "survey"]) };
      if (scoped) {
        scopeHooks.cursor = 0;
        mocked.hooks = scopeHooks;
        let child: ReactElement;
        try {
          child = Scope({ id: "survey" });
        } finally {
          mocked.hooks = null;
        }
        if (child.type !== SurveyEditor) {
          tree = WorkspaceShell(child.props as Parameters<typeof WorkspaceShell>[0]);
          return renderToStaticMarkup(tree);
        }
        if (currentKey !== child.key) {
          hooks.cleanups.forEach((cleanup) => cleanup());
          hooks = { cursor: 0, slots: [], effects: [], cleanups: new Map() };
          currentKey = child.key;
        }
        props = child.props as typeof props;
      }
      hooks.cursor = 0;
      mocked.hooks = hooks;
      try {
        tree = SurveyEditor(props);
      } finally {
        mocked.hooks = null;
      }
      hooks.effects.splice(0).forEach((effect) => effect());
      tree = WorkspaceShell((tree as ReactElement).props as Parameters<typeof WorkspaceShell>[0]);
      return renderToStaticMarkup(tree);
    },
    button(label: string) {
      const node = elements(tree).find(
        (node) => node.type === "button" && text(node.props.children as ReactNode) === label,
      );
      if (!node) throw new Error(`Missing button ${label}`);
      return node.props as { disabled?: boolean; onClick: () => void };
    },
    authoring() {
      return elements(tree).find((node) => node.type === SurveyPageAuthoring)!.props as {
        draft: PagedSurveyDraft;
        onChange: (value: PagedSurveyDraft) => void;
      };
    },
  };
}
async function settle() {
  for (let index = 0; index < 16; index++) await Promise.resolve();
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  mocked.workspace.canEdit = true;
  mocked.workspace.loading = false;
  mocked.workspace.error = "";
  mocked.workspace.creator = { userId: "actor", workspaceId: "workspace" };
  mocked.workspace.productFeatures = { surveys: true, surveyPages: false };
  mocked.workspace.refreshAccount.mockReset();
  mocked.request.mockResolvedValue({ survey: record() });
});
afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup());
  mocked.hooks = null;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
describe("Survey editor schema reader boundary", () => {
  it("inspects retained conditional pages without constructing autosave or exposing writer actions, even with page editing enabled", async () => {
    const retained = surveyBranchingFixture();
    mocked.workspace.productFeatures.surveyPages = true;
    mocked.request.mockResolvedValue({ survey: { ...record(), draft: retained } });
    const view = harness();
    view.render();
    await settle();
    const markup = view.render();
    expect(markup).toContain("data-survey-branching-readonly");
    expect(markup).toContain(
      "Editing, copying and sharing conditional Surveys are not available yet",
    );
    expect(markup).toContain("Page 1 of 4");
    expect(markup).not.toContain("Publish Survey");
    expect(markup).not.toContain("Save draft");
    expect(markup).not.toContain("Duplicate");
    expect(markup).not.toContain("Create sharing link");
    expect(markup).not.toContain("Loading Survey");
    expect(mocked.constructed).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(5000);
    expect(mocked.request).toHaveBeenCalledOnce();
    mocked.workspace.error = "Refresh failed";
    expect(view.render()).not.toContain("data-survey-branching-readonly");
  });
  it("renders a failed initial workspace load with Retry and loads the editor only after account recovery", async () => {
    mocked.workspace.creator = null;
    mocked.workspace.canEdit = false;
    mocked.workspace.error = "Workspace access temporarily unavailable";
    mocked.workspace.refreshAccount.mockImplementation(async () => {
      mocked.workspace.creator = { userId: "actor", workspaceId: "workspace" };
      mocked.workspace.canEdit = true;
      mocked.workspace.error = "";
    });
    const view = harness(true);
    expect(view.render()).toContain("Workspace access temporarily unavailable");
    expect(mocked.request).not.toHaveBeenCalled();
    view.button("Retry").onClick();
    await settle();
    view.render();
    await settle();
    expect(view.render()).toContain("Saved page 1");
    expect(mocked.constructed).toHaveBeenCalledOnce();
    expect(mocked.workspace.refreshAccount).toHaveBeenCalledOnce();
  });
  it("masks but retains dirty local edits and the same controller across an account outage and Retry", async () => {
    mocked.workspace.productFeatures.surveyPages = true;
    mocked.request.mockImplementation(
      async (_path: string, options?: { method?: string; body?: string }) =>
        options?.method === "PUT"
          ? { survey: { ...record(), draft: JSON.parse(options.body!).draft, revision: 5 } }
          : { survey: record() },
    );
    const view = harness(true);
    view.render();
    await settle();
    view.render();
    const captured = view.authoring();
    captured.onChange(updateSurveyPage(captured.draft, id(11), { title: "Retained unsaved page" }));
    view.render();
    mocked.workspace.creator = null;
    expect(view.render()).not.toContain("Retained unsaved page");
    await vi.advanceTimersByTimeAsync(800);
    expect(mocked.request).toHaveBeenCalledOnce();
    mocked.workspace.loading = true;
    expect(view.render()).not.toContain("Retained unsaved page");
    mocked.workspace.creator = null;
    mocked.workspace.canEdit = false;
    mocked.workspace.loading = false;
    mocked.workspace.error = "Account refresh failed";
    expect(view.render()).toContain("Account refresh failed");
    expect(view.render()).not.toContain("Download local draft");
    captured.onChange(addSurveyPage(captured.draft, id(99)));
    await vi.advanceTimersByTimeAsync(5000);
    expect(mocked.request).toHaveBeenCalledOnce();
    expect(mocked.constructed).toHaveBeenCalledOnce();
    mocked.workspace.refreshAccount.mockImplementation(async () => {
      mocked.workspace.creator = { userId: "actor", workspaceId: "workspace" };
      mocked.workspace.canEdit = true;
      mocked.workspace.error = "";
    });
    view.button("Retry").onClick();
    await settle();
    expect(view.render()).toContain("Retained unsaved page");
    await vi.advanceTimersByTimeAsync(700);
    view.render();
    expect(mocked.constructed).toHaveBeenCalledOnce();
    expect(mocked.request).toHaveBeenCalledTimes(2);
    expect(JSON.parse(mocked.request.mock.calls[1]![1].body).draft.pages).toHaveLength(2);
    expect(view.render()).toContain("Saved.");
  });
  it("initializes a pending Survey read behind the workspace error mask and resumes without another load", async () => {
    let resolve!: (value: unknown) => void;
    mocked.request.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const view = harness(true);
    view.render();
    mocked.workspace.creator = null;
    mocked.workspace.canEdit = false;
    mocked.workspace.error = "Account refresh failed";
    view.render();
    resolve({ survey: record() });
    await settle();
    expect(view.render()).not.toContain("Saved page 1");
    expect(mocked.constructed).toHaveBeenCalledOnce();
    mocked.workspace.creator = { userId: "actor", workspaceId: "workspace" };
    mocked.workspace.canEdit = true;
    mocked.workspace.error = "";
    expect(view.render()).toContain("Saved page 1");
    expect(mocked.request).toHaveBeenCalledOnce();
  });
  it("accepts an in-flight acknowledgement behind the account mask and restores the acknowledged revision without another save", async () => {
    mocked.workspace.productFeatures.surveyPages = true;
    let resolve!: (value: unknown) => void;
    mocked.request.mockImplementation((_path: string, options?: { method?: string }) =>
      options?.method === "PUT"
        ? new Promise((done) => {
            resolve = done;
          })
        : Promise.resolve({ survey: record() }),
    );
    const view = harness(true);
    view.render();
    await settle();
    view.render();
    const captured = view.authoring();
    captured.onChange(
      updateSurveyPage(captured.draft, id(11), { title: "Acknowledged during outage" }),
    );
    view.render();
    view.button("Save draft").onClick();
    await settle();
    const body = JSON.parse(mocked.request.mock.calls[1]![1].body);
    mocked.workspace.creator = null;
    mocked.workspace.canEdit = false;
    mocked.workspace.error = "Account refresh failed";
    view.render();
    resolve({ survey: { ...record(), draft: body.draft, revision: 5 } });
    await settle();
    expect(view.render()).not.toContain("Acknowledged during outage");
    mocked.workspace.creator = { userId: "actor", workspaceId: "workspace" };
    mocked.workspace.canEdit = true;
    mocked.workspace.error = "";
    expect(view.render()).toContain("Acknowledged during outage");
    const controller = mocked.constructed.mock.calls[0]![0] as AutosaveModule.SurveyAutosave;
    expect(controller.snapshot()).toMatchObject({
      dirty: false,
      unsettled: false,
      record: { revision: 5 },
    });
    await vi.advanceTimersByTimeAsync(2000);
    expect(mocked.request).toHaveBeenCalledTimes(2);
    expect(mocked.constructed).toHaveBeenCalledOnce();
  });
  it("defers navigation from an accepted duplicate until fresh account recovery and exact operation retry", async () => {
    mocked.workspace.productFeatures.surveyPages = true;
    let resolve!: (value: unknown) => void;
    mocked.request.mockImplementation((_path: string, options?: { method?: string }) =>
      options?.method === "POST"
        ? new Promise((done) => {
            resolve = done;
          })
        : Promise.resolve({ survey: record() }),
    );
    const view = harness(true);
    view.render();
    await settle();
    view.render();
    view.button("Duplicate").onClick();
    await settle();
    const original = mocked.request.mock.calls[1]!;
    mocked.workspace.creator = null;
    mocked.workspace.canEdit = false;
    mocked.workspace.error = "Account refresh failed";
    view.render();
    const accepted = { survey: { ...record(), id: "created-copy" } };
    resolve(accepted);
    await settle();
    view.render();
    expect(mocked.push).not.toHaveBeenCalled();
    mocked.workspace.creator = { userId: "actor", workspaceId: "workspace" };
    mocked.workspace.canEdit = true;
    mocked.workspace.error = "";
    expect(view.render()).toContain("Saving is paused. Your local edits are kept in this editor.");
    expect(view.button("Retry same operation").disabled).toBe(false);
    mocked.request.mockResolvedValue(accepted);
    view.button("Retry same operation").onClick();
    await settle();
    expect(mocked.request.mock.calls[2]).toEqual(original);
    expect(mocked.push).toHaveBeenCalledExactlyOnceWith("/surveys/created-copy");
  });
  it("recovers a real server capability error through Retry save with its original request and local draft", async () => {
    mocked.workspace.productFeatures.surveyPages = true;
    let enabled = false;
    mocked.request.mockImplementation(
      async (_path: string, options?: { method?: string; body?: string }) => {
        if (options?.method !== "PUT") return { survey: record() };
        if (!enabled)
          throw new ApiClientError(
            "Survey page authoring is paused",
            "SURVEY_PAGES_NOT_ENABLED",
            409,
          );
        return { survey: { ...record(), draft: JSON.parse(options.body!).draft, revision: 5 } };
      },
    );
    const view = harness(true);
    view.render();
    await settle();
    view.render();
    const captured = view.authoring();
    captured.onChange(
      updateSurveyPage(captured.draft, id(11), { title: "Server-paused local page" }),
    );
    view.render();
    view.button("Save draft").onClick();
    await settle();
    const markup = view.render();
    const original = mocked.request.mock.calls[1]!;
    expect(markup).toContain("data-survey-pages-readonly");
    expect(markup).toContain("Server-paused local page");
    expect(markup).not.toContain("changed in another tab");
    expect(markup).not.toContain("Reload latest version");
    expect(view.button("Retry save").disabled).toBe(false);
    captured.onChange(addSurveyPage(captured.draft, id(99)));
    await vi.advanceTimersByTimeAsync(5000);
    expect(mocked.request).toHaveBeenCalledTimes(2);
    enabled = true;
    view.button("Retry save").onClick();
    await settle();
    expect(view.render()).toContain("data-survey-page-authoring");
    expect(mocked.request.mock.calls[2]).toEqual(original);
    expect(view.authoring().draft.pages).toHaveLength(2);
    expect(view.authoring().draft.pages[0]!.title).toBe("Server-paused local page");
  });
  it("disposes the retained scope on a fresh workspace switch and never resurrects a scope after authentication revocation", async () => {
    mocked.workspace.productFeatures.surveyPages = true;
    const browser = Object.assign(new EventTarget(), { confirm: vi.fn() });
    vi.stubGlobal("window", browser);
    const view = harness(true);
    view.render();
    await settle();
    view.render();
    const captured = view.authoring();
    captured.onChange(updateSurveyPage(captured.draft, id(11), { title: "Old workspace secret" }));
    view.render();
    mocked.workspace.creator = null;
    mocked.workspace.canEdit = false;
    mocked.workspace.error = "Account refresh failed";
    view.render();
    mocked.workspace.creator = { userId: "actor", workspaceId: "another-workspace" };
    mocked.workspace.canEdit = true;
    mocked.workspace.error = "";
    mocked.request.mockResolvedValue({
      survey: { ...record(), draft: { ...record().draft, title: "Other workspace Survey" } },
    });
    view.render();
    await settle();
    expect(view.render()).not.toContain("Old workspace secret");
    expect(mocked.constructed).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(2000);
    expect(mocked.request).toHaveBeenCalledTimes(2);
    browser.dispatchEvent(new Event("pollingpops:auth-change"));
    view.render();
    mocked.workspace.creator = null;
    mocked.workspace.canEdit = false;
    mocked.workspace.error = "Account refresh failed";
    view.render();
    mocked.workspace.creator = { userId: "actor", workspaceId: "another-workspace" };
    mocked.workspace.canEdit = true;
    mocked.workspace.error = "";
    expect(view.render()).not.toContain("Other workspace Survey");
    expect(view.render()).not.toContain("data-survey-page-authoring");
    expect(mocked.constructed).toHaveBeenCalledTimes(2);
  });
  it("shows v3 saved pages read-only with autosave disabled and no writing actions when the grant is absent", async () => {
    const before = record();
    mocked.request.mockResolvedValue({ survey: before });
    const view = harness();
    view.render();
    await settle();
    const markup = view.render();
    expect(markup).toContain("data-survey-pages-readonly");
    expect(markup).toContain("Page editing is not enabled for this workspace");
    expect(markup).toContain("Saved page 1");
    expect(markup).toContain("Saved notes 1");
    expect(markup).toContain("Page 1 of 2");
    expect(markup).not.toContain("Publish Survey");
    expect(markup).not.toContain("Save draft");
    expect(markup).not.toContain("Duplicate");
    expect(markup).not.toContain("Create sharing link");
    expect(mocked.constructed).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(5000);
    expect(mocked.request).toHaveBeenCalledOnce();
    expect(mocked.request.mock.calls[0]![1]).toMatchObject({
      headers: { "x-pollingpops-survey-schema": "4" },
    });
    expect(before.draft.schemaVersion).toBe(3);
  });
  it("retains the existing v2 editable editor and its autosave controller", async () => {
    const legacy = { ...draft(), schemaVersion: 2 } as Record<string, unknown>;
    delete legacy.pages;
    mocked.request.mockResolvedValue({
      survey: { ...record(), draft: SurveyDraftSchema.parse(legacy) },
    });
    const view = harness();
    view.render();
    await settle();
    const markup = view.render();
    expect(markup).not.toContain("data-survey-pages-readonly");
    expect(markup).toContain("Publish Survey");
    expect(markup).toContain("Save draft");
    expect(mocked.constructed).toHaveBeenCalledOnce();
    expect(markup).not.toContain("Organize into pages");
  });
  it("converts a legacy draft only after explicit confirmation and saves v3 with stable question IDs", async () => {
    const legacy = { ...draft(), schemaVersion: 2 } as Record<string, unknown>;
    delete legacy.pages;
    const initial = { ...record(), draft: SurveyDraftSchema.parse(legacy) };
    mocked.workspace.productFeatures.surveyPages = true;
    const confirm = vi.fn(() => false);
    vi.stubGlobal("window", Object.assign(new EventTarget(), { confirm }));
    mocked.request.mockImplementation(
      async (_path: string, options?: { method?: string; body?: string }) =>
        options?.method === "PUT"
          ? {
              survey: {
                ...initial,
                draft: JSON.parse(options.body!).draft,
                revision: initial.revision + 1,
              },
            }
          : { survey: initial },
    );
    const view = harness();
    view.render();
    await settle();
    view.render();
    await vi.advanceTimersByTimeAsync(1000);
    expect(mocked.request).toHaveBeenCalledOnce();
    view.button("Organize into pages").onClick();
    expect(view.render()).not.toContain("data-survey-page-authoring");
    confirm.mockReturnValue(true);
    view.button("Organize into pages").onClick();
    expect(view.render()).toContain("data-survey-page-authoring");
    await vi.advanceTimersByTimeAsync(700);
    const body = JSON.parse(mocked.request.mock.calls[1]![1].body);
    expect(body.draft.schemaVersion).toBe(3);
    expect(body.draft.items).toEqual(initial.draft.items);
    expect(body.draft.pages[0].questionIds).toEqual(
      initial.draft.items.map((item) => item.question.id),
    );
  });
  it("keeps unsaved page edits and a local download while capability or role is paused, blocking captured handlers", async () => {
    mocked.workspace.productFeatures.surveyPages = true;
    mocked.request.mockImplementation(
      async (_path: string, options?: { method?: string; body?: string }) =>
        options?.method === "PUT"
          ? { survey: { ...record(), draft: JSON.parse(options.body!).draft, revision: 5 } }
          : { survey: record() },
    );
    const view = harness();
    view.render();
    await settle();
    view.render();
    const captured = view.authoring();
    captured.onChange(updateSurveyPage(captured.draft, id(11), { title: "Unsaved local page" }));
    view.render();
    mocked.workspace.productFeatures.surveyPages = false;
    const markup = view.render();
    expect(markup).toContain("Unsaved local page");
    expect(markup).toContain("Download local draft");
    expect(markup).toContain("data-survey-pages-readonly");
    captured.onChange(addSurveyPage(captured.draft, id(99)));
    await vi.advanceTimersByTimeAsync(5000);
    expect(mocked.request).toHaveBeenCalledOnce();
    mocked.workspace.productFeatures.surveyPages = true;
    mocked.workspace.canEdit = false;
    view.render();
    await vi.advanceTimersByTimeAsync(5000);
    expect(mocked.request).toHaveBeenCalledOnce();
    const controller = mocked.constructed.mock.calls[0]![0] as AutosaveModule.SurveyAutosave;
    expect(controller.snapshot().draft.schemaVersion).toBe(3);
    expect((controller.snapshot().draft as PagedSurveyDraft).pages[0]!.title).toBe(
      "Unsaved local page",
    );
    expect((controller.snapshot().draft as PagedSurveyDraft).pages).toHaveLength(2);
    mocked.workspace.canEdit = true;
    view.render();
    await vi.advanceTimersByTimeAsync(700);
    expect(mocked.request).toHaveBeenCalledTimes(2);
    expect(controller.snapshot()).toMatchObject({
      dirty: false,
      record: { revision: 5 },
      draft: { schemaVersion: 3, pages: [{ title: "Unsaved local page" }, {}] },
    });
  });
  it("disables an unconfirmed operation during a page pause and retries the exact request after authority returns", async () => {
    mocked.workspace.productFeatures.surveyPages = true;
    mocked.request.mockImplementation(async (_path: string, options?: { method?: string }) => {
      if (options?.method === "POST") throw new TypeError("Acknowledgement lost");
      return { survey: record() };
    });
    const view = harness();
    view.render();
    await settle();
    view.render();
    view.button("Publish Survey").onClick();
    await settle();
    view.render();
    const original = mocked.request.mock.calls[1]!;
    expect(view.button("Retry same operation").disabled).toBe(false);
    mocked.workspace.productFeatures.surveyPages = false;
    view.render();
    const pausedRetry = view.button("Retry same operation");
    expect(pausedRetry.disabled).toBe(true);
    pausedRetry.onClick();
    await settle();
    expect(mocked.request).toHaveBeenCalledTimes(2);
    mocked.workspace.productFeatures.surveyPages = true;
    view.render();
    mocked.request.mockResolvedValue({
      survey: { ...record(), status: "published", publishedRevision: 4 },
    });
    view.button("Retry same operation").onClick();
    await settle();
    view.render();
    expect(mocked.request).toHaveBeenCalledTimes(3);
    expect(mocked.request.mock.calls[2]).toEqual(original);
    expect(view.render()).toContain("Survey published.");
  });
  it("blocks a captured publish after its save barrier when page authority is revoked", async () => {
    mocked.workspace.productFeatures.surveyPages = true;
    let acknowledge!: (value: unknown) => void;
    mocked.request.mockImplementation(
      (_path: string, options?: { method?: string; body?: string }) =>
        options?.method === "PUT"
          ? new Promise((resolve) => {
              acknowledge = resolve;
            })
          : Promise.resolve({ survey: record() }),
    );
    const view = harness();
    view.render();
    await settle();
    view.render();
    const captured = view.authoring();
    captured.onChange(updateSurveyPage(captured.draft, id(11), { title: "Saving local page" }));
    view.render();
    view.button("Publish Survey").onClick();
    await settle();
    expect(mocked.request).toHaveBeenCalledTimes(2);
    mocked.workspace.productFeatures.surveyPages = false;
    view.render();
    acknowledge({
      survey: {
        ...record(),
        draft: JSON.parse(mocked.request.mock.calls[1]![1].body).draft,
        revision: 5,
      },
    });
    await settle();
    view.render();
    expect(mocked.request).toHaveBeenCalledTimes(2);
    expect(view.render()).toContain("data-survey-pages-readonly");
  });
  it("does not apply a late load from another actor/workspace or after an authentication event", async () => {
    let resolve!: (value: unknown) => void;
    mocked.request.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const browser = Object.assign(new EventTarget(), { confirm: vi.fn() });
    vi.stubGlobal("window", browser);
    const view = harness();
    view.render();
    mocked.workspace.creator = { userId: "other", workspaceId: "elsewhere" };
    view.render();
    resolve({ survey: record() });
    await settle();
    expect(view.render()).not.toContain("Saved ordered feedback");
    expect(mocked.constructed).not.toHaveBeenCalled();
    browser.dispatchEvent(new Event("pollingpops:auth-change"));
    expect(view.render()).not.toContain("Saved ordered feedback");
  });
});
