import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createAuthApp } from '../packages/server/src/server.js';
import { ParadoxDatabase } from '../packages/server/src/paradox-db.js';
import type { ServerConfig } from '../packages/server/src/types.js';

// Vercel's sandbox home directory is not guaranteed to exist. Parad uses
// PARADOX_HOME for sync metadata, so keep that ephemeral runtime state in /tmp.
if (!process.env.PARADOX_HOME) process.env.PARADOX_HOME = '/tmp/nexuss-auth-paradox';

let app: ReturnType<typeof createAuthApp> | undefined;

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function config(): ServerConfig {
  const publicUrl = process.env.NEX_AUTH_PUBLIC_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : '');
  if (!publicUrl) throw new Error('NEX_AUTH_PUBLIC_URL or VERCEL_URL is required');
  return {
    port: 0,
    databaseUrl: 'paradox-db',
    publicUrl: publicUrl.replace(/\/$/, ''),
    sessionTtlSeconds: Number(process.env.NEX_AUTH_SESSION_TTL_SECONDS || 60 * 60 * 24 * 30),
    stateTtlSeconds: Number(process.env.NEX_AUTH_STATE_TTL_SECONDS || 10 * 60),
    cookieName: process.env.NEX_AUTH_COOKIE_NAME || 'nex_auth_session',
    adminToken: required('NEX_AUTH_ADMIN_TOKEN'),
    googleClientId: process.env.GOOGLE_CLIENT_ID || '',
    googleClientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
    githubClientId: process.env.GITHUB_CLIENT_ID || '',
    githubClientSecret: process.env.GITHUB_CLIENT_SECRET || '',
    oauthRequestTimeoutMs: Number(process.env.NEX_AUTH_OAUTH_REQUEST_TIMEOUT_MS || 15_000),
  };
}

function getApp(): ReturnType<typeof createAuthApp> {
  if (!app) app = createAuthApp(config(), new ParadoxDatabase({
    gatewayUrl: required('PARADOX_GATEWAY_URL'),
    apiKey: required('PARADOX_API_KEY'),
    passphrase: required('PARADOX_PASSPHRASE'),
    project: process.env.PARADOX_PROJECT || process.env.PARADOX_PROJECT_NAME || 'nexuss-auth',
    name: process.env.PARADOX_DATABASE || process.env.PARADOX_DATABASE_NAME || 'nexuss-auth',
  }));
  return app;
}

export default async function handler(request: VercelRequest, response: VercelResponse): Promise<void> {
  try {
    const protocol = (request.headers['x-forwarded-proto'] as string | undefined) || 'https';
    const host = request.headers.host || process.env.VERCEL_URL || 'localhost';
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(request.query)) {
      if (Array.isArray(value)) value.forEach((item) => query.append(key, item));
      else if (value !== undefined) query.set(key, value);
    }
    const url = `${protocol}://${host}${request.url?.split('?')[0] || '/'}${query.size ? `?${query.toString()}` : ''}`;
    const headers = new Headers();
    for (const [key, value] of Object.entries(request.headers)) {
      if (typeof value === 'string') headers.set(key, value);
      else if (Array.isArray(value)) headers.set(key, value.join(', '));
    }
    const init: RequestInit = { method: request.method, headers };
    if (request.body !== undefined && request.body !== null && request.method !== 'GET' && request.method !== 'HEAD') {
      init.body = typeof request.body === 'string' ? request.body : JSON.stringify(request.body);
    }
    const result = await getApp().fetch(new Request(url, init));
    response.status(result.status);
    result.headers.forEach((value, key) => response.setHeader(key, value));
    const body = await result.arrayBuffer();
    response.send(Buffer.from(body));
  } catch (error) {
    console.error(error);
    response.status(500).json({ error: 'internal_error' });
  }
}
