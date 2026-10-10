"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  AudienceSignalSchema,
  ChatMessageSchema,
  InteractionSettingsSchema,
  InteractionSummarySchema,
  type AudienceEventEnvelope,
  type AudienceSignal,
  type ChatMessage,
  type ChatPage,
  type ChatReaction,
  type InteractionSettings,
  type InteractionSummary,
} from "@openround/contracts";
import { apiFetch, humanError } from "../lib/api";
import { clientUuid } from "../lib/uuid";
import { createInFlightRefreshCoalescer } from "../lib/refresh-queue";
import { useLocale } from "./locale-provider";
import { ParticipantIdentity } from "./participant-avatar";

const signalOptions: Array<{ id: AudienceSignal; label: string; icon: string }> = [
  { id: "got_it", label: "Got it", icon: "✓" },
  { id: "unsure", label: "I’m unsure", icon: "?" },
  { id: "need_example", label: "Show an example", icon: "▣" },
  { id: "too_fast", label: "Too fast", icon: "↘" },
];

const reactionOptions: Array<{ id: ChatReaction; label: string; icon: string }> = [
  { id: "like", label: "Like", icon: "👍" },
  { id: "love", label: "Love", icon: "♥" },
  { id: "insight", label: "Insightful", icon: "💡" },
  { id: "laugh", label: "Funny", icon: "☺" },
];

export interface AudienceSync {
  settings: InteractionSettings;
  settingsAudienceSeq?: number;
  chatSyncAudienceSeq?: number;
  privateProjectionOverlays?: AudienceEventEnvelope[];
  capabilities: { audiencePulse: boolean; roomChat: boolean };
  summary: InteractionSummary;
  chat: ChatPage;
}

export interface AudienceRealtimeUpdate {
  ordinal: number;
  gap: boolean;
  envelope: AudienceEventEnvelope;
}

export interface AudienceRealtimeBatch {
  updates: AudienceRealtimeUpdate[];
  latestOrdinal: number;
}

interface MergeAudienceSyncOptions {
  replay?: AudienceEventEnvelope[];
}

interface ApplyAudienceRealtimeOptions {
  replay?: boolean;
  recordPrivateOverlay?: boolean;
}

const MAX_REALTIME_BATCH_SIZE = 64;
const MAX_REALTIME_REPLAY_SIZE = 256;
// A full 250-person room can signal inside one 250 ms summary window. Leave
// headroom for repeated signals and moderation events before the aggregate
// summary that covers them arrives.
const MAX_PRIVATE_PROJECTION_OVERLAYS = 512;

export { createInFlightRefreshCoalescer } from "../lib/refresh-queue";

export function enqueueAudienceRealtimeUpdate(
  current: AudienceRealtimeBatch | null,
  update: Omit<AudienceRealtimeUpdate, "ordinal">,
): AudienceRealtimeBatch {
  const latestOrdinal = (current?.latestOrdinal ?? 0) + 1;
  const updates = [...(current?.updates ?? []), { ...update, ordinal: latestOrdinal }].slice(
    -MAX_REALTIME_BATCH_SIZE,
  );
  return { updates, latestOrdinal };
}

export function audienceRealtimeBatchDelta(
  batch: AudienceRealtimeBatch,
  lastProcessedOrdinal: number,
) {
  const updates = batch.updates.filter((update) => update.ordinal > lastProcessedOrdinal);
  return {
    updates,
    overflow: Boolean(updates[0] && updates[0].ordinal > lastProcessedOrdinal + 1),
    lastProcessedOrdinal: updates.at(-1)?.ordinal ?? lastProcessedOrdinal,
  };
}

export function mergeAudienceSync(
  _current: AudienceSync | null,
  synchronized: AudienceSync,
  options: MergeAudienceSyncOptions = {},
): AudienceSync {
  const synchronizedChat = hydrateChatPage(synchronized.chat);
  const synchronizedChatSyncSeq = synchronized.chatSyncAudienceSeq ?? synchronizedChat.audienceSeq;
  const synchronizedSettingsSeq = synchronized.settingsAudienceSeq ?? synchronizedChat.audienceSeq;
  const authoritative: AudienceSync = {
    ...synchronized,
    settingsAudienceSeq: synchronizedSettingsSeq,
    chatSyncAudienceSeq: synchronizedChatSyncSeq,
    privateProjectionOverlays: [],
    chat: { ...synchronizedChat, settings: synchronized.settings },
  };
  return (options.replay ?? []).reduce(
    (current, envelope) => applyAudienceRealtimeEvent(current, envelope, { replay: true }),
    authoritative,
  );
}

export function audienceReplayNeedsAuthoritativeSync(
  synchronized: AudienceSync,
  replay: AudienceEventEnvelope[],
) {
  const participantIds = new Set(
    synchronized.summary.participants?.map((participant) => participant.participantId) ?? [],
  );
  return replay.some((envelope) => {
    if (
      envelope.type !== "audience.signal.updated" &&
      envelope.type !== "audience.moderation.updated"
    ) {
      return false;
    }
    const payload = objectPayload(envelope.payload);
    const participantId = typeof payload?.participantId === "string" ? payload.participantId : null;
    if (!participantId) return false;
    if (
      envelope.type === "audience.signal.updated" &&
      payload?.contextKey !== synchronized.summary.contextKey
    ) {
      return false;
    }
    return !participantIds.has(participantId);
  });
}

function hydrateChatPage(page: ChatPage): ChatPage {
  return {
    ...page,
    messages: page.messages.map((message) => ({
      ...message,
      audienceSeq: Math.max(message.audienceSeq, page.audienceSeq),
    })),
  };
}

function compareChatMessages(left: ChatMessage, right: ChatMessage) {
  return (
    new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime() ||
    right.id.localeCompare(left.id)
  );
}

function objectPayload(payload: unknown): Record<string, unknown> | null {
  return payload && typeof payload === "object" && !Array.isArray(payload)
    ? (payload as Record<string, unknown>)
    : null;
}

function appendPrivateProjectionOverlay(current: AudienceSync, envelope: AudienceEventEnvelope) {
  const overlays = (current.privateProjectionOverlays ?? []).filter(
    (overlay) => overlay.eventId !== envelope.eventId,
  );
  overlays.push(envelope);
  return overlays.slice(-MAX_PRIVATE_PROJECTION_OVERLAYS);
}

export function applyAudienceRealtimeEvent(
  current: AudienceSync,
  envelope: AudienceEventEnvelope,
  options: ApplyAudienceRealtimeOptions = {},
): AudienceSync {
  const payload = objectPayload(envelope.payload);
  if (!payload) return current;
  const summaryResult = InteractionSummarySchema.safeParse(payload.summary);
  if (summaryResult.success) {
    if (
      summaryResult.data.contextKey !== current.summary.contextKey ||
      summaryResult.data.audienceSeq < current.summary.audienceSeq
    ) {
      return current;
    }
    const priorOwnSignal = current.summary.mySignal;
    const summary =
      priorOwnSignal !== undefined && summaryResult.data.mySignal === undefined
        ? { ...summaryResult.data, mySignal: priorOwnSignal }
        : summaryResult.data;
    const privateProjectionOverlays = (current.privateProjectionOverlays ?? []).filter(
      (overlay) => overlay.audienceSeq > envelope.audienceSeq,
    );
    return privateProjectionOverlays.reduce<AudienceSync>(
      (next, overlay) =>
        applyAudienceRealtimeEvent(next, overlay, {
          replay: true,
          recordPrivateOverlay: false,
        }),
      { ...current, summary, privateProjectionOverlays },
    );
  }
  const settingsResult = InteractionSettingsSchema.safeParse(payload.settings);
  if (settingsResult.success) {
    if (envelope.audienceSeq < (current.settingsAudienceSeq ?? 0)) return current;
    return {
      ...current,
      settings: settingsResult.data,
      settingsAudienceSeq: Math.max(current.settingsAudienceSeq ?? 0, envelope.audienceSeq),
      chat: { ...current.chat, settings: settingsResult.data },
    };
  }
  if (envelope.type.startsWith("chat.")) {
    const messageId = typeof payload.messageId === "string" ? payload.messageId : null;
    if (!messageId) return current;
    const existing = current.chat.messages.find((message) => message.id === messageId);
    if (
      envelope.audienceSeq < (current.chatSyncAudienceSeq ?? 0) ||
      (existing && envelope.audienceSeq < existing.audienceSeq)
    ) {
      return current;
    }
    const messageResult = ChatMessageSchema.safeParse(payload.message);
    const messages = current.chat.messages.filter((message) => message.id !== messageId);
    if (messageResult.success) {
      messages.unshift({
        ...messageResult.data,
        audienceSeq: Math.max(messageResult.data.audienceSeq, envelope.audienceSeq),
      });
    }
    messages.sort(compareChatMessages);
    return {
      ...current,
      chat: {
        ...current.chat,
        messages: messages.slice(0, 50),
        audienceSeq: Math.max(current.chat.audienceSeq, envelope.audienceSeq),
      },
    };
  }
  if (envelope.type === "audience.signal.updated") {
    const participantId = typeof payload.participantId === "string" ? payload.participantId : null;
    const contextKey = typeof payload.contextKey === "string" ? payload.contextKey : null;
    const signalResult = AudienceSignalSchema.nullable().safeParse(payload.signal);
    const updatedAt = typeof payload.updatedAt === "string" ? payload.updatedAt : null;
    if (!participantId || contextKey !== current.summary.contextKey || !signalResult.success) {
      return current;
    }
    const updatedAtTime = updatedAt ? Date.parse(updatedAt) : Number.NaN;
    if (!Number.isFinite(updatedAtTime)) return current;
    const previous = current.summary.participants?.find(
      (participant) => participant.participantId === participantId,
    );
    if (previous?.lastSignalAt && Date.parse(previous.lastSignalAt) > updatedAtTime) return current;
    const withOverlay =
      options.recordPrivateOverlay === false
        ? current
        : {
            ...current,
            privateProjectionOverlays: appendPrivateProjectionOverlay(current, envelope),
          };
    if (!previous || !current.summary.participants) return withOverlay;
    if (previous?.currentSignal === signalResult.data && previous.lastSignalAt === updatedAt) {
      return withOverlay;
    }
    const participants = current.summary.participants.map((participant) =>
      participant.participantId === participantId
        ? {
            ...participant,
            currentSignal: signalResult.data,
            lastSignalAt: updatedAt,
            lastActivityAt:
              !participant.lastActivityAt || Date.parse(participant.lastActivityAt) < updatedAtTime
                ? updatedAt
                : participant.lastActivityAt,
          }
        : participant,
    );
    const counts = withOverlay.summary.signalCounts
      ? { ...withOverlay.summary.signalCounts }
      : withOverlay.summary.signalCounts;
    if (counts && previous?.currentSignal) {
      counts[previous.currentSignal] = Math.max(0, counts[previous.currentSignal] - 1);
    }
    if (counts && signalResult.data) counts[signalResult.data] += 1;
    return {
      ...withOverlay,
      summary: {
        ...withOverlay.summary,
        audienceSeq: Math.max(withOverlay.summary.audienceSeq, envelope.audienceSeq),
        participants,
        signalCounts: counts,
        uniqueSignalers:
          withOverlay.summary.uniqueSignalers +
          (previous?.currentSignal ? 0 : signalResult.data ? 1 : 0) -
          (previous?.currentSignal && !signalResult.data ? 1 : 0),
        signalsLastMinute: withOverlay.summary.signalsLastMinute + 1,
      },
    };
  }
  if (envelope.type === "audience.moderation.updated") {
    if (!options.replay && envelope.audienceSeq < current.summary.audienceSeq) return current;
    const participantId = typeof payload.participantId === "string" ? payload.participantId : null;
    if (!participantId) return current;
    const withOverlay =
      options.recordPrivateOverlay === false
        ? current
        : {
            ...current,
            privateProjectionOverlays: appendPrivateProjectionOverlay(current, envelope),
          };
    const previous = current.summary.participants?.find(
      (participant) => participant.participantId === participantId,
    );
    if (!previous || !current.summary.participants) return withOverlay;
    const mutedUntil = typeof payload.mutedUntil === "string" ? payload.mutedUntil : null;
    const banned = payload.banned === true;
    if (previous?.mutedUntil === mutedUntil && previous.banned === banned) return withOverlay;
    return {
      ...withOverlay,
      summary: {
        ...withOverlay.summary,
        audienceSeq: Math.max(withOverlay.summary.audienceSeq, envelope.audienceSeq),
        participants: current.summary.participants.map((participant) =>
          participant.participantId === participantId
            ? {
                ...participant,
                mutedUntil,
                banned,
              }
            : participant,
        ),
      },
    };
  }
  return current;
}

function mutationHeaders() {
  return { "x-idempotency-key": clientUuid() };
}

export function AudiencePanel({
  sessionId,
  token,
  role,
  view = "all",
  syncRevision,
  realtimeBatch,
  onKick,
}: {
  sessionId: string;
  token: string;
  role: "moderator" | "participant" | "presenter";
  view?: "all" | "participants" | "pulse" | "chat";
  syncRevision: number;
  realtimeBatch: AudienceRealtimeBatch | null;
  onKick?: (participantId: string) => void;
}) {
  const { t } = useLocale();
  const [data, setData] = useState<AudienceSync | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [projectionRecoveryRevision, setProjectionRecoveryRevision] = useState(0);
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [reportedMessages, setReportedMessages] = useState<Set<string>>(() => new Set());
  const [participantFilter, setParticipantFilter] = useState<
    "all" | "needs_help" | "not_answered" | "disconnected" | "muted"
  >("all");
  const [muteDurationMinutes, setMuteDurationMinutes] = useState<5 | 15 | 60>(15);
  const dataRef = useRef<AudienceSync | null>(null);
  const refreshCoalescerRef = useRef(createInFlightRefreshCoalescer<void>());
  const refreshContextRef = useRef("");
  const refreshInvalidationRef = useRef(0);
  const realtimeProjectionOrdinalRef = useRef(0);
  const realtimeProjectionLogRef = useRef<
    Array<{ ordinal: number; envelope: AudienceEventEnvelope }>
  >([]);
  const projectionRecoveryThroughRef = useRef(0);
  const processedRealtimeOrdinalRef = useRef(realtimeBatch?.latestOrdinal ?? 0);
  const lastSyncRevisionRef = useRef(syncRevision);
  const authorization = useMemo(() => ({ authorization: `Bearer ${token}` }), [token]);
  const refreshKey = `${sessionId}:${token}`;
  const signalLabel = (signal: AudienceSignal) => t(`live.audience.signal.${signal}`);
  const reactionLabel = (reaction: ChatReaction) => t(`live.audience.reaction.${reaction}`);

  const refresh = useCallback(
    async (forceTrailing = false) => {
      if (!token) return;
      const context = refreshKey;
      refreshContextRef.current = context;
      await refreshCoalescerRef.current.run(
        context,
        async () => {
          const replayAfter = realtimeProjectionOrdinalRef.current;
          const invalidation = refreshInvalidationRef.current;
          realtimeProjectionLogRef.current = realtimeProjectionLogRef.current.filter(
            (projection) => projection.ordinal > replayAfter,
          );
          try {
            const synchronized = await apiFetch<AudienceSync>(
              `/v1/sessions/${sessionId}/interactions/sync?limit=50`,
              { headers: authorization },
            );
            if (
              refreshContextRef.current !== context ||
              refreshInvalidationRef.current !== invalidation
            ) {
              return;
            }
            const replayThrough = realtimeProjectionOrdinalRef.current;
            const replay = realtimeProjectionLogRef.current
              .filter(
                (projection) =>
                  projection.ordinal > replayAfter && projection.ordinal <= replayThrough,
              )
              .map((projection) => projection.envelope);
            const merged = mergeAudienceSync(null, synchronized, {
              replay,
            });
            realtimeProjectionLogRef.current = realtimeProjectionLogRef.current.filter(
              (projection) => projection.ordinal > replayThrough,
            );
            dataRef.current = merged;
            setData(merged);
            setError("");
            if (
              replayThrough > projectionRecoveryThroughRef.current &&
              audienceReplayNeedsAuthoritativeSync(merged, replay)
            ) {
              projectionRecoveryThroughRef.current = replayThrough;
              setProjectionRecoveryRevision((revision) => revision + 1);
            }
          } catch (caught) {
            if (
              refreshContextRef.current !== context ||
              refreshInvalidationRef.current !== invalidation
            ) {
              return;
            }
            setError(humanError(caught));
          }
        },
        forceTrailing,
      );
    },
    [authorization, refreshKey, sessionId, token],
  );

  useEffect(() => {
    const revisionChanged = lastSyncRevisionRef.current !== syncRevision;
    lastSyncRevisionRef.current = syncRevision;
    if (revisionChanged) refreshInvalidationRef.current += 1;
    void refresh(revisionChanged);
  }, [refresh, syncRevision]);

  useEffect(() => {
    if (projectionRecoveryRevision === 0) return;
    void refresh(true);
  }, [projectionRecoveryRevision, refresh]);

  useEffect(() => {
    if (!realtimeBatch) return;
    const delta = audienceRealtimeBatchDelta(realtimeBatch, processedRealtimeOrdinalRef.current);
    const unseen = delta.updates;
    processedRealtimeOrdinalRef.current = delta.lastProcessedOrdinal;
    if (unseen.length === 0) return;
    const invalidatesProjection = unseen.some(
      (update) =>
        update.gap ||
        (role === "presenter" && update.envelope.type === "audience.settings.updated"),
    );
    const refreshWasInFlight = refreshCoalescerRef.current.isActive(refreshKey);
    let replayOverflow = false;
    if (refreshWasInFlight && !invalidatesProjection && !delta.overflow) {
      for (const update of unseen) {
        realtimeProjectionOrdinalRef.current += 1;
        realtimeProjectionLogRef.current.push({
          ordinal: realtimeProjectionOrdinalRef.current,
          envelope: update.envelope,
        });
      }
      replayOverflow = realtimeProjectionLogRef.current.length > MAX_REALTIME_REPLAY_SIZE;
      if (replayOverflow) {
        realtimeProjectionLogRef.current.splice(
          0,
          realtimeProjectionLogRef.current.length - MAX_REALTIME_REPLAY_SIZE,
        );
      }
    }
    if (invalidatesProjection || delta.overflow || replayOverflow) {
      refreshInvalidationRef.current += 1;
      void refresh(true);
      return;
    }
    if (!dataRef.current) {
      void refresh();
      return;
    }
    let next = dataRef.current;
    for (const update of unseen) {
      next = applyAudienceRealtimeEvent(next, update.envelope);
    }
    dataRef.current = next;
    setData(next);
    if (
      !refreshWasInFlight &&
      audienceReplayNeedsAuthoritativeSync(
        next,
        unseen.map((update) => update.envelope),
      )
    ) {
      void refresh(true);
    }
  }, [realtimeBatch, refresh, refreshKey, role]);

  async function updateSettings(update: Partial<InteractionSettings>) {
    setBusy(true);
    try {
      await apiFetch(`/v1/sessions/${sessionId}/interactions/settings`, {
        method: "PATCH",
        headers: { ...authorization, ...mutationHeaders() },
        body: JSON.stringify(update),
      });
      await refresh(true);
    } catch (caught) {
      setError(humanError(caught));
    } finally {
      setBusy(false);
    }
  }

  async function setSignal(signal: AudienceSignal | null) {
    setBusy(true);
    try {
      await apiFetch(`/v1/sessions/${sessionId}/signals/current`, {
        method: "PUT",
        headers: authorization,
        body: JSON.stringify({ signal, idempotencyKey: clientUuid() }),
      });
      await refresh(true);
    } catch (caught) {
      setError(humanError(caught));
    } finally {
      setBusy(false);
    }
  }

  async function sendMessage(event: FormEvent) {
    event.preventDefault();
    if (!message.trim() || busy) return;
    setBusy(true);
    try {
      await apiFetch(`/v1/sessions/${sessionId}/chat/messages`, {
        method: "POST",
        headers: authorization,
        body: JSON.stringify({
          body: message,
          replyToMessageId: replyTo?.id ?? null,
          idempotencyKey: clientUuid(),
        }),
      });
      setMessage("");
      setReplyTo(null);
      await refresh(true);
    } catch (caught) {
      setError(humanError(caught));
    } finally {
      setBusy(false);
    }
  }

  async function react(messageId: string, reaction: ChatReaction, selected: boolean) {
    setBusy(true);
    try {
      await apiFetch(`/v1/sessions/${sessionId}/chat/messages/${messageId}/reaction`, {
        method: selected ? "DELETE" : "PUT",
        headers: { ...authorization, ...mutationHeaders() },
        ...(!selected ? { body: JSON.stringify({ reaction }) } : {}),
      });
      await refresh(true);
    } catch (caught) {
      setError(humanError(caught));
    } finally {
      setBusy(false);
    }
  }

  async function moderateMessage(
    messageId: string,
    update: { status?: "removed"; pinned?: boolean },
  ) {
    setBusy(true);
    try {
      await apiFetch(`/v1/sessions/${sessionId}/chat/messages/${messageId}`, {
        method: "PATCH",
        headers: { ...authorization, ...mutationHeaders() },
        body: JSON.stringify(update),
      });
      await refresh(true);
    } catch (caught) {
      setError(humanError(caught));
    } finally {
      setBusy(false);
    }
  }

  async function reportMessage(messageId: string) {
    setBusy(true);
    try {
      await apiFetch(`/v1/sessions/${sessionId}/chat/messages/${messageId}/report`, {
        method: "POST",
        headers: { ...authorization, ...mutationHeaders() },
      });
      setReportedMessages((current) => new Set(current).add(messageId));
      await refresh(true);
    } catch (caught) {
      setError(humanError(caught));
    } finally {
      setBusy(false);
    }
  }

  async function moderateParticipant(
    participantId: string,
    action: "mute" | "unmute" | "ban" | "unban",
  ) {
    setBusy(true);
    try {
      await apiFetch(`/v1/sessions/${sessionId}/interactions/participants/${participantId}`, {
        method: "PATCH",
        headers: { ...authorization, ...mutationHeaders() },
        body: JSON.stringify({
          action,
          ...(action === "mute" ? { durationMinutes: muteDurationMinutes } : {}),
        }),
      });
      await refresh(true);
    } catch (caught) {
      setError(humanError(caught));
    } finally {
      setBusy(false);
    }
  }

  const participants = (data?.summary.participants ?? []).filter((participant) => {
    if (participantFilter === "needs_help")
      return ["unsure", "need_example", "too_fast"].includes(participant.currentSignal ?? "");
    if (participantFilter === "not_answered") return !participant.answered;
    if (participantFilter === "disconnected") return !participant.connected;
    if (participantFilter === "muted") return Boolean(participant.mutedUntil || participant.banned);
    return true;
  });
  const showParticipants = view === "all" || view === "participants";
  const showPulse = view === "all" || view === "pulse";
  const showChat = view === "all" || view === "chat";

  if (!data) {
    return (
      <section className="panel audience-panel" aria-busy="true">
        <p lang={error ? "en-CA" : undefined}>{error || t("live.audience.loading")}</p>
      </section>
    );
  }

  return (
    <section className="panel audience-panel" aria-label={t("live.audience.sectionAria")}>
      <div className="audience-panel-heading">
        <div>
          <p className="eyebrow">
            {view === "participants"
              ? t("live.audience.participants")
              : view === "chat"
                ? t("live.audience.roomChat")
                : t("live.audience.pulse")}
          </p>
          <h2>
            {view === "participants"
              ? t("live.audience.participantActivity")
              : view === "pulse"
                ? t("live.audience.roomSignals")
                : view === "chat"
                  ? t("live.audience.conversation")
                  : t("live.audience.signalsAndConversation")}
          </h2>
        </div>
        <span className="status-pill">
          {t("live.audience.liveConnected", { count: data.summary.connectedParticipants })}
        </span>
      </div>
      {error ? (
        <p className="error" lang="en-CA" role="alert">
          {error}
        </p>
      ) : null}

      {role === "moderator" ? (
        <>
          {showPulse || showChat ? (
            <div className="interaction-settings" aria-label={t("live.audience.settingsAria")}>
              {showPulse ? (
                <label className="checkbox-field">
                  <input
                    checked={data.settings.signalsEnabled}
                    disabled={busy || !data.capabilities.audiencePulse}
                    onChange={(event) =>
                      void updateSettings({ signalsEnabled: event.target.checked })
                    }
                    type="checkbox"
                  />
                  {t("live.audience.pulse")}
                </label>
              ) : null}
              {showChat ? (
                <>
                  <label className="checkbox-field">
                    <input
                      checked={data.settings.chatEnabled}
                      disabled={busy || !data.capabilities.roomChat}
                      onChange={(event) =>
                        void updateSettings({ chatEnabled: event.target.checked })
                      }
                      type="checkbox"
                    />
                    {t("live.audience.roomChat")}
                  </label>
                  <label className="field compact-field">
                    <span>{t("live.audience.chatNames")}</span>
                    <select
                      className="select"
                      disabled={busy || !data.capabilities.roomChat}
                      onChange={(event) =>
                        void updateSettings({
                          chatIdentityMode: event.target
                            .value as InteractionSettings["chatIdentityMode"],
                        })
                      }
                      value={data.settings.chatIdentityMode}
                    >
                      <option value="alias_public">{t("live.audience.showAliases")}</option>
                      <option value="alias_private">{t("live.audience.anonymousRoom")}</option>
                    </select>
                  </label>
                  <label className="field compact-field">
                    <span>{t("live.audience.slowMode")}</span>
                    <select
                      className="select"
                      disabled={busy || !data.capabilities.roomChat}
                      onChange={(event) =>
                        void updateSettings({
                          slowModeSeconds: Number(
                            event.target.value,
                          ) as InteractionSettings["slowModeSeconds"],
                        })
                      }
                      value={data.settings.slowModeSeconds}
                    >
                      <option value={0}>{t("live.audience.off")}</option>
                      <option value={5}>{t("live.audience.seconds", { count: 5 })}</option>
                      <option value={15}>{t("live.audience.seconds", { count: 15 })}</option>
                      <option value={30}>{t("live.audience.seconds", { count: 30 })}</option>
                    </select>
                  </label>
                  <label className="field compact-field">
                    <span>{t("live.audience.presenterFeed")}</span>
                    <select
                      className="select"
                      disabled={busy || !data.capabilities.roomChat}
                      onChange={(event) =>
                        void updateSettings({
                          presenterFeedMode: event.target
                            .value as InteractionSettings["presenterFeedMode"],
                        })
                      }
                      value={data.settings.presenterFeedMode}
                    >
                      <option value="off">{t("live.audience.off")}</option>
                      <option value="pinned">{t("live.audience.pinnedOnly")}</option>
                      <option value="live">{t("live.audience.liveFeed")}</option>
                    </select>
                  </label>
                </>
              ) : null}
            </div>
          ) : null}

          {(showPulse && !data.capabilities.audiencePulse) ||
          (showChat && !data.capabilities.roomChat) ? (
            <p className="notice">
              {showPulse && !data.capabilities.audiencePulse
                ? t("live.audience.pulseUnavailable")
                : ""}
              {showChat && !data.capabilities.roomChat ? t("live.audience.chatUnavailable") : ""}
            </p>
          ) : null}

          <div className="audience-metrics">
            {showParticipants ? (
              <>
                <div className="metric">
                  <strong>{data.summary.connectedParticipants}</strong>
                  <span>{t("live.audience.connected")}</span>
                </div>
                <div className="metric">
                  <strong>{data.summary.disconnectedParticipants}</strong>
                  <span>{t("live.audience.disconnected")}</span>
                </div>
                <div className="metric">
                  <strong>{data.summary.answeredParticipants}</strong>
                  <span>{t("live.audience.answered")}</span>
                </div>
              </>
            ) : null}
            {showPulse ? (
              <>
                <div className="metric">
                  <strong>{data.summary.uniqueSignalers}</strong>
                  <span>{t("live.audience.signaled")}</span>
                </div>
                <div className="metric">
                  <strong>{data.summary.signalsLastMinute}</strong>
                  <span>{t("live.audience.signalsPerMinute")}</span>
                </div>
              </>
            ) : null}
            {showChat ? (
              <>
                <div className="metric">
                  <strong>{data.summary.messagesLastMinute}</strong>
                  <span>{t("live.audience.messagesPerMinute")}</span>
                </div>
                <div className="metric">
                  <strong>{data.summary.uniqueChatContributors}</strong>
                  <span>{t("live.audience.contributors")}</span>
                </div>
              </>
            ) : null}
          </div>
        </>
      ) : showPulse && data.settings.signalsEnabled && role === "participant" ? (
        <div className="pulse-compose">
          <p>
            <strong>{t("live.audience.howLanding")}</strong>
          </p>
          <div className="pulse-buttons">
            {signalOptions.map((option) => {
              const selected = data.summary.mySignal === option.id;
              return (
                <button
                  aria-pressed={selected}
                  className="pulse-button"
                  data-selected={selected || undefined}
                  disabled={busy}
                  key={option.id}
                  onClick={() => void setSignal(selected ? null : option.id)}
                  type="button"
                >
                  <span aria-hidden="true">{option.icon}</span>
                  {signalLabel(option.id)}
                </button>
              );
            })}
          </div>
          <small className="muted">{t("live.audience.signalPrivacy")}</small>
        </div>
      ) : null}

      {showPulse && data.summary.signalCounts ? (
        <div className="pulse-distribution" aria-label={t("live.audience.distributionAria")}>
          {signalOptions.map((option) => {
            const count = data.summary.signalCounts?.[option.id] ?? 0;
            const denominator = Math.max(1, data.summary.uniqueSignalers);
            return (
              <div className="pulse-stat" key={option.id}>
                <div>
                  <span>{signalLabel(option.id)}</span>
                  <strong>{count}</strong>
                </div>
                <div className="pulse-meter" aria-hidden="true">
                  <span style={{ width: `${(count / denominator) * 100}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      ) : showPulse && data.summary.uniqueSignalers > 0 ? (
        <p className="muted">{t("live.audience.aggregatePrivacy")}</p>
      ) : null}

      {showParticipants && role === "moderator" && data.summary.participants ? (
        <div className="participant-pulse-table">
          <div className="toolbar">
            <strong>{t("live.audience.participantActivity")}</strong>
            <label>
              <span className="sr-only">{t("live.audience.filterParticipants")}</span>
              <select
                className="select compact-select"
                onChange={(event) =>
                  setParticipantFilter(event.target.value as typeof participantFilter)
                }
                value={participantFilter}
              >
                <option value="all">{t("live.audience.everyone")}</option>
                <option value="needs_help">{t("live.audience.needsHelp")}</option>
                <option value="not_answered">{t("live.audience.notAnswered")}</option>
                <option value="disconnected">{t("live.audience.disconnectedStatus")}</option>
                <option value="muted">{t("live.audience.mutedOrBanned")}</option>
              </select>
            </label>
            <label>
              <span className="sr-only">{t("live.audience.muteDuration")}</span>
              <select
                className="select compact-select"
                onChange={(event) =>
                  setMuteDurationMinutes(Number(event.target.value) as 5 | 15 | 60)
                }
                value={muteDurationMinutes}
              >
                <option value={5}>{t("live.audience.muteMinutes", { count: 5 })}</option>
                <option value={15}>{t("live.audience.muteMinutes", { count: 15 })}</option>
                <option value={60}>{t("live.audience.muteMinutes", { count: 60 })}</option>
              </select>
            </label>
          </div>
          <div className="table-wrap" tabIndex={0}>
            <table>
              <thead>
                <tr>
                  <th>{t("live.audience.alias")}</th>
                  <th>{t("live.audience.status")}</th>
                  <th>{t("live.audience.pulseShort")}</th>
                  <th>{t("live.audience.chat")}</th>
                  <th>{t("live.audience.moderation")}</th>
                </tr>
              </thead>
              <tbody>
                {participants.map((participant) => (
                  <tr key={participant.participantId}>
                    <td>
                      <ParticipantIdentity
                        avatarId={participant.avatarId}
                        nickname={participant.nickname}
                      />
                    </td>
                    <td>
                      {participant.connected
                        ? t("live.audience.connectedStatus")
                        : t("live.audience.offline")}{" "}
                      ·{" "}
                      {participant.answered
                        ? t("live.audience.answered")
                        : t("live.audience.waiting")}
                    </td>
                    <td>
                      {participant.currentSignal ? signalLabel(participant.currentSignal) : "—"}
                    </td>
                    <td>{participant.chatMessageCount}</td>
                    <td>
                      <div className="button-row">
                        <button
                          className="button-quiet tiny-button"
                          disabled={busy}
                          onClick={() =>
                            void moderateParticipant(
                              participant.participantId,
                              participant.mutedUntil ? "unmute" : "mute",
                            )
                          }
                          type="button"
                        >
                          {participant.mutedUntil
                            ? t("live.audience.unmute")
                            : t("live.audience.muteCompact", { count: muteDurationMinutes })}
                        </button>
                        <button
                          className="button-danger tiny-button"
                          disabled={busy}
                          onClick={() =>
                            void moderateParticipant(
                              participant.participantId,
                              participant.banned ? "unban" : "ban",
                            )
                          }
                          type="button"
                        >
                          {participant.banned ? t("live.audience.restore") : t("live.audience.ban")}
                        </button>
                        {onKick ? (
                          <button
                            className="button-danger tiny-button"
                            disabled={busy}
                            onClick={() => onKick(participant.participantId)}
                            type="button"
                          >
                            {t("live.audience.kick")}
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {showChat ? (
        <div className="chat-section">
          <div className="chat-heading">
            <div>
              <p className="eyebrow">{t("live.audience.roomChat")}</p>
              <h3>
                {data.settings.chatEnabled
                  ? t("live.audience.conversationOpen")
                  : t("live.audience.conversationClosed")}
              </h3>
            </div>
            {role === "moderator" ? (
              <span className="muted">
                {t("live.audience.moderationSummary", {
                  reports: data.summary.reportedCount,
                  moderated: data.summary.moderationCount,
                })}
              </span>
            ) : null}
          </div>
          {data.settings.chatEnabled && role !== "presenter" ? (
            <form className="chat-compose" onSubmit={sendMessage}>
              {replyTo ? (
                <div className="chat-replying">
                  {t("live.audience.replyingTo", { name: "" })}
                  <span lang="">{replyTo.author.displayName}</span>
                  <button onClick={() => setReplyTo(null)} type="button">
                    {t("live.audience.cancel")}
                  </button>
                </div>
              ) : null}
              <label className="sr-only" htmlFor={`chat-message-${role}`}>
                {t("live.audience.chatMessage")}
              </label>
              <input
                className="input"
                id={`chat-message-${role}`}
                maxLength={500}
                onChange={(event) => setMessage(event.target.value)}
                placeholder={t("live.audience.messagePlaceholder")}
                value={message}
              />
              <button className="button" disabled={busy || !message.trim()} type="submit">
                {t("live.audience.send")}
              </button>
            </form>
          ) : null}
          <ol className="chat-list" aria-label={t("live.audience.roomMessages")}>
            {data.chat.messages.map((item) => (
              <li className="chat-message" data-removed={item.status === "removed"} key={item.id}>
                <div className="chat-message-meta">
                  <span>
                    <strong lang="">{item.author.displayName}</strong>
                    {item.author.kind === "staff" ? t("live.audience.facilitatorSuffix") : ""}
                  </span>
                  {item.pinned ? (
                    <span className="status-pill">{t("live.audience.pinned")}</span>
                  ) : null}
                </div>
                <p lang="">{item.body}</p>
                {item.status !== "removed" ? (
                  <div className="chat-actions">
                    {role === "participant"
                      ? reactionOptions.map((reaction) => (
                          <button
                            aria-label={t("live.audience.reactionAria", {
                              reaction: reactionLabel(reaction.id),
                              count: item.reactions[reaction.id],
                            })}
                            aria-pressed={item.myReaction === reaction.id}
                            className="reaction-button"
                            disabled={busy}
                            key={reaction.id}
                            onClick={() =>
                              void react(item.id, reaction.id, item.myReaction === reaction.id)
                            }
                            type="button"
                          >
                            <span aria-hidden="true">{reaction.icon}</span>{" "}
                            {item.reactions[reaction.id] || ""}
                          </button>
                        ))
                      : reactionOptions
                          .filter((reaction) => item.reactions[reaction.id] > 0)
                          .map((reaction) => (
                            <span className="reaction-count" key={reaction.id}>
                              <span aria-hidden="true">{reaction.icon}</span>{" "}
                              {item.reactions[reaction.id]}
                            </span>
                          ))}
                    {role !== "presenter" && !item.replyToMessageId ? (
                      <button
                        className="text-button"
                        onClick={() => setReplyTo(item)}
                        type="button"
                      >
                        {t("live.audience.reply")}
                      </button>
                    ) : null}
                    {role === "participant" && !item.author.mine ? (
                      <button
                        className="text-button"
                        disabled={busy || reportedMessages.has(item.id)}
                        onClick={() => void reportMessage(item.id)}
                        type="button"
                      >
                        {reportedMessages.has(item.id)
                          ? t("live.audience.reported")
                          : t("live.audience.report")}
                      </button>
                    ) : null}
                    {role === "moderator" ? (
                      <>
                        <button
                          className="text-button"
                          disabled={busy}
                          onClick={() => void moderateMessage(item.id, { pinned: !item.pinned })}
                          type="button"
                        >
                          {item.pinned ? t("live.audience.unpin") : t("live.audience.pin")}
                        </button>
                        <button
                          className="danger-link"
                          disabled={busy}
                          onClick={() => void moderateMessage(item.id, { status: "removed" })}
                          type="button"
                        >
                          {t("live.audience.remove")}
                        </button>
                      </>
                    ) : null}
                  </div>
                ) : null}
              </li>
            ))}
          </ol>
          {data.chat.messages.length === 0 ? (
            <p className="qna-empty">{t("live.audience.noMessages")}</p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
