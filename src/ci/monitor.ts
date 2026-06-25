/**
 * CI Monitor Service — polls GitHub Actions checks and auto-creates issues
 * on sustained failure detection.
 *
 * ── Error Handling Audit ────────────────────────────────────────────
 * ✅ Poll loop catches per-repo errors without crashing the entire loop
 * ✅ Rate-limit/network errors are logged and the repo is skipped for that cycle
 * ✅ Issue creation failures are logged but do not halt the monitor
 * ✅ Graceful stop via stop() method clears the interval
 * ────────────────────────────────────────────────────────────────────
 */

import { Octokit } from '@octokit/rest';
import { config } from '../config.js';
import { getOctokit, getAppOctokitInstance } from '../github/auth.js';
import { rootLogger } from '../utils/logger.js';
import { analyzeFailure } from './analyzer.js';

const log = rootLogger.child({ module: 'ci-monitor' });

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CheckFailureRecord {
  /** The name of the check run (e.g. "CI / build") */
  checkName: string;
  /** Number of consecutive failures */
  consecutiveFailures: number;
  /** Timestamp of the first detected failure */
  firstFailureAt: number;
  /** Timestamp of the most recent failure */
  lastFailureAt: number;
  /** Most recent check run ID */
  lastCheckRunId: number;
  /** Most recent check run HTML URL */
  lastHtmlUrl: string;
  /** Head SHA at time of failure */
  headSha: string;
  /** Whether an issue has already been created for this failure streak */
  issueCreated: boolean;
}

export interface RepoCheckState {
  /** Full repo name: "owner/repo" */
  repo: string;
  /** Installation ID for Octokit auth */
  installationId: number;
  /** Per-check failure records */
  failures: Map<string, CheckFailureRecord>;
}

// ---------------------------------------------------------------------------
// In-memory state
// ---------------------------------------------------------------------------

const repoStates = new Map<string, RepoCheckState>();

let pollTimer: ReturnType<typeof setInterval> | null = null;
let running = false;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Start the CI monitor polling loop.
 * Checks each configured repo on the configured interval.
 * No-op if already running or CI_MONITOR_ENABLED is false.
 */
export function startCiMonitor(): void {
  if (!config.ci.monitorEnabled) {
    log.info('CI monitor is disabled via CI_MONITOR_ENABLED');
    return;
  }

  if (running) {
    log.warn('CI monitor is already running');
    return;
  }

  if (config.ci.repos.length === 0) {
    log.warn('CI monitor is enabled but no repos are configured in CI_MONITOR_REPOS');
    return;
  }

  running = true;
  log.info(
    { repos: config.ci.repos, intervalMs: config.ci.pollIntervalMs, threshold: config.ci.failureThreshold },
    'Starting CI monitor',
  );

  // Run immediately on start
  pollOnce().catch((err) => log.error({ err: String(err) }, 'Initial CI monitor poll failed'));

  // Then schedule
  pollTimer = setInterval(() => {
    pollOnce().catch((err) => log.error({ err: String(err) }, 'CI monitor poll failed'));
  }, config.ci.pollIntervalMs);
}

/**
 * Stop the CI monitor polling loop.
 */
export function stopCiMonitor(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  running = false;
  log.info('CI monitor stopped');
}

/**
 * Get the current state of tracked check failures (for diagnostics / tests).
 */
export function getCheckStates(): Map<string, RepoCheckState> {
  return repoStates;
}

// ---------------------------------------------------------------------------
// Internal
// ---------------------------------------------------------------------------

/**
 * Poll all configured repos once.
 */
async function pollOnce(): Promise<void> {
  for (const repo of config.ci.repos) {
    // Repo format: "owner/name"
    const parts = repo.split('/');
    if (parts.length !== 2) {
      log.warn({ repo }, 'Invalid repo format in CI_MONITOR_REPOS — expected "owner/name"');
      continue;
    }
    const [owner, repoName] = parts;

    try {
      await pollRepo(owner, repoName);
    } catch (err) {
      log.error({ err: String(err), repo }, 'Error polling repo for CI checks');
    }
  }
}

/**
 * Poll a single repository's CI checks.
 */
async function pollRepo(owner: string, repoName: string): Promise<void> {
  const repoKey = `${owner}/${repoName}`;
  const octokit = await getOctokitForRepo(owner, repoName);

  // Get the default branch to check its latest commit status
  const { data: repo } = await octokit.repos.get({ owner, repo: repoName });
  const defaultBranch = repo.default_branch || 'main';

  // Get the latest commit on the default branch
  const { data: branch } = await octokit.repos.getBranch({ owner, repo: repoName, branch: defaultBranch });
  const latestSha = branch.commit.sha;

  // Get check suites for this SHA
  const { data: checkSuites } = await octokit.checks.listSuitesForRef({
    owner,
    repo: repoName,
    ref: latestSha,
  });

  if (checkSuites.total_count === 0) {
    log.debug({ repo: repoKey }, 'No check suites found for latest commit');
    return;
  }

  for (const suite of checkSuites.check_suites) {
    if (!suite.id) continue;

    const { data: checkRuns } = await octokit.checks.listForSuite({
      owner,
      repo: repoName,
      check_suite_id: suite.id,
    });

    for (const run of checkRuns.check_runs) {
      await processCheckRun(octokit, repoKey, owner, repoName, run, latestSha);
    }
  }
}

/**
 * Process a single check run — determine if it's a new or sustained failure.
 */
async function processCheckRun(
  octokit: Octokit,
  repoKey: string,
  owner: string,
  repoName: string,
  run: Awaited<ReturnType<Octokit['checks']['listForSuite']>>['data']['check_runs'][number],
  headSha: string,
): Promise<void> {
  const checkName = run.name;

  // We only care about completed failures
  if (run.status !== 'completed') return;
  if (run.conclusion === 'success' || run.conclusion === 'neutral' || run.conclusion === 'skipped') {
    // Check passed — clear any failure record for this check
    const state = repoStates.get(repoKey);
    if (state) {
      state.failures.delete(checkName);
    }
    return;
  }

  // This is a failure
  const htmlUrl = run.html_url || `${config.github.webhookPath}/../runs/${run.id}`;
  const checkRunId = run.id;

  let state = repoStates.get(repoKey);
  if (!state) {
    const installationId = await resolveInstallationId(owner, repoName);
    state = {
      repo: repoKey,
      installationId,
      failures: new Map(),
    };
    repoStates.set(repoKey, state);
  }

  const existing = state.failures.get(checkName);

  if (existing && existing.headSha === headSha && existing.lastCheckRunId === checkRunId) {
    // Already processed this exact run
    return;
  }

  const now = Date.now();

  if (existing) {
    // Sustained failure — increment counter
    existing.consecutiveFailures += 1;
    existing.lastFailureAt = now;
    existing.lastCheckRunId = checkRunId;
    existing.lastHtmlUrl = htmlUrl;
    existing.headSha = headSha;

    log.warn(
      {
        repo: repoKey,
        checkName,
        failures: existing.consecutiveFailures,
        threshold: config.ci.failureThreshold,
      },
      'Check failure count incremented',
    );

    // Check threshold
    if (existing.consecutiveFailures >= config.ci.failureThreshold && !existing.issueCreated) {
      await createIssueForFailure(octokit, owner, repoName, checkName, existing, run);
      existing.issueCreated = true;
    }
  } else {
    // First failure for this check
    log.info({ repo: repoKey, checkName, conclusion: run.conclusion }, 'New check failure detected');
    state.failures.set(checkName, {
      checkName,
      consecutiveFailures: 1,
      firstFailureAt: now,
      lastFailureAt: now,
      lastCheckRunId: checkRunId,
      lastHtmlUrl: htmlUrl,
      headSha,
      issueCreated: false,
    });
  }
}

/**
 * Create a GitHub issue for a sustained CI failure and label it with stas:fix.
 */
async function createIssueForFailure(
  octokit: Octokit,
  owner: string,
  repo: string,
  checkName: string,
  record: CheckFailureRecord,
  run: Awaited<ReturnType<Octokit['checks']['listForSuite']>>['data']['check_runs'][number],
): Promise<void> {
  log.info(
    { repo: `${owner}/${repo}`, checkName, failures: record.consecutiveFailures },
    'Creating issue for sustained CI failure',
  );

  // Fetch logs for analysis
  let analysis = '';
  try {
    const logs = await fetchCheckRunLogs(octokit, owner, repo, run.id);
    analysis = await analyzeFailure(checkName, logs);
  } catch (err) {
    log.warn({ err: String(err) }, 'Failed to fetch/analyze CI logs (non-fatal)');
    analysis = 'Log analysis could not be completed. See the failed run for details.';
  }

  const title = `[CI Auto] Sustained failure: ${checkName} failed ${record.consecutiveFailures} times`;
  const body = [
    `## 🚨 CI Failure Detected`,
    '',
    `The **${checkName}** check has failed **${record.consecutiveFailures} consecutive times** on \`${record.headSha.slice(0, 12)}\`.`,
    '',
    `| Detail | Value |`,
    `|---|---|`,
    `| Check | ${checkName} |`,
    `| Failures | ${record.consecutiveFailures} |`,
    `| Latest Run | [#${run.id}](${record.lastHtmlUrl}) |`,
    `| First Failed | ${new Date(record.firstFailureAt).toISOString()} |`,
    `| Latest Failed | ${new Date(record.lastFailureAt).toISOString()} |`,
    `| Commit | \`${record.headSha.slice(0, 12)}\` |`,
    ``,
    `---`,
    ``,
    `### Failure Analysis`,
    ``,
    analysis,
    ``,
    `---`,
    ``,
    `_Auto-created by STAS CI Monitor_`,
  ].join('\n');

  try {
    const { data: issue } = await octokit.issues.create({
      owner,
      repo,
      title,
      body,
      labels: [config.stas.label],
    });

    log.info(
      { repo: `${owner}/${repo}`, issueNumber: issue.number, checkName },
      'Issue created for sustained CI failure',
    );
  } catch (err) {
    log.error(
      { err: String(err), repo: `${owner}/${repo}`, checkName },
      'Failed to create issue for CI failure',
    );
  }
}

/**
 * Fetch the logs for a given check run.
 */
async function fetchCheckRunLogs(
  octokit: Octokit,
  owner: string,
  repo: string,
  checkRunId: number,
): Promise<string> {
  try {
    const response = await octokit.checks.get({
      owner,
      repo,
      check_run_id: checkRunId,
    });

    // Try to get the full log output from the check suite's output
    if (response.data.output?.summary) {
      return `${response.data.output.title || ''}\n${response.data.output.summary}\n${response.data.output.text || ''}`;
    }

    // Fallback: list the check suite annotations
    const annotations = await octokit.checks.listAnnotations({
      owner,
      repo,
      check_run_id: checkRunId,
    });

    if (annotations.data.length > 0) {
      return annotations.data
        .map((a) => `[${a.annotation_level}] ${a.path}:${a.start_line} — ${a.message}`)
        .join('\n');
    }

    return '(No log output available)';
  } catch (err) {
    log.warn({ err: String(err), checkRunId }, 'Failed to fetch check run logs');
    return '(Failed to fetch logs)';
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Resolve the installation ID for a given repo.
 * Tries the GitHub API first, then falls back to configured value.
 */
async function resolveInstallationId(owner: string, repo: string): Promise<number> {
  const repoKey = `${owner}/${repo}`;
  const existing = repoStates.get(repoKey);
  if (existing && existing.installationId > 0) {
    return existing.installationId;
  }

  try {
    const appOctokit = getAppOctokitInstance();
    const { data: installation } = await appOctokit.apps.getRepoInstallation({
      owner,
      repo,
    });
    return installation.id;
  } catch (err) {
    log.warn(
      { err: String(err), owner, repo },
      'Could not resolve installation ID via API, falling back to configured value',
    );
  }

  if (config.trackers?.installationId) {
    return config.trackers.installationId;
  }

  return 0;
}

/**
 * Get an authenticated Octokit instance for a repo.
 * Tries to find the right installation; falls back to app-level Octokit.
 */
async function getOctokitForRepo(owner: string, repo: string): Promise<Octokit> {
  const repoKey = `${owner}/${repo}`;
  const existing = repoStates.get(repoKey);
  if (existing && existing.installationId > 0) {
    return getOctokit(existing.installationId);
  }

  const installationId = await resolveInstallationId(owner, repo);
  if (installationId > 0) {
    return getOctokit(installationId);
  }

  // Last resort — use app-level Octokit
  return getAppOctokitInstance();
}
