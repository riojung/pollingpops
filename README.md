# Polling Pops

**Make every voice pop.** Live polls, interactive presentations, learning rounds, and
audience conversation in one privacy-preserving workspace. Formerly OpenRound; existing
self-hosted configuration and stored content remain compatible.

![Polling Pops](apps/web/public/brand/polling-pops-logo.svg)

The [brand guide](docs/brand.md) covers the original lollipop logo, berry/cream/mint theme,
dark mode, and downloadable assets. New blank Rounds and Presentations use **Candy Pop**.

**Accountless, server-authoritative comprehension recovery for live learning.**

[![CI](https://github.com/riojung/pollingpops/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/riojung/pollingpops/actions/workflows/ci.yml)
[![Security](https://github.com/riojung/pollingpops/actions/workflows/security.yml/badge.svg?branch=main)](https://github.com/riojung/pollingpops/actions/workflows/security.yml)
[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)

Polling Pops helps higher-education and workplace facilitators identify confusion, make an
explainable intervention, recheck understanding, and review bounded evidence. Participants join
live sessions without creating accounts.

> [!IMPORTANT]
> Polling Pops is pre-1.0 software with no published release yet. The repository contains a working
> local Community stack, but public production, institutional, legal, accessibility, security,
> capacity, and design-partner gates remain open. Do not expose the example configuration or use it
> with sensitive learner data. See [project status](docs/implementation-status.md) and the
> [release-readiness ledger](docs/release-readiness.json).

## Why Polling Pops

Most audience-response tools stop after showing whether an answer was right. Polling Pops is built
around a recovery loop:

**Ask → diagnose → intervene → recheck → review**

- **Accountless participation:** people join with a seven-digit code or direct link and use a
  session-scoped alias; Polling Pops does not create a persistent learner profile in Learning mode.
- **Explainable recovery:** facilitators can act on deterministic aggregate insights, deliver an
  intervention, and open a linked recheck or revote.
- **Reliable live state:** the server owns deadlines, scoring, revisions, and accepted answers;
  idempotency and reconnect flows protect acknowledged work.
- **Safe publishing:** drafts support six response types, confidence, concepts, rationales, and
  linked rechecks. Published versions are immutable.
- **Useful evidence:** asynchronous reports, CSV/JSON exports, self-paced follow-ups, and practice
  assignments preserve the distinction between paired and aggregate evidence.
- **Self-hostable foundations:** the modular monolith runs with PostgreSQL, Valkey, private object
  storage, and optional media scanning and observability profiles.

The default workspace opens at **Home**, with Library, Sessions, and Results navigation on every
plan. Its `workspaceShell` capability is independent of the UX beta flags and pilot allowlist;
explicit Admin availability and plan assignments still apply. The professional Round builder,
Presentations, Surveys, and research prototypes retain their separate feature and plan gates.
Source-grounded authoring is disabled by default; configuring its provider enables it deployment-wide subject to
workspace roles and plan entitlements, not a rollout allowlist. Institution integrations require
provider configuration plus a per-workspace contract policy. Their presence in the repository is
not a launch or readiness claim.

Current optional beta workflows include whole-room flex timing, advisory **Question Health**
reviews of saved drafts and published versions, aggregate post-use observations, and a report
**Decision replay** of recorded facilitator actions. Presentations combine interactive questions
with structured content slides, bounded text positioning and resizing, and shared preview/live
rendering. Workspace owners can also permanently delete archived Library items and finished or
expired session history, subject to retained-use checks. See the [user guide](docs/user-guide.md)
for the workflows and the [quick start's beta configuration](docs/quick-start.md#optional-beta-workflows)
for their deployment gates.

## Quick start

You need Docker Desktop or Docker Engine with Docker Compose v2, at least 2 GB of available memory,
and local ports `8080`, `3002`, `8025`, and `9000`.

```bash
git clone https://github.com/riojung/pollingpops.git
cd pollingpops
docker compose -f compose.yaml -f compose.business.yaml -f compose.local-control.yaml up --build --detach --wait
docker compose -f compose.yaml -f compose.business.yaml -f compose.local-control.yaml ps
curl -fsS http://localhost:8080/health/ready
```

Then open:

- Polling Pops: <http://localhost:8080>
- Development email inbox: <http://localhost:8025>

Local development includes a separate management console at <http://localhost:3002>. Its
provisioned administrator uses a username, password, and authenticator code; customer email
verification and PIN sign-in do not grant platform administration. See the
[administrator setup guide](apps/control/README.md#standalone-password-authentication).

For a new creator, select **Create account**, request a verification email, and open its captured
link in Mailpit. Verification returns to sign-in without granting access. Select **Send sign-in
PIN**, read the newest six-digit code in Mailpit, and enter it to sign in. Normal sign-ins open
Home; a requested return path or accepted invitation keeps its destination and selected workspace.
Existing verified accounts request a PIN directly. The core profile uses development credentials
and disables untrusted image uploads because no malware scanner is attached.

For an existing Colima installation on macOS, use `pnpm local:start` after rebooting. With Node.js
22+ and dependencies installed (`pnpm install --frozen-lockfile`), it starts the existing `default`
VM, waits for Docker, and starts the core stack without switching global contexts or deleting data.
Use `pnpm local:start --no-build` when the application images are already built and unchanged.
See [Colima startup and explicit recovery](docs/quick-start.md#one-command-startup-after-a-reboot-colima).

Stop the stack while preserving its PostgreSQL, Valkey, and MinIO named volumes. Captured Mailpit
messages are ephemeral and will be discarded; request fresh verification/PIN emails after restarting:

```bash
docker compose -f compose.yaml -f compose.business.yaml -f compose.local-control.yaml down
```

For the first-Round walkthrough, cross-device setup, optional media profile, and troubleshooting,
follow the [complete quick start](docs/quick-start.md). For profile-aware restarts, full rebuilds,
and safe Docker disk cleanup, use the [operations runbook](docs/runbooks/deployment.md).
Existing clones and hosts should also read the
[repository rename guide](docs/runbooks/repository-rename.md) before changing deployment paths.

## Architecture

Polling Pops is a TypeScript monorepo organized as a modular monolith. Runtime-validated contracts and
pure domain packages are shared by the browser and server, while live state remains
server-authoritative.

```text
Creator, host, presenter, and participant browsers
                         │ HTTPS (REST + Socket.IO)
                         ▼
                      Caddy
                  ┌──────┴──────┐
                  ▼             ▼
             Next.js web   Fastify server
                                  │
                       ┌──────────┼──────────┐
                       ▼          ▼          ▼
                  PostgreSQL    Valkey    S3-compatible storage
                  durable data  live sync  private media
```

The main workspaces are:

| Path                   | Responsibility                                       |
| ---------------------- | ---------------------------------------------------- |
| `apps/web`             | Creator, host, presenter, and participant interfaces |
| `apps/server`          | REST, realtime coordination, jobs, and authorization |
| `packages/contracts`   | Versioned schemas and public data contracts          |
| `packages/game-engine` | Pure server-authoritative game transitions           |
| `packages/db`          | Memory/PostgreSQL repositories and migrations        |
| `packages/experience`  | Accessible, versioned Round experience definitions   |

Read [Architecture and protocol](docs/architecture.md) for state flows, trust boundaries, and
scaling constraints, or the [API and realtime reference](docs/api.md) for interfaces.

## Development

Host-native development requires Node.js 22 or newer and pnpm 10.15.1:

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm check
```

`pnpm check` runs formatting, Docker-context validation, linting, type checks, tests, and builds.
The host-native application also needs explicit development environment variables; use the
[native development recipe](docs/quick-start.md#optional-native-developer-mode) rather than copying
the Compose-oriented `.env.example` unchanged.

## Documentation

| Resource                                                                                | Purpose                                                    |
| --------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| [Quick start](docs/quick-start.md)                                                      | Run a local stack and complete a first Round               |
| [User guide](docs/user-guide.md)                                                        | Create, publish, host, join, report, export, and delete    |
| [Architecture](docs/architecture.md) and [API](docs/api.md)                             | Understand internals and integrate with public interfaces  |
| [Operations runbook](docs/runbooks/deployment.md)                                       | Build, restart, clean up, deploy, and roll back            |
| [Implementation status](docs/implementation-status.md)                                  | Separate implemented code from unmet evidence gates        |
| [Market research and staged plan](docs/market-research-and-development-plan-2026-09.md) | Review product evidence and roadmap gates                  |
| [Future product ideas](docs/future-product-ideas.md)                                    | Keep adding deferred customer enhancement ideas            |
| [Documentation index](docs/README.md)                                                   | Browse all product, operations, privacy, and decision docs |

## Contributing

Contributions are welcome when they preserve Polling Pops’ accessibility, privacy, clean-room, and
server-authoritative correctness boundaries. Read [CONTRIBUTING.md](CONTRIBUTING.md), open an
[issue](https://github.com/riojung/pollingpops/issues) for substantial changes, and run `pnpm check`
before submitting a pull request.

Polling Pops is an independent project. Do not contribute copied content, branding, code, sounds,
screenshots, or other expressive assets from another product; see [NOTICE](NOTICE).

## Security

Do not report vulnerabilities in public issues. Use
[GitHub private vulnerability reporting](https://github.com/riojung/pollingpops/security/advisories/new)
and review the [security policy](SECURITY.md) before deploying Polling Pops. The included policy pages,
credentials, and infrastructure settings are development defaults, not production approval.

## License

Polling Pops source and original bundled assets are licensed under the
[Apache License 2.0](LICENSE). Third-party dependencies and container images retain their own
licenses; see [third-party notices](THIRD_PARTY_NOTICES.md) and the
[asset register](docs/asset-register.md).
