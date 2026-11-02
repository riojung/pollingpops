-- Private delivery receipts only. Email addresses never enter board/audience projections.
CREATE UNIQUE INDEX IF NOT EXISTS idea_boards_invitation_scope_idx ON idea_boards(workspace_id,id);
CREATE TABLE board_invitation_deliveries (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  actor_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  resource_kind text NOT NULL CHECK (resource_kind IN ('canvas','idea_board')),
  resource_id uuid NOT NULL,
  operation_id uuid NOT NULL,
  expires_at timestamptz NOT NULL,
  canvas_board_id uuid,
  idea_board_id uuid,
  data jsonb NOT NULL,
  FOREIGN KEY(workspace_id,canvas_board_id) REFERENCES canvas_boards(workspace_id,id) ON DELETE CASCADE,
  FOREIGN KEY(workspace_id,idea_board_id) REFERENCES idea_boards(workspace_id,id) ON DELETE CASCADE,
  UNIQUE(workspace_id,actor_id,resource_kind,resource_id,operation_id),
  CHECK ((resource_kind='canvas' AND canvas_board_id IS NOT NULL AND canvas_board_id=resource_id AND idea_board_id IS NULL)
      OR (resource_kind='idea_board' AND idea_board_id IS NOT NULL AND idea_board_id=resource_id AND canvas_board_id IS NULL)),
  CHECK (jsonb_typeof(data)='object' AND jsonb_typeof(data->'recipients')='array'),
  CHECK (data ?& ARRAY['batchId','workspaceId','actorId','resourceKind','resourceId','operationId','fingerprint','createdAt','expiresAt','recipients']),
  CHECK ((data->>'expiresAt')::timestamptz=expires_at),
  CHECK (jsonb_array_length(data->'recipients') BETWEEN 1 AND 20),
  CHECK (octet_length(data::text)<=32768),
  CHECK (data->>'batchId'=id::text AND data->>'workspaceId'=workspace_id::text
    AND data->>'actorId'=actor_id::text AND data->>'resourceKind'=resource_kind
    AND data->>'resourceId'=resource_id::text AND data->>'operationId'=operation_id::text),
  CHECK (data->>'fingerprint' ~ '^[a-f0-9]{64}$')
);
CREATE INDEX board_invitation_deliveries_expiry_idx ON board_invitation_deliveries(expires_at);
ALTER TABLE board_invitation_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE board_invitation_deliveries FORCE ROW LEVEL SECURITY;
CREATE POLICY board_invitation_delivery_scope ON board_invitation_deliveries
USING (
  current_setting('app.board_invitation_lifecycle',true)='on' OR (
    workspace_id::text=nullif(current_setting('app.workspace_id',true),'') AND
    actor_id::text=nullif(current_setting('app.board_invitation_actor',true),'') AND
    resource_kind=nullif(current_setting('app.board_invitation_kind',true),'') AND
    resource_id::text=nullif(current_setting('app.board_invitation_resource',true),'')))
WITH CHECK (
  workspace_id::text=nullif(current_setting('app.workspace_id',true),'') AND
  actor_id::text=nullif(current_setting('app.board_invitation_actor',true),'') AND
  resource_kind=nullif(current_setting('app.board_invitation_kind',true),'') AND
  resource_id::text=nullif(current_setting('app.board_invitation_resource',true),''));

CREATE FUNCTION preserve_board_invitation_delivery_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.id<>OLD.id OR NEW.workspace_id<>OLD.workspace_id OR NEW.actor_id<>OLD.actor_id
    OR NEW.resource_kind<>OLD.resource_kind OR NEW.resource_id<>OLD.resource_id
    OR NEW.operation_id<>OLD.operation_id OR NEW.expires_at<>OLD.expires_at
    OR NEW.canvas_board_id IS DISTINCT FROM OLD.canvas_board_id
    OR NEW.idea_board_id IS DISTINCT FROM OLD.idea_board_id
    OR NEW.data->'fingerprint' IS DISTINCT FROM OLD.data->'fingerprint'
    OR NEW.data->'createdAt' IS DISTINCT FROM OLD.data->'createdAt'
    OR NEW.data->'expiresAt' IS DISTINCT FROM OLD.data->'expiresAt' THEN
    RAISE EXCEPTION 'Invitation delivery identity is immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER board_invitation_delivery_identity BEFORE UPDATE ON board_invitation_deliveries
FOR EACH ROW EXECUTE FUNCTION preserve_board_invitation_delivery_identity();

CREATE FUNCTION delete_board_invitation_delivery_actor() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public SET app.board_invitation_lifecycle='on' AS $$
BEGIN
  IF NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL THEN
    DELETE FROM board_invitation_deliveries WHERE actor_id=NEW.id;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION delete_board_invitation_delivery_actor() FROM PUBLIC;
CREATE TRIGGER board_invitation_delivery_actor_privacy AFTER UPDATE OF deleted_at ON users
FOR EACH ROW EXECUTE FUNCTION delete_board_invitation_delivery_actor();
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='openround_runtime') THEN
    GRANT SELECT,INSERT,UPDATE,DELETE ON board_invitation_deliveries TO openround_runtime;
  END IF;
END $$;
