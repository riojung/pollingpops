-- V1 request receipts remain unchanged; writers upgrade document metadata one way.
ALTER TABLE canvas_boards ADD COLUMN schema_version smallint NOT NULL DEFAULT 1 CHECK(schema_version IN (1,2));
ALTER TABLE canvas_boards ALTER COLUMN schema_version SET DEFAULT 2;
ALTER TABLE canvas_boards ADD COLUMN upload_count integer NOT NULL DEFAULT 0 CHECK(upload_count BETWEEN 0 AND 100);
ALTER TABLE canvas_boards ADD COLUMN upload_bytes bigint NOT NULL DEFAULT 0 CHECK(upload_bytes BETWEEN 0 AND 209715200);
CREATE FUNCTION preserve_canvas_schema_version() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  IF NEW.schema_version < OLD.schema_version OR NEW.upload_count < OLD.upload_count OR NEW.upload_bytes < OLD.upload_bytes THEN
    RAISE EXCEPTION 'Canvas schema and lifetime upload usage cannot be rewound' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER canvas_schema_version BEFORE UPDATE ON canvas_boards FOR EACH ROW EXECUTE FUNCTION preserve_canvas_schema_version();

CREATE TABLE canvas_board_uploads (
  workspace_id uuid NOT NULL, board_id uuid NOT NULL, media_id uuid PRIMARY KEY,
  uploader_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY(workspace_id,board_id) REFERENCES canvas_boards(workspace_id,id) ON DELETE CASCADE,
  FOREIGN KEY(workspace_id,media_id) REFERENCES media_assets(workspace_id,id) ON DELETE CASCADE
);
CREATE INDEX canvas_uploads_board ON canvas_board_uploads(workspace_id,board_id);
ALTER TABLE media_assets ADD COLUMN canvas_board_id uuid REFERENCES canvas_boards(id) ON DELETE SET NULL;
ALTER TABLE canvas_board_uploads ENABLE ROW LEVEL SECURITY;
ALTER TABLE canvas_board_uploads FORCE ROW LEVEL SECURITY;
CREATE POLICY canvas_upload_scope ON canvas_board_uploads USING (
  current_setting('app.canvas_lifecycle',true)='on' OR
  (workspace_id::text=nullif(current_setting('app.workspace_id',true),'') AND board_id::text=nullif(current_setting('app.canvas_board_id',true),''))
) WITH CHECK (workspace_id::text=nullif(current_setting('app.workspace_id',true),'') AND board_id::text=nullif(current_setting('app.canvas_board_id',true),''));
-- The boolean provenance probe also works for migration owners without BYPASSRLS.
-- Its function-local setting never grants canvas objects, assets or board access.
CREATE POLICY canvas_upload_probe ON canvas_board_uploads FOR SELECT
  USING(current_setting('app.canvas_media_probe',true)='on');
ALTER TABLE media_references DROP CONSTRAINT IF EXISTS media_references_owner_type_check;
ALTER TABLE media_references ADD CONSTRAINT media_references_owner_type_check CHECK(owner_type IN (
  'quiz_draft','quiz_version','quiz_history','presentation_draft','presentation_version','presentation_history',
  'recovery_pack_draft','recovery_pack_version','recovery_pack_history','recovery_pack_mutation','followup','idea_board','canvas_board'
));
CREATE FUNCTION guard_canvas_media_reference() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  IF EXISTS(SELECT 1 FROM media_assets asset WHERE asset.workspace_id=NEW.workspace_id AND asset.id=NEW.media_id AND asset.canvas_board_id IS NOT NULL AND (NEW.owner_type<>'canvas_board' OR NEW.owner_id<>asset.canvas_board_id)) THEN
    RAISE EXCEPTION 'Canvas images belong exclusively to their canvas' USING ERRCODE='23503';
  END IF;
  IF NEW.owner_type='canvas_board' AND NOT EXISTS(SELECT 1 FROM media_assets asset WHERE asset.workspace_id=NEW.workspace_id AND asset.id=NEW.media_id AND asset.canvas_board_id=NEW.owner_id) THEN
    RAISE EXCEPTION 'Image is unavailable for this canvas' USING ERRCODE='23503';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER canvas_media_reference BEFORE INSERT OR UPDATE ON media_references FOR EACH ROW EXECUTE FUNCTION guard_canvas_media_reference();
CREATE FUNCTION preserve_canvas_asset_scope() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  IF NEW.canvas_board_id IS DISTINCT FROM OLD.canvas_board_id AND NOT(OLD.canvas_board_id IS NOT NULL AND NEW.canvas_board_id IS NULL AND NEW.scan_status='deleting') THEN
    RAISE EXCEPTION 'Canvas image provenance is immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER canvas_asset_scope BEFORE UPDATE ON media_assets FOR EACH ROW EXECUTE FUNCTION preserve_canvas_asset_scope();
CREATE FUNCTION guard_canvas_image_object() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  IF NEW.data->>'type'='image' AND NOT EXISTS(
    SELECT 1 FROM canvas_board_uploads upload JOIN media_assets asset ON asset.workspace_id=upload.workspace_id AND asset.id=upload.media_id
    WHERE upload.workspace_id=NEW.workspace_id AND upload.board_id=NEW.board_id AND upload.media_id=(NEW.data->>'mediaId')::uuid AND asset.scan_status='clean'
  ) THEN RAISE EXCEPTION 'Canvas images must be clean and owned by this board' USING ERRCODE='23503'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER canvas_image_object BEFORE INSERT OR UPDATE ON canvas_board_objects FOR EACH ROW EXECUTE FUNCTION guard_canvas_image_object();
CREATE FUNCTION canvas_retained_media_ids(target uuid) RETURNS TABLE(media_id uuid) LANGUAGE sql STABLE AS $$
  SELECT DISTINCT (object.data->>'mediaId')::uuid FROM canvas_board_objects object WHERE object.board_id=target AND object.data->>'type'='image'
  UNION
  SELECT DISTINCT (item->>'mediaId')::uuid FROM canvas_board_receipts receipt,
    LATERAL jsonb_array_elements(COALESCE(receipt.data->'before','[]'::jsonb)||COALESCE(receipt.data->'after','[]'::jsonb)) item
    WHERE receipt.board_id=target AND (receipt.data->>'undoable')::boolean AND item->>'type'='image'
$$;
CREATE FUNCTION remove_canvas_media() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  DELETE FROM media_references WHERE workspace_id=OLD.workspace_id AND owner_type='canvas_board' AND owner_id=OLD.id;
  UPDATE media_assets asset SET scan_status='deleting',finalization_token=NULL,finalization_started_at=NULL,
    deletion_started_at=COALESCE(asset.deletion_started_at,now()),object_cleanup_claim_token=NULL,object_cleanup_claimed_at=NULL
    WHERE asset.workspace_id=OLD.workspace_id AND asset.canvas_board_id=OLD.id;
  RETURN OLD;
END $$;
CREATE TRIGGER canvas_remove_media BEFORE DELETE ON canvas_boards FOR EACH ROW EXECUTE FUNCTION remove_canvas_media();
-- Provenance-only lookup prevents generic creator routes from issuing unscoped URLs.
-- It exposes no ownership, content, path or access capability.
DO $$ BEGIN
  EXECUTE format(
    'CREATE FUNCTION is_canvas_media(target uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET app.canvas_media_probe=''on'' AS %L',
    format('SELECT EXISTS(SELECT 1 FROM %I.canvas_board_uploads WHERE media_id=target)', current_schema())
  );
END $$;
REVOKE ALL ON FUNCTION is_canvas_media(uuid) FROM PUBLIC;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='openround_runtime') THEN
  GRANT SELECT,INSERT,UPDATE,DELETE ON canvas_board_uploads TO openround_runtime;
  GRANT EXECUTE ON FUNCTION is_canvas_media(uuid) TO openround_runtime;
END IF; END $$;
