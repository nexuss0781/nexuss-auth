import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { authorizationUrl, exchangeCode } from './providers.js';
import { hashToken, jsonResponse, parseCookies, randomToken, serializeCookie, safeEqual } from './crypto.js';
import type { Database, Provider, ProjectRecord, ServerConfig } from './types.js';

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

function isAllowedRedirect(project: ProjectRecord, redirectUri: string): boolean {
  try {
    const requested = new URL(redirectUri);
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
  const allowed = project.allowedRedirectUris.some((redirectUri) => {
    try {
      return new URL(redirectUri).origin === origin;
    } catch {
      return false;
    }
  });
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

export function createAuthApp(config: ServerConfig, db: Database): { fetch(request: Request): Promise<Response> } {
  return {
    async fetch(request: Request): Promise<Response> {
      const url = new URL(request.url);
      const projectId = request.headers.get('x-nex-auth-project') || url.searchParams.get('project_id');
      const project = projectId ? await db.getProject(projectId) : null;
      const headers = {
        ...corsHeaders(request.headers.get('origin'), project),
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
        'referrer-policy': 'no-referrer',
      };

      if (request.method === 'OPTIONS') {
        return new Response(null, {
          status: 204,
          headers: { ...headers, 'access-control-allow-methods': 'GET,POST,OPTIONS', 'access-control-allow-headers': 'content-type,x-nex-auth-project', 'access-control-max-age': '86400' },
        });
      }

      try {
        if (url.pathname === '/health' && request.method === 'GET') return jsonResponse({ ok: true }, 200, headers);

        if (url.pathname.startsWith('/oauth/start/') && request.method === 'GET') {
          const provider = providerFrom(url.pathname.split('/').pop());
          if (!provider || !projectId || !project) return jsonResponse({ error: 'invalid_project_or_provider' }, 400, headers);
          const redirectUri = url.searchParams.get('redirect_uri');
          if (!redirectUri || !isAllowedRedirect(project, redirectUri)) return jsonResponse({ error: 'redirect_uri_not_allowed' }, 400, headers);
          const state = randomToken(32);
          await db.createOAuthState({
            stateHash: hashToken(state),
            projectId,
            provider,
            redirectUri,
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
          return new Response(null, {
            status: 302,
            headers: {
              location: redirectWith(stateRecord.redirectUri, 'nex_auth', 'success'),
              'set-cookie': serializeCookie(config.cookieName, sessionToken, { secure, maxAge: config.sessionTtlSeconds }),
              'referrer-policy': 'no-referrer',
            },
          });
        }

        if (url.pathname === '/v1/me' && request.method === 'GET') {
          if (!projectId || !project) return jsonResponse({ error: 'project_required' }, 400, headers);
          const sessionToken = parseCookies(request.headers.get('cookie') ?? undefined)[config.cookieName];
          if (!sessionToken) return jsonResponse({ user: null }, 200, headers);
          const session = await db.getSession(hashToken(sessionToken));
          if (!session || session.projectId !== projectId) return jsonResponse({ user: null }, 200, headers);
          const user = await db.getUser(session.userId);
          return jsonResponse({ user }, 200, headers);
        }

        if (url.pathname === '/v1/logout' && request.method === 'POST') {
          const sessionToken = parseCookies(request.headers.get('cookie') ?? undefined)[config.cookieName];
          if (sessionToken) await db.deleteSession(hashToken(sessionToken));
          const secure = new URL(config.publicUrl).protocol === 'https:';
          return new Response(null, {
            status: 204,
            headers: { ...headers, 'set-cookie': serializeCookie(config.cookieName, '', { secure, maxAge: 0 }) },
          });
        }

        if (url.pathname === '/v1/projects' && request.method === 'POST') {
          if (!adminAuthorized(request, config)) return jsonResponse({ error: 'unauthorized' }, 401, headers);
          const body = await jsonBody(request);
          const nextProject: ProjectRecord = {
            projectId: typeof body.projectId === 'string' ? body.projectId : '',
            name: typeof body.name === 'string' ? body.name : '',
            allowedRedirectUris: Array.isArray(body.allowedRedirectUris) ? body.allowedRedirectUris.filter((value): value is string => typeof value === 'string') : [],
          };
          if (!nextProject.projectId || !nextProject.name || nextProject.allowedRedirectUris.length === 0) {
            return jsonResponse({ error: 'project_id_name_and_redirect_uri_required' }, 400, headers);
          }
          for (const redirectUri of nextProject.allowedRedirectUris) {
            const parsed = new URL(redirectUri);
            if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Redirect URIs must use HTTP or HTTPS');
          }
          return jsonResponse(await db.upsertProject(nextProject), 201, headers);
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
