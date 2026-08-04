import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '@/__tests__/test-utils';
import GitHubInstall from '@/pages/onboarding/steps/GitHubInstall';
import type { WizardProgress } from '@/api/client';

const mockListInstallations = vi.hoisted(() => vi.fn());
const mockCompleteStep = vi.hoisted(() => vi.fn());
const mockGetStatus = vi.hoisted(() => vi.fn());
const mockRequest = vi.hoisted(() => vi.fn());

vi.mock('@/api/client', () => ({
  github: { listInstallations: mockListInstallations },
  onboarding: { completeStep: mockCompleteStep, getStatus: mockGetStatus },
  request: mockRequest,
}));

const progress: WizardProgress = {
  tenantId: 'tenant-1',
  state: 'in_progress',
  currentStep: 'github-install',
  steps: { githubInstalled: false, repoSelected: false, billingSetup: false, teamSetup: false },
};

function renderStep() {
  const onComplete = vi.fn();
  const onSkip = vi.fn();
  renderWithProviders(<GitHubInstall progress={progress} onComplete={onComplete} onSkip={onSkip} />);
  return { onComplete, onSkip };
}

describe('GitHubInstall', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetStatus.mockResolvedValue({
      progress: {},
      config: { enabled: true, requiredSteps: [], githubAppUrl: '' },
    });
    mockCompleteStep.mockResolvedValue({ success: true, progress: { currentStep: 'repo-selection' } });
  });

  it('completes the step with the first installation mapped to the backend schema', async () => {
    mockListInstallations.mockResolvedValue({
      installations: [{ installationId: 123, accountLogin: 'octocat', accountType: 'User' }],
    });
    const { onComplete } = renderStep();
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Continue' }));

    await waitFor(() => {
      expect(mockCompleteStep).toHaveBeenCalledWith('github-install', {
        installationId: 123,
        accountLogin: 'octocat',
        accountType: 'user',
      });
    });
    expect(onComplete).toHaveBeenCalledWith({ currentStep: 'repo-selection' });
  });

  it('shows an install hint instead of failing silently when no installations exist', async () => {
    mockListInstallations.mockResolvedValue({ installations: [] });
    renderStep();
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Continue' }));

    expect(await screen.findByText(/Install the SYNTARO GitHub App first/)).toBeInTheDocument();
    expect(mockCompleteStep).not.toHaveBeenCalled();
  });

  it('uses config.githubAppUrl for the install link when available', async () => {
    mockGetStatus.mockResolvedValue({
      progress: {},
      config: {
        enabled: true,
        requiredSteps: [],
        githubAppUrl: 'https://github.com/apps/custom-app/installations/new',
      },
    });
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(null);
    renderStep();
    const user = userEvent.setup();

    await act(async () => {});
    await user.click(screen.getByRole('button', { name: 'Install SYNTARO App' }));

    expect(openSpy).toHaveBeenCalledWith('https://github.com/apps/custom-app/installations/new', '_blank');
    openSpy.mockRestore();
  });

  it('falls back to the hardcoded install URL when the config fetch fails', async () => {
    mockGetStatus.mockRejectedValue(new Error('network'));
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(null);
    renderStep();
    const user = userEvent.setup();

    await act(async () => {});
    await user.click(screen.getByRole('button', { name: 'Install SYNTARO App' }));

    expect(openSpy).toHaveBeenCalledWith('https://github.com/apps/syntaro-bot/installations/new', '_blank');
    openSpy.mockRestore();
  });
});
