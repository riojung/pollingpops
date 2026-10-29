import type { LtiRegistration, WorkspaceInvitation, WorkspaceMember } from "@openround/contracts";
import type { WorkspaceAccountContext } from "../../components/workspace/workspace-provider";
import { apiFetch } from "../../lib/api";

interface WorkspaceCollaboration {
  members: WorkspaceMember[];
  invitations: WorkspaceInvitation[];
}

export async function loadOwnerSettings(
  role: "owner" | "editor" | "viewer",
  workspace: WorkspaceAccountContext | null,
) {
  if (role !== "owner") return { collaboration: null, registrations: [] as LtiRegistration[] };
  const organizationUserWorkspace =
    workspace?.accountType === "organization" && workspace.licenseUnit === "user";
  const [collaboration, lti] = await Promise.all([
    organizationUserWorkspace
      ? Promise.resolve(null)
      : apiFetch<WorkspaceCollaboration>("/v1/workspace/members"),
    apiFetch<{ registrations: LtiRegistration[] }>("/v1/workspace/lti-registrations"),
  ]);
  return { collaboration, registrations: lti.registrations };
}
