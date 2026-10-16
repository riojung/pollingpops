-- Authentication credentials remain separate from public operator metadata. Existing
-- forced RLS and system-access policy on platform_records also protect these rows.
ALTER TABLE platform_records DROP CONSTRAINT IF EXISTS platform_records_kind_check;
ALTER TABLE platform_records ADD CONSTRAINT platform_records_kind_check CHECK(kind IN (
  'subscription','license','offer','purchase','promotion','redemption','invitation',
  'billing_event','operator','operator_session','operator_oidc','audit','command',
  'integration_job','integration_connection','case','heartbeat','worker_control','admission',
  'provider_lock','commercial_hold','stripe_transaction','feature_policy',
  'operator_credential','operator_login_throttle'
));
CREATE UNIQUE INDEX IF NOT EXISTS platform_operator_credential_operator_uq
  ON platform_records ((data->>'operatorId')) WHERE kind = 'operator_credential';
