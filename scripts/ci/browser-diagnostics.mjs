import { Buffer } from "node:buffer";
import { spawn } from "node:child_process";
import { mkdir, open, readdir } from "node:fs/promises";
import { constants } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { performance } from "node:perf_hooks";
import process from "node:process";
import { clearTimeout, setTimeout } from "node:timers";
import { pathToFileURL } from "node:url";

const memoryKeys = [
  "MemTotal",
  "MemFree",
  "MemAvailable",
  "Buffers",
  "Cached",
  "SReclaimable",
  "SwapTotal",
  "SwapFree",
];
const memoryEventKeys = ["low", "high", "max", "oom", "oom_kill", "oom_group_kill"];
const processStates = { R: 1, S: 2, D: 3, Z: 4, T: 5, t: 6, X: 7, x: 7, K: 8, W: 9, P: 10, I: 11 };
const signals = ["SIGINT", "SIGTERM", "SIGHUP"];

// Never emit proc contents, process names, command lines, environments, paths, or read errors.
async function readSmall(path) {
  let file;
  try {
    file = await open(path, "r");
    const buffer = Buffer.alloc(16 * 1024);
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
    return buffer.toString("utf8", 0, bytesRead);
  } catch {
    return "";
  } finally {
    await file?.close().catch(() => {});
  }
}

function numericFields(text, keys, unit = "") {
  return Object.fromEntries(
    keys.flatMap((key) => {
      const match = text.match(new RegExp(`^${key}:?\\s+(\\d+)${unit}\\s*$`, "m"));
      const value = match ? Number(match[1]) : NaN;
      return Number.isSafeInteger(value) ? [[key, value]] : [];
    }),
  );
}

function pressure(text) {
  return Object.fromEntries(
    ["some", "full"].flatMap((kind) => {
      const line = text.split("\n").find((value) => value.startsWith(`${kind} `));
      if (!line) return [];
      return [
        [
          kind,
          Object.fromEntries(
            ["avg10", "avg60", "avg300", "total"].flatMap((key) => {
              const match = line.match(new RegExp(`(?:^| )${key}=(\\d+(?:\\.\\d+)?)(?: |$)`));
              const value = match ? Number(match[1]) : NaN;
              return Number.isFinite(value) ? [[key, value]] : [];
            }),
          ),
        ],
      ];
    }),
  );
}

function scalar(text) {
  return /^\d+\s*$/.test(text) && Number.isSafeInteger(Number(text)) ? Number(text) : null;
}

export async function collectBrowserResources({
  procRoot = "/proc",
  cgroupRoot = "/sys/fs/cgroup",
} = {}) {
  const [meminfo, memoryPressure, cpuPressure, cgroup] = await Promise.all([
    readSmall(join(procRoot, "meminfo")),
    readSmall(join(procRoot, "pressure/memory")),
    readSmall(join(procRoot, "pressure/cpu")),
    readSmall(join(procRoot, "self/cgroup")),
  ]);
  const memoryKiB = numericFields(meminfo, memoryKeys, " kB");
  const relative = cgroup.match(/^0::([^\n]*)$/m)?.[1];
  const base = resolve(cgroupRoot);
  const candidate = relative === undefined ? null : resolve(base, `.${relative}`);
  const location =
    candidate && (candidate === base || candidate.startsWith(`${base}${sep}`)) ? candidate : null;
  const cgroupData = {};
  if (location) {
    const files = [
      "memory.current",
      "memory.peak",
      "memory.max",
      "memory.events",
      "pids.current",
      "pids.max",
      "pids.events",
    ];
    const values = await Promise.all(files.map((file) => readSmall(join(location, file))));
    Object.assign(cgroupData, {
      memoryCurrentBytes: scalar(values[0]),
      memoryPeakBytes: scalar(values[1]),
      memoryMaxBytes: scalar(values[2]),
      memoryMaxUnlimited: Number(values[2].trim() === "max"),
      memoryEvents: numericFields(values[3], memoryEventKeys),
      pidsCurrent: scalar(values[4]),
      pidsMax: scalar(values[5]),
      pidsMaxUnlimited: Number(values[5].trim() === "max"),
      pidsEvents: numericFields(values[6], ["max"]),
    });
  }
  let entries = [];
  try {
    entries = (await readdir(procRoot)).filter((entry) => /^\d{1,10}$/.test(entry));
  } catch {
    /* Availability is recorded below. */
  }
  const processes = [];
  const selected = entries.slice(0, 4096);
  for (let index = 0; index < selected.length; index += 32) {
    const batch = await Promise.all(
      selected.slice(index, index + 32).map(async (entry) => {
        const text = await readSmall(join(procRoot, entry, "status"));
        const numbers = numericFields(text, ["Pid", "PPid", "Threads"]);
        if (numbers.Pid !== Number(entry)) return null;
        const sizes = numericFields(text, ["VmRSS", "VmSize"], " kB");
        return {
          pid: numbers.Pid,
          ppid: numbers.PPid ?? null,
          threads: numbers.Threads ?? null,
          rssKiB: sizes.VmRSS ?? 0,
          virtualKiB: sizes.VmSize ?? 0,
          state: processStates[text.match(/^State:\s+(\S)/m)?.[1]] ?? 0,
        };
      }),
    );
    processes.push(...batch.filter(Boolean));
  }
  processes.sort((a, b) => b.rssKiB - a.rssKiB || a.pid - b.pid);
  return {
    memoryKiB,
    memoryPressure: pressure(memoryPressure),
    cpuPressure: pressure(cpuPressure),
    cgroup: cgroupData,
    processCount: entries.length,
    scannedProcessCount: selected.length,
    readableProcessCount: processes.length,
    processesTruncated: Number(entries.length > selected.length),
    topRss: processes.slice(0, 20),
    available: {
      memory: Number(Boolean(meminfo)),
      memoryPressure: Number(Boolean(memoryPressure)),
      cpuPressure: Number(Boolean(cpuPressure)),
      cgroup: Number(Boolean(location && Object.keys(cgroupData.memoryEvents ?? {}).length)),
      processes: Number(Boolean(processes.length)),
    },
  };
}

// One timer in this wrapper; no separate sampler process or shell. Sampling never overlaps.
export async function runBrowserDiagnostics(
  command,
  args,
  output,
  {
    intervalMs = 10_000,
    maxSamples = 181,
    maxBytes = 2 * 1024 * 1024,
    collect = collectBrowserResources,
    log = (line) => process.stdout.write(line),
  } = {},
) {
  let file;
  try {
    await mkdir(dirname(output), { recursive: true, mode: 0o700 });
    file = await open(output, "w", 0o600);
  } catch {
    process.stderr.write(
      "Browser resource artifact unavailable; numeric log sampling continues.\n",
    );
  }
  const started = performance.now();
  let bytes = 0;
  let samples = 0;
  let timer;
  let pending;
  let stopped = false;
  let forwardedSignal = null;
  const emit = async (data) => {
    const line = `${JSON.stringify({ schemaVersion: 1, timeMs: Date.now(), elapsedMs: Math.round(performance.now() - started), ...data })}\n`;
    if (bytes + Buffer.byteLength(line) > maxBytes) return;
    bytes += Buffer.byteLength(line);
    try {
      log(`[browser-resources] ${line}`);
    } catch {
      /* Diagnostics cannot mask the test result. */
    }
    await file?.write(line).catch(() => {});
  };
  const sample = async () => {
    if (samples >= maxSamples) return;
    samples += 1;
    try {
      await emit({ event: "sample", sample: samples, resources: await collect() });
    } catch {
      await emit({ event: "sample", sample: samples, unavailable: 1 });
    }
  };
  const schedule = () => {
    if (stopped || samples >= maxSamples || bytes >= maxBytes) return;
    timer = setTimeout(() => {
      pending = sample().then(schedule);
    }, intervalMs);
  };
  const child = spawn(command, args, { stdio: "inherit", detached: process.platform !== "win32" });
  const forward = (signal) => {
    forwardedSignal ??= signal;
    try {
      if (process.platform !== "win32") process.kill(-child.pid, signal);
      else child.kill(signal);
    } catch {
      /* The command may have already exited. */
    }
  };
  const handlers = signals.map((signal) => {
    const handler = () => forward(signal);
    process.on(signal, handler);
    return [signal, handler];
  });
  const result = new Promise((done) => {
    child.once("error", () => done({ code: 127, signal: null }));
    child.once("close", (code, signal) => done({ code, signal }));
  });
  pending = sample().then(schedule);
  const exited = await result;
  stopped = true;
  clearTimeout(timer);
  await pending;
  clearTimeout(timer);
  try {
    await emit({
      event: "finish",
      code: exited.code,
      signal: constants.signals[forwardedSignal ?? exited.signal] ?? 0,
      samples,
    });
  } finally {
    for (const [signal, handler] of handlers) process.off(signal, handler);
    await file?.close().catch(() => {});
  }
  return { code: exited.code ?? 1, signal: forwardedSignal ?? exited.signal };
}

async function main() {
  const [, , option, output, separator, command, ...args] = process.argv;
  if (option !== "--output" || !output || separator !== "--" || !command) {
    process.stderr.write(
      "Usage: node browser-diagnostics.mjs --output FILE -- COMMAND [ARGS...]\n",
    );
    process.exitCode = 2;
    return;
  }
  const result = await runBrowserDiagnostics(command, args, output);
  if (result.signal) {
    process.exitCode = 128 + (constants.signals[result.signal] ?? 1);
    process.kill(process.pid, result.signal);
  } else process.exitCode = result.code;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  await main();
