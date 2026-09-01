import type { OAuthProfile, Provider, ServerConfig } from './types.js';

export function providerClient(config: ServerConfig, provider: Provider): { clientId: string; clientSecret: string } {
  return provider === 'google'
    ? { clientId: config.googleClientId, clientSecret: config.googleClientSecret }
    : { clientId: config.githubClientId, clientSecret: config.githubClientSecret };
}

export function authorizationUrl(
  config: ServerConfig,
  provider: Provider,
  state: string,
  redirectUri: string,
  purpose: 'sign_in' | 'github_authorization' = 'sign_in',
): string {
  if (provider === 'google') {
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.searchParams.set('client_id', config.googleClientId);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', 'openid email profile');
    url.searchParams.set('state', state);
    url.searchParams.set('access_type', 'online');
    url.searchParams.set('prompt', 'select_account');
    return url.toString();
  }

  const url = new URL('https://github.com/login/oauth/authorize');
  url.searchParams.set('client_id', config.githubClientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('scope', purpose === 'github_authorization' ? 'repo delete_repo' : 'read:user user:email');
  url.searchParams.set('state', state);
  return url.toString();
}

async function fetchJson(url: string, timeoutMs: number, init: RequestInit = {}): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    response = await fetch(url, { ...init, signal: init.signal ?? AbortSignal.timeout(timeoutMs) });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'TimeoutError') {
      throw new Error(`OAuth provider request timed out after ${timeoutMs}ms`);
    }
    throw error;
  }
  const payload = (await response.json()) as unknown;
  if (!response.ok || typeof payload !== 'object' || payload === null) {
    throw new Error(`OAuth provider request failed with status ${response.status}`);
  }
  return payload as Record<string, unknown>;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function booleanValue(value: unknown): boolean {
  return value === true;
}

export async function exchangeCode(
  config: ServerConfig,
  provider: Provider,
  code: string,
  redirectUri: string,
): Promise<OAuthProfile> {
  const credentials = providerClient(config, provider);
  if (provider === 'google') {
    const tokenPayload = await fetchJson('https://oauth2.googleapis.com/token', config.oauthRequestTimeoutMs, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: credentials.clientId,
        client_secret: credentials.clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    });
    const accessToken = stringOrNull(tokenPayload.access_token);
    if (!accessToken) throw new Error('Google did not return an access token');
    const profile = await fetchJson('https://openidconnect.googleapis.com/v1/userinfo', config.oauthRequestTimeoutMs, {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    const email = stringOrNull(profile.email);
    return {
      provider,
      providerAccountId: String(profile.sub ?? ''),
      email,
      emailVerified: booleanValue(profile.email_verified),
      name: stringOrNull(profile.name),
      avatarUrl: stringOrNull(profile.picture),
      username: null,
    };
  }

  const tokenPayload = await fetchJson('https://github.com/login/oauth/access_token', config.oauthRequestTimeoutMs, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify({
      client_id: credentials.clientId,
      client_secret: credentials.clientSecret,
      code,
      redirect_uri: redirectUri,
    }),
  });
  const accessToken = stringOrNull(tokenPayload.access_token);
  if (!accessToken) throw new Error('GitHub did not return an access token');
  const headers = { authorization: `Bearer ${accessToken}`, accept: 'application/vnd.github+json' };
  const profile = await fetchJson('https://api.github.com/user', config.oauthRequestTimeoutMs, { headers });
  let email = stringOrNull(profile.email);
  let emailVerified = false;
  if (!email) {
    const emailsResponse = await fetch('https://api.github.com/user/emails', { headers, signal: AbortSignal.timeout(config.oauthRequestTimeoutMs) });
    if (emailsResponse.ok) {
      const emails = (await emailsResponse.json()) as unknown;
      if (Array.isArray(emails)) {
        const preferred = emails.find((item) => typeof item === 'object' && item !== null && (item as { primary?: unknown }).primary === true)
          ?? emails.find((item) => typeof item === 'object' && item !== null && (item as { verified?: unknown }).verified === true);
        if (preferred && typeof preferred === 'object') {
          email = stringOrNull((preferred as { email?: unknown }).email);
          emailVerified = booleanValue((preferred as { verified?: unknown }).verified);
        }
      }
    }
  }
  return {
    provider,
    providerAccountId: String(profile.id ?? ''),
    accessToken,
    refreshToken: stringOrNull(tokenPayload.refresh_token),
    expiresInSeconds: typeof tokenPayload.expires_in === 'number' ? tokenPayload.expires_in : null,
    scopes: typeof tokenPayload.scope === 'string' ? tokenPayload.scope.split(/[,\s]+/).filter(Boolean) : [],
    email,
    emailVerified,
    name: stringOrNull(profile.name) ?? stringOrNull(profile.login),
    avatarUrl: stringOrNull(profile.avatar_url),
    username: stringOrNull(profile.login),
  };
}
