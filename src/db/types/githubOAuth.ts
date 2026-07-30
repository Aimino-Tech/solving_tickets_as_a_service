export interface GitHubOAuthToken {
  id: number;
  userId: string;
  accessTokenEncrypted: string;
  refreshTokenEncrypted: string | null;
  githubLogin: string;
  githubUserId: number;
  avatarUrl?: string | null;
  tokenExpiresAt: Date | null;
  refreshTokenExpiresAt: Date | null;
  scope: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface NewGitHubOAuthToken {
  userId: string;
  accessTokenEncrypted: string;
  refreshTokenEncrypted?: string | null;
  githubLogin: string;
  githubUserId: number;
  avatarUrl?: string | null;
  tokenExpiresAt?: Date | null;
  refreshTokenExpiresAt?: Date | null;
  scope?: string | null;
}

export interface GitHubInstallation {
  id: number;
  userId: string;
  installationId: number;
  accountLogin: string;
  accountType: 'User' | 'Organization';
  repoScope: 'all' | 'selected';
  permissions: Record<string, unknown>;
  avatarUrl?: string | null;
  reposJson?: Array<{ name: string; owner: string; fullName: string; private: boolean; stasInstalled: boolean }>;
  createdAt: Date;
  updatedAt: Date;
}

export interface NewGitHubInstallation {
  userId: string;
  installationId: number;
  accountLogin: string;
  accountType: 'User' | 'Organization';
  repoScope?: 'all' | 'selected';
  permissions?: Record<string, unknown>;
  avatarUrl?: string | null;
  reposJson?: Array<{ name: string; owner: string; fullName: string; private: boolean; stasInstalled: boolean }>;
}

export interface GitHubWebhookConfig {
  id: number;
  userId: string;
  installationId: number;
  repoOwner: string;
  repoName: string;
  webhookId: number;
  webhookUrl: string;
  active: boolean;
  events: string[];
  createdAt: Date;
  updatedAt: Date;
}

export interface NewGitHubWebhookConfig {
  userId: string;
  installationId: number;
  repoOwner: string;
  repoName: string;
  webhookId: number;
  webhookUrl: string;
  active?: boolean;
  events?: string[];
}

// Aliases used by GitHubWebhookRepository
export type GitHubWebhook = GitHubWebhookConfig;
export type NewGitHubWebhook = NewGitHubWebhookConfig;
