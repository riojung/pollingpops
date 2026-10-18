import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { databaseSnapshot, withExportedDatabaseSnapshot } from "./backup-restore-support.js";

const runFile = promisify(execFile);
const compose = ["compose", "-f", "compose.yaml", "-f", "compose.media.yaml"];

async function composeExec(service: string, args: string[]) {
  // Stop PostgreSQL clients inside the container before the host Docker CLI deadline. Killing
  // only that CLI can leave pg_dump writing while the outer finally block removes its dump.
  const boundedArgs = service === "postgres" ? ["timeout", "-s", "KILL", "110", ...args] : args;
  return runFile("docker", [...compose, "exec", "-T", service, ...boundedArgs], {
    cwd: process.cwd(),
    timeout: 120_000,
    maxBuffer: 8 * 1024 * 1024,
  });
}

function composeExecWithInput(service: string, args: string[], input: Buffer) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn("docker", [...compose, "exec", "-T", service, ...args], {
      cwd: process.cwd(),
      stdio: ["pipe", "pipe", "pipe"],
    });
    const errors: Buffer[] = [];
    child.stdout.resume();
    child.stderr.on("data", (chunk: Buffer) => errors.push(chunk));
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(Buffer.concat(errors).toString("utf8") || `Command exited ${code}`));
    });
    child.stdin.end(input);
  });
}

function queryDatabase(database: string) {
  return async (sql: string) => {
    const { stdout } = await composeExec("postgres", [
      "psql",
      "-U",
      "openround",
      "-d",
      database,
      "-XqAt",
      "--set=ON_ERROR_STOP=1",
      "-c",
      sql,
    ]);
    return stdout;
  };
}

async function main() {
  const suffix = randomUUID().replaceAll("-", "").slice(0, 16);
  const restoredDatabase = `openround_restore_${suffix}`;
  const dumpPath = `/tmp/${restoredDatabase}.dump`;
  const objectKey = `restore-drill/${suffix}.txt`;
  const backupObjectKey = `restore-drill-backup/${suffix}.txt`;
  const objectPayload = Buffer.from(`Polling Pops restore drill ${suffix}\n`, "utf8");
  const startedAt = performance.now();
  let databaseCreated = false;
  let storageAliasCreated = false;

  try {
    const sourceSnapshot = await withExportedDatabaseSnapshot(
      spawn(
        "docker",
        [
          ...compose,
          "exec",
          "-T",
          "postgres",
          // Outlive the 120s snapshot deadline plus draining one bounded 110s command.
          "timeout",
          "-s",
          "KILL",
          "250",
          "psql",
          "-U",
          "openround",
          "-d",
          "openround",
          "-XqAt",
          "--set=ON_ERROR_STOP=1",
        ],
        { cwd: process.cwd(), stdio: ["pipe", "pipe", "pipe"] },
      ),
      async (snapshot, signal) => {
        // Background workers keep writing (including heartbeats). Inventory and pg_dump must
        // import the same frozen source view rather than comparing different points in time.
        const inventory = await databaseSnapshot(queryDatabase("openround"), snapshot, signal);
        assert.ok(inventory.tables.length > 0, "Source database has no durable public tables");
        signal.throwIfAborted();
        await composeExec("postgres", [
          "pg_dump",
          "-U",
          "openround",
          "-d",
          "openround",
          "--snapshot",
          snapshot,
          "--format=custom",
          "--no-owner",
          "--no-privileges",
          "--file",
          dumpPath,
        ]);
        signal.throwIfAborted();
        return inventory;
      },
    );
    const dumpBytes = Number(
      (await composeExec("postgres", ["stat", "-c", "%s", dumpPath])).stdout.trim(),
    );
    assert.ok(dumpBytes > 0, "PostgreSQL produced an empty backup");

    await composeExec("postgres", ["createdb", "-U", "openround", restoredDatabase]);
    databaseCreated = true;
    await composeExec("postgres", [
      "pg_restore",
      "-U",
      "openround",
      "-d",
      restoredDatabase,
      "--no-owner",
      "--no-privileges",
      dumpPath,
    ]);
    const restoredSnapshot = await databaseSnapshot(queryDatabase(restoredDatabase));
    assert.deepEqual(
      restoredSnapshot.tables,
      sourceSnapshot.tables,
      "Restored durable public table set does not match the source",
    );
    assert.deepEqual(
      restoredSnapshot.rowFingerprints,
      sourceSnapshot.rowFingerprints,
      "Restored durable public table rows do not match the source",
    );

    await composeExec("minio", [
      "mc",
      "alias",
      "set",
      "restore-drill",
      "http://127.0.0.1:9000",
      "openround",
      "change-this-local-secret",
    ]);
    storageAliasCreated = true;
    await composeExecWithInput(
      "minio",
      ["mc", "pipe", `restore-drill/openround-media/${objectKey}`],
      objectPayload,
    );
    await composeExec("minio", [
      "mc",
      "cp",
      `restore-drill/openround-media/${objectKey}`,
      `restore-drill/openround-media/${backupObjectKey}`,
    ]);
    await composeExec("minio", [
      "mc",
      "rm",
      "--force",
      `restore-drill/openround-media/${objectKey}`,
    ]);
    await assert.rejects(
      composeExec("minio", ["mc", "stat", `restore-drill/openround-media/${objectKey}`]),
    );
    await composeExec("minio", [
      "mc",
      "cp",
      `restore-drill/openround-media/${backupObjectKey}`,
      `restore-drill/openround-media/${objectKey}`,
    ]);
    const restoredObject = await composeExec("minio", [
      "mc",
      "cat",
      `restore-drill/openround-media/${objectKey}`,
    ]);
    assert.deepEqual(Buffer.from(restoredObject.stdout), objectPayload);

    process.stdout.write(
      `${JSON.stringify(
        {
          databaseTables: sourceSnapshot.tables.length,
          dumpBytes,
          databaseTableSetMatch: true,
          databaseFingerprintMatch: true,
          objectBytes: objectPayload.byteLength,
          objectRoundTripMatch: true,
          elapsedMs: performance.now() - startedAt,
        },
        null,
        2,
      )}\n`,
    );
  } finally {
    if (storageAliasCreated) {
      await composeExec("minio", [
        "mc",
        "rm",
        "--force",
        `restore-drill/openround-media/${objectKey}`,
        `restore-drill/openround-media/${backupObjectKey}`,
      ]).catch(() => undefined);
      await composeExec("minio", ["mc", "alias", "remove", "restore-drill"]).catch(() => undefined);
    }
    if (databaseCreated) {
      await composeExec("postgres", [
        "dropdb",
        "-U",
        "openround",
        "--if-exists",
        "--force",
        restoredDatabase,
      ]).catch(() => undefined);
    }
    await composeExec("postgres", ["rm", "-f", dumpPath]).catch(() => undefined);
  }
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
