import { createHash, randomUUID } from "node:crypto";
import type { Server, Socket } from "socket.io";
import { ZodError } from "zod";
import {
  JoinPresentationSessionSchema,
  PresentationControlCommandSchema,
  PresentationCompanionSnapshotSchema,
  PresentationEventEnvelopeSchema,
  PresentationHostSnapshotSchema,
  PresentationParticipantSnapshotSchema,
  PresentationResponseAckSchema,
  PresentationResponseSubmitSchema,
  PresentationRoomStatusSchema,
  PresentationSyncRequestSchema,
  PresentationSyncResponseSchema,
  type PresentationCommand,
  type PresentationCompanionCommand,
  type PresentationCompanionSnapshot,
  type PresentationHostSnapshot,
  type PresentationParticipantSnapshot,
  type PresentationResponseAck,
  type PresentationResponseSubmit,
  type PresentationRoleSnapshot,
  type PresentationRoomStatus,
  type PresentationSyncRequest,
  type PresentationSyncResponse,
} from "@openround/contracts";
import type { MetricsService } from "./metrics.js";
import {
  PresentationBroadcastConsistencyError,
  type PresentationHashedSyncRequest,
} from "./presentation-session-service.js";

const PRESENTATION_ROOM_PREFIX = "presentation:";
const CLIENT_EVENT_RECEIPT_TIMEOUT_MS = 5_000;
const PRESENTATION_BROADCAST_MIN_INTERVAL_MS = 250;
const PRESENTATION_JOIN_WINDOW_MS = 60_000;
const PRESENTATION_JOIN_ATTEMPTS_PER_ALIAS = 10;
const PRESENTATION_JOIN_ATTEMPTS_PER_ROOM = 600;
const PRESENTATION_JOIN_BUCKET_LIMIT = 10_000;

type PresentationProjection = PresentationSyncRequest["projection"];

const SAFE_PRESENTATION_ERROR_CODES = new Set([
  "NOT_FOUND",
  "PHASE_CLOSED",
  "PARTICIPANT_LIMIT",
  "INSTITUTION_AUTH_REQUIRED",
  "UNAUTHORIZED",
  "PASSWORD_REQUIRED",
  "INVALID_PASSWORD",
  "VALIDATION_ERROR",
  "STALE_SESSION",
  "ALREADY_RESPONDED",
  "IDEMPOTENCY_CONFLICT",
  "FEATURE_UNAVAILABLE",
]);

export interface PresentationRealtimeService {
  workspaceForCode(code: string): Promise<string | null>;
  workspaceForSession(sessionId: string): Promise<string | null>;
  join(
    code: string,
    nickname: string,
    password?: string,
  ): Promise<{
    workspaceId: string;
    participantToken: string;
    snapshot: PresentationParticipantSnapshot;
  }>;
  sync(input: PresentationSyncRequest): Promise<PresentationSyncResponse>;
  syncManyByCredentialHash?(
    inputs: PresentationHashedSyncRequest[],
    connectedParticipantIds?: ReadonlySet<string>,
  ): Promise<Array<PresentationSyncResponse | null>>;
  command(input: PresentationCommand): Promise<PresentationHostSnapshot>;
  companionCommand(input: PresentationCompanionCommand): Promise<PresentationCompanionSnapshot>;
  submitResponse(
    input: PresentationResponseSubmit & { receivedAt?: Date },
  ): Promise<PresentationResponseAck>;
  setConnectedParticipantIdsProvider?(
    provider: ((sessionId: string) => Promise<ReadonlySet<string>>) | null,
  ): void;
  setSessionDeletedHandler?(handler: ((sessionId: string) => void) | null): void;
  setSessionUpdatedHandler?(handler: ((sessionId: string) => void) | null): void;
}

export interface PresentationRealtimeOptions {
  service: PresentationRealtimeService;
  /**
   * @deprecated Rollout eligibility gates creation of a live session. The transport deliberately
   * ignores later flag changes so an active room remains usable through a rollback.
   */
  isEnabled?: (workspaceId: string) => boolean | Promise<boolean>;
  metrics?: Pick<
    MetricsService,
    | "recordPresentationAdmission"
    | "observePresentationBroadcast"
    | "observePresentationResponse"
    | "observePresentationClientReceipt"
  >;
  consumeAdmission?: (key: string, maximum: number, windowMs: number) => Promise<boolean>;
}

interface PresentationSocketIdentity {
  sessionId: string;
  projection: PresentationProjection;
  participantTokenHash?: string;
  controlTokenHash?: string;
  companionTokenHash?: string;
}

interface PresentationSocketCredential {
  sessionId: string;
  projection: PresentationProjection;
  participantToken?: string;
  controlToken?: string;
  companionToken?: string;
}

function presentationRoom(sessionId: string) {
  return `${PRESENTATION_ROOM_PREFIX}${sessionId}`;
}

function presentationCredentialHash(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function presentationSocketError(error: unknown) {
  if (error instanceof ZodError) {
    return {
      error: {
        code: "VALIDATION_ERROR",
        message: "The Presentation realtime payload is invalid",
      },
    };
  }
  const candidate = error as { code?: string; message?: string; details?: unknown };
  if (!candidate.code || !SAFE_PRESENTATION_ERROR_CODES.has(candidate.code)) {
    return {
      error: {
        code: "INTERNAL_ERROR",
        message: "The Presentation realtime request failed",
      },
    };
  }
  return {
    error: {
      code: candidate.code,
      message: candidate.message ?? "The Presentation realtime request failed",
      ...(candidate.code === "STALE_SESSION" && candidate.details
        ? { details: candidate.details }
        : {}),
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

interface PresentationJoinBucket {
  startedAt: number;
  count: number;
}

function presentationJoinAliasKey(code: string, nickname: string) {
  const normalized = nickname.trim().toLocaleLowerCase();
  const digest = createHash("sha256").update(normalized).digest("hex").slice(0, 16);
  return `${code}:${digest}`;
}

async function consumeSharedPresentationJoinAdmission(
  options: PresentationRealtimeOptions,
  code: string,
  nickname: string,
) {
  if (!options.consumeAdmission) return null;
  const aliasAccepted = await options.consumeAdmission(
    `presentation:join:alias:${presentationJoinAliasKey(code, nickname)}`,
    PRESENTATION_JOIN_ATTEMPTS_PER_ALIAS,
    PRESENTATION_JOIN_WINDOW_MS,
  );
  if (!aliasAccepted) return false;
  return options.consumeAdmission(
    `presentation:join:room:${code}`,
    PRESENTATION_JOIN_ATTEMPTS_PER_ROOM,
    PRESENTATION_JOIN_WINDOW_MS,
  );
}

function consumePresentationJoinAdmission(
  aliasBuckets: Map<string, PresentationJoinBucket>,
  roomBuckets: Map<string, PresentationJoinBucket>,
  code: string,
  nickname: string,
  now = Date.now(),
) {
  const consume = (buckets: Map<string, PresentationJoinBucket>, key: string, maximum: number) => {
    const bucket = buckets.get(key);
    if (!bucket || now - bucket.startedAt >= PRESENTATION_JOIN_WINDOW_MS) {
      buckets.set(key, { startedAt: now, count: 1 });
      return true;
    }
    bucket.count += 1;
    return bucket.count <= maximum;
  };
  const aliasAccepted = consume(
    aliasBuckets,
    presentationJoinAliasKey(code, nickname),
    PRESENTATION_JOIN_ATTEMPTS_PER_ALIAS,
  );
  if (!aliasAccepted) return false;
  return consume(roomBuckets, code, PRESENTATION_JOIN_ATTEMPTS_PER_ROOM);
}

function prunePresentationJoinAdmissions(
  aliasBuckets: Map<string, PresentationJoinBucket>,
  roomBuckets: Map<string, PresentationJoinBucket>,
  now = Date.now(),
) {
  const prune = (buckets: Map<string, PresentationJoinBucket>) => {
    for (const [key, bucket] of buckets) {
      if (now - bucket.startedAt >= PRESENTATION_JOIN_WINDOW_MS) buckets.delete(key);
    }
    while (buckets.size > PRESENTATION_JOIN_BUCKET_LIMIT) {
      const oldest = buckets.keys().next().value as string | undefined;
      if (!oldest) break;
      buckets.delete(oldest);
    }
  };
  prune(aliasBuckets);
  prune(roomBuckets);
}

function identityForSocket(socket: Socket): PresentationSocketIdentity | null {
  const sessionId = socket.data.presentationSessionId as string | undefined;
  const projection = socket.data.presentationProjection as PresentationProjection | undefined;
  if (!sessionId || !projection) return null;
  return {
    sessionId,
    projection,
    ...(socket.data.presentationParticipantTokenHash
      ? { participantTokenHash: socket.data.presentationParticipantTokenHash as string }
      : {}),
    ...(socket.data.presentationControlTokenHash
      ? { controlTokenHash: socket.data.presentationControlTokenHash as string }
      : {}),
    ...(socket.data.presentationCompanionTokenHash
      ? { companionTokenHash: socket.data.presentationCompanionTokenHash as string }
      : {}),
  };
}

function syncRequestForCredential(
  identity: PresentationSocketCredential,
  afterSeq = 0,
): PresentationSyncRequest {
  if (identity.projection === "participant" && identity.participantToken) {
    return {
      sessionId: identity.sessionId,
      projection: "participant",
      participantToken: identity.participantToken,
      afterSeq,
    };
  }
  if (identity.projection === "host" && identity.controlToken) {
    return {
      sessionId: identity.sessionId,
      projection: "host",
      controlToken: identity.controlToken,
      afterSeq,
    };
  }
  if (identity.projection === "companion" && identity.companionToken) {
    return {
      sessionId: identity.sessionId,
      projection: "companion",
      companionToken: identity.companionToken,
      afterSeq,
    };
  }
  throw Object.assign(new Error("Presentation realtime credential is missing"), {
    code: "UNAUTHORIZED",
  });
}

function hashedSyncRequestForIdentity(
  identity: PresentationSocketIdentity,
  afterSeq = 0,
): PresentationHashedSyncRequest {
  if (identity.projection === "participant" && identity.participantTokenHash) {
    return {
      sessionId: identity.sessionId,
      projection: "participant",
      participantTokenHash: identity.participantTokenHash,
      afterSeq,
    };
  }
  if (identity.projection === "host" && identity.controlTokenHash) {
    return {
      sessionId: identity.sessionId,
      projection: "host",
      controlTokenHash: identity.controlTokenHash,
      afterSeq,
    };
  }
  if (identity.projection === "companion" && identity.companionTokenHash) {
    return {
      sessionId: identity.sessionId,
      projection: "companion",
      companionTokenHash: identity.companionTokenHash,
      afterSeq,
    };
  }
  throw Object.assign(new Error("Presentation realtime credential is missing"), {
    code: "UNAUTHORIZED",
  });
}

async function bindPresentationIdentity(
  socket: Socket,
  identity: PresentationSocketCredential,
  participantId?: string,
) {
  const priorSessionId = socket.data.presentationSessionId as string | undefined;
  if (priorSessionId && priorSessionId !== identity.sessionId) {
    await socket.leave(presentationRoom(priorSessionId));
  }
  socket.data.presentationSessionId = identity.sessionId;
  socket.data.presentationProjection = identity.projection;
  socket.data.presentationParticipantId = participantId;
  socket.data.presentationParticipantTokenHash = identity.participantToken
    ? presentationCredentialHash(identity.participantToken)
    : undefined;
  socket.data.presentationControlTokenHash = identity.controlToken
    ? presentationCredentialHash(identity.controlToken)
    : undefined;
  socket.data.presentationCompanionTokenHash = identity.companionToken
    ? presentationCredentialHash(identity.companionToken)
    : undefined;
  await socket.join(presentationRoom(identity.sessionId));
}

function emitWithReceipt(
  socket: Socket,
  event: "presentation.session.updated" | "presentation.room-status.updated",
  payload: unknown,
  projection: PresentationProjection,
  metrics?: PresentationRealtimeOptions["metrics"],
) {
  const startedAt = performance.now();
  socket.timeout(CLIENT_EVENT_RECEIPT_TIMEOUT_MS).emit(event, payload, (error: Error | null) => {
    metrics?.observePresentationClientReceipt(
      event,
      projection,
      error ? "timeout" : "acknowledged",
      (performance.now() - startedAt) / 1_000,
    );
  });
}

function eventEnvelope(
  snapshot: PresentationRoleSnapshot,
  type: "presentation.session.updated" | "presentation.room-status.updated",
  payload: unknown,
) {
  return PresentationEventEnvelopeSchema.parse({
    eventId: randomUUID(),
    sessionId: snapshot.sessionId,
    revision: snapshot.revision,
    seq: snapshot.seq,
    type,
    serverTime: new Date().toISOString(),
    payload,
  });
}

function withRoomStatus(
  snapshot: PresentationRoleSnapshot,
  roomStatus: PresentationRoomStatus,
): PresentationRoleSnapshot {
  if (snapshot.projection === "host") {
    return PresentationHostSnapshotSchema.parse({ ...snapshot, roomStatus });
  }
  if (snapshot.projection === "companion") {
    return PresentationCompanionSnapshotSchema.parse({ ...snapshot, roomStatus });
  }
  return snapshot;
}

/**
 * Registers Presentation-specific Socket.IO events without sharing any identity keys with Round.
 * The service remains the authority for credentials, revisions, idempotency and projections.
 */
export function registerPresentationRealtime(io: Server, options: PresentationRealtimeOptions) {
  const lastBroadcastAt = new Map<string, number>();
  const pendingBroadcasts = new Map<string, NodeJS.Timeout>();
  const broadcastsInFlight = new Set<string>();
  const queuedBroadcasts = new Set<string>();
  const joinAliasBuckets = new Map<string, PresentationJoinBucket>();
  const joinRoomBuckets = new Map<string, PresentationJoinBucket>();
  // Raw bearer credentials stay process-local and disappear on disconnect. Socket data contains
  // only hashes, so Redis adapter state and cross-node fetches never carry reusable tokens.
  const localCredentials = new Map<string, PresentationSocketCredential>();
  let joinAdmissionAttempts = 0;
  let closed = false;
  const clearRoomBroadcasts = (sessionId: string) => {
    const pending = pendingBroadcasts.get(sessionId);
    if (pending) clearTimeout(pending);
    pendingBroadcasts.delete(sessionId);
    lastBroadcastAt.delete(sessionId);
    queuedBroadcasts.delete(sessionId);
  };
  const connectedParticipantIds = async (sessionId: string) => {
    const sockets = await io.in(presentationRoom(sessionId)).fetchSockets();
    return new Set(
      sockets.flatMap((remoteSocket) => {
        const socket = remoteSocket as unknown as Socket;
        const identity = identityForSocket(socket);
        const participantId = socket.data.presentationParticipantId as string | undefined;
        return identity?.sessionId === sessionId &&
          identity.projection === "participant" &&
          participantId
          ? [participantId]
          : [];
      }),
    );
  };
  options.service.setConnectedParticipantIdsProvider?.(connectedParticipantIds);
  const synchronizeSocket = async (socket: Socket) => {
    const credential = localCredentials.get(socket.id);
    if (!credential) return null;
    try {
      const synchronized = PresentationSyncResponseSchema.parse(
        await options.service.sync(syncRequestForCredential(credential)),
      );
      return synchronized.snapshot;
    } catch {
      socket.disconnect(true);
      return null;
    }
  };

  const scheduleBroadcastRetry = (sessionId: string) => {
    if (closed || pendingBroadcasts.has(sessionId)) return;
    const timer = setTimeout(() => {
      pendingBroadcasts.delete(sessionId);
      lastBroadcastAt.set(sessionId, Date.now());
      void broadcastSession(sessionId);
    }, PRESENTATION_BROADCAST_MIN_INTERVAL_MS);
    timer.unref();
    pendingBroadcasts.set(sessionId, timer);
  };

  const performBroadcast = async (sessionId: string) => {
    const startedAt = performance.now();
    try {
      const sockets = await io.in(presentationRoom(sessionId)).fetchSockets();
      const activeParticipantIds = new Set(
        sockets.flatMap((remoteSocket) => {
          const socket = remoteSocket as unknown as Socket;
          const identity = identityForSocket(socket);
          const participantId = socket.data.presentationParticipantId as string | undefined;
          return identity?.sessionId === sessionId &&
            identity.projection === "participant" &&
            participantId
            ? [participantId]
            : [];
        }),
      );
      let projected: Array<{ socket: Socket; snapshot: PresentationRoleSnapshot }>;
      if (options.service.syncManyByCredentialHash) {
        const candidates = sockets.flatMap((remoteSocket) => {
          const socket = remoteSocket as unknown as Socket;
          const identity = identityForSocket(socket);
          return identity ? [{ socket, request: hashedSyncRequestForIdentity(identity) }] : [];
        });
        const synchronized = await options.service.syncManyByCredentialHash(
          candidates.map(({ request }) => request),
          activeParticipantIds,
        );
        projected = candidates.flatMap(({ socket }, index) => {
          const response = synchronized[index];
          if (!response) {
            socket.disconnect(true);
            return [];
          }
          try {
            return [
              {
                socket,
                snapshot: PresentationSyncResponseSchema.parse(response).snapshot,
              },
            ];
          } catch {
            socket.disconnect(true);
            return [];
          }
        });
      } else {
        const synchronized = await Promise.all(
          sockets.map(async (remoteSocket) => {
            const socket = remoteSocket as unknown as Socket;
            return { socket, snapshot: await synchronizeSocket(socket) };
          }),
        );
        projected = synchronized.filter(
          (entry): entry is { socket: Socket; snapshot: PresentationRoleSnapshot } =>
            entry.snapshot !== null,
        );
      }

      if (projected.length === 0) {
        clearRoomBroadcasts(sessionId);
        return;
      }

      const participantIds = new Set(
        projected
          .filter(({ snapshot }) => snapshot.projection === "participant")
          .map(({ snapshot }) =>
            snapshot.projection === "participant" ? snapshot.participantId : undefined,
          )
          .filter((participantId): participantId is string => Boolean(participantId)),
      );
      const staffSnapshot = projected.find(
        ({ snapshot }) => snapshot.projection === "host" || snapshot.projection === "companion",
      )?.snapshot;
      const participantSnapshot = projected.find(
        ({ snapshot }) => snapshot.projection === "participant",
      )?.snapshot;
      const joinedCount =
        staffSnapshot?.projection === "host"
          ? staffSnapshot.participantCount
          : staffSnapshot?.projection === "companion"
            ? staffSnapshot.roomStatus.joinedCount
            : participantSnapshot?.projection === "participant"
              ? participantSnapshot.participantCount
              : 0;
      const responseCount =
        staffSnapshot?.projection === "host"
          ? staffSnapshot.responseCount
          : staffSnapshot?.projection === "companion"
            ? staffSnapshot.roomStatus.responseCount
            : 0;
      const roomStatus =
        staffSnapshot?.projection === "host" || staffSnapshot?.projection === "companion"
          ? PresentationRoomStatusSchema.parse(staffSnapshot.roomStatus)
          : PresentationRoomStatusSchema.parse({
              sessionId,
              joinedCount,
              connectedCount: Math.min(joinedCount, participantIds.size),
              notCurrentlyConnectedCount: Math.max(
                0,
                joinedCount - Math.min(joinedCount, participantIds.size),
              ),
              responseCount,
              sampledAt: new Date().toISOString(),
            });

      for (const { socket, snapshot: originalSnapshot } of projected) {
        const snapshot = withRoomStatus(originalSnapshot, roomStatus);
        emitWithReceipt(
          socket,
          "presentation.session.updated",
          eventEnvelope(snapshot, "presentation.session.updated", { snapshot }),
          snapshot.projection,
          options.metrics,
        );
        if (snapshot.projection === "host" || snapshot.projection === "companion") {
          emitWithReceipt(
            socket,
            "presentation.room-status.updated",
            eventEnvelope(snapshot, "presentation.room-status.updated", { roomStatus }),
            snapshot.projection,
            options.metrics,
          );
        }
      }
      options.metrics?.observePresentationBroadcast(
        "success",
        (performance.now() - startedAt) / 1_000,
      );
    } catch (error) {
      options.metrics?.observePresentationBroadcast(
        "error",
        (performance.now() - startedAt) / 1_000,
      );
      if (error instanceof PresentationBroadcastConsistencyError) {
        scheduleBroadcastRetry(sessionId);
      }
    }
  };

  const broadcastSession = async (sessionId: string) => {
    if (closed) return;
    if (broadcastsInFlight.has(sessionId)) {
      queuedBroadcasts.add(sessionId);
      return;
    }
    broadcastsInFlight.add(sessionId);
    try {
      do {
        queuedBroadcasts.delete(sessionId);
        await performBroadcast(sessionId);
      } while (!closed && queuedBroadcasts.has(sessionId));
    } finally {
      broadcastsInFlight.delete(sessionId);
      queuedBroadcasts.delete(sessionId);
    }
  };

  const scheduleBroadcast = (sessionId: string, immediate = false) => {
    if (closed) return;
    const pending = pendingBroadcasts.get(sessionId);
    if (immediate && pending) {
      clearTimeout(pending);
      pendingBroadcasts.delete(sessionId);
    }
    const elapsed = Date.now() - (lastBroadcastAt.get(sessionId) ?? 0);
    if (immediate || elapsed >= PRESENTATION_BROADCAST_MIN_INTERVAL_MS) {
      lastBroadcastAt.set(sessionId, Date.now());
      void broadcastSession(sessionId);
      return;
    }
    if (pending) return;
    const timer = setTimeout(() => {
      pendingBroadcasts.delete(sessionId);
      lastBroadcastAt.set(sessionId, Date.now());
      void broadcastSession(sessionId);
    }, PRESENTATION_BROADCAST_MIN_INTERVAL_MS - elapsed);
    timer.unref();
    pendingBroadcasts.set(sessionId, timer);
  };

  options.service.setSessionUpdatedHandler?.((sessionId) => scheduleBroadcast(sessionId, true));

  options.service.setSessionDeletedHandler?.((sessionId) => {
    // The adapter disconnects this room across every node. Each node's disconnect callback
    // releases its raw credentials, and any already queued projection rechecks the durable room.
    io.in(presentationRoom(sessionId)).disconnectSockets(true);
    for (const [socketId, credential] of localCredentials) {
      if (credential.sessionId === sessionId) localCredentials.delete(socketId);
    }
    clearRoomBroadcasts(sessionId);
  });

  io.on("connection", (socket) => {
    const rateLimits: Record<string, { startedAt: number; count: number }> = {};

    socket.on("presentation.join", async (raw, acknowledge) => {
      const startedAt = performance.now();
      const recordAdmission = (
        outcome: "accepted" | "duplicate" | "rate_limited" | "full" | "invalid" | "error",
      ) =>
        options.metrics?.recordPresentationAdmission(
          "socket",
          outcome,
          (performance.now() - startedAt) / 1_000,
        );
      if (typeof acknowledge !== "function") return;
      if (!consumeRateLimit(rateLimits, "presentation.join", 10)) {
        recordAdmission("rate_limited");
        acknowledge({ error: { code: "RATE_LIMITED", message: "Too many join attempts" } });
        return;
      }
      try {
        const input = JoinPresentationSessionSchema.parse(raw);
        joinAdmissionAttempts += 1;
        if (joinAdmissionAttempts % 256 === 0) {
          prunePresentationJoinAdmissions(joinAliasBuckets, joinRoomBuckets);
        }
        const sharedAdmission = await consumeSharedPresentationJoinAdmission(
          options,
          input.code,
          input.nickname,
        );
        const admitted =
          sharedAdmission ??
          consumePresentationJoinAdmission(
            joinAliasBuckets,
            joinRoomBuckets,
            input.code,
            input.nickname,
          );
        if (!admitted) {
          recordAdmission("rate_limited");
          acknowledge({ error: { code: "RATE_LIMITED", message: "Too many join attempts" } });
          return;
        }
        const joined = await options.service.join(input.code, input.nickname, input.password);
        const snapshot = PresentationParticipantSnapshotSchema.parse(joined.snapshot);
        await bindPresentationIdentity(
          socket,
          {
            sessionId: snapshot.sessionId,
            projection: "participant",
            participantToken: joined.participantToken,
          },
          snapshot.participantId,
        );
        if (!socket.connected) return;
        localCredentials.set(socket.id, {
          sessionId: snapshot.sessionId,
          projection: "participant",
          participantToken: joined.participantToken,
        });
        recordAdmission("accepted");
        acknowledge({ data: { participantToken: joined.participantToken, snapshot } });
        scheduleBroadcast(snapshot.sessionId);
      } catch (error) {
        const code = (error as { code?: string }).code;
        recordAdmission(
          error instanceof ZodError ? "invalid" : code === "PARTICIPANT_LIMIT" ? "full" : "error",
        );
        acknowledge(presentationSocketError(error));
      }
    });

    socket.on("presentation.sync.request", async (raw, acknowledge) => {
      if (typeof acknowledge !== "function") return;
      if (!consumeRateLimit(rateLimits, "presentation.sync.request", 20)) {
        acknowledge({ error: { code: "RATE_LIMITED", message: "Too many sync requests" } });
        return;
      }
      try {
        const input = PresentationSyncRequestSchema.parse(raw);
        const synchronized = PresentationSyncResponseSchema.parse(
          await options.service.sync(input),
        );
        const credential: PresentationSocketCredential =
          input.projection === "participant"
            ? {
                sessionId: input.sessionId,
                projection: input.projection,
                participantToken: input.participantToken,
              }
            : input.projection === "host"
              ? {
                  sessionId: input.sessionId,
                  projection: input.projection,
                  controlToken: input.controlToken,
                }
              : {
                  sessionId: input.sessionId,
                  projection: input.projection,
                  companionToken: input.companionToken,
                };
        await bindPresentationIdentity(
          socket,
          credential,
          synchronized.snapshot.projection === "participant"
            ? synchronized.snapshot.participantId
            : undefined,
        );
        if (!socket.connected) return;
        localCredentials.set(socket.id, credential);
        acknowledge({ data: synchronized });
        scheduleBroadcast(input.sessionId);
      } catch (error) {
        acknowledge(presentationSocketError(error));
      }
    });

    socket.on("presentation.command", async (raw, acknowledge) => {
      if (typeof acknowledge !== "function") return;
      if (!consumeRateLimit(rateLimits, "presentation.command", 30)) {
        acknowledge({ error: { code: "RATE_LIMITED", message: "Too many commands" } });
        return;
      }
      try {
        const input = PresentationControlCommandSchema.parse(raw);
        const isCompanion = "companionToken" in input;
        const snapshot = isCompanion
          ? PresentationCompanionSnapshotSchema.parse(await options.service.companionCommand(input))
          : PresentationHostSnapshotSchema.parse(await options.service.command(input));
        const credential: PresentationSocketCredential = isCompanion
          ? {
              sessionId: input.sessionId,
              projection: "companion",
              companionToken: input.companionToken,
            }
          : { sessionId: input.sessionId, projection: "host", controlToken: input.controlToken };
        await bindPresentationIdentity(socket, credential);
        if (!socket.connected) return;
        localCredentials.set(socket.id, credential);
        acknowledge({ data: { snapshot } });
        // Real services notify here for every transport; keep support for standalone adapters.
        if (!options.service.setSessionUpdatedHandler) scheduleBroadcast(input.sessionId, true);
      } catch (error) {
        acknowledge(presentationSocketError(error));
      }
    });

    socket.on("presentation.response.submit", async (raw, acknowledge) => {
      const receivedAt = new Date();
      const startedAt = performance.now();
      const recordResponse = (
        outcome: "accepted" | "duplicate" | "rejected" | "rate_limited" | "error",
      ) =>
        options.metrics?.observePresentationResponse(
          "socket",
          outcome,
          (performance.now() - startedAt) / 1_000,
        );
      if (typeof acknowledge !== "function") return;
      if (!consumeRateLimit(rateLimits, "presentation.response.submit", 30)) {
        recordResponse("rate_limited");
        acknowledge({ error: { code: "RATE_LIMITED", message: "Too many response attempts" } });
        return;
      }
      try {
        const input = PresentationResponseSubmitSchema.parse(raw);
        const response = PresentationResponseAckSchema.parse(
          await options.service.submitResponse({ ...input, receivedAt }),
        );
        await bindPresentationIdentity(
          socket,
          {
            sessionId: input.sessionId,
            projection: "participant",
            participantToken: input.participantToken,
          },
          response.snapshot.participantId,
        );
        if (!socket.connected) return;
        localCredentials.set(socket.id, {
          sessionId: input.sessionId,
          projection: "participant",
          participantToken: input.participantToken,
        });
        recordResponse(response.duplicate ? "duplicate" : "accepted");
        acknowledge({ data: response });
        scheduleBroadcast(input.sessionId);
      } catch (error) {
        const code = (error as { code?: string }).code;
        recordResponse(code && SAFE_PRESENTATION_ERROR_CODES.has(code) ? "rejected" : "error");
        acknowledge(presentationSocketError(error));
      }
    });

    socket.on("disconnect", () => {
      const sessionId = socket.data.presentationSessionId as string | undefined;
      localCredentials.delete(socket.id);
      if (sessionId) scheduleBroadcast(sessionId);
    });
  });

  return {
    close() {
      closed = true;
      options.service.setConnectedParticipantIdsProvider?.(null);
      options.service.setSessionDeletedHandler?.(null);
      options.service.setSessionUpdatedHandler?.(null);
      for (const timer of pendingBroadcasts.values()) clearTimeout(timer);
      pendingBroadcasts.clear();
      lastBroadcastAt.clear();
      queuedBroadcasts.clear();
      joinAliasBuckets.clear();
      joinRoomBuckets.clear();
      localCredentials.clear();
    },
  };
}
