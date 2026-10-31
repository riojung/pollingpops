import { randomUUID } from "node:crypto";
import type { OutgoingHttpHeaders } from "node:http";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { CanvasBoardEvent } from "@openround/contracts";
import type { MetricsService } from "./metrics.js";

export interface CanvasStreamAccess {
  boardId: string;
  workspaceId: string;
  canvasSeq: number;
  sourceRevision?: number | null;
  expiresAt: string;
}

interface MetadataOutbox {
  listOutbox(
    after: number,
    limit: number,
  ): Promise<{
    events: Array<CanvasBoardEvent & { cursor: number }>;
    cursor: number;
  }>;
}

interface Connection {
  id: string;
  principal: string;
  access: CanvasStreamAccess;
  authorize: () => Promise<CanvasStreamAccess>;
  reply: FastifyReply;
  openedAt: number;
  checkedAt: number;
  heartbeatAt: number;
  recheckMs: number;
}

async function bounded<T>(promise: Promise<T>, milliseconds = 2_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error("Live authorization timed out")), milliseconds);
        timer.unref();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Each API node owns an independent durable metadata cursor, including HTTP streams.
 * No document text, guest identity, cursor, or ballot is written to the outbox.
 */
export class CanvasBoardLive {
  private readonly connections = new Map<string, Connection>();
  private cursor = 0;
  private timer: ReturnType<typeof setInterval> | undefined;
  private running = false;
  private closed = false;

  constructor(
    private readonly outbox: MetadataOutbox,
    private readonly intervalMs = 150,
    private readonly recheckMs = 250,
    private readonly lifetimeMs = 5 * 60_000,
    private readonly metrics?: Pick<
      MetricsService,
      "canvasStreamEvent" | "setCanvasStreams" | "observeCanvasOutboxLag"
    >,
  ) {}

  async connect(
    request: FastifyRequest,
    reply: FastifyReply,
    principal: string,
    authorize: () => Promise<CanvasStreamAccess>,
    recheckMs = this.recheckMs,
  ) {
    const access = await bounded(authorize());
    if (request.raw.aborted || reply.raw.destroyed) return reply;
    if (Date.parse(access.expiresAt) <= Date.now())
      return reply
        .code(404)
        .send({ error: { code: "NOT_FOUND", message: "This canvas has expired" } });
    if (
      this.closed ||
      this.connections.size >= 1_000 ||
      [...this.connections.values()].filter((item) => item.principal === principal).length >= 3
    ) {
      return reply
        .code(429)
        .header("retry-after", "5")
        .send({
          error: { code: "RATE_LIMITED", message: "Too many live board connections" },
        });
    }
    const now = Date.now();
    const connection: Connection = {
      id: randomUUID(),
      principal,
      access,
      authorize,
      reply,
      openedAt: now,
      checkedAt: now,
      heartbeatAt: now,
      recheckMs,
    };
    reply.header("content-type", "application/x-ndjson; charset=utf-8");
    reply.header("cache-control", "private, no-store");
    reply.header("x-accel-buffering", "no");
    // Node 22 can retain this socket in keep-alive when preClose ends the response
    // just before server.close(). Finish the stream gracefully, then close its socket.
    reply.header("connection", "close");
    reply.hijack();
    const headers: OutgoingHttpHeaders = {};
    for (const [name, value] of Object.entries(reply.getHeaders()))
      headers[name] = typeof value === "number" ? String(value) : value;
    reply.raw.writeHead(200, headers);
    this.connections.set(connection.id, connection);
    this.metrics?.canvasStreamEvent("opened");
    this.metrics?.setCanvasStreams(this.connections.size);
    reply.raw.once("close", () => this.disconnect(connection));
    request.raw.once("aborted", () => this.disconnect(connection));
    this.write(connection, {
      type: "canvas.ready",
      boardId: access.boardId,
      canvasSeq: access.canvasSeq,
      sourceRevision: access.sourceRevision,
    });
    if (!this.timer) {
      this.timer = setInterval(() => void this.tick(), this.intervalMs);
      this.timer.unref();
    }
    return reply;
  }

  private write(connection: Connection, event: Record<string, unknown>) {
    const stream = connection.reply.raw;
    if (stream.destroyed || stream.writableEnded || stream.writableLength > 32 * 1024) {
      this.disconnect(connection, true, "backpressure");
      return;
    }
    // No unbounded user-space queue. A slow consumer reconnects with a new authorized snapshot.
    if (!stream.write(`${JSON.stringify(event)}\n`))
      this.disconnect(connection, true, "backpressure");
  }

  private disconnect(connection: Connection, destroy = false, reason = "closed") {
    if (!this.connections.delete(connection.id)) return;
    this.metrics?.canvasStreamEvent(reason);
    this.metrics?.setCanvasStreams(this.connections.size);
    const stream = connection.reply.raw;
    if (destroy && !stream.destroyed) stream.destroy();
    else if (!stream.destroyed && !stream.writableEnded) stream.end();
  }

  async tick() {
    if (this.closed || this.running || !this.connections.size) return;
    this.running = true;
    try {
      const changed = new Set<string>();
      // A per-node cursor is deliberately independent of any worker consumer group.
      const page = await bounded(this.outbox.listOutbox(this.cursor, 200));
      for (const event of page.events) {
        changed.add(event.boardId);
        this.metrics?.observeCanvasOutboxLag((Date.now() - Date.parse(event.createdAt)) / 1_000);
      }
      this.cursor = page.cursor;
      const now = Date.now();
      await Promise.all(
        [...this.connections.values()].map(async (connection) => {
          if (!this.connections.has(connection.id)) return;
          if (now - connection.openedAt >= this.lifetimeMs) {
            this.write(connection, { type: "reconnect" });
            this.disconnect(connection, false, "reconnect_requested");
            return;
          }
          if (
            !changed.has(connection.access.boardId) &&
            now - connection.checkedAt < connection.recheckMs
          )
            return;
          try {
            const access = await bounded(connection.authorize());
            // Authorization itself can wait past board expiry or connection cancellation.
            if (!this.connections.has(connection.id)) return;
            if (Date.parse(access.expiresAt) <= Date.now())
              throw Object.assign(new Error("Expired"), { code: "NOT_FOUND" });
            connection.checkedAt = Date.now();
            const differs =
              access.canvasSeq !== connection.access.canvasSeq ||
              access.sourceRevision !== connection.access.sourceRevision;
            connection.access = access;
            if (differs) {
              this.write(connection, {
                type: "canvas.changed",
                boardId: access.boardId,
                canvasSeq: access.canvasSeq,
                sourceRevision: access.sourceRevision,
              });
            } else if (Date.now() - connection.heartbeatAt >= 5_000) {
              connection.heartbeatAt = Date.now();
              this.write(connection, { type: "heartbeat", canvasSeq: access.canvasSeq });
            }
          } catch (error) {
            const denied =
              error &&
              typeof error === "object" &&
              "code" in error &&
              ["NOT_FOUND", "UNAUTHORIZED", "FORBIDDEN"].includes(String(error.code));
            this.write(connection, { type: denied ? "access.revoked" : "reconnect" });
            this.disconnect(connection, false, denied ? "revoked" : "unavailable");
          }
        }),
      );
    } catch {
      // A failed metadata read must not leave subscriptions authorized indefinitely.
      // Clients fall back to authorized HTTP reads while reconnecting.
      for (const connection of this.connections.values()) {
        this.write(connection, { type: "reconnect" });
        this.disconnect(connection, false, "unavailable");
      }
    } finally {
      this.running = false;
    }
  }

  close() {
    this.closed = true;
    if (this.timer) clearInterval(this.timer);
    for (const connection of this.connections.values()) this.disconnect(connection);
  }
}
