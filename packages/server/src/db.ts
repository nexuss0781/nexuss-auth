import pg from 'pg';
import type {
  ApiTokenRecord,
  CreateSessionInput,
  GithubConnectionRecord,
  GithubGrantRecord,
  Database,
  HandoffRecord,
  OAuthFinalizationInput,
  OAuthFinalizationResult,
  OAuthProfile,
  OAuthStateRecord,
  ProjectRecord,
  SessionRecord,
  UserRecord,
} from './types.js';

const { Pool } = pg;

type Queryable = { query: pg.Pool['query'] };

type ProjectRow = {
  project_id: string;
  owner_user_id: string | null;
  name: string;
  homepage_url: string;
  description: string;
  avatar_url: string | null;
  allowed_redirect_uris: string[];
  allowed_origins: string[];
  enabled_providers: ('google' | 'github')[];
  status: 'active' | 'disabled';
};

function projectFromRow(row: ProjectRow): ProjectRecord {
  return {
    projectId: row.project_id,
    ownerUserId: row.owner_user_id,
    name: row.name,
    homepageUrl: row.homepage_url,
    description: row.description,
    avatarUrl: row.avatar_url,
    allowedRedirectUris: row.allowed_redirect_uris,
    allowedOrigins: row.allowed_origins,
    enabledProviders: row.enabled_providers,
    status: row.status,
  };
}

export class PostgresDatabase implements Database {
  private readonly pool: pg.Pool;

  constructor(databaseUrl: string) {
    this.pool = new Pool({ connectionString: databaseUrl, max: 10 });
  }

  async initialize(): Promise<void> {
    await this.pool.query(`
      ALTER TABLE oauth_states ADD COLUMN IF NOT EXISTS purpose TEXT NOT NULL DEFAULT 'sign_in';
      ALTER TABLE oauth_states ADD COLUMN IF NOT EXISTS user_id UUID;
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
    `);
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  async listProjects(ownerUserId?: string): Promise<ProjectRecord[]> {
    const result = await this.pool.query<ProjectRow>(
      ownerUserId
        ? 'SELECT project_id, owner_user_id, name, homepage_url, description, avatar_url, allowed_redirect_uris, allowed_origins, enabled_providers, status FROM projects WHERE owner_user_id = $1 ORDER BY created_at DESC, project_id ASC'
        : 'SELECT project_id, owner_user_id, name, homepage_url, description, avatar_url, allowed_redirect_uris, allowed_origins, enabled_providers, status FROM projects ORDER BY created_at DESC, project_id ASC',
      ownerUserId ? [ownerUserId] : [],
    );
    return result.rows.map(projectFromRow);
  }

  async getProject(projectId: string): Promise<ProjectRecord | null> {
    const result = await this.pool.query<ProjectRow>(
      'SELECT project_id, owner_user_id, name, homepage_url, description, avatar_url, allowed_redirect_uris, allowed_origins, enabled_providers, status FROM projects WHERE project_id = $1',
      [projectId],
    );
    const row = result.rows[0];
    return row ? projectFromRow(row) : null;
  }

  async upsertProject(project: ProjectRecord): Promise<ProjectRecord> {
    await this.pool.query(
      `INSERT INTO projects (project_id, owner_user_id, name, homepage_url, description, avatar_url, allowed_redirect_uris, allowed_origins, enabled_providers, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (project_id) DO UPDATE SET
         owner_user_id = COALESCE(EXCLUDED.owner_user_id, projects.owner_user_id),
         name = EXCLUDED.name,
         homepage_url = EXCLUDED.homepage_url,
         description = EXCLUDED.description,
         avatar_url = EXCLUDED.avatar_url,
         allowed_redirect_uris = EXCLUDED.allowed_redirect_uris,
         allowed_origins = EXCLUDED.allowed_origins,
         enabled_providers = EXCLUDED.enabled_providers,
         status = EXCLUDED.status,
         updated_at = now()`,
      [project.projectId, project.ownerUserId, project.name, project.homepageUrl, project.description, project.avatarUrl, project.allowedRedirectUris, project.allowedOrigins, project.enabledProviders, project.status],
    );
    return project;
  }

  async deleteProject(projectId: string): Promise<void> {
    await this.pool.query('DELETE FROM projects WHERE project_id = $1', [projectId]);
  }

  async createOAuthState(state: OAuthStateRecord): Promise<void> {
    await this.pool.query(
      `INSERT INTO oauth_states (state_hash, project_id, provider, redirect_uri, handoff, user_id, expires_at, purpose)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [state.stateHash, state.projectId, state.provider, state.redirectUri, state.handoff, state.userId ?? null, state.expiresAt, state.purpose ?? 'sign_in'],
    );
  }

  async consumeOAuthState(stateHash: string): Promise<OAuthStateRecord | null> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query<{
        state_hash: string;
        project_id: string;
        provider: 'google' | 'github';
        redirect_uri: string;
        handoff: boolean;
        user_id: string | null;
        expires_at: Date;
        purpose: 'sign_in' | 'github_authorization';
      }>(
        `DELETE FROM oauth_states WHERE state_hash = $1
         RETURNING state_hash, project_id, provider, redirect_uri, handoff, user_id, expires_at, purpose`,
        [stateHash],
      );
      await client.query('COMMIT');
      const row = result.rows[0];
      return row
        ? { stateHash: row.state_hash, projectId: row.project_id, provider: row.provider, redirectUri: row.redirect_uri, handoff: row.handoff, userId: row.user_id, purpose: row.purpose || 'sign_in', expiresAt: row.expires_at }
        : null;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async createHandoff(handoff: HandoffRecord): Promise<void> {
    await this.pool.query(
      `INSERT INTO oauth_handoffs (handoff_hash, project_id, user_id, github_grant_token, expires_at) VALUES ($1, $2, $3, $4, $5)`,
      [handoff.handoffHash, handoff.projectId, handoff.userId, handoff.githubGrantToken ?? null, handoff.expiresAt],
    );
  }

  async consumeHandoff(handoffHash: string): Promise<HandoffRecord | null> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
            const result = await client.query<{ handoff_hash: string; project_id: string; user_id: string; github_grant_token: string | null; expires_at: Date }>(
        `DELETE FROM oauth_handoffs WHERE handoff_hash = $1
         RETURNING handoff_hash, project_id, user_id, github_grant_token, expires_at`,
        [handoffHash],
      );
      await client.query('COMMIT');
      const row = result.rows[0];
      return row ? { handoffHash: row.handoff_hash, projectId: row.project_id, userId: row.user_id, githubGrantToken: row.github_grant_token, expiresAt: row.expires_at } : null;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async saveGithubConnection(connection: GithubConnectionRecord): Promise<void> {
    await this.pool.query(`INSERT INTO github_connections (user_id, github_account_id, login, access_token, refresh_token, expires_at, scopes, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)
      ON CONFLICT (user_id) DO UPDATE SET github_account_id = EXCLUDED.github_account_id, login = EXCLUDED.login, access_token = EXCLUDED.access_token, refresh_token = EXCLUDED.refresh_token, expires_at = EXCLUDED.expires_at, scopes = EXCLUDED.scopes, updated_at = EXCLUDED.updated_at`, [connection.userId, connection.githubAccountId, connection.login, connection.accessToken, connection.refreshToken, connection.expiresAt, JSON.stringify(connection.scopes), connection.updatedAt]);
  }

  async finalizeOAuthAuthorization(input: OAuthFinalizationInput): Promise<OAuthFinalizationResult> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query<{ id: string; email: string | null; name: string | null; avatar_url: string | null }>('SELECT id, email, name, avatar_url FROM users WHERE id = $1', [input.state.userId]);
      const row = result.rows[0];
      if (!row) throw new Error('OAuth user disappeared before finalization');
      if (input.profile.provider === 'github' && input.profile.accessToken) {
        await client.query(`INSERT INTO github_connections (user_id, github_account_id, login, access_token, refresh_token, expires_at, scopes, updated_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)
          ON CONFLICT (user_id) DO UPDATE SET github_account_id = EXCLUDED.github_account_id, login = EXCLUDED.login, access_token = EXCLUDED.access_token, refresh_token = EXCLUDED.refresh_token, expires_at = EXCLUDED.expires_at, scopes = EXCLUDED.scopes, updated_at = EXCLUDED.updated_at`, [row.id, input.profile.providerAccountId, input.profile.username || input.profile.name || input.profile.providerAccountId, input.profile.accessToken, input.profile.refreshToken ?? null, input.profile.expiresInSeconds ? new Date(Date.now() + input.profile.expiresInSeconds * 1_000) : null, JSON.stringify(input.profile.scopes || []), new Date()]);
      }
      await client.query('INSERT INTO sessions (token_hash, user_id, project_id, expires_at) VALUES ($1, $2, $3, $4)', [input.sessionTokenHash, row.id, input.state.projectId, input.sessionExpiresAt]);
      if (input.githubGrantHash && input.githubGrantExpiresAt) await client.query('INSERT INTO github_grants (grant_hash, project_id, user_id, expires_at) VALUES ($1, $2, $3, $4)', [input.githubGrantHash, input.state.projectId, row.id, input.githubGrantExpiresAt]);
      if (input.handoffHash && input.handoffExpiresAt) await client.query('INSERT INTO oauth_handoffs (handoff_hash, project_id, user_id, github_grant_token, expires_at) VALUES ($1, $2, $3, $4, $5)', [input.handoffHash, input.state.projectId, row.id, input.githubGrantToken ?? null, input.handoffExpiresAt]);
      await client.query('COMMIT');
      return { user: { id: row.id, email: row.email, name: row.name, avatarUrl: row.avatar_url } };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async getGithubConnection(userId: string): Promise<GithubConnectionRecord | null> {
    const result = await this.pool.query<{ user_id: string; github_account_id: string; login: string; access_token: string; refresh_token: string | null; expires_at: Date | null; scopes: string[]; updated_at: Date }>('SELECT user_id, github_account_id, login, access_token, refresh_token, expires_at, scopes, updated_at FROM github_connections WHERE user_id = $1', [userId]);
    const row = result.rows[0];
    return row ? { userId: row.user_id, githubAccountId: row.github_account_id, login: row.login, accessToken: row.access_token, refreshToken: row.refresh_token, expiresAt: row.expires_at, scopes: row.scopes || [], updatedAt: row.updated_at } : null;
  }

  async createGithubGrant(grant: GithubGrantRecord): Promise<void> {
    await this.pool.query('INSERT INTO github_grants (grant_hash, project_id, user_id, expires_at) VALUES ($1, $2, $3, $4)', [grant.grantHash, grant.projectId, grant.userId, grant.expiresAt]);
  }

  async getGithubGrant(grantHash: string): Promise<GithubGrantRecord | null> {
    const result = await this.pool.query<{ grant_hash: string; project_id: string; user_id: string; expires_at: Date }>('SELECT grant_hash, project_id, user_id, expires_at FROM github_grants WHERE grant_hash = $1', [grantHash]);
    const row = result.rows[0];
    return row ? { grantHash: row.grant_hash, projectId: row.project_id, userId: row.user_id, expiresAt: row.expires_at } : null;
  }

  async findOrCreateUser(profile: OAuthProfile): Promise<UserRecord> {
    const client = await this.pool.connect();
    const safeEmail = profile.emailVerified ? profile.email : null;
    try {
      await client.query('BEGIN');
      const identity = await client.query<{ user_id: string }>(
        `SELECT user_id FROM identities WHERE provider = $1 AND provider_account_id = $2`,
        [profile.provider, profile.providerAccountId],
      );
      let userId = identity.rows[0]?.user_id;
      if (!userId) {
        const existingUser = safeEmail
          ? await client.query<{ id: string }>('SELECT id FROM users WHERE lower(email) = lower($1) LIMIT 1', [safeEmail])
          : { rows: [] as { id: string }[] };
        userId = existingUser.rows[0]?.id;
      }
      if (!userId) {
        const created = await client.query<{ id: string }>(
          `INSERT INTO users (email, name, avatar_url) VALUES ($1, $2, $3) RETURNING id`,
          [safeEmail, profile.name, profile.avatarUrl],
        );
        userId = created.rows[0]?.id;
      } else {
        await client.query(
          `UPDATE users SET email = COALESCE($2, email), name = COALESCE($3, name), avatar_url = COALESCE($4, avatar_url), updated_at = now()
           WHERE id = $1`,
          [userId, safeEmail, profile.name, profile.avatarUrl],
        );
      }
      if (!userId) throw new Error('Unable to create or locate user');
      await client.query(
        `INSERT INTO identities (user_id, provider, provider_account_id, email, email_verified)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (provider, provider_account_id)
         DO UPDATE SET email = EXCLUDED.email, email_verified = EXCLUDED.email_verified, updated_at = now()`,
        [userId, profile.provider, profile.providerAccountId, safeEmail, profile.emailVerified],
      );
      await client.query('COMMIT');
      const user = await client.query<{ id: string; email: string | null; name: string | null; avatar_url: string | null }>(
        'SELECT id, email, name, avatar_url FROM users WHERE id = $1',
        [userId],
      );
      const row = user.rows[0];
      if (!row) throw new Error('User disappeared after creation');
      return { id: row.id, email: row.email, name: row.name, avatarUrl: row.avatar_url };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async createSession(input: CreateSessionInput): Promise<void> {
    await this.pool.query(
      `INSERT INTO sessions (token_hash, user_id, project_id, expires_at) VALUES ($1, $2, $3, $4)`,
      [input.tokenHash, input.userId, input.projectId, input.expiresAt],
    );
  }

  async getSession(tokenHash: string): Promise<SessionRecord | null> {
    const result = await this.pool.query<{ token_hash: string; user_id: string; project_id: string; expires_at: Date }>(
      `SELECT token_hash, user_id, project_id, expires_at FROM sessions WHERE token_hash = $1 AND expires_at > now()`,
      [tokenHash],
    );
    const row = result.rows[0];
    return row ? { tokenHash: row.token_hash, userId: row.user_id, projectId: row.project_id, expiresAt: row.expires_at } : null;
  }

  async getUser(userId: string): Promise<UserRecord | null> {
    const result = await this.pool.query<{ id: string; email: string | null; name: string | null; avatar_url: string | null }>(
      'SELECT id, email, name, avatar_url FROM users WHERE id = $1',
      [userId],
    );
    const row = result.rows[0];
    return row ? { id: row.id, email: row.email, name: row.name, avatarUrl: row.avatar_url } : null;
  }

  async deleteSession(tokenHash: string): Promise<void> {
    await this.pool.query('DELETE FROM sessions WHERE token_hash = $1', [tokenHash]);
  }

  async createApiToken(token: ApiTokenRecord): Promise<void> {
    await this.pool.query('INSERT INTO api_tokens (token_id, user_id, token_hash, token_prefix, label, created_at, last_used_at, revoked_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)', [token.tokenId, token.userId, token.tokenHash, token.tokenPrefix, token.label, token.createdAt, token.lastUsedAt, token.revokedAt]);
  }

  async listApiTokens(userId: string): Promise<ApiTokenRecord[]> {
    const result = await this.pool.query<{ token_id: string; user_id: string; token_hash: string; token_prefix: string; label: string; created_at: Date; last_used_at: Date | null; revoked_at: Date | null }>('SELECT token_id, user_id, token_hash, token_prefix, label, created_at, last_used_at, revoked_at FROM api_tokens WHERE user_id = $1 ORDER BY created_at DESC', [userId]);
    return result.rows.map((row) => ({ tokenId: row.token_id, userId: row.user_id, tokenHash: row.token_hash, tokenPrefix: row.token_prefix, label: row.label, createdAt: row.created_at, lastUsedAt: row.last_used_at, revokedAt: row.revoked_at }));
  }

  async getApiTokenByHash(tokenHash: string): Promise<ApiTokenRecord | null> {
    const result = await this.pool.query<{ token_id: string; user_id: string; token_hash: string; token_prefix: string; label: string; created_at: Date; last_used_at: Date | null; revoked_at: Date | null }>('SELECT token_id, user_id, token_hash, token_prefix, label, created_at, last_used_at, revoked_at FROM api_tokens WHERE token_hash = $1 AND revoked_at IS NULL', [tokenHash]);
    const row = result.rows[0];
    return row ? { tokenId: row.token_id, userId: row.user_id, tokenHash: row.token_hash, tokenPrefix: row.token_prefix, label: row.label, createdAt: row.created_at, lastUsedAt: row.last_used_at, revokedAt: row.revoked_at } : null;
  }

  async touchApiToken(tokenId: string): Promise<void> {
    await this.pool.query('UPDATE api_tokens SET last_used_at = now() WHERE token_id = $1', [tokenId]);
  }

  async revokeApiToken(userId: string, tokenId: string): Promise<boolean> {
    const result = await this.pool.query('UPDATE api_tokens SET revoked_at = now() WHERE token_id = $1 AND user_id = $2 AND revoked_at IS NULL', [tokenId, userId]);
    return result.rowCount === 1;
  }
}
