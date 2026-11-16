import { randomUUID } from "node:crypto";
import type { PoolClient, QueryResultRow } from "pg";
import {
  CreatePresentationTextAssistanceJobSchema,
  PresentationTextAssistanceJobSchema,
  PresentationTextAssistanceProposalSchema,
  PRESENTATION_TEXT_ASSISTANCE_MAX_ACTIVE_JOBS,
  PRESENTATION_TEXT_ASSISTANCE_MAX_ATTEMPTS,
  PRESENTATION_TEXT_ASSISTANCE_RETENTION_MS,
  PRESENTATION_TEXT_ASSISTANCE_ERROR_MESSAGES,
  presentationTextAssistanceRequestHash,
  presentationTextAssistanceSourceDigest,
  presentationTextAssistanceProposalHash,
  type PresentationDraft,
  type PresentationTextAssistanceJob,
  type PresentationTextAssistanceErrorCode,
  type PresentationTextLanguage,
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
import { upcastPresentationDraft } from "./artifact-schemas.js";
import type { Repository } from "./types.js";
import {
  PresentationTextAssistanceError,
  type PresentationTextAssistanceContext,
  type PresentationTextAssistanceCreateInput,
  type PresentationTextAssistanceClaim,
  type PresentationTextAssistanceFence,
  type PresentationTextAssistanceRepository,
} from "./presentation-text-assistance-types.js";

/** Resolve precisely one current plain native node; IDs inside scenes are case-sensitive. */
export function assertPresentationTextAssistanceSource(
  draft: PresentationDraft,
  blockId: string,
  nodeId: string,
  sourceDigest: string,
  role?: "title" | "body",
  originalText?: string,
  sourceLanguage?: PresentationTextLanguage | null,
) {
  const blocks = draft.blocks.filter((block) => block.id.toLowerCase() === blockId.toLowerCase());
  const block = blocks.length === 1 ? blocks[0] : undefined;
  const nodes =
    block?.kind === "content" ? block.scene?.nodes.filter((node) => node.id === nodeId) : undefined;
  const node = nodes?.length === 1 ? nodes[0] : undefined;
  if (
    !node ||
    node.type !== "text" ||
    node.richText !== undefined ||
    !node.text.trim() ||
    node.text.length > (node.role === "title" ? 160 : 4000) ||
    (role !== undefined && node.role !== role) ||
    (originalText !== undefined && node.text !== originalText) ||
    (sourceLanguage !== undefined && (node.lang ?? null) !== sourceLanguage) ||
    presentationTextAssistanceSourceDigest(node.text) !== sourceDigest
  )
    throw new PresentationTextAssistanceError(
      "CONFLICT",
      "The selected plain text changed. Review the current saved text again.",
    );
  return node;
}

type Row = {
  workspaceId: string;
  createdBy: string | null;
  requestHash: string;
  originalText: string | null;
  availableAt: Date;
  leaseToken: string | null;
  leaseUntil: Date | null;
  job: PresentationTextAssistanceJob;
};
const clone = <T>(value: T): T => structuredClone(value);
const contextIds = <T extends PresentationTextAssistanceContext>(input: T): T => ({
  ...input,
  workspaceId: input.workspaceId.toLowerCase(),
  presentationId: input.presentationId.toLowerCase(),
  actorId: input.actorId.toLowerCase(),
});
const fenceIds = <T extends PresentationTextAssistanceFence>(input: T): T => ({
  ...input,
  jobId: input.jobId.toLowerCase(),
  leaseToken: input.leaseToken.toLowerCase(),
});

const stamp = (value: unknown) =>
  (value instanceof Date ? value : new Date(String(value))).toISOString();
const active = (row: Row, now: Date) =>
  ["pending", "processing"].includes(row.job.status) &&
  Date.parse(row.job.expiresAt) > now.getTime();
function checked(input: PresentationTextAssistanceCreateInput): Row {
  const request = CreatePresentationTextAssistanceJobSchema.parse(input.request),
    now = input.now ?? new Date();
  if (
    request.presentationId !== input.presentationId ||
    !Number.isFinite(now.getTime()) ||
    !Number.isFinite(input.since.getTime()) ||
    input.since > now ||
    (input.monthlyLimit !== null &&
      (!Number.isSafeInteger(input.monthlyLimit) || input.monthlyLimit < 0))
  )
    throw new PresentationTextAssistanceError("CONFLICT");
  const expiresAt = new Date(
    Math.min(
      input.expiresAt?.getTime() ?? Infinity,
      now.getTime() + PRESENTATION_TEXT_ASSISTANCE_RETENTION_MS,
    ),
  );
  if (!Number.isFinite(expiresAt.getTime()) || expiresAt <= now)
    throw new PresentationTextAssistanceError("CONFLICT");
  return {
    workspaceId: input.workspaceId,
    createdBy: input.actorId,
    requestHash: presentationTextAssistanceRequestHash(request),
    originalText: input.originalText,
    availableAt: now,
    leaseToken: null,
    leaseUntil: null,
    job: PresentationTextAssistanceJobSchema.parse({
      schemaVersion: 1,
      id: request.requestId,
      requestId: request.requestId,
      presentationId: request.presentationId,
      blockId: request.blockId,
      nodeId: request.nodeId,
      role: input.role,
      operation: request.operation,
      sourceRevision: request.expectedRevision,
      status: "pending",
      attempts: 0,
      proposal: null,
      proposalHash: null,
      sourceDigest: request.sourceDigest,
      error: null,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
      ...(request.operation === "translate"
        ? { targetLanguage: request.targetLanguage, sourceLanguage: request.sourceLanguage }
        : {}),
    }),
  };
}
function error(row: Row, code: PresentationTextAssistanceErrorCode, now: Date, scrub = false) {
  row.job.status = code === "EXPIRED" ? "expired" : "failed";
  row.job.error = { code, message: PRESENTATION_TEXT_ASSISTANCE_ERROR_MESSAGES[code] };
  row.job.proposal = null;
  row.job.proposalHash = null;
  row.job.updatedAt = now.toISOString();
  row.originalText = null;
  row.leaseToken = null;
  row.leaseUntil = null;
  if (scrub) {
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
    throw new PresentationTextAssistanceError(
      "CONFLICT",
      "This request identity was already used for another text assistance intent",
    );
  expire(prior, now);
  return { status: "duplicate" as const, job: clone(prior.job) };
}
function fence(row: Row | undefined | null, input: PresentationTextAssistanceFence): row is Row {
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
function claimRow(row: Row, now: Date, leaseUntil: Date): PresentationTextAssistanceClaim {
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
    originalText: row.originalText!,
    requestHash: row.requestHash,
    attempt: row.job.attempts,
    leaseToken: row.leaseToken,
    leaseUntil: new Date(row.leaseUntil),
  };
}
function completeRow(
  row: Row,
  input: Parameters<PresentationTextAssistanceRepository["complete"]>[0],
) {
  const proposal = PresentationTextAssistanceProposalSchema.parse(input.proposal);
  if (
    proposal.blockId !== row.job.blockId ||
    proposal.nodeId !== row.job.nodeId ||
    proposal.role !== row.job.role ||
    proposal.operation !== row.job.operation ||
    proposal.sourceDigest !== row.job.sourceDigest ||
    proposal.originalText !== row.originalText ||
    proposal.targetLanguage !== row.job.targetLanguage ||
    proposal.sourceLanguage !== row.job.sourceLanguage
  )
    throw new PresentationTextAssistanceError(
      "CONFLICT",
      "The proposal must match the selected source text and target",
    );
  row.job.status = "ready";
  row.job.proposal = proposal;
  row.job.proposalHash = presentationTextAssistanceProposalHash(proposal);
  row.job.error = null;
  row.job.updatedAt = (input.now ?? new Date()).toISOString();
  row.originalText = null;
  row.leaseToken = null;
  row.leaseUntil = null;
}
function failRow(row: Row, input: Parameters<PresentationTextAssistanceRepository["fail"]>[0]) {
  const now = input.now ?? new Date();
  if (input.terminal || row.job.attempts >= PRESENTATION_TEXT_ASSISTANCE_MAX_ATTEMPTS) {
    error(
      row,
      row.job.attempts >= PRESENTATION_TEXT_ASSISTANCE_MAX_ATTEMPTS
        ? "ATTEMPTS_EXHAUSTED"
        : input.errorCode,
      now,
    );
    return;
  }
  const availableAt = input.availableAt ?? now;
  if (!Number.isFinite(availableAt.getTime()) || availableAt < now)
    throw new PresentationTextAssistanceError("CONFLICT");
  row.job.status = "pending";
  row.job.error = {
    code: input.errorCode,
    message: PRESENTATION_TEXT_ASSISTANCE_ERROR_MESSAGES[input.errorCode],
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
    throw new PresentationTextAssistanceError("CONFLICT");
}
export class MemoryPresentationTextAssistanceRepository
  implements PresentationTextAssistanceRepository, MemoryRepositoryLifecycleExtension
{
  private readonly rows = new Map<string, Row>();
  private readonly erasedActors = new Set<string>();
  private readonly erasedWorkspaces = new Set<string>();
  private readonly presentations: MemoryPresentationRepository;
  constructor(private parent: MemoryRepository) {
    this.presentations = createPresentationRepository(parent) as MemoryPresentationRepository;
  }
  assertReady(
    workspaceId: string,
    presentationId: string,
    jobId: string,
    proposalHash: string,
    sourceDigest: string,
    blockId: string,
    nodeId: string,
    draft: PresentationDraft,
    targetLanguage?: PresentationTextLanguage,
    sourceLanguage?: PresentationTextLanguage | null,
  ) {
    const row = this.rows.get(jobId.toLowerCase());
    if (
      !row ||
      row.workspaceId !== workspaceId.toLowerCase() ||
      row.job.presentationId !== presentationId.toLowerCase() ||
      row.job.status !== "ready" ||
      row.job.proposalHash !== proposalHash ||
      !row.job.proposal ||
      row.job.sourceDigest !== sourceDigest ||
      row.job.blockId !== blockId.toLowerCase() ||
      row.job.nodeId !== nodeId ||
      row.job.targetLanguage !== targetLanguage ||
      row.job.sourceLanguage !== sourceLanguage ||
      Date.parse(row.job.expiresAt) <= Date.now() ||
      !this.creatorEligible(row)
    )
      throw new PresentationTextAssistanceError(
        "CONFLICT",
        "The reviewed text proposal is no longer ready to apply",
      );
    assertPresentationTextAssistanceSource(
      draft,
      row.job.blockId,
      row.job.nodeId,
      row.job.sourceDigest,
      row.job.role,
      undefined,
      row.job.operation === "translate" ? row.job.sourceLanguage : undefined,
    );
  }
  private eligible(input: PresentationTextAssistanceContext) {
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
  activePresentationAssistanceJobs(workspaceId: string, now: Date): number {
    return [...this.rows.values()].filter(
      (row) => row.workspaceId === workspaceId && active(row, now),
    ).length;
  }
  async create(input: PresentationTextAssistanceCreateInput) {
    input = contextIds(input);
    const row = checked(input),
      now = input.now ?? new Date();
    if (!this.eligible(input)) throw new PresentationTextAssistanceError("NOT_FOUND");
    const prior = this.rows.get(row.job.id);
    if (prior) {
      if (prior.workspaceId !== input.workspaceId)
        throw new PresentationTextAssistanceError("CONFLICT");
      if (prior.job.status !== "expired" && !this.creatorEligible(prior))
        error(prior, "SOURCE_UNAVAILABLE", now, true);
      return replay(prior, row, now);
    }
    if (this.parent.authoringAdmissions.has(`${input.workspaceId}:presentation:${row.job.id}`))
      throw new PresentationTextAssistanceError(
        "CONFLICT",
        "This erased request identity cannot be reused",
      );
    const current = this.presentations.presentations.get(input.presentationId)!;
    if (current.draftRevision !== row.job.sourceRevision)
      throw new PresentationTextAssistanceError(
        "CONFLICT",
        "Reload the saved presentation before requesting text assistance",
      );
    assertPresentationTextAssistanceSource(
      current.draft,
      row.job.blockId,
      row.job.nodeId,
      row.job.sourceDigest,
      row.job.role,
      row.originalText!,
      row.job.operation === "translate" ? row.job.sourceLanguage : undefined,
    );
    const used = this.parent.authoringUsageSince(input.workspaceId, input.since);
    if (input.monthlyLimit !== null && used >= input.monthlyLimit)
      throw new PresentationTextAssistanceError("LIMIT_REACHED");
    if (
      this.parent.activePresentationAssistanceJobs(input.workspaceId, now) >=
      PRESENTATION_TEXT_ASSISTANCE_MAX_ACTIVE_JOBS
    )
      throw new PresentationTextAssistanceError("ACTIVE_LIMIT_REACHED");
    // No await between allowance check and both mutations: legacy and new memory admissions are atomic.
    this.rows.set(row.job.id, row);
    this.parent.recordAuthoringAdmission("presentation", input.workspaceId, row.job.id, now);
    return { status: "created" as const, job: clone(row.job) };
  }
  async get(input: PresentationTextAssistanceContext & { jobId: string }) {
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
  async list(input: PresentationTextAssistanceContext & { limit?: number }) {
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
  async usage(input: PresentationTextAssistanceContext & { since: Date }) {
    input = contextIds(input);
    if (!this.eligible(input)) throw new PresentationTextAssistanceError("NOT_FOUND");
    return {
      used: this.parent.authoringUsageSince(input.workspaceId, input.since),
      active: this.parent.activePresentationAssistanceJobs(
        input.workspaceId,
        input.now ?? new Date(),
      ),
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
      if (row.job.attempts >= PRESENTATION_TEXT_ASSISTANCE_MAX_ATTEMPTS) {
        error(row, "ATTEMPTS_EXHAUSTED", now);
        continue;
      }
      return claimRow(row, now, leaseUntil);
    }
    return null;
  }
  async complete(input: Parameters<PresentationTextAssistanceRepository["complete"]>[0]) {
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
  async fail(input: Parameters<PresentationTextAssistanceRepository["fail"]>[0]) {
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
      presentationTextAssistanceJobs: [...this.rows.values()]
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
    originalText: row.original_text,
    availableAt: new Date(row.available_at),
    leaseToken: row.lease_token,
    leaseUntil: row.lease_until ? new Date(row.lease_until) : null,
    job: PresentationTextAssistanceJobSchema.parse({
      schemaVersion: 1,
      id: row.id,
      requestId: row.id,
      presentationId: row.presentation_id,
      blockId: row.block_id,
      nodeId: row.node_id,
      operation: row.operation,
      role: row.role,
      sourceRevision: row.source_revision,
      status: row.status,
      attempts: row.attempts,
      proposal: row.proposal,
      proposalHash: row.proposal_hash,
      sourceDigest: row.source_digest,
      error: row.error_code
        ? {
            code: row.error_code,
            message:
              PRESENTATION_TEXT_ASSISTANCE_ERROR_MESSAGES[
                row.error_code as PresentationTextAssistanceErrorCode
              ],
          }
        : null,
      createdAt: stamp(row.created_at),
      updatedAt: stamp(row.updated_at),
      expiresAt: stamp(row.expires_at),
      ...(row.operation === "translate"
        ? { targetLanguage: row.target_language, sourceLanguage: row.source_language }
        : {}),
    }),
  };
}
export class PostgresPresentationTextAssistanceRepository implements PresentationTextAssistanceRepository {
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
      if ((error as { code?: string }).code === "23505")
        throw new PresentationTextAssistanceError(
          "CONFLICT",
          "This request identity has already been consumed",
        );
      throw error;
    } finally {
      client.release();
    }
  }
  private async eligible(
    client: PoolClient,
    input: PresentationTextAssistanceContext,
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
      `UPDATE presentation_text_assistance_jobs SET created_by=$2,original_text=$3,status=$4,attempts=$5,available_at=$6,lease_token=$7,lease_until=$8,proposal=$9,proposal_hash=$10,error_code=$11,updated_at=$12 WHERE id=$1`,
      [
        row.job.id,
        row.createdBy,
        row.originalText,
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
  async create(input: PresentationTextAssistanceCreateInput) {
    input = contextIds(input);
    const row = checked(input),
      now = input.now ?? new Date();
    return this.tx(input.workspaceId, async (client) => {
      const metadata = (
        await client.query<{ created_by: string | null }>(
          "SELECT created_by FROM presentation_text_assistance_jobs WHERE workspace_id=$1 AND id=$2",
          [input.workspaceId, row.job.id],
        )
      ).rows[0];
      const permitted = await this.eligible(
        client,
        input,
        true,
        metadata?.created_by ? [metadata.created_by] : [],
      );
      if (!permitted) throw new PresentationTextAssistanceError("NOT_FOUND");
      const prior = (
        await client.query(
          "SELECT * FROM presentation_text_assistance_jobs WHERE workspace_id=$1 AND id=$2 FOR UPDATE",
          [input.workspaceId, row.job.id],
        )
      ).rows[0];
      if (prior) {
        const stored = mapped(prior);
        if (
          stored.job.status !== "expired" &&
          (!stored.createdBy || !permitted.has(stored.createdBy))
        )
          error(stored, "SOURCE_UNAVAILABLE", now, true);
        const result = replay(stored, row, now);
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
        throw new PresentationTextAssistanceError(
          "CONFLICT",
          "This erased request identity cannot be reused",
        );
      const current = (
        await client.query(
          "SELECT draft,draft_schema_version,draft_revision FROM presentations WHERE workspace_id=$1 AND id=$2 FOR SHARE",
          [input.workspaceId, input.presentationId],
        )
      ).rows[0];
      if (!current || Number(current.draft_revision) !== row.job.sourceRevision)
        throw new PresentationTextAssistanceError(
          "CONFLICT",
          "Reload the saved presentation before requesting text assistance",
        );
      assertPresentationTextAssistanceSource(
        upcastPresentationDraft(current.draft, current.draft_schema_version),
        row.job.blockId,
        row.job.nodeId,
        row.job.sourceDigest,
        row.job.role,
        row.originalText!,
        row.job.operation === "translate" ? row.job.sourceLanguage : undefined,
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
        throw new PresentationTextAssistanceError("LIMIT_REACHED");
      const count = Number(
        (
          await client.query(
            "SELECT ((SELECT count(*) FROM presentation_assistance_jobs WHERE workspace_id=$1 AND status IN('pending','processing') AND expires_at>$2)+(SELECT count(*) FROM presentation_text_assistance_jobs WHERE workspace_id=$1 AND status IN('pending','processing') AND expires_at>$2)+(SELECT count(*) FROM presentation_question_suggestions_jobs WHERE workspace_id=$1 AND status IN('pending','processing') AND expires_at>$2))::integer AS count",
            [input.workspaceId, now],
          )
        ).rows[0].count,
      );
      if (count >= PRESENTATION_TEXT_ASSISTANCE_MAX_ACTIVE_JOBS)
        throw new PresentationTextAssistanceError("ACTIVE_LIMIT_REACHED");
      const result = await client.query(
        `INSERT INTO presentation_text_assistance_jobs(id,workspace_id,presentation_id,created_by,request_hash,source_digest,block_id,node_id,operation,role,source_revision,original_text,status,attempts,available_at,created_at,updated_at,expires_at,target_language,source_language) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'pending',0,$13,$13,$13,$14,$15,$16) RETURNING *`,
        [
          row.job.id,
          row.workspaceId,
          row.job.presentationId,
          row.createdBy,
          row.requestHash,
          row.job.sourceDigest,
          row.job.blockId,
          row.job.nodeId,
          row.job.operation,
          row.job.role,
          row.job.sourceRevision,
          row.originalText,
          now,
          row.job.expiresAt,
          row.job.targetLanguage ?? null,
          row.job.sourceLanguage ?? null,
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
  async get(input: PresentationTextAssistanceContext & { jobId: string }) {
    input = contextIds(input);
    return this.tx(input.workspaceId, async (client) => {
      // No private source/proposal bodies are read until relevant identities and authority are locked.
      const metadata = (
        await client.query<{ created_by: string | null }>(
          "SELECT created_by FROM presentation_text_assistance_jobs WHERE workspace_id=$1 AND presentation_id=$2 AND id=$3",
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
          "SELECT * FROM presentation_text_assistance_jobs WHERE workspace_id=$1 AND presentation_id=$2 AND id=$3 FOR UPDATE",
          [input.workspaceId, input.presentationId, input.jobId],
        )
      ).rows[0];
      return found ? this.scrubRead(client, found, permitted, input.now ?? new Date()) : null;
    });
  }
  async list(input: PresentationTextAssistanceContext & { limit?: number }) {
    input = contextIds(input);
    return this.tx(input.workspaceId, async (client) => {
      const metadata = await client.query<{ id: string; created_by: string | null }>(
        "SELECT id,created_by FROM presentation_text_assistance_jobs WHERE workspace_id=$1 AND presentation_id=$2 ORDER BY created_at DESC,id LIMIT $3",
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
        "SELECT * FROM presentation_text_assistance_jobs WHERE workspace_id=$1 AND presentation_id=$2 AND id=ANY($3::uuid[]) ORDER BY created_at DESC,id FOR UPDATE",
        [input.workspaceId, input.presentationId, metadata.rows.map((row) => row.id)],
      );
      const jobs: PresentationTextAssistanceJob[] = [],
        now = input.now ?? new Date();
      for (const found of result.rows)
        jobs.push(await this.scrubRead(client, found, permitted, now));
      return jobs;
    });
  }
  async usage(input: PresentationTextAssistanceContext & { since: Date }) {
    input = contextIds(input);
    return this.tx(input.workspaceId, async (client) => {
      if (!(await this.eligible(client, input)))
        throw new PresentationTextAssistanceError("NOT_FOUND");
      const result = await client.query(
        "SELECT (SELECT count(*)::integer FROM authoring_admission_receipts WHERE workspace_id=$1 AND created_at >= $2) AS used,((SELECT count(*) FROM presentation_assistance_jobs WHERE workspace_id=$1 AND status IN('pending','processing') AND expires_at>$3)+(SELECT count(*) FROM presentation_text_assistance_jobs WHERE workspace_id=$1 AND status IN('pending','processing') AND expires_at>$3)+(SELECT count(*) FROM presentation_question_suggestions_jobs WHERE workspace_id=$1 AND status IN('pending','processing') AND expires_at>$3))::integer AS active",
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
        "SELECT id,workspace_id,presentation_id,created_by FROM presentation_text_assistance_jobs WHERE status IN('pending','processing') AND available_at<=$1 AND (lease_until IS NULL OR lease_until<=$1) AND expires_at>$1 ORDER BY created_at,id LIMIT 50",
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
            "SELECT * FROM presentation_text_assistance_jobs WHERE id=$1 FOR UPDATE SKIP LOCKED",
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
        if (row.job.attempts >= PRESENTATION_TEXT_ASSISTANCE_MAX_ATTEMPTS) {
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
  private async finish(input: PresentationTextAssistanceFence, mutate: (row: Row) => void) {
    input = fenceIds(input);
    return this.tx(null, async (client) => {
      const candidate = (
        await client.query(
          "SELECT workspace_id,presentation_id,created_by FROM presentation_text_assistance_jobs WHERE id=$1",
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
        await client.query(
          "SELECT * FROM presentation_text_assistance_jobs WHERE id=$1 FOR UPDATE",
          [input.jobId],
        )
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
  complete(input: Parameters<PresentationTextAssistanceRepository["complete"]>[0]) {
    return this.finish(input, (row) => completeRow(row, input));
  }
  fail(input: Parameters<PresentationTextAssistanceRepository["fail"]>[0]) {
    return this.finish(input, (row) => failRow(row, input));
  }
  async purgeExpired(now: Date) {
    return this.tx(null, async (client) =>
      (
        await client.query("SELECT id FROM erase_expired_presentation_text_assistance($1)", [now])
      ).rows.map((row) => String(row.id)),
    );
  }
}
export function createPresentationTextAssistanceRepository(
  repository: Repository,
): PresentationTextAssistanceRepository {
  if (repository instanceof PostgresRepository)
    return new PostgresPresentationTextAssistanceRepository(repository);
  if (repository instanceof MemoryRepository)
    return repository.getOrCreateLifecycleExtension(
      "presentation-text-assistance",
      () => new MemoryPresentationTextAssistanceRepository(repository),
    );
  throw new PresentationTextAssistanceError("NOT_FOUND");
}

/** Synchronous fence after exact receipt recovery, inside the deck mutation turn. */
export function assertMemoryPresentationTextAssistanceReady(
  repository: MemoryRepository,
  workspaceId: string,
  presentationId: string,
  jobId: string,
  proposalHash: string,
  sourceDigest: string,
  blockId: string,
  nodeId: string,
  draft: PresentationDraft,
  targetLanguage?: PresentationTextLanguage,
  sourceLanguage?: PresentationTextLanguage | null,
): void {
  repository
    .getOrCreateLifecycleExtension(
      "presentation-text-assistance",
      () => new MemoryPresentationTextAssistanceRepository(repository),
    )
    .assertReady(
      workspaceId,
      presentationId,
      jobId,
      proposalHash,
      sourceDigest,
      blockId,
      nodeId,
      draft,
      targetLanguage,
      sourceLanguage,
    );
}
