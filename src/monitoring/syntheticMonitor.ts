/**
 * Synthetic Monitor — periodic end-to-end health verification.
 *
 * Runs a synthetic fix on a known test case to verify the full pipeline:
 *   1. Webhook signature verification
 *   2. Issue context building
 *   3. Agent dispatch (OpenCode)
 *   4. Code investigation and fix generation
 *   5. Test suite execution
 *   6. Commit and branch push
 *   7. PR creation
 *
 * The monitor does NOT actually create PRs on real repos. Instead it:
 *   - Uses a dedicated test repo (STAS_SYNTHETIC_REPO)
 *   - Targets a known synthetic issue with a known trivial fix
 *   - Records pass/fail per stage
 *   - Reports results via the alerting system
 *
 * Scheduling is left to the caller — use cron, celery-beat, or
 * setInterval. The recommended interval is 5 minutes.
 *
 * Health check integration:
 *   - POST /health/synthetic returns latest result
 *   - Prometheus gauge: stas_synthetic_health{stage="..."} 0|1
 */

import { rootLogger } from '../utils/logger.js';

const log = rootLogger.child({ module: 'synthetic-monitor' });

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SyntheticStage =
  | 'webhook_verify'
  | 'context_build'
  | 'agent_dispatch'
  | 'code_investigate'
  | 'fix_generate'
  | 'test_execute'
  | 'commit_push'
  | 'pr_create';

export type StageStatus = 'passed' | 'failed' | 'skipped';

export interface SyntheticStageResult {
  stage: SyntheticStage;
  status: StageStatus;
  durationMs: number;
  error?: string;
}

export interface SyntheticRunResult {
  id: string;
  timestamp: string;
  /** Overall pass/fail */
  passed: boolean;
  /** Total duration in ms */
  totalDurationMs: number;
  /** Per-stage breakdown */
  stages: SyntheticStageResult[];
  /** Repo and issue targeted */
  targetRepo: string;
  targetIssue: string;
  /** Error summary if overall failure */
  errorSummary?: string;
}

export type SyntheticStatus = 'idle' | 'running' | 'degraded' | 'down';

export interface SyntheticMonitorState {
  status: SyntheticStatus;
  lastRun: SyntheticRunResult | null;
  lastRunAt: string | null;
  consecutiveFailures: number;
  totalRuns: number;
  totalPasses: number;
}

/**
 * Interface for the actual pipeline executor. Injected so the monitor
 * can be tested without a real OpenCode server.
 */
export interface PipelineExecutor {
  /** Verify a webhook payload signature. */
  verifyWebhook(payload: string, signature: string): Promise<boolean>;
  /** Build issue context from title and body. */
  buildContext(repo: string, issueTitle: string, issueBody: string): Promise<boolean>;
  /** Dispatch the OpenCode agent for a fix run. */
  dispatchAgent(repo: string, issueNumber: number): Promise<boolean>;
  /** Run code investigation phase. */
  investigateCode(repo: string, issueNumber: number): Promise<boolean>;
  /** Generate and apply a fix. */
  generateFix(repo: string, issueNumber: number): Promise<boolean>;
  /** Execute the test suite. */
  executeTests(repo: string): Promise<boolean>;
  /** Commit and push the fix branch. */
  commitAndPush(repo: string, branch: string): Promise<boolean>;
  /** Create a PR from the fix branch. */
  createPR(repo: string, branch: string, title: string, body: string): Promise<boolean>;
}

// ---------------------------------------------------------------------------
// Default synthetic test parameters
// ---------------------------------------------------------------------------

export const DEFAULT_SYNTHETIC_REPO = process.env.STAS_SYNTHETIC_REPO ?? 'stas-bot/synthetic-test';
export const DEFAULT_SYNTHETIC_ISSUE = '1';
export const DEFAULT_SYNTHETIC_ISSUE_TITLE = 'Synthetic health check';
export const DEFAULT_SYNTHETIC_ISSUE_BODY =
  'This is an automated synthetic health check issue. The fix should update the version file.';
export const DEFAULT_SYNTHETIC_BRANCH_PREFIX = 'synthetic-health/';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let currentState: SyntheticMonitorState = {
  status: 'idle',
  lastRun: null,
  lastRunAt: null,
  consecutiveFailures: 0,
  totalRuns: 0,
  totalPasses: 0,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generateRunId(): string {
  return `syn-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

async function timedStage<T>(
  stage: SyntheticStage,
  fn: () => Promise<T>,
): Promise<{ result: SyntheticStageResult; output: T }> {
  const start = Date.now();
  try {
    const output = await fn();
    const durationMs = Date.now() - start;
    return {
      result: { stage, status: output ? 'passed' : 'failed', durationMs },
      output,
    };
  } catch (err) {
    const durationMs = Date.now() - start;
    return {
      result: {
        stage,
        status: 'failed',
        durationMs,
        error: err instanceof Error ? err.message : String(err),
      },
      output: false as T,
    };
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Execute a full synthetic fix run through the pipeline.
 *
 * @param executor - The pipeline executor to use.
 * @param repo - Target repository (defaults to STAS_SYNTHETIC_REPO).
 * @param issueNumber - Target issue number (defaults to "1").
 * @returns The complete run result.
 */
export async function runSyntheticCheck(
  executor: PipelineExecutor,
  repo: string = DEFAULT_SYNTHETIC_REPO,
  issueNumber: string = DEFAULT_SYNTHETIC_ISSUE,
): Promise<SyntheticRunResult> {
  const startTotal = Date.now();
  currentState.status = 'running';

  log.info(
    { repo, issueNumber },
    'Starting synthetic health check',
  );

  // Stage 1: Webhook verification
  const verifyResult = await timedStage('webhook_verify', () =>
    executor.verifyWebhook('{"action":"labeled"}', 'test-signature'),
  );

  // Stage 2: Context building
  const contextResult = await timedStage('context_build', () =>
    executor.buildContext(repo, DEFAULT_SYNTHETIC_ISSUE_TITLE, DEFAULT_SYNTHETIC_ISSUE_BODY),
  );

  // Stage 3: Agent dispatch
  const dispatchResult = await timedStage('agent_dispatch', () =>
    executor.dispatchAgent(repo, Number(issueNumber)),
  );

  // Stage 4: Code investigation
  const investigateResult = await timedStage('code_investigate', () =>
    executor.investigateCode(repo, Number(issueNumber)),
  );

  // Stage 5: Fix generation
  const fixResult = await timedStage('fix_generate', () =>
    executor.generateFix(repo, Number(issueNumber)),
  );

  // Stage 6: Test execution
  const testResult = await timedStage('test_execute', () =>
    executor.executeTests(repo),
  );

  // Stage 7: Commit and push
  const branch = `${DEFAULT_SYNTHETIC_BRANCH_PREFIX}${Date.now()}`;
  const commitResult = await timedStage('commit_push', () =>
    executor.commitAndPush(repo, branch),
  );

  // Stage 8: PR creation
  const prTitle = `[Synthetic] ${DEFAULT_SYNTHETIC_ISSUE_TITLE}`;
  const prBody = `Automated synthetic health check.\n\nResolves #${issueNumber}`;
  const prResult = await timedStage('pr_create', () =>
    executor.createPR(repo, branch, prTitle, prBody),
  );

  const allStages = [
    verifyResult.result,
    contextResult.result,
    dispatchResult.result,
    investigateResult.result,
    fixResult.result,
    testResult.result,
    commitResult.result,
    prResult.result,
  ];

  const totalDurationMs = Date.now() - startTotal;
  const passed = allStages.every((s) => s.status === 'passed');
  const failedStages = allStages.filter((s) => s.status === 'failed');

  const result: SyntheticRunResult = {
    id: generateRunId(),
    timestamp: new Date().toISOString(),
    passed,
    totalDurationMs,
    stages: allStages,
    targetRepo: repo,
    targetIssue: issueNumber,
    errorSummary: failedStages.length > 0
      ? failedStages.map((s) => `[${s.stage}] ${s.error ?? 'failed'}`).join('; ')
      : undefined,
  };

  // Update state
  currentState.status = passed ? 'idle' : 'degraded';
  currentState.lastRun = result;
  currentState.lastRunAt = result.timestamp;
  currentState.totalRuns++;
  if (passed) {
    currentState.totalPasses++;
    currentState.consecutiveFailures = 0;
  } else {
    currentState.consecutiveFailures++;
    if (currentState.consecutiveFailures >= 3) {
      currentState.status = 'down';
    }
  }

  if (passed) {
    log.info(
      { runId: result.id, totalDurationMs },
      'Synthetic health check passed',
    );
  } else {
    log.error(
      {
        runId: result.id,
        totalDurationMs,
        failedStages: failedStages.map((s) => s.stage),
        consecutiveFailures: currentState.consecutiveFailures,
      },
      'Synthetic health check failed',
    );
  }

  return result;
}

/**
 * Get the current synthetic monitor state.
 */
export function getSyntheticMonitorState(): SyntheticMonitorState {
  return { ...currentState };
}

/**
 * Reset the synthetic monitor state (for testing).
 */
export function resetSyntheticMonitorState(): void {
  currentState = {
    status: 'idle',
    lastRun: null,
    lastRunAt: null,
    consecutiveFailures: 0,
    totalRuns: 0,
    totalPasses: 0,
  };
}

/**
 * Compute synthetic health check uptime percentage.
 */
export function getSyntheticUptime(): number {
  if (currentState.totalRuns === 0) return 100;
  return Math.round((currentState.totalPasses / currentState.totalRuns) * 100);
}

/**
 * Determine whether the synthetic monitor should be considered healthy
 * based on recent runs.
 */
export function isSyntheticMonitorHealthy(
  maxConsecutiveFailures: number = 3,
): boolean {
  return currentState.consecutiveFailures < maxConsecutiveFailures;
}
