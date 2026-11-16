-- Separate content-only presentation proposals leave the legacy AuthoringDraft v1 queue unchanged.
-- Compact admissions deliberately have no deck/job/actor FK: private data erasure cannot reset use
-- or resurrect an erased client request identity. Whole-workspace erasure cascades both tables.
CREATE TABLE authoring_admission_receipts (
 workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
 kind text NOT NULL CHECK(kind IN('legacy','presentation')), job_id uuid NOT NULL,
 created_at timestamptz NOT NULL CHECK(isfinite(created_at)),
 PRIMARY KEY(workspace_id,kind,job_id)
);
CREATE INDEX authoring_admission_month ON authoring_admission_receipts(workspace_id,created_at);
INSERT INTO authoring_admission_receipts(workspace_id,kind,job_id,created_at)
 SELECT workspace_id,'legacy',id,created_at FROM authoring_jobs;
ALTER TABLE authoring_admission_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE authoring_admission_receipts FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON authoring_admission_receipts
 USING(current_setting('app.system_access',true)='on' OR workspace_id::text=nullif(current_setting('app.workspace_id',true),''))
 WITH CHECK(current_setting('app.system_access',true)='on' OR workspace_id::text=nullif(current_setting('app.workspace_id',true),''));
CREATE FUNCTION record_legacy_authoring_admission() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 INSERT INTO authoring_admission_receipts(workspace_id,kind,job_id,created_at) VALUES(NEW.workspace_id,'legacy',NEW.id,NEW.created_at);
 RETURN NEW;
END $$;
CREATE TRIGGER record_legacy_authoring_admission AFTER INSERT ON authoring_jobs FOR EACH ROW EXECUTE FUNCTION record_legacy_authoring_admission();

CREATE TABLE presentation_assistance_jobs (
 id uuid PRIMARY KEY, workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
 presentation_id uuid NOT NULL, created_by uuid REFERENCES users(id) ON DELETE SET NULL,
 request_hash text NOT NULL CHECK(request_hash~'^[a-f0-9]{64}$'), source_digest text NOT NULL CHECK(source_digest~'^[a-f0-9]{64}$'),
 source_name text NOT NULL CHECK(visual_import_utf16_length(source_name) BETWEEN 1 AND 160),
 slide_count integer NOT NULL CHECK(slide_count BETWEEN 3 AND 8),
 outline text CHECK(outline IS NULL OR visual_import_utf16_length(outline) BETWEEN 50 AND 12000),
 status text NOT NULL CHECK(status IN('pending','processing','ready','failed','expired')),
 attempts integer NOT NULL CHECK(attempts BETWEEN 0 AND 3), available_at timestamptz NOT NULL CHECK(isfinite(available_at)),
 lease_token uuid, lease_until timestamptz, proposal jsonb, proposal_hash text CHECK(proposal_hash IS NULL OR proposal_hash~'^[a-f0-9]{64}$'),
 error_code text CHECK(error_code IS NULL OR error_code IN('PROVIDER_UNAVAILABLE','INVALID_OUTPUT','SOURCE_UNAVAILABLE','EXPIRED','ATTEMPTS_EXHAUSTED')),
 created_at timestamptz NOT NULL CHECK(isfinite(created_at)), updated_at timestamptz NOT NULL CHECK(isfinite(updated_at)),
 expires_at timestamptz NOT NULL CHECK(isfinite(expires_at)),
 FOREIGN KEY(workspace_id,presentation_id) REFERENCES presentations(workspace_id,id) ON DELETE CASCADE,
 CHECK(expires_at>created_at AND expires_at<=created_at+interval '24 hours'),
 CHECK((status='processing')=(lease_token IS NOT NULL AND lease_until IS NOT NULL)),
 CHECK((lease_token IS NULL)=(lease_until IS NULL)), CHECK(lease_until IS NULL OR (isfinite(lease_until) AND lease_until<=expires_at AND lease_until>updated_at)),
 CHECK((status IN('pending','processing'))=(outline IS NOT NULL)),
 CHECK((status='ready')=(proposal IS NOT NULL AND proposal_hash IS NOT NULL)),
 CHECK((proposal IS NULL)=(proposal_hash IS NULL)),
 CHECK((status='expired')=(error_code='EXPIRED')),
 CHECK(status NOT IN('failed','expired') OR error_code IS NOT NULL),
 CHECK(status NOT IN('processing','ready') OR error_code IS NULL),
 CHECK(status NOT IN('pending','processing') OR created_by IS NOT NULL)
);
CREATE INDEX presentation_assistance_queue ON presentation_assistance_jobs(available_at,created_at) WHERE status IN('pending','processing');
CREATE INDEX presentation_assistance_workspace ON presentation_assistance_jobs(workspace_id,presentation_id,created_at DESC);
CREATE INDEX presentation_assistance_expiry ON presentation_assistance_jobs(expires_at) WHERE status<>'expired';
ALTER TABLE presentation_assistance_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE presentation_assistance_jobs FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON presentation_assistance_jobs
 USING(current_setting('app.system_access',true)='on' OR workspace_id::text=nullif(current_setting('app.workspace_id',true),''))
 WITH CHECK(current_setting('app.system_access',true)='on' OR workspace_id::text=nullif(current_setting('app.workspace_id',true),''));

CREATE FUNCTION valid_presentation_assistance_proposal(proposal jsonb, source_name text, source_digest text, slide_count integer) RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE slide jsonb; citation jsonb; slide_id text; ids text[]:='{}';
BEGIN
 IF jsonb_typeof(proposal) IS DISTINCT FROM 'object' OR NOT(proposal ?& ARRAY['schemaVersion','sourceName','sourceDigest','slides','generatedAt','provider','model','reviewWarning'])
   OR (proposal-ARRAY['schemaVersion','sourceName','sourceDigest','slides','generatedAt','provider','model','reviewWarning'])<>'{}'::jsonb
   OR proposal->'schemaVersion'<>'1'::jsonb OR proposal->>'sourceName' IS DISTINCT FROM source_name OR proposal->>'sourceDigest' IS DISTINCT FROM source_digest
   OR jsonb_typeof(proposal->'slides') IS DISTINCT FROM 'array' OR jsonb_array_length(proposal->'slides')<>slide_count
   OR jsonb_typeof(proposal->'provider') IS DISTINCT FROM 'string' OR visual_import_utf16_length(btrim(proposal->>'provider')) NOT BETWEEN 1 AND 80
   OR jsonb_typeof(proposal->'model') IS DISTINCT FROM 'string' OR visual_import_utf16_length(btrim(proposal->>'model')) NOT BETWEEN 1 AND 120
   OR jsonb_typeof(proposal->'generatedAt') IS DISTINCT FROM 'string' OR NOT isfinite((proposal->>'generatedAt')::timestamptz)
   OR proposal->>'reviewWarning' IS DISTINCT FROM 'AI-generated draft. Claims are unverified; review every slide and exact source citation before inserting.' THEN RETURN false; END IF;
 FOR slide IN SELECT value FROM jsonb_array_elements(proposal->'slides') LOOP
  slide_id:=slide->>'id';
  IF jsonb_typeof(slide) IS DISTINCT FROM 'object' OR NOT(slide ?& ARRAY['id','title','body','citations']) OR (slide-ARRAY['id','title','body','citations'])<>'{}'::jsonb
    OR jsonb_typeof(slide->'id') IS DISTINCT FROM 'string' OR NOT openround_presentation_uuid_equal(slide_id,slide_id) OR slide_id=ANY(ids)
    OR jsonb_typeof(slide->'title') IS DISTINCT FROM 'string' OR visual_import_utf16_length(btrim(slide->>'title')) NOT BETWEEN 1 AND 160
    OR jsonb_typeof(slide->'body') IS DISTINCT FROM 'string' OR visual_import_utf16_length(btrim(slide->>'body')) NOT BETWEEN 1 AND 2000
    OR jsonb_typeof(slide->'citations') IS DISTINCT FROM 'array' OR jsonb_array_length(slide->'citations') NOT BETWEEN 1 AND 4 THEN RETURN false; END IF;
  ids:=array_append(ids,slide_id);
  FOR citation IN SELECT value FROM jsonb_array_elements(slide->'citations') LOOP
   IF jsonb_typeof(citation) IS DISTINCT FROM 'object' OR NOT(citation ?& ARRAY['locator','excerpt']) OR (citation-ARRAY['locator','excerpt'])<>'{}'::jsonb
     OR jsonb_typeof(citation->'locator') IS DISTINCT FROM 'string' OR visual_import_utf16_length(btrim(citation->>'locator')) NOT BETWEEN 1 AND 120
     OR jsonb_typeof(citation->'excerpt') IS DISTINCT FROM 'string' OR visual_import_utf16_length(btrim(citation->>'excerpt')) NOT BETWEEN 1 AND 500 THEN RETURN false; END IF;
  END LOOP;
 END LOOP;
 RETURN octet_length(proposal::text)<=100000;
EXCEPTION WHEN OTHERS THEN RETURN false;
END $$;
ALTER TABLE presentation_assistance_jobs ADD CHECK(proposal IS NULL OR valid_presentation_assistance_proposal(proposal,source_name,source_digest,slide_count));
-- This boolean integrity check exposes no identity rows and cannot change tenant scope.
-- Users have system-only RLS; the outer INSERT and all job/deck access retain workspace RLS.
CREATE FUNCTION presentation_assistance_author_active(target_workspace uuid, target_actor uuid)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
 SET search_path=pg_catalog,public SET app.system_access='on' AS $$
 SELECT COALESCE(target_workspace::text=nullif(current_setting('app.workspace_id',true),''),false)
  AND EXISTS(SELECT 1 FROM workspace_members member JOIN users actor ON actor.id=member.user_id
  WHERE member.workspace_id=target_workspace AND member.user_id=target_actor
   AND member.role IN('owner','editor') AND actor.deleted_at IS NULL)
$$;
REVOKE ALL ON FUNCTION presentation_assistance_author_active(uuid,uuid) FROM PUBLIC;
CREATE FUNCTION guard_presentation_assistance_job() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE citation jsonb; line_number integer; source_line text;
BEGIN
 IF TG_OP='INSERT' THEN
  PERFORM id FROM workspaces WHERE id=NEW.workspace_id AND NOT EXISTS(SELECT 1 FROM workspace_media_deletion_jobs deletion WHERE deletion.workspace_id=workspaces.id) FOR UPDATE;
  IF NOT FOUND OR NEW.status<>'pending' OR NEW.attempts<>0 OR NEW.error_code IS NOT NULL THEN RAISE EXCEPTION 'Invalid assistance initial state' USING ERRCODE='23514'; END IF;
  IF NOT presentation_assistance_author_active(NEW.workspace_id,NEW.created_by) THEN RAISE EXCEPTION 'Assistance author unavailable' USING ERRCODE='23514'; END IF;
  PERFORM id FROM presentations WHERE workspace_id=NEW.workspace_id AND id=NEW.presentation_id AND status<>'archived';
  IF NOT FOUND OR (SELECT count(*) FROM presentation_assistance_jobs WHERE workspace_id=NEW.workspace_id AND status IN('pending','processing') AND expires_at>NEW.created_at)>=2 THEN RAISE EXCEPTION 'Assistance source or capacity unavailable' USING ERRCODE='23514'; END IF;
  INSERT INTO authoring_admission_receipts(workspace_id,kind,job_id,created_at) VALUES(NEW.workspace_id,'presentation',NEW.id,NEW.created_at);
 ELSE
  IF ROW(NEW.id,NEW.workspace_id,NEW.presentation_id,NEW.request_hash,NEW.source_digest,NEW.slide_count,NEW.created_at,NEW.expires_at) IS DISTINCT FROM ROW(OLD.id,OLD.workspace_id,OLD.presentation_id,OLD.request_hash,OLD.source_digest,OLD.slide_count,OLD.created_at,OLD.expires_at)
    OR (NEW.outline IS NOT NULL AND NEW.outline IS DISTINCT FROM OLD.outline)
    OR (NEW.created_by IS NOT NULL AND NEW.created_by IS DISTINCT FROM OLD.created_by)
    OR (NEW.source_name IS DISTINCT FROM OLD.source_name AND NOT(NEW.created_by IS NULL AND NEW.source_name='Erased outline' AND NEW.outline IS NULL AND (NEW.status='expired' OR NEW.error_code='SOURCE_UNAVAILABLE'))) THEN RAISE EXCEPTION 'Assistance source identity is immutable' USING ERRCODE='23514'; END IF;
  IF NEW.status='processing' AND NEW.attempts=OLD.attempts+1 THEN
   IF OLD.status NOT IN('pending','processing') OR OLD.available_at>NEW.updated_at OR (OLD.lease_until IS NOT NULL AND OLD.lease_until>NEW.updated_at) THEN RAISE EXCEPTION 'Assistance claim unavailable' USING ERRCODE='23514'; END IF;
  ELSIF NEW.attempts<>OLD.attempts THEN RAISE EXCEPTION 'Assistance attempts are monotonic' USING ERRCODE='23514'; END IF;
  IF NEW.status='expired' THEN
   IF NEW.expires_at>NEW.updated_at OR NEW.source_name<>'Erased outline' OR NEW.created_by IS NOT NULL THEN RAISE EXCEPTION 'Assistance has not expired' USING ERRCODE='23514'; END IF;
  ELSIF NEW.error_code='SOURCE_UNAVAILABLE' AND NEW.status='failed' THEN
   IF NEW.outline IS NOT NULL OR NEW.proposal IS NOT NULL THEN RAISE EXCEPTION 'Unavailable source must be erased' USING ERRCODE='23514'; END IF;
  ELSIF NEW.status<>OLD.status AND NOT(
    (NEW.status='processing' AND OLD.status IN('pending','processing') AND NEW.attempts=OLD.attempts+1)
    OR (OLD.status='processing' AND NEW.status IN('pending','ready','failed'))
    OR (OLD.status='pending' AND NEW.status='failed' AND NEW.error_code='ATTEMPTS_EXHAUSTED')) THEN RAISE EXCEPTION 'Invalid assistance transition' USING ERRCODE='23514'; END IF;
  IF NEW.status='ready' AND OLD.status<>'ready' THEN
   IF OLD.status<>'processing' OR OLD.lease_until<=NEW.updated_at OR OLD.expires_at<=NEW.updated_at THEN RAISE EXCEPTION 'Assistance completion lease expired' USING ERRCODE='23514'; END IF;
   FOR citation IN SELECT cited.value FROM jsonb_array_elements(NEW.proposal->'slides') AS slide(value) CROSS JOIN LATERAL jsonb_array_elements(slide.value->'citations') AS cited(value) LOOP
    line_number:=substring(citation->>'locator' FROM '^outline line ([1-9][0-9]*)$')::integer;
    source_line:=(string_to_array(OLD.outline,E'\n'))[line_number];
    IF line_number IS NULL OR source_line IS NULL OR strpos(btrim(source_line),citation->>'excerpt')=0 THEN RAISE EXCEPTION 'Assistance citation is not exact source text' USING ERRCODE='23514'; END IF;
   END LOOP;
  ELSIF OLD.status='ready' AND NEW.status='ready' AND ROW(NEW.proposal,NEW.proposal_hash) IS DISTINCT FROM ROW(OLD.proposal,OLD.proposal_hash) THEN RAISE EXCEPTION 'Completed assistance is immutable' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER guard_presentation_assistance_job BEFORE INSERT OR UPDATE ON presentation_assistance_jobs FOR EACH ROW EXECUTE FUNCTION guard_presentation_assistance_job();
CREATE FUNCTION erase_expired_presentation_assistance(moment timestamptz) RETURNS TABLE(id uuid) LANGUAGE sql AS $$
 UPDATE presentation_assistance_jobs SET status='expired',outline=NULL,proposal=NULL,proposal_hash=NULL,source_name='Erased outline',created_by=NULL,lease_token=NULL,lease_until=NULL,error_code='EXPIRED',updated_at=moment WHERE expires_at<=moment AND status<>'expired' RETURNING id
$$;
CREATE FUNCTION erase_actor_presentation_assistance() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
 SET search_path=pg_catalog,public SET app.system_access='on' AS $$
BEGIN
 IF NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL THEN
  UPDATE presentation_assistance_jobs SET status='failed',outline=NULL,proposal=NULL,proposal_hash=NULL,source_name='Erased outline',created_by=NULL,lease_token=NULL,lease_until=NULL,error_code='SOURCE_UNAVAILABLE',updated_at=now() WHERE created_by=NEW.id AND status<>'expired';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER erase_actor_presentation_assistance AFTER UPDATE OF deleted_at ON users FOR EACH ROW EXECUTE FUNCTION erase_actor_presentation_assistance();
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='openround_runtime') THEN
 GRANT SELECT,INSERT,UPDATE,DELETE ON authoring_admission_receipts,presentation_assistance_jobs TO openround_runtime;
 GRANT EXECUTE ON FUNCTION presentation_assistance_author_active(uuid,uuid) TO openround_runtime;
END IF; END $$;
