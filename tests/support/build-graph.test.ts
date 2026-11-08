import { execFileSync, spawnSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

type Task = {
  taskId: string;
  command: string;
  hash: string;
  inputs: Record<string, string>;
  resolvedTaskDefinition: {
    cache: boolean;
    env: string[];
    passThroughEnv: string[] | null;
    outputs: string[];
  };
};
type Graph = { tasks: Task[] };

const repository = resolve(import.meta.dirname, "../..");
const turbo = join(repository, "node_modules/.bin/turbo");
const packages = [
  "contracts",
  "control-plane",
  "db",
  "experience",
  "game-engine",
  "insights",
  "rehearsal",
];
const apps = ["web", "server", "control"];
let fixture: string;
let scripts: Record<string, string>;

async function put(path: string, content: string) {
  const file = join(fixture, path);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, content);
}

function dryRun(args: string[], env: Record<string, string> = {}): Graph {
  // Use only a local cache and a minimal environment: fixture secrets never reach a hash or log.
  const output = execFileSync(turbo, ["run", ...args, "--cache=local:rw", "--dry=json"], {
    cwd: fixture,
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      CI: "1",
      TURBO_TELEMETRY_DISABLED: "1",
      TURBO_NO_UPDATE_NOTIFIER: "1",
      ...env,
    },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return JSON.parse(output) as Graph;
}

function integrationEnvironment() {
  return {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    CI: "1",
    TURBO_TELEMETRY_DISABLED: "1",
    TURBO_NO_UPDATE_NOTIFIER: "1",
    TEST_DATABASE_ADMIN_URL: "fixture-admin-credential",
    TEST_DATABASE_URL: "fixture-runtime-credential",
    TEST_REDIS_URL: "fixture-cache-credential",
    IDEA_BOARD_PIPELINE_SECRET_KEY: "fixture-storage-credential",
    VITEST_MAX_WORKERS: "1",
  };
}

function scriptGraph(name: string) {
  const command = scripts[name]!;
  expect(command.startsWith("turbo run ")).toBe(true);
  return dryRun(command.slice("turbo run ".length).split(" "));
}

function graph(env?: Record<string, string>) {
  return dryRun(["build", "build:admin", "lint", "typecheck", "test", "test:coverage"], env);
}

function task(candidate: Graph, name: string): Task {
  const match = candidate.tasks.find((entry) => entry.taskId === name);
  expect(match, name).toBeDefined();
  return match!;
}

function executableTasks(candidate: Graph) {
  return candidate.tasks
    .filter((entry) => entry.command !== "<NONEXISTENT>")
    .map((entry) => entry.taskId)
    .sort();
}

async function whileChanged(path: string, check: () => void) {
  const file = join(fixture, path);
  const previous = await readFile(file, "utf8");
  try {
    await writeFile(file, `${previous}\n// changed input\n`);
    check();
  } finally {
    await writeFile(file, previous);
  }
}

describe("component build graph behavior", () => {
  beforeAll(async () => {
    fixture = await mkdtemp(join(tmpdir(), "pollingpops-build-graph-"));
    for (const file of [
      "package.json",
      "pnpm-lock.yaml",
      "pnpm-workspace.yaml",
      "turbo.json",
      "tsconfig.base.json",
      "eslint.config.mjs",
      "tsup.admin.config.ts",
      ".gitignore",
    ]) {
      await cp(join(repository, file), join(fixture, file));
    }
    scripts = JSON.parse(await readFile(join(fixture, "package.json"), "utf8")).scripts;
    for (const [directory, names] of [
      ["packages", packages],
      ["apps", apps],
    ] as const) {
      for (const name of names) {
        await put(`${directory}/${name}/src/index.ts`, "export const fixtureValue = 1;\n");
        await put(`${directory}/${name}/test/basic.test.ts`, "export const testValue = 1;\n");
        await cp(
          join(repository, directory, name, "package.json"),
          join(fixture, directory, name, "package.json"),
        );
      }
    }
    await cp(join(repository, "scripts/build"), join(fixture, "scripts/build"), {
      recursive: true,
    });
    for (const name of ["web", "control"]) {
      await cp(
        join(repository, "apps", name, "tsconfig.build.json"),
        join(fixture, "apps", name, "tsconfig.build.json"),
      );
    }
    await put("apps/web/public/fixture.svg", "<svg />\n");
    await put("apps/web/.next-fixture/compiled.js", "// Generated compiler output.\n");
    await put("packages/contracts/.next-fixture/generated.ts", "// Generated output.\n");
    await put("packages/db/src/query.sql", "select 1;\n");
    execFileSync("git", ["init", "--quiet"], { cwd: fixture, stdio: "pipe" });
    execFileSync("git", ["add", "."], { cwd: fixture, stdio: "pipe" });
  });

  afterAll(async () => {
    if (fixture) await rm(fixture, { recursive: true, force: true });
  });

  it("selects only deployable components by default and preserves optional library artifacts", () => {
    expect(executableTasks(scriptGraph("build"))).toEqual([
      "@openround/control#build",
      "@openround/control#build:admin",
      "@openround/server#build",
      "@openround/web#build",
    ]);
    for (const name of apps) {
      expect(executableTasks(scriptGraph(`build:${name}`))).toEqual([`@openround/${name}#build`]);
    }
    expect(executableTasks(scriptGraph("build:admin"))).toEqual(["@openround/control#build:admin"]);
    const artifacts = scriptGraph("build:packages");
    expect(executableTasks(artifacts)).toEqual(
      packages.map((name) => `@openround/${name}#build`).sort(),
    );
    expect(
      artifacts.tasks
        .filter((entry) => entry.command !== "<NONEXISTENT>")
        .every((entry) => entry.command.includes("--dts")),
    ).toBe(true);
    expect(scripts.build).toContain("--concurrency=2");
  }, 30_000);

  it("invalidates transitive consumers on source changes while keeping test changes out of compilation", async () => {
    const baseline = graph();
    await whileChanged("packages/contracts/src/index.ts", () => {
      const changed = graph();
      for (const name of apps) {
        for (const operation of ["build", "lint", "typecheck", "test"]) {
          const id = `@openround/${name}#${operation}`;
          expect(task(changed, id).hash, id).not.toBe(task(baseline, id).hash);
        }
      }
      expect(task(changed, "@openround/control#build:admin").hash).not.toBe(
        task(baseline, "@openround/control#build:admin").hash,
      );
    });
    await whileChanged("packages/contracts/test/basic.test.ts", () => {
      const changed = graph();
      for (const name of [...apps, ...packages]) {
        const id = `@openround/${name}#build`;
        expect(task(changed, id).hash, id).toBe(task(baseline, id).hash);
      }
      expect(task(changed, "@openround/contracts#transit").hash).toBe(
        task(baseline, "@openround/contracts#transit").hash,
      );
      for (const operation of ["lint", "typecheck", "test"]) {
        const id = `@openround/contracts#${operation}`;
        expect(task(changed, id).hash, id).not.toBe(task(baseline, id).hash);
      }
    });
    await whileChanged("apps/web/test/basic.test.ts", () => {
      const changed = graph();
      expect(task(changed, "@openround/web#build").hash).toBe(
        task(baseline, "@openround/web#build").hash,
      );
      for (const operation of ["lint", "typecheck", "test"]) {
        const id = `@openround/web#${operation}`;
        expect(task(changed, id).hash, id).not.toBe(task(baseline, id).hash);
      }
    });
  }, 30_000);

  it("tracks shared compiler/linter configuration, build helpers, and required runtime assets", async () => {
    const baseline = graph();
    for (const path of [
      "tsconfig.base.json",
      "scripts/build/next.mjs",
      "scripts/build/next-config.mjs",
      "scripts/build/next-config.d.mts",
    ]) {
      await whileChanged(path, () => {
        const changed = graph();
        for (const name of apps) {
          const id = `@openround/${name}#build`;
          expect(task(changed, id).hash, `${path}: ${id}`).not.toBe(task(baseline, id).hash);
        }
        if (path.endsWith(".d.mts"))
          for (const name of ["web", "control"]) {
            const id = `@openround/${name}#typecheck`;
            expect(task(changed, id).hash, `${path}: ${id}`).not.toBe(task(baseline, id).hash);
          }
      });
    }
    await whileChanged("apps/web/tsconfig.build.json", () => {
      const changed = graph();
      expect(task(changed, "@openround/web#build").hash).not.toBe(
        task(baseline, "@openround/web#build").hash,
      );
      expect(task(changed, "@openround/control#build").hash).toBe(
        task(baseline, "@openround/control#build").hash,
      );
    });
    await whileChanged("eslint.config.mjs", () => {
      const changed = graph();
      expect(task(changed, "@openround/web#lint").hash).not.toBe(
        task(baseline, "@openround/web#lint").hash,
      );
      expect(task(changed, "@openround/web#build").hash).toBe(
        task(baseline, "@openround/web#build").hash,
      );
    });
    await whileChanged("apps/web/public/fixture.svg", () => {
      expect(task(graph(), "@openround/web#build").hash).not.toBe(
        task(baseline, "@openround/web#build").hash,
      );
    });
    await whileChanged("packages/db/src/query.sql", () => {
      const changed = graph();
      for (const id of ["@openround/server#build", "@openround/control#build:admin"]) {
        expect(task(changed, id).hash, id).not.toBe(task(baseline, id).hash);
      }
      expect(task(changed, "@openround/web#build").hash).toBe(
        task(baseline, "@openround/web#build").hash,
      );
    });
    await whileChanged("tsup.admin.config.ts", () => {
      expect(task(graph(), "@openround/control#build:admin").hash).not.toBe(
        task(baseline, "@openround/control#build:admin").hash,
      );
    });
    for (const path of [
      "apps/web/.next-fixture/compiled.js",
      "packages/contracts/.next-fixture/generated.ts",
    ]) {
      await whileChanged(path, () => {
        const changed = graph();
        for (const id of ["@openround/web#build", "@openround/contracts#transit"]) {
          expect(task(changed, id).hash, `${path}: ${id}`).toBe(task(baseline, id).hash);
        }
      });
    }
  }, 30_000);

  it("hashes public build inputs and variants without hashing resource budgets or integration credentials", () => {
    const baseline = graph();
    for (const [name, value] of Object.entries({
      NEXT_PUBLIC_FIXTURE_URL: "https://public.invalid",
      OPENROUND_BUILD_ID: "fixture-revision",
      OPENROUND_NEXT_DIST_DIR: ".next-fixture",
      PLAYWRIGHT_BUSINESS: "true",
      PLAYWRIGHT_CONTROL: "true",
      CANVAS_COLLAB_DIST_DIR: ".next-canvas-capacity-fixture",
    })) {
      const changed = graph({ [name]: value });
      for (const app of ["web", "control"]) {
        const id = `@openround/${app}#build`;
        expect(task(changed, id).hash, name).not.toBe(task(baseline, id).hash);
      }
    }
    const resources = graph({
      OPENROUND_BUILD_TIMEOUT_MS: "120000",
      OPENROUND_BUILD_HEARTBEAT_MS: "5000",
    });
    expect(task(resources, "@openround/web#build").hash).toBe(
      task(baseline, "@openround/web#build").hash,
    );
    const integrations = graph({
      TEST_DATABASE_ADMIN_URL: "fixture-admin-credential",
      TEST_DATABASE_URL: "fixture-runtime-credential",
      TEST_REDIS_URL: "fixture-cache-credential",
      IDEA_BOARD_PIPELINE_SECRET_KEY: "fixture-storage-credential",
    });
    for (const name of ["db", "server"]) {
      for (const operation of ["test", "test:coverage"]) {
        const id = `@openround/${name}#${operation}`;
        const integrationTask = task(integrations, id);
        expect(integrationTask.resolvedTaskDefinition.cache, id).toBe(false);
        expect(integrationTask.resolvedTaskDefinition.passThroughEnv).toContain(
          "TEST_DATABASE_URL",
        );
        expect(integrationTask.resolvedTaskDefinition.env).toContain("VITEST_MAX_WORKERS");
        expect(integrationTask.hash, id).toBe(task(baseline, id).hash);
      }
    }
    for (const name of ["web", "control"]) {
      const next = task(baseline, `@openround/${name}#build`).resolvedTaskDefinition;
      expect(next.cache).toBe(false);
      expect(next.outputs).toEqual([]);
    }
    expect(task(baseline, "@openround/control#build:admin").resolvedTaskDefinition.outputs).toEqual(
      ["admin-dist/**"],
    );
  }, 30_000);

  it("passes integration credentials to uncached child tasks and rejects an unconfigured integration command", async () => {
    const keys = [
      "TEST_DATABASE_ADMIN_URL",
      "TEST_DATABASE_URL",
      "TEST_REDIS_URL",
      "IDEA_BOARD_PIPELINE_SECRET_KEY",
      "VITEST_MAX_WORKERS",
    ];
    // Replace fixture test commands with tiny Node probes; no application test or compiler runs.
    const probe = `node -e "require('node:fs').writeFileSync('integration-env.json', JSON.stringify(${JSON.stringify(keys).replaceAll('"', "'")}.map(key => Boolean(process.env[key]))))"`;
    for (const path of ["packages/db/package.json", "apps/server/package.json"]) {
      const manifest = JSON.parse(await readFile(join(fixture, path), "utf8"));
      manifest.scripts.test = probe;
      await put(path, JSON.stringify(manifest));
    }
    const result = spawnSync(
      turbo,
      ["run", "test", "--filter=@openround/db", "--filter=@openround/server", "--cache=local:rw"],
      { cwd: fixture, env: integrationEnvironment(), encoding: "utf8" },
    );
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    for (const path of ["packages/db/integration-env.json", "apps/server/integration-env.json"]) {
      expect(JSON.parse(await readFile(join(fixture, path), "utf8"))).toEqual(keys.map(() => true));
    }
    expect(`${result.stdout}\n${result.stderr}`).not.toContain("fixture-runtime-credential");
    const unconfigured = spawnSync("pnpm", ["test:integration"], {
      cwd: fixture,
      env: { PATH: process.env.PATH, HOME: process.env.HOME, CI: "1" },
      encoding: "utf8",
    });
    expect(unconfigured.status).toBe(1);
    expect(unconfigured.stderr).toContain(
      "TEST_DATABASE_ADMIN_URL is required for test:integration",
    );
  }, 30_000);
});
