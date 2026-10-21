import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:http";
import { once } from "node:events";

async function availablePort() {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Could not reserve a test port");
  const { port } = address;
  server.close();
  await once(server, "close");
  return port;
}

async function waitForExit(child: ChildProcess, timeoutMs = 15_000) {
  if (child.exitCode !== null) return;
  let timeout: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      once(child, "exit"),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error("Server shutdown timed out")), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function main() {
  const apiPort = await availablePort();
  let exportedBytes = 0;
  let exportedPath = "";
  const collector = createServer((request, response) => {
    exportedPath = request.url ?? "";
    request.on("data", (chunk: Buffer) => {
      exportedBytes += chunk.byteLength;
    });
    request.on("end", () => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end("{}");
    });
  });
  collector.listen(0, "127.0.0.1");
  await once(collector, "listening");
  const collectorAddress = collector.address();
  if (!collectorAddress || typeof collectorAddress === "string") {
    throw new Error("The trace collector did not bind");
  }

  const origin = `http://127.0.0.1:${apiPort}`;
  const child = spawn(process.execPath, ["apps/server/dist/index.js"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      NODE_ENV: "test",
      HOST: "127.0.0.1",
      PORT: String(apiPort),
      WEB_ORIGIN: origin,
      PUBLIC_API_URL: origin,
      ALLOW_IN_MEMORY: "true",
      LOG_LEVEL: "silent",
      METRICS_ENABLED: "false",
      TRACING_ENABLED: "true",
      OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: `http://127.0.0.1:${collectorAddress.port}/v1/traces`,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let childOutput = "";
  child.stdout.on("data", (chunk: Buffer) => {
    childOutput += chunk.toString("utf8");
  });
  child.stderr.on("data", (chunk: Buffer) => {
    childOutput += chunk.toString("utf8");
  });

  try {
    let ready = false;
    for (let attempt = 0; attempt < 50; attempt += 1) {
      if (child.exitCode !== null) throw new Error(`Traced server exited early: ${childOutput}`);
      try {
        const response = await fetch(`${origin}/health/ready`);
        if (response.ok) {
          ready = true;
          break;
        }
      } catch {
        // The listener may still be starting.
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.equal(ready, true, `Traced server did not become ready: ${childOutput}`);
    const traced = await fetch(`${origin}/v1/auth/email-verification`, {
      method: "POST",
      headers: { "content-type": "application/json", origin },
      body: JSON.stringify({
        email: "trace-smoke@example.com",
        segment: "workplace",
        acceptPolicies: true,
      }),
    });
    assert.equal(traced.status, 202, await traced.text());
    child.kill("SIGTERM");
    await waitForExit(child);
    assert.equal(child.exitCode, 0, childOutput);
    assert.equal(exportedPath, "/v1/traces");
    assert.ok(exportedBytes > 0, "The OTLP collector received no trace payload");
  } finally {
    if (child.exitCode === null) {
      child.kill("SIGKILL");
      await waitForExit(child, 5_000).catch(() => undefined);
    }
    collector.close();
    await once(collector, "close");
  }

  process.stdout.write(`OTLP trace smoke passed (${exportedBytes} protobuf bytes).\n`);
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
