import { randomUUID } from "node:crypto";
import {
  QuizContentSchema,
  QuizDraftSchema,
  StarterSummarySchema,
  type ChoiceDraft,
  type QuestionDraft,
  type QuizDraft,
  type StarterId,
  type StarterSummary,
  type RoundCategory,
} from "@openround/contracts";

const ids = {
  q1: "00000000-0000-4000-8000-000000000001",
  q2: "00000000-0000-4000-8000-000000000002",
  q3: "00000000-0000-4000-8000-000000000003",
  c1: "00000000-0000-4000-8000-000000000011",
  c2: "00000000-0000-4000-8000-000000000012",
  c3: "00000000-0000-4000-8000-000000000013",
  c4: "00000000-0000-4000-8000-000000000014",
} as const;

function choices(
  labels: string[],
  correct: number | null,
  misconception?: { index: number; key: string; feedback: string },
): ChoiceDraft[] {
  return labels.map((label, index) => ({
    id: [ids.c1, ids.c2, ids.c3, ids.c4][index]!,
    label,
    isCorrect: correct === index,
    ...(misconception?.index === index
      ? { misconceptionKey: misconception.key, feedback: misconception.feedback }
      : {}),
  }));
}

function choiceQuestion(
  id: string,
  prompt: string,
  labels: string[],
  correct: number | null,
  input: Partial<QuestionDraft> & {
    type?: "single_select" | "true_false" | "poll";
    misconception?: { index: number; key: string; feedback: string };
  } = {},
): QuestionDraft {
  return {
    id,
    type: input.type ?? "single_select",
    prompt,
    purpose: input.type === "poll" ? "opinion" : (input.purpose ?? "diagnostic"),
    confidence: input.type === "poll" ? "off" : (input.confidence ?? "optional"),
    delivery: input.delivery ?? "main",
    conceptKeys: input.conceptKeys ?? [],
    linkedRecheckQuestionId: input.linkedRecheckQuestionId ?? null,
    choices: choices(labels, correct, input.misconception),
    timeLimitSeconds: input.timeLimitSeconds ?? 30,
    basePoints: input.type === "poll" ? 0 : (input.basePoints ?? 1_000),
    explanation: input.explanation ?? "Review the reasoning together before moving on.",
    mediaId: null,
    mediaAlt: null,
  };
}

const starterDrafts: Partial<Record<StarterId, QuizDraft>> = {
  "exit-ticket": {
    title: "Exit ticket",
    description:
      "Close a lesson or workshop with understanding, confidence, and next-step evidence.",
    category: "education",
    experiencePreset: { id: "focus", version: 1 },
    questions: [
      choiceQuestion(
        ids.q1,
        "Which statement best captures today’s most important idea?",
        ["Replace with the key idea", "Replace with a plausible misconception", "I am not sure"],
        0,
        {
          confidence: "required",
          conceptKeys: ["session.key-idea"],
          linkedRecheckQuestionId: ids.q2,
          misconception: {
            index: 1,
            key: "session.key-idea.misconception",
            feedback: "Revisit the distinction highlighted in the explanation.",
          },
        },
      ),
      choiceQuestion(
        ids.q2,
        "Apply the same idea in a new example.",
        [
          "Replace with the best application",
          "Replace with a distractor",
          "Replace with another distractor",
        ],
        0,
        {
          delivery: "recheck",
          purpose: "practice",
          confidence: "required",
          conceptKeys: ["session.key-idea"],
        },
      ),
    ],
  },
  "misconception-check": {
    title: "Misconception check",
    description:
      "Surface a common wrong model, discuss it, and verify recovery with a linked recheck.",
    category: "education",
    experiencePreset: { id: "campus", version: 1 },
    questions: [
      choiceQuestion(
        ids.q1,
        "Which explanation is most accurate?",
        [
          "Replace with the accurate explanation",
          "Replace with the common misconception",
          "Replace with a less likely distractor",
        ],
        0,
        {
          confidence: "required",
          conceptKeys: ["topic.core-model"],
          linkedRecheckQuestionId: ids.q2,
          misconception: {
            index: 1,
            key: "topic.core-model.common-error",
            feedback: "This choice uses the common model that the explanation will correct.",
          },
        },
      ),
      choiceQuestion(
        ids.q2,
        "Which new case follows the corrected model?",
        ["Replace with the transfer case", "Replace with the misconception applied again"],
        0,
        {
          delivery: "recheck",
          purpose: "practice",
          confidence: "required",
          conceptKeys: ["topic.core-model"],
        },
      ),
    ],
  },
  "technical-concept-check": {
    title: "Technical concept check",
    description: "Check a technical decision and the reasoning behind it before work continues.",
    category: "technical",
    experiencePreset: { id: "blueprint", version: 1 },
    questions: [
      choiceQuestion(
        ids.q1,
        "Which option best satisfies the stated technical constraint?",
        [
          "Replace with the best option",
          "Replace with a tempting trade-off",
          "Replace with an unsafe option",
        ],
        0,
        {
          confidence: "required",
          conceptKeys: ["technical.constraint"],
          misconception: {
            index: 1,
            key: "technical.constraint.tradeoff",
            feedback: "This option overlooks one of the stated constraints.",
          },
        },
      ),
      {
        id: ids.q2,
        type: "numeric",
        prompt: "Enter the expected result for the worked example.",
        purpose: "practice",
        confidence: "optional",
        delivery: "main",
        conceptKeys: ["technical.calculation"],
        linkedRecheckQuestionId: null,
        correctValue: "42",
        tolerance: "0",
        unit: null,
        timeLimitSeconds: 45,
        basePoints: 1_000,
        explanation: "Replace this with the calculation steps and assumptions.",
        mediaId: null,
        mediaAlt: null,
      },
    ],
  },
  "compliance-scenario": {
    title: "Compliance scenario",
    description: "Practise the safest response to a realistic policy scenario and explain why.",
    category: "safety_compliance",
    experiencePreset: { id: "signal", version: 1 },
    questions: [
      choiceQuestion(
        ids.q1,
        "What is the safest first action in this scenario?",
        [
          "Pause and follow the approved escalation path",
          "Continue and document it later",
          "Handle it informally without a record",
        ],
        0,
        {
          confidence: "required",
          conceptKeys: ["compliance.safe-response"],
          misconception: {
            index: 1,
            key: "compliance.safe-response.delay",
            feedback: "Delaying escalation can increase risk and may breach policy.",
          },
          explanation:
            "Stop the risky activity, protect people and data, then use the approved escalation path.",
        },
      ),
      choiceQuestion(
        ids.q2,
        "Who should receive the escalation next?",
        [
          "Replace with the approved role",
          "A colleague who is not accountable",
          "Nobody unless harm occurs",
        ],
        0,
        { conceptKeys: ["compliance.escalation"] },
      ),
    ],
  },
  "new-hire-knowledge-check": {
    title: "New-hire knowledge check",
    description: "Confirm essential first-week knowledge without relying on a high-stakes test.",
    category: "business",
    experiencePreset: { id: "studio", version: 1 },
    questions: [
      choiceQuestion(
        ids.q1,
        "Where should you go first when you need help with this process?",
        [
          "Replace with the approved support channel",
          "Ask anyone who is available",
          "Wait until the next team meeting",
        ],
        0,
        { conceptKeys: ["onboarding.support"] },
      ),
      choiceQuestion(
        ids.q2,
        "True or false: it is safe to share your account credentials with a teammate.",
        ["True", "False"],
        1,
        {
          type: "true_false",
          conceptKeys: ["onboarding.account-security"],
          explanation:
            "Credentials are personal. Use approved access and delegation processes instead.",
        },
      ),
    ],
  },
  "icebreaker-poll": {
    title: "Icebreaker poll",
    description: "Open the room with two low-pressure prompts that everyone can answer.",
    category: "icebreaker",
    experiencePreset: { id: "spark", version: 1 },
    questions: [
      choiceQuestion(
        ids.q1,
        "What kind of energy are you bringing today?",
        ["Ready to dive in", "Curious", "Still warming up", "Here to listen"],
        null,
        { type: "poll" },
      ),
      {
        id: ids.q2,
        type: "rating",
        prompt: "How familiar are you with today’s topic?",
        purpose: "opinion",
        confidence: "off",
        delivery: "main",
        conceptKeys: [],
        linkedRecheckQuestionId: null,
        min: 1,
        max: 5,
        minLabel: "New to it",
        maxLabel: "Very familiar",
        timeLimitSeconds: 20,
        basePoints: 0,
        explanation: "Use the spread to calibrate pace and examples.",
        mediaId: null,
        mediaAlt: null,
      },
    ],
  },
};

const metadata: Partial<Record<StarterId, Pick<StarterSummary, "description" | "segment">>> = {
  "exit-ticket": {
    description: "Close with a key-idea check and linked transfer question.",
    segment: "education",
  },
  "misconception-check": {
    description: "Surface a common wrong model and verify recovery.",
    segment: "education",
  },
  "technical-concept-check": {
    description: "Check a technical choice and a worked result.",
    segment: "all",
  },
  "compliance-scenario": {
    description: "Practise a safe response to a realistic policy scenario.",
    segment: "workplace",
  },
  "new-hire-knowledge-check": {
    description: "Confirm essential first-week knowledge with low stakes.",
    segment: "workplace",
  },
  "icebreaker-poll": {
    description: "Open the room with two low-pressure prompts.",
    segment: "all",
  },
};

const presetForCategory = {
  general: "focus",
  education: "campus",
  business: "studio",
  technical: "blueprint",
  safety_compliance: "signal",
  icebreaker: "spark",
} as const;

function addQuiz(
  id: StarterId,
  title: string,
  category: RoundCategory,
  prompt: string,
  labels: string[],
  correct: number,
  explanation: string,
  recheck: { prompt: string; labels: string[]; correct: number; explanation: string },
) {
  starterDrafts[id] = {
    title,
    description:
      "An original, ready-to-edit diagnostic and linked transfer check. Review examples for your audience before hosting.",
    category,
    experiencePreset: { id: presetForCategory[category], version: 1 },
    questions: [
      choiceQuestion(ids.q1, prompt, labels, correct, {
        explanation,
        conceptKeys: [id],
        confidence: "required",
        linkedRecheckQuestionId: ids.q2,
      }),
      choiceQuestion(ids.q2, recheck.prompt, recheck.labels, recheck.correct, {
        explanation: recheck.explanation,
        conceptKeys: [id],
        delivery: "recheck",
        purpose: "practice",
        confidence: "required",
      }),
    ],
  };
  metadata[id] = {
    segment:
      category === "education"
        ? "education"
        : category === "business" || category === "safety_compliance"
          ? "workplace"
          : "all",
    description: explanation,
  };
}

addQuiz(
  "retrieval-practice",
  "Learning that lasts",
  "education",
  "Which activity gives the clearest evidence that you can recall an idea?",
  [
    "Rereading a highlighted passage",
    "Explaining it without looking at notes",
    "Recognizing the textbook cover",
  ],
  1,
  "Retrieving an idea without notes reveals what you can recall, not just recognize.",
  {
    prompt: "After reading a chapter, which next step checks your recall?",
    labels: [
      "Close it and summarize the key idea",
      "Highlight the same paragraph again",
      "Count the pages",
    ],
    correct: 0,
    explanation: "A summary from memory is a retrieval check; revisit gaps afterward.",
  },
);
addQuiz(
  "scientific-reasoning",
  "Correlation or cause?",
  "education",
  "Ice cream sales and swimming both increase in summer. What does this establish?",
  [
    "Ice cream causes swimming",
    "They are associated; a shared cause may explain it",
    "Swimming causes ice cream sales",
  ],
  1,
  "Association alone does not establish causation; temperature could influence both.",
  {
    prompt:
      "People carrying umbrellas are more likely to encounter rain. What should you conclude?",
    labels: [
      "Umbrellas cause rain",
      "Rain may explain both umbrella use and getting wet",
      "Umbrellas prevent all rain",
    ],
    correct: 1,
    explanation: "Consider common causes and alternative explanations before inferring causation.",
  },
);
addQuiz(
  "data-literacy",
  "Reading averages",
  "education",
  "For values 2, 3, 4, 5, and 100, which summary is less affected by the extreme value?",
  ["Mean", "Median", "Maximum"],
  1,
  "The median describes the middle observation and is less sensitive to outliers.",
  {
    prompt:
      "One very expensive house enters a small neighborhood dataset. Which summary best represents a typical sale?",
    labels: ["Maximum price", "Total price", "Median price"],
    correct: 2,
    explanation:
      "The median is often useful for describing a typical observation in a skewed distribution.",
  },
);
addQuiz(
  "percentage-check",
  "Percentages in practice",
  "technical",
  "A price of $80 is reduced by 25%. What is the new price?",
  ["$55", "$60", "$75"],
  1,
  "25% of $80 is $20; subtracting it leaves $60.",
  {
    prompt: "A $120 price is reduced by 10%. What is the new price?",
    labels: ["$108", "$110", "$12"],
    correct: 0,
    explanation: "10% of $120 is $12; the remaining price is $108.",
  },
);
addQuiz(
  "cybersecurity-basics",
  "Spot the phishing trap",
  "safety_compliance",
  "An unexpected message asks you to sign in urgently using its link. What is the safest first step?",
  [
    "Use the link immediately",
    "Verify through a known, independent channel",
    "Forward your password to support",
  ],
  1,
  "Verify unexpected requests independently and follow your organization's reporting procedure.",
  {
    prompt: "A caller claims to be IT and asks for your verification code. What should you do?",
    labels: [
      "Share the code",
      "Verify the request through your known IT channel without sharing it",
      "Post the code in team chat",
    ],
    correct: 1,
    explanation:
      "Do not share authentication codes; independently verify and report suspicious requests.",
  },
);
addQuiz(
  "api-design",
  "Safe API retries",
  "technical",
  "A client times out after submitting a payment. What best prevents duplicate processing on retry?",
  [
    "A new request identifier every time",
    "An idempotency key reused for the same operation",
    "Disabling all error handling",
  ],
  1,
  "An idempotency key lets the server recognize retries of the same logical operation.",
  {
    prompt:
      "A create-order request is retried after network loss. Which identifier should remain stable?",
    labels: [
      "The logical operation's idempotency key",
      "The new socket ID",
      "The current timestamp",
    ],
    correct: 0,
    explanation:
      "Stable operation identity makes retries safe; each distinct new order needs its own key.",
  },
);
addQuiz(
  "incident-response",
  "Incident first steps",
  "technical",
  "An alert suggests a production issue. What should you do first?",
  [
    "Delete logs to reduce noise",
    "Validate impact and follow the incident procedure",
    "Change several systems at once",
  ],
  1,
  "Validate the impact, preserve evidence, and use an agreed incident process.",
  {
    prompt: "A possible data exposure is reported. Which action best supports response?",
    labels: [
      "Preserve evidence and use the approved escalation path",
      "Publish affected records in chat",
      "Ignore it until confirmed by social media",
    ],
    correct: 0,
    explanation:
      "Protect evidence and sensitive information while escalating through the appropriate process.",
  },
);
addQuiz(
  "accessibility-awareness",
  "Accessible by design",
  "business",
  "A chart distinguishes categories only by color. What improves accessibility?",
  ["Add labels or distinct patterns", "Make colors more similar", "Remove the legend"],
  0,
  "Do not rely on color alone; provide another way to distinguish information.",
  {
    prompt: "A form flags errors using red borders only. What should you add?",
    labels: [
      "A flashing background",
      "Clear error text associated with each field",
      "Smaller labels",
    ],
    correct: 1,
    explanation:
      "Associated text describes the problem to people who cannot perceive the color cue.",
  },
);

function addPoll(
  id: StarterId,
  title: string,
  category: RoundCategory,
  prompt: string,
  labels: string[],
  ratingPrompt: string,
  low: string,
  high: string,
) {
  starterDrafts[id] = {
    title,
    description:
      "Two unscored, original prompts for a live conversation. There are no correct answers or learner scores.",
    category,
    experiencePreset: { id: presetForCategory[category], version: 1 },
    questions: [
      choiceQuestion(ids.q1, prompt, labels, null, {
        type: "poll",
        explanation: "Use the distribution as a starting point for discussion.",
      }),
      {
        id: ids.q2,
        type: "rating",
        prompt: ratingPrompt,
        purpose: "opinion",
        confidence: "off",
        delivery: "main",
        conceptKeys: [],
        linkedRecheckQuestionId: null,
        min: 1,
        max: 5,
        minLabel: low,
        maxLabel: high,
        timeLimitSeconds: 30,
        basePoints: 0,
        explanation: "Invite context without treating a rating as a judgment of a participant.",
        mediaId: null,
        mediaAlt: null,
      },
    ],
  };
  metadata[id] = {
    description: `${prompt} Follow with a labeled reflection scale.`,
    segment: category === "education" ? "education" : category === "business" ? "workplace" : "all",
  };
}
addPoll(
  "project-kickoff",
  "Project kickoff",
  "business",
  "What needs the most clarity before this project starts?",
  ["Success criteria", "Roles", "Timeline", "Dependencies"],
  "How clear is our shared goal?",
  "Not clear",
  "Very clear",
);
addPoll(
  "team-retrospective",
  "Team retrospective",
  "business",
  "What would most improve our next iteration?",
  ["Smaller scope", "Earlier feedback", "Clearer ownership", "Fewer interruptions"],
  "How sustainable was our pace?",
  "Not sustainable",
  "Very sustainable",
);
addPoll(
  "meeting-priorities",
  "Meeting priorities",
  "business",
  "Where should we focus today's discussion?",
  ["Decisions", "Blockers", "Planning", "Questions"],
  "How ready are you to make a decision?",
  "Need more context",
  "Ready",
);
addPoll(
  "training-feedback",
  "Training feedback",
  "general",
  "What would make the next training more useful?",
  ["More examples", "More practice", "More discussion", "A different pace"],
  "How useful was this session for your work?",
  "Not yet useful",
  "Very useful",
);
addPoll(
  "course-pulse",
  "Course pulse",
  "education",
  "What would help you most in the next class?",
  ["A worked example", "Practice problems", "Concept review", "Peer discussion"],
  "How manageable is the current pace?",
  "Too demanding",
  "Very manageable",
);
addPoll(
  "workshop-expectations",
  "Workshop expectations",
  "general",
  "What do you most want from this workshop?",
  ["Practical tools", "New perspectives", "Hands-on practice", "Discussion"],
  "How familiar are you with the topic?",
  "New to it",
  "Very familiar",
);
addPoll(
  "change-readiness",
  "Change readiness",
  "business",
  "What support would help you adopt this change?",
  ["A clear rationale", "A practical demonstration", "Practice time", "A help contact"],
  "How ready do you feel for the next step?",
  "Need support",
  "Ready",
);
addPoll(
  "customer-discovery",
  "Product discovery",
  "business",
  "Which improvement would be most valuable?",
  ["Easier setup", "Faster workflows", "Better reporting", "More guidance"],
  "How well does the current workflow meet your needs?",
  "Not well",
  "Very well",
);
addPoll(
  "this-or-that",
  "This or that",
  "icebreaker",
  "Which way would you prefer to start?",
  ["A quick challenge", "A short story", "A group discussion", "A demonstration"],
  "How much interaction would you like today?",
  "Mostly listen",
  "Lots of interaction",
);
addPoll(
  "weekend-warmup",
  "Low-pressure warmup",
  "icebreaker",
  "Choose a relaxing way to spend an hour.",
  ["A walk", "A book", "Music", "A creative project"],
  "How ready are you to start?",
  "Warming up",
  "Ready to go",
);
starterDrafts["retrieval-practice"]!.questions.push(
  choiceQuestion(
    ids.q3,
    "Which practice strategy would you like to try next?",
    [
      "Recall without notes",
      "Explain to a peer",
      "Space practice across days",
      "Combine strategies",
    ],
    null,
    {
      type: "poll",
      explanation: "This reflection is unscored and separate from the diagnostic evidence.",
    },
  ),
);
starterDrafts["accessibility-awareness"]!.questions.push({
  ...starterDrafts["course-pulse"]!.questions[1]!,
  id: ids.q3,
  prompt: "How confident do you feel applying accessible design in your own work?",
});

for (const [id, draft] of Object.entries(starterDrafts)) {
  starterDrafts[id as StarterId] = QuizContentSchema.parse(draft);
}

export const starterSummaries = (Object.keys(starterDrafts) as StarterId[]).map((id) => {
  const draft = starterDrafts[id]!;
  return StarterSummarySchema.parse({
    id,
    title: draft.title,
    description: metadata[id]!.description,
    segment: metadata[id]!.segment,
    category: draft.category,
    experiencePreset: draft.experiencePreset,
    questionCount: draft.questions.length,
    responseTypes: [...new Set(draft.questions.map((question) => question.type))],
    version: 1,
    roundType: draft.questions.every((q) => q.type === "poll" || q.type === "rating")
      ? "poll"
      : draft.questions.every((q) => q.type !== "poll" && q.type !== "rating")
        ? "quiz"
        : "custom",
  });
});

export function instantiateStarter(id: StarterId): QuizDraft {
  const source = starterDrafts[id]!;
  const questionIds = new Map(source.questions.map((question) => [question.id, randomUUID()]));
  return QuizDraftSchema.parse({
    ...structuredClone(source),
    questions: source.questions.map((question) => ({
      ...structuredClone(question),
      id: questionIds.get(question.id)!,
      linkedRecheckQuestionId: question.linkedRecheckQuestionId
        ? questionIds.get(question.linkedRecheckQuestionId)!
        : null,
      ...(question.type === "single_select" ||
      question.type === "true_false" ||
      question.type === "multi_select" ||
      question.type === "poll"
        ? {
            choices: question.choices.map((choice) => ({ ...choice, id: randomUUID() })),
          }
        : {}),
    })),
  });
}
