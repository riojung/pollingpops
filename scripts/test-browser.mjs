import { spawn } from "node:child_process";
import console from "node:console";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { constants, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import process from "node:process";
import { clearTimeout, setTimeout } from "node:timers";
import { fileURLToPath, pathToFileURL, URL } from "node:url";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const playwrightCli = createRequire(import.meta.url).resolve("@playwright/test/cli");

export async function browserRuntime({
  env = process.env,
  platform = process.platform,
  temporaryRoot = tmpdir(),
} = {}) {
  const environment = { ...env };
  let directory;
  const cleanup = async () => {
    if (directory) await rm(directory, { recursive: true, force: true });
  };
  try {
    // Some macOS hosts deny Firefox's shared app-data lookup before opening a profile.
    // Isolate app data for this invocation, preserving the stock browser and sandbox.
    if (platform === "darwin" && (!environment.MOZ_APP_DATA || !environment.MOZ_LOCAL_APP_DATA)) {
      directory = await mkdtemp(join(temporaryRoot, "pollingpops-browser-runtime-"));
      for (const [variable, name] of [
        ["MOZ_APP_DATA", "app-data"],
        ["MOZ_LOCAL_APP_DATA", "local-data"],
      ]) {
        if (environment[variable]) continue;
        const value = join(directory, name);
        await mkdir(value);
        environment[variable] = value;
      }
    }
    return { environment, directory, cleanup };
  } catch (error) {
    await cleanup();
    throw error;
  }
}

export async function runBrowserTests(
  args = [],
  {
    env = process.env,
    platform = process.platform,
    temporaryRoot = tmpdir(),
    spawnProcess = spawn,
    signalSource = process,
  } = {},
) {
  const runtime = await browserRuntime({ env, platform, temporaryRoot });
  let escalation;
  const handlers = [];
  try {
    const child = spawnProcess(process.execPath, [playwrightCli, "test", ...args], {
      cwd: repositoryRoot,
      env: runtime.environment,
      stdio: "inherit",
      detached: platform !== "win32",
    });
    let interrupted;
    let childError;
    const terminate = (signal) => {
      if (!child.pid) return;
      try {
        if (platform === "win32") child.kill(signal);
        else process.kill(-child.pid, signal);
      } catch (error) {
        if (error.code !== "ESRCH") childError ??= error;
      }
    };
    const closed = new Promise((done) => {
      // A failed spawn emits error then close. Wait for close before removing app data.
      child.once("error", (error) => {
        childError = error;
      });
      child.once("close", (code, signal) => done({ code, signal }));
    });
    for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
      const handler = () => {
        if (interrupted) return;
        interrupted = signal;
        terminate(signal);
        escalation = setTimeout(() => terminate("SIGKILL"), 5_000);
      };
      signalSource.on(signal, handler);
      handlers.push([signal, handler]);
    }
    const result = await closed;
    // A wrapper or graceful child can exit before all its descendants finish stopping.
    if (interrupted) terminate("SIGKILL");
    if (childError) throw childError;
    const signal = interrupted ?? result.signal;
    return signal ? 128 + (constants.signals[signal] ?? 0) : (result.code ?? 1);
  } finally {
    clearTimeout(escalation);
    for (const [signal, handler] of handlers) signalSource.off(signal, handler);
    await runtime.cleanup();
  }
}

export async function browserTestMain(args = process.argv.slice(2)) {
  try {
    process.exitCode = await runBrowserTests(args);
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  await browserTestMain();
