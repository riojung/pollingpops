import type { PoolClient, QueryResultRow } from "pg";
import type { PresentationReviewFeedbackMutation } from "@openround/contracts";
import type { PostgresRepository } from "./postgres.js";
import type {
  PresentationReviewAuthorContext,
  PresentationReviewReviewerContext,
  PresentationReviewFeedbackRepository,
} from "./presentation-review-feedback-types.js";
import {
  applyReview,
  emptyReview,
  reviewCapacity,
  reviewEnableRequest,
  reviewError,
  reviewHash,
  reviewId,
  reviewProjection,
  reviewReplay,
  reviewRequest,
  reviewViewerKey,
  type ReviewCycle,
  type ReviewMessage,
  type ReviewThread,
  type ReviewReceipt,
  type ReviewRole,
  type ReviewSource,
} from "./presentation-review-feedback-state.js";
const stamp = (value: unknown) =>
  (value instanceof Date ? value : new Date(String(value))).toISOString();
type Context = {
  shareId: string;
  actorId?: string;
  tokenHash?: string;
  workspaceId?: string;
  presentationId?: string;
  now: Date;
};
export class PostgresPresentationReviewFeedbackRepository implements PresentationReviewFeedbackRepository {
  constructor(private parent: PostgresRepository) {}
  private async transaction<T>(work: (client: PoolClient) => Promise<T>) {
    const client = await this.parent.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL statement_timeout='2500ms'");
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
  private async writer(client: PoolClient, workspaceId: string, actorId: string) {
    return (
      (
        await client.query(
          "SELECT member.user_id FROM workspace_members member JOIN users actor ON actor.id=member.user_id WHERE member.workspace_id=$1 AND member.user_id=$2 AND member.role IN('owner','editor') AND actor.deleted_at IS NULL FOR SHARE OF member,actor",
          [workspaceId, actorId],
        )
      ).rowCount !== 0
    );
  }
  private async source(
    client: PoolClient,
    input: Context,
    role?: ReviewRole,
  ): Promise<ReviewSource> {
    if (role && !input.actorId) return reviewError("UNAVAILABLE");
    if (
      !Number.isFinite(input.now.getTime()) ||
      (role !== "author" && !/^[a-f0-9]{64}$/.test(input.tokenHash ?? ""))
    )
      return reviewError("UNAVAILABLE");
    await client.query("SELECT set_config('app.system_access','on',true)");
    const initial = (
      await client.query(
        "SELECT * FROM presentation_shares WHERE id=$1 AND ($2::text IS NULL OR token_hash=$2)",
        [reviewId(input.shareId), role === "author" ? null : input.tokenHash],
      )
    ).rows[0];
    if (!initial) return reviewError("UNAVAILABLE");
    // Account deletion locks identity rows before deleting owned workspaces. Match that order
    // before taking source locks, including anonymous access through the original inviter.
    const actors = [
      ...new Set([initial.actor_id, ...(input.actorId ? [reviewId(input.actorId)] : [])]),
    ].sort();
    const principals = await client.query<{ id: string }>(
      "SELECT id FROM users WHERE id=ANY($1::uuid[]) AND deleted_at IS NULL ORDER BY id FOR SHARE",
      [actors],
    );
    const actorId = input.actorId ? reviewId(input.actorId) : null;
    if (actorId && !principals.rows.some((row) => row.id === actorId))
      return reviewError("UNAVAILABLE");
    await client.query(
      "SELECT set_config('app.workspace_id',$1,true),set_config('app.presentation_review_share_id',$2,true),set_config('app.system_access','',true)",
      [initial.workspace_id, initial.id],
    );
    const workspace = await client.query("SELECT id FROM workspaces WHERE id=$1 FOR SHARE", [
      initial.workspace_id,
    ]);
    if (
      !workspace.rowCount ||
      (
        await client.query("SELECT 1 FROM workspace_media_deletion_jobs WHERE workspace_id=$1", [
          initial.workspace_id,
        ])
      ).rowCount
    )
      return reviewError("UNAVAILABLE");
    await client.query("SELECT set_config('app.system_access','on',true)");
    const inviterActive = await this.writer(client, initial.workspace_id, initial.actor_id);
    if (
      role === "author" &&
      (!input.actorId ||
        input.workspaceId !== initial.workspace_id ||
        reviewId(input.presentationId ?? "") !== initial.presentation_id ||
        !(await this.writer(client, initial.workspace_id, reviewId(input.actorId))))
    )
      return reviewError("UNAVAILABLE");
    await client.query("SELECT set_config('app.system_access','',true)");
    const publication = (
      await client.query(
        "SELECT parent.status,version.version,ARRAY(SELECT block->>'id' FROM jsonb_array_elements(version.content->'blocks') block WHERE block->'hidden' IS DISTINCT FROM 'true'::jsonb) AS block_ids,ARRAY(SELECT (ordinality-1)::integer FROM jsonb_array_elements(version.content->'blocks') WITH ORDINALITY blocks(block,ordinality) WHERE block->'hidden' IS DISTINCT FROM 'true'::jsonb) AS block_indexes FROM presentations parent JOIN presentation_versions version ON version.workspace_id=parent.workspace_id AND version.presentation_id=parent.id WHERE parent.workspace_id=$1 AND parent.id=$2 AND version.id=$3 FOR SHARE OF parent",
        [initial.workspace_id, initial.presentation_id, initial.version_id],
      )
    ).rows[0];
    if (!publication) return reviewError("UNAVAILABLE");
    const current = (
      await client.query(
        "SELECT *,expires_at>clock_timestamp() AS active_now FROM presentation_shares WHERE workspace_id=$1 AND id=$2 FOR UPDATE",
        [initial.workspace_id, initial.id],
      )
    ).rows[0];
    if (!current || (role !== "author" && current.token_hash !== input.tokenHash))
      return reviewError("UNAVAILABLE");
    const active =
      !current.revoked_at &&
      new Date(current.expires_at) > input.now &&
      current.active_now &&
      inviterActive &&
      publication.status !== "archived";
    if (role !== "author" && !active) return reviewError("UNAVAILABLE");
    return {
      active,
      version: Number(publication.version),
      blockIds: publication.block_ids,
      blockIndexes: publication.block_indexes,
      share: {
        id: current.id,
        workspaceId: current.workspace_id,
        presentationId: current.presentation_id,
        versionId: current.version_id,
        actorId: current.actor_id,
        requestId: current.request_id,
        intentHash: current.intent_hash,
        tokenHash: current.token_hash,
        createdAt: new Date(current.created_at),
        expiresAt: new Date(current.expires_at),
        revokedAt: current.revoked_at ? new Date(current.revoked_at) : null,
      },
    };
  }
  private async cycle(client: PoolClient, shareId: string): Promise<ReviewCycle | null> {
    const row = (
      await client.query("SELECT * FROM presentation_review_cycles WHERE share_id=$1 FOR UPDATE", [
        shareId,
      ])
    ).rows[0];
    if (!row) return null;
    const [threads, messages, count] = await Promise.all([
      client.query(
        "SELECT * FROM presentation_review_threads WHERE share_id=$1 ORDER BY created_seq,id LIMIT 100",
        [shareId],
      ),
      client.query(
        "SELECT * FROM presentation_review_messages WHERE share_id=$1 ORDER BY created_seq,id LIMIT 500",
        [shareId],
      ),
      client.query(
        "SELECT count(*)::integer AS count FROM presentation_review_receipts WHERE share_id=$1",
        [shareId],
      ),
    ]);
    return {
      shareId,
      seq: Number(row.review_seq),
      nextOrdinal: row.next_reviewer_ordinal,
      approvedBy: row.approved_by,
      approvedAt: row.approved_at ? stamp(row.approved_at) : null,
      approvedSeq: row.approved_seq == null ? null : Number(row.approved_seq),
      receiptCount: Number(count.rows[0]!.count),
      threads: threads.rows.map((thread: QueryResultRow): ReviewThread => ({
        id: thread.id,
        blockId: thread.block_id,
        version: Number(thread.version),
        resolved: thread.resolved,
        createdAt: stamp(thread.created_at),
        updatedAt: stamp(thread.updated_at),
        createdSeq: Number(thread.created_seq),
      })),
      messages: messages.rows.map((message: QueryResultRow): ReviewMessage => ({
        id: message.id,
        threadId: message.thread_id,
        actorId: message.actor_id,
        role: message.author_role,
        ordinal: message.reviewer_ordinal,
        text: message.body,
        version: Number(message.version),
        deleted: message.deleted,
        createdAt: stamp(message.created_at),
        updatedAt: stamp(message.updated_at),
        createdSeq: Number(message.created_seq),
      })),
    };
  }
  private async receipt(
    client: PoolClient,
    shareId: string,
    actorId: string,
    operationId: string,
  ): Promise<ReviewReceipt | null> {
    const row = (
      await client.query(
        "SELECT * FROM presentation_review_receipts WHERE share_id=$1 AND actor_id=$2 AND operation_id=$3",
        [shareId, actorId, operationId],
      )
    ).rows[0];
    return row ? { actorId, operationId, hash: row.request_hash, receipt: row.receipt } : null;
  }
  private async insertReceipt(
    client: PoolClient,
    source: ReviewSource,
    actorId: string,
    hash: string,
    receipt: ReviewReceipt["receipt"],
  ) {
    await client.query(
      "INSERT INTO presentation_review_receipts(share_id,workspace_id,actor_id,operation_id,request_hash,receipt) VALUES($1,$2,$3,$4,$5,$6::jsonb)",
      [
        source.share.id,
        source.share.workspaceId,
        actorId,
        receipt.operationId,
        hash,
        JSON.stringify(receipt),
      ],
    );
  }
  private async activeFence(client: PoolClient, source: ReviewSource, now: Date) {
    if (
      !(
        await client.query(
          "SELECT 1 FROM presentation_shares WHERE id=$1 AND revoked_at IS NULL AND expires_at>$2 AND expires_at>clock_timestamp()",
          [source.share.id, now],
        )
      ).rowCount
    )
      return reviewError("UNAVAILABLE");
  }
  async getReviewAccess(input: {
    shareId: string;
    tokenHash: string;
    actorId?: string;
    now: Date;
  }) {
    return this.transaction(async (client) => {
      const source = await this.source(client, input),
        enabled = !!(
          await client.query("SELECT 1 FROM presentation_review_cycles WHERE share_id=$1", [
            source.share.id,
          ])
        ).rowCount;
      await this.activeFence(client, source, input.now);
      return {
        workspaceId: source.share.workspaceId,
        access: {
          schemaVersion: 1 as const,
          shareId: source.share.id,
          versionId: source.share.versionId,
          enabled,
          signInRequired: enabled && !input.actorId,
          expiresAt: source.share.expiresAt.toISOString(),
        },
      };
    });
  }
  async getAuthorReview(input: PresentationReviewAuthorContext) {
    return this.transaction(async (client) => {
      const source = await this.source(client, input, "author"),
        cycle = await this.cycle(client, source.share.id);
      return {
        workspaceId: source.share.workspaceId,
        feedback: reviewProjection(source, cycle, reviewId(input.actorId), "author", input.now),
      };
    });
  }
  async getReviewerReview(input: PresentationReviewReviewerContext) {
    return this.transaction(async (client) => {
      const source = await this.source(client, input, "reviewer"),
        cycle = await this.cycle(client, source.share.id);
      await this.activeFence(client, source, input.now);
      return {
        workspaceId: source.share.workspaceId,
        feedback: reviewProjection(source, cycle, reviewId(input.actorId), "reviewer", input.now),
      };
    });
  }
  async enableReview(
    input: PresentationReviewAuthorContext & {
      request: Parameters<PresentationReviewFeedbackRepository["enableReview"]>[0]["request"];
    },
  ) {
    return this.transaction(async (client) => {
      const source = await this.source(client, input, "author"),
        request = reviewEnableRequest(input.request),
        actorId = reviewId(input.actorId);
      if (!source.active || request.versionId !== source.share.versionId)
        return reviewError("UNAVAILABLE");
      const hash = reviewHash(source.share.id, "author", { type: "review.enable", ...request });
      let cycle = await this.cycle(client, source.share.id);
      const previous = reviewReplay(
        await this.receipt(client, source.share.id, actorId, request.operationId),
        hash,
      );
      if (previous && cycle) {
        await this.activeFence(client, source, input.now);
        return {
          workspaceId: source.share.workspaceId,
          result: {
            feedback: reviewProjection(source, cycle, actorId, "author", input.now),
            receipt: previous,
            replayed: true,
          },
        };
      }
      if (!cycle) {
        cycle = emptyReview(source.share.id);
        await client.query(
          "INSERT INTO presentation_review_cycles(share_id,workspace_id,presentation_id,version_id,review_seq,next_reviewer_ordinal) VALUES($1,$2,$3,$4,1,1)",
          [
            source.share.id,
            source.share.workspaceId,
            source.share.presentationId,
            source.share.versionId,
          ],
        );
      }
      reviewCapacity(cycle);
      const receipt = {
        operationId: request.operationId,
        reviewSeq: cycle.seq,
        type: "review.enable" as const,
        threadId: null,
        messageId: null,
      };
      await this.insertReceipt(client, source, actorId, hash, receipt);
      await this.activeFence(client, source, input.now);
      return {
        workspaceId: source.share.workspaceId,
        result: {
          feedback: reviewProjection(source, cycle, actorId, "author", input.now),
          receipt,
          replayed: false,
        },
      };
    });
  }
  private async save(
    client: PoolClient,
    source: ReviewSource,
    before: ReviewCycle,
    cycle: ReviewCycle,
  ) {
    await client.query(
      "UPDATE presentation_review_cycles SET review_seq=$2,next_reviewer_ordinal=$3,approved_by=$4,approved_at=$5,approved_seq=$6 WHERE share_id=$1",
      [
        cycle.shareId,
        cycle.seq,
        cycle.nextOrdinal,
        cycle.approvedBy,
        cycle.approvedAt,
        cycle.approvedSeq,
      ],
    );
    for (const thread of cycle.threads) {
      const prior = before.threads.find((entry) => entry.id === thread.id);
      if (!prior)
        await client.query(
          "INSERT INTO presentation_review_threads(share_id,workspace_id,id,block_id,version,resolved,created_at,updated_at,created_seq,changed_seq) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
          [
            cycle.shareId,
            source.share.workspaceId,
            thread.id,
            thread.blockId,
            thread.version,
            thread.resolved,
            thread.createdAt,
            thread.updatedAt,
            thread.createdSeq,
            cycle.seq,
          ],
        );
      else if (thread.version !== prior.version)
        await client.query(
          "UPDATE presentation_review_threads SET version=$3,resolved=$4,updated_at=$5,changed_seq=$6 WHERE share_id=$1 AND id=$2",
          [cycle.shareId, thread.id, thread.version, thread.resolved, thread.updatedAt, cycle.seq],
        );
    }
    for (const message of cycle.messages) {
      const prior = before.messages.find((entry) => entry.id === message.id);
      if (!prior)
        await client.query(
          "INSERT INTO presentation_review_messages(share_id,workspace_id,id,thread_id,actor_id,author_role,reviewer_ordinal,body,version,deleted,created_at,updated_at,created_seq,changed_seq) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)",
          [
            cycle.shareId,
            source.share.workspaceId,
            message.id,
            message.threadId,
            message.actorId,
            message.role,
            message.ordinal,
            message.text,
            message.version,
            message.deleted,
            message.createdAt,
            message.updatedAt,
            message.createdSeq,
            cycle.seq,
          ],
        );
      else if (message.version !== prior.version)
        await client.query(
          "UPDATE presentation_review_messages SET body=$3,version=$4,deleted=$5,updated_at=$6,changed_seq=$7 WHERE share_id=$1 AND id=$2",
          [
            cycle.shareId,
            message.id,
            message.text,
            message.version,
            message.deleted,
            message.updatedAt,
            cycle.seq,
          ],
        );
    }
  }
  private mutate(
    input: (PresentationReviewAuthorContext | PresentationReviewReviewerContext) & {
      mutation: PresentationReviewFeedbackMutation;
    },
    role: ReviewRole,
  ) {
    return this.transaction(async (client) => {
      const source = await this.source(client, input, role),
        actorId = reviewId(input.actorId),
        mutation = reviewRequest(input.mutation);
      if (
        !source.active ||
        mutation.versionId !== source.share.versionId ||
        mutation.viewerKey !== reviewViewerKey(source.share.id, actorId)
      )
        return reviewError("UNAVAILABLE");
      const before = await this.cycle(client, source.share.id);
      if (!before) return reviewError("UNAVAILABLE");
      const hash = reviewHash(source.share.id, role, mutation),
        previous = reviewReplay(
          await this.receipt(client, source.share.id, actorId, mutation.operationId),
          hash,
        );
      if (previous) {
        await this.activeFence(client, source, input.now);
        return {
          workspaceId: source.share.workspaceId,
          result: {
            feedback: reviewProjection(source, before, actorId, role, input.now),
            receipt: previous,
            replayed: true,
          },
        };
      }
      const cycle = structuredClone(before),
        receipt = applyReview(cycle, source, actorId, role, mutation, input.now);
      await this.save(client, source, before, cycle);
      await this.insertReceipt(client, source, actorId, hash, receipt);
      await this.activeFence(client, source, input.now);
      return {
        workspaceId: source.share.workspaceId,
        result: {
          feedback: reviewProjection(source, cycle, actorId, role, input.now),
          receipt,
          replayed: false,
        },
      };
    });
  }
  async mutateAuthorReview(
    input: Parameters<PresentationReviewFeedbackRepository["mutateAuthorReview"]>[0],
  ) {
    return this.mutate(input, "author");
  }
  async mutateReviewerReview(
    input: Parameters<PresentationReviewFeedbackRepository["mutateReviewerReview"]>[0],
  ) {
    return this.mutate(input, "reviewer");
  }
}
