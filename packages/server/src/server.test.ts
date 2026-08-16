import test from 'node:test';
import assert from 'node:assert/strict';
import { hashToken } from './crypto.js';
import { createAuthApp } from './server.js';
import type { Database, OAuthProfile, OAuthStateRecord, ProjectRecord, SessionRecord, UserRecord } from './types.js';

class MemoryDatabase implements Database {
  projects = new Map<string, ProjectRecord>();
  states = new Map<string, OAuthStateRecord>();
  users = new Map<string, UserRecord>();
  sessions = new Map<string, SessionRecord>();
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
