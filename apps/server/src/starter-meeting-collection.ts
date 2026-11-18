import type {
  QuestionDraft,
  QuizDraft,
  StarterGuide,
  StarterId,
  SupportedLocale,
} from "@openround/contracts";
import { launchCopy } from "./starter-launch-copy.js";
import { meetingCopy, type MeetingCopyKey } from "./starter-meeting-copy.js";

export const MEETING_STARTER_IDS = [
  "meeting-priorities",
  "team-retrospective",
  "team-collaboration",
] as const satisfies readonly StarterId[];
type MeetingStarterId = (typeof MEETING_STARTER_IDS)[number];

function isMeetingStarter(id: StarterId): id is MeetingStarterId {
  return MEETING_STARTER_IDS.some((candidate) => candidate === id);
}

function questionId(index: number) {
  return `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

/** Original finite copy for new drafts; stored source content and publications are untouched. */
export function meetingStarter(id: StarterId, locale: SupportedLocale): QuizDraft | undefined {
  if (!isMeetingStarter(id)) return undefined;
  const t = (key: MeetingCopyKey) => meetingCopy(locale, key);
  const common = (index: number, prompt: MeetingCopyKey) => ({
    id: questionId(index),
    prompt: t(prompt),
    purpose: "opinion" as const,
    confidence: "off" as const,
    delivery: "main" as const,
    conceptKeys: [],
    linkedRecheckQuestionId: null,
    timeLimitSeconds: 45,
    basePoints: 0,
    explanation: t("guide.interpretation"),
    mediaId: null,
    mediaAlt: null,
  });
  const poll = (index: number, prompt: MeetingCopyKey, labels: string[]): QuestionDraft => ({
    ...common(index, prompt),
    type: "poll",
    choices: labels.map((label, offset) => ({
      id: questionId(101 + offset),
      label,
      isCorrect: false,
    })),
  });
  const rating = (
    index: number,
    prompt: MeetingCopyKey,
    low: string,
    high: string,
  ): QuestionDraft => ({
    ...common(index, prompt),
    type: "rating",
    min: 1,
    max: 5,
    minLabel: low,
    maxLabel: high,
  });
  const noChange = launchCopy(locale, "noChange");
  const unsure = t("notEnoughExperience");
  const clarity = (index: number, prompt: MeetingCopyKey) =>
    rating(
      index,
      prompt,
      launchCopy(locale, "scale.lowClear"),
      launchCopy(locale, "scale.highClear"),
    );
  const experimentChoices = [
    t("writeDecisions"),
    t("nameHandoffOwner"),
    t("shareContextEarlier"),
    t("protectFocusTime"),
    noChange,
    unsure,
  ];
  const questions: QuestionDraft[] =
    id === "meeting-priorities"
      ? [
          poll(1, "meeting.q1", [
            t("decision"),
            t("blocker"),
            t("priorities"),
            t("questions"),
            t("noDiscussion"),
            unsure,
          ]),
          rating(
            2,
            "meeting.q2",
            launchCopy(locale, "scale.lowReady"),
            launchCopy(locale, "scale.highReady"),
          ),
          poll(3, "meeting.q3", [
            t("evidence"),
            t("missingPerspective"),
            t("decisionOwner"),
            launchCopy(locale, "noExtra"),
            unsure,
          ]),
          clarity(4, "meeting.q4"),
        ]
      : id === "team-retrospective"
        ? [
            poll(1, "retro.q1", [
              t("smallerScope"),
              t("earlierFeedback"),
              t("clearerOwnership"),
              t("fewerInterruptions"),
              noChange,
              unsure,
            ]),
            rating(2, "retro.q2", t("unsustainable"), t("sustainable")),
            poll(3, "retro.q3", experimentChoices),
            poll(4, "retro.q4", [
              t("lessWaiting"),
              t("fewerRepeatedQuestions"),
              t("predictableCompletion"),
              t("betterHandoffs"),
              t("noExperiment"),
              unsure,
            ]),
          ]
        : [
            clarity(1, "collaboration.q1"),
            poll(2, "collaboration.q2", [
              t("unclearDecisions"),
              t("missingContext"),
              t("tooManyHandoffs"),
              t("competingPriorities"),
              t("noFriction"),
              unsure,
            ]),
            rating(
              3,
              "collaboration.q3",
              launchCopy(locale, "scale.lowEasy"),
              launchCopy(locale, "scale.highEasy"),
            ),
            poll(4, "collaboration.q4", experimentChoices),
          ];
  const prefix =
    id === "meeting-priorities"
      ? "meeting"
      : id === "team-retrospective"
        ? "retro"
        : "collaboration";
  return {
    title: t(`${prefix}.title`),
    description: t(`${prefix}.description`),
    category: "business",
    experiencePreset: { id: "studio", version: 1 },
    questions,
  };
}

export function meetingStarterGuide(
  id: StarterId,
  locale: SupportedLocale,
  survey = false,
): StarterGuide | undefined {
  if (!isMeetingStarter(id)) return undefined;
  const t = (key: MeetingCopyKey) => meetingCopy(locale, key);
  const prefix =
    id === "meeting-priorities"
      ? "meeting"
      : id === "team-retrospective"
        ? "retro"
        : "collaboration";
  return {
    audience: t(id === "team-collaboration" ? "audience.collaboration" : "audience.team"),
    minutes: survey ? 3 : id === "meeting-priorities" ? 8 : id === "team-retrospective" ? 12 : 10,
    preparation: t(`${prefix}.prepare`),
    facilitation: t(survey ? "guide.survey" : `${prefix}.facilitate`),
    interpretation: t(survey ? "guide.aggregate" : "guide.interpretation"),
    followUp: t(`${prefix}.followUp`),
  };
}

export function meetingSurveyOptions(id: StarterId, locale: SupportedLocale) {
  if (!isMeetingStarter(id)) return undefined;
  return {
    description: meetingCopy(
      locale,
      id === "team-collaboration" ? "collaboration.introduction" : "meeting.surveyIntroduction",
    ),
    // Respondents without recent cross-team work should skip the applicable-item scale.
    optionalIndexes: id === "team-collaboration" ? [2] : [],
  };
}
