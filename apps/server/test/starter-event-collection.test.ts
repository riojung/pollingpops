import { describe, expect, it } from "vitest";
import { StarterGuideSchema, supportedLocales, type QuestionDraft } from "@openround/contracts";
import { SurveyContentSchema, validateSurveyResponses } from "@openround/contracts/surveys";
import { launchCopy } from "../src/starter-launch-copy.js";
import {
  instantiateStarter,
  instantiateSurveyStarter,
  starterGuideForLocale,
  starterSummariesForLocale,
  surveyStarterSummariesForLocale,
} from "../src/starters.js";

const guideTextFields = [
  "audience",
  "preparation",
  "facilitation",
  "interpretation",
  "followUp",
] as const;

function expectUnscoredFeedback(question: QuestionDraft) {
  expect(question).toMatchObject({
    purpose: "opinion",
    basePoints: 0,
    confidence: "off",
    linkedRecheckQuestionId: null,
  });
  if (question.type === "poll") {
    expect(question.choices.every(({ isCorrect }) => !isCorrect)).toBe(true);
  } else {
    expect(question).toMatchObject({ type: "rating", min: 1, max: 5 });
  }
}

describe("Event feedback starter guides", () => {
  it.each(supportedLocales)("publishes the three format-specific guides in %s", (locale) => {
    const rounds = starterSummariesForLocale(locale);
    const surveys = surveyStarterSummariesForLocale(locale);
    const entries = [
      ["training-feedback", rounds, false, 3, 2],
      ["event-feedback", rounds, false, 10, 8],
      ["event-feedback", surveys, true, 5, 8],
    ] as const;
    const guides = entries.map(([id, summaries, survey, minutes, questionCount]) => {
      const guide = StarterGuideSchema.parse(starterGuideForLocale(id, locale, survey));
      expect(guide.minutes).toBe(minutes);
      expect(summaries.find((summary) => summary.id === id)).toMatchObject({
        guide,
        questionCount,
        roundType: "poll",
      });
      if (locale !== "en-CA") {
        const english = starterGuideForLocale(id, "en-CA", survey)!;
        for (const field of guideTextFields) expect(guide[field]).not.toBe(english[field]);
      }
      return guide;
    });
    for (const field of guideTextFields) {
      expect(new Set(guides.map((guide) => guide[field])).size).toBe(3);
    }
    expect(guides[2]!.facilitation).toMatch(/4.+8/u);
    expect(guides[2]!.interpretation).toMatch(/5/u);
  });

  it.each(supportedLocales)(
    "preserves the unscored questions and the Survey-only optional items in %s",
    (locale) => {
      const training = instantiateStarter("training-feedback", locale);
      const event = instantiateStarter("event-feedback", locale);
      const survey = SurveyContentSchema.parse(instantiateSurveyStarter("event-feedback", locale));
      expect(training.questions.map(({ type }) => type)).toEqual(["poll", "rating"]);
      expect(event.questions.map(({ type }) => type)).toEqual([
        "rating",
        "poll",
        "rating",
        "rating",
        "poll",
        "poll",
        "poll",
        "poll",
      ]);
      for (const question of [...training.questions, ...event.questions])
        expectUnscoredFeedback(question);
      expect(survey.items.map(({ question }) => question.prompt)).toEqual(
        event.questions.map(({ prompt }) => prompt),
      );
      expect(survey.items.map(({ required }) => required)).toEqual([
        true,
        true,
        true,
        false,
        true,
        true,
        true,
        false,
      ]);
      const responses = Object.fromEntries(
        survey.items.flatMap(({ required, question }) => {
          expectUnscoredFeedback(question);
          if (!required) return [];
          return [
            [
              question.id,
              question.type === "poll"
                ? { kind: "poll" as const, choiceIds: [question.choices[0]!.id] }
                : { kind: "rating" as const, value: 3 },
            ],
          ];
        }),
      );
      expect(validateSurveyResponses(survey, responses, true)).toEqual([]);

      expect(event.description).toBe(launchCopy(locale, "event.roundDescription"));
      expect(survey.description).toBe(launchCopy(locale, "event.description"));
      expect(event.description).not.toBe(survey.description);

      const legacy = instantiateSurveyStarter("training-feedback", locale)!;
      expect(legacy.items.map(({ required }) => required)).toEqual([true, true]);
      expect(legacy.items.map(({ question }) => question.prompt)).toEqual(
        training.questions.map(({ prompt }) => prompt),
      );
      expect(starterGuideForLocale("training-feedback", locale, true)).toBeUndefined();
      expect(
        surveyStarterSummariesForLocale(locale).some(({ id }) => id === "training-feedback"),
      ).toBe(false);
    },
  );

  it("waits for individual Round reveals and closed Survey distributions", () => {
    expect(starterGuideForLocale("training-feedback", "en-CA")?.facilitation).toMatch(
      /each question before closing it and revealing the results for discussion/u,
    );
    expect(starterGuideForLocale("event-feedback", "en-CA")?.facilitation).toMatch(
      /For each question, close responses and reveal the results before inviting discussion/u,
    );
    const survey = starterGuideForLocale("event-feedback", "en-CA", true)!;
    expect(survey.preparation).toMatch(/submission deadline.*after closing the run/u);
    expect(survey.interpretation).toMatch(
      /only after the Survey run closes and that question has at least 5 finalized answers/u,
    );
    expect(survey.interpretation).toMatch(
      /skipped items as missing.*identify anyone in a small group/u,
    );
  });
});
