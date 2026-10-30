import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/canvas-e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  retries: 0,
  outputDir: "test-results-business/canvas",
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:3400",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },
  projects: [
    { name: "chromium-canvas", grepInvert: /@mobile/, use: { ...devices["Desktop Chrome"] } },
    {
      name: "chromium-canvas-mobile",
      grep: /@mobile/,
      use: { ...devices["Pixel 7"], viewport: { width: 390, height: 844 } },
    },
    {
      name: "webkit-canvas-mobile",
      grep: /@mobile/,
      use: { ...devices["iPhone 15"], viewport: { width: 390, height: 844 } },
    },
  ],
  webServer: [
    {
      command:
        "NODE_ENV=test CANVAS_BROWSER_FIXTURE=true CANVAS_BROWSER_IMAGES=true PORT=4400 WEB_ORIGIN=http://127.0.0.1:3400 PUBLIC_API_URL=http://127.0.0.1:4400 pnpm exec tsx apps/server/test/fixtures/business-browser-server.ts",
      port: 4400,
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command:
        "PLAYWRIGHT_BUSINESS=true NEXT_PUBLIC_API_URL=http://127.0.0.1:4400 pnpm --filter @openround/web exec next dev -p 3400",
      port: 3400,
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
