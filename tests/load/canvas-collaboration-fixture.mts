import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  get as httpGet,
  type ClientRequest,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { createRequire } from "node:module";
import {
  CANVAS_SCHEMA_VERSION,
  CanvasBoardCreateSchema,
  CanvasObjectCreateSchema,
  IdeaBoardCreateSchema,
  type CanvasBoardMutation,
  type CanvasObjectCreate,
} from "../../packages/contracts/src/index.ts";
import {
  PostgresRepository,
  createCanvasBoardRepository,
  createIdeaBoardRepository,
  createPlatformRepository,
  type CreatorContext,
} from "../../packages/db/src/index.ts";
import { buildApp } from "../../apps/server/src/app.ts";
import { RedisSessionCache } from "../../apps/server/src/cache.ts";
import { ConfigSchema } from "../../apps/server/src/config.ts";
import { hashToken, opaqueToken } from "../../apps/server/src/security.ts";
import { mediaFinalizationObjectKey } from "../../apps/server/src/storage.ts";
import { canvasCapacitySeedMutation, canvasCapacitySeedBatches } from "./canvas-capacity.ts";
import {
  CanvasPeerPaintLedger,
  canvasCollaborationScene,
  type CanvasCollaborationConfig,
} from "./canvas-collaboration-config.ts";
import type { CanvasCollaborationProfiler } from "./canvas-collaboration-profile.ts";

const syntheticPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aP4sAAAAASUVORK5CYII=",
  "base64",
);
const Redis = createRequire(new URL("../../apps/server/package.json", import.meta.url))(
  "ioredis",
) as new (
  url: string,
  options: { lazyConnect: boolean },
) => {
  connect(): Promise<void>;
  quit(): Promise<unknown>;
  info(section: string): Promise<string>;
  scan(
    cursor: string,
    match: "MATCH",
    pattern: string,
    count: "COUNT",
    size: number,
  ): Promise<[string, string[]]>;
  unlink(...keys: string[]): Promise<unknown>;
};
async function principal(repository: PostgresRepository, index: number) {
  const tokenHash = randomUUID();
  await repository.createMagicToken({
    id: randomUUID(),
    tokenHash,
    email: `collaboration-${index}-${randomUUID()}@example.test`,
    segment: "workplace",
    policyVersion: "capacity-fixture",
    expiresAt: new Date(Date.now() + 60000),
    consumedAt: null,
  });
  const actor = await repository.consumeMagicToken(tokenHash, new Date());
  assert.ok(actor);
  return actor;
}
function loopbackUrl(raw: string | undefined, protocols: string[]) {
  assert.ok(raw, "Explicit disposable database/cache URLs are required");
  const url = new URL(raw);
  assert.ok(protocols.includes(url.protocol), "Unexpected fixture connection protocol");
  assert.ok(
    ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname),
    "Use a loopback disposable service, never a production database/cache",
  );
  return url;
}
export async function createCanvasCollaborationFixture(
  config: CanvasCollaborationConfig,
  profiler?: CanvasCollaborationProfiler,
) {
  const adminUrl = loopbackUrl(process.env.CANVAS_COLLAB_DATABASE_ADMIN_URL, [
    "postgres:",
    "postgresql:",
  ]);
  const runtimeUrl = loopbackUrl(process.env.CANVAS_COLLAB_DATABASE_URL, [
    "postgres:",
    "postgresql:",
  ]);
  const redisUrl = loopbackUrl(process.env.CANVAS_COLLAB_REDIS_URL, ["redis:"]);
  assert.equal(adminUrl.host, runtimeUrl.host);
  assert.notEqual(adminUrl.username, runtimeUrl.username, "Use a restricted runtime principal");
  const databaseName = `canvas_collab_${randomUUID().replaceAll("-", "")}`;
  const redisNamespace = `${databaseName}:`;
  const redisAdmin = new Redis(redisUrl.toString(), { lazyConnect: true });
  let redisConnected = false;
  redisUrl.searchParams.set("keyPrefix", redisNamespace);
  const cluster = new PostgresRepository(adminUrl.toString());
  const apps: Awaited<ReturnType<typeof buildApp>>[] = [];
  const repos: PostgresRepository[] = [];
  const caches: RedisSessionCache[] = [];
  let created = false;
  const ledger = new CanvasPeerPaintLedger();
  const streamEvents: Record<string, number> = {};
  const api = `http://127.0.0.1:${config.apiPort}`;
  const peerApi = `http://127.0.0.1:${config.peerPort}`;
  const web = `http://127.0.0.1:${config.webPort}`;
  async function close() {
    const appRepositories = new Set(apps.map((built) => built.repository));
    const appCaches = new Set(apps.map((built) => built.cache));
    await Promise.allSettled(apps.map((built) => built.app.close()));
    await Promise.allSettled(
      repos.filter((repo) => !appRepositories.has(repo)).map((repo) => repo.close()),
    );
    await Promise.allSettled(
      caches.filter((cache) => !appCaches.has(cache)).map((cache) => cache.close()),
    );
    try {
      if (redisConnected) {
        let cursor = "0";
        do {
          const [next, keys] = await redisAdmin.scan(
            cursor,
            "MATCH",
            `${redisNamespace}*`,
            "COUNT",
            100,
          );
          cursor = next;
          if (keys.length) await redisAdmin.unlink(...keys);
        } while (cursor !== "0");
        await redisAdmin.quit();
      }
      if (created) await cluster.pool.query(`DROP DATABASE "${databaseName}" WITH (FORCE)`);
    } finally {
      await cluster.close();
    }
  }
  try {
    await redisAdmin.connect();
    redisConnected = true;
    const redisInfo = await redisAdmin.info("server");
    const cacheVersion =
      redisInfo.match(/^(?:valkey_version|redis_version):(.+)$/m)?.[1]?.trim() ?? "unknown";
    const databaseVersion = String(
      (await cluster.pool.query("SHOW server_version")).rows[0].server_version,
    );
    const versionNumber = Number(
      (await cluster.pool.query("SHOW server_version_num")).rows[0].server_version_num,
    );
    assert.ok(
      versionNumber >= 170000 && versionNumber < 180000,
      "This evidence profile requires PostgreSQL17",
    );
    await cluster.pool.query(`CREATE DATABASE "${databaseName}"`);
    created = true;
    const migrationUrl = new URL(adminUrl);
    migrationUrl.pathname = `/${databaseName}`;
    runtimeUrl.pathname = `/${databaseName}`;
    const migrator = new PostgresRepository(migrationUrl.toString());
    try {
      await migrator.migrate();
    } finally {
      await migrator.close();
    }
    for (let index = 0; index < 2; index++) {
      const repo = new PostgresRepository(runtimeUrl.toString());
      repos.push(repo);
      await repo.initialize();
      assert.deepEqual(
        (
          await repo.pool.query(
            "SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user",
          )
        ).rows[0],
        { rolsuper: false, rolbypassrls: false },
      );
      profiler?.wrapPool(repo.pool, index as 0 | 1);
      const cache = new RedisSessionCache(redisUrl.toString());
      caches.push(cache);
      await cache.connect();
      const built = await buildApp(
        ConfigSchema.parse({
          NODE_ENV: "test",
          ALLOW_IN_MEMORY: "false",
          BUSINESS_PLATFORM_ENABLED: "true",
          DATABASE_URL: runtimeUrl.toString(),
          REDIS_URL: redisUrl.toString(),
          LOG_LEVEL: "silent",
          WEB_ORIGIN: web,
          PUBLIC_API_URL: index === 0 ? api : peerApi,
          COOKIE_SECURE: "false",
          S3_ENDPOINT: "http://127.0.0.1:1",
          S3_BUCKET: "synthetic-capacity",
          S3_ACCESS_KEY_ID: "synthetic",
          S3_SECRET_ACCESS_KEY: "synthetic",
        }),
        {
          repository: repo,
          cache,
          mailer: {
            sendAccountVerification: async () => {},
            sendSignInPin: async () => {},
            sendWorkspaceInvitation: async () => {},
          },
        },
      );
      apps.push(built);
      const command = built.canvasBoards.command.bind(built.canvasBoards);
      built.canvasBoards.command = async (...args) => {
        const response = await command(...args);
        ledger.commit(args[2].operationId, performance.now());
        return response;
      };
      // The existing ledger still observes repository resolution, inside this optional wrapper.
      profiler?.wrapRepository(built.canvasBoards, index as 0 | 1);
      const streamEvent = built.metrics.canvasStreamEvent.bind(built.metrics);
      built.metrics.canvasStreamEvent = (event) => {
        streamEvents[event] = (streamEvents[event] ?? 0) + 1;
        streamEvent(event);
      };
      built.storage.readImage = async (asset) => {
        assert.equal(asset.id, "00000000-0000-4000-8000-000999999998");
        assert.equal(asset.scanStatus, "clean");
        return Buffer.from(syntheticPng);
      };
    }
    const repository = repos[0]!,
      platform = createPlatformRepository(repository);
    await platform.saveFeaturePolicy({
      expectedRevision: 0,
      features: Object.fromEntries(
        [
          "uxBeta",
          "workspaceShell",
          "ideaBoards",
          "canvasBoards",
          "canvasBoardSharing",
          "canvasBoardRealtime",
        ].map((key) => [key, { enabled: true, plans: ["free", "pro", "team"] }]),
      ),
    });
    const actors: CreatorContext[] = [];
    for (let index = 0; index <= config.editors; index++)
      actors.push(await principal(repository, index));
    const outsider = actors.pop()!,
      owner = actors[0]!;
    const org = await platform.createOrganization({
      name: "Synthetic browser capacity evidence",
      actorId: owner.userId,
      accountType: "organization",
      licenseUnit: "user",
    });
    await platform.applySubscriptionSnapshot({
      organizationId: org.id,
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
        organizationId: org.id,
        actorId: owner.userId,
        userId: actor.userId,
        role: "member",
      });
      await platform.assignOrganizationUserLicense(org.id, owner.userId, actor.userId, true);
    }
    const licenses = await platform.getOrganizationUserLicenses(org.id, owner.userId);
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
        title: "Mixed production-browser evidence",
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
    // The disposable database isolates this fixed ID, keeping workload hashes comparable.
    const mediaId = "00000000-0000-4000-8000-000999999998";
    const asset = await canvases.reserveMedia(owner, board.id, {
      id: mediaId,
      workspaceId,
      objectKey: `quarantine/${workspaceId}/${mediaId}.png`,
      mimeType: "image/png",
      sizeBytes: syntheticPng.length,
      scanStatus: "pending",
      altText: "Synthetic capacity fixture PNG",
      createdAt: new Date(),
    });
    const finalizationToken = randomUUID();
    assert.ok(
      await repository.claimMediaAssetFinalization(workspaceId, mediaId, finalizationToken),
    );
    assert.ok(
      await repository.updateMediaAsset(workspaceId, mediaId, {
        scanStatus: "clean",
        objectKey: mediaFinalizationObjectKey(asset, finalizationToken),
        finalizationToken,
        finalizedAt: new Date(),
      }),
    );
    const scene = canvasCollaborationScene(config, mediaId);
    for (const objects of canvasCapacitySeedBatches(scene.objects))
      board = (
        await canvases.command(
          owner,
          board.id,
          canvasCapacitySeedMutation(objects, board.objects, randomUUID()),
        )
      ).board;
    const sessions: Array<{ actor: CreatorContext; token: string; workspaceId: string }> = [];
    for (const actor of [...actors, outsider]) {
      const token = opaqueToken(),
        activeWorkspaceId =
          licenses.assignments.find((assignment) => assignment.userId === actor.userId)
            ?.workspaceId ?? actor.workspaceId;
      await repository.createCreatorSession({
        id: randomUUID(),
        userId: actor.userId,
        tokenHash: hashToken(token),
        activeWorkspaceId,
        expiresAt: new Date(Date.now() + 3600000),
      });
      sessions.push({ actor, token, workspaceId: activeWorkspaceId });
    }
    await apps[0]!.app.listen({ host: "127.0.0.1", port: config.apiPort });
    await apps[1]!.app.listen({ host: "127.0.0.1", port: config.peerPort });
    const peerStreams = new Set<ServerResponse>();
    apps[1]!.app.server.on("request", (request, response) => {
      if (
        request.url?.split("?")[0] !== `/v1/canvas-boards/${board.id}/events` ||
        !request.headers.cookie?.includes(`openround_creator=${sessions[1]!.token}`)
      )
        return;
      peerStreams.add(response);
      response.once("close", () => peerStreams.delete(response));
    });
    function interruptPeerStreams() {
      const count = peerStreams.size;
      for (const response of peerStreams) response.destroy();
      return count;
    }
    async function workshop() {
      const ideas = createIdeaBoardRepository(repository),
        sourceId = randomUUID();
      const source = await ideas.create(
        workspaceId,
        sourceId,
        IdeaBoardCreateSchema.parse({ title: "Synthetic guest publication evidence" }),
        randomUUID(),
        {
          participantLimit: 10,
          closesAt: new Date(Date.now() + 3600000).toISOString(),
          expiresAt: new Date(Date.now() + 7200000).toISOString(),
        },
        () => new Date(),
      );
      let canvas = await canvases.create(
        owner,
        CanvasBoardCreateSchema.parse({
          schemaVersion: CANVAS_SCHEMA_VERSION,
          workspaceId,
          title: source.title,
          boardType: "workshop",
          sourceBoardId: sourceId,
          operationId: randomUUID(),
        }),
      );
      await ideas.hostCommand(
        workspaceId,
        sourceId,
        { type: "collect" },
        source.revision,
        randomUUID(),
        () => new Date(),
      );
      const objects: CanvasObjectCreate[] = Array.from(
        { length: config.guestObjects },
        (_, index) =>
          CanvasObjectCreateSchema.parse({
            id: randomUUID(),
            type: "sticky",
            text: index === 0 ? "PRIVATE-FIXTURE-TEXT" : `Published scaffold ${index}`,
            visibility: index === 0 ? "team" : "published",
            x: (index % 10) * 220,
            y: Math.floor(index / 10) * 160,
            width: 200,
            height: 140,
          }),
      );
      for (const batch of canvasCapacitySeedBatches(objects))
        canvas = (
          await canvases.command(
            owner,
            canvas.id,
            canvasCapacitySeedMutation(batch, canvas.objects, randomUUID()),
          )
        ).board;
      return { canvas, sourceId, objectId: objects[0]!.id };
    }
    async function command(mutation: CanvasBoardMutation, boardId = board.id, actor = owner) {
      const token = sessions.find((session) => session.actor.userId === actor.userId)!.token;
      return fetch(`${api}/v1/canvas-boards/${boardId}/commands`, {
        method: "POST",
        headers: {
          origin: web,
          cookie: `openround_creator=${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(mutation),
      });
    }
    return {
      apps,
      board,
      scene,
      actors,
      outsider,
      sessions,
      api,
      peerApi,
      web,
      ledger,
      streamEvents,
      databaseVersion,
      runtimePoolMaximum: repository.pool.options.max ?? null,
      syntheticImageBytes: syntheticPng.length,
      cacheVersion,
      redisNamespace,
      close,
      workshop,
      command,
      interruptPeerStreams,
    };
  } catch (error) {
    await close();
    throw error;
  }
}

export async function stalledCanvasConsumer(url: string, token: string, origin: string) {
  let request: ClientRequest | undefined, response: IncomingMessage | undefined;
  await new Promise<void>((resolve, reject) => {
    request = httpGet(
      url,
      { headers: { origin, cookie: `openround_creator=${token}` } },
      (incoming) => {
        response = incoming;
        if (incoming.statusCode !== 200) {
          reject(new Error("Stalled consumer did not authorize"));
          incoming.resume();
          return;
        }
        incoming.pause();
        incoming.socket.pause();
        resolve();
      },
    );
    request.once("error", reject);
    request.setTimeout(10000, () =>
      request?.destroy(new Error("Stalled stream connection timed out")),
    );
  });
  request!.setTimeout(0);
  return {
    close: () => {
      response?.destroy();
      request?.destroy();
    },
    state: () => ({
      paused: response?.isPaused() ?? false,
      destroyed: response?.destroyed ?? true,
      bufferedBytes: response?.readableLength ?? 0,
    }),
  };
}
