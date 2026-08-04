import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from 'react';
import { auth, clearToken, setRefreshToken, setToken } from '@/api/client';
import type { User } from '@/api/types';

interface AuthContextValue {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, name?: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const urlToken = params.get('token');
    const urlRefreshToken = params.get('refreshToken');
    if (urlToken || urlRefreshToken) {
      if (urlToken) setToken(urlToken);
      if (urlRefreshToken) setRefreshToken(urlRefreshToken);
      window.history.replaceState({}, '', window.location.pathname);
    }

    const token = (() => {
      try {
        return localStorage.getItem('syntaro_token');
      } catch {
        return null;
      }
    })();
    if (token) {
      auth
        .me()
        .then((res) => {
          setUser({
            id: res.id,
            email: res.email,
            name: res.name,
            username: res.username,
            avatarUrl: res.avatarUrl,
            plan: res.plan,
            createdAt: res.createdAt,
          });
        })
        .catch((err) => {
          console.warn('Failed to fetch user session, clearing token:', err);
          clearToken();
        })
        .finally(() => {
          setIsLoading(false);
        });
    } else {
      setIsLoading(false);
    }
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const result = await auth.login(email, password);
    setToken(result.token);
    setRefreshToken(result.refreshToken);
    setUser({
      id: result.user.id,
      email: result.user.email,
      name: result.user.name,
      username: result.user.name ?? undefined,
      plan: 'free',
      createdAt: result.user.createdAt || '',
    });
  }, []);

  const register = useCallback(async (email: string, password: string, name?: string) => {
    const result = await auth.register(email, password, name);
    setToken(result.token);
    setRefreshToken(result.refreshToken);
    setUser({
      id: result.user.id,
      email: result.user.email,
      name: result.user.name,
      plan: 'solo',
      createdAt: result.user.createdAt || '',
    });
  }, []);

  const logout = useCallback(async () => {
    try {
      await auth.logout();
    } catch {}
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
        register,
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
