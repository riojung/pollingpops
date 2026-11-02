import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  CreateBucketCommand,
  DeleteBucketCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  S3Client,
} from "@aws-sdk/client-s3";
import { loadImage } from "@napi-rs/canvas";
import {
  CANVAS_SCHEMA_VERSION,
  CanvasBoardGuestViewSchema,
  CanvasBoardViewSchema,
  CanvasObjectCreateSchema,
  CanvasVersionViewSchema,
  type CanvasBoardCommand,
  type CanvasBoardView,
  type CanvasFacilitationCommand,
} from "@openround/contracts";
import { createPlatformRepository, MemoryRepository } from "@openround/db";
import type { FastifyInstance } from "fastify";
import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { MemorySessionCache } from "../src/cache.js";
import { ConfigSchema } from "../src/config.js";
import { ClamAvScanner } from "../src/malware-scanner.js";
import { signInFromVerificationResponse } from "./support/email-auth.js";
import { generatedCanvasPipelinePng } from "./support/generated-canvas-media.js";

// Reuse the existing Idea Board pipeline's disposable loopback services. Partial configuration
// fails instead of silently skipping. No storage/scanner replacement, network listener or file output.
const endpoint = process.env.IDEA_BOARD_PIPELINE_S3_ENDPOINT,
  scannerPort = process.env.IDEA_BOARD_PIPELINE_CLAMAV_PORT,
  accessKeyId = process.env.IDEA_BOARD_PIPELINE_ACCESS_KEY,
  secretAccessKey = process.env.IDEA_BOARD_PIPELINE_SECRET_KEY,
  configured = [endpoint, scannerPort, accessKeyId, secretAccessKey].some(Boolean);
const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
type Headers = { cookie: string };

async function signIn(app: FastifyInstance, email: string) {
  const registration = await app.inject({
    method: "POST",
    url: "/v1/auth/magic-link",
    payload: { email, segment: "workplace", acceptPolicies: true },
  });
  const signedIn = await signInFromVerificationResponse(app, registration, email),
    headers = { cookie: String(signedIn.headers["set-cookie"]).split(";")[0]! },
    me = await app.inject({ url: "/v1/auth/me", headers });
  expect(me.statusCode).toBe(200);
  const creator = me.json<{ creator: { userId: string; workspaceId: string } }>().creator;
  return { ...creator, headers, email };
}

async function withPipeline(run: (fixture: Awaited<ReturnType<typeof setup>>) => Promise<void>) {
  for (const value of [endpoint, scannerPort, accessKeyId, secretAccessKey])
    expect(Boolean(value), "Every pipeline environment key must be configured").toBe(true);
  const url = new URL(endpoint!);
  expect(url.protocol).toBe("http:");
  expect(url.hostname).toBe("127.0.0.1");
  expect(url.username + url.password + url.search + url.hash).toBe("");
  expect(/^\d+$/.test(scannerPort!)).toBe(true);
  expect(Number(scannerPort)).toBeGreaterThan(0);
  expect(Number(scannerPort)).toBeLessThanOrEqual(65535);
  const bucket = `canvas-pipeline-${randomUUID()}`,
    s3 = new S3Client({
      endpoint,
      region: "ca-central-1",
      forcePathStyle: true,
      requestHandler: { connectionTimeout: 5_000, requestTimeout: 30_000 },
      credentials: { accessKeyId: accessKeyId!, secretAccessKey: secretAccessKey! },
    });
  let fixture: Awaited<ReturnType<typeof setup>> | undefined,
    bucketCreated = false;
  try {
    await s3.send(new CreateBucketCommand({ Bucket: bucket }));
    bucketCreated = true;
    fixture = await setup(s3, bucket);
    await run(fixture);
  } finally {
    try {
      await fixture?.app.close();
    } finally {
      try {
        if (bucketCreated) {
          // Only this uniquely named bucket is touched, including failure cleanup.
          let continuation: string | undefined;
          do {
            const objects = await s3.send(
              new ListObjectsV2Command({ Bucket: bucket, ContinuationToken: continuation }),
            );
            if (objects.Contents?.length) {
              const deleted = await s3.send(
                new DeleteObjectsCommand({
                  Bucket: bucket,
                  Delete: { Objects: objects.Contents.map(({ Key }) => ({ Key })), Quiet: true },
                }),
              );
              expect(deleted.Errors?.length ?? 0, "Synthetic bucket cleanup must succeed").toBe(0);
            }
            continuation = objects.IsTruncated ? objects.NextContinuationToken : undefined;
          } while (continuation);
          await s3.send(new DeleteBucketCommand({ Bucket: bucket }));
        }
      } finally {
        s3.destroy();
      }
    }
  }
}

async function setup(s3: S3Client, bucket: string) {
  // MemoryRepository supplies disposable tenancy and lifecycle state. This suite proves actual
  // S3/ClamAV bytes and HTTP authorization; restricted PostgreSQL remains a separate conformance gate.
  const repository = new MemoryRepository(),
    config = ConfigSchema.parse({
      NODE_ENV: "test",
      ALLOW_IN_MEMORY: "true",
      BUSINESS_PLATFORM_ENABLED: "true",
      LOG_LEVEL: "silent",
      FEATURE_MEDIA_UPLOADS: "true",
      S3_ENDPOINT: endpoint,
      S3_PUBLIC_ENDPOINT: endpoint,
      S3_BUCKET: bucket,
      S3_ACCESS_KEY_ID: accessKeyId,
      S3_SECRET_ACCESS_KEY: secretAccessKey,
      S3_FORCE_PATH_STYLE: "true",
      MEDIA_SCAN_MODE: "clamav",
      CLAMAV_HOST: "127.0.0.1",
      CLAMAV_PORT: scannerPort,
      CLAMAV_TIMEOUT_MS: 30_000,
    }),
    built = await buildApp(config, {
      repository,
      cache: new MemorySessionCache(),
      mailer: {
        sendAccountVerification: async () => {},
        sendSignInPin: async () => {},
        sendWorkspaceInvitation: async () => {},
      },
    });
  try {
    const owner = await signIn(built.app, "canvas-pipeline-owner@example.test"),
      editor = await signIn(built.app, "canvas-pipeline-editor@example.test"),
      outsider = await signIn(built.app, "canvas-pipeline-outsider@example.test"),
      platform = createPlatformRepository(repository);
    await platform.saveFeaturePolicy({
      expectedRevision: 0,
      features: Object.fromEntries(
        ["ideaBoards", "canvasBoards", "canvasBoardSharing", "canvasBoardRealtime"].map((key) => [
          key,
          { enabled: true, plans: ["free", "pro", "team"] },
        ]),
      ),
    });
    const organization = await platform.createOrganization({
      name: "Synthetic media team",
      actorId: owner.userId,
      accountType: "organization",
      licenseUnit: "user",
    });
    await platform.applySubscriptionSnapshot({
      organizationId: organization.id,
      customerId: null,
      subscriptionId: null,
      status: "active",
      licenseQuantity: 2,
      licenseUnit: "user",
      offerId: null,
      paidThrough: null,
      graceUntil: null,
      legacyPlan: "team",
    });
    await platform.setOrganizationMember({
      organizationId: organization.id,
      actorId: owner.userId,
      userId: editor.userId,
      role: "member",
    });
    await platform.assignOrganizationUserLicense(
      organization.id,
      owner.userId,
      editor.userId,
      true,
    );
    const licenses = await platform.getOrganizationUserLicenses(organization.id, owner.userId),
      workspaceId = licenses.assignments.find(({ userId }) => userId === owner.userId)!.workspaceId,
      editorWorkspaceId = licenses.assignments.find(
        ({ userId }) => userId === editor.userId,
      )!.workspaceId;
    expect(editorWorkspaceId).not.toBe(workspaceId);
    expect(built.storage.mediaUploadsEnabled).toBe(true);
    const scanner = new ClamAvScanner("127.0.0.1", Number(scannerPort), 30_000),
      harmlessScannerProbe = Buffer.from(
        "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*",
        "ascii",
      );
    expect(await scanner.scan(harmlessScannerProbe)).toMatchObject({
      clean: false,
      signature: expect.stringMatching(/eicar/i),
    });
    return {
      ...built,
      repository,
      owner,
      editor,
      outsider,
      workspaceId,
      editorWorkspaceId,
      s3,
      bucket,
    };
  } catch (error) {
    await built.app.close();
    throw error;
  }
}
type Fixture = Awaited<ReturnType<typeof setup>>;

async function create(f: Fixture, sourceBoardId?: string) {
  const response = await f.app.inject({
    method: "POST",
    url: "/v1/canvas-boards",
    headers: f.owner.headers,
    payload: {
      schemaVersion: CANVAS_SCHEMA_VERSION,
      workspaceId: f.workspaceId,
      title: "Synthetic real-media canvas",
      boardType: sourceBoardId ? "workshop" : "team",
      sourceBoardId,
      operationId: randomUUID(),
    },
  });
  expect(response.statusCode).toBe(201);
  return CanvasBoardViewSchema.parse(response.json().board);
}
async function command(
  f: Fixture,
  board: CanvasBoardView,
  value: CanvasBoardCommand,
  headers = f.owner.headers,
) {
  const response = await f.app.inject({
    method: "POST",
    url: `/v1/canvas-boards/${board.id}/commands`,
    headers,
    payload: { schemaVersion: CANVAS_SCHEMA_VERSION, operationId: randomUUID(), command: value },
  });
  expect(response.statusCode).toBe(200);
  return CanvasBoardViewSchema.parse(response.json().board);
}
async function facilitate(f: Fixture, board: CanvasBoardView, value: CanvasFacilitationCommand) {
  const response = await f.app.inject({
    method: "POST",
    url: `/v1/canvas-boards/${board.id}/facilitation/commands`,
    headers: f.owner.headers,
    payload: { schemaVersion: 1, operationId: randomUUID(), command: value },
  });
  expect(response.statusCode).toBe(200);
  return response;
}
async function upload(f: Fixture, board: CanvasBoardView, headers: Headers) {
  const image = await generatedCanvasPipelinePng();
  expect(image.bytes.byteLength).toBeGreaterThan(1024 * 1024);
  expect(image.bytes.byteLength).toBeLessThan(5 * 1024 * 1024);
  const decoded = await loadImage(image.bytes);
  expect([decoded.width, decoded.height]).toEqual([1280, 720]);
  const requested = await f.app.inject({
    method: "POST",
    url: `/v1/canvas-boards/${board.id}/media`,
    headers,
    payload: {
      fileName: "synthetic-hd.png",
      mimeType: "image/png",
      sizeBytes: image.bytes.byteLength,
      altText: "Original synthetic 1280 by 720 pixel diagram texture",
    },
  });
  expect(requested.statusCode).toBe(201);
  const ticket = requested.json<{ mediaId: string; uploadUrl: string; scanStatus: string }>();
  expect(ticket.scanStatus).toBe("pending");
  expect(new URL(ticket.uploadUrl).origin === new URL(endpoint!).origin).toBe(true);
  const pendingRead = await f.app.inject({
    url: `/v1/canvas-boards/${board.id}/media/${ticket.mediaId}`,
    headers,
  });
  expect(pendingRead.statusCode).toBe(404);
  const pendingPlacement = await f.app.inject({
    method: "POST",
    url: `/v1/canvas-boards/${board.id}/commands`,
    headers,
    payload: {
      schemaVersion: CANVAS_SCHEMA_VERSION,
      operationId: randomUUID(),
      command: {
        type: "batch",
        operations: [
          {
            type: "create",
            object: CanvasObjectCreateSchema.parse({
              id: randomUUID(),
              type: "image",
              mediaId: ticket.mediaId,
              altText: "Unscanned image must not be placed",
              x: 0,
              y: 0,
              width: 640,
              height: 360,
            }),
          },
        ],
      },
    },
  });
  expect(pendingPlacement.statusCode).toBe(404);
  // Presigned storage requests carry neither creator cookies nor guest credentials.
  const sent = await fetch(ticket.uploadUrl, {
    method: "PUT",
    headers: { "content-type": "image/png" },
    body: Uint8Array.from(image.bytes).buffer,
    signal: AbortSignal.timeout(30_000),
  });
  expect(sent.status).toBe(200);
  await sent.body?.cancel();
  const completed = await f.app.inject({
    method: "POST",
    url: `/v1/canvas-boards/${board.id}/media/${ticket.mediaId}/complete`,
    headers,
    payload: {},
  });
  expect(completed.statusCode).toBe(200);
  expect(completed.json().media.scanStatus).toBe("clean");
  expect(completed.json()).not.toHaveProperty("downloadUrl");
  const asset = (await f.repository.getMediaAsset(f.workspaceId, ticket.mediaId))!;
  const unsigned = await fetch(
    new URL(`${f.bucket}/${asset.objectKey}`, `${endpoint!.replace(/\/$/, "")}/`),
    { signal: AbortSignal.timeout(15_000) },
  );
  expect(unsigned.status).toBe(403);
  await unsigned.body?.cancel();
  return { ...image, mediaId: ticket.mediaId };
}
async function assertImage(
  f: Fixture,
  path: string,
  headers: Record<string, string>,
  bytes: Buffer,
) {
  const response = await f.app.inject({ url: path, headers });
  expect(response.statusCode).toBe(200);
  expect(response.headers).toMatchObject({
    "content-type": "image/png",
    "cache-control": "private, no-store",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
  });
  expect(digest(response.rawPayload)).toBe(digest(bytes));
}

describe.skipIf(!configured)("real Canvas MinIO and ClamAV media pipeline", () => {
  it("scans representative PNG bytes, fences board references, and retains authorized checkpoint media until board cleanup", async () => {
    await withPipeline(async (f) => {
      let board = await create(f);
      const invitation = await f.app.inject({
        method: "POST",
        url: `/v1/canvas-boards/${board.id}/invitations`,
        headers: f.owner.headers,
        payload: { email: f.editor.email, role: "editor", operationId: randomUUID() },
      });
      expect(invitation.statusCode).toBe(201);
      expect(
        (
          await f.app.inject({
            method: "POST",
            url: `/v1/canvas-boards/invitations/${invitation.json().invitation.id}/accept`,
            headers: f.editor.headers,
            payload: {},
          })
        ).statusCode,
      ).toBe(200);
      const image = await upload(f, board, f.editor.headers),
        object = CanvasObjectCreateSchema.parse({
          id: randomUUID(),
          type: "image",
          mediaId: image.mediaId,
          altText: "Original synthetic HD image",
          x: 0,
          y: 0,
          width: 640,
          height: 360,
        });
      expect(await f.repository.getMediaAsset(f.editorWorkspaceId, image.mediaId)).toBeNull();
      board = await command(
        f,
        board,
        { type: "batch", operations: [{ type: "create", object }] },
        f.editor.headers,
      );
      const livePath = `/v1/canvas-boards/${board.id}/media/${image.mediaId}`;
      for (const headers of [f.owner.headers, f.editor.headers])
        await assertImage(f, livePath, headers, image.bytes);
      expect((await f.app.inject({ url: livePath })).statusCode).toBe(401);
      expect((await f.app.inject({ url: livePath, headers: f.outsider.headers })).statusCode).toBe(
        404,
      );
      const unrelated = await create(f),
        foreign = await f.app.inject({
          method: "POST",
          url: `/v1/canvas-boards/${unrelated.id}/commands`,
          headers: f.owner.headers,
          payload: {
            schemaVersion: CANVAS_SCHEMA_VERSION,
            operationId: randomUUID(),
            command: {
              type: "batch",
              operations: [{ type: "create", object: { ...object, id: randomUUID() } }],
            },
          },
        });
      expect(foreign.statusCode).toBe(404);
      expect(
        (
          await f.app.inject({
            url: `/v1/canvas-boards/${unrelated.id}/media/${image.mediaId}`,
            headers: f.owner.headers,
          })
        ).statusCode,
      ).toBe(404);
      const exported = await f.app.inject({
        method: "POST",
        url: `/v1/canvas-boards/${board.id}/export`,
        headers: f.owner.headers,
        payload: { schemaVersion: 1, format: "svg", region: null, background: "white" },
      });
      expect(exported.statusCode).toBe(200);
      const embedded = exported.body.match(/href="data:image\/png;base64,([A-Za-z0-9+/=]+)"/);
      expect(Boolean(embedded), "Export must contain a self-contained image").toBe(true);
      expect(digest(Buffer.from(embedded![1]!, "base64"))).toBe(digest(image.bytes));
      expect(
        /https?:\/\//.test(exported.body.replace('xmlns="http://www.w3.org/2000/svg"', "")),
      ).toBe(false);
      const versionId = randomUUID();
      await facilitate(f, board, {
        type: "version_create",
        versionId,
        name: "Real image checkpoint",
      });
      board = await command(f, board, {
        type: "batch",
        operations: [
          {
            type: "delete",
            id: object.id,
            expectedVersion: board.objects.find(({ id }) => id === object.id)!.version,
          },
        ],
      });
      expect((await f.app.inject({ url: livePath, headers: f.owner.headers })).statusCode).toBe(
        404,
      );
      const historyPath = `/v1/canvas-boards/${board.id}/versions/${versionId}`,
        saved = await f.app.inject({ url: historyPath, headers: f.owner.headers });
      expect(saved.statusCode).toBe(200);
      expect(CanvasVersionViewSchema.parse(saved.json()).objects.map(({ id }) => id)).toEqual([
        object.id,
      ]);
      await assertImage(f, `${historyPath}/media/${image.mediaId}`, f.editor.headers, image.bytes);
      // The scene is absent, while existing undo and named-version references still retain its bytes.
      const maintenance = await f.retention.run(new Date(Date.now() + 8 * 24 * 60 * 60_000));
      expect(maintenance.failedMedia).toBe(0);
      expect((await f.repository.getMediaAsset(f.workspaceId, image.mediaId))?.scanStatus).toBe(
        "clean",
      );
      await assertImage(f, `${historyPath}/media/${image.mediaId}`, f.owner.headers, image.bytes);
      expect(
        (
          await f.app.inject({
            method: "DELETE",
            url: `/v1/canvas-boards/${board.id}/grants/${f.editor.userId}`,
            headers: f.owner.headers,
          })
        ).statusCode,
      ).toBe(204);
      expect(
        (
          await f.app.inject({
            url: `${historyPath}/media/${image.mediaId}`,
            headers: f.editor.headers,
          })
        ).statusCode,
      ).toBe(404);
      await facilitate(f, board, { type: "version_delete", versionId, expectedVersion: 1 });
      expect(
        (
          await f.app.inject({
            url: `${historyPath}/media/${image.mediaId}`,
            headers: f.owner.headers,
          })
        ).statusCode,
      ).toBe(404);
      const asset = (await f.repository.getMediaAsset(f.workspaceId, image.mediaId))!;
      expect(
        (
          await f.app.inject({
            method: "DELETE",
            url: `/v1/canvas-boards/${board.id}`,
            headers: f.owner.headers,
          })
        ).statusCode,
      ).toBe(204);
      expect(await f.repository.listMediaReferences(f.workspaceId, image.mediaId)).toEqual([]);
      const cleanup = await f.retention.run(new Date(Date.now() + 8 * 24 * 60 * 60_000));
      expect(cleanup.failedMedia).toBe(0);
      expect(await f.repository.getMediaAsset(f.workspaceId, image.mediaId)).toBeNull();
      await expect(
        f.s3.send(new GetObjectCommand({ Bucket: f.bucket, Key: asset.objectKey })),
      ).rejects.toMatchObject({ $metadata: { httpStatusCode: 404 } });
      const remaining = await f.s3.send(new ListObjectsV2Command({ Bucket: f.bucket }));
      expect(remaining.Contents ?? []).toHaveLength(0);
    });
  }, 120_000);

  it("delivers real workshop images only after publication and removes guest access when unpublished", async () => {
    await withPipeline(async (f) => {
      expect(
        (
          await f.app.inject({
            method: "POST",
            url: `/v1/workspaces/${f.workspaceId}/select`,
            headers: f.owner.headers,
          })
        ).statusCode,
      ).toBe(200);
      const source = await f.app.inject({
        method: "POST",
        url: "/v1/idea-boards",
        headers: f.owner.headers,
        payload: {
          title: "Real-media guided workshop",
          ideasVisible: false,
          idempotencyKey: randomUUID(),
        },
      });
      expect(source.statusCode).toBe(201);
      const sourceId = source.json().board.id as string;
      let board = await create(f, sourceId);
      board = await command(f, board, {
        type: "workshop",
        expectedRevision: source.json().board.revision,
        command: { type: "collect" },
      });
      const guest = { authorization: `Bearer ${randomBytes(32).toString("hex")}` };
      expect(
        (
          await f.app.inject({
            method: "POST",
            url: `/v1/idea-boards/${sourceId}/join`,
            headers: guest,
            payload: {},
          })
        ).statusCode,
      ).toBe(200);
      const image = await upload(f, board, f.owner.headers),
        object = CanvasObjectCreateSchema.parse({
          id: randomUUID(),
          type: "image",
          mediaId: image.mediaId,
          altText: "Published synthetic HD image",
          x: 0,
          y: 0,
          width: 640,
          height: 360,
        });
      board = await command(f, board, { type: "batch", operations: [{ type: "create", object }] });
      const guestPath = `/v1/canvas-boards/workshop/${sourceId}/guest`,
        mediaPath = `${guestPath}/media/${image.mediaId}`;
      expect(
        (await f.app.inject({ url: mediaPath, headers: { ...guest, ...f.owner.headers } }))
          .statusCode,
      ).toBe(404);
      const privateView = await f.app.inject({ url: guestPath, headers: guest });
      expect(privateView.statusCode).toBe(200);
      expect(CanvasBoardGuestViewSchema.parse(privateView.json().board).objects).toHaveLength(0);
      board = await command(f, board, {
        type: "batch",
        operations: [
          {
            type: "update",
            id: object.id,
            expectedVersion: board.objects[0]!.version,
            patch: { visibility: "published" },
          },
        ],
      });
      await assertImage(f, mediaPath, guest, image.bytes);
      expect((await f.app.inject({ url: mediaPath, headers: f.owner.headers })).statusCode).toBe(
        401,
      );
      const versionId = randomUUID();
      await facilitate(f, board, {
        type: "version_create",
        versionId,
        name: "Private team history",
      });
      expect(
        (
          await f.app.inject({
            url: `/v1/canvas-boards/${board.id}/versions/${versionId}/media/${image.mediaId}`,
            headers: guest,
          })
        ).statusCode,
      ).toBe(401);
      board = await command(f, board, {
        type: "batch",
        operations: [
          {
            type: "update",
            id: object.id,
            expectedVersion: board.objects[0]!.version,
            patch: { visibility: "team" },
          },
        ],
      });
      expect(
        (await f.app.inject({ url: mediaPath, headers: { ...guest, ...f.owner.headers } }))
          .statusCode,
      ).toBe(404);
      await assertImage(
        f,
        `/v1/canvas-boards/${board.id}/versions/${versionId}/media/${image.mediaId}`,
        f.owner.headers,
        image.bytes,
      );
      expect(board.objects[0]!.visibility).toBe("team");
    });
  }, 120_000);
});
