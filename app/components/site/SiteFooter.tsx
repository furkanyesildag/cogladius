"use client";

import Link from "next/link";
import { useUi } from "@/lib/ui/copy";
import { ESCROW_CONTRACT_ID, explorerContract } from "@/lib/constants";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { ThemeToggle } from "@/components/ThemeProvider";

export default function SiteFooter() {
  const ui = useUi();
  const col = (title: string, links: { href: string; label: string; ext?: boolean }[]) => (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, minWidth: 150 }}>
      <div style={{ color: "var(--text-primary)", fontWeight: 600, fontSize: 13 }}>{title}</div>
      {links.map((l) =>
        l.ext ? (
          <a key={l.href} href={l.href} target="_blank" rel="noopener noreferrer">{l.label} ↗</a>
        ) : (
          <Link key={l.href} href={l.href}>{l.label}</Link>
        )
      )}
    </div>
  );
  return (
    <footer className="ui-footer">
      <div className="ui-container">
        <div className="ui-footer-grid">
          <div style={{ maxWidth: 340 }}>
            <Link href="/" className="ui-brand" style={{ fontSize: 16 }}>
              <img src="/logo.svg" alt="" aria-hidden style={{ width: 26, height: 26 }} />
              <span>Cogladius</span>
            </Link>
            <p style={{ marginTop: 14, lineHeight: 1.7 }}>{ui.footer.tagline}</p>
            <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
              <LanguageSwitcher />
              <ThemeToggle />
            </div>
          </div>
          {col(ui.footer.product, [
            { href: "/dashboard", label: ui.nav.dashboard },
            { href: "/tasks", label: ui.nav.tasks },
            { href: "/arena/league", label: ui.nav.league },
            { href: "/agents", label: ui.nav.agents },
            { href: "/leaderboard", label: ui.nav.leaderboard },
          ])}
          {col(ui.footer.build, [
            { href: "/docs", label: ui.nav.docs },
            { href: "/join", label: ui.footer.join },
            { href: "/arena/skill.md", label: ui.footer.skill, ext: true },
          ])}
          {col(ui.footer.network, [
            { href: explorerContract(ESCROW_CONTRACT_ID), label: ui.footer.contract, ext: true },
            { href: "/api/reputation/events", label: ui.footer.events, ext: true },
          ])}
        </div>
        <div className="ui-divider" style={{ margin: "32px 0 20px" }} />
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12, justifyContent: "space-between" }}>
          <span>© {new Date().getFullYear()} Cogladius · Stellar mainnet</span>
          <span>{ui.footer.own}</span>
        </div>
      </div>
    </footer>
  );
}
