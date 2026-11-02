import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { IdeaBoardCreateSchema } from "@openround/contracts";
import { MemoryRepository } from "../src/memory.js";
import { PostgresRepository } from "../src/postgres.js";
import { createIdeaBoardRepository } from "../src/idea-boards.js";
import type { Repository } from "../src/types.js";
import { preparePostgresTestRuntime } from "./support/postgres-test-runtime.js";
import {
  boardInvitationRecipientId,
  createBoardInvitationRepository,
  type BoardInvitationScope,
} from "../src/board-invitations.js";

async function createFixture(repository: Repository) {
  await repository.initialize();
  const now = new Date();
  const tokenHash = randomUUID();
  await repository.createMagicToken({
    id: randomUUID(),
    tokenHash,
    email: `${randomUUID()}@example.test`,
    segment: "workplace",
    policyVersion: "test",
    expiresAt: new Date(now.getTime() + 60_000),
    consumedAt: null,
  });
  const actor = (await repository.consumeMagicToken(tokenHash, now))!;
  const resourceId = randomUUID();
  const expiry = new Date(now.getTime() + 86_400_000).toISOString();
  await createIdeaBoardRepository(repository).create(
    actor.workspaceId,
    resourceId,
    IdeaBoardCreateSchema.parse({ title: "Invitation workshop" }),
    randomUUID(),
    {
      participantLimit: 10,
      closesAt: new Date(now.getTime() + 3_600_000).toISOString(),
      expiresAt: expiry,
    },
    now,
  );
  const scope: BoardInvitationScope = {
    workspaceId: actor.workspaceId,
    actorId: actor.userId,
    resourceKind: "idea_board",
    resourceId,
  };
  const deliveries = createBoardInvitationRepository(repository);
  const input = { operationId: randomUUID(), emails: ["invitee@example.test"], expiresAt: expiry };
  const row = await deliveries.prepare(scope, input, now);
  return { repository, scope, deliveries, input, row, now };
}

const adminUrl = process.env.TEST_DATABASE_ADMIN_URL;
const runtimeUrl = process.env.TEST_DATABASE_URL;
for (const backend of ["memory", "postgres"] as const)
  describe.skipIf(backend === "postgres" && !(adminUrl && runtimeUrl))(
    `durable board invitation delivery ${backend}`,
    () => {
      const ownedDatabase = `board_invitation_${randomUUID().replaceAll("-", "")}`;
      let connection = runtimeUrl;
      const repositories: Repository[] = [];
      beforeAll(async () => {
        if (backend !== "postgres") return;
        await preparePostgresTestRuntime(adminUrl!, runtimeUrl!);
        const cluster = new PostgresRepository(adminUrl!);
        try {
          await cluster.pool.query(`CREATE DATABASE "${ownedDatabase}"`);
        } finally {
          await cluster.close();
        }
        const admin = new URL(adminUrl!);
        const runtime = new URL(runtimeUrl!);
        admin.pathname = `/${ownedDatabase}`;
        runtime.pathname = `/${ownedDatabase}`;
        connection = runtime.toString();
        const migration = new PostgresRepository(admin.toString());
        try {
          await migration.migrate();
        } finally {
          await migration.close();
        }
      });
      afterEach(async () => {
        await Promise.all(repositories.splice(0).map((repository) => repository.close()));
      });
      afterAll(async () => {
        if (backend !== "postgres") return;
        const cluster = new PostgresRepository(adminUrl!);
        try {
          await cluster.pool.query(`DROP DATABASE IF EXISTS "${ownedDatabase}" WITH(FORCE)`);
        } finally {
          await cluster.close();
        }
      });
      const fixture = () => {
        const repository =
          backend === "memory" ? new MemoryRepository() : new PostgresRepository(connection!);
        repositories.push(repository);
        return createFixture(repository);
      };
      it("reuses canonical requests across repository instances and rejects changed recipients or roles", async () => {
        const f = await fixture();
        const second = createBoardInvitationRepository(f.repository);
        expect(
          (
            await second.prepare(
              f.scope,
              { ...f.input, emails: [" INVITEE@EXAMPLE.TEST ", "invitee@example.test"] },
              f.now,
            )
          ).batchId,
        ).toBe(f.row.batchId);
        await expect(
          second.prepare(f.scope, { ...f.input, emails: ["other@example.test"] }, f.now),
        ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
        await expect(
          second.prepare(f.scope, { ...f.input, role: "editor" }, f.now),
        ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
        expect(boardInvitationRecipientId(f.row.batchId, f.input.emails[0]!)).toBe(
          boardInvitationRecipientId(f.row.batchId, "INVITEE@example.test"),
        );
      });
      it("claims each recipient once under concurrency and never reclaims a sent delivery", async () => {
        const f = await fixture();
        const claims = await Promise.all([
          f.deliveries.claim(f.scope, f.row.batchId, f.input.emails[0]!, f.now),
          f.deliveries.claim(f.scope, f.row.batchId, f.input.emails[0]!, f.now),
        ]);
        expect(claims.filter(Boolean)).toHaveLength(1);
        const claim = claims.find(Boolean)!;
        expect(
          await f.deliveries.finish(
            f.scope,
            f.row.batchId,
            claim.email,
            "wrong-token",
            { status: "sent" },
            f.now,
          ),
        ).toBe(false);
        expect(
          await f.deliveries.finish(
            f.scope,
            f.row.batchId,
            claim.email,
            claim.claimToken,
            { status: "sent" },
            f.now,
          ),
        ).toBe(true);
        expect(await f.deliveries.claim(f.scope, f.row.batchId, claim.email, f.now)).toBeNull();
        expect(await f.deliveries.response(f.scope, f.row.batchId, f.now)).toMatchObject({
          complete: true,
          results: [{ status: "sent" }],
        });
      });
      it("turns expired claims into terminal unknown and rejects their late acknowledgements", async () => {
        const f = await fixture();
        const claim = (await f.deliveries.claim(
          f.scope,
          f.row.batchId,
          f.input.emails[0]!,
          f.now,
          100,
        ))!;
        const later = new Date(f.now.getTime() + 100);
        expect(await f.deliveries.response(f.scope, f.row.batchId, later)).toMatchObject({
          complete: true,
          results: [{ status: "unknown", errorCode: "DELIVERY_UNKNOWN" }],
        });
        expect(await f.deliveries.claim(f.scope, f.row.batchId, claim.email, later)).toBeNull();
        expect(
          await f.deliveries.finish(
            f.scope,
            f.row.batchId,
            claim.email,
            claim.claimToken,
            { status: "sent" },
            later,
          ),
        ).toBe(false);
      });
      it("can defer a fenced claim only before SMTP, and keeps unknown terminal", async () => {
        const f = await fixture();
        const claim = (await f.deliveries.claim(
          f.scope,
          f.row.batchId,
          f.input.emails[0]!,
          f.now,
        ))!;
        expect(await f.deliveries.defer(f.scope, f.row.batchId, claim.email, "wrong", f.now)).toBe(
          false,
        );
        expect(
          await f.deliveries.defer(f.scope, f.row.batchId, claim.email, claim.claimToken, f.now),
        ).toBe(true);
        const next = (await f.deliveries.claim(f.scope, f.row.batchId, claim.email, f.now))!;
        await f.deliveries.finish(
          f.scope,
          f.row.batchId,
          next.email,
          next.claimToken,
          { status: "unknown", errorCode: "DELIVERY_UNKNOWN" },
          f.now,
        );
        expect(
          await f.deliveries.defer(f.scope, f.row.batchId, next.email, next.claimToken, f.now),
        ).toBe(false);
      });
      it("isolates actor/workspace/resource reads and cleans private receipts during account deletion and expiry", async () => {
        const f = await fixture();
        for (const patch of [
          { actorId: randomUUID() },
          { workspaceId: randomUUID() },
          { resourceId: randomUUID() },
          { resourceKind: "canvas" as const },
        ])
          await expect(
            f.deliveries.response({ ...f.scope, ...patch }, f.row.batchId, f.now),
          ).rejects.toMatchObject({ code: "NOT_FOUND" });
        const exported = await f.repository.exportAccount(f.scope.actorId);
        expect(exported.boardInvitationDeliveries).toHaveLength(1);
        expect(JSON.stringify(exported.boardInvitationDeliveries)).not.toContain(f.row.fingerprint);
        await f.repository.deleteAccount(f.scope.actorId);
        await expect(f.deliveries.response(f.scope, f.row.batchId, f.now)).rejects.toMatchObject({
          code: "NOT_FOUND",
        });
        const g = await fixture();
        expect(await g.deliveries.purgeExpired(new Date(g.input.expiresAt))).toContain(
          g.row.batchId,
        );
        await expect(g.deliveries.response(g.scope, g.row.batchId, g.now)).rejects.toMatchObject({
          code: "NOT_FOUND",
        });
      });
      it("serializes absent-row operation collisions without overwriting the accepted recipient snapshot", async () => {
        const f = await fixture();
        const second = createBoardInvitationRepository(f.repository);
        const operationId = randomUUID();
        const accepted = await Promise.allSettled([
          f.deliveries.prepare(
            f.scope,
            { ...f.input, operationId, emails: ["a@example.test"] },
            f.now,
          ),
          second.prepare(
            {
              resourceId: f.scope.resourceId,
              resourceKind: f.scope.resourceKind,
              actorId: f.scope.actorId,
              workspaceId: f.scope.workspaceId,
            },
            { ...f.input, operationId, emails: ["b@example.test"] },
            f.now,
          ),
        ]);
        expect(accepted.filter((result) => result.status === "fulfilled")).toHaveLength(1);
        const rejected = accepted.find(
          (result) => result.status === "rejected",
        ) as PromiseRejectedResult;
        expect(rejected.reason).toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
      });
      it.skipIf(backend !== "memory")(
        "omits expired private deliveries from export before sweeping",
        async () => {
          const f = await fixture();
          const clock = vi.spyOn(Date, "now").mockReturnValue(Date.parse(f.input.expiresAt));
          try {
            expect(
              (await f.repository.exportAccount(f.scope.actorId)).boardInvitationDeliveries,
            ).toEqual([]);
          } finally {
            clock.mockRestore();
          }
        },
      );
      it.skipIf(backend !== "memory")(
        "clears canvas delivery receipts through the memory resource lifecycle hook",
        async () => {
          const f = await fixture();
          const scope = { ...f.scope, resourceKind: "canvas" as const };
          const row = await f.deliveries.prepare(scope, f.input, f.now);
          const claim = (await f.deliveries.claim(scope, row.batchId, f.input.emails[0]!, f.now))!;
          (f.repository as MemoryRepository).deleteCanvasBoardMetadata(scope.resourceId);
          await expect(
            f.deliveries.finish(
              scope,
              row.batchId,
              claim.email,
              claim.claimToken,
              { status: "sent" },
              f.now,
            ),
          ).rejects.toMatchObject({ code: "NOT_FOUND" });
          await expect(
            f.deliveries.prepare(scope, { ...f.input, operationId: randomUUID() }, f.now),
          ).rejects.toMatchObject({ code: "NOT_FOUND" });
        },
      );
      it("removes resource receipts on deletion and refuses a late acknowledgement or new receipt for that resource", async () => {
        const f = await fixture();
        const claim = (await f.deliveries.claim(
          f.scope,
          f.row.batchId,
          f.input.emails[0]!,
          f.now,
        ))!;
        await createIdeaBoardRepository(f.repository).delete(
          f.scope.workspaceId,
          f.scope.resourceId,
        );
        await expect(
          f.deliveries.finish(
            f.scope,
            f.row.batchId,
            claim.email,
            claim.claimToken,
            { status: "sent" },
            f.now,
          ),
        ).rejects.toMatchObject({ code: "NOT_FOUND" });
        await expect(
          f.deliveries.prepare(f.scope, { ...f.input, operationId: randomUUID() }, f.now),
        ).rejects.toBeDefined();
      });
      it.skipIf(backend !== "postgres")(
        "requires full actor/resource RLS scope even with legacy system-access enabled",
        async () => {
          const f = await fixture();
          const client = await (f.repository as PostgresRepository).pool.connect();
          try {
            await client.query("BEGIN");
            await client.query("SELECT set_config('app.system_access','on',true)");
            await client.query("SELECT set_config('app.workspace_id',$1,true)", [
              f.scope.workspaceId,
            ]);
            expect(
              (await client.query("SELECT id FROM board_invitation_deliveries")).rowCount,
            ).toBe(0);
            await client.query(
              "SELECT set_config('app.board_invitation_actor',$1,true),set_config('app.board_invitation_kind',$2,true),set_config('app.board_invitation_resource',$3,true)",
              [f.scope.actorId, f.scope.resourceKind, f.scope.resourceId],
            );
            expect(
              (
                await client.query("SELECT id FROM board_invitation_deliveries WHERE id=$1", [
                  f.row.batchId,
                ])
              ).rowCount,
            ).toBe(1);
            await client.query("SELECT set_config('app.board_invitation_actor',$1,true)", [
              randomUUID(),
            ]);
            expect(
              (
                await client.query("UPDATE board_invitation_deliveries SET data=data WHERE id=$1", [
                  f.row.batchId,
                ])
              ).rowCount,
            ).toBe(0);
            await client.query("ROLLBACK");
          } finally {
            client.release();
          }
        },
      );
    },
  );
