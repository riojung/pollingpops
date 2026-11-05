/** Opt-in synthetic browser fixture. Never a production storage/scanner implementation. */
import { createHash, randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

const MAX_REQUEST_BYTES = 10_000_000;
const MAX_STORE_BYTES = 100_000_000;
const xml = (value: string) =>
  value.replace(
    /[<>&"']/g,
    (character) =>
      ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[character]!,
  );
interface ObjectValue {
  body: Buffer;
  contentType: string;
  metadata: Record<string, string>;
  tags: string;
  modified: string;
  etag: string;
}

async function boundedBody(request: IncomingMessage) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const data = Buffer.from(chunk);
    size += data.length;
    if (size > MAX_REQUEST_BYTES) throw new Error("request_limit");
    chunks.push(data);
  }
  const bytes = Buffer.concat(chunks);
  if (!String(request.headers["content-encoding"] ?? "").includes("aws-chunked")) return bytes;
  const decoded: Buffer[] = [];
  let offset = 0;
  while (offset < bytes.length) {
    const end = bytes.indexOf("\r\n", offset);
    if (end < 0) throw new Error("chunk_framing");
    const lengthText = bytes.toString("ascii", offset, end).split(";")[0]!;
    if (!/^[a-f0-9]+$/i.test(lengthText)) throw new Error("chunk_framing");
    const length = Number.parseInt(lengthText, 16);
    if (length === 0) break;
    offset = end + 2;
    if (
      length > bytes.length - offset ||
      bytes.toString("ascii", offset + length, offset + length + 2) !== "\r\n"
    )
      throw new Error("chunk_framing");
    decoded.push(bytes.subarray(offset, offset + length));
    offset += length + 2;
  }
  return Buffer.concat(decoded);
}

async function main() {
  if (
    process.env.BETA_E2E_VISUAL_IMPORTS !== "true" ||
    process.env.NODE_ENV !== "test" ||
    process.env.ALLOW_IN_MEMORY !== "true"
  )
    throw new Error(
      "This fixture requires explicit beta visual-import opt-in and an in-memory test environment",
    );
  if (process.env.DATABASE_URL || process.env.REDIS_URL)
    throw new Error("This fixture refuses external databases and caches");
  const apiPort = Number(process.env.PORT ?? 4200);
  const storagePort = Number(process.env.BETA_E2E_VISUAL_STORAGE_PORT ?? apiPort + 3);
  if (
    ![apiPort, storagePort].every((port) => Number.isInteger(port) && port > 0 && port <= 65535) ||
    apiPort === storagePort
  )
    throw new Error("Invalid loopback fixture ports");
  const webOrigin = new URL(process.env.WEB_ORIGIN ?? "http://127.0.0.1:3200");
  if (webOrigin.protocol !== "http:" || webOrigin.hostname !== "127.0.0.1")
    throw new Error("This fixture requires a loopback browser origin");
  const bucket = `beta-visual-${randomUUID()}`;
  const objects = new Map<string, ObjectValue>();
  let storeBytes = 0;
  const storage = createServer((request, response) => {
    response.setHeader("access-control-allow-origin", webOrigin.origin);
    response.setHeader("access-control-allow-methods", "GET,HEAD,PUT,POST,DELETE,OPTIONS");
    response.setHeader("access-control-allow-headers", "*");
    response.setHeader("access-control-expose-headers", "etag,content-length,content-type");
    response.setHeader("cache-control", "no-store");
    void handle(request, response).catch(() => {
      if (!response.headersSent) error(response, 400, "InvalidRequest");
      else response.end();
    });
  });
  storage.requestTimeout = 15_000;
  storage.headersTimeout = 10_000;
  function error(response: ServerResponse, status: number, code: string) {
    response.writeHead(status, { "content-type": "application/xml" });
    response.end(
      `<Error><Code>${code}</Code><Message>Synthetic object-store request rejected</Message></Error>`,
    );
  }
  function sendXml(response: ServerResponse, body: string) {
    response.writeHead(200, { "content-type": "application/xml" });
    response.end(body);
  }
  async function handle(request: IncomingMessage, response: ServerResponse) {
    if (request.method === "OPTIONS") {
      response.writeHead(204);
      response.end();
      return;
    }
    if (request.headers.origin && request.headers.origin !== webOrigin.origin) {
      error(response, 403, "AccessDenied");
      return;
    }
    const url = new URL(request.url ?? "/", `http://127.0.0.1:${storagePort}`);
    const [requestBucket, ...parts] = url.pathname.slice(1).split("/").map(decodeURIComponent);
    if (requestBucket !== bucket) {
      error(response, 404, "NoSuchBucket");
      return;
    }
    const key = parts.join("/");
    if (key.length > 1024 || key.includes("\0")) {
      error(response, 400, "InvalidArgument");
      return;
    }
    if (request.method === "GET" && !key && url.searchParams.get("list-type") === "2") {
      const prefix = url.searchParams.get("prefix") ?? "";
      const matching = [...objects.entries()]
        .filter(([name]) => name.startsWith(prefix))
        .sort(([left], [right]) => left.localeCompare(right));
      sendXml(
        response,
        `<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Name>${bucket}</Name><Prefix>${xml(prefix)}</Prefix><KeyCount>${matching.length}</KeyCount><MaxKeys>1000</MaxKeys><IsTruncated>false</IsTruncated>${matching.map(([name, value]) => `<Contents><Key>${xml(name)}</Key><LastModified>${value.modified}</LastModified><ETag>${xml(value.etag)}</ETag><Size>${value.body.length}</Size><StorageClass>STANDARD</StorageClass></Contents>`).join("")}</ListBucketResult>`,
      );
      return;
    }
    if (!key && request.method === "HEAD") {
      response.writeHead(200);
      response.end();
      return;
    }
    if (!key && request.method === "POST" && url.searchParams.has("delete")) {
      const body = (await boundedBody(request)).toString("utf8");
      const keys = [...body.matchAll(/<Key>([^<]*)<\/Key>/g)].map((match) =>
        match[1]!.replaceAll("&amp;", "&").replaceAll("&lt;", "<").replaceAll("&gt;", ">"),
      );
      for (const name of keys) {
        const value = objects.get(name);
        if (value) storeBytes -= value.body.length;
        objects.delete(name);
      }
      sendXml(
        response,
        `<DeleteResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">${keys.map((name) => `<Deleted><Key>${xml(name)}</Key></Deleted>`).join("")}</DeleteResult>`,
      );
      return;
    }
    if (!key) {
      error(response, 405, "MethodNotAllowed");
      return;
    }
    const current = objects.get(key);
    if (request.method === "DELETE") {
      if (url.searchParams.has("tagging")) {
        if (current) current.tags = "";
      } else {
        if (current) storeBytes -= current.body.length;
        objects.delete(key);
      }
      response.writeHead(204);
      response.end();
      return;
    }
    if (request.method === "PUT" && url.searchParams.has("tagging")) {
      if (!current) {
        error(response, 404, "NoSuchKey");
        return;
      }
      current.tags = (await boundedBody(request)).toString("utf8");
      response.writeHead(200);
      response.end();
      return;
    }
    if (request.method === "GET" && url.searchParams.has("tagging")) {
      if (!current) {
        error(response, 404, "NoSuchKey");
        return;
      }
      sendXml(
        response,
        current.tags ||
          '<Tagging xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><TagSet/></Tagging>',
      );
      return;
    }
    if (request.method === "PUT") {
      const body = await boundedBody(request);
      const nextSize = storeBytes - (current?.body.length ?? 0) + body.length;
      if (nextSize > MAX_STORE_BYTES) {
        error(response, 507, "InsufficientStorage");
        return;
      }
      const metadata: Record<string, string> = {};
      for (const [name, value] of Object.entries(request.headers)) {
        if (name.startsWith("x-amz-meta-") && typeof value === "string")
          metadata[name.slice(11).toLowerCase()] = value;
      }
      // Presigned browser PUTs can hoist metadata into the signed query string.
      for (const [name, value] of url.searchParams)
        if (name.toLowerCase().startsWith("x-amz-meta-"))
          metadata[name.slice(11).toLowerCase()] = value;
      const etag = `"${createHash("md5").update(body).digest("hex")}"`;
      objects.set(key, {
        body,
        contentType: String(request.headers["content-type"] ?? "application/octet-stream"),
        metadata,
        tags: "",
        modified: new Date().toISOString(),
        etag,
      });
      storeBytes = nextSize;
      response.writeHead(200, { etag });
      response.end();
      return;
    }
    if (request.method === "GET" || request.method === "HEAD") {
      if (!current) {
        error(response, 404, "NoSuchKey");
        return;
      }
      response.writeHead(200, {
        "content-type": current.contentType,
        "content-length": current.body.length,
        etag: current.etag,
        "last-modified": new Date(current.modified).toUTCString(),
        ...Object.fromEntries(
          Object.entries(current.metadata).map(([name, value]) => [`x-amz-meta-${name}`, value]),
        ),
      });
      response.end(request.method === "HEAD" ? undefined : current.body);
      return;
    }
    error(response, 405, "MethodNotAllowed");
  }

  await new Promise<void>((resolve, reject) => {
    storage.once("error", reject);
    storage.listen(storagePort, "127.0.0.1", () => {
      storage.off("error", reject);
      resolve();
    });
  });
  Object.assign(process.env, {
    HOST: "127.0.0.1",
    FEATURE_MEDIA_UPLOADS: "true",
    MEDIA_SCAN_MODE: "disabled",
    S3_ENDPOINT: `http://127.0.0.1:${storagePort}`,
    S3_PUBLIC_ENDPOINT: `http://127.0.0.1:${storagePort}`,
    S3_BUCKET: bucket,
    S3_REGION: "ca-central-1",
    S3_FORCE_PATH_STYLE: "true",
    S3_ACCESS_KEY_ID: "synthetic-beta-key",
    S3_SECRET_ACCESS_KEY: "synthetic-beta-secret",
  });
  const [{ loadConfig }, { buildApp }, { attachRealtime }, { ScopedAudienceOutboxWorker }] =
    await Promise.all([
      import("../apps/server/src/config.js"),
      import("../apps/server/src/app.js"),
      import("../apps/server/src/realtime.js"),
      import("../apps/server/src/scoped-audience-outbox-worker.js"),
    ]);
  const config = loadConfig();
  const built = await buildApp(config, {
    scanner: { scan: async () => ({ clean: true, signature: null }) },
  });
  const realtime = await attachRealtime(
    built.app.server,
    built.sessions,
    config,
    built.metrics,
    built.interactions,
    {
      service: built.presentationService,
      consumeAdmission: built.cache.consumeRateLimit.bind(built.cache),
    },
    built.audienceScopeService,
  );
  const scopedOutbox = new ScopedAudienceOutboxWorker(built.audienceScopes, (event) =>
    realtime.scopedAudience!.publish(event),
  );
  let active: Promise<unknown> | null = null;
  const interval = setInterval(() => {
    if (active) return;
    active = Promise.all([
      built.presentationVisualImportWorker.runUntilIdle(),
      built.authoringWorker.runUntilIdle(),
      built.reportWorker.runUntilIdle(),
      built.presentationReportWorker.runUntilIdle(),
      built.audienceOutboxWorker.runUntilIdle(),
      scopedOutbox.runUntilIdle(),
    ])
      .catch(() => {
        console.error("Synthetic visual-import fixture worker failed.");
      })
      .finally(() => {
        active = null;
      });
  }, 250);
  interval.unref();
  let stopping = false;
  async function stop() {
    if (stopping) return;
    stopping = true;
    clearInterval(interval);
    try {
      await active;
      await realtime.close();
      await built.app.close();
    } finally {
      storage.closeAllConnections();
      await new Promise<void>((resolve) => storage.close(() => resolve()));
      objects.clear();
      storeBytes = 0;
    }
  }
  process.once("SIGTERM", () => void stop().finally(() => process.exit(0)));
  process.once("SIGINT", () => void stop().finally(() => process.exit(0)));
  await built.app.listen({ host: "127.0.0.1", port: apiPort });
  console.info(
    "Beta visual-import fixture ready: synthetic clean scanner and ephemeral loopback S3; real conversion and API routes.",
  );
}

void main().catch((error: unknown) => {
  console.error(
    "Synthetic visual-import fixture failed to start:",
    error instanceof Error ? error.name : "unknown",
  );
  process.exit(1);
});
