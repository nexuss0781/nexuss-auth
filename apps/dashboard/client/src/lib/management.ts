export type Provider = 'google' | 'github';
export type ProjectStatus = 'active' | 'disabled';

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

export function listManagedProjects(): Promise<ManagedProject[]> {
  return request<{ projects: ManagedProject[] }>('/v1/projects').then((payload) => payload.projects);
}

export function createManagedProject(project: ManagedProject): Promise<ManagedProject> {
  return request<ManagedProject>('/v1/projects', { method: 'POST', body: JSON.stringify(project) });
}

export function updateManagedProject(projectId: string, updates: Partial<Omit<ManagedProject, 'projectId'>>): Promise<ManagedProject> {
  return request<ManagedProject>(`/v1/projects/${encodeURIComponent(projectId)}`, { method: 'PATCH', body: JSON.stringify(updates) });
}

export function beginDashboardSignIn(provider: Provider): void {
  const url = new URL(`/oauth/start/${provider}`, authUrl);
  url.searchParams.set('project_id', dashboardProjectId);
  url.searchParams.set('redirect_uri', window.location.origin);
  window.location.assign(url);
}
