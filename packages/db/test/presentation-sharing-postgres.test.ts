import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { PostgresRepository, assertRestrictedRuntimeDatabasePrincipal } from "../src/index.js";
import { preparePostgresTestRuntime } from "./support/postgres-test-runtime.js";
import {
  expectPresentationSharingConformance,
  presentationSharingFixture,
  expectPresentationShareExpiryConformance,
} from "./support/presentation-sharing-conformance.js";
const adminUrl = process.env.TEST_DATABASE_ADMIN_URL,
  runtimeUrl = process.env.TEST_DATABASE_URL;
describe.skipIf(!(adminUrl && runtimeUrl))("private Presentation sharing PostgreSQL", () => {
  const database = `presentation_sharing_${randomUUID().replaceAll("-", "")}`;
  let created = false,
    repository: PostgresRepository,
    administrator: PostgresRepository;
  beforeAll(async () => {
    await preparePostgresTestRuntime(adminUrl!, runtimeUrl!);
    const cluster = new PostgresRepository(adminUrl!);
    try {
      await cluster.pool.query(`CREATE DATABASE "${database}"`);
      created = true;
    } finally {
      await cluster.close();
    }
    const admin = new URL(adminUrl!),
      runtime = new URL(runtimeUrl!);
    admin.pathname = runtime.pathname = `/${database}`;
    administrator = new PostgresRepository(admin.toString());
    await administrator.migrate();
    await administrator.migrate();
    expect(
      (await administrator.pool.query("SELECT name FROM _openround_migrations WHERE version=97"))
        .rows,
    ).toEqual([{ name: "presentation_sharing" }]);
    repository = new PostgresRepository(runtime.toString());
    await repository.initialize();
    expect(
      assertRestrictedRuntimeDatabasePrincipal(await repository.inspectRuntimeDatabasePrincipal()),
    ).toMatchObject({
      superuser: false,
      bypassRls: false,
      createRole: false,
      createDatabase: false,
    });
    expect(
      (
        await administrator.pool.query(
          "SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE oid='presentation_shares'::regclass",
        )
      ).rows[0],
    ).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
  });
  afterAll(async () => {
    await repository?.close();
    await administrator?.close();
    if (created) {
      const cluster = new PostgresRepository(adminUrl!);
      try {
        await cluster.pool.query(`DROP DATABASE "${database}" WITH(FORCE)`);
      } finally {
        await cluster.close();
      }
    }
  });
  it("persists the shared pinned-version, role, receipt, concurrency and revocation contract", async () => {
    await expectPresentationSharingConformance(repository);
  });
  it("classifies unaccepted expired intents without replacing accepted expired or later-pruned receipts", async () => {
    await expectPresentationShareExpiryConformance(repository);
  });
  it("erases a departing collaborator's capability while retaining another owner's frozen deck", async () => {
    const owner = await presentationSharingFixture(repository, "sharing-owner"),
      collaborator = await presentationSharingFixture(repository, "sharing-collaborator");
    await administrator.pool.query(
      "INSERT INTO workspace_members(workspace_id,user_id,role) VALUES($1,$2,'editor')",
      [owner.actor.workspaceId, collaborator.actor.userId],
    );
    const input = { ...owner.request(), actorId: collaborator.actor.userId };
    const { share } = await owner.shares.createShare(input);
    expect(
      await owner.shares.getPublicShareAccess(share.id, input.tokenHash, owner.now),
    ).not.toBeNull();
    const exported = await repository.exportAccount(owner.actor.userId);
    expect(exported.presentationShares).toEqual([
      expect.objectContaining({ id: share.id, actorId: collaborator.actor.userId }),
    ]);
    expect(JSON.stringify(exported.presentationShares)).not.toMatch(
      /token_hash|tokenHash|intent_hash|intentHash/,
    );
    await repository.deleteAccount(collaborator.actor.userId);
    expect(
      (
        await administrator.pool.query(
          "SELECT deleted_at IS NOT NULL AS deleted FROM users WHERE id=$1",
          [collaborator.actor.userId],
        )
      ).rows,
    ).toEqual([{ deleted: true }]);
    expect(
      (
        await administrator.pool.query(
          "SELECT count(*)::integer AS count FROM presentation_shares WHERE id=$1",
          [share.id],
        )
      ).rows[0].count,
    ).toBe(0);
    expect(
      await owner.shares.getPublicShareAccess(share.id, input.tokenHash, new Date()),
    ).toBeNull();
    expect(
      await owner.presentations.getPresentation(owner.actor.workspaceId, owner.presentation.id),
    ).not.toBeNull();
    expect(
      (await owner.presentations.getPresentationVersion(owner.actor.workspaceId, owner.version.id))
        ?.contentHash,
    ).toBe(owner.version.contentHash);
  });
  it("guards raw capability immutability, expiry, tenant versions and deletion without exposing hashes in account metadata", async () => {
    const f = await presentationSharingFixture(repository, "sharing-raw"),
      input = f.request(),
      { share } = await f.shares.createShare(input);
    expect(await f.shares.getPublicShareAccess(share.id, input.tokenHash, f.now)).toMatchObject({
      id: share.id,
      versionId: f.version.id,
    });
    expect(
      (await repository.pool.query("SELECT count(*)::integer AS count FROM presentation_shares"))
        .rows[0].count,
    ).toBe(0);
    const exported = await repository.exportAccount(f.actor.userId);
    expect(exported.presentationShares).toHaveLength(1);
    expect(JSON.stringify(exported.presentationShares)).not.toMatch(
      /token_hash|tokenHash|intent_hash|intentHash/,
    );
    const client = await repository.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.workspace_id',$1,true)", [f.actor.workspaceId]);
      const reject = async (sql: string, values: unknown[], code = "23514") => {
        await client.query("SAVEPOINT sharing_guard");
        await expect(client.query(sql, values)).rejects.toMatchObject({ code });
        await client.query("ROLLBACK TO SAVEPOINT sharing_guard");
      };
      await reject(
        "UPDATE presentation_shares SET token_hash=$1 WHERE id=$2",
        ["f".repeat(64), share.id],
        "42501",
      );
      await client.query("UPDATE presentation_shares SET revoked_at=$1 WHERE id=$2", [
        f.now,
        share.id,
      ]);
      await reject("UPDATE presentation_shares SET revoked_at=NULL WHERE id=$1", [share.id]);
      await reject("DELETE FROM presentation_shares WHERE id=$1", [share.id]);
      const insert =
        "INSERT INTO presentation_shares(id,workspace_id,presentation_id,version_id,actor_id,request_id,intent_hash,token_hash,created_at,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)";
      const values = [
        randomUUID(),
        f.actor.workspaceId,
        f.presentation.id,
        f.version.id,
        f.actor.userId,
        randomUUID(),
        "a".repeat(64),
        "b".repeat(64),
        f.now,
        new Date(f.now.getTime() + 31 * 86_400_000),
      ];
      await reject(insert, values);
      await reject(
        insert,
        [...values.slice(0, 3), randomUUID(), ...values.slice(4, 9), new Date(input.expiresAt)],
        "23503",
      );
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }
    await administrator.pool.query(
      "UPDATE workspace_members SET role='viewer' WHERE workspace_id=$1 AND user_id=$2",
      [f.actor.workspaceId, f.actor.userId],
    );
    expect(await f.shares.getPublicShareAccess(share.id, input.tokenHash, f.now)).toBeNull();
    await administrator.pool.query(
      "UPDATE workspace_members SET role='owner' WHERE workspace_id=$1 AND user_id=$2",
      [f.actor.workspaceId, f.actor.userId],
    );
    await f.presentations.archivePresentation(f.actor.workspaceId, f.presentation.id, true);
    expect(await f.presentations.deletePresentation(f.actor.workspaceId, f.presentation.id)).toBe(
      "deleted",
    );
    expect(await f.shares.getPublicShareAccess(share.id, input.tokenHash, f.now)).toBeNull();
  });
});
