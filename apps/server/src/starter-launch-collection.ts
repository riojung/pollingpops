import type {
  QuestionDraft,
  QuizDraft,
  RoundCategory,
  StarterGuide,
  StarterId,
  SupportedLocale,
} from "@openround/contracts";
import { launchCopy, type LaunchCopyKey } from "./starter-launch-copy.js";

export const LAUNCH_STARTER_IDS = [
  "source-evaluation",
  "percentage-check",
  "feedback-skills",
  "project-kickoff",
  "event-feedback",
  "onboarding-experience",
  "service-experience",
  "learning-needs",
] as const satisfies readonly StarterId[];
type LaunchStarterId = (typeof LAUNCH_STARTER_IDS)[number];
const definitions: Record<
  LaunchStarterId,
  {
    prefix:
      | "source"
      | "percentage"
      | "feedback"
      | "kickoff"
      | "event"
      | "onboarding"
      | "service"
      | "learning";
    category: RoundCategory;
    preset: "campus" | "blueprint" | "studio" | "focus";
    minutes: number;
    follow: LaunchCopyKey;
    optional: readonly number[];
  }
> = {
  "source-evaluation": {
    prefix: "source",
    category: "education",
    preset: "campus",
    minutes: 15,
    follow: "follow.practice",
    optional: [],
  },
  "percentage-check": {
    prefix: "percentage",
    category: "technical",
    preset: "blueprint",
    minutes: 15,
    follow: "follow.practice",
    optional: [],
  },
  "feedback-skills": {
    prefix: "feedback",
    category: "business",
    preset: "studio",
    minutes: 12,
    follow: "follow.practice",
    optional: [],
  },
  "project-kickoff": {
    prefix: "kickoff",
    category: "business",
    preset: "studio",
    minutes: 20,
    follow: "follow.kickoff",
    optional: [1, 4],
  },
  "event-feedback": {
    prefix: "event",
    category: "general",
    preset: "focus",
    minutes: 5,
    follow: "follow.event",
    optional: [3, 7],
  },
  "onboarding-experience": {
    prefix: "onboarding",
    category: "business",
    preset: "studio",
    minutes: 5,
    follow: "follow.onboarding",
    optional: [0, 2, 5],
  },
  "service-experience": {
    prefix: "service",
    category: "business",
    preset: "studio",
    minutes: 5,
    follow: "follow.service",
    optional: [3, 4, 7],
  },
  "learning-needs": {
    prefix: "learning",
    category: "education",
    preset: "campus",
    minutes: 5,
    follow: "follow.learning",
    optional: [0, 4],
  },
};
function definition(id: StarterId) {
  return definitions[id as LaunchStarterId];
}
function questionId(index: number) {
  return `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

/** Authored, finite content. Neither source text nor participant answers enter a model. */
export function launchStarter(id: StarterId, locale: SupportedLocale): QuizDraft | undefined {
  const entry = definition(id);
  if (!entry) return undefined;
  const t = (key: LaunchCopyKey) => launchCopy(locale, key);
  const common = (index: number, prompt: LaunchCopyKey) => ({
    id: questionId(index),
    prompt: t(prompt),
    purpose: "opinion" as const,
    confidence: "off" as const,
    delivery: "main" as const,
    conceptKeys: [],
    linkedRecheckQuestionId: null,
    timeLimitSeconds: 45,
    basePoints: 0,
    explanation: t("opinion.explanation"),
    mediaId: null,
    mediaAlt: null,
  });
  const labels = (keys: readonly LaunchCopyKey[], correct = -1) =>
    keys.map((key, index) => ({
      id: questionId(101 + index),
      label: t(key),
      isCorrect: index === correct,
    }));
  const poll = (
    index: number,
    prompt: LaunchCopyKey,
    keys: readonly LaunchCopyKey[],
  ): QuestionDraft => ({
    ...common(index, prompt),
    type: "poll",
    choices: labels(keys),
  });
  const rating = (
    index: number,
    prompt: LaunchCopyKey,
    low: LaunchCopyKey,
    high: LaunchCopyKey,
  ): QuestionDraft => ({
    ...common(index, prompt),
    type: "rating",
    min: 1,
    max: 5,
    minLabel: t(low),
    maxLabel: t(high),
  });
  const knowledge = (
    index: number,
    prompt: LaunchCopyKey,
    keys: readonly LaunchCopyKey[],
    explanation: LaunchCopyKey,
    concept: string,
    recheck = false,
  ): QuestionDraft => ({
    ...common(index, prompt),
    type: "single_select",
    choices: labels(keys, 0)
      .map((choice, offset) => ({
        ...choice,
        ...(offset === 1
          ? { misconceptionKey: `${id}.${concept}.confusion`, feedback: t(explanation) }
          : {}),
      }))
      .sort((left, right) => {
        const offset = index % keys.length;
        const position = (choice: typeof left) =>
          (Number(choice.id.slice(-12)) - 101 + offset) % keys.length;
        return position(left) - position(right);
      }),
    purpose: recheck ? "practice" : "diagnostic",
    confidence: "required",
    delivery: recheck ? "recheck" : "main",
    conceptKeys: [`${id}.${concept}`],
    linkedRecheckQuestionId: recheck ? null : questionId(index + 1),
    timeLimitSeconds: 60,
    basePoints: 1000,
    explanation: t(explanation),
  });
  const numeric = (
    index: number,
    prompt: LaunchCopyKey,
    answer: string,
    explanation: string,
    concept: string,
    recheck = false,
  ): QuestionDraft => ({
    ...common(index, prompt),
    type: "numeric",
    correctValue: answer,
    tolerance: "0",
    unit: null,
    purpose: recheck ? "practice" : "diagnostic",
    confidence: "required",
    delivery: recheck ? "recheck" : "main",
    conceptKeys: [`${id}.${concept}`],
    linkedRecheckQuestionId: recheck ? null : questionId(index + 1),
    timeLimitSeconds: 60,
    basePoints: 1000,
    explanation: `${explanation}. ${t(concept === "discount" ? "percentage.discountWhy" : concept === "successive" ? "percentage.successiveWhy" : "percentage.pointsWhy")}`,
  });
  let questions: QuestionDraft[];
  switch (id) {
    case "source-evaluation":
      questions = [
        knowledge(
          1,
          "source.q1",
          ["source.sample8", "source.all80", "source.learning"],
          "source.sampleWhy",
          "sample",
        ),
        knowledge(
          2,
          "source.q2",
          ["source.sample12", "source.all60", "source.faster"],
          "source.sampleWhy",
          "sample",
          true,
        ),
        knowledge(
          3,
          "source.q3",
          ["source.completion", "source.ability", "source.satisfaction"],
          "source.measureWhy",
          "measure",
        ),
        knowledge(
          4,
          "source.q4",
          ["source.attendance", "source.readiness", "source.safety"],
          "source.measureWhy",
          "measure",
          true,
        ),
        knowledge(
          5,
          "source.q5",
          ["source.isolate", "source.allCause", "source.noCause"],
          "source.causeWhy",
          "cause",
        ),
        knowledge(
          6,
          "source.q6",
          ["source.isolate", "source.allCause", "source.noCause"],
          "source.causeWhy",
          "cause",
          true,
        ),
      ];
      break;
    case "percentage-check":
      questions = [
        numeric(1, "percentage.q1", "60", "80 × (1 − 25 / 100) = 60", "discount"),
        numeric(2, "percentage.q2", "108", "120 × (1 − 10 / 100) = 108", "discount", true),
        numeric(
          3,
          "percentage.q3",
          "96",
          "100 × (1 + 20 / 100) × (1 − 20 / 100) = 96",
          "successive",
        ),
        numeric(
          4,
          "percentage.q4",
          "198",
          "200 × (1 + 10 / 100) × (1 − 10 / 100) = 198",
          "successive",
          true,
        ),
        numeric(5, "percentage.q5", "10", "30 − 20 = 10", "points"),
        numeric(6, "percentage.q6", "10", "50 − 40 = 10", "points", true),
      ];
      break;
    case "feedback-skills":
      questions = [
        knowledge(
          1,
          "feedback.q1",
          ["feedback.owner", "feedback.professional", "feedback.careless"],
          "feedback.specificWhy",
          "specific",
        ),
        knowledge(
          2,
          "feedback.q2",
          ["feedback.slide", "feedback.confuse", "feedback.style"],
          "feedback.specificWhy",
          "specific",
          true,
        ),
        knowledge(
          3,
          "feedback.q3",
          ["feedback.details", "feedback.compliments", "feedback.assume"],
          "feedback.checkWhy",
          "result",
        ),
        knowledge(
          4,
          "feedback.q4",
          ["feedback.decision", "feedback.pages", "feedback.longer"],
          "feedback.checkWhy",
          "result",
          true,
        ),
      ];
      break;
    case "project-kickoff":
      questions = [
        poll(1, "kickoff.q1", ["outcome", "roles", "timeline", "dependencies", "noChange"]),
        rating(2, "kickoff.q2", "scale.lowClear", "scale.highClear"),
        poll(3, "kickoff.q3", [
          "need",
          "capacity",
          "feasibility",
          "dependencies",
          "notApplicable",
          "unsure",
        ]),
        poll(4, "kickoff.q4", ["decisionRights", "handoffs", "priorities", "context", "noChange"]),
        rating(5, "kickoff.q5", "scale.lowReady", "scale.highReady"),
        poll(6, "kickoff.q6", ["sample", "assumption", "scope", "roles"]),
        poll(7, "kickoff.q7", ["owners", "checkDeps", "testSmall", "record", "noChange"]),
      ];
      break;
    case "event-feedback":
      questions = [
        rating(1, "event.q1", "scale.lowUseful", "scale.highUseful"),
        poll(2, "event.q2", ["examples", "practice", "discussion", "resources", "noneYet"]),
        rating(3, "event.q3", "scale.lowClear", "scale.highClear"),
        rating(4, "event.q4", "scale.lowEasy", "scale.highEasy"),
        poll(5, "event.q5", [
          "pace.slow",
          "pace.slightSlow",
          "pace.right",
          "pace.slightFast",
          "pace.fast",
        ]),
        poll(6, "event.q6", [
          "clearerExamples",
          "morePractice",
          "moreTime",
          "logistics",
          "depth",
          "noChange",
        ]),
        poll(7, "event.q7", [
          "tryIdea",
          "shareResources",
          "learnMore",
          "reviewNotes",
          "nothingPlanned",
        ]),
        poll(8, "event.q8", ["worked", "guided", "summary", "discussion", "noFollow"]),
      ];
      break;
    case "onboarding-experience":
      questions = [
        rating(1, "onboarding.q1", "scale.lowClear", "scale.highClear"),
        poll(2, "onboarding.q2", ["all", "most", "some", "none", "notApplicable"]),
        rating(3, "onboarding.q3", "scale.lowEasy", "scale.highEasy"),
        poll(4, "onboarding.q4", [
          "help.clear",
          "help.sometimes",
          "help.notClear",
          "help.notNeeded",
        ]),
        poll(5, "onboarding.q5", ["tools", "expectations", "workflows", "connections", "noExtra"]),
        rating(6, "onboarding.q6", "scale.lowReady", "scale.highReady"),
        poll(7, "onboarding.q7", ["guided", "checklist", "worked", "conversation", "noExtra"]),
        poll(8, "onboarding.q8", ["when.week", "when.next", "when.month", "noFollow", "unsure"]),
      ];
      break;
    case "service-experience":
      questions = [
        poll(1, "service.q1", [
          "status.resolved",
          "status.partial",
          "status.unresolved",
          "status.notNeeded",
        ]),
        rating(2, "service.q2", "scale.lowEasy", "scale.highEasy"),
        rating(3, "service.q3", "scale.lowClear", "scale.highClear"),
        rating(4, "service.q4", "scale.lowUseful", "scale.highUseful"),
        rating(5, "service.q5", "scale.lowEasy", "scale.manageable"),
        poll(6, "service.q6", [
          "findingHelp",
          "explainRequest",
          "waiting",
          "updates",
          "resolution",
          "noChange",
        ]),
        poll(7, "service.q7", [
          "instructions",
          "simpler",
          "earlier",
          "clearOwnership",
          "followResources",
          "noChange",
        ]),
        poll(8, "service.q8", ["clarifyNext", "checkUnresolved", "sendGuidance", "noFollow"]),
      ];
      break;
    case "learning-needs":
      questions = [
        rating(1, "learning.q1", "scale.lowFamiliar", "scale.highFamiliar"),
        poll(2, "learning.q2", [
          "goal.understand",
          "goal.apply",
          "goal.explain",
          "goal.connect",
          "goal.explore",
        ]),
        poll(3, "learning.q3", ["recap", "worked", "demonstration", "guided", "challenge"]),
        poll(4, "learning.q4", [
          "barrier.words",
          "barrier.background",
          "barrier.steps",
          "barrier.practice",
          "barrier.pace",
          "none",
        ]),
        rating(5, "learning.q5", "scale.lowReady", "scale.highReady"),
        poll(6, "learning.q6", ["individual", "partner", "guided", "repeated", "noPreference"]),
        poll(7, "learning.q7", ["summary", "worked", "questions", "checklist", "noExtra"]),
        poll(8, "learning.q8", [
          "goal.explain",
          "goal.apply",
          "chooseApproach",
          "spotError",
          "goal.connect",
        ]),
      ];
      break;
    default:
      return undefined;
  }
  return {
    title: t(`${entry.prefix}.title`),
    description: t(`${entry.prefix}.description`),
    category: entry.category,
    experiencePreset: { id: entry.preset, version: 1 },
    questions,
  };
}

export function launchStarterGuide(
  id: StarterId,
  locale: SupportedLocale,
  survey = false,
): StarterGuide | undefined {
  const entry = definition(id);
  if (!entry) return undefined;
  const t = (key: LaunchCopyKey) => launchCopy(locale, key);
  const knowledge = ["source-evaluation", "percentage-check", "feedback-skills"].includes(id);
  const reflection: Partial<Record<StarterId, LaunchCopyKey>> = {
    "source-evaluation": "source.reflect",
    "percentage-check": "percentage.reflect",
    "feedback-skills": "feedback.reflect",
  };
  return {
    audience: t(
      knowledge
        ? id === "feedback-skills"
          ? "audience.teams"
          : "audience.learners"
        : id === "project-kickoff"
          ? "audience.teams"
          : "audience.feedback",
    ),
    minutes: survey ? 5 : entry.minutes,
    preparation: t("guide.prepare"),
    facilitation: t(survey ? "guide.survey" : knowledge ? "guide.teach" : "guide.discuss"),
    interpretation: t(survey ? "guide.aggregate" : knowledge ? "guide.knowledge" : "guide.opinion"),
    followUp: [
      t(entry.follow),
      ...(id === "feedback-skills" ? [t("feedback.ready")] : []),
      ...(reflection[id] ? [t(reflection[id]!)] : []),
    ].join(" "),
  };
}

/** Indexes refer to the authored questionnaire, never user-authored content or source clones. */
export function launchSurveyOptions(id: StarterId, locale: SupportedLocale) {
  const entry = definition(id);
  if (!entry || ["source-evaluation", "percentage-check", "feedback-skills"].includes(id))
    return undefined;
  return {
    description: launchCopy(locale, `${entry.prefix}.description`),
    optionalIndexes: entry.optional,
  };
}
