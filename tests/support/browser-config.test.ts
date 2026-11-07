import { readFile } from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PlaywrightTestConfig } from "@playwright/test";

async function browserConfigs(ci: boolean, production: boolean) {
  vi.stubEnv("CI", ci ? "true" : "");
  vi.stubEnv("PLAYWRIGHT_PRODUCTION", production ? "true" : "");
  vi.stubEnv("BETA_E2E_WEB_PORT", "3200");
  vi.stubEnv("BETA_E2E_API_PORT", "4200");
  vi.resetModules();
  const [featureOff, beta] = await Promise.all([
    import("../../playwright.config"),
    import("../../playwright.beta.config"),
  ]);
  return [featureOff.default, beta.default] as const;
}

function servers(config: PlaywrightTestConfig) {
  if (!Array.isArray(config.webServer)) throw new Error("Expected one API and one web server");
  return config.webServer;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("browser CI scheduling and serving", () => {
  it("keeps protocol writers off locally and explicitly enables their beta CI coverage", async () => {
    vi.stubEnv("BETA_E2E_ROUND_PROTOCOL", "");
    const [, legacy] = await browserConfigs(false, false);
    expect(servers(legacy)[0]!.command).toContain("FEATURE_ROUND_CLIENT_PROTOCOL=false");
    vi.stubEnv("BETA_E2E_ROUND_PROTOCOL", "true");
    const [, enabled] = await browserConfigs(true, false);
    expect(servers(enabled)[0]!.command).toContain("FEATURE_ROUND_CLIENT_PROTOCOL=true");
    expect(servers(enabled)[0]!.command).toContain("CORE_PARITY_WORKSPACE_ALLOWLIST=");
    const workflow = await readFile(
      new URL("../../.github/workflows/ci.yml", import.meta.url),
      "utf8",
    );
    expect(workflow).toContain('BETA_E2E_ROUND_PROTOCOL: "true"');
  });
  it("runs every beta profile in one invocation without concurrent shared-account mutations", async () => {
    const manifest = JSON.parse(
      await readFile(new URL("../../package.json", import.meta.url), "utf8"),
    ) as { scripts: Record<string, string> };
    expect(manifest.scripts["test:e2e:beta"]).toBe(
      "playwright test --config=playwright.beta.config.ts",
    );
    const [, beta] = await browserConfigs(true, false);
    expect(beta.workers).toBe(1);
    expect(beta.fullyParallel).toBe(false);
    expect(beta.projects?.map((project) => project.name)).toEqual([
      "chromium-beta",
      "firefox-beta",
      "chromium-beta-mobile",
      "webkit-beta-mobile",
    ]);
    expect(beta.projects?.slice(0, 2).map((project) => String(project.grepInvert))).toEqual([
      "/@mobile/",
      "/@mobile/",
    ]);
    expect(beta.projects?.slice(2).map((project) => String(project.grep))).toEqual([
      "/@mobile/",
      "/@mobile/",
    ]);
  });

  it("bounds independent feature-off CI workers and preserves failure diagnostics", async () => {
    const [featureOff, beta] = await browserConfigs(true, false);
    expect(featureOff.workers).toBe(2);
    expect(featureOff.projects?.map((project) => project.name)).toEqual([
      "chromium",
      "firefox",
      "chromium-mobile",
      "webkit-mobile",
    ]);
    for (const config of [featureOff, beta]) {
      expect(config.forbidOnly).toBe(true);
      expect(config.use?.trace).toBe("retain-on-failure");
      expect(config.use?.screenshot).toBe("only-on-failure");
      expect(config.use?.video).toBe("on-first-retry");
      expect(servers(config)).toHaveLength(2);
      expect(servers(config).every((server) => server.reuseExistingServer === false)).toBe(true);
    }
  });

  it("selects isolated production browser roles with the correct ports", async () => {
    const configs = await browserConfigs(true, true);
    for (const [index, config] of configs.entries()) {
      const [api, web] = servers(config);
      const apiPort = index === 0 ? 4100 : 4200;
      const webPort = index === 0 ? 3100 : 3200;
      expect(api.command).toContain("NODE_ENV=test");
      expect(web.command).toBe(
        `node scripts/build/browser.mjs start ${index === 0 ? "core" : "beta"} ${webPort} ${apiPort}`,
      );
      expect(web.gracefulShutdown).toEqual({ signal: "SIGTERM", timeout: 10_000 });
      expect(web.timeout).toBe(180_000);
    }
  });

  it("keeps local development mode unless production serving is explicitly selected", async () => {
    const [featureOff, beta] = await browserConfigs(false, false);
    expect(featureOff.workers).toBeUndefined();
    for (const config of [featureOff, beta]) {
      const [, web] = servers(config);
      expect(web.command).toMatch(/^node scripts\/build\/browser.mjs dev (core|beta) /);
      expect(web.gracefulShutdown).toEqual({ signal: "SIGTERM", timeout: 10_000 });
      expect(web.timeout).toBe(120_000);
      expect(config.use?.video).toBe("retain-on-failure");
    }
  });
});
