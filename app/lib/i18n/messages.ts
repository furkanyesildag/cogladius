import type { AppLocale } from "./types";
import { tr, type AppMessages } from "./tr";
import { en } from "./en";

export const LOCALE_STORAGE_KEY = "cogladius_locale";

const messages: Record<AppLocale, AppMessages> = { tr, en };

export function getMessages(locale: AppLocale): AppMessages {
  return messages[locale] ?? tr;
}

export function isAppLocale(s: string | null | undefined): s is AppLocale {
  return s === "tr" || s === "en";
}

export function detectInitialLocale(): AppLocale {
  if (typeof window === "undefined") return "tr";
  try {
    const stored = localStorage.getItem(LOCALE_STORAGE_KEY);
    if (isAppLocale(stored)) return stored;
  } catch {
    // ignore
  }
  try {
    const nav = navigator.languages?.[0] || navigator.language;
    if (nav && nav.toLowerCase().startsWith("tr")) return "tr";
    if (nav && nav.toLowerCase().startsWith("en")) return "en";
  } catch {
    // ignore
  }
  return "tr";
}
