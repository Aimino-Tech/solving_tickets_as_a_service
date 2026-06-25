export interface OnboardingState {
  tenantId: string;
  githubAppInstalled: boolean;
  linearOAuthCompleted: boolean;
  reposSelected: boolean;
  labelsConfigured: boolean;
  testIssueRun: boolean;
  currentStep: number;
  totalSteps: number;
  completedAt?: string;
  metadata?: Record<string, unknown>;
}

const STEPS = [
  "github_app_install",
  "linear_oauth",
  "repo_selection",
  "label_config",
  "test_issue",
  "complete",
] as const;

export type OnboardingStep = (typeof STEPS)[number];

export class OnboardingService {
  private states = new Map<string, OnboardingState>();

  getOrCreateState(tenantId: string): OnboardingState {
    const existing = this.states.get(tenantId);
    if (existing) {
      return existing;
    }
    const state: OnboardingState = {
      tenantId,
      githubAppInstalled: false,
      linearOAuthCompleted: false,
      reposSelected: false,
      labelsConfigured: false,
      testIssueRun: false,
      currentStep: 0,
      totalSteps: STEPS.length,
    };
    this.states.set(tenantId, state);
    return state;
  }

  getState(tenantId: string): OnboardingState | null {
    return this.states.get(tenantId) ?? null;
  }

  updateStep(tenantId: string, step: Partial<OnboardingState>): OnboardingState {
    const state = this.getOrCreateState(tenantId);
    Object.assign(state, step);
    this.states.set(tenantId, state);
    return state;
  }

  markStepCompleted(tenantId: string, stepName: string): OnboardingState {
    const state = this.getOrCreateState(tenantId);
    const stepIndex = STEPS.indexOf(stepName as OnboardingStep);
    if (stepIndex >= 0) {
      state.currentStep = Math.max(state.currentStep, stepIndex + 1);
    }
    switch (stepName) {
      case "github_app_install":
        state.githubAppInstalled = true;
        break;
      case "linear_oauth":
        state.linearOAuthCompleted = true;
        break;
      case "repo_selection":
        state.reposSelected = true;
        break;
      case "label_config":
        state.labelsConfigured = true;
        break;
      case "test_issue":
        state.testIssueRun = true;
        break;
      case "complete":
        state.completedAt = new Date().toISOString();
        break;
    }
    this.states.set(tenantId, state);
    return state;
  }

  isComplete(tenantId: string): boolean {
    const state = this.states.get(tenantId);
    return state?.completedAt != null;
  }

  getCurrentStep(tenantId: string): OnboardingStep {
    const state = this.states.get(tenantId);
    if (!state) {
      return STEPS[0];
    }
    return STEPS[Math.min(state.currentStep, STEPS.length - 1)];
  }

  getNextStep(tenantId: string): OnboardingStep | null {
    const currentStep = this.getCurrentStep(tenantId);
    const currentIndex = STEPS.indexOf(currentStep);
    if (currentIndex < STEPS.length - 1) {
      return STEPS[currentIndex + 1];
    }
    return null;
  }
}

export const onboardingService = new OnboardingService();
