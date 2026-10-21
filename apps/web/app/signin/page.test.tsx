import { isValidElement, type ReactElement, type ReactNode } from "react";
import type * as ReactModule from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as ManagementNavigationModule from "../../components/management-navigation";
import type * as ApiModule from "../../lib/api";
import { LOGOUT_REVOCATION_WARNING } from "../../lib/api";

type EffectSlot = { dependencies?: unknown[]; cleanup?: () => void };

const fixtures = vi.hoisted(() => ({
  slots: [] as unknown[],
  cursor: 0,
  effects: [] as Array<() => void>,
  api: vi.fn(),
  replace: vi.fn(),
  pinResponse: {
    accepted: true,
    challengeId: "challenge-one",
    expiresInSeconds: 600,
    resendAfterSeconds: 60,
    debugPin: "012345",
  },
  features: {
    publicWebUrl: "http://localhost:8080",
    developmentEmailInboxUrl: null as string | null,
  },
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

// Exercise handlers and successive renders without a browser or a DOM dependency.
vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof ReactModule>()),
  useState: (initial: unknown) => {
    const index = fixtures.cursor++;
    if (!(index in fixtures.slots)) {
      fixtures.slots[index] = typeof initial === "function" ? initial() : initial;
    }
    return [
      fixtures.slots[index],
      (value: unknown) => {
        fixtures.slots[index] = typeof value === "function" ? value(fixtures.slots[index]) : value;
      },
    ];
  },
  useRef: (initial: unknown) => {
    const index = fixtures.cursor++;
    if (!(index in fixtures.slots)) fixtures.slots[index] = { current: initial };
    return fixtures.slots[index];
  },
  useEffect: (effect: () => void | (() => void), dependencies?: unknown[]) => {
    const index = fixtures.cursor++;
    const previous = fixtures.slots[index] as EffectSlot | undefined;
    if (
      previous?.dependencies &&
      dependencies?.every((value, position) => Object.is(value, previous.dependencies![position]))
    ) {
      return;
    }
    fixtures.effects.push(() => {
      previous?.cleanup?.();
      fixtures.slots[index] = { dependencies, cleanup: effect() };
    });
  },
}));

vi.mock("next/link", () => ({
  default: ({ children, ...props }: { children: ReactNode; href: string }) => (
    <a {...props}>{children}</a>
  ),
}));

vi.mock("../../components/brand", () => ({
  Brand: () => <a href="/">Polling Pops</a>,
}));

vi.mock("../../components/locale-provider", async () => {
  const { englishMessages, translate } = await import("../../lib/i18n/catalog");
  const { deliveryAuthoringEnglishMessages } =
    await import("../../lib/i18n/domains/delivery-authoring");
  return {
    useLocale: () => ({
      t: (key: Parameters<typeof translate>[1], values?: Record<string, string | number>) =>
        translate({ ...englishMessages, ...deliveryAuthoringEnglishMessages }, key, values),
    }),
  };
});

vi.mock("../../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof ApiModule>()),
  apiFetch: fixtures.api,
}));

vi.mock("../../components/management-navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof ManagementNavigationModule>()),
  useManagementNavigation: () => fixtures.navigation,
}));

import SignInPage from "./page";

function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement<Record<string, unknown>>(node)) return [];
  return [node, ...elements(node.props.children as ReactNode)];
}

function renderPage() {
  fixtures.cursor = 0;
  const node = SignInPage();
  const markup = renderToStaticMarkup(node);
  const effects = fixtures.effects.splice(0);
  effects.forEach((effect) => effect());
  return { node, markup };
}

async function hydratedPage(query = "") {
  vi.stubGlobal("window", {
    location: {
      href: `http://localhost:8080/signin${query}`,
      search: query,
      replace: fixtures.replace,
      assign: vi.fn(),
    },
    setInterval: globalThis.setInterval,
    clearInterval: globalThis.clearInterval,
  });
  renderPage();
  await Promise.resolve();
  return renderPage();
}

function find(
  node: ReactNode,
  predicate: (element: ReactElement<Record<string, unknown>>) => boolean,
) {
  const result = elements(node).find(predicate);
  if (!result) throw new Error("Missing sign-in control");
  return result;
}

function button(node: ReactNode, label: string) {
  return find(node, (element) => element.type === "button" && element.props.children === label);
}

function click(control: ReactElement<Record<string, unknown>>) {
  return (control.props.onClick as () => void | Promise<void>)();
}

function enterEmail(node: ReactNode, email = " Creator@Example.com ") {
  const input = find(node, (element) => element.props.id === "email");
  (input.props.onChange as (event: { target: { value: string } }) => void)({
    target: { value: email },
  });
  const consent = find(node, (element) => element.props.type === "checkbox");
  (consent.props.onChange as (event: { target: { checked: boolean } }) => void)({
    target: { checked: true },
  });
}

function enterPin(node: ReactNode, pin: string) {
  const input = find(node, (element) => element.props.id === "signin-pin");
  (input.props.onChange as (event: { target: { value: string } }) => void)({
    target: { value: pin },
  });
}

async function submit(node: ReactNode) {
  const form = find(node, (element) => element.type === "form");
  await (form.props.onSubmit as (event: { preventDefault: () => void }) => Promise<void>)({
    preventDefault: vi.fn(),
  });
}

async function requestPin(query = "") {
  let page = await hydratedPage(query);
  enterEmail(page.node);
  page = renderPage();
  await submit(page.node);
  return renderPage();
}

describe("public product sign-in", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-20T12:00:00Z"));
    fixtures.slots = [];
    fixtures.cursor = 0;
    fixtures.effects = [];
    fixtures.navigation.user = null;
    fixtures.navigation.organizations = [];
    fixtures.navigation.operator = null;
    fixtures.navigation.operatorLinks = [];
    fixtures.navigation.logoutWarning = null;
    fixtures.features = { publicWebUrl: "http://localhost:8080", developmentEmailInboxUrl: null };
    fixtures.pinResponse.challengeId = "challenge-one";
    vi.clearAllMocks();
    fixtures.api.mockImplementation(async (path: string) => {
      if (path === "/v1/features") return fixtures.features;
      if (path === "/v1/auth/email-verification") {
        return { accepted: true, debugUrl: "http://localhost:8080/secret-verification-token" };
      }
      if (path === "/v1/auth/pin/request") return { ...fixtures.pinResponse };
      if (path === "/v1/auth/pin/verify") return { redirectTo: "http://localhost:8080/dashboard" };
      if (path.startsWith("/v1/auth/oidc/status?")) return { enabled: false };
      throw new Error(`Unexpected request: ${path}`);
    });
  });

  afterEach(() => {
    fixtures.slots.forEach((slot) => (slot as EffectSlot | null)?.cleanup?.());
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("starts signed out with explicit account modes and a styled Round navigation action", async () => {
    const { markup } = await hydratedPage();
    expect(markup).toContain('id="signin-title"');
    expect(markup).toContain('class="button-quiet auth-join-link" href="/join"');
    expect(markup).toContain("Send sign-in PIN");
    expect(markup).toContain("Create account");
    expect(markup).not.toContain("I mainly facilitate");
    expect(markup).not.toContain("Continue to dashboard");
    expect(markup).not.toContain("Business administration");
    expect(markup).not.toContain("https://control.example.com");
    expect(markup).not.toContain(LOGOUT_REVOCATION_WARNING);
    expect(fixtures.api).toHaveBeenCalledTimes(1);
  });

  it("does not expose staff access for customer owners or legacy operator sessions", async () => {
    fixtures.navigation.user = { userId: "owner", email: "owner@example.com" };
    fixtures.navigation.organizations = [{ id: "owned", name: "Customer", role: "owner" }];
    fixtures.navigation.operator = { name: "Founder", role: "founder" };
    fixtures.navigation.operatorLinks = [
      {
        id: "organizations",
        label: "Tenants",
        href: "https://control.example.com/?view=organizations",
      },
    ];
    const { markup } = await hydratedPage();
    expect(markup).not.toMatch(
      /Business admin|Super admin|Tenants|https:\/\/control\.example\.com/,
    );
  });

  it("retains the logout warning without exposing an admin entry", async () => {
    fixtures.navigation.logoutWarning = LOGOUT_REVOCATION_WARNING;
    const { markup } = await hydratedPage();
    expect(markup).toContain(LOGOUT_REVOCATION_WARNING);
    expect(markup).toContain('role="alert"');
    expect(markup).toContain(">Dismiss</button>");
    expect(markup).not.toContain("https://control.example.com");
  });

  it("requests verification with signup consent and segment, without signing in or showing debug links", async () => {
    let page = await hydratedPage("?returnTo=%2Faccount");
    click(button(page.node, "Create account"));
    page = renderPage();
    expect(page.markup).toContain("I mainly facilitate");
    click(button(page.node, "Education"));
    enterEmail(page.node);
    page = renderPage();
    await submit(page.node);
    page = renderPage();
    expect(fixtures.api).toHaveBeenLastCalledWith("/v1/auth/email-verification", {
      method: "POST",
      body: JSON.stringify({
        email: "creator@example.com",
        segment: "education",
        acceptPolicies: true,
        returnTo: "/account",
      }),
    });
    expect(page.markup).toContain("Verifying your email does not sign you in.");
    expect(page.markup).not.toContain("secret-verification-token");
    expect(page.markup).not.toContain('id="signin-pin"');
    expect(fixtures.replace).not.toHaveBeenCalled();
    click(button(page.node, "Sign in"));
    page = renderPage();
    const consent = find(page.node, (element) => element.props.type === "checkbox");
    expect(consent.props.checked).toBe(false);
    expect(page.markup).toContain("Send sign-in PIN");
  });

  it("shows verified confirmation without autofilling an email or automatically requesting a PIN", async () => {
    const { node, markup } = await hydratedPage(
      "?verified=1&email=ignored%40example.com&returnTo=%2Faccount",
    );
    expect(markup).toContain("Email verified. Sign in to request a PIN.");
    expect(find(node, (element) => element.props.id === "email").props.value).toBe("");
    expect(fixtures.api).toHaveBeenCalledTimes(1);
    expect(fixtures.replace).not.toHaveBeenCalled();
  });

  it("requests a generic PIN challenge and keeps leading zeros until explicit verification succeeds", async () => {
    let page = await requestPin("?returnTo=%2Faccount");
    expect(fixtures.api).toHaveBeenLastCalledWith("/v1/auth/pin/request", {
      method: "POST",
      body: JSON.stringify({
        email: "creator@example.com",
        acceptPolicies: true,
        returnTo: "/account",
      }),
    });
    expect(page.markup).toContain("If creator@example.com has a verified account");
    expect(page.markup).toContain(
      "Enter the PIN sent to your verified email to access Polling Pops.",
    );
    expect(page.markup).not.toContain("Enter your verified email address");
    expect(page.markup).toContain('type="text"');
    expect(page.markup).toContain('inputMode="numeric"');
    expect(page.markup).toContain('autoComplete="one-time-code"');
    expect(page.markup).toContain('aria-describedby="signin-pin-help"');
    expect(page.markup).not.toContain("012345");
    expect(page.markup).not.toContain("challenge-one");
    expect(fixtures.replace).not.toHaveBeenCalled();
    enterPin(page.node, "012345");
    page = renderPage();
    await submit(page.node);
    expect(fixtures.api).toHaveBeenLastCalledWith("/v1/auth/pin/verify", {
      method: "POST",
      body: JSON.stringify({ challengeId: "challenge-one", pin: "012345" }),
    });
    expect(fixtures.replace).toHaveBeenCalledWith("http://localhost:8080/dashboard");
  });

  it("retains the PIN challenge and refocuses the field after a rejected PIN", async () => {
    let page = await requestPin();
    const focus = vi.fn();
    const input = find(page.node, (element) => element.props.id === "signin-pin");
    (input.props.ref as { current: unknown }).current = { focus };
    enterPin(page.node, "111111");
    page = renderPage();
    fixtures.api.mockRejectedValueOnce({ status: 401 });
    await submit(page.node);
    page = renderPage();
    expect(page.markup).toContain('role="alert"');
    expect(page.markup).toContain("The PIN is invalid or expired.");
    expect(page.markup).toContain('aria-invalid="true"');
    expect(find(page.node, (element) => element.props.id === "signin-pin").props.value).toBe(
      "111111",
    );
    expect(focus).toHaveBeenCalled();
    expect(fixtures.replace).not.toHaveBeenCalled();
    enterPin(page.node, "012345");
    page = renderPage();
    await submit(page.node);
    expect(fixtures.api).toHaveBeenLastCalledWith("/v1/auth/pin/verify", {
      method: "POST",
      body: JSON.stringify({ challengeId: "challenge-one", pin: "012345" }),
    });
  });

  it("preserves a validated invitation workspace through PIN requests and resends", async () => {
    const workspaceId = "00000000-0000-4000-8000-000000000002";
    await requestPin(
      `?verified=1&workspaceId=${workspaceId}&returnTo=%2Fdashboard%3Finvitation%3Daccepted`,
    );
    const expectedRequest = {
      method: "POST",
      body: JSON.stringify({
        email: "creator@example.com",
        acceptPolicies: true,
        returnTo: "/dashboard?invitation=accepted",
        workspaceId,
      }),
    };
    expect(fixtures.api).toHaveBeenLastCalledWith("/v1/auth/pin/request", expectedRequest);
    expect(fixtures.api).toHaveBeenCalledWith(`/v1/auth/oidc/status?workspaceId=${workspaceId}`);
    vi.advanceTimersByTime(60_000);
    const page = renderPage();
    await click(button(page.node, "Send a new PIN"));
    await Promise.resolve();
    expect(fixtures.api).toHaveBeenLastCalledWith("/v1/auth/pin/request", expectedRequest);
  });

  it("ignores a malformed workspace query instead of passing it into email or OIDC authentication", async () => {
    await requestPin("?workspaceId=malformed-workspace");
    expect(fixtures.api).toHaveBeenCalledTimes(2);
    expect(fixtures.api).toHaveBeenLastCalledWith("/v1/auth/pin/request", {
      method: "POST",
      body: JSON.stringify({ email: "creator@example.com", acceptPolicies: true }),
    });
  });

  it("enforces the resend delay and verifies against the replacement challenge", async () => {
    let page = await requestPin();
    const waiting = button(page.node, "Resend in 60s");
    expect(waiting.props.disabled).toBe(true);
    await click(waiting);
    expect(
      fixtures.api.mock.calls.filter(([path]) => path === "/v1/auth/pin/request"),
    ).toHaveLength(1);
    vi.advanceTimersByTime(60_000);
    page = renderPage();
    fixtures.pinResponse.challengeId = "challenge-two";
    await click(button(page.node, "Send a new PIN"));
    await Promise.resolve();
    page = renderPage();
    expect(button(page.node, "Resend in 60s").props.disabled).toBe(true);
    expect(find(page.node, (element) => element.props.id === "signin-pin").props.value).toBe("");
    enterPin(page.node, "012345");
    page = renderPage();
    await submit(page.node);
    expect(fixtures.api).toHaveBeenLastCalledWith("/v1/auth/pin/verify", {
      method: "POST",
      body: JSON.stringify({ challengeId: "challenge-two", pin: "012345" }),
    });
  });

  it("provides expiry guidance and can return to the signed-out email form", async () => {
    await requestPin();
    vi.advanceTimersByTime(600_000);
    let page = renderPage();
    expect(page.markup).toContain("This PIN has expired.");
    click(button(page.node, "Use another email"));
    page = renderPage();
    expect(page.markup).not.toContain('id="signin-pin"');
    expect(page.markup).toContain("Send sign-in PIN");
    expect(find(page.node, (element) => element.props.type === "checkbox").props.checked).toBe(
      false,
    );
  });

  it("keeps local inbox and configured-origin guidance without displaying credentials", async () => {
    fixtures.features = {
      publicWebUrl: "http://127.0.0.1:8080",
      developmentEmailInboxUrl: "http://localhost:8025",
    };
    const { markup } = await requestPin("?returnTo=%2Faccount");
    expect(markup).toContain('href="http://localhost:8025"');
    expect(markup).toContain("Open local email inbox");
    expect(markup).toContain('href="http://127.0.0.1:8080/signin?returnTo=%2Faccount"');
    expect(markup).toContain("Use http://127.0.0.1:8080 to verify your email");
    expect(markup).not.toContain("012345");
    expect(markup).not.toContain("Continue to dashboard");
  });

  it("rejects protocol-relative return destinations before requesting a PIN", async () => {
    await requestPin("?returnTo=%2F%2Foutside.example");
    expect(fixtures.api).toHaveBeenLastCalledWith("/v1/auth/pin/request", {
      method: "POST",
      body: JSON.stringify({ email: "creator@example.com", acceptPolicies: true }),
    });
  });
});
