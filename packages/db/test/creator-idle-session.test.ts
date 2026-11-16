import { randomUUID } from "node:crypto";
import { copyFile, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  MemoryRepository,
  PostgresRepository,
  runMigrations,
  type CreatorContext,
  type Repository,
} from "../src/index.js";
import { preparePostgresTestRuntime } from "./support/postgres-test-runtime.js";

const adminUrl = process.env.TEST_DATABASE_ADMIN_URL;
const runtimeUrl = process.env.TEST_DATABASE_URL;
const start = new Date("2030-01-01T00:00:00Z");
const after = (milliseconds: number) => new Date(start.getTime() + milliseconds);

async function createCreator(repository: Repository) {
  const tokenHash = randomUUID();
  await repository.createMagicToken({
    id: randomUUID(),
    tokenHash,
    email: `${randomUUID()}@example.test`,
    segment: "workplace",
    policyVersion: "test",
    expiresAt: new Date(Date.now() + 60_000),
    consumedAt: null,
  });
  return (await repository.consumeMagicToken(tokenHash, new Date()))!;
}

for (const backend of ["memory", "postgres"] as const) {
  describe.skipIf(backend === "postgres" && !(adminUrl && runtimeUrl))(
    `creator idle sessions ${backend}`,
    () => {
      let repository: Repository;
      let creator: CreatorContext;
      let administrator: PostgresRepository | undefined;
      let isolatedRuntimeUrl: string;
      const databaseName = `creator_idle_${randomUUID().replaceAll("-", "")}`;
      beforeAll(async () => {
        if (backend !== "postgres") return;
        await preparePostgresTestRuntime(adminUrl!, runtimeUrl!);
        const cluster = new PostgresRepository(adminUrl!);
        try {
          await cluster.pool.query(`CREATE DATABASE "${databaseName}"`);
        } finally {
          await cluster.close();
        }
        const admin = new URL(adminUrl!);
        const runtime = new URL(runtimeUrl!);
        admin.pathname = runtime.pathname = `/${databaseName}`;
        isolatedRuntimeUrl = runtime.toString();
        administrator = new PostgresRepository(admin.toString());
        await administrator.migrate();
      });
      afterAll(async () => {
        await administrator?.close();
        if (backend !== "postgres") return;
        const cluster = new PostgresRepository(adminUrl!);
        try {
          await cluster.pool.query(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
        } finally {
          await cluster.close();
        }
      });
      beforeEach(async () => {
        repository =
          backend === "memory"
            ? new MemoryRepository()
            : new PostgresRepository(isolatedRuntimeUrl);
        await repository.initialize();
        creator = await createCreator(repository);
      });
      afterEach(async () => {
        await repository?.close();
      });

      async function issue(absoluteExpiresAt = after(30 * 86_400_000)) {
        const tokenHash = randomUUID();
        const id = randomUUID();
        await repository.createCreatorSession({
          id,
          tokenHash,
          userId: creator.userId,
          activeWorkspaceId: creator.workspaceId,
          createdAt: start,
          expiresAt: absoluteExpiresAt,
        });
        return { tokenHash, id };
      }

      it("enforces the exact six-minute deadline through both account authentication paths without extending polling", async () => {
        const { tokenHash, id } = await issue();
        for (const offset of [0, 60_000, 299_999, 300_000, 359_999]) {
          expect(await repository.getCreatorBySession(tokenHash, after(offset))).not.toBeNull();
          expect(
            await repository.getUserPrincipalBySession(tokenHash, after(offset)),
          ).not.toBeNull();
        }
        expect(await repository.getCreatorSession(tokenHash, after(359_999))).toMatchObject({
          id,
          lastActivityAt: start,
          idleExpiresAt: after(360_000),
        });
        expect(await repository.getCreatorBySession(tokenHash, after(360_000))).toBeNull();
        expect(await repository.getUserPrincipalBySession(tokenHash, after(360_000))).toBeNull();
        expect(
          await repository.renewCreatorSession(tokenHash, after(360_000), "continue"),
        ).toBeNull();
        expect(
          await repository.setCreatorSessionWorkspace(
            tokenHash,
            creator.userId,
            creator.workspaceId,
            after(360_000),
          ),
        ).toBe(false);
      });

      it("requires explicit continue after the warning starts, while sharing session identity and retaining absolute expiry", async () => {
        const { tokenHash, id } = await issue();
        expect(
          await repository.renewCreatorSession(tokenHash, after(300_000), "activity"),
        ).toMatchObject({ lastActivityAt: start, idleExpiresAt: after(360_000) });
        expect(
          await repository.renewCreatorSession(tokenHash, after(330_000), "continue"),
        ).toMatchObject({
          id,
          lastActivityAt: after(330_000),
          idleExpiresAt: after(690_000),
          expiresAt: after(30 * 86_400_000),
        });
        // A second client sees the same persisted renewal; there is no tab-local login timer.
        expect(await repository.getCreatorSession(tokenHash, after(360_000))).toMatchObject({
          id,
          lastActivityAt: after(330_000),
        });
        const capped = await issue(after(400_000));
        expect(
          await repository.renewCreatorSession(capped.tokenHash, after(330_000), "continue"),
        ).toMatchObject({ idleExpiresAt: after(400_000), expiresAt: after(400_000) });
        expect(
          await repository.renewCreatorSession(capped.tokenHash, after(400_000), "continue"),
        ).toBeNull();
      });

      it("renews real activity before warning, but revocation remains final", async () => {
        const { tokenHash } = await issue();
        expect(
          await repository.renewCreatorSession(tokenHash, after(100_000), "activity"),
        ).toMatchObject({ lastActivityAt: after(100_000), idleExpiresAt: after(460_000) });
        await repository.revokeCreatorSession(tokenHash);
        expect(await repository.getCreatorBySession(tokenHash, after(101_000))).toBeNull();
        expect(
          await repository.renewCreatorSession(tokenHash, after(101_000), "continue"),
        ).toBeNull();
      });

      it("conditionally revokes only the session matching both credential hash and expected record ID", async () => {
        const original = await issue();
        const newer = await issue();
        await repository.revokeCreatorSession(newer.tokenHash, original.id);
        expect(await repository.getCreatorSession(original.tokenHash, start)).toMatchObject({
          id: original.id,
        });
        expect(await repository.getCreatorSession(newer.tokenHash, start)).toMatchObject({
          id: newer.id,
        });
        await repository.revokeCreatorSession(original.tokenHash, original.id);
        expect(await repository.getCreatorSession(original.tokenHash, start)).toBeNull();
        expect(
          await repository.renewCreatorSession(original.tokenHash, after(1), "continue"),
        ).toBeNull();
        expect(await repository.getCreatorSession(newer.tokenHash, start)).toMatchObject({
          id: newer.id,
        });
        // Existing callers retain unconditional revocation of the captured credential.
        await repository.revokeCreatorSession(newer.tokenHash);
        expect(await repository.getCreatorSession(newer.tokenHash, start)).toBeNull();
      });

      it("caps existing deadlines on reductions and never resurrects expired sessions on increases", async () => {
        const { tokenHash } = await issue();
        await repository.updateWorkspaceSessionPolicy(creator.workspaceId, {
          idleTimeoutMinutes: 1,
          warningDurationSeconds: 60,
        });
        expect(await repository.getWorkspaceSessionPolicy(creator.workspaceId)).toEqual({
          idleTimeoutMinutes: 1,
          warningDurationSeconds: 60,
        });
        expect(await repository.getCreatorSession(tokenHash, after(119_999))).toMatchObject({
          idleExpiresAt: after(120_000),
        });
        await repository.updateWorkspaceSessionPolicy(creator.workspaceId, {
          idleTimeoutMinutes: 10,
          warningDurationSeconds: 60,
        });
        expect(await repository.getCreatorSession(tokenHash, after(120_000))).toBeNull();
        expect(
          await repository.renewCreatorSession(tokenHash, after(120_000), "continue"),
        ).toBeNull();
        const fresh = await issue();
        expect(await repository.getCreatorSession(fresh.tokenHash, start)).toMatchObject({
          idleTimeoutMinutes: 10,
          idleExpiresAt: after(660_000),
        });
      });

      it("keeps the same activity clock and stricter deadline across workspace switching", async () => {
        const other = await createCreator(repository);
        const invitation = randomUUID();
        await repository.createWorkspaceInvitation({
          id: randomUUID(),
          workspaceId: other.workspaceId,
          email: creator.email,
          role: "editor",
          tokenHash: invitation,
          invitedBy: other.userId,
          expiresAt: new Date(Date.now() + 60_000),
          acceptedAt: null,
          revokedAt: null,
          createdAt: new Date(),
        });
        await repository.acceptWorkspaceInvitation(invitation, new Date(), "test");
        await repository.updateWorkspaceSessionPolicy(other.workspaceId, {
          idleTimeoutMinutes: 1,
          warningDurationSeconds: 60,
        });
        const { tokenHash, id } = await issue();
        expect(
          await repository.setCreatorSessionWorkspace(
            tokenHash,
            creator.userId,
            other.workspaceId,
            after(30_000),
          ),
        ).toBe(true);
        expect(await repository.getCreatorSession(tokenHash, after(30_000))).toMatchObject({
          id,
          activeWorkspaceId: other.workspaceId,
          lastActivityAt: start,
          idleExpiresAt: after(120_000),
        });
        expect(
          await repository.setCreatorSessionWorkspace(
            tokenHash,
            creator.userId,
            creator.workspaceId,
            after(60_000),
          ),
        ).toBe(true);
        expect(await repository.getCreatorSession(tokenHash, after(60_000))).toMatchObject({
          id,
          lastActivityAt: start,
          idleExpiresAt: after(120_000),
        });
        expect(
          await repository.setCreatorSessionWorkspace(
            tokenHash,
            creator.userId,
            other.workspaceId,
            after(120_000),
          ),
        ).toBe(false);
      });

      it("requires explicit selection after workspace deletion and caps the identity-only deadline", async () => {
        const other = await createCreator(repository);
        const invitation = randomUUID();
        await repository.createWorkspaceInvitation({
          id: randomUUID(),
          workspaceId: other.workspaceId,
          email: creator.email,
          role: "editor",
          tokenHash: invitation,
          invitedBy: other.userId,
          expiresAt: new Date(Date.now() + 60_000),
          acceptedAt: null,
          revokedAt: null,
          createdAt: new Date(),
        });
        await repository.acceptWorkspaceInvitation(invitation, new Date(), "test");
        await repository.updateWorkspaceSessionPolicy(creator.workspaceId, {
          idleTimeoutMinutes: 240,
          warningDurationSeconds: 60,
        });
        await repository.updateWorkspaceSessionPolicy(other.workspaceId, {
          idleTimeoutMinutes: 1,
          warningDurationSeconds: 60,
        });
        const selected = await issue();
        const dormant = await issue();
        if (repository instanceof MemoryRepository)
          repository.workspaces.delete(creator.workspaceId);
        else
          await administrator!.pool.query("DELETE FROM workspaces WHERE id = $1", [
            creator.workspaceId,
          ]);
        expect(await repository.getCreatorBySession(selected.tokenHash, after(30_000))).toBeNull();
        expect(
          await repository.getUserPrincipalBySession(selected.tokenHash, after(30_000)),
        ).not.toBeNull();
        expect(await repository.getCreatorSession(selected.tokenHash, after(30_000))).toMatchObject(
          {
            id: selected.id,
            activeWorkspaceId: null,
            idleTimeoutMinutes: 5,
            lastActivityAt: start,
            idleExpiresAt: after(360_000),
          },
        );
        expect(
          await repository.setCreatorSessionWorkspace(
            selected.tokenHash,
            creator.userId,
            other.workspaceId,
            after(60_000),
          ),
        ).toBe(true);
        expect(await repository.getCreatorSession(selected.tokenHash, after(60_000))).toMatchObject(
          {
            id: selected.id,
            activeWorkspaceId: other.workspaceId,
            lastActivityAt: start,
            idleExpiresAt: after(120_000),
          },
        );
        expect(await repository.getCreatorBySession(selected.tokenHash, after(120_000))).toBeNull();
        await repository.updateWorkspaceSessionPolicy(other.workspaceId, {
          idleTimeoutMinutes: 240,
          warningDurationSeconds: 60,
        });
        expect(
          await repository.getUserPrincipalBySession(dormant.tokenHash, after(360_000)),
        ).toBeNull();
        expect(await repository.getCreatorSession(dormant.tokenHash, after(360_000))).toBeNull();
        expect(
          await repository.renewCreatorSession(dormant.tokenHash, after(360_000), "continue"),
        ).toBeNull();
        expect(
          await repository.setCreatorSessionWorkspace(
            dormant.tokenHash,
            creator.userId,
            other.workspaceId,
            after(360_000),
          ),
        ).toBe(false);
      });

      it.skipIf(backend !== "postgres")(
        "serializes continue behind a policy reduction, so a waiting renewal cannot revive an expired session",
        async () => {
          const { tokenHash } = await issue();
          const client = await administrator!.pool.connect();
          try {
            await client.query("BEGIN");
            await client.query("UPDATE workspaces SET idle_timeout_minutes = 1 WHERE id = $1", [
              creator.workspaceId,
            ]);
            await client.query(
              "UPDATE creator_sessions SET idle_timeout_minutes = 1, idle_expires_at = last_activity_at + interval '2 minutes' WHERE token_hash = $1",
              [tokenHash],
            );
            const waiting = repository.renewCreatorSession(tokenHash, after(180_000), "continue");
            await expect
              .poll(async () =>
                Number(
                  (
                    await administrator!.pool.query(
                      "SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE 'SELECT cs.%'",
                    )
                  ).rows[0].count,
                ),
              )
              .toBeGreaterThan(0);
            await client.query("COMMIT");
            expect(await waiting).toBeNull();
            await repository.updateWorkspaceSessionPolicy(creator.workspaceId, {
              idleTimeoutMinutes: 240,
              warningDurationSeconds: 60,
            });
            expect(await repository.getCreatorSession(tokenHash, after(180_000))).toBeNull();
          } finally {
            await client.query("ROLLBACK");
            client.release();
          }
        },
      );

      it.skipIf(backend !== "postgres")(
        "rejects a continue that arrives before expiry but waits on the row lock until after the deadline",
        async () => {
          const tokenHash = randomUUID();
          const realNow = new Date();
          await repository.createCreatorSession({
            id: randomUUID(),
            userId: creator.userId,
            tokenHash,
            activeWorkspaceId: creator.workspaceId,
            createdAt: realNow,
            expiresAt: new Date(realNow.getTime() + 86_400_000),
          });
          const client = await administrator!.pool.connect();
          try {
            await client.query("BEGIN");
            await client.query(
              "UPDATE creator_sessions SET idle_expires_at = clock_timestamp() + interval '250 milliseconds' WHERE token_hash = $1",
              [tokenHash],
            );
            const waiting = repository.renewCreatorSession(tokenHash, new Date(), "continue");
            await expect
              .poll(async () =>
                Number(
                  (
                    await administrator!.pool.query(
                      "SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE 'SELECT cs.%'",
                    )
                  ).rows[0].count,
                ),
              )
              .toBeGreaterThan(0);
            await client.query("SELECT pg_sleep(0.35)");
            await client.query("COMMIT");
            expect(await waiting).toBeNull();
            expect(await repository.getCreatorBySession(tokenHash, new Date())).toBeNull();
          } finally {
            await client.query("ROLLBACK");
            client.release();
          }
        },
      );

      it.skipIf(backend !== "postgres")(
        "upgrades legacy logins under a normal owner with forced RLS, preserving expiry and revocation",
        async () => {
          const upgradeDatabase = `${databaseName}_upgrade`;
          const temporaryMigrations = await mkdtemp(join(tmpdir(), "creator-idle-migrations-"));
          const cluster = new PostgresRepository(adminUrl!);
          let upgrade: PostgresRepository | undefined;
          let migrationOwner: PostgresRepository | undefined;
          try {
            await cluster.pool.query(`CREATE DATABASE "${upgradeDatabase}"`);
            const url = new URL(adminUrl!);
            url.pathname = `/${upgradeDatabase}`;
            upgrade = new PostgresRepository(url.toString());
            const source = fileURLToPath(new URL("../migrations", import.meta.url));
            for (const name of await readdir(source)) {
              if (/^\d+_.*\.sql$/.test(name) && Number(name.split("_")[0]) < 110)
                await copyFile(join(source, name), join(temporaryMigrations, name));
            }
            await runMigrations(upgrade.pool, temporaryMigrations);
            const userId = randomUUID();
            const workspaceId = randomUUID();
            const liveToken = randomUUID();
            const expiredToken = randomUUID();
            const revokedToken = randomUUID();
            const absolute = new Date(Date.now() + 30 * 86_400_000);
            const revokedAt = new Date(Date.now() - 86_400_000);
            await upgrade.pool.query("INSERT INTO users (id, email) VALUES ($1, $2)", [
              userId,
              `${userId}@example.test`,
            ]);
            await upgrade.pool.query(
              "INSERT INTO workspaces (id, name, segment, owner_id) VALUES ($1, 'Legacy', 'workplace', $2)",
              [workspaceId, userId],
            );
            await upgrade.pool.query(
              "INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, 'owner')",
              [workspaceId, userId],
            );
            for (const [token, expiresAt, revoked] of [
              [liveToken, absolute, null],
              [expiredToken, revokedAt, null],
              [revokedToken, absolute, revokedAt],
            ] as const)
              await upgrade.pool.query(
                "INSERT INTO creator_sessions (id, user_id, token_hash, expires_at, revoked_at, created_at) VALUES ($1, $2, $3, $4, $5, $6)",
                [
                  randomUUID(),
                  userId,
                  token,
                  expiresAt,
                  revoked,
                  new Date(Date.now() - 10 * 86_400_000),
                ],
              );
            // A normal deployment migration owner cannot bypass forced RLS.
            // Superuser-only upgrade coverage would hide silently skipped backfills.
            const ownerUrl = new URL(runtimeUrl!);
            const ownerRole = decodeURIComponent(ownerUrl.username);
            const quotedOwner = `"${ownerRole.replaceAll('"', '""')}"`;
            ownerUrl.pathname = `/${upgradeDatabase}`;
            await upgrade.pool.query(`GRANT USAGE, CREATE ON SCHEMA public TO ${quotedOwner}`);
            for (const table of ["workspaces", "creator_sessions", "_openround_migrations"])
              await upgrade.pool.query(`ALTER TABLE ${table} OWNER TO ${quotedOwner}`);
            migrationOwner = new PostgresRepository(ownerUrl.toString());
            const privileges = await migrationOwner.pool.query(
              `SELECT role.rolsuper, role.rolbypassrls, relation.relrowsecurity,
                 relation.relforcerowsecurity, pg_get_userbyid(relation.relowner) = current_user AS owns_table
               FROM pg_roles role, pg_class relation
               WHERE role.rolname = current_user AND relation.oid = 'creator_sessions'::regclass`,
            );
            expect(privileges.rows[0]).toEqual({
              rolsuper: false,
              rolbypassrls: false,
              relrowsecurity: true,
              relforcerowsecurity: true,
              owns_table: true,
            });
            expect(
              (await migrationOwner.pool.query("SELECT id FROM creator_sessions")).rows,
            ).toEqual([]);
            // Compare database timestamps in their own clock domain; the test
            // runner and a containerized PostgreSQL clock can differ slightly.
            const beforeMigration = (
              await upgrade.pool.query("SELECT clock_timestamp() AS checked_at")
            ).rows[0].checked_at as Date;
            await migrationOwner.migrate();
            const afterMigration = (
              await upgrade.pool.query("SELECT clock_timestamp() AS checked_at")
            ).rows[0].checked_at as Date;
            const records = await upgrade.pool.query(
              "SELECT * FROM creator_sessions WHERE user_id = $1",
              [userId],
            );
            const live = records.rows.find((row) => row.token_hash === liveToken)!;
            expect(live.last_activity_at.getTime()).toBeGreaterThanOrEqual(
              beforeMigration.getTime(),
            );
            expect(live.last_activity_at.getTime()).toBeLessThanOrEqual(afterMigration.getTime());
            expect(live.idle_expires_at.getTime() - live.last_activity_at.getTime()).toBe(360_000);
            expect(live.expires_at).toEqual(absolute);
            expect(live.active_workspace_id).toBe(workspaceId);
            expect(records.rows.find((row) => row.token_hash === revokedToken)!.revoked_at).toEqual(
              revokedAt,
            );
            expect(await upgrade.getCreatorSession(liveToken, new Date())).not.toBeNull();
            expect(await upgrade.getCreatorSession(expiredToken, new Date())).toBeNull();
            expect(await upgrade.getCreatorSession(revokedToken, new Date())).toBeNull();
            await migrationOwner.updateWorkspaceSessionPolicy(workspaceId, {
              idleTimeoutMinutes: 1,
              warningDurationSeconds: 60,
            });
            const reduced = await upgrade.pool.query(
              "SELECT last_activity_at, idle_expires_at FROM creator_sessions WHERE token_hash = $1",
              [liveToken],
            );
            expect(
              reduced.rows[0].idle_expires_at.getTime() -
                reduced.rows[0].last_activity_at.getTime(),
            ).toBe(120_000);
            // The local system flag must not leak onto a pooled connection afterward.
            expect(
              (await migrationOwner.pool.query("SELECT id FROM creator_sessions")).rows,
            ).toEqual([]);
          } finally {
            await migrationOwner?.close();
            await upgrade?.close();
            await cluster.pool.query(`DROP DATABASE IF EXISTS "${upgradeDatabase}" WITH (FORCE)`);
            await cluster.close();
            await rm(temporaryMigrations, { recursive: true, force: true });
          }
        },
      );

      it.skipIf(backend !== "postgres")(
        "keeps policy columns behind existing forced RLS for the runtime login",
        async () => {
          const runtime = repository as PostgresRepository;
          const result = await runtime.pool.query(
            "SELECT idle_timeout_minutes FROM workspaces WHERE id = $1",
            [creator.workspaceId],
          );
          expect(result.rows).toEqual([]);
          const updated = await runtime.pool.query(
            "UPDATE workspaces SET idle_timeout_minutes = 240 WHERE id = $1 RETURNING id",
            [creator.workspaceId],
          );
          expect(updated.rowCount).toBe(0);
        },
      );
    },
  );
}
