import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LtiRegistration } from "@openround/contracts";
import type { WorkspaceAccountContext } from "../../components/workspace/workspace-provider";
import { apiFetch } from "../../lib/api";
import { visibleSettingsSections } from "./account-settings-model";
import { loadOwnerSettings } from "./load-owner-settings";

vi.mock("../../lib/api", () => ({ apiFetch: vi.fn() }));

const licensedWorkspace: WorkspaceAccountContext = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "School administrator's workspace",
  accountType: "organization",
  licenseUnit: "user",
  organization: { id: "22222222-2222-4222-8222-222222222222", name: "School", role: "owner" },
  permissions: {
    manageWorkspace: true,
    managePeople: true,
    manageBilling: true,
    manageIntegrations: true,
  },
};
const registration: LtiRegistration = {
  id: "33333333-3333-4333-8333-333333333333",
  workspaceId: licensedWorkspace.id,
  name: "Configured school LMS",
  issuer: "https://lms.example.org",
  clientId: "school-client",
  deploymentId: "school-deployment",
  authorizationEndpoint: "https://lms.example.org/authorize",
  tokenEndpoint: "https://lms.example.org/token",
  jwksUrl: "https://lms.example.org/jwks",
  deepLinkReturnOrigins: [],
  status: "active",
  createdAt: "2026-10-29T12:00:00Z",
  updatedAt: "2026-10-29T12:00:00Z",
};
const collaboration = { members: [], invitations: [] };

beforeEach(() => vi.mocked(apiFetch).mockReset());

describe("workspace owner settings loading", () => {
  it("keeps configured LTI registrations available to licensed organization owners without enabling workspace-member invitations", async () => {
    vi.mocked(apiFetch).mockResolvedValueOnce({ registrations: [registration] });

    const settings = await loadOwnerSettings("owner", licensedWorkspace);

    expect(visibleSettingsSections(licensedWorkspace, "owner")).toContain("security");
    expect(settings.registrations).toEqual([registration]);
    expect(settings.collaboration).toBeNull();
    expect(apiFetch).toHaveBeenCalledExactlyOnceWith("/v1/workspace/lti-registrations");
    expect(apiFetch).not.toHaveBeenCalledWith("/v1/workspace/members");
  });

  it.each([null, { ...licensedWorkspace, licenseUnit: "workspace" as const }])(
    "retains both LTI and collaboration settings for legacy or workspace-license owners",
    async (workspace) => {
      vi.mocked(apiFetch)
        .mockResolvedValueOnce(collaboration)
        .mockResolvedValueOnce({ registrations: [registration] });

      expect(await loadOwnerSettings("owner", workspace)).toEqual({
        collaboration,
        registrations: [registration],
      });
      expect(apiFetch).toHaveBeenCalledWith("/v1/workspace/members");
      expect(apiFetch).toHaveBeenCalledWith("/v1/workspace/lti-registrations");
    },
  );

  it.each(["editor", "viewer"] as const)(
    "never requests owner-authorized LTI or collaboration data for a content %s",
    async (role) => {
      expect(await loadOwnerSettings(role, licensedWorkspace)).toEqual({
        collaboration: null,
        registrations: [],
      });
      expect(apiFetch).not.toHaveBeenCalled();
    },
  );
});
