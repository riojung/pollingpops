/** Local continuous-connection diagnostics; these never accept a deployment or raise limits. */
export interface CanvasSoakConfig {
  seconds: number;
  mode: "disabled" | "rehearsal" | "soak";
  waveIntervalMs: number;
  plannedWaves: number;
  sampleIntervalMs: number;
  churnIntervalMs: number;
  creatorSessionLifetimeMs: number;
}

function integer(
  raw: string | undefined,
  fallback: number,
  name: string,
  min: number,
  max: number,
) {
  const value = raw === undefined ? fallback : Number(raw);
  if (raw?.trim() === "" || !Number.isInteger(value) || value < min || value > max)
    throw new Error(`${name} must be ${min}–${max}`);
  return value;
}

export function parseCanvasSoakConfig(
  env: Record<string, string | undefined>,
  editors: number,
): CanvasSoakConfig {
  const seconds = integer(env.CANVAS_COLLAB_SOAK_SECONDS, 0, "CANVAS_COLLAB_SOAK_SECONDS", 0, 3600);
  if (seconds > 0 && seconds < 30) throw new Error("Use at least 30 seconds for a soak rehearsal");
  if (!Number.isInteger(editors) || editors < 2 || editors > 20)
    throw new Error("Use the existing two–twenty editor workload");
  if (seconds && editors !== 20)
    throw new Error("Continuous canvas evidence requires all twenty licensed editors");
  // Keep at most 3,800 measured commands. Longer runs retain connections and increase spacing,
  // rather than weakening the document's 5,000 lifetime-receipt limit.
  const minimumInterval = Math.max(
    5000,
    Math.ceil((seconds * 1000 * editors) / 3800 / 1000) * 1000,
  );
  const waveIntervalMs = integer(
    env.CANVAS_COLLAB_SOAK_INTERVAL_MS,
    minimumInterval,
    "CANVAS_COLLAB_SOAK_INTERVAL_MS",
    1000,
    120000,
  );
  const plannedWaves = seconds ? Math.ceil((seconds * 1000) / waveIntervalMs) : 0;
  if (plannedWaves * editors > 3800)
    throw new Error("Soak pacing exceeds the reserved receipt budget");
  if (seconds && env.CANVAS_COLLAB_PROFILE === "true")
    throw new Error("Disable repository profiling for sustained soak runs");
  return {
    seconds,
    mode: seconds === 0 ? "disabled" : seconds < 900 ? "rehearsal" : "soak",
    waveIntervalMs,
    plannedWaves,
    sampleIntervalMs: 30000,
    churnIntervalMs: seconds < 900 ? 15000 : 300000,
    // Fixture credentials must outlive setup, a sixty-minute window and the unchanged postlude.
    // This does not change production session policy or any request/stream deadline.
    creatorSessionLifetimeMs: Math.max(3_600_000, seconds * 1000 + 15 * 60_000),
  };
}

export function canvasSoakReceiptPlan(
  config: CanvasSoakConfig,
  initialSequence: number,
  editors: number,
  warmupWaves: number,
) {
  if (
    !Number.isSafeInteger(initialSequence) ||
    initialSequence < 0 ||
    !Number.isInteger(editors) ||
    editors < 2 ||
    editors > 20 ||
    (config.seconds > 0 && editors !== 20) ||
    !Number.isInteger(warmupWaves) ||
    warmupWaves < 0 ||
    warmupWaves > 3 ||
    !Number.isSafeInteger(config.plannedWaves) ||
    config.plannedWaves < 0
  )
    throw new Error("Invalid initial sequence, editor count or warmup budget");
  const measuredCommands = config.plannedWaves * editors;
  if (measuredCommands > 3800) throw new Error("Soak pacing exceeds the reserved receipt budget");
  const churnRounds = Math.floor((config.seconds * 1000 - 1) / config.churnIntervalMs);
  const churnCommands = Math.max(0, churnRounds) * 6;
  const warmupCommands = warmupWaves * editors;
  const postludeReserve = 200;
  const maximumSequence =
    initialSequence + warmupCommands + measuredCommands + churnCommands + postludeReserve;
  if (!Number.isSafeInteger(maximumSequence) || maximumSequence > 4500)
    throw new Error("Soak would consume reserved document operation headroom");
  return {
    initialSequence,
    warmupCommands,
    measuredCommands,
    churnRounds: Math.max(0, churnRounds),
    churnCommands,
    postludeReserve,
    maximumSequence,
    conservativeCeiling: 4500,
    productReceiptLimit: 5000,
    basis:
      "Successful sequence increments bound retained receipts; sequence is not an exact receipt count",
  };
}

export function minimumSoakStreamOpens(seconds: number) {
  if (!Number.isInteger(seconds) || seconds < 0 || seconds > 3600)
    throw new Error("Use a bounded continuous workload duration");
  // Leave ten seconds for the first handshake and reconnect scheduling at the final boundary.
  return seconds === 0 ? 0 : 1 + Math.max(0, Math.floor((seconds - 10) / 300));
}
