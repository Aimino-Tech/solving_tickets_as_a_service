import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from 'react';
import { adminUsers } from '@/api/adminUsers';
import { auth, clearToken, getRefreshToken, setRefreshToken, setToken } from '@/api/client';
import type { User } from '@/api/types';

const ADMIN_TOKEN_KEY = 'syntaro_admin_token';
const ADMIN_REFRESH_KEY = 'syntaro_admin_refresh';

interface AuthContextValue {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, name?: string) => Promise<void>;
  logout: () => Promise<void>;
  enterImpersonation: (token: string, refreshToken: string) => Promise<void>;
  exitImpersonation: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function mapMe(res: Awaited<ReturnType<typeof auth.me>>): User {
  if (res.token) setToken(res.token);
  if (res.refreshToken) setRefreshToken(res.refreshToken);
  return {
    id: res.id,
    email: res.email,
    name: res.name,
    username: res.username,
    avatarUrl: res.avatarUrl,
    plan: res.plan,
    createdAt: res.createdAt,
    isAdmin: res.isAdmin,
    role: res.role,
    impersonating: res.impersonating,
    impersonator: res.impersonator,
  };
}

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
          setUser(mapMe(res));
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
      role: result.user.role,
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
    // Route fresh registrations through the onboarding wizard (US-5..9).
    // App.tsx reads this flag when redirecting away from /login.
    sessionStorage.setItem('syntaro:onboarding_pending', '1');
  }, []);

  const logout = useCallback(async () => {
    try {
      await auth.logout();
    } catch {}
    try {
      sessionStorage.removeItem(ADMIN_TOKEN_KEY);
      sessionStorage.removeItem(ADMIN_REFRESH_KEY);
    } catch {}
    clearToken();
    setUser(null);
  }, []);

  const enterImpersonation = useCallback(async (token: string, refreshToken: string) => {
    try {
      const current = localStorage.getItem('syntaro_token');
      const currentRefresh = getRefreshToken();
      if (current) sessionStorage.setItem(ADMIN_TOKEN_KEY, current);
      if (currentRefresh) sessionStorage.setItem(ADMIN_REFRESH_KEY, currentRefresh);
    } catch {}
    setToken(token);
    setRefreshToken(refreshToken);
    const res = await auth.me();
    setUser(mapMe(res));
  }, []);

  const exitImpersonation = useCallback(async () => {
    try {
      await adminUsers.exitImpersonation();
    } catch {
      // Audit is best-effort; still restore admin session.
    }
    try {
      const adminToken = sessionStorage.getItem(ADMIN_TOKEN_KEY);
      const adminRefresh = sessionStorage.getItem(ADMIN_REFRESH_KEY);
      sessionStorage.removeItem(ADMIN_TOKEN_KEY);
      sessionStorage.removeItem(ADMIN_REFRESH_KEY);
      if (!adminToken) {
        clearToken();
        setUser(null);
        window.location.href = '/login';
        return;
      }
      setToken(adminToken);
      if (adminRefresh) setRefreshToken(adminRefresh);
      // Hard reload as admin so all pages drop the member session.
      window.location.href = '/admin/users';
    } catch {
      clearToken();
      setUser(null);
      window.location.href = '/login';
    }
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
        enterImpersonation,
        exitImpersonation,
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
