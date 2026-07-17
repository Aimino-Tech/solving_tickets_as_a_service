/**
 * Enhanced onboarding wizard — step-by-step guided setup.
 *
 * Provides the full onboarding flow:
 *   Step 1: GitHub App installation
 *   Step 2: Repository selection / first repo configuration
 *   Step 3: Billing setup (trial or subscription)
 *   Step 4: Team creation (optional)
 *   Step 5: Completion / readiness check
 *
 * State is managed via Redis (for hosted mode) or in-memory (for OSS mode).
 *
 * @module onboarding/wizard
 */

import { config } from '../config.js';
import { rootLogger } from '../utils/logger.js';
import { auditRepository, type ActorType } from '../audit/repository.js';

const log = rootLogger.child({ module: 'onboarding-wizard' });

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type WizardStep =
  | 'github_install'
  | 'repo_selection'
  | 'billing_setup'
  | 'team_setup'
  | 'complete';

export type WizardState = 'not_started' | 'in_progress' | 'completed' | 'skipped';

export interface WizardProgress {
  tenantId: string;
  state: WizardState;
  currentStep: WizardStep;
  steps: {
    githubInstalled: boolean;
    repoSelected: boolean;
    billingSetup: boolean;
    teamSetup: boolean;
  };
  completedAt?: string;
  createdAt?: string;
  updatedAt?: string;
  metadata?: Record<string, unknown>;
}

export interface GitHubInstallationParams {
  installationId: number;
  accountLogin?: string;
  accountType?: 'user' | 'organization';
  reposGranted?: number;
}

export interface RepoSelectionParams {
  repoOwner: string;
  repoName: string;
  repoId?: number;
}

export interface BillingSetupParams {
  planId?: string;
  trialDays?: number;
  skipBilling?: boolean;
}

export interface TeamSetupParams {
  teamName?: string;
  skipTeam?: boolean;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const WIZARD_STEP_ORDER: WizardStep[] = [
  'github_install',
  'repo_selection',
  'billing_setup',
  'team_setup',
  'complete',
];

const STEP_TRANSITIONS: Record<WizardStep, WizardStep[]> = {
  github_install: ['repo_selection'],
  repo_selection: ['billing_setup'],
  billing_setup: ['team_setup', 'complete'],
  team_setup: ['complete'],
  complete: [],
};

// ---------------------------------------------------------------------------
// State store abstraction
// ---------------------------------------------------------------------------

interface WizardStateStore {
  get(tenantId: string): Promise<WizardProgress | undefined>;
  set(tenantId: string, progress: WizardProgress): Promise<void>;
  delete(tenantId: string): Promise<void>;
}

/**
 * In-memory store for OSS mode.
 */
class InMemoryWizardStore implements WizardStateStore {
  private store = new Map<string, WizardProgress>();

  async get(tenantId: string): Promise<WizardProgress | undefined> {
    return this.store.get(tenantId);
  }

  async set(tenantId: string, progress: WizardProgress): Promise<void> {
    this.store.set(tenantId, progress);
  }

  async delete(tenantId: string): Promise<void> {
    this.store.delete(tenantId);
  }
}

/**
 * Redis-backed store for hosted mode.
 */
class RedisWizardStore implements WizardStateStore {
  private redis: import('ioredis').Redis | null = null;
  private readonly prefix = 'stas:wizard:';
  private readonly ttlSeconds = 86400 * 7; // 7 days

  private async getClient(): Promise<import('ioredis').Redis> {
    if (!this.redis) {
      const IORedisModule = await import('ioredis');
      const RedisClass = IORedisModule.default || IORedisModule.Redis;
      this.redis = new (RedisClass as unknown as new (url: string, opts: Record<string, unknown>) => import('ioredis').Redis)(config.queue.redisUrl, {
        keyPrefix: this.prefix,
        maxRetriesPerRequest: 3,
        connectTimeout: 5000,
        lazyConnect: true,
      });
      await this.redis!.connect();
    }
    return this.redis!;
  }

  async get(tenantId: string): Promise<WizardProgress | undefined> {
    try {
      const client = await this.getClient();
      const data = await client.get(tenantId);
      return data ? (JSON.parse(data) as WizardProgress) : undefined;
    } catch (err) {
      log.error({ err: String(err), tenantId }, 'Failed to read wizard state from Redis');
      return undefined;
    }
  }

  async set(tenantId: string, progress: WizardProgress): Promise<void> {
    try {
      const client = await this.getClient();
      await client.setex(tenantId, this.ttlSeconds, JSON.stringify(progress));
    } catch (err) {
      log.error({ err: String(err), tenantId }, 'Failed to write wizard state to Redis');
    }
  }

  async delete(tenantId: string): Promise<void> {
    try {
      const client = await this.getClient();
      await client.del(tenantId);
    } catch (err) {
      log.error({ err: String(err), tenantId }, 'Failed to delete wizard state from Redis');
    }
  }
}

// ---------------------------------------------------------------------------
// Store singleton
// ---------------------------------------------------------------------------

let store: WizardStateStore = new InMemoryWizardStore();

/**
 * Initialize the wizard store. Call once at server startup.
 * In hosted mode, a Redis store is used. In OSS mode, in-memory.
 */
export function initWizardStore(): void {
  if (config.stas.mode === 'hosted') {
    store = new RedisWizardStore();
    log.info('Onboarding wizard using Redis store');
  } else {
    store = new InMemoryWizardStore();
    log.info('Onboarding wizard using in-memory store');
  }
}

// ---------------------------------------------------------------------------
// Helper: create default progress
// ---------------------------------------------------------------------------

function createProgress(tenantId: string): WizardProgress {
  return {
    tenantId,
    state: 'not_started',
    currentStep: 'github_install',
    steps: {
      githubInstalled: false,
      repoSelected: false,
      billingSetup: false,
      teamSetup: false,
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Wizard API
// ---------------------------------------------------------------------------

/**
 * Get the current wizard progress for a tenant.
 */
export async function getWizardProgress(tenantId: string): Promise<WizardProgress> {
  const existing = await store.get(tenantId);
  if (existing) return existing;

  // Return default state if no session exists
  const progress = createProgress(tenantId);
  await store.set(tenantId, progress);
  return progress;
}

/**
 * Start or reset the onboarding wizard for a tenant.
 */
export async function startWizard(tenantId: string): Promise<WizardProgress> {
  const progress = createProgress(tenantId);
  progress.state = 'in_progress';
  await store.set(tenantId, progress);

  await safeAuditLog({
    action: 'onboarding.wizard.started',
    details: { tenantId },
    correlationId: undefined,
  });

  log.info({ tenantId }, 'Onboarding wizard started');
  return progress;
}

/**
 * Record GitHub App installation completion.
 */
export async function recordGitHubInstallation(
  tenantId: string,
  params: GitHubInstallationParams,
): Promise<WizardProgress> {
  const progress = await getWizardProgress(tenantId);
  progress.steps.githubInstalled = true;
  progress.state = 'in_progress';
  progress.currentStep = 'repo_selection';
  progress.updatedAt = new Date().toISOString();
  progress.metadata = {
    ...progress.metadata,
    githubInstallationId: params.installationId,
    githubAccountLogin: params.accountLogin,
    githubAccountType: params.accountType,
    reposGranted: params.reposGranted,
  };

  await store.set(tenantId, progress);

  await safeAuditLog({
    action: 'onboarding.github.installed',
    details: { tenantId, installationId: params.installationId },
    correlationId: undefined,
  });

  log.info({ tenantId, installationId: params.installationId }, 'GitHub installation recorded in wizard');
  return progress;
}

/**
 * Record first repo configuration.
 */
export async function recordRepoSelection(
  tenantId: string,
  params: RepoSelectionParams,
): Promise<WizardProgress> {
  const progress = await getWizardProgress(tenantId);

  if (!progress.steps.githubInstalled) {
    throw new Error('GitHub App must be installed before selecting a repository');
  }

  progress.steps.repoSelected = true;
  progress.state = 'in_progress';
  progress.currentStep = 'billing_setup';
  progress.updatedAt = new Date().toISOString();
  progress.metadata = {
    ...progress.metadata,
    repoOwner: params.repoOwner,
    repoName: params.repoName,
    repoId: params.repoId,
  };

  await store.set(tenantId, progress);

  await safeAuditLog({
    action: 'onboarding.repo_selected',
    details: { tenantId, repoOwner: params.repoOwner, repoName: params.repoName },
    correlationId: undefined,
  });

  log.info({ tenantId, repoOwner: params.repoOwner, repoName: params.repoName }, 'Repository selected in wizard');
  return progress;
}

/**
 * Record billing setup.
 */
export async function recordBillingSetup(
  tenantId: string,
  params: BillingSetupParams,
): Promise<WizardProgress> {
  const progress = await getWizardProgress(tenantId);

  if (!progress.steps.repoSelected) {
    throw new Error('Repository must be selected before billing setup');
  }

  progress.steps.billingSetup = true;
  progress.state = 'in_progress';
  progress.currentStep = 'team_setup';
  progress.updatedAt = new Date().toISOString();
  progress.metadata = {
    ...progress.metadata,
    billingPlanId: params.planId,
    billingTrialDays: params.trialDays,
    billingSkipped: params.skipBilling ?? false,
  };

  await store.set(tenantId, progress);

  await safeAuditLog({
    action: params.skipBilling ? 'onboarding.billing.skipped' : 'onboarding.billing.setup',
    details: { tenantId, planId: params.planId, trialDays: params.trialDays },
    correlationId: undefined,
  });

  log.info({ tenantId, planId: params.planId, skipBilling: params.skipBilling }, 'Billing setup recorded in wizard');
  return progress;
}

/**
 * Record team setup.
 */
export async function recordTeamSetup(
  tenantId: string,
  params: TeamSetupParams,
): Promise<WizardProgress> {
  const progress = await getWizardProgress(tenantId);

  if (!progress.steps.billingSetup) {
    throw new Error('Billing must be set up before team setup');
  }

  progress.steps.teamSetup = params.skipTeam ? true : true;
  progress.state = 'completed';
  progress.currentStep = 'complete';
  progress.completedAt = new Date().toISOString();
  progress.updatedAt = new Date().toISOString();
  progress.metadata = {
    ...progress.metadata,
    teamName: params.teamName,
    teamSkipped: params.skipTeam ?? false,
  };

  await store.set(tenantId, progress);

  await safeAuditLog({
    action: params.skipTeam ? 'onboarding.team.skipped' : 'onboarding.team.setup',
    details: { tenantId, teamName: params.teamName },
    correlationId: undefined,
  });

  log.info({ tenantId, teamName: params.teamName, skipTeam: params.skipTeam }, 'Team setup recorded in wizard');
  return progress;
}

/**
 * Move the wizard to a specific step (admin use).
 */
export async function setWizardStep(
  tenantId: string,
  step: WizardStep,
): Promise<WizardProgress> {
  const progress = await getWizardProgress(tenantId);

  if (!WIZARD_STEP_ORDER.includes(step)) {
    throw new Error(`Invalid wizard step: ${step}`);
  }

  progress.currentStep = step;
  progress.updatedAt = new Date().toISOString();
  await store.set(tenantId, progress);

  log.info({ tenantId, step }, 'Wizard step updated');
  return progress;
}

/**
 * Reset the wizard for a tenant (start over).
 */
export async function resetWizard(tenantId: string): Promise<WizardProgress> {
  await store.delete(tenantId);
  const progress = await startWizard(tenantId);

  await safeAuditLog({
    action: 'onboarding.wizard.reset',
    details: { tenantId },
    correlationId: undefined,
  });

  log.info({ tenantId }, 'Onboarding wizard reset');
  return progress;
}

/**
 * Check if onboarding is complete for a tenant.
 */
export async function isOnboardingComplete(tenantId: string): Promise<boolean> {
  const progress = await getWizardProgress(tenantId);
  return progress.state === 'completed';
}

/**
 * Get the wizard configuration for UI rendering.
 */
export function getWizardConfig(): {
  enabled: boolean;
  requiredSteps: WizardStep[];
  githubAppUrl: string;
} {
  return {
    enabled: config.onboarding.wizardEnabled,
    requiredSteps: WIZARD_STEP_ORDER.filter((s) => s !== 'complete'),
    githubAppUrl: `https://github.com/apps/${config.github.appId}/installations/new`,
  };
}

/**
 * Get available transitions from the current step.
 */
export function getAvailableTransitions(currentStep: WizardStep): WizardStep[] {
  return STEP_TRANSITIONS[currentStep] ?? [];
}

// ---------------------------------------------------------------------------
// Audit helper
// ---------------------------------------------------------------------------

async function safeAuditLog(params: {
  action: string;
  details?: Record<string, unknown>;
  correlationId?: string;
}): Promise<void> {
  try {
    await auditRepository.insert({
      actorType: 'system' as ActorType,
      actorId: undefined,
      action: params.action,
      resourceType: 'onboarding',
      resourceId: undefined,
      details: params.details,
      correlationId: params.correlationId,
    });
  } catch (err) {
    log.error({ err: String(err), action: params.action }, 'Failed to write onboarding audit log');
  }
}
