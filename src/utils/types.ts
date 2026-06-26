/**
 * Shared type definitions for STAS.
 */

export interface IssueJobData {
  installationId: number;
  repoOwner: string;
  repoName: string;
  repoPrivate: boolean;
  issueNumber: number;
  issueTitle: string;
  issueBody: string | null;

  /** Source platform that originated this job. Defaults to "github". */
  source?: 'github' | 'gitlab' | 'bitbucket' | 'linear' | 'jira' | 'rapidapi';

  /** Tracker ticket ID (Linear issue ID or Jira issue key) for cross-platform sync. */
  trackerTicketId?: string;

  /** Tracker platform type for posting results back to the source. */
  trackerType?: 'linear' | 'jira';

  /** Billing tier for this account — determines priority and rate limits. */
  billingPlan?: 'free' | 'pro' | 'enterprise';

  /** Job priority (lower = higher priority). Free=30, Pro=20, Enterprise=10. */
  priority?: number;
}

/**
 * Triage job data sent to the stas.agents.triage queue.
 */
export interface TriageData {
  installationId: number;
  repoOwner: string;
  repoName: string;
  repoPrivate: boolean;
  issueNumber: number;
  issueTitle: string;
  issueBody: string | null;

  /** Source platform that originated this job. Defaults to "github". */
  source?: 'github' | 'gitlab' | 'bitbucket' | 'linear' | 'jira' | 'rapidapi';

  /** Tracker ticket ID (Linear issue ID or Jira issue key) for cross-platform sync. */
  trackerTicketId?: string;

  /** Tracker platform type for posting results back to the source. */
  trackerType?: 'linear' | 'jira';

  /** Billing tier for this account — determines priority and rate limits. */
  billingPlan?: 'free' | 'pro' | 'enterprise';

  /** Job priority (lower = higher priority). Free=30, Pro=20, Enterprise=10. */
  priority?: number;
}

/**
 * Standard message envelope for RabbitMQ messages (AIM-1232 format).
 */
export interface MessageEnvelope {
  /** Schema version — increment on breaking changes. */
  version: number;
  /** Unique message identifier (UUID v4). */
  messageId: string;
  /** ISO 8601 timestamp of when the message was created. */
  timestamp: string;
  /** Service or component that produced this message (e.g. "stas-bot"). */
  source: string;
  /** Message type (e.g. "fix", "triage", "opencode"). */
  type: string;
  /** Optional correlation ID for request/response patterns. */
  correlationId?: string;
  /** Optional reply-to queue for response messages. */
  replyTo?: string;
  /** The actual message payload. */
  payload: unknown;
}

export interface BillingPlan {
  plan: 'free' | 'pro' | 'team' | 'enterprise';
  accountId: number;
  effectiveAt: string;
}

/**
 * Verification job data sent to the stas.agents.verification queue.
 */
export interface VerificationData {
  sandboxId: string;
  testCommand: string;
  repoUrl?: string;
  commitSha?: string;
}

/**
 * PR creation job data sent to the stas.agents.pr_creation queue.
 */
export interface PRCreationData {
  installationId: number;
  repoOwner: string;
  repoName: string;
  issueNumber: number;
  branchName: string;
  fixSummary: string;
  prTitle: string;
  prBody: string;
  repoPrivate?: boolean;
}

/**
 * Notification job data sent to the stas.events.notifications queue.
 */
export interface NotificationData {
  channel: 'slack' | 'webhook' | 'email';
  message: string;
  severity?: 'info' | 'warn' | 'error';
  source?: string;
  metadata?: Record<string, unknown>;
}
