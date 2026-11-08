import { defineConfig, devices } from "@playwright/test";

const demoWebPort = 3200;
const demoApiPort = 4200;

export default defineConfig({
  testDir: "./tests/demo",
  fullyParallel: false,
  workers: 1,
  expect: { timeout: 15_000 },
  timeout: 10 * 60_000,
  retries: 0,
  reporter: "list",
  outputDir: "artifacts/pollingpops-demo/playwright",
  use: {
    baseURL: `http://127.0.0.1:${demoWebPort}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: `NODE_ENV=test PORT=${demoApiPort} ALLOW_IN_MEMORY=true COMMUNITY_MODE=true WEB_ORIGIN=http://127.0.0.1:${demoWebPort} PUBLIC_API_URL=http://127.0.0.1:${demoApiPort} LOG_LEVEL=silent pnpm --filter @openround/server dev`,
      port: demoApiPort,
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: `node scripts/build/browser.mjs dev beta ${demoWebPort} ${demoApiPort}`,
      gracefulShutdown: { signal: "SIGTERM", timeout: 10_000 },
      port: demoWebPort,
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
