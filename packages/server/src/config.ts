import type { ServerConfig } from './types.js';

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function positiveInteger(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

export function loadConfig(): ServerConfig {
  const publicUrl = required('NEX_AUTH_PUBLIC_URL').replace(/\/$/, '');
  const url = new URL(publicUrl);
  if (url.protocol !== 'https:' && process.env.NODE_ENV === 'production') {
    throw new Error('NEX_AUTH_PUBLIC_URL must use HTTPS in production');
  }

  const adminToken = process.env.NEX_AUTH_ADMIN_TOKEN;
  if (process.env.NODE_ENV === 'production' && !adminToken) {
    throw new Error('NEX_AUTH_ADMIN_TOKEN is required in production');
  }

  return {
    port: positiveInteger('PORT', 8787),
    databaseUrl: required('DATABASE_URL'),
    publicUrl,
    sessionTtlSeconds: positiveInteger('NEX_AUTH_SESSION_TTL_SECONDS', 60 * 60 * 24 * 30),
    stateTtlSeconds: positiveInteger('NEX_AUTH_STATE_TTL_SECONDS', 10 * 60),
    cookieName: process.env.NEX_AUTH_COOKIE_NAME || 'nex_auth_session',
    adminToken,
    googleClientId: required('GOOGLE_CLIENT_ID'),
    googleClientSecret: required('GOOGLE_CLIENT_SECRET'),
    githubClientId: required('GITHUB_CLIENT_ID'),
    githubClientSecret: required('GITHUB_CLIENT_SECRET'),
  };
}
