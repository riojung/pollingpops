-- Explicit ownership classification and versioned creator-seat licensing. Existing
-- subscriptions and offers keep workspace-license terms when licenseUnit is absent.
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS account_type text NOT NULL DEFAULT 'organization'
  CHECK(account_type IN ('personal','organization'));
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS license_unit text NOT NULL DEFAULT 'workspace'
  CHECK(license_unit IN ('workspace','user'));

-- Migration 065 created one same-ID commercial boundary for each personal workspace.
-- Its paid plan is deliberately irrelevant to the ownership classification.
UPDATE organizations organization SET account_type='personal'
WHERE EXISTS (SELECT 1 FROM workspaces workspace
  WHERE workspace.id=organization.id AND workspace.organization_id=organization.id);

CREATE OR REPLACE FUNCTION provision_workspace_organization() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.organization_id IS NULL THEN
    NEW.organization_id := NEW.id;
    INSERT INTO organizations(id,name,account_type,license_unit)
      VALUES(NEW.organization_id,left(NEW.name,120),'personal','workspace');
    INSERT INTO organization_members(organization_id,user_id,role)
      VALUES(NEW.organization_id,NEW.owner_id,'owner');
    INSERT INTO platform_credit_accounts(organization_id) VALUES(NEW.organization_id);
  END IF;
  RETURN NEW;
END;
$$;

ALTER TABLE platform_records DROP CONSTRAINT IF EXISTS platform_records_kind_check;
ALTER TABLE platform_records ADD CONSTRAINT platform_records_kind_check CHECK(kind IN (
  'subscription','license','user_license','offer','purchase','promotion','redemption','invitation',
  'billing_event','operator','operator_session','operator_oidc','audit','command',
  'integration_job','integration_connection','case','heartbeat','worker_control','admission',
  'provider_lock','commercial_hold','stripe_transaction','feature_policy',
  'operator_credential','operator_login_throttle'
));
CREATE UNIQUE INDEX IF NOT EXISTS platform_user_license_workspace_uq
  ON platform_records ((data->>'workspaceId')) WHERE kind='user_license';
