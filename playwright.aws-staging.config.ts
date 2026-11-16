import { defineConfig, devices } from "@playwright/test";

// Uses the already-running, isolated Docker stack. No in-memory app fixtures.
export default defineConfig({
  testDir: "./tests/aws-staging-e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: true,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: "list",
  outputDir: "test-results-aws-staging",
  use: { baseURL: "http://localhost:19180", trace: "off" },
  projects: [{ name: "aws-staging-chromium", use: { ...devices["Desktop Chrome"] } }],
});
