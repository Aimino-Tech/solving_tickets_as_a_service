import { useState, useEffect } from 'react';
import { repos, github, type GitHubInstallation } from '@/api/client';
import type { Repo } from '@/api/types';
import { formatRelativeTime } from '@/utils/format';

export default function Repos() {
  const [repoList, setRepoList] = useState<Repo[]>([]);
  const [installations, setInstallations] = useState<GitHubInstallation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<{ connected: boolean; githubLogin?: string }>({ connected: false });
  const [showInstallations, setShowInstallations] = useState(false);
  const [togglingRepo, setTogglingRepo] = useState<string | null>(null);

  async function loadAll(signal?: AbortSignal) {
    setLoading(true);
    setError(null);
    try {
      const [status, repoData] = await Promise.all([
        github.getStatus({ signal }).catch(() => ({ connected: false })),
        repos.list({ signal }).catch(() => [] as (Repo & { createdAt: string })[]),
      ]);
      setConnectionStatus(status);
      setRepoList(repoData);

      if (status.connected) {
        const instData = await github.listInstallations({ signal }).catch(() => ({ installations: [] }));
        setInstallations(instData.installations);
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        setError(err instanceof Error ? err.message : 'Failed to load data');
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const ac = new AbortController();
    loadAll(ac.signal);
    return () => ac.abort();
  }, []);

  const urlParams = new URLSearchParams(window.location.search);
  const oauthCode = urlParams.get('code');
  useEffect(() => {
    if (oauthCode) {
      const ac = new AbortController();
      github.handleCallback(oauthCode, { signal: ac.signal }).then(() => {
        window.history.replaceState({}, '', window.location.pathname);
        loadAll(ac.signal);
      }).catch((err) => {
        if (err.name !== 'AbortError') {
          setError(err instanceof Error ? err.message : 'Failed to complete OAuth');
        }
        window.history.replaceState({}, '', window.location.pathname);
      });
      return () => ac.abort();
    }
  }, [oauthCode]);

  async function handleConnectGitHub() {
    try {
      const { url } = await github.getOAuthUrl();
      window.location.href = url;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to get OAuth URL');
    }
  }

  async function handleDisconnectGitHub() {
    if (!confirm('Disconnect GitHub account? This will remove all connected repos.')) return;
    try {
      await github.disconnect();
      setConnectionStatus({ connected: false });
      setInstallations([]);
      setRepoList([]);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to disconnect');
    }
  }

  async function handleToggleRepo(installationId: number, owner: string, repo: string, current: boolean) {
    const key = `${owner}/${repo}`;
    setTogglingRepo(key);
    try {
      if (current) {
        await github.removeWebhook(installationId, owner, repo);
      } else {
        await github.configureWebhook(installationId, owner, repo);
      }
      const instData = await github.listInstallations();
      setInstallations(instData.installations);
    } catch (err) {
      alert(err instanceof Error ? err.message : `Failed to ${current ? 'remove' : 'configure'} webhook`);
    } finally {
      setTogglingRepo(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">GitHub Repositories</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {connectionStatus.connected
              ? `Connected as ${connectionStatus.githubLogin}`
              : 'Connect your GitHub account to enable STAS'}
          </p>
        </div>
        {connectionStatus.connected ? (
          <button onClick={handleDisconnectGitHub} className="btn-danger text-sm">
            Disconnect GitHub
          </button>
        ) : (
          <button onClick={handleConnectGitHub} className="btn-primary">
            Connect GitHub
          </button>
        )}
      </div>

      {error && (
        <div className="card border-red-200 dark:border-red-800">
          <p className="text-red-600 dark:text-red-400">{error}</p>
          <button onClick={loadAll} className="mt-2 text-sm font-medium text-brand-600 dark:text-brand-400 min-h-[44px] min-w-[44px]">
            Retry
          </button>
        </div>
      )}

      {loading ? (
        <div className="space-y-3">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="card animate-pulse">
              <div className="h-5 w-48 rounded bg-gray-200 dark:bg-gray-700" />
              <div className="mt-2 h-4 w-32 rounded bg-gray-200 dark:bg-gray-700" />
            </div>
          ))}
        </div>
      ) : connectionStatus.connected ? (
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">
              GitHub Installations & Repos
            </h3>
            <button
              onClick={() => setShowInstallations(!showInstallations)}
              className="text-sm text-brand-600 dark:text-brand-400 min-h-[44px] min-w-[44px]"
            >
              {showInstallations ? 'Hide repos' : 'Show all repos'}
            </button>
          </div>

          {installations.length === 0 ? (
            <div className="card text-center py-12">
              <p className="text-gray-500 dark:text-gray-400">No GitHub App installations found.</p>
              <p className="mt-1 text-sm text-gray-400 dark:text-gray-500">
                Install the STAS GitHub App on your repositories to get started.
              </p>
              <a
                href={`https://github.com/apps/${import.meta.env.VITE_GITHUB_APP_NAME || 'stas-bot'}/installations/new`}
                target="_blank"
                rel="noopener noreferrer"
                className="btn-primary mt-4 inline-block"
              >
                Install GitHub App
              </a>
            </div>
          ) : (
            installations.map((inst) => (
              <div key={inst.installationId} className="card">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <h4 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                      {inst.accountLogin}
                      <span className="ml-2 text-xs text-gray-400">({inst.accountType})</span>
                    </h4>
                    <p className="text-xs text-gray-500">
                      Installation #{inst.installationId} &middot; {inst.repoScope} repos
                    </p>
                  </div>
                  <button
                    onClick={() => github.removeInstallation(inst.installationId).then(loadAll)}
                    className="btn-danger text-xs"
                  >
                    Remove
                  </button>
                </div>

                {showInstallations && (
                  <div className="space-y-2">
                    {inst.repos.map((repo) => (
                      <div
                        key={repo.fullName}
                        className="flex items-center justify-between py-2 px-3 rounded-lg bg-gray-50 dark:bg-gray-800"
                      >
                        <div className="flex items-center gap-2">
                          <span className={`inline-block h-2 w-2 rounded-full ${repo.stasInstalled ? 'bg-green-500' : 'bg-gray-300'}`} />
                          <span className="text-sm text-gray-700 dark:text-gray-300">{repo.fullName}</span>
                          {repo.private && (
                            <span className="text-xs text-gray-400">Private</span>
                          )}
                        </div>
                        <button
                          onClick={() => handleToggleRepo(inst.installationId, repo.owner, repo.name, repo.stasInstalled)}
                          disabled={togglingRepo === repo.fullName}
                          className={`text-xs px-3 py-1 rounded-full min-h-[36px] ${
                            repo.stasInstalled
                              ? 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300'
                              : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400'
                          }`}
                        >
                          {togglingRepo === repo.fullName
                            ? '...'
                            : repo.stasInstalled
                              ? 'STAS Active'
                              : 'Enable STAS'}
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))
          )}

          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 pt-4">
            Connected Repositories ({repoList.length})
          </h3>
          {repoList.length === 0 ? (
            <p className="text-sm text-gray-400">No repositories connected. Enable STAS on repos above.</p>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {repoList.map((repo) => (
                <div key={repo.id} className="card flex flex-col justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className={`inline-block h-2.5 w-2.5 rounded-full ${repo.active ? 'bg-green-500' : 'bg-gray-300 dark:bg-gray-600'}`} />
                      <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                        {repo.owner}/{repo.repo}
                      </h3>
                    </div>
                    <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                      Connected {formatRelativeTime(repo.createdAt)}
                    </p>
                  </div>
                  <button
                    onClick={() => repos.disconnect(repo.id)}
                    className="btn-danger text-xs mt-3 self-start"
                  >
                    Disconnect
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="card text-center py-12">
          <p className="text-gray-500 dark:text-gray-400">No GitHub account connected.</p>
          <p className="mt-1 text-sm text-gray-400 dark:text-gray-500">
            Connect your GitHub account to manage repositories and enable automated fixes.
          </p>
          <button onClick={handleConnectGitHub} className="btn-primary mt-4">
            Connect GitHub Account
          </button>
        </div>
      )}
    </div>
  );
}
