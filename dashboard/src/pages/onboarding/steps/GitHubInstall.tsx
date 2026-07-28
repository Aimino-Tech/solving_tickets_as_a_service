import { useState, useRef, useEffect } from 'react';
import { request, onboarding } from '@/api/client';

interface Props {
  progress: any;
  onComplete: (progress: any) => void;
  onSkip: () => void;
}

export default function GitHubInstall({ progress, onComplete, onSkip }: Props) {
  const [installing, setInstalling] = useState(false);
  const [githubToken, setGithubToken] = useState<string | null>(null);
  const messageHandlerRef = useRef<((event: MessageEvent) => void) | null>(null);

  async function handleGithubLogin() {
    try {
      const data = await request<{ url: string }>('/v1/github/login');
      const popup = window.open(data.url, 'github-oauth', 'width=800,height=700');

      const handler = (event: MessageEvent) => {
        if (event.origin !== window.location.origin) return;
        if (event.data.type === 'github-oauth-callback') {
          setGithubToken(event.data.accessToken);
          sessionStorage.setItem('github_oauth', JSON.stringify(event.data));
        }
      };

      window.addEventListener('message', handler);
      messageHandlerRef.current = handler;
    } catch {}
  }

  useEffect(() => {
    return () => {
      if (messageHandlerRef.current) {
        window.removeEventListener('message', messageHandlerRef.current);
        messageHandlerRef.current = null;
      }
    };
  }, []);

  async function handleInstallComplete() {
    setInstalling(true);
    try {
      const result = await onboarding.completeStep('github-install', { githubToken });
      onComplete(result.progress);
    } catch {
      setInstalling(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-900">Connect Your GitHub Account</h2>
        <p className="mt-2 text-gray-500">
          STAS needs access to your GitHub repositories so it can fix issues and open pull requests.
        </p>
      </div>

      <div className="rounded-lg border border-gray-200 bg-gray-50 p-6">
        <h3 className="text-lg font-semibold text-gray-900">Step 1: Authorize with GitHub</h3>
        <p className="mt-1 text-sm text-gray-500">
          Click the button below to sign in with your GitHub account.
        </p>
        {!githubToken ? (
          <button onClick={handleGithubLogin} className="btn-primary mt-4 inline-flex items-center gap-2">
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
            </svg>
            Sign in with GitHub
          </button>
        ) : (
          <p className="mt-4 text-sm text-green-600 font-medium">GitHub account connected</p>
        )}
      </div>

      <div className="rounded-lg border border-gray-200 bg-gray-50 p-6">
        <h3 className="text-lg font-semibold text-gray-900">Step 2: Install the STAS GitHub App</h3>
        <p className="mt-1 text-sm text-gray-500">
          Install the STAS GitHub App on your repositories to enable automated fixes.
        </p>
        <button
          onClick={() => window.open('https://github.com/apps/stas-bot/installations/new', '_blank')}
          className="btn-secondary mt-4"
        >
          Install STAS App
        </button>
      </div>

      <div className="flex items-center justify-between pt-4">
        <button onClick={onSkip} className="text-sm text-gray-400 hover:text-gray-600">Skip this step</button>
        <button onClick={handleInstallComplete} disabled={installing} className="btn-primary">
          {installing ? 'Continuing...' : 'Continue'}
        </button>
      </div>
    </div>
  );
}
