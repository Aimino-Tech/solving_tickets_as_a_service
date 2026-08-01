import { useCallback, useEffect, useState } from 'react';
import { gdpr } from '@/api/client';
import { useAuth } from '@/context/AuthContext';

interface ConsentConfig {
  required: boolean;
  version: string;
  text: string;
  categories: Array<{ id: string; required: boolean; label: string; description: string }>;
}

const STORAGE_KEY = 'stas-cookie-consent';

function loadStored(): Record<string, boolean> | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, boolean>) : null;
  } catch {
    return null;
  }
}

export function CookieConsentBanner() {
  const [config, setConfig] = useState<ConsentConfig | null>(null);
  const [visible, setVisible] = useState(false);
  const { isAuthenticated } = useAuth();

  useEffect(() => {
    let cancelled = false;
    gdpr
      .consentConfig()
      .then((cfg) => {
        if (cancelled) return;
        setConfig(cfg);
        if (!loadStored()) setVisible(true);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const save = useCallback(
    (preferences: Record<string, boolean>) => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
      if (isAuthenticated) {
        gdpr.setCookiePreferences(preferences).catch(() => {});
      }
      setVisible(false);
    },
    [isAuthenticated],
  );

  const acceptAll = useCallback(() => {
    if (!config) return;
    const all = Object.fromEntries(config.categories.map((c) => [c.id, true]));
    save(all);
  }, [config, save]);

  if (!visible || !config) return null;

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 border-t border-gray-200 bg-white px-4 py-3 shadow-lg dark:border-gray-700 dark:bg-gray-900">
      <div className="mx-auto flex max-w-5xl flex-col gap-3 sm:flex-row sm:items-center">
        <div className="flex-1 text-sm text-gray-700 dark:text-gray-200">
          <p className="font-medium">We value your privacy</p>
          <p className="mt-0.5 text-gray-500 dark:text-gray-400">{config.text}</p>
        </div>
        <div className="flex shrink-0 gap-2">
          <a
            href="/privacy"
            className="inline-flex items-center rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-800"
          >
            Manage
          </a>
          <button
            onClick={acceptAll}
            className="inline-flex items-center rounded-md bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700"
          >
            Accept all
          </button>
        </div>
      </div>
    </div>
  );
}
