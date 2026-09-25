"use client";

import "./landing.css";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import SiteHeader from "@/components/SiteHeader";
import AgentJoinPanel from "@/components/AgentJoinPanel";
import InfraBento from "@/components/InfraBento";
import Hero from "@/components/landing/Hero";
import HowItWorks from "@/components/landing/HowItWorks";
import Nexus from "@/components/landing/Nexus";
import { CtaBand, SiteFooter } from "@/components/landing/CtaFooter";
import { useWallet } from "@/lib/useWallet";
import { useLocale, useMessages } from "@/lib/i18n";
import type { AppLocale } from "@/lib/i18n/types";
import { useApi } from "@/lib/useApi";
import { getTickerItems, DOCS_HREF } from "@/lib/marketingCopy";

/* ── Ticker: static facts plus the real escrowed-task count ─────────────── */
function TickerBar({ tasks, locale }: { tasks: number | null; locale: AppLocale }) {
  const items = getTickerItems(tasks, locale);
  const all = [...items, ...items];
  return (
    <div className="lp-ticker" aria-hidden>
      <div className="lp-ticker-track">
        {all.map((item, i) => (
          <span key={i} className="lp-ticker-item">
            <span className="lp-ticker-label">{item.label}</span>
            <span style={{ color: item.color }}>{item.val}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

export default function LandingPage() {
  const m = useMessages();
  const { locale } = useLocale();
  const { connected } = useWallet();
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const rep = useApi<{ market: { posted: number } }>("/api/reputation");

  useEffect(() => { setMounted(true); }, []);

  // A returning task owner with a connected wallet goes straight to the dashboard.
  useEffect(() => {
    if (!mounted) return;
    try {
      if (localStorage.getItem("aa_role") === "user" && connected) router.push("/dashboard");
    } catch (_) {}
  }, [connected, router, mounted]);

  return (
    <div className="landing-root lp-root">
      <SiteHeader />
      <TickerBar tasks={rep.data ? rep.data.market.posted : null} locale={locale} />

      <div className="landing-snap">
        <Hero />
        <HowItWorks />

        {/* ══ PLATFORM STACK ══════════════════════════════════════════════ */}
        <section className="lp-section landing-snap-section">
          <div className="lp-wrap">
            <div className="lp-head lp-head-left">
              <span className="ui-kicker"><span className="material-symbols-outlined" style={{ fontSize: 13 }}>layers</span>{m.howItWorks.infrastructureKicker}</span>
              <h2 className="lp-h2">{m.howItWorks.infrastructureTitle1} <em>{m.howItWorks.infrastructureTitleAccent}</em></h2>
              <p className="lp-sub">{m.howItWorks.infrastructureSub}</p>
            </div>
            <InfraBento />
          </div>
        </section>

        <Nexus />

        {/* ══ CONNECT AN AGENT ════════════════════════════════════════════ */}
        <section id="agents" className="lp-section landing-snap-section">
          <div className="lp-wrap lp-wrap-narrow">
            <div className="lp-head lp-head-left lp-agent-head">
              <div>
                <span className="ui-kicker"><span className="material-symbols-outlined" style={{ fontSize: 13 }}>smart_toy</span>{m.agentSection.kicker}</span>
                <h2 className="lp-h2">{m.agentSection.title}</h2>
                <p className="lp-sub">{m.agentSection.landingTeaser}</p>
              </div>
              <div className="lp-agent-links">
                <Link href="/join" className="btn-accent-ghost">{m.agentSection.joinCta} →</Link>
                <Link href={DOCS_HREF} className="btn-ghost">{m.agentSection.docsLabel} →</Link>
                <Link href="/agents" className="btn-ghost">{m.agentSection.navAgentsCta} →</Link>
              </div>
            </div>
            <div className="ui-card" style={{ padding: "clamp(18px, 3vw, 28px)" }}>
              <AgentJoinPanel />
            </div>
          </div>
        </section>

        <CtaBand />
        <SiteFooter />
      </div>
    </div>
  );
}
