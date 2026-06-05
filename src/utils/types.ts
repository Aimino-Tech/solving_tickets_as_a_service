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
  source?: 'github' | 'gitlab' | 'bitbucket' | 'linear' | 'jira';

  /** Tracker ticket ID (Linear issue ID or Jira issue key) for cross-platform sync. */
  trackerTicketId?: string;

  /** Tracker platform type for posting results back to the source. */
  trackerType?: 'linear' | 'jira';
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
  source?: 'github' | 'gitlab' | 'bitbucket' | 'linear' | 'jira';

  /** Tracker ticket ID (Linear issue ID or Jira issue key) for cross-platform sync. */
  trackerTicketId?: string;

  /** Tracker platform type for posting results back to the source. */
  trackerType?: 'linear' | 'jira';
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
  plan: 'free' | 'pro' | 'enterprise';
  accountId: number;
  effectiveAt: string;
}

export interface AgentResult {
  summary: string;
  confidence: 'high' | 'medium' | 'low';
  fixReady: boolean;
  prUrl?: string;
  branchName?: string;
  diff?: string;
  testOutput?: string;
  errors?: string[];
  relevantPRs?: Array<{ url: string; title: string; state: string }>;
  noFixReason?: string;
  alreadyFixed?: boolean;
  investigationOnly?: boolean;
  /** Agent produced a fix but it failed verification (tests didn't pass). */
  verificationFailed?: boolean;
}
