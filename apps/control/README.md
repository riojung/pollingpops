# Polling Pops operator console

This separate Next.js application serves provisioned platform administrators at its own address.
Open the console directly and sign in with a username, password and six-digit authenticator code.
A Polling Pops customer account is not required. Customer sessions, organization roles and the
legacy `ADMIN_TOKEN` cannot authorize console requests. Customer sign-in and sign-out do not
create, replace or revoke administrator sessions.

The normal local service bundles start the console at <http://localhost:3002>. There is no default
password or automatically created administrator. Provision the first account explicitly after
starting the services:

```bash
pnpm local:start
pnpm admin:setup --username admin --name "Platform admin" --role founder
```

Open <http://localhost:3002> after enrollment. The customer application continues at
<http://localhost:8080> with email verification for account creation, separate email-PIN sign-in,
and organization navigation.

The default configuration outside the local profile remains disabled.
`pnpm --filter @openround/control dev` serves the native console on port 3002. The production build
uses the supported Webpack option because shared Node packages use `.js` ESM specifiers for
TypeScript source. The deployment container uses Next's standalone output.

## Standalone password authentication

`compose.local-control.yaml` selects `CONTROL_AUTH_MODE=password`,
`CONTROL_LOCAL_DEVELOPMENT=true` and the development environment marker. HTTP is accepted only at
an explicitly configured loopback development origin. Other deployments require HTTPS. The product
server's control integration stays disabled, with no trusted product origin or admin email binding.

`pnpm admin:setup` executes the provisioning CLI inside the running control container. It requires
an interactive terminal, prompts for a hidden password and confirmation, then displays a TOTP
secret and `otpauth://` enrollment URI. Add that material manually to an authenticator app or a
vault that supports TOTP. Sign in with the chosen username, password and the current six-digit
code. Enrollment material is shown only by this offline command; it is not available through the
public application. Store it securely and avoid terminal recordings or shared logs during setup.

The username uses 3–64 letters, numbers, periods, underscores or hyphens and is normalized to
lowercase. Choose a unique password; setup accepts 12–1024 UTF-8 bytes. Select an explicit role:
`founder`, `operations`, `support`, `billing` or `readonly`. The setup command also accepts
`--docker-context NAME` and `--profile core|media|observability` for the running local bundle.

Local service start/restart creates or reuses the ignored `data/admin/credential.key`. The directory
is private (mode `0700`) and the key file is private (mode `0600`). An explicit
`OPERATOR_CREDENTIAL_KEY` in the process environment takes precedence, followed by its nonblank
value in `.env`, then the saved local file. The key is a base64-encoded 32-byte value, passed only
to control. Keep the same key across restarts and back it up securely with the database: it encrypts
authenticator secrets, and a database backup alone cannot recover them.

To replace a lost password or authenticator enrollment, run an explicit reset:

```bash
pnpm admin:setup --username admin --name "Platform admin" --role founder --reset
```

Reset replaces the password and authenticator secret and revokes that administrator's sessions.
Enroll the newly displayed secret. Reset preserves a disabled account's disabled state; it does
not reactivate access. Existing customer and legacy email-bound administrator accounts are not
converted automatically.
The last active founder for an authentication issuer cannot be disabled or demoted. A replacement
password founder must have enrolled credentials; an administrator record alone does not qualify.

Password verifiers use salted scrypt with the
[OWASP scrypt storage profile](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html#scrypt).
Authenticator secrets use authenticated encryption. Codes follow
[RFC 6238](https://www.rfc-editor.org/rfc/rfc6238), with replay protection and durable login throttling.
Migration 073 adds credential and throttle records under the existing database isolation policy.
Apply migrations through the maintenance workflow before setup; the CLI does not run migrations.

For host-native development, use a migrated PostgreSQL database and a persistent credential key.
The following example reuses the key created by local service startup and scopes password settings
to control. Start the customer app separately with its own configuration:

```bash
CONTROL_ENABLED=true CONTROL_AUTH_MODE=password CONTROL_LOCAL_DEVELOPMENT=true \
OPENROUND_DEPLOYMENT_ENVIRONMENT=development \
CONTROL_PUBLIC_ORIGIN=http://localhost:3002 CONTROL_PRODUCT_ORIGIN= \
CONTROL_DATABASE_URL="$DATABASE_URL" \
OPERATOR_CREDENTIAL_KEY="$(cat data/admin/credential.key)" \
pnpm exec turbo run dev --parallel --env-mode=loose --filter=@openround/control
```

Use the same control-only environment for native offline provisioning with
`pnpm exec tsx packages/control-plane/src/admin-cli.ts setup --username admin --name "Platform admin" --role founder`.
The product's in-memory native recipe cannot provide durable tenant data to this separate process.
Native `dev` and `start` bind to `127.0.0.1:3002`; Docker publishes its console port only on loopback.

## Identity and deployment configuration

Set `CONTROL_ENABLED=true`, a dedicated HTTPS `CONTROL_PUBLIC_ORIGIN`, and a restricted
`CONTROL_DATABASE_URL` on control. Production startup rejects an owner/superuser, RLS bypass, or
otherwise privileged runtime principal. Migrations run through the separate maintenance process.
Leave `CONTROL_PRODUCT_ORIGIN` blank; customer navigation never probes administrator sessions.

For hosted password authentication, select `CONTROL_AUTH_MODE=password` and supply a persistent
`OPERATOR_CREDENTIAL_KEY` through secret management, then use the offline provisioning CLI with the
same control configuration. The local `pnpm admin:setup` wrapper targets development Compose
profiles; hosted administration uses the CLI in the reviewed control deployment.

The hosted single-VM overlay defaults to the alternative `CONTROL_AUTH_MODE=oidc`. Configure a
dedicated `OPERATOR_OIDC_ISSUER`, `OPERATOR_OIDC_CLIENT_ID` and `OPERATOR_OIDC_CLIENT_SECRET`.
Register exactly `<CONTROL_PUBLIC_ORIGIN>/auth/callback`. Set
`OPERATOR_OIDC_MFA_POLICY_ENFORCED=true` only after the provider application policy enforces MFA.
Configure exact claim values through `OPERATOR_OIDC_REQUIRED_AMR` and/or `OPERATOR_OIDC_ALLOWED_ACR`.
Both configured conditions must match; missing assurance claims fail closed. A signed customer
identity token does not substitute for operator assurance.

For OIDC, `OPERATOR_BOOTSTRAP_IDENTITIES` is a JSON array of explicitly provisioned identities:

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
role and disabled state across restarts. The issuer must exactly match the configured operator
provider. Emails never auto-create or link administrators.

Sessions are opaque, stored as hashes, revocable and checked against current access on every
request. They expire after eight hours or thirty idle minutes. Financial, credential, access and
admission-restriction commands require authentication within five minutes. Password mode requires
a new password and authenticator sign-in for recent authentication; OIDC uses browser-bound
one-use state, nonce and PKCE. Mutation handlers require exact same-origin requests and a
session-bound CSRF token.

In password mode, recent-authentication checks open verification inside the command review. The
pending change and reason stay in place. After verification, review and apply the command explicitly;
verification never submits it automatically. Use a fresh authenticator code because successful codes
cannot be reused. Successful sign-in clears that username's attempt budget; failed attempts can
temporarily lock sign-in for up to 15 minutes and return HTTP 429. Offline credential reset also
clears that username's budget. The global login limit remains in effect.

## Operator areas

**Overview** opens the service activity dashboard, **Features** manages product availability and
Free/Pro/Team assignments, and **Staff** contains operator access management. In Features, choose
Enabled or Disabled and included plans, then review the change with a reason. Persisted settings
take effect without restarting the product. Inherit deployment restores that feature's environment
and workspace rollout defaults. Feature prerequisites and configured providers still apply.
Changes are revision checked, permission checked and audited; retained room coverage is preserved.
See [feature policy behavior](../../docs/business-management.md#feature-availability-and-plans).

All management areas live in the console. Its sidebar and permitted `?view=` links preserve the
selected area through sign-in. Customer headers, workspace menus and sign-in pages contain customer
organization controls only. The product never discovers administrator identities or links through
the console, and a console outage does not block customer navigation or gameplay.

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
