import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { OAuthProfile, Provider, ServerConfig } from './types.js';

export function providerClient(config: ServerConfig, provider: Provider): { clientId: string; clientSecret: string } {
  if (provider === 'google') return { clientId: config.googleClientId, clientSecret: config.googleClientSecret };
  if (provider === 'github') return { clientId: config.githubClientId, clientSecret: config.githubClientSecret };
  return { clientId: config.envxOidcClientId || '', clientSecret: config.envxOidcClientSecret || '' };
}

function configuredIssuer(config: ServerConfig): URL {
  if (!config.envxOidcIssuerUrl) throw new Error('ENVX OIDC configuration is missing');
  const issuer = new URL(config.envxOidcIssuerUrl);
  if (issuer.protocol !== 'https:' || issuer.username || issuer.password || issuer.search || issuer.hash) throw new Error('ENVX OIDC issuer must be a clean HTTPS URL');
  return issuer;
}

async function fetchJson(url: string, timeoutMs: number, init: RequestInit = {}): Promise<Record<string, unknown>> {
  let response: Response;
  try { response = await fetch(url, { ...init, redirect: 'error', signal: init.signal ?? AbortSignal.timeout(timeoutMs) }); }
  catch (error) { if (error instanceof DOMException && error.name === 'TimeoutError') throw new Error(`OAuth provider request timed out after ${timeoutMs}ms`); throw error; }
  const payload = await response.json().catch(() => null) as unknown;
  if (!response.ok || typeof payload !== 'object' || payload === null) throw new Error(`OAuth provider request failed with status ${response.status}`);
  return payload as Record<string, unknown>;
}
function stringOrNull(value: unknown): string | null { return typeof value === 'string' && value.length > 0 ? value : null; }
function booleanValue(value: unknown): boolean { return value === true; }
function trustedEndpoint(value: unknown, issuer: URL, field: string): string {
  const endpoint = stringOrNull(value); if (!endpoint) throw new Error(`Envx OIDC discovery is missing ${field}`);
  const parsed = new URL(endpoint);
  if (parsed.protocol !== 'https:' || parsed.origin !== issuer.origin || parsed.username || parsed.password || parsed.hash) throw new Error(`Envx OIDC ${field} is not a trusted endpoint`);
  return parsed.toString();
}
async function discover(config: ServerConfig): Promise<{ issuer: URL; authorizationEndpoint: string; tokenEndpoint: string; jwksUri: string }> {
  const issuer = configuredIssuer(config);
  const issuerPath = issuer.pathname.replace(/\/+$/, '');
  const discoveryUrl = new URL(`${issuerPath}/.well-known/openid-configuration`, issuer.origin);
  const discovery = await fetchJson(discoveryUrl.toString(), config.oauthRequestTimeoutMs);
  const discoveredIssuer = stringOrNull(discovery.issuer);
  let normalizedDiscoveredIssuer = '';
  try { normalizedDiscoveredIssuer = discoveredIssuer ? new URL(discoveredIssuer).toString() : ''; } catch { /* Reject malformed issuer metadata below. */ }
  if (!normalizedDiscoveredIssuer || normalizedDiscoveredIssuer !== issuer.toString()) throw new Error('Envx OIDC discovery issuer does not match configured issuer');
  return { issuer, authorizationEndpoint: trustedEndpoint(discovery.authorization_endpoint, issuer, 'authorization_endpoint'), tokenEndpoint: trustedEndpoint(discovery.token_endpoint, issuer, 'token_endpoint'), jwksUri: trustedEndpoint(discovery.jwks_uri, issuer, 'jwks_uri') };
}

export function authorizationUrl(config: ServerConfig, provider: 'google' | 'github', state: string, redirectUri: string, purpose?: 'sign_in' | 'github_authorization'): string;
export function authorizationUrl(config: ServerConfig, provider: 'envx', state: string, redirectUri: string, purpose?: 'sign_in' | 'github_authorization', pkce?: { codeChallenge: string; nonce: string }): Promise<string>;
export function authorizationUrl(config: ServerConfig, provider: Provider, state: string, redirectUri: string, purpose: 'sign_in' | 'github_authorization' = 'sign_in', pkce?: { codeChallenge: string; nonce: string }): string | Promise<string> {
  if (provider === 'envx') {
    if (!pkce) throw new Error('Envx PKCE parameters are required');
    return discover(config).then((metadata) => buildAuthorizationUrl(new URL(metadata.authorizationEndpoint), config, provider, state, redirectUri, purpose, pkce));
  }
  const url = provider === 'google' ? new URL('https://accounts.google.com/o/oauth2/v2/auth') : new URL('https://github.com/login/oauth/authorize');
  return buildAuthorizationUrl(url, config, provider, state, redirectUri, purpose);
}

function buildAuthorizationUrl(url: URL, config: ServerConfig, provider: Provider, state: string, redirectUri: string, purpose: 'sign_in' | 'github_authorization', pkce?: { codeChallenge: string; nonce: string }): string {
  const credentials = providerClient(config, provider);
  url.searchParams.set('client_id', credentials.clientId); url.searchParams.set('redirect_uri', redirectUri); url.searchParams.set('response_type', 'code'); url.searchParams.set('state', state);
  url.searchParams.set('scope', provider === 'github' ? (purpose === 'github_authorization' ? 'repo delete_repo' : 'read:user user:email') : 'openid email profile');
  if (provider === 'google') { url.searchParams.set('access_type', 'online'); url.searchParams.set('prompt', 'select_account'); }
  if (provider === 'envx') { url.searchParams.set('code_challenge', pkce!.codeChallenge); url.searchParams.set('code_challenge_method', 'S256'); url.searchParams.set('nonce', pkce!.nonce); }
  return url.toString();
}

async function exchangeEnvx(config: ServerConfig, code: string, redirectUri: string, verifier: string, nonce: string): Promise<OAuthProfile> {
  const discovery = await discover(config);
  const clientId = config.envxOidcClientId?.trim() || '';
  const clientSecret = config.envxOidcClientSecret?.trim() || '';
  if (!clientId || !clientSecret) throw new Error('ENVX OIDC client credentials are missing');
  const tokenPayload = await fetchJson(discovery.tokenEndpoint, config.oauthRequestTimeoutMs, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, grant_type: 'authorization_code', code_verifier: verifier }) });
  const idToken = stringOrNull(tokenPayload.id_token); if (!idToken) throw new Error('Envx did not return an ID token');
  let verified;
  try {
    verified = await jwtVerify(idToken, createRemoteJWKSet(new URL(discovery.jwksUri)), { issuer: discovery.issuer.toString(), audience: clientId });
  } catch {
    throw new Error('Envx ID token signature or claims are invalid');
  }
  const claims = verified.payload; const sub = stringOrNull(claims.sub); if (!sub) throw new Error('Envx ID token has no subject');
  const now = Math.floor(Date.now() / 1000);
  if (typeof claims.exp !== 'number' || !Number.isFinite(claims.exp) || claims.exp <= now || typeof claims.iat !== 'number' || !Number.isFinite(claims.iat) || claims.iat > now + 60) throw new Error('Envx ID token has invalid time claims');
  if (Array.isArray(claims.aud) && claims.aud.length > 1 && claims.azp !== clientId) throw new Error('Envx ID token authorized party mismatch');
  if (claims.nonce !== nonce) throw new Error('Envx ID token nonce mismatch');
  if (claims.email_verified !== true) throw new Error('Envx email is not verified');
  const email = stringOrNull(claims.email);
  if (!email) throw new Error('Envx ID token has no email');
  return { provider: 'envx', providerAccountId: `${discovery.issuer.toString()}|${sub}`, issuer: discovery.issuer.toString(), subject: sub, permissions: [], email, emailVerified: true, name: stringOrNull(claims.name) ?? stringOrNull(claims.preferred_username), avatarUrl: stringOrNull(claims.picture), username: stringOrNull(claims.preferred_username), refreshToken: stringOrNull(tokenPayload.refresh_token), expiresInSeconds: typeof tokenPayload.expires_in === 'number' ? tokenPayload.expires_in : null };
}

export async function exchangeCode(config: ServerConfig, provider: Provider, code: string, redirectUri: string, envx?: { codeVerifier: string; nonce: string }): Promise<OAuthProfile> {
  if (provider === 'envx') { if (!envx?.codeVerifier || !envx.nonce) throw new Error('Envx PKCE verifier is required'); return exchangeEnvx(config, code, redirectUri, envx.codeVerifier, envx.nonce); }
  const credentials = providerClient(config, provider);
  if (provider === 'google') {
    const tokenPayload = await fetchJson('https://oauth2.googleapis.com/token', config.oauthRequestTimeoutMs, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ code, client_id: credentials.clientId, client_secret: credentials.clientSecret, redirect_uri: redirectUri, grant_type: 'authorization_code' }) });
    const accessToken = stringOrNull(tokenPayload.access_token); if (!accessToken) throw new Error('Google did not return an access token');
    const profile = await fetchJson('https://openidconnect.googleapis.com/v1/userinfo', config.oauthRequestTimeoutMs, { headers: { authorization: `Bearer ${accessToken}` } });
    return { provider, providerAccountId: String(profile.sub ?? ''), email: stringOrNull(profile.email), emailVerified: booleanValue(profile.email_verified), name: stringOrNull(profile.name), avatarUrl: stringOrNull(profile.picture), username: null };
  }
  const tokenPayload = await fetchJson('https://github.com/login/oauth/access_token', config.oauthRequestTimeoutMs, { method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/json' }, body: JSON.stringify({ client_id: credentials.clientId, client_secret: credentials.clientSecret, code, redirect_uri: redirectUri }) });
  const accessToken = stringOrNull(tokenPayload.access_token); if (!accessToken) throw new Error('GitHub did not return an access token');
  const headers = { authorization: `Bearer ${accessToken}`, accept: 'application/vnd.github+json' }; const profile = await fetchJson('https://api.github.com/user', config.oauthRequestTimeoutMs, { headers }); let email = stringOrNull(profile.email); let emailVerified = false;
  return { provider, providerAccountId: String(profile.id ?? ''), accessToken, refreshToken: stringOrNull(tokenPayload.refresh_token), expiresInSeconds: typeof tokenPayload.expires_in === 'number' ? tokenPayload.expires_in : null, scopes: typeof tokenPayload.scope === 'string' ? tokenPayload.scope.split(/[,\s]+/).filter(Boolean) : [], email, emailVerified, name: stringOrNull(profile.name) ?? stringOrNull(profile.login), avatarUrl: stringOrNull(profile.avatar_url), username: stringOrNull(profile.login) };
}
