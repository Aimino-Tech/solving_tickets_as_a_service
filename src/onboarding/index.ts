/**
 * Onboarding module barrel export.
 *
 * Exports all onboarding-related services, types, and routes.
 */

export {
  OnboardingStateMachine,
  onboardingStateMachine,
  InvalidTransitionError,
  ONBOARDING_STATES,
} from './state-machine.js';
export type {
  OnboardingState,
  OnboardingProgressData,
  OnboardingRecord,
} from './state-machine.js';

export {
  OnboardingRepoConfig,
  onboardingRepoConfig,
} from './config.js';
export type {
  RepoConfig,
  TenantRepoRow,
} from './config.js';

export {
  triggerTestRun,
} from './test-run.js';
export type {
  TestRunResult,
} from './test-run.js';

export { onboardingRouter } from './routes.js';
