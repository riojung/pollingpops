import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { checkImageRuntime } from "../../scripts/check-image-runtime.mjs";

const roots: string[] = [];

function fixture(component: "server" | "control" = "server") {
  const root = mkdtempSync(join(tmpdir(), "pollingpops-runtime-image-"));
  roots.push(root);
  const file = (path: string, content = "synthetic runtime fixture") => {
    const target = join(root, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content);
    return target;
  };
  mkdirSync(join(root, "opt"));
  for (const path of [
    "/app/BUILD_ID",
    "/licenses/LICENSE",
    "/licenses/NOTICE",
    "/licenses/THIRD_PARTY_NOTICES.md",
    ...(component === "server"
      ? [
          "/app/dist/index.js",
          "/app/dist/jobs.js",
          "/app/dist/migrate.js",
          "/app/dist/config-check.js",
          "/app/migrations/001.sql",
          "/app/assets/summary-fonts/fixture.ttf",
        ]
      : [
          "/app/apps/control/server.js",
          "/app/apps/control/.next/server/page.js",
          "/app/apps/control/.next/static/page.js",
        ]),
  ])
    file(path);
  if (component === "control") {
    file(
      "/app/admin-cli.mjs",
      'import assert from "node:assert/strict"; assert.equal(process.argv[2], "--help"); console.log("Usage: --username USER");',
    );
  }
  const options = { root, userId: 1001, path: "/usr/local/bin:/usr/bin:/bin" };
  return { root, file, options };
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("runtime image invariants", () => {
  it("accepts readable Node entrypoints, migration/assets and notices for a non-root runtime", () => {
    const { options } = fixture();
    expect(checkImageRuntime("server", options)).toMatchObject({
      component: "server",
      userId: 1001,
      packageManagers: "absent",
    });
  });

  it.each([
    "/usr/local/lib/node_modules/npm/node_modules/brace-expansion/package.json",
    "/usr/local/lib/node_modules/corepack/package.json",
    "/opt/yarn-v1.22.22/package.json",
  ])("rejects an inherited package-manager tree at %s", (path) => {
    const { file, options } = fixture();
    file(path);
    expect(() => checkImageRuntime("server", options)).toThrow(/tree remains/);
  });

  it("rejects even a dangling package-manager command symlink", () => {
    const { root, options } = fixture();
    mkdirSync(join(root, "usr/local/bin"), { recursive: true });
    symlinkSync("/missing/pnpm", join(root, "usr/local/bin/pnpm"));
    expect(() => checkImageRuntime("server", options)).toThrow(/command remains/);
  });

  it("rejects a root runtime and missing migration files", () => {
    const { root, options } = fixture();
    expect(() => checkImageRuntime("server", { ...options, userId: 0 })).toThrow(/non-root/);
    rmSync(join(root, "app/dist/migrate.js"));
    expect(() => checkImageRuntime("server", options)).toThrow(/ENOENT/);
  });

  it("executes the control administrator help with Node and no package manager", () => {
    const { options } = fixture("control");
    expect(checkImageRuntime("control", options)).toMatchObject({ component: "control" });
  });
});
