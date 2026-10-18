import { Pool } from "pg";

function identifier(value: string) {
  return `"${value.replaceAll('"', '""')}"`;
}

/** Use the shared cluster admin URL, not a suite's isolated database URL. */
export async function preparePostgresTestRuntime(adminUrl: string, runtimeUrl: string) {
  const runtime = new URL(runtimeUrl);
  const login = decodeURIComponent(runtime.username);
  const password = decodeURIComponent(runtime.password);
  if (!login || !password || login === "openround_runtime") {
    throw new Error("PostgreSQL tests require a separate password-authenticated runtime login");
  }

  const pool = new Pool({ connectionString: adminUrl });
  try {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      // Roles are cluster-wide, while advisory locks are database-scoped. Both suites must
      // acquire this lock through the same original TEST_DATABASE_ADMIN_URL database.
      await client.query("SELECT pg_advisory_xact_lock(73501, 90001)");
      const roles = await client.query<{ rolname: string }>(
        "SELECT rolname FROM pg_roles WHERE rolname = ANY($1::text[])",
        [["openround_runtime", login]],
      );
      if (!roles.rows.some((role) => role.rolname === "openround_runtime")) {
        await client.query("CREATE ROLE openround_runtime NOLOGIN");
      }
      if (!roles.rows.some((role) => role.rolname === login)) {
        await client.query(
          `CREATE ROLE ${identifier(login)} LOGIN PASSWORD '${password.replaceAll("'", "''")}'
           NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB NOREPLICATION`,
        );
      }
      await client.query(`GRANT openround_runtime TO ${identifier(login)}`);
      const database = await client.query<{ current_database: string }>(
        "SELECT current_database()",
      );
      await client.query(
        `GRANT CONNECT ON DATABASE ${identifier(database.rows[0]!.current_database)} TO ${identifier(login)}`,
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
}
