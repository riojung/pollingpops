-- Workspace collections retain their original workspace/canvas foreign keys and authority.
ALTER TABLE collaboration_groups ADD COLUMN purpose text NOT NULL DEFAULT 'team'
  CHECK(purpose IN ('team','department','project','cohort','community','other'));
ALTER TABLE collaboration_groups ADD COLUMN status text NOT NULL DEFAULT 'active'
  CHECK(status IN ('active','archived'));

CREATE FUNCTION openround_workspace_group_activity() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent_id uuid; parent_status text;
BEGIN
  parent_id := CASE WHEN TG_OP='DELETE' THEN OLD.group_id ELSE NEW.group_id END;
  SELECT status INTO parent_status FROM collaboration_groups WHERE id=parent_id FOR UPDATE;
  IF parent_status='archived' AND current_setting('app.system_access',true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'Archived groups are read-only' USING ERRCODE='23514';
  END IF;
  UPDATE collaboration_groups SET updated_at=clock_timestamp() WHERE id=parent_id;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
DO $$ DECLARE target text; BEGIN
  FOREACH target IN ARRAY ARRAY['collaboration_group_members','collaboration_group_artifacts','collaboration_group_messages','collaboration_group_schedule'] LOOP
    EXECUTE format('CREATE TRIGGER group_activity BEFORE INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION openround_workspace_group_activity()',target);
  END LOOP;
END $$;
CREATE FUNCTION openround_workspace_group_restore_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status='archived' AND current_setting('app.system_access',true) IS DISTINCT FROM 'on' AND
    (NEW.status<>'active' OR NEW.name<>OLD.name OR NEW.description<>OLD.description OR NEW.purpose<>OLD.purpose) THEN
    RAISE EXCEPTION 'Restore this group before making changes' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER group_restore_only BEFORE UPDATE ON collaboration_groups FOR EACH ROW EXECUTE FUNCTION openround_workspace_group_restore_only();

CREATE TABLE organization_collaboration_groups (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL CHECK(char_length(name) BETWEEN 1 AND 120),
  description text NOT NULL DEFAULT '' CHECK(char_length(description)<=1000),
  purpose text NOT NULL DEFAULT 'team' CHECK(purpose IN ('team','department','project','cohort','community','other')),
  status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','archived')),
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(organization_id,id)
);
CREATE TABLE organization_collaboration_group_members (
  organization_id uuid NOT NULL,
  group_id uuid NOT NULL,
  user_id uuid NOT NULL,
  role text NOT NULL CHECK(role IN ('owner','member')),
  joined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(group_id,user_id),
  FOREIGN KEY(organization_id,group_id) REFERENCES organization_collaboration_groups(organization_id,id) ON DELETE CASCADE,
  FOREIGN KEY(organization_id,user_id) REFERENCES organization_members(organization_id,user_id) ON DELETE CASCADE
);
CREATE INDEX organization_group_members_user_idx ON organization_collaboration_group_members(user_id,group_id);
CREATE TABLE organization_collaboration_group_messages (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  group_id uuid NOT NULL,
  author_id uuid REFERENCES users(id) ON DELETE SET NULL,
  body text NOT NULL CHECK(char_length(body) BETWEEN 1 AND 2000),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(organization_id,group_id) REFERENCES organization_collaboration_groups(organization_id,id) ON DELETE CASCADE
);
CREATE INDEX organization_group_messages_group_idx ON organization_collaboration_group_messages(group_id,created_at,id);
CREATE TABLE organization_collaboration_group_library (
  organization_id uuid NOT NULL,
  group_id uuid NOT NULL,
  share_id uuid NOT NULL REFERENCES library_shares(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(group_id,share_id),
  FOREIGN KEY(organization_id,group_id) REFERENCES organization_collaboration_groups(organization_id,id) ON DELETE CASCADE
);
CREATE FUNCTION openround_organization_group_publication() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public SET app.system_access='on' AS $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.library_shares share WHERE share.id=NEW.share_id
    AND share.organization_id=NEW.organization_id AND share.audience='organization' AND share.revoked_at IS NULL) THEN
    RAISE EXCEPTION 'Choose an active organization-wide publication in this organization' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION openround_organization_group_publication() FROM PUBLIC;
CREATE TRIGGER organization_group_publication BEFORE INSERT OR UPDATE ON organization_collaboration_group_library FOR EACH ROW EXECUTE FUNCTION openround_organization_group_publication();

-- Narrow principal-scoped read capability. No policy exposes an organization roster or unjoined group.
CREATE FUNCTION openround_organization_group_access(org uuid, target uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public SET app.system_access='on' AS $$
  SELECT EXISTS(SELECT 1 FROM public.users principal
    JOIN public.organization_members member ON member.user_id=principal.id AND member.organization_id=org
    JOIN public.organizations organization ON organization.id=org
    JOIN public.organization_collaboration_group_members joined ON joined.organization_id=org AND joined.group_id=target AND joined.user_id=principal.id
    WHERE principal.id::text=nullif(current_setting('app.group_user_id',true),'')
      AND principal.email_verified_at IS NOT NULL AND principal.deleted_at IS NULL
      AND member.role<>'billing' AND organization.status='active' AND organization.account_type='organization');
$$;
REVOKE ALL ON FUNCTION openround_organization_group_access(uuid,uuid) FROM PUBLIC;
DO $$ DECLARE target text; BEGIN
  FOREACH target IN ARRAY ARRAY['organization_collaboration_groups','organization_collaboration_group_members','organization_collaboration_group_messages','organization_collaboration_group_library'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',target);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',target);
    EXECUTE format('CREATE POLICY organization_group_read ON %I FOR SELECT USING(current_setting(''app.system_access'',true)=''on'' OR openround_organization_group_access(organization_id,%I))',target,CASE WHEN target='organization_collaboration_groups' THEN 'id' ELSE 'group_id' END);
    -- Mutations enter only through the trusted repository, which holds identity/org fences,
    -- validates current authority and locks the group before modifying its state.
    EXECUTE format('CREATE POLICY organization_group_write ON %I FOR ALL USING(current_setting(''app.system_access'',true)=''on'') WITH CHECK(current_setting(''app.system_access'',true)=''on'')',target);
  END LOOP;
END $$;

CREATE FUNCTION openround_organization_group_successor() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public SET app.system_access='on' AS $$
DECLARE successor uuid;
BEGIN
  PERFORM id FROM public.organization_collaboration_groups WHERE id=OLD.group_id FOR UPDATE;
  IF NOT FOUND THEN RETURN OLD; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.organization_collaboration_group_members WHERE group_id=OLD.group_id AND role='owner') THEN
    SELECT user_id INTO successor FROM public.organization_collaboration_group_members WHERE group_id=OLD.group_id ORDER BY joined_at,user_id LIMIT 1;
    IF successor IS NULL THEN DELETE FROM public.organization_collaboration_groups WHERE id=OLD.group_id;
    ELSE UPDATE public.organization_collaboration_group_members SET role='owner' WHERE group_id=OLD.group_id AND user_id=successor; END IF;
  END IF;
  RETURN OLD;
END $$;
REVOKE ALL ON FUNCTION openround_organization_group_successor() FROM PUBLIC;
CREATE TRIGGER organization_group_successor AFTER DELETE ON organization_collaboration_group_members FOR EACH ROW EXECUTE FUNCTION openround_organization_group_successor();
CREATE FUNCTION openround_remove_billing_group_membership() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public SET app.system_access='on' AS $$
BEGIN
  IF NEW.role='billing' THEN DELETE FROM public.organization_collaboration_group_members WHERE organization_id=NEW.organization_id AND user_id=NEW.user_id; END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION openround_remove_billing_group_membership() FROM PUBLIC;
CREATE TRIGGER organization_member_billing_groups AFTER UPDATE OF role ON organization_members FOR EACH ROW EXECUTE FUNCTION openround_remove_billing_group_membership();
CREATE FUNCTION openround_erase_organization_group_attribution() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public SET app.system_access='on' AS $$
BEGIN
  IF NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL THEN
    UPDATE public.organization_collaboration_groups SET created_by=NULL WHERE created_by=NEW.id;
    UPDATE public.organization_collaboration_group_messages SET author_id=NULL,body='Message removed' WHERE author_id=NEW.id;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION openround_erase_organization_group_attribution() FROM PUBLIC;
CREATE TRIGGER users_erase_organization_group_attribution AFTER UPDATE OF deleted_at ON users FOR EACH ROW EXECUTE FUNCTION openround_erase_organization_group_attribution();
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='openround_runtime') THEN
  GRANT SELECT,INSERT,UPDATE,DELETE ON organization_collaboration_groups,organization_collaboration_group_members,organization_collaboration_group_messages,organization_collaboration_group_library TO openround_runtime;
  GRANT EXECUTE ON FUNCTION openround_organization_group_access(uuid,uuid) TO openround_runtime;
END IF; END $$;

-- Existing Canvas grants stay readable/revocable when a collection is archived.
-- Creating or changing a grant is a new collaboration write and must lock/check status.
CREATE FUNCTION openround_canvas_active_group_grant() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE group_status text;
BEGIN
  SELECT status INTO group_status FROM collaboration_groups
    WHERE workspace_id=NEW.workspace_id AND id=NEW.group_id FOR SHARE;
  IF group_status='archived' THEN
    RAISE EXCEPTION 'Archived groups are read-only' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER canvas_active_group_grant BEFORE INSERT OR UPDATE ON canvas_board_group_grants
  FOR EACH ROW EXECUTE FUNCTION openround_canvas_active_group_grant();
