export type Provider = 'google' | 'github';
export type ProjectStatus = 'active' | 'disabled';

export interface ServerConfig {
  port: number;
  databaseUrl: string;
  publicUrl: string;
  sessionTtlSeconds: number;
  stateTtlSeconds: number;
  cookieName: string;
  adminToken?: string | undefined;
  googleClientId: string;
  googleClientSecret: string;
  githubClientId: string;
  githubClientSecret: string;
}

export interface ProjectRecord {
  projectId: string;
  ownerUserId: string | null;
  name: string;
  homepageUrl: string;
  description: string;
  avatarUrl: string | null;
  allowedRedirectUris: string[];
  allowedOrigins: string[];
  enabledProviders: Provider[];
  status: ProjectStatus;
}

export interface OAuthStateRecord {
  stateHash: string;
  projectId: string;
  provider: Provider;
  redirectUri: string;
  expiresAt: Date;
}

export interface OAuthProfile {
  provider: Provider;
  providerAccountId: string;
  email: string | null;
  emailVerified: boolean;
  name: string | null;
  avatarUrl: string | null;
  username: string | null;
}

export interface UserRecord {
  id: string;
  email: string | null;
  name: string | null;
  avatarUrl: string | null;
}

export interface SessionRecord {
  tokenHash: string;
  userId: string;
  projectId: string;
  expiresAt: Date;
}

export interface CreateSessionInput {
  userId: string;
  projectId: string;
  tokenHash: string;
  expiresAt: Date;
}

export interface Database {
  close(): Promise<void>;
  listProjects(ownerUserId?: string): Promise<ProjectRecord[]>;
  getProject(projectId: string): Promise<ProjectRecord | null>;
  upsertProject(project: ProjectRecord): Promise<ProjectRecord>;
  deleteProject(projectId: string): Promise<void>;
  createOAuthState(state: OAuthStateRecord): Promise<void>;
  consumeOAuthState(stateHash: string): Promise<OAuthStateRecord | null>;
  findOrCreateUser(profile: OAuthProfile): Promise<UserRecord>;
  createSession(input: CreateSessionInput): Promise<void>;
  getSession(tokenHash: string): Promise<SessionRecord | null>;
  getUser(userId: string): Promise<UserRecord | null>;
  deleteSession(tokenHash: string): Promise<void>;
}
