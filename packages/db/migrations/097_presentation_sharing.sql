-- Private view-only links pin existing immutable publications; no attempts or source rewrites.
CREATE TABLE presentation_shares (
 id uuid PRIMARY KEY,
 workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
 presentation_id uuid NOT NULL,
 version_id uuid NOT NULL,
 actor_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 request_id uuid NOT NULL,
 intent_hash text NOT NULL CHECK(intent_hash ~ '^[a-f0-9]{64}$'),
 token_hash text NOT NULL UNIQUE CHECK(token_hash ~ '^[a-f0-9]{64}$'),
 created_at timestamptz NOT NULL,
 expires_at timestamptz NOT NULL CHECK(isfinite(expires_at) AND isfinite(created_at) AND expires_at>created_at AND expires_at<=created_at+interval '30 days'),
 revoked_at timestamptz,
 UNIQUE(workspace_id,actor_id,request_id),
 FOREIGN KEY(workspace_id,presentation_id,version_id) REFERENCES presentation_versions(workspace_id,presentation_id,id) ON DELETE CASCADE
);
CREATE INDEX presentation_shares_source_idx ON presentation_shares(workspace_id,presentation_id,created_at DESC,id DESC);
CREATE INDEX presentation_shares_expiry_idx ON presentation_shares(expires_at);
CREATE FUNCTION enforce_presentation_share() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='UPDATE' THEN
  IF (to_jsonb(NEW)-'revoked_at') IS DISTINCT FROM (to_jsonb(OLD)-'revoked_at') OR (OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS DISTINCT FROM OLD.revoked_at) THEN
   RAISE EXCEPTION 'Presentation capabilities may only be revoked' USING ERRCODE='23514';
  END IF;
 ELSE
  PERFORM id FROM presentations WHERE workspace_id=NEW.workspace_id AND id=NEW.presentation_id FOR UPDATE;
  IF (SELECT count(*) FROM presentation_shares WHERE workspace_id=NEW.workspace_id AND presentation_id=NEW.presentation_id)>=100
   OR (NEW.revoked_at IS NULL AND NEW.expires_at>clock_timestamp() AND (SELECT count(*) FROM presentation_shares WHERE workspace_id=NEW.workspace_id AND presentation_id=NEW.presentation_id AND revoked_at IS NULL AND expires_at>clock_timestamp())>=20) THEN
   RAISE EXCEPTION 'Presentation link limit reached' USING ERRCODE='23514';
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER presentation_share_immutable BEFORE INSERT OR UPDATE ON presentation_shares FOR EACH ROW EXECUTE FUNCTION enforce_presentation_share();
CREATE FUNCTION preserve_presentation_share_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF current_setting('app.system_access',true)='on' OR OLD.expires_at<=clock_timestamp()-interval '7 days'
  OR NOT EXISTS(SELECT 1 FROM presentations WHERE workspace_id=OLD.workspace_id AND id=OLD.presentation_id)
  OR NOT EXISTS(SELECT 1 FROM workspaces WHERE id=OLD.workspace_id) THEN RETURN OLD; END IF;
 IF pg_trigger_depth()>1 THEN RETURN OLD; END IF;
 RAISE EXCEPTION 'Retained Presentation link receipts must be revoked' USING ERRCODE='23514';
END $$;
CREATE TRIGGER presentation_share_receipt_delete BEFORE DELETE ON presentation_shares FOR EACH ROW EXECUTE FUNCTION preserve_presentation_share_receipt();
ALTER TABLE presentation_shares ENABLE ROW LEVEL SECURITY;
ALTER TABLE presentation_shares FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON presentation_shares USING(current_setting('app.system_access',true)='on' OR workspace_id::text=nullif(current_setting('app.workspace_id',true),'')) WITH CHECK(current_setting('app.system_access',true)='on' OR workspace_id::text=nullif(current_setting('app.workspace_id',true),''));
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='openround_runtime') THEN
 GRANT SELECT,INSERT,DELETE ON presentation_shares TO openround_runtime;
 REVOKE UPDATE ON presentation_shares FROM openround_runtime;
 GRANT UPDATE(revoked_at) ON presentation_shares TO openround_runtime;
END IF; END $$;
