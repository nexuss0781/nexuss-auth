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

export type ProjectStatus = 'active' | 'disabled';

export interface NexAuthProject {
  projectId: string;
  name: string;
  homepageUrl: string;
  description: string;
  avatarUrl: string | null;
  allowedRedirectUris: string[];
  allowedOrigins: string[];
  enabledProviders: Provider[];
  status: ProjectStatus;
}

export type CreateProjectInput = NexAuthProject;
export type UpdateProjectInput = Partial<Omit<NexAuthProject, 'projectId'>>;

export interface NexAuthManagementConfig {
  authUrl: string;
  adminToken: string;
  fetch?: typeof fetch;
}

export interface NexAuthUserManagementConfig {
  authUrl: string;
  sessionToken: string;
  projectId?: string;
  fetch?: typeof fetch;
}

export interface NexAuthApiToken {
  tokenId: string;
  tokenPrefix: string;
  label: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
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

export class NexAuthManagementClient {
  private readonly authUrl: string;
  private readonly adminToken: string;
  private readonly fetcher: typeof fetch;

  constructor(config: NexAuthManagementConfig) {
    const authUrl = new URL(config.authUrl);
    if (!['http:', 'https:'].includes(authUrl.protocol)) throw new Error('Nex-auth authUrl must use HTTP or HTTPS');
    if (!config.adminToken.trim()) throw new Error('Nex-auth adminToken is required');
    this.authUrl = authUrl.toString().replace(/\/$/, '');
    this.adminToken = config.adminToken;
    this.fetcher = config.fetch ?? fetch;
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await this.fetcher(new URL(path, this.authUrl), {
      ...init,
      headers: { authorization: `Bearer ${this.adminToken}`, 'content-type': 'application/json', ...(init.headers ?? {}) },
    });
    if (!response.ok) throw new Error(`Nex-auth management request failed with status ${response.status}`);
    return await response.json() as T;
  }

  async listProjects(): Promise<NexAuthProject[]> {
    const payload = await this.request<{ projects: NexAuthProject[] }>('/v1/projects');
    return payload.projects;
  }

  async getProject(projectId: string): Promise<NexAuthProject> {
    return this.request<NexAuthProject>(`/v1/projects/${encodeURIComponent(projectId)}`);
  }

  async createProject(project: CreateProjectInput): Promise<NexAuthProject> {
    return this.request<NexAuthProject>('/v1/projects', { method: 'POST', body: JSON.stringify(project) });
  }

  async updateProject(projectId: string, updates: UpdateProjectInput): Promise<NexAuthProject> {
    return this.request<NexAuthProject>(`/v1/projects/${encodeURIComponent(projectId)}`, { method: 'PATCH', body: JSON.stringify(updates) });
  }
}

export function createManagementClient(config: NexAuthManagementConfig): NexAuthManagementClient {
  return new NexAuthManagementClient(config);
}

export class NexAuthUserManagementClient {
  private readonly authUrl: string;
  private readonly sessionToken: string;
  private readonly projectId: string;
  private readonly fetcher: typeof fetch;

  constructor(config: NexAuthUserManagementConfig) {
    const authUrl = new URL(config.authUrl);
    if (!['http:', 'https:'].includes(authUrl.protocol)) throw new Error('Nex-auth authUrl must use HTTP or HTTPS');
    if (!config.sessionToken.trim()) throw new Error('Nex-auth sessionToken is required');
    this.authUrl = authUrl.toString().replace(/\/$/, '');
    this.sessionToken = config.sessionToken;
    this.projectId = config.projectId ?? 'nexuss-dashboard';
    this.fetcher = config.fetch ?? fetch;
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await this.fetcher(new URL(path, this.authUrl), {
      ...init,
      headers: { authorization: `Bearer ${this.sessionToken}`, 'x-nex-auth-project': this.projectId, 'content-type': 'application/json', ...(init.headers ?? {}) },
    });
    if (!response.ok) throw new Error(`Nex-auth user management request failed with status ${response.status}`);
    if (response.status === 204) return undefined as T;
    return await response.json() as T;
  }

  async listTokens(): Promise<NexAuthApiToken[]> {
    const payload = await this.request<{ tokens: NexAuthApiToken[] }>('/v1/tokens');
    return payload.tokens;
  }

  async createToken(label = 'CLI token'): Promise<{ token: string; tokenId: string; tokenPrefix: string; label: string; createdAt: string; warning: string }> {
    return this.request('/v1/tokens', { method: 'POST', body: JSON.stringify({ label }) });
  }

  async revokeToken(tokenId: string): Promise<void> {
    await this.request<void>(`/v1/tokens/${encodeURIComponent(tokenId)}`, { method: 'DELETE' });
  }

  async listProjects(): Promise<NexAuthProject[]> {
    const payload = await this.request<{ projects: NexAuthProject[] }>('/v1/projects');
    return payload.projects;
  }
}

export function createUserManagementClient(config: NexAuthUserManagementConfig): NexAuthUserManagementClient {
  return new NexAuthUserManagementClient(config);
}
