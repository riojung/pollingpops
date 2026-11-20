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
  signal?: AbortSignal,
) {
  signal?.throwIfAborted();
  if (role !== "owner") return { collaboration: null, registrations: [] as LtiRegistration[] };
  const organizationUserWorkspace =
    workspace?.accountType === "organization" && workspace.licenseUnit === "user";
  const [collaboration, lti] = await Promise.all([
    organizationUserWorkspace
      ? Promise.resolve(null)
      : signal
        ? apiFetch<WorkspaceCollaboration>("/v1/workspace/members", { signal })
        : apiFetch<WorkspaceCollaboration>("/v1/workspace/members"),
    signal
      ? apiFetch<{ registrations: LtiRegistration[] }>("/v1/workspace/lti-registrations", {
          signal,
        })
      : apiFetch<{ registrations: LtiRegistration[] }>("/v1/workspace/lti-registrations"),
  ]);
  signal?.throwIfAborted();
  return { collaboration, registrations: lti.registrations };
}
