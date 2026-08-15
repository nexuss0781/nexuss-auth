export type Provider = 'google' | 'github';

export interface NexAuthUser {
  id: string;
  email: string | null;
  name: string | null;
  avatarUrl: string | null;
}

export interface NexAuthConfig {
  projectId: string;
  authUrl: string;
  fetch?: typeof fetch;
}

export interface SignInOptions {
  redirectUri?: string;
}

export interface UserResponse {
  user: NexAuthUser | null;
}

export function buildLoginUrl(config: Pick<NexAuthConfig, 'projectId' | 'authUrl'>, provider: Provider, redirectUri: string): string {
  if (!config.projectId.trim()) throw new Error('Nex-auth projectId is required');
  if (!['google', 'github'].includes(provider)) throw new Error(`Unsupported provider: ${provider}`);
  const url = new URL(`/oauth/start/${provider}`, config.authUrl);
  url.searchParams.set('project_id', config.projectId);
  url.searchParams.set('redirect_uri', redirectUri);
  return url.toString();
}

function browserLocation(): Location | null {
  return typeof window === 'undefined' ? null : window.location;
}

export class NexAuthClient {
  private readonly config: NexAuthConfig;
  private readonly fetcher: typeof fetch;

  constructor(config: NexAuthConfig) {
    if (!config.projectId.trim()) throw new Error('Nex-auth projectId is required');
    const authUrl = new URL(config.authUrl);
    if (!['http:', 'https:'].includes(authUrl.protocol)) throw new Error('Nex-auth authUrl must use HTTP or HTTPS');
    this.config = { projectId: config.projectId, authUrl: authUrl.toString().replace(/\/$/, '') };
    this.fetcher = config.fetch ?? fetch;
  }

  getLoginUrl(provider: Provider, options: SignInOptions = {}): string {
    const redirectUri = options.redirectUri ?? browserLocation()?.href;
    if (!redirectUri) throw new Error('redirectUri is required outside a browser');
    return buildLoginUrl(this.config, provider, redirectUri);
  }

  signIn(provider: Provider, options: SignInOptions = {}): void {
    const location = browserLocation();
    if (!location) throw new Error('signIn can only be called in a browser');
    location.assign(this.getLoginUrl(provider, options));
  }

  signInWithGoogle(options: SignInOptions = {}): void {
    this.signIn('google', options);
  }

  signInWithGitHub(options: SignInOptions = {}): void {
    this.signIn('github', options);
  }

  async getUser(): Promise<NexAuthUser | null> {
    const url = new URL('/v1/me', this.config.authUrl);
    url.searchParams.set('project_id', this.config.projectId);
    const response = await this.fetcher(url, {
      headers: { 'x-nex-auth-project': this.config.projectId },
      credentials: 'include',
    });
    if (response.status === 401) return null;
    if (!response.ok) throw new Error(`Nex-auth user request failed with status ${response.status}`);
    const payload = (await response.json()) as UserResponse;
    return payload.user ?? null;
  }

  async logout(): Promise<void> {
    const url = new URL('/v1/logout', this.config.authUrl);
    const response = await this.fetcher(url, {
      method: 'POST',
      headers: { 'x-nex-auth-project': this.config.projectId },
      credentials: 'include',
    });
    if (!response.ok && response.status !== 204) throw new Error(`Nex-auth logout failed with status ${response.status}`);
  }
}

export function createAuth(config: NexAuthConfig): NexAuthClient {
  return new NexAuthClient(config);
}
