import { loadConfig } from "./config.js";
import { startTelemetry } from "./tracing.js";
import { ScopedAudienceOutboxWorker } from "./scoped-audience-outbox-worker.js";
import { JobRunner } from "./job-runner.js";
import { createPlatformRepository } from "@openround/db";
import { createIntegrationWorker } from "@openround/control-plane";

const config = loadConfig();
const telemetry = startTelemetry(config);
const [{ buildApp }, { attachRealtime }] = await Promise.all([
  import("./app.js"),
  import("./realtime.js"),
]);
const {
  app,
  repository,
  platformBillingWorker,
  sessions,
  interactions,
  audienceOutboxWorker,
  retention,
  reportWorker,
  presentationReportWorker,
  authoringWorker,
  metrics,
  cache,
  presentationService,
  audienceScopes,
  audienceScopeService,
} = await buildApp(config);
const realtime = await attachRealtime(
  app.server,
  sessions,
  config,
  metrics,
  interactions,
  {
    service: presentationService,
    consumeAdmission: cache.consumeRateLimit.bind(cache),
  },
  audienceScopeService,
);
const scopedAudienceOutboxWorker = new ScopedAudienceOutboxWorker(audienceScopes, (event) =>
  realtime.scopedAudience!.publish(event),
);
let activeScopedAudienceRun: Promise<unknown> | null = null;
let activeAudienceRun: Promise<unknown> | null = null;
const audienceOutboxTimer = setInterval(() => {
  if (!activeScopedAudienceRun) {
    activeScopedAudienceRun = scopedAudienceOutboxWorker
      .runUntilIdle()
      .then((results) => {
        if (results.includes("retry")) app.log.warn("scoped audience outbox delivery will retry");
      })
      .catch(() => app.log.error("scoped audience outbox relay failed"))
      .finally(() => {
        activeScopedAudienceRun = null;
      });
  }
  if (!activeAudienceRun) {
    activeAudienceRun = audienceOutboxWorker
      .runUntilIdle()
      .catch(() => app.log.error("audience outbox relay failed"))
      .finally(() => {
        activeAudienceRun = null;
      });
  }
}, 250);
audienceOutboxTimer.unref();
const platform = createPlatformRepository(repository);
const integrationWorker = createIntegrationWorker(platform);
const jobs =
  config.BACKGROUND_JOBS_MODE === "in_process"
    ? new JobRunner(
        [
          {
            name: "reports",
            intervalMs: config.REPORT_WORKER_INTERVAL_MS,
            run: () =>
              Promise.all([reportWorker.runUntilIdle(), presentationReportWorker.runUntilIdle()]),
          },
          {
            name: "retention",
            intervalMs: config.RETENTION_INTERVAL_MINUTES * 60_000,
            run: () => retention.run(new Date()),
          },
          {
            name: "authoring",
            intervalMs: config.AUTHORING_WORKER_INTERVAL_MS,
            run: () => authoringWorker.runUntilIdle(),
          },
          {
            name: "billing",
            intervalMs: config.BUSINESS_BILLING_WORKER_INTERVAL_MS,
            run: () => platformBillingWorker.runUntilIdle(),
          },
          {
            name: "billing-reconciliation",
            intervalMs: config.BUSINESS_BILLING_RECONCILE_INTERVAL_MS,
            run: () => platformBillingWorker.reconcileAll(),
          },
          {
            name: "integrations",
            intervalMs: 5_000,
            run: () =>
              config.BUSINESS_PLATFORM_ENABLED
                ? integrationWorker.runUntilIdle()
                : Promise.resolve(),
          },
          {
            name: "heartbeat",
            intervalMs: 15_000,
            run: () =>
              config.BUSINESS_PLATFORM_ENABLED
                ? platform.heartbeat({
                    id: "jobs",
                    status: "healthy",
                    details: { process: "in_process", pid: process.pid },
                  })
                : Promise.resolve(),
          },
          {
            name: "credit-reservations",
            intervalMs: 60_000,
            run: async () => {
              if (!config.BUSINESS_PLATFORM_ENABLED) return;
              for (const room of await platform.listReservedRoomCoverages(new Date())) {
                await platform.releaseExpiredRoomReservation(room.artifactType, room.roomId);
              }
            },
          },
        ],
        (name, error) =>
          app.log.error(
            { job: name, errorType: error instanceof Error ? error.name : "unknown" },
            "background job failed",
          ),
        async (name) => {
          const controlId =
            name === "integrations"
              ? "business-integrations"
              : name === "billing"
                ? "billing-reconciliation"
                : name;
          return !(await platform.getWorkerControl(controlId))?.paused;
        },
      )
    : null;
jobs?.start();

const shutdown = async (signal: string) => {
  app.log.info({ signal }, "graceful shutdown started");
  clearInterval(audienceOutboxTimer);
  await Promise.allSettled([activeScopedAudienceRun, activeAudienceRun]);
  await jobs?.stop();
  await realtime.close();
  await app.close();
  await telemetry.shutdown();
  process.exit(0);
};

process.once("SIGTERM", () => void shutdown("SIGTERM"));
process.once("SIGINT", () => void shutdown("SIGINT"));

await app.listen({ host: config.HOST, port: config.PORT });
