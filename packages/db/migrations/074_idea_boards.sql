-- Standalone, bounded brainstorming aggregates. Credentials and ballots remain private JSON.
CREATE TABLE IF NOT EXISTS idea_boards (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  creation_key uuid NOT NULL,
  retention_expires_at timestamptz NOT NULL,
  data jsonb NOT NULL CHECK (data->>'schemaVersion' IS NOT NULL AND data->>'schemaVersion' = '1'),
  UNIQUE(workspace_id, creation_key),
  CHECK (data->>'id' = id::text AND data->>'workspaceId' = workspace_id::text),
  CHECK (octet_length(data::text) <= 1048576),
  CHECK (jsonb_array_length(data->'ideas') <= 200 AND jsonb_array_length(data->'groups') <= 20 AND jsonb_array_length(data->'guests') <= 250 AND jsonb_array_length(data->'receipts') <= 5000)
);
CREATE OR REPLACE FUNCTION preserve_idea_board_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.workspace_id <> OLD.workspace_id OR NEW.creation_key <> OLD.creation_key OR NEW.retention_expires_at <> OLD.retention_expires_at
    OR NEW.data->'identityMode' IS DISTINCT FROM OLD.data->'identityMode'
    OR NEW.data->'closesAt' IS DISTINCT FROM OLD.data->'closesAt'
    OR NEW.data->'expiresAt' IS DISTINCT FROM OLD.data->'expiresAt'
    OR NEW.data->'participantLimit' IS DISTINCT FROM OLD.data->'participantLimit'
    OR NEW.data->'voteBudget' IS DISTINCT FROM OLD.data->'voteBudget'
    OR NEW.data->'moderationEnabled' IS DISTINCT FROM OLD.data->'moderationEnabled' THEN
    RAISE EXCEPTION 'Idea board identity, limits and deadlines are immutable' USING ERRCODE = '23514';
  END IF;
  IF OLD.data->>'status' = 'closed' AND NEW.data IS DISTINCT FROM OLD.data THEN
    RAISE EXCEPTION 'Closed idea boards are immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS idea_board_identity_immutable ON idea_boards;
CREATE TRIGGER idea_board_identity_immutable BEFORE UPDATE ON idea_boards
  FOR EACH ROW EXECUTE FUNCTION preserve_idea_board_identity();
CREATE INDEX IF NOT EXISTS idea_boards_workspace_idx ON idea_boards(workspace_id,id);
CREATE INDEX IF NOT EXISTS idea_boards_retention_idx ON idea_boards(retention_expires_at);
ALTER TABLE idea_boards ENABLE ROW LEVEL SECURITY;
ALTER TABLE idea_boards FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS workspace_isolation ON idea_boards;
CREATE POLICY workspace_isolation ON idea_boards
  USING (current_setting('app.system_access',true)='on' OR workspace_id::text=nullif(current_setting('app.workspace_id',true),''))
  WITH CHECK (current_setting('app.system_access',true)='on' OR workspace_id::text=nullif(current_setting('app.workspace_id',true),''));
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='openround_runtime') THEN
    GRANT SELECT,INSERT,UPDATE,DELETE ON idea_boards TO openround_runtime;
  END IF;
END $$;
