/**
 * Slack OAuth token persistence types (table: slack_oauth_tokens).
 * Mirrors src/db/types/linearOAuth.ts.
 */
export interface SlackOAuthToken {
  userId: string;
  botTokenEncrypted: string;
  appTokenEncrypted: string | null;
  slackTeamId: string | null;
  slackTeamName: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface NewSlackOAuthToken {
  userId: string;
  botTokenEncrypted: string;
  appTokenEncrypted?: string | null;
  slackTeamId?: string | null;
  slackTeamName?: string | null;
}
