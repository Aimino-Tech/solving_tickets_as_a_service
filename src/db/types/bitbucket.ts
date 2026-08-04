/**
 * Bitbucket connection persistence (table: bitbucket_connections).
 * Supports Atlassian API tokens (Basic) and OAuth 2.0 access tokens (Bearer).
 */
export type BitbucketAuthMethod = 'api_token' | 'oauth';

export interface BitbucketConnection {
  userId: string;
  /** Atlassian email (api_token) or Bitbucket username (oauth). */
  username: string;
  /** Encrypted API token or OAuth access token. */
  appPasswordEncrypted: string;
  workspace: string;
  authMethod: BitbucketAuthMethod;
  refreshTokenEncrypted: string | null;
  bitbucketUuid: string | null;
  scope: string | null;
  tokenExpiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface NewBitbucketConnection {
  userId: string;
  username: string;
  appPasswordEncrypted: string;
  workspace: string;
  authMethod?: BitbucketAuthMethod;
  refreshTokenEncrypted?: string | null;
  bitbucketUuid?: string | null;
  scope?: string | null;
  tokenExpiresAt?: Date | null;
}
