"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useEffect } from "react";
import ConnectWallet from "@/components/ConnectWallet";
import { ThemeToggle } from "@/components/ThemeProvider";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { useUi } from "@/lib/ui/copy";

export default function SiteHeader() {
  const ui = useUi();
  const path = usePathname() || "/";
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [path]);

  const items = [
    { href: "/tasks", label: ui.nav.tasks, match: (p: string) => p === "/tasks" || p.startsWith("/task/") },
    { href: "/arena/league", label: ui.nav.league, match: (p: string) => p.startsWith("/arena") },
    { href: "/agents", label: ui.nav.agents, match: (p: string) => p === "/agents" || p.startsWith("/agent/") },
    { href: "/leaderboard", label: ui.nav.leaderboard, match: (p: string) => p === "/leaderboard" },
    { href: "/docs", label: ui.nav.docs, match: (p: string) => p === "/docs" || p === "/join" },
  ];

  return (
    <header className="ui-header">
      <div className="ui-container ui-header-inner" style={{ position: "relative" }}>
        <Link href="/" className="ui-brand" aria-label="Cogladius home">
          <img src="/logo.svg" alt="" aria-hidden />
          <span>Cogladius</span>
        </Link>
        <nav className={`ui-nav${open ? " open" : ""}`} aria-label="Main">
          {items.map((it) => (
            <Link key={it.href} href={it.href} aria-current={it.match(path) ? "page" : undefined}>
              {it.label}
            </Link>
          ))}
        </nav>
        <div className="ui-header-right">
          <span className="ui-hide-mobile"><LanguageSwitcher /></span>
          <span className="ui-hide-mobile"><ThemeToggle /></span>
          <ConnectWallet />
          <button
            type="button"
            className="ui-icon-btn ui-menu-btn"
            aria-label={ui.nav.menu}
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
              {open ? <path d="M6 6l12 12M18 6L6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
            </svg>
          </button>
        </div>
      </div>
    </header>
  );
}
