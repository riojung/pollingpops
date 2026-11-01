import { spawn, type ChildProcess } from "node:child_process";
import { writeFileSync } from "node:fs";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { afterEach, describe, expect, it } from "vitest";
import {
  collectBrowserResources,
  runBrowserDiagnostics,
} from "../../scripts/ci/browser-diagnostics.mjs";

const script = resolve(import.meta.dirname, "../../scripts/ci/browser-diagnostics.mjs");
const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "pollingpops-browser-diagnostics-"));
  directories.push(root);
  return root;
}

async function put(root: string, path: string, content: string) {
  const full = join(root, path);
  await mkdir(resolve(full, ".."), { recursive: true });
  await writeFile(full, content);
}

function childResult(child: ChildProcess) {
  return new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((done, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => done({ code, signal }));
  });
}

describe("bounded browser runner diagnostics", () => {
  it("records only allowlisted numeric Linux fields and the top 20 resident processes", async () => {
    const root = await fixture();
    await put(
      root,
      "proc/meminfo",
      "MemTotal: 8192 kB\nMemAvailable: 512 kB\nCached: 1024 kB\nSecret: private-user-data\n",
    );
    await put(
      root,
      "proc/pressure/memory",
      "some avg10=1.25 avg60=0.50 avg300=0.25 total=123\nfull avg10=0.50 avg60=0.10 avg300=0.05 total=45\n",
    );
    await put(root, "proc/pressure/cpu", "some avg10=3.50 avg60=2.50 avg300=1.50 total=456\n");
    await put(root, "proc/self/cgroup", "0::/owned\n");
    for (const [file, value] of Object.entries({
      "memory.current": "4096\n",
      "memory.peak": "8192\n",
      "memory.max": "max\n",
      "memory.events": "low 0\nhigh 2\nmax 0\noom 1\noom_kill 1\nsecret 777\n",
      "pids.current": "21\n",
      "pids.max": "256\n",
      "pids.events": "max 0\n",
    }))
      await put(root, `cgroup/owned/${file}`, value);
    for (let pid = 1; pid <= 21; pid += 1) {
      await put(
        root,
        `proc/${pid}/status`,
        `Name:\tprivate-user-data\nState:\tS (private-user-data)\nPid:\t${pid}\nPPid:\t0\nThreads:\t2\nVmRSS:\t${pid * 100} kB\nVmSize:\t9000 kB\n`,
      );
      await put(root, `proc/${pid}/cmdline`, "credential-and-command-line-must-never-be-read");
      await put(root, `proc/${pid}/environ`, "secret-environment-must-never-be-read");
    }
    const value = await collectBrowserResources({
      procRoot: join(root, "proc"),
      cgroupRoot: join(root, "cgroup"),
    });
    expect(value.memoryKiB).toEqual({ MemTotal: 8192, MemAvailable: 512, Cached: 1024 });
    expect(value.memoryPressure.some).toEqual({
      avg10: 1.25,
      avg60: 0.5,
      avg300: 0.25,
      total: 123,
    });
    expect(value.cgroup).toMatchObject({
      memoryCurrentBytes: 4096,
      memoryPeakBytes: 8192,
      memoryMaxBytes: null,
      memoryMaxUnlimited: 1,
      pidsCurrent: 21,
      pidsMax: 256,
      memoryEvents: { oom_kill: 1 },
    });
    expect(value.processCount).toBe(21);
    expect(value.readableProcessCount).toBe(21);
    expect(value.topRss).toHaveLength(20);
    expect(value.topRss[0]).toEqual({
      pid: 21,
      ppid: 0,
      threads: 2,
      rssKiB: 2100,
      virtualKiB: 9000,
      state: 2,
    });
    expect(value.topRss.at(-1)?.pid).toBe(2);
    expect(JSON.stringify(value)).not.toMatch(
      /private|credential|command-line|environment|secret|owned|pollingpops-browser-diagnostics/,
    );
  });

  it("reports unavailable data without falling back outside the provided proc/cgroup roots", async () => {
    const root = await fixture();
    await put(root, "proc/self/cgroup", "0::/../../outside\n");
    const value = await collectBrowserResources({
      procRoot: join(root, "proc"),
      cgroupRoot: join(root, "cgroup"),
    });
    expect(value.available).toEqual({
      memory: 0,
      memoryPressure: 0,
      cpuPressure: 0,
      cgroup: 0,
      processes: 0,
    });
    expect(value.cgroup).toEqual({});
    expect(value.topRss).toEqual([]);
  });

  it("caps samples, prevents overlapping reads, preserves failures, and clears its timer/handlers", async () => {
    const root = await fixture();
    const output = join(root, "resources.jsonl");
    const release = join(root, "second-sample-complete");
    const source = `
      const fs = require('node:fs');
      const fallback = setTimeout(() => process.exit(91), 4000);
      const poll = setInterval(() => {
        if (!fs.existsSync(${JSON.stringify(release)})) return;
        clearTimeout(fallback);
        clearInterval(poll);
        process.exit(23);
      }, 5);
    `;
    let active = 0;
    let peakActive = 0;
    let calls = 0;
    const listeners = process.listenerCount("SIGTERM");
    const lines: string[] = [];
    const result = await runBrowserDiagnostics(process.execPath, ["-e", source], output, {
      intervalMs: 1,
      maxSamples: 2,
      maxBytes: 1024,
      log: (line: string) => {
        lines.push(line);
        const record = JSON.parse(line.slice("[browser-resources] ".length));
        // Release only after the second collector has returned, independent of scheduling speed.
        if (record.event === "sample" && record.sample === 2) writeFileSync(release, "ready");
      },
      collect: async () => {
        calls += 1;
        active += 1;
        peakActive = Math.max(peakActive, active);
        await delay(3);
        active -= 1;
        return { memoryKiB: { MemAvailable: 64 } };
      },
    });
    expect(result).toEqual({ code: 23, signal: null });
    expect(calls).toBe(2);
    expect(peakActive).toBe(1);
    expect(process.listenerCount("SIGTERM")).toBe(listeners);
    await delay(10);
    expect(calls).toBe(2);
    const bytes = await readFile(output);
    expect(bytes.length).toBeLessThanOrEqual(1024);
    const records = bytes
      .toString()
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(records.map((record) => record.event)).toEqual(["sample", "sample", "finish"]);
    expect(records.at(-1)).toMatchObject({ code: 23, signal: 0, samples: 2 });
    expect(lines).toHaveLength(3);
  });

  it("bounds emitted bytes even when a sample exceeds the remaining artifact budget", async () => {
    const root = await fixture();
    const output = join(root, "resources.jsonl");
    const lines: string[] = [];
    const result = await runBrowserDiagnostics(
      process.execPath,
      ["-e", "process.exit(0)"],
      output,
      {
        maxBytes: 256,
        log: (line: string) => lines.push(line),
        collect: async () => ({ values: Array(1000).fill(123) }),
      },
    );
    expect(result).toEqual({ code: 0, signal: null });
    expect((await readFile(output)).length).toBeLessThanOrEqual(256);
    expect(lines.join("").length).toBeLessThan(300);
  });

  it("preserves the exact CLI child exit code and child termination signal", async () => {
    const root = await fixture();
    for (const [source, expected] of [
      ["process.exit(17)", { code: 17, signal: null }],
      ["process.kill(process.pid, 'SIGTERM')", { code: null, signal: "SIGTERM" }],
    ] as const) {
      const child = spawn(
        process.execPath,
        [script, "--output", join(root, "resources.jsonl"), "--", process.execPath, "-e", source],
        { stdio: "ignore" },
      );
      expect(await childResult(child)).toEqual(expected);
    }
  });

  it("forwards cancellation to its own command group and preserves cancellation after graceful child exit", async () => {
    const root = await fixture();
    const marker = join(root, "received-signal");
    const source = `const fs = require('node:fs'); process.on('SIGTERM', () => { fs.writeFileSync(${JSON.stringify(marker)}, 'received'); process.exit(0); }); console.log('READY:' + process.pid); setInterval(() => {}, 1000);`;
    const child = spawn(
      process.execPath,
      [script, "--output", join(root, "resources.jsonl"), "--", process.execPath, "-e", source],
      { stdio: ["ignore", "pipe", "ignore"] },
    );
    const closed = childResult(child);
    let commandPid = 0;
    try {
      await new Promise<void>((done) => {
        let buffered = "";
        child.stdout!.on("data", (chunk) => {
          buffered += chunk.toString();
          const match = buffered.match(/READY:(\d+)/);
          if (match) {
            commandPid = Number(match[1]);
            done();
          }
        });
      });
      child.kill("SIGTERM");
      expect(await closed).toEqual({ code: null, signal: "SIGTERM" });
      expect(await readFile(marker, "utf8")).toBe("received");
      expect(() => process.kill(commandPid, 0)).toThrow();
    } finally {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      if (commandPid) {
        try {
          process.kill(-commandPid, "SIGKILL");
        } catch {
          /* The owned command already exited. */
        }
      }
    }
  });
});
