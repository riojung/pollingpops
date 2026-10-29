import {
  PresentationDraftSchema,
  type ContentSlideDraft,
  type PresentationDraft,
  type QuestionDraft,
} from "@openround/contracts";
import { createContentBlock } from "./presentation-builder";
import { clientUuid } from "./uuid";

type Slide = { kind: "content"; title: string; body: string; notes: string };
type Check = {
  kind: "check";
  key: string;
  prompt: string;
  labels: string[];
  correct: number | null;
  explanation: string;
  recheck?: string;
  delivery?: "recheck";
};
type Scale = { kind: "rating"; prompt: string; low: string; high: string };
type TemplateBlock = Slide | Check | Scale;

const slide = (title: string, body: string, notes: string): Slide => ({
  kind: "content",
  title,
  body,
  notes,
});
const poll = (key: string, prompt: string, labels: string[]): Check => ({
  kind: "check",
  key,
  prompt,
  labels,
  correct: null,
  explanation: "Use the response distribution to guide discussion and agree on a next step.",
});
const scale = (prompt: string, low: string, high: string): Scale => ({
  kind: "rating",
  prompt,
  low,
  high,
});

export const presentationTemplates = [
  {
    id: "review",
    title: "Evidence review",
    description: "Examine a claim, test the reasoning, and agree on the next piece of evidence.",
    category: "education",
    blocks: [
      slide(
        "From claim to evidence",
        "A team reports that a new reminder increased completion from 60% to 75%. What can we conclude?",
        "Invite an initial interpretation before discussing the comparison.",
      ),
      {
        kind: "check",
        key: "claim",
        prompt: "What does this before-and-after comparison establish?",
        labels: [
          "The reminder definitely caused the improvement",
          "Completion increased, but other explanations are possible",
          "The reminder cannot have helped",
        ],
        correct: 1,
        explanation:
          "A change over time alone does not rule out differences in the participants, timing, or other conditions.",
      },
      slide(
        "What else changed?",
        "Ask who was included, how completion was measured, and whether other changes occurred at the same time.",
        "Connect participants' reasoning to alternative explanations; avoid treating the observed increase as proof of cause.",
      ),
      poll("next", "Which evidence would help most next?", [
        "A comparable group without the reminder",
        "A more confident headline",
        "Only positive anecdotes",
        "A larger logo on the report",
      ]),
      slide(
        "Close the evidence gap",
        "Name the claim, the current evidence, one uncertainty, and a practical way to investigate it.",
        "Record the chosen evidence and an owner before closing.",
      ),
    ] satisfies TemplateBlock[],
  },
  {
    id: "training",
    title: "Training and recovery",
    description:
      "Diagnose a common error, teach with an example, and check transfer to a new situation.",
    category: "education",
    blocks: [
      slide(
        "Recognize it or recall it?",
        "Explore how to check what you can remember after studying.",
        "Ask learners to think about their own study habits. Keep the first response low stakes.",
      ),
      {
        kind: "check",
        key: "diagnostic",
        prompt: "Which activity best checks whether you can recall an idea?",
        labels: [
          "Reread the same paragraph",
          "Explain it with your notes closed",
          "Recognize the page layout",
        ],
        correct: 1,
        explanation: "Retrieving without notes reveals what you can recall independently.",
        recheck: "transfer",
      },
      slide(
        "Make memory do the work",
        "Close your notes, explain the idea in your own words, then reopen the material to check gaps.",
        "Demonstrate with a familiar example. Let learners try a short retrieval before advancing.",
      ),
      {
        kind: "check",
        key: "transfer",
        prompt: "After a product demonstration, which next step tests recall?",
        labels: [
          "Watch the same segment again",
          "List the key steps from memory, then check them",
          "Save the video link",
        ],
        correct: 1,
        explanation:
          "Reconstructing the steps from memory tests recall; checking afterward helps correct gaps.",
        delivery: "recheck",
      },
      scale("How ready do you feel to try retrieval practice?", "Need an example", "Ready to try"),
      slide(
        "One practice to take away",
        "Choose one topic, try a brief recall without notes, and revisit the gaps tomorrow.",
        "Keep the reflection separate from the scored understanding checks.",
      ),
    ] satisfies TemplateBlock[],
  },
  {
    id: "meeting",
    title: "Team meeting",
    description:
      "Set a useful agenda, surface blockers, and close with clear decisions and owners.",
    category: "business",
    blocks: [
      slide(
        "Make this meeting useful",
        "Our goal: leave with one clear decision and a next step someone owns.",
        "Name the decision this group can make and the time available.",
      ),
      poll("agenda", "Where should we spend most of our discussion time?", [
        "A decision waiting on us",
        "A shared blocker",
        "Upcoming priorities",
        "Questions needing context",
      ]),
      slide(
        "Discuss with a decision in view",
        "What do we know? What remains uncertain? Which options are practical within our constraints?",
        "Invite perspectives that have not been heard. Capture options and trade-offs visibly.",
      ),
      scale("How clear is the next step after this discussion?", "Not clear", "Very clear"),
      slide(
        "Close the loop",
        "Write down the decision, owner, due date, and where the update will be shared.",
        "Read the actions back and confirm ownership before ending.",
      ),
    ] satisfies TemplateBlock[],
  },
  {
    id: "kickoff",
    title: "Project kickoff",
    description: "Align the room on outcomes, dependencies, and a practical first milestone.",
    category: "business",
    blocks: [
      slide(
        "Start with the outcome",
        "A useful kickoff aligns why the work matters, what success looks like, and the first meaningful milestone.",
        "Add your project name, audience, and outcome before presenting.",
      ),
      poll("clarity", "What needs the most clarity before work starts?", [
        "Success measures",
        "Roles and ownership",
        "Scope and timeline",
        "Dependencies",
      ]),
      slide(
        "Define the boundaries",
        "Describe what this milestone includes, what it leaves for later, and the dependencies that could change the plan.",
        "Write a measurable milestone and ask whether the team can recognize when it is met.",
      ),
      scale(
        "How confident are you that our first milestone is achievable?",
        "Major gaps remain",
        "Clear and achievable",
      ),
      slide(
        "The first week",
        "Agree on one deliverable, an owner, a check-in date, and a place to surface blockers early.",
        "Use low ratings to find missing support or unclear assumptions.",
      ),
    ] satisfies TemplateBlock[],
  },
  {
    id: "retrospective",
    title: "Retrospective to action",
    description: "Reflect on recent work and choose one measurable experiment for the next cycle.",
    category: "business",
    blocks: [
      slide(
        "Learn from the last cycle",
        "Look at the work and the conditions around it. Choose one improvement the team can actually test.",
        "Set the timeframe. Invite observations about systems and practices without assigning blame.",
      ),
      scale("How sustainable was the team's pace?", "Unsustainable", "Very sustainable"),
      poll("friction", "Which source of friction should we discuss first?", [
        "Unclear priorities",
        "Slow feedback",
        "Handoffs and dependencies",
        "Interruptions",
      ]),
      slide(
        "Turn an observation into an experiment",
        "We observed… We think… For the next cycle we will try… We will look for…",
        "Keep the experiment small enough to finish and give it a visible owner.",
      ),
      poll("signal", "Which signal would best show that our experiment helped?", [
        "Less waiting",
        "Fewer repeated questions",
        "More predictable completion",
        "Better quality at handoff",
      ]),
      slide(
        "Return to the result",
        "Record the experiment, its owner, the signal to watch, and the review date.",
        "Start the next retrospective by reviewing this experiment.",
      ),
    ] satisfies TemplateBlock[],
  },
  {
    id: "onboarding",
    title: "Welcome and first steps",
    description:
      "Welcome new teammates, uncover support needs, and make the first task approachable.",
    category: "business",
    blocks: [
      slide(
        "You do not need to know everything today",
        "Start with the purpose of the team, a manageable first task, and the people who can help.",
        "Introduce the team's purpose and name a real contact for questions.",
      ),
      poll("support", "What would help you most as you begin?", [
        "A map of the tools",
        "An example of good work",
        "A person to ask",
        "A clear first-week checklist",
      ]),
      slide(
        "A small first task",
        "Choose a low-risk task. Find an example, try it with support, and ask for feedback before repeating it independently.",
        "Choose a task suited to the role and confirm access is available.",
      ),
      scale("How clear is where to go when you need help?", "Not clear", "Very clear"),
      slide(
        "Your next conversation",
        "Name your support contact, the first task, and a short check-in to discuss what helped and what is unclear.",
        "Make space for questions privately as well as in the group.",
      ),
    ] satisfies TemplateBlock[],
  },
  {
    id: "workshop",
    title: "Hands-on workshop",
    description:
      "Connect expectations to practice, reflect on the attempt, and plan an application.",
    category: "general",
    blocks: [
      slide(
        "Leave with something you can use",
        "A short workshop rhythm: see an example, try a small task, compare approaches, and plan one application.",
        "Set a concrete task and prepare an example before hosting.",
      ),
      poll("goal", "What would make this workshop useful for you?", [
        "A practical technique",
        "Confidence to start",
        "Feedback on an approach",
        "Examples to adapt",
      ]),
      slide(
        "Try it before perfecting it",
        "Work on the smallest useful version of the task. Note the decision you made and the part you want feedback on.",
        "Give a clear timebox and provide a supported path for people new to the task.",
      ),
      poll("reflection", "What would help you improve your first attempt?", [
        "Another example",
        "More practice time",
        "Feedback from a peer",
        "A clearer success criterion",
      ]),
      scale(
        "How ready are you to use this in your own context?",
        "Need more support",
        "Ready to apply",
      ),
      slide(
        "Make the next attempt concrete",
        "Choose where you will use the technique, when you will try it, and how you will know it helped.",
        "Invite participants to keep a private action note or share one application voluntarily.",
      ),
    ] satisfies TemplateBlock[],
  },
  {
    id: "decision",
    title: "Decision workshop",
    description: "Clarify a decision, compare options, and identify the evidence needed to commit.",
    category: "business",
    blocks: [
      slide(
        "Name the decision",
        "What are we deciding today, who owns the decision, and which constraints must every option meet?",
        "Replace the opening with a specific decision and identify the final decision owner.",
      ),
      poll("criteria", "Which criterion needs the most discussion?", [
        "Impact on the goal",
        "Effort and cost",
        "Risk and reversibility",
        "Time to learn",
      ]),
      slide(
        "Compare options fairly",
        "For each option, state the expected benefit, the key trade-off, and the assumption that could change your view.",
        "Include a practical baseline option. Distinguish evidence from assumptions.",
      ),
      scale(
        "How much evidence do we have to choose a next step?",
        "Major unknowns",
        "Enough to proceed",
      ),
      poll("next", "What is the most useful next move?", [
        "Commit with a review date",
        "Run a small experiment",
        "Gather a missing piece of evidence",
        "Clarify constraints",
      ]),
      slide(
        "Record the rationale",
        "Write the choice, reasons, owner, review date, and the signal that would trigger reconsideration.",
        "Capture disagreement and uncertainty alongside the decision.",
      ),
    ] satisfies TemplateBlock[],
  },
  {
    id: "demo",
    title: "Product demo and feedback",
    description: "Show a realistic workflow and discover where the audience still needs clarity.",
    category: "technical",
    blocks: [
      slide(
        "Follow one real task",
        "Start with the user's goal, show the shortest useful workflow, and explain the result.",
        "Prepare a realistic example and name any important limitations before showing the workflow.",
      ),
      poll("interest", "Which part of this workflow matters most to you?", [
        "Getting started",
        "Completing the core task",
        "Sharing the result",
        "Understanding the outcome",
      ]),
      slide(
        "Show the path and the result",
        "Demonstrate one task from start to finish. Pause at the key decision and show what success looks like.",
        "Use your actual workflow here. Avoid asking the audience to infer the result from a list of features.",
      ),
      scale("How clear is how this would fit your work?", "Not clear", "Very clear"),
      poll("followup", "What would help you evaluate this further?", [
        "A hands-on trial",
        "A relevant example",
        "Setup guidance",
        "Details about limitations",
      ]),
      slide(
        "Agree on a useful follow-up",
        "Record the main unanswered question and a practical next step to resolve it.",
        "Separate feature requests from the underlying task or problem.",
      ),
    ] satisfies TemplateBlock[],
  },
] as const;

export type PresentationTemplateId = (typeof presentationTemplates)[number]["id"];

export function instantiatePresentationTemplate(id: PresentationTemplateId): PresentationDraft {
  const template = presentationTemplates.find((entry) => entry.id === id)!;
  const blocks: readonly TemplateBlock[] = template.blocks;
  const questionIds = new Map(
    blocks
      .filter((block): block is Check => block.kind === "check")
      .map((block) => [block.key, clientUuid()]),
  );
  return PresentationDraftSchema.parse({
    title: template.title,
    description: template.description,
    schemaVersion: 2,
    experiencePreset: {
      id:
        template.category === "business"
          ? "studio"
          : template.category === "technical"
            ? "blueprint"
            : "focus",
      version: 1,
    },
    blocks: blocks.map((block) => {
      if (block.kind === "content") {
        const content: ContentSlideDraft = createContentBlock("title_body");
        return {
          ...content,
          speakerNotes: block.notes,
          textElements: content.textElements.map((element) => ({
            ...element,
            text: element.role === "title" ? block.title : block.body,
          })),
        };
      }
      const scored = block.kind === "check" && block.correct !== null;
      const common = {
        id: block.kind === "check" ? questionIds.get(block.key)! : clientUuid(),
        prompt: block.prompt,
        purpose: scored ? ("diagnostic" as const) : ("opinion" as const),
        confidence: scored ? ("optional" as const) : ("off" as const),
        delivery:
          block.kind === "check" && block.delivery === "recheck"
            ? ("recheck" as const)
            : ("main" as const),
        conceptKeys: scored ? [template.id] : [],
        linkedRecheckQuestionId:
          block.kind === "check" && block.recheck ? questionIds.get(block.recheck)! : null,
        timeLimitSeconds: 30,
        basePoints: scored ? 1_000 : 0,
        explanation:
          block.kind === "check"
            ? block.explanation
            : "Use the labeled scale to identify useful support and next steps.",
        mediaId: null,
        mediaAlt: null,
      };
      const question: QuestionDraft =
        block.kind === "rating"
          ? { ...common, type: "rating", min: 1, max: 5, minLabel: block.low, maxLabel: block.high }
          : {
              ...common,
              type: scored ? "single_select" : "poll",
              choices: block.labels.map((label, index) => ({
                id: clientUuid(),
                label,
                isCorrect: block.correct === index,
              })),
            };
      return { id: clientUuid(), kind: "question", question };
    }),
  });
}
