import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { withEnglishLocale } from "../../test-utils/english-locale";
import { BuilderCommandBar } from "./builder-command-bar";
import { QuestionInspector } from "./question-inspector";
import { ReadinessSummary } from "./readiness-summary";

const noop = () => undefined;

vi.mock("next/navigation", () => ({
  usePathname: () => "/quiz/test-round",
}));

describe("Round Builder shell", () => {
  it("keeps title, autosave, history, preview, and publish in one command bar", () => {
    const markup = renderToStaticMarkup(
      withEnglishLocale(
        <BuilderCommandBar
          canRedo={false}
          canUndo
          inspectorOpen
          onPreview={noop}
          onPublish={noop}
          onRedo={noop}
          onTitleChange={noop}
          onToggleInspector={noop}
          onToggleQuestionMap={noop}
          onUndo={noop}
          previewDisabled={false}
          publishDisabled={false}
          publishLabel="Publish"
          productFeatures={{ workspaceShell: true }}
          questionMapOpen
          saveState="saving"
          status="draft"
          title="Safety refresher"
        />,
      ),
    );

    expect(markup).toContain('id="quiz-title"');
    expect(markup).toContain('value="Safety refresher"');
    expect(markup).toContain('class="brand" href="/home"');
    expect(markup).toContain("Saving…");
    expect(markup).toContain('aria-label="Undo last edit"');
    expect(markup).toContain('aria-label="Redo last edit"');
    expect(markup).toContain(">Preview</button>");
    expect(markup).toContain(">Publish</button>");
    expect(markup).toContain('href="/library?type=rounds"');
  });

  it("keeps the brand inside the signed-in legacy dashboard when workspace Home is unavailable", () => {
    const markup = renderToStaticMarkup(
      withEnglishLocale(
        <BuilderCommandBar
          canRedo={false}
          canUndo={false}
          inspectorOpen
          onPreview={noop}
          onPublish={noop}
          onRedo={noop}
          onTitleChange={noop}
          onToggleInspector={noop}
          onToggleQuestionMap={noop}
          onUndo={noop}
          previewDisabled
          publishDisabled
          publishLabel="Publish"
          productFeatures={{ workspaceShell: false }}
          questionMapOpen
          saveState="saved"
          title="Legacy Round"
        />,
      ),
    );

    expect(markup).toContain('class="brand" href="/dashboard"');
    expect(markup).not.toContain('class="brand" href="/home"');
  });

  it("exposes every readiness issue as a navigable action", () => {
    const markup = renderToStaticMarkup(
      withEnglishLocale(
        <ReadinessSummary
          action="publish"
          issues={[
            {
              id: "question-one",
              source: "Question 1",
              resolution: "Enter the question prompt.",
              questionId: "one",
            },
            {
              id: "question-two",
              source: "Question 2",
              resolution: "Fill answer choice 2.",
              questionId: "two",
            },
          ]}
          onSelectIssue={noop}
        />,
      ),
    );

    expect(markup).toContain("Cannot publish this Round yet");
    expect(markup).toContain("2 items need attention");
    expect(markup).toContain("Question 1: Enter the question prompt.");
    expect(markup).toContain("Question 2: Fill answer choice 2.");
    expect(markup).toContain('class="sr-only" lang="en-CA"');
    expect(markup).toContain('lang="en-CA" title="Enter the question prompt."');
  });

  it("renders Build, Diagnose, and Recover as an accessible inspector tab set", () => {
    const markup = renderToStaticMarkup(
      withEnglishLocale(
        <QuestionInspector
          activeTab="diagnose"
          build={<p>Build controls</p>}
          collapsed={false}
          diagnose={<p>Diagnostic controls</p>}
          onTabChange={noop}
          onToggle={noop}
          recover={<p>Recovery controls</p>}
        />,
      ),
    );

    expect(markup).toContain('role="tablist"');
    expect(markup).toContain('aria-selected="true"');
    expect(markup).toContain("Build");
    expect(markup).toContain("Diagnose");
    expect(markup).toContain("Recover");
    expect(markup).toContain("Diagnostic controls");
    expect(markup).toContain('id="inspector-build"');
    expect(markup).toContain('hidden=""');
    expect(markup.match(/tabindex="0"/gi)).toHaveLength(1);
    expect(markup.match(/tabindex="-1"/gi)).toHaveLength(2);
  });
});
