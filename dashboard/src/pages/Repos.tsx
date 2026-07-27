import { useState, useEffect } from 'react';
import { request } from '@/api/client';
import { formatRelativeTime } from '@/utils/format';

interface GitHubRepo {
  id: number;
  owner: string;
  name: string;
  fullName: string;
  private: boolean;
  stasInstalled: boolean;
  webhookId: number | null;
}

interface Installation {
  id: number;
  accountLogin: string;
  accountType: string;
  avatarUrl: string | null;
}

export default function Repos() {
  const [repoList, setRepoList] = useState<GitHubRepo[]>([]);
  const [installations, setInstallations] = useState<Installation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [githubToken, setGithubToken] = useState<string | null>(null);
  const [githubLogin, setGithubLogin] = useState<string | null>(null);
  const [enabling, setEnabling] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const stored = sessionStorage.getItem('github_oauth');
    if (stored) {
      try {
        const data = JSON.parse(stored);
        setGithubToken(data.accessToken);
        setGithubLogin(data.githubLogin);
      } catch {}
    }
    loadData();
  }, []);

  async function loadData() {
    setLoading(true);
    setError(null);
    try {
      const [reposRes, installsRes] = await Promise.allSettled([
        request<{ data: GitHubRepo[] }>('/v1/github/repos'),
        request<{ installations: Installation[] }>('/v1/github/installations'),
      ]);
      if (reposRes.status === 'fulfilled') setRepoList(reposRes.value.data);
      if (installsRes.status === 'fulfilled') setInstallations(installsRes.value.installations);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load data');
    } finally {
      setLoading(false);
    }
  }

  async function handleGithubLogin() {
    try {
      const data = await request<{ url: string }>('/v1/github/login');
      const popup = window.open(data.url, 'github-oauth', 'width=800,height=700');

      const handler = (event: MessageEvent) => {
        if (event.origin !== window.location.origin) return;
        if (event.data.type === 'github-oauth-callback') {
          window.removeEventListener('message', handler);
          setGithubToken(event.data.accessToken);
          setGithubLogin(event.data.githubLogin);
          sessionStorage.setItem('github_oauth', JSON.stringify(event.data));
          loadData();
        }
      };
      window.addEventListener('message', handler);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start GitHub OAuth');
    }
  }

  async function handleToggleWebhook(repo: GitHubRepo) {
    const key = `${repo.owner}/${repo.name}`;
    setEnabling((prev) => ({ ...prev, [key]: true }));
    try {
      if (repo.stasInstalled) {
        await request(`/v1/github/repos/${repo.owner}/${repo.name}/webhook`, { method: 'DELETE' });
      } else {
        const installation = installations[0];
        if (!installation) {
          setError('No GitHub App installation found. Please install the STAS GitHub App first.');
          return;
        }
        await request(`/v1/github/repos/${repo.owner}/${repo.name}/webhook`, {
          method: 'POST',
          body: JSON.stringify({ installationId: installation.id }),
        });
      }
      loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to toggle webhook');
    } finally {
      setEnabling((prev) => ({ ...prev, [key]: false }));
    }
  }

  async function handleDisconnectInstallation(installationId: number) {
    if (!confirm('Remove this GitHub App installation? Webhooks will be disabled.')) return;
    try {
      await request(`/v1/github/installations/${installationId}`, { method: 'DELETE' });
      loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove installation');
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">GitHub Repositories</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {githubLogin ? `Connected as ${githubLogin}` : 'Connect your GitHub account to manage repositories'}
          </p>
        </div>
        {!githubToken ? (
          <button onClick={handleGithubLogin} className="btn-primary inline-flex items-center gap-2">
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
            </svg>
            Connect GitHub
          </button>
        ) : (
          <div className="flex items-center gap-2">
            <span className="text-sm text-green-600 dark:text-green-400">GitHub connected</span>
            <button
              onClick={() => {
                sessionStorage.removeItem('github_oauth');
                setGithubToken(null);
                setGithubLogin(null);
              }}
              className="btn-secondary text-xs"
            >
              Disconnect
            </button>
          </div>
        )}
      </div>

      {error && (
        <div className="card">
          <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
          <button onClick={loadData} className="mt-2 text-sm font-medium text-brand-600 min-h-[44px]">Retry</button>
        </div>
      )}

      {installations.length > 0 && (
        <div className="card">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-3">GitHub App Installations</h3>
          <div className="space-y-2">
            {installations.map((inst) => (
              <div key={inst.id} className="flex items-center justify-between rounded-lg border border-gray-200 dark:border-gray-700 p-3">
                <div className="flex items-center gap-3">
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-100 dark:bg-gray-700 text-xs font-bold text-gray-600">
                    {inst.accountLogin.charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{inst.accountLogin}</p>
                    <p className="text-xs text-gray-500">{inst.accountType} · Installation #{inst.id}</p>
                  </div>
                </div>
                <button
                  onClick={() => handleDisconnectInstallation(inst.id)}
                  className="btn-danger text-xs"
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {loading ? (
        <div className="space-y-3">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="card animate-pulse">
              <div className="h-5 w-48 rounded bg-gray-200 dark:bg-gray-700" />
            </div>
          ))}
        </div>
      ) : !githubToken ? (
        <div className="card text-center py-12">
          <p className="text-gray-500 dark:text-gray-400">Connect your GitHub account to see repositories.</p>
        </div>
      ) : repoList.length === 0 ? (
        <div className="card text-center py-12">
          <p className="text-gray-500 dark:text-gray-400">No GitHub repositories found.</p>
          <p className="mt-1 text-sm text-gray-400">Install the STAS GitHub App to see your repos here.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {repoList.map((repo) => {
            const key = `${repo.owner}/${repo.name}`;
            return (
              <div key={repo.id} className="card flex flex-col justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <span className={`inline-block h-2.5 w-2.5 rounded-full ${repo.stasInstalled ? 'bg-green-500' : 'bg-gray-300 dark:bg-gray-600'}`} />
                    <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">{key}</h3>
                  </div>
                  <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                    {repo.private ? 'Private' : 'Public'} · {repo.webhookId ? 'Webhook active' : 'No webhook'}
                  </p>
                </div>
                <div className="mt-3 flex items-center justify-between">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <span className="text-xs text-gray-600 dark:text-gray-400">STAS enabled</span>
                    <input
                      type="checkbox"
                      checked={repo.stasInstalled}
                      onChange={() => handleToggleWebhook(repo)}
                      disabled={enabling[key]}
                      className="h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500"
                    />
                  </label>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
