-- Additive Library metadata; immutable Survey versions and room evidence are unchanged.
ALTER TABLE surveys ADD COLUMN IF NOT EXISTS folder_id uuid REFERENCES folders(id) ON DELETE SET NULL;
ALTER TABLE surveys ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
CREATE INDEX IF NOT EXISTS surveys_folder_idx ON surveys(workspace_id, folder_id);
CREATE OR REPLACE FUNCTION enforce_survey_folder_workspace() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.folder_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM folders WHERE id = NEW.folder_id AND workspace_id = NEW.workspace_id
  ) THEN
    RAISE EXCEPTION 'survey folder must belong to its workspace' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS survey_folder_workspace ON surveys;
CREATE TRIGGER survey_folder_workspace BEFORE INSERT OR UPDATE OF folder_id, workspace_id
  ON surveys FOR EACH ROW EXECUTE FUNCTION enforce_survey_folder_workspace();
ALTER TABLE library_favorites DROP CONSTRAINT IF EXISTS library_favorites_artifact_type_check;
ALTER TABLE library_favorites ADD CONSTRAINT library_favorites_artifact_type_check
  CHECK (artifact_type IN ('round', 'presentation', 'survey'));
CREATE OR REPLACE FUNCTION openround_lock_library_artifact_link()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE artifact_exists boolean;
BEGIN
  IF NEW.artifact_type = 'round' THEN
    SELECT true INTO artifact_exists FROM public.quizzes
      WHERE workspace_id = NEW.workspace_id AND id = NEW.artifact_id FOR KEY SHARE;
  ELSIF NEW.artifact_type = 'presentation' THEN
    SELECT true INTO artifact_exists FROM public.presentations
      WHERE workspace_id = NEW.workspace_id AND id = NEW.artifact_id FOR KEY SHARE;
  ELSIF NEW.artifact_type = 'survey' THEN
    SELECT true INTO artifact_exists FROM public.surveys
      WHERE workspace_id = NEW.workspace_id AND id = NEW.artifact_id FOR KEY SHARE;
  END IF;
  IF artifact_exists IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'library item must exist in the link workspace' USING ERRCODE = '23503';
  END IF;
  RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION openround_remove_survey_library_links()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public SET app.system_access = 'on' AS $$
BEGIN
  IF TG_TABLE_SCHEMA <> 'public' OR TG_TABLE_NAME <> 'surveys' THEN
    RAISE EXCEPTION 'survey cleanup requires the survey parent' USING ERRCODE = '23514';
  END IF;
  DELETE FROM public.library_favorites
    WHERE workspace_id = OLD.workspace_id AND artifact_type = 'survey' AND artifact_id = OLD.id;
  RETURN OLD;
END $$;
REVOKE ALL ON FUNCTION openround_remove_survey_library_links() FROM PUBLIC;
DROP TRIGGER IF EXISTS surveys_remove_library_links ON surveys;
CREATE TRIGGER surveys_remove_library_links AFTER DELETE ON surveys
  FOR EACH ROW EXECUTE FUNCTION openround_remove_survey_library_links();

-- Product feedback is separate from participant responses and never publicly readable.
CREATE TABLE IF NOT EXISTS beta_feedback (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  idempotency_key uuid NOT NULL,
  category text NOT NULL CHECK (category IN ('bug', 'idea', 'usability', 'other')),
  message text NOT NULL CHECK (char_length(message) BETWEEN 10 AND 4000),
  page text NOT NULL CHECK (char_length(page) <= 160),
  allow_contact boolean NOT NULL,
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  UNIQUE (workspace_id, user_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS beta_feedback_expiry_idx ON beta_feedback(expires_at);
CREATE INDEX IF NOT EXISTS beta_feedback_created_idx ON beta_feedback(created_at DESC, id DESC);
ALTER TABLE beta_feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE beta_feedback FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS feedback_author_isolation ON beta_feedback;
CREATE POLICY feedback_author_isolation ON beta_feedback
  USING (current_setting('app.system_access', true) = 'on' OR
    (workspace_id::text = nullif(current_setting('app.workspace_id', true), '') AND
     user_id::text = nullif(current_setting('app.user_id', true), '')))
  WITH CHECK (current_setting('app.system_access', true) = 'on' OR
    (workspace_id::text = nullif(current_setting('app.workspace_id', true), '') AND
     user_id::text = nullif(current_setting('app.user_id', true), '')));
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'openround_runtime') THEN
    GRANT SELECT, INSERT, DELETE ON beta_feedback TO openround_runtime;
  END IF;
END $$;
