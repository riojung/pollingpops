import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { QuestionDraft, QuizDraft, StarterGuide } from "@openround/contracts";
import type { SurveyDraft } from "@openround/contracts/surveys";
import { StarterTemplatePreview } from "./starter-template-preview";

const guide: StarterGuide = {
  audience: "Facilitators reviewing a team decision",
  minutes: 15,
  preparation: "Prepare one self-contained example.",
  facilitation: "Compare the explanations before the next check.",
  interpretation: "A preference is not evidence of knowledge.",
  followUp: "Record one change and revisit it next week.",
};
const question: QuestionDraft = {
  id: "00000000-0000-4000-8000-000000000001",
  type: "single_select",
  prompt: "Which claim is supported by the supplied counts?",
  purpose: "diagnostic",
  confidence: "off",
  delivery: "main",
  conceptKeys: [],
  linkedRecheckQuestionId: null,
  timeLimitSeconds: 60,
  basePoints: 1000,
  explanation: "Compare both the count and its denominator.",
  mediaId: null,
  mediaAlt: null,
  choices: [
    { id: "00000000-0000-4000-8000-000000000002", label: "Use the denominator", isCorrect: true },
    {
      id: "00000000-0000-4000-8000-000000000003",
      label: "Ignore the denominator",
      isCorrect: false,
    },
  ],
};
const draft: QuizDraft = {
  title: "A claim worth checking",
  description: "A worked example to adapt for your group.",
  category: "education",
  experiencePreset: { id: "focus", version: 1 },
  questions: [question],
};

describe("starter template preview", () => {
  it("lets a creator inspect the full question, answer reasoning and run guide without answering", () => {
    const before = JSON.stringify({ draft, guide });
    const markup = renderToStaticMarkup(
      <StarterTemplatePreview
        id="source-evaluation"
        content={{ kind: "round", draft }}
        guide={guide}
        contentLocale="en-CA"
        uiLocale="en-CA"
        closeLabel="Close preview"
        onClose={() => {}}
      />,
    );
    expect(markup).toContain('id="starter-preview-source-evaluation"');
    expect(markup).toContain(question.prompt);
    expect(markup).toContain(question.explanation);
    expect(markup).toContain("Correct answer");
    expect(markup).toContain(guide.preparation);
    expect(markup).toContain(guide.followUp);
    expect(markup).not.toContain("<input");
    expect(markup).not.toContain("<form");
    expect(JSON.stringify({ draft, guide })).toBe(before);
  });

  it("previews the actual Survey introduction and optional flags without implying correct opinions", () => {
    const opinion: QuestionDraft = {
      ...question,
      type: "poll",
      purpose: "opinion",
      basePoints: 0,
      explanation: "",
      choices: question.choices.map((choice) => ({ ...choice, isCorrect: false })),
    };
    const survey: SurveyDraft = {
      schemaVersion: 2,
      title: "Event experience",
      description: "Tell us what would help at the next event. You may skip optional items.",
      category: "general",
      experiencePreset: { id: "focus", version: 1 },
      items: [
        { required: true, question: opinion },
        { required: false, question: { ...opinion, id: "00000000-0000-4000-8000-000000000004" } },
      ],
    };
    const before = JSON.stringify(survey);
    const markup = renderToStaticMarkup(
      <StarterTemplatePreview
        id="event-feedback"
        content={{ kind: "survey", draft: survey }}
        contentLocale="fr-FR"
        uiLocale="en-CA"
        closeLabel="Close preview"
        onClose={() => {}}
      />,
    );
    expect(markup).toContain(survey.description);
    expect(markup).toContain("Required");
    expect(markup).toContain("Optional");
    expect(markup).toContain('lang="fr-FR"');
    expect(markup).not.toContain("Correct answer");
    expect(JSON.stringify(survey)).toBe(before);
  });
});
