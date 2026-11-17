import type { LibraryShareSummary } from "../../components/workspace/library-sharing/client";
export const groupPurposes = [
  "team",
  "department",
  "project",
  "cohort",
  "community",
  "other",
] as const;
export type GroupPurpose = (typeof groupPurposes)[number];
export type GroupScope = "workspace" | "organization";
export interface GroupCapabilities {
  manageMembers: boolean;
  shareContent: boolean;
  postMessage: boolean;
  schedule: boolean;
  manageGroup: boolean;
}
export interface GroupsContext {
  organizationId: string | null;
  organizationName: string | null;
  canCreateOrganizationGroup: boolean;
  canCreateWorkspaceGroup: boolean;
}
export interface GroupFilters {
  scope: "all" | GroupScope;
  purpose: "all" | GroupPurpose;
  access: "all" | "owner" | "member";
  status: "all" | "active" | "archived";
  search: string;
  sort: "updated" | "name";
}
export const defaultGroupFilters: GroupFilters = {
  scope: "all",
  purpose: "all",
  access: "all",
  status: "active",
  search: "",
  sort: "updated",
};
export type ArtifactType = "round" | "presentation" | "idea_board";

export interface GroupSummary {
  id: string;
  name: string;
  description: string;
  role: "owner" | "member";
  scope: GroupScope;
  scopeName: string;
  organizationId?: string | null;
  workspaceId?: string | null;
  purpose: GroupPurpose;
  status: "active" | "archived";
  capabilities: GroupCapabilities;
  memberCount: number;
  artifactCount: number;
  upcomingCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface GroupMember {
  userId: string;
  email: string;
  role: "owner" | "member";
  workspaceRole: "owner" | "editor" | "viewer" | null;
  joinedAt: string;
}

export interface AvailableMember {
  userId: string;
  email: string;
  role?: "owner" | "editor" | "viewer";
  joinedAt?: string | null;
}

export interface GroupArtifact {
  id: string;
  artifactType: ArtifactType;
  artifactId: string;
  title: string;
  status: "draft" | "published" | "archived" | "collecting" | "voting" | "closed";
  published: boolean;
  editHref: string;
  hostHref: string;
  assignHref: string | null;
  createdAt: string;
}

export interface GroupMessage {
  id: string;
  authorId: string | null;
  authorEmail: string;
  body: string;
  createdAt: string;
}

export interface GroupScheduleItem {
  id: string;
  artifactType: ArtifactType;
  artifactId: string;
  artifactTitle: string;
  kind: "live_session" | "round_assignment";
  scheduledFor: string;
  note: string;
  createdAt: string;
}

export interface GroupDetail extends GroupSummary {
  sharedLibrary?: LibraryShareSummary[];
  members: GroupMember[];
  availableMembers: AvailableMember[];
  artifacts: GroupArtifact[];
  messages: GroupMessage[];
  schedule: GroupScheduleItem[];
  canvasBoards?: Array<{
    id: string;
    title: string;
    boardType: "team" | "workshop";
    status: "active" | "archived" | "frozen" | "closed";
    role: "owner" | "editor" | "viewer" | "facilitator";
    workspaceId: string;
    expiresAt: string;
  }>;
}

export interface LibraryArtifact {
  id: string;
  title: string;
  status: "draft" | "published" | "archived";
  currentVersionId: string | null;
}

export function formatDateTime(locale: string, value: string) {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export function artifactKey(type: ArtifactType, id: string) {
  return `${type}:${id}`;
}

export function readArtifactKey(
  value: string,
): { artifactType: ArtifactType; artifactId: string } | null {
  const divider = value.indexOf(":");
  if (divider < 0) return null;
  const artifactType = value.slice(0, divider);
  const artifactId = value.slice(divider + 1);
  if (!["round", "presentation", "idea_board"].includes(artifactType) || !artifactId) return null;
  return { artifactType: artifactType as ArtifactType, artifactId };
}

export function filterGroups(groups: GroupSummary[], filters: GroupFilters, locale: string) {
  const query = filters.search.trim().toLocaleLowerCase(locale);
  return groups
    .filter(
      (group) =>
        (filters.scope === "all" || group.scope === filters.scope) &&
        (filters.purpose === "all" || group.purpose === filters.purpose) &&
        (filters.access === "all" || group.role === filters.access) &&
        (filters.status === "all" || group.status === filters.status) &&
        (!query ||
          [group.name, group.description, group.scopeName].some((value) =>
            value.toLocaleLowerCase(locale).includes(query),
          )),
    )
    .sort((left, right) =>
      filters.sort === "name"
        ? left.name.localeCompare(right.name, locale)
        : Date.parse(right.updatedAt) - Date.parse(left.updatedAt) ||
          left.name.localeCompare(right.name, locale),
    );
}

export function resolveGroupCapabilities(
  group: Pick<GroupSummary, "scope" | "role" | "status"> & { capabilities?: GroupCapabilities },
  canEditWorkspace: boolean,
  ownsWorkspace: boolean,
): GroupCapabilities {
  if (group.capabilities) return group.capabilities;
  // An absent organization capability response must never inherit local workspace authority.
  if (group.scope === "organization" || group.status === "archived")
    return {
      manageMembers: false,
      shareContent: false,
      postMessage: false,
      schedule: false,
      manageGroup: false,
    };
  return {
    manageMembers: canEditWorkspace && (group.role === "owner" || ownsWorkspace),
    shareContent: canEditWorkspace,
    postMessage: true,
    schedule: canEditWorkspace,
    manageGroup: false,
  };
}
