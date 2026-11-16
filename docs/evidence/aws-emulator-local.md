# Local AWS staging qualification

Validated on November 15, 2026 (America/Edmonton), on the working branch
`codex/aws-emulator-staging`, based on `df3172b9dee90e22e6e032a07a43f97bea8de5f8`.
This is working-copy development evidence, not acceptance of a signed production release.

## Running environment

- AWS Emulator 1.0.385, built from checksum-pinned official RPMs; authentication on and telemetry off.
- Docker/Colima on Apple silicon, with separate `pollingpops-aws-staging` containers and network.
- Real production-mode server/web images, PostgreSQL and Valkey; ClamAV and Mailpit.
- PostgreSQL, Valkey, ClamAV and Caddy use the infrastructure image digests in the production profile.
- Application: `http://localhost:19180`; isolated captured email: `http://localhost:19182`.
- PostgreSQL/Valkey tmpfs and emulator in-memory S3 contain synthetic data only.

The existing `openround` development containers and volumes remained running throughout.

## Executed checks

`pnpm aws:staging build`, `start`, `verify`, and a stop/start/verify cycle ran against the real
Docker stack. The final verification also ran after selecting the production infrastructure pins.
The receipt is generated at `artifacts/aws-staging/qualification.json`; no credentials or captured
email are included in that artifact.

Verification covers application readiness and both embedded build IDs; image identity; signed
S3 put/head/get/copy/tag/delete operations; real email verification and PIN sign-in; Presentation
creation and readback; browser presigned upload with CORS; scanner finalization; private image
rendering; unauthorized application reads; deletion; and rejection of an unrelated CORS origin.

Actual browser qualification exposed three emulator compatibility gaps. The local gateway
preserves the signed host and port, terminates local CORS, omits two unsigned browser headers that
triggered signature failures, and mirrors signed metadata query values into storage metadata.
Ordinary SDK metadata headers are preserved. Authentication and upstream certificate verification
remain enabled. See the [distribution and fidelity notes](../../infra/aws-emulator/README.md).

The CloudFormation template passed `cfn-lint`. The AWS production Compose merge was validated
without MinIO credentials or services. Focused operator tests cover account/endpoint rejection,
infrastructure/runtime binding, signed-manifest routing, exact receipt/digest/platform binding,
expiry, legacy behavior, and promotion argument handling.

`VITEST_MAX_WORKERS=1 pnpm check` completed successfully: repository formatting, Docker context
checks, lint, type checks, application tests, all 47 operator/support test files, production builds,
and compiled-server startup/configuration checks. The support suite reported 507 passing tests
and one skipped test. Database integration cases that require separately supplied test URLs remain
skipped by the default suite. A preceding unbounded run hit timing limits in parallel operator
tests; the bounded full rerun passed without relaxing those assertions or deadlines.

## Acceptance boundary

Use the [AWS staging and production runbook](../runbooks/aws-staging-production.md) for the
reproducible commands. Local development receipts cannot promote unsigned images. A signed core
production manifest must be rehearsed separately and retain its exact image digests through
promotion. Optional business/control releases need their own qualification.

No real AWS resources were created and no production deployment was attempted. Real account,
network, domain, SSH trust, SMTP, observability, backups, load, restore and independent release
acceptance remain mandatory. Emulator success does not establish IAM enforcement, public AWS
network/TLS behavior, regional service availability, durability or production capacity.
