import type { ReactElement, ReactNode } from "react";
import type * as ReactModule from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SurveyDraftSchema } from "@openround/contracts/surveys";
import type { SurveyRecordView } from "../../../lib/survey-client";
import type * as ApiModule from "../../../lib/api";
import type * as AutosaveModule from "../../../lib/survey-autosave";

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
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock("../../../components/workspace/workspace-provider", () => ({
  WorkspaceProvider: ({ children }: { children: ReactNode }) => children,
  useWorkspace: () => ({ canEdit: true, productFeatures: { surveys: true }, entitlements: null }),
}));
vi.mock("../../../components/workspace/workspace-shell", () => ({
  WorkspaceShell: ({ children }: { children: ReactNode }) => <main>{children}</main>,
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
        mocked.constructed();
      }
    },
  };
});
import SurveyEditorPage from "./page";
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
function harness() {
  const hooks: Hooks = { cursor: 0, slots: [], effects: [], cleanups: new Map() };
  const wrapper = SurveyEditorPage();
  const provider = wrapper.props.children as ReactElement<{ children: ReactElement }>;
  const editor = provider.props.children.type as (props: { id: string }) => ReactNode;
  cleanups.push(() => hooks.cleanups.forEach((cleanup) => cleanup()));
  return {
    render() {
      hooks.cursor = 0;
      mocked.hooks = hooks;
      let tree;
      try {
        tree = editor({ id: "survey" });
      } finally {
        mocked.hooks = null;
      }
      hooks.effects.splice(0).forEach((effect) => effect());
      return renderToStaticMarkup(tree);
    },
  };
}
async function settle() {
  for (let index = 0; index < 16; index++) await Promise.resolve();
}
beforeEach(() => {
  vi.clearAllMocks();
  mocked.request.mockResolvedValue({ survey: record() });
});
afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup());
  mocked.hooks = null;
});
describe("Survey editor schema reader boundary", () => {
  it("shows v3 saved pages read-only without constructing autosave or exposing writing actions", async () => {
    const before = record();
    mocked.request.mockResolvedValue({ survey: before });
    const view = harness();
    view.render();
    await settle();
    const markup = view.render();
    expect(markup).toContain("data-survey-pages-readonly");
    expect(markup).toContain("Page authoring is not available in this editor yet");
    expect(markup).toContain("Saved page 1");
    expect(markup).toContain("Saved notes 1");
    expect(markup).toContain("Page 1 of 2");
    expect(markup).not.toContain("Publish Survey");
    expect(markup).not.toContain("Save draft");
    expect(markup).not.toContain("Duplicate");
    expect(markup).not.toContain("Create sharing link");
    expect(mocked.constructed).not.toHaveBeenCalled();
    expect(mocked.request).toHaveBeenCalledOnce();
    expect(mocked.request.mock.calls[0]![1]).toMatchObject({
      headers: { "x-pollingpops-survey-schema": "3" },
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
  });
});
