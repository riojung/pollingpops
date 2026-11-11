import { spawn, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { access, mkdir, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { browserRuntime, runBrowserTests } from "../../scripts/test-browser.mjs";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "pollingpops-browser-runtime-test-"));
  roots.push(root);
  return root;
}

function browserEnvironment() {
  return { ...process.env, MOZ_APP_DATA: "", MOZ_LOCAL_APP_DATA: "" };
}

describe("isolated browser app data", () => {
  it("creates separate owned macOS directories without changing the parent environment", async () => {
    const root = await fixture();
    const env = { HOME: "/unchanged-home", TMPDIR: "/unchanged-temporary-directory" };
    const first = await browserRuntime({ env, platform: "darwin", temporaryRoot: root });
    const second = await browserRuntime({ env, platform: "darwin", temporaryRoot: root });
    expect(first.environment).toMatchObject(env);
    expect(env).toEqual({ HOME: "/unchanged-home", TMPDIR: "/unchanged-temporary-directory" });
    expect(first.directory).not.toBe(second.directory);
    expect(first.environment.MOZ_APP_DATA).not.toBe(first.environment.MOZ_LOCAL_APP_DATA);
    await access(first.environment.MOZ_APP_DATA!);
    await access(first.environment.MOZ_LOCAL_APP_DATA!);
    await first.cleanup();
    await expect(access(first.directory!)).rejects.toThrow();
    await access(second.directory!);
    await second.cleanup();
    expect(await readdir(root)).toEqual([]);
  });

  it("preserves supplied app-data directories and removes only directories it creates", async () => {
    const root = await fixture();
    const supplied = join(root, "supplied-app-data");
    await mkdir(supplied);
    const runtime = await browserRuntime({
      env: { MOZ_APP_DATA: supplied },
      platform: "darwin",
      temporaryRoot: root,
    });
    expect(runtime.environment.MOZ_APP_DATA).toBe(supplied);
    await access(runtime.environment.MOZ_LOCAL_APP_DATA!);
    await runtime.cleanup();
    await access(supplied);
    expect(await readdir(root)).toEqual(["supplied-app-data"]);
    const complete = await browserRuntime({
      env: { MOZ_APP_DATA: supplied, MOZ_LOCAL_APP_DATA: supplied },
      platform: "darwin",
      temporaryRoot: root,
    });
    expect(complete.directory).toBeUndefined();
    await complete.cleanup();
    await access(supplied);
  });

  it.each(["linux", "win32"])(
    "passes %s environments through without app-data changes",
    async (platform) => {
      const root = await fixture();
      const env = { HOME: "/unchanged-home", MOZ_APP_DATA: "" };
      const runtime = await browserRuntime({ env, platform, temporaryRoot: root });
      expect(runtime.environment).toEqual(env);
      expect(runtime.environment).not.toBe(env);
      expect(runtime.directory).toBeUndefined();
      await runtime.cleanup();
      expect(await readdir(root)).toEqual([]);
    },
  );
});

describe("browser test process lifecycle", () => {
  it("forwards exact CLI arguments, preserves failures, and cleans app data after child exit", async () => {
    const root = await fixture();
    const arguments_ = [
      "--config=playwright.beta.config.ts",
      "--grep",
      "space 한글 .*",
      "--workers=1",
    ];
    let received: string[] = [];
    const signalSource = new EventEmitter();
    const code = await runBrowserTests(arguments_, {
      env: browserEnvironment(),
      platform: "darwin",
      temporaryRoot: root,
      signalSource,
      spawnProcess: (command: string, args: string[], options: Parameters<typeof spawn>[2]) => {
        expect(command).toBe(process.execPath);
        received = args;
        const source = `
          const fs = require('node:fs');
          if (!fs.existsSync(process.env.MOZ_APP_DATA) || !fs.existsSync(process.env.MOZ_LOCAL_APP_DATA)) process.exit(91);
          process.exit(17);
        `;
        return spawn(process.execPath, ["-e", source], options);
      },
    });
    expect(received[0]).toMatch(/@playwright\/test\/cli\.js$/);
    expect(received.slice(1)).toEqual(["test", ...arguments_]);
    expect(code).toBe(17);
    expect(await readdir(root)).toEqual([]);
    expect(signalSource.eventNames()).toEqual([]);
  });

  it("returns a failure status for a child killed by SIGTERM and removes its directories", async () => {
    const root = await fixture();
    const code = await runBrowserTests([], {
      env: browserEnvironment(),
      platform: "darwin",
      temporaryRoot: root,
      spawnProcess: (_command: string, _args: string[], options: Parameters<typeof spawn>[2]) =>
        spawn(process.execPath, ["-e", "process.kill(process.pid, 'SIGTERM')"], options),
    });
    expect(code).toBe(143);
    expect(await readdir(root)).toEqual([]);
  });

  it("waits for real child shutdown before cleanup and preserves forwarded cancellation", async () => {
    const root = await fixture();
    const marker = join(root, "shutdown-result");
    const descendantMarker = join(root, "descendant-result");
    const signalSource = new EventEmitter();
    let child: ChildProcess | undefined;
    let announceReady: () => void;
    const ready = new Promise<void>((done) => {
      announceReady = done;
    });
    const source = `
      const fs = require('node:fs');
      const { spawn } = require('node:child_process');
      const descendant = spawn(process.execPath, ['-e', ${JSON.stringify(`
        const fs = require('node:fs');
        process.on('SIGTERM', () => {
          fs.writeFileSync(${JSON.stringify(descendantMarker)}, 'received');
          process.exit(0);
        });
        console.log('READY');
        setInterval(() => {}, 1000);
      `)}], { stdio: ['ignore', 'pipe', 'inherit'] });
      process.on('SIGTERM', () => {
        setTimeout(() => {
          const present = fs.existsSync(process.env.MOZ_APP_DATA) && fs.existsSync(process.env.MOZ_LOCAL_APP_DATA);
          fs.writeFileSync(${JSON.stringify(marker)}, present ? 'app-data-present-until-exit' : 'removed-too-soon');
          process.exit(0);
        }, 50);
      });
      descendant.stdout.once('data', () => console.log('READY'));
      setInterval(() => {}, 1000);
    `;
    const running = runBrowserTests([], {
      env: browserEnvironment(),
      platform: "darwin",
      temporaryRoot: root,
      signalSource,
      spawnProcess: (_command: string, _args: string[], options: Parameters<typeof spawn>[2]) => {
        child = spawn(process.execPath, ["-e", source], {
          ...options,
          stdio: ["ignore", "pipe", "ignore"],
        });
        child.stdout!.once("data", () => announceReady());
        return child;
      },
    });
    try {
      await ready;
      signalSource.emit("SIGTERM");
      signalSource.emit("SIGINT");
      expect(await running).toBe(143);
      expect(await readFile(marker, "utf8")).toBe("app-data-present-until-exit");
      expect(await readFile(descendantMarker, "utf8")).toBe("received");
      expect(await readdir(root)).toEqual(["descendant-result", "shutdown-result"]);
      expect(signalSource.eventNames()).toEqual([]);
    } finally {
      if (child?.pid) {
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch {
          // The owned process group has already stopped.
        }
      }
      await running;
    }
  });

  it("cleans directories after an asynchronous launch error", async () => {
    const root = await fixture();
    const signalSource = new EventEmitter();
    await expect(
      runBrowserTests([], {
        env: browserEnvironment(),
        platform: "darwin",
        temporaryRoot: root,
        signalSource,
        spawnProcess: (_command: string, _args: string[], options: Parameters<typeof spawn>[2]) =>
          spawn(join(root, "nonexistent-command"), [], options),
      }),
    ).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readdir(root)).toEqual([]);
    expect(signalSource.eventNames()).toEqual([]);
  });

  it("cleans directories when spawning throws before returning a child", async () => {
    const root = await fixture();
    await expect(
      runBrowserTests([], {
        env: browserEnvironment(),
        platform: "darwin",
        temporaryRoot: root,
        spawnProcess: () => {
          throw new Error("launch failed");
        },
      }),
    ).rejects.toThrow("launch failed");
    expect(await readdir(root)).toEqual([]);
  });
});
