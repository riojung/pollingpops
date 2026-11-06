import type { PoolClient } from "pg";

/** Lock only the named principals; identity rows have system-only RLS, unlike deck rows. */
export async function lockPresentationAssistanceActors(client: PoolClient, actorIds: string[]) {
  const previous = (
    await client.query<{ access: string | null }>(
      "SELECT current_setting('app.system_access',true) AS access",
    )
  ).rows[0]?.access;
  const lock = () =>
    client.query<{ id: string }>(
      "SELECT id FROM users WHERE id=ANY($1::uuid[]) AND deleted_at IS NULL ORDER BY id FOR SHARE",
      [[...new Set(actorIds.map((id) => id.toLowerCase()))].sort()],
    );
  if (previous === "on") return lock();
  // The savepoint also restores the LOCAL setting if a failed identity query aborts its SQL scope.
  await client.query("SAVEPOINT presentation_assistance_identity");
  try {
    await client.query("SELECT set_config('app.system_access','on',true)");
    const result = await lock();
    await client.query("SELECT set_config('app.system_access',$1,true)", [previous ?? ""]);
    await client.query("RELEASE SAVEPOINT presentation_assistance_identity");
    return result;
  } catch (error) {
    await client.query("ROLLBACK TO SAVEPOINT presentation_assistance_identity");
    await client.query("RELEASE SAVEPOINT presentation_assistance_identity");
    throw error;
  }
}
