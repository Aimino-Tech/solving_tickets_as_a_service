import { useEffect, useState } from 'react';

const API_BASE = '/api/v1';

interface Stats {
  totalRuns: number;
  successfulRuns: number;
  failedRuns: number;
  passRate: string;
  activeRepos: number;
}

export function AnalyticsPage() {
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    const token = localStorage.getItem('stas_token');
    fetch(`${API_BASE}/stats`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => r.json())
      .then(setStats)
      .catch(console.error);
  }, []);

  return (
    <div>
      <h2 style={{ fontSize: 24, fontWeight: 600, marginBottom: 24 }}>Analytics</h2>
      {stats && (
        <div style={{ display: 'grid', gap: 16 }}>
          <div style={{ background: '#fff', borderRadius: 12, padding: 24 }}>
            <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16 }}>Fix Rate</h3>
            <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
              <div style={{ flex: 1, height: 24, background: '#e2e8f0', borderRadius: 12, overflow: 'hidden' }}>
                <div style={{ width: stats.passRate, height: '100%', background: '#48bb78', borderRadius: 12, transition: 'width 0.3s' }} />
              </div>
              <span style={{ fontWeight: 600 }}>{stats.passRate}</span>
            </div>
          </div>
          <div style={{ background: '#fff', borderRadius: 12, padding: 24 }}>
            <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16 }}>Run Distribution</h3>
            <div style={{ display: 'flex', gap: 24 }}>
              <div>
                <div style={{ fontSize: 28, fontWeight: 700, color: '#48bb78' }}>{stats.successfulRuns}</div>
                <div style={{ color: '#718096', fontSize: 14 }}>Successful</div>
              </div>
              <div>
                <div style={{ fontSize: 28, fontWeight: 700, color: '#fc8181' }}>{stats.failedRuns}</div>
                <div style={{ color: '#718096', fontSize: 14 }}>Failed</div>
              </div>
              <div>
                <div style={{ fontSize: 28, fontWeight: 700 }}>{stats.totalRuns}</div>
                <div style={{ color: '#718096', fontSize: 14 }}>Total</div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
