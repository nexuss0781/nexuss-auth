import type { VercelRequest, VercelResponse } from '@vercel/node';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { GatewayClient, generateUrl } from 'parad';
import { createAuthApp } from '../packages/server/src/server.js';
import { createParadoxDatabaseFromEnv, initializeParadoxSnapshotFromUrl } from '../packages/server/src/paradox-db.js';
import type { ServerConfig } from '../packages/server/src/types.js';

// Vercel's sandbox home directory is not guaranteed to exist. Parad uses
// PARADOX_HOME for sync metadata, so keep that ephemeral runtime state in /tmp.
if (!process.env.PARADOX_HOME) process.env.PARADOX_HOME = '/tmp/nexuss-auth-paradox';

let app: ReturnType<typeof createAuthApp> | undefined;
const paradoxBootstrapPath = '/__internal/paradox-bootstrap';
let paradoxBootstrapInProgress = false;
let paradoxBootstrapUsed = false;

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

type GatewayResource = { id: string; name: string };

async function listParadoxInventory(gateway: GatewayClient) {
  const projects = await gateway.listProjects() as GatewayResource[];
  const inventory: Array<{ projectId: string; projectName: string; databases: Array<{ databaseId: string; databaseName: string }> }> = [];
  for (const project of projects) {
    const databases = await gateway.listDatabases(project.id) as GatewayResource[];
    inventory.push({
      projectId: project.id,
      projectName: project.name,
      databases: databases.map((database) => ({ databaseId: database.id, databaseName: database.name })),
    });
  }
  return inventory;
}

function suppliedBootstrapToken(request: VercelRequest): string | undefined {
  const header = request.headers['x-paradox-bootstrap-token'];
  return Array.isArray(header) ? header[0] : header;
}

function matchesBootstrapToken(supplied: string | undefined, expected: string | undefined): boolean {
  if (!supplied || !expected) return false;
  const suppliedBytes = Buffer.from(supplied);
  const expectedBytes = Buffer.from(expected);
  return suppliedBytes.length === expectedBytes.length && timingSafeEqual(suppliedBytes, expectedBytes);
}

function requestPayload(request: VercelRequest): Record<string, unknown> {
  if (typeof request.body === 'string') return JSON.parse(request.body) as Record<string, unknown>;
  return request.body && typeof request.body === 'object' ? request.body as Record<string, unknown> : {};
}

function wasmerApiUrl(): string {
  const configured = new URL(required('PARADOX_GATEWAY_URL'));
  if (configured.origin !== 'https://paradox-db.wasmer.app') throw new Error('Unexpected Paradox gateway');
  return `${configured.origin}/v1`;
}

function upstreamStatus(error: unknown): number | undefined {
  if (!error || typeof error !== 'object' || !('statusCode' in error)) return undefined;
  const value = (error as { statusCode?: unknown }).statusCode;
  return typeof value === 'number' ? value : undefined;
}

function isValidDatabaseName(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z0-9][a-z0-9-]{1,62}$/.test(value);
}

async function handleParadoxBootstrap(request: VercelRequest, response: VercelResponse): Promise<void> {
  response.setHeader('Cache-Control', 'no-store, private');
  response.setHeader('X-Content-Type-Options', 'nosniff');

  if (request.method !== 'POST') {
    response.status(405).json({ error: 'method_not_allowed' });
    return;
  }
  if (!matchesBootstrapToken(suppliedBootstrapToken(request), process.env.PARADOX_BOOTSTRAP_TOKEN)) {
    response.status(404).json({ error: 'not_found' });
    return;
  }

  let payload: Record<string, unknown>;
  try {
    payload = requestPayload(request);
  } catch {
    response.status(400).json({ error: 'invalid_request' });
    return;
  }
  const action = payload.action;
  if (action !== 'preflight' && action !== 'provision') {
    response.status(400).json({ error: 'invalid_action' });
    return;
  }
  if (action === 'provision') {
    if (paradoxBootstrapInProgress || paradoxBootstrapUsed) {
      response.status(410).json({ error: 'bootstrap_already_used' });
      return;
    }
    paradoxBootstrapInProgress = true;
  }

  try {
    const gatewayUrl = wasmerApiUrl();
    const apiKey = required('PARADOX_API_KEY');
    const gateway = new GatewayClient(gatewayUrl, apiKey);
    await gateway.authMe();
    const inventory = await listParadoxInventory(gateway);

    if (action === 'preflight') {
      response.status(200).json({ authenticated: true, gateway: 'wasmer', projects: inventory });
      return;
    }

    const projectName = payload.projectName;
    const databaseName = payload.databaseName;
    if (!isValidDatabaseName(projectName) || !isValidDatabaseName(databaseName)) {
      response.status(400).json({ error: 'invalid_target_name' });
      return;
    }
    const existingProject = inventory.find((project) => project.projectName === projectName);
    if (existingProject) {
      response.status(409).json({ error: 'target_project_exists', projectId: existingProject.projectId });
      return;
    }
    const existingDatabase = inventory.flatMap((project) => project.databases)
      .find((database) => database.databaseName === databaseName);
    if (existingDatabase) {
      response.status(409).json({ error: 'target_database_name_exists' });
      return;
    }

    const project = await gateway.createProject(projectName, 'Nexuss Auth production persistence');
    const newProjectDatabases = await gateway.listDatabases(project.id) as GatewayResource[];
    if (newProjectDatabases.some((database) => database.name === databaseName)) {
      response.status(409).json({ error: 'target_database_name_exists' });
      return;
    }
    const database = await gateway.createDatabase(project.id, databaseName, 'Nexuss Auth production database');
    const passphrase = randomBytes(32).toString('base64url');
    const databaseUrl = generateUrl(databaseName, passphrase, gatewayUrl, projectName, apiKey);
    const version = await initializeParadoxSnapshotFromUrl(databaseUrl);
    if (!version) throw new Error('Initial snapshot was not uploaded');
    const snapshot = await gateway.download('', undefined, database.id, project.id);
    if (!snapshot.bytes.byteLength) throw new Error('Initial snapshot is empty');

    paradoxBootstrapUsed = true;
    response.status(201).json({
      project: { id: project.id, name: project.name },
      database: { id: database.id, name: database.name },
      initialVersion: version,
      databaseUrl,
    });
  } catch (error) {
    const status = upstreamStatus(error);
    response.status(status === 401 ? 401 : status === 403 ? 403 : 502).json({
      error: status === 401 || status === 403 ? 'paradox_authentication_failed' : 'paradox_bootstrap_failed',
      upstreamStatus: status ?? null,
    });
  } finally {
    if (action === 'provision') paradoxBootstrapInProgress = false;
  }
}

function config(): ServerConfig {
  const publicUrl = process.env.NEX_AUTH_PUBLIC_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : '');
  if (!publicUrl) throw new Error('NEX_AUTH_PUBLIC_URL or VERCEL_URL is required');
  return {
    port: 0,
    databaseUrl: required('DATABASE_URL'),
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
  if (!app) app = createAuthApp(config(), createParadoxDatabaseFromEnv());
  return app;
}

export default async function handler(request: VercelRequest, response: VercelResponse): Promise<void> {
  try {
    const path = request.url?.split('?')[0] || '/';
    if (path === paradoxBootstrapPath) {
      await handleParadoxBootstrap(request, response);
      return;
    }
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
