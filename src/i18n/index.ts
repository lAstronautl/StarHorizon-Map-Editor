import { useCallback, useSyncExternalStore } from 'react';
import { strings } from './strings';
import type { Locale } from './strings';

export type { Locale } from './strings';

const STORAGE_KEY = 'ss14-map-editor-locale';
const DEFAULT_LOCALE: Locale = 'ru';

function readStoredLocale(): Locale {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'ru' || stored === 'en') return stored;
  } catch {
    // localStorage unavailable
  }
  return DEFAULT_LOCALE;
}

let currentLocale: Locale = readStoredLocale();
const listeners = new Set<() => void>();

export function getLocale(): Locale {
  return currentLocale;
}

export function setLocale(locale: Locale): void {
  if (locale === currentLocale) return;
  currentLocale = locale;
  try {
    localStorage.setItem(STORAGE_KEY, locale);
  } catch {
    // localStorage unavailable
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Translate a key, optionally interpolating {placeholder} tokens from vars. */
export function t(key: string, vars?: Record<string, string | number>): string {
  const entry = strings[key];
  if (!entry) {
    console.warn(`[i18n] Missing key: ${key}`);
    return key;
  }
  let text = entry[currentLocale] ?? entry[DEFAULT_LOCALE];
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      text = text.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
    }
  }
  return text;
}

/** React hook: re-renders the component when the locale changes, returns t() bound to current locale. */
export function useT(): { t: typeof t; locale: Locale } {
  const locale = useSyncExternalStore(subscribe, getLocale);
  const bound = useCallback((key: string, vars?: Record<string, string | number>) => t(key, vars), [locale]);
  return { t: bound, locale };
}
