import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as ApiModule from "../../lib/api";
import { apiFetch, ApiClientError } from "../../lib/api";
import { loadAccountSettings } from "./load-account-settings";

vi.mock("../../lib/api", async (original) => ({
  ...(await original<typeof ApiModule>()),
  apiFetch: vi.fn(),
}));

const account = {
  creator: { userId: "user", workspaceId: "workspace", role: "owner" },
  workspace: { accountType: "personal", licenseUnit: "workspace" },
};

function response(path: string): unknown {
  if (path === "/v1/auth/me") return account;
  if (path === "/v1/account/theme?expectedWorkspaceId=workspace")
    return { theme: null, enabled: true };
  if (path === "/v1/workspaces") return { activeWorkspaceId: "workspace", workspaces: [] };
  if (path === "/v1/account/embed-origins?expectedWorkspaceId=workspace") return { origins: [] };
  if (path === "/v1/workspace/institution-policy?expectedWorkspaceId=workspace")
    return { capabilities: { lti: true } };
  if (path === "/v1/auth/federated-identities?expectedWorkspaceId=workspace")
    return { identities: [] };
  if (path.startsWith("/v1/auth/oidc/status?")) return { enabled: true };
  throw new Error(`Unexpected read: ${path}`);
}

beforeEach(() => {
  vi.mocked(apiFetch)
    .mockReset()
    .mockImplementation(async (path) => response(path));
});

describe("atomic account settings reads", () => {
  it("waits for account authority before issuing settings reads and passes one abort signal to every GET", async () => {
    let resolveAccount!: (value: unknown) => void;
    vi.mocked(apiFetch).mockImplementation((path) =>
      path === "/v1/auth/me"
        ? new Promise((resolve) => {
            resolveAccount = resolve;
          })
        : Promise.resolve(response(path)),
    );
    const controller = new AbortController();
    const pending = loadAccountSettings(controller.signal);
    expect(apiFetch).toHaveBeenCalledExactlyOnceWith("/v1/auth/me", { signal: controller.signal });
    resolveAccount(account);
    const loaded = await pending;
    expect(loaded.kind).toBe("workspace");
    expect(vi.mocked(apiFetch).mock.calls.map(([path]) => path)).toEqual([
      "/v1/auth/me",
      "/v1/account/theme?expectedWorkspaceId=workspace",
      "/v1/workspaces",
      "/v1/account/embed-origins?expectedWorkspaceId=workspace",
      "/v1/workspace/institution-policy?expectedWorkspaceId=workspace",
      "/v1/auth/federated-identities?expectedWorkspaceId=workspace",
      "/v1/auth/oidc/status?workspaceId=workspace",
    ]);
    for (const [, init] of vi.mocked(apiFetch).mock.calls)
      expect(init).toEqual({ signal: controller.signal });
  });

  it.each([
    "/v1/account/theme?expectedWorkspaceId=workspace",
    "/v1/workspaces",
    "/v1/account/embed-origins?expectedWorkspaceId=workspace",
    "/v1/workspace/institution-policy?expectedWorkspaceId=workspace",
    "/v1/auth/federated-identities?expectedWorkspaceId=workspace",
    "/v1/auth/oidc/status?workspaceId=workspace",
  ])(
    "rejects a required %s failure instead of returning a partial or billing-only snapshot",
    async (failed) => {
      const failure = new ApiClientError("Settings read expired", "UNAUTHORIZED", 401);
      vi.mocked(apiFetch).mockImplementation(async (path) => {
        if (path === failed) throw failure;
        return response(path);
      });
      await expect(loadAccountSettings(new AbortController().signal)).rejects.toBe(failure);
      expect(vi.mocked(apiFetch).mock.calls.some(([path]) => path === "/v1/auth/user")).toBe(false);
    },
  );

  it.each(["other-workspace", null])(
    "withholds the snapshot when the active workspace resolves to %s",
    async (activeWorkspaceId) => {
      vi.mocked(apiFetch).mockImplementation(async (path) =>
        path === "/v1/workspaces" ? { activeWorkspaceId, workspaces: [] } : response(path),
      );
      await expect(loadAccountSettings(new AbortController().signal)).rejects.toThrow(
        "The active workspace changed",
      );
    },
  );

  it("recognizes an authenticated no-workspace user only after auth/me rejects and auth/user succeeds", async () => {
    const identity = {
      user: { userId: "billing", email: "payer@example.org" },
      businessManagementEnabled: true,
    };
    vi.mocked(apiFetch)
      .mockRejectedValueOnce(new ApiClientError("No workspace", "UNAUTHORIZED", 401))
      .mockResolvedValueOnce(identity);
    expect(await loadAccountSettings(new AbortController().signal)).toEqual({
      kind: "billing-only",
      identity,
    });
    expect(vi.mocked(apiFetch).mock.calls.map(([path]) => path)).toEqual([
      "/v1/auth/me",
      "/v1/auth/user",
    ]);
  });

  it("reports unauthenticated only when both account and user authorities reject authentication", async () => {
    vi.mocked(apiFetch).mockRejectedValue(new ApiClientError("Sign in", "UNAUTHORIZED", 401));
    expect(await loadAccountSettings(new AbortController().signal)).toEqual({
      kind: "unauthenticated",
    });
  });

  it.each(["/v1/auth/me", "/v1/auth/user"])(
    "keeps a transient %s failure recoverable without a sign-in verdict",
    async (failed) => {
      const failure = new ApiClientError("Temporarily unavailable", "UNAVAILABLE", 503);
      vi.mocked(apiFetch).mockImplementation(async (path) => {
        if (path === failed) throw failure;
        throw new ApiClientError("No workspace", "UNAUTHORIZED", 401);
      });
      await expect(loadAccountSettings(new AbortController().signal)).rejects.toBe(failure);
      expect(apiFetch).toHaveBeenCalledTimes(failed === "/v1/auth/me" ? 1 : 2);
    },
  );

  it("refuses an aborted authority response before issuing dependent settings reads", async () => {
    const controller = new AbortController();
    vi.mocked(apiFetch).mockImplementation(async () => {
      controller.abort();
      return account;
    });
    await expect(loadAccountSettings(controller.signal)).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(apiFetch).toHaveBeenCalledTimes(1);
  });

  it("refuses an aborted complete snapshot even if the transport ignores cancellation", async () => {
    const controller = new AbortController();
    vi.mocked(apiFetch).mockImplementation(async (path) => {
      if (path === "/v1/auth/federated-identities?expectedWorkspaceId=workspace")
        controller.abort();
      return response(path);
    });
    await expect(loadAccountSettings(controller.signal)).rejects.toMatchObject({
      name: "AbortError",
    });
  });
});
