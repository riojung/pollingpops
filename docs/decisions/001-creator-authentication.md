# ADR 001: Server-owned creator sessions with verified email and sign-in PINs

- Status: accepted; email authentication revised 2026-10-20; inactivity policy revised 2026-11-15
- Date: 2026-09-16

## Context

The initial plan named Auth.js with a PostgreSQL adapter. Polling Pops has a Fastify-owned
email authentication flow with hashed, one-time, expiring credentials; hashed, revocable creator sessions;
secure HttpOnly cookies; explicit logout; policy consent records; workspace-scoped creator
contexts; and integration coverage. Replacing it solely to match a library choice would change a
security-critical path without adding a P0 capability.

## Decision

Keep the server-owned session implementation. Initial account creation sends a verification link
valid for 15 minutes. Only consuming that link provisions the free account and records policy
consent; it does not issue a session or automatically send a sign-in PIN. The user returns to sign
in, accepts the displayed policies, and requests a six-digit email PIN. Only verified, active
identities can receive a PIN; unknown and unverified emails receive a generic accepted response.
PIN authentication never provisions another account or changes a workspace's plan or segment.

PINs expire after ten minutes, allow five wrong attempts, are consumed once, and are replaced by
the next PIN request. Storage contains hashes of the high-entropy challenge and of the
challenge-plus-PIN, never the raw challenge or PIN. Shared rate limits enforce a 60-second resend
cooldown, per-email issuance budgets, and per-IP issuance/verification budgets across instances.
PostgreSQL serializes replacement and consumption, including expiry checks after lock acquisition.
An invitation proves mailbox ownership but does not sign an anonymous user in; the subsequent
PIN preserves the invited workspace only after checking current membership. Email credentials do
not grant platform administration or change OIDC/LTI identity-linking requirements.

At migration 075, existing creator sessions remained valid until their normal expiry or revocation. That migration
marked existing active identities verified because the preceding flow already required mailbox
proof. Previously issued, unused magic links now perform verification only; their callback can
never create a session. The legacy request endpoint remains a verification-only compatibility alias.
No forced logout or plaintext credential migration is required. Account deletion and retention
remove expired PIN challenges along with the existing authentication records.

This decision retains the existing cookie, session, and tenant boundaries. Reconsider Auth.js or another
identity provider when Polling Pops needs federated identity, account linking, institutional SSO,
provider-managed multifactor authentication, or a separately operated identity service.

Future migrations must preserve session revocation, consent history, tenant isolation, auditability,
cookie security, realtime-token scoping, and account deletion. It requires threat-model review,
session migration/forced reauthentication planning, and equivalent integration and browser tests.

## Workspace inactivity policy — November 15, 2026

Login sessions previously had a 30-day absolute expiry but no inactivity expiry. Add a
workspace-owned inactivity policy, enabled by default: show the warning after five minutes
without user activity, allow 60 seconds to choose **Stay signed in**, then end the login session.
The setting explains that the selected inactivity duration precedes the warning: a five-minute
selection means sign-out after six idle minutes. Owners and authorized organization administrators can
choose 1–240 minutes in Workspace settings. The warning lasts 60 seconds; there is no unlimited
or disabled selection. Users without an active workspace receive the default policy.

Before the warning, deliberate keyboard, pointer/touch and scroll interaction can renew the
inactivity deadline. Polling, incoming realtime updates, merely opening a tab, automatic
refreshes and background traffic cannot. Once the warning begins, only **Stay signed in**
renews it; incidental activity does not dismiss the warning. The dialog includes the countdown
and **Sign out now**, keeps existing work mounted during the warning, and supports keyboard
focus and localized copy. Work that has not been saved may be lost after actual sign-out.

The server persists the last accepted activity and idle deadline, checks expiry for both
workspace and identity-only account access, and atomically rejects late renewal. The client
renders server-owned deadlines and checks them on resume, so background throttling or device
sleep cannot restart an expired session. Activity never resets the original 30-day absolute
expiry. Policy reductions and workspace changes can shorten an existing deadline; a longer
policy cannot resurrect an expired login. Existing sessions receive a fresh inactivity window
when the additive migration runs, retaining their original absolute expiry and revocation.
Deleting the active workspace does not implicitly select another membership; the remaining
identity-only session is capped to the default policy until the user explicitly selects a workspace.

Tabs sharing the same login coordinate activity, continuation and sign-out. Cross-tab messages
trigger reconciliation with the server; they do not supply an authoritative new deadline.
Authentication credentials and draft content are not added to browser storage for this feature.
At expiry, private pages are removed, creator control credentials in the current browser are
cleared, and the user returns to sign-in with a validated local return path. Anonymous audience,
shared stage and companion capabilities retain their separate lifecycles; incoming audience
responses never establish the account holder's presence. Presenters who need more time can
choose an appropriate workspace duration before a session.

An overdue tab first hides and disables private content while keeping its component state
mounted, since another tab may have renewed the same login. Verification restores that same
subtree only for the same live session and workspace; confirmed expiry or a changed identity
discards it. A failed check leaves private content hidden and provides keyboard-accessible Retry
controls. A delayed expired-session response never revokes or clears a newer login cookie.
Automatic expiry invalidates access through server-owned deadlines and never posts logout.

Choosing **Sign out now** immediately discards the private subtree, but sign-out is not declared
complete until server revocation is confirmed. A failed or timed-out request exposes a retry
instead of silently reopening the workspace. A tab-scoped pending intent survives navigation
and refresh in session storage; it contains only the non-secret session UUID and a validated
local return path, never an authentication token or draft. A different, freshly authenticated
session clears the old intent without revocation. Cross-tab notification payloads still contain
no session identifiers.

The timeout dialog's logout request includes `expectedSessionId`. The server rejects a mismatch
with HTTP 409 and leaves the current login untouched. A matching login is revoked on the server;
revocation matches the captured cookie hash and immutable session ID atomically, independently
of concurrent renewal or a stale liveness snapshot. An already inactive login succeeds harmlessly.
These guarded replies do not clear the HttpOnly
cookie, because a delayed reply must not erase a newer login's cookie. The retained value has no
authorization after revocation and is replaced on the next sign-in. Existing unguarded logout
callers retain their cookie-clearing behavior.

### Research informing the decision

The product-specific limits below are comparisons, not a universal timeout standard.

| Source                                                                                                                                                                                                                                     | Relevant behavior                                                                                                                                 |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Microsoft 365 idle timeout](https://learn.microsoft.com/en-us/microsoft-365/admin/manage/idle-session-timeout-web-apps?view=o365-worldwide)                                                                                               | Organization-controlled inactivity policy, explicit **Stay signed in**, and activity/sign-out coordinated across the same browser's account tabs. |
| [Atlassian idle duration](https://support.atlassian.com/security-and-access-policies/docs/update-idle-session-duration/) and [session expiration](https://support.atlassian.com/security-and-access-policies/docs/set-session-expiration/) | Inactivity and absolute session lifetime are separate controls.                                                                                   |
| [Slack session duration](https://slack.com/help/articles/115005223763-Manage-session-duration)                                                                                                                                             | Owners/admins can configure session duration and provide advance reauthentication warnings; this is an absolute-duration comparator.              |
| [Google Workspace session length](https://knowledge.workspace.google.com/admin/security/set-session-length-for-google-services)                                                                                                            | Administrators can configure the maximum web session length, separately from short inactivity handling.                                           |
| [OWASP session management](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html#session-expiration)                                                                                                          | Idle and absolute expiry require server enforcement; a client countdown gives users an opportunity to continue working before expiry.             |

The five-minute warning threshold and fixed one-minute grace period implement the requested
product default. They are not claimed to be the default used by every compared product.

### Regression coverage and rollout

`packages/db/test/creator-idle-session.test.ts` checks both repository backends, exact expiry,
late renewals, policy/workspace changes and the absolute cap. Its PostgreSQL cases require
`TEST_DATABASE_ADMIN_URL` and `TEST_DATABASE_URL` for an isolated test cluster; the runtime
role has no superuser or RLS-bypass privileges. Upgrade coverage applies migration 110 as a
table owner subject to forced RLS and checks that its transaction-local access does not leak.
`apps/server/test/idle-session.test.ts` covers authenticated endpoints, policy permissions,
cookie behavior, cache control and origin checks.

`tests/e2e/idle-session.spec.ts` exercises the production web build with real login cookies,
policy persistence, invitations and explicit sign-out. Controlled browser clocks and session
responses accelerate warning/expiry and delayed-response races; those timing fixtures do not
replace the repository expiry tests. The browser journeys also check keyboard focus and Retry,
the exact draft DOM node surviving an uncertain check, removal after confirmed expiry, shared
tabs, failed logout locking across refresh, guarded revocation retries and fresh-login safety.

Apply migration 110 before serving the updated application. Existing logins get a fresh idle
window, but already loaded browser pages need a refresh to receive the warning UI.
