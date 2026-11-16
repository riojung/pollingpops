-- An explicit published-content catalog. Workspace ownership and its RLS are unchanged.
CREATE TABLE library_shares (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  artifact_type text NOT NULL CHECK(artifact_type IN ('round','presentation','survey')),
  artifact_id uuid NOT NULL,
  version_id uuid NOT NULL,
  title text NOT NULL,
  description text NOT NULL,
  snapshot jsonb NOT NULL CHECK(jsonb_typeof(snapshot)='object'),
  audience text NOT NULL CHECK(audience IN ('organization','people')),
  recipient_ids uuid[] NOT NULL DEFAULT '{}',
  permission text NOT NULL CHECK(permission IN ('view','use')),
  message text NOT NULL CHECK(char_length(message)<=1000),
  due_at timestamptz CHECK(due_at IS NULL OR isfinite(due_at)),
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  request_id uuid NOT NULL,
  intent_hash text NOT NULL CHECK(intent_hash ~ '^[a-f0-9]{64}$'),
  shared_at timestamptz NOT NULL CHECK(isfinite(shared_at)),
  revoked_at timestamptz,
  CHECK((audience='organization' AND cardinality(recipient_ids)=0) OR
        (audience='people' AND cardinality(recipient_ids) BETWEEN 1 AND 50)),
  UNIQUE(workspace_id,created_by,request_id)
);
CREATE INDEX library_shares_organization_idx ON library_shares(organization_id,shared_at DESC,id DESC) WHERE revoked_at IS NULL;
CREATE INDEX library_shares_source_idx ON library_shares(workspace_id,artifact_type,artifact_id);
CREATE INDEX library_shares_recipients_idx ON library_shares USING gin(recipient_ids) WHERE revoked_at IS NULL;
CREATE TABLE library_share_progress (
  share_id uuid NOT NULL REFERENCES library_shares(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status text NOT NULL CHECK(status IN ('in_progress','done')),
  updated_at timestamptz NOT NULL,
  PRIMARY KEY(share_id,user_id)
);
CREATE TABLE library_share_copies (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  request_id uuid NOT NULL,
  share_id uuid NOT NULL REFERENCES library_shares(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  artifact_type text NOT NULL CHECK(artifact_type IN ('round','presentation','survey')),
  artifact_id uuid NOT NULL,
  created_at timestamptz NOT NULL,
  PRIMARY KEY(user_id,request_id)
);

-- Discovery starts with an authenticated principal, never source-workspace membership.
-- This bounded predicate exposes no organization roster or private content.
CREATE FUNCTION openround_library_actor_access(source_workspace uuid, source_organization uuid,
  share_audience text, recipients uuid[], requested_action text, publication_time timestamptz DEFAULT NULL) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public SET app.system_access='on' AS $$
  SELECT EXISTS(
    SELECT 1 FROM public.users principal
    JOIN public.organization_members member ON member.user_id=principal.id AND member.organization_id=source_organization
    JOIN public.organizations organization ON organization.id=member.organization_id
    JOIN public.workspaces workspace ON workspace.id=source_workspace AND workspace.organization_id=organization.id
    LEFT JOIN public.workspace_members workspace_member ON workspace_member.workspace_id=workspace.id AND workspace_member.user_id=principal.id
    WHERE principal.id::text=nullif(current_setting('app.library_user_id',true),'')
      AND principal.deleted_at IS NULL AND principal.email_verified_at IS NOT NULL
      AND member.role<>'billing' AND organization.account_type='organization' AND organization.status='active'
      AND workspace.platform_status='active' AND workspace.deletion_started_at IS NULL
      AND NOT EXISTS(SELECT 1 FROM public.workspace_media_deletion_jobs job WHERE job.workspace_id=workspace.id)
      AND CASE requested_action
        WHEN 'create' THEN workspace_member.role IN ('owner','editor')
        WHEN 'manage' THEN workspace_member.role IN ('owner','editor') OR member.role IN ('owner','admin')
        WHEN 'read' THEN workspace_member.role IN ('owner','editor') OR member.role IN ('owner','admin')
          OR share_audience='organization' OR (principal.id=ANY(recipients) AND member.created_at<=publication_time)
        ELSE false END
  )
$$;
REVOKE ALL ON FUNCTION openround_library_actor_access(uuid,uuid,text,uuid[],text,timestamptz) FROM PUBLIC;

CREATE FUNCTION enforce_library_share_source() RETURNS trigger LANGUAGE plpgsql
SECURITY DEFINER SET search_path=pg_catalog,public SET app.system_access='on' AS $$
DECLARE source_organization uuid;
BEGIN
  IF TG_OP='UPDATE' THEN
    IF current_setting('app.system_access',true)='on' AND NEW.created_by IS NULL AND
       (to_jsonb(NEW)-'created_by') IS NOT DISTINCT FROM (to_jsonb(OLD)-'created_by') THEN RETURN NEW; END IF;
    IF (to_jsonb(NEW)-'revoked_at') IS DISTINCT FROM (to_jsonb(OLD)-'revoked_at') OR
       (OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS DISTINCT FROM OLD.revoked_at) THEN
      RAISE EXCEPTION 'Library publications can only be revoked' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
  END IF;
  SELECT organization_id INTO source_organization FROM public.workspaces WHERE id=NEW.workspace_id FOR SHARE;
  IF source_organization IS DISTINCT FROM NEW.organization_id THEN
    RAISE EXCEPTION 'Library publication organization must match its source' USING ERRCODE='23514';
  END IF;
  IF NEW.artifact_type='round' THEN
    PERFORM 1 FROM public.quizzes parent JOIN public.quiz_versions version
      ON version.workspace_id=parent.workspace_id AND version.quiz_id=parent.id
      WHERE parent.workspace_id=NEW.workspace_id AND parent.id=NEW.artifact_id AND parent.status<>'archived' AND version.id=NEW.version_id FOR SHARE OF parent,version;
  ELSIF NEW.artifact_type='presentation' THEN
    PERFORM 1 FROM public.presentations parent JOIN public.presentation_versions version
      ON version.workspace_id=parent.workspace_id AND version.presentation_id=parent.id
      WHERE parent.workspace_id=NEW.workspace_id AND parent.id=NEW.artifact_id AND parent.status<>'archived' AND version.id=NEW.version_id FOR SHARE OF parent,version;
  ELSE
    PERFORM 1 FROM public.surveys parent JOIN public.survey_versions version
      ON version.workspace_id=parent.workspace_id AND version.survey_id=parent.id
      WHERE parent.workspace_id=NEW.workspace_id AND parent.id=NEW.artifact_id AND parent.data->>'status'<>'archived' AND version.id=NEW.version_id FOR SHARE OF parent,version;
  END IF;
  IF NOT FOUND THEN RAISE EXCEPTION 'Published source must belong to the Library item' USING ERRCODE='23503'; END IF;
  IF EXISTS(SELECT 1 FROM unnest(NEW.recipient_ids) recipient WHERE NOT EXISTS(
    SELECT 1 FROM public.organization_members member JOIN public.users principal ON principal.id=member.user_id
    WHERE member.organization_id=NEW.organization_id AND member.user_id=recipient AND member.role<>'billing'
      AND principal.deleted_at IS NULL AND principal.email_verified_at IS NOT NULL)) THEN
    RAISE EXCEPTION 'Choose current verified organization members' USING ERRCODE='23514';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('library-share:'||NEW.organization_id::text,111));
  IF (SELECT count(*) FROM public.library_shares WHERE organization_id=NEW.organization_id AND revoked_at IS NULL)>=1000 OR
     (SELECT count(*) FROM public.library_shares WHERE workspace_id=NEW.workspace_id AND artifact_type=NEW.artifact_type AND artifact_id=NEW.artifact_id AND revoked_at IS NULL)>=100 THEN
    RAISE EXCEPTION 'Library sharing limit reached' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION enforce_library_share_source() FROM PUBLIC;
CREATE TRIGGER library_share_source BEFORE INSERT OR UPDATE ON library_shares FOR EACH ROW EXECUTE FUNCTION enforce_library_share_source();

CREATE FUNCTION remove_library_publications() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public SET app.system_access='on' AS $$
DECLARE kind text;
BEGIN
  IF TG_TABLE_SCHEMA<>'public' OR TG_TABLE_NAME NOT IN ('quizzes','presentations','surveys') THEN
    RAISE EXCEPTION 'Library cleanup requires a source artifact' USING ERRCODE='23514';
  END IF;
  kind:=CASE TG_TABLE_NAME WHEN 'quizzes' THEN 'round' WHEN 'presentations' THEN 'presentation' ELSE 'survey' END;
  DELETE FROM public.library_shares WHERE workspace_id=OLD.workspace_id AND artifact_type=kind AND artifact_id=OLD.id;
  RETURN OLD;
END $$;
REVOKE ALL ON FUNCTION remove_library_publications() FROM PUBLIC;
CREATE TRIGGER quizzes_remove_library_publications AFTER DELETE ON quizzes FOR EACH ROW EXECUTE FUNCTION remove_library_publications();
CREATE TRIGGER presentations_remove_library_publications AFTER DELETE ON presentations FOR EACH ROW EXECUTE FUNCTION remove_library_publications();
CREATE TRIGGER surveys_remove_library_publications AFTER DELETE ON surveys FOR EACH ROW EXECUTE FUNCTION remove_library_publications();

-- Direct assignment eligibility also requires membership predating publication, so
-- removing and re-adding a member does not resurrect their former assignments.
CREATE FUNCTION remove_library_member_assignments() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public SET app.system_access='on' AS $$
BEGIN
  DELETE FROM public.library_share_progress progress USING public.library_shares share
    WHERE progress.share_id=share.id AND share.organization_id=OLD.organization_id AND progress.user_id=OLD.user_id;
  -- Immutable recipient sets are retained as publication history. Live membership gates every read.
  RETURN OLD;
END $$;
REVOKE ALL ON FUNCTION remove_library_member_assignments() FROM PUBLIC;
CREATE TRIGGER organization_members_remove_library_progress AFTER DELETE ON organization_members FOR EACH ROW EXECUTE FUNCTION remove_library_member_assignments();

CREATE FUNCTION erase_library_user_attribution() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public SET app.system_access='on' AS $$
BEGIN
  IF NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL THEN
    UPDATE public.library_shares SET created_by=NULL WHERE created_by=NEW.id;
    DELETE FROM public.library_share_progress WHERE user_id=NEW.id;
    DELETE FROM public.library_share_copies WHERE user_id=NEW.id;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION erase_library_user_attribution() FROM PUBLIC;
CREATE TRIGGER users_erase_library_attribution AFTER UPDATE OF deleted_at ON users FOR EACH ROW EXECUTE FUNCTION erase_library_user_attribution();

ALTER TABLE library_shares ENABLE ROW LEVEL SECURITY;
ALTER TABLE library_shares FORCE ROW LEVEL SECURITY;
CREATE POLICY library_actor_read ON library_shares FOR SELECT USING(current_setting('app.system_access',true)='on' OR
  ((revoked_at IS NULL OR openround_library_actor_access(workspace_id,organization_id,audience,recipient_ids,'manage')) AND
   openround_library_actor_access(workspace_id,organization_id,audience,recipient_ids,'read',shared_at)));
CREATE POLICY library_actor_create ON library_shares FOR INSERT WITH CHECK(
  created_by::text=nullif(current_setting('app.library_user_id',true),'') AND
  openround_library_actor_access(workspace_id,organization_id,audience,recipient_ids,'create'));
CREATE POLICY library_actor_revoke ON library_shares FOR UPDATE USING(
  current_setting('app.system_access',true)='on' OR openround_library_actor_access(workspace_id,organization_id,audience,recipient_ids,'manage')) WITH CHECK(
  current_setting('app.system_access',true)='on' OR openround_library_actor_access(workspace_id,organization_id,audience,recipient_ids,'manage'));
ALTER TABLE library_share_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE library_share_progress FORCE ROW LEVEL SECURITY;
CREATE POLICY library_own_progress ON library_share_progress USING(current_setting('app.system_access',true)='on' OR
  (user_id::text=nullif(current_setting('app.library_user_id',true),'') AND EXISTS(SELECT 1 FROM library_shares share WHERE share.id=share_id AND share.revoked_at IS NULL))) WITH CHECK(
  user_id::text=nullif(current_setting('app.library_user_id',true),'') AND EXISTS(SELECT 1 FROM library_shares share WHERE share.id=share_id AND share.revoked_at IS NULL));
ALTER TABLE library_share_copies ENABLE ROW LEVEL SECURITY;
ALTER TABLE library_share_copies FORCE ROW LEVEL SECURITY;
CREATE POLICY library_own_copy_receipts ON library_share_copies USING(current_setting('app.system_access',true)='on' OR user_id::text=nullif(current_setting('app.library_user_id',true),'')) WITH CHECK(user_id::text=nullif(current_setting('app.library_user_id',true),''));
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='openround_runtime') THEN
  GRANT EXECUTE ON FUNCTION openround_library_actor_access(uuid,uuid,text,uuid[],text,timestamptz) TO openround_runtime;
  GRANT SELECT,INSERT ON library_shares TO openround_runtime;
  GRANT UPDATE(revoked_at) ON library_shares TO openround_runtime;
  GRANT SELECT,INSERT,UPDATE,DELETE ON library_share_progress TO openround_runtime;
  GRANT SELECT,INSERT ON library_share_copies TO openround_runtime;
END IF; END $$;
