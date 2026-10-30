import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  readlink,
  rm,
  symlink,
  utimes,
  writeFile,
} from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  HOSTED_DEPLOYMENT_AUTOMATION_FILES,
  REMOTE_CONFIG_SUMMARY_SCRIPT,
  REMOTE_CURRENT_BUILD_SCRIPT,
  REMOTE_DEACTIVATE_FAILED_CURRENT_SCRIPT,
  REMOTE_DEPLOY_SCRIPT,
  REMOTE_PREPARE_SCRIPT,
  REMOTE_REMOVE_INCOMING_SCRIPT,
  REMOTE_RESTORE_PREVIOUS_SCRIPT,
  REMOTE_WRITE_SCRIPT,
  assertConfigCheckSummary,
  assertProductionReleaseRevision,
  assertRemoteRollbackSource,
  assertRemoteTargetNotActive,
  fetchAcceptedGithubRelease,
  fetchPublishedReleaseAsset,
  fetchPublishedReleaseTagObject,
  main as deployMain,
  resolveReviewedDeploymentInputHashes,
  runtimeEnvironmentSha256,
  validateReceiptConfigCheckSummary,
  validateSingleVmRuntimeValues,
  verifyForwardDeploymentAncestry,
  verifySignatures,
} from "../../scripts/ops/deploy.mjs";
import {
  assertConfiguredHostedTarget,
  assertKnownHostsTarget,
  assertNoEnvironmentKeyOverlap,
  assertSupportedCosignVersion,
  composeArgv,
  expectedDeploymentConfirmation,
  expectedProductionConfirmation,
  expectedRollbackConfirmation,
  normalizeEnvironment,
  parseCliArguments,
  parseFlyTomlEnvironment,
  resolveCheckedRepositoryFile,
  run,
  sshArgv,
  validateBuildManifest,
  validateDeployConfig,
  validateDeploymentConfirmation,
  validateEnvFileKeys,
  validateFlyRuntimeEnvironment,
  validateFlyWebEnvironment,
  validateProductionConfirmation,
  validateRollbackConfirmation,
  validateSingleVmConfig,
} from "../../scripts/ops/lib.mjs";
import { main as productBuildMain, withPreservedFiles } from "../../scripts/ops/product-build.mjs";
import {
  requiredReleaseAssetNames,
  validateReleaseBinding,
  validateReleaseTag,
} from "../../scripts/ops/release-acceptance.mjs";
import { REMOTE_SERVICE_SCRIPT, main as serviceMain } from "../../scripts/ops/service.mjs";
import { ConfigSchema } from "../../apps/server/src/config.js";
import { createConfigCheckSummary } from "../../apps/server/src/config-check-summary.js";

const repositoryRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const buildId = "a".repeat(40);
const serverDigest = `sha256:${"b".repeat(64)}`;
const webDigest = `sha256:${"c".repeat(64)}`;
const stagingTarget = Object.freeze({
  appHost: "staging.test.openround.ca",
  mediaHost: "media-staging.test.openround.ca",
  sshHost: "staging-vm.test.openround.ca",
});
const productionTarget = Object.freeze({
  appHost: "app.test.openround.ca",
  mediaHost: "media.test.openround.ca",
  sshHost: "production-vm.test.openround.ca",
});
const operationalStagingCheckoutFiles = Object.freeze([
  ".gitignore",
  ...HOSTED_DEPLOYMENT_AUTOMATION_FILES,
  "scripts/check-release-readiness.mjs",
  "docs/release-readiness.json",
  "config/deploy/staging.json",
  "config/deploy/ssh/staging_known_hosts",
  "compose.single-vm.yaml",
  "compose.single-vm.observability.yaml",
  "infra/single-vm/Caddyfile",
  "infra/single-vm/postgres-init.sh",
  "infra/observability/alerts.yml",
  "infra/observability/alertmanager.single-vm.yml",
  "infra/observability/otel-collector.single-vm.yml",
  "infra/observability/prometheus.single-vm.yml",
]);

function stagingConfig() {
  return {
    schemaVersion: 1,
    environment: "staging",
    deploymentMode: "fly",
    publicWebUrl: "https://staging.example.test",
    publicApiUrl: "https://api.staging.example.test",
    imageRepository: "ghcr.io/example/openround",
    imagePlatform: "linux/amd64",
    billingMode: "disabled",
    fly: {
      serverApp: "openround-staging-server",
      webApp: "openround-staging-web",
      serverConfig: "config/deploy/fly/staging-server.toml",
      webConfig: "config/deploy/fly/staging-web.toml",
    },
    health: {
      timeoutSeconds: 300,
      intervalSeconds: 5,
      requestTimeoutSeconds: 8,
    },
    requireSigning: false,
    requireReadinessGate: false,
  };
}

function productionConfig() {
  return {
    ...stagingConfig(),
    environment: "production",
    publicWebUrl: "https://example.test",
    publicApiUrl: "https://api.example.test",
    billingMode: "stripe",
    fly: {
      serverApp: "openround-production-server",
      webApp: "openround-production-web",
      serverConfig: "config/deploy/fly/production-server.toml",
      webConfig: "config/deploy/fly/production-web.toml",
    },
    requireSigning: true,
    requireReadinessGate: true,
    readinessTarget: "canadian-beta",
    cosignIdentityRegexp: "^https://github\\.com/example/openround/.*$",
    cosignOidcIssuer: "https://token.actions.githubusercontent.com",
  };
}

function singleVmConfig(environment: "staging" | "production" = "staging") {
  const production = environment === "production";
  const target = production ? productionTarget : stagingTarget;
  return {
    schemaVersion: 1,
    environment,
    deploymentMode: "single-vm",
    publicWebUrl: `https://${target.appHost}`,
    publicApiUrl: `https://${target.appHost}`,
    publicMediaUrl: `https://${target.mediaHost}`,
    imageRepository: "ghcr.io/riojung/openround/openround",
    imagePlatform: "linux/amd64",
    billingMode: production ? "stripe" : "disabled",
    singleVm: {
      host: target.sshHost,
      port: 22,
      user: "openround",
      deployPath: production ? "/opt/pollingpops/production" : "/opt/pollingpops/staging",
      composeFiles: ["compose.single-vm.yaml", "compose.single-vm.observability.yaml"],
      deploymentFiles: [
        "infra/single-vm/Caddyfile",
        "infra/single-vm/postgres-init.sh",
        "infra/observability/alerts.yml",
        "infra/observability/alertmanager.single-vm.yml",
        "infra/observability/otel-collector.single-vm.yml",
        "infra/observability/prometheus.single-vm.yml",
      ],
      knownHostsFile: production
        ? "config/deploy/ssh/production_known_hosts"
        : "config/deploy/ssh/staging_known_hosts",
      projectName: production ? "openround-production" : "openround-staging",
    },
    health: {
      timeoutSeconds: production ? 420 : 300,
      intervalSeconds: 5,
      requestTimeoutSeconds: 8,
    },
    requireSigning: true,
    requireReadinessGate: production,
    ...(production ? { readinessTarget: "single-vm-beta" } : {}),
    cosignIdentityRegexp: production
      ? "^https://github\\.com/example/openround/.*$"
      : "^https://github\\.com/example/openround/.github/workflows/staging-images\\.yml@refs/heads/main$",
    cosignOidcIssuer: "https://token.actions.githubusercontent.com",
  };
}

function singleVmRuntimeEnvironment(environment: "staging" | "production" = "staging") {
  const target = environment === "production" ? productionTarget : stagingTarget;
  return [
    `OPENROUND_DEPLOYMENT_ENVIRONMENT=${environment}`,
    `OPENROUND_APP_DOMAIN=${target.appHost}`,
    `OPENROUND_MEDIA_DOMAIN=${target.mediaHost}`,
    "OPENROUND_ACME_EMAIL=ops@pollingpops.example",
    "OPENROUND_SERVER_INGRESS_SUBNET=172.30.255.0/29",
    "OPENROUND_CADDY_PROXY_IP=172.30.255.2",
    "POSTGRES_OWNER_PASSWORD=owner-secret",
    "POSTGRES_APP_PASSWORD=app-secret",
    "DATABASE_URL=postgresql://openround_app:app-secret@postgres:5432/openround",
    "VALKEY_PASSWORD=valkey-secret",
    "REDIS_URL=redis://:valkey-secret@valkey:6379",
    "MINIO_ROOT_USER=openround-root",
    "MINIO_ROOT_PASSWORD=minio-root-secret",
    "MINIO_APP_ACCESS_KEY=openround-app",
    "MINIO_APP_SECRET_KEY=minio-app-secret",
    "SMTP_URL=smtps://mailer:mail-secret@smtp.example.com:465",
    "EMAIL_FROM=Polling Pops <noreply@example.com>",
    "METRICS_ENABLED=true",
    "METRICS_TOKEN=metrics-token-with-at-least-24-characters",
    "OPENROUND_LOG_SHIPPING_MODE=external-host-agent",
    "TRACING_ENABLED=true",
    "OTEL_EXPORTER_OTLP_TRACES_ENDPOINT=http://otel-collector:4318/v1/traces",
    "OPENROUND_OTLP_BACKEND_ENDPOINT=https://telemetry.test.openround.ca",
    "OPENROUND_OTLP_BACKEND_TOKEN=backend-token-with-at-least-24-characters",
    "OPENROUND_PAGING_WEBHOOK_URL=https://paging.test.openround.ca/openround",
    "OPENROUND_WARNING_WEBHOOK_URL=https://warnings.test.openround.ca/openround",
    "OPENROUND_TICKET_WEBHOOK_URL=https://tickets.test.openround.ca/openround",
    "ADMIN_TOKEN=admin-token-with-at-least-24-characters",
    `BILLING_MODE=${environment === "production" ? "stripe" : "disabled"}`,
    "COMMUNITY_MODE=false",
    "NODE_ENV=production",
    "COOKIE_SECURE=true",
    "ALLOW_IN_MEMORY=false",
    "RUN_MIGRATIONS=false",
    "",
  ].join("\n");
}

function receiptConfigCheckSummary(config = singleVmConfig(), receiptBuildId = buildId) {
  return {
    valid: true,
    buildId: receiptBuildId,
    nodeEnvironment: "production",
    publicApiUrl: config.publicApiUrl,
    webOrigin: config.publicWebUrl,
    communityMode: false,
    persistence: "postgresql",
    coordination: "redis-streams",
    email: "smtp",
    developmentEmailInbox: "disabled",
    billing: config.billingMode,
    media: "clamav",
    metrics: "protected",
    logs: "external-host-agent",
    tracing: "otlp",
    participantLimit: 250,
    practicePersonalLinkLimit: 100,
    presentationResponseWrites: "rollback-compatible",
    featureFlags: {
      signups: true,
      sessionCreation: true,
      mediaUploads: true,
      roundExperiences: true,
      audiencePulse: true,
      roomChat: true,
      uxBeta: false,
      recoveryRehearsal: false,
      practiceAssignments: false,
      workspaceShell: false,
      builderV2: false,
      presentations: false,
      groups: false,
      discover: false,
      presentationRealtime: false,
      recoveryPacks: false,
      questionHealth: false,
      decisionReplay: false,
      recoveryTrails: false,
      conceptHealth: false,
      extendedQuestionTypes: false,
      verifiedInstitution: false,
    },
    themedInteractionsWorkspaceAllowlistSize: 0,
    uxBetaWorkspaceAllowlistSize: 0,
    evidenceFeaturesWorkspaceAllowlistSize: 0,
  };
}

function buildManifest(environment = "staging", manifestBuildId = buildId) {
  const repository = "ghcr.io/riojung/openround/openround";
  return {
    schemaVersion: 1,
    environment,
    buildId: manifestBuildId,
    createdAt: "2026-09-21T00:00:00.000Z",
    nextPublicApiUrl:
      environment === "production"
        ? `https://${productionTarget.appHost}`
        : `https://${stagingTarget.appHost}`,
    imagePlatform: "linux/amd64",
    source: { commit: manifestBuildId, dirty: false },
    images: {
      server: {
        repository: `${repository}-server`,
        tag: `${repository}-server:${environment}-${manifestBuildId}`,
        digest: serverDigest,
        ref: `${repository}-server@${serverDigest}`,
        signed: true,
      },
      web: {
        repository: `${repository}-web`,
        tag: `${repository}-web:${environment}-${manifestBuildId}`,
        digest: webDigest,
        ref: `${repository}-web@${webDigest}`,
        signed: true,
      },
    },
  };
}

function releaseBindingFixture() {
  const tag = "v0.9.0";
  const manifestDigest = `sha256:${"d".repeat(64)}`;
  return {
    schemaVersion: 2,
    tag,
    tagObject: "e".repeat(40),
    buildId,
    githubRelease: {
      id: 123_456_789,
      apiUrl: "https://api.github.com/repos/riojung/pollingpops/releases/123456789",
      htmlUrl: "https://github.com/riojung/pollingpops/releases/tag/v0.9.0",
      targetCommitish: buildId,
      draft: true,
      createdAt: "2026-09-26T12:00:00Z",
    },
    manifestDigest,
    imageDigests: { server: serverDigest, web: webDigest },
    assets: requiredReleaseAssetNames(tag).map((name, index) => {
      const id = 800_000 + index;
      return {
        id,
        name,
        size: 100 + index,
        digest: name === `openround-${tag}-manifest.json` ? manifestDigest : serverDigest,
        apiUrl: `https://api.github.com/repos/riojung/pollingpops/releases/assets/${id}`,
        downloadUrl: `https://github.com/riojung/pollingpops/releases/download/${tag}/${name}`,
      };
    }),
  };
}

async function captureStdout(operation: () => Promise<void>) {
  let output = "";
  const write = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    output += String(chunk);
    return true;
  });
  try {
    await operation();
    return output;
  } finally {
    write.mockRestore();
  }
}

async function withReviewedDeploymentGitState<T>(
  callback: (revisions: { head: string; parent: string }) => Promise<T>,
) {
  const artifactsRoot = join(repositoryRoot, "artifacts");
  await mkdir(artifactsRoot, { recursive: true });
  const fixtureRoot = await mkdtemp(join(artifactsRoot, "reviewed deployment git state "));
  const previousGitDirectory = process.env.GIT_DIR;
  const previousGitWorkTree = process.env.GIT_WORK_TREE;
  try {
    await run("git", ["init", "--quiet"], { cwd: fixtureRoot, capture: true });
    await run("git", ["config", "user.name", "Polling Pops Test"], {
      cwd: fixtureRoot,
      capture: true,
    });
    await run("git", ["config", "user.email", "test@example.invalid"], {
      cwd: fixtureRoot,
      capture: true,
    });
    process.env.GIT_DIR = join(fixtureRoot, ".git");
    process.env.GIT_WORK_TREE = repositoryRoot;
    await run(
      "git",
      [
        "add",
        "--",
        ".gitignore",
        "scripts/deploy.sh",
        "scripts/ops/deploy.mjs",
        "scripts/ops/lib.mjs",
        "scripts/ops/release-acceptance.mjs",
        "scripts/ops/service.mjs",
        "scripts/check-release-readiness.mjs",
        "docs/release-readiness.json",
        "config/deploy/staging.json",
        "config/deploy/production.json",
        "config/deploy/ssh/staging_known_hosts",
        "config/deploy/ssh/production_known_hosts",
        "compose.single-vm.yaml",
        "infra/single-vm/Caddyfile",
        "infra/single-vm/postgres-init.sh",
      ],
      { cwd: repositoryRoot, capture: true },
    );
    await run("git", ["commit", "--quiet", "--no-gpg-sign", "--message", "reviewed inputs"], {
      cwd: repositoryRoot,
      capture: true,
    });
    const parent = (
      await run("git", ["rev-parse", "HEAD"], { cwd: repositoryRoot, capture: true })
    ).stdout.trim();
    await run(
      "git",
      ["commit", "--quiet", "--allow-empty", "--no-gpg-sign", "--message", "release source"],
      { cwd: repositoryRoot, capture: true },
    );
    const head = (
      await run("git", ["rev-parse", "HEAD"], { cwd: repositoryRoot, capture: true })
    ).stdout.trim();
    return await callback({ head, parent });
  } finally {
    if (previousGitDirectory === undefined) delete process.env.GIT_DIR;
    else process.env.GIT_DIR = previousGitDirectory;
    if (previousGitWorkTree === undefined) delete process.env.GIT_WORK_TREE;
    else process.env.GIT_WORK_TREE = previousGitWorkTree;
    await rm(fixtureRoot, { recursive: true, force: true });
  }
}

async function withOperationalStagingGitState<T>(
  callback: (fixture: {
    root: string;
    head: string;
    parent: string;
    deployMain: typeof deployMain;
    serviceMain: typeof serviceMain;
  }) => Promise<T>,
) {
  const artifactsRoot = join(repositoryRoot, "artifacts");
  await mkdir(artifactsRoot, { recursive: true });
  const fixtureRoot = await mkdtemp(join(artifactsRoot, "operational staging checkout "));
  const checkoutRoot = join(fixtureRoot, "checkout");
  try {
    await mkdir(checkoutRoot, { recursive: true });
    await run("git", ["init", "--quiet"], { cwd: checkoutRoot, capture: true });
    await run("git", ["config", "user.name", "Polling Pops Test"], {
      cwd: checkoutRoot,
      capture: true,
    });
    await run("git", ["config", "user.email", "test@example.invalid"], {
      cwd: checkoutRoot,
      capture: true,
    });
    await Promise.all(
      operationalStagingCheckoutFiles.map(async (path) => {
        const destination = join(checkoutRoot, path);
        await mkdir(dirname(destination), { recursive: true });
        await copyFile(join(repositoryRoot, path), destination);
      }),
    );

    const keyPath = join(fixtureRoot, "host-key");
    await run("ssh-keygen", ["-q", "-t", "ed25519", "-N", "", "-f", keyPath], {
      capture: true,
    });
    const publicKey = (await readFile(`${keyPath}.pub`, "utf8"))
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .join(" ");
    const configPath = join(checkoutRoot, "config/deploy/staging.json");
    const knownHostsPath = join(checkoutRoot, "config/deploy/ssh/staging_known_hosts");
    const config = JSON.parse(await readFile(configPath, "utf8"));
    config.publicWebUrl = `https://${stagingTarget.appHost}`;
    config.publicApiUrl = `https://${stagingTarget.appHost}`;
    config.publicMediaUrl = `https://${stagingTarget.mediaHost}`;
    config.singleVm.host = stagingTarget.sshHost;
    await Promise.all([
      writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`),
      writeFile(knownHostsPath, `${stagingTarget.sshHost} ${publicKey}\n`),
    ]);
    await run("git", ["add", "--all"], { cwd: checkoutRoot, capture: true });
    await run(
      "git",
      ["commit", "--quiet", "--no-gpg-sign", "--message", "reviewed operational fixture"],
      { cwd: checkoutRoot, capture: true },
    );
    const parent = (
      await run("git", ["rev-parse", "HEAD"], { cwd: checkoutRoot, capture: true })
    ).stdout.trim();
    await run(
      "git",
      ["commit", "--quiet", "--allow-empty", "--no-gpg-sign", "--message", "release source"],
      { cwd: checkoutRoot, capture: true },
    );
    const head = (
      await run("git", ["rev-parse", "HEAD"], { cwd: checkoutRoot, capture: true })
    ).stdout.trim();
    const isolatedDeployModule = (await import(
      pathToFileURL(join(checkoutRoot, "scripts/ops/deploy.mjs")).href
    )) as { main: typeof deployMain };
    const isolatedServiceModule = (await import(
      pathToFileURL(join(checkoutRoot, "scripts/ops/service.mjs")).href
    )) as { main: typeof serviceMain };
    return await callback({
      root: checkoutRoot,
      head,
      parent,
      deployMain: isolatedDeployModule.main,
      serviceMain: isolatedServiceModule.main,
    });
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
}

async function withSignedReleaseAcceptance<T>(
  options: {
    changeOtherGate?: boolean;
    extraChangedPath?: boolean;
    legacyRepository?: boolean;
    manifestDigestOverride?: string;
    publishAcceptance?: boolean;
    releasePublished?: boolean;
    serverDigestOverride?: string;
  },
  callback: (fixture: {
    root: string;
    buildId: string;
    operationsRevision: string;
    manifest: ReturnType<typeof buildManifest>;
    manifestPath: string;
    acceptedAt: string;
    publishedAt: string;
    releaseId: number;
    tagObject: string;
    trustedRemoteUrls: string[];
    tagObjectLookup: (tagObject: string) => Promise<unknown>;
    releaseLookup: (releaseId: number) => Promise<unknown>;
    releaseAssetLookup: (asset: { name: string }) => Promise<Buffer>;
  }) => Promise<T>,
) {
  const artifactsRoot = join(repositoryRoot, "artifacts");
  await mkdir(artifactsRoot, { recursive: true });
  const root = await mkdtemp(join(artifactsRoot, "signed release acceptance "));
  const releaseRepository = options.legacyRepository ? "riojung/openround" : "riojung/pollingpops";
  try {
    await run("git", ["init", "--quiet"], { cwd: root, capture: true });
    await run("git", ["config", "user.name", "Polling Pops Test"], { cwd: root, capture: true });
    await run("git", ["config", "user.email", "test@example.invalid"], {
      cwd: root,
      capture: true,
    });
    const trustedOrigin = join(root, ".trusted-origin.git");
    await run("git", ["init", "--bare", "--quiet", trustedOrigin], {
      cwd: root,
      capture: true,
    });
    await run("git", ["remote", "add", "origin", trustedOrigin], {
      cwd: root,
      capture: true,
    });
    const readinessPath = join(root, "docs", "release-readiness.json");
    await mkdir(dirname(readinessPath), { recursive: true });
    const taggedLedger = {
      schemaVersion: 1,
      updatedAt: "2026-09-25",
      releaseTarget: "single-vm-beta",
      gates: [
        {
          id: "source-ci",
          name: "Source CI",
          owner: "engineering",
          requiredFor: ["single-vm-beta-preflight", "single-vm-beta"],
          status: "complete",
          criterion: "The exact release source passed every required source check.",
          evidence: ["https://example.test/source-ci"],
        },
        {
          id: "signed-release",
          name: "Signed release",
          owner: "maintainer",
          requiredFor: ["single-vm-beta"],
          status: "pending",
          criterion: "The exact candidate has retained signed release evidence.",
          evidence: [],
          nextAction: "Create and verify the protected release candidate.",
        },
      ],
    };
    const evidenceCandidateLedger = structuredClone(taggedLedger);
    evidenceCandidateLedger.updatedAt = "2026-09-24";
    await writeFile(readinessPath, `${JSON.stringify(evidenceCandidateLedger, null, 2)}\n`);
    await run("git", ["add", "--", "docs/release-readiness.json"], {
      cwd: root,
      capture: true,
    });
    await run("git", ["commit", "--quiet", "--no-gpg-sign", "--message", "evidence candidate"], {
      cwd: root,
      capture: true,
    });
    const evidenceCandidateBuildId = await run("git", ["rev-parse", "HEAD"], {
      cwd: root,
      capture: true,
    }).then(({ stdout }) => stdout.trim());
    await writeFile(readinessPath, `${JSON.stringify(taggedLedger, null, 2)}\n`);
    await run("git", ["add", "--", "docs/release-readiness.json"], {
      cwd: root,
      capture: true,
    });
    await run("git", ["commit", "--quiet", "--no-gpg-sign", "--message", "release source"], {
      cwd: root,
      capture: true,
    });
    const candidateBuildId = await run("git", ["rev-parse", "HEAD"], {
      cwd: root,
      capture: true,
    }).then(({ stdout }) => stdout.trim());
    await run("git", ["tag", "--annotate", "v0.9.0", "--message", "Polling Pops v0.9.0"], {
      cwd: root,
      capture: true,
    });
    const tagObject = await run("git", ["rev-parse", "refs/tags/v0.9.0"], {
      cwd: root,
      capture: true,
    }).then(({ stdout }) => stdout.trim());
    await run(
      "git",
      ["push", "origin", "HEAD:refs/heads/main", "refs/tags/v0.9.0:refs/tags/v0.9.0"],
      { cwd: root, capture: true },
    );
    const manifest = buildManifest("production", candidateBuildId);
    const manifestPath = join(root, "build-manifest.json");
    const manifestContent = `${JSON.stringify(manifest, null, 2)}\n`;
    await writeFile(manifestPath, manifestContent);
    const manifestDigest = `sha256:${createHash("sha256").update(manifestContent).digest("hex")}`;
    const releaseId = 123_456_789;
    const releaseCreatedAt = "2026-09-26T12:00:00Z";
    const releaseAssetContent = new Map<string, Buffer>();
    const preflight = {
      schemaVersion: 1,
      tag: "v0.9.0",
      commit: candidateBuildId,
      tagObject,
      evidenceCandidateCommit: evidenceCandidateBuildId,
      evidenceOnlyDescendant: true,
      onOriginMain: true,
      verification: {
        verified: true,
        reason: "valid",
        verifiedAt: "2026-09-26T11:59:00Z",
      },
      candidateWorkflows: Object.fromEntries(
        [
          ["ci", "CI", ".github/workflows/ci.yml"],
          ["security", "Security", ".github/workflows/security.yml"],
          ["productionSmoke", "Production-path-smoke", ".github/workflows/production-smoke.yml"],
        ].map(([key, workflow, path], index) => [
          key,
          {
            workflow,
            path,
            runId: 1_000 + index,
            runNumber: 100 + index,
            runAttempt: 1,
            event: "push",
            headBranch: "main",
            status: "completed",
            conclusion: "success",
            url: `https://github.com/${releaseRepository}/actions/runs/${1_000 + index}`,
            commit: candidateBuildId,
            startedAt: "2026-09-26T10:00:00Z",
            completedAt: "2026-09-26T11:00:00Z",
          },
        ]),
      ),
    };
    for (const name of requiredReleaseAssetNames("v0.9.0")) {
      if (name === "SHA256SUMS") continue;
      const content =
        name === "openround-v0.9.0-manifest.json"
          ? Buffer.from(manifestContent)
          : name === "openround-v0.9.0-preflight.json"
            ? Buffer.from(`${JSON.stringify(preflight, null, 2)}\n`)
            : Buffer.from(`fixture ${name}\n`);
      releaseAssetContent.set(name, content);
    }
    const acceptedManifestDigest = options.manifestDigestOverride ?? manifestDigest;
    const checksumContent = `${[...releaseAssetContent]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, content]) => {
        const digest =
          name === "openround-v0.9.0-manifest.json"
            ? acceptedManifestDigest.slice("sha256:".length)
            : createHash("sha256").update(content).digest("hex");
        return `${digest}  ${name}`;
      })
      .join("\n")}\n`;
    releaseAssetContent.set("SHA256SUMS", Buffer.from(checksumContent));
    const releaseAssets = requiredReleaseAssetNames("v0.9.0").map((name, index) => {
      const content = releaseAssetContent.get(name)!;
      const digest =
        name === "openround-v0.9.0-manifest.json"
          ? acceptedManifestDigest
          : `sha256:${createHash("sha256").update(content).digest("hex")}`;
      const id = 900_000 + index;
      return {
        id,
        name,
        size: content.length,
        digest,
        apiUrl: `https://api.github.com/repos/${releaseRepository}/releases/assets/${id}`,
        downloadUrl: `https://github.com/${releaseRepository}/releases/download/v0.9.0/${name}`,
      };
    });
    const checksumAsset = releaseAssets.find(({ name }) => name === "SHA256SUMS")!;
    const acceptedLedger = structuredClone(taggedLedger);
    const signedRelease = acceptedLedger.gates.find(({ id }) => id === "signed-release")!;
    signedRelease.status = "complete";
    signedRelease.evidence = [
      checksumAsset.downloadUrl,
      checksumAsset.digest,
      `https://github.com/${releaseRepository}/actions/runs/999`,
    ];
    delete signedRelease.nextAction;
    Object.assign(signedRelease, {
      acceptance: {
        recordVersion: 1,
        candidateBuildId: evidenceCandidateBuildId,
        environment: "github-release-draft",
        startedAt: "2026-09-26T12:00:00Z",
        completedAt: "2026-09-26T13:00:00Z",
        acceptedAt: "2026-09-26T14:00:00Z",
        owner: { role: "maintainer", decision: "accepted" },
        independentReviewer: {
          role: "independent-release-reviewer",
          independent: true,
          decision: "accepted",
        },
        manifest: {
          url: checksumAsset.downloadUrl,
          sha256: checksumAsset.digest,
        },
      },
      releaseBinding: {
        schemaVersion: 2,
        tag: "v0.9.0",
        tagObject,
        buildId: candidateBuildId,
        githubRelease: {
          id: releaseId,
          apiUrl: `https://api.github.com/repos/${releaseRepository}/releases/${releaseId}`,
          htmlUrl: `https://github.com/${releaseRepository}/releases/tag/untagged-draft-fixture`,
          targetCommitish: candidateBuildId,
          draft: true,
          createdAt: releaseCreatedAt,
        },
        manifestDigest: acceptedManifestDigest,
        imageDigests: {
          server: options.serverDigestOverride ?? manifest.images.server.digest,
          web: manifest.images.web.digest,
        },
        assets: releaseAssets,
      },
    });
    if (options.changeOtherGate) acceptedLedger.gates[0].owner = "unreviewed-owner";
    await writeFile(readinessPath, `${JSON.stringify(acceptedLedger, null, 2)}\n`);
    if (options.extraChangedPath) {
      await writeFile(join(root, "deployment-code.txt"), "unreviewed deployment change\n");
    }
    await run(
      "git",
      [
        "add",
        "--",
        "docs/release-readiness.json",
        ...(options.extraChangedPath ? ["deployment-code.txt"] : []),
      ],
      { cwd: root, capture: true },
    );
    await run(
      "git",
      ["commit", "--quiet", "--no-gpg-sign", "--message", "accept release evidence"],
      { cwd: root, capture: true },
    );
    const operationsRevision = await run("git", ["rev-parse", "HEAD"], {
      cwd: root,
      capture: true,
    }).then(({ stdout }) => stdout.trim());
    if (options.publishAcceptance !== false) {
      await run("git", ["push", "origin", "HEAD:refs/heads/main"], {
        cwd: root,
        capture: true,
      });
    }
    return await callback({
      root,
      buildId: candidateBuildId,
      operationsRevision,
      manifest,
      manifestPath,
      acceptedAt: "2026-09-26T14:00:00Z",
      publishedAt: "2026-09-26T15:00:00Z",
      releaseId,
      tagObject,
      trustedRemoteUrls: [trustedOrigin],
      tagObjectLookup: async (requestedTagObject) => ({
        sha: requestedTagObject,
        tag: "v0.9.0",
        object: { type: "commit", sha: candidateBuildId },
        verification: { verified: true, reason: "valid" },
      }),
      releaseLookup: async (requestedReleaseId) => {
        if (requestedReleaseId !== releaseId) throw new Error("unexpected release lookup ID");
        return {
          id: releaseId,
          url: `https://api.github.com/repos/riojung/pollingpops/releases/${releaseId}`,
          html_url: options.releasePublished
            ? "https://github.com/riojung/pollingpops/releases/tag/v0.9.0"
            : "https://github.com/riojung/pollingpops/releases/tag/untagged-draft-fixture",
          tag_name: "v0.9.0",
          target_commitish: candidateBuildId,
          name: "Polling Pops v0.9.0",
          body: releaseAssetContent.get("release-notes.md")!.toString("utf8"),
          draft: options.releasePublished ? false : true,
          prerelease: false,
          created_at: releaseCreatedAt,
          published_at: options.releasePublished ? "2026-09-26T15:00:00Z" : null,
          assets: releaseAssets.map((asset) => ({
            id: asset.id,
            name: asset.name,
            size: asset.size,
            digest: asset.digest,
            url: asset.apiUrl.replace("riojung/openround", "riojung/pollingpops"),
            browser_download_url: asset.downloadUrl.replace(
              "riojung/openround",
              "riojung/pollingpops",
            ),
            state: "uploaded",
          })),
        };
      },
      releaseAssetLookup: async ({ name }) => releaseAssetContent.get(name)!,
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("operations environment contract", () => {
  it("requires reviewed deployment inputs to be tracked and byte-clean", async () => {
    await expect(
      resolveCheckedRepositoryFile("LICENSE", repositoryRoot, "reviewed fixture", {
        requireGitClean: true,
      }),
    ).resolves.toBe(join(repositoryRoot, "LICENSE"));
    const artifactsRoot = join(repositoryRoot, "artifacts");
    await mkdir(artifactsRoot, { recursive: true });
    const fixtureRoot = await mkdtemp(join(artifactsRoot, "untracked deployment input "));
    try {
      const untracked = join(fixtureRoot, "compose.yaml");
      await writeFile(untracked, "services: {}\n");
      await expect(
        resolveCheckedRepositoryFile(untracked, repositoryRoot, "unreviewed fixture", {
          requireGitClean: true,
        }),
      ).rejects.toThrow("must be tracked by Git");
    } finally {
      await rm(fixtureRoot, { recursive: true, force: true });
    }
  });

  it("hashes hosted deployment automation only when it matches reviewed HEAD", async () => {
    const artifactsRoot = join(repositoryRoot, "artifacts");
    await mkdir(artifactsRoot, { recursive: true });
    const fixtureRoot = await mkdtemp(join(artifactsRoot, "reviewed automation inputs "));
    try {
      await run("git", ["init", "--quiet"], { cwd: fixtureRoot, capture: true });
      await run("git", ["config", "user.name", "Polling Pops Test"], {
        cwd: fixtureRoot,
        capture: true,
      });
      await run("git", ["config", "user.email", "test@example.invalid"], {
        cwd: fixtureRoot,
        capture: true,
      });
      for (const path of HOSTED_DEPLOYMENT_AUTOMATION_FILES) {
        await mkdir(dirname(join(fixtureRoot, path)), { recursive: true });
        await writeFile(join(fixtureRoot, path), `reviewed ${path}\n`);
      }
      await run("git", ["add", "--", ...HOSTED_DEPLOYMENT_AUTOMATION_FILES], {
        cwd: fixtureRoot,
        capture: true,
      });
      await run("git", ["commit", "--quiet", "--no-gpg-sign", "--message", "reviewed"], {
        cwd: fixtureRoot,
        capture: true,
      });

      const hashes = await resolveReviewedDeploymentInputHashes(
        HOSTED_DEPLOYMENT_AUTOMATION_FILES,
        fixtureRoot,
      );
      expect(Object.keys(hashes)).toEqual([...HOSTED_DEPLOYMENT_AUTOMATION_FILES]);
      for (const path of HOSTED_DEPLOYMENT_AUTOMATION_FILES) {
        const expected = createHash("sha256")
          .update(await readFile(join(fixtureRoot, path)))
          .digest("hex");
        expect(hashes[path]).toBe(expected);
      }

      await writeFile(join(fixtureRoot, "scripts/deploy.sh"), "unreviewed automation\n");
      await expect(
        resolveReviewedDeploymentInputHashes(HOSTED_DEPLOYMENT_AUTOMATION_FILES, fixtureRoot),
      ).rejects.toThrow("must match the reviewed HEAD revision");
    } finally {
      await rm(fixtureRoot, { recursive: true, force: true });
    }
  });

  it("permits a production release only through its exact evidence-only acceptance commit", async () => {
    await withSignedReleaseAcceptance({}, async (fixture) => {
      await expect(
        assertProductionReleaseRevision({
          operationsRevision: fixture.operationsRevision,
          manifest: fixture.manifest,
          manifestPath: fixture.manifestPath,
          root: fixture.root,
          trustedRemoteUrls: fixture.trustedRemoteUrls,
          tagObjectLookup: fixture.tagObjectLookup,
          releaseLookup: fixture.releaseLookup,
          releaseAssetLookup: fixture.releaseAssetLookup,
        }),
      ).resolves.toMatchObject({
        tag: "v0.9.0",
        buildId: fixture.buildId,
        certificateIdentity:
          "https://github.com/riojung/pollingpops/.github/workflows/release.yml@refs/tags/v0.9.0",
        imageDigests: {
          server: fixture.manifest.images.server.digest,
          web: fixture.manifest.images.web.digest,
        },
      });
    });
  });

  it("retains the original certificate identity for an accepted legacy release after the repository rename", async () => {
    await withSignedReleaseAcceptance({ legacyRepository: true }, async (fixture) => {
      const acceptance = await assertProductionReleaseRevision({
        operationsRevision: fixture.operationsRevision,
        manifest: fixture.manifest,
        manifestPath: fixture.manifestPath,
        root: fixture.root,
        trustedRemoteUrls: fixture.trustedRemoteUrls,
        tagObjectLookup: fixture.tagObjectLookup,
        releaseLookup: fixture.releaseLookup,
        releaseAssetLookup: fixture.releaseAssetLookup,
      });
      expect(acceptance.certificateIdentity).toBe(
        "https://github.com/riojung/openround/.github/workflows/release.yml@refs/tags/v0.9.0",
      );
      expect(acceptance.githubRelease.apiUrl).toBe(
        `https://api.github.com/repos/riojung/openround/releases/${fixture.releaseId}`,
      );
    });
  });

  it("looks up release objects and metadata assets through the canonical repository API", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (_url, options) =>
        new Headers(options?.headers).get("Accept") === "application/octet-stream"
          ? new Response("release asset", { status: 200 })
          : new Response("{}", { status: 200 }),
      );
    await fetchPublishedReleaseTagObject("b".repeat(40));
    await fetchAcceptedGithubRelease(123);
    await fetchPublishedReleaseAsset({ id: 456, name: "SHA256SUMS" });
    expect(fetchSpy.mock.calls.map(([url]) => url)).toEqual([
      `https://api.github.com/repos/riojung/pollingpops/git/tags/${"b".repeat(40)}`,
      "https://api.github.com/repos/riojung/pollingpops/releases/123",
      "https://api.github.com/repos/riojung/pollingpops/releases/assets/456",
    ]);
    for (const [, options] of fetchSpy.mock.calls.slice(0, 2)) {
      expect(options?.redirect).toBe("error");
    }
  });

  it("uses new installation folders while retaining exact canonical and legacy workflow identities", async () => {
    for (const environment of ["staging", "production"] as const) {
      const config = JSON.parse(
        await readFile(join(repositoryRoot, `config/deploy/${environment}.json`), "utf8"),
      );
      expect(config.singleVm.deployPath).toBe(`/opt/pollingpops/${environment}`);
      expect(config.imageRepository).toBe("ghcr.io/riojung/openround/openround");
      expect(config.singleVm.projectName).toBe(`openround-${environment}`);
      expect(config.singleVm.user).toBe("openround");
      const identity = new RegExp(config.cosignIdentityRegexp);
      const workflow = environment === "production" ? "release.yml" : "staging-images.yml";
      const reference = environment === "production" ? "refs/tags/v0.9.0" : "refs/heads/main";
      for (const repository of ["riojung/pollingpops", "riojung/openround"]) {
        expect(
          identity.test(
            `https://github.com/${repository}/.github/workflows/${workflow}@${reference}`,
          ),
        ).toBe(true);
      }
      for (const invalid of [
        `https://github.com/attacker/pollingpops/.github/workflows/${workflow}@${reference}`,
        `https://github.com/riojung/pollingpops-copy/.github/workflows/${workflow}@${reference}`,
        `https://github.com/riojung/openround/.github/workflows/unreviewed.yml@${reference}`,
        `https://github.com/riojung/pollingpops/.github/workflows/${workflow}@refs/heads/feature`,
      ]) {
        expect(identity.test(invalid)).toBe(false);
      }
    }
  });

  it("permits clean-host redeployment after the unchanged accepted release is published", async () => {
    await withSignedReleaseAcceptance({ releasePublished: true }, async (fixture) => {
      const config = {
        ...singleVmConfig("production"),
        operationsRevision: fixture.operationsRevision,
        deploymentInputHashes: {
          "scripts/ops/deploy.mjs": "d".repeat(64),
        },
        manifest: fixture.manifest,
      };
      const manifestSha256 = createHash("sha256")
        .update(await readFile(fixture.manifestPath))
        .digest("hex");
      const receipt = {
        schemaVersion: 2,
        environment: "production",
        buildId: fixture.buildId,
        operation: "deploy",
        startedAt: "2026-09-26T14:10:00Z",
        completedAt: "2026-09-26T14:20:00Z",
        manifest: "artifacts/deploy/production/build-manifest.json",
        manifestSha256,
        images: {
          server: fixture.manifest.images.server.ref,
          web: fixture.manifest.images.web.ref,
        },
        singleVm: {
          host: config.singleVm.host,
          projectName: config.singleVm.projectName,
        },
        backupReference: "provider-backup-123",
        configuration: {
          runtimeEnvironmentSha256: "e".repeat(64),
          summary: receiptConfigCheckSummary(config, fixture.buildId),
        },
        verification: {
          configuration: true,
          imageBuildIds: true,
          migration: "applied",
          migrationSkipped: false,
          serverLive: true,
          serverReady: true,
          webBuildId: true,
          mediaLive: true,
        },
        operations: {
          commit: fixture.operationsRevision,
          files: config.deploymentInputHashes,
        },
        release: {
          githubReleaseId: fixture.releaseId,
          tag: "v0.9.0",
          tagObject: fixture.tagObject,
          acceptedAt: fixture.acceptedAt,
        },
      };
      const baseArguments = {
        operationsRevision: fixture.operationsRevision,
        manifest: fixture.manifest,
        manifestPath: fixture.manifestPath,
        root: fixture.root,
        trustedRemoteUrls: fixture.trustedRemoteUrls,
        tagObjectLookup: fixture.tagObjectLookup,
        releaseLookup: fixture.releaseLookup,
        releaseAssetLookup: fixture.releaseAssetLookup,
      };

      await expect(assertProductionReleaseRevision(baseArguments)).rejects.toThrow(
        "require explicit redeploy mode",
      );

      await expect(
        assertProductionReleaseRevision({
          ...baseArguments,
          publishedRedeploy: { receipt, config },
        }),
      ).resolves.toMatchObject({ tag: "v0.9.0", buildId: fixture.buildId });

      await expect(
        assertProductionReleaseRevision({
          ...baseArguments,
          publishedRedeploy: {
            receipt: { ...receipt, manifestSha256: "0".repeat(64) },
            config,
          },
        }),
      ).rejects.toThrow("manifest does not match");

      await expect(
        assertProductionReleaseRevision({
          ...baseArguments,
          publishedRedeploy: {
            receipt: {
              ...receipt,
              startedAt: "2026-09-26T13:59:00Z",
            },
            config,
          },
        }),
      ).rejects.toThrow("start after acceptance");
    });
  });

  it("rejects array values that stringify to valid release-binding fields", () => {
    const validBinding = releaseBindingFixture();
    const cases = [
      {
        field: "tag",
        binding: { ...validBinding, tag: [validBinding.tag] },
      },
      {
        field: "tagObject",
        binding: { ...validBinding, tagObject: [validBinding.tagObject] },
      },
      {
        field: "buildId",
        binding: { ...validBinding, buildId: [validBinding.buildId] },
      },
      {
        field: "manifestDigest",
        binding: { ...validBinding, manifestDigest: [validBinding.manifestDigest] },
      },
      {
        field: "imageDigests.server",
        binding: {
          ...validBinding,
          imageDigests: { ...validBinding.imageDigests, server: [serverDigest] },
        },
      },
      {
        field: "imageDigests.web",
        binding: {
          ...validBinding,
          imageDigests: { ...validBinding.imageDigests, web: [webDigest] },
        },
      },
    ];

    for (const { field, binding } of cases) {
      expect(() => validateReleaseBinding(binding)).toThrow(`releaseBinding.${field} must be`);
    }
  });

  it("uses strict SemVer 2.0 release tags without build metadata", () => {
    for (const tag of ["v0.0.0", "v1.2.3", "v1.2.3-0", "v1.2.3-alpha.1", "v1.2.3-x-y.z"])
      expect(validateReleaseTag(tag)).toBe(tag);

    for (const tag of [
      "1.2.3",
      "v01.2.3",
      "v1.02.3",
      "v1.2.03",
      "v1.2.3-",
      "v1.2.3-..",
      "v1.2.3-alpha..1",
      "v1.2.3-01",
      "v1.2.3+build.1",
    ]) {
      expect(() => validateReleaseTag(tag), tag).toThrow(/strict v-prefixed SemVer 2\.0/);
    }
  });

  it("verifies production images against the exact accepted release-tag identity", async () => {
    const certificateIdentity =
      "https://github.com/riojung/pollingpops/.github/workflows/release.yml@refs/tags/v0.9.0";
    const output = await captureStdout(() =>
      verifySignatures(productionConfig(), buildManifest("production"), true, certificateIdentity),
    );

    expect(output.match(/cosign verify/g)).toHaveLength(2);
    expect(output).toContain(`--certificate-identity ${certificateIdentity}`);
    expect(output).not.toContain("--certificate-identity-regexp");
  });

  it("rejects an unsigned or substituted published release tag object", async () => {
    await withSignedReleaseAcceptance({}, async (fixture) => {
      await expect(
        assertProductionReleaseRevision({
          operationsRevision: fixture.operationsRevision,
          manifest: fixture.manifest,
          manifestPath: fixture.manifestPath,
          root: fixture.root,
          trustedRemoteUrls: fixture.trustedRemoteUrls,
          tagObjectLookup: async (tagObject) => ({
            sha: tagObject,
            tag: "v0.9.0",
            object: { type: "commit", sha: fixture.buildId },
            verification: { verified: false, reason: "unsigned" },
          }),
        }),
      ).rejects.toThrow("has not verified the exact annotated release tag object signature");

      await expect(
        assertProductionReleaseRevision({
          operationsRevision: fixture.operationsRevision,
          manifest: fixture.manifest,
          manifestPath: fixture.manifestPath,
          root: fixture.root,
          trustedRemoteUrls: fixture.trustedRemoteUrls,
          tagObjectLookup: async () => ({
            sha: "d".repeat(40),
            tag: "v0.9.0",
            object: { type: "commit", sha: fixture.buildId },
            verification: { verified: true, reason: "valid" },
          }),
        }),
      ).rejects.toThrow("does not match the signed release acceptance");
    });
  });

  it("rejects a non-descendant acceptance state and a local-only acceptance commit", async () => {
    await withSignedReleaseAcceptance({}, async (fixture) => {
      await expect(
        assertProductionReleaseRevision({
          operationsRevision: fixture.buildId,
          manifest: fixture.manifest,
          manifestPath: fixture.manifestPath,
          root: fixture.root,
          trustedRemoteUrls: fixture.trustedRemoteUrls,
          tagObjectLookup: fixture.tagObjectLookup,
        }),
      ).rejects.toThrow("must be a strict evidence-only descendant");
    });
    await withSignedReleaseAcceptance({ publishAcceptance: false }, async (fixture) => {
      await expect(
        assertProductionReleaseRevision({
          operationsRevision: fixture.operationsRevision,
          manifest: fixture.manifest,
          manifestPath: fixture.manifestPath,
          root: fixture.root,
          trustedRemoteUrls: fixture.trustedRemoteUrls,
          tagObjectLookup: fixture.tagObjectLookup,
        }),
      ).rejects.toThrow("HEAD must match the fetched origin/main commit");
    });
  });

  it("rejects a release acceptance descendant that changes anything outside the ledger", async () => {
    await withSignedReleaseAcceptance({ extraChangedPath: true }, async (fixture) => {
      await expect(
        assertProductionReleaseRevision({
          operationsRevision: fixture.operationsRevision,
          manifest: fixture.manifest,
          manifestPath: fixture.manifestPath,
          root: fixture.root,
          trustedRemoteUrls: fixture.trustedRemoteUrls,
          tagObjectLookup: fixture.tagObjectLookup,
        }),
      ).rejects.toThrow("may differ from the release build only by docs/release-readiness.json");
    });
  });

  it("rejects unrelated gate changes and artifact drift in a release acceptance", async () => {
    await withSignedReleaseAcceptance({ changeOtherGate: true }, async (fixture) => {
      await expect(
        assertProductionReleaseRevision({
          operationsRevision: fixture.operationsRevision,
          manifest: fixture.manifest,
          manifestPath: fixture.manifestPath,
          root: fixture.root,
          trustedRemoteUrls: fixture.trustedRemoteUrls,
          tagObjectLookup: fixture.tagObjectLookup,
        }),
      ).rejects.toThrow("descendant may not change gate source-ci");
    });
    await withSignedReleaseAcceptance(
      { manifestDigestOverride: `sha256:${"f".repeat(64)}` },
      async (fixture) => {
        await expect(
          assertProductionReleaseRevision({
            operationsRevision: fixture.operationsRevision,
            manifest: fixture.manifest,
            manifestPath: fixture.manifestPath,
            root: fixture.root,
            trustedRemoteUrls: fixture.trustedRemoteUrls,
            tagObjectLookup: fixture.tagObjectLookup,
          }),
        ).rejects.toThrow("manifestDigest does not match the selected release artifact");
      },
    );
    await withSignedReleaseAcceptance(
      { serverDigestOverride: `sha256:${"f".repeat(64)}` },
      async (fixture) => {
        await expect(
          assertProductionReleaseRevision({
            operationsRevision: fixture.operationsRevision,
            manifest: fixture.manifest,
            manifestPath: fixture.manifestPath,
            root: fixture.root,
            trustedRemoteUrls: fixture.trustedRemoteUrls,
            tagObjectLookup: fixture.tagObjectLookup,
          }),
        ).rejects.toThrow("server digest does not match the build manifest");
      },
    );
  });

  it("normalizes the documented development alias and rejects unknown environments", () => {
    expect(normalizeEnvironment(" dev ")).toBe("development");
    expect(normalizeEnvironment("STAGING")).toBe("staging");
    expect(normalizeEnvironment("production")).toBe("production");
    expect(() => normalizeEnvironment("preview")).toThrow("Unsupported environment");
  });

  it("keeps runtime and migration credentials in separate environment files", () => {
    expect(
      validateEnvFileKeys("DATABASE_URL=postgres://runtime\nSESSION_SECRET=value", "runtime"),
    ).toEqual(["DATABASE_URL", "SESSION_SECRET"]);
    expect(
      validateEnvFileKeys(
        "DATABASE_MIGRATION_URL=postgres://owner\nOPENROUND_MIGRATIONS_DIR=/app/migrations",
        "migration",
      ),
    ).toEqual(["DATABASE_MIGRATION_URL", "OPENROUND_MIGRATIONS_DIR"]);

    expect(() => validateEnvFileKeys("DATABASE_MIGRATION_URL=postgres://owner", "runtime")).toThrow(
      "runtime environment must not contain DATABASE_MIGRATION_URL",
    );
    expect(() => validateEnvFileKeys("DATABASE_URL=postgres://runtime", "migration")).toThrow(
      "migration environment must not contain DATABASE_URL",
    );

    expect(validateEnvFileKeys(singleVmRuntimeEnvironment(), "single-vm-runtime")).toContain(
      "DATABASE_URL",
    );
    expect(
      validateEnvFileKeys(
        `${singleVmRuntimeEnvironment()}FEATURE_RECOVERY_PACK_LIVE_CARDS=false\n`,
        "single-vm-runtime",
      ),
    ).toContain("FEATURE_RECOVERY_PACK_LIVE_CARDS");
    expect(() =>
      validateEnvFileKeys(
        singleVmRuntimeEnvironment().replace("COMMUNITY_MODE=false\n", ""),
        "single-vm-runtime",
      ),
    ).toThrow("single-vm runtime environment requires COMMUNITY_MODE");
    expect(() =>
      validateEnvFileKeys(
        `${singleVmRuntimeEnvironment()}NODE_OPTIONS=--require=/tmp/unreviewed.js\n`,
        "single-vm-runtime",
      ),
    ).toThrow("must not contain NODE_OPTIONS");
    expect(() =>
      validateEnvFileKeys(
        `${singleVmRuntimeEnvironment()}DATABASE_MIGRATION_URL=postgres://owner\n`,
        "single-vm-runtime",
      ),
    ).toThrow("must not contain DATABASE_MIGRATION_URL");
  });

  it("rejects runtime or provider secrets that override reviewed Fly environment keys", () => {
    expect(
      assertNoEnvironmentKeyOverlap(
        ["DATABASE_URL", "SESSION_SECRET"],
        ["NODE_ENV", "PUBLIC_API_URL"],
        "runtime environment file",
        "checked Fly environment",
      ),
    ).toBe(true);
    expect(() =>
      assertNoEnvironmentKeyOverlap(
        ["DATABASE_URL", "PUBLIC_API_URL"],
        ["NODE_ENV", "PUBLIC_API_URL"],
        "Fly secrets",
        "checked Fly environment",
      ),
    ).toThrow("Fly secrets and checked Fly environment must not both define: PUBLIC_API_URL");
  });
  it("accepts the exact business/operator overlay configuration and keeps image overrides and owner credentials excluded", () => {
    const businessKeys = [
      "BACKGROUND_JOBS_MODE",
      "BUSINESS_PLATFORM_ENABLED",
      "BUSINESS_EVENT_CREDITS_ENABLED",
      "BUSINESS_CATALOG_JSON",
      "BUSINESS_STRIPE_AUTOMATIC_TAX_ENABLED",
      "BUSINESS_BILLING_WORKER_INTERVAL_MS",
      "BUSINESS_BILLING_WORKER_LEASE_MS",
      "BUSINESS_BILLING_RECONCILE_INTERVAL_MS",
      "CONTROL_ENABLED",
      "CONTROL_AUTH_MODE",
      "CONTROL_PUBLIC_ORIGIN",
      "CONTROL_PRODUCT_ORIGIN",
      "CONTROL_DATABASE_URL",
      "CONTROL_DOMAIN",
      "CONTROL_ALLOWED_CIDRS",
      "OPERATOR_OIDC_ISSUER",
      "OPERATOR_CREDENTIAL_KEY",
      "OPERATOR_OIDC_CLIENT_ID",
      "OPERATOR_OIDC_CLIENT_SECRET",
      "OPERATOR_OIDC_MFA_POLICY_ENFORCED",
      "OPERATOR_OIDC_REQUIRED_AMR",
      "OPERATOR_OIDC_ALLOWED_ACR",
      "OPERATOR_BOOTSTRAP_IDENTITIES",
      "INTEGRATION_SECRET_KEY",
      "QUICKBOOKS_ENVIRONMENT",
      "QUICKBOOKS_PRODUCTION_READS_ENABLED",
      "OPENROUND_JOBS_CPUS",
      "OPENROUND_JOBS_MEMORY_LIMIT",
      "OPENROUND_CONTROL_CPUS",
      "OPENROUND_CONTROL_MEMORY_LIMIT",
    ];
    const environment = `${singleVmRuntimeEnvironment()}${businessKeys.map((key) => `${key}=synthetic-test-value`).join("\n")}\n`;
    expect(validateEnvFileKeys(environment, "single-vm-runtime")).toEqual(
      expect.arrayContaining(businessKeys),
    );
    for (const prohibited of [
      "OPENROUND_CONTROL_IMAGE",
      "OPENROUND_SERVER_IMAGE",
      "OPENROUND_WEB_IMAGE",
      "OPENROUND_BUILD_ID",
      "CONTROL_DATABASE_MIGRATION_URL",
      "OPERATOR_OIDC_JWKS_URI",
      "QUICKBOOKS_API_URL",
      "CONTROL_ALLOW_LOCAL_HTTP",
      "CONTROL_LOCAL_DEVELOPMENT",
    ]) {
      expect(
        () =>
          validateEnvFileKeys(
            `${environment}${prohibited}=synthetic-test-value\n`,
            "single-vm-runtime",
          ),
        prohibited,
      ).toThrow(`must not contain ${prohibited}`);
    }
    expect(() =>
      validateEnvFileKeys(
        "DATABASE_MIGRATION_URL=postgres://owner\nCONTROL_DATABASE_URL=postgres://operator\n",
        "migration",
      ),
    ).toThrow("migration environment must not contain CONTROL_DATABASE_URL");
  });

  it("distributes live-card playback as a separate default-off environment flag", async () => {
    const [example, compose, singleVmCompose] = await Promise.all(
      [".env.example", "compose.yaml", "compose.single-vm.yaml"].map((path) =>
        readFile(join(repositoryRoot, path), "utf8"),
      ),
    );
    expect(example).toMatch(/^FEATURE_RECOVERY_PACK_LIVE_CARDS=false$/m);
    for (const source of [compose, singleVmCompose]) {
      expect(source).toContain("FEATURE_RECOVERY_PACK_LIVE_CARDS:");
      expect(source).toContain("${FEATURE_RECOVERY_PACK_LIVE_CARDS:-false}");
      expect(source).toContain("${FEATURE_RECOVERY_PACKS:-false}");
    }
  });

  it("keeps deployment credentials out of every Docker build context", async () => {
    const dockerIgnore = await readFile(join(repositoryRoot, ".dockerignore"), "utf8");
    expect(dockerIgnore).toMatch(/^artifacts$/m);
    expect(dockerIgnore).toMatch(/^\.deploy$/m);
    expect(dockerIgnore).toMatch(/^\*\.runtime\.env$/m);
    expect(dockerIgnore).toMatch(/^\*\*\/\*\.runtime\.env$/m);
    expect(dockerIgnore).toMatch(/^\*\.migration\.env$/m);
    expect(dockerIgnore).toMatch(/^\*\*\/\*\.migration\.env$/m);
  });

  it("requires an environment and exact full build ID for deployment confirmation", () => {
    expect(expectedDeploymentConfirmation("staging", buildId)).toBe(`staging:${buildId}`);
    expect(expectedProductionConfirmation(buildId)).toBe(`production:${buildId}`);
    expect(validateDeploymentConfirmation(`staging:${buildId}`, "staging", buildId)).toBe(true);
    expect(validateProductionConfirmation(`production:${buildId}`, buildId)).toBe(true);
    expect(() =>
      validateDeploymentConfirmation(`production:${buildId}`, "staging", buildId),
    ).toThrow("Deployment confirmation must exactly match");
    expect(() =>
      validateProductionConfirmation(`production:${buildId.slice(0, 12)}`, buildId),
    ).toThrow("Production confirmation must exactly match");
  });

  it("binds rollback confirmation to the target and currently running full build IDs", () => {
    const targetBuildId = "d".repeat(40);
    const confirmation = `rollback:production:${targetBuildId}:from:${buildId}`;
    expect(expectedRollbackConfirmation("production", targetBuildId, buildId)).toBe(confirmation);
    expect(validateRollbackConfirmation(confirmation, "production", targetBuildId, buildId)).toBe(
      true,
    );
    expect(() =>
      validateRollbackConfirmation(confirmation, "staging", targetBuildId, buildId),
    ).toThrow("Rollback confirmation must exactly match");
    expect(() => expectedRollbackConfirmation("production", buildId, buildId)).toThrow(
      "must differ",
    );
  });
});

describe("deployment configuration and manifest validation", () => {
  it("requires the Cosign 3 signing and verification format", () => {
    expect(assertSupportedCosignVersion("GitVersion: v3.0.6\n")).toBe("3.0.6");
    expect(assertSupportedCosignVersion("GitVersion: v3.1.3\n")).toBe("3.1.3");
    expect(() => assertSupportedCosignVersion("GitVersion: v2.6.5\n")).toThrow(
      "from 3.0.6 up to, but not including, 4.0.0",
    );
    expect(() => assertSupportedCosignVersion("GitVersion: v3.0.5\n")).toThrow(
      "Cosign 3.0.6 or newer is required",
    );
    expect(() => assertSupportedCosignVersion("GitVersion: v3.0.6-rc.1\n")).toThrow(
      "a stable Cosign 3.0.6 or newer release is required",
    );
    expect(() => assertSupportedCosignVersion("GitVersion: v4.0.0+build.1\n")).toThrow(
      "up to, but not including, 4.0.0",
    );
    expect(() => assertSupportedCosignVersion("unknown version")).toThrow(
      "Unable to determine Cosign version",
    );
  });

  it("accepts a complete hosted config and rejects target, URL, and production-gate drift", () => {
    expect(validateDeployConfig(stagingConfig(), "staging").environment).toBe("staging");
    expect(validateDeployConfig(productionConfig(), "production").environment).toBe("production");

    expect(() => validateDeployConfig(stagingConfig(), "production")).toThrow(
      "does not match target",
    );
    expect(() =>
      validateDeployConfig(
        { ...stagingConfig(), publicApiUrl: "http://api.example.test" },
        "staging",
      ),
    ).toThrow("publicApiUrl must be a credential-free HTTPS URL");
    expect(() =>
      validateDeployConfig(
        { ...stagingConfig(), publicApiUrl: "https://api.example.test/v1" },
        "staging",
      ),
    ).toThrow(/origin/);
    expect(() =>
      validateDeployConfig({ ...productionConfig(), requireSigning: false }, "production"),
    ).toThrow("production must require image signing");
    expect(() =>
      validateDeployConfig(
        { ...productionConfig(), cosignIdentityRegexp: "^(?:https://example\\.test)$" },
        "production",
      ),
    ).toThrow("must use Cosign-compatible RE2 syntax");
    expect(() => validateDeployConfig({ ...stagingConfig(), unexpected: true }, "staging")).toThrow(
      "unsupported key unexpected",
    );
  });

  it("separates parseable deployment templates from configured hosted targets", () => {
    const configured = validateDeployConfig(singleVmConfig(), "staging");
    expect(assertConfiguredHostedTarget(configured)).toBe(configured);

    for (const [field, value] of [
      ["publicWebUrl", "https://staging.pollingpops.example"],
      ["publicWebUrl", "https://127.0.0.1"],
      ["publicWebUrl", "https://[::ffff:127.0.0.1]"],
      ["publicWebUrl", "https://192.0.2.10"],
      ["publicApiUrl", "https://api.example.com"],
      ["publicApiUrl", "https://api.ops.internal"],
      ["publicMediaUrl", "https://media.local"],
      ["publicMediaUrl", "https://media.invalid."],
    ] as const) {
      expect(() => assertConfiguredHostedTarget({ ...configured, [field]: value })).toThrow(
        `${field} must not use a reserved example, placeholder, loopback, or unspecified hostname`,
      );
    }
    for (const host of [
      "replace-me.internal",
      "0",
      "127.1",
      "2130706433",
      "0x7f000001",
      "0x7f.1",
      "203.0.113.10",
    ]) {
      expect(() =>
        assertConfiguredHostedTarget({
          ...configured,
          singleVm: { ...configured.singleVm, host },
        }),
      ).toThrow(
        "singleVm.host must not use a reserved example, placeholder, loopback, or unspecified hostname",
      );
    }
  });

  it("accepts only digest-pinned, internally consistent image manifests", () => {
    const manifest = buildManifest();
    expect(
      validateBuildManifest(manifest, {
        environment: "staging",
        buildId,
        imageRepository: "ghcr.io/riojung/openround/openround",
        imagePlatform: "linux/amd64",
        publicApiUrl: `https://${stagingTarget.appHost}`,
      }),
    ).toBe(manifest);

    const mutableReference = structuredClone(manifest);
    mutableReference.images.server.ref = mutableReference.images.server.tag;
    expect(() =>
      validateBuildManifest(mutableReference, {
        environment: "staging",
        imageRepository: "ghcr.io/riojung/openround/openround",
        imagePlatform: "linux/amd64",
      }),
    ).toThrow("must exactly match repository and digest");

    const malformedDigest = structuredClone(manifest);
    malformedDigest.images.web.digest = "sha256:not-a-digest";
    expect(() =>
      validateBuildManifest(malformedDigest, {
        environment: "staging",
        imageRepository: "ghcr.io/riojung/openround/openround",
        imagePlatform: "linux/amd64",
      }),
    ).toThrow("images.web.digest must be sha256");
  });

  it("rejects a web image compiled for a different public API", () => {
    expect(() =>
      validateBuildManifest(buildManifest(), {
        environment: "staging",
        imageRepository: "ghcr.io/riojung/openround/openround",
        imagePlatform: "linux/amd64",
        publicApiUrl: "https://other-api.example.test",
      }),
    ).toThrow("NEXT_PUBLIC_API_URL does not match the target config");
  });

  it("validates the exact non-secret Fly environments and rejects secret or URL drift", async () => {
    const checkedConfig = validateDeployConfig(
      {
        ...stagingConfig(),
        publicWebUrl: "https://openround-ca-staging-web.fly.dev",
        publicApiUrl: "https://openround-ca-staging-server.fly.dev",
        imageRepository: "ghcr.io/riojung/openround/openround",
        fly: {
          serverApp: "openround-ca-staging-server",
          webApp: "openround-ca-staging-web",
          serverConfig: "config/deploy/fly/staging-server.toml",
          webConfig: "config/deploy/fly/staging-web.toml",
        },
      },
      "staging",
    );
    const serverEnvironment = parseFlyTomlEnvironment(
      await readFile(join(repositoryRoot, checkedConfig.fly.serverConfig), "utf8"),
    );
    const webEnvironment = parseFlyTomlEnvironment(
      await readFile(join(repositoryRoot, checkedConfig.fly.webConfig), "utf8"),
    );

    expect(validateFlyRuntimeEnvironment(serverEnvironment, checkedConfig)).toBe(serverEnvironment);
    expect(validateFlyWebEnvironment(webEnvironment, checkedConfig)).toBe(webEnvironment);
    const brandedWebEnvironment = {
      ...webEnvironment,
      OPENROUND_PUBLIC_URL: checkedConfig.publicWebUrl,
    };
    expect(validateFlyWebEnvironment(brandedWebEnvironment, checkedConfig)).toBe(
      brandedWebEnvironment,
    );
    expect(() =>
      validateFlyWebEnvironment(
        { ...webEnvironment, OPENROUND_PUBLIC_URL: "https://wrong.example.test" },
        checkedConfig,
      ),
    ).toThrow("OPENROUND_PUBLIC_URL");
    expect(serverEnvironment.FEATURE_RECOVERY_PACK_LIVE_CARDS).toBe("false");
    expect(serverEnvironment.FEATURE_PRESENTATION_COMPANION).toBe("false");
    expect(() =>
      validateFlyRuntimeEnvironment(
        { ...serverEnvironment, FEATURE_PRESENTATION_COMPANION: "true" },
        checkedConfig,
      ),
    ).toThrow("Fly [env] FEATURE_PRESENTATION_COMPANION must be false");
    const missingCompanionFlag = { ...serverEnvironment };
    Reflect.deleteProperty(missingCompanionFlag, "FEATURE_PRESENTATION_COMPANION");
    expect(() => validateFlyRuntimeEnvironment(missingCompanionFlag, checkedConfig)).toThrow(
      "Fly [env] FEATURE_PRESENTATION_COMPANION must be false",
    );
    expect(() =>
      validateFlyRuntimeEnvironment(
        { ...serverEnvironment, FEATURE_RECOVERY_PACK_LIVE_CARDS: "true" },
        checkedConfig,
      ),
    ).toThrow("Fly [env] FEATURE_RECOVERY_PACK_LIVE_CARDS must be false");
    const missingLiveCardsFlag = { ...serverEnvironment };
    Reflect.deleteProperty(missingLiveCardsFlag, "FEATURE_RECOVERY_PACK_LIVE_CARDS");
    expect(() => validateFlyRuntimeEnvironment(missingLiveCardsFlag, checkedConfig)).toThrow(
      "Fly [env] FEATURE_RECOVERY_PACK_LIVE_CARDS must be false",
    );
    expect(serverEnvironment.OPENROUND_DEPLOYMENT_ENVIRONMENT).toBe("staging");
    expect(() =>
      validateFlyRuntimeEnvironment(
        { ...serverEnvironment, OPENROUND_DEPLOYMENT_ENVIRONMENT: "production" },
        checkedConfig,
      ),
    ).toThrow("Fly [env] OPENROUND_DEPLOYMENT_ENVIRONMENT must be staging");
    const missingEnvironment = { ...serverEnvironment };
    Reflect.deleteProperty(missingEnvironment, "OPENROUND_DEPLOYMENT_ENVIRONMENT");
    expect(() => validateFlyRuntimeEnvironment(missingEnvironment, checkedConfig)).toThrow(
      "Fly [env] OPENROUND_DEPLOYMENT_ENVIRONMENT must be staging",
    );
    expect(() =>
      validateFlyRuntimeEnvironment(
        { ...serverEnvironment, DATABASE_URL: "postgresql://secret" },
        checkedConfig,
      ),
    ).toThrow(/unsupported key DATABASE_URL|secret-bearing key DATABASE_URL/);
    expect(() =>
      validateFlyWebEnvironment(
        { ...webEnvironment, NEXT_PUBLIC_API_URL: "https://wrong.example.test" },
        checkedConfig,
      ),
    ).toThrow("NEXT_PUBLIC_API_URL");

    const productionServerEnvironment = parseFlyTomlEnvironment(
      await readFile(join(repositoryRoot, "config/deploy/fly/production-server.toml"), "utf8"),
    );
    const checkedProductionConfig = validateDeployConfig(
      {
        ...productionConfig(),
        publicWebUrl: "https://openround-ca-web.fly.dev",
        publicApiUrl: "https://openround-ca-server.fly.dev",
        imageRepository: "ghcr.io/riojung/openround/openround",
        fly: {
          serverApp: "openround-ca-server",
          webApp: "openround-ca-web",
          serverConfig: "config/deploy/fly/production-server.toml",
          webConfig: "config/deploy/fly/production-web.toml",
        },
      },
      "production",
    );
    expect(productionServerEnvironment.OPENROUND_DEPLOYMENT_ENVIRONMENT).toBe("production");
    expect(productionServerEnvironment.FEATURE_RECOVERY_PACK_LIVE_CARDS).toBe("false");
    expect(
      validateFlyRuntimeEnvironment(productionServerEnvironment, checkedProductionConfig),
    ).toBe(productionServerEnvironment);
  });

  it("validates single-VM targets, strict SSH arguments, and safe runtime values", () => {
    const config = validateDeployConfig(singleVmConfig(), "staging");
    expect(validateSingleVmConfig(config.singleVm)).toBe(config.singleVm);
    expect(
      sshArgv(config.singleVm, "/reviewed/known_hosts", [
        "sh",
        "-se",
        "--",
        config.singleVm.deployPath,
        config.singleVm.projectName,
      ]),
    ).toEqual(
      expect.arrayContaining([
        "StrictHostKeyChecking=yes",
        "UserKnownHostsFile=/reviewed/known_hosts",
        `openround@${stagingTarget.sshHost}`,
      ]),
    );
    expect(validateSingleVmRuntimeValues(singleVmRuntimeEnvironment(), config)).toBe(true);
    expect(() =>
      validateSingleVmRuntimeValues(
        singleVmRuntimeEnvironment().replace(
          "OPENROUND_DEPLOYMENT_ENVIRONMENT=staging",
          "OPENROUND_DEPLOYMENT_ENVIRONMENT=production",
        ),
        config,
      ),
    ).toThrow("OPENROUND_DEPLOYMENT_ENVIRONMENT must match");
    for (const unsafeCommunityMode of ["", "COMMUNITY_MODE=true\n"]) {
      expect(() =>
        validateSingleVmRuntimeValues(
          singleVmRuntimeEnvironment().replace("COMMUNITY_MODE=false\n", unsafeCommunityMode),
          config,
        ),
      ).toThrow("COMMUNITY_MODE must be false");
    }
    expect(() =>
      validateSingleVmRuntimeValues(
        singleVmRuntimeEnvironment().replace("NODE_ENV=production", "NODE_ENV=development"),
        config,
      ),
    ).toThrow("NODE_ENV must be production");
    expect(() =>
      validateSingleVmRuntimeValues(
        singleVmRuntimeEnvironment().replace(
          `OPENROUND_APP_DOMAIN=${stagingTarget.appHost}`,
          "OPENROUND_APP_DOMAIN=attacker.example",
        ),
        config,
      ),
    ).toThrow("must match the reviewed");
    expect(() =>
      validateSingleVmRuntimeValues(
        singleVmRuntimeEnvironment().replace(
          "POSTGRES_OWNER_PASSWORD=owner-secret",
          "POSTGRES_OWNER_PASSWORD=replace-owner-secret",
        ),
        config,
      ),
    ).toThrow("POSTGRES_OWNER_PASSWORD must contain a non-placeholder value");
    expect(() =>
      validateSingleVmRuntimeValues(
        singleVmRuntimeEnvironment().replace(
          "MINIO_APP_SECRET_KEY=minio-app-secret",
          "MINIO_APP_SECRET_KEY=   ",
        ),
        config,
      ),
    ).toThrow("MINIO_APP_SECRET_KEY must contain a non-placeholder value");
    expect(() =>
      validateSingleVmRuntimeValues(
        singleVmRuntimeEnvironment().replace(
          `OPENROUND_MEDIA_DOMAIN=${stagingTarget.mediaHost}`,
          `OPENROUND_MEDIA_DOMAIN=${stagingTarget.appHost}`,
        ),
        config,
      ),
    ).toThrow("must match the reviewed media origin");
    expect(() =>
      validateSingleVmRuntimeValues(
        singleVmRuntimeEnvironment().replace(
          "OTEL_EXPORTER_OTLP_TRACES_ENDPOINT=http://otel-collector:4318/v1/traces\n",
          "",
        ),
        config,
      ),
    ).toThrow("must contain a non-placeholder value when tracing is enabled");
    for (const endpoint of [
      "http://localhost:4318/v1/traces",
      "https://127.0.0.2:4318/v1/traces",
      "http://[::1]:4318/v1/traces",
      "http://0.0.0.0:4318/v1/traces",
      "http://[::ffff:127.0.0.1]:4318/v1/traces",
      "http://[::ffff:0.0.0.0]:4318/v1/traces",
      "http://collector.localhost.:4318/v1/traces",
      "https://collector.openround.ca.:4318/v1/traces",
      "https://collector.example/v1/traces",
    ]) {
      expect(() =>
        validateSingleVmRuntimeValues(
          singleVmRuntimeEnvironment().replace(
            "OTEL_EXPORTER_OTLP_TRACES_ENDPOINT=http://otel-collector:4318/v1/traces",
            `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT=${endpoint}`,
          ),
          config,
        ),
      ).toThrow("must not use a reserved, placeholder, loopback, or unspecified address");
    }
    expect(() =>
      validateSingleVmRuntimeValues(
        singleVmRuntimeEnvironment().replace(
          "OTEL_EXPORTER_OTLP_TRACES_ENDPOINT=http://otel-collector:4318/v1/traces",
          "OTEL_EXPORTER_OTLP_TRACES_ENDPOINT=https://REPLACE-collector.openround.ca/v1/traces",
        ),
        config,
      ),
    ).toThrow("must contain a non-placeholder value when tracing is enabled");
    expect(() =>
      validateSingleVmRuntimeValues(
        singleVmRuntimeEnvironment().replace("TRACING_ENABLED=true", "TRACING_ENABLED=enabled"),
        config,
      ),
    ).toThrow("TRACING_ENABLED must be true or false");
    expect(() =>
      validateSingleVmRuntimeValues(
        singleVmRuntimeEnvironment().replace(
          "OTEL_EXPORTER_OTLP_TRACES_ENDPOINT=http://otel-collector:4318/v1/traces",
          "OTEL_EXPORTER_OTLP_TRACES_ENDPOINT=ftp://collector.test.openround.ca/traces",
        ),
        config,
      ),
    ).toThrow("must be a credential-free HTTP(S) URL");
    expect(() =>
      validateSingleVmRuntimeValues(
        singleVmRuntimeEnvironment().replace("METRICS_ENABLED=true", "METRICS_ENABLED=false"),
        config,
      ),
    ).toThrow("METRICS_ENABLED must be true");
    expect(() =>
      validateSingleVmRuntimeValues(
        singleVmRuntimeEnvironment().replace(
          "OPENROUND_LOG_SHIPPING_MODE=external-host-agent",
          "OPENROUND_LOG_SHIPPING_MODE=disabled",
        ),
        config,
      ),
    ).toThrow("OPENROUND_LOG_SHIPPING_MODE must be external-host-agent");
    expect(() =>
      validateSingleVmRuntimeValues(
        singleVmRuntimeEnvironment().replace("TRACING_ENABLED=true", "TRACING_ENABLED=false"),
        config,
      ),
    ).toThrow("TRACING_ENABLED must be true");
    expect(() =>
      validateSingleVmRuntimeValues(
        singleVmRuntimeEnvironment().replace(
          "OTEL_EXPORTER_OTLP_TRACES_ENDPOINT=http://otel-collector:4318/v1/traces",
          "OTEL_EXPORTER_OTLP_TRACES_ENDPOINT=https://collector.openround.ca/v1/traces",
        ),
        config,
      ),
    ).toThrow("must use the private single-VM collector endpoint");
    expect(() =>
      validateSingleVmRuntimeValues(
        singleVmRuntimeEnvironment().replace(
          "OPENROUND_OTLP_BACKEND_ENDPOINT=https://telemetry.test.openround.ca",
          "OPENROUND_OTLP_BACKEND_ENDPOINT=http://telemetry.test.openround.ca",
        ),
        config,
      ),
    ).toThrow("OPENROUND_OTLP_BACKEND_ENDPOINT must be a credential-free HTTPS URL");
    expect(() =>
      validateSingleVmRuntimeValues(
        singleVmRuntimeEnvironment().replace(
          "OPENROUND_OTLP_BACKEND_ENDPOINT=https://telemetry.test.openround.ca",
          "OPENROUND_OTLP_BACKEND_ENDPOINT=https://telemetry.test.openround.ca/v1/traces",
        ),
        config,
      ),
    ).toThrow("must be the OTLP/HTTP base endpoint without a signal suffix");
    expect(() =>
      validateSingleVmRuntimeValues(
        singleVmRuntimeEnvironment().replace(
          "OPENROUND_PAGING_WEBHOOK_URL=https://paging.test.openround.ca/openround",
          "OPENROUND_PAGING_WEBHOOK_URL=https://paging.test.openround.ca./openround",
        ),
        config,
      ),
    ).toThrow("OPENROUND_PAGING_WEBHOOK_URL must not use a reserved");
    expect(() =>
      validateSingleVmRuntimeValues(
        singleVmRuntimeEnvironment().replace(
          "OPENROUND_PAGING_WEBHOOK_URL=https://paging.test.openround.ca/openround",
          "OPENROUND_PAGING_WEBHOOK_URL=https://paging.example.invalid/openround",
        ),
        config,
      ),
    ).toThrow("OPENROUND_PAGING_WEBHOOK_URL must not use a reserved");
    expect(() =>
      validateSingleVmRuntimeValues(
        singleVmRuntimeEnvironment()
          .replace(
            "OPENROUND_WARNING_WEBHOOK_URL=https://warnings.test.openround.ca/openround",
            "OPENROUND_WARNING_WEBHOOK_URL=https://paging.test.openround.ca/openround",
          )
          .replace(
            "OPENROUND_TICKET_WEBHOOK_URL=https://tickets.test.openround.ca/openround",
            "OPENROUND_TICKET_WEBHOOK_URL=https://paging.test.openround.ca/openround",
          ),
        config,
      ),
    ).toThrow("page, warning, and ticket receiver URLs must be distinct");
    expect(() =>
      validateDeployConfig(
        {
          ...singleVmConfig(),
          singleVm: { ...singleVmConfig().singleVm, host: "host;touch-pwned" },
        },
        "staging",
      ),
    ).toThrow("singleVm.host");
    expect(() =>
      validateDeployConfig(
        {
          ...singleVmConfig(),
          singleVm: {
            ...singleVmConfig().singleVm,
            composeFiles: ["compose.single-vm.yaml\n../../unreviewed.yaml"],
          },
        },
        "staging",
      ),
    ).toThrow("safe repository-relative path");
    expect(assertRemoteTargetNotActive(undefined, buildId)).toBe(true);
    expect(() => assertRemoteTargetNotActive(buildId, buildId)).toThrow("already the active");
    expect(assertRemoteRollbackSource(buildId, buildId)).toBe(true);
    expect(() => assertRemoteRollbackSource("b".repeat(40), buildId)).toThrow(
      "is not the active single-VM release",
    );
  });

  it("hashes the reviewed runtime input without retaining its secret values", () => {
    const content = singleVmRuntimeEnvironment();
    const digest = runtimeEnvironmentSha256(content);

    expect(digest).toMatch(/^[0-9a-f]{64}$/);
    expect(digest).not.toContain("backend-token");
    expect(runtimeEnvironmentSha256(content)).toBe(digest);
    expect(runtimeEnvironmentSha256(`${content}# reviewed change\n`)).not.toBe(digest);
  });

  it("accepts only the redaction-safe deployed configuration summary", () => {
    const config = validateDeployConfig(singleVmConfig(), "staging");
    const summary = receiptConfigCheckSummary(config);

    expect(validateReceiptConfigCheckSummary(summary, config, buildId)).toBe(summary);
    expect(() =>
      validateReceiptConfigCheckSummary({ ...summary, metrics: "disabled" }, config, buildId),
    ).toThrow("unexpected metrics");
    expect(() =>
      validateReceiptConfigCheckSummary(
        { ...summary, databaseUrl: "postgresql://secret@example.test/openround" },
        config,
        buildId,
      ),
    ).toThrow("unexpected field set");
    expect(() =>
      validateReceiptConfigCheckSummary(
        { ...summary, featureFlags: { ...summary.featureFlags, secret: true } },
        config,
        buildId,
      ),
    ).toThrow("feature flags contains an unexpected field set");
  });

  it("preserves older receipt summaries and accepts only boolean optional rollout flags", () => {
    const config = validateDeployConfig(singleVmConfig(), "staging");
    const oldSummary = receiptConfigCheckSummary(config);
    const original = JSON.stringify(oldSummary);

    expect(validateReceiptConfigCheckSummary(oldSummary, config, buildId)).toBe(oldSummary);
    expect(JSON.stringify(oldSummary)).toBe(original);
    expect(oldSummary.featureFlags).not.toHaveProperty("liveFlexMode");
    expect(oldSummary.featureFlags).not.toHaveProperty("recoveryPackLiveCards");
    expect(oldSummary.featureFlags).not.toHaveProperty("presentationCompanion");
    expect(() =>
      validateReceiptConfigCheckSummary(
        {
          ...oldSummary,
          featureFlags: {
            ...oldSummary.featureFlags,
            liveFlexMode: false,
            recoveryPackLiveCards: false,
            unreviewedFlag: false,
          },
        },
        config,
        buildId,
      ),
    ).toThrow("feature flags contains an unexpected field set");
    for (const flag of [
      "liveFlexMode",
      "recoveryPackLiveCards",
      "presentationCompanion",
      "roundClientProtocol",
      "sessionSummaries",
      "ideaBoards",
      "canvasBoards",
      "canvasBoardSharing",
      "canvasBoardRealtime",
    ]) {
      for (const value of [false, true]) {
        const summary = {
          ...oldSummary,
          featureFlags: { ...oldSummary.featureFlags, [flag]: value },
        };
        expect(validateReceiptConfigCheckSummary(summary, config, buildId)).toBe(summary);
      }
      for (const value of ["false", 0, null, undefined]) {
        expect(() =>
          validateReceiptConfigCheckSummary(
            { ...oldSummary, featureFlags: { ...oldSummary.featureFlags, [flag]: value } },
            config,
            buildId,
          ),
        ).toThrow(`invalid feature flag ${flag}`);
      }
    }
  });

  it("accepts the current server's redaction-safe configuration summary", () => {
    const config = validateDeployConfig(singleVmConfig(), "staging");
    const serverConfig = ConfigSchema.parse({
      NODE_ENV: "test",
      OPENROUND_BUILD_ID: buildId,
      PUBLIC_API_URL: config.publicApiUrl,
      WEB_ORIGIN: config.publicWebUrl,
      COMMUNITY_MODE: "false",
      DATABASE_URL: "postgresql://runtime:fixture@database.test/openround",
      REDIS_URL: "redis://cache.test:6379",
      SMTP_URL: "smtp://mail.test:1025",
      BILLING_MODE: config.billingMode,
      S3_ENDPOINT: "http://storage.test:9000",
      MEDIA_SCAN_MODE: "clamav",
      CLAMAV_HOST: "clamav.test",
      METRICS_ENABLED: "true",
      METRICS_TOKEN: "fixture-metrics-token-long-enough",
      OPENROUND_LOG_SHIPPING_MODE: "external-host-agent",
      TRACING_ENABLED: "true",
      OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: "http://collector.test:4318/v1/traces",
      FEATURE_LIVE_FLEX_MODE: "true",
      FEATURE_RECOVERY_PACK_LIVE_CARDS: "true",
      FEATURE_PRESENTATION_COMPANION: "true",
      FEATURE_ROUND_CLIENT_PROTOCOL: "true",
      FEATURE_IDEA_BOARDS: "true",
      FEATURE_CANVAS_BOARDS: "true",
      FEATURE_CANVAS_BOARD_SHARING: "true",
      FEATURE_CANVAS_BOARD_REALTIME: "true",
    });
    const summary = createConfigCheckSummary({ ...serverConfig, NODE_ENV: "production" });

    expect(summary.featureFlags.liveFlexMode).toBe(true);
    expect(summary.featureFlags.recoveryPackLiveCards).toBe(true);
    expect(summary.featureFlags.presentationCompanion).toBe(true);
    expect(summary.featureFlags.roundClientProtocol).toBe(true);
    expect(summary.featureFlags.ideaBoards).toBe(true);
    expect(summary.featureFlags.canvasBoards).toBe(true);
    expect(summary.featureFlags.canvasBoardSharing).toBe(true);
    expect(summary.featureFlags.canvasBoardRealtime).toBe(true);
    expect(validateReceiptConfigCheckSummary(summary, config, buildId)).toBe(summary);
  });

  it("accepts only a complete bounded core-parity group without changing legacy receipt hashes", () => {
    const config = validateDeployConfig(singleVmConfig(), "staging");
    const legacy = receiptConfigCheckSummary(config);
    const legacyBytes = JSON.stringify(legacy);
    expect(() =>
      validateEnvFileKeys(
        `${singleVmRuntimeEnvironment()}\nFEATURE_AUDIENCE_SCOPES=false\nFEATURE_ROUND_CLIENT_PROTOCOL=false\nFEATURE_FEEDBACK_ROOMS=false\nFEATURE_SURVEYS=false\nFEATURE_FEEDBACK_EXPORTS=false\nFEATURE_SESSION_SUMMARIES=false\nCORE_PARITY_WORKSPACE_ALLOWLIST=\n`,
        "single-vm-runtime",
      ),
    ).not.toThrow();
    const flags = {
      roundClientProtocol: false,
      audienceScopes: false,
      feedbackRooms: false,
      surveys: false,
      feedbackExports: false,
    };
    const current = {
      ...legacy,
      coreParityWorkspaceAllowlistSize: 0,
      featureFlags: { ...legacy.featureFlags, ...flags },
    };
    expect(validateReceiptConfigCheckSummary(current, config, buildId)).toBe(current);
    expect(validateReceiptConfigCheckSummary(legacy, config, buildId)).toBe(legacy);
    expect(JSON.stringify(legacy)).toBe(legacyBytes);
    for (const count of [-1, 1_001, 0.5, "0", null]) {
      expect(() =>
        validateReceiptConfigCheckSummary(
          { ...current, coreParityWorkspaceAllowlistSize: count },
          config,
          buildId,
        ),
      ).toThrow("invalid coreParityWorkspaceAllowlistSize");
    }
    expect(() =>
      validateReceiptConfigCheckSummary(
        { ...legacy, coreParityWorkspaceAllowlistSize: 0 },
        config,
        buildId,
      ),
    ).toThrow("unexpected field set");
    expect(() =>
      validateReceiptConfigCheckSummary(
        { ...legacy, featureFlags: current.featureFlags },
        config,
        buildId,
      ),
    ).toThrow("unexpected field set");
    expect(() =>
      validateReceiptConfigCheckSummary(
        { ...current, coreParityWorkspaceAllowlist: ["private-id"] },
        config,
        buildId,
      ),
    ).toThrow("unexpected field set");
    const flyConfig = validateDeployConfig(stagingConfig(), "staging");
    const fly = {
      ...current,
      publicApiUrl: flyConfig.publicApiUrl,
      webOrigin: flyConfig.publicWebUrl,
      metrics: "disabled",
      featureFlags: {
        ...current.featureFlags,
        signups: false,
        roundExperiences: false,
        audiencePulse: false,
        roomChat: false,
      },
    };
    expect(() => assertConfigCheckSummary(fly, flyConfig, buildId)).not.toThrow();
    for (const flag of [
      ...Object.keys(flags),
      "sessionSummaries",
      "ideaBoards",
      "canvasBoards",
      "canvasBoardSharing",
      "canvasBoardRealtime",
    ]) {
      expect(() =>
        assertConfigCheckSummary(
          { ...fly, featureFlags: { ...fly.featureFlags, [flag]: true } },
          flyConfig,
          buildId,
        ),
      ).toThrow(`feature flag ${flag} enabled`);
    }
  });

  it("keeps exact Fly live-card checks disabled while accepting older rollback image summaries", () => {
    const config = validateDeployConfig(stagingConfig(), "staging");
    const summary = receiptConfigCheckSummary(config);
    const flySummary = {
      ...summary,
      metrics: "disabled",
      featureFlags: {
        ...summary.featureFlags,
        signups: false,
        roundExperiences: false,
        audiencePulse: false,
        roomChat: false,
      },
    };
    expect(() => assertConfigCheckSummary(flySummary, config, buildId)).not.toThrow();
    expect(() =>
      assertConfigCheckSummary(
        {
          ...flySummary,
          featureFlags: { ...flySummary.featureFlags, recoveryPackLiveCards: false },
        },
        config,
        buildId,
      ),
    ).not.toThrow();
    for (const recoveryPackLiveCards of [true, "false", null, undefined]) {
      expect(() =>
        assertConfigCheckSummary(
          { ...flySummary, featureFlags: { ...flySummary.featureFlags, recoveryPackLiveCards } },
          config,
          buildId,
        ),
      ).toThrow("left feature flag recoveryPackLiveCards enabled");
    }
    for (const presentationCompanion of [true, "false", null, undefined]) {
      expect(() =>
        assertConfigCheckSummary(
          { ...flySummary, featureFlags: { ...flySummary.featureFlags, presentationCompanion } },
          config,
          buildId,
        ),
      ).toThrow("left feature flag presentationCompanion enabled");
    }
  });

  it("requires a valid pinned key for the exact SSH target", async () => {
    const artifactsRoot = join(repositoryRoot, "artifacts");
    await mkdir(artifactsRoot, { recursive: true });
    const fixtureRoot = await mkdtemp(join(artifactsRoot, "known hosts validation "));
    const keyPath = join(fixtureRoot, "host-key");
    const revokedKeyPath = join(fixtureRoot, "revoked-host-key");
    const knownHostsPath = join(fixtureRoot, "known_hosts");
    try {
      await Promise.all(
        [keyPath, revokedKeyPath].map((path) =>
          run("ssh-keygen", ["-q", "-t", "ed25519", "-N", "", "-f", path], {
            capture: true,
          }),
        ),
      );
      const publicKey = (await readFile(`${keyPath}.pub`, "utf8"))
        .trim()
        .split(/\s+/)
        .slice(0, 2)
        .join(" ");
      const revokedPublicKey = (await readFile(`${revokedKeyPath}.pub`, "utf8"))
        .trim()
        .split(/\s+/)
        .slice(0, 2)
        .join(" ");
      const singleVm = singleVmConfig().singleVm;

      await writeFile(knownHostsPath, `${singleVm.host} ${publicKey}\n`);
      await expect(assertKnownHostsTarget(knownHostsPath, singleVm)).resolves.toBe(true);

      const uppercaseHost = { ...singleVm, host: singleVm.host.toUpperCase() };
      await expect(assertKnownHostsTarget(knownHostsPath, uppercaseHost)).resolves.toBe(true);

      await run("ssh-keygen", ["-H", "-f", knownHostsPath], { capture: true });
      await expect(assertKnownHostsTarget(knownHostsPath, singleVm)).resolves.toBe(true);

      await writeFile(knownHostsPath, `*.test.openround.ca ${publicKey}\n`);
      await expect(assertKnownHostsTarget(knownHostsPath, singleVm)).rejects.toThrow(
        `must use an exact host-key pin for ${singleVm.host}`,
      );

      await writeFile(knownHostsPath, `@cert-authority ${singleVm.host} ${publicKey}\n`);
      await expect(assertKnownHostsTarget(knownHostsPath, singleVm)).rejects.toThrow(
        `must use an exact host-key pin for ${singleVm.host}`,
      );

      await writeFile(knownHostsPath, `# ${singleVm.host} has not been reviewed\n`);
      await expect(assertKnownHostsTarget(knownHostsPath, singleVm)).rejects.toThrow(
        `must contain a valid host key for ${singleVm.host}`,
      );

      await writeFile(knownHostsPath, `other.test.openround.ca ${publicKey}\n`);
      await expect(assertKnownHostsTarget(knownHostsPath, singleVm)).rejects.toThrow(
        `must contain a valid host key for ${singleVm.host}`,
      );

      await writeFile(knownHostsPath, `${singleVm.host} ssh-ed25519 not-valid-base64\n`);
      await expect(assertKnownHostsTarget(knownHostsPath, singleVm)).rejects.toThrow(
        `must contain a valid host key for ${singleVm.host}`,
      );

      await writeFile(knownHostsPath, `@revoked ${singleVm.host} ${publicKey}\n`);
      await expect(assertKnownHostsTarget(knownHostsPath, singleVm)).rejects.toThrow(
        `must contain a valid host key for ${singleVm.host}`,
      );

      await writeFile(
        knownHostsPath,
        `${singleVm.host} ${publicKey}\n@revoked ${singleVm.host} ${publicKey}\n`,
      );
      await expect(assertKnownHostsTarget(knownHostsPath, singleVm)).rejects.toThrow(
        `must not revoke a pinned host key for ${singleVm.host}`,
      );

      await writeFile(
        knownHostsPath,
        `${singleVm.host} ${publicKey}\n@revoked ${singleVm.host} ${revokedPublicKey}\n`,
      );
      await expect(assertKnownHostsTarget(knownHostsPath, singleVm)).resolves.toBe(true);

      const nonDefaultPort = { ...singleVm, port: 2222 };
      await writeFile(knownHostsPath, `[${singleVm.host}]:2222 ${publicKey}\n`);
      await expect(assertKnownHostsTarget(knownHostsPath, nonDefaultPort)).resolves.toBe(true);

      const uppercaseNonDefaultPort = { ...nonDefaultPort, host: singleVm.host.toUpperCase() };
      await expect(assertKnownHostsTarget(knownHostsPath, uppercaseNonDefaultPort)).resolves.toBe(
        true,
      );
    } finally {
      await rm(fixtureRoot, { recursive: true, force: true });
    }
  });

  it("requires normal single-VM targets to descend from the active remote build", async () => {
    await withReviewedDeploymentGitState(async ({ head, parent }) => {
      const parentTree = (
        await run("git", ["rev-parse", `${parent}^{tree}`], {
          cwd: repositoryRoot,
          capture: true,
        })
      ).stdout.trim();
      const divergentBuild = (
        await run("git", ["commit-tree", parentTree, "-p", parent, "-m", "divergent release"], {
          cwd: repositoryRoot,
          capture: true,
        })
      ).stdout.trim();
      await expect(verifyForwardDeploymentAncestry(undefined, head)).resolves.toBe(true);
      await expect(verifyForwardDeploymentAncestry(parent, head)).resolves.toBe(true);
      await expect(verifyForwardDeploymentAncestry(head, parent)).rejects.toThrow(
        "Normal deployment target must descend from the active remote build",
      );
      await expect(verifyForwardDeploymentAncestry(head, divergentBuild)).rejects.toThrow(
        "Normal deployment target must descend from the active remote build",
      );
    });
  });

  it("keeps every remote single-VM script valid POSIX shell", async () => {
    for (const script of [
      REMOTE_PREPARE_SCRIPT,
      REMOTE_WRITE_SCRIPT,
      REMOTE_CURRENT_BUILD_SCRIPT,
      REMOTE_CONFIG_SUMMARY_SCRIPT,
      REMOTE_DEACTIVATE_FAILED_CURRENT_SCRIPT,
      REMOTE_DEPLOY_SCRIPT,
      REMOTE_RESTORE_PREVIOUS_SCRIPT,
      REMOTE_REMOVE_INCOMING_SCRIPT,
      REMOTE_SERVICE_SCRIPT,
    ]) {
      await expect(run("sh", ["-n"], { capture: true, input: script })).resolves.toMatchObject({
        code: 0,
      });
    }
  });

  it("sweeps only stale unlocked incoming deployments", async () => {
    const artifactsRoot = join(repositoryRoot, "artifacts");
    await mkdir(artifactsRoot, { recursive: true });
    const fixtureRoot = await mkdtemp(join(artifactsRoot, "remote-incoming-sweep-"));
    const remoteRoot = join(fixtureRoot, "remote");
    const incomingRoot = join(remoteRoot, "incoming");
    try {
      const stale = join(incomingRoot, "stale-upload");
      const fresh = join(incomingRoot, "fresh-upload");
      await mkdir(stale, { recursive: true });
      await mkdir(fresh, { recursive: true });
      const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1_000);
      await utimes(stale, twoDaysAgo, twoDaysAgo);

      await run("sh", ["-se", "--", remoteRoot, "candidate-one"], {
        capture: true,
        input: REMOTE_PREPARE_SCRIPT,
      });
      const sweptEntries = await readdir(incomingRoot);
      expect(sweptEntries).not.toContain("stale-upload");
      expect(sweptEntries).toEqual(expect.arrayContaining(["candidate-one", "fresh-upload"]));

      const lockedStale = join(incomingRoot, "locked-stale-upload");
      await mkdir(lockedStale);
      await utimes(lockedStale, twoDaysAgo, twoDaysAgo);
      await mkdir(join(remoteRoot, ".deploy.lock"));
      await run("sh", ["-se", "--", remoteRoot, "candidate-two"], {
        capture: true,
        input: REMOTE_PREPARE_SCRIPT,
      });
      expect(await readdir(incomingRoot)).toContain("locked-stale-upload");
    } finally {
      await rm(fixtureRoot, { recursive: true, force: true });
    }
  });

  it("tears down a partially started first release", async () => {
    const artifactsRoot = join(repositoryRoot, "artifacts");
    await mkdir(artifactsRoot, { recursive: true });
    const fixtureRoot = await mkdtemp(join(artifactsRoot, "remote-first-release-failure-"));
    const remoteRoot = join(fixtureRoot, "remote");
    const token = "first-release-token";
    const incoming = join(remoteRoot, "incoming", token);
    const fakeBin = join(fixtureRoot, "bin");
    const dockerLog = join(fixtureRoot, "docker.log");
    try {
      await mkdir(incoming, { recursive: true });
      await mkdir(fakeBin, { recursive: true });
      await writeFile(join(incoming, ".compose-files"), "compose.single-vm.yaml\n");
      await writeFile(join(incoming, "compose.single-vm.yaml"), "services: {}\n");
      await writeFile(join(incoming, ".env"), `OPENROUND_BUILD_ID=${buildId}\n`, {
        mode: 0o600,
      });
      await writeFile(
        join(incoming, ".migration.env"),
        "DATABASE_MIGRATION_URL=postgresql://owner\n",
        { mode: 0o600 },
      );
      const fakeDocker = join(fakeBin, "docker");
      await writeFile(
        fakeDocker,
        [
          "#!/bin/sh",
          'printf "%s\\n" "$*" >> "$FAKE_DOCKER_LOG"',
          'case " $* " in',
          '  *" --entrypoint /bin/cat server /app/BUILD_ID "*|*" --entrypoint /bin/cat web /app/BUILD_ID "*) printf "%s\\n" "$FAKE_BUILD_ID" ;;',
          '  *" up --detach --wait --remove-orphans "*) exit 9 ;;',
          "esac",
          "exit 0",
          "",
        ].join("\n"),
      );
      await chmod(fakeDocker, 0o755);

      await expect(
        run(
          "sh",
          ["-se", "--", remoteRoot, "openround-staging", buildId, token, "0", "0", "none", "none"],
          {
            capture: true,
            input: REMOTE_DEPLOY_SCRIPT,
            env: {
              ...process.env,
              PATH: `${fakeBin}:${process.env.PATH ?? ""}`,
              FAKE_BUILD_ID: buildId,
              FAKE_DOCKER_LOG: dockerLog,
            },
          },
        ),
      ).rejects.toMatchObject({ exitCode: 9 });

      expect(await readFile(dockerLog, "utf8")).toContain("down --remove-orphans");
      await expect(readFile(join(remoteRoot, "current-build"), "utf8")).rejects.toThrow();
      await expect(
        readFile(join(remoteRoot, "releases", buildId, ".env"), "utf8"),
      ).rejects.toThrow();
      await expect(readFile(join(remoteRoot, ".deploy.lock", "pid"), "utf8")).rejects.toThrow();
    } finally {
      await rm(fixtureRoot, { recursive: true, force: true });
    }
  });

  it("preserves a committed release when post-commit maintenance is interrupted", async () => {
    const artifactsRoot = join(repositoryRoot, "artifacts");
    await mkdir(artifactsRoot, { recursive: true });
    const fixtureRoot = await mkdtemp(join(artifactsRoot, "remote-committed-interrupt-"));
    const remoteRoot = join(fixtureRoot, "remote");
    const token = "committed-release-token";
    const incoming = join(remoteRoot, "incoming", token);
    const fakeBin = join(fixtureRoot, "bin");
    const dockerLog = join(fixtureRoot, "docker.log");
    try {
      await mkdir(incoming, { recursive: true });
      await mkdir(fakeBin, { recursive: true });
      await writeFile(join(incoming, ".compose-files"), "compose.single-vm.yaml\n");
      await writeFile(join(incoming, "compose.single-vm.yaml"), "services: {}\n");
      await writeFile(join(incoming, ".env"), `OPENROUND_BUILD_ID=${buildId}\n`, {
        mode: 0o600,
      });
      await writeFile(
        join(incoming, ".migration.env"),
        "DATABASE_MIGRATION_URL=postgresql://owner\n",
        { mode: 0o600 },
      );
      const fakeDocker = join(fakeBin, "docker");
      const fakeMove = join(fakeBin, "mv");
      await writeFile(
        fakeDocker,
        [
          "#!/bin/sh",
          'printf "%s\\n" "$*" >> "$FAKE_DOCKER_LOG"',
          'case " $* " in',
          '  *" --entrypoint /bin/cat server /app/BUILD_ID "*|*" --entrypoint /bin/cat web /app/BUILD_ID "*) printf "%s\\n" "$FAKE_BUILD_ID" ;;',
          '  *" image prune "*) kill -TERM "$PPID"; sleep 1 ;;',
          "esac",
          "exit 0",
          "",
        ].join("\n"),
      );
      await writeFile(
        fakeMove,
        [
          "#!/bin/sh",
          'if [ "${1:-}" = "-Tf" ]; then',
          '  rm -f "$3"',
          '  exec /bin/mv -f "$2" "$3"',
          "fi",
          'exec /bin/mv "$@"',
          "",
        ].join("\n"),
      );
      await chmod(fakeDocker, 0o755);
      await chmod(fakeMove, 0o755);

      await expect(
        run(
          "sh",
          ["-se", "--", remoteRoot, "openround-staging", buildId, token, "0", "0", "none", "none"],
          {
            capture: true,
            input: REMOTE_DEPLOY_SCRIPT,
            env: {
              ...process.env,
              PATH: `${fakeBin}:${process.env.PATH ?? ""}`,
              FAKE_BUILD_ID: buildId,
              FAKE_DOCKER_LOG: dockerLog,
            },
          },
        ),
      ).rejects.toMatchObject({ exitCode: 143 });

      expect(await readlink(join(remoteRoot, "current"))).toBe(`releases/${buildId}`);
      expect((await readFile(join(remoteRoot, "current-build"), "utf8")).trim()).toBe(buildId);
      expect(await readFile(join(remoteRoot, "releases", buildId, ".env"), "utf8")).toContain(
        buildId,
      );

      await run("sh", ["-se", "--", remoteRoot, "openround-staging", buildId], {
        capture: true,
        input: REMOTE_DEACTIVATE_FAILED_CURRENT_SCRIPT,
        env: {
          ...process.env,
          PATH: `${fakeBin}:${process.env.PATH ?? ""}`,
          FAKE_BUILD_ID: buildId,
          FAKE_DOCKER_LOG: dockerLog,
        },
      });
      expect(await readFile(dockerLog, "utf8")).toContain("down --remove-orphans");
      await expect(readFile(join(remoteRoot, "current-build"), "utf8")).rejects.toThrow();
      await expect(
        readFile(join(remoteRoot, "releases", buildId, ".env"), "utf8"),
      ).rejects.toThrow();
    } finally {
      await rm(fixtureRoot, { recursive: true, force: true });
    }
  });

  it("activates a remote release with one-shot migration credentials and immutable state", async () => {
    const artifactsRoot = join(repositoryRoot, "artifacts");
    await mkdir(artifactsRoot, { recursive: true });
    const fixtureRoot = await mkdtemp(join(artifactsRoot, "remote-deployment-simulation-"));
    const remoteRoot = join(fixtureRoot, "remote");
    const token = "test-token";
    const incoming = join(remoteRoot, "incoming", token);
    const fakeBin = join(fixtureRoot, "bin");
    const dockerLog = join(fixtureRoot, "docker.log");
    const previousBuildId = "b".repeat(40);
    try {
      await mkdir(incoming, { recursive: true });
      await mkdir(fakeBin, { recursive: true });
      const previousRelease = join(remoteRoot, "releases", previousBuildId);
      await mkdir(previousRelease, { recursive: true });
      await writeFile(join(previousRelease, ".compose-files"), "compose.single-vm.yaml\n");
      await writeFile(join(previousRelease, "compose.single-vm.yaml"), "services: {}\n");
      await writeFile(join(previousRelease, ".env"), `OPENROUND_BUILD_ID=${previousBuildId}\n`, {
        mode: 0o600,
      });
      await symlink(`releases/${previousBuildId}`, join(remoteRoot, "current"));
      await writeFile(join(remoteRoot, "current-build"), `${previousBuildId}\n`);
      await mkdir(join(remoteRoot, "releases", "c".repeat(40)), { recursive: true });
      await mkdir(join(remoteRoot, "releases", "d".repeat(40)), { recursive: true });
      await mkdir(join(remoteRoot, "releases", `.replaced-${buildId}-stale`), {
        recursive: true,
      });
      await writeFile(join(incoming, ".compose-files"), "compose.single-vm.yaml\n");
      await writeFile(join(incoming, "compose.single-vm.yaml"), "services: {}\n");
      await writeFile(join(incoming, ".env"), `OPENROUND_BUILD_ID=${buildId}\n`, { mode: 0o600 });
      await writeFile(
        join(incoming, ".migration.env"),
        "DATABASE_MIGRATION_URL=postgresql://owner\n",
        { mode: 0o600 },
      );
      const fakeDocker = join(fakeBin, "docker");
      const fakeMove = join(fakeBin, "mv");
      await writeFile(
        fakeDocker,
        [
          "#!/bin/sh",
          'printf "%s\\n" "$*" >> "$FAKE_DOCKER_LOG"',
          'case " $* " in',
          '  *" --entrypoint /bin/cat server /app/BUILD_ID "*) printf "%s\\n" "${FAKE_SERVER_BUILD_ID:-$FAKE_BUILD_ID}" ;;',
          '  *" --entrypoint /bin/cat web /app/BUILD_ID "*) printf "%s\\n" "${FAKE_WEB_BUILD_ID:-$FAKE_BUILD_ID}" ;;',
          "esac",
          "exit 0",
          "",
        ].join("\n"),
      );
      await writeFile(
        fakeMove,
        [
          "#!/bin/sh",
          'if [ "${1:-}" = "-Tf" ]; then',
          '  rm -f "$3"',
          '  exec /bin/mv -f "$2" "$3"',
          "fi",
          'exec /bin/mv "$@"',
          "",
        ].join("\n"),
      );
      await chmod(fakeDocker, 0o755);
      await chmod(fakeMove, 0o755);

      await run(
        "sh",
        [
          "-se",
          "--",
          remoteRoot,
          "openround-staging",
          buildId,
          token,
          "0",
          "0",
          previousBuildId,
          "none",
        ],
        {
          capture: true,
          input: REMOTE_DEPLOY_SCRIPT,
          env: {
            ...process.env,
            PATH: `${fakeBin}:${process.env.PATH ?? ""}`,
            FAKE_BUILD_ID: buildId,
            FAKE_DOCKER_LOG: dockerLog,
          },
        },
      );

      const release = join(remoteRoot, "releases", buildId);
      const commands = await readFile(dockerLog, "utf8");
      expect(commands).toContain("config --quiet");
      expect(commands).toContain("run --rm --no-deps server node dist/config-check.js");
      expect(commands).toContain("--entrypoint /bin/cat server /app/BUILD_ID");
      expect(commands).toContain("--profile operations run --rm migrate");
      expect(commands).toContain("up --detach --wait --remove-orphans");
      await expect(readFile(join(release, ".migration.env"), "utf8")).rejects.toThrow();
      expect(await readlink(join(remoteRoot, "current"))).toBe(`releases/${buildId}`);
      expect((await readFile(join(remoteRoot, "current-build"), "utf8")).trim()).toBe(buildId);
      const retainedReleases = await readdir(join(remoteRoot, "releases"));
      expect(retainedReleases.some((entry) => entry.startsWith(".replaced-"))).toBe(false);
      expect(retainedReleases.filter((entry) => /^[a-f0-9]{40}$/.test(entry))).toHaveLength(3);

      await run("sh", ["-se", "--", remoteRoot, "openround-staging", previousBuildId], {
        capture: true,
        input: REMOTE_RESTORE_PREVIOUS_SCRIPT,
        env: {
          ...process.env,
          PATH: `${fakeBin}:${process.env.PATH ?? ""}`,
          FAKE_BUILD_ID: buildId,
          FAKE_DOCKER_LOG: dockerLog,
        },
      });
      expect(await readlink(join(remoteRoot, "current"))).toBe(`releases/${previousBuildId}`);
      expect(await readlink(join(remoteRoot, "previous"))).toBe(`releases/${buildId}`);
      expect((await readFile(join(remoteRoot, "current-build"), "utf8")).trim()).toBe(
        previousBuildId,
      );

      await expect(
        run(
          "sh",
          [
            "-se",
            "--",
            remoteRoot,
            "openround-staging",
            previousBuildId,
            "concurrent-token",
            "0",
            "1",
            previousBuildId,
            previousBuildId,
          ],
          {
            capture: true,
            input: REMOTE_DEPLOY_SCRIPT,
            env: {
              ...process.env,
              PATH: `${fakeBin}:${process.env.PATH ?? ""}`,
              FAKE_BUILD_ID: previousBuildId,
              FAKE_DOCKER_LOG: dockerLog,
            },
          },
        ),
      ).rejects.toMatchObject({
        exitCode: 70,
        stderr: expect.stringContaining("Target build is already active"),
      });
      expect(await readlink(join(remoteRoot, "current"))).toBe(`releases/${previousBuildId}`);

      await expect(
        run(
          "sh",
          [
            "-se",
            "--",
            remoteRoot,
            "openround-staging",
            buildId,
            "stale-deploy-token",
            "0",
            "0",
            "c".repeat(40),
            "none",
          ],
          {
            capture: true,
            input: REMOTE_DEPLOY_SCRIPT,
            env: {
              ...process.env,
              PATH: `${fakeBin}:${process.env.PATH ?? ""}`,
              FAKE_BUILD_ID: buildId,
              FAKE_DOCKER_LOG: dockerLog,
            },
          },
        ),
      ).rejects.toMatchObject({
        exitCode: 75,
        stderr: expect.stringContaining("Active build changed after deployment preflight"),
      });

      await expect(
        run(
          "sh",
          [
            "-se",
            "--",
            remoteRoot,
            "openround-staging",
            buildId,
            "stale-rollback-token",
            "0",
            "1",
            previousBuildId,
            "c".repeat(40),
          ],
          {
            capture: true,
            input: REMOTE_DEPLOY_SCRIPT,
            env: {
              ...process.env,
              PATH: `${fakeBin}:${process.env.PATH ?? ""}`,
              FAKE_BUILD_ID: buildId,
              FAKE_DOCKER_LOG: dockerLog,
            },
          },
        ),
      ).rejects.toMatchObject({
        exitCode: 71,
        stderr: expect.stringContaining("Rollback source is no longer active"),
      });

      const mismatchedBuildId = "c".repeat(40);
      const mismatchedToken = "mismatched-server-token";
      const mismatchedIncoming = join(remoteRoot, "incoming", mismatchedToken);
      await mkdir(mismatchedIncoming, { recursive: true });
      await writeFile(join(mismatchedIncoming, ".compose-files"), "compose.single-vm.yaml\n");
      await writeFile(join(mismatchedIncoming, "compose.single-vm.yaml"), "services: {}\n");
      await writeFile(
        join(mismatchedIncoming, ".env"),
        `OPENROUND_BUILD_ID=${mismatchedBuildId}\n`,
        { mode: 0o600 },
      );
      await writeFile(
        join(mismatchedIncoming, ".migration.env"),
        "DATABASE_MIGRATION_URL=postgresql://owner\n",
        { mode: 0o600 },
      );
      await writeFile(dockerLog, "");
      await expect(
        run(
          "sh",
          [
            "-se",
            "--",
            remoteRoot,
            "openround-staging",
            mismatchedBuildId,
            mismatchedToken,
            "0",
            "0",
            previousBuildId,
            "none",
          ],
          {
            capture: true,
            input: REMOTE_DEPLOY_SCRIPT,
            env: {
              ...process.env,
              PATH: `${fakeBin}:${process.env.PATH ?? ""}`,
              FAKE_BUILD_ID: mismatchedBuildId,
              FAKE_SERVER_BUILD_ID: "d".repeat(40),
              FAKE_WEB_BUILD_ID: mismatchedBuildId,
              FAKE_DOCKER_LOG: dockerLog,
            },
          },
        ),
      ).rejects.toMatchObject({
        exitCode: 67,
        stderr: expect.stringContaining("Server image BUILD_ID does not match release"),
      });
      expect(await readFile(dockerLog, "utf8")).not.toContain("--profile operations");
      expect(await readlink(join(remoteRoot, "current"))).toBe(`releases/${previousBuildId}`);
    } finally {
      await rm(fixtureRoot, { recursive: true, force: true });
    }
  });

  it("keeps remote lifecycle interrupts non-successful and releases the mutation lock", async () => {
    const artifactsRoot = join(repositoryRoot, "artifacts");
    await mkdir(artifactsRoot, { recursive: true });
    const fixtureRoot = await mkdtemp(join(artifactsRoot, "remote service signal simulation "));
    const remoteRoot = join(fixtureRoot, "remote");
    const release = join(remoteRoot, "releases", buildId);
    const fakeBin = join(fixtureRoot, "bin");
    try {
      await mkdir(release, { recursive: true });
      await mkdir(fakeBin, { recursive: true });
      await writeFile(join(release, ".compose-files"), "compose.single-vm.yaml\n");
      await writeFile(join(release, "compose.single-vm.yaml"), "services: {}\n");
      await writeFile(join(release, ".env"), `OPENROUND_BUILD_ID=${buildId}\n`, { mode: 0o600 });
      await symlink(`releases/${buildId}`, join(remoteRoot, "current"));
      const fakeDocker = join(fakeBin, "docker");
      await writeFile(
        fakeDocker,
        ["#!/bin/sh", 'kill -TERM "$PPID"', "sleep 1", "exit 0", ""].join("\n"),
      );
      await chmod(fakeDocker, 0o755);

      await expect(
        run("sh", ["-se", "--", remoteRoot, "openround-staging", "start", "0"], {
          capture: true,
          input: REMOTE_SERVICE_SCRIPT,
          env: { ...process.env, PATH: `${fakeBin}:${process.env.PATH ?? ""}` },
        }),
      ).rejects.toMatchObject({ exitCode: 143 });
      await expect(readFile(join(remoteRoot, ".deploy.lock", "pid"), "utf8")).rejects.toThrow();
    } finally {
      await rm(fixtureRoot, { recursive: true, force: true });
    }
  });
});

describe("local service command construction", () => {
  it("uses bounded, non-destructive Compose commands for the lifecycle actions", () => {
    const prefix = [
      "compose",
      "--project-name",
      "openround",
      "--file",
      "compose.yaml",
      "--file",
      "compose.business.yaml",
      "--file",
      "compose.local-control.yaml",
    ];
    expect(composeArgv("start")).toEqual([...prefix, "up", "--detach", "--build", "--wait"]);
    expect(composeArgv("stop")).toEqual([...prefix, "stop"]);
    expect(composeArgv("restart", { noBuild: true })).toEqual([
      ...prefix,
      "up",
      "--detach",
      "--force-recreate",
      "--no-build",
      "--wait",
    ]);
    expect(composeArgv("logs")).toEqual([...prefix, "logs", "--tail", "200"]);
    expect(composeArgv("logs", { follow: true })).toEqual([
      ...prefix,
      "logs",
      "--follow",
      "--tail",
      "200",
    ]);

    for (const action of ["start", "stop", "restart", "status", "logs"]) {
      const argv = composeArgv(action);
      expect(argv).not.toContain("down");
      expect(argv).not.toContain("--volumes");
    }
  });

  it("selects only the fixed Compose files for named profiles", () => {
    expect(composeArgv("status", { profile: "media" })).toContain("compose.media.yaml");
    const observability = composeArgv("status", { profile: "observability" });
    expect(observability).toEqual([
      "compose",
      "--project-name",
      "openround",
      "--file",
      "compose.yaml",
      "--file",
      "compose.business.yaml",
      "--file",
      "compose.local-control.yaml",
      "--file",
      "compose.media.yaml",
      "--file",
      "compose.observability.yaml",
      "--profile",
      "observability",
      "ps",
    ]);
    expect(() => composeArgv("start", { profile: "../../arbitrary" })).toThrow(
      "Unsupported Compose profile",
    );
  });
});

describe("operations CLI dry runs", () => {
  it("restores generated tracked files after successful and failed host builds", async () => {
    const artifactsRoot = join(repositoryRoot, "artifacts");
    await mkdir(artifactsRoot, { recursive: true });
    const fixtureRoot = await mkdtemp(join(artifactsRoot, "preserved-build-file "));
    const generatedPath = join(fixtureRoot, "generated.d.ts");
    try {
      await writeFile(generatedPath, "original\n");
      await withPreservedFiles([generatedPath], async () => {
        await writeFile(generatedPath, "generated\n");
      });
      expect(await readFile(generatedPath, "utf8")).toBe("original\n");

      await expect(
        withPreservedFiles([generatedPath], async () => {
          await writeFile(generatedPath, "failed build output\n");
          throw new Error("build failed");
        }),
      ).rejects.toThrow("build failed");
      expect(await readFile(generatedPath, "utf8")).toBe("original\n");
    } finally {
      await rm(fixtureRoot, { recursive: true, force: true });
    }
  });

  it("accepts development build and service dry runs without Docker", async () => {
    const buildOutput = await captureStdout(() => productBuildMain(["dev", "--dry-run"]));
    expect(buildOutput).toContain("pnpm check:docker-context");
    expect(buildOutput).toContain("pnpm build");
    expect(buildOutput).toContain("docker compose");
    expect(buildOutput).toContain("compose.local-control.yaml build server web control");
    expect(buildOutput).toContain("Dry run complete for development");

    const serviceOutput = await captureStdout(() =>
      serviceMain(["development", "restart", "--profile", "media", "--no-build", "--dry-run"]),
    );
    expect(serviceOutput).toContain("docker compose");
    expect(serviceOutput).toContain("compose.media.yaml");
    expect(serviceOutput).toContain("--force-recreate");
    expect(serviceOutput).not.toContain(" down ");
    expect(serviceOutput).not.toContain("--volumes");
  });

  it("rejects checked placeholder targets before hosted build, deploy, or service work", async () => {
    await expect(
      productBuildMain([
        "staging",
        "--api-url",
        "https://staging.pollingpops.example",
        "--registry",
        "ghcr.io/riojung/openround/openround",
        "--push",
        "--dry-run",
      ]),
    ).rejects.toThrow(
      "must not use a reserved example, placeholder, loopback, or unspecified hostname",
    );

    await withReviewedDeploymentGitState(async () => {
      await expect(serviceMain(["staging", "status", "--dry-run"])).rejects.toThrow(
        "must not use a reserved example, placeholder, loopback, or unspecified hostname",
      );
      await expect(deployMain(["staging", "--dry-run"])).rejects.toThrow(
        "must not use a reserved example, placeholder, loopback, or unspecified hostname",
      );
    });
  });

  it("uses strict SSH for hosted service control and requires explicit push for hosted builds", async () => {
    const hostedServiceOutput = await withOperationalStagingGitState(({ serviceMain }) =>
      captureStdout(() => serviceMain(["staging", "restart", "--dry-run"])),
    );
    expect(hostedServiceOutput).toContain("ssh -T");
    expect(hostedServiceOutput).toContain("StrictHostKeyChecking=yes");
    expect(hostedServiceOutput).toContain(`openround@${stagingTarget.sshHost}`);
    expect(hostedServiceOutput).toContain("openround-staging restart 0");
    expect(hostedServiceOutput).not.toContain(" down ");
    expect(hostedServiceOutput).not.toContain("--volumes");
    await expect(
      productBuildMain([
        "staging",
        "--api-url",
        "https://api.staging.example.test",
        "--registry",
        "ghcr.io/example/openround",
        "--dry-run",
      ]),
    ).rejects.toThrow("Hosted builds require explicit --push");
    await expect(
      deployMain(["development", "--confirm", `development:${buildId}`, "--dry-run"]),
    ).rejects.toThrow("Hosted deployment options are not valid for development");
  });

  it("rejects hosted build target drift and manifest output outside the deployment artifacts", async () => {
    await expect(
      productBuildMain([
        "staging",
        "--api-url",
        "https://wrong.example.test",
        "--registry",
        "ghcr.io/riojung/openround/openround",
        "--push",
        "--dry-run",
      ]),
    ).rejects.toThrow("--api-url must exactly match");
    await expect(
      productBuildMain([
        "staging",
        "--api-url",
        "https://staging.pollingpops.example",
        "--registry",
        "ghcr.io/riojung/openround/openround",
        "--push",
        "--manifest",
        "package.json",
        "--dry-run",
      ]),
    ).rejects.toThrow("build manifest output must be inside");
  });

  it("preserves spaces and apostrophes as single argv values", async () => {
    const unusualPath = "/tmp/Polling Pops team's reviewed manifest.json";
    const parsed = parseCliArguments(["--manifest", unusualPath], {
      valueOptions: ["manifest"],
    });
    expect(parsed.values.get("manifest")).toBe(unusualPath);

    const output = await captureStdout(() =>
      run("example-command", ["--manifest", unusualPath], { dryRun: true }).then(() => undefined),
    );
    expect(output).toContain("example-command --manifest");
    expect(output).toContain("Polling Pops team");

    const executed = await run(
      process.execPath,
      ["-e", "process.stdout.write(process.argv[1])", unusualPath],
      { capture: true },
    );
    expect(executed.stdout).toBe(unusualPath);
  });

  it("validates and prints a complete hosted deployment without invoking providers", async () => {
    const output = await withOperationalStagingGitState(async ({ root, head, deployMain }) => {
      const fixtureRoot = join(root, "artifacts", "deploy", "staging", "operations dry run");
      await mkdir(fixtureRoot, { recursive: true });
      const manifestPath = join(fixtureRoot, "reviewed build manifest.json");
      const runtimePath = join(fixtureRoot, "runtime credentials.env");
      const migrationPath = join(fixtureRoot, "migration owner's credentials.env");
      await writeFile(runtimePath, singleVmRuntimeEnvironment(), { mode: 0o600 });
      await writeFile(migrationPath, "DATABASE_MIGRATION_URL=postgres://owner\n", {
        mode: 0o600,
      });
      await writeFile(manifestPath, `${JSON.stringify(buildManifest("staging", head), null, 2)}\n`);
      return await captureStdout(() =>
        deployMain([
          "staging",
          "--manifest",
          manifestPath,
          "--runtime-env",
          runtimePath,
          "--migration-env",
          migrationPath,
          "--confirm",
          `staging:${head}`,
          "--dry-run",
        ]),
      );
    });
    expect(output).toContain("ssh -T");
    expect(output.match(/cosign verify/g)).toHaveLength(2);
    expect(output.lastIndexOf("cosign verify")).toBeLessThan(output.indexOf("ssh -T"));
    expect(output).toContain("StrictHostKeyChecking=yes");
    expect(output).toContain(`openround@${stagingTarget.sshHost}`);
    expect(output).toContain("/opt/pollingpops/staging");
    expect(output).toContain("openround-staging");
    expect(output).not.toContain("owner-secret");
    expect(output).not.toContain("app-secret");
    expect(output).toContain("Dry run complete");
  });

  it("prints a code-only rollback without accepting or running migration credentials", async () => {
    const output = await withOperationalStagingGitState(
      async ({ root, head, parent, deployMain }) => {
        const fixtureRoot = join(root, "artifacts", "deploy", "staging", "rollback dry run");
        await mkdir(fixtureRoot, { recursive: true });
        const manifestPath = join(fixtureRoot, "rollback build manifest.json");
        const runtimePath = join(fixtureRoot, "runtime credentials.env");
        await writeFile(runtimePath, singleVmRuntimeEnvironment(), { mode: 0o600 });
        await writeFile(
          manifestPath,
          `${JSON.stringify(buildManifest("staging", parent), null, 2)}\n`,
        );
        return await captureStdout(() =>
          deployMain([
            "staging",
            "--rollback",
            "--rollback-from",
            head,
            "--manifest",
            manifestPath,
            "--runtime-env",
            runtimePath,
            "--confirm",
            `rollback:staging:${parent}:from:${head}`,
            "--dry-run",
          ]),
        );
      },
    );
    expect(output).toContain("Code rollback selected");
    expect(output).not.toContain("dist/migrate.js");
    expect(output).not.toContain("migration credentials");
    expect(output).toContain("ssh -T");
    expect(output).not.toContain("flyctl deploy");
  });

  it("rejects deployment credential files outside the target's Docker-ignored subtree", async () => {
    await withOperationalStagingGitState(async ({ root, head, deployMain }) => {
      const fixtureRoot = join(root, "outside target");
      await mkdir(fixtureRoot, { recursive: true });
      const manifestPath = join(fixtureRoot, "manifest.json");
      const runtimePath = join(fixtureRoot, "runtime.env");
      const migrationPath = join(fixtureRoot, "migration.env");
      await writeFile(runtimePath, singleVmRuntimeEnvironment(), { mode: 0o600 });
      await writeFile(migrationPath, "DATABASE_MIGRATION_URL=postgres://owner\n", {
        mode: 0o600,
      });
      await writeFile(manifestPath, `${JSON.stringify(buildManifest("staging", head), null, 2)}\n`);
      await expect(
        deployMain([
          "staging",
          "--manifest",
          manifestPath,
          "--runtime-env",
          runtimePath,
          "--migration-env",
          migrationPath,
          "--confirm",
          `staging:${head}`,
          "--dry-run",
        ]),
      ).rejects.toThrow("runtime environment file must be inside");
    });
  });
});
