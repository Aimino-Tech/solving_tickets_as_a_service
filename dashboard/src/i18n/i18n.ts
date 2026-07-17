import en from './locales/en.json';
import de from './locales/de.json';

export type Locale = 'en' | 'de';

const messages: Record<Locale, Record<string, string>> = { en, de };

export type I18nContextValue = {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: string, params?: Record<string, string | number>) => string;
};

const LOCALE_KEY = 'stas-locale' as const;
const DEFAULT_LOCALE: Locale = 'en';

export function detectLocale(): Locale {
  try {
    const stored = localStorage.getItem(LOCALE_KEY);
    if (stored && stored in messages) return stored as Locale;
  } catch {
    // localStorage unavailable (SSR, private browsing edge case)
  }

  const browserLang = typeof navigator !== 'undefined' ? navigator.language : undefined;
  if (browserLang) {
    const short = browserLang.split('-')[0] as Locale;
    if (short in messages) return short;
  }

  return DEFAULT_LOCALE;
}

export function createT(locale: Locale) {
  return (key: string, params?: Record<string, string | number>): string => {
    const dict = messages[locale] ?? messages[DEFAULT_LOCALE];
    let value = dict[key] ?? messages[DEFAULT_LOCALE][key] ?? key;

    if (params) {
      for (const [param, val] of Object.entries(params)) {
        value = value.replace(new RegExp(`\\{\\{${param}\\}\\}`, 'g'), String(val));
      }
    }

    return value;
  };
}
