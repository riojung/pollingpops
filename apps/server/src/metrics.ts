import { collectDefaultMetrics, Counter, Gauge, Histogram, Registry } from "@prometheus-io/client";
import type { BusinessHealth, ProductQueueHealth } from "@openround/db";

type OperationalHealth = BusinessHealth & { productQueues?: ProductQueueHealth[] };

interface DatabasePoolMetrics {
  totalCount: number;
  idleCount: number;
  waitingCount: number;
}

const realtimeEventTypes = new Set([
  "lobby.updated",
  "question.open",
  "question.locked",
  "question.reveal",
  "leaderboard.updated",
  "game.finished",
  "session.snapshot",
  "audience.settings.updated",
  "audience.signal.updated",
  "audience.summary.updated",
  "audience.moderation.updated",
  "audience.event",
  "chat.message.created",
  "chat.message.updated",
  "chat.message.removed",
  "chat.message.pinned",
  "chat.reaction.updated",
]);

export const RECOVERY_FUNNEL_STAGES = [
  "create",
  "publish",
  "join",
  "answer_acknowledged",
  "intervention",
  "linked_recheck",
  "report_reconciled",
] as const;
export type RecoveryFunnelStage = (typeof RECOVERY_FUNNEL_STAGES)[number];

const recoveryFunnelStageByProductEvent = new Map<string, RecoveryFunnelStage>([
  ["creation_completed", "create"],
  ["round_published", "publish"],
  ["participant_joined", "join"],
  ["response_saved_acknowledged", "answer_acknowledged"],
  ["intervention_started", "intervention"],
  ["linked_recheck_opened", "linked_recheck"],
  ["report_reconciled", "report_reconciled"],
]);

export class MetricsService {
  readonly registry = new Registry();
  private pool: DatabasePoolMetrics | null = null;
  private businessHealth: (() => Promise<OperationalHealth>) | null = null;
  private readonly businessProjection = new Gauge({
    name: "openround_business_projection_up",
    help: "Whether the durable business health projection can be read",
    registers: [],
  });
  private readonly businessQueue = new Gauge({
    name: "openround_business_queue_jobs",
    help: "Business jobs by bounded queue and state",
    labelNames: ["queue", "state"] as const,
    registers: [this.registry],
  });
  private readonly businessQueueAge = new Gauge({
    name: "openround_business_queue_oldest_seconds",
    help: "Age of the oldest outstanding job in a bounded business queue",
    labelNames: ["queue"] as const,
    registers: [this.registry],
  });
  private readonly businessHeartbeatAge = new Gauge({
    name: "openround_business_worker_heartbeat_age_seconds",
    help: "Age of each expected business worker heartbeat; -1 means missing",
    labelNames: ["worker"] as const,
    registers: [this.registry],
  });
  private readonly creditReservations = new Gauge({
    name: "openround_event_credit_reservations",
    help: "Event credit reservations by expiry state",
    labelNames: ["state"] as const,
    registers: [this.registry],
  });

  private readonly httpDuration = new Histogram({
    name: "openround_http_request_duration_seconds",
    help: "Duration of HTTP requests handled by the API",
    labelNames: ["method", "route", "status_code"] as const,
    buckets: [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
    registers: [this.registry],
  });

  private readonly sessionEvents = new Counter({
    name: "openround_session_events_total",
    help: "Authoritative game events emitted by type",
    labelNames: ["type"] as const,
    registers: [this.registry],
  });

  private readonly joins = new Counter({
    name: "openround_session_joins_total",
    help: "Guest join and reconnect attempts by outcome",
    labelNames: ["kind", "outcome"] as const,
    registers: [this.registry],
  });

  private readonly joinDuration = new Histogram({
    name: "openround_join_acknowledgement_duration_seconds",
    help: "Time to durably admit and acknowledge a guest or reconnect",
    labelNames: ["kind", "outcome"] as const,
    buckets: [0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5],
    registers: [this.registry],
  });

  private readonly joinBatchSize = new Histogram({
    name: "openround_join_batch_size",
    help: "Number of new participants committed in one per-session transaction",
    buckets: [1, 2, 5, 10, 25, 50, 100, 250],
    registers: [this.registry],
  });

  private readonly answers = new Counter({
    name: "openround_answers_total",
    help: "Answer submissions by authoritative outcome",
    labelNames: ["outcome"] as const,
    registers: [this.registry],
  });

  private readonly answerDuration = new Histogram({
    name: "openround_answer_acknowledgement_duration_seconds",
    help: "Time to durably decide and acknowledge an answer",
    labelNames: ["outcome"] as const,
    buckets: [0.025, 0.05, 0.1, 0.25, 0.6, 1, 2.5],
    registers: [this.registry],
  });

  private readonly answerBatchSize = new Histogram({
    name: "openround_answer_batch_size",
    help: "Number of newly accepted answers committed in one per-session transaction",
    buckets: [1, 2, 5, 10, 25, 50, 100, 250],
    registers: [this.registry],
  });

  private readonly answerCommitStageDuration = new Histogram({
    name: "openround_answer_commit_stage_duration_seconds",
    help: "Time answer batches spend waiting for and executing durable PostgreSQL commits",
    labelNames: ["stage"] as const,
    buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1],
    registers: [this.registry],
  });

  private readonly hostCommands = new Counter({
    name: "openround_host_commands_total",
    help: "Host commands by outcome",
    labelNames: ["action", "outcome"] as const,
    registers: [this.registry],
  });

  private readonly syncRequests = new Counter({
    name: "openround_sync_requests_total",
    help: "Reconnect synchronization requests by replay outcome",
    labelNames: ["role", "outcome"] as const,
    registers: [this.registry],
  });

  private readonly replayEvents = new Counter({
    name: "openround_replay_events_total",
    help: "Events returned during reconnect replay",
    registers: [this.registry],
  });

  private readonly sockets = new Gauge({
    name: "openround_realtime_connections",
    help: "Current Socket.IO connections on this process",
    registers: [this.registry],
  });

  private readonly activeSessions = new Gauge({
    name: "openround_active_sessions",
    help: "Sessions currently loaded by this process",
    registers: [this.registry],
  });

  private readonly mutationLeaseWait = new Histogram({
    name: "openround_session_mutation_lease_wait_seconds",
    help: "Time spent acquiring distributed per-session mutation ownership",
    labelNames: ["outcome"] as const,
    buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
    registers: [this.registry],
  });

  private readonly mutationLeaseRenewalFailures = new Counter({
    name: "openround_session_mutation_lease_renewal_failures_total",
    help: "Mutation leases that could not be renewed before work completed",
    registers: [this.registry],
  });

  private readonly sessionVersionConflicts = new Counter({
    name: "openround_session_version_conflicts_total",
    help: "PostgreSQL compare-and-swap conflicts by mutation operation",
    labelNames: ["operation"] as const,
    registers: [this.registry],
  });

  private readonly broadcasts = new Histogram({
    name: "openround_broadcast_duration_seconds",
    help: "Time to fan an authoritative event batch to local and adapter-backed sockets",
    labelNames: ["outcome"] as const,
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1],
    registers: [this.registry],
  });

  private readonly clientEventReceipts = new Histogram({
    name: "openround_client_event_receipt_duration_seconds",
    help: "Round-trip time from emitting an authoritative event until the browser acknowledges receipt",
    labelNames: ["event_type", "role", "outcome"] as const,
    buckets: [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 5],
    registers: [this.registry],
  });

  private readonly mediaFinalizations = new Counter({
    name: "openround_media_finalizations_total",
    help: "Media quarantine finalization attempts by outcome",
    labelNames: ["outcome"] as const,
    registers: [this.registry],
  });

  private readonly billingEvents = new Counter({
    name: "openround_billing_webhooks_total",
    help: "Signature-verified billing webhooks by processing outcome",
    labelNames: ["type", "outcome"] as const,
    registers: [this.registry],
  });

  private readonly billingLag = new Histogram({
    name: "openround_billing_webhook_lag_seconds",
    help: "Delay between provider event creation and local webhook receipt",
    buckets: [1, 5, 15, 30, 60, 300, 900, 3_600],
    registers: [this.registry],
  });

  private readonly retention = new Counter({
    name: "openround_retention_records_total",
    help: "Records handled by scheduled retention",
    labelNames: ["resource", "outcome"] as const,
    registers: [this.registry],
  });

  private readonly deletionBacklog = new Gauge({
    name: "openround_media_deletion_backlog",
    help: "Stale media objects that could not be deleted in the latest retention run",
    registers: [this.registry],
  });

  private readonly reports = new Counter({
    name: "openround_reports_generated_total",
    help: "Durable session reports generated",
    registers: [this.registry],
  });

  private readonly authoringJobs = new Counter({
    name: "openround_authoring_jobs_total",
    help: "Source-grounded authoring job attempts by source type and outcome",
    labelNames: ["source_type", "outcome"] as const,
    registers: [this.registry],
  });

  private readonly authoringDuration = new Histogram({
    name: "openround_authoring_job_duration_seconds",
    help: "Duration of one source extraction and provider generation attempt",
    labelNames: ["source_type", "outcome"] as const,
    buckets: [0.1, 0.5, 1, 2.5, 5, 10, 20, 30, 60, 120],
    registers: [this.registry],
  });

  private readonly productEvents = new Counter({
    name: "openround_product_events_total",
    help: "Privacy-safe beta product events by bounded dimensions",
    labelNames: [
      "name",
      "creation_path",
      "recipe",
      "scenario",
      "segment",
      "beta_version",
      "duration_bucket",
      "artifact_type",
    ] as const,
    registers: [this.registry],
  });

  private readonly recoveryFunnelStages = new Counter({
    name: "openround_recovery_funnel_stages_total",
    help: "Durably recorded recovery funnel stages by bounded rollout dimensions",
    labelNames: ["stage", "artifact_type", "segment"] as const,
    registers: [this.registry],
  });

  private readonly presentationAdmissions = new Counter({
    name: "openround_presentation_admission_attempts_total",
    help: "Presentation participant admission attempts by bounded transport and outcome",
    labelNames: ["transport", "outcome"] as const,
    registers: [this.registry],
  });

  private readonly presentationAdmissionDuration = new Histogram({
    name: "openround_presentation_admission_duration_seconds",
    help: "Time to decide and acknowledge a Presentation participant admission",
    labelNames: ["transport", "outcome"] as const,
    buckets: [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5],
    registers: [this.registry],
  });

  private readonly presentationResponseDuration = new Histogram({
    name: "openround_presentation_response_acknowledgement_duration_seconds",
    help: "Time to durably decide and acknowledge a Presentation response",
    labelNames: ["transport", "outcome"] as const,
    buckets: [0.01, 0.025, 0.05, 0.1, 0.25, 0.6, 1, 2.5],
    registers: [this.registry],
  });

  private readonly presentationClientReceipts = new Histogram({
    name: "openround_presentation_client_event_receipt_duration_seconds",
    help: "Time until a Presentation browser acknowledges a projected realtime event",
    labelNames: ["event_type", "projection", "outcome"] as const,
    buckets: [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 5],
    registers: [this.registry],
  });

  private readonly presentationBroadcastDuration = new Histogram({
    name: "openround_presentation_broadcast_duration_seconds",
    help: "Time to build and emit one role-projected Presentation update",
    labelNames: ["outcome"] as const,
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5],
    registers: [this.registry],
  });

  private readonly audienceEvents = new Counter({
    name: "openround_audience_events_total",
    help: "Durable audience interaction events by bounded event type and outcome",
    labelNames: ["type", "outcome"] as const,
    registers: [this.registry],
  });

  private readonly audienceOutboxLag = new Histogram({
    name: "openround_audience_outbox_publish_lag_seconds",
    help: "Time from audience interaction commit to realtime publication",
    labelNames: ["outcome"] as const,
    buckets: [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 15, 30],
    registers: [this.registry],
  });

  private readonly audienceOutboxBacklog = new Gauge({
    name: "openround_audience_outbox_backlog",
    help: "Committed audience interaction events awaiting realtime publication",
    registers: [this.registry],
  });

  private readonly audienceOutboxOldest = new Gauge({
    name: "openround_audience_outbox_oldest_seconds",
    help: "Age of the oldest committed audience event awaiting publication",
    registers: [this.registry],
  });

  private readonly chatEnabledSessions = new Gauge({
    name: "openround_chat_enabled_sessions",
    help: "Active durable sessions with room chat enabled",
    registers: [this.registry],
  });

  private readonly audienceSyncs = new Counter({
    name: "openround_audience_sync_total",
    help: "Audience state synchronizations by outcome",
    labelNames: ["outcome"] as const,
    registers: [this.registry],
  });

  private readonly audienceRejects = new Counter({
    name: "openround_audience_rejections_total",
    help: "Audience interaction mutations rejected by bounded policy reason",
    labelNames: ["reason"] as const,
    registers: [this.registry],
  });

  private readonly databaseConnections = new Gauge({
    name: "openround_database_connections",
    help: "PostgreSQL pool connections by state",
    labelNames: ["state"] as const,
    registers: [this.registry],
  });

  constructor() {
    collectDefaultMetrics({ prefix: "openround_node_", register: this.registry });
  }

  bindPostgres(pool: DatabasePoolMetrics) {
    this.pool = pool;
  }

  bindBusinessHealth(collect: () => Promise<OperationalHealth>) {
    if (!this.businessHealth) this.registry.registerMetric(this.businessProjection);
    this.businessHealth = collect;
  }

  private async collectBusinessHealth() {
    if (!this.businessHealth) return;
    try {
      const health = await this.businessHealth();
      this.businessProjection.set(1);
      this.businessQueue.reset();
      this.businessQueueAge.reset();
      const queues = [
        { queue: "billing", ...health.billing },
        ...health.integrations.map(({ integration, ...stats }) => ({
          queue: integration,
          ...stats,
        })),
        ...(health.productQueues ?? []).map(({ kind, ...stats }) => ({ queue: kind, ...stats })),
      ];
      for (const queue of queues) {
        const boundedQueue = [
          "billing",
          "jira-service-management",
          "hubspot",
          "quickbooks",
          "round-report",
          "presentation-report",
          "authoring",
        ].includes(queue.queue)
          ? queue.queue
          : "other";
        for (const state of ["pending", "processing", "failed", "ambiguous"] as const) {
          this.businessQueue.set(
            { queue: boundedQueue, state },
            "ambiguous" === state ? ("ambiguous" in queue ? queue.ambiguous : 0) : queue[state],
          );
        }
        this.businessQueueAge.set({ queue: boundedQueue }, queue.oldestPendingAgeSeconds);
      }
      for (const heartbeat of health.heartbeats) {
        const worker = [
          "jobs",
          "platform-billing",
          "platform-billing-reconciliation",
          "business-integrations",
        ].includes(heartbeat.id)
          ? heartbeat.id
          : "other";
        this.businessHeartbeatAge.set({ worker }, heartbeat.ageSeconds);
      }
      this.creditReservations.set({ state: "active" }, health.reservations.active);
      this.creditReservations.set({ state: "expired" }, health.reservations.expired);
    } catch {
      this.businessProjection.set(0);
    }
  }

  recordProductEvent(event: {
    name: string;
    authoritative?: boolean;
    dimensions: {
      creationPath?: string;
      recipe?: string;
      scenario?: string;
      segment?: string;
      betaVersion?: string;
      durationBucket?: string;
      artifactType?: string;
    };
  }) {
    this.productEvents.inc({
      name: event.name,
      creation_path: event.dimensions.creationPath ?? "none",
      recipe: event.dimensions.recipe ?? "none",
      scenario: event.dimensions.scenario ?? "none",
      segment: event.dimensions.segment ?? "none",
      beta_version: event.dimensions.betaVersion ?? "none",
      duration_bucket: event.dimensions.durationBucket ?? "none",
      artifact_type: event.dimensions.artifactType ?? "none",
    });
    const stage = recoveryFunnelStageByProductEvent.get(event.name);
    if (stage && event.authoritative !== false) {
      this.recoveryFunnelStages.inc({
        stage,
        artifact_type:
          event.dimensions.artifactType === "round" ||
          event.dimensions.artifactType === "presentation"
            ? event.dimensions.artifactType
            : "none",
        segment:
          event.dimensions.segment === "education" || event.dimensions.segment === "workplace"
            ? event.dimensions.segment
            : "none",
      });
    }
  }

  recordPresentationAdmission(
    transport: "rest" | "socket",
    outcome: "accepted" | "duplicate" | "rate_limited" | "full" | "invalid" | "error",
    seconds?: number,
  ) {
    this.presentationAdmissions.inc({ transport, outcome });
    if (seconds !== undefined) {
      this.presentationAdmissionDuration.observe({ transport, outcome }, Math.max(0, seconds));
    }
  }

  observePresentationResponse(
    transport: "rest" | "socket",
    outcome: "accepted" | "duplicate" | "rejected" | "rate_limited" | "error",
    seconds: number,
  ) {
    this.presentationResponseDuration.observe({ transport, outcome }, Math.max(0, seconds));
  }

  observePresentationClientReceipt(
    eventType: "presentation.session.updated" | "presentation.room-status.updated",
    projection: "host" | "participant" | "companion",
    outcome: "acknowledged" | "timeout",
    seconds: number,
  ) {
    this.presentationClientReceipts.observe(
      { event_type: eventType, projection, outcome },
      Math.max(0, seconds),
    );
  }

  observePresentationBroadcast(outcome: "success" | "error", seconds: number) {
    this.presentationBroadcastDuration.observe({ outcome }, Math.max(0, seconds));
  }

  recordAudienceEvent(type: string, outcome: "published" | "duplicate" | "retry", lag: number) {
    const boundedType = [
      "audience.settings.updated",
      "audience.signal.updated",
      "audience.summary.updated",
      "audience.moderation.updated",
      "chat.message.created",
      "chat.message.updated",
      "chat.message.removed",
      "chat.message.pinned",
      "chat.reaction.updated",
      "qna.question.created",
      "qna.question.updated",
      "qna.reply.created",
      "qna.reply.updated",
      "qna.vote.updated",
      "qna.settings.updated",
    ].includes(type)
      ? type
      : "other";
    this.audienceEvents.inc({ type: boundedType, outcome });
    this.audienceOutboxLag.observe({ outcome }, Math.max(0, lag));
  }

  setAudienceOutboxStatus(pending: number, oldestAgeSeconds: number, chatEnabledSessions: number) {
    this.audienceOutboxBacklog.set(Math.max(0, pending));
    this.audienceOutboxOldest.set(Math.max(0, oldestAgeSeconds));
    this.chatEnabledSessions.set(Math.max(0, chatEnabledSessions));
  }

  recordAudienceSync(outcome: "success" | "error") {
    this.audienceSyncs.inc({ outcome });
  }

  recordAudienceRejection(reason: string) {
    const boundedReason = [
      "AUDIENCE_BANNED",
      "CHAT_CAPACITY_REACHED",
      "CHAT_MUTED",
      "CHAT_RATE_LIMITED",
      "SIGNAL_RATE_LIMITED",
    ].includes(reason)
      ? reason
      : "other";
    this.audienceRejects.inc({ reason: boundedReason });
  }

  observeHttp(method: string, route: string, statusCode: number, seconds: number) {
    this.httpDuration.observe({ method, route, status_code: String(statusCode) }, seconds);
  }

  recordSessionEvents(types: string[]) {
    for (const type of types) this.sessionEvents.inc({ type });
  }

  recordJoin(kind: "new" | "resume", outcome: string, seconds: number) {
    this.joins.inc({ kind, outcome });
    this.joinDuration.observe({ kind, outcome }, seconds);
  }

  recordJoinBatch(size: number) {
    if (size > 0) this.joinBatchSize.observe(size);
  }

  recordAnswer(outcome: string, seconds: number) {
    this.answers.inc({ outcome });
    this.answerDuration.observe({ outcome }, seconds);
  }

  recordAnswerBatch(size: number) {
    if (size > 0) this.answerBatchSize.observe(size);
  }

  observeAnswerCommitStage(stage: "wait" | "persist", seconds: number) {
    this.answerCommitStageDuration.observe({ stage }, Math.max(0, seconds));
  }

  recordHostCommand(action: string, outcome: string) {
    this.hostCommands.inc({ action, outcome });
  }

  recordSync(role: string, replayComplete: boolean, events: number) {
    this.syncRequests.inc({ role, outcome: replayComplete ? "complete" : "snapshot_fallback" });
    if (events > 0) this.replayEvents.inc(events);
  }

  socketConnected() {
    this.sockets.inc();
  }

  socketDisconnected() {
    this.sockets.dec();
  }

  setActiveSessions(count: number) {
    this.activeSessions.set(count);
  }

  observeMutationLease(outcome: "acquired" | "timeout" | "error", seconds: number) {
    this.mutationLeaseWait.observe({ outcome }, seconds);
  }

  mutationLeaseRenewalFailed() {
    this.mutationLeaseRenewalFailures.inc();
  }

  sessionVersionConflict(operation: string) {
    this.sessionVersionConflicts.inc({ operation });
  }

  observeBroadcast(outcome: "success" | "error", seconds: number) {
    this.broadcasts.observe({ outcome }, seconds);
  }

  observeClientEventReceipt(
    eventType: string,
    role: "host" | "presenter" | "participant",
    outcome: "acknowledged" | "timeout",
    seconds: number,
  ) {
    this.clientEventReceipts.observe(
      {
        event_type: realtimeEventTypes.has(eventType) ? eventType : "other",
        role,
        outcome,
      },
      Math.max(0, seconds),
    );
  }

  recordMediaFinalization(outcome: "clean" | "rejected" | "error") {
    this.mediaFinalizations.inc({ outcome });
  }

  recordBillingEvent(type: string, outcome: "applied" | "duplicate" | "invalid_signature") {
    this.billingEvents.inc({ type, outcome });
  }

  observeBillingLag(seconds: number) {
    this.billingLag.observe(Math.max(0, seconds));
  }

  recordRetention(result: {
    expiredLiveSessions: number;
    purgedSessions: number;
    purgedPracticeAssignments: number;
    purgedAuditEvents: number;
    purgedProductEvents: number;
    purgedMedia: number;
    failedMedia: number;
  }) {
    if (result.expiredLiveSessions > 0)
      this.retention.inc(
        { resource: "live_session", outcome: "expired" },
        result.expiredLiveSessions,
      );
    if (result.purgedSessions > 0)
      this.retention.inc({ resource: "session", outcome: "deleted" }, result.purgedSessions);
    if (result.purgedPracticeAssignments > 0)
      this.retention.inc(
        { resource: "practice_assignment", outcome: "deleted" },
        result.purgedPracticeAssignments,
      );
    if (result.purgedAuditEvents > 0)
      this.retention.inc({ resource: "audit_event", outcome: "deleted" }, result.purgedAuditEvents);
    if (result.purgedProductEvents > 0)
      this.retention.inc(
        { resource: "product_event", outcome: "deleted" },
        result.purgedProductEvents,
      );
    if (result.purgedMedia > 0)
      this.retention.inc({ resource: "media", outcome: "deleted" }, result.purgedMedia);
    if (result.failedMedia > 0)
      this.retention.inc({ resource: "media", outcome: "failed" }, result.failedMedia);
    this.deletionBacklog.set(result.failedMedia);
  }

  reportGenerated() {
    this.reports.inc();
  }

  recordAuthoringJob(sourceType: string, outcome: string, seconds: number) {
    this.authoringJobs.inc({ source_type: sourceType, outcome });
    this.authoringDuration.observe({ source_type: sourceType, outcome }, Math.max(0, seconds));
  }

  async render() {
    await this.collectBusinessHealth();
    if (this.pool) {
      this.databaseConnections.set({ state: "total" }, this.pool.totalCount);
      this.databaseConnections.set({ state: "idle" }, this.pool.idleCount);
      this.databaseConnections.set({ state: "waiting" }, this.pool.waitingCount);
    }
    return this.registry.metrics();
  }

  get contentType() {
    return this.registry.contentType;
  }
}
