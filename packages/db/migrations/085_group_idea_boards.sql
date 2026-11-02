-- Facilitator collections may reference Guided workshops without changing guest identity.
ALTER TABLE collaboration_group_artifacts
  DROP CONSTRAINT collaboration_group_artifacts_artifact_type_check;
ALTER TABLE collaboration_group_artifacts
  ADD CONSTRAINT collaboration_group_artifacts_artifact_type_check
  CHECK (artifact_type IN ('round', 'presentation', 'idea_board'));

-- Preserve the existing polymorphic foreign-key guard for all older link types.
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
  ELSIF NEW.artifact_type = 'idea_board' AND TG_TABLE_SCHEMA = 'public'
      AND TG_TABLE_NAME = 'collaboration_group_artifacts' THEN
    SELECT true INTO artifact_exists FROM public.idea_boards
      WHERE workspace_id = NEW.workspace_id AND id = NEW.artifact_id
        AND retention_expires_at > clock_timestamp() FOR KEY SHARE;
  END IF;
  IF artifact_exists IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'library item must exist in the link workspace' USING ERRCODE = '23503';
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION remove_idea_board_group_artifacts() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public SET app.system_access = 'on' AS $$
BEGIN
  IF TG_TABLE_SCHEMA <> 'public' OR TG_TABLE_NAME <> 'idea_boards' THEN
    RAISE EXCEPTION 'workshop cleanup requires the parent' USING ERRCODE = '23514';
  END IF;
  DELETE FROM public.collaboration_group_artifacts
  WHERE workspace_id = OLD.workspace_id AND artifact_type = 'idea_board' AND artifact_id = OLD.id;
  RETURN OLD;
END $$;
CREATE TRIGGER idea_board_group_artifact_cleanup AFTER DELETE ON idea_boards
  FOR EACH ROW EXECUTE FUNCTION remove_idea_board_group_artifacts();
