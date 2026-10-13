import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as ManagementNavigationModule from "./management-navigation";

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

  it("offers trusted global admin controls in both navigation layouts without customer claims", () => {
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
    expect(markup.match(/Business · Super admin/g)).toHaveLength(2);
    expect(markup.match(/>Tenants<\/a>/g)).toHaveLength(2);
    expect(markup).toContain("Sign in to create");
    expect(markup).not.toContain("Organization settings");
  });

  it("does not advertise unavailable management on a disabled product deployment", () => {
    const markup = renderToStaticMarkup(<SiteHeader />);
    expect(markup).toContain('href="/signin"');
    expect(markup).not.toContain('href="/organization"');
    expect(markup).not.toContain("Business");
  });
});
