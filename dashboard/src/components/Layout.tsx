import type { LucideIcon } from 'lucide-react';
import {
  CreditCard,
  Gift,
  GitFork,
  LayoutDashboard,
  RotateCw,
  ScrollText,
  Settings as SettingsIcon,
  ShieldCheck,
  Users,
  Zap,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { adminSteering } from '@/api/adminSteering';
import NotificationBell from '@/components/NotificationBell';
import { useAuth } from '@/context/AuthContext';
import { useTheme } from '@/context/ThemeContext';
import { useI18n } from '@/i18n/I18nProvider';

const LOCALES = [
  { code: 'en' as const, label: 'EN' },
  { code: 'de' as const, label: 'DE' },
  { code: 'fr' as const, label: 'FR' },
  { code: 'es' as const, label: 'ES' },
] as const;

export default function Layout() {
  const { user, logout } = useAuth();
  const { isDark, toggleTheme } = useTheme();
  const { t, locale, setLocale } = useI18n();
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    let cancelled = false;
    adminSteering
      .health()
      .then(() => {
        if (!cancelled) setIsAdmin(true);
      })
      .catch(() => {
        if (!cancelled) setIsAdmin(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const NAV_ITEMS: { to: string; label: string; icon: LucideIcon }[] = [
    { to: '/', label: t('nav.dashboard'), icon: LayoutDashboard },
    { to: '/runs', label: t('nav.runs'), icon: RotateCw },
    { to: '/repos', label: t('nav.repos'), icon: GitFork },
    // AIM-4642
    { to: '/members', label: 'Members', icon: Users },
    { to: '/billing', label: 'Billing', icon: CreditCard },
    { to: '/audit', label: t('nav.audit'), icon: ScrollText },
    // AIM-4643
    { to: '/referral', label: 'Referral', icon: Gift },
    { to: '/settings', label: t('nav.settings'), icon: SettingsIcon },
  ];

  if (isAdmin) {
    NAV_ITEMS.splice(5, 0, { to: '/admin', label: t('nav.admin'), icon: ShieldCheck });
  }

  const pageTitle =
    NAV_ITEMS.find((item) => (item.to === '/' ? location.pathname === '/' : location.pathname.startsWith(item.to)))
      ?.label ?? t('nav.dashboard');

  return (
    <div className="flex h-screen overflow-hidden bg-gray-50 dark:bg-gray-900">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-40 bg-black/30 lg:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-64 flex-col bg-white dark:bg-gray-800 border-r border-gray-200 dark:border-gray-700 transition-transform lg:static lg:translate-x-0 ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {/* Brand */}
        <div className="flex h-16 items-center gap-3 border-b border-gray-200 dark:border-gray-700 px-6">
          <Zap className="h-6 w-6 text-brand-600 dark:text-brand-400" />
          <div>
            <h1 className="text-base font-bold text-gray-900 dark:text-gray-100">SYNTARO</h1>
            <p className="text-xs text-gray-500 dark:text-gray-400">Premium Dashboard</p>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 space-y-1 px-3 py-4">
          {NAV_ITEMS.map((item) => {
            const isActive = item.to === '/' ? location.pathname === '/' : location.pathname.startsWith(item.to);
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/'}
                onClick={() => setSidebarOpen(false)}
                className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors min-h-[44px] ${
                  isActive
                    ? 'bg-brand-50 dark:bg-brand-900/50 text-brand-700 dark:text-brand-300'
                    : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 hover:text-gray-900 dark:hover:text-gray-100'
                }`}
              >
                <item.icon size={20} />
                {item.label}
              </NavLink>
            );
          })}
        </nav>

        {/* User footer */}
        <div className="border-t border-gray-200 dark:border-gray-700 px-4 py-4">
          <div className="flex items-center gap-3">
            {user?.avatarUrl ? (
              <img src={user.avatarUrl} alt={user.name || user.email || ''} className="h-8 w-8 rounded-full" />
            ) : (
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-100 dark:bg-brand-900 text-sm font-semibold text-brand-700 dark:text-brand-300">
                {(user?.name || user?.email || '?').charAt(0).toUpperCase()}
              </div>
            )}
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                {user?.name || user?.email || t('auth.user')}
              </p>
            </div>
            <button
              onClick={logout}
              className="rounded-lg p-1.5 text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 min-h-[44px] min-w-[44px] flex items-center justify-center"
              title={t('auth.logout')}
            >
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15m3 0l3-3m0 0l-3-3m3 3H9"
                />
              </svg>
            </button>
          </div>
          {/* Locale switcher */}
          <div className="mt-3 flex gap-1">
            {LOCALES.map((loc) => (
              <button
                key={loc.code}
                onClick={() => setLocale(loc.code)}
                className={`rounded px-2 py-1 text-xs font-medium transition-colors ${
                  locale === loc.code
                    ? 'bg-brand-100 text-brand-700'
                    : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'
                }`}
                title={loc.label}
              >
                {loc.label}
              </button>
            ))}
          </div>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Top bar (mobile) */}
        <header className="flex h-16 items-center gap-4 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-4 lg:px-8">
          <button
            onClick={() => setSidebarOpen(true)}
            className="rounded-lg p-2 text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 lg:hidden min-h-[44px] min-w-[44px] flex items-center justify-center"
          >
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
            </svg>
          </button>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">{pageTitle}</h2>
          <div className="ml-auto flex items-center gap-2">
            <NotificationBell />
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto p-4 lg:p-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
