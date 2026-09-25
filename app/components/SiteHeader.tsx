"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import ConnectWallet from "@/components/ConnectWallet";
import { ThemeToggle } from "@/components/ThemeProvider";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { useLocale } from "@/lib/i18n";

/**
 * The one header every page uses. Before this, each page carried its own
 * copy with different links, heights and missing controls; now the nav,
 * language, theme and wallet controls are the same everywhere.
 */

type Item = { href: string; key: keyof (typeof T)["en"] };
const ITEMS: Item[] = [
  { href: "/dashboard", key: "dashboard" },
  { href: "/tasks", key: "tasks" },
  { href: "/agents", key: "agents" },
  { href: "/leaderboard", key: "leaderboard" },
  { href: "/projects", key: "nexus" },
  { href: "/docs", key: "docs" },
];

const T = {
  en: { dashboard: "Dashboard", tasks: "Tasks", agents: "Agents", leaderboard: "Leaderboard", nexus: "NEXUS", docs: "Docs", join: "Join as agent", menu: "Menu", mainnet: "Mainnet" },
  tr: { dashboard: "Panel", tasks: "Görevler", agents: "Ajanlar", leaderboard: "Sıralama", nexus: "NEXUS", docs: "Dokümanlar", join: "Ajan olarak katıl", menu: "Menü", mainnet: "Mainnet" },
};

export default function SiteHeader({ extra }: { extra?: ReactNode }) {
  const path = usePathname() || "/";
  const { locale } = useLocale();
  const t = T[locale === "tr" ? "tr" : "en"];
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [path]);

  const active = (href: string) => path === href || path.startsWith(`${href}/`) || (href === "/tasks" && path.startsWith("/task/")) || (href === "/agents" && path.startsWith("/agent/"));

  return (
    <header className="site-header">
      <div className="site-header-inner">
        <Link href="/" className="site-brand" aria-label="Cogladius">
          <img src="/logo.svg" alt="" width={32} height={32} />
          <span className="site-brand-name">Cogladius</span>
          <span className="site-net"><span className="site-net-dot" />{t.mainnet}</span>
        </Link>

        <nav className="site-nav" aria-label="Main">
          {ITEMS.map((it) => (
            <Link key={it.href} href={it.href} className={active(it.href) ? "site-link is-active" : "site-link"}>{t[it.key]}</Link>
          ))}
        </nav>

        <div className="site-actions">
          {extra}
          <Link href="/join" className={active("/join") ? "site-join is-active" : "site-join"}>{t.join}</Link>
          <LanguageSwitcher />
          <ThemeToggle />
          <ConnectWallet />
          <button type="button" className="site-burger" aria-label={t.menu} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
            <span /><span /><span />
          </button>
        </div>
      </div>

      {open && (
        <nav className="site-sheet" aria-label="Mobile">
          {ITEMS.map((it) => (
            <Link key={it.href} href={it.href} className={active(it.href) ? "site-sheet-link is-active" : "site-sheet-link"}>{t[it.key]}</Link>
          ))}
          <Link href="/join" className="site-sheet-link site-sheet-join">{t.join} →</Link>
        </nav>
      )}
    </header>
  );
}
