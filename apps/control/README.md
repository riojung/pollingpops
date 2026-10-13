# Polling Pops operator console

This is a separate Next.js application for provisioned operators. It shares platform repositories
with Polling Pops and does not construct the API/realtime application. Customer sessions and the
legacy `ADMIN_TOKEN` cannot authorize console requests.

The console starts disabled. `pnpm --filter @openround/control dev` serves it on port 3002. The
production build uses the supported Webpack option because shared Node packages use `.js` ESM
specifiers for TypeScript source. The deployment container uses Next's standalone output.

## Identity and deployment configuration

Set `CONTROL_ENABLED=true`, `CONTROL_PUBLIC_ORIGIN` to the dedicated HTTPS origin, and
`CONTROL_DATABASE_URL` to the separately configured runtime connection. Production startup rejects
an owner/superuser, RLS bypass, or otherwise privileged runtime principal. Migrations run through
the existing separate maintenance process, never through this app.

Configure a dedicated `OPERATOR_OIDC_ISSUER`, `OPERATOR_OIDC_CLIENT_ID`, and
`OPERATOR_OIDC_CLIENT_SECRET`. Register exactly `<CONTROL_PUBLIC_ORIGIN>/auth/callback`. Set
`OPERATOR_OIDC_MFA_POLICY_ENFORCED=true` only after the provider application policy enforces MFA.
Configure exact provider claim values through `OPERATOR_OIDC_REQUIRED_AMR` and/or
`OPERATOR_OIDC_ALLOWED_ACR`. Both configured conditions must match; missing assurance claims fail
closed. A signed customer identity token does not substitute for operator assurance.

`OPERATOR_BOOTSTRAP_IDENTITIES` is a JSON array of preprovisioned identities:

```json
[
  {
    "issuer": "https://approved-operator-issuer.example/",
    "subject": "the-provider-subject-id",
    "displayName": "Founder",
    "role": "founder"
  }
]
```

Bootstrap checks and inserts happen under one transaction. Existing identities retain their current
role and disabled state across process restarts. The issuer must exactly match the configured
operator provider. Emails never auto-create or link operators.

Sessions are opaque, stored as hashes, revocable, and checked against current operator access on
every authenticated request. They expire after eight hours or thirty idle minutes. Financial,
credential, access, and admission-restriction commands require authentication within five minutes.
OAuth login uses browser-bound one-use state, nonce, and PKCE. Mutation handlers require exact
same-origin requests and a session-bound CSRF token. Local HTTP is possible only with the explicit
non-production `CONTROL_ALLOW_LOCAL_HTTP=true` setting and loopback origins.

## Operator areas

Organization/workspace pause, billing projections, credits/promotions, worker heartbeats and pause,
support cases and the fifty newest private product-feedback records, integration attempts, and
operator audits have separate server-side capability checks. Commands commit their mutation,
idempotent receipt, and attributable audit in one transaction. Lost responses can retry the same
command key. Closed organizations are not reopened by a pause command.

Operational pause preserves active room grants. Admission restriction is a distinct workspace
action for blocking new audience admission. Finance review can resolve a commercial hold without
granting credits or initiating payment. The final active founder cannot be disabled or demoted.

Operations also lists up to 100 current room summaries (no participant content) and product queue
counts. Failed Round/Presentation report and authoring jobs can be retried only when their retained
source evidence still permits it. Erased/expired authoring input requires a new upload by a workspace
member. Product retries require `operations.write`; failed billing-inbox retries require
`billing.write`. Both require recent MFA, retain attempt history, and schedule the existing job/event
without accepting a new provider payload or making provider calls in the command transaction.

Credit exports paginate all ledger entries in a selected UTC date period of at most 366 days and
escape spreadsheet formulas. Periods over 100,000 rows are rejected before producing a CSV, with
instructions to select a shorter range. Customer
feedback stays private; external support requests use an explicitly authored redacted case rather
than automatically forwarding raw reports.

## Named business integrations

Generate a 32-byte base64 `INTEGRATION_SECRET_KEY` outside source control and supply it to both the
console and jobs process. Provider access/refresh credentials are authenticated-encrypted in
storage; views, receipts, and audit events do not return them. Initial provider authorization and
approved account configuration are performed in the provider's own tools; the console accepts the
resulting scoped credentials. When refresh credentials and expiry are supplied, workers serialize
refresh under the provider lease and persist rotated tokens. Unknown refresh outcomes require
reconnection. There is no customer-facing integration marketplace or embedded provider-consent
wizard in this first implementation.

- **Jira Service Management:** approved cloud ID, service-desk ID and request-type ID; request
  creation and repeatable case status/assignment refresh. Approve service-desk create/read scopes
  and Jira's `read:jira-work` scope for the assignee/status read, with Browse Projects and issue
  visibility limited to the support project. The adapter retains only assigned-agent account ID
  and display name, not email, reporter data or comments. See the official
  [request API](https://developer.atlassian.com/cloud/jira/service-desk/rest/api-group-request/) and
  [issue API](https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issues/).
  Provider timeouts, uncertain successful writes, or expired worker
  leases hold creation as `ambiguous`. These jobs cannot be blindly retried in the console.
  In Support, look up the local case marker in the approved Jira service desk, obtain the existing
  numeric issue/request ID, and select **Verify existing support request** with a reason. The worker
  reads that existing request and verifies exact case and organization references before atomically
  linking the original ambiguous delivery, case status/assignment mirror, and audit. A missing request,
  mismatched reference, or provider outage leaves the original ambiguity unresolved. This flow never
  declares an uncertain request absent and never creates a replacement request.
- **HubSpot:** companies use the approved unique `pollingpops_organization_id` property. Provision
  `pollingpops_subscription_status` and `pollingpops_licensed_workspaces` for commercial mirrors.
  A designated contact command validates a selected verified organization member and sends only
  that business contact. It never copies all workspace members or subscribes contacts to marketing.
- **QuickBooks:** `QUICKBOOKS_ENVIRONMENT=sandbox` is the default. Production additionally requires
  `QUICKBOOKS_PRODUCTION_READS_ENABLED=true` in the jobs process, approved production OAuth credentials,
  and the matching company realm ID. Operators map an organization to an existing numeric customer ID,
  specify the company's home currency, and choose at most 366 days. Read-only queries paginate Invoice,
  SalesReceipt, CreditMemo and RefundReceipt documents. A period over 5,000 accounting documents is
  rejected rather than silently truncated. Reconciliation compares explicit one-to-one document
  mappings against immutable imported Stripe sale/refund facts (up to 10,000 per period). It retains
  matched, amount/currency/kind mismatch, missing-document, unmapped and unlinked-document references
  with the source snapshot time. Invoice or credit-memo comparison does not prove settlement or tax
  treatment. The console exposes no accounting write API and never posts sales/refunds.

Provider requests use fixed official hosts, ten-second deadlines, redirect refusal, bounded
payloads, redacted errors and durable retry state. Authorization expiry disconnects the affected
connection and preserves the pending local case/job. Provider accounts, credentials, webhook
delivery and live interoperability still need the deployment rehearsals; unit and build checks do
not establish those external conditions.

## Local acceptance checks

`pnpm --filter @openround/control-plane test` covers assurance, revocation, transaction rollback,
idempotent commands, admission policy, provider uncertainty, encrypted credentials, token rotation,
read-only financial reconciliation, and complete-period CSV pagination.

`pnpm exec playwright test --config=playwright.control.config.ts` exercises the enabled browser console
against real in-memory platform/auth/operator services and a local signed OIDC issuer through the
actual openid-client discovery, PKCE, nonce and token validation path. The test replaces only the
console HTTP boundary, without a production runtime bypass. It covers founder login, a lost command
receipt and exact retry, credit/audit effects, admission restriction, session revocation, and a
readonly operator's forged financial-command denial. It does not replace deployed PostgreSQL,
cookie ingress, or the managed provider/account interoperability rehearsals.
