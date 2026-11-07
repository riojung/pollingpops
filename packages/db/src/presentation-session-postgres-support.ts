import type { QueryResultRow } from "pg";
import {
  PresentationRecoveryPackInterventionSchema,
  PresentationNavigationStateSchema,
  PresentationNavigationEventSchema,
  PresentationInteractionStateSchema,
  PresentationInteractionEventSchema,
  PresentationBranchEventSchema,
} from "@openround/contracts";
import type {
  PresentationSessionCommandReceiptRecord,
  PresentationSessionCredentialRecord,
  PresentationSessionParticipantRecord,
  PresentationSessionReportRecord,
  PresentationSessionRecord,
  PresentationSessionResponseRecord,
  PresentationSessionTimelineRecord,
} from "./presentation-session-types.js";
import { upcastPresentationResponse } from "./response-schemas.js";
import { upcastPresentationSessionContent } from "./artifact-schemas.js";

const presentationResponseFields = [
  "id",
  "workspace_id",
  "session_id",
  "participant_id",
  "block_id",
  "question_id",
  "response",
  "correct",
  "score",
  "response_ms",
  "submitted_at",
  "idempotency_key",
  "request_hash",
  "response_schema_version",
  "moderation_status",
  "moderation_version",
  "moderated_at",
];
export function presentationResponseMetadataColumns(alias?: string) {
  return presentationResponseFields
    .map((field) => (alias ? `${alias}.${field}` : field))
    .join(", ");
}
export function presentationResponseMetadataJson(alias: string) {
  return `jsonb_build_object(${presentationResponseFields.map((field) => `'${field}', ${alias}.${field}`).join(", ")})`;
}

// Revision and live child rows are monotonic for the lifetime of a Presentation session. Their
// sum plus the immutable compatibility offset is therefore a commit-visible, per-session fence:
// every host command, join, or accepted response changes it, while concurrent uncommitted rows
// cannot consume a value that later leaks into a snapshot. Do not expose the stored compatibility
// counter here; it may deliberately skip optimized response writes once a deployment has completed
// its old-binary overlap window.
export const PRESENTATION_EFFECTIVE_EVENT_SEQ_SQL = `(
  session.event_seq_offset
  + session.revision
  + session.text_moderation_seq
  + (SELECT count(*)
       FROM presentation_live_participants participant
      WHERE participant.session_id = session.id)
  + (SELECT count(*)
       FROM presentation_live_responses response
      WHERE response.session_id = session.id)
)`;

/** Match E04 frozen UUID spelling without changing literal legacy acknowledgement semantics. */
export const PRESENTATION_CURRENT_RESPONSE_BLOCK_MATCH_SQL = `(
  CASE WHEN (
    session.content_snapshot ->> 'schemaVersion' IN ('12','13','14','15','16')
    OR session.content_snapshot -> 'blocks' -> session.current_block_index -> 'question' ->> 'type' = 'ranking'
    OR (session.content_snapshot ->> 'schemaVersion' IN ('10','11','12','13','14','15','16') AND session.content_snapshot -> 'blocks' -> session.current_block_index -> 'question' ->> 'type' IN ('open_text','word_cloud'))
    OR (
      session.content_snapshot -> 'blocks' -> session.current_block_index -> 'question' ->> 'type' = 'poll'
      AND COALESCE(session.content_snapshot -> 'blocks' -> session.current_block_index -> 'question' ->> 'maxSelections', '1')
        IN ('2', '3', '4', '5', '6')
    )
  ) THEN openround_presentation_uuid_equal(
    session.content_snapshot -> 'blocks' -> session.current_block_index ->> 'id',
    current_response.block_id::text
  ) ELSE current_response.block_id::text =
    session.content_snapshot -> 'blocks' -> session.current_block_index ->> 'id'
  END
)`;

export function mapSession(row: QueryResultRow): PresentationSessionRecord {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    presentationId: String(row.presentation_id),
    presentationVersionId: String(row.presentation_version_id),
    title: String(row.title),
    content: upcastPresentationSessionContent(
      row.content_snapshot,
      row.content_snapshot?.schemaVersion,
    ),
    code: String(row.join_code),
    joinPasswordHash: row.join_password_hash ?? null,
    status: row.status,
    phase: row.phase,
    currentBlockIndex: Number(row.current_block_index),
    revision: Number(row.revision),
    settings: row.settings ?? { timeMode: "timed" },
    trustMode: row.trust_mode ?? "learning",
    recoveryPackCardsEnabled: row.recovery_pack_cards_enabled ?? false,
    recoveryPackIntervention: row.recovery_pack_intervention
      ? PresentationRecoveryPackInterventionSchema.parse(row.recovery_pack_intervention)
      : null,
    eventSeq: Number(row.event_seq ?? 0),
    ...(row.content_snapshot?.schemaVersion >= 10
      ? { textModerationSeq: Number(row.text_moderation_seq ?? 0) }
      : {}),
    ...(row.content_snapshot?.schemaVersion >= 12
      ? { navigationState: PresentationNavigationStateSchema.parse(row.navigation_state) }
      : {}),
    ...(row.content_snapshot?.schemaVersion >= 13
      ? { interactionState: PresentationInteractionStateSchema.parse(row.interaction_state) }
      : {}),
    questionOpenedAt:
      row.question_opened_at == null
        ? null
        : row.question_opened_at instanceof Date
          ? row.question_opened_at
          : new Date(String(row.question_opened_at)),
    questionClosesAt:
      row.question_closes_at == null
        ? null
        : row.question_closes_at instanceof Date
          ? row.question_closes_at
          : new Date(String(row.question_closes_at)),
    createdBy: String(row.created_by),
    createdAt: row.created_at instanceof Date ? row.created_at : new Date(String(row.created_at)),
    updatedAt: row.updated_at instanceof Date ? row.updated_at : new Date(String(row.updated_at)),
    finishedAt:
      row.finished_at == null
        ? null
        : row.finished_at instanceof Date
          ? row.finished_at
          : new Date(String(row.finished_at)),
    liveExpiresAt:
      row.live_expires_at instanceof Date
        ? row.live_expires_at
        : new Date(String(row.live_expires_at)),
    retentionExpiresAt:
      row.retention_expires_at instanceof Date
        ? row.retention_expires_at
        : new Date(String(row.retention_expires_at)),
  };
}

export function mapParticipant(row: QueryResultRow): PresentationSessionParticipantRecord {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    sessionId: String(row.session_id),
    nickname: String(row.nickname),
    tokenHash: String(row.token_hash),
    joinedAt: row.joined_at instanceof Date ? row.joined_at : new Date(String(row.joined_at)),
    lastSeenAt:
      row.last_seen_at instanceof Date ? row.last_seen_at : new Date(String(row.last_seen_at)),
  };
}

export function mapResponse(row: QueryResultRow): PresentationSessionResponseRecord {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    sessionId: String(row.session_id),
    participantId: String(row.participant_id),
    blockId: String(row.block_id),
    questionId: String(row.question_id),
    response: upcastPresentationResponse(row.response, row.response_schema_version ?? 1, {
      moderationStatus: row.moderation_status,
      moderationVersion: row.moderation_version,
    }),
    responseSchemaVersion: row.response_schema_version ?? 1,
    ...(row.response_schema_version === 3
      ? {
          moderationStatus: row.moderation_status,
          moderationVersion: Number(row.moderation_version),
          moderatedAt: row.moderated_at ? new Date(row.moderated_at) : null,
        }
      : {}),
    correct: row.correct == null ? null : Boolean(row.correct),
    score: Number(row.score ?? 0),
    responseMs: Number(row.response_ms ?? 0),
    submittedAt:
      row.submitted_at instanceof Date ? row.submitted_at : new Date(String(row.submitted_at)),
    idempotencyKey: row.idempotency_key == null ? null : String(row.idempotency_key),
    requestHash: row.request_hash == null ? null : String(row.request_hash),
  };
}

export function mapCredential(row: QueryResultRow): PresentationSessionCredentialRecord {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    sessionId: String(row.session_id),
    role: row.role,
    tokenHash: String(row.token_hash),
    createdAt: row.created_at instanceof Date ? row.created_at : new Date(String(row.created_at)),
    expiresAt: row.expires_at instanceof Date ? row.expires_at : new Date(String(row.expires_at)),
    revokedAt:
      row.revoked_at == null
        ? null
        : row.revoked_at instanceof Date
          ? row.revoked_at
          : new Date(String(row.revoked_at)),
  };
}

export function mapTimeline(row: QueryResultRow): PresentationSessionTimelineRecord {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    sessionId: String(row.session_id),
    sequence: Number(row.sequence),
    type: row.event_type,
    blockIndex: row.block_index == null ? null : Number(row.block_index),
    blockId: row.block_id == null ? null : String(row.block_id),
    revealedParticipantIds: row.revealed_participant_ids ?? null,
    ...(row.interaction
      ? { interaction: PresentationInteractionEventSchema.parse(row.interaction) }
      : {}),
    ...(row.branch ? { branch: PresentationBranchEventSchema.parse(row.branch) } : {}),
    ...(row.navigation
      ? { navigation: PresentationNavigationEventSchema.parse(row.navigation) }
      : {}),
    recoveryPackIntervention: row.recovery_pack_intervention
      ? PresentationRecoveryPackInterventionSchema.parse(row.recovery_pack_intervention)
      : null,
    occurredAt:
      row.occurred_at instanceof Date ? row.occurred_at : new Date(String(row.occurred_at)),
  };
}

export function mapCommandReceipt(row: QueryResultRow): PresentationSessionCommandReceiptRecord {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    sessionId: String(row.session_id),
    commandId: String(row.command_id),
    expectedRevision: Number(row.expected_revision),
    resultingRevision: Number(row.resulting_revision),
    eventType: row.event_type,
    requestHash: row.request_hash == null ? null : String(row.request_hash),
    receivedAt:
      row.received_at instanceof Date ? row.received_at : new Date(String(row.received_at)),
  };
}

export function mapReport(row: QueryResultRow): PresentationSessionReportRecord {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    sessionId: String(row.session_id),
    status: row.status,
    schemaVersion: Number(row.schema_version),
    payload: row.payload ?? null,
    generatedAt:
      row.generated_at == null
        ? null
        : row.generated_at instanceof Date
          ? row.generated_at
          : new Date(String(row.generated_at)),
    expiresAt:
      row.retention_expires_at instanceof Date
        ? row.retention_expires_at
        : new Date(String(row.retention_expires_at)),
    createdAt: row.created_at instanceof Date ? row.created_at : new Date(String(row.created_at)),
    updatedAt: row.updated_at instanceof Date ? row.updated_at : new Date(String(row.updated_at)),
  };
}
