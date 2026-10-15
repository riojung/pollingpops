import { roomFeatureEnabled } from "./feature-policy.js";
import { randomUUID } from "node:crypto";
import type {
  AudienceSignal,
  ChatMessage,
  ChatPage,
  ChatReaction,
  InteractionSettings,
  InteractionSummary,
} from "@openround/contracts";
import {
  AudienceStoreError,
  type AudienceRestrictionRecord,
  type AudienceMutation,
  type AudienceOutboxRecord,
  type ChatActivitySummaryRecord,
  type ChatMessageRecord,
  type ChatReactionRecord,
  type InteractionSettingsRecord,
  type ParticipantChatActivityRecord,
  type ParticipantSignalRecord,
  type Repository,
  type StoredSession,
} from "@openround/db";
import { avatarIdForSeed } from "@openround/game-engine";
import { cleanPlainText } from "./security.js";
import {
  AudienceAccessError,
  RoundAudienceAccess,
  roundAudienceCanModerate,
  type RoundAudienceActor as InteractionActor,
  type RoundParticipantActor as ParticipantActor,
  type RoundStaffActor as StaffActor,
} from "./audience-access.js";
import type { SessionService } from "./session-service.js";
import type { MetricsService } from "./metrics.js";
import type { AppConfig } from "./config.js";

export type AudienceRealtimeViewer = {
  moderator: boolean;
  participantId?: string;
  actorId?: string;
  staffCredentialId?: string;
  presenter?: boolean;
  rootHost?: boolean;
};

export type PreparedAudienceChatEvent = {
  hostId: string;
  messageId: string;
  message: ChatMessageRecord | null;
  reactions: ChatReactionRecord[];
  settings: InteractionSettingsRecord;
};

type InteractionSummaryData = {
  settings: InteractionSettingsRecord;
  availability: { audiencePulse: boolean; roomChat: boolean };
  contextKey: string;
  signals: ParticipantSignalRecord[];
  signalsLastMinute: number;
  chat: ChatActivitySummaryRecord;
  participantChat: ParticipantChatActivityRecord[];
  restrictions: AudienceRestrictionRecord[];
};

export class InteractionError extends Error {
  constructor(
    public readonly code:
      | "INTERACTIONS_DISABLED"
      | "CHAT_DISABLED"
      | "CHAT_MUTED"
      | "CHAT_RATE_LIMITED"
      | "CHAT_CAPACITY_REACHED"
      | "AUDIENCE_BANNED"
      | "SIGNAL_RATE_LIMITED"
      | "MESSAGE_REMOVED"
      | "UNAUTHORIZED"
      | "NOT_FOUND"
      | "CONFLICT",
    message: string,
  ) {
    super(message);
    this.name = "InteractionError";
  }
}

function cursorFor(message: ChatMessageRecord) {
  return Buffer.from(JSON.stringify([message.createdAt.toISOString(), message.id])).toString(
    "base64url",
  );
}

function decodeCursor(cursor: string) {
  try {
    const value: unknown = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (
      !Array.isArray(value) ||
      value.length !== 2 ||
      typeof value[0] !== "string" ||
      typeof value[1] !== "string"
    ) {
      throw new Error("invalid cursor");
    }
    const createdAt = new Date(value[0]);
    if (Number.isNaN(createdAt.getTime())) throw new Error("invalid cursor date");
    return { createdAt, id: value[1] };
  } catch {
    throw new InteractionError("CONFLICT", "The chat pagination cursor is invalid");
  }
}

export class InteractionService {
  constructor(
    private readonly repository: Repository,
    private readonly sessions: SessionService,
    private readonly config: AppConfig,
    private readonly metrics?: MetricsService,
  ) {}

  private translate(error: unknown): never {
    if (error instanceof AudienceStoreError) {
      this.metrics?.recordAudienceRejection(error.code);
      throw new InteractionError(error.code, error.message);
    }
    throw error;
  }

  private async authenticate(sessionId: string, token: string): Promise<InteractionActor> {
    try {
      return await new RoundAudienceAccess(this.repository).authenticate(sessionId, token);
    } catch (error) {
      if (error instanceof AudienceAccessError)
        throw new InteractionError(error.code, error.message);
      throw error;
    }
  }

  private canModerate(actor: InteractionActor): actor is StaffActor {
    return roundAudienceCanModerate(actor);
  }

  private ensureOpen(actor: InteractionActor) {
    if (actor.session.state.phase === "finished") {
      throw new InteractionError(
        "INTERACTIONS_DISABLED",
        "Audience interactions are closed because this live round has finished",
      );
    }
  }

  private contextKey(session: StoredSession) {
    if (
      session.state.phase === "intervention" &&
      session.state.intervention &&
      session.state.intervention.finishedAtMs === null
    ) {
      return `intervention:${session.state.intervention.id}`;
    }
    return session.state.roundId ? `round:${session.state.roundId}` : "lobby";
  }

  private settingsView(
    record: InteractionSettingsRecord,
    availability: { audiencePulse: boolean; roomChat: boolean } = {
      audiencePulse: true,
      roomChat: true,
    },
  ): InteractionSettings {
    return {
      signalsEnabled: availability.audiencePulse && record.signalsEnabled,
      chatEnabled: availability.roomChat && record.chatEnabled,
      chatIdentityMode: record.chatIdentityMode,
      slowModeSeconds: record.slowModeSeconds,
      presenterFeedMode: record.presenterFeedMode,
    };
  }

  private async availability(workspaceId: string, sessionId: string) {
    const [runtime, audiencePulse, roomChat] = await Promise.all([
      this.repository.getOperationalFeatures(),
      roomFeatureEnabled(
        this.repository,
        this.config,
        "round",
        sessionId,
        workspaceId,
        "audiencePulse",
        true,
      ),
      roomFeatureEnabled(
        this.repository,
        this.config,
        "round",
        sessionId,
        workspaceId,
        "roomChat",
        true,
      ),
    ]);
    return {
      audiencePulse: audiencePulse && runtime.audiencePulse,
      roomChat: roomChat && runtime.roomChat,
    };
  }

  private async publish<T>(mutation: AudienceMutation<T>) {
    const lag = () => (Date.now() - mutation.event.createdAt.getTime()) / 1_000;
    if (mutation.duplicate) {
      this.metrics?.recordAudienceEvent(mutation.event.type, "duplicate", lag());
      return;
    }
    try {
      const delivered = await this.sessions.publishAudience(mutation.event);
      if (delivered) {
        await this.repository.completeAudienceOutbox(mutation.event.eventId, new Date());
        this.metrics?.recordAudienceEvent(mutation.event.type, "published", lag());
      }
    } catch {
      // The committed outbox row is intentionally left pending for the relay worker.
      this.metrics?.recordAudienceEvent(mutation.event.type, "retry", lag());
    }
  }

  async publishOutboxEvent(event: AudienceOutboxRecord) {
    const delivered = await this.sessions.publishAudience(event);
    if (delivered) {
      await this.completeOutboxEvents([event.eventId]);
      this.metrics?.recordAudienceEvent(
        event.type,
        "published",
        (Date.now() - event.createdAt.getTime()) / 1_000,
      );
    }
    return delivered;
  }

  async completeOutboxEvents(eventIds: Iterable<string>) {
    const deliveredAt = new Date();
    await Promise.all(
      [...new Set(eventIds)].map((eventId) =>
        this.repository.completeAudienceOutbox(eventId, deliveredAt),
      ),
    );
  }

  async publishCompatibilityEvent(
    session: Pick<StoredSession, "id" | "workspaceId">,
    type: `qna.${string}`,
    payload: Record<string, unknown>,
    idempotencyKey: string,
  ) {
    const stored = await this.repository.getSessionById(session.id);
    if (!stored || stored.workspaceId !== session.workspaceId) {
      throw new InteractionError("NOT_FOUND", "Live round not found");
    }
    await this.settingsFor(stored);
    const mutation = await this.repository.appendAudienceEvent(
      session.workspaceId,
      session.id,
      { eventId: randomUUID(), idempotencyKey, type, payload },
      new Date(),
    );
    await this.publish(mutation);
    return mutation.event;
  }

  private async settingsFor(session: StoredSession): Promise<InteractionSettingsRecord> {
    const existing = await this.repository.getInteractionSettings(session.workspaceId, session.id);
    if (existing) return existing;
    const now = new Date();
    const defaults: Omit<InteractionSettingsRecord, "audienceSeq" | "closedAt"> = {
      workspaceId: session.workspaceId,
      sessionId: session.id,
      signalsEnabled: true,
      chatEnabled: false,
      chatIdentityMode: "alias_public",
      slowModeSeconds: 5,
      presenterFeedMode: "pinned",
      updatedAt: now,
    };
    // Retained closed rooms may predate interaction initialization. Reads must not bootstrap a
    // settings row or allocate an event after finishing; use transient defaults for projection.
    if (session.state.phase === "finished") {
      return { ...defaults, audienceSeq: 0, closedAt: session.updatedAt };
    }
    const mutation = await this.repository.saveInteractionSettings(defaults, {
      eventId: randomUUID(),
      idempotencyKey: `interaction-bootstrap:${session.id}`,
      type: "audience.settings.updated",
      payload: {},
    });
    await this.publish(mutation);
    return mutation.record;
  }

  private async ensureParticipantAllowed(actor: ParticipantActor) {
    const restriction = await this.repository.getAudienceRestriction(
      actor.session.workspaceId,
      actor.session.id,
      actor.participant.id,
    );
    if (restriction?.bannedAt) {
      throw new InteractionError("AUDIENCE_BANNED", "Audience interaction access was revoked");
    }
    return restriction;
  }

  async getSettings(sessionId: string, token: string) {
    return (await this.getSettingsSnapshot(sessionId, token)).settings;
  }

  /** Keep the cursor and projected settings tied to the same accepted bootstrap/read. */
  async getSettingsSnapshot(sessionId: string, token: string) {
    const actor = await this.authenticate(sessionId, token);
    const availability = await this.availability(actor.session.workspaceId, actor.session.id);
    const record = await this.settingsFor(actor.session);
    return {
      record,
      settings: { ...this.settingsView(record, availability), capabilities: availability },
    };
  }

  async updateSettings(
    sessionId: string,
    token: string,
    update: Partial<InteractionSettings>,
    idempotencyKey: string,
    requestId: string,
  ) {
    const actor = await this.authenticate(sessionId, token);
    this.ensureOpen(actor);
    if (!this.canModerate(actor)) {
      throw new InteractionError("UNAUTHORIZED", "Only hosts and cohosts can change interactions");
    }
    const availability = await this.availability(actor.session.workspaceId, actor.session.id);
    if (update.signalsEnabled && !availability.audiencePulse) {
      throw new InteractionError("INTERACTIONS_DISABLED", "Audience Pulse is not available");
    }
    if (update.chatEnabled && !availability.roomChat) {
      throw new InteractionError("CHAT_DISABLED", "Room chat is not available");
    }
    const current = await this.settingsFor(actor.session);
    const now = new Date();
    try {
      const mutation = await this.repository.saveInteractionSettings(
        { ...current, ...update, updatedAt: now },
        {
          eventId: randomUUID(),
          idempotencyKey,
          type: "audience.settings.updated",
          payload: {},
        },
      );
      await this.publish(mutation);
      await this.repository.recordAudit({
        workspaceId: actor.session.workspaceId,
        actorId: actor.rootHost ? actor.session.hostId : null,
        action: "audience.settings.update",
        targetType: "game_session",
        targetId: sessionId,
        requestId,
        metadata: actor.credential ? { staffCredentialId: actor.credential.id } : {},
      });
      return this.settingsView(mutation.record, availability);
    } catch (error) {
      this.translate(error);
    }
  }

  async setSignal(
    sessionId: string,
    token: string,
    signal: AudienceSignal | null,
    idempotencyKey: string,
  ) {
    const actor = await this.authenticate(sessionId, token);
    this.ensureOpen(actor);
    if (actor.kind !== "participant") {
      throw new InteractionError("UNAUTHORIZED", "Only participants can send a pulse signal");
    }
    await this.ensureParticipantAllowed(actor);
    if (!(await this.availability(actor.session.workspaceId, actor.session.id)).audiencePulse) {
      throw new InteractionError("INTERACTIONS_DISABLED", "Audience Pulse is not available");
    }
    const settings = await this.settingsFor(actor.session);
    if (!settings.signalsEnabled) {
      throw new InteractionError("INTERACTIONS_DISABLED", "Audience Pulse is disabled");
    }
    const contextKey = this.contextKey(actor.session);
    const now = new Date();
    try {
      const mutation = await this.repository.setParticipantSignal(
        {
          workspaceId: actor.session.workspaceId,
          sessionId,
          contextKey,
          participantId: actor.participant.id,
          signal,
          now,
        },
        {
          eventId: randomUUID(),
          idempotencyKey,
          type: "audience.signal.updated",
          payload: {
            participantId: actor.participant.id,
            contextKey,
            signal,
            updatedAt: now.toISOString(),
          },
        },
      );
      await this.publish(mutation);
      return {
        audienceSeq: mutation.event.audienceSeq,
        contextKey,
        signal: mutation.record?.signal ?? null,
      };
    } catch (error) {
      this.translate(error);
    }
  }

  private viewerForActor(actor: InteractionActor): AudienceRealtimeViewer {
    return {
      moderator: this.canModerate(actor),
      ...(actor.kind === "participant"
        ? { participantId: actor.participant.id }
        : {
            ...(actor.rootHost ? { actorId: actor.session.hostId } : {}),
            ...(actor.credential ? { staffCredentialId: actor.credential.id } : {}),
            presenter: actor.credential?.role === "presenter",
          }),
    };
  }

  private chatMessageView(
    message: ChatMessageRecord,
    viewer: AudienceRealtimeViewer,
    reactions: ChatReactionRecord[],
  ): ChatMessage {
    const mine = Boolean(
      (viewer.participantId && message.participantId === viewer.participantId) ||
      (viewer.actorId && message.actorId === viewer.actorId) ||
      (viewer.staffCredentialId && message.staffCredentialId === viewer.staffCredentialId),
    );
    const staffMessage = Boolean(message.actorId || message.staffCredentialId);
    const messageReactions = reactions.filter((reaction) => reaction.messageId === message.id);
    const reactionCounts: ChatMessage["reactions"] = {
      like: 0,
      love: 0,
      insight: 0,
      laugh: 0,
    };
    for (const reaction of messageReactions) {
      reactionCounts[reaction.reaction] = (reactionCounts[reaction.reaction] ?? 0) + 1;
    }
    return {
      id: message.id,
      audienceSeq: message.audienceSeq,
      body: message.status === "removed" ? "Message removed" : message.body,
      status: message.status,
      author: {
        displayName: staffMessage
          ? message.authorAlias
          : mine
            ? "You"
            : viewer.moderator || message.identityModeAtCreation === "alias_public"
              ? message.authorAlias
              : "Anonymous",
        kind: staffMessage ? "staff" : "participant",
        mine,
      },
      replyToMessageId: message.replyToId,
      pinned: message.pinned,
      reactions: reactionCounts,
      myReaction: viewer.participantId
        ? (messageReactions.find((reaction) => reaction.participantId === viewer.participantId)
            ?.reaction ?? null)
        : null,
      createdAt: message.createdAt.toISOString(),
      ...(viewer.moderator && message.participantId
        ? { moderationParticipantId: message.participantId }
        : {}),
    };
  }

  async listChat(
    sessionId: string,
    token: string,
    options: { cursor?: string; limit: number },
  ): Promise<ChatPage> {
    const actor = await this.authenticate(sessionId, token);
    const settings = await this.settingsFor(actor.session);
    const availability = await this.availability(actor.session.workspaceId, actor.session.id);
    const presenter = actor.kind === "staff" && actor.credential?.role === "presenter";
    const feedDisabled = presenter && settings.presenterFeedMode === "off";
    const cursor = options.cursor ? decodeCursor(options.cursor) : undefined;
    if (!availability.roomChat || feedDisabled) {
      return {
        messages: [],
        nextCursor: null,
        settings: this.settingsView(settings, availability),
        audienceSeq: settings.audienceSeq,
      };
    }
    const messages = await this.repository.listChatMessages(actor.session.workspaceId, sessionId, {
      cursor,
      limit: options.limit + 1,
      pinnedOnly: presenter && settings.presenterFeedMode === "pinned",
    });
    const hasMore = messages.length > options.limit;
    const page = hasMore ? messages.slice(0, options.limit) : messages;
    const reactions = await this.repository.listChatReactions(
      actor.session.workspaceId,
      sessionId,
      page.map((message) => message.id),
    );
    const viewer = this.viewerForActor(actor);
    return {
      messages: page.map((message) => this.chatMessageView(message, viewer, reactions)),
      nextCursor: hasMore && page.length > 0 ? cursorFor(page.at(-1)!) : null,
      settings: this.settingsView(settings, availability),
      audienceSeq: settings.audienceSeq,
    };
  }

  async prepareRealtimeChat(
    sessionId: string,
    messageId: string,
  ): Promise<PreparedAudienceChatEvent | null> {
    const session = await this.repository.getSessionById(sessionId);
    if (!session) return null;
    const [message, settings] = await Promise.all([
      this.repository.getChatMessage(session.workspaceId, messageId),
      this.repository.getInteractionSettings(session.workspaceId, sessionId),
    ]);
    if (!settings || (message && message.sessionId !== sessionId)) return null;
    const reactions = message
      ? await this.repository.listChatReactions(session.workspaceId, sessionId, [message.id])
      : [];
    return { hostId: session.hostId, messageId, message, reactions, settings };
  }

  projectRealtimeChat(
    prepared: PreparedAudienceChatEvent,
    viewer: AudienceRealtimeViewer,
  ): { messageId: string; message: ChatMessage | null } {
    const visible =
      prepared.message &&
      (!viewer.presenter ||
        prepared.settings.presenterFeedMode === "live" ||
        (prepared.settings.presenterFeedMode === "pinned" && prepared.message.pinned));
    return {
      messageId: prepared.messageId,
      message: visible
        ? this.chatMessageView(
            prepared.message!,
            {
              ...viewer,
              ...(viewer.rootHost ? { actorId: prepared.hostId } : {}),
            },
            prepared.reactions,
          )
        : null,
    };
  }

  async createChatMessage(
    sessionId: string,
    token: string,
    input: { body: string; replyToMessageId: string | null; idempotencyKey: string },
  ) {
    const actor = await this.authenticate(sessionId, token);
    this.ensureOpen(actor);
    if (actor.kind === "staff" && !this.canModerate(actor)) {
      throw new InteractionError("UNAUTHORIZED", "Presenter credentials are read-only");
    }
    if (actor.kind === "participant") await this.ensureParticipantAllowed(actor);
    if (!(await this.availability(actor.session.workspaceId, actor.session.id)).roomChat) {
      throw new InteractionError("CHAT_DISABLED", "Room chat is not available");
    }
    const settings = await this.settingsFor(actor.session);
    if (!settings.chatEnabled) {
      throw new InteractionError("CHAT_DISABLED", "Chat is disabled for this live round");
    }
    const body = cleanPlainText(input.body.normalize("NFKC"), 500);
    if (!body) throw new InteractionError("CONFLICT", "Enter a message before sending");
    const now = new Date();
    const messageId = randomUUID();
    try {
      const mutation = await this.repository.createChatMessage(
        {
          id: messageId,
          workspaceId: actor.session.workspaceId,
          sessionId,
          participantId: actor.kind === "participant" ? actor.participant.id : null,
          actorId: actor.kind === "staff" && actor.rootHost ? actor.session.hostId : null,
          staffCredentialId:
            actor.kind === "staff" && !actor.rootHost ? (actor.credential?.id ?? null) : null,
          replyToId: input.replyToMessageId,
          body,
          authorAlias:
            actor.kind === "participant"
              ? actor.participant.nickname
              : actor.credential?.label || "Facilitator",
          identityModeAtCreation: settings.chatIdentityMode,
          status: "published",
          pinned: false,
          idempotencyKey: input.idempotencyKey,
          createdAt: now,
          updatedAt: now,
        },
        {
          eventId: randomUUID(),
          idempotencyKey: input.idempotencyKey,
          type: "chat.message.created",
          payload: { messageId },
        },
      );
      await this.publish(mutation);
      const reactions = await this.repository.listChatReactions(
        actor.session.workspaceId,
        sessionId,
        [mutation.record.id],
      );
      return this.chatMessageView(mutation.record, this.viewerForActor(actor), reactions);
    } catch (error) {
      this.translate(error);
    }
  }

  async moderateMessage(
    sessionId: string,
    messageId: string,
    token: string,
    update: { status?: "published" | "removed"; pinned?: boolean },
    idempotencyKey: string,
    requestId: string,
  ) {
    const actor = await this.authenticate(sessionId, token);
    this.ensureOpen(actor);
    if (!this.canModerate(actor)) {
      throw new InteractionError("UNAUTHORIZED", "Only hosts and cohosts can moderate chat");
    }
    const type =
      update.status === "removed"
        ? "chat.message.removed"
        : update.pinned !== undefined
          ? "chat.message.pinned"
          : "chat.message.updated";
    try {
      const mutation = await this.repository.updateChatMessage(
        actor.session.workspaceId,
        sessionId,
        messageId,
        update,
        {
          eventId: randomUUID(),
          idempotencyKey,
          type,
          payload: { messageId },
        },
        new Date(),
      );
      await this.publish(mutation);
      await this.repository.recordAudit({
        workspaceId: actor.session.workspaceId,
        actorId: actor.rootHost ? actor.session.hostId : null,
        action: type,
        targetType: "chat_message",
        targetId: messageId,
        requestId,
        metadata: actor.credential ? { staffCredentialId: actor.credential.id } : {},
      });
      return { messageId, status: mutation.record.status, pinned: mutation.record.pinned };
    } catch (error) {
      this.translate(error);
    }
  }

  async setReaction(
    sessionId: string,
    messageId: string,
    token: string,
    reaction: ChatReaction | null,
    idempotencyKey: string,
  ) {
    const actor = await this.authenticate(sessionId, token);
    this.ensureOpen(actor);
    if (actor.kind !== "participant") {
      throw new InteractionError("UNAUTHORIZED", "Only participants can react to chat messages");
    }
    await this.ensureParticipantAllowed(actor);
    if (!(await this.availability(actor.session.workspaceId, actor.session.id)).roomChat) {
      throw new InteractionError("CHAT_DISABLED", "Room chat is not available");
    }
    const settings = await this.settingsFor(actor.session);
    if (!settings.chatEnabled) {
      throw new InteractionError("CHAT_DISABLED", "Chat is disabled for this live round");
    }
    try {
      const mutation = await this.repository.setChatReaction(
        {
          workspaceId: actor.session.workspaceId,
          sessionId,
          messageId,
          participantId: actor.participant.id,
          reaction,
          now: new Date(),
        },
        {
          eventId: randomUUID(),
          idempotencyKey,
          type: "chat.reaction.updated",
          payload: { messageId },
        },
      );
      await this.publish(mutation);
      return mutation.record;
    } catch (error) {
      this.translate(error);
    }
  }

  async reportMessage(sessionId: string, messageId: string, token: string, idempotencyKey: string) {
    const actor = await this.authenticate(sessionId, token);
    this.ensureOpen(actor);
    if (actor.kind !== "participant") {
      throw new InteractionError("UNAUTHORIZED", "Only participants can report chat messages");
    }
    await this.ensureParticipantAllowed(actor);
    if (!(await this.availability(actor.session.workspaceId, actor.session.id)).roomChat) {
      throw new InteractionError("CHAT_DISABLED", "Room chat is not available");
    }
    try {
      const message = await this.repository.getChatMessage(actor.session.workspaceId, messageId);
      if (!message || message.sessionId !== sessionId) {
        throw new AudienceStoreError("NOT_FOUND", "Chat message not found");
      }
      if (message.participantId === actor.participant.id) {
        throw new InteractionError("CONFLICT", "You cannot report your own message");
      }
      const mutation = await this.repository.reportChatMessage(
        actor.session.workspaceId,
        sessionId,
        messageId,
        actor.participant.id,
        new Date(),
        {
          eventId: randomUUID(),
          idempotencyKey,
          type: "audience.summary.updated",
          payload: {},
        },
      );
      await this.publish(mutation);
      return { reported: true };
    } catch (error) {
      this.translate(error);
    }
  }

  async moderateParticipant(
    sessionId: string,
    participantId: string,
    token: string,
    input: { action: "mute" | "unmute" | "ban" | "unban"; durationMinutes?: 5 | 15 | 60 },
    idempotencyKey: string,
    requestId: string,
  ) {
    const actor = await this.authenticate(sessionId, token);
    this.ensureOpen(actor);
    if (!this.canModerate(actor)) {
      throw new InteractionError(
        "UNAUTHORIZED",
        "Only hosts and cohosts can moderate participants",
      );
    }
    if (!actor.session.state.participants[participantId]) {
      throw new InteractionError("NOT_FOUND", "Participant not found");
    }
    const current = await this.repository.getAudienceRestriction(
      actor.session.workspaceId,
      sessionId,
      participantId,
    );
    const now = new Date();
    const mutedUntil =
      input.action === "mute"
        ? new Date(now.getTime() + (input.durationMinutes ?? 5) * 60_000)
        : input.action === "unmute"
          ? null
          : (current?.mutedUntil ?? null);
    const bannedAt =
      input.action === "ban" ? now : input.action === "unban" ? null : (current?.bannedAt ?? null);
    try {
      const mutation = await this.repository.saveAudienceRestriction(
        {
          workspaceId: actor.session.workspaceId,
          sessionId,
          participantId,
          mutedUntil,
          bannedAt,
          actorId: actor.rootHost ? actor.session.hostId : null,
          staffCredentialId: actor.credential?.id ?? null,
          updatedAt: now,
        },
        {
          eventId: randomUUID(),
          idempotencyKey,
          type: "audience.moderation.updated",
          payload: {
            participantId,
            mutedUntil: mutedUntil?.toISOString() ?? null,
            banned: Boolean(bannedAt),
          },
        },
      );
      await this.publish(mutation);
      await this.repository.recordAudit({
        workspaceId: actor.session.workspaceId,
        actorId: actor.rootHost ? actor.session.hostId : null,
        action: `audience.participant.${input.action}`,
        targetType: "participant",
        targetId: participantId,
        requestId,
        metadata: actor.credential ? { staffCredentialId: actor.credential.id } : {},
      });
      return {
        participantId,
        mutedUntil: mutation.record.mutedUntil?.toISOString() ?? null,
        banned: Boolean(mutation.record.bannedAt),
      };
    } catch (error) {
      this.translate(error);
    }
  }

  private async loadSummaryData(
    session: StoredSession,
    includeModeratorDetails: boolean,
  ): Promise<InteractionSummaryData> {
    const contextKey = this.contextKey(session);
    const since = new Date(Date.now() - 60_000);
    const [
      settings,
      availability,
      signals,
      signalsLastMinute,
      chat,
      participantChat,
      restrictions,
    ] = await Promise.all([
      this.settingsFor(session),
      this.availability(session.workspaceId, session.id),
      this.repository.listParticipantSignals(session.workspaceId, session.id, contextKey),
      this.repository.countRecentSignalEvents(session.workspaceId, session.id, since),
      this.repository.getChatActivitySummary(session.workspaceId, session.id, since),
      includeModeratorDetails
        ? this.repository.listParticipantChatActivity(session.workspaceId, session.id)
        : Promise.resolve([]),
      includeModeratorDetails
        ? this.repository.listAudienceRestrictions(session.workspaceId, session.id)
        : Promise.resolve([]),
    ]);
    return {
      settings,
      availability,
      contextKey,
      signals,
      signalsLastMinute,
      chat,
      participantChat,
      restrictions,
    };
  }

  private projectSummary(
    session: StoredSession,
    data: InteractionSummaryData,
    viewer: { moderator: boolean; participantId?: string },
  ): InteractionSummary {
    const participants = Object.values(session.state.participants);
    const signalCounts = { got_it: 0, unsure: 0, need_example: 0, too_fast: 0 };
    const visibleSignals = data.availability.audiencePulse ? data.signals : [];
    for (const signal of visibleSignals) signalCounts[signal.signal] += 1;
    const currentAnswers = new Set(
      Object.values(session.state.answers).map((answer) => answer.participantId),
    );
    const aggregateVisible = viewer.moderator || visibleSignals.length >= 5;
    const chat = data.availability.roomChat
      ? data.chat
      : { messagesLastMinute: 0, uniqueContributors: 0, removedMessages: 0, reportCount: 0 };
    const activeRestrictions = data.restrictions.filter(
      (restriction) =>
        Boolean(restriction.bannedAt) ||
        Boolean(restriction.mutedUntil && restriction.mutedUntil > new Date()),
    );
    const base: InteractionSummary = {
      audienceSeq: data.settings.audienceSeq,
      contextKey: data.contextKey,
      connectedParticipants: participants.filter((participant) => participant.connected).length,
      disconnectedParticipants: participants.filter((participant) => !participant.connected).length,
      answeredParticipants: currentAnswers.size,
      uniqueSignalers: visibleSignals.length,
      signalCounts: aggregateVisible ? signalCounts : null,
      signalsLastMinute: data.availability.audiencePulse ? data.signalsLastMinute : 0,
      messagesLastMinute: chat.messagesLastMinute,
      uniqueChatContributors: chat.uniqueContributors,
      moderationCount: chat.removedMessages + activeRestrictions.length,
      reportedCount: chat.reportCount,
      ...(viewer.participantId
        ? {
            mySignal: data.availability.audiencePulse
              ? (data.signals.find((signal) => signal.participantId === viewer.participantId)
                  ?.signal ?? null)
              : null,
          }
        : {}),
    };
    if (!viewer.moderator) return base;
    const activityByParticipant = new Map(
      data.participantChat.map((activity) => [activity.participantId, activity]),
    );
    const restrictionByParticipant = new Map(
      data.restrictions.map((restriction) => [restriction.participantId, restriction]),
    );
    base.participants = participants.map((participant) => {
      const signal = visibleSignals.find((candidate) => candidate.participantId === participant.id);
      const participantActivity = data.availability.roomChat
        ? activityByParticipant.get(participant.id)
        : undefined;
      const restriction = restrictionByParticipant.get(participant.id);
      const latestChat = participantActivity?.latestMessageAt ?? null;
      const latestActivity = [signal?.updatedAt ?? null, latestChat]
        .filter((value): value is Date => Boolean(value))
        .sort((left, right) => right.getTime() - left.getTime())[0];
      return {
        participantId: participant.id,
        nickname: participant.nickname,
        avatarId: participant.avatarId ?? avatarIdForSeed(participant.id),
        connected: participant.connected,
        answered: currentAnswers.has(participant.id),
        currentSignal: signal?.signal ?? null,
        lastSignalAt: signal?.updatedAt.toISOString() ?? null,
        lastActivityAt: latestActivity?.toISOString() ?? null,
        chatMessageCount: participantActivity?.messageCount ?? 0,
        mutedUntil:
          restriction?.mutedUntil && restriction.mutedUntil > new Date()
            ? restriction.mutedUntil.toISOString()
            : null,
        banned: Boolean(restriction?.bannedAt),
      };
    });
    return base;
  }

  async realtimeSummaries(sessionId: string) {
    const session = await this.repository.getSessionById(sessionId);
    if (!session) throw new InteractionError("NOT_FOUND", "Live round not found");
    const data = await this.loadSummaryData(session, true);
    return {
      publicSummary: this.projectSummary(session, data, { moderator: false }),
      moderatorSummary: this.projectSummary(session, data, { moderator: true }),
    };
  }

  async realtimeSettings(sessionId: string) {
    const session = await this.repository.getSessionById(sessionId);
    if (!session) throw new InteractionError("NOT_FOUND", "Live round not found");
    const [settings, availability] = await Promise.all([
      this.settingsFor(session),
      this.availability(session.workspaceId, session.id),
    ]);
    return this.settingsView(settings, availability);
  }

  async summary(sessionId: string, token: string): Promise<InteractionSummary> {
    const actor = await this.authenticate(sessionId, token);
    const moderator = this.canModerate(actor);
    const data = await this.loadSummaryData(actor.session, moderator);
    return this.projectSummary(actor.session, data, {
      moderator,
      ...(actor.kind === "participant" ? { participantId: actor.participant.id } : {}),
    });
  }

  async sync(sessionId: string, token: string, limit = 50) {
    try {
      const actor = await this.authenticate(sessionId, token);
      const [summary, chat] = await Promise.all([
        this.summary(sessionId, token),
        this.listChat(sessionId, token, { limit }),
      ]);
      const capabilities = await this.availability(actor.session.workspaceId, actor.session.id);
      this.metrics?.recordAudienceSync("success");
      return { settings: chat.settings, capabilities, summary, chat };
    } catch (error) {
      this.metrics?.recordAudienceSync("error");
      throw error;
    }
  }
}
