import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type { PoolClient, QueryResultRow } from "pg";
import {
  CreatePresentationQuestionSuggestionsJobSchema,
  PresentationQuestionSuggestionsJobSchema,
  PresentationQuestionSuggestionsProposalSchema,
  PRESENTATION_QUESTION_SUGGESTIONS_MAX_ACTIVE_JOBS,
  PRESENTATION_QUESTION_SUGGESTIONS_MAX_ATTEMPTS,
  PRESENTATION_QUESTION_SUGGESTIONS_RETENTION_MS,
  PRESENTATION_QUESTION_SUGGESTIONS_ERROR_MESSAGES,
  presentationQuestionSuggestionsRequestHash,
  presentationQuestionSuggestionsSourceDigest,
  presentationQuestionSuggestionsProposalHash,
  type PresentationDraft,
  type PresentationQuestionSuggestionsJob,
  type PresentationQuestionSuggestionsErrorCode,
  type PresentationQuestionSuggestionSource,
  type PresentationQuestionSuggestionsProposal,
  buildPresentationQuestionSuggestionBlock,
  PresentationDraftSchema,
  resolvePresentationSpatialFrames,
  PRESENTATION_NATIVE_DOCUMENT_MAX_BYTES,
  presentationQuestionSuggestionSource,
  presentationQuestionSuggestionsSourceFingerprint,
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
  PresentationQuestionSuggestionsError,
  type PresentationQuestionSuggestionsContext,
  type PresentationQuestionSuggestionsCreateInput,
  type PresentationQuestionSuggestionsClaim,
  type PresentationQuestionSuggestionsFence,
  type PresentationQuestionSuggestionsRepository,
} from "./presentation-question-suggestions-types.js";

/** Compare the entire canonical selected-slide projection, including language and paragraph/order identity. */
export function assertPresentationQuestionSuggestionsSource(
  draft: PresentationDraft,
  blockId: string,
  sourceDigest: string,
  source?: PresentationQuestionSuggestionSource | null,
) {
  const blocks = draft.blocks.filter((block) => block.id.toLowerCase() === blockId.toLowerCase());
  const projected = blocks.length === 1 ? presentationQuestionSuggestionSource(blocks[0]!) : null;
  if (
    !projected?.supported ||
    presentationQuestionSuggestionsSourceDigest(projected.source) !== sourceDigest ||
    (source &&
      presentationQuestionSuggestionsSourceFingerprint(source) !==
        presentationQuestionSuggestionsSourceFingerprint(projected.source))
  )
    throw new PresentationQuestionSuggestionsError(
      "CONFLICT",
      "The selected slide source changed. Review the current saved source again.",
    );
  return projected.source;
}

/** Shared server/repository construction: one normal question, preserving every unrelated field. */
export function buildPresentationQuestionSuggestionsDraft(input: {
  draft: PresentationDraft;
  proposal: PresentationQuestionSuggestionsProposal;
  jobId: string;
  suggestionId: string;
  mutationId: string;
}) {
  const { draft, proposal } = input;
  assertPresentationQuestionSuggestionsSource(
    draft,
    proposal.blockId,
    proposal.sourceDigest,
    proposal.source,
  );
  const block = buildPresentationQuestionSuggestionBlock(input);
  const identities = new Set(
    draft.blocks
      .flatMap((item) => [
        item.id,
        ...(item.kind === "question"
          ? [
              item.question.id,
              ...("choices" in item.question
                ? item.question.choices.map((choice) => choice.id)
                : []),
            ]
          : []),
      ])
      .map((id) => id.toLowerCase()),
  );
  if (draft.blocks.length >= 200 || identities.has(block.id) || identities.has(block.question.id))
    throw new PresentationQuestionSuggestionsError("CONFLICT");
  const anchor = draft.blocks.findIndex((item) => item.id.toLowerCase() === proposal.blockId);
  const blocks = [...draft.blocks];
  blocks.splice(anchor + 1, 0, block);
  let next = {
    ...draft,
    schemaVersion: Math.max(10, draft.schemaVersion),
    blocks,
    ...(draft.sections
      ? {
          sections: draft.sections.map((section) => {
            const index = section.blockIds.findIndex((id) => id.toLowerCase() === proposal.blockId);
            if (index < 0) return section;
            const blockIds = [...section.blockIds];
            blockIds.splice(index + 1, 0, block.id);
            return { ...section, blockIds };
          }),
        }
      : {}),
  };
  if (next.spatial) {
    const added = resolvePresentationSpatialFrames(next as PresentationDraft).find(
      (frame) => frame.blockId === block.id,
    );
    if (added)
      next = { ...next, spatial: { ...next.spatial, frames: [...next.spatial.frames, added] } };
  }
  const result = PresentationDraftSchema.safeParse(next);
  if (
    !result.success ||
    Buffer.byteLength(JSON.stringify(next), "utf8") > PRESENTATION_NATIVE_DOCUMENT_MAX_BYTES
  )
    throw new PresentationQuestionSuggestionsError("CONFLICT");
  return result.data;
}
export function assertPresentationQuestionSuggestionsInsertion(input: {
  draft: PresentationDraft;
  current: PresentationDraft;
  proposal: PresentationQuestionSuggestionsProposal;
  jobId: string;
  suggestionId: string;
  mutationId: string;
}) {
  const expected = buildPresentationQuestionSuggestionsDraft({ ...input, draft: input.current });
  if (!isDeepStrictEqual(expected, input.draft))
    throw new PresentationQuestionSuggestionsError(
      "CONFLICT",
      "The inserted question must match the reviewed suggestion and preserve the saved draft",
    );
}

type Row = {
  workspaceId: string;
  createdBy: string | null;
  requestHash: string;
  source: PresentationQuestionSuggestionSource | null;
  availableAt: Date;
  leaseToken: string | null;
  leaseUntil: Date | null;
  job: PresentationQuestionSuggestionsJob;
};
const clone = <T>(value: T): T => structuredClone(value);
const contextIds = <T extends PresentationQuestionSuggestionsContext>(input: T): T => ({
  ...input,
  workspaceId: input.workspaceId.toLowerCase(),
  presentationId: input.presentationId.toLowerCase(),
  actorId: input.actorId.toLowerCase(),
});
const fenceIds = <T extends PresentationQuestionSuggestionsFence>(input: T): T => ({
  ...input,
  jobId: input.jobId.toLowerCase(),
  leaseToken: input.leaseToken.toLowerCase(),
});

const stamp = (value: unknown) =>
  (value instanceof Date ? value : new Date(String(value))).toISOString();
const active = (row: Row, now: Date) =>
  ["pending", "processing"].includes(row.job.status) &&
  Date.parse(row.job.expiresAt) > now.getTime();
function checked(input: PresentationQuestionSuggestionsCreateInput): Row {
  const request = CreatePresentationQuestionSuggestionsJobSchema.parse(input.request),
    now = input.now ?? new Date();
  if (
    request.presentationId !== input.presentationId ||
    !Number.isFinite(now.getTime()) ||
    !Number.isFinite(input.since.getTime()) ||
    input.since > now ||
    (input.monthlyLimit !== null &&
      (!Number.isSafeInteger(input.monthlyLimit) || input.monthlyLimit < 0))
  )
    throw new PresentationQuestionSuggestionsError("CONFLICT");
  const expiresAt = new Date(
    Math.min(
      input.expiresAt?.getTime() ?? Infinity,
      now.getTime() + PRESENTATION_QUESTION_SUGGESTIONS_RETENTION_MS,
    ),
  );
  if (!Number.isFinite(expiresAt.getTime()) || expiresAt <= now)
    throw new PresentationQuestionSuggestionsError("CONFLICT");
  return {
    workspaceId: input.workspaceId,
    createdBy: input.actorId,
    requestHash: presentationQuestionSuggestionsRequestHash(request),
    source: input.source,
    availableAt: now,
    leaseToken: null,
    leaseUntil: null,
    job: PresentationQuestionSuggestionsJobSchema.parse({
      schemaVersion: 1,
      id: request.requestId,
      requestId: request.requestId,
      presentationId: request.presentationId,
      blockId: request.blockId,
      outputLanguage: request.outputLanguage,
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
    }),
  };
}
function error(row: Row, code: PresentationQuestionSuggestionsErrorCode, now: Date, scrub = false) {
  row.job.status = code === "EXPIRED" ? "expired" : "failed";
  row.job.error = { code, message: PRESENTATION_QUESTION_SUGGESTIONS_ERROR_MESSAGES[code] };
  row.job.proposal = null;
  row.job.proposalHash = null;
  row.job.updatedAt = now.toISOString();
  row.source = null;
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
    throw new PresentationQuestionSuggestionsError(
      "CONFLICT",
      "This request identity was already used for another question suggestions intent",
    );
  expire(prior, now);
  return { status: "duplicate" as const, job: clone(prior.job) };
}
function fence(
  row: Row | undefined | null,
  input: PresentationQuestionSuggestionsFence,
): row is Row {
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
function claimRow(row: Row, now: Date, leaseUntil: Date): PresentationQuestionSuggestionsClaim {
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
    source: clone(row.source!),
    requestHash: row.requestHash,
    attempt: row.job.attempts,
    leaseToken: row.leaseToken,
    leaseUntil: new Date(row.leaseUntil),
  };
}
function completeRow(
  row: Row,
  input: Parameters<PresentationQuestionSuggestionsRepository["complete"]>[0],
) {
  const proposal = PresentationQuestionSuggestionsProposalSchema.parse(input.proposal);
  if (
    proposal.blockId !== row.job.blockId ||
    proposal.sourceDigest !== row.job.sourceDigest ||
    proposal.outputLanguage !== row.job.outputLanguage ||
    !row.source ||
    presentationQuestionSuggestionsSourceFingerprint(proposal.source) !==
      presentationQuestionSuggestionsSourceFingerprint(row.source)
  )
    throw new PresentationQuestionSuggestionsError(
      "CONFLICT",
      "The proposal must match the selected source text and target",
    );
  row.job.status = "ready";
  row.job.proposal = proposal;
  row.job.proposalHash = presentationQuestionSuggestionsProposalHash(proposal);
  row.job.error = null;
  row.job.updatedAt = (input.now ?? new Date()).toISOString();
  row.source = null;
  row.leaseToken = null;
  row.leaseUntil = null;
}
function failRow(
  row: Row,
  input: Parameters<PresentationQuestionSuggestionsRepository["fail"]>[0],
) {
  const now = input.now ?? new Date();
  if (input.terminal || row.job.attempts >= PRESENTATION_QUESTION_SUGGESTIONS_MAX_ATTEMPTS) {
    error(
      row,
      row.job.attempts >= PRESENTATION_QUESTION_SUGGESTIONS_MAX_ATTEMPTS
        ? "ATTEMPTS_EXHAUSTED"
        : input.errorCode,
      now,
    );
    return;
  }
  const availableAt = input.availableAt ?? now;
  if (!Number.isFinite(availableAt.getTime()) || availableAt < now)
    throw new PresentationQuestionSuggestionsError("CONFLICT");
  row.job.status = "pending";
  row.job.error = {
    code: input.errorCode,
    message: PRESENTATION_QUESTION_SUGGESTIONS_ERROR_MESSAGES[input.errorCode],
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
    throw new PresentationQuestionSuggestionsError("CONFLICT");
}
export class MemoryPresentationQuestionSuggestionsRepository
  implements PresentationQuestionSuggestionsRepository, MemoryRepositoryLifecycleExtension
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
    suggestionId: string,
    draft: PresentationDraft,
    nextDraft: PresentationDraft,
    mutationId: string,
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
      !row.job.proposal.suggestions.some((suggestion) => suggestion.id === suggestionId) ||
      Date.parse(row.job.expiresAt) <= Date.now() ||
      !this.creatorEligible(row)
    )
      throw new PresentationQuestionSuggestionsError(
        "CONFLICT",
        "The reviewed question is no longer ready to insert",
      );
    assertPresentationQuestionSuggestionsSource(
      draft,
      blockId,
      sourceDigest,
      row.job.proposal.source,
    );
    assertPresentationQuestionSuggestionsInsertion({
      draft: nextDraft,
      current: draft,
      proposal: row.job.proposal,
      jobId,
      suggestionId,
      mutationId,
    });
  }

  private eligible(input: PresentationQuestionSuggestionsContext) {
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
  async create(input: PresentationQuestionSuggestionsCreateInput) {
    input = contextIds(input);
    const row = checked(input),
      now = input.now ?? new Date();
    if (!this.eligible(input)) throw new PresentationQuestionSuggestionsError("NOT_FOUND");
    const prior = this.rows.get(row.job.id);
    if (prior) {
      if (prior.workspaceId !== input.workspaceId)
        throw new PresentationQuestionSuggestionsError("CONFLICT");
      if (prior.job.status !== "expired" && !this.creatorEligible(prior))
        error(prior, "SOURCE_UNAVAILABLE", now, true);
      return replay(prior, row, now);
    }
    if (this.parent.authoringAdmissions.has(`${input.workspaceId}:presentation:${row.job.id}`))
      throw new PresentationQuestionSuggestionsError(
        "CONFLICT",
        "This erased request identity cannot be reused",
      );
    const current = this.presentations.presentations.get(input.presentationId)!;
    if (current.draftRevision !== row.job.sourceRevision)
      throw new PresentationQuestionSuggestionsError(
        "CONFLICT",
        "Reload the saved presentation before requesting question suggestions",
      );
    row.source = assertPresentationQuestionSuggestionsSource(
      current.draft,
      row.job.blockId,
      row.job.sourceDigest,
      row.source,
    );
    const used = this.parent.authoringUsageSince(input.workspaceId, input.since);
    if (input.monthlyLimit !== null && used >= input.monthlyLimit)
      throw new PresentationQuestionSuggestionsError("LIMIT_REACHED");
    if (
      this.parent.activePresentationAssistanceJobs(input.workspaceId, now) >=
      PRESENTATION_QUESTION_SUGGESTIONS_MAX_ACTIVE_JOBS
    )
      throw new PresentationQuestionSuggestionsError("ACTIVE_LIMIT_REACHED");
    // No await between allowance check and both mutations: legacy and new memory admissions are atomic.
    this.rows.set(row.job.id, row);
    this.parent.recordAuthoringAdmission("presentation", input.workspaceId, row.job.id, now);
    return { status: "created" as const, job: clone(row.job) };
  }
  async get(input: PresentationQuestionSuggestionsContext & { jobId: string }) {
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
  async list(input: PresentationQuestionSuggestionsContext & { limit?: number }) {
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
  async usage(input: PresentationQuestionSuggestionsContext & { since: Date }) {
    input = contextIds(input);
    if (!this.eligible(input)) throw new PresentationQuestionSuggestionsError("NOT_FOUND");
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
      if (row.job.attempts >= PRESENTATION_QUESTION_SUGGESTIONS_MAX_ATTEMPTS) {
        error(row, "ATTEMPTS_EXHAUSTED", now);
        continue;
      }
      return claimRow(row, now, leaseUntil);
    }
    return null;
  }
  async complete(input: Parameters<PresentationQuestionSuggestionsRepository["complete"]>[0]) {
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
  async fail(input: Parameters<PresentationQuestionSuggestionsRepository["fail"]>[0]) {
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
      presentationQuestionSuggestionsJobs: [...this.rows.values()]
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
    source: row.source_snapshot,
    availableAt: new Date(row.available_at),
    leaseToken: row.lease_token,
    leaseUntil: row.lease_until ? new Date(row.lease_until) : null,
    job: PresentationQuestionSuggestionsJobSchema.parse({
      schemaVersion: 1,
      id: row.id,
      requestId: row.id,
      presentationId: row.presentation_id,
      blockId: row.block_id,
      outputLanguage: row.output_language,
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
              PRESENTATION_QUESTION_SUGGESTIONS_ERROR_MESSAGES[
                row.error_code as PresentationQuestionSuggestionsErrorCode
              ],
          }
        : null,
      createdAt: stamp(row.created_at),
      updatedAt: stamp(row.updated_at),
      expiresAt: stamp(row.expires_at),
    }),
  };
}
export class PostgresPresentationQuestionSuggestionsRepository implements PresentationQuestionSuggestionsRepository {
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
        throw new PresentationQuestionSuggestionsError(
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
    input: PresentationQuestionSuggestionsContext,
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
      `UPDATE presentation_question_suggestions_jobs SET created_by=$2,source_snapshot=$3,status=$4,attempts=$5,available_at=$6,lease_token=$7,lease_until=$8,proposal=$9,proposal_hash=$10,error_code=$11,updated_at=$12 WHERE id=$1`,
      [
        row.job.id,
        row.createdBy,
        row.source ? JSON.stringify(row.source) : null,
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
  async create(input: PresentationQuestionSuggestionsCreateInput) {
    input = contextIds(input);
    const row = checked(input),
      now = input.now ?? new Date();
    return this.tx(input.workspaceId, async (client) => {
      const metadata = (
        await client.query<{ created_by: string | null }>(
          "SELECT created_by FROM presentation_question_suggestions_jobs WHERE workspace_id=$1 AND id=$2",
          [input.workspaceId, row.job.id],
        )
      ).rows[0];
      const permitted = await this.eligible(
        client,
        input,
        true,
        metadata?.created_by ? [metadata.created_by] : [],
      );
      if (!permitted) throw new PresentationQuestionSuggestionsError("NOT_FOUND");
      const prior = (
        await client.query(
          "SELECT * FROM presentation_question_suggestions_jobs WHERE workspace_id=$1 AND id=$2 FOR UPDATE",
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
        throw new PresentationQuestionSuggestionsError(
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
        throw new PresentationQuestionSuggestionsError(
          "CONFLICT",
          "Reload the saved presentation before requesting question suggestions",
        );
      row.source = assertPresentationQuestionSuggestionsSource(
        upcastPresentationDraft(current.draft, current.draft_schema_version),
        row.job.blockId,
        row.job.sourceDigest,
        row.source,
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
        throw new PresentationQuestionSuggestionsError("LIMIT_REACHED");
      const count = Number(
        (
          await client.query(
            "SELECT ((SELECT count(*) FROM presentation_assistance_jobs WHERE workspace_id=$1 AND status IN('pending','processing') AND expires_at>$2)+(SELECT count(*) FROM presentation_text_assistance_jobs WHERE workspace_id=$1 AND status IN('pending','processing') AND expires_at>$2)+(SELECT count(*) FROM presentation_question_suggestions_jobs WHERE workspace_id=$1 AND status IN('pending','processing') AND expires_at>$2))::integer AS count",
            [input.workspaceId, now],
          )
        ).rows[0].count,
      );
      if (count >= PRESENTATION_QUESTION_SUGGESTIONS_MAX_ACTIVE_JOBS)
        throw new PresentationQuestionSuggestionsError("ACTIVE_LIMIT_REACHED");
      const result = await client.query(
        `INSERT INTO presentation_question_suggestions_jobs(id,workspace_id,presentation_id,created_by,request_hash,source_digest,block_id,output_language,source_revision,source_snapshot,status,attempts,available_at,created_at,updated_at,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'pending',0,$11,$11,$11,$12) RETURNING *`,
        [
          row.job.id,
          row.workspaceId,
          row.job.presentationId,
          row.createdBy,
          row.requestHash,
          row.job.sourceDigest,
          row.job.blockId,
          row.job.outputLanguage,
          row.job.sourceRevision,
          JSON.stringify(row.source),
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
  async get(input: PresentationQuestionSuggestionsContext & { jobId: string }) {
    input = contextIds(input);
    return this.tx(input.workspaceId, async (client) => {
      // No private source/proposal bodies are read until relevant identities and authority are locked.
      const metadata = (
        await client.query<{ created_by: string | null }>(
          "SELECT created_by FROM presentation_question_suggestions_jobs WHERE workspace_id=$1 AND presentation_id=$2 AND id=$3",
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
          "SELECT * FROM presentation_question_suggestions_jobs WHERE workspace_id=$1 AND presentation_id=$2 AND id=$3 FOR UPDATE",
          [input.workspaceId, input.presentationId, input.jobId],
        )
      ).rows[0];
      return found ? this.scrubRead(client, found, permitted, input.now ?? new Date()) : null;
    });
  }
  async list(input: PresentationQuestionSuggestionsContext & { limit?: number }) {
    input = contextIds(input);
    return this.tx(input.workspaceId, async (client) => {
      const metadata = await client.query<{ id: string; created_by: string | null }>(
        "SELECT id,created_by FROM presentation_question_suggestions_jobs WHERE workspace_id=$1 AND presentation_id=$2 ORDER BY created_at DESC,id LIMIT $3",
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
        "SELECT * FROM presentation_question_suggestions_jobs WHERE workspace_id=$1 AND presentation_id=$2 AND id=ANY($3::uuid[]) ORDER BY created_at DESC,id FOR UPDATE",
        [input.workspaceId, input.presentationId, metadata.rows.map((row) => row.id)],
      );
      const jobs: PresentationQuestionSuggestionsJob[] = [],
        now = input.now ?? new Date();
      for (const found of result.rows)
        jobs.push(await this.scrubRead(client, found, permitted, now));
      return jobs;
    });
  }
  async usage(input: PresentationQuestionSuggestionsContext & { since: Date }) {
    input = contextIds(input);
    return this.tx(input.workspaceId, async (client) => {
      if (!(await this.eligible(client, input)))
        throw new PresentationQuestionSuggestionsError("NOT_FOUND");
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
        "SELECT id,workspace_id,presentation_id,created_by FROM presentation_question_suggestions_jobs WHERE status IN('pending','processing') AND available_at<=$1 AND (lease_until IS NULL OR lease_until<=$1) AND expires_at>$1 ORDER BY created_at,id LIMIT 50",
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
            "SELECT * FROM presentation_question_suggestions_jobs WHERE id=$1 FOR UPDATE SKIP LOCKED",
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
        if (row.job.attempts >= PRESENTATION_QUESTION_SUGGESTIONS_MAX_ATTEMPTS) {
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
  private async finish(input: PresentationQuestionSuggestionsFence, mutate: (row: Row) => void) {
    input = fenceIds(input);
    return this.tx(null, async (client) => {
      const candidate = (
        await client.query(
          "SELECT workspace_id,presentation_id,created_by FROM presentation_question_suggestions_jobs WHERE id=$1",
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
          "SELECT * FROM presentation_question_suggestions_jobs WHERE id=$1 FOR UPDATE",
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
  complete(input: Parameters<PresentationQuestionSuggestionsRepository["complete"]>[0]) {
    return this.finish(input, (row) => completeRow(row, input));
  }
  fail(input: Parameters<PresentationQuestionSuggestionsRepository["fail"]>[0]) {
    return this.finish(input, (row) => failRow(row, input));
  }
  async purgeExpired(now: Date) {
    return this.tx(null, async (client) =>
      (
        await client.query("SELECT id FROM erase_expired_presentation_question_suggestions($1)", [
          now,
        ])
      ).rows.map((row) => String(row.id)),
    );
  }
}
export function createPresentationQuestionSuggestionsRepository(
  repository: Repository,
): PresentationQuestionSuggestionsRepository {
  if (repository instanceof PostgresRepository)
    return new PostgresPresentationQuestionSuggestionsRepository(repository);
  if (repository instanceof MemoryRepository)
    return repository.getOrCreateLifecycleExtension(
      "presentation-question-suggestions",
      () => new MemoryPresentationQuestionSuggestionsRepository(repository),
    );
  throw new PresentationQuestionSuggestionsError("NOT_FOUND");
}

/** Synchronous fence after exact receipt recovery, inside the deck mutation turn. */
export function assertMemoryPresentationQuestionSuggestionsReady(
  repository: MemoryRepository,
  workspaceId: string,
  presentationId: string,
  jobId: string,
  proposalHash: string,
  sourceDigest: string,
  blockId: string,
  suggestionId: string,
  draft: PresentationDraft,
  nextDraft: PresentationDraft,
  mutationId: string,
): void {
  repository
    .getOrCreateLifecycleExtension(
      "presentation-question-suggestions",
      () => new MemoryPresentationQuestionSuggestionsRepository(repository),
    )
    .assertReady(
      workspaceId,
      presentationId,
      jobId,
      proposalHash,
      sourceDigest,
      blockId,
      suggestionId,
      draft,
      nextDraft,
      mutationId,
    );
}
