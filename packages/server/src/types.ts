export type Provider = 'google' | 'github';
export type ProjectStatus = 'active' | 'disabled';
export type OAuthPurpose = 'sign_in' | 'github_authorization';

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
  oauthRequestTimeoutMs: number;
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
  handoff: boolean;
  purpose?: OAuthPurpose;
  userId?: string | null;
  expiresAt: Date;
}

export interface HandoffRecord {
  handoffHash: string;
  projectId: string;
  userId: string;
  githubGrantToken?: string | null;
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
  accessToken?: string;
  refreshToken?: string | null;
  expiresInSeconds?: number | null;
  scopes?: string[];
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

export interface ApiTokenRecord {
  tokenId: string;
  userId: string;
  tokenHash: string;
  tokenPrefix: string;
  label: string;
  createdAt: Date;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
}

export interface CreateSessionInput {
  userId: string;
  projectId: string;
  tokenHash: string;
  expiresAt: Date;
}

export interface GithubGrantRecord {
  grantHash: string;
  projectId: string;
  userId: string;
  expiresAt: Date;
}

export interface GithubConnectionRecord {
  userId: string;
  githubAccountId: string;
  login: string;
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date | null;
  scopes: string[];
  updatedAt: Date;
}

export interface OAuthFinalizationInput {
  state: OAuthStateRecord;
  profile: OAuthProfile;
  sessionTokenHash: string;
  sessionExpiresAt: Date;
  githubGrantHash?: string | null;
  githubGrantToken?: string | null;
  githubGrantExpiresAt?: Date | null;
  handoffHash?: string | null;
  handoffExpiresAt?: Date | null;
}

export interface OAuthFinalizationResult {
  user: UserRecord;
}

export interface Database {
  close(): Promise<void>;
  listProjects(ownerUserId?: string): Promise<ProjectRecord[]>;
  getProject(projectId: string): Promise<ProjectRecord | null>;
  upsertProject(project: ProjectRecord): Promise<ProjectRecord>;
  deleteProject(projectId: string): Promise<void>;
  createOAuthState(state: OAuthStateRecord): Promise<void>;
  consumeOAuthState(stateHash: string): Promise<OAuthStateRecord | null>;
  createHandoff(handoff: HandoffRecord): Promise<void>;
  consumeHandoff(handoffHash: string): Promise<HandoffRecord | null>;
  saveGithubConnection(connection: GithubConnectionRecord): Promise<void>;
  getGithubConnection(userId: string): Promise<GithubConnectionRecord | null>;
  createGithubGrant(grant: GithubGrantRecord): Promise<void>;
  getGithubGrant(grantHash: string): Promise<GithubGrantRecord | null>;
  findOrCreateUser(profile: OAuthProfile): Promise<UserRecord>;
  createSession(input: CreateSessionInput): Promise<void>;
  getSession(tokenHash: string): Promise<SessionRecord | null>;
  getUser(userId: string): Promise<UserRecord | null>;
  deleteSession(tokenHash: string): Promise<void>;
  createApiToken(token: ApiTokenRecord): Promise<void>;
  listApiTokens(userId: string): Promise<ApiTokenRecord[]>;
  getApiTokenByHash(tokenHash: string): Promise<ApiTokenRecord | null>;
  touchApiToken(tokenId: string): Promise<void>;
  revokeApiToken(userId: string, tokenId: string): Promise<boolean>;
  finalizeOAuthAuthorization?(input: OAuthFinalizationInput): Promise<OAuthFinalizationResult>;
}
