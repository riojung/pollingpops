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
import { loadOwnerSettings } from "./load-owner-settings";

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
  const [branding, workspaceList, embedPolicy, policy, identities, oidcStatus, ownerSettings] =
    await Promise.all([
      apiFetch<{ theme: BrandTheme | null; enabled: boolean }>("/v1/account/theme", { signal }),
      apiFetch<{ activeWorkspaceId: string; workspaces: WorkspaceSummary[] }>("/v1/workspaces", {
        signal,
      }),
      apiFetch<{ origins: string[] }>("/v1/account/embed-origins", { signal }),
      apiFetch<WorkspaceInstitutionPolicy>("/v1/workspace/institution-policy", { signal }),
      apiFetch<{ identities: FederatedIdentity[] }>("/v1/auth/federated-identities", { signal }),
      apiFetch<OidcStatus>(
        `/v1/auth/oidc/status?workspaceId=${encodeURIComponent(account.creator.workspaceId)}`,
        { signal },
      ),
      loadOwnerSettings(account.creator.role, account.workspace ?? null, signal),
    ]);
  signal.throwIfAborted();
  return {
    kind: "workspace",
    account,
    branding,
    workspaceList,
    embedPolicy,
    policy,
    identities,
    oidcStatus,
    ownerSettings,
  } as const;
}
