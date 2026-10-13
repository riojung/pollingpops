import { chmod, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parse } from "yaml";
import { assertDockerReady, dockerContextArgv, run } from "../../scripts/ops/lib.mjs";

const root = resolve(import.meta.dirname, "../..");
const fixtures: string[] = [];

afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("Docker readiness preflight", () => {
  it("checks the CLI, Compose plugin, and daemon using one explicit context", async () => {
    const command = vi.fn().mockResolvedValue({ code: 0, stdout: "", stderr: "" });
    await assertDockerReady({ dockerContext: "colima-pollingpops", runCommand: command });
    expect(command.mock.calls.map(([, args]) => args)).toEqual([
      ["--version"],
      ["--context", "colima-pollingpops", "compose", "version"],
      ["--context", "colima-pollingpops", "info", "--format", "{{.ServerVersion}}"],
    ]);
    for (const [, , options] of command.mock.calls) {
      expect(options).toMatchObject({ capture: true, timeoutMs: 10_000 });
    }
  });

  it.each([
    { step: 1, message: "requires the Docker CLI" },
    { step: 2, message: "requires Docker Compose v2" },
    { step: 3, message: "cannot reach the Docker daemon" },
  ])("reports the failing dependency at step $step", async ({ step, message }) => {
    const command = vi.fn();
    for (let index = 1; index < step; index++) command.mockResolvedValueOnce({ code: 0 });
    command.mockRejectedValueOnce(new Error("private endpoint details"));
    await expect(assertDockerReady({ runCommand: command })).rejects.toThrow(message);
    expect(command).toHaveBeenCalledTimes(step);
  });

  it("gives safe macOS recovery steps without exposing captured endpoint details", async () => {
    const command = vi
      .fn()
      .mockResolvedValueOnce({ code: 0 })
      .mockResolvedValueOnce({ code: 0 })
      .mockRejectedValueOnce(new Error("private endpoint details"));
    const error = await assertDockerReady({
      platform: "darwin",
      dockerContext: "colima-pollingpops",
      runCommand: command,
    }).then(
      () => {
        throw new Error("Preflight unexpectedly succeeded");
      },
      (caught: Error) => caught,
    );
    expect(error.message).toContain("Source: local Docker runtime preflight");
    expect(error.message).toContain("open -a Docker");
    expect(error.message).toContain("colima start --profile YOUR_EXISTING_PROFILE");
    expect(error.message).toContain("docker --context colima-pollingpops info");
    expect(error.message).toContain("No services, volumes, or Docker contexts were changed");
    expect(error.message).not.toContain("private endpoint details");
  });

  it("does not require a daemon for dry runs but still validates context names", async () => {
    const command = vi.fn();
    await assertDockerReady({ dryRun: true, runCommand: command });
    expect(command).not.toHaveBeenCalled();
    expect(dockerContextArgv(undefined)).toEqual([]);
    for (const context of ["", "a", "--host=bad", "context;bad", "with spaces", "team+desktop\n"]) {
      expect(() => dockerContextArgv(context)).toThrow("must be a Docker context name");
    }
  });

  it.each(["default", "colima", "team+desktop", "Team_1.dev+staging", "a".repeat(129)])(
    "accepts Docker-valid context syntax without an arbitrary length limit: %s",
    (context) => {
      expect(dockerContextArgv(context)).toEqual(["--context", context]);
    },
  );

  it("bounds a hung diagnostic subprocess", async () => {
    await expect(
      run(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
        capture: true,
        timeoutMs: 100,
      }),
    ).rejects.toThrow("signal SIGTERM");
  });
});

async function fakeDocker() {
  const directory = await mkdtemp(join(tmpdir(), "polling-pops-service-test-"));
  fixtures.push(directory);
  const calls = join(directory, "calls");
  const executable = join(directory, "docker");
  await writeFile(
    executable,
    [
      "#!/bin/sh",
      'printf "%s\\n" "$*" >> "$FAKE_DOCKER_CALLS"',
      'if [ "$1" = "--version" ]; then exit 0; fi',
      'if [ "$1" = "--context" ]; then shift 2; fi',
      'if [ "$1" = "info" ] && [ "$FAKE_DOCKER_INFO_FAIL" = "1" ]; then exit 1; fi',
      "exit 0",
      "",
    ].join("\n"),
  );
  await chmod(executable, 0o755);
  return {
    calls,
    env: {
      ...process.env,
      PATH: `${directory}:${process.env.PATH ?? ""}`,
      FAKE_DOCKER_CALLS: calls,
      FAKE_DOCKER_INFO_FAIL: "0",
    },
  };
}

describe("Polling Pops development service", () => {
  it.each(["service", "product-build", "deploy"])(
    "runs the %s wrapper through a legacy checkout alias",
    async (name) => {
      const directory = await mkdtemp(join(tmpdir(), "polling-pops-checkout-alias-"));
      fixtures.push(directory);
      const alias = join(directory, "legacy checkout");
      await symlink(root, alias, "dir");
      const result = await run("bash", [join(alias, "scripts", `${name}.sh`), "--help"], {
        cwd: directory,
        capture: true,
      });
      expect(result.stdout).toContain("Usage:");
      expect(result.stderr).toBe("");
    },
  );

  it("executes a service dry run through a legacy checkout alias", async () => {
    const directory = await mkdtemp(join(tmpdir(), "polling-pops-checkout-alias-"));
    fixtures.push(directory);
    const alias = join(directory, "legacy checkout");
    await symlink(root, alias, "dir");
    const result = await run(
      "bash",
      [join(alias, "scripts/service.sh"), "development", "status", "--dry-run"],
      { cwd: directory, capture: true },
    );
    expect(result.stdout).toContain(
      "docker compose --project-name openround --file compose.yaml --file compose.business.yaml --file compose.local-control.yaml ps",
    );
  });

  it("fails before Compose changes services when the daemon is unavailable", async () => {
    const fixture = await fakeDocker();
    await expect(
      run(
        process.execPath,
        ["scripts/ops/service.mjs", "development", "restart", "--profile", "core"],
        {
          cwd: root,
          capture: true,
          env: { ...fixture.env, FAKE_DOCKER_INFO_FAIL: "1" },
        },
      ),
    ).rejects.toMatchObject({
      exitCode: 1,
      stderr: expect.stringContaining("Polling Pops cannot reach the Docker daemon"),
    });
    expect((await readFile(fixture.calls, "utf8")).trim().split("\n")).toEqual([
      "--version",
      "compose version",
      "info --format {{.ServerVersion}}",
    ]);
  });

  it.each(["colima-pollingpops", "team+desktop"])(
    "uses context %s for preflight and restart without changing global configuration",
    async (context) => {
      const fixture = await fakeDocker();
      await run(
        process.execPath,
        [
          "scripts/ops/service.mjs",
          "development",
          "restart",
          "--profile",
          "core",
          "--docker-context",
          context,
        ],
        { cwd: root, capture: true, env: fixture.env },
      );
      expect((await readFile(fixture.calls, "utf8")).trim().split("\n")).toEqual([
        "--version",
        `--context ${context} compose version`,
        `--context ${context} info --format {{.ServerVersion}}`,
        `--context ${context} compose --project-name openround --file compose.yaml --file compose.business.yaml --file compose.local-control.yaml up --detach --force-recreate --build --wait`,
      ]);
    },
  );

  it("rejects local context selection for hosted services before running Docker", async () => {
    const fixture = await fakeDocker();
    await expect(
      run(
        process.execPath,
        ["scripts/ops/service.mjs", "staging", "status", "--docker-context", "colima-pollingpops"],
        { cwd: root, capture: true, env: fixture.env },
      ),
    ).rejects.toMatchObject({ stderr: expect.stringContaining("development-only") });
    await expect(readFile(fixture.calls, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("brands application images while preserving existing data and multiwriter image sharing", async () => {
    const compose = parse(await readFile(join(root, "compose.yaml"), "utf8"));
    const multiwriter = parse(await readFile(join(root, "compose.multiwriter.yaml"), "utf8"));
    const development = JSON.parse(await readFile(join(root, "config/deploy/dev.json"), "utf8"));
    expect(development.imageRepository).toBe("polling-pops");
    expect(compose.name).toBe("openround");
    expect(compose.services.server.image).toBe("polling-pops-server:development");
    expect(compose.services.web.image).toBe("polling-pops-web:development");
    expect(multiwriter.services["server-secondary"].image).toBe(compose.services.server.image);
    expect(Object.keys(compose.volumes).sort()).toEqual([
      "minio-data",
      "postgres-data",
      "valkey-data",
    ]);
    expect(compose.services.postgres.environment.POSTGRES_DB).toBe("openround");
  });
});
