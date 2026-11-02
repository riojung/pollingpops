import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, it } from "vitest";
import { parseCanvasTargetConfig } from "../load/canvas-target-config.ts";

const root = resolve(import.meta.dirname, "../..");

it("refuses an existing target report before any network request and preserves its exact bytes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pollingpops-canvas-target-output-")),
    reportPath = join(directory, "existing-report.json"),
    configPath = join(directory, "private-config.json"),
    original = Buffer.from("Previously retained evidence\n\0must not be truncated\n");
  let requests = 0,
    child: ChildProcess | undefined,
    closed: Promise<{ code: number | null; signal: NodeJS.Signals | null }> | undefined,
    deadline: ReturnType<typeof setTimeout> | undefined,
    force: ReturnType<typeof setTimeout> | undefined,
    timedOut = false;
  const server = createServer((_request, response) => {
    requests++;
    // If the destination guard regresses, stop preflight before browser creation.
    response.writeHead(503, { "content-type": "application/json" });
    response.end("{}");
  });
  try {
    await new Promise<void>((done, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", done);
    });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Test listener did not bind");
    const origin = `http://127.0.0.1:${address.port}`;
    const config = parseCanvasTargetConfig({
      schemaVersion: 1,
      mode: "local-rehearsal",
      confirm: "dedicated-synthetic-only",
      expectedBuildId: "unversioned",
      apiOrigin: origin,
      webOrigin: origin,
      workspaceId: randomUUID(),
      profile: "smoke",
      durationSeconds: 30,
      waveIntervalMs: 5000,
      actors: [0, 1].map((index) => ({
        userId: randomUUID(),
        cookieEnv: `CANVAS_TARGET_COOKIE_OUTPUT_${index}`,
      })),
      boards: [{ boardId: randomUUID(), targetObjectIds: [randomUUID(), randomUUID()] }],
    });
    await writeFile(configPath, JSON.stringify(config), { mode: 0o600, flag: "wx" });
    await writeFile(reportPath, original, { mode: 0o600, flag: "wx" });
    child = spawn(
      process.execPath,
      [
        "--import",
        resolve(root, "node_modules/tsx/dist/loader.mjs"),
        resolve(root, "tests/load/canvas-target-capacity.mts"),
      ],
      {
        cwd: root,
        env: {
          ...process.env,
          CANVAS_TARGET_CONFIG: configPath,
          CANVAS_TARGET_OUTPUT: reportPath,
          CANVAS_TARGET_COOKIE_OUTPUT_0: "openround_creator=synthetic-output-one",
          CANVAS_TARGET_COOKIE_OUTPUT_1: "openround_creator=synthetic-output-two",
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    closed = new Promise((done, reject) => {
      child!.once("error", reject);
      child!.once("close", (code, signal) => done({ code, signal }));
    });
    let stdout = "",
      stderr = "";
    child.stdout!.on("data", (chunk: Buffer) => {
      stdout = (stdout + chunk.toString()).slice(0, 16_384);
    });
    child.stderr!.on("data", (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(0, 16_384);
    });
    deadline = setTimeout(() => {
      timedOut = true;
      child!.kill("SIGTERM");
      force = setTimeout(() => child!.kill("SIGKILL"), 500);
    }, 10_000);
    const result = await closed;
    clearTimeout(deadline);
    clearTimeout(force);
    expect(timedOut).toBe(false);
    expect(result).toEqual({ code: 1, signal: null });
    expect(stderr.trim()).toBe('{"code":"OUTPUT_FAILED"}');
    expect(stdout).toBe("");
    expect(await readFile(reportPath)).toEqual(original);
    expect(requests).toBe(0);
  } finally {
    clearTimeout(deadline);
    clearTimeout(force);
    if (child && child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    await closed?.catch(() => {});
    server.closeAllConnections();
    if (server.listening) await new Promise<void>((done) => server.close(() => done()));
    await rm(directory, { recursive: true, force: true });
  }
}, 15_000);
