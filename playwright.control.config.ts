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
  webServer: {
    command:
      "PLAYWRIGHT_CONTROL=true CONTROL_ENABLED=true CONTROL_PUBLIC_ORIGIN=http://127.0.0.1:3302 CONTROL_ALLOW_LOCAL_HTTP=true CONTROL_DATABASE_URL=postgresql://synthetic@127.0.0.1:1/unused OPERATOR_OIDC_ISSUER=http://127.0.0.1:3303 OPERATOR_OIDC_CLIENT_ID=operator-test OPERATOR_OIDC_CLIENT_SECRET=synthetic-test-secret OPERATOR_OIDC_MFA_POLICY_ENFORCED=true OPERATOR_OIDC_REQUIRED_AMR=pwd,mfa pnpm --filter @openround/control exec next dev --webpack -p 3302",
    port: 3302,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
