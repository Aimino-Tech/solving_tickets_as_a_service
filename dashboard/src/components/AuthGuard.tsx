import { ReactNode, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

const API_BASE = '/api/v1';

interface AuthGuardProps {
  children: ReactNode;
}

export function AuthGuard({ children }: AuthGuardProps) {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('stas_token');
    if (!token) {
      navigate('/login');
      return;
    }
    fetch(`${API_BASE}/me`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => {
        if (!res.ok) {
          localStorage.removeItem('stas_token');
          navigate('/login');
        }
      })
      .catch(() => {
        localStorage.removeItem('stas_token');
        navigate('/login');
      })
      .finally(() => setLoading(false));
  }, [navigate]);

  if (loading) {
    return <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>Loading...</div>;
  }

  return <>{children}</>;
}
