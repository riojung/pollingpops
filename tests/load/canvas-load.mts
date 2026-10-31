/** Opt-in, bounded repository evidence. See docs/canvas-capacity-evidence.md.
 * Memory: pnpm exec tsx tests/load/canvas-load.mts
 * PostgreSQL requires separately supplied admin + restricted runtime test-cluster URLs.
 * No HTTP, peer-delivery, browser, media-pipeline or production-capacity claim is made.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { arch, cpus, platform as hostPlatform, release, totalmem } from "node:os";
import {
  MemoryRepository,
  PostgresRepository,
  createCanvasBoardRepository,
  createPlatformRepository,
  type CreatorContext,
  type Repository,
} from "../../packages/db/src/index.ts";
import {
  CANVAS_MAX_HISTORY_BYTES,
  CANVAS_SCHEMA_VERSION,
  CanvasBoardCreateSchema,
  CanvasFacilitationMutationSchema,
  type CanvasBoardMutation,
  type CanvasFacilitationCommand,
} from "../../packages/contracts/src/index.ts";
import {
  buildCanvasCapacityScene,
  canvasCapacityDistribution,
  canvasCapacityMutation,
  canvasCapacitySeedBatches,
  canvasCapacitySeedMutation,
  canvasCapacityText,
  evaluateCanvasCapacityGates,
  parseCanvasCapacityConfig,
} from "./canvas-capacity.ts";

// Diagnostics contain only fixture phase/index values, never stored scene or principal data.
let progress: { phase: string; index?: number } = { phase: "configuration" };

async function creator(repository: Repository, index: number) {
  const tokenHash = randomUUID(),
    now = new Date();
  await repository.createMagicToken({
    id: randomUUID(),
    email: `canvas-capacity-${index}-${randomUUID()}@example.test`,
    tokenHash,
    segment: "workplace",
    policyVersion: "load-test",
    expiresAt: new Date(now.getTime() + 60_000),
    consumedAt: null,
  });
  const actor = await repository.consumeMagicToken(tokenHash, now);
  assert.ok(actor, "Synthetic principal must be verified");
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
function sourceProvenance() {
  try {
    return {
      revision: execFileSync("git", ["rev-parse", "HEAD"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim(),
      workingTreeDirty: Boolean(
        execFileSync("git", ["status", "--porcelain"], {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "ignore"],
        }).trim(),
      ),
    };
  } catch {
    return { revision: null, workingTreeDirty: null };
  }
}

async function main() {
  const config = parseCanvasCapacityConfig(process.env);
  const scene = buildCanvasCapacityScene(config);
  const batches = canvasCapacitySeedBatches(scene.objects);
  const discussionCount = Math.min(config.editors, 8);
  const facilitationCommands = discussionCount * 4 + 3 + 2;
  const plannedReceipts =
    1 +
    2 * (config.editors - 1) +
    batches.length +
    facilitationCommands +
    config.editors * (config.warmupPerEditor + config.updatesPerEditor) +
    1;
  assert.ok(plannedReceipts < 4900, "Leave receipt-budget headroom for fixture setup and cleanup");
  const startedAt = new Date().toISOString(),
    started = performance.now();
  const observedMemory = { rss: 0, heapUsed: 0, external: 0 };
  function observeMemory() {
    const memory = process.memoryUsage();
    for (const name of ["rss", "heapUsed", "external"] as const)
      observedMemory[name] = Math.max(observedMemory[name], memory[name]);
  }
  observeMemory();
  const databaseName = `canvas_load_${randomUUID().replaceAll("-", "")}`;
  let admin: PostgresRepository | undefined, repository: Repository | undefined;
  let durableReader: PostgresRepository | undefined, runtimeDatabaseUrl: string | undefined;
  let createdDatabase = false;
  let databaseVersion: string | null = null,
    runtimePoolMaximum: number | null = null;
  let result: Record<string, unknown> | undefined;
  let gatesPassed: boolean;
  try {
    if (config.backend === "postgres") {
      const adminInput = process.env.CANVAS_LOAD_DATABASE_ADMIN_URL,
        runtimeInput = process.env.CANVAS_LOAD_DATABASE_URL;
      assert.ok(
        adminInput && runtimeInput,
        "PostgreSQL evidence needs separate admin and restricted runtime URLs",
      );
      const adminUrl = new URL(adminInput),
        runtimeUrl = new URL(runtimeInput);
      assert.equal(runtimeUrl.host, adminUrl.host, "Use one disposable test cluster");
      assert.notEqual(
        runtimeUrl.username,
        adminUrl.username,
        "Runtime must have a separate restricted login",
      );
      admin = new PostgresRepository(adminInput);
      await admin.pool.query(`CREATE DATABASE "${databaseName}"`);
      createdDatabase = true;
      adminUrl.pathname = `/${databaseName}`;
      runtimeUrl.pathname = `/${databaseName}`;
      runtimeDatabaseUrl = runtimeUrl.toString();
      const migrator = new PostgresRepository(adminUrl.toString());
      try {
        await migrator.migrate();
      } finally {
        await migrator.close();
      }
      const postgres = new PostgresRepository(runtimeDatabaseUrl);
      repository = postgres;
      const principal = await postgres.pool.query(
        "SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user",
      );
      assert.deepEqual(
        principal.rows[0],
        { rolsuper: false, rolbypassrls: false },
        "Exercise restricted RLS",
      );
      databaseVersion = String(
        (await postgres.pool.query("SHOW server_version")).rows[0].server_version,
      );
      runtimePoolMaximum = postgres.pool.options.max ?? null;
    } else repository = new MemoryRepository();
    await repository.initialize();
    const platform = createPlatformRepository(repository),
      actors: CreatorContext[] = [];
    for (let index = 0; index < config.editors; index++)
      actors.push(await creator(repository, index));
    const outsider = await creator(repository, config.editors),
      owner = actors[0]!;
    const organization = await platform.createOrganization({
      name: "Synthetic bounded canvas evidence",
      actorId: owner.userId,
      accountType: "organization",
      licenseUnit: "user",
    });
    await platform.applySubscriptionSnapshot({
      organizationId: organization.id,
      customerId: null,
      subscriptionId: null,
      status: "active",
      licenseQuantity: config.editors,
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
    assert.equal(licenses.assignments.length, config.editors);
    assert.equal(
      new Set(licenses.assignments.map((assignment) => assignment.workspaceId)).size,
      config.editors,
    );
    const workspaceId = licenses.assignments.find(
      (assignment) => assignment.userId === owner.userId,
    )!.workspaceId;
    const canvases = createCanvasBoardRepository(repository);
    let board = await canvases.create(
      owner,
      CanvasBoardCreateSchema.parse({
        schemaVersion: CANVAS_SCHEMA_VERSION,
        workspaceId,
        title: "Bounded mixed canvas evidence",
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
    const seedSamples: number[] = [],
      facilitationSamples: number[] = [];
    for (const [batchIndex, objects] of batches.entries()) {
      progress = { phase: "seedBatch", index: batchIndex };
      const before = performance.now();
      board = (
        await canvases.command(
          owner,
          board.id,
          canvasCapacitySeedMutation(objects, board.objects, randomUUID()),
        )
      ).board;
      seedSamples.push(performance.now() - before);
      observeMemory();
    }
    assert.equal(board.objects.length, config.objects);
    assert.ok(
      Buffer.byteLength(JSON.stringify(board.objects)) * 2 + 2048 <= CANVAS_MAX_HISTORY_BYTES,
      "Two checkpoint fixtures must fit the existing shared history allowance",
    );
    async function facilitate(command: CanvasFacilitationCommand, actor = owner) {
      progress = { phase: `facilitation.${command.type}` };
      const before = performance.now();
      const response = await canvases.facilitate(
        actor,
        board.id,
        CanvasFacilitationMutationSchema.parse({
          schemaVersion: 1,
          operationId: randomUUID(),
          command,
        }),
      );
      facilitationSamples.push(performance.now() - before);
      observeMemory();
      return response;
    }
    for (let index = 0; index < discussionCount; index++) {
      const threadId = randomUUID(),
        messageId = randomUUID(),
        actor = actors[index]!;
      await facilitate(
        {
          type: "comment_thread_create",
          threadId,
          messageId,
          objectId: scene.editorTargetIds[index]!,
          text: "Synthetic anchored discussion",
        },
        actor,
      );
      await facilitate(
        {
          type: "comment_reply",
          threadId,
          expectedVersion: 1,
          messageId: randomUUID(),
          text: "Synthetic reply · 共同で計画する",
        },
        actor,
      );
      await facilitate(
        {
          type: "comment_edit",
          threadId,
          expectedVersion: 2,
          messageId,
          text: "Revised synthetic anchored discussion",
        },
        actor,
      );
      await facilitate({ type: "comment_resolve", threadId, expectedVersion: 3, resolved: true });
    }
    await facilitate({ type: "timer_start", expectedRevision: 0, durationSeconds: 300 });
    await facilitate({ type: "timer_pause", expectedRevision: 1 });
    await facilitate({ type: "timer_resume", expectedRevision: 2 });
    const checkpointIds = [randomUUID(), randomUUID()];
    for (const [index, versionId] of checkpointIds.entries())
      await facilitate({ type: "version_create", versionId, name: `Synthetic baseline ${index}` });
    await denied(() => canvases.get(outsider, board.id));
    const setupMs = performance.now() - started;

    const versions = actors.map(() => 1),
      receiptKeys = new Set<string>();
    let acceptedRetry:
      { actor: CreatorContext; mutation: CanvasBoardMutation; receipt: unknown } | undefined;
    async function writes(count: number, phase: "warmup" | "measured") {
      progress = { phase };
      const samples: number[] = [];
      await Promise.all(
        actors.map(async (actor, index) => {
          for (let step = 1; step <= count; step++) {
            const version = versions[index]!;
            const mutation = canvasCapacityMutation(
              {
                type: "batch",
                operations: [
                  {
                    type: "update",
                    id: scene.editorTargetIds[index]!,
                    expectedVersion: version,
                    patch: {
                      text: canvasCapacityText(
                        `E${index}:${phase === "warmup" ? "W" : "M"}${step}`,
                        config.textCharacters,
                      ),
                      x: index * 240 + version,
                    },
                  },
                ],
              },
              randomUUID(),
            );
            const before = performance.now(),
              response = await canvases.command(actor, board.id, mutation);
            samples.push(performance.now() - before);
            versions[index] = version + 1;
            receiptKeys.add(`${actor.userId}:${response.receipt.operationId}`);
            assert.equal(response.receipt.operationId, mutation.operationId);
            if (phase === "measured" && index === 1 && step === 1)
              acceptedRetry = { actor, mutation, receipt: response.receipt };
            observeMemory();
          }
        }),
      );
      return samples;
    }
    const warmupSamples = await writes(config.warmupPerEditor, "warmup");
    const writesStarted = performance.now(),
      commitSamples = await writes(config.updatesPerEditor, "measured");
    const writesElapsedMs = performance.now() - writesStarted;
    assert.equal(commitSamples.length, config.editors * config.updatesPerEditor);
    assert.equal(
      receiptKeys.size,
      config.editors * (config.updatesPerEditor + config.warmupPerEditor),
    );
    assert.ok(acceptedRetry);
    const beforeRetry = (await canvases.authorize(owner, board.id)).canvasSeq;
    const retryStarted = performance.now(),
      retry = await canvases.command(acceptedRetry.actor, board.id, acceptedRetry.mutation);
    const retryMs = performance.now() - retryStarted;
    assert.deepEqual(retry.receipt, acceptedRetry.receipt);
    assert.equal(retry.board.canvasSeq, beforeRetry, "Exact retries never advance canvas sequence");
    await assert.rejects(
      () =>
        canvases.command(
          owner,
          board.id,
          canvasCapacityMutation(
            {
              type: "batch",
              operations: [
                {
                  type: "update",
                  id: scene.editorTargetIds[0]!,
                  expectedVersion: versions[0]! - 1,
                  patch: { text: "Rejected stale overwrite" },
                },
              ],
            },
            randomUUID(),
          ),
        ),
      (error: unknown) => error instanceof Error && "code" in error && error.code === "STALE_DRAFT",
    );

    const readSamples: number[] = [],
      facilitationReadSamples: number[] = [],
      checkpointReadSamples: number[] = [];
    for (let round = 0; round < config.readRounds; round++)
      await Promise.all(
        actors.map(async (actor) => {
          const before = performance.now(),
            snapshot = await canvases.get(actor, board.id);
          readSamples.push(performance.now() - before);
          assert.equal(snapshot.objects.length, config.objects);
          assert.equal(snapshot.workspaceId, workspaceId);
          for (let index = 0; index < config.editors; index++) {
            const object = snapshot.objects.find(
              (candidate) => candidate.id === scene.editorTargetIds[index],
            );
            assert.equal(object?.version, versions[index]);
            assert.equal(
              object?.text,
              canvasCapacityText(`E${index}:M${config.updatesPerEditor}`, config.textCharacters),
            );
          }
          for (const object of snapshot.objects.filter(
            (candidate) => !scene.editorTargetIds.includes(candidate.id),
          ))
            assert.equal(object.version, 1, "Unrelated diagram objects must be preserved");
          observeMemory();
        }),
      );
    const facilitationReadStarted = performance.now(),
      facilitation = await canvases.getFacilitation(owner, board.id);
    facilitationReadSamples.push(performance.now() - facilitationReadStarted);
    assert.equal(facilitation.threads.length, discussionCount);
    assert.equal(facilitation.versions.length, 2);
    assert.equal(facilitation.timer.revision, 3);
    assert.ok(
      facilitation.threads.every(
        (thread) => thread.resolved && thread.messages.length === 2 && thread.version === 4,
      ),
    );
    for (const versionId of checkpointIds) {
      const before = performance.now(),
        saved = await canvases.getVersion(owner, board.id, versionId);
      checkpointReadSamples.push(performance.now() - before);
      assert.equal(saved.objects.length, config.objects);
      assert.equal(
        saved.objects.find((object) => object.id === scene.editorTargetIds[0])?.version,
        1,
      );
    }
    let reopened = createCanvasBoardRepository(repository);
    if (runtimeDatabaseUrl) {
      durableReader = new PostgresRepository(runtimeDatabaseUrl);
      await durableReader.initialize();
      reopened = createCanvasBoardRepository(durableReader);
    }
    const persisted = await reopened.get(owner, board.id);
    assert.equal(persisted.objects.length, config.objects);
    assert.equal(
      persisted.objects.find((object) => object.id === scene.editorTargetIds[1])?.version,
      versions[1],
    );
    assert.equal((await reopened.getFacilitation(owner, board.id)).versions.length, 2);
    const revoked = actors.at(-1)!;
    await canvases.revokeGrant(owner, board.id, revoked.userId);
    await denied(() => canvases.get(revoked, board.id));
    await denied(() => canvases.getFacilitation(revoked, board.id));
    await denied(() => canvases.getVersion(revoked, board.id, checkpointIds[0]!));
    const deniedMutation = canvasCapacityMutation(
      {
        type: "batch",
        operations: [
          {
            type: "update",
            id: scene.editorTargetIds[0]!,
            expectedVersion: versions[0]!,
            patch: { text: "Rejected unauthorized overwrite" },
          },
        ],
      },
      randomUUID(),
    );
    await denied(() => canvases.command(revoked, board.id, deniedMutation));
    await denied(() => canvases.command(outsider, board.id, deniedMutation));
    const final = await canvases.get(owner, board.id);
    assert.equal(
      final.objects.find((object) => object.id === scene.editorTargetIds[0])?.version,
      versions[0],
    );
    let outboxCursor = 0,
      outboxEvents = 0;
    for (;;) {
      const page = await canvases.listOutbox(outboxCursor, 500);
      assert.ok(
        page.events.every((event) =>
          Object.keys(event).every((key) =>
            ["eventId", "boardId", "canvasSeq", "type", "createdAt", "cursor"].includes(key),
          ),
        ),
        "Outbox is metadata-only",
      );
      outboxEvents += page.events.length;
      if (!page.events.length) break;
      assert.ok(page.cursor > outboxCursor);
      outboxCursor = page.cursor;
    }
    observeMemory();
    const latency = {
      seedBatch: canvasCapacityDistribution(seedSamples),
      warmupAcknowledgement: canvasCapacityDistribution(warmupSamples),
      commitAcknowledgement: canvasCapacityDistribution(commitSamples),
      concurrentSnapshotRead: canvasCapacityDistribution(readSamples),
      facilitationMutation: canvasCapacityDistribution(facilitationSamples),
      facilitationSnapshotRead: canvasCapacityDistribution(facilitationReadSamples),
      checkpointRead: canvasCapacityDistribution(checkpointReadSamples),
      exactRetry: canvasCapacityDistribution([retryMs]),
    };
    const gates = evaluateCanvasCapacityGates(config.gates, latency);
    gatesPassed = gates.passed;
    result = {
      evidenceSchemaVersion: 1,
      startedAt,
      protocolVersion: CANVAS_SCHEMA_VERSION,
      source: sourceProvenance(),
      workload: {
        objects: config.objects,
        licensedEditors: config.editors,
        updatesPerEditor: config.updatesPerEditor,
        warmupPerEditor: config.warmupPerEditor,
        readRounds: config.readRounds,
        textCharacters: config.textCharacters,
        penPoints: config.penPoints,
        objectCounts: scene.counts,
        fixtureSha256: scene.sha256,
        fixtureSerializedBytes: scene.serializedBytes,
        currentSceneSerializedBytes: Buffer.byteLength(JSON.stringify(final.objects)),
        seedBatches: batches.length,
        retainedDiscussionThreads: discussionCount,
        retainedDiscussionMessages: discussionCount * 2,
        retainedCheckpoints: 2,
        plannedReceiptUpperBound: plannedReceipts,
        committedMeasuredUpdates: commitSamples.length,
        pacing: "Closed-loop concurrent actors; each actor awaits its own previous acknowledgement",
      },
      environment: {
        backend: config.backend,
        node: process.version,
        platform: hostPlatform(),
        architecture: arch(),
        kernel: release(),
        logicalCpuCount: cpus().length,
        hostMemoryBytes: totalmem(),
        databaseVersion,
        runtimePoolMaximum,
        disposableDatabase: config.backend === "postgres",
        restrictedRlsChecked: config.backend === "postgres",
      },
      setupMs: Math.round(setupMs),
      measuredWritesElapsedMs: Math.round(writesElapsedMs),
      measuredWritesPerSecond:
        Math.round((commitSamples.length / writesElapsedMs) * 1000 * 100) / 100,
      repositoryLatencyMs: latency,
      sampledProcessMemoryHighWaterBytes: observedMemory,
      outboxEvents,
      correctness: {
        allIndependentUpdatesRetained: true,
        unrelatedObjectsPreserved: true,
        exactRetryDeduplicated: true,
        exactRetryNoSequenceAdvance: true,
        staleObjectRejected: true,
        uninvitedDenied: true,
        revokedReadWriteAndHistoryDenied: true,
        facadeReopenChecked: true,
        independentConnectionDurabilityChecked: config.backend === "postgres",
        metadataOnlyOutbox: true,
        discussionsTimerAndCheckpointsRetained: true,
      },
      gates,
      capacityIncreaseAuthorized: false,
      measurementScope:
        "Repository calls only: latency includes transaction/auth/projection work. Acknowledgement is not commit-to-peer delivery.",
      unmeasured: [
        "HTTP authentication/rate limiting",
        "post-commit peer delivery and network RTT",
        "browser rendering/frame rate/loading",
        "image/storage/scanner pipeline",
        "physical touch or reference mobile hardware",
        "target deployment CPU/DB/network and multi-node load",
        "maximum receipt/history/comment saturation and long-duration soak",
      ],
      totalMs: Math.round(performance.now() - started),
    };
  } finally {
    try {
      await durableReader?.close();
      await repository?.close();
      if (admin && createdDatabase) {
        for (let attempt = 0; attempt < 80; attempt++) {
          const sessions = await admin.pool.query(
            "SELECT count(*)::integer AS count FROM pg_stat_activity WHERE datname=$1",
            [databaseName],
          );
          if (sessions.rows[0].count === 0) break;
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
        await admin.pool.query(`DROP DATABASE "${databaseName}"`);
      }
    } finally {
      await admin?.close();
    }
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!gatesPassed) process.exitCode = 1;
}
main().catch((error: unknown) => {
  const code =
    error &&
    typeof error === "object" &&
    "code" in error &&
    /^[A-Z0-9_]{1,40}$/.test(String(error.code))
      ? String(error.code)
      : null;
  process.stderr.write(
    `${JSON.stringify({ error: "Canvas repository evidence did not complete", kind: error instanceof Error ? error.name : "unknown", code, progress })}\n`,
  );
  process.exitCode = 1;
});
