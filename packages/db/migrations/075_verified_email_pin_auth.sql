-- Existing active identities were provisioned only after proof of mailbox ownership.
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified_at timestamptz;
SELECT set_config('app.system_access', 'on', true);
UPDATE users SET email_verified_at = created_at
  WHERE deleted_at IS NULL AND email_verified_at IS NULL;

CREATE TABLE IF NOT EXISTS auth_email_pin_challenges (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash char(64) NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  pin_hash char(64) NOT NULL CHECK (pin_hash ~ '^[0-9a-f]{64}$'),
  policy_version text NOT NULL,
  return_to text,
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
  CHECK (expires_at > created_at)
);
ALTER TABLE auth_email_pin_challenges ADD COLUMN IF NOT EXISTS workspace_id uuid
  REFERENCES workspaces(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS auth_email_pin_challenges_user_idx
  ON auth_email_pin_challenges (user_id) WHERE consumed_at IS NULL;
CREATE INDEX IF NOT EXISTS auth_email_pin_challenges_expiry_idx
  ON auth_email_pin_challenges (expires_at);
ALTER TABLE auth_email_pin_challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth_email_pin_challenges FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS system_only ON auth_email_pin_challenges;
CREATE POLICY system_only ON auth_email_pin_challenges
  USING (current_setting('app.system_access', true) = 'on')
  WITH CHECK (current_setting('app.system_access', true) = 'on');
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'openround_runtime') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON auth_email_pin_challenges TO openround_runtime;
  END IF;
END $$;
