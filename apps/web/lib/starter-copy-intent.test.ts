import { describe, expect, it, vi } from "vitest";
import {
  createStarterCopyIntentStore,
  parseStarterCopyIntents,
  starterCopyFailure,
  starterCopyRequest,
  starterCopyStorageKey,
  StarterCopyStorageError,
} from "./starter-copy-intent";

const actor = {
  actorId: "00000000-0000-4000-8000-000000000001",
  workspaceId: "00000000-0000-4000-8000-000000000002",
};
function harness(entries = new Map<string, string>(), context = actor) {
  let time = Date.parse("2026-11-18T12:00:00.000Z");
  let sequence = 10;
  const storage = {
    getItem: vi.fn((key: string) => entries.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      entries.set(key, value);
    }),
    removeItem: vi.fn((key: string) => {
      entries.delete(key);
    }),
  };
  const make = () =>
    createStarterCopyIntentStore({
      actor: context,
      storage,
      now: () => time,
      uuid: () => `00000000-0000-4000-8000-${String(sequence++).padStart(12, "0")}`,
    });
  return {
    store: make(),
    make,
    entries,
    storage,
    advance: (milliseconds: number) => {
      time += milliseconds;
    },
  };
}
describe("durable starter copy intent metadata", () => {
  it("persists exact metadata before a copy and restores it across remount and changed catalog version", () => {
    const view = harness();
    const first = view.store.prepare("meeting-priorities", "ko-KR", "launch-v1");
    expect(starterCopyRequest(first)).toEqual({
      locale: "ko-KR",
      idempotencyKey: expect.any(String),
      creationContext: actor,
      contentVersion: "launch-v1",
      expiresAt: "2026-11-19T12:00:00.000Z",
    });
    const raw = view.entries.get(starterCopyStorageKey(actor))!;
    expect(JSON.parse(raw)).toEqual({ version: 1, intents: [first] });
    expect(raw).not.toMatch(/questions|choices|answers|draft|title|description/);
    view.advance(48 * 60 * 60 * 1000);
    expect(view.make().prepare("meeting-priorities", "ko-KR", "launch-v2").body).toBe(first.body);
  });
  it("separates source, language, actor and workspace identities", () => {
    const view = harness();
    const first = view.store.prepare("meeting-priorities", "en-CA", "v1");
    const french = view.store.prepare("meeting-priorities", "fr-FR", "v1");
    const other = view.store.prepare("team-retrospective", "en-CA", "v1");
    expect(
      new Set([first, french, other].map((intent) => starterCopyRequest(intent).idempotencyKey))
        .size,
    ).toBe(3);
    const otherActor = harness(view.entries, {
      ...actor,
      actorId: "00000000-0000-4000-8000-000000000003",
    });
    expect(otherActor.store.read()).toEqual([]);
    const otherWorkspace = harness(view.entries, {
      ...actor,
      workspaceId: "00000000-0000-4000-8000-000000000004",
    });
    expect(otherWorkspace.store.read()).toEqual([]);
  });
  it.each([
    "json",
    "extra-envelope",
    "extra-request",
    "wrong-context",
    "history-other-key",
    "duplicate-source",
    "duplicate-key",
    "oversized",
  ])("blocks corrupt %s recovery rather than minting another key", (kind) => {
    const view = harness();
    const first = view.store.prepare("meeting-priorities", "en-CA", "v1");
    const value = { version: 1, intents: [first] };
    if (kind === "extra-request")
      first.body = JSON.stringify({ ...starterCopyRequest(first), data: "private content" });
    if (kind === "wrong-context")
      first.body = JSON.stringify({
        ...starterCopyRequest(first),
        creationContext: { ...actor, actorId: "00000000-0000-4000-8000-000000000003" },
      });
    if (kind === "history-other-key")
      first.previousBodies.push(
        JSON.stringify({
          ...starterCopyRequest(first),
          idempotencyKey: "00000000-0000-4000-8000-000000000099",
        }),
      );
    if (kind === "duplicate-source") value.intents.push({ ...first });
    if (kind === "duplicate-key") value.intents.push({ ...first, starterId: "team-retrospective" });
    const raw =
      kind === "json"
        ? "broken"
        : kind === "oversized"
          ? " ".repeat(98_305)
          : JSON.stringify(kind === "extra-envelope" ? { ...value, private: true } : value);
    view.entries.set(starterCopyStorageKey(actor), raw);
    const writes = view.storage.setItem.mock.calls.length;
    expect(() => view.store.prepare("meeting-priorities", "en-CA", "v2")).toThrow(
      StarterCopyStorageError,
    );
    expect(view.storage.setItem).toHaveBeenCalledTimes(writes);
    expect(view.entries.get(starterCopyStorageKey(actor))).toBe(raw);
  });
  it("fails closed on storage read and write denial", () => {
    const view = harness();
    view.storage.getItem.mockImplementationOnce(() => {
      throw new Error("Denied");
    });
    expect(() => view.store.prepare("meeting-priorities", "en-CA", "v1")).toThrow(
      StarterCopyStorageError,
    );
    view.storage.setItem.mockImplementationOnce(() => {
      throw new Error("Denied");
    });
    expect(() => view.store.prepare("meeting-priorities", "en-CA", "v1")).toThrow(
      StarterCopyStorageError,
    );
    expect(view.entries.size).toBe(0);
  });
  it("retains a known successful intent when cleanup fails and can retire it later", () => {
    const view = harness();
    const first = view.store.prepare("meeting-priorities", "en-CA", "v1");
    view.storage.removeItem.mockImplementationOnce(() => {
      throw new Error("Denied");
    });
    expect(() => view.store.retire(first)).toThrow(StarterCopyStorageError);
    expect(view.store.find("meeting-priorities", "en-CA")?.body).toBe(first.body);
    view.store.retire(first);
    expect(view.entries.size).toBe(0);
  });
  it("renews stale metadata only explicitly, retains the same key, and preserves each exact previous body", () => {
    const view = harness();
    const original = view.store.prepare("meeting-priorities", "en-CA", "v1");
    view.advance(48 * 60 * 60 * 1000);
    expect(view.store.prepare("meeting-priorities", "en-CA", "v2").body).toBe(original.body);
    const renewed = view.store.renew(original, "v2", "renew");
    expect(starterCopyRequest(renewed)).toMatchObject({
      idempotencyKey: starterCopyRequest(original).idempotencyKey,
      contentVersion: "v2",
      expiresAt: "2026-11-21T12:00:00.000Z",
    });
    expect(renewed.previousBodies).toEqual([original.body]);
    expect(view.store.recoverPrevious(renewed)?.body).toBe(original.body);
  });
  it("cycles all exact variants after three renewals so an oldest accepted copy remains recoverable", () => {
    const view = harness();
    const original = view.store.prepare("meeting-priorities", "en-CA", "v1");
    let current = original;
    const bodies = [original.body];
    for (let version = 2; version <= 4; version++) {
      current = view.store.renew(current, `v${version}`, "renew");
      bodies.push(current.body);
    }
    const reached = [current.body];
    for (let attempt = 0; attempt < 3; attempt++) {
      current = view.store.recoverPrevious(current)!;
      reached.push(current.body);
    }
    expect(new Set(reached)).toEqual(new Set(bodies));
    expect(current.body).toBe(original.body);
    expect(current.previousBodies).toHaveLength(3);
    expect(
      new Set(
        [current.body, ...current.previousBodies].map((body) => JSON.parse(body).idempotencyKey),
      ),
    ).toEqual(new Set([starterCopyRequest(original).idempotencyKey]));
  });
  it("never silently evicts a body when renewal history reaches its bound", () => {
    const view = harness();
    let current = view.store.prepare("meeting-priorities", "en-CA", "v1");
    for (let version = 2; version <= 5; version++)
      current = view.store.renew(current, `v${version}`, "renew");
    const before = view.entries.get(starterCopyStorageKey(actor));
    expect(() => view.store.renew(current, "v6", "renew")).toThrow(StarterCopyStorageError);
    expect(view.entries.get(starterCopyStorageKey(actor))).toBe(before);
  });
  it("can correct a future-clock invalid expiry during explicit same-key renewal", () => {
    const view = harness();
    const original = view.store.prepare("meeting-priorities", "en-CA", "v1");
    view.advance(-10 * 60 * 1000);
    const renewed = view.store.renew(original, "v1", "renew");
    expect(starterCopyRequest(renewed).expiresAt).toBe("2026-11-19T11:50:00.000Z");
    expect(starterCopyRequest(renewed).idempotencyKey).toBe(
      starterCopyRequest(original).idempotencyKey,
    );
    expect(renewed.previousBodies).toEqual([original.body]);
  });
  it("mints a new key only for an explicit replacement of a known unavailable accepted target", () => {
    const view = harness();
    const original = view.store.prepare("meeting-priorities", "en-CA", "v1");
    const next = view.store.renew(original, "v2", "replace");
    expect(starterCopyRequest(next).idempotencyKey).not.toBe(
      starterCopyRequest(original).idempotencyKey,
    );
    expect(next.previousBodies).toEqual([]);
    expect(view.store.read()).toEqual([next]);
  });
  it("bounds active metadata without silently replacing unrelated pending copies", () => {
    const view = harness();
    for (let index = 0; index < 16; index++) view.store.prepare(`starter-${index}`, "en-CA", "v1");
    const raw = view.entries.get(starterCopyStorageKey(actor));
    expect(() => view.store.prepare("one-too-many", "en-CA", "v1")).toThrow(
      StarterCopyStorageError,
    );
    expect(view.entries.get(starterCopyStorageKey(actor))).toBe(raw);
    expect(parseStarterCopyIntents(raw!, actor)).toHaveLength(16);
  });
  it.each([
    [400, "INVALID_INTENT", "renew"],
    [409, "STARTER_CONTENT_CHANGED", "renew"],
    [410, "STARTER_COPY_EXPIRED", "renew"],
    [410, "STARTER_COPY_TARGET_UNAVAILABLE", "replace"],
    [409, "IDEMPOTENCY_CONFLICT", "conflict"],
    [429, "RATE_LIMIT", "unknown"],
    [500, "INTERNAL", "unknown"],
  ])("classifies %s %s without granting an automatic reset", (status, code, expected) => {
    expect(starterCopyFailure({ status, code })).toBe(expected);
  });
});
