import { isValidElement, type ReactElement, type ReactNode } from "react";
import type * as ReactModule from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SurveyContentSchema } from "@openround/contracts/surveys";
import { SurveyPagedReader } from "./survey-paged-reader";

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
