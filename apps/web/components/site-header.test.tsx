import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as ManagementNavigationModule from "./management-navigation";
import { LOGOUT_REVOCATION_WARNING } from "../lib/api";

const fixtures = vi.hoisted(() => ({
  navigation: {
    loading: false,
    error: "",
    user: null as { userId: string; email: string } | null,
    organizationManagementEnabled: false,
    organizations: [] as Array<{ id: string; name: string; role: "billing" | "owner" }>,
    operatorConsoleOrigin: null as string | null,
    operator: null as { name: string; role: "founder" } | null,
    operatorLinks: [] as Array<{ id: string; label: string; href: string }>,
    operatorLoading: false,
    refresh: async () => undefined,
    logoutWarning: null as string | null,
    dismissLogoutWarning: () => undefined,
  },
}));

vi.mock("./management-navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof ManagementNavigationModule>()),
  useManagementNavigation: () => fixtures.navigation,
}));

import { SiteHeader } from "./site-header";

describe("management discovery in the product header", () => {
  beforeEach(() => {
    fixtures.navigation.user = null;
    fixtures.navigation.organizationManagementEnabled = false;
    fixtures.navigation.organizations = [];
    fixtures.navigation.operator = null;
    fixtures.navigation.operatorConsoleOrigin = null;
    fixtures.navigation.operatorLinks = [];
    fixtures.navigation.logoutWarning = null;
  });

  it("recognizes billing-only identity before workspace authentication succeeds", () => {
    fixtures.navigation.user = { userId: "payer", email: "payer@example.com" };
    fixtures.navigation.organizationManagementEnabled = true;
    fixtures.navigation.organizations = [{ id: "paid", name: "Paid team", role: "billing" }];
    const markup = renderToStaticMarkup(<SiteHeader />);
    expect(markup).toContain("payer@example.com");
    expect(markup).toContain('href="/account"');
    expect(markup).toContain('href="/organization"');
    expect(markup).toContain("Event credits");
    expect(markup).not.toContain('href="/signin"');
    expect(markup).not.toContain('href="/dashboard"');
    expect(markup).not.toContain("Super admin");
  });

  it("ignores legacy operator sessions in both customer navigation layouts", () => {
    fixtures.navigation.operatorConsoleOrigin = "https://control.example.com";
    fixtures.navigation.operator = { name: "Staff", role: "founder" };
    fixtures.navigation.operatorLinks = [
      {
        id: "organizations",
        label: "Tenants",
        href: "https://control.example.com/?view=organizations",
      },
    ];
    const markup = renderToStaticMarkup(<SiteHeader />);
    expect(markup).not.toContain("Business");
    expect(markup).not.toContain("Super admin");
    expect(markup).not.toContain("Tenants");
    expect(markup).not.toContain("https://control.example.com");
    expect(markup.match(/>Sign in<\/a>/g)).toHaveLength(2);
    expect(markup).not.toContain("Organization settings");
    expect(markup).not.toContain("Business admin sign in");
  });

  it("hides staff entry and administration from anonymous users even when the console is configured", () => {
    fixtures.navigation.operatorConsoleOrigin = "https://control.example.com";
    const markup = renderToStaticMarkup(<SiteHeader />);
    expect(markup).not.toContain("Business");
    expect(markup).not.toContain("https://control.example.com");
    expect(markup).toContain('href="/signin"');
    expect(markup).not.toContain("Super admin");
    expect(markup).not.toContain("Tenants");
  });

  it("keeps ordinary customer organization menus without advertising business administration", () => {
    fixtures.navigation.user = { userId: "owner", email: "owner@example.com" };
    fixtures.navigation.organizationManagementEnabled = true;
    fixtures.navigation.organizations = [{ id: "owned", name: "Customer", role: "owner" }];
    fixtures.navigation.operatorConsoleOrigin = "https://control.example.com";
    const markup = renderToStaticMarkup(<SiteHeader />);
    expect(markup).toContain("Organization settings");
    expect(markup).toContain("Members");
    expect(markup).not.toContain("Business");
    expect(markup).not.toContain("https://control.example.com");
  });

  it("does not advertise unavailable management on a disabled product deployment", () => {
    const markup = renderToStaticMarkup(<SiteHeader />);
    expect(markup).toContain('href="/signin"');
    expect(markup).not.toContain('href="/organization"');
    expect(markup).not.toContain("Business");
    expect(markup).not.toContain("Business admin sign in");
    expect(markup).not.toContain(LOGOUT_REVOCATION_WARNING);
  });

  it("retains a dismissible revocation warning on the public homepage after customer sign-out", () => {
    fixtures.navigation.logoutWarning = LOGOUT_REVOCATION_WARNING;
    const markup = renderToStaticMarkup(<SiteHeader />);
    expect(markup).toContain(LOGOUT_REVOCATION_WARNING);
    expect(markup).toContain('role="alert"');
    expect(markup).toContain(">Dismiss</button>");
    expect(markup).not.toContain("Super admin");
  });
});
