import { randomUUID } from "node:crypto";
import type { PoolClient, QueryResultRow } from "pg";
import {
  CreatePresentationAssistanceJobSchema,
  PresentationAssistanceJobSchema,
  PresentationAssistanceProposalSchema,
  PRESENTATION_ASSISTANCE_MAX_ACTIVE_JOBS,
  PRESENTATION_ASSISTANCE_MAX_ATTEMPTS,
  PRESENTATION_ASSISTANCE_RETENTION_MS,
  PRESENTATION_ASSISTANCE_ERROR_MESSAGES,
  presentationAssistanceRequestHash,
  presentationAssistanceSourceDigest,
  presentationAssistanceProposalHash,
  type PresentationAssistanceJob,
  type PresentationAssistanceErrorCode,
} from "@openround/contracts";
import {
  MemoryRepository,
  type MemoryRepositoryLifecycleContext,
  type MemoryRepositoryLifecycleExtension,
} from "./memory.js";
import { PostgresRepository } from "./postgres.js";
import { lockPresentationAssistanceActors } from "./presentation-assistance-identity.js";
import {
  createPresentationRepository,
  type MemoryPresentationRepository,
} from "./presentations.js";
import type { Repository } from "./types.js";
import {
  PresentationAssistanceError,
  type PresentationAssistanceContext,
  type PresentationAssistanceCreateInput,
  type PresentationAssistanceClaim,
  type PresentationAssistanceFence,
  type PresentationAssistanceRepository,
} from "./presentation-assistance-types.js";

type Row = {
  workspaceId: string;
  createdBy: string | null;
  requestHash: string;
  outline: string | null;
  availableAt: Date;
  leaseToken: string | null;
  leaseUntil: Date | null;
  job: PresentationAssistanceJob;
};
const clone = <T>(value: T): T => structuredClone(value);
const contextIds = <T extends PresentationAssistanceContext>(input: T): T => ({
  ...input,
  workspaceId: input.workspaceId.toLowerCase(),
  presentationId: input.presentationId.toLowerCase(),
  actorId: input.actorId.toLowerCase(),
});
const fenceIds = <T extends PresentationAssistanceFence>(input: T): T => ({
  ...input,
  jobId: input.jobId.toLowerCase(),
  leaseToken: input.leaseToken.toLowerCase(),
});

const stamp = (value: unknown) =>
  (value instanceof Date ? value : new Date(String(value))).toISOString();
const active = (row: Row, now: Date) =>
  ["pending", "processing"].includes(row.job.status) &&
  Date.parse(row.job.expiresAt) > now.getTime();
function checked(input: PresentationAssistanceCreateInput): Row {
  const request = CreatePresentationAssistanceJobSchema.parse(input.request),
    now = input.now ?? new Date();
  if (
    request.presentationId !== input.presentationId ||
    !Number.isFinite(now.getTime()) ||
    !Number.isFinite(input.since.getTime()) ||
    input.since > now ||
    (input.monthlyLimit !== null &&
      (!Number.isSafeInteger(input.monthlyLimit) || input.monthlyLimit < 0))
  )
    throw new PresentationAssistanceError("CONFLICT");
  const expiresAt = new Date(
    Math.min(
      input.expiresAt?.getTime() ?? Infinity,
      now.getTime() + PRESENTATION_ASSISTANCE_RETENTION_MS,
    ),
  );
  if (!Number.isFinite(expiresAt.getTime()) || expiresAt <= now)
    throw new PresentationAssistanceError("CONFLICT");
  return {
    workspaceId: input.workspaceId,
    createdBy: input.actorId,
    requestHash: presentationAssistanceRequestHash(request),
    outline: request.outline,
    availableAt: now,
    leaseToken: null,
    leaseUntil: null,
    job: PresentationAssistanceJobSchema.parse({
      schemaVersion: 1,
      id: request.requestId,
      requestId: request.requestId,
      presentationId: request.presentationId,
      sourceName: request.sourceName,
      slideCount: request.slideCount,
      status: "pending",
      attempts: 0,
      proposal: null,
      proposalHash: null,
      sourceDigest: presentationAssistanceSourceDigest(request.outline),
      error: null,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
    }),
  };
}
function error(row: Row, code: PresentationAssistanceErrorCode, now: Date, scrub = false) {
  row.job.status = code === "EXPIRED" ? "expired" : "failed";
  row.job.error = { code, message: PRESENTATION_ASSISTANCE_ERROR_MESSAGES[code] };
  row.job.proposal = null;
  row.job.proposalHash = null;
  row.job.updatedAt = now.toISOString();
  row.outline = null;
  row.leaseToken = null;
  row.leaseUntil = null;
  if (scrub) {
    row.job.sourceName = "Erased outline";
    row.createdBy = null;
  }
}
function expire(row: Row, now: Date) {
  if (Date.parse(row.job.expiresAt) <= now.getTime() && row.job.status !== "expired") {
    error(row, "EXPIRED", now, true);
    return true;
  }
  return false;
}
function replay(prior: Row, next: Row, now: Date) {
  if (
    prior.requestHash !== next.requestHash ||
    prior.job.presentationId !== next.job.presentationId
  )
    throw new PresentationAssistanceError(
      "CONFLICT",
      "This request identity was already used for another outline intent",
    );
  expire(prior, now);
  return { status: "duplicate" as const, job: clone(prior.job) };
}
function fence(row: Row | undefined | null, input: PresentationAssistanceFence): row is Row {
  const now = input.now ?? new Date();
  return (
    !!row &&
    row.job.status === "processing" &&
    row.job.attempts === input.attempt &&
    row.leaseToken === input.leaseToken &&
    !!row.leaseUntil &&
    row.leaseUntil > now &&
    Date.parse(row.job.expiresAt) > now.getTime()
  );
}
function claimRow(row: Row, now: Date, leaseUntil: Date): PresentationAssistanceClaim {
  row.job.status = "processing";
  row.job.attempts += 1;
  row.job.updatedAt = now.toISOString();
  row.job.error = null;
  row.leaseToken = randomUUID();
  row.leaseUntil = new Date(Math.min(leaseUntil.getTime(), Date.parse(row.job.expiresAt)));
  return {
    ...clone(row.job),
    workspaceId: row.workspaceId,
    createdBy: row.createdBy!,
    outline: row.outline!,
    requestHash: row.requestHash,
    attempt: row.job.attempts,
    leaseToken: row.leaseToken,
    leaseUntil: new Date(row.leaseUntil),
  };
}
function completeRow(row: Row, input: Parameters<PresentationAssistanceRepository["complete"]>[0]) {
  const proposal = PresentationAssistanceProposalSchema.parse(input.proposal);
  if (
    proposal.sourceName !== row.job.sourceName ||
    proposal.sourceDigest !== row.job.sourceDigest ||
    proposal.slides.length !== row.job.slideCount ||
    !row.outline ||
    proposal.slides.some((slide) =>
      slide.citations.some((citation) => {
        const locator = /^outline line ([1-9]\d*)$/.exec(citation.locator);
        const line = locator ? row.outline!.split("\n")[Number(locator[1]) - 1]?.trim() : undefined;
        return !line || !line.includes(citation.excerpt);
      }),
    )
  )
    throw new PresentationAssistanceError(
      "CONFLICT",
      "The proposal must cite exact source text and match the requested slide count",
    );
  row.job.status = "ready";
  row.job.proposal = proposal;
  row.job.proposalHash = presentationAssistanceProposalHash(proposal);
  row.job.error = null;
  row.job.updatedAt = (input.now ?? new Date()).toISOString();
  row.outline = null;
  row.leaseToken = null;
  row.leaseUntil = null;
}
function failRow(row: Row, input: Parameters<PresentationAssistanceRepository["fail"]>[0]) {
  const now = input.now ?? new Date();
  if (input.terminal || row.job.attempts >= PRESENTATION_ASSISTANCE_MAX_ATTEMPTS) {
    error(
      row,
      row.job.attempts >= PRESENTATION_ASSISTANCE_MAX_ATTEMPTS
        ? "ATTEMPTS_EXHAUSTED"
        : input.errorCode,
      now,
    );
    return;
  }
  const availableAt = input.availableAt ?? now;
  if (!Number.isFinite(availableAt.getTime()) || availableAt < now)
    throw new PresentationAssistanceError("CONFLICT");
  row.job.status = "pending";
  row.job.error = {
    code: input.errorCode,
    message: PRESENTATION_ASSISTANCE_ERROR_MESSAGES[input.errorCode],
  };
  row.job.updatedAt = now.toISOString();
  row.availableAt = availableAt;
  row.leaseToken = null;
  row.leaseUntil = null;
}
function validLease(now: Date, leaseUntil: Date) {
  if (
    !Number.isFinite(now.getTime()) ||
    !Number.isFinite(leaseUntil.getTime()) ||
    leaseUntil <= now
  )
    throw new PresentationAssistanceError("CONFLICT");
}
export class MemoryPresentationAssistanceRepository
  implements PresentationAssistanceRepository, MemoryRepositoryLifecycleExtension
{
  private readonly rows = new Map<string, Row>();
  private readonly erasedActors = new Set<string>();
  private readonly erasedWorkspaces = new Set<string>();
  private readonly presentations: MemoryPresentationRepository;
  constructor(private parent: MemoryRepository) {
    this.presentations = createPresentationRepository(parent) as MemoryPresentationRepository;
  }
  assertReady(workspaceId: string, presentationId: string, jobId: string, proposalHash: string) {
    const row = this.rows.get(jobId.toLowerCase());
    workspaceId = workspaceId.toLowerCase();
    presentationId = presentationId.toLowerCase();
    if (
      !row ||
      row.workspaceId !== workspaceId ||
      row.job.presentationId !== presentationId ||
      row.job.status !== "ready" ||
      row.job.proposalHash !== proposalHash ||
      Date.parse(row.job.expiresAt) <= Date.now() ||
      !this.creatorEligible(row)
    )
      throw new PresentationAssistanceError(
        "CONFLICT",
        "The reviewed proposal is no longer ready to insert",
      );
  }
  private eligible(input: PresentationAssistanceContext) {
    const actor = this.parent.users.get(input.actorId),
      member = this.parent.workspaceMembers.get(`${input.workspaceId}:${input.actorId}`),
      presentation = this.presentations.presentations.get(input.presentationId);
    return (
      !!actor &&
      !actor.deletedAt &&
      !this.erasedActors.has(input.actorId) &&
      !this.erasedWorkspaces.has(input.workspaceId) &&
      !!member &&
      ["owner", "editor"].includes(member.role) &&
      this.parent.workspaces.has(input.workspaceId) &&
      !this.parent.workspaceMediaDeletionClaims.has(input.workspaceId) &&
      !!presentation &&
      presentation.workspaceId === input.workspaceId &&
      presentation.status !== "archived"
    );
  }
  private creatorEligible(row: Row) {
    return (
      !!row.createdBy &&
      this.eligible({
        workspaceId: row.workspaceId,
        presentationId: row.job.presentationId,
        actorId: row.createdBy,
      })
    );
  }
  async create(input: PresentationAssistanceCreateInput) {
    input = contextIds(input);
    const row = checked(input),
      now = input.now ?? new Date();
    if (!this.eligible(input)) throw new PresentationAssistanceError("NOT_FOUND");
    const prior = this.rows.get(row.job.id);
    if (prior) {
      if (prior.workspaceId !== input.workspaceId)
        throw new PresentationAssistanceError("CONFLICT");
      return replay(prior, row, now);
    }
    if (this.parent.authoringAdmissions.has(`${input.workspaceId}:presentation:${row.job.id}`))
      throw new PresentationAssistanceError(
        "CONFLICT",
        "This erased request identity cannot be reused",
      );
    const used = this.parent.authoringUsageSince(input.workspaceId, input.since);
    if (input.monthlyLimit !== null && used >= input.monthlyLimit)
      throw new PresentationAssistanceError("LIMIT_REACHED");
    if (
      [...this.rows.values()].filter(
        (item) => item.workspaceId === input.workspaceId && active(item, now),
      ).length >= PRESENTATION_ASSISTANCE_MAX_ACTIVE_JOBS
    )
      throw new PresentationAssistanceError("ACTIVE_LIMIT_REACHED");
    // No await between allowance check and both mutations: legacy and new memory admissions are atomic.
    this.rows.set(row.job.id, row);
    this.parent.recordAuthoringAdmission("presentation", input.workspaceId, row.job.id, now);
    return { status: "created" as const, job: clone(row.job) };
  }
  async get(input: PresentationAssistanceContext & { jobId: string }) {
    input = contextIds(input);
    if (!this.eligible(input)) return null;
    const row = this.rows.get(input.jobId.toLowerCase());
    if (
      !row ||
      row.workspaceId !== input.workspaceId ||
      row.job.presentationId !== input.presentationId
    )
      return null;
    expire(row, input.now ?? new Date());
    if (row.job.status !== "expired" && !this.creatorEligible(row))
      error(row, "SOURCE_UNAVAILABLE", input.now ?? new Date(), true);
    return clone(row.job);
  }
  async list(input: PresentationAssistanceContext & { limit?: number }) {
    input = contextIds(input);
    if (!this.eligible(input)) return [];
    const now = input.now ?? new Date();
    return [...this.rows.values()]
      .filter(
        (row) =>
          row.workspaceId === input.workspaceId && row.job.presentationId === input.presentationId,
      )
      .sort((a, b) => b.job.createdAt.localeCompare(a.job.createdAt))
      .slice(0, Math.max(1, Math.min(input.limit ?? 20, 100)))
      .map((row) => {
        expire(row, now);
        if (row.job.status !== "expired" && !this.creatorEligible(row))
          error(row, "SOURCE_UNAVAILABLE", now, true);
        return clone(row.job);
      });
  }
  async usage(input: PresentationAssistanceContext & { since: Date }) {
    input = contextIds(input);
    if (!this.eligible(input)) throw new PresentationAssistanceError("NOT_FOUND");
    return {
      used: this.parent.authoringUsageSince(input.workspaceId, input.since),
      active: [...this.rows.values()].filter(
        (row) => row.workspaceId === input.workspaceId && active(row, input.now ?? new Date()),
      ).length,
    };
  }
  async claim(now: Date, leaseUntil: Date) {
    validLease(now, leaseUntil);
    for (const row of [...this.rows.values()].sort((a, b) =>
      a.job.createdAt.localeCompare(b.job.createdAt),
    )) {
      if (expire(row, now) || !active(row, now)) continue;
      if (!this.creatorEligible(row)) {
        error(row, "SOURCE_UNAVAILABLE", now, true);
        continue;
      }
      if (
        (row.job.status === "pending" && row.availableAt > now) ||
        (row.job.status === "processing" && row.leaseUntil! > now)
      )
        continue;
      if (row.job.attempts >= PRESENTATION_ASSISTANCE_MAX_ATTEMPTS) {
        error(row, "ATTEMPTS_EXHAUSTED", now);
        continue;
      }
      return claimRow(row, now, leaseUntil);
    }
    return null;
  }
  async complete(input: Parameters<PresentationAssistanceRepository["complete"]>[0]) {
    input = fenceIds(input);
    const row = this.rows.get(input.jobId.toLowerCase());
    if (!fence(row, input)) return false;
    if (!this.creatorEligible(row)) {
      error(row, "SOURCE_UNAVAILABLE", input.now ?? new Date(), true);
      return false;
    }
    completeRow(row, input);
    return true;
  }
  async fail(input: Parameters<PresentationAssistanceRepository["fail"]>[0]) {
    input = fenceIds(input);
    const row = this.rows.get(input.jobId.toLowerCase());
    if (!fence(row, input)) return false;
    if (!this.creatorEligible(row)) {
      error(row, "SOURCE_UNAVAILABLE", input.now ?? new Date(), true);
      return false;
    }
    failRow(row, input);
    return true;
  }
  async purgeExpired(now: Date) {
    const ids: string[] = [];
    for (const row of this.rows.values()) if (expire(row, now)) ids.push(row.job.id);
    return ids;
  }
  exportAccount({ userId, ownedWorkspaceIds }: MemoryRepositoryLifecycleContext) {
    return {
      presentationAssistanceJobs: [...this.rows.values()]
        .filter((row) => ownedWorkspaceIds.has(row.workspaceId) || row.createdBy === userId)
        .map((row) => clone(row.job)),
    };
  }
  deleteAccount({ userId, ownedWorkspaceIds }: MemoryRepositoryLifecycleContext) {
    this.erasedActors.add(userId);
    for (const workspaceId of ownedWorkspaceIds) this.erasedWorkspaces.add(workspaceId);
    for (const [id, row] of this.rows)
      if (ownedWorkspaceIds.has(row.workspaceId)) this.rows.delete(id);
      else if (row.createdBy === userId) error(row, "SOURCE_UNAVAILABLE", new Date(), true);
  }
  deleteLibraryArtifactMetadata(workspaceId: string, kind: string, presentationId: string) {
    if (kind === "presentation")
      for (const [id, row] of this.rows)
        if (row.workspaceId === workspaceId && row.job.presentationId === presentationId)
          this.rows.delete(id);
  }
}
function mapped(row: QueryResultRow): Row {
  return {
    workspaceId: row.workspace_id,
    createdBy: row.created_by,
    requestHash: row.request_hash,
    outline: row.outline,
    availableAt: new Date(row.available_at),
    leaseToken: row.lease_token,
    leaseUntil: row.lease_until ? new Date(row.lease_until) : null,
    job: PresentationAssistanceJobSchema.parse({
      schemaVersion: 1,
      id: row.id,
      requestId: row.id,
      presentationId: row.presentation_id,
      sourceName: row.source_name,
      slideCount: row.slide_count,
      status: row.status,
      attempts: row.attempts,
      proposal: row.proposal,
      proposalHash: row.proposal_hash,
      sourceDigest: row.source_digest,
      error: row.error_code
        ? {
            code: row.error_code,
            message:
              PRESENTATION_ASSISTANCE_ERROR_MESSAGES[
                row.error_code as PresentationAssistanceErrorCode
              ],
          }
        : null,
      createdAt: stamp(row.created_at),
      updatedAt: stamp(row.updated_at),
      expiresAt: stamp(row.expires_at),
    }),
  };
}
export class PostgresPresentationAssistanceRepository implements PresentationAssistanceRepository {
  constructor(private parent: PostgresRepository) {}
  private async tx<T>(workspaceId: string | null, work: (client: PoolClient) => Promise<T>) {
    const client = await this.parent.pool.connect();
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
    input: PresentationAssistanceContext,
    exclusive = false,
    creatorIds: string[] = [],
  ): Promise<Set<string> | null> {
    // Match account deletion's actor -> workspace/member -> source -> job lock order.
    // Read paths lock every pre-read creator with the requester before touching workspace rows.
    const actors = [...new Set([input.actorId, ...creatorIds])].sort(),
      activeActors = new Set(
        (await lockPresentationAssistanceActors(client, actors)).rows.map((row) => row.id),
      );
    if (!activeActors.has(input.actorId)) return null;
    if (
      !(
        await client.query(
          `SELECT id FROM workspaces WHERE id=$1 AND NOT EXISTS(SELECT 1 FROM workspace_media_deletion_jobs deletion WHERE deletion.workspace_id=workspaces.id) ${exclusive ? "FOR UPDATE" : "FOR SHARE"}`,
          [input.workspaceId],
        )
      ).rowCount
    )
      return null;
    const members = await client.query<{ user_id: string }>(
      "SELECT user_id FROM workspace_members WHERE workspace_id=$1 AND user_id=ANY($2::uuid[]) AND role IN('owner','editor') ORDER BY user_id FOR SHARE",
      [input.workspaceId, actors],
    );
    const permitted = new Set(
      members.rows.filter((row) => activeActors.has(row.user_id)).map((row) => row.user_id),
    );
    if (!permitted.has(input.actorId)) return null;
    if (
      !(
        await client.query(
          "SELECT id FROM presentations WHERE workspace_id=$1 AND id=$2 AND status<>'archived' FOR SHARE",
          [input.workspaceId, input.presentationId],
        )
      ).rowCount
    )
      return null;
    return permitted;
  }
  private async save(client: PoolClient, row: Row) {
    await client.query(
      `UPDATE presentation_assistance_jobs SET created_by=$2,source_name=$3,outline=$4,status=$5,attempts=$6,available_at=$7,lease_token=$8,lease_until=$9,proposal=$10,proposal_hash=$11,error_code=$12,updated_at=$13 WHERE id=$1`,
      [
        row.job.id,
        row.createdBy,
        row.job.sourceName,
        row.outline,
        row.job.status,
        row.job.attempts,
        row.availableAt,
        row.leaseToken,
        row.leaseUntil,
        row.job.proposal ? JSON.stringify(row.job.proposal) : null,
        row.job.proposalHash,
        row.job.error?.code ?? null,
        row.job.updatedAt,
      ],
    );
  }
  async create(input: PresentationAssistanceCreateInput) {
    input = contextIds(input);
    const row = checked(input),
      now = input.now ?? new Date();
    return this.tx(input.workspaceId, async (client) => {
      if (!(await this.eligible(client, input, true)))
        throw new PresentationAssistanceError("NOT_FOUND");
      const prior = (
        await client.query(
          "SELECT * FROM presentation_assistance_jobs WHERE workspace_id=$1 AND id=$2 FOR UPDATE",
          [input.workspaceId, row.job.id],
        )
      ).rows[0];
      if (prior) {
        const stored = mapped(prior),
          result = replay(stored, row, now);
        await this.save(client, stored);
        return result;
      }
      if (
        (
          await client.query(
            "SELECT job_id FROM authoring_admission_receipts WHERE workspace_id=$1 AND kind='presentation' AND job_id=$2",
            [input.workspaceId, row.job.id],
          )
        ).rowCount
      )
        throw new PresentationAssistanceError(
          "CONFLICT",
          "This erased request identity cannot be reused",
        );
      const usage = Number(
        (
          await client.query(
            "SELECT count(*)::integer AS count FROM authoring_admission_receipts WHERE workspace_id=$1 AND created_at >= $2",
            [input.workspaceId, input.since],
          )
        ).rows[0].count,
      );
      if (input.monthlyLimit !== null && usage >= input.monthlyLimit)
        throw new PresentationAssistanceError("LIMIT_REACHED");
      const count = Number(
        (
          await client.query(
            "SELECT count(*)::integer AS count FROM presentation_assistance_jobs WHERE workspace_id=$1 AND status IN('pending','processing') AND expires_at>$2",
            [input.workspaceId, now],
          )
        ).rows[0].count,
      );
      if (count >= PRESENTATION_ASSISTANCE_MAX_ACTIVE_JOBS)
        throw new PresentationAssistanceError("ACTIVE_LIMIT_REACHED");
      const result = await client.query(
        `INSERT INTO presentation_assistance_jobs(id,workspace_id,presentation_id,created_by,request_hash,source_digest,source_name,slide_count,outline,status,attempts,available_at,created_at,updated_at,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'pending',0,$10,$10,$10,$11) RETURNING *`,
        [
          row.job.id,
          row.workspaceId,
          row.job.presentationId,
          row.createdBy,
          row.requestHash,
          row.job.sourceDigest,
          row.job.sourceName,
          row.job.slideCount,
          row.outline,
          now,
          row.job.expiresAt,
        ],
      );
      return { status: "created" as const, job: mapped(result.rows[0]!).job };
    });
  }
  private async scrubRead(
    client: PoolClient,
    found: QueryResultRow,
    permitted: ReadonlySet<string>,
    now: Date,
  ) {
    const row = mapped(found);
    let changed = expire(row, now);
    // Recheck the locked job's current creator; erasure may have nulled it after metadata lookup.
    if (row.job.status !== "expired" && (!row.createdBy || !permitted.has(row.createdBy))) {
      error(row, "SOURCE_UNAVAILABLE", now, true);
      changed = true;
    }
    if (changed) await this.save(client, row);
    return row.job;
  }
  async get(input: PresentationAssistanceContext & { jobId: string }) {
    input = contextIds(input);
    return this.tx(input.workspaceId, async (client) => {
      // No private source/proposal bodies are read until relevant identities and authority are locked.
      const metadata = (
        await client.query<{ created_by: string | null }>(
          "SELECT created_by FROM presentation_assistance_jobs WHERE workspace_id=$1 AND presentation_id=$2 AND id=$3",
          [input.workspaceId, input.presentationId, input.jobId],
        )
      ).rows[0];
      const permitted = await this.eligible(
        client,
        input,
        false,
        metadata?.created_by ? [metadata.created_by] : [],
      );
      if (!permitted) return null;
      const found = (
        await client.query(
          "SELECT * FROM presentation_assistance_jobs WHERE workspace_id=$1 AND presentation_id=$2 AND id=$3 FOR UPDATE",
          [input.workspaceId, input.presentationId, input.jobId],
        )
      ).rows[0];
      return found ? this.scrubRead(client, found, permitted, input.now ?? new Date()) : null;
    });
  }
  async list(input: PresentationAssistanceContext & { limit?: number }) {
    input = contextIds(input);
    return this.tx(input.workspaceId, async (client) => {
      const metadata = await client.query<{ id: string; created_by: string | null }>(
        "SELECT id,created_by FROM presentation_assistance_jobs WHERE workspace_id=$1 AND presentation_id=$2 ORDER BY created_at DESC,id LIMIT $3",
        [input.workspaceId, input.presentationId, Math.max(1, Math.min(input.limit ?? 20, 100))],
      );
      const permitted = await this.eligible(
        client,
        input,
        false,
        metadata.rows.flatMap((row) => (row.created_by ? [row.created_by] : [])),
      );
      if (!permitted) return [];
      // Keep the selected IDs fixed: a newly admitted creator has not participated in our locks.
      const result = await client.query(
        "SELECT * FROM presentation_assistance_jobs WHERE workspace_id=$1 AND presentation_id=$2 AND id=ANY($3::uuid[]) ORDER BY created_at DESC,id FOR UPDATE",
        [input.workspaceId, input.presentationId, metadata.rows.map((row) => row.id)],
      );
      const jobs: PresentationAssistanceJob[] = [],
        now = input.now ?? new Date();
      for (const found of result.rows)
        jobs.push(await this.scrubRead(client, found, permitted, now));
      return jobs;
    });
  }
  async usage(input: PresentationAssistanceContext & { since: Date }) {
    input = contextIds(input);
    return this.tx(input.workspaceId, async (client) => {
      if (!(await this.eligible(client, input))) throw new PresentationAssistanceError("NOT_FOUND");
      const result = await client.query(
        "SELECT (SELECT count(*)::integer FROM authoring_admission_receipts WHERE workspace_id=$1 AND created_at >= $2) AS used,(SELECT count(*)::integer FROM presentation_assistance_jobs WHERE workspace_id=$1 AND status IN('pending','processing') AND expires_at>$3) AS active",
        [input.workspaceId, input.since, input.now ?? new Date()],
      );
      return { used: Number(result.rows[0].used), active: Number(result.rows[0].active) };
    });
  }
  async claim(now: Date, leaseUntil: Date) {
    validLease(now, leaseUntil);
    // Release expiry row locks before acquiring any actor locks for the next claim.
    await this.purgeExpired(now);
    return this.tx(null, async (client) => {
      const candidates = await client.query(
        "SELECT id,workspace_id,presentation_id,created_by FROM presentation_assistance_jobs WHERE status IN('pending','processing') AND available_at<=$1 AND (lease_until IS NULL OR lease_until<=$1) AND expires_at>$1 ORDER BY created_at,id LIMIT 50",
        [now],
      );
      for (const candidate of candidates.rows) {
        const eligible =
          !!candidate.created_by &&
          (await this.eligible(
            client,
            {
              workspaceId: candidate.workspace_id,
              presentationId: candidate.presentation_id,
              actorId: candidate.created_by,
            },
            true,
          ));
        const found = (
          await client.query(
            "SELECT * FROM presentation_assistance_jobs WHERE id=$1 FOR UPDATE SKIP LOCKED",
            [candidate.id],
          )
        ).rows[0];
        if (!found) continue;
        const row = mapped(found);
        if (!active(row, now) || row.availableAt > now || (row.leaseUntil && row.leaseUntil > now))
          continue;
        if (!eligible) {
          error(row, "SOURCE_UNAVAILABLE", now, true);
          await this.save(client, row);
          continue;
        }
        if (row.job.attempts >= PRESENTATION_ASSISTANCE_MAX_ATTEMPTS) {
          error(row, "ATTEMPTS_EXHAUSTED", now);
          await this.save(client, row);
          continue;
        }
        const result = claimRow(row, now, leaseUntil);
        await this.save(client, row);
        return result;
      }
      return null;
    });
  }
  private async finish(input: PresentationAssistanceFence, mutate: (row: Row) => void) {
    input = fenceIds(input);
    return this.tx(null, async (client) => {
      const candidate = (
        await client.query(
          "SELECT workspace_id,presentation_id,created_by FROM presentation_assistance_jobs WHERE id=$1",
          [input.jobId],
        )
      ).rows[0];
      if (!candidate) return false;
      const eligible =
        !!candidate.created_by &&
        (await this.eligible(
          client,
          {
            workspaceId: candidate.workspace_id,
            presentationId: candidate.presentation_id,
            actorId: candidate.created_by,
          },
          true,
        ));
      const found = (
        await client.query("SELECT * FROM presentation_assistance_jobs WHERE id=$1 FOR UPDATE", [
          input.jobId,
        ])
      ).rows[0];
      if (!found) return false;
      const row = mapped(found);
      if (!fence(row, input)) return false;
      if (!eligible) {
        error(row, "SOURCE_UNAVAILABLE", input.now ?? new Date(), true);
        await this.save(client, row);
        return false;
      }
      mutate(row);
      await this.save(client, row);
      return true;
    });
  }
  complete(input: Parameters<PresentationAssistanceRepository["complete"]>[0]) {
    return this.finish(input, (row) => completeRow(row, input));
  }
  fail(input: Parameters<PresentationAssistanceRepository["fail"]>[0]) {
    return this.finish(input, (row) => failRow(row, input));
  }
  async purgeExpired(now: Date) {
    return this.tx(null, async (client) =>
      (
        await client.query("SELECT id FROM erase_expired_presentation_assistance($1)", [now])
      ).rows.map((row) => String(row.id)),
    );
  }
}
export function createPresentationAssistanceRepository(
  repository: Repository,
): PresentationAssistanceRepository {
  if (repository instanceof PostgresRepository)
    return new PostgresPresentationAssistanceRepository(repository);
  if (repository instanceof MemoryRepository)
    return repository.getOrCreateLifecycleExtension(
      "presentation-assistance",
      () => new MemoryPresentationAssistanceRepository(repository),
    );
  throw new PresentationAssistanceError("NOT_FOUND");
}

/** Synchronous fence for the existing deck mutation transaction, after exact receipt recovery. */
export function assertMemoryPresentationAssistanceReady(
  repository: MemoryRepository,
  workspaceId: string,
  presentationId: string,
  jobId: string,
  proposalHash: string,
): void {
  repository
    .getOrCreateLifecycleExtension(
      "presentation-assistance",
      () => new MemoryPresentationAssistanceRepository(repository),
    )
    .assertReady(workspaceId, presentationId, jobId, proposalHash);
}
