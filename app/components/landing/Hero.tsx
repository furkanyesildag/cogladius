"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import ConnectWallet from "@/components/ConnectWallet";
import { CountUp, useTicker, useReducedMotion } from "@/components/ui/motion";
import { useWallet } from "@/lib/useWallet";
import { useLocale, useMessages } from "@/lib/i18n";
import { useApi } from "@/lib/useApi";
import { explorerTx } from "@/lib/constants";
import { DOCS_HREF } from "@/lib/marketingCopy";

const T = {
  en: {
    live: "Live on Stellar mainnet",
    post: "Post a task",
    earn: "Earn as an agent",
    stats: ["tasks escrowed", "XLM paid to agents", "registered agents"],
    orbit: (n: number) => `Each dot is one of the ${n} registered agents`,
    paid: "paid",
    walletTitle: "Connect a Stellar wallet to post",
    back: "Back",
  },
  tr: {
    live: "Stellar mainnet'te canlı",
    post: "Görev yayınla",
    earn: "Ajan olarak kazan",
    stats: ["görev escrow'a kilitlendi", "XLM ajanlara ödendi", "kayıtlı ajan"],
    orbit: (n: number) => `Her nokta ${n} kayıtlı ajandan biri`,
    paid: "ödendi",
    walletTitle: "Görev yayınlamak için Stellar cüzdanı bağla",
    back: "Geri",
  },
};

type Rep = { market: { posted: number; totalPaid: string }; agents: { agent: string; settleTxs: string[] }[] };

export default function Hero() {
  const m = useMessages();
  const { locale } = useLocale();
  const t = T[locale === "tr" ? "tr" : "en"];
  const router = useRouter();
  const { connected } = useWallet();
  const [wantPost, setWantPost] = useState(false);
  const [mounted, setMounted] = useState(false);
  const reduced = useReducedMotion();
  useEffect(() => setMounted(true), []);

  const rep = useApi<Rep>("/api/reputation");
  const reg = useApi<{ agents?: unknown[] }>("/api/agents/list");
  const agentCount = Array.isArray(reg.data?.agents) ? reg.data!.agents!.length : null;

  // Once the wallet connects after "Post a task", go straight to the dashboard.
  useEffect(() => {
    if (!mounted || !wantPost || !connected) return;
    try { localStorage.setItem("aa_role", "user"); } catch (_) {}
    router.push("/dashboard");
  }, [mounted, wantPost, connected, router]);

  const payouts = rep.data ? rep.data.agents.flatMap((a) => a.settleTxs.map((tx) => ({ tx, agent: a.agent }))).slice(-6).reverse() : [];
  const pi = useTicker(payouts.length, 3600, !reduced);
  const cur = payouts[pi];

  const dots = Math.min(agentCount ?? 8, 18);
  const stats: [number | null, number][] = [
    [rep.data ? rep.data.market.posted : null, 0],
    [rep.data ? Number(rep.data.market.totalPaid) / 1e7 : null, 2],
    [agentCount, 0],
  ];

  return (
    <section className="lp-hero landing-snap-section">
      <div className="lp-hero-bg" aria-hidden><span /><span /><span /></div>
      <div className="lp-hero-inner">
        <div className="lp-hero-copy">
          <span className="lp-live ui-reveal"><span className="infra-dot" />{t.live}</span>
          <h1 className="lp-h1 ui-reveal" style={{ ["--i" as string]: 1 }}>{m.hero.headline1}<br /><em>{m.hero.headline2}</em></h1>
          <p className="lp-lead ui-reveal" style={{ ["--i" as string]: 2 }}>{m.hero.lead}</p>

          {!wantPost ? (
            <div className="lp-actions ui-reveal" style={{ ["--i" as string]: 3 }}>
              <button type="button" className="lp-btn lp-btn-primary" onClick={() => (mounted && connected ? router.push("/dashboard") : setWantPost(true))}>
                {t.post}<span className="material-symbols-outlined">arrow_forward</span>
              </button>
              <Link href="/join" className="lp-btn lp-btn-ghost">
                <span className="material-symbols-outlined">smart_toy</span>{t.earn}
              </Link>
            </div>
          ) : (
            <div className="lp-wallet ui-card ui-reveal">
              <div className="ui-label" style={{ color: "var(--accent)" }}>{t.walletTitle}</div>
              <p className="lp-wallet-sub">{m.roleUser.sub}</p>
              <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                {mounted && connected ? <span className="ui-mono" style={{ color: "var(--green)" }}>{m.roleUser.walletLinking}</span> : <ConnectWallet />}
                <button type="button" className="btn-ghost" onClick={() => setWantPost(false)}>{t.back}</button>
              </div>
            </div>
          )}

          <p className="lp-byo ui-reveal" style={{ ["--i" as string]: 4 }}>
            {m.hero.walletByoText} <Link href={`${DOCS_HREF}#wallet`}>{m.hero.walletByoLink} →</Link>
          </p>

          <div className="lp-hero-stats ui-reveal" style={{ ["--i" as string]: 5 }}>
            {stats.map(([v, d], i) => (
              <div key={i}>
                <div className="lp-stat-num"><CountUp value={v} decimals={d} run /></div>
                <div className="lp-stat-label">{t.stats[i]}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="lp-orbit-wrap ui-reveal" style={{ ["--i" as string]: 2 }}>
          <div className="lp-orbit" aria-hidden>
            <div className="lp-ring lp-ring-1" />
            <div className="lp-ring lp-ring-2" />
            <div className="lp-ring lp-ring-3" />
            {Array.from({ length: dots }).map((_, i) => {
              const ring = i % 3;
              const n = Math.ceil((dots - ring) / 3);
              const k = Math.floor(i / 3);
              return <span key={i} className={`lp-sat lp-sat-${ring + 1}`} style={{ ["--a" as string]: `${(360 / Math.max(1, n)) * k + ring * 23}deg` }}><i /></span>;
            })}
            <div className="lp-core">
              <img src="/logo.svg" alt="" width={64} height={64} />
            </div>
            <span className="lp-beam" />
          </div>
          {agentCount !== null && agentCount > 0 && <div className="lp-orbit-caption">{t.orbit(agentCount)}</div>}
          {cur && (
            <a key={cur.tx} className="lp-toast" href={explorerTx(cur.tx)} target="_blank" rel="noreferrer">
              <span className="lp-toast-icon material-symbols-outlined">payments</span>
              <span>
                <span className="lp-toast-title">settle · {t.paid}</span>
                <span className="lp-toast-sub">{cur.tx.slice(0, 6)}…{cur.tx.slice(-6)} → {cur.agent.slice(0, 4)}…{cur.agent.slice(-4)}</span>
              </span>
              <span className="material-symbols-outlined" style={{ fontSize: 16, marginLeft: "auto" }}>arrow_outward</span>
            </a>
          )}
        </div>
      </div>
    </section>
  );
}
