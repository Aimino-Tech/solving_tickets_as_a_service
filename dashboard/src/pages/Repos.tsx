import { useState, useEffect } from 'react';
import { repos } from '@/api/client';
import type { Repo } from '@/api/types';

export default function Repos() {
  const [repoList, setRepoList] = useState<Repo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showConnect, setShowConnect] = useState(false);
  const [connectForm, setConnectForm] = useState({ owner: '', repo: '', installationId: '' });
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);

  function loadRepos() {
    setLoading(true);
    setError(null);
    repos
      .list()
      .then(setRepoList)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    loadRepos();
  }, []);

  async function handleConnect(e: React.FormEvent) {
    e.preventDefault();
    setConnecting(true);
    setConnectError(null);
    try {
      await repos.connect({
        owner: connectForm.owner,
        repo: connectForm.repo,
        installationId: connectForm.installationId ? Number(connectForm.installationId) : undefined,
      });
      setShowConnect(false);
      setConnectForm({ owner: '', repo: '', installationId: '' });
      loadRepos();
    } catch (err) {
      setConnectError(err instanceof Error ? err.message : 'Failed to connect repo');
    } finally {
      setConnecting(false);
    }
  }

  async function handleDisconnect(id: string) {
    if (!confirm('Disconnect this repository?')) return;
    try {
      await repos.disconnect(id);
      loadRepos();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to disconnect');
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500">
          {repoList.length} connected {repoList.length === 1 ? 'repository' : 'repositories'}
        </p>
        <button onClick={() => setShowConnect(!showConnect)} className="btn-primary">
          {showConnect ? 'Cancel' : 'Connect Repo'}
        </button>
      </div>

      {/* Connect form */}
      {showConnect && (
        <div className="card">
          <h3 className="text-base font-semibold text-gray-900">Connect a Repository</h3>
          <form onSubmit={handleConnect} className="mt-4 space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div>
                <label className="block text-sm font-medium text-gray-700">Owner</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. my-org"
                  value={connectForm.owner}
                  onChange={(e) => setConnectForm({ ...connectForm, owner: e.target.value })}
                  className="input-field mt-1"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Repo</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. my-repo"
                  value={connectForm.repo}
                  onChange={(e) => setConnectForm({ ...connectForm, repo: e.target.value })}
                  className="input-field mt-1"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Installation ID</label>
                <input
                  type="number"
                  placeholder="Optional"
                  value={connectForm.installationId}
                  onChange={(e) => setConnectForm({ ...connectForm, installationId: e.target.value })}
                  className="input-field mt-1"
                />
              </div>
            </div>
            {connectError && <p className="text-sm text-red-600">{connectError}</p>}
            <button type="submit" disabled={connecting} className="btn-primary">
              {connecting ? 'Connecting...' : 'Connect'}
            </button>
          </form>
        </div>
      )}

      {/* Repo list */}
      {loading ? (
        <div className="space-y-3">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="card animate-pulse">
              <div className="h-5 w-48 rounded bg-gray-200" />
              <div className="mt-2 h-4 w-32 rounded bg-gray-200" />
            </div>
          ))}
        </div>
      ) : error ? (
        <div className="card">
          <p className="text-red-600">{error}</p>
          <button onClick={loadRepos} className="mt-2 text-sm font-medium text-brand-600">
            Retry
          </button>
        </div>
      ) : repoList.length === 0 ? (
        <div className="card text-center py-12">
          <p className="text-gray-500">No repositories connected yet.</p>
          <p className="mt-1 text-sm text-gray-400">
            Connect a repository to start receiving automated fixes.
          </p>
          <button onClick={() => setShowConnect(true)} className="btn-primary mt-4">
            Connect your first repo
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {repoList.map((repo) => (
            <div key={repo.id} className="card flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <span className={`inline-block h-2.5 w-2.5 rounded-full ${repo.active ? 'bg-green-500' : 'bg-gray-300'}`} />
                  <h3 className="text-sm font-semibold text-gray-900">
                    {repo.owner}/{repo.repo}
                  </h3>
                </div>
                <p className="mt-1 text-xs text-gray-500">
                  Connected {new Date(repo.createdAt).toLocaleDateString()}
                  {repo.installationId && ` · Installation #${repo.installationId}`}
                </p>
              </div>
              <button
                onClick={() => handleDisconnect(repo.id)}
                className="btn-danger text-xs"
              >
                Disconnect
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
