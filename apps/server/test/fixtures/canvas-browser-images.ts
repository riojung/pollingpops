import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { StorageService } from "../../src/storage.js";
import { mediaFinalizationObjectKey } from "../../src/storage.js";

/** In-memory object storage for the isolated canvas browser fixture; never production IO. */
export function installCanvasBrowserImages(
  app: FastifyInstance,
  storage: StorageService,
  origin: string,
) {
  const tickets = new Map<string, { secret: string; expiresAt: number }>();
  const quarantine = new Map<string, Buffer>();
  const clean = new Map<string, Buffer>();
  const createUpload = storage.createUpload.bind(storage);
  storage.createUpload = async (input) => {
    const upload = await createUpload(input);
    const secret = randomUUID();
    tickets.set(upload.media.id, { secret, expiresAt: Date.now() + 600_000 });
    return {
      ...upload,
      uploadUrl: `${origin}/__test/canvas/storage/${upload.media.id}?ticket=${secret}`,
    };
  };
  app.addContentTypeParser(
    ["image/png", "image/jpeg", "image/webp"],
    { parseAs: "buffer" },
    (_request, body, done) => done(null, body),
  );
  app.put(
    "/__test/canvas/storage/:mediaId",
    { bodyLimit: 10 * 1024 * 1024 },
    async (request, reply) => {
      if (!["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(request.ip))
        return reply.code(403).send();
      const { mediaId } = z.object({ mediaId: z.string().uuid() }).parse(request.params);
      const { ticket } = z.object({ ticket: z.string().uuid() }).parse(request.query);
      const expected = tickets.get(mediaId);
      if (!expected || expected.secret !== ticket || expected.expiresAt <= Date.now())
        return reply.code(403).send();
      if (!Buffer.isBuffer(request.body) || !request.body.length) return reply.code(400).send();
      quarantine.set(mediaId, Buffer.from(request.body));
      return reply.code(204).send();
    },
  );
  storage.finalize = async (asset, token) => {
    const bytes = quarantine.get(asset.id);
    if (
      !bytes ||
      bytes.length !== asset.sizeBytes ||
      bytes.length < 8 ||
      bytes.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a"
    )
      throw new Error("Canvas browser fixture requires a complete PNG");
    const key = mediaFinalizationObjectKey(asset, token);
    clean.set(key, Buffer.from(bytes));
    return { scanStatus: "clean", objectKey: key };
  };
  storage.commitFinalizationCandidate = async () => {};
  storage.cleanupFinalization = async (asset) => {
    quarantine.delete(asset.id);
  };
  storage.deleteFinalizationCandidate = async (asset, token, objectKey) => {
    clean.delete(objectKey ?? mediaFinalizationObjectKey(asset, token));
  };
  storage.readImage = async (asset) => {
    const bytes = clean.get(asset.objectKey);
    if (!bytes) throw new Error("Canvas browser image unavailable");
    return Buffer.from(bytes);
  };
}
