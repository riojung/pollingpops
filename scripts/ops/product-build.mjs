#!/usr/bin/env node

import { mkdtemp, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath, URL } from "node:url";
import {
  assertCommandAvailable,
  assertDockerReady,
  assertConfiguredHostedTarget,
  assertFullGitSha,
  assertPathWithin,
  composeBuildArgv,
  extractBuildxDigest,
  isHostedEnvironment,
  parseCliArguments,
  readStrictJson,
  resolveEnvironmentArgument,
  run,
  validateBuildManifest,
  validateDeployConfig,
} from "./lib.mjs";

const repositoryRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const hostBuildGeneratedFiles = [join(repositoryRoot, "apps", "web", "next-env.d.ts")];

function usage() {
  return `Usage: scripts/product-build.sh <environment> [--manifest PATH] [--sign] [--prepare | --finalize] [--dry-run]
       scripts/product-build.sh --environment <environment> [options]

Build environments: development (or dev), staging, production.
Hosted builds require --api-url HTTPS, --registry REPOSITORY, and --push.
The reviewed staging and production targets require signed images.`;
}

async function gitOutput(args) {
  return (await run("git", args, { cwd: repositoryRoot, capture: true })).stdout.trim();
}

async function assertCleanHostedWorktree() {
  const dirty = await gitOutput(["status", "--porcelain=v1", "--untracked-files=all"]);
  if (dirty) throw new Error("Hosted images must be built from a clean working tree");
}

export async function withPreservedFiles(paths, operation) {
  const snapshots = await Promise.all(
    paths.map(async (path) => {
      try {
        return { path, content: await readFile(path) };
      } catch (error) {
        if (error.code === "ENOENT") return { path, content: undefined };
        throw error;
      }
    }),
  );
  try {
    return await operation();
  } finally {
    await Promise.all(
      snapshots.map(({ path, content }) =>
        content === undefined ? rm(path, { force: true }) : writeFile(path, content),
      ),
    );
  }
}

async function loadConfig(environment) {
  const path = join(
    repositoryRoot,
    "config",
    "deploy",
    `${environment === "development" ? "dev" : environment}.json`,
  );
  return await readStrictJson(path, validateDeployConfig, environment);
}

function hostedBuildInputs(parsed, environment, config, { finalize = false } = {}) {
  if (!isHostedEnvironment(environment)) {
    if (
      parsed.flags.has("push") ||
      parsed.flags.has("sign") ||
      parsed.flags.has("prepare") ||
      parsed.flags.has("finalize") ||
      parsed.values.has("registry") ||
      parsed.values.has("api-url") ||
      parsed.values.has("manifest")
    ) {
      throw new Error(
        "--push, --sign, --prepare, --finalize, --registry, --api-url, and --manifest are hosted-build options",
      );
    }
    return config;
  }
  if (finalize && parsed.flags.has("push")) throw new Error("--finalize does not accept --push");
  if (!finalize && !parsed.flags.has("push")) {
    throw new Error("Hosted builds require explicit --push");
  }
  const publicApiUrl = parsed.values.get("api-url");
  const imageRepository = parsed.values.get("registry");
  if (!publicApiUrl || !imageRepository) {
    throw new Error("Hosted builds require --api-url and --registry");
  }
  const url = new URL(publicApiUrl);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      "--api-url must be a credential-free HTTPS URL origin without a path, query, or fragment",
    );
  }
  const normalizedApiUrl = url.origin;
  if (normalizedApiUrl !== config.publicApiUrl) {
    throw new Error("--api-url must exactly match the reviewed target configuration");
  }
  if (imageRepository !== config.imageRepository) {
    throw new Error("--registry must exactly match the reviewed target configuration");
  }
  return config;
}

function buildArguments({ component, config, buildId, tag, metadataPath, hosted }) {
  const args = [
    "buildx",
    "build",
    "--file",
    `apps/${component}/Dockerfile`,
    "--build-arg",
    `OPENROUND_BUILD_ID=${buildId}`,
    "--label",
    `org.opencontainers.image.revision=${buildId}`,
    "--tag",
    tag,
  ];
  if (component === "web") {
    args.push("--build-arg", `NEXT_PUBLIC_API_URL=${config.publicApiUrl}`);
  }
  if (hosted) {
    args.push(
      "--platform",
      config.imagePlatform,
      "--metadata-file",
      metadataPath,
      "--provenance=mode=max",
      "--sbom=true",
      "--push",
    );
  } else {
    args.push("--load");
  }
  args.push(".");
  return args;
}

async function writeManifest(
  path,
  manifest,
  { requireSigning = manifest.environment === "production" } = {},
) {
  validateBuildManifest(manifest, {
    environment: manifest.environment,
    buildId: manifest.buildId,
    imageRepository: manifest.images.server.repository.replace(/-server$/, ""),
    imagePlatform: manifest.imagePlatform,
    publicApiUrl: manifest.nextPublicApiUrl,
    requireSigning,
  });
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.tmp-${process.pid}`;
  await writeFile(temporaryPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o644 });
  await rename(temporaryPath, path);
}

export async function scanImagesForVulnerabilities(imageRecords, runCommand = run) {
  const failures = [];
  for (const component of Object.keys(imageRecords)) {
    try {
      await runCommand(
        "trivy",
        [
          "image",
          "--scanners",
          "vuln",
          "--severity",
          "HIGH,CRITICAL",
          "--exit-code",
          "1",
          "--no-progress",
          imageRecords[component].ref,
        ],
        { cwd: repositoryRoot },
      );
    } catch (error) {
      failures.push({ component, error });
    }
  }
  if (failures.length > 0) {
    throw new AggregateError(
      failures.map(({ error }) => error),
      `Vulnerability scan failed for ${failures.map(({ component }) => component).join(", ")}`,
    );
  }
}

export async function finalizeImages(imageRecords, { config, shouldSign, runCommand = run }) {
  if (config.requireSigning) {
    await scanImagesForVulnerabilities(imageRecords, runCommand);
  }

  if (shouldSign) {
    for (const component of Object.keys(imageRecords)) {
      await runCommand("cosign", ["sign", "--yes", imageRecords[component].ref], {
        cwd: repositoryRoot,
      });
    }
  }

  if (config.requireSigning) {
    for (const component of Object.keys(imageRecords)) {
      await runCommand(
        "cosign",
        [
          "verify",
          "--certificate-identity-regexp",
          config.cosignIdentityRegexp,
          "--certificate-oidc-issuer",
          config.cosignOidcIssuer,
          imageRecords[component].ref,
        ],
        { cwd: repositoryRoot },
      );
    }
  }

  for (const component of Object.keys(imageRecords)) {
    imageRecords[component].signed = shouldSign;
  }
}

export async function main(argv = process.argv.slice(2)) {
  const parsed = parseCliArguments(argv, {
    valueOptions: ["environment", "manifest", "api-url", "registry"],
    booleanOptions: ["sign", "push", "prepare", "finalize", "dry-run", "help"],
  });
  if (parsed.flags.has("help")) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  if (parsed.positionals.length > 1) throw new Error("Too many positional arguments");
  const environment = resolveEnvironmentArgument(parsed);
  const dryRun = parsed.flags.has("dry-run");
  const prepare = parsed.flags.has("prepare");
  const finalize = parsed.flags.has("finalize");
  if (prepare && finalize) throw new Error("--prepare and --finalize are mutually exclusive");
  if ((prepare || finalize) && environment !== "production") {
    throw new Error("--prepare and --finalize are production-only options");
  }
  if (finalize && dryRun) throw new Error("--finalize does not support --dry-run");
  const config = hostedBuildInputs(parsed, environment, await loadConfig(environment), {
    finalize,
  });
  const hosted = isHostedEnvironment(environment);
  const manifestOutputPath = hosted
    ? assertPathWithin(
        resolve(
          repositoryRoot,
          parsed.values.get("manifest") ?? `artifacts/deploy/${environment}/build-manifest.json`,
        ),
        join(repositoryRoot, "artifacts", "deploy", environment),
        "build manifest output",
      )
    : undefined;
  if (hosted) assertConfiguredHostedTarget(config);

  await assertCommandAvailable("git", { cwd: repositoryRoot, dryRun: false });
  const buildId = assertFullGitSha(await gitOutput(["rev-parse", "--verify", "HEAD"]));
  if (hosted) await assertCleanHostedWorktree();

  const shouldSign = config.requireSigning || parsed.flags.has("sign");
  if (config.requireSigning && !shouldSign) throw new Error("Production builds require signing");
  if (!prepare && shouldSign) {
    await assertCommandAvailable("cosign", { cwd: repositoryRoot, dryRun });
  }
  if (!prepare && config.requireSigning) {
    await assertCommandAvailable("trivy", { cwd: repositoryRoot, dryRun });
  }

  if (finalize) {
    const manifest = await readStrictJson(manifestOutputPath, validateBuildManifest, {
      environment,
      buildId,
      imageRepository: config.imageRepository,
      imagePlatform: config.imagePlatform,
      publicApiUrl: config.publicApiUrl,
      requireSigning: false,
      requireControl: config.singleVm?.composeFiles.includes("compose.single-vm.business.yaml"),
    });
    for (const component of Object.keys(manifest.images)) {
      if (manifest.images[component].signed) {
        throw new Error(`images.${component} is already recorded as signed`);
      }
    }
    await finalizeImages(manifest.images, { config, shouldSign });
    await writeManifest(manifestOutputPath, manifest);
    process.stdout.write(`Build manifest: ${manifestOutputPath}\n`);
    return;
  }

  if (hosted) {
    await assertCommandAvailable("docker", { cwd: repositoryRoot, dryRun });
  } else {
    await assertDockerReady({ cwd: repositoryRoot, dryRun });
  }
  if (hosted) {
    await run("docker", ["buildx", "version"], {
      cwd: repositoryRoot,
      capture: !dryRun,
      dryRun,
    });
  }
  await assertCommandAvailable("pnpm", { cwd: repositoryRoot, dryRun });

  const publicApiBuildValue = hosted ? config.publicApiUrl : "";
  const buildEnvironment = {
    ...process.env,
    NEXT_PUBLIC_API_URL: publicApiBuildValue,
    OPENROUND_BUILD_ID: buildId,
  };
  await run("pnpm", ["check:docker-context"], {
    cwd: repositoryRoot,
    dryRun,
    env: buildEnvironment,
  });
  await withPreservedFiles(hostBuildGeneratedFiles, async () => {
    await run("pnpm", ["build"], { cwd: repositoryRoot, dryRun, env: buildEnvironment });
  });
  if (hosted) await assertCleanHostedWorktree();

  if (!hosted) {
    await run("docker", composeBuildArgv(), {
      cwd: repositoryRoot,
      dryRun,
      env: {
        ...buildEnvironment,
        OPENROUND_API_URL: "",
      },
    });
    if (dryRun) {
      process.stdout.write(
        "Dry run complete for development; no artifacts or images were built.\n",
      );
    } else {
      process.stdout.write(
        `Built host artifacts and development Compose images from ${buildId}.\n`,
      );
    }
    return;
  }

  const tagSuffix = `${environment}-${buildId}`;
  const workDirectory = await mkdtemp(join(tmpdir(), "openround-build-"));
  const imageRecords = {};
  try {
    for (const component of [
      "server",
      "web",
      ...(config.singleVm?.composeFiles.includes("compose.single-vm.business.yaml")
        ? ["control"]
        : []),
    ]) {
      const repository = `${config.imageRepository}-${component}`;
      const tag = `${repository}:${tagSuffix}`;
      const metadataPath = join(workDirectory, `${component}.json`);
      await run(
        "docker",
        buildArguments({ component, config, buildId, tag, metadataPath, hosted }),
        { cwd: repositoryRoot, dryRun },
      );

      if (hosted && !dryRun) {
        const metadata = JSON.parse(await readFile(metadataPath, "utf8"));
        const digest = extractBuildxDigest(metadata);
        imageRecords[component] = {
          repository,
          tag,
          digest,
          ref: `${repository}@${digest}`,
          signed: false,
        };
      }
    }

    let manifest;
    if (hosted && !dryRun) {
      manifest = {
        schemaVersion: 1,
        environment,
        buildId,
        createdAt: new Date().toISOString(),
        nextPublicApiUrl: config.publicApiUrl,
        imagePlatform: config.imagePlatform,
        source: { commit: buildId, dirty: false },
        images: imageRecords,
      };
      // Preserve both immutable image references before any scan can fail. This
      // provisional manifest cannot be promoted because production images are
      // explicitly recorded as unsigned.
      await writeManifest(manifestOutputPath, manifest, { requireSigning: false });
    }

    if (prepare && !dryRun) {
      process.stdout.write(`Prepared unsigned build manifest: ${manifestOutputPath}\n`);
      return;
    }

    if (hosted && !dryRun) {
      await finalizeImages(imageRecords, { config, shouldSign });
    }

    if (hosted && !dryRun) {
      await writeManifest(manifestOutputPath, manifest);
      process.stdout.write(`Build manifest: ${manifestOutputPath}\n`);
    } else if (dryRun) {
      process.stdout.write(
        `Dry run complete for ${environment}; no images or manifest were written.\n`,
      );
    }
  } finally {
    await rm(workDirectory, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`Product build failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}
