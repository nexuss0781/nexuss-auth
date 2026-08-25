import { randomUUID } from 'node:crypto';
import { connect, type ParadConnection } from 'parad';
import type {
  ApiTokenRecord,
  CreateSessionInput,
  Database,
  HandoffRecord,
  OAuthProfile,
  OAuthStateRecord,
  GithubConnectionRecord,
  GithubGrantRecord,
  ProjectRecord,
  SessionRecord,
  UserRecord,
} from './types.js';

const schemaStatements = [
  `CREATE TABLE IF NOT EXISTS projects (
    project_id TEXT PRIMARY KEY,
    owner_user_id TEXT,
    name TEXT NOT NULL,
    homepage_url TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    avatar_url TEXT,
    allowed_redirect_uris TEXT NOT NULL,
    allowed_origins TEXT NOT NULL DEFAULT '[]',
    enabled_providers TEXT NOT NULL DEFAULT '["google","github"]',
    status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE,
    name TEXT,
    avatar_url TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS identities (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider TEXT NOT NULL CHECK (provider IN ('google', 'github')),
    provider_account_id TEXT NOT NULL,
    email TEXT,
    email_verified INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (provider, provider_account_id)
  )`,
  `CREATE TABLE IF NOT EXISTS oauth_states (
    state_hash TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
    provider TEXT NOT NULL CHECK (provider IN ('google', 'github')),
    redirect_uri TEXT NOT NULL,
    handoff INTEGER NOT NULL DEFAULT 0,
    expires_at TEXT NOT NULL,
    purpose TEXT NOT NULL DEFAULT 'sign_in'
  )`,
  `CREATE TABLE IF NOT EXISTS oauth_handoffs (
    handoff_hash TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    github_grant_token TEXT,
    expires_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS github_connections (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    github_account_id TEXT NOT NULL,
    login TEXT NOT NULL,
    access_token TEXT NOT NULL,
    refresh_token TEXT,
    expires_at TEXT,
    scopes TEXT NOT NULL DEFAULT '[]',
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS github_grants (
    grant_hash TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    project_id TEXT NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  'CREATE INDEX IF NOT EXISTS oauth_states_expires_at_idx ON oauth_states(expires_at)',
  'CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON sessions(user_id)',
  'CREATE INDEX IF NOT EXISTS sessions_expires_at_idx ON sessions(expires_at)',
  `CREATE TABLE IF NOT EXISTS api_tokens (
    token_id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    token_prefix TEXT NOT NULL,
    label TEXT NOT NULL DEFAULT 'CLI token',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_used_at TEXT,
    revoked_at TEXT
  )`,
  'CREATE INDEX IF NOT EXISTS api_tokens_user_id_idx ON api_tokens(user_id)',
  'CREATE INDEX IF NOT EXISTS api_tokens_hash_idx ON api_tokens(token_hash)',
  'CREATE INDEX IF NOT EXISTS github_grants_project_user_idx ON github_grants(project_id, user_id)',
];

const projectMigrationStatements = [
  "ALTER TABLE oauth_states ADD COLUMN handoff INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE oauth_states ADD COLUMN purpose TEXT NOT NULL DEFAULT 'sign_in'",
  "ALTER TABLE oauth_handoffs ADD COLUMN github_grant_token TEXT",
  "ALTER TABLE projects ADD COLUMN owner_user_id TEXT",
  "ALTER TABLE projects ADD COLUMN homepage_url TEXT NOT NULL DEFAULT ''",
  "ALTER TABLE projects ADD COLUMN description TEXT NOT NULL DEFAULT ''",
  'ALTER TABLE projects ADD COLUMN avatar_url TEXT',
  "ALTER TABLE projects ADD COLUMN allowed_origins TEXT NOT NULL DEFAULT '[]'",
  "ALTER TABLE projects ADD COLUMN enabled_providers TEXT NOT NULL DEFAULT '[\"google\",\"github\"]'",
  "ALTER TABLE projects ADD COLUMN status TEXT NOT NULL DEFAULT 'active'",
];

type ParadConfig = {
  gatewayUrl: string;
  apiKey: string;
  passphrase: string;
  project: string;
  name: string;
};

function iso(value: Date): string {
  return value.toISOString();
}

function date(value: unknown): Date {
  return new Date(String(value));
}

function jsonUris(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

function jsonProviders(value: string): ('google' | 'github')[] {
  return jsonUris(value).filter((provider): provider is 'google' | 'github' => provider === 'google' || provider === 'github');
}

type ProjectRow = {
  project_id: string;
  owner_user_id: string | null;
  name: string;
  homepage_url: string;
  description: string;
  avatar_url: string | null;
  allowed_redirect_uris: string;
  allowed_origins: string;
  enabled_providers: string;
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
    allowedRedirectUris: jsonUris(row.allowed_redirect_uris),
    allowedOrigins: jsonUris(row.allowed_origins),
    enabledProviders: jsonProviders(row.enabled_providers),
    status: row.status === 'disabled' ? 'disabled' : 'active',
  };
}

function rows<T extends Record<string, unknown>>(db: ParadConnection, sql: string, params: unknown[] = []): T[] {
  return db.execute(sql, params as any[]).rows as T[];
}

function one<T extends Record<string, unknown>>(db: ParadConnection, sql: string, params: unknown[] = []): T | null {
  return rows<T>(db, sql, params)[0] ?? null;
}

export class ParadoxDatabase implements Database {
  private readonly config: ParadConfig;
  private connection: ParadConnection | null = null;
  private initialized = false;
  private lock: Promise<void> = Promise.resolve();

  constructor(config: ParadConfig) {
    this.config = config;
  }

  async close(): Promise<void> {
    await this.lock;
    this.connection?.close();
    this.connection = null;
    this.initialized = false;
  }

  private async assertRemoteSnapshot(): Promise<void> {
    const url = new URL(`${this.config.gatewayUrl}/download`);
    url.searchParams.set('database_name', this.config.name);
    url.searchParams.set('project_id', this.config.project);
    const response = await fetch(url, { headers: { 'X-API-Key': this.config.apiKey } });
    if (!response.ok) throw new Error(`Paradox remote snapshot unavailable (HTTP ${response.status})`);
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength === 0) throw new Error('Paradox remote snapshot is empty');
  }

  private async open(): Promise<ParadConnection> {
    if (!this.connection) {
      await this.assertRemoteSnapshot();
      const dbPath = `/tmp/${this.config.name}.db`;
      this.connection = await connect({
        name: this.config.name,
        project: this.config.project,
        dbPath,
        gatewayUrl: this.config.gatewayUrl,
        apiKey: this.config.apiKey,
        passphrase: this.config.passphrase,
        autoSync: false,
        pullOnStartup: false,
      });
      await this.connection.pull();
    }
    if (!this.initialized) {
      for (const statement of schemaStatements) this.connection.execute(statement);
      for (const statement of projectMigrationStatements) {
        try { this.connection.execute(statement); } catch { /* Existing databases already have this column. */ }
      }
      this.initialized = true;
    }
    return this.connection;
  }

  private async run<T>(work: (db: ParadConnection) => Promise<T> | T, write = false): Promise<T> {
    let release!: () => void;
    const previous = this.lock;
    this.lock = new Promise<void>((resolve) => { release = resolve; });
    await previous;

    try {
      const db = await this.open();
      if (write) await db.pull();
      const result = await work(db);
      if (write) await db.push();
      return result;
    } finally {
      release();
    }
  }

  async listProjects(ownerUserId?: string): Promise<ProjectRecord[]> {
    return this.run((db) => rows<ProjectRow>(db, ownerUserId
      ? 'SELECT project_id, owner_user_id, name, homepage_url, description, avatar_url, allowed_redirect_uris, allowed_origins, enabled_providers, status FROM projects WHERE owner_user_id = ? ORDER BY created_at DESC, project_id ASC'
      : 'SELECT project_id, owner_user_id, name, homepage_url, description, avatar_url, allowed_redirect_uris, allowed_origins, enabled_providers, status FROM projects ORDER BY created_at DESC, project_id ASC', ownerUserId ? [ownerUserId] : []).map(projectFromRow));
  }

  async getProject(projectId: string): Promise<ProjectRecord | null> {
    return this.run((db) => {
      const row = one<ProjectRow>(db, 'SELECT project_id, owner_user_id, name, homepage_url, description, avatar_url, allowed_redirect_uris, allowed_origins, enabled_providers, status FROM projects WHERE project_id = ?', [projectId]);
      return row ? projectFromRow(row) : null;
    });
  }

  async upsertProject(project: ProjectRecord): Promise<ProjectRecord> {
    return this.run((db) => {
      db.execute(
        `INSERT INTO projects (project_id, owner_user_id, name, homepage_url, description, avatar_url, allowed_redirect_uris, allowed_origins, enabled_providers, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(project_id) DO UPDATE SET owner_user_id = COALESCE(excluded.owner_user_id, projects.owner_user_id), name = excluded.name, homepage_url = excluded.homepage_url, description = excluded.description, avatar_url = excluded.avatar_url, allowed_redirect_uris = excluded.allowed_redirect_uris, allowed_origins = excluded.allowed_origins, enabled_providers = excluded.enabled_providers, status = excluded.status, updated_at = CURRENT_TIMESTAMP`,
        [project.projectId, project.ownerUserId, project.name, project.homepageUrl, project.description, project.avatarUrl, JSON.stringify(project.allowedRedirectUris), JSON.stringify(project.allowedOrigins), JSON.stringify(project.enabledProviders), project.status],
      );
      return project;
    }, true);
  }

  async deleteProject(projectId: string): Promise<void> {
    await this.run((db) => {
      db.execute('DELETE FROM projects WHERE project_id = ?', [projectId]);
    }, true);
  }

  async createOAuthState(state: OAuthStateRecord): Promise<void> {
    await this.run((db) => {
      db.execute('INSERT INTO oauth_states (state_hash, project_id, provider, redirect_uri, handoff, expires_at, purpose) VALUES (?, ?, ?, ?, ?, ?, ?)', [state.stateHash, state.projectId, state.provider, state.redirectUri, state.handoff ? 1 : 0, iso(state.expiresAt), state.purpose ?? 'sign_in']);
    }, true);
  }

  async consumeOAuthState(stateHash: string): Promise<OAuthStateRecord | null> {
    return this.run((db) => {
      const row = one<{ state_hash: string; project_id: string; provider: 'google' | 'github'; redirect_uri: string; handoff: number; expires_at: string; purpose: 'sign_in' | 'github_authorization' }>(db, 'SELECT state_hash, project_id, provider, redirect_uri, handoff, expires_at, purpose FROM oauth_states WHERE state_hash = ?', [stateHash]);
      if (!row) return null;
      db.execute('DELETE FROM oauth_states WHERE state_hash = ?', [stateHash]);
      return { stateHash: row.state_hash, projectId: row.project_id, provider: row.provider, redirectUri: row.redirect_uri, handoff: row.handoff === 1, purpose: row.purpose || 'sign_in', expiresAt: date(row.expires_at) };
    }, true);
  }

  async createHandoff(handoff: HandoffRecord): Promise<void> {
    await this.run((db) => {
      db.execute('INSERT INTO oauth_handoffs (handoff_hash, project_id, user_id, github_grant_token, expires_at) VALUES (?, ?, ?, ?, ?)', [handoff.handoffHash, handoff.projectId, handoff.userId, handoff.githubGrantToken ?? null, iso(handoff.expiresAt)]);
    }, true);
  }

  async consumeHandoff(handoffHash: string): Promise<HandoffRecord | null> {
    return this.run((db) => {
      const row = one<{ handoff_hash: string; project_id: string; user_id: string; github_grant_token: string | null; expires_at: string }>(db, 'SELECT handoff_hash, project_id, user_id, github_grant_token, expires_at FROM oauth_handoffs WHERE handoff_hash = ?', [handoffHash]);
      if (!row) return null;
      db.execute('DELETE FROM oauth_handoffs WHERE handoff_hash = ?', [handoffHash]);
      return { handoffHash: row.handoff_hash, projectId: row.project_id, userId: row.user_id, githubGrantToken: row.github_grant_token, expiresAt: date(row.expires_at) };
    }, true);
  }

  async saveGithubConnection(connection: GithubConnectionRecord): Promise<void> {
    await this.run((db) => {
      db.execute(`INSERT INTO github_connections (user_id, github_account_id, login, access_token, refresh_token, expires_at, scopes, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id) DO UPDATE SET github_account_id = excluded.github_account_id, login = excluded.login, access_token = excluded.access_token, refresh_token = excluded.refresh_token, expires_at = excluded.expires_at, scopes = excluded.scopes, updated_at = excluded.updated_at`, [connection.userId, connection.githubAccountId, connection.login, connection.accessToken, connection.refreshToken, connection.expiresAt ? iso(connection.expiresAt) : null, JSON.stringify(connection.scopes), iso(connection.updatedAt)]);
    }, true);
  }

  async getGithubConnection(userId: string): Promise<GithubConnectionRecord | null> {
    return this.run((db) => {
      const row = one<{ user_id: string; github_account_id: string; login: string; access_token: string; refresh_token: string | null; expires_at: string | null; scopes: string; updated_at: string }>(db, 'SELECT user_id, github_account_id, login, access_token, refresh_token, expires_at, scopes, updated_at FROM github_connections WHERE user_id = ?', [userId]);
      if (!row) return null;
      let scopes: string[] = [];
      try { const parsed = JSON.parse(row.scopes); if (Array.isArray(parsed)) scopes = parsed.filter((scope): scope is string => typeof scope === 'string'); } catch { /* Keep an empty scope list for a malformed legacy row. */ }
      return { userId: row.user_id, githubAccountId: row.github_account_id, login: row.login, accessToken: row.access_token, refreshToken: row.refresh_token, expiresAt: row.expires_at ? date(row.expires_at) : null, scopes, updatedAt: date(row.updated_at) };
    });
  }

  async createGithubGrant(grant: GithubGrantRecord): Promise<void> {
    await this.run((db) => {
      db.execute('INSERT INTO github_grants (grant_hash, project_id, user_id, expires_at) VALUES (?, ?, ?, ?)', [grant.grantHash, grant.projectId, grant.userId, iso(grant.expiresAt)]);
    }, true);
  }

  async getGithubGrant(grantHash: string): Promise<GithubGrantRecord | null> {
    return this.run((db) => {
      const row = one<{ grant_hash: string; project_id: string; user_id: string; expires_at: string }>(db, 'SELECT grant_hash, project_id, user_id, expires_at FROM github_grants WHERE grant_hash = ?', [grantHash]);
      return row ? { grantHash: row.grant_hash, projectId: row.project_id, userId: row.user_id, expiresAt: date(row.expires_at) } : null;
    });
  }

  async findOrCreateUser(profile: OAuthProfile): Promise<UserRecord> {
    return this.run((db) => {
      const safeEmail = profile.emailVerified ? profile.email : null;
      const identity = one<{ user_id: string }>(db, 'SELECT user_id FROM identities WHERE provider = ? AND provider_account_id = ?', [profile.provider, profile.providerAccountId]);
      let userId = identity?.user_id;
      if (!userId && safeEmail) userId = one<{ id: string }>(db, 'SELECT id FROM users WHERE lower(email) = lower(?) LIMIT 1', [safeEmail])?.id;
      if (!userId) {
        userId = randomUUID();
        db.execute('INSERT INTO users (id, email, name, avatar_url) VALUES (?, ?, ?, ?)', [userId, safeEmail, profile.name, profile.avatarUrl]);
      } else {
        db.execute('UPDATE users SET email = COALESCE(?, email), name = COALESCE(?, name), avatar_url = COALESCE(?, avatar_url), updated_at = CURRENT_TIMESTAMP WHERE id = ?', [safeEmail, profile.name, profile.avatarUrl, userId]);
      }
      db.execute(
        `INSERT INTO identities (id, user_id, provider, provider_account_id, email, email_verified) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(provider, provider_account_id) DO UPDATE SET email = excluded.email, email_verified = excluded.email_verified, updated_at = CURRENT_TIMESTAMP`,
        [randomUUID(), userId, profile.provider, profile.providerAccountId, safeEmail, profile.emailVerified ? 1 : 0],
      );
      const row = one<{ id: string; email: string | null; name: string | null; avatar_url: string | null }>(db, 'SELECT id, email, name, avatar_url FROM users WHERE id = ?', [userId]);
      if (!row) throw new Error('User disappeared after creation');
      return { id: row.id, email: row.email, name: row.name, avatarUrl: row.avatar_url };
    }, true);
  }

  async createSession(input: CreateSessionInput): Promise<void> {
    await this.run((db) => {
      db.execute('INSERT INTO sessions (token_hash, user_id, project_id, expires_at) VALUES (?, ?, ?, ?)', [input.tokenHash, input.userId, input.projectId, iso(input.expiresAt)]);
    }, true);
  }

  async getSession(tokenHash: string): Promise<SessionRecord | null> {
    return this.run((db) => {
      const row = one<{ token_hash: string; user_id: string; project_id: string; expires_at: string }>(db, 'SELECT token_hash, user_id, project_id, expires_at FROM sessions WHERE token_hash = ? AND expires_at > ?', [tokenHash, iso(new Date())]);
      return row ? { tokenHash: row.token_hash, userId: row.user_id, projectId: row.project_id, expiresAt: date(row.expires_at) } : null;
    });
  }

  async getUser(userId: string): Promise<UserRecord | null> {
    return this.run((db) => {
      const row = one<{ id: string; email: string | null; name: string | null; avatar_url: string | null }>(db, 'SELECT id, email, name, avatar_url FROM users WHERE id = ?', [userId]);
      return row ? { id: row.id, email: row.email, name: row.name, avatarUrl: row.avatar_url } : null;
    });
  }

  async deleteSession(tokenHash: string): Promise<void> {
    await this.run((db) => {
      db.execute('DELETE FROM sessions WHERE token_hash = ?', [tokenHash]);
    }, true);
  }

  async createApiToken(token: ApiTokenRecord): Promise<void> {
    await this.run((db) => {
      db.execute('INSERT INTO api_tokens (token_id, user_id, token_hash, token_prefix, label, created_at, last_used_at, revoked_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [token.tokenId, token.userId, token.tokenHash, token.tokenPrefix, token.label, iso(token.createdAt), token.lastUsedAt ? iso(token.lastUsedAt) : null, token.revokedAt ? iso(token.revokedAt) : null]);
    }, true);
  }

  async listApiTokens(userId: string): Promise<ApiTokenRecord[]> {
    return this.run((db) => rows<{ token_id: string; user_id: string; token_hash: string; token_prefix: string; label: string; created_at: string; last_used_at: string | null; revoked_at: string | null }>(db, 'SELECT token_id, user_id, token_hash, token_prefix, label, created_at, last_used_at, revoked_at FROM api_tokens WHERE user_id = ? ORDER BY created_at DESC', [userId]).map((row) => ({ tokenId: row.token_id, userId: row.user_id, tokenHash: row.token_hash, tokenPrefix: row.token_prefix, label: row.label, createdAt: date(row.created_at), lastUsedAt: row.last_used_at ? date(row.last_used_at) : null, revokedAt: row.revoked_at ? date(row.revoked_at) : null })));
  }

  async getApiTokenByHash(tokenHash: string): Promise<ApiTokenRecord | null> {
    return this.run((db) => {
      const row = one<{ token_id: string; user_id: string; token_hash: string; token_prefix: string; label: string; created_at: string; last_used_at: string | null; revoked_at: string | null }>(db, 'SELECT token_id, user_id, token_hash, token_prefix, label, created_at, last_used_at, revoked_at FROM api_tokens WHERE token_hash = ? AND revoked_at IS NULL', [tokenHash]);
      return row ? { tokenId: row.token_id, userId: row.user_id, tokenHash: row.token_hash, tokenPrefix: row.token_prefix, label: row.label, createdAt: date(row.created_at), lastUsedAt: row.last_used_at ? date(row.last_used_at) : null, revokedAt: row.revoked_at ? date(row.revoked_at) : null } : null;
    });
  }

  async touchApiToken(tokenId: string): Promise<void> {
    await this.run((db) => {
      db.execute('UPDATE api_tokens SET last_used_at = ? WHERE token_id = ?', [iso(new Date()), tokenId]);
    }, true);
  }

  async revokeApiToken(userId: string, tokenId: string): Promise<boolean> {
    return this.run((db) => {
      const result = db.execute('UPDATE api_tokens SET revoked_at = ? WHERE token_id = ? AND user_id = ? AND revoked_at IS NULL', [iso(new Date()), tokenId, userId]);
      return result.changes > 0;
    }, true);
  }
}

export function createParadoxDatabaseFromEnv(): ParadoxDatabase {
  const gatewayUrl = process.env.PARADOX_GATEWAY_URL;
  const apiKey = process.env.PARADOX_API_KEY;
  const passphrase = process.env.PARADOX_PASSPHRASE;
  if (!gatewayUrl || !apiKey || !passphrase) {
    throw new Error('PARADOX_GATEWAY_URL, PARADOX_API_KEY, and PARADOX_PASSPHRASE are required');
  }
  return new ParadoxDatabase({
    gatewayUrl: gatewayUrl.replace(/\/$/, ''),
    apiKey,
    passphrase,
    project: process.env.PARADOX_PROJECT || 'nexuss-auth',
    name: process.env.PARADOX_DATABASE || 'nexuss-auth',
  });
}
