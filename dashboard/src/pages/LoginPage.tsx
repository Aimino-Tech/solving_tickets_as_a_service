import { useSearchParams } from 'react-router-dom';
import { useEffect } from 'react';

const API_BASE = '/api/v1';

export function LoginPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');

  useEffect(() => {
    if (token) {
      localStorage.setItem('stas_token', token);
      window.location.href = '/';
    }
  }, [token]);

  const handleLogin = () => {
    window.location.href = '/api/auth/github';
  };

  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh', background: '#0f0f23', color: '#fff' }}>
      <div style={{ textAlign: 'center', maxWidth: 400 }}>
        <h1 style={{ fontSize: 36, marginBottom: 8, fontWeight: 700 }}>STAS</h1>
        <p style={{ color: '#a0aec0', marginBottom: 32, fontSize: 16 }}>
          Solving Tickets As A Service
        </p>
        <button
          onClick={handleLogin}
          style={{
            padding: '14px 32px',
            fontSize: 16,
            background: '#2d3748',
            color: '#fff',
            border: '1px solid #4a5568',
            borderRadius: 8,
            cursor: 'pointer',
            fontWeight: 600,
          }}
        >
          Sign in with GitHub
        </button>
      </div>
    </div>
  );
}
