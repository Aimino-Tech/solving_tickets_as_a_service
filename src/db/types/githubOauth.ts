export interface GitHubOAuthToken {
  id: number;
  userId: number;
  accessTokenEncrypted: string;
  refreshTokenEncrypted?: string | null;
  githubLogin: string;
  githubUserId: number;
  avatarUrl?: string;
  scope?: string;
  tokenExpiresAt: Date | null;
  refreshTokenExpiresAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface NewGitHubOAuthToken {
  userId: number;
  accessTokenEncrypted: string;
  refreshTokenEncrypted?: string | null;
  githubLogin: string;
  githubUserId: number;
  avatarUrl?: string;
  scope?: string;
  tokenExpiresAt?: Date | null;
  refreshTokenExpiresAt?: Date | null;
}

export interface GitHubInstallation {
  id: number;
  userId: number;
  installationId: number;
  accountLogin: string;
  accountType: string;
  repoScope: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface NewGitHubInstallation {
  userId: number;
  installationId: number;
  accountLogin: string;
  accountType?: string;
  repoScope?: string;
}

export interface GitHubWebhookConfig {
  id: number;
  userId: number;
  installationId: number;
  owner: string;
  repo: string;
  webhookId: number;
  webhookUrl: string;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface NewGitHubWebhookConfig {
  userId: number;
  installationId: number;
  owner: string;
  repo: string;
  webhookId: number;
  webhookUrl: string;
}
