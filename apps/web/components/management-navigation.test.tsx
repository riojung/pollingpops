import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  LogoutWarningNotice,
  ManagementNavigationLinks,
  useManagementNavigation,
  type ManagementNavigationState,
} from "./management-navigation";
import { emptyCustomerManagementNavigation } from "../lib/management-navigation";
import { apiFetch, LOGOUT_REVOCATION_WARNING } from "../lib/api";
import type * as ApiModule from "../lib/api";

vi.mock("../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof ApiModule>()),
  apiFetch: vi.fn(),
}));

const routing = vi.hoisted(() => ({ pathname: "/" }));
vi.mock("next/navigation", () => ({ usePathname: () => routing.pathname }));

const origin = "https://control.example.com";
const empty: ManagementNavigationState = {
  ...emptyCustomerManagementNavigation,
  loading: false,
  error: "",
  refresh: async () => undefined,
};

describe("role-aware management menus", () => {
  afterEach(() => {
    routing.pathname = "/";
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it("marks the organization destination without marking all section links current", () => {
    routing.pathname = "/organization";
    const markup = renderToStaticMarkup(
      <ManagementNavigationLinks
        navigation={{
          ...empty,
          user: { userId: "user", email: "owner@example.com" },
          organizationManagementEnabled: true,
          organizations: [{ id: "owned", name: "Customer", role: "owner" }],
        }}
      />,
    );
    expect(markup).toContain('data-current="true"');
    expect(markup.match(/aria-current="page"/g)).toHaveLength(1);
    expect(markup).toMatch(/aria-current="page"[^>]*href="\/organization"/);
  });

  it("refreshes customer navigation without querying an independently configured console", async () => {
    vi.mocked(apiFetch).mockResolvedValue({
      ...emptyCustomerManagementNavigation,
      user: { userId: "payer", email: "payer@example.com" },
      organizationManagementEnabled: true,
      organizations: [{ id: "paid", name: "Customer", role: "billing" }],
      operatorConsoleOrigin: origin,
    });
    const consoleFetch = vi.fn();
    vi.stubGlobal("fetch", consoleFetch);
    let navigation: ManagementNavigationState | undefined;
    function CaptureNavigation() {
      navigation = useManagementNavigation();
      return null;
    }
    renderToStaticMarkup(<CaptureNavigation />);
    await navigation!.refresh();
    expect(apiFetch).toHaveBeenCalledExactlyOnceWith(
      "/v1/auth/navigation",
      expect.objectContaining({ cache: "no-store", signal: expect.any(AbortSignal) }),
    );
    expect(consoleFetch).not.toHaveBeenCalled();
  });

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

  it("ignores legacy operator identity and links in both customer navigation layouts", () => {
    const navigation = {
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
      expect(markup).toBe("");

      const customerMarkup = renderToStaticMarkup(
        <ManagementNavigationLinks
          navigation={{
            ...navigation,
            user: { userId: "payer", email: "payer@example.com" },
            organizationManagementEnabled: true,
            organizations: [{ id: "paid", name: "Customer", role: "billing" }],
          }}
          variant={variant}
        />,
      );
      expect(customerMarkup).toContain("Event credits");
      expect(customerMarkup).not.toContain("Business");
      expect(customerMarkup).not.toContain("Super admin");
      expect(customerMarkup).not.toContain(origin);
      expect(customerMarkup).not.toContain("Tenants");
      expect(customerMarkup).not.toContain("Operations");
    }
  });

  it("hides staff entry and controls without an authenticated operator even when configured", () => {
    expect(renderToStaticMarkup(<ManagementNavigationLinks navigation={empty} />)).toBe("");
    const configured = { ...empty, operatorConsoleOrigin: origin };
    expect(renderToStaticMarkup(<ManagementNavigationLinks navigation={configured} />)).toBe("");
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
