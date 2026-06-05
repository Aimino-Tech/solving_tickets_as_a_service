/**
 * Storage abstraction types for persistent run history.
 *
 * Defines the interface that both SQLite and Postgres backends implement,
 * along with shared data types for fix-run records.
 */

// ---------------------------------------------------------------------------
// RunRecord — a single fix-run attempt
// ---------------------------------------------------------------------------

export interface RunRecord {
  /** Auto-generated primary key (set by backend after insert). */
  id?: number;

  /** GitHub App installation ID that triggered this run. */
  installationId: number;

  /** Repository owner (user or org). */
  repoOwner: string;

  /** Repository name. */
  repoName: string;

  /** GitHub issue number. */
  issueNumber: number;

  /** Current status of the fix run. */
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

  /** Agent's confidence level: high / medium / low. */
  confidence?: string;

  /** Human-readable summary of what the fix does. */
  summary?: string;

  /** URL of the pull request created by the fix. */
  prUrl?: string;

  /** Git branch name created by the agent. */
  branchName?: string;

  /** Error message if the run failed. */
  error?: string;

  /** Timestamp when the record was created. */
  createdAt?: Date;

  /** Timestamp of the last update. */
  updatedAt?: Date;

  /** Total duration of the fix run in milliseconds. */
  durationMs?: number;

  /** Model identifier used for this run. */
  modelUsed?: string;
}

// ---------------------------------------------------------------------------
// RunFilter — query parameters for listing runs
// ---------------------------------------------------------------------------

export interface RunFilter {
  /** Filter by repo in "owner/name" format. */
  repo?: string;

  /** Filter by issue number. */
  issueNumber?: number;

  /** Filter by status value. */
  status?: string;

  /** Only runs created on or after this date. */
  startDate?: Date;

  /** Only runs created on or before this date. */
  endDate?: Date;

  /** Maximum number of results to return. */
  limit?: number;

  /** Number of results to skip (for pagination). */
  offset?: number;
}

// ---------------------------------------------------------------------------
// RunStats — aggregate statistics for a set of runs
// ---------------------------------------------------------------------------

export interface RunStats {
  /** Total number of runs matching the filter. */
  total: number;

  /** Fraction of completed runs that succeeded (0..1). */
  passRate: number;

  /** Average duration of completed runs in milliseconds. */
  avgDurationMs: number;
}

// ---------------------------------------------------------------------------
// StorageBackend — abstract storage interface
// ---------------------------------------------------------------------------

export interface StorageBackend {
  /**
   * Persist a new run record. On success the returned record includes the
   * auto-generated `id` and server-set timestamps.
   */
  saveRun(run: RunRecord): Promise<RunRecord>;

  /**
   * Retrieve a single run record by its numeric ID.
   * Returns `undefined` when no record matches.
   */
  getRun(runId: string | number): Promise<RunRecord | undefined>;

  /**
   * List run records matching the supplied filter, newest-first.
   * Returns an empty array when no records match.
   */
  listRuns(filter: RunFilter): Promise<RunRecord[]>;

  /**
   * Return aggregate statistics (count, pass rate, avg duration) for
   * the runs matching the supplied filter.
   */
  getRunStats(filter: RunFilter): Promise<RunStats>;
}
