import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as ManagementNavigationModule from "./management-navigation";
import { LOGOUT_REVOCATION_WARNING } from "../lib/api";
import { loadMessages, localeDomainsForPath } from "../lib/i18n/catalog";
import { publicSiteShellCopy } from "../lib/i18n/public-site-shell-copy";
import { LocaleProvider } from "./locale-provider";

const fixtures = vi.hoisted(() => ({
  pathname: "/",
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

vi.mock("next/navigation", () => ({
  usePathname: () => fixtures.pathname,
  useRouter: () => ({ push: vi.fn() }),
}));

import { SiteHeader } from "./site-header";

describe("management discovery in the product header", () => {
  beforeEach(() => {
    fixtures.pathname = "/";
    fixtures.navigation.user = null;
    fixtures.navigation.organizationManagementEnabled = false;
    fixtures.navigation.organizations = [];
    fixtures.navigation.operator = null;
    fixtures.navigation.operatorConsoleOrigin = null;
    fixtures.navigation.operatorLinks = [];
    fixtures.navigation.logoutWarning = null;
  });

  it("uses current-page navigation controls in desktop and mobile layouts", () => {
    fixtures.pathname = "/pricing";
    const markup = renderToStaticMarkup(<SiteHeader />);
    expect(markup.match(/<a[^>]*aria-current="page"[^>]*href="\/pricing"/g)).toHaveLength(1);
    expect(markup).toContain('href="/solutions"');
    expect(markup).toContain('href="/examples"');
    expect(markup).toContain('href="/resources"');
    expect(markup).not.toContain('href="/templates"');
    expect(markup).not.toContain('href="/help"');
    expect(markup).toContain('aria-expanded="false"');
    expect(markup).not.toContain('<a role="button"');
    expect(markup).toContain("Join a live Round");
    expect(markup).toContain("Seven-digit Round code");
    expect(markup.match(/<form /g)).toHaveLength(1);
    expect(markup).toContain('aria-label="Appearance: System"');
  });

  it.each(["/product/live-polls", "/examples", "/resources", "/pricing"])(
    "names the join form using the public shell locale on %s",
    async (pathname) => {
      fixtures.pathname = pathname;
      const locale = "fr-FR";
      const initialDomains = localeDomainsForPath(pathname);
      const initialMessages = await loadMessages(locale, initialDomains);
      expect(initialMessages["delivery.join.formLabel"]).toBeUndefined();

      const markup = renderToStaticMarkup(
        <LocaleProvider
          initialLocale={locale}
          initialDomains={initialDomains}
          initialMessages={initialMessages}
        >
          <SiteHeader />
        </LocaleProvider>,
      );
      const form = markup.match(/<form\b[^>]*>/)?.[0];
      expect(form).toContain(`aria-label="${publicSiteShellCopy(locale).joinLabel}"`);
      expect(markup).not.toContain("delivery.join.formLabel");
    },
  );

  it("recognizes billing-only identity before workspace authentication succeeds", () => {
    fixtures.navigation.user = { userId: "payer", email: "payer@example.com" };
    fixtures.navigation.organizationManagementEnabled = true;
    fixtures.navigation.organizations = [{ id: "paid", name: "Paid team", role: "billing" }];
    const markup = renderToStaticMarkup(<SiteHeader />);
    expect(markup).toContain("payer@example.com");
    expect(markup).not.toContain("Open workspace");
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
    expect(markup.match(/>Sign in<\/a>/g)).toHaveLength(1);
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
