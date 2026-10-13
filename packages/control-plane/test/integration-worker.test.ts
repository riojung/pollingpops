import { randomBytes, randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { MemoryRepository, createPlatformRepository, type PlatformRepository } from "@openround/db";
import { createIntegrationWorker } from "../src/integration-worker.js";
import {
  encryptIntegrationSecret,
  IntegrationFailure,
  type IntegrationAdapter,
} from "../src/integrations.js";

async function fixture() {
  const platform = createPlatformRepository(new MemoryRepository());
  const key = randomBytes(32).toString("base64");
  await platform.saveIntegrationConnection({
    id: "jira-service-management",
    integration: "jira-service-management",
    status: "connected",
    credentialCiphertext: encryptIntegrationSecret({ accessToken: "test-only" }, key),
    configuration: {},
    updatedAt: new Date(),
  });
  const job = await platform.enqueueIntegrationJob({
    integration: "jira-service-management",
    organizationId: null,
    eventType: "support.create",
    deduplicationKey: "synthetic-case",
    payload: {},
  });
  return { platform, key, job };
}
describe("durable integration dispatch", () => {
  it("resolves ambiguous support creation only from a case/org-bound verified existing receipt", async () => {
    const repository = new MemoryRepository();
    const now = new Date();
    const token = randomUUID();
    await repository.createMagicToken({
      id: randomUUID(),
      email: "synthetic-support-owner@example.test",
      segment: "workplace",
      tokenHash: token,
      policyVersion: "test",
      expiresAt: new Date(now.getTime() + 60_000),
      consumedAt: null,
    });
    const creator = (await repository.consumeMagicToken(token, now))!;
    const platform = createPlatformRepository(repository);
    const organization = (await platform.getOrganizationForWorkspace(creator.workspaceId))!;
    const key = randomBytes(32).toString("base64");
    await platform.saveIntegrationConnection({
      id: "jira-service-management",
      integration: "jira-service-management",
      status: "connected",
      credentialCiphertext: encryptIntegrationSecret({ accessToken: "synthetic" }, key),
      configuration: {},
      updatedAt: now,
    });
    const supportCase = await platform.createCase({
      organizationId: organization.id,
      category: "feedback",
      title: "Synthetic uncertain request",
      details: { redactedDescription: "Request reference only" },
    });
    const original = await platform.enqueueIntegrationJob({
      integration: "jira-service-management",
      organizationId: organization.id,
      eventType: "support.create",
      deduplicationKey: `case:${supportCase.id}`,
      payload: { caseId: supportCase.id, organizationId: organization.id },
    });
    const claim = await platform.claimIntegrationJob("jira-service-management");
    await platform.failIntegrationJob(
      original.id,
      claim!.leaseToken!,
      "Uncertain provider creation",
      true,
    );
    const binding = {
      caseId: supportCase.id,
      organizationId: organization.id,
      originalJobId: original.id,
    };
    const reconciliation = await platform.enqueueIntegrationJob({
      integration: "jira-service-management",
      organizationId: organization.id,
      eventType: "support.reconcile",
      deduplicationKey: `reconcile:${supportCase.id}`,
      payload: { ...binding, issueId: "10001" },
    });
    const adapter: IntegrationAdapter = {
      provider: "jira-service-management",
      execute: vi.fn().mockResolvedValue({
        ...binding,
        externalId: "10001",
        issueKey: "POPS-1",
        status: "Waiting for support",
        assignee: null,
        checkedAt: now.toISOString(),
        reconciled: true,
      }),
    };
    expect(
      await createIntegrationWorker(platform, { INTEGRATION_SECRET_KEY: key }, [adapter]).runOnce(
        adapter,
      ),
    ).toBe("completed");
    expect(vi.mocked(adapter.execute).mock.calls[0]?.[0]).toBe("support.reconcile");
    expect(
      await platform.getIntegrationJobByDeduplication(
        "jira-service-management",
        `case:${supportCase.id}`,
      ),
    ).toMatchObject({
      state: "complete",
      externalId: "10001",
      result: { reconciled: true, caseId: supportCase.id },
    });
    expect((await platform.listCases())[0]?.details.providerMirror).toMatchObject({
      issueKey: "POPS-1",
      status: "Waiting for support",
    });
    expect(
      (await platform.listIntegrationJobs()).find((job) => job.id === reconciliation.id)?.state,
    ).toBe("complete");
    expect(
      (await platform.listAuditEvents()).some(
        (event) =>
          event.action === "integration.delivery.reconciled" && event.targetId === original.id,
      ),
    ).toBe(true);
  });
  it("commits the receipt and attributable delivery audit together", async () => {
    const { platform, key } = await fixture();
    const execute = vi.fn().mockResolvedValue({ externalId: "10001", issueKey: "POPS-1" });
    const adapter: IntegrationAdapter = { provider: "jira-service-management", execute };
    const worker = createIntegrationWorker(platform, { INTEGRATION_SECRET_KEY: key }, [adapter]);
    expect(await worker.runOnce(adapter)).toBe("completed");
    expect((await platform.listIntegrationJobs())[0]).toMatchObject({
      state: "complete",
      externalId: "10001",
      result: { issueKey: "POPS-1" },
    });
    expect(await platform.listAuditEvents()).toMatchObject([
      { action: "integration.delivery.complete", actorId: "system:business-integrations" },
    ]);
    expect(await worker.runOnce(adapter)).toBe("idle");
    expect(execute).toHaveBeenCalledTimes(1);
  });
  it("does not replay an external creation when a crashed worker lease expires", async () => {
    const { platform, key } = await fixture();
    const first = await platform.claimIntegrationJob(
      "jira-service-management",
      1000,
      new Date(Date.now() + 10),
    );
    expect(first).not.toBeNull();
    expect(
      await platform.claimIntegrationJob(
        "jira-service-management",
        60_000,
        new Date(Date.now() + 2000),
      ),
    ).toBeNull();
    expect((await platform.listIntegrationJobs())[0]?.state).toBe("ambiguous");
    const execute = vi.fn();
    const adapter: IntegrationAdapter = { provider: "jira-service-management", execute };
    expect(
      await createIntegrationWorker(platform, { INTEGRATION_SECRET_KEY: key }, [adapter]).runOnce(
        adapter,
      ),
    ).toBe("idle");
    expect(execute).not.toHaveBeenCalled();
  });
  it("records uncertain provider outcomes and stops automatic retry", async () => {
    const { platform, key } = await fixture();
    const execute = vi
      .fn()
      .mockRejectedValue(new IntegrationFailure("ambiguous", "Creation outcome unknown"));
    const adapter: IntegrationAdapter = { provider: "jira-service-management", execute };
    const worker = createIntegrationWorker(platform, { INTEGRATION_SECRET_KEY: key }, [adapter]);
    expect(await worker.runOnce(adapter)).toBe("ambiguous");
    expect(await worker.runOnce(adapter)).toBe("idle");
    expect((await platform.listAuditEvents())[0]?.action).toBe("integration.delivery.ambiguous");
    expect(execute).toHaveBeenCalledTimes(1);
  });
  it("preserves pending cases and disconnects expired provider authorization", async () => {
    const { platform, key } = await fixture();
    const adapter: IntegrationAdapter = {
      provider: "jira-service-management",
      execute: vi
        .fn()
        .mockRejectedValue(new IntegrationFailure("reconnect", "Authorization expired")),
    };
    const worker = createIntegrationWorker(platform, { INTEGRATION_SECRET_KEY: key }, [adapter]);
    expect(await worker.runOnce(adapter)).toBe("retry_scheduled");
    expect((await platform.getIntegrationConnection(adapter.provider))?.status).toBe(
      "disconnected",
    );
    expect((await platform.listIntegrationJobs())[0]).toMatchObject({
      state: "pending",
      lastError: "reconnect: Authorization expired",
    });
    expect(await worker.runOnce(adapter)).toBe("idle");
  });
  it("holds uncertain successful provider writes when the local receipt fails", async () => {
    const { platform, key, job } = await fixture();
    const failure = vi.fn().mockResolvedValue(true);
    const fake = {
      getWorkerControl: vi.fn().mockResolvedValue(null),
      getIntegrationConnection: platform.getIntegrationConnection.bind(platform),
      claimIntegrationJob: vi.fn().mockResolvedValue({ ...job, leaseToken: "lease" }),
      completeIntegrationJob: vi.fn().mockRejectedValue(new Error("Database unavailable")),
      failIntegrationJob: failure,
      appendAuditEvent: vi.fn().mockResolvedValue({}),
    } as unknown as PlatformRepository;
    fake.withOperatorTransaction = (work) => work(fake);
    const adapter: IntegrationAdapter = {
      provider: "jira-service-management",
      execute: vi.fn().mockResolvedValue({ externalId: "10001" }),
    };
    expect(
      await createIntegrationWorker(fake, { INTEGRATION_SECRET_KEY: key }, [adapter]).runOnce(
        adapter,
      ),
    ).toBe("ambiguous");
    expect(failure.mock.calls[0]?.[3]).toBe(true);
  });
  it("commits a repeatable support status/assignment mirror with its durable receipt", async () => {
    const { platform, key } = await fixture();
    const adapter: IntegrationAdapter = {
      provider: "jira-service-management",
      execute: vi.fn().mockResolvedValue({ externalId: "10001", issueKey: "POPS-1" }),
    };
    const worker = createIntegrationWorker(platform, { INTEGRATION_SECRET_KEY: key }, [adapter]);
    await worker.runOnce(adapter);
    const supportCase = await platform.createCase({
      organizationId: null,
      category: "feedback",
      title: "Synthetic linked case",
      details: { redactedDescription: "No customer data" },
    });
    await platform.enqueueIntegrationJob({
      integration: "jira-service-management",
      organizationId: null,
      eventType: "support.status",
      deduplicationKey: `status:${supportCase.id}`,
      payload: { caseId: supportCase.id, issueKey: "POPS-1", issueId: "10001" },
    });
    vi.mocked(adapter.execute).mockResolvedValue({
      externalId: "10001",
      issueKey: "POPS-1",
      status: "Assigned",
      assignee: { accountId: "agent-1", displayName: "Support operator" },
      checkedAt: new Date().toISOString(),
    });
    expect(await worker.runOnce(adapter)).toBe("completed");
    expect((await platform.listCases())[0]).toMatchObject({
      state: "open",
      details: {
        providerMirror: {
          issueKey: "POPS-1",
          status: "Assigned",
          assignee: { accountId: "agent-1" },
        },
      },
    });
    expect(
      (await platform.listIntegrationJobs()).find((job) => job.eventType === "support.status"),
    ).toMatchObject({ state: "complete", result: { status: "Assigned" } });
  });
});
