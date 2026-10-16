import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import {
  IDEA_BOARD_MAX_GUEST_IDEAS,
  IDEA_BOARD_MAX_GROUPS,
  IDEA_BOARD_MAX_IDEAS,
  IDEA_BOARD_MAX_RECEIPTS,
  IdeaBoardAliasSchema,
  IdeaBoardBodySchema,
  IdeaBoardCreateSchema,
  IdeaBoardHostCommandSchema,
  IdeaBoardPublicInfoSchema,
  IdeaBoardStoredSchema,
  IdeaBoardVoteSchema,
  ideaBoardProjection,
  type IdeaBoardCreate,
  type IdeaBoardGuestView,
  type IdeaBoardHostCommand,
  type IdeaBoardReceipt,
  type IdeaBoardStored,
} from "@openround/contracts";
import { MemoryRepository, type MemoryRepositoryLifecycleContext } from "./memory.js";
import { PostgresRepository } from "./postgres.js";
import { assertAudienceAdmissionInMemory, getMemoryPlatformRepository } from "./platform-memory.js";
import { assertAudienceAdmissionForTransaction } from "./platform-postgres.js";
import type { Repository } from "./types.js";

export class IdeaBoardError extends Error {
  constructor(
    public readonly code:
      | "NOT_FOUND"
      | "UNAUTHORIZED"
      | "STALE_DRAFT"
      | "IDEMPOTENCY_CONFLICT"
      | "ROOM_CLOSED"
      | "VALIDATION_ERROR"
      | "PARTICIPANT_LIMIT"
      | "ENTITLEMENT_LIMIT"
      | "RATE_LIMITED",
    message: string,
  ) {
    super(message);
  }
}
type Clock = Date | (() => Date);
type Guest = IdeaBoardStored["guests"][number];
interface Transaction {
  get(id: string): Promise<IdeaBoardStored | null>;
  list(): Promise<IdeaBoardStored[]>;
  put(row: IdeaBoardStored, insert?: boolean): Promise<void>;
  remove(id: string): Promise<void>;
  admission(workspaceId: string): Promise<void>;
}
type Run = <T>(
  workspaceId: string | null,
  boardId: string | null,
  work: (tx: Transaction) => Promise<T>,
) => Promise<T>;
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const instant = (clock: Clock) => (typeof clock === "function" ? clock() : clock);
function found(row: IdeaBoardStored | null, now: Date) {
  if (!row || Date.parse(row.expiresAt) <= now.getTime())
    throw new IdeaBoardError("NOT_FOUND", "Idea board not found or expired");
  return row;
}
function writable(row: IdeaBoardStored, now: Date) {
  if (row.status === "closed" || Date.parse(row.closesAt) <= now.getTime())
    throw new IdeaBoardError("ROOM_CLOSED", "This idea board is closed");
}
function collecting(row: IdeaBoardStored, now: Date) {
  writable(row, now);
  if (row.status !== "collecting")
    throw new IdeaBoardError("VALIDATION_ERROR", "This action is available while collecting ideas");
}
function guestFor(row: IdeaBoardStored, tokenHash: string): Guest {
  const guest = row.guests.find(
    (candidate) =>
      candidate.tokenHash.length === tokenHash.length &&
      timingSafeEqual(Buffer.from(candidate.tokenHash), Buffer.from(tokenHash)),
  );
  if (!guest)
    throw new IdeaBoardError("UNAUTHORIZED", "Join this idea board using its shared link");
  return guest;
}
function guestView(row: IdeaBoardStored, guest: Guest, now: Date): IdeaBoardGuestView {
  const board = ideaBoardProjection(row, now);
  const own = ideaBoardProjection(row, now, true).ideas.filter((idea) =>
    guest.ideaIds.includes(idea.id),
  );
  return { board, ownIdeas: own, votedIdeaIds: [...guest.votedIdeaIds], revision: guest.revision };
}
function retry(row: IdeaBoardStored, owner: string, key: string, input: unknown) {
  const previous = row.receipts.find((receipt) => receipt.owner === owner && receipt.key === key);
  if (previous && previous.hash !== hash(input))
    throw new IdeaBoardError(
      "IDEMPOTENCY_CONFLICT",
      "This retry key was already used for another action",
    );
  return previous?.receipt;
}
function remember(
  row: IdeaBoardStored,
  owner: string,
  key: string,
  input: unknown,
  kind: string,
  revision: number,
  ideaId: string | null = null,
) {
  if (row.receipts.length >= IDEA_BOARD_MAX_RECEIPTS)
    throw new IdeaBoardError("RATE_LIMITED", "This board has reached its command limit");
  const receipt: IdeaBoardReceipt = { id: randomUUID(), kind, revision, ideaId };
  row.receipts.push({ owner, key, hash: hash(input), receipt });
  return receipt;
}
function validKey(key: string) {
  IdeaBoardVoteSchema.shape.idempotencyKey.parse(key);
}
export function ideaBoardAccountExport(value: unknown, now = new Date()) {
  return ideaBoardProjection(IdeaBoardStoredSchema.parse(value), now, true);
}
function validateStored(row: IdeaBoardStored) {
  const parsed = IdeaBoardStoredSchema.parse(row);
  const json = JSON.stringify(parsed);
  // jsonb::text inserts one space after each structural comma and colon. Mirror
  // PostgreSQL's byte bound in memory and reject before a database constraint error.
  const separatorCount = json.replace(/"(?:\\.|[^"\\])*"/g, "").match(/[,:]/g)?.length ?? 0;
  if (Buffer.byteLength(json, "utf8") + separatorCount > 1_048_576)
    throw new IdeaBoardError("ENTITLEMENT_LIMIT", "This board has reached its retained data limit");
  return parsed;
}

/** Both stores execute the same bounded state machine under one serialized board transaction. */
export class IdeaBoardRepository {
  constructor(private readonly run: Run) {}
  async create(
    workspaceId: string,
    id: string,
    input: IdeaBoardCreate,
    key: string,
    settings: {
      participantLimit: number;
      closesAt: string;
      expiresAt: string;
      replayOnly?: boolean;
    },
    clock: Clock,
  ) {
    const parsed = IdeaBoardCreateSchema.parse(input);
    validKey(key);
    return this.run(workspaceId, null, async (tx) => {
      const previous = (await tx.list()).find((row) => row.creationKey === key);
      const now = instant(clock);
      if (previous) {
        if (previous.creationHash !== hash(parsed))
          throw new IdeaBoardError(
            "IDEMPOTENCY_CONFLICT",
            "This creation key was already used for another board",
          );
        return ideaBoardProjection(found(previous, now), now, true);
      }
      if (settings.replayOnly)
        throw new IdeaBoardError("NOT_FOUND", "The accepted idea board is no longer available");
      const closesAt = Date.parse(settings.closesAt),
        expiresAt = Date.parse(settings.expiresAt);
      if (
        !Number.isFinite(closesAt) ||
        !Number.isFinite(expiresAt) ||
        closesAt <= now.getTime() ||
        expiresAt <= closesAt ||
        closesAt > now.getTime() + parsed.windowDays * 86_400_000
      )
        throw new IdeaBoardError(
          "VALIDATION_ERROR",
          "Choose valid board deadlines within the collection window",
        );
      if (
        !Number.isInteger(settings.participantLimit) ||
        settings.participantLimit < 1 ||
        settings.participantLimit > 250
      )
        throw new IdeaBoardError(
          "ENTITLEMENT_LIMIT",
          "Idea boards support up to 250 participants within the plan limit",
        );
      const row: IdeaBoardStored = {
        schemaVersion: 1,
        id,
        workspaceId,
        title: parsed.title,
        description: parsed.description,
        identityMode: parsed.identityMode,
        moderationEnabled: parsed.moderationEnabled,
        voteBudget: parsed.voteBudget,
        ideasVisible: parsed.ideasVisible,
        status: "draft",
        revision: 0,
        participantLimit: settings.participantLimit,
        createdAt: now.toISOString(),
        closesAt: settings.closesAt,
        expiresAt: settings.expiresAt,
        creationKey: key,
        creationHash: hash(parsed),
        groups: [],
        ideas: [],
        guests: [],
        receipts: [],
      };
      await tx.put(row, true);
      return ideaBoardProjection(row, now, true);
    });
  }
  getCreation(workspaceId: string, key: string, clock: Clock = () => new Date()) {
    return this.run(workspaceId, null, async (tx) => {
      const rows = await tx.list();
      const now = instant(clock);
      const row = rows.find(
        (board) => board.creationKey === key && Date.parse(board.expiresAt) > now.getTime(),
      );
      return row ? ideaBoardProjection(row, now, true) : null;
    });
  }
  list(workspaceId: string, clock: Clock = () => new Date(), moderator = true) {
    return this.run(workspaceId, null, async (tx) => {
      const rows = await tx.list();
      const now = instant(clock);
      return rows
        .filter((row) => Date.parse(row.expiresAt) > now.getTime())
        .map((row) => ({ ...ideaBoardProjection(row, now, moderator), ideas: [], groups: [] }));
    });
  }
  getModerator(workspaceId: string, id: string, clock: Clock = () => new Date()) {
    return this.run(workspaceId, id, async (tx) => {
      const row = await tx.get(id);
      const now = instant(clock);
      return ideaBoardProjection(found(row, now), now, true);
    });
  }
  getViewer(workspaceId: string, id: string, clock: Clock = () => new Date()) {
    return this.run(workspaceId, id, async (tx) => {
      const row = await tx.get(id);
      const now = instant(clock);
      return ideaBoardProjection(found(row, now), now);
    });
  }
  getPublicInfo(id: string, clock: Clock = () => new Date()) {
    return this.run(null, id, async (tx) => {
      const locked = await tx.get(id);
      const now = instant(clock);
      const row = found(locked, now);
      const view = ideaBoardProjection(row, now);
      return IdeaBoardPublicInfoSchema.parse({
        schemaVersion: 1,
        id: row.id,
        title: row.title,
        description: row.description,
        identityMode: row.identityMode,
        moderationEnabled: row.moderationEnabled,
        voteBudget: row.voteBudget,
        ideasVisible: row.ideasVisible,
        status: view.status,
        closesAt: row.closesAt,
        expiresAt: row.expiresAt,
      });
    });
  }
  join(id: string, tokenHash: string, alias: string | null, clock: Clock) {
    return this.run(null, id, async (tx) => {
      const locked = await tx.get(id);
      let now = instant(clock);
      const row = found(locked, now);
      if (!/^[a-f0-9]{64}$/.test(tokenHash))
        throw new IdeaBoardError("UNAUTHORIZED", "Invalid guest credential");
      const existing = row.guests.find((guest) => guest.tokenHash === tokenHash);
      if (existing) return guestView(row, existing, now);
      writable(row, now);
      if (row.status === "draft")
        throw new IdeaBoardError("ROOM_CLOSED", "The facilitator has not opened this board");
      await tx.admission(row.workspaceId);
      now = instant(clock);
      found(row, now);
      writable(row, now);
      if (row.guests.length >= row.participantLimit)
        throw new IdeaBoardError(
          "PARTICIPANT_LIMIT",
          "This board has reached its participant limit",
        );
      if (row.identityMode === "anonymous" && alias !== null)
        throw new IdeaBoardError("VALIDATION_ERROR", "Anonymous boards do not collect nicknames");
      const nickname = row.identityMode === "alias" ? IdeaBoardAliasSchema.parse(alias) : null;
      const guest: Guest = {
        id: randomUUID(),
        tokenHash,
        alias: nickname,
        revision: 0,
        ideaIds: [],
        votedIdeaIds: [],
      };
      row.guests.push(guest);
      await tx.put(row);
      return guestView(row, guest, now);
    });
  }
  getGuest(id: string, tokenHash: string, clock: Clock = () => new Date()) {
    return this.run(null, id, async (tx) => {
      const locked = await tx.get(id);
      const now = instant(clock);
      const row = found(locked, now);
      return guestView(row, guestFor(row, tokenHash), now);
    });
  }
  async hostCommand(
    workspaceId: string,
    id: string,
    command: IdeaBoardHostCommand,
    expectedRevision: number,
    key: string,
    clock: Clock,
  ) {
    const parsed = IdeaBoardHostCommandSchema.parse(command);
    validKey(key);
    return this.run(workspaceId, id, async (tx) => {
      const locked = await tx.get(id);
      const now = instant(clock),
        row = found(locked, now),
        input = { command: parsed, expectedRevision };
      const previous = retry(row, "host", key, input);
      if (previous) return { board: ideaBoardProjection(row, now, true), receipt: previous };
      writable(row, now);
      if (row.revision !== expectedRevision)
        throw new IdeaBoardError("STALE_DRAFT", "This board changed. Refresh before continuing");
      if (parsed.type === "collect") {
        if (row.status !== "draft")
          throw new IdeaBoardError("VALIDATION_ERROR", "Only draft boards can open collection");
        row.status = "collecting";
      } else if (parsed.type === "start_voting") {
        collecting(row, now);
        if (!row.ideas.some((idea) => idea.status === "approved"))
          throw new IdeaBoardError("VALIDATION_ERROR", "Approve at least one idea before voting");
        row.status = "voting";
      } else if (parsed.type === "close") {
        row.status = "closed";
      } else {
        collecting(row, now);
        if (parsed.type === "visibility") row.ideasVisible = parsed.visible;
        else if (parsed.type === "moderate") {
          const idea = row.ideas.find((candidate) => candidate.id === parsed.ideaId);
          if (
            !idea ||
            idea.status === "removed" ||
            (parsed.status === "approved" && idea.status !== "pending")
          )
            throw new IdeaBoardError(
              "VALIDATION_ERROR",
              "This idea cannot make that moderation transition",
            );
          idea.status = parsed.status;
          if (parsed.status === "removed") {
            idea.body = null;
            idea.alias = null;
            idea.groupId = null;
          }
        } else if (parsed.type === "group.create") {
          if (row.groups.length >= IDEA_BOARD_MAX_GROUPS)
            throw new IdeaBoardError("ENTITLEMENT_LIMIT", "Use up to 20 groups per board");
          if (row.groups.some((group) => group.id === parsed.id))
            throw new IdeaBoardError("VALIDATION_ERROR", "This group identifier is already used");
          row.groups.push({ id: parsed.id, name: parsed.name });
        } else if (parsed.type === "group.rename" || parsed.type === "group.delete") {
          const group = row.groups.find((candidate) => candidate.id === parsed.groupId);
          if (!group) throw new IdeaBoardError("NOT_FOUND", "Group not found");
          if (parsed.type === "group.rename") group.name = parsed.name;
          else {
            row.groups = row.groups.filter((candidate) => candidate.id !== group.id);
            for (const idea of row.ideas) if (idea.groupId === group.id) idea.groupId = null;
          }
        } else {
          const idea = row.ideas.find((candidate) => candidate.id === parsed.ideaId);
          if (
            !idea ||
            idea.status !== "approved" ||
            (parsed.groupId && !row.groups.some((group) => group.id === parsed.groupId))
          )
            throw new IdeaBoardError(
              "VALIDATION_ERROR",
              "Choose an approved idea and an existing group",
            );
          idea.groupId = parsed.groupId;
        }
      }
      row.revision++;
      const receipt = remember(row, "host", key, input, parsed.type, row.revision);
      await tx.put(row);
      return { board: ideaBoardProjection(row, now, true), receipt };
    });
  }
  async submitIdea(id: string, tokenHash: string, body: string, key: string, clock: Clock) {
    const parsed = IdeaBoardBodySchema.parse(body);
    validKey(key);
    return this.run(null, id, async (tx) => {
      const locked = await tx.get(id);
      const now = instant(clock),
        row = found(locked, now),
        guest = guestFor(row, tokenHash),
        input = { body: parsed };
      const previous = retry(row, guest.id, key, input);
      if (previous) return { ...guestView(row, guest, now), receipt: previous };
      collecting(row, now);
      if (
        guest.ideaIds.length >= IDEA_BOARD_MAX_GUEST_IDEAS ||
        row.ideas.length >= IDEA_BOARD_MAX_IDEAS
      )
        throw new IdeaBoardError(
          "ENTITLEMENT_LIMIT",
          "Use up to 10 ideas per guest and 200 ideas per board",
        );
      const ideaId = randomUUID();
      row.ideas.push({
        id: ideaId,
        body: parsed,
        alias: guest.alias,
        groupId: null,
        status: row.moderationEnabled ? "pending" : "approved",
        createdAt: now.toISOString(),
        guestId: guest.id,
      });
      guest.ideaIds.push(ideaId);
      row.revision++;
      const receipt = remember(row, guest.id, key, input, "idea.submit", guest.revision, ideaId);
      await tx.put(row);
      return { ...guestView(row, guest, now), receipt };
    });
  }
  async vote(
    id: string,
    tokenHash: string,
    ideaIds: string[],
    expectedRevision: number,
    key: string,
    clock: Clock,
  ) {
    const parsed = IdeaBoardVoteSchema.parse({ ideaIds, expectedRevision, idempotencyKey: key });
    const ordered = [...parsed.ideaIds].sort();
    return this.run(null, id, async (tx) => {
      const locked = await tx.get(id);
      const now = instant(clock),
        row = found(locked, now),
        guest = guestFor(row, tokenHash),
        input = { ideaIds: ordered, expectedRevision };
      const previous = retry(row, guest.id, key, input);
      if (previous) return { ...guestView(row, guest, now), receipt: previous };
      writable(row, now);
      if (row.status !== "voting")
        throw new IdeaBoardError("VALIDATION_ERROR", "Voting is not open");
      if (guest.revision !== expectedRevision)
        throw new IdeaBoardError(
          "STALE_DRAFT",
          "Your saved ballot changed. Refresh before continuing",
        );
      if (guest.revision > 0)
        throw new IdeaBoardError(
          "VALIDATION_ERROR",
          "Your final ballot has already been submitted",
        );
      if (
        ordered.length < 1 ||
        ordered.length > row.voteBudget ||
        ordered.some(
          (ideaId) => !row.ideas.some((idea) => idea.id === ideaId && idea.status === "approved"),
        )
      )
        throw new IdeaBoardError(
          "VALIDATION_ERROR",
          "Choose approved ideas within this board's vote budget",
        );
      guest.votedIdeaIds = ordered;
      guest.revision++;
      const receipt = remember(row, guest.id, key, input, "vote.submit", guest.revision);
      await tx.put(row);
      return { ...guestView(row, guest, now), receipt };
    });
  }
  delete(workspaceId: string, id: string) {
    return this.run(workspaceId, id, async (tx) => {
      if (!(await tx.get(id))) throw new IdeaBoardError("NOT_FOUND", "Idea board not found");
      await tx.remove(id);
    });
  }
  purge(now: Date) {
    return this.run(null, null, async (tx) => {
      const ids: string[] = [];
      for (const row of await tx.list())
        if (Date.parse(row.expiresAt) <= now.getTime()) {
          await tx.remove(row.id);
          ids.push(row.id);
        }
      return ids;
    });
  }
}

class MemoryIdeaBoards {
  readonly rows = new Map<string, IdeaBoardStored>();
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private readonly parent: MemoryRepository) {}
  run: Run = (workspaceId, _boardId, work) => {
    const execute = async () => {
      const tx: Transaction = {
        get: async (id) => {
          const row = this.rows.get(id);
          return row && (!workspaceId || row.workspaceId === workspaceId)
            ? IdeaBoardStoredSchema.parse(structuredClone(row))
            : null;
        },
        list: async () =>
          [...this.rows.values()]
            .filter((row) => !workspaceId || row.workspaceId === workspaceId)
            .map((row) => IdeaBoardStoredSchema.parse(structuredClone(row))),
        put: async (row, insert) => {
          if (!this.parent.workspaces.has(row.workspaceId) || (!insert && !this.rows.has(row.id)))
            throw new IdeaBoardError("NOT_FOUND", "Idea board workspace was deleted");
          this.parent.assertWorkspaceLiveSessionCreationAllowed(row.workspaceId);
          if (insert && this.rows.has(row.id))
            throw new IdeaBoardError("IDEMPOTENCY_CONFLICT", "Board identifier already used");
          this.rows.set(row.id, validateStored(structuredClone(row)));
        },
        remove: async (id) => {
          const row = this.rows.get(id);
          if (row && (!workspaceId || row.workspaceId === workspaceId)) this.rows.delete(id);
        },
        admission: async (id) => assertAudienceAdmissionInMemory(this.parent, id),
      };
      // Mutators edit detached documents and commit only after all validation succeeds.
      return work(tx);
    };
    const task = this.queue.then(() =>
      getMemoryPlatformRepository(this.parent).withTransaction(execute),
    );
    this.queue = task.catch(() => undefined);
    return task;
  };
  exportAccount({ ownedWorkspaceIds }: MemoryRepositoryLifecycleContext) {
    const now = new Date();
    return {
      ideaBoards: [...this.rows.values()]
        .filter(
          (row) =>
            ownedWorkspaceIds.has(row.workspaceId) && Date.parse(row.expiresAt) > now.getTime(),
        )
        .map((row) => ideaBoardAccountExport(row, now)),
    };
  }
  deleteAccount({ ownedWorkspaceIds }: MemoryRepositoryLifecycleContext) {
    for (const [id, row] of this.rows)
      if (ownedWorkspaceIds.has(row.workspaceId)) this.rows.delete(id);
  }
  purgeExpired(now: Date) {
    const ids: string[] = [];
    for (const [id, row] of this.rows)
      if (Date.parse(row.expiresAt) <= now.getTime()) {
        this.rows.delete(id);
        ids.push(id);
      }
    return ids;
  }
}
function postgresRun(repository: PostgresRepository): Run {
  return async (workspaceId, boardId, work) => {
    const client = await repository.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config($1,$2,true)", [
        workspaceId ? "app.workspace_id" : "app.system_access",
        workspaceId ?? "on",
      ]);
      if (workspaceId)
        await client.query("SELECT id FROM workspaces WHERE id=$1 FOR UPDATE", [workspaceId]);
      else if (boardId) {
        const board = await client.query("SELECT workspace_id FROM idea_boards WHERE id=$1", [
          boardId,
        ]);
        if (board.rows[0])
          await client.query("SELECT id FROM workspaces WHERE id=$1 FOR SHARE", [
            board.rows[0].workspace_id,
          ]);
      }
      const tx: Transaction = {
        get: async (id) => {
          const result = await client.query("SELECT data FROM idea_boards WHERE id=$1 FOR UPDATE", [
            id,
          ]);
          return result.rows[0] ? IdeaBoardStoredSchema.parse(result.rows[0].data) : null;
        },
        list: async () =>
          (await client.query("SELECT data FROM idea_boards ORDER BY id")).rows.map((row) =>
            IdeaBoardStoredSchema.parse(row.data),
          ),
        put: async (row, insert) => {
          validateStored(row);
          if (insert) {
            if (
              (
                await client.query(
                  "SELECT 1 FROM workspace_media_deletion_jobs WHERE workspace_id=$1",
                  [row.workspaceId],
                )
              ).rowCount
            )
              throw new IdeaBoardError("ROOM_CLOSED", "This workspace is being deleted");
            await client.query(
              "INSERT INTO idea_boards(id,workspace_id,creation_key,retention_expires_at,data) VALUES($1,$2,$3,$4,$5)",
              [row.id, row.workspaceId, row.creationKey, row.expiresAt, row],
            );
          } else await client.query("UPDATE idea_boards SET data=$2 WHERE id=$1", [row.id, row]);
        },
        remove: async (id) => {
          await client.query("DELETE FROM idea_boards WHERE id=$1", [id]);
        },
        admission: (id) => assertAudienceAdmissionForTransaction(client, id),
      };
      const value = await work(tx);
      await client.query("COMMIT");
      return value;
    } catch (error) {
      await client.query("ROLLBACK");
      if (error && typeof error === "object" && "code" in error && error.code === "23505")
        throw new IdeaBoardError(
          "IDEMPOTENCY_CONFLICT",
          "This board identifier or creation key is already used",
        );
      throw error;
    } finally {
      client.release();
    }
  };
}
export function createIdeaBoardRepository(repository: Repository) {
  if (repository instanceof PostgresRepository)
    return new IdeaBoardRepository(postgresRun(repository));
  if (repository instanceof MemoryRepository)
    return new IdeaBoardRepository(
      repository.getOrCreateLifecycleExtension("ideaBoards", () => new MemoryIdeaBoards(repository))
        .run,
    );
  throw new Error("Unsupported idea board repository");
}
