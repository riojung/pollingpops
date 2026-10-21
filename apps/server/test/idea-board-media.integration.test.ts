import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  CreateBucketCommand,
  DeleteBucketCommand,
  DeleteObjectsCommand,
  ListObjectsV2Command,
  S3Client,
} from "@aws-sdk/client-s3";
import {
  IdeaBoardGuestViewSchema,
  IdeaBoardViewSchema,
  type IdeaBoardHostCommand,
} from "@openround/contracts";
import { MemoryRepository } from "@openround/db";
import type { FastifyInstance } from "fastify";
import { expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { MemorySessionCache } from "../src/cache.js";
import { ConfigSchema } from "../src/config.js";
import { ClamAvScanner } from "../src/malware-scanner.js";

// Opt in only with a disposable loopback object store and scanner; no production defaults.
const endpoint = process.env.IDEA_BOARD_PIPELINE_S3_ENDPOINT;
const scannerPort = process.env.IDEA_BOARD_PIPELINE_CLAMAV_PORT;
const accessKeyId = process.env.IDEA_BOARD_PIPELINE_ACCESS_KEY;
const secretAccessKey = process.env.IDEA_BOARD_PIPELINE_SECRET_KEY;
const enabled = Boolean(endpoint && scannerPort && accessKeyId && secretAccessKey);

it.skipIf(!enabled)(
  "uploads, scans and privately delivers real idea-board image bytes",
  async () => {
    const storageUrl = new URL(endpoint!);
    expect(storageUrl.protocol).toBe("http:");
    expect(storageUrl.hostname).toBe("127.0.0.1");
    expect(storageUrl.username + storageUrl.password).toBe("");
    const bucket = `idea-board-probe-${randomUUID()}`;
    const s3 = new S3Client({
      endpoint,
      region: "ca-central-1",
      forcePathStyle: true,
      credentials: { accessKeyId: accessKeyId!, secretAccessKey: secretAccessKey! },
    });
    let app: FastifyInstance | undefined;
    let bucketCreated = false;
    try {
      await s3.send(new CreateBucketCommand({ Bucket: bucket }));
      bucketCreated = true;
      const workspaceId = randomUUID();
      const repository = new MemoryRepository({ initialWorkspaceId: workspaceId });
      const config = ConfigSchema.parse({
        NODE_ENV: "test",
        ALLOW_IN_MEMORY: "true",
        LOG_LEVEL: "silent",
        WEB_ORIGIN: "http://localhost:3000",
        PUBLIC_API_URL: "http://localhost:4000",
        FEATURE_IDEA_BOARDS: "true",
        CORE_PARITY_WORKSPACE_ALLOWLIST: workspaceId,
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
      });
      const built = await buildApp(config, { repository, cache: new MemorySessionCache() });
      app = built.app;
      expect(built.storage.mediaUploadsEnabled).toBe(true);
      // Confirm the real signature-loaded daemon rejects the standard harmless scanner fixture.
      const scanner = new ClamAvScanner("127.0.0.1", Number(scannerPort), 30_000);
      const eicar = Buffer.from(
        "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*",
        "ascii",
      );
      expect(await scanner.scan(eicar)).toMatchObject({
        clean: false,
        signature: expect.stringMatching(/eicar/i),
      });
      const hash = (value: string) => createHash("sha256").update(value).digest("hex");
      const now = new Date(),
        tokenHash = hash(randomUUID());
      await repository.createMagicToken({
        id: randomUUID(),
        email: `${randomUUID()}@example.test`,
        segment: "workplace",
        tokenHash,
        policyVersion: "integration-test",
        expiresAt: new Date(+now + 60_000),
        consumedAt: null,
      });
      const owner = (await repository.consumeMagicToken(tokenHash, now))!;
      const session = randomBytes(32).toString("hex");
      await repository.createCreatorSession({
        id: randomUUID(),
        userId: owner.userId,
        activeWorkspaceId: workspaceId,
        tokenHash: hash(session),
        expiresAt: new Date(+now + 60_000),
      });
      const creator = { cookie: `${config.COOKIE_NAME}=${session}` };
      const created = await app.inject({
        method: "POST",
        url: "/v1/idea-boards",
        headers: creator,
        payload: {
          title: "Real scanned image pipeline",
          ideasVisible: false,
          idempotencyKey: randomUUID(),
        },
      });
      expect(created.statusCode, created.body).toBe(201);
      let board = IdeaBoardViewSchema.parse(created.json().board);
      const boardPath = `/v1/idea-boards/${board.id}`;
      const command = async (value: IdeaBoardHostCommand) => {
        const response = await app!.inject({
          method: "POST",
          url: `${boardPath}/commands`,
          headers: creator,
          payload: {
            command: value,
            expectedRevision: board.revision,
            idempotencyKey: randomUUID(),
          },
        });
        expect(response.statusCode, response.body).toBe(200);
        board = IdeaBoardViewSchema.parse(response.json().board);
      };
      await command({ type: "collect" });
      const author = { authorization: `Bearer ${randomBytes(32).toString("hex")}` };
      const other = { authorization: `Bearer ${randomBytes(32).toString("hex")}` };
      for (const headers of [author, other]) {
        const joined = await app.inject({
          method: "POST",
          url: `${boardPath}/join`,
          headers,
          payload: {},
        });
        expect(joined.statusCode, joined.body).toBe(200);
      }
      const png = Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
        "base64",
      );
      const ticketResponse = await app.inject({
        method: "POST",
        url: `${boardPath}/media`,
        headers: author,
        payload: {
          fileName: "real-pipeline.png",
          mimeType: "image/png",
          sizeBytes: png.length,
          altText: "A real scanned one-pixel image",
        },
      });
      expect(ticketResponse.statusCode).toBe(201);
      const ticket = ticketResponse.json<{ mediaId: string; uploadUrl: string }>();
      const uploaded = await fetch(ticket.uploadUrl, {
        method: "PUT",
        headers: { "content-type": "image/png" },
        body: Uint8Array.from(png).buffer,
      });
      expect(uploaded.status).toBe(200);
      const completed = await app.inject({
        method: "POST",
        url: `${boardPath}/media/${ticket.mediaId}/complete`,
        headers: author,
      });
      expect(completed.statusCode, completed.body).toBe(200);
      expect(completed.json().media.scanStatus).toBe("clean");
      expect(completed.json()).not.toHaveProperty("downloadUrl");
      const submitted = await app.inject({
        method: "POST",
        url: `${boardPath}/ideas`,
        headers: author,
        payload: {
          body: "A proposal with a real scanned image",
          idempotencyKey: randomUUID(),
          attachments: [{ mediaId: ticket.mediaId, alt: "A real scanned one-pixel image" }],
        },
      });
      expect(submitted.statusCode, submitted.body).toBe(200);
      const own = IdeaBoardGuestViewSchema.parse(submitted.json());
      const ideaId = own.ownIdeas[0]!.id;
      board = own.board;
      const contentPath = `${boardPath}/media/${ticket.mediaId}/content`;
      const ownContent = await app.inject({ method: "GET", url: contentPath, headers: author });
      expect(ownContent.statusCode).toBe(200);
      expect(ownContent.rawPayload).toEqual(png);
      expect(ownContent.headers).toMatchObject({
        "content-type": "image/png",
        "cache-control": "private, no-store",
      });
      expect(
        (await app.inject({ method: "GET", url: contentPath, headers: other })).statusCode,
      ).toBe(404);
      await command({ type: "moderate", ideaId, status: "approved" });
      expect(
        (await app.inject({ method: "GET", url: contentPath, headers: other })).statusCode,
      ).toBe(404);
      await command({ type: "visibility", visible: true });
      const visibleContent = await app.inject({ method: "GET", url: contentPath, headers: other });
      expect(visibleContent.statusCode).toBe(200);
      expect(visibleContent.rawPayload).toEqual(png);
      expect(
        (await app.inject({ method: "GET", url: `/v1/media/${ticket.mediaId}`, headers: creator }))
          .statusCode,
      ).toBe(404);
      await command({ type: "moderate", ideaId, status: "removed" });
      for (const headers of [author, other, creator])
        expect((await app.inject({ method: "GET", url: contentPath, headers })).statusCode).toBe(
          404,
        );
      expect(await repository.getMediaAsset(workspaceId, ticket.mediaId)).toMatchObject({
        scanStatus: "deleting",
      });
    } finally {
      await app?.close();
      try {
        if (bucketCreated) {
          const objects = await s3.send(new ListObjectsV2Command({ Bucket: bucket }));
          if (objects.Contents?.length)
            await s3.send(
              new DeleteObjectsCommand({
                Bucket: bucket,
                Delete: {
                  Objects: objects.Contents.map((object) => ({ Key: object.Key! })),
                  Quiet: true,
                },
              }),
            );
          await s3.send(new DeleteBucketCommand({ Bucket: bucket }));
        }
      } finally {
        s3.destroy();
      }
    }
  },
  60_000,
);
