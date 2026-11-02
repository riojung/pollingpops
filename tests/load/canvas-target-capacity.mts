/** Opt-in, pre-provisioned, normal-API rehearsal. Never creates/deletes boards or starts services. */
import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, open, readFile, type FileHandle } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  chromium,
  type Browser,
  type BrowserContext,
  type Page,
  type Request,
} from "@playwright/test";
import {
  CANVAS_SCHEMA_VERSION,
  CanvasBoardMutationSchema,
  CanvasBoardMutationResponseSchema,
  type CanvasBoardView,
} from "../../packages/contracts/src/index.ts";
import {
  CanvasTargetFailure,
  assertCanvasTargetWaveBudget,
  canvasTargetBudget,
  canvasTargetCookies,
  canvasTargetDistribution,
  canvasTargetGates,
  canvasTargetMarker,
  canvasTargetObservationBudget,
  canvasTargetWaveCount,
  parseCanvasTargetConfig,
  validateCanvasTargetBoard,
  type CanvasTargetConfig,
} from "./canvas-target-config.ts";
import { restoreCanvasTargetText } from "./canvas-target-restore.ts";

const requestTimeoutMs = 20_000;
const bodyLimit = 4 * 1024 * 1024;
const output = resolve(process.env.CANVAS_TARGET_OUTPUT ?? "artifacts/canvas-target.json");
const failures: Array<{ code: string; status?: number; actorIndex?: number; boardIndex?: number }> =
  [];
const acknowledgements: number[] = [],
  paints: number[] = [],
  initialRenders: number[] = [];
const samples: Array<{
  wave: number;
  actorIndex: number;
  boardIndex: number;
  acknowledgementMs: number | null;
  peers: Array<{ actorIndex: number; requestStartToPaintMs: number | null }>;
}> = [];
const cleanup: Array<{ boardIndex: number; actorIndex: number; outcome: string }> = [];
const contexts: BrowserContext[] = [];
let config: CanvasTargetConfig | undefined,
  cookies: ReturnType<typeof canvasTargetCookies> = [];
let reportFile: FileHandle | undefined;
let browser: Browser | undefined,
  interrupted = false,
  stage = "configuration",
  complete = false;
let applicationErrors = 0,
  markerChecks = 0,
  startedAt: string | null = null,
  measuredStarted = 0,
  measuredElapsedMs = 0;
let configSha256: string | null = null,
  budget: ReturnType<typeof canvasTargetBudget> | undefined;
const runtime: Array<{
  original: CanvasBoardView;
  expectedSeq: number;
  last: Map<number, { text: string; version: number }>;
  attempted: Map<number, { text: string; version: number }>;
  sceneSignature: string;
  writes: number;
}> = [];
const streams: Array<{
  requests: number;
  closed: number;
  failed: number;
  renewals: number;
  verifiedRecoveries: number;
  httpErrors: Record<string, number>;
  recoveryMs: number[];
  currentBoard: number;
  lastEnd: number | null;
  pendingRecovery: number | null;
}> = [];
const pages: Page[] = [];
const signal = () => {
  interrupted = true;
};
process.on("SIGINT", signal);
process.on("SIGTERM", signal);
function record(error: unknown, actorIndex?: number, boardIndex?: number) {
  const safe =
    error instanceof CanvasTargetFailure ? error : new CanvasTargetFailure("BROWSER_FAILED");
  if (failures.length < 100)
    failures.push({
      code: safe.code,
      ...(safe.status === undefined ? {} : { status: safe.status }),
      ...(actorIndex === undefined
        ? safe.actorIndex === undefined
          ? {}
          : { actorIndex: safe.actorIndex }
        : { actorIndex }),
      ...(boardIndex === undefined
        ? safe.boardIndex === undefined
          ? {}
          : { boardIndex: safe.boardIndex }
        : { boardIndex }),
    });
}
async function pause(ms: number) {
  const end = performance.now() + Math.max(0, ms);
  while (!interrupted && performance.now() < end)
    await new Promise((done) => setTimeout(done, Math.min(200, end - performance.now())));
}
async function request(path: string, actorIndex?: number, init: RequestInit = {}, web = false) {
  try {
    const response = await fetch(`${web ? config!.webOrigin : config!.apiOrigin}${path}`, {
      ...init,
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(requestTimeoutMs),
      headers: {
        ...(actorIndex === undefined ? {} : { cookie: cookies[actorIndex]!.header }),
        ...init.headers,
      },
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new CanvasTargetFailure("TARGET_HTTP", response.status, actorIndex);
    }
    return response;
  } catch (error) {
    if (error instanceof CanvasTargetFailure) throw error;
    throw new CanvasTargetFailure("TARGET_NETWORK", undefined, actorIndex);
  }
}
async function json(response: Response): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) throw new CanvasTargetFailure("TARGET_BODY");
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      length += next.value.byteLength;
      if (length > bodyLimit) {
        await reader.cancel();
        throw new CanvasTargetFailure("TARGET_BODY");
      }
      chunks.push(next.value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new CanvasTargetFailure("TARGET_BODY");
  } finally {
    reader.releaseLock();
  }
}
async function board(boardIndex: number, actorIndex = 0) {
  const data = await json(
    await request(`/v1/canvas-boards/${config!.boards[boardIndex]!.boardId}`, actorIndex),
  );
  return validateCanvasTargetBoard((data as { board?: unknown })?.board, config!, boardIndex);
}
function sceneSignature(view: CanvasBoardView, boardIndex: number) {
  const targets = new Set(config!.boards[boardIndex]!.targetObjectIds);
  return JSON.stringify(
    view.objects
      .map((object) => (targets.has(object.id) ? { ...object, text: "", version: 0 } : object))
      .toSorted((a, b) => a.id.localeCompare(b.id)),
  );
}
function verifyState(view: CanvasBoardView, boardIndex: number) {
  const state = runtime[boardIndex]!,
    prepared = config!.boards[boardIndex]!;
  if (
    view.canvasSeq !== state.expectedSeq ||
    sceneSignature(view, boardIndex) !== state.sceneSignature
  )
    throw new CanvasTargetFailure("FIXTURE_CHANGED", undefined, undefined, boardIndex);
  for (let actorIndex = 0; actorIndex < config!.actors.length; actorIndex++) {
    const id = prepared.targetObjectIds[actorIndex]!,
      object = view.objects.find((value) => value.id === id)!;
    const expected =
      state.last.get(actorIndex) ?? state.original.objects.find((value) => value.id === id)!;
    if (object.text !== expected.text || object.version !== expected.version)
      throw new CanvasTargetFailure("FIXTURE_CHANGED", undefined, actorIndex, boardIndex);
  }
}
async function markers() {
  const live = await json(await request("/health/live"));
  const web = await request("/", undefined, {}, true);
  const webBuild = web.headers.get("x-openround-build-id");
  await web.body?.cancel();
  if (
    (live as { buildId?: unknown })?.buildId !== config!.expectedBuildId ||
    webBuild !== config!.expectedBuildId
  )
    throw new CanvasTargetFailure("BUILD_MISMATCH");
  markerChecks++;
}
async function actor(actorIndex: number) {
  const data = (await json(await request("/v1/auth/me", actorIndex))) as {
    creator?: { userId?: string; plan?: string };
    workspace?: { planSource?: string };
    businessManagementEnabled?: boolean;
  };
  if (
    data?.creator?.userId !== config!.actors[actorIndex]!.userId ||
    !["pro", "team"].includes(data?.creator?.plan ?? "") ||
    data?.workspace?.planSource !== "subscription" ||
    data?.businessManagementEnabled !== true
  )
    throw new CanvasTargetFailure("ACTOR_INVALID", undefined, actorIndex);
}
/** page.evaluate has no Playwright deadline; bound stalled renderers with the coordinator clock. */
async function browserDeadline<T>(work: Promise<T>) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new CanvasTargetFailure("BROWSER_FAILED")),
          requestTimeoutMs,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
async function visible(page: Page, id: string, text: string) {
  try {
    await page.waitForFunction(
      ({ id, text }) => {
        const element = document.querySelector(`[data-testid="canvas-object-${id}"]`),
          content = element?.querySelector("foreignObject"),
          surface = document.querySelector('[data-testid="canvas-surface"]');
        if (!content || content.textContent !== text || !surface) return false;
        const box = content.getBoundingClientRect(),
          area = surface.getBoundingClientRect();
        const left = Math.max(0, box.left, area.left),
          right = Math.min(innerWidth, box.right, area.right),
          top = Math.max(0, box.top, area.top),
          bottom = Math.min(innerHeight, box.bottom, area.bottom);
        if (right <= left || bottom <= top) return false;
        const hit = document.elementFromPoint((left + right) / 2, (top + bottom) / 2);
        return Boolean(hit && element!.contains(hit));
      },
      { id, text },
      { timeout: requestTimeoutMs },
    );
    const accepted = await browserDeadline(
      page.evaluate(
        ({ id, text }) =>
          new Promise<boolean>((done) => {
            requestAnimationFrame(() =>
              requestAnimationFrame(() => {
                const node = document.querySelector(
                    `[data-testid="canvas-object-${id}"] foreignObject`,
                  ),
                  surface = document.querySelector('[data-testid="canvas-surface"]');
                if (!node?.isConnected || node.textContent !== text || !surface) {
                  done(false);
                  return;
                }
                const box = node.getBoundingClientRect(),
                  bounds = surface.getBoundingClientRect();
                const left = Math.max(0, box.left, bounds.left),
                  right = Math.min(innerWidth, box.right, bounds.right),
                  top = Math.max(0, box.top, bounds.top),
                  bottom = Math.min(innerHeight, box.bottom, bounds.bottom);
                const hit =
                  right > left && bottom > top
                    ? document.elementFromPoint((left + right) / 2, (top + bottom) / 2)
                    : null;
                done(Boolean(hit && node.closest("[data-canvas-object]")?.contains(hit)));
              }),
            );
          }),
        { id, text },
      ),
    );
    if (!accepted) throw new CanvasTargetFailure("PEER_NOT_VISIBLE");
    return performance.now();
  } catch {
    throw new CanvasTargetFailure("PEER_NOT_VISIBLE");
  }
}
function recoveryPaint(actorIndex: number) {
  const stream = streams[actorIndex]!;
  if (stream.pendingRecovery !== null) {
    stream.verifiedRecoveries++;
    stream.recoveryMs.push(performance.now() - stream.pendingRecovery);
    stream.pendingRecovery = null;
  }
}
async function navigate(boardIndex: number) {
  for (let index = 0; index < pages.length; index++) {
    if (interrupted) throw new CanvasTargetFailure("INTERRUPTED");
    const page = pages[index]!,
      started = performance.now();
    streams[index]!.currentBoard = boardIndex;
    streams[index]!.lastEnd = null;
    streams[index]!.pendingRecovery = null;
    await page.goto(`${config!.webOrigin}/canvas/${config!.boards[boardIndex]!.boardId}`, {
      waitUntil: "domcontentloaded",
    });
    for (const id of config!.boards[boardIndex]!.targetObjectIds) {
      const object = runtime[boardIndex]!.original.objects.find((value) => value.id === id)!;
      await visible(page, id, object.text);
    }
    initialRenders.push(performance.now() - started);
  }
}
async function makePages() {
  browser = await chromium.launch({ headless: true });
  for (let index = 0; index < config!.actors.length; index++) {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      locale: "en-CA",
      reducedMotion: "reduce",
      serviceWorkers: "block",
    });
    contexts.push(context);
    const cookie = cookies[index]!;
    await context.addCookies(
      [...new Set([config!.apiOrigin, config!.webOrigin])].map((url) => ({
        name: cookie.name,
        value: cookie.value,
        url,
        secure: url.startsWith("https:"),
        httpOnly: true,
        sameSite: "Lax" as const,
      })),
    );
    const page = await context.newPage();
    pages.push(page);
    page.setDefaultTimeout(requestTimeoutMs);
    // tsx function-name preservation helper only; no application configuration or behavior change.
    await page.addInitScript({ content: "globalThis.__name = (target) => target;" });
    page.on("pageerror", () => {
      applicationErrors++;
    });
    const stream = {
      requests: 0,
      closed: 0,
      failed: 0,
      renewals: 0,
      verifiedRecoveries: 0,
      httpErrors: {} as Record<string, number>,
      recoveryMs: [] as number[],
      currentBoard: -1,
      lastEnd: null as number | null,
      pendingRecovery: null as number | null,
    };
    streams.push(stream);
    const requests = new Map<Request, number>(),
      perBoard = new Map<number, number>();
    page.on("request", (item) => {
      const url = new URL(item.url()),
        boardIndex = stream.currentBoard;
      if (
        boardIndex < 0 ||
        url.origin !== config!.apiOrigin ||
        url.pathname !== `/v1/canvas-boards/${config!.boards[boardIndex]!.boardId}/events`
      )
        return;
      requests.set(item, boardIndex);
      stream.requests++;
      const prior = perBoard.get(boardIndex) ?? 0;
      if (prior) {
        stream.renewals++;
        stream.pendingRecovery = stream.lastEnd ?? performance.now();
      }
      perBoard.set(boardIndex, prior + 1);
    });
    page.on("response", (response) => {
      if (requests.has(response.request()) && response.status() >= 400) {
        const key = String(response.status());
        stream.httpErrors[key] = (stream.httpErrors[key] ?? 0) + 1;
      }
    });
    const ended = (item: Request, failed: boolean) => {
      const boardIndex = requests.get(item);
      if (boardIndex === undefined) return;
      requests.delete(item);
      if (failed) stream.failed++;
      else stream.closed++;
      if (boardIndex === stream.currentBoard) stream.lastEnd = performance.now();
    };
    page.on("requestfinished", (item) => ended(item, false));
    page.on("requestfailed", (item) => ended(item, true));
  }
}
async function send(
  page: Page,
  boardIndex: number,
  actorIndex: number,
  text: string,
  expectedVersion: number,
) {
  const mutation = CanvasBoardMutationSchema.parse({
    schemaVersion: CANVAS_SCHEMA_VERSION,
    operationId: randomUUID(),
    command: {
      type: "batch",
      operations: [
        {
          type: "update",
          id: config!.boards[boardIndex]!.targetObjectIds[actorIndex],
          expectedVersion,
          patch: { text },
        },
      ],
    },
  });
  const returned = await browserDeadline(
    page.evaluate(
      async ({ origin, boardId, mutation, limit, timeout }) => {
        try {
          const response = await fetch(`${origin}/v1/canvas-boards/${boardId}/commands`, {
            method: "POST",
            credentials: "include",
            cache: "no-store",
            redirect: "error",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(mutation),
            signal: AbortSignal.timeout(timeout),
          });
          if (!response.ok) {
            await response.body?.cancel();
            return { status: response.status, body: null };
          }
          const body = await response.text();
          if (new TextEncoder().encode(body).byteLength > limit) return { status: 0, body: null };
          try {
            return { status: response.status, body: JSON.parse(body) as unknown };
          } catch {
            return { status: 0, body: null };
          }
        } catch {
          return { status: 0, body: null };
        }
      },
      {
        origin: config!.apiOrigin,
        boardId: config!.boards[boardIndex]!.boardId,
        mutation,
        limit: bodyLimit,
        timeout: requestTimeoutMs,
      },
    ),
  );
  if (!returned.status)
    throw new CanvasTargetFailure("TARGET_NETWORK", undefined, actorIndex, boardIndex);
  if (returned.status !== 200)
    throw new CanvasTargetFailure("TARGET_HTTP", returned.status, actorIndex, boardIndex);
  const parsed = CanvasBoardMutationResponseSchema.safeParse(returned.body);
  if (!parsed.success || parsed.data.receipt.operationId !== mutation.operationId)
    throw new CanvasTargetFailure("ACK_INVALID", undefined, actorIndex, boardIndex);
  const view = validateCanvasTargetBoard(parsed.data.board, config!, boardIndex),
    object = view.objects.find(
      ({ id }) => id === config!.boards[boardIndex]!.targetObjectIds[actorIndex],
    )!;
  if (object.text !== text || object.version !== expectedVersion + 1)
    throw new CanvasTargetFailure("ACK_INVALID", undefined, actorIndex, boardIndex);
  return parsed.data.receipt.canvasSeq;
}
async function wave(boardIndex: number, waveIndex: number, tag: string) {
  const current = await board(boardIndex);
  verifyState(current, boardIndex);
  assertCanvasTargetWaveBudget(current.canvasSeq, config!.actors.length);
  const state = runtime[boardIndex]!,
    actorCount = config!.actors.length;
  const outcomes = await Promise.allSettled(
    pages.map(async (page, actorIndex) => {
      const object = current.objects.find(
          ({ id }) => id === config!.boards[boardIndex]!.targetObjectIds[actorIndex],
        )!,
        text = `${canvasTargetMarker} ${tag} wave${waveIndex} actor${actorIndex}`;
      const peers = Array.from(
        { length: config!.peerFanout },
        (_, offset) => (actorIndex + offset + 1) % actorCount,
      );
      const observed = peers.map((peer) =>
        visible(pages[peer]!, object.id, text).then(
          (at) => ({ actorIndex: peer, at }),
          () => ({ actorIndex: peer, at: null }),
        ),
      );
      state.attempted.set(actorIndex, { text, version: object.version + 1 });
      const started = performance.now();
      let acknowledgementMs: number | null = null,
        sequence: number | null = null;
      try {
        sequence = await send(page, boardIndex, actorIndex, text, object.version);
        acknowledgementMs = performance.now() - started;
        acknowledgements.push(acknowledgementMs);
        state.writes++;
        state.last.set(actorIndex, { text, version: object.version + 1 });
      } catch (error) {
        record(error, actorIndex, boardIndex);
      }
      const peerResults = (await Promise.all(observed)).map(({ actorIndex: peer, at }) => {
        if (at === null) {
          record(new CanvasTargetFailure("PEER_NOT_VISIBLE"), peer, boardIndex);
          return { actorIndex: peer, requestStartToPaintMs: null };
        }
        const elapsed = at - started;
        if (elapsed < 0) {
          record(new CanvasTargetFailure("ACK_INVALID"), peer, boardIndex);
          return { actorIndex: peer, requestStartToPaintMs: null };
        }
        paints.push(elapsed);
        recoveryPaint(peer);
        return { actorIndex: peer, requestStartToPaintMs: elapsed };
      });
      samples.push({
        wave: waveIndex,
        actorIndex,
        boardIndex,
        acknowledgementMs,
        peers: peerResults,
      });
      return sequence;
    }),
  );
  outcomes.forEach((outcome, actorIndex) => {
    if (outcome.status === "rejected") record(outcome.reason, actorIndex, boardIndex);
  });
  if (
    outcomes.some((outcome) => outcome.status !== "fulfilled" || outcome.value === null) ||
    failures.length
  )
    throw new CanvasTargetFailure("ACK_INVALID", undefined, undefined, boardIndex);
  const sequences = outcomes.map((outcome) => (outcome as PromiseFulfilledResult<number>).value);
  if (
    new Set(sequences).size !== actorCount ||
    Math.max(...sequences) !== state.expectedSeq + actorCount
  )
    throw new CanvasTargetFailure("FIXTURE_CHANGED", undefined, undefined, boardIndex);
  state.expectedSeq += actorCount;
  verifyState(await board(boardIndex), boardIndex);
  if (applicationErrors) throw new CanvasTargetFailure("BROWSER_FAILED");
}
async function restore() {
  if (!config || !budget) return;
  const cleanupDeadline = performance.now() + 60_000;
  for (let boardIndex = 0; boardIndex < runtime.length; boardIndex++) {
    const state = runtime[boardIndex]!;
    for (const [actorIndex, attempted] of state.attempted) {
      let outcome = "skipped-error";
      try {
        const id = config.boards[boardIndex]!.targetObjectIds[actorIndex]!,
          original = state.original.objects.find((object) => object.id === id)!;
        outcome = await restoreCanvasTargetText({
          original,
          attempted,
          acknowledged: state.last.get(actorIndex),
          deadline: cleanupDeadline,
          read: () => board(boardIndex, actorIndex),
          write: async (operation) =>
            json(
              await request(
                `/v1/canvas-boards/${config!.boards[boardIndex]!.boardId}/commands`,
                actorIndex,
                {
                  method: "POST",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify(operation),
                },
              ),
            ),
        });
      } catch (error) {
        record(error, actorIndex, boardIndex);
      }
      cleanup.push({ boardIndex, actorIndex, outcome });
    }
  }
}
async function main() {
  // Refuse an unusable/reused report destination before contacting the target.
  await mkdir(dirname(output), { recursive: true, mode: 0o700 });
  reportFile = await open(output, "wx", 0o600);
  try {
    const path = process.env.CANVAS_TARGET_CONFIG;
    if (!path) throw new CanvasTargetFailure("CONFIG_INVALID");
    const info = await lstat(path);
    if (
      !info.isFile() ||
      info.isSymbolicLink() ||
      info.size > 64 * 1024 ||
      (info.mode & 0o077) !== 0
    )
      throw new CanvasTargetFailure("CONFIG_INVALID");
    const input = await readFile(path, "utf8");
    try {
      config = parseCanvasTargetConfig(JSON.parse(input));
    } catch {
      throw new CanvasTargetFailure("CONFIG_INVALID");
    }
    configSha256 = createHash("sha256").update(JSON.stringify(config)).digest("hex");
    cookies = canvasTargetCookies(config, process.env);
    stage = "build-and-actor-preflight";
    await markers();
    for (let index = 0; index < config.actors.length; index++) await actor(index);
    stage = "all-board-preflight";
    for (let boardIndex = 0; boardIndex < config.boards.length; boardIndex++) {
      const original = await board(boardIndex);
      if (Date.parse(original.expiresAt) < Date.now() + (config.durationSeconds + 300) * 1000)
        throw new CanvasTargetFailure("FIXTURE_INVALID", undefined, undefined, boardIndex);
      for (let actorIndex = 1; actorIndex < config.actors.length; actorIndex++) {
        const shared = await board(boardIndex, actorIndex);
        if (
          shared.canvasSeq !== original.canvasSeq ||
          sceneSignature(shared, boardIndex) !== sceneSignature(original, boardIndex)
        )
          throw new CanvasTargetFailure("FIXTURE_CHANGED");
      }
      runtime.push({
        original,
        expectedSeq: original.canvasSeq,
        last: new Map(),
        attempted: new Map(),
        sceneSignature: sceneSignature(original, boardIndex),
        writes: 0,
      });
    }
    budget = canvasTargetBudget(
      runtime.map(({ expectedSeq }) => expectedSeq),
      config.actors.length,
      canvasTargetWaveCount(config),
    );
    stage = "production-browser-preflight";
    await makePages();
    let waveIndex = 0,
      activeBoard = -1;
    const tag = randomUUID().slice(0, 8);
    const first = budget.boards.findIndex(({ assignedWaves }) => assignedWaves > 0);
    stage = "authorized-initial-render";
    await navigate(first);
    activeBoard = first;
    measuredStarted = performance.now();
    startedAt = new Date().toISOString();
    for (let boardIndex = 0; boardIndex < budget.boards.length; boardIndex++) {
      const assignment = budget.boards[boardIndex]!;
      if (
        !assignment.assignedWaves ||
        performance.now() - measuredStarted >= config.durationSeconds * 1000
      )
        continue;
      if (activeBoard !== boardIndex) {
        stage = "authorized-initial-render";
        await navigate(boardIndex);
        activeBoard = boardIndex;
      }
      stage = "paced-write-and-peer-waves";
      for (let iteration = 0; iteration < assignment.assignedWaves; iteration++) {
        if (interrupted) throw new CanvasTargetFailure("INTERRUPTED");
        if (performance.now() - measuredStarted >= config.durationSeconds * 1000) break;
        const started = performance.now();
        await wave(boardIndex, waveIndex++, tag);
        await pause(
          Math.min(
            config.waveIntervalMs - (performance.now() - started),
            config.durationSeconds * 1000 - (performance.now() - measuredStarted),
          ),
        );
      }
    }
    if (interrupted) throw new CanvasTargetFailure("INTERRUPTED");
    if (activeBoard < 0 || !samples.length) throw new CanvasTargetFailure("ACK_INVALID");
    // Finish the declared observation window even if the last paced wave ended slightly early.
    await pause(config.durationSeconds * 1000 - (performance.now() - measuredStarted));
    measuredElapsedMs = performance.now() - measuredStarted;
    stage = "final-authority-and-build-check";
    await markers();
    for (let index = 0; index < config.actors.length; index++) {
      await actor(index);
      const id = config.boards[activeBoard]!.targetObjectIds[index]!,
        last = runtime[activeBoard]!.last.get(index);
      if (last) {
        await visible(pages[index]!, id, last.text);
        recoveryPaint(index);
      }
    }
    if (interrupted) throw new CanvasTargetFailure("INTERRUPTED");
    complete = true;
  } catch (error) {
    record(error);
  } finally {
    if (measuredStarted && !measuredElapsedMs)
      measuredElapsedMs = performance.now() - measuredStarted;
    // Stop queued browser evaluations before restoring through Node HTTP. A timed-out renderer
    // must never resume an old proposal behind cleanup. If shutdown cannot be confirmed, fail
    // closed and leave the synthetic targets for operator reconciliation.
    try {
      await browserDeadline(Promise.allSettled(contexts.map((context) => context.close())));
    } catch {
      record(new CanvasTargetFailure("BROWSER_FAILED"));
    }
    if (browser) {
      try {
        await browserDeadline(browser.close());
      } catch {
        record(new CanvasTargetFailure("BROWSER_FAILED"));
      }
    }
    if (!browser || !browser.isConnected()) await restore();
    else {
      record(new CanvasTargetFailure("BROWSER_FAILED"));
      runtime.forEach((state, boardIndex) => {
        for (const actorIndex of state.attempted.keys())
          cleanup.push({ boardIndex, actorIndex, outcome: "skipped-browser-not-stopped" });
      });
    }
    process.off("SIGINT", signal);
    process.off("SIGTERM", signal);
  }
  const acknowledgement = canvasTargetDistribution(acknowledgements),
    peer = canvasTargetDistribution(paints),
    initial = canvasTargetDistribution(initialRenders);
  const checks = [
    {
      metric: "httpAcknowledgement",
      maximumMs: canvasTargetGates.acknowledgementP95Ms,
      observedMs: acknowledgement.p95,
    },
    {
      metric: "requestStartToPeerPaintOpportunity",
      maximumMs: canvasTargetGates.peerP95Ms,
      observedMs: peer.p95,
    },
  ].map((check) => ({
    ...check,
    status:
      check.observedMs === null
        ? "unmeasured"
        : check.observedMs <= check.maximumMs
          ? "passed"
          : "failed",
  }));
  const streamErrors = streams.reduce(
      (count, stream) =>
        count + Object.values(stream.httpErrors).reduce((sum, value) => sum + value, 0),
      0,
    ),
    cleanRestore = cleanup.every(
      ({ outcome }) => outcome === "restored" || outcome === "fenced-unchanged",
    );
  const passed =
    complete &&
    !interrupted &&
    !failures.length &&
    !applicationErrors &&
    !streamErrors &&
    cleanRestore &&
    checks.every(({ status }) => status === "passed");
  const report = {
    schemaVersion: 1,
    artifactType: "canvas-preprovisioned-target-rehearsal",
    complete,
    passed,
    stage,
    mode: config?.mode ?? null,
    expectedBuildId: config?.expectedBuildId ?? null,
    buildIdentity: {
      successfulApiAndWebMarkerChecks: markerChecks,
      matchingMarkersBeforeAndAfter: markerChecks === 2,
      immutableMarker: Boolean(config && /^[a-f0-9]{40}$/.test(config.expectedBuildId)),
      provenanceIndependentlyVerified: false,
    },
    configSha256,
    startedAt,
    finishedAt: new Date().toISOString(),
    node: process.version,
    client: {
      platform: process.platform,
      architecture: process.arch,
      viewport: { width: 1440, height: 1000 },
      headless: true,
      reducedMotion: "reduce",
    },
    browser: browser?.version() ?? null,
    profile: config?.profile ?? null,
    requestedDurationSeconds: config?.durationSeconds ?? null,
    measuredElapsedMs,
    waveIntervalMs: config?.waveIntervalMs ?? null,
    actorCount: config?.actors.length ?? 0,
    preparedBoards: config?.boards.length ?? 0,
    peerFanout: config?.peerFanout ?? 0,
    peerObservationBudget: config ? canvasTargetObservationBudget(config) : null,
    budget,
    latencyMs: {
      acknowledgement,
      requestStartToPeerPaintOpportunity: peer,
      initialAuthorizedRender: initial,
    },
    smokeGates: { passed, checks },
    roadmapAssessment: {
      peerP95MaximumMs: 500,
      peerObservedP95Ms: peer.p95,
      status: peer.p95 === null ? "unmeasured" : peer.p95 <= 500 ? "numeric-only-pass" : "failed",
      capacityIncreaseAuthorized: false,
    },
    samples,
    streams: streams.map(
      ({ requests, closed, failed, renewals, verifiedRecoveries, httpErrors, recoveryMs }) => ({
        requests,
        closed,
        failed,
        renewals,
        verifiedRecoveries,
        httpErrors,
        recoveryPaintOpportunityMs: canvasTargetDistribution(recoveryMs),
      }),
    ),
    cleanup,
    failures,
    correctness: {
      interrupted,
      applicationErrors,
      streamHttpErrors: streamErrors,
      allAttemptedWritesAcknowledged:
        samples.length > 0 && samples.every((sample) => sample.acknowledgementMs !== null),
      allSampledPeersObserved:
        samples.length > 0 &&
        samples.every((sample) =>
          sample.peers.every((observation) => observation.requestStartToPaintMs !== null),
        ),
      safeTextRestorationComplete: cleanRestore,
      boardsCreated: 0,
      boardsDeleted: 0,
    },
    measurementDefinitions: {
      acknowledgement:
        "Coordinator monotonic time immediately before the normal authenticated browser fetch until receipt/schema/target validation. Includes browser dispatch, network and response processing.",
      peer: "Same coordinator request-start until a different actor's matching on-screen SVG foreignObject text passes hit testing and two animation frames. Upper bound on a paint opportunity, NOT remote database COMMIT-to-peer or physical pixel timing. Never subtract acknowledgement from peer time.",
      initialRender:
        "Sequential navigation to the production app until every prepared target is visible and passes two-rAF checks; caches may be warm.",
      streamRecovery:
        "Natural same-board renewed stream request plus subsequent matching visible text and two-rAF observation. Gaps begin at an observed prior stream end, or renewed request when end was not observed; no induced outage or backpressure saturation claim.",
      receiptBudget:
        "canvasSeq is a conservative upper bound, not an exact receipt count: all three scene/facilitation/invitation receipt insertions commit with a sequence increment. Plan stays≤4500 including per-actor restore and100 drift reserve, preserving≥500 below5000. Rechecked each wave and each restoration; pre-provisioned rotation only.",
    },
    limitations: [
      "Only operator-attested dedicated synthetic boards/accounts; no database seeding, auth/rate-limit bypass, storage replacement or automatic resource provisioning.",
      "Headless desktop Chromium and the target's normal configured APIs; no physical hardware/input/display acceptance or automatic network shaping. Configured all-to-all means only the prepared actors/text targets within the explicit observation budget.",
      "Only configured peer fan-out and target text updates; this does not saturate every facilitation/history/media/guest workflow or prove scanner freshness. Large fan-out adds client-side observation overhead.",
      "No guest publication timing, forced reconnect, slow-consumer saturation or navigation frame-rate qualification is measured by this driver.",
      "A local-rehearsal artifact can NEVER satisfy staging acceptance. Target-mode observations still require independently reviewed topology, saturation, media, device, soak and operational evidence.",
      "Conflicting, deleted, locked, revoked or unverifiable targets are not recreated or overwritten; safe cleanup may require operator review. Uncertain mutations require acknowledged versioned cleanup fences; unresolved cleanup requires operator review.",
    ],
    stagingAcceptanceComplete: false,
    capacityIncreaseAuthorized: false,
  };
  try {
    await reportFile.writeFile(`${JSON.stringify(report, null, 2)}\n`);
  } finally {
    await reportFile.close();
    reportFile = undefined;
  }
  process.stdout.write(
    `${JSON.stringify({ complete, passed, mode: config?.mode ?? null, commands: samples.length, failures: failures.length, capacityIncreaseAuthorized: false })}\n`,
  );
  if (!passed) process.exitCode = 1;
}
void main().catch(async () => {
  await reportFile?.close().catch(() => {});
  process.stderr.write('{"code":"OUTPUT_FAILED"}\n');
  process.exitCode = 1;
});
