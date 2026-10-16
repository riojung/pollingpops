import { spawn } from "node:child_process";
import { Buffer } from "node:buffer";
import { lstat, mkdtemp, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { isIP } from "node:net";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import process from "node:process";
import { URL } from "node:url";

export const ENVIRONMENTS = Object.freeze(["development", "staging", "production"]);
export const HOSTED_ENVIRONMENTS = Object.freeze(["staging", "production"]);
// Stable data namespace: renaming this disconnects existing named volumes after the rebrand.
export const DEV_COMPOSE_PROJECT = "openround";
export const DEV_COMPOSE_PROFILES = Object.freeze({
  core: Object.freeze(["compose.yaml", "compose.business.yaml", "compose.local-control.yaml"]),
  media: Object.freeze([
    "compose.yaml",
    "compose.business.yaml",
    "compose.local-control.yaml",
    "compose.media.yaml",
  ]),
  observability: Object.freeze([
    "compose.yaml",
    "compose.business.yaml",
    "compose.local-control.yaml",
    "compose.media.yaml",
    "compose.observability.yaml",
  ]),
});
export const DEV_COMPOSE_FILES = DEV_COMPOSE_PROFILES.core;
export const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/;
export const DIGEST_REFERENCE_PATTERN =
  /^(?:[a-z0-9]+(?:[._-][a-z0-9]+)*(?::[0-9]+)?\/)?(?:[a-z0-9]+(?:[._-][a-z0-9]+)*\/)*[a-z0-9]+(?:[._-][a-z0-9]+)*@sha256:[a-f0-9]{64}$/;

const ENV_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const IMAGE_REPOSITORY_PATTERN =
  /^(?:[a-z0-9]+(?:[._-][a-z0-9]+)*(?::[0-9]+)?\/)?(?:[a-z0-9]+(?:[._-][a-z0-9]+)*\/)*[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const APP_NAME_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const SHA_PATTERN = /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/;
const CONFIG_KEYS = new Set([
  "schemaVersion",
  "environment",
  "deploymentMode",
  "publicWebUrl",
  "publicApiUrl",
  "publicMediaUrl",
  "imageRepository",
  "imagePlatform",
  "billingMode",
  "fly",
  "singleVm",
  "health",
  "requireSigning",
  "requireReadinessGate",
  "readinessTarget",
  "cosignIdentityRegexp",
  "cosignOidcIssuer",
]);
const FLY_KEYS = new Set(["serverApp", "webApp", "serverConfig", "webConfig"]);
const SINGLE_VM_KEYS = new Set([
  "host",
  "port",
  "user",
  "deployPath",
  "composeFiles",
  "deploymentFiles",
  "knownHostsFile",
  "projectName",
]);
const HEALTH_KEYS = new Set(["timeoutSeconds", "intervalSeconds", "requestTimeoutSeconds"]);
const MANIFEST_KEYS = new Set([
  "schemaVersion",
  "environment",
  "buildId",
  "createdAt",
  "nextPublicApiUrl",
  "imagePlatform",
  "source",
  "images",
]);
const SOURCE_KEYS = new Set(["commit", "dirty"]);
const IMAGES_KEYS = new Set(["server", "web", "control"]);
const IMAGE_KEYS = new Set(["repository", "tag", "digest", "ref", "signed"]);
const SSH_HOST_PATTERN =
  /^(?=.{1,253}$)(?!-)(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)*[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/;
const SSH_USER_PATTERN = /^[a-z_][a-z0-9_-]{0,31}$/;
const REMOTE_PATH_PATTERN = /^\/(?:[A-Za-z0-9._-]+\/)*[A-Za-z0-9._-]+$/;
const REPOSITORY_PATH_PATTERN = /^(?:[A-Za-z0-9._-]+\/)*[A-Za-z0-9._-]+$/;
const COMPOSE_PROJECT_PATTERN = /^[a-z0-9][a-z0-9_-]{0,62}$/;
const HOSTED_IMAGE_PLATFORMS = new Set(["linux/amd64", "linux/arm64"]);
const RESERVED_HOSTED_TARGET_SUFFIXES = Object.freeze([
  "example",
  "invalid",
  "internal",
  "local",
  "localhost",
  "test",
  "example.com",
  "example.net",
  "example.org",
]);
const PLACEHOLDER_HOST_LABELS = new Set([
  "changeme",
  "example",
  "placeholder",
  "replace",
  "replace-me",
  "replace-this",
]);
const SINGLE_VM_RUNTIME_ENV_KEYS = new Set([
  "NODE_ENV",
  "OPENROUND_DEPLOYMENT_ENVIRONMENT",
  "HOST",
  "PORT",
  "WEB_ORIGIN",
  "PUBLIC_API_URL",
  "COOKIE_NAME",
  "COOKIE_DOMAIN",
  "COOKIE_SECURE",
  "ALLOW_INSECURE_LOCAL_HTTP",
  "DATABASE_URL",
  "REDIS_URL",
  "SESSION_MUTATION_LEASE_TTL_MS",
  "SESSION_MUTATION_LEASE_WAIT_MS",
  "RUN_MIGRATIONS",
  "ALLOW_IN_MEMORY",
  "COMMUNITY_MODE",
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
  "MAX_SESSION_PARTICIPANTS",
  "MAX_PRACTICE_PERSONAL_LINKS",
  "RETENTION_INTERVAL_MINUTES",
  "REPORT_WORKER_INTERVAL_MS",
  "REPORT_WORKER_LEASE_MS",
  "AUTHORING_AI_MODE",
  "AUTHORING_AI_ENDPOINT",
  "AUTHORING_AI_API_KEY",
  "AUTHORING_AI_MODEL",
  "AUTHORING_AI_PROVIDER_NAME",
  "AUTHORING_WORKER_INTERVAL_MS",
  "AUTHORING_WORKER_LEASE_MS",
  "AUTHORING_EXTRACTION_TIMEOUT_MS",
  "OIDC_MODE",
  "OIDC_ISSUER",
  "OIDC_CLIENT_ID",
  "OIDC_CLIENT_SECRET",
  "OIDC_CLIENT_AUTH",
  "OIDC_PROVIDER_NAME",
  "OIDC_TRANSACTION_TTL_SECONDS",
  "LTI_MODE",
  "LTI_TOOL_PRIVATE_JWK",
  "LTI_TOOL_KEY_ID",
  "LTI_TRANSACTION_TTL_SECONDS",
  "LTI_LAUNCH_TTL_SECONDS",
  "AUDIT_RETENTION_DAYS",
  "COMMUNITY_REPORT_RETENTION_DAYS",
  "MEDIA_QUARANTINE_RETENTION_HOURS",
  "FEATURE_SIGNUPS",
  "FEATURE_SESSION_CREATION",
  "FEATURE_MEDIA_UPLOADS",
  "FEATURE_ROUND_EXPERIENCES",
  "FEATURE_AUDIENCE_PULSE",
  "FEATURE_ROOM_CHAT",
  "FEATURE_UX_BETA",
  "FEATURE_RECOVERY_REHEARSAL",
  "FEATURE_PRACTICE_ASSIGNMENTS",
  "FEATURE_WORKSPACE_SHELL",
  "FEATURE_BUILDER_V2",
  "FEATURE_PRESENTATIONS",
  "FEATURE_GROUPS",
  "FEATURE_DISCOVER",
  "FEATURE_PRESENTATION_REALTIME",
  "FEATURE_PRESENTATION_COMPANION",
  "FEATURE_LIVE_FLEX_MODE",
  "FEATURE_RECOVERY_PACKS",
  "FEATURE_RECOVERY_PACK_LIVE_CARDS",
  "FEATURE_QUESTION_HEALTH",
  "FEATURE_DECISION_REPLAY",
  "FEATURE_RECOVERY_TRAILS",
  "FEATURE_CONCEPT_HEALTH",
  "FEATURE_EXTENDED_QUESTION_TYPES",
  "FEATURE_VERIFIED_INSTITUTION",
  "FEATURE_AUDIENCE_SCOPES",
  "FEATURE_ROUND_CLIENT_PROTOCOL",
  "FEATURE_FEEDBACK_ROOMS",
  "FEATURE_SURVEYS",
  "FEATURE_FEEDBACK_EXPORTS",
  "FEATURE_SESSION_SUMMARIES",
  "CORE_PARITY_WORKSPACE_ALLOWLIST",
  "THEMED_INTERACTIONS_WORKSPACE_ALLOWLIST",
  "UX_BETA_WORKSPACE_ALLOWLIST",
  "EVIDENCE_FEATURES_WORKSPACE_ALLOWLIST",
  "METRICS_ENABLED",
  "METRICS_TOKEN",
  "OPENROUND_LOG_SHIPPING_MODE",
  "TRACING_ENABLED",
  "OTEL_EXPORTER_OTLP_TRACES_ENDPOINT",
  "OTEL_SERVICE_NAME",
  "OTEL_SERVICE_VERSION",
  "OPENROUND_OTLP_BACKEND_ENDPOINT",
  "OPENROUND_OTLP_BACKEND_TOKEN",
  "OPENROUND_PAGING_WEBHOOK_URL",
  "OPENROUND_WARNING_WEBHOOK_URL",
  "OPENROUND_TICKET_WEBHOOK_URL",
  "SMTP_URL",
  "EMAIL_FROM",
  "DEVELOPMENT_EMAIL_INBOX_URL",
  "AUTH_DEBUG_MAGIC_LINKS",
  "POLICY_VERSION",
  "BILLING_MODE",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "STRIPE_PRO_PRICE_ID",
  "S3_ENDPOINT",
  "S3_PUBLIC_ENDPOINT",
  "S3_REGION",
  "S3_BUCKET",
  "S3_ACCESS_KEY_ID",
  "S3_SECRET_ACCESS_KEY",
  "S3_FORCE_PATH_STYLE",
  "MEDIA_SCAN_MODE",
  "CLAMAV_HOST",
  "CLAMAV_PORT",
  "CLAMAV_TIMEOUT_MS",
  "ADMIN_TOKEN",
  "LOG_LEVEL",
  "OPENROUND_APP_DOMAIN",
  "OPENROUND_MEDIA_DOMAIN",
  "OPENROUND_ACME_EMAIL",
  "OPENROUND_SERVER_INGRESS_SUBNET",
  "OPENROUND_CADDY_PROXY_IP",
  "POSTGRES_DB",
  "POSTGRES_OWNER_USER",
  "POSTGRES_OWNER_PASSWORD",
  "POSTGRES_APP_USER",
  "POSTGRES_APP_PASSWORD",
  "VALKEY_PASSWORD",
  "MINIO_ROOT_USER",
  "MINIO_ROOT_PASSWORD",
  "MINIO_APP_ACCESS_KEY",
  "MINIO_APP_SECRET_KEY",
  "MINIO_BUCKET",
  "OPENROUND_LOG_MAX_SIZE",
  "OPENROUND_LOG_MAX_FILES",
  "OPENROUND_POSTGRES_SHM_SIZE",
  "OPENROUND_POSTGRES_CPUS",
  "OPENROUND_POSTGRES_MEMORY_LIMIT",
  "OPENROUND_POSTGRES_PIDS_LIMIT",
  "VALKEY_AUTO_AOF_REWRITE_PERCENTAGE",
  "VALKEY_MAXMEMORY",
  "OPENROUND_VALKEY_CPUS",
  "OPENROUND_VALKEY_MEMORY_LIMIT",
  "OPENROUND_VALKEY_PIDS_LIMIT",
  "OPENROUND_MINIO_CPUS",
  "OPENROUND_MINIO_MEMORY_LIMIT",
  "OPENROUND_MINIO_PIDS_LIMIT",
  "OPENROUND_INIT_CPUS",
  "OPENROUND_INIT_MEMORY_LIMIT",
  "OPENROUND_CLAMAV_CPUS",
  "OPENROUND_CLAMAV_MEMORY_LIMIT",
  "OPENROUND_CLAMAV_PIDS_LIMIT",
  "OPENROUND_MIGRATE_CPUS",
  "OPENROUND_MIGRATE_MEMORY_LIMIT",
  "OPENROUND_SERVER_CPUS",
  "OPENROUND_SERVER_MEMORY_LIMIT",
  "OPENROUND_SERVER_PIDS_LIMIT",
  "OPENROUND_JOBS_CPUS",
  "OPENROUND_JOBS_MEMORY_LIMIT",
  "OPENROUND_CONTROL_CPUS",
  "OPENROUND_CONTROL_MEMORY_LIMIT",
  "OPENROUND_WEB_CPUS",
  "OPENROUND_WEB_MEMORY_LIMIT",
  "OPENROUND_WEB_PIDS_LIMIT",
  "OPENROUND_CADDY_CPUS",
  "OPENROUND_CADDY_MEMORY_LIMIT",
  "OPENROUND_CADDY_PIDS_LIMIT",
  "OPENROUND_OTEL_HEALTH_PORT",
  "OPENROUND_OTEL_CPUS",
  "OPENROUND_OTEL_MEMORY_LIMIT",
  "OPENROUND_OTEL_PIDS_LIMIT",
  "OPENROUND_PROMETHEUS_PORT",
  "OPENROUND_PROMETHEUS_RETENTION",
  "OPENROUND_PROMETHEUS_CPUS",
  "OPENROUND_PROMETHEUS_MEMORY_LIMIT",
  "OPENROUND_PROMETHEUS_PIDS_LIMIT",
  "OPENROUND_ALERTMANAGER_PORT",
  "OPENROUND_ALERTMANAGER_CPUS",
  "OPENROUND_ALERTMANAGER_MEMORY_LIMIT",
  "OPENROUND_ALERTMANAGER_PIDS_LIMIT",
]);

export function normalizeEnvironment(value) {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();
  if (normalized === "dev") return "development";
  if (ENVIRONMENTS.includes(normalized)) return normalized;
  throw new Error(
    `Unsupported environment ${JSON.stringify(value)}; expected development, staging, or production`,
  );
}

export function isHostedEnvironment(environment) {
  return HOSTED_ENVIRONMENTS.includes(normalizeEnvironment(environment));
}

export function assertFullGitSha(value, label = "build ID") {
  if (!SHA_PATTERN.test(String(value ?? ""))) {
    throw new Error(`${label} must be a full 40- or 64-character lowercase Git SHA`);
  }
  return value;
}

export function isDigestReference(value) {
  return DIGEST_REFERENCE_PATTERN.test(String(value ?? ""));
}

export function assertDigestReference(value, label = "image reference") {
  if (!isDigestReference(value)) {
    throw new Error(`${label} must be an immutable repository@sha256 digest reference`);
  }
  return value;
}

export function assertPathWithin(path, parent, label = "path") {
  const absolutePath = resolve(path);
  const absoluteParent = resolve(parent);
  const child = relative(absoluteParent, absolutePath);
  if (!child || child === ".." || child.startsWith(`..${sep}`)) {
    throw new Error(`${label} must be inside ${absoluteParent}`);
  }
  return absolutePath;
}

export function expectedRollbackConfirmation(environment, targetBuildId, sourceBuildId) {
  const normalized = normalizeEnvironment(environment);
  assertFullGitSha(targetBuildId, "rollback target build ID");
  assertFullGitSha(sourceBuildId, "rollback source build ID");
  if (targetBuildId === sourceBuildId) {
    throw new Error("Rollback target and source build IDs must differ");
  }
  return `rollback:${normalized}:${targetBuildId}:from:${sourceBuildId}`;
}

export function validateRollbackConfirmation(value, environment, targetBuildId, sourceBuildId) {
  const expected = expectedRollbackConfirmation(environment, targetBuildId, sourceBuildId);
  if (value !== expected) throw new Error(`Rollback confirmation must exactly match ${expected}`);
  return true;
}

export function parseCliArguments(argv, { valueOptions = [], booleanOptions = [] } = {}) {
  const values = new Map();
  const flags = new Set();
  const positionals = [];
  const valueNames = new Set(valueOptions);
  const booleanNames = new Set(booleanOptions);

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--") {
      positionals.push(...argv.slice(index + 1));
      break;
    }
    if (!argument.startsWith("--")) {
      positionals.push(argument);
      continue;
    }
    const equalsAt = argument.indexOf("=");
    const name = equalsAt === -1 ? argument.slice(2) : argument.slice(2, equalsAt);
    if (booleanNames.has(name)) {
      if (equalsAt !== -1) throw new Error(`--${name} does not accept a value`);
      flags.add(name);
      continue;
    }
    if (!valueNames.has(name)) throw new Error(`Unknown option --${name}`);
    const value = equalsAt === -1 ? argv[++index] : argument.slice(equalsAt + 1);
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`--${name} requires a value`);
    }
    if (values.has(name)) throw new Error(`--${name} may be provided only once`);
    values.set(name, value);
  }
  return { values, flags, positionals };
}

export function resolveEnvironmentArgument(parsed, { allowMissing = false } = {}) {
  const explicit = parsed.values.get("environment");
  const positional = parsed.positionals[0];
  if (
    explicit &&
    positional &&
    normalizeEnvironment(explicit) !== normalizeEnvironment(positional)
  ) {
    throw new Error("The positional environment conflicts with --environment");
  }
  const selected = explicit ?? positional;
  if (!selected && allowMissing) return undefined;
  if (!selected) throw new Error("An environment is required");
  return normalizeEnvironment(selected);
}

export function composeArgv(action, { follow = false, noBuild = false, profile = "core" } = {}) {
  const files = DEV_COMPOSE_PROFILES[profile];
  if (!files) throw new Error(`Unsupported Compose profile ${JSON.stringify(profile)}`);
  const prefix = ["compose", "--project-name", DEV_COMPOSE_PROJECT];
  for (const file of files) prefix.push("--file", file);
  if (profile === "observability") prefix.push("--profile", "observability");
  switch (action) {
    case "start":
      return [...prefix, "up", "--detach", ...(noBuild ? ["--no-build"] : ["--build"]), "--wait"];
    case "stop":
      return [...prefix, "stop"];
    case "restart":
      return [
        ...prefix,
        "up",
        "--detach",
        "--force-recreate",
        ...(noBuild ? ["--no-build"] : ["--build"]),
        "--wait",
      ];
    case "status":
      return [...prefix, "ps"];
    case "logs":
      return [...prefix, "logs", ...(follow ? ["--follow"] : []), "--tail", "200"];
    default:
      throw new Error(`Unsupported service action ${JSON.stringify(action)}`);
  }
}

export function dockerContextArgv(context) {
  if (context === undefined) return [];
  // Docker's context-name syntax permits "+" and has no name-length cap.
  // The built-in "default" context is selectable even though its name is reserved for creation.
  if (
    typeof context !== "string" ||
    context.match(/^[A-Za-z0-9][A-Za-z0-9_.+-]+$/)?.[0] !== context
  ) {
    throw new Error("--docker-context must be a Docker context name from docker context ls");
  }
  return ["--context", context];
}

export async function assertDockerReady({
  cwd,
  dryRun = false,
  dockerContext,
  platform = process.platform,
  runCommand = run,
} = {}) {
  const prefix = dockerContextArgv(dockerContext);
  if (dryRun) return;
  try {
    await runCommand("docker", ["--version"], { cwd, capture: true, timeoutMs: 10_000 });
  } catch (error) {
    throw new Error(
      "Polling Pops requires the Docker CLI. Install Docker Desktop or Docker Engine with Compose v2, then retry. No services were changed.",
      { cause: error },
    );
  }
  try {
    await runCommand("docker", [...prefix, "compose", "version"], {
      cwd,
      capture: true,
      timeoutMs: 10_000,
    });
  } catch (error) {
    throw new Error(
      "Polling Pops requires Docker Compose v2. Install or enable the Docker Compose plugin, then retry. No services were changed.",
      { cause: error },
    );
  }
  try {
    await runCommand("docker", [...prefix, "info", "--format", "{{.ServerVersion}}"], {
      cwd,
      capture: true,
      timeoutMs: 10_000,
    });
  } catch (error) {
    const infoCommand = ["docker", ...prefix, "info"].join(" ");
    throw new Error(
      [
        "Polling Pops cannot reach the Docker daemon using the selected Docker configuration.",
        "Source: local Docker runtime preflight, before building or changing services; this is not an application image or branding error.",
        "Run docker context ls to check the endpoint and inspect DOCKER_HOST / DOCKER_CONTEXT for stale overrides.",
        platform === "darwin"
          ? "Start your chosen runtime: open -a Docker for Docker Desktop, or colima start --profile YOUR_EXISTING_PROFILE for Colima."
          : "Start your Docker Engine service and check that your user has permission to access its socket.",
        ...(platform === "darwin"
          ? [
              "For post-reboot Colima startup, use pnpm local:start with your existing profile/context (see pnpm local:start --help).",
            ]
          : []),
        `Verify ${infoCommand} succeeds, then retry. Select an existing context with --docker-context NAME or DOCKER_CONTEXT=NAME.`,
        "No services, volumes, or Docker contexts were changed. Do not delete volumes or switch to a new runtime to repair a missing socket.",
      ].join("\n"),
      { cause: error },
    );
  }
}

export const buildComposeArgv = composeArgv;

export function composeBuildArgv(profile = "core") {
  const files = DEV_COMPOSE_PROFILES[profile];
  if (!files) throw new Error(`Unsupported Compose profile ${JSON.stringify(profile)}`);
  const args = ["compose", "--project-name", DEV_COMPOSE_PROJECT];
  for (const file of files) args.push("--file", file);
  if (profile === "observability") args.push("--profile", "observability");
  return [...args, "build", "server", "web", "control"];
}

function assertExactKeys(object, allowed, label) {
  if (!object || typeof object !== "object" || Array.isArray(object)) {
    throw new Error(`${label} must be an object`);
  }
  for (const key of Object.keys(object)) {
    if (!allowed.has(key)) throw new Error(`${label} contains unsupported key ${key}`);
  }
}

function assertHttpsUrl(value, label) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${label} must be a valid URL`);
  }
  if (url.protocol !== "https:" || url.username || url.password || url.hash) {
    throw new Error(`${label} must be a credential-free HTTPS URL without a fragment`);
  }
  return url.toString();
}

function assertHttpsOrigin(value, label) {
  const url = new URL(assertHttpsUrl(value, label));
  if (url.pathname !== "/" || url.search) {
    throw new Error(`${label} must be a credential-free HTTPS URL origin without a path or query`);
  }
  return url.origin;
}

function assertRepositoryRelativePath(value, label) {
  if (
    typeof value !== "string" ||
    !value ||
    isAbsolute(value) ||
    !REPOSITORY_PATH_PATTERN.test(value) ||
    value.split("/").some((segment) => segment === "." || segment === "..")
  ) {
    throw new Error(`${label} must be a safe repository-relative path without parent traversal`);
  }
  return value;
}

function assertRepositoryRelativePaths(value, label, { allowEmpty = false } = {}) {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) {
    throw new Error(`${label} must be ${allowEmpty ? "an" : "a non-empty"} array`);
  }
  const seen = new Set();
  for (const [index, path] of value.entries()) {
    assertRepositoryRelativePath(path, `${label}[${index}]`);
    if (seen.has(path)) throw new Error(`${label} must not contain duplicate paths`);
    seen.add(path);
  }
  return value;
}

export function validateSingleVmConfig(input) {
  assertExactKeys(input, SINGLE_VM_KEYS, "deployment config singleVm");
  if (!SSH_HOST_PATTERN.test(String(input.host ?? "")) || input.host.includes("..")) {
    throw new Error("deployment config singleVm.host must be a DNS name or IPv4 address");
  }
  if (!Number.isInteger(input.port) || input.port < 1 || input.port > 65535) {
    throw new Error("deployment config singleVm.port must be an integer from 1 through 65535");
  }
  if (!SSH_USER_PATTERN.test(String(input.user ?? ""))) {
    throw new Error("deployment config singleVm.user is invalid");
  }
  if (
    !REMOTE_PATH_PATTERN.test(String(input.deployPath ?? "")) ||
    input.deployPath === "/" ||
    input.deployPath.split("/").includes("..")
  ) {
    throw new Error("deployment config singleVm.deployPath must be a safe absolute path");
  }
  assertRepositoryRelativePaths(input.composeFiles, "deployment config singleVm.composeFiles");
  assertRepositoryRelativePaths(
    input.deploymentFiles,
    "deployment config singleVm.deploymentFiles",
    { allowEmpty: true },
  );
  const overlap = input.composeFiles.filter((path) => input.deploymentFiles.includes(path));
  if (overlap.length > 0) {
    throw new Error("deployment config singleVm files must not overlap");
  }
  assertRepositoryRelativePath(input.knownHostsFile, "deployment config singleVm.knownHostsFile");
  if (!COMPOSE_PROJECT_PATTERN.test(String(input.projectName ?? ""))) {
    throw new Error("deployment config singleVm.projectName is invalid");
  }
  return input;
}

export function validateDeployConfig(input, expectedEnvironment) {
  assertExactKeys(input, CONFIG_KEYS, "deployment config");
  if (input.schemaVersion !== 1) throw new Error("deployment config schemaVersion must be 1");
  const environment = normalizeEnvironment(input.environment);
  if (expectedEnvironment && environment !== normalizeEnvironment(expectedEnvironment)) {
    throw new Error(`deployment config environment ${environment} does not match target`);
  }
  if (!IMAGE_REPOSITORY_PATTERN.test(String(input.imageRepository ?? ""))) {
    throw new Error("deployment config imageRepository is invalid");
  }
  if (environment === "development") {
    if (input.deploymentMode !== "compose") {
      throw new Error("development deploymentMode must be compose");
    }
    for (const key of ["publicWebUrl", "publicApiUrl"]) {
      const url = new URL(input[key]);
      if (!["http:", "https:"].includes(url.protocol)) throw new Error(`${key} must use HTTP(S)`);
    }
    if (input.fly !== undefined) throw new Error("development config must not define fly settings");
    if (input.singleVm !== undefined) {
      throw new Error("development config must not define hosted singleVm settings");
    }
    if (input.publicMediaUrl !== undefined) {
      throw new Error("development config must not define publicMediaUrl");
    }
  } else {
    if (!new Set(["fly", "single-vm"]).has(input.deploymentMode)) {
      throw new Error("hosted deploymentMode must be fly or single-vm");
    }
    if (!HOSTED_IMAGE_PLATFORMS.has(input.imagePlatform)) {
      throw new Error("hosted deployment imagePlatform must be linux/amd64 or linux/arm64");
    }
    input.publicWebUrl = assertHttpsOrigin(input.publicWebUrl, "publicWebUrl");
    input.publicApiUrl = assertHttpsOrigin(input.publicApiUrl, "publicApiUrl");
    if (!new Set(["disabled", "stripe"]).has(input.billingMode)) {
      throw new Error("hosted deployment billingMode must be disabled or stripe");
    }
    if (input.deploymentMode === "fly") {
      if (input.singleVm !== undefined) {
        throw new Error("Fly deployment config must not define singleVm settings");
      }
      if (input.publicMediaUrl !== undefined) {
        throw new Error("Fly deployment config must not define single-VM publicMediaUrl");
      }
      if (input.imagePlatform !== "linux/amd64") {
        throw new Error("Fly deployment imagePlatform must be linux/amd64");
      }
      assertExactKeys(input.fly, FLY_KEYS, "deployment config fly");
      for (const key of ["serverApp", "webApp"]) {
        if (!APP_NAME_PATTERN.test(String(input.fly[key] ?? ""))) {
          throw new Error(`deployment config fly.${key} is invalid`);
        }
      }
      if (input.fly.serverApp === input.fly.webApp) {
        throw new Error("deployment config Fly server and web apps must differ");
      }
      if (input.publicWebUrl === input.publicApiUrl) {
        throw new Error("deployment config Fly web and API origins must differ");
      }
      for (const key of ["serverConfig", "webConfig"]) {
        assertRepositoryRelativePath(input.fly[key], `deployment config fly.${key}`);
      }
    } else {
      if (input.fly !== undefined) {
        throw new Error("single-vm deployment config must not define fly settings");
      }
      validateSingleVmConfig(input.singleVm);
      if (input.singleVm.composeFiles.includes("compose.local-control.yaml")) {
        throw new Error("hosted deployment must not use the local development control overlay");
      }
      input.publicMediaUrl = assertHttpsOrigin(input.publicMediaUrl, "publicMediaUrl");
      if (input.publicWebUrl !== input.publicApiUrl) {
        throw new Error("single-vm deployment must use one public web and API origin");
      }
      if (input.publicMediaUrl === input.publicWebUrl) {
        throw new Error("single-vm media and application origins must differ");
      }
    }
  }
  assertExactKeys(input.health, HEALTH_KEYS, "deployment config health");
  for (const key of HEALTH_KEYS) {
    if (!Number.isInteger(input.health[key]) || input.health[key] <= 0) {
      throw new Error(`deployment config health.${key} must be a positive integer`);
    }
  }
  if (input.health.intervalSeconds > input.health.timeoutSeconds) {
    throw new Error("health intervalSeconds must not exceed timeoutSeconds");
  }
  if (
    typeof input.requireSigning !== "boolean" ||
    typeof input.requireReadinessGate !== "boolean"
  ) {
    throw new Error("deployment signing and readiness requirements must be booleans");
  }
  if (environment === "production") {
    if (!input.requireSigning) throw new Error("production must require image signing");
    if (!input.requireReadinessGate) throw new Error("production must require a readiness gate");
  }
  if (input.requireReadinessGate && !/^[a-z0-9-]+$/.test(String(input.readinessTarget ?? ""))) {
    throw new Error("readinessTarget is required when the readiness gate is enabled");
  }
  if (input.requireSigning) {
    if (typeof input.cosignIdentityRegexp !== "string" || !input.cosignIdentityRegexp) {
      throw new Error("cosignIdentityRegexp is required when signing is enabled");
    }
    if (!input.cosignIdentityRegexp.startsWith("^") || !input.cosignIdentityRegexp.endsWith("$")) {
      throw new Error("cosignIdentityRegexp must be anchored at both ends");
    }
    if (input.cosignIdentityRegexp.includes("(?:")) {
      throw new Error(
        "cosignIdentityRegexp must use Cosign-compatible RE2 syntax; non-capturing groups are unsupported",
      );
    }
    try {
      new RegExp(input.cosignIdentityRegexp);
    } catch {
      throw new Error("cosignIdentityRegexp must be a valid regular expression");
    }
    assertHttpsUrl(input.cosignOidcIssuer, "cosignOidcIssuer");
  }
  return input;
}

function mappedIpv4Octets(hostname) {
  const dotted = hostname.match(/^::ffff:(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (dotted) {
    const octets = dotted.slice(1).map(Number);
    return octets.every((octet) => octet <= 255) ? octets : undefined;
  }
  const match = hostname.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (!match) return undefined;
  const high = Number.parseInt(match[1], 16);
  const low = Number.parseInt(match[2], 16);
  return [high >> 8, high & 0xff, low >> 8, low & 0xff];
}

function isReservedHostedIpv4([first, second, third]) {
  return (
    first === 0 ||
    first === 127 ||
    (first === 192 && second === 0 && third === 2) ||
    (first === 198 && second === 51 && third === 100) ||
    (first === 203 && second === 0 && third === 113)
  );
}

export function isPlaceholderHostedHostname(hostname) {
  const rawHostname = String(hostname ?? "").toLowerCase();
  if (rawHostname.endsWith(".")) return true;
  const normalized = rawHostname.replace(/^\[|\]$/g, "");
  const addressKind = isIP(normalized);
  if (addressKind === 4 && isReservedHostedIpv4(normalized.split(".").map(Number))) return true;
  if (addressKind === 6) {
    if (normalized === "::" || normalized === "::1" || normalized.startsWith("2001:db8:")) {
      return true;
    }
    const mapped = mappedIpv4Octets(normalized);
    if (mapped && isReservedHostedIpv4(mapped)) return true;
  }
  if (
    addressKind === 0 &&
    /^(?:0x[0-9a-f]+|[0-9]+)(?:\.(?:0x[0-9a-f]+|[0-9]+))*$/.test(normalized)
  ) {
    return true;
  }
  if (
    RESERVED_HOSTED_TARGET_SUFFIXES.some(
      (suffix) => normalized === suffix || normalized.endsWith(`.${suffix}`),
    )
  ) {
    return true;
  }
  return normalized
    .split(".")
    .some(
      (label) =>
        PLACEHOLDER_HOST_LABELS.has(label) ||
        label.startsWith("replace-") ||
        label.startsWith("placeholder-"),
    );
}

export function assertConfiguredHostedTarget(config) {
  if (!isHostedEnvironment(config?.environment)) {
    throw new Error("Hosted target validation requires staging or production configuration");
  }
  for (const key of ["publicWebUrl", "publicApiUrl", "publicMediaUrl"]) {
    if (config[key] === undefined) continue;
    const hostname = new URL(config[key]).hostname;
    if (isPlaceholderHostedHostname(hostname)) {
      throw new Error(
        `deployment config ${key} must not use a reserved example, placeholder, loopback, or unspecified hostname`,
      );
    }
  }
  if (config.singleVm && isPlaceholderHostedHostname(String(config.singleVm.host ?? ""))) {
    throw new Error(
      "deployment config singleVm.host must not use a reserved example, placeholder, loopback, or unspecified hostname",
    );
  }
  return config;
}

export function parseFlyTomlEnvironment(content) {
  const environment = {};
  let inEnvironment = false;
  for (const [index, sourceLine] of String(content).split(/\r?\n/).entries()) {
    const line = sourceLine.trim();
    if (!line || line.startsWith("#")) continue;
    if (line.startsWith("[")) {
      inEnvironment = line === "[env]";
      continue;
    }
    if (!inEnvironment) continue;
    const match = line.match(/^([A-Z][A-Z0-9_]*)\s*=\s*("(?:[^"\\]|\\.)*")\s*$/);
    if (!match) throw new Error(`Fly [env] line ${index + 1} must use KEY = "value" syntax`);
    const [, key, encodedValue] = match;
    if (Object.hasOwn(environment, key)) throw new Error(`Fly [env] contains duplicate key ${key}`);
    const value = JSON.parse(encodedValue);
    if (typeof value !== "string") throw new Error(`Fly [env] ${key} must be a string`);
    environment[key] = value;
  }
  if (Object.keys(environment).length === 0) throw new Error("Fly config must define [env]");
  return environment;
}

export function validateFlyRuntimeEnvironment(environment, config) {
  const expected = {
    NODE_ENV: "production",
    OPENROUND_DEPLOYMENT_ENVIRONMENT: config.environment,
    HOST: "0.0.0.0",
    PORT: "4000",
    WEB_ORIGIN: config.publicWebUrl,
    PUBLIC_API_URL: config.publicApiUrl,
    COOKIE_SECURE: "true",
    RUN_MIGRATIONS: "false",
    ALLOW_IN_MEMORY: "false",
    COMMUNITY_MODE: "false",
    MAX_PRACTICE_PERSONAL_LINKS: "100",
    BILLING_MODE: config.billingMode,
    METRICS_ENABLED: "false",
    S3_REGION: "ca-central-1",
    SESSION_MUTATION_LEASE_TTL_MS: "15000",
    SESSION_MUTATION_LEASE_WAIT_MS: "5000",
    OPENROUND_MIGRATIONS_DIR: "/app/migrations",
  };
  const disabledFeatureKeys = [
    "FEATURE_SIGNUPS",
    "FEATURE_ROUND_EXPERIENCES",
    "FEATURE_AUDIENCE_PULSE",
    "FEATURE_ROOM_CHAT",
    "FEATURE_UX_BETA",
    "FEATURE_RECOVERY_REHEARSAL",
    "FEATURE_PRACTICE_ASSIGNMENTS",
    "FEATURE_WORKSPACE_SHELL",
    "FEATURE_BUILDER_V2",
    "FEATURE_PRESENTATIONS",
    "FEATURE_GROUPS",
    "FEATURE_DISCOVER",
    "FEATURE_PRESENTATION_REALTIME",
    "FEATURE_PRESENTATION_COMPANION",
    "FEATURE_LIVE_FLEX_MODE",
    "FEATURE_RECOVERY_PACKS",
    "FEATURE_RECOVERY_PACK_LIVE_CARDS",
    "FEATURE_QUESTION_HEALTH",
    "FEATURE_DECISION_REPLAY",
    "FEATURE_RECOVERY_TRAILS",
    "FEATURE_CONCEPT_HEALTH",
    "FEATURE_EXTENDED_QUESTION_TYPES",
    "FEATURE_VERIFIED_INSTITUTION",
  ];
  const allowed = new Set([
    ...Object.keys(expected),
    ...disabledFeatureKeys,
    "FEATURE_SESSION_CREATION",
    "FEATURE_MEDIA_UPLOADS",
  ]);
  for (const key of Object.keys(environment)) {
    if (!allowed.has(key)) throw new Error(`Fly [env] contains unsupported key ${key}`);
  }
  for (const [key, value] of Object.entries(expected)) {
    if (environment[key] !== value) throw new Error(`Fly [env] ${key} must be ${value}`);
  }
  for (const key of disabledFeatureKeys) {
    if (environment[key] !== "false") throw new Error(`Fly [env] ${key} must be false`);
  }
  for (const key of ["FEATURE_SESSION_CREATION", "FEATURE_MEDIA_UPLOADS"]) {
    if (environment[key] !== undefined && environment[key] !== "true") {
      throw new Error(`Fly [env] ${key} must remain enabled when explicitly configured`);
    }
  }
  return environment;
}

export function validateFlyWebEnvironment(environment, config) {
  const expected = {
    NODE_ENV: "production",
    NEXT_PUBLIC_API_URL: config.publicApiUrl,
  };
  for (const key of Object.keys(environment)) {
    if (!Object.hasOwn(expected, key) && key !== "OPENROUND_PUBLIC_URL") {
      throw new Error(`Fly web [env] contains unsupported key ${key}`);
    }
  }
  if (
    environment.OPENROUND_PUBLIC_URL !== undefined &&
    environment.OPENROUND_PUBLIC_URL !== config.publicWebUrl
  ) {
    throw new Error(`Fly web [env] OPENROUND_PUBLIC_URL must be ${config.publicWebUrl}`);
  }
  for (const [key, value] of Object.entries(expected)) {
    if (environment[key] !== value) throw new Error(`Fly web [env] ${key} must be ${value}`);
  }
  return environment;
}

export function validateBuildManifest(input, expected = {}) {
  assertExactKeys(input, MANIFEST_KEYS, "build manifest");
  if (input.schemaVersion !== 1) throw new Error("build manifest schemaVersion must be 1");
  const environment = normalizeEnvironment(input.environment);
  if (expected.environment && environment !== normalizeEnvironment(expected.environment)) {
    throw new Error(`build manifest environment ${environment} does not match target`);
  }
  assertFullGitSha(input.buildId);
  if (expected.buildId && input.buildId !== expected.buildId) {
    throw new Error("build manifest buildId does not match the requested build");
  }
  if (Number.isNaN(Date.parse(input.createdAt)))
    throw new Error("build manifest createdAt is invalid");
  if (!HOSTED_IMAGE_PLATFORMS.has(input.imagePlatform)) {
    throw new Error("build manifest imagePlatform must be linux/amd64 or linux/arm64");
  }
  if (expected.imagePlatform && input.imagePlatform !== expected.imagePlatform) {
    throw new Error("build manifest imagePlatform does not match the target config");
  }
  assertExactKeys(input.source, SOURCE_KEYS, "build manifest source");
  if (input.source.commit !== input.buildId)
    throw new Error("source commit and buildId must match");
  if (input.source.dirty !== false)
    throw new Error("hosted build manifest must record a clean source");
  assertExactKeys(input.images, IMAGES_KEYS, "build manifest images");
  if (expected.requireControl && !input.images.control) {
    throw new Error("Business deployments require a signed control image in the build manifest");
  }
  for (const component of ["server", "web", ...(input.images.control ? ["control"] : [])]) {
    const image = input.images[component];
    assertExactKeys(image, IMAGE_KEYS, `build manifest images.${component}`);
    if (!IMAGE_REPOSITORY_PATTERN.test(String(image.repository ?? ""))) {
      throw new Error(`images.${component}.repository is invalid`);
    }
    if (
      image.repository !==
      `${expected.imageRepository ?? image.repository.replace(/-(server|web|control)$/, "")}-${component}`
    ) {
      throw new Error(`images.${component}.repository does not match the target repository`);
    }
    if (!DIGEST_PATTERN.test(String(image.digest ?? ""))) {
      throw new Error(`images.${component}.digest must be sha256`);
    }
    if (image.ref !== `${image.repository}@${image.digest}`) {
      throw new Error(`images.${component}.ref must exactly match repository and digest`);
    }
    assertDigestReference(image.ref, `images.${component}.ref`);
    const expectedTag = `${image.repository}:${environment}-${input.buildId}`;
    if (image.tag !== expectedTag) {
      throw new Error(`images.${component}.tag must be ${expectedTag}`);
    }
    if (typeof image.signed !== "boolean")
      throw new Error(`images.${component}.signed must be boolean`);
    if (expected.requireSigning && image.signed !== true) {
      throw new Error(`images.${component} must be signed for this target`);
    }
  }
  if (expected.publicApiUrl && input.nextPublicApiUrl !== expected.publicApiUrl) {
    throw new Error("build manifest NEXT_PUBLIC_API_URL does not match the target config");
  }
  return input;
}

export function extractBuildxDigest(metadata) {
  const digest = metadata?.["containerimage.digest"] ?? metadata?.containerimage?.digest;
  if (!DIGEST_PATTERN.test(String(digest ?? ""))) {
    throw new Error("Docker Buildx metadata did not contain a valid container image digest");
  }
  return digest;
}

export function parseEnvFileKeys(content, label = "environment file") {
  const keys = [];
  const seen = new Set();
  const lines = String(content)
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const trimmed = lines[index].trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    if (trimmed.startsWith("export ")) {
      throw new Error(`${label}:${index + 1} must not use shell export syntax`);
    }
    const equalsAt = trimmed.indexOf("=");
    if (equalsAt < 1) throw new Error(`${label}:${index + 1} must use KEY=value syntax`);
    const key = trimmed.slice(0, equalsAt).trim();
    if (!ENV_KEY_PATTERN.test(key)) throw new Error(`${label}:${index + 1} has an invalid key`);
    if (seen.has(key)) throw new Error(`${label} contains duplicate key ${key}`);
    seen.add(key);
    keys.push(key);
  }
  return keys;
}

export function validateEnvFileKeys(keysOrContent, kind) {
  const keys = Array.isArray(keysOrContent) ? keysOrContent : parseEnvFileKeys(keysOrContent, kind);
  const unique = new Set(keys);
  if (unique.size !== keys.length) throw new Error(`${kind} environment contains duplicate keys`);
  if (kind === "runtime") {
    if (unique.has("DATABASE_MIGRATION_URL")) {
      throw new Error("runtime environment must not contain DATABASE_MIGRATION_URL");
    }
    if (keys.length === 0) throw new Error("runtime environment must not be empty");
  } else if (kind === "single-vm-runtime") {
    for (const key of keys) {
      if (!SINGLE_VM_RUNTIME_ENV_KEYS.has(key)) {
        throw new Error(`single-vm runtime environment must not contain ${key}`);
      }
    }
    if (unique.has("DATABASE_MIGRATION_URL")) {
      throw new Error("single-vm runtime environment must not contain DATABASE_MIGRATION_URL");
    }
    for (const required of [
      "COMMUNITY_MODE",
      "OPENROUND_DEPLOYMENT_ENVIRONMENT",
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
      "METRICS_ENABLED",
      "METRICS_TOKEN",
      "TRACING_ENABLED",
      "OTEL_EXPORTER_OTLP_TRACES_ENDPOINT",
      "OPENROUND_OTLP_BACKEND_ENDPOINT",
      "OPENROUND_OTLP_BACKEND_TOKEN",
      "OPENROUND_PAGING_WEBHOOK_URL",
      "OPENROUND_WARNING_WEBHOOK_URL",
      "OPENROUND_TICKET_WEBHOOK_URL",
      "ADMIN_TOKEN",
    ]) {
      if (!unique.has(required)) {
        throw new Error(`single-vm runtime environment requires ${required}`);
      }
    }
  } else if (kind === "migration") {
    const allowed = new Set(["DATABASE_MIGRATION_URL", "OPENROUND_MIGRATIONS_DIR"]);
    for (const key of keys) {
      if (!allowed.has(key)) throw new Error(`migration environment must not contain ${key}`);
    }
    if (!unique.has("DATABASE_MIGRATION_URL")) {
      throw new Error("migration environment requires DATABASE_MIGRATION_URL");
    }
  } else {
    throw new Error(`Unknown environment file kind ${JSON.stringify(kind)}`);
  }
  return keys;
}

export function assertNoEnvironmentKeyOverlap(
  firstKeys,
  secondKeys,
  firstLabel = "first environment",
  secondLabel = "second environment",
) {
  const second = new Set(secondKeys);
  const overlap = [...new Set(firstKeys)].filter((key) => second.has(key)).sort();
  if (overlap.length > 0) {
    throw new Error(`${firstLabel} and ${secondLabel} must not both define: ${overlap.join(", ")}`);
  }
  return true;
}

export function expectedProductionConfirmation(buildId) {
  assertFullGitSha(buildId);
  return `production:${buildId}`;
}

export function expectedDeploymentConfirmation(environment, buildId) {
  const normalized = normalizeEnvironment(environment);
  assertFullGitSha(buildId);
  return `${normalized}:${buildId}`;
}

export function validateDeploymentConfirmation(value, environment, buildId) {
  const expected = expectedDeploymentConfirmation(environment, buildId);
  if (value !== expected) throw new Error(`Deployment confirmation must exactly match ${expected}`);
  return true;
}

export function validateProductionConfirmation(value, buildId) {
  const expected = expectedProductionConfirmation(buildId);
  if (value !== expected) throw new Error(`Production confirmation must exactly match ${expected}`);
  return true;
}

export const assertProductionConfirmation = validateProductionConfirmation;

export async function readStrictJson(path, validator, ...validatorArguments) {
  let parsed;
  try {
    parsed = JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    throw new Error(`Could not read valid JSON from ${path}: ${error.message}`, { cause: error });
  }
  return validator(parsed, ...validatorArguments);
}

export async function assertPrivateIgnoredEnvFile(path, kind, repositoryRoot) {
  const absolute = resolve(repositoryRoot, path);
  const relativePath = relative(repositoryRoot, absolute);
  if (!relativePath || relativePath.startsWith(`..${sep}`) || relativePath === "..") {
    throw new Error(`${kind} environment file must be inside the repository`);
  }
  const metadata = await lstat(absolute);
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new Error(`${kind} environment file must be a regular, non-symlink file`);
  }
  if ((metadata.mode & 0o777) !== 0o600) {
    throw new Error(`${kind} environment file must have mode 0600`);
  }
  const canonicalRoot = await realpath(repositoryRoot);
  const canonicalPath = await realpath(absolute);
  if (!canonicalPath.startsWith(`${canonicalRoot}${sep}`)) {
    throw new Error(`${kind} environment file resolves outside the repository`);
  }
  const content = await readFile(canonicalPath, "utf8");
  const keys = validateEnvFileKeys(parseEnvFileKeys(content, `${kind} environment`), kind);
  return {
    absolute: canonicalPath,
    relative: relative(repositoryRoot, canonicalPath),
    keys,
    content,
  };
}

export async function resolveCheckedRepositoryFile(
  path,
  repositoryRoot,
  label,
  { requireGitClean = false } = {},
) {
  const absolute = resolve(repositoryRoot, path);
  const canonicalRoot = await realpath(repositoryRoot);
  const metadata = await lstat(absolute);
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new Error(`${label} must be a regular, non-symlink file`);
  }
  const canonicalPath = await realpath(absolute);
  if (!canonicalPath.startsWith(`${canonicalRoot}${sep}`)) {
    throw new Error(`${label} resolves outside the repository`);
  }
  if (requireGitClean) {
    const repositoryPath = relative(canonicalRoot, canonicalPath);
    try {
      await run("git", ["ls-files", "--error-unmatch", "--", repositoryPath], {
        cwd: canonicalRoot,
        capture: true,
      });
    } catch (error) {
      throw new Error(`${label} must be tracked by Git`, { cause: error });
    }
    try {
      await run("git", ["diff", "--quiet", "HEAD", "--", repositoryPath], {
        cwd: canonicalRoot,
        capture: true,
      });
    } catch (error) {
      throw new Error(`${label} must match the reviewed HEAD revision`, { cause: error });
    }
  }
  return canonicalPath;
}

export async function resolveSshIdentityFile(path, cwd) {
  if (path === undefined) return undefined;
  const absolute = resolve(cwd, path);
  const metadata = await lstat(absolute);
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new Error("SSH identity file must be a regular, non-symlink file");
  }
  if ((metadata.mode & 0o777) !== 0o600) {
    throw new Error("SSH identity file must have mode 0600");
  }
  return await realpath(absolute);
}

export async function createPrivateFileSnapshot(content, name = "snapshot") {
  if (typeof content !== "string" && !Buffer.isBuffer(content)) {
    throw new Error("Private snapshot content must be a string or Buffer");
  }
  if (!/^[A-Za-z0-9._-]+$/.test(name)) throw new Error("Private snapshot name is invalid");
  const directory = await mkdtemp(join(tmpdir(), "openround-ops-"));
  const path = join(directory, name);
  try {
    await writeFile(path, content, { mode: 0o600 });
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
  return {
    path,
    async cleanup() {
      await rm(directory, { recursive: true, force: true });
    },
  };
}

export function sshArgv(singleVm, knownHostsFile, remoteArguments, { identityFile } = {}) {
  validateSingleVmConfig(singleVm);
  if (typeof knownHostsFile !== "string" || !isAbsolute(knownHostsFile)) {
    throw new Error("SSH known-hosts file must be an absolute path");
  }
  if (
    !Array.isArray(remoteArguments) ||
    remoteArguments.some((value) => typeof value !== "string")
  ) {
    throw new Error("SSH remote arguments must be a string array");
  }
  const remoteCommand = remoteArguments.map(shellDisplayToken).join(" ");
  return [
    "-T",
    "-o",
    "BatchMode=yes",
    "-o",
    "StrictHostKeyChecking=yes",
    "-o",
    `UserKnownHostsFile=${knownHostsFile}`,
    "-o",
    "ConnectTimeout=15",
    "-o",
    "ServerAliveInterval=15",
    "-o",
    "ServerAliveCountMax=4",
    ...(identityFile ? ["-i", identityFile] : []),
    "-p",
    String(singleVm.port),
    `${singleVm.user}@${singleVm.host}`,
    remoteCommand,
  ];
}

export async function run(command, args, options = {}) {
  if (!Array.isArray(args) || args.some((argument) => typeof argument !== "string")) {
    throw new Error("Command arguments must be a string array");
  }
  if (
    options.input !== undefined &&
    typeof options.input !== "string" &&
    !Buffer.isBuffer(options.input)
  ) {
    throw new Error("Command input must be a string or Buffer");
  }
  if (options.dryRun) {
    const printable = [command, ...args].map(shellDisplayToken).join(" ");
    process.stdout.write(`[dry-run] ${printable}\n`);
    return { code: 0, stdout: "", stderr: "" };
  }
  return await new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      timeout: options.timeoutMs ?? 0,
      stdio: [
        options.input === undefined ? "ignore" : "pipe",
        options.capture ? "pipe" : "inherit",
        options.capture ? "pipe" : "inherit",
      ],
      shell: false,
    });
    let stdout = "";
    let stderr = "";
    if (options.capture) {
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk) => (stdout += chunk));
      child.stderr.on("data", (chunk) => (stderr += chunk));
    }
    if (options.input !== undefined) {
      child.stdin.on("error", (error) => {
        if (error.code !== "EPIPE") reject(error);
      });
      child.stdin.end(options.input);
    }
    child.on("error", reject);
    child.on("close", (code, signal) => {
      if (code === 0) return resolvePromise({ code, stdout, stderr });
      const detail = signal ? `signal ${signal}` : `exit ${code}`;
      const error = new Error(`${command} failed with ${detail}`);
      error.exitCode = code;
      error.stdout = stdout;
      error.stderr = stderr;
      reject(error);
    });
  });
}

export async function assertKnownHostsTarget(knownHostsFile, singleVm, runCommand = run) {
  validateSingleVmConfig(singleVm);
  if (typeof knownHostsFile !== "string" || !isAbsolute(knownHostsFile)) {
    throw new Error("SSH known-hosts file must be an absolute path");
  }
  const lookupHost = singleVm.port === 22 ? singleVm.host : `[${singleVm.host}]:${singleVm.port}`;
  let rawResult;
  try {
    rawResult = await runCommand("ssh-keygen", ["-F", lookupHost, "-f", knownHostsFile], {
      capture: true,
    });
  } catch (error) {
    if (error?.exitCode === 1) {
      throw new Error(`SSH known-hosts file must contain a valid host key for ${lookupHost}`, {
        cause: error,
      });
    }
    throw new Error(`Could not validate the SSH host key for ${lookupHost}`, { cause: error });
  }

  let hasExactPin = false;
  const acceptedKeyIdentities = new Set();
  const revokedKeyIdentities = new Set();
  const normalizedLookupHost = lookupHost.toLowerCase();
  for (const sourceLine of String(rawResult?.stdout ?? "").split(/\r?\n/)) {
    const line = sourceLine.trim();
    if (!line || line.startsWith("#")) continue;
    const fields = line.split(/\s+/);
    const marker = fields[0]?.startsWith("@") ? fields.shift() : undefined;
    const hosts = fields[0] ?? "";
    const keyIdentity = fields.length >= 3 ? `${fields[1]} ${fields[2]}` : undefined;
    if (marker === "@revoked") {
      if (keyIdentity) revokedKeyIdentities.add(keyIdentity);
      continue;
    }
    if (marker !== undefined || hosts.includes("*") || hosts.includes("?") || hosts.includes("!")) {
      throw new Error(`SSH known-hosts file must use an exact host-key pin for ${lookupHost}`);
    }
    const hasLiteralExactPin = hosts
      .split(",")
      .some((host) => host.toLowerCase() === normalizedLookupHost);
    if (hosts.startsWith("|1|") || hasLiteralExactPin) {
      hasExactPin = true;
      if (keyIdentity) acceptedKeyIdentities.add(keyIdentity);
      continue;
    }
    throw new Error(`SSH known-hosts file must use an exact host-key pin for ${lookupHost}`);
  }
  if (!hasExactPin) {
    throw new Error(`SSH known-hosts file must contain a valid host key for ${lookupHost}`);
  }
  if ([...acceptedKeyIdentities].some((key) => revokedKeyIdentities.has(key))) {
    throw new Error(`SSH known-hosts file must not revoke a pinned host key for ${lookupHost}`);
  }

  let fingerprintResult;
  try {
    fingerprintResult = await runCommand(
      "ssh-keygen",
      ["-l", "-F", lookupHost, "-f", knownHostsFile],
      { capture: true },
    );
  } catch (error) {
    if (error?.exitCode === 1) {
      throw new Error(`SSH known-hosts file must contain a valid host key for ${lookupHost}`, {
        cause: error,
      });
    }
    throw new Error(`Could not validate the SSH host key for ${lookupHost}`, { cause: error });
  }
  const matchHeaders = String(fingerprintResult?.stdout ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("# Host "));
  if (
    matchHeaders.length === 0 ||
    matchHeaders.every((line) => line.endsWith(" REVOKED") || line.endsWith(" CA"))
  ) {
    throw new Error(`SSH known-hosts file must contain a valid host key for ${lookupHost}`);
  }
  return true;
}

export function shellDisplayToken(value) {
  const token = String(value);
  return /^[A-Za-z0-9_./:@%+=,-]+$/.test(token) ? token : `'${token.replaceAll("'", "'\\''")}'`;
}

const MINIMUM_COSIGN_VERSION = [3, 0, 6];

export function assertSupportedCosignVersion(output) {
  const match = String(output).match(/\bGitVersion:\s*v?(\d+)\.(\d+)\.(\d+)([-+][^\s]+)?(?:\s|$)/i);
  if (!match) {
    throw new Error("Unable to determine Cosign version; Cosign 3.0.6 or newer is required");
  }
  if (match[4]?.startsWith("-")) {
    throw new Error(
      `Cosign ${match.slice(1, 4).join(".")}${match[4]} is unsupported; a stable Cosign 3.0.6 or newer release is required`,
    );
  }
  const installed = match.slice(1, 4).map(Number);
  if (installed[0] !== MINIMUM_COSIGN_VERSION[0]) {
    throw new Error(
      `Cosign ${installed.join(".")} is unsupported; a stable Cosign release from 3.0.6 up to, but not including, 4.0.0 is required`,
    );
  }
  const comparisonIndex = installed.findIndex(
    (value, index) => value !== MINIMUM_COSIGN_VERSION[index],
  );
  const supported =
    comparisonIndex === -1 || installed[comparisonIndex] > MINIMUM_COSIGN_VERSION[comparisonIndex];
  if (!supported) {
    throw new Error(
      `Cosign ${installed.join(".")} is unsupported; Cosign 3.0.6 or newer is required`,
    );
  }
  return installed.join(".");
}

export async function assertCommandAvailable(command, { cwd, dryRun = false } = {}) {
  if (dryRun) return;
  const versionArguments =
    command === "cosign" || command === "flyctl"
      ? ["version"]
      : command === "ssh"
        ? ["-V"]
        : ["--version"];
  const result = await run(command, versionArguments, { cwd, capture: true });
  if (command === "cosign") {
    assertSupportedCosignVersion(`${result.stdout}\n${result.stderr}`);
  }
}

export async function isIgnoredByGit(path, repositoryRoot) {
  try {
    await run("git", ["check-ignore", "--quiet", "--", path], {
      cwd: repositoryRoot,
      capture: true,
    });
    return true;
  } catch (error) {
    if (error.exitCode === 1) return false;
    throw error;
  }
}

export async function ensureIgnoredEnvFile(pathInfo, repositoryRoot, kind) {
  if (!(await isIgnoredByGit(pathInfo.relative, repositoryRoot))) {
    throw new Error(`${kind} environment file must be ignored by Git`);
  }
}

export async function fileMode(path) {
  return (await stat(path)).mode & 0o777;
}
