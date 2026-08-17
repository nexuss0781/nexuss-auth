import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { authorizationUrl, exchangeCode } from './providers.js';
import { hashToken, jsonResponse, parseCookies, randomToken, serializeCookie, safeEqual } from './crypto.js';
import { randomUUID } from 'node:crypto';
import type { Database, ProjectStatus, Provider, ProjectRecord, ServerConfig } from './types.js';

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
        if (url.pathname === '/health' && request.method === 'GET') return jsonResponse({ ok: true }, 200, headers);

        if (url.pathname.startsWith('/oauth/start/') && request.method === 'GET') {
          const provider = providerFrom(url.pathname.split('/').pop());
          if (!provider || !projectId || !project || project.status !== 'active' || !project.enabledProviders.includes(provider)) return jsonResponse({ error: 'invalid_project_or_provider' }, 400, headers);
          const redirectUri = url.searchParams.get('redirect_uri');
          if (!redirectUri || !isAllowedRedirect(project, redirectUri)) return jsonResponse({ error: 'redirect_uri_not_allowed' }, 400, headers);
          const state = randomToken(32);
          await db.createOAuthState({
            stateHash: hashToken(state),
            projectId,
            provider,
            redirectUri,
            handoff: url.searchParams.get('handoff') === '1',
            expiresAt: new Date(Date.now() + config.stateTtlSeconds * 1000),
          });
          return Response.redirect(authorizationUrl(config, provider, state, callbackUri(config)), 302);
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
          const user = await db.findOrCreateUser(profile);
          const sessionToken = randomToken(32);
          await db.createSession({
            userId: user.id,
            projectId: stateRecord.projectId,
            tokenHash: hashToken(sessionToken),
            expiresAt: new Date(Date.now() + config.sessionTtlSeconds * 1000),
          });
          const secure = new URL(config.publicUrl).protocol === 'https:';
          const handoffToken = stateRecord.handoff ? randomToken(32) : null;
          if (handoffToken) {
            await db.createHandoff({
              handoffHash: hashToken(handoffToken),
              projectId: stateRecord.projectId,
              userId: user.id,
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
          return jsonResponse({ user }, 200, headers);
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
        console.error(error);
        return jsonResponse({ error: 'internal_error' }, 500, headers);
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
