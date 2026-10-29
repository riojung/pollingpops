import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  FundingGuide,
  OrganizationAccessGuide,
  OrganizationEntryState,
  OrganizationSeatSummary,
  OrganizationSections,
} from "./organization-panels";
import {
  offerPrice,
  canInviteOrganizationMember,
  organizationInvitationDestination,
  organizationInvitationInput,
  organizationLicenseUnit,
  organizationAccessState,
  organizationFragmentTarget,
  organizationPermissions,
  type BillingView,
  type UserLicenseSummary,
} from "./organization-model";
import OrganizationInvitePage from "./invite/page";
import OrganizationPage from "./page";

const fixtures = vi.hoisted(() => ({
  navigation: {
    loading: false,
    error: "",
    user: null as { userId: string; email: string } | null,
    organizationManagementEnabled: true,
    organizations: [],
    operatorConsoleOrigin: null,
    refresh: vi.fn(),
  },
}));

vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams() }));
vi.mock("../../components/management-navigation", () => ({
  useManagementNavigation: () => fixtures.navigation,
  ManagementNavigationLinks: () => null,
}));

const billing: BillingView = {
  subscription: {
    status: "active",
    licenseQuantity: 2,
    customerId: "customer",
    subscriptionId: "subscription",
    paidThrough: "2026-11-01T00:00:00Z",
    graceUntil: null,
  },
  assignments: [{ workspaceId: "one", assignedAt: "2026-01-01" }],
  balance: { balance: 5, reserved: 2, available: 3 },
  mode: "stripe",
  eventCreditsEnabled: true,
};
const seats: UserLicenseSummary = {
  organizationId: "company",
  licenseUnit: "user",
  quantity: 3,
  assigned: 1,
  reserved: 1,
  available: 1,
  assignments: [
    {
      organizationId: "company",
      userId: "creator",
      assignedBy: "owner",
      assignedAt: "2026-10-29T00:00:00Z",
    },
  ],
  pendingInvitationIds: ["invitation"],
};

describe("organization administration", () => {
  beforeEach(() => {
    fixtures.navigation.loading = false;
    fixtures.navigation.error = "";
    fixtures.navigation.user = null;
    fixtures.navigation.organizationManagementEnabled = true;
  });
  it("renders the sign-in entry on the actual page without organization creation controls", () => {
    const markup = renderToStaticMarkup(<OrganizationPage />);
    expect(markup).toContain("Sign in to manage your organization");
    expect(markup).toContain('href="/signin?returnTo=%2Forganization"');
    expect(markup).not.toContain("Create organization");
    expect(markup).not.toContain("Request failed");
  });
  it("shows a disabled installation with the correct signed-in identity and no active forms", () => {
    fixtures.navigation.user = { userId: "billing-only-user", email: "billing@example.com" };
    fixtures.navigation.organizationManagementEnabled = false;
    const markup = renderToStaticMarkup(<OrganizationPage />);
    expect(markup).toContain("Organization management is unavailable");
    expect(markup).toContain("billing@example.com");
    expect(markup).toContain('href="/account"');
    expect(markup).not.toContain("Create organization");
    expect(markup).not.toContain("<form");
    expect(markup).not.toContain('href="/signin');
  });
  it("requires an enabled deployment and authenticated identity before loading management", () => {
    const navigation = {
      loading: false,
      error: "",
      user: { userId: "billing-only-user" },
      organizationManagementEnabled: true,
    };
    const collection = { unavailable: false, needsSignIn: false };
    expect(organizationAccessState(navigation, collection)).toBe("ready");
    expect(organizationAccessState({ ...navigation, user: null }, collection)).toBe("signed-out");
    expect(
      organizationAccessState({ ...navigation, organizationManagementEnabled: false }, collection),
    ).toBe("unavailable");
    expect(organizationAccessState(navigation, { ...collection, unavailable: true })).toBe(
      "unavailable",
    );
    expect(organizationAccessState(navigation, { ...collection, needsSignIn: true })).toBe(
      "signed-out",
    );
    expect(organizationAccessState({ ...navigation, loading: true }, collection)).toBe("loading");
    expect(
      organizationAccessState({ ...navigation, error: "Network unavailable" }, collection),
    ).toBe("error");
  });
  it("gives signed-out and disabled deployments usable entry states without creation controls", () => {
    const signedOut = renderToStaticMarkup(
      <OrganizationEntryState state="signed-out" onRetry={() => {}} />,
    );
    expect(signedOut).toContain("Sign in to manage your organization");
    expect(signedOut).toContain('href="/signin?returnTo=%2Forganization"');
    expect(signedOut).not.toContain("Create organization");
    const unavailable = renderToStaticMarkup(
      <OrganizationEntryState state="unavailable" onRetry={() => {}} />,
    );
    expect(unavailable).toContain("Organization management is unavailable");
    expect(unavailable).not.toContain("Create organization");
    expect(unavailable).not.toContain("Request failed (404)");
    const error = renderToStaticMarkup(
      <OrganizationEntryState state="error" error="Please try again later." onRetry={() => {}} />,
    );
    expect(error).toContain("Please try again later.");
    expect(error).toContain("Try again");
  });
  it("shows section links only for the organization permissions held by the user", () => {
    const owner = renderToStaticMarkup(<OrganizationSections role="owner" />);
    for (const anchor of ["#overview", "#workspaces", "#members", "#event-credits", "#settings"])
      expect(owner).toContain(`href="${anchor}"`);
    const billingOnly = renderToStaticMarkup(<OrganizationSections role="billing" />);
    expect(billingOnly).toContain('href="#event-credits"');
    expect(billingOnly).not.toContain('href="#members"');
    expect(billingOnly).not.toContain('href="#settings"');
    const administrator = renderToStaticMarkup(<OrganizationSections role="admin" />);
    expect(administrator).toContain('href="#settings"');
    const member = renderToStaticMarkup(<OrganizationSections role="member" />);
    expect(member).toContain('href="#workspaces"');
    expect(member).not.toContain('href="#members"');
    expect(member).not.toContain('href="#event-credits"');
    expect(member).not.toContain('href="#settings"');
  });
  it("resolves only permitted organization fragments, including the billing alias", () => {
    expect(organizationFragmentTarget("#billing", "owner")).toBe("billing");
    expect(organizationFragmentTarget("#event%2Dcredits", "billing")).toBe("event-credits");
    expect(organizationFragmentTarget("#members", "billing")).toBeNull();
    expect(organizationFragmentTarget("#settings", "member")).toBeNull();
    expect(organizationFragmentTarget("#workspaces", "member")).toBe("workspaces");
    expect(organizationFragmentTarget("#missing", "owner")).toBeNull();
    expect(organizationFragmentTarget("#%invalid", "owner")).toBeNull();
  });
  it("keeps billing permission independent from content and organization administration", () => {
    expect(organizationPermissions("billing")).toEqual({
      administer: false,
      billing: true,
      appointOwner: false,
    });
    expect(organizationPermissions("member")).toEqual({
      administer: false,
      billing: false,
      appointOwner: false,
    });
    const markup = renderToStaticMarkup(<OrganizationAccessGuide role="member" />);
    expect(markup).toContain("Workspace membership controls access");
    expect(markup).toContain("Ask an organization owner");
  });
  it("explains exactly when event credits are consumed and what they cover", () => {
    const markup = renderToStaticMarkup(<FundingGuide billing={billing} />);
    expect(markup).toContain("1 assigned / 2 purchased");
    expect(markup).toContain("first audience member joins");
    expect(markup).toContain("Library and AI authoring allowances");
    expect(markup).toContain("do not expire");
    expect(markup).not.toContain("Renewal payment needs attention");
  });
  it("shows grace and license overflow without claiming all assigned workspaces are paid", () => {
    const markup = renderToStaticMarkup(
      <FundingGuide
        billing={{
          ...billing,
          subscription: {
            ...billing.subscription,
            status: "past_due",
            licenseQuantity: 0,
            graceUntil: "2026-11-08T00:00:00Z",
          },
        }}
      />,
    );
    expect(markup).toContain("Renewal payment needs attention");
    expect(markup).toContain(
      "workspaces beyond the paid quantity no longer have subscription access",
    );
  });
  it("formats configured currencies using their actual minor-unit precision", () => {
    const offer = {
      id: "credits",
      version: 1,
      name: "Credits",
      kind: "credit_pack" as const,
      currency: "jpy",
      amountMinor: 500,
      interval: null,
      creditQuantity: 5,
    };
    expect(offerPrice(offer)).toContain("500");
    expect(offerPrice({ ...offer, currency: null })).toBe("Price not published");
  });
  it("requires an explicit invitation acceptance and explains email and content-access boundaries", () => {
    const markup = renderToStaticMarkup(<OrganizationInvitePage />);
    expect(markup).toContain("email address that received this invitation");
    expect(markup).toContain("your own organization-owned workspace");
    expect(markup).toContain("Billing-only invitations provide payment administration");
    expect(markup).toContain("Legacy workspace content access is managed separately");
    expect(markup).toContain("Accept invitation");
  });
  it("keeps legacy workspace prices distinct from explicitly licensed users", () => {
    const offer = {
      id: "team",
      version: 2,
      name: "Team",
      kind: "workspace_subscription" as const,
      currency: "cad",
      amountMinor: 1500,
      interval: "month",
      creditQuantity: 0,
    };
    expect(offerPrice(offer)).toContain("/ month / workspace");
    expect(offerPrice({ ...offer, licenseUnit: "user" })).toContain("/ month / user");
    expect(organizationLicenseUnit({})).toBe("workspace");
    expect(organizationLicenseUnit({ licenseUnit: "user" }, billing)).toBe("user");
  });
  it("requires server-confirmed license availability for creator invitations", () => {
    const organization = { status: "active", licenseUnit: "user" as const };
    expect(canInviteOrganizationMember(organization, null, "member")).toBe(false);
    expect(canInviteOrganizationMember(organization, seats, "member")).toBe(true);
    expect(canInviteOrganizationMember(organization, { ...seats, available: 0 }, "admin")).toBe(
      false,
    );
    expect(canInviteOrganizationMember(organization, { ...seats, available: 0 }, "billing")).toBe(
      true,
    );
    expect(
      canInviteOrganizationMember({ ...organization, status: "suspended" }, seats, "billing"),
    ).toBe(false);
    expect(canInviteOrganizationMember({ status: "active" }, null, "member")).toBe(true);
  });
  it("provisions user workspace names only for creator-seat invitations", () => {
    const input = {
      email: "colleague@example.com",
      role: "member" as const,
      workspaceName: "  Sales workspace  ",
    };
    expect(organizationInvitationInput(input, "user")).toEqual({
      email: input.email,
      role: "member",
      workspaceName: "Sales workspace",
    });
    expect(organizationInvitationInput({ ...input, role: "billing" }, "user")).toEqual({
      email: input.email,
      role: "billing",
    });
    expect(organizationInvitationInput(input, "workspace")).toEqual({
      email: input.email,
      role: "member",
    });
  });
  it("routes accepted user invitations to the selected workspace and billing-only to management", () => {
    expect(
      organizationInvitationDestination({ organizationId: "company", workspaceId: "workspace" }),
    ).toBe("/home");
    expect(
      organizationInvitationDestination({
        organizationId: "company",
        activeWorkspaceId: "workspace",
      }),
    ).toBe("/home");
    expect(organizationInvitationDestination({ organizationId: "company" })).toBe(
      "/organization?organizationId=company",
    );
  });
  it("shows purchased, assigned and reserved user seats without inventing capacity while loading", () => {
    const markup = renderToStaticMarkup(<OrganizationSeatSummary seats={seats} />);
    expect(markup).toContain("Purchased");
    expect(markup).toContain("Reserved invitations");
    expect(markup).toContain("Available");
    expect(markup).toContain("separate workspace owned by your organization");
    expect(markup).toContain("Guest participants do not use user licenses");
    const pending = renderToStaticMarkup(<OrganizationSeatSummary seats={null} />);
    expect(pending).toContain("Loading user license availability");
    expect(pending).not.toContain("Available");
  });
  it("uses user-license billing language and hides disabled event-credit controls", () => {
    const markup = renderToStaticMarkup(
      <FundingGuide
        billing={{ ...billing, eventCreditsEnabled: false }}
        licenseUnit="user"
        seats={seats}
      />,
    );
    expect(markup).toContain("User licenses");
    expect(markup).toContain("individual creators");
    expect(markup).not.toContain("Workspace licenses");
    expect(markup).not.toContain("Event credits available");
    expect(markup).not.toContain("reserved for the room");
  });
});
