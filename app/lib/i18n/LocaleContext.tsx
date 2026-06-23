"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { AppLocale } from "./types";
import { getMessages, LOCALE_STORAGE_KEY, detectInitialLocale } from "./messages";

type Ctx = {
  locale: AppLocale;
  setLocale: (l: AppLocale) => void;
};

const LocaleContext = createContext<Ctx | null>(null);

export function LocaleProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<AppLocale>("tr");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setLocaleState(detectInitialLocale());
    setReady(true);
  }, []);

  const setLocale = useCallback((l: AppLocale) => {
    setLocaleState(l);
    try {
      localStorage.setItem(LOCALE_STORAGE_KEY, l);
      document.cookie = `${LOCALE_STORAGE_KEY}=${l}; path=/; max-age=31536000; SameSite=Lax`;
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    if (!ready) return;
    if (typeof document === "undefined") return;
    document.documentElement.lang = locale === "tr" ? "tr" : "en";
    const m = getMessages(locale).meta;
    document.title = m.title;
    let meta = document.querySelector('meta[name="description"]');
    if (!meta) {
      meta = document.createElement("meta");
      meta.setAttribute("name", "description");
      document.head.appendChild(meta);
    }
    meta.setAttribute("content", m.description);
  }, [locale, ready]);

  const value = useMemo(() => ({ locale, setLocale }), [locale, setLocale]);

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale() {
  const c = useContext(LocaleContext);
  if (!c) {
    throw new Error("useLocale must be used within LocaleProvider");
  }
  return c;
}

export function useMessages() {
  const { locale } = useLocale();
  return useMemo(() => getMessages(locale), [locale]);
}
