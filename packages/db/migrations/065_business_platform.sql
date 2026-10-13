-- Add a commercial organization boundary without weakening any existing workspace RLS.
CREATE TABLE IF NOT EXISTS organizations (
  id uuid PRIMARY KEY,
  name text NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 120),
  status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','suspended','closed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS organization_members (
  organization_id uuid NOT NULL REFERENCES organizations(id),
  user_id uuid NOT NULL REFERENCES users(id),
  role text NOT NULL CHECK(role IN ('owner','admin','billing','member')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(organization_id,user_id)
);
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES organizations(id);
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS platform_status text NOT NULL DEFAULT 'active'
  CHECK(platform_status IN ('active','suspended'));
CREATE INDEX IF NOT EXISTS workspaces_organization_idx ON workspaces(organization_id);

-- Typed records support the lower-volume catalog, billing inbox, operator/auth, commands,
-- integrations, and support domains. Financial balance/coverage constraints stay relational.
CREATE TABLE IF NOT EXISTS platform_records (
  kind text NOT NULL CHECK(kind IN (
    'subscription','license','offer','purchase','promotion','redemption','invitation',
    'billing_event','operator','operator_session','operator_oidc','audit','command',
    'integration_job','integration_connection','case','heartbeat','worker_control','admission',
    'provider_lock','commercial_hold','stripe_transaction'
  )),
  id text NOT NULL,
  organization_id uuid REFERENCES organizations(id),
  data jsonb NOT NULL CHECK(jsonb_typeof(data)='object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(kind,id)
);
CREATE INDEX IF NOT EXISTS platform_records_organization_idx ON platform_records(organization_id,kind,created_at);
CREATE UNIQUE INDEX IF NOT EXISTS platform_operator_identity_uq
  ON platform_records((data->>'issuer'),(data->>'subject')) WHERE kind='operator';
CREATE UNIQUE INDEX IF NOT EXISTS platform_subscription_customer_uq
  ON platform_records((data->>'customerId')) WHERE kind='subscription' AND data->>'customerId' IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS platform_subscription_provider_uq
  ON platform_records((data->>'subscriptionId')) WHERE kind='subscription' AND data->>'subscriptionId' IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS platform_purchase_checkout_uq
  ON platform_records((data->>'checkoutId')) WHERE kind='purchase' AND data->>'checkoutId' IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS platform_purchase_payment_uq
  ON platform_records((data->>'paymentId')) WHERE kind='purchase' AND data->>'paymentId' IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS platform_promotion_hash_uq
  ON platform_records((data->>'codeHash')) WHERE kind='promotion';
CREATE UNIQUE INDEX IF NOT EXISTS platform_invitation_hash_uq
  ON platform_records((data->>'tokenHash')) WHERE kind='invitation';
CREATE INDEX IF NOT EXISTS platform_queue_state_idx ON platform_records(kind,(data->>'state'),created_at)
  WHERE kind IN ('billing_event','integration_job');

CREATE TABLE IF NOT EXISTS platform_credit_accounts (
  organization_id uuid PRIMARY KEY REFERENCES organizations(id),
  balance bigint NOT NULL DEFAULT 0 CHECK(balance BETWEEN 0 AND 9007199254740991),
  reserved bigint NOT NULL DEFAULT 0 CHECK(reserved >= 0 AND reserved <= balance),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS platform_credit_ledger (
  id text PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id),
  source_key text NOT NULL,
  delta bigint NOT NULL CHECK(delta <> 0 AND abs(delta) <= 1000000),
  data jsonb NOT NULL CHECK(jsonb_typeof(data)='object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(organization_id,source_key)
);
CREATE INDEX IF NOT EXISTS platform_credit_ledger_org_idx ON platform_credit_ledger(organization_id,created_at,id);
CREATE TABLE IF NOT EXISTS platform_room_coverages (
  id text PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id),
  -- Logical references intentionally survive workspace/session retention and deletion.
  workspace_id uuid NOT NULL,
  artifact_type text NOT NULL CHECK(artifact_type IN ('round','presentation')),
  room_id uuid NOT NULL,
  creation_key text,
  reservation_state text NOT NULL CHECK(reservation_state IN ('none','reserved','consumed','released')),
  expires_at timestamptz NOT NULL,
  data jsonb NOT NULL CHECK(jsonb_typeof(data)='object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(artifact_type,room_id),
  UNIQUE(workspace_id,creation_key)
);
CREATE INDEX IF NOT EXISTS platform_room_reserved_expiry_idx ON platform_room_coverages(expires_at,id)
  WHERE reservation_state='reserved';

CREATE OR REPLACE FUNCTION reject_platform_ledger_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'commercial ledger entries are append-only' USING ERRCODE='55000';
END;
$$;
DROP TRIGGER IF EXISTS platform_credit_ledger_immutable ON platform_credit_ledger;
CREATE TRIGGER platform_credit_ledger_immutable BEFORE UPDATE OR DELETE ON platform_credit_ledger
  FOR EACH ROW EXECUTE FUNCTION reject_platform_ledger_mutation();
CREATE OR REPLACE FUNCTION enforce_platform_coverage_terms() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN
    RAISE EXCEPTION 'room commercial coverage is retained evidence' USING ERRCODE='55000';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
     OR NEW.workspace_id IS DISTINCT FROM OLD.workspace_id OR NEW.artifact_type IS DISTINCT FROM OLD.artifact_type
     OR NEW.room_id IS DISTINCT FROM OLD.room_id OR NEW.creation_key IS DISTINCT FROM OLD.creation_key
     OR NEW.expires_at IS DISTINCT FROM OLD.expires_at OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR (NEW.data - ARRAY['reservationState','consumedAt','releasedAt']) IS DISTINCT FROM
        (OLD.data - ARRAY['reservationState','consumedAt','releasedAt']) THEN
    RAISE EXCEPTION 'room commercial terms are immutable' USING ERRCODE='55000';
  END IF;
  IF OLD.reservation_state <> NEW.reservation_state AND NOT
    (OLD.reservation_state='reserved' AND NEW.reservation_state IN ('consumed','released')) THEN
    RAISE EXCEPTION 'invalid reservation transition' USING ERRCODE='55000';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS platform_coverage_immutable_terms ON platform_room_coverages;
CREATE TRIGGER platform_coverage_immutable_terms BEFORE UPDATE OR DELETE ON platform_room_coverages
  FOR EACH ROW EXECUTE FUNCTION enforce_platform_coverage_terms();
CREATE OR REPLACE FUNCTION enforce_platform_record_evidence() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.kind IN ('audit','stripe_transaction') THEN
    RAISE EXCEPTION 'operator audit and financial events are append-only' USING ERRCODE='55000';
  END IF;
  IF TG_OP='UPDATE' AND OLD.kind='purchase' AND (
    NEW.organization_id IS DISTINCT FROM OLD.organization_id OR
    (NEW.data - ARRAY['checkoutId','paymentId','status','updatedAt']) IS DISTINCT FROM
    (OLD.data - ARRAY['checkoutId','paymentId','status','updatedAt'])) THEN
    RAISE EXCEPTION 'purchase terms are immutable' USING ERRCODE='55000';
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS platform_records_evidence ON platform_records;
CREATE TRIGGER platform_records_evidence BEFORE UPDATE OR DELETE ON platform_records
  FOR EACH ROW EXECUTE FUNCTION enforce_platform_record_evidence();

ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE organizations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS organization_isolation ON organizations;
CREATE POLICY organization_isolation ON organizations USING (
  current_setting('app.system_access',true)='on' OR id::text=nullif(current_setting('app.organization_id',true),'')
) WITH CHECK (
  current_setting('app.system_access',true)='on' OR id::text=nullif(current_setting('app.organization_id',true),'')
);
DO $$ DECLARE table_name text; BEGIN
  FOREACH table_name IN ARRAY ARRAY['organization_members','platform_records','platform_credit_accounts','platform_credit_ledger'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',table_name);
    EXECUTE format('DROP POLICY IF EXISTS organization_isolation ON %I',table_name);
    EXECUTE format('CREATE POLICY organization_isolation ON %I USING (current_setting(''app.system_access'',true)=''on'' OR organization_id::text=nullif(current_setting(''app.organization_id'',true),'''')) WITH CHECK (current_setting(''app.system_access'',true)=''on'' OR organization_id::text=nullif(current_setting(''app.organization_id'',true),''''))',table_name);
  END LOOP;
END $$;
ALTER TABLE platform_room_coverages ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_room_coverages FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS coverage_isolation ON platform_room_coverages;
CREATE POLICY coverage_isolation ON platform_room_coverages USING (
  current_setting('app.system_access',true)='on' OR
  organization_id::text=nullif(current_setting('app.organization_id',true),'') OR
  workspace_id::text=nullif(current_setting('app.workspace_id',true),'')
) WITH CHECK (
  current_setting('app.system_access',true)='on' OR
  organization_id::text=nullif(current_setting('app.organization_id',true),'')
);

SELECT set_config('app.system_access','on',true);
-- Keep separate existing payer relationships. One legacy workspace becomes one organization.
INSERT INTO organizations(id,name,created_at,updated_at)
  SELECT id,left(name,120),created_at,created_at FROM workspaces WHERE organization_id IS NULL ON CONFLICT DO NOTHING;
INSERT INTO organization_members(organization_id,user_id,role,created_at)
  SELECT id,owner_id,'owner',created_at FROM workspaces WHERE organization_id IS NULL ON CONFLICT DO NOTHING;
UPDATE workspaces SET organization_id=id WHERE organization_id IS NULL;
INSERT INTO platform_credit_accounts(organization_id)
  SELECT id FROM organizations ON CONFLICT DO NOTHING;
INSERT INTO platform_records(kind,id,organization_id,data)
SELECT 'subscription',w.organization_id::text,w.organization_id,jsonb_build_object(
  'organizationId',w.organization_id,'customerId',s.provider_customer_id,'subscriptionId',s.provider_subscription_id,
  'status',s.status,'licenseQuantity',CASE WHEN s.plan IN ('pro','team') THEN 1 ELSE 0 END,
  'offerId',NULL,'paidThrough',s.current_period_end,'graceUntil',NULL,'updatedAt',s.updated_at,'legacyPlan',s.plan
) FROM workspaces w JOIN subscriptions s ON s.workspace_id=w.id WHERE w.organization_id=w.id ON CONFLICT DO NOTHING;
INSERT INTO platform_records(kind,id,organization_id,data)
SELECT 'license',w.id::text,w.organization_id,jsonb_build_object(
  'organizationId',w.organization_id,'workspaceId',w.id,'assignedBy',w.owner_id,'assignedAt',w.created_at
) FROM workspaces w JOIN subscriptions s ON s.workspace_id=w.id
WHERE s.plan IN ('pro','team') AND w.organization_id=w.id ON CONFLICT DO NOTHING;

-- Existing rooms are never charged retrospectively. Preserve their declared Round capacity
-- and stored retention expiry. Historical provider offers were not versioned, so freeze the
-- best existing evidence: the workspace's legacy plan, declared capacity, and participant count.
LOCK TABLE game_sessions, presentation_live_sessions IN SHARE ROW EXCLUSIVE MODE;
CREATE OR REPLACE FUNCTION platform_legacy_room_entitlements(legacy_plan text, participant_limit integer)
RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_build_object(
    'plan', CASE WHEN legacy_plan IN ('free','pro','team') THEN legacy_plan ELSE 'free' END,
    'maxParticipants',GREATEST(1,participant_limit),
    'maxPublishedQuizzes',CASE WHEN legacy_plan IN ('pro','team') THEN NULL ELSE 5 END,
    'reportRetentionDays',CASE WHEN legacy_plan IN ('pro','team') THEN 365 ELSE 30 END,
    'csvExport',legacy_plan IN ('pro','team'),
    'brandTheme',legacy_plan IN ('pro','team'),
    'followups',legacy_plan IN ('pro','team'),
    'cohosting',legacy_plan IN ('pro','team'),
    'authoringJobsPerMonth',CASE legacy_plan WHEN 'team' THEN NULL WHEN 'pro' THEN 100 ELSE 3 END,
    'maxPracticePersonalLinks',CASE WHEN legacy_plan IN ('pro','team') THEN 100 ELSE 0 END,
    'recoveryTrails',legacy_plan IN ('pro','team'),
    'maxRecoveryStages',CASE WHEN legacy_plan IN ('pro','team') THEN 4 ELSE 0 END,
    'conceptHealth',legacy_plan IN ('pro','team'),
    'decisionReplay',true
  );
$$;
INSERT INTO platform_room_coverages(id,organization_id,workspace_id,artifact_type,room_id,
  reservation_state,expires_at,data,created_at)
SELECT 'round:'||room.id,w.organization_id,room.workspace_id,'round',room.id,'none',room.expires_at,
  jsonb_build_object('artifactType','round','roomId',room.id,'workspaceId',room.workspace_id,
    'organizationId',w.organization_id,'funding','legacy','reservationState','none',
    'snapshot',platform_legacy_room_entitlements(COALESCE(subscription.plan,'free'),
      COALESCE((room.settings->>'audienceLimit')::integer,CASE WHEN subscription.plan IN ('pro','team') THEN 100 ELSE 20 END)),
    'actorId',room.host_id,'expiresAt',room.expires_at,'createdAt',room.created_at,
    'consumedAt',NULL,'releasedAt',NULL),room.created_at
FROM game_sessions room JOIN workspaces w ON w.id=room.workspace_id
LEFT JOIN subscriptions subscription ON subscription.workspace_id=room.workspace_id
ON CONFLICT DO NOTHING;
INSERT INTO platform_room_coverages(id,organization_id,workspace_id,artifact_type,room_id,
  reservation_state,expires_at,data,created_at)
SELECT 'presentation:'||room.id,w.organization_id,room.workspace_id,'presentation',room.id,'none',room.live_expires_at,
  jsonb_build_object('artifactType','presentation','roomId',room.id,'workspaceId',room.workspace_id,
    'organizationId',w.organization_id,'funding','legacy','reservationState','none',
    'snapshot',platform_legacy_room_entitlements(COALESCE(subscription.plan,'free'),
      GREATEST(CASE subscription.plan WHEN 'team' THEN 250 WHEN 'pro' THEN 100 ELSE 20 END,
        (SELECT count(*)::integer FROM presentation_live_participants participant WHERE participant.session_id=room.id))),
    'actorId',room.created_by,'expiresAt',room.live_expires_at,'createdAt',room.created_at,
    'consumedAt',NULL,'releasedAt',NULL),room.created_at
FROM presentation_live_sessions room JOIN workspaces w ON w.id=room.workspace_id
LEFT JOIN subscriptions subscription ON subscription.workspace_id=room.workspace_id
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION provision_workspace_organization() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.organization_id IS NULL THEN
    NEW.organization_id := NEW.id;
    INSERT INTO organizations(id,name) VALUES(NEW.organization_id,left(NEW.name,120));
    INSERT INTO organization_members(organization_id,user_id,role) VALUES(NEW.organization_id,NEW.owner_id,'owner');
    INSERT INTO platform_credit_accounts(organization_id) VALUES(NEW.organization_id);
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS workspaces_organization_provision ON workspaces;
CREATE TRIGGER workspaces_organization_provision BEFORE INSERT ON workspaces
  FOR EACH ROW EXECUTE FUNCTION provision_workspace_organization();
ALTER TABLE workspaces ALTER COLUMN organization_id SET NOT NULL;

CREATE OR REPLACE FUNCTION assert_commercial_room_launch() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE prior_system_access text; commercial_org uuid; organization_status text; workspace_status text;
BEGIN
  prior_system_access := current_setting('app.system_access',true);
  PERFORM set_config('app.system_access','on',true);
  SELECT organization_id INTO commercial_org FROM workspaces WHERE id=NEW.workspace_id;
  IF commercial_org IS NULL THEN RAISE EXCEPTION 'workspace not found' USING ERRCODE='23503'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('org:'||commercial_org::text,73501));
  SELECT organization.status,workspace.platform_status INTO organization_status,workspace_status
    FROM workspaces workspace JOIN organizations organization ON organization.id=workspace.organization_id
    WHERE workspace.id=NEW.workspace_id;
  IF organization_status<>'active' THEN RAISE EXCEPTION 'organization is not active' USING ERRCODE='55000'; END IF;
  IF workspace_status<>'active' THEN RAISE EXCEPTION 'workspace is not active' USING ERRCODE='55000'; END IF;
  PERFORM set_config('app.system_access',COALESCE(prior_system_access,''),true);
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('app.system_access',COALESCE(prior_system_access,''),true);
  RAISE;
END;
$$;
REVOKE ALL ON FUNCTION assert_commercial_room_launch() FROM PUBLIC;
DROP TRIGGER IF EXISTS live_room_commercial_launch ON live_room_codes;
CREATE TRIGGER live_room_commercial_launch BEFORE INSERT ON live_room_codes
  FOR EACH ROW EXECUTE FUNCTION assert_commercial_room_launch();

-- The registry is shared by Round, Presentation, Feedback, and Survey. Every durable
-- room creation participates in the same commercial lifecycle lock, including during
-- a reader-first rollout where newer writers are temporarily disabled.
CREATE OR REPLACE FUNCTION claim_live_room_code(
  requested_code char(7), requested_workspace_id uuid, requested_artifact_type text,
  requested_artifact_id uuid, requested_expires_at timestamptz, requested_created_at timestamptz
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE prior_system_access text; commercial_org uuid; organization_status text; workspace_status text;
BEGIN
  prior_system_access := current_setting('app.system_access',true);
  PERFORM set_config('app.system_access','on',true);
  SELECT organization_id INTO commercial_org FROM workspaces WHERE id=requested_workspace_id;
  IF commercial_org IS NULL THEN RAISE EXCEPTION 'workspace not found' USING ERRCODE='23503'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('org:'||commercial_org::text,73501));
  SELECT organization.status,workspace.platform_status INTO organization_status,workspace_status
    FROM workspaces workspace JOIN organizations organization ON organization.id=workspace.organization_id
    WHERE workspace.id=requested_workspace_id;
  IF organization_status<>'active' THEN RAISE EXCEPTION 'organization is not active' USING ERRCODE='55000'; END IF;
  IF workspace_status<>'active' THEN RAISE EXCEPTION 'workspace is not active' USING ERRCODE='55000'; END IF;
  DELETE FROM live_room_codes WHERE code=requested_code AND (released_at IS NOT NULL OR expires_at<=now());
  INSERT INTO live_room_codes(code,workspace_id,artifact_type,artifact_id,expires_at,created_at)
    VALUES(requested_code,requested_workspace_id,requested_artifact_type,requested_artifact_id,requested_expires_at,requested_created_at);
  PERFORM set_config('app.system_access',COALESCE(prior_system_access,''),true);
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('app.system_access',COALESCE(prior_system_access,''),true);
  RAISE;
END;
$$;

DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='openround_runtime') THEN
    GRANT SELECT,INSERT,UPDATE,DELETE ON organizations,organization_members,platform_records,
      platform_credit_accounts,platform_credit_ledger,platform_room_coverages TO openround_runtime;
  END IF;
END $$;
