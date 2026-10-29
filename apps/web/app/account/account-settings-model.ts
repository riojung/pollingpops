import type { WorkspaceAccountContext } from "../../components/workspace/workspace-provider";

export const settingsSections = [
  "overview",
  "people",
  "appearance",
  "plan",
  "security",
  "data",
] as const;
export type SettingsSection = (typeof settingsSections)[number];

export function accountPermissions(
  workspace: WorkspaceAccountContext | null,
  role: "owner" | "editor" | "viewer" | undefined,
) {
  return (
    workspace?.permissions ?? {
      manageWorkspace: role === "owner",
      managePeople: role === "owner",
      manageBilling: role === "owner",
      manageIntegrations: role === "owner",
    }
  );
}

export function visibleSettingsSections(
  workspace: WorkspaceAccountContext | null,
  role: "owner" | "editor" | "viewer" | undefined,
): SettingsSection[] {
  const permissions = accountPermissions(workspace, role);
  return settingsSections.filter((section) =>
    section === "people"
      ? permissions.managePeople
      : section === "appearance"
        ? permissions.manageWorkspace
        : section === "security"
          ? permissions.manageIntegrations
          : true,
  );
}

export function selectedSettingsSection(
  value: string,
  available: readonly SettingsSection[],
): SettingsSection {
  const candidate = value.replace(/^#/, "");
  return available.find((section) => section === candidate) ?? "overview";
}

export function organizationSettingsHref(
  workspace: WorkspaceAccountContext | null,
  section: "members" | "billing",
) {
  return workspace?.organization
    ? `/organization?organizationId=${encodeURIComponent(workspace.organization.id)}#${section}`
    : "/organization";
}

export function canManagePersonalBilling(
  workspace: WorkspaceAccountContext | null,
  role: "owner" | "editor" | "viewer" | undefined,
): boolean {
  return (
    (workspace ? workspace.permissions?.manageBilling === true : role === "owner") &&
    workspace?.accountType !== "organization" &&
    !workspace?.organization &&
    workspace?.planSource !== "community"
  );
}

export interface PersonalBillingProfile {
  customerId: string | null;
  subscriptionId: string | null;
  status: string;
}

export type PersonalBillingState =
  { state: "loading" } | { state: "error" } | { state: "ready"; billing: PersonalBillingProfile };

export function personalBillingAction(
  workspace: WorkspaceAccountContext | null,
  role: "owner" | "editor" | "viewer" | undefined,
  plan: "free" | "pro" | "team" | undefined,
  billingState: PersonalBillingState,
): "checkout" | "portal" | null {
  if (!canManagePersonalBilling(workspace, role) || billingState.state !== "ready") return null;
  const billing = billingState.billing;
  const canStartSubscription =
    ["canceled", "incomplete_expired"].includes(billing.status) ||
    (billing.status === "free" && billing.subscriptionId === null);
  // Access can become Free after a payment grace period while the subscription
  // still exists. Existing subscribers must recover or cancel in the portal.
  if (!canStartSubscription) return billing.customerId ? "portal" : null;
  if (plan === "free") return "checkout";
  return billing.customerId && (plan === "pro" || plan === "team") ? "portal" : null;
}

export const workspaceThemePresets = [
  { id: "pop", primaryColor: "#39243C", accentColor: "#AC2855" },
  { id: "ocean", primaryColor: "#17334A", accentColor: "#006B80" },
  { id: "forest", primaryColor: "#183C31", accentColor: "#176B50" },
] as const;
