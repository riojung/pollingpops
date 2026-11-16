-- Visual conversion is separate from AI authoring and stores originals only while work is pending.
CREATE FUNCTION visual_import_utf16_length(value text) RETURNS bigint LANGUAGE sql IMMUTABLE STRICT AS $$
 SELECT COALESCE(sum(CASE WHEN ascii(ch)>65535 THEN 2 ELSE 1 END),0) FROM regexp_split_to_table(value,'') ch WHERE ch<>''
$$;
CREATE TABLE presentation_visual_import_usage (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  day date NOT NULL, used integer NOT NULL CHECK(used BETWEEN 1 AND 10), PRIMARY KEY(workspace_id,day)
);
ALTER TABLE presentation_visual_import_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE presentation_visual_import_usage FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON presentation_visual_import_usage USING(current_setting('app.system_access',true)='on' OR workspace_id::text=nullif(current_setting('app.workspace_id',true),''))
  WITH CHECK(current_setting('app.system_access',true)='on' OR workspace_id::text=nullif(current_setting('app.workspace_id',true),''));
CREATE TABLE presentation_visual_imports (
  id uuid PRIMARY KEY, workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  presentation_id uuid NOT NULL, created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  request_id uuid NOT NULL, request_hash text NOT NULL CHECK(request_hash~'^[a-f0-9]{64}$'),
  source_digest text NOT NULL CHECK(source_digest~'^[a-f0-9]{64}$'),
  source_type text NOT NULL CHECK(source_type IN('pdf','image_set')),
  source_name text NOT NULL CHECK(visual_import_utf16_length(source_name) BETWEEN 1 AND 200),
  file_count integer NOT NULL CHECK(file_count BETWEEN 1 AND 40), input_files jsonb,
  status text NOT NULL CHECK(status IN('pending','processing','ready','failed','canceled')),
  attempts integer NOT NULL DEFAULT 0 CHECK(attempts>=0), available_at timestamptz NOT NULL,
  lease_token uuid, lease_until timestamptz,
  reserved_media_ids uuid[] NOT NULL DEFAULT '{}', pages jsonb NOT NULL DEFAULT '[]',
  warnings jsonb NOT NULL DEFAULT '[]', error jsonb,
  created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL, expires_at timestamptz NOT NULL,
  UNIQUE(workspace_id,presentation_id,request_id), UNIQUE(workspace_id,id),
  FOREIGN KEY(workspace_id,presentation_id) REFERENCES presentations(workspace_id,id) ON DELETE CASCADE,
  CHECK(expires_at>created_at AND expires_at<=created_at+interval '24 hours'),
  CHECK((status='processing')=(lease_token IS NOT NULL AND lease_until IS NOT NULL)),
  CHECK((lease_token IS NULL)=(lease_until IS NULL)),
  CHECK(lease_until IS NULL OR lease_until<=expires_at),
  CHECK((status IN('pending','processing'))=(input_files IS NOT NULL)),
  CHECK(cardinality(reserved_media_ids)<=40),
  CHECK(jsonb_typeof(pages)='array' AND jsonb_array_length(pages)<=40),
  CHECK((status='ready')=(jsonb_array_length(pages)>0)),
  CHECK(jsonb_typeof(warnings)='array' AND jsonb_array_length(warnings)<=40),
  CHECK(error IS NULL OR (jsonb_typeof(error)='object' AND visual_import_utf16_length(error->>'code') BETWEEN 1 AND 80 AND visual_import_utf16_length(error->>'message') BETWEEN 1 AND 300))
);
CREATE INDEX presentation_visual_import_queue ON presentation_visual_imports(available_at,created_at) WHERE status IN('pending','processing');
CREATE INDEX presentation_visual_import_workspace ON presentation_visual_imports(workspace_id,presentation_id,created_at DESC);
CREATE INDEX presentation_visual_import_expiry ON presentation_visual_imports(expires_at);
ALTER TABLE presentation_visual_imports ENABLE ROW LEVEL SECURITY;
ALTER TABLE presentation_visual_imports FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON presentation_visual_imports USING(current_setting('app.system_access',true)='on' OR workspace_id::text=nullif(current_setting('app.workspace_id',true),''))
  WITH CHECK(current_setting('app.system_access',true)='on' OR workspace_id::text=nullif(current_setting('app.workspace_id',true),''));
ALTER TABLE media_references DROP CONSTRAINT media_references_owner_type_check;
ALTER TABLE media_references ADD CONSTRAINT media_references_owner_type_check CHECK(owner_type IN(
  'quiz_draft','quiz_version','quiz_history','presentation_draft','presentation_version','presentation_history','presentation_visual_import',
  'recovery_pack_draft','recovery_pack_version','recovery_pack_history','recovery_pack_mutation','followup','idea_board','canvas_board'));

CREATE FUNCTION guard_presentation_visual_import() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE file jsonb; page jsonb; size bigint; total bigint:=0; pixels bigint:=0; ids uuid[]; item text;
BEGIN
  IF TG_OP='INSERT' THEN
    PERFORM id FROM workspaces WHERE id=NEW.workspace_id AND NOT EXISTS(SELECT 1 FROM workspace_media_deletion_jobs deletion WHERE deletion.workspace_id=workspaces.id) FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Visual import workspace unavailable' USING ERRCODE='23514'; END IF;
    IF NEW.status<>'pending' OR NEW.attempts<>0 OR NEW.lease_token IS NOT NULL OR cardinality(NEW.reserved_media_ids)<>0
      OR (SELECT count(*) FROM presentation_visual_imports WHERE workspace_id=NEW.workspace_id AND status IN('pending','processing') AND expires_at>NEW.created_at)>=3
      OR COALESCE((SELECT used FROM presentation_visual_import_usage WHERE workspace_id=NEW.workspace_id AND day=(NEW.created_at AT TIME ZONE 'UTC')::date),0)>=10 THEN
      RAISE EXCEPTION 'Visual import initial state or capacity invalid' USING ERRCODE='23514';
    END IF;
    INSERT INTO presentation_visual_import_usage(workspace_id,day,used) VALUES(NEW.workspace_id,(NEW.created_at AT TIME ZONE 'UTC')::date,1)
      ON CONFLICT(workspace_id,day) DO UPDATE SET used=presentation_visual_import_usage.used+1;
  ELSE
    IF NEW.id IS DISTINCT FROM OLD.id OR NEW.workspace_id IS DISTINCT FROM OLD.workspace_id OR NEW.presentation_id IS DISTINCT FROM OLD.presentation_id
      OR NEW.request_id IS DISTINCT FROM OLD.request_id OR NEW.request_hash IS DISTINCT FROM OLD.request_hash OR NEW.source_digest IS DISTINCT FROM OLD.source_digest
      OR NEW.source_type IS DISTINCT FROM OLD.source_type OR NEW.source_name IS DISTINCT FROM OLD.source_name OR NEW.file_count IS DISTINCT FROM OLD.file_count
      OR NEW.created_at IS DISTINCT FROM OLD.created_at OR NEW.expires_at IS DISTINCT FROM OLD.expires_at
      OR (NEW.input_files IS NOT NULL AND NEW.input_files IS DISTINCT FROM OLD.input_files) THEN
      RAISE EXCEPTION 'Visual import source identity is immutable' USING ERRCODE='23514';
    END IF;
    IF NEW.status='processing' AND NEW.attempts=OLD.attempts+1 THEN
      IF OLD.status NOT IN('pending','processing') OR OLD.available_at>NEW.updated_at THEN RAISE EXCEPTION 'Visual import claim unavailable' USING ERRCODE='23514'; END IF;
    ELSIF NEW.attempts<>OLD.attempts OR (NEW.status<>OLD.status AND NOT(NEW.status='canceled' OR ((OLD.status='processing' AND NEW.status IN('pending','ready','failed')) OR (OLD.status='pending' AND NEW.status='failed' AND NEW.error->>'code'='ATTEMPT_LIMIT')))) THEN
      RAISE EXCEPTION 'Invalid visual import transition' USING ERRCODE='23514';
    END IF;
    IF OLD.status IN('ready','failed','canceled') AND NEW.status<> 'canceled' AND ROW(NEW.status,NEW.pages,NEW.warnings,NEW.error,NEW.reserved_media_ids) IS DISTINCT FROM ROW(OLD.status,OLD.pages,OLD.warnings,OLD.error,OLD.reserved_media_ids) THEN
      RAISE EXCEPTION 'Completed visual import is immutable' USING ERRCODE='23514';
    END IF;
  END IF;
  IF TG_OP='INSERT' AND NEW.input_files IS NOT NULL THEN
    IF jsonb_typeof(NEW.input_files)<>'array' OR jsonb_array_length(NEW.input_files)<>NEW.file_count OR octet_length(NEW.input_files::text)>28000000 THEN RAISE EXCEPTION 'Invalid visual source files' USING ERRCODE='23514'; END IF;
    FOR file IN SELECT value FROM jsonb_array_elements(NEW.input_files) LOOP
      IF jsonb_typeof(file)<>'object' OR NOT(file ?& ARRAY['name','mimeType','base64']) OR (file-ARRAY['name','mimeType','base64'])<>'{}'::jsonb OR jsonb_typeof(file->'base64') IS DISTINCT FROM 'string' OR file->>'base64' !~ '^[A-Za-z0-9+/]*={0,2}$' OR length(file->>'base64')%4<>0
        OR jsonb_typeof(file->'name') IS DISTINCT FROM 'string' OR jsonb_typeof(file->'mimeType') IS DISTINCT FROM 'string' OR visual_import_utf16_length(file->>'name') NOT BETWEEN 1 AND 200 OR file->>'mimeType' NOT IN('application/pdf','image/png','image/jpeg','image/webp') THEN RAISE EXCEPTION 'Invalid visual source file' USING ERRCODE='23514'; END IF;
      size:=octet_length(decode(file->>'base64','base64')); total:=total+size;
      IF size<1 OR (file->>'mimeType'='application/pdf' AND (NEW.file_count<>1 OR NEW.source_type<>'pdf' OR size>6000000))
        OR (file->>'mimeType'<>'application/pdf' AND (NEW.source_type<>'image_set' OR size>10485760)) THEN RAISE EXCEPTION 'Visual source file limit exceeded' USING ERRCODE='23514'; END IF;
    END LOOP;
    IF total>20000000 THEN RAISE EXCEPTION 'Visual source total limit exceeded' USING ERRCODE='23514'; END IF;
  END IF;
  IF NEW.error IS NOT NULL AND (jsonb_typeof(NEW.error) IS DISTINCT FROM 'object' OR NOT(NEW.error ?& ARRAY['code','message']) OR (NEW.error-ARRAY['code','message'])<>'{}'::jsonb OR jsonb_typeof(NEW.error->'code') IS DISTINCT FROM 'string' OR jsonb_typeof(NEW.error->'message') IS DISTINCT FROM 'string') THEN RAISE EXCEPTION 'Invalid conversion error metadata' USING ERRCODE='23514'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.warnings) warning WHERE jsonb_typeof(warning) IS DISTINCT FROM 'string') THEN RAISE EXCEPTION 'Invalid conversion warning' USING ERRCODE='23514'; END IF;
  FOR item IN SELECT value FROM jsonb_array_elements_text(NEW.warnings) LOOP IF visual_import_utf16_length(item) NOT BETWEEN 1 AND 300 THEN RAISE EXCEPTION 'Invalid conversion warning' USING ERRCODE='23514'; END IF; END LOOP;
  IF NEW.status='ready' THEN
    ids:='{}';
    FOR page IN SELECT value FROM jsonb_array_elements(NEW.pages) LOOP
      IF jsonb_typeof(page)<>'object' OR NOT(page ?& ARRAY['pageNumber','mediaId','width','height','extractedText','warnings']) OR (page - ARRAY['pageNumber','mediaId','width','height','extractedText','warnings'])<>'{}'::jsonb OR jsonb_typeof(page->'pageNumber') IS DISTINCT FROM 'number' OR jsonb_typeof(page->'width') IS DISTINCT FROM 'number' OR jsonb_typeof(page->'height') IS DISTINCT FROM 'number' OR (page->>'pageNumber')!~'^[1-9][0-9]?$' OR (page->>'pageNumber')::integer>40
        OR (page->>'width')!~'^[1-9][0-9]{0,3}$' OR (page->>'width')::integer>1600 OR (page->>'height')!~'^[1-9][0-9]{0,3}$' OR (page->>'height')::integer>1600
        OR jsonb_typeof(page->'extractedText') IS DISTINCT FROM 'string' OR visual_import_utf16_length(page->>'extractedText')>6000
        OR jsonb_typeof(page->'warnings') IS DISTINCT FROM 'array' OR jsonb_array_length(page->'warnings')>10
        OR (page->>'mediaId')!~*'^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' THEN RAISE EXCEPTION 'Invalid converted page manifest' USING ERRCODE='23514'; END IF;
      IF EXISTS(SELECT 1 FROM jsonb_array_elements(page->'warnings') warning WHERE jsonb_typeof(warning) IS DISTINCT FROM 'string' OR visual_import_utf16_length(warning#>>'{}') NOT BETWEEN 1 AND 300) THEN RAISE EXCEPTION 'Invalid page warning' USING ERRCODE='23514'; END IF;
      pixels:=pixels+(page->>'width')::integer*(page->>'height')::integer;
      IF (page->>'width')::integer*(page->>'height')::integer>2000000 OR pixels>60000000 THEN RAISE EXCEPTION 'Converted page pixel budget exceeded' USING ERRCODE='23514'; END IF;
      ids:=array_append(ids,(page->>'mediaId')::uuid);
    END LOOP;
    IF cardinality(ids)<>cardinality(NEW.reserved_media_ids) OR NOT(ids @> NEW.reserved_media_ids AND ids <@ NEW.reserved_media_ids)
      OR (SELECT count(DISTINCT manifest_page->>'pageNumber') FROM jsonb_array_elements(NEW.pages) manifest_page)<>cardinality(ids)
      OR (SELECT count(DISTINCT requested.media_id) FROM unnest(ids) requested(media_id))<>cardinality(ids)
      OR EXISTS(SELECT 1 FROM unnest(ids) requested(media_id) WHERE NOT EXISTS(SELECT 1 FROM media_assets asset JOIN media_references reference ON reference.workspace_id=asset.workspace_id AND reference.media_id=asset.id
        WHERE asset.workspace_id=NEW.workspace_id AND asset.id=requested.media_id AND asset.scan_status='clean' AND reference.owner_type='presentation_visual_import' AND reference.owner_id=NEW.id)) THEN RAISE EXCEPTION 'Visual pages require owned clean assets' USING ERRCODE='23514'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER presentation_visual_import_guard BEFORE INSERT OR UPDATE ON presentation_visual_imports FOR EACH ROW EXECUTE FUNCTION guard_presentation_visual_import();
CREATE FUNCTION guard_visual_import_media_reference() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  IF NEW.owner_type='presentation_visual_import' AND NOT EXISTS(SELECT 1 FROM presentation_visual_imports WHERE workspace_id=NEW.workspace_id AND id=NEW.owner_id AND status IN('processing','ready')) THEN RAISE EXCEPTION 'Visual media requires its active import owner' USING ERRCODE='23503'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER visual_import_media_reference_guard BEFORE INSERT OR UPDATE ON media_references FOR EACH ROW EXECUTE FUNCTION guard_visual_import_media_reference();
CREATE FUNCTION cleanup_visual_import_media() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  DELETE FROM media_references WHERE workspace_id=OLD.workspace_id AND owner_type='presentation_visual_import' AND owner_id=OLD.id; RETURN OLD;
END $$;
CREATE TRIGGER cleanup_visual_import_media AFTER DELETE ON presentation_visual_imports FOR EACH ROW EXECUTE FUNCTION cleanup_visual_import_media();
CREATE FUNCTION cleanup_visual_import_workspace() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  DELETE FROM presentation_visual_imports WHERE workspace_id=OLD.id; RETURN OLD;
END $$;
CREATE TRIGGER cleanup_visual_import_workspace BEFORE DELETE ON workspaces FOR EACH ROW EXECUTE FUNCTION cleanup_visual_import_workspace();
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='openround_runtime') THEN GRANT SELECT,INSERT,UPDATE,DELETE ON presentation_visual_imports,presentation_visual_import_usage TO openround_runtime; END IF; END $$;
