import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

import { validateIndependentGateAcceptance } from "./evidence-acceptance.mjs";

const FULL_GIT_SHA_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const SHA256_DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;
const SEMVER_NUMERIC_IDENTIFIER = String.raw`(?:0|[1-9]\d*)`;
const SEMVER_NON_NUMERIC_IDENTIFIER = String.raw`(?:[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*)`;
const SEMVER_PRERELEASE_IDENTIFIER = String.raw`(?:${SEMVER_NUMERIC_IDENTIFIER}|${SEMVER_NON_NUMERIC_IDENTIFIER})`;
const RELEASE_TAG_PATTERN = new RegExp(
  String.raw`^v${SEMVER_NUMERIC_IDENTIFIER}\.${SEMVER_NUMERIC_IDENTIFIER}\.${SEMVER_NUMERIC_IDENTIFIER}(?:-${SEMVER_PRERELEASE_IDENTIFIER}(?:\.${SEMVER_PRERELEASE_IDENTIFIER})*)?$`,
);
const SIGNED_RELEASE_GATE_ID = "signed-release";
const TRUSTED_REPOSITORY = "riojung/pollingpops";
// Historical signed artifacts retain their original repository identity.
const LEGACY_TRUSTED_REPOSITORY = "riojung/openround";
const SHA256_SUMS_ASSET = "SHA256SUMS";
const ISO_UTC_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

function fail(message) {
  throw new Error(`Signed release acceptance ${message}`);
}

export function validateReleaseTag(tag) {
  if (typeof tag !== "string" || !RELEASE_TAG_PATTERN.test(tag)) {
    fail("tag must be a strict v-prefixed SemVer 2.0 version without build metadata");
  }
  return tag;
}

function assertObject(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail(`${label} must be an object`);
  }
}

function assertExactKeys(value, expected, label) {
  assertObject(value, label);
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (!isDeepStrictEqual(actual, wanted)) {
    fail(`${label} must contain exactly ${wanted.join(", ")}`);
  }
}

function assertPositiveSafeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) fail(`${label} must be a positive integer`);
}

function assertIsoUtcTimestamp(value, label) {
  if (typeof value !== "string" || !ISO_UTC_PATTERN.test(value)) {
    fail(`${label} must be an ISO-8601 UTC timestamp`);
  }
  const milliseconds = Date.parse(value);
  const normalized = value.includes(".") ? value : value.replace("Z", ".000Z");
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== normalized) {
    fail(`${label} must be a real ISO-8601 UTC timestamp`);
  }
}

function assertTrustedGithubUrl(value, expected, label) {
  if (typeof value !== "string") fail(`${label} must be a trusted GitHub URL`);
  let url;
  try {
    url = new URL(value);
  } catch {
    fail(`${label} must be a trusted GitHub URL`);
  }
  if (
    url.username !== "" ||
    url.password !== "" ||
    url.search !== "" ||
    url.hash !== "" ||
    value !== url.href ||
    (expected !== undefined && value !== expected)
  ) {
    fail(`${label} must be a trusted GitHub URL`);
  }
  return url;
}

function releaseBindingRepository(binding) {
  const repository = [TRUSTED_REPOSITORY, LEGACY_TRUSTED_REPOSITORY].find(
    (candidate) =>
      binding.githubRelease.apiUrl ===
      `https://api.github.com/repos/${candidate}/releases/${binding.githubRelease.id}`,
  );
  if (!repository) fail("releaseBinding.githubRelease.apiUrl must be a trusted GitHub URL");
  return repository;
}

function liveRepositoryUrls(repository, suffix, api = false) {
  const repositories =
    repository === LEGACY_TRUSTED_REPOSITORY
      ? [LEGACY_TRUSTED_REPOSITORY, TRUSTED_REPOSITORY]
      : [TRUSTED_REPOSITORY];
  const prefix = api ? "https://api.github.com/repos/" : "https://github.com/";
  return repositories.map((candidate) => `${prefix}${candidate}${suffix}`);
}

export function resolveReleaseCertificateIdentity(binding) {
  validateReleaseBinding(binding);
  const repository = releaseBindingRepository(binding);
  return `https://github.com/${repository}/.github/workflows/release.yml@refs/tags/${binding.tag}`;
}

export function requiredReleaseAssetNames(tag, components = ["server", "web"]) {
  validateReleaseTag(tag);
  const version = tag.slice(1);
  return [
    SHA256_SUMS_ASSET,
    `openround-${tag}-manifest.json`,
    `openround-${tag}-preflight.json`,
    `openround-${version}-source.tar.gz`,
    "release-notes.md",
    ...components.flatMap((component) => [
      `openround-${component}-${tag}-cosign-verification.json`,
      `openround-${component}-${tag}-provenance.slsa.json`,
      `openround-${component}-${tag}-sbom.spdx.json`,
      `openround-${component}-${tag}-trivy.sarif`,
    ]),
  ].sort();
}

function validateBoundReleaseAssets(assets, binding) {
  if (!Array.isArray(assets)) fail("releaseBinding.assets must be an array");
  const expectedNames = requiredReleaseAssetNames(binding.tag, Object.keys(binding.imageDigests));
  const actualNames = assets.map((asset) => asset?.name).sort();
  if (!isDeepStrictEqual(actualNames, expectedNames)) {
    fail("releaseBinding.assets must contain the exact required release asset set");
  }

  const ids = new Set();
  const repository = releaseBindingRepository(binding);
  for (const asset of assets) {
    assertExactKeys(
      asset,
      ["id", "name", "size", "digest", "apiUrl", "downloadUrl"],
      `releaseBinding.assets.${asset?.name ?? "unknown"}`,
    );
    assertPositiveSafeInteger(asset.id, `releaseBinding.assets.${asset.name}.id`);
    if (ids.has(asset.id)) fail("releaseBinding.assets must use unique GitHub asset IDs");
    ids.add(asset.id);
    if (!Number.isSafeInteger(asset.size) || asset.size <= 0) {
      fail(`releaseBinding.assets.${asset.name}.size must be a positive integer`);
    }
    if (typeof asset.digest !== "string" || !SHA256_DIGEST_PATTERN.test(asset.digest)) {
      fail(`releaseBinding.assets.${asset.name}.digest must be a sha256 digest`);
    }
    assertTrustedGithubUrl(
      asset.apiUrl,
      `https://api.github.com/repos/${repository}/releases/assets/${asset.id}`,
      `releaseBinding.assets.${asset.name}.apiUrl`,
    );
    assertTrustedGithubUrl(
      asset.downloadUrl,
      `https://github.com/${repository}/releases/download/${binding.tag}/${asset.name}`,
      `releaseBinding.assets.${asset.name}.downloadUrl`,
    );
  }

  const manifest = assets.find((asset) => asset.name === `openround-${binding.tag}-manifest.json`);
  if (manifest.digest !== binding.manifestDigest) {
    fail("releaseBinding manifest asset digest must match manifestDigest");
  }
  return assets;
}

function withoutKeys(value, keys) {
  const result = { ...value };
  for (const key of keys) delete result[key];
  return result;
}

function signedReleaseGate(ledger, label) {
  assertObject(ledger, label);
  if (!Array.isArray(ledger.gates)) fail(`${label}.gates must be an array`);
  const matches = ledger.gates.filter((gate) => gate?.id === SIGNED_RELEASE_GATE_ID);
  if (matches.length !== 1) fail(`${label} must contain exactly one signed-release gate`);
  return matches[0];
}

export function validateReleaseBinding(binding, expected = {}) {
  assertExactKeys(
    binding,
    [
      "schemaVersion",
      "tag",
      "tagObject",
      "buildId",
      "githubRelease",
      "manifestDigest",
      "imageDigests",
      "assets",
    ],
    "releaseBinding",
  );
  if (binding.schemaVersion !== 2) fail("releaseBinding.schemaVersion must be 2");
  try {
    validateReleaseTag(binding.tag);
  } catch (error) {
    throw new Error(
      "Signed release acceptance releaseBinding.tag must be a strict v-prefixed SemVer 2.0 version without build metadata",
      { cause: error },
    );
  }
  if (typeof binding.tagObject !== "string" || !FULL_GIT_SHA_PATTERN.test(binding.tagObject)) {
    fail("releaseBinding.tagObject must be a full Git object ID");
  }
  if (typeof binding.buildId !== "string" || !FULL_GIT_SHA_PATTERN.test(binding.buildId)) {
    fail("releaseBinding.buildId must be a full Git commit ID");
  }
  assertExactKeys(
    binding.githubRelease,
    ["id", "apiUrl", "htmlUrl", "targetCommitish", "draft", "createdAt"],
    "releaseBinding.githubRelease",
  );
  assertPositiveSafeInteger(binding.githubRelease.id, "releaseBinding.githubRelease.id");
  const repository = releaseBindingRepository(binding);
  assertTrustedGithubUrl(
    binding.githubRelease.apiUrl,
    `https://api.github.com/repos/${repository}/releases/${binding.githubRelease.id}`,
    "releaseBinding.githubRelease.apiUrl",
  );
  const htmlUrl = assertTrustedGithubUrl(
    binding.githubRelease.htmlUrl,
    undefined,
    "releaseBinding.githubRelease.htmlUrl",
  );
  if (
    htmlUrl.origin !== "https://github.com" ||
    (htmlUrl.pathname !== `/${repository}/releases/tag/${binding.tag}` &&
      !(
        htmlUrl.pathname.startsWith(`/${repository}/releases/tag/`) &&
        /^untagged-[A-Za-z0-9-]+$/.test(
          htmlUrl.pathname.slice(`/${repository}/releases/tag/`.length),
        )
      ))
  ) {
    fail("releaseBinding.githubRelease.htmlUrl must identify the trusted GitHub release");
  }
  if (binding.githubRelease.targetCommitish !== binding.buildId) {
    fail("releaseBinding.githubRelease.targetCommitish must match buildId");
  }
  if (binding.githubRelease.draft !== true) {
    fail("releaseBinding.githubRelease.draft must be true");
  }
  assertIsoUtcTimestamp(binding.githubRelease.createdAt, "releaseBinding.githubRelease.createdAt");
  if (
    typeof binding.manifestDigest !== "string" ||
    !SHA256_DIGEST_PATTERN.test(binding.manifestDigest)
  ) {
    fail("releaseBinding.manifestDigest must be a sha256 digest");
  }
  const imageComponents = ["server", "web", ...(binding.imageDigests?.control ? ["control"] : [])];
  assertExactKeys(binding.imageDigests, imageComponents, "releaseBinding.imageDigests");
  for (const component of imageComponents) {
    if (
      typeof binding.imageDigests[component] !== "string" ||
      !SHA256_DIGEST_PATTERN.test(binding.imageDigests[component])
    ) {
      fail(`releaseBinding.imageDigests.${component} must be a sha256 digest`);
    }
  }
  validateBoundReleaseAssets(binding.assets, binding);

  for (const [key, value] of Object.entries(expected)) {
    if (value !== undefined && binding[key] !== value) {
      fail(`releaseBinding.${key} does not match the selected release artifact`);
    }
  }
  return binding;
}

function validateGithubReleaseContents(release, binding) {
  validateReleaseBinding(binding);
  assertObject(release, "GitHub release");
  const expected = binding.githubRelease;
  const repository = releaseBindingRepository(binding);
  const comparisons = [
    [release.id, expected.id, "id"],
    [release.tag_name, binding.tag, "tag"],
    [release.target_commitish, binding.buildId, "target commit"],
    [release.created_at, expected.createdAt, "creation time"],
  ];
  for (const [actual, wanted, label] of comparisons) {
    if (actual !== wanted) fail(`GitHub release ${label} does not match releaseBinding`);
  }
  assertTrustedGithubUrl(release.url, undefined, "GitHub release API URL");
  if (!liveRepositoryUrls(repository, `/releases/${expected.id}`, true).includes(release.url)) {
    fail("GitHub release API URL does not match releaseBinding");
  }
  const liveHtmlUrl = assertTrustedGithubUrl(
    release.html_url,
    undefined,
    "GitHub release HTML URL",
  );
  const boundHtmlSuffix = new URL(expected.htmlUrl).pathname.slice(`/${repository}`.length);
  if (
    !liveRepositoryUrls(repository, boundHtmlSuffix).includes(liveHtmlUrl.href) &&
    !(
      release.draft === false &&
      liveRepositoryUrls(repository, `/releases/tag/${binding.tag}`).includes(liveHtmlUrl.href)
    )
  ) {
    fail("GitHub release HTML URL does not match releaseBinding or its published tag URL");
  }
  if (release.prerelease !== false) fail("GitHub release must not be marked prerelease");
  // Historical signed releases remain valid for verification and recovery.
  if (![`Polling Pops ${binding.tag}`, `OpenRound ${binding.tag}`].includes(release.name)) {
    fail("GitHub release title does not match the accepted release");
  }
  if (!Array.isArray(release.assets)) fail("GitHub release assets must be an array");
  const actualAssets = [...release.assets].sort((left, right) =>
    String(left?.name).localeCompare(String(right?.name)),
  );
  const boundAssets = [...binding.assets].sort((left, right) =>
    left.name.localeCompare(right.name),
  );
  if (actualAssets.length !== boundAssets.length) {
    fail("GitHub release does not contain the exact accepted asset set");
  }
  for (let index = 0; index < boundAssets.length; index += 1) {
    const actual = actualAssets[index];
    const bound = boundAssets[index];
    if (
      actual?.id !== bound.id ||
      actual?.name !== bound.name ||
      actual?.size !== bound.size ||
      actual?.digest !== bound.digest ||
      !liveRepositoryUrls(repository, `/releases/assets/${bound.id}`, true).includes(actual?.url) ||
      actual?.state !== "uploaded"
    ) {
      fail(`GitHub release asset ${bound.name} does not match releaseBinding`);
    }
    if (
      !liveRepositoryUrls(repository, `/releases/download/${binding.tag}/${bound.name}`).includes(
        actual?.browser_download_url,
      )
    ) {
      const liveDownloadUrl = assertTrustedGithubUrl(
        actual?.browser_download_url,
        undefined,
        `GitHub release asset ${bound.name} browser download URL`,
      );
      const draftSuffix = liveDownloadUrl.pathname.slice(0, -`/${bound.name}`.length);
      const trustedDraftUrl = liveRepositoryUrls(repository, "/releases/download/").some(
        (prefix) =>
          liveDownloadUrl.href.startsWith(prefix) &&
          /^untagged-[A-Za-z0-9-]+$/.test(draftSuffix.slice(new URL(prefix).pathname.length)),
      );
      if (
        release.draft !== true ||
        liveDownloadUrl.origin !== "https://github.com" ||
        !trustedDraftUrl ||
        !liveDownloadUrl.pathname.endsWith(`/${bound.name}`)
      ) {
        fail(`GitHub release asset ${bound.name} download URL is not trusted`);
      }
    }
  }
  const notesAsset = boundAssets.find((asset) => asset.name === "release-notes.md");
  if (typeof release.body !== "string") fail("GitHub release notes must be text");
  const releaseBody = Buffer.from(release.body);
  const releaseBodyDigest = `sha256:${createHash("sha256").update(releaseBody).digest("hex")}`;
  if (releaseBody.length !== notesAsset.size || releaseBodyDigest !== notesAsset.digest) {
    fail("GitHub release notes do not match the accepted release-notes.md asset");
  }
  return release;
}

export function validateDraftGithubRelease(release, binding) {
  validateGithubReleaseContents(release, binding);
  if (release.draft !== true || release.published_at !== null) {
    fail("GitHub release must remain an unpublished draft");
  }
  return release;
}

export function validateAcceptedGithubRelease(release, binding, acceptedAt) {
  assertIsoUtcTimestamp(acceptedAt, "signed-release acceptance.acceptedAt");
  return validateDraftGithubRelease(release, binding);
}

export function validatePublishedGithubRelease(release, binding, acceptedAt) {
  validateGithubReleaseContents(release, binding);
  assertIsoUtcTimestamp(acceptedAt, "signed-release acceptance.acceptedAt");
  if (release.draft !== false || release.published_at === null) {
    fail("GitHub release must be published for explicit redeployment recovery");
  }
  assertIsoUtcTimestamp(release.published_at, "GitHub release published_at");
  const publicationTime = Date.parse(release.published_at);
  if (
    publicationTime < Date.parse(binding.githubRelease.createdAt) ||
    publicationTime < Date.parse(acceptedAt)
  ) {
    fail("GitHub release publication predates its creation or signed-release acceptance");
  }
  return release;
}

export function validateReleaseChecksums(content, binding) {
  if (
    !Buffer.isBuffer(content) &&
    !(content instanceof Uint8Array) &&
    typeof content !== "string"
  ) {
    fail("SHA256SUMS content must be bytes or text");
  }
  const text = typeof content === "string" ? content : Buffer.from(content).toString("utf8");
  if (!text.endsWith("\n") || text.includes("\r")) {
    fail("SHA256SUMS must be canonical newline-terminated text");
  }
  const entries = new Map();
  for (const line of text.slice(0, -1).split("\n")) {
    const match = /^([0-9a-f]{64})  ([A-Za-z0-9][A-Za-z0-9._-]*)$/.exec(line);
    if (!match || entries.has(match[2])) fail("SHA256SUMS contains an invalid or duplicate entry");
    entries.set(match[2], `sha256:${match[1]}`);
  }
  const expectedNames = requiredReleaseAssetNames(
    binding.tag,
    Object.keys(binding.imageDigests),
  ).filter((name) => name !== SHA256_SUMS_ASSET);
  if (!isDeepStrictEqual([...entries.keys()].sort(), expectedNames)) {
    fail("SHA256SUMS must contain every required release asset except itself and no others");
  }
  for (const asset of binding.assets) {
    if (asset.name !== SHA256_SUMS_ASSET && entries.get(asset.name) !== asset.digest) {
      fail(`SHA256SUMS digest does not match releaseBinding asset ${asset.name}`);
    }
  }
  return entries;
}

export function validateReleasePreflightEvidence(preflight, binding, evidenceCandidateBuildId) {
  validateReleaseBinding(binding);
  const repository = releaseBindingRepository(binding);
  assertExactKeys(
    preflight,
    [
      "schemaVersion",
      "tag",
      "commit",
      "tagObject",
      "evidenceCandidateCommit",
      "evidenceOnlyDescendant",
      "onOriginMain",
      "verification",
      "candidateWorkflows",
    ],
    "release preflight",
  );
  if (
    preflight.schemaVersion !== 1 ||
    preflight.tag !== binding.tag ||
    preflight.commit !== binding.buildId ||
    preflight.tagObject !== binding.tagObject ||
    preflight.evidenceCandidateCommit !== evidenceCandidateBuildId ||
    preflight.evidenceOnlyDescendant !== true ||
    preflight.onOriginMain !== true
  ) {
    fail("release preflight identity does not match the accepted release");
  }
  assertExactKeys(
    preflight.verification,
    ["verified", "reason", "verifiedAt"],
    "release preflight verification",
  );
  if (preflight.verification.verified !== true || preflight.verification.reason !== "valid") {
    fail("release preflight does not retain valid tag verification");
  }
  assertIsoUtcTimestamp(preflight.verification.verifiedAt, "release preflight verification time");
  assertExactKeys(
    preflight.candidateWorkflows,
    ["ci", "security", "productionSmoke"],
    "release preflight candidateWorkflows",
  );
  const workflows = {
    ci: ["CI", ".github/workflows/ci.yml"],
    security: ["Security", ".github/workflows/security.yml"],
    productionSmoke: ["Production-path-smoke", ".github/workflows/production-smoke.yml"],
  };
  for (const [key, [name, path]] of Object.entries(workflows)) {
    const run = preflight.candidateWorkflows[key];
    assertExactKeys(
      run,
      [
        "workflow",
        "path",
        "runId",
        "runNumber",
        "runAttempt",
        "event",
        "headBranch",
        "status",
        "conclusion",
        "url",
        "commit",
        "startedAt",
        "completedAt",
      ],
      `release preflight candidateWorkflows.${key}`,
    );
    if (
      run.workflow !== name ||
      run.path !== path ||
      run.event !== "push" ||
      run.headBranch !== "main" ||
      run.status !== "completed" ||
      run.conclusion !== "success" ||
      run.commit !== binding.buildId
    ) {
      fail(`release preflight candidateWorkflows.${key} is not a successful main push run`);
    }
    assertPositiveSafeInteger(run.runId, `release preflight candidateWorkflows.${key}.runId`);
    assertPositiveSafeInteger(
      run.runNumber,
      `release preflight candidateWorkflows.${key}.runNumber`,
    );
    assertPositiveSafeInteger(
      run.runAttempt,
      `release preflight candidateWorkflows.${key}.runAttempt`,
    );
    if (run.url !== `https://github.com/${repository}/actions/runs/${run.runId}`) {
      fail(`release preflight candidateWorkflows.${key}.url is not the trusted workflow run`);
    }
    assertIsoUtcTimestamp(run.startedAt, `release preflight candidateWorkflows.${key}.startedAt`);
    assertIsoUtcTimestamp(
      run.completedAt,
      `release preflight candidateWorkflows.${key}.completedAt`,
    );
    if (Date.parse(run.completedAt) < Date.parse(run.startedAt)) {
      fail(`release preflight candidateWorkflows.${key} completed before it started`);
    }
  }
  return preflight;
}

export function validateAcceptedReleaseLedger(ledger, expected = {}) {
  const gate = signedReleaseGate(ledger, "accepted ledger");
  if (gate.status !== "complete") fail("signed-release gate must be complete");
  if (
    !Array.isArray(gate.evidence) ||
    gate.evidence.length === 0 ||
    gate.evidence.some(
      (reference) =>
        typeof reference !== "string" ||
        (!/^https:\/\/[^\s]+$/.test(reference) && !SHA256_DIGEST_PATTERN.test(reference)) ||
        reference.includes("#replace-me"),
    )
  ) {
    fail("signed-release gate requires at least one stable HTTPS evidence reference");
  }
  if (Object.hasOwn(gate, "nextAction")) {
    fail("completed signed-release gate must not retain nextAction");
  }
  validateIndependentGateAcceptance(gate);
  const { evidenceCandidateBuildId, ...bindingExpected } = expected;
  if (
    evidenceCandidateBuildId !== undefined &&
    gate.acceptance.candidateBuildId !== evidenceCandidateBuildId
  ) {
    fail("acceptance.candidateBuildId does not match the release preflight candidate");
  }
  const binding = validateReleaseBinding(gate.releaseBinding, bindingExpected);
  if (Date.parse(gate.acceptance.startedAt) < Date.parse(binding.githubRelease.createdAt)) {
    fail("acceptance review may not start before the bound GitHub release exists");
  }
  const checksumAsset = binding.assets.find((asset) => asset.name === SHA256_SUMS_ASSET);
  if (
    gate.acceptance.manifest.url !== checksumAsset.downloadUrl ||
    gate.acceptance.manifest.sha256 !== checksumAsset.digest
  ) {
    fail("acceptance manifest must bind the exact GitHub release SHA256SUMS asset");
  }
  return binding;
}

export function validateSignedReleaseLedgerTransition(baseLedger, acceptedLedger, expected) {
  assertObject(baseLedger, "tagged ledger");
  assertObject(acceptedLedger, "accepted ledger");

  if (
    !isDeepStrictEqual(
      withoutKeys(baseLedger, ["updatedAt", "gates"]),
      withoutKeys(acceptedLedger, ["updatedAt", "gates"]),
    )
  ) {
    fail("descendant may not change ledger metadata other than updatedAt");
  }
  if (
    typeof baseLedger.updatedAt !== "string" ||
    typeof acceptedLedger.updatedAt !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(baseLedger.updatedAt) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(acceptedLedger.updatedAt) ||
    acceptedLedger.updatedAt < baseLedger.updatedAt
  ) {
    fail("descendant updatedAt must be a date on or after the tagged ledger date");
  }
  if (
    !Array.isArray(baseLedger.gates) ||
    !Array.isArray(acceptedLedger.gates) ||
    baseLedger.gates.length !== acceptedLedger.gates.length
  ) {
    fail("descendant must preserve the tagged ledger gate set");
  }

  const baseSignedRelease = signedReleaseGate(baseLedger, "tagged ledger");
  const acceptedSignedRelease = signedReleaseGate(acceptedLedger, "accepted ledger");
  if (
    baseSignedRelease.status !== "pending" ||
    !Array.isArray(baseSignedRelease.evidence) ||
    baseSignedRelease.evidence.length !== 0 ||
    Object.hasOwn(baseSignedRelease, "releaseBinding") ||
    Object.hasOwn(baseSignedRelease, "acceptance")
  ) {
    fail("tagged ledger must contain an unaccepted pending signed-release gate");
  }

  for (let index = 0; index < baseLedger.gates.length; index += 1) {
    const baseGate = baseLedger.gates[index];
    const acceptedGate = acceptedLedger.gates[index];
    if (baseGate?.id !== acceptedGate?.id) {
      fail("descendant must preserve gate identity and ordering");
    }
    if (baseGate.id !== SIGNED_RELEASE_GATE_ID && !isDeepStrictEqual(baseGate, acceptedGate)) {
      fail(`descendant may not change gate ${baseGate.id}`);
    }
  }

  if (
    !isDeepStrictEqual(
      withoutKeys(baseSignedRelease, [
        "status",
        "evidence",
        "nextAction",
        "releaseBinding",
        "acceptance",
      ]),
      withoutKeys(acceptedSignedRelease, [
        "status",
        "evidence",
        "nextAction",
        "releaseBinding",
        "acceptance",
      ]),
    )
  ) {
    fail("descendant may only accept evidence on the signed-release gate");
  }

  return validateAcceptedReleaseLedger(acceptedLedger, expected);
}
