import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as ManagementNavigationModule from "../../components/management-navigation";
import type * as JsxRuntime from "react/jsx-runtime";
import type * as DevJsxRuntime from "react/jsx-dev-runtime";
import type * as ApiModule from "../../lib/api";
import * as signInEnvironment from "../../lib/signin-environment";
import { LOGOUT_REVOCATION_WARNING } from "../../lib/api";

const fixtures = vi.hoisted(() => ({
  submit: null as ((event: { preventDefault: () => void }) => Promise<void>) | null,
  magicLinkResponse: { accepted: true } as { accepted: boolean; signInOrigin?: string },
  navigation: {
    loading: false,
    error: "",
    user: null as { userId: string; email: string } | null,
    organizationManagementEnabled: true,
    organizations: [] as Array<{ id: string; name: string; role: "owner" }>,
    operatorConsoleOrigin: "https://control.example.com",
    operator: null as { name: string; role: "founder" } | null,
    operatorLinks: [] as Array<{ id: string; label: string; href: string }>,
    operatorLoading: false,
    refresh: async () => undefined,
    logoutWarning: null as string | null,
    dismissLogoutWarning: () => undefined,
  },
}));

// Capture the real form handler while keeping React's ordinary server rendering.
vi.mock("react/jsx-runtime", async (importOriginal) => {
  const runtime = await importOriginal<typeof JsxRuntime>();
  function captureForm(type: unknown, props: unknown) {
    if (type === "form") {
      fixtures.submit = (props as { onSubmit: typeof fixtures.submit }).onSubmit;
    }
  }
  return {
    ...runtime,
    jsx: (...args: Parameters<typeof runtime.jsx>) => {
      captureForm(args[0], args[1]);
      return runtime.jsx(...args);
    },
    jsxs: (...args: Parameters<typeof runtime.jsxs>) => {
      captureForm(args[0], args[1]);
      return runtime.jsxs(...args);
    },
  };
});

vi.mock("react/jsx-dev-runtime", async (importOriginal) => {
  const runtime = await importOriginal<typeof DevJsxRuntime>();
  return {
    ...runtime,
    jsxDEV: (...args: Parameters<typeof runtime.jsxDEV>) => {
      if (args[0] === "form") {
        fixtures.submit = (args[1] as { onSubmit: typeof fixtures.submit }).onSubmit;
      }
      return runtime.jsxDEV(...args);
    },
  };
});

vi.mock("../../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof ApiModule>()),
  apiFetch: vi.fn(async () => fixtures.magicLinkResponse),
}));

vi.mock("../../components/management-navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof ManagementNavigationModule>()),
  useManagementNavigation: () => fixtures.navigation,
}));

import SignInPage from "./page";

describe("public product sign-in", () => {
  beforeEach(() => {
    fixtures.navigation.user = null;
    fixtures.navigation.organizations = [];
    fixtures.navigation.operator = null;
    fixtures.navigation.operatorLinks = [];
    fixtures.navigation.logoutWarning = null;
    fixtures.submit = null;
    fixtures.magicLinkResponse = { accepted: true };
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("does not advertise staff access to anonymous users on a configured deployment", () => {
    const markup = renderToStaticMarkup(<SignInPage />);
    expect(markup).toContain('id="signin-title"');
    expect(markup).not.toContain("Business admin sign in");
    expect(markup).not.toContain("Business administration");
    expect(markup).not.toContain("https://control.example.com");
    expect(markup).not.toContain(LOGOUT_REVOCATION_WARNING);
  });

  it("does not turn ordinary customer ownership into administration on the sign-in page", () => {
    fixtures.navigation.user = { userId: "owner", email: "owner@example.com" };
    fixtures.navigation.organizations = [{ id: "owned", name: "Customer", role: "owner" }];
    const markup = renderToStaticMarkup(<SignInPage />);
    expect(markup).not.toContain("Business admin sign in");
    expect(markup).not.toContain("Business administration");
    expect(markup).not.toContain("Super admin");
    expect(markup).not.toContain("https://control.example.com");
  });

  it("ignores legacy operator sessions on the customer sign-in page", () => {
    fixtures.navigation.operator = { name: "Founder", role: "founder" };
    fixtures.navigation.operatorLinks = [
      {
        id: "organizations",
        label: "Tenants",
        href: "https://control.example.com/?view=organizations",
      },
    ];
    const markup = renderToStaticMarkup(<SignInPage />);
    expect(markup).toContain('id="signin-title"');
    expect(markup).not.toContain("Business administration");
    expect(markup).not.toContain("Super admin");
    expect(markup).not.toContain("Tenants");
    expect(markup).not.toContain("https://control.example.com");
    expect(markup).not.toContain("Business admin sign in");
    expect(markup).not.toContain("Billing</a>");
  });

  it("shows the retained logout warning after a redirect without exposing an admin entry", () => {
    fixtures.navigation.logoutWarning = LOGOUT_REVOCATION_WARNING;
    const markup = renderToStaticMarkup(<SignInPage />);
    expect(markup).toContain(LOGOUT_REVOCATION_WARNING);
    expect(markup).toContain('role="alert"');
    expect(markup).toContain(">Dismiss</button>");
    expect(markup).not.toContain("Business administration");
    expect(markup).not.toContain("https://control.example.com");
  });

  it("resolves a successful optional local sign-in hint against the current browser address", async () => {
    fixtures.magicLinkResponse.signInOrigin = "http://localhost:8080";
    vi.stubGlobal("window", {
      location: { href: "http://localhost:8080/signin?returnTo=%2Faccount" },
    });
    const resolve = vi.spyOn(signInEnvironment, "resolveSignInEnvironment");
    renderToStaticMarkup(<SignInPage />);
    expect(fixtures.submit).not.toBeNull();
    await fixtures.submit!({ preventDefault: vi.fn() });
    expect(resolve).toHaveBeenCalledWith(
      "http://localhost:8080",
      "http://localhost:8080/signin?returnTo=%2Faccount",
    );
    expect(resolve.mock.results[0]?.value).toMatchObject({
      configuredOrigin: "http://localhost:8080",
      originMismatch: false,
    });
  });

  it("preserves the configured customer sign-in environment when no hint is returned", async () => {
    const resolve = vi.spyOn(signInEnvironment, "resolveSignInEnvironment");
    renderToStaticMarkup(<SignInPage />);
    expect(fixtures.submit).not.toBeNull();
    await fixtures.submit!({ preventDefault: vi.fn() });
    expect(resolve).not.toHaveBeenCalled();
  });
});
