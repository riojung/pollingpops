import { execFile, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it, vi } from "vitest";
import {
  createDatabaseTableFingerprints,
  databaseSnapshot,
  parseDatabaseTableNames,
  quotePostgresIdentifier,
  withExportedDatabaseSnapshot,
} from "../smoke/backup-restore-support.js";

const runFile = promisify(execFile);

function waitForCancellation(signal: AbortSignal) {
  if (signal.aborted) return Promise.resolve();
  return new Promise<void>((resolve) =>
    signal.addEventListener("abort", () => resolve(), { once: true }),
  );
}

function snapshotSession(output = "00000003-0000001B-1", exitEarly = false) {
  return spawn(
    process.execPath,
    [
      "--eval",
      `
        let input = "";
        let exported = false;
        process.stdin.on("data", (chunk) => {
          input += chunk;
          if (!exported && input.includes("pg_export_snapshot()")) {
            exported = true;
            process.stdout.write(${JSON.stringify(output)} + "\\n");
            if (${exitEarly}) process.exit(0);
          }
          if (input.includes("ROLLBACK;")) process.exit(0);
        });
      `,
    ],
    { stdio: ["pipe", "pipe", "pipe"] },
  );
}

describe("backup and restore table discovery", () => {
  it("parses the catalog table list without dropping newly added tables", () => {
    expect(parseDatabaseTableNames('["_openround_migrations","answers","new_table"]')).toEqual([
      "_openround_migrations",
      "answers",
      "new_table",
    ]);
  });

  it("rejects malformed or duplicate catalog output", () => {
    expect(() => parseDatabaseTableNames("not-json")).toThrow(
      "PostgreSQL returned an invalid durable-table list",
    );
    expect(() => parseDatabaseTableNames('["answers",null]')).toThrow(
      "PostgreSQL returned an invalid durable-table list",
    );
    expect(() => parseDatabaseTableNames('["answers","answers"]')).toThrow(
      "PostgreSQL returned duplicate durable-table names",
    );
  });

  it("quotes catalog identifiers before interpolating them into fingerprint queries", () => {
    expect(quotePostgresIdentifier("answers")).toBe('"answers"');
    expect(quotePostgresIdentifier('answers"; DROP TABLE users; --')).toBe(
      '"answers""; DROP TABLE users; --"',
    );
  });

  it("preserves fingerprints for table names that are inherited object properties", () => {
    const fingerprints = createDatabaseTableFingerprints();

    fingerprints.__proto__ = "1:prototype-fingerprint";
    fingerprints.constructor = "2:constructor-fingerprint";

    expect(Object.getPrototypeOf(fingerprints)).toBeNull();
    expect(Object.hasOwn(fingerprints, "__proto__")).toBe(true);
    expect(fingerprints.__proto__).toBe("1:prototype-fingerprint");
    expect(fingerprints.constructor).toBe("2:constructor-fingerprint");
  });
});

describe("exported backup snapshots", () => {
  it("imports the same read-only snapshot for catalog discovery and every full-row hash", async () => {
    const statements: string[] = [];
    const snapshot = "00000003-0000001B-1";
    const inventory = await databaseSnapshot(async (sql) => {
      statements.push(sql);
      return sql.includes("pg_catalog.pg_class") ? '["answers","platform_records"]' : "1:hash";
    }, snapshot);
    expect(inventory.tables).toEqual(["answers", "platform_records"]);
    expect(statements).toHaveLength(3);
    for (const sql of statements) {
      expect(sql).toContain("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;");
      expect(sql).toContain(`SET TRANSACTION SNAPSHOT '${snapshot}';`);
      expect(sql).toContain("COMMIT;");
    }
    expect(statements[1]).toContain("to_jsonb(row_data)::text");
    expect(statements[2]).toContain('FROM "public"."platform_records"');
  });

  it("rejects unsafe snapshot IDs before issuing a database query", async () => {
    let reads = 0;
    await expect(
      databaseSnapshot(async () => {
        reads += 1;
        return "[]";
      }, "snapshot'; COMMIT; --"),
    ).rejects.toThrow("invalid exported snapshot ID");
    expect(reads).toBe(0);
  });

  it("lets an active query settle after cancellation and stops subsequent table reads", async () => {
    const cancellation = new AbortController();
    const originalError = new Error("snapshot expired");
    let finishQuery!: () => void;
    const queryFinished = new Promise<void>((resolve) => (finishQuery = resolve));
    const queries: string[] = [];
    let queryStarted!: () => void;
    const started = new Promise<void>((resolve) => (queryStarted = resolve));
    const inventory = databaseSnapshot(
      async (sql) => {
        queries.push(sql);
        queryStarted();
        await queryFinished;
        return '["answers","platform_records"]';
      },
      "00000003-0000001B-1",
      cancellation.signal,
    );
    await started;
    cancellation.abort(originalError);
    finishQuery();
    await expect(inventory).rejects.toBe(originalError);
    expect(queries).toHaveLength(1);
  });

  it("holds the exporter open until its reader finishes and closes it afterward", async () => {
    const session = snapshotSession();
    await expect(
      withExportedDatabaseSnapshot(session, async (snapshot) => {
        expect(snapshot).toBe("00000003-0000001B-1");
        expect(session.exitCode).toBeNull();
        return "inventory and dump complete";
      }),
    ).resolves.toBe("inventory and dump complete");
    expect(session.exitCode).toBe(0);
  });

  it("closes the exporting transaction when an inventory or dump fails", async () => {
    const session = snapshotSession();
    await expect(
      withExportedDatabaseSnapshot(session, async () => {
        throw new Error("dump failed");
      }),
    ).rejects.toThrow("dump failed");
    expect(session.exitCode).toBe(0);
  });

  it("rejects malformed snapshot output before invoking a reader", async () => {
    let reads = 0;
    await expect(
      withExportedDatabaseSnapshot(snapshotSession("not a snapshot"), async () => {
        reads += 1;
      }),
    ).rejects.toThrow("invalid exported snapshot ID");
    expect(reads).toBe(0);
  });

  it("fails if the snapshot exporter exits while a reader is running", async () => {
    await expect(
      withExportedDatabaseSnapshot(snapshotSession(undefined, true), (_snapshot, signal) =>
        waitForCancellation(signal),
      ),
    ).rejects.toThrow("snapshot exporter exited unexpectedly");
  });

  it("rejects a reader that outlives the snapshot deadline and closes the exporter", async () => {
    const session = snapshotSession();
    await expect(
      withExportedDatabaseSnapshot(
        session,
        (_snapshot, signal) => waitForCancellation(signal),
        250,
      ),
    ).rejects.toThrow("snapshot operation timed out");
    expect(session.exitCode).toBe(0);
  });

  it("waits for an in-flight reader and its cleanup before rolling back or rejecting a timeout", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const events: string[] = [];
    const session = snapshotSession();
    let startReader!: () => void;
    const started = new Promise<void>((resolve) => (startReader = resolve));
    let signalCancellation!: () => void;
    const cancelled = new Promise<void>((resolve) => (signalCancellation = resolve));
    let finishReader!: () => void;
    const readerFinished = new Promise<void>((resolve) => (finishReader = resolve));
    const outcome = withExportedDatabaseSnapshot(
      session,
      async (_snapshot, signal) => {
        events.push("reader started");
        signal.addEventListener(
          "abort",
          () => {
            events.push("reader cancelled");
            signalCancellation();
          },
          { once: true },
        );
        startReader();
        await readerFinished;
        events.push("reader cleanup complete");
        // A late reader failure must not replace the timeout that caused cancellation.
        throw new Error("late reader error");
      },
      1000,
    ).catch((error: Error) => {
      events.push("helper rejected");
      return error;
    });
    try {
      await started;
      await vi.advanceTimersByTimeAsync(1000);
      await cancelled;
      expect(events).toEqual(["reader started", "reader cancelled"]);
      expect(session.exitCode).toBeNull();
      finishReader();
      expect(await outcome).toHaveProperty("message", "PostgreSQL snapshot operation timed out");
      expect(events).toEqual([
        "reader started",
        "reader cancelled",
        "reader cleanup complete",
        "helper rejected",
      ]);
      expect(session.exitCode).toBe(0);
    } finally {
      finishReader();
      await outcome;
      vi.useRealTimers();
    }
  });
});

const databaseUrl = process.env.BACKUP_RESTORE_TEST_DATABASE_URL;
describe.skipIf(!databaseUrl)("PostgreSQL backup snapshot consistency", () => {
  it("restores the full frozen inventory while another connection updates a heartbeat", async () => {
    const connection = new URL(databaseUrl!);
    const env = {
      ...process.env,
      PGHOST: connection.hostname,
      PGPORT: connection.port || "5432",
      PGUSER: decodeURIComponent(connection.username),
      PGPASSWORD: decodeURIComponent(connection.password),
      PGDATABASE: decodeURIComponent(connection.pathname.slice(1)),
      PGSSLMODE: connection.searchParams.get("sslmode") ?? "prefer",
    };
    const psqlArgs = ["-XqAt", "--set=ON_ERROR_STOP=1"];
    const query = (database: string) => async (sql: string) =>
      (
        await runFile("psql", [...psqlArgs, "-c", sql], {
          env: { ...env, PGDATABASE: database },
          timeout: 10_000,
        })
      ).stdout;
    const adminQuery = query(env.PGDATABASE);
    const suffix = randomUUID().replaceAll("-", "");
    const sourceDatabase = `backup_source_${suffix}`;
    const restoredDatabase = `backup_restored_${suffix}`;
    const directory = await mkdtemp(join(tmpdir(), "openround-backup-snapshot-"));
    const dumpPath = join(directory, "source.dump");
    let sourceCreated = false;
    let restoredCreated = false;
    try {
      await adminQuery(`CREATE DATABASE ${quotePostgresIdentifier(sourceDatabase)}`);
      sourceCreated = true;
      await adminQuery(`CREATE DATABASE ${quotePostgresIdentifier(restoredDatabase)}`);
      restoredCreated = true;
      const sourceQuery = query(sourceDatabase);
      await sourceQuery(`
        CREATE TABLE platform_records (
          id text PRIMARY KEY,
          data jsonb NOT NULL,
          updated_at timestamptz NOT NULL DEFAULT now()
        );
        INSERT INTO platform_records(id, data) VALUES ('platform-billing', '{"tick": 1}');
        CREATE TABLE other_durable_rows (id integer PRIMARY KEY, payload text);
        INSERT INTO other_durable_rows VALUES (1, 'preserve every table and full row')
      `);
      const frozen = await withExportedDatabaseSnapshot(
        spawn("psql", psqlArgs, {
          env: { ...env, PGDATABASE: sourceDatabase },
          stdio: ["pipe", "pipe", "pipe"],
        }),
        async (snapshot, signal) => {
          // Commit after export but before either the inventory or dump reads the database.
          await sourceQuery(`
            UPDATE platform_records SET data = '{"tick": 2}', updated_at = now()
            WHERE id = 'platform-billing'
          `);
          const inventory = await databaseSnapshot(sourceQuery, snapshot, signal);
          const live = await databaseSnapshot(sourceQuery, undefined, signal);
          expect(inventory.tables).toEqual(["other_durable_rows", "platform_records"]);
          expect(live.rowFingerprints.platform_records).not.toBe(
            inventory.rowFingerprints.platform_records,
          );
          signal.throwIfAborted();
          await runFile(
            "pg_dump",
            [
              "--format=custom",
              "--no-owner",
              "--no-privileges",
              "--snapshot",
              snapshot,
              "--file",
              dumpPath,
            ],
            { env: { ...env, PGDATABASE: sourceDatabase }, timeout: 10_000 },
          );
          signal.throwIfAborted();
          return inventory;
        },
      );
      await runFile(
        "pg_restore",
        ["--dbname", restoredDatabase, "--no-owner", "--no-privileges", dumpPath],
        { env, timeout: 10_000 },
      );
      expect(await databaseSnapshot(query(restoredDatabase))).toEqual(frozen);
      expect(
        (await query(restoredDatabase)("SELECT data->>'tick' FROM platform_records")).trim(),
      ).toBe("1");
      expect((await sourceQuery("SELECT data->>'tick' FROM platform_records")).trim()).toBe("2");
    } finally {
      if (restoredCreated) {
        await adminQuery(`DROP DATABASE ${quotePostgresIdentifier(restoredDatabase)} WITH (FORCE)`);
      }
      if (sourceCreated) {
        await adminQuery(`DROP DATABASE ${quotePostgresIdentifier(sourceDatabase)} WITH (FORCE)`);
      }
      await rm(directory, { recursive: true, force: true });
    }
  }, 30_000);
});
