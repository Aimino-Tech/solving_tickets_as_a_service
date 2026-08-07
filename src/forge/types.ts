/**
 * Forge remote payload types — Bitbucket product events, lifecycle events and
 * the auth context extracted from the FIT token + x-forge-oauth-system header.
 *
 * Payload shapes mirror the official Forge docs:
 * https://developer.atlassian.com/platform/forge/events-reference/bitbucket/
 */

export interface ForgeActor {
  type: string;
  accountId: string;
  uuid: string;
}

export interface ForgeWorkspace {
  uuid: string;
}

export interface ForgeRepository {
  uuid: string;
  slug?: string;
}

export interface ForgeBranch {
  branch: string;
  commit: { hash: string };
}

export interface ForgePullRequest {
  id: number;
  state: string;
  source: ForgeBranch;
  destination: ForgeBranch;
  title?: { truncated: boolean; value: string };
  author?: ForgeActor & { displayName?: string };
  updatedOn?: string;
  createdOn?: string;
  commentCount?: number;
}

export interface ForgeComment {
  id: number;
}

/** Common product-event envelope (all Bitbucket Forge events). */
export interface ForgeBitbucketEvent {
  eventType: string;
  timestamp?: string;
  selfGenerated?: boolean;
  actor?: ForgeActor;
  repository?: ForgeRepository;
  workspace?: ForgeWorkspace;
  pullrequest?: ForgePullRequest;
  comment?: ForgeComment;
}

/** Lifecycle event (`avi:forge:installed:app` / `avi:forge:upgraded:app`). */
export interface ForgeLifecycleEvent {
  id: string;
  installerAccountId?: string;
  app: { id: string };
  environment?: { id: string; type: string };
}

/** Claims of the Forge Invocation Token (FIT) — sent in the Authorization header. */
export interface FitClaims {
  iss?: string;
  aud?: string;
  exp?: number;
  iat?: number;
  jti?: string;
  sub?: string;
  app: {
    id: string;
    apiBaseUrl: string;
    installationId: string;
    envId?: string;
  };
  installation?: {
    id?: string;
    type?: string;
  };
  context?: Record<string, unknown>;
}

/** Claims of the x-forge-oauth-system token (JWT, app bot identity). */
export interface ForgeSystemTokenClaims {
  exp?: number;
  iss?: string;
  sub?: string;
}

/** Auth context attached to every verified remote request. */
export interface ForgeRequestContext {
  /** The Forge app id (`app.id` from the FIT). */
  appId: string;
  /** Forge installation id (`app.installationId` from the FIT). */
  installationId: string;
  /** Atlassian API base URL (`app.apiBaseUrl` from the FIT). */
  apiBaseUrl: string;
  /** The x-forge-oauth-system token — use as Bearer for Bitbucket REST. */
  systemToken: string;
  /** Expiry of the system token (from its `exp` claim). */
  systemTokenExpiresAt: Date | null;
}
