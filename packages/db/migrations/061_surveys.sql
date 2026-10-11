-- Dedicated self-paced, organizer-blind surveys. Existing Round schemas are unchanged.
CREATE TABLE IF NOT EXISTS surveys (
  id uuid PRIMARY KEY, workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  data jsonb NOT NULL CHECK ((data->>'schemaVersion')::integer = 1),
  UNIQUE (workspace_id, id)
);
CREATE INDEX IF NOT EXISTS surveys_workspace_idx ON surveys(workspace_id, id);
CREATE TABLE IF NOT EXISTS survey_versions (
  id uuid PRIMARY KEY, workspace_id uuid NOT NULL, survey_id uuid NOT NULL,
  data jsonb NOT NULL CHECK ((data->>'schemaVersion')::integer = 1),
  UNIQUE (workspace_id, survey_id, id),
  FOREIGN KEY (workspace_id, survey_id) REFERENCES surveys(workspace_id, id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS survey_feedback_rooms (
  id uuid PRIMARY KEY, workspace_id uuid NOT NULL, survey_id uuid NOT NULL, version_id uuid NOT NULL,
  code text NOT NULL CHECK (code ~ '^[0-9]{7}$'), closes_at timestamptz NOT NULL,
  retention_expires_at timestamptz NOT NULL CHECK (retention_expires_at >= closes_at),
  data jsonb NOT NULL CHECK ((data->>'schemaVersion')::integer = 1),
  UNIQUE (workspace_id, id),
  FOREIGN KEY (workspace_id, survey_id, version_id) REFERENCES survey_versions(workspace_id, survey_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS survey_feedback_rooms_retention_idx ON survey_feedback_rooms(retention_expires_at);
CREATE TABLE IF NOT EXISTS survey_guests (
  id uuid PRIMARY KEY, workspace_id uuid NOT NULL, room_id uuid NOT NULL,
  data jsonb NOT NULL CHECK ((data->>'schemaVersion')::integer = 1),
  FOREIGN KEY (workspace_id, room_id) REFERENCES survey_feedback_rooms(workspace_id, id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS survey_guests_token_idx ON survey_guests(room_id, (data->>'tokenHash'));
CREATE TABLE IF NOT EXISTS survey_mutation_receipts (
  workspace_id uuid NOT NULL, survey_id uuid NOT NULL, room_id uuid,
  owner_id uuid NOT NULL, idempotency_key uuid NOT NULL, request_hash text NOT NULL,
  receipt jsonb NOT NULL, PRIMARY KEY (workspace_id, owner_id, idempotency_key),
  FOREIGN KEY (workspace_id, survey_id) REFERENCES surveys(workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, room_id) REFERENCES survey_feedback_rooms(workspace_id, id) ON DELETE CASCADE
);
ALTER TABLE live_room_codes DROP CONSTRAINT IF EXISTS live_room_codes_artifact_type_check;
ALTER TABLE live_room_codes ADD CONSTRAINT live_room_codes_artifact_type_check
  CHECK (artifact_type IN ('round', 'presentation', 'feedback_room'));
CREATE OR REPLACE FUNCTION reserve_survey_room_code() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  PERFORM claim_live_room_code(NEW.code::char(7), NEW.workspace_id, 'feedback_room', NEW.id, NEW.closes_at, now());
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION reserve_survey_room_code() FROM PUBLIC;
DROP TRIGGER IF EXISTS survey_room_reserve_code ON survey_feedback_rooms;
CREATE TRIGGER survey_room_reserve_code BEFORE INSERT ON survey_feedback_rooms
  FOR EACH ROW EXECUTE FUNCTION reserve_survey_room_code();
CREATE OR REPLACE FUNCTION release_survey_room_code() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE previous_access text;
BEGIN
  previous_access := current_setting('app.system_access', true);
  PERFORM set_config('app.system_access', 'on', true);
  DELETE FROM live_room_codes WHERE artifact_type = 'feedback_room' AND artifact_id = OLD.id;
  PERFORM set_config('app.system_access', coalesce(previous_access, ''), true);
  RETURN OLD;
END $$;
REVOKE ALL ON FUNCTION release_survey_room_code() FROM PUBLIC;
DROP TRIGGER IF EXISTS survey_room_release_code ON survey_feedback_rooms;
CREATE TRIGGER survey_room_release_code AFTER DELETE ON survey_feedback_rooms
  FOR EACH ROW EXECUTE FUNCTION release_survey_room_code();
CREATE OR REPLACE FUNCTION preserve_survey_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'survey_versions' THEN
    RAISE EXCEPTION 'Published survey versions are immutable';
  END IF;
  IF NEW.version_id <> OLD.version_id OR NEW.code <> OLD.code OR NEW.closes_at <> OLD.closes_at OR
    NEW.retention_expires_at <> OLD.retention_expires_at OR NEW.data->'content' <> OLD.data->'content' THEN
    RAISE EXCEPTION 'Published survey snapshots are immutable';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS survey_version_immutable ON survey_versions;
CREATE TRIGGER survey_version_immutable BEFORE UPDATE ON survey_versions FOR EACH ROW EXECUTE FUNCTION preserve_survey_snapshot();
DROP TRIGGER IF EXISTS survey_room_snapshot_immutable ON survey_feedback_rooms;
CREATE TRIGGER survey_room_snapshot_immutable BEFORE UPDATE ON survey_feedback_rooms FOR EACH ROW EXECUTE FUNCTION preserve_survey_snapshot();
DO $$ DECLARE table_name text; BEGIN
  FOREACH table_name IN ARRAY ARRAY['surveys', 'survey_versions', 'survey_feedback_rooms', 'survey_guests', 'survey_mutation_receipts'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format('DROP POLICY IF EXISTS workspace_isolation ON %I', table_name);
    EXECUTE format('CREATE POLICY workspace_isolation ON %I USING (current_setting(''app.system_access'', true) = ''on'' OR workspace_id::text = nullif(current_setting(''app.workspace_id'', true), '''')) WITH CHECK (current_setting(''app.system_access'', true) = ''on'' OR workspace_id::text = nullif(current_setting(''app.workspace_id'', true), ''''))', table_name);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'openround_runtime') THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO openround_runtime', table_name);
    END IF;
  END LOOP;
END $$;
