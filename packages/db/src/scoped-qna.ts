import type {
  ScopedQnaInsightsCounts,
  ScopedQnaInsightsContext,
} from "./presentation-insights-types.js";
import { createHash, randomUUID } from "node:crypto";
import type { PoolClient, QueryResultRow } from "pg";
import {
  ScopedAudienceEventSchema,
  ScopedQnaCommandSchema,
  ScopedQnaReceiptSchema,
  qnaDefaults,
  qnaDisplayName,
  qnaInitialStatus,
  qnaIsPublic,
  qnaQuestionVisible,
  type ScopedQnaPage,
  type QnaSettings,
  type ScopedQnaCommand,
  type ScopedQnaReceipt,
} from "@openround/contracts";
import {
  MemoryRepository,
  type MemoryRepositoryLifecycleExtension,
  type MemoryRepositoryLifecycleContext,
} from "./memory.js";
import { PostgresRepository } from "./postgres.js";
import { createPresentationSessionRepository } from "./presentation-sessions.js";
import {
  createAudienceScopeRepository,
  type MemoryAudienceScopeRepository,
} from "./audience-scopes.js";
import type { Repository } from "./types.js";

export class ScopedQnaError extends Error {
  constructor(
    public readonly code:
      | "UNAUTHORIZED"
      | "NOT_FOUND"
      | "ROOM_CLOSED"
      | "CONFLICT"
      | "QNA_DISABLED"
      | "MODERATION_REQUIRED"
      | "QNA_RATE_LIMITED",
    message: string,
  ) {
    super(message);
  }
}
type Actor = { id: string; role: "participant" | "host" | "companion"; alias: string };
type Question = {
  id: string;
  participantId: string;
  alias: string;
  body: string;
  status: "pending" | "published" | "answered" | "dismissed" | "removed";
  label: string | null;
  createdAt: Date;
  updatedAt: Date;
};
type Receipt = { requestHash: string; receipt: ScopedQnaReceipt };
type Rate = { startedAt: Date; count: number };
type Context = { workspaceId: string; scopeId: string; tokenHash: string; now: Date };
type PageOptions = { limit: number; cursor?: string };
type Mutation = { receipt: ScopedQnaReceipt; duplicate: boolean };
export interface ScopedQnaRepository {
  /** Creator reporting read; returns public-state counts, never question content or principals. */
  getInsightsCounts(input: ScopedQnaInsightsContext): Promise<ScopedQnaInsightsCounts | null>;
  getInsightsSequence(input: ScopedQnaInsightsContext): Promise<number | null>;
  page(input: Context & PageOptions): Promise<ScopedQnaPage>;
  mutate(input: Context & { command: ScopedQnaCommand }): Promise<Mutation>;
}

function parseContext(input: Context) {
  if (!/^[a-f0-9]{64}$/.test(input.tokenHash))
    throw new ScopedQnaError("UNAUTHORIZED", "A valid room credential is required");
}
function defaultSettings(segment: "education" | "workplace"): QnaSettings {
  return { ...qnaDefaults(segment), participantReplies: false };
}
function commandHash(command: ScopedQnaCommand) {
  return createHash("sha256").update(JSON.stringify(command)).digest("hex");
}
function retry(receipt: Receipt | undefined, requestHash: string): Mutation | null {
  if (!receipt) return null;
  if (receipt.requestHash !== requestHash)
    throw new ScopedQnaError(
      "CONFLICT",
      "This idempotency key was already used for a different Q&A action",
    );
  return { receipt: structuredClone(receipt.receipt), duplicate: true };
}
function checkCommand(
  actor: Actor,
  settings: QnaSettings,
  seq: number,
  command: ScopedQnaCommand,
  question: Question | undefined,
  banned: boolean,
) {
  const moderator = actor.role === "host";
  if (command.type === "settings.update" || command.type === "question.moderate") {
    if (!moderator)
      throw new ScopedQnaError(
        "UNAUTHORIZED",
        "Only the Presentation host can manage Q&A; Companion access is read-only",
      );
    if (command.expectedAudienceSeq !== seq)
      throw new ScopedQnaError("CONFLICT", "Q&A changed. Refresh the audience view and try again");
  } else {
    if (actor.role !== "participant")
      throw new ScopedQnaError("UNAUTHORIZED", "Only participants can submit or vote on questions");
    if (!settings.enabled)
      throw new ScopedQnaError("QNA_DISABLED", "Q&A is disabled for this Presentation");
    if (banned) throw new ScopedQnaError("UNAUTHORIZED", "Your Q&A access has been revoked");
  }
  if (command.type === "vote.set" || command.type === "question.moderate") {
    if (!question) throw new ScopedQnaError("NOT_FOUND", "Q&A question not found in this room");
    if (command.type === "vote.set" && !qnaIsPublic(question.status))
      throw new ScopedQnaError("MODERATION_REQUIRED", "This question is not available for voting");
    if (
      command.type === "question.moderate" &&
      question.status === "removed" &&
      command.status !== "removed"
    )
      throw new ScopedQnaError("CONFLICT", "Removed questions cannot be republished");
  }
}
function nextRate(current: Rate | undefined, action: ScopedQnaCommand["type"], now: Date): Rate {
  const maximum = action === "question.create" ? 5 : action === "vote.set" ? 30 : 120;
  const next =
    !current || now.getTime() - current.startedAt.getTime() >= 60_000
      ? { startedAt: now, count: 1 }
      : { ...current, count: current.count + 1 };
  if (next.count > maximum)
    throw new ScopedQnaError(
      "QNA_RATE_LIMITED",
      "Too many Q&A actions. Wait a minute before trying again",
    );
  return next;
}
function cursor(question: Question) {
  return Buffer.from(JSON.stringify([question.createdAt.toISOString(), question.id])).toString(
    "base64url",
  );
}
// PostgreSQL's inclusive timestamp lower bound (Julian day zero). JavaScript's
// finite Date upper bound is already below PostgreSQL's timestamp upper bound.
// https://github.com/postgres/postgres/blob/REL_18_STABLE/src/include/datatype/timestamp.h
const MIN_CURSOR_TIMESTAMP = Date.parse("-004713-11-24T00:00:00.000Z");
function cursorTimestamp(date: Date): string {
  // Use UTC explicitly: the driver's local-time Date formatter drops historic
  // offset seconds. PostgreSQL also requires BC notation rather than ISO years <= 0.
  const year = date.getUTCFullYear();
  return `${String(year > 0 ? year : 1 - year).padStart(4, "0")}${date.toISOString().slice(-20)}${year > 0 ? "" : " BC"}`;
}
function decodeCursor(value?: string): { date: Date; id: string } | null {
  if (!value) return null;
  try {
    if (value.length > 256) throw new Error();
    const parsed: unknown = JSON.parse(Buffer.from(value, "base64url").toString());
    if (
      !Array.isArray(parsed) ||
      parsed.length !== 2 ||
      typeof parsed[0] !== "string" ||
      typeof parsed[1] !== "string" ||
      !ScopedQnaReceiptSchema.shape.resourceId.safeParse(parsed[1]).success
    )
      throw new Error();
    const date = new Date(parsed[0]);
    if (!Number.isFinite(date.getTime()) || date.getTime() < MIN_CURSOR_TIMESTAMP)
      throw new Error();
    return { date, id: parsed[1] };
  } catch {
    throw new ScopedQnaError("CONFLICT", "The Q&A pagination cursor is invalid; refresh the list");
  }
}
function pageView(
  actor: Actor,
  settings: QnaSettings,
  questions: Array<Question & { voteCount: number; votedByMe: boolean }>,
  seq: number,
  limit: number,
  lifecycle: "open" | "closed",
): ScopedQnaPage {
  return {
    schemaVersion: 1,
    lifecycle,
    audienceSeq: seq,
    settings,
    nextCursor: questions.length > limit ? cursor(questions[limit - 1]!) : null,
    questions: questions.slice(0, limit).map((q) => ({
      id: q.id,
      body: q.status === "removed" ? "" : q.body,
      status: q.status,
      label: q.label,
      author: {
        displayName: qnaDisplayName({
          alias: q.alias,
          moderator: actor.role === "host",
          mine: actor.role === "participant" && actor.id === q.participantId,
          displayMode: settings.displayMode,
        }),
        mine: actor.role === "participant" && actor.id === q.participantId,
      },
      voteCount: q.voteCount,
      votedByMe: q.votedByMe,
      createdAt: q.createdAt.toISOString(),
      replies: [],
      // Banning uses the question resource, not an exposed author identifier.
    })),
  };
}
function validatePage(options: PageOptions) {
  if (!Number.isInteger(options.limit) || options.limit < 1 || options.limit > 50)
    throw new ScopedQnaError("CONFLICT", "Choose a page size between 1 and 50");
  return decodeCursor(options.cursor);
}

type MemoryState = {
  workspaceId: string;
  expiresAt: Date;
  settings: QnaSettings;
  questions: Map<string, Question>;
  votes: Map<string, Set<string>>;
  bans: Set<string>;
  receipts: Map<string, Receipt>;
  rates: Map<string, Rate>;
  audit: Array<{ credentialId: string; action: string; resourceId: string; occurredAt: Date }>;
};
class MemoryScopedQnaRepository implements ScopedQnaRepository, MemoryRepositoryLifecycleExtension {
  private readonly states = new Map<string, MemoryState>();
  private readonly sessions;
  private readonly scopes: MemoryAudienceScopeRepository;
  constructor(private readonly repository: MemoryRepository) {
    this.sessions = createPresentationSessionRepository(repository);
    this.scopes = createAudienceScopeRepository(repository) as MemoryAudienceScopeRepository;
  }
  private context(input: Context) {
    parseContext(input);
    const session = this.sessions.getSessionForWorkspaceSync(input.workspaceId, input.scopeId);
    const scope = this.scopes.getSync(input.workspaceId, input.scopeId);
    if (!session || !scope || scope.expiresAt <= input.now)
      throw new ScopedQnaError("NOT_FOUND", "Audience scope not found");
    if (session.liveExpiresAt <= input.now)
      throw new ScopedQnaError("UNAUTHORIZED", "Presentation access has expired");
    const actor = this.sessions.findAudienceActorSync(input.scopeId, input.tokenHash, input.now);
    if (!actor) throw new ScopedQnaError("UNAUTHORIZED", "Room credential is invalid or revoked");
    const segment =
      [...this.repository.users.values()].find((user) => user.workspaceId === input.workspaceId)
        ?.segment ?? "workplace";
    return {
      session,
      scope,
      actor,
      settings: this.states.get(input.scopeId)?.settings ?? defaultSettings(segment),
    };
  }
  async getInsightsCounts(
    input: ScopedQnaInsightsContext,
  ): Promise<ScopedQnaInsightsCounts | null> {
    const now = input.now ?? new Date();
    if (await this.repository.workspaceDeletionStarted(input.workspaceId)) return null;
    const session = this.sessions.getSessionForWorkspaceSync(input.workspaceId, input.scopeId);
    if (!session || session.retentionExpiresAt <= now) return null;
    const scope = this.scopes.getSync(input.workspaceId, input.scopeId);
    const state = this.states.get(input.scopeId);
    const status = !scope
      ? "not_enabled"
      : scope.expiresAt <= now
        ? "unavailable"
        : state?.settings.enabled === false
          ? "not_enabled"
          : "available";
    const questions =
      status === "available"
        ? [...(state?.questions.values() ?? [])].filter((q) => qnaIsPublic(q.status))
        : [];
    return {
      status,
      audienceSeq: scope?.audienceSeq ?? null,
      asOf: now,
      publicQuestionCount: questions.length,
      answeredQuestionCount: questions.filter((q) => q.status === "answered").length,
      unansweredQuestionCount: questions.filter((q) => q.status === "published").length,
      upvoteCount: questions.reduce((total, q) => total + (state?.votes.get(q.id)?.size ?? 0), 0),
    };
  }
  async getInsightsSequence(input: ScopedQnaInsightsContext) {
    if (await this.repository.workspaceDeletionStarted(input.workspaceId)) return null;
    const now = input.now ?? new Date(),
      session = this.sessions.getSessionForWorkspaceSync(input.workspaceId, input.scopeId),
      scope = this.scopes.getSync(input.workspaceId, input.scopeId);
    return session && session.retentionExpiresAt > now && scope && scope.expiresAt > now
      ? scope.audienceSeq
      : null;
  }
  async page(input: Context & PageOptions) {
    const after = validatePage(input);
    const { actor, scope, settings, session } = this.context(input);
    const state = this.states.get(input.scopeId);
    const questions = [...(state?.questions.values() ?? [])]
      .filter((q) =>
        qnaQuestionVisible(
          q.status,
          actor.role === "host",
          actor.role === "participant" && actor.id === q.participantId,
        ),
      )
      .filter(
        (q) =>
          !after ||
          q.createdAt < after.date ||
          (q.createdAt.getTime() === after.date.getTime() && q.id < after.id),
      )
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id.localeCompare(a.id))
      .slice(0, input.limit + 1)
      .map((q) => ({
        ...q,
        voteCount: state?.votes.get(q.id)?.size ?? 0,
        votedByMe: actor.role === "participant" && Boolean(state?.votes.get(q.id)?.has(actor.id)),
      }));
    return structuredClone(
      pageView(
        actor,
        settings,
        questions,
        scope.audienceSeq,
        input.limit,
        session.status === "active" ? "open" : "closed",
      ),
    );
  }
  async mutate(input: Context & { command: ScopedQnaCommand }) {
    // No awaits: lifecycle, revocation, receipt, state and outbox commit in one memory turn.
    const command = ScopedQnaCommandSchema.parse(input.command);
    const { session, actor, scope, settings } = this.context(input);
    const existing = this.states.get(input.scopeId);
    const receiptKey = `${actor.id}:${command.idempotencyKey}`;
    const requestHash = commandHash(command);
    const accepted = retry(existing?.receipts.get(receiptKey), requestHash);
    if (accepted) return accepted;
    this.repository.assertWorkspaceLiveSessionCreationAllowed(input.workspaceId);
    if (session.status !== "active")
      throw new ScopedQnaError("ROOM_CLOSED", "This Presentation is finished; Q&A is read-only");
    const question =
      "questionId" in command ? existing?.questions.get(command.questionId) : undefined;
    checkCommand(
      actor,
      settings,
      scope.audienceSeq,
      command,
      question,
      Boolean(existing?.bans.has(actor.id)),
    );
    const rateKey = `${actor.id}:${command.type}`;
    const rate = nextRate(existing?.rates.get(rateKey), command.type, input.now);
    if (
      command.type === "question.create" &&
      ((existing?.questions.size ?? 0) >= 2_000 ||
        [...(existing?.questions.values() ?? [])].filter((q) => q.participantId === actor.id)
          .length >= 200)
    )
      throw new ScopedQnaError(
        "QNA_RATE_LIMITED",
        "The Q&A capacity for this room has been reached",
      );
    const resourceId =
      command.type === "settings.update"
        ? input.scopeId
        : command.type === "question.create"
          ? randomUUID()
          : command.questionId;
    const seq = this.scopes.appendQnaEventSync(input.workspaceId, input.scopeId, input.now);
    const state: MemoryState = existing ?? {
      workspaceId: input.workspaceId,
      expiresAt: scope.expiresAt,
      settings,
      questions: new Map(),
      votes: new Map(),
      bans: new Set(),
      receipts: new Map(),
      rates: new Map(),
      audit: [],
    };
    if (command.type === "settings.update") state.settings = structuredClone(command.settings);
    if (command.type === "question.create")
      state.questions.set(resourceId, {
        id: resourceId,
        participantId: actor.id,
        alias: actor.alias,
        body: command.body,
        status: qnaInitialStatus(settings.moderationMode),
        label: null,
        createdAt: input.now,
        updatedAt: input.now,
      });
    if (command.type === "question.moderate") {
      state.questions.set(resourceId, {
        ...question!,
        status: command.status,
        label: command.label,
        updatedAt: input.now,
      });
      if (command.banAuthor) state.bans.add(question!.participantId);
    }
    if (command.type === "vote.set") {
      const votes = state.votes.get(resourceId) ?? new Set();
      if (command.voted) votes.add(actor.id);
      else votes.delete(actor.id);
      state.votes.set(resourceId, votes);
    }
    if (command.type === "settings.update" || command.type === "question.moderate")
      state.audit.push({
        credentialId: actor.id,
        action: command.type,
        resourceId,
        occurredAt: input.now,
      });
    const receipt: ScopedQnaReceipt = {
      schemaVersion: 1,
      idempotencyKey: command.idempotencyKey,
      resourceId,
      audienceSeq: seq,
    };
    state.rates.set(rateKey, rate);
    state.receipts.set(receiptKey, { requestHash, receipt });
    this.states.set(input.scopeId, state);
    return { receipt: structuredClone(receipt), duplicate: false };
  }
  deletePresentationSessionMetadata(workspaceId: string, sessionId: string) {
    if (this.states.get(sessionId)?.workspaceId === workspaceId) this.states.delete(sessionId);
  }
  exportAccount({ ownedWorkspaceIds }: MemoryRepositoryLifecycleContext) {
    return structuredClone({
      scopedQna: [...this.states.entries()]
        .filter(([, state]) => ownedWorkspaceIds.has(state.workspaceId))
        .map(([scopeId, state]) => ({
          scopeId,
          settings: state.settings,
          questions: [...state.questions.values()].map((q) => ({
            ...q,
            body: q.status === "removed" ? "" : q.body,
          })),
          audit: state.audit,
          votes: [...state.votes.entries()].map(([questionId, participantIds]) => ({
            questionId,
            participantIds: [...participantIds],
          })),
          bans: [...state.bans],
        })),
    });
  }
  deleteAccount({ ownedWorkspaceIds }: MemoryRepositoryLifecycleContext) {
    for (const [id, state] of this.states)
      if (ownedWorkspaceIds.has(state.workspaceId)) this.states.delete(id);
  }
  purgeExpired(now: Date) {
    for (const [id, state] of this.states) if (state.expiresAt <= now) this.states.delete(id);
    return [];
  }
}

function mapQuestion(row: QueryResultRow): Question {
  return {
    id: row.id,
    participantId: row.participant_id,
    alias: row.public_alias,
    body: row.body,
    status: row.status,
    label: row.label,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}
class PostgresScopedQnaRepository implements ScopedQnaRepository {
  constructor(private readonly repository: PostgresRepository) {}
  private async transaction<T>(
    input: Context,
    mutation: boolean,
    work: (
      client: PoolClient,
      actor: Actor,
      seq: number,
      settings: QnaSettings,
      status: string,
    ) => Promise<T>,
  ) {
    parseContext(input);
    const client = await this.repository.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.workspace_id', $1, true)", [input.workspaceId]);
      // Match the parent workspace -> session lock order. Lock scope second, never game state.
      const workspace = await client.query(
        "SELECT segment, deletion_started_at FROM workspaces WHERE id = $1 FOR SHARE",
        [input.workspaceId],
      );
      const parent = await client.query(
        "SELECT status, live_expires_at FROM presentation_live_sessions WHERE workspace_id = $1 AND id = $2 FOR SHARE",
        [input.workspaceId, input.scopeId],
      );
      const scope = await client.query(
        `SELECT audience_seq FROM audience_scopes WHERE workspace_id = $1 AND id = $2 AND expires_at > $3 FOR ${mutation ? "UPDATE" : "SHARE"}`,
        [input.workspaceId, input.scopeId, input.now],
      );
      if (!workspace.rows[0] || !parent.rows[0] || !scope.rows[0])
        throw new ScopedQnaError("NOT_FOUND", "Audience scope not found");
      if (new Date(parent.rows[0].live_expires_at) <= input.now)
        throw new ScopedQnaError("UNAUTHORIZED", "Presentation access has expired");
      const participant = await client.query(
        "SELECT id, nickname FROM presentation_live_participants WHERE workspace_id = $1 AND session_id = $2 AND token_hash = $3 FOR SHARE",
        [input.workspaceId, input.scopeId, input.tokenHash],
      );
      let actor: Actor;
      if (participant.rows[0])
        actor = {
          id: participant.rows[0].id,
          role: "participant",
          alias: participant.rows[0].nickname,
        };
      else {
        const credential = await client.query(
          "SELECT id, role FROM presentation_session_credentials WHERE workspace_id = $1 AND session_id = $2 AND token_hash = $3 AND role IN ('host', 'companion') AND revoked_at IS NULL AND expires_at > $4 FOR SHARE",
          [input.workspaceId, input.scopeId, input.tokenHash, input.now],
        );
        if (!credential.rows[0])
          throw new ScopedQnaError("UNAUTHORIZED", "Room credential is invalid or revoked");
        actor = { id: credential.rows[0].id, role: credential.rows[0].role, alias: "Facilitator" };
      }
      const stored = await client.query(
        "SELECT * FROM scoped_qna_settings WHERE workspace_id = $1 AND scope_id = $2",
        [input.workspaceId, input.scopeId],
      );
      const row = stored.rows[0];
      const settings: QnaSettings = row
        ? {
            enabled: row.enabled,
            displayMode: row.display_mode,
            moderationMode: row.moderation_mode,
            participantReplies: false,
          }
        : defaultSettings(workspace.rows[0].segment);
      // Receipts are checked by work before the deletion/lifecycle writer fence.
      const result = await work(
        client,
        actor,
        Number(scope.rows[0].audience_seq),
        settings,
        workspace.rows[0].deletion_started_at ? "deleting" : parent.rows[0].status,
      );
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  private async insightsRead(
    input: ScopedQnaInsightsContext,
    counts: boolean,
  ): Promise<ScopedQnaInsightsCounts | null> {
    const client = await this.repository.pool.connect();
    try {
      await client.query("BEGIN READ ONLY");
      await client.query("SELECT set_config('app.workspace_id',$1,true)", [input.workspaceId]);
      const result = await client.query(
        `SELECT GREATEST($3::timestamptz,clock_timestamp()) AS as_of, scope.audience_seq, scope.expires_at AS scope_expires_at, COALESCE(settings.enabled,true) AS enabled,
      ${
        counts
          ? `(SELECT count(*)::integer FROM scoped_qna_questions q WHERE q.workspace_id=session.workspace_id AND q.scope_id=session.id AND q.status IN ('published','answered')) AS questions,
      (SELECT count(*)::integer FROM scoped_qna_questions q WHERE q.workspace_id=session.workspace_id AND q.scope_id=session.id AND q.status='answered') AS answered,
      (SELECT count(*)::integer FROM scoped_qna_votes vote JOIN scoped_qna_questions q ON q.workspace_id=vote.workspace_id AND q.scope_id=vote.scope_id AND q.id=vote.question_id WHERE vote.workspace_id=session.workspace_id AND vote.scope_id=session.id AND q.status IN ('published','answered')) AS votes`
          : "0 AS questions,0 AS answered,0 AS votes"
      }
      FROM presentation_live_sessions session JOIN workspaces workspace ON workspace.id=session.workspace_id LEFT JOIN audience_scopes scope ON scope.workspace_id=session.workspace_id AND scope.id=session.id LEFT JOIN scoped_qna_settings settings ON settings.workspace_id=session.workspace_id AND settings.scope_id=session.id
      WHERE session.workspace_id=$1 AND session.id=$2 AND session.retention_expires_at>GREATEST($3::timestamptz,clock_timestamp()) AND workspace.deletion_started_at IS NULL`,
        [input.workspaceId, input.scopeId, input.now ?? new Date()],
      );
      await client.query("COMMIT");
      const row = result.rows[0];
      if (!row) return null;
      const asOf = new Date(row.as_of),
        available =
          row.audience_seq != null && new Date(row.scope_expires_at) > asOf && row.enabled;
      return {
        status:
          row.audience_seq == null || !row.enabled
            ? "not_enabled"
            : available
              ? "available"
              : "unavailable",
        audienceSeq: row.audience_seq == null ? null : Number(row.audience_seq),
        asOf,
        publicQuestionCount: available ? Number(row.questions) : 0,
        answeredQuestionCount: available ? Number(row.answered) : 0,
        unansweredQuestionCount: available ? Number(row.questions) - Number(row.answered) : 0,
        upvoteCount: available ? Number(row.votes) : 0,
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  async getInsightsCounts(input: ScopedQnaInsightsContext) {
    return this.insightsRead(input, true);
  }
  async getInsightsSequence(input: ScopedQnaInsightsContext) {
    const value = await this.insightsRead(input, false);
    return value && value.status !== "unavailable" ? value.audienceSeq : null;
  }
  async page(input: Context & PageOptions) {
    const after = validatePage(input);
    return this.transaction(input, false, async (client, actor, seq, settings, status) => {
      const rows = await client.query(
        `SELECT question.*,
        (SELECT count(*)::integer FROM scoped_qna_votes vote WHERE vote.workspace_id = question.workspace_id AND vote.scope_id = question.scope_id AND vote.question_id = question.id) AS vote_count,
        EXISTS(SELECT 1 FROM scoped_qna_votes vote WHERE vote.workspace_id = question.workspace_id AND vote.scope_id = question.scope_id AND vote.question_id = question.id AND vote.participant_id = $3) AS voted_by_me
        FROM scoped_qna_questions question WHERE workspace_id = $1 AND scope_id = $2
        AND ($4::boolean OR status IN ('published', 'answered') OR participant_id = $3)
        AND ($5::timestamptz IS NULL OR (created_at, id) < ($5::timestamptz, $6::uuid))
        ORDER BY created_at DESC, id DESC LIMIT $7`,
        [
          input.workspaceId,
          input.scopeId,
          actor.role === "participant" ? actor.id : null,
          actor.role === "host",
          after ? cursorTimestamp(after.date) : null,
          after?.id ?? null,
          input.limit + 1,
        ],
      );
      return pageView(
        actor,
        settings,
        rows.rows.map((q) => ({
          ...mapQuestion(q),
          voteCount: q.vote_count,
          votedByMe: q.voted_by_me,
        })),
        seq,
        input.limit,
        status === "active" ? "open" : "closed",
      );
    });
  }
  async mutate(input: Context & { command: ScopedQnaCommand }) {
    const command = ScopedQnaCommandSchema.parse(input.command);
    return this.transaction(input, true, async (client, actor, seq, settings, status) => {
      const requestHash = commandHash(command);
      const stored = await client.query(
        "SELECT request_hash, receipt FROM scoped_qna_receipts WHERE workspace_id = $1 AND scope_id = $2 AND actor_id = $3 AND idempotency_key = $4",
        [input.workspaceId, input.scopeId, actor.id, command.idempotencyKey],
      );
      const accepted = retry(
        stored.rows[0]
          ? {
              requestHash: stored.rows[0].request_hash,
              receipt: ScopedQnaReceiptSchema.parse(stored.rows[0].receipt),
            }
          : undefined,
        requestHash,
      );
      if (accepted) return accepted;
      if (status !== "active")
        throw new ScopedQnaError("ROOM_CLOSED", "This Presentation is closed; Q&A is read-only");
      const target =
        "questionId" in command
          ? (
              await client.query(
                "SELECT * FROM scoped_qna_questions WHERE workspace_id = $1 AND scope_id = $2 AND id = $3",
                [input.workspaceId, input.scopeId, command.questionId],
              )
            ).rows[0]
          : undefined;
      const banned = await client.query(
        "SELECT 1 FROM scoped_qna_bans WHERE workspace_id = $1 AND scope_id = $2 AND participant_id = $3",
        [input.workspaceId, input.scopeId, actor.id],
      );
      checkCommand(
        actor,
        settings,
        seq,
        command,
        target ? mapQuestion(target) : undefined,
        Boolean(banned.rows[0]),
      );
      const rateRow = (
        await client.query(
          "SELECT * FROM scoped_qna_rate_limits WHERE workspace_id = $1 AND scope_id = $2 AND actor_id = $3 AND action = $4",
          [input.workspaceId, input.scopeId, actor.id, command.type],
        )
      ).rows[0];
      const rate = nextRate(
        rateRow
          ? { startedAt: new Date(rateRow.window_started_at), count: rateRow.action_count }
          : undefined,
        command.type,
        input.now,
      );
      const resourceId =
        command.type === "settings.update"
          ? input.scopeId
          : command.type === "question.create"
            ? randomUUID()
            : command.questionId;
      if (command.type === "settings.update")
        await client.query(
          `INSERT INTO scoped_qna_settings (workspace_id, scope_id, enabled, display_mode, moderation_mode) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (scope_id) DO UPDATE SET enabled = EXCLUDED.enabled, display_mode = EXCLUDED.display_mode, moderation_mode = EXCLUDED.moderation_mode`,
          [
            input.workspaceId,
            input.scopeId,
            command.settings.enabled,
            command.settings.displayMode,
            command.settings.moderationMode,
          ],
        );
      if (command.type === "question.create") {
        const counts = (
          await client.query(
            "SELECT count(*)::integer AS total, count(*) FILTER (WHERE participant_id = $3)::integer AS own FROM scoped_qna_questions WHERE workspace_id = $1 AND scope_id = $2",
            [input.workspaceId, input.scopeId, actor.id],
          )
        ).rows[0]!;
        if (counts.total >= 2_000 || counts.own >= 200)
          throw new ScopedQnaError(
            "QNA_RATE_LIMITED",
            "The Q&A capacity for this room has been reached",
          );
        await client.query(
          "INSERT INTO scoped_qna_questions (id, workspace_id, scope_id, participant_id, body, public_alias, status, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8)",
          [
            resourceId,
            input.workspaceId,
            input.scopeId,
            actor.id,
            command.body,
            actor.alias,
            qnaInitialStatus(settings.moderationMode),
            input.now,
          ],
        );
      }
      if (command.type === "question.moderate") {
        await client.query(
          "UPDATE scoped_qna_questions SET status = $4, label = $5, updated_at = $6 WHERE workspace_id = $1 AND scope_id = $2 AND id = $3",
          [input.workspaceId, input.scopeId, resourceId, command.status, command.label, input.now],
        );
        if (command.banAuthor)
          await client.query(
            "INSERT INTO scoped_qna_bans (workspace_id, scope_id, participant_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING",
            [input.workspaceId, input.scopeId, target!.participant_id],
          );
      }
      if (command.type === "vote.set") {
        if (command.voted)
          await client.query(
            "INSERT INTO scoped_qna_votes (workspace_id, scope_id, question_id, participant_id) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING",
            [input.workspaceId, input.scopeId, resourceId, actor.id],
          );
        else
          await client.query(
            "DELETE FROM scoped_qna_votes WHERE workspace_id = $1 AND scope_id = $2 AND question_id = $3 AND participant_id = $4",
            [input.workspaceId, input.scopeId, resourceId, actor.id],
          );
      }
      if (command.type === "settings.update" || command.type === "question.moderate")
        await client.query(
          "INSERT INTO scoped_qna_audit (id, workspace_id, scope_id, credential_id, action, resource_id, occurred_at) VALUES ($1,$2,$3,$4,$5,$6,$7)",
          [
            randomUUID(),
            input.workspaceId,
            input.scopeId,
            actor.id,
            command.type,
            resourceId,
            input.now,
          ],
        );
      await client.query(
        "INSERT INTO scoped_qna_rate_limits (workspace_id, scope_id, actor_id, action, window_started_at, action_count) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (scope_id, actor_id, action) DO UPDATE SET window_started_at = EXCLUDED.window_started_at, action_count = EXCLUDED.action_count",
        [input.workspaceId, input.scopeId, actor.id, command.type, rate.startedAt, rate.count],
      );
      const event = ScopedAudienceEventSchema.parse({
        schemaVersion: 1,
        eventId: randomUUID(),
        scopeId: input.scopeId,
        audienceSeq: seq + 1,
        serverTime: input.now.toISOString(),
        type: "audience.qna.updated",
        payload: { kind: "presentation" },
      });
      await client.query(
        "UPDATE audience_scopes SET audience_seq = $3 WHERE workspace_id = $1 AND id = $2",
        [input.workspaceId, input.scopeId, event.audienceSeq],
      );
      await client.query(
        "INSERT INTO scoped_audience_outbox (event_id, workspace_id, scope_id, audience_seq, schema_version, event_type, payload, created_at) VALUES ($1,$2,$3,$4,1,$5,$6,$7)",
        [
          event.eventId,
          input.workspaceId,
          input.scopeId,
          event.audienceSeq,
          event.type,
          event.payload,
          input.now,
        ],
      );
      const receipt: ScopedQnaReceipt = {
        schemaVersion: 1,
        idempotencyKey: command.idempotencyKey,
        resourceId,
        audienceSeq: event.audienceSeq,
      };
      await client.query(
        "INSERT INTO scoped_qna_receipts (workspace_id, scope_id, actor_id, idempotency_key, request_hash, receipt) VALUES ($1,$2,$3,$4,$5,$6)",
        [input.workspaceId, input.scopeId, actor.id, command.idempotencyKey, requestHash, receipt],
      );
      return { receipt, duplicate: false };
    });
  }
}
export function createScopedQnaRepository(repository: Repository): ScopedQnaRepository {
  if (repository instanceof PostgresRepository) return new PostgresScopedQnaRepository(repository);
  if (repository instanceof MemoryRepository)
    return repository.getOrCreateLifecycleExtension(
      "scoped-qna",
      () => new MemoryScopedQnaRepository(repository),
    );
  throw new Error("Scoped Q&A requires a lifecycle-aware repository");
}
