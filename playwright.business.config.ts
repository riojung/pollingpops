import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/business-e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  retries: 0,
  outputDir: "test-results-business",
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:3300",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium-business", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command:
        "NODE_ENV=test PORT=4300 WEB_ORIGIN=http://127.0.0.1:3300 PUBLIC_API_URL=http://127.0.0.1:4300 pnpm exec tsx apps/server/test/fixtures/business-browser-server.ts",
      port: 4300,
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command:
        "PLAYWRIGHT_BUSINESS=true NEXT_PUBLIC_API_URL=http://127.0.0.1:4300 pnpm --filter @openround/web exec next dev -p 3300",
      port: 3300,
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
