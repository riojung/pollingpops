#!/usr/bin/env node
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { lstat, mkdir, open, readFile, rm, writeFile } from "node:fs/promises";
import { hostname } from "node:os";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { clearInterval, clearTimeout, setInterval, setTimeout } from "node:timers";
import { fileURLToPath, pathToFileURL } from "node:url";
import { nextOutputDirectory } from "./next-config.mjs";

const defaultRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
function appDirectory(app, repositoryRoot) {
  if (!["web", "control"].includes(app)) throw new Error("Unknown Next application");
  return join(repositoryRoot, "apps", app);
}
async function assertOutput(app, dist, repositoryRoot) {
  const directory = appDirectory(app, repositoryRoot);
  if (nextOutputDirectory(app, { OPENROUND_NEXT_DIST_DIR: dist }) !== dist)
    throw new Error("Invalid Next output directory");
  try {
    if ((await lstat(join(directory, dist))).isSymbolicLink())
      throw new Error("A Next output directory cannot be a symbolic link");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}
async function withLock(name, operation, repositoryRoot) {
  const directory = join(repositoryRoot, ".turbo", "build-locks");
  await mkdir(directory, { recursive: true });
  const path = join(directory, `${name}.json`);
  const token = randomUUID();
  let handle;
  try {
    handle = await open(path, "wx", 0o600);
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    let pid = "unknown";
    try {
      const owner = JSON.parse(await readFile(path, "utf8"));
      if (Number.isSafeInteger(owner.pid)) pid = owner.pid;
    } catch {
      // An incomplete lock is still owned until its writer exits and is checked.
    }
    throw new Error(
      `Compiler output is busy (owner PID ${pid}; ${path}). Stop its build/server first. If the owner no longer exists, inspect and remove only this stale lock.`,
      { cause: error },
    );
  }
  let result;
  let failure;
  let failed = false;
  try {
    await handle.writeFile(JSON.stringify({ pid: process.pid, hostname: hostname(), token }));
    result = await operation();
  } catch (error) {
    failed = true;
    failure = error;
  }
  const cleanupErrors = [];
  try {
    await handle.close();
  } catch (error) {
    cleanupErrors.push(error);
  }
  try {
    const owner = JSON.parse(await readFile(path, "utf8"));
    if (owner.token === token) await rm(path);
  } catch (error) {
    if (error.code !== "ENOENT") cleanupErrors.push(error);
  }
  if (cleanupErrors.length) {
    const error = new AggregateError(
      failed ? [failure, ...cleanupErrors] : cleanupErrors,
      failed ? `${failure?.message ?? failure}; lock cleanup failed` : "Lock cleanup failed",
      failed ? { cause: failure } : undefined,
    );
    error.exitCode = failure?.exitCode;
    throw error;
  }
  if (failed) throw failure;
  return result;
}

/** Held by a compiler or production browser server for the entire output lifetime. */
export async function withNextBuildLock(
  app,
  dist,
  operation,
  { repositoryRoot = defaultRoot } = {},
) {
  await assertOutput(app, dist, repositoryRoot);
  return withLock(`${app}-${dist}`, operation, repositoryRoot);
}

function budget(value, fallback, label, minimum) {
  if (value === undefined) return fallback;
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < minimum || result > 3_600_000)
    throw new Error(`${label} must be an integer from ${minimum} to 3600000`);
  return result;
}

/** Uses an owned process group; deadlines/cancellation wait for children before releasing locks. */
export function runBuildProcess(
  command,
  args,
  {
    cwd,
    env = process.env,
    timeoutMs = 600_000,
    heartbeatMs = 15_000,
    killGraceMs = 5_000,
    label = "build",
    output = process.stdout,
    errorOutput = process.stderr,
  } = {},
) {
  return new Promise((resolveResult, reject) => {
    const started = Date.now();
    let stopped = null;
    let escalation;
    let phase = "starting";
    const child = spawn(command, args, {
      cwd,
      env,
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
    });
    function terminate(signal) {
      if (!child.pid) return;
      try {
        if (process.platform === "win32") child.kill(signal);
        else process.kill(-child.pid, signal);
      } catch (error) {
        if (error.code !== "ESRCH") errorOutput.write(`[${label}] child cleanup failed\n`);
      }
    }
    function stop(reason) {
      if (stopped) return;
      stopped = reason;
      terminate("SIGTERM");
      escalation = setTimeout(() => terminate("SIGKILL"), killGraceMs);
    }
    const interrupt = () => stop("SIGINT");
    const shutdown = () => stop("SIGTERM");
    const hangup = () => stop("SIGHUP");
    process.on("SIGINT", interrupt);
    process.on("SIGTERM", shutdown);
    process.on("SIGHUP", hangup);
    const deadline = setTimeout(() => stop("deadline"), timeoutMs);
    const heartbeat = setInterval(() => {
      output.write(
        `[${label}] elapsed=${Math.round((Date.now() - started) / 1_000)}s phase=${phase} compilerPid=${child.pid ?? "starting"}\n`,
      );
    }, heartbeatMs);
    child.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      if (/Creating an optimized|Compiling/.test(text)) phase = "compiling";
      if (/TypeScript|Checking validity/.test(text)) phase = "typecheck";
      if (/Collecting page|Generating static/.test(text)) phase = "prerender";
      if (/Finalizing|Collecting build traces/.test(text)) phase = "tracing";
      output.write(chunk);
    });
    child.stderr.on("data", (chunk) => errorOutput.write(chunk));
    function cleanup() {
      clearTimeout(deadline);
      clearInterval(heartbeat);
      clearTimeout(escalation);
      process.off("SIGINT", interrupt);
      process.off("SIGTERM", shutdown);
      process.off("SIGHUP", hangup);
    }
    child.once("error", (error) => {
      cleanup();
      reject(error);
    });
    child.once("close", (code, signal) => {
      // A compiler can exit before an ignoring descendant. Finish group cleanup as well.
      if (stopped) terminate("SIGKILL");
      cleanup();
      const seconds = Number(((Date.now() - started) / 1_000).toFixed(2));
      if (stopped || code !== 0 || signal) {
        const error = new Error(
          `[${label}] failed after ${seconds}s (${stopped ?? signal ?? `exit ${code}`}; last phase=${phase}). Inspect the compiler log above.`,
        );
        error.exitCode =
          stopped === "deadline"
            ? 124
            : stopped === "SIGINT"
              ? 130
              : stopped === "SIGTERM"
                ? 143
                : stopped === "SIGHUP"
                  ? 129
                  : code || 1;
        reject(error);
      } else {
        output.write(`[${label}] completed in ${seconds}s\n`);
        resolveResult({ seconds, code });
      }
    });
  });
}

async function snapshot(path) {
  try {
    return await readFile(path);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return undefined;
  }
}

export async function runNextBuild(
  app,
  {
    env = process.env,
    beforeBuild,
    afterBuild,
    repositoryRoot = defaultRoot,
    nextCliPath,
    args = [],
    output = process.stdout,
    errorOutput = process.stderr,
  } = {},
) {
  const directory = appDirectory(app, repositoryRoot);
  const dist = nextOutputDirectory(app, env);
  const timeoutMs = budget(
    env.OPENROUND_BUILD_TIMEOUT_MS,
    600_000,
    "OPENROUND_BUILD_TIMEOUT_MS",
    1_000,
  );
  const heartbeatMs = budget(
    env.OPENROUND_BUILD_HEARTBEAT_MS,
    15_000,
    "OPENROUND_BUILD_HEARTBEAT_MS",
    100,
  );
  return withNextBuildLock(
    app,
    dist,
    () =>
      withLock(
        `${app}-compiler`,
        async () => {
          const paths = [join(directory, "next-env.d.ts"), join(directory, "tsconfig.build.json")];
          const originals = await Promise.all(paths.map(snapshot));
          let result;
          try {
            await beforeBuild?.();
            if (originals[1] === undefined)
              throw new Error("Missing production tsconfig.build.json");
            const profile = JSON.parse(originals[1].toString());
            profile.include = [
              ...(profile.include ?? []).filter(
                (path) => !path.replace(/^\.\//, "").startsWith(".next"),
              ),
              `${dist}/types/**/*.ts`,
              `${dist}/dev/types/**/*.ts`,
            ];
            profile.compilerOptions = {
              ...profile.compilerOptions,
              tsBuildInfoFile: `${dist}/cache/production.tsbuildinfo`,
            };
            await writeFile(paths[1], `${JSON.stringify(profile, null, 2)}\n`);
            result = await runBuildProcess(
              process.execPath,
              [
                nextCliPath ?? join(directory, "node_modules/next/dist/bin/next"),
                "build",
                ...(app === "control" ? ["--webpack"] : []),
                ...args,
              ],
              {
                cwd: directory,
                env,
                timeoutMs,
                heartbeatMs,
                label: `build:${app}`,
                output,
                errorOutput,
              },
            );
          } finally {
            await Promise.all(
              paths.map((path, index) =>
                originals[index] === undefined
                  ? rm(path, { force: true })
                  : writeFile(path, originals[index]),
              ),
            );
          }
          // Source/provenance checks see the original tracked files, never Next's generated edits.
          return afterBuild ? await afterBuild() : result;
        },
        repositoryRoot,
      ),
    { repositoryRoot },
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  runNextBuild(process.argv[2], { args: process.argv.slice(3) }).catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = error.exitCode ?? 1;
  });
}
