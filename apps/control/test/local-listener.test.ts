import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

async function packageScripts() {
  const manifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  return manifest.scripts as Record<string, string>;
}

describe("local admin listener isolation", () => {
  it.each(["dev", "start"])(
    "binds the native %s command to loopback on port 3002",
    async (name) => {
      const scripts = await packageScripts();
      const arguments_ = scripts[name]!.split(/\s+/);
      expect(arguments_.slice(0, 2)).toEqual(["next", name]);
      expect(arguments_).toContain("--hostname");
      expect(arguments_[arguments_.indexOf("--hostname") + 1]).toBe("127.0.0.1");
      expect(arguments_[arguments_.indexOf("--port") + 1]).toBe("3002");
    },
  );

  it("documents native startup through the package's loopback development command", async () => {
    const readme = await readFile(new URL("../README.md", import.meta.url), "utf8");
    const localRecipe = readme.split("## Local development authentication")[1]!.split("## ")[0]!;
    expect(readme).toContain("pnpm --filter @openround/control dev");
    expect(localRecipe).toContain("CONTROL_AUTH_MODE=local");
    expect(localRecipe).toContain("CONTROL_PUBLIC_ORIGIN=http://localhost:3002");
    expect(localRecipe).toContain("pnpm exec turbo run dev --parallel --env-mode=loose");
    const scripts = await packageScripts();
    expect(scripts.dev).toMatch(/--hostname 127\.0\.0\.1(?:\s|$)/);
  });

  it("binds the local admin browser control process explicitly to loopback", async () => {
    const browserConfig = await readFile(
      new URL("../../../playwright.local-admin.config.ts", import.meta.url),
      "utf8",
    );
    const command = browserConfig
      .split("\n")
      .find((line) => line.includes("pnpm --filter @openround/control exec next dev"));
    expect(command).toBeDefined();
    expect(command).toContain("CONTROL_AUTH_MODE=local");
    expect(command).toMatch(/next dev .*--hostname 127\.0\.0\.1(?:\s|$)/);
    expect(command).toContain("-p 3302");
  });

  it("keeps Docker's standalone listener independent of the native CLI defaults", async () => {
    const dockerfile = await readFile(new URL("../Dockerfile", import.meta.url), "utf8");
    expect(dockerfile).toContain("ENV HOSTNAME=0.0.0.0");
    expect(dockerfile).toContain('CMD ["node", "apps/control/server.js"]');
  });
});
