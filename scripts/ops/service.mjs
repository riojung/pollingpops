#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import process from "node:process";
import { fileURLToPath, URL } from "node:url";
import {
  assertCommandAvailable,
  assertDockerReady,
  assertConfiguredHostedTarget,
  assertKnownHostsTarget,
  composeArgv,
  createPrivateFileSnapshot,
  dockerContextArgv,
  normalizeEnvironment,
  parseCliArguments,
  readStrictJson,
  resolveCheckedRepositoryFile,
  resolveSshIdentityFile,
  run,
  sshArgv,
  validateDeployConfig,
} from "./lib.mjs";

const repositoryRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const ACTIONS = new Set(["start", "stop", "restart", "status", "logs"]);

function usage() {
  return `Polling Pops service control

Usage: scripts/service.sh <development|staging|production> <start|stop|restart|status|logs> [options]
       scripts/service.sh --environment <environment> <action> [options]

Options:
  --profile <core|media|observability>  Select a fixed Compose file set (default: core)
  --docker-context NAME                Use an existing Docker context for this command only
  --no-build                           Do not build images during start or restart
  --follow                             Follow logs instead of returning after the last 200 lines
  --config PATH                        Checked-in hosted deployment config
  --ssh-identity PATH                  Optional mode-0600 SSH private key (agent is default)
  --dry-run                            Print the fixed Docker or SSH argv without running it

Development uses local Compose. Staging and production act only on the current release selected by
the checked-in single-VM deployment config and never remove volumes.`;
}

function serviceSelection(parsed) {
  const explicitEnvironment = parsed.values.get("environment");
  let environment;
  let action;
  if (explicitEnvironment) {
    if (parsed.positionals.length !== 1) {
      throw new Error("Exactly one service action is required with --environment");
    }
    environment = normalizeEnvironment(explicitEnvironment);
    action = parsed.positionals[0];
  } else {
    if (parsed.positionals.length !== 2) {
      throw new Error("The development environment and one service action are required");
    }
    environment = normalizeEnvironment(parsed.positionals[0]);
    action = parsed.positionals[1];
  }
  if (!ACTIONS.has(action)) throw new Error(`Unsupported service action ${JSON.stringify(action)}`);
  return { environment, action };
}

function configFileName(environment) {
  return environment === "development" ? "dev.json" : `${environment}.json`;
}

function strictHostedConfigPath(path, environment) {
  const expectedRelative = `config/deploy/${configFileName(environment)}`;
  const expected = resolve(repositoryRoot, expectedRelative);
  const selected = resolve(repositoryRoot, path ?? expectedRelative);
  if (selected !== expected) {
    throw new Error(`--config must be the checked-in target file ${expectedRelative}`);
  }
  return selected;
}

export const REMOTE_SERVICE_SCRIPT = [
  "set -eu",
  'base="$1"',
  'project="$2"',
  'action="$3"',
  'follow="$4"',
  'case "$action" in',
  "  start|stop|restart)",
  '    lock="$base/.deploy.lock"',
  '    if ! mkdir "$lock" 2>/dev/null; then echo "Remote deployment lock is held" >&2; exit 73; fi',
  "    cleanup_service() {",
  "      status=$?",
  '      rm -rf "$lock"',
  "      trap - EXIT HUP INT TERM",
  '      exit "$status"',
  "    }",
  "    trap cleanup_service EXIT",
  "    trap 'exit 129' HUP",
  "    trap 'exit 130' INT",
  "    trap 'exit 143' TERM",
  '    printf "%s\\n" "$$" > "$lock/pid"',
  '    date +%s > "$lock/started"',
  "    ;;",
  "  status|logs) ;;",
  '  *) echo "Unsupported remote lifecycle action" >&2; exit 64 ;;',
  "esac",
  'current=$(readlink "$base/current" 2>/dev/null || true)',
  'case "$current" in releases/*) current_build=${current#releases/} ;; *) echo "No valid current release is deployed" >&2; exit 69 ;; esac',
  'case "$current_build" in *[!0-9a-f]*|"") echo "No valid current release is deployed" >&2; exit 69 ;; esac',
  'case "${#current_build}" in 40|64) ;; *) echo "No valid current release is deployed" >&2; exit 69 ;; esac',
  '[ "$current" = "releases/$current_build" ] || { echo "No valid current release is deployed" >&2; exit 69; }',
  'release="$base/$current"',
  '[ -d "$release" ] || { echo "Current release directory is missing" >&2; exit 69; }',
  'compose_files=""',
  "while IFS= read -r relative_file; do",
  '  [ -n "$relative_file" ] || continue',
  '  [ -f "$release/$relative_file" ] || { echo "Current Compose file is missing" >&2; exit 66; }',
  '  if [ -z "$compose_files" ]; then compose_files="$release/$relative_file"; else compose_files="$compose_files:$release/$relative_file"; fi',
  'done < "$release/.compose-files"',
  '[ -n "$compose_files" ] || { echo "Current release has no Compose files" >&2; exit 66; }',
  "COMPOSE_FILE=$compose_files",
  "COMPOSE_PROJECT_NAME=$project",
  "export COMPOSE_FILE COMPOSE_PROJECT_NAME",
  'case "$action" in',
  "  status)",
  '    exec docker compose --env-file "$release/.env" ps',
  "    ;;",
  "  logs)",
  '    if [ "$follow" = "1" ]; then exec docker compose --env-file "$release/.env" logs --follow --tail 200; fi',
  '    exec docker compose --env-file "$release/.env" logs --tail 200',
  "    ;;",
  "  start|stop|restart)",
  '    case "$action" in',
  '      start) docker compose --env-file "$release/.env" up --detach --wait ;;',
  '      stop) docker compose --env-file "$release/.env" stop ;;',
  '      restart) docker compose --env-file "$release/.env" up --detach --force-recreate --wait ;;',
  "    esac",
  "    ;;",
  "esac",
].join("\n");

async function runHostedService(environment, action, parsed, dryRun) {
  if (
    parsed.values.has("profile") ||
    parsed.values.has("docker-context") ||
    parsed.flags.has("no-build")
  ) {
    throw new Error("--profile, --docker-context, and --no-build are development-only");
  }
  const configPath = await resolveCheckedRepositoryFile(
    strictHostedConfigPath(parsed.values.get("config"), environment),
    repositoryRoot,
    "deployment config",
    { requireGitClean: true },
  );
  const config = await readStrictJson(configPath, validateDeployConfig, environment);
  if (config.deploymentMode !== "single-vm") {
    throw new Error("Hosted service control requires deploymentMode single-vm");
  }
  assertConfiguredHostedTarget(config);
  const knownHostsFile = await resolveCheckedRepositoryFile(
    config.singleVm.knownHostsFile,
    repositoryRoot,
    "SSH known-hosts file",
    { requireGitClean: true },
  );
  await assertKnownHostsTarget(knownHostsFile, config.singleVm);
  const identityFile = await resolveSshIdentityFile(
    parsed.values.get("ssh-identity"),
    repositoryRoot,
  );
  const knownHostsSnapshot = await createPrivateFileSnapshot(
    await readFile(knownHostsFile),
    "known_hosts",
  );
  try {
    await assertCommandAvailable("ssh", { cwd: repositoryRoot, dryRun });
    await run(
      "ssh",
      sshArgv(
        config.singleVm,
        knownHostsSnapshot.path,
        [
          "sh",
          "-se",
          "--",
          config.singleVm.deployPath,
          config.singleVm.projectName,
          action,
          parsed.flags.has("follow") ? "1" : "0",
        ],
        { identityFile },
      ),
      { cwd: repositoryRoot, dryRun, input: REMOTE_SERVICE_SCRIPT },
    );
  } finally {
    await knownHostsSnapshot.cleanup();
  }
}

export async function main(argv = process.argv.slice(2)) {
  const parsed = parseCliArguments(argv, {
    valueOptions: ["environment", "profile", "docker-context", "config", "ssh-identity"],
    booleanOptions: ["dry-run", "no-build", "follow", "help"],
  });
  if (parsed.flags.has("help")) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  const { environment, action } = serviceSelection(parsed);
  if (parsed.flags.has("no-build") && !["start", "restart"].includes(action)) {
    throw new Error("--no-build is valid only for start or restart");
  }
  if (parsed.flags.has("follow") && action !== "logs") {
    throw new Error("--follow is valid only for logs");
  }
  const dryRun = parsed.flags.has("dry-run");
  if (environment !== "development") {
    await runHostedService(environment, action, parsed, dryRun);
    return;
  }
  if (parsed.values.has("config") || parsed.values.has("ssh-identity")) {
    throw new Error("--config and --ssh-identity are hosted-only");
  }
  const dockerContext = parsed.values.get("docker-context");
  const args = [
    ...dockerContextArgv(dockerContext),
    ...composeArgv(action, {
      follow: parsed.flags.has("follow"),
      noBuild: parsed.flags.has("no-build"),
      profile: parsed.values.get("profile") ?? "core",
    }),
  ];
  await assertDockerReady({ cwd: repositoryRoot, dryRun, dockerContext });
  let env = process.env;
  if (!dryRun && ["start", "restart"].includes(action)) {
    const { localAdminCredentialKey } = await import("./admin-key.mjs");
    env = {
      ...process.env,
      OPERATOR_CREDENTIAL_KEY: await localAdminCredentialKey(repositoryRoot),
    };
  }
  await run("docker", args, { cwd: repositoryRoot, dryRun, env });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`Polling Pops service command failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}
