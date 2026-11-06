-- Additive, explicitly enabled feedback on an existing pinned view-only share.
CREATE TABLE presentation_review_cycles (
 share_id uuid PRIMARY KEY REFERENCES presentation_shares(id) ON DELETE CASCADE,
 workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
 presentation_id uuid NOT NULL, version_id uuid NOT NULL,
 review_seq bigint NOT NULL CHECK(review_seq>=1), next_reviewer_ordinal integer NOT NULL DEFAULT 1 CHECK(next_reviewer_ordinal BETWEEN 1 AND 501),
 approved_by uuid REFERENCES users(id) ON DELETE SET NULL, approved_at timestamptz, approved_seq bigint,
 UNIQUE(workspace_id,share_id),
 FOREIGN KEY(workspace_id,presentation_id,version_id) REFERENCES presentation_versions(workspace_id,presentation_id,id) ON DELETE CASCADE,
 CHECK((approved_by IS NULL AND approved_at IS NULL AND approved_seq IS NULL) OR (approved_by IS NOT NULL AND approved_at IS NOT NULL AND isfinite(approved_at) AND approved_seq BETWEEN 1 AND review_seq))
);
CREATE TABLE presentation_review_threads (
 share_id uuid NOT NULL, workspace_id uuid NOT NULL, id uuid NOT NULL, block_id uuid NOT NULL,
 version bigint NOT NULL CHECK(version>=1), resolved boolean NOT NULL,
 created_at timestamptz NOT NULL CHECK(isfinite(created_at)), updated_at timestamptz NOT NULL CHECK(isfinite(updated_at)), created_seq bigint NOT NULL CHECK(created_seq>=1), changed_seq bigint NOT NULL,
 PRIMARY KEY(share_id,id), UNIQUE(workspace_id,share_id,id),
 FOREIGN KEY(workspace_id,share_id) REFERENCES presentation_review_cycles(workspace_id,share_id) ON DELETE CASCADE
);
CREATE TABLE presentation_review_messages (
 share_id uuid NOT NULL, workspace_id uuid NOT NULL, id uuid NOT NULL, thread_id uuid NOT NULL,
 actor_id uuid REFERENCES users(id) ON DELETE SET NULL, author_role text NOT NULL CHECK(author_role IN('author','reviewer')),
 reviewer_ordinal integer, body text NOT NULL CHECK(visual_import_utf16_length(body)<=2000),
 version bigint NOT NULL CHECK(version>=1), deleted boolean NOT NULL,
 created_at timestamptz NOT NULL CHECK(isfinite(created_at)), updated_at timestamptz NOT NULL CHECK(isfinite(updated_at)), created_seq bigint NOT NULL CHECK(created_seq>=1), changed_seq bigint NOT NULL,
 PRIMARY KEY(share_id,id),
 FOREIGN KEY(workspace_id,share_id,thread_id) REFERENCES presentation_review_threads(workspace_id,share_id,id) ON DELETE CASCADE,
 CHECK((author_role='author' AND reviewer_ordinal IS NULL) OR (author_role='reviewer' AND reviewer_ordinal IS NOT NULL AND reviewer_ordinal BETWEEN 1 AND 500)),
 CHECK(NOT deleted OR body=''), CHECK(actor_id IS NOT NULL OR (deleted AND body=''))
);
CREATE INDEX presentation_review_message_actor ON presentation_review_messages(actor_id,share_id);
CREATE TABLE presentation_review_receipts (
 share_id uuid NOT NULL, workspace_id uuid NOT NULL, actor_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 operation_id uuid NOT NULL, request_hash text NOT NULL CHECK(request_hash~'^[a-f0-9]{64}$'), receipt jsonb NOT NULL,
 PRIMARY KEY(share_id,actor_id,operation_id),
 FOREIGN KEY(workspace_id,share_id) REFERENCES presentation_review_cycles(workspace_id,share_id) ON DELETE CASCADE,
 CHECK(octet_length(receipt::text)<=1024 AND jsonb_typeof(receipt)='object' AND (receipt-ARRAY['operationId','reviewSeq','type','threadId','messageId'])='{}'::jsonb AND receipt ?& ARRAY['operationId','reviewSeq','type','threadId','messageId']),
 CHECK(receipt->>'operationId'=operation_id::text AND (receipt->>'reviewSeq')::bigint>=1 AND receipt->>'type' IN('review.enable','thread.create','message.reply','message.edit','message.delete','thread.resolve','approval.set')),
 CHECK((receipt->'threadId'='null'::jsonb OR openround_presentation_uuid_equal(receipt->>'threadId',receipt->>'threadId')) AND (receipt->'messageId'='null'::jsonb OR openround_presentation_uuid_equal(receipt->>'messageId',receipt->>'messageId')))
);
DO $$ DECLARE target text; BEGIN
 FOREACH target IN ARRAY ARRAY['presentation_review_cycles','presentation_review_threads','presentation_review_messages','presentation_review_receipts'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',target);
  EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',target);
  EXECUTE format('CREATE POLICY presentation_review_scope ON %I USING(current_setting(''app.presentation_review_lifecycle'',true)=''on'' OR (workspace_id::text=nullif(current_setting(''app.workspace_id'',true),'''') AND share_id::text=nullif(current_setting(''app.presentation_review_share_id'',true),''''))) WITH CHECK(current_setting(''app.presentation_review_lifecycle'',true)=''on'' OR (workspace_id::text=nullif(current_setting(''app.workspace_id'',true),'''') AND share_id::text=nullif(current_setting(''app.presentation_review_share_id'',true),'''')))',target);
 END LOOP;
END $$;
CREATE FUNCTION guard_presentation_review_cycle() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public SET app.system_access='on' AS $$
DECLARE source presentation_shares%ROWTYPE;
BEGIN
 SELECT * INTO source FROM presentation_shares WHERE id=NEW.share_id AND workspace_id=NEW.workspace_id FOR UPDATE;
 IF source.id IS NULL OR source.presentation_id<>NEW.presentation_id OR source.version_id<>NEW.version_id THEN RAISE EXCEPTION 'Review source must match its pinned share' USING ERRCODE='23514'; END IF;
 IF TG_OP='INSERT' AND (NEW.review_seq<>1 OR NEW.next_reviewer_ordinal<>1 OR NEW.approved_seq IS NOT NULL) THEN RAISE EXCEPTION 'New reviews begin without feedback or approval' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' AND ((to_jsonb(NEW)-ARRAY['review_seq','next_reviewer_ordinal','approved_by','approved_at','approved_seq']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['review_seq','next_reviewer_ordinal','approved_by','approved_at','approved_seq']) OR NEW.review_seq NOT BETWEEN OLD.review_seq AND OLD.review_seq+1 OR NEW.next_reviewer_ordinal<OLD.next_reviewer_ordinal OR (NEW.review_seq=OLD.review_seq AND (NEW.next_reviewer_ordinal<>OLD.next_reviewer_ordinal OR ROW(NEW.approved_by,NEW.approved_at,NEW.approved_seq) IS DISTINCT FROM ROW(OLD.approved_by,OLD.approved_at,OLD.approved_seq)))) THEN RAISE EXCEPTION 'Review source and revision are immutable or monotonic' USING ERRCODE='23514'; END IF;
 IF current_setting('app.presentation_review_lifecycle',true) IS DISTINCT FROM 'on' THEN
  IF source.revoked_at IS NOT NULL OR source.expires_at<=clock_timestamp() OR NOT EXISTS(SELECT 1 FROM presentations WHERE id=NEW.presentation_id AND workspace_id=NEW.workspace_id AND status<>'archived') OR NOT EXISTS(SELECT 1 FROM workspace_members member JOIN users actor ON actor.id=member.user_id WHERE member.workspace_id=NEW.workspace_id AND member.user_id=source.actor_id AND member.role IN('owner','editor') AND actor.deleted_at IS NULL) THEN RAISE EXCEPTION 'Review share is no longer active' USING ERRCODE='23514'; END IF;
  IF NEW.approved_seq=NEW.review_seq AND (NOT EXISTS(SELECT 1 FROM workspace_members member JOIN users actor ON actor.id=member.user_id WHERE member.workspace_id=NEW.workspace_id AND member.user_id=NEW.approved_by AND member.role IN('owner','editor') AND actor.deleted_at IS NULL) OR EXISTS(SELECT 1 FROM presentation_review_threads WHERE share_id=NEW.share_id AND NOT resolved)) THEN RAISE EXCEPTION 'Author approval requires current membership and no open discussions' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER presentation_review_cycle_guard BEFORE INSERT OR UPDATE ON presentation_review_cycles FOR EACH ROW EXECUTE FUNCTION guard_presentation_review_cycle();
REVOKE ALL ON FUNCTION guard_presentation_review_cycle() FROM PUBLIC;
CREATE FUNCTION guard_presentation_review_discussion() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public SET app.system_access='on' AS $$
DECLARE cycle presentation_review_cycles%ROWTYPE; total integer;
BEGIN
 SELECT * INTO cycle FROM presentation_review_cycles WHERE share_id=NEW.share_id AND workspace_id=NEW.workspace_id FOR UPDATE;
 IF cycle.share_id IS NULL OR cycle.review_seq<2 OR NEW.changed_seq<>cycle.review_seq THEN RAISE EXCEPTION 'Discussion requires its fenced review revision' USING ERRCODE='23514'; END IF;
 IF (TG_OP='INSERT' AND (NEW.version<>1 OR NEW.created_seq<>NEW.changed_seq)) OR NEW.created_seq>NEW.changed_seq OR (TG_OP='UPDATE' AND (NEW.created_seq<>OLD.created_seq OR NEW.changed_seq<=OLD.changed_seq OR NEW.version<>OLD.version+1 OR NEW.created_at<>OLD.created_at OR NEW.share_id<>OLD.share_id OR NEW.workspace_id<>OLD.workspace_id OR NEW.id<>OLD.id)) THEN RAISE EXCEPTION 'Discussion source and versions must remain fenced' USING ERRCODE='23514'; END IF;
 IF TG_TABLE_NAME='presentation_review_threads' THEN
  IF (TG_OP='INSERT' AND NEW.resolved) OR (cycle.approved_seq=cycle.review_seq AND NOT NEW.resolved) THEN RAISE EXCEPTION 'Open discussions cannot retain current approval' USING ERRCODE='23514'; END IF;
  IF TG_OP='UPDATE' AND NEW.block_id<>OLD.block_id THEN RAISE EXCEPTION 'Discussion anchor is immutable' USING ERRCODE='23514'; END IF;
  IF (SELECT count(*) FROM presentation_versions version CROSS JOIN LATERAL jsonb_array_elements(version.content->'blocks') block WHERE version.id=cycle.version_id AND version.workspace_id=cycle.workspace_id AND openround_presentation_uuid_equal(block->>'id',NEW.block_id::text) AND block->'hidden' IS DISTINCT FROM 'true'::jsonb)<>1 THEN RAISE EXCEPTION 'Review anchor must be one published visible block' USING ERRCODE='23514'; END IF;
  SELECT count(*) INTO total FROM presentation_review_threads WHERE share_id=NEW.share_id AND id<>NEW.id;
  IF total>=100 THEN RAISE EXCEPTION 'Review discussion limit reached' USING ERRCODE='23514'; END IF;
 ELSE
  IF TG_OP='INSERT' AND EXISTS(SELECT 1 FROM presentation_review_threads WHERE share_id=NEW.share_id AND id=NEW.thread_id AND resolved) THEN RAISE EXCEPTION 'Resolved discussions must be reopened before replies' USING ERRCODE='23514'; END IF;
  IF current_setting('app.presentation_review_lifecycle',true) IS DISTINCT FROM 'on' AND NEW.author_role='reviewer' AND (NEW.reviewer_ordinal>=cycle.next_reviewer_ordinal OR EXISTS(SELECT 1 FROM presentation_review_messages WHERE share_id=NEW.share_id AND author_role='reviewer' AND ((actor_id=NEW.actor_id AND reviewer_ordinal<>NEW.reviewer_ordinal) OR (reviewer_ordinal=NEW.reviewer_ordinal AND actor_id IS DISTINCT FROM NEW.actor_id)))) THEN RAISE EXCEPTION 'Reviewer labels are stable and unique within a review' USING ERRCODE='23514'; END IF;
  IF current_setting('app.presentation_review_lifecycle',true) IS DISTINCT FROM 'on' AND (NEW.actor_id IS NULL OR NOT EXISTS(SELECT 1 FROM users WHERE id=NEW.actor_id AND deleted_at IS NULL) OR (NEW.author_role='author' AND NOT EXISTS(SELECT 1 FROM workspace_members WHERE workspace_id=NEW.workspace_id AND user_id=NEW.actor_id AND role IN('owner','editor')))) THEN RAISE EXCEPTION 'Comment author must remain authorized' USING ERRCODE='23514'; END IF;
  IF TG_OP='UPDATE' AND (NEW.thread_id<>OLD.thread_id OR NEW.author_role<>OLD.author_role OR NEW.reviewer_ordinal IS DISTINCT FROM OLD.reviewer_ordinal OR (NEW.actor_id IS DISTINCT FROM OLD.actor_id AND current_setting('app.presentation_review_lifecycle',true) IS DISTINCT FROM 'on') OR (OLD.deleted AND (NOT NEW.deleted OR NEW.body<>''))) THEN RAISE EXCEPTION 'Comment identity and removed bodies cannot be restored' USING ERRCODE='23514'; END IF;
  IF (SELECT count(*) FROM presentation_review_messages WHERE share_id=NEW.share_id AND id<>NEW.id)>=500 OR (SELECT count(*) FROM presentation_review_messages WHERE share_id=NEW.share_id AND thread_id=NEW.thread_id AND id<>NEW.id)>=20 OR (SELECT COALESCE(sum(octet_length(body)),0) FROM presentation_review_messages WHERE share_id=NEW.share_id AND id<>NEW.id)+octet_length(NEW.body)>524288 THEN RAISE EXCEPTION 'Review comment limit reached' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER presentation_review_thread_guard BEFORE INSERT OR UPDATE ON presentation_review_threads FOR EACH ROW EXECUTE FUNCTION guard_presentation_review_discussion();
CREATE TRIGGER presentation_review_message_guard BEFORE INSERT OR UPDATE ON presentation_review_messages FOR EACH ROW EXECUTE FUNCTION guard_presentation_review_discussion();
REVOKE ALL ON FUNCTION guard_presentation_review_discussion() FROM PUBLIC;
CREATE FUNCTION guard_presentation_review_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='UPDATE' THEN RAISE EXCEPTION 'Review receipts are immutable' USING ERRCODE='23514'; END IF;
 PERFORM share_id FROM presentation_review_cycles WHERE share_id=NEW.share_id AND workspace_id=NEW.workspace_id FOR UPDATE;
 IF (NEW.receipt->>'reviewSeq')::bigint>(SELECT review_seq FROM presentation_review_cycles WHERE share_id=NEW.share_id) OR (SELECT count(*) FROM presentation_review_receipts WHERE share_id=NEW.share_id)>=5000 THEN RAISE EXCEPTION 'Review receipt limit or revision mismatch' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER presentation_review_receipt_guard BEFORE INSERT OR UPDATE ON presentation_review_receipts FOR EACH ROW EXECUTE FUNCTION guard_presentation_review_receipt();
CREATE FUNCTION guard_presentation_review_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF pg_trigger_depth()>1 OR current_setting('app.presentation_review_lifecycle',true)='on' OR NOT EXISTS(SELECT 1 FROM presentation_shares WHERE id=OLD.share_id) THEN RETURN OLD; END IF;
 RAISE EXCEPTION 'Review history is retained with its source share' USING ERRCODE='23514';
END $$;
CREATE TRIGGER presentation_review_cycle_delete BEFORE DELETE ON presentation_review_cycles FOR EACH ROW EXECUTE FUNCTION guard_presentation_review_delete();
CREATE TRIGGER presentation_review_thread_delete BEFORE DELETE ON presentation_review_threads FOR EACH ROW EXECUTE FUNCTION guard_presentation_review_delete();
CREATE TRIGGER presentation_review_message_delete BEFORE DELETE ON presentation_review_messages FOR EACH ROW EXECUTE FUNCTION guard_presentation_review_delete();
CREATE TRIGGER presentation_review_receipt_delete BEFORE DELETE ON presentation_review_receipts FOR EACH ROW EXECUTE FUNCTION guard_presentation_review_delete();
CREATE FUNCTION erase_presentation_review_account() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public SET app.presentation_review_lifecycle='on' SET app.system_access='on' AS $$
DECLARE target uuid; cycle_id uuid;
BEGIN
 target:=CASE WHEN TG_OP='DELETE' THEN OLD.id ELSE NEW.id END;
 IF TG_OP='UPDATE' AND (NEW.deleted_at IS NULL OR OLD.deleted_at IS NOT NULL) THEN RETURN NEW; END IF;
 -- Match normal access order (share, then cycle) before erasing an external reviewer's bodies.
 PERFORM id FROM presentation_shares WHERE id IN(SELECT share_id FROM presentation_review_cycles WHERE approved_by=target OR share_id IN(SELECT share_id FROM presentation_review_messages WHERE actor_id=target)) ORDER BY id FOR UPDATE;
 FOR cycle_id IN SELECT share_id FROM presentation_review_cycles WHERE approved_by=target OR share_id IN(SELECT share_id FROM presentation_review_messages WHERE actor_id=target) FOR UPDATE LOOP
  UPDATE presentation_review_cycles SET review_seq=review_seq+1,approved_by=CASE WHEN approved_by=target THEN NULL ELSE approved_by END,approved_at=CASE WHEN approved_by=target THEN NULL ELSE approved_at END,approved_seq=CASE WHEN approved_by=target THEN NULL ELSE approved_seq END WHERE share_id=cycle_id;
  UPDATE presentation_review_threads SET version=version+1,changed_seq=(SELECT review_seq FROM presentation_review_cycles WHERE share_id=cycle_id),updated_at=clock_timestamp() WHERE share_id=cycle_id AND id IN(SELECT thread_id FROM presentation_review_messages WHERE share_id=cycle_id AND actor_id=target);
  UPDATE presentation_review_messages SET actor_id=NULL,body='',deleted=true,version=version+1,changed_seq=(SELECT review_seq FROM presentation_review_cycles WHERE share_id=cycle_id),updated_at=clock_timestamp() WHERE share_id=cycle_id AND actor_id=target;
 END LOOP;
 DELETE FROM presentation_review_receipts WHERE actor_id=target;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION erase_presentation_review_account() FROM PUBLIC;
CREATE TRIGGER presentation_review_account_erasure BEFORE UPDATE OF deleted_at OR DELETE ON users FOR EACH ROW EXECUTE FUNCTION erase_presentation_review_account();
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='openround_runtime') THEN
 GRANT SELECT,INSERT,UPDATE,DELETE ON presentation_review_cycles,presentation_review_threads,presentation_review_messages,presentation_review_receipts TO openround_runtime;
END IF; END $$;
