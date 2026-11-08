-- Independent pinned reading assignments: acknowledgements and explicit completion are not assessment scores.
CREATE TABLE presentation_assignments (
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
CREATE INDEX presentation_assignments_source_idx ON presentation_assignments(workspace_id,presentation_id,created_at DESC,id DESC);
CREATE INDEX presentation_assignments_expiry_idx ON presentation_assignments(expires_at);
CREATE TABLE presentation_reading_attempts (
 id uuid PRIMARY KEY,
 workspace_id uuid NOT NULL,
 assignment_id uuid NOT NULL,
 token_hash text NOT NULL CHECK(token_hash ~ '^[a-f0-9]{64}$'),
 revision bigint NOT NULL CHECK(revision BETWEEN 0 AND 250),
 read_block_ids uuid[] NOT NULL CHECK(cardinality(read_block_ids)<=200),
 read_revisions jsonb NOT NULL CHECK(jsonb_typeof(read_revisions)='object' AND octet_length(read_revisions::text)<=16384),
 current_block_id uuid,
 started_at timestamptz NOT NULL CHECK(isfinite(started_at)),
 updated_at timestamptz NOT NULL CHECK(isfinite(updated_at) AND updated_at>=started_at),
 completed_at timestamptz CHECK(completed_at IS NULL OR (isfinite(completed_at) AND completed_at=updated_at)),
 UNIQUE(workspace_id,assignment_id,id),
 FOREIGN KEY(workspace_id,assignment_id) REFERENCES presentation_assignments(workspace_id,id) ON DELETE CASCADE
);
CREATE INDEX presentation_reading_attempts_source_idx ON presentation_reading_attempts(workspace_id,assignment_id,id);
CREATE TABLE presentation_reading_receipts (
 workspace_id uuid NOT NULL, assignment_id uuid NOT NULL, attempt_id uuid NOT NULL, request_id uuid NOT NULL,
 request_hash text NOT NULL CHECK(request_hash ~ '^[a-f0-9]{64}$'),
 receipt jsonb NOT NULL CHECK(jsonb_typeof(receipt)='object' AND octet_length(receipt::text)<=512 AND receipt ?& ARRAY['revision','currentBlockId','updatedAt','completedAt'] AND (receipt-ARRAY['revision','currentBlockId','updatedAt','completedAt'])='{}'::jsonb),
 PRIMARY KEY(assignment_id,attempt_id,request_id),
 FOREIGN KEY(workspace_id,assignment_id,attempt_id) REFERENCES presentation_reading_attempts(workspace_id,assignment_id,id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX presentation_reading_receipts_revision_idx ON presentation_reading_receipts(assignment_id,attempt_id,((receipt->>'revision')::bigint));
CREATE FUNCTION guard_presentation_assignment() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='UPDATE' THEN
  IF (to_jsonb(NEW)-'revoked_at') IS DISTINCT FROM (to_jsonb(OLD)-'revoked_at') OR (OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS DISTINCT FROM OLD.revoked_at) THEN RAISE EXCEPTION 'Reading assignments may only be revoked' USING ERRCODE='23514'; END IF;
 ELSE
  PERFORM id FROM workspaces WHERE id=NEW.workspace_id FOR UPDATE;
  PERFORM id FROM presentations WHERE workspace_id=NEW.workspace_id AND id=NEW.presentation_id FOR UPDATE;
  IF (SELECT count(*) FROM presentation_assignments WHERE workspace_id=NEW.workspace_id AND presentation_id=NEW.presentation_id)>=100 OR (SELECT count(*) FROM presentation_assignments WHERE workspace_id=NEW.workspace_id AND presentation_id=NEW.presentation_id AND revoked_at IS NULL AND expires_at>clock_timestamp())>=20 THEN RAISE EXCEPTION 'Reading assignment limit reached' USING ERRCODE='23514'; END IF;
  IF NOT EXISTS(SELECT 1 FROM presentations WHERE workspace_id=NEW.workspace_id AND id=NEW.presentation_id AND status<>'archived') THEN RAISE EXCEPTION 'Reading assignment source is unavailable' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER presentation_assignment_guard BEFORE INSERT OR UPDATE ON presentation_assignments FOR EACH ROW EXECUTE FUNCTION guard_presentation_assignment();
CREATE FUNCTION guard_presentation_reading_attempt() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public SET app.system_access='on' AS $$
DECLARE source presentation_assignments%ROWTYPE; visible uuid[]; total integer;
BEGIN
 -- Repository writes use the same workspace, assignment, attempt order; the workspace bounds starts across assignments.
 IF TG_OP='INSERT' THEN PERFORM id FROM workspaces WHERE id=NEW.workspace_id FOR UPDATE; END IF;
 SELECT * INTO source FROM presentation_assignments WHERE workspace_id=NEW.workspace_id AND id=NEW.assignment_id FOR SHARE;
 IF source.id IS NULL OR source.revoked_at IS NOT NULL OR source.expires_at<=clock_timestamp()
  OR NOT EXISTS(SELECT 1 FROM workspace_members member JOIN users actor ON actor.id=member.user_id WHERE member.workspace_id=source.workspace_id AND member.user_id=source.actor_id AND member.role IN('owner','editor') AND actor.deleted_at IS NULL)
  OR NOT EXISTS(SELECT 1 FROM workspaces WHERE id=source.workspace_id AND deletion_started_at IS NULL)
  OR EXISTS(SELECT 1 FROM workspace_media_deletion_jobs WHERE workspace_id=source.workspace_id)
  OR NOT EXISTS(SELECT 1 FROM presentations WHERE workspace_id=source.workspace_id AND id=source.presentation_id) THEN RAISE EXCEPTION 'Reading assignment is no longer active' USING ERRCODE='23514'; END IF;
 SELECT array_agg((block->>'id')::uuid) INTO visible FROM presentation_versions version CROSS JOIN LATERAL jsonb_array_elements(version.content->'blocks') block WHERE version.workspace_id=source.workspace_id AND version.id=source.version_id AND block->'hidden' IS DISTINCT FROM 'true'::jsonb;
 IF coalesce(cardinality(visible),0) NOT BETWEEN 1 AND 200 OR NOT NEW.read_block_ids <@ visible OR (SELECT count(DISTINCT id) FROM unnest(NEW.read_block_ids) id)<>cardinality(NEW.read_block_ids) OR (NEW.current_block_id IS NOT NULL AND NOT NEW.current_block_id=ANY(NEW.read_block_ids)) OR (SELECT count(*) FROM jsonb_object_keys(NEW.read_revisions))<>cardinality(NEW.read_block_ids) THEN RAISE EXCEPTION 'Reading progress must refer to visible pinned pages' USING ERRCODE='23514'; END IF;
 IF EXISTS(SELECT 1 FROM unnest(NEW.read_block_ids) id WHERE NOT NEW.read_revisions ? id::text OR jsonb_typeof(NEW.read_revisions->id::text)<>'number' OR (NEW.read_revisions->>id::text)::numeric NOT BETWEEN 1 AND NEW.revision OR (NEW.read_revisions->>id::text)::numeric<>trunc((NEW.read_revisions->>id::text)::numeric)) THEN RAISE EXCEPTION 'Reading page acknowledgements require their first revision' USING ERRCODE='23514'; END IF;
 IF NEW.completed_at IS NOT NULL AND NOT visible <@ NEW.read_block_ids THEN RAISE EXCEPTION 'Finishing requires every visible page acknowledgement' USING ERRCODE='23514'; END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.revision<>0 OR cardinality(NEW.read_block_ids)<>0 OR NEW.current_block_id IS NOT NULL OR NEW.completed_at IS NOT NULL OR NEW.updated_at<>NEW.started_at THEN RAISE EXCEPTION 'Reading attempts begin without progress' USING ERRCODE='23514'; END IF;
  IF (SELECT count(*) FROM presentation_reading_attempts WHERE assignment_id=NEW.assignment_id)>=1000 OR (SELECT count(*) FROM presentation_reading_attempts attempt JOIN presentation_assignments parent ON parent.id=attempt.assignment_id WHERE attempt.workspace_id=NEW.workspace_id AND parent.presentation_id=source.presentation_id)>=2000 OR (SELECT count(*) FROM presentation_reading_attempts WHERE workspace_id=NEW.workspace_id)>=5000 THEN RAISE EXCEPTION 'Reading attempt limit reached' USING ERRCODE='23514'; END IF;
 ELSE
  IF OLD.completed_at IS NOT NULL OR NEW.id<>OLD.id OR NEW.workspace_id<>OLD.workspace_id OR NEW.assignment_id<>OLD.assignment_id OR NEW.token_hash<>OLD.token_hash OR NEW.started_at<>OLD.started_at OR NEW.revision<>OLD.revision+1 OR NEW.updated_at<OLD.updated_at OR NOT OLD.read_block_ids <@ NEW.read_block_ids OR NEW.read_block_ids[1:cardinality(OLD.read_block_ids)] IS DISTINCT FROM OLD.read_block_ids OR cardinality(NEW.read_block_ids)>cardinality(OLD.read_block_ids)+1 OR NOT NEW.read_revisions @> OLD.read_revisions THEN RAISE EXCEPTION 'Reading identity and progress must remain monotonic' USING ERRCODE='23514'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_each(NEW.read_revisions) entry WHERE NOT OLD.read_revisions ? entry.key AND entry.value<>to_jsonb(NEW.revision)) THEN RAISE EXCEPTION 'New acknowledgements require the current revision' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION guard_presentation_reading_attempt() FROM PUBLIC;
CREATE TRIGGER presentation_reading_attempt_guard BEFORE INSERT OR UPDATE ON presentation_reading_attempts FOR EACH ROW EXECUTE FUNCTION guard_presentation_reading_attempt();
CREATE FUNCTION guard_presentation_reading_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE attempt presentation_reading_attempts%ROWTYPE;
BEGIN
 IF TG_OP='UPDATE' THEN RAISE EXCEPTION 'Reading receipts are immutable' USING ERRCODE='23514'; END IF;
 SELECT * INTO attempt FROM presentation_reading_attempts WHERE assignment_id=NEW.assignment_id AND id=NEW.attempt_id AND workspace_id=NEW.workspace_id FOR UPDATE;
 IF attempt.id IS NULL OR (NEW.receipt->>'revision')::bigint<>attempt.revision OR attempt.revision<1 OR NEW.receipt->'currentBlockId' IS DISTINCT FROM to_jsonb(attempt.current_block_id) AND NOT (attempt.current_block_id IS NULL AND NEW.receipt->'currentBlockId'='null'::jsonb) OR (NEW.receipt->>'updatedAt')::timestamptz IS DISTINCT FROM attempt.updated_at OR (NEW.receipt->>'completedAt')::timestamptz IS DISTINCT FROM attempt.completed_at OR (SELECT count(*) FROM presentation_reading_receipts WHERE assignment_id=NEW.assignment_id AND attempt_id=NEW.attempt_id)>=250 THEN RAISE EXCEPTION 'Reading receipt must match the accepted bounded revision' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER presentation_reading_receipt_guard BEFORE INSERT OR UPDATE ON presentation_reading_receipts FOR EACH ROW EXECUTE FUNCTION guard_presentation_reading_receipt();
CREATE FUNCTION preserve_presentation_assignment_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF current_setting('app.system_access',true)='on' OR pg_trigger_depth()>1 THEN RETURN OLD; END IF;
 IF TG_TABLE_NAME='presentation_assignments' THEN
  IF OLD.expires_at<=clock_timestamp()-interval '7 days' THEN RETURN OLD; END IF;
 END IF;
 RAISE EXCEPTION 'Reading receipts are retained with their assignment' USING ERRCODE='23514';
END $$;
CREATE TRIGGER presentation_assignment_delete BEFORE DELETE ON presentation_assignments FOR EACH ROW EXECUTE FUNCTION preserve_presentation_assignment_receipt();
CREATE TRIGGER presentation_reading_attempt_delete BEFORE DELETE ON presentation_reading_attempts FOR EACH ROW EXECUTE FUNCTION preserve_presentation_assignment_receipt();
CREATE TRIGGER presentation_reading_receipt_delete BEFORE DELETE ON presentation_reading_receipts FOR EACH ROW EXECUTE FUNCTION preserve_presentation_assignment_receipt();
ALTER TABLE presentation_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE presentation_assignments FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON presentation_assignments USING(current_setting('app.system_access',true)='on' OR workspace_id::text=nullif(current_setting('app.workspace_id',true),'')) WITH CHECK(current_setting('app.system_access',true)='on' OR workspace_id::text=nullif(current_setting('app.workspace_id',true),''));
DO $$ DECLARE target text; BEGIN
 FOREACH target IN ARRAY ARRAY['presentation_reading_attempts','presentation_reading_receipts'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',target);
  EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',target);
  EXECUTE format('CREATE POLICY reading_assignment_scope ON %I USING(current_setting(''app.system_access'',true)=''on'' OR (workspace_id::text=nullif(current_setting(''app.workspace_id'',true),'''') AND assignment_id::text=nullif(current_setting(''app.presentation_assignment_id'',true),''''))) WITH CHECK(current_setting(''app.system_access'',true)=''on'' OR (workspace_id::text=nullif(current_setting(''app.workspace_id'',true),'''') AND assignment_id::text=nullif(current_setting(''app.presentation_assignment_id'',true),'''')))',target);
 END LOOP;
END $$;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='openround_runtime') THEN
 GRANT SELECT,INSERT,DELETE ON presentation_assignments TO openround_runtime;
 REVOKE UPDATE ON presentation_assignments,presentation_reading_receipts FROM openround_runtime;
 GRANT UPDATE(revoked_at) ON presentation_assignments TO openround_runtime;
 GRANT SELECT,INSERT,UPDATE,DELETE ON presentation_reading_attempts TO openround_runtime;
 GRANT SELECT,INSERT,DELETE ON presentation_reading_receipts TO openround_runtime;
END IF; END $$;

CREATE FUNCTION erase_presentation_reading_account() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public SET app.system_access='on' AS $$
BEGIN
 IF NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL THEN DELETE FROM presentation_assignments WHERE actor_id=NEW.id; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION erase_presentation_reading_account() FROM PUBLIC;
CREATE TRIGGER presentation_reading_account_erasure BEFORE UPDATE OF deleted_at ON users FOR EACH ROW EXECUTE FUNCTION erase_presentation_reading_account();
