-- A group grants one board dynamically; it never grants a workspace membership or creator seat.
CREATE TABLE canvas_board_group_grants (
  workspace_id uuid NOT NULL,
  board_id uuid NOT NULL,
  group_id uuid NOT NULL,
  role text NOT NULL CHECK (role IN ('facilitator','editor','viewer')),
  created_at timestamptz NOT NULL,
  PRIMARY KEY (board_id,group_id),
  FOREIGN KEY (workspace_id,board_id) REFERENCES canvas_boards(workspace_id,id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id,group_id) REFERENCES collaboration_groups(workspace_id,id) ON DELETE CASCADE
);
CREATE INDEX canvas_board_group_grants_group_idx ON canvas_board_group_grants(group_id,board_id);
ALTER TABLE canvas_board_group_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE canvas_board_group_grants FORCE ROW LEVEL SECURITY;

-- Initial board discovery has only the principal context. Expose only that principal's
-- current workspace/group membership, without exposing another group's roster.
CREATE POLICY canvas_own_group_membership ON collaboration_group_members FOR SELECT USING (
  user_id::text=nullif(current_setting('app.canvas_user_id',true),'') AND EXISTS (
    SELECT 1 FROM workspace_members membership
    WHERE membership.workspace_id=collaboration_group_members.workspace_id
      AND membership.user_id=collaboration_group_members.user_id
  )
);
CREATE POLICY canvas_group_grant_scope ON canvas_board_group_grants USING (
  current_setting('app.canvas_lifecycle',true)='on' OR
  (workspace_id::text=nullif(current_setting('app.workspace_id',true),'') AND
   board_id::text=nullif(current_setting('app.canvas_board_id',true),'')) OR
  EXISTS (
    SELECT 1 FROM collaboration_group_members membership
    JOIN workspace_members workspace_member
      ON workspace_member.workspace_id=membership.workspace_id AND workspace_member.user_id=membership.user_id
    WHERE membership.group_id=canvas_board_group_grants.group_id
      AND membership.workspace_id=canvas_board_group_grants.workspace_id
      AND membership.user_id::text=nullif(current_setting('app.canvas_user_id',true),'')
  )
) WITH CHECK (
  workspace_id::text=nullif(current_setting('app.workspace_id',true),'') AND
  board_id::text=nullif(current_setting('app.canvas_board_id',true),'')
);
CREATE POLICY canvas_group_board_scope ON canvas_boards USING (
  EXISTS (
    SELECT 1 FROM canvas_board_group_grants grant_row
    JOIN collaboration_group_members membership
      ON membership.group_id=grant_row.group_id AND membership.workspace_id=grant_row.workspace_id
    JOIN workspace_members workspace_member
      ON workspace_member.workspace_id=membership.workspace_id AND workspace_member.user_id=membership.user_id
    WHERE grant_row.board_id=canvas_boards.id AND grant_row.workspace_id=canvas_boards.workspace_id
      AND membership.user_id::text=nullif(current_setting('app.canvas_user_id',true),'')
  )
) WITH CHECK (
  workspace_id::text=nullif(current_setting('app.workspace_id',true),'') AND
  id::text=nullif(current_setting('app.canvas_board_id',true),'')
);

CREATE FUNCTION bound_canvas_group_grants() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- Serialize the count with every normal board mutation and concurrent share request.
  PERFORM id FROM canvas_boards WHERE id=NEW.board_id FOR UPDATE;
  IF NOT EXISTS (SELECT 1 FROM canvas_board_group_grants WHERE board_id=NEW.board_id AND group_id=NEW.group_id)
    AND (SELECT count(*) FROM canvas_board_group_grants WHERE board_id=NEW.board_id)>=20 THEN
    RAISE EXCEPTION 'Canvas group sharing limit reached' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER canvas_group_grants_bound BEFORE INSERT ON canvas_board_group_grants
  FOR EACH ROW EXECUTE FUNCTION bound_canvas_group_grants();
DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='openround_runtime') THEN
  GRANT SELECT,INSERT,UPDATE,DELETE ON canvas_board_group_grants TO openround_runtime;
END IF; END $$;
