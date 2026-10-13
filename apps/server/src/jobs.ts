import { loadConfig } from "./config.js";
import { startTelemetry } from "./tracing.js";
import { createJobsRuntime } from "./jobs-runtime.js";

const config = loadConfig();
const telemetry = startTelemetry(config);
const runtime = await createJobsRuntime(config, (name, error) => {
  // Provider responses may contain personal information or credentials.
  console.error(
    JSON.stringify({
      level: "error",
      job: name,
      errorType: error instanceof Error ? error.name : "unknown",
    }),
  );
});
runtime.runner.start();
console.info(JSON.stringify({ level: "info", process: "jobs", status: "started" }));

let closing: Promise<void> | null = null;
function close() {
  closing ??= runtime.close().finally(() => telemetry.shutdown());
  void closing.catch(() => {
    process.exitCode = 1;
  });
}
process.once("SIGTERM", close);
process.once("SIGINT", close);

// Job intervals are unref'ed so the API can drain; this standalone runtime owns its lifetime.
const keepAlive = setInterval(() => undefined, 60_000);
process.once("SIGTERM", () => clearInterval(keepAlive));
process.once("SIGINT", () => clearInterval(keepAlive));
