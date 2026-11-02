import { afterEach, describe, expect, it, vi } from "vitest";
import type * as ApiModule from "../../lib/api";
import {
  parseBoardInvitationEmails,
  readCanvasSharing,
  revokeCanvasGroup,
  sendBoardInvitations,
  shareCanvasGroups,
} from "./canvas-sharing-client";
const api = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock("../../lib/api", async (original) => ({
  ...(await original<typeof ApiModule>()),
  apiFetch: api.fetch,
}));
const id = "00000000-0000-4000-8000-000000000001";
const groupId = "00000000-0000-4000-8000-000000000002";
const operationId = "00000000-0000-4000-8000-000000000003";
const intent = {
  operationId,
  emails: ["first@example.test", "second@example.test"],
  role: "editor" as const,
};
afterEach(() => vi.resetAllMocks());

describe("board sharing client", () => {
  it("normalizes and deduplicates a recipient list without splitting malformed addresses into valid recipients", () => {
    expect(
      parseBoardInvitationEmails(
        " FIRST@example.test, second@example.test\nfirst@example.test; SECOND@example.test ",
      ),
    ).toEqual({ emails: intent.emails, error: null });
    expect(parseBoardInvitationEmails("first@example.test second@example.test").error).toBe(
      "invalid",
    );
    expect(parseBoardInvitationEmails("  ,\n").error).toBe("empty");
    expect(
      parseBoardInvitationEmails(
        Array.from({ length: 21 }, (_, index) => `person${index}@example.test`).join(","),
      ).error,
    ).toBe("limit");
    expect(
      parseBoardInvitationEmails(Array.from({ length: 25 }, () => "first@example.test").join(","))
        .error,
    ).toBeNull();
  });
  it("reads eligible groups from the board origin and validates complete sharing data", async () => {
    const sharing = {
      groups: [],
      availableGroups: [{ id: groupId, name: "Workshop leaders", memberCount: 2 }],
    };
    api.fetch.mockResolvedValue(sharing);
    const controller = new AbortController();
    expect(await readCanvasSharing(id, controller.signal)).toEqual(sharing);
    expect(api.fetch).toHaveBeenCalledWith(`/v1/canvas-boards/${id}/sharing`, {
      signal: controller.signal,
      cache: "no-store",
    });
    api.fetch.mockResolvedValue({
      groups: [],
      availableGroups: [{ id: groupId, name: "Wrong", memberCount: -1 }],
    });
    await expect(readCanvasSharing(id)).rejects.toThrow();
  });
  it("uses bounded group grants and a stable operation ID for removal", async () => {
    api.fetch.mockResolvedValue({ groups: [], availableGroups: [] });
    const grant = { operationId, groupIds: [groupId], role: "viewer" as const };
    await shareCanvasGroups(id, grant);
    await revokeCanvasGroup(id, groupId, operationId);
    expect(
      api.fetch.mock.calls.map(([path, options]) => [
        path,
        options.method,
        JSON.parse(options.body),
      ]),
    ).toEqual([
      [`/v1/canvas-boards/${id}/group-grants`, "POST", grant],
      [`/v1/canvas-boards/${id}/group-grants/${groupId}`, "DELETE", { operationId }],
    ]);
    api.fetch.mockClear();
    await expect(
      shareCanvasGroups(id, { ...grant, groupIds: [groupId, groupId] }),
    ).rejects.toThrow();
    await expect(revokeCanvasGroup(id, "../other", operationId)).rejects.toThrow();
    expect(api.fetch).not.toHaveBeenCalled();
  });
  it("preserves the exact batch across a lost response and accepts mixed per-recipient outcomes", async () => {
    const result = {
      batchId: groupId,
      complete: false,
      results: [
        { email: intent.emails[0], status: "sent", invitationId: id },
        { email: intent.emails[1], status: "pending" },
      ],
    };
    api.fetch.mockRejectedValueOnce(new TypeError("Lost response")).mockResolvedValue(result);
    await expect(sendBoardInvitations({ kind: "collaborators", id }, intent)).rejects.toThrow();
    expect(await sendBoardInvitations({ kind: "collaborators", id }, intent)).toEqual(result);
    expect(api.fetch.mock.calls[0]![1].body).toBe(api.fetch.mock.calls[1]![1].body);
    expect(api.fetch.mock.calls[0]![0]).toBe(`/v1/canvas-boards/${id}/invitations/batch`);
  });
  it("sends guests only to the workshop endpoint and rejects an editor-role payload", async () => {
    const guest = { operationId, emails: [intent.emails[0]!] };
    api.fetch.mockResolvedValue({
      batchId: groupId,
      complete: true,
      results: [{ email: guest.emails[0], status: "unknown", errorCode: "DELIVERY_UNKNOWN" }],
    });
    expect((await sendBoardInvitations({ kind: "guests", id }, guest)).complete).toBe(true);
    expect(api.fetch.mock.calls[0]![0]).toBe(`/v1/idea-boards/${id}/invitations`);
    expect(JSON.parse(api.fetch.mock.calls[0]![1].body)).toEqual(guest);
    api.fetch.mockClear();
    await expect(
      sendBoardInvitations({ kind: "guests", id }, { ...guest, role: "editor" }),
    ).rejects.toThrow();
    expect(api.fetch).not.toHaveBeenCalled();
  });
  it.each([
    { complete: true, results: [{ email: intent.emails[0], status: "sent" }] },
    {
      complete: true,
      results: [
        { email: intent.emails[0], status: "sent" },
        { email: intent.emails[0], status: "sent" },
      ],
    },
    {
      complete: true,
      results: [
        { email: intent.emails[0], status: "sent" },
        { email: "foreign@example.test", status: "sent" },
      ],
    },
    {
      complete: true,
      results: [
        { email: intent.emails[0], status: "sent" },
        { email: intent.emails[1], status: "pending" },
      ],
    },
  ])("rejects incomplete, duplicate, foreign or inconsistent acknowledgements", async (result) => {
    api.fetch.mockResolvedValue({ batchId: groupId, ...result });
    await expect(sendBoardInvitations({ kind: "collaborators", id }, intent)).rejects.toThrow(
      "Invalid invitation acknowledgement",
    );
  });
});
