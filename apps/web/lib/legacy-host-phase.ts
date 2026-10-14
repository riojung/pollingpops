import type { HostAction, InterventionType, SessionSnapshot } from "@openround/contracts";

export interface LegacyHostCommand {
  action: HostAction;
  label: string;
  className: "button" | "button-quiet";
  interventionType?: InterventionType;
  recheckMode?: "linked" | "revote";
}

function nextLabel(snapshot: SessionSnapshot) {
  if (snapshot.roundKind !== "main") return "Continue after recheck";
  return (snapshot.questionPosition ?? snapshot.questionIndex) === snapshot.questionCount - 1
    ? "Finish round"
    : "Next checkpoint";
}

export function getLegacyPhaseActions(snapshot: SessionSnapshot): LegacyHostCommand[] {
  switch (snapshot.phase) {
    case "lobby":
      return [{ action: "start", label: "Start round", className: "button" }];
    case "question_open":
      return [
        { action: "pause", label: "Pause", className: "button-quiet" },
        { action: "lock", label: "Lock answers", className: "button" },
      ];
    case "paused":
      return [
        { action: "resume", label: "Resume", className: "button" },
        { action: "lock", label: "Lock answers", className: "button-quiet" },
      ];
    case "question_locked":
      return [{ action: "reveal", label: "Reveal answer", className: "button" }];
    case "question_reveal":
      return [
        { action: "show_leaderboard", label: "Show standings", className: "button-quiet" },
        { action: "next", label: nextLabel(snapshot), className: "button" },
      ];
    case "intervention":
      return [
        {
          action: "intervention.finish",
          label: "Finish intervention",
          className: "button",
        },
      ];
    case "leaderboard":
      return [{ action: "next", label: nextLabel(snapshot), className: "button" }];
    default:
      return [];
  }
}

export function getLegacyRecoveryActions(snapshot: SessionSnapshot): LegacyHostCommand[] {
  if (snapshot.roundKind !== "main") return [];
  const textOpinion =
    snapshot.question?.type === "open_text" || snapshot.question?.type === "word_cloud";

  if (snapshot.phase === "question_locked") {
    const actions: LegacyHostCommand[] = [
      {
        action: "intervention.start",
        label: "Start peer discussion",
        className: "button-quiet",
        interventionType: "peer_discussion",
      },
      {
        action: "recheck.open",
        label: "Reopen as revote",
        className: "button-quiet",
        recheckMode: "revote",
      },
      ...(snapshot.question?.linkedRecheckAvailable
        ? ([
            {
              action: "recheck.open",
              label: "Open linked recheck",
              className: "button-quiet",
              recheckMode: "linked",
            },
          ] satisfies LegacyHostCommand[])
        : []),
    ];
    return textOpinion ? actions.filter((command) => command.action !== "recheck.open") : actions;
  }

  if (snapshot.phase === "question_reveal") {
    const actions: LegacyHostCommand[] = [
      {
        action: "intervention.start",
        label: "Record explanation",
        className: "button-quiet",
        interventionType: "explain",
      },
      {
        action: "intervention.start",
        label: "Work an example",
        className: "button-quiet",
        interventionType: "example",
      },
      {
        action: "recheck.open",
        label: "Recheck by revote",
        className: "button-quiet",
        recheckMode: "revote",
      },
      ...(snapshot.question?.linkedRecheckAvailable
        ? ([
            {
              action: "recheck.open",
              label: "Open linked recheck",
              className: "button",
              recheckMode: "linked",
            },
          ] satisfies LegacyHostCommand[])
        : []),
    ];
    return textOpinion ? actions.filter((command) => command.action !== "recheck.open") : actions;
  }

  return [];
}
