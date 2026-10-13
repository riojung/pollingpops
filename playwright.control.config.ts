import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/control-e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  outputDir: "test-results/control",
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:3302",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium-control", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command:
        "NODE_ENV=test PORT=4300 WEB_ORIGIN=http://127.0.0.1:3300 PUBLIC_API_URL=http://127.0.0.1:4300 CONTROL_PUBLIC_ORIGIN=http://127.0.0.1:3302 pnpm exec tsx apps/server/test/fixtures/business-browser-server.ts",
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
    {
      command:
        "PLAYWRIGHT_CONTROL=true CONTROL_ENABLED=true CONTROL_PUBLIC_ORIGIN=http://127.0.0.1:3302 CONTROL_ALLOW_LOCAL_HTTP=true CONTROL_DATABASE_URL=postgresql://synthetic@127.0.0.1:1/unused OPERATOR_OIDC_ISSUER=http://127.0.0.1:3303 OPERATOR_OIDC_CLIENT_ID=operator-test OPERATOR_OIDC_CLIENT_SECRET=synthetic-test-secret OPERATOR_OIDC_MFA_POLICY_ENFORCED=true OPERATOR_OIDC_REQUIRED_AMR=pwd,mfa pnpm --filter @openround/control exec next dev --webpack -p 3302",
      port: 3302,
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
