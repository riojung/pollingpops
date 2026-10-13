import { describe, expect, it, vi } from "vitest";
import { randomBytes } from "node:crypto";
import {
  decryptIntegrationSecret,
  encryptIntegrationSecret,
  HubSpotAdapter,
  IntegrationFailure,
  JiraServiceManagementAdapter,
  QuickBooksReadOnlyAdapter,
  refreshIntegrationCredential,
  starterIntegrationAdapters,
} from "../src/integrations.js";

const supportPayload = {
  caseId: "d29edc87-fb07-4d7a-964b-68ba822e7b37",
  organizationId: "910a8703-6e76-42cc-951b-1228a81411bf",
  subject: "Cannot start room",
  redactedDescription: "Request synthetic-request failed",
};
const jiraCredential = {
  accessToken: "secret",
  cloudId: "c93b36c5-eb86-460e-8521-5131a8c9165a",
  serviceDeskId: "1",
  requestTypeId: "2",
};
const supportReconciliationPayload = {
  caseId: supportPayload.caseId,
  organizationId: supportPayload.organizationId,
  originalJobId: "a".repeat(64),
  issueId: "10001",
};
const supportReconciliationReceipt = () => ({
  issueId: "10001",
  issueKey: "POPS-2",
  summary: `[Polling Pops ${supportPayload.caseId}] ${supportPayload.subject}`,
  requestFieldValues: [
    {
      fieldId: "description",
      value: `${supportPayload.redactedDescription}\n\nPolling Pops case: ${supportPayload.caseId}\nOrganization: ${supportPayload.organizationId}`,
    },
  ],
  currentStatus: { status: "Waiting for support" },
  reporter: { emailAddress: "private-reporter@example.test" },
});
const supportAssignmentReceipt = () => ({
  id: "10001",
  key: "POPS-2",
  fields: {
    status: { name: "In progress" },
    assignee: {
      accountId: "agent-1",
      displayName: "Support operator",
      emailAddress: "private-agent@example.test",
    },
  },
});
const accountingPayload = {
  organizationId: supportPayload.organizationId,
  externalCustomerId: "12",
  startDate: "2026-10-01",
  endDate: "2026-10-12",
  homeCurrency: "USD",
  snapshotAt: "2026-10-12T12:00:00.000Z",
  stripeTransactions: [],
  transactionMappings: [],
};
describe("business provider boundaries", () => {
  it("encrypts credentials with authenticated encryption", () => {
    const key = randomBytes(32).toString("base64");
    const encrypted = encryptIntegrationSecret(jiraCredential, key);
    expect(encrypted).not.toContain("secret");
    expect(decryptIntegrationSecret(encrypted, key)).toEqual(jiraCredential);
    expect(() => decryptIntegrationSecret(encrypted, randomBytes(32).toString("base64"))).toThrow();
  });
  it.each(["network", "server", "malformed", "missing_receipt"])(
    "holds ambiguous Jira creation after %s",
    async (scenario) => {
      const fetcher = vi.fn<typeof fetch>();
      if (scenario === "network") fetcher.mockRejectedValue(new Error("Provider failed"));
      else
        fetcher.mockResolvedValue(
          new Response(scenario === "malformed" ? "bad-json" : "{}", {
            status: scenario === "server" ? 503 : 201,
          }),
        );
      await expect(
        new JiraServiceManagementAdapter(fetcher).execute(
          "support.create",
          supportPayload,
          jiraCredential,
        ),
      ).rejects.toMatchObject({ code: "ambiguous" });
      expect(fetcher).toHaveBeenCalledTimes(1);
    },
  );
  it("redacts provider error bodies", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response('{"token":"customer-secret"}', { status: 401 }));
    try {
      await new JiraServiceManagementAdapter(fetcher).execute(
        "support.create",
        supportPayload,
        jiraCredential,
      );
    } catch (error) {
      expect(error).toBeInstanceOf(IntegrationFailure);
      expect(String(error)).not.toContain("customer-secret");
    }
  });
  it.each([false, true])(
    "positively reconciles an existing Jira request without creating another or retaining content (workspace=%s)",
    async (workspaceReference) => {
      const providerReceipt = supportReconciliationReceipt();
      if (workspaceReference)
        providerReceipt.requestFieldValues[0]!.value +=
          "\nWorkspace: 810a8703-6e76-42cc-951b-1228a81411bf";
      const fetcher = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(new Response(JSON.stringify(providerReceipt)))
        .mockResolvedValueOnce(new Response(JSON.stringify(supportAssignmentReceipt())));
      const result = await new JiraServiceManagementAdapter(fetcher).execute(
        "support.reconcile",
        supportReconciliationPayload,
        jiraCredential,
      );
      expect(result).toMatchObject({
        reconciled: true,
        caseId: supportPayload.caseId,
        organizationId: supportPayload.organizationId,
        originalJobId: supportReconciliationPayload.originalJobId,
        externalId: "10001",
        issueKey: "POPS-2",
        status: "Waiting for support",
        jiraStatus: "In progress",
        assignee: { accountId: "agent-1", displayName: "Support operator" },
      });
      expect(fetcher).toHaveBeenCalledTimes(2);
      expect(fetcher.mock.calls[0]![0]).toContain("/rest/servicedeskapi/request/10001");
      expect(fetcher.mock.calls.every(([, init]) => !init?.method || init.method === "GET")).toBe(
        true,
      );
      expect(JSON.stringify(result)).not.toContain("private-");
      expect(JSON.stringify(result)).not.toContain(supportPayload.redactedDescription);
      expect(result).not.toHaveProperty("summary");
      expect(result).not.toHaveProperty("requestFieldValues");
    },
  );
  it.each([
    "case",
    "description_case",
    "organization",
    "organization_suffix",
    "duplicate_description",
    "missing_description",
    "issue",
  ])("rejects Jira reconciliation with a mismatching %s reference", async (mismatch) => {
    const receipt = supportReconciliationReceipt();
    if (mismatch === "case")
      receipt.summary = receipt.summary.replace(supportPayload.caseId, "other");
    if (mismatch === "description_case")
      receipt.requestFieldValues[0]!.value = receipt.requestFieldValues[0]!.value.replace(
        supportPayload.caseId,
        "810a8703-6e76-42cc-951b-1228a81411bf",
      );
    if (mismatch === "organization")
      receipt.requestFieldValues[0]!.value = receipt.requestFieldValues[0]!.value.replace(
        supportPayload.organizationId,
        "810a8703-6e76-42cc-951b-1228a81411bf",
      );
    if (mismatch === "organization_suffix") receipt.requestFieldValues[0]!.value += "-suffix";
    if (mismatch === "duplicate_description")
      receipt.requestFieldValues.push(receipt.requestFieldValues[0]!);
    if (mismatch === "missing_description") receipt.requestFieldValues = [];
    if (mismatch === "issue") receipt.issueId = "10002";
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(receipt)));
    await expect(
      new JiraServiceManagementAdapter(fetcher).execute(
        "support.reconcile",
        supportReconciliationPayload,
        jiraCredential,
      ),
    ).rejects.toMatchObject({ code: "invalid" });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]![1]?.method).toBeUndefined();
  });
  it("rejects reconciliation if the assignment read identifies a different issue", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify(supportReconciliationReceipt())))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ...supportAssignmentReceipt(), id: "10002" })),
      );
    await expect(
      new JiraServiceManagementAdapter(fetcher).execute(
        "support.reconcile",
        supportReconciliationPayload,
        jiraCredential,
      ),
    ).rejects.toMatchObject({ code: "invalid" });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it.each([
    { status: 404, code: "invalid" },
    { status: 503, code: "retry" },
    { status: 401, code: "reconnect" },
  ])(
    "never treats a $status lookup as proof that creation was absent",
    async ({ status, code }) => {
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response("{}", { status }));
      await expect(
        new JiraServiceManagementAdapter(fetcher).execute(
          "support.reconcile",
          supportReconciliationPayload,
          jiraCredential,
        ),
      ).rejects.toMatchObject({ code });
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(fetcher.mock.calls[0]![1]?.method).toBeUndefined();
    },
  );
  it("rejects unsafe issue references and malformed original delivery IDs before reading Jira", async () => {
    const fetcher = vi.fn<typeof fetch>();
    const adapter = new JiraServiceManagementAdapter(fetcher);
    await expect(
      adapter.execute(
        "support.reconcile",
        { ...supportReconciliationPayload, issueId: "POPS-2?private=true" },
        jiraCredential,
      ),
    ).rejects.toThrow();
    await expect(
      adapter.execute(
        "support.reconcile",
        { ...supportReconciliationPayload, originalJobId: supportPayload.caseId },
        jiraCredential,
      ),
    ).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("does not contact CRM for an undesignated contact", async () => {
    const fetcher = vi.fn<typeof fetch>();
    await expect(
      new HubSpotAdapter(fetcher).execute(
        "crm.organization.upsert",
        {
          organizationId: supportPayload.organizationId,
          name: "Business",
          designatedContacts: [{ email: "creator@example.org", authorized: false }],
        },
        { accessToken: "secret" },
      ),
    ).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("reads linked Jira status and assignment without retaining reporter or agent email", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            issueId: "10001",
            issueKey: "POPS-2",
            currentStatus: { status: "Waiting for support" },
            reporter: { emailAddress: "private-reporter@example.test" },
          }),
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: "10001",
            key: "POPS-2",
            fields: {
              status: { name: "In progress" },
              assignee: {
                accountId: "agent-1",
                displayName: "Support operator",
                emailAddress: "private-agent@example.test",
              },
            },
          }),
        ),
      );
    const receipt = await new JiraServiceManagementAdapter(fetcher).execute(
      "support.status",
      { issueKey: "POPS-1", issueId: "10001" },
      jiraCredential,
    );
    expect(receipt).toMatchObject({
      issueKey: "POPS-2",
      status: "Waiting for support",
      assignee: { accountId: "agent-1", displayName: "Support operator" },
    });
    expect(JSON.stringify(receipt)).not.toContain("private-");
    expect(fetcher.mock.calls[1]?.[0]).toContain("/rest/api/3/issue/POPS-2?fields=assignee,status");
    expect(fetcher.mock.calls.every(([, init]) => !init?.method || init.method === "GET")).toBe(
      true,
    );
  });
  it("QuickBooks exposes only bounded read operations", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(
        async () => new Response('{"QueryResponse":{"Invoice":[]}}', { status: 200 }),
      );
    const adapter = new QuickBooksReadOnlyAdapter(fetcher);
    await expect(
      adapter.execute("support.create", {}, { accessToken: "secret", realmId: "1" }),
    ).rejects.toThrow(/read-only/);
    await expect(
      adapter.execute("accounting.reconcile", accountingPayload, {
        accessToken: "secret",
        realmId: "1",
      }),
    ).resolves.toMatchObject({ documents: [], completePeriod: true, readOnly: true });
    expect(fetcher).toHaveBeenCalledTimes(4);
    expect(fetcher.mock.calls[0]?.[0]).toContain("sandbox-quickbooks.api.intuit.com");
    expect(fetcher.mock.calls[0]?.[1]?.method).toBeUndefined();
  });
  it("production accounting reads require explicit environment opt-in", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(async () => new Response('{"QueryResponse":{}}'));
    expect(() =>
      starterIntegrationAdapters(fetcher, { QUICKBOOKS_ENVIRONMENT: "production" }),
    ).toThrow(/opt-in/);
    const adapter = starterIntegrationAdapters(fetcher, {
      QUICKBOOKS_ENVIRONMENT: "production",
      QUICKBOOKS_PRODUCTION_READS_ENABLED: "true",
    }).find((entry) => entry.provider === "quickbooks")!;
    await adapter.execute("accounting.reconcile", accountingPayload, {
      accessToken: "secret",
      realmId: "1",
    });
    expect(
      fetcher.mock.calls.every(([url]) =>
        String(url).startsWith("https://quickbooks.api.intuit.com/"),
      ),
    ).toBe(true);
  });
  it("retains explicit amount/refund mismatches and external references", async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (url) => {
      const query = new URL(String(url)).searchParams.get("query")!;
      return new Response(
        JSON.stringify({
          QueryResponse: query.includes("FROM Invoice")
            ? {
                Invoice: [
                  {
                    Id: "42",
                    CustomerRef: { value: "12" },
                    TxnDate: "2026-10-05",
                    TotalAmt: 12.5,
                    CurrencyRef: { value: "USD" },
                  },
                ],
              }
            : query.includes("FROM RefundReceipt")
              ? {
                  RefundReceipt: [
                    {
                      Id: "43",
                      CustomerRef: { value: "12" },
                      TxnDate: "2026-10-05",
                      TotalAmt: 2.5,
                      CurrencyRef: { value: "USD" },
                    },
                  ],
                }
              : {},
        }),
      );
    });
    const receipt = await new QuickBooksReadOnlyAdapter(fetcher).execute(
      "accounting.reconcile",
      {
        ...accountingPayload,
        stripeTransactions: [
          {
            id: "pi_1",
            kind: "sale",
            amountMinor: 1251,
            currency: "USD",
            occurredAt: "2026-10-05T12:00:00.000Z",
            paymentId: "pi_1",
            invoiceId: "in_1",
            sourceEventId: "evt_1",
          },
          {
            id: "re_1",
            kind: "refund",
            amountMinor: 250,
            currency: "USD",
            occurredAt: "2026-10-05T12:00:00.000Z",
            paymentId: "pi_1",
            invoiceId: null,
            sourceEventId: "evt_2",
          },
        ],
        transactionMappings: [
          { stripeTransactionId: "pi_1", entity: "Invoice", externalId: "42" },
          { stripeTransactionId: "re_1", entity: "RefundReceipt", externalId: "43" },
        ],
      },
      { accessToken: "secret", realmId: "1" },
    );
    expect(receipt.reconciliation).toMatchObject({
      matched: 1,
      mismatches: 1,
      results: [
        { stripeTransactionId: "pi_1", externalId: "42", status: "amount_mismatch" },
        { stripeTransactionId: "re_1", externalId: "43", status: "matched" },
      ],
    });
    expect(fetcher.mock.calls.every(([, init]) => !init?.method || init.method === "GET")).toBe(
      true,
    );
  });
  it("paginates a complete accounting period past the first thousand", async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (url) => {
      const query = new URL(String(url)).searchParams.get("query")!;
      const entries = query.includes("FROM Invoice")
        ? Array.from({ length: query.includes("STARTPOSITION 1 ") ? 1000 : 1 }, (_, index) => ({
            Id: String(query.includes("STARTPOSITION 1 ") ? index + 1 : 1001),
            CustomerRef: { value: "12" },
            TxnDate: "2026-10-05",
            TotalAmt: 1,
          }))
        : [];
      return new Response(JSON.stringify({ QueryResponse: { Invoice: entries } }));
    });
    const receipt = await new QuickBooksReadOnlyAdapter(fetcher).execute(
      "accounting.reconcile",
      accountingPayload,
      { accessToken: "secret", realmId: "1" },
    );
    expect(receipt.documents).toHaveLength(1001);
    expect(receipt.completePeriod).toBe(true);
    expect(
      fetcher.mock.calls.some(([url]) =>
        new URL(String(url)).searchParams.get("query")!.includes("STARTPOSITION 1001"),
      ),
    ).toBe(true);
  });
  it("rotates access and refresh tokens without putting secrets in URLs", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(
          '{"access_token":"next-access","refresh_token":"next-refresh","expires_in":1800}',
          { status: 200 },
        ),
      );
    const rotated = await refreshIntegrationCredential(
      "hubspot",
      {
        accessToken: "old-access",
        refreshToken: "old-refresh",
        clientId: "client",
        clientSecret: "secret",
      },
      fetcher,
      new Date("2026-10-12T12:00:00Z"),
    );
    expect(rotated.accessToken).toBe("next-access");
    expect(rotated.refreshToken).toBe("next-refresh");
    expect(rotated.expiresAt).toBe("2026-10-12T12:30:00.000Z");
    expect(fetcher.mock.calls[0]?.[0]).toBe("https://api.hubapi.com/oauth/2026-03/token");
    expect(fetcher.mock.calls[0]?.[1]?.body).toContain("refresh_token=old-refresh");
  });
});
