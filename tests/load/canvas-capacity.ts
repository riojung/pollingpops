import { createHash } from "node:crypto";
import {
  CANVAS_MAX_DOCUMENT_BYTES,
  CANVAS_MAX_OBJECTS,
  CANVAS_MAX_OPERATIONS,
  CANVAS_SCHEMA_VERSION,
  CanvasBoardMutationSchema,
  CanvasObjectCreateSchema,
  CanvasObjectSchema,
  type CanvasBoardCommand,
  type CanvasBoardMutation,
  type CanvasObject,
  type CanvasObjectCreate,
} from "../../packages/contracts/src/index.ts";

export interface CanvasCapacityConfig {
  backend: "memory" | "postgres";
  objects: number;
  editors: number;
  updatesPerEditor: number;
  warmupPerEditor: number;
  readRounds: number;
  textCharacters: number;
  penPoints: number;
  gates: Partial<Record<CanvasCapacityGateMetric, number>>;
}
export type CanvasCapacityGateMetric =
  "commitAcknowledgement" | "concurrentSnapshotRead" | "facilitationMutation";
export interface CanvasCapacityDistribution {
  count: number;
  p50: number | null;
  p95: number | null;
  p99: number | null;
  max: number | null;
}
export function parseCanvasCapacityConfig(
  env: Record<string, string | undefined>,
): CanvasCapacityConfig {
  function integer(name: string, fallback: number, minimum: number, maximum: number) {
    const supplied = env[name];
    const value = supplied === undefined ? fallback : Number(supplied);
    if (!Number.isInteger(value) || value < minimum || value > maximum || supplied?.trim() === "")
      throw new Error(`${name} must be ${minimum}–${maximum}`);
    return value;
  }
  const backend = env.CANVAS_LOAD_BACKEND ?? "memory";
  if (backend !== "memory" && backend !== "postgres")
    throw new Error("CANVAS_LOAD_BACKEND must be memory or postgres");
  const gates: CanvasCapacityConfig["gates"] = {};
  for (const [name, metric] of [
    ["CANVAS_LOAD_MAX_COMMIT_P95_MS", "commitAcknowledgement"],
    ["CANVAS_LOAD_MAX_READ_P95_MS", "concurrentSnapshotRead"],
    ["CANVAS_LOAD_MAX_FACILITATION_P95_MS", "facilitationMutation"],
  ] as const) {
    if (env[name] === undefined) continue;
    const value = Number(env[name]);
    if (!env[name]!.trim() || !Number.isFinite(value) || value < 0)
      throw new Error(`${name} must be a finite nonnegative number`);
    gates[metric] = value;
  }
  const config: CanvasCapacityConfig = {
    backend,
    objects: integer("CANVAS_LOAD_OBJECTS", 500, 20, Math.min(500, CANVAS_MAX_OBJECTS)),
    editors: integer("CANVAS_LOAD_EDITORS", 20, 2, 50),
    updatesPerEditor: integer("CANVAS_LOAD_UPDATES", 10, 1, 50),
    warmupPerEditor: integer("CANVAS_LOAD_WARMUP", 1, 0, 10),
    readRounds: integer("CANVAS_LOAD_READ_ROUNDS", 3, 1, 10),
    textCharacters: integer("CANVAS_LOAD_TEXT_CHARS", 160, 16, 1000),
    penPoints: integer("CANVAS_LOAD_PEN_POINTS", 32, 2, 128),
    gates,
  };
  if (config.objects < config.editors + 8)
    throw new Error(
      "CANVAS_LOAD_OBJECTS must leave eight mixed-scene objects beyond the editor targets",
    );
  return config;
}
const sample = "共同で計画する · 함께 계획하기 · Planifier ensemble · ";
export function canvasCapacityText(label: string, characters: number) {
  return (label + " · " + sample.repeat(Math.ceil(characters / sample.length)))
    .slice(0, characters)
    .normalize("NFC");
}
function sceneId(index: number) {
  return `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`;
}

/** Current protocol is explicit: parsed current objects must never enter a frozen V1 envelope. */
export function canvasCapacityMutation(
  command: CanvasBoardCommand,
  operationId: string,
): CanvasBoardMutation {
  return CanvasBoardMutationSchema.parse({
    schemaVersion: CANVAS_SCHEMA_VERSION,
    operationId,
    command,
  });
}
export function buildCanvasCapacityScene(
  config: Pick<CanvasCapacityConfig, "objects" | "editors" | "textCharacters" | "penPoints">,
) {
  if (
    config.objects > CANVAS_MAX_OBJECTS ||
    config.objects > 500 ||
    config.objects < config.editors + 8
  )
    throw new Error("Capacity scene exceeds its current bounded workload");
  const objects: CanvasObjectCreate[] = [];
  const targets: string[] = [];
  const nodeTypes = ["sticky", "rect", "ellipse", "text", "diamond", "parallelogram"] as const;
  for (let index = 0; index < config.editors; index++) {
    const id = sceneId(index);
    targets.push(id);
    objects.push(
      CanvasObjectCreateSchema.parse({
        id,
        type: nodeTypes[index % nodeTypes.length],
        x: index * 240,
        y: 5000,
        width: 220,
        height: 160,
        text: canvasCapacityText(`Editor target ${index}`, config.textCharacters),
      }),
    );
  }
  const frames = [sceneId(config.editors), sceneId(config.editors + 1)];
  for (const [index, id] of frames.entries())
    objects.push(
      CanvasObjectCreateSchema.parse({
        id,
        type: "frame",
        x: index * 7000,
        y: 0,
        width: 6500,
        height: 4500,
        text: canvasCapacityText(`Manual frame ${index}`, config.textCharacters),
      }),
    );
  for (let index = objects.length; index < config.objects; index++) {
    const local = index - config.editors - 2;
    const frame = Math.floor(local / 4) % 2;
    const x = (local % 25) * 240 + frame * 7000,
      y = Math.floor(local / 25) * 180;
    const base = {
      id: sceneId(index),
      x,
      y,
      width: 220,
      height: 160,
      text: canvasCapacityText(`Manual object ${index}`, config.textCharacters),
    };
    if (local % 8 === 4 || local % 8 === 7)
      objects.push(
        CanvasObjectCreateSchema.parse({
          ...base,
          type: "connector",
          from: { objectId: targets[local % targets.length], anchor: "right", x: 0, y: 0 },
          to: { objectId: targets[(local + 1) % targets.length], anchor: "left", x: 0, y: 0 },
        }),
      );
    else if (local % 8 === 5)
      objects.push(
        CanvasObjectCreateSchema.parse({
          ...base,
          type: "pen",
          text: "",
          points: Array.from({ length: config.penPoints }, (_, point) => [
            x + point,
            y + (point % 7) * 3,
          ]),
        }),
      );
    else
      objects.push(
        CanvasObjectCreateSchema.parse({
          ...base,
          type: nodeTypes[local % nodeTypes.length],
          parentId: frames[frame],
          geometricGroupId: sceneId(config.objects + Math.floor(local / 4)),
        }),
      );
  }
  const serialized = JSON.stringify(objects);
  const bytes = Buffer.byteLength(serialized);
  if (bytes > CANVAS_MAX_DOCUMENT_BYTES)
    throw new Error("Capacity fixture exceeds the current scene byte limit");
  const counts: Record<string, number> = {};
  for (const object of objects) counts[object.type] = (counts[object.type] ?? 0) + 1;
  return {
    objects,
    editorTargetIds: targets,
    serializedBytes: bytes,
    counts,
    sha256: createHash("sha256").update(serialized).digest("hex"),
  };
}
/** Pack by current byte validation and the shared 50-object budget, including prior group peers. */
export function canvasCapacitySeedBatches(objects: readonly CanvasObjectCreate[]) {
  const batches: CanvasObjectCreate[][] = [];
  let batch: CanvasObjectCreate[] = [];
  const acknowledged: CanvasObject[] = [];
  const accepted = (items: CanvasObjectCreate[]) => {
    try {
      canvasCapacitySeedMutation(items, acknowledged, sceneId(900000));
      return true;
    } catch {
      return false;
    }
  };
  for (const object of objects) {
    if (batch.length && (batch.length >= CANVAS_MAX_OPERATIONS || !accepted([...batch, object]))) {
      batches.push(batch);
      acknowledged.push(
        ...batch.map((object) => CanvasObjectSchema.parse({ ...object, version: 1 })),
      );
      batch = [];
    }
    if (!accepted([object]))
      throw new Error("A capacity fixture object cannot fit a current command");
    batch.push(object);
  }
  if (batch.length) batches.push(batch);
  return batches;
}
/** Joining an existing geometric group fences its acknowledged peers, even for create-only batches. */
export function canvasCapacitySeedMutation(
  objects: readonly CanvasObjectCreate[],
  currentObjects: readonly CanvasObject[],
  operationId: string,
) {
  const groups = new Set(objects.map((object) => object.geometricGroupId).filter(Boolean));
  const related = currentObjects.filter(
    (object) => object.geometricGroupId && groups.has(object.geometricGroupId),
  );
  if (
    new Set([...objects.map((object) => object.id), ...related.map((object) => object.id)]).size >
    CANVAS_MAX_OPERATIONS
  )
    throw new Error("A capacity seed exceeds the affected-object budget");
  return canvasCapacityMutation(
    {
      type: "batch",
      operations: objects.map((object) => ({ type: "create", object })),
      ...(related.length
        ? {
            expectedRelated: related.map((object) => ({
              id: object.id,
              expectedVersion: object.version,
            })),
          }
        : {}),
    },
    operationId,
  );
}
export function canvasCapacityDistribution(samples: readonly number[]): CanvasCapacityDistribution {
  if (samples.some((sample) => !Number.isFinite(sample) || sample < 0))
    throw new Error("Capacity latency samples must be finite and nonnegative");
  const ordered = [...samples].sort((a, b) => a - b);
  const at = (quantile: number) =>
    ordered.length
      ? Math.round(ordered[Math.max(0, Math.ceil(ordered.length * quantile) - 1)]! * 100) / 100
      : null;
  return { count: ordered.length, p50: at(0.5), p95: at(0.95), p99: at(0.99), max: at(1) };
}
export function evaluateCanvasCapacityGates(
  gates: CanvasCapacityConfig["gates"],
  measured: Partial<Record<CanvasCapacityGateMetric, CanvasCapacityDistribution>>,
) {
  const checks = Object.entries(gates).map(([metric, maximumMs]) => {
    const observedMs = measured[metric as CanvasCapacityGateMetric]?.p95 ?? null;
    return {
      metric: `repositoryLatencyMs.${metric}.p95`,
      maximumMs,
      observedMs,
      status: observedMs === null ? "unmeasured" : observedMs <= maximumMs ? "passed" : "failed",
    };
  });
  return {
    scope: "Repository call latency only; not peer delivery or public capacity",
    requested: checks.length > 0,
    passed: checks.every((check) => check.status === "passed"),
    checks,
  };
}
