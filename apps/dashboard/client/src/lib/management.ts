export type Provider = 'google' | 'github';
export type ProjectStatus = 'active' | 'disabled';

export interface ManagedUser {
  id: string;
  email: string | null;
  name: string | null;
  avatarUrl: string | null;
}

export interface ApiTokenMetadata {
  tokenId: string;
  tokenPrefix: string;
  label: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

export interface ManagedProject {
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

export class ManagementError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }
}

const authUrl = (import.meta.env.VITE_NEXUSS_AUTH_URL || window.location.origin).replace(/\/$/, '');
const dashboardProjectId = import.meta.env.VITE_NEXUSS_DASHBOARD_PROJECT_ID || 'nexuss-dashboard';

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${authUrl}${path}`, {
    ...init,
    credentials: 'include',
    headers: { 'content-type': 'application/json', 'x-nex-auth-project': dashboardProjectId, ...(init.headers ?? {}) },
  });
  if (!response.ok) throw new ManagementError(response.status, `Project management request failed with status ${response.status}`);
  return await response.json() as T;
}

export function getCurrentUser(): Promise<ManagedUser | null> {
  return request<{ user: ManagedUser | null }>('/v1/me').then((payload) => payload.user);
}

export function listManagedProjects(): Promise<ManagedProject[]> {
  return request<{ projects: ManagedProject[] }>('/v1/projects').then((payload) => payload.projects);
}

export function createManagedProject(project: ManagedProject): Promise<ManagedProject> {
  return request<ManagedProject>('/v1/projects', { method: 'POST', body: JSON.stringify(project) });
}

export function updateManagedProject(projectId: string, updates: Partial<Omit<ManagedProject, 'projectId'>>): Promise<ManagedProject> {
  return request<ManagedProject>(`/v1/projects/${encodeURIComponent(projectId)}`, { method: 'PATCH', body: JSON.stringify(updates) });
}

export function listApiTokens(): Promise<ApiTokenMetadata[]> {
  return request<{ tokens: ApiTokenMetadata[] }>("/v1/tokens").then((payload) => payload.tokens);
}

export function createApiToken(label: string): Promise<{ token: string; tokenId: string; tokenPrefix: string; label: string; createdAt: string; warning: string }> {
  return request<{ token: string; tokenId: string; tokenPrefix: string; label: string; createdAt: string; warning: string }>("/v1/tokens", { method: "POST", body: JSON.stringify({ label }) });
}

export function revokeApiToken(tokenId: string): Promise<void> {
  return request<void>(`/v1/tokens/${encodeURIComponent(tokenId)}`, { method: "DELETE" });
}

export function beginDashboardSignIn(provider: Provider): void {
  const url = new URL(`/oauth/start/${provider}`, authUrl);
  url.searchParams.set('project_id', dashboardProjectId);
  url.searchParams.set('redirect_uri', window.location.origin);
  window.location.assign(url);
}
