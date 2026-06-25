import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import { auth, setToken, clearToken } from '@/api/client';
import type { User } from '@/api/types';

interface AuthContextValue {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: () => void;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // On mount, check if there's a token in the URL (from OAuth callback) or in localStorage
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const tokenFromUrl = params.get('token');

    if (tokenFromUrl) {
      setToken(tokenFromUrl);
      // Clean the URL without a full reload
      window.history.replaceState({}, '', window.location.pathname);
    }

    const token = localStorage.getItem('stas_token');
    if (token) {
      auth
        .me()
        .then((res) => {
          setUser({
            githubId: res.user.githubId,
            username: res.user.username,
            avatarUrl: res.user.avatarUrl,
          });
        })
        .catch(() => {
          clearToken();
        })
        .finally(() => {
          setIsLoading(false);
        });
    } else {
      setIsLoading(false);
    }
  }, []);

  const login = useCallback(() => {
    window.location.href = auth.loginUrl();
  }, []);

  const logout = useCallback(async () => {
    try {
      await auth.logout();
    } catch {
      // Ignore errors during logout
    }
    clearToken();
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        isAuthenticated: !!user,
        isLoading,
        login,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return ctx;
}
