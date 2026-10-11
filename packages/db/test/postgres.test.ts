import { createHash, randomInt, randomUUID } from "node:crypto";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool, type PoolClient } from "pg";
import {
  ProductEventNameSchema,
  type AuthoringDraft,
  type PresentationDraft,
  type QuizDraft,
  type Report,
  RecoveryPackContentSchema,
  QuestionSchema,
  recoveryPackContentHash,
} from "@openround/contracts";
import {
  acceptAnswer,
  addParticipant,
  applyHostCommand,
  createGameState,
} from "@openround/game-engine";
import { assertRestrictedRuntimeDatabasePrincipal, PostgresRepository } from "../src/postgres.js";
import {
  PresentationMutationConflictError,
  PresentationPublishedQuestionSourceUnavailableError,
  PostgresCollaborationGroupRepository,
  PostgresLibraryMetadataRepository,
  PostgresPresentationRepository,
  PostgresPresentationSessionRepository,
  createSurveyRepository,
  createRecoveryPackRepository,
  createAudienceScopeRepository,
  createScopedQnaRepository,
  RecoveryPackMediaValidationError,
  type PresentationSessionCommandInput,
  type PresentationSessionCredentialRecord,
} from "../src/index.js";
import {
  FollowupAccessLimitError,
  QuizDraftRevisionConflictError,
  SessionCodeConflictError,
  SessionNotActiveError,
  SessionVersionConflictError,
  WorkspaceDeletionInProgressError,
} from "../src/types.js";
import { discoverMigrations, runMigrations } from "../src/migrations.js";
import { expectSurveyConformance, surveyFixture } from "./support/survey-conformance.js";
import { createLibraryDeletionFixture } from "./support/library-deletion-fixtures.js";
import {
  expectPresentationSessionRepositoryConformance,
  expectPresentationRecoveryPackLiveCardsConformance,
  presentationRecoveryPackIntervention,
  presentationRecoveryPackUuidCases,
  presentationSessionConformanceContent,
} from "./support/presentation-session-conformance.js";
import { expectRecoveryPackDraftUndoConformance } from "./support/recovery-pack-draft-undo-conformance.js";
import { expectAudienceScopeConformance } from "./support/audience-scope-conformance.js";
import { expectScopedQnaConformance } from "./support/scoped-qna-conformance.js";
import { expectPresentationLiveInsertionConformance } from "./support/presentation-live-insertion-conformance.js";
import { expectRecoveryPackLiveMetadataConformance } from "./support/recovery-pack-live-metadata-conformance.js";
import {
  expectPublishedQuestionLiveMetadataConformance,
  expectPublishedQuestionLiveMetadataSchemaConformance,
} from "./support/published-question-live-metadata-conformance.js";
import {
  expectPresentationPackUndoConformance,
  expectPresentationPackUndoRetentionConformance,
} from "./support/presentation-pack-undo-conformance.js";
import { expectRecoveryPackUpdateMediaConformance } from "./support/recovery-pack-update-media-conformance.js";
import {
  expectPresentationPackHistoryMediaConformance,
  expectPresentationPackInvalidMediaConformance,
  expectPresentationPackMediaConformance,
  presentationPackContent,
  presentationPackMediaDraft,
} from "./support/presentation-pack-media-conformance.js";
import {
  expectRecoveryPackRepositoryConformance,
  recoveryPackDraft,
  recoveryPackRecord,
} from "./support/recovery-pack-conformance.js";
import {
  createExpiringSourceJob,
  expectRecoveryPackSourceConformance,
  sourcePackFixture,
} from "./support/recovery-pack-source-conformance.js";
import {
  expectRecoveryPackPracticeConformance,
  expectRecoveryPackPracticeMediaLifecycle,
  packPracticeFixture,
} from "./support/recovery-pack-practice-conformance.js";
import {
  expectRecoveryPackSequencePracticeConformance,
  expectSequencePracticeExpiry,
} from "./support/recovery-pack-sequence-practice-conformance.js";

const adminUrl = process.env.TEST_DATABASE_ADMIN_URL;
const runtimeUrl = process.env.TEST_DATABASE_URL;
const enabled = Boolean(adminUrl && runtimeUrl);

function publishableRound(title: string): QuizDraft {
  return {
    title,
    description: "",
    questions: [
      {
        id: randomUUID(),
        type: "numeric",
        prompt: "What is one plus one?",
        correctValue: "2",
        tolerance: "0",
        unit: null,
        timeLimitSeconds: 30,
        basePoints: 1_000,
        explanation: "One plus one is two.",
        mediaId: null,
        mediaAlt: null,
      },
    ],
  };
}

describe.skipIf(!adminUrl)("PostgreSQL migration upgrades", () => {
  it("upgrades pre-055 rooms and command receipts without retroactively enabling live cards", async () => {
    const schema = `openround_live_cards_upgrade_${randomUUID().replaceAll("-", "")}`;
    const migrationsDirectory = join(dirname(fileURLToPath(import.meta.url)), "../migrations");
    const legacyDirectory = await mkdtemp(join(tmpdir(), "openround-pre-live-cards-"));
    const adminPool = new Pool({ connectionString: adminUrl });
    let isolatedPool: Pool | undefined;
    try {
      const migrations = await discoverMigrations(migrationsDirectory);
      for (const migration of migrations.filter(({ version }) => version <= 54)) {
        await writeFile(join(legacyDirectory, migration.fileName), migration.sql);
      }
      await adminPool.query(`CREATE SCHEMA "${schema}"`);
      const isolatedUrl = new URL(adminUrl!);
      isolatedUrl.searchParams.set("options", `-csearch_path=${schema},public`);
      isolatedPool = new Pool({ connectionString: isolatedUrl.toString(), max: 1 });
      await runMigrations(isolatedPool, legacyDirectory);
      // Production security-definer helpers intentionally pin public. Point only these isolated
      // fixture copies at the temporary schema before populating its pre-migration room.
      await isolatedPool.query(
        `ALTER FUNCTION "${schema}".register_presentation_room_code()
         SET search_path = pg_catalog, "${schema}"`,
      );
      await isolatedPool.query(
        `ALTER FUNCTION "${schema}".claim_live_room_code(character, uuid, text, uuid, timestamptz, timestamptz)
         SET search_path = pg_catalog, "${schema}"`,
      );
      await isolatedPool.query("SELECT set_config('app.system_access', 'on', false)");
      const userId = randomUUID();
      const workspaceId = randomUUID();
      const presentationId = randomUUID();
      const versionId = randomUUID();
      const sessionId = randomUUID();
      const commandId = randomUUID();
      const content = presentationSessionConformanceContent();
      await isolatedPool.query("INSERT INTO users (id, email) VALUES ($1, $2)", [
        userId,
        `live-cards-upgrade-${userId}@example.com`,
      ]);
      await isolatedPool.query(
        "INSERT INTO workspaces (id, name, segment, owner_id) VALUES ($1, 'Live cards upgrade', 'education', $2)",
        [workspaceId, userId],
      );
      await isolatedPool.query(
        `INSERT INTO presentations
          (id, workspace_id, title, draft, draft_schema_version, last_edited_by)
         VALUES ($1,$2,$3,$4::jsonb,2,$5)`,
        [presentationId, workspaceId, content.title, JSON.stringify(content), userId],
      );
      await isolatedPool.query(
        `INSERT INTO presentation_versions
          (id, workspace_id, presentation_id, version, content, content_schema_version, content_hash, source_draft_revision)
         VALUES ($1,$2,$3,1,$4::jsonb,2,'legacy-live-cards',0)`,
        [versionId, workspaceId, presentationId, JSON.stringify(content)],
      );
      await isolatedPool.query(
        `INSERT INTO presentation_live_sessions
          (id, workspace_id, presentation_id, presentation_version_id, title, content_snapshot,
           join_code, phase, current_block_index, revision, event_seq, created_by, live_expires_at, retention_expires_at)
         VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,'question_reveal',0,1,1,$8,now() + interval '1 hour',now() + interval '30 days')`,
        [
          sessionId,
          workspaceId,
          presentationId,
          versionId,
          content.title,
          JSON.stringify(content),
          String(randomInt(1_000_000, 10_000_000)),
          userId,
        ],
      );
      await isolatedPool.query(
        `INSERT INTO presentation_session_command_receipts
          (id, workspace_id, session_id, command_id, expected_revision, resulting_revision, event_type)
         VALUES ($1,$2,$3,$4,0,1,'question.revealed')`,
        [randomUUID(), workspaceId, sessionId, commandId],
      );
      await isolatedPool.query(
        `INSERT INTO presentation_session_timeline
          (id, workspace_id, session_id, sequence, event_type, block_index, block_id)
         VALUES ($1,$2,$3,1,'question.revealed',0,$4)`,
        [randomUUID(), workspaceId, sessionId, content.blocks[0]!.id],
      );
      await runMigrations(isolatedPool, migrationsDirectory);
      await runMigrations(isolatedPool, migrationsDirectory);
      const room = await isolatedPool.query(
        "SELECT recovery_pack_cards_enabled, recovery_pack_intervention, content_snapshot, revision FROM presentation_live_sessions WHERE id = $1",
        [sessionId],
      );
      expect(room.rows[0]).toEqual({
        recovery_pack_cards_enabled: false,
        recovery_pack_intervention: null,
        content_snapshot: content,
        revision: "1",
      });
      const receipt = await isolatedPool.query(
        "SELECT command_id, request_hash, expected_revision, resulting_revision FROM presentation_session_command_receipts WHERE session_id = $1",
        [sessionId],
      );
      expect(receipt.rows).toEqual([
        {
          command_id: commandId,
          request_hash: null,
          expected_revision: "0",
          resulting_revision: "1",
        },
      ]);
      const timeline = await isolatedPool.query(
        "SELECT event_type, recovery_pack_intervention FROM presentation_session_timeline WHERE session_id = $1",
        [sessionId],
      );
      expect(timeline.rows).toEqual([
        { event_type: "question.revealed", recovery_pack_intervention: null },
      ]);
      const isolation = await isolatedPool.query(
        `SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class
         WHERE relnamespace = $1::regnamespace AND relname = ANY($2::text[]) ORDER BY relname`,
        [
          schema,
          [
            "presentation_live_sessions",
            "presentation_session_timeline",
            "presentation_session_command_receipts",
          ],
        ],
      );
      expect(isolation.rows).toHaveLength(3);
      expect(isolation.rows.every((row) => row.relrowsecurity && row.relforcerowsecurity)).toBe(
        true,
      );
    } finally {
      await isolatedPool?.end();
      await adminPool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await adminPool.end();
      await rm(legacyDirectory, { recursive: true, force: true });
    }
  });

  it("backfills frozen Presentation Pack media on populated pre-053 documents without rewriting them", async () => {
    const schema = `openround_pack_media_upgrade_${randomUUID().replaceAll("-", "")}`;
    const migrationsDirectory = join(dirname(fileURLToPath(import.meta.url)), "../migrations");
    const prePackDirectory = await mkdtemp(join(tmpdir(), "openround-pre-presentation-pack-"));
    const adminPool = new Pool({ connectionString: adminUrl });
    let isolatedPool: Pool | undefined;
    try {
      const migrations = await discoverMigrations(migrationsDirectory);
      for (const migration of migrations.filter(({ version }) => version <= 52)) {
        await writeFile(join(prePackDirectory, migration.fileName), migration.sql);
      }
      await adminPool.query(`CREATE SCHEMA "${schema}"`);
      const isolatedUrl = new URL(adminUrl!);
      isolatedUrl.searchParams.set("options", `-csearch_path=${schema},public`);
      isolatedPool = new Pool({ connectionString: isolatedUrl.toString(), max: 1 });
      await runMigrations(isolatedPool, prePackDirectory);
      const userId = randomUUID();
      const workspaceId = randomUUID();
      const presentationId = randomUUID();
      const versionId = randomUUID();
      const historyId = randomUUID();
      const originalIds = Array.from({ length: 3 }, () => randomUUID());
      const acceptedIds = Array.from({ length: 3 }, () => randomUUID());
      const localMediaId = randomUUID();
      const draft = presentationPackMediaDraft(presentationPackContent(originalIds));
      const acceptedContent = presentationPackContent(acceptedIds);
      draft.recoveryPackInsertions![0]!.updateBaseline = {
        packVersionId: randomUUID(),
        packVersion: 2,
        contentHash: recoveryPackContentHash(acceptedContent),
        content: acceptedContent,
      };
      const recheck = draft.blocks[1]!;
      if (recheck.kind === "question") {
        recheck.question.mediaId = localMediaId;
        recheck.question.mediaAlt = "Locally edited recheck diagram";
      }
      await isolatedPool.query("SELECT set_config('app.system_access', 'on', false)");
      await isolatedPool.query("INSERT INTO users (id, email) VALUES ($1, $2)", [
        userId,
        `presentation-pack-upgrade-${userId}@example.com`,
      ]);
      await isolatedPool.query(
        "INSERT INTO workspaces (id, name, segment, owner_id) VALUES ($1, 'Pack migration', 'education', $2)",
        [workspaceId, userId],
      );
      for (const id of [...originalIds, ...acceptedIds, localMediaId]) {
        await isolatedPool.query(
          `INSERT INTO media_assets
             (id, workspace_id, object_key, mime_type, size_bytes, scan_status, alt_text)
           VALUES ($1, $2, $3, 'image/png', 10, 'clean', 'Frozen diagram')`,
          [id, workspaceId, `media/${workspaceId}/${id}.png`],
        );
      }
      await isolatedPool.query(
        `INSERT INTO presentations
           (id, workspace_id, title, description, draft, draft_schema_version, last_edited_by)
         VALUES ($1, $2, $3, '', $4::jsonb, 3, $5)`,
        [presentationId, workspaceId, draft.title, JSON.stringify(draft), userId],
      );
      await isolatedPool.query(
        `INSERT INTO presentation_versions
           (id, workspace_id, presentation_id, version, content, content_schema_version,
            content_hash, source_draft_revision)
         VALUES ($1, $2, $3, 1, $4::jsonb, 3, 'frozen-pack-migration', 0)`,
        [versionId, workspaceId, presentationId, JSON.stringify(draft)],
      );
      await isolatedPool.query(
        `INSERT INTO presentation_draft_history
           (id, workspace_id, presentation_id, revision, draft, draft_schema_version, saved_by)
         VALUES ($1, $2, $3, 0, $4::jsonb, 3, $5)`,
        [historyId, workspaceId, presentationId, JSON.stringify(draft), userId],
      );
      const existing = await isolatedPool.query<{ media_id: string }>(
        "SELECT media_id FROM media_references WHERE workspace_id = $1",
        [workspaceId],
      );
      expect(existing.rows.map(({ media_id }) => media_id)).toEqual([
        localMediaId,
        localMediaId,
        localMediaId,
      ]);
      await isolatedPool.query("SELECT set_config('app.system_access', 'off', false)");
      await runMigrations(isolatedPool, migrationsDirectory);
      await runMigrations(isolatedPool, migrationsDirectory);
      await isolatedPool.query("SELECT set_config('app.workspace_id', $1, false)", [workspaceId]);
      const references = await isolatedPool.query<{
        media_id: string;
        owner_type: string;
        owner_id: string;
      }>("SELECT media_id, owner_type, owner_id FROM media_references WHERE workspace_id = $1", [
        workspaceId,
      ]);
      expect(references.rows).toHaveLength(21);
      for (const [ownerType, ownerId] of [
        ["presentation_draft", presentationId],
        ["presentation_version", versionId],
        ["presentation_history", historyId],
      ]) {
        expect(
          references.rows
            .filter(({ owner_type, owner_id }) => owner_type === ownerType && owner_id === ownerId)
            .map(({ media_id }) => media_id)
            .sort(),
        ).toEqual([...originalIds, ...acceptedIds, localMediaId].sort());
      }
      const documents = await isolatedPool.query<{ document: unknown }>(
        `SELECT draft AS document FROM presentations WHERE id = $1
         UNION ALL SELECT content FROM presentation_versions WHERE id = $2
         UNION ALL SELECT draft FROM presentation_draft_history WHERE id = $3`,
        [presentationId, versionId, historyId],
      );
      expect(documents.rows.map(({ document }) => document)).toEqual([draft, draft, draft]);
      await expect(
        isolatedPool.query(
          "UPDATE presentation_versions SET content_hash = 'changed' WHERE id = $1",
          [versionId],
        ),
      ).rejects.toMatchObject({ code: "55000" });
    } finally {
      await isolatedPool?.end();
      await adminPool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await adminPool.end();
      await rm(prePackDirectory, { recursive: true, force: true });
    }
  });

  it("backfills revision metadata on a populated pre-018 schema and restores immutability", async () => {
    const schema = `openround_upgrade_${randomUUID().replaceAll("-", "")}`;
    const migrationsDirectory = join(dirname(fileURLToPath(import.meta.url)), "../migrations");
    const preRevisionDirectory = await mkdtemp(join(tmpdir(), "openround-pre-revision-"));
    const adminPool = new Pool({ connectionString: adminUrl });
    let isolatedPool: Pool | undefined;

    try {
      const migrations = await discoverMigrations(migrationsDirectory);
      for (const migration of migrations.filter(({ version }) => version <= 17)) {
        await writeFile(join(preRevisionDirectory, migration.fileName), migration.sql);
      }

      await adminPool.query(`CREATE SCHEMA "${schema}"`);
      const isolatedUrl = new URL(adminUrl!);
      isolatedUrl.searchParams.set("options", `-csearch_path=${schema},public`);
      isolatedPool = new Pool({ connectionString: isolatedUrl.toString(), max: 1 });

      await expect(
        isolatedPool.query<{ current_schema: string }>("SELECT current_schema()"),
      ).resolves.toMatchObject({ rows: [{ current_schema: schema }] });
      await runMigrations(isolatedPool, preRevisionDirectory);

      const ownerId = randomUUID();
      const workspaceId = randomUUID();
      const quizId = randomUUID();
      const versionId = randomUUID();
      const draft = publishableRound("Legacy published round");
      const preMigrationClient = await isolatedPool.connect();
      try {
        await preMigrationClient.query("SELECT set_config('app.system_access', 'on', false)");
        await preMigrationClient.query("BEGIN");
        await preMigrationClient.query("INSERT INTO users (id, email) VALUES ($1, $2)", [
          ownerId,
          `upgrade-${ownerId}@example.com`,
        ]);
        await preMigrationClient.query(
          `INSERT INTO workspaces (id, name, segment, owner_id)
           VALUES ($1, 'Upgrade audit', 'workplace', $2)`,
          [workspaceId, ownerId],
        );
        await preMigrationClient.query(
          `INSERT INTO workspace_members (workspace_id, user_id, role)
           VALUES ($1, $2, 'owner')`,
          [workspaceId, ownerId],
        );
        await preMigrationClient.query(
          `INSERT INTO quizzes
             (id, workspace_id, title, description, status, draft, current_version_id)
           VALUES ($1, $2, $3, '', 'draft', $4::jsonb, NULL)`,
          [quizId, workspaceId, draft.title, JSON.stringify(draft)],
        );
        await preMigrationClient.query(
          `INSERT INTO quiz_versions
             (id, workspace_id, quiz_id, version, content, content_hash)
           VALUES ($1, $2, $3, 1, $4::jsonb, 'legacy-content-hash')`,
          [versionId, workspaceId, quizId, JSON.stringify(draft)],
        );
        await preMigrationClient.query(
          `UPDATE quizzes
           SET current_version_id = $1, status = 'published'
           WHERE id = $2`,
          [versionId, quizId],
        );
        await preMigrationClient.query("COMMIT");

        await expect(
          preMigrationClient.query(
            "UPDATE quiz_versions SET content_hash = 'must-remain-blocked' WHERE id = $1",
            [versionId],
          ),
        ).rejects.toMatchObject({ code: "55000" });
      } catch (error) {
        await preMigrationClient.query("ROLLBACK").catch(() => undefined);
        throw error;
      } finally {
        preMigrationClient.release();
      }

      await runMigrations(isolatedPool, migrationsDirectory);

      const verificationClient = await isolatedPool.connect();
      try {
        await verificationClient.query("SELECT set_config('app.system_access', 'on', false)");
        await expect(
          verificationClient.query<{
            draft_revision: string;
            published_draft_revision: string;
            source_draft_revision: string;
          }>(
            `SELECT quiz.draft_revision, quiz.published_draft_revision,
                    version.source_draft_revision
             FROM quizzes AS quiz
             JOIN quiz_versions AS version ON version.id = quiz.current_version_id
             WHERE quiz.id = $1`,
            [quizId],
          ),
        ).resolves.toMatchObject({
          rows: [
            {
              draft_revision: "0",
              published_draft_revision: "0",
              source_draft_revision: "0",
            },
          ],
        });

        await expect(
          verificationClient.query<{ tgenabled: string }>(
            `SELECT tgenabled
             FROM pg_trigger
             WHERE tgrelid = 'quiz_versions'::regclass
               AND tgname = 'quiz_versions_immutable'
               AND NOT tgisinternal`,
          ),
        ).resolves.toMatchObject({ rows: [{ tgenabled: "O" }] });
        await expect(
          verificationClient.query(
            "UPDATE quiz_versions SET content_hash = 'still-blocked' WHERE id = $1",
            [versionId],
          ),
        ).rejects.toMatchObject({ code: "55000" });

        await expect(
          verificationClient.query<{ locale_explicit: boolean }>(
            "SELECT locale_explicit FROM users WHERE id = $1",
            [ownerId],
          ),
        ).resolves.toMatchObject({ rows: [{ locale_explicit: false }] });

        await expect(
          verificationClient.query<{ count: string; maximum: number }>(
            "SELECT count(*) AS count, max(version) AS maximum FROM _openround_migrations",
          ),
        ).resolves.toMatchObject({
          rows: [
            {
              count: String(migrations.length),
              maximum: migrations.at(-1)!.version,
            },
          ],
        });

        await expect(
          verificationClient.query(
            `INSERT INTO product_events
               (id, workspace_id, event_name, dimensions, occurred_at, expires_at)
             VALUES ($1, $2, 'draft_conflict', $3::jsonb, now(), now() + interval '1 day')`,
            [randomUUID(), workspaceId, JSON.stringify({ artifactType: "presentation" })],
          ),
        ).resolves.toMatchObject({ rowCount: 1 });
        await expect(
          verificationClient.query(
            `INSERT INTO product_events
               (id, workspace_id, event_name, dimensions, occurred_at, expires_at)
             VALUES ($1, $2, 'draft_conflict', $3::jsonb, now(), now() + interval '1 day')`,
            [randomUUID(), workspaceId, JSON.stringify({ artifactType: "unknown" })],
          ),
        ).rejects.toMatchObject({ code: "23514" });
        await expect(
          verificationClient.query(
            `INSERT INTO product_events
               (id, workspace_id, event_name, dimensions, occurred_at, expires_at)
             VALUES ($1, $2, 'draft_conflict', $3::jsonb, now(), now() + interval '1 day')`,
            [randomUUID(), workspaceId, JSON.stringify({ freeForm: "private" })],
          ),
        ).rejects.toMatchObject({ code: "23514" });
      } finally {
        verificationClient.release();
      }
    } finally {
      await isolatedPool?.end();
      await adminPool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await adminPool.end();
      await rm(preRevisionDirectory, { recursive: true, force: true });
    }
  });

  it("aligns old and new Presentation fences for sessions populated before realtime migration", async () => {
    const schema = `openround_sequence_upgrade_${randomUUID().replaceAll("-", "")}`;
    const migrationsDirectory = join(dirname(fileURLToPath(import.meta.url)), "../migrations");
    const preRealtimeDirectory = await mkdtemp(join(tmpdir(), "openround-pre-realtime-"));
    const adminPool = new Pool({ connectionString: adminUrl });
    let isolatedPool: Pool | undefined;

    try {
      const migrations = await discoverMigrations(migrationsDirectory);
      for (const migration of migrations.filter(({ version }) => version <= 31)) {
        await writeFile(join(preRealtimeDirectory, migration.fileName), migration.sql);
      }

      await adminPool.query(`CREATE SCHEMA "${schema}"`);
      const isolatedUrl = new URL(adminUrl!);
      isolatedUrl.searchParams.set("options", `-csearch_path=${schema},public`);
      isolatedPool = new Pool({ connectionString: isolatedUrl.toString(), max: 1 });
      await runMigrations(isolatedPool, preRealtimeDirectory);

      const ownerId = randomUUID();
      const workspaceId = randomUUID();
      const presentationId = randomUUID();
      const versionId = randomUUID();
      const blockId = randomUUID();
      const questionId = randomUUID();
      const now = new Date();
      const content = {
        title: "Legacy sequence fixture",
        description: "Populated before the realtime migration",
        experiencePreset: { id: "focus", version: 1 },
        schemaVersion: 1,
        blocks: [
          {
            id: blockId,
            kind: "question",
            question: {
              id: questionId,
              type: "numeric",
              prompt: "How many?",
              correctValue: "2",
              tolerance: "0",
              unit: null,
              timeLimitSeconds: 30,
              basePoints: 1_000,
              explanation: "Two.",
              mediaId: null,
              mediaAlt: null,
            },
          },
        ],
      } as unknown as PresentationDraft;
      const fixtures = [
        {
          sessionId: randomUUID(),
          code: "8100001",
          terminalSequence: 2,
          status: "active" as const,
          phase: "question_reveal" as const,
          finishedAt: null,
          liveExpiresAt: new Date(now.getTime() + 60 * 60_000),
        },
        {
          sessionId: randomUUID(),
          code: "8100002",
          terminalSequence: 9,
          status: "finished" as const,
          phase: "finished" as const,
          finishedAt: now,
          liveExpiresAt: new Date(now.getTime() + 2 * 60 * 60_000),
        },
      ];
      const participantIds = new Map<string, string[]>();

      const fixtureClient = await isolatedPool.connect();
      try {
        await fixtureClient.query("SELECT set_config('app.system_access', 'on', false)");
        await fixtureClient.query("BEGIN");
        await fixtureClient.query("INSERT INTO users (id, email) VALUES ($1, $2)", [
          ownerId,
          `sequence-upgrade-${ownerId}@example.com`,
        ]);
        await fixtureClient.query(
          `INSERT INTO workspaces (id, name, segment, owner_id)
           VALUES ($1, 'Sequence upgrade', 'workplace', $2)`,
          [workspaceId, ownerId],
        );
        await fixtureClient.query(
          `INSERT INTO workspace_members (workspace_id, user_id, role)
           VALUES ($1, $2, 'owner')`,
          [workspaceId, ownerId],
        );
        await fixtureClient.query(
          `INSERT INTO presentations
             (id, workspace_id, title, description, status, draft, current_version_id,
              last_edited_by, created_at, updated_at)
           VALUES ($1, $2, $3, $4, 'draft', $5::jsonb, NULL, $6, $7, $7)`,
          [
            presentationId,
            workspaceId,
            content.title,
            content.description,
            JSON.stringify(content),
            ownerId,
            now,
          ],
        );
        await fixtureClient.query(
          `INSERT INTO presentation_versions
             (id, workspace_id, presentation_id, version, content, content_hash,
              source_draft_revision, published_at)
           VALUES ($1, $2, $3, 1, $4::jsonb, 'sequence-upgrade', 0, $5)`,
          [versionId, workspaceId, presentationId, JSON.stringify(content), now],
        );
        await fixtureClient.query(
          `UPDATE presentations
              SET current_version_id = $1, status = 'published', published_draft_revision = 0
            WHERE id = $2`,
          [versionId, presentationId],
        );

        for (const fixture of fixtures) {
          await fixtureClient.query(
            `INSERT INTO presentation_live_sessions
               (id, workspace_id, presentation_id, presentation_version_id, title,
                content_snapshot, join_code, status, phase, current_block_index, revision,
                created_by, created_at, updated_at, finished_at, live_expires_at,
                retention_expires_at)
             VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, 0, 2,
                     $10, $11, $11, $12, $13, $14)`,
            [
              fixture.sessionId,
              workspaceId,
              presentationId,
              versionId,
              content.title,
              JSON.stringify(content),
              fixture.code,
              fixture.status,
              fixture.phase,
              ownerId,
              now,
              fixture.finishedAt,
              fixture.liveExpiresAt,
              new Date(now.getTime() + 30 * 24 * 60 * 60_000),
            ],
          );
          const participants = [randomUUID(), randomUUID(), randomUUID()];
          participantIds.set(fixture.sessionId, participants);
          for (const [index, participantId] of participants.entries()) {
            await fixtureClient.query(
              `INSERT INTO presentation_live_participants
                 (id, workspace_id, session_id, nickname, token_hash, joined_at, last_seen_at)
               VALUES ($1, $2, $3, $4, $5, $6, $6)`,
              [
                participantId,
                workspaceId,
                fixture.sessionId,
                `Participant ${index + 1}`,
                createHash("sha256").update(`${fixture.sessionId}:${participantId}`).digest("hex"),
                now,
              ],
            );
          }
          for (const participantId of participants.slice(0, 2)) {
            await fixtureClient.query(
              `INSERT INTO presentation_live_responses
                 (id, workspace_id, session_id, participant_id, block_id, question_id,
                  response, correct, score, response_ms, submitted_at)
               VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, true, 1000, 500, $8)`,
              [
                randomUUID(),
                workspaceId,
                fixture.sessionId,
                participantId,
                blockId,
                questionId,
                JSON.stringify({ value: "2" }),
                now,
              ],
            );
          }
          await fixtureClient.query(
            `INSERT INTO presentation_session_timeline
               (id, workspace_id, session_id, sequence, event_type, block_index, block_id,
                occurred_at)
             VALUES ($1, $2, $3, 1, 'presentation.started', NULL, NULL, $5),
                    ($6, $2, $3, $4, 'question.revealed', 0, $7, $5)`,
            [
              randomUUID(),
              workspaceId,
              fixture.sessionId,
              fixture.terminalSequence,
              now,
              randomUUID(),
              blockId,
            ],
          );
        }
        await fixtureClient.query("COMMIT");
      } catch (error) {
        await fixtureClient.query("ROLLBACK").catch(() => undefined);
        throw error;
      } finally {
        fixtureClient.release();
      }

      await expect(runMigrations(isolatedPool, migrationsDirectory)).rejects.toThrow(
        "unexpired Presentation session has a stored event sequence above its aggregate fence",
      );
      const gateResolutionClient = await isolatedPool.connect();
      try {
        await gateResolutionClient.query("SELECT set_config('app.system_access', 'on', false)");
        await gateResolutionClient.query(
          `UPDATE presentation_live_sessions
              SET live_expires_at = $2
            WHERE id = $1`,
          [fixtures[1]!.sessionId, new Date(now.getTime() - 60_000)],
        );
      } finally {
        gateResolutionClient.release();
      }
      await runMigrations(isolatedPool, migrationsDirectory);

      const verificationClient = await isolatedPool.connect();
      try {
        await verificationClient.query("SELECT set_config('app.system_access', 'on', false)");
        const readFence = async (sessionId: string) => {
          const result = await verificationClient.query<{
            event_seq: string;
            event_seq_offset: string;
            aggregate_event_seq: string;
            effective_event_seq: string;
          }>(
            `SELECT session.event_seq,
                    session.event_seq_offset,
                    session.revision
                      + (SELECT count(*) FROM presentation_live_participants AS participant
                         WHERE participant.session_id = session.id)
                      + (SELECT count(*) FROM presentation_live_responses AS response
                         WHERE response.session_id = session.id) AS aggregate_event_seq,
                    session.event_seq_offset
                      + session.revision
                      + (SELECT count(*) FROM presentation_live_participants AS participant
                         WHERE participant.session_id = session.id)
                      + (SELECT count(*) FROM presentation_live_responses AS response
                         WHERE response.session_id = session.id) AS effective_event_seq
               FROM presentation_live_sessions AS session
              WHERE session.id = $1`,
            [sessionId],
          );
          return result.rows[0]!;
        };

        await expect(readFence(fixtures[0]!.sessionId)).resolves.toEqual({
          event_seq: "7",
          event_seq_offset: "0",
          aggregate_event_seq: "7",
          effective_event_seq: "7",
        });
        await expect(readFence(fixtures[1]!.sessionId)).resolves.toEqual({
          event_seq: "9",
          event_seq_offset: "2",
          aggregate_event_seq: "7",
          effective_event_seq: "9",
        });

        await verificationClient.query(
          `INSERT INTO presentation_session_timeline
             (id, workspace_id, session_id, sequence, event_type, block_index, block_id,
              occurred_at)
           VALUES ($1, $2, $3, 20, 'question.revealed', 0, $4, $5)`,
          [randomUUID(), workspaceId, fixtures[1]!.sessionId, blockId, now],
        );
        await expect(readFence(fixtures[1]!.sessionId)).resolves.toEqual({
          event_seq: "20",
          event_seq_offset: "13",
          aggregate_event_seq: "7",
          effective_event_seq: "20",
        });

        await verificationClient.query(
          "SELECT set_config('app.presentation_concurrent_response_writes', 'on', false)",
        );
        await verificationClient.query(
          `INSERT INTO presentation_live_responses
             (id, workspace_id, session_id, participant_id, block_id, question_id,
              response, correct, score, response_ms, submitted_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, true, 1000, 500, $8)`,
          [
            randomUUID(),
            workspaceId,
            fixtures[1]!.sessionId,
            participantIds.get(fixtures[1]!.sessionId)![2],
            blockId,
            questionId,
            JSON.stringify({ value: "2" }),
            now,
          ],
        );
        await expect(readFence(fixtures[1]!.sessionId)).resolves.toEqual({
          event_seq: "20",
          event_seq_offset: "13",
          aggregate_event_seq: "8",
          effective_event_seq: "21",
        });

        await verificationClient.query(
          `UPDATE presentation_live_sessions
              SET revision = revision + 1,
                  event_seq = event_seq + 1
            WHERE id = $1`,
          [fixtures[1]!.sessionId],
        );
        await verificationClient.query(
          `INSERT INTO presentation_session_timeline
             (id, workspace_id, session_id, sequence, event_type, block_index, block_id,
              occurred_at)
           VALUES ($1, $2, $3, 22, 'question.revealed', 0, $4, $5)`,
          [randomUUID(), workspaceId, fixtures[1]!.sessionId, blockId, now],
        );
        await expect(readFence(fixtures[1]!.sessionId)).resolves.toEqual({
          event_seq: "22",
          event_seq_offset: "13",
          aggregate_event_seq: "9",
          effective_event_seq: "22",
        });
      } finally {
        verificationClient.release();
      }
    } finally {
      await isolatedPool?.end();
      await adminPool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await adminPool.end();
      await rm(preRealtimeDirectory, { recursive: true, force: true });
    }
  });
});

describe.skipIf(!adminUrl)("PostgreSQL media cleanup migration", () => {
  it("backfills old finalized media directly into the final sweep", async () => {
    const schema = `openround_cleanup_${randomUUID().replaceAll("-", "")}`;
    const migrationsDirectory = join(dirname(fileURLToPath(import.meta.url)), "../migrations");
    const preCleanupDirectory = await mkdtemp(join(tmpdir(), "openround-pre-cleanup-"));
    const adminPool = new Pool({ connectionString: adminUrl });
    let isolatedPool: Pool | undefined;

    try {
      const migrations = await discoverMigrations(migrationsDirectory);
      for (const migration of migrations.filter(({ version }) => version <= 42)) {
        await writeFile(join(preCleanupDirectory, migration.fileName), migration.sql);
      }
      await adminPool.query(`CREATE SCHEMA "${schema}"`);
      const isolatedUrl = new URL(adminUrl!);
      isolatedUrl.searchParams.set("options", `-csearch_path=${schema},public`);
      isolatedPool = new Pool({ connectionString: isolatedUrl.toString(), max: 1 });
      await runMigrations(isolatedPool, preCleanupDirectory);
      await isolatedPool.query("SELECT set_config('app.system_access', 'on', false)");

      const ownerId = randomUUID();
      const workspaceId = randomUUID();
      const oldId = randomUUID();
      const recentId = randomUUID();
      const legacyId = randomUUID();
      const oldFinalizedAt = new Date(Date.now() - 8 * 24 * 60 * 60_000);
      const recentFinalizedAt = new Date(Date.now() - 2 * 24 * 60 * 60_000);
      await isolatedPool.query("INSERT INTO users (id, email) VALUES ($1, $2)", [
        ownerId,
        `cleanup-${ownerId}@example.com`,
      ]);
      await isolatedPool.query(
        "INSERT INTO workspaces (id, name, segment, owner_id) VALUES ($1, 'Cleanup upgrade', 'workplace', $2)",
        [workspaceId, ownerId],
      );
      for (const [id, finalizedAt] of [
        [oldId, oldFinalizedAt],
        [recentId, recentFinalizedAt],
        [legacyId, null],
      ] as const) {
        await isolatedPool.query(
          `INSERT INTO media_assets
             (id, workspace_id, object_key, mime_type, size_bytes, scan_status,
              alt_text, created_at, finalized_at)
           VALUES ($1, $2, $3, 'image/png', 128, 'clean', 'A chart', $4, $5)`,
          [id, workspaceId, `media/${workspaceId}/${id}.png`, oldFinalizedAt, finalizedAt],
        );
      }

      await runMigrations(isolatedPool, migrationsDirectory);
      const migrated = await isolatedPool.query<{
        id: string;
        object_cleanup_pass: number;
        object_cleanup_due_at: Date | null;
        cleanup_due_now: boolean | null;
      }>(
        `SELECT id, object_cleanup_pass, object_cleanup_due_at,
                object_cleanup_due_at <= now() AS cleanup_due_now
         FROM media_assets WHERE id = ANY($1::uuid[])`,
        [[oldId, recentId, legacyId]],
      );
      const byId = new Map(migrated.rows.map((row) => [row.id, row]));
      expect(byId.get(oldId)).toMatchObject({ object_cleanup_pass: 1, cleanup_due_now: true });
      expect(byId.get(recentId)).toMatchObject({ object_cleanup_pass: 0 });
      expect(byId.get(recentId)?.object_cleanup_due_at).toEqual(recentFinalizedAt);
      expect(byId.get(legacyId)).toMatchObject({
        object_cleanup_pass: 0,
        object_cleanup_due_at: null,
      });
    } finally {
      await isolatedPool?.end();
      await adminPool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await adminPool.end();
      await rm(preCleanupDirectory, { recursive: true, force: true });
    }
  });
});

describe.skipIf(!enabled)("PostgreSQL row-level isolation", () => {
  let repository: PostgresRepository;
  let runtimePool: Pool;

  beforeAll(async () => {
    const adminPool = new Pool({ connectionString: adminUrl });
    const database = await adminPool.query<{ current_database: string }>(
      "SELECT current_database()",
    );
    const databaseIdentifier = database.rows[0]!.current_database.replaceAll('"', '""');
    await adminPool.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'openround_runtime') THEN
          CREATE ROLE openround_runtime NOLOGIN;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'openround_test_app') THEN
          CREATE ROLE openround_test_app LOGIN PASSWORD 'test-only-runtime';
        END IF;
      END $$;
      GRANT openround_runtime TO openround_test_app;
      GRANT CONNECT ON DATABASE "${databaseIdentifier}" TO openround_test_app;
    `);
    await adminPool.end();

    const migrationRepository = new PostgresRepository(adminUrl!);
    await migrationRepository.migrate();
    await migrationRepository.migrate();
    const migrations = await migrationRepository.pool.query<{
      version: number;
      name: string;
    }>("SELECT version, name FROM _openround_migrations ORDER BY version");
    expect(migrations.rows).toEqual([
      { version: 1, name: "initial" },
      { version: 2, name: "versioned_product_foundation" },
      { version: 3, name: "collaboration_and_qna" },
      { version: 4, name: "library_organization" },
      { version: 5, name: "secure_presenter_embed" },
      { version: 6, name: "self_paced_followups" },
      { version: 7, name: "authoring_assistant" },
      { version: 8, name: "authoring_apply_idempotency" },
      { version: 9, name: "institution_identity_foundation" },
      { version: 10, name: "lti_launch_and_deep_linking" },
      { version: 11, name: "audience_interactions" },
      { version: 12, name: "interaction_feature_flags" },
      { version: 13, name: "close_finished_interactions" },
      { version: 14, name: "ux_beta_foundation" },
      { version: 15, name: "product_event_funnel" },
      { version: 16, name: "round_last_hosted_indexes" },
      { version: 17, name: "round_practice_assignments" },
      { version: 18, name: "round_authoring_revisions" },
      { version: 19, name: "presentations" },
      { version: 20, name: "presentation_live_sessions" },
      { version: 21, name: "collaboration_groups" },
      { version: 22, name: "presentation_session_retention" },
      { version: 23, name: "presentation_live_scoring" },
      { version: 24, name: "media_references" },
      { version: 25, name: "round_draft_history" },
      { version: 26, name: "library_metadata" },
      { version: 27, name: "artifact_schema_versions" },
      { version: 28, name: "authoring_product_events" },
      { version: 29, name: "presentation_live_expiry" },
      { version: 30, name: "presentation_noop_mutations" },
      { version: 31, name: "user_locale_preference" },
      { version: 32, name: "presentation_realtime_foundation" },
      { version: 33, name: "trust_and_session_event_foundation" },
      { version: 34, name: "live_room_code_registry" },
      { version: 35, name: "recovery_funnel_events" },
      { version: 36, name: "presentation_session_reports" },
      { version: 37, name: "backfill_presentation_session_reports" },
      { version: 38, name: "presentation_concurrent_event_sequence" },
      { version: 39, name: "presentation_event_sequence_compatibility" },
      { version: 40, name: "presentation_event_sequence_compatibility_backfill" },
      { version: 41, name: "media_deletion_tombstone" },
      { version: 42, name: "workspace_deletion_cleanup" },
      { version: 43, name: "bounded_media_object_cleanup" },
      { version: 44, name: "round_flex_deadlines" },
      { version: 45, name: "question_health_dismissals" },
      { version: 46, name: "question_health_applications" },
      { version: 47, name: "session_decision_replay" },
      { version: 48, name: "library_artifact_deletion" },
      { version: 49, name: "recovery_packs" },
      { version: 50, name: "recovery_pack_update_media" },
      { version: 51, name: "recovery_pack_update_undo" },
      { version: 52, name: "recovery_pack_live_cards" },
      { version: 53, name: "recovery_pack_presentation_media" },
      { version: 54, name: "recovery_pack_presentation_undo" },
      { version: 55, name: "recovery_pack_presentation_live_cards" },
      { version: 56, name: "recovery_pack_practice" },
      { version: 57, name: "recovery_pack_sequence_practice" },
      { version: 58, name: "recovery_pack_source_authoring" },
      { version: 59, name: "audience_scope_foundation" },
      { version: 60, name: "scoped_qna" },
      { version: 61, name: "surveys" },
      { version: 62, name: "survey_room_receipt_cleanup" },
    ]);

    // An existing P0 database has the full schema but no ledger. Replaying the
    // idempotent baseline must safely bootstrap tracking before later migrations.
    await migrationRepository.pool.query("DROP TABLE _openround_migrations");
    await migrationRepository.migrate();
    const bootstrapped = await migrationRepository.pool.query<{ count: string }>(
      "SELECT count(*) FROM _openround_migrations",
    );
    expect(bootstrapped.rows[0]?.count).toBe(String(migrations.rows.length));

    const migrationsDirectory = join(dirname(fileURLToPath(import.meta.url)), "../migrations");
    const alteredDirectory = await mkdtemp(join(tmpdir(), "openround-altered-migrations-"));
    try {
      await cp(migrationsDirectory, alteredDirectory, { recursive: true });
      const initialPath = join(alteredDirectory, "001_initial.sql");
      const initial = await readFile(initialPath, "utf8");
      await writeFile(initialPath, `${initial}\n-- modified after application\n`);
      const alteredRepository = new PostgresRepository(adminUrl!, {
        migrationsDirectory: alteredDirectory,
      });
      await expect(alteredRepository.migrate()).rejects.toThrow("Checksum mismatch");
      await alteredRepository.close();
    } finally {
      await rm(alteredDirectory, { recursive: true, force: true });
    }
    await migrationRepository.close();

    repository = new PostgresRepository(runtimeUrl!);
    runtimePool = new Pool({ connectionString: runtimeUrl });
    await repository.initialize();
  });

  afterAll(async () => {
    await repository?.close();
    await runtimePool?.end();
  });

  async function creator(label: string) {
    const tokenHash = `test-${label}-${randomUUID()}`;
    await repository.createMagicToken({
      id: randomUUID(),
      email: `${label}-${randomUUID()}@example.com`,
      segment: "education",
      tokenHash,
      policyVersion: "test-v1",
      expiresAt: new Date(Date.now() + 60_000),
      consumedAt: null,
    });
    const result = await repository.consumeMagicToken(tokenHash, new Date());
    expect(result).not.toBeNull();
    return result!;
  }

  it("supports self-paced Surveys through the restricted PostgreSQL runtime", async () => {
    const actor = await creator("survey-conformance");
    await expectSurveyConformance(repository, actor.workspaceId);
    expect((await runtimePool.query("SELECT * FROM survey_guests")).rows).toHaveLength(0);
  });

  it("forward-repairs old room creation receipts and preserves unrelated Survey retries", async () => {
    const actor = await creator("survey-receipt-repair");
    const surveys = createSurveyRepository(repository);
    const id = randomUUID();
    const createKey = randomUUID();
    const roomKey = randomUUID();
    const orphanKey = randomUUID();
    await surveys.create(actor.workspaceId, id, surveyFixture(), createKey);
    await surveys.publish(actor.workspaceId, id, 0, randomUUID(), 5);
    const settings = {
      code: String(randomInt(1000000, 10000000)),
      closesAt: new Date(Date.now() + 86400000).toISOString(),
      expiresAt: new Date(Date.now() + 30 * 86400000).toISOString(),
      participantLimit: 20,
      windowDays: 1,
    };
    const room = await surveys.createRoom(actor.workspaceId, id, 0, roomKey, settings);
    const repair = await readFile(
      join(
        dirname(fileURLToPath(import.meta.url)),
        "../migrations/062_survey_room_receipt_cleanup.sql",
      ),
      "utf8",
    );
    const client = await runtimePool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.workspace_id', $1, true)", [actor.workspaceId]);
      await client.query(
        "UPDATE survey_mutation_receipts SET room_id = NULL WHERE owner_id = $1 AND idempotency_key = $2",
        [id, roomKey],
      );
      await client.query(
        "INSERT INTO survey_mutation_receipts (workspace_id, survey_id, owner_id, idempotency_key, request_hash, receipt) SELECT workspace_id, survey_id, owner_id, $3, request_hash, jsonb_set(receipt, '{id}', to_jsonb($4::text)) FROM survey_mutation_receipts WHERE owner_id = $1 AND idempotency_key = $2",
        [id, roomKey, orphanKey, randomUUID()],
      );
      await client.query(repair);
      await client.query(repair);
      const receipts = await client.query(
        "SELECT idempotency_key, room_id FROM survey_mutation_receipts WHERE workspace_id = $1 AND owner_id = $2",
        [actor.workspaceId, id],
      );
      expect(receipts.rows).toContainEqual({ idempotency_key: roomKey, room_id: room.id });
      expect(receipts.rows).toContainEqual({ idempotency_key: createKey, room_id: null });
      expect(receipts.rows.some((r) => r.idempotency_key === orphanKey)).toBe(false);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    expect(await surveys.createRoom(actor.workspaceId, id, 0, roomKey, settings)).toEqual(room);
    await surveys.deleteRoom(actor.workspaceId, room.id);
    expect((await surveys.createRoom(actor.workspaceId, id, 0, roomKey, settings)).id).not.toBe(
      room.id,
    );
  });

  async function packPracticeScoped<T>(
    workspaceId: string,
    work: (client: PoolClient) => Promise<T>,
  ) {
    const client = await runtimePool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.workspace_id', $1, true)", [workspaceId]);
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

  async function createPublishedRoundFixture(
    owner: Awaited<ReturnType<typeof creator>>,
    label: string,
    copiedContent?: QuizDraft,
  ) {
    const now = new Date();
    const content = copiedContent ?? publishableRound(label);
    const quiz = await repository.createQuiz({
      id: randomUUID(),
      workspaceId: owner.workspaceId,
      title: content.title,
      description: content.description,
      status: "draft",
      draft: content,
      currentVersionId: null,
      createdAt: now,
      updatedAt: now,
    });
    const version = await repository.publishQuiz({
      id: randomUUID(),
      workspaceId: owner.workspaceId,
      quizId: quiz.id,
      version: 1,
      content,
      contentHash: randomUUID(),
      publishedAt: now,
    });
    return { content, version };
  }

  it("keeps PostgreSQL published question metadata bounded, safe, and tenant-isolated", async () => {
    const owner = await creator("published-question-metadata-owner");
    const other = await creator("published-question-metadata-other");
    await expectPublishedQuestionLiveMetadataConformance({
      repository,
      workspaceId: owner.workspaceId,
      otherWorkspaceId: other.workspaceId,
    });
  });

  it("does not offer unsupported stored Round schemas from the PostgreSQL question catalog", async () => {
    const owner = await creator("published-question-future-schema");
    const other = await creator("published-question-future-schema-other");
    await expectPublishedQuestionLiveMetadataSchemaConformance({
      repository,
      workspaceId: owner.workspaceId,
      otherWorkspaceId: other.workspaceId,
      storeUnsupportedVersion: async ({ version, content, makeCurrent }) => {
        const futureVersionId = randomUUID();
        await packPracticeScoped(version.workspaceId, async (client) => {
          // Simulate a later publisher without changing immutable records or disabling guards.
          await client.query(
            `INSERT INTO quiz_versions (id, workspace_id, quiz_id, version, content,
               content_schema_version, content_hash, published_at)
             SELECT $3, workspace_id, quiz_id, version + 1, $4::jsonb, 99, $5, published_at
             FROM quiz_versions WHERE workspace_id = $1 AND id = $2`,
            [
              version.workspaceId,
              version.id,
              futureVersionId,
              JSON.stringify(content),
              "a".repeat(64),
            ],
          );
          if (makeCurrent) {
            await client.query(
              "UPDATE quizzes SET current_version_id = $3 WHERE workspace_id = $1 AND id = $2",
              [version.workspaceId, version.quizId, futureVersionId],
            );
          }
        });
        return futureVersionId;
      },
    });
  });

  it("persists source Recovery Packs with approval intent, exact citations, restores and publish fencing", async () => {
    const owner = await creator("source-recovery-pack-owner");
    const other = await creator("source-recovery-pack-other");
    await expectRecoveryPackSourceConformance({
      repository: createRecoveryPackRepository(repository),
      workspaceId: owner.workspaceId,
      otherWorkspaceId: other.workspaceId,
      editorId: owner.userId,
    });
  });

  it("retains source review evidence across job expiry with forced tenant isolation and account cascades", async () => {
    const owner = await creator("source-recovery-pack-retention");
    const other = await creator("source-recovery-pack-isolation");
    const packs = createRecoveryPackRepository(repository);
    const fixture = sourcePackFixture(owner.workspaceId, owner.userId);
    await createExpiringSourceJob(repository, fixture);
    const mutationId = randomUUID();
    const requestHash = "c".repeat(64);
    const pack = await packs.createSourceRecoveryPack(
      fixture.record,
      fixture.provenance,
      mutationId,
      requestHash,
    );
    const approval = {
      workspaceId: owner.workspaceId,
      packId: pack.id,
      editorId: owner.userId,
      expectedDraftRevision: 0,
      expectedContentHash: pack.sourceReview!.contentHash!,
      sourceDigest: fixture.provenance.sourceDigest,
      sourceOutputHash: fixture.provenance.sourceOutputHash,
      mutationId: randomUUID(),
    };
    await packs.approveRecoveryPackSource(approval);
    const client = await runtimePool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.workspace_id', $1, true)", [other.workspaceId]);
      for (const table of ["recovery_pack_sources", "recovery_pack_source_approvals"])
        expect(
          (await client.query(`SELECT * FROM ${table} WHERE pack_id = $1`, [pack.id])).rows,
        ).toEqual([]);
      await client.query("ROLLBACK");
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.workspace_id', $1, true)", [owner.workspaceId]);
      await expect(
        client.query("UPDATE recovery_pack_sources SET source_name = 'forged' WHERE pack_id = $1", [
          pack.id,
        ]),
      ).rejects.toMatchObject({ code: "42501" });
      await client.query("ROLLBACK");
      const security = await client.query<{ relforcerowsecurity: boolean }>(
        "SELECT relforcerowsecurity FROM pg_class WHERE relname IN ('recovery_pack_sources', 'recovery_pack_source_approvals')",
      );
      expect(security.rows).toHaveLength(2);
      expect(security.rows.every((row) => row.relforcerowsecurity)).toBe(true);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
    const exported = await repository.exportAccount(owner.userId);
    expect(exported.recoveryPackSources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          pack_id: pack.id,
          citation_catalog: fixture.provenance.citationCatalog,
        }),
      ]),
    );
    expect(exported.recoveryPackSourceApprovals).toEqual(
      expect.arrayContaining([expect.objectContaining({ mutation_id: approval.mutationId })]),
    );
    await repository.purgeExpired(new Date(Date.now() + 31 * 86_400_000));
    expect(
      await repository.getAuthoringJob(owner.workspaceId, fixture.provenance.authoringJobId),
    ).toBeNull();
    expect((await packs.getRecoveryPack(owner.workspaceId, pack.id))?.sourceReview?.approved).toBe(
      true,
    );
    expect(
      await packs.replaySourceRecoveryPack(owner.workspaceId, mutationId, requestHash),
    ).toMatchObject({ id: pack.id });
    expect((await repository.exportAccount(owner.userId)).recoveryPackSourceApprovals).toEqual([]);
    await repository.deleteAccount(owner.userId);
    expect(
      await packs.replaySourceRecoveryPack(owner.workspaceId, mutationId, requestHash),
    ).toBeNull();
    expect((await repository.exportAccount(other.userId)).recoveryPackSources).toEqual([]);
  });

  it("persists Recovery Packs with mutation replay, version ordering, and forced tenant isolation", async () => {
    const owner = await creator("recovery-pack-owner");
    const other = await creator("recovery-pack-other");
    const packs = createRecoveryPackRepository(repository);
    await expectRecoveryPackRepositoryConformance({
      repository: packs,
      workspaceId: owner.workspaceId,
      otherWorkspaceId: other.workspaceId,
      editorId: owner.userId,
    });

    const pack = await packs.createRecoveryPack(
      recoveryPackRecord(owner.workspaceId, owner.userId),
    );
    const content = RecoveryPackContentSchema.parse(pack.draft);
    const published = await packs.publishRecoveryPack(
      {
        id: randomUUID(),
        workspaceId: owner.workspaceId,
        packId: pack.id,
        version: 1,
        content,
        contentHash: createHash("sha256").update(JSON.stringify(content)).digest("hex"),
        sourceDraftRevision: 0,
        publishedAt: new Date(),
      },
      0,
    );
    const client = await runtimePool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.workspace_id', $1, true)", [other.workspaceId]);
      expect(
        (await client.query("SELECT id FROM recovery_packs WHERE id = $1", [pack.id])).rows,
      ).toEqual([]);
      expect(
        (await client.query("SELECT id FROM recovery_pack_versions WHERE id = $1", [published.id]))
          .rows,
      ).toEqual([]);
      expect(
        (
          await client.query("SELECT id FROM recovery_pack_draft_history WHERE pack_id = $1", [
            pack.id,
          ])
        ).rows,
      ).toEqual([]);
      expect(
        (await client.query("DELETE FROM recovery_packs WHERE id = $1 RETURNING id", [pack.id]))
          .rows,
      ).toEqual([]);
      await client.query("ROLLBACK");
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.workspace_id', $1, true)", [owner.workspaceId]);
      await expect(
        client.query("UPDATE recovery_pack_versions SET content_hash = 'modified' WHERE id = $1", [
          published.id,
        ]),
      ).rejects.toMatchObject({ code: "42501" });
      await client.query("ROLLBACK");
      const security = await client.query<{ relname: string; relforcerowsecurity: boolean }>(
        "SELECT relname, relforcerowsecurity FROM pg_class WHERE relname IN ('recovery_packs', 'recovery_pack_versions', 'recovery_pack_draft_history', 'recovery_pack_draft_mutations')",
      );
      expect(security.rows).toHaveLength(4);
      expect(security.rows.every((row) => row.relforcerowsecurity)).toBe(true);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
    const exported = await repository.exportAccount(owner.userId);
    expect(exported.recoveryPacks).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: pack.id })]),
    );
    expect(exported.recoveryPackVersions).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: published.id })]),
    );
    await repository.deleteAccount(owner.userId);
    expect(await packs.getRecoveryPack(owner.workspaceId, pack.id)).toBeNull();
    expect(await packs.getRecoveryPackVersion(owner.workspaceId, published.id)).toBeNull();
  });

  it("keeps old Recovery Pack update sources immediately undoable and fences stale undo", async () => {
    const owner = await creator("recovery-pack-update-undo");
    await expectRecoveryPackDraftUndoConformance({
      repository,
      workspaceId: owner.workspaceId,
      editorId: owner.userId,
    });
  });

  it("retains old Presentation Pack Undo sources and accepted media with scoped, fenced receipt replay", async () => {
    const owner = await creator("presentation-pack-update-undo");
    const other = await creator("presentation-pack-update-undo-other");
    await expectPresentationPackUndoConformance({
      repository,
      workspaceId: owner.workspaceId,
      otherWorkspaceId: other.workspaceId,
      editorId: owner.userId,
    });
    const client = await runtimePool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.workspace_id', $1, true)", [owner.workspaceId]);
      const marked = await client.query<{ presentation_id: string }>(
        `SELECT presentation_id FROM presentation_draft_mutations
         WHERE workspace_id = $1 AND recovery_pack_update_source_revision IS NOT NULL LIMIT 1`,
        [owner.workspaceId],
      );
      expect(marked.rows).toHaveLength(1);
      for (const [sourceRevision, expectedRevision, resultingRevision] of [
        [-1, 0, 1],
        [0, 1, 2],
        [0, 0, 0],
        [0, 0, 2],
      ]) {
        await client.query("SAVEPOINT invalid_pack_undo_metadata");
        await expect(
          client.query(
            `INSERT INTO presentation_draft_mutations
               (mutation_id, workspace_id, presentation_id, expected_revision,
                resulting_revision, draft_hash, recovery_pack_update_source_revision)
             VALUES ($1,$2,$3,$4,$5,'invalid-pack-metadata',$6)`,
            [
              randomUUID(),
              owner.workspaceId,
              marked.rows[0]!.presentation_id,
              expectedRevision,
              resultingRevision,
              sourceRevision,
            ],
          ),
        ).rejects.toMatchObject({ code: "23514" });
        await client.query("ROLLBACK TO SAVEPOINT invalid_pack_undo_metadata");
      }
      expect(
        (
          await client.query<{ relforcerowsecurity: boolean }>(
            "SELECT relforcerowsecurity FROM pg_class WHERE oid = 'presentation_draft_mutations'::regclass",
          )
        ).rows,
      ).toEqual([{ relforcerowsecurity: true }]);
      await client.query("SELECT set_config('app.workspace_id', $1, true)", [other.workspaceId]);
      expect(
        (
          await client.query("SELECT * FROM presentation_draft_mutations WHERE workspace_id = $1", [
            owner.workspaceId,
          ])
        ).rows,
      ).toEqual([]);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });

  it("preserves aged current Presentation Pack receipts and restores protected sources beyond latest twenty", async () => {
    const owner = await creator("presentation-pack-undo-retention");
    const presentations = new PostgresPresentationRepository(repository);
    const internals = presentations as unknown as {
      pruneHistory(client: PoolClient, workspaceId: string, presentationId: string): Promise<void>;
    };
    async function scoped<T>(work: (client: PoolClient) => Promise<T>) {
      const client = await runtimePool.connect();
      try {
        await client.query("BEGIN");
        await client.query("SELECT set_config('app.workspace_id', $1, true)", [owner.workspaceId]);
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
    await expectPresentationPackUndoRetentionConformance({
      presentations,
      workspaceId: owner.workspaceId,
      editorId: owner.userId,
      harness: {
        ageReceiptAndOverflowHistory: (current, mutationIds) =>
          scoped(async (client) => {
            await client.query(
              `UPDATE presentation_draft_mutations SET created_at = now() - interval '31 days'
               WHERE workspace_id = $1 AND mutation_id = ANY($2::uuid[])`,
              [owner.workspaceId, mutationIds],
            );
            for (let revision = 100; revision < 125; revision++) {
              await client.query(
                `INSERT INTO presentation_draft_history
                 (id, workspace_id, presentation_id, revision, draft, draft_schema_version, saved_by)
               VALUES ($1,$2,$3,$4,$5,$6,$7)`,
                [
                  randomUUID(),
                  owner.workspaceId,
                  current.id,
                  revision,
                  JSON.stringify(current.draft),
                  current.draftSchemaVersion,
                  owner.userId,
                ],
              );
            }
          }),
        prune: (presentationId) =>
          scoped((client) => internals.pruneHistory(client, owner.workspaceId, presentationId)),
        historyRevisions: (presentationId) =>
          scoped(async (client) => {
            const result = await client.query<{ revision: string }>(
              "SELECT revision FROM presentation_draft_history WHERE workspace_id = $1 AND presentation_id = $2",
              [owner.workspaceId, presentationId],
            );
            return result.rows.map(({ revision }) => Number(revision));
          }),
        receiptSource: (mutationId) =>
          scoped(async (client) => {
            const result = await client.query<{
              recovery_pack_update_source_revision: string | null;
            }>(
              "SELECT recovery_pack_update_source_revision FROM presentation_draft_mutations WHERE workspace_id = $1 AND mutation_id = $2",
              [owner.workspaceId, mutationId],
            );
            if (!result.rows[0]) return undefined;
            const source = result.rows[0].recovery_pack_update_source_revision;
            return source == null ? null : Number(source);
          }),
      },
    });
  });

  it("retains updated probe-only media across source deletion and immutable Round copies", async () => {
    const owner = await creator("recovery-pack-update-probe-media");
    await expectRecoveryPackUpdateMediaConformance({
      repository,
      workspaceId: owner.workspaceId,
      editorId: owner.userId,
    });
  });

  it("freezes Pack practice and replays creation across concurrency, source changes and deletion", async () => {
    const owner = await creator("pack-practice");
    const other = await creator("pack-practice-other");
    await expectRecoveryPackPracticeConformance(
      repository,
      owner.workspaceId,
      other.workspaceId,
      owner.userId,
    );
    const frozen = (
      await repository.listFollowupHistory(owner.workspaceId, { limit: 50, now: new Date() })
    ).items[0]!;
    const restarted = new PostgresRepository(runtimeUrl!);
    try {
      const stored = (await restarted.getFollowup(owner.workspaceId, frozen.id))!;
      expect(stored.recoveryPackSource).toEqual(frozen.recoveryPackSource);
      if (stored.purpose !== "assignment") throw new Error("Expected frozen Pack assignment");
      expect(
        await restarted.createRecoveryPackPracticeAssignment(
          stored.recoveryPackSource!.packId,
          stored,
          [],
          { requestId: randomUUID() },
        ),
      ).toMatchObject({ created: false, productEvent: null, followup: { id: frozen.id } });
      expect(
        (await restarted.listAuditEvents(owner.workspaceId, null, 100)).filter(
          ({ targetId, action }) =>
            targetId === frozen.id && action === "recovery_pack.practice_assignment.create",
        ),
      ).toHaveLength(1);
      const events = await packPracticeScoped(owner.workspaceId, (client) =>
        client.query(
          "SELECT * FROM product_events WHERE workspace_id = $1 AND event_name = 'practice_assignment_created'",
          [owner.workspaceId],
        ),
      );
      expect(events.rows).toHaveLength(1);
      expect(events.rows[0]).toMatchObject({
        dimensions: { betaVersion: "p0-2026", segment: "education" },
        occurred_at: stored.createdAt,
        created_at: stored.createdAt,
        expires_at: new Date(stored.createdAt.getTime() + 30 * 86_400_000),
      });
    } finally {
      await restarted.close();
    }
    // Do not leave a short-lived fixture for later global retention-count assertions.
    await repository.deleteAccount(owner.userId);
  });

  it("persists a frozen full sequence and authoritative advance receipts across restart and expiry", async () => {
    const owner = await creator("pack-sequence");
    const other = await creator("pack-sequence-other");
    const f = await expectRecoveryPackSequencePracticeConformance(
      repository,
      owner.workspaceId,
      other.workspaceId,
      owner.userId,
    );
    const restarted = new PostgresRepository(runtimeUrl!);
    try {
      expect(
        (await restarted.getFollowup(owner.workspaceId, f.frozen.id))!.recoveryPackSequence,
      ).toEqual(f.input.recoveryPackSequence);
      expect(
        await restarted.getFollowupAttemptByToken(
          f.frozen.id,
          f.attempt.attemptTokenHash,
          f.input.createdAt,
        ),
      ).toMatchObject({
        phase: "completed",
        interventionIndex: null,
        advanceReceipts: f.receipts,
      });
      expect(
        await restarted.getFollowupAnswerByIdempotencyKey(f.attempt.id, "diagnostic-answer"),
      ).toMatchObject({
        id: f.diagnosticAnswer.id,
        submittedVersion: 0,
      });
      expect(
        (
          await packPracticeScoped(other.workspaceId, (client) =>
            client.query(
              "SELECT id FROM followups WHERE id = $1 UNION ALL SELECT id FROM followup_attempts WHERE id = $2 UNION ALL SELECT id FROM followup_answers WHERE id = $3",
              [f.frozen.id, f.attempt.id, f.diagnosticAnswer.id],
            ),
          )
        ).rows,
      ).toEqual([]);
      await expect(
        packPracticeScoped(owner.workspaceId, (client) =>
          client.query(
            "UPDATE followups SET recovery_pack_sequence = jsonb_set(recovery_pack_sequence, '{interventions,0,body}', '\"Changed after delivery\"'::jsonb) WHERE id = $1",
            [f.frozen.id],
          ),
        ),
      ).rejects.toMatchObject({ code: "23514" });
      await expect(
        packPracticeScoped(owner.workspaceId, (client) =>
          client.query(
            "UPDATE followup_attempts SET advance_receipts = '{}'::jsonb WHERE id = $1",
            [f.attempt.id],
          ),
        ),
      ).rejects.toMatchObject({ code: "23514" });
      await expectSequencePracticeExpiry(restarted, f);
    } finally {
      await restarted.close();
      await repository.deleteAccount(owner.userId);
    }
  });

  it("rejects SQL-level Pack sequence source spoofing and serializes canonical source hashes", async () => {
    const owner = await creator("pack-sequence-sql");
    const f = await packPracticeFixture(
      repository,
      owner.workspaceId,
      owner.userId,
      undefined,
      "full_sequence",
    );
    try {
      const canonical = QuestionSchema.parse({
        ...f.version.content.diagnostic,
        recoveryPackSource: {
          artifactType: "recovery_pack",
          packId: randomUUID(),
          packVersionId: randomUUID(),
          packVersion: 1,
          sourceItemId: randomUUID(),
          role: "diagnostic",
          contentHash: "a".repeat(64),
        },
      });
      const choiceQuestion = QuestionSchema.parse({
        ...f.version.content.diagnostic,
        type: "single_select",
        prompt: 'Compare "½" and ¼ — which is larger?\nUse the same unit.',
        sourceCitations: [
          {
            sourceName: "Fraction reference",
            sourceDigest: "a".repeat(64),
            locator: "page 2",
            excerpt: "½ is larger than ¼.",
          },
        ],
        choices: [
          {
            id: randomUUID(),
            label: "½",
            isCorrect: true,
            feedback: "A half is larger.",
            misconceptionKey: null,
          },
          {
            id: randomUUID(),
            label: "¼",
            isCorrect: false,
            feedback: "Compare equal units.",
            misconceptionKey: "fractions.denominator-size",
          },
        ],
      });
      for (const question of [canonical, choiceQuestion]) {
        const serialized = await packPracticeScoped(owner.workspaceId, (client) =>
          client.query<{ serialized: string }>(
            "SELECT openround_recovery_pack_question_json($1::jsonb) AS serialized",
            [JSON.stringify(question)],
          ),
        );
        expect(serialized.rows[0]!.serialized).toBe(JSON.stringify(question));
      }
      for (const change of [
        "prompt",
        "sourceHash",
        "cards",
        "citations",
        "unknownCardField",
        "unknownCitationField",
      ] as const) {
        const spoofed = structuredClone(f.input);
        if (change === "prompt")
          spoofed.content.questions[0]!.prompt = "Unrelated question under a valid source";
        if (change === "sourceHash")
          spoofed.content.questions[0]!.recoveryPackSource!.contentHash = "b".repeat(64);
        if (change === "cards")
          spoofed.recoveryPackSequence!.interventions[0]!.body = "Not the published card";
        if (change === "citations")
          spoofed.recoveryPackSequence!.citations[0]!.excerpt = "Not the published citation";
        if (change === "unknownCardField")
          Object.assign(spoofed.recoveryPackSequence!.interventions[0]!, { privateField: "extra" });
        if (change === "unknownCitationField")
          Object.assign(spoofed.recoveryPackSequence!.citations[0]!, { privateField: "extra" });
        await expect(
          packPracticeScoped(owner.workspaceId, (client) =>
            client.query(
              `INSERT INTO followups (id,workspace_id,purpose,source_quiz_version_id,title,content,concept_keys,time_mode,
            generic_token_hash,opens_at,closes_at,expires_at,created_by,created_at,recovery_pack_source,
            creation_mutation_id,creation_request_hash,recovery_pack_sequence)
           VALUES ($1,$2,'assignment',NULL,$3,$4::jsonb,'{}','flex',$5,$6,$7,$8,$9,$6,$10::jsonb,$11,$12,$13::jsonb)`,
              [
                randomUUID(),
                owner.workspaceId,
                spoofed.title,
                JSON.stringify(spoofed.content),
                randomUUID(),
                spoofed.opensAt,
                spoofed.closesAt,
                spoofed.expiresAt,
                owner.userId,
                JSON.stringify(spoofed.recoveryPackSource),
                randomUUID(),
                spoofed.creationMutation!.requestHash,
                JSON.stringify(spoofed.recoveryPackSequence),
              ],
            ),
          ),
        ).rejects.toMatchObject({ code: "23514" });
      }
    } finally {
      await repository.deleteAccount(owner.userId);
    }
  });

  it.each(["audit_events", "product_events"] as const)(
    "rolls back Pack assignment, access, media, audit and event when %s insertion fails",
    async (table) => {
      const owner = await creator(`pack-practice-failed-${table}`);
      const mediaId = randomUUID();
      await repository.createMediaAsset({
        id: mediaId,
        workspaceId: owner.workspaceId,
        objectKey: `media/${owner.workspaceId}/${mediaId}.png`,
        mimeType: "image/png",
        sizeBytes: 10,
        scanStatus: "clean",
        altText: "Delayed fraction diagram",
        createdAt: new Date(),
      });
      const f = await packPracticeFixture(repository, owner.workspaceId, owner.userId, mediaId);
      const adminPool = new Pool({ connectionString: adminUrl });
      const identifier = `openround_practice_evidence_${randomUUID().replaceAll("-", "")}`;
      let triggerCreated = false;
      try {
        await adminPool.query(
          `CREATE FUNCTION public.${identifier}() RETURNS trigger LANGUAGE plpgsql AS $$
           BEGIN
             IF NEW.workspace_id = '${owner.workspaceId}'::uuid THEN
               RAISE EXCEPTION 'Pack practice evidence failed';
             END IF;
             RETURN NEW;
           END $$`,
        );
        await adminPool.query(
          `CREATE TRIGGER ${identifier} BEFORE INSERT ON public.${table}
           FOR EACH ROW EXECUTE FUNCTION public.${identifier}()`,
        );
        triggerCreated = true;
        await expect(
          repository.createRecoveryPackPracticeAssignment(f.pack.id, f.input, f.access, f.context),
        ).rejects.toMatchObject({ code: "P0001", message: "Pack practice evidence failed" });
        expect(await repository.getFollowup(owner.workspaceId, f.input.id)).toBeNull();
        expect(await repository.listFollowupAccess(owner.workspaceId, f.input.id)).toEqual([]);
        expect(
          await repository.getRecoveryPackPracticeAssignment(
            owner.workspaceId,
            f.pack.id,
            f.input.creationMutation!.mutationId,
            f.input.creationMutation!.requestHash,
          ),
        ).toBeNull();
        expect(
          (await repository.listMediaReferences(owner.workspaceId, mediaId)).filter(
            ({ ownerType }) => ownerType === "followup",
          ),
        ).toEqual([]);
        expect(
          (await repository.listAuditEvents(owner.workspaceId, null, 100)).filter(
            ({ targetId }) => targetId === f.input.id,
          ),
        ).toEqual([]);
        const events = await packPracticeScoped(owner.workspaceId, (client) =>
          client.query(
            "SELECT id FROM product_events WHERE workspace_id = $1 AND event_name = 'practice_assignment_created'",
            [owner.workspaceId],
          ),
        );
        expect(events.rows).toEqual([]);
      } finally {
        if (triggerCreated) {
          await adminPool.query(`DROP TRIGGER ${identifier} ON public.${table}`);
        }
        await adminPool.query(`DROP FUNCTION IF EXISTS public.${identifier}()`);
        await adminPool.end();
      }

      const created = await repository.createRecoveryPackPracticeAssignment(
        f.pack.id,
        f.input,
        f.access,
        f.context,
      );
      expect(created).toMatchObject({ created: true, followup: { id: f.input.id } });
      expect(created!.productEvent).not.toBeNull();
      expect(
        await repository.createRecoveryPackPracticeAssignment(f.pack.id, f.input, f.access, {
          requestId: randomUUID(),
        }),
      ).toMatchObject({ created: false, productEvent: null });
      expect(
        (await repository.listAuditEvents(owner.workspaceId, null, 100)).filter(
          ({ targetId }) => targetId === f.input.id,
        ),
      ).toHaveLength(1);
      const events = await packPracticeScoped(owner.workspaceId, (client) =>
        client.query(
          "SELECT id FROM product_events WHERE workspace_id = $1 AND event_name = 'practice_assignment_created'",
          [owner.workspaceId],
        ),
      );
      expect(events.rows).toEqual([{ id: created!.productEvent!.id }]);
      expect(await repository.listFollowupAccess(owner.workspaceId, f.input.id)).toHaveLength(1);
      expect(
        (await repository.listMediaReferences(owner.workspaceId, mediaId)).filter(
          ({ ownerType }) => ownerType === "followup",
        ),
      ).toHaveLength(1);
      await repository.deleteAccount(owner.userId);
    },
  );

  it("retains Pack practice media after source deletion until assignment expiry", async () => {
    const owner = await creator("pack-practice-media");
    await expectRecoveryPackPracticeMediaLifecycle(repository, owner.workspaceId, owner.userId);
    // Its assignment is expired above, but creation evidence has independent 30-day retention.
    await repository.deleteAccount(owner.userId);
  });

  it("keeps Pack practice source/receipt immutable, scoped, and compatible with account deletion", async () => {
    const owner = await creator("pack-practice-lifecycle");
    const other = await creator("pack-practice-lifecycle-other");
    const f = await packPracticeFixture(repository, owner.workspaceId, owner.userId);
    const saved = (await repository.createRecoveryPackPracticeAssignment(
      f.pack.id,
      f.input,
      f.access,
      f.context,
    ))!.followup;
    for (const column of [
      "recovery_pack_source",
      "creation_mutation_id",
      "creation_request_hash",
      "generic_token_hash",
    ]) {
      const replacement =
        column === "recovery_pack_source"
          ? JSON.stringify({ ...f.input.recoveryPackSource, packTitle: "Changed" })
          : column === "creation_mutation_id"
            ? randomUUID()
            : "f".repeat(64);
      await expect(
        packPracticeScoped(owner.workspaceId, (client) =>
          client.query(`UPDATE followups SET ${column} = $3 WHERE workspace_id = $1 AND id = $2`, [
            owner.workspaceId,
            saved.id,
            replacement,
          ]),
        ),
      ).rejects.toMatchObject({ code: "23514" });
    }
    const hidden = await packPracticeScoped(other.workspaceId, (client) =>
      client.query("SELECT id FROM followups WHERE id = $1", [saved.id]),
    );
    expect(hidden.rows).toEqual([]);
    await repository.claimWorkspaceMediaDeletion(owner.workspaceId);
    expect(
      (await repository.createRecoveryPackPracticeAssignment(
        f.pack.id,
        f.input,
        f.access,
        f.context,
      ))!.followup.id,
    ).toBe(saved.id);
    await expect(
      repository.createRecoveryPackPracticeAssignment(
        f.pack.id,
        {
          ...f.input,
          id: randomUUID(),
          creationMutation: { mutationId: randomUUID(), requestHash: "e".repeat(64) },
        },
        [],
        f.context,
      ),
    ).rejects.toBeInstanceOf(WorkspaceDeletionInProgressError);
    await repository.deleteAccount(owner.userId);
    expect(await repository.getFollowup(owner.workspaceId, saved.id)).toBeNull();
    expect(await repository.listFollowupAccess(owner.workspaceId, saved.id)).toEqual([]);
    expect(
      await repository.getRecoveryPackPracticeAssignment(
        owner.workspaceId,
        f.pack.id,
        f.input.creationMutation!.mutationId,
        f.input.creationMutation!.requestHash,
      ),
    ).toBeNull();
  });

  it("validates strict Pack practice metadata JSON types and exact contract UUID variants", async () => {
    const owner = await creator("pack-practice-types");
    const f = await packPracticeFixture(repository, owner.workspaceId, owner.userId);
    const source = f.input.recoveryPackSource!;
    for (const changed of [
      { contentHash: 1e63 },
      { contentHash: "A".repeat(64) },
      { packTitle: 123 },
      { packVersion: "1" },
      { packVersion: 0 },
      { packVersion: 1.5 },
      { packVersion: Number.MAX_SAFE_INTEGER + 1 },
      { sourceItemId: 123 },
      { packId: "11111111-1111-0111-8111-111111111111" },
      { packVersionId: "11111111-1111-4111-7111-111111111111" },
      { role: "recheck" },
      { accessSeed: "secret" },
    ]) {
      const result = await packPracticeScoped(owner.workspaceId, (client) =>
        client.query("SELECT openround_recovery_pack_practice_source_valid($1::jsonb) AS valid", [
          JSON.stringify({ ...source, ...changed }),
        ]),
      );
      expect(result.rows[0]!.valid, JSON.stringify(changed)).toBe(false);
    }
    for (const value of presentationRecoveryPackUuidCases.accepted) {
      const result = await packPracticeScoped(owner.workspaceId, (client) =>
        client.query("SELECT openround_recovery_pack_practice_source_valid($1::jsonb) AS valid", [
          JSON.stringify({ ...source, packId: value, packVersionId: value, sourceItemId: value }),
        ]),
      );
      expect(result.rows[0]!.valid, value).toBe(true);
    }
    await expect(
      packPracticeScoped(owner.workspaceId, (client) =>
        client.query(
          `INSERT INTO followups (id, workspace_id, purpose, source_quiz_version_id, source_session_id, source_report_id, title, content, concept_keys, time_mode, generic_token_hash, opens_at, closes_at, expires_at, created_by, recovery_pack_source, creation_mutation_id, creation_request_hash)
       VALUES ($1,$2,'assignment',NULL,NULL,NULL,$3,$4::jsonb,'{}','flex',$5,$6,$7,$8,$9,$10::jsonb,$11,$12)`,
          [
            randomUUID(),
            owner.workspaceId,
            f.input.title,
            JSON.stringify(f.input.content),
            randomUUID(),
            f.input.opensAt,
            f.input.closesAt,
            f.input.expiresAt,
            owner.userId,
            JSON.stringify({ ...source, contentHash: 1e63 }),
            randomUUID(),
            "a".repeat(64),
          ],
        ),
      ),
    ).rejects.toMatchObject({ code: "23514" });
  });

  it("retains Presentation Pack originals and accepted baselines after source deletion and local edits", async () => {
    const owner = await creator("presentation-pack-media");
    await expectPresentationPackMediaConformance({
      repository,
      workspaceId: owner.workspaceId,
      editorId: owner.userId,
    });
  });

  it("rejects invalid private media in both Presentation Pack snapshots atomically", async () => {
    const owner = await creator("presentation-pack-invalid-media");
    const other = await creator("presentation-pack-invalid-media-other");
    await expectPresentationPackInvalidMediaConformance({
      repository,
      workspaceId: owner.workspaceId,
      otherWorkspaceId: other.workspaceId,
      editorId: owner.userId,
    });
  });

  it("releases Presentation Pack media when the last retained history snapshot is pruned", async () => {
    const owner = await creator("presentation-pack-history-media");
    await expectPresentationPackHistoryMediaConformance({
      repository,
      workspaceId: owner.workspaceId,
      editorId: owner.userId,
    });
  });

  it("keeps Recovery Pack snapshot and receipt media while rejecting unclean publication", async () => {
    const owner = await creator("recovery-pack-media");
    const other = await creator("recovery-pack-media-other");
    const packs = createRecoveryPackRepository(repository);
    const mediaId = randomUUID();
    const now = new Date();
    await repository.createMediaAsset({
      id: mediaId,
      workspaceId: owner.workspaceId,
      objectKey: `media/${mediaId}.png`,
      mimeType: "image/png",
      sizeBytes: 10,
      scanStatus: "pending",
      altText: "Diagram",
      createdAt: now,
    });
    const draft = recoveryPackDraft();
    draft.diagnostic.mediaId = mediaId;
    draft.diagnostic.mediaAlt = "Pending diagram";
    const pack = await packs.createRecoveryPack(
      recoveryPackRecord(owner.workspaceId, owner.userId, draft),
    );
    const content = RecoveryPackContentSchema.parse(draft);
    const contentHash = createHash("sha256").update(JSON.stringify(content)).digest("hex");
    const candidate = {
      id: randomUUID(),
      workspaceId: owner.workspaceId,
      packId: pack.id,
      version: 1,
      content,
      contentHash,
      sourceDraftRevision: 0,
      publishedAt: now,
    };
    await expect(packs.publishRecoveryPack(candidate, 0)).rejects.toBeInstanceOf(
      RecoveryPackMediaValidationError,
    );
    await expect(
      packs.createRecoveryPack(recoveryPackRecord(other.workspaceId, other.userId, draft)),
    ).rejects.toBeInstanceOf(RecoveryPackMediaValidationError);
    const token = randomUUID();
    await repository.claimMediaAssetFinalization(owner.workspaceId, mediaId, token, now);
    await repository.updateMediaAsset(owner.workspaceId, mediaId, {
      scanStatus: "clean",
      finalizationToken: token,
      finalizedAt: now,
    });
    const version = await packs.publishRecoveryPack(candidate, 0);
    const mutationId = randomUUID();
    await packs.updateRecoveryPackDraft({
      workspaceId: owner.workspaceId,
      packId: pack.id,
      draft: { ...draft, title: "Acknowledged media" },
      expectedRevision: 0,
      mutationId,
      editorId: owner.userId,
      draftHash: "with-media",
    });
    expect(await repository.listMediaReferences(owner.workspaceId, mediaId)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ ownerType: "recovery_pack_mutation", ownerId: mutationId }),
      ]),
    );
    const mediaFreeQuestions = [
      { ...draft.diagnostic, mediaId: null, mediaAlt: null },
      draft.recheck,
    ];
    const quiz = await repository.createQuiz({
      id: randomUUID(),
      workspaceId: owner.workspaceId,
      title: "Snapshot destination",
      description: "",
      status: "draft",
      draft: {
        title: "Snapshot destination",
        description: "",
        questions: mediaFreeQuestions,
        recoveryPackInsertions: [
          {
            id: randomUUID(),
            packId: pack.id,
            packVersionId: version.id,
            packVersion: version.version,
            contentHash,
            diagnosticQuestionId: draft.diagnostic.id,
            recheckQuestionId: draft.recheck.id,
            originalContent: content,
          },
        ],
      },
      currentVersionId: null,
      createdAt: now,
      updatedAt: now,
    });
    expect(await repository.listMediaReferences(owner.workspaceId, mediaId)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ ownerType: "quiz_draft", ownerId: quiz.id }),
      ]),
    );
    await packs.deleteRecoveryPack(owner.workspaceId, pack.id);
    expect(await repository.deleteMediaAsset(owner.workspaceId, mediaId)).toBe(false);
    expect(
      (await repository.getQuiz(owner.workspaceId, quiz.id))?.draft.recoveryPackInsertions?.[0]
        ?.originalContent,
    ).toEqual(content);
  });

  it("fences new Recovery Pack writes when an empty workspace has begun deletion", async () => {
    const owner = await creator("recovery-pack-deletion");
    const packs = createRecoveryPackRepository(repository);
    const initial = await packs.createRecoveryPack(
      recoveryPackRecord(owner.workspaceId, owner.userId),
    );
    const mutation = {
      workspaceId: owner.workspaceId,
      packId: initial.id,
      draft: { ...initial.draft, title: "Saved" },
      expectedRevision: 0,
      mutationId: randomUUID(),
      editorId: owner.userId,
      draftHash: "saved",
    };
    const saved = (await packs.updateRecoveryPackDraft(mutation))!;
    expect(await repository.claimWorkspaceMediaDeletion(owner.workspaceId)).toEqual([]);
    await expect(
      packs.createRecoveryPack(recoveryPackRecord(owner.workspaceId, owner.userId)),
    ).rejects.toBeInstanceOf(WorkspaceDeletionInProgressError);
    await expect(
      packs.updateRecoveryPackDraft({
        ...mutation,
        draft: { ...saved.draft, title: "Blocked" },
        expectedRevision: 1,
        mutationId: randomUUID(),
        draftHash: "blocked",
      }),
    ).rejects.toBeInstanceOf(WorkspaceDeletionInProgressError);
    await expect(
      packs.publishRecoveryPack(
        {
          id: randomUUID(),
          workspaceId: owner.workspaceId,
          packId: initial.id,
          version: 1,
          content: RecoveryPackContentSchema.parse(saved.draft),
          contentHash: "saved",
          sourceDraftRevision: 1,
          publishedAt: new Date(),
        },
        1,
      ),
    ).rejects.toBeInstanceOf(WorkspaceDeletionInProgressError);
    expect(await packs.replayRecoveryPackMutation(mutation)).toMatchObject({ draftRevision: 1 });
    expect(await packs.updateRecoveryPackDraft(mutation)).toMatchObject({ draftRevision: 1 });
    expect(await packs.getRecoveryPack(owner.workspaceId, initial.id)).toMatchObject({
      draftRevision: 1,
    });
    expect(await packs.deleteRecoveryPack(owner.workspaceId, initial.id)).toBe(true);
  });

  async function createRoundSessionFixture(
    owner: Awaited<ReturnType<typeof creator>>,
    fixture: Awaited<ReturnType<typeof createPublishedRoundFixture>>,
    code: string,
    trustMode: "learning" | "verified" = "learning",
    decisionReplayEnabled = false,
    recoveryPackCardsEnabled = false,
  ) {
    const now = new Date();
    const id = randomUUID();
    const state = createGameState({
      sessionId: id,
      code,
      quiz: fixture.content,
      recoveryPackCardsEnabled,
      settings: {
        audienceLimit: 20,
        scoringMode: "accuracy",
        resultVisibility: "private",
        allowLateJoin: true,
        nicknamePolicy: "friendly_only",
        trustMode,
      },
    });
    await repository.createSession({
      id,
      workspaceId: owner.workspaceId,
      quizVersionId: fixture.version.id,
      hostId: owner.userId,
      hostTokenHash: randomUUID(),
      trustMode,
      decisionReplayEnabled,
      state,
      expiresAt: new Date(now.getTime() + 60_000),
      retentionExpiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60_000),
      createdAt: now,
      updatedAt: now,
    });
    return { id, state };
  }

  async function createPublishedPresentationFixture(
    owner: Awaited<ReturnType<typeof creator>>,
    label: string,
  ) {
    const now = new Date();
    const content = {
      title: label,
      description: "",
      experiencePreset: { id: "focus", version: 1 },
      schemaVersion: 2,
      blocks: [
        {
          id: randomUUID(),
          kind: "question",
          question: {
            id: randomUUID(),
            type: "numeric",
            prompt: "How many room-code namespaces are authoritative?",
            correctValue: "1",
            tolerance: "0",
            unit: null,
            timeLimitSeconds: 30,
            basePoints: 1_000,
            explanation: "Rounds and Presentations share one namespace.",
            mediaId: null,
            mediaAlt: null,
          },
        },
      ],
    } satisfies PresentationDraft;
    const presentations = new PostgresPresentationRepository(repository);
    const presentation = await presentations.createPresentation({
      id: randomUUID(),
      workspaceId: owner.workspaceId,
      title: content.title,
      description: content.description,
      status: "draft",
      draft: content,
      draftRevision: 0,
      draftSchemaVersion: 2,
      currentVersionId: null,
      folderId: null,
      publishedDraftRevision: null,
      lastEditedBy: owner.userId,
      createdAt: now,
      updatedAt: now,
    });
    const version = await presentations.publishPresentation(
      {
        id: randomUUID(),
        workspaceId: owner.workspaceId,
        presentationId: presentation.id,
        version: 1,
        content,
        contentHash: randomUUID(),
        sourceDraftRevision: 0,
        publishedAt: now,
      },
      0,
    );
    return { content, presentation, version };
  }

  async function createPresentationSessionFixture(
    owner: Awaited<ReturnType<typeof creator>>,
    fixture: Awaited<ReturnType<typeof createPublishedPresentationFixture>>,
    code: string,
  ) {
    const now = new Date();
    const sessions = new PostgresPresentationSessionRepository(repository);
    const session = await sessions.createSession({
      id: randomUUID(),
      workspaceId: owner.workspaceId,
      presentationId: fixture.presentation.id,
      presentationVersionId: fixture.version.id,
      title: fixture.content.title,
      content: fixture.content,
      code,
      status: "active",
      phase: "lobby",
      currentBlockIndex: -1,
      revision: 0,
      createdBy: owner.userId,
      createdAt: now,
      updatedAt: now,
      finishedAt: null,
      liveExpiresAt: new Date(now.getTime() + 60_000),
      retentionExpiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60_000),
    });
    return { session, sessions };
  }

  it("linearizes workspace deletion ahead of concurrent Round, Presentation, Pack practice and media creation", async () => {
    const waitForWorkspaceLock = async (queryFragment: string) => {
      const deadline = Date.now() + 3_000;
      while (Date.now() < deadline) {
        const waiting = await runtimePool.query<{ count: string }>(
          `SELECT count(*)::text AS count
             FROM pg_stat_activity
             WHERE pid <> pg_backend_pid()
               AND datname = current_database()
               AND state = 'active'
               AND wait_event_type = 'Lock'
               AND query LIKE $1`,
          [`%${queryFragment}%`],
        );
        if (Number(waiting.rows[0]?.count ?? 0) > 0) return;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      throw new Error(`Timed out waiting for deletion-fenced query: ${queryFragment}`);
    };
    const fenceBefore = async <T>(
      workspaceId: string,
      queryFragment: string,
      operation: () => Promise<T>,
    ) => {
      const blocker = await runtimePool.connect();
      try {
        await blocker.query("BEGIN");
        await blocker.query("SELECT set_config('app.workspace_id', $1, true)", [workspaceId]);
        await expect(
          blocker.query(
            `UPDATE workspaces
               SET deletion_started_at = now()
               WHERE id = $1`,
            [workspaceId],
          ),
        ).resolves.toMatchObject({ rowCount: 1 });
        const pending = operation().then(
          (value) => ({ status: "fulfilled" as const, value }),
          (error: unknown) => ({ status: "rejected" as const, error }),
        );
        await waitForWorkspaceLock(queryFragment);
        await blocker.query("COMMIT");
        return await pending;
      } catch (error) {
        await blocker.query("ROLLBACK").catch(() => undefined);
        throw error;
      } finally {
        blocker.release();
      }
    };

    const roundOwner = await creator("deletion-race-round");
    const round = await createPublishedRoundFixture(roundOwner, "Deletion-fenced Round");
    const roundNow = new Date();
    const roundSessionId = randomUUID();
    const roundState = createGameState({
      sessionId: roundSessionId,
      code: String(randomInt(1_000_000, 10_000_000)),
      quiz: round.content,
      settings: {
        audienceLimit: 20,
        scoringMode: "accuracy",
        resultVisibility: "private",
        allowLateJoin: true,
        nicknamePolicy: "friendly_only",
      },
    });
    const roundOutcome = await fenceBefore(
      roundOwner.workspaceId,
      "INSERT INTO game_sessions",
      () =>
        repository.createSession({
          id: roundSessionId,
          workspaceId: roundOwner.workspaceId,
          quizVersionId: round.version.id,
          hostId: roundOwner.userId,
          hostTokenHash: randomUUID(),
          state: roundState,
          expiresAt: new Date(roundNow.getTime() + 60_000),
          retentionExpiresAt: new Date(roundNow.getTime() + 30 * 24 * 60 * 60_000),
          createdAt: roundNow,
          updatedAt: roundNow,
        }),
    );
    expect(roundOutcome).toMatchObject({
      status: "rejected",
      error: expect.any(WorkspaceDeletionInProgressError),
    });

    const presentationOwner = await creator("deletion-race-presentation");
    const presentation = await createPublishedPresentationFixture(
      presentationOwner,
      "Deletion-fenced Presentation",
    );
    const presentationSessions = new PostgresPresentationSessionRepository(repository);
    const presentationNow = new Date();
    const presentationOutcome = await fenceBefore(
      presentationOwner.workspaceId,
      "INSERT INTO presentation_live_sessions",
      () =>
        presentationSessions.createSession({
          id: randomUUID(),
          workspaceId: presentationOwner.workspaceId,
          presentationId: presentation.presentation.id,
          presentationVersionId: presentation.version.id,
          title: presentation.content.title,
          content: presentation.content,
          code: String(randomInt(1_000_000, 10_000_000)),
          status: "active",
          phase: "lobby",
          currentBlockIndex: -1,
          revision: 0,
          createdBy: presentationOwner.userId,
          createdAt: presentationNow,
          updatedAt: presentationNow,
          finishedAt: null,
          liveExpiresAt: new Date(presentationNow.getTime() + 60_000),
          retentionExpiresAt: new Date(presentationNow.getTime() + 30 * 24 * 60 * 60_000),
        }),
    );
    expect(presentationOutcome).toMatchObject({
      status: "rejected",
      error: expect.any(WorkspaceDeletionInProgressError),
    });

    const practiceOwner = await creator("deletion-race-pack-practice");
    const practice = await packPracticeFixture(
      repository,
      practiceOwner.workspaceId,
      practiceOwner.userId,
    );
    const practiceOutcome = await fenceBefore(
      practiceOwner.workspaceId,
      "create_recovery_pack_practice_workspace",
      () =>
        repository.createRecoveryPackPracticeAssignment(
          practice.pack.id,
          practice.input,
          practice.access,
          practice.context,
        ),
    );
    expect(practiceOutcome).toMatchObject({
      status: "rejected",
      error: expect.any(WorkspaceDeletionInProgressError),
    });
    expect(
      await repository.getRecoveryPackPracticeAssignment(
        practiceOwner.workspaceId,
        practice.pack.id,
        practice.input.creationMutation!.mutationId,
        practice.input.creationMutation!.requestHash,
      ),
    ).toBeNull();

    const mediaOwner = await creator("deletion-race-media");
    const mediaId = randomUUID();
    const mediaOutcome = await fenceBefore(mediaOwner.workspaceId, "INSERT INTO media_assets", () =>
      repository.createMediaAsset({
        id: mediaId,
        workspaceId: mediaOwner.workspaceId,
        objectKey: `quarantine/${mediaOwner.workspaceId}/${mediaId}.png`,
        mimeType: "image/png",
        sizeBytes: 128,
        scanStatus: "pending",
        altText: "Deletion race fixture",
        createdAt: new Date(),
      }),
    );
    expect(mediaOutcome).toMatchObject({
      status: "rejected",
      error: expect.objectContaining({ message: "Workspace deletion is in progress" }),
    });
  }, 15_000);

  it("keeps PostgreSQL on the shared Presentation repository conformance contract", async () => {
    const owner = await creator("presentation-repository-conformance");
    const published = await createPublishedPresentationFixture(
      owner,
      "Presentation repository conformance",
    );

    await expectPresentationSessionRepositoryConformance({
      repository: new PostgresPresentationSessionRepository(repository),
      workspaceId: owner.workspaceId,
      presentationId: published.presentation.id,
      presentationVersionId: published.version.id,
      createdBy: owner.userId,
      content: published.content,
      beginWorkspaceDeletion: async () => {
        await repository.claimWorkspaceMediaDeletion(owner.workspaceId);
      },
    });
  });

  it("keeps PostgreSQL on the shared scope activation, outbox lease, and deletion contract", async () => {
    const owner = await creator("audience-scope-conformance");
    const published = await createPublishedPresentationFixture(owner, "Scope foundation");
    await expectAudienceScopeConformance({
      scopes: createAudienceScopeRepository(repository),
      sessions: new PostgresPresentationSessionRepository(repository),
      workspaceId: owner.workspaceId,
      presentationId: published.presentation.id,
      presentationVersionId: published.version.id,
      createdBy: owner.userId,
    });
  });

  it("matches scoped Q&A memory rules with durable receipts, moderation, privacy and deletion", async () => {
    const owner = await creator("scoped-qna-conformance");
    const other = await creator("scoped-qna-isolation");
    const published = await createPublishedPresentationFixture(owner, "Scoped Q&A");
    await expectScopedQnaConformance({
      repository,
      qna: createScopedQnaRepository(repository),
      scopes: createAudienceScopeRepository(repository),
      sessions: new PostgresPresentationSessionRepository(repository),
      workspaceId: owner.workspaceId,
      presentationId: published.presentation.id,
      presentationVersionId: published.version.id,
      createdBy: owner.userId,
      beforeDelete: async (scopeId) => {
        const tables = [
          "scoped_qna_settings",
          "scoped_qna_questions",
          "scoped_qna_votes",
          "scoped_qna_bans",
          "scoped_qna_receipts",
          "scoped_qna_rate_limits",
          "scoped_qna_audit",
        ];
        await packPracticeScoped(other.workspaceId, async (client) => {
          for (const table of tables)
            expect(
              (await client.query(`SELECT * FROM ${table} WHERE scope_id = $1`, [scopeId])).rows,
            ).toEqual([]);
        });
        await packPracticeScoped(owner.workspaceId, async (client) => {
          const security = await client.query(
            "SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = ANY($1::text[])",
            [tables],
          );
          expect(security.rows).toHaveLength(tables.length);
          expect(security.rows.every((row) => row.relrowsecurity && row.relforcerowsecurity)).toBe(
            true,
          );
          const scope = (
            await client.query("SELECT audience_seq FROM audience_scopes WHERE id = $1", [scopeId])
          ).rows[0]!;
          expect(
            (
              await client.query(
                "SELECT count(*)::integer AS count FROM scoped_qna_receipts WHERE scope_id = $1",
                [scopeId],
              )
            ).rows[0]!.count,
          ).toBe(Number(scope.audience_seq) - 1);
          expect(
            (
              await client.query(
                "SELECT count(*)::integer AS count FROM scoped_audience_outbox WHERE scope_id = $1",
                [scopeId],
              )
            ).rows[0]!.count,
          ).toBe(Number(scope.audience_seq));
        });
        await expect(
          packPracticeScoped(owner.workspaceId, (client) =>
            client.query("UPDATE scoped_qna_receipts SET request_hash = $2 WHERE scope_id = $1", [
              scopeId,
              "a".repeat(64),
            ]),
          ),
        ).rejects.toMatchObject({ code: "42501" });
      },
    });
    await packPracticeScoped(owner.workspaceId, async (client) => {
      for (const table of [
        "scoped_qna_questions",
        "scoped_qna_receipts",
        "scoped_qna_votes",
        "scoped_qna_audit",
      ])
        expect(
          (
            await client.query(`SELECT * FROM ${table} WHERE workspace_id = $1`, [
              owner.workspaceId,
            ])
          ).rows,
        ).toEqual([]);
    });
  });

  it("forces scope RLS, composite source isolation, immutable privacy, and account export", async () => {
    const owner = await creator("audience-scope-rls-owner");
    const outsider = await creator("audience-scope-rls-outsider");
    const published = await createPublishedPresentationFixture(owner, "Scope RLS");
    const sessions = new PostgresPresentationSessionRepository(repository);
    const now = new Date();
    const session = await sessions.createSession({
      id: randomUUID(),
      workspaceId: owner.workspaceId,
      presentationId: published.presentation.id,
      presentationVersionId: published.version.id,
      content: published.content,
      title: "Scope RLS",
      code: String(randomInt(1_000_000, 10_000_000)),
      status: "active",
      phase: "lobby",
      currentBlockIndex: -1,
      revision: 0,
      createdBy: owner.userId,
      createdAt: now,
      updatedAt: now,
      finishedAt: null,
      liveExpiresAt: new Date(now.getTime() + 60_000),
      retentionExpiresAt: new Date(now.getTime() + 86_400_000),
    });
    const scopes = createAudienceScopeRepository(repository);
    await expect(
      packPracticeScoped(outsider.workspaceId, (client) =>
        client.query(
          `INSERT INTO audience_scopes
      (id, workspace_id, kind, identity_policy, creation_idempotency_key, created_at, expires_at)
      VALUES ($1, $2, 'presentation', 'facilitator_visible_alias', $3, $4, $5)`,
          [session.id, outsider.workspaceId, randomUUID(), now, session.retentionExpiresAt],
        ),
      ),
    ).rejects.toMatchObject({ code: "23503" });
    await scopes.activatePresentation({
      workspaceId: owner.workspaceId,
      sessionId: session.id,
      idempotencyKey: randomUUID(),
      now,
    });
    await packPracticeScoped(outsider.workspaceId, async (client) => {
      for (const table of ["audience_scopes", "scoped_audience_outbox"]) {
        expect(
          (
            await client.query(`SELECT * FROM ${table} WHERE workspace_id = $1`, [
              owner.workspaceId,
            ])
          ).rows,
        ).toEqual([]);
      }
    });
    await expect(
      packPracticeScoped(owner.workspaceId, (client) =>
        client.query(
          "UPDATE audience_scopes SET identity_policy = 'organizer_blind' WHERE id = $1",
          [session.id],
        ),
      ),
    ).rejects.toMatchObject({ code: "42501" });
    const admin = new Pool({ connectionString: adminUrl });
    try {
      expect(
        (
          await admin.query(
            "SELECT relforcerowsecurity FROM pg_class WHERE relname IN ('audience_scopes', 'scoped_audience_outbox') ORDER BY relname",
          )
        ).rows,
      ).toEqual([{ relforcerowsecurity: true }, { relforcerowsecurity: true }]);
      await expect(
        admin.query(
          "UPDATE audience_scopes SET expires_at = expires_at + interval '1 day' WHERE id = $1",
          [session.id],
        ),
      ).rejects.toMatchObject({ code: "55000" });
    } finally {
      await admin.end();
    }
    const exported = (await repository.exportAccount(owner.userId)) as {
      audienceScopes: Array<{ id: string }>;
    };
    expect(exported.audienceScopes).toEqual([expect.objectContaining({ id: session.id })]);
    await sessions.deleteSession(owner.workspaceId, session.id, new Date(now.getTime() + 60_001));
    await packPracticeScoped(owner.workspaceId, async (client) => {
      expect(
        (
          await client.query("SELECT * FROM scoped_audience_outbox WHERE scope_id = $1", [
            session.id,
          ])
        ).rows,
      ).toEqual([]);
    });
  });

  it("keeps PostgreSQL on the shared live card and strict command receipt contract", async () => {
    const owner = await creator("presentation-live-card-conformance");
    const published = await createPublishedPresentationFixture(owner, "Presentation live cards");
    await expectPresentationRecoveryPackLiveCardsConformance({
      repository: new PostgresPresentationSessionRepository(repository),
      workspaceId: owner.workspaceId,
      presentationId: published.presentation.id,
      presentationVersionId: published.version.id,
      createdBy: owner.userId,
      content: published.content,
      beginWorkspaceDeletion: async () => {
        await repository.claimWorkspaceMediaDeletion(owner.workspaceId);
      },
    });
  });

  it("keeps PostgreSQL on the shared live insertion CAS, timer and receipt contract", async () => {
    const owner = await creator("presentation-live-insertion-conformance");
    const outsider = await creator("presentation-live-insertion-outsider");
    const published = await createPublishedPresentationFixture(
      owner,
      "Presentation live insertion",
    );
    await expectPresentationLiveInsertionConformance({
      repository: new PostgresPresentationSessionRepository(repository),
      workspaceId: owner.workspaceId,
      otherWorkspaceId: outsider.workspaceId,
      presentationId: published.presentation.id,
      presentationVersionId: published.version.id,
      createdBy: owner.userId,
      content: published.content,
      beginWorkspaceDeletion: async () => {
        await repository.claimWorkspaceMediaDeletion(owner.workspaceId);
      },
    });
  });

  async function publishedQuestionInsertionFixture(label: string) {
    const owner = await creator(`published-question-${label}`);
    const published = await createPublishedPresentationFixture(owner, "Published question room");
    const { session, sessions } = await createPresentationSessionFixture(
      owner,
      published,
      String(randomInt(1_000_000, 10_000_000)),
    );
    const now = new Date();
    const content = publishableRound("Published insertion source");
    const quiz = await repository.createQuiz({
      id: randomUUID(),
      workspaceId: owner.workspaceId,
      title: content.title,
      description: content.description,
      status: "draft",
      draft: content,
      currentVersionId: null,
      createdAt: now,
      updatedAt: now,
    });
    const version = await repository.publishQuiz({
      id: randomUUID(),
      workspaceId: owner.workspaceId,
      quizId: quiz.id,
      version: 1,
      content,
      contentHash: createHash("sha256").update(JSON.stringify(content)).digest("hex"),
      publishedAt: now,
    });
    const commandId = randomUUID();
    const blockId = randomUUID();
    const sourceQuestion = version.content.questions[0]!;
    const command: PresentationSessionCommandInput = {
      workspaceId: owner.workspaceId,
      sessionId: session.id,
      commandId,
      requestHash: "a".repeat(64),
      expectedRevision: 0,
      publishedQuestionSource: {
        quizId: version.quizId,
        versionId: version.id,
        contentHash: version.contentHash,
      },
      content: {
        ...structuredClone(session.content),
        blocks: [
          {
            id: blockId,
            kind: "question",
            question: {
              ...structuredClone(sourceQuestion),
              id: randomUUID(),
              delivery: "main",
              linkedRecheckQuestionId: null,
            },
            provenance: {
              sourceQuizVersionId: version.id,
              sourceQuestionId: sourceQuestion.id,
            },
          },
          ...structuredClone(session.content.blocks),
        ],
        livePublishedQuestions: [
          {
            commandId,
            blockId,
            sourceQuizId: version.quizId,
            sourceQuizVersionId: version.id,
            sourceQuizVersion: version.version,
            sourceQuestionId: sourceQuestion.id,
            contentHash: version.contentHash,
          },
        ],
      },
      phase: "question_open",
      currentBlockIndex: 0,
      status: "active",
      occurredAt: now,
      event: { type: "question.launched", blockIndex: 0, blockId },
    };
    return { owner, session, sessions, version, command };
  }

  it.each(["archive", "archive and delete"] as const)(
    "rejects published question insertion when an in-flight %s wins the source lock",
    async (mutation) => {
      const f = await publishedQuestionInsertionFixture(mutation.replaceAll(" ", "-"));
      const blocker = await runtimePool.connect();
      let pending:
        | Promise<{ status: "fulfilled"; value: unknown } | { status: "rejected"; error: unknown }>
        | undefined;
      try {
        await blocker.query("BEGIN");
        await blocker.query("SELECT set_config('app.workspace_id', $1, true)", [
          f.owner.workspaceId,
        ]);
        const blockerPid = Number(
          (await blocker.query("SELECT pg_backend_pid() AS pid")).rows[0]?.pid,
        );
        // Leave the previously published row visible until the insertion reaches its source lock.
        // Locking only the quiz proves the source fence independently of the workspace fence.
        await expect(
          blocker.query(
            `UPDATE quizzes SET status = 'archived', archived_at = now(), updated_at = now()
             WHERE workspace_id = $1 AND id = $2`,
            [f.owner.workspaceId, f.version.quizId],
          ),
        ).resolves.toMatchObject({ rowCount: 1 });
        if (mutation === "archive and delete") {
          await expect(
            blocker.query("DELETE FROM quizzes WHERE workspace_id = $1 AND id = $2", [
              f.owner.workspaceId,
              f.version.quizId,
            ]),
          ).resolves.toMatchObject({ rowCount: 1 });
        }
        pending = f.sessions.transitionSessionCommand(f.command).then(
          (value) => ({ status: "fulfilled" as const, value }),
          (error: unknown) => ({ status: "rejected" as const, error }),
        );
        let waitingOnSource = false;
        const deadline = Date.now() + 3_000;
        while (Date.now() < deadline) {
          // Autocommit refreshes activity rather than retaining the blocker's statistics snapshot.
          const activity = await runtimePool.query<{ waiting: boolean }>(
            `SELECT EXISTS (
               SELECT 1 FROM pg_stat_activity
               WHERE pid <> pg_backend_pid()
                 AND wait_event_type = 'Lock'
                 AND query LIKE '%FOR SHARE OF quiz%'
                 AND $1::integer = ANY(pg_blocking_pids(pid))
             ) AS waiting`,
            [blockerPid],
          );
          waitingOnSource = activity.rows[0]?.waiting === true;
          if (waitingOnSource) break;
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        expect(waitingOnSource).toBe(true);
        await blocker.query("COMMIT");
      } catch (error) {
        await blocker.query("ROLLBACK").catch(() => undefined);
        throw error;
      } finally {
        blocker.release();
        await pending;
      }
      await expect(pending).resolves.toMatchObject({
        status: "rejected",
        error: expect.any(PresentationPublishedQuestionSourceUnavailableError),
      });
      // Full equality also fences content, revision, event sequence and both question timers.
      await expect(f.sessions.getSessionById(f.session.id)).resolves.toEqual(f.session);
      await expect(f.sessions.listTimeline(f.session.id)).resolves.toEqual([]);
      await expect(
        f.sessions.findCommandReceipt(f.owner.workspaceId, f.session.id, f.command.commandId),
      ).resolves.toBeNull();
      if (mutation === "archive and delete") {
        await expect(repository.getQuiz(f.owner.workspaceId, f.version.quizId)).resolves.toBeNull();
        await expect(
          repository.getQuizVersion(f.owner.workspaceId, f.version.id),
        ).resolves.toBeNull();
      } else {
        await expect(
          repository.getQuiz(f.owner.workspaceId, f.version.quizId),
        ).resolves.toMatchObject({
          status: "archived",
        });
      }
    },
  );

  it("recovers a published question receipt after source deletion and repository restart", async () => {
    const f = await publishedQuestionInsertionFixture("deleted-source-retry");
    await expect(f.sessions.transitionSessionCommand(f.command)).resolves.toMatchObject({
      status: "accepted",
      session: {
        content: f.command.content,
        revision: 1,
        eventSeq: 1,
        questionOpenedAt: f.command.occurredAt,
        questionClosesAt: new Date(f.command.occurredAt!.getTime() + 30_000),
      },
    });
    await f.sessions.transitionSessionCommand({
      ...f.command,
      commandId: randomUUID(),
      requestHash: "b".repeat(64),
      expectedRevision: 1,
      publishedQuestionSource: undefined,
      content: undefined,
      phase: "question_reveal",
      event: { ...f.command.event, type: "question.revealed" },
    });
    const current = await f.sessions.getSessionById(f.session.id);
    await repository.archiveQuiz(f.owner.workspaceId, f.version.quizId, true);
    await expect(repository.deleteQuiz(f.owner.workspaceId, f.version.quizId)).resolves.toBe(
      "deleted",
    );
    await expect(repository.getQuizVersion(f.owner.workspaceId, f.version.id)).resolves.toBeNull();
    const restarted = new PostgresPresentationSessionRepository(repository);
    await expect(restarted.transitionSessionCommand(f.command)).resolves.toEqual({
      status: "duplicate",
      session: current,
    });
    await expect(
      restarted.transitionSessionCommand({ ...f.command, requestHash: "c".repeat(64) }),
    ).resolves.toMatchObject({ status: "idempotency_conflict", session: current });
    await expect(restarted.getSessionById(f.session.id)).resolves.toEqual(current);
    await expect(restarted.listTimeline(f.session.id)).resolves.toHaveLength(2);
    await expect(
      restarted.findCommandReceipt(f.owner.workspaceId, f.session.id, f.command.commandId),
    ).resolves.toMatchObject({
      expectedRevision: 0,
      resultingRevision: 1,
      requestHash: f.command.requestHash,
    });
  });

  it("rejects published question source quiz, version, hash and tenant mismatches without writes", async () => {
    const f = await publishedQuestionInsertionFixture("source-guards");
    const other = await publishedQuestionInsertionFixture("foreign-source-guards");
    const source = f.command.publishedQuestionSource!;
    for (const publishedQuestionSource of [
      { ...source, quizId: randomUUID() },
      { ...source, versionId: randomUUID() },
      { ...source, contentHash: "f".repeat(64) },
      other.command.publishedQuestionSource!,
    ]) {
      const command = { ...f.command, publishedQuestionSource };
      await expect(f.sessions.transitionSessionCommand(command)).rejects.toBeInstanceOf(
        PresentationPublishedQuestionSourceUnavailableError,
      );
      await expect(f.sessions.getSessionById(f.session.id)).resolves.toEqual(f.session);
      await expect(f.sessions.listTimeline(f.session.id)).resolves.toEqual([]);
      await expect(
        f.sessions.findCommandReceipt(f.owner.workspaceId, f.session.id, command.commandId),
      ).resolves.toBeNull();
    }
  });

  it("keeps PostgreSQL on the shared published Pack metadata catalogue contract", async () => {
    const owner = await creator("recovery-pack-live-metadata-conformance");
    const outsider = await creator("recovery-pack-live-metadata-outsider");
    await expectRecoveryPackLiveMetadataConformance({
      repository,
      workspaceId: owner.workspaceId,
      otherWorkspaceId: outsider.workspaceId,
      editorId: owner.userId,
      otherEditorId: outsider.userId,
    });
  });

  it("persists card selections across repository restart and fences conflicting races and tenants", async () => {
    const owner = await creator("presentation-live-card-restart");
    const outsider = await creator("presentation-live-card-outsider");
    const published = await createPublishedPresentationFixture(owner, "Durable live cards");
    const sessions = new PostgresPresentationSessionRepository(repository);
    const now = new Date();
    const session = await sessions.createSession({
      id: randomUUID(),
      workspaceId: owner.workspaceId,
      presentationId: published.presentation.id,
      presentationVersionId: published.version.id,
      title: published.content.title,
      content: published.content,
      code: String(randomInt(1_000_000, 10_000_000)),
      status: "active",
      phase: "question_reveal",
      currentBlockIndex: 0,
      revision: 0,
      recoveryPackCardsEnabled: true,
      createdBy: owner.userId,
      createdAt: now,
      updatedAt: now,
      finishedAt: null,
      liveExpiresAt: new Date(now.getTime() + 60_000),
      retentionExpiresAt: new Date(now.getTime() + 86_400_000),
    });
    const intervention = presentationRecoveryPackIntervention();
    const command = {
      workspaceId: owner.workspaceId,
      sessionId: session.id,
      commandId: randomUUID(),
      expectedRevision: 0,
      requestHash: "a".repeat(64),
      phase: "intervention" as const,
      currentBlockIndex: 0,
      status: "active" as const,
      recoveryPackIntervention: intervention,
      event: {
        type: "intervention.presented" as const,
        blockIndex: 0,
        blockId: published.content.blocks[0]!.id,
      },
    };
    const results = await Promise.all([
      sessions.transitionSessionCommand(command),
      sessions.transitionSessionCommand({
        ...command,
        requestHash: "b".repeat(64),
        recoveryPackIntervention: { ...intervention, type: "example" },
      }),
    ]);
    expect(results.map(({ status }) => status).sort()).toEqual([
      "accepted",
      "idempotency_conflict",
    ]);
    const winner = results.find((result) => result.status === "accepted");
    if (winner?.status !== "accepted") throw new Error("Expected one accepted card command");
    const selected = winner.session.recoveryPackIntervention;
    if (!selected) throw new Error("Expected frozen card attribution on the winning command");
    const restarted = new PostgresPresentationSessionRepository(repository);
    await expect(
      restarted.getSessionForWorkspace(owner.workspaceId, session.id),
    ).resolves.toMatchObject({
      recoveryPackCardsEnabled: true,
      recoveryPackIntervention: selected,
      revision: 1,
    });
    await expect(restarted.listTimeline(session.id)).resolves.toEqual([
      expect.objectContaining({ recoveryPackIntervention: selected }),
    ]);
    await expect(
      restarted.findCommandReceipt(outsider.workspaceId, session.id, command.commandId),
    ).resolves.toBeNull();
    const client = await runtimePool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.workspace_id', $1, true)", [outsider.workspaceId]);
      for (const table of [
        "presentation_live_sessions",
        "presentation_session_timeline",
        "presentation_session_command_receipts",
      ]) {
        const visible = await client.query(`SELECT * FROM ${table} WHERE workspace_id = $1`, [
          owner.workspaceId,
        ]);
        expect(visible.rows, table).toEqual([]);
      }
      await client.query("ROLLBACK");
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.workspace_id', $1, true)", [owner.workspaceId]);
      const malformedInterventions = [
        JSON.stringify(selected).replace(
          `"contentHash":"${selected.reference.contentHash}"`,
          `"contentHash":${"7".repeat(64)}`,
        ),
        JSON.stringify({ ...selected, type: 1 }),
        JSON.stringify({ ...selected, reference: { ...selected.reference, cardId: 1 } }),
        JSON.stringify({ ...selected, reference: { ...selected.reference, packVersion: "1" } }),
        JSON.stringify({
          ...selected,
          reference: { ...selected.reference, packVersion: 9007199254740992 },
        }),
        ...["insertionId", "packId", "packVersionId", "cardId"].flatMap((field) =>
          presentationRecoveryPackUuidCases.rejected.map((value) =>
            JSON.stringify({ ...selected, reference: { ...selected.reference, [field]: value } }),
          ),
        ),
      ];
      for (const malformed of malformedInterventions) {
        await client.query("SAVEPOINT malformed_card_attribution");
        await expect(
          client.query(
            "UPDATE presentation_live_sessions SET recovery_pack_intervention = $2::jsonb WHERE id = $1",
            [session.id, malformed],
          ),
        ).rejects.toMatchObject({ code: "23514" });
        await client.query("ROLLBACK TO SAVEPOINT malformed_card_attribution");
      }
      for (const field of ["insertionId", "packId", "packVersionId", "cardId"]) {
        for (const value of presentationRecoveryPackUuidCases.accepted) {
          await client.query("SAVEPOINT permitted_card_uuid");
          await client.query(
            "UPDATE presentation_live_sessions SET recovery_pack_intervention = $2::jsonb WHERE id = $1",
            [
              session.id,
              JSON.stringify({
                ...selected,
                reference: { ...selected.reference, [field]: value },
              }),
            ],
          );
          await client.query("ROLLBACK TO SAVEPOINT permitted_card_uuid");
        }
      }
      await expect(
        client.query(
          "UPDATE presentation_live_sessions SET recovery_pack_cards_enabled = false WHERE id = $1",
          [session.id],
        ),
      ).rejects.toMatchObject({ code: "23514" });
      await client.query("ROLLBACK");
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.workspace_id', $1, true)", [owner.workspaceId]);
      // Exercise the overlap writer, which supplies no new card column.
      await client.query(
        "UPDATE presentation_live_sessions SET phase = 'question_open', revision = revision + 1 WHERE id = $1",
        [session.id],
      );
      await client.query("COMMIT");
    } finally {
      await client.query("ROLLBACK").catch(() => undefined);
      client.release();
    }
    await expect(
      restarted.getSessionForWorkspace(owner.workspaceId, session.id),
    ).resolves.toMatchObject({
      recoveryPackCardsEnabled: true,
      recoveryPackIntervention: null,
      revision: 2,
    });
    await expect(restarted.listTimeline(session.id)).resolves.toEqual([
      expect.objectContaining({ recoveryPackIntervention: selected }),
    ]);
  });

  it("durably queues, leases, completes, fails, and exports Presentation reports", async () => {
    const owner = await creator("presentation-report-owner");
    const outsider = await creator("presentation-report-outsider");
    const published = await createPublishedPresentationFixture(owner, "Durable report");
    const { session, sessions } = await createPresentationSessionFixture(
      owner,
      published,
      String(randomInt(1_000_000, 10_000_000)),
    );
    const finishedAt = new Date("2000-01-01T00:00:00.000Z");
    await sessions.transitionSession({
      workspaceId: owner.workspaceId,
      sessionId: session.id,
      expectedRevision: 0,
      phase: "finished",
      currentBlockIndex: -1,
      status: "finished",
      occurredAt: finishedAt,
      event: { type: "presentation.finished", blockIndex: null, blockId: null },
    });

    await expect(sessions.getReport(outsider.workspaceId, session.id)).resolves.toBeNull();
    await expect(sessions.getReport(owner.workspaceId, session.id)).resolves.toMatchObject({
      id: session.id,
      workspaceId: owner.workspaceId,
      sessionId: session.id,
      status: "pending",
      schemaVersion: 1,
      payload: null,
      generatedAt: null,
      expiresAt: session.retentionExpiresAt,
    });

    const leaseUntil = new Date(Date.now() + 60_000);
    const job = await sessions.claimReportJob(new Date(), leaseUntil);
    expect(job).toMatchObject({
      reportId: session.id,
      workspaceId: owner.workspaceId,
      sessionId: session.id,
      attempts: 1,
      expiresAt: session.retentionExpiresAt,
    });
    const payload = { artifactType: "presentation", participantCount: 0 };
    const generatedAt = new Date();
    await sessions.completeReportJob(job!, {
      reportId: session.id,
      sessionId: session.id,
      schemaVersion: 1,
      payload,
      generatedAt,
    });
    await expect(sessions.getReport(owner.workspaceId, session.id)).resolves.toMatchObject({
      status: "ready",
      schemaVersion: 1,
      payload,
      generatedAt,
    });
    await expect(repository.exportAccount(owner.userId)).resolves.toMatchObject({
      presentationSessionReports: [
        expect.objectContaining({ id: session.id, status: "ready", payload }),
      ],
    });

    const failedFixture = await createPresentationSessionFixture(
      owner,
      published,
      String(randomInt(1_000_000, 10_000_000)),
    );
    await failedFixture.sessions.transitionSession({
      workspaceId: owner.workspaceId,
      sessionId: failedFixture.session.id,
      expectedRevision: 0,
      phase: "finished",
      currentBlockIndex: -1,
      status: "finished",
      occurredAt: new Date(finishedAt.getTime() + 1),
      event: { type: "presentation.finished", blockIndex: null, blockId: null },
    });
    const failedJob = await sessions.claimReportJob(new Date(), leaseUntil);
    expect(failedJob).toMatchObject({ reportId: failedFixture.session.id, attempts: 1 });
    await sessions.retryReportJob(failedJob!, "terminal failure", new Date(), true);
    await expect(
      sessions.getReport(owner.workspaceId, failedFixture.session.id),
    ).resolves.toMatchObject({ status: "failed", payload: null, generatedAt: null });
  });

  it("fences a reclaimed Presentation report job from its expired PostgreSQL worker", async () => {
    const owner = await creator("presentation-report-fencing-owner");
    const published = await createPublishedPresentationFixture(owner, "Fenced report");
    const { session, sessions } = await createPresentationSessionFixture(
      owner,
      published,
      String(randomInt(1_000_000, 10_000_000)),
    );
    const finishedAt = new Date("1999-01-01T00:00:00.000Z");
    await sessions.transitionSession({
      workspaceId: owner.workspaceId,
      sessionId: session.id,
      expectedRevision: 0,
      phase: "finished",
      currentBlockIndex: -1,
      status: "finished",
      occurredAt: finishedAt,
      event: { type: "presentation.finished", blockIndex: null, blockId: null },
    });

    const firstLeaseUntil = new Date(finishedAt.getTime() + 1_000);
    const firstWorkerJob = await sessions.claimReportJob(finishedAt, firstLeaseUntil);
    const secondClaimAt = new Date(firstLeaseUntil.getTime() + 1);
    const secondLeaseUntil = new Date(secondClaimAt.getTime() + 60_000);
    const secondWorkerJob = await sessions.claimReportJob(secondClaimAt, secondLeaseUntil);

    expect(firstWorkerJob).toMatchObject({ reportId: session.id, attempts: 1 });
    expect(secondWorkerJob).toMatchObject({ reportId: session.id, attempts: 2 });
    expect(secondWorkerJob!.leaseToken).not.toBe(firstWorkerJob!.leaseToken);

    await sessions.retryReportJob(firstWorkerJob!, "stale retry", secondClaimAt, false);
    await sessions.retryReportJob(firstWorkerJob!, "stale terminal failure", secondClaimAt, true);
    await expect(
      sessions.completeReportJob(firstWorkerJob!, {
        reportId: session.id,
        sessionId: session.id,
        schemaVersion: 1,
        payload: { worker: "stale" },
        generatedAt: secondClaimAt,
      }),
    ).rejects.toThrow("no longer pending");
    await expect(sessions.getReport(owner.workspaceId, session.id)).resolves.toMatchObject({
      status: "pending",
      payload: null,
    });
    await expect(sessions.claimReportJob(secondClaimAt, secondLeaseUntil)).resolves.toBeNull();

    const payload = { worker: "current" };
    await sessions.completeReportJob(secondWorkerJob!, {
      reportId: session.id,
      sessionId: session.id,
      schemaVersion: 1,
      payload,
      generatedAt: secondClaimAt,
    });
    await expect(sessions.getReport(owner.workspaceId, session.id)).resolves.toMatchObject({
      status: "ready",
      payload,
    });
  });

  it("defaults legacy report trust mode in account exports", async () => {
    const owner = await creator("legacy-report-export");
    const fixture = await createPublishedRoundFixture(owner, "Legacy report export");
    const session = await createRoundSessionFixture(
      owner,
      fixture,
      String(randomInt(1_000_000, 10_000_000)),
    );
    const now = new Date();
    const legacyReport: Report = {
      id: randomUUID(),
      sessionId: session.id,
      status: "ready",
      generatedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60_000).toISOString(),
      metrics: {
        participantCount: 0,
        completedCount: 0,
        answerCount: 0,
        accuracyPercent: 0,
      },
      questions: [],
      participants: [],
    };
    await repository.saveReport(owner.workspaceId, legacyReport);

    const stored = await runtimePool.connect();
    try {
      await stored.query("BEGIN");
      await stored.query("SELECT set_config('app.workspace_id', $1, true)", [owner.workspaceId]);
      await expect(
        stored.query<{ has_trust_mode: boolean }>(
          `SELECT metrics ? 'trustMode' AS has_trust_mode FROM reports WHERE id = $1`,
          [legacyReport.id],
        ),
      ).resolves.toMatchObject({ rows: [{ has_trust_mode: false }] });
      await stored.query("ROLLBACK");
    } finally {
      stored.release();
    }

    const exported = await repository.exportAccount(owner.userId);
    expect(exported.reports).toEqual([
      expect.objectContaining({
        id: legacyReport.id,
        metrics: expect.objectContaining({ trustMode: "learning" }),
      }),
    ]);
  });

  it("derives legacy report trust mode from its source session in account exports", async () => {
    const owner = await creator("legacy-verified-report-export");
    const fixture = await createPublishedRoundFixture(owner, "Legacy verified report export");
    const session = await createRoundSessionFixture(
      owner,
      fixture,
      String(randomInt(1_000_000, 10_000_000)),
      "verified",
    );
    const now = new Date();
    const legacyReport: Report = {
      id: randomUUID(),
      sessionId: session.id,
      status: "ready",
      generatedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60_000).toISOString(),
      metrics: {
        participantCount: 0,
        completedCount: 0,
        answerCount: 0,
        accuracyPercent: 0,
      },
      questions: [],
      participants: [],
    };
    await repository.saveReport(owner.workspaceId, legacyReport);

    const exported = await repository.exportAccount(owner.userId);
    expect(exported.reports).toEqual([
      expect.objectContaining({
        id: legacyReport.id,
        metrics: expect.objectContaining({ trustMode: "verified" }),
      }),
    ]);
  });

  it("reclaims released room codes across workspaces and removes claims with their source", async () => {
    const first = await creator("room-registry-first");
    const second = await creator("room-registry-second");
    const [firstRound, secondRound, secondPresentation] = await Promise.all([
      createPublishedRoundFixture(first, "First room registry source"),
      createPublishedRoundFixture(second, "Second room registry source"),
      createPublishedPresentationFixture(second, "Presentation room registry source"),
    ]);
    const code = String(randomInt(1_000_000, 10_000_000));
    const firstSession = await createRoundSessionFixture(first, firstRound, code);

    await expect(
      createPresentationSessionFixture(second, secondPresentation, code),
    ).rejects.toMatchObject({ code: "23505", constraint: "live_room_codes_pkey" });

    const firstClient = await runtimePool.connect();
    try {
      await firstClient.query("BEGIN");
      await firstClient.query("SELECT set_config('app.workspace_id', $1, true)", [
        first.workspaceId,
      ]);
      await firstClient.query("SAVEPOINT immutable_code");
      await expect(
        firstClient.query("UPDATE game_sessions SET code = $2 WHERE id = $1", [
          firstSession.id,
          String(randomInt(1_000_000, 10_000_000)),
        ]),
      ).rejects.toMatchObject({ code: "23514" });
      await firstClient.query("ROLLBACK TO SAVEPOINT immutable_code");
      await firstClient.query(
        `UPDATE game_sessions
         SET ended_at = now(), updated_at = now()
         WHERE id = $1`,
        [firstSession.id],
      );
      await firstClient.query("COMMIT");
    } catch (error) {
      await firstClient.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      firstClient.release();
    }

    const { session: presentationSession, sessions: presentationSessions } =
      await createPresentationSessionFixture(second, secondPresentation, code);
    await expect(createRoundSessionFixture(second, secondRound, code)).rejects.toBeInstanceOf(
      SessionCodeConflictError,
    );
    await expect(repository.getLiveRoomCode(code)).resolves.toMatchObject({
      workspaceId: second.workspaceId,
      artifactType: "presentation",
      artifactId: presentationSession.id,
    });

    await presentationSessions.transitionSession({
      workspaceId: second.workspaceId,
      sessionId: presentationSession.id,
      expectedRevision: presentationSession.revision,
      phase: "finished",
      currentBlockIndex: presentationSession.currentBlockIndex,
      status: "finished",
      event: {
        type: "presentation.finished",
        blockIndex: null,
        blockId: null,
      },
    });
    const secondSession = await createRoundSessionFixture(second, secondRound, code);
    const claimPrivilege = await runtimePool.query<{ can_execute: boolean }>(
      `SELECT has_function_privilege(current_user, procedure.oid, 'EXECUTE') AS can_execute
       FROM pg_proc AS procedure
       JOIN pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
       WHERE namespace.nspname = 'public' AND procedure.proname = 'claim_live_room_code'`,
    );
    expect(claimPrivilege.rows).toEqual([{ can_execute: false }]);
    const inspector = await runtimePool.connect();
    try {
      await inspector.query("BEGIN");
      await inspector.query("SELECT set_config('app.system_access', 'on', true)");
      await expect(
        inspector.query<{
          workspace_id: string;
          artifact_type: string;
          artifact_id: string;
        }>(
          `SELECT workspace_id, artifact_type, artifact_id
           FROM live_room_codes WHERE code = $1`,
          [code],
        ),
      ).resolves.toMatchObject({
        rows: [
          {
            workspace_id: second.workspaceId,
            artifact_type: "round",
            artifact_id: secondSession.id,
          },
        ],
      });
      await inspector.query("ROLLBACK");
    } finally {
      inspector.release();
    }

    const secondClient = await runtimePool.connect();
    try {
      await secondClient.query("BEGIN");
      await secondClient.query("SELECT set_config('app.workspace_id', $1, true)", [
        second.workspaceId,
      ]);
      await secondClient.query("DELETE FROM game_sessions WHERE id = $1", [secondSession.id]);
      await secondClient.query("COMMIT");
    } catch (error) {
      await secondClient.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      secondClient.release();
    }

    const afterDelete = await runtimePool.connect();
    try {
      await afterDelete.query("BEGIN");
      await afterDelete.query("SELECT set_config('app.system_access', 'on', true)");
      await expect(
        afterDelete.query<{ count: string }>(
          "SELECT count(*) FROM live_room_codes WHERE code = $1",
          [code],
        ),
      ).resolves.toMatchObject({ rows: [{ count: "0" }] });
      await afterDelete.query("ROLLBACK");
    } finally {
      afterDelete.release();
    }
  });

  it("binds session events to the parent workspace and permits ordered command journals", async () => {
    const first = await creator("session-event-first");
    const second = await creator("session-event-second");
    const [firstRound, secondRound] = await Promise.all([
      createPublishedRoundFixture(first, "First event source"),
      createPublishedRoundFixture(second, "Second event source"),
    ]);
    const firstSession = await createRoundSessionFixture(
      first,
      firstRound,
      String(randomInt(1_000_000, 10_000_000)),
    );
    const secondSession = await createRoundSessionFixture(
      second,
      secondRound,
      String(randomInt(1_000_000, 10_000_000)),
    );
    const commandId = `command-${randomUUID()}`;
    const expiresAt = new Date(Date.now() + 60_000);
    const eventIds = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];

    const firstClient = await runtimePool.connect();
    try {
      await firstClient.query("BEGIN");
      await firstClient.query("SELECT set_config('app.workspace_id', $1, true)", [
        first.workspaceId,
      ]);
      await firstClient.query("SAVEPOINT cross_tenant_event");
      await expect(
        firstClient.query(
          `INSERT INTO session_events
             (id, workspace_id, session_id, seq, type, payload, command_id, event_ordinal,
              expires_at)
           VALUES ($1,$2,$3,1,'test.event','{}'::jsonb,$4,0,$5)`,
          [randomUUID(), first.workspaceId, secondSession.id, commandId, expiresAt],
        ),
      ).rejects.toMatchObject({ code: "42501" });
      await firstClient.query("ROLLBACK TO SAVEPOINT cross_tenant_event");
      await firstClient.query("SAVEPOINT mismatched_parent_fk");
      await firstClient.query("SELECT set_config('app.system_access', 'on', true)");
      await expect(
        firstClient.query(
          `INSERT INTO session_events
             (id, workspace_id, session_id, seq, type, payload, command_id, event_ordinal,
              expires_at)
           VALUES ($1,$2,$3,1,'test.event','{}'::jsonb,$4,0,$5)`,
          [randomUUID(), first.workspaceId, secondSession.id, commandId, expiresAt],
        ),
      ).rejects.toMatchObject({ code: "23503" });
      await firstClient.query("ROLLBACK TO SAVEPOINT mismatched_parent_fk");

      for (let index = 0; index < eventIds.length; index += 1) {
        await firstClient.query(
          `INSERT INTO session_events
             (id, workspace_id, session_id, seq, type, payload, command_id, event_ordinal,
              expires_at)
           VALUES ($1,$2,$3,$4,'test.event',$5::jsonb,$6,$7,$8)`,
          [
            eventIds[index],
            first.workspaceId,
            firstSession.id,
            index + 1,
            JSON.stringify({ index }),
            index < 2 ? commandId : null,
            index < 2 ? index : 0,
            expiresAt,
          ],
        );
      }
      await expect(
        firstClient.query<{ count: string }>("SELECT count(*) FROM session_events"),
      ).resolves.toMatchObject({ rows: [{ count: "4" }] });
      await firstClient.query("COMMIT");
    } catch (error) {
      await firstClient.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      firstClient.release();
    }

    const secondClient = await runtimePool.connect();
    try {
      await secondClient.query("BEGIN");
      await secondClient.query("SELECT set_config('app.workspace_id', $1, true)", [
        second.workspaceId,
      ]);
      await expect(
        secondClient.query<{ count: string }>("SELECT count(*) FROM session_events"),
      ).resolves.toMatchObject({ rows: [{ count: "0" }] });
      await secondClient.query("ROLLBACK");
    } finally {
      secondClient.release();
    }
  });

  it("commits decision events with the matching Round state and rolls both back on conflict", async () => {
    const owner = await creator("decision-replay-postgres");
    const round = await createPublishedRoundFixture(owner, "Decision replay transaction");
    const session = await createRoundSessionFixture(
      owner,
      round,
      String(randomInt(1_000_000, 10_000_000)),
      "learning",
      true,
    );
    const storedSession = await repository.getSessionById(session.id);
    if (!storedSession) throw new Error("Expected a stored replay session");
    const now = new Date();
    const started = applyHostCommand(session.state, {
      commandId: randomUUID(),
      expectedVersion: session.state.version,
      action: "start",
      nowMs: now.getTime(),
      newRoundId: randomUUID,
    });
    await repository.saveSession(
      { ...storedSession, state: started.state, decisionReplayEnabled: true },
      session.state.version,
    );
    const locked = applyHostCommand(started.state, {
      commandId: randomUUID(),
      expectedVersion: started.state.version,
      action: "lock",
      nowMs: now.getTime() + 1_000,
      newRoundId: randomUUID,
    });
    const seq = locked.events.find((event) => event.type === "checkpoint.insight")?.seq;
    if (!seq || !locked.state.roundId) throw new Error("Expected the checkpoint insight event");
    const insight = {
      seq,
      occurredAt: new Date(now.getTime() + 1_000).toISOString(),
      type: "insight_shown" as const,
      roundId: locked.state.roundId,
      questionId: locked.state.quiz.questions[locked.state.questionIndex!]!.id,
      sampleSize: 0,
      activeParticipantCount: 0,
      recommendationCode: "insufficient_sample" as const,
      ruleSetVersion: "checkpoint-insight-v1",
    };
    await repository.saveSession(
      { ...storedSession, state: locked.state, decisionReplayEnabled: true },
      started.state.version,
      undefined,
      [{ event: insight, commandId: "decision-lock-command", eventOrdinal: 0 }],
    );
    expect(await repository.getSessionEvidence(owner.workspaceId, session.id)).toMatchObject({
      decisionReplayEnabled: true,
      decisionEvents: [insight],
      decisionEventsComplete: true,
    });

    const revealed = applyHostCommand(locked.state, {
      commandId: randomUUID(),
      expectedVersion: locked.state.version,
      action: "reveal",
      nowMs: now.getTime() + 2_000,
      newRoundId: randomUUID,
    });
    await expect(
      repository.saveSession(
        { ...storedSession, state: revealed.state, decisionReplayEnabled: true },
        locked.state.version,
        undefined,
        [
          {
            event: {
              seq: insight.seq,
              occurredAt: new Date(now.getTime() + 2_000).toISOString(),
              type: "answer_revealed",
              roundId: insight.roundId,
              questionId: insight.questionId,
            },
            commandId: "decision-reveal-command",
            eventOrdinal: 0,
          },
        ],
      ),
    ).rejects.toMatchObject({ code: "23505" });
    await expect(repository.getSessionById(session.id)).resolves.toMatchObject({
      state: { version: locked.state.version, phase: "question_locked" },
    });
    expect(
      (await repository.getSessionEvidence(owner.workspaceId, session.id)).decisionEvents,
    ).toEqual([insight]);
  });

  it("persists frozen Pack card evidence across restart/source deletion with RLS and retention cascades", async () => {
    const owner = await creator("pack-card-evidence");
    const other = await creator("pack-card-other");
    const packs = createRecoveryPackRepository(repository);
    const pack = await packs.createRecoveryPack(
      recoveryPackRecord(owner.workspaceId, owner.userId),
    );
    const content = RecoveryPackContentSchema.parse(pack.draft);
    const packVersion = await packs.publishRecoveryPack(
      {
        id: randomUUID(),
        workspaceId: owner.workspaceId,
        packId: pack.id,
        version: 1,
        content,
        contentHash: recoveryPackContentHash(content),
        sourceDraftRevision: 0,
        publishedAt: new Date(),
      },
      0,
    );
    const insertion = {
      id: randomUUID(),
      packId: pack.id,
      packVersionId: packVersion.id,
      packVersion: 1,
      contentHash: packVersion.contentHash,
      diagnosticQuestionId: content.diagnostic.id,
      recheckQuestionId: content.recheck.id,
      originalContent: content,
    };
    const round = await createPublishedRoundFixture(owner, "Pack cards", {
      title: "Pack cards",
      description: "",
      questions: [content.diagnostic, content.recheck],
      recoveryPackInsertions: [insertion],
    });
    const created = await createRoundSessionFixture(
      owner,
      round,
      String(randomInt(1_000_000, 10_000_000)),
      "learning",
      true,
      true,
    );
    const stored = (await repository.getSessionById(created.id))!;
    let state = created.state;
    for (const action of ["start", "lock", "reveal", "intervention.start"] as const) {
      state = applyHostCommand(state, {
        commandId: randomUUID(),
        expectedVersion: state.version,
        action,
        ...(action === "intervention.start"
          ? {
              interventionType: "explain" as const,
              recoveryPackCard: { insertionId: insertion.id, cardId: content.interventions[0]!.id },
            }
          : {}),
        nowMs: Date.now(),
        newRoundId: randomUUID,
      }).state;
    }
    const reference = state.intervention!.recoveryPackCard!;
    const startedEvent = {
      type: "intervention_started" as const,
      seq: state.seq,
      occurredAt: new Date().toISOString(),
      roundId: state.roundId!,
      interventionType: "explain" as const,
      recoveryPackCard: reference,
    };
    await repository.saveSession({ ...stored, state }, stored.state.version, undefined, [
      { event: startedEvent, commandId: "pack-card-start", eventOrdinal: 0 },
    ]);
    expect(await packs.deleteRecoveryPack(owner.workspaceId, pack.id)).toBe(true);
    const restarted = new PostgresRepository(runtimeUrl!);
    try {
      expect(await restarted.getSessionById(created.id)).toMatchObject({
        state: {
          stateSchemaVersion: 6,
          recoveryPackCardsEnabled: true,
          intervention: { recoveryPackCard: reference },
        },
      });
      expect(await restarted.getSessionEvidence(owner.workspaceId, created.id)).toMatchObject({
        interventions: [{ recoveryPackCard: reference }],
        decisionEvents: [startedEvent],
      });
      expect(
        (await restarted.getSessionEvidence(other.workspaceId, created.id)).interventions,
      ).toEqual([]);
      const exported = await restarted.exportAccount(owner.userId);
      expect(JSON.stringify(exported)).toContain(reference.cardId);
      const client = await runtimePool.connect();
      try {
        await client.query("BEGIN");
        await client.query("SELECT set_config('app.workspace_id', $1, true)", [other.workspaceId]);
        expect(
          (
            await client.query(
              "SELECT recovery_pack_card FROM session_interventions WHERE session_id = $1",
              [created.id],
            )
          ).rows,
        ).toEqual([]);
        await client.query("ROLLBACK");
      } finally {
        client.release();
      }
      // Retention and explicit deletion both use the parent session's existing cascade.
      await restarted.saveSession(
        { ...stored, state, retentionExpiresAt: new Date(0) },
        state.version,
      );
      await restarted.purgeExpired(new Date());
      expect(await restarted.getSessionById(created.id)).toBeNull();
      expect(
        (await restarted.getSessionEvidence(owner.workspaceId, created.id)).interventions,
      ).toEqual([]);
    } finally {
      await restarted.close();
    }
  });

  it("persists an idempotent locale preference for only the selected user", async () => {
    const first = await creator("locale-first");
    const second = await creator("locale-second");

    expect(first.locale).toBe("en-CA");
    expect(first.localePreferenceSet).toBe(false);
    expect(second.locale).toBe("en-CA");
    expect(second.localePreferenceSet).toBe(false);
    await expect(repository.updateUserLocale(first.userId, "zh-TW")).resolves.toBe("zh-TW");
    await expect(repository.updateUserLocale(first.userId, "zh-TW")).resolves.toBe("zh-TW");

    await expect(
      repository.getCreatorByUserId(first.userId, first.workspaceId),
    ).resolves.toMatchObject({ locale: "zh-TW", localePreferenceSet: true });
    await expect(
      repository.getCreatorByUserId(second.userId, second.workspaceId),
    ).resolves.toMatchObject({ locale: "en-CA", localePreferenceSet: false });

    const returningTokenHash = `test-locale-returning-${randomUUID()}`;
    await repository.createMagicToken({
      id: randomUUID(),
      email: first.email,
      segment: "education",
      tokenHash: returningTokenHash,
      policyVersion: "test-v1",
      expiresAt: new Date(Date.now() + 60_000),
      consumedAt: null,
    });
    await expect(
      repository.consumeMagicToken(returningTokenHash, new Date()),
    ).resolves.toMatchObject({ locale: "zh-TW", localePreferenceSet: true });
    const localeSessionTokenHash = `test-locale-session-${randomUUID()}`;
    await repository.createCreatorSession({
      id: randomUUID(),
      userId: first.userId,
      tokenHash: localeSessionTokenHash,
      expiresAt: new Date(Date.now() + 60_000),
      activeWorkspaceId: first.workspaceId,
    });
    await expect(
      repository.getCreatorBySession(localeSessionTokenHash, new Date()),
    ).resolves.toMatchObject({ locale: "zh-TW", localePreferenceSet: true });
    await expect(repository.exportAccount(first.userId)).resolves.toMatchObject({
      profile: { locale: "zh-TW", localePreferenceSet: true },
    });
    await expect(repository.updateUserLocale(randomUUID(), "de-DE")).resolves.toBeNull();
  });

  it("persists tenant-scoped, revision-fenced Question Health dismissals in account exports", async () => {
    const owner = await creator("question-health-dismissal");
    const other = await creator("question-health-dismissal-other");
    const now = new Date();
    const draft = publishableRound("Dismissal persistence");
    const quiz = await repository.createQuiz({
      id: randomUUID(),
      workspaceId: owner.workspaceId,
      title: draft.title,
      description: draft.description,
      status: "draft",
      draft,
      currentVersionId: null,
      createdAt: now,
      updatedAt: now,
    });
    const dismissalInput = {
      actorId: owner.userId,
      workspaceId: owner.workspaceId,
      quizId: quiz.id,
      findingId: "qh-1.0.0-question.missing_citation-question-field",
      ruleVersion: 1,
      rulesetVersion: "1.0.0",
      contentHash: "a".repeat(64),
      reason: "intentional_choice" as const,
      expectedDraftRevision: 0,
      requestId: randomUUID(),
    };

    const saved = await repository.putQuestionHealthDismissal(dismissalInput);
    expect(saved.status).toBe("ok");
    expect(await repository.listQuestionHealthDismissals(owner.workspaceId, quiz.id)).toHaveLength(
      1,
    );
    expect(await repository.listQuestionHealthDismissals(other.workspaceId, quiz.id)).toEqual([]);
    expect(
      await repository.putQuestionHealthDismissal({
        ...dismissalInput,
        expectedDraftRevision: 1,
      }),
    ).toEqual({ status: "revision_conflict" });

    const accountExport = (await repository.exportAccount(owner.userId)) as {
      questionHealthDismissals?: Array<{ quiz_id: string; reason: string }>;
    };
    expect(accountExport.questionHealthDismissals).toEqual([
      expect.objectContaining({ quiz_id: quiz.id, reason: "intentional_choice" }),
    ]);

    expect(await repository.deleteQuestionHealthDismissal(dismissalInput)).toEqual({
      status: "ok",
      removed: true,
    });
    expect(await repository.listQuestionHealthDismissals(owner.workspaceId, quiz.id)).toEqual([]);
  });

  it("projects only retained aggregate reports for the exact Question Health version and workspace", async () => {
    const owner = await creator("question-health-observation");
    const other = await creator("question-health-observation-other");
    const fixture = await createPublishedRoundFixture(owner, "Question Health observation");
    const { id: sessionId, state } = await createRoundSessionFixture(
      owner,
      fixture,
      String(randomInt(1_000_000, 9_999_999)),
    );
    const now = new Date();
    const question = fixture.content.questions[0]!;
    const session = await repository.getSessionById(sessionId);
    if (!session) throw new Error("Expected the observation fixture session");
    const report: Report = {
      id: randomUUID(),
      sessionId,
      schemaVersion: 1,
      trustMode: "learning",
      timeMode: "timed",
      status: "ready",
      generatedAt: now.toISOString(),
      expiresAt: session.retentionExpiresAt.toISOString(),
      metrics: {
        participantCount: 20,
        completedCount: 20,
        answerCount: 20,
        accuracyPercent: 60,
      },
      questions: [
        {
          questionId: question.id,
          prompt: question.prompt,
          responses: 20,
          correct: 12,
          accuracyPercent: 60,
          difficult: false,
        },
      ],
      participants: [],
    };
    expect(state.sessionId).toBe(sessionId);
    await repository.saveReport(owner.workspaceId, report);

    const observations = await repository.listQuestionHealthObservationReports(
      owner.workspaceId,
      fixture.version.quizId,
      fixture.version.id,
      now,
    );
    expect(observations).toEqual({
      hasMoreReports: false,
      reports: [
        {
          trustMode: "learning",
          timeMode: "timed",
          scoringMode: "accuracy",
          questions: [{ questionId: question.id, responses: 20, correct: 12 }],
        },
      ],
    });
    expect(JSON.stringify(observations)).not.toContain(question.prompt);
    expect(JSON.stringify(observations)).not.toContain("sessionId");
    await expect(
      repository.listQuestionHealthObservationReports(
        owner.workspaceId,
        fixture.version.quizId,
        randomUUID(),
        now,
      ),
    ).resolves.toEqual({ reports: [], hasMoreReports: false });
    await expect(
      repository.listQuestionHealthObservationReports(
        other.workspaceId,
        fixture.version.quizId,
        fixture.version.id,
        now,
      ),
    ).resolves.toEqual({ reports: [], hasMoreReports: false });
  });

  it("atomically stores tenant-scoped Question Health application provenance with a draft revision", async () => {
    const owner = await creator("question-health-application");
    const other = await creator("question-health-application-other");
    const now = new Date();
    const old = new Date(now.getTime() - 31 * 24 * 60 * 60 * 1_000);
    const draft = publishableRound("Application persistence");
    const quiz = await repository.createQuiz({
      id: randomUUID(),
      workspaceId: owner.workspaceId,
      title: draft.title,
      description: draft.description,
      status: "draft",
      draft,
      currentVersionId: null,
      createdAt: old,
      updatedAt: old,
    });
    const applicationId = randomUUID();
    const changed = {
      ...draft,
      questions: [{ ...draft.questions[0]!, explanation: "A reviewed explanation." }],
    } as QuizDraft;
    const mutation = {
      workspaceId: owner.workspaceId,
      quizId: quiz.id,
      draft: changed,
      expectedRevision: 0,
      mutationId: applicationId,
      editorId: owner.userId,
      schemaVersion: 1,
      draftHash: createHash("sha256").update(JSON.stringify(changed)).digest("hex"),
      questionHealthApplication: {
        workspaceId: owner.workspaceId,
        quizId: quiz.id,
        applicationId,
        findingId: "qh-test-missing-explanation",
        ruleVersion: 1,
        rulesetVersion: "1.0.0",
        contentHash: "a".repeat(64),
        sourceRevision: 0,
        requestHash: "b".repeat(64),
        changes: [
          {
            fieldPath: "questions.0.explanation",
            before: "One plus one is two.",
            after: "A reviewed explanation.",
          },
        ],
        requestId: randomUUID(),
      },
    };
    await expect(repository.updateQuizDraft(mutation)).resolves.toMatchObject({ draftRevision: 1 });
    await expect(repository.updateQuizDraft(mutation)).resolves.toMatchObject({ draftRevision: 1 });
    expect(
      await repository.getQuestionHealthApplication(owner.workspaceId, quiz.id, applicationId),
    ).toMatchObject({ sourceRevision: 0, appliedRevision: 1, requestHash: "b".repeat(64) });
    expect(
      await repository.getQuestionHealthApplication(other.workspaceId, quiz.id, applicationId),
    ).toBeNull();
    expect(
      (await repository.listQuizDraftHistory(owner.workspaceId, quiz.id)).map(
        (snapshot) => snapshot.revision,
      ),
    ).toContain(0);
    await expect(
      repository.updateQuizDraft({
        ...mutation,
        questionHealthApplication: {
          ...mutation.questionHealthApplication,
          requestHash: "c".repeat(64),
        },
      }),
    ).rejects.toThrow();
    const accountExport = (await repository.exportAccount(owner.userId)) as {
      questionHealthApplications?: Array<{ application_id: string }>;
    };
    expect(accountExport.questionHealthApplications).toMatchObject([
      { application_id: applicationId },
    ]);
  });

  it("atomically fences draft replacements and revision-bound publishing", async () => {
    const owner = await creator("draft-revision");
    const now = new Date();
    const quizId = randomUUID();
    const original = publishableRound("Original");
    const created = await repository.createQuiz({
      id: quizId,
      workspaceId: owner.workspaceId,
      title: original.title,
      description: original.description,
      status: "draft",
      draft: original,
      currentVersionId: null,
      createdAt: now,
      updatedAt: now,
    });
    expect(created.draftRevision).toBe(0);

    const next = { ...original, title: "Saved" };
    const mutationId = randomUUID();
    const mutation = {
      workspaceId: owner.workspaceId,
      quizId,
      draft: next,
      expectedRevision: 0,
      mutationId,
      editorId: owner.userId,
      schemaVersion: 1,
      draftHash: "saved-draft",
    };
    await expect(repository.updateQuizDraft(mutation)).resolves.toMatchObject({
      draftRevision: 1,
      lastEditedBy: owner.userId,
    });
    await expect(repository.updateQuizDraft(mutation)).resolves.toMatchObject({
      draftRevision: 1,
    });
    await expect(
      repository.updateQuizDraft({
        ...mutation,
        draft: original,
        mutationId: randomUUID(),
        draftHash: "stale-draft",
      }),
    ).rejects.toEqual(expect.objectContaining({ expectedRevision: 0, currentRevision: 1 }));
    await expect(repository.listQuizDraftHistory(owner.workspaceId, quizId)).resolves.toEqual([
      expect.objectContaining({ revision: 1, savedBy: owner.userId }),
      expect.objectContaining({ revision: 0 }),
    ]);

    const publication = {
      id: randomUUID(),
      workspaceId: owner.workspaceId,
      quizId,
      version: 1,
      content: next,
      contentHash: randomUUID(),
      publishedAt: now,
    };
    await expect(repository.publishQuiz(publication, null, 0)).rejects.toBeInstanceOf(
      QuizDraftRevisionConflictError,
    );
    const version = await repository.publishQuiz(publication, null, 1);
    expect(version.sourceDraftRevision).toBe(1);
    await expect(repository.getQuiz(owner.workspaceId, quizId)).resolves.toMatchObject({
      currentVersionId: version.id,
      draftRevision: 1,
      publishedDraftRevision: 1,
    });

    await repository.updateQuizDraft({
      ...mutation,
      draft: { ...next, title: "Intervening PostgreSQL save" },
      expectedRevision: 1,
      mutationId: randomUUID(),
      editorId: owner.userId,
      draftHash: "intervening-postgres-save",
    });
    await expect(repository.updateQuizDraft(mutation)).resolves.toMatchObject({
      draftRevision: 1,
      draft: { title: "Saved" },
    });
    await expect(repository.getQuiz(owner.workspaceId, quizId)).resolves.toMatchObject({
      draftRevision: 2,
      draft: { title: "Intervening PostgreSQL save" },
    });

    const restoreMutationId = randomUUID();
    const restoreInput = {
      workspaceId: owner.workspaceId,
      quizId,
      historyRevision: 1,
      expectedRevision: 2,
      mutationId: restoreMutationId,
      editorId: owner.userId,
    };
    await repository.restoreQuizDraftHistory(restoreInput);
    await repository.updateQuizDraft({
      ...mutation,
      draft: { ...next, title: "After PostgreSQL restore" },
      expectedRevision: 3,
      mutationId: randomUUID(),
      draftHash: "after-postgres-restore",
    });
    await expect(repository.restoreQuizDraftHistory(restoreInput)).resolves.toMatchObject({
      draftRevision: 3,
      draft: { title: "Saved" },
    });
    await expect(repository.getQuiz(owner.workspaceId, quizId)).resolves.toMatchObject({
      draftRevision: 4,
      draft: { title: "After PostgreSQL restore" },
    });
  });

  it("tracks media usage through database triggers and protects referenced assets", async () => {
    const owner = await creator("media-reference-owner");
    const outsider = await creator("media-reference-outsider");
    const now = new Date();
    const mediaId = randomUUID();
    const orphanId = randomUUID();
    for (const id of [mediaId, orphanId]) {
      await repository.createMediaAsset({
        id,
        workspaceId: owner.workspaceId,
        objectKey: `media/${owner.workspaceId}/${id}.png`,
        mimeType: "image/png",
        sizeBytes: 128,
        scanStatus: "clean",
        altText: "File description",
        createdAt: new Date(now.getTime() - 8 * 86_400_000),
      });
    }
    const quizId = randomUUID();
    const draft = {
      title: "Media reference",
      description: "",
      category: "education",
      experiencePreset: { id: "focus", version: 1 },
      questions: [
        {
          id: randomUUID(),
          type: "single_select",
          prompt: "Which option is supported?",
          purpose: "diagnostic",
          confidence: "optional",
          delivery: "main",
          conceptKeys: ["evidence"],
          linkedRecheckQuestionId: null,
          choices: [
            { id: randomUUID(), label: "A", isCorrect: true },
            { id: randomUUID(), label: "B", isCorrect: false },
          ],
          timeLimitSeconds: 20,
          basePoints: 1_000,
          explanation: "A is supported.",
          mediaId,
          mediaAlt: "Placement description",
        },
      ],
    } satisfies QuizDraft;
    await repository.createQuiz({
      id: quizId,
      workspaceId: owner.workspaceId,
      title: draft.title,
      description: draft.description,
      status: "draft",
      draft,
      currentVersionId: null,
      createdAt: now,
      updatedAt: now,
    });

    await expect(repository.deleteMediaAsset(owner.workspaceId, mediaId)).resolves.toBe(false);
    await expect(repository.listMediaReferences(outsider.workspaceId, mediaId)).resolves.toEqual(
      [],
    );
    const unattached = await repository.listUnattachedMedia(now, 1_000);
    expect(unattached).toEqual(expect.arrayContaining([expect.objectContaining({ id: orphanId })]));
    expect(unattached).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: mediaId })]),
    );
    await expect(repository.listMediaReferences(owner.workspaceId, mediaId)).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ ownerType: "quiz_draft", ownerId: quizId }),
        expect.objectContaining({ ownerType: "quiz_history" }),
      ]),
    );

    const version = await repository.publishQuiz({
      id: randomUUID(),
      workspaceId: owner.workspaceId,
      quizId,
      version: 1,
      content: draft,
      contentHash: randomUUID(),
      publishedAt: now,
    });
    await expect(repository.listMediaReferences(owner.workspaceId, mediaId)).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ ownerType: "quiz_draft", ownerId: quizId }),
        expect.objectContaining({ ownerType: "quiz_version", ownerId: version.id }),
      ]),
    );
    await expect(repository.exportAccount(owner.userId)).resolves.toMatchObject({
      mediaReferences: expect.arrayContaining([
        expect.objectContaining({ media_id: mediaId, owner_type: "quiz_draft" }),
        expect.objectContaining({ media_id: mediaId, owner_type: "quiz_version" }),
      ]),
    });
    await repository.deleteAccount(owner.userId);
    await expect(repository.listMediaReferences(owner.workspaceId)).resolves.toEqual([]);
    await expect(repository.listMediaAssets(owner.workspaceId)).resolves.toEqual([]);
  });

  it("isolates presentation children and serializes idempotent draft mutations", async () => {
    const owner = await creator("presentation-owner");
    const outsider = await creator("presentation-outsider");
    const presentations = new PostgresPresentationRepository(repository);
    const libraryMetadata = new PostgresLibraryMetadataRepository(repository);
    const now = new Date();
    const draft = {
      title: "Secure presentation",
      description: "",
      experiencePreset: { id: "focus", version: 1 },
      schemaVersion: 2,
      blocks: [
        {
          id: randomUUID(),
          kind: "content",
          layout: "title_body",
          textElements: [
            { id: "opening:title", role: "title", text: "Opening", region: "top_center", order: 0 },
            { id: "opening:body", role: "body", text: "", region: "middle_center", order: 0 },
          ],
          mediaId: null,
          mediaAlt: null,
          speakerNotes: "",
        },
      ],
    } satisfies PresentationDraft;
    const presentation = await presentations.createPresentation({
      id: randomUUID(),
      workspaceId: owner.workspaceId,
      title: draft.title,
      description: draft.description,
      status: "draft",
      draft,
      draftRevision: 0,
      draftSchemaVersion: 2,
      currentVersionId: null,
      folderId: null,
      publishedDraftRevision: null,
      lastEditedBy: owner.userId,
      createdAt: now,
      updatedAt: now,
    });
    await expect(
      presentations.getPresentation(outsider.workspaceId, presentation.id),
    ).resolves.toBeNull();

    const folder = await repository.createFolder({
      id: randomUUID(),
      workspaceId: owner.workspaceId,
      name: `Briefings ${randomUUID()}`,
      createdAt: now,
      updatedAt: now,
    });
    await expect(
      presentations.organizePresentation(owner.workspaceId, presentation.id, folder.id),
    ).resolves.toMatchObject({ folderId: folder.id });
    await libraryMetadata.setFavorite({
      workspaceId: owner.workspaceId,
      userId: owner.userId,
      artifactType: "presentation",
      artifactId: presentation.id,
      favorite: true,
      now,
    });
    await expect(
      libraryMetadata.listFavorites(owner.workspaceId, owner.userId),
    ).resolves.toMatchObject([{ artifactId: presentation.id, userId: owner.userId }]);

    const noOpMutation = {
      workspaceId: owner.workspaceId,
      presentationId: presentation.id,
      draft,
      expectedRevision: 0,
      mutationId: randomUUID(),
      editorId: owner.userId,
      draftHash: "unchanged-presentation",
    };
    await expect(presentations.updatePresentationDraft(noOpMutation)).resolves.toMatchObject({
      draftRevision: 0,
    });
    await expect(presentations.updatePresentationDraft(noOpMutation)).resolves.toMatchObject({
      draftRevision: 0,
    });
    await expect(
      presentations.listPresentationHistory(owner.workspaceId, presentation.id, 20),
    ).resolves.toHaveLength(1);

    const mutationId = randomUUID();
    const update = {
      workspaceId: owner.workspaceId,
      presentationId: presentation.id,
      draft: { ...draft, title: "Saved once" },
      expectedRevision: 0,
      mutationId,
      editorId: owner.userId,
      draftHash: "same-request",
    };
    const retried = await Promise.all([
      presentations.updatePresentationDraft(update),
      presentations.updatePresentationDraft(update),
    ]);
    expect(retried).toEqual([
      expect.objectContaining({ draftRevision: 1 }),
      expect.objectContaining({ draftRevision: 1 }),
    ]);
    await expect(
      presentations.updatePresentationDraft({ ...update, draftHash: "different-request" }),
    ).rejects.toBeInstanceOf(PresentationMutationConflictError);

    await presentations.updatePresentationDraft({
      ...update,
      draft: { ...draft, title: "Intervening PostgreSQL presentation save" },
      expectedRevision: 1,
      mutationId: randomUUID(),
      editorId: outsider.userId,
      draftHash: "intervening-presentation-save",
    });
    await expect(presentations.updatePresentationDraft(update)).resolves.toMatchObject({
      draftRevision: 1,
      draft: { title: "Saved once" },
      lastEditedBy: owner.userId,
    });
    await expect(
      presentations.getPresentation(owner.workspaceId, presentation.id),
    ).resolves.toMatchObject({
      draftRevision: 2,
      draft: { title: "Intervening PostgreSQL presentation save" },
    });

    const restoreMutationId = randomUUID();
    const restoreInput = {
      workspaceId: owner.workspaceId,
      presentationId: presentation.id,
      historyRevision: 1,
      expectedRevision: 2,
      mutationId: restoreMutationId,
      editorId: owner.userId,
    };
    await presentations.restorePresentationHistory(restoreInput);
    await presentations.updatePresentationDraft({
      ...update,
      draft: { ...draft, title: "After PostgreSQL presentation restore" },
      expectedRevision: 3,
      mutationId: randomUUID(),
      draftHash: "after-presentation-restore",
    });
    await expect(presentations.restorePresentationHistory(restoreInput)).resolves.toMatchObject({
      draftRevision: 3,
      draft: { title: "Saved once" },
      lastEditedBy: owner.userId,
    });
    await expect(
      presentations.getPresentation(owner.workspaceId, presentation.id),
    ).resolves.toMatchObject({
      draftRevision: 4,
      draft: { title: "After PostgreSQL presentation restore" },
    });

    const crossTenant = await runtimePool.connect();
    try {
      await crossTenant.query("BEGIN");
      await crossTenant.query("SELECT set_config('app.workspace_id', $1, true)", [
        owner.workspaceId,
      ]);
      await crossTenant.query("SELECT set_config('app.user_id', $1, true)", [outsider.userId]);
      const hiddenFavorites = await crossTenant.query(
        "SELECT artifact_id FROM library_favorites WHERE artifact_id = $1",
        [presentation.id],
      );
      expect(hiddenFavorites.rows).toEqual([]);
      await crossTenant.query("SELECT set_config('app.workspace_id', $1, true)", [
        outsider.workspaceId,
      ]);
      await expect(
        crossTenant.query(
          `INSERT INTO presentation_draft_history
             (id, workspace_id, presentation_id, revision, draft, saved_by)
           VALUES ($1,$2,$3,99,$4,$5)`,
          [
            randomUUID(),
            outsider.workspaceId,
            presentation.id,
            JSON.stringify(draft),
            outsider.userId,
          ],
        ),
      ).rejects.toThrow();
    } finally {
      await crossTenant.query("ROLLBACK");
      crossTenant.release();
    }

    const privileges = await runtimePool.query<{
      can_insert: boolean;
      can_update: boolean;
      can_delete: boolean;
    }>(`SELECT
          has_table_privilege(current_user, 'presentation_versions', 'INSERT') AS can_insert,
          has_table_privilege(current_user, 'presentation_versions', 'UPDATE') AS can_update,
          has_table_privilege(current_user, 'presentation_versions', 'DELETE') AS can_delete`);
    expect(privileges.rows[0]).toEqual({
      can_insert: true,
      can_update: false,
      can_delete: false,
    });
  });

  it("permanently deletes archived Library parents with restricted runtime grants and cleans every member's links", async () => {
    const owner = await creator("library-delete-owner");
    const second = await creator("library-delete-second");
    const fixture = await createLibraryDeletionFixture(repository, owner, second.userId);
    expect(await repository.deleteQuiz(second.workspaceId, fixture.round.id)).toBe("not_found");
    expect(
      await fixture.presentations.deletePresentation(second.workspaceId, fixture.presentation.id),
    ).toBe("not_found");
    expect(await repository.deleteQuiz(owner.workspaceId, fixture.round.id)).toBe("not_archived");
    expect(
      await fixture.presentations.deletePresentation(owner.workspaceId, fixture.presentation.id),
    ).toBe("not_archived");
    expect(await repository.listMediaReferences(owner.workspaceId, fixture.mediaId)).toHaveLength(
      8,
    );
    const privileges = await runtimePool.query<{ can_update: boolean; can_delete: boolean }>(
      "SELECT has_table_privilege(current_user, 'presentation_versions', 'UPDATE') AS can_update, has_table_privilege(current_user, 'presentation_versions', 'DELETE') AS can_delete",
    );
    expect(privileges.rows).toEqual([{ can_update: false, can_delete: false }]);
    await repository.archiveQuiz(owner.workspaceId, fixture.round.id, true);
    await fixture.presentations.archivePresentation(
      owner.workspaceId,
      fixture.presentation.id,
      true,
    );
    expect(await repository.deleteQuiz(owner.workspaceId, fixture.round.id)).toBe("deleted");
    expect(
      await fixture.presentations.getPresentation(owner.workspaceId, fixture.presentation.id),
    ).not.toBeNull();
    expect(await fixture.favorites.listFavorites(owner.workspaceId, second.userId)).toMatchObject([
      { artifactId: fixture.presentation.id },
    ]);
    expect(
      await fixture.presentations.deletePresentation(owner.workspaceId, fixture.presentation.id),
    ).toBe("deleted");
    expect(await repository.getQuizVersion(owner.workspaceId, fixture.roundVersion.id)).toBeNull();
    expect(
      await fixture.presentations.getPresentationVersion(
        owner.workspaceId,
        fixture.presentationVersion.id,
      ),
    ).toBeNull();
    for (const userId of [owner.userId, second.userId])
      expect(await fixture.favorites.listFavorites(owner.workspaceId, userId)).toEqual([]);
    expect(await fixture.groups.listArtifacts(fixture.group.id)).toEqual([]);
    expect(await fixture.groups.listSchedule(fixture.group.id)).toEqual([]);
    expect(await repository.listMediaReferences(owner.workspaceId)).toEqual([]);
    expect(await repository.getMediaAsset(owner.workspaceId, fixture.mediaId)).not.toBeNull();
    expect(
      await fixture.favorites.setFavorite({
        workspaceId: owner.workspaceId,
        userId: owner.userId,
        artifactType: "round",
        artifactId: fixture.round.id,
        favorite: true,
        now: fixture.now,
      }),
    ).toBeNull();
    const inspector = await runtimePool.connect();
    try {
      await inspector.query("BEGIN");
      await inspector.query("SELECT set_config('app.workspace_id', $1, true)", [owner.workspaceId]);
      for (const table of [
        "quiz_draft_mutations",
        "quiz_draft_history",
        "presentation_draft_mutations",
        "presentation_draft_history",
      ]) {
        const remaining = await inspector.query<{ count: number }>(
          `SELECT count(*)::integer AS count FROM ${table} WHERE workspace_id = $1`,
          [owner.workspaceId],
        );
        expect(remaining.rows[0]?.count, table).toBe(0);
      }
      expect(
        (
          await inspector.query(
            "SELECT current_setting('app.system_access', true) AS system_access",
          )
        ).rows[0]?.system_access,
      ).not.toBe("on");
      await inspector.query("ROLLBACK");
    } finally {
      inspector.release();
    }
  });

  it("preserves retained Library dependents and still cascades assignments during account deletion", async () => {
    const owner = await creator("library-delete-dependents");
    const fixture = await createLibraryDeletionFixture(repository, owner, owner.userId);
    const roundSession = await createRoundSessionFixture(
      owner,
      { content: fixture.content, version: fixture.roundVersion },
      "8529641",
    );
    const presentationSessions = new PostgresPresentationSessionRepository(repository);
    const presentationSession = await presentationSessions.createSession({
      id: randomUUID(),
      workspaceId: owner.workspaceId,
      presentationId: fixture.presentation.id,
      presentationVersionId: fixture.presentationVersion.id,
      title: fixture.presentationContent.title,
      content: fixture.presentationContent,
      code: "8529642",
      status: "finished",
      phase: "finished",
      currentBlockIndex: 0,
      revision: 0,
      createdBy: owner.userId,
      createdAt: fixture.now,
      updatedAt: fixture.now,
      finishedAt: fixture.now,
      liveExpiresAt: new Date(fixture.now.getTime() - 1),
      retentionExpiresAt: new Date(fixture.now.getTime() + 86_400_000),
    });
    const assignment = {
      id: randomUUID(),
      workspaceId: owner.workspaceId,
      purpose: "assignment" as const,
      sourceQuizVersionId: fixture.roundVersion.id,
      sourceSessionId: null,
      sourceReportId: null,
      title: "Closed retained assignment",
      content: fixture.content,
      conceptKeys: [],
      timeMode: "flex" as const,
      genericTokenHash: randomUUID(),
      opensAt: fixture.now,
      closesAt: new Date(fixture.now.getTime() + 60_000),
      expiresAt: new Date(fixture.now.getTime() + 86_400_000),
      closedAt: fixture.now,
      createdBy: owner.userId,
      createdAt: fixture.now,
    };
    expect(await repository.createPracticeAssignment(fixture.round.id, assignment, [])).toBe(true);
    await repository.archiveQuiz(owner.workspaceId, fixture.round.id, true);
    await fixture.presentations.archivePresentation(
      owner.workspaceId,
      fixture.presentation.id,
      true,
    );
    expect(await repository.deleteQuiz(owner.workspaceId, fixture.round.id)).toBe("in_use");
    expect(
      await fixture.presentations.deletePresentation(owner.workspaceId, fixture.presentation.id),
    ).toBe("in_use");
    expect(await repository.getSessionById(roundSession.id)).not.toBeNull();
    expect(await presentationSessions.getSessionById(presentationSession.id)).not.toBeNull();
    expect(await repository.deleteSession(owner.workspaceId, roundSession.id)).toBe(true);
    expect(await repository.deleteQuiz(owner.workspaceId, fixture.round.id)).toBe("in_use");
    expect(await repository.getFollowup(owner.workspaceId, assignment.id)).toMatchObject({
      closedAt: fixture.now,
    });
    // The FK also protects assignments if a writer commits after the repository's reference check.
    const directDelete = await runtimePool.connect();
    try {
      await directDelete.query("BEGIN");
      await directDelete.query("SELECT set_config('app.workspace_id', $1, true)", [
        owner.workspaceId,
      ]);
      await expect(
        directDelete.query("DELETE FROM quizzes WHERE id = $1", [fixture.round.id]),
      ).rejects.toMatchObject({ code: "23503" });
      await directDelete.query("ROLLBACK");
    } finally {
      directDelete.release();
    }
    expect(await repository.getFollowup(owner.workspaceId, assignment.id)).not.toBeNull();
    expect(
      await presentationSessions.deleteSession(
        owner.workspaceId,
        presentationSession.id,
        fixture.now,
      ),
    ).toEqual({ status: "deleted" });
    expect(
      await fixture.presentations.deletePresentation(owner.workspaceId, fixture.presentation.id),
    ).toBe("deleted");
    await expect(repository.deleteAccount(owner.userId)).resolves.toBeUndefined();
    expect(await repository.getFollowup(owner.workspaceId, assignment.id)).toBeNull();
    expect(await repository.getQuizVersion(owner.workspaceId, fixture.roundVersion.id)).toBeNull();
  });

  it("creates a Presentation room and initial credential atomically", async () => {
    const owner = await creator("presentation-atomic-credential");
    const published = await createPublishedPresentationFixture(owner, "Atomic Presentation");
    const sessions = new PostgresPresentationSessionRepository(repository);
    const now = new Date();
    const sessionInput = (id: string, code: string) => ({
      id,
      workspaceId: owner.workspaceId,
      presentationId: published.presentation.id,
      presentationVersionId: published.version.id,
      title: published.content.title,
      content: published.content,
      code,
      status: "active" as const,
      phase: "lobby" as const,
      currentBlockIndex: -1,
      revision: 0,
      createdBy: owner.userId,
      createdAt: now,
      updatedAt: now,
      finishedAt: null,
      liveExpiresAt: new Date(now.getTime() + 60_000),
      retentionExpiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60_000),
    });
    const sharedTokenHash = "d".repeat(64);
    const firstId = randomUUID();
    await expect(
      sessions.createSessionWithCredential(
        sessionInput(firstId, String(randomInt(1_000_000, 10_000_000))),
        {
          id: randomUUID(),
          workspaceId: owner.workspaceId,
          sessionId: firstId,
          role: "host",
          tokenHash: sharedTokenHash,
          createdAt: now,
          expiresAt: new Date(now.getTime() + 60_000),
          revokedAt: null,
        },
      ),
    ).resolves.toMatchObject({
      session: { id: firstId },
      credential: { sessionId: firstId, role: "host" },
    });

    const failedId = randomUUID();
    const reusableCode = String(randomInt(1_000_000, 10_000_000));
    await expect(
      sessions.createSessionWithCredential(sessionInput(failedId, reusableCode), {
        id: randomUUID(),
        workspaceId: owner.workspaceId,
        sessionId: failedId,
        role: "host",
        tokenHash: sharedTokenHash,
        createdAt: now,
        expiresAt: new Date(now.getTime() + 60_000),
        revokedAt: null,
      }),
    ).rejects.toThrow();
    await expect(sessions.getSessionById(failedId)).resolves.toBeNull();
    await expect(repository.getLiveRoomCode(reusableCode)).resolves.toBeNull();
    await expect(
      sessions.createSession(sessionInput(failedId, reusableCode)),
    ).resolves.toMatchObject({ id: failedId });
  });

  it("serializes concurrent Presentation credential rotations", async () => {
    const owner = await creator("presentation-concurrent-credential-rotation");
    const published = await createPublishedPresentationFixture(
      owner,
      "Concurrent credential rotation",
    );
    const { session, sessions } = await createPresentationSessionFixture(
      owner,
      published,
      String(randomInt(1_000_000, 10_000_000)),
    );
    const now = new Date();
    const original = await sessions.createCredential({
      id: randomUUID(),
      workspaceId: owner.workspaceId,
      sessionId: session.id,
      role: "host",
      tokenHash: createHash("sha256").update(randomUUID()).digest("hex"),
      createdAt: now,
      expiresAt: new Date(now.getTime() + 60_000),
      revokedAt: null,
    });
    const rotationAt = new Date(now.getTime() + 1);
    const rotationInputs = ["first", "second"].map(
      (label): PresentationSessionCredentialRecord => ({
        id: randomUUID(),
        workspaceId: owner.workspaceId,
        sessionId: session.id,
        role: "host",
        tokenHash: createHash("sha256").update(`${label}-${randomUUID()}`).digest("hex"),
        createdAt: rotationAt,
        expiresAt: new Date(rotationAt.getTime() + 60_000),
        revokedAt: null,
      }),
    );

    const blocker = await runtimePool.connect();
    let pendingRotations: Promise<PresentationSessionCredentialRecord[]> | undefined;
    try {
      await blocker.query("BEGIN");
      await blocker.query("SELECT set_config('app.workspace_id', $1, true)", [owner.workspaceId]);
      await blocker.query(
        `SELECT id FROM presentation_live_sessions
         WHERE workspace_id = $1 AND id = $2
         FOR UPDATE`,
        [owner.workspaceId, session.id],
      );

      pendingRotations = Promise.all(
        rotationInputs.map((input) => sessions.rotateCredential(input)),
      );
      const waitDeadline = Date.now() + 5_000;
      let waitingRotations = 0;
      while (Date.now() < waitDeadline) {
        const waiting = await runtimePool.query<{ count: string }>(
          `SELECT count(*)::text AS count
           FROM pg_stat_activity
           WHERE datname = current_database()
             AND state = 'active'
             AND wait_event_type = 'Lock'
             AND query LIKE $1`,
          ["%rotate_presentation_session_credential%"],
        );
        waitingRotations = Number(waiting.rows[0]?.count ?? 0);
        if (waitingRotations >= rotationInputs.length) break;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(waitingRotations).toBe(rotationInputs.length);

      await blocker.query("COMMIT");
      const rotated = await pendingRotations;
      pendingRotations = undefined;
      const validAt = new Date(rotationAt.getTime() + 1);
      const activeRotations = await Promise.all(
        rotated.map((credential) =>
          sessions.findValidCredential(session.id, credential.tokenHash, "host", validAt),
        ),
      );
      expect(activeRotations.filter((credential) => credential !== null)).toHaveLength(1);
      await expect(
        sessions.findValidCredential(session.id, original.tokenHash, "host", validAt),
      ).resolves.toBeNull();
    } finally {
      await blocker.query("ROLLBACK").catch(() => undefined);
      blocker.release();
      await pendingRotations?.catch(() => undefined);
    }
  });

  it("keeps Presentation fences monotonic for legacy writers and aggregate inserts", async () => {
    const owner = await creator("presentation-legacy-compat");
    const presentations = new PostgresPresentationRepository(repository);
    const sessions = new PostgresPresentationSessionRepository(repository);
    const now = new Date();
    const questionBlockId = randomUUID();
    const questionId = randomUUID();
    const draft = {
      title: "Legacy realtime compatibility",
      description: "Migration compatibility coverage",
      experiencePreset: { id: "focus", version: 1 },
      schemaVersion: 2,
      blocks: [
        {
          id: questionBlockId,
          kind: "question",
          question: {
            id: questionId,
            type: "numeric",
            prompt: "How many durable mutations occurred?",
            correctValue: "3",
            tolerance: "0",
            unit: null,
            timeLimitSeconds: 30,
            basePoints: 1_000,
            explanation: "The sequence includes join, command, and response.",
            mediaId: null,
            mediaAlt: null,
          },
        },
      ],
    } satisfies PresentationDraft;
    const presentation = await presentations.createPresentation({
      id: randomUUID(),
      workspaceId: owner.workspaceId,
      title: draft.title,
      description: draft.description,
      status: "draft",
      draft,
      draftRevision: 0,
      draftSchemaVersion: 2,
      currentVersionId: null,
      folderId: null,
      publishedDraftRevision: null,
      lastEditedBy: owner.userId,
      createdAt: now,
      updatedAt: now,
    });
    const version = await presentations.publishPresentation(
      {
        id: randomUUID(),
        workspaceId: owner.workspaceId,
        presentationId: presentation.id,
        version: 1,
        content: draft,
        contentHash: randomUUID(),
        sourceDraftRevision: 0,
        publishedAt: now,
      },
      0,
    );
    const session = await sessions.createSession({
      id: randomUUID(),
      workspaceId: owner.workspaceId,
      presentationId: presentation.id,
      presentationVersionId: version.id,
      title: draft.title,
      content: draft,
      code: String(randomInt(1_000_000, 10_000_000)),
      status: "active",
      phase: "lobby",
      currentBlockIndex: -1,
      revision: 0,
      settings: { timeMode: "timed" },
      trustMode: "learning",
      eventSeq: 0,
      questionOpenedAt: null,
      questionClosesAt: null,
      createdBy: owner.userId,
      createdAt: now,
      updatedAt: now,
      finishedAt: null,
      liveExpiresAt: new Date(now.getTime() + 60_000),
      retentionExpiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60_000),
    });

    for (const invalidSettings of [{}, { timeMode: null }]) {
      const invalidClient = await runtimePool.connect();
      try {
        await invalidClient.query("BEGIN");
        await invalidClient.query("SELECT set_config('app.workspace_id', $1, true)", [
          owner.workspaceId,
        ]);
        await expect(
          invalidClient.query(
            `INSERT INTO presentation_live_sessions
               (id, workspace_id, presentation_id, presentation_version_id, title,
                content_snapshot, join_code, status, phase, current_block_index, revision,
                settings, trust_mode, event_seq, created_by, created_at, updated_at,
                live_expires_at, retention_expires_at)
             SELECT $2, workspace_id, presentation_id, presentation_version_id, title,
                    content_snapshot, $3, 'active', 'lobby', -1, 0, $4::jsonb, 'learning', 0,
                    created_by, $5, $5, $6, $7
             FROM presentation_live_sessions
             WHERE workspace_id = $1 AND id = $8`,
            [
              owner.workspaceId,
              randomUUID(),
              String(randomInt(1_000_000, 10_000_000)),
              JSON.stringify(invalidSettings),
              now,
              new Date(now.getTime() + 60_000),
              new Date(now.getTime() + 30 * 24 * 60 * 60_000),
              session.id,
            ],
          ),
        ).rejects.toMatchObject({ code: "23514" });
        await invalidClient.query("ROLLBACK");
      } finally {
        invalidClient.release();
      }
    }

    const participant = await sessions.addParticipant({
      id: randomUUID(),
      workspaceId: owner.workspaceId,
      sessionId: session.id,
      nickname: "Legacy participant",
      tokenHash: createHash("sha256").update(randomUUID()).digest("hex"),
      joinedAt: now,
      lastSeenAt: now,
    });
    await expect(
      sessions.getSessionForWorkspace(owner.workspaceId, session.id),
    ).resolves.toMatchObject({ eventSeq: 1 });

    const openedAt = new Date(now.getTime() + 1_000);
    const legacyClient = await runtimePool.connect();
    try {
      await legacyClient.query("BEGIN");
      await legacyClient.query("SELECT set_config('app.workspace_id', $1, true)", [
        owner.workspaceId,
      ]);
      await legacyClient.query("SAVEPOINT immutable_presentation_code");
      await expect(
        legacyClient.query(
          "UPDATE presentation_live_sessions SET join_code = $3 WHERE workspace_id = $1 AND id = $2",
          [owner.workspaceId, session.id, String(randomInt(1_000_000, 10_000_000))],
        ),
      ).rejects.toMatchObject({ code: "23514" });
      await legacyClient.query("ROLLBACK TO SAVEPOINT immutable_presentation_code");

      const opened = await legacyClient.query<{
        event_seq: string;
        question_opened_at: Date;
        question_closes_at: Date;
      }>(
        `UPDATE presentation_live_sessions
         SET phase = 'question_open', current_block_index = 0, revision = revision + 1,
             updated_at = $3
         WHERE workspace_id = $1 AND id = $2
         RETURNING event_seq, question_opened_at, question_closes_at`,
        [owner.workspaceId, session.id, openedAt],
      );
      expect(opened.rows[0]).toEqual({
        event_seq: "2",
        question_opened_at: openedAt,
        question_closes_at: new Date(openedAt.getTime() + 30_000),
      });
      const launched = await legacyClient.query<{ sequence: string }>(
        `INSERT INTO presentation_session_timeline
           (id, workspace_id, session_id, sequence, event_type, block_index, block_id,
            occurred_at)
         SELECT $1, $2, $3, COALESCE(MAX(sequence), 0) + 1, 'question.launched', 0, $4, $5
         FROM presentation_session_timeline
         WHERE session_id = $3
         RETURNING sequence`,
        [randomUUID(), owner.workspaceId, session.id, questionBlockId, openedAt],
      );
      expect(launched.rows[0]?.sequence).toBe("2");
      await legacyClient.query("COMMIT");
    } catch (error) {
      await legacyClient.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      legacyClient.release();
    }

    const responseIdempotencyKey = randomUUID();
    const responseHash = "a".repeat(64);
    const responseInput = {
      id: randomUUID(),
      workspaceId: owner.workspaceId,
      sessionId: session.id,
      participantId: participant.id,
      blockId: questionBlockId,
      questionId,
      response: { numericValue: "3" },
      correct: true,
      score: 1_000,
      responseMs: 1_000,
      submittedAt: new Date(openedAt.getTime() + 1_000),
      idempotencyKey: responseIdempotencyKey,
      requestHash: responseHash,
    };
    const accepted = await sessions.acceptResponse(responseInput, 1);
    expect(accepted).toMatchObject({
      status: "accepted",
      response: { requestHash: responseHash },
      acknowledgement: {
        session: { phase: "question_open", eventSeq: 3 },
        projection: { participantCount: 1, standing: null },
      },
    });
    await expect(
      sessions.acceptResponse({ ...responseInput, id: randomUUID() }, 1),
    ).resolves.toMatchObject({ status: "duplicate" });
    await expect(
      sessions.acceptResponse(
        { ...responseInput, id: randomUUID(), requestHash: "b".repeat(64) },
        1,
      ),
    ).resolves.toMatchObject({ status: "idempotency_conflict" });
    await expect(
      sessions.getSessionForWorkspace(owner.workspaceId, session.id),
    ).resolves.toMatchObject({ eventSeq: 3 });

    const concurrentParticipant = await sessions.addParticipant({
      id: randomUUID(),
      workspaceId: owner.workspaceId,
      sessionId: session.id,
      nickname: "Concurrent retry",
      tokenHash: createHash("sha256").update(randomUUID()).digest("hex"),
      joinedAt: openedAt,
      lastSeenAt: openedAt,
    });
    const concurrentKey = randomUUID();
    const concurrentHash = "c".repeat(64);
    const firstWriter = await runtimePool.connect();
    try {
      await firstWriter.query("BEGIN");
      await firstWriter.query("SELECT set_config('app.workspace_id', $1, true)", [
        owner.workspaceId,
      ]);
      await firstWriter.query(
        `INSERT INTO presentation_live_responses
          (id, workspace_id, session_id, participant_id, block_id, question_id, response,
           correct, score, response_ms, submitted_at, idempotency_key, request_hash)
         VALUES ($1,$2,$3,$4,$5,$6,$7,true,1000,1000,$8,$9,$10)`,
        [
          randomUUID(),
          owner.workspaceId,
          session.id,
          concurrentParticipant.id,
          questionBlockId,
          questionId,
          JSON.stringify({ numericValue: "3" }),
          new Date(openedAt.getTime() + 1_000),
          concurrentKey,
          concurrentHash,
        ],
      );

      let retrySettled = false;
      const retry = sessions
        .acceptResponse(
          {
            ...responseInput,
            id: randomUUID(),
            participantId: concurrentParticipant.id,
            idempotencyKey: concurrentKey,
            requestHash: concurrentHash,
          },
          999,
        )
        .finally(() => {
          retrySettled = true;
        });
      await new Promise((resolve) => setTimeout(resolve, 25));
      expect(retrySettled).toBe(false);

      await firstWriter.query("COMMIT");
      await expect(retry).resolves.toMatchObject({ status: "duplicate" });
      await expect(
        sessions.acceptResponse(
          {
            ...responseInput,
            id: randomUUID(),
            participantId: concurrentParticipant.id,
            idempotencyKey: concurrentKey,
            requestHash: "d".repeat(64),
          },
          999,
        ),
      ).resolves.toMatchObject({ status: "idempotency_conflict" });
    } catch (error) {
      await firstWriter.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      firstWriter.release();
    }
    await expect(
      sessions.getSessionForWorkspace(owner.workspaceId, session.id),
    ).resolves.toMatchObject({ eventSeq: 5 });

    const revealedAt = new Date(openedAt.getTime() + 2_000);
    const revealClient = await runtimePool.connect();
    try {
      await revealClient.query("BEGIN");
      await revealClient.query("SELECT set_config('app.workspace_id', $1, true)", [
        owner.workspaceId,
      ]);
      const revealed = await revealClient.query<{
        event_seq: string;
        question_opened_at: Date | null;
        question_closes_at: Date | null;
      }>(
        `UPDATE presentation_live_sessions
         SET phase = 'question_reveal', revision = revision + 1, updated_at = $3
         WHERE workspace_id = $1 AND id = $2
         RETURNING event_seq, question_opened_at, question_closes_at`,
        [owner.workspaceId, session.id, revealedAt],
      );
      expect(revealed.rows[0]).toEqual({
        event_seq: "6",
        question_opened_at: null,
        question_closes_at: null,
      });
      const revealedEvent = await revealClient.query<{ sequence: string }>(
        `INSERT INTO presentation_session_timeline
           (id, workspace_id, session_id, sequence, event_type, block_index, block_id,
            occurred_at)
         SELECT $1, $2, $3, COALESCE(MAX(sequence), 0) + 1, 'question.revealed', 0, $4, $5
         FROM presentation_session_timeline
         WHERE session_id = $3
         RETURNING sequence`,
        [randomUUID(), owner.workspaceId, session.id, questionBlockId, revealedAt],
      );
      expect(revealedEvent.rows[0]?.sequence).toBe("6");
      await revealClient.query("COMMIT");
    } catch (error) {
      await revealClient.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      revealClient.release();
    }

    await expect(
      sessions.acceptResponse({ ...responseInput, id: randomUUID() }, 1),
    ).resolves.toMatchObject({
      status: "duplicate",
      acknowledgement: {
        session: { phase: "question_reveal", eventSeq: 6 },
        projection: { participantCount: 2, standing: { rank: 1, score: 1_000 } },
      },
    });

    await expect(sessions.listTimeline(session.id)).resolves.toEqual([
      expect.objectContaining({ sequence: 2, type: "question.launched" }),
      expect.objectContaining({ sequence: 6, type: "question.revealed" }),
    ]);
  });

  it("exports and cascade-deletes Presentation sessions and collaboration groups", async () => {
    const owner = await creator("new-lifecycle-owner");
    const presentations = new PostgresPresentationRepository(repository);
    const presentationSessions = new PostgresPresentationSessionRepository(repository);
    const groups = new PostgresCollaborationGroupRepository(repository);
    const now = new Date();
    const blockId = randomUUID();
    const draft = {
      title: "Portable briefing",
      description: "Lifecycle coverage",
      experiencePreset: { id: "focus", version: 1 },
      schemaVersion: 2,
      blocks: [
        {
          id: blockId,
          kind: "content",
          layout: "title_body",
          textElements: [
            {
              id: `${blockId}:title`,
              role: "title",
              text: "Opening",
              region: "top_center",
              order: 0,
            },
            {
              id: `${blockId}:body`,
              role: "body",
              text: "Review together.",
              region: "middle_center",
              order: 0,
            },
          ],
          mediaId: null,
          mediaAlt: null,
          speakerNotes: "Private facilitator note",
        },
        {
          id: randomUUID(),
          kind: "question",
          question: {
            id: randomUUID(),
            type: "numeric",
            prompt: "How many evidence sources were reviewed?",
            correctValue: "1",
            tolerance: "0",
            unit: null,
            timeLimitSeconds: 30,
            basePoints: 1_000,
            explanation: "One source was reviewed.",
            mediaId: null,
            mediaAlt: null,
          },
        },
      ],
    } satisfies PresentationDraft;
    const presentation = await presentations.createPresentation({
      id: randomUUID(),
      workspaceId: owner.workspaceId,
      title: draft.title,
      description: draft.description,
      status: "draft",
      draft,
      draftRevision: 0,
      draftSchemaVersion: 2,
      currentVersionId: null,
      folderId: null,
      publishedDraftRevision: null,
      lastEditedBy: owner.userId,
      createdAt: now,
      updatedAt: now,
    });
    const version = await presentations.publishPresentation(
      {
        id: randomUUID(),
        workspaceId: owner.workspaceId,
        presentationId: presentation.id,
        version: 1,
        content: draft,
        contentHash: randomUUID(),
        sourceDraftRevision: 0,
        publishedAt: now,
      },
      0,
    );
    const session = await presentationSessions.createSession({
      id: randomUUID(),
      workspaceId: owner.workspaceId,
      presentationId: presentation.id,
      presentationVersionId: version.id,
      title: draft.title,
      content: draft,
      code: String(randomInt(0, 10_000_000)).padStart(7, "0"),
      status: "active",
      phase: "lobby",
      currentBlockIndex: -1,
      revision: 0,
      recoveryPackCardsEnabled: true,
      createdBy: owner.userId,
      createdAt: now,
      updatedAt: now,
      finishedAt: null,
      liveExpiresAt: new Date(now.getTime() + 24 * 60 * 60_000),
      retentionExpiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60_000),
    });
    const participant = await presentationSessions.addParticipant({
      id: randomUUID(),
      workspaceId: owner.workspaceId,
      sessionId: session.id,
      nickname: "River",
      tokenHash: createHash("sha256").update(randomUUID()).digest("hex"),
      joinedAt: now,
      lastSeenAt: now,
    });
    const companionCredential = await presentationSessions.createCredential({
      id: randomUUID(),
      workspaceId: owner.workspaceId,
      sessionId: session.id,
      role: "companion",
      tokenHash: createHash("sha256").update("postgres-companion-token").digest("hex"),
      createdAt: now,
      expiresAt: new Date(now.getTime() + 60_000),
      revokedAt: null,
    });
    await expect(
      presentationSessions.findValidCredential(
        session.id,
        companionCredential.tokenHash,
        "companion",
        now,
      ),
    ).resolves.toMatchObject({ id: companionCredential.id });
    const commandId = randomUUID();
    await expect(
      presentationSessions.transitionSessionCommand({
        workspaceId: owner.workspaceId,
        sessionId: session.id,
        commandId,
        expectedRevision: 0,
        phase: "content",
        currentBlockIndex: 0,
        status: "active",
        occurredAt: new Date(now.getTime() + 1),
        event: { type: "content.presented", blockIndex: 0, blockId },
      }),
    ).resolves.toMatchObject({ status: "accepted", session: { eventSeq: 2, revision: 1 } });
    await expect(
      presentationSessions.transitionSessionCommand({
        workspaceId: owner.workspaceId,
        sessionId: session.id,
        commandId,
        expectedRevision: 0,
        phase: "content",
        currentBlockIndex: 0,
        status: "active",
        event: { type: "content.presented", blockIndex: 0, blockId },
      }),
    ).resolves.toMatchObject({ status: "duplicate", session: { eventSeq: 2, revision: 1 } });
    await expect(
      presentationSessions.transitionSessionCommand({
        workspaceId: owner.workspaceId,
        sessionId: session.id,
        commandId,
        expectedRevision: 1,
        phase: "question_open",
        currentBlockIndex: 1,
        status: "active",
        event: { type: "question.launched", blockIndex: 1, blockId: draft.blocks[1]!.id },
      }),
    ).resolves.toMatchObject({ status: "idempotency_conflict", session: { revision: 1 } });

    const recoveryPackIntervention = presentationRecoveryPackIntervention();
    const cardCommandId = randomUUID();
    await presentationSessions.transitionSessionCommand({
      workspaceId: owner.workspaceId,
      sessionId: session.id,
      commandId: cardCommandId,
      expectedRevision: 1,
      requestHash: "a".repeat(64),
      phase: "intervention",
      currentBlockIndex: 1,
      status: "active",
      recoveryPackIntervention,
      event: { type: "intervention.presented", blockIndex: 1, blockId: draft.blocks[1]!.id },
    });

    const firstHostCredential = await presentationSessions.createCredential({
      id: randomUUID(),
      workspaceId: owner.workspaceId,
      sessionId: session.id,
      role: "host",
      tokenHash: createHash("sha256").update("first-host-pass").digest("hex"),
      createdAt: now,
      expiresAt: new Date(now.getTime() + 60_000),
      revokedAt: null,
    });
    const rotatedHostCredential = await presentationSessions.rotateCredential({
      id: randomUUID(),
      workspaceId: owner.workspaceId,
      sessionId: session.id,
      role: "host",
      tokenHash: createHash("sha256").update("rotated-host-pass").digest("hex"),
      createdAt: new Date(now.getTime() + 1),
      expiresAt: new Date(now.getTime() + 60_000),
      revokedAt: null,
    });
    await expect(
      presentationSessions.findValidCredential(
        session.id,
        firstHostCredential.tokenHash,
        "host",
        new Date(now.getTime() + 2),
      ),
    ).resolves.toBeNull();
    await expect(
      presentationSessions.findValidCredential(
        session.id,
        rotatedHostCredential.tokenHash,
        "host",
        new Date(now.getTime() + 2),
      ),
    ).resolves.toMatchObject({ id: rotatedHostCredential.id });
    await presentationSessions.revokeCredential(
      owner.workspaceId,
      session.id,
      companionCredential.id,
      new Date(now.getTime() + 2),
    );
    await expect(
      presentationSessions.findValidCredential(
        session.id,
        companionCredential.tokenHash,
        "companion",
        new Date(now.getTime() + 3),
      ),
    ).resolves.toBeNull();
    const questionBlock = draft.blocks[1];
    if (!questionBlock || questionBlock.kind !== "question") {
      throw new Error("Expected the account export fixture to include a question block");
    }
    await presentationSessions.saveResponse({
      id: randomUUID(),
      workspaceId: owner.workspaceId,
      sessionId: session.id,
      participantId: participant.id,
      blockId: questionBlock.id,
      questionId: questionBlock.question.id,
      response: { numericValue: "1" },
      correct: true,
      score: 875,
      responseMs: 2_500,
      submittedAt: now,
    });
    const exportedEventSequenceOffset = 5;
    const sequenceClient = await runtimePool.connect();
    try {
      await sequenceClient.query("BEGIN");
      await sequenceClient.query("SELECT set_config('app.workspace_id', $1, true)", [
        owner.workspaceId,
      ]);
      await sequenceClient.query(
        `UPDATE presentation_live_sessions
            SET event_seq_offset = $3,
                event_seq = event_seq + $3
          WHERE workspace_id = $1 AND id = $2`,
        [owner.workspaceId, session.id, exportedEventSequenceOffset],
      );
      await sequenceClient.query("COMMIT");
    } catch (error) {
      await sequenceClient.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      sequenceClient.release();
    }
    const groupId = randomUUID();
    const group = await groups.createGroup(
      {
        id: groupId,
        workspaceId: owner.workspaceId,
        name: "Facilitators",
        description: "Review group",
        createdBy: owner.userId,
        createdAt: now,
        updatedAt: now,
      },
      {
        workspaceId: owner.workspaceId,
        groupId,
        userId: owner.userId,
        role: "owner",
        joinedAt: now,
      },
    );
    await groups.addMessage({
      id: randomUUID(),
      workspaceId: owner.workspaceId,
      groupId: group.id,
      authorId: owner.userId,
      body: "Review before hosting.",
      createdAt: now,
    });

    const exported = await repository.exportAccount(owner.userId);
    expect(exported).toMatchObject({
      presentations: [{ id: presentation.id }],
      presentationVersions: [{ id: version.id }],
      presentationSessions: [
        {
          id: session.id,
          event_seq_offset: String(exportedEventSequenceOffset),
          recovery_pack_cards_enabled: true,
          recovery_pack_intervention: recoveryPackIntervention,
        },
      ],
      presentationSessionParticipants: [{ id: participant.id, nickname: "River" }],
      presentationSessionResponses: [expect.objectContaining({ score: 875, response_ms: 2_500 })],
      collaborationGroups: [{ id: group.id }],
      collaborationGroupMessages: [{ body: "Review before hosting." }],
    });
    expect(exported.presentationSessionTimeline).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event_type: "intervention.presented",
          recovery_pack_intervention: recoveryPackIntervention,
        }),
      ]),
    );
    expect(exported.presentationSessionCommandReceipts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ command_id: cardCommandId, request_hash: "a".repeat(64) }),
      ]),
    );
    expect(exported.presentationSessionParticipants).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ token_hash: expect.anything() })]),
    );

    await repository.updateUserLocale(owner.userId, "ko-KR");
    await repository.deleteAccount(owner.userId);
    const system = await runtimePool.connect();
    try {
      await system.query("BEGIN");
      await system.query("SELECT set_config('app.system_access', 'on', true)");
      for (const table of [
        "presentations",
        "presentation_versions",
        "presentation_live_sessions",
        "presentation_live_participants",
        "presentation_live_responses",
        "presentation_session_timeline",
        "presentation_session_command_receipts",
        "presentation_session_credentials",
        "presentation_session_reports",
        "collaboration_groups",
        "collaboration_group_members",
        "collaboration_group_messages",
      ]) {
        const result = await system.query<{ count: string }>(
          `SELECT count(*) FROM ${table} WHERE workspace_id = $1`,
          [owner.workspaceId],
        );
        expect(result.rows[0]?.count, table).toBe("0");
      }
      const deletedProfile = await system.query<{
        locale: string;
        locale_explicit: boolean;
      }>("SELECT locale, locale_explicit FROM users WHERE id = $1", [owner.userId]);
      expect(deletedProfile.rows[0]).toEqual({ locale: "en-CA", locale_explicit: false });
      await system.query("ROLLBACK");
    } finally {
      system.release();
    }
  });

  it("transfers Group ownership before deleting a collaborator account", async () => {
    const workspaceOwner = await creator("group-workspace-owner");
    const departingOwner = await creator("group-departing-owner");
    const groups = new PostgresCollaborationGroupRepository(repository);
    const now = new Date();
    const membershipClient = await runtimePool.connect();
    try {
      await membershipClient.query("BEGIN");
      await membershipClient.query("SELECT set_config('app.system_access', 'on', true)");
      await membershipClient.query(
        `INSERT INTO workspace_members (workspace_id, user_id, role)
         VALUES ($1,$2,'editor')`,
        [workspaceOwner.workspaceId, departingOwner.userId],
      );
      await membershipClient.query("COMMIT");
    } catch (error) {
      await membershipClient.query("ROLLBACK");
      throw error;
    } finally {
      membershipClient.release();
    }

    const retainedGroupId = randomUUID();
    await groups.createGroup(
      {
        id: retainedGroupId,
        workspaceId: workspaceOwner.workspaceId,
        name: "Retained facilitators",
        description: "Has a successor",
        createdBy: departingOwner.userId,
        createdAt: now,
        updatedAt: now,
      },
      {
        workspaceId: workspaceOwner.workspaceId,
        groupId: retainedGroupId,
        userId: departingOwner.userId,
        role: "owner",
        joinedAt: now,
      },
    );
    await groups.addMember({
      workspaceId: workspaceOwner.workspaceId,
      groupId: retainedGroupId,
      userId: workspaceOwner.userId,
      role: "member",
      joinedAt: new Date(now.getTime() + 1),
    });

    const emptyGroupId = randomUUID();
    await groups.createGroup(
      {
        id: emptyGroupId,
        workspaceId: workspaceOwner.workspaceId,
        name: "Deleted facilitators",
        description: "No successor",
        createdBy: departingOwner.userId,
        createdAt: now,
        updatedAt: now,
      },
      {
        workspaceId: workspaceOwner.workspaceId,
        groupId: emptyGroupId,
        userId: departingOwner.userId,
        role: "owner",
        joinedAt: now,
      },
    );

    await repository.deleteAccount(departingOwner.userId);

    await expect(groups.listMembers(retainedGroupId)).resolves.toEqual([
      expect.objectContaining({ userId: workspaceOwner.userId, role: "owner" }),
    ]);
    await expect(
      groups.listGroups(workspaceOwner.workspaceId, workspaceOwner.userId),
    ).resolves.toEqual([expect.objectContaining({ id: retainedGroupId })]);
    await expect(groups.getGroup(workspaceOwner.workspaceId, emptyGroupId)).resolves.toBeNull();
  });

  it("paginates histories without losing PostgreSQL microsecond precision", async () => {
    const owner = await creator("report-cursor");
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 24 * 60 * 60_000);
    const content = publishableRound("Cursor precision");
    const quizId = randomUUID();
    await repository.createQuiz({
      id: quizId,
      workspaceId: owner.workspaceId,
      title: content.title,
      description: content.description,
      status: "draft",
      draft: content,
      currentVersionId: null,
      createdAt: now,
      updatedAt: now,
    });
    const version = await repository.publishQuiz({
      id: randomUUID(),
      workspaceId: owner.workspaceId,
      quizId,
      version: 1,
      content,
      contentHash: randomUUID(),
      publishedAt: now,
    });
    const sessionIds: string[] = [];
    const reportIds: string[] = [];
    for (let index = 0; index < 2; index += 1) {
      const sessionId = randomUUID();
      sessionIds.push(sessionId);
      await repository.createSession({
        id: sessionId,
        workspaceId: owner.workspaceId,
        quizVersionId: version.id,
        hostId: owner.userId,
        hostTokenHash: randomUUID(),
        state: createGameState({
          sessionId,
          code: randomInt(1_000_000, 10_000_000).toString(),
          quiz: content,
          settings: {
            audienceLimit: 20,
            scoringMode: "accuracy",
            resultVisibility: "private",
            allowLateJoin: true,
            nicknamePolicy: "friendly_only",
          },
        }),
        expiresAt,
        retentionExpiresAt: expiresAt,
        createdAt: now,
        updatedAt: now,
      });
      const reportId = randomUUID();
      reportIds.push(reportId);
      await repository.saveReport(owner.workspaceId, {
        id: reportId,
        sessionId,
        status: "ready",
        generatedAt: now.toISOString(),
        expiresAt: expiresAt.toISOString(),
        metrics: {
          participantCount: 0,
          completedCount: 0,
          answerCount: 0,
          accuracyPercent: 0,
        },
        questions: [],
        participants: [],
      });
    }

    const client = await runtimePool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.workspace_id', $1, true)", [owner.workspaceId]);
      await client.query(
        `UPDATE reports
         SET created_at = CASE id
           WHEN $1::uuid THEN '2026-09-18T12:00:00.000900Z'::timestamptz
           WHEN $2::uuid THEN '2026-09-18T12:00:00.000100Z'::timestamptz
         END
         WHERE id = ANY($3::uuid[])`,
        [reportIds[0], reportIds[1], reportIds],
      );
      await client.query(
        `UPDATE game_sessions
         SET created_at = CASE id
           WHEN $1::uuid THEN '2026-09-18T12:00:00.000900Z'::timestamptz
           WHEN $2::uuid THEN '2026-09-18T12:00:00.000100Z'::timestamptz
         END
         WHERE id = ANY($3::uuid[])`,
        [sessionIds[0], sessionIds[1], sessionIds],
      );
      await client.query("COMMIT");
    } finally {
      client.release();
    }

    const firstPage = await repository.listReportHistory(owner.workspaceId, {
      limit: 1,
      now,
    });
    expect(firstPage).toMatchObject({
      hasMore: true,
      items: [{ id: reportIds[0], cursorCreatedAt: "2026-09-18T12:00:00.000900Z" }],
    });
    const firstItem = firstPage.items[0]!;
    const secondPage = await repository.listReportHistory(owner.workspaceId, {
      limit: 1,
      cursor: {
        createdAt: firstItem.createdAt,
        cursorCreatedAt: firstItem.cursorCreatedAt,
        id: firstItem.id,
      },
      now,
    });
    expect(secondPage.items.map(({ id }) => id)).toEqual([reportIds[1]]);

    const firstSessionPage = await repository.listSessionHistory(owner.workspaceId, {
      limit: 1,
      now,
    });
    expect(firstSessionPage).toMatchObject({
      hasMore: true,
      items: [{ id: sessionIds[0], cursorCreatedAt: "2026-09-18T12:00:00.000900Z" }],
    });
    const firstSession = firstSessionPage.items[0]!;
    const secondSessionPage = await repository.listSessionHistory(owner.workspaceId, {
      limit: 1,
      cursor: {
        createdAt: firstSession.createdAt,
        cursorCreatedAt: firstSession.cursorCreatedAt,
        id: firstSession.id,
      },
      now,
    });
    expect(secondSessionPage.items.map(({ id }) => id)).toEqual([sessionIds[1]]);

    const followupIds = [randomUUID(), randomUUID()];
    const exactFollowupCreatedAts = ["2026-09-18T12:00:00.000900Z", "2026-09-18T12:00:00.000100Z"];
    const followupClient = await runtimePool.connect();
    try {
      await followupClient.query("BEGIN");
      await followupClient.query("SELECT set_config('app.workspace_id', $1, true)", [
        owner.workspaceId,
      ]);
      for (let index = 0; index < followupIds.length; index += 1) {
        await followupClient.query(
          `INSERT INTO followups
             (id, workspace_id, purpose, source_quiz_version_id, source_session_id,
              source_report_id, title, content, concept_keys, time_mode, generic_token_hash,
              opens_at, closes_at, expires_at, closed_at, created_by, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
          [
            followupIds[index],
            owner.workspaceId,
            "recovery",
            version.id,
            sessionIds[index],
            reportIds[index],
            `Cursor follow-up ${index + 1}`,
            JSON.stringify(content),
            ["cursor-precision"],
            "flex",
            randomUUID(),
            now,
            expiresAt,
            expiresAt,
            null,
            owner.userId,
            exactFollowupCreatedAts[index],
          ],
        );
      }
      await followupClient.query("COMMIT");
    } catch (error) {
      await followupClient.query("ROLLBACK");
      throw error;
    } finally {
      followupClient.release();
    }

    const firstFollowupPage = await repository.listFollowupHistory(owner.workspaceId, {
      limit: 1,
      now,
    });
    expect(firstFollowupPage).toMatchObject({
      hasMore: true,
      items: [{ id: followupIds[0], cursorCreatedAt: "2026-09-18T12:00:00.000900Z" }],
    });
    const firstFollowup = firstFollowupPage.items[0]!;
    const secondFollowupPage = await repository.listFollowupHistory(owner.workspaceId, {
      limit: 1,
      cursor: {
        createdAt: firstFollowup.createdAt,
        cursorCreatedAt: firstFollowup.cursorCreatedAt,
        id: firstFollowup.id,
      },
      now,
    });
    expect(secondFollowupPage.items.map(({ id }) => id)).toEqual([followupIds[1]]);
  });

  it("shows only the active workspace and rejects cross-tenant writes", async () => {
    await repository.updateOperationalFeatures(
      {
        signups: true,
        sessionCreation: true,
        mediaUploads: true,
        roundExperiences: true,
        audiencePulse: true,
        roomChat: true,
      },
      `features-reset-${randomUUID()}`,
    );
    expect(
      await repository.updateOperationalFeatures(
        {
          signups: false,
          mediaUploads: false,
          roundExperiences: false,
          audiencePulse: false,
          roomChat: false,
        },
        `features-test-${randomUUID()}`,
      ),
    ).toMatchObject({
      signups: false,
      sessionCreation: true,
      mediaUploads: false,
      roundExperiences: false,
      audiencePulse: false,
      roomChat: false,
    });
    expect(await repository.getOperationalFeatures()).toMatchObject({
      signups: false,
      sessionCreation: true,
      mediaUploads: false,
      roundExperiences: false,
      audiencePulse: false,
      roomChat: false,
    });
    await repository.updateOperationalFeatures(
      {
        signups: true,
        mediaUploads: true,
        roundExperiences: true,
        audiencePulse: true,
        roomChat: true,
      },
      `features-restore-${randomUUID()}`,
    );

    const first = await creator("first");
    const second = await creator("second");
    const invitationTokenHash = `invite-${randomUUID()}`;
    const workspaceInvitation = await repository.createWorkspaceInvitation({
      id: randomUUID(),
      workspaceId: first.workspaceId,
      email: second.email,
      role: "editor",
      tokenHash: invitationTokenHash,
      invitedBy: first.userId,
      expiresAt: new Date(Date.now() + 60_000),
      acceptedAt: null,
      revokedAt: null,
      createdAt: new Date(),
    });
    expect(await repository.listWorkspaceInvitations(second.workspaceId)).toEqual([]);
    expect(await repository.listWorkspaceInvitations(first.workspaceId)).toHaveLength(1);
    expect(
      await repository.acceptWorkspaceInvitation(invitationTokenHash, new Date(), "test-v1"),
    ).toMatchObject({ workspaceId: first.workspaceId, userId: second.userId, role: "editor" });
    expect(
      await repository.acceptWorkspaceInvitation(invitationTokenHash, new Date(), "test-v1"),
    ).toBeNull();
    expect((await repository.listWorkspaces(second.userId)).map(({ id }) => id).sort()).toEqual(
      [first.workspaceId, second.workspaceId].sort(),
    );
    const creatorSessionToken = `creator-session-${randomUUID()}`;
    await repository.createCreatorSession({
      id: randomUUID(),
      userId: second.userId,
      tokenHash: creatorSessionToken,
      expiresAt: new Date(Date.now() + 60_000),
      activeWorkspaceId: first.workspaceId,
    });
    expect(await repository.getCreatorBySession(creatorSessionToken, new Date())).toMatchObject({
      workspaceId: first.workspaceId,
      role: "editor",
    });
    expect(
      await repository.updateWorkspaceMemberRole(first.workspaceId, second.userId, "viewer"),
    ).toMatchObject({ role: "viewer" });
    expect(await repository.getCreatorBySession(creatorSessionToken, new Date())).toMatchObject({
      workspaceId: first.workspaceId,
      role: "viewer",
    });
    const viewerExport = await repository.exportAccount(second.userId);
    expect(viewerExport.workspaceMemberships).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: first.workspaceId, role: "viewer" }),
        expect.objectContaining({ id: second.workspaceId, role: "owner" }),
      ]),
    );
    expect(
      (viewerExport.workspaces as Array<{ id: string }>).map((workspace) => workspace.id),
    ).toEqual([second.workspaceId]);
    expect(
      await repository.setCreatorSessionWorkspace(
        creatorSessionToken,
        second.userId,
        second.workspaceId,
      ),
    ).toBe(true);
    expect(await repository.getCreatorBySession(creatorSessionToken, new Date())).toMatchObject({
      workspaceId: second.workspaceId,
      role: "owner",
    });
    expect(await repository.removeWorkspaceMember(first.workspaceId, second.userId)).toBe(true);
    expect(
      (await repository.listWorkspaceMembers(first.workspaceId)).map(({ role }) => role),
    ).toEqual(["owner"]);
    expect(
      await repository.revokeWorkspaceInvitation(first.workspaceId, workspaceInvitation.id),
    ).toBe(false);
    const theme = {
      organizationName: "First Learning",
      primaryColor: "#0B2239",
      accentColor: "#087375",
    };
    expect(await repository.updateBrandTheme(first.workspaceId, theme)).toEqual(theme);
    expect(await repository.getBrandTheme(first.workspaceId)).toEqual(theme);
    expect(await repository.getBrandTheme(second.workspaceId)).toBeNull();
    const now = new Date();
    const firstQuiz = await repository.createQuiz({
      id: randomUUID(),
      workspaceId: first.workspaceId,
      title: "First workspace quiz",
      description: "",
      status: "draft",
      draft: { title: "First workspace quiz", description: "", questions: [] },
      currentVersionId: null,
      createdAt: now,
      updatedAt: now,
    });
    const tiedFirstQuiz = await repository.createQuiz({
      id: randomUUID(),
      workspaceId: first.workspaceId,
      title: "Tied first workspace quiz",
      description: "",
      status: "draft",
      draft: { title: "Tied first workspace quiz", description: "", questions: [] },
      currentVersionId: null,
      createdAt: now,
      updatedAt: now,
    });
    const secondQuiz = await repository.createQuiz({
      id: randomUUID(),
      workspaceId: second.workspaceId,
      title: "Second workspace quiz",
      description: "",
      status: "draft",
      draft: { title: "Second workspace quiz", description: "", questions: [] },
      currentVersionId: null,
      createdAt: now,
      updatedAt: now,
    });
    const mediaId = randomUUID();
    await repository.createMediaAsset({
      id: mediaId,
      workspaceId: first.workspaceId,
      objectKey: `quarantine/${first.workspaceId}/${mediaId}.png`,
      mimeType: "image/png",
      sizeBytes: 128,
      scanStatus: "pending",
      altText: "A labelled map",
      createdAt: now,
    });

    expect((await repository.listQuizzes(first.workspaceId)).map((quiz) => quiz.id)).toEqual(
      [firstQuiz.id, tiedFirstQuiz.id].sort((left, right) => right.localeCompare(left)),
    );
    expect((await repository.listQuizzes(second.workspaceId)).map((quiz) => quiz.id)).toEqual([
      secondQuiz.id,
    ]);
    const firstFolder = await repository.createFolder({
      id: randomUUID(),
      workspaceId: first.workspaceId,
      name: "Core training",
      createdAt: now,
      updatedAt: now,
    });
    await repository.createFolder({
      id: randomUUID(),
      workspaceId: second.workspaceId,
      name: "Core training",
      createdAt: now,
      updatedAt: now,
    });
    expect(
      await repository.organizeQuiz(first.workspaceId, firstQuiz.id, firstFolder.id, ["Safety"]),
    ).toMatchObject({ folderId: firstFolder.id, tags: ["Safety"] });
    expect(
      await repository.organizeQuiz(second.workspaceId, secondQuiz.id, firstFolder.id, []),
    ).toBeNull();
    expect(await repository.listFolders(first.workspaceId)).toEqual([
      expect.objectContaining({ id: firstFolder.id, name: "Core training" }),
    ]);
    expect(
      await repository.renameFolder(first.workspaceId, firstFolder.id, "Required training"),
    ).toMatchObject({ name: "Required training" });
    expect(await repository.deleteFolder(first.workspaceId, firstFolder.id)).toBe(true);
    expect(await repository.getQuiz(first.workspaceId, firstQuiz.id)).toMatchObject({
      folderId: null,
      tags: ["Safety"],
    });
    expect(await repository.getMediaAsset(second.workspaceId, mediaId)).toBeNull();
    const finalizationToken = randomUUID();
    expect(
      await repository.claimMediaAssetFinalization(first.workspaceId, mediaId, finalizationToken),
    ).toMatchObject({ scanStatus: "finalizing" });
    expect(
      await repository.claimMediaAssetFinalization(first.workspaceId, mediaId, randomUUID()),
    ).toBeNull();
    expect(
      await repository.releaseMediaAssetFinalization(first.workspaceId, mediaId, randomUUID()),
    ).toBe(false);
    expect(
      await repository.releaseMediaAssetFinalization(first.workspaceId, mediaId, finalizationToken),
    ).toBe(true);
    expect(
      await repository.claimMediaAssetFinalization(first.workspaceId, mediaId, finalizationToken),
    ).toMatchObject({ scanStatus: "finalizing" });
    const finalizedAt = new Date();
    expect(
      await repository.updateMediaAsset(first.workspaceId, mediaId, {
        scanStatus: "clean",
        objectKey: `media/${first.workspaceId}/${mediaId}.png`,
        finalizationToken,
        finalizedAt,
      }),
    ).toMatchObject({ scanStatus: "clean" });
    const initialClaims = await repository.claimMediaObjectCleanupCandidates(finalizedAt, 100);
    const initialClaim = initialClaims.find(({ asset }) => asset.id === mediaId);
    expect(initialClaim).toMatchObject({ pass: 0 });
    const renewedAt = new Date(finalizedAt.getTime() + 4 * 60_000);
    expect(await repository.renewMediaObjectCleanupClaim(initialClaim!, renewedAt)).toBe(true);
    expect(
      (
        await repository.claimMediaObjectCleanupCandidates(
          new Date(finalizedAt.getTime() + 5 * 60_000),
          100,
        )
      ).some(({ asset }) => asset.id === mediaId),
    ).toBe(false);
    const replacementAt = new Date(renewedAt.getTime() + 5 * 60_000);
    const replacementClaims = await repository.claimMediaObjectCleanupCandidates(
      replacementAt,
      100,
    );
    const replacementClaim = replacementClaims.find(({ asset }) => asset.id === mediaId);
    expect(replacementClaim).toMatchObject({ pass: 0 });
    expect(replacementClaim!.claimToken).not.toBe(initialClaim!.claimToken);
    expect(await repository.renewMediaObjectCleanupClaim(initialClaim!, replacementAt)).toBe(false);
    expect(await repository.completeMediaObjectCleanupClaim(initialClaim!, replacementAt)).toBe(
      false,
    );
    expect(await repository.completeMediaObjectCleanupClaim(replacementClaim!, replacementAt)).toBe(
      true,
    );
    expect(await repository.completeMediaObjectCleanupClaim(replacementClaim!, replacementAt)).toBe(
      false,
    );
    const finalSweepAt = new Date(finalizedAt.getTime() + 6 * 24 * 60 * 60_000);
    const finalClaims = await repository.claimMediaObjectCleanupCandidates(finalSweepAt, 100);
    const finalClaim = finalClaims.find(({ asset }) => asset.id === mediaId);
    expect(finalClaim).toMatchObject({ pass: 1 });
    const retryAt = new Date(finalSweepAt.getTime() + 60 * 60_000);
    expect(await repository.deferMediaObjectCleanupClaim(finalClaim!, retryAt)).toBe(true);
    const retryClaims = await repository.claimMediaObjectCleanupCandidates(retryAt, 100);
    const retryClaim = retryClaims.find(({ asset }) => asset.id === mediaId);
    expect(retryClaim).toMatchObject({ pass: 1 });
    expect(await repository.completeMediaObjectCleanupClaim(retryClaim!, retryAt)).toBe(true);

    const inlineId = randomUUID();
    const inlineToken = randomUUID();
    await repository.createMediaAsset({
      id: inlineId,
      workspaceId: second.workspaceId,
      objectKey: `quarantine/${second.workspaceId}/${inlineId}.png`,
      mimeType: "image/png",
      sizeBytes: 128,
      scanStatus: "pending",
      altText: "An inline cleanup fixture",
      createdAt: finalizedAt,
    });
    await repository.claimMediaAssetFinalization(second.workspaceId, inlineId, inlineToken);
    const inlineAsset = await repository.updateMediaAsset(second.workspaceId, inlineId, {
      scanStatus: "clean",
      objectKey: `media/${second.workspaceId}/${inlineId}/${inlineToken}.png`,
      finalizationToken: inlineToken,
      finalizedAt,
    });
    expect(await repository.completeInlineMediaObjectCleanup(inlineAsset!, finalizedAt)).toBe(true);
    expect(await repository.completeInlineMediaObjectCleanup(inlineAsset!, finalizedAt)).toBe(
      false,
    );
    expect((await repository.listMediaAssets(first.workspaceId)).map(({ id }) => id)).toEqual([
      mediaId,
    ]);
    expect(await repository.deleteMediaAsset(second.workspaceId, mediaId)).toBe(false);
    const exported = await repository.exportAccount(first.userId);
    expect(exported.consentRecords).toHaveLength(2);
    expect(exported.mediaAssets).toHaveLength(1);
    expect(exported.quizVersions).toHaveLength(0);
    expect(exported.workspaces).toEqual(
      expect.arrayContaining([expect.objectContaining({ brand_theme: theme })]),
    );
    const correctChoiceId = randomUUID();
    const versionContent = {
      title: "First workspace quiz",
      description: "Batch answer persistence fixture",
      questions: [
        {
          id: randomUUID(),
          type: "true_false",
          prompt: "Batch commits are atomic.",
          choices: [
            { id: correctChoiceId, label: "True", isCorrect: true },
            { id: randomUUID(), label: "False", isCorrect: false },
          ],
          timeLimitSeconds: 30,
          basePoints: 1_000,
          explanation: "One transaction stores the answer burst and final state.",
          mediaId: null,
          mediaAlt: null,
        },
      ],
    } satisfies QuizDraft;
    await repository.updateQuiz(first.workspaceId, firstQuiz.id, versionContent);
    const firstVersion = await repository.publishQuiz({
      id: randomUUID(),
      workspaceId: first.workspaceId,
      quizId: firstQuiz.id,
      version: 1,
      content: versionContent,
      contentHash: randomUUID(),
      publishedAt: now,
    });
    await repository.updateQuiz(second.workspaceId, secondQuiz.id, versionContent);
    const secondVersion = await repository.publishQuiz({
      id: randomUUID(),
      workspaceId: second.workspaceId,
      quizId: secondQuiz.id,
      version: 1,
      content: versionContent,
      contentHash: randomUUID(),
      publishedAt: now,
    });

    const sessionId = randomUUID();
    const firstParticipantId = randomUUID();
    const secondParticipantId = randomUUID();
    let gameState = createGameState({
      sessionId,
      code: String(randomInt(1_000_000, 10_000_000)),
      quiz: versionContent,
      settings: {
        audienceLimit: 20,
        scoringMode: "accuracy",
        resultVisibility: "private",
        allowLateJoin: true,
        nicknamePolicy: "custom",
      },
    });
    for (const [id, nickname] of [
      [firstParticipantId, "First learner"],
      [secondParticipantId, "Second learner"],
    ] as const) {
      gameState = addParticipant(gameState, {
        id,
        nickname,
        score: 0,
        correctCount: 0,
        acceptedResponseMs: 0,
        connected: true,
        kicked: false,
      }).state;
    }
    const openedAtMs = Date.now();
    gameState = applyHostCommand(gameState, {
      commandId: randomUUID(),
      expectedVersion: gameState.version,
      action: "start",
      nowMs: openedAtMs,
      newRoundId: randomUUID,
    }).state;
    const persistedSession = {
      id: sessionId,
      workspaceId: first.workspaceId,
      quizVersionId: firstVersion.id,
      hostId: first.userId,
      hostTokenHash: randomUUID(),
      state: gameState,
      expiresAt: new Date(Date.now() + 60_000),
      retentionExpiresAt: new Date(Date.now() + 30 * 24 * 60 * 60_000),
      createdAt: now,
      updatedAt: now,
    };
    await repository.createSession(persistedSession);
    const mismatchedTrust = structuredClone(persistedSession);
    mismatchedTrust.state.settings.trustMode = "verified";
    await expect(
      repository.saveSession(mismatchedTrust, persistedSession.state.version),
    ).rejects.toBeInstanceOf(SessionVersionConflictError);
    await expect(repository.getSessionById(persistedSession.id)).resolves.toMatchObject({
      trustMode: "learning",
      state: { settings: { trustMode: "learning" } },
    });
    expect(await repository.listQuizzes(first.workspaceId)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: firstQuiz.id, lastHostedAt: now }),
        expect.objectContaining({ id: tiedFirstQuiz.id, lastHostedAt: null }),
      ]),
    );
    expect(await repository.listQuizzes(second.workspaceId)).toEqual([
      expect.objectContaining({ id: secondQuiz.id, lastHostedAt: null }),
    ]);
    const duplicateCodeSession = structuredClone(persistedSession);
    duplicateCodeSession.id = randomUUID();
    duplicateCodeSession.state.sessionId = duplicateCodeSession.id;
    duplicateCodeSession.hostTokenHash = randomUUID();
    await expect(repository.createSession(duplicateCodeSession)).rejects.toBeInstanceOf(
      SessionCodeConflictError,
    );
    await repository.commitParticipants(
      persistedSession,
      [
        {
          id: firstParticipantId,
          sessionId,
          nickname: "First learner",
          tokenHash: randomUUID(),
          status: "active",
          joinedAt: now,
        },
        {
          id: secondParticipantId,
          sessionId,
          nickname: "Second learner",
          tokenHash: randomUUID(),
          status: "active",
          joinedAt: now,
        },
      ],
      gameState.version,
    );
    expect(await repository.getParticipants(sessionId)).toHaveLength(2);
    const firstAccepted = acceptAnswer(gameState, {
      answerId: randomUUID(),
      participantId: firstParticipantId,
      roundId: gameState.roundId!,
      choiceId: correctChoiceId,
      idempotencyKey: randomUUID(),
      nowMs: openedAtMs + 100,
    });
    const secondAccepted = acceptAnswer(firstAccepted.state, {
      answerId: randomUUID(),
      participantId: secondParticipantId,
      roundId: gameState.roundId!,
      choiceId: correctChoiceId,
      idempotencyKey: randomUUID(),
      nowMs: openedAtMs + 200,
    });
    persistedSession.state = secondAccepted.state;
    expect(
      await repository.commitAnswers(
        persistedSession,
        [firstAccepted.answer, secondAccepted.answer],
        gameState.version,
      ),
    ).toEqual([firstAccepted.answer, secondAccepted.answer]);
    expect(await repository.exportAccount(first.userId)).toMatchObject({
      answers: [
        expect.objectContaining({
          response_payload: { kind: "choice", choiceIds: [correctChoiceId] },
          response_schema_version: 2,
          confidence: null,
        }),
        expect.objectContaining({
          response_payload: { kind: "choice", choiceIds: [correctChoiceId] },
          response_schema_version: 2,
          confidence: null,
        }),
      ],
    });
    expect((await repository.getSessionById(sessionId))?.state).toMatchObject({
      seq: secondAccepted.state.seq,
      version: secondAccepted.state.version,
      answers: {
        [firstAccepted.answer.answerId]: { score: 1_000 },
        [secondAccepted.answer.answerId]: { score: 1_000 },
      },
    });
    expect(await repository.getSessionEvidence(first.workspaceId, sessionId)).toMatchObject({
      answers: [
        { answerId: firstAccepted.answer.answerId },
        { answerId: secondAccepted.answer.answerId },
      ],
      rounds: [
        {
          id: gameState.roundId,
          kind: "main",
          sourceRoundId: null,
          lockedAtMs: null,
        },
      ],
      interventions: [],
      qna: { questions: 0, answered: 0, unresolved: 0 },
    });
    persistedSession.state = { ...persistedSession.state, answers: {} };
    await repository.saveSession(persistedSession, persistedSession.state.version);
    expect(
      await repository.listSessionHistory(first.workspaceId, {
        limit: 25,
        now: new Date(),
      }),
    ).toMatchObject({
      items: [expect.objectContaining({ id: sessionId, answerCount: 2 })],
    });
    expect(
      await repository.listSessionHistory(second.workspaceId, {
        limit: 25,
        now: new Date(),
      }),
    ).toMatchObject({ items: [] });

    const staffTokenHash = `staff-${randomUUID()}`;
    const staffCredential = await repository.createSessionStaffCredential({
      id: randomUUID(),
      workspaceId: first.workspaceId,
      sessionId,
      role: "cohost",
      label: "Teaching assistant",
      tokenHash: staffTokenHash,
      createdBy: first.userId,
      expiresAt: new Date(Date.now() + 60_000),
      revokedAt: null,
      createdAt: now,
    });
    expect(await repository.getSessionStaffByToken(staffTokenHash, now)).toMatchObject({
      id: staffCredential.id,
      role: "cohost",
    });
    expect(await repository.listSessionStaff(second.workspaceId, sessionId)).toEqual([]);

    const firstResumeTokenHash = `creator-resume-${randomUUID()}`;
    const firstResumeReplacement = await repository.replaceCreatorResumeCredential({
      id: randomUUID(),
      workspaceId: first.workspaceId,
      sessionId,
      role: "cohost",
      purpose: "creator_resume",
      label: "Creator resume",
      tokenHash: firstResumeTokenHash,
      embedPolicyKeyHash: null,
      embedAllowedOrigins: [],
      createdBy: first.userId,
      expiresAt: new Date(now.getTime() + 4 * 60 * 60_000),
      revokedAt: null,
      createdAt: now,
    });
    const firstResume = firstResumeReplacement.credential;
    expect(firstResumeReplacement.revokedCredentialIds).toEqual([]);
    const secondResumeTokenHash = `creator-resume-${randomUUID()}`;
    const secondResumeReplacement = await repository.replaceCreatorResumeCredential({
      ...firstResume,
      id: randomUUID(),
      tokenHash: secondResumeTokenHash,
      createdAt: new Date(now.getTime() + 1),
    });
    const secondResume = secondResumeReplacement.credential;
    expect(secondResumeReplacement.revokedCredentialIds).toEqual([firstResume.id]);
    expect(await repository.getSessionStaffByToken(firstResumeTokenHash, now)).toBeNull();
    expect(await repository.getSessionStaffByToken(secondResumeTokenHash, now)).toMatchObject({
      id: secondResume.id,
      purpose: "creator_resume",
    });
    expect(
      (await repository.listSessionStaff(first.workspaceId, sessionId)).filter(
        (credential) => credential.purpose === "creator_resume" && !credential.revokedAt,
      ),
    ).toHaveLength(1);
    const expiryClient = await runtimePool.connect();
    try {
      await expiryClient.query("BEGIN");
      await expiryClient.query("SELECT set_config('app.workspace_id', $1, true)", [
        first.workspaceId,
      ]);
      await expiryClient.query(
        "UPDATE game_sessions SET expires_at = clock_timestamp() - interval '1 second' WHERE id = $1",
        [sessionId],
      );
      await expiryClient.query("COMMIT");
      await expect(
        repository.replaceCreatorResumeCredential({
          ...secondResume,
          id: randomUUID(),
          tokenHash: `creator-resume-${randomUUID()}`,
          createdAt: new Date(),
        }),
      ).rejects.toBeInstanceOf(SessionNotActiveError);
    } finally {
      await expiryClient.query("BEGIN");
      await expiryClient.query("SELECT set_config('app.workspace_id', $1, true)", [
        first.workspaceId,
      ]);
      await expiryClient.query("UPDATE game_sessions SET expires_at = $2 WHERE id = $1", [
        sessionId,
        persistedSession.expiresAt,
      ]);
      await expiryClient.query("COMMIT");
      expiryClient.release();
    }

    expect(
      await repository.saveQnaSettings({
        workspaceId: first.workspaceId,
        sessionId,
        enabled: true,
        displayMode: "anonymous_public",
        moderationMode: "pre",
        participantReplies: false,
        updatedAt: now,
      }),
    ).toMatchObject({ sessionId, moderationMode: "pre" });
    const qnaQuestion = await repository.createQnaQuestion({
      id: randomUUID(),
      workspaceId: first.workspaceId,
      sessionId,
      participantId: firstParticipantId,
      body: "Could you explain why this transaction is atomic?",
      publicAlias: "First learner",
      status: "published",
      label: "clarification",
      voteCount: 0,
      votedByViewer: false,
      createdAt: now,
      updatedAt: now,
    });
    expect(
      await repository.setQnaVote(
        first.workspaceId,
        sessionId,
        qnaQuestion.id,
        secondParticipantId,
        true,
      ),
    ).toBe(1);
    expect(
      await repository.setQnaVote(
        first.workspaceId,
        sessionId,
        qnaQuestion.id,
        secondParticipantId,
        true,
      ),
    ).toBe(1);
    const qnaReply = await repository.createQnaReply({
      id: randomUUID(),
      workspaceId: first.workspaceId,
      sessionId,
      questionId: qnaQuestion.id,
      participantId: null,
      actorId: first.userId,
      staffCredentialId: null,
      body: "The state and answer rows commit in one database transaction.",
      publicAlias: "Facilitator",
      status: "published",
      createdAt: now,
      updatedAt: now,
    });
    expect(await repository.getQnaReply(second.workspaceId, qnaReply.id)).toBeNull();
    expect(
      await repository.updateQnaQuestion(first.workspaceId, qnaQuestion.id, {
        status: "answered",
        label: qnaQuestion.label,
      }),
    ).toMatchObject({ status: "answered", voteCount: 1 });
    expect(await repository.getSessionEvidence(first.workspaceId, sessionId)).toMatchObject({
      qna: { questions: 1, answered: 1, unresolved: 0 },
    });
    expect(await repository.getQnaQuestion(second.workspaceId, qnaQuestion.id)).toBeNull();

    const interactionNow = new Date(now.getTime() + 1_000);
    const settingsEvent = {
      eventId: randomUUID(),
      idempotencyKey: randomUUID(),
      type: "audience.settings.updated",
      payload: { chatEnabled: true },
    };
    const interactionSettings = {
      workspaceId: first.workspaceId,
      sessionId,
      signalsEnabled: true,
      chatEnabled: true,
      chatIdentityMode: "alias_private" as const,
      slowModeSeconds: 0 as const,
      presenterFeedMode: "pinned" as const,
      updatedAt: interactionNow,
    };
    const savedSettings = await repository.saveInteractionSettings(
      interactionSettings,
      settingsEvent,
    );
    expect(savedSettings).toMatchObject({
      duplicate: false,
      record: { chatEnabled: true, audienceSeq: 1 },
      event: { audienceSeq: 1 },
    });
    expect(
      await repository.saveInteractionSettings(interactionSettings, settingsEvent),
    ).toMatchObject({ duplicate: true, event: { audienceSeq: 1 } });
    expect(await repository.getInteractionSettings(second.workspaceId, sessionId)).toBeNull();

    const signalMutation = await repository.setParticipantSignal(
      {
        workspaceId: first.workspaceId,
        sessionId,
        contextKey: `round:${gameState.roundId}`,
        participantId: firstParticipantId,
        signal: "need_example",
        now: new Date(interactionNow.getTime() + 1),
      },
      {
        eventId: randomUUID(),
        idempotencyKey: randomUUID(),
        type: "audience.signal.updated",
        payload: {},
      },
    );
    expect(signalMutation).toMatchObject({
      record: { signal: "need_example" },
      event: { audienceSeq: 2 },
    });

    const messageId = randomUUID();
    const chatIdempotencyKey = randomUUID();
    const chatMutation = await repository.createChatMessage(
      {
        id: messageId,
        workspaceId: first.workspaceId,
        sessionId,
        participantId: firstParticipantId,
        actorId: null,
        staffCredentialId: null,
        replyToId: null,
        body: "Could we see another example?",
        authorAlias: "First learner",
        identityModeAtCreation: "alias_public",
        status: "published",
        pinned: false,
        idempotencyKey: chatIdempotencyKey,
        createdAt: new Date(interactionNow.getTime() + 2),
        updatedAt: new Date(interactionNow.getTime() + 2),
      },
      {
        eventId: randomUUID(),
        idempotencyKey: chatIdempotencyKey,
        type: "chat.message.created",
        payload: {},
      },
    );
    expect(chatMutation).toMatchObject({
      record: { identityModeAtCreation: "alias_private" },
      event: { audienceSeq: 3 },
    });
    expect(
      await repository.setChatReaction(
        {
          workspaceId: first.workspaceId,
          sessionId,
          messageId,
          participantId: secondParticipantId,
          reaction: "insight",
          now: new Date(interactionNow.getTime() + 3),
        },
        {
          eventId: randomUUID(),
          idempotencyKey: randomUUID(),
          type: "chat.reaction.updated",
          payload: {},
        },
      ),
    ).toMatchObject({ record: { counts: { insight: 1 } }, event: { audienceSeq: 4 } });
    expect(
      await repository.reportChatMessage(
        first.workspaceId,
        sessionId,
        messageId,
        secondParticipantId,
        new Date(interactionNow.getTime() + 4),
        {
          eventId: randomUUID(),
          idempotencyKey: randomUUID(),
          type: "chat.message.reported",
          payload: {},
        },
      ),
    ).toMatchObject({ record: 1, event: { audienceSeq: 5 } });
    expect(
      await repository.updateChatMessage(
        first.workspaceId,
        sessionId,
        messageId,
        { pinned: true },
        {
          eventId: randomUUID(),
          idempotencyKey: randomUUID(),
          type: "chat.message.pinned",
          payload: {},
        },
        new Date(interactionNow.getTime() + 5),
      ),
    ).toMatchObject({ record: { pinned: true }, event: { audienceSeq: 6 } });

    const restrictedParticipant = {
      workspaceId: first.workspaceId,
      sessionId,
      participantId: firstParticipantId,
      mutedUntil: null,
      bannedAt: new Date(interactionNow.getTime() + 6),
      actorId: first.userId,
      staffCredentialId: null,
      updatedAt: new Date(interactionNow.getTime() + 6),
    };
    await repository.saveAudienceRestriction(restrictedParticipant, {
      eventId: randomUUID(),
      idempotencyKey: randomUUID(),
      type: "audience.moderation.updated",
      payload: {},
    });
    expect(await repository.isQnaBanned(first.workspaceId, sessionId, firstParticipantId)).toBe(
      true,
    );
    await repository.saveAudienceRestriction(
      {
        ...restrictedParticipant,
        bannedAt: null,
        updatedAt: new Date(interactionNow.getTime() + 7),
      },
      {
        eventId: randomUUID(),
        idempotencyKey: randomUUID(),
        type: "audience.moderation.updated",
        payload: {},
      },
    );
    expect(await repository.isQnaBanned(first.workspaceId, sessionId, firstParticipantId)).toBe(
      false,
    );
    expect(
      await repository.listChatMessages(first.workspaceId, sessionId, {
        limit: 1,
        pinnedOnly: true,
      }),
    ).toEqual([expect.objectContaining({ id: messageId, pinned: true })]);
    expect(await repository.listChatReactions(first.workspaceId, sessionId, [messageId])).toEqual([
      expect.objectContaining({ messageId, reaction: "insight" }),
    ]);
    expect(
      await repository.getChatActivitySummary(
        first.workspaceId,
        sessionId,
        new Date(interactionNow.getTime() - 1),
      ),
    ).toMatchObject({
      messagesLastMinute: 1,
      uniqueContributors: 1,
      removedMessages: 0,
      reportCount: 1,
    });
    expect(await repository.listParticipantChatActivity(first.workspaceId, sessionId)).toEqual([
      expect.objectContaining({ participantId: firstParticipantId, messageCount: 1 }),
    ]);
    expect(await repository.listAudienceRestrictions(first.workspaceId, sessionId)).toEqual([
      expect.objectContaining({ participantId: firstParticipantId, bannedAt: null }),
    ]);
    expect(await repository.getSessionEvidence(first.workspaceId, sessionId)).toMatchObject({
      interactions: {
        signalEvents: [expect.objectContaining({ signal: "need_example" })],
        chatMessages: [expect.objectContaining({ id: messageId, pinned: true })],
        reactions: [expect.objectContaining({ reaction: "insight" })],
        reports: 1,
        moderationActions: 2,
      },
    });
    expect(await repository.getAudienceOutboxStatus()).toMatchObject({
      pending: 8,
      chatEnabledSessions: 1,
    });
    const claimedAudienceEvent = await repository.claimAudienceOutbox(
      new Date(interactionNow.getTime() + 8),
      new Date(0),
    );
    expect(claimedAudienceEvent).toMatchObject({ attempts: 1 });
    expect(
      await repository.completeAudienceOutbox(
        claimedAudienceEvent!.eventId,
        new Date(interactionNow.getTime() + 9),
      ),
    ).toBe(true);
    expect(
      await repository.completeAudienceOutbox(
        claimedAudienceEvent!.eventId,
        new Date(interactionNow.getTime() + 10),
      ),
    ).toBe(false);
    expect(await repository.getAudienceOutboxStatus()).toMatchObject({ pending: 7 });
    const qnaAudienceEvent = {
      eventId: randomUUID(),
      idempotencyKey: randomUUID(),
      type: "qna.question.created",
      payload: { questionId: qnaQuestion.id },
    };
    expect(
      await repository.appendAudienceEvent(
        first.workspaceId,
        sessionId,
        qnaAudienceEvent,
        new Date(interactionNow.getTime() + 11),
      ),
    ).toMatchObject({ duplicate: false, event: { audienceSeq: 9 } });
    expect(
      await repository.appendAudienceEvent(
        first.workspaceId,
        sessionId,
        qnaAudienceEvent,
        new Date(interactionNow.getTime() + 12),
      ),
    ).toMatchObject({ duplicate: true, event: { audienceSeq: 9 } });
    expect(
      await repository.revokeSessionStaff(first.workspaceId, randomUUID(), staffCredential.id),
    ).toBe(false);
    expect(await repository.getSessionStaffByToken(staffTokenHash, now)).not.toBeNull();
    expect(
      await repository.revokeSessionStaff(first.workspaceId, sessionId, staffCredential.id),
    ).toBe(true);
    expect(await repository.getSessionStaffByToken(staffTokenHash, now)).toBeNull();

    const staleSession = structuredClone(persistedSession);
    const locked = applyHostCommand(persistedSession.state, {
      commandId: randomUUID(),
      expectedVersion: persistedSession.state.version,
      action: "lock",
      nowMs: Date.now(),
      newRoundId: randomUUID,
    });
    persistedSession.state = locked.state;
    await repository.saveSession(persistedSession, staleSession.state.version);
    await expect(
      repository.saveSession(staleSession, staleSession.state.version),
    ).rejects.toBeInstanceOf(SessionVersionConflictError);
    expect((await repository.getSessionById(sessionId))?.state.phase).toBe("question_locked");
    expect(
      (await repository.getSessionEvidence(first.workspaceId, sessionId)).rounds[0]?.lockedAtMs,
    ).not.toBeNull();

    const revealed = applyHostCommand(persistedSession.state, {
      commandId: randomUUID(),
      expectedVersion: persistedSession.state.version,
      action: "reveal",
      nowMs: Date.now(),
      newRoundId: randomUUID,
    });
    const report: Report = {
      id: randomUUID(),
      sessionId,
      status: "ready",
      generatedAt: new Date().toISOString(),
      expiresAt: persistedSession.retentionExpiresAt.toISOString(),
      metrics: {
        participantCount: 2,
        completedCount: 2,
        answerCount: 2,
        accuracyPercent: 100,
      },
      questions: [],
      participants: [],
    };
    const invalidReport = { ...report, status: "invalid" } as unknown as Report;
    const failedFinalization = structuredClone(persistedSession);
    failedFinalization.state = revealed.state;
    await expect(
      repository.saveSession(failedFinalization, persistedSession.state.version, invalidReport),
    ).rejects.toBeDefined();
    expect((await repository.getSessionById(sessionId))?.state.phase).toBe("question_locked");
    expect(await repository.getReportBySession(first.workspaceId, sessionId)).toBeNull();

    const pendingReport: Report = { ...report, status: "pending", generatedAt: null };
    await repository.saveReport(first.workspaceId, pendingReport);
    const reportJob = await repository.claimReportJob(
      new Date(Date.now() + 1_000),
      new Date(Date.now() + 61_000),
    );
    expect(reportJob).toMatchObject({ reportId: report.id, workspaceId: first.workspaceId });
    await repository.retryReportJob(reportJob!, "terminal report failure", now, true);
    expect(await repository.getReport(first.workspaceId, report.id)).toMatchObject({
      status: "failed",
      generatedAt: null,
    });
    expect(
      await repository.listReportHistory(first.workspaceId, { limit: 10, status: "failed", now }),
    ).toMatchObject({
      items: [expect.objectContaining({ id: report.id, status: "failed", generatedAt: null })],
    });
    expect(
      await repository.listReportHistory(first.workspaceId, { limit: 10, status: "pending", now }),
    ).toMatchObject({ items: [] });

    persistedSession.state = revealed.state;
    await repository.saveSession(persistedSession, locked.state.version, report);
    expect((await repository.getSessionById(sessionId))?.state.phase).toBe("question_reveal");
    expect(await repository.getReportBySession(first.workspaceId, sessionId)).toMatchObject({
      id: report.id,
      sessionId,
      status: "ready",
    });
    const followupId = randomUUID();
    const genericFollowupTokenHash = `generic-${randomUUID()}`;
    const personalFollowupTokenHash = `personal-${randomUUID()}`;
    const followupClosesAt = new Date(Date.now() + 24 * 60 * 60_000);
    const legacyFollowupId = randomUUID();
    const legacyClient = await runtimePool.connect();
    try {
      await legacyClient.query("BEGIN");
      await legacyClient.query("SELECT set_config('app.workspace_id', $1, true)", [
        first.workspaceId,
      ]);
      const sourceVersionColumn = await legacyClient.query(
        `SELECT is_nullable
         FROM information_schema.columns
         WHERE table_schema = current_schema()
           AND table_name = 'followups'
           AND column_name = 'source_quiz_version_id'`,
      );
      expect(sourceVersionColumn.rows[0]?.is_nullable).toBe("YES");
      const legacyInsert = await legacyClient.query(
        `INSERT INTO followups
           (id, workspace_id, source_session_id, source_report_id, title, content,
            concept_keys, time_mode, generic_token_hash, opens_at, closes_at, expires_at,
            closed_at, created_by, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
         RETURNING purpose, source_quiz_version_id`,
        [
          legacyFollowupId,
          first.workspaceId,
          sessionId,
          report.id,
          "Legacy recovery follow-up",
          JSON.stringify(versionContent),
          ["transactions"],
          "flex",
          randomUUID(),
          now,
          followupClosesAt,
          persistedSession.retentionExpiresAt,
          null,
          first.userId,
          now,
        ],
      );
      expect(legacyInsert.rows[0]).toMatchObject({
        purpose: "recovery",
        source_quiz_version_id: firstVersion.id,
      });
      await legacyClient.query("DELETE FROM followups WHERE id = $1", [legacyFollowupId]);
      await legacyClient.query("COMMIT");
    } catch (error) {
      await legacyClient.query("ROLLBACK");
      throw error;
    } finally {
      legacyClient.release();
    }
    await repository.createFollowup(
      {
        id: followupId,
        workspaceId: first.workspaceId,
        purpose: "recovery",
        sourceQuizVersionId: firstVersion.id,
        sourceSessionId: sessionId,
        sourceReportId: report.id,
        title: "Database follow-up",
        content: versionContent,
        conceptKeys: ["transactions"],
        timeMode: "flex",
        genericTokenHash: genericFollowupTokenHash,
        opensAt: now,
        closesAt: followupClosesAt,
        expiresAt: persistedSession.retentionExpiresAt,
        closedAt: null,
        createdBy: first.userId,
        createdAt: now,
      },
      [
        {
          id: randomUUID(),
          workspaceId: first.workspaceId,
          followupId,
          sourceParticipantId: firstParticipantId,
          kind: "personal",
          label: "First learner",
          tokenHash: personalFollowupTokenHash,
          timeMultiplier: 1,
          expiresAt: followupClosesAt,
          revokedAt: null,
          createdAt: now,
        },
      ],
    );
    expect(await repository.listReportHistory(first.workspaceId, { limit: 10, now })).toMatchObject(
      {
        items: [expect.objectContaining({ followupId, followupStatus: "open" })],
      },
    );
    expect(
      await repository.listFollowupHistory(first.workspaceId, {
        limit: 10,
        status: "open",
        quizId: firstQuiz.id,
        from: new Date(now.getTime() - 1),
        to: new Date(now.getTime() + 1),
        now,
      }),
    ).toMatchObject({
      items: [expect.objectContaining({ id: followupId, quizId: firstQuiz.id, status: "open" })],
    });
    expect(
      await repository.listFollowupHistory(first.workspaceId, {
        limit: 10,
        quizId: tiedFirstQuiz.id,
        now,
      }),
    ).toMatchObject({ items: [] });
    expect(
      await repository.listFollowupHistory(second.workspaceId, {
        limit: 10,
        quizId: firstQuiz.id,
        now,
      }),
    ).toMatchObject({ items: [] });
    expect(await repository.getFollowup(second.workspaceId, followupId)).toBeNull();
    expect(await repository.getFollowupByReport(first.workspaceId, report.id)).toMatchObject({
      id: followupId,
      content: versionContent,
    });
    const personalAccess = await repository.getFollowupAccessByToken(
      followupId,
      personalFollowupTokenHash,
      now,
    );
    expect(personalAccess).toMatchObject({ sourceParticipantId: firstParticipantId });
    expect(
      await repository.getFollowupByGenericToken(followupId, genericFollowupTokenHash, now),
    ).toMatchObject({ id: followupId });
    await expect(
      repository.createFollowupAccess({
        id: randomUUID(),
        workspaceId: first.workspaceId,
        followupId,
        sourceParticipantId: null,
        kind: "assignment_personal",
        label: "Wrong purpose",
        tokenHash: randomUUID(),
        timeMultiplier: 1,
        expiresAt: followupClosesAt,
        revokedAt: null,
        createdAt: now,
      }),
    ).rejects.toMatchObject({ code: "23514" });
    const assignmentExpiresAt = new Date(now.getTime() + 2 * 24 * 60 * 60_000);
    const assignmentClosesAt = new Date(now.getTime() + 24 * 60 * 60_000);
    const assignmentIds = [randomUUID(), randomUUID()];
    const assignmentPersonalTokenHash = randomUUID();
    for (const [index, assignmentId] of assignmentIds.entries()) {
      await expect(
        repository.createPracticeAssignment(
          firstQuiz.id,
          {
            id: assignmentId,
            workspaceId: first.workspaceId,
            purpose: "assignment",
            sourceQuizVersionId: firstVersion.id,
            sourceSessionId: null,
            sourceReportId: null,
            title: `Database assignment ${index + 1}`,
            content: versionContent,
            conceptKeys: [],
            timeMode: "flex",
            genericTokenHash: randomUUID(),
            opensAt: now,
            closesAt: assignmentClosesAt,
            expiresAt: assignmentExpiresAt,
            closedAt: null,
            createdBy: first.userId,
            createdAt: new Date(now.getTime() + index + 1),
          },
          index === 0
            ? [
                {
                  id: randomUUID(),
                  workspaceId: first.workspaceId,
                  followupId: assignmentId,
                  sourceParticipantId: null,
                  kind: "assignment_personal",
                  label: "Independent learner",
                  tokenHash: assignmentPersonalTokenHash,
                  timeMultiplier: 1,
                  expiresAt: assignmentClosesAt,
                  revokedAt: null,
                  createdAt: now,
                },
              ]
            : [],
        ),
      ).resolves.toBe(true);
    }
    expect(
      await repository.listFollowupHistory(first.workspaceId, {
        limit: 10,
        quizId: firstQuiz.id,
        now,
      }),
    ).toMatchObject({
      items: expect.arrayContaining([
        expect.objectContaining({
          id: assignmentIds[0],
          purpose: "assignment",
          sourceQuizVersionId: firstVersion.id,
          sourceSessionId: null,
          sourceReportId: null,
        }),
        expect.objectContaining({ id: assignmentIds[1], purpose: "assignment" }),
      ]),
    });
    expect(
      await repository.listFollowupHistory(first.workspaceId, {
        limit: 1,
        purpose: "assignment",
        quizId: firstQuiz.id,
        now,
      }),
    ).toMatchObject({
      hasMore: true,
      items: [expect.objectContaining({ id: assignmentIds[1], purpose: "assignment" })],
    });
    expect(
      await repository.listFollowupHistory(first.workspaceId, {
        limit: 1,
        purpose: "recovery",
        quizId: firstQuiz.id,
        now,
      }),
    ).toMatchObject({
      hasMore: false,
      items: [expect.objectContaining({ id: followupId, purpose: "recovery" })],
    });
    expect(
      await repository.getFollowupAccessByToken(
        assignmentIds[0]!,
        assignmentPersonalTokenHash,
        now,
      ),
    ).toMatchObject({ kind: "assignment_personal", sourceParticipantId: null });
    await repository.createOrGetFollowupAttempt({
      id: randomUUID(),
      workspaceId: first.workspaceId,
      followupId: assignmentIds[0]!,
      accessTokenId: null,
      sourceParticipantId: null,
      attemptTokenHash: randomUUID(),
      status: "completed",
      phase: "completed",
      currentIndex: 0,
      version: 1,
      timeMultiplier: 1,
      questionOpenedAt: now,
      deadlineAt: null,
      completedAt: now,
      createdAt: now,
      updatedAt: now,
    });
    expect(await repository.getFollowupProgress(first.workspaceId, assignmentIds[0]!)).toEqual({
      attemptCount: 1,
      completedAttemptCount: 1,
    });
    expect(await repository.getFollowupProgress(second.workspaceId, assignmentIds[0]!)).toBeNull();
    const createdAssignmentAccess = {
      id: randomUUID(),
      workspaceId: first.workspaceId,
      followupId: assignmentIds[1]!,
      sourceParticipantId: null,
      kind: "assignment_personal" as const,
      label: "Post-creation learner",
      tokenHash: randomUUID(),
      timeMultiplier: 1 as const,
      expiresAt: assignmentClosesAt,
      revokedAt: null,
      createdAt: now,
    };
    await expect(
      repository.createAssignmentPersonalAccess(
        { ...createdAssignmentAccess, kind: "accommodation", timeMultiplier: 1.5 },
        1,
      ),
    ).rejects.toThrow(TypeError);
    await expect(
      repository.createAssignmentPersonalAccess(createdAssignmentAccess, 1),
    ).resolves.toMatchObject({ id: createdAssignmentAccess.id });
    expect(
      await repository.revokeFollowupAccess(
        first.workspaceId,
        assignmentIds[1]!,
        createdAssignmentAccess.id,
        now,
      ),
    ).toBe(true);
    await expect(
      repository.createAssignmentPersonalAccess(
        {
          ...createdAssignmentAccess,
          id: randomUUID(),
          tokenHash: randomUUID(),
          revokedAt: null,
        },
        1,
      ),
    ).rejects.toBeInstanceOf(FollowupAccessLimitError);
    await expect(
      repository.createAssignmentPersonalAccess(
        {
          ...createdAssignmentAccess,
          workspaceId: second.workspaceId,
          id: randomUUID(),
          tokenHash: randomUUID(),
        },
        1,
      ),
    ).resolves.toBeNull();
    await expect(
      repository.createAssignmentPersonalAccess(
        {
          ...createdAssignmentAccess,
          followupId,
          id: randomUUID(),
          tokenHash: randomUUID(),
        },
        1,
      ),
    ).resolves.toBeNull();
    let accessWhileClosing:
      ReturnType<typeof repository.createAssignmentPersonalAccess> | undefined;
    const closingClient = await runtimePool.connect();
    try {
      await closingClient.query("BEGIN");
      const closingPid = Number(
        (await closingClient.query("SELECT pg_backend_pid() AS pid")).rows[0]?.pid,
      );
      await closingClient.query("SELECT set_config('app.workspace_id', $1, true)", [
        first.workspaceId,
      ]);
      await closingClient.query(
        `UPDATE followups SET closed_at = $3
         WHERE workspace_id = $1 AND id = $2`,
        [first.workspaceId, assignmentIds[1], new Date()],
      );
      accessWhileClosing = repository.createAssignmentPersonalAccess(
        {
          ...createdAssignmentAccess,
          id: randomUUID(),
          tokenHash: randomUUID(),
          label: "Closing race learner",
        },
        100,
      );

      let waitingOnClose = false;
      for (let attempt = 0; attempt < 50; attempt += 1) {
        const activity = await closingClient.query(
          `SELECT EXISTS (
             SELECT 1
             FROM pg_stat_activity
             WHERE pid <> pg_backend_pid()
               AND wait_event_type = 'Lock'
               AND $1::integer = ANY(pg_blocking_pids(pid))
           ) AS waiting`,
          [closingPid],
        );
        waitingOnClose = activity.rows[0]?.waiting === true;
        if (waitingOnClose) break;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(waitingOnClose).toBe(true);
      await closingClient.query("COMMIT");
    } catch (error) {
      await closingClient.query("ROLLBACK");
      throw error;
    } finally {
      closingClient.release();
    }
    await expect(accessWhileClosing!).resolves.toBeNull();
    const elapsedAssignmentId = randomUUID();
    const elapsedClosesAt = new Date(now.getTime() + 1);
    const elapsedAssignment = {
      id: elapsedAssignmentId,
      workspaceId: first.workspaceId,
      purpose: "assignment" as const,
      sourceQuizVersionId: firstVersion.id,
      sourceSessionId: null,
      sourceReportId: null,
      title: "Elapsed assignment",
      content: versionContent,
      conceptKeys: [],
      timeMode: "flex" as const,
      genericTokenHash: randomUUID(),
      opensAt: now,
      closesAt: elapsedClosesAt,
      expiresAt: assignmentExpiresAt,
      closedAt: null,
      createdBy: first.userId,
      createdAt: now,
    };
    await expect(
      repository.createPracticeAssignment(firstQuiz.id, elapsedAssignment, []),
    ).resolves.toBe(true);
    await expect(repository.createFollowup(elapsedAssignment, [])).rejects.toThrow(
      "require atomic source validation",
    );
    await expect(
      repository.createAssignmentPersonalAccess(
        {
          ...createdAssignmentAccess,
          followupId: elapsedAssignmentId,
          id: randomUUID(),
          tokenHash: randomUUID(),
          expiresAt: elapsedClosesAt,
        },
        100,
      ),
    ).resolves.toBeNull();
    await expect(
      repository.createPracticeAssignment(
        firstQuiz.id,
        {
          id: randomUUID(),
          workspaceId: first.workspaceId,
          purpose: "assignment",
          sourceQuizVersionId: secondVersion.id,
          sourceSessionId: null,
          sourceReportId: null,
          title: "Cross-tenant source",
          content: versionContent,
          conceptKeys: [],
          timeMode: "flex",
          genericTokenHash: randomUUID(),
          opensAt: now,
          closesAt: assignmentClosesAt,
          expiresAt: assignmentExpiresAt,
          closedAt: null,
          createdBy: first.userId,
          createdAt: now,
        },
        [],
      ),
    ).resolves.toBe(false);
    await expect(
      repository.createPracticeAssignment(
        firstQuiz.id,
        {
          id: randomUUID(),
          workspaceId: first.workspaceId,
          purpose: "assignment",
          sourceQuizVersionId: firstVersion.id,
          sourceSessionId: null,
          sourceReportId: null,
          title: "Invalid assignment concepts",
          content: versionContent,
          conceptKeys: ["recovery-only"],
          timeMode: "flex",
          genericTokenHash: randomUUID(),
          opensAt: now,
          closesAt: assignmentClosesAt,
          expiresAt: assignmentExpiresAt,
          closedAt: null,
          createdBy: first.userId,
          createdAt: now,
        },
        [],
      ),
    ).rejects.toMatchObject({ code: "23514" });
    expect(
      await repository.purgeExpiredPracticeAssignments(new Date(assignmentExpiresAt.getTime() - 1)),
    ).toBe(0);
    expect(await repository.purgeExpiredPracticeAssignments(assignmentExpiresAt)).toBe(3);
    expect(await repository.getFollowup(first.workspaceId, assignmentIds[0]!)).toBeNull();
    expect(
      await repository.getFollowupAccessByToken(
        assignmentIds[0]!,
        assignmentPersonalTokenHash,
        now,
      ),
    ).toBeNull();
    const attemptTokenHash = personalFollowupTokenHash;
    const attempt = await repository.createOrGetFollowupAttempt({
      id: randomUUID(),
      workspaceId: first.workspaceId,
      followupId,
      accessTokenId: personalAccess!.id,
      sourceParticipantId: firstParticipantId,
      attemptTokenHash,
      status: "in_progress",
      phase: "question_open",
      currentIndex: 0,
      version: 0,
      timeMultiplier: 1,
      questionOpenedAt: now,
      deadlineAt: null,
      completedAt: null,
      createdAt: now,
      updatedAt: now,
    });
    const followupAnswer = {
      id: randomUUID(),
      workspaceId: first.workspaceId,
      followupId,
      attemptId: attempt.id,
      checkpointId: versionContent.questions[0]!.id,
      response: { kind: "choice" as const, choiceIds: [correctChoiceId] },
      confidence: 2 as const,
      correct: true,
      idempotencyKey: randomUUID(),
      acceptedAt: now,
    };
    const revealedAttempt = { ...attempt, phase: "answer_reveal" as const, version: 1 };
    expect(
      await repository.commitFollowupAnswer(revealedAttempt, followupAnswer, attempt.version),
    ).toMatchObject({ correct: true, confidence: 2 });
    expect(
      await repository.commitFollowupAnswer(revealedAttempt, followupAnswer, attempt.version),
    ).toMatchObject({ id: followupAnswer.id });
    const completedAttempt = {
      ...revealedAttempt,
      status: "completed" as const,
      phase: "completed" as const,
      version: 2,
      completedAt: now,
    };
    expect(await repository.advanceFollowupAttempt(completedAttempt, 1)).toBe(true);
    expect(
      await repository.getFollowupAttemptByToken(followupId, attemptTokenHash, now),
    ).toMatchObject({ status: "completed", version: 2 });
    const thirdParticipantId = randomUUID();
    const staleJoin = addParticipant(staleSession.state, {
      id: thirdParticipantId,
      nickname: "Rolled back learner",
      score: 0,
      correctCount: 0,
      acceptedResponseMs: 0,
      connected: true,
      kicked: false,
    });
    staleSession.state = staleJoin.state;
    await expect(
      repository.commitParticipants(
        staleSession,
        [
          {
            id: thirdParticipantId,
            sessionId,
            nickname: "Rolled back learner",
            tokenHash: randomUUID(),
            status: "active",
            joinedAt: now,
          },
        ],
        secondAccepted.state.version,
      ),
    ).rejects.toBeInstanceOf(SessionVersionConflictError);
    expect(await repository.getParticipants(sessionId)).toHaveLength(2);

    const productEventId = randomUUID();
    const productEventExpiry = new Date(now.getTime() + 30 * 24 * 60 * 60_000);
    await repository.recordProductEvents([
      {
        id: productEventId,
        workspaceId: first.workspaceId,
        name: "rehearsal_completed",
        occurredAt: now.toISOString(),
        dimensions: {
          scenario: "split_room",
          segment: "education",
          betaVersion: "p0-2026",
          durationBucket: "1_to_5m",
        },
        expiresAt: productEventExpiry,
        createdAt: now,
      },
    ]);
    await repository.purgeProductEvents(new Date(productEventExpiry.getTime() - 1));
    expect(
      (
        await packPracticeScoped(first.workspaceId, (client) =>
          client.query("SELECT id FROM product_events WHERE id = $1", [productEventId]),
        )
      ).rows,
    ).toEqual([{ id: productEventId }]);

    const client = await runtimePool.connect();
    try {
      expect(
        (await client.query("SELECT count(*)::integer AS count FROM quizzes")).rows[0]?.count,
      ).toBe(0);
      expect(
        (await client.query("SELECT count(*)::integer AS count FROM users")).rows[0]?.count,
      ).toBe(0);
      expect(
        (await client.query("SELECT count(*)::integer AS count FROM auth_magic_tokens")).rows[0]
          ?.count,
      ).toBe(0);
      expect(
        (await client.query("SELECT count(*)::integer AS count FROM operational_settings")).rows[0]
          ?.count,
      ).toBe(0);
      expect(
        (await client.query("SELECT count(*)::integer AS count FROM qna_questions")).rows[0]?.count,
      ).toBe(0);
      expect(
        (await client.query("SELECT count(*)::integer AS count FROM chat_messages")).rows[0]?.count,
      ).toBe(0);
      expect(
        (await client.query("SELECT count(*)::integer AS count FROM audience_outbox")).rows[0]
          ?.count,
      ).toBe(0);
      expect(
        (await client.query("SELECT count(*)::integer AS count FROM product_events")).rows[0]
          ?.count,
      ).toBe(0);
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.workspace_id', $1, true)", [first.workspaceId]);
      expect(
        (await client.query("SELECT array_agg(id ORDER BY id) AS ids FROM quizzes")).rows[0]?.ids,
      ).toEqual([firstQuiz.id, tiedFirstQuiz.id].sort());
      expect(
        (await client.query("SELECT count(*)::integer AS count FROM qna_questions")).rows[0]?.count,
      ).toBe(1);
      expect(
        (await client.query("SELECT count(*)::integer AS count FROM followups")).rows[0]?.count,
      ).toBe(1);
      expect(
        (await client.query("SELECT count(*)::integer AS count FROM chat_messages")).rows[0]?.count,
      ).toBe(1);
      expect(
        (await client.query("SELECT count(*)::integer AS count FROM audience_outbox")).rows[0]
          ?.count,
      ).toBe(9);
      expect(
        (await client.query("SELECT array_agg(id ORDER BY id) AS ids FROM product_events")).rows[0]
          ?.ids,
      ).toEqual([productEventId]);
      await expect(
        client.query(
          `INSERT INTO quizzes (id, workspace_id, title, description, status, draft)
           VALUES ($1, $2, 'Blocked', '', 'draft', $3)`,
          [randomUUID(), second.workspaceId, JSON.stringify({ title: "Blocked", questions: [] })],
        ),
      ).rejects.toMatchObject({ code: "42501" });
      await client.query("ROLLBACK");

      await client.query("BEGIN");
      await client.query("SELECT set_config('app.workspace_id', $1, true)", [first.workspaceId]);
      await expect(
        client.query("UPDATE quiz_versions SET version = 2 WHERE id = $1", [firstVersion.id]),
      ).rejects.toMatchObject({ code: "55000" });
      await client.query("ROLLBACK");

      await client.query("BEGIN");
      await client.query("SELECT set_config('app.workspace_id', $1, true)", [first.workspaceId]);
      await expect(
        client.query("UPDATE followups SET title = 'Changed' WHERE id = $1", [followupId]),
      ).rejects.toMatchObject({ code: "23514" });
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }
    await repository.purgeProductEvents(productEventExpiry);
    expect(
      (
        await packPracticeScoped(first.workspaceId, (client) =>
          client.query("SELECT id FROM product_events WHERE id = $1", [productEventId]),
        )
      ).rows,
    ).toEqual([]);

    const finishedState = applyHostCommand(persistedSession.state, {
      commandId: randomUUID(),
      expectedVersion: persistedSession.state.version,
      action: "next",
      nowMs: Date.now(),
      newRoundId: randomUUID,
    }).state;
    const beforeFinishVersion = persistedSession.state.version;
    persistedSession.state = finishedState;
    await repository.saveSession(persistedSession, beforeFinishVersion);
    expect(await repository.getInteractionSettings(first.workspaceId, sessionId)).toMatchObject({
      signalsEnabled: false,
      chatEnabled: false,
      closedAt: expect.any(Date),
    });
    await expect(
      repository.setParticipantSignal(
        {
          workspaceId: first.workspaceId,
          sessionId,
          contextKey: `round:${finishedState.roundId}`,
          participantId: firstParticipantId,
          signal: "got_it",
          now: new Date(),
        },
        {
          eventId: randomUUID(),
          idempotencyKey: randomUUID(),
          type: "audience.signal.updated",
          payload: {},
        },
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });

    const billingCreatedAt = new Date("2026-09-14T12:00:00.000Z");
    const billingEvent = {
      providerEventId: `evt-${randomUUID()}`,
      eventType: "checkout.session.completed",
      providerCreatedAt: billingCreatedAt,
      workspaceId: first.workspaceId,
      plan: "pro" as const,
      status: "active",
      customerId: `cus-${randomUUID()}`,
      subscriptionId: `sub-${randomUUID()}`,
    };
    expect(await repository.applyBillingEvent(billingEvent)).toBe(true);
    expect(await repository.applyBillingEvent(billingEvent)).toBe(false);
    expect(
      await repository.applyBillingEvent({
        providerEventId: `evt-${randomUUID()}`,
        eventType: "customer.subscription.deleted",
        providerCreatedAt: new Date("2026-09-14T11:00:00.000Z"),
        workspaceId: first.workspaceId,
        plan: "free",
        status: "canceled",
      }),
    ).toBe(true);
    expect(await repository.getPlan(first.workspaceId)).toBe("pro");

    const flexSessionId = randomUUID();
    const flexLobby = createGameState({
      sessionId: flexSessionId,
      code: String(randomInt(1_000_000, 10_000_000)),
      quiz: firstVersion.content,
      settings: {
        audienceLimit: 20,
        timeMode: "flex",
        scoringMode: "accuracy",
        resultVisibility: "private",
        allowLateJoin: true,
        nicknamePolicy: "custom",
      },
    });
    const flexStoredSession = {
      ...persistedSession,
      id: flexSessionId,
      hostTokenHash: randomUUID(),
      state: flexLobby,
    };
    await repository.createSession(flexStoredSession);
    const flexOpened = applyHostCommand(flexLobby, {
      commandId: randomUUID(),
      expectedVersion: flexLobby.version,
      action: "start",
      nowMs: Date.now(),
      newRoundId: randomUUID,
    }).state;
    flexStoredSession.state = flexOpened;
    await repository.saveSession(flexStoredSession, flexLobby.version);
    expect(await repository.getSessionEvidence(first.workspaceId, flexSessionId)).toMatchObject({
      rounds: [{ id: flexOpened.roundId, deadlineMs: null }],
    });
  });

  it("atomically provisions and audits one synthetic capacity workspace", async () => {
    const owner = await creator("staging-capacity");
    const requestIds = [
      `capacity-exercise-${randomUUID()}`,
      `capacity-concurrent-retry-${randomUUID()}`,
    ];

    const concurrentResults = await Promise.all(
      requestIds.map((requestId) =>
        repository.provisionCapacityTestWorkspace(owner.workspaceId, requestId),
      ),
    );
    expect(concurrentResults).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          workspaceId: owner.workspaceId,
          previousPlan: "free",
          plan: "team",
          status: "active",
          changed: true,
        }),
        expect.objectContaining({
          workspaceId: owner.workspaceId,
          previousPlan: "team",
          plan: "team",
          status: "active",
          changed: false,
        }),
      ]),
    );
    await expect(
      repository.provisionCapacityTestWorkspace(
        owner.workspaceId,
        `capacity-retry-${randomUUID()}`,
      ),
    ).resolves.toMatchObject({
      workspaceId: owner.workspaceId,
      previousPlan: "team",
      plan: "team",
      changed: false,
    });

    expect(await repository.getBillingProfile(owner.workspaceId)).toEqual({
      plan: "team",
      status: "active",
      customerId: null,
      subscriptionId: null,
    });
    expect(await repository.listAuditEvents(owner.workspaceId, null, 100)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          workspaceId: owner.workspaceId,
          action: "operations.staging_capacity.provision",
          targetType: "workspace",
          targetId: owner.workspaceId,
          requestId: expect.stringMatching(/^capacity-(exercise|concurrent-retry)-/),
          metadata: expect.objectContaining({
            purpose: "target-region-load",
            previousPlan: "free",
            plan: "team",
            maxParticipants: 250,
          }),
        }),
      ]),
    );
    expect(
      (await repository.listAuditEvents(owner.workspaceId, null, 100)).filter(
        (event) => event.action === "operations.staging_capacity.provision",
      ),
    ).toHaveLength(1);
  });

  it("reports the runtime database principal's effective privilege boundary", async () => {
    await expect(repository.inspectRuntimeDatabasePrincipal()).resolves.toMatchObject({
      principal: expect.any(String),
      sessionPrincipal: expect.any(String),
      sessionMatchesCurrent: true,
      runtimeRoleMember: true,
      superuser: false,
      bypassRls: false,
      createRole: false,
      createDatabase: false,
      replication: false,
      privilegedRoleMember: false,
      unexpectedRoleMember: false,
      ownerRoleMember: false,
    });
  });

  it("rejects an otherwise restricted runtime principal with an unexpected role grant", async () => {
    const roleName = `openround_test_extra_${randomUUID().replaceAll("-", "")}`;
    const adminPool = new Pool({ connectionString: adminUrl });
    let roleCreated = false;
    try {
      await adminPool.query(`CREATE ROLE "${roleName}" NOLOGIN`);
      roleCreated = true;
      await adminPool.query(`GRANT "${roleName}" TO openround_test_app`);

      const principal = await repository.inspectRuntimeDatabasePrincipal();
      expect(principal).toMatchObject({
        privilegedRoleMember: false,
        unexpectedRoleMember: true,
      });
      expect(() => assertRestrictedRuntimeDatabasePrincipal(principal)).toThrow(
        "restricted, non-owner openround_runtime database principal",
      );
      await expect(
        repository.provisionCapacityTestWorkspace(
          randomUUID(),
          `capacity-unexpected-role-${randomUUID()}`,
        ),
      ).rejects.toThrow("restricted, non-owner openround_runtime database principal");
    } finally {
      if (roleCreated) {
        await adminPool.query(`REVOKE "${roleName}" FROM openround_test_app`);
        await adminPool.query(`DROP ROLE "${roleName}"`);
      }
      await adminPool.end();
    }

    await expect(repository.inspectRuntimeDatabasePrincipal()).resolves.toMatchObject({
      privilegedRoleMember: false,
      unexpectedRoleMember: false,
    });
  });

  it("refuses capacity provisioning for a non-free workspace without provider identifiers", async () => {
    const owner = await creator("staging-capacity-non-free");
    await repository.setPlan(owner.workspaceId, "pro", { status: "active" });

    await expect(
      repository.provisionCapacityTestWorkspace(
        owner.workspaceId,
        `capacity-non-free-${randomUUID()}`,
      ),
    ).rejects.toThrow("requires an untouched free workspace");
    expect(await repository.getBillingProfile(owner.workspaceId)).toEqual({
      plan: "pro",
      status: "active",
      customerId: null,
      subscriptionId: null,
    });
    expect(
      (await repository.listAuditEvents(owner.workspaceId, null, 100)).filter(
        (event) => event.action === "operations.staging_capacity.provision",
      ),
    ).toEqual([]);
  });

  it("refuses a pre-existing Team workspace without a capacity-provisioning audit marker", async () => {
    const owner = await creator("staging-capacity-unmarked-team");
    await repository.setPlan(owner.workspaceId, "team", { status: "active" });

    await expect(
      repository.provisionCapacityTestWorkspace(
        owner.workspaceId,
        `capacity-unmarked-team-${randomUUID()}`,
      ),
    ).rejects.toThrow("without its prior audit marker");
    expect(
      (await repository.listAuditEvents(owner.workspaceId, null, 100)).filter(
        (event) => event.action === "operations.staging_capacity.provision",
      ),
    ).toEqual([]);
  });

  it("rejects assignment creation when an in-flight archive wins the source Round lock", async () => {
    const owner = await creator("assignment-source-race");
    const now = new Date("2026-09-19T12:00:00.000Z");
    const content = publishableRound("Atomic assignment source");
    const quiz = await repository.createQuiz({
      id: randomUUID(),
      workspaceId: owner.workspaceId,
      title: content.title,
      description: content.description,
      status: "draft",
      draft: content,
      currentVersionId: null,
      createdAt: now,
      updatedAt: now,
    });
    const version = await repository.publishQuiz({
      id: randomUUID(),
      workspaceId: owner.workspaceId,
      quizId: quiz.id,
      version: 1,
      content,
      contentHash: randomUUID(),
      publishedAt: now,
    });
    const followupId = randomUUID();
    const assignment = {
      id: followupId,
      workspaceId: owner.workspaceId,
      purpose: "assignment" as const,
      sourceQuizVersionId: version.id,
      sourceSessionId: null,
      sourceReportId: null,
      title: content.title,
      content,
      conceptKeys: [],
      timeMode: "flex" as const,
      genericTokenHash: randomUUID(),
      opensAt: now,
      closesAt: new Date(now.getTime() + 24 * 60 * 60_000),
      expiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60_000),
      closedAt: null,
      createdBy: owner.userId,
      createdAt: now,
    };
    const raceRepository = new PostgresRepository(runtimeUrl!);
    await raceRepository.initialize();

    let createWhileArchiving:
      ReturnType<typeof raceRepository.createPracticeAssignment> | undefined;
    const archivingClient = await runtimePool.connect();
    try {
      await archivingClient.query("BEGIN");
      const archivingPid = Number(
        (await archivingClient.query("SELECT pg_backend_pid() AS pid")).rows[0]?.pid,
      );
      await archivingClient.query("SELECT set_config('app.workspace_id', $1, true)", [
        owner.workspaceId,
      ]);
      await archivingClient.query(
        `UPDATE quizzes
         SET status = 'archived', archived_at = now(), updated_at = now()
         WHERE workspace_id = $1 AND id = $2`,
        [owner.workspaceId, quiz.id],
      );
      createWhileArchiving = raceRepository.createPracticeAssignment(quiz.id, assignment, []);

      let waitingOnSource = false;
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const activity = await archivingClient.query(
          `SELECT EXISTS (
             SELECT 1
             FROM pg_stat_activity
             WHERE pid <> pg_backend_pid()
               AND wait_event_type = 'Lock'
               AND $1::integer = ANY(pg_blocking_pids(pid))
           ) AS waiting`,
          [archivingPid],
        );
        waitingOnSource = activity.rows[0]?.waiting === true;
        if (waitingOnSource) break;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(waitingOnSource).toBe(true);
      await archivingClient.query("COMMIT");
    } catch (error) {
      await archivingClient.query("ROLLBACK");
      await raceRepository.close();
      throw error;
    } finally {
      archivingClient.release();
    }

    await expect(createWhileArchiving!).resolves.toBe(false);
    expect(await repository.getFollowup(owner.workspaceId, followupId)).toBeNull();
    await raceRepository.close();
  });

  it("enforces the expanded bounded product-event name allowlist", async () => {
    const owner = await creator("product-event-funnel");
    const now = new Date("2026-09-18T12:00:00.000Z");
    const expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60_000);
    await repository.recordProductEvents(
      ProductEventNameSchema.options.map((name) => ({
        id: randomUUID(),
        workspaceId: owner.workspaceId,
        name,
        occurredAt: now.toISOString(),
        dimensions: {
          betaVersion: "p0-2026" as const,
          ...((name === "linked_recheck_opened" || name === "report_reconciled") && {
            artifactType: "round" as const,
          }),
        },
        expiresAt,
        createdAt: now,
      })),
    );

    const client = await runtimePool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.workspace_id', $1, true)", [owner.workspaceId]);
      const stored = await client.query<{ event_name: string }>(
        "SELECT event_name FROM product_events WHERE workspace_id = $1 ORDER BY event_name",
        [owner.workspaceId],
      );
      expect(stored.rows.map((row) => row.event_name)).toEqual(
        [...ProductEventNameSchema.options].sort(),
      );
      await client.query("SAVEPOINT invalid_recovery_event");
      await expect(
        client.query(
          `INSERT INTO product_events
             (id, workspace_id, event_name, dimensions, occurred_at, expires_at, created_at)
           VALUES ($1,$2,'report_reconciled',$3,$4,$5,$4)`,
          [
            randomUUID(),
            owner.workspaceId,
            JSON.stringify({ betaVersion: "p0-2026" }),
            now,
            expiresAt,
          ],
        ),
      ).rejects.toMatchObject({ code: "23514" });
      await client.query("ROLLBACK TO SAVEPOINT invalid_recovery_event");
      await client.query("SAVEPOINT null_recovery_artifact");
      await expect(
        client.query(
          `INSERT INTO product_events
             (id, workspace_id, event_name, dimensions, occurred_at, expires_at, created_at)
           VALUES ($1,$2,'report_reconciled',$3,$4,$5,$4)`,
          [randomUUID(), owner.workspaceId, JSON.stringify({ artifactType: null }), now, expiresAt],
        ),
      ).rejects.toMatchObject({ code: "23514" });
      await client.query("ROLLBACK TO SAVEPOINT null_recovery_artifact");
      await expect(
        client.query(
          `INSERT INTO product_events
             (id, workspace_id, event_name, dimensions, occurred_at, expires_at, created_at)
           VALUES ($1,$2,'content_opened',$3,$4,$5,$4)`,
          [randomUUID(), owner.workspaceId, JSON.stringify({}), now, expiresAt],
        ),
      ).rejects.toMatchObject({ code: "23514" });
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }
  });

  it("cascades product events when an owner account deletes its workspace", async () => {
    const owner = await creator("delete-product-events");
    const now = new Date();
    await repository.recordProductEvents([
      {
        id: randomUUID(),
        workspaceId: owner.workspaceId,
        name: "creation_completed",
        occurredAt: now.toISOString(),
        dimensions: { creationPath: "blank" },
        expiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60_000),
        createdAt: now,
      },
    ]);
    const productEventCount = async () => {
      const client = await runtimePool.connect();
      try {
        await client.query("BEGIN");
        await client.query("SELECT set_config('app.workspace_id', $1, true)", [owner.workspaceId]);
        const result = await client.query<{ count: number }>(
          "SELECT count(*)::integer AS count FROM product_events",
        );
        await client.query("COMMIT");
        return result.rows[0]?.count;
      } finally {
        client.release();
      }
    };

    expect(await productEventCount()).toBe(1);
    await repository.deleteAccount(owner.userId);
    expect(await productEventCount()).toBe(0);
  });

  it("isolates authoring sources and claims each background job once", async () => {
    const first = await creator("authoring-first");
    const second = await creator("authoring-second");
    const now = new Date();
    const jobId = randomUUID();
    await repository.createAuthoringJob({
      id: jobId,
      workspaceId: first.workspaceId,
      createdBy: first.userId,
      sourceType: "pasted_text",
      sourceName: "Private source",
      sourceMimeType: null,
      sourceText: "Only the owning workspace and system worker may read this private source.",
      sourceBlob: null,
      sourceDigest: "c".repeat(64),
      status: "pending",
      attempts: 0,
      appliedQuizId: null,
      availableAt: now,
      output: null,
      lastError: null,
      expiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60_000),
      createdAt: now,
      updatedAt: now,
    });

    expect(await repository.getAuthoringJob(second.workspaceId, jobId)).toBeNull();
    const leaseUntil = new Date(now.getTime() + 60_000);
    const claims = await Promise.all([
      repository.claimAuthoringJob(now, leaseUntil),
      repository.claimAuthoringJob(now, leaseUntil),
    ]);
    expect(claims.filter((claim) => claim?.id === jobId)).toHaveLength(1);
    expect(claims.filter((claim) => claim === null)).toHaveLength(1);

    const checkpointId = randomUUID();
    const output: AuthoringDraft = {
      schemaVersion: 1,
      sourceName: "Private source",
      sourceDigest: "c".repeat(64),
      checkpointSet: {
        title: "Generated review draft",
        description: "",
        category: "general",
        experiencePreset: { id: "focus", version: 1 },
        questions: [
          {
            id: checkpointId,
            type: "single_select",
            prompt: "Who may read a private source?",
            purpose: "diagnostic",
            confidence: "optional",
            delivery: "main",
            conceptKeys: ["privacy"],
            linkedRecheckQuestionId: null,
            choices: [
              { id: randomUUID(), label: "The owning workspace", isCorrect: true },
              { id: randomUUID(), label: "Every workspace", isCorrect: false },
            ],
            timeLimitSeconds: 30,
            basePoints: 1_000,
            explanation: "Workspace isolation protects the source.",
            mediaId: null,
            mediaAlt: null,
          },
        ],
      },
      citations: [
        { checkpointId, locator: "paragraph 1", excerpt: "owning workspace" },
        { checkpointId, locator: "paragraph 1", excerpt: "private source" },
      ],
      generatedAt: now.toISOString(),
      provider: "test-provider",
      model: "test-model",
    };
    expect(await repository.completeAuthoringJob(jobId, 0, output, now)).toBe(false);
    expect(await repository.completeAuthoringJob(jobId, 1, output, now)).toBe(true);
    expect(await repository.getAuthoringJob(first.workspaceId, jobId)).toMatchObject({
      status: "ready",
      attempts: 1,
      sourceText: null,
      sourceBlob: null,
      output: { schemaVersion: 1 },
    });
  });

  it("serializes concurrent authoring quota reservations", async () => {
    const owner = await creator("authoring-quota");
    const now = new Date();
    const since = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const results = await Promise.all(
      Array.from({ length: 6 }, (_, index) =>
        repository.createAuthoringJobWithinLimit(
          {
            id: randomUUID(),
            workspaceId: owner.workspaceId,
            createdBy: owner.userId,
            sourceType: "pasted_text",
            sourceName: `Concurrent source ${index}`,
            sourceMimeType: null,
            sourceText: "A private source that should consume exactly one quota reservation.",
            sourceBlob: null,
            sourceDigest: String(index).padStart(64, "0"),
            status: "pending",
            attempts: 0,
            appliedQuizId: null,
            availableAt: now,
            output: null,
            lastError: null,
            expiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60_000),
            createdAt: now,
            updatedAt: now,
          },
          since,
          2,
        ),
      ),
    );

    expect(results.filter(Boolean)).toHaveLength(2);
    expect(await repository.countAuthoringJobsSince(owner.workspaceId, since)).toBe(2);
  });

  it("enforces institution gates and consumes federated state once", async () => {
    const first = await creator("institution-first");
    const second = await creator("institution-second");
    expect(await repository.getInstitutionPolicy(first.workspaceId)).toMatchObject({
      contractStatus: "disabled",
      identityRequirement: "guest",
      capabilities: { oidc: false, lti: false },
      k12Enabled: false,
      updatedAt: null,
    });

    const updatedAt = new Date();
    await repository.updateInstitutionPolicy(
      {
        workspaceId: first.workspaceId,
        contractStatus: "pilot",
        identityRequirement: "optional",
        capabilities: {
          oidc: true,
          managedSso: false,
          scim: false,
          lti: false,
          nrps: false,
          ags: false,
          auditExports: true,
          residencyControls: true,
        },
        k12Enabled: false,
        updatedAt,
      },
      `institution-policy-${randomUUID()}`,
    );
    expect(await repository.getInstitutionPolicy(first.workspaceId)).toMatchObject({
      contractStatus: "pilot",
      identityRequirement: "optional",
      capabilities: { oidc: true },
    });
    expect(await repository.getInstitutionPolicy(second.workspaceId)).toMatchObject({
      contractStatus: "disabled",
      capabilities: { oidc: false },
    });

    await expect(
      repository.updateInstitutionPolicy(
        {
          workspaceId: first.workspaceId,
          contractStatus: "disabled",
          identityRequirement: "institution",
          capabilities: {
            oidc: true,
            managedSso: false,
            scim: false,
            lti: false,
            nrps: false,
            ags: false,
            auditExports: false,
            residencyControls: false,
          },
          k12Enabled: false,
          updatedAt: new Date(),
        },
        `institution-invalid-${randomUUID()}`,
      ),
    ).rejects.toThrow();

    const stateHash = "d".repeat(64);
    await repository.createFederatedAuthTransaction({
      id: randomUUID(),
      workspaceId: first.workspaceId,
      userId: first.userId,
      mode: "link",
      stateHash,
      codeVerifier: "v".repeat(43),
      nonce: "n".repeat(43),
      expiresAt: new Date(Date.now() + 60_000),
      createdAt: new Date(),
    });
    expect(await repository.consumeFederatedAuthTransaction(stateHash, new Date())).toMatchObject({
      workspaceId: first.workspaceId,
      mode: "link",
    });
    expect(await repository.consumeFederatedAuthTransaction(stateHash, new Date())).toBeNull();

    const identityId = randomUUID();
    const identity = {
      id: identityId,
      workspaceId: first.workspaceId,
      userId: first.userId,
      provider: "oidc" as const,
      issuer: "https://identity.example.edu",
      subject: `subject-${randomUUID()}`,
      emailHint: first.email,
      linkedAt: new Date(),
      lastUsedAt: null,
    };
    expect(await repository.linkExternalIdentity(identity)).toMatchObject({ id: identityId });
    expect(await repository.listExternalIdentities(second.workspaceId, first.userId)).toEqual([]);
    expect(
      await repository.getExternalIdentity(
        first.workspaceId,
        "oidc",
        identity.issuer,
        identity.subject,
      ),
    ).toMatchObject({ userId: first.userId });
    expect(
      await repository.linkExternalIdentity({
        ...identity,
        id: randomUUID(),
        userId: second.userId,
      }),
    ).toBeNull();
    expect(
      await repository.unlinkExternalIdentity(first.workspaceId, first.userId, identityId),
    ).toBe(true);

    const registrationId = randomUUID();
    expect(
      await repository.upsertLtiRegistration({
        id: registrationId,
        workspaceId: first.workspaceId,
        name: "PostgreSQL test LMS",
        issuer: "https://lms.example.edu",
        clientId: `client-${randomUUID()}`,
        deploymentId: `deployment-${randomUUID()}`,
        authorizationEndpoint: "https://lms.example.edu/oidc/auth",
        tokenEndpoint: "https://lms.example.edu/oauth/token",
        jwksUrl: "https://lms.example.edu/.well-known/jwks.json",
        deepLinkReturnOrigins: ["https://lms.example.edu"],
        status: "active",
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    ).toMatchObject({ id: registrationId, workspaceId: first.workspaceId });
    expect(await repository.listLtiRegistrations(second.workspaceId)).toEqual([]);

    const ltiStateHash = "e".repeat(64);
    await repository.createLtiLoginTransaction({
      id: randomUUID(),
      workspaceId: first.workspaceId,
      registrationId,
      stateHash: ltiStateHash,
      nonce: "n".repeat(43),
      targetLinkUri: "https://api.example.ca/v1/lti/launch",
      ltiMessageHint: "message-hint",
      expiresAt: new Date(Date.now() + 60_000),
      createdAt: new Date(),
    });
    expect(await repository.consumeLtiLoginTransaction(ltiStateHash, new Date())).toMatchObject({
      registrationId,
    });
    expect(await repository.consumeLtiLoginTransaction(ltiStateHash, new Date())).toBeNull();

    const quizId = randomUUID();
    const quizNow = new Date();
    await repository.createQuiz({
      id: quizId,
      workspaceId: first.workspaceId,
      title: "LTI selection",
      description: "Deep Linking persistence test",
      status: "draft",
      draft: {
        title: "LTI selection",
        description: "Deep Linking persistence test",
        questions: [],
      },
      currentVersionId: null,
      folderId: null,
      tags: [],
      createdAt: quizNow,
      updatedAt: quizNow,
    });
    const launchId = randomUUID();
    const linkTokenHash = "f".repeat(64);
    await repository.createLtiLaunch({
      id: launchId,
      workspaceId: first.workspaceId,
      registrationId,
      creatorUserId: null,
      subject: `lti-subject-${randomUUID()}`,
      messageType: "LtiDeepLinkingRequest",
      role: "instructor",
      targetLinkUri: "https://api.example.ca/v1/lti/launch",
      quizId: null,
      contextId: "course-1",
      resourceLinkId: null,
      deepLinkReturnUrl: "https://lms.example.edu/deep-links/return",
      deepLinkData: "opaque-data",
      linkTokenHash,
      responseJwt: null,
      completedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
      createdAt: new Date(),
    });
    expect(
      await repository.bindLtiLaunch(linkTokenHash, first.userId, randomUUID(), new Date()),
    ).toMatchObject({ id: launchId, creatorUserId: first.userId, linkTokenHash: null });
    expect(
      await repository.bindLtiLaunch(linkTokenHash, first.userId, randomUUID(), new Date()),
    ).toBeNull();
    expect(
      await repository.completeLtiDeepLink(
        first.workspaceId,
        launchId,
        first.userId,
        quizId,
        "signed-response",
        new Date(),
      ),
    ).toMatchObject({ quizId, responseJwt: "signed-response" });

    const retainedRequestId = `audit-retained-${randomUUID()}`;
    const expiredRequestId = `audit-expired-${randomUUID()}`;
    await repository.recordAudit({
      workspaceId: first.workspaceId,
      actorId: first.userId,
      action: "institution.audit.retained",
      targetType: "workspace",
      targetId: first.workspaceId,
      requestId: retainedRequestId,
    });
    await repository.recordAudit({
      workspaceId: first.workspaceId,
      actorId: first.userId,
      action: "institution.audit.expired",
      targetType: "workspace",
      targetId: first.workspaceId,
      requestId: expiredRequestId,
    });
    const adminPool = new Pool({ connectionString: adminUrl });
    try {
      await adminPool.query(
        "UPDATE audit_events SET created_at = now() - interval '366 days' WHERE request_id = $1",
        [expiredRequestId],
      );
    } finally {
      await adminPool.end();
    }
    expect(await repository.purgeAuditEvents(new Date(Date.now() - 365 * 24 * 60 * 60_000))).toBe(
      1,
    );
    expect(await repository.listAuditEvents(first.workspaceId, null, 10_000)).toEqual(
      expect.arrayContaining([expect.objectContaining({ requestId: retainedRequestId })]),
    );
    expect(
      (await repository.listAuditEvents(first.workspaceId, null, 10_000)).some(
        (event) => event.requestId === expiredRequestId,
      ),
    ).toBe(false);
  });
});
