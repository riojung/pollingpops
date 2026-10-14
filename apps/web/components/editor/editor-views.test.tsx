import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { QuestionDraft, QuizDraft } from "@openround/contracts";
import { withEnglishLocale } from "../../test-utils/english-locale";
import { DeliveryScoring } from "./delivery-scoring";
import { DiagnosticDetails } from "./diagnostic-details";
import { MediaEditor } from "./media-editor";
import { ParticipantPreview } from "./participant-preview";
import { QuestionNavigator } from "./question-navigator";
import { ResponseEditor } from "./response-editor";

const noopUpdate = () => undefined;

vi.mock("next/navigation", () => ({
  usePathname: () => "/quiz/test-round",
}));

function renderLocalized(node: ReactNode) {
  return renderToStaticMarkup(withEnglishLocale(node));
}

const choiceQuestion: QuestionDraft = {
  id: "11111111-1111-4111-8111-111111111111",
  type: "single_select",
  prompt: "Which model fits?",
  purpose: "diagnostic",
  confidence: "required",
  delivery: "main",
  conceptKeys: ["models"],
  linkedRecheckQuestionId: "22222222-2222-4222-8222-222222222222",
  timeLimitSeconds: 20,
  basePoints: 1_000,
  explanation: "Compare the evidence.",
  mediaId: null,
  mediaAlt: "Two models side by side",
  choices: [
    {
      id: "33333333-3333-4333-8333-333333333333",
      label: "Model A",
      isCorrect: true,
    },
    {
      id: "44444444-4444-4444-8444-444444444444",
      label: "Model B",
      isCorrect: false,
      misconceptionKey: "surface-match",
      feedback: "It matches one surface feature.",
    },
  ],
};

const recheckQuestion: QuestionDraft = {
  ...choiceQuestion,
  id: "22222222-2222-4222-8222-222222222222",
  prompt: "Which model fits the new evidence?",
  delivery: "recheck",
  linkedRecheckQuestionId: null,
};

const draft: QuizDraft = {
  title: "Models",
  description: "Check model selection.",
  questions: [choiceQuestion, recheckQuestion],
};

describe("editor views", () => {
  it("gates text authoring, enforces ten checkpoints and avoids rating or confidence fallback", () => {
    const text: QuestionDraft = {
      id: choiceQuestion.id,
      type: "open_text",
      prompt: "Share an idea",
      purpose: "opinion",
      confidence: "off",
      delivery: "main",
      basePoints: 0,
      timeLimitSeconds: 60,
      explanation: "",
      mediaId: null,
      mediaAlt: null,
    };
    const nav = (enabled: boolean, count: number) =>
      renderLocalized(
        <QuestionNavigator
          draft={{
            ...draft,
            questions: Array.from({ length: count }, (_, index) => ({
              ...text,
              id: String(index),
            })),
          }}
          insertType="open_text"
          selectedQuestionId={text.id}
          uxBeta
          openTextPollsEnabled={enabled}
          wordCloudPollsEnabled={enabled}
          onAddQuestion={noopUpdate}
          onInsertTypeChange={noopUpdate}
          onSelectQuestion={noopUpdate}
        />,
      );
    expect(nav(false, 1)).not.toContain('<option value="open_text">');
    expect(nav(false, 1)).not.toContain('<option value="word_cloud">');
    expect(nav(true, 1)).toMatch(/<option value="open_text"[^>]*>Open text<\/option>/);
    expect(nav(true, 10)).toMatch(/disabled=""[^>]*>Add question/);
    const editor = renderLocalized(
      <ResponseEditor
        question={text}
        uxBeta
        onStructuralChange={noopUpdate}
        onUpdateChoiceQuestion={noopUpdate}
        onUpdateQuestion={noopUpdate}
      />,
    );
    expect(editor).toContain("up to 1000 characters");
    expect(editor).not.toContain("Minimum");
    const preview = renderLocalized(<ParticipantPreview question={text} />);
    expect(preview).toContain("Your response");
    expect(preview).not.toContain("Confidence will be requested");
    expect(preview).not.toContain("preview-rating");
    expect(
      renderLocalized(
        <DiagnosticDetails
          question={text}
          questions={[text]}
          uxBeta
          onUpdateQuestion={noopUpdate}
        />,
      ),
    ).not.toContain("Paired recheck question");
  });
  it("gates ranking insertion and keeps ranking authoring, delivery and previews unscored", () => {
    const ranking: QuestionDraft = {
      ...choiceQuestion,
      type: "ranking",
      purpose: "opinion",
      confidence: "off",
      delivery: "main",
      linkedRecheckQuestionId: null,
      basePoints: 0,
      rankCount: 2,
      maxSelections: undefined,
      choices: choiceQuestion.choices.map((choice) => ({ ...choice, isCorrect: false })),
    };
    const navigation = (enabled: boolean) =>
      renderLocalized(
        <QuestionNavigator
          draft={draft}
          insertType="single_select"
          selectedQuestionId={choiceQuestion.id}
          uxBeta
          rankingPollsEnabled={enabled}
          onAddQuestion={noopUpdate}
          onInsertTypeChange={noopUpdate}
          onSelectQuestion={noopUpdate}
        />,
      );
    expect(navigation(false)).not.toContain('<option value="ranking">');
    expect(navigation(true)).toContain('<option value="ranking">Ranking</option>');
    const editor = renderLocalized(
      <ResponseEditor
        question={ranking}
        uxBeta
        rankingPollsEnabled
        onStructuralChange={noopUpdate}
        onUpdateChoiceQuestion={noopUpdate}
        onUpdateQuestion={noopUpdate}
      />,
    );
    expect(editor).toContain("Choices to rank");
    expect(editor).not.toContain("Mark choice");
    expect(editor).not.toContain("Diagnostic rationale");
    expect(
      renderLocalized(<DeliveryScoring question={ranking} onUpdateQuestion={noopUpdate} />),
    ).toContain('<select class="select" disabled=""');
    const preview = renderLocalized(<ParticipantPreview question={ranking} />);
    expect(preview).toContain("Your ranking");
    expect(preview).toContain('aria-label="Move Model A down"');
    expect(preview).not.toContain("Confidence will be requested");
  });
  it("gates the live poll limit picker and previews multiple selection without scoring controls", () => {
    const poll: QuestionDraft = {
      ...choiceQuestion,
      type: "poll",
      purpose: "opinion",
      confidence: "off",
      basePoints: 0,
      maxSelections: 2,
      choices: choiceQuestion.choices.map((choice) => ({ ...choice, isCorrect: false })),
    };
    const renderPoll = (enabled: boolean) =>
      renderLocalized(
        <ResponseEditor
          question={poll}
          uxBeta
          multiSelectPollsEnabled={enabled}
          onStructuralChange={() => undefined}
          onUpdateQuestion={noopUpdate}
          onUpdateChoiceQuestion={noopUpdate}
        />,
      );
    expect(renderPoll(true)).toContain("Maximum selections");
    expect(renderPoll(true)).toContain("Participants may select up to this limit");
    expect(renderPoll(true)).not.toContain("Mark choice");
    expect(renderPoll(false)).toContain('<select class="select" disabled=""');
    expect(renderPoll(false)).toContain("not enabled for this workspace");
    const preview = renderLocalized(<ParticipantPreview question={poll} />);
    expect(preview).toContain("Select up to 2 options");
    expect(preview.match(/type="checkbox"/g)).toHaveLength(2);
    expect(preview).not.toContain("Confidence will be requested");
    expect(
      renderLocalized(
        <ResponseEditor
          question={{ ...poll, maxSelections: 1 }}
          uxBeta
          onStructuralChange={() => undefined}
          onUpdateQuestion={noopUpdate}
          onUpdateChoiceQuestion={noopUpdate}
        />,
      ),
    ).not.toContain("Maximum selections");
  });
  it("keeps stable-id navigation and the beta Insert menu labels", () => {
    const markup = renderLocalized(
      <QuestionNavigator
        canReuseQuestions
        draft={draft}
        insertType="numeric"
        onAddQuestion={() => undefined}
        onInsertTypeChange={() => undefined}
        onMoveQuestion={() => undefined}
        onOpenQuestionReuse={() => undefined}
        onSelectQuestion={() => undefined}
        questionReuseOpen={false}
        selectedQuestionId={recheckQuestion.id}
        uxBeta
      />,
    );

    expect(markup).toContain('id="insert-question-type"');
    expect(markup).toContain('id="insert-question-guidance"');
    expect(markup).toContain("A numeric answer with optional tolerance and unit.");
    expect(markup).toContain("Add question");
    expect(markup).toContain("Reuse from your workspace");
    expect(markup).toContain('aria-controls="private-question-bank"');
    expect(markup).toContain('aria-expanded="false"');
    expect(markup).toContain('aria-current="true"');
    expect(markup).toContain("Which model fits the new evidence?");
    expect(markup).toContain('<span lang="">Which model fits the new evidence?</span>');
    expect(markup).toContain("Single select · recheck");
    expect(markup).toMatch(/aria-label="Question 1 actions"[^>]*lang="en-CA"/);
  });

  it("preserves the feature-off checkpoint navigator", () => {
    const markup = renderLocalized(
      <QuestionNavigator
        draft={draft}
        insertType="single_select"
        onAddQuestion={() => undefined}
        onInsertTypeChange={() => undefined}
        onSelectQuestion={() => undefined}
        selectedQuestionId={choiceQuestion.id}
        uxBeta={false}
      />,
    );

    expect(markup).toContain("Checkpoints");
    expect(markup).toContain(">Numeric</button>");
    expect(markup).toContain('class="panel"');
    expect(markup).not.toContain('id="insert-question-type"');
    expect(markup).not.toContain("Reuse from your workspace");
    expect(markup).not.toContain('aria-label="Question map"');
    expect(markup).not.toContain("Collapse question map");
  });

  it("renders diagnostic details as a beta disclosure without exposing IDs as labels", () => {
    const markup = renderLocalized(
      <DiagnosticDetails
        onUpdateQuestion={noopUpdate}
        question={choiceQuestion}
        questions={draft.questions}
        uxBeta
      />,
    );

    expect(markup).toContain('id="question-diagnostic-details"');
    expect(markup).toContain("Diagnostic details and recheck link");
    expect(markup).toContain("Paired recheck question");
    expect(markup).toMatch(/<option lang="" value="22222222-2222-4222-8222-222222222222"[^>]*>/);
    expect(markup).toContain("Which model fits the new evidence?");
    expect(markup).not.toContain(`>${recheckQuestion.id}<`);
  });

  it("keeps legacy diagnostic controls expanded when the beta is off", () => {
    const markup = renderLocalized(
      <DiagnosticDetails
        onUpdateQuestion={noopUpdate}
        question={choiceQuestion}
        questions={draft.questions}
        uxBeta={false}
      />,
    );

    expect(markup).toContain("Linked recheck");
    expect(markup).not.toContain("<details");
  });

  it("renders each response editor with its existing labels", () => {
    const choiceMarkup = renderLocalized(
      <ResponseEditor
        onStructuralChange={() => undefined}
        onUpdateChoiceQuestion={noopUpdate}
        onUpdateQuestion={noopUpdate}
        question={choiceQuestion}
        uxBeta
      />,
    );
    const numericMarkup = renderLocalized(
      <ResponseEditor
        onStructuralChange={() => undefined}
        onUpdateChoiceQuestion={noopUpdate}
        onUpdateQuestion={noopUpdate}
        question={{
          ...choiceQuestion,
          type: "numeric",
          maxSelections: undefined,
          correctValue: "42",
          tolerance: "0.5",
          unit: "kg",
        }}
        uxBeta
      />,
    );
    const ratingMarkup = renderLocalized(
      <ResponseEditor
        onStructuralChange={() => undefined}
        onUpdateChoiceQuestion={noopUpdate}
        onUpdateQuestion={noopUpdate}
        question={{
          ...choiceQuestion,
          type: "rating",
          maxSelections: undefined,
          min: 1,
          max: 5,
          minLabel: "Low",
          maxLabel: "High",
        }}
        uxBeta
      />,
    );

    expect(choiceMarkup).toContain("Choices and correct answer");
    expect(choiceMarkup).toContain('aria-label="Mark choice 1 correct"');
    expect(choiceMarkup).toContain('lang="en-CA" type="radio"');
    expect(choiceMarkup).toContain(
      'aria-labelledby="answer-label-33333333-3333-4333-8333-333333333333"',
    );
    expect(choiceMarkup).toContain('lang="" maxLength="180"');
    expect(choiceMarkup).toContain("Diagnostic rationale and feedback");
    expect(numericMarkup).toContain("Correct value");
    expect(numericMarkup).toContain("Absolute tolerance");
    expect(numericMarkup).toContain("Optional unit");
    expect(ratingMarkup).toContain("Minimum label");
    expect(ratingMarkup).toContain("Maximum label");
  });

  it("keeps media, delivery, scoring, and participant preview semantics", () => {
    const mediaMarkup = renderLocalized(
      <MediaEditor
        mediaPreviewUrl="https://example.test/scanned.png"
        mediaState="idle"
        mediaUploadsEnabled
        onRemoveImage={() => undefined}
        onUpdateQuestion={noopUpdate}
        onUploadImage={() => undefined}
        question={choiceQuestion}
        uxBeta
      />,
    );
    const deliveryMarkup = renderLocalized(
      <DeliveryScoring onUpdateQuestion={noopUpdate} question={choiceQuestion} />,
    );
    const previewMarkup = renderLocalized(<ParticipantPreview question={choiceQuestion} />);

    expect(mediaMarkup).toContain('id="media-alt"');
    expect(mediaMarkup).toContain('id="media-upload"');
    expect(mediaMarkup).toContain('alt="Two models side by side"');
    expect(mediaMarkup).toMatch(/<img[^>]*lang=""[^>]*width="640"/);
    expect(mediaMarkup).toContain("Remove image");
    expect(deliveryMarkup).toContain("Time limit");
    expect(deliveryMarkup).toContain("Base points");
    expect(deliveryMarkup).toContain('id="explanation"');
    expect(previewMarkup).toContain('aria-label="Participant preview"');
    expect(previewMarkup).toContain('<span lang="">Which model fits?</span>');
    expect(previewMarkup).toContain('<span lang="">Model A</span>');
    expect(previewMarkup).toContain("Confidence will be requested before Submit.");
    expect(previewMarkup).toContain("Submit answer");
  });
});
