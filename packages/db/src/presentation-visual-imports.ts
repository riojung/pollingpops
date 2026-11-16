import { randomUUID } from "node:crypto";
import type { PoolClient, QueryResultRow } from "pg";
import {
  CreatePresentationVisualImportSchema,
  PresentationVisualImportJobSchema,
  PRESENTATION_VISUAL_IMPORT_RETENTION_MS,
  PRESENTATION_VISUAL_IMPORT_MAX_ACTIVE_JOBS,
  PRESENTATION_VISUAL_IMPORT_MAX_DAILY_JOBS,
  type PresentationVisualImportJob,
} from "@openround/contracts";
import { MemoryRepository, type MemoryRepositoryLifecycleContext } from "./memory.js";
import { PostgresRepository } from "./postgres.js";
import { createPresentationRepository } from "./presentations.js";
import type { Repository } from "./types.js";
import {
  PresentationVisualImportError,
  type PresentationVisualImportRepository,
  type PresentationVisualImportCreateInput,
  type PresentationVisualImportClaim,
  type PresentationVisualImportFence,
} from "./presentation-visual-import-types.js";

interface JobRecord {
  job: PresentationVisualImportJob;
  workspaceId: string;
  createdBy: string | null;
  requestId: string;
  requestHash: string;
  files: Array<{
    name: string;
    mimeType: PresentationVisualImportClaim["files"][number]["mimeType"];
    base64: string;
  }> | null;
  availableAt: Date;
  leaseToken: string | null;
  leaseUntil: Date | null;
  reservedIds: string[];
}
const clone = <T>(value: T): T => structuredClone(value);
const view = (row: JobRecord) => PresentationVisualImportJobSchema.parse(row.job);
const valid = (row: JobRecord | undefined | null, fence: PresentationVisualImportFence) =>
  !!row &&
  row.job.status === "processing" &&
  row.job.attempts === fence.attempt &&
  row.leaseToken === fence.leaseToken &&
  row.leaseUntil !== null &&
  row.leaseUntil > (fence.now ?? new Date()) &&
  Date.parse(row.job.expiresAt) > (fence.now ?? new Date()).getTime();
function checkedInput(input: PresentationVisualImportCreateInput): JobRecord {
  if (!/^[a-f0-9]{64}$/.test(input.requestHash) || !/^[a-f0-9]{64}$/.test(input.sourceDigest))
    throw new PresentationVisualImportError("CONFLICT");
  const files = CreatePresentationVisualImportSchema.parse({
    requestId: input.requestId,
    files: input.files.map((file) => ({
      name: file.name,
      mimeType: file.mimeType,
      base64: file.bytes.toString("base64"),
    })),
    retainOriginal: false,
  }).files;
  const now = input.now ?? new Date();
  const expires = new Date(
    Math.min(
      input.expiresAt?.getTime() ?? Infinity,
      now.getTime() + PRESENTATION_VISUAL_IMPORT_RETENTION_MS,
    ),
  );
  if (expires <= now) throw new PresentationVisualImportError("CONFLICT");
  return {
    workspaceId: input.workspaceId,
    createdBy: input.createdBy,
    requestId: input.requestId,
    requestHash: input.requestHash,
    files,
    availableAt: now,
    leaseToken: null,
    leaseUntil: null,
    reservedIds: [],
    job: PresentationVisualImportJobSchema.parse({
      id: input.id,
      presentationId: input.presentationId,
      status: "pending",
      attempts: 0,
      sourceType: files[0]!.mimeType === "application/pdf" ? "pdf" : "image_set",
      sourceName: files[0]!.name,
      sourceDigest: input.sourceDigest,
      fileCount: files.length,
      pageCount: 0,
      pages: [],
      warnings: [],
      error: null,
      retainOriginal: false,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      expiresAt: expires.toISOString(),
    }),
  };
}
function claimView(row: JobRecord): PresentationVisualImportClaim {
  return {
    ...view(row),
    workspaceId: row.workspaceId,
    createdBy: row.createdBy,
    requestId: row.requestId,
    requestHash: row.requestHash,
    attempt: row.job.attempts,
    leaseToken: row.leaseToken!,
    leaseUntil: new Date(row.leaseUntil!),
    files: row.files!.map((file) => ({
      name: file.name,
      mimeType: file.mimeType,
      bytes: Buffer.from(file.base64, "base64"),
    })),
  };
}
function checkReplay(row: JobRecord, input: PresentationVisualImportCreateInput) {
  if (row.requestHash !== input.requestHash || row.job.sourceDigest !== input.sourceDigest)
    throw new PresentationVisualImportError(
      "CONFLICT",
      "This visual import request key was already used for another source",
    );
  return { status: "duplicate" as const, job: view(row) };
}
function checkedAssets(
  row: JobRecord,
  assets: Parameters<PresentationVisualImportRepository["reservePageAssets"]>[0]["assets"],
) {
  if (
    !assets.length ||
    assets.length > 40 ||
    new Set(assets.map((asset) => asset.id)).size !== assets.length ||
    new Set([...row.reservedIds, ...assets.map((asset) => asset.id)]).size > 40 ||
    assets.some(
      (asset) =>
        asset.workspaceId !== row.workspaceId ||
        asset.scanStatus !== "pending" ||
        !["image/png", "image/jpeg", "image/webp"].includes(asset.mimeType) ||
        asset.sizeBytes < 1 ||
        asset.sizeBytes > 10 * 1024 * 1024 ||
        !asset.altText.trim() ||
        asset.altText.length > 300 ||
        !asset.objectKey.startsWith(`quarantine/${row.workspaceId}/${asset.id}.`),
    )
  )
    throw new PresentationVisualImportError("CONFLICT", "Invalid visual page asset reservation");
}
function finish(row: JobRecord, status: "ready" | "pending" | "failed" | "canceled", now: Date) {
  row.job.status = status;
  row.job.updatedAt = now.toISOString();
  row.leaseToken = null;
  row.leaseUntil = null;
  if (status !== "pending") row.files = null;
  if (status !== "ready") {
    row.job.pages = [];
    row.job.pageCount = 0;
  }
}
class MemoryVisualImports implements PresentationVisualImportRepository {
  private readonly rows = new Map<string, JobRecord>();
  private readonly dailyUsage = new Map<string, number>();
  constructor(private readonly repository: MemoryRepository) {
    createPresentationRepository(repository);
  }
  assertReady(workspaceId: string, presentationId: string, jobId: string) {
    const row = this.rows.get(jobId);
    if (
      !row ||
      row.workspaceId !== workspaceId ||
      row.job.presentationId !== presentationId ||
      row.job.status !== "ready" ||
      Date.parse(row.job.expiresAt) <= Date.now() ||
      !this.eligible(workspaceId, presentationId)
    )
      throw new PresentationVisualImportError(
        "CONFLICT",
        "This visual import is no longer ready to insert",
      );
  }
  private eligible(workspaceId: string, presentationId: string) {
    return (
      !this.repository.workspaceMediaDeletionClaims.has(workspaceId) &&
      this.repository.hasLibraryArtifact(workspaceId, "presentation", presentationId)
    );
  }
  private release(row: JobRecord) {
    for (const [key, reference] of this.repository.mediaReferences)
      if (
        reference.workspaceId === row.workspaceId &&
        reference.ownerType === "presentation_visual_import" &&
        reference.ownerId === row.job.id
      )
        this.repository.mediaReferences.delete(key);
    row.reservedIds = [];
  }
  async create(input: PresentationVisualImportCreateInput) {
    const row = checkedInput(input),
      now = input.now ?? new Date();
    if (!this.eligible(input.workspaceId, input.presentationId))
      throw new PresentationVisualImportError("NOT_FOUND");
    const prior = [...this.rows.values()].find(
      (row) =>
        row.workspaceId === input.workspaceId &&
        row.job.presentationId === input.presentationId &&
        row.requestId === input.requestId,
    );
    if (prior) return checkReplay(prior, input);
    const rows = [...this.rows.values()].filter((row) => row.workspaceId === input.workspaceId);
    const dayStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    if (
      rows.filter(
        (row) =>
          ["pending", "processing"].includes(row.job.status) &&
          Date.parse(row.job.expiresAt) > now.getTime(),
      ).length >= PRESENTATION_VISUAL_IMPORT_MAX_ACTIVE_JOBS ||
      (this.dailyUsage.get(`${input.workspaceId}:${dayStart}`) ?? 0) >=
        PRESENTATION_VISUAL_IMPORT_MAX_DAILY_JOBS
    )
      throw new PresentationVisualImportError("LIMIT_REACHED");
    if (this.rows.has(input.id)) throw new PresentationVisualImportError("CONFLICT");
    this.rows.set(input.id, row);
    this.dailyUsage.set(
      `${input.workspaceId}:${dayStart}`,
      (this.dailyUsage.get(`${input.workspaceId}:${dayStart}`) ?? 0) + 1,
    );
    return { status: "created" as const, job: view(row) };
  }
  async get(workspaceId: string, presentationId: string, jobId: string, now = new Date()) {
    const row = this.rows.get(jobId);
    return row &&
      row.workspaceId === workspaceId &&
      row.job.presentationId === presentationId &&
      Date.parse(row.job.expiresAt) > now.getTime() &&
      this.eligible(workspaceId, presentationId)
      ? view(row)
      : null;
  }
  async findByRequest(
    workspaceId: string,
    presentationId: string,
    requestId: string,
    now = new Date(),
  ) {
    if (!this.eligible(workspaceId, presentationId)) return null;
    const row = [...this.rows.values()].find(
      (row) =>
        row.workspaceId === workspaceId &&
        row.job.presentationId === presentationId &&
        row.requestId === requestId &&
        Date.parse(row.job.expiresAt) > now.getTime(),
    );
    return row ? { requestHash: row.requestHash, job: view(row) } : null;
  }
  async list(workspaceId: string, presentationId: string, limit = 20, now = new Date()) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 40)
      throw new PresentationVisualImportError("CONFLICT");
    if (!this.eligible(workspaceId, presentationId)) return [];
    return [...this.rows.values()]
      .filter(
        (row) =>
          row.workspaceId === workspaceId &&
          row.job.presentationId === presentationId &&
          Date.parse(row.job.expiresAt) > now.getTime(),
      )
      .sort((a, b) => b.job.createdAt.localeCompare(a.job.createdAt))
      .slice(0, limit)
      .map(view);
  }
  async claim(now: Date, leaseUntil: Date) {
    if (leaseUntil <= now) throw new PresentationVisualImportError("CONFLICT");
    const candidates = [...this.rows.values()]
      .filter(
        (row) =>
          ["pending", "processing"].includes(row.job.status) &&
          row.availableAt <= now &&
          Date.parse(row.job.expiresAt) > now.getTime() &&
          this.eligible(row.workspaceId, row.job.presentationId),
      )
      .sort((a, b) => a.availableAt.getTime() - b.availableAt.getTime())
      .slice(0, 10);
    for (const row of candidates) {
      if (row.job.attempts >= 3) {
        this.release(row);
        finish(row, "failed", now);
        row.job.error = {
          code: "ATTEMPT_LIMIT",
          message: "Visual conversion could not complete after three attempts",
        };
        continue;
      }
      this.release(row);
      row.job.status = "processing";
      row.job.attempts++;
      row.job.updatedAt = now.toISOString();
      row.leaseToken = randomUUID();
      row.leaseUntil = new Date(Math.min(leaseUntil.getTime(), Date.parse(row.job.expiresAt)));
      row.availableAt = row.leaseUntil;
      return claimView(row);
    }
    return null;
  }
  async reservePageAssets(
    input: Parameters<PresentationVisualImportRepository["reservePageAssets"]>[0],
  ) {
    const row = this.rows.get(input.jobId);
    if (!valid(row, input) || !this.eligible(row!.workspaceId, row!.job.presentationId))
      return false;
    checkedAssets(row!, input.assets);
    for (const asset of input.assets) {
      const existing = this.repository.mediaAssets.get(asset.id);
      if (
        existing &&
        (!row!.reservedIds.includes(asset.id) ||
          existing.workspaceId !== row!.workspaceId ||
          existing.mimeType !== asset.mimeType ||
          existing.sizeBytes !== asset.sizeBytes ||
          existing.scanStatus === "deleting")
      )
        throw new PresentationVisualImportError("CONFLICT");
    }
    for (const asset of input.assets) {
      if (!this.repository.mediaAssets.has(asset.id))
        this.repository.mediaAssets.set(asset.id, {
          ...clone(asset),
          deletionStartedAt: null,
          finalizedAt: null,
        });
      this.repository.mediaReferences.set(
        `${row!.workspaceId}:presentation_visual_import:${row!.job.id}:${asset.id}`,
        {
          workspaceId: row!.workspaceId,
          mediaId: asset.id,
          ownerType: "presentation_visual_import",
          ownerId: row!.job.id,
          createdAt: input.now ?? new Date(),
        },
      );
    }
    row!.reservedIds = [
      ...new Set([...row!.reservedIds, ...input.assets.map((asset) => asset.id)]),
    ];
    return true;
  }
  async complete(input: Parameters<PresentationVisualImportRepository["complete"]>[0]) {
    const row = this.rows.get(input.jobId);
    if (!valid(row, input) || !this.eligible(row!.workspaceId, row!.job.presentationId))
      return false;
    const job = PresentationVisualImportJobSchema.parse({
      ...row!.job,
      status: "ready",
      pages: input.pages,
      pageCount: input.pages.length,
      warnings: input.warnings,
    });
    if (
      new Set(input.pages.map((page) => page.mediaId)).size !== row!.reservedIds.length ||
      input.pages.some(
        (page) =>
          !row!.reservedIds.includes(page.mediaId) ||
          this.repository.mediaAssets.get(page.mediaId)?.scanStatus !== "clean",
      )
    )
      return false;
    row!.job = job;
    finish(row!, "ready", input.now ?? new Date());
    return true;
  }
  async retry(input: Parameters<PresentationVisualImportRepository["retry"]>[0]) {
    const row = this.rows.get(input.jobId);
    if (!valid(row, input)) return false;
    this.release(row!);
    finish(row!, input.failed ? "failed" : "pending", input.now ?? new Date());
    row!.availableAt = input.availableAt;
    row!.job.error = {
      code: input.errorCode.slice(0, 80) || "CONVERSION_FAILED",
      message: input.errorMessage.slice(0, 300) || "Visual conversion failed",
    };
    return true;
  }
  async cancel(workspaceId: string, presentationId: string, jobId: string, now = new Date()) {
    const row = this.rows.get(jobId);
    if (
      !row ||
      row.workspaceId !== workspaceId ||
      row.job.presentationId !== presentationId ||
      !this.eligible(workspaceId, presentationId)
    )
      return null;
    if (row.job.status !== "canceled") {
      this.release(row);
      finish(row, "canceled", now);
      row.job.error = null;
    }
    return view(row);
  }
  async purgeExpired(now: Date) {
    const ids: string[] = [];
    for (const [id, row] of this.rows)
      if (Date.parse(row.job.expiresAt) <= now.getTime()) {
        this.release(row);
        this.rows.delete(id);
        ids.push(id);
      }
    for (const key of this.dailyUsage.keys())
      if (Number(key.slice(key.lastIndexOf(":") + 1)) < now.getTime() - 2 * 86_400_000)
        this.dailyUsage.delete(key);
    return ids;
  }
  exportAccount({ ownedWorkspaceIds }: MemoryRepositoryLifecycleContext) {
    return {
      presentationVisualImports: [...this.rows.values()]
        .filter((row) => ownedWorkspaceIds.has(row.workspaceId))
        .map((row) => view(row)),
    };
  }
  deleteAccount({ ownedWorkspaceIds, userId }: MemoryRepositoryLifecycleContext) {
    for (const key of this.dailyUsage.keys())
      if (ownedWorkspaceIds.has(key.slice(0, key.lastIndexOf(":")))) this.dailyUsage.delete(key);
    for (const [id, row] of this.rows)
      if (ownedWorkspaceIds.has(row.workspaceId)) {
        this.release(row);
        this.rows.delete(id);
      } else if (row.createdBy === userId) row.createdBy = null;
  }
  deleteLibraryArtifactMetadata(workspaceId: string, kind: string, presentationId: string) {
    if (kind !== "presentation") return;
    for (const [id, row] of this.rows)
      if (row.workspaceId === workspaceId && row.job.presentationId === presentationId) {
        this.release(row);
        this.rows.delete(id);
      }
  }
}

function mapped(row: QueryResultRow): JobRecord {
  return {
    workspaceId: row.workspace_id,
    createdBy: row.created_by,
    requestId: row.request_id,
    requestHash: row.request_hash,
    files: row.input_files ?? (row.has_input_files ? [] : null),
    availableAt: new Date(row.available_at),
    leaseToken: row.lease_token,
    leaseUntil: row.lease_until ? new Date(row.lease_until) : null,
    reservedIds: row.reserved_media_ids ?? [],
    job: PresentationVisualImportJobSchema.parse({
      id: row.id,
      presentationId: row.presentation_id,
      status: row.status,
      attempts: Number(row.attempts),
      sourceType: row.source_type,
      sourceName: row.source_name,
      sourceDigest: row.source_digest,
      fileCount: row.file_count,
      pageCount: row.pages.length,
      pages: row.pages,
      warnings: row.warnings,
      error: row.error,
      retainOriginal: false,
      createdAt: new Date(row.created_at).toISOString(),
      updatedAt: new Date(row.updated_at).toISOString(),
      expiresAt: new Date(row.expires_at).toISOString(),
    }),
  };
}
const metadataColumns =
  "id,workspace_id,presentation_id,created_by,request_id,request_hash,source_digest,source_type,source_name,file_count,status,attempts,available_at,lease_token,lease_until,reserved_media_ids,pages,warnings,error,created_at,updated_at,expires_at,(input_files IS NOT NULL) AS has_input_files";
class PostgresVisualImports implements PresentationVisualImportRepository {
  constructor(private readonly repository: PostgresRepository) {}
  private async tx<T>(workspaceId: string | null, work: (client: PoolClient) => Promise<T>) {
    const client = await this.repository.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        workspaceId
          ? "SELECT set_config('app.workspace_id',$1,true)"
          : "SELECT set_config('app.system_access','on',true)",
        workspaceId ? [workspaceId] : [],
      );
      const value = await work(client);
      await client.query("COMMIT");
      return value;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  private async eligible(
    client: PoolClient,
    workspaceId: string,
    presentationId: string,
    exclusive = false,
  ) {
    if (
      !(
        await client.query(
          `SELECT id FROM workspaces WHERE id=$1 AND NOT EXISTS(SELECT 1 FROM workspace_media_deletion_jobs deletion WHERE deletion.workspace_id=workspaces.id) ${exclusive ? "FOR UPDATE" : "FOR SHARE"}`,
          [workspaceId],
        )
      ).rows[0]
    )
      return false;
    return !!(
      await client.query("SELECT id FROM presentations WHERE workspace_id=$1 AND id=$2 FOR SHARE", [
        workspaceId,
        presentationId,
      ])
    ).rows[0];
  }
  private async release(client: PoolClient, row: JobRecord) {
    await client.query(
      "DELETE FROM media_references WHERE workspace_id=$1 AND owner_type='presentation_visual_import' AND owner_id=$2",
      [row.workspaceId, row.job.id],
    );
    row.reservedIds = [];
  }
  private async save(client: PoolClient, row: JobRecord) {
    await client.query(
      `UPDATE presentation_visual_imports SET status=$2,attempts=$3,input_files=CASE WHEN $4::boolean THEN NULL ELSE input_files END,available_at=$5,lease_token=$6,lease_until=$7,reserved_media_ids=$8::uuid[],pages=$9,warnings=$10,error=$11,updated_at=$12 WHERE id=$1`,
      [
        row.job.id,
        row.job.status,
        row.job.attempts,
        row.files === null,
        row.availableAt,
        row.leaseToken,
        row.leaseUntil,
        row.reservedIds,
        JSON.stringify(row.job.pages),
        JSON.stringify(row.job.warnings),
        row.job.error ? JSON.stringify(row.job.error) : null,
        row.job.updatedAt,
      ],
    );
  }
  private async fenced<T>(
    fence: PresentationVisualImportFence,
    work: (client: PoolClient, row: JobRecord) => Promise<T>,
    fallback: T,
  ) {
    return this.tx(null, async (client) => {
      const found = await client.query(
        "SELECT workspace_id,presentation_id FROM presentation_visual_imports WHERE id=$1",
        [fence.jobId],
      );
      if (
        !found.rows[0] ||
        !(await this.eligible(client, found.rows[0].workspace_id, found.rows[0].presentation_id))
      )
        return fallback;
      const locked = await client.query(
        `SELECT ${metadataColumns} FROM presentation_visual_imports WHERE id=$1 FOR UPDATE`,
        [fence.jobId],
      );
      const row = locked.rows[0] ? mapped(locked.rows[0]) : null;
      if (!valid(row, fence)) return fallback;
      return work(client, row!);
    });
  }
  async create(input: PresentationVisualImportCreateInput) {
    const row = checkedInput(input),
      now = input.now ?? new Date();
    return this.tx(input.workspaceId, async (client) => {
      if (!(await this.eligible(client, input.workspaceId, input.presentationId, true)))
        throw new PresentationVisualImportError("NOT_FOUND");
      const prior = await client.query(
        `SELECT ${metadataColumns} FROM presentation_visual_imports WHERE workspace_id=$1 AND presentation_id=$2 AND request_id=$3`,
        [input.workspaceId, input.presentationId, input.requestId],
      );
      if (prior.rows[0]) return checkReplay(mapped(prior.rows[0]), input);
      const counts = await client.query(
        "SELECT count(*) FILTER(WHERE status IN('pending','processing') AND expires_at>$2)::integer AS active,COALESCE((SELECT used FROM presentation_visual_import_usage WHERE workspace_id=$1 AND day=($3::timestamptz AT TIME ZONE 'UTC')::date),0)::integer AS daily FROM presentation_visual_imports WHERE workspace_id=$1",
        [
          input.workspaceId,
          now,
          new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())),
        ],
      );
      if (counts.rows[0].active >= 3 || counts.rows[0].daily >= 10)
        throw new PresentationVisualImportError("LIMIT_REACHED");
      await client.query(
        `INSERT INTO presentation_visual_imports(id,workspace_id,presentation_id,created_by,request_id,request_hash,source_digest,source_type,source_name,file_count,input_files,status,attempts,available_at,pages,warnings,error,created_at,updated_at,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'pending',0,$12,'[]','[]',NULL,$12,$12,$13)`,
        [
          row.job.id,
          row.workspaceId,
          row.job.presentationId,
          row.createdBy,
          row.requestId,
          row.requestHash,
          row.job.sourceDigest,
          row.job.sourceType,
          row.job.sourceName,
          row.job.fileCount,
          JSON.stringify(row.files),
          now,
          row.job.expiresAt,
        ],
      );
      return { status: "created" as const, job: view(row) };
    });
  }
  async get(workspaceId: string, presentationId: string, jobId: string, now = new Date()) {
    return this.tx(workspaceId, async (client) => {
      if (!(await this.eligible(client, workspaceId, presentationId))) return null;
      const row = await client.query(
        `SELECT ${metadataColumns} FROM presentation_visual_imports WHERE workspace_id=$1 AND presentation_id=$2 AND id=$3 AND expires_at>$4`,
        [workspaceId, presentationId, jobId, now],
      );
      return row.rows[0] ? view(mapped(row.rows[0])) : null;
    });
  }
  async findByRequest(
    workspaceId: string,
    presentationId: string,
    requestId: string,
    now = new Date(),
  ) {
    return this.tx(workspaceId, async (client) => {
      if (!(await this.eligible(client, workspaceId, presentationId))) return null;
      const found = await client.query(
        `SELECT ${metadataColumns} FROM presentation_visual_imports WHERE workspace_id=$1 AND presentation_id=$2 AND request_id=$3 AND expires_at>$4`,
        [workspaceId, presentationId, requestId, now],
      );
      if (!found.rows[0]) return null;
      const row = mapped(found.rows[0]);
      return { requestHash: row.requestHash, job: view(row) };
    });
  }
  async list(workspaceId: string, presentationId: string, limit = 20, now = new Date()) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 40)
      throw new PresentationVisualImportError("CONFLICT");
    return this.tx(workspaceId, async (client) => {
      if (!(await this.eligible(client, workspaceId, presentationId))) return [];
      const rows = await client.query(
        `SELECT ${metadataColumns} FROM presentation_visual_imports WHERE workspace_id=$1 AND presentation_id=$2 AND expires_at>$3 ORDER BY created_at DESC,id LIMIT $4`,
        [workspaceId, presentationId, now, limit],
      );
      return rows.rows.map((row) => view(mapped(row)));
    });
  }
  async claim(now: Date, leaseUntil: Date) {
    if (leaseUntil <= now) throw new PresentationVisualImportError("CONFLICT");
    return this.tx(null, async (client) => {
      const candidates = await client.query(
        "SELECT id,workspace_id,presentation_id FROM presentation_visual_imports WHERE status IN('pending','processing') AND available_at<=$1 AND expires_at>$1 ORDER BY available_at,created_at LIMIT 10",
        [now],
      );
      for (const candidate of candidates.rows) {
        if (!(await this.eligible(client, candidate.workspace_id, candidate.presentation_id)))
          continue;
        const locked = await client.query(
          "SELECT * FROM presentation_visual_imports WHERE id=$1 AND status IN('pending','processing') AND available_at<=$2 AND expires_at>$2 FOR UPDATE SKIP LOCKED",
          [candidate.id, now],
        );
        if (!locked.rows[0]) continue;
        const row = mapped(locked.rows[0]);
        await this.release(client, row);
        if (row.job.attempts >= 3) {
          finish(row, "failed", now);
          row.job.error = {
            code: "ATTEMPT_LIMIT",
            message: "Visual conversion could not complete after three attempts",
          };
          await this.save(client, row);
          continue;
        }
        row.job.status = "processing";
        row.job.attempts++;
        row.job.updatedAt = now.toISOString();
        row.leaseToken = randomUUID();
        row.leaseUntil = new Date(Math.min(leaseUntil.getTime(), Date.parse(row.job.expiresAt)));
        row.availableAt = row.leaseUntil;
        await this.save(client, row);
        return claimView(row);
      }
      return null;
    });
  }
  async reservePageAssets(
    input: Parameters<PresentationVisualImportRepository["reservePageAssets"]>[0],
  ) {
    return this.fenced(
      input,
      async (client, row) => {
        checkedAssets(row, input.assets);
        const ids = input.assets.map((asset) => asset.id);
        const existing = await client.query(
          "SELECT * FROM media_assets WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE",
          [ids],
        );
        for (const record of existing.rows)
          if (
            !row.reservedIds.includes(record.id) ||
            record.workspace_id !== row.workspaceId ||
            record.scan_status === "deleting" ||
            !input.assets.some(
              (asset) =>
                asset.id === record.id &&
                asset.mimeType === record.mime_type &&
                asset.sizeBytes === Number(record.size_bytes),
            )
          )
            throw new PresentationVisualImportError("CONFLICT");
        const existingIds = new Set(existing.rows.map((record) => record.id));
        for (const asset of input.assets) {
          if (!existingIds.has(asset.id))
            await client.query(
              "INSERT INTO media_assets(id,workspace_id,object_key,mime_type,size_bytes,scan_status,alt_text,created_at) VALUES($1,$2,$3,$4,$5,'pending',$6,$7)",
              [
                asset.id,
                row.workspaceId,
                asset.objectKey,
                asset.mimeType,
                asset.sizeBytes,
                asset.altText,
                asset.createdAt,
              ],
            );
          await client.query(
            "INSERT INTO media_references(workspace_id,media_id,owner_type,owner_id) VALUES($1,$2,'presentation_visual_import',$3) ON CONFLICT DO NOTHING",
            [row.workspaceId, asset.id, row.job.id],
          );
        }
        row.reservedIds = [...new Set([...row.reservedIds, ...ids])];
        await this.save(client, row);
        return true;
      },
      false,
    );
  }
  async complete(input: Parameters<PresentationVisualImportRepository["complete"]>[0]) {
    return this.fenced(
      input,
      async (client, row) => {
        const job = PresentationVisualImportJobSchema.parse({
          ...row.job,
          status: "ready",
          pages: input.pages,
          pageCount: input.pages.length,
          warnings: input.warnings,
        });
        if (
          new Set(input.pages.map((page) => page.mediaId)).size !== row.reservedIds.length ||
          input.pages.some((page) => !row.reservedIds.includes(page.mediaId))
        )
          return false;
        const clean = await client.query(
          "SELECT id FROM media_assets WHERE workspace_id=$1 AND id=ANY($2::uuid[]) AND scan_status='clean' ORDER BY id FOR SHARE",
          [row.workspaceId, row.reservedIds],
        );
        if (clean.rows.length !== row.reservedIds.length) return false;
        row.job = job;
        finish(row, "ready", input.now ?? new Date());
        await this.save(client, row);
        return true;
      },
      false,
    );
  }
  async retry(input: Parameters<PresentationVisualImportRepository["retry"]>[0]) {
    return this.fenced(
      input,
      async (client, row) => {
        await this.release(client, row);
        finish(row, input.failed ? "failed" : "pending", input.now ?? new Date());
        row.availableAt = input.availableAt;
        row.job.error = {
          code: input.errorCode.slice(0, 80) || "CONVERSION_FAILED",
          message: input.errorMessage.slice(0, 300) || "Visual conversion failed",
        };
        await this.save(client, row);
        return true;
      },
      false,
    );
  }
  async cancel(workspaceId: string, presentationId: string, jobId: string, now = new Date()) {
    return this.tx(workspaceId, async (client) => {
      if (!(await this.eligible(client, workspaceId, presentationId))) return null;
      const locked = await client.query(
        `SELECT ${metadataColumns} FROM presentation_visual_imports WHERE workspace_id=$1 AND presentation_id=$2 AND id=$3 FOR UPDATE`,
        [workspaceId, presentationId, jobId],
      );
      if (!locked.rows[0]) return null;
      const row = mapped(locked.rows[0]);
      if (row.job.status !== "canceled") {
        await this.release(client, row);
        finish(row, "canceled", now);
        row.job.error = null;
        await this.save(client, row);
      }
      return view(row);
    });
  }
  async purgeExpired(now: Date) {
    return this.tx(null, async (client) => {
      await client.query(
        "DELETE FROM presentation_visual_import_usage WHERE day<($1::timestamptz AT TIME ZONE 'UTC')::date-2",
        [now],
      );
      return (
        await client.query(
          "DELETE FROM presentation_visual_imports WHERE expires_at<=$1 RETURNING id",
          [now],
        )
      ).rows.map((row) => String(row.id));
    });
  }
}
export function createPresentationVisualImportRepository(
  repository: Repository,
): PresentationVisualImportRepository {
  if (repository instanceof PostgresRepository) return new PostgresVisualImports(repository);
  if (repository instanceof MemoryRepository)
    return repository.getOrCreateLifecycleExtension(
      "presentation-visual-imports",
      () => new MemoryVisualImports(repository),
    );
  throw new PresentationVisualImportError(
    "NOT_FOUND",
    "Visual imports require a supported repository",
  );
}
export function assertMemoryPresentationVisualImportReady(
  repository: MemoryRepository,
  workspaceId: string,
  presentationId: string,
  jobId: string,
): void {
  repository
    .getOrCreateLifecycleExtension(
      "presentation-visual-imports",
      () => new MemoryVisualImports(repository),
    )
    .assertReady(workspaceId, presentationId, jobId);
}
