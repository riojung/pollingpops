import { describe, expect, it } from "vitest";
import {
  canvasSoakReceiptPlan,
  minimumSoakStreamOpens,
  parseCanvasSoakConfig,
} from "../load/canvas-soak-config";

describe("bounded canvas continuous-connection workload", () => {
  it("leaves existing burst mode disabled by default", () => {
    expect(parseCanvasSoakConfig({}, 20)).toMatchObject({
      seconds: 0,
      mode: "disabled",
      plannedWaves: 0,
    });
  });

  it("distinguishes short local rehearsal from fifteen-minute soak", () => {
    expect(parseCanvasSoakConfig({ CANVAS_COLLAB_SOAK_SECONDS: "30" }, 20).mode).toBe("rehearsal");
    expect(parseCanvasSoakConfig({ CANVAS_COLLAB_SOAK_SECONDS: "900" }, 20)).toMatchObject({
      mode: "soak",
      waveIntervalMs: 5000,
      plannedWaves: 180,
    });
  });

  it("keeps a sixty-minute run within the same document lifetime budget", () => {
    const config = parseCanvasSoakConfig({ CANVAS_COLLAB_SOAK_SECONDS: "3600" }, 20);
    expect(config.waveIntervalMs).toBe(19000);
    expect(config.creatorSessionLifetimeMs).toBe(4_500_000);
    const plan = canvasSoakReceiptPlan(config, 100, 20, 1);
    expect(plan.measuredCommands).toBe(3800);
    expect(plan.churnCommands).toBe(66);
    expect(plan.warmupCommands).toBe(20);
    expect(plan.postludeReserve).toBe(200);
    expect(plan.maximumSequence).toBe(4186);
    expect(plan.maximumSequence).toBeLessThanOrEqual(4500);
    expect(plan.productReceiptLimit).toBe(5000);
  });

  it("bounds facilitation churn and preserves the twenty-editor continuous workload", () => {
    const short = parseCanvasSoakConfig({ CANVAS_COLLAB_SOAK_SECONDS: "30" }, 20);
    expect(short.creatorSessionLifetimeMs).toBe(3_600_000);
    expect(parseCanvasSoakConfig({}, 20).creatorSessionLifetimeMs).toBe(3_600_000);
    expect(canvasSoakReceiptPlan(short, 100, 20, 1)).toMatchObject({
      measuredCommands: 120,
      churnRounds: 1,
      churnCommands: 6,
      maximumSequence: 446,
    });
    const soak = parseCanvasSoakConfig({ CANVAS_COLLAB_SOAK_SECONDS: "900" }, 20);
    expect(canvasSoakReceiptPlan(soak, 100, 20, 1)).toMatchObject({
      measuredCommands: 3600,
      churnRounds: 2,
      churnCommands: 12,
      maximumSequence: 3932,
    });
    expect(() => parseCanvasSoakConfig({ CANVAS_COLLAB_SOAK_SECONDS: "30" }, 2)).toThrow(/twenty/);
    expect(parseCanvasSoakConfig({}, 2).mode).toBe("disabled");
    expect(() => canvasSoakReceiptPlan(short, 0, Number.NaN, 1)).toThrow();
    expect(() => canvasSoakReceiptPlan(short, 0, 20, Number.POSITIVE_INFINITY)).toThrow();
    expect(() => canvasSoakReceiptPlan({ ...short, plannedWaves: 191 }, 0, 20, 1)).toThrow(
      /budget/,
    );
  });

  it("rejects exhausted canvases and overly aggressive pacing before writes", () => {
    const config = parseCanvasSoakConfig({ CANVAS_COLLAB_SOAK_SECONDS: "900" }, 20);
    expect(() => canvasSoakReceiptPlan(config, 1000, 20, 1)).toThrow(/headroom/);
    expect(() =>
      parseCanvasSoakConfig(
        { CANVAS_COLLAB_SOAK_SECONDS: "3600", CANVAS_COLLAB_SOAK_INTERVAL_MS: "1000" },
        20,
      ),
    ).toThrow(/budget/);
  });

  it("does not turn malformed input or profiler truncation into soak evidence", () => {
    for (const seconds of ["", "NaN", "29", "3601", "-1", "30.5"])
      expect(() => parseCanvasSoakConfig({ CANVAS_COLLAB_SOAK_SECONDS: seconds }, 20)).toThrow();
    expect(() =>
      parseCanvasSoakConfig(
        { CANVAS_COLLAB_SOAK_SECONDS: "900", CANVAS_COLLAB_PROFILE: "true" },
        20,
      ),
    ).toThrow(/profiling/);
    expect(() => canvasSoakReceiptPlan(parseCanvasSoakConfig({}, 20), Number.NaN, 20, 1)).toThrow();
  });

  it("expects successful reopens across the existing five-minute stream lifetime", () => {
    expect(minimumSoakStreamOpens(0)).toBe(0);
    expect(minimumSoakStreamOpens(30)).toBe(1);
    expect(minimumSoakStreamOpens(309)).toBe(1);
    expect(minimumSoakStreamOpens(310)).toBe(2);
    expect(minimumSoakStreamOpens(900)).toBe(3);
    expect(minimumSoakStreamOpens(3600)).toBe(12);
    for (const seconds of [Number.NaN, -1, 30.5, 3601])
      expect(() => minimumSoakStreamOpens(seconds)).toThrow();
  });
});
