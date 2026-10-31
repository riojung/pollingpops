import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import {
  CANVAS_MAX_DOCUMENT_BYTES,
  CANVAS_MAX_OPERATION_BYTES,
  CANVAS_SCHEMA_VERSION,
  CanvasBoardMutationSchema,
  CanvasObjectCreateSchema,
  CanvasObjectSchema,
} from "../../packages/contracts/src/index.ts";
import {
  buildCanvasCapacityScene,
  canvasCapacityDistribution,
  canvasCapacityMutation,
  canvasCapacitySeedBatches,
  canvasCapacitySeedMutation,
  evaluateCanvasCapacityGates,
  parseCanvasCapacityConfig,
} from "../load/canvas-capacity.ts";

const root = resolve(import.meta.dirname, "../..");
const operationId = "00000000-0000-4000-8000-000000009999";
const tiny = () =>
  parseCanvasCapacityConfig({
    CANVAS_LOAD_OBJECTS: "20",
    CANVAS_LOAD_EDITORS: "2",
    CANVAS_LOAD_UPDATES: "1",
    CANVAS_LOAD_WARMUP: "0",
    CANVAS_LOAD_READ_ROUNDS: "1",
  });

describe("bounded current-protocol canvas capacity fixtures", () => {
  it("allows an isolated higher-editor candidate profile without raising scene limits", () => {
    const config = parseCanvasCapacityConfig({ CANVAS_LOAD_EDITORS: "40" });
    expect(config).toMatchObject({ editors: 40, objects: 500 });
    expect(buildCanvasCapacityScene(config).objects).toHaveLength(500);
    expect(() => parseCanvasCapacityConfig({ CANVAS_LOAD_OBJECTS: "1000" })).toThrow();
  });
  it("keeps default and requested work inside existing object/editor/action budgets", () => {
    expect(parseCanvasCapacityConfig({})).toMatchObject({
      objects: 500,
      editors: 20,
      updatesPerEditor: 10,
      warmupPerEditor: 1,
      gates: {},
    });
    for (const env of [
      { CANVAS_LOAD_OBJECTS: "501" },
      { CANVAS_LOAD_EDITORS: "51" },
      { CANVAS_LOAD_UPDATES: "51" },
      { CANVAS_LOAD_WARMUP: "11" },
      { CANVAS_LOAD_OBJECTS: "" },
      { CANVAS_LOAD_PEN_POINTS: "129" },
      { CANVAS_LOAD_OBJECTS: "20", CANVAS_LOAD_EDITORS: "20" },
      { CANVAS_LOAD_BACKEND: "remote" },
      { CANVAS_LOAD_MAX_COMMIT_P95_MS: "Infinity" },
      { CANVAS_LOAD_MAX_READ_P95_MS: "-1" },
      { CANVAS_LOAD_MAX_FACILITATION_P95_MS: "" },
    ])
      expect(() => parseCanvasCapacityConfig(env)).toThrow();
  });

  it("builds deterministic mixed V3 diagrams with valid endpoints, coherent groups and independent editor targets", () => {
    const config = tiny(),
      first = buildCanvasCapacityScene(config),
      second = buildCanvasCapacityScene(config);
    expect(first.sha256).toBe(second.sha256);
    expect(first.objects).toEqual(second.objects);
    expect(first.objects).toHaveLength(20);
    for (const type of [
      "sticky",
      "rect",
      "ellipse",
      "text",
      "frame",
      "connector",
      "pen",
      "diamond",
      "parallelogram",
    ])
      expect(first.counts[type], type).toBeGreaterThan(0);
    const ids = new Set(first.objects.map((object) => object.id));
    const groups = new Map<string, string | null>();
    for (const object of first.objects) {
      expect(CanvasObjectCreateSchema.safeParse(object).success).toBe(true);
      if (object.type === "connector") {
        expect(ids.has(object.from.objectId!)).toBe(true);
        expect(ids.has(object.to.objectId!)).toBe(true);
      }
      if (object.geometricGroupId) {
        if (groups.has(object.geometricGroupId))
          expect(groups.get(object.geometricGroupId)).toBe(object.parentId);
        groups.set(object.geometricGroupId, object.parentId);
      }
    }
    for (const id of first.editorTargetIds)
      expect(first.objects.find((object) => object.id === id)).toMatchObject({
        parentId: null,
        geometricGroupId: null,
      });
    expect(first.objects.some((object) => /共同|함께/.test(object.text))).toBe(true);
    expect(first.serializedBytes).toBeLessThanOrEqual(CANVAS_MAX_DOCUMENT_BYTES);
  });

  it("never wraps current objects in a frozen V1 request", () => {
    const scene = buildCanvasCapacityScene(tiny());
    const command = {
      type: "batch" as const,
      operations: [{ type: "create" as const, object: scene.objects[0]! }],
    };
    const mutation = canvasCapacityMutation(command, operationId);
    expect(mutation.schemaVersion).toBe(CANVAS_SCHEMA_VERSION);
    expect(mutation.schemaVersion).toBe(3);
    expect(CanvasBoardMutationSchema.safeParse(mutation).success).toBe(true);
    expect(CanvasBoardMutationSchema.safeParse({ ...mutation, schemaVersion: 1 }).success).toBe(
      false,
    );
  });

  it("packs a large Unicode/path fixture by both operation and serialized-byte caps", () => {
    const scene = buildCanvasCapacityScene(
      parseCanvasCapacityConfig({ CANVAS_LOAD_TEXT_CHARS: "1000", CANVAS_LOAD_PEN_POINTS: "128" }),
    );
    const batches = canvasCapacitySeedBatches(scene.objects);
    expect(batches.flat()).toEqual(scene.objects);
    expect(batches.some((batch) => batch.length < 50)).toBe(true);
    const acknowledged: Array<ReturnType<typeof CanvasObjectSchema.parse>> = [];
    for (const objects of batches) {
      const mutation = canvasCapacitySeedMutation(objects, acknowledged, operationId);
      if (mutation.command.type !== "batch") throw new Error("Expected seed batch");
      expect(objects.length + (mutation.command.expectedRelated?.length ?? 0)).toBeLessThanOrEqual(
        50,
      );
      expect(Buffer.byteLength(JSON.stringify(mutation))).toBeLessThanOrEqual(
        CANVAS_MAX_OPERATION_BYTES,
      );
      acknowledged.push(
        ...objects.map((object) => CanvasObjectSchema.parse({ ...object, version: 1 })),
      );
    }
  });

  it("fences acknowledged group peers when a seed group crosses a transaction boundary", () => {
    const scene = buildCanvasCapacityScene(parseCanvasCapacityConfig({}));
    const batches = canvasCapacitySeedBatches(scene.objects);
    const current = batches
      .slice(0, 4)
      .flat()
      .map((object) => CanvasObjectSchema.parse({ ...object, version: 7 }));
    const mutation = canvasCapacitySeedMutation(batches[4]!, current, operationId);
    expect(mutation.command.type).toBe("batch");
    if (mutation.command.type !== "batch") throw new Error("Expected seed batch");
    const groups = new Set(batches[4]!.map((object) => object.geometricGroupId).filter(Boolean));
    const peers = current.filter(
      (object) => object.geometricGroupId && groups.has(object.geometricGroupId),
    );
    expect(peers.length).toBeGreaterThan(0);
    expect(mutation.command.expectedRelated).toEqual(
      peers.map((object) => ({ id: object.id, expectedVersion: 7 })),
    );
    expect(mutation.command.operations).toHaveLength(batches[4]!.length);
    expect(batches[4]!.length + peers.length).toBeLessThanOrEqual(50);
    expect(CanvasBoardMutationSchema.safeParse(mutation).success).toBe(true);
  });

  it("reports nearest-rank p50/p95/p99 with explicit empty samples", () => {
    expect(canvasCapacityDistribution(Array.from({ length: 20 }, (_, index) => index + 1))).toEqual(
      { count: 20, p50: 10, p95: 19, p99: 20, max: 20 },
    );
    expect(canvasCapacityDistribution([])).toEqual({
      count: 0,
      p50: null,
      p95: null,
      p99: null,
      max: null,
    });
    expect(() => canvasCapacityDistribution([NaN])).toThrow();
    expect(() => canvasCapacityDistribution([-1])).toThrow();
  });

  it("scopes gates to measured repository p95 and fails closed when requested evidence is absent", () => {
    const measured = canvasCapacityDistribution([1, 2, 3]);
    const config = parseCanvasCapacityConfig({
      CANVAS_LOAD_MAX_COMMIT_P95_MS: "2",
      CANVAS_LOAD_MAX_READ_P95_MS: "3",
      CANVAS_LOAD_MAX_FACILITATION_P95_MS: "0",
    });
    const gates = evaluateCanvasCapacityGates(config.gates, {
      commitAcknowledgement: measured,
      concurrentSnapshotRead: measured,
    });
    expect(gates.passed).toBe(false);
    expect(gates.checks.map((check) => check.status)).toEqual(["failed", "passed", "unmeasured"]);
    expect(gates.checks.every((check) => check.metric.startsWith("repositoryLatencyMs."))).toBe(
      true,
    );
    expect(evaluateCanvasCapacityGates({}, {}).requested).toBe(false);
  });

  it.each([
    { objects: 20, editors: 2 },
    { objects: 250, editors: 20 },
  ])(
    "executes a $objects-object/$editors-editor memory smoke with retained facilitation and explicit evidence limits",
    async ({ objects, editors }) => {
      const env = Object.fromEntries(
        Object.entries(process.env).filter(([key]) => !key.startsWith("CANVAS_LOAD_")),
      );
      const { stdout, stderr } = await promisify(execFile)(
        process.execPath,
        ["--import", "tsx", "tests/load/canvas-load.mts"],
        {
          cwd: root,
          env: {
            ...env,
            CANVAS_LOAD_BACKEND: "memory",
            CANVAS_LOAD_OBJECTS: String(objects),
            CANVAS_LOAD_EDITORS: String(editors),
            CANVAS_LOAD_UPDATES: "1",
            CANVAS_LOAD_WARMUP: "0",
            CANVAS_LOAD_READ_ROUNDS: "1",
            CANVAS_LOAD_TEXT_CHARS: "32",
            CANVAS_LOAD_PEN_POINTS: "2",
          },
          timeout: 30000,
          maxBuffer: 1024 * 1024,
        },
      );
      expect(stderr).toBe("");
      const evidence = JSON.parse(stdout);
      expect(evidence).toMatchObject({
        evidenceSchemaVersion: 1,
        protocolVersion: CANVAS_SCHEMA_VERSION,
        capacityIncreaseAuthorized: false,
        environment: { backend: "memory", restrictedRlsChecked: false, databaseVersion: null },
        workload: {
          objects,
          licensedEditors: editors,
          retainedDiscussionThreads: Math.min(editors, 8),
          retainedDiscussionMessages: Math.min(editors, 8) * 2,
          retainedCheckpoints: 2,
          committedMeasuredUpdates: editors,
        },
        correctness: {
          allIndependentUpdatesRetained: true,
          exactRetryDeduplicated: true,
          exactRetryNoSequenceAdvance: true,
          staleObjectRejected: true,
          facadeReopenChecked: true,
          independentConnectionDurabilityChecked: false,
          discussionsTimerAndCheckpointsRetained: true,
        },
      });
      expect(evidence.repositoryLatencyMs.commitAcknowledgement.count).toBe(editors);
      expect(evidence.repositoryLatencyMs.concurrentSnapshotRead.count).toBe(editors);
      expect(evidence.repositoryLatencyMs.facilitationMutation.count).toBe(
        Math.min(editors, 8) * 4 + 5,
      );
      expect(evidence.unmeasured).toContain("post-commit peer delivery and network RTT");
      expect(evidence.gates.requested).toBe(false);
      for (const excluded of [
        "tokenHash",
        "DATABASE_ADMIN_URL",
        "DATABASE_URL",
        "threadId",
        "messageId",
        "Synthetic anchored discussion",
        "@example.test",
      ])
        expect(stdout).not.toContain(excluded);
    },
    35000,
  );
});
