/**
 * Shared types for the RapidAPI integration.
 *
 * These types define the request/response shapes for the fix submission,
 * job polling, and eval result endpoints exposed via RapidAPI.
 */

import type { Request } from 'express';

// ---------------------------------------------------------------------------
// Request types
// ---------------------------------------------------------------------------

/** Input payload for POST /api/fix */
export interface FixRequest {
  /** GitHub repository URL (e.g., https://github.com/owner/repo) */
  repoUrl: string;
  /** Issue title */
  issueTitle: string;
  /** Issue body / description */
  issueBody: string;
  /** Optional language hint (e.g., "typescript", "python") */
  language?: string;
}

/** Successful response from POST /api/fix */
export interface FixResponse {
  /** UUID identifying the fix job */
  jobId: string;
  /** Initial status */
  status: JobStatus;
  /** URL to poll for job status updates */
  pollUrl: string;
  /** ISO timestamp of when the job was created */
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Job status
// ---------------------------------------------------------------------------

/** Possible states of a fix job */
export type JobStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed';

/** Full job status payload returned by GET /api/fix/:jobId */
export interface JobStatusResponse {
  /** UUID of the job */
  jobId: string;
  /** Current status */
  status: JobStatus;
  /** Error message (only present when status is "failed") */
  error?: string;
  /** Result URL for the fix (only present when status is "completed") */
  resultUrl?: string;
  /** GitHub PR URL if a pull request was created */
  prUrl?: string;
  /** Eval score (0-100) if the fix was evaluated */
  evalScore?: number;
  /** ISO timestamp of when the job was created */
  createdAt: string;
  /** ISO timestamp of when the job was last updated */
  updatedAt: string;
  /** ISO timestamp of when the job completed (or failed) */
  completedAt?: string;
}

// ---------------------------------------------------------------------------
// Eval results
// ---------------------------------------------------------------------------

/** Per-category eval score */
export interface EvalCategoryScore {
  /** Category name (e.g., "typescript", "python", "javascript") */
  category: string;
  /** Number of test cases in this category */
  total: number;
  /** Number of passed test cases */
  passed: number;
  /** Pass rate as a decimal (0.0 - 1.0) */
  passRate: number;
  /** Average score (0-100) */
  averageScore: number;
}

/** Aggregate eval results */
export interface EvalResults {
  /** Overall pass rate (0.0 - 1.0) */
  overallPassRate: number;
  /** Total number of test cases */
  totalTests: number;
  /** Number of passed test cases */
  passedTests: number;
  /** Number of failed test cases */
  failedTests: number;
  /** Per-category breakdown */
  categories: EvalCategoryScore[];
  /** Trend data (last N runs) */
  trend: number[];
  /** ISO timestamp of the eval run */
  timestamp: string;
}

/** Latest full eval run (includes all individual results) */
export interface LatestEvalRun {
  /** Unique eval run ID */
  runId: string;
  /** ISO timestamp of the run */
  timestamp: string;
  /** Overall pass rate */
  overallPassRate: number;
  /** Detailed results per test case */
  results: Array<{
    testCase: string;
    category: string;
    passed: boolean;
    score: number;
    durationMs: number;
    error?: string;
  }>;
  /** Summary by category */
  categorySummary: EvalCategoryScore[];
  /** Trend compared to previous run */
  trend: {
    previousPassRate: number;
    change: number; // positive = improvement
  };
}

// ---------------------------------------------------------------------------
// Express extension
// ---------------------------------------------------------------------------

declare global {
  namespace Express {
    interface Request {
      /** Subscriber plan tier assigned by RapidAPI auth middleware */
      plan?: 'free' | 'pro' | 'enterprise';
    }
  }
}
