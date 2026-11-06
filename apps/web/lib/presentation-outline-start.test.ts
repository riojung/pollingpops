import { describe, expect, it, vi } from "vitest";
import { ApiClientError } from "./api";
import {
  createOutlineDraftCreation,
  outlineDraftRecoveryKey,
  parseOutlineDraftRecovery,
} from "./presentation-outline-start";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const actor = { userId: id(1), workspaceId: id(2) };

function fixture() {
  const entries = new Map<string, string>();
  const storage = {
    getItem: vi.fn((key: string) => entries.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      entries.set(key, value);
    }),
    removeItem: vi.fn((key: string) => {
      entries.delete(key);
    }),
  };
  let editable = true;
  const created = vi.fn();
  const request = vi
    .fn<(path: string, init?: RequestInit) => Promise<unknown>>()
    .mockResolvedValue({ presentation: { id: id(3) } });
  const make = () => {
    const client = createOutlineDraftCreation({
      actor,
      storage,
      canEdit: () => editable,
      onState: vi.fn(),
      onCreated: created,
      request: async <T>(path: string, init?: RequestInit) => (await request(path, init)) as T,
    });
    client.restore();
    return client;
  };
  return {
    entries,
    storage,
    created,
    request,
    make,
    revoke: () => {
      editable = false;
    },
  };
}

describe("outline-first draft creation recovery", () => {
  it("saves complete normalized actor-bound intent before POST and retains its known deck after success", async () => {
    const f = fixture();
    const client = f.make();
    f.request.mockImplementation(async (_path, init) => {
      const saved = parseOutlineDraftRecovery(
        f.entries.get(outlineDraftRecoveryKey(actor))!,
        actor,
      );
      expect(init?.body).toBe(saved.body);
      expect(JSON.parse(saved.body)).toMatchObject({
        title: "Launch plan",
        description: "",
        initialSlide: "native",
        creationContext: { actorId: actor.userId, workspaceId: actor.workspaceId },
      });
      return { presentation: { id: id(3).toUpperCase() } };
    });
    await client.create("  Launch plan  ");
    expect(f.created).toHaveBeenCalledWith(id(3));
    expect(client.state().recovery?.presentationId).toBe(id(3));
    expect(f.entries.get(outlineDraftRecoveryKey(actor))).not.toMatch(
      /outline|proposal|speakerNotes/,
    );
    const reloaded = f.make();
    await reloaded.create("Do not create another");
    reloaded.openSaved();
    expect(f.request).toHaveBeenCalledOnce();
    expect(f.created).toHaveBeenCalledTimes(2);
  });

  it("retries exact JSON after a lost acknowledgement and reload without changing title or identity", async () => {
    const f = fixture();
    f.request.mockRejectedValueOnce(new TypeError("Connection lost"));
    const client = f.make();
    await client.create("Recover this deck");
    expect(client.state().recovery?.presentationId).toBeNull();
    expect(client.startAnother()).toBe(false);
    const originalBody = f.request.mock.calls[0]![1]!.body;
    client.cancel();
    const reloaded = f.make();
    await reloaded.create("Changed title");
    await reloaded.retry();
    expect(f.request).toHaveBeenCalledTimes(2);
    expect(f.request.mock.calls[1]![1]!.body).toBe(originalBody);
    expect(f.created).toHaveBeenCalledOnce();
  });

  it.each([400, 401, 403, 409, 422, 429, 503])(
    "retains the exact intent after HTTP %s",
    async (status) => {
      const f = fixture();
      const client = f.make();
      f.request.mockRejectedValueOnce(
        new ApiClientError("Creation was rejected", "CREATE_ERROR", status),
      );
      await client.create("Preserve request");
      const retained = client.state().recovery;
      expect(retained?.presentationId).toBeNull();
      expect(client.startAnother()).toBe(false);
      await client.retry();
      expect(f.request.mock.calls.map(([, init]) => init?.body)).toEqual([
        retained!.body,
        retained!.body,
      ]);
    },
  );

  it("does not issue a network request unless per-tab recovery can be saved", async () => {
    const f = fixture();
    const client = f.make();
    f.storage.setItem.mockImplementation(() => {
      throw new Error("Blocked");
    });
    await client.create("Not sent");
    expect(f.request).not.toHaveBeenCalled();
    expect(client.state().error).toContain("Allow tab storage");
    expect(client.state().recovery).toBeNull();
  });

  it("blocks creation when recovery storage cannot be read or contains malformed/other-actor data", async () => {
    const f = fixture();
    await f.make().create("Existing intent");
    const saved = JSON.parse(f.entries.get(outlineDraftRecoveryKey(actor))!);
    for (const value of [
      { ...saved, outline: "private text" },
      { ...saved, userId: id(99) },
      {
        ...saved,
        body: JSON.stringify({
          ...JSON.parse(saved.body),
          creationContext: { actorId: id(99), workspaceId: actor.workspaceId },
        }),
      },
      { ...saved, presentationId: "javascript:alert(1)" },
    ]) {
      f.entries.set(outlineDraftRecoveryKey(actor), JSON.stringify(value));
      const blocked = f.make();
      await blocked.create("No replacement");
      expect(blocked.state().ready).toBe(false);
      expect(blocked.state().error).toContain("could not be verified");
    }
    f.storage.getItem.mockImplementation(() => {
      throw new Error("Blocked");
    });
    expect(f.make().state().error).toContain("Allow tab storage");
    expect(f.request).toHaveBeenCalledOnce();
  });

  it("keeps malformed success uncertain and recovers with the same body", async () => {
    const f = fixture();
    f.request.mockResolvedValueOnce({ presentation: { id: "javascript:alert(1)" } });
    const client = f.make();
    await client.create("Verify receipt");
    expect(client.state().error).toContain("could not be verified");
    expect(f.created).not.toHaveBeenCalled();
    await client.retry();
    expect(f.request.mock.calls[1]![1]!.body).toBe(f.request.mock.calls[0]![1]!.body);
  });

  it("requires explicit Start another after a known success before minting a fresh identity", async () => {
    const f = fixture();
    const client = f.make();
    await client.create("First deck");
    const first = JSON.parse(client.state().recovery!.body).creationRequestId;
    expect(client.startAnother()).toBe(true);
    expect(f.entries.size).toBe(0);
    await client.create("Second deck");
    expect(JSON.parse(client.state().recovery!.body).creationRequestId).not.toBe(first);
    expect(f.request).toHaveBeenCalledTimes(2);
  });

  it("persists a definitive deleted-draft response and allows an explicit fresh identity after reload", async () => {
    const f = fixture();
    f.request.mockRejectedValueOnce(
      new ApiClientError("The created draft was deleted", "GONE", 410),
    );
    const client = f.make();
    await client.create("Deleted deck");
    const originalId = JSON.parse(client.state().recovery!.body).creationRequestId;
    expect(client.state().recovery).toMatchObject({ deleted: true, presentationId: null });
    const reloaded = f.make();
    await reloaded.retry();
    expect(f.request).toHaveBeenCalledOnce();
    expect(reloaded.startAnother()).toBe(true);
    await reloaded.create("Replacement deck");
    expect(JSON.parse(reloaded.state().recovery!.body).creationRequestId).not.toBe(originalId);
    expect(f.request).toHaveBeenCalledTimes(2);
  });

  it.each(["cancel", "revoke"] as const)(
    "fences late success after %s and prevents double submission",
    async (action) => {
      const f = fixture();
      let finish!: (response: unknown) => void;
      f.request.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      );
      const client = f.make();
      const first = client.create("In flight");
      await client.create("Double submit");
      await client.retry();
      expect(f.request).toHaveBeenCalledOnce();
      if (action === "cancel") client.cancel();
      else f.revoke();
      finish({ presentation: { id: id(3) } });
      await first;
      expect(f.created).not.toHaveBeenCalled();
      expect(client.state().recovery?.presentationId).toBeNull();
    },
  );

  it("retains the known ID in memory and the exact pending body if storage fails after acceptance", async () => {
    const f = fixture();
    const client = f.make();
    f.request.mockImplementationOnce(async () => {
      f.storage.setItem.mockImplementation(() => {
        throw new Error("Storage became unavailable");
      });
      return { presentation: { id: id(3) } };
    });
    await client.create("Accepted deck");
    expect(client.state().recovery?.presentationId).toBe(id(3));
    expect(client.state().error).toContain("Allow tab storage");
    client.openSaved();
    expect(f.created).toHaveBeenCalledWith(id(3));
    const retained = parseOutlineDraftRecovery(
      f.entries.get(outlineDraftRecoveryKey(actor))!,
      actor,
    );
    expect(retained.presentationId).toBeNull();
    expect(retained.body).toBe(client.state().recovery!.body);
  });
});
