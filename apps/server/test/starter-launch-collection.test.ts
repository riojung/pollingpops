import { describe, expect, it } from "vitest";
import { QuizContentSchema, StarterGuideSchema, supportedLocales } from "@openround/contracts";
import { SurveyContentSchema, validateSurveyResponses } from "@openround/contracts/surveys";
import { LAUNCH_STARTER_IDS } from "../src/starter-launch-collection.js";
import {
  instantiateStarter,
  instantiateSurveyStarter,
  starterGuideForLocale,
  starterSummariesForLocale,
} from "../src/starters.js";

const counts = {
  "source-evaluation": 6,
  "percentage-check": 6,
  "feedback-skills": 4,
  "project-kickoff": 7,
  "event-feedback": 8,
  "onboarding-experience": 8,
  "service-experience": 8,
  "learning-needs": 8,
} as const;

describe("complete authored launch collection", () => {
  it.each(supportedLocales)(
    "keeps usable guides, questionnaires, and distinct recovery graphs in %s",
    (locale) => {
      const summaries = starterSummariesForLocale(locale);
      for (const id of LAUNCH_STARTER_IDS) {
        const draft = instantiateStarter(id, locale);
        expect(QuizContentSchema.safeParse(draft).success, `${locale}/${id}`).toBe(true);
        expect(draft.questions).toHaveLength(counts[id]);
        const guide = starterGuideForLocale(id, locale)!;
        expect(StarterGuideSchema.safeParse(guide).success).toBe(true);
        expect(summaries.find((summary) => summary.id === id)?.guide).toEqual(guide);
        if (locale !== "en-CA") {
          const english = starterGuideForLocale(id, "en-CA")!;
          for (const field of [
            "audience",
            "preparation",
            "facilitation",
            "interpretation",
            "followUp",
          ] as const)
            expect(guide[field], `${locale}/${id}/${field}`).not.toBe(english[field]);
        }
        const mains = draft.questions.filter((question) => question.delivery === "main");
        const rechecks = draft.questions.filter((question) => question.delivery === "recheck");
        if (rechecks.length) {
          expect(summaries.find((summary) => summary.id === id)?.roundType).toBe("quiz");
          expect(mains).toHaveLength(rechecks.length);
          expect(new Set(mains.map((question) => question.linkedRecheckQuestionId)).size).toBe(
            rechecks.length,
          );
          for (const question of mains) {
            const recheck = rechecks.find(
              (candidate) => candidate.id === question.linkedRecheckQuestionId,
            )!;
            expect(recheck.prompt).not.toBe(question.prompt);
            expect(recheck.conceptKeys).toEqual(question.conceptKeys);
            expect(question).toMatchObject({
              purpose: "diagnostic",
              confidence: "required",
              basePoints: 1000,
              timeLimitSeconds: 60,
            });
            expect(recheck).toMatchObject({
              purpose: "practice",
              confidence: "required",
              linkedRecheckQuestionId: null,
            });
          }
          expect(instantiateSurveyStarter(id, locale)).toBeUndefined();
        } else {
          const survey = instantiateSurveyStarter(id, locale)!;
          expect(SurveyContentSchema.safeParse(survey).success).toBe(true);
          expect(survey.description).toBe(draft.description);
          expect(survey.items.some((item) => !item.required)).toBe(true);
          const responses = Object.fromEntries(
            survey.items
              .filter((item) => item.required)
              .map(({ question }) => [
                question.id,
                question.type === "poll"
                  ? { kind: "poll" as const, choiceIds: [question.choices[0]!.id] }
                  : { kind: "rating" as const, value: 3 },
              ]),
          );
          expect(validateSurveyResponses(survey, responses, true)).toEqual([]);
          expect(
            survey.items.every(
              ({ question }) =>
                question.purpose === "opinion" &&
                question.confidence === "off" &&
                question.basePoints === 0 &&
                !question.conceptKeys?.length,
            ),
          ).toBe(true);
          expect(starterGuideForLocale(id, locale, true)?.interpretation).not.toBe(
            guide.interpretation,
          );
        }
      }
    },
  );

  it("supplies correct arithmetic for discounts, changed bases, and percentage points", () => {
    const draft = instantiateStarter("percentage-check");
    expect(
      draft.questions.map((question) =>
        question.type === "numeric" ? Number(question.correctValue) : null,
      ),
    ).toEqual([
      (80 * 75) / 100,
      (120 * 90) / 100,
      (100 * 120 * 80) / 10000,
      (200 * 110 * 90) / 10000,
      30 - 20,
      50 - 40,
    ]);
    expect(
      draft.questions.every(
        (question) =>
          question.type === "numeric" &&
          question.tolerance === "0" &&
          question.explanation.includes("="),
      ),
    ).toBe(true);
  });

  it("keeps Survey previews pure and independent, with legacy defaults outside the collection", () => {
    const before = instantiateSurveyStarter("event-feedback", "ko-KR")!;
    const again = instantiateSurveyStarter("event-feedback", "ko-KR")!;
    expect(again).toEqual(before);
    before.items[0]!.question.prompt = "Edited preview";
    expect(instantiateSurveyStarter("event-feedback", "ko-KR")).toEqual(again);
    const legacy = instantiateSurveyStarter("training-feedback")!;
    expect(legacy.items).toHaveLength(2);
    expect(legacy.items.every((item) => item.required)).toBe(true);
    expect(legacy.description).toBe(
      "Answer independently at your own pace. This Survey is unscored.",
    );
    expect(starterGuideForLocale("training-feedback", "en-CA")).toBeUndefined();
  });
});
