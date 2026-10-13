-- Library organization changes only; published content and room evidence are untouched.
CREATE TEMP TABLE folder_scope_upgrade ON COMMIT DROP AS
SELECT NOT EXISTS (SELECT 1 FROM information_schema.columns
  WHERE table_schema = current_schema() AND table_name = 'folders' AND column_name = 'artifact_type') AS initial_upgrade;
ALTER TABLE folders
  ADD COLUMN IF NOT EXISTS artifact_type text NOT NULL DEFAULT 'round' CHECK (artifact_type IN ('round', 'presentation', 'survey')),
  ADD COLUMN IF NOT EXISTS parent_id uuid REFERENCES folders(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS position integer NOT NULL DEFAULT 0 CHECK (position >= 0);
DROP INDEX IF EXISTS folders_workspace_name_uq;

-- Keep Round IDs stable. Split shared legacy folders only for types that use them.
CREATE TEMP TABLE folder_scope_migration ON COMMIT DROP AS
SELECT folder.id AS old_id, gen_random_uuid() AS new_id, 'presentation'::text AS artifact_type
FROM folders folder WHERE folder.artifact_type = 'round' AND EXISTS (SELECT 1 FROM presentations WHERE folder_id = folder.id)
UNION ALL
SELECT folder.id, gen_random_uuid(), 'survey'::text
FROM folders folder WHERE folder.artifact_type = 'round' AND EXISTS (SELECT 1 FROM surveys WHERE folder_id = folder.id);
INSERT INTO folders (id, workspace_id, name, artifact_type, created_at, updated_at)
SELECT split.new_id, folder.workspace_id, folder.name, split.artifact_type, folder.created_at, folder.updated_at
FROM folder_scope_migration split JOIN folders folder ON folder.id = split.old_id;
UPDATE presentations artifact SET folder_id = split.new_id
FROM folder_scope_migration split WHERE split.artifact_type = 'presentation' AND artifact.folder_id = split.old_id;
UPDATE surveys artifact SET folder_id = split.new_id,
  data = jsonb_set(artifact.data, '{folderId}', to_jsonb(split.new_id::text), true)
FROM folder_scope_migration split WHERE split.artifact_type = 'survey' AND artifact.folder_id = split.old_id;
WITH ordered AS (
  SELECT id, row_number() OVER (PARTITION BY workspace_id, artifact_type ORDER BY lower(name), id) - 1 AS position FROM folders
)
UPDATE folders SET position = ordered.position FROM ordered WHERE folders.id = ordered.id
  AND (SELECT initial_upgrade FROM folder_scope_upgrade);
CREATE UNIQUE INDEX IF NOT EXISTS folders_sibling_name_uq ON folders
  (workspace_id, artifact_type, coalesce(parent_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(name));
CREATE INDEX IF NOT EXISTS folders_tree_idx ON folders (workspace_id, artifact_type, parent_id, position, id);

CREATE OR REPLACE FUNCTION enforce_folder_tree() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.workspace_id::text, 660066));
  IF TG_OP = 'UPDATE' AND (NEW.workspace_id IS DISTINCT FROM OLD.workspace_id OR NEW.artifact_type IS DISTINCT FROM OLD.artifact_type) THEN
    RAISE EXCEPTION 'folder workspace and content type are immutable' USING ERRCODE = '23514';
  END IF;
  IF NEW.parent_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM folders WHERE id = NEW.parent_id AND workspace_id = NEW.workspace_id AND artifact_type = NEW.artifact_type) THEN
      RAISE EXCEPTION 'parent folder must belong to the same workspace and content type' USING ERRCODE = '23514';
    END IF;
    IF EXISTS (
      WITH RECURSIVE ancestors AS (
        SELECT id, parent_id FROM folders WHERE id = NEW.parent_id
        UNION SELECT parent.id, parent.parent_id FROM folders parent JOIN ancestors ON parent.id = ancestors.parent_id
      ) SELECT 1 FROM ancestors WHERE id = NEW.id
    ) THEN
      RAISE EXCEPTION 'folder cannot be its own ancestor' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS folders_tree ON folders;
CREATE TRIGGER folders_tree BEFORE INSERT OR UPDATE ON folders FOR EACH ROW EXECUTE FUNCTION enforce_folder_tree();

CREATE OR REPLACE FUNCTION enforce_quiz_folder_workspace() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.folder_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM folders WHERE id = NEW.folder_id AND workspace_id = NEW.workspace_id AND artifact_type = 'round'
  ) THEN RAISE EXCEPTION 'round folder must belong to its workspace and content type' USING ERRCODE = '23514'; END IF;
  RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION enforce_presentation_folder_workspace() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.folder_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM folders WHERE id = NEW.folder_id AND workspace_id = NEW.workspace_id AND artifact_type = 'presentation'
  ) THEN RAISE EXCEPTION 'presentation folder must belong to its workspace and content type' USING ERRCODE = '23514'; END IF;
  RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION enforce_survey_folder_workspace() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.folder_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM folders WHERE id = NEW.folder_id AND workspace_id = NEW.workspace_id AND artifact_type = 'survey'
  ) THEN RAISE EXCEPTION 'survey folder must belong to its workspace and content type' USING ERRCODE = '23514'; END IF;
  NEW.data = jsonb_set(NEW.data, '{folderId}', coalesce(to_jsonb(NEW.folder_id::text), 'null'::jsonb), true);
  RETURN NEW;
END $$;
