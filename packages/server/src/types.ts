export type Provider = 'google' | 'github';

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
  name: string;
  allowedRedirectUris: string[];
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
  getProject(projectId: string): Promise<ProjectRecord | null>;
  upsertProject(project: ProjectRecord): Promise<ProjectRecord>;
  createOAuthState(state: OAuthStateRecord): Promise<void>;
  consumeOAuthState(stateHash: string): Promise<OAuthStateRecord | null>;
  findOrCreateUser(profile: OAuthProfile): Promise<UserRecord>;
  createSession(input: CreateSessionInput): Promise<void>;
  getSession(tokenHash: string): Promise<SessionRecord | null>;
  getUser(userId: string): Promise<UserRecord | null>;
  deleteSession(tokenHash: string): Promise<void>;
}
