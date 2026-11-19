-- Consumed identities survive target deletion and expiry without retaining authored content.
CREATE TABLE starter_copy_receipts (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  actor_hash text NOT NULL CHECK(actor_hash ~ '^[a-f0-9]{64}$'),
  idempotency_key uuid NOT NULL,
  request_hash text NOT NULL CHECK(request_hash ~ '^[a-f0-9]{64}$'),
  quiz_id uuid NOT NULL,
  created_at timestamptz NOT NULL CHECK(isfinite(created_at)),
  expires_at timestamptz NOT NULL CHECK(isfinite(expires_at) AND expires_at>created_at AND expires_at<=created_at+interval '24 hours 5 minutes'),
  PRIMARY KEY(workspace_id, actor_hash, idempotency_key)
);
CREATE FUNCTION preserve_starter_copy_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' AND NOT EXISTS(SELECT 1 FROM workspaces WHERE id=OLD.workspace_id) THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'Starter copy receipts are append-only' USING ERRCODE='23514';
END $$;
CREATE TRIGGER starter_copy_receipt_guard BEFORE UPDATE OR DELETE ON starter_copy_receipts
  FOR EACH ROW EXECUTE FUNCTION preserve_starter_copy_receipt();
ALTER TABLE starter_copy_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE starter_copy_receipts FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON starter_copy_receipts
  USING(current_setting('app.system_access',true)='on' OR workspace_id::text=nullif(current_setting('app.workspace_id',true),''))
  WITH CHECK(current_setting('app.system_access',true)='on' OR workspace_id::text=nullif(current_setting('app.workspace_id',true),''));
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='openround_runtime') THEN
  GRANT SELECT,INSERT ON starter_copy_receipts TO openround_runtime;
END IF; END $$;
