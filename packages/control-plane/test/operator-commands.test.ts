import { randomBytes, randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { MemoryRepository, createPlatformRepository } from "@openround/db";
import { OperatorService, readCompleteCreditLedgerExport } from "../src/operator-service.js";
import type { PlatformRepository } from "@openround/db";
import type { OperatorContext } from "../src/auth.js";

async function fixture(
  role: OperatorContext["operator"]["role"] = "founder",
  capabilities: string[] = [],
) {
  const repository = new MemoryRepository();
  const now = new Date();
  const hash = randomUUID();
  await repository.createMagicToken({
    id: randomUUID(),
    email: "verified-owner@example.test",
    segment: "workplace",
    tokenHash: hash,
    policyVersion: "test",
    expiresAt: new Date(now.getTime() + 60_000),
    consumedAt: null,
  });
  const creator = (await repository.consumeMagicToken(hash, now))!;
  const platform = createPlatformRepository(repository);
  const organization = (await platform.getOrganizationForWorkspace(creator.workspaceId))!;
  const operator = await platform.provisionOperator({
    issuer: "https://operator.example.test",
    subject: "founder",
    name: "Founder",
    role,
    active: true,
    capabilities,
  });
  const context: OperatorContext = {
    operator,
    tokenHash: "synthetic",
    session: {
      id: randomUUID(),
      operatorId: operator.id,
      tokenHash: "synthetic",
      createdAt: now,
      authenticatedAt: now,
      lastSeenAt: now,
      expiresAt: new Date(now.getTime() + 60_000),
      revokedAt: null,
    },
  };
  await platform.createOperatorSession(context.session);
  return {
    repository,
    platform,
    creator,
    organization,
    context,
    service: new OperatorService(platform, randomBytes(32).toString("base64")),
  };
}

async function failedIntegrationJob(
  platform: PlatformRepository,
  integration: string,
  organizationId: string,
  payload: Record<string, unknown> = {},
) {
  const job = await platform.enqueueIntegrationJob({
    integration,
    organizationId,
    eventType: integration === "quickbooks" ? "accounting.reconcile" : "support.status",
    deduplicationKey: randomUUID(),
    payload,
  });
  for (let attempt = 1; attempt <= 10; attempt++) {
    const now = new Date(Date.now() + attempt * 86_400_000);
    const claimed = await platform.claimIntegrationJob(integration, 60_000, now);
    expect(claimed?.id).toBe(job.id);
    expect(
      await platform.failIntegrationJob(
        job.id,
        claimed!.leaseToken!,
        "Sensitive provider response sentinel",
        false,
        now,
      ),
    ).toBe(true);
  }
  return job;
}
describe("atomic operator commands", () => {
  it("requires separate operation/finance permissions for bounded retries", async () => {
    const { context, service } = await fixture();
    const support = {
      ...context,
      operator: { ...context.operator, role: "support" as const, capabilities: [] },
    };
    await expect(
      service.command(
        support,
        {
          action: "product.job.retry",
          kind: "authoring",
          jobId: randomUUID(),
          reason: "Support cannot retry generation workers",
          idempotencyKey: randomUUID(),
        },
        "denied",
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    const operations = {
      ...context,
      operator: { ...context.operator, role: "operations" as const, capabilities: [] },
    };
    await expect(
      service.command(
        operations,
        {
          action: "billing.job.retry",
          eventId: "evt_denied",
          reason: "Operations cannot retry financial events",
          idempotencyKey: randomUUID(),
        },
        "denied",
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("denies QuickBooks retries to operations operators without financial access", async () => {
    const { platform, organization, context, service } = await fixture("operations");
    const job = await failedIntegrationJob(platform, "quickbooks", organization.id, {
      stripeTransactions: [{ id: "pi_private", amountMinor: 1200 }],
    });
    await expect(
      service.command(
        context,
        {
          action: "integration.retry",
          jobId: job.id,
          reason: "Operations cannot retry financial deliveries",
          idempotencyKey: randomUUID(),
        },
        "denied",
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await platform.getIntegrationJob(job.id)).toMatchObject({
      state: "failed",
      attempts: 10,
    });
    expect(await platform.listAuditEvents()).toHaveLength(0);
  });
  it("rechecks current financial access before replaying a QuickBooks retry receipt", async () => {
    const { platform, organization, context, service } = await fixture("operations", [
      "billing.read",
    ]);
    const job = await failedIntegrationJob(platform, "quickbooks", organization.id);
    const command = {
      action: "integration.retry",
      jobId: job.id,
      reason: "Finance approved retry of reconciliation",
      idempotencyKey: randomUUID(),
    };
    await service.command(context, command, "authorized");
    const operator = await platform.provisionOperator({
      ...context.operator,
      role: "operations",
      capabilities: [],
    });
    const tokenHash = randomUUID();
    const currentContext = {
      ...context,
      operator,
      tokenHash,
      session: { ...context.session, id: randomUUID(), tokenHash },
    };
    await platform.createOperatorSession(currentContext.session);
    await expect(
      service.command(currentContext, command, "permission-removed-replay"),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await platform.getIntegrationJob(job.id)).toMatchObject({ state: "pending" });
    expect(await platform.listAuditEvents()).toHaveLength(1);
  });
  it.each(["jira-service-management", "hubspot", "quickbooks"])(
    "returns and audits only a safe retry receipt for %s",
    async (integration) => {
      const { platform, organization, context, service } = await fixture(
        integration === "quickbooks" ? "billing" : "operations",
        integration === "quickbooks" ? ["integrations.write"] : [],
      );
      const payload = {
        stripeTransactions: [{ id: "pi_private", amountMinor: 1200 }],
        credentialSentinel: "Never expose this payload sentinel",
      };
      const job = await failedIntegrationJob(platform, integration, organization.id, payload);
      const command = {
        action: "integration.retry",
        jobId: job.id,
        reason: "Approved provider retry after resolving outage",
        idempotencyKey: randomUUID(),
      };
      const receipt = { jobId: job.id, integration, state: "pending" };
      expect(await service.command(context, command, "retry")).toEqual(receipt);
      expect(await service.command(context, command, "same-key")).toEqual(receipt);
      const audit = await platform.listAuditEvents();
      expect(audit).toHaveLength(1);
      expect(audit[0]).toMatchObject({
        actorId: context.operator.id,
        targetId: job.id,
        organizationId: organization.id,
        action: "integration.retry",
        before: { state: "failed" },
        after: receipt,
      });
      expect(audit[0]?.after).toEqual(receipt);
      expect(JSON.stringify(audit)).not.toContain("pi_private");
      expect(JSON.stringify(audit)).not.toContain("sentinel");
      expect(await platform.getIntegrationJob(job.id)).toMatchObject({
        state: "pending",
        attempts: 10,
        payload,
        lastError: "Sensitive provider response sentinel",
      });
    },
  );
  it("only retries failed billing events, preserves attempt history, and records exact retries once", async () => {
    const { platform, context, service } = await fixture();
    const eventId = "evt_failed_operator_retry";
    await platform.enqueueBillingEvent({
      providerEventId: eventId,
      eventType: "invoice.paid",
      payload: { verified: true },
      providerCreatedAt: new Date(),
    });
    for (let attempt = 1; attempt <= 10; attempt++) {
      const now = new Date(Date.now() + attempt * 86_400_000);
      const event = await platform.claimBillingEvent(60_000, now);
      expect(event?.id).toBe(eventId);
      await platform.failBillingEvent(
        eventId,
        event!.leaseToken!,
        "Synthetic provider outage",
        now,
      );
    }
    const command = {
      action: "billing.job.retry",
      eventId,
      reason: "Finance confirmed the provider outage is resolved",
      idempotencyKey: randomUUID(),
    };
    const first = await service.command(context, command, "finance-retry");
    expect(await service.command(context, command, "same-key")).toEqual(first);
    expect((await platform.listBillingEvents())[0]).toMatchObject({
      state: "pending",
      attempts: 10,
    });
    expect(
      (await platform.listAuditEvents()).filter((event) => event.action === "billing.job.retry"),
    ).toHaveLength(1);
    await expect(
      service.command(context, { ...command, idempotencyKey: randomUUID() }, "stale"),
    ).rejects.toMatchObject({ code: "RETRY_NOT_ALLOWED" });
  });
  it("authoring retry needs retained unexpired input; erased input remains failed", async () => {
    const { repository, platform, creator, context, service } = await fixture();
    const now = new Date();
    const retained = randomUUID();
    const erased = randomUUID();
    for (const id of [retained, erased])
      await repository.createAuthoringJob({
        id,
        workspaceId: creator.workspaceId,
        createdBy: creator.userId,
        sourceType: "pasted_text",
        sourceName: "Synthetic source",
        sourceMimeType: null,
        sourceText: id === retained ? "Retained synthetic source" : null,
        sourceBlob: null,
        sourceDigest: "test",
        status: "failed",
        attempts: 3,
        appliedQuizId: null,
        availableAt: now,
        output: null,
        lastError: "Synthetic failure",
        expiresAt: new Date(now.getTime() + 60_000),
        createdAt: now,
        updatedAt: now,
      });
    const command = {
      action: "product.job.retry",
      kind: "authoring",
      jobId: retained,
      reason: "Operations approved retry of retained input",
      idempotencyKey: randomUUID(),
    };
    await service.command(context, command, "authoring-retry");
    await expect(
      service.command(
        context,
        { ...command, jobId: erased, idempotencyKey: randomUUID() },
        "erased",
      ),
    ).rejects.toMatchObject({ code: "RETRY_NOT_ALLOWED" });
    const queues = await platform.getProductQueueHealth();
    expect(queues.find((queue) => queue.kind === "authoring")).toMatchObject({
      pending: 1,
      failed: 1,
      failedIds: [erased],
      retryableFailedIds: [],
    });
    expect(
      (await platform.listAuditEvents()).filter((event) => event.action === "product.job.retry"),
    ).toHaveLength(1);
  });
  it("revocation between request authentication and command commit prevents mutation", async () => {
    const { platform, organization, context, service } = await fixture();
    await platform.revokeOperatorSession(context.tokenHash);
    await expect(
      service.command(
        context,
        {
          action: "credits.grant",
          organizationId: organization.id,
          quantity: 5,
          reason: "This revoked request must not commit",
          idempotencyKey: randomUUID(),
        },
        "revoked",
      ),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(await platform.getCreditBalance(organization.id)).toMatchObject({ balance: 0 });
  });
  it("concurrent exact retries grant credits and append the audit once", async () => {
    const { platform, organization, context, service } = await fixture();
    const command = {
      action: "credits.grant",
      organizationId: organization.id,
      quantity: 5,
      reason: "Approved launch partner credit",
      idempotencyKey: randomUUID(),
    };
    const [first, second] = await Promise.all([
      service.command(context, command, "request-one"),
      service.command(context, command, "request-two"),
    ]);
    expect(second).toEqual(first);
    expect(await platform.getCreditBalance(organization.id)).toMatchObject({
      balance: 5,
      available: 5,
    });
    expect(await platform.listCreditLedgerForOperator(organization.id)).toHaveLength(1);
    expect(
      (await platform.listAuditEvents()).filter((event) => event.action === "credits.grant"),
    ).toHaveLength(1);
    await expect(
      service.command(context, { ...command, quantity: 6 }, "request-three"),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  });
  it("admission restriction changes only the explicit workspace policy", async () => {
    const { platform, organization, creator, context, service } = await fixture();
    await service.command(
      context,
      {
        action: "workspace.admission.restrict",
        organizationId: organization.id,
        workspaceId: creator.workspaceId,
        blocked: true,
        expectedBlocked: false,
        reason: "Incident requires new admission restriction",
        idempotencyKey: randomUUID(),
      },
      "request",
    );
    expect(await platform.getWorkspaceAdmissionRestriction(creator.workspaceId)).toMatchObject({
      blocked: true,
    });
    expect((await platform.listAllOrganizations())[0]?.status).toBe("active");
    await expect(
      service.command(
        context,
        {
          action: "workspace.admission.restrict",
          organizationId: organization.id,
          workspaceId: creator.workspaceId,
          blocked: false,
          expectedBlocked: false,
          reason: "A stale restriction change must fail",
          idempotencyKey: randomUUID(),
        },
        "stale",
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
  it("connection credentials never appear in receipts, views, or audit", async () => {
    const { platform, context, service } = await fixture();
    const result = await service.command(
      context,
      {
        action: "integration.connect",
        integration: "hubspot",
        accessToken: "secret-access-value",
        reason: "Connect approved CRM business account",
        idempotencyKey: randomUUID(),
      },
      "request",
    );
    const audit = await platform.listAuditEvents();
    const view = await service.view(context, "integrations");
    expect(JSON.stringify([result, audit, view])).not.toContain("secret-access-value");
    expect(JSON.stringify([result, audit, view])).not.toContain("credentialCiphertext");
    expect((await platform.getIntegrationConnection("hubspot"))?.credentialCiphertext).toBeTruthy();
  });
  it("resolves commercial holds without minting credits", async () => {
    const { platform, organization, context, service } = await fixture();
    const hold = await platform.setOrganizationCommercialHold(
      organization.id,
      true,
      "Provider dispute",
    );
    await service.command(
      context,
      {
        action: "billing.hold.resolve",
        organizationId: organization.id,
        expectedHeld: true,
        expectedUpdatedAt: hold.updatedAt.toISOString(),
        reason: "Finance reviewed and resolved the dispute",
        idempotencyKey: randomUUID(),
      },
      "request",
    );
    expect(await platform.getOrganizationCommercialHold(organization.id)).toMatchObject({
      held: false,
    });
    expect(await platform.getCreditBalance(organization.id)).toMatchObject({ balance: 0 });
  });
  it("rejects arbitrary or foreign CRM contacts before enqueue", async () => {
    const { platform, organization, context, service } = await fixture();
    await expect(
      service.command(
        context,
        {
          action: "integration.crm.designate",
          organizationId: organization.id,
          userId: randomUUID(),
          designated: true,
          reason: "Only a verified member may be designated",
          idempotencyKey: randomUUID(),
        },
        "request",
      ),
    ).rejects.toMatchObject({ code: "CONTACT_NOT_ELIGIBLE" });
    expect(await platform.listIntegrationJobs()).toHaveLength(0);
  });
  it("reconciliation snapshots immutable provider facts and rejects foreign mappings", async () => {
    const { platform, organization, context, service } = await fixture();
    await platform.saveIntegrationConnection({
      id: "quickbooks",
      integration: "quickbooks",
      status: "connected",
      credentialCiphertext: null,
      configuration: {},
      updatedAt: new Date(),
    });
    await platform.recordStripeTransaction({
      id: "pi_owned",
      organizationId: organization.id,
      kind: "sale",
      amountMinor: 1200,
      currency: "USD",
      occurredAt: new Date("2026-10-05T12:00:00Z"),
      paymentId: "pi_owned",
      invoiceId: null,
      sourceEventId: "evt_1",
    });
    const command = {
      action: "integration.accounting.reconcile",
      organizationId: organization.id,
      externalCustomerId: "12",
      startDate: "2026-10-01",
      endDate: "2026-10-12",
      homeCurrency: "USD",
      transactionMappings: [
        { stripeTransactionId: "pi_owned", entity: "Invoice", externalId: "42" },
      ],
      reason: "Finance approved explicit invoice mapping",
      idempotencyKey: randomUUID(),
    };
    await service.command(context, command, "accounting");
    const [job] = await platform.listIntegrationJobs("quickbooks");
    expect(job?.payload).toMatchObject({
      stripeTransactions: [{ id: "pi_owned", amountMinor: 1200 }],
      transactionMappings: command.transactionMappings,
    });
    await expect(
      service.command(
        context,
        {
          ...command,
          idempotencyKey: randomUUID(),
          transactionMappings: [
            { stripeTransactionId: "pi_foreign", entity: "Invoice", externalId: "43" },
          ],
        },
        "invalid",
      ),
    ).rejects.toMatchObject({ code: "INVALID_MAPPING" });
    expect(await platform.listIntegrationJobs("quickbooks")).toHaveLength(1);
  });
  it("support refresh is reachable only after a verified case creation receipt", async () => {
    const { platform, organization, context, service } = await fixture();
    const supportCase = (await service.command(
      context,
      {
        action: "case.create",
        organizationId: organization.id,
        category: "feedback",
        title: "Synthetic browser report",
        redactedDescription: "Request reference only, no participant data",
        sendToSupport: true,
        reason: "Support approved this redacted case",
        idempotencyKey: randomUUID(),
      },
      "create",
    )) as { id: string };
    const refresh = {
      action: "case.sync",
      caseId: supportCase.id,
      reason: "Check assigned support agent and status",
      idempotencyKey: randomUUID(),
    };
    await expect(service.command(context, refresh, "too-early")).rejects.toMatchObject({
      code: "SUPPORT_NOT_LINKED",
    });
    const creation = await platform.claimIntegrationJob("jira-service-management");
    await platform.completeIntegrationJob(
      creation!.id,
      creation!.leaseToken!,
      "10001",
      new Date(),
      { externalId: "10001", issueKey: "POPS-1" },
    );
    await service.command(context, refresh, "refresh");
    expect(
      (await platform.listIntegrationJobs()).find((job) => job.eventType === "support.status")
        ?.payload,
    ).toMatchObject({ caseId: supportCase.id, issueKey: "POPS-1", issueId: "10001" });
    expect(
      (await platform.listAuditEvents(organization.id)).some(
        (event) => event.action === "case.sync",
      ),
    ).toBe(true);
  });
  it("support reconciliation schedules verification and cannot substitute a different original job", async () => {
    const { platform, organization, context, service } = await fixture();
    const supportCase = (await service.command(
      context,
      {
        action: "case.create",
        organizationId: organization.id,
        category: "feedback",
        title: "Synthetic uncertain support case",
        redactedDescription: "Only synthetic case references",
        sendToSupport: true,
        reason: "Support approved forwarding this case",
        idempotencyKey: randomUUID(),
      },
      "create",
    )) as { id: string };
    const original = await platform.getIntegrationJobByDeduplication(
      "jira-service-management",
      `case:${supportCase.id}`,
    );
    const claim = await platform.claimIntegrationJob("jira-service-management");
    await platform.failIntegrationJob(
      original!.id,
      claim!.leaseToken!,
      "Unknown create outcome",
      true,
    );
    const command = {
      action: "case.reconcile",
      caseId: supportCase.id,
      originalJobId: original!.id,
      issueId: "10001",
      reason: "Support looked up this existing Jira request",
      idempotencyKey: randomUUID(),
    };
    await expect(
      service.command(context, { ...command, originalJobId: "a".repeat(64) }, "wrong-job"),
    ).rejects.toMatchObject({ code: "RECONCILIATION_NOT_ALLOWED" });
    await service.command(context, command, "lookup");
    expect(
      (await platform.listIntegrationJobs()).find((job) => job.eventType === "support.reconcile")
        ?.payload,
    ).toMatchObject({
      caseId: supportCase.id,
      organizationId: organization.id,
      originalJobId: original!.id,
      issueId: "10001",
    });
    expect(
      (
        await platform.getIntegrationJobByDeduplication(
          "jira-service-management",
          `case:${supportCase.id}`,
        )
      )?.state,
    ).toBe("ambiguous");
  });
  it("complete-period credit export follows all pages beyond 1000 entries", async () => {
    const from = new Date("2026-01-01T00:00:00Z");
    const to = new Date("2026-12-31T23:59:59Z");
    const entries = Array.from({ length: 1001 }, (_, id) => ({
      id: String(id),
      organizationId: "org",
      delta: 1,
      reason: "Approved credit",
      sourceKey: String(id),
      createdAt: from,
    }));
    const calls: Array<string | undefined> = [];
    const platform = {
      listCreditLedgerPageForOperator: async (_org: string, options: { cursor?: string }) => {
        calls.push(options.cursor);
        return options.cursor
          ? { entries: entries.slice(1000), nextCursor: null }
          : { entries: entries.slice(0, 1000), nextCursor: "second-page" };
      },
    } as unknown as PlatformRepository;
    expect(await readCompleteCreditLedgerExport(platform, "org", from, to)).toHaveLength(1001);
    expect(calls).toEqual([undefined, "second-page"]);
  });
});
