CREATE TABLE user_garmin_credentials (
  auth_user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text NOT NULL,
  token_ciphertext text NOT NULL,
  token_iv text NOT NULL,
  token_auth_tag text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE user_garmin_credentials ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE user_garmin_credentials FROM anon, authenticated;
-- Only the authenticated API server reads and writes Garmin tokens.
