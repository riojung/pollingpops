import { isValidElement, type ReactElement, type ReactNode } from "react";
import type * as ReactModule from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspaceProductFeaturesSchema } from "@openround/contracts";
import type {
  CheckpointSetImportUnavailableReason,
  SupportedLocale,
  WorkspaceProductFeatures,
} from "@openround/contracts";
import { CheckpointSetImport } from "../../components/checkpoint-set-import";
import { creationContent } from "../../lib/i18n/creation-content";
import { englishMessages, translate, type MessageKey } from "../../lib/i18n/catalog";
import { creationMethodCopy } from "../../lib/i18n/creation-method-copy";

interface Hooks {
  cursor: number;
  slots: unknown[];
  effects: Array<{ effect: () => unknown; dependencies?: readonly unknown[] }>;
}

const allFeatures = () =>
  WorkspaceProductFeaturesSchema.parse({
    workspaceShell: true,
    builderV2: true,
    presentations: true,
    surveys: true,
    ideaBoards: true,
    canvasBoards: true,
    roundExperiences: false,
    audiencePulse: false,
    roomChat: false,
    uxBeta: false,
    recoveryRehearsal: false,
    practiceAssignments: false,
    presentationRealtime: false,
    groups: false,
    discover: false,
  });

const fixtures = vi.hoisted(() => ({
  query: "",
  push: vi.fn(),
  features: null as WorkspaceProductFeatures | null,
  canEdit: true,
  entitlements: { csvExport: true } as { csvExport: boolean } | null,
  checkpointSetImportUnavailableReason: undefined as
    CheckpointSetImportUnavailableReason | undefined,
  hooks: null as Hooks | null,
  request: vi.fn(),
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

vi.mock("../../components/locale-provider", () => ({
  useLocale: () => ({
    locale: fixtures.locale,
    t: (key: MessageKey) => translate(englishMessages, key),
  }),
}));
vi.mock("../../lib/api", () => ({
  apiFetch: fixtures.request,
  humanError: (error: Error) => error.message,
}));
vi.mock("../../components/workspace/product-events", () => ({ recordCreationEvent: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: fixtures.push }),
  useSearchParams: () => new URLSearchParams(fixtures.query),
}));

vi.mock("../../components/workspace/workspace-provider", () => ({
  WorkspaceProvider: ({ children }: { children: ReactNode }) => children,
  useWorkspace: () => ({
    canEdit: fixtures.canEdit,
    entitlements: fixtures.entitlements,
    checkpointSetImportUnavailableReason: fixtures.checkpointSetImportUnavailableReason,
    productFeatures: fixtures.features,
  }),
}));

vi.mock("../../components/workspace/workspace-shell", () => ({
  WorkspaceShell: ({ children, title }: { children: ReactNode; title: string }) => (
    <main>
      <h1>{title}</h1>
      {children}
    </main>
  ),
}));

vi.mock("../../components/authoring-assistant", () => ({
  AuthoringAssistant: () => <div>Source authoring workflow</div>,
}));

vi.mock("../../components/checkpoint-set-import", () => ({
  CheckpointSetImport: () => <div>Structured import workflow</div>,
}));

vi.mock("../../components/workspace/starter-gallery", () => ({
  StarterGallery: () => <div>Starter gallery</div>,
}));

import CreatePage from "./page";

function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement<Record<string, unknown>>(node)) return [];
  return [node, ...elements(node.props.children as ReactNode)];
}

const cleanups: Array<() => void> = [];
function view() {
  const hooks: Hooks = { cursor: 0, slots: [], effects: [] };
  const committedEffects: Array<{ dependencies?: readonly unknown[]; cleanup: unknown }> = [];
  const page = CreatePage();
  const shell = page.props.children as ReactElement<{ children: ReactElement }>;
  const content = shell.props.children.type as () => ReactElement;
  const cleanup = () => {
    committedEffects.forEach(({ cleanup }) => {
      if (typeof cleanup === "function") cleanup();
    });
  };
  cleanups.push(cleanup);
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
    effects() {
      for (const [index, incoming] of hooks.effects.entries()) {
        const previous = committedEffects[index];
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
        committedEffects[index] = {
          dependencies: incoming.dependencies,
          cleanup: incoming.effect(),
        };
      }
    },
    cleanup,
  };
}

const html = (tree: ReactNode) => renderToStaticMarkup(tree);
const form = (tree: ReactNode) => elements(tree).find((element) => element.type === "form")!;
const submit = (element: ReactElement<Record<string, unknown>>) =>
  (element.props.onSubmit as (event: { preventDefault: () => void }) => Promise<void>)({
    preventDefault: vi.fn(),
  });

afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup());
  vi.unstubAllGlobals();
});

describe("Round creation launcher", () => {
  beforeEach(() => {
    fixtures.query = "";
    fixtures.push.mockClear();
    fixtures.features = allFeatures();
    fixtures.canEdit = true;
    fixtures.entitlements = { csvExport: true };
    fixtures.checkpointSetImportUnavailableReason = undefined;
    fixtures.hooks = null;
    fixtures.request.mockReset();
    fixtures.locale = "en-CA";
    vi.stubGlobal(
      "window",
      Object.assign(new EventTarget(), {
        location: new URL("https://example.test/create"),
      }),
    );
  });

  it("leads with common goals and keeps additional formats in a disclosure", () => {
    const markup = renderToStaticMarkup(<CreatePage />);

    expect(markup).toContain("What would you like to do?");
    expect(markup).toContain('href="/create?type=quiz"');
    expect(markup).toContain('href="/create?type=poll"');
    expect(markup).toContain("Ask a quick poll");
    expect(markup).toContain("Check understanding");
    expect(markup).toContain("Build a presentation");
    expect(markup).toContain("<summary>More formats</summary>");
    expect(markup).not.toContain('type="button"');
    expect(markup).toContain('href="/surveys/new"');
    expect(markup).toContain('href="/create?type=custom"');
    expect(markup).toContain('href="/create/presentation"');
    expect(markup).toContain('href="/boards?create=1"');
    expect(markup).toContain("at their own pace");
    expect(markup).not.toContain("Source authoring workflow");
    expect(markup).not.toContain("Structured import workflow");
    expect(fixtures.request).not.toHaveBeenCalled();
  });

  it("opens a quiz blank draft form immediately and keeps alternatives in the same surface", () => {
    fixtures.query = "type=quiz";
    const markup = renderToStaticMarkup(<CreatePage />);
    expect(markup).toContain("Start a blank Round");
    expect(markup).toContain('role="tablist" aria-label="Starting points"');
    expect(markup).toContain('aria-selected="true" id="creation-start-blank"');
    expect(markup).toContain('aria-labelledby="creation-start-blank"');
    expect(markup).toContain(">Templates</button>");
    expect(markup).toContain(">Source assistance</button>");
    expect(markup).toContain(">Import</button>");
    expect(fixtures.request).not.toHaveBeenCalled();
  });

  it("navigates from a poll goal through every allowed starting method without creating a draft", () => {
    const page = view();
    const poll = elements(page.render()).find(
      (element) => element.props.href === "/create?type=poll",
    );
    expect(poll).toBeDefined();
    expect(poll!.type).not.toBe("button");
    fixtures.query = new URL(poll!.props.href as string, "https://example.test").search.slice(1);
    const blank = page.render();
    expect(html(blank)).toContain("Start a blank Round");
    expect(fixtures.request).not.toHaveBeenCalled();
    const templates = elements(blank).find(
      (element) => element.props.id === "creation-start-starters",
    )!;
    (templates.props.onClick as () => void)();
    expect(fixtures.push).toHaveBeenLastCalledWith("/create?type=poll&start=starters", {
      scroll: false,
    });
    fixtures.query = "type=poll&start=starters";
    expect(html(page.render())).toContain("Starter gallery");
    expect(fixtures.request).not.toHaveBeenCalled();
  });

  it.each([
    ["blank", "roundBlank"],
    ["starters", "roundTemplate"],
    ["source", "roundSource"],
    ["import", "roundImport"],
  ] as const)("selects the quiz %s workflow through navigation only", (method, explanationKey) => {
    fixtures.query = "type=quiz";
    const page = view();
    const tab = elements(page.render()).find(
      (element) => element.props.id === `creation-start-${method}`,
    )!;
    (tab.props.onClick as () => void)();
    expect(fixtures.push).toHaveBeenLastCalledWith(`/create?type=quiz&start=${method}`, {
      scroll: false,
    });
    fixtures.query = `type=quiz&start=${method}`;
    const markup = html(page.render());
    expect(markup).toContain(`aria-selected="true" id="creation-start-${method}"`);
    expect(markup).toContain(`aria-labelledby="creation-start-${method}"`);
    const explanation = creationMethodCopy("en-CA").methods[explanationKey];
    expect(markup).toContain(html(explanation.input));
    expect(markup).toContain(html(explanation.assistance));
    expect(markup).toContain(html(explanation.nextStep));
    expect(fixtures.request).not.toHaveBeenCalled();
  });

  it.each([
    [false, "operator_policy"],
    [true, undefined],
    [null, undefined],
  ] as const)("passes an import reason only with a confirmed denial (%s)", (csvExport, reason) => {
    fixtures.query = "type=quiz&start=import";
    fixtures.entitlements = csvExport === null ? null : { csvExport };
    fixtures.checkpointSetImportUnavailableReason = "operator_policy";
    const panel = elements(view().render()).find((element) => element.type === CheckpointSetImport);
    expect(panel?.props).toMatchObject({
      enabled: csvExport === true,
      unavailableReason: reason,
    });
  });

  it("retains source deep links and explains incompatible poll imports without opening blank", () => {
    fixtures.query = "type=quiz&start=source";
    expect(renderToStaticMarkup(<CreatePage />)).toContain("Source authoring workflow");
    fixtures.query = "type=poll&start=import";
    const markup = renderToStaticMarkup(<CreatePage />);
    expect(markup).toContain(creationMethodCopy("en-CA").incompatiblePoll);
    expect(markup).toContain('href="/create?type=custom&amp;start=import"');
    expect(markup).not.toContain("Start a blank Round");
    expect(markup).not.toContain("Structured import workflow");
    expect(markup).not.toContain('id="creation-start-import"');
    expect(markup).not.toContain('id="creation-start-source"');
  });

  it.each([
    "type=unknown",
    "type=quiz&type=poll",
    "type=quiz&type=quiz",
    "type=quiz&start=unknown",
    "type=quiz&start=blank&start=source",
    "type=quiz&start=source&start=source",
  ])("explains invalid selection %s without choosing a workflow or posting", (query) => {
    fixtures.query = query;
    const markup = renderToStaticMarkup(<CreatePage />);
    expect(markup).toContain(creationMethodCopy("en-CA").invalidSelection);
    expect(markup).not.toContain('role="tabpanel"');
    expect(markup).not.toContain("Source authoring workflow");
    expect(markup).not.toContain("Structured import workflow");
    expect(fixtures.request).not.toHaveBeenCalled();
  });

  it("follows legacy hashes on initial load, hash changes, and back navigation without posting", () => {
    window.location.hash = "#source";
    const page = view();
    page.render();
    page.effects();
    expect(html(page.render())).toContain("Source authoring workflow");
    window.location.hash = "#import";
    window.dispatchEvent(new Event("hashchange"));
    expect(html(page.render())).toContain("Structured import workflow");
    window.location.hash = "#starters";
    window.dispatchEvent(new Event("popstate"));
    expect(html(page.render())).toContain("Starter gallery");
    window.location.hash = "";
    window.dispatchEvent(new Event("popstate"));
    expect(html(page.render())).toContain('href="/create?type=poll"');
    expect(html(page.render())).not.toContain('role="tabpanel"');
    expect(fixtures.request).not.toHaveBeenCalled();
  });

  it("keeps explicit methods authoritative over hashes, including invalid explicit methods", () => {
    fixtures.query = "type=quiz&start=blank";
    window.location.hash = "#source";
    const page = view();
    page.render();
    page.effects();
    expect(html(page.render())).toContain("Start a blank Round");
    window.location.hash = "#import";
    window.dispatchEvent(new Event("hashchange"));
    expect(html(page.render())).not.toContain("Structured import workflow");
    fixtures.query = "type=quiz&start=unknown";
    const markup = html(page.render());
    expect(markup).toContain(creationMethodCopy("en-CA").invalidSelection);
    expect(markup).not.toContain('role="tabpanel"');
    expect(fixtures.request).not.toHaveBeenCalled();
  });

  it("explains an incompatible legacy poll source hash and offers the same method for custom Rounds", () => {
    fixtures.query = "type=poll";
    window.location.hash = "#source";
    const page = view();
    page.render();
    page.effects();
    const markup = html(page.render());
    expect(markup).toContain(creationMethodCopy("en-CA").incompatiblePoll);
    expect(markup).toContain('href="/create?type=custom&amp;start=source"');
    expect(markup).not.toContain('role="tabpanel"');
    expect(fixtures.request).not.toHaveBeenCalled();
  });

  it("localizes goal names and starting method controls in the selected language", () => {
    fixtures.locale = "ko-KR";
    const goals = renderToStaticMarkup(<CreatePage />);
    expect(goals).toContain("무엇을 하고 싶으세요?");
    expect(goals).toContain("빠른 투표 진행");
    expect(goals).not.toContain("Ask a quick poll");
    fixtures.query = "type=quiz";
    const workflow = renderToStaticMarkup(<CreatePage />);
    expect(workflow).toContain('aria-label="시작 방법"');
    expect(workflow).toContain(">템플릿</button>");
    expect(workflow).toContain(">가져오기</button>");
  });

  it.each(["en-CA", "ko-KR"] as const)(
    "creates one private unscored draft after the explicit action and captures %s through a locale change",
    async (locale) => {
      fixtures.locale = locale;
      fixtures.query = "type=poll";
      let acknowledge!: (value: unknown) => void;
      fixtures.request.mockImplementation(
        () =>
          new Promise((resolve) => {
            acknowledge = resolve;
          }),
      );
      const page = view();
      const createForm = form(page.render());
      expect(createForm).toBeDefined();
      expect(fixtures.request).not.toHaveBeenCalled();
      const first = submit(createForm);
      const second = submit(createForm);
      fixtures.locale = locale === "ko-KR" ? "en-CA" : "ko-KR";
      acknowledge({ quiz: { id: "new-poll" } });
      await Promise.all([first, second]);
      expect(fixtures.request).toHaveBeenCalledExactlyOnceWith("/v1/quizzes", {
        method: "POST",
        body: JSON.stringify({ title: creationContent(locale)("untitledRound"), description: "" }),
      });
      expect(fixtures.push).toHaveBeenCalledExactlyOnceWith(
        `/quiz/new-poll?insert=poll&creationLocale=${locale}`,
      );
    },
  );

  it("hides ungranted products while retaining independently granted boards and legacy Rounds", () => {
    fixtures.features = {
      ...allFeatures(),
      builderV2: false,
      presentations: false,
      surveys: false,
      canvasBoards: false,
      ideaBoards: true,
    };
    fixtures.query = "type=quiz&start=blank";
    const markup = renderToStaticMarkup(<CreatePage />);
    expect(markup).toContain('href="/dashboard"');
    expect(markup).toContain('href="/boards?create=1"');
    expect(markup).not.toContain('href="/surveys/new"');
    expect(markup).not.toContain('href="/create/presentation"');
    expect(markup).not.toContain("Create Round and write question");
  });
  it("keeps the Round menu choice focused on Round variants and blocks viewer creation", () => {
    fixtures.query = "product=round";
    const markup = renderToStaticMarkup(<CreatePage />);
    expect(markup).toContain('href="/create?type=quiz"');
    expect(markup).not.toContain('href="/boards?create=1"');
    fixtures.canEdit = false;
    const viewer = renderToStaticMarkup(<CreatePage />);
    expect(viewer).not.toContain('href="/create?type=quiz"');
    expect(viewer).not.toContain('href="/surveys/new"');
    expect(viewer).not.toContain('href="/boards?create=1"');
  });

  it.each(["viewer", "feature"])(
    "blocks an earlier create handler after %s access is revoked",
    async (restriction) => {
      fixtures.query = "type=poll&start=blank";
      const page = view();
      const earlierForm = form(page.render());
      if (restriction === "viewer") fixtures.canEdit = false;
      else fixtures.features = { ...allFeatures(), builderV2: false };
      expect(html(page.render())).not.toContain('type="submit"');
      await submit(earlierForm);
      expect(fixtures.request).not.toHaveBeenCalled();
    },
  );

  it.each(["source", "import", "starters"])(
    "does not mount the %s workflow without editing authority",
    (method) => {
      fixtures.query = `type=quiz&start=${method}`;
      fixtures.canEdit = false;
      const markup = renderToStaticMarkup(<CreatePage />);
      expect(markup).not.toContain("Source authoring workflow");
      expect(markup).not.toContain("Structured import workflow");
      expect(markup).not.toContain("Starter gallery");
      expect(fixtures.request).not.toHaveBeenCalled();
    },
  );

  it("offers only unscored responses for a live poll", () => {
    fixtures.query = "type=poll&start=blank";
    const markup = renderToStaticMarkup(<CreatePage />);
    expect(markup).toContain('value="poll"');
    expect(markup).toContain('value="rating"');
    expect(markup).not.toContain('value="single_select"');
    expect(markup).not.toContain('value="numeric"');
  });
  it("offers scored responses for a quiz and every format for custom", () => {
    fixtures.query = "type=quiz&start=blank";
    const quiz = renderToStaticMarkup(<CreatePage />);
    expect(quiz).toContain('value="numeric"');
    expect(quiz).not.toContain('value="rating"');
    fixtures.query = "type=custom&start=blank";
    expect(renderToStaticMarkup(<CreatePage />)).toContain('value="rating"');
  });

  it("renders only the selected creation workflow", () => {
    fixtures.query = "start=blank";
    const markup = renderToStaticMarkup(<CreatePage />);

    expect(markup).toContain("Start a blank Round");
    expect(markup).toContain("First response type");
    expect(markup).toContain("Create Round and write question");
    expect(markup).not.toContain("Source authoring workflow");
    expect(markup).not.toContain("Structured import workflow");
    expect(markup).not.toContain("Starter gallery");
  });
});
