import { apiFetch, ApiClientError } from "./api";
import {
  ManagementNavigationSchema,
  BusinessOperatorNavigationSchema,
  type ManagementNavigation,
  type BusinessOperatorNavigation,
} from "@openround/contracts";

export type OrganizationNavigationRole = ManagementNavigation["organizations"][number]["role"];
export type OperatorNavigationRole = BusinessOperatorNavigation["operator"]["role"];
export type CustomerManagementNavigation = ManagementNavigation;

export interface ManagementNavigationLink {
  id: string;
  label: string;
  href: string;
}

export interface OperatorManagementNavigation {
  operator: { name: string; role: OperatorNavigationRole } | null;
  links: ManagementNavigationLink[];
}

export const emptyCustomerManagementNavigation: CustomerManagementNavigation = {
  user: null,
  organizationManagementEnabled: false,
  organizations: [],
  operatorConsoleOrigin: null,
};

export const emptyOperatorManagementNavigation: OperatorManagementNavigation = {
  operator: null,
  links: [],
};

export async function fetchCustomerManagementNavigation(signal?: AbortSignal) {
  try {
    const navigation = await apiFetch<unknown>("/v1/auth/navigation", {
      cache: "no-store",
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(8000)])
        : AbortSignal.timeout(8000),
    });
    return ManagementNavigationSchema.parse(navigation);
  } catch (error) {
    // Compatible with product deployments that predate the management endpoints.
    if (error instanceof ApiClientError && error.status === 404) {
      return emptyCustomerManagementNavigation;
    }
    throw error;
  }
}

/** The console may fail independently; its session never determines customer access. */
export async function fetchOperatorManagementNavigation(
  origin: string | null,
  signal?: AbortSignal,
): Promise<OperatorManagementNavigation> {
  if (!origin) return emptyOperatorManagementNavigation;
  try {
    const trustedOrigin = new URL(origin);
    if (
      !["http:", "https:"].includes(trustedOrigin.protocol) ||
      trustedOrigin.origin !== origin ||
      trustedOrigin.username ||
      trustedOrigin.password
    ) {
      return emptyOperatorManagementNavigation;
    }
    const response = await fetch(`${origin}/api/navigation`, {
      credentials: "include",
      cache: "no-store",
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(2500)])
        : AbortSignal.timeout(2500),
    });
    if (!response.ok) return emptyOperatorManagementNavigation;
    const result = BusinessOperatorNavigationSchema.safeParse(await response.json());
    if (!result.success) {
      return emptyOperatorManagementNavigation;
    }
    const navigation = result.data;
    return {
      operator: navigation.operator,
      links: navigation.links.filter((link) => {
        try {
          const target = new URL(link.href);
          return target.origin === origin && !target.username && !target.password;
        } catch {
          return false;
        }
      }),
    };
  } catch {
    return emptyOperatorManagementNavigation;
  }
}

export function customerManagementLinks(
  navigation: CustomerManagementNavigation,
): ManagementNavigationLink[] {
  if (!navigation.user || !navigation.organizationManagementEnabled) return [];
  const links = [{ id: "organization", label: "Organization", href: "/organization" }];
  const managedOrganization = navigation.organizations.find(
    (organization) => organization.role === "owner" || organization.role === "admin",
  );
  const billingOrganization = navigation.organizations.find((organization) =>
    ["owner", "admin", "billing"].includes(organization.role),
  );
  const managementHref = (id: string, section: string) =>
    `/organization?organizationId=${encodeURIComponent(id)}#${section}`;
  if (managedOrganization) {
    links.push(
      {
        id: "workspaces",
        label: "Workspaces",
        href: managementHref(managedOrganization.id, "workspaces"),
      },
      { id: "members", label: "Members", href: managementHref(managedOrganization.id, "members") },
    );
  }
  if (billingOrganization) {
    links.push(
      { id: "billing", label: "Billing", href: managementHref(billingOrganization.id, "billing") },
      {
        id: "credits",
        label: "Event credits",
        href: managementHref(billingOrganization.id, "event-credits"),
      },
    );
  }
  if (managedOrganization) {
    links.push({
      id: "settings",
      label: "Organization settings",
      href: managementHref(managedOrganization.id, "settings"),
    });
  }
  return links;
}

export function operatorNavigationRoleLabel(role: OperatorNavigationRole): string {
  return {
    founder: "Super admin",
    operations: "Operations admin",
    support: "Support admin",
    billing: "Billing admin",
    readonly: "Read-only admin",
  }[role];
}
