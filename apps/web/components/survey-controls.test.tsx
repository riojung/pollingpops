import { Children, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { SurveyQuestionDraft } from "@openround/contracts/surveys";
import {
  newSurveyQuestion,
  SurveyQuestionActions,
  SurveyQuestionEditor,
  SurveyResponseControl,
} from "./survey-controls";

function elements(node: ReactNode, type: string): ReactElement<Record<string, unknown>>[] {
  const matches: ReactElement<Record<string, unknown>>[] = [];
  Children.forEach(node, (child) => {
    if (!isValidElement<Record<string, unknown>>(child)) return;
    if (child.type === type) matches.push(child);
    matches.push(...elements(child.props.children as ReactNode, type));
  });
  return matches;
}

function button(node: ReactNode, name: string) {
  const control = elements(node, "button").find(
    (element) =>
      element.props["aria-label"] === name ||
      Children.toArray(element.props.children as ReactNode).join("") === name,
  );
  if (!control) throw new Error(`Missing button: ${name}`);
  return control;
}

function click(control: ReactElement<Record<string, unknown>>) {
  (control.props.onClick as () => void)();
}

describe("Survey selection controls", () => {
  it("keeps legacy single-choice polls as radios and offers bounded selection settings", () => {
    const question = newSurveyQuestion("poll");
    const markup = renderToStaticMarkup(<SurveyResponseControl question={question} />);
    expect(markup.match(/type="radio"/g)).toHaveLength(2);
    expect(markup).not.toContain('type="checkbox"');
    const editor = renderToStaticMarkup(
      <SurveyQuestionEditor question={question} onChange={() => {}} disabled={false} />,
    );
    expect(editor).toContain("Maximum selections");
    expect(editor).toContain("2 — multiple choices");
    expect(editor).not.toContain("3 — multiple choices");
  });
  it("uses accessible checkboxes and keeps selected options enabled at the limit", () => {
    const question = newSurveyQuestion("poll");
    if (question.type !== "poll") throw new Error("Expected poll");
    question.choices.push({
      id: "11111111-1111-4111-8111-111111111111",
      label: "Third",
      isCorrect: false,
    });
    question.maxSelections = 2;
    const markup = renderToStaticMarkup(
      <SurveyResponseControl
        question={question}
        required
        response={{ kind: "poll", choiceIds: question.choices.slice(0, 2).map((c) => c.id) }}
      />,
    );
    expect(markup.match(/type="checkbox"/g)).toHaveLength(3);
    expect(markup.match(/checked=""/g)).toHaveLength(2);
    expect(markup.match(/disabled=""/g)).toHaveLength(1);
    expect(markup).toContain("Select up to 2 options. 2 selected.");
  });

  it("wraps poll and rating response labels separately from their native selection controls", () => {
    const poll = newSurveyQuestion("poll");
    if (poll.type !== "poll") throw new Error("Expected poll");
    poll.choices[0]!.label = "A".repeat(180);
    const rating = newSurveyQuestion("rating");
    const pollMarkup = renderToStaticMarkup(<SurveyResponseControl question={poll} disabled />);
    const ratingMarkup = renderToStaticMarkup(<SurveyResponseControl question={rating} />);
    expect(pollMarkup).toMatch(/<fieldset[^>]*disabled=""/);
    expect(pollMarkup).toContain(`<span>${poll.choices[0]!.label}</span></label>`);
    expect(ratingMarkup.match(/type="radio"/g)).toHaveLength(5);
    expect(ratingMarkup).toContain("<span>1 — Not at all</span>");
    expect(ratingMarkup).toContain("<span>5 — Very much</span>");
  });
});

describe("Survey question editing", () => {
  it("uses labelled multiline prompt and option fields with separate accessible remove buttons", () => {
    const markup = renderToStaticMarkup(
      <SurveyQuestionEditor question={newSurveyQuestion("poll")} onChange={() => {}} disabled />,
    );
    expect(markup).toMatch(/<fieldset[^>]*disabled=""/);
    expect(markup).toMatch(/Question<textarea[^>]*maxLength="500"[^>]*rows="3"/);
    expect(markup.match(/<textarea[^>]*maxLength="180"[^>]*rows="2"/g)).toHaveLength(2);
    expect(markup).toMatch(/aria-label="Remove option 1"[^>]*disabled=""/);
    expect(markup).toMatch(/<svg aria-hidden="true"/);
    expect(markup).not.toContain("small-button");
  });

  it("preserves multiline option edits, the two-to-six option bounds, and selection limits on removal", () => {
    let question = newSurveyQuestion("poll");
    const render = () =>
      SurveyQuestionEditor({
        question,
        disabled: false,
        onChange: (next) => {
          question = next;
        },
      });
    expect(button(render(), "Remove option 1").props.disabled).toBe(true);
    const label = "A long response\nwith a second line";
    const option = elements(render(), "textarea").find(
      (field) => field.props.value === "Option 1",
    )!;
    (option.props.onChange as (event: { target: { value: string } }) => void)({
      target: { value: label },
    });
    for (let i = 0; i < 4; i++) click(button(render(), "Add option"));
    expect(button(render(), "Add option").props.disabled).toBe(true);
    if (question.type !== "poll") throw new Error("Expected poll");
    expect(question.choices).toHaveLength(6);
    expect(question.choices[0]!.label).toBe(label);
    const retainedIds = question.choices.slice(0, 5).map((choice) => choice.id);
    question = { ...question, maxSelections: 6 };
    click(button(render(), "Remove option 6"));
    if (question.type !== "poll") throw new Error("Expected poll");
    expect(question.maxSelections).toBe(5);
    expect(question.choices.map((choice) => choice.id)).toEqual(retainedIds);
    expect(button(render(), "Add option").props.disabled).toBe(false);
  });

  it("keeps rating endpoint inputs labelled, full-length, and independent", () => {
    const question = newSurveyQuestion("rating");
    const onChange = vi.fn<(next: SurveyQuestionDraft) => void>();
    const tree = SurveyQuestionEditor({ question, disabled: false, onChange });
    const inputs = elements(tree, "input");
    expect(inputs).toHaveLength(2);
    expect(inputs.map((input) => input.props.maxLength)).toEqual([80, 80]);
    (inputs[0]!.props.onChange as (event: { target: { value: string } }) => void)({
      target: { value: "Low confidence" },
    });
    expect(onChange).toHaveBeenCalledWith({ ...question, minLabel: "Low confidence" });
    const markup = renderToStaticMarkup(tree);
    expect(markup).toContain("Low endpoint label");
    expect(markup).toContain("High endpoint label");
  });

  it("keeps question movement bounded and removal distinct in an accessible action group", () => {
    const onMove = vi.fn();
    const onRemove = vi.fn();
    const render = (index: number, disabled = false) =>
      SurveyQuestionActions({ index, count: 3, disabled, onMove, onRemove });
    expect(button(render(0), "Move up").props.disabled).toBe(true);
    expect(button(render(2), "Move down").props.disabled).toBe(true);
    expect(elements(render(1, true), "button").every((control) => control.props.disabled)).toBe(
      true,
    );
    click(button(render(1), "Move up"));
    click(button(render(1), "Move down"));
    click(button(render(1), "Remove question 2"));
    expect(onMove.mock.calls).toEqual([[-1], [1]]);
    expect(onRemove).toHaveBeenCalledOnce();
    const markup = renderToStaticMarkup(render(1));
    expect(markup).toContain('role="group" aria-label="Question 2 actions"');
    expect(markup).not.toContain("small-button");
  });
});
