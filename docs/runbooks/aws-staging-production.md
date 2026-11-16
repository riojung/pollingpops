# Local AWS staging and production promotion

See the [local working-copy validation record](../evidence/aws-emulator-local.md) for the executed
checks and their acceptance limits.

Use the disposable local AWS staging stack to exercise a candidate before deploying its exact
images to AWS. The local stack runs Polling Pops, PostgreSQL, Valkey, ClamAV, and Mailpit in Docker;
the official AWS Emulator supplies S3 for synthetic media. Production uses a real EC2 VM, EBS, and
private AWS S3. The repository provides the commands and infrastructure definition; account,
domain, network, credentials, and independent release acceptance are operator inputs. No AWS
provisioning or production deployment is established by this runbook.

Local verification is one piece of candidate evidence. It does not complete the hosted staging or
production readiness gates. In particular, it cannot qualify IAM policies, cloud networking,
instance hardware, load, public TLS, real email delivery, backups, or recovery on AWS. Retain the
[hosted staging readiness workflow](staging-readiness.md),
[production checklist](production-readiness.md), and
[release-readiness ledger](../release-readiness.json).

## 1. Start the isolated local stack

Install Node.js 22+, pnpm, repository dependencies, and a working Docker daemon with Compose
v2.24.4 or newer. The emulator uses a checksum-pinned Linux RPM inside a Docker image on macOS as
well as Linux; there is no native macOS installation or agent-skill installation step. See the
[emulator implementation notes](../../infra/aws-emulator/README.md) for versions, licensing, and
compatibility workarounds.

The verification command includes a Chromium browser test. Install the repository-pinned
Playwright browser once if it is not already available:

```bash
pnpm exec playwright install chromium
```

From the repository root:

```bash
pnpm aws:staging build
pnpm aws:staging start
pnpm aws:staging verify
pnpm aws:staging status
pnpm aws:staging logs
```

`build` prepares local images and writes their IDs to `.deploy/aws-staging/candidate.json`,
including the Git commit and whether the checkout is dirty. `start` requires that candidate or
an explicit `--manifest`; it does not automatically build the application. It launches the
dedicated `pollingpops-aws-staging` Compose project and refuses to replace an existing run. Use
`verify`/`status` for that run or `stop` before starting a fresh one. Use these browser addresses:

| Surface                                         | Address                   |
| ----------------------------------------------- | ------------------------- |
| Polling Pops                                    | `http://localhost:19180`  |
| S3 gateway                                      | `http://localhost:19181`  |
| Captured email                                  | `http://localhost:19182`  |
| Emulator API and health, using its generated CA | `https://127.0.0.1:19297` |

Keep `localhost` in the browser URLs: the S3 gateway permits the exact application origin
`http://localhost:19180`. Using `127.0.0.1` in the browser changes that origin. All published ports
are host-loopback only. Billing, external authoring AI, OIDC, and LTI remain disabled in this local
profile. Mailpit captures verification links and sign-in PINs; it does not prove delivery through
the production mail provider.

Startup seeds a synthetic feature policy directly through `psql` in the isolated PostgreSQL
container so the rehearsal can exercise Presentations, Groups, and the other enabled workflows.
Users still follow normal email verification and PIN sign-in. That seed is local fixture setup;
neither it nor the disposable database is promoted to production.

The private ignored `.deploy/aws-staging/` directory contains local credentials, generated TLS
material, and runtime state needed by the wrapper. Do not commit or archive it with evidence.
PostgreSQL and Valkey use tmpfs, and S3 state is held in emulator memory. Only synthetic test data
belongs here. A stop/recreation loses application records, cache state, captured mail, and media;
the wrapper bootstraps a new environment on the next start. Existing development containers and
their named data volumes are separate. The staging ClamAV signature-cache volume is retained.

```bash
pnpm aws:staging stop
```

The emulator authenticates requests with fresh local credentials and uses HTTPS internally. Its
certificate covers `localhost`, not the Docker service name, so the gateway verifies the shared
CA with TLS server name `localhost` and preserves the signed HTTP Host **including the port**.
Its local HTTP endpoint owns CORS because this emulator release has known S3 preflight/header
gaps. Local reproductions found that unsigned `Origin` and `Sec-Fetch-Site` browser headers could
turn a successful presigned PUT into `SignatureDoesNotMatch`; the gateway removes those headers.
It also mirrors the app's signed metadata query values into metadata headers because this release
otherwise drops them from uploaded objects. Ordinary SDK metadata headers remain unchanged.
The application presigner, signed headers, and emulator authentication stay intact.
This workaround is not evidence that production bucket CORS or authorization is correct. See
the [observed compatibility gaps](../../infra/aws-emulator/README.md#tls-authentication-and-browser-cors).

## 2. Verify the candidate and retain its identity

`pnpm aws:staging verify` requires the running state created by `start`. It writes
`artifacts/aws-staging/qualification.json` only after application health, embedded build IDs and
image identity, the S3 object contract, and the browser media round trip all pass.
Retain that redacted evidence with the candidate inputs. A release receipt binds the exact
manifest hash and server/web image digests; a development receipt records local image IDs and
checkout state. Inspect the result and the running build
markers before using it in a release review. A local build's receipt is useful development
evidence; it does not turn unsigned local images into an accepted release.

For an existing release candidate, obtain the complete protected-build manifest and make its
digest-selected images available to Docker, then rehearse that manifest:

```bash
pnpm aws:staging stop
pnpm aws:staging start --manifest artifacts/deploy/production/build-manifest.json
pnpm aws:staging verify
```

The hosted build uses `apiRouting: "same-origin"` with equal public web/API origins. Browser calls
then follow the current application origin, allowing the exact hosted web image to run locally
without rebuilding it for a loopback URL. The manifest records that routing mode; deployment
still validates it against the reviewed hosted configuration. Do not edit a downloaded manifest,
replace digest references with tags, or mix images from different candidates. Reverify after
changing images or the manifest. Promotion accepts only a release-kind receipt matching the exact
manifest and both image digests, completed within the previous seven days. Manifest validation at
local startup checks release metadata and signing requirements; actual signature verification
still occurs in the production deployment path.

This profile qualifies core server/web releases. It rejects a manifest containing the optional
business control application, which requires its separate protected qualification flow.

The local qualification checks only what its successful receipt records. Review enabled product
flows in the browser as appropriate, including signup, email verification, separate PIN sign-in,
Round/Presentation participation, and scanner-backed media. It does not replace the target-host
load generator, public-provider observers, clean-host restore drill, or independent review.
The emulator's RDS implementation uses SQLite and its ECS implementation cannot run this app's
images; the real local PostgreSQL, Valkey, and application containers remain part of the test.

## 3. Prepare the real AWS foundation

The production foundation is `infra/aws/production.template.json`. It creates one x86_64 EC2 VM,
an Elastic IP, a retained encrypted EBS root volume, a private encrypted/versioned S3 media bucket,
and an instance role scoped to application media. PostgreSQL, Valkey, and the application run on
that VM; production live media goes to AWS S3. The AWS Compose overlay disables the MinIO
services. This is a single failure domain with no automatic failover or availability commitment.

Supply an existing VPC, a public subnet with an internet-gateway route, an EC2 key pair, one operator
or VPN IPv4 `/32` for SSH, a real application DNS name, a unique media bucket name, and the intended
AWS account/region. Use a dedicated AWS CLI profile authenticated to that account. The helper
rejects endpoint overrides and checks real STS identity before touching infrastructure.

```bash
cp infra/aws/production.example.json infra/aws/production.json
```

Replace every example value in `infra/aws/production.json`. This is a tracked, reviewed account
and infrastructure configuration, not a secret file: keep credentials and secret values out of
it. Review and commit it before applying the foundation. Production deployment requires the
`--aws-config` file to be inside the repository, tracked, and clean in Git; an ignored artifact
copy cannot satisfy that requirement. `plan` validates and describes the intended foundation
without creating it:

```bash
pnpm aws:production plan --config infra/aws/production.json
```

After reviewing the account, region, template, network, resources, costs, and retention behavior,
an operator can explicitly create the stack:

```bash
pnpm aws:production provision \
  --config infra/aws/production.json \
  --confirm ACTUAL_ACCOUNT_ID:ACTUAL_STACK_NAME
pnpm aws:production verify --config infra/aws/production.json
```

`provision` is create-only; it does not silently update an existing stack. `verify` checks the
deployed template and live resources against the config. Neither command deploys application
images or completes release readiness. Retained EC2/EBS/S3 resources require an explicit recovery
or cleanup plan: replacing an instance does not automatically attach and restore its old data.
Bucket versioning and same-account media storage do not satisfy separately administered,
encrypted off-host PostgreSQL backups or a tested recovery plan. Review the bucket's one-day
quarantine, seven-day temporary-media, and 30-day noncurrent-version retention against policy.

## 4. Bind the hosted target and release inputs

Use the verified outputs (`PublicIp`, `InstanceId`, `MediaBucket`, `S3Endpoint`, `ApplicationUrl`,
`DeploymentUser`, and `DeploymentPath`) to configure `config/deploy/production.json` before
building the protected release. The SSH host must resolve only to the Elastic IP. Point the
application domain at that IP and independently verify its SSH host key; place the exact host/port
entry in the checked-in known-hosts file. A key obtained only from an unauthenticated network scan
is not an independently verified pin.

The checked-in default production target remains a placeholder until these actual account and
domain inputs are available. Review and commit its real values and SSH pin before the protected
release build; do not weaken the placeholder or clean-input checks to run the examples unchanged.

Keep the existing signing, GitHub identity, readiness, and target settings. Set equal HTTPS
`publicWebUrl`/`publicApiUrl`, `apiRouting: "same-origin"`, and `publicMediaUrl` to the regional
`S3Endpoint`. Append `compose.aws-production.yaml` after `compose.single-vm.yaml` and
`compose.single-vm.observability.yaml`, and include `infra/aws/Caddyfile` in `deploymentFiles`.
The generated host uses deployment user `openround` and `/opt/pollingpops/production`.
Its bootstrap installs Docker and checksum-pinned Compose, prepares that user from the selected
EC2 key pair, disables password/root SSH login, and signals CloudFormation readiness. Authorize
the deployment user to pull the protected registry images through the approved credential route;
keep registry tokens outside source, runtime evidence, and command logs.

```bash
pnpm aws:production verify \
  --config infra/aws/production.json \
  --deploy-config config/deploy/production.json
node scripts/check-deployment-target.mjs production
```

Prepare private runtime and migration files following the
[deployment runbook](deployment.md#runtime-and-migration-environment-files). Use separate database
principals and production secrets. The AWS runtime S3 settings are:

```dotenv
S3_ENDPOINT=https://s3.ACTUAL_REGION.amazonaws.com
S3_PUBLIC_ENDPOINT=https://s3.ACTUAL_REGION.amazonaws.com
S3_REGION=ACTUAL_REGION
S3_BUCKET=ACTUAL_MEDIA_BUCKET
S3_FORCE_PATH_STYLE=false
```

Leave `S3_ACCESS_KEY_ID` and `S3_SECRET_ACCESS_KEY` unset/empty so the SDK uses the EC2 instance
profile; do not copy local emulator credentials. Protect runtime/migration files with mode `0600`.
Configure real SMTP, telemetry, alerting, TLS, backups, and recovery inputs separately. The local
profile's insecure HTTP and synthetic configuration do not carry into production.

## 5. Promote the exact qualified release

Produce and independently accept the protected production release using the existing
[release controls](repository-governance.md#release-controls), then run the exact manifest through
local staging and retain its qualification receipt. Complete every other required readiness gate
against the real hosted target. The first production deployment still requires the accepted draft
release; published-release redeploy rules are unchanged.

The AWS promotion wrapper supplies the local receipt, exact manifest, and reviewed account config
to the existing deployment path. That core deployer requires a matching local receipt for every
forward deployment using the AWS overlay, including direct `deploy.sh production` invocations;
using the lower-level command cannot skip this gate. It also requires the tracked, Git-clean AWS
config and verifies the real account and foundation before a live deployment.

```bash
pnpm aws:promote \
  --aws-config infra/aws/production.json \
  --receipt artifacts/aws-staging/qualification.json \
  --manifest artifacts/deploy/production/build-manifest.json \
  --config config/deploy/production.json \
  --runtime-env artifacts/deploy/production/runtime.env \
  --migration-env artifacts/deploy/production/migration.env \
  --ssh-identity /absolute/path/to/production-key \
  --backup-reference REVIEWED_OFF_HOST_RECOVERY_REFERENCE \
  --confirm production:FULL_BUILD_ID \
  --dry-run
```

The dry run validates the receipt and deployment inputs and reports that live AWS foundation
verification will run at deployment; it does not query or qualify the live foundation. Use the
explicit `aws:production verify` step above for that read-only check. Review the dry run,
candidate evidence, and real hosted prerequisites before repeating the command without
`--dry-run`. The wrapper does not bypass signature verification, exact Git/tag and
release-asset binding, readiness acceptance, strict SSH pins, configuration checks, migration
controls, backups, or build-marker checks. It does not convert a local development candidate into
a protected production release.

For later upgrades, reuse the reviewed AWS and deployment configs, update only independently
reviewed inputs, rehearse the new exact manifest, obtain a fresh receipt, and use the same
promotion command. Keep schema-compatible rollback and forward-repair plans from the
[upgrade runbook](upgrade.md). When redeploying an already published release, supply the existing
`--published-release-redeploy`, `--prior-deployment-receipt`, and
`--prior-deployment-receipt-sha256` flags together as documented in
[deployment](deployment.md#deploy-an-environment). A local qualification receipt and a successful
production deployment receipt are different artifacts. `aws:promote` supports forward deployment
only. For an approved schema-compatible rollback, use the existing explicit rollback contract with
`--aws-config infra/aws/production.json`; the AWS account/foundation checks still run, while a new
local forward-qualification receipt and migration environment are not required.
