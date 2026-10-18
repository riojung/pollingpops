import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { accessSync, constants, lstatSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const runtimeFiles = {
  server: [
    "/app/dist/index.js",
    "/app/dist/jobs.js",
    "/app/dist/migrate.js",
    "/app/dist/config-check.js",
  ],
  web: ["/app/apps/web/server.js"],
  control: ["/app/apps/control/server.js", "/app/admin-cli.mjs"],
};
const runtimeDirectories = {
  server: ["/app/migrations", "/app/assets/summary-fonts"],
  web: ["/app/apps/web/.next/server", "/app/apps/web/.next/static", "/app/apps/web/public"],
  control: ["/app/apps/control/.next/server", "/app/apps/control/.next/static"],
};
const packageManagers = ["npm", "npx", "corepack", "pnpm", "pnpx", "yarn", "yarnpkg"];

function exists(path) {
  try {
    lstatSync(path);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

export function checkImageRuntime(
  component,
  { root = "/", userId = process.getuid?.(), path = process.env.PATH ?? "" } = {},
) {
  assert.ok(Object.hasOwn(runtimeFiles, component), "Expected server, web, or control image");
  assert.ok(Number.isInteger(userId) && userId > 0, "Runtime image must use a non-root user");
  const imagePath = (name) => join(root, name);
  for (const manager of ["npm", "corepack", "pnpm", "yarn"]) {
    const directory = `/usr/local/lib/node_modules/${manager}`;
    assert.ok(!exists(imagePath(directory)), `Runtime package-manager tree remains: ${directory}`);
  }
  for (const name of readdirSync(imagePath("/opt"))) {
    assert.ok(!name.startsWith("yarn-v"), `Runtime Yarn tree remains: /opt/${name}`);
  }
  for (const directory of new Set(path.split(":").filter(Boolean))) {
    for (const manager of packageManagers) {
      const command = join(directory, manager);
      assert.ok(!exists(imagePath(command)), `Runtime package-manager command remains: ${command}`);
    }
  }
  const files = [
    ...runtimeFiles[component],
    "/app/BUILD_ID",
    "/licenses/LICENSE",
    "/licenses/NOTICE",
    "/licenses/THIRD_PARTY_NOTICES.md",
  ];
  for (const file of files) {
    accessSync(imagePath(file), constants.R_OK);
    const stat = statSync(imagePath(file));
    assert.ok(stat.isFile() && stat.size > 0, `Runtime file is empty or invalid: ${file}`);
  }
  for (const directory of runtimeDirectories[component]) {
    accessSync(imagePath(directory), constants.R_OK | constants.X_OK);
    assert.ok(readdirSync(imagePath(directory)).length > 0, `Runtime assets missing: ${directory}`);
  }
  const buildId = readFileSync(imagePath("/app/BUILD_ID"), "utf8").trim();
  assert.ok(buildId, "Runtime build marker must be readable and nonempty");
  if (component === "control") {
    const help = execFileSync(process.execPath, [imagePath("/app/admin-cli.mjs"), "--help"], {
      encoding: "utf8",
      timeout: 15_000,
      stdio: ["ignore", "pipe", "pipe"],
    });
    assert.match(help, /--username/, "The bundled administrator CLI must execute with Node");
  }
  return { component, userId, nodeVersion: process.version, buildId, packageManagers: "absent" };
}

if (process.argv[1] === "-" || resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  process.stdout.write(`${JSON.stringify(checkImageRuntime(process.argv[2]), null, 2)}\n`);
}
