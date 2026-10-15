-- One immutable aggregate projection per completed source, independent revocable capabilities.
CREATE TABLE IF NOT EXISTS session_summary_snapshots (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  source_kind text NOT NULL CHECK (source_kind IN ('round', 'presentation', 'survey')),
  round_session_id uuid,
  presentation_session_id uuid,
  survey_room_id uuid,
  created_by uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  schema_version smallint NOT NULL DEFAULT 1 CHECK (schema_version = 1),
  summary jsonb NOT NULL CHECK (coalesce(
    summary->>'schemaVersion' = '1' AND summary->>'kind' = source_kind
    AND summary->>'nextSteps' = ''
  , false)),
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL CHECK (expires_at > created_at),
  UNIQUE (workspace_id, id),
  UNIQUE (workspace_id, round_session_id),
  UNIQUE (workspace_id, presentation_session_id),
  UNIQUE (workspace_id, survey_room_id),
  CHECK (
    (source_kind = 'round' AND round_session_id IS NOT NULL
      AND presentation_session_id IS NULL AND survey_room_id IS NULL)
    OR (source_kind = 'presentation' AND presentation_session_id IS NOT NULL
      AND round_session_id IS NULL AND survey_room_id IS NULL)
    OR (source_kind = 'survey' AND survey_room_id IS NOT NULL
      AND round_session_id IS NULL AND presentation_session_id IS NULL)
  ),
  FOREIGN KEY (workspace_id, round_session_id)
    REFERENCES game_sessions(workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, presentation_session_id)
    REFERENCES presentation_live_sessions(workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, survey_room_id)
    REFERENCES survey_feedback_rooms(workspace_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS session_summary_shares (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  snapshot_id uuid NOT NULL,
  actor_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  idempotency_key uuid NOT NULL,
  intent_hash text NOT NULL CHECK (intent_hash ~ '^[a-f0-9]{64}$'),
  token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[a-f0-9]{64}$'),
  allow_downloads boolean NOT NULL,
  next_steps text NOT NULL CHECK (char_length(next_steps) <= 2000),
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL CHECK (expires_at > created_at),
  revoked_at timestamptz,
  UNIQUE (workspace_id, actor_id, idempotency_key),
  FOREIGN KEY (workspace_id, snapshot_id)
    REFERENCES session_summary_snapshots(workspace_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS session_summary_shares_source_idx
  ON session_summary_shares (workspace_id, snapshot_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS session_summary_snapshots_expiry_idx ON session_summary_snapshots (expires_at);

CREATE OR REPLACE FUNCTION preserve_session_summary_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Session summary snapshots are immutable';
END $$;
DROP TRIGGER IF EXISTS session_summary_snapshot_immutable ON session_summary_snapshots;
CREATE TRIGGER session_summary_snapshot_immutable BEFORE UPDATE ON session_summary_snapshots
  FOR EACH ROW EXECUTE FUNCTION preserve_session_summary_snapshot();

CREATE OR REPLACE FUNCTION preserve_session_summary_share() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (to_jsonb(NEW) - 'revoked_at') IS DISTINCT FROM (to_jsonb(OLD) - 'revoked_at')
    OR (OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS DISTINCT FROM OLD.revoked_at) THEN
    RAISE EXCEPTION 'Session summary capabilities may only be revoked';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS session_summary_share_immutable ON session_summary_shares;
CREATE TRIGGER session_summary_share_immutable BEFORE UPDATE ON session_summary_shares
  FOR EACH ROW EXECUTE FUNCTION preserve_session_summary_share();

DO $$ DECLARE table_name text; BEGIN
  FOREACH table_name IN ARRAY ARRAY['session_summary_snapshots', 'session_summary_shares'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format('DROP POLICY IF EXISTS workspace_isolation ON %I', table_name);
    EXECUTE format('CREATE POLICY workspace_isolation ON %I USING (current_setting(''app.system_access'', true) = ''on'' OR workspace_id::text = nullif(current_setting(''app.workspace_id'', true), '''')) WITH CHECK (current_setting(''app.system_access'', true) = ''on'' OR workspace_id::text = nullif(current_setting(''app.workspace_id'', true), ''''))', table_name);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'openround_runtime') THEN
      EXECUTE format('GRANT SELECT, INSERT, DELETE ON %I TO openround_runtime', table_name);
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'openround_runtime') THEN
    -- The baseline grants UPDATE through default privileges and may be replayed at bootstrap.
    REVOKE UPDATE ON session_summary_snapshots, session_summary_shares FROM openround_runtime;
    -- SELECT FOR SHARE requires UPDATE on a column; the immutable trigger rejects actual writes.
    GRANT UPDATE (id) ON session_summary_snapshots TO openround_runtime;
    GRANT UPDATE (revoked_at) ON session_summary_shares TO openround_runtime;
  END IF;
END $$;
