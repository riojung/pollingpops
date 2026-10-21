import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { RecoveryPackCardReferenceSchema } from "@openround/contracts";
import { discoverMigrations } from "../src/migrations.js";
import {
  presentationRecoveryPackIntervention,
  presentationRecoveryPackUuidCases,
} from "./support/presentation-session-conformance.js";

const temporaryDirectories: string[] = [];

async function temporaryDirectory() {
  const directory = await mkdtemp(join(tmpdir(), "openround-migrations-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("database migration discovery", () => {
  it("adds verified-email PIN credentials with forced system-only isolation and bounded attempts", async () => {
    const migration = (
      await discoverMigrations(join(dirname(fileURLToPath(import.meta.url)), "../migrations"))
    ).find(({ version }) => version === 75)!;
    expect(migration.name).toBe("verified_email_pin_auth");
    expect(migration.sql).toContain("email_verified_at = created_at");
    expect(migration.sql).toContain("WHERE deleted_at IS NULL AND email_verified_at IS NULL");
    expect(migration.sql).toContain("attempts BETWEEN 0 AND 5");
    expect(migration.sql).toContain("REFERENCES users(id) ON DELETE CASCADE");
    expect(migration.sql).toContain("workspace_id uuid");
    expect(migration.sql).toContain("REFERENCES workspaces(id) ON DELETE SET NULL");
    expect(migration.sql).toContain("FORCE ROW LEVEL SECURITY");
    expect(migration.sql).toContain("current_setting('app.system_access', true) = 'on'");
    expect(migration.sql).toContain(
      "GRANT SELECT, INSERT, UPDATE, DELETE ON auth_email_pin_challenges",
    );
    expect(migration.sql).not.toContain("DISABLE ROW LEVEL SECURITY");
  });
  it("adds private operator credential and durable login throttle record kinds without changing isolation", async () => {
    const migration = (
      await discoverMigrations(join(dirname(fileURLToPath(import.meta.url)), "../migrations"))
    ).find(({ version }) => version === 73)!;
    expect(migration.name).toBe("operator_password_credentials");
    for (const kind of [
      "operator_credential",
      "operator_login_throttle",
      "operator",
      "feature_policy",
      "audit",
    ])
      expect(migration.sql).toContain(`'${kind}'`);
    expect(migration.sql).toContain("platform_operator_credential_operator_uq");
    expect(migration.sql).not.toMatch(
      /INSERT INTO|UPDATE |DELETE |TRUNCATE |DISABLE ROW LEVEL SECURITY/i,
    );
  });
  it("allows persisted feature policies without replacing existing platform data or isolation", async () => {
    const migration = (
      await discoverMigrations(join(dirname(fileURLToPath(import.meta.url)), "../migrations"))
    ).find(({ version }) => version === 72)!;
    expect(migration.name).toBe("feature_policy");
    expect(migration.sql).toContain("ADD CONSTRAINT platform_records_kind_check");
    for (const kind of ["operator", "audit", "command", "stripe_transaction", "feature_policy"])
      expect(migration.sql).toContain(`'${kind}'`);
    expect(migration.sql).not.toMatch(
      /INSERT INTO|UPDATE |DELETE |TRUNCATE |DISABLE ROW LEVEL SECURITY/i,
    );
  });
  it("adds nullable password verifiers without changing existing room content or access", async () => {
    const migration = (
      await discoverMigrations(join(dirname(fileURLToPath(import.meta.url)), "../migrations"))
    ).find(({ version }) => version === 71)!;
    expect(migration.name).toBe("room_passwords");
    for (const table of ["game_sessions", "presentation_live_sessions", "survey_feedback_rooms"])
      expect(migration.sql).toContain(
        `ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS join_password_hash text`,
      );
    expect(migration.sql).not.toMatch(
      /NOT NULL|DEFAULT|UPDATE |DELETE |DISABLE ROW LEVEL SECURITY/i,
    );
  });
  it("adds nested content-scoped folders with serialized ancestry checks and preserved artifact assignments", async () => {
    const migration = (
      await discoverMigrations(join(dirname(fileURLToPath(import.meta.url)), "../migrations"))
    ).find(({ version }) => version === 66)!;
    expect(migration.name).toBe("scoped_nested_folders");
    expect(migration.sql).toContain("pg_advisory_xact_lock");
    expect(migration.sql).toContain("WITH RECURSIVE ancestors");
    expect(migration.sql).toContain("folders_sibling_name_uq");
    expect(migration.sql).toContain("jsonb_set(artifact.data, '{folderId}'");
    expect(migration.sql).not.toMatch(
      /UPDATE (quiz_versions|presentation_versions|survey_versions)|DELETE FROM (quizzes|presentations|surveys)|DISABLE ROW LEVEL SECURITY/i,
    );
  });

  it("expands Survey v2 document checks without rewriting accepted data or immutable snapshots", async () => {
    const migrations = await discoverMigrations(
      join(dirname(fileURLToPath(import.meta.url)), "../migrations"),
    );
    const migration = migrations.find(({ version }) => version === 63)!;
    expect(migration.name).toBe("survey_multiselection");
    for (const table of ["surveys", "survey_versions", "survey_feedback_rooms", "survey_guests"])
      expect(migration.sql).toContain(`ALTER TABLE ${table} ADD CONSTRAINT ${table}_data_check`);
    expect(migration.sql.match(/IN \(1, 2\)/g)).toHaveLength(4);
    expect(migration.sql).not.toMatch(/UPDATE |DELETE |TRUNCATE |DISABLE ROW LEVEL SECURITY/i);
  });
  it("adds scoped Q&A with composite cascades, durable rate limits and forced isolation", async () => {
    const migrations = await discoverMigrations(
      join(dirname(fileURLToPath(import.meta.url)), "../migrations"),
    );
    const migration = migrations.find(({ version }) => version === 60)!;
    expect(migration.name).toBe("scoped_qna");
    for (const table of [
      "scoped_qna_settings",
      "scoped_qna_questions",
      "scoped_qna_votes",
      "scoped_qna_bans",
      "scoped_qna_receipts",
      "scoped_qna_rate_limits",
      "scoped_qna_audit",
    ])
      expect(migration.sql).toContain(`CREATE TABLE IF NOT EXISTS ${table}`);
    expect(migration.sql).toContain("FORCE ROW LEVEL SECURITY");
    expect(migration.sql).toContain("PRIMARY KEY (scope_id, actor_id, idempotency_key)");
    expect(migration.sql).toContain(
      "REFERENCES presentation_live_participants(workspace_id, session_id, id) ON DELETE CASCADE",
    );
    expect(migration.sql).toContain("REVOKE UPDATE ON scoped_qna_receipts, scoped_qna_audit");
    expect(migration.sql).not.toContain("ALTER TABLE game_sessions");
    expect(migration.sql).not.toContain("ALTER TABLE live_room_codes");
  });
  it("adds scoped Presentation storage without changing Round keys or the room-code registry", async () => {
    const directory = join(dirname(fileURLToPath(import.meta.url)), "../migrations");
    const migration = (await discoverMigrations(directory)).find(({ version }) => version === 59)!;
    expect(migration.name).toBe("audience_scope_foundation");
    for (const table of ["audience_scopes", "scoped_audience_outbox"]) {
      expect(migration.sql).toContain(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY`);
    }
    expect(migration.sql).toContain(
      "REFERENCES presentation_live_sessions(workspace_id, id) ON DELETE CASCADE",
    );
    expect(migration.sql).toContain(
      "REFERENCES audience_scopes(workspace_id, id) ON DELETE CASCADE",
    );
    expect(migration.sql).toContain("UNIQUE (scope_id, audience_seq)");
    expect(migration.sql).toContain("audience_scopes_identity_immutable");
    expect(migration.sql).not.toContain("ALTER TABLE game_sessions");
    expect(migration.sql).not.toContain("ALTER TABLE live_room_codes");
  });
  it("adds bounded sequence state and durable fences to the existing forced-RLS followup parents", async () => {
    const directory = join(dirname(fileURLToPath(import.meta.url)), "../migrations");
    const migration = (await discoverMigrations(directory)).find(({ version }) => version === 57)!;
    expect(migration.name).toBe("recovery_pack_sequence_practice");
    expect(migration.sql).toContain("recovery_pack_sequence jsonb");
    expect(migration.sql).toContain("intervention_index integer");
    expect(migration.sql).toContain("advance_receipts jsonb NOT NULL DEFAULT '{}'::jsonb");
    expect(migration.sql).toContain("submitted_version integer");
    expect(migration.sql).toContain("entry_count > 256");
    expect(migration.sql).toContain(
      "NEW.recovery_pack_sequence IS DISTINCT FROM OLD.recovery_pack_sequence",
    );
    expect(migration.sql).toContain(
      "openround_recovery_pack_question_body(copied) = openround_recovery_pack_question_body(original)",
    );
    expect(migration.sql).toContain("version.id = pack.current_version_id");
    expect(migration.sql).not.toContain("CREATE TABLE");
    expect(migration.sql).not.toContain("DISABLE ROW LEVEL SECURITY");
    expect(migration.sql).not.toContain("REFERENCES recovery_pack");
  });
  it("expands frozen Pack practice on existing forced-RLS followup and media tables", async () => {
    const migrationsDirectory = join(dirname(fileURLToPath(import.meta.url)), "../migrations");
    const migration = (await discoverMigrations(migrationsDirectory)).find(
      ({ version }) => version === 56,
    )!;
    expect(migration.name).toBe("recovery_pack_practice");
    expect(migration.sql).toContain("ADD COLUMN IF NOT EXISTS recovery_pack_source jsonb");
    expect(migration.sql).toContain("ON followups (workspace_id, creation_mutation_id)");
    expect(migration.sql).toContain(
      "NEW.creation_request_hash IS DISTINCT FROM OLD.creation_request_hash",
    );
    expect(migration.sql).toContain("openround_remove_owned_media_references('followup')");
    expect(migration.sql).toContain("version.id = pack.current_version_id");
    expect(migration.sql).not.toContain("CREATE TABLE");
    expect(migration.sql).not.toContain("DISABLE ROW LEVEL SECURITY");
    expect(migration.sql).not.toContain("REFERENCES recovery_pack");
  });
  it("adds frozen Presentation live card attribution and nullable command hashes to existing scoped tables", async () => {
    const migrationsDirectory = join(dirname(fileURLToPath(import.meta.url)), "../migrations");
    const migrations = await discoverMigrations(migrationsDirectory);
    const migration = migrations.find(({ version }) => version === 55);
    expect(migration?.name).toBe("recovery_pack_presentation_live_cards");
    expect(migration?.sql).toContain("recovery_pack_cards_enabled boolean NOT NULL DEFAULT false");
    expect(migration?.sql).toContain("ALTER TABLE presentation_session_timeline");
    expect(migration?.sql).toContain("ADD COLUMN IF NOT EXISTS recovery_pack_intervention jsonb");
    expect(migration?.sql).toContain("ADD COLUMN IF NOT EXISTS request_hash char(64)");
    expect(migration?.sql).toContain("request_hash IS NULL OR request_hash ~ '^[0-9a-f]{64}$'");
    expect(migration?.sql).toContain("event_type = 'intervention.presented'");
    expect(migration?.sql).toContain(
      "jsonb_typeof(value -> 'reference' -> 'contentHash') = 'string'",
    );
    expect(migration?.sql).toContain("::numeric <= 9007199254740991");
    expect(migration?.sql).toContain(
      "NEW.recovery_pack_cards_enabled IS DISTINCT FROM OLD.recovery_pack_cards_enabled",
    );
    expect(migration?.sql).toContain("BEFORE UPDATE OF phase, status");
    expect(migration?.sql).not.toContain("CREATE TABLE");
    expect(migration?.sql).not.toContain("DISABLE ROW LEVEL SECURITY");
    expect(migration?.sql).not.toContain("REFERENCES recovery_pack");
    const uuidChecks = [
      ...(migration?.sql ?? "").matchAll(
        /'reference' ->> '(insertionId|packId|packVersionId|cardId)' ~\s*'([^']+)'/g,
      ),
    ];
    expect(uuidChecks).toHaveLength(4);
    for (const [, field, expression] of uuidChecks) {
      const pattern = new RegExp(expression!);
      for (const [accepted, cases] of [
        [true, presentationRecoveryPackUuidCases.accepted],
        [false, presentationRecoveryPackUuidCases.rejected],
      ] as const) {
        for (const value of cases) {
          expect(pattern.test(value), `${field}: ${value}`).toBe(accepted);
          expect(
            RecoveryPackCardReferenceSchema.safeParse({
              ...presentationRecoveryPackIntervention().reference,
              [field!]: value,
            }).success,
            `${field}: ${value}`,
          ).toBe(accepted);
        }
      }
    }
  });
  it("stores Presentation Pack Undo metadata on existing tenant-scoped mutation receipts", async () => {
    const migrationsDirectory = join(dirname(fileURLToPath(import.meta.url)), "../migrations");
    const migrations = await discoverMigrations(migrationsDirectory);
    const migration = migrations.find(({ version }) => version === 54);
    expect(migration?.name).toBe("recovery_pack_presentation_undo");
    expect(migration?.sql).toContain("ALTER TABLE presentation_draft_mutations");
    expect(migration?.sql).toContain(
      "ADD COLUMN IF NOT EXISTS recovery_pack_update_source_revision bigint",
    );
    expect(migration?.sql).toContain("recovery_pack_update_source_revision IS NULL");
    expect(migration?.sql).toContain("recovery_pack_update_source_revision >= 0");
    expect(migration?.sql).toContain("recovery_pack_update_source_revision = expected_revision");
    expect(migration?.sql).toContain("resulting_revision = expected_revision + 1");
    expect(migration?.sql).toContain("presentation_draft_mutations_recovery_pack_undo_idx");
    expect(migration?.sql).not.toContain("CREATE TABLE");
    expect(migration?.sql).not.toContain("DISABLE ROW LEVEL SECURITY");
  });

  it("adds Presentation Pack baseline media edges without rewriting immutable documents", async () => {
    const migrationsDirectory = join(dirname(fileURLToPath(import.meta.url)), "../migrations");
    const migrations = await discoverMigrations(migrationsDirectory);
    const migration = migrations.find(({ version }) => version === 53);
    expect(migration?.name).toBe("recovery_pack_presentation_media");
    expect(migration?.sql).toContain("CREATE OR REPLACE FUNCTION openround_presentation_media_ids");
    expect(migration?.sql).toContain("insertion->'originalContent'");
    expect(migration?.sql).toContain("insertion->'updateBaseline'->'content'");
    expect(migration?.sql).toContain("set_config('app.system_access', 'on', true)");
    expect(migration?.sql).toContain("FROM presentations");
    expect(migration?.sql).toContain("FROM presentation_versions");
    expect(migration?.sql).toContain("FROM presentation_draft_history");
    expect(migration?.sql).toContain("asset.workspace_id = documents.workspace_id");
    expect(migration?.sql).toContain("asset.scan_status <> 'deleting'");
    expect(migration?.sql).toContain("ON CONFLICT DO NOTHING");
    expect(migration?.sql).not.toContain("UPDATE presentation");
    expect(migration?.sql).not.toContain("CREATE TABLE");
  });

  it("orders versioned migrations and computes stable checksums", async () => {
    const directory = await temporaryDirectory();
    await writeFile(join(directory, "010_later.sql"), "SELECT 10;\n");
    await writeFile(join(directory, "002_earlier.sql"), "SELECT 2;\n");
    await writeFile(join(directory, "README.md"), "ignored\n");

    const migrations = await discoverMigrations(directory);

    expect(migrations.map(({ version, name }) => ({ version, name }))).toEqual([
      { version: 2, name: "earlier" },
      { version: 10, name: "later" },
    ]);
    expect(migrations[0]?.checksum).toMatch(/^[a-f0-9]{64}$/);
    expect(migrations[0]?.checksum).not.toBe(migrations[1]?.checksum);
  });

  it("rejects duplicate versions and an empty directory", async () => {
    const duplicateDirectory = await temporaryDirectory();
    await writeFile(join(duplicateDirectory, "002_first.sql"), "SELECT 1;\n");
    await writeFile(join(duplicateDirectory, "002_second.sql"), "SELECT 2;\n");
    await expect(discoverMigrations(duplicateDirectory)).rejects.toThrow(
      "Duplicate database migration version 2",
    );

    const emptyDirectory = await temporaryDirectory();
    await expect(discoverMigrations(emptyDirectory)).rejects.toThrow("No database migrations");
  });

  it("locks legacy room writers before validating and backfilling the shared registry", async () => {
    const migrationsDirectory = join(dirname(fileURLToPath(import.meta.url)), "../migrations");
    const migrations = await discoverMigrations(migrationsDirectory);
    const registryMigration = migrations.find(({ version }) => version === 34);
    expect(registryMigration).toBeDefined();

    const sql = registryMigration!.sql;
    const writerLock = sql.indexOf(
      "LOCK TABLE game_sessions, presentation_live_sessions IN SHARE ROW EXCLUSIVE MODE",
    );
    const overlapValidation = sql.indexOf(
      "JOIN presentation_live_sessions AS presentation_session",
    );
    const roundBackfill = sql.indexOf("INSERT INTO live_room_codes");
    const triggerInstallation = sql.indexOf("CREATE TRIGGER game_sessions_register_room_code");

    expect(writerLock).toBeGreaterThan(-1);
    expect(writerLock).toBeLessThan(overlapValidation);
    expect(writerLock).toBeLessThan(roundBackfill);
    expect(roundBackfill).toBeLessThan(triggerInstallation);
  });

  it("commits Presentation report enqueueing before the idempotent backfill", async () => {
    const migrationsDirectory = join(dirname(fileURLToPath(import.meta.url)), "../migrations");
    const migrations = await discoverMigrations(migrationsDirectory);
    const triggerMigration = migrations.find(({ version }) => version === 36);
    const backfillMigration = migrations.find(({ version }) => version === 37);
    expect(triggerMigration?.sql).toContain("CREATE TRIGGER presentation_session_enqueue_report");
    expect(triggerMigration?.sql).toContain("lease_token uuid");
    expect(triggerMigration?.sql).not.toContain(
      "LOCK TABLE presentation_live_sessions IN SHARE ROW EXCLUSIVE MODE",
    );
    expect(backfillMigration?.sql).toContain("INSERT INTO presentation_session_reports");
    expect(backfillMigration?.sql).toContain("ON CONFLICT (session_id) DO NOTHING");
  });

  it("adds a commit-visible Presentation fence without breaking prior-image writes", async () => {
    const migrationsDirectory = join(dirname(fileURLToPath(import.meta.url)), "../migrations");
    const migrations = await discoverMigrations(migrationsDirectory);
    const migration = migrations.find(({ version }) => version === 38);

    expect(migration?.sql).toContain("presentation_live_participants_session_fence_idx");
    expect(migration?.sql).toContain("app.presentation_concurrent_response_writes");
    expect(migration?.sql).toContain("CREATE TRIGGER presentation_participant_bump_event_seq");
    expect(migration?.sql).toContain("CREATE TRIGGER presentation_response_bump_event_seq");
    expect(migration?.sql).not.toContain("CREATE SEQUENCE");
  });

  it("aligns the stored Presentation fence while preserving imported sequence offsets", async () => {
    const migrationsDirectory = join(dirname(fileURLToPath(import.meta.url)), "../migrations");
    const migrations = await discoverMigrations(migrationsDirectory);
    const expansion = migrations.find(({ version }) => version === 39);
    const backfill = migrations.find(({ version }) => version === 40);

    expect(expansion?.sql).toContain("ADD COLUMN IF NOT EXISTS event_seq_offset");
    expect(expansion?.sql).toContain("CHECK (event_seq_offset >= 0) NOT VALID");
    expect(backfill?.sql).toContain("LOCK TABLE presentation_live_sessions IN EXCLUSIVE MODE");
    expect(backfill?.sql).toContain("fence.stored_event_seq - fence.aggregate_event_seq");
    expect(backfill?.sql).toContain(
      "VALIDATE CONSTRAINT presentation_live_sessions_event_seq_offset_check",
    );
    expect(backfill?.sql).toContain("event_seq_offset + (target_sequence - effective_sequence)");
  });

  it("adds idempotent media finalization and deletion fences", async () => {
    const migrationsDirectory = join(dirname(fileURLToPath(import.meta.url)), "../migrations");
    const migrations = await discoverMigrations(migrationsDirectory);
    const migration = migrations.find(({ version }) => version === 41);

    expect(migration?.sql).toContain("ALTER TABLE workspaces");
    expect(migration?.sql).toContain("ADD COLUMN IF NOT EXISTS deletion_started_at");
    expect(migration?.sql).toContain(
      "DROP CONSTRAINT IF EXISTS media_assets_finalization_lease_check",
    );
    expect(migration?.sql).toContain(
      "DROP CONSTRAINT IF EXISTS media_assets_deletion_tombstone_check",
    );
    expect(migration?.sql).toContain("'pending', 'finalizing', 'clean', 'rejected', 'deleting'");
    expect(migration?.sql).toContain("media_assets_finalization_lease_check");
    expect(migration?.sql).toContain("media_assets_deletion_tombstone_check");
  });

  it("retains a forced-RLS workspace object cleanup job past account cascade", async () => {
    const migrationsDirectory = join(dirname(fileURLToPath(import.meta.url)), "../migrations");
    const migrations = await discoverMigrations(migrationsDirectory);
    const migration = migrations.find(({ version }) => version === 42);

    expect(migration?.sql).toContain("CREATE TABLE IF NOT EXISTS workspace_media_deletion_jobs");
    expect(migration?.sql).not.toContain("REFERENCES workspaces");
    expect(migration?.sql).toContain("interval '11 minutes'");
    expect(migration?.sql).toContain("ENABLE ROW LEVEL SECURITY");
    expect(migration?.sql).toContain("FORCE ROW LEVEL SECURITY");
    expect(migration?.sql).toContain("GRANT SELECT, INSERT, DELETE");
  });

  it("stores Question Health dismissals as bounded, content-addressed workspace data", async () => {
    const migrationsDirectory = join(dirname(fileURLToPath(import.meta.url)), "../migrations");
    const migrations = await discoverMigrations(migrationsDirectory);
    const migration = migrations.find(({ version }) => version === 45);
    expect(migration?.name).toBe("question_health_dismissals");
    expect(migration?.sql).toContain("FOREIGN KEY (workspace_id, quiz_id)");
    expect(migration?.sql).toContain(
      "ALTER TABLE question_health_dismissals FORCE ROW LEVEL SECURITY",
    );
    expect(migration?.sql).toContain(
      "'false_positive', 'intentional_choice', 'will_address_later'",
    );
    expect(migration?.sql).toContain("content_hash char(64) NOT NULL CHECK");
    const dropPolicy = migration!.sql.indexOf(
      "DROP POLICY IF EXISTS question_health_dismissals_workspace_isolation",
    );
    const createPolicy = migration!.sql.indexOf(
      "CREATE POLICY question_health_dismissals_workspace_isolation",
    );
    expect(dropPolicy).toBeGreaterThan(-1);
    expect(createPolicy).toBeGreaterThan(dropPolicy);
  });

  it("stores Question Health application provenance with forced tenant RLS and source cascade", async () => {
    const migrationsDirectory = join(dirname(fileURLToPath(import.meta.url)), "../migrations");
    const migrations = await discoverMigrations(migrationsDirectory);
    const migration = migrations.find(({ version }) => version === 46);
    expect(migration?.name).toBe("question_health_applications");
    expect(migration?.sql).toContain("FOREIGN KEY (workspace_id, quiz_id)");
    expect(migration?.sql).toContain("REFERENCES quizzes(workspace_id, id) ON DELETE CASCADE");
    expect(migration?.sql).toContain(
      "ALTER TABLE question_health_applications FORCE ROW LEVEL SECURITY",
    );
    expect(migration?.sql).toContain("question_health_applications_workspace_isolation");
    expect(migration?.sql).toContain("request_hash char(64)");
  });
});
