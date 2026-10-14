import type { HostAction, InterventionType, SessionSnapshot } from "@openround/contracts";

export interface HostPhaseCommand {
  action: HostAction;
  label: string;
  interventionType?: InterventionType;
  recheckMode?: "linked" | "revote";
}

export interface HostPhaseView {
  phaseLabel: string;
  primary: HostPhaseCommand | null;
  secondary: HostPhaseCommand[];
  suggestionKind: "action" | "guidance" | "none";
}

export interface HostCommandController<TResult> {
  view(): HostPhaseView;
  execute(command: HostPhaseCommand): TResult;
}

export class IllegalHostPhaseCommandError extends Error {
  constructor() {
    super("That host action is not legal in the current phase.");
  }
}

function continueCommand(snapshot: SessionSnapshot): HostPhaseCommand {
  return {
    action: "next",
    label:
      snapshot.roundKind !== "main"
        ? "Continue after recheck"
        : (snapshot.questionPosition ?? snapshot.questionIndex) === snapshot.questionCount - 1
          ? "Finish round"
          : "Next question",
  };
}

function suggestedIntervention(snapshot: SessionSnapshot): HostPhaseCommand | null {
  if (!snapshot.insight?.recommendation.strong) return null;
  switch (snapshot.insight.recommendation.action) {
    case "peer_discussion":
      return {
        action: "intervention.start",
        interventionType: "peer_discussion",
        label: "Start peer discussion",
      };
    case "show_example":
      return {
        action: "intervention.start",
        interventionType: "example",
        label: "Work an example",
      };
    case "target_misconception":
    case "explain":
    case "reinforce":
      return {
        action: "intervention.start",
        interventionType: "explain",
        label:
          snapshot.insight.recommendation.action === "reinforce"
            ? "Reinforce the reasoning"
            : "Address the misconception",
      };
    default:
      return null;
  }
}

export function getHostPhaseView(snapshot: SessionSnapshot): HostPhaseView {
  const suggestion = suggestedIntervention(snapshot);
  const guidanceOnly =
    snapshot.insight?.recommendation.action === "wait_or_check_access" ||
    snapshot.insight?.recommendation.action === "continue";

  switch (snapshot.phase) {
    case "lobby":
      return {
        phaseLabel: "Lobby",
        primary: { action: "start", label: "Start round" },
        secondary: [],
        suggestionKind: "none",
      };
    case "question_open":
      return {
        phaseLabel: snapshot.roundKind === "main" ? "Question open" : "Recheck open",
        primary: { action: "lock", label: "Lock answers" },
        secondary: [{ action: "pause", label: "Pause" }],
        suggestionKind: "none",
      };
    case "paused":
      return {
        phaseLabel: "Paused",
        primary: { action: "resume", label: "Resume" },
        secondary: [{ action: "lock", label: "Lock answers" }],
        suggestionKind: "none",
      };
    case "question_locked": {
      const peerDiscussionFinished = Boolean(
        snapshot.intervention?.type === "peer_discussion" && snapshot.intervention.finishedAt,
      );
      const peerDiscussion =
        snapshot.roundKind === "main" &&
        !peerDiscussionFinished &&
        suggestion?.interventionType === "peer_discussion"
          ? suggestion
          : null;
      return {
        phaseLabel: snapshot.roundKind === "main" ? "Diagnose" : "Recheck locked",
        primary: peerDiscussion ?? { action: "reveal", label: "Reveal answer" },
        secondary: peerDiscussion
          ? [{ action: "reveal", label: "Reveal answer" }]
          : snapshot.roundKind === "main" && !peerDiscussionFinished
            ? [
                {
                  action: "intervention.start",
                  interventionType: "peer_discussion",
                  label: "Start peer discussion",
                },
              ]
            : [],
        suggestionKind: peerDiscussion ? "action" : guidanceOnly ? "guidance" : "none",
      };
    }
    case "question_reveal": {
      if (snapshot.roundKind !== "main") {
        return {
          phaseLabel: "Recheck evidence",
          primary: continueCommand(snapshot),
          secondary: [],
          suggestionKind: "none",
        };
      }
      if (snapshot.intervention?.finishedAt) {
        if (snapshot.question?.type === "open_text" || snapshot.question?.type === "word_cloud") {
          return {
            phaseLabel: "Choose the next step",
            primary: continueCommand(snapshot),
            secondary: [],
            suggestionKind: "none",
          };
        }
        return {
          phaseLabel: "Verify recovery",
          primary: snapshot.question?.linkedRecheckAvailable
            ? { action: "recheck.open", label: "Open linked recheck", recheckMode: "linked" }
            : { action: "recheck.open", label: "Recheck by revote", recheckMode: "revote" },
          secondary: [continueCommand(snapshot)],
          suggestionKind: "none",
        };
      }
      const legalSuggestion =
        suggestion?.interventionType === "peer_discussion" ? null : suggestion;
      const interventionOptions: HostPhaseCommand[] = [
        {
          action: "intervention.start",
          interventionType: "explain",
          label: "Explain or reinforce",
        },
        {
          action: "intervention.start",
          interventionType: "example",
          label: "Work an example",
        },
      ];
      const primary = legalSuggestion ?? continueCommand(snapshot);
      const secondary: HostPhaseCommand[] = interventionOptions.filter(
        (item) =>
          item.action !== primary.action || item.interventionType !== primary.interventionType,
      );
      if (snapshot.settings.resultVisibility === "leaderboard") {
        secondary.push({ action: "show_leaderboard", label: "Show standings" });
      }
      if (primary.action !== "next") secondary.push(continueCommand(snapshot));
      return {
        phaseLabel: "Choose the next step",
        primary,
        secondary,
        suggestionKind: legalSuggestion ? "action" : guidanceOnly ? "guidance" : "none",
      };
    }
    case "intervention":
      return {
        phaseLabel: "Intervention in progress",
        primary: { action: "intervention.finish", label: "Finish intervention" },
        secondary: [],
        suggestionKind: "none",
      };
    case "leaderboard":
      return {
        phaseLabel: "Standings",
        primary: continueCommand(snapshot),
        secondary: [],
        suggestionKind: "none",
      };
    case "finished":
      return { phaseLabel: "Complete", primary: null, secondary: [], suggestionKind: "none" };
  }
}

export function sameHostPhaseCommand(left: HostPhaseCommand, right: HostPhaseCommand): boolean {
  return (
    left.action === right.action &&
    left.interventionType === right.interventionType &&
    left.recheckMode === right.recheckMode
  );
}

export function isLegalHostPhaseCommand(view: HostPhaseView, command: HostPhaseCommand): boolean {
  return Boolean(
    (view.primary && sameHostPhaseCommand(view.primary, command)) ||
    view.secondary.some((candidate) => sameHostPhaseCommand(candidate, command)),
  );
}

/**
 * Keeps phase derivation and command legality independent from the command transport.
 * Live sessions provide a Socket.IO executor; Recovery Rehearsal provides an in-memory executor.
 */
export function createHostCommandController<TResult>(options: {
  getSnapshot: () => SessionSnapshot;
  execute: (command: HostPhaseCommand, snapshot: SessionSnapshot) => TResult;
  onIllegal?: (command: HostPhaseCommand, snapshot: SessionSnapshot) => never;
}): HostCommandController<TResult> {
  return {
    view() {
      return getHostPhaseView(options.getSnapshot());
    },
    execute(command) {
      const snapshot = options.getSnapshot();
      if (!isLegalHostPhaseCommand(getHostPhaseView(snapshot), command)) {
        if (options.onIllegal) return options.onIllegal(command, snapshot);
        throw new IllegalHostPhaseCommandError();
      }
      return options.execute(command, snapshot);
    },
  };
}
