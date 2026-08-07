/** A Bitbucket workspace that installed the SYNTARO Forge app. */
export interface BitbucketForgeInstallation {
  installationId: string;
  appId: string;
  /** Workspace UUID (`{...}`) — populated by the first product event. */
  workspaceUuid: string | null;
  /** Workspace slug (e.g. `aimino-tech`) — resolved once via the API. */
  workspaceSlug: string | null;
  /** Atlassian API base URL from the FIT token `app.apiBaseUrl` claim. */
  apiBaseUrl: string | null;
  /** Encrypted latest `x-forge-oauth-system` token (app bot identity). */
  systemTokenEncrypted: string | null;
  tokenExpiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface NewBitbucketForgeInstallation {
  installationId: string;
  appId: string;
  workspaceUuid?: string | null;
  workspaceSlug?: string | null;
  apiBaseUrl?: string | null;
  systemTokenEncrypted?: string | null;
  tokenExpiresAt?: Date | null;
}
