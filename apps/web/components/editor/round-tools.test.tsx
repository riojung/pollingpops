import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { QuestionDraft } from "@openround/contracts";
import { describe, expect, it, vi } from "vitest";
import { translate, type MessageKey } from "../../lib/i18n/catalog";
import { deliveryAuthoringEnglishMessages } from "../../lib/i18n/domains/delivery-authoring";
import { DeliveryScoring } from "./delivery-scoring";
import { DiagnosticDetails } from "./diagnostic-details";
import { QuestionInspector } from "./question-inspector";
import type { QuestionUpdater } from "./types";

vi.mock("../locale-provider", () => ({
  useLocale: () => ({
    locale: "en-CA",
    t: (key: MessageKey) => translate(deliveryAuthoringEnglishMessages, key),
  }),
}));

function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement<Record<string, unknown>>(node)) return [];
  return [node, ...elements(node.props.children as ReactNode)];
}

const numeric: QuestionDraft = {
  id: "main-question",
  type: "numeric",
  prompt: "Estimate the area",
  correctValue: "4",
  tolerance: "0",
  unit: null,
  timeLimitSeconds: 45,
  basePoints: 1500,
  explanation: "Four square units",
  mediaId: null,
  mediaAlt: null,
  conceptKeys: ["area"],
};

function selectChange(field: ReactElement<Record<string, unknown>>, value: string) {
  (field.props.onChange as (event: { target: { value: string } }) => void)({ target: { value } });
}

function updater(initial: QuestionDraft) {
  let current = initial;
  const update: QuestionUpdater = (change) => {
    current = change(current);
  };
  return { update, value: () => current };
}

describe("Round delivery and diagnostic tools", () => {
  it("keeps imported timing and point values selectable, and edits explanation without changing identity", () => {
    const harness = updater(numeric);
    const tree = DeliveryScoring({ question: numeric, onUpdateQuestion: harness.update });
    const all = elements(tree);
    const selectors = all.filter((element) => element.type === "select");
    expect(
      elements(selectors[0])
        .filter((element) => element.type === "option")
        .map((element) => element.props.value),
    ).toContain(45);
    expect(
      elements(selectors[1])
        .filter((element) => element.type === "option")
        .map((element) => element.props.value),
    ).toContain(1500);
    selectChange(selectors[0]!, "60");
    selectChange(selectors[1]!, "2000");
    selectChange(
      all.find((element) => element.type === "textarea")!,
      "New explanation",
    );
    expect(harness.value()).toMatchObject({
      id: numeric.id,
      timeLimitSeconds: 60,
      basePoints: 2000,
      explanation: "New explanation",
    });
    const markup = renderToStaticMarkup(tree);
    expect(markup).toContain("Timing and scoring");
    expect(markup).toContain("Answer explanation");
    expect(markup.match(/<details/g)).toHaveLength(2);
    expect(markup.match(/<details[^>]*open=""/g)).toHaveLength(1);
  });

  it.each(["poll", "rating", "ranking", "open_text", "word_cloud"] as const)(
    "keeps %s unscored and its confidence/purpose controls unavailable",
    (type) => {
      const question = { ...numeric, type } as QuestionDraft;
      const change = vi.fn();
      const delivery = elements(DeliveryScoring({ question, onUpdateQuestion: change }));
      const points = delivery.filter((element) => element.type === "select")[1]!;
      expect(points.props.disabled).toBe(true);
      selectChange(points, "2000");
      const diagnostic = elements(
        DiagnosticDetails({
          question,
          questions: [question],
          uxBeta: true,
          onUpdateQuestion: change,
        }),
      );
      const selectors = diagnostic.filter((element) => element.type === "select");
      expect(selectors).toHaveLength(2);
      for (const field of selectors) {
        expect(field.props.disabled).toBe(true);
        selectChange(field, "optional");
      }
      expect(change).not.toHaveBeenCalled();
      expect(
        renderToStaticMarkup(DeliveryScoring({ question, onUpdateQuestion: change })),
      ).toContain("does not award points");
    },
  );

  it("edits concepts, confidence, purpose, and a recheck by stable question ID", () => {
    const recheck = {
      ...numeric,
      id: "paired-question",
      delivery: "recheck",
      prompt: "",
    } as QuestionDraft;
    const main = { ...numeric, linkedRecheckQuestionId: recheck.id };
    const harness = updater(main);
    const tree = DiagnosticDetails({
      question: main,
      questions: [main, recheck],
      uxBeta: true,
      onUpdateQuestion: harness.update,
    });
    const all = elements(tree);
    const selectors = all.filter((element) => element.type === "select");
    expect(selectors).toHaveLength(3);
    selectChange(selectors[0]!, "practice");
    selectChange(selectors[1]!, "optional");
    selectChange(
      all.find((element) => element.type === "input")!,
      "area, estimation, ",
    );
    expect(selectors[2]!.props.value).toBe(recheck.id);
    expect(
      elements(selectors[2])
        .filter((element) => element.type === "option")
        .map((element) => element.props.value),
    ).toEqual(["", recheck.id]);
    selectChange(selectors[2]!, "");
    expect(harness.value()).toMatchObject({
      id: numeric.id,
      purpose: "practice",
      confidence: "optional",
      conceptKeys: ["area", "estimation"],
      linkedRecheckQuestionId: null,
    });
    const markup = renderToStaticMarkup(tree);
    expect(markup).toContain('id="question-diagnostic-details"');
    expect(markup).toContain("Untitled question");
    expect(markup.match(/<details/g)).toHaveLength(3);
    expect(
      elements(
        DiagnosticDetails({
          question: recheck,
          questions: [main, recheck],
          uxBeta: true,
          onUpdateQuestion: harness.update,
        }),
      ).filter((element) => element.type === "select"),
    ).toHaveLength(2);
  });

  it("keeps the legacy controls directly available without new disclosure wrappers", () => {
    const props = { question: numeric, onUpdateQuestion: vi.fn(), uxBeta: false };
    expect(renderToStaticMarkup(DeliveryScoring(props))).not.toContain("<details");
    expect(
      renderToStaticMarkup(DiagnosticDetails({ ...props, questions: [numeric] })),
    ).not.toContain("<details");
  });
});

describe("Round question inspector", () => {
  const inspector = (props: Partial<Parameters<typeof QuestionInspector>[0]> = {}) =>
    QuestionInspector({
      activeTab: "build",
      collapsed: false,
      build: <input aria-label="Editable setting" />,
      diagnose: <p>Diagnostic controls</p>,
      recover: <a href="#recheck">Open recheck</a>,
      onTabChange: vi.fn(),
      onToggle: vi.fn(),
      question: numeric,
      questionNumber: 3,
      ...props,
    });

  it("names the selected question and supports a compact modal without making desktop tools modal", () => {
    const desktop = renderToStaticMarkup(inspector());
    expect(desktop).toContain('id="round-question-tools"');
    expect(desktop).toContain("Question tools");
    expect(desktop).toContain("Question 3");
    expect(desktop).toContain('data-question-id="main-question"');
    expect(desktop).toContain("Estimate the area");
    expect(desktop).toContain("Scored");
    expect(desktop).not.toContain('role="dialog"');
    expect(renderToStaticMarkup(inspector({ modal: true }))).toContain('aria-modal="true"');
    expect(renderToStaticMarkup(inspector({ modal: true, collapsed: true }))).not.toContain(
      'aria-modal="true"',
    );
    expect(renderToStaticMarkup(inspector({ question: { ...numeric, prompt: "" } }))).toContain(
      "Untitled question",
    );
  });

  it("labels a single-select opinion as unscored and uses the same type name as the Round canvas", () => {
    const markup = renderToStaticMarkup(
      inspector({
        question: {
          id: "opinion-choice",
          type: "single_select",
          purpose: "opinion",
          prompt: "Which approach would you choose?",
          timeLimitSeconds: 30,
          basePoints: 0,
          explanation: "",
          mediaId: null,
          mediaAlt: null,
          choices: [
            { id: "choice-a", label: "Approach A", isCorrect: true },
            { id: "choice-b", label: "Approach B", isCorrect: false },
          ],
        },
      }),
    );
    expect(markup).toContain(
      translate(deliveryAuthoringEnglishMessages, "delivery.builder.type.single_select"),
    );
    expect(markup).toContain(">Unscored</span>");
    expect(markup).not.toContain(">Scored</span>");
  });

  it("keeps tab navigation and close available while disabling viewer mutation fields", () => {
    const onToggle = vi.fn();
    const onTabChange = vi.fn();
    const tree = inspector({ readOnly: true, onToggle, onTabChange });
    const all = elements(tree);
    const buttons = all.filter((element) => element.type === "button");
    expect(buttons).toHaveLength(4);
    expect(buttons.every((element) => !element.props.disabled)).toBe(true);
    (buttons[0]!.props.onClick as () => void)();
    expect(onToggle).toHaveBeenCalledOnce();
    (buttons[2]!.props.onClick as () => void)();
    expect(onTabChange).toHaveBeenCalledWith("diagnose");
    expect(
      all
        .filter((element) => element.type === "fieldset")
        .every((element) => element.props.disabled),
    ).toBe(true);
    expect(renderToStaticMarkup(tree)).toContain('<a href="#recheck">Open recheck</a>');
  });

  it("moves keyboard focus and selection together across the tools tabs", () => {
    const onTabChange = vi.fn();
    const tabs = elements(inspector({ onTabChange })).filter(
      (element) => element.props.role === "tab",
    );
    const focus = vi.fn();
    const querySelector = vi.fn(() => ({ focus }));
    const preventDefault = vi.fn();
    const onKeyDown = tabs[0]!.props.onKeyDown as (event: unknown) => void;
    onKeyDown({ key: "End", preventDefault, currentTarget: { parentElement: { querySelector } } });
    expect(onTabChange).toHaveBeenCalledWith("recover");
    expect(querySelector).toHaveBeenCalledWith("#inspector-tab-recover");
    expect(focus).toHaveBeenCalledOnce();
    expect(preventDefault).toHaveBeenCalledOnce();
  });
});
