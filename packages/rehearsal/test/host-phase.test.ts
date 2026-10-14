import {
  deriveRoundProtocol,
  SessionSnapshotSchema,
  type QuestionDraft,
  type QuizDraft,
} from "@openround/contracts";
import { applyHostCommand, createGameState, snapshotForRole } from "@openround/game-engine";
import { describe, expect, it } from "vitest";
import {
  createHostCommandController,
  isLegalHostPhaseCommand,
  type HostPhaseCommand,
} from "../src/index.js";

function id(value: number) {
  return `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
}

function assessedQuestion(value: number): QuestionDraft {
  return {
    id: id(value),
    type: "single_select",
    prompt: "Which response fits the example?",
    choices: [
      { id: id(value + 1), label: "A", isCorrect: true },
      { id: id(value + 2), label: "B", isCorrect: false },
    ],
    timeLimitSeconds: 20,
    basePoints: 1_000,
    explanation: "",
    mediaId: null,
    mediaAlt: null,
  };
}

function controllerFor(quiz: QuizDraft, resultVisibility: "private" | "leaderboard") {
  let sequence = 100;
  let state = createGameState({
    sessionId: id(90),
    code: "1234567",
    quiz,
    roundProtocol: deriveRoundProtocol(quiz),
    settings: {
      audienceLimit: 20,
      scoringMode: "accuracy",
      resultVisibility,
      nicknamePolicy: "friendly_only",
      allowLateJoin: true,
    },
  });
  const snapshot = () => SessionSnapshotSchema.parse(snapshotForRole(state, { role: "host" }));
  const controller = createHostCommandController({
    getSnapshot: snapshot,
    execute(command) {
      state = applyHostCommand(state, {
        action: command.action,
        interventionType: command.interventionType,
        recheckMode: command.recheckMode,
        commandId: id(sequence++),
        expectedVersion: state.version,
        nowMs: sequence * 1_000,
        newRoundId: () => id(sequence++),
      }).state;
      return snapshot();
    },
  });
  const primary = () => {
    const command = controller.view().primary;
    expect(command).not.toBeNull();
    return controller.execute(command!);
  };
  return { controller, primary, snapshot };
}

describe("live text host commands", () => {
  for (const type of ["open_text", "word_cloud"] as const) {
    for (const resultVisibility of ["private", "leaderboard"] as const) {
      for (const lastQuestion of [false, true]) {
        it.each(["explain", "example", "peer_discussion"] as const)(
          `${type} ${resultVisibility} ${lastQuestion ? "finishes" : "advances"} after %s`,
          (interventionType) => {
            const recheck = { ...assessedQuestion(20), delivery: "recheck" as const };
            const question: QuestionDraft = {
              id: id(30),
              type,
              prompt: "What should happen next?",
              timeLimitSeconds: 20,
              basePoints: 0,
              explanation: "",
              mediaId: null,
              mediaAlt: null,
            };
            const { controller, primary, snapshot } = controllerFor(
              {
                title: "Synthetic host workflow",
                description: "",
                questions: [
                  { ...assessedQuestion(10), linkedRecheckQuestionId: recheck.id },
                  recheck,
                  question,
                  ...(lastQuestion ? [] : [assessedQuestion(40)]),
                ],
              },
              resultVisibility,
            );
            primary(); // Start the first main checkpoint.
            primary(); // Lock it.
            primary(); // Reveal it.
            primary(); // Advance past the authored recheck to the text checkpoint.
            expect(snapshot()).toMatchObject({
              questionIndex: 2,
              questionPosition: 1,
              questionCount: lastQuestion ? 2 : 3,
              question: { type },
            });
            primary(); // Lock text responses.
            if (interventionType !== "peer_discussion") primary(); // Reveal before Explain/Example.
            const intervention = controller
              .view()
              .secondary.find((command) => command.interventionType === interventionType);
            expect(intervention).toBeDefined();
            controller.execute(intervention!);
            expect(snapshot().phase).toBe("intervention");
            primary(); // Finish the legal intervention.
            if (interventionType === "peer_discussion") {
              expect(controller.view().primary?.action).toBe("reveal");
              primary();
            }

            const view = controller.view();
            expect(view).toMatchObject({
              phaseLabel: "Choose the next step",
              primary: { action: "next", label: lastQuestion ? "Finish round" : "Next question" },
              secondary: [],
              suggestionKind: "none",
            });
            for (const recheckMode of ["linked", "revote"] as const) {
              const command: HostPhaseCommand = {
                action: "recheck.open",
                label: "Recheck",
                recheckMode,
              };
              expect(isLegalHostPhaseCommand(view, command)).toBe(false);
              expect(() => controller.execute(command)).toThrow(
                "That host action is not legal in the current phase.",
              );
            }
            const continued = primary();
            expect(continued.phase).toBe(lastQuestion ? "finished" : "question_open");
            if (!lastQuestion) expect(continued.question?.id).toBe(id(40));
          },
        );
      }
    }
  }
});
