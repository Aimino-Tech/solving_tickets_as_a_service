/**
 * Linear OAuth token persistence types (table: linear_oauth_tokens).
 * Mirrors src/db/types/githubOAuth.ts.
 */
export interface LinearOAuthToken {
  id: number;
  userId: string;
  accessTokenEncrypted: string;
  refreshTokenEncrypted: string | null;
  linearUserId: string;
  linearLogin: string;
  tokenExpiresAt: Date | null;
  refreshTokenExpiresAt: Date | null;
  scope: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface NewLinearOAuthToken {
  userId: string;
  accessTokenEncrypted: string;
  refreshTokenEncrypted?: string | null;
  linearUserId: string;
  linearLogin: string;
  tokenExpiresAt?: Date | null;
  refreshTokenExpiresAt?: Date | null;
  scope?: string | null;
}
