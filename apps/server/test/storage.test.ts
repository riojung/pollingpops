import { randomUUID } from "node:crypto";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectTaggingCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import type { MediaAssetRecord } from "@openround/db";
import { describe, expect, it, vi } from "vitest";
import { ConfigSchema } from "../src/config.js";
import { mediaFinalizationObjectKey, StorageService } from "../src/storage.js";

function config() {
  return ConfigSchema.parse({
    NODE_ENV: "test",
    ALLOW_IN_MEMORY: "true",
    COMMUNITY_MODE: "false",
    WEB_ORIGIN: "http://localhost:3000",
    PUBLIC_API_URL: "http://localhost:4000",
    LOG_LEVEL: "silent",
    FEATURE_MEDIA_UPLOADS: "true",
    S3_ENDPOINT: "http://127.0.0.1:9000",
    S3_PUBLIC_ENDPOINT: "http://127.0.0.1:9000",
    S3_BUCKET: "openround-media",
    S3_ACCESS_KEY_ID: "test-access",
    S3_SECRET_ACCESS_KEY: "test-secret",
  });
}

function media(overrides: Partial<MediaAssetRecord> = {}): MediaAssetRecord {
  const workspaceId = randomUUID();
  const id = randomUUID();
  return {
    id,
    workspaceId,
    objectKey: `quarantine/${workspaceId}/${id}.png`,
    mimeType: "image/png",
    sizeBytes: 8,
    scanStatus: "finalizing",
    altText: "A diagram",
    createdAt: new Date("2026-09-27T00:00:00.000Z"),
    deletionStartedAt: null,
    finalizedAt: null,
    ...overrides,
  };
}

function mockClient(storage: StorageService, send: ReturnType<typeof vi.fn>) {
  Object.assign(storage as unknown as { internalClient: { send: typeof send } }, {
    internalClient: { send },
  });
}

describe("storage media fencing", () => {
  it("publishes only scanned bytes to the finalization token's candidate despite a quarantine overwrite", async () => {
    const asset = media();
    const token = randomUUID();
    const pngSignature = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const send = vi.fn(async (command: unknown) => {
      if (command instanceof HeadObjectCommand) {
        return {
          ContentLength: pngSignature.byteLength,
          ContentType: asset.mimeType,
          Metadata: { mediaid: asset.id },
        };
      }
      if (command instanceof GetObjectCommand) {
        return {
          Body: {
            transformToWebStream: () =>
              new ReadableStream({
                start(controller) {
                  controller.enqueue(pngSignature);
                  controller.close();
                },
              }),
          },
        };
      }
      if (command instanceof PutObjectCommand) return {};
      throw new Error("Unexpected storage command");
    });
    const scan = vi.fn(async (_bytes: Uint8Array) => ({ clean: true, signature: null }));
    const storage = new StorageService(config(), { scan });
    mockClient(storage, send);

    await expect(storage.finalize(asset, token)).resolves.toEqual({
      scanStatus: "clean",
      objectKey: mediaFinalizationObjectKey(asset, token),
    });
    const published = send.mock.calls
      .map(([command]) => command)
      .find((command) => command instanceof PutObjectCommand);
    expect(published?.input.Key).toBe(mediaFinalizationObjectKey(asset, token));
    expect(published?.input.Tagging).toBe("openround-finalization-state=temporary");
    expect(published?.input.Body).toEqual(Buffer.from(pngSignature));
    expect(published?.input.Body).toBe(scan.mock.calls[0]?.[0]);
    expect(published?.input.Metadata).toEqual({ mediaid: asset.id });
    expect(send.mock.calls.filter(([command]) => command instanceof GetObjectCommand)).toHaveLength(
      1,
    );
    expect(send.mock.calls.some(([command]) => command instanceof DeleteObjectCommand)).toBe(false);
  });

  it("cancels oversized image streams before scanning or publishing them", async () => {
    const asset = media();
    const cancel = vi.fn();
    const send = vi.fn(async (command: unknown) => {
      if (command instanceof HeadObjectCommand)
        return {
          ContentLength: asset.sizeBytes,
          ContentType: asset.mimeType,
          Metadata: { mediaid: asset.id },
        };
      if (command instanceof GetObjectCommand)
        return {
          Body: {
            transformToWebStream: () =>
              new ReadableStream({
                start(controller) {
                  controller.enqueue(new Uint8Array(10 * 1024 * 1024 + 1));
                },
                cancel,
              }),
          },
        };
      throw new Error("Unexpected storage command");
    });
    const scan = vi.fn();
    const storage = new StorageService(config(), { scan });
    mockClient(storage, send);
    await expect(storage.finalize(asset, randomUUID())).rejects.toThrow(/10 MB/);
    expect(cancel).toHaveBeenCalledOnce();
    expect(scan).not.toHaveBeenCalled();
    expect(send.mock.calls.some(([command]) => command instanceof PutObjectCommand)).toBe(false);
  });

  it("reads only clean images and rejects mismatched or oversized content", async () => {
    const bytes = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const asset = media({ scanStatus: "clean" });
    let uploadedBytes = bytes;
    const storage = new StorageService(config(), null);
    const send = vi.fn(async (command: unknown) => {
      if (command instanceof GetObjectCommand)
        return {
          Body: {
            transformToWebStream: () =>
              new ReadableStream({
                start(controller) {
                  controller.enqueue(uploadedBytes);
                  controller.close();
                },
              }),
          },
        };
      throw new Error("Unexpected storage command");
    });
    mockClient(storage, send);
    await expect(storage.readImage(asset)).resolves.toEqual(Buffer.from(bytes));
    await expect(storage.readImage(media({ scanStatus: "pending" }))).rejects.toThrow(
      /not available/,
    );
    uploadedBytes = new Uint8Array(8);
    await expect(storage.readImage(asset)).rejects.toThrow(/does not match/);
    uploadedBytes = new Uint8Array(10 * 1024 * 1024 + 1);
    await expect(storage.readImage(asset)).rejects.toThrow(/10 MB/);
  });

  it("makes only the claimed finalization candidate lifecycle-safe", async () => {
    const asset = media();
    const token = randomUUID();
    const objectKey = mediaFinalizationObjectKey(asset, token);
    const send = vi.fn(async (command: unknown) => {
      if (command instanceof PutObjectTaggingCommand) return {};
      throw new Error("Unexpected storage command");
    });
    const storage = new StorageService(config(), null);
    mockClient(storage, send);

    await storage.commitFinalizationCandidate(asset, token, objectKey);
    expect(send).toHaveBeenCalledTimes(1);
    expect((send.mock.calls[0]?.[0] as PutObjectTaggingCommand).input).toMatchObject({
      Key: objectKey,
      Tagging: {
        TagSet: [{ Key: "openround-finalization-state", Value: "committed" }],
      },
    });
    await expect(
      storage.commitFinalizationCandidate(
        asset,
        token,
        mediaFinalizationObjectKey(asset, randomUUID()),
      ),
    ).rejects.toThrow(/not scoped/);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("keeps the committed winner while removing quarantine, legacy, and loser objects", async () => {
    const base = media();
    const winnerToken = randomUUID();
    const loserToken = randomUUID();
    const winner = mediaFinalizationObjectKey(base, winnerToken);
    const loser = mediaFinalizationObjectKey(base, loserToken);
    const asset = media({
      ...base,
      scanStatus: "clean",
      objectKey: winner,
      finalizedAt: new Date(),
    });
    const send = vi.fn(async (command: unknown) => {
      if (command instanceof ListObjectsV2Command) {
        return { Contents: [{ Key: winner }, { Key: loser }], IsTruncated: false };
      }
      if (command instanceof PutObjectTaggingCommand) return {};
      if (command instanceof DeleteObjectCommand) return {};
      throw new Error("Unexpected storage command");
    });
    const storage = new StorageService(config(), null);
    mockClient(storage, send);

    await storage.cleanupFinalization(asset);

    const deleted = send.mock.calls
      .map(([command]) => command)
      .filter((command): command is DeleteObjectCommand => command instanceof DeleteObjectCommand)
      .map((command) => command.input.Key);
    expect(deleted).toContain(loser);
    expect(deleted).toContain(`quarantine/${asset.workspaceId}/${asset.id}.png`);
    expect(deleted).toContain(`media/${asset.workspaceId}/${asset.id}.png`);
    expect(deleted).not.toContain(winner);
    const committedTag = send.mock.calls
      .map(([command]) => command)
      .find((command) => command instanceof PutObjectTaggingCommand);
    expect(committedTag?.input).toMatchObject({
      Key: winner,
      Tagging: {
        TagSet: [{ Key: "openround-finalization-state", Value: "committed" }],
      },
    });
  });

  it("renews a cleanup claim before each listing page and stops when renewal fails", async () => {
    const base = media();
    const asset = media({
      ...base,
      scanStatus: "clean",
      objectKey: mediaFinalizationObjectKey(base, randomUUID()),
      finalizedAt: new Date(),
    });
    const send = vi.fn(async (command: unknown) => {
      if (command instanceof PutObjectTaggingCommand) return {};
      if (command instanceof ListObjectsV2Command) {
        return { Contents: [], IsTruncated: true, NextContinuationToken: "next" };
      }
      if (command instanceof DeleteObjectCommand) return {};
      throw new Error("Unexpected storage command");
    });
    const storage = new StorageService(config(), null);
    mockClient(storage, send);
    const beforePage = vi
      .fn<() => Promise<void>>()
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("claim lost"));

    await expect(storage.cleanupFinalization(asset, beforePage)).rejects.toThrow("claim lost");
    expect(beforePage).toHaveBeenCalledTimes(3);
    expect(
      send.mock.calls.filter(([command]) => command instanceof ListObjectsV2Command),
    ).toHaveLength(1);
    expect(send.mock.calls.some(([command]) => command instanceof DeleteObjectCommand)).toBe(false);
  });

  it("renews between bounded deletion batches", async () => {
    const base = media();
    const asset = media({
      ...base,
      scanStatus: "clean",
      objectKey: mediaFinalizationObjectKey(base, randomUUID()),
      finalizedAt: new Date(),
    });
    const send = vi.fn(async (command: unknown) => {
      if (command instanceof PutObjectTaggingCommand) return {};
      if (command instanceof ListObjectsV2Command) {
        return {
          Contents: Array.from({ length: 26 }, () => ({
            Key: mediaFinalizationObjectKey(base, randomUUID()),
          })),
          IsTruncated: false,
        };
      }
      if (command instanceof DeleteObjectCommand) return {};
      throw new Error("Unexpected storage command");
    });
    const storage = new StorageService(config(), null);
    mockClient(storage, send);
    const beforeWork = vi
      .fn<() => Promise<void>>()
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("claim lost"));

    await expect(storage.cleanupFinalization(asset, beforeWork)).rejects.toThrow("claim lost");
    expect(beforeWork).toHaveBeenCalledTimes(4);
    expect(
      send.mock.calls.filter(([command]) => command instanceof DeleteObjectCommand),
    ).toHaveLength(25);
  });

  it("refuses to clean a candidate that does not belong to the supplied token", async () => {
    const asset = media();
    const firstToken = randomUUID();
    const secondToken = randomUUID();
    const send = vi.fn(async (_command: unknown) => ({}));
    const storage = new StorageService(config(), null);
    mockClient(storage, send);

    await expect(
      storage.deleteFinalizationCandidate(
        asset,
        firstToken,
        mediaFinalizationObjectKey(asset, secondToken),
      ),
    ).rejects.toThrow(/not scoped/);
    expect(send).not.toHaveBeenCalled();

    await storage.deleteFinalizationCandidate(
      asset,
      firstToken,
      mediaFinalizationObjectKey(asset, firstToken),
    );
    const deletion = send.mock.calls[0]?.[0];
    expect(deletion).toBeInstanceOf(DeleteObjectCommand);
    expect((deletion as DeleteObjectCommand).input.Key).toBe(
      mediaFinalizationObjectKey(asset, firstToken),
    );
  });

  it("removes a candidate created after the first deletion sweep on the tombstone retry", async () => {
    const asset = media({ scanStatus: "deleting", deletionStartedAt: new Date() });
    const lateCandidate = mediaFinalizationObjectKey(asset, randomUUID());
    let listing = 0;
    const send = vi.fn(async (command: unknown) => {
      if (command instanceof ListObjectsV2Command) {
        listing += 1;
        return {
          Contents: listing === 1 ? [] : [{ Key: lateCandidate }],
          IsTruncated: false,
        };
      }
      if (command instanceof DeleteObjectCommand) return {};
      throw new Error("Unexpected storage command");
    });
    const storage = new StorageService(config(), null);
    mockClient(storage, send);

    await storage.deleteAsset(asset);
    expect(
      send.mock.calls.some(
        ([command]) =>
          command instanceof DeleteObjectCommand && command.input.Key === lateCandidate,
      ),
    ).toBe(false);

    await storage.deleteAsset(asset);
    expect(
      send.mock.calls.some(
        ([command]) =>
          command instanceof DeleteObjectCommand && command.input.Key === lateCandidate,
      ),
    ).toBe(true);
  });

  it("sweeps every quarantine and finalized object for a deleted workspace", async () => {
    const workspaceId = randomUUID();
    const quarantineKey = `quarantine/${workspaceId}/${randomUUID()}.png`;
    const cleanKey = `media/${workspaceId}/${randomUUID()}/${randomUUID()}.png`;
    const send = vi.fn(async (command: unknown) => {
      if (command instanceof ListObjectsV2Command) {
        if (command.input.Prefix === `quarantine/${workspaceId}/`) {
          return { Contents: [{ Key: quarantineKey }], IsTruncated: false };
        }
        if (command.input.Prefix === `media/${workspaceId}/`) {
          return { Contents: [{ Key: cleanKey }], IsTruncated: false };
        }
      }
      if (command instanceof DeleteObjectCommand) return {};
      throw new Error("Unexpected storage command");
    });
    const storage = new StorageService(config(), null);
    mockClient(storage, send);

    await expect(storage.deleteWorkspaceMediaObjects(workspaceId)).resolves.toBe(2);
    const deleted = send.mock.calls
      .map(([command]) => command)
      .filter((command): command is DeleteObjectCommand => command instanceof DeleteObjectCommand)
      .map((command) => command.input.Key)
      .sort();
    expect(deleted).toEqual([cleanKey, quarantineKey].sort());
  });
});
