CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS projects (
  project_id TEXT PRIMARY KEY,
  owner_user_id UUID,
  name TEXT NOT NULL,
  homepage_url TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  avatar_url TEXT,
  allowed_redirect_uris TEXT[] NOT NULL,
  allowed_origins TEXT[] NOT NULL DEFAULT '{}',
  enabled_providers TEXT[] NOT NULL DEFAULT '{google,github}',
  required_provider TEXT NULL CHECK (required_provider IS NULL OR required_provider IN ('google','github','envx')),
  strict_credentials BOOLEAN NOT NULL DEFAULT false,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE projects ADD COLUMN IF NOT EXISTS owner_user_id UUID;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS homepage_url TEXT NOT NULL DEFAULT '';
ALTER TABLE projects ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT '';
ALTER TABLE projects ADD COLUMN IF NOT EXISTS avatar_url TEXT;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS allowed_origins TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE projects ADD COLUMN IF NOT EXISTS enabled_providers TEXT[] NOT NULL DEFAULT '{google,github}';
ALTER TABLE projects ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';
ALTER TABLE projects ADD COLUMN IF NOT EXISTS required_provider TEXT NULL;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS strict_credentials BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE,
  name TEXT,
  avatar_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$
BEGIN
  ALTER TABLE projects ADD CONSTRAINT projects_owner_user_id_fkey FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS projects_owner_user_id_idx ON projects(owner_user_id);

CREATE TABLE IF NOT EXISTS identities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('google', 'github', 'envx')),
  issuer TEXT,
  subject TEXT,
  provider_account_id TEXT NOT NULL,
  email TEXT,
  email_verified BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_account_id),
  UNIQUE (issuer, subject)
);

CREATE TABLE IF NOT EXISTS oauth_states (
  state_hash TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('google', 'github', 'envx')),
  redirect_uri TEXT NOT NULL,
  handoff BOOLEAN NOT NULL DEFAULT false,
  user_id UUID,
  expires_at TIMESTAMPTZ NOT NULL,
  purpose TEXT NOT NULL DEFAULT 'sign_in',
  code_verifier TEXT,
  nonce TEXT,
  client_state TEXT
);

ALTER TABLE oauth_states ADD COLUMN IF NOT EXISTS handoff BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE oauth_states ADD COLUMN IF NOT EXISTS user_id UUID;
ALTER TABLE oauth_states ADD COLUMN IF NOT EXISTS purpose TEXT NOT NULL DEFAULT 'sign_in';
ALTER TABLE oauth_states ADD COLUMN IF NOT EXISTS code_verifier TEXT;
ALTER TABLE oauth_states ADD COLUMN IF NOT EXISTS nonce TEXT;
ALTER TABLE oauth_states ADD COLUMN IF NOT EXISTS client_state TEXT;

CREATE INDEX IF NOT EXISTS oauth_states_expires_at_idx ON oauth_states(expires_at);

CREATE TABLE IF NOT EXISTS oauth_handoffs (
  handoff_hash TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT, issuer TEXT, subject TEXT, permissions JSONB NOT NULL DEFAULT '[]'::jsonb,
  github_grant_token TEXT,
  expires_at TIMESTAMPTZ NOT NULL
);

ALTER TABLE oauth_handoffs ADD COLUMN IF NOT EXISTS github_grant_token TEXT;

CREATE TABLE IF NOT EXISTS github_connections (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  github_account_id TEXT NOT NULL,
  login TEXT NOT NULL,
  access_token TEXT NOT NULL,
  refresh_token TEXT,
  expires_at TIMESTAMPTZ,
  scopes JSONB NOT NULL DEFAULT '[]'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS github_grants (
  grant_hash TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS github_grants_project_user_idx ON github_grants(project_id, user_id);

CREATE INDEX IF NOT EXISTS oauth_handoffs_expires_at_idx ON oauth_handoffs(expires_at);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
  provider TEXT, issuer TEXT, subject TEXT, permissions JSONB NOT NULL DEFAULT '[]'::jsonb,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON sessions(user_id);
CREATE INDEX IF NOT EXISTS sessions_expires_at_idx ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS api_tokens (
  token_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  token_prefix TEXT NOT NULL,
  project_id TEXT REFERENCES projects(project_id) ON DELETE CASCADE,
  provider TEXT, issuer TEXT, subject TEXT, permissions JSONB NOT NULL DEFAULT '[]'::jsonb,
  label TEXT NOT NULL DEFAULT 'CLI token',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS api_tokens_user_id_idx ON api_tokens(user_id);
CREATE INDEX IF NOT EXISTS api_tokens_hash_idx ON api_tokens(token_hash);
