import { useState, useEffect, useCallback } from 'react';

const API_BASE = '/api/v1/admin';

interface Run {
  id: number;
  installation_id: number;
  repo_owner: string;
  repo_name: string;
  issue_number: number;
  status: string;
  created_at: string;
  updated_at: string;
  metadata?: { claimed_by?: string };
  pr_url?: string;
}

interface PaginatedResponse {
  runs: Run[];
  total: number;
  limit: number;
  offset: number;
  aiDisabled: boolean;
}

function getAdminHeaders(): Record<string, string> {
  const token = localStorage.getItem('stas_admin_key');
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['x-admin-key'] = token;
  return headers;
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    pending: 'bg-yellow-100 text-yellow-800',
    claimed: 'bg-blue-100 text-blue-800',
    completed: 'bg-green-100 text-green-800',
    running: 'bg-indigo-100 text-indigo-800',
    failed: 'bg-red-100 text-red-800',
    cancelled: 'bg-gray-100 text-gray-500',
  };
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${styles[status] || 'bg-gray-100 text-gray-500'}`}>
      {status}
    </span>
  );
}

export default function AdminRuns() {
  const [runs, setRuns] = useState<Run[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [adminKey, setAdminKey] = useState(() => localStorage.getItem('stas_admin_key') || '');
  const [showKeyInput, setShowKeyInput] = useState(!localStorage.getItem('stas_admin_key'));
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState('');

  const fetchRuns = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (statusFilter) params.set('status', statusFilter);
      const qs = params.toString();
      const res = await fetch(`${API_BASE}/runs${qs ? `?${qs}` : ''}`, {
        headers: getAdminHeaders(),
      });
      if (res.status === 401) {
        setError('Unauthorized — check your admin API key');
        setLoading(false);
        return;
      }
      if (!res.ok) {
        setError(`Error: ${res.status} ${res.statusText}`);
        setLoading(false);
        return;
      }
      const data: PaginatedResponse = await res.json();
      setRuns(data.runs);
      setTotal(data.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch runs');
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    if (!showKeyInput) fetchRuns();
  }, [fetchRuns, showKeyInput]);

  function saveKey() {
    if (!adminKey.trim()) return;
    localStorage.setItem('stas_admin_key', adminKey.trim());
    setShowKeyInput(false);
    fetchRuns();
  }

  async function claimRun(id: number) {
    setActionMsg(null);
    try {
      const res = await fetch(`${API_BASE}/runs/${id}/claim`, {
        method: 'POST',
        headers: getAdminHeaders(),
        body: JSON.stringify({ claimedBy: 'dashboard-operator' }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        setActionMsg(`Claim failed: ${err.error}`);
        return;
      }
      setActionMsg(`Run #${id} claimed successfully`);
      fetchRuns();
    } catch (err) {
      setActionMsg(`Claim error: ${err instanceof Error ? err.message : 'Unknown'}`);
    }
  }

  async function completeRun(id: number) {
    const prUrl = prompt('Enter the PR URL:');
    if (!prUrl) return;

    setActionMsg(null);
    try {
      const res = await fetch(`${API_BASE}/runs/${id}/complete`, {
        method: 'POST',
        headers: getAdminHeaders(),
        body: JSON.stringify({ prUrl }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        setActionMsg(`Complete failed: ${err.error}`);
        return;
      }
      setActionMsg(`Run #${id} marked complete`);
      fetchRuns();
    } catch (err) {
      setActionMsg(`Complete error: ${err instanceof Error ? err.message : 'Unknown'}`);
    }
  }

  async function cancelRun(id: number) {
    if (!confirm(`Cancel run #${id}?`)) return;

    setActionMsg(null);
    try {
      const res = await fetch(`${API_BASE}/runs/${id}/cancel`, {
        method: 'POST',
        headers: getAdminHeaders(),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        setActionMsg(`Cancel failed: ${err.error}`);
        return;
      }
      setActionMsg(`Run #${id} cancelled`);
      fetchRuns();
    } catch (err) {
      setActionMsg(`Cancel error: ${err instanceof Error ? err.message : 'Unknown'}`);
    }
  }

  if (showKeyInput) {
    return (
      <div className="max-w-md mx-auto mt-16">
        <div className="card">
          <h2 className="text-lg font-semibold text-gray-900 mb-2">Admin API Key Required</h2>
          <p className="text-sm text-gray-500 mb-4">
            Enter your ADMIN_API_KEY to access the operator dashboard.
          </p>
          <input
            type="password"
            value={adminKey}
            onChange={(e) => setAdminKey(e.target.value)}
            placeholder="ADMIN_API_KEY"
            className="input-field w-full mb-3"
            onKeyDown={(e) => e.key === 'Enter' && saveKey()}
          />
          <button onClick={saveKey} className="btn-primary w-full">
            Authenticate
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Operator Dashboard</h2>
          <p className="text-sm text-gray-500">
            {total} run{total !== 1 ? 's' : ''} found
          </p>
        </div>
        <div className="flex items-center gap-3">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="input-field w-36 text-sm"
          >
            <option value="">All</option>
            <option value="pending">Pending</option>
            <option value="claimed">Claimed</option>
            <option value="completed">Completed</option>
            <option value="running">Running</option>
            <option value="failed">Failed</option>
            <option value="cancelled">Cancelled</option>
          </select>
          <button onClick={() => { localStorage.removeItem('stas_admin_key'); setShowKeyInput(true); }} className="text-sm text-gray-400 hover:text-gray-600">
            Change key
          </button>
        </div>
      </div>

      {actionMsg && (
        <div className={`rounded-lg px-4 py-3 text-sm ${actionMsg.includes('failed') || actionMsg.includes('error') ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700'}`}>
          {actionMsg}
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-gray-500">ID</th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-gray-500">Repository</th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-gray-500">Issue</th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-gray-500">Status</th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-gray-500">Claimed By</th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-gray-500">PR URL</th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-gray-500">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading ? (
              <tr>
                <td colSpan={7} className="px-4 py-12 text-center text-sm text-gray-400">Loading...</td>
              </tr>
            ) : error ? (
              <tr>
                <td colSpan={7} className="px-4 py-12 text-center text-sm text-red-500">{error}</td>
              </tr>
            ) : runs.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-12 text-center text-sm text-gray-400">No runs found.</td>
              </tr>
            ) : (
              runs.map((run) => (
                <tr key={run.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3 font-mono text-xs text-gray-600">#{run.id}</td>
                  <td className="px-4 py-3 text-sm font-medium text-gray-900">
                    {run.repo_owner}/{run.repo_name}
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-sm text-gray-700">#{run.issue_number}</span>
                  </td>
                  <td className="px-4 py-3"><StatusBadge status={run.status} /></td>
                  <td className="px-4 py-3 text-sm text-gray-500">
                    {run.metadata?.claimed_by || '—'}
                  </td>
                  <td className="px-4 py-3 text-sm">
                    {run.pr_url ? (
                      <a href={run.pr_url} target="_blank" rel="noopener noreferrer" className="text-brand-600 hover:text-brand-700 font-mono text-xs truncate max-w-[200px] block">
                        {run.pr_url}
                      </a>
                    ) : (
                      <span className="text-gray-400">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-1.5">
                      {run.status === 'pending' && (
                        <button onClick={() => claimRun(run.id)} className="btn-secondary text-xs px-2 py-1">
                          Claim
                        </button>
                      )}
                      {(run.status === 'pending' || run.status === 'claimed') && (
                        <>
                          <button onClick={() => completeRun(run.id)} className="btn-primary text-xs px-2 py-1">
                            Complete
                          </button>
                          <button onClick={() => cancelRun(run.id)} className="text-xs px-2 py-1 text-red-600 hover:text-red-700 border border-red-200 rounded-md hover:bg-red-50">
                            Cancel
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
