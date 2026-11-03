export type ArtifactType = "round" | "presentation";

export interface HomeSummary {
  generatedAt: string;
  recentArtifacts: Array<{
    id: string;
    artifactType: ArtifactType;
    title: string;
    description: string;
    status: "draft" | "published" | "archived";
    itemCount: number;
    updatedAt: string;
    editHref: string;
    actionHref: string;
    actionLabel: string;
  }>;
  recentSurveys?: HomeSurvey[];
  recentBoards?: HomeBoard[];
  sessions: Array<{
    id: string;
    artifactType: ArtifactType;
    artifactId: string;
    title: string;
    status: "active" | "finished" | "expired";
    phase: string;
    code: string;
    participantCount: number;
    progressLabel: string;
    createdAt: string;
    href: string;
  }>;
  assignments: Array<{
    id: string;
    quizId: string;
    title: string;
    status: "scheduled" | "open";
    checkpointCount: number;
    attemptCount: number;
    completedAttemptCount: number;
    opensAt: string;
    closesAt: string;
    href: string;
  }>;
  resultHighlights: Array<{
    id: string;
    artifactType: ArtifactType;
    title: string;
    status: "pending" | "ready" | "failed";
    participantCount: number;
    accuracyPercent: number | null;
    recoveryPercent: number | null;
    createdAt: string;
    href: string;
  }>;
  groupSchedule: Array<{
    id: string;
    groupId: string;
    groupName: string;
    artifactType: ArtifactType;
    artifactId: string;
    artifactTitle: string;
    kind: "live_session" | "round_assignment";
    scheduledFor: string;
    note: string;
    href: string;
  }>;
  totals: {
    artifacts: number;
    surveys?: number;
    boards?: number;
    activeSessions: number;
    activeAssignments: number;
    upcomingGroupItems: number;
  };
}

export interface HomeSurvey {
  id: string;
  artifactType: "survey";
  title: string;
  description: string;
  status: "draft" | "published" | "archived";
  itemCount: number;
  updatedAt: string | null;
  editHref: string;
  actionHref: string;
  actionLabel: string;
}

export interface HomeBoard {
  id: string;
  artifactType: "idea_board" | "canvas";
  boardType: "team" | "workshop";
  title: string;
  description: string;
  status:
    "draft" | "collecting" | "organizing" | "voting" | "closed" | "active" | "archived" | "frozen";
  itemCount: number | null;
  updatedAt: string | null;
  editHref: string;
  actionHref: string;
  actionLabel: string;
  canEdit: boolean;
  role?: "owner" | "editor" | "facilitator" | "viewer";
}

export type HomeWork = HomeSummary["recentArtifacts"][number] | HomeSurvey | HomeBoard;

export function recentHomeWork(summary: HomeSummary): HomeWork[] {
  return [
    ...summary.recentArtifacts,
    ...(summary.recentSurveys ?? []),
    ...(summary.recentBoards ?? []),
  ]
    .sort((left, right) => {
      const leftTime = left.updatedAt ? Date.parse(left.updatedAt) : 0;
      const rightTime = right.updatedAt ? Date.parse(right.updatedAt) : 0;
      return rightTime - leftTime;
    })
    .slice(0, 6);
}

export function hasHomeWork(summary: HomeSummary): boolean {
  return summary.totals.artifacts > 0 || recentHomeWork(summary).length > 0;
}

export function homeWorkAction(artifact: HomeWork, canEdit: boolean) {
  if (!canEdit || ("canEdit" in artifact && !artifact.canEdit))
    return { href: artifact.editHref, label: "view" as const };
  if (artifact.artifactType === "survey")
    return { href: artifact.actionHref, label: "openSurvey" as const };
  if (artifact.artifactType === "idea_board")
    return { href: artifact.actionHref, label: "openIdeaBoard" as const };
  if (artifact.artifactType === "canvas")
    return { href: artifact.actionHref, label: "openCanvas" as const };
  if (artifact.actionLabel === "Host Round")
    return { href: artifact.actionHref, label: "hostRound" as const };
  if (artifact.actionLabel === "Host Presentation")
    return { href: artifact.actionHref, label: "hostPresentation" as const };
  return { href: artifact.actionHref, label: "continueEditing" as const };
}
