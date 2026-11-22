import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { en } from './en.ts';
import { pt } from './pt.ts';
import type { Locale } from './types.ts';
import { I18nContext } from './useI18n.ts';

const STORAGE_KEY = 'figma-validator-locale';

function detectInitialLocale(): Locale {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'en' || saved === 'pt') return saved;
  } catch {
  }
  if (typeof navigator !== 'undefined' && navigator.language.toLowerCase().startsWith('pt')) {
    return 'pt';
  }
  return 'en';
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(detectInitialLocale);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
    }
  }, []);

  const t = locale === 'pt' ? pt : en;

  useEffect(() => {
    document.documentElement.lang = locale === 'pt' ? 'pt-BR' : 'en';
    document.title = t.appName;
  }, [locale, t.appName]);

  const value = useMemo(() => ({ locale, setLocale, t }), [locale, setLocale, t]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}
