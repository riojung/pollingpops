import { createHash, randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  IdeaBoardStoredSchema,
  IdeaBoardCreateSchema,
  type IdeaBoardGuestView,
  type IdeaBoardPublicInfo,
  type IdeaBoardStored,
  type IdeaBoardView,
} from "@openround/contracts";
import { IdeaBoardRepository } from "../src/idea-boards.js";

type Clock = Date | (() => Date);
type ReadResult = IdeaBoardView | IdeaBoardGuestView | IdeaBoardPublicInfo | IdeaBoardView[] | null;
const beforeDeadline = new Date("2030-01-01T00:00:00.000Z");
const retainedText = "Retained idea must not escape after expiry";
const tokenHash = "a".repeat(64);
const readers = [
  {
    name: "guest",
    read: (repository: IdeaBoardRepository, row: IdeaBoardStored, clock?: Clock) =>
      repository.getGuest(row.id, tokenHash, clock),
  },
  {
    name: "moderator",
    read: (repository: IdeaBoardRepository, row: IdeaBoardStored, clock?: Clock) =>
      repository.getModerator(row.workspaceId, row.id, clock),
  },
  {
    name: "viewer",
    read: (repository: IdeaBoardRepository, row: IdeaBoardStored, clock?: Clock) =>
      repository.getViewer(row.workspaceId, row.id, clock),
  },
  {
    name: "public info",
    read: (repository: IdeaBoardRepository, row: IdeaBoardStored, clock?: Clock) =>
      repository.getPublicInfo(row.id, clock),
  },
  {
    name: "moderator list",
    read: (repository: IdeaBoardRepository, row: IdeaBoardStored, clock?: Clock) =>
      repository.list(row.workspaceId, clock),
  },
  {
    name: "viewer list",
    read: (repository: IdeaBoardRepository, row: IdeaBoardStored, clock?: Clock) =>
      repository.list(row.workspaceId, clock, false),
  },
  {
    name: "creation replay",
    read: (repository: IdeaBoardRepository, row: IdeaBoardStored, clock?: Clock) =>
      repository.getCreation(row.workspaceId, row.creationKey, clock),
  },
];

function storedBoard() {
  const ideaId = randomUUID(),
    guestId = randomUUID();
  return IdeaBoardStoredSchema.parse({
    schemaVersion: 1,
    id: randomUUID(),
    workspaceId: randomUUID(),
    title: "Read deadline fence",
    description: "Retained board description",
    identityMode: "anonymous",
    moderationEnabled: false,
    voteBudget: 3,
    ideasVisible: false,
    status: "collecting",
    revision: 1,
    participantLimit: 10,
    createdAt: beforeDeadline.toISOString(),
    closesAt: "2030-01-02T00:00:00.000Z",
    expiresAt: "2030-01-03T00:00:00.000Z",
    creationKey: randomUUID(),
    creationHash: "b".repeat(64),
    groups: [],
    ideas: [
      {
        id: ideaId,
        body: retainedText,
        alias: null,
        groupId: null,
        status: "approved",
        createdAt: beforeDeadline.toISOString(),
        guestId,
      },
    ],
    guests: [
      { id: guestId, tokenHash, alias: null, revision: 0, ideaIds: [ideaId], votedIdeaIds: [] },
    ],
    receipts: [],
  });
}

function delayedRepository(row: IdeaBoardStored, delay: "transaction" | "storage") {
  let release!: () => void, entered!: () => void;
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  const waiting = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const wait = async () => {
    entered();
    await blocked;
  };
  const repository = new IdeaBoardRepository(async (_workspaceId, _boardId, work) => {
    if (delay === "transaction") await wait();
    return work({
      get: async () => {
        if (delay === "storage") await wait();
        return structuredClone(row);
      },
      list: async () => {
        if (delay === "storage") await wait();
        return [structuredClone(row)];
      },
      put: async () => {
        throw new Error("Reads must not write retained state");
      },
      remove: async () => {
        throw new Error("Reads must not delete retained state");
      },
      admission: async () => {
        throw new Error("Reads must not admit guests");
      },
    });
  });
  return { repository, waiting, release };
}

function view(result: ReadResult) {
  if (Array.isArray(result)) return result[0] ?? null;
  if (result && "board" in result) return result.board;
  return result;
}

afterEach(() => vi.useRealTimers());

describe.each(["default", "callback"] as const)("idea board reads with the %s clock", (source) => {
  it.each(readers)("rechecks $name expiry after storage resolves", async ({ name, read }) => {
    const row = storedBoard(),
      { repository, waiting, release } = delayedRepository(row, "storage");
    let now = beforeDeadline;
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(now);
    const clock = vi.fn(() => now);
    const pending = read(repository, row, source === "callback" ? clock : undefined).then(
      (value) => ({ value }),
      (error: unknown) => ({ error }),
    );
    await waiting;
    expect(clock).not.toHaveBeenCalled();
    now = new Date(row.expiresAt);
    vi.setSystemTime(now);
    release();
    const result = await pending;
    if (name.endsWith("list")) expect(result).toEqual({ value: [] });
    else if (name === "creation replay") expect(result).toEqual({ value: null });
    else expect(result).toMatchObject({ error: { code: "NOT_FOUND" } });
    if (source === "callback") expect(clock).toHaveBeenCalledTimes(1);
  });

  it.each(readers)("projects $name closure after storage resolves", async ({ name, read }) => {
    const row = storedBoard(),
      { repository, waiting, release } = delayedRepository(row, "storage");
    let now = beforeDeadline;
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(now);
    const clock = vi.fn(() => now);
    const pending = read(repository, row, source === "callback" ? clock : undefined);
    await waiting;
    expect(clock).not.toHaveBeenCalled();
    now = new Date(row.closesAt);
    vi.setSystemTime(now);
    release();
    const projected = view(await pending);
    expect(projected).toMatchObject({ status: "closed" });
    if (projected && "countsVisible" in projected) {
      expect(projected.countsVisible).toBe(true);
      if (!name.endsWith("list") && "ideas" in projected)
        expect(projected.ideas).toEqual([
          expect.objectContaining({ body: retainedText, voteCount: 0 }),
        ]);
    }
    if (source === "callback") expect(clock).toHaveBeenCalledTimes(1);
  });
});

describe("idea board read transaction waits", () => {
  it.each(["closesAt", "expiresAt"] as const)(
    "rechecks an existing create replay after storage resolves across %s",
    async (deadline) => {
      const row = storedBoard(),
        input = IdeaBoardCreateSchema.parse({
          title: row.title,
          description: row.description,
          moderationEnabled: row.moderationEnabled,
        });
      row.creationHash = createHash("sha256").update(JSON.stringify(input)).digest("hex");
      const { repository, waiting, release } = delayedRepository(row, "storage");
      let now = beforeDeadline;
      const clock = vi.fn(() => now);
      const pending = repository
        .create(
          row.workspaceId,
          randomUUID(),
          input,
          row.creationKey,
          {
            participantLimit: row.participantLimit,
            closesAt: row.closesAt,
            expiresAt: row.expiresAt,
          },
          clock,
        )
        .then(
          (value) => ({ value }),
          (error: unknown) => ({ error }),
        );
      await waiting;
      expect(clock).not.toHaveBeenCalled();
      now = new Date(row[deadline]);
      release();
      const result = await pending;
      if (deadline === "expiresAt") expect(result).toMatchObject({ error: { code: "NOT_FOUND" } });
      else
        expect(result).toMatchObject({
          value: { id: row.id, status: "closed", countsVisible: true },
        });
      expect(clock).toHaveBeenCalledTimes(1);
    },
  );

  it.each(readers)(
    "rechecks $name expiry after acquiring a transaction",
    async ({ name, read }) => {
      const row = storedBoard(),
        { repository, waiting, release } = delayedRepository(row, "transaction");
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(beforeDeadline);
      const pending = read(repository, row).then(
        (value) => ({ value }),
        (error: unknown) => ({ error }),
      );
      await waiting;
      vi.setSystemTime(new Date(row.expiresAt));
      release();
      const result = await pending;
      if (name.endsWith("list")) expect(result).toEqual({ value: [] });
      else if (name === "creation replay") expect(result).toEqual({ value: null });
      else expect(result).toMatchObject({ error: { code: "NOT_FOUND" } });
    },
  );

  it.each(readers)("preserves an explicit frozen Date for $name", async ({ read }) => {
    const row = storedBoard(),
      { repository, waiting, release } = delayedRepository(row, "storage");
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(beforeDeadline);
    const pending = read(repository, row, beforeDeadline);
    await waiting;
    vi.setSystemTime(new Date(row.expiresAt));
    release();
    const projected = view(await pending);
    expect(projected).toMatchObject({ status: "collecting" });
    if (projected && "countsVisible" in projected) expect(projected.countsVisible).toBe(false);
  });
});
