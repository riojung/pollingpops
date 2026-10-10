import { ScopedAudienceEventSchema, AudienceScopeSnapshotSchema } from "@openround/contracts";
import type { Socket } from "socket.io-client";
import { createRealtimeClient } from "./realtime";

/** Separate audience cursor; notices trigger authorized current-state reads, never text replay. */
export function createScopedAudienceSubscription(options: {
  scopeId: string;
  token: string;
  onRefresh: () => void;
  onAccessDenied: () => void;
  socketFactory?: () => Socket;
}) {
  const socket = (options.socketFactory ?? createRealtimeClient)();
  let stopped = false;
  let audienceSeq = 0;
  let subscribed = false;
  let connectionVersion = 0;
  const connect = () => {
    const currentConnection = ++connectionVersion;
    subscribed = false;
    socket.timeout(8_000).emit(
      "audience.scope.subscribe",
      {
        scopeId: options.scopeId,
        kind: "presentation",
        token: options.token,
      },
      (error: Error | null, ack: unknown) => {
        if (stopped || error || currentConnection !== connectionVersion) return;
        const response = ack as { data?: { scope?: unknown }; error?: { code?: string } } | null;
        if (response?.error?.code === "UNAUTHORIZED" || response?.error?.code === "NOT_FOUND") {
          options.onAccessDenied();
          return;
        }
        const scope = AudienceScopeSnapshotSchema.safeParse(response?.data?.scope);
        if (
          !scope.success ||
          scope.data.kind !== "presentation" ||
          scope.data.scopeId !== options.scopeId
        )
          return;
        audienceSeq = Math.max(audienceSeq, scope.data.audienceSeq);
        subscribed = true;
        options.onRefresh();
      },
    );
  };
  const notice = (raw: unknown) => {
    const parsed = ScopedAudienceEventSchema.safeParse(raw);
    if (
      stopped ||
      !parsed.success ||
      parsed.data.scopeId !== options.scopeId ||
      parsed.data.audienceSeq <= audienceSeq
    )
      return;
    audienceSeq = parsed.data.audienceSeq;
    options.onRefresh(); // Covers contiguous notices, gaps, removals and settings changes alike.
  };
  const disconnect = () => {
    connectionVersion += 1;
    subscribed = false;
  };
  socket.on("connect", connect);
  socket.on("disconnect", disconnect);
  socket.on("audience.scope.activated", notice);
  socket.on("audience.qna.updated", notice);
  socket.connect();
  return {
    needsPolling: () => !subscribed,
    stop() {
      stopped = true;
      socket.off("connect", connect);
      socket.off("disconnect", disconnect);
      socket.off("audience.scope.activated", notice);
      socket.off("audience.qna.updated", notice);
      socket.disconnect();
    },
  };
}
