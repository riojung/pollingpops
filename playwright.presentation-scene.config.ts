import { defineConfig, devices } from "@playwright/test";

const scenePort = Number(process.env.PRESENTATION_SCENE_WEB_PORT ?? 3350);

export default defineConfig({
  testDir: "./tests/presentation-scene-e2e",
  workers: 1,
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: "list",
  use: {
    baseURL: `http://127.0.0.1:${scenePort}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "scene-chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "scene-firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "scene-mobile", use: { ...devices["Pixel 7"] } },
    { name: "scene-webkit", use: { ...devices["iPhone 15"] } },
  ],
  webServer: {
    command: `CANVAS_COLLAB_DIST_DIR=.next-canvas-capacity-scene-lab pnpm --filter @openround/web exec next dev --hostname 127.0.0.1 --port ${scenePort}`,
    url: `http://127.0.0.1:${scenePort}/dev/presentation-scene`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
