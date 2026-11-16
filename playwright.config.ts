import { defineConfig, devices } from "@playwright/test";

const e2eWebPort = 3100;
const e2eApiPort = 4100;
const productionWeb = process.env.PLAYWRIGHT_PRODUCTION === "true";
const nextCommand = `node scripts/build/browser.mjs ${productionWeb ? "start" : "dev"} core ${e2eWebPort} ${e2eApiPort}`;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  // Bound CI resource usage; these fixtures create independent creator accounts.
  workers: process.env.CI ? 2 : undefined,
  forbidOnly: Boolean(process.env.CI),
  expect: { timeout: 10_000 },
  timeout: 60_000,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://127.0.0.1:${e2eWebPort}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    // Keep first-failure screenshots/traces, and record video only on CI retries.
    video: process.env.CI ? "on-first-retry" : "retain-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "chromium-mobile", use: { ...devices["Pixel 7"] } },
    { name: "webkit-mobile", use: { ...devices["iPhone 15"] } },
  ],
  webServer: [
    {
      command: `NODE_ENV=test PORT=${e2eApiPort} ALLOW_IN_MEMORY=true COMMUNITY_MODE=false WEB_ORIGIN=http://127.0.0.1:${e2eWebPort} PUBLIC_API_URL=http://127.0.0.1:${e2eApiPort} LOG_LEVEL=silent pnpm --filter @openround/server dev`,
      port: e2eApiPort,
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: nextCommand,
      gracefulShutdown: { signal: "SIGTERM", timeout: 10_000 },
      port: e2eWebPort,
      reuseExistingServer: false,
      timeout: productionWeb ? 180_000 : 120_000,
    },
  ],
});
