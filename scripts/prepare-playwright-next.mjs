import { lstat, readdir, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL, URL } from "node:url";

// Call only while holding the shared Next output lock. The compiler owns cache
// invalidation; removing it here made every browser phase a cold build.
export async function preparePlaywrightNext(webDirectory, dist) {
  if (!/^\.next-browser-(?:core|beta)$/.test(dist))
    throw new Error("Refusing to clean an unexpected browser output directory");
  const output = resolve(webDirectory, dist);
  if (dirname(output) !== resolve(webDirectory))
    throw new Error("Browser output must stay inside the web application");
  try {
    if ((await lstat(output)).isSymbolicLink())
      throw new Error("Browser output must not be a symbolic link");
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }
  for (const entry of await readdir(output)) {
    if (entry === "cache" && (await lstat(resolve(output, entry))).isDirectory()) continue;
    await rm(resolve(output, entry), {
      force: true,
      maxRetries: 3,
      recursive: true,
      retryDelay: 100,
    });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const role = process.argv[2];
  if (!["core", "beta"].includes(role)) throw new Error("Expected browser role core or beta");
  const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
  const { withNextBuildLock } = await import("./build/next.mjs");
  const dist = `.next-browser-${role}`;
  await withNextBuildLock("web", dist, () =>
    preparePlaywrightNext(resolve(repositoryRoot, "apps/web"), dist),
  );
}
