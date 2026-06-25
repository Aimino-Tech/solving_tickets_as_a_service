/**
 * Onboarding state machine.
 *
 * Tracks each tenant's progress through the self-service onboarding flow.
 * States are persisted to the `onboarding_state` DB table so they survive
 * page refreshes, server restarts, and concurrent sessions.
 *
 * State flow:
 *   not_started → github_installed → linear_connected → repos_configured
 *   → labels_set → test_run → completed
 *
 * Transitions are validated: you cannot skip states or go backwards.
 *
 * ── Error Handling Audit ────────────────────────────────────────────
 * ✅ Invalid transition raises a typed error with current and target state
 * ✅ DB persistence failures are logged and surfaced
 * ✅ Missing state when expected returns null instead of throwing
 * ────────────────────────────────────────────────────────────────────
 */

import { rootLogger } from '../utils/logger.js';

const log = rootLogger.child({ module: 'onboarding-state-machine' });

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export const ONBOARDING_STATES = [
  'not_started',
  'github_installed',
  'linear_connected',
  'repos_configured',
  'labels_set',
  'test_run',
  'completed',
] as const;

export type OnboardingState = (typeof ONBOARDING_STATES)[number];

/** Allowed transitions: current state → set of target states */
const ALLOWED_TRANSITIONS: Record<OnboardingState, Set<OnboardingState>> = {
  not_started: new Set(['github_installed']),
  github_installed: new Set(['github_installed', 'linear_connected']),
  linear_connected: new Set(['linear_connected', 'repos_configured']),
  repos_configured: new Set(['repos_configured', 'labels_set']),
  labels_set: new Set(['labels_set', 'test_run']),
  test_run: new Set(['test_run', 'completed']),
  completed: new Set(['completed']),
};

export interface OnboardingProgressData {
  /** GitHub installation ID (maps to tenant_id) */
  installationId?: number;
  /** GitHub account login */
  accountLogin?: string;
  /** Linear organization ID */
  linearOrganizationId?: string;
  /** Selected repositories */
  repos?: Array<{ owner: string; name: string }>;
  /** Configured labels per repo */
  labels?: Record<string, string[]>;
  /** Test issue URL */
  testIssueUrl?: string;
  /** Error details if a step failed */
  lastError?: string;
  [key: string]: unknown;
}

export interface OnboardingRecord {
  id: number;
  tenantId: string;
  state: OnboardingState;
  progressData: OnboardingProgressData;
  createdAt: Date;
  updatedAt: Date;
}

// ---------------------------------------------------------------------------
// Error type
// ---------------------------------------------------------------------------

export class InvalidTransitionError extends Error {
  constructor(current: OnboardingState, target: OnboardingState) {
    super(
      `Cannot transition from "${current}" to "${target}". ` +
      `Allowed transitions from "${current}": ${[...(ALLOWED_TRANSITIONS[current] ?? [])].join(', ') || 'none'}`,
    );
    this.name = 'InvalidTransitionError';
  }
}

// ---------------------------------------------------------------------------
// State Machine
// ---------------------------------------------------------------------------

export class OnboardingStateMachine {
  /**
   * Create a new onboarding state for a tenant.
   * If a state already exists, it is returned instead.
   */
  async createState(tenantId: string): Promise<OnboardingRecord> {
    const { queryWithRetry } = await import('../db/connection.js');

    // Check if state already exists
    const existing = await this.getState(tenantId);
    if (existing) {
      log.debug({ tenantId, state: existing.state }, 'Onboarding state already exists');
      return existing;
    }

    const result = await queryWithRetry<{
      id: number;
      tenant_id: string;
      state: string;
      progress_data: OnboardingProgressData;
      created_at: Date;
      updated_at: Date;
    }>(
      `INSERT INTO onboarding_state (tenant_id, state, progress_data)
       VALUES ($1, 'not_started', '{}')
       RETURNING *`,
      [tenantId],
    );

    const record = result.rows[0];
    log.info({ tenantId, state: record.state }, 'Onboarding state created');

    return {
      id: record.id,
      tenantId: record.tenant_id,
      state: record.state as OnboardingState,
      progressData: record.progress_data ?? {},
      createdAt: record.created_at,
      updatedAt: record.updated_at,
    };
  }

  /**
   * Get the current onboarding state for a tenant.
   * Returns null if no state exists.
   */
  async getState(tenantId: string): Promise<OnboardingRecord | null> {
    const { queryWithRetry } = await import('../db/connection.js');
    const result = await queryWithRetry<{
      id: number;
      tenant_id: string;
      state: string;
      progress_data: OnboardingProgressData;
      created_at: Date;
      updated_at: Date;
    }>(
      `SELECT * FROM onboarding_state WHERE tenant_id = $1`,
      [tenantId],
    );

    if (result.rows.length === 0) return null;

    const row = result.rows[0];
    return {
      id: row.id,
      tenantId: row.tenant_id,
      state: row.state as OnboardingState,
      progressData: row.progress_data ?? {},
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  /**
   * Transition the tenant to a new state.
   * Validates that the transition is allowed.
   * Throws InvalidTransitionError if the transition is not allowed.
   */
  async transition(tenantId: string, targetState: OnboardingState): Promise<OnboardingRecord> {
    const current = await this.getState(tenantId);
    const currentState = current?.state ?? 'not_started';

    // Validate the transition
    const allowed = ALLOWED_TRANSITIONS[currentState];
    if (!allowed || !allowed.has(targetState)) {
      throw new InvalidTransitionError(currentState, targetState);
    }

    const { queryWithRetry } = await import('../db/connection.js');

    if (current) {
      const result = await queryWithRetry<{
        id: number;
        tenant_id: string;
        state: string;
        progress_data: OnboardingProgressData;
        created_at: Date;
        updated_at: Date;
      }>(
        `UPDATE onboarding_state
         SET state = $1, updated_at = NOW()
         WHERE tenant_id = $2
         RETURNING *`,
        [targetState, tenantId],
      );

      const row = result.rows[0];
      log.info({ tenantId, from: currentState, to: targetState }, 'Onboarding state transitioned');

      return {
        id: row.id,
        tenantId: row.tenant_id,
        state: row.state as OnboardingState,
        progressData: row.progress_data ?? {},
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      };
    }

    // No existing state — create one with the target state (skip not_started)
    const result = await queryWithRetry<{
      id: number;
      tenant_id: string;
      state: string;
      progress_data: OnboardingProgressData;
      created_at: Date;
      updated_at: Date;
    }>(
      `INSERT INTO onboarding_state (tenant_id, state, progress_data)
       VALUES ($1, $2, '{}')
       RETURNING *`,
      [tenantId, targetState],
    );

    const row = result.rows[0];
    log.info({ tenantId, state: row.state }, 'Onboarding state created with initial transition');

    return {
      id: row.id,
      tenantId: row.tenant_id,
      state: row.state as OnboardingState,
      progressData: row.progress_data ?? {},
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  /**
   * Update the progress data (metadata) for a tenant's onboarding.
   * Merges the provided data with existing data (shallow merge).
   */
  async updateProgress(tenantId: string, data: OnboardingProgressData): Promise<OnboardingRecord> {
    const { queryWithRetry } = await import('../db/connection.js');

    const current = await this.getState(tenantId);
    const mergedData = { ...(current?.progressData ?? {}), ...data };

    const result = await queryWithRetry<{
      id: number;
      tenant_id: string;
      state: string;
      progress_data: OnboardingProgressData;
      created_at: Date;
      updated_at: Date;
    }>(
      `UPDATE onboarding_state
       SET progress_data = $1, updated_at = NOW()
       WHERE tenant_id = $2
       RETURNING *`,
      [JSON.stringify(mergedData), tenantId],
    );

    if (result.rows.length === 0) {
      throw new Error(`No onboarding state found for tenant ${tenantId}`);
    }

    const row = result.rows[0];
    return {
      id: row.id,
      tenantId: row.tenant_id,
      state: row.state as OnboardingState,
      progressData: row.progress_data ?? {},
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  /**
   * Check if the tenant has completed the onboarding flow.
   */
  async isComplete(tenantId: string): Promise<boolean> {
    const state = await this.getState(tenantId);
    return state?.state === 'completed';
  }

  /**
   * Get the next recommended step for the tenant based on current state.
   */
  getNextStep(state: OnboardingState): OnboardingState | null {
    const index = ONBOARDING_STATES.indexOf(state);
    if (index >= 0 && index < ONBOARDING_STATES.length - 1) {
      return ONBOARDING_STATES[index + 1];
    }
    return null;
  }

  /**
   * Get the human-readable name for a state.
   */
  getStateLabel(state: OnboardingState): string {
    const labels: Record<OnboardingState, string> = {
      not_started: 'Not started',
      github_installed: 'GitHub App installed',
      linear_connected: 'Linear connected',
      repos_configured: 'Repositories configured',
      labels_set: 'Labels configured',
      test_run: 'Test run triggered',
      completed: 'Completed',
    };
    return labels[state] ?? state;
  }

  /**
   * Get all states with their completion status for the checklist.
   */
  async getChecklist(tenantId: string): Promise<
    Array<{ state: OnboardingState; label: string; completed: boolean; current: boolean }>
  > {
    const current = await this.getState(tenantId);
    const currentState = current?.state ?? 'not_started';
    const currentIndex = ONBOARDING_STATES.indexOf(currentState);

    return ONBOARDING_STATES.filter((s) => s !== 'not_started' && s !== 'completed').map((state) => {
      const stateIndex = ONBOARDING_STATES.indexOf(state);
      return {
        state,
        label: this.getStateLabel(state),
        completed: stateIndex < currentIndex,
        current: state === currentState,
      };
    });
  }
}

/** Singleton instance */
export const onboardingStateMachine = new OnboardingStateMachine();
