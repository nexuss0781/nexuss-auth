import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { authorizationUrl, exchangeCode } from './providers.js';
import { hashToken, jsonResponse, parseCookies, randomToken, serializeCookie, safeEqual } from './crypto.js';
import { randomUUID } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';
import type { Database, OAuthPurpose, ProjectStatus, Provider, ProjectRecord, ServerConfig, UserRecord } from './types.js';

const providers = new Set<Provider>(['google', 'github']);
const MAX_BODY_BYTES = 16 * 1024;

type RequestContext = { request: Request; origin: string | null };

function providerFrom(value: string | undefined): Provider | null {
  return value && providers.has(value as Provider) ? (value as Provider) : null;
}

function redirectWith(url: string, key: string, value: string): string {
  const target = new URL(url);
  target.searchParams.set(key, value);
  return target.toString();
}

function isLoopbackRedirect(redirectUri: string): boolean {
  try {
    const url = new URL(redirectUri);
    return url.protocol === 'http:' && (url.hostname === '127.0.0.1' || url.hostname === 'localhost');
  } catch {
    return false;
  }
}

function decodeWorkflowZip(bytes: Uint8Array): string {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); const chunks: string[] = [];
  for (let offset = 0; offset + 30 <= bytes.byteLength;) {
    if (view.getUint32(offset, true) !== 0x04034b50) break;
    const method = view.getUint16(offset + 8, true); const compressedSize = view.getUint32(offset + 18, true); const nameLength = view.getUint16(offset + 26, true); const extraLength = view.getUint16(offset + 28, true); const dataStart = offset + 30 + nameLength + extraLength; const dataEnd = dataStart + compressedSize;
    if (dataEnd > bytes.byteLength) break;
    const compressed = bytes.slice(dataStart, dataEnd); const decoded = method === 8 ? inflateRawSync(compressed) : compressed; chunks.push(new TextDecoder().decode(decoded)); offset = dataEnd;
  }
  return chunks.join("\n").slice(0, 500_000);
}

function isAllowedRedirect(project: ProjectRecord, redirectUri: string): boolean {
  try {
    const requested = new URL(redirectUri);
    if (project.projectId === 'nexuss-dashboard' && isLoopbackRedirect(redirectUri)) return true;
    return project.allowedRedirectUris.some((allowed) => {
      try {
        const candidate = new URL(allowed);
        return candidate.toString() === requested.toString();
      } catch {
        return false;
      }
    });
  } catch {
    return false;
  }
}

function validHttpUrl(value: string): boolean {
  try {
    return ['http:', 'https:'].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

function stringList(value: unknown): string[] | null {
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) return null;
  return [...new Set(value.map((item) => item.trim()).filter(Boolean))];
}

function providerList(value: unknown): Provider[] | null {
  const parsed = stringList(value);
  if (!parsed || parsed.some((provider) => !providers.has(provider as Provider))) return null;
  return parsed as Provider[];
}

function projectFromBody(body: Record<string, unknown>, existing?: ProjectRecord): ProjectRecord | null {
  const projectId = typeof body.projectId === 'string' ? body.projectId.trim() : existing?.projectId;
  const name = typeof body.name === 'string' ? body.name.trim() : existing?.name;
  const homepageUrl = typeof body.homepageUrl === 'string' ? body.homepageUrl.trim() : existing?.homepageUrl;
  const description = typeof body.description === 'string' ? body.description.trim() : existing?.description ?? '';
  const avatarUrl = body.avatarUrl === null ? null : typeof body.avatarUrl === 'string' ? body.avatarUrl.trim() || null : existing?.avatarUrl ?? null;
  const allowedRedirectUris = body.allowedRedirectUris === undefined ? existing?.allowedRedirectUris : stringList(body.allowedRedirectUris);
  const allowedOrigins = body.allowedOrigins === undefined ? existing?.allowedOrigins : stringList(body.allowedOrigins);
  const enabledProviders = body.enabledProviders === undefined ? existing?.enabledProviders ?? ['google', 'github'] : providerList(body.enabledProviders);
  const status = body.status === undefined ? existing?.status ?? 'active' : body.status === 'active' || body.status === 'disabled' ? body.status as ProjectStatus : null;
  if (!projectId || !/^[a-z0-9][a-z0-9-]{1,62}$/.test(projectId) || !name || !homepageUrl || !validHttpUrl(homepageUrl) || !allowedRedirectUris || allowedRedirectUris.length === 0 || !enabledProviders || !status) return null;
  if (allowedRedirectUris.some((uri) => !validHttpUrl(uri))) return null;
  const origins = allowedOrigins && allowedOrigins.length > 0 ? allowedOrigins : [...new Set(allowedRedirectUris.map((uri) => new URL(uri).origin))];
  if (origins.some((origin) => !validHttpUrl(origin) || new URL(origin).pathname !== '/')) return null;
  if (avatarUrl && !validHttpUrl(avatarUrl)) return null;
  return { ownerUserId: existing?.ownerUserId ?? null, projectId, name, homepageUrl, description, avatarUrl, allowedRedirectUris, allowedOrigins: origins, enabledProviders, status };
}

function callbackUri(config: ServerConfig): string {
  return `${config.publicUrl}/oauth/callback`;
}

function requestFromNode(request: IncomingMessage): RequestContext {
  const protocol = request.headers['x-forwarded-proto'] || 'http';
  const host = request.headers.host || 'localhost';
  const url = `${protocol}://${host}${request.url || '/'}`;
  const headers = new Headers();
  for (const [key, value] of Object.entries(request.headers)) {
    if (typeof value === 'string') headers.set(key, value);
    else if (Array.isArray(value)) headers.set(key, value.join(', '));
  }
  const init: RequestInit = { headers };
  if (request.method) init.method = request.method;
  return { request: new Request(url, init), origin: request.headers.origin ?? null };
}

async function readBody(request: IncomingMessage): Promise<string> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_BODY_BYTES) throw new Error('Request body is too large');
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function writeNodeResponse(response: ServerResponse, result: Response): void {
  response.statusCode = result.status;
  result.headers.forEach((value, key) => response.setHeader(key, value));
  if (result.body) {
    result.arrayBuffer().then((body) => response.end(Buffer.from(body))).catch(() => response.end());
  } else {
    response.end();
  }
}

function corsHeaders(origin: string | null, project: ProjectRecord | null): Record<string, string> {
  if (!origin || !project) return {};
  const allowed = project.allowedOrigins.includes(origin);
  return allowed
    ? { 'access-control-allow-origin': origin, 'access-control-allow-credentials': 'true', vary: 'Origin' }
    : {};
}

async function jsonBody(request: Request): Promise<Record<string, unknown>> {
  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) throw new Error('Request body is too large');
  const parsed: unknown = raw ? JSON.parse(raw) : {};
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('JSON object required');
  return parsed as Record<string, unknown>;
}

function adminAuthorized(request: Request, config: ServerConfig): boolean {
  const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  return Boolean(config.adminToken && token && safeEqual(token, config.adminToken));
}

function sessionTokenFromRequest(request: Request, config: ServerConfig): string | null {
  const bearer = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim();
  return bearer || parseCookies(request.headers.get('cookie') ?? undefined)[config.cookieName] || null;
}

type ManagementIdentity = { kind: 'admin' } | { kind: 'user'; userId: string } | { kind: 'token'; userId: string; tokenId: string };

type UserIdentity = { kind: 'user' | 'token'; userId: string; tokenId?: string };

function managedUserId(identity: ManagementIdentity): string | undefined {
  return identity.kind === 'admin' ? undefined : identity.userId;
}

async function managementIdentity(request: Request, config: ServerConfig, db: Database): Promise<ManagementIdentity | null> {
  if (adminAuthorized(request, config)) return { kind: 'admin' };
  const bearer = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim();
  const cookieToken = parseCookies(request.headers.get('cookie') ?? undefined)[config.cookieName];
  if (cookieToken) {
    const session = await db.getSession(hashToken(cookieToken));
    if (session) return { kind: 'user', userId: session.userId };
  }
  if (!bearer) return null;
  const session = await db.getSession(hashToken(bearer));
  if (session) return { kind: 'user', userId: session.userId };
  const apiToken = await db.getApiTokenByHash(hashToken(bearer));
  if (!apiToken) return null;
  await db.touchApiToken(apiToken.tokenId);
  return { kind: 'token', userId: apiToken.userId, tokenId: apiToken.tokenId };
}

async function userIdentity(request: Request, config: ServerConfig, db: Database): Promise<UserIdentity | null> {
  const identity = await managementIdentity(request, config, db);
  return identity && identity.kind !== 'admin' ? identity : null;
}

function systemDashboardProject(config: ServerConfig): ProjectRecord {
  return {
    projectId: 'nexuss-dashboard',
    ownerUserId: null,
    name: 'Nexuss-auth Control Plane',
    homepageUrl: config.publicUrl,
    description: 'User-facing project management for Nexuss-auth.',
    avatarUrl: null,
    allowedRedirectUris: [config.publicUrl, `${config.publicUrl}/dashboard`],
    allowedOrigins: [new URL(config.publicUrl).origin],
    enabledProviders: ['google', 'github'],
    status: 'active',
  };
}

export function createAuthApp(config: ServerConfig, db: Database): { fetch(request: Request): Promise<Response> } {
  return {
    async fetch(request: Request): Promise<Response> {
      const url = new URL(request.url);
      const projectId = request.headers.get('x-nex-auth-project') || url.searchParams.get('project_id');
      let project = projectId ? await db.getProject(projectId) : null;
      if (projectId === 'nexuss-dashboard') {
        // Keep the control-plane project aligned with the canonical deployment URL.
        project = await db.upsertProject(systemDashboardProject(config));
      }
      const headers = {
        ...corsHeaders(request.headers.get('origin'), project),
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
        'referrer-policy': 'no-referrer',
      };

      if (request.method === 'OPTIONS') {
        return new Response(null, {
          status: 204,
          headers: { ...headers, 'access-control-allow-methods': 'GET,POST,PATCH,OPTIONS', 'access-control-allow-headers': 'content-type,x-nex-auth-project,authorization', 'access-control-max-age': '86400' },
        });
      }

      try {
        if (url.pathname === '/health' && request.method === 'GET') {
          try {
            const projects = await db.listProjects();
            return jsonResponse({ ok: true, persistence: 'ready', projectCount: projects.length }, 200, headers);
          } catch (error) {
            console.error('Nexuss Auth persistence health check failed', error);
            return jsonResponse({ ok: false, error: 'persistence_unavailable' }, 503, headers);
          }
        }

        if (url.pathname.startsWith('/oauth/start/') && request.method === 'GET') {
          const provider = providerFrom(url.pathname.split('/').pop());
          if (!provider || !projectId || !project || project.status !== 'active' || !project.enabledProviders.includes(provider)) return jsonResponse({ error: 'invalid_project_or_provider' }, 400, headers);
          const redirectUri = url.searchParams.get('redirect_uri');
          if (!redirectUri || !isAllowedRedirect(project, redirectUri)) return jsonResponse({ error: 'redirect_uri_not_allowed' }, 400, headers);
          const purpose: OAuthPurpose = url.searchParams.get('purpose') === 'github_authorization' ? 'github_authorization' : 'sign_in';
          if (purpose === 'github_authorization' && (provider !== 'github' || url.searchParams.get('handoff') !== '1')) return jsonResponse({ error: 'invalid_authorization_purpose' }, 400, headers);
          let authorizationUserId: string | null = null;
          if (purpose === 'github_authorization') {
            const identity = await userIdentity(request, config, db);
            if (!identity) return jsonResponse({ error: 'central_sign_in_required', message: 'Sign in to Nexuss Auth first so GitHub authorization stays attached to your existing profile.' }, 401, headers);
            authorizationUserId = identity.userId;
          }
          const state = randomToken(32);
          try {
            await db.createOAuthState({
              stateHash: hashToken(state),
              projectId,
              provider,
              redirectUri,
              handoff: url.searchParams.get('handoff') === '1',
              purpose,
              userId: authorizationUserId,
              expiresAt: new Date(Date.now() + config.stateTtlSeconds * 1000),
            });
            return Response.redirect(authorizationUrl(config, provider, state, callbackUri(config), purpose), 302);
          } catch (error) {
            const errorId = randomUUID();
            console.error('OAuth start failed while preparing state', { errorId, provider, projectId, error });
            return jsonResponse({ error: 'oauth_state_persistence_failed', errorId, message: 'Nexuss Auth could not prepare this authorization. Redeploy the central auth service so its database migration can run, then try again.' }, 503, headers);
          }
        }

        if (url.pathname === '/oauth/callback' && request.method === 'GET') {
          const state = url.searchParams.get('state');
          const code = url.searchParams.get('code');
          const oauthError = url.searchParams.get('error');
          if (!state) return new Response('Invalid OAuth state', { status: 400 });
          const stateRecord = await db.consumeOAuthState(hashToken(state));
          if (!stateRecord || stateRecord.expiresAt.getTime() <= Date.now()) return new Response('Invalid or expired OAuth state', { status: 400 });
          if (oauthError || !code) return Response.redirect(redirectWith(stateRecord.redirectUri, 'nex_auth', 'denied'), 302);
          const profile = await exchangeCode(config, stateRecord.provider, code, callbackUri(config));
          if (!profile.providerAccountId) throw new Error('OAuth provider returned no account id');
          let user: UserRecord;
          if (stateRecord.purpose === 'github_authorization') {
            if (stateRecord.provider !== 'github' || !stateRecord.userId) throw new Error('GitHub authorization is not attached to an existing user');
            const existingUser = await db.getUser(stateRecord.userId);
            if (!existingUser) throw new Error('The existing Nexuss Auth profile could not be loaded');
            user = existingUser;
          } else {
            user = await db.findOrCreateUser(profile);
          }
          if (stateRecord.purpose === 'github_authorization' && stateRecord.provider === 'github' && profile.accessToken) {
            await db.saveGithubConnection({ userId: user.id, githubAccountId: profile.providerAccountId, login: profile.username || profile.name || profile.providerAccountId, accessToken: profile.accessToken, refreshToken: profile.refreshToken || null, expiresAt: profile.expiresInSeconds ? new Date(Date.now() + profile.expiresInSeconds * 1_000) : null, scopes: profile.scopes || [], updatedAt: new Date() });
          }
          const sessionToken = randomToken(32);
          await db.createSession({
            userId: user.id,
            projectId: stateRecord.projectId,
            tokenHash: hashToken(sessionToken),
            expiresAt: new Date(Date.now() + config.sessionTtlSeconds * 1000),
          });
          const secure = new URL(config.publicUrl).protocol === 'https:';
          const handoffToken = stateRecord.handoff ? randomToken(32) : null;
          const githubGrantToken = stateRecord.purpose === 'github_authorization' && stateRecord.provider === 'github' ? randomToken(32) : null;
          if (githubGrantToken) await db.createGithubGrant({ grantHash: hashToken(githubGrantToken), projectId: stateRecord.projectId, userId: user.id, expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1_000) });
          if (handoffToken) {
            await db.createHandoff({
              handoffHash: hashToken(handoffToken),
              projectId: stateRecord.projectId,
              userId: user.id,
              githubGrantToken,
              expiresAt: new Date(Date.now() + 120_000),
            });
          }
          let destination = isLoopbackRedirect(stateRecord.redirectUri)
            ? redirectWith(redirectWith(stateRecord.redirectUri, 'nex_auth', 'success'), 'session_token', sessionToken)
            : redirectWith(stateRecord.redirectUri, 'nex_auth', 'success');
          if (handoffToken) destination = redirectWith(destination, 'handoff_token', handoffToken);
          return new Response(null, {
            status: 302,
            headers: {
              location: destination,
              'set-cookie': serializeCookie(config.cookieName, sessionToken, { secure, maxAge: config.sessionTtlSeconds }),
              'referrer-policy': 'no-referrer',
            },
          });
        }

        if (url.pathname === '/v1/handoff/exchange' && request.method === 'POST') {
          const body = await jsonBody(request);
          const handoffToken = typeof body.handoffToken === 'string' ? body.handoffToken : '';
          const requestedProjectId = typeof body.projectId === 'string' ? body.projectId : '';
          if (!handoffToken || !requestedProjectId) return jsonResponse({ error: 'handoff_required' }, 400, headers);
          const handoff = await db.consumeHandoff(hashToken(handoffToken));
          if (!handoff || handoff.expiresAt.getTime() <= Date.now() || handoff.projectId !== requestedProjectId) return jsonResponse({ error: 'invalid_handoff' }, 401, headers);
          const user = await db.getUser(handoff.userId);
          if (!user) return jsonResponse({ error: 'user_not_found' }, 401, headers);
          return jsonResponse({ user, ...(handoff.githubGrantToken ? { githubGrantToken: handoff.githubGrantToken } : {}) }, 200, headers);
        }

        if ((url.pathname === '/v1/github/repositories' || url.pathname === '/v1/github/clone-token' || url.pathname === '/v1/github/branches' || url.pathname === '/v1/github/tree' || url.pathname === '/v1/github/pull-files' || url.pathname === '/v1/github/search' || url.pathname === '/v1/github/runs' || url.pathname === '/v1/github/jobs' || url.pathname === '/v1/github/job-logs' || url.pathname === '/v1/github/pulls' || url.pathname === '/v1/github/analytics' || url.pathname === '/v1/github/file') && request.method === 'GET') {
          const grantToken = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim();
          if (!grantToken || !projectId) return jsonResponse({ error: 'github_grant_required' }, 401, headers);
          const grant = await db.getGithubGrant(hashToken(grantToken));
          if (!grant || grant.projectId !== projectId || grant.expiresAt.getTime() <= Date.now()) return jsonResponse({ error: 'invalid_github_grant' }, 401, headers);
          const connection = await db.getGithubConnection(grant.userId);
          if (!connection || (connection.expiresAt && connection.expiresAt.getTime() <= Date.now())) return jsonResponse({ error: 'github_authorization_expired' }, 401, headers);
          if (url.pathname === '/v1/github/clone-token') return jsonResponse({ accessToken: connection.accessToken }, 200, { ...headers, 'cache-control': 'no-store' });
          if (url.pathname === '/v1/github/repositories') {
            const githubResponse = await fetch('https://api.github.com/user/repos?visibility=all&affiliation=owner,collaborator,organization_member&sort=updated&direction=desc&per_page=100', { headers: { accept: 'application/vnd.github+json', authorization: `Bearer ${connection.accessToken}`, 'X-GitHub-Api-Version': '2026-03-10', 'user-agent': 'Nexuss-Auth' } });
            if (!githubResponse.ok) return jsonResponse({ error: 'github_api_failed' }, githubResponse.status === 401 ? 401 : 502, headers);
            const repositories = await githubResponse.json();
            return jsonResponse({ login: connection.login, repositories }, 200, headers);
          }
          const owner = url.searchParams.get('owner')?.trim() || '';

          const repo = url.searchParams.get('repo')?.trim() || '';
          const ref = url.searchParams.get('ref')?.trim() || '';
          const path = url.searchParams.get('path')?.trim() || '';
          if (!/^[A-Za-z0-9_.-]{1,100}$/.test(owner) || !/^[A-Za-z0-9_.-]{1,100}$/.test(repo) || (ref && (ref.length > 200 || /[\u0000-\u001f]/.test(ref)))) return jsonResponse({ error: 'invalid_repository_reference' }, 400, headers);
          if (url.pathname === '/v1/github/branches') {
            const branchesUrl = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/branches?per_page=100`;
            const githubResponse = await fetch(branchesUrl, { headers: { accept: 'application/vnd.github+json', authorization: `Bearer ${connection.accessToken}`, 'X-GitHub-Api-Version': '2026-03-10', 'user-agent': 'Nexuss-Auth' } });
            if (!githubResponse.ok) return jsonResponse({ error: githubResponse.status === 404 ? 'repository_not_found' : githubResponse.status === 401 ? 'github_authorization_expired' : 'github_api_failed' }, githubResponse.status === 401 ? 401 : githubResponse.status === 404 ? 404 : 502, headers);
            const body = await githubResponse.json() as Array<{ name?: string; protected?: boolean }>;
            const branches = Array.isArray(body) ? body.slice(0, 100).filter((branch) => typeof branch.name === 'string' && /^[A-Za-z0-9._/-]{1,200}$/.test(branch.name) && !branch.name.startsWith('/') && !branch.name.endsWith('/') && !branch.name.includes('..') && !branch.name.includes('@{')).map((branch) => ({ name: branch.name as string, protected: Boolean(branch.protected) })) : [];
            return jsonResponse({ owner, repo, branches }, 200, headers);
          }
          if (url.pathname === '/v1/github/analytics') {
            const headersForGithub = { accept: 'application/vnd.github+json', authorization: `Bearer ${connection.accessToken}`, 'X-GitHub-Api-Version': '2026-03-10', 'user-agent': 'Nexuss-Auth' };
            const base = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
            const responses = await Promise.all([fetch(base, { headers: headersForGithub }), fetch(`${base}/commits?per_page=30`, { headers: headersForGithub }), fetch(`${base}/pulls?state=all&sort=updated&direction=desc&per_page=30`, { headers: headersForGithub }), fetch(`${base}/contributors?per_page=20`, { headers: headersForGithub }), fetch(`${base}/actions/runs?per_page=30`, { headers: headersForGithub })]);
            if (responses.some((response) => !response.ok)) return jsonResponse({ error: responses.some((response) => response.status === 401) ? 'github_authorization_expired' : 'github_api_failed' }, responses.some((response) => response.status === 401) ? 401 : 502, headers);
            const [repositoryBody, commitsBody, pullsBody, contributorsBody, runsBody] = await Promise.all(responses.map((response) => response.json()));
            const commits = Array.isArray(commitsBody) ? commitsBody.slice(0, 30).map((commit: { sha?: string; commit?: { message?: string; author?: { name?: string; date?: string } }; author?: { login?: string; avatar_url?: string } }) => ({ sha: commit.sha || null, message: ((commit.commit?.message || '').split('\\n')[0] || '').slice(0, 180), author: commit.author?.login || commit.commit?.author?.name || 'Unknown', avatarUrl: commit.author?.avatar_url || null, date: commit.commit?.author?.date || null })) : [];
            const pulls = Array.isArray(pullsBody) ? pullsBody.slice(0, 30).map((pull: { number?: number; state?: string; merged_at?: string | null; draft?: boolean }) => ({ number: pull.number || 0, state: pull.state || 'unknown', merged: Boolean(pull.merged_at), draft: Boolean(pull.draft) })) : [];
            const contributors = Array.isArray(contributorsBody) ? contributorsBody.slice(0, 20).map((contributor: { login?: string; contributions?: number; avatar_url?: string }) => ({ login: contributor.login || 'Unknown', contributions: contributor.contributions || 0, avatarUrl: contributor.avatar_url || null })) : [];
            const runs = Array.isArray((runsBody as { workflow_runs?: unknown[] }).workflow_runs) ? ((runsBody as { workflow_runs: Array<{ conclusion?: string | null; status?: string }> }).workflow_runs).slice(0, 30) : [];
            const successfulRuns = runs.filter((run) => run.conclusion === 'success').length; const completedRuns = runs.filter((run) => run.status === 'completed').length;
            return jsonResponse({ owner, repo, repository: { stars: typeof (repositoryBody as { stargazers_count?: number }).stargazers_count === 'number' ? (repositoryBody as { stargazers_count: number }).stargazers_count : 0, forks: typeof (repositoryBody as { forks_count?: number }).forks_count === 'number' ? (repositoryBody as { forks_count: number }).forks_count : 0, openIssues: typeof (repositoryBody as { open_issues_count?: number }).open_issues_count === 'number' ? (repositoryBody as { open_issues_count: number }).open_issues_count : 0, language: (repositoryBody as { language?: string | null }).language || null, pushedAt: (repositoryBody as { pushed_at?: string | null }).pushed_at || null }, commits, pulls, contributors, workflow: { total: runs.length, successful: successfulRuns, completed: completedRuns, successRate: completedRuns ? Math.round((successfulRuns / completedRuns) * 100) : null } }, 200, headers);
          }
          if (url.pathname === '/v1/github/runs') {
            const runsUrl = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/actions/runs?per_page=30`;
            const githubResponse = await fetch(runsUrl, { headers: { accept: 'application/vnd.github+json', authorization: `Bearer ${connection.accessToken}`, 'X-GitHub-Api-Version': '2026-03-10', 'user-agent': 'Nexuss-Auth' } });
            if (!githubResponse.ok) return jsonResponse({ error: githubResponse.status === 401 ? 'github_authorization_expired' : 'github_api_failed' }, githubResponse.status === 401 ? 401 : 502, headers);
            const body = await githubResponse.json() as { workflow_runs?: Array<{ id?: number; name?: string; display_title?: string; status?: string; conclusion?: string | null; event?: string; html_url?: string; created_at?: string; updated_at?: string; run_started_at?: string; head_branch?: string; head_sha?: string; run_number?: number; workflow_id?: number }> };
            const runs = Array.isArray(body.workflow_runs) ? body.workflow_runs.slice(0, 30).filter((run) => typeof run.id === 'number').map((run) => ({ id: run.id, name: run.name || 'Workflow', title: run.display_title || run.name || 'Workflow run', status: run.status || 'unknown', conclusion: run.conclusion || null, event: run.event || 'unknown', htmlUrl: run.html_url || null, createdAt: run.created_at || null, updatedAt: run.updated_at || null, startedAt: run.run_started_at || null, branch: run.head_branch || null, sha: run.head_sha || null, runNumber: run.run_number || null, workflowId: run.workflow_id || null })) : [];
            return jsonResponse({ owner, repo, runs }, 200, headers);
          }
          if (url.pathname === '/v1/github/jobs') {
            const runId = Number(url.searchParams.get('run_id') || '0');
            if (!Number.isInteger(runId) || runId < 1) return jsonResponse({ error: 'invalid_run_id' }, 400, headers);
            const jobsUrl = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/actions/runs/${runId}/jobs?per_page=100`;
            const githubResponse = await fetch(jobsUrl, { headers: { accept: 'application/vnd.github+json', authorization: `Bearer ${connection.accessToken}`, 'X-GitHub-Api-Version': '2026-03-10', 'user-agent': 'Nexuss-Auth' } });
            if (!githubResponse.ok) return jsonResponse({ error: githubResponse.status === 404 ? 'run_not_found' : githubResponse.status === 401 ? 'github_authorization_expired' : 'github_api_failed' }, githubResponse.status === 401 ? 401 : 502, headers);
            const body = await githubResponse.json() as { jobs?: Array<{ id?: number; name?: string; status?: string; conclusion?: string | null; started_at?: string | null; completed_at?: string | null; html_url?: string; steps?: Array<{ name?: string; status?: string; conclusion?: string | null; number?: number }> }> };
            const jobs = Array.isArray(body.jobs) ? body.jobs.slice(0, 100).filter((job) => typeof job.id === 'number').map((job) => ({ id: job.id, name: job.name || 'Job', status: job.status || 'unknown', conclusion: job.conclusion || null, startedAt: job.started_at || null, completedAt: job.completed_at || null, htmlUrl: job.html_url || null, steps: Array.isArray(job.steps) ? job.steps.slice(0, 100).map((step) => ({ name: step.name || 'Step', status: step.status || 'unknown', conclusion: step.conclusion || null, number: step.number || null })) : [] })) : [];
            return jsonResponse({ owner, repo, runId, jobs }, 200, headers);
          }
          if (url.pathname === '/v1/github/job-logs') {
            const jobId = Number(url.searchParams.get('job_id') || '0');
            if (!Number.isInteger(jobId) || jobId < 1) return jsonResponse({ error: 'invalid_job_id' }, 400, headers);
            const logsUrl = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/actions/jobs/${jobId}/logs`;
            const githubResponse = await fetch(logsUrl, { headers: { accept: 'application/vnd.github+json', authorization: `Bearer ${connection.accessToken}`, 'X-GitHub-Api-Version': '2026-03-10', 'user-agent': 'Nexuss-Auth' } });
            if (!githubResponse.ok) return jsonResponse({ error: githubResponse.status === 404 ? 'job_logs_not_found' : githubResponse.status === 401 ? 'github_authorization_expired' : 'github_api_failed' }, githubResponse.status === 401 ? 401 : 502, headers);
            const logs = decodeWorkflowZip(new Uint8Array(await githubResponse.arrayBuffer()));
            return jsonResponse({ owner, repo, jobId, logs, truncated: logs.length >= 500_000 }, 200, headers);
          }
          if (url.pathname === '/v1/github/pulls') {
            const state = url.searchParams.get('state') === 'closed' ? 'closed' : 'open';
            const pullsUrl = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls?state=${state}&sort=updated&direction=desc&per_page=50`;
            const githubResponse = await fetch(pullsUrl, { headers: { accept: 'application/vnd.github+json', authorization: `Bearer ${connection.accessToken}`, 'X-GitHub-Api-Version': '2026-03-10', 'user-agent': 'Nexuss-Auth' } });
            if (!githubResponse.ok) return jsonResponse({ error: githubResponse.status === 401 ? 'github_authorization_expired' : 'github_api_failed' }, githubResponse.status === 401 ? 401 : 502, headers);
            const body = await githubResponse.json() as Array<{ number?: number; title?: string; state?: string; draft?: boolean; user?: { login?: string }; html_url?: string; created_at?: string; updated_at?: string; head?: { ref?: string; sha?: string }; base?: { ref?: string } }>;
            const pulls = Array.isArray(body) ? body.slice(0, 50).filter((pull) => typeof pull.number === 'number').map((pull) => ({ number: pull.number, title: pull.title || `Pull request #${pull.number}`, state: pull.state === 'closed' ? 'closed' : 'open', draft: Boolean(pull.draft), author: pull.user?.login || 'unknown', htmlUrl: pull.html_url || null, createdAt: pull.created_at || null, updatedAt: pull.updated_at || null, headRef: pull.head?.ref || null, headSha: pull.head?.sha || null, baseRef: pull.base?.ref || null })) : [];
            return jsonResponse({ owner, repo, state, pulls }, 200, headers);
          }
          if (url.pathname === '/v1/github/pull-files') {
            const number = Number(url.searchParams.get('number') || '0');
            if (!Number.isInteger(number) || number < 1 || number > 1_000_000) return jsonResponse({ error: 'invalid_pull_number' }, 400, headers);
            const filesUrl = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls/${number}/files?per_page=100`;
            const githubResponse = await fetch(filesUrl, { headers: { accept: 'application/vnd.github+json', authorization: `Bearer ${connection.accessToken}`, 'X-GitHub-Api-Version': '2026-03-10', 'user-agent': 'Nexuss-Auth' } });
            if (!githubResponse.ok) return jsonResponse({ error: githubResponse.status === 404 ? 'pull_not_found' : githubResponse.status === 401 ? 'github_authorization_expired' : 'github_api_failed' }, githubResponse.status === 401 ? 401 : 502, headers);
            const body = await githubResponse.json() as Array<{ filename?: string; status?: string; additions?: number; deletions?: number; changes?: number; patch?: string; sha?: string; blob_url?: string; raw_url?: string }>;
            const files = Array.isArray(body) ? body.slice(0, 100).filter((file) => typeof file.filename === 'string').map((file) => ({ filename: file.filename, status: file.status || 'modified', additions: typeof file.additions === 'number' ? file.additions : 0, deletions: typeof file.deletions === 'number' ? file.deletions : 0, changes: typeof file.changes === 'number' ? file.changes : 0, patch: typeof file.patch === 'string' ? file.patch.slice(0, 100_000) : null, sha: file.sha || null, blobUrl: file.blob_url || null, rawUrl: file.raw_url || null })) : [];
            return jsonResponse({ owner, repo, number, files }, 200, headers);
          }
          if (url.pathname === '/v1/github/search') {
            const query = url.searchParams.get('q')?.trim() || '';
            if (!query || query.length > 200 || /[\u0000-\u001f]/.test(query)) return jsonResponse({ error: 'invalid_search_query' }, 400, headers);
            const searchUrl = `https://api.github.com/search/code?q=${encodeURIComponent(`${query} repo:${owner}/${repo}`)}&per_page=50`;
            const githubResponse = await fetch(searchUrl, { headers: { accept: 'application/vnd.github+json', authorization: `Bearer ${connection.accessToken}`, 'X-GitHub-Api-Version': '2026-03-10', 'user-agent': 'Nexuss-Auth' } });
            if (!githubResponse.ok) return jsonResponse({ error: githubResponse.status === 401 ? 'github_authorization_expired' : 'github_api_failed' }, githubResponse.status === 401 ? 401 : 502, headers);
            const body = await githubResponse.json() as { total_count?: number; incomplete_results?: boolean; items?: Array<{ path?: string; name?: string; sha?: string; html_url?: string; score?: number }> };
            const results = Array.isArray(body.items) ? body.items.slice(0, 50).filter((item) => typeof item.path === 'string').map((item) => ({ path: item.path, name: item.name || item.path?.split('/').pop() || item.path, sha: item.sha || '', htmlUrl: item.html_url || null, score: typeof item.score === 'number' ? item.score : null })) : [];
            return jsonResponse({ owner, repo, query, totalCount: typeof body.total_count === 'number' ? body.total_count : results.length, incompleteResults: Boolean(body.incomplete_results), results }, 200, headers);
          }
          if (url.pathname === '/v1/github/tree') {
            const treeUrl = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/trees/${encodeURIComponent(ref || 'HEAD')}?recursive=1`;
            const githubResponse = await fetch(treeUrl, { headers: { accept: 'application/vnd.github+json', authorization: `Bearer ${connection.accessToken}`, 'X-GitHub-Api-Version': '2026-03-10', 'user-agent': 'Nexuss-Auth' } });
            if (!githubResponse.ok) return jsonResponse({ error: githubResponse.status === 404 ? 'repository_tree_not_found' : 'github_api_failed' }, githubResponse.status === 401 ? 401 : 502, headers);
            const body = await githubResponse.json() as { sha?: string; truncated?: boolean; tree?: Array<{ path?: string; mode?: string; type?: string; sha?: string; size?: number; url?: string }> };
            const tree = Array.isArray(body.tree) ? body.tree.slice(0, 5000).filter((entry) => typeof entry.path === 'string' && (entry.type === 'blob' || entry.type === 'tree')).map((entry) => ({ path: entry.path, type: entry.type, sha: entry.sha || '', size: typeof entry.size === 'number' ? entry.size : null })) : [];
            return jsonResponse({ owner, repo, ref: ref || 'HEAD', sha: body.sha || null, truncated: Boolean(body.truncated) || (Array.isArray(body.tree) && body.tree.length > 5000), tree }, 200, headers);
          }
          if (!path || path.length > 500 || path.startsWith('/') || path.split('/').some((segment) => !segment || segment === '.' || segment === '..')) return jsonResponse({ error: 'invalid_file_path' }, 400, headers);
          const fileUrl = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${path.split('/').map(encodeURIComponent).join('/')}?ref=${encodeURIComponent(ref || 'HEAD')}`;
          const githubResponse = await fetch(fileUrl, { headers: { accept: 'application/vnd.github+json', authorization: `Bearer ${connection.accessToken}`, 'X-GitHub-Api-Version': '2026-03-10', 'user-agent': 'Nexuss-Auth' } });
          if (!githubResponse.ok) return jsonResponse({ error: githubResponse.status === 404 ? 'file_not_found' : 'github_api_failed' }, githubResponse.status === 401 ? 401 : 502, headers);
          const body = await githubResponse.json() as { name?: string; path?: string; sha?: string; size?: number; encoding?: string; content?: string; type?: string; html_url?: string };
          const size = typeof body.size === 'number' ? body.size : 0;
          if (body.type !== 'file') return jsonResponse({ error: 'not_a_file' }, 400, headers);
          if (size > 512_000) return jsonResponse({ error: 'file_too_large', size, maxBytes: 512_000 }, 413, headers);
          if (body.encoding !== 'base64' || typeof body.content !== 'string') return jsonResponse({ error: 'unsupported_file_encoding' }, 400, headers);
          const binary = atob(body.content.replace(/\s/g, ''));
          const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
          const content = new TextDecoder().decode(bytes);
          return jsonResponse({ owner, repo, ref: ref || 'HEAD', path: body.path || path, name: body.name || path.split('/').pop(), sha: body.sha || null, size, content, htmlUrl: body.html_url || null }, 200, headers);
        }

        if (url.pathname === '/v1/github/comment' && request.method === 'POST') {
          const grantToken = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim();
          if (!grantToken || !projectId) return jsonResponse({ error: 'github_grant_required' }, 401, headers);
          const grant = await db.getGithubGrant(hashToken(grantToken));
          if (!grant || grant.projectId !== projectId || grant.expiresAt.getTime() <= Date.now()) return jsonResponse({ error: 'invalid_github_grant' }, 401, headers);
          const connection = await db.getGithubConnection(grant.userId);
          if (!connection) return jsonResponse({ error: 'github_not_connected' }, 409, headers);
          const owner = url.searchParams.get('owner')?.trim() || '';
          const repo = url.searchParams.get('repo')?.trim() || '';
          const number = Number(url.searchParams.get('number') || '0');
          if (!/^[A-Za-z0-9_.-]{1,100}$/.test(owner) || !/^[A-Za-z0-9_.-]{1,100}$/.test(repo) || !Number.isInteger(number) || number < 1 || number > 1_000_000) return jsonResponse({ error: 'invalid_pull_reference' }, 400, headers);
          const body = await jsonBody(request);
          const comment = typeof body.body === 'string' ? body.body.trim() : '';
          if (!comment || comment.length > 10_000) return jsonResponse({ error: 'invalid_comment_body' }, 400, headers);
          const githubResponse = await fetch(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues/${number}/comments`, { method: 'POST', headers: { accept: 'application/vnd.github+json', authorization: `Bearer ${connection.accessToken}`, 'X-GitHub-Api-Version': '2026-03-10', 'content-type': 'application/json', 'user-agent': 'Nexuss-Auth' }, body: JSON.stringify({ body: comment }) });
          if (!githubResponse.ok) return jsonResponse({ error: githubResponse.status === 401 ? 'github_authorization_expired' : 'github_comment_failed' }, githubResponse.status === 401 ? 401 : 502, headers);
          const result = await githubResponse.json() as { id?: number; html_url?: string; body?: string; created_at?: string };
          return jsonResponse({ owner, repo, number, id: result.id || null, htmlUrl: result.html_url || null, body: result.body || comment, createdAt: result.created_at || null }, 201, headers);
        }

        if (url.pathname === '/v1/me' && request.method === 'GET') {
          if (!projectId || !project) return jsonResponse({ error: 'project_required' }, 400, headers);
          const identity = await userIdentity(request, config, db);
          if (!identity) return jsonResponse({ user: null }, 200, headers);
          const user = await db.getUser(identity.userId);
          return jsonResponse({ user }, 200, headers);
        }

        if (url.pathname === '/v1/tokens' && request.method === 'GET') {
          const identity = await userIdentity(request, config, db);
          if (!identity || identity.kind !== 'user') return jsonResponse({ error: 'session_required' }, 401, headers);
          const tokens = await db.listApiTokens(identity.userId);
          return jsonResponse({ tokens: tokens.map((token) => ({ tokenId: token.tokenId, tokenPrefix: token.tokenPrefix, label: token.label, createdAt: token.createdAt.toISOString(), lastUsedAt: token.lastUsedAt?.toISOString() ?? null, revokedAt: token.revokedAt?.toISOString() ?? null })) }, 200, headers);
        }

        if (url.pathname === '/v1/tokens' && request.method === 'POST') {
          const identity = await userIdentity(request, config, db);
          if (!identity || identity.kind !== 'user') return jsonResponse({ error: 'session_required' }, 401, headers);
          const body = await jsonBody(request);
          const label = typeof body.label === 'string' && body.label.trim() ? body.label.trim().slice(0, 80) : 'CLI token';
          const rawToken = `nxa_${randomToken(32)}`;
          const record = { tokenId: randomUUID(), userId: identity.userId, tokenHash: hashToken(rawToken), tokenPrefix: rawToken.slice(0, 12), label, createdAt: new Date(), lastUsedAt: null, revokedAt: null };
          await db.createApiToken(record);
          return jsonResponse({ token: rawToken, tokenId: record.tokenId, tokenPrefix: record.tokenPrefix, label: record.label, createdAt: record.createdAt.toISOString(), warning: 'Copy this token now. It will not be shown again.' }, 201, headers);
        }

        const tokenRoute = url.pathname.match(/^\/v1\/tokens\/([a-f0-9-]{16,64})$/);
        if (tokenRoute && request.method === 'DELETE') {
          const identity = await userIdentity(request, config, db);
          if (!identity || identity.kind !== 'user') return jsonResponse({ error: 'session_required' }, 401, headers);
          const tokenId = tokenRoute[1];
          if (!tokenId) return jsonResponse({ error: 'token_not_found' }, 404, headers);
          const revoked = await db.revokeApiToken(identity.userId, tokenId);
          return revoked ? new Response(null, { status: 204, headers }) : jsonResponse({ error: 'token_not_found' }, 404, headers);
        }

        if (url.pathname === '/v1/logout' && request.method === 'POST') {
          const sessionToken = sessionTokenFromRequest(request, config);
          if (sessionToken) await db.deleteSession(hashToken(sessionToken));
          const secure = new URL(config.publicUrl).protocol === 'https:';
          return new Response(null, {
            status: 204,
            headers: { ...headers, 'set-cookie': serializeCookie(config.cookieName, '', { secure, maxAge: 0 }) },
          });
        }

        if (url.pathname === '/v1/projects' && request.method === 'GET') {
          const identity = await managementIdentity(request, config, db);
          if (!identity) return jsonResponse({ error: 'unauthorized' }, 401, headers);
          return jsonResponse({ projects: await db.listProjects(managedUserId(identity)) }, 200, headers);
        }

        if (url.pathname === '/v1/projects' && request.method === 'POST') {
          const identity = await managementIdentity(request, config, db);
          if (!identity) return jsonResponse({ error: 'unauthorized' }, 401, headers);
          const body = await jsonBody(request);
          const nextProject = projectFromBody(body);
          if (!nextProject) return jsonResponse({ error: 'invalid_project_configuration' }, 400, headers);
          const existing = await db.getProject(nextProject.projectId);
          if (existing && (identity.kind !== 'admin' && existing.ownerUserId !== identity.userId)) return jsonResponse({ error: 'project_id_unavailable' }, 409, headers);
          const ownedProject = { ...nextProject, ownerUserId: identity.kind === 'admin' ? existing?.ownerUserId ?? null : identity.userId };
          return jsonResponse(await db.upsertProject(ownedProject), 201, headers);
        }

        const projectRoute = url.pathname.match(/^\/v1\/projects\/([a-z0-9-]{1,63})$/);
        if (projectRoute && request.method === 'GET') {
          const identity = await managementIdentity(request, config, db);
          if (!identity) return jsonResponse({ error: 'unauthorized' }, 401, headers);
          const managedProjectId = projectRoute[1];
          if (!managedProjectId) return jsonResponse({ error: 'project_not_found' }, 404, headers);
          const managedProject = await db.getProject(managedProjectId);
          if (!managedProject || (identity.kind !== 'admin' && managedProject.ownerUserId !== identity.userId)) return jsonResponse({ error: 'project_not_found' }, 404, headers);
          return jsonResponse(managedProject, 200, headers);
        }

        if (projectRoute && request.method === 'DELETE') {
          const identity = await managementIdentity(request, config, db);
          if (!identity) return jsonResponse({ error: 'unauthorized' }, 401, headers);
          const managedProjectId = projectRoute[1];
          if (!managedProjectId) return jsonResponse({ error: 'project_not_found' }, 404, headers);
          const existing = await db.getProject(managedProjectId);
          if (!existing || (identity.kind !== 'admin' && existing.ownerUserId !== identity.userId)) return jsonResponse({ error: 'project_not_found' }, 404, headers);
          await db.deleteProject(managedProjectId);
          return new Response(null, { status: 204, headers });
        }

        if (projectRoute && request.method === 'PATCH') {
          const identity = await managementIdentity(request, config, db);
          if (!identity) return jsonResponse({ error: 'unauthorized' }, 401, headers);
          const managedProjectId = projectRoute[1];
          if (!managedProjectId) return jsonResponse({ error: 'project_not_found' }, 404, headers);
          const existing = await db.getProject(managedProjectId);
          if (!existing || (identity.kind !== 'admin' && existing.ownerUserId !== identity.userId)) return jsonResponse({ error: 'project_not_found' }, 404, headers);
          const nextProject = projectFromBody(await jsonBody(request), existing);
          if (!nextProject || nextProject.projectId !== existing.projectId) return jsonResponse({ error: 'invalid_project_configuration' }, 400, headers);
          return jsonResponse(await db.upsertProject({ ...nextProject, ownerUserId: existing.ownerUserId }), 200, headers);
        }

        return jsonResponse({ error: 'not_found' }, 404, headers);
      } catch (error) {
        const errorId = randomUUID();
        console.error('Nexuss Auth request failed', { errorId, path: url.pathname, error });
        return jsonResponse({ error: 'internal_error', errorId, message: 'Nexuss Auth could not complete this request. Use the error ID when checking the deployment logs.' }, 500, headers);
      }
    },
  };
}

export function startAuthServer(config: ServerConfig, db: Database): ReturnType<typeof createServer> {
  const app = createAuthApp(config, db);
  const server = createServer((request, response) => {
    const context = requestFromNode(request);
    app.fetch(context.request).then((result) => writeNodeResponse(response, result)).catch((error) => {
      console.error(error);
      response.statusCode = 500;
      response.end('Internal Server Error');
    });
  });
  server.listen(config.port);
  return server;
}
