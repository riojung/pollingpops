import { createHash } from "node:crypto";
import { CanvasObjectCreateSchema } from "../../packages/contracts/src/index.ts";
import { buildCanvasCapacityScene, type CanvasCapacityDistribution } from "./canvas-capacity.ts";

export const collaborationMetrics = [
  "httpAcknowledgement",
  "repositoryResolutionToPeerPaintOpportunity",
  "guestPublication",
  "initialRender",
  "navigationFrameInterval",
  "reconnect",
  "stalledConsumerAcknowledgement",
] as const;
export type CollaborationMetric = (typeof collaborationMetrics)[number];
/** Declared harness acceptance thresholds, not a public service-level objective. */
const defaultGates: Record<CollaborationMetric, number> = {
  httpAcknowledgement: 2000,
  repositoryResolutionToPeerPaintOpportunity: 3000,
  guestPublication: 3000,
  initialRender: 15000,
  navigationFrameInterval: 100,
  reconnect: 12000,
  stalledConsumerAcknowledgement: 2000,
};
export interface CanvasCollaborationConfig {
  objects: number;
  editors: number;
  updates: number;
  warmup: number;
  guestObjects: number;
  latencyMs: number;
  apiPort: number;
  peerPort: number;
  webPort: number;
  distDir: string;
  build: boolean;
  buildOnly: boolean;
  timeoutMs: number;
  gates: Record<CollaborationMetric, number>;
}
export function parseCanvasCollaborationConfig(env: Record<string, string | undefined>) {
  const integer = (name: string, fallback: number, min: number, max: number) => {
    const raw = env[name];
    const value = raw === undefined ? fallback : Number(raw);
    if (!Number.isInteger(value) || value < min || value > max || raw?.trim() === "")
      throw new Error(`${name} must be ${min}–${max}`);
    return value;
  };
  const gates = { ...defaultGates };
  for (const metric of collaborationMetrics) {
    const name = `CANVAS_COLLAB_MAX_${metric.replace(/[A-Z]/g, (c) => `_${c}`).toUpperCase()}_P95_MS`;
    if (env[name] === undefined) continue;
    const value = Number(env[name]);
    if (!env[name]!.trim() || !Number.isFinite(value) || value < 0)
      throw new Error(`${name} must be finite and nonnegative`);
    gates[metric] = value;
  }
  const build = env.CANVAS_COLLAB_BUILD ?? "true";
  if (!["true", "false"].includes(build))
    throw new Error("CANVAS_COLLAB_BUILD must be true or false");
  const buildOnly = env.CANVAS_COLLAB_BUILD_ONLY ?? "false";
  if (!["true", "false"].includes(buildOnly) || (buildOnly === "true" && build === "false"))
    throw new Error("Build-only mode requires CANVAS_COLLAB_BUILD=true");
  const distDir = env.CANVAS_COLLAB_DIST_DIR ?? ".next-canvas-capacity";
  if (!/^\.next-canvas-capacity(?:-[a-z0-9-]{1,48})?$/.test(distDir))
    throw new Error("Use an isolated canvas capacity production build directory");
  const config: CanvasCollaborationConfig = {
    objects: integer("CANVAS_COLLAB_OBJECTS", 500, 20, 500),
    editors: integer("CANVAS_COLLAB_EDITORS", 20, 2, 20),
    updates: integer("CANVAS_COLLAB_UPDATES", 3, 1, 20),
    warmup: integer("CANVAS_COLLAB_WARMUP", 1, 0, 3),
    guestObjects: integer("CANVAS_COLLAB_GUEST_OBJECTS", 100, 2, 300),
    latencyMs: integer("CANVAS_COLLAB_LATENCY_MS", 100, 0, 1000),
    apiPort: integer("CANVAS_COLLAB_API_PORT", 4500, 1024, 65535),
    peerPort: integer("CANVAS_COLLAB_PEER_PORT", 4501, 1024, 65535),
    webPort: integer("CANVAS_COLLAB_WEB_PORT", 3500, 1024, 65535),
    timeoutMs: integer("CANVAS_COLLAB_TIMEOUT_MS", 30000, 1000, 120000),
    distDir,
    build: build === "true",
    buildOnly: buildOnly === "true",
    gates,
  };
  if (config.objects < config.editors + 8)
    throw new Error("Leave eight mixed-scene objects beyond editor targets");
  if (new Set([config.apiPort, config.peerPort, config.webPort]).size !== 3)
    throw new Error("API nodes and web server need distinct ports");
  return config;
}
export function canvasCollaborationScene(config: CanvasCollaborationConfig, mediaId: string) {
  const scene = buildCanvasCapacityScene({
    objects: config.objects,
    editors: config.editors,
    textCharacters: 160,
    penPoints: 32,
  });
  for (const [index, object] of scene.objects.entries()) {
    if (index < config.editors) {
      object.x = (index % 5) * 240;
      object.y = 5000 + Math.floor(index / 5) * 180;
      // Keep measured text above background connector labels, not merely in the DOM.
      object.zIndex = 100;
    }
  }
  // Two placements share one synthetic asset, exercising authorized transport/cache reuse.
  for (let offset = 0; offset < 2; offset++) {
    const index = config.editors + 2 + offset;
    scene.objects[index] = CanvasObjectCreateSchema.parse({
      ...scene.objects[index],
      type: "image",
      mediaId,
      altText: "Synthetic capacity fixture PNG",
      text: "",
      x: 1240,
      y: 5000 + offset * 180,
      parentId: null,
      geometricGroupId: null,
    });
  }
  const serialized = JSON.stringify(scene.objects);
  const counts: Record<string, number> = {};
  for (const object of scene.objects) counts[object.type] = (counts[object.type] ?? 0) + 1;
  return {
    ...scene,
    counts,
    serializedBytes: Buffer.byteLength(serialized),
    sha256: createHash("sha256").update(serialized).digest("hex"),
  };
}
export function evaluateCollaborationGates(
  gates: CanvasCollaborationConfig["gates"],
  measured: Partial<Record<CollaborationMetric, CanvasCapacityDistribution>>,
) {
  const checks = collaborationMetrics.map((metric) => {
    const observedMs = measured[metric]?.p95 ?? null;
    return {
      metric,
      quantile: "p95",
      maximumMs: gates[metric],
      observedMs,
      samples: measured[metric]?.count ?? 0,
      status:
        observedMs === null ? "unmeasured" : observedMs <= gates[metric] ? "passed" : "failed",
    };
  });
  return {
    definition:
      "Declared opt-in fixture acceptance thresholds; not production service-level objectives",
    passed: checks.every((check) => check.status === "passed"),
    checks,
  };
}

/** Both observations use the coordinator monotonic clock. Never mix browser and server epochs. */
export class CanvasPeerPaintLedger {
  private commits = new Map<string, number>();
  private paints = new Map<string, number>();
  commit(operationId: string, at: number) {
    this.finite(at);
    if (!this.commits.has(operationId)) this.commits.set(operationId, at);
  }
  paint(operationId: string, at: number) {
    this.finite(at);
    if (!this.paints.has(operationId)) this.paints.set(operationId, at);
  }
  sample(operationId: string) {
    const commit = this.commits.get(operationId),
      paint = this.paints.get(operationId);
    if (commit === undefined || paint === undefined)
      throw new Error("Incomplete peer paint sample");
    if (paint < commit) throw new Error("Peer observation predates repository command resolution");
    return paint - commit;
  }
  private finite(at: number) {
    if (!Number.isFinite(at) || at < 0) throw new Error("Use a finite nonnegative monotonic time");
  }
}
