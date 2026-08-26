import test from 'node:test';
import assert from 'node:assert/strict';
import { hashToken } from './crypto.js';
import { createAuthApp } from './server.js';
import type { ApiTokenRecord, Database, GithubConnectionRecord, GithubGrantRecord, HandoffRecord, OAuthProfile, OAuthStateRecord, ProjectRecord, SessionRecord, UserRecord } from './types.js';

class MemoryDatabase implements Database {
  projects = new Map<string, ProjectRecord>();
  states = new Map<string, OAuthStateRecord>();
  handoffs = new Map<string, HandoffRecord>();
  githubConnections = new Map<string, GithubConnectionRecord>();
  githubGrants = new Map<string, GithubGrantRecord>();
  users = new Map<string, UserRecord>();
  sessions = new Map<string, SessionRecord>();
  apiTokens = new Map<string, ApiTokenRecord>();
  async close(): Promise<void> {}
  async listProjects(ownerUserId?: string): Promise<ProjectRecord[]> { return [...this.projects.values()].filter((project) => !ownerUserId || project.ownerUserId === ownerUserId); }
  async getProject(projectId: string): Promise<ProjectRecord | null> { return this.projects.get(projectId) ?? null; }
  async upsertProject(project: ProjectRecord): Promise<ProjectRecord> { this.projects.set(project.projectId, project); return project; }
  async deleteProject(projectId: string): Promise<void> { this.projects.delete(projectId); }
  async createOAuthState(state: OAuthStateRecord): Promise<void> { this.states.set(state.stateHash, state); }
  async consumeOAuthState(stateHash: string): Promise<OAuthStateRecord | null> {
    const state = this.states.get(stateHash) ?? null;
    this.states.delete(stateHash);
    return state;
  }
  async createHandoff(handoff: HandoffRecord): Promise<void> { this.handoffs.set(handoff.handoffHash, handoff); }
  async consumeHandoff(handoffHash: string): Promise<HandoffRecord | null> {
    const handoff = this.handoffs.get(handoffHash) ?? null;
    this.handoffs.delete(handoffHash);
    return handoff;
  }
  async saveGithubConnection(connection: GithubConnectionRecord): Promise<void> { this.githubConnections.set(connection.userId, connection); }
  async getGithubConnection(userId: string): Promise<GithubConnectionRecord | null> { return this.githubConnections.get(userId) ?? null; }
  async createGithubGrant(grant: GithubGrantRecord): Promise<void> { this.githubGrants.set(grant.grantHash, grant); }
  async getGithubGrant(grantHash: string): Promise<GithubGrantRecord | null> { return this.githubGrants.get(grantHash) ?? null; }
  async findOrCreateUser(profile: OAuthProfile): Promise<UserRecord> {
    const user = { id: 'u1', email: profile.email, name: profile.name, avatarUrl: profile.avatarUrl };
    this.users.set(user.id, user);
    return user;
  }
  async createSession(input: { userId: string; projectId: string; tokenHash: string; expiresAt: Date }): Promise<void> {
    this.sessions.set(input.tokenHash, input);
  }
  async getSession(tokenHash: string): Promise<SessionRecord | null> { return this.sessions.get(tokenHash) ?? null; }
  async getUser(userId: string): Promise<UserRecord | null> { return this.users.get(userId) ?? null; }
  async deleteSession(tokenHash: string): Promise<void> { this.sessions.delete(tokenHash); }
  async createApiToken(token: ApiTokenRecord): Promise<void> { this.apiTokens.set(token.tokenId, token); }
  async listApiTokens(userId: string): Promise<ApiTokenRecord[]> { return [...this.apiTokens.values()].filter((token) => token.userId === userId); }
  async getApiTokenByHash(tokenHash: string): Promise<ApiTokenRecord | null> { return [...this.apiTokens.values()].find((token) => token.tokenHash === tokenHash && !token.revokedAt) ?? null; }
  async touchApiToken(tokenId: string): Promise<void> { const token = this.apiTokens.get(tokenId); if (token) token.lastUsedAt = new Date(); }
  async revokeApiToken(userId: string, tokenId: string): Promise<boolean> { const token = this.apiTokens.get(tokenId); if (!token || token.userId !== userId || token.revokedAt) return false; token.revokedAt = new Date(); return true; }
}

const config = {
  port: 8787,
  databaseUrl: 'unused',
  publicUrl: 'https://auth.example.com',
  sessionTtlSeconds: 3600,
  stateTtlSeconds: 600,
  cookieName: 'nex_auth_session',
  adminToken: 'admin-secret',
  googleClientId: 'google-id',
  googleClientSecret: 'google-secret',
  githubClientId: 'github-id',
  githubClientSecret: 'github-secret',
};

const demoProject: ProjectRecord = {
  projectId: 'demo',
  ownerUserId: null,
  name: 'Demo',
  homepageUrl: 'https://demo.example.com',
  description: 'Demo project',
  avatarUrl: null,
  allowedRedirectUris: ['https://demo.example.com/login'],
  allowedOrigins: ['https://demo.example.com'],
  enabledProviders: ['google', 'github'],
  status: 'active',
};

test('server provisions a project and creates a provider redirect with one-time state', async () => {
  const db = new MemoryDatabase();
  const app = createAuthApp(config, db);
  const provision = await app.fetch(new Request('https://auth.example.com/v1/projects', {
    method: 'POST',
    headers: { authorization: 'Bearer admin-secret', 'content-type': 'application/json' },
    body: JSON.stringify(demoProject),
  }));
  assert.equal(provision.status, 201);
  const start = await app.fetch(new Request('https://auth.example.com/oauth/start/google?project_id=demo&redirect_uri=https%3A%2F%2Fdemo.example.com%2Flogin'));
  assert.equal(start.status, 302);
  assert.match(start.headers.get('location') ?? '', /^https:\/\/accounts\.google\.com/);
  assert.equal(db.states.size, 1);
});

test('GitHub authorization requests repository scope and grant access stays project-scoped', async () => {
  const db = new MemoryDatabase();
  await db.upsertProject(demoProject);
  db.users.set('google-user', { id: 'google-user', email: 'owner@example.com', name: 'Google Owner', avatarUrl: 'https://avatar.example.com/google.png' });
  db.sessions.set(hashToken('central-session'), { tokenHash: hashToken('central-session'), userId: 'google-user', projectId: 'demo', expiresAt: new Date(Date.now() + 60_000) });
  const app = createAuthApp(config, db);
  const start = await app.fetch(new Request('https://auth.example.com/oauth/start/github?project_id=demo&redirect_uri=https%3A%2F%2Fdemo.example.com%2Flogin&handoff=1&purpose=github_authorization', { headers: { cookie: 'nex_auth_session=central-session' } }));
  assert.equal(start.status, 302);
  assert.match(start.headers.get('location') ?? '', /scope=repo/);
  assert.equal(db.states.values().next().value?.purpose, 'github_authorization');
  assert.equal(db.states.values().next().value?.userId, 'google-user');
  db.users.set('u1', { id: 'u1', email: 'ada@example.com', name: 'Ada', avatarUrl: null });
  db.githubConnections.set('u1', { userId: 'u1', githubAccountId: '42', login: 'ada', accessToken: 'github-secret-token', refreshToken: null, expiresAt: null, scopes: ['repo'], updatedAt: new Date() });
  db.githubGrants.set(hashToken('grant-token'), { grantHash: hashToken('grant-token'), projectId: 'demo', userId: 'u1', expiresAt: new Date(Date.now() + 60_000) });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify([{ id: 7, name: 'private-repo', full_name: 'ada/private-repo', private: true, description: null, html_url: 'https://github.com/ada/private-repo', default_branch: 'main' }]), { status: 200, headers: { 'content-type': 'application/json' } });
  try {
    const repositories = await app.fetch(new Request('https://auth.example.com/v1/github/repositories?project_id=demo', { headers: { authorization: 'Bearer grant-token' } }));
    assert.equal(repositories.status, 200);
    assert.equal((await repositories.json()).repositories[0].full_name, 'ada/private-repo');
    const wrongProject = await app.fetch(new Request('https://auth.example.com/v1/github/repositories?project_id=other', { headers: { authorization: 'Bearer grant-token' } }));
    assert.equal(wrongProject.status, 401);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('GitHub branches stay project-scoped and return safe branch metadata', async () => {
  const db = new MemoryDatabase();
  await db.upsertProject(demoProject);
  db.users.set('u1', { id: 'u1', email: 'ada@example.com', name: 'Ada', avatarUrl: null });
  db.githubConnections.set('u1', { userId: 'u1', githubAccountId: '42', login: 'ada', accessToken: 'github-secret-token', refreshToken: null, expiresAt: null, scopes: ['repo'], updatedAt: new Date() });
  db.githubGrants.set(hashToken('grant-token'), { grantHash: hashToken('grant-token'), projectId: 'demo', userId: 'u1', expiresAt: new Date(Date.now() + 60_000) });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    assert.match(String(input), /repos\/ada\/private-repo\/branches/);
    return new Response(JSON.stringify([{ name: 'main', protected: true }, { name: 'feature/search', protected: false }, { name: 'bad\u0000branch', protected: false }]), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    const response = await createAuthApp(config, db).fetch(new Request('https://auth.example.com/v1/github/branches?project_id=demo&owner=ada&repo=private-repo', { headers: { authorization: 'Bearer grant-token' } }));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { owner: 'ada', repo: 'private-repo', branches: [{ name: 'main', protected: true }, { name: 'feature/search', protected: false }] });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('handoff exchange returns the project user once and rejects replay', async () => {
  const db = new MemoryDatabase();
  await db.upsertProject(demoProject);
  db.users.set('u1', { id: 'u1', email: 'ada@example.com', name: 'Ada', avatarUrl: null });
  db.handoffs.set(hashToken('handoff-token'), { handoffHash: hashToken('handoff-token'), projectId: 'demo', userId: 'u1', expiresAt: new Date(Date.now() + 60_000) });
  const app = createAuthApp(config, db);
  const exchange = await app.fetch(new Request('https://auth.example.com/v1/handoff/exchange', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ projectId: 'demo', handoffToken: 'handoff-token' }),
  }));
  assert.equal(exchange.status, 200);
  assert.deepEqual((await exchange.json()).user, db.users.get('u1'));
  const replay = await app.fetch(new Request('https://auth.example.com/v1/handoff/exchange', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ projectId: 'demo', handoffToken: 'handoff-token' }),
  }));
  assert.equal(replay.status, 401);
});

test('server returns the user for a project-scoped session and clears it on logout', async () => {
  const db = new MemoryDatabase();
  await db.upsertProject(demoProject);
  db.users.set('u1', { id: 'u1', email: 'ada@example.com', name: 'Ada', avatarUrl: null });
  db.sessions.set(hashToken('session-token'), { tokenHash: hashToken('session-token'), userId: 'u1', projectId: 'demo', expiresAt: new Date(Date.now() + 60_000) });
  const app = createAuthApp(config, db);
  const me = await app.fetch(new Request('https://auth.example.com/v1/me?project_id=demo', {
    headers: { cookie: 'nex_auth_session=session-token', 'x-nex-auth-project': 'demo', origin: 'https://demo.example.com' },
  }));
  assert.equal(me.status, 200);
  assert.deepEqual((await me.json()).user, db.users.get('u1'));
  const logout = await app.fetch(new Request('https://auth.example.com/v1/logout', {
    method: 'POST',
    headers: { cookie: 'nex_auth_session=session-token', 'x-nex-auth-project': 'demo', origin: 'https://demo.example.com' },
  }));
  assert.equal(logout.status, 204);
  assert.equal(db.sessions.size, 0);
  assert.match(logout.headers.get('set-cookie') ?? '', /Max-Age=0/);
});

test('admin can list and update provider configuration for a project', async () => {
  const db = new MemoryDatabase();
  await db.upsertProject(demoProject);
  const app = createAuthApp(config, db);
  const listed = await app.fetch(new Request('https://auth.example.com/v1/projects', { headers: { authorization: 'Bearer admin-secret' } }));
  assert.equal(listed.status, 200);
  assert.equal((await listed.json()).projects[0].projectId, 'demo');
  const updated = await app.fetch(new Request('https://auth.example.com/v1/projects/demo', {
    method: 'PATCH',
    headers: { authorization: 'Bearer admin-secret', 'content-type': 'application/json' },
    body: JSON.stringify({ description: 'Dashboard project', enabledProviders: ['github'] }),
  }));
  assert.equal(updated.status, 200);
  assert.deepEqual((await updated.json()).enabledProviders, ['github']);
  const rejected = await app.fetch(new Request('https://auth.example.com/oauth/start/google?project_id=demo&redirect_uri=https%3A%2F%2Fdemo.example.com%2Flogin'));
  assert.equal(rejected.status, 400);
});

test('an authenticated user can manage only their own projects without an admin bearer token', async () => {
  const db = new MemoryDatabase();
  await db.upsertProject({ ...demoProject, ownerUserId: 'owner' });
  await db.upsertProject({ ...demoProject, projectId: 'other', name: 'Other', ownerUserId: 'other-user' });
  db.users.set('owner', { id: 'owner', email: 'owner@example.com', name: 'Owner', avatarUrl: null });
  db.sessions.set(hashToken('owner-session'), { tokenHash: hashToken('owner-session'), userId: 'owner', projectId: 'nexuss-dashboard', expiresAt: new Date(Date.now() + 60_000) });
  const app = createAuthApp(config, db);
  const result = await app.fetch(new Request('https://auth.example.com/v1/projects', {
    headers: { cookie: 'nex_auth_session=owner-session' },
  }));
  assert.equal(result.status, 200);
  assert.deepEqual((await result.json()).projects.map((project: ProjectRecord) => project.projectId), ['demo']);
  const forbidden = await app.fetch(new Request('https://auth.example.com/v1/projects/other', {
    headers: { cookie: 'nex_auth_session=owner-session' },
  }));
  assert.equal(forbidden.status, 404);
});


test('a CLI bearer session can manage and delete only its own project', async () => {
  const db = new MemoryDatabase();
  await db.upsertProject({ ...demoProject, ownerUserId: 'owner' });
  db.users.set('owner', { id: 'owner', email: 'owner@example.com', name: 'Owner', avatarUrl: null });
  db.sessions.set(hashToken('cli-session'), { tokenHash: hashToken('cli-session'), userId: 'owner', projectId: 'nexuss-dashboard', expiresAt: new Date(Date.now() + 60_000) });
  const app = createAuthApp(config, db);
  const me = await app.fetch(new Request('https://auth.example.com/v1/me?project_id=nexuss-dashboard', { headers: { authorization: 'Bearer cli-session' } }));
  assert.equal(me.status, 200);
  assert.equal((await me.json()).user.id, 'owner');
  const removed = await app.fetch(new Request('https://auth.example.com/v1/projects/demo', { method: 'DELETE', headers: { authorization: 'Bearer cli-session' } }));
  assert.equal(removed.status, 204);
  assert.equal(await db.getProject('demo'), null);
});


test('a signed-in user can create, use, list, and revoke an API token without exposing its secret', async () => {
  const db = new MemoryDatabase();
  await db.upsertProject({ ...demoProject, ownerUserId: 'owner' });
  db.users.set('owner', { id: 'owner', email: 'owner@example.com', name: 'Owner', avatarUrl: null });
  db.sessions.set(hashToken('owner-session'), { tokenHash: hashToken('owner-session'), userId: 'owner', projectId: 'nexuss-dashboard', expiresAt: new Date(Date.now() + 60_000) });
  const app = createAuthApp(config, db);
  const create = await app.fetch(new Request('https://auth.example.com/v1/tokens', {
    method: 'POST',
    headers: { cookie: 'nex_auth_session=owner-session', 'x-nex-auth-project': 'nexuss-dashboard', 'content-type': 'application/json' },
    body: JSON.stringify({ label: 'Portfolio CLI' }),
  }));
  assert.equal(create.status, 201);
  const created = await create.json() as { token: string; tokenId: string };
  assert.match(created.token, /^nxa_/);
  const listed = await app.fetch(new Request('https://auth.example.com/v1/tokens', { headers: { cookie: 'nex_auth_session=owner-session', 'x-nex-auth-project': 'nexuss-dashboard' } }));
  assert.equal(listed.status, 200);
  const listPayload = await listed.json() as { tokens: Array<Record<string, unknown>> };
  assert.equal(listPayload.tokens[0]?.tokenId, created.tokenId);
  assert.equal('token' in listPayload.tokens[0]!, false);
  const projects = await app.fetch(new Request('https://auth.example.com/v1/projects', { headers: { authorization: `Bearer ${created.token}` } }));
  assert.equal(projects.status, 200);
  const revoked = await app.fetch(new Request(`https://auth.example.com/v1/tokens/${created.tokenId}`, { method: 'DELETE', headers: { cookie: 'nex_auth_session=owner-session', 'x-nex-auth-project': 'nexuss-dashboard' } }));
  assert.equal(revoked.status, 204);
  const rejected = await app.fetch(new Request('https://auth.example.com/v1/projects', { headers: { authorization: `Bearer ${created.token}` } }));
  assert.equal(rejected.status, 401);
});


test('an API token is restricted to its owner projects for list, inspect, create, update, and delete', async () => {
  const db = new MemoryDatabase();
  await db.upsertProject({ ...demoProject, ownerUserId: 'owner' });
  await db.upsertProject({ ...demoProject, projectId: 'other', name: 'Other', ownerUserId: 'other-user' });
  const ownerToken = 'nxa_owner-token';
  db.apiTokens.set('owner-token', {
    tokenId: 'owner-token',
    userId: 'owner',
    tokenHash: hashToken(ownerToken),
    tokenPrefix: ownerToken.slice(0, 12),
    label: 'Owner token',
    createdAt: new Date(),
    lastUsedAt: null,
    revokedAt: null,
  });
  const app = createAuthApp(config, db);

  const listed = await app.fetch(new Request('https://auth.example.com/v1/projects', {
    headers: { authorization: `Bearer ${ownerToken}` },
  }));
  assert.equal(listed.status, 200);
  assert.deepEqual((await listed.json()).projects.map((project: ProjectRecord) => project.projectId), ['demo']);

  const hidden = await app.fetch(new Request('https://auth.example.com/v1/projects/other', {
    headers: { authorization: `Bearer ${ownerToken}` },
  }));
  assert.equal(hidden.status, 404);

  const created = await app.fetch(new Request('https://auth.example.com/v1/projects', {
    method: 'POST',
    headers: { authorization: `Bearer ${ownerToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({ ...demoProject, projectId: 'created-by-token', name: 'Created by token' }),
  }));
  assert.equal(created.status, 201);
  assert.equal((await created.json()).ownerUserId, 'owner');

  const updated = await app.fetch(new Request('https://auth.example.com/v1/projects/other', {
    method: 'PATCH',
    headers: { authorization: `Bearer ${ownerToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Should not update' }),
  }));
  assert.equal(updated.status, 404);

  const deleted = await app.fetch(new Request('https://auth.example.com/v1/projects/other', {
    method: 'DELETE',
    headers: { authorization: `Bearer ${ownerToken}` },
  }));
  assert.equal(deleted.status, 404);
  assert.ok(await db.getProject('other'));
});

test('GitHub repository management is owner-scoped and requires delete confirmation', async () => {
  const db = new MemoryDatabase();
  await db.upsertProject(demoProject);
  db.users.set('u1', { id: 'u1', email: 'ada@example.com', name: 'Ada', avatarUrl: null });
  db.githubConnections.set('u1', { userId: 'u1', githubAccountId: '42', login: 'ada', accessToken: 'github-secret-token', refreshToken: null, expiresAt: null, scopes: ['repo'], updatedAt: new Date() });
  db.githubGrants.set(hashToken('grant-token'), { grantHash: hashToken('grant-token'), projectId: 'demo', userId: 'u1', expiresAt: new Date(Date.now() + 60_000) });
  const originalFetch = globalThis.fetch;
  const calls: Array<{ method: string; url: string; body: string }> = [];
  globalThis.fetch = async (input, init) => {
    calls.push({ method: init?.method || 'GET', url: String(input), body: typeof init?.body === 'string' ? init.body : '' });
    if (init?.method === 'POST') return new Response(JSON.stringify({ id: 8, name: 'new-repo', full_name: 'ada/new-repo', private: true, description: 'Created', html_url: 'https://github.com/ada/new-repo', default_branch: 'main' }), { status: 201, headers: { 'content-type': 'application/json' } });
    if (init?.method === 'PATCH') return new Response(JSON.stringify({ id: 8, name: 'renamed-repo', full_name: 'ada/renamed-repo', private: true, description: 'Created', html_url: 'https://github.com/ada/renamed-repo', default_branch: 'main' }), { status: 200, headers: { 'content-type': 'application/json' } });
    return new Response(null, { status: 204 });
  };
  try {
    const app = createAuthApp(config, db);
    const create = await app.fetch(new Request('https://auth.example.com/v1/github/repositories?project_id=demo', { method: 'POST', headers: { authorization: 'Bearer grant-token', 'content-type': 'application/json' }, body: JSON.stringify({ name: 'new-repo', private: true }) }));
    assert.equal(create.status, 201);
    assert.equal((await create.json()).full_name, 'ada/new-repo');
    const rename = await app.fetch(new Request('https://auth.example.com/v1/github/repositories/ada/new-repo?project_id=demo', { method: 'PATCH', headers: { authorization: 'Bearer grant-token', 'content-type': 'application/json' }, body: JSON.stringify({ name: 'renamed-repo' }) }));
    assert.equal(rename.status, 200);
    const missingConfirmation = await app.fetch(new Request('https://auth.example.com/v1/github/repositories/ada/renamed-repo?project_id=demo', { method: 'DELETE', headers: { authorization: 'Bearer grant-token', 'content-type': 'application/json' }, body: JSON.stringify({ confirmed: false }) }));
    assert.equal(missingConfirmation.status, 400);
    const remove = await app.fetch(new Request('https://auth.example.com/v1/github/repositories/ada/renamed-repo?project_id=demo', { method: 'DELETE', headers: { authorization: 'Bearer grant-token', 'content-type': 'application/json' }, body: JSON.stringify({ confirmed: true }) }));
    assert.equal(remove.status, 200);
    assert.deepEqual(await remove.json(), { deleted: true, fullName: 'ada/renamed-repo' });
    assert.equal(calls.length, 3);
    assert.ok(calls.every((call) => !call.body.includes('github-secret-token')));
  } finally {
    globalThis.fetch = originalFetch;
  }
});
