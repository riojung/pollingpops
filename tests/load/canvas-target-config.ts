import { isIP } from "node:net";
import { Buffer } from "node:buffer";
import { CanvasBoardViewSchema, type CanvasBoardView } from "../../packages/contracts/src/index.ts";

export const canvasTargetMarker = "CANVAS TARGET REHEARSAL:";
export const canvasTargetReceiptCeiling = 4500;
export const canvasTargetDriftReserve = 100;
export const canvasTargetGates = Object.freeze({ acknowledgementP95Ms: 2000, peerP95Ms: 3000 });
export interface CanvasTargetConfig {
  schemaVersion: 1;
  mode: "target" | "local-rehearsal";
  confirm: "dedicated-synthetic-only";
  expectedBuildId: string;
  apiOrigin: string;
  webOrigin: string;
  workspaceId: string;
  profile: "smoke" | "soak";
  durationSeconds: number;
  waveIntervalMs: number;
  peerFanout: number;
  maxPeerObservations: number;
  actors: Array<{ userId: string; cookieEnv: string }>;
  boards: Array<{ boardId: string; targetObjectIds: string[] }>;
}
export type TargetFailureCode =
  | "CONFIG_INVALID"
  | "COOKIE_INVALID"
  | "TARGET_HTTP"
  | "TARGET_NETWORK"
  | "TARGET_BODY"
  | "BUILD_MISMATCH"
  | "ACTOR_INVALID"
  | "FIXTURE_INVALID"
  | "BUDGET_EXCEEDED"
  | "FIXTURE_CHANGED"
  | "BROWSER_FAILED"
  | "PEER_NOT_VISIBLE"
  | "ACK_INVALID"
  | "INTERRUPTED"
  | "GATE_FAILED";
/** Fixed classifications only: never attach the originating error, URL or response body. */
export class CanvasTargetFailure extends Error {
  constructor(
    readonly code: TargetFailureCode,
    readonly status?: number,
    readonly actorIndex?: number,
    readonly boardIndex?: number,
  ) {
    super(code);
    this.name = "CanvasTargetFailure";
  }
}
function fail(code: TargetFailureCode): never {
  throw new CanvasTargetFailure(code);
}
function record(value: unknown, keys: string[], optional: string[] = []): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("CONFIG_INVALID");
  const result = value as Record<string, unknown>;
  if (
    Object.keys(result).some((key) => !keys.includes(key) && !optional.includes(key)) ||
    keys.some((key) => !(key in result))
  )
    fail("CONFIG_INVALID");
  return result;
}
function text(value: unknown) {
  if (typeof value !== "string") fail("CONFIG_INVALID");
  return value;
}
function uuid(value: unknown) {
  const result = text(value);
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(result))
    fail("CONFIG_INVALID");
  return result;
}
function integer(value: unknown, minimum: number, maximum: number) {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < minimum ||
    value > maximum
  )
    fail("CONFIG_INVALID");
  return value;
}
function list(value: unknown, minimum: number, maximum: number): unknown[] {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum)
    fail("CONFIG_INVALID");
  return value;
}
function loopback(host: string) {
  return host === "localhost" || host === "[::1]" || host === "127.0.0.1";
}
function origin(input: string, local: boolean) {
  let value: URL;
  try {
    value = new URL(input);
  } catch {
    return fail("CONFIG_INVALID");
  }
  if (
    value.origin !== input ||
    value.username ||
    value.password ||
    value.pathname !== "/" ||
    value.search ||
    value.hash
  )
    fail("CONFIG_INVALID");
  if (
    local
      ? !loopback(value.hostname) || !["http:", "https:"].includes(value.protocol)
      : value.protocol !== "https:" || loopback(value.hostname)
  )
    fail("CONFIG_INVALID");
  if (
    !local &&
    (isIP(value.hostname.replace(/^\[|\]$/g, "")) ||
      /(?:^|\.)(?:example|invalid|test|localhost)$/.test(value.hostname) ||
      value.hostname.endsWith("."))
  )
    fail("CONFIG_INVALID");
  return value.origin;
}
export function parseCanvasTargetConfig(input: unknown): CanvasTargetConfig {
  const data = record(
    input,
    [
      "schemaVersion",
      "mode",
      "confirm",
      "expectedBuildId",
      "apiOrigin",
      "webOrigin",
      "workspaceId",
      "profile",
      "durationSeconds",
      "waveIntervalMs",
      "actors",
      "boards",
    ],
    ["peerFanout", "maxPeerObservations"],
  );
  if (
    data.schemaVersion !== 1 ||
    !["target", "local-rehearsal"].includes(text(data.mode)) ||
    data.confirm !== "dedicated-synthetic-only" ||
    !["smoke", "soak"].includes(text(data.profile)) ||
    (!/^[a-f0-9]{40}$/.test(text(data.expectedBuildId)) &&
      !(data.mode === "local-rehearsal" && data.expectedBuildId === "unversioned"))
  )
    fail("CONFIG_INVALID");
  const config: CanvasTargetConfig = {
    schemaVersion: 1,
    mode: data.mode as CanvasTargetConfig["mode"],
    confirm: "dedicated-synthetic-only",
    expectedBuildId: text(data.expectedBuildId),
    apiOrigin: text(data.apiOrigin),
    webOrigin: text(data.webOrigin),
    workspaceId: uuid(data.workspaceId),
    profile: data.profile as CanvasTargetConfig["profile"],
    durationSeconds: integer(data.durationSeconds, 30, 3600),
    waveIntervalMs: integer(data.waveIntervalMs, 2000, 60_000),
    peerFanout: integer(data.peerFanout === undefined ? 1 : data.peerFanout, 1, 19),
    maxPeerObservations: integer(
      data.maxPeerObservations === undefined ? 10_000 : data.maxPeerObservations,
      1,
      100_000,
    ),
    actors: list(data.actors, 2, 20).map((value) => {
      const item = record(value, ["userId", "cookieEnv"]),
        cookieEnv = text(item.cookieEnv);
      if (!/^CANVAS_TARGET_COOKIE_[A-Z0-9_]{1,40}$/.test(cookieEnv)) fail("CONFIG_INVALID");
      return { userId: uuid(item.userId), cookieEnv };
    }),
    boards: list(data.boards, 1, 20).map((value) => {
      const item = record(value, ["boardId", "targetObjectIds"]);
      return {
        boardId: uuid(item.boardId),
        targetObjectIds: list(item.targetObjectIds, 2, 20).map(uuid),
      };
    }),
  };
  config.apiOrigin = origin(config.apiOrigin, config.mode === "local-rehearsal");
  config.webOrigin = origin(config.webOrigin, config.mode === "local-rehearsal");
  if (
    config.profile === "smoke"
      ? config.durationSeconds !== 30
      : config.durationSeconds < 900 ||
        config.durationSeconds > 3600 ||
        config.durationSeconds % 60 !== 0
  )
    fail("CONFIG_INVALID");
  if (
    config.peerFanout >= config.actors.length ||
    new Set(config.actors.map((item) => item.userId)).size !== config.actors.length ||
    new Set(config.actors.map((item) => item.cookieEnv)).size !== config.actors.length ||
    new Set(config.boards.map((item) => item.boardId)).size !== config.boards.length
  )
    fail("CONFIG_INVALID");
  for (const item of config.boards)
    if (
      item.targetObjectIds.length !== config.actors.length ||
      new Set(item.targetObjectIds).size !== config.actors.length
    )
      fail("CONFIG_INVALID");
  canvasTargetObservationBudget(config);
  return config;
}
export function canvasTargetObservationBudget(
  config: Pick<
    CanvasTargetConfig,
    "durationSeconds" | "waveIntervalMs" | "actors" | "peerFanout" | "maxPeerObservations"
  >,
) {
  const plannedPeerObservations =
    canvasTargetWaveCount(config) * config.actors.length * config.peerFanout;
  if (plannedPeerObservations > config.maxPeerObservations) fail("CONFIG_INVALID");
  return {
    plannedPeerObservations,
    maximumPeerObservations: config.maxPeerObservations,
    mode: config.peerFanout === config.actors.length - 1 ? "all-to-all" : "sampled",
  };
}
export function canvasTargetCookies(
  config: CanvasTargetConfig,
  env: Record<string, string | undefined>,
) {
  const cookies = config.actors.map(({ cookieEnv }) => {
    const value = env[cookieEnv];
    // Exactly one cookie pair. No header copy, attributes, control characters or whitespace.
    if (
      !value ||
      !/^[!#$%&'*+.^_`|~A-Za-z0-9-]+=[\x21\x23-\x2b\x2d-\x3a\x3c-\x5b\x5d-\x7e]+$/.test(value) ||
      value.length > 4096
    )
      return fail("COOKIE_INVALID");
    const separator = value.indexOf("=");
    return { header: value, name: value.slice(0, separator), value: value.slice(separator + 1) };
  });
  if (new Set(cookies.map(({ header }) => header)).size !== cookies.length) fail("COOKIE_INVALID");
  return cookies;
}
export function canvasTargetWaveCount(
  config: Pick<CanvasTargetConfig, "durationSeconds" | "waveIntervalMs">,
) {
  return Math.ceil((config.durationSeconds * 1000) / config.waveIntervalMs);
}
export function canvasTargetBudget(
  sequences: number[],
  actorCount: number,
  requestedWaves: number,
) {
  if (
    !Number.isSafeInteger(actorCount) ||
    actorCount < 2 ||
    actorCount > 20 ||
    !Number.isSafeInteger(requestedWaves) ||
    requestedWaves < 1 ||
    !sequences.length ||
    sequences.some((n) => !Number.isSafeInteger(n) || n < 0 || n >= canvasTargetReceiptCeiling)
  )
    fail("BUDGET_EXCEEDED");
  let remaining = requestedWaves;
  const boards = sequences.map((sequenceUpperBound) => {
    const potentialRestoreReserve = actorCount;
    const maximumWaves = Math.max(
      0,
      Math.floor(
        (canvasTargetReceiptCeiling -
          canvasTargetDriftReserve -
          potentialRestoreReserve -
          sequenceUpperBound) /
          actorCount,
      ),
    );
    const assignedWaves = Math.min(remaining, maximumWaves);
    remaining -= assignedWaves;
    const restoreReserve = assignedWaves ? potentialRestoreReserve : 0;
    return {
      sequenceUpperBound,
      restoreReserve,
      driftReserve: assignedWaves ? canvasTargetDriftReserve : 0,
      maximumWaves,
      assignedWaves,
      maximumSequenceAfterRestore: sequenceUpperBound + assignedWaves * actorCount + restoreReserve,
    };
  });
  if (remaining) fail("BUDGET_EXCEEDED");
  return { ceiling: canvasTargetReceiptCeiling, hardReceiptLimit: 5000, requestedWaves, boards };
}
export function assertCanvasTargetWaveBudget(sequence: number, actors: number) {
  if (
    !Number.isSafeInteger(sequence) ||
    sequence < 0 ||
    !Number.isSafeInteger(actors) ||
    actors < 2 ||
    actors > 20 ||
    sequence + actors * 2 + canvasTargetDriftReserve > canvasTargetReceiptCeiling
  )
    fail("BUDGET_EXCEEDED");
}
export function validateCanvasTargetBoard(
  input: unknown,
  config: CanvasTargetConfig,
  boardIndex: number,
): CanvasBoardView {
  const result = CanvasBoardViewSchema.safeParse(input),
    target = config.boards[boardIndex];
  if (!result.success || !target) fail("FIXTURE_INVALID");
  const view = result.data;
  if (
    view.id !== target.boardId ||
    view.workspaceId !== config.workspaceId ||
    view.boardType !== "team" ||
    view.sourceBoardId !== null ||
    view.status !== "active" ||
    !view.capabilities.edit ||
    view.role === "viewer" ||
    !view.title.startsWith(canvasTargetMarker) ||
    Buffer.byteLength(JSON.stringify(view.objects)) + config.actors.length * 256 >
      2 * 1024 * 1024 ||
    new Set(view.objects.map(({ id }) => id)).size !== view.objects.length
  )
    fail("FIXTURE_INVALID");
  for (const object of view.objects) {
    if (
      object.type === "idea_ref" ||
      (object.text && !object.text.startsWith(canvasTargetMarker)) ||
      (object.type === "image" && !object.altText.startsWith(canvasTargetMarker))
    )
      fail("FIXTURE_INVALID");
  }
  for (const id of target.targetObjectIds) {
    const object = view.objects.find((item) => item.id === id);
    if (
      !object ||
      !["text", "sticky"].includes(object.type) ||
      object.locked ||
      object.parentId ||
      object.geometricGroupId ||
      !object.text.startsWith(canvasTargetMarker) ||
      object.text.length > 512
    )
      fail("FIXTURE_INVALID");
  }
  return view;
}
export function canvasTargetRestoreEligible(
  current: { text: string; version: number },
  last: { text: string; version: number } | undefined,
) {
  return Boolean(last && current.text === last.text && current.version === last.version);
}
export function canvasTargetDistribution(values: number[]) {
  const sorted = values.toSorted((a, b) => a - b);
  if (sorted.some((n) => !Number.isFinite(n) || n < 0)) fail("ACK_INVALID");
  const percentile = (q: number) =>
    sorted.length ? sorted[Math.max(0, Math.ceil(sorted.length * q) - 1)]! : null;
  return {
    count: sorted.length,
    p50: percentile(0.5),
    p95: percentile(0.95),
    p99: percentile(0.99),
    max: sorted.at(-1) ?? null,
  };
}
