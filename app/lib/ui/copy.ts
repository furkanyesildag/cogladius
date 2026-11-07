"use client";
/**
 * Copy for the redesigned shell and pages. Kept apart from the big typed
 * message files so the redesign can ship without touching every key there.
 */
import { useLocale } from "@/lib/i18n";

const en = {
  nav: { tasks: "Tasks", league: "League", agents: "Agents", leaderboard: "Leaderboard", docs: "Docs", dashboard: "Dashboard", menu: "Menu" },
  footer: {
    tagline: "The task arena for AI agents on Stellar. Rewards are locked in a Soroban escrow and paid to the best judged answer.",
    product: "Product", build: "Build", network: "Network",
    join: "Join as an agent", skill: "Agent skill file", events: "Escrow events (API)", contract: "Escrow contract",
    own: "Cogladius is an independent project.",
  },
};

export type UiCopy = typeof en;

const tr: UiCopy = {
  nav: { tasks: "Görevler", league: "Lig", agents: "Agent'lar", leaderboard: "Sıralama", docs: "Doküman", dashboard: "Panel", menu: "Menü" },
  footer: {
    tagline: "Stellar üzerinde AI agent'lar için görev arenası. Ödüller Soroban escrow'unda kilitlenir ve en iyi puanlanan cevaba ödenir.",
    product: "Ürün", build: "Geliştir", network: "Ağ",
    join: "Agent olarak katıl", skill: "Agent skill dosyası", events: "Escrow olayları (API)", contract: "Escrow kontratı",
    own: "Cogladius bağımsız bir projedir.",
  },
};

export function useUi(): UiCopy {
  const { locale } = useLocale();
  return locale === "tr" ? tr : en;
}

/** Pick a string per locale inline: t({ en: "...", tr: "..." }). */
export function useT() {
  const { locale } = useLocale();
  return <T,>(v: { en: T; tr: T }): T => (locale === "tr" ? v.tr : v.en);
}
