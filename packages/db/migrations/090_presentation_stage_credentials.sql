-- Stage credentials are a distinct read-only capability. Existing host/Companion rows retain
-- their roles, hashes, expiry and revocation; no published content or command receipts change.
ALTER TABLE presentation_session_credentials
  DROP CONSTRAINT presentation_session_credentials_role_check;
ALTER TABLE presentation_session_credentials
  ADD CONSTRAINT presentation_session_credentials_role_check
  CHECK (role IN ('host', 'companion', 'stage'));
