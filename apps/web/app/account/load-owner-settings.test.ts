import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiFetch } from "../../lib/api";
import { loadLtiRegistrations, loadWorkspaceCollaboration } from "./load-owner-settings";

vi.mock("../../lib/api", () => ({ apiFetch: vi.fn() }));

const collaboration = { members: [], invitations: [] };
const registration = { id: "lti", name: "Configured school LMS" };

beforeEach(() => vi.mocked(apiFetch).mockReset());

describe("workspace owner settings readers", () => {
  it("reads collaboration alone and supplies its cancellation signal", async () => {
    const { signal } = new AbortController();
    vi.mocked(apiFetch).mockResolvedValueOnce(collaboration);
    expect(await loadWorkspaceCollaboration("trusted-workspace", signal)).toEqual(collaboration);
    expect(apiFetch).toHaveBeenCalledExactlyOnceWith(
      "/v1/workspace/members?expectedWorkspaceId=trusted-workspace",
      { signal },
    );
  });

  it("reads LTI alone and supplies its cancellation signal", async () => {
    const { signal } = new AbortController();
    vi.mocked(apiFetch).mockResolvedValueOnce({ registrations: [registration] });
    expect(await loadLtiRegistrations("trusted-workspace", signal)).toEqual([registration]);
    expect(apiFetch).toHaveBeenCalledExactlyOnceWith(
      "/v1/workspace/lti-registrations?expectedWorkspaceId=trusted-workspace",
      { signal },
    );
  });

  it("rejects incomplete sections so a malformed response cannot look like confirmed empty data", async () => {
    const { signal } = new AbortController();
    vi.mocked(apiFetch).mockResolvedValueOnce({ members: [] }).mockResolvedValueOnce(null);
    await expect(loadWorkspaceCollaboration("trusted-workspace", signal)).rejects.toThrow(
      "Invalid workspace collaboration",
    );
    await expect(loadLtiRegistrations("trusted-workspace", signal)).rejects.toThrow(
      "Invalid LTI registrations",
    );
  });
});
