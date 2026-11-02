/**
 * Opt-in real HTTP / production-browser evidence at EXISTING limits.
 * Requires disposable loopback PostgreSQL17 admin/runtime URLs and real Valkey.
 * See emitted measurementDefinitions/limitations; this never authorizes a cap increase.
 */
import assert from "node:assert/strict";
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createWriteStream, readFileSync, existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { arch, cpus, platform, release, totalmem } from "node:os";
import { resolve } from "node:path";
import {
  chromium,
  type Browser,
  type BrowserContext,
  type CDPSession,
  type Page,
} from "@playwright/test";
import {
  CANVAS_SCHEMA_VERSION,
  type CanvasBoardMutation,
} from "../../packages/contracts/src/index.ts";
import {
  canvasCapacityDistribution,
  canvasCapacityMutation,
  canvasCapacityText,
} from "./canvas-capacity.ts";
import {
  createCanvasCollaborationFixture,
  stalledCanvasConsumer,
} from "./canvas-collaboration-fixture.mts";
import {
  evaluateCollaborationGates,
  parseCanvasCollaborationConfig,
  type CollaborationMetric,
} from "./canvas-collaboration-config.ts";
import {
  CanvasCollaborationProfiler,
  parseCanvasProfileConfig,
} from "./canvas-collaboration-profile.ts";
import {
  canvasSoakReceiptPlan,
  minimumSoakStreamOpens,
  parseCanvasSoakConfig,
} from "./canvas-soak-config.ts";
import type { PostgresRepository } from "../../packages/db/src/index.ts";
import type {
  CanvasFacilitationCommand,
  CanvasFacilitationView,
} from "../../packages/contracts/src/canvas-facilitation.ts";

declare global {
  interface Window {
    __canvasCapacityPaint: (operationId: string) => Promise<void>;
    __capacityFrames: number[];
    __capacitySampling: boolean;
  }
}

const root = resolve(import.meta.dirname, "../..");
const config = parseCanvasCollaborationConfig(process.env);
const soak = parseCanvasSoakConfig(process.env, config.editors);
const profiler = new CanvasCollaborationProfiler(parseCanvasProfileConfig(process.env));
const output = resolve(
  process.env.CANVAS_COLLAB_OUTPUT ?? `/tmp/pollingpops-canvas-collaboration-${Date.now()}.json`,
);
const evidenceDir = `${output.replace(/\.json$/, "")}-artifacts`;
const api = `http://127.0.0.1:${config.apiPort}`;
const web = `http://127.0.0.1:${config.webPort}`;
const next = resolve(root, "apps/web/node_modules/next/dist/bin/next");
let stage = "initializing";
const pause = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));
const nextEnv = {
  ...process.env,
  NODE_ENV: "production",
  NEXT_TELEMETRY_DISABLED: "1",
  NEXT_PUBLIC_API_URL: api,
  CANVAS_COLLAB_DIST_DIR: config.distDir,
  PLAYWRIGHT_BUSINESS: "false",
};
function source() {
  const git = (args: string[]) =>
    execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  return {
    revision: git(["rev-parse", "HEAD"]),
    workingTreeDirty: Boolean(git(["status", "--porcelain"])),
  };
}
function sourceFingerprint(scopes: string[]) {
  const names = execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "--", ...scopes],
    { cwd: root, encoding: "utf8" },
  )
    .trim()
    .split("\n");
  const hash = createHash("sha256");
  for (const name of [...new Set(names)].sort()) {
    hash.update(name);
    hash.update("\0");
    hash.update(existsSync(resolve(root, name)) ? readFileSync(resolve(root, name)) : "<deleted>");
  }
  return hash.digest("hex");
}
function browserSourceFingerprint() {
  return sourceFingerprint([
    "apps/web/app",
    "apps/web/components",
    "apps/web/lib",
    "apps/web/public",
    "apps/web/next.config.ts",
    "apps/web/proxy.ts",
    "apps/web/package.json",
    "packages/contracts/src",
    "packages/experience/src",
    "packages/rehearsal/src",
    "pnpm-lock.yaml",
  ]);
}
function startNext(args: string[], log: string) {
  const stream = createWriteStream(resolve(evidenceDir, log));
  const child = spawn(process.execPath, [next, ...args], {
    cwd: resolve(root, "apps/web"),
    env: nextEnv,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout!.pipe(stream, { end: false });
  child.stderr!.pipe(stream, { end: false });
  child.once("close", () => stream.end());
  return child;
}
async function exited(child: ChildProcess) {
  return new Promise<void>((done, reject) => {
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0 ? done() : reject(new Error("Production Next build exited unsuccessfully")),
    );
  });
}
async function stop(child: ChildProcess | undefined) {
  if (!child || child.exitCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([new Promise<void>((done) => child.once("exit", () => done())), pause(5000)]);
  if (child.exitCode === null) child.kill("SIGKILL");
}
async function ready(child: ChildProcess) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (child.exitCode !== null) throw new Error("Production Next server exited before readiness");
    try {
      if ((await fetch(`${web}/signin`, { signal: AbortSignal.timeout(1000) })).ok) return;
    } catch {
      /* bounded startup */
    }
    await pause(200);
  }
  throw new Error("Production Next readiness timed out");
}
type Fixture = Awaited<ReturnType<typeof createCanvasCollaborationFixture>>;
interface PaintWait {
  promise: Promise<void>;
  resolve: () => void;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}
const waits = new Map<string, PaintWait>();
const browserErrors: string[] = [];
let fixture: Fixture | undefined;
let browser: Browser | undefined;
let server: ChildProcess | undefined;
let stalled: Awaited<ReturnType<typeof stalledCanvasConsumer>> | undefined;
const contexts: BrowserContext[] = [];
const streamRequests = new Map<Page, number>();
const successfulStreamOpens = new Map<Page, number>();
const networkSessions = new Map<Page, CDPSession>();
const measured: Partial<
  Record<CollaborationMetric, ReturnType<typeof canvasCapacityDistribution>>
> = {};
const allAck: number[] = [],
  peerPaint: number[] = [],
  initialRender: number[] = [],
  navigationFrames: number[] = [];
const sampleRecords: Array<{
  operationId: string;
  editor: number;
  wave: number;
  acknowledgementMs: number;
  repositoryResolutionToPaintOpportunityMs: number;
  observerActorIndex: number;
  writerLogicalNode: 0 | 1;
  observerLogicalNode: 0 | 1;
  crossNode: boolean;
  selfObservation: boolean;
}> = [];
const peerObservationCounts = { crossNode: 0, sameNodePeer: 0, self: 0 };
const rssHighWater = { rss: 0, heapUsed: 0 };
function observeMemory() {
  const memory = process.memoryUsage();
  rssHighWater.rss = Math.max(rssHighWater.rss, memory.rss);
  rssHighWater.heapUsed = Math.max(rssHighWater.heapUsed, memory.heapUsed);
}

const sampledStreamEvents = [
  "opened",
  "closed",
  "backpressure",
  "revoked",
  "unavailable",
  "reconnect_requested",
] as const;
interface SoakResourceSample {
  elapsedMs: number;
  rssBytes: number;
  heapUsedBytes: number;
  pools: Array<{ node: number; total: number; idle: number; waiting: number }>;
  streamEvents: Record<(typeof sampledStreamEvents)[number], number>;
}
function newSoakObservation(receiptBudget: ReturnType<typeof canvasSoakReceiptPlan>) {
  return {
    mode: soak.mode,
    requestedDurationMs: soak.seconds * 1000,
    syntheticCreatorSessionLifetimeMs: soak.creatorSessionLifetimeMs,
    observedDurationMs: 0,
    waveIntervalMs: soak.waveIntervalMs,
    plannedWaves: soak.plannedWaves,
    observedWaves: 0,
    startedWaves: 0,
    observedCommands: 0,
    durationOverrunMs: 0,
    observedWaveStartIntervalsMs: [] as number[],
    churn: {
      intervalMs: soak.churnIntervalMs,
      commandsPerRound: 6,
      completedRounds: 0,
      completedCommands: 0,
      maximumRetainedThreads: receiptBudget.churnRounds,
      maximumConcurrentSavedVersions: 1,
    },
    resources: {
      intervalMs: soak.sampleIntervalMs,
      maximumSamples: Math.ceil((soak.seconds * 1000) / soak.sampleIntervalMs) + 2,
      droppedSamples: 0,
      unavailableSamples: 0,
      samples: [] as SoakResourceSample[],
    },
    streamReopens: {
      existingLifetimeMs: 300_000,
      finalBoundaryMarginMs: 10_000,
      minimumSuccessfulReopensPerActor: minimumSoakStreamOpens(soak.seconds) - 1,
      lifetimeReconnectRequestsAtStart: 0,
      lifetimeReconnectRequestsAtEnd: 0,
      actors: [] as Array<{
        actorIndex: number;
        successfulOpensAtStart: number;
        successfulOpensAtEnd: number;
        successfulReopensDuringWindow: number;
      }>,
      passed: false,
      scope:
        "Successful HTTP 200 stream responses per actor; counts do not attribute each reopen to a particular disconnect reason",
    },
    receiptBudget: {
      ...receiptBudget,
      observedSequenceBeforePostlude: null as number | null,
      observedFinalSequence: null as number | null,
    },
    allEditorContextsHeld: false,
    durationCompleted: false,
    observersPerUpdate: 1,
    designatedObserverActors: [0, 1],
    peerObservationCounts,
    allToAllObserved: false,
    fullWindowStalledConsumerClaimed: false,
    soakAcceptanceClaimed: false,
    deployedCapacityAccepted: false,
    capacityIncreaseAuthorized: false,
  };
}
let soakObservation: ReturnType<typeof newSoakObservation> | undefined;
let soakWindowStarted: number | undefined;
let soakSampler: ReturnType<typeof setInterval> | undefined;
function stopSoakSampler() {
  if (soakSampler !== undefined) clearInterval(soakSampler);
  soakSampler = undefined;
}
function sampleSoakResources() {
  if (!soakObservation || soakWindowStarted === undefined || !fixture) return;
  if (soakObservation.resources.samples.length >= soakObservation.resources.maximumSamples) {
    soakObservation.resources.droppedSamples++;
    return;
  }
  try {
    const memory = process.memoryUsage();
    soakObservation.resources.samples.push({
      elapsedMs: Math.round(performance.now() - soakWindowStarted),
      rssBytes: memory.rss,
      heapUsedBytes: memory.heapUsed,
      pools: fixture.apps.map((built, node) => {
        const pool = (built.repository as PostgresRepository).pool;
        return { node, total: pool.totalCount, idle: pool.idleCount, waiting: pool.waitingCount };
      }),
      streamEvents: Object.fromEntries(
        sampledStreamEvents.map((event) => [event, fixture!.streamEvents[event] ?? 0]),
      ) as SoakResourceSample["streamEvents"],
    });
    observeMemory();
  } catch {
    soakObservation.resources.unavailableSamples++;
  }
}

async function pageFor(index: number, token: string, cookie = true) {
  const context = await browser!.newContext({
    viewport: { width: 1440, height: 1000 },
    reducedMotion: "reduce",
    serviceWorkers: "block",
    locale: "en-CA",
  });
  contexts.push(context);
  if (cookie)
    await context.addCookies([
      {
        name: "openround_creator",
        value: token,
        domain: "127.0.0.1",
        path: "/",
        httpOnly: true,
        secure: false,
        sameSite: "Lax",
      },
    ]);
  if (index !== 0)
    await context.route(`${api}/**`, (route) =>
      route.continue({ url: route.request().url().replace(api, fixture!.peerApi) }),
    );
  const page = await context.newPage();
  // tsx preserves function names in serialized observer callbacks via this identity helper.
  // It belongs to measurement instrumentation, not the compiled product bundle.
  await page.addInitScript({ content: "globalThis.__name = (target) => target;" });
  page.setDefaultTimeout(config.timeoutMs);
  page.on("pageerror", (error) => browserErrors.push(error.name));
  page.on("request", (request) => {
    if (/\/canvas-boards\/.*\/events(?:\?|$)/.test(request.url()))
      streamRequests.set(page, (streamRequests.get(page) ?? 0) + 1);
  });
  if (soak.mode !== "disabled")
    page.on("response", (response) => {
      if (response.status() === 200 && /\/canvas-boards\/.*\/events(?:\?|$)/.test(response.url()))
        successfulStreamOpens.set(page, (successfulStreamOpens.get(page) ?? 0) + 1);
    });
  const cdp = await context.newCDPSession(page);
  networkSessions.set(page, cdp);
  await cdp.send("Network.enable");
  await cdp.send("Network.emulateNetworkConditions", {
    offline: false,
    latency: config.latencyMs,
    downloadThroughput: -1,
    uploadThroughput: -1,
    connectionType: "wifi",
  });
  await page.exposeBinding("__canvasCapacityPaint", (_source, id: string) => {
    const wait = waits.get(id);
    if (!wait) return;
    fixture!.ledger.paint(id, performance.now());
    clearTimeout(wait.timer);
    waits.delete(id);
    wait.resolve();
  });
  return page;
}
async function watch(
  page: Page,
  operationId: string,
  objectId: string,
  token: string,
  guest = false,
) {
  let resolveWait!: () => void, rejectWait!: (reason: Error) => void;
  const promise = new Promise<void>((done, reject) => {
    resolveWait = done;
    rejectWait = reject;
  });
  // Handle rejection immediately while the HTTP command is still pending.
  void promise.catch(() => {});
  const timer = setTimeout(() => {
    waits.delete(operationId);
    rejectWait(new Error("Authorized peer paint opportunity timed out"));
  }, config.timeoutMs);
  waits.set(operationId, { promise, resolve: resolveWait, reject: rejectWait, timer });
  await page.evaluate(
    ({ operationId, objectId, token, guest, continuous }) => {
      let scheduled = false;
      const observe = () => {
        const scope = guest
          ? document.querySelector('section[aria-label="Published canvas"]')
          : document;
        const element = scope?.querySelector(`[data-testid="canvas-object-${objectId}"]`);
        if (!element?.textContent?.includes(token) || scheduled) return;
        const box = element.getBoundingClientRect();
        const viewport = scope
          ?.querySelector('[data-testid="canvas-surface"]')
          ?.getBoundingClientRect();
        if (
          !viewport ||
          !box.width ||
          !box.height ||
          box.right <= Math.max(0, viewport.left) ||
          box.bottom <= Math.max(0, viewport.top) ||
          box.left >= Math.min(innerWidth, viewport.right) ||
          box.top >= Math.min(innerHeight, viewport.bottom)
        )
          return;
        scheduled = true;
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            if (!element.isConnected || !element.textContent?.includes(token)) {
              scheduled = false;
              observe();
              return;
            }
            observer.disconnect();
            if (continuous && expiry !== undefined) clearTimeout(expiry);
            void window.__canvasCapacityPaint(operationId);
          }),
        );
      };
      const observer = new MutationObserver(observe);
      observer.observe(document.body, { childList: true, characterData: true, subtree: true });
      observe();
      const expiry = setTimeout(() => observer.disconnect(), 120000);
    },
    { operationId, objectId, token, guest, continuous: soak.mode !== "disabled" },
  );
  return { promise };
}
async function browserCommand(
  page: Page,
  mutation: CanvasBoardMutation,
  boardId = fixture!.board.id,
) {
  return page.evaluate(
    async ({ api, boardId, mutation, timeoutMs }) => {
      const before = performance.now();
      const response = await fetch(`${api}/v1/canvas-boards/${boardId}/commands`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(mutation),
        signal: AbortSignal.timeout(timeoutMs),
      });
      const body = await response.json();
      if (!response.ok)
        throw new Error(
          `Canvas command rejected ${response.status} ${body.error?.code ?? "unknown"}`,
        );
      if (body.receipt.operationId !== mutation.operationId)
        throw new Error("Unexpected command receipt");
      return {
        milliseconds: performance.now() - before,
        canvasSeq: body.board.canvasSeq as number,
      };
    },
    { api, boardId, mutation, timeoutMs: config.timeoutMs },
  );
}
async function soakFacilitation(page: Page, command?: CanvasFacilitationCommand) {
  const operationId = randomUUID();
  const view = (await page.evaluate(
    async ({ api, boardId, command, operationId, timeoutMs }) => {
      const response = await fetch(
        `${api}/v1/canvas-boards/${boardId}/facilitation${command ? "/commands" : ""}`,
        {
          method: command ? "POST" : "GET",
          credentials: "include",
          headers: command ? { "content-type": "application/json" } : undefined,
          body: command ? JSON.stringify({ schemaVersion: 1, operationId, command }) : undefined,
          signal: AbortSignal.timeout(timeoutMs),
        },
      );
      const body = await response.json();
      if (!response.ok)
        throw new Error(
          `Soak facilitation rejected ${response.status} ${body.error?.code ?? "unknown"}`,
        );
      if (
        command &&
        (body.receipt.operationId !== operationId ||
          body.receipt.canvasSeq !== body.facilitation.canvasSeq)
      )
        throw new Error("Unexpected soak facilitation receipt");
      return body.facilitation;
    },
    { api, boardId: fixture!.board.id, command, operationId, timeoutMs: config.timeoutMs },
  )) as CanvasFacilitationView;
  if (command) {
    soakObservation!.churn.completedCommands++;
    assert.ok(
      view.canvasSeq <=
        soakObservation!.receiptBudget.maximumSequence -
          soakObservation!.receiptBudget.postludeReserve,
      "Soak facilitation exceeded its preflight operation budget",
    );
  }
  return view;
}
async function soakChurn(owner: Page) {
  const before = await soakFacilitation(owner);
  assert.equal(before.versions.length, 0, "Soak must not accumulate saved versions");
  const threadId = randomUUID(),
    messageId = randomUUID(),
    versionId = randomUUID();
  const created = await soakFacilitation(owner, {
    type: "comment_thread_create",
    threadId,
    messageId,
    objectId: fixture!.scene.editorTargetIds[0]!,
    text: "Synthetic continuous-workload facilitation check",
  });
  const thread = created.threads.find((entry) => entry.id === threadId);
  assert.ok(thread);
  const resolved = await soakFacilitation(owner, {
    type: "comment_resolve",
    threadId,
    expectedVersion: thread.version,
    resolved: true,
  });
  assert.equal(resolved.threads.find((entry) => entry.id === threadId)?.resolved, true);
  const started = await soakFacilitation(owner, {
    type: "timer_start",
    expectedRevision: resolved.timer.revision,
    durationSeconds: 300,
  });
  const paused = await soakFacilitation(owner, {
    type: "timer_pause",
    expectedRevision: started.timer.revision,
  });
  assert.equal(paused.timer.status, "paused");
  const saved = await soakFacilitation(owner, {
    type: "version_create",
    versionId,
    name: "Synthetic soak checkpoint",
  });
  assert.equal(saved.versions.length, 1);
  const version = saved.versions.find((entry) => entry.id === versionId);
  assert.ok(version);
  const deleted = await soakFacilitation(owner, {
    type: "version_delete",
    versionId,
    expectedVersion: version.version,
  });
  assert.equal(deleted.versions.length, 0);
  assert.ok(deleted.threads.length <= soakObservation!.churn.maximumRetainedThreads);
  soakObservation!.churn.completedRounds++;
}

async function main() {
  const startedAt = new Date().toISOString(),
    started = performance.now();
  await mkdir(evidenceDir, { recursive: true });
  const provenancePath = resolve(
    root,
    "apps/web",
    config.distDir,
    "collaboration-build-provenance.json",
  );
  const expectedFingerprint = browserSourceFingerprint();
  let buildProvenance: { sourceFingerprint: string; compiledApiOrigin: string; compiledAt: string };
  if (config.build) {
    stage = "production-build";
    await exited(startNext(["build"], "next-build.log"));
    buildProvenance = {
      sourceFingerprint: expectedFingerprint,
      compiledApiOrigin: api,
      compiledAt: new Date().toISOString(),
    };
    assert.equal(
      browserSourceFingerprint(),
      expectedFingerprint,
      "Browser sources changed during production build; retry with stable sources",
    );
    await writeFile(provenancePath, JSON.stringify(buildProvenance));
  } else {
    stage = "verify-reused-production-build";
    buildProvenance = JSON.parse(await readFile(provenancePath, "utf8"));
    assert.equal(
      buildProvenance.sourceFingerprint,
      expectedFingerprint,
      "Rebuild after browser source changes",
    );
    assert.equal(buildProvenance.compiledApiOrigin, api, "Rebuild after API-origin changes");
  }
  if (config.buildOnly) {
    await writeFile(
      output,
      `${JSON.stringify({ evidenceSchemaVersion: 1, complete: false, stage: "production-build-only", buildProvenance, capacityIncreaseAuthorized: false }, null, 2)}\n`,
    );
    process.stdout.write(
      `${JSON.stringify({ productionBuildComplete: true, output, capacityIncreaseAuthorized: false })}\n`,
    );
    return;
  }
  stage = "disposable-postgres-two-node-fixture";
  fixture = await createCanvasCollaborationFixture(config, profiler, soak.creatorSessionLifetimeMs);
  stage = "production-web-start";
  server = startNext(
    ["start", "--hostname", "127.0.0.1", "--port", String(config.webPort)],
    "next-server.log",
  );
  await ready(server);
  browser = await chromium.launch({
    headless: true,
    args: [
      "--disable-background-timer-throttling",
      "--disable-renderer-backgrounding",
      "--disable-backgrounding-occluded-windows",
    ],
  });
  const browserVersion = browser.version(),
    pages: Page[] = [];
  stage = "initial-production-renders";
  // Sequential initial visits keep their independent navigation samples interpretable;
  // all pages remain open and live during the concurrent update waves below.
  for (let index = 0; index < config.editors; index++) {
    const page = await pageFor(index, fixture.sessions[index]!.token);
    pages.push(page);
    await page.goto(`${web}/canvas/${fixture.board.id}`, { waitUntil: "domcontentloaded" });
    await page.getByTestId("canvas-surface").waitFor({ state: "visible" });
    await page.waitForFunction((count) => {
      const surface = document
        .querySelector('[data-testid="canvas-surface"]')
        ?.getBoundingClientRect();
      const objects = [...document.querySelectorAll('[data-testid^="canvas-object-"]')];
      return (
        objects.length === count &&
        surface &&
        objects.some((object) => {
          const bounds = object.getBoundingClientRect();
          return (
            object.textContent?.trim() &&
            bounds.width > 0 &&
            bounds.height > 0 &&
            bounds.right > surface.left &&
            bounds.bottom > surface.top &&
            bounds.left < surface.right &&
            bounds.top < surface.bottom
          );
        })
      );
    }, config.objects);
    initialRender.push(
      await page.evaluate(
        () =>
          new Promise<number>((done) =>
            requestAnimationFrame(() => requestAnimationFrame(() => done(performance.now()))),
          ),
      ),
    );
    observeMemory();
  }
  const owner = pages[0]!,
    peer = pages[1]!;
  const calibrations = await Promise.all(
    pages.map(async (page, actorIndex) => ({
      actorIndex,
      servingNode: actorIndex === 0 ? "nodeA" : "nodeB",
      samples: await page.evaluate(
        async ({ api, timeoutMs }) => {
          const values: number[] = [];
          for (let index = 0; index < 5; index++) {
            const started = performance.now();
            const response = await fetch(`${api}/health/live?sample=${index}`, {
              cache: "no-store",
              credentials: "omit",
              signal: AbortSignal.timeout(timeoutMs),
            });
            if (!response.ok) throw new Error("Calibration failed");
            await response.text();
            values.push(performance.now() - started);
          }
          return values;
        },
        { api, timeoutMs: config.timeoutMs },
      ),
    })),
  );
  const calibration = calibrations.flatMap((entry) => entry.samples);
  const nominalLatencyObserved =
    config.latencyMs === 0 ||
    calibrations.every(
      (entry) => (canvasCapacityDistribution(entry.samples).p50 ?? 0) >= config.latencyMs * 0.8,
    );
  await writeFile(
    resolve(evidenceDir, "network-calibration.json"),
    JSON.stringify(
      {
        nominalLatencyMs: config.latencyMs,
        nominalLatencyObserved,
        actors: calibrations.map(({ samples, ...entry }) => ({
          ...entry,
          milliseconds: canvasCapacityDistribution(samples),
        })),
      },
      null,
      2,
    ),
  );
  const outlineButton = peer.getByRole("button", { name: "Object outline", exact: true });
  if ((await outlineButton.getAttribute("aria-expanded")) !== "true") await outlineButton.click();
  const checkboxes = peer.locator('input[type="checkbox"][aria-label^="Select "]');
  for (let index = 0; index < config.editors; index++) await checkboxes.nth(index).check();
  // Include the two synthetic images so their authorized loads are actually visible.
  await checkboxes.nth(config.editors + 2).check();
  await checkboxes.nth(config.editors + 3).check();
  await peer.getByRole("button", { name: "Fit selection", exact: true }).click();
  await peer.getByRole("button", { name: "Object outline", exact: true }).click();
  await peer.getByRole("button", { name: "Hand", exact: true }).click();
  await peer.locator('[data-testid="canvas-surface"] image').first().waitFor({ state: "visible" });
  await peer.screenshot({ path: resolve(evidenceDir, "peer-mixed-scene.png") });
  if (soak.mode !== "disabled") {
    // A node-A observer must see every node-B writer in the new continuous mode.
    // Use the same real outline/selection/fit controls as the legacy peer viewport.
    const ownerOutline = owner.getByRole("button", { name: "Object outline", exact: true });
    if ((await ownerOutline.getAttribute("aria-expanded")) !== "true") await ownerOutline.click();
    const ownerCheckboxes = owner.locator('input[type="checkbox"][aria-label^="Select "]');
    for (let index = 0; index < config.editors; index++) await ownerCheckboxes.nth(index).check();
    await ownerCheckboxes.nth(config.editors + 2).check();
    await ownerCheckboxes.nth(config.editors + 3).check();
    await owner.getByRole("button", { name: "Fit selection", exact: true }).click();
    await ownerOutline.click();
    await owner.getByRole("button", { name: "Hand", exact: true }).click();
    await owner
      .locator('[data-testid="canvas-surface"] image')
      .first()
      .waitFor({ state: "visible" });
    await owner.screenshot({ path: resolve(evidenceDir, "owner-observer-mixed-scene.png") });
  }

  const slowEventsBefore = fixture.streamEvents.backpressure ?? 0;
  stalled = await stalledCanvasConsumer(
    `${fixture.peerApi}/v1/canvas-boards/${fixture.board.id}/events`,
    fixture.sessions[0]!.token,
    web,
  );
  const versions = pages.map(() => 1);
  let exactMutation: CanvasBoardMutation | undefined, exactSeq: number | undefined;
  async function wave(number: number, measuredWave: boolean) {
    const entries = await Promise.all(
      pages.map(async (page, index) => {
        const operationId = randomUUID(),
          token = `capacity-${measuredWave ? "measured" : "warmup"}-${number}-${index}`;
        const mutation = canvasCapacityMutation(
          {
            type: "batch",
            operations: [
              {
                type: "update",
                id: fixture!.scene.editorTargetIds[index]!,
                expectedVersion: versions[index]!,
                patch: { text: canvasCapacityText(token, 160) },
              },
            ],
          },
          operationId,
        );
        // Burst retains actor1 exactly. Continuous mode always uses the other logical API node.
        const observerActorIndex = soakObservation && index !== 0 ? 0 : 1;
        const writerLogicalNode: 0 | 1 = index === 0 ? 0 : 1;
        const observerLogicalNode: 0 | 1 = observerActorIndex === 0 ? 0 : 1;
        const crossNode = writerLogicalNode !== observerLogicalNode;
        const selfObservation = index === observerActorIndex;
        const observer = await watch(
          pages[observerActorIndex]!,
          operationId,
          fixture!.scene.editorTargetIds[index]!,
          token,
        );
        const ack = await browserCommand(page, mutation);
        versions[index]!++;
        if (soakObservation)
          assert.ok(
            ack.canvasSeq <=
              soakObservation.receiptBudget.maximumSequence -
                soakObservation.receiptBudget.postludeReserve,
            "Soak update exceeded its preflight operation budget",
          );
        await observer.promise;
        if (measuredWave) {
          const painted = fixture!.ledger.sample(operationId);
          allAck.push(ack.milliseconds);
          peerPaint.push(painted);
          sampleRecords.push({
            operationId,
            editor: index,
            wave: number,
            acknowledgementMs: ack.milliseconds,
            repositoryResolutionToPaintOpportunityMs: painted,
            observerActorIndex,
            writerLogicalNode,
            observerLogicalNode,
            crossNode,
            selfObservation,
          });
          peerObservationCounts[
            crossNode ? "crossNode" : selfObservation ? "self" : "sameNodePeer"
          ]++;
          if (soakObservation) {
            assert.ok(
              crossNode && !selfObservation,
              "Continuous observations must use another logical node and actor",
            );
            soakObservation.observedCommands = sampleRecords.length;
          }
          if (index === 0 && number === 0) {
            exactMutation = mutation;
            exactSeq = ack.canvasSeq;
          }
        }
        observeMemory();
      }),
    );
    return entries;
  }
  if (soak.mode !== "disabled")
    soakObservation = newSoakObservation(
      canvasSoakReceiptPlan(soak, fixture.board.canvasSeq, config.editors, config.warmup),
    );
  stage = "warmup-concurrent-http-writes";
  for (let index = 0; index < config.warmup; index++) await wave(index, false);
  if (soakObservation) {
    stage = "continuous-initial-stream-readiness";
    const until = performance.now() + config.timeoutMs;
    while (pages.some((page) => (successfulStreamOpens.get(page) ?? 0) < 1)) {
      assert.ok(
        performance.now() < until,
        "Each continuous-workload actor needs a successful stream",
      );
      await pause(50);
    }
    soakObservation.streamReopens.lifetimeReconnectRequestsAtStart =
      fixture.streamEvents.reconnect_requested ?? 0;
    soakObservation.streamReopens.actors = pages.map((page, actorIndex) => ({
      actorIndex,
      successfulOpensAtStart: successfulStreamOpens.get(page) ?? 0,
      successfulOpensAtEnd: 0,
      successfulReopensDuringWindow: 0,
    }));
  }
  stage = "measured-concurrent-http-writes-and-peer-paint";
  const writesStarted = performance.now();
  let observedWaves = 0;
  if (!soakObservation) {
    profiler.start();
    try {
      for (let index = 0; index < config.updates; index++) await wave(index, true);
      observedWaves = config.updates;
    } finally {
      profiler.stop();
    }
  } else {
    stage = "continuous-paced-http-writes-and-peer-paint";
    soakWindowStarted = writesStarted;
    const deadline = writesStarted + soak.seconds * 1000;
    let nextWaveAt = writesStarted,
      nextChurnAt = writesStarted + soak.churnIntervalMs;
    let previousWaveStarted: number | undefined;
    sampleSoakResources();
    soakSampler = setInterval(sampleSoakResources, soak.sampleIntervalMs);
    soakSampler.unref();
    try {
      while (performance.now() < deadline) {
        if (observedWaves < soak.plannedWaves && performance.now() >= nextWaveAt) {
          const waveStarted = performance.now();
          if (previousWaveStarted !== undefined)
            soakObservation.observedWaveStartIntervalsMs.push(waveStarted - previousWaveStarted);
          previousWaveStarted = waveStarted;
          soakObservation.startedWaves++;
          await wave(observedWaves, true);
          observedWaves++;
          soakObservation.observedWaves = observedWaves;
          // No queued catch-up burst: successive starts are at least one interval apart.
          nextWaveAt = waveStarted + soak.waveIntervalMs;
        }
        if (
          performance.now() < deadline &&
          performance.now() >= nextChurnAt &&
          soakObservation.churn.completedRounds < soakObservation.receiptBudget.churnRounds
        ) {
          const churnStarted = performance.now();
          stage = "continuous-bounded-facilitation-churn";
          await soakChurn(owner);
          stage = "continuous-paced-http-writes-and-peer-paint";
          nextChurnAt = churnStarted + soak.churnIntervalMs;
        }
        const now = performance.now();
        const nextDue = Math.min(
          deadline,
          observedWaves < soak.plannedWaves ? nextWaveAt : deadline,
          soakObservation.churn.completedRounds < soakObservation.receiptBudget.churnRounds
            ? nextChurnAt
            : deadline,
        );
        if (nextDue > now) await pause(nextDue - now);
      }
      assert.ok(
        pages.every((page) => !page.isClosed()),
        "Hold every editor context for the full duration",
      );
      soakObservation.allEditorContextsHeld = pages.length === config.editors;
      soakObservation.durationCompleted = performance.now() - writesStarted >= soak.seconds * 1000;
      for (const actor of soakObservation.streamReopens.actors) {
        actor.successfulOpensAtEnd = successfulStreamOpens.get(pages[actor.actorIndex]!) ?? 0;
        actor.successfulReopensDuringWindow =
          actor.successfulOpensAtEnd - actor.successfulOpensAtStart;
      }
      soakObservation.streamReopens.passed = soakObservation.streamReopens.actors.every(
        (actor) =>
          actor.successfulReopensDuringWindow >=
          soakObservation!.streamReopens.minimumSuccessfulReopensPerActor,
      );
      assert.ok(
        soakObservation.streamReopens.passed,
        "Each actor must successfully reopen across the existing stream lifetime",
      );
      assert.ok(observedWaves > 0, "Continuous workload must measure at least one wave");
      assert.ok(
        soakObservation.churn.completedRounds > 0,
        "Continuous workload must exercise facilitation churn",
      );
      assert.equal(
        soakObservation.churn.completedCommands,
        soakObservation.churn.completedRounds * 6,
      );
    } finally {
      stopSoakSampler();
      soakObservation.observedDurationMs = performance.now() - writesStarted;
      soakObservation.durationOverrunMs = Math.max(
        0,
        soakObservation.observedDurationMs - soak.seconds * 1000,
      );
      soakObservation.durationCompleted = soakObservation.observedDurationMs >= soak.seconds * 1000;
      soakObservation.allEditorContextsHeld =
        pages.length === config.editors && pages.every((page) => !page.isClosed());
      // Preserve true partial reopen counts too when a wave or churn action failed.
      soakObservation.streamReopens.lifetimeReconnectRequestsAtEnd =
        fixture.streamEvents.reconnect_requested ?? 0;
      for (const actor of soakObservation.streamReopens.actors) {
        actor.successfulOpensAtEnd = successfulStreamOpens.get(pages[actor.actorIndex]!) ?? 0;
        actor.successfulReopensDuringWindow =
          actor.successfulOpensAtEnd - actor.successfulOpensAtStart;
      }
      soakObservation.streamReopens.passed =
        soakObservation.streamReopens.actors.length === config.editors &&
        soakObservation.streamReopens.actors.every(
          (actor) =>
            actor.successfulReopensDuringWindow >=
            soakObservation!.streamReopens.minimumSuccessfulReopensPerActor,
        );
      sampleSoakResources();
    }
  }
  const measuredWritesElapsedMs = performance.now() - writesStarted;
  await peer.screenshot({ path: resolve(evidenceDir, "peer-after-measured-updates.png") });
  const slowState = stalled.state();
  stalled.close();
  stalled = undefined;
  assert.equal(sampleRecords.length, config.editors * observedWaves);
  stage = "retry-and-authorization-correctness";
  assert.ok(exactMutation && exactSeq !== undefined);
  const beforeRetry = (await (
    await fetch(`${fixture.api}/v1/canvas-boards/${fixture.board.id}`, {
      headers: { cookie: `openround_creator=${fixture.sessions[0]!.token}` },
      signal: AbortSignal.timeout(config.timeoutMs),
    })
  ).json()) as { board: { canvasSeq: number } };
  if (soakObservation)
    soakObservation.receiptBudget.observedSequenceBeforePostlude = beforeRetry.board.canvasSeq;
  const exact = await browserCommand(owner, exactMutation);
  assert.equal(
    exact.canvasSeq,
    beforeRetry.board.canvasSeq,
    "Exact retry must not advance sequence",
  );
  const stale = canvasCapacityMutation(
    {
      type: "batch",
      operations: [
        {
          type: "update",
          id: fixture.scene.editorTargetIds[0]!,
          expectedVersion: 1,
          patch: { text: "Rejected stale fixture" },
        },
      ],
    },
    randomUUID(),
  );
  assert.equal((await fixture.command(stale)).status, 409);
  const outsider = fixture.sessions.at(-1)!;
  assert.equal(
    (
      await fetch(`${fixture.peerApi}/v1/canvas-boards/${fixture.board.id}`, {
        headers: { cookie: `openround_creator=${outsider.token}` },
        signal: AbortSignal.timeout(config.timeoutMs),
      })
    ).status,
    404,
  );
  stage = "navigation-frame-sampling";
  await peer.evaluate(() => {
    window.__capacityFrames = [];
    window.__capacitySampling = true;
    let previous: number | null = null;
    function tick(now: number) {
      if (!window.__capacitySampling) return;
      if (previous !== null) window.__capacityFrames.push(now - previous);
      previous = now;
      requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  });
  const surface = await peer.getByTestId("canvas-surface").boundingBox();
  assert.ok(surface);
  await peer.mouse.move(surface.x + surface.width * 0.45, surface.y + surface.height * 0.7);
  await peer.mouse.down();
  await peer.mouse.move(surface.x + surface.width * 0.55, surface.y + surface.height * 0.65, {
    steps: 60,
  });
  await peer.mouse.move(surface.x + surface.width * 0.45, surface.y + surface.height * 0.7, {
    steps: 60,
  });
  await peer.mouse.up();
  navigationFrames.push(
    ...(await peer.evaluate(() => {
      window.__capacitySampling = false;
      return window.__capacityFrames;
    })),
  );
  assert.ok(navigationFrames.length >= 20, "Navigation needs actual animation-frame samples");
  stage = "offline-reconnect";
  const streamCountBefore = streamRequests.get(peer) ?? 0;
  await networkSessions.get(peer)!.send("Network.emulateNetworkConditions", {
    offline: true,
    latency: config.latencyMs,
    downloadThroughput: -1,
    uploadThroughput: -1,
  });
  const interruptedPeerStreams = fixture.interruptPeerStreams();
  assert.ok(
    interruptedPeerStreams >= 1,
    "The transport interruption must close an existing authorized peer stream",
  );
  await pause(500);
  const reconnectId = randomUUID(),
    reconnectToken = "capacity-reconnected-latest-state";
  const reconnectWatch = await watch(
    peer,
    reconnectId,
    fixture.scene.editorTargetIds[0]!,
    reconnectToken,
  );
  await browserCommand(
    owner,
    canvasCapacityMutation(
      {
        type: "batch",
        operations: [
          {
            type: "update",
            id: fixture.scene.editorTargetIds[0]!,
            expectedVersion: versions[0]!,
            patch: { text: canvasCapacityText(reconnectToken, 160) },
          },
        ],
      },
      reconnectId,
    ),
  );
  versions[0]!++;
  const reconnectStarted = performance.now();
  const reconnectAbort = new AbortController();
  const renewedStream = peer.waitForRequest(/\/canvas-boards\/.*\/events(?:\?|$)/, {
    timeout: config.timeoutMs,
    signal: reconnectAbort.signal,
  });
  // Polling can paint before the fixed stream retry; recovery requires both.
  void renewedStream.catch(() => {});
  try {
    await networkSessions.get(peer)!.send("Network.emulateNetworkConditions", {
      offline: false,
      latency: config.latencyMs,
      downloadThroughput: -1,
      uploadThroughput: -1,
    });
    await Promise.all([reconnectWatch.promise, renewedStream]);
  } finally {
    reconnectAbort.abort();
  }
  const reconnectMs = performance.now() - reconnectStarted;
  const streamCountAfter = streamRequests.get(peer) ?? 0;
  assert.ok(streamCountAfter > streamCountBefore, "Offline recovery must open a renewed stream");
  stage = "guest-publication";
  const workshop = await fixture.workshop();
  // Deliberately include a creator cookie in this context: guest fetch must omit it.
  const guest = await pageFor(config.editors, fixture.sessions[0]!.token);
  const guestHeaders: Array<Promise<Record<string, string>>> = [];
  guest.on("request", (request) => {
    if (request.url().includes(`/workshop/${workshop.sourceId}/guest`))
      guestHeaders.push(request.allHeaders());
  });
  await guest.goto(`${web}/board/${workshop.sourceId}`);
  await guest.getByRole("button", { name: "Join board", exact: true }).click();
  const published = guest.getByRole("region", { name: "Published canvas", exact: true });
  await published.getByTestId("canvas-surface").waitFor({ state: "visible" });
  assert.equal(await published.getByText("PRIVATE-FIXTURE-TEXT", { exact: true }).count(), 0);
  const publicationId = randomUUID(),
    publicationToken = "capacity-authorized-guest-publication";
  const publicationWatch = await watch(
    guest,
    publicationId,
    workshop.objectId,
    publicationToken,
    true,
  );
  await browserCommand(
    owner,
    canvasCapacityMutation(
      {
        type: "batch",
        operations: [
          {
            type: "update",
            id: workshop.objectId,
            expectedVersion: 1,
            patch: { visibility: "published", text: publicationToken },
          },
        ],
      },
      publicationId,
    ),
    workshop.canvas.id,
  );
  await publicationWatch.promise;
  const guestPublicationMs = fixture.ledger.sample(publicationId);
  const headers = await Promise.all(guestHeaders);
  assert.ok(
    headers.length >= 2 &&
      headers.every((value) => value.authorization?.startsWith("Bearer ") && !value.cookie),
  );
  await guest.screenshot({ path: resolve(evidenceDir, "guest-authorized-publication.png") });
  stage = "final-correctness";
  const final = await fixture.apps[1]!.canvasBoards.get(fixture.actors[1]!, fixture.board.id);
  assert.equal(final.objects.length, config.objects);
  for (const [index, id] of fixture.scene.editorTargetIds.entries())
    assert.equal(final.objects.find((object) => object.id === id)?.version, versions[index]);
  const revoked = fixture.actors.at(-1)!;
  await fixture.apps[0]!.canvasBoards.revokeGrant(
    fixture.actors[0]!,
    fixture.board.id,
    revoked.userId,
  );
  await pages.at(-1)!.getByTestId("canvas-surface").waitFor({ state: "detached" });
  assert.equal(
    (
      await fetch(`${fixture.peerApi}/v1/canvas-boards/${fixture.board.id}`, {
        headers: { cookie: `openround_creator=${fixture.sessions[config.editors - 1]!.token}` },
        signal: AbortSignal.timeout(config.timeoutMs),
      })
    ).status,
    404,
  );
  if (soakObservation) {
    const afterPostlude = await fixture.apps[0]!.canvasBoards.get(
      fixture.actors[0]!,
      fixture.board.id,
    );
    soakObservation.receiptBudget.observedFinalSequence = afterPostlude.canvasSeq;
    assert.ok(
      afterPostlude.canvasSeq <= soakObservation.receiptBudget.maximumSequence,
      "Soak must preserve postlude operation headroom",
    );
    assert.ok(afterPostlude.canvasSeq <= soakObservation.receiptBudget.conservativeCeiling);
    assert.ok(soakObservation.durationCompleted && soakObservation.allEditorContextsHeld);
  }
  assert.deepEqual(browserErrors, [], "No application errors during measured journeys");
  observeMemory();
  measured.httpAcknowledgement = canvasCapacityDistribution(allAck);
  measured.repositoryResolutionToPeerPaintOpportunity = canvasCapacityDistribution(peerPaint);
  measured.guestPublication = canvasCapacityDistribution([guestPublicationMs]);
  measured.initialRender = canvasCapacityDistribution(initialRender);
  measured.navigationFrameInterval = canvasCapacityDistribution(navigationFrames);
  measured.reconnect = canvasCapacityDistribution([reconnectMs]);
  measured.stalledConsumerAcknowledgement = canvasCapacityDistribution(allAck);
  const gates = evaluateCollaborationGates(config.gates, measured);
  const result = {
    evidenceSchemaVersion: 1,
    complete: true,
    startedAt,
    source: {
      ...source(),
      apiAndHarnessSha256: sourceFingerprint([
        "apps/server/src",
        "packages/db/src",
        "packages/contracts/src",
        "tests/load/canvas-collaboration-capacity.mts",
        "tests/load/canvas-collaboration-fixture.mts",
        "tests/load/canvas-collaboration-config.ts",
        "tests/load/canvas-collaboration-profile.ts",
        "tests/load/canvas-soak-config.ts",
        "tests/load/canvas-capacity.ts",
        "package.json",
        "pnpm-lock.yaml",
      ]),
    },
    protocolVersion: CANVAS_SCHEMA_VERSION,
    workload: {
      objects: config.objects,
      licensedEditors: config.editors,
      openEditorBrowserContexts: pages.length,
      updatesPerEditor: observedWaves,
      warmupWaves: config.warmup,
      measuredCommands: sampleRecords.length,
      guestOrdinaryObjects: config.guestObjects,
      objectCounts: fixture.scene.counts,
      sceneBytes: fixture.scene.serializedBytes,
      fixtureSha256: fixture.scene.sha256,
      fakeImagePlacements: 2,
      fakeImageAssets: 1,
      fakeImageBytes: fixture.syntheticImageBytes,
      pacing: soakObservation
        ? "Continuous bounded-duration local workload; wave starts are spaced at least the configured interval, with six sequential facilitation commands between due waves. Every update still waits for acknowledgement and one authorized peer paint opportunity; no catch-up burst."
        : "Concurrent independent-object waves; each wave waits for every HTTP acknowledgement and peer paint opportunity before its successor",
      peerObservationTopology: {
        observersPerUpdate: 1,
        observerActors: soakObservation ? [0, 1] : [1],
        counts: peerObservationCounts,
        allToAllObserved: false,
        scope:
          "Two logical API nodes share one coordinator process; these are not separate physical hosts",
      },
      ...(soakObservation ? { continuous: soakObservation } : {}),
    },
    environment: {
      productionBrowserBundle: true,
      buildProvenance,
      nextDistDir: config.distDir,
      headless: true,
      browser: browserVersion,
      viewport: { width: 1440, height: 1000 },
      reducedMotion: true,
      node: process.version,
      platform: platform(),
      architecture: arch(),
      kernel: release(),
      logicalCpuCount: cpus().length,
      hostMemoryBytes: totalmem(),
      databaseVersion: fixture.databaseVersion,
      cacheVersion: fixture.cacheVersion,
      restrictedRuntimeRlsChecked: true,
      servingApiNodes: 2,
      independentRepositoryPools: 2,
      independentRedisCacheClients: 2,
      runtimePoolMaximum: fixture.runtimePoolMaximum,
      nominalCdpNetworkLatencyMs: config.latencyMs,
      measuredHealthFetchMs: canvasCapacityDistribution(calibration),
      perActorHealthFetchCalibration: calibrations.map(({ samples, ...entry }) => ({
        ...entry,
        milliseconds: canvasCapacityDistribution(samples),
      })),
      nominalLatencyObserved,
      apiNodeMode:
        "NODE_ENV=test production route implementations, relaxed global loopback IP budget; not a production deployment",
    },
    measurementDefinitions: {
      httpAcknowledgement:
        "Browser performance.now immediately before authenticated fetch to after response JSON/receipt validation; includes browser-emulated latency and HTTP/auth/repository/projection costs",
      repositoryResolutionToPeerPaintOpportunity: soakObservation
        ? "One coordinator monotonic clock: repository command resolution to an authorized different-actor browser binding after matching SVG text and two requestAnimationFrames. Actor1/nodeB observes writer0/nodeA; actor0/nodeA observes every nodeB writer. One observer per update, not all-to-all, physical hosts, exact database COMMIT time or physical pixels."
        : "One coordinator monotonic clock: repository command resolution to designated actor1 after matching SVG text and two requestAnimationFrames. At 20 actors x 10 waves this is 10 self, 10 cross-logical-node and 180 same-node-peer samples. Per-sample observer/node flags disclose actual topology. Logical nodes share one process; not all-to-all, exact database COMMIT time or physical pixels.",
      guestPublication:
        "Same resolution-to-two-rAF observation for an ordinary private object explicitly published by the facilitator; measured in the Bearer-only guest canvas served by the other node",
      initialRender:
        "Browser navigation performance.now to expected complete SVG object count and visible authorized text plus two requestAnimationFrames; sequential fresh browser contexts, server/OS caches warm after the first navigation",
      navigationFrameInterval:
        "Consecutive browser rAF timestamps while real pointer hand-pan gestures cross the already-rendered mixed scene; not presented-frame GPU timing or reference-device FPS",
      reconnect:
        "Coordinator time from enabling the offline peer context network until both its latest authorized matching text plus two rAF and a new stream request",
      stalledConsumerAcknowledgement: soakObservation
        ? "The same measured acknowledgement samples; an additional raw TCP consumer starts paused but retains the existing five-minute stream lifetime. No full-window stalled-consumer or saturation claim."
        : "HTTP acknowledgement samples while an additional authorized raw TCP stream deliberately does not consume its response body; checks isolation, not a forced worst-case backpressure cutoff",
      repositoryProfiling:
        "Optional CANVAS_COLLAB_PROFILE=true instance/SQL/pool observations during measured write-and-peer-paint waves only; setup/warm-up and operations begun before that window are excluded. Monotonic client elapsed times, numeric correlation and fixed method/SQL categories only. CANVAS_COLLAB_PROFILE_MAX_SAMPLES bounds retained completions (default20000,max100000); truncation and in-flight observations are disclosed. No authority cache or production behavior changes; gates remain independent.",
    },
    repositoryProfiling: profiler.report(),
    latencyMs: measured,
    gates,
    gatePurpose:
      "Loose harness smoke thresholds only; roadmap assessment and missing required deployment/device evidence remain separate",
    roadmapAssessment: {
      numericTargets: (
        [
          ["repositoryResolutionToPeerPaintOpportunity", 500],
          ["guestPublication", 2000],
          ["initialRender", 3000],
          ["navigationFrameInterval", 16.7],
        ] as const
      ).map(([metric, maximumMs]) => ({
        metric,
        maximumP95Ms: maximumMs,
        observedP95Ms: measured[metric]?.p95 ?? null,
        interpretation:
          metric === "navigationFrameInterval"
            ? "Literal16.7ms diagnostic with browser timestamp quantization; roadmap60fps is not a formal rAF-p95 service-level objective"
            : "Roadmap numeric target; additional deployment/device evidence remains required",
        status:
          measured[metric]?.p95 === null || measured[metric]?.p95 === undefined
            ? "unmeasured"
            : measured[metric]!.p95! <= maximumMs
              ? "passed"
              : "failed",
      })),
      requiredUnmeasuredEvidence: [
        "Reference physical desktop/mobile rendering and input",
        "Production-size media/S3/scanner pipeline",
        "Target staging topology, reverse proxy/TLS and independently serving processes/hosts",
        soakObservation
          ? "Target-host long-duration/full collaboration saturation and all-to-all observations"
          : "Long-duration/full collaboration saturation and all-to-all observations",
      ],
      networkCalibrationPassed: nominalLatencyObserved,
      capacityGatePassed: false,
      capacityIncreaseAuthorized: false,
    },
    navigationDiagnostics: {
      rawFrameIntervalsMs: navigationFrames,
      meanIntervalMs:
        navigationFrames.reduce((sum, value) => sum + value, 0) / navigationFrames.length,
      p50EquivalentRafCadenceHz: 1000 / measured.navigationFrameInterval.p50!,
      scope:
        "Animation callback cadence only; browser timestamp quantization affects16.7vs16.8ms. Physical presented-frame/device gate remains unassessed.",
    },
    measuredWritesElapsedMs,
    sampleRecords,
    streamRecovery: {
      fault:
        "Fixture destroyed the existing peer HTTP event response/socket while browser CDP network was offline",
      interruptedPeerStreams,
      requestsBeforeOffline: streamCountBefore,
      requestsAfterRecovery: streamCountAfter,
      renewedStreamObserved: true,
    },
    stalledConsumer: {
      ...slowState,
      streamEvents: fixture.streamEvents,
      backpressureDisconnectionsObserved:
        (fixture.streamEvents.backpressure ?? 0) - slowEventsBefore,
      cutoffUnderSaturatedBuffer: soakObservation
        ? "unassessed: the lifetime-bounded raw consumer is not held stalled for the full continuous window; no saturation cutoff claim"
        : "unassessed: bounded coalesced notifications may fit kernel buffers during this short run",
    },
    correctness: {
      allMeasuredUpdatesObservedByDesignatedAuthorizedActor: true,
      noMeasuredSelfObservations: peerObservationCounts.self === 0,
      allMeasuredObservationsCrossLogicalNode:
        peerObservationCounts.crossNode === sampleRecords.length,
      finalObjectVersionsRetained: true,
      exactRetryNoSequenceAdvance: true,
      staleVersionRejected: true,
      outsiderDeniedAcrossNode: true,
      revokedPeerClearedAndDenied: true,
      guestPrivateTextAbsentBeforePublication: true,
      guestRequestsBearerOnlyNoCreatorCookie: true,
      applicationPageErrors: 0,
    },
    sampledCoordinatorProcessMemoryHighWaterBytes: rssHighWater,
    capacityIncreaseAuthorized: false,
    limitations: [
      "Localhost, two serving API nodes in ONE coordinator process/monotonic clock; no separate hosts, reverse proxy/TLS, WAN, OS network shaping, or independently skewed clocks",
      "Production Next build and headless desktop Chromium on the current machine, not a deployed production API configuration or reference mobile/physical touch device",
      "CDP nominal latency applies to browser network requests; actual measured health-fetch calibration is reported; local Node setup/correctness requests are not shaped",
      "Tiny synthetic PNG bytes and in-memory storage.readImage replace S3/scanner/full-size decoding; no production media pipeline or realistic image memory claim",
      "SVG DOM and two animation frames establish a paint opportunity, not physical display capture timing; screenshots verify representative output only",
      soakObservation
        ? "Local continuous workload with one cross-logical-node observer per update selected from two browsers and bounded facilitation churn, not all-to-all, realistic media, near-limit history saturation, physical hosts or deployed soak acceptance. Runs shorter than fifteen minutes are rehearsal only."
        : "Short burst/wave workload with designated observing actor1 (including its own writes), unsaturated comments/history/receipts and a single guest; no long-duration soak, worst-case moderation/facilitation saturation, or all-to-all peer latency matrix",
      "Stalled TCP consumer isolation does not establish saturation/backpressure cutoff unless observed; API nodes and Chromium contend for this host's resources",
    ],
    totalMs: Math.round(performance.now() - started),
    artifactDirectory: evidenceDir,
  };
  await writeFile(output, `${JSON.stringify(result, null, 2)}\n`);
  process.stdout.write(
    `${JSON.stringify({ output, gatesPassed: gates.passed, latencyMs: measured, capacityIncreaseAuthorized: false }, null, 2)}\n`,
  );
  if (!gates.passed) process.exitCode = 1;
}
try {
  await main();
} catch (error) {
  profiler.stop();
  const failure = {
    evidenceSchemaVersion: 1,
    complete: false,
    capacityIncreaseAuthorized: false,
    error: "Canvas collaboration evidence did not complete",
    stage,
    kind: error instanceof Error ? error.name : "unknown",
    detail:
      error instanceof Error
        ? error.message.replace(/[a-z][a-z0-9+.-]*:\/\/[^\s]+/gi, "[connection URL]").slice(0, 500)
        : null,
    code:
      error &&
      typeof error === "object" &&
      "code" in error &&
      /^[A-Z0-9_]{1,40}$/.test(String(error.code))
        ? String(error.code)
        : null,
    completedSampleCounts: {
      httpAcknowledgement: allAck.length,
      peerPaintOpportunity: peerPaint.length,
      initialRender: initialRender.length,
    },
    artifactDirectory: evidenceDir,
    ...(soakObservation ? { continuousWorkload: soakObservation } : {}),
    repositoryProfiling: profiler.report(),
  };
  await writeFile(output, `${JSON.stringify(failure, null, 2)}\n`);
  process.stderr.write(`${JSON.stringify(failure)}\n`);
  process.exitCode = 1;
} finally {
  stopSoakSampler();
  for (const wait of waits.values()) {
    clearTimeout(wait.timer);
    wait.reject(new Error("Evidence run ended"));
  }
  waits.clear();
  stalled?.close();
  await Promise.allSettled(contexts.map((context) => context.close()));
  await browser?.close();
  await stop(server);
  await fixture?.close();
  profiler.restore();
}
