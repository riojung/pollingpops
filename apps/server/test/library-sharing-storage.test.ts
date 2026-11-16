import { randomUUID } from "node:crypto";
import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import type { MediaAssetRecord } from "@openround/db";
import { describe, expect, it, vi } from "vitest";
import { ConfigSchema } from "../src/config.js";
import { StorageService } from "../src/storage.js";

function fixture(bytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) {
  const sourceId = randomUUID(),
    sourceWorkspace = randomUUID(),
    id = randomUUID(),
    workspaceId = randomUUID();
  const source: MediaAssetRecord = {
    id: sourceId,
    workspaceId: sourceWorkspace,
    objectKey: `media/${sourceWorkspace}/${sourceId}/scanned.png`,
    mimeType: "image/png",
    sizeBytes: 8,
    scanStatus: "clean",
    altText: "A diagram",
    createdAt: new Date(),
    deletionStartedAt: null,
    finalizedAt: null,
  };
  const destination: MediaAssetRecord = {
    ...source,
    id,
    workspaceId,
    objectKey: `media/${workspaceId}/${id}.png`,
  };
  const storage = new StorageService(
    ConfigSchema.parse({
      NODE_ENV: "test",
      ALLOW_IN_MEMORY: "true",
      COMMUNITY_MODE: "false",
      WEB_ORIGIN: "http://localhost:3000",
      PUBLIC_API_URL: "http://localhost:4000",
      LOG_LEVEL: "silent",
      S3_ENDPOINT: "http://127.0.0.1:9000",
      S3_BUCKET: "library-test",
      S3_ACCESS_KEY_ID: "test",
      S3_SECRET_ACCESS_KEY: "test",
    }),
    null,
  );
  const send = vi.fn(async (command: unknown) => {
    if (command instanceof GetObjectCommand)
      return {
        Body: {
          transformToWebStream: () =>
            new ReadableStream({
              start(controller) {
                controller.enqueue(bytes);
                controller.close();
              },
            }),
        },
      };
    return {};
  });
  Object.assign(storage, { internalClient: { send } });
  return { source, destination, storage, send, bytes };
}

describe("Library physical media copies", () => {
  it("writes the exact verified clean bytes to a distinct recipient object without requiring a new upload scanner", async () => {
    const f = fixture();
    await f.storage.cloneLibraryImage(f.source, f.destination);
    const commands = f.send.mock.calls.map(([command]) => command);
    expect(commands[0]).toBeInstanceOf(GetObjectCommand);
    expect((commands[0] as GetObjectCommand).input.Key).toBe(f.source.objectKey);
    expect(commands[1]).toBeInstanceOf(PutObjectCommand);
    expect((commands[1] as PutObjectCommand).input).toMatchObject({
      Key: f.destination.objectKey,
      Body: f.bytes,
      ContentType: "image/png",
      ContentLength: 8,
      Metadata: { mediaid: f.destination.id, scanstatus: "clean" },
    });
  });

  it("rejects unclean, deleting, shared-key and foreign-key destinations before storage access", async () => {
    const f = fixture();
    await expect(
      f.storage.cloneLibraryImage({ ...f.source, scanStatus: "rejected" }, f.destination),
    ).rejects.toThrow();
    await expect(
      f.storage.cloneLibraryImage({ ...f.source, deletionStartedAt: new Date() }, f.destination),
    ).rejects.toThrow();
    await expect(
      f.storage.cloneLibraryImage(f.source, { ...f.destination, id: f.source.id }),
    ).rejects.toThrow();
    await expect(
      f.storage.cloneLibraryImage(f.source, { ...f.destination, objectKey: f.source.objectKey }),
    ).rejects.toThrow();
    expect(f.send).not.toHaveBeenCalled();
  });

  it("does not create a clean recipient object when source bytes fail signature verification", async () => {
    const f = fixture(Buffer.alloc(8));
    await expect(f.storage.cloneLibraryImage(f.source, f.destination)).rejects.toThrow(
      "scanned image",
    );
    expect(f.send.mock.calls.some(([command]) => command instanceof PutObjectCommand)).toBe(false);
  });
});
