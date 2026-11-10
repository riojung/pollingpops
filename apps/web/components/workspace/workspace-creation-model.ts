import type { WorkspaceProductFeatures } from "@openround/contracts";

export type WorkspaceCreationKind = "round" | "presentation" | "survey" | "ideaBoard";
export interface WorkspaceCreationOption {
  kind: WorkspaceCreationKind;
  href: string;
}

export type WorkspaceCreationGoal = {
  kind: "poll" | "quiz" | "presentation" | "round";
  href: string;
};

/** First-session goals use the same role and feature grants as the full creation launcher. */
export function workspaceCreationGoals(
  input: Parameters<typeof workspaceCreationOptions>[0],
): WorkspaceCreationGoal[] {
  const available = workspaceCreationOptions(input);
  const goals: WorkspaceCreationGoal[] = [];
  const round = available.find((option) => option.kind === "round");
  if (round) {
    if (input.productFeatures?.builderV2)
      goals.push(
        { kind: "poll", href: "/create?type=poll" },
        { kind: "quiz", href: "/create?type=quiz" },
      );
    else goals.push({ kind: "round", href: round.href });
  }
  if (available.some((option) => option.kind === "presentation"))
    goals.push({ kind: "presentation", href: "/create/presentation" });
  return goals;
}

/** Account-resolved feature grants and workspace role are the source of UI availability. */
export function workspaceCreationOptions({
  canEdit,
  productFeatures,
}: {
  canEdit: boolean;
  productFeatures: WorkspaceProductFeatures | null | undefined;
}): WorkspaceCreationOption[] {
  if (!canEdit || !productFeatures) return [];
  const options: WorkspaceCreationOption[] = [
    { kind: "round", href: productFeatures.builderV2 ? "/create?product=round" : "/dashboard" },
  ];
  if (productFeatures.presentations)
    options.push({ kind: "presentation", href: "/create/presentation" });
  if (productFeatures.surveys) options.push({ kind: "survey", href: "/surveys/new" });
  if (productFeatures.ideaBoards || productFeatures.canvasBoards)
    options.push({ kind: "ideaBoard", href: "/boards?create=1" });
  return options;
}
