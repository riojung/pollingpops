import { isValidElement, type ComponentProps, type ReactElement, type ReactNode } from "react";
import type * as ReactModule from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BrandTheme } from "@openround/contracts";
import type * as ApiModule from "../../lib/api";

interface ComponentHooks {
  cursor: number;
  slots: unknown[];
}
interface EffectSlot {
  deps?: ReactModule.DependencyList;
  cleanup?: () => void;
}
const fixtures = vi.hoisted(() => ({
  apiFetch: vi.fn(),
  router: { replace: vi.fn() },
  hooks: null as ComponentHooks | null,
  pendingEffects: [] as Array<() => void>,
  tree: null as ReactNode,
}));
vi.mock("react", async (importOriginal) => {
  const react = await importOriginal<typeof ReactModule>();
  const sameDeps = (previous?: ReactModule.DependencyList, next?: ReactModule.DependencyList) =>
    previous &&
    next &&
    previous.length === next.length &&
    previous.every((value, index) => Object.is(value, next[index]));
  const memo = <T,>(factory: () => T, deps?: ReactModule.DependencyList) => {
    const hooks = fixtures.hooks!;
    const index = hooks.cursor++;
    const prior = hooks.slots[index] as { deps?: ReactModule.DependencyList; value: T } | undefined;
    if (!prior || !sameDeps(prior.deps, deps)) hooks.slots[index] = { deps, value: factory() };
    return (hooks.slots[index] as { value: T }).value;
  };
  return {
    ...react,
    useState: <T,>(initial: T | (() => T)) => {
      const hooks = fixtures.hooks;
      if (!hooks) return react.useState(initial);
      const index = hooks.cursor++;
      if (!(index in hooks.slots))
        hooks.slots[index] = typeof initial === "function" ? (initial as () => T)() : initial;
      return [
        hooks.slots[index] as T,
        (next: T | ((current: T) => T)) => {
          hooks.slots[index] =
            typeof next === "function"
              ? (next as (current: T) => T)(hooks.slots[index] as T)
              : next;
        },
      ];
    },
    useRef: <T,>(initial: T) => {
      const hooks = fixtures.hooks;
      if (!hooks) return react.useRef(initial);
      const index = hooks.cursor++;
      if (!(index in hooks.slots)) hooks.slots[index] = { current: initial };
      return hooks.slots[index];
    },
    useMemo: <T,>(factory: () => T, deps: ReactModule.DependencyList) =>
      fixtures.hooks ? memo(factory, deps) : react.useMemo(factory, deps),
    useCallback: <T,>(callback: T, deps: ReactModule.DependencyList) =>
      fixtures.hooks
        ? memo(() => callback, deps)
        : react.useCallback(callback as (...args: never[]) => unknown, deps),
    useEffect: (effect: ReactModule.EffectCallback, deps?: ReactModule.DependencyList) => {
      const hooks = fixtures.hooks;
      if (!hooks) return react.useEffect(effect, deps);
      const index = hooks.cursor++;
      const prior = hooks.slots[index] as EffectSlot | undefined;
      if (prior && sameDeps(prior.deps, deps)) return;
      const slot: EffectSlot = { deps };
      hooks.slots[index] = slot;
      fixtures.pendingEffects.push(() => {
        prior?.cleanup?.();
        slot.cleanup = effect() || undefined;
      });
    },
  };
});
vi.mock("../../lib/api", async (original) => ({
  ...(await original<typeof ApiModule>()),
  apiFetch: fixtures.apiFetch,
}));
vi.mock("../../components/locale-provider", async () => {
  const { englishMessages, translate } = await import("../../lib/i18n/catalog");
  const { accountEnglishMessages } = await import("../../lib/i18n/domains/account");
  const messages = { ...englishMessages, ...accountEnglishMessages };
  const t = (key: Parameters<typeof translate>[1], values?: Record<string, string | number>) =>
    translate(messages, key, values);
  return { useLocale: () => ({ locale: "en-CA", t }) };
});
vi.mock("next/navigation", () => ({ useRouter: () => fixtures.router }));
vi.mock("next/link", () => ({ default: (props: ComponentProps<"a">) => <a {...props} /> }));
vi.mock("../../components/brand", () => ({ CreatorBrand: () => <span>Polling Pops</span> }));
vi.mock("../../components/site-header", () => ({
  SiteHeader: () => <header>Personal navigation</header>,
}));
vi.mock("../../components/management-navigation", () => ({
  useManagementNavigation: () => ({}),
  ManagementNavigationLinks: () => null,
}));
vi.mock("../../components/workspace/workspace-provider", () => ({
  WorkspaceProvider: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("../../components/workspace/workspace-shell", () => ({
  WorkspaceShell: ({ children }: { children: ReactNode }) => (
    <main data-shell="workspace">{children}</main>
  ),
}));
vi.mock("./appearance-settings", () => ({
  PersonalInterfaceSettings: () => <section>Your interface</section>,
  WorkspaceBrandSettings: ({
    theme,
    savedTheme,
  }: {
    theme: BrandTheme;
    savedTheme: BrandTheme | null;
  }) => (
    <section>
      <h2>Workspace live brand</h2>
      <input aria-label="Brand display name" readOnly value={theme.organizationName} />
      <span>{savedTheme?.primaryColor}</span>
    </section>
  ),
}));
vi.mock("./idle-timeout-settings", () => ({
  IdleTimeoutSettings: () => <section>Idle timeout</section>,
}));
vi.mock("./personal-institution-identities", () => ({
  PersonalInstitutionIdentities: () => <section>Institution identities</section>,
}));
vi.mock("./personal-subscription-options", () => ({
  PersonalSubscriptionOptions: () => <section>Personal subscription</section>,
}));

import AccountPage from "./page";
import { ApiClientError } from "../../lib/api";

const account = {
  creator: {
    userId: "user",
    workspaceId: "workspace",
    email: "creator@example.org",
    segment: "workplace",
    role: "owner",
    plan: "free",
  },
  workspace: {
    id: "workspace",
    name: "Trusted workspace",
    accountType: "personal",
    licenseUnit: "workspace",
    planSource: "free",
    organization: null,
    permissions: {
      manageWorkspace: true,
      managePeople: true,
      manageBilling: true,
      manageIntegrations: true,
    },
  },
  entitlements: {
    plan: "free",
    maxParticipants: 20,
    maxPublishedQuizzes: 5,
    reportRetentionDays: 30,
    csvExport: false,
    brandTheme: false,
  },
  businessManagementEnabled: false,
  productFeatures: { workspaceShell: false },
};
function response(path: string): unknown {
  if (path === "/v1/auth/me") return account;
  if (path === "/v1/account/theme")
    return {
      theme: {
        organizationName: "Trusted live brand",
        primaryColor: "#39243C",
        accentColor: "#AC2855",
        colorMode: "dark",
      },
      enabled: true,
    };
  if (path === "/v1/workspaces")
    return {
      activeWorkspaceId: "workspace",
      workspaces: [{ id: "workspace", name: "Trusted workspace", role: "owner", homeRegion: "ca" }],
    };
  if (path === "/v1/account/embed-origins") return { origins: ["https://trusted.example.org"] };
  if (path === "/v1/workspace/institution-policy")
    return {
      contractStatus: "active",
      identityRequirement: "institution",
      capabilities: { lti: true },
      k12Enabled: false,
    };
  if (path === "/v1/auth/federated-identities") return { identities: [] };
  if (path.startsWith("/v1/auth/oidc/status?"))
    return { enabled: true, providerName: "Trusted institution" };
  if (path === "/v1/workspace/members")
    return {
      members: [{ userId: "user", email: "creator@example.org", role: "owner" }],
      invitations: [],
    };
  if (path === "/v1/workspace/lti-registrations")
    return {
      registrations: [
        {
          id: "lti",
          name: "Trusted LMS",
          issuer: "https://lms.example.org",
          deploymentId: "school",
          status: "active",
        },
      ],
    };
  if (path === "/v1/billing/status")
    return { billing: { status: "free", customerId: null, subscriptionId: null } };
  throw new Error(`Unexpected read: ${path}`);
}

let browser: EventTarget & {
  location: { pathname: string; search: string; hash: string };
  history: { replaceState: ReturnType<typeof vi.fn> };
};
let browserDocument: EventTarget & { body: object; activeElement: object };
beforeEach(() => {
  fixtures.hooks = null;
  fixtures.pendingEffects = [];
  fixtures.tree = null;
  fixtures.router = { replace: vi.fn() };
  fixtures.apiFetch.mockReset().mockImplementation(async (path: string) => response(path));
  browser = Object.assign(new EventTarget(), {
    location: { pathname: "/account", search: "?from=settings", hash: "#overview" },
    history: { replaceState: vi.fn() },
  });
  const body = {};
  browserDocument = Object.assign(new EventTarget(), { body, activeElement: body });
  vi.stubGlobal("window", browser);
  vi.stubGlobal("document", browserDocument);
});
afterEach(() => {
  fixtures.hooks = null;
  vi.unstubAllGlobals();
});

function harness() {
  const hooks: ComponentHooks = { cursor: 0, slots: [] };
  const render = () => {
    hooks.cursor = 0;
    fixtures.hooks = hooks;
    fixtures.tree = AccountPage();
    fixtures.hooks = null;
    return renderToStaticMarkup(fixtures.tree);
  };
  const flushEffects = () => fixtures.pendingEffects.splice(0).forEach((effect) => effect());
  const settle = async () => {
    for (let index = 0; index < 16; index++) {
      render();
      flushEffects();
      await Promise.resolve();
    }
    return render();
  };
  const dispose = () => {
    hooks.slots.forEach((slot) => (slot as EffectSlot | undefined)?.cleanup?.());
    fixtures.pendingEffects = [];
  };
  return { render, settle, flushEffects, dispose };
}
function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap((child) => elements(child));
  if (!isValidElement<Record<string, unknown>>(node)) return [];
  return [node, ...elements(node.props.children as ReactNode)];
}
function byId(id: string) {
  return elements(fixtures.tree).find((node) => node.props.id === id)!;
}
function retry() {
  const button = elements(fixtures.tree).find(
    (node) => node.type === "button" && node.props.children === "Try again",
  )!;
  (button.props.onClick as () => void)();
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function attachLoadRegion() {
  const node = {
    contains: (target: unknown): boolean => target === node,
    focus: vi.fn(() => {
      browserDocument.activeElement = node;
    }),
  };
  (byId("account-load-state").props.ref as { current: unknown }).current = node;
  return node;
}

describe("account settings bootstrap recovery", () => {
  it("renders loading without default account details, tabs, or editable settings before all reads finish", async () => {
    const held = deferred<unknown>();
    fixtures.apiFetch.mockImplementation((path: string) =>
      path === "/v1/workspace/lti-registrations" ? held.promise : Promise.resolve(response(path)),
    );
    const route = harness();
    const markup = await route.settle();
    expect(markup).toContain('id="account-load-state"');
    expect(markup).toContain('aria-busy="true"');
    expect(markup).toContain('role="status"');
    expect(markup).not.toContain('role="tablist"');
    expect(markup).not.toContain("<form");
    expect(markup).not.toContain("Personal account");
    expect(markup).not.toContain("No LMS registrations");
    held.resolve(response("/v1/workspace/lti-registrations"));
    expect(await route.settle()).toContain('value="Trusted workspace"');
    route.dispose();
  });

  it.each(["/v1/account/embed-origins", "/v1/workspace/lti-registrations"])(
    "makes %s failure recoverable with GET-only Retry and preserves the selected hash",
    async (failed) => {
      browser.location.hash = "#appearance";
      fixtures.apiFetch.mockImplementation(async (path: string) => {
        if (path === failed) throw new Error("Read unavailable");
        return response(path);
      });
      const route = harness();
      let markup = await route.settle();
      expect(markup).toContain("Workspace settings are unavailable");
      expect(markup).not.toContain('role="tablist"');
      expect(markup).not.toContain("<form");
      expect(markup).not.toContain("Trusted live brand");
      const region = attachLoadRegion();
      const held = deferred<unknown>();
      fixtures.apiFetch.mockImplementation((path: string) =>
        path === failed ? held.promise : Promise.resolve(response(path)),
      );
      retry();
      expect(region.focus).toHaveBeenCalledOnce();
      markup = await route.settle();
      expect(markup).toContain('aria-busy="true"');
      expect(markup).not.toContain("Try again");
      held.resolve(response(failed));
      markup = await route.settle();
      expect(markup).toContain('value="Trusted live brand"');
      expect(markup).toContain('aria-labelledby="settings-tab-appearance"');
      expect(browser.location.hash).toBe("#appearance");
      const panel = { focus: vi.fn() };
      browserDocument.activeElement = browserDocument.body;
      (byId("settings-panel").props.ref as (node: unknown) => void)(panel);
      expect(panel.focus).toHaveBeenCalledOnce();
      expect(
        fixtures.apiFetch.mock.calls.every(([, init]) => !init?.method || init.method === "GET"),
      ).toBe(true);
      route.dispose();
    },
  );

  it("does not reclaim focus after the user focuses another control during retry", async () => {
    fixtures.apiFetch.mockRejectedValueOnce(new Error("Read unavailable"));
    const route = harness();
    await route.settle();
    attachLoadRegion();
    const held = deferred<unknown>();
    fixtures.apiFetch.mockImplementation((path: string) =>
      path === "/v1/auth/me" ? held.promise : Promise.resolve(response(path)),
    );
    retry();
    await route.settle();
    const other = {};
    browserDocument.activeElement = other;
    const focus = new Event("focusin");
    Object.defineProperty(focus, "target", { value: other });
    browserDocument.dispatchEvent(focus);
    held.resolve(account);
    await route.settle();
    const panel = { focus: vi.fn() };
    (byId("settings-panel").props.ref as (node: unknown) => void)(panel);
    expect(panel.focus).not.toHaveBeenCalled();
    route.dispose();
  });

  it("retains authenticated no-workspace personal account mode without loading workspace settings", async () => {
    fixtures.apiFetch
      .mockRejectedValueOnce(new ApiClientError("No workspace", "UNAUTHORIZED", 401))
      .mockResolvedValueOnce({
        user: { userId: "payer", email: "payer@example.org" },
        businessManagementEnabled: true,
      });
    const route = harness();
    const markup = await route.settle();
    expect(markup).toContain("Personal account");
    expect(markup).toContain("payer@example.org");
    expect(markup).not.toContain('id="account-load-state"');
    expect(fixtures.apiFetch).toHaveBeenCalledTimes(2);
    expect(fixtures.router.replace).not.toHaveBeenCalled();
    route.dispose();
  });

  it("commits the current account mode when a new authority generation changes workspace access", async () => {
    const identity = {
      user: { userId: "payer", email: "payer@example.org" },
      businessManagementEnabled: true,
    };
    fixtures.apiFetch
      .mockRejectedValueOnce(new ApiClientError("No workspace", "UNAUTHORIZED", 401))
      .mockResolvedValueOnce(identity);
    const route = harness();
    expect(await route.settle()).toContain("Personal account");
    fixtures.router = { replace: vi.fn() };
    let markup = await route.settle();
    expect(markup).toContain('value="Trusted workspace"');
    expect(markup).not.toContain("Personal account");
    fixtures.apiFetch
      .mockRejectedValueOnce(new ApiClientError("No workspace", "UNAUTHORIZED", 401))
      .mockResolvedValueOnce(identity);
    fixtures.router = { replace: vi.fn() };
    markup = await route.settle();
    expect(markup).toContain("Personal account");
    expect(markup).not.toContain("creator@example.org");
    expect(markup).not.toContain("Trusted workspace");
    route.dispose();
  });

  it("redirects confirmed unauthenticated access with pathname, query, and hash intact", async () => {
    browser.location.hash = "#security";
    fixtures.apiFetch.mockRejectedValue(new ApiClientError("Sign in", "UNAUTHORIZED", 401));
    const route = harness();
    await route.settle();
    expect(fixtures.router.replace).toHaveBeenCalledExactlyOnceWith(
      "/signin?returnTo=%2Faccount%3Ffrom%3Dsettings%23security",
    );
    route.dispose();
  });

  it.each(["/v1/auth/me", "/v1/auth/user"])(
    "shows recoverable unavailability instead of signing out on transient %s failure",
    async (failed) => {
      fixtures.apiFetch.mockImplementation(async (path: string) => {
        throw new ApiClientError(
          path === failed ? "Temporarily unavailable" : "No workspace",
          path === failed ? "UNAVAILABLE" : "UNAUTHORIZED",
          path === failed ? 503 : 401,
        );
      });
      const route = harness();
      expect(await route.settle()).toContain("Workspace settings are unavailable");
      expect(fixtures.router.replace).not.toHaveBeenCalled();
      route.dispose();
    },
  );

  it("does not reclassify a peripheral authentication error as successful billing-only settings", async () => {
    fixtures.apiFetch.mockImplementation(async (path: string) => {
      if (path === "/v1/workspace/lti-registrations")
        throw new ApiClientError("Session changed", "UNAUTHORIZED", 401);
      return response(path);
    });
    const route = harness();
    const markup = await route.settle();
    expect(markup).toContain("Workspace settings are unavailable");
    expect(markup).not.toContain("Personal account");
    expect(fixtures.apiFetch.mock.calls.some(([path]) => path === "/v1/auth/user")).toBe(false);
    expect(fixtures.router.replace).not.toHaveBeenCalled();
    route.dispose();
  });

  it.each([false, true])(
    "preserves loaded legacy/workspace shell mode: %s",
    async (workspaceShell) => {
      fixtures.apiFetch.mockImplementation(async (path: string) =>
        path === "/v1/auth/me"
          ? { ...account, productFeatures: { workspaceShell } }
          : response(path),
      );
      const route = harness();
      const markup = await route.settle();
      expect(markup.includes('data-shell="workspace"')).toBe(workspaceShell);
      expect(markup).toContain('value="Trusted workspace"');
      route.dispose();
    },
  );

  it("aborts on unmount and ignores a transport that resolves after disposal", async () => {
    const held = deferred<unknown>();
    fixtures.apiFetch.mockReturnValueOnce(held.promise);
    const route = harness();
    await route.settle();
    const signal = fixtures.apiFetch.mock.calls[0]![1].signal as AbortSignal;
    route.dispose();
    expect(signal.aborted).toBe(true);
    held.resolve(account);
    for (let index = 0; index < 8; index++) await Promise.resolve();
    expect(fixtures.apiFetch).toHaveBeenCalledTimes(1);
    expect(route.render()).not.toContain("Trusted workspace");
  });

  it("ignores obsolete initialization after a new generation loads a different trusted account", async () => {
    const stale = deferred<unknown>();
    fixtures.apiFetch.mockReturnValueOnce(stale.promise);
    const route = harness();
    await route.settle();
    const signal = fixtures.apiFetch.mock.calls[0]![1].signal as AbortSignal;
    fixtures.router = { replace: vi.fn() };
    expect(await route.settle()).toContain('value="Trusted workspace"');
    expect(signal.aborted).toBe(true);
    stale.resolve({ ...account, workspace: { ...account.workspace, name: "Obsolete workspace" } });
    expect(await route.settle()).not.toContain("Obsolete workspace");
    expect(fixtures.apiFetch.mock.calls.filter(([path]) => path === "/v1/auth/me")).toHaveLength(2);
    route.dispose();
  });
});
