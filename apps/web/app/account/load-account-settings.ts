import type {
  BrandTheme,
  Entitlements,
  FederatedIdentity,
  OidcStatus,
  WorkspaceInstitutionPolicy,
  WorkspaceSummary,
} from "@openround/contracts";
import type { WorkspaceAccountContext } from "../../components/workspace/workspace-provider";
import { apiFetch } from "../../lib/api";
import { workspaceSettingsPath } from "./workspace-settings-request";

export interface AccountCreator {
  userId: string;
  workspaceId: string;
  email: string;
  segment: "education" | "workplace";
  role: "owner" | "editor" | "viewer";
  plan: "free" | "pro" | "team";
}

interface AccountResponse {
  creator: AccountCreator;
  workspace?: WorkspaceAccountContext;
  entitlements: Entitlements;
  businessManagementEnabled?: boolean;
  productFeatures?: { uxBeta?: boolean; workspaceShell?: boolean };
}

interface UserResponse {
  user: { userId: string; email: string };
  businessManagementEnabled: boolean;
}

export async function loadAccountSettings(signal: AbortSignal) {
  signal.throwIfAborted();
  let account: AccountResponse;
  try {
    account = await apiFetch<AccountResponse>("/v1/auth/me", { signal });
  } catch (caught) {
    signal.throwIfAborted();
    if ((caught as { status?: number }).status !== 401) throw caught;
    // Only the account authority can establish that a sign-in lacks workspace access.
    // A peripheral settings failure must never become a successful billing-only account.
    try {
      const identity = await apiFetch<UserResponse>("/v1/auth/user", { signal });
      signal.throwIfAborted();
      return { kind: "billing-only", identity } as const;
    } catch (identityError) {
      signal.throwIfAborted();
      if ((identityError as { status?: number }).status === 401)
        return { kind: "unauthenticated" } as const;
      throw identityError;
    }
  }
  signal.throwIfAborted();
  const { workspaceId } = account.creator;
  const [branding, workspaceList, embedPolicy, policy, identities, oidcStatus] = await Promise.all([
    apiFetch<{ theme: BrandTheme | null; enabled: boolean }>(
      workspaceSettingsPath("/v1/account/theme", workspaceId),
      { signal },
    ),
    apiFetch<{ activeWorkspaceId: string | null; workspaces: WorkspaceSummary[] }>(
      "/v1/workspaces",
      {
        signal,
      },
    ),
    apiFetch<{ origins: string[] }>(
      workspaceSettingsPath("/v1/account/embed-origins", workspaceId),
      {
        signal,
      },
    ),
    apiFetch<WorkspaceInstitutionPolicy>(
      workspaceSettingsPath("/v1/workspace/institution-policy", workspaceId),
      { signal },
    ),
    apiFetch<{ identities: FederatedIdentity[] }>(
      workspaceSettingsPath("/v1/auth/federated-identities", workspaceId),
      { signal },
    ),
    apiFetch<OidcStatus>(`/v1/auth/oidc/status?workspaceId=${encodeURIComponent(workspaceId)}`, {
      signal,
    }),
  ]);
  signal.throwIfAborted();
  if (workspaceList.activeWorkspaceId !== workspaceId) {
    throw new Error("The active workspace changed");
  }
  return {
    kind: "workspace",
    account,
    branding,
    workspaceList,
    embedPolicy,
    policy,
    identities,
    oidcStatus,
  } as const;
}
