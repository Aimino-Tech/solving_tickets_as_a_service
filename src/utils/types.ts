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
