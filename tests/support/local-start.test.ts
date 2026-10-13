import { mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { childEnvironment, colimaHome, main } from "../../scripts/ops/local-start.mjs";
import { run } from "../../scripts/ops/lib.mjs";

const root = resolve(import.meta.dirname, "../..");
const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});

function fixture({
  profileName = "default",
  listAsArray = false,
  status = "Stopped",
  readyAt = 3,
  runtime = "docker",
  contextHost = "unix:///test-user/.colima/default/docker.sock",
} = {}) {
  let time = 0;
  let probes = 0;
  const environment = {
    PATH: process.env.PATH,
    HOME: "/test-user",
    DOCKER_HOST: "unix:///stale",
    DOCKER_CONTEXT: "other-runtime",
    DOCKER_TLS_VERIFY: "1",
    DOCKER_CERT_PATH: "/private/certs",
    DOCKER_API_VERSION: "1.54",
    FEATURE_SURVEYS: "true",
  };
  const command = vi.fn(async (program: string, args: string[], _options?: object) => {
    if (program === "colima" && args[0] === "list") {
      const profiles = [
        { name: profileName, status, ...(status === "Running" ? { runtime } : {}) },
        { name: "another-app", status: "Running", runtime: "docker" },
      ];
      return {
        code: 0,
        stderr: "",
        stdout: listAsArray
          ? JSON.stringify(profiles)
          : profiles.map((profile) => JSON.stringify(profile)).join("\n"),
      };
    }
    if (program === "docker" && args[0] === "context")
      return { code: 0, stderr: "", stdout: JSON.stringify(contextHost) };
    if (program === "docker" && args.includes("info")) {
      if (++probes < readyAt) throw new Error("private socket diagnostics");
      return { code: 0, stdout: "29.2.1", stderr: "" };
    }
    return { code: 0, stdout: "", stderr: "" };
  });
  const dependencies = {
    environment,
    homeDirectory: "/test-user",
    runCommand: command,
    readFile: vi.fn(async () => `runtime: ${runtime}\n`),
    directoryExists: vi.fn(async (path: string) => path === "/test-user/.colima"),
    log: vi.fn(),
    now: () => time,
    sleep: vi.fn(async (ms: number) => {
      time += ms;
    }),
  };
  return {
    command,
    dependencies,
    environment,
    runtimeCalls: () =>
      command.mock.calls.filter(
        ([program, args]) => program === "colima" && ["start", "stop"].includes(args[0]!),
      ),
    serviceCalls: () => command.mock.calls.filter(([program]) => program === process.execPath),
  };
}

describe("post-reboot local startup", () => {
  it("starts the existing stopped default VM, waits for Docker, then delegates to safe service control", async () => {
    const f = fixture();
    await main([], f.dependencies);
    expect(f.runtimeCalls().map(([, args]) => args)).toEqual([
      [
        "start",
        "--profile",
        "default",
        "--activate=false",
        "--save-config=false",
        "--ssh-config=false",
      ],
    ]);
    expect(f.dependencies.sleep).toHaveBeenCalledOnce();
    expect(f.serviceCalls()).toHaveLength(1);
    expect(f.serviceCalls()[0]![1]).toEqual([
      join(root, "scripts/ops/service.mjs"),
      "development",
      "start",
      "--profile",
      "core",
      "--docker-context",
      "colima",
    ]);
    for (const [, , options] of f.command.mock.calls) {
      const env = (options as { env: Record<string, string> }).env;
      expect(env.FEATURE_SURVEYS).toBe("true");
      expect(env).not.toHaveProperty("DOCKER_HOST");
      expect(env).not.toHaveProperty("DOCKER_CONTEXT");
      expect(env).not.toHaveProperty("DOCKER_TLS_VERIFY");
      expect(env).not.toHaveProperty("DOCKER_CERT_PATH");
      expect(env).not.toHaveProperty("DOCKER_API_VERSION");
    }
    expect(f.environment.DOCKER_CONTEXT).toBe("other-runtime");
    expect(f.dependencies.log.mock.calls.flat().join("\n")).toContain(
      "management console: http://localhost:3002",
    );
  });
  it("does not restart a healthy VM, even when recovery is permitted", async () => {
    const f = fixture({ status: "Running", readyAt: 1 });
    await main(
      ["--restart-runtime", "--restart", "--no-build", "--profile", "media"],
      f.dependencies,
    );
    expect(f.runtimeCalls()).toEqual([]);
    expect(f.serviceCalls()[0]![1]).toContain("restart");
    expect(f.serviceCalls()[0]![1]).toContain("media");
    expect(f.serviceCalls()[0]![1]).toContain("--no-build");
  });
  it("selects a custom existing profile with its matching context and accepts an array profile list", async () => {
    const f = fixture({
      profileName: "learning",
      listAsArray: true,
      contextHost: "unix:///test-user/.colima/learning/docker.sock",
    });
    await main(["--colima-profile", "learning"], f.dependencies);
    expect(f.runtimeCalls()[0]![1]).toContain("learning");
    expect(f.dependencies.readFile).toHaveBeenCalledWith(
      "/test-user/.colima/learning/colima.yaml",
      "utf8",
    );
    expect(f.serviceCalls()[0]![1]).toContain("colima-learning");
    expect(f.runtimeCalls().some(([, args]) => args.includes("default"))).toBe(false);
  });
  it("supports an explicitly selected context alias for the same profile", async () => {
    const f = fixture({ status: "Running", readyAt: 1 });
    await main(["--docker-context", "local-learning"], f.dependencies);
    expect(f.serviceCalls()[0]![1]).toContain("local-learning");
    expect(f.command.mock.calls.some(([, args]) => args.includes("colima"))).toBe(false);
  });
  it("waits for an already starting daemon without stopping other containers", async () => {
    const f = fixture({ status: "Running" });
    await main([], f.dependencies);
    expect(f.runtimeCalls()).toEqual([]);
    expect(f.serviceCalls()).toHaveLength(1);
    expect(f.dependencies.sleep).toHaveBeenCalledOnce();
  });
  it("fails with a bounded timeout and never starts products or restarts a running VM implicitly", async () => {
    const f = fixture({ status: "Running", readyAt: Infinity });
    await expect(main(["--wait-seconds", "2"], f.dependencies)).rejects.toThrow(
      "--restart-runtime",
    );
    expect(f.runtimeCalls()).toEqual([]);
    expect(f.serviceCalls()).toEqual([]);
    expect(f.dependencies.sleep).toHaveBeenCalledTimes(2);
  });
  it("cycles the same unhealthy running VM only with explicit permission", async () => {
    const f = fixture({ status: "Running", readyAt: 2 });
    await main(["--restart-runtime"], f.dependencies);
    expect(f.runtimeCalls().map(([, args]) => args[0])).toEqual(["stop", "start"]);
    expect(f.runtimeCalls().every(([, args]) => args.includes("default"))).toBe(true);
    expect(f.serviceCalls()).toHaveLength(1);
  });
  it("prints a non-mutating dry-run plan for a stopped profile", async () => {
    const f = fixture({ readyAt: Infinity });
    await main(["--dry-run", "--restart", "--no-build"], f.dependencies);
    expect(f.runtimeCalls()).toEqual([]);
    expect(f.serviceCalls()).toEqual([]);
    const output = f.dependencies.log.mock.calls.flat().join("\n");
    expect(output).toContain("colima start --profile default --activate=false");
    expect(output).toContain("--project-name openround");
    expect(output).toContain("--file compose.business.yaml --file compose.local-control.yaml");
    expect(output).toContain("--force-recreate --no-build --wait");
    expect(output).not.toContain("other-runtime");
  });
  it.each(["unix:///test-user/.colima/another-app/docker.sock", "tcp://remote.example:2375"])(
    "rejects a mismatched/remote endpoint before probing or changing a runtime: %s",
    async (contextHost) => {
      const f = fixture({ contextHost });
      await expect(main([], f.dependencies)).rejects.toThrow(
        "does not point to the selected Colima profile",
      );
      expect(f.command.mock.calls.some(([, args]) => args.includes("info"))).toBe(false);
      expect(f.runtimeCalls()).toEqual([]);
      expect(f.serviceCalls()).toEqual([]);
    },
  );
  it("never creates a missing profile or silently uses the other running VM", async () => {
    const f = fixture();
    await expect(main(["--colima-profile", "missing"], f.dependencies)).rejects.toThrow(
      "no new profile will be created",
    );
    expect(f.runtimeCalls()).toEqual([]);
    expect(f.dependencies.readFile).not.toHaveBeenCalled();
  });
  it("does not change a containerd profile to Docker", async () => {
    const f = fixture({ runtime: "containerd" });
    await expect(main([], f.dependencies)).rejects.toThrow("not confirmed as Docker-backed");
    expect(f.runtimeCalls()).toEqual([]);
  });
  it("keeps application failures distinct from runtime startup failures", async () => {
    const f = fixture({ status: "Running", readyAt: 1 });
    const original = f.command.getMockImplementation()!;
    f.command.mockImplementation(async (program, args, options) => {
      if (program === process.execPath) throw new Error("private application diagnostics");
      return original(program, args, options);
    });
    await expect(main([], f.dependencies)).rejects.toThrow("Source: Compose/application startup");
    expect(f.runtimeCalls()).toEqual([]);
  });
  it("does not proceed after Colima fails to start", async () => {
    const f = fixture();
    const original = f.command.getMockImplementation()!;
    f.command.mockImplementation(async (program, args, options) => {
      if (program === "colima" && args[0] === "start")
        throw new Error("private runtime diagnostics");
      return original(program, args, options);
    });
    await expect(main([], f.dependencies)).rejects.toThrow("Source: runtime startup");
    expect(f.serviceCalls()).toEqual([]);
  });
  it.each(["docker", "compose"])(
    "fails prerequisite checks before starting any runtime when %s is unavailable",
    async (missing) => {
      const f = fixture();
      const original = f.command.getMockImplementation()!;
      f.command.mockImplementation(async (program, args, options) => {
        if (
          program === "docker" &&
          ((missing === "docker" && args[0] === "--version") ||
            (missing === "compose" && args.includes("compose")))
        )
          throw new Error("missing tool");
        return original(program, args, options);
      });
      await expect(main([], f.dependencies)).rejects.toThrow("required");
      expect(f.runtimeCalls()).toEqual([]);
      expect(f.serviceCalls()).toEqual([]);
    },
  );
  it("revalidates the endpoint after runtime startup and refuses a remapped context", async () => {
    const f = fixture({ readyAt: 2 });
    const original = f.command.getMockImplementation()!;
    let contextReads = 0;
    f.command.mockImplementation(async (program, args, options) => {
      if (program === "docker" && args[0] === "context" && ++contextReads > 1)
        return {
          code: 0,
          stdout: JSON.stringify("unix:///test-user/.colima/another-app/docker.sock"),
          stderr: "",
        };
      return original(program, args, options);
    });
    await expect(main([], f.dependencies)).rejects.toThrow("does not point");
    expect(f.runtimeCalls()).toHaveLength(1);
    expect(f.serviceCalls()).toEqual([]);
  });
  it.each([
    ["--colima-profile", "../other"],
    ["--profile", "default"],
    ["--docker-context", "--host=remote"],
    ["--wait-seconds", "0"],
    ["--wait-seconds", "901"],
    ["production"],
  ])("rejects unsafe/unsupported inputs before executing commands: %j", async (...args) => {
    const f = fixture();
    await expect(main(args, f.dependencies)).rejects.toThrow();
    expect(f.command).not.toHaveBeenCalled();
  });
  it("chooses an existing Colima directory without creating or guessing another one", async () => {
    const exists = vi.fn(async (path: string) => path === "/test-user/.config/colima");
    expect(await colimaHome({}, "/test-user", exists)).toBe("/test-user/.config/colima");
    await expect(colimaHome({ COLIMA_HOME: "/missing" }, "/test-user", exists)).rejects.toThrow(
      "existing directory",
    );
    expect(childEnvironment({ DOCKER_HOST: "stale", OTHER: "preserved" })).toEqual({
      OTHER: "preserved",
    });
  });
  it("runs --help through the legacy checkout symlink without requiring a daemon", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pollingpops-local-start-test-"));
    directories.push(directory);
    const alias = join(directory, "legacy checkout");
    await symlink(root, alias, "dir");
    const result = await run(
      process.execPath,
      [join(alias, "scripts/ops/local-start.mjs"), "--help"],
      { cwd: directory, capture: true },
    );
    expect(result.stdout).toContain("Usage: pnpm local:start");
    expect(result.stderr).toBe("");
  });
});
