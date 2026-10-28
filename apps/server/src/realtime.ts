import type { Server as HttpServer } from "node:http";
import { randomUUID } from "node:crypto";
import { createAdapter } from "@socket.io/redis-streams-adapter";
import Redis from "ioredis";
import { Server } from "socket.io";
import { ZodError } from "zod";
import {
  AnswerSubmitSchema,
  AudienceSyncRequestSchema,
  HostCommandSchema,
  JoinRequestSchema,
  SyncRequestSchema,
  canUseRoundProtocol,
  ROUND_CLIENT_UPDATE_MESSAGE,
  type SessionSnapshot,
} from "@openround/contracts";
import {
  scoredResponseSummaryForParticipant,
  snapshotForRole,
  type GameState,
} from "@openround/game-engine";
import type { AppConfig } from "./config.js";
import type { MetricsService } from "./metrics.js";
import { originAllowed } from "./origin.js";
import type { SessionService } from "./session-service.js";
import type { AudienceScopeService } from "./audience-scope-service.js";
import { registerScopedAudienceRealtime } from "./scoped-audience-realtime.js";
import type {
  AudienceRealtimeViewer,
  InteractionService,
  PreparedAudienceChatEvent,
} from "./interaction-service.js";
import {
  registerPresentationRealtime,
  type PresentationRealtimeOptions,
} from "./presentation-realtime.js";

const CLIENT_EVENT_RECEIPT_TIMEOUT_MS = 5_000;
const AUDIENCE_SUMMARY_MIN_INTERVAL_MS = 250;

type RealtimeRole = "host" | "presenter" | "participant";

export function isExpiredRealtimeStaffCredential(expiresAtMs: unknown, nowMs = Date.now()) {
  return typeof expiresAtMs === "number" && expiresAtMs <= nowMs;
}

function socketError(error: unknown) {
  if (error instanceof ZodError) {
    return {
      error: {
        code: "VALIDATION_ERROR",
        message: "The realtime payload is invalid",
      },
    };
  }
  const candidate = error as { code?: string; message?: string };
  return {
    error: {
      code: candidate.code ?? "INTERNAL_ERROR",
      message: candidate.message ?? "The realtime request failed",
    },
  };
}

function consumeRateLimit(
  buckets: Record<string, { startedAt: number; count: number }>,
  event: string,
  maximum: number,
) {
  const now = Date.now();
  const bucket = buckets[event];
  if (!bucket || now - bucket.startedAt >= 10_000) {
    buckets[event] = { startedAt: now, count: 1 };
    return true;
  }
  bucket.count += 1;
  return bucket.count <= maximum;
}

export function snapshotSelector(state: GameState) {
  const hostSnapshot = snapshotForRole(state, { role: "host" });
  const presenterSnapshot = snapshotForRole(state, { role: "presenter" });
  const participantBase = snapshotForRole(state, { role: "participant" });
  const currentRoundHasAnswers = Object.values(state.answers).some(
    (answer) => answer.roundId === state.roundId,
  );
  const visibleParticipantById = new Map(
    hostSnapshot.participants.map((participant) => [participant.id, participant]),
  );

  return (role: RealtimeRole, participantId?: string): SessionSnapshot => {
    if (role === "host") return hostSnapshot;
    if (role === "presenter") return presenterSnapshot;
    if (!participantId) return participantBase;
    if (currentRoundHasAnswers) {
      return snapshotForRole(state, { role: "participant", participantId });
    }
    const visibleParticipant = visibleParticipantById.get(participantId);
    const myScoredResponseSummary = scoredResponseSummaryForParticipant(state, participantId);
    return {
      ...participantBase,
      myParticipantId: participantId,
      ...(myScoredResponseSummary ? { myScoredResponseSummary } : {}),
      participants:
        state.settings.resultVisibility === "private" && visibleParticipant
          ? participantBase.participants.map((participant) =>
              participant.id === participantId ? visibleParticipant : participant,
            )
          : participantBase.participants,
    };
  };
}

function emitTrackedEvent(
  socket: Awaited<ReturnType<Server["fetchSockets"]>>[number],
  eventType: string,
  envelope: unknown,
  role: RealtimeRole,
  metrics: MetricsService,
) {
  const startedAt = performance.now();
  socket
    .timeout(CLIENT_EVENT_RECEIPT_TIMEOUT_MS)
    .emit(eventType, envelope, (error: Error | null) => {
      metrics.observeClientEventReceipt(
        eventType,
        role,
        error ? "timeout" : "acknowledged",
        (performance.now() - startedAt) / 1_000,
      );
    });
}

export async function attachRealtime(
  httpServer: HttpServer,
  sessions: SessionService,
  config: AppConfig,
  metrics: MetricsService,
  interactions?: InteractionService,
  presentationRealtime?: PresentationRealtimeOptions,
  audienceScopes?: AudienceScopeService,
) {
  let closing = false;
  const adapterRedis = config.REDIS_URL
    ? new Redis(config.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: null })
    : null;
  if (adapterRedis) await adapterRedis.connect();
  const io = new Server(httpServer, {
    adapter: adapterRedis
      ? createAdapter(adapterRedis, {
          streamName: "openround:socket.io",
          maxLen: 10_000,
          onlyPlaintext: true,
        })
      : undefined,
    cors: { origin: config.WEB_ORIGIN, credentials: true },
    maxHttpBufferSize: 64 * 1024,
    pingInterval: 20_000,
    pingTimeout: 10_000,
    allowRequest: (request, callback) => {
      callback(
        null,
        originAllowed({
          origin: request.headers.origin,
          host: request.headers.host,
          forwardedProto: request.headers["x-forwarded-proto"],
          encrypted: Boolean((request.socket as { encrypted?: boolean }).encrypted),
          configuredOrigin: config.WEB_ORIGIN,
        }),
      );
    },
  });
  const pendingAudienceSummaries = new Map<
    string,
    {
      event: Parameters<SessionService["publishAudience"]>[0];
      includeModerators: boolean;
      eventIds: Set<string>;
      timer: NodeJS.Timeout;
    }
  >();
  const scopedAudience = audienceScopes ? registerScopedAudienceRealtime(io, audienceScopes) : null;
  const lastAudienceSummaryAt = new Map<string, number>();
  const audienceSummaryExpiryTimers = new Map<string, NodeJS.Timeout>();
  const presentationRealtimeRegistration = presentationRealtime
    ? registerPresentationRealtime(io, { ...presentationRealtime, metrics })
    : null;
  const isModeratorSocket = (socket: Awaited<ReturnType<Server["fetchSockets"]>>[number]) =>
    (socket.data.role as RealtimeRole | undefined) === "host" &&
    ((socket.data.staffCredentialRole as string | undefined) === "host" ||
      (socket.data.staffCredentialRole as string | undefined) === "cohost");
  const revalidateAudienceSocket = async (
    socket: Awaited<ReturnType<Server["fetchSockets"]>>[number],
    sessionId: string,
  ) => {
    const role = socket.data.role as RealtimeRole | undefined;
    if (!role) return null;
    if (role === "participant") {
      const participantToken = socket.data.participantToken as string | undefined;
      const participantId = socket.data.participantId as string | undefined;
      if (!participantToken || !participantId) {
        socket.disconnect(true);
        return null;
      }
      try {
        await sessions.revalidateRealtimeParticipant(sessionId, participantToken, participantId);
      } catch {
        socket.disconnect(true);
        return null;
      }
      return role;
    }
    const staffExpiresAtMs: unknown = socket.data.staffExpiresAtMs;
    if (isExpiredRealtimeStaffCredential(staffExpiresAtMs)) {
      socket.disconnect(true);
      return null;
    }
    const staffTokenHash = socket.data.staffTokenHash as string | undefined;
    if (staffTokenHash) {
      try {
        await sessions.revalidateRealtimeStaff(sessionId, staffTokenHash, role);
      } catch {
        socket.disconnect(true);
        return null;
      }
    }
    return role;
  };
  const viewerForSocket = (
    socket: Awaited<ReturnType<Server["fetchSockets"]>>[number],
  ): AudienceRealtimeViewer => ({
    moderator: isModeratorSocket(socket),
    ...(socket.data.participantId ? { participantId: socket.data.participantId as string } : {}),
    ...(socket.data.staffCredentialId
      ? { staffCredentialId: socket.data.staffCredentialId as string }
      : {}),
    presenter: (socket.data.role as RealtimeRole | undefined) === "presenter",
    rootHost: (socket.data.staffCredentialRole as string | undefined) === "host",
  });
  const emitAudienceSummary = async (
    event: Parameters<SessionService["publishAudience"]>[0],
    includeModerators: boolean,
  ) => {
    const emittedAt = Date.now();
    lastAudienceSummaryAt.set(event.sessionId, emittedAt);
    const priorExpiry = audienceSummaryExpiryTimers.get(event.sessionId);
    if (priorExpiry) clearTimeout(priorExpiry);
    const expiry = setTimeout(() => {
      if (lastAudienceSummaryAt.get(event.sessionId) === emittedAt) {
        lastAudienceSummaryAt.delete(event.sessionId);
      }
      audienceSummaryExpiryTimers.delete(event.sessionId);
    }, 60_000);
    expiry.unref();
    audienceSummaryExpiryTimers.set(event.sessionId, expiry);
    const [sockets, summaries] = await Promise.all([
      io.in(`session:${event.sessionId}`).fetchSockets(),
      interactions?.realtimeSummaries(event.sessionId),
    ]);
    const summaryEventId = randomUUID();
    for (const socket of sockets) {
      const role = await revalidateAudienceSocket(socket, event.sessionId);
      if (!role || (!includeModerators && isModeratorSocket(socket))) continue;
      const envelope = {
        eventId: summaryEventId,
        sessionId: event.sessionId,
        audienceSeq: event.audienceSeq,
        schemaVersion: 1 as const,
        serverTime: new Date().toISOString(),
        type: "audience.summary.updated",
        payload: summaries
          ? {
              summary: isModeratorSocket(socket)
                ? summaries.moderatorSummary
                : summaries.publicSummary,
            }
          : {},
      };
      emitTrackedEvent(socket, "audience.summary.updated", envelope, role, metrics);
    }
  };
  const scheduleAudienceSummary = async (
    event: Parameters<SessionService["publishAudience"]>[0],
    includeModerators: boolean,
  ) => {
    const pending = pendingAudienceSummaries.get(event.sessionId);
    if (pending) {
      pending.event = event;
      pending.includeModerators ||= includeModerators;
      pending.eventIds.add(event.eventId);
      return false;
    }
    const elapsed = Date.now() - (lastAudienceSummaryAt.get(event.sessionId) ?? 0);
    if (elapsed >= AUDIENCE_SUMMARY_MIN_INTERVAL_MS) {
      await emitAudienceSummary(event, includeModerators);
      return true;
    }
    const timer = setTimeout(() => {
      const latest = pendingAudienceSummaries.get(event.sessionId);
      pendingAudienceSummaries.delete(event.sessionId);
      if (latest) {
        void emitAudienceSummary(latest.event, latest.includeModerators)
          .then(() => interactions?.completeOutboxEvents(latest.eventIds))
          .catch(() => undefined);
      }
    }, AUDIENCE_SUMMARY_MIN_INTERVAL_MS - elapsed);
    timer.unref();
    pendingAudienceSummaries.set(event.sessionId, {
      event,
      includeModerators,
      eventIds: new Set([event.eventId]),
      timer,
    });
    return false;
  };

  sessions.subscribe(async ({ state, events, reportId }) => {
    const startedAt = performance.now();
    try {
      const sockets = await io.in(`session:${state.sessionId}`).fetchSockets();
      const selectSnapshot = snapshotSelector(state);
      for (const event of events) {
        for (const socket of sockets) {
          const role = socket.data.role as RealtimeRole | undefined;
          if (!role) continue;
          if (!canUseRoundProtocol(state.roundProtocol, socket.data.roundClientCapabilities)) {
            socket.emit("client.update.required", {
              error: { code: "CLIENT_UPDATE_REQUIRED", message: ROUND_CLIENT_UPDATE_MESSAGE },
            });
            socket.disconnect(true);
            continue;
          }
          if (role !== "participant") {
            const staffExpiresAtMs: unknown = socket.data.staffExpiresAtMs;
            if (isExpiredRealtimeStaffCredential(staffExpiresAtMs)) {
              socket.disconnect(true);
              continue;
            }
            const staffTokenHash = socket.data.staffTokenHash as string | undefined;
            if (staffTokenHash) {
              try {
                await sessions.revalidateRealtimeStaff(state.sessionId, staffTokenHash, role);
              } catch {
                socket.disconnect(true);
                continue;
              }
            }
            emitTrackedEvent(
              socket,
              event.type,
              sessions.envelope(state, event, {
                snapshot: selectSnapshot(role),
                ...(reportId ? { reportId } : {}),
              }),
              role,
              metrics,
            );
            continue;
          }
          const snapshot = selectSnapshot(role, socket.data.participantId as string | undefined);
          emitTrackedEvent(
            socket,
            event.type,
            sessions.envelope(state, event, { snapshot, ...(reportId ? { reportId } : {}) }),
            role,
            metrics,
          );
        }
      }
      metrics.observeBroadcast("success", (performance.now() - startedAt) / 1_000);
    } catch (error) {
      metrics.observeBroadcast("error", (performance.now() - startedAt) / 1_000);
      throw error;
    }
  });

  sessions.subscribeAuxiliary(async (event) => {
    const sockets = await io.in(`session:${event.sessionId}`).fetchSockets();
    if (event.type === "session.staff.revoked") {
      const credentialId = event.payload.credentialId;
      for (const socket of sockets) {
        if (socket.data.staffCredentialId === credentialId) socket.disconnect(true);
      }
      return;
    }
    const envelope = {
      eventId: randomUUID(),
      sessionId: event.sessionId,
      sessionVersion: 0,
      seq: 0,
      type: event.type,
      schemaVersion: 2 as const,
      serverTime: new Date().toISOString(),
      payload: event.payload,
    };
    for (const socket of sockets) {
      const role = socket.data.role as RealtimeRole | undefined;
      if (role) emitTrackedEvent(socket, event.type, envelope, role, metrics);
    }
  });

  sessions.subscribeAudience?.(async (event) => {
    const sockets = await io.in(`session:${event.sessionId}`).fetchSockets();
    const privateAudienceEvent =
      event.type === "audience.signal.updated" || event.type === "audience.moderation.updated";
    const aggregateSummaryEvent = event.type === "audience.summary.updated";
    const chatEvent = event.type.startsWith("chat.");
    const messageId = typeof event.payload.messageId === "string" ? event.payload.messageId : null;
    const preparedChat: PreparedAudienceChatEvent | null =
      chatEvent && messageId && interactions
        ? await interactions.prepareRealtimeChat(event.sessionId, messageId)
        : null;
    const settings =
      event.type === "audience.settings.updated" && interactions
        ? await interactions.realtimeSettings(event.sessionId)
        : null;
    for (const socket of sockets) {
      const role = await revalidateAudienceSocket(socket, event.sessionId);
      if (!role) continue;
      const moderator = isModeratorSocket(socket);
      if (aggregateSummaryEvent || (privateAudienceEvent && !moderator)) continue;
      const payload = preparedChat
        ? interactions!.projectRealtimeChat(preparedChat, viewerForSocket(socket))
        : settings
          ? { settings }
          : event.payload;
      const envelope = {
        eventId: event.eventId,
        sessionId: event.sessionId,
        audienceSeq: event.audienceSeq,
        schemaVersion: 1 as const,
        serverTime: event.createdAt.toISOString(),
        type: event.type,
        payload,
      };
      const realtimeEventName = event.type.startsWith("qna.") ? "audience.event" : event.type;
      emitTrackedEvent(socket, realtimeEventName, envelope, role, metrics);
    }
    const summaryAffectingEvent =
      privateAudienceEvent ||
      aggregateSummaryEvent ||
      event.type === "chat.message.created" ||
      event.type === "chat.message.updated" ||
      event.type === "chat.message.removed";
    if (summaryAffectingEvent) return scheduleAudienceSummary(event, true);
    return true;
  });

  io.on("connection", (socket) => {
    metrics.socketConnected();
    const rateLimits: Record<string, { startedAt: number; count: number }> = {};

    socket.on("session.join", async (raw, acknowledge) => {
      if (typeof acknowledge !== "function") return;
      if (!consumeRateLimit(rateLimits, "session.join", 10)) {
        acknowledge({ error: { code: "RATE_LIMITED", message: "Too many join attempts" } });
        return;
      }
      try {
        const input = JoinRequestSchema.parse(raw);
        const joined = await sessions.join(input);
        socket.data.role = "participant";
        socket.data.participantId = joined.participantId;
        socket.data.participantToken = joined.participantToken;
        socket.data.roundClientCapabilities = input.clientCapabilities;
        await socket.join(`session:${joined.snapshot.sessionId}`);
        acknowledge({ data: joined });
      } catch (error) {
        acknowledge(socketError(error));
      }
    });

    socket.on("answer.submit", async (raw, acknowledge) => {
      if (typeof acknowledge !== "function") return;
      if (!consumeRateLimit(rateLimits, "answer.submit", 30)) {
        acknowledge({ error: { code: "RATE_LIMITED", message: "Too many answer attempts" } });
        return;
      }
      try {
        const input = AnswerSubmitSchema.parse(raw);
        const result = await sessions.answer(input);
        acknowledge({ data: result });
      } catch (error) {
        acknowledge(socketError(error));
      }
    });

    socket.on("host.command", async (raw, acknowledge) => {
      if (typeof acknowledge !== "function") return;
      if (!consumeRateLimit(rateLimits, "host.command", 30)) {
        acknowledge({ error: { code: "RATE_LIMITED", message: "Too many host commands" } });
        return;
      }
      try {
        const input = HostCommandSchema.parse(raw);
        const snapshot = await sessions.hostCommand(input);
        const staff = await sessions.realtimeStaffIdentity(
          input.sessionId,
          input.hostToken,
          "host",
        );
        socket.data.role = "host";
        socket.data.roundClientCapabilities = input.clientCapabilities;
        socket.data.participantId = undefined;
        socket.data.participantToken = undefined;
        socket.data.staffCredentialId = staff.credentialId ?? undefined;
        socket.data.staffCredentialRole = staff.credentialRole;
        socket.data.staffExpiresAtMs = staff.expiresAtMs ?? undefined;
        socket.data.staffTokenHash = staff.tokenHash;
        await socket.join(`session:${input.sessionId}`);
        acknowledge({ data: { snapshot } });
      } catch (error) {
        acknowledge(socketError(error));
      }
    });

    socket.on("sync.request", async (raw, acknowledge) => {
      if (typeof acknowledge !== "function") return;
      if (!consumeRateLimit(rateLimits, "sync.request", 20)) {
        acknowledge({ error: { code: "RATE_LIMITED", message: "Too many sync requests" } });
        return;
      }
      try {
        const input = SyncRequestSchema.parse(raw);
        const synchronized = await sessions.sync(input);
        const staff =
          input.role !== "participant" && input.hostToken
            ? await sessions.realtimeStaffIdentity(input.sessionId, input.hostToken, input.role)
            : null;
        socket.data.role = input.role;
        socket.data.roundClientCapabilities = input.clientCapabilities;
        socket.data.participantToken = input.participantToken;
        socket.data.participantId = synchronized.snapshot.myParticipantId ?? undefined;
        socket.data.staffCredentialId = staff?.credentialId ?? undefined;
        socket.data.staffCredentialRole = staff?.credentialRole;
        socket.data.staffExpiresAtMs = staff?.expiresAtMs ?? undefined;
        socket.data.staffTokenHash = staff?.tokenHash ?? undefined;
        await socket.join(`session:${input.sessionId}`);
        acknowledge({ data: synchronized });
      } catch (error) {
        acknowledge(socketError(error));
      }
    });

    socket.on("audience.sync.request", async (raw, acknowledge) => {
      if (typeof acknowledge !== "function") return;
      if (!interactions) {
        acknowledge({
          error: { code: "DEPENDENCY_UNAVAILABLE", message: "Audience sync is unavailable" },
        });
        return;
      }
      if (!consumeRateLimit(rateLimits, "audience.sync.request", 20)) {
        acknowledge({ error: { code: "RATE_LIMITED", message: "Too many sync requests" } });
        return;
      }
      try {
        const input = AudienceSyncRequestSchema.parse(raw);
        const token = input.participantToken ?? input.hostToken!;
        const synchronized = await interactions.sync(input.sessionId, token, input.limit);
        acknowledge({ data: synchronized });
      } catch (error) {
        acknowledge(socketError(error));
      }
    });

    socket.on("disconnect", () => {
      metrics.socketDisconnected();
      const participantToken = socket.data.participantToken as string | undefined;
      if (participantToken && !closing) {
        // Presence cleanup is best effort once the transport is already gone. A
        // transient coordination failure must not become an unhandled rejection
        // that terminates the realtime process.
        void sessions.disconnect(participantToken).catch(() => undefined);
      }
    });
  });

  return {
    io,
    scopedAudience,
    async close() {
      closing = true;
      presentationRealtimeRegistration?.close();
      for (const { timer } of pendingAudienceSummaries.values()) clearTimeout(timer);
      pendingAudienceSummaries.clear();
      for (const timer of audienceSummaryExpiryTimers.values()) clearTimeout(timer);
      audienceSummaryExpiryTimers.clear();
      lastAudienceSummaryAt.clear();
      await new Promise<void>((resolve) => io.close(() => resolve()));
      if (adapterRedis && adapterRedis.status !== "end") await adapterRedis.quit();
    },
  };
}
