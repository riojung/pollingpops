export type OrganizationRole = "owner" | "admin" | "billing" | "member";
export interface Organization {
  id: string;
  name: string;
  status: string;
  role: OrganizationRole;
}
export interface OrganizationWorkspace {
  id: string;
  name: string;
  segment: "education" | "workplace";
  ownerId: string;
  eligibleOwnerIds?: string[];
  status: string;
}
export interface OrganizationMember {
  userId: string;
  email: string | null;
  role: OrganizationRole;
}
export interface OrganizationInvitation {
  id: string;
  email: string;
  role: OrganizationRole;
  expiresAt: string;
  acceptedAt: string | null;
  revokedAt: string | null;
}
export interface Subscription {
  status: string;
  licenseQuantity: number;
  customerId: string | null;
  subscriptionId: string | null;
  paidThrough: string | null;
  graceUntil: string | null;
}
export interface LicenseAssignment {
  workspaceId: string;
  assignedAt: string;
}
export interface CreditBalance {
  balance: number;
  reserved: number;
  available: number;
}
export interface BillingView {
  subscription: Subscription;
  assignments: LicenseAssignment[];
  balance: CreditBalance;
  mode: "disabled" | "stripe";
  eventCreditsEnabled: boolean;
  commercialHold?: { held: boolean; reason: string } | null;
  purchases?: Array<{
    id: string;
    offer: { id: string; version: number; name: string };
    quantity: number;
    status: "pending" | "paid" | "refunded" | "canceled";
  }>;
}
export interface Offer {
  id: string;
  version: number;
  name: string;
  kind: "workspace_subscription" | "credit_pack";
  currency: string | null;
  amountMinor: number | null;
  interval: string | null;
  creditQuantity: number;
}

export function organizationPermissions(role: OrganizationRole) {
  return {
    administer: role === "owner" || role === "admin",
    billing: role === "owner" || role === "admin" || role === "billing",
    appointOwner: role === "owner",
  };
}

export type OrganizationAccessState = "loading" | "signed-out" | "unavailable" | "error" | "ready";

export function organizationAccessState(
  navigation: {
    loading: boolean;
    error: string;
    user: { userId: string } | null;
    organizationManagementEnabled: boolean;
  },
  collection: { unavailable: boolean; needsSignIn: boolean },
): OrganizationAccessState {
  if (navigation.loading) return "loading";
  if (collection.unavailable) return "unavailable";
  if (navigation.error) return "error";
  if (!navigation.organizationManagementEnabled) return "unavailable";
  if (!navigation.user || collection.needsSignIn) return "signed-out";
  return "ready";
}

export function organizationSections(role: OrganizationRole) {
  const permissions = organizationPermissions(role);
  return [
    { label: "Overview", href: "#overview" },
    { label: "Workspaces", href: "#workspaces" },
    ...(permissions.administer ? [{ label: "Members", href: "#members" }] : []),
    ...(permissions.billing ? [{ label: "Billing and credits", href: "#event-credits" }] : []),
    ...(permissions.administer ? [{ label: "Organization settings", href: "#settings" }] : []),
  ];
}

export function organizationFragmentTarget(hash: string, role: OrganizationRole): string | null {
  let fragment: string;
  try {
    fragment = decodeURIComponent(hash.replace(/^#/, ""));
  } catch {
    return null;
  }
  const sections = organizationSections(role).map((section) => section.href.slice(1));
  if (organizationPermissions(role).billing) sections.push("billing");
  return sections.includes(fragment) ? fragment : null;
}

export function offerPrice(offer: Offer): string {
  if (offer.currency === null || offer.amountMinor === null) return "Price not published";
  // All catalog amounts are provider minor units, including currencies without cents.
  const digits =
    new Intl.NumberFormat("en-CA", {
      style: "currency",
      currency: offer.currency,
    }).resolvedOptions().maximumFractionDigits ?? 2;
  const price = new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency: offer.currency,
  }).format(offer.amountMinor / 10 ** digits);
  return `${price}${offer.interval ? ` / ${offer.interval} / workspace` : " / pack"}`;
}

export function licenseOverflow(billing: BillingView): number {
  return Math.max(0, billing.assignments.length - billing.subscription.licenseQuantity);
}
