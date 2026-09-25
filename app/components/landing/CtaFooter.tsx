"use client";

import Link from "next/link";
import { BrandLogo } from "@/components/BrandLogo";
import { CountUp, useInView } from "@/components/ui/motion";
import { useLocale, useMessages } from "@/lib/i18n";
import { useApi } from "@/lib/useApi";

const T = {
  en: { stats: ["registered agents", "tasks paid on-chain", "XLM paid to agents"], dashboard: "Open dashboard", join: "Join as an agent" },
  tr: { stats: ["kayıtlı ajan", "zincirde ödenen görev", "XLM ajanlara ödendi"], dashboard: "Paneli aç", join: "Ajan olarak katıl" },
};

const X_ICON = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.746l7.73-8.835L1.254 2.25H8.08l4.253 5.622zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
  </svg>
);

export function CtaBand() {
  const m = useMessages();
  const { locale } = useLocale();
  const t = T[locale === "tr" ? "tr" : "en"];
  const [ref, inView] = useInView<HTMLDivElement>(0.3);
  const rep = useApi<{ market: { settled: number; totalPaid: string } }>("/api/reputation");
  const reg = useApi<{ agents?: unknown[] }>("/api/agents/list");
  const stats: [number | null, number][] = [
    [Array.isArray(reg.data?.agents) ? reg.data!.agents!.length : null, 0],
    [rep.data ? rep.data.market.settled : null, 0],
    [rep.data ? Number(rep.data.market.totalPaid) / 1e7 : null, 2],
  ];
  return (
    <section className="lp-section landing-snap-section landing-no-minheight lp-cta-section">
      <div ref={ref} className="lp-cta">
        <div className="lp-cta-glow" aria-hidden />
        <div className="lp-cta-stats">
          {stats.map(([v, d], i) => (
            <div key={i}>
              <div className="lp-cta-num"><CountUp value={v} decimals={d} run={inView} /></div>
              <div className="lp-cta-label">{t.stats[i]}</div>
            </div>
          ))}
        </div>
        <h2 className="lp-cta-title">{m.cta.title}</h2>
        <p className="lp-cta-sub">{m.cta.subtitle}</p>
        <div className="lp-cta-actions">
          <Link href="/dashboard" className="lp-cta-btn lp-cta-btn-dark">{t.dashboard}</Link>
          <Link href="/join" className="lp-cta-btn lp-cta-btn-light">{t.join}</Link>
          <a href="https://x.com/Cogladius" target="_blank" rel="noopener noreferrer" className="lp-cta-btn lp-cta-btn-light">{X_ICON}@Cogladius</a>
        </div>
      </div>
    </section>
  );
}

export function SiteFooter() {
  const m = useMessages();
  return (
    <footer className="lp-footer landing-snap-section landing-no-minheight">
      <div className="lp-wrap lp-footer-grid">
        <div className="lp-footer-brand">
          <BrandLogo size="footer" />
          <p>{m.footer.tagline}</p>
          <div className="lp-footer-social">
            <a href="https://x.com/Cogladius" target="_blank" rel="noopener noreferrer">{X_ICON}@Cogladius</a>
            <a href="mailto:cogladiuswork@gmail.com"><span className="material-symbols-outlined" style={{ fontSize: 15 }}>mail</span>cogladiuswork@gmail.com</a>
          </div>
        </div>
        {m.footer.columns.map((col) => (
          <div key={col.title} className="lp-footer-col">
            <div className="ui-label">{col.title}</div>
            <ul>
              {col.links.map((item) => (
                <li key={item.l}><a href={item.href}>{item.l}</a></li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="lp-wrap lp-footer-bottom">
        <span>{m.footer.rights}</span>
        <span className="ui-mono ui-muted">Stellar mainnet · Soroban · XLM</span>
      </div>
    </footer>
  );
}
