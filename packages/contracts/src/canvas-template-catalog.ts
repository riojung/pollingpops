/** Original, manually authored starters. This module deliberately has no schema dependencies. */
export const CANVAS_TEMPLATE_IDS = [
  "possibility-map",
  "experience-retro",
  "project-kickoff",
  "decision-paths",
  "evidence-review",
  "learning-reflection",
  "next-step-studio",
  "flow-to-action",
] as const;
export type CanvasTemplateId = (typeof CANVAS_TEMPLATE_IDS)[number];
export type CanvasTemplateCategory = "brainstorm" | "retro" | "project" | "decision" | "learning";

export interface CanvasTemplateSection {
  title: string;
  guidance: string;
  prompts: readonly [string, string];
  color: "yellow" | "blue" | "green" | "pink" | "purple";
}
export interface CanvasTemplate {
  id: CanvasTemplateId;
  category: CanvasTemplateCategory;
  language: "en";
  title: string;
  description: string;
  prompt: string;
  sections: readonly CanvasTemplateSection[];
  workshop: {
    identityMode: "anonymous" | "alias";
    moderationEnabled: boolean;
    ideasVisible: boolean;
    voteBudget: number;
    windowDays: number;
  };
}
const workshop = {
  identityMode: "anonymous",
  moderationEnabled: true,
  ideasVisible: false,
  voteBudget: 3,
  windowDays: 7,
} as const;

export const CANVAS_TEMPLATES: readonly CanvasTemplate[] = [
  {
    id: "possibility-map",
    category: "brainstorm",
    language: "en",
    title: "Possibility map",
    description: "Explore a challenge, open up possibilities, and choose a small experiment.",
    prompt: "What could we try to make this challenge easier for the people affected?",
    workshop,
    sections: [
      {
        title: "Name the challenge",
        guidance: "Start with a need, not a solution.",
        prompts: ["Who needs something to change?", "What is difficult for them today?"],
        color: "blue",
      },
      {
        title: "Open possibilities",
        guidance: "Explore different approaches before choosing.",
        prompts: ["What is one small possibility?", "What could we try with fewer constraints?"],
        color: "yellow",
      },
      {
        title: "Try and learn",
        guidance: "Choose a reversible experiment and a learning signal.",
        prompts: ["What can we test first?", "What would tell us whether it helped?"],
        color: "green",
      },
    ],
  },
  {
    id: "experience-retro",
    category: "retro",
    language: "en",
    title: "Experience retrospective",
    description: "Reflect on a shared experience and agree on one practical improvement.",
    prompt:
      "Thinking about our recent work, what helped, what got in the way, and what should we change?",
    workshop,
    sections: [
      {
        title: "Helped us",
        guidance: "Describe useful actions and the conditions that enabled them.",
        prompts: ["What made progress easier?", "What should we keep doing?"],
        color: "green",
      },
      {
        title: "Got in the way",
        guidance: "Focus on situations and effects rather than blame.",
        prompts: ["Where did work become difficult?", "What need went unmet?"],
        color: "pink",
      },
      {
        title: "Change next time",
        guidance: "Choose a change that the team can actually try.",
        prompts: ["What is one change within our control?", "Who will help us check its effect?"],
        color: "blue",
      },
    ],
  },
  {
    id: "project-kickoff",
    category: "project",
    language: "en",
    title: "Project kickoff",
    description: "Align on purpose, people, unknowns, and the first useful milestone.",
    prompt: "What must we understand together to begin this project well?",
    workshop,
    sections: [
      {
        title: "Purpose",
        guidance: "Describe the difference this work should make.",
        prompts: ["Who should benefit?", "What outcome would be useful?"],
        color: "blue",
      },
      {
        title: "People and roles",
        guidance: "Make participation and decisions explicit.",
        prompts: ["Whose perspective do we need?", "Who can make which decisions?"],
        color: "purple",
      },
      {
        title: "Unknowns",
        guidance: "Separate questions from assumptions.",
        prompts: ["What are we assuming?", "What should we find out early?"],
        color: "yellow",
      },
      {
        title: "First milestone",
        guidance: "Aim for a small piece of observable progress.",
        prompts: ["What can we complete first?", "How and when will we review it?"],
        color: "green",
      },
    ],
  },
  {
    id: "decision-paths",
    category: "decision",
    language: "en",
    title: "Decision paths",
    description: "Make a decision explicit, compare options, and record how to revisit it.",
    prompt:
      "Which option best meets our needs, and what evidence or tradeoffs should guide the decision?",
    workshop,
    sections: [
      {
        title: "Decision and needs",
        guidance: "Define the choice and the criteria before comparing options.",
        prompts: ["What decision do we need to make?", "What must a useful option satisfy?"],
        color: "blue",
      },
      {
        title: "Options and tradeoffs",
        guidance: "Consider more than one path and its consequences.",
        prompts: ["What options are available?", "What do we gain or give up with each?"],
        color: "yellow",
      },
      {
        title: "Commit and revisit",
        guidance: "Record the decision, its owner, and a review trigger.",
        prompts: [
          "What will we choose, and why?",
          "What new information would make us revisit it?",
        ],
        color: "green",
      },
    ],
  },
  {
    id: "evidence-review",
    category: "decision",
    language: "en",
    title: "Evidence review",
    description: "Separate observations, interpretations, and questions before acting.",
    prompt: "What have we observed, what might it mean, and what should we investigate next?",
    workshop,
    sections: [
      {
        title: "Observed",
        guidance: "Record what happened without adding an explanation yet.",
        prompts: ["What did we see or hear?", "What is the source and context?"],
        color: "blue",
      },
      {
        title: "Possible meanings",
        guidance: "Offer interpretations while keeping uncertainty visible.",
        prompts: ["What might explain this?", "What is another plausible explanation?"],
        color: "purple",
      },
      {
        title: "Questions to test",
        guidance: "Choose questions that could change the next decision.",
        prompts: ["What do we still need to know?", "How could we check it?"],
        color: "yellow",
      },
    ],
  },
  {
    id: "learning-reflection",
    category: "learning",
    language: "en",
    title: "Learning reflection",
    description: "Connect a learning experience to a question and a concrete next use.",
    prompt:
      "What did this experience change in your understanding, and how could you use that learning?",
    workshop,
    sections: [
      {
        title: "Notice",
        guidance: "Recall a moment, example, or idea that stood out.",
        prompts: ["What caught your attention?", "What surprised you?"],
        color: "yellow",
      },
      {
        title: "Make sense",
        guidance: "Connect the experience with what you already know.",
        prompts: ["How has your thinking changed?", "What question remains?"],
        color: "blue",
      },
      {
        title: "Use it",
        guidance: "Choose a context where the learning could be useful.",
        prompts: ["Where could you try this?", "What support or practice would help?"],
        color: "green",
      },
    ],
  },
  {
    id: "next-step-studio",
    category: "project",
    language: "en",
    title: "Next-step studio",
    description: "Turn a shared aim into small actions, support needs, and a check-in.",
    prompt: "What is a useful next step toward our shared aim, and what will help it happen?",
    workshop,
    sections: [
      {
        title: "Shared aim",
        guidance: "Keep the intended change visible while planning.",
        prompts: ["What are we working toward?", "What progress would matter now?"],
        color: "purple",
      },
      {
        title: "Small actions",
        guidance: "Describe a step small enough to begin.",
        prompts: ["What is the next observable action?", "Who will take it, and by when?"],
        color: "yellow",
      },
      {
        title: "Support and check-in",
        guidance: "Make dependencies and follow-up explicit.",
        prompts: ["What help or agreement is needed?", "When will we share what we learned?"],
        color: "green",
      },
    ],
  },
  {
    id: "flow-to-action",
    category: "decision",
    language: "en",
    title: "Flow to action",
    description: "Map an input, a review and a decision into a clear next action.",
    prompt: "What information enters this process, what decision is needed, and what happens next?",
    workshop,
    sections: [
      {
        title: "Start with information",
        guidance: "Name the input and the review that makes it useful.",
        prompts: ["What starts this process?", "What information needs review?"],
        color: "blue",
      },
      {
        title: "Make the decision clear",
        guidance: "Write a question with distinct routes, then label each connection.",
        prompts: ["What must be true to continue?", "What happens if it is not ready?"],
        color: "yellow",
      },
      {
        title: "Choose a next action",
        guidance: "Give each route a practical next step and check it with the people involved.",
        prompts: ["Who takes the next action?", "Where do we gather missing information?"],
        color: "green",
      },
    ],
  },
];

export function getCanvasTemplate(id: CanvasTemplateId): CanvasTemplate {
  const template = CANVAS_TEMPLATES.find((entry) => entry.id === id);
  if (!template) throw new Error("Unknown canvas template");
  return template;
}
