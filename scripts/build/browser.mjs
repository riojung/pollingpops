import { spawn } from "node:child_process";
import { Buffer } from "node:buffer";
import process from "node:process";
import { clearTimeout, setTimeout } from "node:timers";
import { createHash } from "node:crypto";
import { cp, lstat, readdir, readFile, readlink, realpath, writeFile } from "node:fs/promises";
import { constants } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL, URL } from "node:url";
import { preparePlaywrightNext } from "../prepare-playwright-next.mjs";
import { runNextBuild, withNextBuildLock } from "./next.mjs";

const repositoryRoot = fileURLToPath(new URL("../..", import.meta.url));
const manifestName = "browser-build.json";
const roles = { core: { web: 3100, api: 4100 }, beta: { web: 3200, api: 4200 } };
const ignoredDirectories = new Set(["node_modules", "dist", "coverage", "admin-dist", ".turbo"]);

function port(value) {
  if (!/^\d+$/.test(String(value)) || Number(value) < 1 || Number(value) > 65535)
    throw new Error("Browser ports must be integers between 1 and 65535");
  return Number(value);
}

export function browserSettings(role, { env = process.env, webPort, apiPort } = {}) {
  if (!Object.hasOwn(roles, role)) throw new Error("Expected browser role core or beta");
  const dist = `.next-browser-${role}`;
  if (env.OPENROUND_NEXT_DIST_DIR && env.OPENROUND_NEXT_DIST_DIR !== dist)
    throw new Error("The browser role and Next output directory do not match");
  if (env.PLAYWRIGHT_BUSINESS === "true" || env.CANVAS_COLLAB_DIST_DIR)
    throw new Error("Browser production builds require their dedicated role output");
  const selectedApiPort = port(apiPort ?? roles[role].api);
  const selectedWebPort = port(webPort ?? roles[role].web);
  return {
    role,
    dist,
    webPort: selectedWebPort,
    apiOrigin: `http://127.0.0.1:${selectedApiPort}`,
    env: {
      ...env,
      OPENROUND_NEXT_DIST_DIR: dist,
      NEXT_PUBLIC_API_URL: `http://127.0.0.1:${selectedApiPort}`,
      PORT: String(selectedWebPort),
    },
  };
}

async function sourceFiles(directory, relative = "") {
  let entries;
  try {
    entries = await readdir(join(directory, relative), { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
  const files = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const name = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (ignoredDirectories.has(entry.name) || entry.name.startsWith(".next")) continue;
      files.push(...(await sourceFiles(directory, name)));
    } else if (!name.endsWith(".tsbuildinfo") && name !== "apps/web/next-env.d.ts") {
      files.push(name);
    }
  }
  return files;
}

async function digestFiles(root, files) {
  const hash = createHash("sha256");
  for (const file of files.sort()) {
    const full = join(root, file);
    const info = await lstat(full);
    if (!info.isFile()) throw new Error("Build inputs and packaged assets must be regular files");
    let contents = await readFile(full);
    if (file === "apps/web/tsconfig.build.json") {
      // The guard selects generated type/cache paths while another role may be
      // serving. Those paths are derived from dist, which is proved separately.
      const profile = JSON.parse(contents.toString());
      profile.include = (profile.include ?? []).filter((path) => !path.startsWith(".next"));
      if (profile.compilerOptions) {
        delete profile.compilerOptions.tsBuildInfoFile;
        if (Object.keys(profile.compilerOptions).length === 0) delete profile.compilerOptions;
      }
      contents = Buffer.from(JSON.stringify(profile));
    }
    hash.update(`${file}\0${contents.length}\0`).update(contents).update("\0");
  }
  return hash.digest("hex");
}

export async function browserProvenance(settings, root = repositoryRoot) {
  // Hash actual source contents, including uncommitted/new source and local env
  // files. A commit ID alone would silently accept a changed working tree.
  const files = [];
  for (const directory of ["apps/web", "packages", "scripts/build"])
    files.push(...(await sourceFiles(root, directory)));
  files.push("scripts/prepare-playwright-next.mjs");
  for (const entry of await readdir(root))
    if (/\.(?:json|[cm]?js|ts|ya?ml)$/.test(entry)) files.push(entry);
  const buildEnvironment = Object.fromEntries(
    Object.entries(settings.env)
      .filter(
        ([key]) =>
          key.startsWith("NEXT_PUBLIC_") ||
          ["OPENROUND_BUILD_ID", "OPENROUND_PUBLIC_URL", "PORT"].includes(key),
      )
      .sort(([left], [right]) => left.localeCompare(right)),
  );
  return {
    schemaVersion: 2,
    role: settings.role,
    dist: settings.dist,
    nodeVersion: process.version,
    apiOrigin: settings.apiOrigin,
    sourceDigest: await digestFiles(root, files),
    environmentDigest: createHash("sha256").update(JSON.stringify(buildEnvironment)).digest("hex"),
  };
}

function outputPaths(settings, root) {
  const output = join(root, "apps/web", settings.dist);
  const standalone = join(output, "standalone/apps/web");
  return { output, standalone, server: join(standalone, "server.js") };
}

async function artifactDigest(settings, root) {
  const { output, standalone } = outputPaths(settings, root);
  const runtime = join(output, "standalone");
  if (!(await lstat(runtime)).isDirectory())
    throw new Error("Browser standalone runtime must be a directory");
  const canonicalRuntime = await realpath(runtime);
  const hash = createHash("sha256");
  if (!(await lstat(join(output, "BUILD_ID"))).isFile())
    throw new Error("Browser build identifier must be a regular file");
  const buildId = await readFile(join(output, "BUILD_ID"));
  hash.update(`BUILD_ID\0${buildId.length}\0`).update(buildId).update("\0");

  // Trace output includes pnpm links. Hash every physical entry once, including
  // their targets, and prove each link resolves inside this packaged runtime.
  // Source exclusions must never hide compiled routes, manifests or dependencies.
  async function walk(name = "") {
    const path = join(runtime, name);
    const info = await lstat(path);
    if (info.isSymbolicLink()) {
      const target = await readlink(path);
      const canonicalTarget = relative(canonicalRuntime, await realpath(path));
      if (
        canonicalTarget === ".." ||
        canonicalTarget.startsWith(`..${sep}`) ||
        isAbsolute(canonicalTarget)
      )
        throw new Error("Browser standalone symbolic links must resolve inside the runtime");
      hash.update(`link\0${name}\0${target}\0${canonicalTarget}\0`);
    } else if (info.isDirectory()) {
      hash.update(`directory\0${name}\0`);
      for (const entry of (await readdir(path)).sort())
        await walk(name ? `${name}/${entry}` : entry);
    } else if (info.isFile()) {
      const contents = await readFile(path);
      hash.update(`file\0${name}\0${contents.length}\0`).update(contents).update("\0");
    } else throw new Error("Browser standalone entries must be files, directories or safe links");
  }

  await walk();
  if (!(await lstat(join(standalone, "server.js"))).isFile())
    throw new Error("Browser standalone server is missing");
  for (const directory of ["public", `${settings.dist}/static`]) {
    if (!(await lstat(join(standalone, directory))).isDirectory())
      throw new Error("Browser standalone assets are missing");
  }
  return hash.digest("hex");
}

export async function validateBrowserBuild(settings, root = repositoryRoot) {
  let manifest;
  try {
    manifest = JSON.parse(
      await readFile(join(outputPaths(settings, root).output, manifestName), "utf8"),
    );
  } catch {
    throw new Error(
      "Browser production build metadata is missing or invalid; prepare the build first",
    );
  }
  const expected = await browserProvenance(settings, root);
  for (const [key, value] of Object.entries(expected))
    if (manifest[key] !== value)
      throw new Error(`Browser production build provenance mismatch: ${key}; rebuild this role`);
  let currentArtifactDigest;
  try {
    currentArtifactDigest = await artifactDigest(settings, root);
  } catch (error) {
    throw new Error("Browser production output changed or is invalid; rebuild this role", {
      cause: error,
    });
  }
  if (manifest.artifactDigest !== currentArtifactDigest)
    throw new Error("Browser production output changed after preparation; rebuild this role");
  return manifest;
}

export async function buildBrowser(settings, { root = repositoryRoot, build = runNextBuild } = {}) {
  const webDirectory = join(root, "apps/web");
  const before = await browserProvenance(settings, root);
  await build("web", {
    env: { ...settings.env, NODE_ENV: "production" },
    repositoryRoot: root,
    beforeBuild: () => preparePlaywrightNext(webDirectory, settings.dist),
    afterBuild: async () => {
      const after = await browserProvenance(settings, root);
      if (JSON.stringify(before) !== JSON.stringify(after))
        throw new Error("Browser source changed during compilation; rebuild this role");
      const { output, standalone } = outputPaths(settings, root);
      await cp(join(webDirectory, "public"), join(standalone, "public"), { recursive: true });
      await cp(join(output, "static"), join(standalone, settings.dist, "static"), {
        recursive: true,
      });
      const manifest = { ...after, artifactDigest: await artifactDigest(settings, root) };
      await writeFile(join(output, manifestName), `${JSON.stringify(manifest, null, 2)}\n`);
    },
  });
}

function runChild(command, args, options) {
  return new Promise((done, reject) => {
    const child = spawn(command, args, {
      ...options,
      stdio: "inherit",
      detached: process.platform !== "win32",
    });
    let interrupted;
    let escalation;
    const terminate = (signal) => {
      if (!child.pid) return;
      try {
        if (process.platform === "win32") child.kill(signal);
        else process.kill(-child.pid, signal);
      } catch (error) {
        if (error.code !== "ESRCH") throw error;
      }
    };
    const handlers = ["SIGINT", "SIGTERM", "SIGHUP"].map((signal) => {
      const handler = () => {
        if (interrupted) return;
        interrupted = signal;
        terminate(signal);
        escalation = setTimeout(() => terminate("SIGKILL"), 5_000);
      };
      process.on(signal, handler);
      return [signal, handler];
    });
    const cleanup = () => {
      clearTimeout(escalation);
      for (const [signal, handler] of handlers) process.off(signal, handler);
    };
    child.once("error", (error) => {
      cleanup();
      reject(error);
    });
    child.once("close", (code, signal) => {
      if (interrupted) terminate("SIGKILL");
      cleanup();
      if (interrupted || signal) {
        const error = new Error(`Browser web process terminated by ${interrupted ?? signal}`);
        error.exitCode = 128 + constants.signals[interrupted ?? signal];
        reject(error);
      } else if (code !== 0) reject(new Error(`Browser web process exited with code ${code}`));
      else done();
    });
  });
}

export async function startBrowser(
  settings,
  {
    root = repositoryRoot,
    reuse = settings.env.PLAYWRIGHT_REUSE_BUILD === "true",
    lock = withNextBuildLock,
    run = runChild,
  } = {},
) {
  if (!reuse) await buildBrowser(settings, { root });
  return lock(
    "web",
    settings.dist,
    async () => {
      await validateBrowserBuild(settings, root);
      return run(process.execPath, [outputPaths(settings, root).server], {
        cwd: root,
        env: {
          ...settings.env,
          NODE_ENV: "production",
          PORT: String(settings.webPort),
          HOSTNAME: "127.0.0.1",
        },
      });
    },
    { repositoryRoot: root },
  );
}

async function main() {
  const [mode, role, webPort, apiPort, ...extra] = process.argv.slice(2);
  if (extra.length || !["build", "start", "dev"].includes(mode))
    throw new Error(
      "Usage: node scripts/build/browser.mjs build|start|dev core|beta [WEB_PORT API_PORT]",
    );
  const settings = browserSettings(role, { webPort, apiPort });
  if (mode === "build") await buildBrowser(settings);
  else if (mode === "start") await startBrowser(settings);
  else
    await withNextBuildLock("web", settings.dist, async () => {
      await preparePlaywrightNext(join(repositoryRoot, "apps/web"), settings.dist);
      await runChild(
        "pnpm",
        ["--filter", "@openround/web", "exec", "next", "dev", "-p", String(settings.webPort)],
        {
          cwd: repositoryRoot,
          env: settings.env,
        },
      );
    });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  await main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = error.exitCode ?? 1;
  });
