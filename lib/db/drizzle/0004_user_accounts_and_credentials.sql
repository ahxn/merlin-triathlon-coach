ALTER TABLE athletes ADD COLUMN auth_user_id uuid UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE;

CREATE TABLE user_api_credentials (
  auth_user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  intervals_athlete_id text NOT NULL,
  api_key_ciphertext text NOT NULL,
  api_key_iv text NOT NULL,
  api_key_auth_tag text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE user_api_credentials ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE user_api_credentials FROM anon, authenticated;
-- Credentials are read and written only by the authenticated API server.
