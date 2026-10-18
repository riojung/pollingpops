import type { ChildProcessWithoutNullStreams } from "node:child_process";

export interface DatabaseSnapshot {
  tables: string[];
  rowFingerprints: Record<string, string>;
}

function validateSnapshotId(snapshot: string) {
  if (!/^[0-9a-f]+-[0-9a-f]+-\d+$/i.test(snapshot)) {
    throw new Error("PostgreSQL returned an invalid exported snapshot ID");
  }
  return snapshot;
}

/**
 * Keep the exporter open until readers finish. The callback checks cancellation between bounded
 * commands and awaits their cleanup; cancelling a host Docker client does not stop its remote work.
 */
export async function withExportedDatabaseSnapshot<T>(
  session: ChildProcessWithoutNullStreams,
  useSnapshot: (snapshot: string, signal: AbortSignal) => Promise<T>,
  timeoutMs = 120_000,
): Promise<T> {
  const cancellation = new AbortController();
  let closing = false;
  let stderr = "";
  let output = "";
  let rejectFailure!: (error: Error) => void;
  let resolveSnapshot!: (snapshot: string) => void;
  const failure = new Promise<never>((_resolve, reject) => (rejectFailure = reject));
  const fail = (error: Error) => {
    if (cancellation.signal.aborted) return;
    cancellation.abort(error);
    rejectFailure(error);
  };
  const snapshot = new Promise<string>((resolve) => (resolveSnapshot = resolve));
  const exited = new Promise<number | null>((resolve) => {
    session.once("close", (code) => {
      if (!closing) {
        fail(new Error(stderr || "PostgreSQL snapshot exporter exited unexpectedly"));
      }
      resolve(code);
    });
  });
  session.once("error", fail);
  session.stdin.on("error", (error) => {
    if (!closing) fail(error);
  });
  session.stderr.on("data", (chunk: Buffer) => {
    stderr = (stderr + chunk.toString("utf8")).slice(-8192);
  });
  session.stdout.on("data", (chunk: Buffer) => {
    output += chunk.toString("utf8");
    if (output.length > 1024) {
      fail(new Error("PostgreSQL returned an invalid exported snapshot ID"));
      return;
    }
    if (output.includes("\n")) {
      try {
        resolveSnapshot(validateSnapshotId(output.trim()));
      } catch (error) {
        fail(error as Error);
      }
    }
  });
  const timer = setTimeout(
    () => fail(new Error("PostgreSQL snapshot operation timed out")),
    timeoutMs,
  );
  let result: T;
  let exitCode: number | null;
  let operation: Promise<T> | undefined;
  try {
    session.stdin.write(
      "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;\nSELECT pg_export_snapshot();\n",
    );
    const snapshotId = await Promise.race([snapshot, failure]);
    operation = Promise.resolve().then(() => {
      cancellation.signal.throwIfAborted();
      return useSnapshot(snapshotId, cancellation.signal);
    });
    result = await Promise.race([operation, failure]);
  } catch (error) {
    const originalError = cancellation.signal.aborted ? cancellation.signal.reason : error;
    if (!cancellation.signal.aborted) cancellation.abort(error);
    // Stopping a host `docker exec` client can leave its command running in the container.
    // Readers stop cooperatively between bounded commands. Drain the active command before
    // releasing the exported snapshot or letting the caller delete its backup artifacts.
    await operation?.catch(() => undefined);
    throw originalError;
  } finally {
    closing = true;
    clearTimeout(timer);
    session.stdin.end("ROLLBACK;\n");
    const cleanupTimer = setTimeout(() => session.kill("SIGTERM"), 5_000);
    exitCode = await exited;
    clearTimeout(cleanupTimer);
  }
  if (exitCode !== 0) {
    throw new Error(stderr || "PostgreSQL snapshot exporter failed to close cleanly");
  }
  return result;
}

export async function databaseSnapshot(
  query: (sql: string) => Promise<string>,
  snapshot?: string,
  signal?: AbortSignal,
): Promise<DatabaseSnapshot> {
  const read = async (sql: string) => {
    signal?.throwIfAborted();
    const output = await query(
      snapshot
        ? `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
           SET TRANSACTION SNAPSHOT '${validateSnapshotId(snapshot)}';
           ${sql};
           COMMIT;`
        : sql,
    );
    signal?.throwIfAborted();
    return output;
  };
  // Views, temporary tables, and unlogged relations are not durable backup targets.
  const tables = parseDatabaseTableNames(
    (
      await read(`
        SELECT COALESCE(json_agg(relation.relname ORDER BY relation.relname), '[]'::json)::text
        FROM pg_catalog.pg_class AS relation
        JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
        WHERE namespace.nspname = 'public'
          AND relation.relkind = 'r'
          AND relation.relpersistence = 'p'
      `)
    ).trim(),
  );
  const rowFingerprints = createDatabaseTableFingerprints();
  for (const table of tables) {
    const qualifiedTable = `${quotePostgresIdentifier("public")}.${quotePostgresIdentifier(table)}`;
    rowFingerprints[table] = (
      await read(`
        SELECT count(*)::text || ':' ||
          md5(COALESCE(string_agg(row_hash, '' ORDER BY row_hash), ''))
        FROM (
          SELECT md5(to_jsonb(row_data)::text) AS row_hash
          FROM ${qualifiedTable} AS row_data
        ) AS row_hashes
      `)
    ).trim();
  }
  return { tables, rowFingerprints };
}

export function parseDatabaseTableNames(value: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch (error) {
    throw new Error("PostgreSQL returned an invalid durable-table list", { cause: error });
  }

  if (
    !Array.isArray(parsed) ||
    parsed.some((table) => typeof table !== "string" || table.length === 0)
  ) {
    throw new Error("PostgreSQL returned an invalid durable-table list");
  }

  const tables = parsed as string[];
  if (new Set(tables).size !== tables.length) {
    throw new Error("PostgreSQL returned duplicate durable-table names");
  }
  return tables;
}

export function quotePostgresIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

export function createDatabaseTableFingerprints(): Record<string, string> {
  return Object.create(null) as Record<string, string>;
}
