import type { WorkspaceProductFeatures } from "@openround/contracts";

export type WorkspaceCreationKind = "round" | "presentation" | "survey" | "ideaBoard";
export interface WorkspaceCreationOption {
  kind: WorkspaceCreationKind;
  href: string;
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
