-- Feature rollout and plan assignments share the trusted operator record store.
-- No initial row is inserted: an absent policy preserves deployment defaults.
ALTER TABLE platform_records DROP CONSTRAINT IF EXISTS platform_records_kind_check;
ALTER TABLE platform_records ADD CONSTRAINT platform_records_kind_check CHECK(kind IN (
  'subscription','license','offer','purchase','promotion','redemption','invitation',
  'billing_event','operator','operator_session','operator_oidc','audit','command',
  'integration_job','integration_connection','case','heartbeat','worker_control','admission',
  'provider_lock','commercial_hold','stripe_transaction','feature_policy'
));
