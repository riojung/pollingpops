import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const environment = { ...process.env };
let taskDirectory;

try {
  // macOS 27 can deny Firefox's shared app-data lookup before a profile is opened.
  // Keep the standard browser/sandbox and isolate only this test process's app data.
  if (
    process.platform === "darwin" &&
    (!environment.MOZ_APP_DATA || !environment.MOZ_LOCAL_APP_DATA)
  ) {
    taskDirectory = await mkdtemp(join(tmpdir(), "pollingpops-scene-browsers-"));
    for (const [variable, name] of [
      ["MOZ_APP_DATA", "app-data"],
      ["MOZ_LOCAL_APP_DATA", "local-data"],
    ]) {
      if (environment[variable]) continue;
      const directory = join(taskDirectory, name);
      await mkdir(directory);
      environment[variable] = directory;
    }
  }
  const child = spawn(
    "pnpm",
    [
      "exec",
      "playwright",
      "test",
      "--config=playwright.presentation-scene.config.ts",
      ...process.argv.slice(2),
    ],
    {
      cwd: fileURLToPath(new URL("..", import.meta.url)),
      env: environment,
      stdio: "inherit",
    },
  );
  const interrupt = () => child.kill("SIGINT");
  const terminate = () => child.kill("SIGTERM");
  process.on("SIGINT", interrupt);
  process.on("SIGTERM", terminate);
  try {
    const result = await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (code, signal) => resolve({ code, signal }));
    });
    process.exitCode = result.code ?? (result.signal === "SIGINT" ? 130 : 1);
  } finally {
    process.off("SIGINT", interrupt);
    process.off("SIGTERM", terminate);
  }
} finally {
  if (taskDirectory) await rm(taskDirectory, { recursive: true, force: true });
}
