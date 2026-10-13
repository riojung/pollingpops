#!/usr/bin/env node

import console from "node:console";
import { readFile, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath, URL } from "node:url";
import { parse as parseYaml } from "yaml";
import {
  composeArgv,
  DEV_COMPOSE_PROFILES,
  dockerContextArgv,
  parseCliArguments,
  run,
} from "./lib.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const serviceScript = join(repositoryRoot, "scripts/ops/service.mjs");
const startFlags = ["--activate=false", "--save-config=false", "--ssh-config=false"];
const dockerOverrides = [
  "DOCKER_HOST",
  "DOCKER_CONTEXT",
  "DOCKER_TLS_VERIFY",
  "DOCKER_CERT_PATH",
  "DOCKER_API_VERSION",
];

export function usage() {
  return `Polling Pops post-reboot Colima startup

Usage: pnpm local:start [options]
       node scripts/ops/local-start.mjs [options]

  --colima-profile NAME    Existing Colima VM (default: default)
  --docker-context NAME    Its existing Docker context (default: colima or colima-NAME)
  --profile NAME           Service bundle: core, media, observability (default: core)
  --no-build               Reuse existing images for a faster subsequent startup
  --restart                Force-recreate product containers after Docker is ready
  --restart-runtime        Allow one stop/start of an unhealthy running Colima VM
                           WARNING: interrupts every container in that selected VM
  --wait-seconds N          Runtime startup/readiness budget, 1-900 (default: 180)
  --dry-run                Inspect and print the plan without starting/stopping anything
  --help                   Show this help

Starts only a verified existing Docker-backed profile. Does not create/delete VMs, delete volumes,
switch the global Docker context, edit Colima settings, or install login/startup automation.
Docker overrides are cleared for child commands only. Hosted deployments are never touched.`;
}

export function childEnvironment(environment) {
  const scoped = { ...environment };
  for (const key of dockerOverrides) delete scoped[key];
  return scoped;
}

async function directoryExists(path) {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

export async function colimaHome(environment, homeDirectory, exists = directoryExists) {
  if (environment.COLIMA_HOME) {
    const selected = resolve(repositoryRoot, environment.COLIMA_HOME);
    if (!(await exists(selected)))
      throw new Error(
        "COLIMA_HOME does not reference an existing directory. No runtime was started.",
      );
    return selected;
  }
  const legacy = join(homeDirectory, ".colima");
  if (await exists(legacy)) return legacy;
  const xdg = resolve(
    repositoryRoot,
    environment.XDG_CONFIG_HOME || join(homeDirectory, ".config"),
    "colima",
  );
  if (await exists(xdg)) return xdg;
  throw new Error(
    "No existing Colima configuration directory was found. Configure your intended profile separately; this script will not create a new VM.",
  );
}

function profilesFromJson(stdout) {
  const source = stdout.trim();
  const parsed = source.startsWith("[")
    ? JSON.parse(source)
    : source
        .split(/\r?\n/)
        .filter(Boolean)
        .map((line) => JSON.parse(line));
  if (
    !Array.isArray(parsed) ||
    parsed.some((item) => !item || typeof item.name !== "string" || typeof item.status !== "string")
  )
    throw new Error(
      "Colima returned an unsupported profile list. Check colima list before retrying.",
    );
  return parsed;
}

export async function main(argv = process.argv.slice(2), dependencies = {}) {
  const parsed = parseCliArguments(argv, {
    valueOptions: ["colima-profile", "docker-context", "profile", "wait-seconds"],
    booleanOptions: ["no-build", "restart", "restart-runtime", "dry-run", "help"],
  });
  const log = dependencies.log ?? console.log;
  if (parsed.flags.has("help")) {
    log(usage());
    return;
  }
  if (parsed.positionals.length)
    throw new Error(
      "This command accepts options only and operates on local development. See --help.",
    );
  const colimaProfile = parsed.values.get("colima-profile") ?? "default";
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(colimaProfile))
    throw new Error(
      "--colima-profile must name an existing profile, not a path or command option.",
    );
  const context =
    parsed.values.get("docker-context") ??
    (colimaProfile === "default" ? "colima" : `colima-${colimaProfile}`);
  const contextArgs = dockerContextArgv(context);
  const profile = parsed.values.get("profile") ?? "core";
  if (!Object.hasOwn(DEV_COMPOSE_PROFILES, profile))
    throw new Error("--profile must be core, media, or observability. It is not a Colima VM name.");
  const rawWait = parsed.values.get("wait-seconds") ?? "180";
  if (!/^\d+$/.test(rawWait) || Number(rawWait) < 1 || Number(rawWait) > 900)
    throw new Error("--wait-seconds must be an integer from 1 to 900.");
  const waitMs = Number(rawWait) * 1000;
  const dryRun = parsed.flags.has("dry-run");
  const action = parsed.flags.has("restart") ? "restart" : "start";
  const noBuild = parsed.flags.has("no-build");
  const environment = dependencies.environment ?? process.env;
  const env = childEnvironment(environment);
  const command = dependencies.runCommand ?? run;
  const loadFile = dependencies.readFile ?? readFile;
  const sleep = dependencies.sleep ?? delay;
  const now = dependencies.now ?? (() => performance.now());
  const options = { cwd: repositoryRoot, env };
  const diagnostics = { ...options, capture: true, timeoutMs: 10_000 };
  const root = await colimaHome(
    environment,
    dependencies.homeDirectory ?? environment.HOME ?? homedir(),
    dependencies.directoryExists,
  );
  for (const [tool, args, label] of [
    ["colima", ["version"], "Colima"],
    ["docker", ["--version"], "Docker CLI"],
  ]) {
    try {
      await command(tool, args, diagnostics);
    } catch (error) {
      throw new Error(
        `${label} is required and must be available on PATH. Source: local startup prerequisites. No services were changed.`,
        { cause: error },
      );
    }
  }
  const listed = await command("colima", ["list", "--json"], diagnostics);
  const selected = profilesFromJson(listed.stdout).find((item) => item.name === colimaProfile);
  if (!selected)
    throw new Error(
      `Colima profile ${colimaProfile} does not exist. Choose one from colima list; no new profile will be created.`,
    );
  const profileDir = join(root, colimaProfile);
  let configuration;
  try {
    configuration = parseYaml(await loadFile(join(profileDir, "colima.yaml"), "utf8"));
  } catch (error) {
    throw new Error(
      `Cannot read the existing configuration for Colima profile ${colimaProfile}. No runtime was started.`,
      { cause: error },
    );
  }
  if ((configuration?.runtime ?? selected.runtime) !== "docker")
    throw new Error(
      `Colima profile ${colimaProfile} is not confirmed as Docker-backed. Its runtime/configuration will not be changed.`,
    );
  if (!["Running", "Stopped"].includes(selected.status))
    throw new Error(
      `Colima profile ${colimaProfile} is ${selected.status}; wait for a stable state and retry. No runtime was changed.`,
    );
  async function verifyContext() {
    let host;
    try {
      const inspected = await command(
        "docker",
        ["context", "inspect", context, "--format", "{{json .Endpoints.docker.Host}}"],
        diagnostics,
      );
      host = JSON.parse(inspected.stdout);
    } catch (error) {
      throw new Error(
        `Cannot inspect Docker context ${context}. Choose its existing name from docker context ls. No alternative runtime will be selected.`,
        { cause: error },
      );
    }
    let socket;
    try {
      const endpoint = new URL(host);
      if (endpoint.protocol === "unix:" && !endpoint.host)
        socket = resolve(decodeURIComponent(endpoint.pathname));
    } catch {
      /* Refuse non-local or unrecognized endpoints. */
    }
    if (socket !== join(profileDir, "docker.sock"))
      throw new Error(
        `Docker context ${context} does not point to the selected Colima profile ${colimaProfile}. Refusing to use another profile or data namespace.`,
      );
  }
  await verifyContext();
  try {
    await command("docker", [...contextArgs, "compose", "version"], diagnostics);
  } catch (error) {
    throw new Error(
      "Docker Compose v2 is required. Source: local startup prerequisites. No runtime or product services were started.",
      { cause: error },
    );
  }
  const probe = async (timeoutMs = 5000) => {
    try {
      await command("docker", [...contextArgs, "info", "--format", "{{.ServerVersion}}"], {
        ...diagnostics,
        timeoutMs,
      });
      return true;
    } catch {
      return false;
    }
  };
  const ready = await probe();
  log(
    `Polling Pops local startup: Colima ${colimaProfile}, Docker context ${context}, service bundle ${profile}.`,
  );
  const start = ["start", "--profile", colimaProfile, ...startFlags];
  const stop = ["stop", "--profile", colimaProfile];
  const service = [
    serviceScript,
    "development",
    action,
    "--profile",
    profile,
    "--docker-context",
    context,
    ...(noBuild ? ["--no-build"] : []),
  ];
  if (dryRun) {
    if (!ready && selected.status === "Running" && parsed.flags.has("restart-runtime"))
      log(`[dry-run] colima ${stop.join(" ")}`);
    if (!ready && (selected.status === "Stopped" || parsed.flags.has("restart-runtime")))
      log(`[dry-run] colima ${start.join(" ")}`);
    if (!ready)
      log(
        `[dry-run] Wait up to ${rawWait}s for Docker readiness; do not start services on failure.`,
      );
    log(
      `[dry-run] docker ${[...contextArgs, ...composeArgv(action, { profile, noBuild })].join(" ")}`,
    );
    log("Dry run complete. No runtime, service, volume, or global context was changed.");
    return;
  }
  if (!ready) {
    const deadline = now() + waitMs;
    const runtimeCommand = async (args) => {
      const remaining = deadline - now();
      if (remaining <= 0)
        throw new Error(
          "Colima startup exceeded the readiness budget. Check colima list and increase --wait-seconds if needed; no product services were started.",
        );
      try {
        await command("colima", args, { ...options, timeoutMs: Math.ceil(remaining) });
      } catch (error) {
        throw new Error(
          `Colima could not complete ${args[0]} for profile ${colimaProfile}. Source: runtime startup, before product services. Inspect colima status --profile ${colimaProfile}; no volumes were deleted.`,
          { cause: error },
        );
      }
    };
    if (selected.status === "Stopped") {
      log("Starting the existing Colima VM without changing global context or saved settings…");
      await runtimeCommand(start);
    } else if (parsed.flags.has("restart-runtime")) {
      log(
        "Explicit runtime recovery: stopping all containers in the selected VM, then starting the same VM. Volumes are retained.",
      );
      await runtimeCommand(stop);
      await runtimeCommand(start);
    } else
      log(
        "Colima reports running; waiting for its Docker daemon without interrupting other containers…",
      );
    let becameReady = false;
    while (now() < deadline) {
      if (await probe(Math.max(1, Math.min(5000, Math.ceil(deadline - now()))))) {
        becameReady = true;
        break;
      }
      const remaining = deadline - now();
      if (remaining > 0) await sleep(Math.min(1000, remaining));
    }
    if (!becameReady)
      throw new Error(
        `Docker did not become ready for profile ${colimaProfile} within ${rawWait}s. Source: local runtime readiness; product services were not started. Verify docker --context ${context} info. If Colima is stuck in Running, retry with --restart-runtime (interrupts every container in that VM; retains volumes). Do not delete profiles or volumes.`,
      );
    await verifyContext();
  }
  log("Docker is ready. Starting Polling Pops with its existing openround volume namespace…");
  try {
    await command(process.execPath, service, options);
  } catch (error) {
    throw new Error(
      `Docker is ready, but Polling Pops services could not start. Source: Compose/application startup. Inspect pnpm service development logs --profile ${profile} --docker-context ${context}. Existing volumes are retained.`,
      { cause: error },
    );
  }
  log(
    "Polling Pops services are started. Default URLs: http://localhost:8080 (management console: http://localhost:3002; captured sign-in email: http://localhost:8025).",
  );
}

if (
  process.argv[1] &&
  (await realpath(process.argv[1]).catch(() => null)) === fileURLToPath(import.meta.url)
) {
  main().catch((error) => {
    process.stderr.write(`Polling Pops local startup failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}
