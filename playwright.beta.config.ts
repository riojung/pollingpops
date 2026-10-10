import { defineConfig, devices } from "@playwright/test";

const betaE2eWebPort = Number(process.env.BETA_E2E_WEB_PORT ?? 3200);
const betaE2eApiPort = Number(process.env.BETA_E2E_API_PORT ?? 4200);
const betaWorkspaceId = "00000000-0000-4000-8000-00000000b001";
const productionWeb = process.env.PLAYWRIGHT_PRODUCTION === "true";
// Opt-in source-authoring tests own a loopback provider; ordinary beta runs stay disabled.
const authoringFixture = process.env.BETA_E2E_AUTHORING === "true";
const authoringPort = Number(process.env.BETA_E2E_AUTHORING_PORT ?? betaE2eApiPort + 2);
const authoringEnvironment = authoringFixture
  ? `ALLOW_INSECURE_LOCAL_HTTP=true AUTHORING_AI_MODE=openai_compatible AUTHORING_AI_ENDPOINT=http://127.0.0.1:${authoringPort}/chat/completions AUTHORING_AI_PROVIDER_NAME=beta-fixture AUTHORING_AI_MODEL=synthetic-source-fixture`
  : "";
const audienceEnvironment = `FEATURE_AUDIENCE_SCOPES=true FEATURE_FEEDBACK_ROOMS=true FEATURE_SURVEYS=true CORE_PARITY_WORKSPACE_ALLOWLIST=${betaWorkspaceId}`;
const nextCommand = productionWeb
  ? `NEXT_PUBLIC_API_URL=http://127.0.0.1:${betaE2eApiPort} pnpm --filter @openround/web build && cp -r apps/web/public apps/web/.next/standalone/apps/web/public && cp -r apps/web/.next/static apps/web/.next/standalone/apps/web/.next/static && PORT=${betaE2eWebPort} HOSTNAME=127.0.0.1 node apps/web/.next/standalone/apps/web/server.js`
  : `NEXT_PUBLIC_API_URL=http://127.0.0.1:${betaE2eApiPort} pnpm --filter @openround/web exec next dev -p ${betaE2eWebPort}`;

export default defineConfig({
  testDir: "./tests/beta-e2e",
  fullyParallel: false,
  // Locale and whole-workspace evidence assertions share one seeded beta account.
  // Do not increase concurrency until those fixtures have independent workspaces.
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  expect: { timeout: 10_000 },
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  outputDir: "test-results-beta",
  reporter: process.env.CI
    ? [["github"], ["html", { open: "never", outputFolder: "playwright-report-beta" }]]
    : "list",
  use: {
    baseURL: `http://127.0.0.1:${betaE2eWebPort}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: process.env.CI ? "on-first-retry" : "retain-on-failure",
  },
  projects: [
    {
      name: "chromium-beta",
      grepInvert: /@mobile/,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "firefox-beta",
      grepInvert: /@mobile/,
      use: { ...devices["Desktop Firefox"] },
    },
    {
      name: "chromium-beta-mobile",
      grep: /@mobile/,
      use: {
        ...devices["Pixel 5"],
        viewport: { width: 390, height: 844 },
      },
    },
    {
      name: "webkit-beta-mobile",
      grep: /@mobile/,
      use: {
        ...devices["iPhone 15"],
        viewport: { width: 390, height: 844 },
      },
    },
  ],
  webServer: [
    {
      command: `NODE_ENV=test PORT=${betaE2eApiPort} ALLOW_IN_MEMORY=true COMMUNITY_MODE=false WEB_ORIGIN=http://127.0.0.1:${betaE2eWebPort} PUBLIC_API_URL=http://127.0.0.1:${betaE2eApiPort} FEATURE_UX_BETA=true FEATURE_RECOVERY_REHEARSAL=true FEATURE_PRACTICE_ASSIGNMENTS=true FEATURE_WORKSPACE_SHELL=true FEATURE_BUILDER_V2=true FEATURE_PRESENTATIONS=true FEATURE_PRESENTATION_REALTIME=true FEATURE_PRESENTATION_COMPANION=true FEATURE_LIVE_FLEX_MODE=true FEATURE_GROUPS=true FEATURE_DISCOVER=true FEATURE_QUESTION_HEALTH=true FEATURE_RECOVERY_PACKS=true FEATURE_RECOVERY_PACK_LIVE_CARDS=true UX_BETA_WORKSPACE_ALLOWLIST=${betaWorkspaceId} EVIDENCE_FEATURES_WORKSPACE_ALLOWLIST=${betaWorkspaceId} TEST_INITIAL_WORKSPACE_ID=${betaWorkspaceId} TEST_INITIAL_PLAN=pro LOG_LEVEL=silent ${audienceEnvironment} ${authoringEnvironment} pnpm --filter @openround/server dev`,
      port: betaE2eApiPort,
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: `node scripts/prepare-playwright-next.mjs && ${nextCommand}`,
      port: betaE2eWebPort,
      reuseExistingServer: false,
      timeout: productionWeb ? 180_000 : 120_000,
    },
  ],
});
