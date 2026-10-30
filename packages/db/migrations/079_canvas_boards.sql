-- Canvas documents retain an explicit owning workspace; sharing grants one board, never a workspace.
CREATE TABLE canvas_boards (
  id uuid PRIMARY KEY, workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES organizations(id), owner_user_id uuid NOT NULL REFERENCES users(id),
  source_board_id uuid UNIQUE REFERENCES idea_boards(id) ON DELETE CASCADE,
  board_type text NOT NULL CHECK(board_type IN ('team','workshop')),
  title text NOT NULL CHECK(length(trim(title)) BETWEEN 1 AND 160),
  status text NOT NULL CHECK(status IN ('active','archived')), canvas_seq bigint NOT NULL DEFAULT 0 CHECK(canvas_seq>=0),
  creation_key uuid NOT NULL, creation_hash text NOT NULL,
  created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL, expires_at timestamptz NOT NULL,
  UNIQUE(workspace_id,creation_key), UNIQUE(workspace_id,id),
  CHECK((board_type='workshop')=(source_board_id IS NOT NULL))
);
CREATE TABLE canvas_board_grants (
  board_id uuid NOT NULL REFERENCES canvas_boards(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL, user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK(role IN ('facilitator','editor','viewer')), created_at timestamptz NOT NULL, label text CHECK(length(label)<=320),
  PRIMARY KEY(board_id,user_id), FOREIGN KEY(workspace_id,board_id) REFERENCES canvas_boards(workspace_id,id) ON DELETE CASCADE
);
CREATE TABLE canvas_board_objects (
  board_id uuid NOT NULL, workspace_id uuid NOT NULL, id uuid NOT NULL, version bigint NOT NULL CHECK(version>0),
  data jsonb NOT NULL CHECK(octet_length(data::text)<=65536), PRIMARY KEY(board_id,id),
  FOREIGN KEY(workspace_id,board_id) REFERENCES canvas_boards(workspace_id,id) ON DELETE CASCADE,
  CHECK(data->>'id'=id::text AND (data->>'version')::bigint=version)
);
CREATE TABLE canvas_board_receipts (
  board_id uuid NOT NULL, workspace_id uuid NOT NULL, actor_id uuid NOT NULL, operation_id uuid NOT NULL,
  data jsonb NOT NULL CHECK(octet_length(data::text)<=524288), PRIMARY KEY(board_id,actor_id,operation_id),
  FOREIGN KEY(workspace_id,board_id) REFERENCES canvas_boards(workspace_id,id) ON DELETE CASCADE
);
CREATE TABLE canvas_board_invitations (
  id uuid PRIMARY KEY, board_id uuid NOT NULL, workspace_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE, data jsonb NOT NULL,
  FOREIGN KEY(workspace_id,board_id) REFERENCES canvas_boards(workspace_id,id) ON DELETE CASCADE
);
CREATE TABLE canvas_board_outbox (
  cursor bigserial PRIMARY KEY, event_id uuid NOT NULL UNIQUE, board_id uuid NOT NULL,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  data jsonb NOT NULL CHECK(octet_length(data::text)<=1024), expires_at timestamptz NOT NULL,
  lease_token uuid, leased_until timestamptz, delivered_at timestamptz
);
CREATE INDEX canvas_board_grants_user_idx ON canvas_board_grants(user_id,board_id);
CREATE INDEX canvas_boards_workspace_idx ON canvas_boards(workspace_id,id);
CREATE INDEX canvas_boards_expiry_idx ON canvas_boards(expires_at);
CREATE INDEX canvas_board_outbox_expiry_idx ON canvas_board_outbox(expires_at);

-- Identity lookup remains constrained to the authenticated principal or the selected board's organization.
CREATE POLICY canvas_principal_read ON users FOR SELECT USING (
  id::text=nullif(current_setting('app.canvas_user_id',true),'') OR EXISTS (
    SELECT 1 FROM organization_members membership WHERE membership.user_id=users.id
    AND membership.organization_id::text=nullif(current_setting('app.organization_id',true),'')
  )
);
CREATE POLICY canvas_own_memberships ON workspace_members FOR SELECT USING (user_id::text=nullif(current_setting('app.canvas_user_id',true),''));
ALTER TABLE canvas_boards ENABLE ROW LEVEL SECURITY; ALTER TABLE canvas_boards FORCE ROW LEVEL SECURITY;
ALTER TABLE canvas_board_grants ENABLE ROW LEVEL SECURITY; ALTER TABLE canvas_board_grants FORCE ROW LEVEL SECURITY;
CREATE POLICY canvas_grant_scope ON canvas_board_grants USING (
  current_setting('app.canvas_lifecycle',true)='on' OR
  user_id::text=nullif(current_setting('app.canvas_user_id',true),'') OR
  (workspace_id::text=nullif(current_setting('app.workspace_id',true),'') AND board_id::text=nullif(current_setting('app.canvas_board_id',true),''))
) WITH CHECK (workspace_id::text=nullif(current_setting('app.workspace_id',true),'') AND board_id::text=nullif(current_setting('app.canvas_board_id',true),''));
CREATE POLICY canvas_board_scope ON canvas_boards USING (
  owner_user_id::text=nullif(current_setting('app.canvas_user_id',true),'') OR
  EXISTS(SELECT 1 FROM workspace_members member WHERE member.workspace_id=canvas_boards.workspace_id AND member.user_id::text=nullif(current_setting('app.canvas_user_id',true),'') AND member.role='owner') OR
  EXISTS(SELECT 1 FROM canvas_board_grants grant_row WHERE grant_row.board_id=canvas_boards.id AND grant_row.user_id::text=nullif(current_setting('app.canvas_user_id',true),'')) OR
  EXISTS(SELECT 1 FROM canvas_board_invitations invitation WHERE invitation.board_id=canvas_boards.id AND invitation.user_id::text=nullif(current_setting('app.canvas_user_id',true),'')) OR
  (source_board_id::text=nullif(current_setting('app.canvas_source_id',true),'') AND EXISTS(SELECT 1 FROM idea_boards source WHERE source.id=source_board_id)) OR
  current_setting('app.canvas_lifecycle',true)='on'
  OR (current_setting('app.canvas_quota',true)='on' AND workspace_id::text=nullif(current_setting('app.workspace_id',true),''))
) WITH CHECK (workspace_id::text=nullif(current_setting('app.workspace_id',true),'') AND id::text=nullif(current_setting('app.canvas_board_id',true),''));
-- A matching admitted bearer permits the existing private source reader, never an arbitrary workspace.
CREATE POLICY canvas_guest_source ON idea_boards FOR SELECT USING (
  id::text=nullif(current_setting('app.canvas_source_id',true),'') AND
  EXISTS(SELECT 1 FROM jsonb_array_elements(data->'guests') guest WHERE guest->>'tokenHash'=nullif(current_setting('app.canvas_guest_hash',true),''))
);
DO $$ DECLARE target text; BEGIN
  FOREACH target IN ARRAY ARRAY['canvas_board_objects','canvas_board_receipts','canvas_board_invitations'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',target);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',target);
    EXECUTE format('CREATE POLICY canvas_owned_board ON %I USING (current_setting(''app.canvas_lifecycle'',true)=''on'' OR (workspace_id::text=nullif(current_setting(''app.workspace_id'',true),'''') AND board_id::text=nullif(current_setting(''app.canvas_board_id'',true),''''))) WITH CHECK (workspace_id::text=nullif(current_setting(''app.workspace_id'',true),'''') AND board_id::text=nullif(current_setting(''app.canvas_board_id'',true),''''))',target);
  END LOOP;
END $$;
CREATE POLICY canvas_invitee_read ON canvas_board_invitations FOR SELECT USING (user_id::text=nullif(current_setting('app.canvas_user_id',true),''));
ALTER TABLE canvas_board_outbox ENABLE ROW LEVEL SECURITY; ALTER TABLE canvas_board_outbox FORCE ROW LEVEL SECURITY;
CREATE POLICY canvas_event_scope ON canvas_board_outbox USING (
  current_setting('app.canvas_relay',true)='on' OR
  (workspace_id::text=nullif(current_setting('app.workspace_id',true),'') AND board_id::text=nullif(current_setting('app.canvas_board_id',true),''))
) WITH CHECK (current_setting('app.canvas_relay',true)='on' OR (workspace_id::text=nullif(current_setting('app.workspace_id',true),'') AND board_id::text=nullif(current_setting('app.canvas_board_id',true),'')));
CREATE POLICY canvas_event_cleanup ON canvas_board_outbox FOR DELETE USING (
  workspace_id::text=nullif(current_setting('app.workspace_id',true),'') OR current_setting('app.canvas_lifecycle',true)='on'
);

CREATE FUNCTION preserve_canvas_board_identity() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  IF (NEW.workspace_id,NEW.organization_id,NEW.owner_user_id,NEW.source_board_id,NEW.board_type,NEW.created_at,NEW.expires_at,NEW.creation_key,NEW.creation_hash)
    IS DISTINCT FROM (OLD.workspace_id,OLD.organization_id,OLD.owner_user_id,OLD.source_board_id,OLD.board_type,OLD.created_at,OLD.expires_at,OLD.creation_key,OLD.creation_hash) THEN
    RAISE EXCEPTION 'Canvas ownership, type and retention are immutable' USING ERRCODE='23514';
  END IF; RETURN NEW;
END $$;
CREATE TRIGGER canvas_identity BEFORE UPDATE ON canvas_boards FOR EACH ROW EXECUTE FUNCTION preserve_canvas_board_identity();
-- Every durable scene write shares the source row fence with legacy moderation/voting commands.
-- Cascaded board deletion remains possible after closure; the parent row is then absent.
CREATE FUNCTION guard_canvas_workshop_scene() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE source_status text; source_closes timestamptz;
BEGIN
  SELECT source.data->>'status',(source.data->>'closesAt')::timestamptz INTO source_status,source_closes
    FROM canvas_boards board JOIN idea_boards source ON source.id=board.source_board_id
    WHERE board.id=COALESCE(NEW.board_id,OLD.board_id) FOR UPDATE OF source;
  IF source_status IN ('voting','closed') OR source_closes<=clock_timestamp() THEN
    RAISE EXCEPTION 'Workshop canvas is frozen' USING ERRCODE='23514';
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $$;
CREATE TRIGGER canvas_workshop_scene BEFORE INSERT OR UPDATE OR DELETE ON canvas_board_objects
 FOR EACH ROW EXECUTE FUNCTION guard_canvas_workshop_scene();
CREATE FUNCTION remove_canvas_board_notifications() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  DELETE FROM canvas_board_outbox WHERE board_id=OLD.id AND data->>'type'<>'canvas.deleted';
  RETURN OLD;
END $$;
CREATE TRIGGER canvas_remove_notifications AFTER DELETE ON canvas_boards
 FOR EACH ROW EXECUTE FUNCTION remove_canvas_board_notifications();
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='openround_runtime') THEN
 GRANT SELECT,INSERT,UPDATE,DELETE ON canvas_boards,canvas_board_grants,canvas_board_objects,canvas_board_receipts,canvas_board_invitations,canvas_board_outbox TO openround_runtime;
 GRANT USAGE,SELECT ON SEQUENCE canvas_board_outbox_cursor_seq TO openround_runtime;
END IF; END $$;
