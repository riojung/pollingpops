import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { newSurveyQuestion, SurveyQuestionEditor, SurveyResponseControl } from "./survey-controls";

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
});
