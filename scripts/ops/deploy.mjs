#!/usr/bin/env node

import { lstat, open, mkdir, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { join, relative, resolve } from "node:path";
import process from "node:process";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath, URL } from "node:url";
import { isDeepStrictEqual } from "node:util";
import {
  assertCommandAvailable,
  assertConfiguredHostedTarget,
  assertFullGitSha,
  assertKnownHostsTarget,
  assertNoEnvironmentKeyOverlap,
  assertPathWithin,
  assertPrivateIgnoredEnvFile,
  createPrivateFileSnapshot,
  ensureIgnoredEnvFile,
  isPlaceholderHostedHostname,
  isHostedEnvironment,
  normalizeEnvironment,
  parseCliArguments,
  parseFlyTomlEnvironment,
  readStrictJson,
  resolveCheckedRepositoryFile,
  resolveSshIdentityFile,
  run,
  sshArgv,
  validateBuildManifest,
  validateDeployConfig,
  validateDeploymentConfirmation,
  validateFlyRuntimeEnvironment,
  validateFlyWebEnvironment,
  validateRollbackConfirmation,
} from "./lib.mjs";
import {
  resolveReleaseCertificateIdentity,
  validateAcceptedGithubRelease,
  validatePublishedGithubRelease,
  validateReleaseChecksums,
  validateReleasePreflightEvidence,
  validateSignedReleaseLedgerTransition,
} from "./release-acceptance.mjs";
import { main as serviceMain } from "./service.mjs";

const repositoryRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const staleLockAgeMilliseconds = 30 * 60 * 1_000;
export const HOSTED_DEPLOYMENT_AUTOMATION_FILES = Object.freeze([
  "scripts/deploy.sh",
  "scripts/ops/deploy.mjs",
  "scripts/ops/evidence-acceptance.mjs",
  "scripts/ops/lib.mjs",
  "scripts/ops/release-acceptance.mjs",
  "scripts/ops/service.mjs",
]);
const READINESS_GATE_INPUT_FILES = Object.freeze([
  "scripts/check-release-readiness.mjs",
  "docs/release-readiness.json",
]);
const TRUSTED_PRODUCTION_RELEASE_REMOTE_URLS = Object.freeze([
  "https://github.com/riojung/pollingpops.git",
  "git@github.com:riojung/pollingpops.git",
  "ssh://git@github.com/riojung/pollingpops.git",
]);
const TRUSTED_PRODUCTION_RELEASE_TAG_API =
  "https://api.github.com/repos/riojung/pollingpops/git/tags/";
const TRUSTED_PRODUCTION_RELEASE_API = "https://api.github.com/repos/riojung/pollingpops/releases/";
const TRUSTED_PRODUCTION_RELEASE_ASSET_API =
  "https://api.github.com/repos/riojung/pollingpops/releases/assets/";
const MAX_RELEASE_METADATA_ASSET_BYTES = 1024 * 1024;
const MAX_PRIOR_DEPLOYMENT_RECEIPT_BYTES = 64 * 1024;
const SHA256_DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/;

function usage() {
  return `Usage: scripts/deploy.sh development [--dry-run]
       scripts/deploy.sh <staging|production> --config PATH --manifest PATH \\
         --runtime-env PATH --migration-env PATH --confirm ENVIRONMENT:BUILD_ID [--ssh-identity PATH] [options]
       scripts/deploy.sh --environment <environment> [options]

Production additionally requires --backup-reference REFERENCE. Use --recover-lock only after
verifying the recorded local owner is gone and the lock is stale. A rollback requires --rollback,
--rollback-from CURRENT_BUILD_ID, and the exact rollback confirmation shown by the command contract;
it omits the owner migration credential and never reverses schema. Redeploying an unchanged
published production release additionally requires --published-release-redeploy,
--prior-deployment-receipt PATH, and --prior-deployment-receipt-sha256 sha256:DIGEST.`;
}

function configFileName(environment) {
  return environment === "development" ? "dev.json" : `${environment}.json`;
}

function strictTargetPath(path, expectedRelative, label) {
  const expected = resolve(repositoryRoot, expectedRelative);
  const selected = resolve(repositoryRoot, path ?? expectedRelative);
  if (selected !== expected) {
    throw new Error(`${label} must be the checked-in target file ${expectedRelative}`);
  }
  return selected;
}

function backupReference(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:/@+-]{2,199}$/.test(value)) {
    throw new Error("--backup-reference must be a non-secret provider backup identifier");
  }
  return value;
}

async function sha256File(path) {
  return createHash("sha256")
    .update(await readFile(path))
    .digest("hex");
}

async function readBuildManifestSnapshot(path, validationOptions) {
  let source;
  let parsed;
  try {
    source = await readFile(path);
    parsed = JSON.parse(source.toString("utf8"));
  } catch (error) {
    throw new Error(`Could not read valid JSON from ${path}`, { cause: error });
  }
  return {
    manifest: validateBuildManifest(parsed, validationOptions),
    sha256: createHash("sha256").update(source).digest("hex"),
  };
}

export function runtimeEnvironmentSha256(content) {
  return createHash("sha256").update(content).digest("hex");
}

const configCheckSummaryKeys = Object.freeze([
  "valid",
  "buildId",
  "nodeEnvironment",
  "publicApiUrl",
  "webOrigin",
  "communityMode",
  "persistence",
  "coordination",
  "email",
  "developmentEmailInbox",
  "billing",
  "media",
  "metrics",
  "logs",
  "tracing",
  "participantLimit",
  "practicePersonalLinkLimit",
  "presentationResponseWrites",
  "featureFlags",
  "themedInteractionsWorkspaceAllowlistSize",
  "uxBetaWorkspaceAllowlistSize",
  "evidenceFeaturesWorkspaceAllowlistSize",
]);
const configCheckFeatureKeys = Object.freeze([
  "signups",
  "sessionCreation",
  "mediaUploads",
  "roundExperiences",
  "audiencePulse",
  "roomChat",
  "uxBeta",
  "recoveryRehearsal",
  "practiceAssignments",
  "workspaceShell",
  "builderV2",
  "presentations",
  "groups",
  "discover",
  "presentationRealtime",
  "recoveryPacks",
  "questionHealth",
  "decisionReplay",
  "recoveryTrails",
  "conceptHealth",
  "extendedQuestionTypes",
  "verifiedInstitution",
]);
// Older deployed summaries and their receipt hashes remain valid without additive rollout flags.
const optionalConfigCheckFeatureKeys = Object.freeze([
  "roundClientProtocol",
  "liveFlexMode",
  "recoveryPackLiveCards",
  "presentationCompanion",
  "sessionSummaries",
  "ideaBoards",
]);
const coreParityConfigCheckFeatureKeys = Object.freeze([
  "audienceScopes",
  "feedbackRooms",
  "surveys",
  "feedbackExports",
]);

function assertExactObjectKeys(value, expected, label, optional = []) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  const allowed = new Set([...expected, ...optional]);
  if (
    Object.keys(value).some((key) => !allowed.has(key)) ||
    expected.some((key) => !Object.hasOwn(value, key))
  ) {
    throw new Error(`${label} contains an unexpected field set`);
  }
}

export function validateReceiptConfigCheckSummary(summary, config, buildId) {
  // Preserve legacy receipt bytes/hashes. The new bounded group is either fully present or absent.
  const hasCoreParity =
    Object.hasOwn(summary ?? {}, "coreParityWorkspaceAllowlistSize") ||
    coreParityConfigCheckFeatureKeys.some((key) => Object.hasOwn(summary?.featureFlags ?? {}, key));
  assertExactObjectKeys(
    summary,
    [...configCheckSummaryKeys, ...(hasCoreParity ? ["coreParityWorkspaceAllowlistSize"] : [])],
    "configuration summary",
  );
  assertExactObjectKeys(
    summary.featureFlags,
    [...configCheckFeatureKeys, ...(hasCoreParity ? coreParityConfigCheckFeatureKeys : [])],
    "configuration feature flags",
    optionalConfigCheckFeatureKeys,
  );
  const expected = {
    valid: true,
    buildId,
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
  };
  for (const [key, value] of Object.entries(expected)) {
    if (summary[key] !== value) {
      throw new Error(`The deployed configuration summary returned unexpected ${key}`);
    }
  }
  if (
    hasCoreParity &&
    (!Number.isInteger(summary.coreParityWorkspaceAllowlistSize) ||
      summary.coreParityWorkspaceAllowlistSize < 0 ||
      summary.coreParityWorkspaceAllowlistSize > 1_000)
  ) {
    throw new Error(
      "The deployed configuration summary returned invalid coreParityWorkspaceAllowlistSize",
    );
  }
  for (const key of Object.keys(summary.featureFlags)) {
    if (typeof summary.featureFlags[key] !== "boolean") {
      throw new Error(`The deployed configuration summary returned invalid feature flag ${key}`);
    }
  }
  for (const key of [
    "participantLimit",
    "practicePersonalLinkLimit",
    "themedInteractionsWorkspaceAllowlistSize",
    "uxBetaWorkspaceAllowlistSize",
    "evidenceFeaturesWorkspaceAllowlistSize",
  ]) {
    if (!Number.isInteger(summary[key]) || summary[key] < 0) {
      throw new Error(`The deployed configuration summary returned invalid ${key}`);
    }
  }
  if (!new Set(["concurrent", "rollback-compatible"]).has(summary.presentationResponseWrites)) {
    throw new Error(
      "The deployed configuration summary returned invalid presentationResponseWrites",
    );
  }
  return summary;
}

function canonicalTimestamp(value, label) {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) ||
    Number.isNaN(Date.parse(value))
  ) {
    throw new Error(`${label} must be a canonical UTC timestamp`);
  }
  return Date.parse(value);
}

export function validatePublishedReleaseRedeployReceipt(
  receipt,
  { binding, acceptedAt, publishedAt, manifest, manifestSha256, operationsRevision, config },
) {
  assertExactObjectKeys(
    receipt,
    [
      "schemaVersion",
      "environment",
      "buildId",
      "operation",
      "startedAt",
      "completedAt",
      "manifest",
      "manifestSha256",
      "images",
      "singleVm",
      "backupReference",
      "configuration",
      "verification",
      "operations",
      "release",
    ],
    "prior production deployment receipt",
  );
  if (
    receipt.schemaVersion !== 2 ||
    receipt.environment !== "production" ||
    receipt.buildId !== binding.buildId ||
    receipt.operation !== "deploy" ||
    typeof receipt.manifest !== "string" ||
    !receipt.manifest ||
    typeof receipt.backupReference !== "string" ||
    !receipt.backupReference
  ) {
    throw new Error("Prior deployment receipt is not a successful production deployment");
  }
  const started = canonicalTimestamp(receipt.startedAt, "prior deployment startedAt");
  const completed = canonicalTimestamp(receipt.completedAt, "prior deployment completedAt");
  const accepted = canonicalTimestamp(acceptedAt, "signed-release acceptance acceptedAt");
  const published = canonicalTimestamp(publishedAt, "GitHub release publishedAt");
  if (started < accepted || completed < started || completed >= published) {
    throw new Error(
      "Prior deployment receipt must start after acceptance and complete before publication",
    );
  }
  if (receipt.manifestSha256 !== manifestSha256) {
    throw new Error("Prior deployment receipt manifest does not match the accepted release");
  }
  assertExactObjectKeys(receipt.images, Object.keys(manifest.images), "prior deployment images");
  if (
    receipt.images.server !== manifest.images.server.ref ||
    receipt.images.web !== manifest.images.web.ref ||
    (manifest.images.control && receipt.images.control !== manifest.images.control.ref)
  ) {
    throw new Error("Prior deployment receipt images do not match the accepted release");
  }
  assertExactObjectKeys(receipt.singleVm, ["host", "projectName"], "prior deployment target");
  if (
    receipt.singleVm.host !== config.singleVm.host ||
    receipt.singleVm.projectName !== config.singleVm.projectName
  ) {
    throw new Error(
      "Prior deployment receipt target does not match the reviewed production target",
    );
  }
  assertExactObjectKeys(
    receipt.configuration,
    ["runtimeEnvironmentSha256", "summary"],
    "prior deployment configuration",
  );
  if (!/^[a-f0-9]{64}$/.test(String(receipt.configuration.runtimeEnvironmentSha256 ?? ""))) {
    throw new Error("Prior deployment receipt runtime environment digest is invalid");
  }
  validateReceiptConfigCheckSummary(receipt.configuration.summary, config, manifest.buildId);
  assertExactObjectKeys(
    receipt.verification,
    [
      "configuration",
      "imageBuildIds",
      "migration",
      "migrationSkipped",
      "serverLive",
      "serverReady",
      "webBuildId",
      "mediaLive",
    ],
    "prior deployment verification",
  );
  const expectedVerification = {
    configuration: true,
    imageBuildIds: true,
    migration: "applied",
    migrationSkipped: false,
    serverLive: true,
    serverReady: true,
    webBuildId: true,
    mediaLive: true,
  };
  if (!isDeepStrictEqual(receipt.verification, expectedVerification)) {
    throw new Error("Prior deployment receipt does not prove successful post-deploy verification");
  }
  assertExactObjectKeys(receipt.operations, ["commit", "files"], "prior deployment operations");
  if (
    receipt.operations.commit !== operationsRevision ||
    !isDeepStrictEqual(receipt.operations.files, config.deploymentInputHashes)
  ) {
    throw new Error("Prior deployment receipt operations inputs do not match the accepted release");
  }
  assertExactObjectKeys(
    receipt.release,
    ["githubReleaseId", "tag", "tagObject", "acceptedAt"],
    "prior deployment release binding",
  );
  if (
    receipt.release.githubReleaseId !== binding.githubRelease.id ||
    receipt.release.tag !== binding.tag ||
    receipt.release.tagObject !== binding.tagObject ||
    receipt.release.acceptedAt !== acceptedAt
  ) {
    throw new Error(
      "Prior deployment receipt release identity does not match the accepted release",
    );
  }
  return receipt;
}

export async function readPublishedReleaseRedeployReceipt(
  path,
  expectedDigest,
  root = repositoryRoot,
) {
  if (!SHA256_DIGEST_PATTERN.test(String(expectedDigest ?? ""))) {
    throw new Error("--prior-deployment-receipt-sha256 must be a sha256 digest");
  }
  const receiptsRoot = join(root, "artifacts", "deploy", "production", "receipts");
  const selected = assertPathWithin(
    resolve(root, path ?? ""),
    receiptsRoot,
    "prior deployment receipt",
  );
  const [receiptsRootReal, selectedReal, metadata] = await Promise.all([
    realpath(receiptsRoot),
    realpath(selected),
    lstat(selected),
  ]);
  if (
    receiptsRootReal !== receiptsRoot ||
    selectedReal !== selected ||
    !metadata.isFile() ||
    metadata.isSymbolicLink() ||
    metadata.size < 2 ||
    metadata.size > MAX_PRIOR_DEPLOYMENT_RECEIPT_BYTES
  ) {
    throw new Error("Prior deployment receipt must be a bounded regular file without symlinks");
  }
  const source = await readFile(selectedReal);
  const digest = `sha256:${createHash("sha256").update(source).digest("hex")}`;
  if (digest !== expectedDigest) {
    throw new Error("Prior deployment receipt SHA-256 does not match the reviewed evidence");
  }
  try {
    return { receipt: JSON.parse(source.toString("utf8")), digest };
  } catch (error) {
    throw new Error("Prior deployment receipt must contain valid JSON", { cause: error });
  }
}

async function currentOperationsRevision() {
  const result = await run("git", ["rev-parse", "HEAD"], {
    cwd: repositoryRoot,
    capture: true,
  });
  return assertFullGitSha(result.stdout.trim(), "operations HEAD");
}

async function assertOperationsRevision(expectedRevision) {
  const currentRevision = await currentOperationsRevision();
  if (currentRevision !== expectedRevision) {
    throw new Error("Operations HEAD changed during deployment preflight; restart the deployment");
  }
  return true;
}

function parseReleaseLedger(content, label) {
  try {
    return JSON.parse(content);
  } catch (error) {
    throw new Error(`${label} is not valid JSON`, { cause: error });
  }
}

async function gitOutput(arguments_, root = repositoryRoot) {
  const result = await run("git", arguments_, { cwd: root, capture: true });
  return result.stdout.trim();
}

export async function fetchPublishedReleaseTagObject(tagObject) {
  assertFullGitSha(tagObject, "release tag object");
  let response;
  try {
    response = await fetch(`${TRUSTED_PRODUCTION_RELEASE_TAG_API}${tagObject}`, {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "PollingPops-production-deploy",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    throw new Error("Could not verify the release tag object with GitHub", { cause: error });
  }
  if (!response.ok) {
    throw new Error(`GitHub could not verify the release tag object (HTTP ${response.status})`);
  }
  try {
    return await response.json();
  } catch (error) {
    throw new Error("GitHub returned invalid release tag verification data", { cause: error });
  }
}

function githubApiHeaders(accept = "application/vnd.github+json") {
  const headers = {
    Accept: accept,
    "User-Agent": "PollingPops-production-deploy",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  return headers;
}

export async function fetchAcceptedGithubRelease(releaseId) {
  let response;
  try {
    response = await fetch(`${TRUSTED_PRODUCTION_RELEASE_API}${releaseId}`, {
      headers: githubApiHeaders(),
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    throw new Error("Could not verify the accepted GitHub release", { cause: error });
  }
  if (!response.ok) {
    throw new Error(`GitHub could not verify the accepted release (HTTP ${response.status})`);
  }
  try {
    return await response.json();
  } catch (error) {
    throw new Error("GitHub returned invalid release verification data", { cause: error });
  }
}

export async function fetchPublishedReleaseAsset(asset) {
  let response;
  try {
    response = await fetch(`${TRUSTED_PRODUCTION_RELEASE_ASSET_API}${asset.id}`, {
      headers: githubApiHeaders("application/octet-stream"),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    throw new Error(`Could not download accepted GitHub release asset ${asset.name}`, {
      cause: error,
    });
  }
  if (!response.ok) {
    throw new Error(
      `GitHub could not download accepted release asset ${asset.name} (HTTP ${response.status})`,
    );
  }
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_RELEASE_METADATA_ASSET_BYTES) {
    throw new Error(`Accepted GitHub release asset ${asset.name} exceeds the metadata size limit`);
  }
  const content = Buffer.from(await response.arrayBuffer());
  if (content.length === 0 || content.length > MAX_RELEASE_METADATA_ASSET_BYTES) {
    throw new Error(`Accepted GitHub release asset ${asset.name} has an invalid metadata size`);
  }
  return content;
}

function assertPublishedReleaseTagObject(payload, binding, buildId) {
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("GitHub returned invalid release tag verification data");
  }
  if (payload.sha !== binding.tagObject) {
    throw new Error("GitHub release tag object does not match the signed release acceptance");
  }
  if (payload.tag !== binding.tag) {
    throw new Error("GitHub release tag name does not match the signed release acceptance");
  }
  if (payload.object?.type !== "commit" || payload.object.sha !== buildId) {
    throw new Error("GitHub release tag does not resolve to the build manifest commit");
  }
  if (payload.verification?.verified !== true || payload.verification.reason !== "valid") {
    throw new Error("GitHub has not verified the exact annotated release tag object signature");
  }
  return true;
}

export async function assertProductionReleaseRevision({
  operationsRevision,
  manifest,
  manifestPath,
  manifestSha256,
  root = repositoryRoot,
  trustedRemoteUrls = TRUSTED_PRODUCTION_RELEASE_REMOTE_URLS,
  tagObjectLookup = fetchPublishedReleaseTagObject,
  releaseLookup = fetchAcceptedGithubRelease,
  releaseAssetLookup = fetchPublishedReleaseAsset,
  publishedRedeploy,
}) {
  assertFullGitSha(operationsRevision, "operations HEAD");
  assertFullGitSha(manifest.buildId, "release build ID");

  const readinessPath = "docs/release-readiness.json";
  const checkedReadinessPath = await resolveCheckedRepositoryFile(
    readinessPath,
    root,
    "release readiness ledger",
    { requireGitClean: true },
  );
  const acceptedLedger = parseReleaseLedger(
    await readFile(checkedReadinessPath, "utf8"),
    "Release readiness ledger",
  );
  const resolvedManifestSha256 = manifestSha256 ?? (await sha256File(manifestPath));
  if (!/^[a-f0-9]{64}$/.test(resolvedManifestSha256)) {
    throw new Error("release manifest SHA-256 is invalid");
  }
  const expected = {
    buildId: manifest.buildId,
    manifestDigest: `sha256:${resolvedManifestSha256}`,
  };
  if (operationsRevision === manifest.buildId) {
    throw new Error(
      "Production release acceptance must be a strict evidence-only descendant of the release build",
    );
  }
  try {
    await run("git", ["merge-base", "--is-ancestor", manifest.buildId, operationsRevision], {
      cwd: root,
      capture: true,
    });
  } catch (error) {
    throw new Error("Production operations HEAD must descend from the accepted release build", {
      cause: error,
    });
  }
  const changedPaths = (
    await gitOutput(
      ["diff", "--name-only", "--no-renames", manifest.buildId, operationsRevision, "--"],
      root,
    )
  )
    .split("\n")
    .filter(Boolean);
  if (changedPaths.length !== 1 || changedPaths[0] !== readinessPath) {
    throw new Error(
      "Production operations HEAD may differ from the release build only by docs/release-readiness.json",
    );
  }
  const taggedLedger = parseReleaseLedger(
    await gitOutput(["show", `${manifest.buildId}:${readinessPath}`], root),
    "Tagged release readiness ledger",
  );
  const binding = validateSignedReleaseLedgerTransition(taggedLedger, acceptedLedger, expected);
  const signedReleaseGate = acceptedLedger.gates.find((gate) => gate?.id === "signed-release");

  if (binding.imageDigests.server !== manifest.images.server.digest) {
    throw new Error("Signed release acceptance server digest does not match the build manifest");
  }
  if (
    Object.keys(binding.imageDigests).sort().join(",") !==
    Object.keys(manifest.images).sort().join(",")
  ) {
    throw new Error("Signed release image set does not match the build manifest");
  }
  if (manifest.images.control && binding.imageDigests.control !== manifest.images.control.digest) {
    throw new Error("Signed release acceptance control digest does not match the build manifest");
  }
  if (binding.imageDigests.web !== manifest.images.web.digest) {
    throw new Error("Signed release acceptance web digest does not match the build manifest");
  }

  const tagReference = `refs/tags/${binding.tag}`;
  const originUrl = await gitOutput(["remote", "get-url", "origin"], root);
  if (!trustedRemoteUrls.includes(originUrl)) {
    throw new Error(
      "Production release acceptance requires the trusted Polling Pops origin remote",
    );
  }
  await run(
    "git",
    [
      "fetch",
      "--no-tags",
      "origin",
      "refs/heads/main:refs/remotes/origin/main",
      `${tagReference}:${tagReference}`,
    ],
    { cwd: root, capture: true },
  );
  const reviewedMain = await gitOutput(["rev-parse", "--verify", "refs/remotes/origin/main"], root);
  if (reviewedMain !== operationsRevision) {
    throw new Error("Production release acceptance HEAD must match the fetched origin/main commit");
  }
  const resolvedTagObject = await gitOutput(["rev-parse", "--verify", tagReference], root);
  if (resolvedTagObject !== binding.tagObject) {
    throw new Error("Signed release acceptance tag object does not match the local release tag");
  }
  const tagType = await gitOutput(["cat-file", "-t", binding.tagObject], root);
  if (tagType !== "tag") {
    throw new Error("Signed release acceptance must reference an annotated release tag object");
  }
  const taggedCommit = await gitOutput(["rev-parse", "--verify", `${tagReference}^{commit}`], root);
  if (taggedCommit !== manifest.buildId) {
    throw new Error("Signed release acceptance tag does not resolve to the build manifest commit");
  }
  const publishedTagObject = await tagObjectLookup(binding.tagObject);
  assertPublishedReleaseTagObject(publishedTagObject, binding, manifest.buildId);
  const acceptedRelease = await releaseLookup(binding.githubRelease.id);
  const acceptedAt = signedReleaseGate.acceptance.acceptedAt;
  if (acceptedRelease.draft === true) {
    if (publishedRedeploy) {
      throw new Error(
        "Published-release redeploy proof cannot be used while the release is a draft",
      );
    }
    validateAcceptedGithubRelease(acceptedRelease, binding, acceptedAt);
  } else {
    if (!publishedRedeploy) {
      throw new Error(
        "Published production releases require explicit redeploy mode and a reviewed prior deployment receipt",
      );
    }
    validatePublishedGithubRelease(acceptedRelease, binding, acceptedAt);
    validatePublishedReleaseRedeployReceipt(publishedRedeploy.receipt, {
      binding,
      acceptedAt,
      publishedAt: acceptedRelease.published_at,
      manifest,
      manifestSha256: resolvedManifestSha256,
      operationsRevision,
      config: publishedRedeploy.config,
    });
  }

  const loadAcceptedAsset = async (name) => {
    const asset = binding.assets.find((candidate) => candidate.name === name);
    const content = await releaseAssetLookup(asset);
    if (
      !Buffer.isBuffer(content) &&
      !(content instanceof Uint8Array) &&
      typeof content !== "string"
    ) {
      throw new Error(`Accepted GitHub release asset ${name} lookup returned invalid content`);
    }
    const bytes = typeof content === "string" ? Buffer.from(content) : Buffer.from(content);
    const digest = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
    if (digest !== asset.digest || bytes.length !== asset.size) {
      throw new Error(`Accepted GitHub release asset ${name} bytes do not match releaseBinding`);
    }
    return bytes;
  };

  const checksums = await loadAcceptedAsset("SHA256SUMS");
  validateReleaseChecksums(checksums, binding);
  const preflightName = `openround-${binding.tag}-preflight.json`;
  const preflightContent = await loadAcceptedAsset(preflightName);
  let preflight;
  try {
    preflight = JSON.parse(preflightContent.toString("utf8"));
  } catch (error) {
    throw new Error("Accepted GitHub release preflight asset is not valid JSON", { cause: error });
  }
  validateReleasePreflightEvidence(
    preflight,
    binding,
    signedReleaseGate.acceptance.candidateBuildId,
  );
  return {
    ...binding,
    acceptedAt,
    releaseState: acceptedRelease.draft === true ? "draft" : "published",
    certificateIdentity: resolveReleaseCertificateIdentity(binding),
  };
}

export async function resolveReviewedDeploymentInputHashes(paths, root = repositoryRoot) {
  if (!Array.isArray(paths) || paths.length === 0 || new Set(paths).size !== paths.length) {
    throw new Error("Reviewed deployment input paths must be a non-empty unique array");
  }
  const hashes = {};
  for (const path of paths) {
    const checkedPath = await resolveCheckedRepositoryFile(path, root, `deployment input ${path}`, {
      requireGitClean: true,
    });
    hashes[path] = await sha256File(checkedPath);
  }
  return hashes;
}

function processIsRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error.code === "ESRCH") return false;
    if (error.code === "EPERM") return true;
    throw error;
  }
}

async function recoverDeploymentLock(path, environment) {
  const metadata = await lstat(path);
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new Error(`Refusing to recover non-regular deployment lock ${path}`);
  }
  let record;
  try {
    record = JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    throw new Error(`Refusing to recover unreadable deployment lock ${path}`, { cause: error });
  }
  const startedAt = Date.parse(record.startedAt);
  if (
    record.schemaVersion !== 1 ||
    record.environment !== environment ||
    !Number.isInteger(record.pid) ||
    record.pid <= 0 ||
    typeof record.hostname !== "string" ||
    !record.hostname ||
    Number.isNaN(startedAt)
  ) {
    throw new Error(`Refusing to recover invalid deployment lock ${path}`);
  }
  const age = Date.now() - startedAt;
  if (age < staleLockAgeMilliseconds) {
    throw new Error("Deployment lock is not old enough for explicit recovery");
  }
  if (record.hostname === hostname() && processIsRunning(record.pid)) {
    throw new Error(`Deployment lock owner PID ${record.pid} is still running on this host`);
  }
  const recoveredPath = `${path}.recovered-${new Date().toISOString().replaceAll(":", "-")}`;
  await rename(path, recoveredPath);
  process.stdout.write(`Recovered stale deployment lock to ${recoveredPath}.\n`);
}

async function acquireLock(environment, buildId, { recover = false } = {}) {
  const directory = join(repositoryRoot, ".deploy", "locks");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const path = join(directory, `${environment}.lock`);
  let handle;
  try {
    handle = await open(path, "wx", 0o600);
  } catch (error) {
    if (error.code === "EEXIST") {
      if (!recover) {
        throw new Error(
          `A ${environment} deployment lock already exists at ${relative(repositoryRoot, path)}; inspect it and use --recover-lock only when its owner is gone`,
          { cause: error },
        );
      }
      await recoverDeploymentLock(path, environment);
      handle = await open(path, "wx", 0o600);
    } else {
      throw error;
    }
  }
  await handle.writeFile(
    `${JSON.stringify({ schemaVersion: 1, environment, buildId, pid: process.pid, hostname: hostname(), startedAt: new Date().toISOString() })}\n`,
  );
  await handle.close();
  return path;
}

async function writeReceipt({
  environment,
  buildId,
  config,
  manifestPath,
  manifestSha256,
  backup,
  startedAt,
  rollback,
  rollbackFrom,
  runtimeEnvironmentDigest,
  configCheckSummary,
  releaseAcceptance,
}) {
  if (!/^[a-f0-9]{64}$/.test(String(manifestSha256 ?? ""))) {
    throw new Error("Deployment receipt requires the snapshotted manifest SHA-256");
  }
  if (!/^[a-f0-9]{64}$/.test(String(runtimeEnvironmentDigest ?? ""))) {
    throw new Error("Deployment receipt requires the runtime environment SHA-256");
  }
  if (config.deploymentMode === "single-vm" && !configCheckSummary) {
    throw new Error("Single-VM deployment receipt requires the deployed configuration summary");
  }
  if (environment === "production" && !rollback && !releaseAcceptance) {
    throw new Error("Production deployment receipt requires the accepted release binding");
  }
  const completedAt = new Date().toISOString();
  const timestamp = completedAt.replaceAll(":", "-");
  const directory = join(repositoryRoot, "artifacts", "deploy", environment, "receipts");
  await mkdir(directory, { recursive: true });
  const path = join(directory, `${timestamp}-${buildId}.json`);
  const receipt = {
    schemaVersion: 2,
    environment,
    buildId,
    operation: rollback ? "rollback" : "deploy",
    ...(rollbackFrom ? { rollbackFrom } : {}),
    startedAt,
    completedAt,
    manifest: relative(repositoryRoot, manifestPath),
    manifestSha256,
    images: {
      server: config.manifest.images.server.ref,
      web: config.manifest.images.web.ref,
      ...(config.manifest.images.control ? { control: config.manifest.images.control.ref } : {}),
    },
    ...(config.deploymentMode === "single-vm"
      ? {
          singleVm: {
            host: config.singleVm.host,
            projectName: config.singleVm.projectName,
          },
        }
      : { fly: { serverApp: config.fly.serverApp, webApp: config.fly.webApp } }),
    ...(backup ? { backupReference: backup } : {}),
    configuration: {
      runtimeEnvironmentSha256: runtimeEnvironmentDigest,
      ...(configCheckSummary ? { summary: configCheckSummary } : {}),
    },
    verification: {
      configuration: true,
      imageBuildIds: true,
      migration: rollback ? "skipped_for_code_rollback" : "applied",
      migrationSkipped: rollback,
      serverLive: true,
      serverReady: true,
      webBuildId: true,
      mediaLive: config.deploymentMode === "single-vm" ? true : "not_applicable",
    },
    operations: {
      commit: config.operationsRevision,
      files: config.deploymentInputHashes,
    },
    ...(releaseAcceptance
      ? {
          release: {
            githubReleaseId: releaseAcceptance.githubRelease.id,
            tag: releaseAcceptance.tag,
            tagObject: releaseAcceptance.tagObject,
            acceptedAt: releaseAcceptance.acceptedAt,
          },
        }
      : {}),
  };
  const temporary = `${path}.tmp-${process.pid}`;
  await writeFile(temporary, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o644 });
  await rename(temporary, path);
  return path;
}

async function request(url, timeoutSeconds) {
  return await globalThis.fetch(url, {
    redirect: "error",
    signal: globalThis.AbortSignal.timeout(timeoutSeconds * 1_000),
  });
}

async function delay(milliseconds) {
  await sleep(milliseconds);
}

export async function waitForDeploymentHealth(config, buildId) {
  const deadline = Date.now() + config.health.timeoutSeconds * 1_000;
  let lastProblem = "no response received";
  while (Date.now() < deadline) {
    try {
      const liveResponse = await request(
        `${config.publicApiUrl}/health/live`,
        config.health.requestTimeoutSeconds,
      );
      const live = liveResponse.ok ? await liveResponse.json() : null;
      const readyResponse = await request(
        `${config.publicApiUrl}/health/ready`,
        config.health.requestTimeoutSeconds,
      );
      const ready = readyResponse.ok ? await readyResponse.json() : null;
      if (live?.status === "ok" && live.buildId === buildId && ready?.status === "ready") return;
      lastProblem = `server live=${liveResponse.status}, ready=${readyResponse.status}, build=${String(live?.buildId ?? "missing")}`;
    } catch (error) {
      lastProblem = error.message;
    }
    await delay(config.health.intervalSeconds * 1_000);
  }
  throw new Error(`Server health did not converge before timeout (${lastProblem})`);
}

export async function waitForWebBuild(config, buildId) {
  const deadline = Date.now() + config.health.timeoutSeconds * 1_000;
  let lastProblem = "no response received";
  while (Date.now() < deadline) {
    try {
      const response = await request(config.publicWebUrl, config.health.requestTimeoutSeconds);
      const runningBuild = response.headers.get("x-openround-build-id");
      if (response.ok && runningBuild === buildId) return;
      lastProblem = `web status=${response.status}, build=${runningBuild ?? "missing"}`;
    } catch (error) {
      lastProblem = error.message;
    }
    await delay(config.health.intervalSeconds * 1_000);
  }
  throw new Error(`Web build ID did not converge before timeout (${lastProblem})`);
}

export async function waitForMediaHealth(config) {
  const deadline = Date.now() + config.health.timeoutSeconds * 1_000;
  let lastProblem = "no response received";
  while (Date.now() < deadline) {
    try {
      const response = await request(
        `${config.publicMediaUrl}/minio/health/live`,
        config.health.requestTimeoutSeconds,
      );
      if (response.ok) return;
      lastProblem = `media status=${response.status}`;
    } catch (error) {
      lastProblem = error.message;
    }
    await delay(config.health.intervalSeconds * 1_000);
  }
  throw new Error(`Media health did not converge before timeout (${lastProblem})`);
}

export function assertConfigCheckSummary(summary, config, buildId) {
  const expected = {
    valid: true,
    buildId,
    nodeEnvironment: "production",
    publicApiUrl: config.publicApiUrl,
    webOrigin: config.publicWebUrl,
    communityMode: false,
    persistence: "postgresql",
    coordination: "redis-streams",
    billing: config.billingMode,
    metrics: "disabled",
  };
  for (const [key, value] of Object.entries(expected)) {
    if (summary?.[key] !== value) {
      throw new Error(`The exact server image config-check returned unexpected ${key}`);
    }
  }
  for (const key of [
    "signups",
    "roundExperiences",
    "audiencePulse",
    "roomChat",
    "uxBeta",
    "recoveryRehearsal",
    "practiceAssignments",
    "workspaceShell",
    "builderV2",
    "presentations",
    "groups",
    "discover",
  ]) {
    if (summary.featureFlags?.[key] !== false) {
      throw new Error(`The exact server image config-check left feature flag ${key} enabled`);
    }
  }
  for (const key of ["sessionCreation", "mediaUploads"]) {
    if (summary.featureFlags?.[key] !== true) {
      throw new Error(`The exact server image config-check disabled core feature flag ${key}`);
    }
  }
  // Keep pre-flag rollback summaries valid; selecting a schema-compatible image is still required.
  // A current image must confirm the exact Fly template keeps live-card playback disabled.
  for (const key of [
    "roundClientProtocol",
    "recoveryPackLiveCards",
    "presentationCompanion",
    ...coreParityConfigCheckFeatureKeys,
    "sessionSummaries",
    "ideaBoards",
  ]) {
    if (Object.hasOwn(summary.featureFlags, key) && summary.featureFlags[key] !== false) {
      throw new Error(`The exact server image config-check left feature flag ${key} enabled`);
    }
  }
}

async function verifyConfigCheck(serverImage, runtimeEnv, config, flyEnvironment, buildId, dryRun) {
  const args = ["run", "--rm", "--platform", config.imagePlatform, "--env-file", runtimeEnv];
  for (const [key, value] of Object.entries(flyEnvironment).sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    args.push("--env", `${key}=${value}`);
  }
  args.push("--entrypoint", "node", serverImage, "dist/config-check.js");
  if (dryRun) {
    await run("docker", args, { cwd: repositoryRoot, dryRun: true });
    return;
  }
  const result = await run("docker", args, { cwd: repositoryRoot, capture: true });
  let summary;
  try {
    summary = JSON.parse(result.stdout);
  } catch {
    throw new Error("The server image config-check did not return valid JSON");
  }
  assertConfigCheckSummary(summary, config, buildId);
  process.stdout.write(`Server configuration validated for build ${buildId}.\n`);
}

async function verifyEmbeddedWebBuild(webImage, config, buildId, dryRun) {
  const args = [
    "run",
    "--rm",
    "--platform",
    config.imagePlatform,
    "--entrypoint",
    "/bin/cat",
    webImage,
    "/app/BUILD_ID",
  ];
  if (dryRun) {
    await run("docker", args, { cwd: repositoryRoot, dryRun: true });
    return;
  }
  const result = await run("docker", args, { cwd: repositoryRoot, capture: true });
  if (result.stdout.trim() !== buildId) {
    throw new Error("The exact web image contains a different /app/BUILD_ID");
  }
  process.stdout.write(`Web image build ID validated for build ${buildId}.\n`);
}

async function verifyRollbackSource(config, rollbackFrom, targetBuildId, dryRun) {
  if (dryRun) {
    process.stdout.write(
      `[dry-run] verify current ${config.environment} deployment build is ${rollbackFrom}\n`,
    );
    return;
  }
  const response = await request(
    `${config.publicApiUrl}/health/live`,
    config.health.requestTimeoutSeconds,
  );
  let live;
  try {
    live = response.ok ? await response.json() : undefined;
  } catch {
    throw new Error("The current deployment live endpoint did not return valid JSON");
  }
  const expectedBuildIds = new Set([rollbackFrom, targetBuildId]);
  if (!response.ok || live?.status !== "ok" || !expectedBuildIds.has(live.buildId)) {
    throw new Error(
      "Rollback found an unexpected server build; the environment is not in a recoverable source/target state",
    );
  }
  const webResponse = await request(config.publicWebUrl, config.health.requestTimeoutSeconds);
  const webBuildId = webResponse.headers.get("x-openround-build-id");
  if (!webResponse.ok || !expectedBuildIds.has(webBuildId)) {
    throw new Error(
      "Rollback found an unexpected web build; the environment is not in a recoverable source/target state",
    );
  }
}

async function verifyRollbackAncestry(targetBuildId, sourceBuildId) {
  try {
    await run("git", ["merge-base", "--is-ancestor", targetBuildId, sourceBuildId], {
      cwd: repositoryRoot,
      capture: true,
    });
  } catch (error) {
    throw new Error(
      "Rollback target must be a Git ancestor of --rollback-from; fetch the release history and verify the selected manifests",
      { cause: error },
    );
  }
}

export async function verifyForwardDeploymentAncestry(activeBuildId, targetBuildId) {
  assertFullGitSha(targetBuildId, "deployment target build ID");
  if (activeBuildId === undefined) return true;
  assertFullGitSha(activeBuildId, "active remote build ID");
  try {
    await run("git", ["merge-base", "--is-ancestor", activeBuildId, targetBuildId], {
      cwd: repositoryRoot,
      capture: true,
    });
  } catch (error) {
    throw new Error(
      "Normal deployment target must descend from the active remote build; use the explicit rollback contract to deploy an older build",
      { cause: error },
    );
  }
  return true;
}

export async function verifySignatures(config, manifest, dryRun, certificateIdentity) {
  if (
    config.singleVm?.composeFiles.includes("compose.single-vm.business.yaml") &&
    !manifest.images.control
  ) {
    throw new Error("Business deployments require a signed control image in the build manifest");
  }
  if (!config.requireSigning) return;
  for (const component of Object.keys(manifest.images)) {
    const identityArguments = certificateIdentity
      ? ["--certificate-identity", certificateIdentity]
      : ["--certificate-identity-regexp", config.cosignIdentityRegexp];
    await run(
      "cosign",
      [
        "verify",
        ...identityArguments,
        "--certificate-oidc-issuer",
        config.cosignOidcIssuer,
        manifest.images[component].ref,
      ],
      { cwd: repositoryRoot, dryRun },
    );
  }
}

async function verifyFlySecretSeparation(
  app,
  reviewedEnvironment,
  dryRun,
  requiredSecretKeys = [],
) {
  const args = ["secrets", "list", "--app", app, "--json"];
  if (dryRun) {
    await run("flyctl", args, { cwd: repositoryRoot, dryRun: true });
    return;
  }
  const result = await run("flyctl", args, { cwd: repositoryRoot, capture: true });
  let records;
  try {
    records = JSON.parse(result.stdout);
  } catch {
    throw new Error(`flyctl did not return valid secret metadata for ${app}`);
  }
  if (!Array.isArray(records)) {
    throw new Error(`flyctl secret metadata for ${app} must be an array`);
  }
  const secretKeys = records.map((record) => record?.Name ?? record?.name);
  if (secretKeys.some((key) => typeof key !== "string" || !/^[A-Z][A-Z0-9_]*$/.test(key))) {
    throw new Error(`flyctl returned invalid secret metadata for ${app}`);
  }
  const providerSecretKeys = new Set(secretKeys);
  const missing = [...new Set(requiredSecretKeys)]
    .filter((key) => !providerSecretKeys.has(key))
    .sort();
  if (missing.length > 0) {
    throw new Error(`Fly app ${app} is missing candidate runtime secrets: ${missing.join(", ")}`);
  }
  const required = new Set(requiredSecretKeys);
  const unexpected = secretKeys.filter((key) => !required.has(key)).sort();
  if (unexpected.length > 0) {
    throw new Error(
      `Fly app ${app} has secrets absent from the candidate environment: ${unexpected.join(", ")}`,
    );
  }
  assertNoEnvironmentKeyOverlap(
    secretKeys,
    Object.keys(reviewedEnvironment),
    `Fly secrets for ${app}`,
    "checked Fly environment",
  );
}

async function validateFlyConfigs(config, serverConfigPath, webConfigPath, dryRun) {
  for (const [app, configPath] of [
    [config.fly.serverApp, serverConfigPath],
    [config.fly.webApp, webConfigPath],
  ]) {
    await run("flyctl", ["config", "validate", "--strict", "--app", app, "--config", configPath], {
      cwd: repositoryRoot,
      dryRun,
    });
  }
}

export const REMOTE_PREPARE_SCRIPT = [
  "set -eu",
  'base="$1"',
  'token="$2"',
  "umask 077",
  'mkdir -p "$base/incoming"',
  "# Never sweep while another remote mutation owns the deployment lock. Old upload directories",
  "# are safe to remove because every deployment uses a fresh, unguessable token.",
  'if [ ! -d "$base/.deploy.lock" ]; then',
  '  find "$base/incoming" -mindepth 1 -maxdepth 1 -type d -mtime +0 -exec rm -rf -- {} \\;',
  "fi",
  'incoming="$base/incoming/$token"',
  'if ! mkdir "$incoming"; then',
  '  echo "Incoming deployment already exists" >&2',
  "  exit 72",
  "fi",
  'chmod 700 "$incoming"',
].join("\n");

export const REMOTE_WRITE_SCRIPT = [
  "set -eu",
  'target="$1"',
  'mode="$2"',
  "directory=${target%/*}",
  "umask 077",
  'mkdir -p "$directory"',
  'temporary="$target.tmp.$$"',
  "cleanup_write() {",
  "  status=$?",
  '  rm -f "$temporary"',
  "  trap - EXIT HUP INT TERM",
  '  exit "$status"',
  "}",
  "trap cleanup_write EXIT",
  "trap 'exit 129' HUP",
  "trap 'exit 130' INT",
  "trap 'exit 143' TERM",
  'cat > "$temporary"',
  'chmod "$mode" "$temporary"',
  'mv -f "$temporary" "$target"',
  "trap - EXIT HUP INT TERM",
].join("\n");

export const REMOTE_CURRENT_BUILD_SCRIPT = [
  "set -eu",
  'base="$1"',
  'if [ ! -f "$base/current-build" ]; then exit 0; fi',
  'build=$(cat "$base/current-build")',
  'case "$build" in',
  '  *[!0-9a-f]*|"") echo "Invalid remote current-build state" >&2; exit 65 ;;',
  "esac",
  'printf "%s\\n" "$build"',
].join("\n");

export const REMOTE_CONFIG_SUMMARY_SCRIPT = [
  "set -eu",
  'base="$1"',
  'expected="$2"',
  'build=$(cat "$base/current-build" 2>/dev/null || true)',
  '[ "$build" = "$expected" ] || { echo "Active build changed before configuration evidence capture" >&2; exit 75; }',
  'current=$(readlink "$base/current" 2>/dev/null || true)',
  '[ "$current" = "releases/$expected" ] || { echo "Active release pointer disagrees with build state" >&2; exit 75; }',
  'summary="$base/$current/.config-check-summary.json"',
  '[ -f "$summary" ] && [ ! -L "$summary" ] || { echo "Configuration summary is missing or unsafe" >&2; exit 66; }',
  'cat "$summary"',
].join("\n");

export const REMOTE_DEPLOY_SCRIPT = [
  "set -eu",
  'base="$1"',
  'project="$2"',
  'build="$3"',
  'token="$4"',
  'recover="$5"',
  'rollback="$6"',
  'expected_current="$7"',
  'rollback_source="$8"',
  'incoming="$base/incoming/$token"',
  'release="$base/releases/$build"',
  'replaced="$base/releases/.replaced-$build-$token"',
  "had_replaced=0",
  'lock="$base/.deploy.lock"',
  'mkdir -p "$base/releases"',
  'if ! mkdir "$lock" 2>/dev/null; then',
  '  if [ "$recover" != "1" ]; then',
  '    echo "Another remote deployment or lifecycle operation holds $lock" >&2',
  "    exit 73",
  "  fi",
  '  owner=$(cat "$lock/pid" 2>/dev/null || true)',
  '  started=$(cat "$lock/started" 2>/dev/null || true)',
  "  now=$(date +%s)",
  '  case "$owner:$started" in',
  '    *[!0-9:]*|:|*:) echo "Remote lock metadata is invalid" >&2; exit 73 ;;',
  "  esac",
  '  if kill -0 "$owner" 2>/dev/null; then',
  '    echo "Remote lock owner $owner is still running" >&2',
  "    exit 73",
  "  fi",
  "  age=$((now - started))",
  '  if [ "$age" -lt 1800 ]; then',
  '    echo "Remote lock is not old enough for explicit recovery" >&2',
  "    exit 73",
  "  fi",
  '  rm -rf "$lock"',
  '  mkdir "$lock"',
  "fi",
  "cleanup_lock() {",
  "  status=$?",
  '  rm -rf "$lock"',
  "  trap - EXIT HUP INT TERM",
  '  exit "$status"',
  "}",
  "trap cleanup_lock EXIT",
  "trap 'exit 129' HUP",
  "trap 'exit 130' INT",
  "trap 'exit 143' TERM",
  'printf "%s\\n" "$$" > "$lock/pid"',
  'date +%s > "$lock/started"',
  'previous=$(readlink "$base/current" 2>/dev/null || true)',
  "activation_started=0",
  "committed=0",
  "recovery_succeeded=1",
  "valid_release_link() {",
  '  candidate="$1"',
  '  case "$candidate" in releases/*) candidate_build=${candidate#releases/} ;; *) return 1 ;; esac',
  '  case "$candidate_build" in *[!0-9a-f]*|"") return 1 ;; esac',
  '  case "${#candidate_build}" in 40|64) ;; *) return 1 ;; esac',
  '  [ "$candidate" = "releases/$candidate_build" ]',
  "}",
  "load_release() {",
  '  selected="$1"',
  '  compose_files=""',
  "  while IFS= read -r relative_file; do",
  '    [ -n "$relative_file" ] || continue',
  '    [ -f "$selected/$relative_file" ] || { echo "Missing deployed Compose file" >&2; return 66; }',
  '    if [ -z "$compose_files" ]; then compose_files="$selected/$relative_file"; else compose_files="$compose_files:$selected/$relative_file"; fi',
  '  done < "$selected/.compose-files"',
  '  [ -n "$compose_files" ] || { echo "No deployed Compose files" >&2; return 66; }',
  "  COMPOSE_FILE=$compose_files",
  "  COMPOSE_PROJECT_NAME=$project",
  "  export COMPOSE_FILE COMPOSE_PROJECT_NAME",
  "}",
  "restore_previous() {",
  '  if [ -z "$previous" ]; then',
  '    docker compose --env-file "$release/.env" down --remove-orphans',
  '    rm -f "$base/current" "$base/current-build"',
  "    return 0",
  "  fi",
  '  valid_release_link "$previous" || { echo "Invalid previous release link" >&2; return 1; }',
  '  previous_path="$base/$previous"',
  '  [ -d "$previous_path" ] || return 1',
  '  load_release "$previous_path"',
  '  docker compose --env-file "$previous_path/.env" up --detach --wait --remove-orphans',
  '  ln -s "$previous" "$base/current.rollback.$token"',
  '  mv -Tf "$base/current.rollback.$token" "$base/current"',
  "  previous_build=${previous#releases/}",
  '  printf "%s\\n" "$previous_build" > "$base/current-build.rollback.$token"',
  '  mv -f "$base/current-build.rollback.$token" "$base/current-build"',
  "}",
  "prune_releases() {",
  '  rm -rf "$base/releases"/.replaced-*',
  '  protected_previous=""',
  '  if [ -n "$previous" ]; then protected_previous=${previous#releases/}; fi',
  "  extra_kept=0",
  '  for candidate in $(ls -1dt "$base/releases"/[0-9a-f]* 2>/dev/null || true); do',
  '    [ -d "$candidate" ] || continue',
  "    candidate_build=${candidate##*/}",
  '    case "$candidate_build" in *[!0-9a-f]*|"") continue ;; esac',
  '    case "${#candidate_build}" in 40|64) ;; *) continue ;; esac',
  '    if [ "$candidate_build" = "$build" ] || [ "$candidate_build" = "$protected_previous" ]; then continue; fi',
  '    if [ "$extra_kept" -eq 0 ]; then extra_kept=1; else rm -rf "$candidate"; fi',
  "  done",
  "}",
  "cleanup() {",
  "  status=$?",
  '  rm -f "$release/.migration.env" 2>/dev/null || true',
  '  rm -rf "$incoming" 2>/dev/null || true',
  '  if [ "$status" -ne 0 ] && [ "$committed" = "0" ] && [ "$activation_started" = "1" ]; then',
  '    echo "Activation failed; restoring previous release" >&2',
  "    if ! restore_previous; then",
  '      echo "Previous release restore or first-release teardown also failed" >&2',
  "      recovery_succeeded=0",
  "      status=74",
  "    fi",
  "  fi",
  '  if [ "$status" -ne 0 ] && [ "$committed" = "0" ] && [ "$recovery_succeeded" = "1" ]; then',
  '    rm -rf "$release"',
  '    if [ "$had_replaced" = "1" ] && [ -d "$replaced" ]; then mv "$replaced" "$release"; fi',
  "  fi",
  '  rm -rf "$lock"',
  "  trap - EXIT HUP INT TERM",
  '  exit "$status"',
  "}",
  "trap cleanup EXIT",
  "trap 'exit 129' HUP",
  "trap 'exit 130' INT",
  "trap 'exit 143' TERM",
  'if [ -n "$previous" ] && ! valid_release_link "$previous"; then',
  '  echo "Invalid current release link" >&2',
  "  exit 65",
  "fi",
  'if [ -n "$previous" ] && [ ! -f "$base/current-build" ]; then echo "Current release state is incomplete" >&2; exit 65; fi',
  'if [ -f "$base/current-build" ]; then',
  '  active_build=$(cat "$base/current-build")',
  '  case "$active_build" in *[!0-9a-f]*|"") echo "Invalid current-build state" >&2; exit 65 ;; esac',
  '  case "${#active_build}" in 40|64) ;; *) echo "Invalid current-build state" >&2; exit 65 ;; esac',
  '  [ -n "$previous" ] || { echo "Current release state is incomplete" >&2; exit 65; }',
  '  [ "$previous" = "releases/$active_build" ] || { echo "Current release pointers disagree" >&2; exit 65; }',
  '  [ "$active_build" = "$expected_current" ] || { echo "Active build changed after deployment preflight" >&2; exit 75; }',
  '  [ "$active_build" != "$build" ] || { echo "Target build is already active" >&2; exit 70; }',
  '  if [ "$rollback" = "1" ] && [ "$active_build" != "$rollback_source" ]; then echo "Rollback source is no longer active" >&2; exit 71; fi',
  "fi",
  'if [ ! -f "$base/current-build" ] && [ "$expected_current" != "none" ]; then echo "Active build changed after deployment preflight" >&2; exit 75; fi',
  'if [ "$rollback" = "1" ] && [ ! -f "$base/current-build" ]; then echo "Rollback source is not deployed" >&2; exit 71; fi',
  '[ -d "$incoming" ] || { echo "Incoming release is missing" >&2; exit 66; }',
  'if [ -e "$release" ]; then mv "$release" "$replaced"; had_replaced=1; fi',
  'mv "$incoming" "$release"',
  'chmod 700 "$release"',
  'load_release "$release"',
  'docker compose --env-file "$release/.env" config --quiet',
  'docker compose --env-file "$release/.env" pull',
  'config_summary="$release/.config-check-summary.json"',
  'docker compose --env-file "$release/.env" run --rm --no-deps server node dist/config-check.js > "$config_summary.tmp"',
  'chmod 600 "$config_summary.tmp"',
  'mv -f "$config_summary.tmp" "$config_summary"',
  'server_build=$(docker compose --env-file "$release/.env" run --rm --no-deps --entrypoint /bin/cat server /app/BUILD_ID)',
  '[ "$server_build" = "$build" ] || { echo "Server image BUILD_ID does not match release" >&2; exit 67; }',
  'web_build=$(docker compose --env-file "$release/.env" run --rm --no-deps --entrypoint /bin/cat web /app/BUILD_ID)',
  '[ "$web_build" = "$build" ] || { echo "Web image BUILD_ID does not match release" >&2; exit 67; }',
  'if docker compose --env-file "$release/.env" config --services | grep -qx control; then',
  '  control_build=$(docker compose --env-file "$release/.env" run --rm --no-deps --entrypoint /bin/cat control /app/BUILD_ID)',
  '  [ "$control_build" = "$build" ] || { echo "Control image BUILD_ID does not match release" >&2; exit 67; }',
  "fi",
  "activation_started=1",
  'docker compose --env-file "$release/.env" up --detach --wait postgres valkey minio clamav',
  'if [ "$rollback" = "0" ]; then',
  '  docker compose --env-file "$release/.env" --env-file "$release/.migration.env" --profile operations run --rm migrate',
  "fi",
  'rm -f "$release/.migration.env"',
  'docker compose --env-file "$release/.env" up --detach --wait --remove-orphans',
  'if [ -n "$previous" ]; then',
  '  ln -s "$previous" "$base/previous.new.$token"',
  '  mv -Tf "$base/previous.new.$token" "$base/previous"',
  "fi",
  'ln -s "releases/$build" "$base/current.new.$token"',
  'mv -Tf "$base/current.new.$token" "$base/current"',
  'printf "%s\\n" "$build" > "$base/current-build.tmp.$token"',
  'mv -f "$base/current-build.tmp.$token" "$base/current-build"',
  "committed=1",
  'prune_releases || echo "Warning: old release cleanup did not complete" >&2',
  'docker image prune --force --filter until=168h >/dev/null 2>&1 || echo "Warning: dangling image cleanup did not complete" >&2',
].join("\n");

export const REMOTE_RESTORE_PREVIOUS_SCRIPT = [
  "set -eu",
  'base="$1"',
  'project="$2"',
  'expected="$3"',
  'lock="$base/.deploy.lock"',
  'if ! mkdir "$lock" 2>/dev/null; then echo "Remote deployment lock is held" >&2; exit 73; fi',
  "cleanup_restore() {",
  "  status=$?",
  '  rm -rf "$lock"',
  "  trap - EXIT HUP INT TERM",
  '  exit "$status"',
  "}",
  "trap cleanup_restore EXIT",
  "trap 'exit 129' HUP",
  "trap 'exit 130' INT",
  "trap 'exit 143' TERM",
  'printf "%s\\n" "$$" > "$lock/pid"',
  'date +%s > "$lock/started"',
  'previous=$(readlink "$base/previous" 2>/dev/null || true)',
  'case "$previous" in "releases/$expected") ;; *) echo "Previous release does not match expected build" >&2; exit 68 ;; esac',
  'release="$base/$previous"',
  'compose_files=""',
  "while IFS= read -r relative_file; do",
  '  [ -n "$relative_file" ] || continue',
  '  [ -f "$release/$relative_file" ] || exit 66',
  '  if [ -z "$compose_files" ]; then compose_files="$release/$relative_file"; else compose_files="$compose_files:$release/$relative_file"; fi',
  'done < "$release/.compose-files"',
  "COMPOSE_FILE=$compose_files",
  "COMPOSE_PROJECT_NAME=$project",
  "export COMPOSE_FILE COMPOSE_PROJECT_NAME",
  'docker compose --env-file "$release/.env" up --detach --wait --remove-orphans',
  'current=$(readlink "$base/current" 2>/dev/null || true)',
  'case "$current" in releases/*) current_build=${current#releases/} ;; *) echo "Invalid current release link" >&2; exit 68 ;; esac',
  'case "$current_build" in *[!0-9a-f]*|"") echo "Invalid current release link" >&2; exit 68 ;; esac',
  'case "${#current_build}" in 40|64) ;; *) echo "Invalid current release link" >&2; exit 68 ;; esac',
  '[ "$current" = "releases/$current_build" ] || { echo "Invalid current release link" >&2; exit 68; }',
  'ln -s "$current" "$base/previous.restore.$$"',
  'mv -Tf "$base/previous.restore.$$" "$base/previous"',
  'ln -s "$previous" "$base/current.restore.$$"',
  'mv -Tf "$base/current.restore.$$" "$base/current"',
  'printf "%s\\n" "$expected" > "$base/current-build.tmp.$$"',
  'mv -f "$base/current-build.tmp.$$" "$base/current-build"',
].join("\n");

export const REMOTE_REMOVE_INCOMING_SCRIPT = [
  "set -eu",
  'base="$1"',
  'token="$2"',
  'rm -rf "$base/incoming/$token"',
].join("\n");

export const REMOTE_DEACTIVATE_FAILED_CURRENT_SCRIPT = [
  "set -eu",
  'base="$1"',
  'project="$2"',
  'expected="$3"',
  'lock="$base/.deploy.lock"',
  'if ! mkdir "$lock" 2>/dev/null; then echo "Remote deployment lock is held" >&2; exit 73; fi',
  "cleanup_deactivate() {",
  "  status=$?",
  '  rm -rf "$lock"',
  "  trap - EXIT HUP INT TERM",
  '  exit "$status"',
  "}",
  "trap cleanup_deactivate EXIT",
  "trap 'exit 129' HUP",
  "trap 'exit 130' INT",
  "trap 'exit 143' TERM",
  'printf "%s\\n" "$$" > "$lock/pid"',
  'date +%s > "$lock/started"',
  'current=$(readlink "$base/current" 2>/dev/null || true)',
  'case "$current" in "releases/$expected") ;; *) echo "Failed release is no longer current" >&2; exit 75 ;; esac',
  'current_build=$(cat "$base/current-build" 2>/dev/null || true)',
  '[ "$current_build" = "$expected" ] || { echo "Failed release pointers disagree" >&2; exit 75; }',
  'release="$base/$current"',
  '[ -d "$release" ] || { echo "Failed release directory is missing" >&2; exit 66; }',
  'compose_files=""',
  "while IFS= read -r relative_file; do",
  '  [ -n "$relative_file" ] || continue',
  '  [ -f "$release/$relative_file" ] || exit 66',
  '  if [ -z "$compose_files" ]; then compose_files="$release/$relative_file"; else compose_files="$compose_files:$release/$relative_file"; fi',
  'done < "$release/.compose-files"',
  '[ -n "$compose_files" ] || { echo "No deployed Compose files" >&2; exit 66; }',
  "COMPOSE_FILE=$compose_files",
  "COMPOSE_PROJECT_NAME=$project",
  "export COMPOSE_FILE COMPOSE_PROJECT_NAME",
  'docker compose --env-file "$release/.env" down --remove-orphans',
  'rm -f "$base/current" "$base/current-build"',
  'rm -rf "$release"',
].join("\n");

async function sshRun(
  config,
  knownHostsFile,
  identityFile,
  remoteArguments,
  { capture = false, dryRun = false, input, interruptGuard } = {},
) {
  const result = await run(
    "ssh",
    sshArgv(config.singleVm, knownHostsFile, remoteArguments, { identityFile }),
    {
      cwd: repositoryRoot,
      capture,
      dryRun,
      input,
    },
  );
  interruptGuard?.throwIfInterrupted();
  return result;
}

async function remoteWrite(
  config,
  knownHostsFile,
  identityFile,
  remotePath,
  content,
  mode,
  dryRun,
  interruptGuard,
) {
  await sshRun(
    config,
    knownHostsFile,
    identityFile,
    ["sh", "-c", REMOTE_WRITE_SCRIPT, "--", remotePath, mode],
    { dryRun, input: content, interruptGuard },
  );
}

function createDeploymentInterruptGuard() {
  let interruptedSignal;
  const handlers = new Map();
  for (const signal of ["SIGINT", "SIGTERM"]) {
    const handler = () => {
      interruptedSignal ??= signal;
    };
    handlers.set(signal, handler);
    process.once(signal, handler);
  }
  return {
    throwIfInterrupted() {
      if (!interruptedSignal) return;
      const error = new Error(`Deployment interrupted by ${interruptedSignal}`);
      error.exitCode = interruptedSignal === "SIGINT" ? 130 : 143;
      throw error;
    },
    dispose() {
      for (const [signal, handler] of handlers) process.removeListener(signal, handler);
    },
  };
}

async function readRemoteCurrentBuild(
  config,
  knownHostsFile,
  identityFile,
  dryRun,
  interruptGuard,
) {
  const result = await sshRun(
    config,
    knownHostsFile,
    identityFile,
    ["sh", "-c", REMOTE_CURRENT_BUILD_SCRIPT, "--", config.singleVm.deployPath],
    { capture: !dryRun, dryRun, interruptGuard },
  );
  if (dryRun || !result.stdout.trim()) return undefined;
  const buildId = result.stdout.trim();
  assertFullGitSha(buildId, "remote current build ID");
  return buildId;
}

async function readRemoteConfigCheckSummary(
  config,
  knownHostsFile,
  identityFile,
  buildId,
  interruptGuard,
) {
  const result = await sshRun(
    config,
    knownHostsFile,
    identityFile,
    ["sh", "-c", REMOTE_CONFIG_SUMMARY_SCRIPT, "--", config.singleVm.deployPath, buildId],
    { capture: true, interruptGuard },
  );
  let summary;
  try {
    summary = JSON.parse(result.stdout);
  } catch (error) {
    throw new Error("The deployed configuration summary was not valid JSON", { cause: error });
  }
  return validateReceiptConfigCheckSummary(summary, config, buildId);
}

export function assertRemoteTargetNotActive(currentBuildId, targetBuildId) {
  if (currentBuildId && currentBuildId === targetBuildId) {
    throw new Error(`Build ${targetBuildId} is already the active single-VM release`);
  }
  return true;
}

export function assertRemoteRollbackSource(currentBuildId, expectedSourceBuildId) {
  if (currentBuildId !== expectedSourceBuildId) {
    throw new Error(
      `Rollback source ${expectedSourceBuildId} is not the active single-VM release (${currentBuildId ?? "none"})`,
    );
  }
  return true;
}

async function restorePreviousRemoteBuild(config, knownHostsFile, identityFile, previousBuildId) {
  await sshRun(
    config,
    knownHostsFile,
    identityFile,
    ["sh", "-se", "--", config.singleVm.deployPath, config.singleVm.projectName, previousBuildId],
    { input: REMOTE_RESTORE_PREVIOUS_SCRIPT },
  );
}

async function deactivateFailedCurrentRemoteBuild(
  config,
  knownHostsFile,
  identityFile,
  expectedBuildId,
) {
  await sshRun(config, knownHostsFile, identityFile, [
    "sh",
    "-c",
    REMOTE_DEACTIVATE_FAILED_CURRENT_SCRIPT,
    "--",
    config.singleVm.deployPath,
    config.singleVm.projectName,
    expectedBuildId,
  ]);
}

async function resolveSingleVmFiles(config, identityPath) {
  const knownHostsFile = await resolveCheckedRepositoryFile(
    config.singleVm.knownHostsFile,
    repositoryRoot,
    "SSH known-hosts file",
    { requireGitClean: true },
  );
  await assertKnownHostsTarget(knownHostsFile, config.singleVm);
  const identityFile = await resolveSshIdentityFile(identityPath, repositoryRoot);
  const knownHostsContent = await readFile(knownHostsFile);
  const deploymentFiles = new Map();
  const deploymentInputHashes = {};
  deploymentInputHashes[config.singleVm.knownHostsFile] = createHash("sha256")
    .update(knownHostsContent)
    .digest("hex");
  for (const path of [...config.singleVm.composeFiles, ...config.singleVm.deploymentFiles]) {
    const absolutePath = await resolveCheckedRepositoryFile(
      path,
      repositoryRoot,
      `single-VM deployment file ${path}`,
      { requireGitClean: true },
    );
    const metadata = await lstat(absolutePath);
    const content = await readFile(absolutePath);
    const mode = (metadata.mode & 0o111) === 0 ? "0644" : "0755";
    deploymentFiles.set(path, { content, mode });
    deploymentInputHashes[path] = createHash("sha256").update(content).digest("hex");
  }
  return { knownHostsContent, identityFile, deploymentFiles, deploymentInputHashes };
}

function releaseEnvironment(content, manifest, keys) {
  const reserved = [
    "OPENROUND_SERVER_IMAGE",
    "OPENROUND_WEB_IMAGE",
    "OPENROUND_CONTROL_IMAGE",
    "OPENROUND_BUILD_ID",
  ];
  assertNoEnvironmentKeyOverlap(
    keys,
    reserved,
    "runtime environment file",
    "release image environment",
  );
  return `${content.endsWith("\n") ? content : `${content}\n`}OPENROUND_SERVER_IMAGE=${manifest.images.server.ref}\nOPENROUND_WEB_IMAGE=${manifest.images.web.ref}\n${manifest.images.control ? `OPENROUND_CONTROL_IMAGE=${manifest.images.control.ref}\n` : ""}OPENROUND_BUILD_ID=${manifest.buildId}\n`;
}

function environmentFileValue(content, key) {
  for (const line of String(content)
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const equalsAt = trimmed.indexOf("=");
    if (equalsAt > 0 && trimmed.slice(0, equalsAt).trim() === key) {
      return trimmed.slice(equalsAt + 1).trim();
    }
  }
  return undefined;
}

const PLAIN_DNS_HOSTNAME_PATTERN =
  /^(?=.{1,253}$)(?!-)(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/;

function validateHostedTracingValues(content) {
  const tracingEnabled = environmentFileValue(content, "TRACING_ENABLED") ?? "false";
  if (!new Set(["true", "false"]).has(tracingEnabled)) {
    throw new Error("TRACING_ENABLED must be true or false");
  }
  if (tracingEnabled === "false") return;

  const endpoint = environmentFileValue(content, "OTEL_EXPORTER_OTLP_TRACES_ENDPOINT");
  if (!endpoint || endpoint.toLowerCase().includes("replace-")) {
    throw new Error(
      "OTEL_EXPORTER_OTLP_TRACES_ENDPOINT must contain a non-placeholder value when tracing is enabled",
    );
  }
  let url;
  try {
    url = new URL(endpoint);
  } catch {
    throw new Error("OTEL_EXPORTER_OTLP_TRACES_ENDPOINT must be a valid HTTP(S) URL");
  }
  if (
    !new Set(["http:", "https:"]).has(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      "OTEL_EXPORTER_OTLP_TRACES_ENDPOINT must be a credential-free HTTP(S) URL without a query or fragment",
    );
  }
  if (isPlaceholderHostedHostname(url.hostname)) {
    throw new Error(
      "OTEL_EXPORTER_OTLP_TRACES_ENDPOINT must not use a reserved, placeholder, loopback, or unspecified address for a hosted deployment",
    );
  }
}

function validateHostedHttpsRuntimeUrl(content, key, { allowQuery = false } = {}) {
  const value = environmentFileValue(content, key);
  if (!value || value.toLowerCase().includes("replace-")) {
    throw new Error(`${key} must contain a non-placeholder value`);
  }
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${key} must be a valid HTTPS URL`);
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.hash ||
    (!allowQuery && url.search)
  ) {
    throw new Error(
      `${key} must be a credential-free HTTPS URL${allowQuery ? " without a fragment" : " without a query or fragment"}`,
    );
  }
  if (isPlaceholderHostedHostname(url.hostname)) {
    throw new Error(
      `${key} must not use a reserved, placeholder, loopback, or unspecified address`,
    );
  }
  if (
    key === "OPENROUND_OTLP_BACKEND_ENDPOINT" &&
    /\/v1\/(?:traces|metrics)\/?$/i.test(url.pathname)
  ) {
    throw new Error(
      "OPENROUND_OTLP_BACKEND_ENDPOINT must be the OTLP/HTTP base endpoint without a signal suffix",
    );
  }
  return url;
}

export function validateSingleVmRuntimeValues(content, config) {
  const deploymentEnvironment = environmentFileValue(content, "OPENROUND_DEPLOYMENT_ENVIRONMENT");
  if (deploymentEnvironment !== config.environment) {
    throw new Error("OPENROUND_DEPLOYMENT_ENVIRONMENT must match the reviewed deployment target");
  }
  const configuredDomain = environmentFileValue(content, "OPENROUND_APP_DOMAIN");
  if (configuredDomain !== new URL(config.publicWebUrl).hostname) {
    throw new Error("OPENROUND_APP_DOMAIN must match the reviewed single-VM public origin");
  }
  const mediaDomain = environmentFileValue(content, "OPENROUND_MEDIA_DOMAIN");
  if (
    !PLAIN_DNS_HOSTNAME_PATTERN.test(String(mediaDomain ?? "")) ||
    mediaDomain === configuredDomain ||
    mediaDomain !== new URL(config.publicMediaUrl).hostname
  ) {
    throw new Error(
      "OPENROUND_MEDIA_DOMAIN must match the reviewed media origin and be distinct from OPENROUND_APP_DOMAIN",
    );
  }
  for (const key of [
    "OPENROUND_APP_DOMAIN",
    "OPENROUND_MEDIA_DOMAIN",
    "OPENROUND_ACME_EMAIL",
    "POSTGRES_OWNER_PASSWORD",
    "POSTGRES_APP_PASSWORD",
    "DATABASE_URL",
    "VALKEY_PASSWORD",
    "REDIS_URL",
    "MINIO_ROOT_USER",
    "MINIO_ROOT_PASSWORD",
    "MINIO_APP_ACCESS_KEY",
    "MINIO_APP_SECRET_KEY",
    "SMTP_URL",
    "EMAIL_FROM",
    "METRICS_TOKEN",
    "OPENROUND_OTLP_BACKEND_TOKEN",
    "ADMIN_TOKEN",
  ]) {
    const value = environmentFileValue(content, key);
    if (!value || value.includes("replace-")) {
      throw new Error(`${key} must contain a non-placeholder value`);
    }
  }
  const configuredBilling = environmentFileValue(content, "BILLING_MODE") ?? "disabled";
  if (configuredBilling !== config.billingMode) {
    throw new Error("BILLING_MODE must match the reviewed single-VM deployment config");
  }
  const productionSafeValues = {
    NODE_ENV: "production",
    COOKIE_SECURE: "true",
    ALLOW_INSECURE_LOCAL_HTTP: "false",
    ALLOW_IN_MEMORY: "false",
    RUN_MIGRATIONS: "false",
  };
  for (const [key, expected] of Object.entries(productionSafeValues)) {
    const value = environmentFileValue(content, key);
    if (value !== undefined && value !== expected) {
      throw new Error(`${key} must be ${expected} for a hosted single-VM deployment`);
    }
  }
  if (environmentFileValue(content, "COMMUNITY_MODE") !== "false") {
    throw new Error("COMMUNITY_MODE must be false for a hosted single-VM deployment");
  }
  if (environmentFileValue(content, "METRICS_ENABLED") !== "true") {
    throw new Error("METRICS_ENABLED must be true for a hosted single-VM deployment");
  }
  if (environmentFileValue(content, "OPENROUND_LOG_SHIPPING_MODE") !== "external-host-agent") {
    throw new Error(
      "OPENROUND_LOG_SHIPPING_MODE must be external-host-agent for a hosted single-VM deployment",
    );
  }
  validateHostedTracingValues(content);
  if (environmentFileValue(content, "TRACING_ENABLED") !== "true") {
    throw new Error("TRACING_ENABLED must be true for a hosted single-VM deployment");
  }
  if (
    environmentFileValue(content, "OTEL_EXPORTER_OTLP_TRACES_ENDPOINT") !==
    "http://otel-collector:4318/v1/traces"
  ) {
    throw new Error(
      "OTEL_EXPORTER_OTLP_TRACES_ENDPOINT must use the private single-VM collector endpoint",
    );
  }
  validateHostedHttpsRuntimeUrl(content, "OPENROUND_OTLP_BACKEND_ENDPOINT");
  const alertReceiverUrls = [
    "OPENROUND_PAGING_WEBHOOK_URL",
    "OPENROUND_WARNING_WEBHOOK_URL",
    "OPENROUND_TICKET_WEBHOOK_URL",
  ].map((key) => validateHostedHttpsRuntimeUrl(content, key, { allowQuery: true }).href);
  if (new Set(alertReceiverUrls).size !== alertReceiverUrls.length) {
    throw new Error("page, warning, and ticket receiver URLs must be distinct");
  }
  return true;
}

async function deploySingleVm({ environment, parsed, dryRun, config }) {
  const manifestPath = resolve(
    repositoryRoot,
    parsed.values.get("manifest") ?? `artifacts/deploy/${environment}/build-manifest.json`,
  );
  const { manifest, sha256: manifestSha256 } = await readBuildManifestSnapshot(manifestPath, {
    environment,
    imageRepository: config.imageRepository,
    imagePlatform: config.imagePlatform,
    publicApiUrl: config.publicApiUrl,
    requireSigning: config.requireSigning,
  });
  config.manifest = manifest;

  const rollback = parsed.flags.has("rollback");
  const rollbackFrom = parsed.values.get("rollback-from");
  let productionReleaseAcceptance;
  if (rollback) {
    assertFullGitSha(rollbackFrom, "rollback source build ID");
    validateRollbackConfirmation(
      parsed.values.get("confirm"),
      environment,
      manifest.buildId,
      rollbackFrom,
    );
    await verifyRollbackAncestry(manifest.buildId, rollbackFrom);
  } else {
    if (rollbackFrom) throw new Error("--rollback-from requires --rollback");
    validateDeploymentConfirmation(parsed.values.get("confirm"), environment, manifest.buildId);
  }
  const publishedRedeployRequested = parsed.flags.has("published-release-redeploy");
  const priorReceiptPath = parsed.values.get("prior-deployment-receipt");
  const priorReceiptDigest = parsed.values.get("prior-deployment-receipt-sha256");
  if (
    publishedRedeployRequested !== Boolean(priorReceiptPath) ||
    publishedRedeployRequested !== Boolean(priorReceiptDigest)
  ) {
    throw new Error(
      "Published-release redeploy requires the explicit mode, prior receipt path, and reviewed receipt SHA-256 together",
    );
  }
  if (publishedRedeployRequested && (environment !== "production" || rollback)) {
    throw new Error("Published-release redeploy is valid only for forward production deployments");
  }
  const { knownHostsContent, identityFile, deploymentFiles, deploymentInputHashes } =
    await resolveSingleVmFiles(config, parsed.values.get("ssh-identity"));
  config.deploymentInputHashes = {
    ...config.deploymentInputHashes,
    ...deploymentInputHashes,
  };
  const publishedRedeploy = publishedRedeployRequested
    ? {
        ...(await readPublishedReleaseRedeployReceipt(priorReceiptPath, priorReceiptDigest)),
        config,
      }
    : undefined;
  if (!rollback) {
    const productionAcceptance =
      environment === "production" && config.requireSigning && config.requireReadinessGate;
    if (productionAcceptance) {
      productionReleaseAcceptance = await assertProductionReleaseRevision({
        operationsRevision: config.operationsRevision,
        manifest,
        manifestPath,
        manifestSha256,
        publishedRedeploy,
      });
    } else if (config.operationsRevision !== manifest.buildId) {
      throw new Error(
        "Normal single-VM deploys require operations HEAD to match the build manifest",
      );
    }
  }

  const runtimePath = parsed.values.get("runtime-env");
  const migrationPath = parsed.values.get("migration-env");
  if (!runtimePath || (!rollback && !migrationPath)) {
    throw new Error(
      "Hosted deployments require --runtime-env and, unless rolling back, --migration-env",
    );
  }
  if (rollback && migrationPath) {
    throw new Error("--migration-env must be omitted with --rollback");
  }
  const configuredSecretsRoot = join(repositoryRoot, "artifacts", "deploy", environment);
  const selectedRuntimePath = resolve(repositoryRoot, runtimePath);
  assertPathWithin(selectedRuntimePath, configuredSecretsRoot, "runtime environment file");
  const selectedMigrationPath = migrationPath ? resolve(repositoryRoot, migrationPath) : undefined;
  if (selectedMigrationPath) {
    assertPathWithin(selectedMigrationPath, configuredSecretsRoot, "migration environment file");
  }
  const secretsRoot = await realpath(configuredSecretsRoot);
  if (secretsRoot !== configuredSecretsRoot) {
    throw new Error("Deployment secrets directory must not contain symlinked path components");
  }
  const runtimeEnv = await assertPrivateIgnoredEnvFile(
    runtimePath,
    "single-vm-runtime",
    repositoryRoot,
  );
  const migrationEnv = migrationPath
    ? await assertPrivateIgnoredEnvFile(migrationPath, "migration", repositoryRoot)
    : undefined;
  if (runtimeEnv.absolute !== selectedRuntimePath) {
    throw new Error("runtime environment file path must not contain symlinked path components");
  }
  if (migrationEnv && migrationEnv.absolute !== selectedMigrationPath) {
    throw new Error("migration environment file path must not contain symlinked path components");
  }
  assertPathWithin(runtimeEnv.absolute, secretsRoot, "runtime environment file");
  if (migrationEnv)
    assertPathWithin(migrationEnv.absolute, secretsRoot, "migration environment file");
  await ensureIgnoredEnvFile(runtimeEnv, repositoryRoot, "runtime");
  if (migrationEnv) await ensureIgnoredEnvFile(migrationEnv, repositoryRoot, "migration");

  let backup;
  if (environment === "production") {
    backup = backupReference(parsed.values.get("backup-reference"));
  } else if (parsed.values.has("backup-reference")) {
    backup = backupReference(parsed.values.get("backup-reference"));
  }

  await assertOperationsRevision(config.operationsRevision);
  for (const command of [
    "ssh",
    ...(rollback ? ["git"] : []),
    ...(config.requireSigning ? ["cosign"] : []),
  ]) {
    await assertCommandAvailable(command, { cwd: repositoryRoot, dryRun });
  }
  if (config.requireReadinessGate) {
    await run(
      process.execPath,
      ["scripts/check-release-readiness.mjs", `--require=${config.readinessTarget}`],
      { cwd: repositoryRoot, dryRun },
    );
  }
  await verifySignatures(
    config,
    manifest,
    dryRun,
    productionReleaseAcceptance?.certificateIdentity,
  );
  if (rollback) await verifyRollbackSource(config, rollbackFrom, manifest.buildId, dryRun);

  const runtimeContent = runtimeEnv.content;
  validateSingleVmRuntimeValues(runtimeContent, config);
  const runtimeEnvironmentDigest = runtimeEnvironmentSha256(runtimeContent);

  const knownHostsSnapshot = await createPrivateFileSnapshot(knownHostsContent, "known_hosts");
  const knownHostsFile = knownHostsSnapshot.path;
  const startedAt = new Date().toISOString();
  const token = dryRun ? "dry-run" : randomUUID();
  const incomingRoot = `${config.singleVm.deployPath}/incoming/${token}`;
  const interruptGuard = createDeploymentInterruptGuard();
  let remotePrepared = false;
  let previousBuildId;
  let lockPath;
  try {
    lockPath = dryRun
      ? undefined
      : await acquireLock(environment, manifest.buildId, {
          recover: parsed.flags.has("recover-lock"),
        });
    interruptGuard.throwIfInterrupted();
    previousBuildId = await readRemoteCurrentBuild(
      config,
      knownHostsFile,
      identityFile,
      dryRun,
      interruptGuard,
    );
    if (rollback && !dryRun) assertRemoteRollbackSource(previousBuildId, rollbackFrom);
    assertRemoteTargetNotActive(previousBuildId, manifest.buildId);
    if (!rollback && !dryRun) {
      await verifyForwardDeploymentAncestry(previousBuildId, manifest.buildId);
    }
    // Treat preparation as cleanup-owned before the SSH call starts. If a signal lands after the
    // remote directory is created but before SSH returns, removing a missing token is still safe.
    remotePrepared = !dryRun;
    await sshRun(
      config,
      knownHostsFile,
      identityFile,
      ["sh", "-c", REMOTE_PREPARE_SCRIPT, "--", config.singleVm.deployPath, token],
      { dryRun, interruptGuard },
    );

    for (const [relativePath, file] of deploymentFiles) {
      await remoteWrite(
        config,
        knownHostsFile,
        identityFile,
        `${incomingRoot}/${relativePath}`,
        file.content,
        file.mode,
        dryRun,
        interruptGuard,
      );
    }
    await remoteWrite(
      config,
      knownHostsFile,
      identityFile,
      `${incomingRoot}/.compose-files`,
      `${config.singleVm.composeFiles.join("\n")}\n`,
      "0600",
      dryRun,
      interruptGuard,
    );
    await remoteWrite(
      config,
      knownHostsFile,
      identityFile,
      `${incomingRoot}/.env`,
      releaseEnvironment(runtimeContent, manifest, runtimeEnv.keys),
      "0600",
      dryRun,
      interruptGuard,
    );
    if (migrationEnv) {
      await remoteWrite(
        config,
        knownHostsFile,
        identityFile,
        `${incomingRoot}/.migration.env`,
        migrationEnv.content,
        "0600",
        dryRun,
        interruptGuard,
      );
    }
    interruptGuard.throwIfInterrupted();
    interruptGuard.dispose();
    await sshRun(
      config,
      knownHostsFile,
      identityFile,
      [
        "sh",
        "-se",
        "--",
        config.singleVm.deployPath,
        config.singleVm.projectName,
        manifest.buildId,
        token,
        parsed.flags.has("recover-lock") ? "1" : "0",
        rollback ? "1" : "0",
        previousBuildId ?? "none",
        rollback ? rollbackFrom : "none",
      ],
      { dryRun, input: REMOTE_DEPLOY_SCRIPT },
    );
    remotePrepared = false;

    if (rollback) {
      process.stdout.write("Code rollback selected; forward-only database migration is skipped.\n");
    }
    if (!dryRun) {
      let configCheckSummary;
      try {
        await waitForDeploymentHealth(config, manifest.buildId);
        await waitForWebBuild(config, manifest.buildId);
        await waitForMediaHealth(config);
        configCheckSummary = await readRemoteConfigCheckSummary(
          config,
          knownHostsFile,
          identityFile,
          manifest.buildId,
        );
      } catch (error) {
        if (previousBuildId) {
          try {
            await restorePreviousRemoteBuild(config, knownHostsFile, identityFile, previousBuildId);
            await waitForDeploymentHealth(config, previousBuildId);
            await waitForWebBuild(config, previousBuildId);
            await waitForMediaHealth(config);
          } catch (restoreError) {
            throw new AggregateError(
              [error, restoreError],
              "Candidate health verification failed and the previous single-VM release could not be restored",
              { cause: restoreError },
            );
          }
          throw new Error(
            `Candidate health verification failed; restored previous build ${previousBuildId}`,
            { cause: error },
          );
        }
        try {
          await deactivateFailedCurrentRemoteBuild(
            config,
            knownHostsFile,
            identityFile,
            manifest.buildId,
          );
        } catch (deactivateError) {
          throw new AggregateError(
            [error, deactivateError],
            "First-release health verification failed and the failed single-VM release could not be deactivated",
            { cause: deactivateError },
          );
        }
        throw new Error("First-release health verification failed; deactivated failed release", {
          cause: error,
        });
      }
      const receipt = await writeReceipt({
        environment,
        buildId: manifest.buildId,
        config,
        manifestPath,
        manifestSha256,
        backup,
        startedAt,
        rollback,
        rollbackFrom,
        runtimeEnvironmentDigest,
        configCheckSummary,
        releaseAcceptance: productionReleaseAcceptance,
      });
      process.stdout.write(`Deployment receipt: ${receipt}\n`);
    } else {
      process.stdout.write(
        "Dry run complete; no remote files, migration, deployment, health probe, or receipt ran.\n",
      );
    }
  } catch (error) {
    if (remotePrepared) {
      try {
        await sshRun(
          config,
          knownHostsFile,
          identityFile,
          ["sh", "-c", REMOTE_REMOVE_INCOMING_SCRIPT, "--", config.singleVm.deployPath, token],
          { dryRun },
        );
      } catch (cleanupError) {
        throw new AggregateError(
          [error, cleanupError],
          "Single-VM deployment failed and its incoming secret files could not be removed",
          { cause: cleanupError },
        );
      }
    }
    throw error;
  } finally {
    interruptGuard.dispose();
    if (lockPath) await rm(lockPath, { force: true });
    await knownHostsSnapshot.cleanup();
  }
}

async function deployHosted({ environment, parsed, dryRun }) {
  const operationsRevision = await currentOperationsRevision();
  const expectedConfig = `config/deploy/${configFileName(environment)}`;
  const selectedConfigPath = strictTargetPath(
    parsed.values.get("config"),
    expectedConfig,
    "--config",
  );
  const configPath = await resolveCheckedRepositoryFile(
    selectedConfigPath,
    repositoryRoot,
    "deployment config",
    { requireGitClean: true },
  );
  const config = await readStrictJson(configPath, validateDeployConfig, environment);
  assertConfiguredHostedTarget(config);
  const reviewedAutomationFiles = [
    ...HOSTED_DEPLOYMENT_AUTOMATION_FILES,
    ...(config.requireReadinessGate ? READINESS_GATE_INPUT_FILES : []),
  ];
  config.operationsRevision = operationsRevision;
  config.deploymentInputHashes = {
    ...(await resolveReviewedDeploymentInputHashes(reviewedAutomationFiles)),
    [expectedConfig]: await sha256File(configPath),
  };
  if (config.deploymentMode === "single-vm") {
    await deploySingleVm({ environment, parsed, dryRun, config });
    return;
  }
  if (
    parsed.flags.has("published-release-redeploy") ||
    parsed.values.has("prior-deployment-receipt") ||
    parsed.values.has("prior-deployment-receipt-sha256")
  ) {
    throw new Error("Published-release redeploy proof is supported only for single-VM production");
  }
  const expectedServerConfig = `config/deploy/fly/${environment}-server.toml`;
  const serverConfigPath = await resolveCheckedRepositoryFile(
    strictTargetPath(config.fly.serverConfig, expectedServerConfig, "server Fly config"),
    repositoryRoot,
    "server Fly config",
    { requireGitClean: true },
  );
  config.deploymentInputHashes[expectedServerConfig] = await sha256File(serverConfigPath);
  const flyEnvironment = validateFlyRuntimeEnvironment(
    parseFlyTomlEnvironment(await readFile(serverConfigPath, "utf8")),
    config,
  );
  const configCheckEnvironment = {
    ...flyEnvironment,
    FEATURE_SESSION_CREATION: "true",
    FEATURE_MEDIA_UPLOADS: "true",
  };
  const expectedWebConfig = `config/deploy/fly/${environment}-web.toml`;
  const webConfigPath = await resolveCheckedRepositoryFile(
    strictTargetPath(config.fly.webConfig, expectedWebConfig, "web Fly config"),
    repositoryRoot,
    "web Fly config",
    { requireGitClean: true },
  );
  config.deploymentInputHashes[expectedWebConfig] = await sha256File(webConfigPath);
  await assertOperationsRevision(config.operationsRevision);
  const flyWebEnvironment = validateFlyWebEnvironment(
    parseFlyTomlEnvironment(await readFile(webConfigPath, "utf8")),
    config,
  );
  const manifestPath = resolve(
    repositoryRoot,
    parsed.values.get("manifest") ?? `artifacts/deploy/${environment}/build-manifest.json`,
  );
  const { manifest, sha256: manifestSha256 } = await readBuildManifestSnapshot(manifestPath, {
    environment,
    imageRepository: config.imageRepository,
    imagePlatform: config.imagePlatform,
    publicApiUrl: config.publicApiUrl,
    requireSigning: config.requireSigning,
  });
  config.manifest = manifest;

  const rollback = parsed.flags.has("rollback");
  const rollbackFrom = parsed.values.get("rollback-from");
  if (rollback) {
    assertFullGitSha(rollbackFrom, "rollback source build ID");
    validateRollbackConfirmation(
      parsed.values.get("confirm"),
      environment,
      manifest.buildId,
      rollbackFrom,
    );
    await verifyRollbackAncestry(manifest.buildId, rollbackFrom);
  } else {
    if (rollbackFrom) throw new Error("--rollback-from requires --rollback");
    validateDeploymentConfirmation(parsed.values.get("confirm"), environment, manifest.buildId);
  }
  const runtimePath = parsed.values.get("runtime-env");
  const migrationPath = parsed.values.get("migration-env");
  if (!runtimePath || (!rollback && !migrationPath)) {
    throw new Error(
      "Hosted deployments require --runtime-env and, unless rolling back, --migration-env",
    );
  }
  if (rollback && migrationPath) {
    throw new Error("--migration-env must be omitted with --rollback");
  }
  const configuredSecretsRoot = join(repositoryRoot, "artifacts", "deploy", environment);
  const selectedRuntimePath = resolve(repositoryRoot, runtimePath);
  assertPathWithin(selectedRuntimePath, configuredSecretsRoot, "runtime environment file");
  const selectedMigrationPath = migrationPath ? resolve(repositoryRoot, migrationPath) : undefined;
  if (migrationPath) {
    assertPathWithin(selectedMigrationPath, configuredSecretsRoot, "migration environment file");
  }
  const secretsRoot = await realpath(configuredSecretsRoot);
  if (secretsRoot !== configuredSecretsRoot) {
    throw new Error(`Deployment secrets directory must not contain symlinked path components`);
  }
  const runtimeEnv = await assertPrivateIgnoredEnvFile(runtimePath, "runtime", repositoryRoot);
  const migrationEnv = migrationPath
    ? await assertPrivateIgnoredEnvFile(migrationPath, "migration", repositoryRoot)
    : undefined;
  if (runtimeEnv.absolute !== selectedRuntimePath) {
    throw new Error("runtime environment file path must not contain symlinked path components");
  }
  if (migrationPath && migrationEnv.absolute !== selectedMigrationPath) {
    throw new Error("migration environment file path must not contain symlinked path components");
  }
  assertPathWithin(runtimeEnv.absolute, secretsRoot, "runtime environment file");
  if (migrationEnv) {
    assertPathWithin(migrationEnv.absolute, secretsRoot, "migration environment file");
  }
  assertNoEnvironmentKeyOverlap(
    runtimeEnv.keys,
    Object.keys(configCheckEnvironment),
    "runtime environment file",
    "checked Fly environment",
  );
  await ensureIgnoredEnvFile(runtimeEnv, repositoryRoot, "runtime");
  if (migrationEnv) await ensureIgnoredEnvFile(migrationEnv, repositoryRoot, "migration");
  const runtimeEnvironmentDigest = runtimeEnvironmentSha256(runtimeEnv.content);

  let backup;
  if (environment === "production") {
    backup = backupReference(parsed.values.get("backup-reference"));
  } else if (parsed.values.has("backup-reference")) {
    backup = backupReference(parsed.values.get("backup-reference"));
  }

  for (const command of [
    "docker",
    "flyctl",
    ...(rollback ? ["git"] : []),
    ...(config.requireSigning ? ["cosign"] : []),
  ]) {
    await assertCommandAvailable(command, { cwd: repositoryRoot, dryRun });
  }
  await validateFlyConfigs(config, serverConfigPath, webConfigPath, dryRun);
  if (config.requireReadinessGate) {
    await run(
      process.execPath,
      ["scripts/check-release-readiness.mjs", `--require=${config.readinessTarget}`],
      { cwd: repositoryRoot, dryRun },
    );
  }
  await verifySignatures(config, manifest, dryRun);
  await verifyFlySecretSeparation(
    config.fly.serverApp,
    configCheckEnvironment,
    dryRun,
    runtimeEnv.keys,
  );
  await verifyFlySecretSeparation(config.fly.webApp, flyWebEnvironment, dryRun);

  const startedAt = new Date().toISOString();
  const lockPath = dryRun
    ? undefined
    : await acquireLock(environment, manifest.buildId, {
        recover: parsed.flags.has("recover-lock"),
      });
  try {
    if (rollback) {
      await verifyRollbackSource(config, rollbackFrom, manifest.buildId, dryRun);
    }
    await verifyConfigCheck(
      manifest.images.server.ref,
      runtimeEnv.absolute,
      config,
      configCheckEnvironment,
      manifest.buildId,
      dryRun,
    );
    await verifyEmbeddedWebBuild(manifest.images.web.ref, config, manifest.buildId, dryRun);
    if (rollback) {
      process.stdout.write("Code rollback selected; forward-only database migration is skipped.\n");
    } else {
      await run(
        "docker",
        [
          "run",
          "--rm",
          "--platform",
          config.imagePlatform,
          "--env-file",
          migrationEnv.absolute,
          "--entrypoint",
          "node",
          manifest.images.server.ref,
          "dist/migrate.js",
        ],
        { cwd: repositoryRoot, dryRun },
      );
    }
    await run(
      "flyctl",
      [
        "deploy",
        "--config",
        serverConfigPath,
        "--app",
        config.fly.serverApp,
        "--image",
        manifest.images.server.ref,
        "--remote-only",
        "--wait-timeout",
        `${config.health.timeoutSeconds}s`,
        "--yes",
      ],
      { cwd: repositoryRoot, dryRun },
    );
    if (!dryRun) await waitForDeploymentHealth(config, manifest.buildId);
    await run(
      "flyctl",
      [
        "deploy",
        "--config",
        webConfigPath,
        "--app",
        config.fly.webApp,
        "--image",
        manifest.images.web.ref,
        "--remote-only",
        "--wait-timeout",
        `${config.health.timeoutSeconds}s`,
        "--yes",
      ],
      { cwd: repositoryRoot, dryRun },
    );
    if (!dryRun) await waitForWebBuild(config, manifest.buildId);
    if (!dryRun) {
      const receipt = await writeReceipt({
        environment,
        buildId: manifest.buildId,
        config,
        manifestPath,
        manifestSha256,
        backup,
        startedAt,
        rollback,
        rollbackFrom,
        runtimeEnvironmentDigest,
      });
      process.stdout.write(`Deployment receipt: ${receipt}\n`);
    } else {
      process.stdout.write(
        "Dry run complete; no migration, deployment, health probe, or receipt ran.\n",
      );
    }
  } finally {
    if (lockPath) await rm(lockPath, { force: true });
  }
}

export async function main(argv = process.argv.slice(2)) {
  const parsed = parseCliArguments(argv, {
    valueOptions: [
      "environment",
      "config",
      "manifest",
      "runtime-env",
      "migration-env",
      "confirm",
      "backup-reference",
      "profile",
      "rollback-from",
      "ssh-identity",
      "prior-deployment-receipt",
      "prior-deployment-receipt-sha256",
    ],
    booleanOptions: [
      "dry-run",
      "no-build",
      "rollback",
      "recover-lock",
      "published-release-redeploy",
      "help",
    ],
  });
  if (parsed.flags.has("help")) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  if (parsed.positionals.length > 1) throw new Error("Too many positional arguments");
  const explicit = parsed.values.get("environment");
  const positional = parsed.positionals[0];
  if (
    explicit &&
    positional &&
    normalizeEnvironment(explicit) !== normalizeEnvironment(positional)
  ) {
    throw new Error("The positional environment conflicts with --environment");
  }
  const environment = normalizeEnvironment(explicit ?? positional);
  const dryRun = parsed.flags.has("dry-run");
  if (!isHostedEnvironment(environment)) {
    const hostedOptions = [
      "config",
      "manifest",
      "runtime-env",
      "migration-env",
      "confirm",
      "backup-reference",
      "rollback-from",
      "ssh-identity",
      "prior-deployment-receipt",
      "prior-deployment-receipt-sha256",
    ];
    if (hostedOptions.some((option) => parsed.values.has(option))) {
      throw new Error("Hosted deployment options are not valid for development");
    }
    if (
      parsed.flags.has("rollback") ||
      parsed.flags.has("recover-lock") ||
      parsed.flags.has("published-release-redeploy")
    ) {
      throw new Error(
        "--rollback, --recover-lock, and --published-release-redeploy are valid only for hosted environments",
      );
    }
    await serviceMain([
      "--environment",
      "development",
      "start",
      ...(parsed.values.has("profile") ? ["--profile", parsed.values.get("profile")] : []),
      ...(parsed.flags.has("no-build") ? ["--no-build"] : []),
      ...(dryRun ? ["--dry-run"] : []),
    ]);
    return;
  }
  if (parsed.values.has("profile") || parsed.flags.has("no-build")) {
    throw new Error("--profile and --no-build are development-only");
  }
  await deployHosted({ environment, parsed, dryRun });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`Deployment failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}
