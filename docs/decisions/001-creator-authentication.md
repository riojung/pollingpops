# ADR 001: Server-owned creator sessions with verified email and sign-in PINs

- Status: accepted; email authentication revised 2026-10-20
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

Existing creator sessions remain valid until their normal expiry or revocation. Migration 075
marks existing active identities verified because the preceding flow already required mailbox
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
