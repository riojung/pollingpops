import {
  isValidElement,
  type ComponentProps,
  type FormEvent,
  type ReactElement,
  type ReactNode,
} from "react";
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
import { AUTH_CHANGE_EVENT, ApiClientError } from "../../lib/api";
import { appearanceMessages } from "../../lib/i18n/appearance-messages";
import { WorkspaceBrandSettings } from "./appearance-settings";
import { SettingsSectionRead } from "./settings-section-read";

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
const membersPath = "/v1/workspace/members?expectedWorkspaceId=workspace";
const ltiPath = "/v1/workspace/lti-registrations?expectedWorkspaceId=workspace";
const invitationPath = "/v1/workspace/invitations?expectedWorkspaceId=workspace";
const themePath = "/v1/account/theme?expectedWorkspaceId=workspace";
const brand = {
  organizationName: "Trusted live brand",
  primaryColor: "#39243C",
  accentColor: "#AC2855",
  colorMode: "dark",
} satisfies BrandTheme;

function response(path: string): unknown {
  if (path === "/v1/auth/me") return account;
  if (path === themePath) return { theme: brand, enabled: true };
  if (path === "/v1/workspaces")
    return {
      activeWorkspaceId: "workspace",
      workspaces: [{ id: "workspace", name: "Trusted workspace", role: "owner", homeRegion: "ca" }],
    };
  if (path === "/v1/account/embed-origins?expectedWorkspaceId=workspace")
    return { origins: ["https://trusted.example.org"] };
  if (path === "/v1/workspace/institution-policy?expectedWorkspaceId=workspace")
    return {
      contractStatus: "active",
      identityRequirement: "institution",
      capabilities: { lti: true },
      k12Enabled: false,
    };
  if (path === "/v1/auth/federated-identities?expectedWorkspaceId=workspace")
    return { identities: [] };
  if (path.startsWith("/v1/auth/oidc/status?"))
    return { enabled: true, providerName: "Trusted institution" };
  if (path === membersPath)
    return {
      members: [{ userId: "user", email: "creator@example.org", role: "owner" }],
      invitations: [],
    };
  if (path === ltiPath)
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
  location: { pathname: string; search: string; hash: string; reload: ReturnType<typeof vi.fn> };
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
    location: {
      pathname: "/account",
      search: "?from=settings",
      hash: "#overview",
      reload: vi.fn(),
    },
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
function retrySection(id: string) {
  const boundary = elements(byId(id)).find((node) => node.type === SettingsSectionRead)!;
  (boundary.props.onRetry as () => void)();
}
function navigateTo(hash: string) {
  browser.location.hash = hash;
  browser.dispatchEvent(new Event("hashchange"));
}
function settingsReads(path: string) {
  return fixtures.apiFetch.mock.calls.filter(
    ([url, init]) => url === path && (!init?.method || init.method === "GET"),
  );
}
function settingsWrites() {
  return fixtures.apiFetch.mock.calls.filter(([, init]) => init?.method && init.method !== "GET");
}
function brandSettings() {
  const node = elements(fixtures.tree).find((node) => node.type === WorkspaceBrandSettings);
  if (!node) throw new Error("Workspace brand settings were not rendered");
  return node.props as unknown as ComponentProps<typeof WorkspaceBrandSettings>;
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
  (byId("account-load-state").props.ref as (node: unknown) => void)(node);
  return node;
}

describe("workspace live brand availability", () => {
  it.each([
    { enabled: false, reason: "operator_policy", expected: "operator_policy" },
    { enabled: false, reason: "future_reason", expected: undefined },
    { enabled: false, reason: undefined, expected: undefined },
    { enabled: true, reason: undefined, expected: undefined },
  ])("uses the scoped theme grant and reason when the account grant differs %o", async (test) => {
    browser.location.hash = "#appearance";
    fixtures.apiFetch.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === "/v1/auth/me") {
        return { ...account, entitlements: { ...account.entitlements, brandTheme: !test.enabled } };
      }
      if (path === themePath) {
        if (init?.method === "PUT") return { theme: JSON.parse(String(init.body)) };
        return { theme: brand, enabled: test.enabled, unavailableReason: test.reason };
      }
      return response(path);
    });
    const route = harness();
    await route.settle();
    expect(brandSettings()).toMatchObject({
      entitled: test.enabled,
      unavailableReason: test.expected,
    });
    const draft = { ...brand, organizationName: "Draft brand" };
    brandSettings().onChange(draft);
    route.render();
    brandSettings().onSave({ preventDefault: vi.fn() } as unknown as FormEvent);
    await route.settle();
    expect(settingsWrites()).toHaveLength(test.enabled ? 1 : 0);
    if (test.enabled) expect(brandSettings().savedTheme).toEqual(draft);
    route.dispose();
  });

  it.each([
    { actorId: "user", workspaceId: "workspace", reason: "plan_limit", expected: "plan_limit" },
    {
      actorId: "user",
      workspaceId: "workspace",
      reason: "operator_policy",
      expected: "operator_policy",
    },
    { actorId: "other", workspaceId: "workspace", reason: "plan_limit", expected: undefined },
    { actorId: "user", workspaceId: "other", reason: "plan_limit", expected: undefined },
    { actorId: "user", workspaceId: "workspace", reason: "future_reason", expected: undefined },
    { actorId: undefined, workspaceId: undefined, reason: undefined, expected: undefined },
  ])("preserves a draft and reset after the current save is denied %o", async (test) => {
    browser.location.hash = "#appearance";
    fixtures.apiFetch.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === themePath && init?.method === "PUT") {
        throw new ApiClientError(
          "The server denied the save",
          "ENTITLEMENT_LIMIT",
          402,
          undefined,
          {
            actorId: test.actorId,
            workspaceId: test.workspaceId,
            unavailableReason: test.reason,
          },
        );
      }
      if (path === themePath && init?.method === "DELETE") return undefined;
      return response(path);
    });
    const route = harness();
    await route.settle();
    const original = brandSettings().savedTheme;
    const draft = { ...brand, organizationName: "Unsaved brand" };
    brandSettings().onChange(draft);
    route.render();
    const event = { preventDefault: vi.fn() } as unknown as FormEvent;
    brandSettings().onSave(event);
    const markup = await route.settle();
    expect(markup).not.toContain("The server denied the save");
    navigateTo("#overview");
    expect(await route.settle()).not.toContain('class="error"');
    navigateTo("#appearance");
    await route.settle();
    expect(brandSettings()).toMatchObject({
      entitled: false,
      unavailableReason: test.expected,
      busy: false,
      theme: draft,
      savedTheme: original,
    });
    brandSettings().onSave(event);
    await route.settle();
    expect(settingsWrites()).toHaveLength(1);
    expect(settingsWrites()[0]).toEqual([
      themePath,
      { method: "PUT", body: JSON.stringify(draft), signal: expect.any(AbortSignal) },
    ]);
    brandSettings().onReset();
    await route.settle();
    expect(settingsWrites()).toHaveLength(2);
    expect(settingsWrites()[1]).toEqual([
      themePath,
      { method: "DELETE", signal: expect.any(AbortSignal) },
    ]);
    expect(brandSettings().savedTheme).toBeNull();
    expect(brandSettings().entitled).toBe(false);
    expect(brandSettings().onRecheckAccess).toBeTypeOf("function");
    route.dispose();
  });

  it("announces a delayed save denial on the selected tab and retains the Appearance draft", async () => {
    browser.location.hash = "#appearance";
    const save = deferred<unknown>();
    fixtures.apiFetch.mockImplementation((path: string, init?: RequestInit) =>
      path === themePath && init?.method === "PUT" ? save.promise : Promise.resolve(response(path)),
    );
    const route = harness();
    const draft = { ...brand, organizationName: "Pending draft" };
    const { brandSaveOperatorPolicy: denial } = appearanceMessages("en-CA");
    await route.settle();
    brandSettings().onChange(draft);
    route.render();
    brandSettings().onSave({ preventDefault: vi.fn() } as unknown as FormEvent);
    navigateTo("#plan");
    expect(await route.settle()).not.toContain(denial);

    save.reject(
      new ApiClientError("The server denied the save", "ENTITLEMENT_LIMIT", 402, undefined, {
        actorId: "user",
        workspaceId: "workspace",
        unavailableReason: "operator_policy",
      }),
    );
    expect(await route.settle()).toContain(denial);
    const panel = byId("settings-panel");
    expect(panel.props["aria-labelledby"]).toBe("settings-tab-plan");
    const announcement = elements(panel).find((node) => node.props["aria-live"] === "polite");
    expect(elements(announcement).some((node) => node.props.children === denial)).toBe(true);

    navigateTo("#appearance");
    // The mock renders only the draft name. The real panel renders its own notice.
    expect(await route.settle()).not.toContain(denial);
    expect(brandSettings()).toMatchObject({
      entitled: false,
      unavailableReason: "operator_policy",
      theme: draft,
      savedTheme: brand,
    });
    navigateTo("#plan");
    expect(await route.settle()).not.toContain(denial);
    expect(settingsWrites()).toHaveLength(1);
    route.dispose();
  });

  it("rechecks only the scoped save access and preserves the draft until an explicit save", async () => {
    browser.location.hash = "#appearance";
    const restored = deferred<unknown>();
    const draft = { ...brand, organizationName: "Unsaved brand" };
    const serverTheme = { ...brand, organizationName: "Another saved theme" };
    const event = { preventDefault: vi.fn() } as unknown as FormEvent;
    fixtures.apiFetch.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path !== themePath) return response(path);
      if (init?.method === "PUT") {
        if (settingsWrites().length > 1) return { theme: JSON.parse(String(init.body)) };
        throw new ApiClientError("Save denied", "ENTITLEMENT_LIMIT", 402, undefined, {
          actorId: "user",
          workspaceId: "workspace",
          unavailableReason: "plan_limit",
        });
      }
      const reads = settingsReads(themePath).length;
      if (reads === 1) return response(path);
      if (reads === 2) throw new Error("Unable to check right now");
      if (reads === 3)
        return { theme: serverTheme, enabled: false, unavailableReason: "operator_policy" };
      return restored.promise;
    });
    const route = harness();
    await route.settle();
    brandSettings().onChange(draft);
    route.render();
    brandSettings().onSave(event);
    await route.settle();
    const originalRead = settingsReads(themePath)[0];

    brandSettings().onRecheckAccess!();
    expect(await route.settle()).toContain("Unable to check right now");
    expect(brandSettings()).toMatchObject({
      theme: draft,
      savedTheme: brand,
      entitled: false,
      unavailableReason: "plan_limit",
    });
    brandSettings().onRecheckAccess!();
    expect(await route.settle()).not.toContain("Unable to check right now");
    expect(brandSettings()).toMatchObject({
      theme: draft,
      savedTheme: brand,
      entitled: false,
      unavailableReason: "operator_policy",
    });

    const recheck = brandSettings().onRecheckAccess!;
    recheck();
    recheck();
    await route.settle();
    expect(settingsReads(themePath)).toEqual(Array(4).fill(originalRead));
    expect(brandSettings().checkingAccess).toBe(true);
    expect(settingsWrites()).toHaveLength(1);
    restored.resolve({ theme: serverTheme, enabled: true });
    expect(await route.settle()).toContain(appearanceMessages("en-CA").brandSaveAccessRestored);
    expect(brandSettings()).toMatchObject({
      theme: draft,
      savedTheme: brand,
      entitled: true,
      checkingAccess: false,
    });
    expect(brandSettings().onRecheckAccess).toBeUndefined();
    expect(settingsWrites()).toHaveLength(1);
    brandSettings().onSave(event);
    await route.settle();
    expect(settingsWrites()).toHaveLength(2);
    expect(settingsWrites()[1]).toEqual([
      themePath,
      { method: "PUT", body: JSON.stringify(draft), signal: expect.any(AbortSignal) },
    ]);
    expect(brandSettings().savedTheme).toEqual(draft);
    route.dispose();
  });

  it("ignores a pending brand access check when settings authority changes", async () => {
    browser.location.hash = "#appearance";
    const oldAccess = deferred<unknown>();
    fixtures.apiFetch.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === themePath && init?.method === "PUT") {
        throw new ApiClientError("Save denied", "ENTITLEMENT_LIMIT", 402);
      }
      if (path === themePath && settingsReads(themePath).length > 1) return oldAccess.promise;
      return response(path);
    });
    const route = harness();
    await route.settle();
    brandSettings().onSave({ preventDefault: vi.fn() } as unknown as FormEvent);
    await route.settle();
    brandSettings().onRecheckAccess!();
    await route.settle();
    const oldSignal = settingsReads(themePath)[1]?.[1]?.signal as AbortSignal;
    const currentBrand = { ...brand, organizationName: "Current workspace brand" };
    fixtures.apiFetch.mockImplementation(async (path: string) =>
      path === themePath ? { theme: currentBrand, enabled: true } : response(path),
    );
    browser.dispatchEvent(new Event(AUTH_CHANGE_EVENT));
    expect(oldSignal.aborted).toBe(true);
    await route.settle();
    oldAccess.resolve({ enabled: false, unavailableReason: "operator_policy" });
    await route.settle();
    expect(brandSettings()).toMatchObject({
      theme: currentBrand,
      savedTheme: currentBrand,
      entitled: true,
      checkingAccess: false,
    });
    expect(brandSettings().onRecheckAccess).toBeUndefined();
    route.dispose();
  });
});

describe("account settings bootstrap recovery", () => {
  it("withholds account details and owner reads until all required reads finish", async () => {
    const held = deferred<unknown>();
    fixtures.apiFetch.mockImplementation((path: string) =>
      path === "/v1/account/embed-origins?expectedWorkspaceId=workspace"
        ? held.promise
        : Promise.resolve(response(path)),
    );
    const route = harness();
    const markup = await route.settle();
    expect(markup).toContain('id="account-load-state"');
    expect(markup).toContain('aria-busy="true"');
    expect(markup).toContain('role="status"');
    expect(markup).not.toContain('role="tablist"');
    expect(markup).not.toContain("<form");
    expect(markup).not.toContain("Personal account");
    expect(settingsReads(membersPath)).toHaveLength(0);
    expect(settingsReads(ltiPath)).toHaveLength(0);

    held.resolve(response("/v1/account/embed-origins?expectedWorkspaceId=workspace"));
    expect(await route.settle()).toContain('value="Trusted workspace"');
    expect(settingsReads(membersPath)).toHaveLength(1);
    expect(settingsReads(ltiPath)).toHaveLength(1);
    route.dispose();
  });

  it("makes a required read failure recoverable with GET-only Retry and preserves the selected hash", async () => {
    const failed = "/v1/account/embed-origins?expectedWorkspaceId=workspace";
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
    expect(settingsReads(membersPath)).toHaveLength(0);
    expect(settingsReads(ltiPath)).toHaveLength(0);
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
    expect(settingsWrites()).toHaveLength(0);
    route.dispose();
  });

  it.each([true, false])(
    "withdraws the rename form on workspace conflict, focus inside: %s",
    async (inside) => {
      browser.location.hash = "#overview";
      const conflict = new ApiClientError("The active workspace changed", "CONFLICT", 409);
      const held = deferred<unknown>();
      fixtures.apiFetch.mockImplementation(async (path: string, init?: RequestInit) => {
        if (init?.method === "PATCH") return held.promise;
        return response(path);
      });
      const route = harness();
      expect(await route.settle()).toContain('id="workspace-name"');
      const focusedControl = {};
      const movedFocus = {};
      (byId("account-settings-content").props.ref as { current: unknown }).current = {
        contains: (target: unknown) => target === focusedControl,
      };
      browserDocument.activeElement = focusedControl;
      const focus = new Event("focusin");
      Object.defineProperty(focus, "target", { value: focusedControl });
      browserDocument.dispatchEvent(focus);
      const form = elements(fixtures.tree).find(
        (node) =>
          node.type === "form" &&
          elements(node).some((element) => element.props.id === "workspace-name"),
      )!;
      const pending = (
        form.props.onSubmit as (event: { preventDefault: () => void }) => Promise<void>
      )({
        preventDefault() {},
      });
      await route.settle();
      browserDocument.activeElement = inside ? browserDocument.body : movedFocus;
      held.reject(conflict);
      await pending;
      const markup = await route.settle();
      expect(markup).toContain("The active workspace changed");
      expect(markup).not.toContain('id="workspace-name"');
      const region = attachLoadRegion();
      expect(region.focus).toHaveBeenCalledTimes(inside ? 1 : 0);
      if (!inside) expect(browserDocument.activeElement).toBe(movedFocus);
      expect(settingsWrites()).toEqual([
        [
          "/v1/workspace/settings?expectedWorkspaceId=workspace",
          {
            method: "PATCH",
            body: JSON.stringify({ name: "Trusted workspace" }),
            signal: expect.objectContaining({ aborted: true }),
          },
        ],
      ]);
      retry();
      expect(await route.settle()).toContain('id="workspace-name"');
      expect(settingsWrites()).toHaveLength(1);
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

  it("does not reclassify a required settings authentication error as successful billing-only settings", async () => {
    fixtures.apiFetch.mockImplementation(async (path: string) => {
      if (path === "/v1/workspace/institution-policy?expectedWorkspaceId=workspace")
        throw new ApiClientError("Session changed", "UNAUTHORIZED", 401);
      return response(path);
    });
    const route = harness();
    const markup = await route.settle();
    expect(markup).toContain("Workspace settings are unavailable");
    expect(markup).not.toContain("Personal account");
    expect(settingsReads("/v1/auth/user")).toHaveLength(0);
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

describe("owner settings section recovery", () => {
  const unavailable = "This section is unavailable.";

  it.each([
    [membersPath, ltiPath],
    [ltiPath, membersPath],
  ])("reloads workspace authority after %s conflicts", async (conflicting, pending) => {
    browser.location.hash = "#people";
    const conflict = deferred<unknown>();
    const sibling = deferred<unknown>();
    fixtures.apiFetch.mockImplementation((path: string) => {
      if (path === conflicting) return conflict.promise;
      if (path === pending) return sibling.promise;
      return Promise.resolve(response(path));
    });
    const route = harness();
    expect(await route.settle()).toContain('id="account-members-section"');
    const originalRead = settingsReads(pending)[0]![1].signal as AbortSignal;
    const changed = new ApiClientError("The active workspace changed", "CONFLICT", 409);
    conflict.reject(changed);
    let markup = await route.settle();
    expect(markup).toContain("Workspace settings are unavailable");
    expect(markup).toContain(changed.message);
    expect(markup).not.toContain(unavailable);
    expect(markup).not.toContain('id="settings-panel"');
    expect(originalRead.aborted).toBe(true);

    const workspaceId = "current-workspace";
    const workspace = { id: workspaceId, name: "Current workspace", role: "editor" };
    fixtures.apiFetch.mockImplementation(async (path: string) => {
      if (path === "/v1/auth/me") {
        return {
          ...account,
          creator: { ...account.creator, workspaceId, role: workspace.role },
          workspace: {
            ...account.workspace,
            id: workspace.id,
            name: workspace.name,
            permissions: {
              manageWorkspace: false,
              managePeople: false,
              manageBilling: false,
              manageIntegrations: false,
            },
          },
        };
      }
      if (path === "/v1/workspaces")
        return { activeWorkspaceId: workspaceId, workspaces: [workspace] };
      return response(
        path.replace("?expectedWorkspaceId=current-workspace", "?expectedWorkspaceId=workspace"),
      );
    });
    retry();
    markup = await route.settle();
    expect(settingsReads("/v1/auth/me")).toHaveLength(2);
    expect(settingsReads(`/v1/account/theme?expectedWorkspaceId=${workspaceId}`)).toHaveLength(1);
    expect(settingsReads(membersPath)).toHaveLength(1);
    expect(settingsReads(ltiPath)).toHaveLength(1);
    expect(settingsWrites()).toHaveLength(0);
    expect(markup).toContain("Current workspace");
    expect(markup).not.toContain("Workspace settings are unavailable");

    sibling.reject(changed);
    expect(await route.settle()).toContain("Current workspace");
    route.dispose();
  });

  it("loads both sections independently and retries members alone after a local failure", async () => {
    browser.location.hash = "#people";
    const members = deferred<unknown>();
    const lti = deferred<unknown>();
    fixtures.apiFetch.mockImplementation((path: string) =>
      path === membersPath
        ? members.promise
        : path === ltiPath
          ? lti.promise
          : Promise.resolve(response(path)),
    );
    const route = harness();
    let markup = await route.settle();
    expect(markup).toContain('role="tablist"');
    expect(markup).toContain('id="account-members-section"');
    expect(markup).toContain("Loading this section");
    expect(markup).not.toContain("Invite member");
    expect(markup).not.toContain("<table");
    expect(settingsReads(membersPath)).toHaveLength(1);
    expect(settingsReads(ltiPath)).toHaveLength(1);

    members.reject(new ApiClientError("Session changed", "UNAUTHORIZED", 401));
    markup = await route.settle();
    expect(markup).toContain(unavailable);
    expect(markup).not.toContain("Workspace settings are unavailable");
    expect(markup).not.toContain("Invite member");
    expect(settingsReads("/v1/auth/user")).toHaveLength(0);
    expect(fixtures.router.replace).not.toHaveBeenCalled();

    const retry = deferred<unknown>();
    fixtures.apiFetch.mockImplementation((path: string) =>
      path === membersPath ? retry.promise : Promise.resolve(response(path)),
    );
    retrySection("account-members-section");
    expect(await route.settle()).toContain("Loading this section");
    retry.resolve(response(membersPath));
    markup = await route.settle();
    expect(markup).toContain("Invite member");
    expect(markup).toContain("<td>creator@example.org</td>");
    expect(settingsReads(membersPath)).toHaveLength(2);
    expect(settingsReads(ltiPath)).toHaveLength(1);
    expect(settingsReads("/v1/auth/me")).toHaveLength(1);
    expect(settingsWrites()).toHaveLength(0);

    lti.resolve(response(ltiPath));
    navigateTo("#security");
    expect(await route.settle()).toContain("Trusted LMS");
    route.dispose();
  });

  it("keeps security, billing, and Privacy usable after LTI fails and distinguishes a confirmed empty retry", async () => {
    browser.location.hash = "#security";
    fixtures.apiFetch.mockImplementation(async (path: string) => {
      if (path === ltiPath) throw new ApiClientError("Unavailable", "UNAVAILABLE", 503);
      return response(path);
    });
    const route = harness();
    let markup = await route.settle();
    expect(markup).toContain("Idle timeout");
    expect(markup).toContain("Secure embed origins");
    expect(markup).toContain("https://trusted.example.org");
    expect(markup).toContain(unavailable);
    expect(markup).not.toContain("no platform is registered");

    navigateTo("#plan");
    expect(await route.settle()).toContain("Explore Pro");
    navigateTo("#data");
    markup = await route.settle();
    expect(markup).toContain("Institution identities");
    expect(markup).toContain("delete-confirmation");
    expect(markup).toMatch(/<button class="button-danger" disabled="" type="submit"/);
    navigateTo("#security");
    expect(await route.settle()).toContain(unavailable);

    fixtures.apiFetch.mockImplementation(async (path: string) =>
      path === ltiPath ? { registrations: [] } : response(path),
    );
    retrySection("account-lti-section");
    markup = await route.settle();
    expect(markup).toContain("no platform is registered");
    expect(markup).not.toContain(unavailable);
    expect(settingsReads(membersPath)).toHaveLength(1);
    expect(settingsReads(ltiPath)).toHaveLength(2);
    expect(settingsReads("/v1/auth/me")).toHaveLength(1);
    expect(settingsWrites()).toHaveLength(0);
    route.dispose();
  });

  it("aborts a pending section retry on tab leave and ignores a late response after returning", async () => {
    browser.location.hash = "#security";
    const retry = deferred<unknown>();
    fixtures.apiFetch.mockImplementation(async (path: string) => {
      if (path === ltiPath) throw new Error("Unavailable");
      return response(path);
    });
    const route = harness();
    expect(await route.settle()).toContain(unavailable);
    fixtures.apiFetch.mockImplementation((path: string) =>
      path === ltiPath ? retry.promise : Promise.resolve(response(path)),
    );
    retrySection("account-lti-section");
    expect(await route.settle()).toContain("Loading this section");
    const signal = settingsReads(ltiPath)[1]![1].signal as AbortSignal;

    navigateTo("#people");
    expect(await route.settle()).toContain("Invite member");
    expect(signal.aborted).toBe(true);
    fixtures.apiFetch.mockImplementation(async (path: string) => response(path));
    navigateTo("#security");
    expect(await route.settle()).toContain("Trusted LMS");

    retry.resolve({ registrations: [{ id: "old", name: "Obsolete LMS" }] });
    expect(await route.settle()).not.toContain("Obsolete LMS");
    expect(settingsReads(ltiPath)).toHaveLength(3);
    expect(settingsReads(membersPath)).toHaveLength(1);
    route.dispose();
  });

  it.each(["editor", "viewer"] as const)(
    "never reads owner endpoints for an organization %s with organization member-management permission",
    async (role) => {
      browser.location.hash = "#people";
      fixtures.apiFetch.mockImplementation(async (path: string) =>
        path === "/v1/auth/me"
          ? {
              ...account,
              creator: { ...account.creator, role },
              workspace: {
                ...account.workspace,
                accountType: "organization",
                organization: { id: "org", name: "Trusted organization", role: "admin" },
              },
            }
          : response(path),
      );
      const route = harness();
      const markup = await route.settle();
      expect(markup).toContain("/organization?organizationId=org#members");
      expect(markup).not.toContain("Invite member");
      navigateTo("#security");
      expect(await route.settle()).not.toContain("account-lti-section");
      expect(settingsReads(membersPath)).toHaveLength(0);
      expect(settingsReads(ltiPath)).toHaveLength(0);
      route.dispose();
    },
  );

  it("excludes member reads for user-license organizations without withholding owner LTI", async () => {
    browser.location.hash = "#people";
    fixtures.apiFetch.mockImplementation(async (path: string) =>
      path === "/v1/auth/me"
        ? {
            ...account,
            workspace: {
              ...account.workspace,
              accountType: "organization",
              licenseUnit: "user",
              organization: { id: "org", name: "Trusted organization", role: "owner" },
            },
          }
        : response(path),
    );
    const route = harness();
    expect(await route.settle()).toContain("/organization?organizationId=org#members");
    navigateTo("#security");
    expect(await route.settle()).toContain("Trusted LMS");
    expect(settingsReads(membersPath)).toHaveLength(0);
    expect(settingsReads(ltiPath)).toHaveLength(1);
    route.dispose();
  });

  it("retains the owner LTI read when the trusted policy keeps its section hidden", async () => {
    browser.location.hash = "#security";
    fixtures.apiFetch.mockImplementation(async (path: string) =>
      path === "/v1/workspace/institution-policy?expectedWorkspaceId=workspace"
        ? { contractStatus: "active", capabilities: { lti: false } }
        : response(path),
    );
    const route = harness();
    expect(await route.settle()).not.toContain("account-lti-section");
    expect(settingsReads(ltiPath)).toHaveLength(1);
    route.dispose();
  });

  it("retries a failed post-invitation refresh without sending another invitation", async () => {
    browser.location.hash = "#people";
    const route = harness();
    expect(await route.settle()).toContain("Invite member");
    const first = elements(byId("account-members-section")).find(
      (node) => node.type === "input" && node.props.type === "email",
    )!;
    (first.props.onChange as (event: unknown) => void)({
      target: { value: "invitee@example.org" },
    });
    await route.settle();

    fixtures.apiFetch.mockImplementation(async (path: string) => {
      if (path === membersPath) throw new Error("Refresh unavailable");
      if (path === invitationPath)
        return {
          invitation: { email: "invitee@example.org" },
          debugUrl: "https://trusted.example.org/invite",
        };
      return response(path);
    });
    const form = elements(byId("account-members-section")).find((node) => node.type === "form")!;
    const focusedField = {};
    browserDocument.activeElement = focusedField;
    const region = {
      focus: vi.fn(),
      querySelector: () => ({ contains: (node: unknown) => node === focusedField }),
    };
    (byId("account-members-section").props.ref as { current: unknown }).current = region;
    (form.props.onSubmit as (event: unknown) => void)({ preventDefault: vi.fn() });
    let markup = await route.settle();
    expect(region.focus).toHaveBeenCalledOnce();
    expect(markup).toContain("invitee@example.org");
    expect(markup).toContain('href="https://trusted.example.org/invite"');
    expect(markup).toContain(unavailable);
    expect(markup).not.toContain("Invite member");
    expect(settingsReads(membersPath)).toHaveLength(2);

    fixtures.apiFetch.mockImplementation(async (path: string) => response(path));
    retrySection("account-members-section");
    markup = await route.settle();
    expect(markup).toContain("Invite member");
    expect(markup).not.toContain(unavailable);
    expect(settingsReads(membersPath)).toHaveLength(3);
    expect(settingsReads(ltiPath)).toHaveLength(1);
    expect(settingsWrites()).toEqual([
      [invitationPath, { method: "POST", body: '{"email":"invitee@example.org","role":"editor"}' }],
    ]);
    route.dispose();
  });

  it("defers a committed invitation refresh while People is closed", async () => {
    browser.location.hash = "#people";
    const invitation = deferred<unknown>();
    fixtures.apiFetch.mockImplementation((path: string) =>
      path === invitationPath ? invitation.promise : Promise.resolve(response(path)),
    );
    const route = harness();
    expect(await route.settle()).toContain("Invite member");
    const form = elements(byId("account-members-section")).find((node) => node.type === "form")!;
    (form.props.onSubmit as (event: unknown) => void)({ preventDefault: vi.fn() });
    navigateTo("#data");
    await route.settle();
    invitation.resolve({ invitation: { email: "invitee@example.org" } });
    expect(await route.settle()).toContain("invitee@example.org");
    expect(settingsReads(membersPath)).toHaveLength(1);

    navigateTo("#people");
    expect(await route.settle()).toContain("Invite member");
    expect(settingsReads(membersPath)).toHaveLength(2);
    expect(settingsWrites()).toHaveLength(1);
    route.dispose();
  });

  it("aborts both owner requests at workspace selection and rechecks authority after a failed selection", async () => {
    const members = deferred<unknown>();
    const lti = deferred<unknown>();
    const selection = deferred<unknown>();
    const workspaceList = {
      activeWorkspaceId: "workspace",
      workspaces: [
        { id: "workspace", name: "Trusted workspace", role: "owner" },
        { id: "other", name: "Other workspace", role: "viewer" },
      ],
    };
    fixtures.apiFetch.mockImplementation((path: string) => {
      if (path === "/v1/workspaces") return Promise.resolve(workspaceList);
      if (path === membersPath) return members.promise;
      if (path === ltiPath) return lti.promise;
      if (path === "/v1/workspaces/other/select") return selection.promise;
      return Promise.resolve(response(path));
    });
    const route = harness();
    await route.settle();
    const signals = [membersPath, ltiPath].map(
      (path) => settingsReads(path)[0]![1].signal as AbortSignal,
    );
    (byId("active-workspace").props.onChange as (event: unknown) => void)({
      target: { value: "other" },
    });
    expect(signals.every((signal) => signal.aborted)).toBe(true);
    const pending = await route.settle();
    expect(pending).toContain("account-load-state");
    expect(pending).not.toContain("Trusted workspace");

    members.resolve({ members: [{ userId: "old", email: "old@example.org" }], invitations: [] });
    lti.resolve({ registrations: [{ id: "old", name: "Obsolete LMS" }] });
    fixtures.apiFetch.mockImplementation(async (path: string) => response(path));
    selection.reject(new Error("Workspace selection failed"));
    expect(await route.settle()).toContain("Workspace selection failed");
    expect(settingsReads("/v1/auth/me")).toHaveLength(2);
    expect(browser.location.reload).not.toHaveBeenCalled();

    navigateTo("#people");
    const markup = await route.settle();
    expect(markup).toContain("<td>creator@example.org</td>");
    expect(markup).not.toContain("old@example.org");
    navigateTo("#security");
    expect(await route.settle()).not.toContain("Obsolete LMS");
    route.dispose();
  });

  it("does not publish a late invitation result or refresh after authority changes", async () => {
    browser.location.hash = "#people";
    const invitation = deferred<unknown>();
    fixtures.apiFetch.mockImplementation((path: string) =>
      path === invitationPath ? invitation.promise : Promise.resolve(response(path)),
    );
    const route = harness();
    expect(await route.settle()).toContain("Invite member");
    const form = elements(byId("account-members-section")).find((node) => node.type === "form")!;
    (form.props.onSubmit as (event: unknown) => void)({ preventDefault: vi.fn() });

    browser.dispatchEvent(new Event(AUTH_CHANGE_EVENT));
    expect(await route.settle()).toContain("Invite member");
    invitation.resolve({
      invitation: { email: "old-invitee@example.org" },
      debugUrl: "https://obsolete.example.org/invite",
    });
    const markup = await route.settle();
    expect(markup).not.toContain("old-invitee@example.org");
    expect(markup).not.toContain("https://obsolete.example.org/invite");
    expect(settingsReads(membersPath)).toHaveLength(2);
    expect(settingsWrites()).toHaveLength(1);
    route.dispose();
  });

  it("aborts section reads when a new identity changes owner authority", async () => {
    browser.location.hash = "#security";
    const members = deferred<unknown>();
    const lti = deferred<unknown>();
    fixtures.apiFetch.mockImplementation((path: string) =>
      path === membersPath
        ? members.promise
        : path === ltiPath
          ? lti.promise
          : Promise.resolve(response(path)),
    );
    const route = harness();
    expect(await route.settle()).toContain("Loading this section");
    const signals = [membersPath, ltiPath].map(
      (path) => settingsReads(path)[0]![1].signal as AbortSignal,
    );

    fixtures.apiFetch.mockImplementation(async (path: string) =>
      path === "/v1/auth/me"
        ? {
            ...account,
            creator: { ...account.creator, userId: "different", role: "viewer" },
            workspace: {
              ...account.workspace,
              permissions: { ...account.workspace.permissions, managePeople: false },
            },
          }
        : response(path),
    );
    browser.dispatchEvent(new Event(AUTH_CHANGE_EVENT));
    expect(signals.every((signal) => signal.aborted)).toBe(true);
    members.resolve(response(membersPath));
    lti.resolve(response(ltiPath));
    expect(await route.settle()).not.toContain("account-lti-section");
    expect(settingsReads(membersPath)).toHaveLength(1);
    expect(settingsReads(ltiPath)).toHaveLength(1);
    expect(settingsReads("/v1/auth/me")).toHaveLength(2);
    route.dispose();
  });
});

describe("account plan availability", () => {
  it.each([
    { plan: "free", csvExport: true, label: "CSV export available", billingAction: "Explore Pro" },
    {
      plan: "pro",
      csvExport: false,
      label: "CSV export unavailable",
      billingAction: "Manage billing",
    },
  ] as const)("reports effective CSV availability for a $plan workspace", async (scenario) => {
    browser.location.hash = "#plan";
    fixtures.apiFetch.mockImplementation(async (path: string) => {
      if (path === "/v1/auth/me")
        return {
          ...account,
          creator: { ...account.creator, plan: scenario.plan },
          workspace: {
            ...account.workspace,
            planSource: scenario.plan === "free" ? "free" : "subscription",
          },
          entitlements: {
            ...account.entitlements,
            plan: scenario.plan,
            csvExport: scenario.csvExport,
          },
        };
      if (path === "/v1/billing/status" && scenario.plan === "pro")
        return {
          billing: {
            status: "active",
            customerId: "fixture-customer",
            subscriptionId: "fixture-subscription",
          },
        };
      return response(path);
    });
    const route = harness();
    try {
      const markup = await route.settle();
      expect(markup).toContain(scenario.label);
      expect(markup).toContain(scenario.billingAction);
      expect(markup).not.toContain("CSV requires Pro");
    } finally {
      route.dispose();
    }
  });

  it.each(["hosted", "community"] as const)(
    "distinguishes %s billing unavailability without requesting billing status",
    async (deployment) => {
      browser.location.hash = "#plan";
      const community = deployment === "community";
      const plan = community ? "team" : "free";
      fixtures.apiFetch.mockImplementation(async (path: string) =>
        path === "/v1/auth/me"
          ? {
              ...account,
              creator: { ...account.creator, role: community ? "owner" : "viewer", plan },
              workspace: {
                ...account.workspace,
                planSource: community ? "community" : "free",
                permissions: {
                  manageWorkspace: community,
                  managePeople: community,
                  manageBilling: community,
                  manageIntegrations: community,
                },
              },
              entitlements: { ...account.entitlements, plan },
            }
          : response(path),
      );
      const route = harness();
      try {
        const markup = await route.settle();
        const hostedNotice = "Billing management is unavailable for this account.";
        const communityNotice = "Features are provided by this installation";
        expect(markup).toContain(community ? communityNotice : hostedNotice);
        expect(markup).not.toContain(community ? hostedNotice : communityNotice);
        expect(markup).not.toContain("Limits are controlled by your community operator.");
        expect(markup).not.toContain("Manage billing");
        expect(markup).not.toContain("Explore Pro");
        expect(fixtures.apiFetch.mock.calls.some(([path]) => path === "/v1/billing/status")).toBe(
          false,
        );
      } finally {
        route.dispose();
      }
    },
  );
});
