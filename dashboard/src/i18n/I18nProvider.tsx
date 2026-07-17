import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';
import { detectLocale, createT, type Locale, type I18nContextValue } from './i18n';

const I18nContext = createContext<I18nContextValue | null>(null);

const LOCALE_KEY = 'stas-locale';

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(detectLocale);
  const [tFn, setTFn] = useState(() => createT(detectLocale()));

  const setLocale = useCallback((newLocale: Locale) => {
    setLocaleState(newLocale);
    setTFn(() => createT(newLocale));
    try {
      localStorage.setItem(LOCALE_KEY, newLocale);
    } catch {
      // localStorage unavailable
    }
  }, []);

  return (
    <I18nContext.Provider value={{ locale, setLocale, t: tFn }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used within an I18nProvider');
  return ctx;
}
