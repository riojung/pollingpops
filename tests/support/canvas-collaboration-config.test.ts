import { describe, expect, it } from "vitest";
import {
  CanvasObjectCreateSchema,
  CanvasBoardMutationSchema,
} from "../../packages/contracts/src/index.ts";
import { canvasCapacityDistribution, canvasCapacitySeedBatches } from "../load/canvas-capacity.ts";
import {
  CanvasPeerPaintLedger,
  canvasCollaborationScene,
  evaluateCollaborationGates,
  parseCanvasCollaborationConfig,
} from "../load/canvas-collaboration-config.ts";

describe("bounded browser collaboration evidence", () => {
  it("never raises product caps and refuses unsafe build paths, port collisions and nonnumeric gates", () => {
    expect(parseCanvasCollaborationConfig({})).toMatchObject({
      objects: 500,
      editors: 20,
      latencyMs: 100,
      build: true,
    });
    for (const env of [
      { CANVAS_COLLAB_OBJECTS: "501" },
      { CANVAS_COLLAB_EDITORS: "21" },
      { CANVAS_COLLAB_GUEST_OBJECTS: "301" },
      { CANVAS_COLLAB_UPDATES: "21" },
      { CANVAS_COLLAB_OBJECTS: "20", CANVAS_COLLAB_EDITORS: "20" },
      { CANVAS_COLLAB_API_PORT: "3500" },
      { CANVAS_COLLAB_DIST_DIR: "../.next" },
      { CANVAS_COLLAB_MAX_HTTP_ACKNOWLEDGEMENT_P95_MS: "NaN" },
      { CANVAS_COLLAB_MAX_RECONNECT_P95_MS: "-1" },
      { CANVAS_COLLAB_BUILD: "yes" },
      { CANVAS_COLLAB_BUILD_ONLY: "yes" },
      { CANVAS_COLLAB_BUILD_ONLY: "true", CANVAS_COLLAB_BUILD: "false" },
    ])
      expect(() => parseCanvasCollaborationConfig(env)).toThrow();
    expect(
      parseCanvasCollaborationConfig({ CANVAS_COLLAB_MAX_RECONNECT_P95_MS: "25.5" }).gates
        .reconnect,
    ).toBe(25.5);
    expect(parseCanvasCollaborationConfig({ CANVAS_COLLAB_BUILD_ONLY: "true" }).buildOnly).toBe(
      true,
    );
  });
  it("keeps a deterministic complete mixed scene while making every editor target visible in a bounded grid", () => {
    const config = parseCanvasCollaborationConfig({});
    const mediaId = "00000000-0000-4000-8000-000000009999";
    const scene = canvasCollaborationScene(config, mediaId);
    expect(scene.objects).toHaveLength(500);
    expect(scene.counts.image).toBe(2);
    expect(scene.sha256).toBe(canvasCollaborationScene(config, mediaId).sha256);
    expect(new Set(scene.objects.map((object) => object.id)).size).toBe(500);
    for (const object of scene.objects)
      expect(CanvasObjectCreateSchema.safeParse(object).success).toBe(true);
    for (const id of scene.editorTargetIds) {
      const object = scene.objects.find((candidate) => candidate.id === id)!;
      expect(object.x).toBeLessThanOrEqual(960);
      expect(object.y).toBeGreaterThanOrEqual(5000);
      expect(object.parentId).toBeNull();
      expect(object.zIndex).toBe(100);
    }
    for (const objects of canvasCapacitySeedBatches(scene.objects))
      expect(
        CanvasBoardMutationSchema.safeParse({
          schemaVersion: 3,
          operationId: mediaId,
          command: {
            type: "batch",
            operations: objects.map((object) => ({ type: "create", object })),
          },
        }).success,
      ).toBe(true);
  });
  it("fails gates with missing observations, includes every metric, and preserves configured numeric thresholds", () => {
    const config = parseCanvasCollaborationConfig({});
    const gates = evaluateCollaborationGates(config.gates, {
      httpAcknowledgement: canvasCapacityDistribution([1, 2001]),
    });
    expect(gates.passed).toBe(false);
    expect(gates.checks.find((check) => check.metric === "httpAcknowledgement")?.status).toBe(
      "failed",
    );
    expect(gates.checks.find((check) => check.metric === "guestPublication")?.status).toBe(
      "unmeasured",
    );
    expect(gates.checks).toHaveLength(7);
  });
  it("correlates independent operations, retains first receipt timing, and rejects missing or cross-clock samples", () => {
    const ledger = new CanvasPeerPaintLedger();
    ledger.commit("a", 10);
    ledger.commit("a", 100);
    ledger.paint("a", 25);
    ledger.paint("a", 500);
    ledger.paint("b", 50);
    ledger.commit("b", 30);
    expect(ledger.sample("a")).toBe(15);
    expect(ledger.sample("b")).toBe(20);
    expect(() => ledger.sample("missing")).toThrow("Incomplete");
    ledger.commit("bad", 100);
    ledger.paint("bad", 99);
    expect(() => ledger.sample("bad")).toThrow("predates");
    expect(() => ledger.commit("bad", Number.NaN)).toThrow();
  });
});
