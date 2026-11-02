import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { CanvasObjectSchema } from "../../packages/contracts/src/index.ts";
import {
  assertCanvasTargetWaveBudget,
  canvasTargetBudget,
  canvasTargetCookies,
  canvasTargetDistribution,
  canvasTargetMarker,
  canvasTargetObservationBudget,
  canvasTargetRestoreEligible,
  canvasTargetWaveCount,
  parseCanvasTargetConfig,
  validateCanvasTargetBoard,
} from "../load/canvas-target-config.ts";

function input() {
  return {
    schemaVersion: 1,
    mode: "local-rehearsal",
    confirm: "dedicated-synthetic-only",
    expectedBuildId: "a".repeat(40),
    apiOrigin: "http://127.0.0.1:4500",
    webOrigin: "http://127.0.0.1:3500",
    workspaceId: randomUUID(),
    profile: "smoke",
    durationSeconds: 30,
    waveIntervalMs: 2000,
    actors: [0, 1].map((i) => ({ userId: randomUUID(), cookieEnv: `CANVAS_TARGET_COOKIE_${i}` })),
    boards: [{ boardId: randomUUID(), targetObjectIds: [randomUUID(), randomUUID()] }],
  };
}
function view(config: ReturnType<typeof parseCanvasTargetConfig>) {
  return {
    schemaVersion: 3,
    id: config.boards[0]!.boardId,
    workspaceId: config.workspaceId,
    organizationId: randomUUID(),
    ownerUserId: config.actors[0]!.userId,
    title: `${canvasTargetMarker} smoke`,
    boardType: "team",
    sourceBoardId: null,
    status: "active",
    canvasSeq: 7,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 86400000).toISOString(),
    role: "editor",
    capabilities: { edit: true, facilitate: false, share: false, delete: false, archive: false },
    objects: config.boards[0]!.targetObjectIds.map((id) =>
      CanvasObjectSchema.parse({
        id,
        type: "sticky",
        x: 0,
        y: 0,
        width: 240,
        height: 160,
        version: 1,
        text: `${canvasTargetMarker} original`,
      }),
    ),
    grants: [],
    invitations: [],
    undoOperationId: null,
    redoOperationId: null,
  };
}
describe("deployed-target canvas safety and budgeting", () => {
  it("accepts only explicit loopback rehearsals or credential-free HTTPS targets", () => {
    expect(parseCanvasTargetConfig(input()).peerFanout).toBe(1);
    const target = {
      ...input(),
      mode: "target",
      apiOrigin: "https://api.pollingpops.net",
      webOrigin: "https://app.pollingpops.net",
    };
    expect(parseCanvasTargetConfig(target).mode).toBe("target");
    expect(
      parseCanvasTargetConfig({ ...input(), expectedBuildId: "unversioned" }).expectedBuildId,
    ).toBe("unversioned");
    expect(() => parseCanvasTargetConfig({ ...target, expectedBuildId: "unversioned" })).toThrow(
      "CONFIG_INVALID",
    );
    for (const override of [
      { mode: "target" },
      { apiOrigin: "http://10.0.0.1" },
      { apiOrigin: "http://127.0.0.1:4500/path" },
      { apiOrigin: "http://user:password@127.0.0.1:4500" },
      { apiOrigin: "http://127.0.0.1:4500?token=x" },
      { expectedBuildId: "main" },
      { confirm: "yes" },
      { cookie: "secret" },
    ])
      expect(() => parseCanvasTargetConfig({ ...input(), ...override })).toThrow("CONFIG_INVALID");
  });
  it("bounds opt-in all-to-all observations before any requests and keeps the default modest", () => {
    const original = input(),
      many = {
        ...original,
        actors: Array.from({ length: 20 }, (_, i) => ({
          userId: randomUUID(),
          cookieEnv: `CANVAS_TARGET_COOKIE_${i}`,
        })),
        boards: [
          {
            boardId: randomUUID(),
            targetObjectIds: Array.from({ length: 20 }, () => randomUUID()),
          },
        ],
      };
    expect(canvasTargetObservationBudget(parseCanvasTargetConfig(many))).toMatchObject({
      mode: "sampled",
      plannedPeerObservations: 300,
      maximumPeerObservations: 10_000,
    });
    expect(
      canvasTargetObservationBudget(parseCanvasTargetConfig({ ...many, peerFanout: 19 })),
    ).toMatchObject({ mode: "all-to-all", plannedPeerObservations: 5700 });
    expect(() =>
      parseCanvasTargetConfig({ ...many, peerFanout: 19, maxPeerObservations: 5699 }),
    ).toThrow("CONFIG_INVALID");
    expect(() =>
      parseCanvasTargetConfig({ ...many, peerFanout: 19, maxPeerObservations: 100_001 }),
    ).toThrow("CONFIG_INVALID");
    expect(() =>
      parseCanvasTargetConfig({
        ...many,
        profile: "soak",
        durationSeconds: 3600,
        peerFanout: 19,
        maxPeerObservations: 100_000,
      }),
    ).toThrow("CONFIG_INVALID");
    expect(
      canvasTargetObservationBudget(
        parseCanvasTargetConfig({
          ...many,
          profile: "soak",
          durationSeconds: 3600,
          waveIntervalMs: 15000,
          peerFanout: 19,
          maxPeerObservations: 100_000,
        }),
      ).plannedPeerObservations,
    ).toBe(91200);
  });
  it("rejects actor, target, profile and pacing mistakes before accessing a target", () => {
    const original = input();
    for (const override of [
      { actors: [original.actors[0]] },
      { actors: [original.actors[0], original.actors[0]] },
      { boards: [original.boards[0], original.boards[0]] },
      { peerFanout: 2 },
      { peerFanout: null },
      { profile: "smoke", durationSeconds: 31 },
      { profile: "soak", durationSeconds: 899 },
      { profile: "soak", durationSeconds: 3601 },
      { waveIntervalMs: 1999 },
      { boards: [{ ...original.boards[0], targetObjectIds: [randomUUID()] }] },
      { actors: [{ ...original.actors[0], cookieEnv: "HOME" }, original.actors[1]] },
    ])
      expect(() => parseCanvasTargetConfig({ ...original, ...override })).toThrow("CONFIG_INVALID");
    expect(canvasTargetWaveCount(parseCanvasTargetConfig(original))).toBe(15);
    expect(
      canvasTargetWaveCount(
        parseCanvasTargetConfig({ ...original, profile: "soak", durationSeconds: 3600 }),
      ),
    ).toBe(1800);
  });
  it("keeps cookie values solely in named environment keys and refuses copied headers or duplicate identities", () => {
    const config = parseCanvasTargetConfig(input());
    expect(
      canvasTargetCookies(config, {
        CANVAS_TARGET_COOKIE_0: "creator=synthetic-one",
        CANVAS_TARGET_COOKIE_1: "creator=synthetic-two",
      })[0]?.name,
    ).toBe("creator");
    for (const value of [
      undefined,
      "creator=a; Path=/",
      "Cookie: creator=a",
      "creator=a\r\nheader:b",
      "creator=a other=b",
    ])
      expect(() =>
        canvasTargetCookies(config, {
          CANVAS_TARGET_COOKIE_0: value,
          CANVAS_TARGET_COOKIE_1: "creator=other",
        }),
      ).toThrow("COOKIE_INVALID");
    expect(() =>
      canvasTargetCookies(config, {
        CANVAS_TARGET_COOKIE_0: "creator=same",
        CANVAS_TARGET_COOKIE_1: "creator=same",
      }),
    ).toThrow("COOKIE_INVALID");
  });
  it("reserves restores/drift below4500 and rejects insufficient pre-provisioned capacity atomically", () => {
    const budget = canvasTargetBudget([4300, 100], 20, 10);
    expect(budget.boards.map((item) => item.assignedWaves)).toEqual([4, 6]);
    expect(
      budget.boards.every((item) => item.maximumSequenceAfterRestore + item.driftReserve <= 4500),
    ).toBe(true);
    expect(() => canvasTargetBudget([4390], 20, 1)).toThrow("BUDGET_EXCEEDED");
    expect(() => canvasTargetBudget([0], 20, 220)).toThrow("BUDGET_EXCEEDED");
    expect(() => canvasTargetBudget([4500], 2, 1)).toThrow("BUDGET_EXCEEDED");
    expect(() => canvasTargetBudget([NaN], 2, 1)).toThrow("BUDGET_EXCEEDED");
    expect(() => assertCanvasTargetWaveBudget(4360, 20)).not.toThrow();
    expect(() => assertCanvasTargetWaveBudget(4361, 20)).toThrow("BUDGET_EXCEEDED");
    expect(() => assertCanvasTargetWaveBudget(0, 21)).toThrow("BUDGET_EXCEEDED");
    expect(() => assertCanvasTargetWaveBudget(0, NaN)).toThrow("BUDGET_EXCEEDED");
    expect(canvasTargetBudget([0, 4499], 2, 1).boards[1]).toMatchObject({
      assignedWaves: 0,
      restoreReserve: 0,
      driftReserve: 0,
      maximumSequenceAfterRestore: 4499,
    });
  });
  it("checks complete board identity, permissions, synthetic content and target ownership before writes", () => {
    const config = parseCanvasTargetConfig(input()),
      original = view(config);
    expect(validateCanvasTargetBoard(original, config, 0).objects).toHaveLength(2);
    for (const override of [
      { workspaceId: randomUUID() },
      { title: "Customer board" },
      { boardType: "workshop", sourceBoardId: randomUUID() },
      { capabilities: { ...original.capabilities, edit: false } },
      { status: "archived" },
      { objects: [original.objects[0], original.objects[0]] },
      { objects: [{ ...original.objects[0], locked: true }, original.objects[1]] },
      { objects: [{ ...original.objects[0], text: "Unmarked content" }, original.objects[1]] },
      { objects: [{ ...original.objects[0], parentId: randomUUID() }, original.objects[1]] },
    ])
      expect(() => validateCanvasTargetBoard({ ...original, ...override }, config, 0)).toThrow(
        "FIXTURE_INVALID",
      );
  });
  it("restores only a matching proposal/version and rejects cross-clock or missing latency evidence", () => {
    expect(
      canvasTargetRestoreEligible({ text: "own", version: 2 }, { text: "own", version: 2 }),
    ).toBe(true);
    expect(
      canvasTargetRestoreEligible({ text: "own", version: 3 }, { text: "own", version: 2 }),
    ).toBe(false);
    expect(
      canvasTargetRestoreEligible({ text: "other", version: 2 }, { text: "own", version: 2 }),
    ).toBe(false);
    expect(canvasTargetRestoreEligible({ text: "own", version: 2 }, undefined)).toBe(false);
    expect(canvasTargetDistribution([])).toMatchObject({ count: 0, p95: null });
    expect(canvasTargetDistribution([1, 2, 3, 4])).toMatchObject({ count: 4, p50: 2, p95: 4 });
    expect(() => canvasTargetDistribution([-1])).toThrow("ACK_INVALID");
  });
});
