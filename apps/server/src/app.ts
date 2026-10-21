import type { Plan } from "@openround/contracts";
import { workspaceFeatureEnabled } from "./feature-policy.js";
import Fastify from "fastify";
import { trace } from "@opentelemetry/api";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import formbody from "@fastify/formbody";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import rawBody from "fastify-raw-body";
import type Stripe from "stripe";
import {
  createCollaborationGroupRepository,
  createAudienceScopeRepository,
  createScopedQnaRepository,
  createSurveyRepository,
  createIdeaBoardRepository,
  createSessionSummaryRepository,
  createLibraryMetadataRepository,
  createPresentationRepository,
  createRecoveryPackRepository,
  createPresentationSessionRepository,
  createPlatformRepository,
  MemoryRepository,
  PostgresRepository,
  type Repository,
} from "@openround/db";
import { AuthService } from "./auth.js";
import { registerPlatformRoutes } from "./platform-routes.js";
import { registerRoomFundingRoutes } from "./room-funding-routes.js";
import { AudienceOutboxWorker } from "./audience-outbox-worker.js";
import { AudienceScopeService } from "./audience-scope-service.js";
import { registerAudienceScopeRoutes } from "./audience-scope-routes.js";
import {
  OpenAiCompatibleAuthoringAssistant,
  type AuthoringAssistant,
} from "./authoring-assistant.js";
import { AuthoringService } from "./authoring-service.js";
import { AuthoringWorker } from "./authoring-worker.js";
import { MemorySessionCache, RedisSessionCache, type SessionCache } from "./cache.js";
import { isLocalProductAdminDevelopment, type AppConfig } from "./config.js";
import { ConsoleMailer, SmtpMailer, type Mailer } from "./mailer.js";
import { FollowupService } from "./followup-service.js";
import { ClamAvScanner, type MalwareScanner } from "./malware-scanner.js";
import { MetricsService } from "./metrics.js";
import { LtiService, ltiJwtAdapterFromConfig, type LtiJwtAdapter } from "./lti-service.js";
import { InteractionService } from "./interaction-service.js";
import { GenericOidcProvider, OidcService, type OidcProvider } from "./oidc-service.js";
import { originAllowed } from "./origin.js";
import { QnaService } from "./qna-service.js";
import { registerRoutes } from "./routes.js";
import { ReportWorker } from "./report-worker.js";
import { PresentationReportWorker } from "./presentation-report-worker.js";
import { presentationRecoveryPackLiveInsertionEnabled } from "./presentation-live-recovery-packs.js";
import { presentationLiveInsertionEnabled } from "./presentation-live-insertion.js";
import { RetentionService } from "./retention.js";
import { SessionService } from "./session-service.js";
import { StorageService } from "./storage.js";
import { ProductEventDispatcher } from "./product-events.js";
import { registerPresentationRoutes } from "./presentation-routes.js";
import { registerPresentationSessionRoutes } from "./presentation-session-routes.js";
import { PresentationSessionService } from "./presentation-session-service.js";
import { registerGroupRoutes } from "./group-routes.js";
import { registerHomeRoutes } from "./home-routes.js";
import { registerLibraryRoutes } from "./library-routes.js";
import { registerLiveRoomRoutes } from "./live-room-routes.js";
import { registerSurveyRoutes } from "./survey-routes.js";
import { registerIdeaBoardRoutes } from "./idea-board-routes.js";
import { registerSessionSummaryRoutes } from "./session-summary-routes.js";
import { createSessionSummaryExportService } from "./session-summary-export.js";
import { registerFeedbackRoutes } from "./feedback-routes.js";
import { registerQuestionHealthRoutes } from "./question-health-routes.js";
import { registerRecoveryPackRoutes } from "./recovery-pack-routes.js";
import { registerRecoveryPackPortabilityRoutes } from "./recovery-pack-portability-routes.js";
import { registerRecoveryPackSourceRoutes } from "./recovery-pack-source-routes.js";
import { registerRecoveryPackPracticeRoutes } from "./recovery-pack-practice-routes.js";
import { registerRecoveryPackPresentationRoutes } from "./recovery-pack-presentation-routes.js";
import { registerRecoveryPackPresentationUpdateRoutes } from "./recovery-pack-presentation-update-routes.js";

export async function buildApp(
  config: AppConfig,
  overrides: {
    repository?: Repository;
    cache?: SessionCache;
    mailer?: Mailer;
    scanner?: MalwareScanner | null;
    stripe?: Stripe | null;
    readiness?: () => Promise<void>;
    authoringAssistant?: AuthoringAssistant | null;
    oidcProvider?: OidcProvider | null;
    ltiJwtAdapter?: LtiJwtAdapter | null;
    summaryExports?: ReturnType<typeof createSessionSummaryExportService>;
  } = {},
) {
  const app = Fastify({
    // Forwarded client addresses affect IP rate-limit keys. Trust only the exact address of the
    // deployment's dedicated Caddy-to-server link; an unset value keeps Fastify's safe default.
    trustProxy: config.TRUSTED_PROXY_IP ?? false,
    logger: {
      level: config.LOG_LEVEL,
      redact: {
        paths: [
          "req.headers.authorization",
          "req.headers.cookie",
          "request.headers.authorization",
          "request.headers.cookie",
          "*.participantToken",
          "*.hostToken",
          "*.controlToken",
          "*.companionToken",
          "*.token",
          "pin",
          "pinHash",
          "challengeId",
          "*.pin",
          "*.pinHash",
          "*.debugPin",
          "*.challengeId",
          "*.attemptToken",
          "*.genericToken",
          "*.accessSeed",
          "*.nickname",
          "password",
          "joinPassword",
          "joinPasswordHash",
          "*.password",
          "*.joinPassword",
          "*.joinPasswordHash",
          "*.body",
          "*.email",
        ],
        censor: "[REDACTED]",
      },
      serializers: {
        // Authorization callbacks and magic links carry one-time credentials in the query.
        // Keep request logging useful without ever serializing the query string.
        req(request) {
          return {
            method: request.method,
            url: request.url?.split("?", 1)[0],
            remoteAddress: request.socket?.remoteAddress,
          };
        },
      },
      transport:
        config.NODE_ENV === "development"
          ? { target: "pino-pretty", options: { colorize: true, translateTime: "SYS:standard" } }
          : undefined,
    },
    bodyLimit: 128 * 1024,
    requestIdHeader: "x-request-id",
  });

  const repository =
    overrides.repository ??
    (config.DATABASE_URL
      ? new PostgresRepository(config.DATABASE_URL)
      : config.ALLOW_IN_MEMORY || config.NODE_ENV === "test"
        ? new MemoryRepository({
            initialWorkspaceId: config.TEST_INITIAL_WORKSPACE_ID,
            initialPlan: config.TEST_INITIAL_PLAN,
          })
        : (() => {
            throw new Error("DATABASE_URL is required unless ALLOW_IN_MEMORY=true");
          })());
  const metrics = new MetricsService();
  if (config.BUSINESS_PLATFORM_ENABLED && !config.COMMUNITY_MODE) {
    const healthRepository = createPlatformRepository(repository);
    metrics.bindBusinessHealth(async () => {
      const [health, productQueues] = await Promise.all([
        healthRepository.getBusinessHealth(),
        healthRepository.getProductQueueHealth(),
      ]);
      return { ...health, productQueues };
    });
  }
  const presentations = createPresentationRepository(repository);
  const recoveryPacks = createRecoveryPackRepository(repository);
  const presentationSessions = createPresentationSessionRepository(repository, {
    concurrentResponseWrites: config.PRESENTATION_CONCURRENT_RESPONSE_WRITES,
  });
  const groups = createCollaborationGroupRepository(repository);
  const libraryMetadata = createLibraryMetadataRepository(repository);
  const productEventsEnabled = (workspaceId: string) =>
    workspaceFeatureEnabled(repository, config, workspaceId, "uxBeta");
  const workspaceShellEnabled = (workspaceId: string) =>
    workspaceFeatureEnabled(repository, config, workspaceId, "workspaceShell");
  const presentationsEnabled = (workspaceId: string) =>
    workspaceFeatureEnabled(repository, config, workspaceId, "presentations");
  const presentationRealtimeCreationEnabled = (workspaceId: string, planOverride?: Plan) =>
    workspaceFeatureEnabled(repository, config, workspaceId, "presentationRealtime", planOverride);
  const groupsEnabled = (workspaceId: string) =>
    workspaceFeatureEnabled(repository, config, workspaceId, "groups");
  if (repository instanceof PostgresRepository) metrics.bindPostgres(repository.pool);
  if (repository instanceof PostgresRepository && config.RUN_MIGRATIONS) {
    if (config.DATABASE_MIGRATION_URL && config.DATABASE_MIGRATION_URL !== config.DATABASE_URL) {
      const migrationRepository = new PostgresRepository(config.DATABASE_MIGRATION_URL);
      try {
        await migrationRepository.migrate();
      } finally {
        await migrationRepository.close();
      }
    } else {
      await repository.migrate();
    }
  }
  await repository.initialize();

  let cache: SessionCache;
  if (overrides.cache) cache = overrides.cache;
  else if (config.REDIS_URL) {
    const redis = new RedisSessionCache(config.REDIS_URL);
    await redis.connect();
    cache = redis;
  } else cache = new MemorySessionCache();

  await app.register(cors, {
    origin: isLocalProductAdminDevelopment(config)
      ? [config.WEB_ORIGIN, new URL(config.CONTROL_PRODUCT_ORIGIN!).origin]
      : config.WEB_ORIGIN,
    credentials: true,
    methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: [
      "content-type",
      "authorization",
      "x-request-id",
      "x-idempotency-key",
      "traceparent",
      "tracestate",
    ],
    exposedHeaders: [
      "x-request-id",
      "x-trace-id",
      "retry-after",
      ...(isLocalProductAdminDevelopment(config) ? ["x-local-operator-revocation"] : []),
    ],
  });
  await app.register(cookie);
  await app.register(formbody);
  await app.register(helmet, {
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: "cross-origin" },
  });
  // Browser tests share one loopback address and deliberately exercise many independent
  // users in a short window. Keep endpoint-specific limits active, but do not let the
  // production-wide IP budget make unrelated end-to-end tests fail each other.
  await app.register(rateLimit, {
    global: true,
    max: config.NODE_ENV === "test" ? 10_000 : 300,
    timeWindow: "1 minute",
  });
  await app.register(rawBody, { field: "rawBody", global: false, encoding: false, runFirst: true });

  app.addHook("preHandler", async (request, reply) => {
    const requestPath = request.url.split("?", 1)[0];
    if (
      ["GET", "HEAD", "OPTIONS"].includes(request.method) ||
      request.url.startsWith("/v1/webhooks/stripe") ||
      (request.method === "POST" &&
        (requestPath === "/v1/lti/login" || requestPath === "/v1/lti/launch"))
    )
      return;
    const allowed =
      (isLocalProductAdminDevelopment(config) &&
        request.headers.origin === new URL(config.CONTROL_PRODUCT_ORIGIN!).origin) ||
      originAllowed({
        origin: request.headers.origin,
        host: request.headers.host,
        forwardedProto: request.headers["x-forwarded-proto"],
        encrypted: Boolean((request.raw.socket as { encrypted?: boolean }).encrypted),
        configuredOrigin: config.WEB_ORIGIN,
      });
    if (!allowed) {
      return reply.code(403).send({
        error: {
          code: "UNAUTHORIZED",
          message: "Request origin is not allowed",
          requestId: request.id,
        },
      });
    }
  });

  const mailer =
    overrides.mailer ?? (config.SMTP_URL ? new SmtpMailer(config) : new ConsoleMailer());
  const auth = new AuthService(repository, mailer, config);
  const oidcProvider =
    overrides.oidcProvider !== undefined
      ? overrides.oidcProvider
      : config.OIDC_MODE === "generic"
        ? new GenericOidcProvider(config)
        : null;
  const oidc = new OidcService(repository, config, oidcProvider);
  const ltiJwtAdapter =
    overrides.ltiJwtAdapter !== undefined
      ? overrides.ltiJwtAdapter
      : ltiJwtAdapterFromConfig(config);
  const lti = new LtiService(repository, config, ltiJwtAdapter);
  const productEvents = new ProductEventDispatcher(repository, metrics, (error) => {
    app.log.warn(
      { errorType: error instanceof Error ? error.name : "unknown" },
      "product event persistence failed",
    );
  });
  const sessions = new SessionService(
    repository,
    cache,
    config,
    metrics,
    productEvents,
    async (code) => Boolean(await presentationSessions.getSessionByCode(code)),
  );
  const interactions = new InteractionService(repository, sessions, config, metrics);
  const qna = new QnaService(repository, sessions, interactions);
  const audienceScopes = createAudienceScopeRepository(repository);
  const scopedQna = createScopedQnaRepository(repository);
  const audienceScopeService = new AudienceScopeService({
    repository,
    presentations: presentationSessions,
    scopes: audienceScopes,
    config,
    interactions,
    qna,
    scopedQna,
  });
  const audienceOutboxWorker = new AudienceOutboxWorker(repository, interactions, metrics);
  const followups = new FollowupService(repository);
  const scanner =
    overrides.scanner !== undefined
      ? overrides.scanner
      : config.MEDIA_SCAN_MODE === "clamav"
        ? new ClamAvScanner(config.CLAMAV_HOST!, config.CLAMAV_PORT, config.CLAMAV_TIMEOUT_MS)
        : null;
  const authoringAssistant =
    overrides.authoringAssistant !== undefined
      ? overrides.authoringAssistant
      : config.AUTHORING_AI_MODE === "openai_compatible"
        ? new OpenAiCompatibleAuthoringAssistant(
            config.AUTHORING_AI_ENDPOINT!,
            config.AUTHORING_AI_API_KEY,
            config.AUTHORING_AI_MODEL,
            config.AUTHORING_AI_PROVIDER_NAME,
          )
        : null;
  const authoring = new AuthoringService(repository, Boolean(authoringAssistant), scanner);
  const authoringWorker = new AuthoringWorker(
    repository,
    authoringAssistant,
    config.AUTHORING_WORKER_LEASE_MS,
    config.AUTHORING_EXTRACTION_TIMEOUT_MS,
    metrics,
  );
  const storage = new StorageService(config, scanner);
  const presentationService = new PresentationSessionService({
    workspaceEnabled: presentationRealtimeCreationEnabled,
    liveFlexModeEnabled: (workspaceId, planOverride) =>
      workspaceFeatureEnabled(repository, config, workspaceId, "liveFlexMode", planOverride),
    repository,
    presentations,
    sessions: presentationSessions,
    packs: recoveryPacks,
    config,
    storage,
    productEvents,
    productEventsEnabled,
    recoveryPackCardsEnabled: (workspaceId, planOverride) =>
      workspaceFeatureEnabled(
        repository,
        config,
        workspaceId,
        "recoveryPackLiveCards",
        planOverride,
      ),
    recoveryPackLiveInsertionEnabled: (workspaceId, sessionId) =>
      presentationRecoveryPackLiveInsertionEnabled(config, workspaceId, repository, sessionId),
    quickCheckLiveInsertionEnabled: (workspaceId, sessionId) =>
      presentationLiveInsertionEnabled(config, workspaceId, repository, sessionId),
    publishedQuestionLiveInsertionEnabled: (workspaceId, sessionId) =>
      presentationLiveInsertionEnabled(config, workspaceId, repository, sessionId),
  });
  const readiness =
    overrides.readiness ??
    (async () => {
      await Promise.all([
        repository.getOperationalFeatures(),
        cache.get("00000000-0000-0000-0000-000000000000"),
      ]);
    });
  const retention = new RetentionService(
    repository,
    storage,
    config.MEDIA_QUARANTINE_RETENTION_HOURS,
    metrics,
    (sessionIds) => sessions.invalidate(sessionIds),
    config.AUDIT_RETENTION_DAYS,
  );
  const reportWorker = new ReportWorker(repository, config.REPORT_WORKER_LEASE_MS, metrics, {
    dispatcher: productEvents,
    workspaceEnabled: productEventsEnabled,
  });
  const presentationReportWorker = new PresentationReportWorker(
    presentationSessions,
    config.REPORT_WORKER_LEASE_MS,
    metrics,
    {
      dispatcher: productEvents,
      workspaceEnabled: productEventsEnabled,
    },
  );
  const requestStarts = new WeakMap<object, number>();
  app.addHook("onRequest", async (request) => {
    requestStarts.set(request, performance.now());
  });
  app.addHook("onSend", async (request, reply) => {
    reply.header("x-request-id", request.id);
    const span = trace.getActiveSpan()?.spanContext();
    if (span?.traceId) reply.header("x-trace-id", span.traceId);
  });
  app.addHook("onResponse", async (request, reply) => {
    const startedAt = requestStarts.get(request);
    if (startedAt === undefined) return;
    metrics.observeHttp(
      request.method,
      request.routeOptions.url ?? "unmatched",
      reply.statusCode,
      (performance.now() - startedAt) / 1_000,
    );
  });
  await registerRoutes(app, {
    config,
    repository,
    auth,
    oidc,
    lti,
    sessions,
    qna,
    interactions,
    followups,
    authoring,
    storage,
    retention,
    metrics,
    productEvents,
    readiness,
    consumeAuthBudget: cache.consumeRateLimit.bind(cache),
    consumeAuthIpBudget: cache.consumeRateLimitBudget.bind(cache),
    consumeEmailAuthBudget: cache.consumeEmailAuthBudget.bind(cache),
    stripeClient: overrides.stripe,
  });
  await registerQuestionHealthRoutes(app, { config, repository, auth });
  const { platformBillingWorker } = await registerPlatformRoutes(app, {
    config,
    repository,
    auth,
    stripeClient: overrides.stripe,
  });
  await registerRoomFundingRoutes(app, { config, repository, auth });
  await registerAudienceScopeRoutes(app, audienceScopeService, cache.consumeRateLimit.bind(cache));
  await registerRecoveryPackRoutes(app, { config, repository, packs: recoveryPacks, auth });
  await registerRecoveryPackPortabilityRoutes(app, { packs: recoveryPacks, auth });
  await registerRecoveryPackSourceRoutes(app, { config, repository, packs: recoveryPacks, auth });
  await registerRecoveryPackPracticeRoutes(app, {
    config,
    repository,
    packs: recoveryPacks,
    auth,
    productEvents,
  });
  await registerRecoveryPackPresentationRoutes(app, {
    config,
    repository,
    presentations,
    packs: recoveryPacks,
    auth,
    workspaceEnabled: presentationsEnabled,
  });
  await registerRecoveryPackPresentationUpdateRoutes(app, {
    config,
    repository,
    presentations,
    packs: recoveryPacks,
    auth,
    workspaceEnabled: presentationsEnabled,
  });
  await registerLiveRoomRoutes(app, {
    repository,
    sessions,
    presentationSessions,
    config,
    surveys: createSurveyRepository(repository),
    consumeAdmission: cache.consumeRateLimit.bind(cache),
  });
  await registerSurveyRoutes(app, {
    repository,
    auth,
    config,
    surveys: createSurveyRepository(repository),
    consumeAdmission: cache.consumeRateLimit.bind(cache),
  });
  await registerIdeaBoardRoutes(app, {
    repository,
    auth,
    config,
    boards: createIdeaBoardRepository(repository),
    storage,
    metrics,
    consumeAdmission: cache.consumeRateLimit.bind(cache),
  });
  const summaryExports = overrides.summaryExports ?? createSessionSummaryExportService();
  await registerSessionSummaryRoutes(app, {
    repository,
    auth,
    config,
    summaries: createSessionSummaryRepository(repository),
    surveys: createSurveyRepository(repository),
    presentationSessions,
    exports: summaryExports,
    consumeAdmission: cache.consumeRateLimit.bind(cache),
  });
  await registerFeedbackRoutes(app, {
    repository,
    auth,
    config,
    consumeAdmission: cache.consumeIdempotentRateLimit.bind(cache),
  });
  // Presentation read and recovery routes remain registered when a rollout is paused. Route-level
  // workspace gates still prevent creation and other new authoring mutations.
  await registerPresentationRoutes(app, {
    repository,
    presentations,
    auth,
    workspaceEnabled: presentationsEnabled,
    productEvents,
    productEventsEnabled,
  });
  await registerPresentationSessionRoutes(app, {
    repository,
    presentations,
    presentationSessions,
    auth,
    config,
    storage,
    workspaceEnabled: presentationRealtimeCreationEnabled,
    metrics,
    consumeAdmission: cache.consumeRateLimit.bind(cache),
    service: presentationService,
  });
  {
    await registerGroupRoutes(app, {
      repository,
      presentations,
      groups,
      auth,
      workspaceEnabled: groupsEnabled,
      presentationsEnabled,
    });
  }
  await registerHomeRoutes(app, {
    repository,
    presentations,
    presentationSessions,
    groups,
    auth,
    workspaceEnabled: workspaceShellEnabled,
    presentationsEnabled,
    groupsEnabled,
  });
  await registerLibraryRoutes(app, {
    repository,
    presentations,
    libraryMetadata,
    surveys: createSurveyRepository(repository),
    auth,
    workspaceEnabled: workspaceShellEnabled,
    presentationsEnabled,
  });

  app.addHook("onClose", async () => {
    sessions.close();
    await summaryExports.close();
    await productEvents.close();
    await cache.close();
    await repository.close();
  });

  return {
    app,
    repository,
    cache,
    sessions,
    qna,
    interactions,
    audienceOutboxWorker,
    audienceScopes,
    audienceScopeService,
    followups,
    authoring,
    oidc,
    lti,
    authoringWorker,
    storage,
    retention,
    reportWorker,
    presentationReportWorker,
    platformBillingWorker,
    metrics,
    productEvents,
    presentations,
    presentationSessions,
    presentationService,
    groups,
    libraryMetadata,
  };
}
