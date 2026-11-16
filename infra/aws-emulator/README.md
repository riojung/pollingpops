# AWS Emulator for local staging

This directory builds the official [AWS Emulator](https://github.com/aws/aws-emulator) Linux
package into a local container. Use the repository's
[AWS staging and production runbook](../../docs/runbooks/aws-staging-production.md) for the complete
build, rehearsal, evidence, and promotion sequence. It requires Docker Engine or Docker Desktop,
Compose v2.24.4 or newer, Node.js 22+, pnpm, and installed repository dependencies.
The verification browser check also needs the pinned Chromium binary (`pnpm exec playwright install chromium`).

The local stack runs the real application, PostgreSQL, Valkey, ClamAV, and Mailpit. The emulator
provides the S3 API used for synthetic media. It does not provision a VM, execute the application
through ECS, or establish production security or capacity. Nothing here installs an agent skill or
requires an AWS account.

The wrapper seeds synthetic rollout policy through the isolated PostgreSQL container to enable
the rehearsal workflows. The app keeps its normal email-verification and PIN sign-in path; this
local fixture and database are not copied into production.

## Commands and addresses

Run from the repository root:

```bash
pnpm aws:staging build
pnpm aws:staging start
pnpm aws:staging verify
pnpm aws:staging status
pnpm aws:staging logs
pnpm aws:staging stop
```

`build` writes `.deploy/aws-staging/candidate.json`; `start` requires it and does not build the app
automatically. Use `pnpm aws:staging start --manifest /absolute/path/to/build-manifest.json` to
rehearse an existing production candidate. Stop the current staging project first; `start` refuses
to replace it. Read the runbook before treating a candidate as promotable.

| Surface            | Address                   |
| ------------------ | ------------------------- |
| Application        | `http://localhost:19180`  |
| Browser S3 gateway | `http://localhost:19181`  |
| Captured email     | `http://localhost:19182`  |
| Emulator HTTPS API | `https://127.0.0.1:19297` |

Host ports bind to loopback. Open the application at **exactly** `http://localhost:19180`; the
gateway permits that browser origin. `http://127.0.0.1:19180` is a different origin. Keep only
synthetic data in this environment. PostgreSQL and Valkey use tmpfs, and the emulator holds S3
resources in memory. Stopping/recreating their containers loses that data. The ignored private
`.deploy/aws-staging/` files are runtime inputs, certificates, and credentials, not a persistent
database or S3 backup. The `pollingpops-aws-staging` Compose project is separate from ordinary
development and does not reuse its data volumes. Stopping retains the staging ClamAV
signature-cache volume.

## Pinned upstream distribution

AWS publishes Linux packages rather than a prebuilt container. The Dockerfile follows its
[documented container approach](https://docs.aws.amazon.com/emulator/latest/userguide/getting-started-docker.html)
and pins [release v1.0.385](https://github.com/aws/aws-emulator/releases/tag/v1.0.385), commit
`813af480bf7f16d5418b64e4f5644a74a7da11c5`. Both complete RPM downloads were hashed on
2026-11-15; Docker verifies their SHA-256 values before installation.

| Docker architecture | RPM                                                                                                                                       | SHA-256                                                            |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `arm64`             | [aws-emulator-1.0.385-1-aarch64.rpm](https://downloads.aws.com/aws-emulator/packages/aws-emulator/LTS/aws-emulator-1.0.385-1-aarch64.rpm) | `e2f01620e9f4e8c37c0ce7f32381fde3ffb7e8270331c8c23de2ec877b6a9043` |
| `amd64`             | [aws-emulator-1.0.385-1-x86_64.rpm](https://downloads.aws.com/aws-emulator/packages/aws-emulator/LTS/aws-emulator-1.0.385-1-x86_64.rpm)   | `2b2b5031e559d74c7a4154b11056be3a57716a177cd796cf058eebd91a6870d7` |

The Amazon Linux 2023 minimal base is pinned to manifest digest
`sha256:158a9044f9dc0777f098b76c8b54346f6ed4560b9a6a416dec7a5ba3bc483af4`.
The RPM version index uses `1.0.385.1`; the distributed filenames above use `1.0.385-1`.
AWS also publishes detached `.sig` files and
[package-signature verification instructions](https://docs.aws.amazon.com/emulator/latest/userguide/getting-started-linux.html).
Review and test newer releases deliberately; AWS supplies security fixes only in its latest release.

## TLS, authentication, and browser CORS

The emulator runs with authentication on and telemetry off. Every run generates fresh credentials
and a certificate. The certificate covers `localhost`, `127.0.0.1`, and `::1`, as shown in the
[pinned certificate implementation](https://github.com/aws/aws-emulator/blob/v1.0.385/vendor/server/src/tls_certificate_authority.rs#L38).
It does not cover the Docker service name `aws-emulator`. The Caddy gateway validates the upstream
certificate against the shared CA file with TLS server name `localhost`; it preserves the signed
HTTP Host **including its port** (`localhost:19181` for browser media). Dropping the port changes
the canonical signed request. Do not replace that configuration with disabled certificate validation.

The gateway supplies browser CORS headers for the exact local application origin and handles
OPTIONS requests. This is a local compatibility workaround: the pinned release's
[fidelity results](https://github.com/aws/aws-emulator/releases/download/v1.0.385/scores.json.gz)
fail S3 preflight and presigned-origin response-header checks even though bucket CORS configuration
round trips pass. A direct local reproduction also found that the same presigned PUT, body, and
signed headers succeeded without `Origin` but failed with `SignatureDoesNotMatch` when only
`Origin: http://localhost:19180` was added. `Origin` was not in `X-Amz-SignedHeaders`.
An independent `Sec-Fetch-Site: same-site` differential reproduced the same failure. The gateway
therefore owns local CORS and removes both unsigned browser headers before forwarding.
The pinned S3 handler also drops metadata hoisted into a presigned query; the gateway mirrors the
app's three signed `x-amz-meta-*` query values into metadata headers only when that query is present.
Ordinary SDK requests retain their original metadata headers. The browser test covers scanner
finalization, which rejects an upload when its metadata is missing or incorrect.
Authentication stays on, the application presigner is unchanged, and the signed
Host and content length remain intact. The observed failure does not establish which internal
emulator canonicalization step is responsible.

The gateway's headers do not demonstrate AWS bucket CORS policy enforcement. Production uses AWS
S3 HTTPS and the reviewed bucket CORS configuration, with no local gateway.

For direct host-side AWS CLI access, use the generated CA and credentials following the
[official SDK setup](https://docs.aws.amazon.com/emulator/latest/userguide/point-sdk-to-emulator.html).
Do not supply real AWS credentials. A direct API call should report account `000000000000` through
STS. Direct Node.js HTTPS clients additionally need `NODE_EXTRA_CA_CERTS`; browsers do not read
that environment variable. Prefer the wrapper's health and verification commands for this stack.

## Fidelity and license boundary

The emulator keeps resources in memory, is intended for bounded tests, and does not establish IAM,
network, hardware, load, recovery, or availability behavior on AWS. Its RDS SQL emulation is backed
by SQLite; its ElastiCache implementation supports a bounded RESP subset; ECS interprets a fixed
catalog of shell utilities without an image filesystem or application networking. The real local
PostgreSQL, Valkey, and app containers are required for this rehearsal. SQS, SES, Secrets Manager,
ECR, ECS, RDS, ElastiCache, and CloudFormation are not qualified application dependencies merely
because the emulator exposes their APIs. See
[AWS fidelity guidance](https://docs.aws.amazon.com/emulator/latest/userguide/fidelity.html) and
[security limitations](https://docs.aws.amazon.com/emulator/latest/userguide/security.html).

The emulator source is [CC0-1.0](https://github.com/aws/aws-emulator/blob/v1.0.385/LICENSE), with
vendored framework code under
[Apache-2.0](https://github.com/aws/aws-emulator/blob/v1.0.385/vendor/LICENSE). Amazon Linux and
the other containers retain their component licenses. See
[third-party notices](../../THIRD_PARTY_NOTICES.md).
