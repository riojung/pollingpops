import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  LogoutWarningNotice,
  ManagementNavigationLinks,
  type ManagementNavigationState,
} from "./management-navigation";
import { emptyCustomerManagementNavigation } from "../lib/management-navigation";
import { LOGOUT_REVOCATION_WARNING } from "../lib/api";

const origin = "https://control.example.com";
const empty: ManagementNavigationState = {
  ...emptyCustomerManagementNavigation,
  loading: false,
  error: "",
  operator: null,
  operatorLinks: [],
  operatorLoading: false,
  refresh: async () => undefined,
};

describe("role-aware management menus", () => {
  it("only shows the bounded retained logout warning and provides dismissal without operator privileges", () => {
    expect(renderToStaticMarkup(<LogoutWarningNotice navigation={empty} />)).toBe("");
    expect(
      renderToStaticMarkup(
        <LogoutWarningNotice navigation={{ ...empty, logoutWarning: "Untrusted warning" }} />,
      ),
    ).toBe("");
    const markup = renderToStaticMarkup(
      <LogoutWarningNotice
        navigation={{
          ...empty,
          logoutWarning: LOGOUT_REVOCATION_WARNING,
          dismissLogoutWarning: () => undefined,
        }}
      />,
    );
    expect(markup).toContain('role="alert"');
    expect(markup).toContain(LOGOUT_REVOCATION_WARNING);
    expect(markup).toContain(">Dismiss</button>");
    expect(markup).not.toContain(origin);
  });
  it("does not turn customer organization ownership into global administration", () => {
    const markup = renderToStaticMarkup(
      <ManagementNavigationLinks
        navigation={{
          ...empty,
          user: { userId: "user", email: "owner@example.com" },
          organizationManagementEnabled: true,
          organizations: [{ id: "owned", name: "Customer", role: "owner" }],
          operatorConsoleOrigin: origin,
        }}
      />,
    );
    expect(markup).toContain("Organization settings");
    expect(markup).toContain("Members");
    expect(markup).not.toContain("Super admin");
    expect(markup).not.toContain("Tenants");
    expect(markup).not.toContain(origin);
    expect(markup).not.toContain("Business");
  });

  it("shows the trusted founder navigation as Super admin on desktop and mobile", () => {
    const navigation: ManagementNavigationState = {
      ...empty,
      operator: { name: "Founder", role: "founder" },
      operatorConsoleOrigin: origin,
      operatorLinks: [
        { id: "organizations", label: "Tenants", href: `${origin}/?view=organizations` },
        { id: "operations", label: "Operations", href: `${origin}/?view=operations` },
      ],
    };
    for (const variant of ["dropdown", "sections"] as const) {
      const markup = renderToStaticMarkup(
        <ManagementNavigationLinks navigation={navigation} variant={variant} />,
      );
      expect(markup).toContain("Business · Super admin");
      expect(markup).toContain(`href="${origin}/?view=organizations"`);
      expect(markup).toContain("Tenants");
      expect(markup).toContain("Operations");
      expect(markup).not.toContain("Billing</a>");
      expect(markup).not.toContain("Business admin sign in");
    }
  });

  it("hides staff entry and controls without an authenticated operator even when configured", () => {
    expect(renderToStaticMarkup(<ManagementNavigationLinks navigation={empty} />)).toBe("");
    const configured = { ...empty, operatorConsoleOrigin: origin };
    expect(renderToStaticMarkup(<ManagementNavigationLinks navigation={configured} />)).toBe("");
    expect(
      renderToStaticMarkup(
        <ManagementNavigationLinks
          navigation={{
            ...configured,
            operatorLinks: [
              { id: "organizations", label: "Tenants", href: `${origin}/?view=organizations` },
            ],
          }}
        />,
      ),
    ).toBe("");
  });

  it("keeps billing-only organization navigation available without workspace claims", () => {
    const markup = renderToStaticMarkup(
      <ManagementNavigationLinks
        navigation={{
          ...empty,
          user: { userId: "payer", email: "payer@example.com" },
          organizationManagementEnabled: true,
          organizations: [{ id: "paid", name: "Customer", role: "billing" }],
        }}
        variant="sections"
      />,
    );
    expect(markup).toContain("Organization");
    expect(markup).toContain("Event credits");
    expect(markup).not.toContain("Members");
    expect(markup).not.toContain("Workspaces");
    expect(markup).not.toContain("Business");
  });
});
