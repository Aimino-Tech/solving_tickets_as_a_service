import { useEffect, useState } from 'react';

const API_BASE = '/api/v1';

interface AccountInfo {
  id: number;
  githubInstallationId: number;
  email: string | null;
  name: string | null;
  tier: string;
  creditBalance: number;
}

export function SettingsPage() {
  const [account, setAccount] = useState<AccountInfo | null>(null);

  useEffect(() => {
    const token = localStorage.getItem('stas_token');
    fetch(`${API_BASE}/me`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => r.json())
      .then(setAccount)
      .catch(console.error);
  }, []);

  return (
    <div>
      <h2 style={{ fontSize: 24, fontWeight: 600, marginBottom: 24 }}>Settings</h2>
      <div style={{ background: '#fff', borderRadius: 12, padding: 24 }}>
        {account && (
          <div style={{ display: 'grid', gap: 16 }}>
            <div><strong>Account ID:</strong> {account.id}</div>
            <div><strong>GitHub Installation:</strong> {account.githubInstallationId}</div>
            <div><strong>Email:</strong> {account.email || 'N/A'}</div>
            <div><strong>Name:</strong> {account.name || 'N/A'}</div>
            <div><strong>Tier:</strong> <span style={{ padding: '2px 8px', background: '#e2e8f0', borderRadius: 4, fontSize: 12 }}>{account.tier}</span></div>
            <div><strong>Credit Balance:</strong> {account.creditBalance}</div>
          </div>
        )}
      </div>
      <div style={{ marginTop: 24, background: '#fff', borderRadius: 12, padding: 24 }}>
        <h3 style={{ fontSize: 18, fontWeight: 600, marginBottom: 16 }}>Bot Configuration</h3>
        <p style={{ color: '#718096', marginBottom: 8 }}>Model and label configuration is managed via environment variables on the server.</p>
        <ul style={{ color: '#718096', lineHeight: 2 }}>
          <li>Trigger Label: <code>stas:fix</code></li>
          <li>Max Concurrent: 3</li>
          <li>Sandbox Timeout: 10 minutes</li>
        </ul>
      </div>
    </div>
  );
}
