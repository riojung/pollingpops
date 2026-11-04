import {
  requiresPresentationTextOpinions,
  isPresentationTextResultQuestion,
} from "@openround/contracts";
import {
  assertTextReadSession,
  textModerationPage,
  textResponseResults,
  textReportEvidence,
  presentationTextPageOffset,
  samePresentationUuid,
} from "./presentation-text-rules.js";
import {
  PresentationTextReadError,
  PresentationTextCapacityError,
  type PresentationTextModerationInput,
  type PresentationTextModerationAcceptance,
  type PresentationTextModerationReceiptRecord,
  type PresentationTextModerationPageInput,
  type PresentationTextResultsInput,
} from "./presentation-text-types.js";
import {
  presentationResponseSchemaVersion,
  upcastPresentationResponse,
} from "./response-schemas.js";
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { assertAudienceAdmissionForTransaction } from "./platform-postgres.js";
import {
  reserveRoomCoverageForTransaction,
  consumeRoomCoverageForTransaction,
  releaseRoomCoverageForTransaction,
} from "./platform-postgres.js";
import type { PostgresRepository } from "./postgres.js";
import { WorkspaceDeletionInProgressError } from "./types.js";
import {
  PRESENTATION_EFFECTIVE_EVENT_SEQ_SQL,
  presentationResponseMetadataColumns,
  presentationResponseMetadataJson,
  PRESENTATION_CURRENT_RESPONSE_BLOCK_MATCH_SQL,
  mapCommandReceipt,
  mapCredential,
  mapParticipant,
  mapReport,
  mapResponse,
  mapSession,
  mapTimeline,
} from "./presentation-session-postgres-support.js";
import {
  normalizeSession,
  normalizePresentationResponse,
  presentationTextValue,
  assertPresentationTextReceiptIdentity,
  assertCommandRequestHash,
  commandReceiptMatches,
  responseWindowOpen,
  transitionWindow,
  transitionRecoveryPackIntervention,
  transitionContent,
} from "./presentation-session-rules.js";
import {
  PresentationPublishedQuestionSourceUnavailableError,
  PresentationSessionConflictError,
  type PresentationParticipantJoin,
  type PresentationParticipantSnapshotProjection,
  type PresentationResponseAcceptance,
  type PresentationResponseAcknowledgementState,
  type PresentationResponseContext,
  type PresentationActiveCredentialRevocation,
  type PresentationSessionCommandInput,
  type PresentationSessionCreateInput,
  type PresentationSessionCredentialRecord,
  type PresentationSessionCredentialRole,
  type PresentationSessionDeletion,
  type PresentationSessionParticipantRecord,
  type PresentationSessionRecord,
  type PresentationSessionReportCompletion,
  type PresentationSessionReportJob,
  type PresentationSessionRepository,
  type PresentationSessionResponseRecord,
  type PresentationSessionTransitionInput,
  type PresentationTransitionAcceptance,
} from "./presentation-session-types.js";

export class PostgresPresentationSessionRepository implements PresentationSessionRepository {
  constructor(
    private readonly repository: PostgresRepository,
    private readonly options: { concurrentResponseWrites?: boolean } = {},
  ) {}

  private async transaction<T>(
    workspaceId: string | null,
    work: (client: PoolClient) => Promise<T>,
  ) {
    const client = await this.repository.pool.connect();
    try {
      await client.query("BEGIN");
      if (workspaceId) {
        await client.query("SELECT set_config('app.workspace_id', $1, true)", [workspaceId]);
      } else {
        await client.query("SELECT set_config('app.system_access', 'on', true)");
      }
      const result = await work(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  private async assertWorkspaceMutationAllowed(client: PoolClient, workspaceId: string) {
    const eligible = await client.query(
      `SELECT id FROM workspaces
        WHERE id = $1 AND deletion_started_at IS NULL
        FOR SHARE`,
      [workspaceId],
    );
    if (!eligible.rows[0]) throw new WorkspaceDeletionInProgressError(workspaceId);
  }

  private async responseAcknowledgementState(
    client: PoolClient,
    workspaceId: string,
    sessionId: string,
    participantId: string,
  ): Promise<PresentationResponseAcknowledgementState> {
    const parameters = [workspaceId, sessionId, participantId];
    const openQuestionResult = await client.query(
      `SELECT to_jsonb(session) || jsonb_build_object(
                'event_seq', session.event_seq_offset
                  + session.revision
                  + session.text_moderation_seq
                  + participant_totals.participant_count
                  + response_totals.response_count
              ) AS response_session,
              participant_totals.participant_count::integer AS participant_count,
              (SELECT ${presentationResponseMetadataJson("current_response")}
                 FROM presentation_live_responses current_response
                WHERE current_response.session_id = session.id
                  AND current_response.participant_id = $3
                  AND session.current_block_index >= 0
                  AND ${PRESENTATION_CURRENT_RESPONSE_BLOCK_MATCH_SQL}
                LIMIT 1) AS current_response
         FROM presentation_live_sessions session
         CROSS JOIN LATERAL (
           SELECT count(*) AS participant_count
             FROM presentation_live_participants participant
            WHERE participant.session_id = session.id
         ) participant_totals
         CROSS JOIN LATERAL (
           SELECT count(*) AS response_count
             FROM presentation_live_responses response
            WHERE response.session_id = session.id
         ) response_totals
        WHERE session.workspace_id = $1 AND session.id = $2`,
      parameters,
    );
    let row = openQuestionResult.rows[0];
    if (!row) throw new Error("Presentation response session no longer exists");
    let session = mapSession(row.response_session);
    if (session.phase !== "question_open") {
      // Ranking is deliberately absent from the high-volume open-question acknowledgement path.
      // If results are visible, repeat every projection field with the standing in one statement
      // so a transition to the next question cannot pair a future score with an older fence.
      const visibleResult = await client.query(
        `SELECT to_jsonb(session) || jsonb_build_object(
                  'event_seq', session.event_seq_offset
                    + session.revision
                  + session.text_moderation_seq
                    + participant_totals.participant_count
                    + response_totals.response_count
                ) AS response_session,
                participant_totals.participant_count::integer AS participant_count,
                (SELECT ${presentationResponseMetadataJson("current_response")}
                   FROM presentation_live_responses current_response
                  WHERE current_response.session_id = session.id
                    AND current_response.participant_id = $3
                    AND session.current_block_index >= 0
                    AND ${PRESENTATION_CURRENT_RESPONSE_BLOCK_MATCH_SQL}
                  LIMIT 1) AS current_response,
              standing.score AS standing_score,
              standing.rank AS standing_rank
           FROM presentation_live_sessions session
           CROSS JOIN LATERAL (
             SELECT count(*) AS participant_count
               FROM presentation_live_participants participant
              WHERE participant.session_id = session.id
           ) participant_totals
           CROSS JOIN LATERAL (
             SELECT count(*) AS response_count
               FROM presentation_live_responses response
              WHERE response.session_id = session.id
           ) response_totals
           LEFT JOIN LATERAL (
             WITH participant_scores AS (
               SELECT participant.id, participant.joined_at, participant.nickname,
                      COALESCE(SUM(response.score), 0)::bigint AS score
                 FROM presentation_live_participants participant
                 LEFT JOIN presentation_live_responses response
                   ON response.session_id = participant.session_id
                  AND response.participant_id = participant.id
                WHERE session.phase <> 'question_open'
                  AND participant.session_id = session.id
                GROUP BY participant.id, participant.joined_at, participant.nickname
             ), standings AS (
               SELECT id, score,
                      ROW_NUMBER() OVER (
                        ORDER BY score DESC, joined_at ASC, nickname ASC, id ASC
                      )::integer AS rank
                 FROM participant_scores
             )
             SELECT score, rank FROM standings WHERE id = $3
           ) standing ON true
          WHERE session.workspace_id = $1 AND session.id = $2`,
        parameters,
      );
      row = visibleResult.rows[0];
      if (!row) throw new Error("Presentation response session no longer exists");
      session = mapSession(row.response_session);
    }
    if (session.phase !== "question_open" && row.standing_rank == null) {
      throw new Error("Presentation response participant no longer exists");
    }
    const standing: PresentationParticipantSnapshotProjection["standing"] =
      row.standing_rank == null
        ? null
        : { rank: Number(row.standing_rank), score: Number(row.standing_score) };
    return {
      session,
      projection: {
        participantCount: Number(row.participant_count),
        standing,
        currentResponse: row.current_response ? mapResponse(row.current_response) : null,
      },
    };
  }

  private async insertSession(client: PoolClient, input: PresentationSessionCreateInput) {
    const normalized = normalizeSession(input);
    const result = await client.query(
      `WITH eligible_workspace AS (
         SELECT id FROM workspaces
         WHERE id = $2 AND deletion_started_at IS NULL
         FOR SHARE
       )
       INSERT INTO presentation_live_sessions
        (id, workspace_id, presentation_id, presentation_version_id, title, content_snapshot,
         join_code, status, phase, current_block_index, revision, settings, trust_mode,
         event_seq, question_opened_at, question_closes_at, created_by,
         created_at, updated_at, finished_at, live_expires_at, retention_expires_at,
         recovery_pack_cards_enabled, recovery_pack_intervention, join_password_hash)
       SELECT $1, eligible_workspace.id, $3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,
              $17,$18,$19,$20,$21,$22,$23,$24,$25
       FROM eligible_workspace
       RETURNING *`,
      [
        normalized.id,
        normalized.workspaceId,
        normalized.presentationId,
        normalized.presentationVersionId,
        normalized.title,
        JSON.stringify(normalized.content),
        normalized.code,
        normalized.status,
        normalized.phase,
        normalized.currentBlockIndex,
        normalized.revision,
        JSON.stringify(normalized.settings),
        normalized.trustMode,
        normalized.eventSeq,
        normalized.questionOpenedAt,
        normalized.questionClosesAt,
        normalized.createdBy,
        normalized.createdAt,
        normalized.updatedAt,
        normalized.finishedAt,
        normalized.liveExpiresAt,
        normalized.retentionExpiresAt,
        normalized.recoveryPackCardsEnabled,
        normalized.recoveryPackIntervention
          ? JSON.stringify(normalized.recoveryPackIntervention)
          : null,
        normalized.joinPasswordHash,
      ],
    );
    if (!result.rows[0]) {
      throw new WorkspaceDeletionInProgressError(normalized.workspaceId);
    }
    return mapSession(result.rows[0]!);
  }

  private async insertCredential(client: PoolClient, input: PresentationSessionCredentialRecord) {
    const result = await client.query(
      `INSERT INTO presentation_session_credentials
        (id, workspace_id, session_id, role, token_hash, created_at, expires_at, revoked_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [
        input.id,
        input.workspaceId,
        input.sessionId,
        input.role,
        input.tokenHash,
        input.createdAt,
        input.expiresAt,
        input.revokedAt,
      ],
    );
    return mapCredential(result.rows[0]!);
  }

  async listSessions(workspaceId: string, now = new Date(), includeExpired = false) {
    return this.transaction(workspaceId, async (client) => {
      const result = await client.query(
        `SELECT session.*, ${PRESENTATION_EFFECTIVE_EVENT_SEQ_SQL} AS event_seq
           FROM presentation_live_sessions session
          WHERE session.workspace_id = $1
            AND ($3 OR session.status <> 'active' OR session.live_expires_at > $2)
          ORDER BY session.created_at DESC`,
        [workspaceId, now, includeExpired],
      );
      return result.rows.map(mapSession);
    });
  }

  async deleteSession(
    workspaceId: string,
    sessionId: string,
    now = new Date(),
  ): Promise<PresentationSessionDeletion> {
    return this.transaction(workspaceId, async (client) => {
      // Fence transitions and child writes with the parent row lock. The terminal check and
      // cascading delete belong to one workspace-scoped transaction.
      const locked = await client.query(
        `SELECT status, live_expires_at FROM presentation_live_sessions
          WHERE workspace_id = $1 AND id = $2 FOR UPDATE`,
        [workspaceId, sessionId],
      );
      const session = locked.rows[0];
      if (!session) return { status: "not_found" };
      if (session.status === "active" && new Date(session.live_expires_at) > now) {
        return { status: "active" };
      }
      // Child foreign keys and the live-room-code trigger remove the entire durable room.
      await releaseRoomCoverageForTransaction(client, "presentation", sessionId);
      await client.query(
        "DELETE FROM presentation_live_sessions WHERE workspace_id = $1 AND id = $2",
        [workspaceId, sessionId],
      );
      return { status: "deleted" };
    });
  }

  async createSession(input: PresentationSessionCreateInput) {
    const normalized = normalizeSession(input);
    return this.transaction(normalized.workspaceId, (client) => this.insertSession(client, input));
  }

  async createSessionWithCredential(
    input: PresentationSessionCreateInput,
    credential: PresentationSessionCredentialRecord,
  ) {
    const normalized = normalizeSession(input);
    if (
      credential.workspaceId !== normalized.workspaceId ||
      credential.sessionId !== normalized.id
    ) {
      throw new Error("Presentation credential must belong to the session being created");
    }
    return this.transaction(normalized.workspaceId, async (client) => {
      const session = await this.insertSession(client, normalized);
      const storedCredential = await this.insertCredential(client, credential);
      if (input.commercialCoverage) {
        await reserveRoomCoverageForTransaction(client, input.commercialCoverage);
      }
      return { session, credential: storedCredential };
    });
  }

  async getSessionForWorkspace(workspaceId: string, sessionId: string) {
    return this.transaction(workspaceId, async (client) => {
      const result = await client.query(
        `SELECT session.*, ${PRESENTATION_EFFECTIVE_EVENT_SEQ_SQL} AS event_seq
           FROM presentation_live_sessions session
          WHERE session.workspace_id = $1 AND session.id = $2`,
        [workspaceId, sessionId],
      );
      return result.rows[0] ? mapSession(result.rows[0]) : null;
    });
  }

  async getSessionById(sessionId: string) {
    return this.transaction(null, async (client) => {
      const result = await client.query(
        `SELECT session.*, ${PRESENTATION_EFFECTIVE_EVENT_SEQ_SQL} AS event_seq
           FROM presentation_live_sessions session
          WHERE session.id = $1`,
        [sessionId],
      );
      return result.rows[0] ? mapSession(result.rows[0]) : null;
    });
  }

  async getSessionByCode(code: string) {
    return this.transaction(null, async (client) => {
      const result = await client.query(
        `SELECT session.*, ${PRESENTATION_EFFECTIVE_EVENT_SEQ_SQL} AS event_seq
           FROM presentation_live_sessions session
          WHERE session.join_code = $1
            AND session.status = 'active'
            AND session.live_expires_at > now()
          ORDER BY session.created_at DESC LIMIT 1`,
        [code],
      );
      return result.rows[0] ? mapSession(result.rows[0]) : null;
    });
  }

  private async applyTransition(
    client: PoolClient,
    input: PresentationSessionTransitionInput,
    command?: PresentationSessionCommandInput,
  ): Promise<{
    status: "accepted" | "duplicate" | "idempotency_conflict";
    session: PresentationSessionRecord;
  } | null> {
    if (command) {
      const textReceipt = await client.query(
        "SELECT 1 FROM presentation_text_moderation_receipts WHERE workspace_id=$1 AND session_id=$2 AND command_id=$3",
        [input.workspaceId, input.sessionId, command.commandId],
      );
      if (textReceipt.rows[0]) {
        const current = await client.query(
          `SELECT session.*, ${PRESENTATION_EFFECTIVE_EVENT_SEQ_SQL} AS event_seq FROM presentation_live_sessions session WHERE workspace_id=$1 AND id=$2`,
          [input.workspaceId, input.sessionId],
        );
        return current.rows[0]
          ? { status: "idempotency_conflict", session: mapSession(current.rows[0]) }
          : null;
      }
      const prior = await client.query(
        `SELECT * FROM presentation_session_command_receipts
         WHERE workspace_id = $1 AND session_id = $2 AND command_id = $3`,
        [input.workspaceId, input.sessionId, command.commandId],
      );
      if (prior.rows[0]) {
        const current = await client.query(
          `SELECT session.*, ${PRESENTATION_EFFECTIVE_EVENT_SEQ_SQL} AS event_seq
             FROM presentation_live_sessions session
            WHERE session.workspace_id = $1 AND session.id = $2`,
          [input.workspaceId, input.sessionId],
        );
        if (!current.rows[0]) return null;
        return {
          status: commandReceiptMatches(mapCommandReceipt(prior.rows[0]), command)
            ? "duplicate"
            : "idempotency_conflict",
          session: mapSession(current.rows[0]),
        };
      }
    }
    await this.assertWorkspaceMutationAllowed(client, input.workspaceId);
    const locked = await client.query(
      "SELECT * FROM presentation_live_sessions WHERE workspace_id = $1 AND id = $2 FOR UPDATE",
      [input.workspaceId, input.sessionId],
    );
    if (!locked.rows[0]) return null;
    if (command) {
      const textReceipt = await client.query(
        "SELECT 1 FROM presentation_text_moderation_receipts WHERE workspace_id=$1 AND session_id=$2 AND command_id=$3",
        [input.workspaceId, input.sessionId, command.commandId],
      );
      if (textReceipt.rows[0]) {
        const current = await client.query(
          `SELECT session.*, ${PRESENTATION_EFFECTIVE_EVENT_SEQ_SQL} AS event_seq FROM presentation_live_sessions session WHERE workspace_id=$1 AND id=$2`,
          [input.workspaceId, input.sessionId],
        );
        return current.rows[0]
          ? { status: "idempotency_conflict", session: mapSession(current.rows[0]) }
          : null;
      }
      const prior = await client.query(
        `SELECT * FROM presentation_session_command_receipts
         WHERE workspace_id = $1 AND session_id = $2 AND command_id = $3`,
        [input.workspaceId, input.sessionId, command.commandId],
      );
      if (prior.rows[0]) {
        const current = await client.query(
          `SELECT session.*, ${PRESENTATION_EFFECTIVE_EVENT_SEQ_SQL} AS event_seq
             FROM presentation_live_sessions session
            WHERE session.workspace_id = $1 AND session.id = $2`,
          [input.workspaceId, input.sessionId],
        );
        if (!current.rows[0]) return null;
        return {
          status: commandReceiptMatches(mapCommandReceipt(prior.rows[0]), command)
            ? "duplicate"
            : "idempotency_conflict",
          session: mapSession(current.rows[0]),
        };
      }
    }
    const session = mapSession(locked.rows[0]);
    if (session.revision !== input.expectedRevision) {
      throw new PresentationSessionConflictError(input.expectedRevision, session.revision);
    }
    assertCommandRequestHash(command?.requestHash);
    if (command?.publishedQuestionSource) {
      const source = command.publishedQuestionSource;
      // Keep the source eligible until the state, timeline and receipt commit. FOR SHARE
      // conflicts with both non-key archive updates and deletion; KEY SHARE would not.
      // Lock order is workspace -> session -> quiz, matching Library's workspace -> quiz.
      const eligible = await client.query(
        `SELECT quiz.id FROM quizzes quiz
         JOIN quiz_versions version ON version.workspace_id = quiz.workspace_id
           AND version.quiz_id = quiz.id
         WHERE quiz.workspace_id = $1 AND quiz.id = $2 AND quiz.status <> 'archived'
           AND version.id = $3 AND version.content_hash = $4
         FOR SHARE OF quiz`,
        [input.workspaceId, source.quizId, source.versionId, source.contentHash],
      );
      if (!eligible.rows[0]) throw new PresentationPublishedQuestionSourceUnavailableError();
    }
    const occurredAt = input.occurredAt ?? new Date();
    const { intervention, timelineIntervention } = transitionRecoveryPackIntervention(input);
    if (intervention !== null && !session.recoveryPackCardsEnabled) {
      throw new Error("Recovery Pack cards were not enabled when this session was created");
    }
    const content = transitionContent(session, input);
    if (requiresPresentationTextOpinions(content)) {
      const participants = await client.query(
        "SELECT count(*)::integer AS count FROM presentation_live_participants WHERE session_id=$1",
        [session.id],
      );
      if (participants.rows[0].count > 250)
        throw new PresentationTextCapacityError(
          "Text opinion rooms support at most 250 participants",
        );
    }
    const window = transitionWindow({ ...session, content }, input, occurredAt);
    await client.query(
      `UPDATE presentation_live_sessions
       SET phase = $3, current_block_index = $4, status = $5, revision = revision + 1,
           event_seq = event_seq + 1, updated_at = $6,
           question_opened_at = $7, question_closes_at = $8,
           recovery_pack_intervention = $10,
           content_snapshot = COALESCE($11::jsonb, content_snapshot),
           finished_at = CASE
             WHEN status <> 'finished' AND $5 = 'finished' THEN $6
             ELSE finished_at
           END,
           retention_expires_at = CASE
             WHEN status <> 'finished' AND $5 = 'finished' AND $9::timestamptz IS NOT NULL THEN $9
             ELSE retention_expires_at
           END
       WHERE workspace_id = $1 AND id = $2`,
      [
        input.workspaceId,
        input.sessionId,
        input.phase,
        input.currentBlockIndex,
        input.status,
        occurredAt,
        window.questionOpenedAt,
        window.questionClosesAt,
        input.retentionExpiresAt ?? null,
        intervention ? JSON.stringify(intervention) : null,
        input.content === undefined ? null : JSON.stringify(content),
      ],
    );
    const current = await client.query(
      `SELECT session.*, ${PRESENTATION_EFFECTIVE_EVENT_SEQ_SQL} AS event_seq
         FROM presentation_live_sessions session
        WHERE session.workspace_id = $1 AND session.id = $2`,
      [input.workspaceId, input.sessionId],
    );
    const stored = mapSession(current.rows[0]!);
    if (stored.status === "finished") {
      await releaseRoomCoverageForTransaction(client, "presentation", stored.id);
    }
    await client.query(
      `INSERT INTO presentation_session_timeline
        (id, workspace_id, session_id, sequence, event_type, block_index, block_id, occurred_at,
         recovery_pack_intervention, revealed_participant_ids)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,
         CASE WHEN $5 = 'question.revealed' THEN
           ARRAY(SELECT id FROM presentation_live_participants
                 WHERE workspace_id = $2 AND session_id = $3 ORDER BY id)
         ELSE NULL END)`,
      [
        randomUUID(),
        input.workspaceId,
        input.sessionId,
        stored.eventSeq,
        input.event.type,
        input.event.blockIndex,
        input.event.blockId,
        occurredAt,
        timelineIntervention ? JSON.stringify(timelineIntervention) : null,
      ],
    );
    if (command) {
      await client.query(
        `INSERT INTO presentation_session_command_receipts
          (id, workspace_id, session_id, command_id, expected_revision, resulting_revision,
           event_type, received_at, request_hash)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          randomUUID(),
          input.workspaceId,
          input.sessionId,
          command.commandId,
          input.expectedRevision,
          stored.revision,
          input.event.type,
          occurredAt,
          command.requestHash ?? null,
        ],
      );
    }
    return { status: "accepted", session: stored };
  }

  async transitionSession(input: PresentationSessionTransitionInput) {
    return this.transaction(input.workspaceId, async (client) => {
      const result = await this.applyTransition(client, input);
      return result?.session ?? null;
    });
  }

  async transitionSessionCommand(
    input: PresentationSessionCommandInput,
  ): Promise<PresentationTransitionAcceptance> {
    return this.transaction(input.workspaceId, async (client) => {
      const result = await this.applyTransition(client, input, input);
      return result ?? { status: "not_found" };
    });
  }

  async findCommandReceipt(workspaceId: string, sessionId: string, commandId: string) {
    return this.transaction(workspaceId, async (client) => {
      const result = await client.query(
        `SELECT * FROM presentation_session_command_receipts
         WHERE workspace_id = $1 AND session_id = $2 AND command_id = $3`,
        [workspaceId, sessionId, commandId],
      );
      return result.rows[0] ? mapCommandReceipt(result.rows[0]) : null;
    });
  }

  async addParticipant(input: PresentationSessionParticipantRecord) {
    return this.transaction(null, async (client) => {
      const result = await client.query(
        `INSERT INTO presentation_live_participants
          (id, workspace_id, session_id, nickname, token_hash, joined_at, last_seen_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [
          input.id,
          input.workspaceId,
          input.sessionId,
          input.nickname,
          input.tokenHash,
          input.joinedAt,
          input.lastSeenAt,
        ],
      );
      return mapParticipant(result.rows[0]!);
    });
  }

  async joinParticipantWithinLimit(
    input: PresentationSessionParticipantRecord,
    participantLimit: number,
  ): Promise<PresentationParticipantJoin> {
    return this.transaction(input.workspaceId, async (client) => {
      await this.assertWorkspaceMutationAllowed(client, input.workspaceId);
      const locked = await client.query(
        `SELECT status, live_expires_at, content_snapshot
         FROM presentation_live_sessions
         WHERE workspace_id = $1 AND id = $2
         FOR UPDATE`,
        [input.workspaceId, input.sessionId],
      );
      const clock = await client.query<{ now: Date }>("SELECT clock_timestamp() AS now");
      if (
        !locked.rows[0] ||
        locked.rows[0].status !== "active" ||
        new Date(locked.rows[0].live_expires_at) <= clock.rows[0]!.now
      ) {
        return { status: "closed" };
      }
      const count = await client.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM presentation_live_participants WHERE session_id = $1",
        [input.sessionId],
      );
      if (
        Number(count.rows[0]?.count ?? 0) >=
        (requiresPresentationTextOpinions(locked.rows[0].content_snapshot)
          ? Math.min(participantLimit, 250)
          : participantLimit)
      )
        return { status: "full" };
      await assertAudienceAdmissionForTransaction(client, input.workspaceId);
      const result = await client.query(
        `INSERT INTO presentation_live_participants
          (id, workspace_id, session_id, nickname, token_hash, joined_at, last_seen_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [
          input.id,
          input.workspaceId,
          input.sessionId,
          input.nickname,
          input.tokenHash,
          input.joinedAt,
          input.lastSeenAt,
        ],
      );
      await consumeRoomCoverageForTransaction(client, "presentation", input.sessionId);
      return { status: "accepted", participant: mapParticipant(result.rows[0]!) };
    });
  }

  async findParticipant(sessionId: string, tokenHash: string) {
    return this.transaction(null, async (client) => {
      const result = await client.query(
        `UPDATE presentation_live_participants SET last_seen_at = now()
         WHERE session_id = $1 AND token_hash = $2 RETURNING *`,
        [sessionId, tokenHash],
      );
      return result.rows[0] ? mapParticipant(result.rows[0]) : null;
    });
  }

  async getResponseContext(
    sessionId: string,
    tokenHash: string,
    idempotencyKey: string,
  ): Promise<PresentationResponseContext | null> {
    return this.transaction(null, async (client) => {
      const result = await client.query(
        `UPDATE presentation_live_participants AS participant
            SET last_seen_at = now()
           FROM presentation_live_sessions AS session
          WHERE participant.session_id = $1
            AND participant.token_hash = $2
            AND session.id = participant.session_id
        RETURNING participant.*,
                  -- This session is validation context, never a client snapshot. Avoid aggregate
                  -- fence scans here; the post-commit acknowledgement performs the authoritative
                  -- sequence read that is returned to the participant.
                  to_jsonb(session) AS response_session,
                  (SELECT ${presentationResponseMetadataJson("prior_response")}
                     FROM presentation_live_responses AS prior_response
                    WHERE prior_response.session_id = participant.session_id
                      AND prior_response.participant_id = participant.id
                      AND prior_response.idempotency_key = $3
                    LIMIT 1) AS prior_response`,
        [sessionId, tokenHash, idempotencyKey],
      );
      const row = result.rows[0];
      if (!row) return null;
      return {
        session: mapSession(row.response_session),
        participant: mapParticipant(row),
        priorResponse: row.prior_response ? mapResponse(row.prior_response) : null,
      };
    });
  }

  async listParticipants(sessionId: string) {
    return this.transaction(null, async (client) => {
      const result = await client.query(
        "SELECT * FROM presentation_live_participants WHERE session_id = $1 ORDER BY joined_at",
        [sessionId],
      );
      return result.rows.map(mapParticipant);
    });
  }

  async saveResponse(input: PresentationSessionResponseRecord) {
    if (input.responseSchemaVersion === 3 || input.response.textValue !== undefined) {
      const session = await this.getSessionById(input.sessionId);
      if (!session) throw new Error("Session not found");
      const result = await this.acceptTextResponse(input, session.revision);
      if (
        result.status === "accepted" ||
        result.status === "duplicate" ||
        result.status === "already_responded"
      )
        return result.response;
      throw new Error("Text response was not accepted");
    }
    const responseSchemaVersion =
      input.responseSchemaVersion ?? presentationResponseSchemaVersion(input.response);
    upcastPresentationResponse(input.response, responseSchemaVersion);
    return this.transaction(null, async (client) => {
      const result = await client.query(
        `INSERT INTO presentation_live_responses
          (id, workspace_id, session_id, participant_id, block_id, question_id,
           response, correct, score, response_ms, submitted_at, idempotency_key, request_hash, response_schema_version)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
         ON CONFLICT (session_id, participant_id, block_id)
         DO NOTHING
         RETURNING ${presentationResponseMetadataColumns()}`,
        [
          input.id,
          input.workspaceId,
          input.sessionId,
          input.participantId,
          input.blockId,
          input.questionId,
          JSON.stringify(input.response),
          input.correct,
          input.score,
          input.responseMs,
          input.submittedAt,
          input.idempotencyKey ?? null,
          input.requestHash ?? null,
          responseSchemaVersion,
        ],
      );
      if (result.rows[0]) return mapResponse(result.rows[0]);
      const existing = await client.query(
        `SELECT ${presentationResponseMetadataColumns()} FROM presentation_live_responses
         WHERE session_id = $1 AND participant_id = $2 AND block_id = $3`,
        [input.sessionId, input.participantId, input.blockId],
      );
      return mapResponse(existing.rows[0]!);
    });
  }

  async acceptResponse(
    input: PresentationSessionResponseRecord,
    expectedSessionRevision: number,
  ): Promise<PresentationResponseAcceptance> {
    if (input.responseSchemaVersion === 3 || input.response.textValue !== undefined)
      return this.acceptTextResponse(input, expectedSessionRevision);
    const responseSchemaVersion =
      input.responseSchemaVersion ?? presentationResponseSchemaVersion(input.response);
    upcastPresentationResponse(input.response, responseSchemaVersion);
    type WriteResult =
      | { status: "accepted"; response: PresentationSessionResponseRecord }
      | { status: "duplicate"; response: PresentationSessionResponseRecord }
      | { status: "idempotency_conflict"; response: PresentationSessionResponseRecord }
      | { status: "already_responded"; response: PresentationSessionResponseRecord }
      | { status: "phase_closed" };

    const write = await this.transaction<WriteResult>(input.workspaceId, async (client) => {
      if (input.idempotencyKey) {
        // The uniqueness index cannot expose an uncommitted receipt to a request whose stale-state
        // predicate would otherwise fail before INSERT. Serialize only this participant/key before
        // the first lookup; unrelated answers remain concurrent.
        await client.query(
          `SELECT pg_advisory_xact_lock(
             hashtextextended($1::text || ':' || $2::text || ':' || $3::text, 0)
           )`,
          [input.sessionId, input.participantId, input.idempotencyKey],
        );
      }
      const findIdempotentResponse = async () => {
        if (!input.idempotencyKey) return null;
        const result = await client.query(
          `SELECT ${presentationResponseMetadataColumns()} FROM presentation_live_responses
           WHERE session_id = $1 AND participant_id = $2 AND idempotency_key = $3`,
          [input.sessionId, input.participantId, input.idempotencyKey],
        );
        return result.rows[0] ? mapResponse(result.rows[0]) : null;
      };
      const prior = await findIdempotentResponse();
      if (prior) {
        return prior.requestHash && input.requestHash && prior.requestHash !== input.requestHash
          ? { status: "idempotency_conflict", response: prior }
          : { status: "duplicate", response: prior };
      }

      await this.assertWorkspaceMutationAllowed(client, input.workspaceId);

      if (this.options.concurrentResponseWrites) {
        // Enable only after every serving binary reads the commit-visible aggregate fence. The
        // trigger stays installed for prior-image rollback and transactions that omit this local
        // setting.
        await client.query(
          "SELECT set_config('app.presentation_concurrent_response_writes', 'on', true)",
        );
      }
      const sessionLock = this.options.concurrentResponseWrites ? "FOR SHARE" : "FOR UPDATE";
      const inserted = await client.query(
        `WITH locked_session AS MATERIALIZED (
           SELECT *
             FROM presentation_live_sessions
            WHERE workspace_id = $2 AND id = $3
            ${sessionLock}
         ), eligible_session AS (
           SELECT 1
             FROM locked_session
            WHERE status = 'active'
              AND phase = 'question_open'
              AND revision = $14
              AND $11 < live_expires_at
              AND question_opened_at IS NOT NULL
              AND $11 >= question_opened_at
              AND (question_closes_at IS NULL OR $11 <= question_closes_at)
              AND current_block_index >= 0
              AND content_snapshot -> 'blocks' -> current_block_index ->> 'kind' = 'question'
              AND (content_snapshot -> 'blocks' -> current_block_index ->> 'id')::uuid = $5
              AND (content_snapshot -> 'blocks' -> current_block_index -> 'question' ->> 'id')::uuid
                = $6
         )
         INSERT INTO presentation_live_responses
          (id, workspace_id, session_id, participant_id, block_id, question_id,
           response, correct, score, response_ms, submitted_at, idempotency_key, request_hash, response_schema_version)
         SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$15
           FROM eligible_session
         ON CONFLICT DO NOTHING
         RETURNING ${presentationResponseMetadataColumns()}`,
        [
          input.id,
          input.workspaceId,
          input.sessionId,
          input.participantId,
          input.blockId,
          input.questionId,
          JSON.stringify(input.response),
          input.correct,
          input.score,
          input.responseMs,
          input.submittedAt,
          input.idempotencyKey ?? null,
          input.requestHash ?? null,
          expectedSessionRevision,
          responseSchemaVersion,
        ],
      );
      if (inserted.rows[0]) {
        return { status: "accepted", response: mapResponse(inserted.rows[0]) };
      }

      // An insert may have waited for another key at the block uniqueness fence. Re-resolve the
      // exact receipt before interpreting a concurrent host transition as stale state.
      const concurrentPrior = await findIdempotentResponse();
      if (concurrentPrior) {
        return concurrentPrior.requestHash &&
          input.requestHash &&
          concurrentPrior.requestHash !== input.requestHash
          ? { status: "idempotency_conflict", response: concurrentPrior }
          : { status: "duplicate", response: concurrentPrior };
      }
      const current = await client.query(
        `SELECT * FROM presentation_live_sessions
          WHERE workspace_id = $1 AND id = $2`,
        [input.workspaceId, input.sessionId],
      );
      if (
        !current.rows[0] ||
        !responseWindowOpen(mapSession(current.rows[0]), input, expectedSessionRevision)
      ) {
        return { status: "phase_closed" };
      }
      const existing = await client.query(
        `SELECT ${presentationResponseMetadataColumns()} FROM presentation_live_responses
          WHERE session_id = $1 AND participant_id = $2 AND block_id = $3`,
        [input.sessionId, input.participantId, input.blockId],
      );
      if (!existing.rows[0]) return { status: "phase_closed" };
      return input.idempotencyKey
        ? { status: "already_responded", response: mapResponse(existing.rows[0]) }
        : { status: "duplicate", response: mapResponse(existing.rows[0]) };
    });

    if (write.status !== "accepted" && write.status !== "duplicate") return write;
    // Commit the durable receipt and release its phase fence before calculating standings and
    // participant projection. A lost acknowledgement remains recoverable by idempotency key.
    const acknowledgement = await this.transaction(input.workspaceId, (client) =>
      this.responseAcknowledgementState(
        client,
        input.workspaceId,
        input.sessionId,
        input.participantId,
      ),
    );
    return { ...write, acknowledgement };
  }

  async listResponses(sessionId: string) {
    return this.transaction(null, async (client) => {
      const result = await client.query(
        `SELECT ${presentationResponseMetadataColumns()} FROM presentation_live_responses WHERE session_id = $1 ORDER BY submitted_at`,
        [sessionId],
      );
      return result.rows.map(mapResponse);
    });
  }

  async findResponseByIdempotencyKey(
    sessionId: string,
    participantId: string,
    idempotencyKey: string,
  ) {
    return this.transaction(null, async (client) => {
      await client.query(
        `SELECT pg_advisory_xact_lock(
           hashtextextended($1::text || ':' || $2::text || ':' || $3::text, 0)
         )`,
        [sessionId, participantId, idempotencyKey],
      );
      const result = await client.query(
        `SELECT ${presentationResponseMetadataColumns()} FROM presentation_live_responses
         WHERE session_id = $1 AND participant_id = $2 AND idempotency_key = $3`,
        [sessionId, participantId, idempotencyKey],
      );
      return result.rows[0] ? mapResponse(result.rows[0]) : null;
    });
  }

  async getParticipantSnapshotProjection(
    sessionId: string,
    participantId: string,
    currentBlockId: string | null,
    includeStanding: boolean,
  ): Promise<PresentationParticipantSnapshotProjection | null> {
    return this.transaction(null, async (client) => {
      const result = includeStanding
        ? await client.query(
            `WITH participant_scores AS (
               SELECT participant.id, participant.joined_at, participant.nickname,
                      COALESCE(SUM(response.score), 0)::bigint AS score
               FROM presentation_live_participants participant
               LEFT JOIN presentation_live_responses response
                 ON response.session_id = participant.session_id
                AND response.participant_id = participant.id
               WHERE participant.session_id = $1
               GROUP BY participant.id, participant.joined_at, participant.nickname
             ), ranked AS (
               SELECT id, score,
                      ROW_NUMBER() OVER (
                        ORDER BY score DESC, joined_at ASC, nickname ASC, id ASC
                      )::integer AS rank,
                      COUNT(*) OVER ()::integer AS participant_count
               FROM participant_scores
             )
             SELECT ranked.participant_count, ranked.score, ranked.rank,
                    (SELECT ${presentationResponseMetadataJson("current_response")}
                     FROM presentation_live_responses current_response
                     WHERE current_response.session_id = $1
                       AND current_response.participant_id = $2
                       AND current_response.block_id = $3
                     LIMIT 1) AS current_response
             FROM ranked
             WHERE ranked.id = $2`,
            [sessionId, participantId, currentBlockId],
          )
        : await client.query(
            `WITH roster AS (
               SELECT id, COUNT(*) OVER ()::integer AS participant_count
               FROM presentation_live_participants
               WHERE session_id = $1
             )
             SELECT roster.participant_count,
                    (SELECT ${presentationResponseMetadataJson("current_response")}
                     FROM presentation_live_responses current_response
                     WHERE current_response.session_id = $1
                       AND current_response.participant_id = $2
                       AND current_response.block_id = $3
                     LIMIT 1) AS current_response
             FROM roster
             WHERE roster.id = $2`,
            [sessionId, participantId, currentBlockId],
          );
      const row = result.rows[0];
      if (!row) return null;
      return {
        participantCount: Number(row.participant_count),
        standing: includeStanding ? { rank: Number(row.rank), score: Number(row.score) } : null,
        currentResponse: row.current_response ? mapResponse(row.current_response) : null,
      };
    });
  }

  async listTimeline(sessionId: string) {
    return this.transaction(null, async (client) => {
      const result = await client.query(
        "SELECT * FROM presentation_session_timeline WHERE session_id = $1 ORDER BY sequence",
        [sessionId],
      );
      return result.rows.map(mapTimeline);
    });
  }

  async getReport(workspaceId: string, sessionId: string) {
    return this.transaction(workspaceId, async (client) => {
      const result = await client.query(
        `SELECT report.*, session.retention_expires_at
         FROM presentation_session_reports AS report
         JOIN presentation_live_sessions AS session
           ON session.workspace_id = report.workspace_id AND session.id = report.session_id
         WHERE report.workspace_id = $1 AND report.session_id = $2`,
        [workspaceId, sessionId],
      );
      return result.rows[0] ? mapReport(result.rows[0]) : null;
    });
  }

  async claimReportJob(now: Date, leaseUntil: Date): Promise<PresentationSessionReportJob | null> {
    return this.transaction(null, async (client) => {
      const leaseToken = randomUUID();
      const selected = await client.query(
        `SELECT report.id, report.workspace_id, report.session_id, report.attempts,
                session.retention_expires_at
         FROM presentation_session_reports AS report
         JOIN presentation_live_sessions AS session
           ON session.workspace_id = report.workspace_id AND session.id = report.session_id
         WHERE report.status = 'pending' AND report.available_at <= $1
         ORDER BY report.available_at, report.created_at, report.id
         FOR UPDATE OF report SKIP LOCKED
         LIMIT 1`,
        [now],
      );
      const row = selected.rows[0];
      if (!row) return null;
      const updated = await client.query(
        `UPDATE presentation_session_reports
         SET attempts = attempts + 1, available_at = $2, lease_token = $3, updated_at = now()
         WHERE id = $1 AND status = 'pending'
         RETURNING attempts`,
        [row.id, leaseUntil, leaseToken],
      );
      if (updated.rowCount !== 1) return null;
      return {
        reportId: String(row.id),
        workspaceId: String(row.workspace_id),
        sessionId: String(row.session_id),
        attempts: Number(updated.rows[0]!.attempts),
        leaseToken,
        expiresAt:
          row.retention_expires_at instanceof Date
            ? row.retention_expires_at
            : new Date(String(row.retention_expires_at)),
      };
    });
  }

  async completeReportJob(
    job: PresentationSessionReportJob,
    report: PresentationSessionReportCompletion,
  ) {
    if (job.reportId !== report.reportId || job.sessionId !== report.sessionId) {
      throw new Error("Completed Presentation report does not match the claimed job");
    }
    if (!Number.isInteger(report.schemaVersion) || report.schemaVersion < 1) {
      throw new Error("Presentation report schema version must be a positive integer");
    }
    return this.transaction(job.workspaceId, async (client) => {
      const result = await client.query(
        `UPDATE presentation_session_reports
         SET status = 'ready', schema_version = $4, payload = $5, generated_at = $6,
             lease_token = NULL, last_error = NULL, updated_at = now()
         WHERE id = $1 AND workspace_id = $2 AND session_id = $3 AND status = 'pending'
           AND lease_token = $7`,
        [
          job.reportId,
          job.workspaceId,
          job.sessionId,
          report.schemaVersion,
          JSON.stringify(report.payload),
          report.generatedAt,
          job.leaseToken,
        ],
      );
      if (result.rowCount !== 1) {
        throw new Error("The claimed Presentation report job is no longer pending");
      }
    });
  }

  async retryReportJob(
    job: PresentationSessionReportJob,
    error: string,
    availableAt: Date,
    failed: boolean,
  ) {
    return this.transaction(job.workspaceId, async (client) => {
      await client.query(
        `UPDATE presentation_session_reports
         SET status = $4, last_error = $5, available_at = $6, lease_token = NULL,
             updated_at = now()
         WHERE id = $1 AND workspace_id = $2 AND session_id = $3 AND status = 'pending'
           AND lease_token = $7`,
        [
          job.reportId,
          job.workspaceId,
          job.sessionId,
          failed ? "failed" : "pending",
          error.slice(0, 2_000),
          availableAt,
          job.leaseToken,
        ],
      );
    });
  }

  async createCredential(input: PresentationSessionCredentialRecord) {
    return this.transaction(input.workspaceId, (client) => this.insertCredential(client, input));
  }

  async rotateCredential(input: PresentationSessionCredentialRecord) {
    return this.transaction(input.workspaceId, async (client) => {
      // Serialize by the stable parent row rather than the current credential set. Locking only
      // active credentials leaves a gap when none exist, and concurrent UPDATE snapshots cannot
      // see credentials inserted by a rotation that commits while they wait.
      await client.query(
        `/* rotate_presentation_session_credential */
         SELECT id FROM presentation_live_sessions
         WHERE workspace_id = $1 AND id = $2
         FOR UPDATE`,
        [input.workspaceId, input.sessionId],
      );
      await client.query(
        `UPDATE presentation_session_credentials
         SET revoked_at = GREATEST(created_at, $4::timestamptz)
         WHERE workspace_id = $1 AND session_id = $2 AND role = $3 AND revoked_at IS NULL`,
        [input.workspaceId, input.sessionId, input.role, input.createdAt],
      );
      const result = await client.query(
        `INSERT INTO presentation_session_credentials
          (id, workspace_id, session_id, role, token_hash, created_at, expires_at, revoked_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
        [
          input.id,
          input.workspaceId,
          input.sessionId,
          input.role,
          input.tokenHash,
          input.createdAt,
          input.expiresAt,
          input.revokedAt,
        ],
      );
      return mapCredential(result.rows[0]!);
    });
  }

  async findValidCredential(
    sessionId: string,
    tokenHash: string,
    role?: PresentationSessionCredentialRole,
    now = new Date(),
  ) {
    return this.transaction(null, async (client) => {
      const result = await client.query(
        `SELECT * FROM presentation_session_credentials
         WHERE session_id = $1 AND token_hash = $2
           AND ($3::text IS NULL OR role = $3)
           AND revoked_at IS NULL AND expires_at > $4`,
        [sessionId, tokenHash, role ?? null, now],
      );
      return result.rows[0] ? mapCredential(result.rows[0]) : null;
    });
  }

  async revokeCredential(
    workspaceId: string,
    sessionId: string,
    credentialId: string,
    revokedAt = new Date(),
    role?: PresentationSessionCredentialRole,
  ) {
    return this.transaction(workspaceId, async (client) => {
      const result = await client.query(
        `UPDATE presentation_session_credentials
         SET revoked_at = COALESCE(revoked_at, $4)
         WHERE workspace_id = $1 AND session_id = $2 AND id = $3
           AND ($5::text IS NULL OR role = $5)
         RETURNING *`,
        [workspaceId, sessionId, credentialId, revokedAt, role ?? null],
      );
      return result.rows[0] ? mapCredential(result.rows[0]) : null;
    });
  }

  async revokeActiveCredential(
    workspaceId: string,
    sessionId: string,
    credentialId: string,
    revokedAt: Date,
    role: PresentationSessionCredentialRole,
  ): Promise<PresentationActiveCredentialRevocation> {
    return this.transaction(workspaceId, async (client) => {
      // Hold the exact row through classification and the conditional UPDATE. A concurrent
      // rotation/revocation cannot turn an already inactive pass into a success acknowledgement.
      const target = await client.query(
        `SELECT id FROM presentation_session_credentials
         WHERE workspace_id = $1 AND session_id = $2 AND id = $3 AND role = $4
         FOR UPDATE`,
        [workspaceId, sessionId, credentialId, role],
      );
      if (!target.rows[0]) return { status: "not_found" };
      const result = await client.query(
        `UPDATE presentation_session_credentials
         SET revoked_at = GREATEST(created_at, $4::timestamptz)
         WHERE workspace_id = $1 AND session_id = $2 AND id = $3 AND role = $5
           AND revoked_at IS NULL AND expires_at > $4
         RETURNING *`,
        [workspaceId, sessionId, credentialId, revokedAt, role],
      );
      return result.rows[0]
        ? { status: "revoked", credential: mapCredential(result.rows[0]) }
        : { status: "stale" };
    });
  }
  private async textSession(
    client: PoolClient,
    workspaceId: string,
    sessionId: string,
    update = false,
  ) {
    const row = await client.query(
      `SELECT session.*, ${PRESENTATION_EFFECTIVE_EVENT_SEQ_SQL} AS event_seq FROM presentation_live_sessions session WHERE workspace_id=$1 AND id=$2 ${update ? "FOR UPDATE" : "FOR SHARE"}`,
      [workspaceId, sessionId],
    );
    return row.rows[0] ? mapSession(row.rows[0]) : null;
  }
  private textReceipt(row: Record<string, any>): PresentationTextModerationReceiptRecord {
    return {
      id: row.id,
      workspaceId: row.workspace_id,
      sessionId: row.session_id,
      commandId: row.command_id,
      responseId: row.response_id,
      blockId: row.block_id,
      hostCredentialId: row.host_credential_id,
      requestHash: row.request_hash,
      previousStatus: row.previous_status,
      status: row.status,
      expectedRevision: Number(row.expected_revision),
      expectedModerationVersion: Number(row.expected_moderation_version),
      resultingModerationVersion: Number(row.resulting_moderation_version),
      acceptedAt: new Date(row.accepted_at),
    };
  }
  private async hostTextCredential(
    client: PoolClient,
    workspaceId: string,
    sessionId: string,
    credentialId: string,
    now: Date,
  ) {
    const result = await client.query(
      "SELECT 1 FROM presentation_session_credentials WHERE workspace_id=$1 AND session_id=$2 AND id=$3 AND role='host' AND revoked_at IS NULL AND expires_at>$4 FOR SHARE",
      [workspaceId, sessionId, credentialId, now],
    );
    return !!result.rows[0];
  }
  private async acceptTextResponse(
    input: PresentationSessionResponseRecord,
    expectedRevision: number,
  ): Promise<PresentationResponseAcceptance> {
    assertPresentationTextReceiptIdentity(input);
    const write = await this.transaction(
      input.workspaceId,
      async (
        client,
      ): Promise<
        | Exclude<PresentationResponseAcceptance, { status: "accepted" | "duplicate" }>
        | { status: "accepted"; response: PresentationSessionResponseRecord }
        | { status: "duplicate"; response: PresentationSessionResponseRecord }
      > => {
        await this.assertWorkspaceMutationAllowed(client, input.workspaceId);
        const session = await this.textSession(client, input.workspaceId, input.sessionId, true);
        if (!session) return { status: "phase_closed" };
        if (input.idempotencyKey) {
          const previous = await client.query(
            `SELECT ${presentationResponseMetadataColumns()} FROM presentation_live_responses WHERE session_id=$1 AND participant_id=$2 AND idempotency_key=$3`,
            [input.sessionId, input.participantId, input.idempotencyKey],
          );
          if (previous.rows[0]) {
            const record = mapResponse(previous.rows[0]);
            return record.requestHash &&
              input.requestHash &&
              record.requestHash !== input.requestHash
              ? { status: "idempotency_conflict", response: record }
              : { status: "duplicate", response: record };
          }
        }
        if (!responseWindowOpen(session, input, expectedRevision))
          return { status: "phase_closed" };
        const existing = await client.query(
          `SELECT ${presentationResponseMetadataColumns()} FROM presentation_live_responses WHERE session_id=$1 AND participant_id=$2 AND block_id=$3`,
          [input.sessionId, input.participantId, input.blockId],
        );
        if (existing.rows[0])
          return input.idempotencyKey
            ? { status: "already_responded", response: mapResponse(existing.rows[0]) }
            : { status: "duplicate", response: mapResponse(existing.rows[0]) };
        const participant = await client.query(
          "SELECT 1 FROM presentation_live_participants WHERE workspace_id=$1 AND session_id=$2 AND id=$3 FOR SHARE",
          [input.workspaceId, input.sessionId, input.participantId],
        );
        if (!participant.rows[0]) return { status: "phase_closed" };
        const counts = await client.query(
          "SELECT count(*)::integer AS total,count(*) FILTER(WHERE block_id=$2)::integer AS block FROM presentation_live_responses WHERE session_id=$1 AND response_schema_version=3",
          [input.sessionId, input.blockId],
        );
        if (counts.rows[0].total >= 2500 || counts.rows[0].block >= 250)
          throw new PresentationTextCapacityError();
        const record = normalizePresentationResponse(session, input);
        const value = presentationTextValue(session, input);
        const row = await client.query(
          `INSERT INTO presentation_live_responses (id,workspace_id,session_id,participant_id,block_id,question_id,response,response_schema_version,correct,score,response_ms,submitted_at,idempotency_key,request_hash,text_value,moderation_status,moderation_version)
        VALUES ($1,$2,$3,$4,$5,$6,'{}',3,NULL,0,$7,$8,$9,$10,$11,'pending',0) RETURNING ${presentationResponseMetadataColumns()}`,
          [
            record.id,
            record.workspaceId,
            record.sessionId,
            record.participantId,
            record.blockId,
            record.questionId,
            record.responseMs,
            record.submittedAt,
            record.idempotencyKey ?? null,
            record.requestHash ?? null,
            value,
          ],
        );
        return { status: "accepted", response: mapResponse(row.rows[0]) };
      },
    );
    if (write.status !== "accepted" && write.status !== "duplicate") return write;
    const acknowledgement = await this.transaction(input.workspaceId, (client) =>
      this.responseAcknowledgementState(
        client,
        input.workspaceId,
        input.sessionId,
        input.participantId,
      ),
    );
    return { ...write, acknowledgement };
  }
  async findTextModerationReceipt(workspaceId: string, sessionId: string, commandId: string) {
    return this.transaction(workspaceId, async (client) => {
      const row = await client.query(
        "SELECT * FROM presentation_text_moderation_receipts WHERE workspace_id=$1 AND session_id=$2 AND command_id=$3",
        [workspaceId, sessionId, commandId],
      );
      return row.rows[0] ? this.textReceipt(row.rows[0]) : null;
    });
  }
  async moderateTextResponse(
    input: PresentationTextModerationInput,
  ): Promise<PresentationTextModerationAcceptance> {
    return this.transaction<PresentationTextModerationAcceptance>(
      input.workspaceId,
      async (client) => {
        await this.assertWorkspaceMutationAllowed(client, input.workspaceId);
        const session = await this.textSession(client, input.workspaceId, input.sessionId, true);
        if (!session) return { status: "not_found" };
        const checkedAt = new Date(
          Math.max(
            input.occurredAt.getTime(),
            (
              await client.query<{ now: Date }>("SELECT clock_timestamp() AS now")
            ).rows[0]!.now.getTime(),
          ),
        );
        if (
          !(await this.hostTextCredential(
            client,
            input.workspaceId,
            input.sessionId,
            input.hostCredentialId,
            checkedAt,
          ))
        )
          return { status: "unauthorized" };
        const row = await client.query(
          `SELECT ${presentationResponseMetadataColumns()} FROM presentation_live_responses WHERE workspace_id=$1 AND session_id=$2 AND id=$3 AND response_schema_version=3 FOR UPDATE`,
          [input.workspaceId, input.sessionId, input.responseId],
        );
        if (!row.rows[0]) return { status: "not_found" };
        const response = mapResponse(row.rows[0]);
        const prior = await client.query(
          "SELECT * FROM presentation_text_moderation_receipts WHERE session_id=$1 AND command_id=$2",
          [input.sessionId, input.commandId],
        );
        if (prior.rows[0]) {
          const receipt = this.textReceipt(prior.rows[0]);
          return receipt.requestHash === input.requestHash &&
            receipt.hostCredentialId === input.hostCredentialId
            ? { status: "duplicate", session, receipt, response }
            : { status: "idempotency_conflict" };
        }
        if (
          (
            await client.query(
              "SELECT 1 FROM presentation_session_command_receipts WHERE session_id=$1 AND command_id=$2",
              [input.sessionId, input.commandId],
            )
          ).rows[0]
        )
          return { status: "idempotency_conflict" };
        if (
          session.status !== "active" ||
          session.liveExpiresAt <= checkedAt ||
          session.retentionExpiresAt <= checkedAt
        )
          return { status: "phase_closed" };
        if (
          session.revision !== input.expectedRevision ||
          response.moderationVersion !== input.expectedModerationVersion
        )
          return {
            status: "stale",
            session,
            actualModerationVersion: response.moderationVersion ?? 0,
          };
        if (
          response.moderationStatus === "removed" ||
          (response.moderationStatus === "approved" && input.status !== "removed")
        )
          return { status: "not_found" };
        if (
          (
            await client.query(
              "SELECT count(*)::integer AS count FROM presentation_text_moderation_receipts WHERE session_id=$1",
              [input.sessionId],
            )
          ).rows[0].count >= 5000
        )
          return { status: "limit_reached" };
        const changed = await client.query(
          `UPDATE presentation_live_responses SET moderation_status=$2,moderation_version=moderation_version+1,moderated_at=$3,text_value=CASE WHEN $2='removed' THEN NULL ELSE text_value END WHERE id=$1 RETURNING ${presentationResponseMetadataColumns()}`,
          [input.responseId, input.status, input.occurredAt],
        );
        const receipt = await client.query(
          `INSERT INTO presentation_text_moderation_receipts (id,workspace_id,session_id,command_id,response_id,block_id,host_credential_id,request_hash,previous_status,status,expected_revision,expected_moderation_version,resulting_moderation_version,accepted_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
          [
            randomUUID(),
            input.workspaceId,
            input.sessionId,
            input.commandId,
            input.responseId,
            response.blockId,
            input.hostCredentialId,
            input.requestHash,
            response.moderationStatus,
            input.status,
            input.expectedRevision,
            input.expectedModerationVersion,
            input.expectedModerationVersion + 1,
            input.occurredAt,
          ],
        );
        return {
          status: "accepted",
          session: (await this.textSession(client, input.workspaceId, input.sessionId))!,
          receipt: this.textReceipt(receipt.rows[0]),
          response: mapResponse(changed.rows[0]),
        };
      },
    ).catch(async (error): Promise<PresentationTextModerationAcceptance> => {
      if (
        error?.code !== "23514" ||
        ![
          "Invalid or closed Presentation text moderation transition",
          "Invalid text moderation receipt or command namespace",
        ].some((message) => String(error.message).includes(message))
      )
        throw error;
      return this.transaction(
        input.workspaceId,
        async (client): Promise<PresentationTextModerationAcceptance> => {
          const session = await this.textSession(client, input.workspaceId, input.sessionId);
          if (!session) return { status: "not_found" };
          const now = new Date(
            Math.max(
              input.occurredAt.getTime(),
              (
                await client.query<{ now: Date }>("SELECT clock_timestamp() AS now")
              ).rows[0]!.now.getTime(),
            ),
          );
          if (
            !(await this.hostTextCredential(
              client,
              input.workspaceId,
              input.sessionId,
              input.hostCredentialId,
              now,
            ))
          )
            return { status: "unauthorized" };
          if (
            session.status !== "active" ||
            session.liveExpiresAt <= now ||
            session.retentionExpiresAt <= now
          )
            return { status: "phase_closed" };
          throw error;
        },
      );
    });
  }
  async getTextModerationPage(input: PresentationTextModerationPageInput) {
    return this.transaction(input.workspaceId, async (client) => {
      await this.assertWorkspaceMutationAllowed(client, input.workspaceId);
      const now = input.now ?? new Date();
      const session = await this.textSession(client, input.workspaceId, input.sessionId);
      assertTextReadSession(session, input.workspaceId, now);
      if (
        !(await this.hostTextCredential(
          client,
          input.workspaceId,
          input.sessionId,
          input.hostCredentialId,
          now,
        ))
      )
        throw new PresentationTextReadError("UNAUTHORIZED", "Host credential required");
      const page = presentationTextPageOffset(
        session,
        ["moderation", input.blockId?.toLowerCase() ?? null, input.status],
        input.cursor,
        input.limit,
      );
      const rows = await client.query(
        `SELECT ${presentationResponseMetadataColumns("response")},response.text_value,participant.nickname FROM presentation_live_responses response JOIN presentation_live_participants participant ON participant.session_id=response.session_id AND participant.id=response.participant_id WHERE response.session_id=$1 AND response.response_schema_version=3 AND response.moderation_status=$2 AND ($3::uuid IS NULL OR response.block_id=$3) ORDER BY response.submitted_at,response.id LIMIT $4 OFFSET $5`,
        [session.id, input.status, input.blockId ?? null, input.limit + 1, page.start],
      );
      const readAt = new Date(
        Math.max(
          now.getTime(),
          (
            await client.query<{ now: Date }>("SELECT clock_timestamp() AS now")
          ).rows[0]!.now.getTime(),
        ),
      );
      assertTextReadSession(session, input.workspaceId, readAt);
      if (
        !(await this.hostTextCredential(
          client,
          input.workspaceId,
          input.sessionId,
          input.hostCredentialId,
          readAt,
        ))
      )
        throw new PresentationTextReadError("UNAUTHORIZED", "Host credential required");
      return textModerationPage(
        session,
        rows.rows.map((row) => ({ record: mapResponse(row), textValue: row.text_value })),
        new Map(rows.rows.map((row) => [String(row.participant_id), String(row.nickname)])),
        input,
        true,
      );
    });
  }
  async getTextResponseResults(input: PresentationTextResultsInput) {
    return this.transaction(input.workspaceId, async (client) => {
      await this.assertWorkspaceMutationAllowed(client, input.workspaceId);
      const now = input.now ?? new Date();
      const session = await this.textSession(client, input.workspaceId, input.sessionId);
      assertTextReadSession(session, input.workspaceId, now);
      const actor = input.actor;
      let authorized: boolean;
      if (actor.role === "creator")
        authorized = !!(
          await client.query(
            "SELECT 1 FROM workspace_members WHERE workspace_id=$1 AND user_id=$2 FOR SHARE",
            [input.workspaceId, actor.userId],
          )
        ).rows[0];
      else if (actor.role === "participant")
        authorized = !!(
          await client.query(
            "SELECT 1 FROM presentation_live_participants WHERE workspace_id=$1 AND session_id=$2 AND id=$3",
            [input.workspaceId, input.sessionId, actor.participantId],
          )
        ).rows[0];
      else
        authorized = !!(
          await client.query(
            "SELECT 1 FROM presentation_session_credentials WHERE workspace_id=$1 AND session_id=$2 AND id=$3 AND role=$4 AND revoked_at IS NULL AND expires_at>$5 FOR SHARE",
            [input.workspaceId, input.sessionId, actor.credentialId, actor.role, now],
          )
        ).rows[0];
      if (!authorized)
        throw new PresentationTextReadError("UNAUTHORIZED", "Live text access required");
      const block = session.content.blocks[session.currentBlockIndex];
      if (
        block?.kind !== "question" ||
        !isPresentationTextResultQuestion(block.question) ||
        !samePresentationUuid(block.id, input.blockId)
      )
        throw new PresentationTextReadError("NOT_FOUND", "Current text checkpoint not found");
      const events = await client.query(
        "SELECT * FROM presentation_session_timeline WHERE session_id=$1 AND event_type='question.revealed' AND block_id=$2",
        [session.id, block.id],
      );
      const rows = events.rows.length
        ? await client.query(
            `SELECT ${presentationResponseMetadataColumns()},text_value FROM presentation_live_responses WHERE session_id=$1 AND block_id=$2 AND response_schema_version=3 AND moderation_status='approved' ORDER BY submitted_at,id LIMIT 251`,
            [session.id, block.id],
          )
        : { rows: [] };
      const readAt = new Date(
        Math.max(
          now.getTime(),
          (
            await client.query<{ now: Date }>("SELECT clock_timestamp() AS now")
          ).rows[0]!.now.getTime(),
        ),
      );
      assertTextReadSession(session, input.workspaceId, readAt);
      if (
        actor.role !== "creator" &&
        actor.role !== "participant" &&
        !(
          await client.query(
            "SELECT 1 FROM presentation_session_credentials WHERE workspace_id=$1 AND session_id=$2 AND id=$3 AND role=$4 AND revoked_at IS NULL AND expires_at>$5",
            [input.workspaceId, input.sessionId, actor.credentialId, actor.role, readAt],
          )
        ).rows[0]
      )
        throw new PresentationTextReadError("UNAUTHORIZED", "Live text access required");
      return textResponseResults(
        session,
        rows.rows.map((row) => ({ record: mapResponse(row), textValue: row.text_value })),
        events.rows.map(mapTimeline),
        input,
      );
    });
  }
  async getTextReportEvidence(input: { workspaceId: string; sessionId: string; now?: Date }) {
    return this.transaction(input.workspaceId, async (client) => {
      await this.assertWorkspaceMutationAllowed(client, input.workspaceId);
      const session = await this.textSession(client, input.workspaceId, input.sessionId);
      assertTextReadSession(session, input.workspaceId, input.now ?? new Date(), true);
      if (session.status !== "finished") return [];
      const rows = await client.query(
        `SELECT ${presentationResponseMetadataColumns()},text_value FROM presentation_live_responses WHERE session_id=$1 AND response_schema_version=3 AND moderation_status='approved' ORDER BY submitted_at,id LIMIT 2501`,
        [session.id],
      );
      const events = await client.query(
        "SELECT * FROM presentation_session_timeline WHERE session_id=$1 AND event_type='question.revealed'",
        [session.id],
      );
      const readAt = new Date(
        Math.max(
          input.now?.getTime() ?? 0,
          (
            await client.query<{ now: Date }>("SELECT clock_timestamp() AS now")
          ).rows[0]!.now.getTime(),
        ),
      );
      assertTextReadSession(session, input.workspaceId, readAt, true);
      return textReportEvidence(
        session,
        rows.rows.map((row) => ({ record: mapResponse(row), textValue: row.text_value })),
        events.rows.map(mapTimeline),
      );
    });
  }
}
