import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  browserSettings,
  buildBrowser,
  startBrowser,
  validateBrowserBuild,
} from "../../scripts/build/browser.mjs";
import { preparePlaywrightNext } from "../../scripts/prepare-playwright-next.mjs";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function put(root: string, file: string, contents: string) {
  await mkdir(dirname(join(root, file)), { recursive: true });
  await writeFile(join(root, file), contents);
}

async function fixture(role = "beta") {
  const root = await mkdtemp(join(tmpdir(), "pollingpops-browser-build-"));
  roots.push(root);
  const settings = browserSettings(role, { env: { NEXT_PUBLIC_LABEL: "fixture" } });
  await put(root, "apps/web/app/page.tsx", "export default () => null;");
  await put(root, "apps/web/public/asset.txt", "public asset");
  await put(root, "packages/contracts/src/index.ts", "export const fixture = true;");
  await put(root, "scripts/prepare-playwright-next.mjs", "// fixture preparation");
  await put(root, "scripts/build/next.mjs", "// fixture build guard");
  await put(root, "pnpm-lock.yaml", "lockfileVersion: '9.0'");
  await put(root, "apps/web/next.config.ts", "export default { output: 'standalone' };");
  await put(
    root,
    "apps/web/tsconfig.build.json",
    JSON.stringify({
      extends: "./tsconfig.json",
      include: ["app/**/*.tsx", ".next/types/**/*.ts"],
    }),
  );
  await put(root, "apps/web/.env.production.local", "NEXT_PUBLIC_FIXTURE=original");
  const output = `apps/web/${settings.dist}`;
  const build = vi.fn(async (_app: string, options: any) => {
    await options.beforeBuild();
    await put(root, `${output}/BUILD_ID`, "test-build");
    await put(root, `${output}/static/chunks/main.js`, "console.log('compiled')");
    await put(root, `${output}/standalone/apps/web/server.js`, "// standalone server");
    await put(
      root,
      `${output}/standalone/apps/web/${settings.dist}/server/app/page.js`,
      "// compiled route",
    );
    await put(
      root,
      `${output}/standalone/apps/web/${settings.dist}/server/chunks/runtime.js`,
      "// compiled runtime chunk",
    );
    await put(
      root,
      `${output}/standalone/apps/web/${settings.dist}/routes-manifest.json`,
      '{"routes":[]}',
    );
    await put(
      root,
      `${output}/standalone/node_modules/.pnpm/runtime@1/node_modules/runtime/index.js`,
      "// traced module",
    );
    await put(
      root,
      `${output}/standalone/node_modules/other-runtime/index.js`,
      "// other traced module",
    );
    await symlink(
      ".pnpm/runtime@1/node_modules/runtime",
      join(root, `${output}/standalone/node_modules/runtime`),
    );
    await options.afterBuild();
  });
  return { root, settings, output, build };
}

describe("prepared browser production builds", () => {
  it("preserves compiler cache and removes stale output only in the selected role", async () => {
    const { root, settings, output, build } = await fixture();
    await put(root, `${output}/cache/compiler.bin`, "warm cache");
    await put(root, `${output}/stale-server.js`, "stale");
    await put(root, "apps/web/.next/keep.txt", "other build");
    await put(root, "apps/web/.next-browser-core/keep.txt", "other browser role");
    await buildBrowser(settings, { root, build });
    expect(await readFile(join(root, output, "cache/compiler.bin"), "utf8")).toBe("warm cache");
    await expect(readFile(join(root, output, "stale-server.js"))).rejects.toThrow();
    expect(await readFile(join(root, "apps/web/.next/keep.txt"), "utf8")).toBe("other build");
    expect(await readFile(join(root, "apps/web/.next-browser-core/keep.txt"), "utf8")).toBe(
      "other browser role",
    );
    await expect(validateBrowserBuild(settings, root)).resolves.toMatchObject({ role: "beta" });
    expect(build).toHaveBeenCalledOnce();
  });

  it("fails closed without a manifest and never starts a reused server", async () => {
    const { root, settings } = await fixture();
    const run = vi.fn();
    await expect(startBrowser(settings, { root, reuse: true, run })).rejects.toThrow(
      /metadata is missing/,
    );
    expect(run).not.toHaveBeenCalled();
  });

  it.each([
    ["an edited route", "apps/web/app/page.tsx"],
    ["a new source file", "apps/web/lib/new-source.ts"],
    ["a shared package", "packages/contracts/src/index.ts"],
    ["the dependency lock", "pnpm-lock.yaml"],
    ["the Next configuration", "apps/web/next.config.ts"],
    ["local build environment", "apps/web/.env.production.local"],
  ])("rejects reuse after changing %s", async (_description, file) => {
    const { root, settings, build } = await fixture();
    await buildBrowser(settings, { root, build });
    await put(root, file, "changed input");
    await expect(validateBrowserBuild(settings, root)).rejects.toThrow(/sourceDigest/);
  });

  it("rejects different API origins, public build environment, and Node provenance", async () => {
    const { root, settings, output, build } = await fixture();
    await buildBrowser(settings, { root, build });
    await expect(
      validateBrowserBuild(browserSettings("beta", { env: settings.env, apiPort: 4201 }), root),
    ).rejects.toThrow(/apiOrigin/);
    await expect(
      validateBrowserBuild(
        browserSettings("beta", { env: { ...settings.env, NEXT_PUBLIC_LABEL: "different" } }),
        root,
      ),
    ).rejects.toThrow(/environmentDigest/);
    const path = join(root, output, "browser-build.json");
    const metadata = JSON.parse(await readFile(path, "utf8"));
    await writeFile(path, JSON.stringify({ ...metadata, nodeVersion: "v0.0.0" }));
    await expect(validateBrowserBuild(settings, root)).rejects.toThrow(/nodeVersion/);
  });

  it("detects a changed packaged asset before starting the server", async () => {
    const { root, settings, output, build } = await fixture();
    await buildBrowser(settings, { root, build });
    await put(
      root,
      `${output}/standalone/apps/web/${settings.dist}/static/chunks/main.js`,
      "corrupted",
    );
    await expect(validateBrowserBuild(settings, root)).rejects.toThrow(/output changed/);
  });

  it.each([
    ["compiled route", "apps/web/.next-browser-beta/server/app/page.js"],
    ["runtime chunk", "apps/web/.next-browser-beta/server/chunks/runtime.js"],
    ["runtime manifest", "apps/web/.next-browser-beta/routes-manifest.json"],
    ["traced module", "node_modules/.pnpm/runtime@1/node_modules/runtime/index.js"],
  ])("rejects changed and deleted %s before starting a reused server", async (_name, file) => {
    const { root, settings, output, build } = await fixture();
    await buildBrowser(settings, { root, build });
    const path = join(root, `${output}/standalone`, file);
    const original = await readFile(path);
    const run = vi.fn();
    await writeFile(path, "changed runtime");
    await expect(startBrowser(settings, { root, reuse: true, run })).rejects.toThrow(
      /output changed/,
    );
    await writeFile(path, original);
    await expect(validateBrowserBuild(settings, root)).resolves.toMatchObject({ role: "beta" });
    await rm(path);
    await expect(startBrowser(settings, { root, reuse: true, run })).rejects.toThrow(
      /output changed/,
    );
    expect(run).not.toHaveBeenCalled();
  });

  it("proves pnpm link targets and rejects replaced, escaping or dangling runtime links", async () => {
    const { root, settings, output, build } = await fixture();
    await buildBrowser(settings, { root, build });
    const runtime = join(root, `${output}/standalone`);
    const link = join(runtime, "node_modules/runtime");
    // Both targets existed at preparation: changing only the link must be detected.
    await rm(link);
    await symlink("other-runtime", link);
    await expect(validateBrowserBuild(settings, root)).rejects.toThrow(/output changed/);
    await rm(link);
    await symlink(join(root, "packages"), link);
    await expect(validateBrowserBuild(settings, root)).rejects.toThrow(/output changed/);
    await rm(link);
    await symlink("missing-runtime", link);
    await expect(validateBrowserBuild(settings, root)).rejects.toThrow(/output changed/);
  });

  it("refuses to prepare a standalone runtime with links outside its packaged tree", async () => {
    const { root, settings, output, build } = await fixture();
    const compile = async (app: string, options: any) =>
      build(app, {
        ...options,
        afterBuild: async () => {
          await symlink(
            join(root, "packages"),
            join(root, `${output}/standalone/node_modules/outside`),
          );
          return options.afterBuild();
        },
      });
    await expect(buildBrowser(settings, { root, build: compile })).rejects.toThrow(
      /symbolic links must resolve inside/,
    );
    await expect(readFile(join(root, output, "browser-build.json"))).rejects.toThrow();
  });

  it("ignores only guard-selected type/cache paths while proving all production type settings", async () => {
    const { root, settings, build } = await fixture();
    await buildBrowser(settings, { root, build });
    const path = join(root, "apps/web/tsconfig.build.json");
    const original = JSON.parse(await readFile(path, "utf8"));
    const temporary = {
      ...original,
      include: ["app/**/*.tsx", ".next-other-role/types/**/*.ts"],
      compilerOptions: { tsBuildInfoFile: ".next-other-role/cache/types.tsbuildinfo" },
    };
    await writeFile(path, JSON.stringify(temporary));
    // An absent compilerOptions and an empty one have identical effective settings.
    await expect(validateBrowserBuild(settings, root)).resolves.toMatchObject({ role: "beta" });
    await writeFile(path, JSON.stringify({ ...temporary, compilerOptions: { strict: false } }));
    await expect(validateBrowserBuild(settings, root)).rejects.toThrow(/sourceDigest/);
  });

  it("does not publish reusable metadata when sources change while compiling", async () => {
    const { root, settings, output, build } = await fixture();
    const compile = async (app: string, options: any) =>
      build(app, {
        ...options,
        afterBuild: async () => {
          await put(root, "apps/web/app/page.tsx", "changed during build");
          return options.afterBuild();
        },
      });
    await expect(buildBrowser(settings, { root, build: compile })).rejects.toThrow(
      /source changed during compilation/,
    );
    await expect(readFile(join(root, output, "browser-build.json"))).rejects.toThrow();
  });

  it("reuses one prepared artifact for successive fresh server lifetimes while holding its lock", async () => {
    const { root, settings, build } = await fixture();
    await buildBrowser(settings, { root, build });
    let active = false;
    const lock = async (_app: string, _dist: string, operation: () => Promise<void>) => {
      expect(active).toBe(false);
      active = true;
      try {
        return await operation();
      } finally {
        active = false;
      }
    };
    const run = vi.fn(async (_command: string, args: string[], options: any) => {
      expect(active).toBe(true);
      expect(args[0]).toBe(join(root, "apps/web/.next-browser-beta/standalone/apps/web/server.js"));
      expect(options.env).toMatchObject({
        PORT: "3200",
        HOSTNAME: "127.0.0.1",
        NODE_ENV: "production",
      });
    });
    await startBrowser(settings, { root, reuse: true, lock, run });
    await startBrowser(settings, { root, reuse: true, lock, run });
    expect(build).toHaveBeenCalledOnce();
    expect(run).toHaveBeenCalledTimes(2);
    expect(active).toBe(false);
  });

  it("blocks a second server on the same role until the first lifetime ends", async () => {
    const { root, settings, build } = await fixture();
    await buildBrowser(settings, { root, build });
    let release!: () => void;
    let started!: () => void;
    const ready = new Promise<void>((done) => {
      started = done;
    });
    const lifetime = new Promise<void>((done) => {
      release = done;
    });
    const run = vi.fn(async () => {
      started();
      await lifetime;
    });
    const first = startBrowser(settings, { root, reuse: true, run });
    await ready;
    try {
      await expect(startBrowser(settings, { root, reuse: true, run })).rejects.toThrow(/busy/);
      expect(run).toHaveBeenCalledOnce();
    } finally {
      release();
      await first;
    }
    await startBrowser(settings, { root, reuse: true, run: async () => {} });
  });

  it("rejects path traversal, role collisions, and symlink output cleanup", async () => {
    const { root } = await fixture();
    expect(() => browserSettings("../outside")).toThrow(/role/);
    expect(() =>
      browserSettings("core", { env: { OPENROUND_NEXT_DIST_DIR: ".next-browser-beta" } }),
    ).toThrow(/do not match/);
    expect(() => browserSettings("core", { webPort: "3100; exit 0" })).toThrow(/ports/);
    await expect(preparePlaywrightNext(join(root, "apps/web"), "../../outside")).rejects.toThrow(
      /unexpected/,
    );
    await mkdir(join(root, "outside"));
    await symlink(join(root, "outside"), join(root, "apps/web/.next-browser-core"));
    await expect(
      preparePlaywrightNext(join(root, "apps/web"), ".next-browser-core"),
    ).rejects.toThrow(/symbolic link/);
  });
});
