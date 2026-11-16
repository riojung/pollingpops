import { renderToStaticMarkup } from "react-dom/server";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import type * as ReactModule from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceAccountContext } from "../../components/workspace/workspace-provider";
import { SESSION_POLICY_UPDATED_EVENT } from "../../lib/idle-session";
import { IdleTimeoutSettings } from "./idle-timeout-settings";

const mocked = vi.hoisted(() => ({
  capture: false,
  cursor: 0,
  states: [] as unknown[],
  apiFetch: vi.fn(),
}));
vi.mock("react", async (loadOriginal) => {
  const original = await loadOriginal<typeof ReactModule>();
  return {
    ...original,
    useState: <T,>(initial: T) => {
      if (!mocked.capture) return original.useState(initial);
      const index = mocked.cursor++;
      if (!(index in mocked.states)) mocked.states[index] = initial;
      return [
        mocked.states[index],
        (value: T) => {
          mocked.states[index] = value;
        },
      ];
    },
    useEffect: (effect: ReactModule.EffectCallback, dependencies?: readonly unknown[]) => {
      if (!mocked.capture) original.useEffect(effect, dependencies);
    },
  };
});
vi.mock("../../components/locale-provider", () => ({ useLocale: () => ({ locale: "en-CA" }) }));
vi.mock("../../lib/api", () => ({ apiFetch: mocked.apiFetch }));
afterEach(() => {
  mocked.capture = false;
  mocked.states = [];
  mocked.apiFetch.mockReset();
  vi.unstubAllGlobals();
});

function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement<Record<string, unknown>>(node)) return [];
  return [node, ...elements(node.props.children as ReactNode)];
}

const workspace: WorkspaceAccountContext = {
  id: "workspace",
  name: "Workspace",
  accountType: "personal",
  licenseUnit: "workspace",
  organization: null,
  sessionPolicy: { idleTimeoutMinutes: 7, warningDurationSeconds: 60 },
  permissions: {
    manageWorkspace: true,
    managePeople: true,
    manageBilling: true,
    manageIntegrations: true,
  },
};
describe("workspace idle policy permissions", () => {
  it("shows the server policy to viewers without offering a write control", () => {
    const html = renderToStaticMarkup(
      <IdleTimeoutSettings workspace={workspace} canManage={false} onSaved={() => {}} />,
    );
    expect(html).toMatch(/<input[^>]*disabled=""[^>]*value="7"/);
    expect(html).toContain("Only a workspace owner or organization administrator");
    expect(html).not.toContain("Save timeout");
  });
  it("exposes an accessible bounded integer field and explicit save action to workspace managers", () => {
    const html = renderToStaticMarkup(
      <IdleTimeoutSettings workspace={workspace} canManage onSaved={() => {}} />,
    );
    expect(html).toContain('for="workspace-idle-timeout"');
    expect(html).toContain('aria-describedby="workspace-idle-timeout-help"');
    expect(html).toContain('min="1"');
    expect(html).toContain('max="240"');
    expect(html).toContain('step="1"');
    expect(html).toContain("Save timeout");
    expect(html).not.toContain('disabled=""');
  });

  it("saves and announces policy without requesting a workspace-shell remount that discards the acknowledgement", async () => {
    const updated = {
      ...workspace,
      sessionPolicy: { idleTimeoutMinutes: 12, warningDurationSeconds: 60 as const },
    };
    mocked.apiFetch.mockResolvedValue({ workspace: updated });
    mocked.capture = true;
    const browser = new EventTarget();
    const policyUpdated = vi.fn();
    const workspaceRefresh = vi.fn();
    browser.addEventListener(SESSION_POLICY_UPDATED_EVENT, policyUpdated);
    browser.addEventListener("polling-pops:workspace-updated", workspaceRefresh);
    vi.stubGlobal("window", browser);
    const onSaved = vi.fn();
    const render = () => {
      mocked.cursor = 0;
      return elements(IdleTimeoutSettings({ workspace, canManage: true, onSaved }));
    };
    (render().find((node) => node.type === "input")!.props.onChange as (event: unknown) => void)({
      target: { value: "12" },
    });
    (render().find((node) => node.type === "form")!.props.onSubmit as (event: unknown) => void)({
      preventDefault() {},
    });
    for (let index = 0; index < 6; index++) await Promise.resolve();
    expect(mocked.apiFetch).toHaveBeenCalledWith("/v1/workspace/settings", {
      method: "PATCH",
      body: JSON.stringify({
        sessionPolicy: { idleTimeoutMinutes: 12, warningDurationSeconds: 60 },
      }),
    });
    expect(onSaved).toHaveBeenCalledWith(updated);
    expect(policyUpdated).toHaveBeenCalledOnce();
    expect(workspaceRefresh).not.toHaveBeenCalled();
    expect(render().find((node) => node.props.role === "status")?.props.children).toBe(
      "Automatic sign-out settings saved.",
    );
  });
});
