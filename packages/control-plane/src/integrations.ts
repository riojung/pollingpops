import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { z } from "zod";
import {
  AccountingReconciliationInputSchema,
  accountingMinorAmount,
  reconcileAccountingDocuments,
  type AccountingDocument,
} from "./accounting.js";

export type IntegrationProvider = "jira-service-management" | "hubspot" | "quickbooks";
export type ProviderOperation =
  | "support.create"
  | "support.status"
  | "support.reconcile"
  | "crm.organization.upsert"
  | "accounting.reconcile";
export class IntegrationFailure extends Error {
  constructor(
    public readonly code: "retry" | "reconnect" | "invalid" | "ambiguous",
    message: string,
    public readonly retryAfterMs = 0,
  ) {
    super(message);
    this.name = "IntegrationFailure";
  }
}
export interface ProviderCredential {
  accessToken: string;
  refreshToken?: string;
  clientId?: string;
  clientSecret?: string;
  expiresAt?: string;
  cloudId?: string;
  realmId?: string;
  serviceDeskId?: string;
  requestTypeId?: string;
}
export interface IntegrationAdapter {
  readonly provider: IntegrationProvider;
  execute(
    operation: ProviderOperation,
    payload: unknown,
    credential: ProviderCredential,
  ): Promise<Record<string, unknown>>;
}
type Fetch = typeof fetch;

async function boundedProviderText(response: Response, maximum: number): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maximum) {
      await reader.cancel();
      throw new Error("Provider receipt exceeded its limit");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export function encryptIntegrationSecret(value: ProviderCredential, key: string): string {
  const bytes = Buffer.from(key, "base64");
  if (bytes.length !== 32) throw new Error("Integration encryption requires a 32-byte base64 key");
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", bytes, nonce);
  cipher.setAAD(Buffer.from("pollingpops-integration-v1"));
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return [
    "v1",
    nonce.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    encrypted.toString("base64url"),
  ].join(".");
}
export function decryptIntegrationSecret(value: string, key: string): ProviderCredential {
  const [version, nonce, tag, encrypted] = value.split(".");
  const bytes = Buffer.from(key, "base64");
  if (version !== "v1" || !nonce || !tag || !encrypted || bytes.length !== 32)
    throw new Error("Invalid encrypted integration credential");
  const cipher = createDecipheriv("aes-256-gcm", bytes, Buffer.from(nonce, "base64url"));
  cipher.setAAD(Buffer.from("pollingpops-integration-v1"));
  cipher.setAuthTag(Buffer.from(tag, "base64url"));
  const decrypted = Buffer.concat([
    cipher.update(Buffer.from(encrypted, "base64url")),
    cipher.final(),
  ]);
  return z
    .object({
      accessToken: z.string().min(1),
      refreshToken: z.string().optional(),
      clientId: z.string().optional(),
      clientSecret: z.string().optional(),
      expiresAt: z.iso.datetime().optional(),
      cloudId: z.string().optional(),
      realmId: z.string().optional(),
      serviceDeskId: z.string().optional(),
      requestTypeId: z.string().optional(),
    })
    .strict()
    .parse(JSON.parse(decrypted.toString("utf8")));
}

export async function refreshIntegrationCredential(
  provider: IntegrationProvider,
  credential: ProviderCredential,
  fetcher: Fetch = fetch,
  now = new Date(),
): Promise<ProviderCredential> {
  if (!credential.refreshToken || !credential.clientId || !credential.clientSecret)
    throw new IntegrationFailure("reconnect", "Provider authorization must be renewed");
  const endpoint =
    provider === "jira-service-management"
      ? "https://auth.atlassian.com/oauth/token"
      : provider === "hubspot"
        ? "https://api.hubapi.com/oauth/2026-03/token"
        : "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";
  const fields = {
    grant_type: "refresh_token",
    refresh_token: credential.refreshToken,
    client_id: credential.clientId,
    client_secret: credential.clientSecret,
  };
  let response: Response;
  try {
    response = await fetcher(endpoint, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
      headers:
        provider === "jira-service-management"
          ? { "content-type": "application/json" }
          : {
              "content-type": "application/x-www-form-urlencoded",
              ...(provider === "quickbooks"
                ? {
                    authorization: `Basic ${Buffer.from(`${credential.clientId}:${credential.clientSecret}`).toString("base64")}`,
                  }
                : {}),
            },
      body:
        provider === "jira-service-management"
          ? JSON.stringify(fields)
          : new URLSearchParams(
              provider === "quickbooks"
                ? { grant_type: fields.grant_type, refresh_token: fields.refresh_token }
                : fields,
            ).toString(),
    });
  } catch {
    throw new IntegrationFailure(
      "reconnect",
      "Refresh outcome is unknown; reconnect rather than replay a rotating token",
    );
  }
  if (!response.ok)
    throw new IntegrationFailure(
      response.status >= 500 || response.status === 429 ? "retry" : "reconnect",
      "Provider authorization refresh did not complete",
    );
  let receipt: { access_token: string; refresh_token?: string; expires_in: number };
  try {
    receipt = z
      .object({
        access_token: z.string().min(1),
        refresh_token: z.string().min(1).optional(),
        expires_in: z.number().int().positive().max(31_536_000),
      })
      .parse(JSON.parse(await boundedProviderText(response, 32_000)));
  } catch {
    throw new IntegrationFailure(
      "reconnect",
      "Refresh receipt could not be verified; reconnect the provider",
    );
  }
  return {
    ...credential,
    accessToken: receipt.access_token,
    refreshToken: receipt.refresh_token ?? credential.refreshToken,
    expiresAt: new Date(now.getTime() + receipt.expires_in * 1000).toISOString(),
  };
}

async function providerRequest(
  fetcher: Fetch,
  url: string,
  token: string,
  init: RequestInit = {},
  ambiguousCreation = false,
): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    response = await fetcher(url, {
      ...init,
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        authorization: `Bearer ${token}`,
        ...init.headers,
      },
      signal: AbortSignal.timeout(10_000),
      redirect: "error",
    });
  } catch {
    throw new IntegrationFailure(
      ambiguousCreation ? "ambiguous" : "retry",
      ambiguousCreation
        ? "Provider creation outcome is unknown; reconcile the case before retry"
        : "Provider is temporarily unavailable",
    );
  }
  if (response.status === 401 || response.status === 403)
    throw new IntegrationFailure("reconnect", "Provider authorization requires operator attention");
  if (response.status === 429) {
    const retry = Number(response.headers.get("retry-after"));
    throw new IntegrationFailure(
      "retry",
      "Provider rate limit reached",
      Number.isFinite(retry) ? Math.min(3_600_000, Math.max(1_000, retry * 1_000)) : 60_000,
    );
  }
  if (response.status >= 500)
    throw new IntegrationFailure(
      ambiguousCreation ? "ambiguous" : "retry",
      ambiguousCreation
        ? "Provider creation outcome is unknown; reconcile the case before retry"
        : "Provider is temporarily unavailable",
    );
  if (!response.ok)
    throw new IntegrationFailure("invalid", "Provider rejected the configured request");
  if (response.status === 204) return {};
  let body: string;
  try {
    body = await boundedProviderText(response, 1_000_000);
  } catch {
    throw new IntegrationFailure(
      ambiguousCreation ? "ambiguous" : "retry",
      "Provider receipt could not be read",
    );
  }
  if (body.length > 1_000_000)
    throw new IntegrationFailure(
      ambiguousCreation ? "ambiguous" : "invalid",
      "Provider response exceeded the allowed size",
    );
  try {
    return z.record(z.string(), z.unknown()).parse(JSON.parse(body));
  } catch {
    throw new IntegrationFailure(
      ambiguousCreation ? "ambiguous" : "invalid",
      "Provider response was not a valid receipt",
    );
  }
}

const supportCreate = z
  .object({
    caseId: z.string().uuid(),
    organizationId: z.string().uuid(),
    workspaceId: z.string().uuid().optional(),
    subject: z.string().min(1).max(160),
    redactedDescription: z.string().min(1).max(4_000),
  })
  .strict();
const supportReconcile = z
  .object({
    caseId: z.string().uuid(),
    organizationId: z.string().uuid(),
    originalJobId: z.string().regex(/^[a-f0-9]{64}$/),
    issueId: z.string().regex(/^\d+$/),
  })
  .strict();
export class JiraServiceManagementAdapter implements IntegrationAdapter {
  readonly provider = "jira-service-management" as const;
  constructor(private readonly fetcher: Fetch = fetch) {}
  async execute(operation: ProviderOperation, payload: unknown, credential: ProviderCredential) {
    const cloudId = z.string().uuid().parse(credential.cloudId);
    const base = `https://api.atlassian.com/ex/jira/${cloudId}/rest/servicedeskapi/request`;
    if (operation === "support.status" || operation === "support.reconcile") {
      const reconciliation =
        operation === "support.reconcile" ? supportReconcile.parse(payload) : null;
      const link =
        reconciliation ??
        z
          .object({
            issueKey: z.string().regex(/^[A-Z][A-Z0-9_]*-\d+$/),
            issueId: z.string().regex(/^\d+$/),
            caseId: z.string().uuid().optional(),
          })
          .strict()
          .parse(payload);
      const issueReference = "issueKey" in link ? link.issueKey : link.issueId;
      const receipt = await providerRequest(
        this.fetcher,
        `${base}/${issueReference}`,
        credential.accessToken,
      );
      const result = z
        .object({
          issueId: z.string().regex(/^\d+$/),
          issueKey: z.string().regex(/^[A-Z][A-Z0-9_]*-\d+$/),
          currentStatus: z.object({
            status: z.string().max(200),
            statusCategory: z.string().optional(),
          }),
        })
        .parse(receipt);
      if (result.issueId !== link.issueId)
        throw new IntegrationFailure("invalid", "Support receipt does not match the linked issue");
      if (reconciliation) {
        const reference = z
          .object({
            summary: z.string().max(400),
            requestFieldValues: z
              .array(z.object({ fieldId: z.string(), value: z.unknown() }))
              .max(200),
          })
          .safeParse(receipt);
        const descriptions = reference.success
          ? reference.data.requestFieldValues.filter((field) => field.fieldId === "description")
          : [];
        const description = descriptions.length === 1 ? descriptions[0]!.value : null;
        const caseMarker = `[Polling Pops ${reconciliation.caseId}] `;
        const referenceBlock = `Polling Pops case: ${reconciliation.caseId}\nOrganization: ${reconciliation.organizationId}`;
        const workspacePrefix = `${referenceBlock}\nWorkspace: `;
        if (
          !reference.success ||
          !reference.data.summary.startsWith(caseMarker) ||
          typeof description !== "string" ||
          !description
            .replace(/\r\n/g, "\n")
            .split("\n\n")
            .some(
              (block) =>
                block === referenceBlock ||
                (block.startsWith(workspacePrefix) &&
                  z.uuid().safeParse(block.slice(workspacePrefix.length)).success),
            )
        )
          throw new IntegrationFailure(
            "invalid",
            "Support request does not match the original case and organization references",
          );
      }
      const issue = z
        .object({
          id: z.string(),
          key: z.string(),
          fields: z.object({
            assignee: z
              .object({ accountId: z.string().min(1).max(256), displayName: z.string().max(200) })
              .nullable(),
            status: z.object({ name: z.string().max(200) }),
          }),
        })
        .parse(
          await providerRequest(
            this.fetcher,
            `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/issue/${result.issueKey}?fields=assignee,status`,
            credential.accessToken,
          ),
        );
      if (issue.id !== result.issueId || issue.key !== result.issueKey)
        throw new IntegrationFailure(
          "invalid",
          "Support assignment receipt does not match the linked issue",
        );
      return {
        externalId: result.issueId,
        issueKey: result.issueKey,
        status: result.currentStatus.status,
        jiraStatus: issue.fields.status.name,
        assignee: issue.fields.assignee,
        checkedAt: new Date().toISOString(),
        ...(reconciliation
          ? {
              reconciled: true,
              caseId: reconciliation.caseId,
              organizationId: reconciliation.organizationId,
              originalJobId: reconciliation.originalJobId,
            }
          : {}),
      };
    }
    if (operation !== "support.create")
      throw new IntegrationFailure("invalid", "Unsupported Jira Service Management operation");
    const input = supportCreate.parse(payload);
    const serviceDeskId = z.string().regex(/^\d+$/).parse(credential.serviceDeskId);
    const requestTypeId = z.string().regex(/^\d+$/).parse(credential.requestTypeId);
    const receipt = await providerRequest(
      this.fetcher,
      base,
      credential.accessToken,
      {
        method: "POST",
        body: JSON.stringify({
          serviceDeskId,
          requestTypeId,
          requestFieldValues: {
            summary: `[Polling Pops ${input.caseId}] ${input.subject}`,
            description: `${input.redactedDescription}\n\nPolling Pops case: ${input.caseId}\nOrganization: ${input.organizationId}${input.workspaceId ? `\nWorkspace: ${input.workspaceId}` : ""}`,
          },
        }),
      },
      true,
    );
    const validated = z
      .object({
        issueId: z.string(),
        issueKey: z.string(),
        _links: z.object({ agent: z.string().url() }).optional(),
      })
      .safeParse(receipt);
    if (!validated.success)
      throw new IntegrationFailure(
        "ambiguous",
        "Jira created a request without a valid receipt; reconcile before retry",
      );
    const result = validated.data;
    return {
      externalId: result.issueId,
      issueKey: result.issueKey,
      ...(result._links ? { externalUrl: result._links.agent } : {}),
    };
  }
}

const crmInput = z
  .object({
    organizationId: z.string().uuid(),
    name: z.string().min(1).max(200),
    externalId: z.string().regex(/^\d+$/).optional(),
    commercialStatus: z.string().min(1).max(80).optional(),
    licensedWorkspaces: z.number().int().min(0).max(100_000).optional(),
    designatedContacts: z
      .array(
        z
          .object({
            email: z.email(),
            firstName: z.string().max(100).optional(),
            lastName: z.string().max(100).optional(),
            authorized: z.literal(true),
          })
          .strict(),
      )
      .max(10)
      .default([]),
  })
  .strict();
export class HubSpotAdapter implements IntegrationAdapter {
  readonly provider = "hubspot" as const;
  constructor(private readonly fetcher: Fetch = fetch) {}
  async execute(operation: ProviderOperation, payload: unknown, credential: ProviderCredential) {
    if (operation !== "crm.organization.upsert")
      throw new IntegrationFailure("invalid", "Unsupported HubSpot operation");
    const input = crmInput.parse(payload);
    const base = "https://api.hubapi.com/crm/objects/2026-03";
    let companyId = input.externalId;
    if (!companyId) {
      const existing = await providerRequest(
        this.fetcher,
        `${base}/companies/search`,
        credential.accessToken,
        {
          method: "POST",
          body: JSON.stringify({
            filterGroups: [
              {
                filters: [
                  {
                    propertyName: "pollingpops_organization_id",
                    operator: "EQ",
                    value: input.organizationId,
                  },
                ],
              },
            ],
            limit: 2,
            properties: ["pollingpops_organization_id"],
          }),
        },
      );
      const records = z
        .object({ results: z.array(z.object({ id: z.string() })).max(2) })
        .parse(existing);
      if (records.results.length > 1)
        throw new IntegrationFailure(
          "invalid",
          "Multiple CRM organizations match the platform reference",
        );
      companyId = records.results[0]?.id;
    }
    const company = await providerRequest(
      this.fetcher,
      `${base}/companies${companyId ? `/${companyId}` : ""}`,
      credential.accessToken,
      {
        method: companyId ? "PATCH" : "POST",
        body: JSON.stringify({
          properties: {
            name: input.name,
            pollingpops_organization_id: input.organizationId,
            ...(input.commercialStatus
              ? { pollingpops_subscription_status: input.commercialStatus }
              : {}),
            ...(input.licensedWorkspaces !== undefined
              ? { pollingpops_licensed_workspaces: input.licensedWorkspaces }
              : {}),
          },
        }),
      },
      !companyId,
    );
    const validatedCompany = z.object({ id: z.string().regex(/^\d+$/) }).safeParse(company);
    if (!validatedCompany.success)
      throw new IntegrationFailure(
        companyId ? "invalid" : "ambiguous",
        "CRM company receipt could not be validated",
      );
    const id = validatedCompany.data.id;
    const contactIds: string[] = [];
    for (const contact of input.designatedContacts) {
      const existing = await providerRequest(
        this.fetcher,
        `${base}/contacts/search`,
        credential.accessToken,
        {
          method: "POST",
          body: JSON.stringify({
            filterGroups: [
              { filters: [{ propertyName: "email", operator: "EQ", value: contact.email }] },
            ],
            limit: 2,
          }),
        },
      );
      const records = z
        .object({ results: z.array(z.object({ id: z.string() })).max(2) })
        .parse(existing);
      if (records.results.length > 1)
        throw new IntegrationFailure("invalid", "Multiple CRM contacts match the designated email");
      const contactId = records.results[0]?.id;
      const receipt = await providerRequest(
        this.fetcher,
        `${base}/contacts${contactId ? `/${contactId}` : ""}`,
        credential.accessToken,
        {
          method: contactId ? "PATCH" : "POST",
          body: JSON.stringify({
            properties: {
              email: contact.email,
              firstname: contact.firstName ?? "",
              lastname: contact.lastName ?? "",
            },
          }),
        },
        !contactId,
      );
      const validatedContact = z.object({ id: z.string().regex(/^\d+$/) }).safeParse(receipt);
      if (!validatedContact.success)
        throw new IntegrationFailure(
          contactId ? "invalid" : "ambiguous",
          "CRM contact receipt could not be validated",
        );
      const createdId = validatedContact.data.id;
      await providerRequest(
        this.fetcher,
        `https://api.hubapi.com/crm/v4/objects/contacts/${createdId}/associations/default/companies/${id}`,
        credential.accessToken,
        { method: "PUT" },
      );
      contactIds.push(createdId);
    }
    return { externalId: id, contactIds };
  }
}

export class QuickBooksReadOnlyAdapter implements IntegrationAdapter {
  readonly provider = "quickbooks" as const;
  constructor(
    private readonly fetcher: Fetch = fetch,
    private readonly environment: "sandbox" | "production" = "sandbox",
  ) {}
  async execute(operation: ProviderOperation, payload: unknown, credential: ProviderCredential) {
    if (operation !== "accounting.reconcile")
      throw new IntegrationFailure("invalid", "QuickBooks integration is read-only");
    const input = AccountingReconciliationInputSchema.parse(payload);
    if (
      input.endDate < input.startDate ||
      new Date(input.endDate).getTime() - new Date(input.startDate).getTime() > 366 * 86_400_000
    )
      throw new IntegrationFailure("invalid", "Invalid accounting reconciliation period");
    const realm = z.string().regex(/^\d+$/).parse(credential.realmId);
    const host =
      this.environment === "sandbox"
        ? "sandbox-quickbooks.api.intuit.com"
        : "quickbooks.api.intuit.com";
    const documents: AccountingDocument[] = [];
    for (const entity of ["Invoice", "SalesReceipt", "CreditMemo", "RefundReceipt"] as const) {
      for (let position = 1; ; position += 1000) {
        const query = `SELECT * FROM ${entity} WHERE CustomerRef = '${input.externalCustomerId}' AND TxnDate >= '${input.startDate}' AND TxnDate <= '${input.endDate}' STARTPOSITION ${position} MAXRESULTS 1000`;
        const receipt = await providerRequest(
          this.fetcher,
          `https://${host}/v3/company/${realm}/query?query=${encodeURIComponent(query)}`,
          credential.accessToken,
        );
        const page = z
          .array(
            z.object({
              Id: z.string().regex(/^\d+$/),
              DocNumber: z.string().max(100).optional(),
              TxnDate: z.iso.date(),
              TotalAmt: z.number().nonnegative(),
              CustomerRef: z.object({ value: z.string() }),
              CurrencyRef: z.object({ value: z.string().regex(/^[A-Z]{3}$/) }).optional(),
            }),
          )
          .max(1000)
          .parse(
            z.object({ QueryResponse: z.record(z.string(), z.unknown()) }).parse(receipt)
              .QueryResponse[entity] ?? [],
          );
        for (const entry of page) {
          if (
            entry.CustomerRef.value !== input.externalCustomerId ||
            entry.TxnDate < input.startDate ||
            entry.TxnDate > input.endDate
          )
            throw new IntegrationFailure(
              "invalid",
              "Accounting receipt does not match the requested customer and period",
            );
          const currency = entry.CurrencyRef?.value ?? input.homeCurrency;
          documents.push({
            entity,
            externalId: entry.Id,
            documentNumber: entry.DocNumber ?? null,
            date: entry.TxnDate,
            amountMinor: accountingMinorAmount(entry.TotalAmt, currency),
            currency,
          });
        }
        if (documents.length > 5000)
          throw new IntegrationFailure(
            "invalid",
            "Accounting period exceeds 5000 documents; select a shorter period",
          );
        if (page.length < 1000) break;
      }
    }
    if (
      new Set(documents.map((entry) => `${entry.entity}:${entry.externalId}`)).size !==
      documents.length
    )
      throw new IntegrationFailure(
        "retry",
        "Accounting documents changed during pagination; run reconciliation again",
      );
    return {
      environment: this.environment,
      organizationId: input.organizationId,
      externalCustomerId: input.externalCustomerId,
      startDate: input.startDate,
      endDate: input.endDate,
      documents,
      reconciliation: reconcileAccountingDocuments(input, documents),
      completePeriod: true,
      ...{ readOnly: true },
    };
  }
}

export function starterIntegrationAdapters(
  fetcher: Fetch = fetch,
  environment: Record<string, string | undefined> = process.env,
): IntegrationAdapter[] {
  const accountingEnvironment = environment.QUICKBOOKS_ENVIRONMENT ?? "sandbox";
  if (
    !["sandbox", "production"].includes(accountingEnvironment) ||
    (accountingEnvironment === "production" &&
      environment.QUICKBOOKS_PRODUCTION_READS_ENABLED !== "true")
  )
    throw new Error(
      "QuickBooks production reads require an explicit approved environment and opt-in",
    );
  return [
    new JiraServiceManagementAdapter(fetcher),
    new HubSpotAdapter(fetcher),
    new QuickBooksReadOnlyAdapter(fetcher, accountingEnvironment as "sandbox" | "production"),
  ];
}
