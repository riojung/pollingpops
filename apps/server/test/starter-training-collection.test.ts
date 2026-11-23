import { StarterGuideSchema, supportedLocales } from "@openround/contracts";
import { SurveyContentSchema, validateSurveyResponses } from "@openround/contracts/surveys";
import { describe, expect, it } from "vitest";
import { launchStarterGuide } from "../src/starter-launch-collection.js";
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

describe("training and onboarding starter content", () => {
  it.each(supportedLocales)(
    "keeps the two scored access and credential decisions in %s",
    (locale) => {
      const id = "new-hire-knowledge-check";
      const draft = instantiateStarter(id, locale);
      const english = instantiateStarter(id);
      const guide = StarterGuideSchema.parse(starterGuideForLocale(id, locale));
      expect(guide.minutes).toBe(5);
      expect(starterSummariesForLocale(locale).find((summary) => summary.id === id)).toMatchObject({
        title: draft.title,
        questionCount: 2,
        roundType: "quiz",
        previewPrompt: draft.questions[0]!.prompt,
        guide,
      });
      expect(draft.questions).toHaveLength(2);
      const [access, credentials] = draft.questions;
      expect(access).toMatchObject({
        type: "single_select",
        conceptKeys: ["onboarding.support"],
        basePoints: 1000,
        choices: [{ isCorrect: true }, { isCorrect: false }, { isCorrect: false }],
      });
      expect(credentials).toMatchObject({
        type: "true_false",
        conceptKeys: ["onboarding.account-security"],
        basePoints: 1000,
        choices: [{ isCorrect: false }, { isCorrect: true }],
      });
      if (locale !== "en-CA") {
        const englishGuide = starterGuideForLocale(id, "en-CA")!;
        for (const field of guideTextFields) expect(guide[field]).not.toBe(englishGuide[field]);
        for (const [index, question] of draft.questions.entries())
          expect(question.explanation).not.toBe(english.questions[index]!.explanation);
      }
      expect(instantiateSurveyStarter(id, locale)).toBeUndefined();
      expect(starterGuideForLocale(id, locale, true)).toBeUndefined();
    },
  );

  it.each(supportedLocales)(
    "retains the Feedback skills answer keys and feedback in %s",
    (locale) => {
      const id = "feedback-skills";
      const draft = instantiateStarter(id, locale);
      const guide = StarterGuideSchema.parse(starterGuideForLocale(id, locale));
      expect(guide.minutes).toBe(12);
      expect(starterSummariesForLocale(locale).find((summary) => summary.id === id)).toMatchObject({
        questionCount: 4,
        roundType: "quiz",
        guide,
      });
      expect(draft.questions).toHaveLength(4);
      const keys = [
        ["feedback.owner", "feedback.specificWhy"],
        ["feedback.slide", "feedback.specificWhy"],
        ["feedback.details", "feedback.checkWhy"],
        ["feedback.decision", "feedback.checkWhy"],
      ] as const;
      for (const [index, [answer, reasoning]] of keys.entries()) {
        const question = draft.questions[index]!;
        const explanation = launchCopy(locale, reasoning);
        expect(question.type).toBe("single_select");
        if (question.type !== "single_select") throw new Error("Expected a scored choice question");
        expect(
          question.choices.filter((choice) => choice.isCorrect).map(({ label }) => label),
        ).toEqual([launchCopy(locale, answer)]);
        expect(question.explanation).toBe(explanation);
        expect(question.choices.filter(({ feedback }) => feedback)).toMatchObject([
          { isCorrect: false, feedback: explanation },
        ]);
        expect(question.delivery).toBe(index % 2 === 0 ? "main" : "recheck");
        expect(question.linkedRecheckQuestionId).toBe(
          index % 2 === 0 ? draft.questions[index + 1]!.id : null,
        );
      }
      expect(instantiateSurveyStarter(id, locale)).toBeUndefined();
    },
  );

  it.each(supportedLocales)(
    "keeps five required onboarding items and three skippable ratings in %s",
    (locale) => {
      const id = "onboarding-experience";
      const survey = SurveyContentSchema.parse(instantiateSurveyStarter(id, locale));
      const guide = StarterGuideSchema.parse(starterGuideForLocale(id, locale, true));
      expect(guide.minutes).toBe(5);
      expect(guide.facilitation).toMatch(/1\D+3\D+6/);
      expect(guide.interpretation).toMatch(/\b5\b/u);
      expect(
        surveyStarterSummariesForLocale(locale).find((summary) => summary.id === id),
      ).toMatchObject({
        title: survey.title,
        questionCount: 8,
        roundType: "poll",
        previewPrompt: survey.items[0]!.question.prompt,
        guide,
      });
      expect(starterGuideForLocale(id, locale)).toEqual(launchStarterGuide(id, locale));
      if (locale !== "en-CA") {
        const english = starterGuideForLocale(id, "en-CA", true)!;
        for (const field of guideTextFields) expect(guide[field]).not.toBe(english[field]);
      }
      expect(survey.items.map(({ required }) => required)).toEqual([
        false,
        true,
        false,
        true,
        true,
        false,
        true,
        true,
      ]);
      const responses = Object.fromEntries(
        survey.items.flatMap(({ required, question }) => {
          expect(question).toMatchObject({ purpose: "opinion", basePoints: 0, confidence: "off" });
          if (question.type === "poll") {
            expect(required).toBe(true);
            expect(question.choices.every((choice) => !choice.isCorrect)).toBe(true);
            return [[question.id, { kind: "poll" as const, choiceIds: [question.choices[0]!.id] }]];
          }
          expect(question.type).toBe("rating");
          expect(required).toBe(false);
          return [];
        }),
      );
      expect(validateSurveyResponses(survey, responses, true)).toEqual([]);
    },
  );

  it("explains answer reasoning, limits score interpretation and gives a concrete next step", () => {
    const [access, credentials] = instantiateStarter("new-hire-knowledge-check").questions;
    expect(access).toMatchObject({
      choices: [
        { label: "Use the approved support channel and describe the access issue" },
        {},
        {},
      ],
      explanation: expect.stringContaining("without sharing credentials"),
    });
    expect(credentials).toMatchObject({
      choices: [{ label: "True" }, { label: "False" }],
      explanation: expect.stringContaining("approved access and delegation processes"),
    });
    const round = starterGuideForLocale("new-hire-knowledge-check", "en-CA")!;
    expect(round.interpretation).toMatch(/group should practise.*individual scores.*performance/);
    expect(round.followUp).toMatch(/fictional example.*checklist.*support link/);
    const survey = starterGuideForLocale("onboarding-experience", "en-CA", true)!;
    expect(survey.interpretation).toContain(
      "A question’s distribution appears only after the Survey run closes and that question has at least 5 finalized answers.",
    );
    expect(survey.interpretation).toMatch(
      /skipped answers as missing.*identify someone in a small group/,
    );
    expect(survey.followUp).toMatch(/owner.*review date.*what changed/);
  });
});
