import { useEffect, useState } from 'react';

const API_BASE = '/api/v1';

interface Repo {
  owner: string;
  name: string;
}

export function ReposPage() {
  const [repos, setRepos] = useState<Repo[]>([]);

  useEffect(() => {
    const token = localStorage.getItem('stas_token');
    fetch(`${API_BASE}/repos`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => r.json())
      .then((d) => setRepos(d.repos ?? []))
      .catch(console.error);
  }, []);

  return (
    <div>
      <h2 style={{ fontSize: 24, fontWeight: 600, marginBottom: 24 }}>Connected Repositories</h2>
      <div style={{ background: '#fff', borderRadius: 12, padding: 24 }}>
        {repos.length === 0 && <p style={{ color: '#718096' }}>No repositories connected.</p>}
        {repos.map((repo) => (
          <div key={`${repo.owner}/${repo.name}`} style={{ padding: '12px 0', borderBottom: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>{repo.owner}/{repo.name}</span>
            <span style={{ padding: '4px 8px', background: '#c6f6d5', borderRadius: 4, fontSize: 12, color: '#276749' }}>Connected</span>
          </div>
        ))}
      </div>
    </div>
  );
}
