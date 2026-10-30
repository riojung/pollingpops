-- A separate facilitation protocol leaves accepted canvas V1/V2 request hashes unchanged.
CREATE TABLE canvas_board_comment_threads (
  board_id uuid NOT NULL, workspace_id uuid NOT NULL, id uuid NOT NULL, object_id uuid NOT NULL,
  created_at timestamptz NOT NULL, data jsonb NOT NULL,
  PRIMARY KEY(board_id,id),
  FOREIGN KEY(workspace_id,board_id) REFERENCES canvas_boards(workspace_id,id) ON DELETE CASCADE,
  FOREIGN KEY(board_id,object_id) REFERENCES canvas_board_objects(board_id,id) ON DELETE CASCADE,
  CHECK(data->>'id'=id::text AND data->>'objectId'=object_id::text AND (data->>'version')::bigint>0),
  CHECK(octet_length(data::text)<=16384 AND NOT(data ? 'messages'))
);
CREATE TABLE canvas_board_comment_messages (
  board_id uuid NOT NULL, workspace_id uuid NOT NULL, id uuid NOT NULL, thread_id uuid NOT NULL,
  author_id uuid REFERENCES users(id) ON DELETE CASCADE, created_at timestamptz NOT NULL, data jsonb NOT NULL,
  PRIMARY KEY(board_id,id),
  FOREIGN KEY(workspace_id,board_id) REFERENCES canvas_boards(workspace_id,id) ON DELETE CASCADE,
  FOREIGN KEY(board_id,thread_id) REFERENCES canvas_board_comment_threads(board_id,id) ON DELETE CASCADE,
  CHECK(data->>'id'=id::text AND (data->>'version')::bigint>0 AND NOT(data ? 'authorId')),
  CHECK(octet_length(data::text)<=16384 AND length(data->>'text')<=2000),
  CHECK(NOT (data->>'deleted')::boolean OR data->>'text'='')
);
CREATE TABLE canvas_board_timers (
  board_id uuid PRIMARY KEY, workspace_id uuid NOT NULL, data jsonb NOT NULL,
  FOREIGN KEY(workspace_id,board_id) REFERENCES canvas_boards(workspace_id,id) ON DELETE CASCADE,
  CHECK(octet_length(data::text)<=1024 AND (data->>'revision')::bigint>=0),
  CHECK(data->>'status' IN ('idle','running','paused','finished')),
  CHECK((data->>'remainingMs')::bigint BETWEEN 0 AND 7200000),
  CHECK(data->>'durationSeconds' IS NULL OR (data->>'durationSeconds')::integer BETWEEN 5 AND 7200)
);
CREATE TABLE canvas_board_versions (
  board_id uuid NOT NULL, workspace_id uuid NOT NULL, id uuid NOT NULL,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL, created_at timestamptz NOT NULL,
  data jsonb NOT NULL, objects jsonb NOT NULL,
  PRIMARY KEY(board_id,id),
  FOREIGN KEY(workspace_id,board_id) REFERENCES canvas_boards(workspace_id,id) ON DELETE CASCADE,
  CHECK(data->>'id'=id::text AND (data->>'version')::bigint>0 AND NOT(data ? 'createdBy')),
  CHECK(octet_length(data::text)<=16384 AND length(data->>'name') BETWEEN 1 AND 120),
  CHECK(jsonb_typeof(objects)='array' AND jsonb_array_length(objects)<=500 AND octet_length(objects::text)<=2097152),
  -- Guest content is resolved against the current source, never frozen inside a checkpoint.
  CHECK(NOT jsonb_path_exists(objects,'$[*].idea'))
);
CREATE INDEX canvas_comment_author ON canvas_board_comment_messages(author_id,board_id);
DO $$ DECLARE target text; BEGIN
  FOREACH target IN ARRAY ARRAY['canvas_board_comment_threads','canvas_board_comment_messages','canvas_board_timers','canvas_board_versions'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',target);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',target);
    EXECUTE format('CREATE POLICY canvas_facilitation_scope ON %I USING (current_setting(''app.canvas_lifecycle'',true)=''on'' OR (workspace_id::text=nullif(current_setting(''app.workspace_id'',true),'''') AND board_id::text=nullif(current_setting(''app.canvas_board_id'',true),''''))) WITH CHECK (current_setting(''app.canvas_lifecycle'',true)=''on'' OR (workspace_id::text=nullif(current_setting(''app.workspace_id'',true),'''') AND board_id::text=nullif(current_setting(''app.canvas_board_id'',true),'''')))',target);
  END LOOP;
END $$;
CREATE FUNCTION guard_canvas_comment_limits() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  PERFORM id FROM canvas_boards WHERE id=NEW.board_id FOR UPDATE;
  IF TG_TABLE_NAME='canvas_board_comment_threads' THEN
    IF (SELECT count(*) FROM canvas_board_comment_threads WHERE board_id=NEW.board_id AND id<>NEW.id)>=100
      OR (SELECT COALESCE(sum(octet_length(data::text)),0) FROM canvas_board_comment_threads WHERE board_id=NEW.board_id AND id<>NEW.id)
        +(SELECT COALESCE(sum(octet_length(data::text)),0) FROM canvas_board_comment_messages WHERE board_id=NEW.board_id)
        +octet_length(NEW.data::text)>524288 THEN
      RAISE EXCEPTION 'Canvas discussion limit reached' USING ERRCODE='23514';
    END IF;
  ELSE
    IF (SELECT count(*) FROM canvas_board_comment_messages WHERE board_id=NEW.board_id AND id<>NEW.id)>=500
      OR (SELECT count(*) FROM canvas_board_comment_messages WHERE board_id=NEW.board_id AND thread_id=NEW.thread_id AND id<>NEW.id)>=20
      OR (SELECT COALESCE(sum(octet_length(data::text)),0) FROM canvas_board_comment_messages WHERE board_id=NEW.board_id AND id<>NEW.id)
        +(SELECT COALESCE(sum(octet_length(data::text)),0) FROM canvas_board_comment_threads WHERE board_id=NEW.board_id)
        +octet_length(NEW.data::text)>524288 THEN
      RAISE EXCEPTION 'Canvas retained message limit reached' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER canvas_thread_limits BEFORE INSERT OR UPDATE ON canvas_board_comment_threads FOR EACH ROW EXECUTE FUNCTION guard_canvas_comment_limits();
CREATE TRIGGER canvas_message_limits BEFORE INSERT OR UPDATE ON canvas_board_comment_messages FOR EACH ROW EXECUTE FUNCTION guard_canvas_comment_limits();
CREATE FUNCTION guard_canvas_version_limits() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  PERFORM id FROM canvas_boards WHERE id=NEW.board_id FOR UPDATE;
  IF (SELECT count(*) FROM canvas_board_versions WHERE board_id=NEW.board_id AND id<>NEW.id)>=10
    OR (SELECT COALESCE(sum(octet_length(objects::text)+octet_length(data::text)),0) FROM canvas_board_versions WHERE board_id=NEW.board_id AND id<>NEW.id)
      +octet_length(NEW.objects::text)+octet_length(NEW.data::text)>4194304 THEN
    RAISE EXCEPTION 'Canvas retained checkpoint limit reached' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER canvas_version_limits BEFORE INSERT OR UPDATE ON canvas_board_versions FOR EACH ROW EXECUTE FUNCTION guard_canvas_version_limits();
CREATE OR REPLACE FUNCTION canvas_retained_media_ids(target uuid) RETURNS TABLE(media_id uuid) LANGUAGE sql STABLE AS $$
  SELECT DISTINCT (object.data->>'mediaId')::uuid FROM canvas_board_objects object WHERE object.board_id=target AND object.data->>'type'='image'
  UNION
  SELECT DISTINCT (item->>'mediaId')::uuid FROM canvas_board_receipts receipt,
    LATERAL jsonb_array_elements(COALESCE(receipt.data->'before','[]'::jsonb)||COALESCE(receipt.data->'after','[]'::jsonb)) item
    WHERE receipt.board_id=target AND (receipt.data->>'undoable')::boolean AND item->>'type'='image'
  UNION
  SELECT DISTINCT (item->>'mediaId')::uuid FROM canvas_board_versions version,
    LATERAL jsonb_array_elements(version.objects) item
    WHERE version.board_id=target AND item->>'type'='image'
$$;
-- Trigger-only privacy cleanup is scoped to its canonical source; it grants no caller board access.
CREATE FUNCTION canvas_purge_source_comments() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public SET app.canvas_lifecycle='on' AS $$ BEGIN
  WITH RECURSIVE removed(board_id,object_id) AS (
    SELECT object.board_id,object.id FROM canvas_board_objects object JOIN canvas_boards board ON board.id=object.board_id
      WHERE board.source_board_id=NEW.id AND object.data->>'type'='idea_ref' AND NOT EXISTS(
        SELECT 1 FROM jsonb_array_elements(NEW.data->'ideas') idea WHERE idea->>'id'=object.data->>'ideaId' AND idea->>'status'='approved')
    UNION
    SELECT object.board_id,object.id FROM canvas_board_objects object JOIN removed
      ON removed.board_id=object.board_id AND (object.data->'from'->>'objectId'=removed.object_id::text OR object.data->'to'->>'objectId'=removed.object_id::text)
      WHERE object.data->>'type'='connector'
  ) DELETE FROM canvas_board_comment_threads thread USING removed
      WHERE thread.board_id=removed.board_id AND thread.object_id=removed.object_id;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION canvas_purge_source_comments() FROM PUBLIC;
CREATE TRIGGER canvas_source_comment_privacy AFTER UPDATE OF data ON idea_boards FOR EACH ROW EXECUTE FUNCTION canvas_purge_source_comments();
CREATE FUNCTION canvas_purge_deleted_author() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public SET app.canvas_lifecycle='on' AS $$ BEGIN
  IF NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL THEN
    WITH removed AS (DELETE FROM canvas_board_comment_messages WHERE author_id=NEW.id RETURNING board_id,thread_id)
      DELETE FROM canvas_board_comment_threads thread WHERE EXISTS(SELECT 1 FROM removed WHERE removed.board_id=thread.board_id AND removed.thread_id=thread.id)
        AND NOT EXISTS(SELECT 1 FROM canvas_board_comment_messages message WHERE message.board_id=thread.board_id AND message.thread_id=thread.id AND message.author_id IS DISTINCT FROM NEW.id);
    UPDATE canvas_board_versions SET created_by=NULL WHERE created_by=NEW.id;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION canvas_purge_deleted_author() FROM PUBLIC;
CREATE TRIGGER canvas_deleted_author_privacy AFTER UPDATE OF deleted_at ON users FOR EACH ROW EXECUTE FUNCTION canvas_purge_deleted_author();
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='openround_runtime') THEN
  GRANT SELECT,INSERT,UPDATE,DELETE ON canvas_board_comment_threads,canvas_board_comment_messages,canvas_board_timers,canvas_board_versions TO openround_runtime;
END IF; END $$;
