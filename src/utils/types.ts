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
}

export interface BillingPlan {
  plan: "free" | "pro" | "enterprise";
  accountId: number;
  effectiveAt: string;
}

export interface AgentResult {
  summary: string;
  confidence: "high" | "medium" | "low";
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
}
