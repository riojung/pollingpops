ALTER TABLE workspaces
  ADD COLUMN idle_timeout_minutes integer NOT NULL DEFAULT 5
  CHECK (idle_timeout_minutes BETWEEN 1 AND 240);

-- Existing logins receive a full initial inactivity window on rollout.
ALTER TABLE creator_sessions
  ADD COLUMN last_activity_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN idle_timeout_minutes integer NOT NULL DEFAULT 5
    CHECK (idle_timeout_minutes BETWEEN 1 AND 240),
  ADD COLUMN idle_expires_at timestamptz NOT NULL DEFAULT (now() + interval '6 minutes');

-- Migration owners also obey forced RLS. Limit the backfill's system access to
-- this migration transaction, matching the existing verified-email backfill.
SELECT set_config('app.system_access', 'on', true);
UPDATE creator_sessions cs SET active_workspace_id = (
  SELECT wm.workspace_id FROM workspace_members wm
  JOIN workspaces w ON w.id = wm.workspace_id
  WHERE wm.user_id = cs.user_id ORDER BY w.created_at, w.id LIMIT 1
) WHERE cs.active_workspace_id IS NULL;

CREATE INDEX creator_sessions_active_workspace_idle_idx
  ON creator_sessions (active_workspace_id, idle_expires_at)
  WHERE revoked_at IS NULL;
