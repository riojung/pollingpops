import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { composeBuildArgv, run, validateBuildManifest } from "../../scripts/ops/lib.mjs";
import { main as productBuildMain } from "../../scripts/ops/product-build.mjs";

const root = resolve(import.meta.dirname, "../..");
const fixtures: string[] = [];

afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function temporaryDirectory(prefix: string) {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  fixtures.push(directory);
  return directory;
}

async function fakeImageTools() {
  const directory = await temporaryDirectory("polling-pops-component-images-");
  const calls = join(directory, "calls");
  for (const command of ["docker", "pnpm"]) {
    const path = join(directory, command);
    await writeFile(
      path,
      [
        "#!/bin/sh",
        `printf '%s\\n' '${command}'" $*" >> "$FAKE_IMAGE_CALLS"`,
        ...(command === "pnpm"
          ? [
              'case "$*" in',
              "  --version|check:docker-context) exit 0 ;;",
              '  *) echo "Unexpected host compilation" >&2; exit 97 ;;',
              "esac",
            ]
          : [
              'while [ "$#" -gt 0 ]; do',
              '  if [ "$1" = --metadata-file ]; then',
              "    shift",
              `    printf '%s\\n' '{"containerimage.digest":"sha256:${"a".repeat(64)}"}' > "$1"`,
              "  fi",
              "  shift",
              "done",
              "exit 0",
            ]),
        "",
      ].join("\n"),
    );
    await chmod(path, 0o755);
  }
  return {
    calls,
    env: {
      ...process.env,
      PATH: `${directory}:${process.env.PATH ?? ""}`,
      FAKE_IMAGE_CALLS: calls,
    },
  };
}

describe("component image builds", () => {
  it.each([undefined, "same-origin"])(
    "prepares production images with reviewed API routing %s and unchanged release bindings",
    async (apiRouting) => {
      const directory = await temporaryDirectory("polling-pops-hosted-images-");
      const tools = await fakeImageTools();
      await mkdir(join(directory, "scripts/ops"), { recursive: true });
      await mkdir(join(directory, "config/deploy"), { recursive: true });
      for (const filename of ["product-build.mjs", "lib.mjs"]) {
        await copyFile(
          join(root, "scripts/ops", filename),
          join(directory, "scripts/ops", filename),
        );
      }
      const config = JSON.parse(
        await readFile(join(root, "config/deploy/production.json"), "utf8"),
      );
      config.publicWebUrl = "https://app.openround.ca";
      config.publicApiUrl = "https://app.openround.ca";
      config.publicMediaUrl = "https://media.openround.ca";
      config.singleVm.host = "production-vm.openround.ca";
      if (apiRouting === undefined) delete config.apiRouting;
      else config.apiRouting = apiRouting;
      await writeFile(join(directory, "config/deploy/production.json"), JSON.stringify(config));
      await writeFile(join(directory, ".gitignore"), "artifacts/\n");
      for (const args of [
        ["init", "--quiet"],
        ["config", "user.name", "Polling Pops Test"],
        ["config", "user.email", "test@example.invalid"],
        ["add", "--all"],
        ["commit", "--quiet", "--no-gpg-sign", "--message", "reviewed image fixture"],
      ]) {
        await run("git", args, { cwd: directory, capture: true });
      }
      const buildId = (
        await run("git", ["rev-parse", "HEAD"], { cwd: directory, capture: true })
      ).stdout.trim();
      await run(
        process.execPath,
        [
          "scripts/ops/product-build.mjs",
          "production",
          "--api-url",
          config.publicApiUrl,
          "--registry",
          config.imageRepository,
          "--push",
          "--prepare",
        ],
        { cwd: directory, capture: true, env: tools.env },
      );
      const manifest = JSON.parse(
        await readFile(join(directory, "artifacts/deploy/production/build-manifest.json"), "utf8"),
      );
      expect(validateBuildManifest(manifest, { ...config, buildId, requireSigning: false })).toBe(
        manifest,
      );
      expect(manifest.apiRouting).toBe(apiRouting);
      expect(manifest.nextPublicApiUrl).toBe(
        apiRouting === "same-origin" ? "" : config.publicApiUrl,
      );
      expect(manifest.environment).toBe("production");
      expect(manifest.images.web.signed).toBe(false);
      expect(manifest.images.web.ref).toMatch(/@sha256:[a-f0-9]{64}$/);
      const calls = (await readFile(tools.calls, "utf8")).trim().split("\n");
      const webBuild = calls.find((call) => call.includes("--file apps/web/Dockerfile"));
      expect(webBuild).toContain(
        `--build-arg NEXT_PUBLIC_API_URL=${manifest.nextPublicApiUrl} --platform`,
      );
      expect(webBuild).toContain(`org.opencontainers.image.revision=${buildId}`);
      expect(webBuild).toContain("--provenance=mode=max --sbom=true --push");
    },
  );

  it.each([undefined, "server", "web", "control"])(
    "builds %s through Docker without a redundant host compiler",
    async (component) => {
      const tools = await fakeImageTools();
      const result = await run(
        process.execPath,
        [
          "scripts/ops/product-build.mjs",
          "development",
          ...(component ? ["--component", component] : []),
        ],
        { cwd: root, capture: true, env: tools.env },
      );
      const calls = (await readFile(tools.calls, "utf8")).trim().split("\n");
      expect(calls).toContain("pnpm check:docker-context");
      const builds = calls.filter((call) => call.includes(" build "));
      expect(builds).toEqual([`docker ${composeBuildArgv("core", { component }).join(" ")}`]);
      expect(builds[0]).not.toContain("jobs");
      expect(result.stdout).toContain("Built development");
    },
  );

  it.each(["staging", "production"])(
    "rejects partial %s releases before tools or hosted configuration are consulted",
    async (environment) => {
      await expect(
        productBuildMain([environment, "--component", "web", "--dry-run"]),
      ).rejects.toThrow("hosted builds require a complete release manifest");
    },
  );

  it.each(["jobs", "all", "--push", "web;server", ""])(
    "rejects unsupported image unit %s",
    async (component) => {
      expect(() => composeBuildArgv("core", { component })).toThrow(
        "API and jobs share the server image",
      );
      await expect(
        productBuildMain(["development", `--component=${component}`, "--dry-run"]),
      ).rejects.toThrow();
    },
  );

  it("keeps component image selection within each fixed Compose profile", () => {
    for (const profile of ["core", "media", "observability"]) {
      expect(composeBuildArgv(profile, { component: "server" }).slice(-2)).toEqual([
        "build",
        "server",
      ]);
      expect(composeBuildArgv(profile).slice(-4)).toEqual(["build", "server", "web", "control"]);
    }
  });

  it("keeps release markers after control compilation and shares the checked build runner", async () => {
    const [control, web, server] = await Promise.all(
      ["control", "web", "server"].map((component) =>
        readFile(join(root, "apps", component, "Dockerfile"), "utf8"),
      ),
    );
    expect(control.indexOf("ARG OPENROUND_BUILD_ID")).toBeGreaterThan(
      control.indexOf("RUN pnpm admin:build"),
    );
    for (const [component, dockerfile] of [
      ["control", control],
      ["web", web],
    ]) {
      expect(dockerfile.indexOf("COPY scripts/build scripts/build")).toBeLessThan(
        dockerfile.indexOf(`pnpm --filter @openround/${component} build`),
      );
      expect(dockerfile).toContain(`target=/app/apps/${component}/.next/cache,sharing=locked`);
    }
    expect(server).not.toMatch(/^COPY packages packages$/m);
  });
});

async function workspaceFixture({
  mounted = true,
  buildMounted = false,
  omitManifest = false,
  omitSource = false,
  frozen = true,
} = {}) {
  const directory = await temporaryDirectory("polling-pops-docker-inputs-");
  for (const [path, name, dependencies] of [
    ["apps/test", "@openround/test", { "@openround/shared": "workspace:*" }],
    ["packages/shared", "@openround/shared", { "@openround/transitive": "workspace:*" }],
    ["packages/transitive", "@openround/transitive", {}],
  ] as const) {
    await mkdir(join(directory, path), { recursive: true });
    await writeFile(join(directory, path, "package.json"), JSON.stringify({ name, dependencies }));
  }
  await writeFile(
    join(directory, "apps/test/Dockerfile"),
    [
      "FROM node:22-alpine AS build",
      "COPY apps/test/package.json apps/test/package.json",
      "COPY packages/shared/package.json packages/shared/package.json",
      ...(!omitManifest
        ? ["COPY packages/transitive/package.json packages/transitive/package.json"]
        : []),
      `RUN ${mounted ? "--mount=type=cache,id=test-pnpm,target=/pnpm/store,sharing=locked " : ""}pnpm install${frozen ? " --frozen-lockfile" : ""} --store-dir /pnpm/store`,
      "COPY apps/test apps/test",
      "COPY packages/shared packages/shared",
      ...(!omitSource ? ["COPY packages/transitive packages/transitive"] : []),
      `RUN ${buildMounted ? "--mount=type=cache,id=test-next,target=/app/apps/test/.next/cache,sharing=locked " : ""}pnpm --filter @openround/test build`,
      "",
    ].join("\n"),
  );
  return directory;
}

describe("Docker workspace closure with persistent stores", () => {
  it.each([false, true])("accepts complete frozen inputs with cache mount %s", async (mounted) => {
    const directory = await workspaceFixture({ mounted });
    const result = await run(
      process.execPath,
      [join(root, "scripts/check-docker-workspace-deps.mjs")],
      {
        cwd: directory,
        capture: true,
      },
    );
    expect(result.stdout).toContain("every transitive workspace dependency");
  });

  it("checks transitive inputs for a cache-mounted compiler too", async () => {
    const directory = await workspaceFixture({ buildMounted: true });
    await expect(
      run(process.execPath, [join(root, "scripts/check-docker-workspace-deps.mjs")], {
        cwd: directory,
        capture: true,
      }),
    ).resolves.toMatchObject({ stdout: expect.stringContaining("every transitive") });
    const incomplete = await workspaceFixture({ buildMounted: true, omitSource: true });
    await expect(
      run(process.execPath, [join(root, "scripts/check-docker-workspace-deps.mjs")], {
        cwd: incomplete,
        capture: true,
      }),
    ).rejects.toMatchObject({ exitCode: 1, stderr: expect.stringContaining("source before") });
  });

  it.each([
    { options: { omitManifest: true }, missing: "package.json before pnpm install" },
    { options: { omitSource: true }, missing: "transitive source before the build" },
    { options: { frozen: false }, missing: "install dependencies before its build step" },
  ])("rejects incomplete cache-mounted inputs: $missing", async ({ options, missing }) => {
    const directory = await workspaceFixture(options);
    await expect(
      run(process.execPath, [join(root, "scripts/check-docker-workspace-deps.mjs")], {
        cwd: directory,
        capture: true,
      }),
    ).rejects.toMatchObject({ exitCode: 1, stderr: expect.stringContaining(missing) });
  });
});
