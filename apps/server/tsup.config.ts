import { defineConfig } from "tsup";

export default defineConfig({
  entry: [
    "src/index.ts",
    "src/jobs.ts",
    "src/migrate.ts",
    "src/config-check.ts",
    "src/staging-capacity-provision.ts",
    "src/source-extraction.ts",
    "src/source-extraction-worker.ts",
  ],
  format: ["esm"],
  platform: "node",
  target: "node22",
  sourcemap: true,
  clean: true,
  noExternal: [
    "@openround/contracts",
    "@openround/control-plane",
    "@openround/db",
    "@openround/experience",
    "@openround/game-engine",
    "@openround/insights",
  ],
  // The database package is bundled into the server, but node-postgres must stay
  // external because its CommonJS runtime performs legitimate dynamic requires.
  external: ["pg"],
});
