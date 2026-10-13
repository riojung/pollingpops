import type { PlatformRepository } from "@openround/db";
import { z } from "zod";
import {
  decryptIntegrationSecret,
  encryptIntegrationSecret,
  IntegrationFailure,
  refreshIntegrationCredential,
  starterIntegrationAdapters,
  type IntegrationAdapter,
  type ProviderOperation,
} from "./integrations.js";

export type IntegrationRunResult =
  "idle" | "completed" | "retry_scheduled" | "failed" | "ambiguous" | "superseded";

export function createIntegrationWorker(
  platform: PlatformRepository,
  environment: Record<string, string | undefined> = process.env,
  adapters: IntegrationAdapter[] = starterIntegrationAdapters(fetch, environment),
) {
  const runOnce = async (adapter: IntegrationAdapter): Promise<IntegrationRunResult> => {
    if ((await platform.getWorkerControl("business-integrations"))?.paused) return "idle";
    const connection = await platform.getIntegrationConnection(adapter.provider);
    if (
      !connection ||
      connection.status !== "connected" ||
      !connection.credentialCiphertext ||
      !environment.INTEGRATION_SECRET_KEY
    )
      return "idle";
    // Every provider request is bounded to 10 seconds; even the largest allowed CRM batch
    // completes inside this lease. No provider creation is retried after an uncertain outcome.
    const job = await platform.claimIntegrationJob(adapter.provider, 600_000);
    if (!job || !job.leaseToken) return "idle";
    let providerSucceeded = false;
    let usedCiphertext = connection.credentialCiphertext;
    try {
      let credential = decryptIntegrationSecret(
        connection.credentialCiphertext,
        environment.INTEGRATION_SECRET_KEY,
      );
      if (credential.expiresAt && new Date(credential.expiresAt).getTime() <= Date.now() + 30_000) {
        credential = await platform.withProviderBillingLock(
          `integration-refresh:${adapter.provider}`,
          async () => {
            const current = await platform.getIntegrationConnection(adapter.provider);
            if (!current?.credentialCiphertext || current.status !== "connected")
              throw new IntegrationFailure("reconnect", "Provider connection was revoked");
            const stored = decryptIntegrationSecret(
              current.credentialCiphertext,
              environment.INTEGRATION_SECRET_KEY!,
            );
            if (stored.expiresAt && new Date(stored.expiresAt).getTime() > Date.now() + 30_000) {
              usedCiphertext = current.credentialCiphertext;
              return stored;
            }
            const refreshed = await refreshIntegrationCredential(adapter.provider, stored);
            const sealed = encryptIntegrationSecret(refreshed, environment.INTEGRATION_SECRET_KEY!);
            try {
              await platform.withOperatorTransaction(async (repository) => {
                const latest = await repository.getIntegrationConnection(adapter.provider);
                if (
                  latest?.status !== "connected" ||
                  latest.credentialCiphertext !== current.credentialCiphertext
                )
                  throw new IntegrationFailure(
                    "reconnect",
                    "Provider credentials changed during refresh",
                  );
                await repository.saveIntegrationConnection({
                  ...latest,
                  credentialCiphertext: sealed,
                  updatedAt: new Date(),
                });
              });
            } catch {
              throw new IntegrationFailure(
                "reconnect",
                "Refreshed token could not be committed; reconnect the provider",
              );
            }
            usedCiphertext = sealed;
            return refreshed;
          },
        );
      }
      const receipt = await adapter.execute(
        job.eventType as ProviderOperation,
        job.payload,
        credential,
      );
      providerSucceeded = true;
      const completed = await platform.withOperatorTransaction(async (repository) => {
        const settled = await repository.completeIntegrationJob(
          job.id,
          job.leaseToken!,
          typeof receipt.externalId === "string" ? receipt.externalId : null,
          new Date(),
          receipt,
        );
        if (settled && job.eventType === "support.reconcile") {
          const receiptBinding = z
            .object({
              externalId: z.string().regex(/^\d+$/),
              originalJobId: z.string().regex(/^[a-f0-9]{64}$/),
              caseId: z.string().uuid(),
              organizationId: z.string().uuid(),
              reconciled: z.literal(true),
            })
            .parse(receipt);
          if (
            receiptBinding.caseId !== job.payload.caseId ||
            receiptBinding.organizationId !== job.organizationId ||
            receiptBinding.organizationId !== job.payload.organizationId ||
            receiptBinding.originalJobId !== job.payload.originalJobId
          )
            throw new IntegrationFailure(
              "invalid",
              "Support reconciliation receipt does not match the queued case and organization",
            );
          if (
            !(await repository.resolveAmbiguousIntegrationJob(
              receiptBinding.originalJobId,
              receiptBinding.externalId,
              receipt,
            ))
          )
            throw new IntegrationFailure(
              "invalid",
              "The original support delivery cannot be resolved to this verified request",
            );
          await repository.appendAuditEvent({
            actorId: "system:business-integrations",
            organizationId: job.organizationId,
            action: "integration.delivery.reconciled",
            targetId: receiptBinding.originalJobId,
            reason:
              "Existing provider request verified against exact local case and organization references",
            requestId: job.id,
            before: { state: "ambiguous" },
            after: {
              state: "complete",
              externalId: receiptBinding.externalId,
              caseId: receiptBinding.caseId,
            },
          });
        }
        if (
          settled &&
          (job.eventType === "support.status" || job.eventType === "support.reconcile")
        ) {
          const mirror = z
            .object({
              issueKey: z.string(),
              status: z.string(),
              assignee: z.object({ accountId: z.string(), displayName: z.string() }).nullable(),
              checkedAt: z.iso.datetime(),
            })
            .parse(receipt);
          await repository.updateCaseProviderMirror(z.string().uuid().parse(job.payload.caseId), {
            ...mirror,
            checkedAt: new Date(mirror.checkedAt),
          });
        }
        if (settled)
          await repository.appendAuditEvent({
            actorId: "system:business-integrations",
            organizationId: job.organizationId,
            action: "integration.delivery.complete",
            targetId: job.id,
            reason: "Provider receipt committed",
            requestId: job.id,
            before: { state: "processing" },
            after: { state: "complete", provider: adapter.provider, operation: job.eventType },
          });
        return settled;
      });
      return completed ? "completed" : "superseded";
    } catch (error) {
      const createsExternalRecord =
        job.eventType === "support.create" || job.eventType === "crm.organization.upsert";
      const failure =
        providerSucceeded && createsExternalRecord
          ? new IntegrationFailure(
              "ambiguous",
              "Provider completed, but the local receipt is unknown; reconcile before retry",
            )
          : error instanceof IntegrationFailure
            ? error
            : new IntegrationFailure("invalid", "Integration configuration or payload is invalid");
      const updated = await platform.withOperatorTransaction(async (repository) => {
        if (failure.code === "reconnect") {
          const current = await repository.getIntegrationConnection(adapter.provider);
          if (current && current.credentialCiphertext === usedCiphertext) {
            await repository.saveIntegrationConnection({
              ...current,
              status: "disconnected",
              updatedAt: new Date(),
            });
            await repository.appendAuditEvent({
              actorId: "system:business-integrations",
              organizationId: job.organizationId,
              action: "integration.authorization_expired",
              targetId: adapter.provider,
              reason: "Provider authorization requires operator reconnection",
              requestId: job.id,
              before: { status: "connected" },
              after: { status: "disconnected" },
            });
          }
        }
        const settled = await repository.failIntegrationJob(
          job.id,
          job.leaseToken!,
          `${failure.code}: ${failure.message}`,
          failure.code === "ambiguous",
        );
        if (settled)
          await repository.appendAuditEvent({
            actorId: "system:business-integrations",
            organizationId: job.organizationId,
            action:
              failure.code === "ambiguous"
                ? "integration.delivery.ambiguous"
                : "integration.delivery.failed",
            targetId: job.id,
            reason: failure.message,
            requestId: job.id,
            before: { state: "processing" },
            after: { failureCode: failure.code, provider: adapter.provider },
          });
        return settled;
      });
      if (!updated) return "superseded";
      return failure.code === "ambiguous"
        ? "ambiguous"
        : job.attempts >= 10
          ? "failed"
          : "retry_scheduled";
    }
  };
  return {
    runOnce,
    async runUntilIdle(limit = 5): Promise<IntegrationRunResult[]> {
      const bounded = Math.max(1, Math.min(25, Math.floor(limit)));
      const results: IntegrationRunResult[] = [];
      for (const adapter of adapters) {
        for (let index = 0; index < bounded; index += 1) {
          const result = await runOnce(adapter);
          results.push(result);
          if (result !== "completed") break;
        }
      }
      await platform.heartbeat({
        id: "business-integrations",
        status: results.some((result) =>
          ["failed", "ambiguous", "retry_scheduled"].includes(result),
        )
          ? "degraded"
          : "healthy",
        details: {
          processed: results.filter((result) => result === "completed").length,
          requiresAttention: results.some((result) => result === "ambiguous"),
        },
      });
      return results;
    },
  };
}
