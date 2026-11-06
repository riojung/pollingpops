-- Compact creation identities survive deck/account erasure without retaining source or actor data.
-- A globally unique opaque request key also prevents retrying in another workspace.
CREATE TABLE presentation_creation_receipts (
 request_id uuid PRIMARY KEY,
 workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
 presentation_id uuid NOT NULL,
 intent_hash text NOT NULL CHECK(intent_hash ~ '^[a-f0-9]{64}$'),
 created_at timestamptz NOT NULL CHECK(isfinite(created_at))
);
CREATE INDEX presentation_creation_workspace ON presentation_creation_receipts(workspace_id);
-- Keep this invariant even when an installation's default runtime grants include writes.
-- Only the workspace foreign-key cascade may remove a consumed creation identity.
CREATE FUNCTION preserve_presentation_creation_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' AND NOT EXISTS(SELECT 1 FROM workspaces WHERE id=OLD.workspace_id) THEN RETURN OLD; END IF;
 RAISE EXCEPTION 'Presentation creation receipts are append-only' USING ERRCODE='23514';
END $$;
CREATE TRIGGER presentation_creation_receipt_guard BEFORE UPDATE OR DELETE ON presentation_creation_receipts FOR EACH ROW EXECUTE FUNCTION preserve_presentation_creation_receipt();
ALTER TABLE presentation_creation_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE presentation_creation_receipts FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON presentation_creation_receipts
 USING(current_setting('app.system_access',true)='on' OR workspace_id::text=nullif(current_setting('app.workspace_id',true),''))
 WITH CHECK(current_setting('app.system_access',true)='on' OR workspace_id::text=nullif(current_setting('app.workspace_id',true),''));
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='openround_runtime') THEN
 GRANT SELECT,INSERT ON presentation_creation_receipts TO openround_runtime;
END IF; END $$;
