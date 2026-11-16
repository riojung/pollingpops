-- Independent pinned practice assignments; private responses never change reading completion semantics.
CREATE TABLE presentation_practice_assignments (
 id uuid PRIMARY KEY,
 workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
 presentation_id uuid NOT NULL,
 version_id uuid NOT NULL,
 actor_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 request_id uuid NOT NULL,
 intent_hash text NOT NULL CHECK(intent_hash ~ '^[a-f0-9]{64}$'),
 token_hash text NOT NULL UNIQUE CHECK(token_hash ~ '^[a-f0-9]{64}$'),
 created_at timestamptz NOT NULL CHECK(isfinite(created_at)),
 expires_at timestamptz NOT NULL CHECK(isfinite(expires_at) AND expires_at>created_at AND expires_at<=created_at+interval '30 days'),
 revoked_at timestamptz CHECK(revoked_at IS NULL OR isfinite(revoked_at)),
 UNIQUE(workspace_id,actor_id,request_id), UNIQUE(workspace_id,id),
 FOREIGN KEY(workspace_id,presentation_id,version_id) REFERENCES presentation_versions(workspace_id,presentation_id,id) ON DELETE CASCADE
);
CREATE INDEX presentation_practice_assignments_source_idx ON presentation_practice_assignments(workspace_id,presentation_id,created_at DESC,id DESC);
CREATE INDEX presentation_practice_assignments_expiry_idx ON presentation_practice_assignments(expires_at);
CREATE TABLE presentation_practice_attempts (
 id uuid PRIMARY KEY,
 workspace_id uuid NOT NULL,
 assignment_id uuid NOT NULL,
 token_hash text NOT NULL CHECK(token_hash ~ '^[a-f0-9]{64}$'),
 revision bigint NOT NULL CHECK(revision BETWEEN 0 AND 100),
 read_block_ids uuid[] NOT NULL CHECK(cardinality(read_block_ids)<=50),
 read_revisions jsonb NOT NULL CHECK(jsonb_typeof(read_revisions)='object' AND octet_length(read_revisions::text)<=16384),
 answers jsonb NOT NULL CHECK(jsonb_typeof(answers)='object' AND octet_length(answers::text)<=8192),
 current_block_id uuid,
 started_at timestamptz NOT NULL CHECK(isfinite(started_at)),
 updated_at timestamptz NOT NULL CHECK(isfinite(updated_at) AND updated_at>=started_at),
 completed_at timestamptz CHECK(completed_at IS NULL OR (isfinite(completed_at) AND completed_at=updated_at)),
 UNIQUE(workspace_id,assignment_id,id),
 FOREIGN KEY(workspace_id,assignment_id) REFERENCES presentation_practice_assignments(workspace_id,id) ON DELETE CASCADE
);
CREATE INDEX presentation_practice_attempts_source_idx ON presentation_practice_attempts(workspace_id,assignment_id,id);
CREATE TABLE presentation_practice_receipts (
 workspace_id uuid NOT NULL, assignment_id uuid NOT NULL, attempt_id uuid NOT NULL, request_id uuid NOT NULL,
 request_hash text NOT NULL CHECK(request_hash ~ '^[a-f0-9]{64}$'),
 receipt jsonb NOT NULL CHECK(jsonb_typeof(receipt)='object' AND octet_length(receipt::text)<=512 AND receipt ?& ARRAY['revision','currentBlockId','updatedAt','completedAt'] AND (receipt-ARRAY['revision','currentBlockId','updatedAt','completedAt'])='{}'::jsonb),
 PRIMARY KEY(assignment_id,attempt_id,request_id),
 FOREIGN KEY(workspace_id,assignment_id,attempt_id) REFERENCES presentation_practice_attempts(workspace_id,assignment_id,id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX presentation_practice_receipts_revision_idx ON presentation_practice_receipts(assignment_id,attempt_id,((receipt->>'revision')::bigint));
CREATE FUNCTION presentation_practice_content_eligible(value jsonb) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
 SELECT jsonb_typeof(value->'blocks')='array'
 AND (SELECT count(*) FROM jsonb_array_elements(value->'blocks') block WHERE block->'hidden' IS DISTINCT FROM 'true'::jsonb) BETWEEN 1 AND 50
 AND (SELECT count(*) FROM jsonb_array_elements(value->'blocks') block WHERE block->'hidden' IS DISTINCT FROM 'true'::jsonb AND block->>'kind'='question') BETWEEN 1 AND 25
 AND (SELECT count(*)=count(DISTINCT lower(block->>'id')) FROM jsonb_array_elements(value->'blocks') block WHERE block->'hidden' IS DISTINCT FROM 'true'::jsonb)
 AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(value->'blocks') block WHERE block->'hidden' IS DISTINCT FROM 'true'::jsonb AND block->>'kind'='question' AND (SELECT count(*)<>count(DISTINCT lower(choice->>'id')) FROM jsonb_array_elements(block->'question'->'choices') choice))
 AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(value->'blocks') block WHERE block->'hidden' IS DISTINCT FROM 'true'::jsonb AND block->>'kind'='question' AND (
 block->'question'->>'type' NOT IN('single_select','true_false')
 OR coalesce(block->'question'->>'delivery','main')<>'main'
 OR coalesce(block->'question'->>'purpose','diagnostic') NOT IN('diagnostic','practice')
 OR coalesce(block->'question'->>'confidence','off')='required'
 OR block->'question'->>'linkedRecheckQuestionId' IS NOT NULL));
$$;
CREATE FUNCTION guard_presentation_practice_assignment() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public SET app.system_access='on' AS $$
BEGIN
 IF TG_OP='UPDATE' THEN
  IF (to_jsonb(NEW)-'revoked_at') IS DISTINCT FROM (to_jsonb(OLD)-'revoked_at') OR (OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS DISTINCT FROM OLD.revoked_at) THEN RAISE EXCEPTION 'Practice assignments may only be revoked' USING ERRCODE='23514'; END IF;
 ELSE
  -- Match repository admission order: publisher, membership, workspace, source.
  PERFORM id FROM users WHERE id=NEW.actor_id AND deleted_at IS NULL FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Practice assignment source is unavailable' USING ERRCODE='23514'; END IF;
  PERFORM member.user_id FROM workspace_members member WHERE member.workspace_id=NEW.workspace_id AND member.user_id=NEW.actor_id AND member.role IN('owner','editor') FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Practice assignment source is unavailable' USING ERRCODE='23514'; END IF;
  PERFORM id FROM workspaces WHERE id=NEW.workspace_id AND deletion_started_at IS NULL FOR UPDATE;
  IF NOT FOUND OR EXISTS(SELECT 1 FROM workspace_media_deletion_jobs WHERE workspace_id=NEW.workspace_id) THEN RAISE EXCEPTION 'Practice assignment source is unavailable' USING ERRCODE='23514'; END IF;
  PERFORM parent.id FROM presentations parent JOIN presentation_versions version ON version.workspace_id=parent.workspace_id AND version.presentation_id=parent.id WHERE parent.workspace_id=NEW.workspace_id AND parent.id=NEW.presentation_id AND version.id=NEW.version_id AND parent.status<>'archived' AND presentation_practice_content_eligible(version.content) FOR UPDATE OF parent;
  IF NOT FOUND THEN RAISE EXCEPTION 'Practice assignment source is unavailable' USING ERRCODE='23514'; END IF;
  IF (SELECT count(*) FROM presentation_practice_assignments WHERE workspace_id=NEW.workspace_id AND presentation_id=NEW.presentation_id)>=50 OR (SELECT count(*) FROM presentation_practice_assignments WHERE workspace_id=NEW.workspace_id AND presentation_id=NEW.presentation_id AND revoked_at IS NULL AND expires_at>clock_timestamp())>=10 THEN RAISE EXCEPTION 'Practice assignment limit reached' USING ERRCODE='23514'; END IF;
  -- Check the wall clock only after all admission locks have been acquired.
  IF NEW.expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'Practice assignment source is unavailable' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION guard_presentation_practice_assignment() FROM PUBLIC;
CREATE TRIGGER presentation_practice_assignment_guard BEFORE INSERT OR UPDATE ON presentation_practice_assignments FOR EACH ROW EXECUTE FUNCTION guard_presentation_practice_assignment();
CREATE FUNCTION guard_presentation_practice_attempt() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public SET app.system_access='on' AS $$
DECLARE source presentation_practice_assignments%ROWTYPE; visible uuid[]; questions uuid[]; frozen jsonb; answer_entry record; checkpoint jsonb; choice jsonb;
BEGIN
 -- A raw UPDATE already holds its target attempt tuple before this trigger runs.
 -- Acquire every remaining lifecycle fence in repository order; an inversion with
 -- concurrent cascading deletion must abort rather than admit an unfenced write.
 SELECT * INTO source FROM presentation_practice_assignments WHERE workspace_id=NEW.workspace_id AND id=NEW.assignment_id;
 IF source.id IS NULL THEN RAISE EXCEPTION 'Practice assignment is no longer active' USING ERRCODE='23514'; END IF;
 PERFORM id FROM users WHERE id=source.actor_id AND deleted_at IS NULL FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Practice assignment is no longer active' USING ERRCODE='23514'; END IF;
 PERFORM member.user_id FROM workspace_members member WHERE member.workspace_id=source.workspace_id AND member.user_id=source.actor_id AND member.role IN('owner','editor') FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Practice assignment is no longer active' USING ERRCODE='23514'; END IF;
 IF TG_OP='INSERT' THEN
  PERFORM id FROM workspaces WHERE id=source.workspace_id AND deletion_started_at IS NULL FOR UPDATE;
 ELSE
  PERFORM id FROM workspaces WHERE id=source.workspace_id AND deletion_started_at IS NULL FOR SHARE;
 END IF;
 IF NOT FOUND OR EXISTS(SELECT 1 FROM workspace_media_deletion_jobs WHERE workspace_id=source.workspace_id) THEN RAISE EXCEPTION 'Practice assignment is no longer active' USING ERRCODE='23514'; END IF;
 SELECT version.content INTO frozen FROM presentations parent JOIN presentation_versions version ON version.workspace_id=parent.workspace_id AND version.presentation_id=parent.id WHERE parent.workspace_id=source.workspace_id AND parent.id=source.presentation_id AND version.id=source.version_id FOR SHARE OF parent;
 IF NOT FOUND THEN RAISE EXCEPTION 'Practice assignment is no longer active' USING ERRCODE='23514'; END IF;
 SELECT * INTO source FROM presentation_practice_assignments WHERE workspace_id=NEW.workspace_id AND id=NEW.assignment_id FOR SHARE;
 IF source.id IS NULL OR source.revoked_at IS NOT NULL OR source.expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'Practice assignment is no longer active' USING ERRCODE='23514'; END IF;
 IF NOT presentation_practice_content_eligible(frozen) THEN RAISE EXCEPTION 'Practice source must remain eligible' USING ERRCODE='23514'; END IF;
 SELECT array_agg((block->>'id')::uuid),array_agg((block->>'id')::uuid) FILTER(WHERE block->>'kind'='question') INTO visible,questions FROM jsonb_array_elements(frozen->'blocks') block WHERE block->'hidden' IS DISTINCT FROM 'true'::jsonb;
 IF coalesce(cardinality(visible),0) NOT BETWEEN 1 AND 50 OR NOT NEW.read_block_ids <@ visible OR (SELECT count(DISTINCT id) FROM unnest(NEW.read_block_ids) id)<>cardinality(NEW.read_block_ids) OR (NEW.current_block_id IS NOT NULL AND NOT NEW.current_block_id=ANY(NEW.read_block_ids)) OR (SELECT count(*) FROM jsonb_object_keys(NEW.read_revisions))<>cardinality(NEW.read_block_ids) THEN RAISE EXCEPTION 'Practice progress must refer to visible pinned pages' USING ERRCODE='23514'; END IF;
 IF EXISTS(SELECT 1 FROM unnest(NEW.read_block_ids) id WHERE NOT NEW.read_revisions ? id::text OR jsonb_typeof(NEW.read_revisions->id::text)<>'number' OR (NEW.read_revisions->>id::text)::numeric NOT BETWEEN 1 AND NEW.revision OR (NEW.read_revisions->>id::text)::numeric<>trunc((NEW.read_revisions->>id::text)::numeric)) THEN RAISE EXCEPTION 'Practice page acknowledgements require their first revision' USING ERRCODE='23514'; END IF;

 IF (SELECT count(*) FROM jsonb_object_keys(NEW.answers))>25 THEN RAISE EXCEPTION 'Practice answers are bounded' USING ERRCODE='23514'; END IF;
 FOR answer_entry IN SELECT key,value FROM jsonb_each(NEW.answers) LOOP
  IF NOT answer_entry.key::uuid=ANY(questions) OR NOT answer_entry.key::uuid=ANY(NEW.read_block_ids)
   OR jsonb_typeof(answer_entry.value)<>'object' OR NOT answer_entry.value ?& ARRAY['choiceId','correct','revision','submittedAt'] OR (answer_entry.value-ARRAY['choiceId','correct','revision','submittedAt'])<>'{}'::jsonb
   OR jsonb_typeof(answer_entry.value->'choiceId') IS DISTINCT FROM 'string' OR jsonb_typeof(answer_entry.value->'submittedAt') IS DISTINCT FROM 'string'
   OR jsonb_typeof(answer_entry.value->'correct')<>'boolean'
   OR jsonb_typeof(answer_entry.value->'revision')<>'number' OR (answer_entry.value->>'revision')::numeric NOT BETWEEN 1 AND NEW.revision OR (answer_entry.value->>'revision')::numeric<>trunc((answer_entry.value->>'revision')::numeric)
   OR answer_entry.value->'revision' IS DISTINCT FROM NEW.read_revisions->answer_entry.key
   OR NOT isfinite((answer_entry.value->>'submittedAt')::timestamptz) OR (answer_entry.value->>'submittedAt')::timestamptz<NEW.started_at OR (answer_entry.value->>'submittedAt')::timestamptz>NEW.updated_at
   THEN RAISE EXCEPTION 'Practice answers must match acknowledged question revisions' USING ERRCODE='23514'; END IF;
  SELECT block->'question' INTO checkpoint FROM jsonb_array_elements(frozen->'blocks') block WHERE (block->>'id')::uuid=answer_entry.key::uuid;
  SELECT item INTO choice FROM jsonb_array_elements(checkpoint->'choices') item WHERE (item->>'id')::uuid=(answer_entry.value->>'choiceId')::uuid;
  IF choice IS NULL OR choice->'isCorrect' IS DISTINCT FROM answer_entry.value->'correct' THEN RAISE EXCEPTION 'Practice answer must match a frozen available choice' USING ERRCODE='23514'; END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM unnest(NEW.read_block_ids) id WHERE id=ANY(questions) AND NOT NEW.answers ? id::text) THEN RAISE EXCEPTION 'Question acknowledgement requires its accepted answer' USING ERRCODE='23514'; END IF;
 IF NEW.completed_at IS NOT NULL AND (NOT visible <@ NEW.read_block_ids OR (SELECT count(*) FROM jsonb_object_keys(NEW.answers))<>cardinality(questions)) THEN RAISE EXCEPTION 'Finishing requires every visible page acknowledgement' USING ERRCODE='23514'; END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.revision<>0 OR NEW.answers<>'{}'::jsonb OR cardinality(NEW.read_block_ids)<>0 OR NEW.current_block_id IS NOT NULL OR NEW.completed_at IS NOT NULL OR NEW.updated_at<>NEW.started_at THEN RAISE EXCEPTION 'Practice attempts begin without progress' USING ERRCODE='23514'; END IF;
  IF (SELECT count(*) FROM presentation_practice_attempts WHERE assignment_id=NEW.assignment_id)>=250 OR (SELECT count(*) FROM presentation_practice_attempts attempt JOIN presentation_practice_assignments parent ON parent.id=attempt.assignment_id WHERE attempt.workspace_id=NEW.workspace_id AND parent.presentation_id=source.presentation_id)>=1000 OR (SELECT count(*) FROM presentation_practice_attempts WHERE workspace_id=NEW.workspace_id)>=2000 THEN RAISE EXCEPTION 'Practice attempt limit reached' USING ERRCODE='23514'; END IF;
 ELSE
  IF OLD.completed_at IS NOT NULL OR NEW.id<>OLD.id OR NEW.workspace_id<>OLD.workspace_id OR NEW.assignment_id<>OLD.assignment_id OR NEW.token_hash<>OLD.token_hash OR NEW.started_at<>OLD.started_at OR NEW.revision<>OLD.revision+1 OR NEW.updated_at<OLD.updated_at OR NOT OLD.read_block_ids <@ NEW.read_block_ids OR NEW.read_block_ids[1:cardinality(OLD.read_block_ids)] IS DISTINCT FROM OLD.read_block_ids OR cardinality(NEW.read_block_ids)>cardinality(OLD.read_block_ids)+1 OR NOT NEW.read_revisions @> OLD.read_revisions OR NOT NEW.answers @> OLD.answers THEN RAISE EXCEPTION 'Practice identity and progress must remain monotonic' USING ERRCODE='23514'; END IF;
  IF (SELECT count(*) FROM jsonb_object_keys(NEW.answers))>(SELECT count(*) FROM jsonb_object_keys(OLD.answers))+1 OR (NEW.completed_at IS NOT NULL AND (NEW.read_block_ids IS DISTINCT FROM OLD.read_block_ids OR NEW.answers IS DISTINCT FROM OLD.answers OR NEW.current_block_id IS DISTINCT FROM OLD.current_block_id)) THEN RAISE EXCEPTION 'Practice transitions contain one action' USING ERRCODE='23514'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_each(NEW.answers) entry WHERE NOT OLD.answers ? entry.key AND ((entry.value->>'revision')::bigint<>NEW.revision OR (entry.value->>'submittedAt')::timestamptz<>NEW.updated_at OR NEW.current_block_id IS DISTINCT FROM entry.key::uuid)) THEN RAISE EXCEPTION 'New answers require the current accepted transition' USING ERRCODE='23514'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_each(NEW.read_revisions) entry WHERE NOT OLD.read_revisions ? entry.key AND entry.value<>to_jsonb(NEW.revision)) THEN RAISE EXCEPTION 'New acknowledgements require the current revision' USING ERRCODE='23514'; END IF;
 END IF;
 -- Validation and admission may also wait; expiry never inherits a stale statement time.
 IF source.expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'Practice assignment is no longer active' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION guard_presentation_practice_attempt() FROM PUBLIC;
CREATE TRIGGER presentation_practice_attempt_guard BEFORE INSERT OR UPDATE ON presentation_practice_attempts FOR EACH ROW EXECUTE FUNCTION guard_presentation_practice_attempt();
CREATE FUNCTION guard_presentation_practice_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE attempt presentation_practice_attempts%ROWTYPE;
BEGIN
 IF TG_OP='UPDATE' THEN RAISE EXCEPTION 'Practice receipts are immutable' USING ERRCODE='23514'; END IF;
 SELECT * INTO attempt FROM presentation_practice_attempts WHERE assignment_id=NEW.assignment_id AND id=NEW.attempt_id AND workspace_id=NEW.workspace_id FOR UPDATE;
 IF jsonb_typeof(NEW.receipt->'revision') IS DISTINCT FROM 'number' OR jsonb_typeof(NEW.receipt->'updatedAt') IS DISTINCT FROM 'string' OR jsonb_typeof(NEW.receipt->'currentBlockId') NOT IN('string','null') OR jsonb_typeof(NEW.receipt->'completedAt') NOT IN('string','null') THEN RAISE EXCEPTION 'Practice receipt fields require valid types' USING ERRCODE='23514'; END IF;
 IF attempt.id IS NULL OR (NEW.receipt->>'revision')::numeric<>trunc((NEW.receipt->>'revision')::numeric) OR (NEW.receipt->>'revision')::bigint<>attempt.revision OR attempt.revision<1 OR NEW.receipt->'currentBlockId' IS DISTINCT FROM to_jsonb(attempt.current_block_id) AND NOT (attempt.current_block_id IS NULL AND NEW.receipt->'currentBlockId'='null'::jsonb) OR (NEW.receipt->>'updatedAt')::timestamptz IS DISTINCT FROM attempt.updated_at OR (NEW.receipt->>'completedAt')::timestamptz IS DISTINCT FROM attempt.completed_at OR (SELECT count(*) FROM presentation_practice_receipts WHERE assignment_id=NEW.assignment_id AND attempt_id=NEW.attempt_id)>=100 THEN RAISE EXCEPTION 'Practice receipt must match the accepted bounded revision' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER presentation_practice_receipt_guard BEFORE INSERT OR UPDATE ON presentation_practice_receipts FOR EACH ROW EXECUTE FUNCTION guard_presentation_practice_receipt();
CREATE FUNCTION preserve_presentation_practice_assignment_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF current_setting('app.system_access',true)='on' OR pg_trigger_depth()>1 THEN RETURN OLD; END IF;
 IF TG_TABLE_NAME='presentation_practice_assignments' THEN
  IF OLD.expires_at<=clock_timestamp()-interval '7 days' THEN RETURN OLD; END IF;
 END IF;
 RAISE EXCEPTION 'Practice receipts are retained with their assignment' USING ERRCODE='23514';
END $$;
CREATE TRIGGER presentation_practice_assignment_delete BEFORE DELETE ON presentation_practice_assignments FOR EACH ROW EXECUTE FUNCTION preserve_presentation_practice_assignment_receipt();
CREATE TRIGGER presentation_practice_attempt_delete BEFORE DELETE ON presentation_practice_attempts FOR EACH ROW EXECUTE FUNCTION preserve_presentation_practice_assignment_receipt();
CREATE TRIGGER presentation_practice_receipt_delete BEFORE DELETE ON presentation_practice_receipts FOR EACH ROW EXECUTE FUNCTION preserve_presentation_practice_assignment_receipt();
ALTER TABLE presentation_practice_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE presentation_practice_assignments FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON presentation_practice_assignments USING(current_setting('app.system_access',true)='on' OR workspace_id::text=nullif(current_setting('app.workspace_id',true),'')) WITH CHECK(current_setting('app.system_access',true)='on' OR workspace_id::text=nullif(current_setting('app.workspace_id',true),''));
DO $$ DECLARE target text; BEGIN
 FOREACH target IN ARRAY ARRAY['presentation_practice_attempts','presentation_practice_receipts'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',target);
  EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',target);
  EXECUTE format('CREATE POLICY practice_assignment_scope ON %I USING(current_setting(''app.system_access'',true)=''on'' OR (workspace_id::text=nullif(current_setting(''app.workspace_id'',true),'''') AND assignment_id::text=nullif(current_setting(''app.presentation_practice_assignment_id'',true),''''))) WITH CHECK(current_setting(''app.system_access'',true)=''on'' OR (workspace_id::text=nullif(current_setting(''app.workspace_id'',true),'''') AND assignment_id::text=nullif(current_setting(''app.presentation_practice_assignment_id'',true),'''')))',target);
 END LOOP;
END $$;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='openround_runtime') THEN
 GRANT SELECT,INSERT,DELETE ON presentation_practice_assignments TO openround_runtime;
 REVOKE UPDATE ON presentation_practice_assignments,presentation_practice_receipts FROM openround_runtime;
 GRANT UPDATE(revoked_at) ON presentation_practice_assignments TO openround_runtime;
 GRANT SELECT,INSERT,UPDATE,DELETE ON presentation_practice_attempts TO openround_runtime;
 GRANT SELECT,INSERT,DELETE ON presentation_practice_receipts TO openround_runtime;
END IF; END $$;

CREATE FUNCTION erase_presentation_practice_account() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public SET app.system_access='on' AS $$
BEGIN
 IF NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL THEN DELETE FROM presentation_practice_assignments WHERE actor_id=NEW.id; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION erase_presentation_practice_account() FROM PUBLIC;
CREATE TRIGGER presentation_practice_account_erasure BEFORE UPDATE OF deleted_at ON users FOR EACH ROW EXECUTE FUNCTION erase_presentation_practice_account();
