import { isValidElement, type ReactElement, type ReactNode } from "react";
import type * as ReactModule from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SurveyContentSchema } from "@openround/contracts/surveys";
import { SurveyPagedReader } from "./survey-paged-reader";
import { surveyBranchingFixture } from "../../../packages/contracts/test/support/survey-branching-fixture";

type Hooks = { cursor: number; slots: unknown[]; effects: Array<() => void> };
const mocked = vi.hoisted(() => ({ hooks: null as Hooks | null }));
vi.mock("react", async (original) => {
  const react = await original<typeof ReactModule>();
  return {
    ...react,
    useRef: <T,>(initial: T) => {
      const hooks = mocked.hooks;
      if (!hooks) return react.useRef(initial);
      const index = hooks.cursor++;
      hooks.slots[index] ??= { current: initial };
      return hooks.slots[index];
    },
    useEffect: (effect: ReactModule.EffectCallback, dependencies: readonly unknown[]) => {
      const hooks = mocked.hooks;
      if (!hooks) return react.useEffect(effect, dependencies);
      const index = hooks.cursor++;
      const previous = hooks.slots[index] as readonly unknown[] | undefined;
      if (!previous || dependencies.some((value, index) => !Object.is(value, previous[index]))) {
        hooks.slots[index] = dependencies;
        hooks.effects.push(effect as () => void);
      }
    },
  };
});
const id = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
const content = SurveyContentSchema.parse({
  schemaVersion: 3,
  title: "Saved feedback",
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
    title: `Page ${index} authored title`,
    description: `Notes ${index}`,
    questionIds: [id(index)],
  })),
});
function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement<Record<string, unknown>>(node)) return [];
  return [node, ...elements(node.props.children as ReactNode)];
}
afterEach(() => {
  mocked.hooks = null;
});
describe("ordered Survey reader", () => {
  it("renders only eligible pages with localized visible progress and a final submit control", () => {
    const conditional = surveyBranchingFixture();
    const markup = renderToStaticMarkup(
      <SurveyPagedReader
        content={conditional}
        responses={{ [id(1)]: { kind: "poll", choiceIds: [id(102)] } }}
        pageIndex={1}
        locale="fr-FR"
        onBack={() => {}}
        onNext={() => {}}
        onSubmit={() => {}}
        validation={{ [id(2)]: "required" }}
      />,
    );
    expect(markup).toContain("Page 2 sur 2");
    expect(markup).toContain('data-survey-page="' + id(14) + '"');
    expect(markup).toContain("Instructions 4");
    expect(markup).toContain("Feedback 4");
    expect(markup).not.toContain("Show detailed feedback?");
    expect(markup).not.toContain("Feedback 3");
    expect(markup).not.toContain('role="alert"');
    expect(markup).toContain("Envoyer l’Enquête");
    expect(markup).not.toContain(">Suivant</button>");
  });

  it("limits all-page inspection to read-only previews and keeps retained conditional review visible-only", () => {
    const source = surveyBranchingFixture();
    const common = {
      content: source,
      pageIndex: 1,
      locale: "en-CA" as const,
      inspectAllPages: true,
      onBack() {},
      onNext() {},
      onSubmit() {},
    };
    const preview = renderToStaticMarkup(<SurveyPagedReader {...common} preview />);
    expect(preview).toContain("Page 2 of 4");
    expect(preview).toContain("Show detailed feedback?");
    expect(preview).toMatch(/<fieldset[^>]*disabled=""/);
    expect(preview).not.toContain("Submit Survey");
    const retained = renderToStaticMarkup(<SurveyPagedReader {...common} closed />);
    expect(retained).toContain("Page 2 of 2");
    expect(retained).toContain("Feedback 4");
    expect(retained).not.toContain("Show detailed feedback?");
    expect(retained).toMatch(/<fieldset[^>]*disabled=""/);
    expect(retained).not.toContain("Submit Survey");
  });

  it("focuses the current visible heading when a branch replaces the page at the same visible index", () => {
    const hooks: Hooks = { cursor: 0, slots: [], effects: [] };
    const focus = vi.fn();
    const props = {
      content: surveyBranchingFixture(),
      responses: { [id(1)]: { kind: "poll" as const, choiceIds: [id(101)] } },
      pageIndex: 1,
      locale: "en-CA" as const,
      onBack() {},
      onNext() {},
    };
    const render = () => {
      hooks.cursor = 0;
      mocked.hooks = hooks;
      const tree = SurveyPagedReader(props);
      mocked.hooks = null;
      for (const node of elements(tree))
        if (node.type === "h2") (node.props.ref as { current: unknown }).current = { focus };
      hooks.effects.splice(0).forEach((effect) => effect());
      return renderToStaticMarkup(tree);
    };
    expect(render()).toContain("Page 2 of 3");
    props.responses = { [id(1)]: { kind: "poll", choiceIds: [id(102)] } };
    expect(render()).toContain("Page 2 of 2");
    expect(focus).toHaveBeenCalledTimes(2);
  });

  it.each(["", "  \t  "])(
    "uses the localized heading fallback for an unsaved blank title %j without changing source text",
    (rawTitle) => {
      const draft = {
        ...content,
        pages:
          content.schemaVersion === 3
            ? content.pages.map((page, index) =>
                index === 0 ? { ...page, title: rawTitle } : page,
              )
            : [],
      };
      const markup = renderToStaticMarkup(
        <SurveyPagedReader
          content={draft}
          pageIndex={0}
          locale="en-CA"
          preview
          onBack={() => {}}
          onNext={() => {}}
        />,
      );
      expect(markup).toContain('lang="en-CA">Page 1</h2>');
      expect(draft.pages[0]!.title).toBe(rawTitle);
    },
  );
  it("shows only the current page with authored headings, notes, progress and accessible response errors", () => {
    const markup = renderToStaticMarkup(
      <SurveyPagedReader
        content={content}
        pageIndex={0}
        locale="en-CA"
        onBack={() => {}}
        onNext={() => {}}
        validation={{ [id(1)]: "required" }}
        validationRevision={1}
      />,
    );
    expect(markup).toContain('data-survey-page="' + id(11) + '"');
    expect(markup).toContain("Page 1 of 2");
    expect(markup).toContain("Page 1 authored title");
    expect(markup).toContain("Notes 1");
    expect(markup).not.toContain("Question 2");
    expect(markup).toContain('aria-invalid="true"');
    expect(markup).toContain(`aria-describedby="survey-error-${id(1)}"`);
    expect(markup).toContain("Answer the required questions on this page");
    expect(markup).toContain('disabled="">Back</button>');
  });
  it("moves focus to the new page heading and to the first invalid response only on validation", () => {
    const hooks: Hooks = { cursor: 0, slots: [], effects: [] };
    const headingFocus = vi.fn();
    const inputFocus = vi.fn();
    const query = vi.fn(() => ({ focus: inputFocus }));
    const props = {
      content,
      pageIndex: 0,
      locale: "en-CA" as const,
      onBack: vi.fn(),
      onNext: vi.fn(),
      validation: {} as Record<string, "required">,
      validationRevision: 0,
    };
    function render() {
      hooks.cursor = 0;
      mocked.hooks = hooks;
      const tree = SurveyPagedReader(props);
      mocked.hooks = null;
      for (const node of elements(tree)) {
        const ref = node.props.ref as { current: unknown } | undefined;
        if (ref && node.type === "h2") ref.current = { focus: headingFocus };
        if (ref && node.type === "section") ref.current = { querySelector: query };
      }
      hooks.effects.splice(0).forEach((effect) => effect());
    }
    render();
    expect(headingFocus).toHaveBeenCalledOnce();
    props.validation = { [id(1)]: "required" };
    props.validationRevision = 1;
    render();
    expect(query).toHaveBeenCalledWith(`[name="${id(1)}"]:not(:disabled)`);
    expect(inputFocus).toHaveBeenCalledOnce();
    props.validation = {};
    render();
    expect(inputFocus).toHaveBeenCalledOnce();
    props.pageIndex = 1;
    render();
    expect(headingFocus).toHaveBeenCalledTimes(2);
  });
  it("keeps closed and preview pages reviewable while disabling answers and hiding submission", () => {
    const closed = renderToStaticMarkup(
      <SurveyPagedReader
        content={content}
        pageIndex={0}
        locale="en-CA"
        closed
        onBack={() => {}}
        onNext={() => {}}
        onSubmit={() => {}}
      />,
    );
    expect(closed).toContain('type="button">Next</button>');
    expect(closed).toMatch(/<fieldset[^>]*disabled=""/);
    expect(closed).not.toContain("Submit Survey");
    const preview = renderToStaticMarkup(
      <SurveyPagedReader
        content={content}
        pageIndex={1}
        locale="ko-KR"
        preview
        onBack={() => {}}
        onNext={() => {}}
      />,
    );
    expect(preview).toContain('lang="ko-KR"');
    expect(preview).not.toContain("Submit Survey");
    expect(preview).toMatch(/<fieldset[^>]*disabled=""/);
  });
  it("provides an intermediate submit control for implicit Enter and consumes its click exactly once", () => {
    const hooks: Hooks = { cursor: 0, slots: [], effects: [] };
    const onNext = vi.fn();
    mocked.hooks = hooks;
    const tree = SurveyPagedReader({
      content,
      pageIndex: 0,
      locale: "en-CA",
      onBack: vi.fn(),
      onNext,
    });
    mocked.hooks = null;
    const next = elements(tree).find(
      (node) => node.type === "button" && node.props.children === "Next",
    )!;
    expect(next.props.type).toBe("submit");
    const preventDefault = vi.fn();
    (next.props.onClick as (event: { preventDefault: () => void }) => void)({ preventDefault });
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(onNext).toHaveBeenCalledOnce();
    const preview = renderToStaticMarkup(
      <SurveyPagedReader
        content={content}
        pageIndex={0}
        locale="en-CA"
        preview
        onBack={() => {}}
        onNext={() => {}}
      />,
    );
    expect(preview).toContain('type="button">Next</button>');
    expect(preview).not.toContain('type="submit"');
  });
});
