import {
  liveQuestionConfidence,
  StarterGuideSchema,
  supportedLocales,
  type SupportedLocale,
} from "@openround/contracts";
import { SurveyContentSchema, validateSurveyResponses } from "@openround/contracts/surveys";
import { describe, expect, it } from "vitest";
import { launchStarterGuide } from "../src/starter-launch-collection.js";
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

const exitTicketAnswers: Record<SupportedLocale, readonly [string, string]> = {
  "en-CA": [
    "Restate it in your own words and check with them",
    "Summarize the concern and ask whether you understood it",
  ],
  "fr-FR": ["Reformuler et vérifier avec la personne", "Résumer son inquiétude et vérifier"],
  "de-DE": [
    "In eigenen Worten wiedergeben und nachfragen",
    "Die Sorge zusammenfassen und nachfragen",
  ],
  "es-ES": ["Reformularlo y comprobar con esa persona", "Resumir la preocupación y comprobar"],
  "it-IT": ["Riformulare e verificare con la persona", "Riassumere la preoccupazione e verificare"],
  "pt-PT": ["Reformular e confirmar com a pessoa", "Resumir a preocupação e confirmar"],
  "ja-JP": ["自分の言葉で言い換え、相手に確認する", "懸念を要約し、理解が合っているか尋ねる"],
  "ko-KR": ["자기 말로 정리하고 상대에게 확인하기", "우려를 요약하고 이해가 맞는지 묻기"],
  "zh-CN": ["用自己的话转述并向对方确认", "概括担忧并确认理解是否正确"],
  "zh-TW": ["用自己的話轉述並向對方確認", "概括擔憂並確認理解是否正確"],
};

describe("Workshops starter guides", () => {
  it.each(supportedLocales)(
    "publishes guides for the three starter and format pairs in %s",
    (locale) => {
      const rounds = starterSummariesForLocale(locale);
      const surveys = surveyStarterSummariesForLocale(locale);
      for (const [id, summaries, survey, minutes, count, roundType] of [
        ["workshop-expectations", rounds, false, 5, 2, "poll"],
        ["exit-ticket", rounds, false, 8, 2, "quiz"],
        ["learning-needs", surveys, true, 5, 8, "poll"],
      ] as const) {
        const guide = StarterGuideSchema.parse(starterGuideForLocale(id, locale, survey));
        expect(guide.minutes).toBe(minutes);
        expect(summaries.find((summary) => summary.id === id)).toMatchObject({
          guide,
          questionCount: count,
          roundType,
        });
        if (locale !== "en-CA") {
          const english = starterGuideForLocale(id, "en-CA", survey)!;
          for (const field of guideTextFields) expect(guide[field]).not.toBe(english[field]);
        }
      }
      expect(rounds.find((summary) => summary.id === "learning-needs")?.guide).toEqual(
        launchStarterGuide("learning-needs", locale),
      );
      expect(instantiateSurveyStarter("workshop-expectations", locale)?.items).toHaveLength(2);
      expect(starterGuideForLocale("workshop-expectations", locale, true)).toBeUndefined();
      expect(instantiateSurveyStarter("exit-ticket", locale)).toBeUndefined();
      expect(starterGuideForLocale("exit-ticket", locale, true)).toBeUndefined();
    },
  );

  it.each(supportedLocales)("keeps Workshop expectations unscored in %s", (locale) => {
    const { questions } = instantiateStarter("workshop-expectations", locale);
    expect(questions).toMatchObject([
      {
        type: "poll",
        purpose: "opinion",
        basePoints: 0,
        confidence: "off",
        linkedRecheckQuestionId: null,
        choices: Array.from({ length: 4 }, () => ({ isCorrect: false })),
      },
      {
        type: "rating",
        purpose: "opinion",
        basePoints: 0,
        confidence: "off",
        linkedRecheckQuestionId: null,
        min: 1,
        max: 5,
      },
    ]);
  });

  it.each(supportedLocales)(
    "retains both Exit ticket keys, confidence and recheck in %s",
    (locale) => {
      const draft = instantiateStarter("exit-ticket", locale);
      const english = instantiateStarter("exit-ticket");
      expect(draft.questions).toHaveLength(2);
      const [main, recheck] = draft.questions;
      expect(main).toMatchObject({
        delivery: "main",
        purpose: "diagnostic",
        linkedRecheckQuestionId: recheck!.id,
      });
      expect(recheck).toMatchObject({
        delivery: "recheck",
        purpose: "practice",
        linkedRecheckQuestionId: null,
      });
      for (const [index, question] of draft.questions.entries()) {
        expect(question).toMatchObject({
          type: "single_select",
          confidence: "required",
          basePoints: 1000,
          conceptKeys: ["session.key-idea"],
          choices: [
            { label: exitTicketAnswers[locale][index], isCorrect: true },
            { isCorrect: false },
            { isCorrect: false },
          ],
        });
        expect(liveQuestionConfidence(question, { confidenceEnabled: false })).toBe("off");
        expect(liveQuestionConfidence(question, { confidenceEnabled: true })).toBe("optional");
        if (locale !== "en-CA")
          expect(question.explanation).not.toBe(english.questions[index]!.explanation);
      }
    },
  );

  it("guides live delivery through optional confidence, reveal, explanation and recheck", () => {
    const guide = StarterGuideSchema.parse(starterGuideForLocale("exit-ticket", "en-CA"));
    expect(guide.preparation).toMatch(
      /off by default.*Ask for confidence \(optional\).*Round setup/u,
    );
    expect(guide.facilitation).toContain("optional confidence rating when available");
    expect(guide.facilitation).toMatch(
      /Close responses.*reveal the answer.*host controls.*checking a paraphrase with the speaker.*Finish the intervention before opening the linked recheck/u,
    );
    expect(guide.interpretation).toContain("any confidence ratings collected");
  });

  it.each(supportedLocales)(
    "keeps Survey ratings skippable with six required unscored items in %s",
    (locale) => {
      const survey = SurveyContentSchema.parse(instantiateSurveyStarter("learning-needs", locale));
      const guide = starterGuideForLocale("learning-needs", locale, true)!;
      expect(guide.facilitation).toMatch(/1\D+5/u);
      expect(guide.interpretation).toMatch(/\b5\b/u);
      expect(survey.items.map(({ required }) => required)).toEqual([
        false,
        true,
        true,
        true,
        false,
        true,
        true,
        true,
      ]);
      const responses = Object.fromEntries(
        survey.items.flatMap(({ required, question }) => {
          expect(question).toMatchObject({ purpose: "opinion", basePoints: 0, confidence: "off" });
          if (question.type === "poll") {
            expect(required).toBe(true);
            expect(question.choices.every(({ isCorrect }) => !isCorrect)).toBe(true);
            return [[question.id, { kind: "poll" as const, choiceIds: [question.choices[0]!.id] }]];
          }
          expect(required).toBe(false);
          expect(question.type).toBe("rating");
          return [];
        }),
      );
      expect(validateSurveyResponses(survey, responses, true)).toEqual([]);
    },
  );

  it("explains the Survey planning window and what can be shared", () => {
    const guide = starterGuideForLocale("learning-needs", "en-CA", true)!;
    expect(guide.preparation).toMatch(
      /submit.*close the run.*available distributions.*finalizing the agenda/,
    );
    expect(guide.interpretation).toContain(
      "A question’s distribution appears only after the Survey run closes and that question has at least 5 finalized answers.",
    );
    expect(guide.interpretation).toMatch(
      /skipped answers as missing.*identify someone in a small group.*self-reports/,
    );
  });
});
