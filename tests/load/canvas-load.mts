/** Opt-in repository capacity smoke; this file is not part of the default test suite.
 *
 * Memory: pnpm exec tsx tests/load/canvas-load.mts
 * PostgreSQL: CANVAS_LOAD_BACKEND=postgres CANVAS_LOAD_DATABASE_ADMIN_URL=... \
 *   CANVAS_LOAD_DATABASE_URL=... pnpm exec tsx tests/load/canvas-load.mts
 *
 * PostgreSQL creates, migrates, and drops a uniquely named disposable database.
 * Supply an existing restricted runtime login; this harness never changes cluster roles.
 * Measurements cover repository acknowledgements and reads, not peer/browser delivery.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  MemoryRepository,
  PostgresRepository,
  createCanvasBoardRepository,
  createPlatformRepository,
  type CreatorContext,
  type Repository,
} from "../../packages/db/src/index.ts";
import {
  CanvasBoardCreateSchema,
  CanvasObjectCreateSchema,
  type CanvasBoardMutation,
} from "../../packages/contracts/src/index.ts";

const backend = process.env.CANVAS_LOAD_BACKEND ?? "memory";
assert.ok(
  backend === "memory" || backend === "postgres",
  "CANVAS_LOAD_BACKEND must be memory or postgres",
);
function integer(name: string, fallback: number, minimum: number, maximum: number) {
  const value = Number(process.env[name] ?? fallback);
  assert.ok(
    Number.isInteger(value) && value >= minimum && value <= maximum,
    `${name} must be ${minimum}–${maximum}`,
  );
  return value;
}
const objectCount = integer("CANVAS_LOAD_OBJECTS", 500, 20, 500);
const editorCount = integer("CANVAS_LOAD_EDITORS", 20, 2, 20);
const updatesPerEditor = integer("CANVAS_LOAD_UPDATES", 10, 1, 50);
const databaseName = `canvas_load_${randomUUID().replaceAll("-", "")}`;

function distribution(samples: number[]) {
  const ordered = [...samples].sort((a, b) => a - b);
  const at = (quantile: number) =>
    Math.round(ordered[Math.max(0, Math.ceil(ordered.length * quantile) - 1)]! * 100) / 100;
  return { count: ordered.length, p50: at(0.5), p95: at(0.95), max: at(1) };
}
async function creator(repository: Repository, label: string) {
  const tokenHash = randomUUID(),
    now = new Date();
  await repository.createMagicToken({
    id: randomUUID(),
    email: `canvas-load-${label}-${randomUUID()}@example.test`,
    tokenHash,
    segment: "workplace",
    policyVersion: "load-test",
    expiresAt: new Date(now.getTime() + 60_000),
    consumedAt: null,
  });
  const actor = await repository.consumeMagicToken(tokenHash, now);
  assert.ok(actor, "Fixture principal must be a verified creator");
  return actor;
}
async function denied(work: () => Promise<unknown>) {
  await assert.rejects(
    work,
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      ["NOT_FOUND", "FORBIDDEN", "UNAUTHORIZED"].includes(String(error.code)),
  );
}

async function main() {
  const started = performance.now();
  let admin: PostgresRepository | undefined;
  let repository: Repository | undefined;
  let durableReader: PostgresRepository | undefined;
  let runtimeDatabaseUrl: string | undefined;
  let createdDatabase = false;
  let result: Record<string, unknown> | undefined;
  try {
    if (backend === "postgres") {
      const adminInput = process.env.CANVAS_LOAD_DATABASE_ADMIN_URL;
      const runtimeInput = process.env.CANVAS_LOAD_DATABASE_URL;
      assert.ok(
        adminInput && runtimeInput,
        "PostgreSQL smoke requires CANVAS_LOAD_DATABASE_ADMIN_URL and CANVAS_LOAD_DATABASE_URL",
      );
      const adminUrl = new URL(adminInput),
        runtimeUrl = new URL(runtimeInput);
      assert.equal(
        runtimeUrl.host,
        adminUrl.host,
        "Admin and restricted runtime must use the same test cluster",
      );
      assert.notEqual(
        runtimeUrl.username,
        adminUrl.username,
        "Use a separate restricted runtime login",
      );
      admin = new PostgresRepository(adminInput);
      await admin.pool.query(`CREATE DATABASE "${databaseName}"`);
      createdDatabase = true;
      adminUrl.pathname = `/${databaseName}`;
      runtimeUrl.pathname = `/${databaseName}`;
      runtimeDatabaseUrl = runtimeUrl.toString();
      const migration = new PostgresRepository(adminUrl.toString());
      try {
        await migration.migrate();
      } finally {
        await migration.close();
      }
      repository = new PostgresRepository(runtimeDatabaseUrl);
      const principal = await repository.pool.query<{ rolsuper: boolean; rolbypassrls: boolean }>(
        "SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user",
      );
      assert.deepEqual(
        principal.rows[0],
        { rolsuper: false, rolbypassrls: false },
        "Capacity smoke must exercise restricted RLS",
      );
    } else repository = new MemoryRepository();
    await repository.initialize();
    const platform = createPlatformRepository(repository);
    const actors: CreatorContext[] = [];
    for (let index = 0; index < editorCount; index++)
      actors.push(await creator(repository, `editor-${index}`));
    const outsider = await creator(repository, "uninvited");
    const owner = actors[0]!;
    const organization = await platform.createOrganization({
      name: "Canvas capacity smoke",
      actorId: owner.userId,
      accountType: "organization",
      licenseUnit: "user",
    });
    await platform.applySubscriptionSnapshot({
      organizationId: organization.id,
      customerId: null,
      subscriptionId: null,
      status: "active",
      licenseQuantity: editorCount,
      licenseUnit: "user",
      offerId: null,
      paidThrough: null,
      graceUntil: null,
      legacyPlan: "team",
    });
    for (const actor of actors.slice(1)) {
      await platform.setOrganizationMember({
        organizationId: organization.id,
        actorId: owner.userId,
        userId: actor.userId,
        role: "member",
      });
      await platform.assignOrganizationUserLicense(
        organization.id,
        owner.userId,
        actor.userId,
        true,
      );
    }
    const licenses = await platform.getOrganizationUserLicenses(organization.id, owner.userId);
    assert.equal(licenses.assignments.length, editorCount);
    assert.equal(
      new Set(licenses.assignments.map((assignment) => assignment.workspaceId)).size,
      editorCount,
    );
    const workspaceId = licenses.assignments.find(
      (assignment) => assignment.userId === owner.userId,
    )!.workspaceId;
    const canvases = createCanvasBoardRepository(repository);
    let board = await canvases.create(
      owner,
      CanvasBoardCreateSchema.parse({
        workspaceId,
        title: "500-object capacity smoke",
        boardType: "team",
        operationId: randomUUID(),
      }),
    );
    for (const actor of actors.slice(1)) {
      const invitation = await canvases.invite(owner, board.id, {
        email: actor.email,
        role: "editor",
        operationId: randomUUID(),
      });
      await canvases.acceptInvitation(actor, invitation.id);
    }
    const objectIds = Array.from({ length: objectCount }, () => randomUUID());
    const seedSamples: number[] = [];
    for (let offset = 0; offset < objectCount; offset += 50) {
      const seedStarted = performance.now();
      const result = await canvases.command(owner, board.id, {
        schemaVersion: 1,
        operationId: randomUUID(),
        command: {
          type: "batch",
          operations: objectIds.slice(offset, offset + 50).map((id, index) => ({
            type: "create",
            object: CanvasObjectCreateSchema.parse({
              id,
              type: "sticky",
              text: `Seed object ${offset + index}`,
              x: ((offset + index) % 25) * 240,
              y: Math.floor((offset + index) / 25) * 180,
              width: 220,
              height: 160,
            }),
          })),
        },
      });
      seedSamples.push(performance.now() - seedStarted);
      board = result.board;
    }
    assert.equal(board.objects.length, objectCount);
    await denied(() => canvases.get(outsider, board.id));
    const setupMs = performance.now() - started;

    const commitSamples: number[] = [];
    const receipts = new Set<string>();
    let acceptedRetry:
      { actor: CreatorContext; mutation: CanvasBoardMutation; receipt: unknown } | undefined;
    const writesStarted = performance.now();
    await Promise.all(
      actors.map(async (actor, index) => {
        for (let step = 1; step <= updatesPerEditor; step++) {
          const mutation: CanvasBoardMutation = {
            schemaVersion: 1,
            operationId: randomUUID(),
            command: {
              type: "batch",
              operations: [
                {
                  type: "update",
                  id: objectIds[index]!,
                  expectedVersion: step,
                  patch: { text: `Editor ${index}, update ${step}`, x: index * 240 + step },
                },
              ],
            },
          };
          const commitStarted = performance.now();
          const result = await canvases.command(actor, board.id, mutation);
          commitSamples.push(performance.now() - commitStarted);
          receipts.add(`${actor.userId}:${result.receipt.operationId}`);
          assert.equal(result.receipt.operationId, mutation.operationId);
          if (index === 1 && step === 1)
            acceptedRetry = { actor, mutation, receipt: result.receipt };
        }
      }),
    );
    const writesElapsedMs = performance.now() - writesStarted;
    assert.equal(commitSamples.length, editorCount * updatesPerEditor);
    assert.equal(
      receipts.size,
      commitSamples.length,
      "Each logical update receives one durable acknowledgement",
    );
    assert.ok(acceptedRetry);
    const retryStarted = performance.now();
    const retry = await canvases.command(acceptedRetry.actor, board.id, acceptedRetry.mutation);
    const retryMs = performance.now() - retryStarted;
    assert.deepEqual(
      retry.receipt,
      acceptedRetry.receipt,
      "An exact retry must preserve its original receipt",
    );

    const readSamples: number[] = [];
    await Promise.all(
      actors.map(async (actor) => {
        const readStarted = performance.now();
        const snapshot = await canvases.get(actor, board.id);
        readSamples.push(performance.now() - readStarted);
        assert.equal(snapshot.objects.length, objectCount);
        assert.equal(
          snapshot.workspaceId,
          workspaceId,
          "Sharing must retain the originating workspace",
        );
        for (let index = 0; index < editorCount; index++) {
          const object = snapshot.objects.find((candidate) => candidate.id === objectIds[index]);
          assert.ok(object);
          assert.equal(
            object.version,
            updatesPerEditor + 1,
            "Independent updates must never disappear or replay twice",
          );
          assert.equal(object.text, `Editor ${index}, update ${updatesPerEditor}`);
        }
        for (const object of snapshot.objects.filter(
          (candidate) => !objectIds.slice(0, editorCount).includes(candidate.id),
        ))
          assert.equal(object.version, 1, "Concurrent actors must not alter unrelated objects");
      }),
    );

    if (runtimeDatabaseUrl) {
      durableReader = new PostgresRepository(runtimeDatabaseUrl);
      await durableReader.initialize();
      const persisted = await createCanvasBoardRepository(durableReader).get(owner, board.id);
      assert.equal(
        persisted.objects.length,
        objectCount,
        "A separate database connection must read committed state",
      );
      assert.equal(
        persisted.objects.find((object) => object.id === objectIds[1])?.version,
        updatesPerEditor + 1,
      );
    }
    const revoked = actors.at(-1)!;
    await canvases.revokeGrant(owner, board.id, revoked.userId);
    const deniedMutation: CanvasBoardMutation = {
      schemaVersion: 1,
      operationId: randomUUID(),
      command: {
        type: "batch",
        operations: [
          {
            type: "update",
            id: objectIds[0]!,
            expectedVersion: updatesPerEditor + 1,
            patch: { text: "Unauthorized overwrite" },
          },
        ],
      },
    };
    await denied(() => canvases.command(revoked, board.id, deniedMutation));
    await denied(() =>
      canvases.command(outsider, board.id, { ...deniedMutation, operationId: randomUUID() }),
    );
    const final = await canvases.get(owner, board.id);
    assert.equal(
      final.objects.find((object) => object.id === objectIds[0])?.text,
      `Editor 0, update ${updatesPerEditor}`,
    );
    assert.equal(final.objects.length, objectCount);
    const notifications = await canvases.listOutbox(0, 500);
    assert.ok(
      notifications.events.every((event) =>
        Object.keys(event).every((key) =>
          ["eventId", "boardId", "canvasSeq", "type", "createdAt", "cursor"].includes(key),
        ),
      ),
      "Outbox must contain only invalidation metadata",
    );

    result = {
      backend,
      disposableDatabase: backend === "postgres" ? databaseName : null,
      objects: objectCount,
      licensedEditors: editorCount,
      updatesPerEditor,
      committedUpdates: commitSamples.length,
      setupMs: Math.round(setupMs),
      writesElapsedMs: Math.round(writesElapsedMs),
      repositoryLatencyMs: {
        seedBatch: distribution(seedSamples),
        commitAcknowledgement: distribution(commitSamples),
        concurrentSnapshotRead: distribution(readSamples),
        exactRetry: Math.round(retryMs * 100) / 100,
      },
      runtimePoolMaximum: backend === "postgres" ? 15 : null,
      correctness: {
        allIndependentUpdatesRetained: true,
        unrelatedObjectsPreserved: true,
        exactRetryDeduplicated: true,
        uninvitedDenied: true,
        revokedDenied: true,
        separateConnectionDurabilityChecked: backend === "postgres",
        metadataOnlyOutbox: true,
      },
      measurementScope:
        "Repository commit acknowledgements and snapshot reads only. No peer-delivery, network-RTT, browser-rendering, or 500ms end-to-end claim.",
      totalMs: Math.round(performance.now() - started),
    };
  } finally {
    try {
      await durableReader?.close();
      await repository?.close();
      if (admin && createdDatabase) {
        // pg Pool.end() can resolve before the server observes the last idle socket's
        // close. Wait for those sockets, then drop without forcibly killing them.
        for (let attempt = 0; attempt < 80; attempt++) {
          const sessions = await admin.pool.query<{ count: number }>(
            "SELECT count(*)::integer AS count FROM pg_stat_activity WHERE datname=$1",
            [databaseName],
          );
          if (sessions.rows[0]!.count === 0) break;
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
        await admin.pool.query(`DROP DATABASE "${databaseName}"`);
      }
    } finally {
      await admin?.close();
    }
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : "Canvas load smoke failed"}\n`);
  process.exitCode = 1;
});
