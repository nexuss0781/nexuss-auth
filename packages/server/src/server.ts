import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { authorizationUrl, exchangeCode } from './providers.js';
import { hashToken, jsonResponse, parseCookies, randomToken, serializeCookie, safeEqual } from './crypto.js';
import { randomUUID } from 'node:crypto';
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

        if ((url.pathname === '/v1/github/repositories' || url.pathname === '/v1/github/clone-token' || url.pathname === '/v1/github/tree' || url.pathname === '/v1/github/file') && request.method === 'GET') {
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
