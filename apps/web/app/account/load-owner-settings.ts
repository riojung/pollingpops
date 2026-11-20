import type { LtiRegistration, WorkspaceInvitation, WorkspaceMember } from "@openround/contracts";
import { apiFetch } from "../../lib/api";
import { workspaceSettingsPath } from "./workspace-settings-request";

interface WorkspaceCollaboration {
  members: WorkspaceMember[];
  invitations: WorkspaceInvitation[];
}

export async function loadWorkspaceCollaboration(workspaceId: string, signal: AbortSignal) {
  const collaboration = await apiFetch<WorkspaceCollaboration>(
    workspaceSettingsPath("/v1/workspace/members", workspaceId),
    { signal },
  );
  if (!Array.isArray(collaboration?.members) || !Array.isArray(collaboration?.invitations)) {
    throw new Error("Invalid workspace collaboration response");
  }
  return collaboration;
}

export async function loadLtiRegistrations(workspaceId: string, signal: AbortSignal) {
  const lti = await apiFetch<{ registrations: LtiRegistration[] }>(
    workspaceSettingsPath("/v1/workspace/lti-registrations", workspaceId),
    { signal },
  );
  if (!Array.isArray(lti?.registrations)) throw new Error("Invalid LTI registrations response");
  return lti.registrations;
}
