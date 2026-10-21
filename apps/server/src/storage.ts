import { randomUUID } from "node:crypto";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectTaggingCommand,
  PutObjectCommand,
  S3Client,
  type GetObjectCommandOutput,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { MediaAssetRecord } from "@openround/db";
import type { AppConfig } from "./config.js";
import type { MalwareScanner } from "./malware-scanner.js";

const mimeExtensions = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
} as const;

type AllowedMimeType = keyof typeof mimeExtensions;

function cleanObjectKey(asset: MediaAssetRecord) {
  return `media/${asset.workspaceId}/${asset.id}.${mimeExtensions[asset.mimeType]}`;
}

function quarantineObjectKey(asset: MediaAssetRecord) {
  return `quarantine/${asset.workspaceId}/${asset.id}.${mimeExtensions[asset.mimeType]}`;
}

function finalizationObjectPrefix(asset: MediaAssetRecord) {
  return `media/${asset.workspaceId}/${asset.id}/`;
}

function validFinalizationToken(token: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(token);
}

export function mediaFinalizationObjectKey(asset: MediaAssetRecord, finalizationToken: string) {
  if (!validFinalizationToken(finalizationToken))
    throw new Error("Invalid media finalization token");
  return `${finalizationObjectPrefix(asset)}${finalizationToken}.${mimeExtensions[asset.mimeType]}`;
}

const STORAGE_OPERATION_TIMEOUT_MS = 60_000;
const FINALIZATION_STATE_TAG = "openround-finalization-state";
const FINALIZATION_TEMPORARY_TAGGING = `${FINALIZATION_STATE_TAG}=temporary`;

function validSignature(content: Uint8Array, mimeType: AllowedMimeType) {
  if (mimeType === "image/jpeg") {
    return content.length >= 3 && content[0] === 0xff && content[1] === 0xd8 && content[2] === 0xff;
  }
  if (mimeType === "image/png") {
    const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    return signature.every((value, index) => content[index] === value);
  }
  return (
    content.length >= 12 &&
    Buffer.from(content.subarray(0, 4)).toString("ascii") === "RIFF" &&
    Buffer.from(content.subarray(8, 12)).toString("ascii") === "WEBP"
  );
}

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

async function boundedImageBytes(body: GetObjectCommandOutput["Body"]) {
  if (!body) throw new Error("Uploaded media content is unavailable");
  const reader = body.transformToWebStream().getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return Buffer.concat(chunks, size);
      size += value.byteLength;
      if (size > MAX_IMAGE_BYTES) throw new Error("Images must be 10 MB or smaller");
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
}

export class StorageService {
  private readonly internalClient: S3Client | null;
  private readonly publicClient: S3Client | null;

  constructor(
    private readonly config: AppConfig,
    private readonly scanner: MalwareScanner | null,
  ) {
    const clientOptions = {
      region: config.S3_REGION,
      forcePathStyle: config.S3_FORCE_PATH_STYLE,
      credentials:
        config.S3_ACCESS_KEY_ID && config.S3_SECRET_ACCESS_KEY
          ? {
              accessKeyId: config.S3_ACCESS_KEY_ID,
              secretAccessKey: config.S3_SECRET_ACCESS_KEY,
            }
          : undefined,
    };
    this.internalClient = config.S3_ENDPOINT
      ? new S3Client({ ...clientOptions, endpoint: config.S3_ENDPOINT })
      : null;
    const publicEndpoint = config.S3_PUBLIC_ENDPOINT ?? config.S3_ENDPOINT;
    this.publicClient = publicEndpoint
      ? new S3Client({ ...clientOptions, endpoint: publicEndpoint })
      : null;
  }

  get configured() {
    return this.internalClient !== null && this.publicClient !== null;
  }

  get mediaUploadsEnabled() {
    return this.config.FEATURE_MEDIA_UPLOADS && this.configured && this.scanner !== null;
  }

  async createUpload(input: {
    workspaceId: string;
    fileName: string;
    mimeType: string;
    sizeBytes: number;
    altText: string;
  }) {
    if (!this.publicClient || !this.mediaUploadsEnabled)
      throw new Error("Media uploads require object storage and malware scanning");
    if (!(input.mimeType in mimeExtensions))
      throw new Error("Only JPEG, PNG, and WebP images are accepted");
    if (input.sizeBytes < 1 || input.sizeBytes > 10 * 1024 * 1024)
      throw new Error("Images must be 10 MB or smaller");
    if (!input.altText.trim()) throw new Error("Alternative text is required");
    const mimeType = input.mimeType as AllowedMimeType;
    const mediaId = randomUUID();
    const objectKey = `quarantine/${input.workspaceId}/${mediaId}.${mimeExtensions[mimeType]}`;
    const command = new PutObjectCommand({
      Bucket: this.config.S3_BUCKET,
      Key: objectKey,
      ContentType: mimeType,
      ContentLength: input.sizeBytes,
      Metadata: {
        mediaId,
        originalName: encodeURIComponent(input.fileName.slice(0, 200)),
        scanStatus: "pending",
      },
    });
    const uploadUrl = await getSignedUrl(this.publicClient, command, { expiresIn: 10 * 60 });
    return {
      media: {
        id: mediaId,
        workspaceId: input.workspaceId,
        objectKey,
        mimeType,
        sizeBytes: input.sizeBytes,
        scanStatus: "pending" as const,
        altText: input.altText.trim(),
        createdAt: new Date(),
        deletionStartedAt: null,
        finalizedAt: null,
      } satisfies MediaAssetRecord,
      uploadUrl,
      expiresInSeconds: 600,
    };
  }

  async finalize(
    asset: MediaAssetRecord,
    finalizationToken: string,
  ): Promise<{ scanStatus: "clean" | "rejected"; objectKey: string }> {
    if (!this.internalClient || !this.scanner) throw new Error("Media scanning is not configured");
    if (asset.scanStatus !== "finalizing") {
      throw new Error("Media finalization requires a durable finalizing claim");
    }
    const promotedObjectKey = mediaFinalizationObjectKey(asset, finalizationToken);
    const sourceObjectKey = asset.objectKey;
    const head = await this.internalClient.send(
      new HeadObjectCommand({ Bucket: this.config.S3_BUCKET, Key: sourceObjectKey }),
      { abortSignal: AbortSignal.timeout(STORAGE_OPERATION_TIMEOUT_MS) },
    );
    const metadataMatches =
      head.ContentLength === asset.sizeBytes &&
      head.ContentType === asset.mimeType &&
      head.Metadata?.mediaid === asset.id;
    if (!metadataMatches) {
      return { scanStatus: "rejected" as const, objectKey: asset.objectKey };
    }
    const object = await this.internalClient.send(
      new GetObjectCommand({ Bucket: this.config.S3_BUCKET, Key: sourceObjectKey }),
      { abortSignal: AbortSignal.timeout(STORAGE_OPERATION_TIMEOUT_MS) },
    );
    const content = await boundedImageBytes(object.Body);
    if (content.byteLength !== asset.sizeBytes || !validSignature(content, asset.mimeType)) {
      return { scanStatus: "rejected" as const, objectKey: asset.objectKey };
    }
    const scan = await this.scanner.scan(content);
    if (!scan.clean) {
      return { scanStatus: "rejected" as const, objectKey: asset.objectKey };
    }

    await this.internalClient.send(
      // The quarantined PUT remains usable until its ticket expires. Publish the exact
      // bytes we scanned rather than copying a source that may have been overwritten.
      new PutObjectCommand({
        Bucket: this.config.S3_BUCKET,
        Key: promotedObjectKey,
        Body: content,
        ContentType: asset.mimeType,
        ContentLength: content.byteLength,
        Metadata: head.Metadata,
        Tagging: FINALIZATION_TEMPORARY_TAGGING,
      }),
      { abortSignal: AbortSignal.timeout(STORAGE_OPERATION_TIMEOUT_MS) },
    );
    return { scanStatus: "clean" as const, objectKey: promotedObjectKey };
  }

  async deleteFinalizationCandidate(
    asset: MediaAssetRecord,
    finalizationToken: string,
    objectKey?: string,
  ) {
    const expectedObjectKey = mediaFinalizationObjectKey(asset, finalizationToken);
    if (objectKey !== undefined && objectKey !== expectedObjectKey) {
      throw new Error("Finalization cleanup is not scoped to the claimed token");
    }
    await this.deleteObject(expectedObjectKey);
  }

  async commitFinalizationCandidate(
    asset: MediaAssetRecord,
    finalizationToken: string,
    objectKey: string,
  ) {
    if (!this.internalClient) throw new Error("Object storage is not configured");
    if (asset.scanStatus !== "finalizing") {
      throw new Error("Media finalization requires a durable finalizing claim");
    }
    const expectedObjectKey = mediaFinalizationObjectKey(asset, finalizationToken);
    if (objectKey !== expectedObjectKey) {
      throw new Error("Finalization commit is not scoped to the claimed token");
    }
    await this.internalClient.send(
      new PutObjectTaggingCommand({
        Bucket: this.config.S3_BUCKET,
        Key: expectedObjectKey,
        Tagging: {
          TagSet: [{ Key: FINALIZATION_STATE_TAG, Value: "committed" }],
        },
      }),
      { abortSignal: AbortSignal.timeout(STORAGE_OPERATION_TIMEOUT_MS) },
    );
  }

  async cleanupFinalization(asset: MediaAssetRecord, beforeWork?: () => Promise<void>) {
    if (!this.internalClient) throw new Error("Object storage is not configured");
    await beforeWork?.();
    if (asset.scanStatus === "clean") {
      await this.internalClient.send(
        new PutObjectTaggingCommand({
          Bucket: this.config.S3_BUCKET,
          Key: asset.objectKey,
          Tagging: {
            TagSet: [{ Key: FINALIZATION_STATE_TAG, Value: "committed" }],
          },
        }),
        { abortSignal: AbortSignal.timeout(STORAGE_OPERATION_TIMEOUT_MS) },
      );
    }
    const candidates = await this.listFinalizationCandidates(asset, beforeWork);
    const keys = new Set([quarantineObjectKey(asset), cleanObjectKey(asset), ...candidates]);
    if (asset.scanStatus === "clean") keys.delete(asset.objectKey);
    const keysToDelete = [...keys];
    for (let index = 0; index < keysToDelete.length; index += 25) {
      await beforeWork?.();
      await Promise.all(keysToDelete.slice(index, index + 25).map((key) => this.deleteObject(key)));
    }
  }

  async createDownloadUrl(asset: MediaAssetRecord) {
    if (!this.publicClient || asset.scanStatus !== "clean")
      throw new Error("Media is not available");
    return getSignedUrl(
      this.publicClient,
      new GetObjectCommand({ Bucket: this.config.S3_BUCKET, Key: asset.objectKey }),
      { expiresIn: 5 * 60 },
    );
  }

  async readImage(asset: MediaAssetRecord) {
    if (!this.internalClient || asset.scanStatus !== "clean")
      throw new Error("Media is not available");
    const object = await this.internalClient.send(
      new GetObjectCommand({ Bucket: this.config.S3_BUCKET, Key: asset.objectKey }),
      { abortSignal: AbortSignal.timeout(STORAGE_OPERATION_TIMEOUT_MS) },
    );
    const content = await boundedImageBytes(object.Body);
    if (content.byteLength !== asset.sizeBytes || !validSignature(content, asset.mimeType))
      throw new Error("Media content does not match the scanned image");
    return content;
  }

  async deleteAsset(asset: MediaAssetRecord) {
    if (!this.internalClient) throw new Error("Object storage is not configured");
    const candidates = await this.listFinalizationCandidates(asset);
    const keys = new Set([
      asset.objectKey,
      quarantineObjectKey(asset),
      cleanObjectKey(asset),
      ...candidates,
    ]);
    await Promise.all([...keys].map((objectKey) => this.deleteObject(objectKey)));
  }

  async deleteWorkspaceMediaObjects(workspaceId: string) {
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
        workspaceId,
      )
    ) {
      throw new Error("Workspace media cleanup requires a UUID workspace ID");
    }
    let deleted = 0;
    for (const prefix of [`quarantine/${workspaceId}/`, `media/${workspaceId}/`]) {
      deleted += await this.deleteObjectPrefix(prefix);
    }
    return deleted;
  }

  private async listFinalizationCandidates(
    asset: MediaAssetRecord,
    beforePage?: () => Promise<void>,
  ) {
    return this.listObjectKeys(finalizationObjectPrefix(asset), beforePage);
  }

  private async listObjectKeys(prefix: string, beforePage?: () => Promise<void>) {
    if (!this.internalClient) throw new Error("Object storage is not configured");
    const keys: string[] = [];
    let continuationToken: string | undefined;
    do {
      await beforePage?.();
      const page = await this.internalClient.send(
        new ListObjectsV2Command({
          Bucket: this.config.S3_BUCKET,
          Prefix: prefix,
          ContinuationToken: continuationToken,
        }),
        { abortSignal: AbortSignal.timeout(STORAGE_OPERATION_TIMEOUT_MS) },
      );
      for (const object of page.Contents ?? []) {
        if (object.Key) keys.push(object.Key);
      }
      continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
      if (page.IsTruncated && !continuationToken) {
        throw new Error("Object storage returned a truncated media listing without a cursor");
      }
    } while (continuationToken);
    return keys;
  }

  private async deleteObjectPrefix(prefix: string) {
    if (!this.internalClient) throw new Error("Object storage is not configured");
    let continuationToken: string | undefined;
    let deleted = 0;
    do {
      const page = await this.internalClient.send(
        new ListObjectsV2Command({
          Bucket: this.config.S3_BUCKET,
          Prefix: prefix,
          ContinuationToken: continuationToken,
          MaxKeys: 1_000,
        }),
        { abortSignal: AbortSignal.timeout(STORAGE_OPERATION_TIMEOUT_MS) },
      );
      const keys = (page.Contents ?? []).flatMap((object) => (object.Key ? [object.Key] : []));
      // Keep retry pressure bounded even when a workspace contains many objects.
      for (let index = 0; index < keys.length; index += 25) {
        const batch = keys.slice(index, index + 25);
        await Promise.all(batch.map((objectKey) => this.deleteObject(objectKey)));
      }
      deleted += keys.length;
      continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
      if (page.IsTruncated && !continuationToken) {
        throw new Error("Object storage returned a truncated media listing without a cursor");
      }
    } while (continuationToken);
    return deleted;
  }

  private async deleteObject(objectKey: string) {
    if (!this.internalClient) throw new Error("Object storage is not configured");
    await this.internalClient.send(
      new DeleteObjectCommand({ Bucket: this.config.S3_BUCKET, Key: objectKey }),
      { abortSignal: AbortSignal.timeout(STORAGE_OPERATION_TIMEOUT_MS) },
    );
  }
}
