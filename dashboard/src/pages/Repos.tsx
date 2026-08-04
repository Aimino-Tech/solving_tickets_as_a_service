import { useState, useEffect } from 'react';
import { github, bitbucket, type GitHubInstallation, type BitbucketRepo } from '@/api/client';
import EmptyState from '@/components/EmptyState';
import ErrorState from '@/components/ErrorState';
import { useI18n } from '@/i18n/I18nProvider';

type ConnectedRepo = {
  key: string;
  installationId: number;
  owner: string;
  name: string;
  fullName: string;
  private: boolean;
};

export default function Repos() {
  const { t } = useI18n();
  const [installations, setInstallations] = useState<GitHubInstallation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<{ connected: boolean; githubLogin?: string }>({ connected: false });
  const [showInstallations, setShowInstallations] = useState(true);
  const [togglingRepo, setTogglingRepo] = useState<string | null>(null);
  const [bbStatus, setBbStatus] = useState<{ connected: boolean; workspace: string }>({ connected: false, workspace: '' });
  const [bbRepos, setBbRepos] = useState<BitbucketRepo[]>([]);
  const [bbLoading, setBbLoading] = useState(false);
  const [bbForm, setBbForm] = useState({ apiToken: '' });
  const [bbConnecting, setBbConnecting] = useState(false);
  const [bbError, setBbError] = useState<string | null>(null);
  const [togglingBbRepo, setTogglingBbRepo] = useState<string | null>(null);

  const connectedRepos: ConnectedRepo[] = installations.flatMap((inst) =>
    (inst.repos ?? [])
      .filter((repo) => repo.syntaroInstalled)
      .map((repo) => ({
        key: `${inst.installationId}:${repo.fullName}`,
        installationId: inst.installationId,
        owner: repo.owner,
        name: repo.name,
        fullName: repo.fullName,
        private: repo.private,
      })),
  );

  async function loadBitbucket(signal?: AbortSignal) {
    setBbLoading(true);
    try {
      const status = await bitbucket.getStatus({ signal }).catch(() => ({ connected: false, workspace: '' }));
      if (signal?.aborted) return;
      setBbStatus(status);
      if (status.connected) {
        const data = await bitbucket.listRepos({ signal });
        if (signal?.aborted) return;
        setBbRepos(data.repos);
      } else {
        setBbRepos([]);
      }
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      setBbRepos([]);
    } finally {
      setBbLoading(false);
    }
  }

  async function handleConnectBitbucket() {
    const apiToken = bbForm.apiToken.trim();
    if (!apiToken || apiToken.length < 20) {
      setBbError('Paste the full Atlassian API token (Account settings → Security → API tokens).');
      return;
    }
    setBbConnecting(true);
    setBbError(null);
    try {
      await bitbucket.connect({ apiToken });
      setBbForm({ apiToken: '' });
      await loadBitbucket();
    } catch (err) {
      setBbError(err instanceof Error ? err.message : 'Failed to connect Bitbucket');
    } finally {
      setBbConnecting(false);
    }
  }

  async function handleDisconnectBitbucket() {
    if (!confirm('Disconnect Bitbucket workspace? Repo webhooks will remain but SYNTARO will stop receiving events.')) return;
    try {
      await bitbucket.disconnect();
      setBbStatus({ connected: false, workspace: '' });
      setBbRepos([]);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to disconnect');
    }
  }

  async function handleToggleBbRepo(repo: BitbucketRepo) {
    setTogglingBbRepo(repo.name);
    try {
      if (repo.webhookActive) {
        await bitbucket.removeWebhook(bbStatus.workspace, repo.name);
      } else {
        await bitbucket.configureWebhook(bbStatus.workspace, repo.name);
      }
      const data = await bitbucket.listRepos();
      setBbRepos(data.repos);
    } catch (err) {
      alert(err instanceof Error ? err.message : `Failed to ${repo.webhookActive ? 'remove' : 'configure'} webhook`);
    } finally {
      setTogglingBbRepo(null);
    }
  }

  async function loadAll(signal?: AbortSignal) {
    setLoading(true);
    setError(null);
    setWarning(null);
    try {
      const status = await github.getStatus({ signal }).catch(() => ({ connected: false }));
      if (signal?.aborted) return;
      setConnectionStatus(status);

      if (status.connected) {
        try {
          const instData = await github.listInstallations({ signal });
          if (signal?.aborted) return;
          setInstallations(instData.installations ?? []);
          if (instData.error) {
            setWarning(instData.error);
          }
        } catch (listErr) {
          if ((listErr as Error).name === 'AbortError') return;
          setInstallations([]);
          setError(listErr instanceof Error ? listErr.message : 'Failed to load GitHub installations');
        }
      } else {
        setInstallations([]);
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
    loadBitbucket(ac.signal);
    return () => ac.abort();
  }, []);

  // Handle OAuth redirect back
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    if (code) {
      github.handleCallback(code).then(() => {
        window.history.replaceState({}, '', window.location.pathname);
        loadAll();
      }).catch(() => {
        window.history.replaceState({}, '', window.location.pathname);
      });
    }
  }, []);

  async function handleConnectGitHub() {
    try {
      const { url } = await github.getOAuthUrl();
      window.location.href = url;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to connect GitHub');
    }
  }

  async function handleDisconnectGitHub() {
    if (!confirm('Disconnect GitHub account? This will remove all connected repos.')) return;
    try {
      await github.disconnect();
      setConnectionStatus({ connected: false });
      setInstallations([]);
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
      setInstallations(instData.installations ?? []);
    } catch (err) {
      alert(err instanceof Error ? err.message : `Failed to ${current ? 'remove' : 'configure'} webhook`);
    } finally {
      setTogglingRepo(null);
    }
  }

  async function handleDisconnectConnectedRepo(repo: ConnectedRepo) {
    if (!confirm(`Disconnect ${repo.fullName}? SYNTARO will stop receiving events from this repository.`)) return;
    setTogglingRepo(repo.fullName);
    try {
      await github.removeWebhook(repo.installationId, repo.owner, repo.name);
      const instData = await github.listInstallations();
      setInstallations(instData.installations ?? []);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to disconnect repository');
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
              : 'Connect your GitHub account to enable SYNTARO'}
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

      {error && <ErrorState message={error} onRetry={() => loadAll()} />}

      {warning && !error && (
        <ErrorState
          message={warning}
          className="border-yellow-200 bg-yellow-50 dark:border-yellow-800 dark:bg-yellow-900/50"
        />
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
            <EmptyState
              title="No GitHub App installations found."
              hint="Install the SYNTARO GitHub App on your repositories to get started."
              action={
                <a
                  href={`https://github.com/apps/${import.meta.env.VITE_GITHUB_APP_NAME || 'syntaro-bot'}/installations/new`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn-primary inline-block"
                >
                  Install GitHub App
                </a>
              }
            />
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
                    onClick={() => {
                      github.removeInstallation(inst.installationId)
                        .then(() => loadAll())
                        .catch((err) => setError(err instanceof Error ? err.message : 'Failed to remove installation'));
                    }}
                    className="btn-danger text-xs"
                  >
                    Remove
                  </button>
                </div>

                {showInstallations && (
                  <div className="space-y-2">
                    {(inst.repos ?? []).length === 0 ? (
                      <p className="text-xs text-gray-400 px-3 py-2">No repositories in this installation.</p>
                    ) : (
                      (inst.repos ?? []).map((repo) => (
                        <div
                          key={repo.fullName}
                          className="flex items-center justify-between py-2 px-3 rounded-lg bg-gray-50 dark:bg-gray-800"
                        >
                          <div className="flex items-center gap-2">
                            <span className={`inline-block h-2 w-2 rounded-full ${repo.syntaroInstalled ? 'bg-green-500' : 'bg-gray-300'}`} />
                            <span className="text-sm text-gray-700 dark:text-gray-300">{repo.fullName}</span>
                            {repo.private && (
                              <span className="text-xs text-gray-400">Private</span>
                            )}
                          </div>
                          <button
                            onClick={() => handleToggleRepo(inst.installationId, repo.owner, repo.name, repo.syntaroInstalled)}
                            disabled={togglingRepo === repo.fullName}
                            className={`text-xs px-3 py-1 rounded-full min-h-[44px] ${
                              repo.syntaroInstalled
                                ? 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300'
                                : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400'
                            }`}
                          >
                            {togglingRepo === repo.fullName
                              ? '...'
                              : repo.syntaroInstalled
                                ? 'SYNTARO Active'
                                : 'Enable SYNTARO'}
                          </button>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>
            ))
          )}

          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 pt-4">
            Connected Repositories ({connectedRepos.length})
          </h3>
          {connectedRepos.length === 0 ? (
            <EmptyState title="No repositories connected." hint="Enable SYNTARO on repos above." />
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {connectedRepos.map((repo) => (
                <div key={repo.key} className="card flex flex-col justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="inline-block h-2.5 w-2.5 rounded-full bg-green-500" />
                      <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                        {repo.fullName}
                      </h3>
                    </div>
                    {repo.private && (
                      <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">Private</p>
                    )}
                  </div>
                  <button
                    onClick={() => handleDisconnectConnectedRepo(repo)}
                    disabled={togglingRepo === repo.fullName}
                    className="btn-danger text-xs mt-3 self-start"
                  >
                    {togglingRepo === repo.fullName ? '...' : t('repos.disconnect')}
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

      {/* Bitbucket Workspace */}
      <div className="pt-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">{t('repos.bitbucketTitle')}</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {bbStatus.connected
                ? t('repos.bitbucketConnectedTo', { workspace: bbStatus.workspace })
                : t('repos.bitbucketDesc')}
            </p>
          </div>
          {bbStatus.connected ? (
            <button onClick={handleDisconnectBitbucket} className="btn-danger text-sm">
              {t('repos.bitbucketDisconnect')}
            </button>
          ) : null}
        </div>

        {bbError && (
          <div className="card mt-3 border-red-200 dark:border-red-800">
            <p className="text-red-600 dark:text-red-400">{bbError}</p>
          </div>
        )}

        {!bbStatus.connected ? (
          <div className="card mt-3 space-y-3">
            <p className="text-sm text-gray-600 dark:text-gray-300">
              Connect with Bitbucket OAuth (recommended). Workspace is detected automatically.
            </p>
            {bbError && (
              <p className="text-sm text-red-600 dark:text-red-400">{bbError}</p>
            )}
            <button
              onClick={async () => {
                setBbConnecting(true);
                setBbError(null);
                try {
                  const { url } = await bitbucket.getOAuthUrl();
                  window.location.href = url;
                } catch (err) {
                  setBbError(err instanceof Error ? err.message : 'Failed to start Bitbucket OAuth');
                  setBbConnecting(false);
                }
              }}
              disabled={bbConnecting}
              className="btn-primary"
            >
              {bbConnecting ? t('repos.bitbucketConnecting') : 'Connect with Bitbucket'}
            </button>
            <details className="text-sm">
              <summary className="cursor-pointer text-gray-500">Use API token instead</summary>
              <div className="mt-3 max-w-xl space-y-2">
                <input
                  type="password"
                  placeholder={t('repos.bitbucketApiToken')}
                  value={bbForm.apiToken}
                  onChange={(e) => {
                    setBbError(null);
                    setBbForm({ apiToken: e.target.value });
                  }}
                  className="input-field min-h-[44px] w-full"
                  autoComplete="off"
                />
                <button
                  onClick={handleConnectBitbucket}
                  disabled={bbConnecting || !bbForm.apiToken.trim()}
                  className="btn-secondary"
                >
                  {bbConnecting ? t('repos.bitbucketConnecting') : t('repos.bitbucketConnect')}
                </button>
              </div>
            </details>
          </div>
        ) : (
          <div className="space-y-3 mt-3">
            {bbLoading ? (
              <div className="card animate-pulse">
                <div className="h-5 w-48 rounded bg-gray-200 dark:bg-gray-700" />
              </div>
            ) : bbRepos.length === 0 ? (
              <div className="card text-center py-8">
                <p className="text-gray-500 dark:text-gray-400">{t('repos.bitbucketNoRepos', { workspace: bbStatus.workspace })}</p>
              </div>
            ) : (
              bbRepos.map((repo) => (
                <div key={repo.fullName} className="card flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className={`inline-block h-2 w-2 rounded-full ${repo.webhookActive ? 'bg-green-500' : 'bg-gray-300'}`} />
                    <span className="text-sm text-gray-700 dark:text-gray-300">{repo.fullName}</span>
                    {repo.private && <span className="text-xs text-gray-400">Private</span>}
                  </div>
                  <button
                    onClick={() => handleToggleBbRepo(repo)}
                    disabled={togglingBbRepo === repo.name}
                    className={`text-xs px-3 py-1 rounded-full min-h-[44px] ${
                      repo.webhookActive
                        ? 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300'
                        : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400'
                    }`}
                  >
                    {togglingBbRepo === repo.name ? '…' : repo.webhookActive ? t('repos.bitbucketActive') : t('repos.bitbucketEnable')}
                  </button>
                </div>
              ))
            )}
            <p className="text-xs text-gray-400">{t('repos.bitbucketHint')}</p>
          </div>
        )}
      </div>
    </div>
  );
}
