import type { PresentationScenePrototype } from "@openround/contracts";

/** Original, deterministic E00 task material. These are fixtures, not customer evidence. */
export type PresentationSceneFixture = {
  id: string;
  title: string;
  job: string;
  taskInstructions: string[];
  observationChecklist: string[];
  slides: PresentationScenePrototype[];
};

type SlideCopy = {
  title: string;
  body: string;
  notes: string;
};

function createSlide(deckId: string, index: number, copy: SlideCopy): PresentationScenePrototype {
  const id = `${deckId}-slide-${String(index + 1).padStart(2, "0")}`;
  const illustrated = index === 0;
  const nodes: PresentationScenePrototype["nodes"] = [
    {
      id: `${id}-title`,
      type: "text",
      role: "title",
      text: copy.title,
      frame: { x: 7, y: 7, width: 86, height: 18 },
    },
    {
      id: `${id}-body`,
      type: "text",
      role: "body",
      text: copy.body,
      frame: { x: 7, y: 30, width: illustrated ? 50 : 86, height: 58 },
    },
  ];

  if (illustrated) {
    nodes.push(
      {
        id: `${id}-image`,
        type: "image",
        frame: { x: 63, y: 30, width: 30, height: 31 },
        altText: "An illustrative workflow connects a request, clarification, and handoff.",
        asset: { kind: "bundled_fixture", assetId: "workflow-diagram" },
      },
      {
        id: `${id}-shape`,
        type: "shape",
        shape: "rounded_rectangle",
        color: "green",
        frame: { x: 68, y: 73, width: 20, height: 12 },
      },
      {
        id: `${id}-connector`,
        type: "connector",
        from: { nodeId: `${id}-image`, anchor: "bottom" },
        to: { nodeId: `${id}-shape`, anchor: "top" },
        label: "Next step",
        color: "green",
      },
    );
  }

  return {
    artifactType: "presentation_scene_prototype",
    schemaVersion: 1,
    id,
    aspectRatio: "16:9",
    speakerNotes: copy.notes,
    nodes,
    readingOrder: nodes.map((node) => node.id),
  };
}

const observationChecklist = [
  "Record task completion and any facilitator help; do not infer success from a saved flag alone.",
  "Observe text selection, keyboard movement, image selection, and connector behavior.",
  "Compare the edited slide before saving and after reloading; record any lost work.",
  "Check the slide order, notes, and meaning in the phone reading view.",
  "Record elapsed task time only when the task is actually observed, including any repair work.",
];

function createFixture(
  id: string,
  title: string,
  job: string,
  instructions: string[],
  slides: SlideCopy[],
): PresentationSceneFixture {
  return {
    id,
    title,
    job,
    taskInstructions: [
      ...instructions,
      "On the first slide, edit the title and body, move the image and shape, and check the connector endpoints.",
      "Save locally, reload, and verify the edited content, layout, notes, and selected deck survive.",
      "Read the first slide and a later slide in the phone view; check the intended reading order.",
    ],
    observationChecklist: [...observationChecklist],
    slides: slides.map((copy, index) => createSlide(id, index, copy)),
  };
}

export const presentationSceneFixtures: readonly PresentationSceneFixture[] = [
  createFixture(
    "business-pitch",
    "Ten-slide business pitch",
    "Prepare a clear, sendable pitch for a fictional project-handoff product.",
    [
      "Adapt this ten-slide discussion draft for a small-team audience, using the supplied fictional concept.",
      "Keep proposals, assumptions, and evidence gaps visible; do not invent customer results or financial claims.",
    ],
    [
      {
        title: "A calmer project handoff",
        body: "A fictional product concept for small teams.\n\nTurn an incoming request into a clear next step, an owner, and an agreed handoff.",
        notes:
          "Introduce this as an illustrative concept, not an operating company or a claim about measured customer results.",
      },
      {
        title: "The problem to explore",
        body: "A request arrives in one place. Context lives somewhere else. The next person must reconstruct what to do.\n\nWe want to learn where that reconstruction creates avoidable work.",
        notes:
          "Invite a real example from the audience. Distinguish an observed problem from an assumption in this fictional pitch.",
      },
      {
        title: "Start with a small team",
        body: "Initial audience hypothesis: teams that pass client work between a coordinator and a specialist.\n\nThe proposed buyer wants a clear handoff without administering a large project system.",
        notes:
          "This is a proposed audience for discovery, not a validated market-size or willingness-to-pay statement.",
      },
      {
        title: "One shared next step",
        body: "Capture the request. Clarify the expected outcome. Name an owner. Agree what the receiving person needs.\n\nKeep those decisions together when the work changes hands.",
        notes:
          "Explain the proposed experience through one everyday request. Avoid promising automation that this concept does not demonstrate.",
      },
      {
        title: "Show the handoff",
        body: "Request: prepare a client update.\nOutcome: a reviewed summary ready to send.\nOwner: the person drafting it.\nHandoff: the reviewer receives the draft, context, and open questions.",
        notes:
          "Walk through the illustrative request. Ask what the receiving person still needs before they can begin.",
      },
      {
        title: "Design for the working day",
        body: "Use familiar language. Make ownership visible. Keep unresolved questions explicit.\n\nA useful first version should support one complete handoff before adding more workflow machinery.",
        notes:
          "Present these as design principles. Ask which principle matters most for the audience's own work.",
      },
      {
        title: "A bounded first pilot",
        body: "Choose one repeatable request type and a small group of volunteers.\n\nObserve how they prepare, transfer, receive, and revise the work. Keep their existing process available.",
        notes:
          "Agree how the pilot would be observed and who can stop it. No pilot has been conducted for this fixture.",
      },
      {
        title: "What evidence would help?",
        body: "Can the receiving person start without chasing missing context?\nCan the team find the current owner and next step?\nWould they choose the workflow again?\n\nRecord completion, repair work, and unanswered questions.",
        notes:
          "Discuss prospective evaluation questions. Do not read these as achieved outcomes or numerical product claims.",
      },
      {
        title: "Risks and tradeoffs",
        body: "An extra tool can create extra administration. A rigid template can hide useful exceptions. Shared context needs deliberate access control.\n\nTest these risks before broadening the scope.",
        notes:
          "Ask which risk could prevent adoption. Capture a concrete example and the evidence needed to resolve it.",
      },
      {
        title: "The next decision",
        body: "Choose one handoff to investigate, one owner for discovery, and one way to review what we learn.\n\nThe ask today: permission to explore the problem, not a claim that the solution is proven.",
        notes:
          "Close with a clear decision. Record an actual next step only if the audience agrees to it.",
      },
    ],
  ),
  createFixture(
    "product-demo",
    "Five-slide product demo",
    "Explain a fictional request-to-handoff workflow and respond to audience questions.",
    [
      "Adapt this five-slide demo for a colleague who has not seen the fictional workflow before.",
      "Keep the request, the next action, and the handoff understandable without a poll or a scored question.",
    ],
    [
      {
        title: "From request to ready",
        body: "An illustrative product walkthrough.\n\nFollow one request as a team captures the context, clarifies the next step, and prepares a handoff.",
        notes:
          "Say that the workflow is fictional and the slides demonstrate a story rather than an implemented external product.",
      },
      {
        title: "Capture the context",
        body: "A teammate requests a project update.\n\nWrite the intended audience, the question to answer, and the source material in one place. Leave unknowns visible.",
        notes:
          "Ask the audience which context they would need. Use the response to explain why the request remains a draft.",
      },
      {
        title: "Clarify the next action",
        body: "Name the person preparing the update. Agree what a usable draft contains.\n\nWhen a question is unresolved, record who will clarify it rather than silently guessing.",
        notes:
          "Explain the difference between assigning an owner and resolving every open question. Neither is a demonstrated software feature here.",
      },
      {
        title: "Prepare the handoff",
        body: "Give the reviewer the draft, supporting context, and the questions that need a decision.\n\nThe recipient should be able to tell what is ready, what is pending, and what to do next.",
        notes:
          "Pause for questions about exceptions. In the prototype, use ordinary slide navigation; nonlinear navigation is not implied.",
      },
      {
        title: "Choose the next example",
        body: "Which part needs a closer explanation: the request, the next action, or the handoff?\n\nEnd by naming one question the demo answered and one that remains open.",
        notes:
          "Invite a verbal response. This is a presentation fixture and does not include a functioning poll or response collection.",
      },
    ],
  ),
  createFixture(
    "training",
    "Five-slide handoff workshop",
    "Prepare a short training deck that helps a team make project handoffs clearer.",
    [
      "Adapt this five-slide workshop for a new team member using a familiar, non-sensitive example.",
      "Keep the explanation and practice understandable as ordinary slides; response scoring is outside this prototype.",
    ],
    [
      {
        title: "Make the next step clear",
        body: "A short workshop on project handoffs.\n\nPractice passing work with enough context for the next person to begin.",
        notes:
          "Invite participants to think of a routine handoff. Avoid using real client information in the prototype.",
      },
      {
        title: "Notice the missing context",
        body: "A message says: Please finish the update.\n\nWhat is the update for? What is already complete? Who needs it next? Which questions are still open?",
        notes:
          "Ask for examples of missing information. Accept different answers; this fixture has no submitted or scored response.",
      },
      {
        title: "Build a usable handoff",
        body: "State the expected outcome. Name the current owner. Link the relevant context. Identify the next recipient and open questions.\n\nUse plain language the recipient can act on.",
        notes:
          "Model a brief handoff with the group. Treat the checklist as a starting point that can be adapted to the team's work.",
      },
      {
        title: "Try a fresh example",
        body: "A teammate must review an event announcement before it is shared.\n\nDescribe the intended audience, the draft's status, the decision needed, and the next action. Then compare with a partner.",
        notes:
          "Let participants try without copying the previous example. Observe the reasoning and ask what context is still missing.",
      },
      {
        title: "Take one practice forward",
        body: "Choose one handoff you expect to make. Write the outcome, owner, context, recipient, and open questions.\n\nAsk the recipient whether they have what they need to begin.",
        notes:
          "Close with a practical next step. This exercise is not evidence of measured learning or a promise of improved outcomes.",
      },
    ],
  ),
];

export function getPresentationSceneFixture(id: string): PresentationSceneFixture | undefined {
  return presentationSceneFixtures.find((fixture) => fixture.id === id);
}
