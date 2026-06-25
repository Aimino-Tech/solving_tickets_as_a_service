import { useState, useEffect, useCallback } from 'react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ChecklistItem {
  state: string;
  label: string;
  completed: boolean;
  current: boolean;
}

interface OnboardingStatus {
  tenantId: string;
  onboarded: boolean;
  state: string;
  currentStep: string | null;
  nextStep: string | null;
  progressData: Record<string, unknown>;
  checklist: ChecklistItem[];
}

// ---------------------------------------------------------------------------
// API helper
// ---------------------------------------------------------------------------

const API_BASE = '/api/onboarding';

async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error || `Request failed: ${res.status}`);
  }
  return res.json() as Promise<T>;
}

async function apiPost<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error || `Request failed: ${res.status}`);
  }
  return res.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getTenantId(): string {
  return localStorage.getItem('stas_tenant_id') ?? new URLSearchParams(window.location.search).get('tenantId') ?? 'demo';
}

function getGitHubAppUrl(): string {
  return window.__ENV__?.GITHUB_APP_URL ?? 'https://github.com/apps/stas-bot/installations/new';
}

function getLinearLoginUrl(): string {
  const tenantId = getTenantId();
  return `/auth/linear/login?tenantId=${encodeURIComponent(tenantId)}`;
}

// Extend window type for env vars
declare global {
  interface Window {
    __ENV__?: Record<string, string>;
  }
}

// ---------------------------------------------------------------------------
// Step Components
// ---------------------------------------------------------------------------

function StepIndicator({ current, total }: { current: number; total: number }) {
  return (
    <div className="flex items-center gap-2">
      {Array.from({ length: total }, (_, i) => (
        <div
          key={i}
          className={`h-2 flex-1 rounded-full transition-colors ${
            i <= current ? 'bg-brand-600' : 'bg-gray-200'
          }`}
        />
      ))}
    </div>
  );
}

function StepCard({
  stepNumber,
  title,
  description,
  isActive,
  isCompleted,
  children,
}: {
  stepNumber: number;
  title: string;
  description: string;
  isActive: boolean;
  isCompleted: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className={`rounded-xl border p-6 transition-all ${
        isActive
          ? 'border-brand-300 bg-brand-50 shadow-sm'
          : isCompleted
          ? 'border-green-200 bg-green-50'
          : 'border-gray-200 bg-gray-50 opacity-60'
      }`}
    >
      <div className="flex items-start gap-4">
        <div
          className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-sm font-bold ${
            isCompleted
              ? 'bg-green-500 text-white'
              : isActive
              ? 'bg-brand-600 text-white'
              : 'bg-gray-300 text-gray-600'
          }`}
        >
          {isCompleted ? '✓' : stepNumber}
        </div>
        <div className="flex-1">
          <h3 className="text-base font-semibold text-gray-900">{title}</h3>
          <p className="mt-1 text-sm text-gray-500">{description}</p>
          {isActive && <div className="mt-4">{children}</div>}
          {isCompleted && !isActive && (
            <p className="mt-2 text-sm font-medium text-green-600">Completed</p>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export default function OnboardingWizard() {
  const [status, setStatus] = useState<OnboardingStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [githubInstalling, setGitHubInstalling] = useState(false);
  const [selectedRepos, setSelectedRepos] = useState<Array<{ owner: string; name: string }>>([]);
  const [testResult, setTestResult] = useState<{ issueUrl: string; issueNumber: number } | null>(null);
  const [testError, setTestError] = useState<string | null>(null);

  const tenantId = getTenantId();

  const fetchStatus = useCallback(async () => {
    try {
      const data = await apiGet<OnboardingStatus>(`/status?tenantId=${encodeURIComponent(tenantId)}`);
      setStatus(data);
      return data;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load status');
      return null;
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  // Poll status every 5 seconds
  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 5000);
    return () => clearInterval(interval);
  }, [fetchStatus]);

  // Handle query params on mount
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('linear') === 'connected') {
      // Linear OAuth completed — refresh status
      fetchStatus();
      // Clean up URL
      window.history.replaceState({}, '', '/onboarding');
    }
  }, [fetchStatus]);

  async function handleGitHubInstall() {
    setGitHubInstalling(true);
    try {
      // Acknowledge the GitHub installation
      await apiPost('/step/github', {
        tenantId,
        installationId: Number(tenantId),
        accountLogin: 'pending',
      });
      await fetchStatus();
      // Open GitHub App installation page
      window.open(getGitHubAppUrl(), '_blank');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to register GitHub installation');
    } finally {
      setGitHubInstalling(false);
    }
  }

  async function handleLinearConnect() {
    window.location.href = getLinearLoginUrl();
  }

  async function handleSaveRepos() {
    if (selectedRepos.length === 0) {
      setError('Please select at least one repository.');
      return;
    }

    setActionLoading('repos');
    try {
      await apiPost('/step/repos', {
        tenantId,
        repos: selectedRepos.map((r) => ({
          owner: r.owner,
          name: r.name,
          installationId: Number(tenantId),
        })),
      });
      await fetchStatus();

      // Also update labels
      await apiPost('/step/labels', {
        tenantId,
        labels: selectedRepos.map((r) => ({
          owner: r.owner,
          name: r.name,
          labels: ['stas:fix'],
        })),
      });
      await fetchStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save repositories');
    } finally {
      setActionLoading(null);
    }
  }

  async function handleTestRun() {
    if (selectedRepos.length === 0) {
      setError('Please select at least one repository first.');
      return;
    }

    setActionLoading('test-run');
    setTestError(null);
    setTestResult(null);

    const targetRepo = selectedRepos[0];
    try {
      const result = await apiPost<{
        success: boolean;
        issueUrl: string;
        issueNumber: number;
      }>('/step/test-run', {
        tenantId,
        owner: targetRepo.owner,
        repo: targetRepo.name,
      });
      setTestResult({ issueUrl: result.issueUrl, issueNumber: result.issueNumber });
      await fetchStatus();
    } catch (err) {
      setTestError(err instanceof Error ? err.message : 'Failed to create test issue');
    } finally {
      setActionLoading(null);
    }
  }

  async function handleComplete() {
    setActionLoading('complete');
    try {
      await apiPost('/step/complete', { tenantId });
      await fetchStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to complete onboarding');
    } finally {
      setActionLoading(null);
    }
  }

  // Compute current step index
  const STATES = ['not_started', 'github_installed', 'linear_connected', 'repos_configured', 'labels_set', 'test_run', 'completed'];
  const currentStepIndex = status ? STATES.indexOf(status.state) : 0;

  // ---------- Loading ----------
  if (loading) {
    return (
      <div className="mx-auto max-w-2xl space-y-4 p-8">
        <div className="card animate-pulse space-y-4">
          <div className="h-8 w-64 rounded bg-gray-200" />
          <div className="h-4 w-96 rounded bg-gray-200" />
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-24 rounded bg-gray-200" />
          ))}
        </div>
      </div>
    );
  }

  // ---------- Completed ----------
  if (status?.onboarded) {
    return (
      <div className="mx-auto max-w-2xl p-8">
        <div className="card text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-green-100">
            <svg className="h-8 w-8 text-green-600" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
            </svg>
          </div>
          <h2 className="mt-4 text-2xl font-bold text-gray-900">Onboarding Complete!</h2>
          <p className="mt-2 text-gray-500">
            STAS is now ready to process issues in your repositories.
            Label an issue with <code className="rounded bg-gray-100 px-2 py-0.5 text-sm font-mono text-brand-700">stas:fix</code> to get started.
          </p>
          <div className="mt-6 flex justify-center gap-4">
            <a href="/" className="btn-primary">Go to Dashboard</a>
            <a href="/settings" className="btn-secondary">Configure Settings</a>
          </div>
        </div>
      </div>
    );
  }

  // ---------- Error State ----------
  if (error && !status) {
    return (
      <div className="mx-auto max-w-2xl p-8">
        <div className="card text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-red-100">
            <svg className="h-8 w-8 text-red-600" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
            </svg>
          </div>
          <h2 className="mt-4 text-xl font-bold text-gray-900">Something went wrong</h2>
          <p className="mt-2 text-sm text-red-600">{error}</p>
          <button onClick={fetchStatus} className="btn-primary mt-4">
            Try Again
          </button>
        </div>
      </div>
    );
  }

  // ---------- Main Wizard ----------
  return (
    <div className="mx-auto max-w-2xl p-8">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Set up STAS</h1>
        <p className="mt-1 text-sm text-gray-500">
          Follow these steps to configure STAS for your repositories.
        </p>
        <div className="mt-4">
          <StepIndicator current={currentStepIndex} total={STATES.length - 1} />
        </div>
      </div>

      {error && (
        <div className="mb-6 rounded-lg border border-red-200 bg-red-50 p-4">
          <p className="text-sm text-red-700">{error}</p>
          <button
            onClick={() => setError(null)}
            className="mt-1 text-xs font-medium text-red-600 hover:text-red-800"
          >
            Dismiss
          </button>
        </div>
      )}

      <div className="space-y-4">
        {/* Step 1: Install GitHub App */}
        <StepCard
          stepNumber={1}
          title="Install the GitHub App"
          description="Install the STAS GitHub App on your repositories to allow us to create issues and pull requests."
          isActive={currentStepIndex === 0 || currentStepIndex === 1}
          isCompleted={currentStepIndex > 1}
        >
          <p className="text-sm text-gray-600">
            Click the button below to install the STAS GitHub App on your account or organization.
            You can select specific repositories or grant access to all repositories.
          </p>
          <button
            onClick={handleGitHubInstall}
            disabled={githubInstalling}
            className="btn-primary mt-3"
          >
            {githubInstalling ? 'Registering...' : 'Install GitHub App'}
          </button>
          {currentStepIndex >= 1 && (
            <p className="mt-2 text-sm font-medium text-green-600">
              ✓ GitHub App installed
            </p>
          )}
        </StepCard>

        {/* Step 2: Connect Linear */}
        <StepCard
          stepNumber={2}
          title="Connect Linear (Optional)"
          description="Connect your Linear workspace to sync issues between GitHub and Linear."
          isActive={currentStepIndex === 2}
          isCompleted={currentStepIndex > 2}
        >
          <p className="text-sm text-gray-600">
            Connecting Linear allows STAS to create and sync issues between GitHub and Linear.
            This step is optional — you can skip it and configure it later.
          </p>
          <div className="mt-3 flex gap-3">
            <button onClick={handleLinearConnect} className="btn-primary">
              Connect Linear
            </button>
            <button
              onClick={async () => {
                setActionLoading('linear-skip');
                try {
                  await apiPost('/step/linear', { tenantId });
                  await fetchStatus();
                } catch (err) {
                  setError(err instanceof Error ? err.message : 'Failed to skip');
                } finally {
                  setActionLoading(null);
                }
              }}
              disabled={actionLoading === 'linear-skip'}
              className="btn-secondary"
            >
              {actionLoading === 'linear-skip' ? 'Skipping...' : 'Skip'}
            </button>
          </div>
        </StepCard>

        {/* Step 3: Select Repos */}
        <StepCard
          stepNumber={3}
          title="Select Repositories"
          description="Choose which repositories STAS should monitor for labeled issues."
          isActive={currentStepIndex >= 3 && currentStepIndex < 5}
          isCompleted={currentStepIndex >= 5}
        >
          <div className="space-y-3">
            <p className="text-sm text-gray-600">
              Enter the repositories you want STAS to monitor. Use the format <code className="text-xs">owner/repo</code>.
            </p>
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="e.g. my-org/my-repo"
                className="input-field flex-1"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    const input = e.currentTarget;
                    const value = input.value.trim();
                    if (value && value.includes('/')) {
                      const [owner, name] = value.split('/');
                      if (!selectedRepos.find((r) => r.owner === owner && r.name === name)) {
                        setSelectedRepos([...selectedRepos, { owner, name }]);
                      }
                      input.value = '';
                    }
                  }
                }}
              />
            </div>
            {selectedRepos.length > 0 && (
              <div className="space-y-2">
                {selectedRepos.map((repo) => (
                  <div
                    key={`${repo.owner}/${repo.name}`}
                    className="flex items-center justify-between rounded-lg border border-gray-200 bg-white px-3 py-2"
                  >
                    <span className="text-sm font-medium text-gray-700">
                      {repo.owner}/{repo.name}
                    </span>
                    <button
                      onClick={() => setSelectedRepos(selectedRepos.filter((r) => r !== repo))}
                      className="text-sm text-red-500 hover:text-red-700"
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            )}
            <button
              onClick={handleSaveRepos}
              disabled={actionLoading === 'repos' || selectedRepos.length === 0}
              className="btn-primary"
            >
              {actionLoading === 'repos' ? 'Saving...' : 'Save Repositories'}
            </button>
          </div>
        </StepCard>

        {/* Step 4: Test Run */}
        <StepCard
          stepNumber={4}
          title="Run a Test Issue"
          description="Verify that STAS is working by creating a test issue with the trigger label."
          isActive={currentStepIndex >= 5 && currentStepIndex < 6}
          isCompleted={currentStepIndex >= 6}
        >
          <div className="space-y-3">
            <p className="text-sm text-gray-600">
              STAS will create a test issue in <strong>{selectedRepos[0]?.owner}/{selectedRepos[0]?.name ?? 'your repository'}</strong>{' '}
              with the <code className="text-xs">stas:fix</code> label and verify the pipeline.
            </p>

            {testResult && (
              <div className="rounded-lg border border-green-200 bg-green-50 p-4">
                <p className="text-sm font-medium text-green-800">
                  ✓ Test issue #{testResult.issueNumber} created
                </p>
                <a
                  href={testResult.issueUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-1 inline-block text-sm font-medium text-brand-600 hover:text-brand-800"
                >
                  View issue on GitHub →
                </a>
              </div>
            )}

            {testError && (
              <div className="rounded-lg border border-red-200 bg-red-50 p-4">
                <p className="text-sm text-red-700">{testError}</p>
              </div>
            )}

            <div className="flex gap-3">
              <button
                onClick={handleTestRun}
                disabled={actionLoading === 'test-run' || selectedRepos.length === 0}
                className="btn-primary"
              >
                {actionLoading === 'test-run' ? 'Creating...' : 'Create Test Issue'}
              </button>
              {testResult && (
                <button
                  onClick={handleComplete}
                  disabled={actionLoading === 'complete'}
                  className="btn-primary"
                >
                  {actionLoading === 'complete' ? 'Completing...' : 'Finish Setup'}
                </button>
              )}
            </div>
          </div>
        </StepCard>
      </div>

      {/* Checklist sidebar */}
      {status?.checklist && status.checklist.length > 0 && (
        <div className="mt-8 rounded-xl border border-gray-200 bg-white p-6">
          <h3 className="text-sm font-semibold text-gray-900">Progress Checklist</h3>
          <ul className="mt-3 space-y-2">
            {status.checklist.map((item) => (
              <li key={item.state} className="flex items-center gap-3">
                <div
                  className={`flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full ${
                    item.completed
                      ? 'bg-green-500'
                      : item.current
                      ? 'border-2 border-brand-500'
                      : 'border-2 border-gray-300'
                  }`}
                >
                  {item.completed && (
                    <svg className="h-3 w-3 text-white" fill="none" viewBox="0 0 24 24" strokeWidth={3} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                    </svg>
                  )}
                </div>
                <span
                  className={`text-sm ${
                    item.completed
                      ? 'text-gray-500 line-through'
                      : item.current
                      ? 'font-medium text-brand-700'
                      : 'text-gray-400'
                  }`}
                >
                  {item.label}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
