import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FundingGuide, OrganizationAccessGuide } from "./organization-panels";
import { offerPrice, organizationPermissions, type BillingView } from "./organization-model";
import OrganizationInvitePage from "./invite/page";

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

describe("organization administration", () => {
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
    expect(markup).toContain("Workspace content access is managed separately");
    expect(markup).toContain("Accept invitation");
  });
});
