import { isValidElement, type ReactElement, type ReactNode } from "react";
import type * as ReactModule from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspaceProductFeaturesSchema } from "@openround/contracts";
import type { SupportedLocale, WorkspaceProductFeatures } from "@openround/contracts";
import { creationContent } from "../../lib/i18n/creation-content";
import { englishMessages, translate, type MessageKey } from "../../lib/i18n/catalog";

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
  capture: false,
  request: vi.fn(),
  locale: "en-CA" as SupportedLocale,
}));

vi.mock("react", async (original) => {
  const react = await original<typeof ReactModule>();
  return {
    ...react,
    useState: <T,>(initial: T) => (fixtures.capture ? [initial, vi.fn()] : react.useState(initial)),
    useRef: <T,>(initial: T) => (fixtures.capture ? { current: initial } : react.useRef(initial)),
    useEffect: (...args: Parameters<typeof react.useEffect>) => {
      if (!fixtures.capture) react.useEffect(...args);
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
    entitlements: { csvExport: true },
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

describe("Round creation launcher", () => {
  beforeEach(() => {
    fixtures.query = "";
    fixtures.push.mockClear();
    fixtures.features = allFeatures();
    fixtures.canEdit = true;
    fixtures.capture = false;
    fixtures.request.mockReset();
    fixtures.locale = "en-CA";
  });

  it("leads with common goals and keeps additional formats in a disclosure", () => {
    const markup = renderToStaticMarkup(<CreatePage />);

    expect(markup).toContain("What would you like to do?");
    expect(markup).toContain('href="/create?type=quiz"');
    expect(markup).toContain("Ask a quick poll");
    expect(markup).toContain("Check understanding");
    expect(markup).toContain("Build a presentation");
    expect(markup).toContain("<summary>More formats</summary>");
    expect(markup).toContain('type="button"');
    expect(markup).toContain('href="/surveys/new"');
    expect(markup).toContain('href="/create?type=custom"');
    expect(markup).toContain('href="/create/presentation"');
    expect(markup).toContain('href="/boards?create=1"');
    expect(markup).toContain("at their own pace");
    expect(markup).not.toContain("Source authoring workflow");
    expect(markup).not.toContain("Structured import workflow");
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

  it("retains source deep links but prevents scored import methods for a poll", () => {
    fixtures.query = "type=quiz&start=source";
    expect(renderToStaticMarkup(<CreatePage />)).toContain("Source authoring workflow");
    fixtures.query = "type=poll&start=import";
    const markup = renderToStaticMarkup(<CreatePage />);
    expect(markup).toContain("Start a blank Round");
    expect(markup).not.toContain("Structured import workflow");
    expect(markup).not.toContain('id="creation-start-import"');
    expect(markup).not.toContain('id="creation-start-source"');
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
      let acknowledge!: (value: unknown) => void;
      fixtures.request.mockImplementation(
        () =>
          new Promise((resolve) => {
            acknowledge = resolve;
          }),
      );
      fixtures.capture = true;
      const page = CreatePage();
      const shell = page.props.children as ReactElement<{ children: ReactElement }>;
      const content = shell.props.children;
      const tree = (content.type as () => ReactElement)();
      fixtures.capture = false;
      function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
        if (Array.isArray(node)) return node.flatMap(elements);
        if (!isValidElement<Record<string, unknown>>(node)) return [];
        return [node, ...elements(node.props.children as ReactNode)];
      }
      const button = elements(tree).find((element) => element.type === "button");
      expect(button).toBeDefined();
      expect(fixtures.request).not.toHaveBeenCalled();
      (button!.props.onClick as () => void)();
      (button!.props.onClick as () => void)();
      fixtures.locale = locale === "ko-KR" ? "en-CA" : "ko-KR";
      acknowledge({ quiz: { id: "new-poll" } });
      for (let index = 0; index < 8; index++) await Promise.resolve();
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
