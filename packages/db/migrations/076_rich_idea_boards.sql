-- Board uploads have private board/guest provenance and cannot escape into other content.
CREATE UNIQUE INDEX IF NOT EXISTS idea_boards_workspace_id_idx ON idea_boards(workspace_id,id);
CREATE TABLE IF NOT EXISTS idea_board_uploads (
  workspace_id uuid NOT NULL,
  board_id uuid NOT NULL,
  guest_id uuid NOT NULL,
  media_id uuid PRIMARY KEY,
  retained boolean NOT NULL DEFAULT true,
  FOREIGN KEY(workspace_id,board_id) REFERENCES idea_boards(workspace_id,id) ON DELETE CASCADE,
  FOREIGN KEY(workspace_id,media_id) REFERENCES media_assets(workspace_id,id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idea_board_uploads_board_idx ON idea_board_uploads(workspace_id,board_id);
ALTER TABLE idea_board_uploads ENABLE ROW LEVEL SECURITY;
ALTER TABLE idea_board_uploads FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS workspace_isolation ON idea_board_uploads;
CREATE POLICY workspace_isolation ON idea_board_uploads
  USING (current_setting('app.system_access',true)='on' OR workspace_id::text=nullif(current_setting('app.workspace_id',true),''))
  WITH CHECK (current_setting('app.system_access',true)='on' OR workspace_id::text=nullif(current_setting('app.workspace_id',true),''));
ALTER TABLE media_references DROP CONSTRAINT IF EXISTS media_references_owner_type_check;
ALTER TABLE media_references ADD CONSTRAINT media_references_owner_type_check CHECK (owner_type IN (
  'quiz_draft','quiz_version','quiz_history','presentation_draft','presentation_version','presentation_history',
  'recovery_pack_draft','recovery_pack_version','recovery_pack_history','recovery_pack_mutation','followup','idea_board'
));

CREATE OR REPLACE FUNCTION openround_guard_board_media_reference()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM idea_board_uploads upload WHERE upload.workspace_id=NEW.workspace_id
    AND upload.media_id=NEW.media_id AND (NEW.owner_type<>'idea_board' OR NEW.owner_id<>upload.board_id OR NOT upload.retained)) THEN
    RAISE EXCEPTION 'Board uploads belong exclusively to their idea board' USING ERRCODE='23503';
  END IF;
  IF NEW.owner_type='idea_board' AND NOT EXISTS (SELECT 1 FROM idea_board_uploads upload
    WHERE upload.workspace_id=NEW.workspace_id AND upload.media_id=NEW.media_id
      AND upload.board_id=NEW.owner_id AND upload.retained) THEN
    RAISE EXCEPTION 'Image is unavailable for this idea board' USING ERRCODE='23503';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS media_references_guard_board_upload ON media_references;
CREATE TRIGGER media_references_guard_board_upload BEFORE INSERT OR UPDATE ON media_references
  FOR EACH ROW EXECUTE FUNCTION openround_guard_board_media_reference();

CREATE OR REPLACE FUNCTION openround_idea_board_media_ids(document jsonb)
RETURNS TABLE(media_id uuid) LANGUAGE sql IMMUTABLE AS $$
  SELECT DISTINCT (attachment->>'mediaId')::uuid
  FROM jsonb_array_elements(COALESCE(document->'ideas','[]'::jsonb)) idea,
    jsonb_array_elements(COALESCE(idea->'attachments','[]'::jsonb)) attachment
  WHERE idea->>'status'<>'removed'
$$;

CREATE OR REPLACE FUNCTION openround_sync_idea_board_media()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- Acquire the same asset lock as deletion/finalization before retaining or publishing an image.
  PERFORM 1 FROM media_assets asset JOIN idea_board_uploads upload
    ON upload.workspace_id=asset.workspace_id AND upload.media_id=asset.id
    WHERE upload.workspace_id=NEW.workspace_id AND upload.board_id=NEW.id
    ORDER BY asset.id FOR UPDATE OF asset;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(COALESCE(NEW.data->'ideas','[]'::jsonb)) idea
    CROSS JOIN LATERAL jsonb_array_elements(COALESCE(idea->'attachments','[]'::jsonb)) attachment
    LEFT JOIN idea_board_uploads upload ON upload.workspace_id=NEW.workspace_id
      AND upload.media_id=(attachment->>'mediaId')::uuid AND upload.board_id=NEW.id
      AND upload.guest_id=(idea->>'guestId')::uuid AND upload.retained
    LEFT JOIN media_assets asset ON asset.workspace_id=NEW.workspace_id AND asset.id=upload.media_id
    WHERE upload.media_id IS NULL OR asset.scan_status IS DISTINCT FROM 'clean' OR idea->>'status'='removed'
  ) THEN
    RAISE EXCEPTION 'Idea images must be clean and owned by their submitting guest' USING ERRCODE='23503';
  END IF;
  IF TG_OP='UPDATE' THEN
    UPDATE idea_board_uploads SET retained=false
      WHERE workspace_id=NEW.workspace_id AND board_id=NEW.id
        AND media_id IN (SELECT media_id FROM openround_idea_board_media_ids(OLD.data))
        AND media_id NOT IN (SELECT media_id FROM openround_idea_board_media_ids(NEW.data));
  END IF;
  DELETE FROM media_references WHERE workspace_id=NEW.workspace_id AND owner_type='idea_board' AND owner_id=NEW.id;
  UPDATE media_assets asset SET scan_status='deleting', finalization_token=NULL,
    finalization_started_at=NULL, deletion_started_at=COALESCE(asset.deletion_started_at,now()),
    object_cleanup_claim_token=NULL, object_cleanup_claimed_at=NULL
    FROM idea_board_uploads upload WHERE upload.workspace_id=NEW.workspace_id AND upload.board_id=NEW.id
      AND NOT upload.retained AND asset.workspace_id=upload.workspace_id AND asset.id=upload.media_id;
  -- Retain bounded reservations as well as submitted images until removal or board expiry.
  INSERT INTO media_references(workspace_id,media_id,owner_type,owner_id)
    SELECT upload.workspace_id,upload.media_id,'idea_board',upload.board_id
    FROM idea_board_uploads upload JOIN media_assets asset
      ON asset.workspace_id=upload.workspace_id AND asset.id=upload.media_id
    WHERE upload.workspace_id=NEW.workspace_id AND upload.board_id=NEW.id
      AND upload.retained AND asset.scan_status<>'deleting';
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS idea_boards_sync_media ON idea_boards;
CREATE TRIGGER idea_boards_sync_media AFTER INSERT OR UPDATE OF data ON idea_boards
  FOR EACH ROW EXECUTE FUNCTION openround_sync_idea_board_media();

CREATE OR REPLACE FUNCTION openround_remove_idea_board_media()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM media_references WHERE workspace_id=OLD.workspace_id AND owner_type='idea_board' AND owner_id=OLD.id;
  UPDATE media_assets asset SET scan_status='deleting', finalization_token=NULL,
    finalization_started_at=NULL, deletion_started_at=COALESCE(asset.deletion_started_at,now()),
    object_cleanup_claim_token=NULL, object_cleanup_claimed_at=NULL
    FROM idea_board_uploads upload WHERE upload.workspace_id=OLD.workspace_id AND upload.board_id=OLD.id
      AND asset.workspace_id=upload.workspace_id AND asset.id=upload.media_id;
  RETURN OLD;
END $$;
DROP TRIGGER IF EXISTS idea_boards_remove_media ON idea_boards;
CREATE TRIGGER idea_boards_remove_media BEFORE DELETE ON idea_boards
  FOR EACH ROW EXECUTE FUNCTION openround_remove_idea_board_media();

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='openround_runtime') THEN
    GRANT SELECT,INSERT,UPDATE,DELETE ON idea_board_uploads TO openround_runtime;
  END IF;
END $$;
