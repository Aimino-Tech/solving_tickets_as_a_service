export interface Workspace {
  id: string;
  name: string;
  tenantId: string;
  planId: string;
  seats: number;
  status: string;
  slackTeamId: string | null;
  slackBotToken: string | null;
  slackChannel: string | null;
  githubInstallationId: number | null;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
  activatedAt: Date | null;
  suspendedAt: Date | null;
  deletedAt: Date | null;
}

export interface NewWorkspace {
  name: string;
  tenantId: string;
  planId?: string;
  seats?: number;
  status?: string;
  slackTeamId?: string | null;
  slackBotToken?: string | null;
  slackChannel?: string | null;
  githubInstallationId?: number | null;
  metadata?: Record<string, unknown>;
}
