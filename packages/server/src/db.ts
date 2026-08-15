import pg from 'pg';
import type {
  CreateSessionInput,
  Database,
  OAuthProfile,
  OAuthStateRecord,
  ProjectRecord,
  SessionRecord,
  UserRecord,
} from './types.js';

const { Pool } = pg;

type Queryable = { query: pg.Pool['query'] };

export class PostgresDatabase implements Database {
  private readonly pool: pg.Pool;

  constructor(databaseUrl: string) {
    this.pool = new Pool({ connectionString: databaseUrl, max: 10 });
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  async getProject(projectId: string): Promise<ProjectRecord | null> {
    const result = await this.pool.query<{ project_id: string; name: string; allowed_redirect_uris: string[] }>(
      'SELECT project_id, name, allowed_redirect_uris FROM projects WHERE project_id = $1',
      [projectId],
    );
    const row = result.rows[0];
    return row ? { projectId: row.project_id, name: row.name, allowedRedirectUris: row.allowed_redirect_uris } : null;
  }

  async upsertProject(project: ProjectRecord): Promise<ProjectRecord> {
    await this.pool.query(
      `INSERT INTO projects (project_id, name, allowed_redirect_uris)
       VALUES ($1, $2, $3)
       ON CONFLICT (project_id) DO UPDATE SET name = EXCLUDED.name, allowed_redirect_uris = EXCLUDED.allowed_redirect_uris`,
      [project.projectId, project.name, project.allowedRedirectUris],
    );
    return project;
  }

  async createOAuthState(state: OAuthStateRecord): Promise<void> {
    await this.pool.query(
      `INSERT INTO oauth_states (state_hash, project_id, provider, redirect_uri, expires_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [state.stateHash, state.projectId, state.provider, state.redirectUri, state.expiresAt],
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
        expires_at: Date;
      }>(
        `DELETE FROM oauth_states WHERE state_hash = $1
         RETURNING state_hash, project_id, provider, redirect_uri, expires_at`,
        [stateHash],
      );
      await client.query('COMMIT');
      const row = result.rows[0];
      return row
        ? { stateHash: row.state_hash, projectId: row.project_id, provider: row.provider, redirectUri: row.redirect_uri, expiresAt: row.expires_at }
        : null;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
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
}
