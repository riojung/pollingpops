#!/usr/bin/env node
/* global fetch, AbortSignal */
import console from "node:console";
import process from "node:process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { chmod, mkdir, open, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { fileURLToPath, URL } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import { parseCliArguments, run, validateBuildManifest, validateDeployConfig } from "./lib.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const state = resolve(root, ".deploy/aws-staging");
const qualification = resolve(root, "artifacts/aws-staging/qualification.json");
const require = createRequire(new URL("../../apps/server/package.json", import.meta.url));
const composePrefix = [
  "compose",
  "--project-name",
  "pollingpops-aws-staging",
  "--file",
  "compose.aws-staging.yaml",
];
const emulatorVersion = "1.0.385";
export const REQUIRED_STAGING_CHECKS = [
  "application-health",
  "image-identity",
  "s3-contract",
  "browser-media",
];
export const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const json = async (path) => JSON.parse(await readFile(path, "utf8"));
const save = async (path, value) => {
  await mkdir(resolve(path, ".."), { recursive: true, mode: 0o700 });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
};
const exec = (cmd, args, options = {}) => run(cmd, args, { cwd: root, ...options });
const capture = async (cmd, args, options = {}) =>
  (await exec(cmd, args, { ...options, capture: true })).stdout.trim();
async function compose(args, env = {}, options = {}) {
  return exec("docker", [...composePrefix, ...args], {
    ...options,
    env: { ...process.env, ...env },
  });
}
export function parseEmulatorCredentials(content) {
  const read = (name) => content.match(new RegExp(`^\\s*${name}\\s*=\\s*(\\S+)\\s*$`, "m"))?.[1];
  const accessKeyId = read("aws_access_key_id");
  const secretAccessKey = read("aws_secret_access_key");
  if (!accessKeyId || !secretAccessKey)
    throw new Error("Emulator did not provide this run's credentials");
  return { accessKeyId, secretAccessKey };
}
async function sdk(credentials) {
  const s3 = require("@aws-sdk/client-s3");
  return {
    ...s3,
    client: new s3.S3Client({
      endpoint: "http://localhost:19181",
      region: "us-east-1",
      credentials,
      forcePathStyle: true,
      maxAttempts: 1,
      requestHandler: { connectionTimeout: 3000, requestTimeout: 10000 },
    }),
  };
}
async function request(url, init = {}) {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(10_000) });
  if (!response.ok)
    throw new Error(`Local staging request failed: ${new URL(url).pathname} (${response.status})`);
  return response;
}
async function waitFor(operation, seconds = 90) {
  const deadline = Date.now() + seconds * 1000;
  let failure;
  while (Date.now() < deadline) {
    try {
      return await operation();
    } catch (error) {
      failure = error;
    }
    await sleep(1000);
  }
  throw new Error(`Local staging readiness timed out: ${failure?.message}`);
}
export async function selectedImages(manifestPath) {
  if (manifestPath) {
    const bytes = await readFile(resolve(manifestPath));
    const config = validateDeployConfig(
      await json(resolve(root, "config/deploy/production.json")),
      "production",
    );
    const manifest = validateBuildManifest(JSON.parse(bytes), { ...config, requireSigning: true });
    if (manifest.environment !== "production" || manifest.apiRouting !== "same-origin")
      throw new Error("Release rehearsal requires a production same-origin manifest");
    if (manifest.images.control)
      throw new Error(
        "This staging profile qualifies core server/web releases; control requires separate qualification",
      );
    return {
      kind: "release",
      buildId: manifest.buildId,
      manifestSha256: sha256(bytes),
      images: { server: manifest.images.server.ref, web: manifest.images.web.ref },
      imagePlatform: manifest.imagePlatform,
    };
  }
  return json(resolve(state, "candidate.json"));
}
async function runtimeImages() {
  const result = {};
  for (const component of ["server", "web"]) {
    const id = await capture("docker", [...composePrefix, "ps", "-q", component]);
    if (!id) throw new Error(`${component} is not running`);
    result[component] = JSON.parse(await capture("docker", ["inspect", id]))[0];
  }
  return result;
}
export function validateStagingQualification(receipt, manifest, manifestBytes, now = Date.now()) {
  validateBuildManifest(manifest, { environment: "production", requireSigning: true });
  if (manifest.apiRouting !== "same-origin")
    throw new Error("Release rehearsal requires a production same-origin manifest");
  if (manifest.images.control) throw new Error("Control images require separate qualification");
  const record = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
  if (
    !record(receipt) ||
    !record(receipt.candidate) ||
    !record(receipt.candidate.images) ||
    receipt?.schemaVersion !== 1 ||
    receipt.kind !== "local-aws-emulator" ||
    receipt.candidate?.kind !== "release" ||
    receipt.passed !== true
  )
    throw new Error("A successful release rehearsal receipt is required");
  if (
    receipt.candidate.buildId !== manifest.buildId ||
    receipt.candidate.manifestSha256 !== sha256(manifestBytes)
  )
    throw new Error("Staging evidence does not match the exact release manifest");
  if (receipt.candidate.imagePlatform !== manifest.imagePlatform)
    throw new Error("Staging image platform differs from release");
  for (const component of ["server", "web"]) {
    if (receipt.candidate.images?.[component] !== manifest.images[component].ref)
      throw new Error(`Staging ${component} digest differs from release`);
  }
  if (
    !record(receipt.checks) ||
    receipt.emulatorVersion !== emulatorVersion ||
    REQUIRED_STAGING_CHECKS.some((check) => receipt.checks?.[check] !== true)
  )
    throw new Error("Required local staging checks are missing");
  const age = now - Date.parse(receipt.completedAt);
  if (
    typeof receipt.completedAt !== "string" ||
    !Number.isFinite(age) ||
    age < 0 ||
    age > 7 * 86400_000
  )
    throw new Error("Staging receipt must be from the past seven days");
  return receipt;
}
async function stagingMain(argv) {
  const parsed = parseCliArguments(argv, { valueOptions: ["manifest"], booleanOptions: ["help"] });
  const [command, ...extra] = parsed.positionals;
  if (parsed.flags.has("help") || !command) {
    console.log(
      "Usage: pnpm aws:staging build|start [--manifest PATH]|verify|status|logs|stop\nLoopback app: http://localhost:19180 ; mail: http://localhost:19182\nAll staging application data is disposable. Existing development services are separate.",
    );
    return;
  }
  if (extra.length || !["build", "start", "verify", "status", "logs", "stop"].includes(command))
    throw new Error("Unsupported local staging command");
  if (parsed.values.size && command !== "start")
    throw new Error("--manifest is only valid with start");
  await exec("docker", ["info"], { capture: true, timeoutMs: 10000 });
  if (command === "status") return compose(["ps"]);
  if (command === "logs") return compose(["logs", "--tail", "80", "server", "web", "aws-gateway"]);
  if (command === "stop") {
    await compose(["down", "--remove-orphans"]);
    await rm(resolve(state, "run.json"), { force: true });
    console.log("Stopped disposable AWS staging. Staging PostgreSQL, Valkey and S3 data are gone.");
    return;
  }
  await mkdir(resolve(state, "tls"), { recursive: true, mode: 0o700 });
  await chmod(state, 0o700);
  if (command === "build") {
    const buildId = await capture("git", ["rev-parse", "HEAD"]);
    const dirty = Boolean(await capture("git", ["status", "--porcelain"]));
    await compose(["build", "aws-emulator"]);
    for (const component of ["server", "web"]) {
      await exec("docker", [
        "build",
        "--file",
        `apps/${component}/Dockerfile`,
        "--build-arg",
        `OPENROUND_BUILD_ID=${buildId}`,
        ...(component === "web" ? ["--build-arg", "NEXT_PUBLIC_API_URL="] : []),
        "--tag",
        `pollingpops-staging-${component}:local`,
        ".",
      ]);
    }
    const images = {};
    for (const component of ["server", "web"])
      images[component] = await capture("docker", [
        "image",
        "inspect",
        "--format",
        "{{.Id}}",
        `pollingpops-staging-${component}:local`,
      ]);
    await save(resolve(state, "candidate.json"), { kind: "development", buildId, dirty, images });
    console.log(
      "Built local rehearsal images. A production manifest is required for promotion evidence.",
    );
    return;
  }
  if (command === "start") {
    const existing = await capture("docker", [...composePrefix, "ps", "--all", "-q"]);
    if (existing)
      throw new Error(
        "Staging already exists. Use verify/status, or stop before starting a fresh disposable run.",
      );
    const candidate = await selectedImages(parsed.values.get("manifest"));
    const env = {
      STAGING_SERVER_IMAGE: candidate.images.server,
      STAGING_WEB_IMAGE: candidate.images.web,
    };
    if (candidate.kind === "release") {
      for (const component of ["server", "web"])
        await exec("docker", [
          "pull",
          "--platform",
          candidate.imagePlatform,
          candidate.images[component],
        ]);
    }
    await compose(["up", "--detach", "--build", "aws-emulator"], env);
    const id = await capture("docker", [...composePrefix, "ps", "-q", "aws-emulator"]);
    await waitFor(async () => {
      await exec(
        "docker",
        [
          "cp",
          `${id}:/home/emulator/.aws/emulator/19297/emulator_credentials`,
          resolve(state, "credentials"),
        ],
        { capture: true },
      );
      await exec(
        "docker",
        ["cp", `${id}:/home/emulator/.aws/emulator/19297/ca.pem`, resolve(state, "tls/ca.pem")],
        { capture: true },
      );
    });
    await chmod(resolve(state, "credentials"), 0o600);
    const credentials = parseEmulatorCredentials(
      await readFile(resolve(state, "credentials"), "utf8"),
    );
    Object.assign(env, {
      STAGING_ACCESS_KEY: credentials.accessKeyId,
      STAGING_SECRET_KEY: credentials.secretAccessKey,
      STAGING_ADMIN_TOKEN: randomBytes(32).toString("hex"),
    });
    await compose(["up", "--detach", "aws-gateway"], env);
    const s3 = await sdk(credentials);
    try {
      await waitFor(() => s3.client.send(new s3.ListBucketsCommand({})));
      await s3.client.send(new s3.CreateBucketCommand({ Bucket: "pollingpops-staging-media" }));
      await s3.client.send(
        new s3.PutBucketCorsCommand({
          Bucket: "pollingpops-staging-media",
          CORSConfiguration: {
            CORSRules: [
              {
                AllowedOrigins: ["http://localhost:19180"],
                AllowedMethods: ["GET", "HEAD", "PUT"],
                AllowedHeaders: ["*"],
                ExposeHeaders: ["ETag"],
              },
            ],
          },
        }),
      );
    } finally {
      s3.client.destroy();
    }
    await compose(
      ["up", "--detach", "--no-build", "--wait", "--wait-timeout", "600", "caddy", "mailpit"],
      env,
    );
    // Synthetic rollout policy in this disposable database only. Never exported
    // into production; the application keeps its ordinary authentication path.
    const policy = JSON.stringify({
      revision: 1,
      updatedAt: new Date().toISOString(),
      features: Object.fromEntries(
        [
          "uxBeta",
          "presentations",
          "builderV2",
          "discover",
          "groups",
          "presentationRealtime",
          "presentationCompanion",
          "practiceAssignments",
          "surveys",
        ].map((key) => [key, { enabled: true, plans: ["free", "pro", "team"] }]),
      ),
    });
    await compose(
      [
        "exec",
        "-T",
        "postgres",
        "psql",
        "-U",
        "openround",
        "-d",
        "openround",
        "-v",
        "ON_ERROR_STOP=1",
        "-c",
        `INSERT INTO platform_records(kind,id,data) VALUES ('feature_policy','global','${policy}'::jsonb) ON CONFLICT DO NOTHING;`,
      ],
      env,
    );
    const running = await runtimeImages();
    await save(resolve(state, "run.json"), {
      runId: randomUUID(),
      startedAt: new Date().toISOString(),
      candidate,
      imageIds: Object.fromEntries(
        Object.entries(running).map(([component, value]) => [component, value.Image]),
      ),
    });
    console.log(
      "AWS staging ready: http://localhost:19180 ; sign-in mail: http://localhost:19182\nRun pnpm aws:staging verify to qualify this exact run.",
    );
    return;
  }
  const runState = await json(resolve(state, "run.json"));
  await rm(qualification, { force: true });
  const checks = {};
  await request("http://localhost:19180/health/ready");
  await request("http://localhost:19180/");
  checks["application-health"] = true;
  const running = await runtimeImages();
  for (const component of ["server", "web"]) {
    if (running[component].Image !== runState.imageIds[component])
      throw new Error("Running images changed since start");
    const id = running[component].Id;
    const buildId = await capture("docker", ["exec", id, "cat", "/app/BUILD_ID"]);
    if (buildId !== runState.candidate.buildId)
      throw new Error(`${component} embedded build ID differs from candidate`);
  }
  checks["image-identity"] = true;
  const credentials = parseEmulatorCredentials(
    await readFile(resolve(state, "credentials"), "utf8"),
  );
  const s3 = await sdk(credentials);
  const key = `rehearsal/${runState.runId}.txt`;
  const Bucket = "pollingpops-staging-media";
  try {
    await s3.client.send(
      new s3.PutObjectCommand({
        Bucket,
        Key: key,
        Body: "pollingpops-staging-probe",
        ContentType: "text/plain",
      }),
    );
    await s3.client.send(new s3.HeadObjectCommand({ Bucket, Key: key }));
    await s3.client.send(
      new s3.CopyObjectCommand({ Bucket, Key: `${key}.copy`, CopySource: `${Bucket}/${key}` }),
    );
    await s3.client.send(
      new s3.PutObjectTaggingCommand({
        Bucket,
        Key: `${key}.copy`,
        Tagging: { TagSet: [{ Key: "openround-finalization-state", Value: "committed" }] },
      }),
    );
    const object = await s3.client.send(new s3.GetObjectCommand({ Bucket, Key: `${key}.copy` }));
    if ((await object.Body.transformToString()) !== "pollingpops-staging-probe")
      throw new Error("S3 readback differs");
    checks["s3-contract"] = true;
    await exec("pnpm", ["exec", "playwright", "test", "--config=playwright.aws-staging.config.ts"]);
    checks["browser-media"] = true;
  } finally {
    for (const Key of [key, `${key}.copy`])
      await s3.client.send(new s3.DeleteObjectCommand({ Bucket, Key })).catch(() => {});
    s3.client.destroy();
  }
  await save(qualification, {
    schemaVersion: 1,
    kind: "local-aws-emulator",
    emulatorVersion,
    candidate: runState.candidate,
    runId: runState.runId,
    completedAt: new Date().toISOString(),
    passed: true,
    checks,
  });
  console.log(
    `Local staging checks passed. Receipt: ${qualification}\nThis receipt supplements, and does not replace, hosted security/restore/load/release acceptance.`,
  );
}
export async function main(argv = process.argv.slice(2)) {
  if (!argv.length || argv.includes("--help") || ["status", "logs"].includes(argv[0]))
    return stagingMain(argv);
  await mkdir(state, { recursive: true, mode: 0o700 });
  const lockPath = resolve(state, "operation.lock");
  let lock;
  try {
    lock = await open(lockPath, "wx", 0o600);
  } catch (error) {
    if (error.code === "EEXIST")
      throw new Error(
        `Another staging operation owns ${lockPath}. Check its PID before removing a stale lock.`,
        { cause: error },
      );
    throw error;
  }
  try {
    await lock.writeFile(`${process.pid}\n`);
    return await stagingMain(argv);
  } finally {
    await lock.close();
    await rm(lockPath, { force: true });
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch((error) => {
    console.error(`AWS staging failed: ${error.message}`);
    process.exitCode = 1;
  });
