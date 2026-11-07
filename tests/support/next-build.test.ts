import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runBuildProcess, runNextBuild, withNextBuildLock } from "../../scripts/build/next.mjs";

const roots: string[] = [];
const ownedPids = new Set<number>();
const sink = { write: vi.fn() };
const originalEnv = Buffer.from("// original next-env\r\n");
const originalConfig = Buffer.from(
  JSON.stringify({
    extends: "./tsconfig.json",
    compilerOptions: { strict: true, noEmit: true },
    include: [
      "next-env.d.ts",
      "app/**/*.tsx",
      ".next/types/**/*.ts",
      "./.next-old/dev/types/**/*.ts",
    ],
    exclude: ["node_modules", "**/*.test.ts", "**/*.test.tsx", "test/**"],
  }) + "\r\n",
);

afterEach(async () => {
  for (const pid of ownedPids) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // The cancellation fixtures may already have reaped this owned process.
    }
  }
  ownedPids.clear();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function fixture(source = "") {
  const root = await mkdtemp(join(tmpdir(), "pollingpops-next-guard-"));
  roots.push(root);
  for (const app of ["web", "control"]) {
    await mkdir(join(root, "apps", app), { recursive: true });
    await writeFile(join(root, "apps", app, "next-env.d.ts"), originalEnv);
    await writeFile(join(root, "apps", app, "tsconfig.build.json"), originalConfig);
  }
  const cli = join(root, "fake-next.cjs");
  await writeFile(cli, source);
  return {
    root,
    cli,
    options: {
      repositoryRoot: root,
      nextCliPath: cli,
      env: { ...process.env, OPENROUND_NEXT_DIST_DIR: ".next-fixture" },
      output: sink,
      errorOutput: sink,
    },
  };
}

async function assertRestored(root: string) {
  expect(await readFile(join(root, "apps/web/next-env.d.ts"))).toEqual(originalEnv);
  expect(await readFile(join(root, "apps/web/tsconfig.build.json"))).toEqual(originalConfig);
}

async function locks(root: string) {
  return readdir(join(root, ".turbo/build-locks")).catch((error) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
}

function deferred() {
  let release!: () => void;
  const promise = new Promise<void>((done) => (release = done));
  return { promise, release };
}

async function waitFor<T>(operation: () => Promise<T>, accepts: (value: T) => boolean) {
  const deadline = Date.now() + 10_000;
  do {
    const value = await operation();
    if (accepts(value)) return value;
    await new Promise((done) => setTimeout(done, 20));
  } while (Date.now() < deadline);
  throw new Error("Timed out waiting for child fixture");
}

function running(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error: any) {
    if (error.code === "ESRCH") return false;
    throw error;
  }
}

describe("Next compiler guard", () => {
  it("preserves the primary failure and exit status if lock cleanup also fails", async () => {
    const { root } = await fixture();
    const failure = Object.assign(new Error("compiler root cause"), { exitCode: 23 });
    await expect(
      withNextBuildLock(
        "web",
        ".next-fixture",
        async () => {
          await writeFile(
            join(root, ".turbo/build-locks/web-.next-fixture.json"),
            "invalid owner metadata",
          );
          throw failure;
        },
        { repositoryRoot: root },
      ),
    ).rejects.toMatchObject({
      message: "compiler root cause; lock cleanup failed",
      cause: failure,
      exitCode: 23,
    });
  });

  it("excludes another owner of the same output and allows distinct output lifetimes", async () => {
    const { root } = await fixture();
    const entered = deferred();
    const lifetime = deferred();
    const first = withNextBuildLock(
      "web",
      ".next-one",
      async () => {
        entered.release();
        await lifetime.promise;
      },
      { repositoryRoot: root },
    );
    await entered.promise;
    try {
      await expect(
        withNextBuildLock("web", ".next-one", async () => {}, { repositoryRoot: root }),
      ).rejects.toThrow(/busy.*PID/);
      await expect(
        withNextBuildLock("web", ".next-two", async () => "separate", { repositoryRoot: root }),
      ).resolves.toBe("separate");
    } finally {
      lifetime.release();
      await first;
    }
    expect(await locks(root)).toEqual([]);
  });

  it("serializes shared app compiler metadata even when output directories differ", async () => {
    const { root, options } = await fixture();
    const entered = deferred();
    const lifetime = deferred();
    const first = runNextBuild("web", {
      ...options,
      beforeBuild: async () => {
        entered.release();
        await lifetime.promise;
      },
    });
    await entered.promise;
    try {
      await expect(
        runNextBuild("web", {
          ...options,
          env: { ...options.env, OPENROUND_NEXT_DIST_DIR: ".next-second" },
        }),
      ).rejects.toThrow(/web-compiler/);
      await expect(runNextBuild("control", options)).resolves.toMatchObject({ code: 0 });
    } finally {
      lifetime.release();
      await first;
    }
    expect(await locks(root)).toEqual([]);
  });

  it.each([
    { OPENROUND_NEXT_DIST_DIR: "../../outside" },
    { OPENROUND_NEXT_DIST_DIR: ".next/child" },
    { OPENROUND_NEXT_DIST_DIR: ".next-unsafe!" },
    { OPENROUND_NEXT_DIST_DIR: ".next-fixture", PLAYWRIGHT_BUSINESS: "true" },
    { OPENROUND_BUILD_TIMEOUT_MS: "NaN" },
    { OPENROUND_BUILD_TIMEOUT_MS: "999" },
    { OPENROUND_BUILD_TIMEOUT_MS: "3600001" },
    { OPENROUND_BUILD_HEARTBEAT_MS: "99" },
    { OPENROUND_BUILD_HEARTBEAT_MS: "1.5" },
  ])(
    "rejects unsafe selectors and budgets before hooks or tracked file mutations: %j",
    async (env) => {
      const { root, options } = await fixture();
      const beforeBuild = vi.fn();
      await expect(runNextBuild("web", { ...options, env, beforeBuild })).rejects.toThrow();
      expect(beforeBuild).not.toHaveBeenCalled();
      await assertRestored(root);
      expect(await locks(root)).toEqual([]);
    },
  );

  it("rejects symlink outputs before hooks and leaves their target untouched", async () => {
    const { root, options } = await fixture();
    await mkdir(join(root, "outside"));
    await writeFile(join(root, "outside/sentinel"), "preserve");
    await symlink(join(root, "outside"), join(root, "apps/web/.next-fixture"));
    const beforeBuild = vi.fn();
    await expect(runNextBuild("web", { ...options, beforeBuild })).rejects.toThrow(/symbolic link/);
    expect(beforeBuild).not.toHaveBeenCalled();
    expect(await readFile(join(root, "outside/sentinel"), "utf8")).toBe("preserve");
    expect(await locks(root)).toEqual([]);
  });

  it("uses only the active generated types and preserves strict production exclusions", async () => {
    const hangupListeners = process.listeners("SIGHUP");
    const { root, options } = await fixture(`
      const fs = require('node:fs');
      fs.writeFileSync('observed-profile.json', fs.readFileSync('tsconfig.build.json'));
      fs.writeFileSync('next-env.d.ts', '// generated mutation');
    `);
    const afterBuild = vi.fn(async () => {
      await assertRestored(root);
      expect((await locks(root)).sort()).toEqual(["web-.next-fixture.json", "web-compiler.json"]);
      return "published after restoration";
    });
    await expect(runNextBuild("web", { ...options, afterBuild })).resolves.toBe(
      "published after restoration",
    );
    const profile = JSON.parse(
      await readFile(join(root, "apps/web/observed-profile.json"), "utf8"),
    );
    expect(profile.include).toEqual([
      "next-env.d.ts",
      "app/**/*.tsx",
      ".next-fixture/types/**/*.ts",
      ".next-fixture/dev/types/**/*.ts",
    ]);
    expect(profile.compilerOptions).toEqual({
      strict: true,
      noEmit: true,
      tsBuildInfoFile: ".next-fixture/cache/production.tsbuildinfo",
    });
    expect(profile.exclude).toEqual(JSON.parse(originalConfig.toString()).exclude);
    expect(afterBuild).toHaveBeenCalledOnce();
    await assertRestored(root);
    expect(await locks(root)).toEqual([]);
    expect(process.listeners("SIGHUP")).toEqual(hangupListeners);
  });

  it("propagates compiler exit status and restores files byte for byte on failure", async () => {
    const hangupListeners = process.listeners("SIGHUP");
    const { root, options } = await fixture(`
      require('node:fs').writeFileSync('next-env.d.ts', '// compiler mutation');
      require('node:fs').writeFileSync('tsconfig.build.json', '{}');
      process.exit(23);
    `);
    const afterBuild = vi.fn();
    await expect(runNextBuild("web", { ...options, afterBuild })).rejects.toMatchObject({
      exitCode: 23,
    });
    await assertRestored(root);
    expect(afterBuild).not.toHaveBeenCalled();
    expect(await locks(root)).toEqual([]);
    expect(process.listeners("SIGHUP")).toEqual(hangupListeners);
  });

  it.each(["beforeBuild", "afterBuild"])(
    "releases both locks after a %s hook failure",
    async (hook) => {
      const { root, options } = await fixture();
      await expect(
        runNextBuild("web", {
          ...options,
          [hook]: async () => {
            throw new Error("hook failed");
          },
        }),
      ).rejects.toThrow("hook failed");
      await assertRestored(root);
      expect(await locks(root)).toEqual([]);
      await expect(runNextBuild("web", options)).resolves.toMatchObject({ code: 0 });
    },
  );

  it("removes generated next-env when the tracked original did not exist", async () => {
    const { root, options } = await fixture(
      "require('node:fs').writeFileSync('next-env.d.ts', 'generated');",
    );
    await rm(join(root, "apps/web/next-env.d.ts"));
    await runNextBuild("web", options);
    await expect(readFile(join(root, "apps/web/next-env.d.ts"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("reports heartbeat phase and enforces a bounded deadline", async () => {
    const output = { write: vi.fn() };
    const started = Date.now();
    await expect(
      runBuildProcess(
        process.execPath,
        [
          "-e",
          "console.log('Checking validity of TypeScript'); process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)",
        ],
        {
          timeoutMs: 250,
          heartbeatMs: 50,
          killGraceMs: 50,
          output,
          errorOutput: sink,
        },
      ),
    ).rejects.toMatchObject({ exitCode: 124 });
    const log = output.write.mock.calls.map(([value]) => value.toString()).join("");
    expect(log).toMatch(/elapsed=.*phase=typecheck compilerPid=\d+/);
    expect(Date.now() - started).toBeLessThan(2500);
  });

  it.each([
    ["SIGINT", 130],
    ["SIGTERM", 143],
    ["SIGHUP", 129],
  ] as const)(
    "restores files and kills only owned descendants on %s",
    async (signal, exitCode) => {
      const { root, cli, options } = await fixture(`
      const { spawn } = require('node:child_process');
      const fs = require('node:fs');
      const child = spawn(process.execPath, ['-e', "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)"], { stdio: 'inherit' });
      fs.writeFileSync('next-env.d.ts', '// generated mutation');
      fs.writeFileSync('tsconfig.build.json', '{}');
      fs.writeFileSync('owned-pids.json', JSON.stringify([process.pid, child.pid]));
      process.on('SIGTERM', () => {});
      setInterval(() => {}, 1000);
    `);
      const wrapper = join(root, "wrapper.mjs");
      await writeFile(
        wrapper,
        `
      import { runNextBuild } from ${JSON.stringify(pathToFileURL(resolve("scripts/build/next.mjs")).href)};
      runNextBuild('web', {
        repositoryRoot: ${JSON.stringify(root)}, nextCliPath: ${JSON.stringify(cli)},
        env: ${JSON.stringify(options.env)}
      }).catch(error => { console.error(error.message); process.exitCode = error.exitCode ?? 1; });
    `,
      );
      const unrelated = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
        stdio: "ignore",
      });
      ownedPids.add(unrelated.pid!);
      const child = spawn(process.execPath, [wrapper], { stdio: "pipe" });
      ownedPids.add(child.pid!);
      let log = "";
      child.stderr.on("data", (chunk) => (log += chunk));
      const exited = new Promise<number | null>((done) => child.once("close", done));
      const pids = await waitFor(
        async () => {
          try {
            return JSON.parse(
              await readFile(join(root, "apps/web/owned-pids.json"), "utf8"),
            ) as number[];
          } catch {
            return [];
          }
        },
        (value) => value.length === 2,
      );
      pids.forEach((pid) => ownedPids.add(pid));
      child.kill(signal);
      expect(await exited).toBe(exitCode);
      expect(log).toContain(signal);
      await waitFor(async () => pids.every((pid) => !running(pid)), Boolean);
      expect(running(unrelated.pid!)).toBe(true);
      await assertRestored(root);
      expect(await locks(root)).toEqual([]);
    },
    20_000,
  );
});
