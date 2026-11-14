import { isValidElement, type ReactElement, type ReactNode } from "react";
import type * as ReactModule from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupportedLocale } from "@openround/contracts";
import { apiFetch, ApiClientError } from "../../lib/api";
import type * as ApiModule from "../../lib/api";
import { presentationWorkspaceCopy } from "../../lib/i18n/presentation-workspace-copy";
import { PresentationStageLauncher } from "./stage-launcher";

type Effect = { deps?: readonly unknown[]; run: () => void | (() => void); cleanup?: () => void };
type LauncherHooks = {
  cursor: number;
  states: unknown[];
  effects: Map<number, Effect>;
  pending: Effect[];
};
const fixture = vi.hoisted(() => ({
  hooks: null as LauncherHooks | null,
  locale: "en-CA" as SupportedLocale,
}));

vi.mock("../locale-provider", () => ({
  useLocale: () => ({ locale: fixture.locale }),
}));
vi.mock("../../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof ApiModule>()),
  apiFetch: vi.fn(),
}));
vi.mock("react", async (importOriginal) => {
  const react = await importOriginal<typeof ReactModule>();
  return {
    ...react,
    useState: <T,>(initial: T | (() => T)) => {
      const hooks = fixture.hooks;
      if (!hooks) return react.useState(initial);
      const index = hooks.cursor++;
      if (!(index in hooks.states))
        hooks.states[index] = typeof initial === "function" ? (initial as () => T)() : initial;
      return [hooks.states[index] as T, (next: T) => (hooks.states[index] = next)];
    },
    useRef: <T,>(initial: T) => {
      const hooks = fixture.hooks;
      if (!hooks) return react.useRef(initial);
      const index = hooks.cursor++;
      if (!(index in hooks.states)) hooks.states[index] = { current: initial };
      return hooks.states[index];
    },
    useEffect: (run: Effect["run"], deps?: readonly unknown[]) => {
      const hooks = fixture.hooks;
      if (!hooks) return react.useEffect(run, deps);
      const index = hooks.cursor++;
      const previous = hooks.effects.get(index);
      if (previous && deps?.every((value, position) => Object.is(value, previous.deps?.[position])))
        return;
      previous?.cleanup?.();
      const effect = { run, deps };
      hooks.effects.set(index, effect);
      hooks.pending.push(effect);
    },
  };
});

beforeEach(() => vi.mocked(apiFetch).mockReset());
afterEach(() => {
  fixture.hooks = null;
  fixture.locale = "en-CA";
  vi.unstubAllGlobals();
});

function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement<Record<string, unknown>>(node)) return [];
  return [node, ...elements(node.props.children as ReactNode)];
}

function launcherHarness() {
  const hooks: LauncherHooks = { cursor: 0, states: [], effects: new Map(), pending: [] };
  function render() {
    fixture.hooks = hooks;
    hooks.cursor = 0;
    try {
      return PresentationStageLauncher({ sessionId: "session-a", canEdit: true, finished: false });
    } finally {
      fixture.hooks = null;
      for (const effect of hooks.pending.splice(0)) effect.cleanup = effect.run() ?? undefined;
    }
  }
  render();
  return {
    markup: () => renderToStaticMarkup(render()),
    async click(name: string) {
      const button = elements(render()).find(
        (element) => element.type === "button" && element.props.children === name,
      );
      if (!button || button.props.disabled) throw new Error(`Expected enabled ${name} button`);
      (button.props.onClick as () => void)();
      await Promise.resolve();
      await Promise.resolve();
      render();
    },
    unmount: () => hooks.effects.forEach((effect) => effect.cleanup?.()),
  };
}

function browser(open: () => unknown) {
  const values = new Map<string, string>();
  const sessionStorage = {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => values.set(key, value)),
    removeItem: vi.fn((key: string) => values.delete(key)),
  };
  vi.stubGlobal("sessionStorage", sessionStorage);
  vi.stubGlobal("window", { sessionStorage, location: { origin: "https://example.test" }, open });
  return { values, sessionStorage };
}

const pass = {
  credentialId: "11111111-1111-4111-8111-111111111111",
  stageToken: "stage+read-only/&?#= %é".repeat(3),
  expiresAt: "2026-11-14T12:00:00.000Z",
};

describe("Audience stage launcher localization", () => {
  it.each([
    ["ko-KR", "참여자 화면 제어", "참여자 화면 열기"],
    ["de-DE", "Steuerung der Publikumsbühne", "Publikumsbühne öffnen"],
  ] as const)("renders %s stage access chrome", (locale, label, launch) => {
    fixture.locale = locale;
    const copy = presentationWorkspaceCopy(locale);
    const markup = renderToStaticMarkup(
      <PresentationStageLauncher sessionId="session" canEdit finished={false} />,
    );
    expect(markup).toContain(`lang="${locale}"`);
    expect(markup).toContain(`aria-label="${label}"`);
    expect(markup).toContain(launch);
    expect(markup).toContain(
      copy("Share the audience stage window. Presenter notes and controls stay in this workspace."),
    );
    expect(markup).not.toContain('aria-label="Audience stage controls"');
  });

  it("keeps the blocked-popup pass and revoke identity while changing locale", async () => {
    const open = vi.fn(() => null);
    const { sessionStorage } = browser(open);
    vi.mocked(apiFetch).mockResolvedValueOnce(pass).mockResolvedValueOnce(undefined);
    const launcher = launcherHarness();
    await launcher.click("Open audience stage");
    expect(open).toHaveBeenCalledWith("about:blank", "_blank", "popup,width=1280,height=800");
    expect(apiFetch).toHaveBeenNthCalledWith(1, "/v1/presentation-sessions/session-a/stage-pass", {
      method: "POST",
    });
    expect(sessionStorage.setItem).toHaveBeenCalledWith(
      "openround:presentation-stage-credential:session-a",
      pass.credentialId,
    );
    const english = launcher.markup();
    const href = english.match(/href="([^"]+)"/)?.[1];
    expect(href).toBeDefined();
    const destination = new URL(href!);
    expect(destination.pathname).toBe("/presentation-session/session-a/stage");
    expect(destination.search).toBe("");
    expect(new URLSearchParams(destination.hash.slice(1)).get("pass")).toBe(pass.stageToken);

    fixture.locale = "ko-KR";
    const korean = presentationWorkspaceCopy("ko-KR");
    expect(launcher.markup()).toContain(
      korean(
        "Your browser blocked the stage window. Open it using this link, then share that tab.",
      ),
    );
    expect(launcher.markup()).toContain(korean("Open audience stage in a new tab"));
    expect(launcher.markup()).toContain(`href="${href}"`);
    expect(launcher.markup()).toContain('rel="noopener noreferrer"');
    expect(apiFetch).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem).toHaveBeenCalledTimes(1);
    await launcher.click(korean("Revoke audience stage access"));
    expect(apiFetch).toHaveBeenNthCalledWith(
      2,
      `/v1/presentation-sessions/session-a/stage-passes/${pass.credentialId}`,
      { method: "DELETE" },
    );
    expect(sessionStorage.removeItem).toHaveBeenCalledWith(
      "openround:presentation-stage-credential:session-a",
    );
    expect(launcher.markup()).not.toContain("href=");
    expect(launcher.markup()).not.toContain(korean("Revoke audience stage access"));
    launcher.unmount();
  });

  it("localizes stale-revocation guidance while preserving the original service diagnostic", async () => {
    const { values } = browser(vi.fn(() => null));
    values.set("openround:presentation-stage-credential:session-a", pass.credentialId);
    const diagnostic = "Synthetic service detail: stage-123 $& {pass}";
    vi.mocked(apiFetch).mockRejectedValueOnce(new ApiClientError(diagnostic, "CONFLICT", 409));
    fixture.locale = "de-DE";
    const copy = presentationWorkspaceCopy("de-DE");
    const launcher = launcherHarness();
    await launcher.click(copy("Revoke audience stage access"));
    const markup = launcher.markup();
    expect(markup).toContain('role="alert" class="error" lang="en-CA"');
    expect(markup).toContain("Synthetic service detail: stage-123 $&amp; {pass}");
    expect(markup).toContain(
      copy(
        "Use the host tab that opened the current stage, or open a replacement stage here and then revoke it.",
      ),
    );
    expect(values.get("openround:presentation-stage-credential:session-a")).toBe(pass.credentialId);
    launcher.unmount();
  });
});
