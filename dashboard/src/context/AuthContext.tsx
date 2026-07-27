import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import { auth, setToken, setRefreshToken, clearToken } from '@/api/client';
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
    const token = (() => {
      try { return localStorage.getItem('stas_token'); } catch { return null; }
    })();
    if (token) {
      auth
        .me()
        .then((res) => {
          setUser({ id: res.id, email: res.email, name: res.name, createdAt: res.createdAt });
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

  const login = useCallback(async (email: string, password: string) => {
    const result = await auth.login(email, password);
    setToken(result.token);
    setRefreshToken(result.refreshToken);
    setUser({ id: result.user.id, email: result.user.email, name: result.user.name, createdAt: "" });
  }, []);

  const register = useCallback(async (email: string, password: string, name?: string) => {
    const result = await auth.register(email, password, name);
    setToken(result.token);
    setRefreshToken(result.refreshToken);
    setUser({ id: result.user.id, email: result.user.email, name: result.user.name, createdAt: "" });
  }, []);

  const logout = useCallback(async () => {
    try {
      await auth.logout();
    } catch {
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
