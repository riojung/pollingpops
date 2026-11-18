import { describe, expect, it } from "vitest";
import {
  QuizContentSchema,
  StarterGuideSchema,
  supportedLocales,
  type QuizDraft,
} from "@openround/contracts";
import { SurveyContentSchema, validateSurveyResponses } from "@openround/contracts/surveys";
import {
  MEETING_STARTER_IDS,
  meetingStarter,
  meetingStarterGuide,
  meetingSurveyOptions,
} from "../src/starter-meeting-collection.js";
import {
  instantiateStarter,
  instantiateSurveyStarter,
  starterGuideForLocale,
  starterSummariesForLocale,
  surveyStarterSummariesForLocale,
} from "../src/starters.js";

function withoutQuestionIds(questions: QuizDraft["questions"]) {
  return questions.map(({ id: _id, ...question }) => ({
    ...question,
    ...("choices" in question
      ? { choices: question.choices.map(({ id: _choiceId, ...choice }) => choice) }
      : {}),
  }));
}

describe("original team meeting starter content", () => {
  it.each(supportedLocales)(
    "keeps four unscored questions and concrete guides for each existing ID in %s",
    (locale) => {
      const summaries = starterSummariesForLocale(locale);
      expect(summaries).toHaveLength(36);
      expect(surveyStarterSummariesForLocale(locale)).toHaveLength(6);
      expect(
        summaries.filter((summary) =>
          summary.responseTypes.every((type) => type === "poll" || type === "rating"),
        ),
      ).toHaveLength(17);
      for (const id of MEETING_STARTER_IDS) {
        const draft = instantiateStarter(id, locale);
        expect(QuizContentSchema.safeParse(draft).success, `${locale}/${id}`).toBe(true);
        expect(draft.questions).toHaveLength(4);
        expect(new Set(draft.questions.map((question) => question.id)).size).toBe(4);
        const guide = starterGuideForLocale(id, locale)!;
        expect(StarterGuideSchema.safeParse(guide).success).toBe(true);
        expect(summaries.find((summary) => summary.id === id)).toMatchObject({
          title: draft.title,
          description: draft.description,
          questionCount: 4,
          previewPrompt: draft.questions[0]!.prompt,
          roundType: "poll",
          guide,
        });
        expect(draft.questions.map((question) => question.type)).toEqual(
          id === "meeting-priorities"
            ? ["poll", "rating", "poll", "rating"]
            : id === "team-retrospective"
              ? ["poll", "rating", "poll", "poll"]
              : ["rating", "poll", "rating", "poll"],
        );
        for (const question of draft.questions) {
          expect(question).toMatchObject({
            purpose: "opinion",
            confidence: "off",
            basePoints: 0,
            conceptKeys: [],
            linkedRecheckQuestionId: null,
            delivery: "main",
          });
          if (question.type === "poll") {
            expect(question.choices.every((choice) => !choice.isCorrect)).toBe(true);
            expect(question.choices.length).toBeGreaterThanOrEqual(5);
          } else {
            expect(question).toMatchObject({ type: "rating", min: 1, max: 5 });
          }
        }
        if (locale !== "en-CA") {
          const english = instantiateStarter(id, "en-CA");
          const englishGuide = starterGuideForLocale(id, "en-CA")!;
          expect(draft.title).not.toBe(english.title);
          expect(draft.description).not.toBe(english.description);
          for (const [index, question] of draft.questions.entries())
            expect(question.prompt).not.toBe(english.questions[index]!.prompt);
          for (const field of [
            "audience",
            "preparation",
            "facilitation",
            "interpretation",
            "followUp",
          ] as const)
            expect(guide[field], `${locale}/${id}/${field}`).not.toBe(englishGuide[field]);
        }
      }
    },
  );

  it.each(supportedLocales)(
    "projects the same collaboration questions with honest instructions and an optional applicable item in %s",
    (locale) => {
      const round = instantiateStarter("team-collaboration", locale);
      const survey = instantiateSurveyStarter("team-collaboration", locale)!;
      expect(SurveyContentSchema.safeParse(survey).success).toBe(true);
      expect(survey.items).toHaveLength(4);
      expect(survey.items.map((item) => item.required)).toEqual([true, true, false, true]);
      expect(withoutQuestionIds(survey.items.map((item) => item.question))).toEqual(
        withoutQuestionIds(round.questions),
      );
      expect(survey.description).toBe(
        meetingSurveyOptions("team-collaboration", locale)!.description,
      );
      expect(survey.description).not.toBe(round.description);
      const responses = Object.fromEntries(
        survey.items
          .filter((item) => item.required)
          .map(({ question }) => [
            question.id,
            question.type === "poll"
              ? { kind: "poll" as const, choiceIds: [question.choices.at(-1)!.id] }
              : { kind: "rating" as const, value: 3 },
          ]),
      );
      expect(validateSurveyResponses(survey, responses, true)).toEqual([]);
      expect(starterGuideForLocale("team-collaboration", locale, true)?.minutes).toBe(3);
      expect(
        surveyStarterSummariesForLocale(locale).find((entry) => entry.id === "team-collaboration")
          ?.guide,
      ).toEqual(starterGuideForLocale("team-collaboration", locale, true));
    },
  );

  it.each(supportedLocales)("keeps newly created copies independent in %s", (locale) => {
    for (const id of MEETING_STARTER_IDS) {
      const first = instantiateStarter(id, locale);
      const second = instantiateStarter(id, locale);
      expect(withoutQuestionIds(first.questions)).toEqual(withoutQuestionIds(second.questions));
      for (const [index, question] of first.questions.entries()) {
        const other = second.questions[index]!;
        expect(question.id).not.toBe(other.id);
        if (question.type === "poll" && other.type === "poll")
          expect(question.choices[0]!.id).not.toBe(other.choices[0]!.id);
      }
      first.questions[0]!.prompt = "A creator’s own question";
      first.title = "A creator’s own title";
      expect(instantiateStarter(id, locale)).toEqual(
        expect.objectContaining({ title: second.title }),
      );
      expect(instantiateStarter(id, locale).questions[0]!.prompt).toBe(second.questions[0]!.prompt);
      const survey = instantiateSurveyStarter(id, locale)!;
      survey.items[0]!.question.prompt = "Edited preview";
      expect(instantiateSurveyStarter(id, locale)!.items[0]!.question.prompt).toBe(
        second.questions[0]!.prompt,
      );
    }
  });

  it("makes neutral outcomes explicit and leaves a checkable action rather than a score", () => {
    const meeting = instantiateStarter("meeting-priorities");
    const retro = instantiateStarter("team-retrospective");
    const collaboration = instantiateStarter("team-collaboration");
    expect(JSON.stringify(meeting)).toContain("No discussion needed today");
    expect(JSON.stringify(retro)).toContain("No change needed");
    expect(JSON.stringify(retro)).toContain("No experiment planned");
    expect(JSON.stringify(collaboration)).toContain("No issue slowed our shared work");
    for (const draft of [meeting, retro, collaboration])
      expect(JSON.stringify(draft)).toContain("Not enough experience to say");
    const meetingGuide = starterGuideForLocale("meeting-priorities", "en-CA")!;
    expect(meetingGuide.minutes).toBe(8);
    expect(meetingGuide.followUp).toMatch(/owner.*due date.*update location/);
    expect(meetingGuide.followUp).toContain("within one working day");
    const retroGuide = starterGuideForLocale("team-retrospective", "en-CA")!;
    expect(retroGuide.minutes).toBe(12);
    expect(retroGuide.followUp).toMatch(/experiment.*owner.*signal.*review date/);
    const surveyGuide = starterGuideForLocale("team-collaboration", "en-CA", true)!;
    expect(surveyGuide.facilitation).toMatch(/3 minutes.*10-minute team discussion/);
    expect(surveyGuide.followUp).toMatch(/owner.*signal.*review date two weeks/);
    const survey = instantiateSurveyStarter("team-collaboration")!;
    expect(survey.description).toContain("Skip question 3");
    expect(survey.description).toContain("facilitator will review responses");
    expect(survey.description).not.toMatch(/anonymous|confidential|private/i);
  });

  it("does not replace any unrelated launch or legacy starter", () => {
    for (const id of ["project-kickoff", "exit-ticket", "event-feedback"] as const) {
      expect(meetingStarter(id, "en-CA")).toBeUndefined();
      expect(meetingStarterGuide(id, "en-CA")).toBeUndefined();
      expect(meetingSurveyOptions(id, "en-CA")).toBeUndefined();
    }
    expect(instantiateStarter("project-kickoff").questions).toHaveLength(7);
    expect(instantiateStarter("exit-ticket").questions).toHaveLength(2);
  });
});
