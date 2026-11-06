import {
  createPlatformRepository,
  createPresentationSessionRepository,
  MemoryRepository,
  PostgresRepository,
} from "@openround/db";
import type { AppConfig } from "./config.js";
import { JobRunner } from "./job-runner.js";
import { ReportWorker } from "./report-worker.js";
import { PresentationReportWorker } from "./presentation-report-worker.js";
import { AuthoringWorker } from "./authoring-worker.js";
import { PresentationVisualImportWorker } from "./presentation-visual-import-worker.js";
import { OpenAiCompatibleAuthoringAssistant } from "./authoring-assistant.js";
import {
  OpenAiCompatiblePresentationAssistanceProvider,
  presentationAssistanceProviderAvailable,
} from "./presentation-assistance-provider.js";
import { PresentationAssistanceService } from "./presentation-assistance-service.js";
import { PresentationAssistanceWorker } from "./presentation-assistance-worker.js";
import {
  OpenAiCompatiblePresentationTextAssistanceProvider,
  presentationTextAssistanceProviderAvailable,
} from "./presentation-text-assistance-provider.js";
import { PresentationTextAssistanceService } from "./presentation-text-assistance-service.js";
import { PresentationTextAssistanceWorker } from "./presentation-text-assistance-worker.js";
import { createPresentationRepository } from "@openround/db";
import { workspaceFeatureEnabled } from "./feature-policy.js";
import { ClamAvScanner } from "./malware-scanner.js";
import { StorageService } from "./storage.js";
import { RetentionService } from "./retention.js";
import { RedisSessionCache, MemorySessionCache } from "./cache.js";
import { PlatformBillingWorker } from "./platform-billing-worker.js";
import { bootstrapPlatformCatalog } from "./platform-billing-worker.js";
import { createIntegrationWorker } from "@openround/control-plane";

/** Constructs jobs without starting HTTP, sockets, gameplay timers, or customer auth. */
export async function createJobsRuntime(
  config: AppConfig,
  onError: (name: string, error: unknown) => void,
) {
  const repository = config.DATABASE_URL
    ? new PostgresRepository(config.DATABASE_URL)
    : config.ALLOW_IN_MEMORY || config.NODE_ENV === "test"
      ? new MemoryRepository()
      : (() => {
          throw new Error("Jobs require DATABASE_URL");
        })();
  await repository.initialize();
  const cache = config.REDIS_URL
    ? new RedisSessionCache(config.REDIS_URL)
    : new MemorySessionCache();
  if (cache instanceof RedisSessionCache) await cache.connect();
  const scanner =
    config.MEDIA_SCAN_MODE === "clamav"
      ? new ClamAvScanner(config.CLAMAV_HOST!, config.CLAMAV_PORT, config.CLAMAV_TIMEOUT_MS)
      : null;
  const storage = new StorageService(config, scanner);
  const visualImports = new PresentationVisualImportWorker(repository, storage);
  const assistant =
    config.AUTHORING_AI_MODE === "openai_compatible"
      ? new OpenAiCompatibleAuthoringAssistant(
          config.AUTHORING_AI_ENDPOINT!,
          config.AUTHORING_AI_API_KEY,
          config.AUTHORING_AI_MODEL,
          config.AUTHORING_AI_PROVIDER_NAME,
        )
      : null;
  const reports = new ReportWorker(repository, config.REPORT_WORKER_LEASE_MS);
  const presentations = createPresentationSessionRepository(repository);
  const presentationReports = new PresentationReportWorker(
    presentations,
    config.REPORT_WORKER_LEASE_MS,
  );
  const authoring = new AuthoringWorker(
    repository,
    assistant,
    config.AUTHORING_WORKER_LEASE_MS,
    config.AUTHORING_EXTRACTION_TIMEOUT_MS,
  );
  const configuredAssistanceProvider =
    config.AUTHORING_AI_MODE === "openai_compatible"
      ? new OpenAiCompatiblePresentationAssistanceProvider(
          config.AUTHORING_AI_ENDPOINT!,
          config.AUTHORING_AI_API_KEY,
          config.AUTHORING_AI_MODEL,
          config.AUTHORING_AI_PROVIDER_NAME,
        )
      : null;
  const assistanceProvider = presentationAssistanceProviderAvailable(configuredAssistanceProvider)
    ? configuredAssistanceProvider
    : null;
  const assistanceService = new PresentationAssistanceService(
    repository,
    createPresentationRepository(repository),
    Boolean(assistanceProvider),
    (workspaceId) => workspaceFeatureEnabled(repository, config, workspaceId, "presentations"),
  );
  const presentationAssistance = new PresentationAssistanceWorker(
    repository,
    assistanceProvider,
    assistanceService,
    config.AUTHORING_WORKER_LEASE_MS,
  );
  const configuredTextAssistanceProvider =
    config.AUTHORING_AI_MODE === "openai_compatible"
      ? new OpenAiCompatiblePresentationTextAssistanceProvider(
          config.AUTHORING_AI_ENDPOINT!,
          config.AUTHORING_AI_API_KEY,
          config.AUTHORING_AI_MODEL,
          config.AUTHORING_AI_PROVIDER_NAME,
        )
      : null;
  const textAssistanceProvider = presentationTextAssistanceProviderAvailable(
    configuredTextAssistanceProvider,
  )
    ? configuredTextAssistanceProvider
    : null;
  const textAssistanceService = new PresentationTextAssistanceService(
    repository,
    createPresentationRepository(repository),
    Boolean(textAssistanceProvider),
    (workspaceId) => workspaceFeatureEnabled(repository, config, workspaceId, "presentations"),
  );
  const presentationTextAssistance = new PresentationTextAssistanceWorker(
    repository,
    textAssistanceProvider,
    textAssistanceService,
    config.AUTHORING_WORKER_LEASE_MS,
  );
  const retention = new RetentionService(
    repository,
    storage,
    config.MEDIA_QUARANTINE_RETENTION_HOURS,
    undefined,
    async (ids) => {
      await Promise.all(ids.map((id) => cache.delete(id)));
    },
    config.AUDIT_RETENTION_DAYS,
  );
  const platform = createPlatformRepository(repository);
  if (config.BUSINESS_PLATFORM_ENABLED) await bootstrapPlatformCatalog(platform, config);
  const billing = new PlatformBillingWorker(platform, config);
  const integrations = createIntegrationWorker(platform);
  const runner = new JobRunner(
    [
      {
        name: "reports",
        intervalMs: config.REPORT_WORKER_INTERVAL_MS,
        run: () => Promise.all([reports.runUntilIdle(), presentationReports.runUntilIdle()]),
      },
      {
        name: "authoring",
        intervalMs: config.AUTHORING_WORKER_INTERVAL_MS,
        run: () => authoring.runUntilIdle(),
      },
      {
        name: "visual-imports",
        intervalMs: config.AUTHORING_WORKER_INTERVAL_MS,
        run: () => visualImports.runUntilIdle(1),
      },
      {
        name: "presentation-assistance",
        intervalMs: config.AUTHORING_WORKER_INTERVAL_MS,
        run: () => presentationAssistance.runUntilIdle(1),
      },
      {
        name: "presentation-text-assistance",
        intervalMs: config.AUTHORING_WORKER_INTERVAL_MS,
        run: () => presentationTextAssistance.runUntilIdle(1),
      },
      {
        name: "retention",
        intervalMs: config.RETENTION_INTERVAL_MINUTES * 60_000,
        run: () => retention.run(),
      },
      {
        name: "billing",
        intervalMs: config.BUSINESS_BILLING_WORKER_INTERVAL_MS,
        run: () => billing.runUntilIdle(),
      },
      {
        name: "billing-reconciliation",
        intervalMs: config.BUSINESS_BILLING_RECONCILE_INTERVAL_MS,
        run: () => billing.reconcileAll(),
      },
      { name: "integrations", intervalMs: 5_000, run: () => integrations.runUntilIdle() },
      {
        name: "heartbeat",
        intervalMs: 15_000,
        run: () =>
          platform.heartbeat({
            id: "jobs",
            status: "healthy",
            details: { process: "dedicated", pid: process.pid },
          }),
      },
      {
        name: "credit-reservations",
        intervalMs: 60_000,
        run: async () => {
          for (const room of await platform.listReservedRoomCoverages(new Date())) {
            await platform.releaseExpiredRoomReservation(room.artifactType, room.roomId);
          }
        },
      },
    ],
    onError,
    async (name) => {
      const controlId =
        name === "visual-imports" ||
        name === "presentation-assistance" ||
        name === "presentation-text-assistance"
          ? "authoring"
          : name === "integrations"
            ? "business-integrations"
            : name === "billing"
              ? "billing-reconciliation"
              : name;
      return !(await platform.getWorkerControl(controlId))?.paused;
    },
  );
  return {
    runner,
    repository,
    platform,
    async close() {
      await runner.stop();
      await cache.close();
      await repository.close();
    },
  };
}
