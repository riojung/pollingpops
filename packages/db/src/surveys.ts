import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import type { PoolClient } from "pg";
import {
  SurveyContentSchema,
  SurveyDraftSchema,
  surveyAggregate,
  validateSurveyResponses,
  type SurveyDraft,
  type SurveyResponses,
} from "@openround/contracts/surveys";
import { MemoryRepository, type MemoryRepositoryLifecycleContext } from "./memory.js";
import { PostgresRepository } from "./postgres.js";
import {
  PublishedQuizLimitError,
  SessionCodeConflictError,
  type Repository,
  type LiveRoomCodeRecord,
} from "./types.js";

export class SurveyError extends Error {
  constructor(
    public readonly code:
      | "NOT_FOUND"
      | "UNAUTHORIZED"
      | "STALE_DRAFT"
      | "IDEMPOTENCY_CONFLICT"
      | "ROOM_CLOSED"
      | "VALIDATION_ERROR"
      | "PARTICIPANT_LIMIT"
      | "RATE_LIMITED",
    message: string,
  ) {
    super(message);
  }
}
export interface SurveyRecord {
  schemaVersion: 1;
  id: string;
  workspaceId: string;
  draft: SurveyDraft;
  revision: number;
  status: "draft" | "published" | "archived";
  versionId: string | null;
  publishedRevision: number | null;
}
export interface SurveyVersion {
  schemaVersion: 1;
  id: string;
  workspaceId: string;
  surveyId: string;
  content: SurveyDraft;
  revision: number;
}
export interface SurveyRoom {
  schemaVersion: 1;
  id: string;
  workspaceId: string;
  surveyId: string;
  versionId: string;
  content: SurveyDraft;
  code: string;
  closesAt: string;
  expiresAt: string;
  closed: boolean;
  participantLimit: number;
  identityPolicy: "organizer_blind";
}
interface Guest {
  schemaVersion: 1;
  id: string;
  workspaceId: string;
  roomId: string;
  tokenHash: string;
  revision: number;
  responses: SurveyResponses;
  finalized: boolean;
  receipt: string | null;
}
type Documents = {
  surveys: SurveyRecord;
  survey_versions: SurveyVersion;
  survey_feedback_rooms: SurveyRoom;
  survey_guests: Guest;
};
type Table = keyof Documents;
function compatibleDocument<T extends Table>(table: T, value: unknown): Documents[T] {
  const row = value as Documents[T];
  if (!row || row.schemaVersion !== 1)
    throw new Error(`Unsupported stored ${table} schema; keep compatible readers deployed`);
  if ("draft" in row) SurveyDraftSchema.parse(row.draft);
  if ("content" in row) SurveyContentSchema.parse(row.content);
  return row;
}
type Receipt = {
  workspaceId: string;
  surveyId: string;
  roomId: string | null;
  ownerId: string;
  key: string;
  requestHash: string;
  receipt: unknown;
};
interface Transaction {
  get<T extends Table>(table: T, id: string): Promise<Documents[T] | null>;
  list<T extends Table>(table: T, roomId?: string): Promise<Documents[T][]>;
  put<T extends Table>(table: T, row: Documents[T], insert?: boolean): Promise<void>;
  remove(table: Table, id: string): Promise<void>;
  countPublished(workspaceId: string): Promise<number>;
  receipt(ownerId: string, key: string): Promise<Receipt | null>;
  remember(receipt: Receipt): Promise<void>;
}
type Run = <T>(
  workspaceId: string | null,
  work: (tx: Transaction) => Promise<T>,
  publication?: boolean,
) => Promise<T>;
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
function requireRecord<T>(row: T | null): T {
  if (!row) throw new SurveyError("NOT_FOUND", "Survey or room not found");
  return row;
}
function revision(actual: number, expected: number) {
  if (actual !== expected)
    throw new SurveyError("STALE_DRAFT", "This draft changed. Reload it before editing again");
}
function open(room: SurveyRoom, now: Date) {
  if (room.closed || new Date(room.closesAt) <= now || new Date(room.expiresAt) <= now)
    throw new SurveyError(
      "ROOM_CLOSED",
      "This survey is closed. Ask the facilitator for a new link",
    );
}
function authorized(guest: Guest | undefined, tokenHash: string): Guest {
  if (
    !guest ||
    guest.tokenHash.length !== tokenHash.length ||
    !timingSafeEqual(Buffer.from(guest.tokenHash), Buffer.from(tokenHash))
  )
    throw new SurveyError(
      "UNAUTHORIZED",
      "Your survey access is invalid. Join again using the shared code",
    );
  return guest;
}

/** Shared business rules; PostgreSQL and memory differ only in transaction/storage mechanics. */
export class SurveyRepository {
  constructor(private readonly run: Run) {}
  private async mutate<T>(
    tx: Transaction,
    owner: { workspaceId: string; surveyId: string; roomId?: string; ownerId: string },
    key: string,
    input: unknown,
    work: () => Promise<T>,
  ): Promise<T> {
    const requestHash = hash(input);
    const previous = await tx.receipt(owner.ownerId, key);
    if (previous) {
      if (previous.requestHash !== requestHash)
        throw new SurveyError(
          "IDEMPOTENCY_CONFLICT",
          "This retry key was already used for a different operation",
        );
      return structuredClone(previous.receipt) as T;
    }
    const receipt = await work();
    await tx.remember({ ...owner, roomId: owner.roomId ?? null, key, requestHash, receipt });
    return receipt;
  }
  create(workspaceId: string, id: string, draft: SurveyDraft, key: string) {
    return this.run(workspaceId, async (tx) =>
      this.mutate(
        tx,
        { workspaceId, surveyId: id, ownerId: id },
        key,
        { action: "create", draft },
        async () => {
          const record: SurveyRecord = {
            schemaVersion: 1,
            id,
            workspaceId,
            draft: SurveyDraftSchema.parse(draft),
            revision: 0,
            status: "draft",
            versionId: null,
            publishedRevision: null,
          };
          await tx.put("surveys", record, true);
          return record;
        },
      ),
    );
  }
  list(workspaceId: string) {
    return this.run(workspaceId, (tx) => tx.list("surveys"));
  }
  get(workspaceId: string, id: string) {
    return this.run(workspaceId, (tx) => tx.get("surveys", id));
  }
  save(workspaceId: string, id: string, draft: SurveyDraft, expected: number, key: string) {
    return this.run(workspaceId, async (tx) => {
      const record = requireRecord(await tx.get("surveys", id));
      return this.mutate(
        tx,
        { workspaceId, surveyId: id, ownerId: id },
        key,
        { action: "save", draft, expected },
        async () => {
          revision(record.revision, expected);
          if (record.status === "archived")
            throw new SurveyError(
              "VALIDATION_ERROR",
              "Duplicate an archived survey before editing it",
            );
          record.draft = SurveyDraftSchema.parse(draft);
          record.revision++;
          await tx.put("surveys", record);
          return record;
        },
      );
    });
  }
  publish(workspaceId: string, id: string, expected: number, key: string, limit: number | null) {
    return this.run(
      workspaceId,
      async (tx) => {
        const record = requireRecord(await tx.get("surveys", id));
        return this.mutate(
          tx,
          { workspaceId, surveyId: id, ownerId: id },
          key,
          { action: "publish", expected },
          async () => {
            revision(record.revision, expected);
            if (record.status === "archived")
              throw new SurveyError(
                "VALIDATION_ERROR",
                "Duplicate an archived survey before publishing",
              );
            const content = SurveyContentSchema.parse(record.draft);
            if (
              record.status !== "published" &&
              limit !== null &&
              (await tx.countPublished(workspaceId)) >= limit
            )
              throw new PublishedQuizLimitError(limit);
            if (record.publishedRevision !== record.revision || !record.versionId) {
              const version: SurveyVersion = {
                schemaVersion: 1,
                id: randomUUID(),
                workspaceId,
                surveyId: id,
                content,
                revision: record.revision,
              };
              await tx.put("survey_versions", version, true);
              record.versionId = version.id;
            }
            record.status = "published";
            record.publishedRevision = record.revision;
            await tx.put("surveys", record);
            return record;
          },
        );
      },
      true,
    );
  }
  archive(workspaceId: string, id: string, expected: number, key: string) {
    return this.run(
      workspaceId,
      async (tx) => {
        const record = requireRecord(await tx.get("surveys", id));
        return this.mutate(
          tx,
          { workspaceId, surveyId: id, ownerId: id },
          key,
          { action: "archive", expected },
          async () => {
            revision(record.revision, expected);
            record.status = "archived";
            record.revision++;
            await tx.put("surveys", record);
            return record;
          },
        );
      },
      true,
    );
  }
  createRoom(
    workspaceId: string,
    id: string,
    expected: number,
    key: string,
    settings: {
      code: string;
      closesAt: string;
      expiresAt: string;
      participantLimit: number;
      windowDays: number;
    },
  ) {
    return this.run(workspaceId, async (tx) => {
      const survey = requireRecord(await tx.get("surveys", id));
      const roomId = randomUUID();
      return this.mutate(
        tx,
        { workspaceId, surveyId: id, roomId, ownerId: id },
        key,
        {
          action: "room.create",
          expected,
          windowDays: settings.windowDays,
        },
        async () => {
          revision(survey.revision, expected);
          if (
            survey.status !== "published" ||
            survey.publishedRevision !== survey.revision ||
            !survey.versionId
          )
            throw new SurveyError(
              "VALIDATION_ERROR",
              "Save and publish your latest changes before sharing this survey",
            );
          const version = requireRecord(await tx.get("survey_versions", survey.versionId));
          const closesAt = Date.parse(settings.closesAt);
          const expiresAt = Date.parse(settings.expiresAt);
          if (!Number.isFinite(closesAt) || !Number.isFinite(expiresAt) || expiresAt <= closesAt)
            throw new SurveyError(
              "VALIDATION_ERROR",
              "The survey must retain results after its submission deadline",
            );
          const room: SurveyRoom = {
            schemaVersion: 1,
            id: roomId,
            workspaceId,
            surveyId: id,
            versionId: version.id,
            content: version.content,
            code: settings.code,
            closesAt: settings.closesAt,
            expiresAt: settings.expiresAt,
            participantLimit: settings.participantLimit,
            closed: false,
            identityPolicy: "organizer_blind",
          };
          await tx.put("survey_feedback_rooms", room, true);
          return room;
        },
      );
    });
  }
  getRoom(id: string, workspaceId: string | null = null) {
    return this.run(workspaceId, (tx) => tx.get("survey_feedback_rooms", id));
  }
  listRooms(workspaceId: string) {
    return this.run(workspaceId, (tx) => tx.list("survey_feedback_rooms"));
  }
  admit(id: string, tokenHash: string, clock: Date | (() => Date)) {
    return this.run(null, async (tx) => {
      const room = requireRecord(await tx.get("survey_feedback_rooms", id));
      const now = typeof clock === "function" ? clock() : clock;
      open(room, now);
      const guests = await tx.list("survey_guests", id);
      const existing = guests.find((g) => g.tokenHash === tokenHash);
      if (existing) return this.attemptView(room, existing);
      if (guests.length >= room.participantLimit)
        throw new SurveyError(
          "PARTICIPANT_LIMIT",
          "This survey has reached its participation limit",
        );
      const guest: Guest = {
        schemaVersion: 1,
        id: randomUUID(),
        workspaceId: room.workspaceId,
        roomId: id,
        tokenHash,
        revision: 0,
        responses: {},
        finalized: false,
        receipt: null,
      };
      await tx.put("survey_guests", guest, true);
      return this.attemptView(room, guest);
    });
  }
  private attemptView(room: SurveyRoom, guest: Guest) {
    return {
      roomId: room.id,
      content: room.content,
      closesAt: room.closesAt,
      closed: room.closed,
      revision: guest.revision,
      responses: guest.responses,
      finalized: guest.finalized,
      receipt: guest.receipt,
    };
  }
  attempt(id: string, tokenHash: string, now: Date) {
    return this.run(null, async (tx) => {
      const room = requireRecord(await tx.get("survey_feedback_rooms", id));
      if (new Date(room.expiresAt) <= now)
        throw new SurveyError("NOT_FOUND", "This survey has expired");
      const guest = authorized(
        (await tx.list("survey_guests", id)).find((g) => g.tokenHash === tokenHash),
        tokenHash,
      );
      return this.attemptView(room, guest);
    });
  }
  respond(
    id: string,
    tokenHash: string,
    responses: SurveyResponses,
    expected: number,
    key: string,
    final: boolean,
    clock: Date | (() => Date),
  ) {
    return this.run(null, async (tx) => {
      const room = requireRecord(await tx.get("survey_feedback_rooms", id));
      const now = typeof clock === "function" ? clock() : clock;
      if (new Date(room.expiresAt) <= now)
        throw new SurveyError("NOT_FOUND", "This survey has expired");
      const guest = authorized(
        (await tx.list("survey_guests", id)).find((g) => g.tokenHash === tokenHash),
        tokenHash,
      );
      return this.mutate(
        tx,
        { workspaceId: room.workspaceId, surveyId: room.surveyId, roomId: id, ownerId: guest.id },
        key,
        { action: final ? "submit" : "save", responses, expected },
        async () => {
          open(room, typeof clock === "function" ? clock() : clock);
          revision(guest.revision, expected);
          if (guest.finalized)
            throw new SurveyError("VALIDATION_ERROR", "This survey has already been submitted");
          const issues = validateSurveyResponses(room.content, responses, final);
          if (issues.length) throw new SurveyError("VALIDATION_ERROR", issues.join(". "));
          guest.responses = responses;
          guest.revision++;
          guest.finalized = final;
          if (final) guest.receipt = randomUUID();
          await tx.put("survey_guests", guest);
          return this.attemptView(room, guest);
        },
      );
    });
  }
  results(workspaceId: string, id: string, now: Date) {
    return this.run(workspaceId, async (tx) => {
      const room = requireRecord(await tx.get("survey_feedback_rooms", id));
      if (new Date(room.expiresAt) <= now)
        throw new SurveyError("NOT_FOUND", "This survey has expired");
      return surveyAggregate(
        room.content,
        (await tx.list("survey_guests", id)).filter((g) => g.finalized).map((g) => g.responses),
        room.closed || new Date(room.closesAt) <= now,
      );
    });
  }
  close(workspaceId: string, id: string) {
    return this.run(workspaceId, async (tx) => {
      const room = requireRecord(await tx.get("survey_feedback_rooms", id));
      room.closed = true;
      await tx.put("survey_feedback_rooms", room);
    });
  }
  deleteRoom(workspaceId: string, id: string) {
    return this.run(workspaceId, async (tx) => {
      requireRecord(await tx.get("survey_feedback_rooms", id));
      await tx.remove("survey_feedback_rooms", id);
    });
  }
}

class MemorySurveyStore {
  readonly surveys = new Map<string, SurveyRecord>();
  readonly survey_versions = new Map<string, SurveyVersion>();
  readonly survey_feedback_rooms = new Map<string, SurveyRoom>();
  readonly survey_guests = new Map<string, Guest>();
  private receipts = new Map<string, Receipt>();
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private readonly parent: MemoryRepository) {}
  run: Run = (workspaceId, work, _publication = false) => {
    const execute = async () => {
      const maps = structuredClone({
        surveys: this.surveys,
        survey_versions: this.survey_versions,
        survey_feedback_rooms: this.survey_feedback_rooms,
        survey_guests: this.survey_guests,
        receipts: this.receipts,
      });
      const reservedClaims: Array<{
        code: string;
        artifactId: string;
        previous?: LiveRoomCodeRecord;
      }> = [];
      const tx: Transaction = {
        get: async (table, id) => {
          const row = this[table].get(id);
          return row && (!workspaceId || row.workspaceId === workspaceId)
            ? (compatibleDocument(table, structuredClone(row)) as never)
            : null;
        },
        list: async (table, roomId) =>
          [...this[table].values()]
            .filter(
              (r) =>
                (!workspaceId || r.workspaceId === workspaceId) &&
                (!roomId || ("roomId" in r && r.roomId === roomId)),
            )
            .map((r) => compatibleDocument(table, structuredClone(r))) as never,
        put: async (table, row, insert) => {
          if (table === "survey_feedback_rooms" && insert) {
            const room = row as SurveyRoom;
            await this.parent.assertWorkspaceLiveSessionCreationAllowed(room.workspaceId);
            reservedClaims.push({
              code: room.code,
              artifactId: room.id,
              previous: this.parent.liveRoomCodes.get(room.code),
            });
            await this.parent.claimLiveRoomCode({
              code: room.code,
              workspaceId: room.workspaceId,
              artifactType: "feedback_room",
              artifactId: room.id,
              createdAt: new Date(),
              expiresAt: new Date(room.closesAt),
            });
          }
          if (insert && this[table].has(row.id))
            throw new SurveyError("IDEMPOTENCY_CONFLICT", "This identifier is already used");
          (this[table] as Map<string, Documents[Table]>).set(row.id, structuredClone(row));
        },
        remove: async (table, id) => {
          this[table].delete(id);
          if (table === "survey_feedback_rooms") this.deleteRoomData(id);
        },
        countPublished: async (ws) =>
          [...this.parent.quizzes.values()].filter(
            (q) => q.workspaceId === ws && q.status === "published",
          ).length + this.publishedSurveyCount(ws),
        receipt: async (owner, key) => {
          const r = this.receipts.get(`${owner}:${key}`);
          return r && (!workspaceId || r.workspaceId === workspaceId) ? structuredClone(r) : null;
        },
        remember: async (receipt) => {
          this.receipts.set(`${receipt.ownerId}:${receipt.key}`, structuredClone(receipt));
        },
      };
      try {
        return await work(tx);
      } catch (error) {
        for (const table of [
          "surveys",
          "survey_versions",
          "survey_feedback_rooms",
          "survey_guests",
        ] as const) {
          this[table].clear();
          for (const [id, row] of maps[table])
            (this[table] as Map<string, Documents[Table]>).set(id, row);
        }
        this.receipts = maps.receipts;
        // Roll back only this extension's claims; unrelated Round/Presentation claims remain intact.
        for (const { code, artifactId, previous } of reservedClaims) {
          if (this.parent.liveRoomCodes.get(code)?.artifactId !== artifactId) continue;
          if (previous) this.parent.liveRoomCodes.set(code, previous);
          else this.parent.liveRoomCodes.delete(code);
        }
        throw error;
      }
    };
    const task = this.queue.then(() =>
      workspaceId ? this.parent.withPublicationLock(workspaceId, execute) : execute(),
    );
    this.queue = task.catch(() => undefined);
    return task;
  };
  publishedSurveyCount(workspaceId: string) {
    return [...this.surveys.values()].filter(
      (s) => s.workspaceId === workspaceId && s.status === "published",
    ).length;
  }
  private deleteRoomData(id: string) {
    for (const guest of this.survey_guests.values())
      if (guest.roomId === id) this.survey_guests.delete(guest.id);
    for (const [key, receipt] of this.receipts)
      if (receipt.roomId === id) this.receipts.delete(key);
    for (const [code, claim] of this.parent.liveRoomCodes)
      if (claim.artifactType === "feedback_room" && claim.artifactId === id)
        this.parent.liveRoomCodes.delete(code);
  }
  exportAccount({ ownedWorkspaceIds }: MemoryRepositoryLifecycleContext) {
    return {
      surveys: [...this.surveys.values()].filter((r) => ownedWorkspaceIds.has(r.workspaceId)),
      surveyVersions: [...this.survey_versions.values()].filter((r) =>
        ownedWorkspaceIds.has(r.workspaceId),
      ),
      surveyRooms: [...this.survey_feedback_rooms.values()].filter((r) =>
        ownedWorkspaceIds.has(r.workspaceId),
      ),
    };
  }
  deleteAccount({ ownedWorkspaceIds }: MemoryRepositoryLifecycleContext) {
    for (const room of this.survey_feedback_rooms.values())
      if (ownedWorkspaceIds.has(room.workspaceId)) {
        this.survey_feedback_rooms.delete(room.id);
        this.deleteRoomData(room.id);
      }
    for (const table of [this.surveys, this.survey_versions])
      for (const row of table.values())
        if (ownedWorkspaceIds.has(row.workspaceId)) table.delete(row.id);
    for (const [key, receipt] of this.receipts)
      if (ownedWorkspaceIds.has(receipt.workspaceId)) this.receipts.delete(key);
  }
  purgeExpired(now: Date) {
    const ids: string[] = [];
    for (const room of this.survey_feedback_rooms.values())
      if (new Date(room.expiresAt) <= now) {
        ids.push(room.id);
        this.survey_feedback_rooms.delete(room.id);
        this.deleteRoomData(room.id);
      }
    return ids;
  }
}

function postgresRun(repository: PostgresRepository): Run {
  return async (workspaceId, work, _publication) => {
    const client: PoolClient = await repository.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config($1, $2, true)", [
        workspaceId ? "app.workspace_id" : "app.system_access",
        workspaceId ?? "on",
      ]);
      if (workspaceId)
        await client.query("SELECT id FROM workspaces WHERE id = $1 FOR UPDATE", [workspaceId]);
      const tx: Transaction = {
        get: async (table, id) => {
          const result = await client.query(`SELECT data FROM ${table} WHERE id = $1 FOR UPDATE`, [
            id,
          ]);
          return result.rows[0] ? compatibleDocument(table, result.rows[0].data) : null;
        },
        list: async (table, roomId) =>
          (
            await client.query(
              `SELECT data FROM ${table}${roomId ? " WHERE room_id = $1" : ""} ORDER BY id`,
              roomId ? [roomId] : [],
            )
          ).rows.map((r) => compatibleDocument(table, r.data)),
        put: async (table, row, insert) => {
          if (!insert) {
            await client.query(`UPDATE ${table} SET data = $2 WHERE id = $1`, [row.id, row]);
            return;
          }
          if (table === "surveys")
            await client.query("INSERT INTO surveys (id, workspace_id, data) VALUES ($1,$2,$3)", [
              row.id,
              row.workspaceId,
              row,
            ]);
          else if (table === "survey_versions") {
            const version = row as SurveyVersion;
            await client.query(
              "INSERT INTO survey_versions (id, workspace_id, survey_id, data) VALUES ($1,$2,$3,$4)",
              [row.id, row.workspaceId, version.surveyId, row],
            );
          } else if (table === "survey_feedback_rooms") {
            const room = row as SurveyRoom;
            await client.query("SELECT id FROM workspaces WHERE id = $1 FOR UPDATE", [
              room.workspaceId,
            ]);
            const deletion = await client.query(
              "SELECT 1 FROM workspace_media_deletion_jobs WHERE workspace_id = $1",
              [room.workspaceId],
            );
            if (deletion.rowCount)
              throw new SurveyError("ROOM_CLOSED", "This workspace is being deleted");
            await client.query(
              "INSERT INTO survey_feedback_rooms (id, workspace_id, survey_id, version_id, code, closes_at, retention_expires_at, data) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
              [
                room.id,
                room.workspaceId,
                room.surveyId,
                room.versionId,
                room.code,
                room.closesAt,
                room.expiresAt,
                row,
              ],
            );
          } else {
            const guest = row as Guest;
            await client.query(
              "INSERT INTO survey_guests (id, workspace_id, room_id, data) VALUES ($1,$2,$3,$4)",
              [row.id, row.workspaceId, guest.roomId, row],
            );
          }
        },
        remove: async (table, id) => {
          await client.query(`DELETE FROM ${table} WHERE id = $1`, [id]);
        },
        countPublished: async (ws) =>
          Number(
            (
              await client.query(
                "SELECT (SELECT count(*) FROM quizzes WHERE workspace_id = $1 AND status = 'published') + (SELECT count(*) FROM surveys WHERE workspace_id = $1 AND data->>'status' = 'published') AS count",
                [ws],
              )
            ).rows[0].count,
          ),
        receipt: async (owner, key) => {
          const r = (
            await client.query(
              "SELECT * FROM survey_mutation_receipts WHERE owner_id = $1 AND idempotency_key = $2",
              [owner, key],
            )
          ).rows[0];
          return r
            ? {
                workspaceId: r.workspace_id,
                surveyId: r.survey_id,
                roomId: r.room_id,
                ownerId: owner,
                key,
                requestHash: r.request_hash,
                receipt: r.receipt,
              }
            : null;
        },
        remember: async (r) => {
          await client.query(
            "INSERT INTO survey_mutation_receipts (workspace_id, survey_id, room_id, owner_id, idempotency_key, request_hash, receipt) VALUES ($1,$2,$3,$4,$5,$6,$7)",
            [r.workspaceId, r.surveyId, r.roomId, r.ownerId, r.key, r.requestHash, r.receipt],
          );
        },
      };
      const result = await work(tx);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      if (
        typeof error === "object" &&
        error &&
        "code" in error &&
        error.code === "23505" &&
        "constraint" in error &&
        error.constraint === "live_room_codes_pkey"
      )
        throw new SessionCodeConflictError("reserved");
      throw error;
    } finally {
      client.release();
    }
  };
}
export function createSurveyRepository(repository: Repository) {
  if (repository instanceof PostgresRepository)
    return new SurveyRepository(postgresRun(repository));
  if (repository instanceof MemoryRepository) {
    const store = repository.getOrCreateLifecycleExtension(
      "surveys",
      () => new MemorySurveyStore(repository),
    );
    return new SurveyRepository(store.run);
  }
  throw new Error("Unsupported survey repository");
}
