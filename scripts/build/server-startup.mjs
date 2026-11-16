import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import process from "node:process";
import { fileURLToPath, URL } from "node:url";

// This is the hosted CI configuration fixture. Keep it isolated from local secrets
// and run the already-built server: importing its shared chunks must work in Node.
const result = spawnSync(process.execPath, ["dist/config-check.js"], {
  cwd: fileURLToPath(new URL("../../apps/server/", import.meta.url)),
  env: {
    NODE_ENV: "production",
    DATABASE_URL: "postgresql://runtime:example@database.internal/openround",
    REDIS_URL: "rediss://cache.internal:6380",
    WEB_ORIGIN: "https://quiz.example.ca",
    PUBLIC_API_URL: "https://api.example.ca",
    COOKIE_SECURE: "true",
    FEATURE_SIGNUPS: "false",
    METRICS_ENABLED: "false",
  },
  encoding: "utf8",
  timeout: 30_000,
});
if (result.error) throw result.error;
if (result.status !== 0) {
  process.stderr.write(result.stderr);
  throw new Error(
    "Compiled server startup/configuration smoke failed; run pnpm build:server first",
  );
}
const summary = JSON.parse(result.stdout);
assert.equal(summary.valid, true);
assert.equal(summary.nodeEnvironment, "production");
assert.equal(summary.persistence, "postgresql");
assert.equal(summary.coordination, "redis-streams");
assert.equal(summary.webOrigin, "https://quiz.example.ca");
assert.equal(summary.publicApiUrl, "https://api.example.ca");
process.stdout.write("Compiled server startup/configuration smoke passed.\n");
