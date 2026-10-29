import { randomUUID } from "node:crypto";
import {
  QuizContentSchema,
  QuizDraftSchema,
  StarterSummarySchema,
  questionTypeDefinition,
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
        "Which action best shows that you have understood someone else's point?",
        [
          "Restate it in your own words and check with them",
          "Wait for your turn to speak",
          "Repeat your own position more loudly",
        ],
        0,
        {
          confidence: "required",
          explanation:
            "Paraphrasing and checking gives the other person a chance to correct your interpretation.",
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
        "A teammate raises a concern you disagree with. What is a useful first response?",
        [
          "Summarize the concern and ask whether you understood it",
          "Explain why they should not feel concerned",
          "Change the subject before they finish",
        ],
        0,
        {
          delivery: "recheck",
          explanation:
            "Check your understanding of the concern before evaluating it or proposing a solution.",
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
        "A project has taken months, but new evidence shows it will not meet the goal. What should guide the next decision?",
        [
          "Expected future benefits, costs, and alternatives",
          "The time already spent makes continuing mandatory",
          "The original plan must never change",
        ],
        0,
        {
          confidence: "required",
          explanation:
            "Past effort cannot be recovered. Compare the future consequences of continuing, changing, or stopping.",
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
        "A prepaid course no longer fits your goals. Which question is most useful when deciding whether to keep attending?",
        [
          "Is the remaining learning worth the time compared with my alternatives?",
          "Would stopping make the past payment disappear?",
        ],
        0,
        {
          delivery: "recheck",
          explanation:
            "Use the remaining costs and benefits to decide what to do next; the past payment is unchanged.",
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
        "A background task can be retried after network loss. What helps avoid processing the same task twice?",
        [
          "Recognize the task using a stable operation identifier",
          "Use a different identifier for every retry",
          "Discard all records of completed work",
        ],
        0,
        {
          confidence: "required",
          explanation:
            "A stable operation identifier lets the receiver recognize attempts belonging to the same task.",
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
        prompt:
          "A worker completes 120 tasks in 30 seconds at a steady rate. How many tasks does it complete per second?",
        purpose: "practice",
        confidence: "optional",
        delivery: "main",
        conceptKeys: ["technical.calculation"],
        linkedRecheckQuestionId: null,
        correctValue: "4",
        tolerance: "0",
        unit: "tasks per second",
        timeLimitSeconds: 45,
        basePoints: 1_000,
        explanation: "Divide 120 tasks by 30 seconds to get an average rate of 4 tasks per second.",
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
        "You discover a shared document that exposes client details to people who do not need access. What is the safest first action?",
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
        "Who should receive the report through your organization's approved process?",
        [
          "The role responsible for privacy or security incidents",
          "A colleague who is not accountable",
          "Nobody unless harm occurs",
        ],
        0,
        {
          conceptKeys: ["compliance.escalation"],
          explanation:
            "Use the designated incident contact so the issue reaches people authorized to assess and respond.",
        },
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
        "A required work tool is not accessible with your account. What should you do first?",
        [
          "Use the approved support channel and describe the access issue",
          "Ask anyone who is available",
          "Wait until the next team meeting",
        ],
        0,
        {
          conceptKeys: ["onboarding.support"],
          explanation:
            "Describe the issue through the approved support route so the right person can help without sharing credentials.",
        },
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

addQuiz(
  "source-evaluation",
  "Evidence worth trusting",
  "education",
  "Two articles make opposite claims. What is the most useful first comparison?",
  [
    "Which headline is more confident",
    "Their evidence, methods, and original sources",
    "Which has more shares",
  ],
  1,
  "Trace claims to evidence and examine how it was gathered before deciding how much weight to give them.",
  {
    prompt: "A chart is shared without a source or date. What should you do before relying on it?",
    labels: [
      "Find the original data and its context",
      "Assume a polished chart is reliable",
      "Use it if it matches your opinion",
    ],
    correct: 0,
    explanation:
      "The original source, collection date, and measurement definitions help establish what a chart supports.",
  },
);
addQuiz(
  "experiment-design",
  "One change at a time",
  "education",
  "You test whether light affects seedling growth. Which comparison best isolates light?",
  [
    "Change light, water, and soil together",
    "Keep water and soil alike while changing light",
    "Compare different plants in different seasons",
  ],
  1,
  "Hold other relevant conditions similar so differences in growth can be interpreted more clearly.",
  {
    prompt:
      "You compare two study methods. Which design reduces an obvious alternative explanation?",
    labels: [
      "Give one group twice as much study time",
      "Use different tests for each group",
      "Give both groups the same time and assessment",
    ],
    correct: 2,
    explanation: "Comparable time and assessment reduce confounding when comparing study methods.",
  },
);
addQuiz(
  "probability-basics",
  "Independent events",
  "education",
  "A fair coin lands heads four times. What is the probability of heads on the next independent toss?",
  ["One half", "Zero", "More than one half"],
  0,
  "Independent tosses do not remember earlier outcomes; the probability remains one half.",
  {
    prompt:
      "A fair six-sided die has not shown a six recently. What is the chance of six on the next independent roll?",
    labels: ["One half", "One in six", "Certain"],
    correct: 1,
    explanation: "Past independent rolls do not change the next roll's one-in-six probability.",
  },
);
addQuiz(
  "feedback-skills",
  "Feedback people can use",
  "business",
  "Which feedback is easiest for a colleague to act on?",
  [
    "You are careless",
    "In yesterday's handoff, the missing owner delayed the next step; please name an owner next time",
    "Everyone thinks you should improve",
  ],
  1,
  "Describe an observable situation, its impact, and a concrete next step instead of labeling a person.",
  {
    prompt: "A presentation was difficult to follow. Which follow-up is most useful?",
    labels: [
      "You are bad at presenting",
      "Try harder next time",
      "Put the decision first, then group the supporting evidence into three points",
    ],
    correct: 2,
    explanation:
      "A specific, achievable adjustment gives the recipient something they can try and evaluate.",
  },
);
addQuiz(
  "privacy-by-design",
  "Collect only what you need",
  "safety_compliance",
  "A workshop needs a count of dietary preferences. Which approach best limits unnecessary personal data?",
  [
    "Collect everyone's home address",
    "Ask for the relevant preferences without unrelated details",
    "Request a copy of each person's identification",
  ],
  1,
  "Collect information needed for the stated purpose and follow your organization's handling and retention rules.",
  {
    prompt:
      "You need to understand which training topics are useful. Which question fits that purpose?",
    labels: [
      "Which topic helped your work?",
      "What is your personal account password?",
      "What is your complete medical history?",
    ],
    correct: 0,
    explanation:
      "Match the information requested to the purpose and avoid collecting unrelated sensitive details.",
  },
);
addQuiz(
  "version-control",
  "Reviewable changes",
  "technical",
  "Which commit is easiest for a teammate to review?",
  [
    "An unrelated mix of formatting, features, and deletions",
    "A focused change with its purpose explained",
    "A generated file with no source change",
  ],
  1,
  "Focused changes and a clear explanation help reviewers understand intent and assess consequences.",
  {
    prompt:
      "A shared branch contains a change you need to undo. What best preserves an understandable history?",
    labels: [
      "Remove everyone's later commits",
      "Hide the problem in an unrelated change",
      "Create a reviewed revert that explains the reason",
    ],
    correct: 2,
    explanation: "A revert records the reversal while preserving the context of shared work.",
  },
);

type FeedbackItem =
  { prompt: string; labels: string[] } | { prompt: string; low: string; high: string };

function addFeedback(
  id: StarterId,
  title: string,
  category: RoundCategory,
  description: string,
  items: FeedbackItem[],
) {
  starterDrafts[id] = {
    title,
    description,
    category,
    experiencePreset: { id: presetForCategory[category], version: 1 },
    questions: items.map((item, index) => {
      const questionId = `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`;
      if ("labels" in item)
        return choiceQuestion(questionId, item.prompt, item.labels, null, {
          type: "poll",
          explanation: "Use the response distribution to choose a concrete next step.",
        });
      return {
        id: questionId,
        type: "rating" as const,
        prompt: item.prompt,
        purpose: "opinion" as const,
        confidence: "off" as const,
        delivery: "main" as const,
        conceptKeys: [],
        linkedRecheckQuestionId: null,
        min: 1,
        max: 5,
        minLabel: item.low,
        maxLabel: item.high,
        timeLimitSeconds: 30,
        basePoints: 0,
        explanation:
          "Read the labeled scale alongside the other responses before choosing a next step.",
        mediaId: null,
        mediaAlt: null,
      };
    }),
  };
  metadata[id] = {
    description,
    segment: category === "education" ? "education" : category === "business" ? "workplace" : "all",
  };
}

addFeedback(
  "event-feedback",
  "Event experience",
  "general",
  "Learn what was useful, how the format worked, and what attendees want next.",
  [
    { prompt: "How useful was this event for your goals?", low: "Not useful", high: "Very useful" },
    {
      prompt: "Which part gave you the most value?",
      labels: [
        "Talks and examples",
        "Hands-on activities",
        "Conversations",
        "Resources to take away",
      ],
    },
    {
      prompt: "How easy was it to participate in the activities?",
      low: "Very difficult",
      high: "Very easy",
    },
    {
      prompt: "What should we improve first for the next event?",
      labels: [
        "More practical examples",
        "More time to participate",
        "Clearer logistics",
        "More depth on fewer topics",
      ],
    },
  ],
);
addFeedback(
  "onboarding-experience",
  "First-month onboarding",
  "business",
  "Check role clarity, access to help, and the support new teammates need next.",
  [
    { prompt: "How clear are the priorities for your role?", low: "Not clear", high: "Very clear" },
    {
      prompt: "How easy is it to find the information needed for your work?",
      low: "Very difficult",
      high: "Very easy",
    },
    {
      prompt: "Where would more support help most?",
      labels: [
        "Tools and access",
        "Role expectations",
        "Team connections",
        "Workflows and examples",
      ],
    },
    {
      prompt: "What would be the most useful next step?",
      labels: [
        "A guided practice task",
        "A role-specific checklist",
        "A conversation with a teammate",
        "Time to review the documentation",
      ],
    },
  ],
);
addFeedback(
  "team-collaboration",
  "How we work together",
  "business",
  "Explore handoffs, decision clarity, and practical improvements to collaboration.",
  [
    {
      prompt: "How clear is ownership when work moves between teammates?",
      low: "Not clear",
      high: "Very clear",
    },
    {
      prompt: "What most often slows shared work?",
      labels: ["Unclear decisions", "Missing context", "Too many handoffs", "Competing priorities"],
    },
    {
      prompt: "How easy is it to get the context you need from another team?",
      low: "Very difficult",
      high: "Very easy",
    },
    {
      prompt: "Which small experiment should we try next?",
      labels: [
        "Write down decisions",
        "Name a handoff owner",
        "Share context earlier",
        "Set a regular focus period",
      ],
    },
  ],
);
addFeedback(
  "service-experience",
  "Service follow-up",
  "business",
  "Find out whether a request was resolved and where the service journey needs attention.",
  [
    {
      prompt: "How well was your original request resolved?",
      low: "Not resolved",
      high: "Fully resolved",
    },
    { prompt: "How easy was it to get help?", low: "Very difficult", high: "Very easy" },
    {
      prompt: "Which part of the experience needs the most attention?",
      labels: [
        "Finding the right contact",
        "Understanding the next step",
        "Waiting for an update",
        "Reaching a resolution",
      ],
    },
    {
      prompt: "Which improvement would help you most next time?",
      labels: [
        "Clearer instructions",
        "More timely updates",
        "A simpler process",
        "Better follow-up resources",
      ],
    },
  ],
);
addFeedback(
  "learning-needs",
  "Plan the next lesson",
  "education",
  "Choose a useful starting point from learners' familiarity, goals, and preferred practice.",
  [
    {
      prompt: "How familiar are you with the upcoming topic?",
      low: "Completely new",
      high: "Very familiar",
    },
    {
      prompt: "Which learning goal matters most to you?",
      labels: [
        "Understand the core idea",
        "Solve a practical problem",
        "Explain my reasoning",
        "Connect it to earlier learning",
      ],
    },
    {
      prompt: "Which activity would help you start?",
      labels: [
        "A worked example",
        "A short demonstration",
        "Guided practice",
        "A discussion with a partner",
      ],
    },
    {
      prompt: "How comfortable do you feel trying a practice task now?",
      low: "Need guidance",
      high: "Ready to try",
    },
  ],
);
addFeedback(
  "community-planning",
  "Community next steps",
  "general",
  "Gather priorities, participation preferences, and accessible ways to contribute.",
  [
    {
      prompt: "What should our next community gathering focus on?",
      labels: [
        "Sharing useful skills",
        "Solving a shared problem",
        "Meeting other members",
        "Planning a small project",
      ],
    },
    {
      prompt: "Which format would make it easiest for you to take part?",
      labels: [
        "A short online session",
        "An in-person discussion",
        "A hands-on activity",
        "An update I can read later",
      ],
    },
    {
      prompt: "How clear are the ways to contribute to this community?",
      low: "Not clear",
      high: "Very clear",
    },
    {
      prompt: "What would help you take the next step?",
      labels: [
        "A specific invitation",
        "A small, defined task",
        "A person to ask",
        "More information about the goal",
      ],
    },
  ],
);

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
    previewPrompt: draft.questions[0]!.prompt,
    responseTypes: [...new Set(draft.questions.map((question) => question.type))],
    version: 1,
    roundType: draft.questions.every((q) => !questionTypeDefinition(q.type).scored)
      ? "poll"
      : draft.questions.every((q) => questionTypeDefinition(q.type).scored)
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
