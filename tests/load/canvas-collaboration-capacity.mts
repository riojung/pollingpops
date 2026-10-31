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

declare global {
  interface Window {
    __canvasCapacityPaint: (operationId: string) => Promise<void>;
    __capacityFrames: number[];
    __capacitySampling: boolean;
  }
}

const root = resolve(import.meta.dirname, "../..");
const config = parseCanvasCollaborationConfig(process.env);
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
function browserSourceFingerprint() {
  const names = execFileSync(
    "git",
    [
      "ls-files",
      "--cached",
      "--others",
      "--exclude-standard",
      "--",
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
    ],
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
}> = [];
const rssHighWater = { rss: 0, heapUsed: 0 };
function observeMemory() {
  const memory = process.memoryUsage();
  rssHighWater.rss = Math.max(rssHighWater.rss, memory.rss);
  rssHighWater.heapUsed = Math.max(rssHighWater.heapUsed, memory.heapUsed);
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
    ({ operationId, objectId, token, guest }) => {
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
            void window.__canvasCapacityPaint(operationId);
          }),
        );
      };
      const observer = new MutationObserver(observe);
      observer.observe(document.body, { childList: true, characterData: true, subtree: true });
      observe();
      setTimeout(() => observer.disconnect(), 120000);
    },
    { operationId, objectId, token, guest },
  );
  return { promise };
}
async function browserCommand(
  page: Page,
  mutation: CanvasBoardMutation,
  boardId = fixture!.board.id,
) {
  return page.evaluate(
    async ({ api, boardId, mutation }) => {
      const before = performance.now();
      const response = await fetch(`${api}/v1/canvas-boards/${boardId}/commands`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(mutation),
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
    { api, boardId, mutation },
  );
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
  fixture = await createCanvasCollaborationFixture(config);
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
        async ({ api }) => {
          const values: number[] = [];
          for (let index = 0; index < 5; index++) {
            const started = performance.now();
            const response = await fetch(`${api}/health/live?sample=${index}`, {
              cache: "no-store",
              credentials: "omit",
            });
            if (!response.ok) throw new Error("Calibration failed");
            await response.text();
            values.push(performance.now() - started);
          }
          return values;
        },
        { api },
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
        const observer = await watch(
          peer,
          operationId,
          fixture!.scene.editorTargetIds[index]!,
          token,
        );
        const ack = await browserCommand(page, mutation);
        versions[index]!++;
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
          });
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
  stage = "warmup-concurrent-http-writes";
  for (let index = 0; index < config.warmup; index++) await wave(index, false);
  stage = "measured-concurrent-http-writes-and-peer-paint";
  const writesStarted = performance.now();
  for (let index = 0; index < config.updates; index++) await wave(index, true);
  const measuredWritesElapsedMs = performance.now() - writesStarted;
  await peer.screenshot({ path: resolve(evidenceDir, "peer-after-measured-updates.png") });
  const slowState = stalled.state();
  stalled.close();
  stalled = undefined;
  assert.equal(sampleRecords.length, config.editors * config.updates);
  stage = "retry-and-authorization-correctness";
  assert.ok(exactMutation && exactSeq !== undefined);
  const beforeRetry = (await (
    await fetch(`${fixture.api}/v1/canvas-boards/${fixture.board.id}`, {
      headers: { cookie: `openround_creator=${fixture.sessions[0]!.token}` },
    })
  ).json()) as { board: { canvasSeq: number } };
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
  await networkSessions.get(peer)!.send("Network.emulateNetworkConditions", {
    offline: false,
    latency: config.latencyMs,
    downloadThroughput: -1,
    uploadThroughput: -1,
  });
  await reconnectWatch.promise;
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
      })
    ).status,
    404,
  );
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
    source: source(),
    protocolVersion: CANVAS_SCHEMA_VERSION,
    workload: {
      objects: config.objects,
      licensedEditors: config.editors,
      openEditorBrowserContexts: pages.length,
      updatesPerEditor: config.updates,
      warmupWaves: config.warmup,
      measuredCommands: sampleRecords.length,
      guestOrdinaryObjects: config.guestObjects,
      objectCounts: fixture.scene.counts,
      sceneBytes: fixture.scene.serializedBytes,
      fixtureSha256: fixture.scene.sha256,
      fakeImagePlacements: 2,
      fakeImageAssets: 1,
      fakeImageBytes: fixture.syntheticImageBytes,
      pacing:
        "Concurrent independent-object waves; each wave waits for every HTTP acknowledgement and peer paint opportunity before its successor",
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
      repositoryResolutionToPeerPaintOpportunity:
        "One coordinator monotonic clock: command repository promise resolution after its transaction returns, to an authorized different-node observer binding after matching on-screen SVG text and two requestAnimationFrames. Includes CDP binding delivery; an upper bound on a paint opportunity, not database COMMIT instant or physical pixel/monitor latency",
      guestPublication:
        "Same resolution-to-two-rAF observation for an ordinary private object explicitly published by the facilitator; measured in the Bearer-only guest canvas served by the other node",
      initialRender:
        "Browser navigation performance.now to expected complete SVG object count and visible authorized text plus two requestAnimationFrames; sequential fresh browser contexts, server/OS caches warm after the first navigation",
      navigationFrameInterval:
        "Consecutive browser rAF timestamps while real pointer hand-pan gestures cross the already-rendered mixed scene; not presented-frame GPU timing or reference-device FPS",
      reconnect:
        "Coordinator time from enabling the offline peer context network until its latest authorized matching text plus two rAF; requires a new stream request",
      stalledConsumerAcknowledgement:
        "HTTP acknowledgement samples while an additional authorized raw TCP stream deliberately does not consume its response body; checks isolation, not a forced worst-case backpressure cutoff",
    },
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
        "Long-duration/full collaboration saturation and all-to-all observations",
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
      cutoffUnderSaturatedBuffer:
        "unassessed: bounded coalesced notifications may fit kernel buffers during this short run",
    },
    correctness: {
      allMeasuredUpdatesObservedByAuthorizedPeer: true,
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
      "Short burst/wave workload with a single observing peer, unsaturated comments/history/receipts and a single guest; no long-duration soak, worst-case moderation/facilitation saturation, or all-to-all peer latency matrix",
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
  };
  await writeFile(output, `${JSON.stringify(failure, null, 2)}\n`);
  process.stderr.write(`${JSON.stringify(failure)}\n`);
  process.exitCode = 1;
} finally {
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
}
