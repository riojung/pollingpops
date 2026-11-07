-- Private reviewed question suggestions. Existing document, scene and job wire formats are unchanged.
CREATE FUNCTION openround_question_suggestions_trim(value text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
 SELECT btrim(value,U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF')
$$;

CREATE FUNCTION openround_question_suggestions_source_json(source jsonb) RETURNS text LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE body jsonb; paragraph jsonb; bodies text:=''; paragraphs text; ordering text;
BEGIN
 FOR body IN SELECT value FROM jsonb_array_elements(source->'body') LOOP
  paragraphs:='';
  FOR paragraph IN SELECT value FROM jsonb_array_elements(body->'paragraphs') LOOP
   paragraphs:=paragraphs||CASE WHEN paragraphs='' THEN '' ELSE ',' END||'{"kind":'||(paragraph->'kind')::text||',"text":'||(paragraph->'text')::text||'}';
  END LOOP;
  bodies:=bodies||CASE WHEN bodies='' THEN '' ELSE ',' END||'{"nodeId":'||(body->'nodeId')::text||',"text":'||(body->'text')::text||',"lang":'||(body->'lang')::text||',"paragraphs":['||paragraphs||']}';
 END LOOP;
 SELECT string_agg(value::text,',' ORDER BY ordinality) INTO ordering FROM jsonb_array_elements(source->'readingOrder') WITH ORDINALITY;
 RETURN '{"blockId":'||(source->'blockId')::text||',"title":{"nodeId":'||(source->'title'->'nodeId')::text||',"text":'||(source->'title'->'text')::text||',"lang":'||(source->'title'->'lang')::text||'},"body":['||bodies||'],"readingOrder":['||COALESCE(ordering,'')||']}';
END $$;

CREATE FUNCTION openround_question_suggestions_source_valid(source jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE node jsonb; paragraph jsonb; ids text[]:='{}'; ordering text[]; total integer:=0; joined text; plain jsonb;
BEGIN
 IF jsonb_typeof(source) IS DISTINCT FROM 'object' OR NOT(source ?& ARRAY['blockId','title','body','readingOrder']) OR source-ARRAY['blockId','title','body','readingOrder']<>'{}'::jsonb
  OR jsonb_typeof(source->'blockId') IS DISTINCT FROM 'string' OR NOT COALESCE(openround_presentation_uuid_equal(source->>'blockId',source->>'blockId'),false) OR source->>'blockId'<>lower(source->>'blockId')
  OR jsonb_typeof(source->'body') IS DISTINCT FROM 'array' OR jsonb_array_length(source->'body') NOT BETWEEN 1 AND 8
  OR jsonb_typeof(source->'readingOrder') IS DISTINCT FROM 'array' OR jsonb_array_length(source->'readingOrder') NOT BETWEEN 2 AND 50 THEN RETURN false; END IF;
 FOR node IN SELECT source->'title' UNION ALL SELECT value FROM jsonb_array_elements(source->'body') LOOP
  IF jsonb_typeof(node) IS DISTINCT FROM 'object' OR NOT(node ?& ARRAY['nodeId','text','lang'])
   OR (node-ARRAY['nodeId','text','lang','paragraphs'])<>'{}'::jsonb
   OR openround_presentation_plain_text_valid(node->'nodeId',200,true,true) IS NOT TRUE OR visual_import_utf16_length(node->>'nodeId')>200
   OR openround_presentation_plain_text_valid(node->'text',CASE WHEN node=source->'title' THEN 160 ELSE 4000 END,true) IS NOT TRUE OR visual_import_utf16_length(node->>'text')>(CASE WHEN node=source->'title' THEN 160 ELSE 4000 END)
   OR NOT(node->'lang'='null'::jsonb OR COALESCE(openround_presentation_text_language_valid(node->'lang'),false)) OR node->>'nodeId'=ANY(ids) THEN RETURN false; END IF;
  ids:=array_append(ids,node->>'nodeId');
 END LOOP;
 IF source->'title' ? 'paragraphs' THEN RETURN false; END IF;
 FOR node IN SELECT value FROM jsonb_array_elements(source->'body') LOOP
  total:=total+visual_import_utf16_length(node->>'text');
  IF jsonb_typeof(node->'paragraphs') IS DISTINCT FROM 'array' OR jsonb_array_length(node->'paragraphs') NOT BETWEEN 1 AND 4001 THEN RETURN false; END IF;
  FOR paragraph IN SELECT value FROM jsonb_array_elements(node->'paragraphs') LOOP
   IF jsonb_typeof(paragraph) IS DISTINCT FROM 'object' OR NOT(paragraph ?& ARRAY['kind','text']) OR paragraph-ARRAY['kind','text']<>'{}'::jsonb
    OR jsonb_typeof(paragraph->'kind') IS DISTINCT FROM 'string' OR paragraph->>'kind' NOT IN('paragraph','bullet','numbered') OR openround_presentation_plain_text_valid(paragraph->'text',4000,false) IS NOT TRUE OR visual_import_utf16_length(paragraph->>'text')>4000 THEN RETURN false; END IF;
  END LOOP;
  SELECT string_agg(value->>'text',E'\n' ORDER BY ordinality) INTO joined FROM jsonb_array_elements(node->'paragraphs') WITH ORDINALITY;
  SELECT jsonb_agg(jsonb_build_object('kind','paragraph','text',value) ORDER BY ordinality) INTO plain FROM unnest(regexp_split_to_array(node->>'text',E'\r\n?|\n')) WITH ORDINALITY AS part(value,ordinality);
  IF joined IS DISTINCT FROM node->>'text' AND node->'paragraphs' IS DISTINCT FROM plain THEN RETURN false; END IF;
 END LOOP;
 IF total>4000 THEN RETURN false; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(source->'readingOrder') value WHERE openround_presentation_plain_text_valid(value,200,true,true) IS NOT TRUE OR visual_import_utf16_length(value#>>'{}')>200) THEN RETURN false; END IF;
 SELECT array_agg(value ORDER BY ordinality) INTO ordering FROM jsonb_array_elements_text(source->'readingOrder') WITH ORDINALITY;
 IF cardinality(ordering)<>(SELECT count(DISTINCT value) FROM unnest(ordering) value) OR NOT(ids<@ordering)
  OR ids[2:cardinality(ids)] IS DISTINCT FROM ARRAY(SELECT value FROM unnest(ordering) value WHERE value=ANY(ids[2:cardinality(ids)])) THEN RETURN false; END IF;
 RETURN true;
EXCEPTION WHEN OTHERS THEN RETURN false;
END $$;

-- The saved native scene, not caller-supplied text, is authoritative. Links, marks, notes and other nodes are excluded.
CREATE FUNCTION openround_question_suggestions_source(block jsonb) RETURNS jsonb LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE node jsonb; title jsonb; bodies jsonb:='[]'; paragraphs jsonb; projection jsonb; visible jsonb; scene jsonb:=block->'scene';
BEGIN
 IF block->>'kind' IS DISTINCT FROM 'content' OR COALESCE((block->>'hidden')::boolean,false)
  OR scene->'schemaVersion' NOT IN('1'::jsonb,'2'::jsonb,'3'::jsonb,'4'::jsonb,'5'::jsonb,'6'::jsonb,'7'::jsonb) OR NOT (CASE WHEN (scene->>'schemaVersion')::integer>=6 THEN openround_presentation_advanced_scene_valid(scene,false) ELSE openround_presentation_interaction_scene_valid(scene||'{"schemaVersion":5}'::jsonb,false) END) OR block->'textElements' IS DISTINCT FROM '[]'::jsonb OR block->'mediaId' IS DISTINCT FROM 'null'::jsonb OR block->'mediaAlt' IS DISTINCT FROM 'null'::jsonb THEN RETURN NULL; END IF;
 FOR node IN SELECT candidate FROM jsonb_array_elements_text(scene->'readingOrder') WITH ORDINALITY ordering(id,position)
   JOIN LATERAL (SELECT value AS candidate FROM jsonb_array_elements(scene->'nodes') WHERE value->>'id'=ordering.id AND value->>'type'='text') selected ON true ORDER BY ordering.position LOOP
  visible:=jsonb_build_object('nodeId',node->'id','text',node->'text','lang',COALESCE(node->'lang','null'::jsonb));
  IF node->>'role'='title' AND title IS NULL THEN title:=visible;
  ELSIF node->>'role'='body' THEN
   IF node ? 'richText' THEN
    SELECT jsonb_agg(jsonb_build_object('kind',paragraph->'kind','text',(SELECT string_agg(run->>'text','' ORDER BY run_position) FROM jsonb_array_elements(paragraph->'runs') WITH ORDINALITY runs(run,run_position))) ORDER BY position) INTO paragraphs FROM jsonb_array_elements(node->'richText'->'paragraphs') WITH ORDINALITY part(paragraph,position);
   ELSE
    SELECT jsonb_agg(jsonb_build_object('kind','paragraph','text',value) ORDER BY ordinality) INTO paragraphs FROM unnest(regexp_split_to_array(node->>'text',E'\r\n?|\n')) WITH ORDINALITY part(value,ordinality);
   END IF;
   bodies:=bodies||jsonb_build_array(visible||jsonb_build_object('paragraphs',paragraphs));
  END IF;
 END LOOP;
 projection:=jsonb_build_object('blockId',lower(block->>'id'),'title',title,'body',bodies,'readingOrder',scene->'readingOrder');
 IF NOT openround_question_suggestions_source_valid(projection) THEN RETURN NULL; END IF;
 RETURN projection;
EXCEPTION WHEN OTHERS THEN RETURN NULL;
END $$;

CREATE FUNCTION openround_question_suggestions_proposal_json(proposal jsonb) RETURNS text LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE suggestion jsonb; citation jsonb; suggestions text:=''; citations text;
BEGIN
 FOR suggestion IN SELECT value FROM jsonb_array_elements(proposal->'suggestions') LOOP
  citations:='';
  FOR citation IN SELECT value FROM jsonb_array_elements(suggestion->'citations') LOOP
   citations:=citations||CASE WHEN citations='' THEN '' ELSE ',' END||'{"locator":'||(citation->'locator')::text||',"excerpt":'||(citation->'excerpt')::text||'}';
  END LOOP;
  suggestions:=suggestions||CASE WHEN suggestions='' THEN '' ELSE ',' END||'{"id":'||(suggestion->'id')::text||',"kind":'||(suggestion->'kind')::text||',"type":"open_text","prompt":'||(suggestion->'prompt')::text||',"citations":['||citations||']}';
 END LOOP;
 RETURN '{"schemaVersion":1,"blockId":'||(proposal->'blockId')::text||',"source":'||openround_question_suggestions_source_json(proposal->'source')||',"sourceDigest":'||(proposal->'sourceDigest')::text||',"outputLanguage":"en","suggestions":['||suggestions||'],"provider":'||(proposal->'provider')::text||',"model":'||(proposal->'model')::text||',"generatedAt":'||(proposal->'generatedAt')::text||',"reviewWarning":'||(proposal->'reviewWarning')::text||'}';
END $$;

CREATE FUNCTION openround_question_suggestions_proposal_valid(proposal jsonb,target_block uuid,source_digest text) RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE suggestion jsonb; citation jsonb; section_text text; body_index integer; paragraph_index integer; body_cited boolean; ids text[]:='{}'; prompts text[]:='{}'; position integer:=0;
BEGIN
 IF jsonb_typeof(proposal) IS DISTINCT FROM 'object' OR NOT(proposal ?& ARRAY['schemaVersion','blockId','source','sourceDigest','outputLanguage','suggestions','provider','model','generatedAt','reviewWarning'])
  OR proposal-ARRAY['schemaVersion','blockId','source','sourceDigest','outputLanguage','suggestions','provider','model','generatedAt','reviewWarning']<>'{}'::jsonb
  OR proposal->'schemaVersion' IS DISTINCT FROM '1'::jsonb OR proposal->>'blockId' IS DISTINCT FROM target_block::text OR proposal->'blockId' IS DISTINCT FROM proposal->'source'->'blockId'
  OR proposal->>'sourceDigest' IS DISTINCT FROM source_digest OR NOT openround_question_suggestions_source_valid(proposal->'source')
  OR encode(sha256(convert_to(openround_question_suggestions_source_json(proposal->'source'),'UTF8')),'hex') IS DISTINCT FROM source_digest OR proposal->>'outputLanguage' IS DISTINCT FROM 'en'
  OR openround_presentation_plain_text_valid(proposal->'provider',80,true) IS NOT TRUE OR visual_import_utf16_length(proposal->>'provider')>80 OR proposal->>'provider'<>openround_question_suggestions_trim(proposal->>'provider')
  OR openround_presentation_plain_text_valid(proposal->'model',120,true) IS NOT TRUE OR visual_import_utf16_length(proposal->>'model')>120 OR proposal->>'model'<>openround_question_suggestions_trim(proposal->>'model')
  OR jsonb_typeof(proposal->'generatedAt') IS DISTINCT FROM 'string' OR proposal->>'generatedAt' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]+)?Z$' OR NOT isfinite((proposal->>'generatedAt')::timestamptz)
  OR proposal->>'reviewWarning' IS DISTINCT FROM 'AI-generated questions are unverified. Exact citations identify source wording and do not verify the suggested framing or claims. Review both questions before inserting one.'
  OR jsonb_typeof(proposal->'suggestions') IS DISTINCT FROM 'array' OR jsonb_array_length(proposal->'suggestions')<>2 THEN RETURN false; END IF;
 FOR suggestion IN SELECT value FROM jsonb_array_elements(proposal->'suggestions') LOOP
  position:=position+1; body_cited:=false;
  IF jsonb_typeof(suggestion) IS DISTINCT FROM 'object' OR NOT(suggestion ?& ARRAY['id','kind','type','prompt','citations']) OR suggestion-ARRAY['id','kind','type','prompt','citations']<>'{}'::jsonb
   OR NOT COALESCE(openround_presentation_uuid_equal(suggestion->>'id',suggestion->>'id'),false) OR suggestion->>'id'<>lower(suggestion->>'id') OR suggestion->>'id'=ANY(ids)
   OR suggestion->>'kind' IS DISTINCT FROM (CASE WHEN position=1 THEN 'discussion' ELSE 'reflection' END) OR suggestion->>'type' IS DISTINCT FROM 'open_text'
   OR openround_presentation_plain_text_valid(suggestion->'prompt',500,true) IS NOT TRUE OR visual_import_utf16_length(suggestion->>'prompt')>500 OR suggestion->>'prompt'<>openround_question_suggestions_trim(suggestion->>'prompt')
   OR lower(regexp_replace(normalize(suggestion->>'prompt',NFKC),'\s+',' ','g'))=ANY(prompts)
   OR jsonb_typeof(suggestion->'citations') IS DISTINCT FROM 'array' OR jsonb_array_length(suggestion->'citations') NOT BETWEEN 1 AND 4 THEN RETURN false; END IF;
  ids:=array_append(ids,suggestion->>'id'); prompts:=array_append(prompts,lower(regexp_replace(normalize(suggestion->>'prompt',NFKC),'\s+',' ','g')));
  FOR citation IN SELECT value FROM jsonb_array_elements(suggestion->'citations') LOOP
   IF jsonb_typeof(citation) IS DISTINCT FROM 'object' OR NOT(citation ?& ARRAY['locator','excerpt']) OR citation-ARRAY['locator','excerpt']<>'{}'::jsonb
    OR openround_presentation_plain_text_valid(citation->'locator',120,true) IS NOT TRUE OR visual_import_utf16_length(citation->>'locator')>120 OR citation->>'locator'<>openround_question_suggestions_trim(citation->>'locator')
    OR openround_presentation_plain_text_valid(citation->'excerpt',500,true) IS NOT TRUE OR visual_import_utf16_length(citation->>'excerpt')>500 OR citation->>'excerpt'<>openround_question_suggestions_trim(citation->>'excerpt') THEN RETURN false; END IF;
   section_text:=NULL;
   IF citation->>'locator'='title' THEN section_text:=proposal->'source'->'title'->>'text';
   ELSIF citation->>'locator' ~ '^body [1-8] paragraph [1-9][0-9]{0,3}$' THEN
    body_index:=split_part(citation->>'locator',' ',2)::integer-1; paragraph_index:=split_part(citation->>'locator',' ',4)::integer-1;
    section_text:=proposal->'source'->'body'->body_index->'paragraphs'->paragraph_index->>'text'; body_cited:=true;
   END IF;
   IF section_text IS NULL OR strpos(section_text,citation->>'excerpt')=0 THEN RETURN false; END IF;
  END LOOP;
  IF NOT body_cited THEN RETURN false; END IF;
 END LOOP;
 RETURN octet_length(proposal::text)<=262144;
EXCEPTION WHEN OTHERS THEN RETURN false;
END $$;

CREATE TABLE presentation_question_suggestions_jobs (
 id uuid PRIMARY KEY, workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
 presentation_id uuid NOT NULL, created_by uuid REFERENCES users(id) ON DELETE SET NULL,
 request_hash text NOT NULL CHECK(request_hash~'^[a-f0-9]{64}$'), source_digest text NOT NULL CHECK(source_digest~'^[a-f0-9]{64}$'),
 block_id uuid NOT NULL, source_revision integer NOT NULL CHECK(source_revision>=0), output_language text NOT NULL CHECK(output_language='en'),
 source_snapshot jsonb CHECK(source_snapshot IS NULL OR (openround_question_suggestions_source_valid(source_snapshot) AND source_snapshot->>'blockId'=block_id::text AND encode(sha256(convert_to(openround_question_suggestions_source_json(source_snapshot),'UTF8')),'hex')=source_digest)),
 status text NOT NULL CHECK(status IN('pending','processing','ready','failed','expired')), attempts integer NOT NULL CHECK(attempts BETWEEN 0 AND 3),
 available_at timestamptz NOT NULL CHECK(isfinite(available_at)), lease_token uuid, lease_until timestamptz,
 proposal jsonb, proposal_hash text CHECK(proposal_hash IS NULL OR proposal_hash~'^[a-f0-9]{64}$'),
 error_code text CHECK(error_code IS NULL OR error_code IN('PROVIDER_UNAVAILABLE','INVALID_OUTPUT','SOURCE_UNAVAILABLE','EXPIRED','ATTEMPTS_EXHAUSTED')),
 created_at timestamptz NOT NULL CHECK(isfinite(created_at)),updated_at timestamptz NOT NULL CHECK(isfinite(updated_at)),expires_at timestamptz NOT NULL CHECK(isfinite(expires_at)),
 FOREIGN KEY(workspace_id,presentation_id) REFERENCES presentations(workspace_id,id) ON DELETE CASCADE,
 CHECK(expires_at>created_at AND expires_at<=created_at+interval '24 hours'),
 CHECK((status='processing')=(lease_token IS NOT NULL AND lease_until IS NOT NULL)),CHECK((lease_token IS NULL)=(lease_until IS NULL)),
 CHECK(lease_until IS NULL OR (isfinite(lease_until) AND lease_until<=expires_at AND lease_until>updated_at)),
 CHECK((status IN('pending','processing'))=(source_snapshot IS NOT NULL)),CHECK((status='ready')=(proposal IS NOT NULL AND proposal_hash IS NOT NULL)),CHECK((proposal IS NULL)=(proposal_hash IS NULL)),
 CHECK((status='expired')=(error_code='EXPIRED')),CHECK(status NOT IN('failed','expired') OR error_code IS NOT NULL),CHECK(status NOT IN('processing','ready') OR error_code IS NULL),CHECK(status NOT IN('pending','processing') OR created_by IS NOT NULL),
 CHECK(proposal IS NULL OR (openround_question_suggestions_proposal_valid(proposal,block_id,source_digest) AND proposal_hash=encode(sha256(convert_to(openround_question_suggestions_proposal_json(proposal),'UTF8')),'hex')))
);
CREATE INDEX presentation_question_suggestions_queue ON presentation_question_suggestions_jobs(available_at,created_at) WHERE status IN('pending','processing');
CREATE INDEX presentation_question_suggestions_workspace ON presentation_question_suggestions_jobs(workspace_id,presentation_id,created_at DESC);
CREATE INDEX presentation_question_suggestions_expiry ON presentation_question_suggestions_jobs(expires_at) WHERE status<>'expired';
ALTER TABLE presentation_question_suggestions_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE presentation_question_suggestions_jobs FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON presentation_question_suggestions_jobs
 USING(current_setting('app.system_access',true)='on' OR workspace_id::text=nullif(current_setting('app.workspace_id',true),''))
 WITH CHECK(current_setting('app.system_access',true)='on' OR workspace_id::text=nullif(current_setting('app.workspace_id',true),''));
CREATE FUNCTION guard_presentation_question_suggestions_job() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE source presentations%ROWTYPE; projected jsonb;
BEGIN
 IF TG_OP='INSERT' THEN
  PERFORM id FROM workspaces WHERE id=NEW.workspace_id AND NOT EXISTS(SELECT 1 FROM workspace_media_deletion_jobs deletion WHERE deletion.workspace_id=workspaces.id) FOR UPDATE;
  IF NOT FOUND OR NEW.status<>'pending' OR NEW.attempts<>0 OR NEW.error_code IS NOT NULL OR NOT presentation_assistance_author_active(NEW.workspace_id,NEW.created_by) THEN RAISE EXCEPTION 'Question suggestions author unavailable' USING ERRCODE='23514'; END IF;
  SELECT * INTO source FROM presentations WHERE workspace_id=NEW.workspace_id AND id=NEW.presentation_id AND status<>'archived' FOR SHARE;
  IF NOT FOUND OR source.draft_revision<>NEW.source_revision OR (SELECT count(*) FROM jsonb_array_elements(source.draft->'blocks') block WHERE openround_presentation_uuid_equal(block->>'id',NEW.block_id::text))<>1
   OR ((SELECT count(*) FROM presentation_assistance_jobs WHERE workspace_id=NEW.workspace_id AND status IN('pending','processing') AND expires_at>statement_timestamp())+(SELECT count(*) FROM presentation_text_assistance_jobs WHERE workspace_id=NEW.workspace_id AND status IN('pending','processing') AND expires_at>statement_timestamp())+(SELECT count(*) FROM presentation_question_suggestions_jobs WHERE workspace_id=NEW.workspace_id AND status IN('pending','processing') AND expires_at>statement_timestamp()))>=2 THEN RAISE EXCEPTION 'Question suggestions source or capacity unavailable' USING ERRCODE='23514'; END IF;
  SELECT openround_question_suggestions_source(block) INTO projected FROM jsonb_array_elements(source.draft->'blocks') block WHERE openround_presentation_uuid_equal(block->>'id',NEW.block_id::text);
  IF projected IS NULL OR projected IS DISTINCT FROM NEW.source_snapshot THEN RAISE EXCEPTION 'Question suggestions source changed' USING ERRCODE='23514'; END IF;
  IF NEW.request_hash<>encode(sha256(convert_to('{"schemaVersion":1,"requestId":'||to_jsonb(NEW.id::text)::text||',"presentationId":'||to_jsonb(NEW.presentation_id::text)::text||',"blockId":'||to_jsonb(NEW.block_id::text)::text||',"expectedRevision":'||NEW.source_revision||',"sourceDigest":'||to_jsonb(NEW.source_digest)::text||',"outputLanguage":"en"}','UTF8')),'hex') THEN RAISE EXCEPTION 'Question suggestions request fingerprint invalid' USING ERRCODE='23514'; END IF;
  INSERT INTO authoring_admission_receipts(workspace_id,kind,job_id,created_at) VALUES(NEW.workspace_id,'presentation',NEW.id,NEW.created_at);
 ELSE
  IF ROW(NEW.id,NEW.workspace_id,NEW.presentation_id,NEW.request_hash,NEW.source_digest,NEW.block_id,NEW.source_revision,NEW.output_language,NEW.created_at,NEW.expires_at) IS DISTINCT FROM ROW(OLD.id,OLD.workspace_id,OLD.presentation_id,OLD.request_hash,OLD.source_digest,OLD.block_id,OLD.source_revision,OLD.output_language,OLD.created_at,OLD.expires_at)
    OR (NEW.source_snapshot IS NOT NULL AND NEW.source_snapshot IS DISTINCT FROM OLD.source_snapshot) OR (NEW.created_by IS NOT NULL AND NEW.created_by IS DISTINCT FROM OLD.created_by) THEN RAISE EXCEPTION 'Question suggestions source identity is immutable' USING ERRCODE='23514'; END IF;
  IF NEW.status='processing' AND NEW.attempts=OLD.attempts+1 THEN
   IF OLD.status NOT IN('pending','processing') OR OLD.available_at>NEW.updated_at OR (OLD.lease_until IS NOT NULL AND OLD.lease_until>NEW.updated_at) THEN RAISE EXCEPTION 'Question suggestions claim unavailable' USING ERRCODE='23514'; END IF;
  ELSIF NEW.attempts<>OLD.attempts THEN RAISE EXCEPTION 'Question suggestions attempts are monotonic' USING ERRCODE='23514'; END IF;
  IF NEW.status='expired' THEN
   IF NEW.expires_at>NEW.updated_at OR NEW.created_by IS NOT NULL THEN RAISE EXCEPTION 'Question suggestions have not expired' USING ERRCODE='23514'; END IF;
  ELSIF NEW.error_code='SOURCE_UNAVAILABLE' AND NEW.status='failed' THEN
   IF NEW.source_snapshot IS NOT NULL OR NEW.proposal IS NOT NULL THEN RAISE EXCEPTION 'Unavailable source must be erased' USING ERRCODE='23514'; END IF;
  ELSIF NEW.status<>OLD.status AND NOT((NEW.status='processing' AND OLD.status IN('pending','processing') AND NEW.attempts=OLD.attempts+1) OR (OLD.status='processing' AND NEW.status IN('pending','ready','failed')) OR (OLD.status='pending' AND NEW.status='failed' AND NEW.error_code='ATTEMPTS_EXHAUSTED')) THEN RAISE EXCEPTION 'Invalid question suggestions transition' USING ERRCODE='23514'; END IF;
  IF NEW.status='ready' AND OLD.status<>'ready' THEN
   IF OLD.status<>'processing' OR OLD.lease_until<=NEW.updated_at OR OLD.expires_at<=NEW.updated_at OR NEW.proposal->'source' IS DISTINCT FROM OLD.source_snapshot THEN RAISE EXCEPTION 'Question suggestions completion lease or source changed' USING ERRCODE='23514'; END IF;
  ELSIF OLD.status='ready' AND NEW.status='ready' AND ROW(NEW.proposal,NEW.proposal_hash) IS DISTINCT FROM ROW(OLD.proposal,OLD.proposal_hash) THEN RAISE EXCEPTION 'Completed question suggestions are immutable' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER guard_presentation_question_suggestions_job BEFORE INSERT OR UPDATE ON presentation_question_suggestions_jobs FOR EACH ROW EXECUTE FUNCTION guard_presentation_question_suggestions_job();
CREATE FUNCTION erase_expired_presentation_question_suggestions(moment timestamptz) RETURNS TABLE(id uuid) LANGUAGE sql AS $$
 UPDATE presentation_question_suggestions_jobs SET status='expired',source_snapshot=NULL,proposal=NULL,proposal_hash=NULL,created_by=NULL,lease_token=NULL,lease_until=NULL,error_code='EXPIRED',updated_at=moment WHERE expires_at<=moment AND status<>'expired' RETURNING id
$$;
CREATE FUNCTION erase_actor_presentation_question_suggestions() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public SET app.system_access='on' AS $$
BEGIN
 IF NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL THEN
  UPDATE presentation_question_suggestions_jobs SET status='failed',source_snapshot=NULL,proposal=NULL,proposal_hash=NULL,created_by=NULL,lease_token=NULL,lease_until=NULL,error_code='SOURCE_UNAVAILABLE',updated_at=now() WHERE created_by=NEW.id AND status<>'expired';
 END IF; RETURN NEW;
END $$;
CREATE TRIGGER erase_actor_presentation_question_suggestions AFTER UPDATE OF deleted_at ON users FOR EACH ROW EXECUTE FUNCTION erase_actor_presentation_question_suggestions();
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='openround_runtime') THEN GRANT SELECT,INSERT,UPDATE,DELETE ON presentation_question_suggestions_jobs TO openround_runtime; END IF; END $$;

-- Every presentation AI queue observes the same workspace lock and two-active-job limit.
CREATE OR REPLACE FUNCTION guard_presentation_assistance_job() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE citation jsonb; line_number integer; source_line text;
BEGIN
 IF TG_OP='INSERT' THEN
  PERFORM id FROM workspaces WHERE id=NEW.workspace_id AND NOT EXISTS(SELECT 1 FROM workspace_media_deletion_jobs deletion WHERE deletion.workspace_id=workspaces.id) FOR UPDATE;
  IF NOT FOUND OR NEW.status<>'pending' OR NEW.attempts<>0 OR NEW.error_code IS NOT NULL THEN RAISE EXCEPTION 'Invalid assistance initial state' USING ERRCODE='23514'; END IF;
  IF NOT presentation_assistance_author_active(NEW.workspace_id,NEW.created_by) THEN RAISE EXCEPTION 'Assistance author unavailable' USING ERRCODE='23514'; END IF;
  PERFORM id FROM presentations WHERE workspace_id=NEW.workspace_id AND id=NEW.presentation_id AND status<>'archived';
  IF NOT FOUND OR ((SELECT count(*) FROM presentation_assistance_jobs WHERE workspace_id=NEW.workspace_id AND status IN('pending','processing') AND expires_at>statement_timestamp())+(SELECT count(*) FROM presentation_text_assistance_jobs WHERE workspace_id=NEW.workspace_id AND status IN('pending','processing') AND expires_at>statement_timestamp())+(SELECT count(*) FROM presentation_question_suggestions_jobs WHERE workspace_id=NEW.workspace_id AND status IN('pending','processing') AND expires_at>statement_timestamp()))>=2 THEN RAISE EXCEPTION 'Assistance source or capacity unavailable' USING ERRCODE='23514'; END IF;
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
CREATE OR REPLACE FUNCTION guard_presentation_text_assistance_job() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE source presentations%ROWTYPE; source_block jsonb; source_node jsonb;
BEGIN
 IF TG_OP='INSERT' THEN
  PERFORM id FROM workspaces WHERE id=NEW.workspace_id AND NOT EXISTS(SELECT 1 FROM workspace_media_deletion_jobs deletion WHERE deletion.workspace_id=workspaces.id) FOR UPDATE;
  IF NOT FOUND OR NEW.status<>'pending' OR NEW.attempts<>0 OR NEW.error_code IS NOT NULL THEN RAISE EXCEPTION 'Invalid text assistance initial state' USING ERRCODE='23514'; END IF;
  IF NOT presentation_assistance_author_active(NEW.workspace_id,NEW.created_by) THEN RAISE EXCEPTION 'Text assistance author unavailable' USING ERRCODE='23514'; END IF;
  SELECT * INTO source FROM presentations WHERE workspace_id=NEW.workspace_id AND id=NEW.presentation_id AND status<>'archived' FOR SHARE;
  IF NOT FOUND OR source.draft_revision<>NEW.source_revision
    OR (SELECT count(*) FROM jsonb_array_elements(source.draft->'blocks') block WHERE openround_presentation_uuid_equal(block->>'id',NEW.block_id::text))<>1
    OR ((SELECT count(*) FROM presentation_assistance_jobs WHERE workspace_id=NEW.workspace_id AND status IN('pending','processing') AND expires_at>statement_timestamp())
      +(SELECT count(*) FROM presentation_text_assistance_jobs WHERE workspace_id=NEW.workspace_id AND status IN('pending','processing') AND expires_at>statement_timestamp())+(SELECT count(*) FROM presentation_question_suggestions_jobs WHERE workspace_id=NEW.workspace_id AND status IN('pending','processing') AND expires_at>statement_timestamp()))>=2 THEN RAISE EXCEPTION 'Text assistance source or capacity unavailable' USING ERRCODE='23514'; END IF;
  SELECT block INTO source_block FROM jsonb_array_elements(source.draft->'blocks') block WHERE openround_presentation_uuid_equal(block->>'id',NEW.block_id::text);
  IF source_block->>'kind' IS DISTINCT FROM 'content' OR jsonb_typeof(source_block->'scene'->'nodes') IS DISTINCT FROM 'array'
    OR (SELECT count(*) FROM jsonb_array_elements(source_block->'scene'->'nodes') node WHERE node->>'id'=NEW.node_id)<>1 THEN RAISE EXCEPTION 'Text assistance requires one native node' USING ERRCODE='23514'; END IF;
  SELECT node INTO source_node FROM jsonb_array_elements(source_block->'scene'->'nodes') node WHERE node->>'id'=NEW.node_id;
  IF source_node->>'type' IS DISTINCT FROM 'text' OR source_node ? 'richText' OR source_node->>'role' IS DISTINCT FROM NEW.role
    OR source_node->>'text' IS DISTINCT FROM NEW.original_text
    OR (NEW.operation='translate' AND source_node->>'lang' IS DISTINCT FROM NEW.source_language) THEN RAISE EXCEPTION 'Text assistance source changed' USING ERRCODE='23514'; END IF;
  INSERT INTO authoring_admission_receipts(workspace_id,kind,job_id,created_at) VALUES(NEW.workspace_id,'presentation',NEW.id,NEW.created_at);
 ELSE
  IF ROW(NEW.id,NEW.workspace_id,NEW.presentation_id,NEW.request_hash,NEW.source_digest,NEW.block_id,NEW.node_id,NEW.operation,NEW.role,NEW.source_revision,NEW.target_language,NEW.source_language,NEW.created_at,NEW.expires_at)
    IS DISTINCT FROM ROW(OLD.id,OLD.workspace_id,OLD.presentation_id,OLD.request_hash,OLD.source_digest,OLD.block_id,OLD.node_id,OLD.operation,OLD.role,OLD.source_revision,OLD.target_language,OLD.source_language,OLD.created_at,OLD.expires_at)
    OR (NEW.original_text IS NOT NULL AND NEW.original_text IS DISTINCT FROM OLD.original_text)
    OR (NEW.created_by IS NOT NULL AND NEW.created_by IS DISTINCT FROM OLD.created_by) THEN RAISE EXCEPTION 'Text assistance source identity is immutable' USING ERRCODE='23514'; END IF;
  IF NEW.status='processing' AND NEW.attempts=OLD.attempts+1 THEN
   IF OLD.status NOT IN('pending','processing') OR OLD.available_at>NEW.updated_at OR (OLD.lease_until IS NOT NULL AND OLD.lease_until>NEW.updated_at) THEN RAISE EXCEPTION 'Text assistance claim unavailable' USING ERRCODE='23514'; END IF;
  ELSIF NEW.attempts<>OLD.attempts THEN RAISE EXCEPTION 'Text assistance attempts are monotonic' USING ERRCODE='23514'; END IF;
  IF NEW.status='expired' THEN
   IF NEW.expires_at>NEW.updated_at OR NEW.created_by IS NOT NULL THEN RAISE EXCEPTION 'Text assistance has not expired' USING ERRCODE='23514'; END IF;
  ELSIF NEW.error_code='SOURCE_UNAVAILABLE' AND NEW.status='failed' THEN
   IF NEW.original_text IS NOT NULL OR NEW.proposal IS NOT NULL THEN RAISE EXCEPTION 'Unavailable text must be erased' USING ERRCODE='23514'; END IF;
  ELSIF NEW.status<>OLD.status AND NOT(
    (NEW.status='processing' AND OLD.status IN('pending','processing') AND NEW.attempts=OLD.attempts+1)
    OR (OLD.status='processing' AND NEW.status IN('pending','ready','failed'))
    OR (OLD.status='pending' AND NEW.status='failed' AND NEW.error_code='ATTEMPTS_EXHAUSTED')) THEN RAISE EXCEPTION 'Invalid text assistance transition' USING ERRCODE='23514'; END IF;
  IF NEW.status='ready' AND OLD.status<>'ready' THEN
   IF OLD.status<>'processing' OR OLD.lease_until<=NEW.updated_at OR OLD.expires_at<=NEW.updated_at
     OR NEW.proposal->>'originalText' IS DISTINCT FROM OLD.original_text THEN RAISE EXCEPTION 'Text assistance completion lease or source changed' USING ERRCODE='23514'; END IF;
  ELSIF OLD.status='ready' AND NEW.status='ready' AND ROW(NEW.proposal,NEW.proposal_hash) IS DISTINCT FROM ROW(OLD.proposal,OLD.proposal_hash) THEN RAISE EXCEPTION 'Completed text assistance is immutable' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
