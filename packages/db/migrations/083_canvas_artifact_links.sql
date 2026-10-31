-- Creator-only exact-checkpoint relationships. Immutable artifact/playback JSON never contains them.
CREATE TABLE canvas_artifact_links (
  id uuid PRIMARY KEY, workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  target_kind text NOT NULL CHECK(target_kind IN ('round','presentation')), target_id uuid NOT NULL,
  quiz_id uuid, presentation_id uuid, board_id uuid NOT NULL, version_id uuid NOT NULL,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL, revision integer NOT NULL DEFAULT 1 CHECK(revision=1),
  FOREIGN KEY(workspace_id,quiz_id) REFERENCES quizzes(workspace_id,id) ON DELETE CASCADE,
  FOREIGN KEY(workspace_id,presentation_id) REFERENCES presentations(workspace_id,id) ON DELETE CASCADE,
  FOREIGN KEY(workspace_id,board_id) REFERENCES canvas_boards(workspace_id,id) ON DELETE CASCADE,
  FOREIGN KEY(board_id,version_id) REFERENCES canvas_board_versions(board_id,id) ON DELETE CASCADE,
  CHECK((target_kind='round' AND quiz_id IS NOT NULL AND quiz_id=target_id AND presentation_id IS NULL)
    OR (target_kind='presentation' AND presentation_id IS NOT NULL AND presentation_id=target_id AND quiz_id IS NULL)),
  UNIQUE(target_kind,target_id,board_id,version_id)
);
CREATE TABLE canvas_artifact_link_receipts (
  id bigserial PRIMARY KEY, workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  target_kind text NOT NULL CHECK(target_kind IN ('round','presentation')), target_id uuid NOT NULL,
  quiz_id uuid, presentation_id uuid,
  actor_id uuid REFERENCES users(id) ON DELETE SET NULL, operation_id uuid NOT NULL,
  request_hash text NOT NULL CHECK(request_hash ~ '^[a-f0-9]{64}$'),
  requested_link_id uuid NOT NULL, link_id uuid NOT NULL, deleted boolean NOT NULL,
  FOREIGN KEY(workspace_id,quiz_id) REFERENCES quizzes(workspace_id,id) ON DELETE CASCADE,
  FOREIGN KEY(workspace_id,presentation_id) REFERENCES presentations(workspace_id,id) ON DELETE CASCADE,
  CHECK((target_kind='round' AND quiz_id IS NOT NULL AND quiz_id=target_id AND presentation_id IS NULL)
    OR (target_kind='presentation' AND presentation_id IS NOT NULL AND presentation_id=target_id AND quiz_id IS NULL)),
  UNIQUE(target_kind,target_id,actor_id,operation_id)
);
CREATE INDEX canvas_artifact_link_source ON canvas_artifact_links(board_id,version_id);
CREATE INDEX canvas_artifact_link_author ON canvas_artifact_links(created_by);
CREATE INDEX canvas_artifact_link_receipt_author ON canvas_artifact_link_receipts(actor_id);
ALTER TABLE canvas_artifact_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE canvas_artifact_links FORCE ROW LEVEL SECURITY;
ALTER TABLE canvas_artifact_link_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE canvas_artifact_link_receipts FORCE ROW LEVEL SECURITY;
DO $$ DECLARE target text; BEGIN
  FOREACH target IN ARRAY ARRAY['canvas_artifact_links','canvas_artifact_link_receipts'] LOOP
    EXECUTE format('CREATE POLICY canvas_artifact_link_scope ON %I USING (
      current_setting(''app.canvas_lifecycle'',true)=''on'' OR (
        workspace_id::text=nullif(current_setting(''app.workspace_id'',true),'''') AND
        target_kind=nullif(current_setting(''app.canvas_artifact_target_kind'',true),'''') AND
        target_id::text=nullif(current_setting(''app.canvas_artifact_target_id'',true),'''')))
      WITH CHECK (current_setting(''app.canvas_lifecycle'',true)=''on'' OR (workspace_id::text=nullif(current_setting(''app.workspace_id'',true),'''') AND
        target_kind=nullif(current_setting(''app.canvas_artifact_target_kind'',true),'''') AND
        target_id::text=nullif(current_setting(''app.canvas_artifact_target_id'',true),'''')))',target);
  END LOOP;
END $$;
CREATE FUNCTION guard_canvas_artifact_link_limit() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE limit_count integer;
BEGIN
  IF NEW.target_kind='round' THEN
    PERFORM id FROM quizzes WHERE workspace_id=NEW.workspace_id AND id=NEW.target_id FOR UPDATE;
  ELSE
    PERFORM id FROM presentations WHERE workspace_id=NEW.workspace_id AND id=NEW.target_id FOR UPDATE;
  END IF;
  IF TG_TABLE_NAME='canvas_artifact_links' THEN
    SELECT count(*) INTO limit_count FROM canvas_artifact_links WHERE target_kind=NEW.target_kind AND target_id=NEW.target_id;
    IF limit_count>=20 THEN RAISE EXCEPTION 'Canvas artifact link limit reached' USING ERRCODE='23514'; END IF;
  ELSE
    SELECT count(*) INTO limit_count FROM canvas_artifact_link_receipts WHERE target_kind=NEW.target_kind AND target_id=NEW.target_id;
    IF limit_count>=2000 THEN RAISE EXCEPTION 'Canvas artifact receipt limit reached' USING ERRCODE='23514'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER canvas_artifact_link_limit BEFORE INSERT ON canvas_artifact_links FOR EACH ROW EXECUTE FUNCTION guard_canvas_artifact_link_limit();
CREATE TRIGGER canvas_artifact_receipt_limit BEFORE INSERT ON canvas_artifact_link_receipts FOR EACH ROW EXECUTE FUNCTION guard_canvas_artifact_link_limit();
-- Soft account deletion clears attribution, without deleting a surviving shared destination/source.
CREATE FUNCTION clear_canvas_artifact_link_author() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public SET app.canvas_lifecycle='on' AS $$ BEGIN
  IF NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL THEN
    UPDATE canvas_artifact_links SET created_by=NULL WHERE created_by=NEW.id;
    UPDATE canvas_artifact_link_receipts SET actor_id=NULL WHERE actor_id=NEW.id;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION clear_canvas_artifact_link_author() FROM PUBLIC;
CREATE TRIGGER canvas_artifact_link_author_privacy AFTER UPDATE OF deleted_at ON users FOR EACH ROW EXECUTE FUNCTION clear_canvas_artifact_link_author();
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='openround_runtime') THEN
  GRANT SELECT,INSERT,UPDATE,DELETE ON canvas_artifact_links,canvas_artifact_link_receipts TO openround_runtime;
  GRANT USAGE,SELECT ON SEQUENCE canvas_artifact_link_receipts_id_seq TO openround_runtime;
END IF; END $$;
